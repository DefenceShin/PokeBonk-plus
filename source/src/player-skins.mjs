// Local, presentation-only player skins. No save, input, combat or shared
// species texture is changed. The format intentionally excludes executable
// manifests, URLs, GIF disposal modes and browser-dependent animation timing.
export const PLAYER_SKIN_FORMAT = Object.freeze({
  schemaVersion: 1, mimeType: "image/png", width: 1024, height: 1024,
  frameSize: 256, columns: 4, rows: 4,
  actions: ["idle", "walk", "jump", "fall"], framesPerAction: 4,
  facing: "right", maxEncodedCharacters: 6000000,
});
const SUPPORTED_ATLAS_SIZES = [256, 1024];
// THREE.LinearFilter, verified against the audited native renderer dependency.
// It is set only on the new high-resolution skin's independent texture.
const LINEAR_TEXTURE_FILTER = 1006;
// Current native Player.render selects the classic sprite atlas with this
// presentation key. Profile look IDs use a different encoding and are never
// read or written by this local renderer.
const CLASSIC_PLAYER_SPRITE_OFFSET = 20000;
const playerSpriteKey = (run, player) => player?.speciesId + (run?.skinLook === "classic" ? CLASSIC_PLAYER_SPRITE_OFFSET : 0);

export function validatePlayerSkinSpec(value) {
  const invalid = (reason) => ({ ok: false, reason });
  if (!value || typeof value !== "object") return invalid("皮肤文件内容无效");
  for (const [key, expected] of [["schemaVersion", 1], ["columns", 4], ["rows", 4]])
    if (value[key] !== undefined && value[key] !== expected) return invalid("需要 4 行 4 列的本地 PNG 动作图集");
  const pngDataUrl = value.pngDataUrl ?? value.dataUrl;
  if (typeof pngDataUrl !== "string" || pngDataUrl.length > PLAYER_SKIN_FORMAT.maxEncodedCharacters ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(pngDataUrl))
    return invalid("只支持本地 PNG 图集，不支持网页、SVG 或脚本文件");
  if (!pngDataUrl.startsWith("data:image/png;base64,iVBORw0KGgo")) return invalid("文件不是有效的 PNG 图像");
  // Inspect the fixed PNG header before decoding to bound pixel allocation.
  // Decoded dimensions are checked again below, so metadata cannot disguise a
  // giant image or cause UVs to use a different cell size from the actual PNG.
  let width, height;
  try {
    const header = globalThis.atob(pngDataUrl.slice(22, 66));
    const uint32 = offset => [...header.slice(offset, offset + 4)].reduce((n, c) => n * 256 + c.charCodeAt(0), 0);
    if (header.length < 24 || uint32(8) !== 13 || header.slice(12, 16) !== "IHDR") throw new Error("png-header");
    width = uint32(16); height = uint32(20);
  } catch { return invalid("PNG 文件头无效，请重新导入图片"); }
  if (!SUPPORTED_ATLAS_SIZES.includes(width) || height !== width)
    return invalid("运行时需要 1024×1024 或旧版 256×256 的 PNG 图集，请通过皮肤导入功能转换");
  const frameSize = width / 4;
  for (const [key, expected] of [["width", width], ["height", height], ["frameSize", frameSize]])
    if (value[key] !== undefined && value[key] !== expected) return invalid("皮肤规格与 PNG 实际尺寸不一致，请重新导入");
  return { ok: true, id: String(value.id ?? "local").slice(0, 100),
    name: String(value.name ?? "未命名皮肤").slice(0, 80), pngDataUrl, width, height, frameSize };
}

// Match opaque bounds rather than the transparent frame cell. Both axes
// use the native measured body envelope, so a large imported image cannot
// enlarge the player's original on-screen body or move its feet.
export function fitSkinFrameToNative(bounds, nativeWidth, nativeHeight, scale = 1, frameSize = 64) {
  if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom, nativeWidth, nativeHeight, scale].every(Number.isFinite) ||
      ![64, 256].includes(frameSize) || bounds.left < 0 || bounds.top < 0 || bounds.right > frameSize || bounds.bottom > frameSize ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top || nativeWidth <= 0 || nativeHeight <= 0 || scale <= 0) return null;
  // Tiny or nearly transparent art remains usable, but must not expand its
  // mostly transparent quad across the screen. A quarter-cell virtual envelope
  // caps each plane axis at 4× the native body. Use the true centre and feet
  // below with this capped ratio, so the actual visible pixels stay anchored.
  const x = nativeWidth * scale / Math.max(frameSize / 4, bounds.right - bounds.left),
    y = nativeHeight * scale / Math.max(frameSize / 4, bounds.bottom - bounds.top);
  const result = { width: frameSize * x, height: frameSize * y,
    // Native quads are anchored at bottom-centre, including transparent pixels.
    offsetX: (frameSize / 2 - (bounds.left + bounds.right) / 2) * x,
    offsetY: -(frameSize - bounds.bottom) * y };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function skinPoseForPlayer(player, nativeAction) {
  if (player?.grounded === false) return Number(player?.vel?.y) < 0 ? "fall" : "jump";
  return nativeAction === "walk" || Number(player?.speedNow) > 0.6 ? "walk" : "idle";
}

export function installPlayerSkins(options = {}) {
  const previous = globalThis.__PB_PLAYER_SKINS;
  if (previous && !options.hotReload) return previous;
  previous?.dispose?.();
  const getBridge = options.getBridge ?? (() => globalThis.__PB_BRIDGE);
  const interval = options.setInterval ?? globalThis.setInterval?.bind(globalThis);
  const cancelInterval = options.clearInterval ?? globalThis.clearInterval?.bind(globalThis);
  const document = options.document ?? globalThis.document;
  let timer = null, selected = null, binding = null, generation = 0, disposed = false, blocked = null;
  let status = { phase: "disabled", reason: "使用游戏原角色外观", skinId: null, name: null };
  const publish = (phase, reason) => {
    status = { phase, reason, skinId: selected?.id ?? null, name: selected?.name ?? null };
    return { ...status };
  };
  const release = () => {
    const b = binding;
    binding = null;
    if (!b) return;
    if (b.player.render === b.render) {
      if (b.hadOwnRender) b.player.render = b.originalRender;
      else delete b.player.render;
    }
    for (const key of ["begin", "end", "clear"])
      if (b.sprites[key] === b[key]) {
        if (b.own[key]) b.sprites[key] = b.original[key];
        else delete b.sprites[key];
      }
    try { b.batch?.dispose?.(); } catch { /* Cosmetic cleanup cannot stop play. */ }
  };
  const finite = (...values) => values.every(Number.isFinite);
  const nativeBatchReady = (native, sprites) => native?.ready === true && native.constructor !== Object &&
    typeof native.constructor === "function" && typeof native.push === "function" && typeof native.anim === "function" &&
    typeof native.bodyWidth === "function" && typeof native.bodyHeight === "function" &&
    ["begin", "end", "dispose", "allocate", "measure"].every(key => typeof native[key] === "function") &&
    native.mesh?.geometry && native.material?.uniforms?.map && native.aPos?.array && native.aSize?.array &&
    sprites.scene?.add && sprites.shared?.uTime && sprites.shared?.uLight &&
    finite(native.bodyWidth(), native.bodyHeight()) && native.bodyWidth() > 0 && native.bodyHeight() > 0;
  const failBinding = (b, reason) => {
    b.failed = true;
    if (b.batch?.mesh) b.batch.mesh.visible = false;
    blocked = { run: b.run, player: b.player, sprites: b.sprites, speciesId: b.speciesId, spriteKey: b.spriteKey };
    publish("unsupported", reason);
  };
  function tick() {
    if (disposed || !selected) return;
    const app = getBridge()?.app, run = app?.run, player = run?.player, sprites = run?.sprites,
      spriteKey = playerSpriteKey(run, player);
    if (binding && (binding.run !== run || binding.player !== player || binding.sprites !== sprites ||
        binding.speciesId !== player?.speciesId || binding.spriteKey !== spriteKey || run?.state === "over" || binding.failed ||
        (typeof sprites?.batches?.get === "function" && sprites.batches.get(binding.spriteKey) !== binding.native))) release();
    if (blocked && (blocked.run !== run || blocked.player !== player || blocked.sprites !== sprites ||
        blocked.speciesId !== player?.speciesId || blocked.spriteKey !== spriteKey || run?.state === "over")) blocked = null;
    if (!run || !player || !sprites || run.state === "over") {
      publish("waiting", "皮肤已选择，进入对局后自动应用");
      return;
    }
    if (binding) return;
    if (blocked) return;
    if (!["get", "begin", "end", "clear"].every(key => typeof sprites[key] === "function") || typeof player.render !== "function") {
      blocked = { run, player, sprites, speciesId: player.speciesId, spriteKey };
      publish("unsupported", "当前游戏绘制接口未识别，已保留游戏原角色外观");
      return;
    }
    let native;
    try { native = sprites.get(spriteKey); } catch { return; }
    if (!native?.ready) { publish("waiting", "正在等待游戏角色图像加载"); return; }
    if (!nativeBatchReady(native, sprites)) {
      blocked = { run, player, sprites, speciesId: player.speciesId, spriteKey };
      publish("unsupported", "当前游戏绘制接口未识别，已保留游戏原角色外观");
      return;
    }
    const b = { run, player, sprites, speciesId: player.speciesId, spriteKey, native, batch: null, failed: false,
      hadOwnRender: Object.hasOwn(player, "render"), originalRender: player.render,
      original: Object.fromEntries(["begin", "end", "clear"].map(key => [key, sprites[key]])),
      own: Object.fromEntries(["begin", "end", "clear"].map(key => [key, Object.hasOwn(sprites, key)])),
      facingLeft: false };
    try {
      // Construct an independent one-instance native batch using an in-memory
      // decoded local PNG. Never add it to the species map or reuse its texture.
      b.batch = new native.constructor(-2, sprites.scene, sprites.shared, 1, selected.image);
      const custom = b.batch;
      if (!custom?.ready || typeof custom.push !== "function" || !custom.aUV?.array || !custom.aTint?.array)
        throw new Error("incompatible-cosmetic-batch");
      const frameSize = selected.frameSize;
      custom.meta = { w: selected.width, h: selected.height, anims: Object.fromEntries(PLAYER_SKIN_FORMAT.actions.map((action, row) =>
        [action, { y: row * frameSize, fw: frameSize, fh: frameSize, n: 4, rows: 1, d: action === "idle" ? [15, 15, 15, 15] : [7, 7, 7, 7] }])) };
      custom.fallback = true;
      custom.foot = { foot: frameSize / 2, top: -frameSize / 2, width: frameSize };
      if (frameSize > 64) {
        const texture = custom.material?.uniforms?.map?.value;
        if (!texture || texture === native.material.uniforms.map.value) throw new Error("skin-texture-not-isolated");
        texture.minFilter = texture.magFilter = LINEAR_TEXTURE_FILTER;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
      }
      custom.mesh.visible = false;
      const pushSkin = (nativeBatch, args) => {
        if (b.failed || nativeBatch !== b.native || !finite(...args.slice(0, 3), args[4], args[5], args[6]))
          return nativeBatch.push(...args);
        try {
          const action = skinPoseForPlayer(player, args[3]);
          const time = Number.isFinite(run.time) ? run.time : args[4];
          const clock = Math.max(0, action === "idle" || action === "walk" ? args[4] : time);
          // One envelope across all frames preserves breathing, leg movement
          // and jump poses without resizing the character every animation step.
          const fit = fitSkinFrameToNative(selected.envelope, nativeBatch.bodyWidth(), nativeBatch.bodyHeight(), args[6], selected.frameSize);
          if (!fit) throw new Error("invalid-native-body-envelope");
          const direction = ((Math.round(args[5]) % 8) + 8) % 8;
          if (direction >= 1 && direction <= 3) b.facingLeft = false;
          else if (direction >= 5 && direction <= 7) b.facingLeft = true;
          const customArgs = args.slice();
          customArgs[3] = action;
          customArgs[4] = clock;
          customArgs[5] = b.facingLeft ? 1 : 0;
          customArgs[15] = false; // Native attack/hurt's normalized clock is not locomotion.
          customArgs[16] = 0; // Mastery palette shaders belong to native art, not an imported PNG.
          const index = custom.count;
          custom.push(...customArgs);
          if (custom.count !== index + 1) throw new Error("skin-instance-not-drawn");
          custom.aSize.array[index * 2] = fit.width;
          custom.aSize.array[index * 2 + 1] = fit.height;
          // Horizontal centering follows camera-right, exactly like the native
          // billboard. Mirroring also mirrors any off-centre opaque bounds.
          const dx = fit.offsetX * (b.facingLeft ? -1 : 1);
          custom.aPos.array[index * 3] = args[0] + dx * (sprites.camRight?.x ?? 1);
          custom.aPos.array[index * 3 + 1] = args[1] + fit.offsetY;
          custom.aPos.array[index * 3 + 2] = args[2] + dx * (sprites.camRight?.z ?? 0);
        } catch {
          // A cosmetic mismatch must render the native player in this same
          // frame, then detach at the next lightweight lifecycle observation.
          custom.count = 0;
          failBinding(b, "皮肤绘制接口变化，已自动恢复游戏原角色外观");
          return nativeBatch.push(...args);
        }
      };
      b.render = function (...args) {
        if (b.failed || binding !== b || this !== player) return b.originalRender.apply(this, args);
        const get = sprites.get;
        let intercepted = false;
        const replacement = function (species, ...rest) {
          const result = get.call(this, species, ...rest);
          if (!intercepted && species === b.spriteKey && result === b.native) {
            intercepted = true;
            const isolated = Object.create(result);
            isolated.push = (...args) => pushSkin(result, args);
            return isolated;
          }
          return result;
        };
        sprites.get = replacement;
        try { return b.originalRender.apply(this, args); }
        finally { if (sprites.get === replacement) sprites.get = get; }
      };
      b.begin = function (...args) { custom.begin(); return b.original.begin.apply(this, args); };
      b.end = function (...args) { const result = b.original.end.apply(this, args); custom.end(); return result; };
      b.clear = function (...args) { release(); return b.original.clear.apply(this, args); };
      binding = b;
      blocked = null;
      player.render = b.render;
      for (const key of ["begin", "end", "clear"]) sprites[key] = b[key];
      publish("active", "皮肤已应用，仅替换本机当前角色外观");
    } catch {
      try { b.batch?.dispose?.(); } catch {}
      blocked = { run, player, sprites, speciesId: player.speciesId, spriteKey };
      publish("unsupported", "当前游戏绘制接口未识别，已保留游戏原角色外观");
    }
  }
  const loadImage = options.loadImage ?? (url => new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { globalThis.clearTimeout(timeout); image.onload = image.onerror = null; };
    const timeout = globalThis.setTimeout(() => { cleanup(); image.src = ""; reject(new Error("image-timeout")); }, 10000);
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("image-invalid")); };
    image.src = url;
  }));
  function measureImage(image, spec) {
    if (image.width !== spec.width || image.height !== spec.height) throw new Error("image-size");
    const width = spec.width, frameSize = spec.frameSize;
    const canvas = document?.createElement?.("canvas");
    if (!canvas) throw new Error("canvas-unavailable");
    canvas.width = canvas.height = width;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas-unavailable");
    try {
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, width).data, bounds = [];
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      let left = frameSize, top = frameSize, right = 0, bottom = 0;
      for (let y = 0; y < frameSize; y++) for (let x = 0; x < frameSize; x++) {
        const alpha = pixels[((row * frameSize + y) * width + column * frameSize + x) * 4 + 3];
        if (alpha > 128) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
      }
      // Artwork quality is advisory, never a rendering safety gate. Opaque or
      // cell-edge artwork is usable; empty frames remain genuinely empty and
      // do not contribute invalid bounds to the shared animation envelope.
      if (right > left && bottom > top) bounds.push({ left, top, right, bottom });
    }
    return bounds;
    } finally {
      // This canvas is only a one-shot CPU measurement, never a renderer
      // texture. Release its 4 MB high-resolution backing immediately.
      canvas.width = canvas.height = 0;
    }
  }
  const api = {
    schemaVersion: 1,
    async setSkin(value) {
      if (disposed) return { ok: false, ...publish("disposed", "皮肤功能已关闭") };
      const parsed = validatePlayerSkinSpec(value);
      if (!parsed.ok) return { ok: false, ...api.getStatus(), reason: parsed.reason };
      const request = ++generation;
      publish("loading", "正在读取皮肤图像");
      try {
        const image = await loadImage(parsed.pngDataUrl);
        if (request !== generation || disposed) return { ok: false, superseded: true };
        const bounds = measureImage(image, parsed), frameSize = parsed.frameSize, envelope = bounds.length ? bounds.reduce((result, entry) => ({
          left: Math.min(result.left, entry.left), top: Math.min(result.top, entry.top),
          right: Math.max(result.right, entry.right), bottom: Math.max(result.bottom, entry.bottom),
        }), { left: frameSize, top: frameSize, right: 0, bottom: 0 }) : { left: 0, top: 0, right: frameSize, bottom: frameSize };
        release();
        selected = { id: parsed.id, name: parsed.name, image, envelope, width: parsed.width, height: parsed.height, frameSize };
        blocked = null;
        publish("waiting", "皮肤已选择，进入对局后自动应用");
        tick();
        return { ok: true, ...api.getStatus() };
      } catch {
        if (request !== generation || disposed) return { ok: false, superseded: true };
        publish(binding ? "active" : selected ? "waiting" : "disabled", selected ? "新图像校验失败，已保留原先外观" : "皮肤图像校验失败，已保留游戏原角色外观");
        return { ok: false, ...api.getStatus(), reason: "皮肤图像无法安全读取；请重新导入可正常解码的 PNG 图片" };
      }
    },
    clearSkin() { generation++; release(); selected = null; blocked = null; return { ok: true, ...publish("disabled", "使用游戏原角色外观") }; },
    getStatus() { return { ...status }; },
    dispose() { generation++; disposed = true; if (timer !== null) cancelInterval?.(timer); timer = null; release(); selected = null; blocked = null; publish("disposed", "皮肤功能已关闭"); if (globalThis.__PB_PLAYER_SKINS === api) delete globalThis.__PB_PLAYER_SKINS; },
  };
  globalThis.__PB_PLAYER_SKINS = api;
  if (interval) timer = interval(tick, 250);
  return api;
}

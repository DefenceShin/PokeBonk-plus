import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Offline skin-panel contract checks. Uses an isolated browser and fixture
// images only; never opens the game or reads a player profile.
const repository = fileURLToPath(new URL('../', import.meta.url));
const base = path.resolve(process.argv[2] || path.join(repository, 'artifacts', 'skins-ui-0.15.0'));
await fs.mkdir(base, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://**/*', route => route.abort());
const initializeSkinPanel = () => {
  const atlas = document.createElement('canvas'); atlas.width = atlas.height = 256;
  const ctx = atlas.getContext('2d');
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { ctx.fillStyle = ['#528463','#b68c52','#668dc1','#9a73b6'][y]; ctx.fillRect(x * 64 + 15 + x * 2, y * 64 + 12, 32, 42); }
  const thumb = document.createElement('canvas'); thumb.width = thumb.height = 64; thumb.getContext('2d').drawImage(atlas, 0, 0, 64, 64, 0, 0, 64, 64);
  const thumbnailDataUrl = thumb.toDataURL(); window.__atlas = atlas.toDataURL();
  const high = document.createElement('canvas'); high.width = high.height = 1024;
  const highContext = high.getContext('2d');
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    highContext.fillStyle = ['#528463','#b68c52','#668dc1','#9a73b6'][row]; highContext.fillRect(column * 256 + 50, row * 256 + 40, 156, 192);
    for (let line = 0; line < 35; line++) { highContext.fillStyle = line % 2 ? '#e1f2df' : '#233d2f'; highContext.fillRect(column * 256 + 60 + line * 4, row * 256 + 72, 2, 112); }
  }
  window.__highAtlas = high.toDataURL();
  const highThumb = document.createElement('canvas'); highThumb.width = highThumb.height = 256; highThumb.getContext('2d').drawImage(high, 0, 0, 256, 256, 0, 0, 256, 256); window.__highThumbnail = highThumb.toDataURL();
  const blank = document.createElement('canvas'); blank.width = blank.height = 256; window.__blankAtlas = blank.toDataURL();
  const blankThumb = document.createElement('canvas'); blankThumb.width = blankThumb.height = 64; window.__blankThumbnail = blankThumb.toDataURL(); window.__warningExecuted = false;
  window.__builtinSkins = [{ id: 'skin-0', name: '作者的狗' }, { id: 'skin-1', name: '作者的另一条狗' }, { id: 'skin-2', name: '狗粑粑' }, { id: 'skin-3', name: '狗毛球' }, { id: 'skin-001', name: '皮肤001' }, { id: 'skin-002', name: '皮肤002' }, { id: 'skin-003', name: '皮肤003' }, { id: 'skin-004', name: '皮肤004' }];
  window.__skinState = { skins: Array.from({ length: 29 }, (_, i) => ({ id: window.__builtinSkins[i]?.id || `skin-${i}`, name: window.__builtinSkins[i]?.name || `测试皮肤 ${i}`, builtin: Boolean(window.__builtinSkins[i]), thumbnailDataUrl })), selectedId: null, canRestoreBuiltin: false };
  window.__calls = []; window.__nextImport = 'cancel'; window.__prompt = '完整皮肤生成提示词\n4 × 4 透明 PNG；待机、移动、起跳、下落。';
  window.__holdPreview = false; window.__previewResolvers = []; window.__previewDecodes = 0;
  const NativeImage = window.Image;
  window.Image = function(...args) { const image = new NativeImage(...args), decode = image.decode.bind(image); image.decode = (...values) => { window.__previewDecodes++; return decode(...values); }; return image; };
  window.__state = { running: false, config: {}, game: {}, logs: [], profile: null, prerequisites: { status: 'ready', missing: [] } };
  window.desktop = {
    getState: async () => structuredClone(window.__state),
    getCatalog: async () => ({ characters: [{ id: 1, name: '妙蛙种子', types: ['grass'] }], maps: [{ id: 'forest', name: '青翠森林' }], builds: [] }),
    onState: fn => { window.__push = fn; return () => {}; }, onLog: () => () => {},
    command: async (action, payload = {}) => {
      window.__calls.push({ action, payload });
      const result = () => structuredClone(window.__skinState);
      if (action === 'getSkins') return result();
      if (action === 'getSkinPreview') {
        const preview = { id: payload.id, atlasDataUrl: payload.id === 'warning-empty' ? window.__blankAtlas : payload.id === 'high-resolution' ? window.__highAtlas : window.__atlas, warnings: window.__skinState.skins.find(x => x.id === payload.id)?.warnings || [] };
        return window.__holdPreview ? new Promise(resolve => window.__previewResolvers.push(() => resolve(preview))) : preview;
      }
      if (action === 'getSkinPrompt') return { prompt: window.__prompt };
      if (action === 'copyText') return { ok: true };
      if (action === 'saveSkinPrompt' || action === 'exportSkin') return { cancelled: true };
      if (action === 'importSkin') {
        if (window.__nextImport === 'cancel') return { cancelled: true };
        if (window.__nextImport === 'bad') throw new Error('PNG 数据损坏或无法安全解码。');
        if (window.__nextImport === 'high') {
          const id = 'high-resolution';
          if (!window.__skinState.skins.some(x => x.id === id)) window.__skinState.skins.push({ id, name: '高清细节示例', thumbnailDataUrl: window.__highThumbnail });
          return { ...result(), importedId: id };
        }
        if (['opaque', 'empty'].includes(window.__nextImport)) {
          const kind = window.__nextImport, id = `warning-${kind}`;
          const entry = { id, name: kind === 'opaque' ? '不透明背景示例' : '空白格示例', thumbnailDataUrl: kind === 'empty' ? window.__blankThumbnail : thumbnailDataUrl,
            warnings: ['文件不符合推荐标准，可能不达预期。', kind === 'opaque' ? '背景复杂，可能无法完整分离角色。' : '部分帧为空白，动画效果可能不完整。', '<img src=x onerror="window.__warningExecuted=true">', { unknown: '忽略非文字警告字段' }] };
          if (!window.__skinState.skins.some(x => x.id === id)) window.__skinState.skins.push(entry);
          return { ...result(), importedId: id };
        }
        const entry = { id: 'imported', name: '新皮肤', thumbnailDataUrl };
        if (!window.__skinState.skins.some(x => x.id === entry.id)) window.__skinState.skins.push(entry);
        return { ...result(), importedId: entry.id };
      }
      if (action === 'selectSkin') { window.__skinState.selectedId = payload.id; return result(); }
      if (action === 'renameSkin') { window.__skinState.skins.find(x => x.id === payload.id).name = payload.name; const builtin = window.__builtinSkins.find(x => x.id === payload.id); if (builtin) builtin.name = payload.name; return result(); }
      if (action === 'deleteSkin') {
        if (window.__builtinSkins.some(x => x.id === payload.id)) window.__skinState.canRestoreBuiltin = true;
        window.__skinState.skins = window.__skinState.skins.filter(x => x.id !== payload.id);
        if (window.__skinState.selectedId === payload.id) window.__skinState.selectedId = null;
        return result();
      }
      if (action === 'restoreBuiltinSkins') { for (const builtin of window.__builtinSkins) if (!window.__skinState.skins.some(x => x.id === builtin.id)) window.__skinState.skins.push({ ...builtin, builtin: true, thumbnailDataUrl }); window.__skinState.canRestoreBuiltin = false; return result(); }
      return { ok: true };
    },
  };
};
await page.addInitScript(initializeSkinPanel);
const check = name => checks.push(name);
const calls = action => page.evaluate(action => window.__calls.filter(x => x.action === action), action);
await page.goto(pathToFileURL(path.join(repository, 'client', 'ui', 'index.html')).href);
await page.waitForFunction(() => window.__PB_UI && window.__push);
assert.equal((await calls('getSkins')).length, 0); check('skin-files-not-read-during-game-state-startup');
assert.equal(await page.locator('#tab-account + #tab-skins').count(), 1); check('skins-tab-immediately-after-account');
await page.locator('#tab-skins').click();
await page.waitForFunction(() => document.querySelectorAll('.skin-card').length === 29 && !document.querySelector('#skin-preview-canvas').hidden);
assert.match(await page.locator('#skin-current').textContent(), /游戏原形象/); check('builtin-is-listed-without-auto-enabling');
assert.equal(await page.locator('[data-skin-id="skin-0"] .skin-card-title').textContent(), '作者的狗');
assert.equal(await page.locator('[data-skin-id="skin-1"] .skin-card-title').textContent(), '作者的另一条狗');
assert.equal(await page.locator('[data-skin-id="skin-2"] .skin-card-title').textContent(), '狗粑粑');
assert.equal(await page.locator('[data-skin-id="skin-3"] .skin-card-title').textContent(), '狗毛球');
assert.equal(await page.locator('[data-skin-id="skin-001"] .skin-card-title').textContent(), '皮肤001');
assert.equal(await page.locator('[data-skin-id="skin-002"] .skin-card-title').textContent(), '皮肤002');
assert.equal(await page.locator('[data-skin-id="skin-003"] .skin-card-title').textContent(), '皮肤003');
assert.equal(await page.locator('[data-skin-id="skin-004"] .skin-card-title').textContent(), '皮肤004');
for (const builtin of ['skin-0', 'skin-1', 'skin-2', 'skin-3', 'skin-001', 'skin-002', 'skin-003', 'skin-004']) assert.match(await page.locator(`[data-skin-id="${builtin}"] .skin-card-detail`).textContent(), /内置皮肤/);
assert.equal(await page.locator('.skin-card-detail').filter({hasText:'内置皮肤'}).count(), 8);
check('eight-authorized-skins-are-generic-builtins-listed-with-native-default');
assert.equal(await page.locator('.skin-card img').count(), 29);
assert.match(await page.locator('.skin-generation-note').textContent(), /美术问题只提示效果风险，仍可导入和使用/);
assert.match(await page.locator('#skin-management-note').textContent(), /进入战斗前.*导入、导出/);
assert.match(await page.locator('#skin-ai-tool-note').textContent(), /豆包.*本次样例.*水印/); check('large-multi-row-thumbnail-library');
assert.match(await page.locator('.skin-generation-note').textContent(), /AI 自检仅供参考，无需先通过 AI 自检/); check('ai-self-check-advisory-client-import-decides');
assert.match(await page.locator('#skin-clarity-note').textContent(), /重新导入/); check('clarity-note-explains-original-reimport-and-native-screen-size');
assert.equal(await page.locator('#skin-preview-canvas').evaluate(node => node.width), 64);
assert.equal(await page.locator('#skin-preview-canvas').evaluate(node => getComputedStyle(node).imageRendering), 'pixelated'); check('legacy-preview-keeps-native-64-cell-backing-and-pixel-art-sampling');
await page.locator('[data-skin-id="skin-1"]').click();
await page.waitForFunction(() => document.querySelector('#skin-name').value === '作者的另一条狗');
assert.equal((await calls('selectSkin')).length, 0); check('selection-only-previews-until-explicit-enable');
await page.locator('#skin-use').click(); await page.waitForFunction(() => document.querySelector('#skin-current').textContent.includes('作者的另一条狗'));
assert.equal((await calls('selectSkin')).at(-1).payload.id, 'skin-1'); check('explicit-skin-enable-and-status');
assert.match(await page.locator('#skin-current').textContent(), /等待应用/);
await page.evaluate(() => window.__push({ skinRuntime: { phase: 'active', skinId: 'skin-0' } }));
assert.match(await page.locator('#skin-current').textContent(), /等待应用/); check('another-skin-runtime-active-never-marks-selected-skin-applied');
await page.evaluate(() => window.__push({ skinRuntime: { phase: 'active', skinId: 'skin-1' } }));
assert.equal(await page.locator('#skin-current').textContent(), '当前：作者的另一条狗'); check('matching-lightweight-runtime-push-marks-applied');
await page.evaluate(() => window.__push({ skinRuntime: { phase: 'unsupported', skinId: 'skin-1', reason: '测试：游戏接口变化' } }));
assert.match(await page.locator('#skin-current').textContent(), /原形象/); assert.equal(await page.locator('#skin-current').getAttribute('title'), '测试：游戏接口变化'); check('unsupported-runtime-keeps-native-display-with-reason');
assert.equal(await page.locator('#skin-use').isEnabled(), true); assert.match(await page.locator('#skin-use').textContent(), /重试应用/);
await page.locator('#skin-use').click(); await page.waitForFunction(() => window.__calls.filter(x => x.action === 'selectSkin').length === 2);
assert.equal((await calls('selectSkin')).at(-1).payload.id, 'skin-1'); assert.equal(await page.locator('#skin-use').isEnabled(), true); check('same-skin-unsupported-and-waiting-support-explicit-retry');
await page.evaluate(() => window.__push({ skinRuntime: { phase: 'loading', skinId: 'skin-1' } }));
assert.equal(await page.locator('#skin-use').isEnabled(), false); assert.match(await page.locator('#skin-use').textContent(), /正在应用/);
await page.evaluate(() => window.__push({ skinRuntime: { phase: 'error', skinId: 'skin-1', reason: '图片超时' } })); assert.equal(await page.locator('#skin-use').isEnabled(), true); check('pending-load-disables-repeat-and-timeout-reenables-user-retry');
await page.locator('#skin-preview-action').selectOption('2'); await page.locator('#skin-preview-mirror').check();
await page.locator('#skin-preview-play').click(); assert.equal(await page.locator('#skin-preview-play').getAttribute('aria-pressed'), 'true');
await page.locator('#tab-overview').click(); assert.equal(await page.locator('#skin-preview-play').getAttribute('aria-pressed'), 'false'); check('preview-action-mirror-and-leaving-page-stops-timer');
await page.locator('#tab-skins').click();
const readsBeforePush = (await calls('getSkins')).length, previewsBeforePush = (await calls('getSkinPreview')).length;
await page.evaluate(() => { window.__oldSkinImage = document.querySelector('.skin-card img'); for (let i = 0; i < 100; i++) window.__push({ game: { state: 'play', level: i } }); });
assert.equal(await page.evaluate(() => window.__oldSkinImage === document.querySelector('.skin-card img')), true);
assert.equal((await calls('getSkins')).length, readsBeforePush); assert.equal((await calls('getSkinPreview')).length, previewsBeforePush); check('100-game-pushes-do-not-read-or-recreate-skin-assets');
await page.locator('#skin-import').click(); await page.waitForFunction(() => document.querySelector('#skin-status').textContent.includes('已取消'));
assert.equal(await page.locator('.skin-card').count(), 29); check('import-cancel-preserves-library');
await page.evaluate(() => window.__nextImport = 'bad'); await page.locator('#skin-import').click(); await page.waitForFunction(() => document.querySelector('#skin-status').textContent.includes('无法安全解码')); check('invalid-file-error-is-visible-and-panel-remains-usable');
await page.evaluate(() => window.__nextImport = 'ok'); await page.locator('#skin-import').click(); await page.waitForFunction(() => document.querySelector('#skin-name').value === '新皮肤');
assert.equal((await calls('selectSkin')).length, 2); check('import-previews-new-file-without-silently-enabling');
await page.locator('#skin-name').fill('   '); await page.locator('#skin-rename').click(); assert.equal(await page.locator('#skin-name-error').isVisible(), true); check('empty-name-rejected-locally');
await page.locator('#skin-name').fill('自定义名字'); await page.locator('#skin-name').press('Enter'); await page.waitForFunction(() => document.querySelector('[data-skin-id="imported"]').textContent.includes('自定义名字')); check('rename-submit-enter-updates-card');
await page.locator('#skin-export-format').selectOption('png'); await page.locator('#skin-export').click(); await page.waitForFunction(() => document.querySelector('#skin-status').textContent.includes('已取消'));
assert.equal((await calls('exportSkin')).at(-1).payload.format, 'png'); check('png-export-and-cancel-contract');
await page.locator('#skin-copy-prompt').click(); await page.waitForFunction(() => document.querySelector('#skin-status').textContent.includes('提示词已复制'));
assert.equal((await calls('copyText')).at(-1).payload.text, await page.evaluate(() => window.__prompt)); check('copies-exact-host-prompt-not-a-ui-duplicate');
await page.locator('#skin-save-prompt').click(); await page.waitForFunction(() => document.querySelector('#skin-status').textContent.includes('已取消')); check('save-prompt-cancel-safe');
await page.locator('#skin-delete').click(); assert.equal(await page.locator('#skin-delete-dialog').isVisible(), true); await page.locator('#skin-delete-cancel').click(); assert.equal((await calls('deleteSkin')).length, 0); check('delete-has-explicit-cancelable-confirmation');
await page.locator('#skin-delete').click(); await page.locator('#skin-delete-confirm').click(); await page.waitForFunction(() => !document.querySelector('[data-skin-id="imported"]')); check('confirmed-delete-refreshes-library');
await page.locator('[data-skin-id="skin-1"]').click(); await page.locator('#skin-name').fill('另一条狗 · 我的名字'); await page.locator('#skin-rename').click();
await page.waitForFunction(() => document.querySelector('[data-skin-id="skin-1"] .skin-card-title').textContent === '另一条狗 · 我的名字');
await page.locator('[data-skin-id="skin-0"]').click(); await page.locator('#skin-delete').click(); await page.locator('#skin-delete-confirm').click(); await page.waitForFunction(() => !document.querySelector('#skin-restore-builtin').hidden);
assert.equal(await page.locator('[data-skin-id="skin-1"] .skin-card-title').textContent(), '另一条狗 · 我的名字'); assert.equal(await page.evaluate(() => window.__skinState.selectedId), 'skin-1');
await page.locator('#skin-restore-builtin').click(); await page.waitForFunction(() => !!document.querySelector('[data-skin-id="skin-0"]'));
assert.equal(await page.locator('[data-skin-id="skin-1"] .skin-card-title').textContent(), '另一条狗 · 我的名字'); assert.equal(await page.evaluate(() => window.__skinState.selectedId), 'skin-1'); check('builtin-hide-and-restore');
await page.locator('[data-skin-id="skin-1"]').click(); await page.locator('#skin-delete').click(); await page.locator('#skin-delete-confirm').click(); await page.waitForFunction(() => !document.querySelector('[data-skin-id="skin-1"]'));
assert.equal(await page.locator('[data-skin-id="skin-0"] .skin-card-title').textContent(), '作者的狗'); assert.equal(await page.evaluate(() => window.__skinState.selectedId), null);
await page.locator('#skin-restore-builtin').click(); await page.waitForFunction(() => !!document.querySelector('[data-skin-id="skin-1"]'));
assert.equal(await page.locator('[data-skin-id="skin-1"] .skin-card-title').textContent(), '另一条狗 · 我的名字'); check('both-builtins-rename-hide-restore-independently-with-selection-preserved');
await page.locator('[data-skin-id="skin-0"]').click(); await page.locator('#skin-use').click();
await page.locator('#skin-native').click(); await page.waitForFunction(() => document.querySelector('#skin-current').textContent.includes('游戏原形象'));
assert.equal((await calls('selectSkin')).at(-1).payload.id, null); check('restore-native-passes-null-and-keeps-skins');
await page.locator('#page-skins').evaluate(node => node.scrollTop = 0);
await page.screenshot({ path: `${base}/wide.png`, fullPage: false });
await page.setViewportSize({ width: 520, height: 800 }); await page.screenshot({ path: `${base}/narrow.png`, fullPage: false });
for (const width of [1280, 760, 520, 320]) {
  await page.setViewportSize({ width, height: 800 });
  assert.equal(await page.locator('#page-skins').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, `horizontal overflow at ${width}`);
}
check('responsive-library-no-horizontal-overflow-1280-760-520-320');
const mainBeforeWarnings = await page.locator('#main-action').evaluate(node => ({ disabled: node.disabled, text: node.textContent }));
for (const kind of ['opaque', 'empty']) {
  await page.evaluate(kind => window.__nextImport = kind, kind); await page.locator('#skin-import').click();
  await page.waitForFunction(kind => document.querySelector('#skin-name').value === (kind === 'opaque' ? '不透明背景示例' : '空白格示例') && !document.querySelector('#skin-preview-canvas').hidden, kind);
  assert.equal(await page.locator('#skin-warnings').isVisible(), true); assert.match(await page.locator('#skin-warnings').textContent(), /仍可使用/);
  assert.equal(await page.locator('#skin-warning-details img').count(), 0); assert.match(await page.locator('#skin-warning-details').textContent(), /<img src=x/);
  assert.equal(await page.evaluate(() => window.__warningExecuted), false);
  assert.equal(await page.locator('#skin-use').isEnabled(), true); assert.equal(await page.locator('#skin-preview-play').isEnabled(), true);
  await page.locator('#skin-use').click(); assert.equal((await calls('selectSkin')).at(-1).payload.id, `warning-${kind}`);
  await page.locator('#skin-preview-play').click(); assert.equal(await page.locator('#skin-preview-play').getAttribute('aria-pressed'), 'true'); await page.locator('#skin-preview-play').click();
  assert.deepEqual(await page.locator('#main-action').evaluate(node => ({ disabled: node.disabled, text: node.textContent })), mainBeforeWarnings);
}
check('opaque-and-empty-art-warnings-remain-importable-usable-playable');
check('warning-strings-use-text-only-and-ignore-unknown-object-fields');
check('art-warnings-never-change-main-game-control-availability');
assert.equal(await page.locator('#page-skins').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
await page.locator('#skin-warnings').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${base}/warnings-narrow.png`, fullPage: false });
await page.locator('#skin-refresh').click(); await page.waitForFunction(() => !document.querySelector('#skin-warnings').hidden);
await page.locator('[data-skin-id="skin-0"]').click(); assert.equal(await page.locator('#skin-warnings').isVisible(), false);
await page.locator('[data-skin-id="warning-empty"]').click(); assert.equal(await page.locator('#skin-warnings').isVisible(), true); check('warnings-survive-refresh-and-stay-scoped-to-their-skin');
await page.evaluate(() => window.__nextImport = 'high'); await page.locator('#skin-import').click();
await page.waitForFunction(() => document.querySelector('#skin-name').value === '高清细节示例' && document.querySelector('#skin-preview-canvas').width === 256);
assert.equal(await page.locator('#skin-preview-canvas').evaluate(node => node.height), 256);
assert.equal(await page.locator('#skin-preview-canvas').evaluate(node => getComputedStyle(node).imageRendering), 'auto');
await page.waitForFunction(() => document.querySelector('[data-skin-id="high-resolution"] img').naturalWidth === 256);
assert.equal(await page.locator('[data-skin-id="high-resolution"] img').evaluate(node => getComputedStyle(node).imageRendering), 'auto');
assert.match(await page.locator('#skin-preview-note').textContent(), /原角色大小/);
await page.locator('#skin-preview-mirror').check(); await page.locator('#skin-preview-action').selectOption('3');
const highPixels = await page.locator('#skin-preview-canvas').evaluate(node => {
  const context = node.getContext('2d'), pixels = context.getImageData(0, 0, node.width, node.height).data;
  return { width: node.width, height: node.height, nonempty: pixels.some((value, index) => index % 4 === 3 && value > 0) };
});
assert.deepEqual(highPixels, { width: 256, height: 256, nonempty: true });
check('high-resolution-preview-keeps-256-cell-backing-and-downsamples-once-with-no-pixelation');
await page.setViewportSize({ width: 1280, height: 800 }); await page.locator('#skin-preview').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${base}/high-resolution.png`, fullPage: false });
for (const [id, name, otherId] of [['skin-001', '皮肤001', 'skin-002'], ['skin-002', '皮肤002', 'skin-001'], ['skin-003', '皮肤003', 'skin-004'], ['skin-004', '皮肤004', 'skin-003']]) {
  await page.locator(`[data-skin-id="${id}"]`).click();
  await page.waitForFunction(name => document.querySelector('#skin-name').value === name, name);
  const otherBefore = await page.locator(`[data-skin-id="${otherId}"] .skin-card-title`).textContent();
  await page.locator('#skin-name').fill(`${name} · 自定名称`); await page.locator('#skin-rename').click();
  await page.waitForFunction(({ id, name }) => document.querySelector(`[data-skin-id="${id}"] .skin-card-title`).textContent === `${name} · 自定名称`, { id, name });
  await page.locator('#skin-use').click();
  assert.equal((await calls('selectSkin')).at(-1).payload.id, id);
  await page.locator('#skin-delete').click(); await page.locator('#skin-delete-confirm').click();
  await page.waitForFunction(id => !document.querySelector(`[data-skin-id="${id}"]`), id);
  assert.equal(await page.evaluate(() => window.__skinState.selectedId), null);
  assert.equal(await page.locator(`[data-skin-id="${otherId}"] .skin-card-title`).textContent(), otherBefore);
  await page.locator('#skin-restore-builtin').click();
  await page.waitForFunction(id => Boolean(document.querySelector(`[data-skin-id="${id}"]`)), id);
  assert.equal(await page.locator(`[data-skin-id="${id}"] .skin-card-title`).textContent(), `${name} · 自定名称`);
  assert.equal(await page.locator(`[data-skin-id="${otherId}"] .skin-card-title`).textContent(), otherBefore);
  assert.equal(await page.evaluate(() => window.__skinState.selectedId), null, 'restoring a hidden builtin must not silently enable it');
}
check('001-through-004-can-independently-preview-rename-use-hide-and-restore-without-changing-the-other');
await page.evaluate(() => { window.__holdPreview = true; window.__previewResolvers = []; });
const previewDecodeBefore = await page.evaluate(() => window.__previewDecodes);
for (const id of ['skin-001', 'skin-002', 'skin-003']) await page.locator(`[data-skin-id="${id}"]`).click();
await page.waitForFunction(() => window.__previewResolvers.length === 3);
await page.evaluate(() => { window.__previewResolvers[0](); window.__previewResolvers[1](); });
await page.waitForTimeout(20);
assert.equal(await page.evaluate(() => window.__previewDecodes), previewDecodeBefore, 'outdated preview replies must not decode images');
await page.evaluate(() => window.__previewResolvers[2]());
await page.waitForFunction(() => !document.querySelector('#skin-preview-canvas').hidden);
assert.equal(await page.evaluate(() => window.__previewDecodes), previewDecodeBefore + 1);
check('superseded-preview-replies-are-discarded-before-image-decoding');
await page.evaluate(() => { window.__previewResolvers = []; });
await page.locator('[data-skin-id="skin-004"]').click();
await page.waitForFunction(() => window.__previewResolvers.length === 1);
await page.locator('#tab-overview').click(); await page.evaluate(() => window.__previewResolvers[0]());
await page.waitForTimeout(20);
assert.equal(await page.evaluate(() => window.__previewDecodes), previewDecodeBefore + 1);
await page.evaluate(() => { window.__holdPreview = false; }); await page.locator('#tab-skins').click();
await page.waitForFunction(() => !document.querySelector('#skin-preview-canvas').hidden);
assert.equal(await page.evaluate(() => window.__previewDecodes), previewDecodeBefore + 2);
check('leaving-page-cancels-pending-preview-and-reentry-can-load-current-selection');
await page.evaluate(() => { window.__skinState.skins = []; window.__skinState.selectedId = null; }); await page.locator('#skin-refresh').click(); await page.waitForFunction(() => !document.querySelector('#skin-empty').hidden); check('empty-library-is-explained');
assert.deepEqual(errors, []); check('no-page-javascript-errors');
// Optional local comparison: use production-normalized before/after PNGs and
// an extracted previous UI source, supplied by the caller. Neither user images
// nor their original paths are embedded in this test or the released client.
const productionNormalizedComparisons = [];
if (process.argv[3] && process.argv[4]) {
  const directory = path.resolve(process.argv[3]), previousUi = path.resolve(process.argv[4]);
  for (const sample of ['03', '04']) {
    const captures = [];
    for (const mode of ['old', 'new']) {
      const png = await fs.readFile(path.join(directory, `sample-${sample}-${mode}.png`));
      const comparison = await context.newPage(); await comparison.setViewportSize({ width: 1280, height: 800 });
      await comparison.addInitScript(initializeSkinPanel);
      await comparison.addInitScript(({ atlas }) => {
        window.__atlas = atlas;
        window.__skinState.skins = [{ id: 'skin-0', name: '皮肤效果对比', thumbnailDataUrl: atlas }];
      }, { atlas: `data:image/png;base64,${png.toString('base64')}` });
      await comparison.goto(pathToFileURL(mode === 'old' ? path.join(previousUi, 'index.html') : path.join(repository, 'client', 'ui', 'index.html')).href);
      await comparison.waitForFunction(() => window.__PB_UI && window.__push);
      await comparison.locator('#tab-skins').click();
      await comparison.waitForFunction(() => !document.querySelector('#skin-preview-canvas').hidden);
      const backing = await comparison.locator('#skin-preview-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height, rendering: getComputedStyle(canvas).imageRendering }));
      assert.equal(backing.width, mode === 'old' ? 64 : 256);
      const output = path.join(base, `sample-${sample}-${mode}-preview.png`);
      await comparison.locator('#skin-preview').screenshot({ path: output });
      captures.push({ mode, backing, normalizedPngSha256: createHash('sha256').update(png).digest('hex'), output, png: (await fs.readFile(output)).toString('base64') });
      await comparison.close();
    }
    const display = await context.newPage(); await display.setViewportSize({ width: 680, height: 240 });
    await display.setContent(`<style>body{margin:0;background:#f5f7f3;color:#284334;font:14px sans-serif;display:flex;gap:20px;padding:20px}section{width:300px}h3{margin:0 0 12px;font-size:14px}img{display:block;width:298px;height:170px}</style>${captures.map(item => `<section><h3>${item.mode === 'old' ? '0.17 · 64 像素单格' : '0.18 · 256 像素单格'}</h3><img src="data:image/png;base64,${item.png}"></section>`).join('')}`);
    await display.screenshot({ path: path.join(base, `sample-${sample}-preview-comparison.png`) });
    await display.close();
    productionNormalizedComparisons.push({ sample, isolatedUiOnly: true, actualGameGpuTested: false, modes: captures.map(({ mode, backing, normalizedPngSha256 }) => ({ mode, backing, normalizedPngSha256 })) });
  }
  check('production-normalized-examples-compared-through-previous-and-current-ui-at-identical-display-size');
}
const report = { passed: true, isolatedMockOnly: true, noGameAccountOrProfileAccess: true, checks, errors, productionNormalizedComparisons };
await fs.writeFile(`${base}/report.json`, JSON.stringify(report, null, 2));
await browser.close(); console.log(JSON.stringify(report, null, 2));

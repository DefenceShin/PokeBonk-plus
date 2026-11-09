# 换设备接手

## 当前工作源码：0.9.22

2026-11-09，0.9.22 适配由 `adapt/game-0922-20261109` 合入 main，源于 `55127b6e31a891bd63ed9d3efccf88e450918afa`。本次同步源码、文档与公开验证材料；未打包、安装或发布二进制 Release。编译仅验证，不启动安装版、个人浏览器或真实账号。

- 公开输入：`evidence/public-0922/manifest.json`（10 文件）；当前八份数据 JSON：`evidence/public-0922/data/manifest.json`，逐文件哈希与旧数据相同。
- 游戏 0.9.22 / `mw88813m`；原生主模块 `main-BDr6DT_c-mw88813m.js`，SHA-256 `adc878dea06ec3e1a5ae47bdf91a6ed27aca07fa8c9c3a0076f6250462c4db6b`。
- 原文方法对照：`docs/native-0922-method-audit.json`。行为变化及边界：[LOCAL-CHANGES.md](../LOCAL-CHANGES.md)。旧 0.9.13 输入、测试及 SOURCE-MANIFEST 不覆盖。
- 当前原生目录：`evidence/public-0922/native-catalogs.json`；完整挑战表达式阈值对照与说明变化：`challenge-table-proof.json`。
- 一键复跑：在仓库根目录 `node tools/validate-current.mjs`。日志和逐命令退出码：`validation/0922/`。依赖仅本仓库、Node/npm、.NET 8 与标准位置 Edge；162 场景对照所需的最小 2.0.0+ 源码依赖已冻结于 `evidence/personal-2000/`，无需旧工作目录。
- 重点证据：`evidence/rift-0922-success-{free,full}-result.json`、`rift-0922-timeout-result.json`；`source/test/season3-0922-hooh-observation.test.mjs`；`evidence/0922-skins-cycle.json`、`0922-skins-capture.json`、`shiny-sources-0922.json`；`ui-0922-skins-{1280,960}.png`；编译宿主逐资源指纹 `embedded-0922.json`。

当前仍关闭每日变异两个缺失定义，其他灰色模式按原门禁；`dojo`/`exp` 的世界与 UI 入口在旧版已存在，继续显式待核对。三圣兽专属追踪、真实服务器保存、完整随机整局和人工设备体验不在本轮隔离验收结论内。

下文保留旧基线及当时接手线索，仅作历史。

## 历史固定基线

- 游戏：0.9.13，build `mw41iu0i`。
- 主游戏模块：`main-DvcmQ3kt-mw41iu0i.js`。
- 主模块 SHA-256：`9f218e37d1d085836ad2809efc3c239121f1dd89ea163018c811eb52c0d23785`。
- 规则模块：`defineProperty-DQhFTHiA-mw41iu0i.js`，SHA-256 `34fb165deeacbf37a97c2dcf729a1c71ba559a8d51a735497933efd915bccc97`。
- 全部公开输入指纹：`evidence/public-0913/manifest.json` 与 `data/manifest.json`。

本仓库取自开始 0.9.14 改动之前的源码快照。0.9.14 的接口补丁、素材和新增测试均未混入；下方仅保留接手线索。

## 历史下一步：0.9.14

2026-11-06 线上公开版本切换为 0.9.14 / `mw4qh5au`。初检结果：

1. 旧 `rageBonus` 方法指纹没有匹配到新版伤害倍率收集器，应按真实新方法核验，不能仅修改版本号。
2. 新地图合同中 18 个方法的签名改变，导致 canela、cave、encina、iris 被关闭；原四张地图和裂隙门禁仍开放。初步 AST 对照显示，大部分是混淆命名变化；Iris 三圣兽离场提示还把显示名称改成从物种数据读取。
3. Ho-Oh 观测注入的调色板符号与 `tick` 签名改变，旧注入无法完整建立观测，应重新验证原生回调、伤害和观察 getter 无副作用。
4. 当时下载的八份公开数据 JSON 与 0.9.13 一致。这不证明所有游戏逻辑一致；须重新获取并核对最新脚本。

建议先重跑本仓库基线，再单独建分支处理 0.9.14。核对接口、地图合同、外观挑战和异色来源后，重新跑数量目标、结算失败、领奖及下一角色循环。不要仅放开门禁或沿用旧通过日志。

## 刷皮肤改动入口

- `source/src/compatibility.mjs`：恢复三项皮肤模式，数量型无尽仅限 appearance / wardrobe。
- `source/src/unlock-goals.mjs`：新增数量指标、原生地图位图计数、传说外观条件及达标投影。
- `source/src/objectives.mjs`：感电策略、衣柜目标及传说外观调度。
- `source/src/pilot.mjs`：实时和开局模式边界；结算、保存及领奖使用既有原生流程。
- `source/data/unlock-catalog.json` / `shiny-catalog.json`：276 项专属挑战、33 项传说挑战、当前异色来源及外观系列。
- `source/client/PokeBonk.Client/MainWindow.cs`、`source/client/ui/app.js`：外观选项传递。

可复现的旧问题包括：数量目标所需无尽模式被维护门禁阻止；新版恢复生命、感电、终极技能等指标未覆盖；旧外观目录只覆盖旧关都集合。缺少用户当时的精灵名称和战报，不能据此认定历史停机的唯一原因。

“第一个成就”并不总是 30000 次异常：例如杰尼龟是浸湿 20000 次，菊草叶是恢复生命 30000，灯笼鱼是感电 10000，时拉比是释放终极技能 100 次。条件以原生目录为准。

## 保持的边界

- 先核对新设备依赖、源码和实际运行 EXE 指纹；本仓库没有新的已安装程序。
- 不修改账号、私人方案、存档或正在运行的对局。
- 四个局外许可默认关闭，缺字段也关闭，保留明确保存的布尔值。
- 紫苑塔经验偏好不改变原方案招式、融合材料/顺序、放逐及维生素留槽。
- 自动化检查通过与真实账号整局验收分别记录。
- 不把静态道具 priority 称为动态最优，也不恢复被明确拒绝的强制排序逻辑。

## 旧测试素材

`evidence/current-public/` 名称沿用早期回归输入目录，实际版本由其 manifest 决定，并不表示当前线上版本。`source/research/` 同样是固定历史输入。普通 `npm test` 所需素材已包含；部分历史手工 UI 检查仍引用旧分析目录，可按需要迁移，不应当作当前刷皮肤的验收入口。

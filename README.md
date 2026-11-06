# PokeBonk+

PokéBonk 桌面助手的个人维护源码，供跨设备继续开发。当前提交固定在**游戏 0.9.13（build `mw41iu0i`）**，包含第三赛季基础游玩、角色解锁及刷皮肤恢复。

**0.9.14 尚未合入本仓库。** 线上游戏已更新；本仓库的离线验证结果不能视为 0.9.14 已适配。接手顺序见 [HANDOFF.md](docs/HANDOFF.md)。本次仅发布源码，没有生成新的 EXE 或发布包。

## 当前内容

- 第三赛季目录、通用配招、进化、融合、八张常规地图及裂隙相关适配。
- 角色解锁的条件规划、捕获和保存确认；三圣兽专属追踪仍需手动。
- 恢复“刷异色”“解锁外观”“解锁更衣室”；关都、城都 276 项专属外观挑战及 33 项传说外观条件。
- 适用的数量挑战可选无尽模式，达标后通过原生结算流程提交，保存成功后再领奖、切换目标。需要胜利或指定地图的条件仍按原生规则处理。
- 自动升级实验室、自动解锁道具、自动领取奖励、优先攒出第四招默认关闭；连续自动领奖需要用户自行开启对应开关。

新角色使用通用策略或用户自定义方案，尚无逐只优化的城都专属配招库。未逐角色完成真实账号整局验证；活动、宝藏及未核实来源保持各自限制。

## Windows 开发环境

- Node.js 24（本次验证为 24.16.0）
- .NET 8 SDK，Windows x64
- Microsoft Edge 与 WebView2 Runtime

```powershell
git clone https://github.com/DefenceShin/PokeBonk-plus.git
cd PokeBonk-plus/source
npm ci
npm test
dotnet build "client/PokeBonk Pilot.csproj" -c Release -r win-x64
```

编译产物在 `source/client/bin/Release/net8.0-windows/win-x64/`。本仓库包含宿主所需资源及 WebView2 引用 DLL；构建不等于已安装或通过实战验收。保留的程序集版本号来自维护基线，游戏适配版本以本说明和 [验证记录](docs/VALIDATION.md) 为准。

## 隔离运行验证

在 `source/` 执行：

```powershell
node test/season3-skins-runtime.mjs
node test/season3-skins-cycle-runtime.mjs
node test/season3-skins-capture-runtime.mjs
node test/season3-skins-ui.mjs
```

这些测试加载 `evidence/` 中固定的公开游戏脚本，在独立浏览器目录运行，拦截外部请求；服务器回执和部分渲染边界由测试环境提供。默认使用 Windows 标准安装位置的 Edge，其他位置需要调整测试入口的 `executablePath`。测试不应接入个人浏览器、真实账号或活局。

在仓库根目录可运行宿主检查：

```powershell
dotnet run --project host-checks -- "$PWD"
```

## 目录

| 路径 | 内容 |
|---|---|
| `source/src/` | 控制器、决策、原生接口适配 |
| `source/client/` | WPF / WebView2 宿主与界面 |
| `source/data/` | 内置目录、来源数据与控制器注册表 |
| `source/test/` | 单元回归与隔离原生运行测试 |
| `source/research/` | 历史公开原生脚本和回归输入 |
| `evidence/` | 固定的 0.9.13 及历史公开测试素材 |
| `host-checks/` | 编译后宿主默认值、门禁和资源检查 |
| `docs/` | 交接与验证记录 |

根目录的 `inspect-*`、`audit-skins.mjs` 和 `update-*-catalog.mjs` 是维护脚本。重建外观目录时先执行审计，再依次执行 `update-skin-catalog.mjs`、`update-shiny-catalog.mjs`、`update-legendary-catalog.mjs`；顺序不可交换。

仓库不包含账号、登录状态、个人存档、私人方案、战报、浏览器数据或本机安装程序。后续提交前继续检查这些边界。

游戏来源：[pokebonk.com](https://pokebonk.com/)。公开游戏脚本保留原始来源与哈希，作为适配和回归输入；本项目不是游戏官方仓库。

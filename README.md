# GameSir G7 Pro 背键 → 虚拟 Xbox

[简体中文](./README.md) | [English](./README.en.md)

本项目让 GameSir G7 Pro 的四个背键执行可配置的标准 Xbox/XInput 动作，同时让游戏只看到一只虚拟 Xbox 手柄。

```text
GameSir Nexus（背键输出 F9-F12）
  → AutoHotkey（合并实体输入与背键动作）
  → vJoy Device 1
  → XOutput
  → 虚拟 Xbox/XInput 手柄
```

## 为什么采用这套方案

Steam 对裸 vJoy 的 DirectInput 绑定体验不稳定，而 XInput 不能额外暴露四个独立背键。本项目因此把背键转换为 A/B/X/Y、十字键、肩键、Start/Back 等标准 Xbox 输入，并通过 HidHide 避免游戏同时识别实体与虚拟两只手柄。

当前不支持震动回传。实体 Home/西瓜键也尚未验证，不作为安装成功条件。

## 使用要求

- Windows 与 GameSir G7 Pro。
- GameSir Nexus：将 P1/P2/P3/P4 设置为 `F9`/`F10`/`F11`/`F12`。
- Node.js：需能在命令行执行 `node --version`。
- AutoHotkey v2 x64：日常必须使用 HidHide 白名单中的 `AutoHotkey64.exe`。
- vJoy 2.1.9.1：Device 1 使用 18 个按钮、6 个轴和 1 个 POV。
- ViGEmBus、HidHide、XOutput。
- XOutput 的 Controller 必须只读取 `vJoy Device`，不能混用 Keyboard 或实体 GameSir。

驱动和第三方工具不随仓库分发。首次安装、精确配置和验收步骤全部见 [运行手册](./gamesir_virtual_xbox_runbook.md)。不要复制其他电脑的 HidHide 设备实例路径。

## 日常使用

1. 连接 GameSir，双击 [start_gamesir_virtual_xbox.cmd](./start_gamesir_virtual_xbox.cmd)。
2. 首次默认会打开配置中心。右上角取消“每次启动时打开配置中心”后，后续启动不会打开网页；需要时可在启动器窗口按 `Ctrl+I`。
3. 在 XOutput 的 `Game Controllers` 中确认目标 Controller 按钮显示 `Stop`。仅有 XOutput 进程不代表虚拟 Xbox 已开始输出。
4. 结束游戏后在启动器窗口按 `Ctrl+Z`，或运行 [stop_gamesir_virtual_xbox.cmd](./stop_gamesir_virtual_xbox.cmd)。

配置中心默认仅监听 `http://127.0.0.1:3780`，不提供局域网或远程访问。

配置中心可在右上角切换中文/English。启动器和停止器默认使用中文；在启动前设置 `$env:GAMESIR_LANG = 'en'` 可使用英文控制台语料。

## 文件与目录

| 文件或目录 | 作用 |
| --- | --- |
| `start_gamesir_virtual_xbox.cmd` / `.ps1` | 启动或复用本会话的配置服务、AHK 和 XOutput，并开启 HidHide cloak。 |
| `stop_gamesir_virtual_xbox.cmd` / `.ps1` | 只停止本会话拥有的组件，再安全关闭 cloak。 |
| `gamesir_merge_vjoy_f9_f12.ahk` | AHK v2 输入合并、背键动作和宏执行器。 |
| `app/server/` | 本地配置、状态、生命周期和 WebSocket 服务。 |
| `app/web/` | 浏览器配置中心。 |
| `runtime/` | 本机首次运行时生成的配置、状态、日志与备份；不应提交到 Git。 |
| `gamesir_virtual_xbox_runbook.md` | 面向用户和 Agent 的完整配置、验收与排障手册。 |
| `AGENTS.md` | Agent 修改本项目时必须遵守的实现边界。 |

## 路径自动发现

启动器从 `PATH` 查找 Node.js，并尝试常见的 AHK、vJoy、XOutput 和 HidHide 路径。自动发现失败时，在同一个 PowerShell 窗口设置：

```powershell
$env:GAMESIR_AHK_EXE = 'C:\path\to\AutoHotkey64.exe'
$env:GAMESIR_VJOY_DLL = 'C:\Program Files\vJoy\x64\vJoyInterface.dll'
$env:GAMESIR_XOUTPUT_EXE = 'C:\path\to\XOutput.exe'
$env:GAMESIR_HIDHIDE_CLI = 'C:\path\to\HidHideCLI.exe'
.\start_gamesir_virtual_xbox.cmd
```

不要把本机绝对路径或 XOutput 的用户配置提交到仓库。

## 开发验证

本项目没有 npm 第三方依赖：

```powershell
node --test app/server/*.test.mjs
```

修改映射、启动、vJoy、XOutput 或 HidHide 链路前，必须先阅读 [AGENTS.md](./AGENTS.md) 和完整运行手册。

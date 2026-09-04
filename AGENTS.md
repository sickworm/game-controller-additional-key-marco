# AGENTS.md

## 项目目标

本文是 Agent 进入本项目时的首要实现边界。面向用户的背景、要求与文件说明见 `README.md`；任何首次配置、人工验收或排障操作必须完整阅读 `gamesir_virtual_xbox_runbook.md`，不得仅根据本文摘要操作设备链路。

本项目为 GameSir G7 Pro 的四个背键提供可配置的虚拟 Xbox/XInput 动作。现有稳定链路如下：

```text
GameSir Nexus（背键固定输出 F9-F12）
  -> AutoHotkey（读取、合并、执行动作）
  -> vJoy Device 1
  -> XOutput
  -> 虚拟 Xbox/XInput 手柄
```

HidHide 将真实 GameSir 对普通程序隐藏；仅列入白名单的 AHK 和管理工具可读取真实设备。XOutput 保持不在白名单，只读取未隐藏的 vJoy。不要在未经用户确认的情况下关闭 HidHide、卸载驱动或调整设备隐藏规则。

## 当前用户选择：虚拟 Xbox/XInput 模式

用户已确认恢复日常链路 `GameSir -> AHK -> vJoy Device 1 -> XOutput -> 虚拟 Xbox/XInput`。Steam 对裸 vJoy 的 DirectInput 绑定体验不可靠，日常不得再以 vJoy DirectInput 作为输出目标。

- `start_gamesir_virtual_xbox.cmd` 必须启动或复用 AHK 和 XOutput；`stop_gamesir_virtual_xbox.cmd` 必须只关闭本会话拥有的 AHK 与 XOutput，再关闭 cloak 以恢复原生 GameSir。
- AHK 已验证读取实体 GameSir，并将普通输入及 F9-F12 背键动作写入 vJoy Device 1。vJoy Device 1 当前启用 18 个按钮、6 个轴和 1 个 Continuous POV。
- 背键默认写入 vJoy 的 POV：P1/P2/P3/P4 分别为上/下/左/右。`JoyMonitor` 已人工验证四个背键的 POV 输出。
- 已验证完整链路中的摇杆、标准按钮与背键可由 AHK 合并后写入 vJoy，再由 XOutput 输出。AHK 必须按 vJoy 实际轴范围转换 XInput 值，并在此边界反转左右摇杆 Y 轴；不要在 XOutput 的 LY/RY 上再使用 `Invert`。
- vJoy 标准按钮编号只能由 `gamesir_merge_vjoy_f9_f12.ahk` 的唯一 `VJOY_BUTTON` 表维护；实体 XInput 转发与配置中心动作必须共同引用它。不得新增彼此独立的“实体输入编号表”和“宏动作编号表”。
- 实体 Home/西瓜键尚未验证能通过 XInput 写入 vJoy；它当前不是验收通过条件，也不得据此声称 `Home -> Button 15` 已可用。
- 当前 HidHide cloak 开启；仅 AHK、HidHide CLI、HidHide Client 在白名单。XOutput 不在白名单，因此 XOutput 只能看到未隐藏的 vJoy，不能直接看到实体 GameSir。GameSir 的同一物理容器 `USB\VID_3537&PID_100A\00655D1441` 已登记 `IG_00` 至 `IG_04` 五个 HID 游戏接口，以及 XInput/XNA Composite 接口 `USB\VID_3537&PID_100A&MI_00\6&291A8F80&0&0000`。不要隐藏 `MI_01` 的键盘、鼠标或消费者控制接口，GameSir Nexus 的 F9-F12 输出依赖它们。

### 当前 TODO

1. 完全退出并重开 Steam、必要时重连 GameSir，确认 Steam/`joy.cpl` 不再显示 GameSir 的物理接口，仅显示 XOutput 创建的虚拟 Xbox；不得仅凭旧缓存的 Steam 列表判断失败。
2. 若物理接口仍出现，重新用 `HidHideCLI --dev-gaming` 枚举实际存在项，并核对 Xbox Composite / XNA Composite 的 HidHide 类过滤器；不得猜测或隐藏无关 `MI_*` 接口。
3. 当前不支持震动回传。若用户要求，新增独立的 Force Feedback 转发器：vJoy FFB callback -> 将效果降级为 XInput 左/右马达 -> `XInputSetState` 写回实体 GameSir。
4. 对新电脑或 XOutput 配置丢失的情况，复核 vJoy-only 基础映射：所有标准输入和 POV 均只能学习 `vJoy Device`；不要混用 Keyboard F9-F12 或实体 GameSir。
5. 如用户需要 Home/西瓜键，单独诊断其是否被 GameSir 以 XInput Guide 位或另一 HID 接口上报；当前不可假定为 vJoy Button 15。

## 必读文档与操作边界

- 修改启动、停止、AHK、vJoy、XOutput、HidHide 或背键识别链路前，必须先完整阅读 `gamesir_virtual_xbox_runbook.md`。
- `AGENTS.md` 规定实现边界；运行手册记录已验证的首次配置、日常操作和人工验收。二者冲突时，先停止可能影响驱动或手柄可见性的操作，并向用户说明。
- 不得声称“XOutput 已输出虚拟 Xbox”仅因 `XOutput.exe` 进程存在；只有 XOutput 的 `Game Controllers` 区域中目标 `Controller` 按钮显示 `Stop`，才表示输出已启动。
- HidHide 驱动服务本身不是日常启停对象。当前已确认的模式切换是：进入虚拟模式前开启 cloak；安全关闭本项目拥有的 AHK/XOutput 后关闭 cloak，以恢复原生 GameSir。不得修改白名单或隐藏设备规则，除非用户再次明确授权。

## 首次配置与人工验收

首次安装或更换电脑时，不能假定仅运行启动器即可完成手柄配置。按以下顺序执行，并把未完成项明确报告为阻断项：

1. 安装并确认 AutoHotkey v2、vJoy Device 1、ViGEmBus、HidHide、XOutput 和 GameSir Nexus；不得用 Node 原生驱动替换该链路。
   - vJoy Device 1 必须启用至少 14 个按钮、6 个轴（X/Y/Z/Rx/Ry/Rz）和 **1 个 POV**（Continuous 或 Discrete 均可）；背键的默认十字键动作依赖该 POV。
2. 在 GameSir Nexus 中将四个背键配置为 `F9`、`F10`、`F11`、`F12`。
3. 在 HidHide 中隐藏真实 GameSir；将 `D:\AutoHotkey\v2\AutoHotkey64.exe` 加入白名单，XOutput 不加入白名单。首次配置应由用户确认，后续脚本不得重写这些规则。
4. 在 XOutput 中确认存在 `vJoy Device`，并在 `Game Controllers` 中添加或载入保存的 `Controller`。启动虚拟 Xbox 时点击该 `Controller` 右侧的 `Start`；变为 `Stop` 才通过。保存 XOutput 配置，但不要覆盖已有用户配置。
5. 启动本项目后，在配置中心选择实际连接到**实体** GameSir 的 XInput 槽位。不可假定为 `XInput #0`，也不可选择 XOutput 创建的虚拟槽位；设备重连后槽位可能改变。修改后重新执行“检查环境”。
6. 对 P1-P4 逐项操作：先点击“验证背键 N”，页面显示等待后再按对应实体背键；应分别收到 `F9`、`F10`、`F11`、`F12`。按错 F 键应继续等待正确键，20 秒未收到正确键必须明确显示超时。
7. 在 XOutput 中确认 `Start -> Stop` 后，即在游戏或手柄测试工具中确认只看到一只虚拟手柄；不要要求用户回到页面进行无实际作用的二次确认。

首次配置失败时，优先报告具体状态和下一步，例如“实体 GameSir 的 XInput #0 未连接，请选择正确实体槽位”；不要建议用户直接关闭 HidHide 来排障。

## XOutput 映射约束（当前虚拟模式）

当前方案中，XOutput 的 `Controller` 必须以 **vJoy Device 1** 作为唯一输入来源：AHK 已将实体 GameSir 的完整输入和背键动作合并后写入 vJoy，再由 XOutput 输出虚拟 Xbox。

- `Controller` 中的左/右摇杆、扳机、标准按钮和十字键都必须捕获为 `vJoy Device` 输入；十字键应读取 vJoy 的 POV / hat 四个方向。
- 不得将 `F9`、`F10`、`F11`、`F12` 直接映射为 XOutput 的 Keyboard 输入，也不得把实体 GameSir 与 vJoy 混在同一个 `Controller` 中。这是旧的直连键盘方案；AHK 接管 F 键后，它会造成背键看似配置存在却没有进入虚拟 Xbox 的问题。
- 修改 `Controller` 前先停止它（按钮显示 `Start`），逐项在 `Configure` 中确认捕获标签为 `vJoy Device`，保存配置后再 `Start -> Stop`。不得通过直接覆盖 `settings.json` 改写用户的既有 XOutput 配置。
- 配置中心会将有效的 vJoy-only XOutput 配置备份到 `runtime/xoutput-backups/`，并识别 Keyboard/Mouse 或不完整映射回退。日常启动只能报告问题，不能自动覆盖 `settings.json`；只有用户在页面明确点击恢复、且本项目 XOutput 已退出时，才可从已验证备份恢复，并必须先隔离当前文件。
- 验收时同时测试实体摇杆/按钮和四个背键：XOutput 右侧 XInput 预览均应变化；`Controller` 显示 `Stop` 后，游戏或手柄测试工具应只看到一只虚拟 Xbox 手柄。

## 当前文件

- `gamesir_merge_vjoy_f9_f12.ahk`：现有 AHK v2 合并脚本。
- `start_gamesir_virtual_xbox.cmd`：启动 AHK 与 XOutput 的日常启动器。
- `gamesir_virtual_xbox_runbook.md`：已验证的安装、运行和排障记录。
- `runtime/xoutput-backups/`：配置中心生成的已验证 XOutput 配置备份；不是 XOutput 日常运行所需文件。
- `README.md`：新用户的安装入口、路径配置与首次验收清单。

## 后续实现方向

新增 Node.js 本地服务和浏览器配置页，默认仅监听 `127.0.0.1`，端口可配置，建议默认 `3780`。不在首版使用 Electron。

职责划分：

- Node.js：配置档、JSON 持久化、本地 HTTP API、启动和重载执行器。
- 浏览器界面：编辑四个背键的单击、按住、连发、宏和配置档。
- AHK：低延迟监听 `F9-F12`，读取当前配置并执行虚拟手柄动作。
- vJoy、XOutput、HidHide：保持已验证的设备链路，不迁移到 Node 原生驱动实现。

## 实时更新约定

配置页面必须支持实时反映执行器状态与配置变更：

1. Node 服务向浏览器提供 WebSocket；若实现受限，使用 SSE。不要用高频轮询作为主要更新方式。
2. 配置保存采用原子写入：先写入同目录临时文件，再替换正式 JSON，避免 AHK 读取到半份配置。
3. 每份配置保存后递增 `revision`；Node 将新 revision 推送给浏览器，并通知 AHK 重新加载。
4. AHK 只在一次按键动作完成后的安全点加载新 revision。连发或宏运行时，不得混用新旧配置；默认让当前动作结束后切换。
5. 页面显示至少四类状态：服务状态、AHK 状态、XOutput 状态、当前配置档与 revision。
6. WebSocket 和 HTTP 只绑定 `127.0.0.1`，不提供局域网访问、远程控制或认证绕过。

## 配置模型

背键物理输入固定为 `F9`、`F10`、`F11`、`F12`。每个按键可配置为：

- 单次标准 Xbox 输入，例如 A/B/X/Y、十字键、LB/RB、Start/Back。
- 按住输出，松开时释放。
- 连发，包含首次延迟、间隔、固定次数或按住持续等参数。
- 结构化宏，由 `press`、`release`、`wait` 步骤构成，延时单位毫秒。

XInput 不支持向游戏暴露四个额外独立背键；所有目标动作必须映射到标准 Xbox/XInput 输入。

## Windows 实现约束

- 优先使用 Windows PowerShell 和 `apply_patch` 编辑文件。
- AHK 脚本必须兼容 AutoHotkey v2。日常启动必须使用已在 HidHide 白名单中的 `D:\AutoHotkey\v2\AutoHotkey64.exe`；不要改为未白名单的 `AutoHotkey.exe`，否则 AHK 只能读取键盘而不能读取被 cloak 的实体 GameSir。
- 含中文的 PowerShell 脚本须保存为 UTF-8 with BOM，避免 Windows PowerShell 5 解析错误。
- 所有路径使用显式绝对路径或基于项目根目录的可靠解析；启动器不得依赖当前工作目录。
- 不要删除用户的游戏配置、驱动或已有 XOutput 配置。

## 验证标准

每次改动映射执行链路后，至少验证：

1. F9-F12 均能被 AHK 读取。
2. XOutput 成功启动虚拟 Xbox 输出。
3. HidHide 启用后，游戏仅看到虚拟手柄。
4. 新配置在浏览器保存后，页面、Node 服务和 AHK 的 revision 一致。
5. 连发、宏停止或配置切换后，没有残留的虚拟按键按下状态。

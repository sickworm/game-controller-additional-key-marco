# GameSir G7 Pro 背键转虚拟 Xbox 手柄运行手册

## 方案目标

> 当前用户选择为虚拟 Xbox/XInput 模式：日常运行会启动 XOutput，游戏目标设备是它创建的虚拟 Xbox 控制器。vJoy 只作为 AHK 的中间输入设备。

本方案让游戏只识别一只虚拟 Xbox/XInput 手柄。GameSir 的 4 个背键当前映射为虚拟手柄的十字键：

| GameSir Nexus 背键输出 | 虚拟 Xbox 输出 |
| --- | --- |
| F9 | 十字键上 |
| F10 | 十字键下 |
| F11 | 十字键左 |
| F12 | 十字键右 |

实体十字键仍然有效。实体十字键与背键十字键会被合并为同一组虚拟手柄输入。

## 组件分工

1. **GameSir Nexus**：把四个背键指定为 `F9`、`F10`、`F11`、`F12`。
2. **AHK 合并脚本**：读取真实 GameSir 的全部手柄输入和 `F9-F12`，写入一只 vJoy 设备。
3. **vJoy Device 1**：承载合并后的 DirectInput 输入。
4. **XOutput**：将 vJoy Device 1 转换为虚拟 Xbox 360/XInput 手柄。
5. **HidHide**：将真实 GameSir 对普通程序隐藏，避免游戏同时识别真实和虚拟两只手柄。

## vJoy Device 1 必要配置

在 `C:\Program Files\vJoy\x64\vJoyConfig.exe` 中选择 Device 1，并确保启用当前已验证的：6 个轴（X、Y、Z、Rx、Ry、Rz）、18 个按钮，以及 **1 个 Continuous POV**。四个背键默认映射为十字键，AHK 使用该 POV 写入十字键方向；若 POV 为 0，背键会被 AHK 接收但不会出现在 vJoy 或游戏中。

AHK 会根据 vJoy 设备实际的轴范围转换 XInput 摇杆值，并在写入 vJoy 时反转左右摇杆的 Y 轴。不要在 XOutput 的 `LY` 或 `RY` 额外点击 `Invert`；当前方向已在 JoyMonitor 和游戏中验证正确。

## 工具路径与跨电脑配置

启动器会从 `PATH` 查找 Node.js；AHK、vJoy、XOutput 和 HidHide 会依次尝试常见安装位置。下面是本机已验证的位置，仅作示例，**不能假定其他电脑相同**：

| 项目 | 本机示例路径 |
| --- | --- |
| AutoHotkey v2（启动器使用） | `D:\AutoHotkey\v2\AutoHotkey64.exe` |
| AHK 合并脚本 | `D:\GitHub\game-controller-additional-key-marco\gamesir_merge_vjoy_f9_f12.ahk` |
| vJoy DLL | `C:\Program Files\vJoy\x64\vJoyInterface.dll` |
| XOutput | `D:\codex_workspace\tools\XOutput-3.32\XOutput.exe` |
| HidHide 命令行工具 | `D:\HidHide\x64\HidHideCLI.exe` |
| 日常启动器 | `D:\GitHub\game-controller-additional-key-marco\start_gamesir_virtual_xbox.cmd` |

若自动发现失败，可在启动器所在 PowerShell 窗口设置 `GAMESIR_AHK_EXE`、`GAMESIR_VJOY_DLL`、`GAMESIR_XOUTPUT_EXE`、`GAMESIR_HIDHIDE_CLI` 后再运行启动器。变量名称、示例和首次配置顺序见仓库根目录 `README.md`。

## 日常开启方法

1. 连接或开启 GameSir 手柄。
2. 双击运行 `D:\GitHub\game-controller-additional-key-marco\start_gamesir_virtual_xbox.cmd`。
3. 启动器会先开启 HidHide 的 cloak，再自动启动 AHK、XOutput，并执行“检查环境”。默认不打开网页；在启动器窗口按 `Ctrl+I` 可打开配置中心，也可在页面点击“检查环境”重复执行这一操作。
4. 完成四个背键验证。在 XOutput 中确认输入设备列表中存在 `vJoy Device`，并在 `Game Controllers` 区域选择已保存的 `Controller` 条目；显示 `Stop` 表示虚拟 Xbox 已启动。
5. `Start` 变为 `Stop` 后即可开启游戏；配置页面不要求额外点击确认按钮。

AHK 会在后台运行，系统托盘中的 AHK 图标代表合并脚本仍在运行。

## 首次配置 XOutput（vJoy 输入方案）

这一步只在新电脑、XOutput 配置丢失，或当前 `Controller` 仍显示 `F9 - Keyboard` 等旧映射时执行。不要直接编辑或覆盖 `settings.json`。

1. 先停止 `Controller`：其右侧按钮必须显示 `Start`，才可编辑。
2. 点击 `Controller` 右侧的 `Edit`。在每个 `Configure` 对话框中，选择/确认输入设备为 **vJoy Device**；不要选择 `Keyboard`，也不要把实体 GameSir 作为输入源。
3. 逐项配置完整标准手柄输入：`LX`、`LY`、`RX`、`RY`、`LT`、`RT`，十字键上/下/左/右，以及 A/B/X/Y、LB/RB、L3/R3、Start、Back。配置十字键时，来源应为 vJoy 的 POV / hat 四个方向，绝不能是 `F9-F12 - Keyboard`。实体 Home/西瓜键目前未验证可通过此链路，保持 `Home` 为 `-`；不要把 `Button 15` 当作已经验证的来源。
4. 配置捕获时可操作实体 GameSir 对应控件：AHK 会把它实时写入 vJoy；配置框最终显示的来源必须是 `vJoy Device`。若显示 `Keyboard`，取消该项并重新配置。
5. 返回主窗口，点击 `Save configuration`，再点击 `Controller` 的 `Start`。当按钮变为 `Stop` 时，虚拟 Xbox 已启动。
6. 看右侧的 XInput 预览：操作实体摇杆、按钮和四个背键时都应有对应变化；背键默认应让十字键分别上、下、左、右变化。之后再进游戏或手柄测试工具验收。

保存后回到配置中心。“XOutput 配置保护”应显示“已备份的 vJoy-only 配置”。它只接受至少 16 项映射、没有 Keyboard/Mouse 输入、且仅一个 DirectInput 来源的配置；不会把旧的 `F9-F12 - Keyboard` 直连配置作为备份。

`F9-F12 -> Keyboard -> XOutput` 是旧直连方案，不能与本项目的 `AHK -> vJoy -> XOutput` 合用；后者才支持“完整实体手柄 + 背键动作合并为一只虚拟 Xbox”。

标准按钮的 vJoy 编号由 AHK 内唯一的 `VJOY_BUTTON` 表管理：A/B/X/Y 为 1/2/3/4，Start/Back 为 5/6，LS/RS 为 7/8，LB/RB 为 9/10。实体输入转发与配置中心宏共用这张表；新用户无需编辑 AHK，只需让 XOutput 学习相同的 vJoy Button。

## 本地配置中心（首版）

运行 `start_gamesir_virtual_xbox.cmd` 后，浏览器访问：

```text
http://127.0.0.1:3780
```

页面可管理配置档，并配置四个逻辑背键的键盘来源与单次、按住、连发、宏 Xbox 动作。首次来源为 `F9`、`F10`、`F11`、`F12`；如果在 GameSir Nexus 中改动了背键键盘输出，点击对应“识别”或预检中的“验证”，平台会立即同步识别到的 F 键。来源是设备级设置，不随游戏配置档切换。

点击“检查环境”会启动或复用本会话的 AHK 与 XOutput，再检查 AHK、vJoy、ViGEmBus、HidHide、运行时配置与选定的 GameSir XInput 槽位。检查不会关闭 HidHide、修改白名单、安装驱动或修改 Nexus。检查结果要求用户继续完成四个实体背键与 XOutput 输出的确认；在实际完成前不要将“等待人工验证”当作通过。

配置中心支持单次、按住、连发和结构化宏。宏由 `press`、`release`、`wait` 步骤组成，保存时会校验全部按下均被释放；执行器只会在当前宏完成后的安全点切换 revision。保存后页面会显示目标 revision：AHK 心跳报告相同或更高 revision 时显示“AHK 已加载”；宏或连发仍在执行时会显示正在等待安全点。

## 日常关闭方法

1. 关闭游戏。
2. 在启动器窗口按 `Ctrl+Z`，或双击 `D:\GitHub\game-controller-additional-key-marco\stop_gamesir_virtual_xbox.cmd`，也可在配置中心点击“关闭本会话全部组件”。它会先让 AHK 在安全点释放 vJoy 输入并退出，再关闭本会话启动的 XOutput、关闭 HidHide 的 cloak，并关闭配置服务。

HidHide 驱动本身不停止；关闭的是其 cloak 状态，因此真实 GameSir 会重新对普通程序可见。若检测到不属于本会话的 XOutput 或本项目 AHK 仍在运行，停止操作会保留 cloak，避免产生真实与虚拟手柄同时可见的情况。

## 映射验证

1. 按照“日常开启方法”启动完整链路。
2. 分别按下映射为 `F9`、`F10`、`F11`、`F12` 的四个背键。
3. 游戏或手柄测试工具应分别收到十字键上、下、左、右。

已验证虚拟 Xbox 能收到 `F9 -> 十字键上`，其 XInput 槽位显示为 `XInput #1`。设备重连后槽位编号可能变化；由于 HidHide 隐藏了真实 GameSir，游戏应只看到虚拟手柄。

## 修改背键映射

### 修改 Nexus 输出

建议保持 Nexus 的背键输出为 `F9-F12`。如需改为其他 F 键，请在配置中心对对应逻辑背键点击“识别”，再按一次实体背键；识别成功后平台会立即更新来源并等待 AHK 在安全点加载。该流程不会修改 Nexus 或 HidHide。

不要为这一流程关闭 HidHide、修改白名单或调整设备隐藏规则。若 Nexus 无法在当前 HidHide 配置下完成改键，停止操作并由用户明确确认后再单独处理驱动可见性；完成后重新进行配置中心的环境检查和四键验证。

### 修改虚拟 Xbox 的目标按键

如需把背键改为其他 Xbox 按键，请在配置中心编辑并保存目标动作；不需要修改 XOutput 映射。AHK 在当前动作结束后的安全点加载新 revision。

XInput 没有可额外暴露的四个独立背键。背键必须映射到现有 Xbox 输入，例如十字键、A/B/X/Y、肩键、扳机、Start 或 Back。

### XOutput 配置保护与恢复

XOutput 的实际配置文件位于 `XOutput.exe` 同目录的 `settings.json`。配置中心不会在日常启动、检查环境或保存背键宏时修改它；发现有效 vJoy-only 配置后，会在项目的 `runtime/xoutput-backups/` 建立按时间和内容哈希命名的备份。

若页面显示“需要处理”，并提示 Keyboard/Mouse 旧映射、混合输入或映射数量不足：

1. 在 XOutput 中恢复或重新配置为仅 vJoy Device 输入，并点击其主窗口的 `Save configuration`。
2. 回到配置中心点击“备份当前配置”，确认出现“已验证备份”。
3. 发生回退后，不要在错误配置上点击 XOutput 的 `Save configuration`。先完全退出本项目使用的 XOutput，再在配置中心点击对应备份的“恢复此备份”。恢复前会将当前文件保存为隔离副本；重新启动 XOutput 后生效。

恢复按钮不会自动停止 XOutput，也不会自动修改 HidHide。没有已验证备份时，必须手工重新配置，不能猜测或自动生成映射。

## HidHide 当前配置

当前已配置：

```text
已隐藏 GameSir 游戏接口（同一物理容器 USB\VID_3537&PID_100A\00655D1441）：
  HID\VID_3537&PID_100A&IG_00\8&f51033c&0&0000
  HID\VID_3537&PID_100A&IG_01\8&31427d0&0&0000
  HID\VID_3537&PID_100A&IG_02\8&3e47af8&0&0000
  HID\VID_3537&PID_100A&IG_03\8&36e5fbe7&0&0000
  HID\VID_3537&PID_100A&IG_04\8&1719f92c&0&0000
已隐藏 GameSir XInput/XNA Composite 接口：
  USB\VID_3537&PID_100A&MI_00\6&291A8F80&0&0000
白名单程序：
  D:\AutoHotkey\v2\AutoHotkey64.exe
  D:\HidHide\x64\HidHideClient.exe
```

XOutput 不加入白名单。AHK 负责读取被隐藏的实体 GameSir 并将完整合并状态写入 vJoy；XOutput 只读取未隐藏的 vJoy Device 1。若 XOutput 已经在白名单中，必须移除后重启 XOutput。

保留 `MI_01` 相关的键盘、鼠标和消费者控制接口可见；它们不是 Steam 的手柄入口，且 GameSir Nexus 的 F9-F12 背键输出依赖键盘接口。不要将它们加入隐藏列表。

检查当前状态：

```powershell
& 'D:\HidHide\x64\HidHideCLI.exe' --cloak-state --dev-list
```

如果手柄在需要使用的位置不可见，不要直接关闭隐藏。先检查白名单、AHK/XOutput 状态和配置中心预检；只有用户明确确认需要改变 HidHide 时，才单独处理该驱动设置，并在之后重新完成完整验证。

不要通过删除驱动文件或手动修改类过滤器来卸载 HidHide。如确需卸载，请在 Windows“已安装的应用”中执行卸载。

## 故障排查

| 现象 | 检查与处理 |
| --- | --- |
| AHK 提示无法识别的动作 | 请通过启动器运行，不要启动旧的或名称不同的 `.ahk` 副本。正式脚本为 `gamesir_merge_vjoy_f9_f12.ahk`，必须使用 AHK v2。 |
| XOutput 显示 `Start` | 点击 `Start` 启动虚拟 Xbox；显示 `Stop` 代表输出正在运行。 |
| 游戏看到两只手柄 | 检查 HidHide 是否显示 `--cloak-on`；启用后需要关闭并重新打开游戏。 |
| 游戏完全看不到手柄 | 确认 AHK 正在运行、XOutput 显示 `Stop`、vJoy Device 1 已启用，并查看配置中心预检。不要为排查直接关闭 HidHide。 |
| 背键无反应 | 检查 Nexus 是否仍输出 `F9-F12`，然后重启 AHK 和 XOutput。 |
| 摇杆进入游戏后持续顶到一侧 | 确认 AHK 已重启到最新脚本；旧版本把有符号 XInput 轴值直接写入 vJoy，会导致负方向归零、正方向满值。当前脚本会按 vJoy 轴范围转换。 |
| 摇杆上下反向 | 当前 AHK 已在 XInput → vJoy 边界反转左右摇杆的 Y 轴；不要再在 XOutput 对 LY/RY 点击 `Invert`，否则会再次反向。 |
| Home/西瓜键无反应 | 当前已知待办：GameSir 的 Home 尚未证实通过 XInput Guide 位上报。保持 XOutput 的 `Home` 为 `-`，不要反复学习或假定 Button 15 有效；如需支持，再单独检查 XInput Guide 与可见 HID 接口。 |
| AHK 显示运行但实体 GameSir 的 XInput 槽位为 disconnected | 检查启动器是否使用 `D:\AutoHotkey\v2\AutoHotkey64.exe`。白名单当前登记的是该 64 位程序；误用 `AutoHotkey.exe` 时，AHK 仍可读取键盘 F9-F12，却无法读取被 HidHide cloak 的实体 GameSir。 |
| XOutput 提示未安装 ViGEm | 运行 `sc.exe query ViGEmBus`，应显示 `RUNNING`。 |

## 已安装驱动

- vJoy 2.1.9.1
- ViGEmBus 1.22.0
- HidHide 1.5.230

## 本地配置中心

本项目包含运行在本机的 Node.js 配置中心，默认地址为 `http://127.0.0.1:3780`，而不是 Electron 桌面壳。它用于编辑配置档、识别背键来源、查看执行器状态与运行前检查；不修改 Nexus、HidHide 或 XOutput 的映射文件。

### 目标架构

```text
浏览器配置页（localhost）
        ↓
Node.js 本地服务：配置、配置档、启动和重载
        ↓
AutoHotkey 执行器：低延迟监听和宏执行
        ↓
vJoy Device 1 → XOutput → 虚拟 Xbox/XInput 手柄
```

### 职责划分

| 组件 | 负责内容 |
| --- | --- |
| Node.js 本地服务 | 保存 JSON 配置、列出和切换配置档、提供网页 API、启动或重载 AHK、导入导出配置。 |
| 浏览器配置页 | 编辑四个背键动作、连击次数与间隔、按住连发、宏步骤和延迟，以及选择当前配置档。 |
| AHK 执行器 | 读取 `F9-F12`、按当前配置执行即时动作、连击和宏，并保持现有真实手柄与背键的合并逻辑。 |
| vJoy、XOutput、HidHide | 保持当前已验证的虚拟 Xbox 输出和单手柄可见性，不承担宏配置管理。 |

### 第一版功能范围

1. 四个背键分别支持：单次虚拟 Xbox 按键、十字键方向、按住、连发和宏。
2. 连发可设置首次触发延迟、连击间隔和停止条件（松开即停止或执行固定次数）。
3. 宏可由按键按下、松开和等待组成，例如 `A 按下 → 等待 80ms → A 松开 → 等待 120ms → B 按下 → B 松开`。
4. 支持多个命名配置档，例如“默认”“射击”“竞速”；切换后立即让 AHK 重载。
5. 配置以可读的 JSON 文件保存，可导入、导出和备份。
6. 配置页提供“启动服务”“停止映射”“重载当前配置”和当前链路状态。

### 约束与原则

- GameSir Nexus 继续固定输出 `F9-F12`，日常不再为不同游戏重复修改 Nexus 键位。
- 目标动作必须是标准 Xbox/XInput 已有输入；XInput 不支持向游戏暴露四个额外独立背键。
- Node.js 不直接承担实时虚拟手柄驱动。它管理配置和生命周期，AHK 承担输入时序，避免引入不稳定的 Node 原生驱动依赖。
- 首版不做宏录制器；先完成结构化宏编辑、执行和配置档切换，确认稳定后再考虑录制功能。



# GameSir G7 Pro 背键 → 虚拟 Xbox

将 GameSir Nexus 固定输出的四个背键 `F9`–`F12` 合并到一只虚拟 Xbox 手柄。

```text
实体 GameSir + F9-F12 背键
             ↓
       AutoHotkey 合并
             ↓
        vJoy Device 1
             ↓
          XOutput
             ↓
       一只虚拟 Xbox
```

日常使用运行 [start_gamesir_virtual_xbox.cmd](./start_gamesir_virtual_xbox.cmd)。在启动器中按 `Ctrl+Z`，或运行 `stop_gamesir_virtual_xbox.cmd`，即可停止本会话并恢复原生 GameSir。

完整的首次配置与排障请见 [gamesir_virtual_xbox_runbook.md](./gamesir_virtual_xbox_runbook.md)。

## 首次配置

### 1. 安装依赖

自行安装以下组件，并重新打开终端或资源管理器后再运行启动器：

- Node.js（需能在命令行执行 `node --version`）
- AutoHotkey v2 x64
- vJoy 2.1.9.1：Device 1 配置为 **18 buttons / X,Y,Z,Rx,Ry,Rz / 1 Continuous POV**
- ViGEmBus
- HidHide
- XOutput
- GameSir Nexus

XOutput、HidHide 等安装程序和驱动不随仓库分发；请从各项目官方发布渠道取得。

### 2. 指定工具位置（仅在自动发现失败时）

启动器会从 `PATH` 查找 Node，并自动尝试常见的 AHK、vJoy、XOutput、HidHide 路径。若你的安装位置不同，在启动器所在的同一个 PowerShell 窗口设置以下环境变量后运行 `.cmd`：

```powershell
$env:GAMESIR_AHK_EXE = 'C:\path\to\AutoHotkey64.exe'
$env:GAMESIR_VJOY_DLL = 'C:\Program Files\vJoy\x64\vJoyInterface.dll'
$env:GAMESIR_XOUTPUT_EXE = 'C:\path\to\XOutput.exe'
$env:GAMESIR_HIDHIDE_CLI = 'C:\path\to\HidHideCLI.exe'
.\start_gamesir_virtual_xbox.cmd
```

这些变量可按你的 Windows 环境持久化；不要把本机绝对路径提交到仓库。

### 3. 配置 Nexus、HidHide 与 XOutput

1. 在 GameSir Nexus 将四个背键设为 `F9`、`F10`、`F11`、`F12`。
2. 在 HidHide 中隐藏本机实际枚举出的 GameSir 游戏接口；将 **AutoHotkey64.exe** 加入白名单，**不要**将 XOutput 加入白名单。设备实例路径因电脑和手柄而异，不能复制他人的 `USB\...` 路径。
3. 打开 XOutput，创建或编辑 `Controller`。所有输入都必须来自 `vJoy Device`，不得混用 Keyboard 或实体 GameSir。
4. 在 XOutput 中将 `LX/LY/RX/RY/LT/RT` 分别学习为 vJoy 的 `X/Y/Rx/Ry/Z/Rz`；四个十字键均学习 vJoy 的 `DPad1` 四个方向；标准按钮也仅学习 vJoy。保持 `LY`、`RY` 的 `Invert` 关闭。Home/西瓜键当前未支持，保持未绑定。
5. 保存 XOutput 配置，点击 `Controller` 的 `Start`。按钮变成 `Stop` 才说明虚拟 Xbox 正在输出。

## 验收

1. 运行启动器；在浏览器打开 `http://127.0.0.1:3780`，完成“检查环境”和四个背键验证。
2. 用 JoyMonitor 确认 vJoy 的摇杆松手居中、四个方向正确，且四背键分别改变 POV 的上、下、左、右。
3. 在 XOutput 右侧预览确认实体按键、摇杆和背键都有响应，且 Controller 显示 `Stop`。
4. 完全退出并重新打开 Steam 或游戏，确认只识别虚拟 Xbox，而不识别实体 GameSir。

## 当前限制

- Home/西瓜键尚未验证能从实体 GameSir 通过当前 XInput 链路输出；不作为安装成功条件。
- Force Feedback / 震动不会回传到实体 GameSir。
- XOutput 配置属于用户本机配置，仓库不会覆盖或分发它。

## vJoy 标准按钮编号

这是工程内唯一维护的动作编号表；新用户不需要手动编辑它。XOutput 首次学习时应得到以下对应关系：

| Xbox 动作 | vJoy Button |
| --- | ---: |
| A / B / X / Y | 1 / 2 / 3 / 4 |
| Start / Back | 5 / 6 |
| LS / RS | 7 / 8 |
| LB / RB | 9 / 10 |

实体手柄转发和配置中心的单次、按住、连发、宏都使用同一张表；不要根据旧配置重新调换这些编号。

## 开发与测试

本项目没有 npm 第三方依赖。运行自动化测试：

```powershell
node --test app/server/*.test.mjs
```

维护映射、HidHide 或启动链路前，请先阅读 [AGENTS.md](./AGENTS.md) 与运行手册。

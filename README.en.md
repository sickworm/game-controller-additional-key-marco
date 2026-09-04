# GameSir G7 Pro Back Buttons → Virtual Xbox Controller

[简体中文](./README.md) | [English](./README.en.md)

This project turns the four GameSir G7 Pro back buttons into configurable standard Xbox/XInput actions while exposing only one virtual Xbox controller to games.

```text
GameSir Nexus (back buttons output F9-F12)
  → AutoHotkey (merges physical input and back-button actions)
  → vJoy Device 1
  → XOutput
  → Virtual Xbox/XInput controller
```

## Why this design

Steam does not provide a reliable binding experience for raw vJoy DirectInput devices, and XInput cannot expose four additional independent back buttons. This project therefore maps the back buttons to standard Xbox inputs such as A/B/X/Y, D-pad directions, shoulder buttons, Start, and Back. HidHide prevents games from seeing both the physical and virtual controllers.

Rumble passthrough is not currently supported. The physical Home/Guide button is also unverified and is not an installation acceptance requirement.

## Requirements

- Windows and a GameSir G7 Pro.
- GameSir Nexus: configure P1/P2/P3/P4 to output `F9`/`F10`/`F11`/`F12`.
- Node.js available through `node --version`.
- AutoHotkey v2 x64. Daily use must run the allow-listed `AutoHotkey64.exe`.
- vJoy 2.1.9.1 with Device 1 configured for 18 buttons, six axes, and one POV.
- ViGEmBus, HidHide, and XOutput.
- The XOutput Controller must use `vJoy Device` as its only input source. Do not mix in Keyboard or the physical GameSir.

Drivers and third-party tools are not distributed in this repository. See the [English runbook](./gamesir_virtual_xbox_runbook.en.md) for installation, exact configuration, acceptance checks, and troubleshooting. Never copy another computer's HidHide device instance paths.

## Daily use

1. Connect the GameSir and double-click [start_gamesir_virtual_xbox.cmd](./start_gamesir_virtual_xbox.cmd).
2. The Configuration Center opens by default. Clear **Open Configuration Center on every startup** in the top-right corner if you do not need it during daily use. Press `Ctrl+I` in the launcher window to open it manually.
3. In XOutput, confirm that the target Controller button under `Game Controllers` says `Stop`. A running XOutput process alone does not prove that virtual Xbox output is active.
4. After closing the game, press `Ctrl+Z` in the launcher or run [stop_gamesir_virtual_xbox.cmd](./stop_gamesir_virtual_xbox.cmd).

The Configuration Center listens only on `http://127.0.0.1:3780` by default. It does not provide LAN or remote access.

Use the top-right language button to switch the Configuration Center between Chinese and English. The launcher and stop script default to Chinese; set `$env:GAMESIR_LANG = 'en'` before launching to use English console messages.

## Files and directories

| File or directory | Purpose |
| --- | --- |
| `start_gamesir_virtual_xbox.cmd` / `.ps1` | Starts or reuses the configuration service, AHK, and XOutput for this session, then enables the HidHide cloak. |
| `stop_gamesir_virtual_xbox.cmd` / `.ps1` | Stops only components owned by this session, then safely disables the cloak. |
| `gamesir_merge_vjoy_f9_f12.ahk` | AutoHotkey v2 input merger, back-button action engine, and macro executor. |
| `app/server/` | Local configuration, status, lifecycle, and WebSocket service. |
| `app/web/` | Browser-based Configuration Center. |
| `runtime/` | Machine-local configuration, status, logs, and backups generated at runtime; never commit it. |
| `gamesir_virtual_xbox_runbook.md` / `.en.md` | Complete Chinese and English setup and troubleshooting manuals for users and agents. |
| `AGENTS.md` | Mandatory implementation and safety boundaries for coding agents. |

## Tool path discovery

The launcher finds Node.js through `PATH` and tries common locations for AHK, vJoy, XOutput, and HidHide. If discovery fails, set these variables in the same PowerShell window:

```powershell
$env:GAMESIR_AHK_EXE = 'C:\path\to\AutoHotkey64.exe'
$env:GAMESIR_VJOY_DLL = 'C:\Program Files\vJoy\x64\vJoyInterface.dll'
$env:GAMESIR_XOUTPUT_EXE = 'C:\path\to\XOutput.exe'
$env:GAMESIR_HIDHIDE_CLI = 'C:\path\to\HidHideCLI.exe'
.\start_gamesir_virtual_xbox.cmd
```

Do not commit machine-specific absolute paths or a user's XOutput settings.

## Development verification

The project has no third-party npm dependencies:

```powershell
node --test app/server/*.test.mjs
```

Before changing mappings, startup behavior, vJoy, XOutput, or HidHide integration, read [AGENTS.md](./AGENTS.md) and the complete runbook.

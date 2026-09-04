# GameSir G7 Pro Back Buttons to Virtual Xbox — Runbook

[简体中文](./gamesir_virtual_xbox_runbook.md) | [English](./gamesir_virtual_xbox_runbook.en.md)

## How to use this runbook

This manual is written for both users and maintenance agents. For every critical operation, follow: **goal → procedure → acceptance criteria → failure checks → prohibited actions**. Never treat a running process, a cached Steam device list, or a guessed device number as proof of success.

### First-time setup flow

| Step | Goal | Acceptance criteria |
| ---: | --- | --- |
| 1 | Install dependencies | Node.js, AutoHotkey v2 x64, vJoy, ViGEmBus, HidHide, XOutput, and Nexus are available. |
| 2 | Configure Nexus | P1-P4 output F9-F12 respectively. |
| 3 | Configure vJoy | Device 1 has 18 buttons, X/Y/Z/Rx/Ry/Rz, and one POV. |
| 4 | Configure HidHide | Physical gaming interfaces are hidden; AHK is allow-listed; XOutput is not. |
| 5 | Configure XOutput | Every standard input comes from vJoy Device; the Controller button says `Stop`. |
| 6 | Select the physical slot | AHK reports the physical GameSir as connected. |
| 7 | Verify the back buttons | P1-P4 receive F9-F12 respectively. |
| 8 | Final acceptance | The game sees only the virtual Xbox controller; standard and back-button inputs work. |

If a step fails, use the Configuration Center's blocking message and the troubleshooting table below. Do not disable HidHide merely to troubleshoot, guess unrelated `MI_*` interfaces, overwrite the user's XOutput `settings.json`, or add XOutput to the HidHide allow-list.

## Architecture and verified behavior

```text
GameSir Nexus (F9-F12)
  → AutoHotkey reads and merges input
  → vJoy Device 1
  → XOutput
  → Virtual Xbox/XInput controller
```

The default back-button actions write vJoy POV directions: P1/P2/P3/P4 map to Up/Down/Left/Right. Physical D-pad input is merged with these actions.

AHK converts XInput values to the actual vJoy axis range and reverses both stick Y axes at that boundary. Do not enable `Invert` for XOutput LY or RY. The physical Home/Guide button is unverified. Rumble passthrough is not supported.

## Required software and path discovery

Install Node.js, AutoHotkey v2 x64, vJoy 2.1.9.1, ViGEmBus, HidHide, XOutput, and GameSir Nexus. The launcher finds Node.js through `PATH` and tries common paths for the other tools.

If discovery fails, set `GAMESIR_AHK_EXE`, `GAMESIR_VJOY_DLL`, `GAMESIR_XOUTPUT_EXE`, or `GAMESIR_HIDHIDE_CLI` in the PowerShell window used to launch the project. Daily use must run the same `AutoHotkey64.exe` that is present in the HidHide allow-list.

## Configure vJoy Device 1

**Goal:** provide the complete DirectInput bridge consumed by XOutput.

1. Open `C:\Program Files\vJoy\x64\vJoyConfig.exe`.
2. Select Device 1.
3. Enable X, Y, Z, Rx, Ry, and Rz.
4. Enable 18 buttons.
5. Enable one Continuous POV. A Discrete POV is also accepted by the executor.
6. Apply the configuration and restart the executor.

**Pass:** AHK acquires Device 1, its heartbeat reports POV availability, sticks rest at center, and P1-P4 change the POV in all four directions.

**Failure:** if AHK receives F9-F12 but vJoy shows no D-pad movement, recheck the POV count. Do not remap the back buttons directly to XOutput keyboard inputs.

## Configure GameSir Nexus

Set the physical back buttons P1, P2, P3, and P4 to F9, F10, F11, and F12. Keeping these assignments fixed lets profiles change Xbox actions without repeatedly editing Nexus.

If Nexus assignments change later, use **Detect** beside the corresponding source in the Configuration Center. This updates the local source only; it does not modify Nexus or HidHide.

## Configure HidHide

**Goal:** games see only the virtual controller while the allow-listed AHK executable can still read the physical GameSir.

1. Enumerate the GameSir interfaces that actually exist on this computer.
2. Hide the physical GameSir gaming interfaces and the correct Xbox/XNA Composite gaming interface.
3. Add the exact 64-bit `AutoHotkey64.exe` used by the launcher to the allow-list.
4. Keep XOutput out of the allow-list so it can read only the unhidden vJoy device.
5. Keep `MI_01` keyboard, mouse, and consumer-control interfaces visible; Nexus F9-F12 output depends on them.

**Pass:** with cloak enabled, AHK reads the physical controller, XOutput reads vJoy, and a freshly restarted game sees only the virtual Xbox controller.

**Prohibited:** scripts must not rewrite the allow-list or hidden-device rules. Do not copy device instance paths from another machine. Do not stop or uninstall the HidHide driver during daily mode switching.

## Configure XOutput with vJoy only

This is required on a new computer, after XOutput settings are lost, or when old mappings such as `F9 - Keyboard` remain.

1. Stop the Controller so its button says `Start` before editing.
2. Edit the Controller and capture every input from **vJoy Device** only.
3. Map LX/LY/RX/RY/LT/RT to vJoy X/Y/Rx/Ry/Z/Rz.
4. Map D-pad directions to the four directions of the vJoy POV/hat.
5. Map A/B/X/Y, LB/RB, L3/R3, Start, and Back from vJoy buttons.
6. Leave Home unassigned. Keep LY and RY `Invert` disabled.
7. Save the configuration, then click `Start`. It must change to `Stop`.

The shared vJoy button table is A/B/X/Y = 1/2/3/4, Start/Back = 5/6, LS/RS = 7/8, and LB/RB = 9/10. Physical forwarding and macro actions both use this single table in the AHK script.

**Pass:** the Configuration Center accepts the settings as a complete vJoy-only configuration; XOutput's XInput preview responds to physical sticks, standard buttons, and all four back buttons; the Controller button says `Stop`.

Never edit or overwrite a user's `settings.json` to perform first-time setup. A validated configuration may be backed up through the Configuration Center. Restore is permitted only after the project XOutput process has fully exited; the current file is quarantined first.

## Start virtual Xbox mode

1. Connect or power on the GameSir.
2. Run `start_gamesir_virtual_xbox.cmd`.
3. The launcher enables the cloak, starts or reuses AHK and XOutput, runs the environment check, and probes XInput slots.
4. The Configuration Center opens by default. Clear **Open Configuration Center on every startup** if it is unnecessary for daily use. Press `Ctrl+I` to open it manually.
5. Confirm XOutput's Controller button says `Stop`, then start the game.

The web service listens on `127.0.0.1:3780` by default. The startup preference is stored atomically in `runtime/ui-preferences.json`; it controls only browser opening and never skips environment checks or changes component startup.

## Select the physical XInput slot

Do not assume the physical controller is XInput #0. The slot can change after reconnecting the device, and the XOutput virtual controller occupies another slot.

The launcher and page use a short vJoy signature to identify the XOutput slot. Disconnected and confirmed-virtual slots are disabled. If one physical candidate remains, it is selected automatically. If several remain, click **Identify physical controller**, then move a GameSir stick significantly or press A within eight seconds.

Do not manually probe slots while a game is running because the short identification signal may be observed by the game.

## Verify all four back buttons

1. Run the environment check and ensure AHK reports the physical GameSir as connected.
2. Click **Verify back button 1**, wait for the page to enter capture mode, then press P1. Repeat for P2-P4.
3. Expected results are F9, F10, F11, and F12 respectively. A wrong F-key does not pass the expected-key verification. A 20-second timeout must be reported explicitly.
4. Confirm the vJoy POV changes Up/Down/Left/Right.
5. Confirm the XOutput XInput preview responds.
6. Confirm the Controller button says `Stop`.
7. Fully exit and reopen Steam, the test tool, or the game before deciding whether physical-device hiding failed.

**Final pass:** only one virtual Xbox controller is visible, and physical sticks, standard buttons, and all four back buttons work. Process existence alone is never proof of XOutput output.

## Profiles, repeats, and macros

Each back button supports tap, hold, repeat, or a structured macro made from `press`, `release`, and `wait` steps. Macro validation requires every pressed input to be released. Configuration saves increment the revision and are written atomically.

AHK switches revisions only at a safe point after the current action completes. During a macro or repeat, the page reports that the new revision is waiting. After completion or cancellation, no virtual button may remain held.

## Stop virtual Xbox mode

Close the game, then press `Ctrl+Z` in the launcher or run `stop_gamesir_virtual_xbox.cmd`. The stop flow asks AHK to release vJoy safely, stops only the session-owned AHK and XOutput processes, disables the cloak, and stops the configuration service.

If an ownership mismatch or another project AHK/XOutput process remains, the cloak stays enabled to avoid exposing both physical and virtual controllers. The HidHide driver service itself is not stopped.

## Troubleshooting

| Symptom | Check and action |
| --- | --- |
| AHK reports an unknown action | Launch the official `gamesir_merge_vjoy_f9_f12.ahk` with AutoHotkey v2. |
| XOutput says `Start` | Click it; `Stop` is the required running indication. |
| The game sees two controllers | Confirm cloak is on, then fully restart the game. Do not guess new hidden interfaces. |
| The game sees no controller | Check AHK, vJoy acquisition, XOutput `Stop`, and the page's environment report. Do not immediately disable HidHide. |
| Back buttons do nothing | Confirm Nexus still outputs F9-F12 and run the four-key verification. |
| A stick remains at an edge | Restart with the current AHK script; old versions did not convert signed XInput axes correctly. |
| Stick Y direction is reversed | Disable XOutput LY/RY `Invert`; AHK already reverses Y at the XInput-to-vJoy boundary. |
| Home does nothing | This is an unverified limitation. Leave XOutput Home unassigned. |
| AHK runs but physical XInput is disconnected | Confirm the launcher uses the allow-listed 64-bit `AutoHotkey64.exe`, then select the actual physical slot. |
| XOutput reports missing ViGEm | Check the ViGEmBus installation/service before retrying. |

## Agent safety boundaries

- Read `AGENTS.md` and this runbook completely before changing startup, stop, AHK, vJoy, XOutput, HidHide, or back-button recognition.
- Do not modify HidHide allow-list or hidden-device rules without explicit user authorization.
- Do not claim virtual Xbox output merely because `XOutput.exe` exists; the Controller control must say `Stop`.
- Do not create separate physical-forwarding and macro button-number tables.
- Do not claim Home → Button 15 support.
- After mapping-chain changes, verify F9-F12 input, XOutput output, HidHide single-controller visibility, revision agreement, and release of all virtual inputs.

#Requires AutoHotkey v2.0
#SingleInstance Force

vJoyDll := EnvGet("GAMESIR_VJOY_DLL") || "C:\Program Files\vJoy\x64\vJoyInterface.dll"
vjoyID := 1
xuser := 0
POLL_MS := 8
DEADZONE := 6000
CONFIG_INI := A_ScriptDir "\runtime\executor-config.ini"
RELOAD_REQUEST := A_ScriptDir "\runtime\reload-request.json"
EXIT_REQUEST := A_ScriptDir "\runtime\exit-request.json"
CAPTURE_REQUEST := A_ScriptDir "\runtime\capture-request.ini"
CAPTURE_RESULT := A_ScriptDir "\runtime\capture-result.ini"
STATUS_INI := A_ScriptDir "\runtime\executor-status.ini"
BACK_DPAD := Map("DPadUp", 0x0001, "DPadDown", 0x0002, "DPadLeft", 0x0004, "DPadRight", 0x0008)
; This is the sole Xbox action -> vJoy button map. Both physical XInput
; forwarding and configuration-center macros must use it to prevent drift.
VJOY_BUTTON := Map("A", 1, "B", 2, "X", 3, "Y", 4, "Start", 5, "Back", 6, "LS", 7, "RS", 8, "LB", 9, "RB", 10, "Home", 15)
XI_BTN := Map(0x1000, VJOY_BUTTON["A"], 0x2000, VJOY_BUTTON["B"], 0x4000, VJOY_BUTTON["X"], 0x8000, VJOY_BUTTON["Y"], 0x0010, VJOY_BUTTON["Start"], 0x0020, VJOY_BUTTON["Back"], 0x0040, VJOY_BUTTON["LS"], 0x0080, VJOY_BUTTON["RS"], 0x0100, VJOY_BUTTON["LB"], 0x0200, VJOY_BUTTON["RB"], 0x0400, VJOY_BUTTON["Home"], 0x0001, 11, 0x0002, 12, 0x0004, 13, 0x0008, 14)
AX := Map("X", 0x30, "Y", 0x31, "Z", 0x32, "Rx", 0x33, "Ry", 0x34, "Rz", 0x35)
INPUT_BUTTON := VJOY_BUTTON
backDefs := Map()
backState := Map("P1", false, "P2", false, "P3", false, "P4", false)
sourceLatched := Map("P1", false, "P2", false, "P3", false, "P4", false)
actionCount := Map()
repeatTimers := Map()
macroTimers := Map()
macroRun := Map("P1", 0, "P2", 0, "P3", 0, "P4", 0)
macroTrace := Map("P1", "idle", "P2", "idle", "P3", "idle", "P4", "idle")
macroWaitUntil := Map("P1", 0, "P2", 0, "P3", 0, "P4", 0)
macroIgnoredPulses := Map("P1", 0, "P2", 0, "P3", 0, "P4", 0)
macroOwnedActions := Map("P1", Map(), "P2", Map(), "P3", Map(), "P4", Map())
lastMacroEvent := ""
configRevision := 0
executorError := ""
inputConnected := false
stateBuf := Buffer(16, 0)
captureId := ""
lastCaptureRequestId := ""
captureLogical := ""
captureExpectedSource := ""
captureExpiresAt := 0
xiMod := ""
vjoyReady := false
povMode := ""
lastReloadRequestAt := ""
lastExitRequestAt := ""

Main()

AcquireVJD(id) => DllCall("vJoyInterface\AcquireVJD", "UInt", id, "Int")
RelinquishVJD(id) => DllCall("vJoyInterface\RelinquishVJD", "UInt", id, "Int")
GetVJDDiscPovNumber(id) => DllCall("vJoyInterface\GetVJDDiscPovNumber", "UInt", id, "Int")
GetVJDContPovNumber(id) => DllCall("vJoyInterface\GetVJDContPovNumber", "UInt", id, "Int")
GetVJDAxisMin(id, axis) {
    minimum := 0
    DllCall("vJoyInterface\GetVJDAxisMin", "UInt", id, "UInt", axis, "IntP", &minimum, "Int")
    return minimum
}
GetVJDAxisMax(id, axis) {
    maximum := 0
    DllCall("vJoyInterface\GetVJDAxisMax", "UInt", id, "UInt", axis, "IntP", &maximum, "Int")
    return maximum
}
SetBtn(state, id, button) => DllCall("vJoyInterface\SetBtn", "Int", state, "UInt", id, "UInt", button, "Int")
SetAxis(value, id, axis) => DllCall("vJoyInterface\SetAxis", "Int", value, "UInt", id, "UInt", axis, "Int")
; vJoy POV APIs require the 1-based POV index as their third argument.
SetDiscPov(id, value) => DllCall("vJoyInterface\SetDiscPov", "Int", value, "UInt", id, "UChar", 1, "Int")
SetContPov(id, value) => DllCall("vJoyInterface\SetContPov", "Int", value, "UInt", id, "UChar", 1, "Int")
ResetVJD(id) => DllCall("vJoyInterface\ResetVJD", "UInt", id, "Int")

Main() {
    global
    IniWrite "starting", STATUS_INI, "executor", "state"
    IniWrite ProcessExist(), STATUS_INI, "executor", "pid"
    IniWrite UnixMs(), STATUS_INI, "executor", "updatedAt"
    if !DllCall("LoadLibrary", "Str", vJoyDll)
        return FailAndExit("vjoy-dll-unavailable")
    xiMod := DllCall("LoadLibrary", "Str", "XInput1_4") ? "XInput1_4" : "XInput9_1_0"
    if !DllCall("GetModuleHandle", "Str", xiMod, "Ptr")
        return FailAndExit("xinput-unavailable")
    if !AcquireVJD(vjoyID)
        return FailAndExit("vjoy-device-unavailable")
    vjoyReady := true
    axisMin := Map(), axisMax := Map()
    for _, axis in AX {
        axisMin[axis] := GetVJDAxisMin(vjoyID, axis)
        axisMax[axis] := GetVJDAxisMax(vjoyID, axis)
        if axisMax[axis] <= axisMin[axis]
            return FailAndExit("vjoy-axis-range-unavailable")
    }
    if GetVJDDiscPovNumber(vjoyID) >= 1
        povMode := "discrete"
    else if GetVJDContPovNumber(vjoyID) >= 1
        povMode := "continuous"
    else
        return FailAndExit("vjoy-pov-unavailable")
    ResetVJD(vjoyID)
    lastExitRequestAt := ReadRequestTimestamp(EXIT_REQUEST)
    for logical in ["P1", "P2", "P3", "P4"] {
        repeatTimers[logical] := RepeatTick.Bind(logical)
        macroTimers[logical] := MacroTick.Bind(logical)
    }
    LoadConfig(true)
    SetTimer Poll, POLL_MS
    SetTimer CheckConfig, 250
    SetTimer CheckCapture, 250
    SetTimer WriteStatus, 1000
    OnExit Cleanup
    WriteStatus()
}

FailAndExit(message) {
    global executorError, STATUS_INI
    executorError := message
    IniWrite "error", STATUS_INI, "executor", "state"
    IniWrite message, STATUS_INI, "executor", "error"
    IniWrite UnixMs(), STATUS_INI, "executor", "updatedAt"
    ExitApp
}

Poll(*) {
    global
    if DllCall(xiMod "\XInputGetState", "UInt", xuser, "Ptr", stateBuf, "UInt") != 0 {
        if inputConnected
            ClearSynthetic()
        inputConnected := false
        ResetVJD(vjoyID)
        return
    }
    inputConnected := true
    buttons := NumGet(stateBuf, 4, "UShort")
    leftTrigger := NumGet(stateBuf, 6, "UChar"), rightTrigger := NumGet(stateBuf, 7, "UChar")
    leftX := NumGet(stateBuf, 8, "Short"), leftY := NumGet(stateBuf, 10, "Short")
    rightX := NumGet(stateBuf, 12, "Short"), rightY := NumGet(stateBuf, 14, "Short")
    for bits, button in XI_BTN
        SetBtn((buttons & bits || ActionDownVjoy(button)) ? 1 : 0, vjoyID, button)
    ; XInput reports up as positive Y, while vJoy's DirectInput Y axes report
    ; up as the lower value. Invert both vertical stick axes at this boundary.
    SetAxis(XInputToVjoy(leftX, AX["X"]), vjoyID, AX["X"]), SetAxis(XInputToVjoy(-leftY, AX["Y"]), vjoyID, AX["Y"])
    SetAxis(XInputToVjoy(rightX, AX["Rx"]), vjoyID, AX["Rx"]), SetAxis(XInputToVjoy(-rightY, AX["Ry"]), vjoyID, AX["Ry"])
    SetAxis(TriggerToAxis(Max(leftTrigger, ActionDown("LT") ? 255 : 0)), vjoyID, AX["Z"])
    SetAxis(TriggerToAxis(Max(rightTrigger, ActionDown("RT") ? 255 : 0)), vjoyID, AX["Rz"])
    pov := DpadToPov(buttons | BackDpadBits())
    if povMode = "discrete"
        SetDiscPov(vjoyID, pov)
    else
        SetContPov(vjoyID, pov)
}

LoadConfig(force := false) {
    global
    if !FileExist(CONFIG_INI) {
        executorError := "config-snapshot-missing"
        return
    }
    revision := IniRead(CONFIG_INI, "meta", "revision", "0")
    if !RegExMatch(revision, "^\d+$") {
        executorError := "config-revision-invalid"
        return
    }
    if AnyBackActionActive()
        return
    if !force && Integer(revision) <= configRevision
        return
    nextXuser := ReadConfigInt("meta", "xinputUser", 0, 0, 3)
    if nextXuser = "" {
        executorError := "xinput-user-invalid"
        return
    }
    nextDefs := Map(), nextSources := Map()
    for logical in ["P1", "P2", "P3", "P4"] {
        source := IniRead(CONFIG_INI, logical, "source", ""), mode := IniRead(CONFIG_INI, logical, "mode", ""), input := IniRead(CONFIG_INI, logical, "input", "")
        if !RegExMatch(source, "^F(?:[1-9]|1[0-9]|2[0-4])$") || !IsValidBinding(mode, input) {
            executorError := logical "-binding-invalid"
            return
        }
        if nextSources.Has(source) {
            executorError := "duplicate-source"
            return
        }
        nextSources[source] := true
        delay := ReadConfigInt(logical, "initialDelayMs", 180, 0, 10000)
        interval := ReadConfigInt(logical, "intervalMs", 65, 0, 10000)
        count := ReadConfigInt(logical, "count", 0, 0, 100)
        if delay = "" || interval = "" || count = "" {
            executorError := logical "-numeric-parameter-invalid"
            return
        }
        stopMode := IniRead(CONFIG_INI, logical, "stop", "whileHeld")
        if mode = "repeat" && stopMode != "whileHeld" && stopMode != "count" {
            executorError := logical "-repeat-stop-invalid"
            return
        }
        if mode = "repeat" && stopMode = "count" && count < 1 {
            executorError := logical "-repeat-count-invalid"
            return
        }
        def := {source: source, mode: mode, input: input, initialDelayMs: delay, intervalMs: interval, stop: stopMode, count: count, steps: []}
        if mode = "macro" {
            steps := ReadMacroSteps(logical)
            if !IsObject(steps) {
                executorError := logical "-macro-invalid"
                return
            }
            def.steps := steps
        }
        nextDefs[logical] := def
    }
    for _, oldDef in backDefs {
        Hotkey oldDef.source, "Off"
        Hotkey oldDef.source " Up", "Off"
    }
    backDefs := nextDefs
    for logical, def in backDefs {
        Hotkey def.source, BackKeyDown.Bind(logical), "On"
        Hotkey def.source " Up", BackKeyUp.Bind(logical), "On"
    }
    configRevision := Integer(revision), xuser := nextXuser, executorError := ""
}

CheckConfig(*) {
    global RELOAD_REQUEST, EXIT_REQUEST, lastReloadRequestAt, lastExitRequestAt
    if !FileExist(CONFIG_INI) || AnyBackActionActive()
        return
    exitAt := ReadRequestTimestamp(EXIT_REQUEST)
    if exitAt != "" && exitAt != lastExitRequestAt {
        lastExitRequestAt := exitAt
        ExitApp
    }
    requestAt := ReadRequestTimestamp(RELOAD_REQUEST)
    if requestAt != "" && requestAt != lastReloadRequestAt {
        LoadConfig(true)
        lastReloadRequestAt := requestAt
        return
    }
    LoadConfig()
}

ReadRequestTimestamp(filePath) {
    if !FileExist(filePath)
        return ""
    try requestText := FileRead(filePath, "UTF-8")
    catch
        return ""
    pattern := Chr(34) "requestedAt" Chr(34) "\s*:\s*" Chr(34) "([^" Chr(34) "]+)" Chr(34)
    return RegExMatch(requestText, pattern, &match) ? match[1] : ""
}

CheckCapture(*) {
    global
    if captureId != "" {
        if UnixMs() > captureExpiresAt {
            WriteCaptureResult(captureId, captureLogical, "timeout", "", "capture-timeout")
            StopCapture()
        }
        return
    }
    if !FileExist(CAPTURE_REQUEST) || AnyBackActionActive()
        return
    id := IniRead(CAPTURE_REQUEST, "capture", "id", ""), logical := IniRead(CAPTURE_REQUEST, "capture", "logical", ""), expectedSource := IniRead(CAPTURE_REQUEST, "capture", "expectedSource", ""), expiresAt := IniRead(CAPTURE_REQUEST, "capture", "expiresAt", "0")
    if id = "" || id = lastCaptureRequestId || !RegExMatch(expiresAt, "^\d+$") || Integer(expiresAt) < UnixMs()
        return
    if logical != "P1" && logical != "P2" && logical != "P3" && logical != "P4"
        return
    StartCapture(id, logical, expectedSource, Integer(expiresAt))
}

StartCapture(id, logical, expectedSource, expiresAt) {
    global captureId, captureLogical, captureExpectedSource, captureExpiresAt, backDefs
    for _, def in backDefs {
        Hotkey def.source, "Off"
        Hotkey def.source " Up", "Off"
    }
    Loop 24 {
        key := "F" A_Index
        Hotkey key, CaptureKey.Bind(id, logical, key), "On"
    }
    captureId := id
    captureLogical := logical
    captureExpectedSource := expectedSource
    captureExpiresAt := expiresAt
}

CaptureKey(id, logical, source, *) {
    global captureExpectedSource
    if captureExpectedSource != "" && source != captureExpectedSource
        return
    WriteCaptureResult(id, logical, "success", source, "source-captured")
    StopCapture()
}

WriteCaptureResult(id, logical, status, source, message) {
    global CAPTURE_RESULT
    temp := CAPTURE_RESULT ".tmp"
    if FileExist(temp)
        FileDelete(temp)
    FileAppend "[capture]`r`nid=" id "`r`nlogical=" logical "`r`nstatus=" status "`r`nsource=" source "`r`nmessage=" message "`r`n", temp, "UTF-8-RAW"
    FileMove temp, CAPTURE_RESULT, 1
}

StopCapture() {
    global captureId, lastCaptureRequestId, captureLogical, captureExpectedSource, captureExpiresAt
    Loop 24 {
        key := "F" A_Index
        Hotkey key, "Off"
    }
    lastCaptureRequestId := captureId, captureId := "", captureLogical := "", captureExpectedSource := "", captureExpiresAt := 0
    LoadConfig(true)
}

BackKeyDown(logical, *) {
    global backDefs, backState, sourceLatched, macroRun, macroWaitUntil, macroIgnoredPulses
    if sourceLatched[logical]
        return
    def := backDefs[logical]
    ; A macro continues after the physical key is released. Some keyboard
    ; endpoints can emit a later Down pulse during that interval, so do not
    ; treat it as a new macro run.
    if def.mode = "macro" && backState[logical] {
        macroIgnoredPulses[logical] += 1
        RecordMacro(logical, "run=" macroRun[logical] "; ignored source pulse=" macroIgnoredPulses[logical])
        return
    }
    sourceLatched[logical] := true
    backState[logical] := true
    if def.mode = "hold"
        AddAction(def.input)
    else if def.mode = "tap" {
        AddAction(def.input)
        SetTimer ReleaseTap.Bind(logical, def.input), -30
    } else if def.mode = "repeat"
        FireRepeat(logical)
    else if def.mode = "macro" {
        macroRun[logical] += 1
        macroWaitUntil[logical] := 0
        macroIgnoredPulses[logical] := 0
        ReleaseMacroOwnedActions(logical)
        def.nextStep := 1
        backDefs[logical] := def
        RecordMacro(logical, "run=" macroRun[logical] "; started")
        MacroTick(logical)
    }
}

BackKeyUp(logical, *) {
    global backDefs, backState, sourceLatched, repeatTimers
    if !sourceLatched[logical]
        return
    sourceLatched[logical] := false
    if !backState[logical]
        return
    def := backDefs[logical]
    if def.mode = "macro"
        return
    if def.mode = "hold"
        ReleaseAction(def.input)
    if def.mode = "repeat" && def.stop = "whileHeld"
        SetTimer repeatTimers[logical], 0
    backState[logical] := false
}

ReleaseTap(logical, input, *) {
    global backState
    ReleaseAction(input)
    backState[logical] := false
}

FireRepeat(logical) {
    global backDefs, backState, repeatTimers
    def := backDefs[logical]
    if !backState[logical]
        return
    AddAction(def.input)
    SetTimer ReleaseRepeatPress.Bind(def.input), -30
    if def.stop = "count" {
        def.remaining := def.count - 1
        backDefs[logical] := def
    }
    SetTimer repeatTimers[logical], -Max(def.initialDelayMs, 1)
}

RepeatTick(logical, *) {
    global backDefs, backState, repeatTimers
    def := backDefs[logical]
    if !backState[logical]
        return
    if def.stop = "count" && def.remaining <= 0 {
        backState[logical] := false
        return
    }
    AddAction(def.input)
    SetTimer ReleaseRepeatPress.Bind(def.input), -30
    if def.stop = "count" {
        def.remaining -= 1
        backDefs[logical] := def
    }
    SetTimer repeatTimers[logical], -Max(def.intervalMs, 1)
}

ReleaseRepeatPress(input, *) => ReleaseAction(input)

MacroTick(logical, *) {
    global backDefs, backState, macroTimers, macroRun, macroWaitUntil, macroIgnoredPulses
    if !backState[logical] {
        RecordMacro(logical, "run=" macroRun[logical] "; skipped because macro is inactive")
        return
    }
    def := backDefs[logical]
    while def.nextStep <= def.steps.Length {
        stepNumber := def.nextStep
        step := def.steps[def.nextStep]
        def.nextStep += 1
        if step.kind = "press" {
            AddMacroAction(logical, step.value)
            RecordMacro(logical, "run=" macroRun[logical] "; step=" stepNumber "/" def.steps.Length "; press=" step.value)
            continue
        }
        if step.kind = "release" {
            ReleaseMacroAction(logical, step.value)
            RecordMacro(logical, "run=" macroRun[logical] "; step=" stepNumber "/" def.steps.Length "; release=" step.value)
            continue
        }
        backDefs[logical] := def
        delay := Max(step.value, 1)
        macroWaitUntil[logical] := UnixMs() + delay
        RecordMacro(logical, "run=" macroRun[logical] "; step=" stepNumber "/" def.steps.Length "; wait=" delay "ms; next=" def.nextStep "/" def.steps.Length)
        SetTimer macroTimers[logical], -delay
        return
    }
    backDefs[logical] := def
    backState[logical] := false
    macroWaitUntil[logical] := 0
    ReleaseMacroOwnedActions(logical)
    RecordMacro(logical, "run=" macroRun[logical] "; completed; ignoredPulses=" macroIgnoredPulses[logical])
}

RecordMacro(logical, detail) {
    global macroTrace, lastMacroEvent
    macroTrace[logical] := detail
    lastMacroEvent := UnixMs() "|" logical "|" detail
    WriteStatus()
}

AddMacroAction(logical, input) {
    global macroOwnedActions
    owned := macroOwnedActions[logical]
    owned[input] := (owned.Has(input) ? owned[input] : 0) + 1
    AddAction(input)
}

ReleaseMacroAction(logical, input) {
    global macroOwnedActions
    owned := macroOwnedActions[logical]
    if !owned.Has(input) || owned[input] < 1
        return
    owned[input] -= 1
    ReleaseAction(input)
}

ReleaseMacroOwnedActions(logical) {
    global macroOwnedActions
    owned := macroOwnedActions[logical]
    for input, count in owned {
        Loop count
            ReleaseAction(input)
    }
    macroOwnedActions[logical] := Map()
}

ReadConfigInt(section, key, fallback, minValue, maxValue) {
    global CONFIG_INI
    value := IniRead(CONFIG_INI, section, key, fallback "")
    if !RegExMatch(value, "^\d+$")
        return ""
    value := Integer(value)
    return value >= minValue && value <= maxValue ? value : ""
}

ReadMacroSteps(section) {
    global CONFIG_INI
    count := ReadConfigInt(section, "macroStepCount", 0, 1, 100)
    if count = ""
        return false
    held := Map(), steps := [], totalWait := 0
    Loop count {
        raw := IniRead(CONFIG_INI, section, "macroStep" A_Index, ""), parts := StrSplit(raw, "|")
        if parts.Length != 2
            return false
        kind := parts[1], value := parts[2]
        if kind = "wait" {
            if !RegExMatch(value, "^\d+$") || Integer(value) > 10000
                return false
            totalWait += Integer(value)
            if totalWait > 60000
                return false
            steps.Push({kind: kind, value: Integer(value)})
            continue
        }
        if (kind != "press" && kind != "release") || !IsActionInput(value)
            return false
        current := held.Has(value) ? held[value] : 0
        if kind = "release" && current = 0
            return false
        held[value] := kind = "press" ? current + 1 : current - 1
        steps.Push({kind: kind, value: value})
    }
    for _, heldCount in held {
        if heldCount != 0
            return false
    }
    return steps
}

IsActionInput(input) {
    global INPUT_BUTTON, BACK_DPAD
    return INPUT_BUTTON.Has(input) || BACK_DPAD.Has(input) || input = "LT" || input = "RT"
}
AddAction(input) {
    global actionCount
    actionCount[input] := (actionCount.Has(input) ? actionCount[input] : 0) + 1
}
ReleaseAction(input) {
    global actionCount
    if actionCount.Has(input) && actionCount[input] > 0
        actionCount[input] -= 1
}
ActionDown(input) {
    global actionCount
    return actionCount.Has(input) && actionCount[input] > 0
}
ActionDownVjoy(button) {
    global INPUT_BUTTON
    for input, mappedButton in INPUT_BUTTON {
        if mappedButton = button && ActionDown(input)
            return true
    }
    return false
}
BackDpadBits() {
    global BACK_DPAD
    bits := 0
    for input, bit in BACK_DPAD {
        if ActionDown(input)
            bits |= bit
    }
    return bits
}
AnyBackActionActive() {
    global backState, sourceLatched
    for _, active in backState {
        if active
            return true
    }
    for _, latched in sourceLatched {
        if latched
            return true
    }
    return false
}
ClearSynthetic() {
    global actionCount, backState, sourceLatched, repeatTimers, macroTimers, macroRun, macroTrace, macroWaitUntil, macroIgnoredPulses, macroOwnedActions, lastMacroEvent
    for _, timer in repeatTimers
        SetTimer timer, 0
    for _, timer in macroTimers
        SetTimer timer, 0
    actionCount := Map()
    for logical in ["P1", "P2", "P3", "P4"] {
        backState[logical] := false
        sourceLatched[logical] := false
        macroWaitUntil[logical] := 0
        macroIgnoredPulses[logical] := 0
        macroOwnedActions[logical] := Map()
        macroTrace[logical] := "run=" macroRun[logical] "; cleared"
    }
    lastMacroEvent := UnixMs() "|all|synthetic-input-cleared"
}
IsValidBinding(mode, input) {
    if mode = "macro"
        return true
    if mode != "tap" && mode != "hold" && mode != "repeat"
        return false
    return IsActionInput(input)
}
WriteStatus(*) {
    global
    IniWrite "running", STATUS_INI, "executor", "state"
    IniWrite ProcessExist(), STATUS_INI, "executor", "pid"
    IniWrite configRevision, STATUS_INI, "executor", "activeRevision"
    IniWrite (AnyBackActionActive() ? "busy" : "idle"), STATUS_INI, "executor", "actionState"
    IniWrite executorError, STATUS_INI, "executor", "error"
    IniWrite xuser, STATUS_INI, "executor", "xinputUser"
    IniWrite (inputConnected ? "connected" : "disconnected"), STATUS_INI, "executor", "inputState"
    IniWrite (vjoyReady ? "acquired" : "unavailable"), STATUS_INI, "executor", "vjoyState"
    IniWrite povMode, STATUS_INI, "executor", "vjoyPovMode"
    IniWrite lastReloadRequestAt, STATUS_INI, "executor", "reloadRequestAt"
    IniWrite lastMacroEvent, STATUS_INI, "executor", "lastMacroEvent"
    IniWrite ActiveActionSummary(), STATUS_INI, "executor", "activeActions"
    for logical in ["P1", "P2", "P3", "P4"] {
        IniWrite macroTrace[logical], STATUS_INI, "executor", "macro" logical
        IniWrite macroWaitUntil[logical], STATUS_INI, "executor", "macro" logical "WaitUntil"
        IniWrite macroIgnoredPulses[logical], STATUS_INI, "executor", "macro" logical "IgnoredPulses"
    }
    IniWrite UnixMs(), STATUS_INI, "executor", "updatedAt"
}

ActiveActionSummary() {
    global actionCount
    summary := ""
    for input, count in actionCount {
        if count > 0
            summary .= (summary = "" ? "" : ", ") input "=" count
    }
    return summary = "" ? "none" : summary
}
UnixMs() => DateDiff(A_NowUTC, "19700101000000", "Seconds") * 1000
XInputToVjoy(value, axis) {
    global axisMin, axisMax
    value := ApplyDeadzone(value)
    normalized := (value + 32768) / 65535
    return Min(axisMax[axis], Max(axisMin[axis], Round(axisMin[axis] + normalized * (axisMax[axis] - axisMin[axis]))))
}
ApplyDeadzone(value) => Abs(value) < DEADZONE ? 0 : value
TriggerToAxis(value) => Round(value / 255 * 65535) - 32768
DpadToPov(buttons) {
    up := buttons & 0x0001, down := buttons & 0x0002, left := buttons & 0x0004, right := buttons & 0x0008
    if (!up && !down && !left && !right)
        return -1
    if (up && !left && !right)
        return 0
    if (up && right)
        return 4500
    if (right && !up && !down)
        return 9000
    if (down && right)
        return 13500
    if (down && !left && !right)
        return 18000
    if (down && left)
        return 22500
    if (left && !up && !down)
        return 27000
    if (up && left)
        return 31500
    return -1
}
Cleanup(*) {
    global STATUS_INI, vjoyID, vjoyReady
    ClearSynthetic()
    ResetVJD(vjoyID)
    RelinquishVJD(vjoyID)
    vjoyReady := false
    IniWrite "stopped", STATUS_INI, "executor", "state"
    IniWrite UnixMs(), STATUS_INI, "executor", "updatedAt"
}

^!F5::MsgBox "Merge active: XInput #" xuser " to vJoy #" vjoyID
^!F6::Suspend

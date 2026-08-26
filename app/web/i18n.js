(() => {
  const STORAGE_KEY = "gamesir-config-language";
  const locale = localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh-CN";
  document.documentElement.lang = locale;

  const phrases = {
    "GameSir 配置中心": "GameSir Configuration Center",
    "虚拟 Xbox 配置中心": "Virtual Xbox Configuration Center",
    "关闭本会话全部组件": "Stop all session components",
    "XOutput 配置保护": "XOutput Configuration Protection",
    "正在检查 XOutput 配置文件。": "Checking the XOutput configuration file.",
    "配置档切换不会改变 Nexus 的键盘来源。": "Switching profiles does not change the Nexus keyboard sources.",
    "恢复将覆盖 XOutput 当前 settings.json；恢复前会保留当前文件的隔离副本。确认 XOutput 已完全退出后继续？": "Restoring will replace XOutput's current settings.json. The current file will be quarantined first. Continue after confirming XOutput has fully exited?",
    "请先停止并退出 XOutput，再恢复配置。": "Stop and exit XOutput before restoring the configuration.",
    "恢复前会保留当前文件的隔离副本。": "The current file will be quarantined before restoration.",
    "尚无可恢复备份。请在 XOutput 主窗口点击 Save configuration 后，再点击“备份当前配置”。": "No restorable backup is available. Click Save configuration in XOutput, then click Back up current configuration.",
    "切换到 XOutput 窗口，在 Game Controllers 的 Controller 行点击 Start。只有按钮变为 Stop 才表示虚拟 Xbox 已启动。": "Switch to XOutput and click Start on the Controller row under Game Controllers. The virtual Xbox is running only when the button changes to Stop.",
    "先完成四个背键验证；完成后这里会显示启动指引。": "Verify all four back buttons first; startup guidance will then appear here.",
    "阻断：AHK 未连接到实体 GameSir，背键验证不会收到任何按键。请在上方“实体槽位”依次选择 XInput #1、#2、#3，保存后重新点击“检查环境”，直到这里显示“已连接”。": "Blocked: AHK is not connected to the physical GameSir, so back-button verification cannot receive input. Try XInput #1, #2, and #3 under Physical slot, save, and run Check environment again until Connected is shown.",
    "设置完成：可使用虚拟 Xbox": "Setup complete: virtual Xbox is ready",
    "按以下步骤完成设置": "Complete setup with the following steps",
    "第 1 步：设备与执行链路": "Step 1: Devices and execution chain",
    "第 2 步：逐个验证背键": "Step 2: Verify each back button",
    "第 3 步：启动虚拟 Xbox 输出": "Step 3: Start virtual Xbox output",
    "会启动或复用 AHK 与 XOutput，然后检查环境": "Starts or reuses AHK and XOutput, then checks the environment",
    "当前由宏保持的虚拟按键：": "Virtual buttons currently held by macros: ",
    "最近宏事件：尚未执行。": "Latest macro event: none yet.",
    "尚未收到宏事件。": "No macro events received yet.",
    "当前虚拟按键：无": "Current virtual buttons: none",
    "实体槽位已保存，等待 AHK 安全加载": "Physical slot saved; waiting for AHK to load it at a safe point",
    "请在 20 秒内按下背键": "Press the back button within 20 seconds",
    "已识别并应用": "Detected and applied",
    "正在验证背键": "Verifying back button",
    "请在 20 秒内按一次实体背键。": "Press the physical back button once within 20 seconds.",
    "验证超时：未收到按键。请确认实体手柄槽位已连接后重试。": "Verification timed out: no input was received. Confirm the physical controller slot is connected and try again.",
    "背键验证失败。": "Back-button verification failed.",
    "验证成功，收到": "Verified; received ",
    "等待剩余约": "approximately remaining wait: ",
    "已忽略后续脉冲": "subsequent pulses ignored: ",
    "已保存：AHK 已加载 revision #": "Saved: AHK loaded revision #",
    "已保存 revision #": "Saved revision #",
    "但 AHK 加载失败：": "but AHK failed to load: ",
    "当前 revision 未知": "current revision unknown",
    "配置已备份：": "Configuration backed up: ",
    "无法备份 XOutput 配置：": "Unable to back up XOutput configuration: ",
    "无法恢复 XOutput 配置：": "Unable to restore XOutput configuration: ",
    "最近宏事件：": "Latest macro event: ",
    "未知错误": "unknown error",
    "已备份的 vJoy-only 配置": "Backed-up vJoy-only configuration",
    "无法读取 XOutput 配置。": "Unable to read the XOutput configuration.",
    "备份当前配置": "Back up current configuration",
    "恢复此备份": "Restore this backup",
    "已验证备份：": "Verified backup: ",
    "状态：": "Status: ",
    "需要处理": "Action required",
    "服务未连接": "Service disconnected",
    "服务已连接": "Service connected",
    "服务": "Service",
    "检查中": "Checking",
    "待接入": "Waiting",
    "待检查": "Pending check",
    "当前 revision": "Current revision",
    "运行状态": "Runtime status",
    "宏诊断": "Macro diagnostics",
    "收起宏诊断": "Hide macro diagnostics",
    "配置档操作": "Profile actions",
    "当前配置档": "Current profile",
    "配置档": "Profile",
    "新建配置档": "New profile",
    "重命名": "Rename",
    "删除": "Delete",
    "导出": "Export",
    "导入": "Import",
    "实体槽位": "Physical slot",
    "实体 GameSir 的 XInput 槽位": "Physical GameSir XInput slot",
    "检查环境": "Check environment",
    "保存配置": "Save configuration",
    "背键映射": "Back-button mappings",
    "键盘来源": "Keyboard source",
    "识别": "Detect",
    "动作": "Action",
    "单次": "Tap",
    "按住": "Hold",
    "连发": "Repeat",
    "Xbox 输入": "Xbox input",
    "首次延迟 ms": "Initial delay (ms)",
    "间隔 ms": "Interval (ms)",
    "停止": "Stop",
    "松开停止": "Stop on release",
    "固定次数": "Fixed count",
    "次数": "Count",
    "添加按下": "Add press",
    "添加释放": "Add release",
    "添加等待": "Add wait",
    "宏": "Macro",
    "按下": "Press",
    "释放": "Release",
    "等待": "Wait",
    "移除": "Remove",
    "上移步骤": "Move step up",
    "下移步骤": "Move step down",
    "背键": "Back button",
    "当前": "Current",
    "有未保存修改": "Unsaved changes",
    "正在保存...": "Saving...",
    "新配置档名称": "New profile name",
    "配置档名称": "Profile name",
    "删除配置档“": "Delete profile \"",
    "”？": "\"?",
    "请求失败": "Request failed",
    "未连接": "Disconnected",
    "未运行": "Not running",
    "运行中": "Running",
    "本会话": "This session: ",
    "外部": "External: ",
    "实体已连接": "physical controller connected",
    "实体 GameSir 未连接": "physical GameSir disconnected",
    "配置错误：": "Configuration error: ",
    "重新验证": "Verify again",
    "正在等待按键…": "Waiting for input…",
    "验证背键": "Verify back button",
    "验证成功：": "Verification succeeded: ",
    "验证失败：": "Verification failed: ",
    "背键识别超时。": "Back-button detection timed out.",
    "背键识别失败。": "Back-button detection failed.",
    "正在启动或复用 AHK 与 XOutput，然后检查环境…": "Starting or reusing AHK and XOutput, then checking the environment…",
    "环境检查完成：": "Environment check complete: ",
    "环境检查失败：": "Environment check failed: ",
    "已确认 XOutput 虚拟 Xbox 输出。": "XOutput virtual Xbox output confirmed.",
    "已变为 Stop，确认输出": "It shows Stop — confirm output",
    "虚拟 Xbox 输出已确认。": "Virtual Xbox output confirmed.",
    "当前 #": "current #",
    "等待 AHK 连接": "waiting for AHK",
    "等待 AHK 下一次安全点": "waiting for AHK's next safe point",
    "等待当前宏或连发结束": "waiting for the current macro or repeat action to finish",
    "其他页面已修改配置；请保存或重新加载。": "Configuration changed in another page; save or reload.",
    "字节": "bytes"
  };
  const entries = Object.entries(phrases).sort((a, b) => b[0].length - a[0].length);
  const translate = (value) => locale === "en" ? entries.reduce((text, [zh, en]) => text.split(zh).join(en), String(value)) : String(value);

  function translateTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) node.nodeValue = translate(node.nodeValue);
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    root.querySelectorAll?.("[title],[aria-label],[placeholder]").forEach(translateAttributes);
    document.title = translate(document.title);
  }
  function translateAttributes(element) {
    for (const name of ["title", "aria-label", "placeholder"]) {
      if (element.hasAttribute?.(name)) element.setAttribute(name, translate(element.getAttribute(name)));
    }
  }

  const originalPrompt = window.prompt.bind(window);
  const originalConfirm = window.confirm.bind(window);
  window.prompt = (message, value) => originalPrompt(translate(message), value);
  window.confirm = (message) => originalConfirm(translate(message));
  window.gamesirI18n = { locale, translate };

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector("#language-toggle");
    toggle.textContent = locale === "en" ? "中文" : "English";
    toggle.setAttribute("aria-label", locale === "en" ? "切换到中文" : "Switch to English");
    toggle.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEY, locale === "en" ? "zh-CN" : "en");
      location.reload();
    });
    if (locale !== "en") return;
    translateTree(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) node.nodeValue = translate(node.nodeValue);
          else if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
})();

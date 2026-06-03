const DEFAULT_BACKEND = "https://vinhaccplus.vercel.app";
const DEFAULT_EXTENSION_TOKEN =
  "b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b";
const DEFAULT_ACCOUNT_MODE = "gpt_free";
const DEFAULT_FREE_BATCH_TARGET = 3;

const $ = (id) => document.getElementById(id);

const refs = {
  startBtn: $("startBtn"),
  stopBtn: $("stopBtn"),
  hardStopBtn: $("hardStopBtn"),
  toggleAdvancedBtn: $("toggleAdvancedBtn"),
  advancedSettings: $("advancedSettings"),
  subBtn: $("subBtn"),
  pushBtn: $("pushBtn"),
  logBox: $("logBox"),
  statusText: $("statusText"),
  jobInfo: $("setupJobInfo"),
  email: $("setupCurrentEmail"),
  checkoutInfo: $("checkoutInfo"),
  password: $("password"),
  autoPassword: $("autoPassword"),
  regenPasswordBtn: $("regenPasswordBtn"),
  mailSite: $("mailSite"),
  accountMode: $("accountMode"),
  freeBatchBox: $("freeBatchBox"),
  freeBatchTarget: $("freeBatchTarget"),
  hotmailGroup: $("hotmailGroup"),
  hotmailFile: $("hotmailFile"),
  hotmailCount: $("hotmailCount"),
  gmailConfig: $("gmail_dot_config"),
  addrMode: $("addr-mode"),
  addrInput: $("addr-input"),
  saveAddrBtn: $("btn-save-addr"),
  resetAddrBtn: $("btn-reset-addr"),
  reLoginExpiredBtn: $("reLoginExpiredBtn")
};

let isStarting = false;
let currentJob = null;

function normalizeAccountMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["gpt_free", "free", "chatgpt_free"].includes(mode) ? "gpt_free" : "plus_trial";
}

function isGptFreeJob(job) {
  return normalizeAccountMode(job?.accountMode) === "gpt_free";
}

function normalizeFreeBatchTarget(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.min(number, 500);
}

const ADDRESS_MODE_DEFAULT = "random_indonesia";
const ADDRESS_MODE_LEGACY_DEFAULT = "random_kr_indo_mix";
const ADDRESS_MODE_DEFAULT_MIGRATION_KEY = "af_address_default_indonesia_v1";
const ADDRESS_MODE_PLACEHOLDERS = {
  random_kr_indo_mix: "John Vinh|South Korea|Seoul|Sidoarjo|Jl. Sudirman No. 52|61212",
  random_us_indo_mix: "John Carter|United States|California|Sidoarjo|Jl. Pahlawan No. 31|61212",
  random_uk_indo_mix: "Oliver Smith|United Kingdom|England|Sidoarjo|Jl. Sudirman No. 52|61212",
  random_kr: "Minjun Kim|South Korea|Seoul|Seoul|43, Noksapyeong-daero 26-gil|04345",
  random_us: "John Carter|United States|California|Los Angeles|845 S Figueroa St|90001",
  random_uk: "Oliver Smith|United Kingdom|England|London|63 Lower White Road|B32 2RU",
  random_jp: "Taro Sato|Japan|Tokyo|Tokyo|1-1 Chiyoda|100-0001",
  random_indonesia: "Budi Santoso|Indonesia|Jawa Timur|Sidoarjo|Jl. Pahlawan No. 31|61212",
  random_india: "Arjun Mehta|India|Delhi|New Delhi|52 Connaught Place|110001",
  random_algeria: "Yacine Benali|Algeria|Algiers Province|Algiers|12 Rue Didouche Mourad|16000",
  random_kazakhstan: "Aruzhan Bek|Kazakhstan|Almaty|Almaty|63 Abylai Khan Ave|050000",
  random_chile: "Matias Gonzalez|Chile|Santiago Metropolitan|Santiago|123 Avenida Libertador Bernardo O'Higgins|8320000",
  random_any: "Random Any (Global)",
  fixed_kr: "Minjun Kim|South Korea|Seoul|Seoul|43, Noksapyeong-daero 26-gil|04345",
  fixed_us: "John Carter|United States|California|Los Angeles|845 S Figueroa St|90001",
  fixed_uk: "Oliver Smith|United Kingdom|England|London|63 Lower White Road|B32 2RU",
  fixed_jp: "Taro Sato|Japan|Tokyo|Tokyo|1-1 Chiyoda|100-0001",
  fixed_indonesia: "Budi Santoso|Indonesia|Jawa Timur|Sidoarjo|Jl. Pahlawan No. 31|61212",
  fixed_india: "Arjun Mehta|India|Delhi|New Delhi|52 Connaught Place|110001",
  fixed_algeria: "Yacine Benali|Algeria|Algiers Province|Algiers|12 Rue Didouche Mourad|16000",
  fixed_kazakhstan: "Aruzhan Bek|Kazakhstan|Almaty|Almaty|63 Abylai Khan Ave|050000",
  fixed_chile: "Matias Gonzalez|Chile|Santiago Metropolitan|Santiago|123 Avenida Libertador Bernardo O'Higgins|8320000"
};

function normalizeAddressMode(mode) {
  return Object.prototype.hasOwnProperty.call(ADDRESS_MODE_PLACEHOLDERS, mode)
    ? mode
    : ADDRESS_MODE_DEFAULT;
}

function resolveStoredAddressMode(data) {
  const rawMode = data?.addressMode;
  if (data?.[ADDRESS_MODE_DEFAULT_MIGRATION_KEY]) {
    return normalizeAddressMode(rawMode);
  }
  const shouldUseIndonesiaDefault = !rawMode || rawMode === ADDRESS_MODE_LEGACY_DEFAULT;
  storageSet({
    [ADDRESS_MODE_DEFAULT_MIGRATION_KEY]: true,
    ...(shouldUseIndonesiaDefault ? { addressMode: ADDRESS_MODE_DEFAULT, lockedAddrData: null, lockedAddrMode: "" } : {})
  });
  return normalizeAddressMode(shouldUseIndonesiaDefault ? ADDRESS_MODE_DEFAULT : rawMode);
}

function updateAddressModeUi(mode) {
  const normalized = normalizeAddressMode(mode);
  if (refs.addrMode) refs.addrMode.value = normalized;
  if (refs.addrInput) refs.addrInput.placeholder = ADDRESS_MODE_PLACEHOLDERS[normalized] || "";
}

const STEP_ORDER = [
  "step-reg",
  "step-otp",
  "step-profile",
  "step-2fa",
  "step-checkout",
  "step-payment",
  "step-push"
];

const STEP_MAP = {
  reg: "step-reg",
  otp: "step-otp",
  profile: "step-profile",
  "2fa": "step-2fa",
  navigate_promo: "step-checkout",
  billing: "step-checkout",
  checkout_link: "step-checkout",
  await_payment: "step-payment",
  paused: "step-manual",
  wait_success: "step-push",
  await_push: "step-push",
  logout_pending: "step-push",
  pushed: "step-push",
  manual_needed: "step-manual"
};

function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function shuffleWithCrypto(chars) {
  const list = Array.from(chars);
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.join("");
}

function generateStrongPassword() {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = lower + upper + digits + symbols;
  const length = 14 + randomInt(3);
  let value =
    lower[randomInt(lower.length)] +
    upper[randomInt(upper.length)] +
    digits[randomInt(digits.length)] +
    symbols[randomInt(symbols.length)];
  while (value.length < length) value += all[randomInt(all.length)];
  return shuffleWithCrypto(value);
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function tabsQuery(query) {
  return new Promise(resolve => chrome.tabs.query(query, resolve));
}

function updateLogs(text) {
  refs.logBox.innerText = String(text || "Sẵn sàng.").trim() || "Sẵn sàng.";
  refs.logBox.scrollTop = refs.logBox.scrollHeight;
}

function setStep(step) {
  const current = STEP_MAP[step] || null;
  const currentIndex = STEP_ORDER.indexOf(current);
  for (const id of [...STEP_ORDER, "step-manual"]) {
    const el = $(id);
    if (!el) continue;
    el.classList.remove("active", "done", "warn");
    if (step === "manual_needed" && id === "step-manual") {
      el.classList.add("warn");
      continue;
    }
    const index = STEP_ORDER.indexOf(id);
    if (id === current) el.classList.add("active");
    if (currentIndex > -1 && index > -1 && index < currentIndex) el.classList.add("done");
  }
  if (step === "pushed") $("step-push")?.classList.add("done");
}

function statusLabel(job) {
  const step = String(job?.step || "ready");
  const labels = {
    reg: "Đang đăng ký",
    otp: "Đang chờ OTP",
    profile: "Đang điền hồ sơ",
    "2fa": "Đang bật 2FA",
    navigate_promo: "Đang mở ưu đãi",
    billing: "Đang vào thanh toán",
    checkout_link: "Đang tạo link checkout",
    await_payment: "Đã mở checkout, chờ thanh toán",
    paused: "Đã dừng tạm, có thể tiếp tục",
    wait_success: "Đã thấy thanh toán, chờ Push",
    await_push: "Sẵn sàng Push",
    logout_pending: "Đã Push, đang chờ logout",
    pushed: "Đã Push",
    manual_needed: "Cần xử lý thủ công"
  };
  if (isGptFreeJob(job)) {
    if (step === "await_push") return "GPT Free dang auto Push";
    if (step === "logout_pending") return "GPT Free da Push, dang logout";
    if (step === "pushed") return "GPT Free da Push";
  }
  return labels[step] || step;
}

async function getCurrentWindowContext() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs?.[0] || null;
  return { tabId: tab?.id || 0, windowId: tab?.windowId || 0 };
}

function pickJob(jobs, tabId, windowId) {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  const byActiveTab = jobs.find(job => Number(job.tabId) === Number(tabId));
  if (byActiveTab) return byActiveTab;
  const byCheckoutTab = jobs.find(job => Number(job.checkoutTabId) === Number(tabId));
  if (byCheckoutTab) return byCheckoutTab;
  const byWindow = jobs.filter(job => Number(job.windowId) === Number(windowId));
  const pool = byWindow.length ? byWindow : jobs;
  return pool.sort((a, b) => {
    const av = Number(a.pushedAt || a.checkoutRequestedAt || String(a.jobId || "").replace(/\D/g, "") || 0);
    const bv = Number(b.pushedAt || b.checkoutRequestedAt || String(b.jobId || "").replace(/\D/g, "") || 0);
    return bv - av;
  })[0] || null;
}

function updateJobUi(job) {
  currentJob = job || null;
  const hasJob = !!currentJob;

  syncPasswordFromJob(currentJob);

  refs.jobInfo.style.display = hasJob ? "block" : "none";
  refs.email.innerText = currentJob?.email || "...";
  refs.statusText.innerText = hasJob ? `Trạng thái: ${statusLabel(currentJob)}` : "Sẵn sàng";
  const isFreeJob = isGptFreeJob(currentJob);
  refs.checkoutInfo.innerText = isFreeJob
    ? `GPT Free batch: ${Number(currentJob?.freeBatchDone || 0)}/${Number(currentJob?.freeBatchTarget || 1)} pushed`
    : (currentJob?.checkoutTabId
      ? `Checkout: ${currentJob.checkoutCountry || "?"}/${currentJob.checkoutCurrency || "?"} tab=${currentJob.checkoutTabId || "-"}`
      : "");

  updateLogs(currentJob?.logs || (hasJob ? "" : "Sẵn sàng."));
  setStep(currentJob?.step || null);

  const paused = !!currentJob?.paused;
  refs.startBtn.innerText = hasJob || isStarting ? (paused ? "Đang dừng" : "Đang chạy...") : "Bắt đầu";
  refs.startBtn.classList.toggle("running", hasJob || isStarting);
  refs.startBtn.disabled = hasJob || isStarting;
  refs.stopBtn.innerText = paused ? "Tiếp tục" : "Dừng";
  refs.stopBtn.disabled = !hasJob;
  refs.hardStopBtn.disabled = !hasJob;

  const logoutPending = currentJob?.step === "logout_pending";
  refs.subBtn.disabled = paused || isFreeJob || !currentJob?.checkoutTabId || currentJob?.pushed;
  refs.pushBtn.disabled = paused || !currentJob || (currentJob.pushed && !logoutPending) || !currentJob.email || !currentJob.password || !currentJob.secret;
  refs.pushBtn.innerText = logoutPending
    ? "Retry logout"
    : (isFreeJob ? "Push Free" : "Push");
}

async function syncPasswordFromJob(job) {
  const jobPassword = String(job?.password || "").trim();
  if (!refs.autoPassword.checked || !jobPassword) return;
  if (refs.password.value === jobPassword) return;

  refs.password.value = jobPassword;
  await storageSet({ password: jobPassword });
}

async function refreshData() {
  const { tabId, windowId } = await getCurrentWindowContext();
  const response = await sendMessage({ type: "GET_ACTIVE_JOBS" });
  if (response?.success) {
    updateJobUi(pickJob(response.jobs, tabId, windowId));
  } else {
    const job = await sendMessage({ type: "GET_JOB_DATA", tabId });
    updateJobUi(job && !job.error ? job : null);
  }
  updateCookieStatusUi();
}

function syncPasswordMode() {
  refs.password.readOnly = refs.autoPassword.checked;
  if (refs.autoPassword.checked && !refs.password.value.trim()) {
    refs.password.value = generateStrongPassword();
  }
}

function syncAccountModeUi() {
  const mode = normalizeAccountMode(refs.accountMode?.value);
  if (refs.accountMode) refs.accountMode.value = mode;
  if (refs.freeBatchBox) refs.freeBatchBox.style.display = mode === "gpt_free" ? "block" : "none";
  if (refs.freeBatchTarget) refs.freeBatchTarget.value = normalizeFreeBatchTarget(refs.freeBatchTarget.value);
}

function syncAdvancedSettingsUi(open) {
  const shouldOpen = !!open;
  document.body.classList.toggle("show-advanced", shouldOpen);
  if (refs.toggleAdvancedBtn) {
    refs.toggleAdvancedBtn.innerText = shouldOpen ? "An cai dat nang cao" : "Cai dat nang cao";
  }
}

function getSettingsPayload(options = {}) {
  if (refs.autoPassword.checked && (options.rotatePassword || !refs.password.value.trim())) {
    refs.password.value = generateStrongPassword();
  }
  const accountMode = normalizeAccountMode(refs.accountMode?.value);
  const freeBatchTarget = normalizeFreeBatchTarget(refs.freeBatchTarget?.value);
  return {
    password: refs.password.value,
    autoPassword: refs.autoPassword.checked,
    mailSite: refs.mailSite.value,
    accountMode,
    freeBatchTarget,
    freeBatchDone: accountMode === "gpt_free" ? Number(options.freeBatchDone || 0) : 0,
    freeBatchActive: accountMode === "gpt_free" && !!options.freeBatchActive,
    freeTargetShelf: "none",
    autoRestart: $("autoRestart").checked,
    autoReLogin: $("autoReLogin").checked,
    proxyString: $("proxyString").value,
    rotateUrl: $("rotateUrl").value,
    gmail_root: $("gmail_root").value,
    gmail_script_url: $("gmail_script_url").value,
    backendBaseUrl: $("backendBaseUrl").value.trim() || DEFAULT_BACKEND,
    extensionPushToken: $("extensionPushToken").value.trim() || DEFAULT_EXTENSION_TOKEN,
    extensionWorkerId: "",
    trialCountry: $("trialCountry").value,
    trialProxyMode: $("trialProxyMode").value,
    addressMode: normalizeAddressMode(refs.addrMode?.value),
    addresses: refs.addrInput?.value || "",
    manualNamePrefix: $("manualNamePrefix").value.trim() || "CodexAcc",
    manualAutoPush: $("manualAutoPush").checked
  };
}

async function saveSettings() {
  await storageSet(getSettingsPayload());
}

refs.regenPasswordBtn.addEventListener("click", async () => {
  refs.password.value = generateStrongPassword();
  await storageSet({ password: refs.password.value });
});

refs.autoPassword.addEventListener("change", async () => {
  syncPasswordMode();
  await storageSet({ autoPassword: refs.autoPassword.checked, password: refs.password.value });
});

refs.toggleAdvancedBtn?.addEventListener("click", async () => {
  const nextOpen = !document.body.classList.contains("show-advanced");
  syncAdvancedSettingsUi(nextOpen);
  await storageSet({ showAdvancedSettings: nextOpen });
});

refs.accountMode?.addEventListener("change", async () => {
  syncAccountModeUi();
  await saveSettings();
});

refs.freeBatchTarget?.addEventListener("input", async () => {
  syncAccountModeUi();
  await saveSettings();
});

refs.addrMode?.addEventListener("change", async () => {
  const mode = normalizeAddressMode(refs.addrMode.value);
  updateAddressModeUi(mode);
  await storageSet({ addressMode: mode, lockedAddrData: null, lockedAddrMode: "" });
});

refs.saveAddrBtn?.addEventListener("click", async () => {
  const mode = normalizeAddressMode(refs.addrMode?.value);
  await storageSet({
    addresses: refs.addrInput?.value || "",
    addressMode: mode,
    lockedAddrData: null,
    lockedAddrMode: ""
  });
  updateAddressModeUi(mode);
  updateLogs("Da luu mode/danh sach dia chi Sub.");
});

refs.resetAddrBtn?.addEventListener("click", async () => {
  await storageSet({
    addresses: "",
    addressMode: ADDRESS_MODE_DEFAULT,
    lockedAddrData: null,
    lockedAddrMode: "",
    [ADDRESS_MODE_DEFAULT_MIGRATION_KEY]: true
  });
  if (refs.addrInput) refs.addrInput.value = "";
  updateAddressModeUi(ADDRESS_MODE_DEFAULT);
  updateLogs("Da reset dia chi Sub ve Default Indonesia.");
});

refs.startBtn.addEventListener("click", async () => {
  const settings = getSettingsPayload({ rotatePassword: true, freeBatchActive: true });
  await storageSet(settings);

  isStarting = true;
  refs.startBtn.disabled = true;
  refs.startBtn.classList.add("running");
  refs.startBtn.innerText = "Đang chạy...";
  refs.statusText.innerText = settings.mailSite === "hotmail_backend"
    ? "Đang lấy Hotmail backend trực tiếp..."
    : "Đang bắt đầu...";
  updateLogs(settings.mailSite === "hotmail_backend"
    ? "Đang reserve Hotmail trực tiếp từ backend."
    : "Đang bắt đầu job...");

  const res = await sendMessage({
    type: "START_JOB",
    password: settings.password,
    autoPassword: settings.autoPassword,
    mailSite: settings.mailSite,
    autoRestart: settings.autoRestart,
    proxyString: settings.proxyString,
    rotateUrl: settings.rotateUrl,
    accountMode: settings.accountMode,
    freeBatchTarget: settings.freeBatchTarget,
    freeBatchDone: 0,
    freeBatchActive: settings.accountMode === "gpt_free",
    freeTargetShelf: "none"
  });

  isStarting = false;
  if (res?.success && res.password) {
    refs.password.value = res.password;
    await storageSet({ password: res.password });
  } else if (!res?.success) {
    const data = await storageGet("startup_log");
    updateLogs(`${data.startup_log || ""}\nLỗi bắt đầu: ${res?.error || "Không rõ"}`.trim());
    alert(`Lỗi bắt đầu: ${res?.error || "Không rõ"}`);
  }
  refreshData();
});

refs.stopBtn.addEventListener("click", async () => {
  if (!currentJob) return;
  const type = currentJob.paused ? "RESUME_JOB" : "PAUSE_JOB";
  const res = await sendMessage({ type, tabId: currentJob.tabId, jobId: currentJob.jobId });
  if (!res?.success) alert(res?.error || "Không xử lý được job.");
  refreshData();
});

refs.hardStopBtn.addEventListener("click", async () => {
  if (!currentJob) return;
  await sendMessage({ type: "STOP_JOB_HARD", tabId: currentJob.tabId, jobId: currentJob.jobId, checkoutTabId: currentJob.checkoutTabId });
  currentJob = null;
  refreshData();
});

refs.subBtn.addEventListener("click", async () => {
  if (!currentJob?.checkoutTabId) return;
  refs.subBtn.disabled = true;
  refs.subBtn.innerText = "Đang Sub...";
  const res = await sendMessage({
    type: "RUN_CHECKOUT_SUB",
    tabId: currentJob.tabId,
    jobId: currentJob.jobId,
    checkoutTabId: currentJob.checkoutTabId
  });
  refs.subBtn.innerText = "Sub";
  if (!res?.success) {
    alert(`Sub lỗi: ${res?.error || "Không rõ"}`);
  }
  refreshData();
});

refs.pushBtn.addEventListener("click", async () => {
  if (!currentJob) return;
  await saveSettings();
  refs.pushBtn.disabled = true;
  refs.pushBtn.innerText = "Đang Push...";
  const res = await sendMessage({
    type: "PUSH_ACCOUNT",
    tabId: currentJob.tabId
  });
  refs.pushBtn.innerText = "Push";
  if (res?.success) {
    const pushedEmail = res.email || currentJob?.email || "";
    currentJob = null;
    updateJobUi(null);
    await refreshData();
    if (!currentJob) {
      updateLogs(`Da Push thanh cong${pushedEmail ? `: ${pushedEmail}` : ""}. San sang job moi.`);
    }
    return;
  }
  if (!res?.success) {
    alert(`Push lỗi: ${res?.error || "Không rõ"}`);
  }
  refreshData();
});

$("downloadDataBtn").addEventListener("click", async () => {
  const data = await storageGet("list_success");
  const list = data.list_success || [];
  if (!list.length) {
    alert("Chưa có data cũ trong extension.");
    return;
  }
  const blob = new Blob([list.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.txt";
  a.click();
  URL.revokeObjectURL(url);
});

$("clearBtn").addEventListener("click", async () => {
  if (!confirm("Xóa dữ liệu extension?")) return;
  await sendMessage({ type: "CLEAR_DATA" });
  await storageSet({ startup_log: "" });
  currentJob = null;
  refreshData();
});

function updateMailUi() {
  const isHotmailTxt = refs.mailSite.value === "hotmail_txt";
  refs.hotmailGroup.style.display = isHotmailTxt ? "block" : "none";
  refs.gmailConfig.style.display = refs.mailSite.value === "gmail_dot" ? "block" : "none";
  if (isHotmailTxt) {
    storageGet("hotmail_list").then((data) => {
      refs.hotmailCount.innerText = `Sẵn sàng: ${(data.hotmail_list || []).length} tài khoản`;
    });
  }
}

refs.mailSite.addEventListener("change", () => {
  updateMailUi();
  saveSettings();
});

refs.hotmailFile.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    const lines = String(evt.target.result || "").split(/\r?\n/);
    const accounts = [];
    for (const line of lines) {
      const parts = line.trim().split("|").map(part => part.trim());
      if (parts.length >= 4 && parts[0].includes("@")) {
        accounts.push({
          mail: parts[0],
          pass: parts[1] || "",
          refresh_token: parts[2] || "",
          client_id: parts[3] || "",
          secret2fa: parts[4] || ""
        });
      }
    }
    await storageSet({ hotmail_list: accounts });
    refs.hotmailCount.innerText = `Sẵn sàng: ${accounts.length} tài khoản`;
    alert(`Đã tải ${accounts.length} tài khoản Hotmail TXT.`);
  };
  reader.readAsText(file);
});

[
  "password",
  "mailSite",
  "accountMode",
  "freeBatchTarget",
  "autoRestart",
  "autoReLogin",
  "proxyString",
  "rotateUrl",
  "gmail_root",
  "gmail_script_url",
  "backendBaseUrl",
  "extensionPushToken",
  "trialCountry",
  "trialProxyMode",
  "addr-mode",
  "addr-input",
  "manualNamePrefix",
  "manualAutoPush"
].forEach((id) => {
  const el = $(id);
  if (!el) return;
  const eventName = el.type === "checkbox" ? "change" : "input";
  el.addEventListener(eventName, saveSettings);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOG_UPDATE" || msg.type === "STEP_UPDATE" || msg.type === "STATUS_UPDATE") {
    refreshData();
  } else if (msg.type === "STARTUP_LOG") {
    updateLogs(msg.text);
  }
});

async function boot() {
  const data = await storageGet([
    "password",
    "autoPassword",
    "mailSite",
    "accountMode",
    "freeBatchTarget",
    "freeBatchDone",
    "freeBatchActive",
    "autoRestart",
    "autoReLogin",
    "proxyString",
    "rotateUrl",
    "gmail_root",
    "gmail_script_url",
    "backendBaseUrl",
    "extensionPushToken",
    "trialCountry",
    "trialProxyMode",
    "addresses",
    "addressMode",
    ADDRESS_MODE_DEFAULT_MIGRATION_KEY,
    "showAdvancedSettings",
    "startup_log",
    "manualNamePrefix",
    "manualAutoPush"
  ]);

  refs.autoPassword.checked = data.autoPassword !== false;
  refs.password.value = data.password || generateStrongPassword();
  refs.mailSite.value = data.mailSite || "hotmail_backend";
  if (refs.accountMode) refs.accountMode.value = normalizeAccountMode(data.accountMode || DEFAULT_ACCOUNT_MODE);
  if (refs.freeBatchTarget) refs.freeBatchTarget.value = normalizeFreeBatchTarget(data.freeBatchTarget || DEFAULT_FREE_BATCH_TARGET);
  $("autoRestart").checked = !!data.autoRestart;
  $("autoReLogin").checked = !!data.autoReLogin;
  $("proxyString").value = data.proxyString || "";
  $("rotateUrl").value = data.rotateUrl || "";
  $("gmail_root").value = data.gmail_root || "";
  $("gmail_script_url").value = data.gmail_script_url || "";
  $("backendBaseUrl").value = data.backendBaseUrl || DEFAULT_BACKEND;
  $("extensionPushToken").value = data.extensionPushToken || DEFAULT_EXTENSION_TOKEN;
  $("trialCountry").value = data.trialCountry || "ID";
  $("trialProxyMode").value = data.trialProxyMode || "default";
  if (refs.addrInput) refs.addrInput.value = data.addresses || "";
  updateAddressModeUi(resolveStoredAddressMode(data));

  $("manualNamePrefix").value = data.manualNamePrefix || "CodexAcc";
  $("manualAutoPush").checked = !!data.manualAutoPush;

  syncPasswordMode();
  syncAccountModeUi();
  syncAdvancedSettingsUi(!!data.showAdvancedSettings);
  if (data.startup_log) updateLogs(data.startup_log);
  updateMailUi();
  refreshData();
  setInterval(refreshData, 2000);

  refs.reLoginExpiredBtn?.addEventListener("click", async () => {
    refs.reLoginExpiredBtn.disabled = true;
    const oldText = refs.reLoginExpiredBtn.innerText;
    refs.reLoginExpiredBtn.innerText = "Đang đồng bộ...";
    try {
      const res = await sendMessage({ type: "TRIGGER_AUTO_RELOGIN_NOW" });
      if (res && res.success) {
        alert("Đã kích hoạt re-login thành công: " + (res.message || ""));
      } else {
        alert("Lỗi re-login: " + (res?.error || "Không rõ nguyên nhân"));
      }
    } catch (err) {
      alert("Lỗi kết nối: " + err.message);
    } finally {
      refs.reLoginExpiredBtn.disabled = false;
      refs.reLoginExpiredBtn.innerText = oldText;
    }
  });

  // Manual Push handler
  $("manualPushBtn")?.addEventListener("click", async () => {
    if (!activeSessionToken) return;
    const statusBox = $("manualStatusBox");
    if (statusBox) {
      statusBox.className = "status-box";
      statusBox.style.display = "none";
    }

    const portalUrl = $("backendBaseUrl").value.trim().replace(/\/$/, "");
    const pushToken = $("extensionPushToken").value.trim();
    const namePrefix = $("manualNamePrefix").value.trim() || "CodexAcc";

    const pushBtn = $("manualPushBtn");
    pushBtn.disabled = true;
    const oldText = pushBtn.innerText;
    pushBtn.innerText = "Đang đẩy...";

    const username = `${namePrefix}-${Date.now().toString().slice(-6)}`;

    try {
      const resp = await fetch(`${portalUrl}/api/chatgpt-extension-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-extension-push-token": pushToken
        },
        body: JSON.stringify({
          username,
          sessionToken: activeSessionToken,
          deviceId: activeDeviceId
        })
      });

      const resData = await resp.json();
      if (resp.ok && resData.ok) {
        if (statusBox) {
          statusBox.className = "status-box success";
          statusBox.textContent = `Thành công! Đã đẩy '${username}' lên pool.`;
        }
      } else {
        if (statusBox) {
          statusBox.className = "status-box error";
          statusBox.textContent = `Lỗi: ${resData.error || "Không đẩy được session token."}`;
        }
      }
    } catch (err) {
      console.error(err);
      if (statusBox) {
        statusBox.className = "status-box error";
        statusBox.textContent = "Lỗi kết nối tới Portal backend.";
      }
    } finally {
      if (statusBox) statusBox.style.display = "block";
      pushBtn.disabled = false;
      pushBtn.innerText = oldText;
    }
  });

  // Manual OAuth handler
  $("manualOauthBtn")?.addEventListener("click", async () => {
    const statusBox = $("manualStatusBox");
    if (statusBox) {
      statusBox.className = "status-box";
      statusBox.style.display = "none";
    }

    await saveSettings();
    const oauthBtn = $("manualOauthBtn");
    oauthBtn.disabled = true;
    const oldText = oauthBtn.innerText;
    oauthBtn.innerText = "Đang kết nối...";

    try {
      const verifier = generateCodeVerifier();
      const challenge = await sha256(verifier).then(base64urlencode);
      const state = generateCodeVerifier().substring(0, 16);

      await storageSet({
        oauth_verifier: verifier,
        oauth_state: state
      });

      await sendMessage({
        type: "START_OAUTH",
        challenge: challenge,
        state: state
      });

      if (statusBox) {
        statusBox.className = "status-box success";
        statusBox.textContent = "Đã mở tab OAuth. Vui lòng đăng nhập ở tab mới...";
        statusBox.style.display = "block";
      }
    } catch (err) {
      console.error(err);
      if (statusBox) {
        statusBox.className = "status-box error";
        statusBox.textContent = "Lỗi OAuth: " + err.message;
        statusBox.style.display = "block";
      }
    } finally {
      oauthBtn.disabled = false;
      oauthBtn.innerText = oldText;
    }
  });
}

// Global active token/device variables for manual push
let activeSessionToken = "";
let activeDeviceId = "";

async function updateCookieStatusUi() {
  const cookieStatusDiv = $("manualCookieStatus");
  const pushBtn = $("manualPushBtn");
  if (!cookieStatusDiv || !pushBtn) return;

  try {
    const cookies = await new Promise(resolve => {
      chrome.cookies.getAll({ domain: "chatgpt.com" }, resolve);
    });

    const cookie = cookies && cookies.find(c => c.name.includes("session-token"));
    const oaiDidCookie = cookies && cookies.find(c => c.name === "oai-did");
    activeDeviceId = (oaiDidCookie && oaiDidCookie.value) ? oaiDidCookie.value : "";

    if (cookie && cookie.value) {
      activeSessionToken = cookie.value;
      const masked = activeSessionToken.substring(0, 10) + "..." + activeSessionToken.slice(-6);
      cookieStatusDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
          <span>ChatGPT Session:</span>
          <span class="badge badge-ok">Active</span>
        </div>
        <div style="font-family:monospace; font-size:10px; color:#94a3b8; word-break:break-all;">${masked}</div>
      `;
      pushBtn.disabled = false;
    } else {
      activeSessionToken = "";
      cookieStatusDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span>ChatGPT Session:</span>
          <span class="badge badge-none">Not Found</span>
        </div>
        <div style="font-size:11px; color:#94a3b8; margin-top:6px;">Hãy đăng nhập vào chatgpt.com trước.</div>
      `;
      pushBtn.disabled = true;
    }
  } catch (err) {
    console.error(err);
    cookieStatusDiv.textContent = "Lỗi đọc cookie.";
    pushBtn.disabled = true;
  }
}

// Helper methods for generating OAuth verifiers / challenge codes
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let verifier = "";
  for (let i = 0; i < array.length; i++) {
    verifier += chars[array[i] % chars.length];
  }
  return verifier;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64urlencode(a) {
  let str = "";
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Listen for OAUTH_STATUS updates from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "OAUTH_STATUS") {
    const statusBox = $("manualStatusBox");
    if (statusBox) {
      statusBox.className = message.success ? "status-box success" : "status-box error";
      statusBox.textContent = message.message;
      statusBox.style.display = "block";
    }
  }
});

boot();

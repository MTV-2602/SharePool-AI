// ============================================================
// content.js ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ AutoFill Extension v5.0
// ============================================================

const ME = window.location.href;
const isMainFrame = window.self === window.top;
const isPaymentFrame = ME.includes("elements-inner-payment");
const isAddressFrame = ME.includes("elements-inner-address");

let lastFillTriggerTs = 0;
let isFillTriggerRunning = false;
let pendingCaptchaAction = null;
let _omoSolving = false;
let _omoSolveKey = "";
const AUTO_SUB_CONSOLE_EVENT = "af-auto-sub-console-signal";
const QA_CHECKOUT_HOST_RE =
  /(^localhost$)|(^127\.0\.0\.1$)|(^0\.0\.0\.0$)|sandbox|staging|mock|qa|test/i;
const QA_AUTH_FAILURE_RE =
  /failed to process stripe checkout|unable to authenticate your payment method|authentication failed|card has been declined|paymentFailed|generic_decline|insufficient_funds|do_not_honor|card_declined/i;
const QA_PROCESSING_RE = /processing|processing payment|please wait|loading/i;
const QA_SUCCESS_RE = /payment successful|payment complete/i;
let AUTO_PASSWORD_VALUE = "";

chrome.storage.local.get(["randomPassword"], (res) => {
  if (res.randomPassword) {
    AUTO_PASSWORD_VALUE = res.randomPassword;
    return;
  }

  const bootPass = generateRandomPassword();
  AUTO_PASSWORD_VALUE = bootPass;
  chrome.storage.local.set({ randomPassword: bootPass });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.randomPassword) {
    AUTO_PASSWORD_VALUE = changes.randomPassword.newValue || "";
    if (typeof window.tryRebuildEmailQuickDock === "function") {
      window.tryRebuildEmailQuickDock();
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (!isMainFrame) return;
  if (area !== "local" || !changes.addressMode) return;
  syncQuickAddressModeButton();
});

function generateRandomPassword() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const specials = "!@#$%^&*";
  let pwd = "";
  for (let i = 0; i < 11; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  pwd += specials.charAt(Math.floor(Math.random() * specials.length));
  return pwd
    .split("")
    .sort(() => 0.5 - Math.random())
    .join("");
}

// ============================================================
// TempMail API Integration - Generate Real Temporary Emails
// ============================================================
const TEMPMAIL_API_BASE = "https://tinyhost.shop";
const TEMPMAIL_CACHE_DURATION = 3600000; // 1 hour cache for domains
const TWOFA_SECRET_STORE_KEY = "af_twofa_secret_store_v1";
const HOTMAIL_PROXY_URL_DEFAULT = "https://vinhaccplus.vercel.app/api/hotmail/read";
const HOTMAIL_ACTIVE_EMAIL_KEY = "af_hotmail_active_email_v1";
const HOTMAIL_QUEUE_STORE_KEY = "af_hotmail_queue_lines_v1";
const HOTMAIL_QUEUE_USED_STORE_KEY = "af_hotmail_queue_used_v1";
const EXTENSION_PUSH_API_URL_DEFAULT =
  "https://vinhaccplus.vercel.app/api/chatgpt-extension-push";
const EXTENSION_PUSH_API_URL_KEY = "extensionPushApiUrl";
const EXTENSION_PUSH_TOKEN_KEY = "extensionPushToken";
const EXTENSION_PUSH_TOKEN_DEFAULT =
  "b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b";
const EXTENSION_WORKER_ID_KEY = "extensionWorkerId";
const EXTENSION_WORKER_NAME_KEY = "extensionWorkerName";

function getTwofaStoreHostKey() {
  try {
    return String(location.hostname || "").trim() || "_global";
  } catch (_) {
    return "_global";
  }
}

async function getStoredTwofaSecretForHost() {
  const hostKey = getTwofaStoreHostKey();
  const data = await storageLocalGet([TWOFA_SECRET_STORE_KEY]);
  const store =
    data[TWOFA_SECRET_STORE_KEY] && typeof data[TWOFA_SECRET_STORE_KEY] === "object"
      ? data[TWOFA_SECRET_STORE_KEY]
      : {};
  return String(store[hostKey] || "").trim();
}

async function saveTwofaSecretForHost(rawSecret) {
  const normalized = normalizeOtpSecret(rawSecret);
  if (!normalized) return;
  const hostKey = getTwofaStoreHostKey();
  const data = await storageLocalGet([TWOFA_SECRET_STORE_KEY]);
  const store =
    data[TWOFA_SECRET_STORE_KEY] && typeof data[TWOFA_SECRET_STORE_KEY] === "object"
      ? { ...data[TWOFA_SECRET_STORE_KEY] }
      : {};
  store[hostKey] = normalized;
  await storageLocalSet({ [TWOFA_SECRET_STORE_KEY]: store });
}

async function getTempMailDomains() {
  try {
    const cacheKey = "tempmail_domains_cache";
    const cached = await storageLocalGet([cacheKey]);
    const now = Date.now();

    if (cached[cacheKey]) {
      const { domains, timestamp } = cached[cacheKey];
      if (now - timestamp < TEMPMAIL_CACHE_DURATION) {
        return domains;
      }
    }

    const response = await fetch(
      `${TEMPMAIL_API_BASE}/api/random-domains/?limit=30`
    );
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    const domains = data.domains || [];

    // Cache the result
    await storageLocalSet({
      [cacheKey]: { domains, timestamp: now },
    });

    return domains;
  } catch (error) {
    console.error("TempMail: Failed to fetch domains:", error);
    return [];
  }
}

async function generateRandomTempMailAddress() {
  try {
    const domains = await getTempMailDomains();
    if (!domains.length) {
      console.warn("TempMail: No domains available");
      return null;
    }

    // Pick random domain
    const domain = domains[Math.floor(Math.random() * domains.length)];

    // Generate random username
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let username = "";
    for (let i = 0; i < 12; i++) {
      username += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const email = `${username}@${domain}`;
    const timestamp = Date.now();

    // Store this email mapping for later retrieval
    await storageLocalSet({
      lastTempMailAddress: { email, domain, username, timestamp },
    });

    return { email, domain, username, timestamp };
  } catch (error) {
    console.error("TempMail: Failed to generate address:", error);
    return null;
  }
}

async function getTempMailInbox(domain, username, page = 1, limit = 20) {
  try {
    const response = await fetch(
      `${TEMPMAIL_API_BASE}/api/email/${domain}/${username}/?page=${page}&limit=${limit}`
    );
    if (!response.ok) {
      if (response.status === 404) return { emails: [] };
      throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("TempMail: Failed to fetch inbox:", error);
    return { emails: [] };
  }
}

async function getTempMailEmailDetail(domain, username, emailId) {
  try {
    const response = await fetch(
      `${TEMPMAIL_API_BASE}/api/email/${domain}/${username}/${emailId}`
    );
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("TempMail: Failed to fetch email detail:", error);
    return null;
  }
}

async function deleteTempMailEmail(domain, username, emailId) {
  try {
    const response = await fetch(
      `${TEMPMAIL_API_BASE}/api/email/${domain}/${username}/${emailId}`,
      { method: "DELETE" }
    );
    return response.ok;
  } catch (error) {
    console.error("TempMail: Failed to delete email:", error);
    return false;
  }
}

async function getLastTempMailAddress() {
  const data = await storageLocalGet(["lastTempMailAddress"]);
  return data.lastTempMailAddress || null;
}

function extractOtpCodeFromText(raw) {
  const text = String(raw || "");
  const decoded = text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 0))
    .replace(/&#x([\da-f]+);/gi, (_, h) =>
      String.fromCharCode(Number.parseInt(h, 16) || 0),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ");

  const normalized = decoded
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/(\d)[\s\-.](?=\d)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const contextRe =
    /(?:verification|verify|security|one[-\s]?time|otp|login|code)[^\d]{0,50}(\d{4,8})/i;
  const nearContext = normalized.match(contextRe);
  if (nearContext && nearContext[1]) return nearContext[1];

  const strongOtpRe = /\b\d{6}\b/g;
  const strongMatches = normalized.match(strongOtpRe);
  if (strongMatches && strongMatches.length) return strongMatches[0];

  const genericOtpRe = /\b\d{4,8}\b/g;
  const genericMatches = normalized.match(genericOtpRe);
  if (genericMatches && genericMatches.length) return genericMatches[0];
  return "";
}

function parseCredentialLine(rawLine) {
  const clean = String(rawLine || "").trim();
  if (!clean) return null;

  const sep = clean.includes("|") ? "|" : clean.includes("----") ? "----" : null;
  if (!sep) {
    return {
      account: clean,
      password: AUTO_PASSWORD_VALUE || "",
      twofaSecret: "",
    };
  }

  const parts = clean.split(sep).map((v) => String(v || "").trim());

  // Neu co 5 phan (Hotmail Full), parse day du
  if (parts.length >= 5) {
    return {
      account: parts[0] || "",
      password: parts[1] || "",
      refreshToken: parts[2] || "",
      clientId: parts[3] || "",
      twofaSecret: parts[4] || "",
    };
  }

  // Mac dinh 3 phan
  return {
    account: parts[0] || "",
    password: parts[1] || AUTO_PASSWORD_VALUE || "",
    twofaSecret: parts[2] || "",
  };
}

function parseHotmailCredentialLine(rawLine) {
  const clean = String(rawLine || "")
    .trim()
    .replace(/^\s*(?:✔|\[x\]|\[X\]|✔️)\s*/u, "")
    .replace(/^\s*\[\s*\]\s*/u, "")
    .trim();
  if (!clean) return null;
  const parts = clean.split("|").map((v) => String(v || "").trim());
  const email = String(parts[0] || "").trim().toLowerCase();
  if (!isMicrosoftMailboxEmail(email)) return null;
  if (parts.length < 3) return null;
  if (parts.length === 3) {
    return { email, password: parts[1], secret2fa: parts[2] };
  }
  return {
    email,
    password: parts[1] || "",
    refreshToken: parts[2] || "",
    clientId: parts[3] || "",
    secret2fa: parts[4] || "",
  };
}

function getMicrosoftMailboxDomain(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/);
  return match && match[1] ? String(match[1]).trim() : "";
}

function isMicrosoftMailboxEmail(value) {
  const domain = getMicrosoftMailboxDomain(value);
  if (!domain) return false;
  return (
    domain === "hotmail.com" ||
    domain === "outlook.com" ||
    domain === "live.com" ||
    domain === "msn.com" ||
    domain.startsWith("hotmail.") ||
    domain.startsWith("outlook.") ||
    domain.endsWith(".live.com") ||
    domain.endsWith(".msn.com")
  );
}

function normalizeHotmailLine(rawLine) {
  return String(rawLine || "")
    .trim()
    .replace(/^\s*(?:✅|\[x\]|\[X\]|☑️)\s*/u, "")
    .replace(/^\s*\[\s*\]\s*/u, "")
    .trim();
}

function isHotmailLineUsed(rawLine) {
  return /^\s*(?:✅|\[x\]|\[X\]|☑️)/u.test(String(rawLine || ""));
}

function extractHotmailEmailFromLine(rawLine) {
  const clean = normalizeHotmailLine(rawLine);
  if (!clean) return "";
  const parsed = parseHotmailCredentialLine(clean);
  if (parsed?.email) return String(parsed.email).trim().toLowerCase();
  if (isMicrosoftMailboxEmail(clean)) {
    return String(clean).trim().toLowerCase();
  }
  return "";
}

function markHotmailLineUsed(rawLine) {
  const clean = normalizeHotmailLine(rawLine);
  if (!clean) return "";
  return `✅ ${clean}`;
}

function hotmailProxyEndpoint(proxyReadUrl, path) {
  const url = String(proxyReadUrl || HOTMAIL_PROXY_URL_DEFAULT).trim();
  if (url.includes("/api/hotmail")) {
    let base = url.replace(/\/read\/?$/i, "");
    if (path === "/accounts") return base + "/accounts";
    if (path === "/save-hotmail-account") return base + "/save";
    if (path === "/new") return base + "/new";
    if (path === "/2fa") return base + "/2fa";
    if (path === "/mark-used") return base + "/mark-used";
  }
  return url.replace(/\/read-hotmail\/?$/i, path);
}

async function getHotmailProxyReadUrl() {
  const data = await storageLocalGet(["hotmailProxyUrl"]);
  const raw = String(data.hotmailProxyUrl || "").trim();
  return raw || HOTMAIL_PROXY_URL_DEFAULT;
}

async function getExtensionPushConfig() {
  const data = await storageLocalGet([
    EXTENSION_PUSH_API_URL_KEY,
    EXTENSION_PUSH_TOKEN_KEY,
  ]);
  return {
    apiUrl:
      String(data[EXTENSION_PUSH_API_URL_KEY] || "").trim() ||
      EXTENSION_PUSH_API_URL_DEFAULT,
    token:
      String(data[EXTENSION_PUSH_TOKEN_KEY] || "").trim() ||
      EXTENSION_PUSH_TOKEN_DEFAULT,
  };
}

function extensionWorkerEndpointFromPushUrl(apiUrl, path) {
  const raw =
    String(apiUrl || "").trim() || EXTENSION_PUSH_API_URL_DEFAULT;
  if (/\/api\/chatgpt-extension-push\/?$/i.test(raw)) {
    return raw.replace(/\/api\/chatgpt-extension-push\/?$/i, `/api${path}`);
  }
  if (/\/chatgpt-extension-push\/?$/i.test(raw)) {
    return raw.replace(/\/chatgpt-extension-push\/?$/i, path);
  }
  return raw.replace(/\/$/, "") + path;
}

async function getStoredExtensionWorker() {
  const data = await storageLocalGet([
    EXTENSION_WORKER_ID_KEY,
    EXTENSION_WORKER_NAME_KEY,
  ]);
  const id = String(data[EXTENSION_WORKER_ID_KEY] || "").trim();
  const name = String(data[EXTENSION_WORKER_NAME_KEY] || "").trim();
  if (!id) return null;
  return { id, name };
}

async function setStoredExtensionWorker(worker) {
  const id = String(worker?.id || "").trim();
  const name = String(worker?.name || "").trim();
  if (!id) {
    await storageLocalSet({
      [EXTENSION_WORKER_ID_KEY]: "",
      [EXTENSION_WORKER_NAME_KEY]: "",
    });
    return null;
  }
  await storageLocalSet({
    [EXTENSION_WORKER_ID_KEY]: id,
    [EXTENSION_WORKER_NAME_KEY]: name,
  });
  return { id, name };
}

async function fetchExtensionWorkersForPush() {
  const { apiUrl, token } = await getExtensionPushConfig();
  if (!apiUrl || !token) {
    throw new Error("Chua cau hinh Push URL/Token");
  }
  const resp = await fetch(extensionWorkerEndpointFromPushUrl(apiUrl, "/extension-workers"), {
    headers: { "x-extension-push-token": token },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.ok) {
    throw new Error(json?.error || `Load workers HTTP ${resp.status}`);
  }
  return Array.isArray(json.workers) ? json.workers : [];
}

async function verifyExtensionWorkerChangeCode(workerId, code) {
  const { apiUrl, token } = await getExtensionPushConfig();
  if (!apiUrl || !token) {
    throw new Error("Chua cau hinh Push URL/Token");
  }
  const resp = await fetch(
    extensionWorkerEndpointFromPushUrl(apiUrl, "/extension-workers/verify-change-code"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-extension-push-token": token,
      },
      body: JSON.stringify({ workerId, code }),
    },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.ok) {
    throw new Error(json?.error || `Verify worker HTTP ${resp.status}`);
  }
  return json.worker || null;
}


async function getHotmailAccountsViaProxy() {
  const readUrl = await getHotmailProxyReadUrl();
  const accountsUrl = hotmailProxyEndpoint(readUrl, "/accounts");
  const res = await fetch(accountsUrl);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Load hotmail accounts failed HTTP ${res.status}`);
  }
  return Array.isArray(json.accounts) ? json.accounts : [];
}

async function deleteHotmailAccountViaProxy(email) {
  const target = String(email || "").trim();
  if (!target) {
    throw new Error("Thieu email de xoa");
  }
  const readUrl = await getHotmailProxyReadUrl();
  const deleteUrl = hotmailProxyEndpoint(readUrl, "/delete-hotmail-account");
  const res = await fetch(deleteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: target }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Delete hotmail failed HTTP ${res.status}`);
  }
  return json;
}

async function readHotmailInboxViaProxy(payload) {
  const readUrl = await getHotmailProxyReadUrl();
  const res = await fetch(readUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Read hotmail failed HTTP ${res.status}`);
  }
  return json;
}

async function fetchNewHotmailViaProxy() {
  const readUrl = await getHotmailProxyReadUrl();
  const newUrl = hotmailProxyEndpoint(readUrl, "/new");
  // Gui kem note = domain hien tai de admin biet tab nao lay
  const note = `Tab: ${String(location.hostname || location.href).slice(0, 80)} | ${new Date().toLocaleString("vi-VN")}`;
  const urlWithNote = `${newUrl}?note=${encodeURIComponent(note)}`;
  const res = await fetch(urlWithNote, { method: "GET" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Lay Hotmail moi that bai HTTP ${res.status}`);
  }
  return json; // { ok, account, formatted }
}

async function markHotmailUsedViaProxy(email) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm || !isMicrosoftMailboxEmail(emailNorm)) return;
  try {
    const readUrl = await getHotmailProxyReadUrl();
    const markUrl = hotmailProxyEndpoint(readUrl, "/mark-used");
    const note = `Da dien vao ChatGPT tu tab: ${String(location.hostname || "").slice(0, 60)} | ${new Date().toLocaleString("vi-VN")}`;
    await fetch(markUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailNorm, note }),
    });
  } catch (_) {
    // Loi nay khong can block UI, chi log
    console.warn("[AF] markHotmailUsedViaProxy failed:", _);
  }
}


function formatCredentialLine(cred) {
  if (!cred?.account) return "";
  if (cred.refreshToken && cred.clientId) {
    // Neu co token, tra ve 5 phan
    return `${cred.account}|${cred.password}|${cred.refreshToken}|${cred.clientId}|${cred.twofaSecret || ""}`;
  }
  const password = cred.password || AUTO_PASSWORD_VALUE || "";
  const twofa = cred.twofaSecret || "";
  return `${cred.account}|${password}|${twofa}`;
}

function normalizeOtpSecret(rawSecret) {
  const input = String(rawSecret || "").trim();
  if (!input) return "";
  if (/^otpauth:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      return String(url.searchParams.get("secret") || "").trim();
    } catch (_) {
      return "";
    }
  }
  return input;
}

function base32ToBytes(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(base32 || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");

  let bits = "";
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function generateTotpFromSecret(rawSecret, digits = 6, stepSec = 30) {
  const secret = normalizeOtpSecret(rawSecret);
  if (!secret) throw new Error("Chua co ma 2FA secret");

  const keyBytes = base32ToBytes(secret);
  if (!keyBytes.length) throw new Error("2FA secret khong hop le");

  const counter = Math.floor(Date.now() / 1000 / stepSec);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, "0");
}

const SANDBOX_TEST_CARD_LINES = [];
const ADDRESS_MODE_RANDOM_KR = "random_kr";
const ADDRESS_MODE_RANDOM_KR_INDO_MIX = "random_kr_indo_mix";
const ADDRESS_MODE_RANDOM_US_INDO_MIX = "random_us_indo_mix";
const ADDRESS_MODE_RANDOM_UK_INDO_MIX = "random_uk_indo_mix";
const ADDRESS_MODE_RANDOM_US = "random_us";
const ADDRESS_MODE_RANDOM_UK = "random_uk";
const ADDRESS_MODE_RANDOM_JP = "random_jp";
const ADDRESS_MODE_RANDOM_INDONESIA = "random_indonesia";
const ADDRESS_MODE_RANDOM_INDIA = "random_india";
const ADDRESS_MODE_RANDOM_ALGERIA = "random_algeria";
const ADDRESS_MODE_RANDOM_KAZAKHSTAN = "random_kazakhstan";
const ADDRESS_MODE_RANDOM_CHILE = "random_chile";
const ADDRESS_MODE_RANDOM_ANY = "random_any";
const ADDRESS_MODE_FIXED_KR = "fixed_kr";
const ADDRESS_MODE_FIXED_US = "fixed_us";
const ADDRESS_MODE_FIXED_UK = "fixed_uk";
const ADDRESS_MODE_FIXED_JP = "fixed_jp";
const ADDRESS_MODE_FIXED_INDONESIA = "fixed_indonesia";
const ADDRESS_MODE_FIXED_INDIA = "fixed_india";
const ADDRESS_MODE_FIXED_ALGERIA = "fixed_algeria";
const ADDRESS_MODE_FIXED_KAZAKHSTAN = "fixed_kazakhstan";
const ADDRESS_MODE_FIXED_CHILE = "fixed_chile";
const QUICK_TOOLBAR_ADDRESS_MODES = [
  ADDRESS_MODE_RANDOM_KR_INDO_MIX,
  ADDRESS_MODE_RANDOM_US_INDO_MIX,
  ADDRESS_MODE_RANDOM_UK_INDO_MIX,
];
const KR_BILLING_ADDRESS_POOL = [
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "43, Noksapyeong-daero 26-gil",
    postal: "04345",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "21, Itaewon-ro 20-gil",
    postal: "04391",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "18, Sinheung-ro 20-gil",
    postal: "04337",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "52, Usadan-ro 10-gil",
    postal: "04405",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "27, Huam-ro 57-gil",
    postal: "04327",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "33, Bogwang-ro 60-gil",
    postal: "04416",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "14, Hangang-daero 104-gil",
    postal: "04352",
  },
  {
    country: "South Korea",
    state: "Seoul",
    city: "Seoul",
    address: "61, Dokseodang-ro 20-gil",
    postal: "04419",
  },
];
const US_BILLING_ADDRESS_POOL = [
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "845 S Figueroa St",
    postal: "90017",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "700 W 7th St",
    postal: "90017",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "801 S Grand Ave",
    postal: "90017",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "939 S Figueroa St",
    postal: "90015",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "1020 S Olive St",
    postal: "90015",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "1120 S Flower St",
    postal: "90015",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "1201 S Hope St",
    postal: "90015",
  },
  {
    country: "United States",
    state: "California",
    city: "Los Angeles",
    address: "1415 S Hope St",
    postal: "90015",
  },
];
const UK_BILLING_ADDRESS_POOL = [
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "63 Lower White Road",
    postal: "B32 2RU",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "41 Lower White Road",
    postal: "B32 2RS",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "18 Lower White Road",
    postal: "B32 2RT",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "72 White Road",
    postal: "B32 2TS",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "29 Ridgacre Road",
    postal: "B32 1QJ",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "54 Ridgacre Road",
    postal: "B32 1QH",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "17 High Meadow Road",
    postal: "B32 1XL",
  },
  {
    country: "United Kingdom",
    state: "England",
    city: "London",
    address: "88 Quinton Road West",
    postal: "B32 1PE",
  },
];
const JAPAN_BILLING_ADDRESS_POOL = [
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "1-1 Chiyoda",
    postal: "100-0001",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "2-8-1 Nishi-Shinjuku",
    postal: "163-8001",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "4-2-8 Shibakoen",
    postal: "105-0011",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "1-9-1 Marunouchi",
    postal: "100-0005",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "6-10-1 Roppongi",
    postal: "106-0032",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "2-24-12 Shibuya",
    postal: "150-0002",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "1-2-3 Ueno",
    postal: "110-0005",
  },
  {
    country: "Japan",
    state: "Tokyo",
    city: "Tokyo",
    address: "3-1-1 Nihonbashi",
    postal: "103-0027",
  },
];
const INDONESIA_BILLING_ADDRESS_POOL = [
  {
    country: "Indonesia",
    state: "DKI Jakarta",
    city: "Jakarta Selatan",
    address: "Jl. Sudirman No. 52",
    postal: "12190",
  },
  {
    country: "Indonesia",
    state: "Jawa Timur",
    city: "Surabaya",
    address: "Jl. Basuki Rahmat No. 88",
    postal: "60271",
  },
  {
    country: "Indonesia",
    state: "Jawa Barat",
    city: "Bandung",
    address: "Jl. Asia Afrika No. 19",
    postal: "40111",
  },
  {
    country: "Indonesia",
    state: "Banten",
    city: "Tangerang",
    address: "Jl. Jenderal Sudirman No. 12",
    postal: "15117",
  },
  {
    country: "Indonesia",
    state: "Jawa Timur",
    city: "Sidoarjo",
    address: "Jl. Pahlawan No. 31",
    postal: "61212",
  },
  {
    country: "Indonesia",
    state: "Jawa Barat",
    city: "Bekasi",
    address: "Jl. Ahmad Yani No. 45",
    postal: "17144",
  },
];
const INDONESIA_CITY_DATA = {
  "Jakarta": {
    postalMin: 10000,
    postalMax: 15214,
    streets: ["Jl. Sudirman", "Jl. Thamrin", "Jl. Merdeka", "Jl. Gatot Subroto", "Jl. Sisingamangaraja"],
  },
  "Surabaya": {
    postalMin: 60000,
    postalMax: 60300,
    streets: ["Jl. Tunjungan", "Jl. Kertajaya", "Jl. Ngagel", "Jl. Veteran", "Jl. Pemuda"],
  },
  "Bandung": {
    postalMin: 40000,
    postalMax: 46475,
    streets: ["Jl. Sudirman", "Jl. Gatot Subroto", "Jl. Ahmad Yani", "Jl. Diponegoro", "Jl. Raya"],
  },
  "Medan": {
    postalMin: 20000,
    postalMax: 23100,
    streets: ["Jl. Sudirman", "Jl. Gatot Subroto", "Jl. Merdeka", "Jl. Pahlawan", "Jl. Diponegoro"],
  },
  "Denpasar": {
    postalMin: 80000,
    postalMax: 82361,
    streets: ["Jl. Puputan", "Jl. Sudirman", "Jl. Gajah Mada", "Jl. Diponegoro", "Jl. Bali"],
  },
  "Semarang": {
    postalMin: 50000,
    postalMax: 52672,
    streets: ["Jl. Karanganyar", "Jl. Diponegoro", "Jl. Sudirman", "Jl. Pemuda", "Jl. Merdeka"],
  },
  "Makassar": {
    postalMin: 90000,
    postalMax: 92985,
    streets: ["Jl. Sudirman", "Jl. Somba Opu", "Jl. Maros", "Jl. Gatot Subroto", "Jl. Diponegoro"],
  },
  "Palembang": {
    postalMin: 30111,
    postalMax: 30372,
    streets: ["Jl. Sudirman", "Jl. Merdeka", "Jl. Pahlawan", "Jl. Diponegoro", "Jl. Ahmad Yani"],
  },
  "Yogyakarta": {
    postalMin: 55000,
    postalMax: 55893,
    streets: ["Jl. Malioboro", "Jl. Sudirman", "Jl. Diponegoro", "Jl. Ahmad Yani", "Jl. Merdeka"],
  },
  "Bali": {
    postalMin: 80000,
    postalMax: 82361,
    streets: ["Jl. Puputan", "Jl. Bali", "Jl. Sudirman", "Jl. Gatot Subroto", "Jl. Diponegoro"],
  },
};
const INDIA_BILLING_ADDRESS_POOL = [
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "24 Connaught Place",
    postal: "110001",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "18 Janpath Road",
    postal: "110001",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "52 Connaught Place",
    postal: "110001",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "9 Barakhamba Road",
    postal: "110001",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "44 Kasturba Gandhi Marg",
    postal: "110001",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "12 Sansad Marg",
    postal: "110001",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "77 Bahadur Shah Zafar Marg",
    postal: "110002",
  },
  {
    country: "India",
    state: "Delhi",
    city: "New Delhi",
    address: "31 Tolstoy Marg",
    postal: "110001",
  },
];
const ALGERIA_BILLING_ADDRESS_POOL = [
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "12 Rue Didouche Mourad",
    postal: "16000",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "45 Boulevard Mohamed V",
    postal: "16030",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "18 Rue Larbi Ben Mhidi",
    postal: "16000",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "27 Avenue Pasteur",
    postal: "16046",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "63 Rue Hassiba Ben Bouali",
    postal: "16014",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "31 Chemin Abdelkader Gadouche",
    postal: "16035",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "22 Rue Victor Hugo",
    postal: "16000",
  },
  {
    country: "Algeria",
    state: "Algiers Province",
    city: "Algiers",
    address: "71 Rue Ali Mellah",
    postal: "16000",
  },
];
const KAZAKHSTAN_BILLING_ADDRESS_POOL = [
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "63 Abylai Khan Ave",
    postal: "050000",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "21 Tole Bi St",
    postal: "050000",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "48 Nazarbayev Ave",
    postal: "050004",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "72 Panfilov St",
    postal: "050000",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "15 Kabanbay Batyr St",
    postal: "050010",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "34 Furmanov St",
    postal: "050000",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "56 Zhibek Zholy Ave",
    postal: "050002",
  },
  {
    country: "Kazakhstan",
    state: "Almaty",
    city: "Almaty",
    address: "89 Satpayev St",
    postal: "050046",
  },
];
const CHILE_BILLING_ADDRESS_POOL = [
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "123 Avenida Libertador Bernardo O'Higgins",
    postal: "8320000",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "456 Calle Monjitas",
    postal: "8320212",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "789 Avenida Providencia",
    postal: "7500000",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "32 Calle Huerfanos",
    postal: "8320113",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "150 Avenida Apoquindo",
    postal: "7550000",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "88 Calle Merced",
    postal: "8320318",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "210 Avenida Vitacura",
    postal: "7630000",
  },
  {
    country: "Chile",
    state: "Santiago Metropolitan",
    city: "Santiago",
    address: "47 Calle Estado",
    postal: "8320163",
  },
];
const FIXED_BILLING_ADDRESS = KR_BILLING_ADDRESS_POOL[0];
const NAME_FIELD_PATTERNS = [/full name/i, /\bname\b/i, /성명/, /이름/];
const BIRTHDAY_FIELD_PATTERNS = [
  /birthday/i,
  /birthdate/i,
  /date of birth/i,
  /생일/,
  /생년월일/,
  /연도/,
  /월/,
  /일/,
];
const AGE_FIELD_PATTERNS = [/\bage\b/i, /how old are you/i, /나이/];
const PASSWORD_FIELD_PATTERNS = [/new password/i, /password/i, /비밀번호/];
const EMAIL_FIELD_PATTERNS = [/email address/i, /\bemail\b/i, /이메일/];
const CONTINUE_BUTTON_PATTERNS = [
  /^continue$/i,
  /continue/i,
  /next/i,
  /submit/i,
  /계속하기/,
  /계속/,
  /다음/,
  /제출/,
  /확인/,
];
const SKIP_BUTTON_PATTERNS = [/^skip$/i, /건너뛰기/];
const SKIP_TOUR_BUTTON_PATTERNS = [
  /^skip tour$/i,
  /투어.*건너뛰기/,
  /둘러보기.*건너뛰기/,
];
const OKAY_BUTTON_PATTERNS = [
  /^okay,?\s*let'?s?\s*go$/i,
  /^okay$/i,
  /좋아요/,
  /시작하기/,
  /확인/,
];
const CLAIM_BUTTON_PATTERNS = [
  /free offer/i,
  /claim offer/i,
  /혜택 받기/,
  /오퍼 받기/,
];
const CONSENT_ALL_PATTERNS = [
  /i agree to all of the following/i,
  /다음 사항에 모두 동의합니다/,
];
const FINISH_CREATE_PATTERNS = [
  /finish creating account/i,
  /계정 생성 끝내기/,
  /계정 만들기 완료/,
  /계정 생성/,
];
const AGE_GATE_HEADING_PATTERNS = [
  /confirm your age/i,
  /can we confirm your age/i,
  /how old are you/i,
  /나이를 확인해 볼까요/,
  /나이를 확인해/,
];
const KOREAN_BIRTHDAY_HINT_RE =
  /\uC0DD\uC77C|\uC0DD\uB144\uC6D4\uC77C|\uC5F0\uB3C4|\uC6D4|\uC77C/;
const KOREAN_AGE_GATE_HEADING_RE = /\uB098\uC774\uB97C\s*\uD655\uC778/;
const autoSubmitState = {
  running: false,
  paused: false,
  waitingForCaptcha: false,
  runId: 0,
  status: "stopped",
};
let lastQaConsoleFailure = "";

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Inject toolbar trÃƒÆ’Ã‚Âªn main frame ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
if (isMainFrame) {
  checkPendingSuccessOnLoad();
  startCheckoutExitWatch();
  startAgeGateAutoFill();
  // startAutoPasswordWatch(); // ĐÃ TẮT — bạn tự Ctrl+V password bằng tay
  startConsoleSignalWatch();
  // ThÃƒÂ¡Ã‚Â»Ã‚Â­ ngay lÃƒÂ¡Ã‚ÂºÃ‚Â­p tÃƒÂ¡Ã‚Â»Ã‚Â©c
  tryInject();
  // Retry sau 500ms vÃƒÆ’Ã‚Â  1500ms (React cÃƒÆ’Ã‚Â³ thÃƒÂ¡Ã‚Â»Ã†â€™ re-render xÃƒÆ’Ã‚Â³a mÃƒÂ¡Ã‚ÂºÃ‚Â¥t toolbar)
  setTimeout(tryInject, 500);
  setTimeout(tryInject, 1500);
  setTimeout(tryInject, 3000);

  // MutationObserver: nÃƒÂ¡Ã‚ÂºÃ‚Â¿u bÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹ React xÃƒÆ’Ã‚Â³a ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ inject lÃƒÂ¡Ã‚ÂºÃ‚Â¡i
  const _obs = new MutationObserver(() => {
    if (!document.getElementById("af-toolbar")) tryInject();
  });
  // BÃƒÂ¡Ã‚ÂºÃ‚Â¯t Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚ÂºÃ‚Â§u observe sau khi body sÃƒÂ¡Ã‚ÂºÃ‚Âµn sÃƒÆ’Ã‚Â ng
  const startObserver = () => {
    if (document.body) {
      _obs.observe(document.body, { childList: true });
    }
  };
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver);
}

function tryInject() {
  if (!document.body) return;
  if (!document.getElementById("af-toolbar")) injectFABs();
  else injectEmailQuickDock();
}

function makeFloatingMovable(el, options = {}) {
  if (!el || el.__afMovableBound) return;
  el.__afMovableBound = true;

  const storageKey =
    typeof options.storageKey === "string" && options.storageKey.trim()
      ? options.storageKey.trim()
      : "";
  const noDragSelector =
    options.noDragSelector ||
    "input, textarea, button, select, option, a, [contenteditable='true']";
  const handleSelector = options.handleSelector || null;
  const handles = handleSelector
    ? Array.from(el.querySelectorAll(handleSelector))
    : [el];

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let prevUserSelect = "";

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  const toDraggablePositionMode = () => {
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(0, rect.left)}px`;
    el.style.top = `${Math.max(0, rect.top)}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  };

  const saveCurrentPosition = () => {
    if (!storageKey) return;
    const rect = el.getBoundingClientRect();
    storageLocalSet({
      [storageKey]: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        ts: Date.now(),
      },
    });
  };

  const applySavedPosition = () => {
    if (!storageKey) return;
    storageLocalGet([storageKey]).then((res) => {
      const saved = res?.[storageKey];
      if (!saved || typeof saved !== "object") return;

      const left = Number(saved.left);
      const top = Number(saved.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;

      const margin = 8;
      const panelWidth = Math.max(el.offsetWidth || 0, 1);
      const panelHeight = Math.max(el.offsetHeight || 0, 1);
      const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);

      el.style.left = `${clamp(left, margin, maxLeft)}px`;
      el.style.top = `${clamp(top, margin, maxTop)}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
  };

  const stopDragging = () => {
    if (!dragging) return;
    dragging = false;
    document.documentElement.style.userSelect = prevUserSelect;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", stopDragging, true);
    window.removeEventListener("pointercancel", stopDragging, true);
    saveCurrentPosition();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
    const nextLeft = originLeft + (e.clientX - startX);
    const nextTop = originTop + (e.clientY - startY);
    const margin = 8;
    const maxLeft = Math.max(
      margin,
      window.innerWidth - el.offsetWidth - margin,
    );
    const maxTop = Math.max(
      margin,
      window.innerHeight - el.offsetHeight - margin,
    );
    el.style.left = `${clamp(nextLeft, margin, maxLeft)}px`;
    el.style.top = `${clamp(nextTop, margin, maxTop)}px`;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (noDragSelector && e.target.closest(noDragSelector)) return;

    toDraggablePositionMode();
    const rect = el.getBoundingClientRect();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    prevUserSelect = document.documentElement.style.userSelect || "";
    document.documentElement.style.userSelect = "none";

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", stopDragging, true);
    window.addEventListener("pointercancel", stopDragging, true);
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
    e.preventDefault();
  };

  handles.forEach((h) => {
    h.style.cursor = "move";
    h.style.touchAction = "none";
    h.addEventListener("pointerdown", onPointerDown, true);
  });

  applySavedPosition();
}

// LÃƒÂ¡Ã‚ÂºÃ‚Â¯ng nghe fill trigger tÃƒÂ¡Ã‚Â»Ã‚Â« storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.fillTrigger) return;
  const payload = changes.fillTrigger.newValue || {};
  const { cardData, addrData } = payload;
  const ts = Number(payload.ts || 0);

  // MÃƒÂ¡Ã‚Â»Ã¢â‚¬â€i trigger chÃƒÂ¡Ã‚Â»Ã¢â‚¬Â° xÃƒÂ¡Ã‚Â»Ã‚Â­ lÃƒÆ’Ã‚Â½ 1 lÃƒÂ¡Ã‚ÂºÃ‚Â§n trÃƒÆ’Ã‚Âªn mÃƒÂ¡Ã‚Â»Ã¢â‚¬â€i frame
  if (ts && ts === lastFillTriggerTs) return;
  if (isFillTriggerRunning) return;

  isFillTriggerRunning = true;
  if (ts) lastFillTriggerTs = ts;

  (async () => {
    try {
      if (isPaymentFrame && cardData) fillPayment(cardData);
      if (isAddressFrame && addrData) await fillAddress(addrData);
    } finally {
      isFillTriggerRunning = false;
    }
  })();
});

// ============================================================
// TOOLBAR NÃƒÂ¡Ã‚Â»Ã¢â‚¬ÂI ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 3 nÃƒÆ’Ã‚Âºt nÃƒÂ¡Ã‚ÂºÃ‚Â±m ngang, luÃƒÆ’Ã‚Â´n hiÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡n
// ============================================================
function injectFABs() {
  if (document.getElementById("af-toolbar")) return;
  const uiRoot = document.documentElement || document.body;
  if (!uiRoot) return;

  const bar = document.createElement("div");
  bar.id = "af-toolbar";
  bar.setAttribute("data-af-ui-root", "1");
  bar.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
    background: rgba(15, 20, 40, 0.88);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 40px;
    padding: 8px 14px;
    box-shadow: 0 6px 28px rgba(0,0,0,0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    user-select: none;
  `;
  isolateFloatingUIEvents(bar);
  uiRoot.appendChild(bar);
  makeFloatingMovable(bar, {
    noDragSelector: "button",
    storageKey: "af_toolbar_pos_v1",
  });

  makeBtn(bar, "af-btn-sub", "Sub", "#27ae60", handleSubClick);
  makeBtn(bar, "af-btn-edit", "\u270F\uFE0F Edit", "#9b59b6", handleEditPanel);
  makeBtn(
    bar,
    "af-btn-auto-submit",
    "Auto Submit",
    "#16a085",
    handleAutoSubmitClick,
  );
  makeBtn(bar, "af-btn-pause", "Pause", "#d35400", handlePauseResumeClick);
  makeBtn(bar, "af-btn-stop", "Stop", "#c0392b", handleStopAutoSubmitClick);
  makeBtn(bar, "af-btn-mode", "Mode", "#34495e", handleQuickAddressModeClick);
  injectEmailQuickDock();
  updateAutoSubmitButtons();
  syncQuickAddressModeButton();
}

function isolateFloatingUIEvents(el) {
  if (!el || el.__afEventsIsolated) return;
  const swallow = (e) => {
    e.stopPropagation();
  };
  [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "touchstart",
    "touchend",
    "contextmenu",
    "wheel",
  ].forEach((evt) => {
    el.addEventListener(evt, swallow, false);
  });
  el.__afEventsIsolated = true;
}

function ensureFloatingUIEventGuard() {
  // Deprecated: capture-phase guard blocks target handlers on some sites.
  // Keep this as a no-op to preserve backward compatibility with old calls.
  window.__afFloatingUiEventGuardInstalled = true;
}

function makeBtn(parent, id, label, color, onClick) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.textContent = label;
  btn.style.cssText = `
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 7px 14px;
    border-radius: 30px;
    background: ${color};
    color: #fff;
    font: 700 12px system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    cursor: pointer;
    letter-spacing: .3px;
    transition: opacity .15s, transform .15s;
    white-space: nowrap;
  `;
  btn.addEventListener("mouseenter", () => {
    btn.style.opacity = ".85";
    btn.style.transform = "scale(1.04)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.opacity = "1";
    btn.style.transform = "scale(1)";
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(e);
  });
  parent.appendChild(btn);
}

function storageLocalGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (res) => {
        resolve(res || {});
      });
    } catch (e) {
      resolve({});
    }
  }).catch(() => ({}));
}

function storageLocalSet(payload) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(payload, () => {
        resolve();
      });
    } catch (e) {
      resolve();
    }
  }).catch(() => {});
}

function storageLocalRemove(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(keys, () => {
        resolve();
      });
    } catch (e) {
      resolve();
    }
  }).catch(() => {});
}

function isQaSandboxCheckoutPage() {
  if (!isMainFrame) return false;
  try {
    const host = String(location.hostname || "");
    const fullUrl = String(location.href || "");
    if (!/checkout/i.test(fullUrl)) return false;
    if (/^chatgpt\.com$/i.test(host)) return true;
    return QA_CHECKOUT_HOST_RE.test(host);
  } catch (_) {
    return false;
  }
}

function isCheckoutPage() {
  if (!isMainFrame) return false;
  try {
    const fullUrl = String(location.href || "");
    return /checkout/i.test(fullUrl);
  } catch (_) {
    return false;
  }
}

function isMockOrSandboxHost() {
  if (!isMainFrame) return false;
  try {
    const host = String(location.hostname || "");
    const path = String(location.pathname || "");
    return (
      QA_CHECKOUT_HOST_RE.test(host) ||
      /(?:^|\/)(mock|sandbox|staging|qa|test)(?:\/|$)/i.test(path)
    );
  } catch (_) {
    return false;
  }
}

function normalizeUiText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesUiPatterns(text, patterns) {
  const norm = normalizeUiText(text);
  return !!norm && patterns.some((pattern) => pattern.test(norm));
}

function collectNodes(selectors) {
  const out = [];
  const seen = new Set();
  for (const selector of selectors) {
    try {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        seen.add(el);
        out.push(el);
      }
    } catch (_) {}
  }
  return out;
}

function getAssociatedLabelText(el) {
  if (!el) return "";
  const parts = [];

  const labelledBy = String(el.getAttribute?.("aria-labelledby") || "").trim();
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach((id) => {
      const node = document.getElementById(id);
      if (node) parts.push(node.textContent || "");
    });
  }

  if (el.labels && el.labels.length) {
    parts.push(
      ...Array.from(el.labels).map((label) => label.textContent || ""),
    );
  }

  const id = String(el.id || "").trim();
  if (id) {
    try {
      const byFor = document.querySelector(`label[for="${id}"]`);
      if (byFor) parts.push(byFor.textContent || "");
    } catch (_) {}
  }

  const closestLabel =
    typeof el.closest === "function" ? el.closest("label") : null;
  if (closestLabel) parts.push(closestLabel.textContent || "");

  const fieldWrap =
    typeof el.closest === "function"
      ? el.closest(
          ".react-aria-TextField, ._root_10s5b_51, [data-rac], fieldset, form",
        )
      : null;
  if (fieldWrap) {
    const label = fieldWrap.querySelector("label");
    if (label) parts.push(label.textContent || "");
  }

  return parts.join(" ");
}

function getFieldFingerprint(el) {
  if (!el) return "";
  return [
    getAssociatedLabelText(el),
    el.getAttribute?.("aria-label") || "",
    el.getAttribute?.("placeholder") || "",
    el.getAttribute?.("autocomplete") || "",
    el.getAttribute?.("name") || "",
    el.id || "",
  ].join(" ");
}

function findFieldByPatterns(selectors, patterns) {
  return (
    collectNodes(selectors).find(
      (el) =>
        isInteractable(el) &&
        matchesUiPatterns(getFieldFingerprint(el), patterns),
    ) || null
  );
}

function getActionText(el) {
  return [
    el?.textContent || "",
    el?.value || "",
    el?.getAttribute?.("aria-label") || "",
    el?.getAttribute?.("title") || "",
  ].join(" ");
}

function findButtonByPatterns(scopes, patterns) {
  const selectors =
    'button, [role="button"], input[type="submit"], input[type="button"]';
  for (const scope of scopes) {
    const found = Array.from(scope.querySelectorAll(selectors)).find(
      (el) =>
        isEnabledActionButton(el) && matchesUiPatterns(getActionText(el), patterns),
    );
    if (found) return found;
  }
  return null;
}

function findIdentityNameField() {
  return (
    qs([
      'input[name="name"]',
      'input[autocomplete="name"]',
      'input[id*="fullName" i]',
      'input[placeholder*="Full name" i]',
      'input[id*="name" i]',
    ]) ||
    (isMockOrSandboxHost()
      ? findFieldByPatterns(
          ['input[type="text"]', "input:not([type])", "input"],
          NAME_FIELD_PATTERNS,
        )
      : null)
  );
}

function findBirthdayField() {
  return (
    qs([
      'input[name="birthdate"]',
      'input[name="birthday"]',
      'input[id*="birth" i]',
      'input[placeholder*="MM/DD" i]',
      'input[placeholder*="Birth" i]',
      'input[placeholder*="생일"]',
      'input[placeholder*="연도"]',
      'input[placeholder*="생년월일"]',
      'input[type="date"]',
    ]) ||
    (isMockOrSandboxHost()
      ? findFieldByPatterns(
          [
            'input[type="text"]',
            'input[type="date"]',
            "input:not([type])",
            "input",
          ],
          BIRTHDAY_FIELD_PATTERNS,
        )
      : null)
  );
}

function findAgeField() {
  return (
    qs([
      'input[name="age"]',
      'input[name*="age" i]',
      'input[id*="age" i]',
      'input[placeholder*="Age" i]',
      'input[aria-label*="Age" i]',
    ]) ||
    findFieldByPatterns(
      [
        'input[type="number"]',
        'input[inputmode="numeric"]',
        'input[type="text"]',
        "input:not([type])",
        "input",
      ],
      AGE_FIELD_PATTERNS,
    )
  );
}

function findVisibleEmailField() {
  const direct = qs([
    'input[type="email"]',
    'input[name="email"]',
    'input[id*="email" i]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
  ]);
  if (direct) return direct;

  return findFieldByPatterns(
    [
      'input[type="email"]',
      'input[type="text"]',
      "input:not([type])",
      "input",
    ],
    EMAIL_FIELD_PATTERNS || [/email address/i, /\bemail\b/i]
  );
}

function findVisiblePasswordField() {
  const direct = qs([
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password" i]',
    'input[autocomplete="new-password"]',
    'input[autocomplete="current-password"]',
  ]);
  if (direct) return direct;

  return findFieldByPatterns(
    [
      'input[type="password"]',
      'input[type="text"]',
      "input:not([type])",
      "input",
    ],
    PASSWORD_FIELD_PATTERNS || [/password/i, /mat khau/i]
  );
}

function findVisibleVerificationCodeField() {
  const direct = qs([
    '#totp_otp',
    'input[name="totp_otp"]',
    'form[action*="email-verification"] input[autocomplete="one-time-code"]',
    'input[autocomplete="one-time-code"][name="code"]',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"][maxlength="6"]',
    'input[placeholder*="6-digit" i]',
    'input[name="code"][maxlength="6"]',
    'input[id$="-code" i]',
  ]);
  if (direct) return direct;

  return (
    qs([
      'input[autocomplete="one-time-code"]',
      'input[name*="code" i]',
      'input[id*="code" i]',
      'input[placeholder*="code" i]',
      'input[aria-label*="code" i]',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
      'input[placeholder*="otp" i]',
      'input[inputmode="numeric"]',
    ]) ||
    (isMockOrSandboxHost()
      ? findFieldByPatterns(
          [
            'input[type="text"]',
            'input[type="number"]',
            "input:not([type])",
            "input",
          ],
          [/\bcode\b/i, /verification/i, /otp/i, /one[-\s]?time/i],
        )
      : null)
  );
}

function normalizePotentialSecretText(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "")
    .trim();
}

function findVisibleTwofaSecretFromPage() {
  const directSecretEls = [
    ...Array.from(
      document.querySelectorAll(
        '[role="button"][aria-label="Copy code"], [title="Copy code"]',
      ),
    ),
  ];

  for (const el of directSecretEls) {
    const normalized = normalizePotentialSecretText(el.textContent || "");
    if (normalized.length >= 16) return normalized;
  }

  const secretRe = /\b[A-Z2-7]{16,}\b/g;
  const candidates = [];

  const scopes = [
    ...Array.from(document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]')),
    document.body,
  ].filter(Boolean);

  for (const scope of scopes) {
    const nodes = scope.querySelectorAll(
      "code, kbd, pre, strong, span, div, p, input, textarea",
    );
    for (const node of nodes) {
      let text = "";
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        text = String(node.value || node.placeholder || "");
      } else {
        text = String(node.textContent || "");
      }
      const found = text.match(secretRe);
      if (!found) continue;
      for (const s of found) {
        candidates.push(s.trim());
      }
    }
    if (candidates.length) break;
  }

  if (!candidates.length) return "";
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || "";
}

function clickVerifyIfEnabled() {
  const btn = Array.from(document.querySelectorAll("button")).find((el) => {
    const txt = String(el.textContent || "").trim().toLowerCase();
    return txt === "verify";
  });
  if (!isEnabledActionButton(btn)) return false;
  clickLikeMouse(btn);
  return true;
}

function normalizeActionSearchScopes(scopes) {
  const source = Array.isArray(scopes) && scopes.length ? scopes : [document];
  const out = [];
  const seen = new Set();
  for (const scope of source) {
    if (!scope || typeof scope.querySelectorAll !== "function") continue;
    if (seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out.length ? out : [document];
}

function isEnabledActionButton(el) {
  if (!el) return false;
  if (el.disabled) return false;
  const hasTruthyAttr = (name) => {
    const value = el.getAttribute?.(name);
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === "" || normalized === "true";
  };
  if (hasTruthyAttr("disabled")) return false;
  if (hasTruthyAttr("aria-disabled"))
    return false;
  if (hasTruthyAttr("data-disabled"))
    return false;
  if (typeof el.closest === "function") {
    const disabledParent = el.closest('[aria-disabled="true"], [data-disabled="true"]');
    if (disabledParent && disabledParent !== el) return false;
  }
  return isInteractable(el);
}

function clickContinueIfEnabled(options = {}) {
  const scopes = normalizeActionSearchScopes(options.scopes);
  const byAction = scopes
    .map((scope) =>
      scope.querySelector(
        'form[action*="email-verification"] button[type="submit"][name="intent"][value="validate"]',
      ),
    )
    .find(isEnabledActionButton);
  if (byAction) {
    clickLikeMouse(byAction);
    return true;
  }

  const selectors =
    'button, [role="button"], input[type="submit"], input[type="button"]';
  const btn = scopes
    .flatMap((scope) => Array.from(scope.querySelectorAll(selectors)))
    .find((el) => {
      const txt = String(getActionText(el) || "").trim().toLowerCase();
      if (txt !== "continue") return false;
      return isEnabledActionButton(el);
    });
  if (!btn) return false;
  clickLikeMouse(btn);
  return true;
}

function clickContinueWithRetry(maxAttempts = 10, delayMs = 140, options = {}) {
  return new Promise((resolve) => {
    let attempt = 0;
    const run = () => {
      if (clickContinueIfEnabled(options)) {
        resolve(true);
        return;
      }
      attempt += 1;
      if (attempt >= maxAttempts) {
        resolve(false);
        return;
      }
      setTimeout(run, delayMs);
    };
    run();
  });
}

function setAutoSubmitStatus(status) {
  autoSubmitState.status = status;
  if (document.documentElement) {
    document.documentElement.dataset.afQaAutoSubmitState = status;
  }
}

function updateAutoSubmitButtons() {
  const autoBtn = document.getElementById("af-btn-auto-submit");
  const pauseBtn = document.getElementById("af-btn-pause");
  const stopBtn = document.getElementById("af-btn-stop");
  const checkoutPage = isCheckoutPage();

  if (autoBtn) {
    autoBtn.style.display = checkoutPage ? "flex" : "none";
    autoBtn.textContent = autoSubmitState.waitingForCaptcha
      ? "Waiting QA"
      : "Auto Submit";
    autoBtn.style.opacity = autoSubmitState.running ? "0.7" : "1";
    autoBtn.style.pointerEvents = autoSubmitState.running ? "none" : "auto";
  }

  if (pauseBtn) {
    pauseBtn.style.display = autoSubmitState.running ? "flex" : "none";
    if (autoSubmitState.paused) {
      pauseBtn.textContent = "Resume";
      pauseBtn.style.background = "#27ae60";
    } else {
      pauseBtn.textContent = "Pause";
      pauseBtn.style.background = "#d35400";
    }
  }

  if (stopBtn) {
    stopBtn.style.display =
      autoSubmitState.running || checkoutPage ? "flex" : "none";
    stopBtn.style.opacity = autoSubmitState.running ? "1" : "0.45";
    stopBtn.style.pointerEvents = autoSubmitState.running ? "auto" : "none";
  }
}

function stopAutoSubmit(reason, color = "#555", silent = false) {
  autoSubmitState.running = false;
  autoSubmitState.paused = false;
  autoSubmitState.waitingForCaptcha = false;
  autoSubmitState.runId += 1;
  pendingCaptchaAction = null;
  lastQaConsoleFailure = "";
  setAutoSubmitStatus("stopped");
  updateAutoSubmitButtons();
  chrome.storage.local.remove("fillTrigger", () => {});
  if (!silent && reason) toast(reason, color);
}

function handleStopAutoSubmitClick() {
  stopAutoSubmit("QA Auto Submit da dung.", "#555");
}

function handlePauseResumeClick() {
  if (!autoSubmitState.running) return;
  autoSubmitState.paused = !autoSubmitState.paused;
  if (autoSubmitState.paused) {
    setAutoSubmitStatus("paused");
    toast("Paused. Bam Resume de tiep tuc.", "#d35400");
  } else {
    setAutoSubmitStatus("running");
    toast("Resumed! Dang tiep tuc test...", "#27ae60");
  }
  updateAutoSubmitButtons();
}

function startConsoleSignalWatch() {
  if (!isMainFrame) return;
  if (!isCheckoutPage()) return;
  if (!window.__afQaConsoleSignalBound) {
    window.__afQaConsoleSignalBound = true;
    window.addEventListener(AUTO_SUB_CONSOLE_EVENT, (event) => {
      const message = String(event.detail?.message || "").trim();
      if (message && QA_AUTH_FAILURE_RE.test(message)) {
        lastQaConsoleFailure = message;
      }
    });
  }

  if (document.documentElement?.dataset?.afQaConsoleBridgeInjected === "1")
    return;
  document.documentElement.dataset.afQaConsoleBridgeInjected = "1";

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-console-bridge.js");
  script.onload = () => script.remove();
  script.onerror = () => {
    document.documentElement.dataset.afQaConsoleBridgeInjected = "0";
  };
  (document.documentElement || document.head || document.body).appendChild(
    script,
  );
}

// ─── Helper: nhận diện trang /checkout/verify?stripe_session_id= là SUCCESS ───
// Khi Stripe redirect về đây với stripe_session_id, nghĩa là payment đã charge xong.
// "Processing Payment" ở trang này = ChatGPT đang sync, KHÔNG phải đang chờ charge.
function isStripeVerifySuccessPage() {
  try {
    const url = String(location.href || "");
    return (
      /\/checkout\/verify[?&#]/i.test(url) && /stripe_session_id=/i.test(url)
    );
  } catch (_) {
    return false;
  }
}

// ─── Helper: nhận diện trang payments/success ───
// Chỉ bắt đúng URL /payments/success-team của ChatGPT
function isPaymentSuccessUrl(url) {
  const u = String(url || location.href || "");
  return /\/payments\/success/i.test(u);
}

function startCheckoutExitWatch() {
  if (!isMainFrame || window.__afQaCheckoutExitWatchStarted) return;
  window.__afQaCheckoutExitWatchStarted = true;

  // ─── beforeunload: lưu pending success check trước khi trang reload/redirect ───
  window.addEventListener("beforeunload", () => {
    if (!autoSubmitState.running) return;
    if (!isCheckoutPage()) return;
    try {
      sessionStorage.setItem("af_pending_success_check", "1");
    } catch (_) {}
    try {
      chrome.storage.local.set({ af_pending_success_check: "1" });
    } catch (_) {}
  });

  const loop = async () => {
    if (autoSubmitState.running) {
      // ── Case 1: Stripe Verify page (/checkout/verify?stripe_session_id=) ──
      // Đây là SUCCESS: Stripe đã charge card, ChatGPT đang sync backend.
      // "Processing Payment" ở đây KHÔNG có nghĩa là đang chờ charge.
      if (isStripeVerifySuccessPage()) {
        if (!window.__afVerifyPageSaved) {
          window.__afVerifyPageSaved = true;
          await saveLastAttemptCardAsSuccess();
          toast("Processing Payment = Thanh cong! Da luu card.", "#27ae60");
          // Không stopAutoSubmit – trang sẽ tự redirect tiếp sang success page
        }
      }
      // ── Case 2: Rời hẳn khỏi checkout (SPA navigation / redirect) ──
      else if (!isCheckoutPage()) {
        const visibleText = getVisibleText();
        const url = String(location.href || "");
        // Đã là success URL (payments/success-team, v.v.)
        const successByUrl = isPaymentSuccessUrl(url);
        // Hoặc text thành công mà KHÔNG phải processing thông thường
        const successByText = visibleText && QA_SUCCESS_RE.test(visibleText);
        if (successByUrl || successByText) {
          if (!window.__afVerifyPageSaved) {
            // Tránh duplicate nếu đã save ở verify page rồi
            await saveLastAttemptCardAsSuccess();
          }
          toast("Payment successful! Da luu card.", "#27ae60");
        }
        stopAutoSubmit("Da roi trang checkout. Auto Submit tu dung.", "#555");
      }
    }
    setTimeout(loop, 600);
  };

  loop();
}

// ─── Khi trang mới load: xử lý pending success check từ lần trước ───
async function checkPendingSuccessOnLoad() {
  let pending = false;
  try {
    if (sessionStorage.getItem("af_pending_success_check") === "1") {
      pending = true;
      sessionStorage.removeItem("af_pending_success_check");
    }
  } catch (_) {}

  if (!pending) {
    try {
      const data = await storageLocalGet(["af_pending_success_check"]);
      if (data?.af_pending_success_check === "1") pending = true;
    } catch (_) {}
  }
  try {
    chrome.storage.local.remove("af_pending_success_check");
  } catch (_) {}

  if (!pending) return;

  const doCheck = async () => {
    const url = String(location.href || "");

    // Case A: Trang mới là Stripe verify page = SUCCESS (Processing Payment)
    if (isStripeVerifySuccessPage()) {
      await sleep(800);
      await saveLastAttemptCardAsSuccess();
      toast(
        "[Pending] Processing Payment = Thanh cong! Da luu card.",
        "#27ae60",
      );
      return;
    }

    // Case B: Không còn ở checkout → check URL và text
    if (!isCheckoutPage()) {
      await sleep(1200);
      const visibleText = getVisibleText();
      const successByUrl = isPaymentSuccessUrl(url);
      const successByText = visibleText && QA_SUCCESS_RE.test(visibleText);
      if (successByUrl || successByText) {
        await saveLastAttemptCardAsSuccess();
        toast("[Pending] Da luu card thanh cong sau reload!", "#27ae60");
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", doCheck);
  } else {
    doCheck();
  }
}

// ============================================================
// AUTO ONBOARDING SKIP
// ============================================================
// ============================================================
// AUTO AGE GATE FILL — gọi y chang handleNameClick()
// ============================================================
function startAgeGateAutoFill() {
  if (!isMainFrame || window.__afAgeGateWatchStarted) return;
  window.__afAgeGateWatchStarted = true;

  let _lastFilled = "";
  let _filling = false;

  function isAgeGatePage() {
    if (/auth\.openai\.com\/about-you/i.test(location.href)) return true;
    const h1 = document.querySelector("h1")?.textContent || "";
    if (matchesUiPatterns(h1, AGE_GATE_HEADING_PATTERNS)) return true;
    const hasName = !!findIdentityNameField();
    const hasBirthday = !!(
      document.querySelector('[data-type="month"][role="spinbutton"]') ||
      document.querySelector('input[name="birthday"]') ||
      document.querySelector('input[type="hidden"][name="birthday"]') ||
      findBirthdayField()
    );
    const hasAge = !!findAgeField();
    return hasName && (hasBirthday || hasAge);
  }

  async function tryAutoFillAgeGate() {
    if (_filling) return;
    if (!isAgeGatePage()) return;
    const key =
      location.href + "|" + (document.querySelector("h1")?.textContent || "");
    if (_lastFilled === key) return;
    _lastFilled = key;
    _filling = true;

    // Đợi age/birthday field có trong DOM
    for (let i = 0; i < 50; i++) {
      const ready = !!(
        findAgeField() ||
        document.querySelector('[data-type="month"][role="spinbutton"]') ||
        document.querySelector('input[name="birthday"]') ||
        document.querySelector('input[type="hidden"][name="birthday"]') ||
        findBirthdayField()
      );
      if (ready) break;
      await sleep(200);
    }

    if (!isAgeGatePage()) {
      _filling = false;
      return;
    }

    // Bấm nút Tên KR
    const tenKrBtn = document.getElementById("af-btn-name");
    if (tenKrBtn) {
      tenKrBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    } else {
      handleNameClick();
    }

    // Đợi trang rời khỏi age gate (tối đa 30s) — không đợi cứng
    for (let i = 0; i < 150; i++) {
      await sleep(200);
      if (!isAgeGatePage()) break;
    }

    _filling = false;

    // Trang đã rời age gate → bắt đầu chuỗi onboarding
    await runOnboardingSequence();
  }

  async function runOnboardingSequence() {
    const getText = (el) => (el.textContent || "").trim();
    const isVisible = (el) => {
      if (el.disabled) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom < 0 || r.top > window.innerHeight) return false;
      if (r.right < 0 || r.left > window.innerWidth) return false;
      const st = window.getComputedStyle(el);
      return (
        st.display !== "none" &&
        st.visibility !== "hidden" &&
        st.opacity !== "0"
      );
    };

    // Danh sách các bước theo đúng thứ tự — mỗi bước đợi button hiện ra rồi mới bấm
    const steps = [
      SKIP_BUTTON_PATTERNS, // 1. What brings you to ChatGPT? → Skip
      SKIP_BUTTON_PATTERNS, // 2. What do you want to do? → Skip
      SKIP_TOUR_BUTTON_PATTERNS, // 3. Ask anything → Skip Tour
      CONTINUE_BUTTON_PATTERNS, // 4. You're all set → Continue
      OKAY_BUTTON_PATTERNS, // 5. Tips popup → Okay let's go
      CLAIM_BUTTON_PATTERNS, // 6. Claim offer
    ];

    for (const patterns of steps) {
      // Đợi button hiện ra — tối đa 15s mỗi bước
      let btn = null;
      for (let i = 0; i < 75; i++) {
        const all = Array.from(
          document.querySelectorAll('button, [role="button"]'),
        );
        btn = all.find(
          (el) => isVisible(el) && matchesUiPatterns(getText(el), patterns),
        );
        if (btn) break;
        await sleep(200);
      }
      if (!btn) continue; // Không thấy thì bỏ qua bước này

      // Delay mô phỏng người dùng đọc thông tin
      const readDelayMs = 1500 + Math.floor(Math.random() * 2500);
      await sleep(readDelayMs);

      clickLikeMouse(btn);

      // Delay sau click để chờ trang chuyển
      const postClickDelayMs = 2000 + Math.floor(Math.random() * 1500);
      await sleep(postClickDelayMs);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => tryAutoFillAgeGate());
  } else {
    tryAutoFillAgeGate();
  }

  const obs = new MutationObserver(() => tryAutoFillAgeGate());
  const startObs = () => {
    if (document.body)
      obs.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) startObs();
  else document.addEventListener("DOMContentLoaded", startObs);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      tryAutoFillAgeGate();
      if (typeof updateAutoSubmitButtons === "function") {
        updateAutoSubmitButtons();
      }
    }
  }, 400);
}

function getVisibleText() {
  const text =
    document.body?.innerText || document.documentElement?.innerText || "";
  return String(text).replace(/\s+/g, " ").trim();
}

function findSubscribeButton() {
  return Array.from(document.querySelectorAll('button, [role="button"]')).find(
    (el) =>
      /subscribe|start.?trial|confirm|pay now|submit/i.test(
        (el.textContent || "").trim(),
      ),
  );
}

function getSavedCardLines(rawCards) {
  return String(rawCards || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSandboxCardLines(count = 12, startOffset = 0) {
  const total = SANDBOX_TEST_CARD_LINES.length;
  if (!total) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(SANDBOX_TEST_CARD_LINES[(startOffset + i) % total]);
  }
  return out;
}

function pickNextCardForAutofill(data) {
  const savedLines = getSavedCardLines(data?.cards);

  const pickFromLines = (lines, startIdx) => {
    if (!lines.length) return null;
    const start = Math.max(0, Number(startIdx || 0));
    for (let i = 0; i < lines.length; i++) {
      const idx = (start + i) % lines.length;
      const parsed = parseCardLine(lines[idx]);
      if (parsed) {
        return {
          cardData: parsed,
          nextIndex: (idx + 1) % lines.length,
          source: "saved",
        };
      }
    }
    return null;
  };

  const savedPicked = pickFromLines(savedLines, data?.cardIndex);
  if (savedPicked) return savedPicked;

  const sandboxLines = SANDBOX_TEST_CARD_LINES.slice();
  const sandboxStart = Number(data?.cardIndex || 0) % sandboxLines.length;
  const sandboxPicked = pickFromLines(sandboxLines, sandboxStart);
  if (!sandboxPicked) return null;
  return { ...sandboxPicked, source: "sandbox" };
}

// ✅ Code đúng
function luhnCheckDigit(partial) {
  let sum = 0;
  let isEven = true; // ← Đổi thành TRUE (vì partial sẽ có check digit nối vào sau)
  for (let i = partial.length - 1; i >= 0; i--) {
    let digit = parseInt(partial[i], 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  return (10 - (sum % 10)) % 10;
}

function isLuhnValid(number) {
  const digits = String(number || "").replace(/\D/g, "");
  if (!digits) return false;
  const partial = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  if (!partial || Number.isNaN(check)) return false;
  return luhnCheckDigit(partial) === check;
}

function normalizeAutoTestScope(v) {
  return "per_bin";
}

function normalizeAutoBinStrategy(v) {
  return ["round_robin", "sequential", "random"].includes(v)
    ? v
    : "round_robin";
}

function normalizeAutoExpiryMode(v) {
  return ["random_future", "fixed", "next_year"].includes(v)
    ? v
    : "random_future";
}

function normalizeAutoCvvMode(v) {
  return ["fixed_test", "random"].includes(v) ? v : "fixed_test";
}

function pickBinByStrategy(bins, currentIndex, usageMap, strategy) {
  if (!Array.isArray(bins) || !bins.length) {
    return { selectedBin: "", nextIndex: 0 };
  }

  if (strategy === "random") {
    const idx = Math.floor(Math.random() * bins.length);
    return { selectedBin: bins[idx], nextIndex: idx };
  }

  if (strategy === "sequential") {
    // ửe thứ tự từ trên xuống dưới:
    // giữ nguyên BIN hiện tại (currentIndex) cho đến khi đủ limit,
    // rồi mới chuyển sang BIN kế tiếp.
    const safeIndex = Number(currentIndex || 0) % bins.length;
    return { selectedBin: bins[safeIndex], nextIndex: safeIndex };
  }

  // round_robin (default): mỗi lần xoay sang BIN kế
  const safeIndex = Number(currentIndex || 0) % bins.length;
  return { selectedBin: bins[safeIndex], nextIndex: safeIndex };
}

function generateNextCardFromBIN(
  bin,
  length = 16,
  expiryMode = "random_future",
  cvvMode = "fixed_test",
) {
  const binStr = String(bin).replace(/\D/g, "");
  const accountLen = length - binStr.length - 1;
  if (accountLen < 0) return null;
  let account = "";
  for (let j = 0; j < accountLen; j++)
    account += Math.floor(Math.random() * 10);
  const partial = binStr + account;
  const checkDigit = luhnCheckDigit(partial);
  const pan = partial + checkDigit;
  let mm = "12";
  let yyyy = "2030";
  const safeExpiryMode = normalizeAutoExpiryMode(expiryMode);
  if (safeExpiryMode === "random_future") {
    mm = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
    yyyy = (2027 + Math.floor(Math.random() * 8)).toString();
  } else if (safeExpiryMode === "next_year") {
    mm = "12";
    yyyy = String(new Date().getFullYear() + 1);
  }

  const safeCvvMode = normalizeAutoCvvMode(cvvMode);
  const cvvLen = length === 15 ? 4 : 3;
  let cvv = cvvLen === 4 ? "1234" : "123";
  if (safeCvvMode === "random") {
    const max = Math.pow(10, cvvLen);
    cvv = String(Math.floor(Math.random() * max)).padStart(cvvLen, "0");
  }
  return `${pan}|${mm}|${yyyy}|${cvv}`;
}

function parseAutoBINList(raw) {
  const source = Array.isArray(raw) ? raw.join("\n") : String(raw || "");
  const items = source
    .split(/\r?\n|,|;|\s+/)
    .map((s) => s.replace(/\D/g, "").trim())
    .filter((s) => s.length >= 1 && s.length <= 15);
  return [...new Set(items)];
}

function pickRandomCardForFlexibleFill(data) {
  const autoBins = parseAutoBINList(data?.autoBINList || data?.autoBIN || "");
  if (data?.isAutoGenMode === true && autoBins.length) {
    const strategy = normalizeAutoBinStrategy(data?.autoBinStrategy);
    const baseIndex = Number(data?.autoBinIndex || 0) % autoBins.length;
    const selectedBin =
      strategy === "random"
        ? autoBins[Math.floor(Math.random() * autoBins.length)]
        : autoBins[baseIndex];
    const cardLine = generateNextCardFromBIN(
      selectedBin,
      data?.cardLength || 16,
      normalizeAutoExpiryMode(data?.autoExpiryMode),
      normalizeAutoCvvMode(data?.autoCvvMode),
    );
    if (cardLine) {
      const [pan, mm, yyyy, cvv] = cardLine.split("|");
      return {
        cardData: { number: pan, month: mm, year: yyyy.slice(-2), cvv: cvv },
        nextCardIndex: Number(data?.cardIndex || 0),
      };
    }
  }

  const picked = pickNextCardForAutofill(data);
  if (!picked) {
    return {
      cardData: null,
      nextCardIndex: Number(data?.cardIndex || 0),
    };
  }
  return {
    cardData: picked.cardData,
    nextCardIndex: picked.nextIndex,
  };
}

function cardDataToLogLine(cardData) {
  if (!cardData) return "";
  const number = String(cardData.number || "").replace(/\D/g, "");
  const month = String(cardData.month || "")
    .replace(/\D/g, "")
    .padStart(2, "0")
    .slice(-2);
  const year = String(cardData.year || "").replace(/\D/g, "");
  const cvv = String(cardData.cvv || "").replace(/\D/g, "");
  if (!number || !month || !year || !cvv) return "";
  return `${number}|${month}|${year}|${cvv}`;
}

async function appendCardLog(key, line, maxLines = 1000) {
  const safeLine = String(line || "").trim();
  if (!safeLine) return;

  const data = await storageLocalGet([key]);
  const current = String(data?.[key] || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  current.push(safeLine);
  const limited = current.slice(-maxLines);
  await storageLocalSet({ [key]: limited.join("\n") });
}

async function saveLastAttemptCardAsSuccess() {
  const data = await storageLocalGet(["lastAttemptCardLine"]);
  const last = String(data.lastAttemptCardLine || "").trim();
  if (!last) return;
  await appendCardLog("successfulCardsLog", last);
  // Clear lastAttemptCardLine sau khi save để tránh duplicate
  await storageLocalSet({ lastAttemptCardLine: "" });
}

async function prepareSubmitPayload() {
  const data = await storageLocalGet([
    "isAutoGenMode",
    "autoBIN",
    "autoBINList",
    "autoBinIndex",
    "autoBinUsageMap",
    "cardLength",
    "testCounter",
    "maxTestCount",
    "autoTestScope",
    "autoBinStrategy",
    "autoExpiryMode",
    "autoCvvMode",
    "cards",
    "cardIndex",
    "addresses",
    "addrIndex",
    "addressMode",
    "lockedAddrData",
    "lockedAddrMode",
    "usedCardsLog",
  ]);

  const usedCardsSet = new Set(
    String(data.usedCardsLog || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Ưu tiên Auto Gen Mode
  let cardData = null;
  const autoBins = parseAutoBINList(data.autoBINList || data.autoBIN || "");
  if (data.isAutoGenMode === true && autoBins.length) {
    const testScope = normalizeAutoTestScope(data.autoTestScope);
    const binStrategy = normalizeAutoBinStrategy(data.autoBinStrategy);
    const expiryMode = normalizeAutoExpiryMode(data.autoExpiryMode);
    const cvvMode = normalizeAutoCvvMode(data.autoCvvMode);
    const usageMap =
      data.autoBinUsageMap && typeof data.autoBinUsageMap === "object"
        ? { ...data.autoBinUsageMap }
        : {};

    const limit = Number(data.maxTestCount || 100);
    const currentTotal = Number(data.testCounter || 0);
    const { selectedBin, nextIndex } = pickBinByStrategy(
      autoBins,
      data.autoBinIndex,
      usageMap,
      binStrategy,
    );

    if (!selectedBin) {
      toast("Khong co BIN hop le.", "#c0392b");
      return null;
    }

    const currentBinUsage = Number(usageMap[selectedBin] || 0);
    const reachedLimit =
      testScope === "per_bin"
        ? currentBinUsage >= limit
        : currentTotal >= limit;

    if (reachedLimit) {
      if (testScope === "per_bin") {
        const hasAnyRemaining = autoBins.some(
          (b) => Number(usageMap[b] || 0) < limit,
        );
        if (!hasAnyRemaining) {
          toast("Da dat gioi han test tren tat ca BIN!", "#c0392b");
          return null;
        }

        // Sequential: tìm BIN kế tiếp theo thứ tự sau index hiện tại
        // Round Robin / Random: lấy BIN đầu tiên trong danh sách chưa đủ limit
        let fallbackBin, fallbackIndex;
        if (binStrategy === "sequential") {
          const curIdx = Number(data.autoBinIndex || 0) % autoBins.length;
          let found = false;
          for (let i = 1; i <= autoBins.length; i++) {
            const idx = (curIdx + i) % autoBins.length;
            if (Number(usageMap[autoBins[idx]] || 0) < limit) {
              fallbackIndex = idx;
              fallbackBin = autoBins[idx];
              found = true;
              break;
            }
          }
          if (!found) {
            toast("Da dat gioi han test tren tat ca BIN!", "#c0392b");
            return null;
          }
        } else {
          const remainingBins = autoBins.filter(
            (b) => Number(usageMap[b] || 0) < limit,
          );
          fallbackBin = remainingBins[0];
          fallbackIndex = Math.max(0, autoBins.indexOf(fallbackBin));
        }

        let cardLineFallback = null;
        for (let attempt = 0; attempt < 50; attempt++) {
          const candidate = generateNextCardFromBIN(
            fallbackBin,
            data.cardLength || 16,
            expiryMode,
            cvvMode,
          );
          if (candidate && !usedCardsSet.has(candidate)) {
            cardLineFallback = candidate;
            break;
          }
        }

        if (cardLineFallback) {
          const [pan, mm, yyyy, cvv] = cardLineFallback.split("|");
          cardData = { number: pan, month: mm, year: yyyy.slice(-2), cvv: cvv };
          usageMap[fallbackBin] = Number(usageMap[fallbackBin] || 0) + 1;
          await storageLocalSet({
            testCounter: currentTotal + 1,
            // sequential: lưu fallbackIndex để lần sau vẫn ở BIN mới
            // round_robin: advance thêm 1
            autoBinIndex:
              binStrategy === "round_robin"
                ? (fallbackIndex + 1) % autoBins.length
                : fallbackIndex,
            autoBIN: fallbackBin,
            autoBinUsageMap: usageMap,
          });
        }
      } else {
        toast("Đã đạt giới hạn số lần test!", "#c0392b");
        return null;
      }
    } else {
      let cardLine = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        const candidate = generateNextCardFromBIN(
          selectedBin,
          data.cardLength || 16,
          expiryMode,
          cvvMode,
        );
        if (candidate && !usedCardsSet.has(candidate)) {
          cardLine = candidate;
          break;
        }
      }

      if (cardLine) {
        const [pan, mm, yyyy, cvv] = cardLine.split("|");
        cardData = { number: pan, month: mm, year: yyyy.slice(-2), cvv: cvv };
        usageMap[selectedBin] = currentBinUsage + 1;
        await storageLocalSet({
          testCounter: currentTotal + 1,
          // sequential: giữ nguyên index (nextIndex = currentIndex), không tăng
          // round_robin: tăng thêm 1 mỗi lần
          autoBinIndex:
            binStrategy === "round_robin"
              ? (nextIndex + 1) % autoBins.length
              : nextIndex,
          autoBIN: selectedBin,
          autoBinUsageMap: usageMap,
        });
      }
    }

    if (!cardData) {
      toast("Đã đạt giới hạn số lần test!", "#c0392b");
      return null;
    }
  }

  // Fallback sang danh sách thẻ thủ công/sandbox
  if (!cardData) {
    const picked = pickNextCardForAutofill(data);
    if (!picked) {
      toast("Khong co test card hop le.", "#e67e22");
      return null;
    }
    cardData = picked.cardData;
  }

  const addressMode = normalizeAddressMode(data.addressMode);
  const addrData = resolveAddressForAutofill(data, addressMode);
  const usedCardLine = cardDataToLogLine(cardData);
  await storageLocalSet({
    fillTrigger: { cardData, addrData, ts: Date.now() },
    cardIndex: (data.cardIndex || 0) + 1,
    addrIndex: getAddressUsageValue(data.addresses, addressMode),
    lastAttemptCardLine: usedCardLine,
  });

  await appendCardLog("usedCardsLog", usedCardLine);

  return { cardData, addrData };
}

function normalizeLockedAddress(raw) {
  if (!raw || typeof raw !== "object") return null;
  const state = String(raw.state || "").trim();
  const city = String(raw.city || "").trim();
  const address = String(raw.address || "").trim();
  const postal = String(raw.postal || "").trim();
  if (!state || !city || !address || !postal) return null;
  return {
    name: String(raw.name || "").trim(),
    country: String(raw.country || "").trim(),
    state,
    city,
    address,
    postal,
  };
}

function resolveAddressForAutofill(data, addressMode) {
  const mode = normalizeAddressMode(addressMode);
  const identity = buildRandomIdentity(mode);
  return buildRandomAddress(identity.name, data?.addresses, mode);
}

function hasCaptchaChallengeVisible() {
  const frame = findCaptchaIframe();
  if (!frame) return false;
  const rect = frame.getBoundingClientRect();
  return rect.width > 100 && rect.height > 100;
}

async function waitForCaptchaChallenge(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasCaptchaChallengeVisible()) return true;
    await sleep(300);
  }
  return false;
}

function detectQaAuthFailure() {
  if (lastQaConsoleFailure && QA_AUTH_FAILURE_RE.test(lastQaConsoleFailure)) {
    return lastQaConsoleFailure;
  }

  const visibleText = getVisibleText();
  if (visibleText && QA_AUTH_FAILURE_RE.test(visibleText)) {
    return visibleText.match(QA_AUTH_FAILURE_RE)?.[0] || "payment-auth-failed";
  }

  return "";
}

function detectQaSuccess() {
  const visibleText = getVisibleText();
  if (!visibleText) return "";
  if (!QA_SUCCESS_RE.test(visibleText)) return "";
  return visibleText.match(QA_SUCCESS_RE)?.[0] || "success";
}

async function resetQaTestForm() {
  await storageLocalRemove("fillTrigger");
  const focusEl = qs([
    'input[name="cardnumber"]',
    'input[autocomplete="cc-number"]',
    'input[name="exp-date"]',
    'input[name="cvc"]',
    'input[autocomplete="name"]',
    "button",
  ]);

  if (focusEl?.scrollIntoView) {
    focusEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (focusEl?.focus) {
    focusEl.focus();
  }
}

async function runSubmitAttempt(source = "manual", runId = null) {
  if (runId != null && !isActiveAutoSubmit(runId)) return false;

  const prepared = await prepareSubmitPayload();
  if (!prepared) return false;
  if (runId != null && !isActiveAutoSubmit(runId)) return false;

  toast("Da fill form test. Dang bam Submit...", "#27ae60");
  await sleep(2500);
  if (runId != null && !isActiveAutoSubmit(runId)) return false;

  const subscribeBtn = findSubscribeButton();
  if (!subscribeBtn || subscribeBtn.disabled) {
    toast("Khong thay nut Submit/Subscribe!", "#e67e22");
    return false;
  }

  clickLikeMouse(subscribeBtn);
  if (runId != null && !isActiveAutoSubmit(runId)) return false;

  if (source === "manual") {
    const captchaVisible = await waitForCaptchaChallenge();
    if (captchaVisible) {
      toast(
        "Captcha da hien. Hoan tat thu cong roi theo doi ket qua test.",
        "#8e44ad",
      );
    } else {
      toast("Da gui yeu cau test. Theo doi phan hoi sandbox.", "#2980b9");
    }
  } else {
    toast("QA Auto Submit dang doi ban hoan tat captcha thu cong.", "#16a085");
  }

  return true;
}

function isActiveAutoSubmit(runId) {
  return autoSubmitState.running && autoSubmitState.runId === runId;
}

async function waitForAutoSubmitOutcome(runId, timeoutMs = 90000) {
  const startedAt = Date.now();
  const minOutcomeDetectDelayMs = 1800;
  const noCaptchaOutcomeWindowMs = 12000;
  const postCaptchaOutcomeWindowMs = 25000;
  let captchaSeen = false;
  let captchaClearedAt = 0;

  while (isActiveAutoSubmit(runId)) {
    const captchaVisible = hasCaptchaChallengeVisible();

    // Captcha vừa xuất hiện
    if (captchaVisible && !captchaSeen) {
      captchaSeen = true;
      captchaClearedAt = 0;
      lastQaConsoleFailure = ""; // reset lỗi cũ trước captcha
      autoSubmitState.waitingForCaptcha = true;
      setAutoSubmitStatus("waiting_captcha");
      updateAutoSubmitButtons();
      toast("Cho nguoi dung giai captcha...", "#8e44ad");
    }

    // Captcha vừa biến mất (người dùng giải xong)
    if (!captchaVisible && captchaSeen && !captchaClearedAt) {
      captchaClearedAt = Date.now();
      autoSubmitState.waitingForCaptcha = false;
      setAutoSubmitStatus("running");
      updateAutoSubmitButtons();
      toast("Captcha xong. Dang doi ket qua the...", "#2980b9");
    }

    const elapsedMs = Date.now() - startedAt;
    const canCheckOutcome = elapsedMs >= minOutcomeDetectDelayMs;

    // Check xem có đang processing không
    const visibleText = getVisibleText();
    const isProcessing = visibleText && QA_PROCESSING_RE.test(visibleText);

    // Luôn check kết quả sau một khoảng trễ ngắn, kể cả khi không hiện captcha.
    if (canCheckOutcome) {
      const failure = detectQaAuthFailure();
      if (failure) return { kind: "auth-failed", message: failure };

      const success = detectQaSuccess();
      if (success) return { kind: "success", message: success };
    }

    // Nếu có captcha thì timeout sau khi captcha được giải xong.
    if (captchaClearedAt) {
      // Không thấy outcome rõ ràng sau khi captcha xong -> sang vòng fill tiếp.
      if (Date.now() - captchaClearedAt > postCaptchaOutcomeWindowMs) {
        return { kind: "timeout" };
      }
    } else if (!captchaSeen && elapsedMs > noCaptchaOutcomeWindowMs) {
      // Yêu cầu của user: đợi đến khi thấy báo thẻ lỗi mới điền lại
      // Không timeout sớm ở đây nữa, cứ tiếp tục đợi cho đến khi hết timeout tổng (90s)
      // if (!isProcessing) {
      //   return { kind: "timeout" };
      // }
    }

    // Timeout tổng (nhưng nếu processing thì extend thêm)
    const maxWait = isProcessing ? timeoutMs + 30000 : timeoutMs;
    if (Date.now() - startedAt > maxWait) {
      return { kind: "timeout" };
    }

    await sleep(400);
  }

  return { kind: "stopped" };
}

async function handleAutoSubmitClick() {
  if (autoSubmitState.running) {
    toast("Auto Submit dang chay. Bam Stop neu muon dung.", "#e67e22");
    return;
  }

  if (!isCheckoutPage()) {
    toast("Auto Submit chi dung tren trang checkout.", "#e67e22");
    updateAutoSubmitButtons();
    return;
  }

  lastQaConsoleFailure = "";
  autoSubmitState.running = true;
  autoSubmitState.waitingForCaptcha = false;
  autoSubmitState.runId += 1;
  setAutoSubmitStatus("running");
  updateAutoSubmitButtons();

  const runId = autoSubmitState.runId;

  // Loop liên tục — chỉ dừng khi: success, stop thủ công, rời checkout, hết thẻ
  while (isActiveAutoSubmit(runId)) {
    // ── Pause check: chờ resume trước khi fill vòng mới ──
    while (autoSubmitState.paused && isActiveAutoSubmit(runId)) {
      await sleep(400);
    }
    if (!isActiveAutoSubmit(runId)) return;

    lastQaConsoleFailure = "";

    const started = await runSubmitAttempt("auto", runId);
    if (!started) {
      if (isActiveAutoSubmit(runId))
        stopAutoSubmit(
          "Het the kha dung hoac dinh dang sai. Auto Submit dung.",
          "#e67e22",
        );
      return;
    }

    const outcome = await waitForAutoSubmitOutcome(runId);
    if (!isActiveAutoSubmit(runId)) return;

    if (outcome.kind === "success") {
      await saveLastAttemptCardAsSuccess();
      stopAutoSubmit("Auto Submit hoan tat thanh cong!", "#27ae60");
      return;
    }

    if (outcome.kind === "stopped") {
      stopAutoSubmit("", "#555", true);
      return;
    }

    if (outcome.kind === "timeout") {
      toast(
        "Check thanh toan chua ro. Dang tu fill lai vong tiep theo...",
        "#2980b9",
      );
      await sleep(1200);
      if (!isActiveAutoSubmit(runId)) return;
      await resetQaTestForm();
      if (!isActiveAutoSubmit(runId)) return;
      await sleep(800);
      if (!isActiveAutoSubmit(runId)) return;
      continue;
    }

    if (outcome.kind === "auth-failed") {
      // Thẻ bị từ chối -> bỏ khóa địa chỉ để vòng sau đổi cả thẻ + địa chỉ.
      await storageLocalSet({
        lockedAddrData: null,
        lockedAddrMode: "",
      });
      toast("The bi tu choi. Dang doi the + doi dia chi...", "#e67e22");
      await sleep(1200);
      if (!isActiveAutoSubmit(runId)) return;
      await resetQaTestForm();
      if (!isActiveAutoSubmit(runId)) return;
      await sleep(800);
      if (!isActiveAutoSubmit(runId)) return;
      // Tiếp tục vòng while với thẻ kế tiếp
      continue;
    }
  }
}

function detectHCaptchaInfo() {
  const iframe = document.querySelector(
    'iframe[data-sitekey], iframe[src*="hcaptcha.com"], iframe[title*="hCaptcha" i]',
  );
  if (!iframe)
    return { present: false, sitekey: "", pageurl: window.location.href };

  let sitekey = iframe.dataset?.sitekey || "";
  if (!sitekey) {
    try {
      const u = new URL(iframe.src, window.location.href);
      sitekey = u.searchParams.get("sitekey") || "";
    } catch (_) {}
  }
  return { present: true, sitekey, pageurl: window.location.href };
}

async function blockIfCaptchaPresent(actionName) {
  if (!isMainFrame) return false;
  const info = detectHCaptchaInfo();
  if (!info.present) return false;

  pendingCaptchaAction = actionName || null;
  console.log(
    `[captcha] detected sitekey=${info.sitekey || "(empty)"} pageurl=${info.pageurl}`,
  );
  toast("Phat hien hCaptcha. Giai tay xong bam Resume.", "#e67e22");
  return true;
}

// ============================================================
// OMO AUTO-WATCH: theo dõi iframe hcaptcha-inner hiển thị → giải
// ============================================================
(function startCaptchaAutoWatch() {
  return;
  if (!isMainFrame) return;

  // Tìm iframe captcha hình ảnh — có thể là hcaptcha-inner trực tiếp
  // HOẶC là iframe Stripe lớn chứa captcha bên trong
  function findCaptchaIframe() {
    // Ưu tiên: iframe hcaptcha-inner trực tiếp trên trang
    const direct = document.querySelector('iframe[src*="hcaptcha-inner"]');
    if (direct) {
      const r = direct.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) return direct;
    }
    // Fallback: iframe Stripe lớn (chứa captcha bên trong)
    // Nhận biết: src chứa stripe.com/v3/hcaptcha và kích thước > 300px
    for (const f of document.querySelectorAll("iframe")) {
      if (!f.src.includes("hcaptcha")) continue;
      const r = f.getBoundingClientRect();
      if (r.width > 200 && r.height > 200) return f;
    }
    return null;
  }

  const obs = new MutationObserver(() => {
    if (_omoSolving) return;
    const f = findCaptchaIframe();
    if (!f) {
      _omoSolveKey = "";
      return;
    }
    const r = f.getBoundingClientRect();
    const key =
      f.src.slice(0, 80) +
      "|" +
      Math.round(r.width) +
      "|" +
      Math.round(r.height);
    if (_omoSolveKey === key) return;
    _omoSolveKey = key;
    _omoSolving = true;
    console.log(
      "[OMO][AutoWatch] captcha visible, solving... iframe:",
      f.src.slice(0, 60),
    );
    (async () => {
      try {
        await sleep(1000);
        await omoSolveAndClick();
      } finally {
        _omoSolving = false;
      }
    })();
  });

  const start = () => {
    if (document.body)
      obs.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

// ── Tìm iframe captcha hình ảnh ─────────────────────────────
function findCaptchaIframe() {
  const direct = document.querySelector('iframe[src*="hcaptcha-inner"]');
  if (direct) {
    const r = direct.getBoundingClientRect();
    if (r.width > 100 && r.height > 100) return direct;
  }
  let best = null,
    maxArea = 0;
  for (const f of document.querySelectorAll("iframe")) {
    if (!f.src.includes("hcaptcha")) continue;
    const r = f.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > maxArea && r.width > 100 && r.height > 100) {
      maxArea = area;
      best = f;
    }
  }
  return best;
}

// ── Thu thập layout captcha từ main frame ────────────────────
function collectCaptchaLayout() {
  const iframe = findCaptchaIframe();
  if (!iframe) return null;

  // iframeRect = viewport coords (dung de crop screenshot)
  const r = iframe.getBoundingClientRect();
  const iframeRect = { x: r.left, y: r.top, width: r.width, height: r.height };
  const dpr = window.devicePixelRatio || 1;

  // iRect = absolute coords (dung de click)
  const iRect = {
    x: r.left + window.scrollX,
    y: r.top + window.scrollY,
    width: r.width,
    height: r.height,
  };

  // Grid 3x3 uoc tinh layout ben trong iframe
  const gridTop = iRect.y + iRect.height * 0.22;
  const gridLeft = iRect.x + iRect.width * 0.03;
  const cellW = (iRect.width * 0.94) / 3;
  const cellH = (iRect.height * 0.62) / 3;
  const gridRects = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      gridRects.push({
        x: gridLeft + col * cellW,
        y: gridTop + row * cellH,
        width: cellW,
        height: cellH,
        cx: gridLeft + col * cellW + cellW / 2,
        cy: gridTop + row * cellH + cellH / 2,
      });
    }
  }

  const verifyRect = {
    cx: iRect.x + iRect.width * 0.5,
    cy: iRect.y + iRect.height * 0.91,
  };

  return { iframeRect, iframeAbsRect: iRect, gridRects, verifyRect, dpr };
}

// UNUSED - kept for compat
function collectCaptchaLayout_OLD() {
  // Tìm iframe chứa captcha hình ảnh (hcaptcha-inner hoặc Stripe frame lớn)
  let iframe = document.querySelector('iframe[src*="hcaptcha-inner"]');
  if (!iframe) {
    // Tìm iframe hcaptcha lớn nhất
    let maxArea = 0;
    for (const f of document.querySelectorAll("iframe")) {
      if (!f.src.includes("hcaptcha")) continue;
      const r = f.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > maxArea && r.width > 100 && r.height > 100) {
        maxArea = area;
        iframe = f;
      }
    }
  }
  if (!iframe) return null;

  const iRect = absRect(iframe);
  const dpr = window.devicePixelRatio || 1;

  // Ước tính vị trí câu hỏi, anchor, grid bên trong iframe
  // (iframe cross-origin → không đọc DOM bên trong được)
  // Layout thực tế: câu hỏi ~20% đầu, ảnh anchor ~5% tiếp, grid ~65% giữa
  const questionRect = {
    x: iRect.x,
    y: iRect.y,
    width: iRect.width,
    height: iRect.height * 0.18,
  };

  // Anchor (ảnh mẫu ở top-right của iframe, nếu có)
  const anchorRect = {
    x: iRect.x + iRect.width * 0.6,
    y: iRect.y + iRect.height * 0.04,
    width: iRect.width * 0.36,
    height: iRect.height * 0.18,
  };

  // Grid 3x3 bắt đầu sau phần câu hỏi
  const gridTop = iRect.y + iRect.height * 0.22;
  const gridLeft = iRect.x + iRect.width * 0.04;
  const gridW = iRect.width * 0.92;
  const gridH = iRect.height * 0.62;
  const cellW = gridW / 3;
  const cellH = gridH / 3;

  const gridRects = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      gridRects.push({
        x: gridLeft + col * cellW,
        y: gridTop + row * cellH,
        width: cellW,
        height: cellH,
      });
    }
  }

  // Vị trí nút Verify (bottom center của iframe)
  const verifyRect = {
    x: iRect.x + iRect.width * 0.3,
    y: iRect.y + iRect.height * 0.87,
    width: iRect.width * 0.4,
    height: iRect.height * 0.1,
    cx: iRect.x + iRect.width * 0.5,
    cy: iRect.y + iRect.height * 0.9,
  };

  return null; // old function unused
}

// ── Gửi OMO, nhận kết quả, click ────────────────────────────
async function omoSolveAndClick() {
  const stored = await new Promise((res) =>
    chrome.storage.local.get(["omoApiKey"], res),
  );
  if (!(stored.omoApiKey || "").trim()) {
    toast("Chua co OMO API Key!", "#e67e22");
    return;
  }

  const layout = collectCaptchaLayout();
  if (!layout) {
    toast("Khong tim thay iframe captcha!", "#e67e22");
    return;
  }

  toast("Dang chup + gui OMO...", "#8e44ad");

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "OMO_SOLVE_IMAGE", ...layout },
      (res) => {
        if (chrome.runtime.lastError)
          return resolve({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
        resolve(res || { ok: false, error: "no response" });
      },
    );
  });

  if (!response.ok) {
    toast("OMO loi: " + response.error, "#e74c3c");
    return;
  }

  toast("Giai xong! Dang click...", "#27ae60");
  console.log("[OMO] solution:", JSON.stringify(response));
  await sleep(200);
  await applyOmoSolution(response, layout);
}

// ── Áp dụng kết quả lên grid ─────────────────────────────────
async function applyOmoSolution(sol, layout) {
  // gridRects.cx/cy đã là absolute coords → trừ scroll để ra viewport coords
  if (sol.solutionType === "grid" && sol.objects && sol.objects.length > 0) {
    // objects: [1,3,8] index 1-based theo docs OMO
    for (const idx of sol.objects) {
      const cell = layout.gridRects[idx - 1];
      if (!cell) {
        console.warn("[OMO] grid idx out of range:", idx);
        continue;
      }
      const cx = cell.cx - window.scrollX;
      const cy = cell.cy - window.scrollY;
      doClick(cx, cy);
      console.log(
        `[OMO] grid click cell ${idx} at (${Math.round(cx)},${Math.round(cy)})`,
      );
      await sleep(400);
    }
    await sleep(800);
    const vr = layout.verifyRect;
    doClick(vr.cx - window.scrollX, vr.cy - window.scrollY);
    console.log("[OMO] clicked Verify");
  } else if (sol.solutionType === "click" && sol.coords) {
    // coords là tọa độ pixel trong ảnh đã crop (= viewport coords của iframe)
    // iframeRect đã là viewport coords nên cộng trực tiếp
    const ir = layout.iframeAbsRect;
    for (const [x, y] of sol.coords) {
      // x,y là pixel trong ảnh crop → scale về viewport
      const cx = ir.x - window.scrollX + x;
      const cy = ir.y - window.scrollY + y;
      doClick(cx, cy);
      await sleep(350);
    }
    await sleep(700);
    const vr = layout.verifyRect;
    doClick(vr.cx - window.scrollX, vr.cy - window.scrollY);
  } else if (sol.solutionType === "drag" && sol.box) {
    const ir = layout.iframeRect;
    for (const seg of sol.box) {
      const sx = ir.x - window.scrollX + seg.start[0];
      const sy = ir.y - window.scrollY + seg.start[1];
      const ex = ir.x - window.scrollX + seg.end[0];
      const ey = ir.y - window.scrollY + seg.end[1];
      doDrag(sx, sy, ex, ey);
      await sleep(500);
    }
  } else {
    toast("Khong nhan duoc objects/coords tu OMO!", "#e67e22");
    console.warn("[OMO] unexpected solution:", JSON.stringify(sol));
  }
}

// ── Click helpers ─────────────────────────────────────────────
function doClick(x, y) {
  const el = document.elementFromPoint(x, y) || document.body;
  const o = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
  };
  if (typeof PointerEvent !== "undefined")
    el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new MouseEvent("mousedown", o));
  el.dispatchEvent(new MouseEvent("mouseup", o));
  el.dispatchEvent(new MouseEvent("click", o));
}

function doDrag(x1, y1, x2, y2) {
  const el = document.elementFromPoint(x1, y1) || document.body;
  const mk = (t, x, y) =>
    new MouseEvent(t, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
  el.dispatchEvent(mk("mousedown", x1, y1));
  for (let i = 1; i <= 6; i++) {
    el.dispatchEvent(
      mk("mousemove", x1 + ((x2 - x1) * i) / 6, y1 + ((y2 - y1) * i) / 6),
    );
  }
  el.dispatchEvent(mk("mouseup", x2, y2));
}

// ── Nút Sub: Fill → Subscribe → tick checkbox → giải captcha ─
async function handleSubClick() {
  if (autoSubmitState.running) {
    toast("QA Auto Submit dang chay. Bam Stop neu muon dung.", "#e67e22");
    return;
  }

  const submitOk = await runSubmitAttempt("manual");
  if (submitOk) return;

  const data = await storageLocalGet([
    "isAutoGenMode",
    "autoBIN",
    "autoBINList",
    "cards",
    "cardIndex",
    "addresses",
    "addressMode",
  ]);

  const autoBins = parseAutoBINList(data.autoBINList || data.autoBIN || "");
  const hasAutoCard = data.isAutoGenMode === true && autoBins.length > 0;
  const manualCard = pickNextCardForAutofill(data);
  const hasAnyCard = hasAutoCard || !!manualCard;

  if (hasAnyCard) return;

  // No card available: still fill address using the user's currently selected mode.
  const selectedAddressMode = normalizeAddressMode(data.addressMode);
  const addrData = resolveAddressForAutofill(data, selectedAddressMode);
  await storageLocalSet({
    fillTrigger: { cardData: null, addrData, ts: Date.now() },
    addrIndex: getAddressUsageValue(data.addresses, selectedAddressMode),
  });
  toast("Khong co the. Da tu dong fill dia chi.", "#2980b9");
}

function injectEmailQuickDock() {
  const uiRoot = document.documentElement || document.body;
  if (!uiRoot) return;
  if (document.getElementById("af-email-quick-dock")) return;

  const panel = document.createElement("div");
  panel.id = "af-email-quick-dock";
  panel.setAttribute("data-af-ui-root", "1");
  panel.setAttribute("data-dd-privacy", "hidden"); // Tàng hình DataDog
  const dockSectionTitleStyle =
    "font:700 8px/1 'Segoe UI',Arial,sans-serif;color:#7d89b8;letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px 1px";
  const dockSectionStyle =
    "padding:5px;border:1px solid rgba(101,118,171,.16);border-radius:10px;background:rgba(12,18,38,.72)";
  const dockGridStyle =
    "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px";
  const dockButtonBaseStyle =
    "all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;cursor:pointer;min-height:24px;padding:4px 7px;border-radius:8px;font:700 10px/1 'Segoe UI',Arial,sans-serif;color:#fff;text-align:center";
  const dockFullWidthButtonStyle = `${dockButtonBaseStyle};grid-column:1 / -1`;
  panel.style.cssText = `
    position: fixed;
    bottom: 78px;
    right: 20px;
    z-index: 2147483647;
    width: 252px;
    max-width: calc(100vw - 24px);
    background: rgba(9, 13, 28, 0.96);
    border: 1px solid rgba(143, 91, 255, 0.72);
    border-radius: 14px;
    padding: 7px;
    box-shadow: 0 12px 28px rgba(0,0,0,0.42);
    color: #e8ebf3;
    font-family: "Segoe UI", Arial, sans-serif;
    backdrop-filter: blur(14px);
  `;

  isolateFloatingUIEvents(panel);
  panel.innerHTML = `
    <div id="af-eq-drag-handle" style="display:flex;align-items:center;height:8px;margin:0 0 6px 2px;user-select:none;cursor:move">
      <span style="display:inline-flex;gap:3px">
        <span style="width:4px;height:4px;border-radius:999px;background:#5f6b8a"></span>
        <span style="width:4px;height:4px;border-radius:999px;background:#5f6b8a"></span>
        <span style="width:4px;height:4px;border-radius:999px;background:#5f6b8a"></span>
      </span>
    </div>
    <div id="af-eq-active-email" style="margin:0 0 4px 0;padding:3px 6px;border-radius:8px;background:#10223c;color:#9ec9ff;font:600 9px/1.2 monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">TempMail: (none)</div>
    <div id="af-eq-active-hotmail" style="margin:0 0 5px 0;padding:3px 6px;border-radius:8px;background:#14241b;color:#9ae6b4;font:600 9px/1.2 monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Hotmail: (none)</div>
    <div style="display:grid;grid-template-columns:1fr 54px;gap:4px;margin:0 0 5px 0">
      <select id="af-eq-worker-select" style="box-sizing:border-box;width:100%;height:26px;border-radius:8px;border:1px solid rgba(148,163,184,.22);background:#0f1f38;color:#dbeafe;font:700 10px 'Segoe UI',Arial,sans-serif;padding:0 6px;outline:none">
        <option value="">Worker...</option>
      </select>
      <input id="af-eq-worker-code" maxlength="6" inputmode="numeric" placeholder="Code" style="display:none;box-sizing:border-box;width:100%;height:26px;border-radius:8px;border:1px solid rgba(250,204,21,.35);background:#241a0a;color:#fde68a;font:700 10px monospace;padding:0 6px;outline:none" />
    </div>
    <div id="af-eq-worker-lock" style="display:none;margin:0 0 5px 0;padding:5px 7px;border-radius:9px;border:1px solid rgba(250,204,21,.25);background:rgba(120,83,14,.18);color:#fde68a;font:700 9px/1.35 'Segoe UI',Arial,sans-serif">Chon nguoi lam de mo khoa toolbar.</div>
    <textarea id="af-eq-input" rows="1" style="width:100%;box-sizing:border-box;background:#10284a;border:1px solid rgba(59,130,246,.28);border-radius:9px;color:#f8fbff;font:11px monospace;padding:7px;resize:none;outline:none;height:34px;min-height:34px;line-height:1.2" placeholder="Paste tk|mk|2fa..."></textarea>
    <div style="display:grid;gap:5px;margin-top:5px">
      <div style="${dockSectionStyle}">
        <div style="${dockSectionTitleStyle}">Credential</div>
        <div style="${dockGridStyle}">
          <button id="af-eq-copy-full" style="${dockButtonBaseStyle};background:#0f9f8c">Copy Full</button>
          <button id="af-eq-copy-pass" style="${dockButtonBaseStyle};background:#22a95f">Copy Pass</button>
          <button id="af-eq-gen-2fa" style="${dockButtonBaseStyle};background:#dc3f52">2FA</button>
          <button id="af-eq-rand-pass" style="${dockButtonBaseStyle};background:#ea9a19">Random</button>
          <button id="af-eq-push-chatgpt" style="${dockFullWidthButtonStyle};background:#2f6df6">Push</button>
        </div>
      </div>
      <div style="${dockSectionStyle}">
        <div style="${dockSectionTitleStyle}">Hotmail</div>
        <div style="${dockGridStyle}">
          <button id="af-eq-hotmail-new" style="${dockButtonBaseStyle};background:#7c3aed">HM New</button>
          <button id="af-eq-hotmail-use" style="${dockButtonBaseStyle};background:#0f766e">HM Use</button>
          <button id="af-eq-hotmail-code" style="${dockFullWidthButtonStyle};background:#f97316">HM Code</button>
        </div>
      </div>
      <button id="af-eq-test-toggle" style="${dockFullWidthButtonStyle};min-height:20px;padding:3px 7px;background:#1f2a44;color:#b9c4df;border:1px solid rgba(148,163,184,.18)">Test</button>
      <div id="af-eq-test-tools-panel" style="display:none;gap:5px">
        <div style="${dockSectionStyle}">
          <div style="${dockSectionTitleStyle}">TempMail</div>
          <div style="${dockGridStyle}">
            <button id="af-eq-tempmail" style="${dockButtonBaseStyle};background:#0ea5e9">TM Use</button>
            <button id="af-eq-tempmail-new" style="${dockButtonBaseStyle};background:#8b5cf6">TM New</button>
            <button id="af-eq-get-code" style="${dockFullWidthButtonStyle};background:#f59e0b">TM Code</button>
          </div>
        </div>
        <div style="${dockSectionStyle}">
          <div style="${dockSectionTitleStyle}">Tools</div>
          <div style="${dockGridStyle}">
            <button id="af-eq-switch-mode" style="${dockButtonBaseStyle};background:#0f766e">Switch</button>
            <button id="af-eq-clear" style="${dockButtonBaseStyle};background:#23314c;color:#cbd5e1">Clear</button>
          </div>
        </div>
      </div>
    </div>
  `;


  uiRoot.appendChild(panel);
  makeFloatingMovable(panel, {
    handleSelector: "#af-eq-drag-handle",
    noDragSelector: "textarea, button, input, select",
    storageKey: "af_email_quick_dock_pos_v1",
  });

  const inputEl = document.getElementById("af-eq-input");
  const activeEmailEl = document.getElementById("af-eq-active-email");
  const activeHotmailEl = document.getElementById("af-eq-active-hotmail");
  const testToggleBtn = document.getElementById("af-eq-test-toggle");
  const testToolsPanel = document.getElementById("af-eq-test-tools-panel");
  const workerSelectEl = document.getElementById("af-eq-worker-select");
  const workerCodeEl = document.getElementById("af-eq-worker-code");
  const workerLockEl = document.getElementById("af-eq-worker-lock");
  let lastFormatted = "";
  let lastAutoCopied = "";
  let autoCopyTimer = null;
  let lastParsedCredentials = [];
  let hotmailUsedEmails = new Set();
  let extensionWorkerOptions = [];
  let pendingWorkerChangeId = "";
  let isQuickDockWorkerLocked = true;

  if (testToggleBtn && testToolsPanel) {
    let isTestToolsOpen = false;
    const renderTestToolsState = () => {
      testToolsPanel.style.display = isTestToolsOpen ? "grid" : "none";
      testToggleBtn.textContent = isTestToolsOpen ? "Hide test" : "Test";
      testToggleBtn.title = isTestToolsOpen
        ? "Hide TempMail and Tools"
        : "Show TempMail and Tools";
    };
    testToggleBtn.addEventListener("click", () => {
      isTestToolsOpen = !isTestToolsOpen;
      renderTestToolsState();
    });
    renderTestToolsState();
  }

  const workerLockedActionIds = [
    "af-eq-input",
    "af-eq-copy-full",
    "af-eq-copy-pass",
    "af-eq-gen-2fa",
    "af-eq-rand-pass",
    "af-eq-push-chatgpt",
    "af-eq-hotmail-new",
    "af-eq-hotmail-use",
    "af-eq-hotmail-code",
    "af-eq-test-toggle",
    "af-eq-tempmail",
    "af-eq-tempmail-new",
    "af-eq-get-code",
    "af-eq-switch-mode",
    "af-eq-clear",
  ];

  const renderWorkerLockState = async () => {
    const storedWorker = await getStoredExtensionWorker();
    const storedStillActive =
      storedWorker?.id &&
      extensionWorkerOptions.some((worker) => worker?.id === storedWorker.id);
    isQuickDockWorkerLocked = !storedStillActive;
    workerLockedActionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = isQuickDockWorkerLocked;
      el.style.opacity = isQuickDockWorkerLocked ? "0.42" : "1";
      el.style.cursor = isQuickDockWorkerLocked
        ? "not-allowed"
        : id === "af-eq-input"
          ? "text"
          : "pointer";
    });
    if (inputEl) {
      inputEl.placeholder = isQuickDockWorkerLocked
        ? "Chon worker truoc..."
        : "Paste tk|mk|2fa...";
    }
    if (workerLockEl) {
      workerLockEl.style.display = isQuickDockWorkerLocked ? "block" : "none";
      workerLockEl.textContent = extensionWorkerOptions.length
        ? "Chon nguoi lam de mo khoa toolbar."
        : "Khong tai duoc worker. Kiem tra Push token/API.";
    }
  };

  const renderExtensionWorkerSelect = async () => {
    if (!workerSelectEl) return;
    const storedWorker = await getStoredExtensionWorker();
    const storedStillActive =
      storedWorker &&
      extensionWorkerOptions.some((worker) => worker?.id === storedWorker.id);
    if (storedWorker?.id && !storedStillActive) {
      await setStoredExtensionWorker(null);
    }
    workerSelectEl.innerHTML = "";
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "Worker...";
    placeholderOpt.disabled = true;
    workerSelectEl.appendChild(placeholderOpt);
    extensionWorkerOptions.forEach((worker) => {
      const opt = document.createElement("option");
      opt.value = String(worker?.id || "");
      opt.textContent = String(worker?.name || worker?.id || "Worker");
      workerSelectEl.appendChild(opt);
    });
    workerSelectEl.value = storedStillActive ? storedWorker.id : "";
    workerSelectEl.title = storedStillActive
      ? `Nguoi lam: ${storedWorker.name || storedWorker.id}`
      : "Chon nguoi lam truoc khi Push";
    await renderWorkerLockState();
  };

  const hideExtensionWorkerCode = () => {
    pendingWorkerChangeId = "";
    if (!workerCodeEl) return;
    workerCodeEl.value = "";
    workerCodeEl.style.display = "none";
  };

  const loadExtensionWorkerSelector = async () => {
    if (!workerSelectEl) return;
    try {
      extensionWorkerOptions = await fetchExtensionWorkersForPush();
      await renderExtensionWorkerSelect();
    } catch (err) {
      workerSelectEl.innerHTML = '<option value="">Worker loi</option>';
      workerSelectEl.title = err?.message || "Khong tai duoc worker";
      extensionWorkerOptions = [];
      await renderWorkerLockState();
    }
  };

  workerSelectEl?.addEventListener("change", async () => {
    const nextId = String(workerSelectEl.value || "").trim();
    const nextWorker = extensionWorkerOptions.find(
      (worker) => String(worker?.id || "") === nextId,
    );
    if (!nextId || !nextWorker) {
      hideExtensionWorkerCode();
      await renderExtensionWorkerSelect();
      return;
    }
    const currentWorker = await getStoredExtensionWorker();
    if (!currentWorker?.id) {
      await setStoredExtensionWorker(nextWorker);
      hideExtensionWorkerCode();
      await renderExtensionWorkerSelect();
      toast(`Da chon nguoi lam: ${nextWorker.name || nextWorker.id}`, "#27ae60");
      return;
    }
    if (currentWorker.id === nextId) {
      hideExtensionWorkerCode();
      return;
    }
    pendingWorkerChangeId = nextId;
    if (workerCodeEl) {
      workerCodeEl.value = "";
      workerCodeEl.style.display = "block";
      workerCodeEl.focus();
    }
    toast("Nhap ma 6 so admin tao de doi nguoi lam", "#e67e22");
  });

  workerCodeEl?.addEventListener("input", async () => {
    const code = String(workerCodeEl.value || "").replace(/\D/g, "").slice(0, 6);
    workerCodeEl.value = code;
    if (code.length !== 6 || !pendingWorkerChangeId) return;
    const currentWorker = await getStoredExtensionWorker();
    try {
      const worker = await verifyExtensionWorkerChangeCode(
        pendingWorkerChangeId,
        code,
      );
      await setStoredExtensionWorker(worker);
      hideExtensionWorkerCode();
      await renderExtensionWorkerSelect();
      toast(`Da doi nguoi lam: ${worker?.name || worker?.id}`, "#27ae60");
    } catch (err) {
      hideExtensionWorkerCode();
      if (workerSelectEl) workerSelectEl.value = currentWorker?.id || "";
      toast(err?.message || "Ma doi nguoi lam khong hop le", "#e74c3c");
    }
  });

  loadExtensionWorkerSelector().catch(() => {});

  const sanitizeHotmailQueueLines = (value = "") =>
    String(value || "")
      .split(/\r?\n/)
      .map((line) => normalizeHotmailLine(line))
      .filter(Boolean);

  const collectHotmailQueueEmails = (lines = []) =>
    Array.from(
      new Set(
        lines
          .map((line) => extractHotmailEmailFromLine(line))
          .filter(Boolean)
          .map((email) => String(email).trim().toLowerCase()),
      ),
    );

  const pruneHotmailUsedEmails = (lines = sanitizeHotmailQueueLines(inputEl.value || "")) => {
    const validEmails = new Set(collectHotmailQueueEmails(lines));
    hotmailUsedEmails = new Set(
      Array.from(hotmailUsedEmails).filter((email) => validEmails.has(email)),
    );
    return lines;
  };

  const updateActiveEmailLabel = async () => {
    if (!activeEmailEl) return;
    const last = await getLastTempMailAddress();
    if (last?.email) {
      activeEmailEl.textContent = `TempMail: ${last.email}`;
      activeEmailEl.title = last.email;
      activeEmailEl.style.color = "#9fe6b8";
      return;
    }
    activeEmailEl.textContent = "TempMail: (none)";
    activeEmailEl.title = "";
    activeEmailEl.style.color = "#9ec9ff";
  };

  const updateActiveHotmailLabel = async () => {
    if (!activeHotmailEl) return;
    const data = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
    const email = String(data[HOTMAIL_ACTIVE_EMAIL_KEY] || "").trim().toLowerCase();
    if (email && isMicrosoftMailboxEmail(email)) {
      activeHotmailEl.textContent = `Hotmail: ${email}`;
      activeHotmailEl.title = email;
      activeHotmailEl.style.color = "#98f5bf";
      return;
    }
    activeHotmailEl.textContent = "Hotmail: (none)";
    activeHotmailEl.title = "";
    activeHotmailEl.style.color = "#89d7ab";
  };

  const getPrimaryDockLine = () => {
    const lines = String(inputEl.value || "")
      .split(/\r?\n/)
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    return lines[0] || "";
  };

  const persistHotmailQueueInput = async () => {
    const lines = pruneHotmailUsedEmails();
    await storageLocalSet({
      [HOTMAIL_QUEUE_STORE_KEY]: lines.join("\n"),
      [HOTMAIL_QUEUE_USED_STORE_KEY]: Array.from(hotmailUsedEmails),
    });
  };

  const restoreHotmailQueueInput = async () => {
    const data = await storageLocalGet([
      HOTMAIL_QUEUE_STORE_KEY,
      HOTMAIL_QUEUE_USED_STORE_KEY,
    ]);
    const lines = sanitizeHotmailQueueLines(data[HOTMAIL_QUEUE_STORE_KEY] || "");
    inputEl.value = lines.join("\n");
    const validEmails = new Set(collectHotmailQueueEmails(lines));
    hotmailUsedEmails = new Set(
      (Array.isArray(data[HOTMAIL_QUEUE_USED_STORE_KEY])
        ? data[HOTMAIL_QUEUE_USED_STORE_KEY]
        : []
      )
        .map((email) => String(email || "").trim().toLowerCase())
        .filter((email) => validEmails.has(email)),
    );
  };

  const getNextUntickedHotmailFromInput = () => {
    const lines = sanitizeHotmailQueueLines(inputEl.value || "");
    pruneHotmailUsedEmails(lines);

    for (const line of lines) {
      const email = extractHotmailEmailFromLine(line);
      if (!email) continue;
      if (!hotmailUsedEmails.has(String(email).trim().toLowerCase())) {
        return { line, email };
      }
    }
    return null;
  };

  const markHotmailUsedInInput = (targetEmail) => {
    const emailNorm = String(targetEmail || "").trim().toLowerCase();
    if (!emailNorm) return;

    const lines = sanitizeHotmailQueueLines(inputEl.value || "");
    let touched = false;
    const cleaned = lines.map((line) => {
      const normalizedLine = normalizeHotmailLine(line);
      if (normalizedLine !== line) touched = true;
      return normalizedLine;
    });
    if (cleaned.some((line) => extractHotmailEmailFromLine(line).toLowerCase() === emailNorm)) {
      hotmailUsedEmails.add(emailNorm);
    }
    pruneHotmailUsedEmails(cleaned);
    const nextValue = cleaned.join("\n");
    if (touched || String(inputEl.value || "") !== nextValue) {
      inputEl.value = nextValue;
    }
    build();
    updateSwitchModeButton().catch(() => {});
  };


  const resolveHotmailUseTarget = async () => {
    const nextFromQueue = getNextUntickedHotmailFromInput();
    if (nextFromQueue) {
      return {
        email: nextFromQueue.email,
        password: AUTO_PASSWORD_VALUE || "",
        parsedLine: parseHotmailCredentialLine(nextFromQueue.line),
        sourceLine: nextFromQueue.line,
      };
    }
    const fallback = await resolveHotmailTargetFromDock();
    return {
      ...fallback,
      sourceLine: "",
    };
  };

  const resolveHotmailTargetFromDock = async () => {
    const stored = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
    const activeEmail = String(stored[HOTMAIL_ACTIVE_EMAIL_KEY] || "").trim().toLowerCase();
    if (activeEmail && isMicrosoftMailboxEmail(activeEmail)) {
      return {
        email: activeEmail,
        password: AUTO_PASSWORD_VALUE || "",
        parsedLine: null,
      };
    }

    const firstLine = getPrimaryDockLine();
    const parsed = parseHotmailCredentialLine(firstLine);
    if (parsed?.email) {
      return {
        email: parsed.email,
        password: parsed.password || AUTO_PASSWORD_VALUE || "",
        parsedLine: parsed,
      };
    }

    if (isMicrosoftMailboxEmail(firstLine)) {
      return {
        email: String(firstLine).trim().toLowerCase(),
        password: AUTO_PASSWORD_VALUE || "",
        parsedLine: null,
      };
    }

    const data = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
    const fromStore = String(data[HOTMAIL_ACTIVE_EMAIL_KEY] || "").trim().toLowerCase();
    return {
      email: isMicrosoftMailboxEmail(fromStore) ? fromStore : "",
      password: AUTO_PASSWORD_VALUE || "",
      parsedLine: null,
    };
  };

  const getDockCaretLine = () => {
    const full = String(inputEl.value || "");
    const pos = Number(inputEl.selectionStart || 0);
    const lines = full.split(/\r?\n/);
    let consumed = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const next = consumed + line.length + 1;
      if (pos <= next) return String(line || "").trim();
      consumed = next;
    }
    return String(lines[0] || "").trim();
  };

  const updateSwitchModeButton = async () => {
    const btn = document.getElementById("af-eq-switch-mode");
    if (!btn) return;

    const line = getDockCaretLine();
    const parsed = line ? parseCredentialLine(line) : null;
    const currentEmail = String(parsed?.account || line || "")
      .trim()
      .toLowerCase();
    const hotmailData = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
    const activeHM = String(hotmailData[HOTMAIL_ACTIVE_EMAIL_KEY] || "")
      .trim()
      .toLowerCase();
    const lastTemp = await getLastTempMailAddress();
    const activeTM = String(lastTemp?.email || "")
      .trim()
      .toLowerCase();

    let label = "Switch";
    if (currentEmail && activeHM && currentEmail === activeHM) {
      label = activeTM ? "Switch to Tiny" : "Switch";
    } else if (activeHM) {
      label = "Switch to HM";
    }

    btn.textContent = label;
    btn.title = label;
  };


  const fillHotmailNow = async (target, options = {}) => {
    const normalizedEmail = String(target?.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("Chua co email Hotmail. Hay paste email hoac line day du");
    }
    if (!isMicrosoftMailboxEmail(normalizedEmail)) {
      throw new Error("Email nay khong phai Hotmail / Outlook / Live / MSN");
    }


    const inbox = await readHotmailInboxViaProxy({ email: normalizedEmail, top: 1 });
    await storageLocalSet({ [HOTMAIL_ACTIVE_EMAIL_KEY]: normalizedEmail });
    await updateActiveHotmailLabel();

    const emailEl = findVisibleEmailField();
    const passEl = findVisiblePasswordField();
    let filled = false;
    let emailFilled = false;
    let passwordFilled = false;
    if (emailEl) {
      typeInto(emailEl, normalizedEmail);
      filled = true;
      emailFilled = true;
    }
    if (passEl && target.password) {
      typeInto(passEl, target.password);
      filled = true;
      passwordFilled = true;
    }

    const result = {
      email: normalizedEmail,
      filled,
      emailFilled,
      passwordFilled,
      emailEl,
      passEl,
      hasPasswordField: !!passEl,
      passwordValue: String(passEl?.value || ""),
      messageCount: Number(inbox.count || 0),
    };

    if (!filled) {
      await navigator.clipboard.writeText(normalizedEmail);
      if (!options.silent) toast(`Hotmail copied: ${normalizedEmail}`, "#27ae60");
      return { ...result, copied: true };
    }
    if (!options.silent) {
      toast(`Da dien Hotmail: ${normalizedEmail} (${result.messageCount} mail)`, "#27ae60");
    }
    return result;
  };

  const getFormScopeForField = (field) => {
    if (!field || typeof field.closest !== "function") return null;
    return field.closest("form");
  };

  const autoContinueAfterHotmailUse = async (fillResult) => {
    if (!isMainFrame || !fillResult?.filled) return false;

    const emailEl = fillResult.emailEl && document.contains(fillResult.emailEl)
      ? fillResult.emailEl
      : findVisibleEmailField();
    const passEl = fillResult.passEl && document.contains(fillResult.passEl)
      ? fillResult.passEl
      : findVisiblePasswordField();

    if (!emailEl && !passEl) return false;
    if (passEl && !String(passEl.value || "").trim()) return false;

    const scopes = [
      getFormScopeForField(passEl),
      getFormScopeForField(emailEl),
      document,
    ].filter(Boolean);

    await sleep(120);
    return clickContinueWithRetry(12, 160, { scopes });
  };

  const fetchLatestHotmailCode = async () => {
    const target = await resolveHotmailTargetFromDock();
    if (!target.email) {
      throw new Error("Chua co Hotmail active");
    }
    const inbox = await readHotmailInboxViaProxy({ email: target.email, top: 5 });
    const msgs = Array.isArray(inbox.messages) ? inbox.messages : [];
    for (const m of msgs) {
      const code = extractOtpCodeFromText(`${m?.subject || ""}\n${m?.bodyPreview || ""}`);
      if (code) {
        await storageLocalSet({ [HOTMAIL_ACTIVE_EMAIL_KEY]: target.email });
        await updateActiveHotmailLabel();
        return code;
      }
    }
    throw new Error("Khong tim thay OTP trong inbox Hotmail");
  };

  const ensureTempMailAddress = async (forceNew = false) => {
    let tempMailData = forceNew ? null : await getLastTempMailAddress();
    if (!tempMailData) {
      tempMailData = await generateRandomTempMailAddress();
    }
    if (!tempMailData?.email) {
      throw new Error("Khong tao duoc TempMail");
    }
    await storageLocalSet({ useTempMail: true });
    await updateActiveEmailLabel();
    return tempMailData;
  };

  const fillTempMailNow = async (forceNew = false) => {
    const tempMailData = await ensureTempMailAddress(forceNew);
    const email = String(tempMailData.email || "").trim();
    const emailEl = findVisibleEmailField();
    const passEl = findVisiblePasswordField();
    const pass = AUTO_PASSWORD_VALUE || generateRandomPassword();

    let filled = false;
    if (emailEl) {
      typeInto(emailEl, email);
      filled = true;
    }
    if (passEl) {
      typeInto(passEl, pass);
      filled = true;
    }

    if (!filled) {
      await navigator.clipboard.writeText(email);
      toast(`Copied email: ${email}`, "#27ae60");
      return;
    }
    toast(`Da dien TempMail: ${email}`, "#27ae60");
  };

  const fetchLatestTempMailCode = async () => {
    const last = await getLastTempMailAddress();
    if (!last?.email) {
      throw new Error("Chua co TempMail active");
    }
    const [username, domain] = String(last.email).split("@");
    if (!username || !domain) {
      throw new Error("TempMail khong hop le");
    }

    const attempts = 6;
    const waitMs = 1800;
    for (let i = 0; i < attempts; i++) {
      const inbox = await getTempMailInbox(domain, username, 1, 20);
      const emails = Array.isArray(inbox?.emails) ? inbox.emails : [];

      if (emails.length) {
        const sorted = [...emails].sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );

        // PRIORITY: Fetch & scan the latest email's full detail first
        const latestMsg = sorted[0];
        if (latestMsg) {
          // Try inline content first
          const codeInline = extractOtpCodeFromText(
            `${latestMsg.subject || ""}\n${latestMsg.body || ""}\n${latestMsg.html_body || ""}`,
          );
          if (codeInline) return codeInline;

          // Then fetch full detail for latest email (highest priority)
          const detail = await getTempMailEmailDetail(domain, username, latestMsg.id);
          if (detail) {
            const codeDetail = extractOtpCodeFromText(
              `${detail.subject || ""}\n${detail.body || ""}\n${detail.html_body || ""}`,
            );
            if (codeDetail) return codeDetail;
          }
        }

        // Fallback: scan other recent emails
        for (const msg of sorted.slice(1, 6)) {
          const codeInline = extractOtpCodeFromText(
            `${msg.subject || ""}\n${msg.body || ""}\n${msg.html_body || ""}`,
          );
          if (codeInline) return codeInline;

          const detail = await getTempMailEmailDetail(domain, username, msg.id);
          const codeDetail = extractOtpCodeFromText(
            `${detail?.subject || ""}\n${detail?.body || ""}\n${detail?.html_body || ""}`,
          );
          if (codeDetail) return codeDetail;
        }
      }

      if (i < attempts - 1) {
        await sleep(waitMs);
      }
    }

    throw new Error("Khong tim thay OTP (thu lai sau 5-10 giay)");
  };

  const autoCopy = () => {
    const val = String(lastFormatted || "").trim();
    if (!val || val === lastAutoCopied) return;
    navigator.clipboard
      .writeText(val)
      .then(() => {
        lastAutoCopied = val;
      })
      .catch(() => {});
  };

  const scheduleAutoCopy = () => {
    clearTimeout(autoCopyTimer);
    autoCopyTimer = setTimeout(autoCopy, 120);
  };

  const build = () => {
    const lines = pruneHotmailUsedEmails(sanitizeHotmailQueueLines(inputEl.value || ""));
    const sanitizedValue = lines.join("\n");
    if (String(inputEl.value || "") !== sanitizedValue) {
      inputEl.value = sanitizedValue;
    }
    lastParsedCredentials = lines.map(parseCredentialLine);
    const results = lastParsedCredentials.map(formatCredentialLine).filter(Boolean);
    lastFormatted = results.join("\n");
    persistHotmailQueueInput().catch(() => {});
  };

  const resolvePrimaryAccountForDock = async () => {
    const fromInput = String(lastParsedCredentials?.[0]?.account || "").trim();
    if (fromInput) return fromInput;

    const emailField = findVisibleEmailField();
    const fromField = String(emailField?.value || "").trim();
    if (fromField) return fromField;

    // PRIORITY: Check Hotmail first, then TempMail
    const hmData = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
    const fromHM = String(hmData[HOTMAIL_ACTIVE_EMAIL_KEY] || "").trim();
    if (fromHM) return fromHM;

    const lastTemp = await getLastTempMailAddress();
    const fromTemp = String(lastTemp?.email || "").trim();
    if (fromTemp) return fromTemp;

    return "account";
  };

  const savePrimaryCredentialToDock = async (twofaSecret) => {
    const normalizedSecret = normalizeOtpSecret(twofaSecret);
    if (!normalizedSecret) return;

    const account = await resolvePrimaryAccountForDock();
    const password =
      String(lastParsedCredentials?.[0]?.password || "").trim() ||
      String(AUTO_PASSWORD_VALUE || "").trim() ||
      generateRandomPassword();

    const primaryLine = formatCredentialLine({
      account,
      password,
      twofaSecret: normalizedSecret,
    });

    const lines = String(inputEl.value || "")
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);

    if (lines.length) {
      lines[0] = primaryLine;
    } else {
      lines.push(primaryLine);
    }

    inputEl.value = lines.join("\n");
    build();
    updateSwitchModeButton().catch(() => {});
  };

  const getPrimaryCredentialForPush = () => {
    const rawLine = String(getPrimaryDockLine() || "").trim();
    const parsed = rawLine ? parseCredentialLine(rawLine) : lastParsedCredentials?.[0] || null;
    const hasCredentialShape =
      rawLine.includes("|") || rawLine.includes("----");
    const username = String(parsed?.account || "").trim();
    const password = String(parsed?.password || "").trim();
    const otpSecret = normalizeOtpSecret(parsed?.twofaSecret || "");

    if (!rawLine || !hasCredentialShape || !username || !password || !otpSecret) {
      return {
        ok: false,
        error: "Chua co tk|mk|2fa de day",
      };
    }

    return {
      ok: true,
      username,
      password,
      otpSecret,
      rawLine,
    };
  };

  const getHotmailLinkStatusText = (hotmailLink = null) => {
    const status = String(hotmailLink?.status || "").trim();
    if (status === "linked") {
      return hotmailLink?.lockApplied ? " | Hotmail da khoa kho" : " | Hotmail da noi";
    }
    if (status === "missing") return " | Chua co acc trong Hotmail";
    if (status === "error") return ` | ${hotmailLink?.message || "Loi noi Hotmail"}`;
    return "";
  };

  window.tryRebuildEmailQuickDock = () => {
    build();
    updateSwitchModeButton().catch(() => {});
  };

  inputEl.addEventListener("input", () => {
    build();
    updateSwitchModeButton().catch(() => {});
  });
  inputEl.addEventListener("click", () => {
    updateSwitchModeButton().catch(() => {});
  });
  inputEl.addEventListener("keyup", () => {
    updateSwitchModeButton().catch(() => {});
  });
  inputEl.addEventListener("focus", () => {
    updateSwitchModeButton().catch(() => {});
  });
  restoreHotmailQueueInput()
    .catch(() => {})
    .finally(() => {
      build();
      updateSwitchModeButton().catch(() => {});
    });
  updateActiveEmailLabel();
  updateActiveHotmailLabel();

  const clearQuickDockInput = (options = {}) => {
    inputEl.value = "";
    lastFormatted = "";
    lastAutoCopied = "";
    lastParsedCredentials = [];
    hotmailUsedEmails = new Set();
    build();
    updateSwitchModeButton().catch(() => {});
    if (options.focus) inputEl.focus();
  };

  document.getElementById("af-eq-clear").addEventListener("click", () => {
    clearQuickDockInput({ focus: true });
  });

  document.getElementById("af-eq-copy-full").addEventListener("click", async () => {
    const val = String(lastFormatted || "").trim();
    if (!val) {
      toast("Khong co du lieu tk|mk|2fa de copy", "#e67e22");
      return;
    }
    await navigator.clipboard.writeText(val);
    const btn = document.getElementById("af-eq-copy-full");
    if (btn) {
      const oldText = btn.textContent;
      btn.textContent = "✅ Copied";
      setTimeout(() => {
        if (btn) btn.textContent = oldText;
      }, 1200);
    }
    toast("Da copy tk|mk|2fa", "#16a085");
  });

  // Nút Copy Pass: copy pass hiện tại vào clipboard
  document
    .getElementById("af-eq-copy-pass")
    .addEventListener("click", async () => {
      const cur =
        String(lastParsedCredentials?.[0]?.password || "").trim() || AUTO_PASSWORD_VALUE;
      if (!cur) {
        toast("Chưa có pass! Bấm Random trước.", "#e74c3c");
        return;
      }
      try {
        await navigator.clipboard.writeText(cur);
        const btn = document.getElementById("af-eq-copy-pass");
        if (btn) {
          const oldText = btn.textContent;
          btn.textContent = "✅ Copied!";
          setTimeout(() => {
            if (btn) btn.textContent = oldText;
          }, 1800);
        }
        toast(`📋 Pass: ${cur}`, "#27ae60");
      } catch (_) {
        try {
          const ta = document.createElement("textarea");
          ta.value = cur;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          toast(`📋 Pass: ${cur}`, "#27ae60");
        } catch (__) {}
      }
    });

  // Nút Random: generate pass mới → lưu storage → rebuild form
  document
    .getElementById("af-eq-rand-pass")
    .addEventListener("click", async () => {
      const ok = await showAfConfirmDialog({
        title: "Tao pass moi",
        message: "Pass hien tai se bi thay the. Ban co chac chan muon tiep tuc?",
        confirmText: "Tao moi",
      });
      if (!ok) return;

      const newPass = generateRandomPassword();
      chrome.storage.local.set({ randomPassword: newPass });
      AUTO_PASSWORD_VALUE = newPass;
      build(); // rebuild form ngay
      updateSwitchModeButton().catch(() => {});
      const btn = document.getElementById("af-eq-rand-pass");
      if (btn) {
        const oldText = btn.textContent;
        const oldBg = btn.style.background;
        btn.textContent = "✅ Done!";
        btn.style.background = "#27ae60";
        setTimeout(() => {
          if (btn) {
            btn.textContent = oldText;
            btn.style.background = oldBg;
          }
        }, 1500);
      }
      toast(`🔑 Pass mới: ${newPass}  (bấm Copy Pass để copy)`, "#8e44ad");
    });

  document
    .getElementById("af-eq-hotmail-refresh")
    ?.addEventListener("click", async () => {
      const btn = document.getElementById("af-eq-hotmail-refresh");
      if (!btn) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";
        btn.textContent = "List...";
      try {
        const accounts = await getHotmailAccountsViaProxy();
        // Chi lay nhung acc chua dung (available)
        const availableAccs = accounts.filter(a => a.state === "available");
        const emails = availableAccs.map((a) => String(a?.email || "").trim()).filter(Boolean);

        if (!emails.length) {
          toast("Khong co Hotmail 'available' nao tren server", "#e67e22");
        } else {
          inputEl.value = emails.join("\n");
          build();
          updateSwitchModeButton().catch(() => {});
          toast(`Da tai ${emails.length} Hotmail chua dung vao input`, "#27ae60");
        }
      } catch (err) {
        toast(`❌ ${err.message || err}`, "#e74c3c");
      } finally {
        btn.textContent = "HM List";
        btn.style.opacity = "1";
        btn.disabled = false;
      }
    });

  document.getElementById("af-eq-hotmail-new")?.addEventListener("click", async () => {
    const ok = await showAfConfirmDialog({
      title: "Lấy Hotmail Mới?",
      message: "Bạn có chắc muốn lấy 1 tài khoản Hotmail mới tinh (chưa dùng) từ server không?",
      confirmText: "Lấy mới",
      cancelText: "Hủy"
    });
    if (!ok) return;

    try {
      const data = await fetchNewHotmailViaProxy();
      toast("🚀 Đã nạp Hotmail mới sẵn sàng!", "#8e44ad");
      
      const email = data.account.email;
      await storageLocalSet({ [HOTMAIL_ACTIVE_EMAIL_KEY]: email });
      await updateActiveHotmailLabel();
      await updateSwitchModeButton();
    } catch (err) {
      toast(`❌ ${err.message}`, "#e74c3c");
    }
  });

  // Nut Pick: Lay dung dong dang tro chuot de Use + Mark Used
  document.getElementById("af-eq-hotmail-pick")?.addEventListener("click", async () => {
    const btn = document.getElementById("af-eq-hotmail-pick");
    if (!btn) return;

    const line = getDockCaretLine();
    if (!line) {
      toast("Dat con tro vao dong email muon su dung", "#e67e22");
      return;
    }

    const email = extractHotmailEmailFromLine(line);
    if (!email) {
      toast("Dong nay khong chua email hop le", "#e67e22");
      return;
    }

    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.textContent = "Picking...";

    try {
      const parsed = parseHotmailCredentialLine(line);
      const target = {
        email,
        password: parsed?.password || AUTO_PASSWORD_VALUE || "",
        parsedLine: parsed
      };

      await fillHotmailNow(target);
      await updateSwitchModeButton();
      markHotmailUsedViaProxy(email); // Danh dau tren server
      markHotmailUsedInInput(email);  // Danh dau tren input (tick xanh)

      toast(`🎯 Da Pick & Fill: ${email}`, "#27ae60");
      btn.textContent = "✅ Picked";
    } catch (err) {
      toast(`❌ ${err.message}`, "#e74c3c");
      btn.textContent = "HM Pick";
    } finally {
      setTimeout(() => {
        if (!btn) return;
        btn.textContent = "HM Pick";
        btn.style.opacity = "1";
        btn.disabled = false;
      }, 1400);
    }
  });

  // Nut Switch: Chuyen doi Tiny (3-part) <-> Hotmail (5-part) tai dong dang tro chuot
  document.getElementById("af-eq-switch-mode")?.addEventListener("click", async () => {
    const btn = document.getElementById("af-eq-switch-mode");
    if (!btn) return;

    const fullText = String(inputEl.value || "");
    const caretPos = inputEl.selectionStart || 0;
    const lines = fullText.split(/\r?\n/);

    // Tim index cua dong tai caret
    let targetIdx = 0;
    let consumed = 0;
    for (let i = 0; i < lines.length; i++) {
       const l = lines[i];
       if (caretPos >= consumed && caretPos <= consumed + l.length + 1) {
         targetIdx = i;
         break;
       }
       consumed += l.length + 1;
    }

    const targetLine = String(lines[targetIdx] || "").trim();
    if (!targetLine) {
       toast("Dat con tro vao dong can chuyen doi", "#e67e22");
       return;
    }

    const parts = targetLine.split("|").map(p => p.trim());

    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.textContent = "Switching...";

    try {
      const data = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
      const activeHM = String(data[HOTMAIL_ACTIVE_EMAIL_KEY] || "").trim();
      const lastTemp = await getLastTempMailAddress();
      const activeTM = String(lastTemp?.email || "").trim();

      const currentEmail = parts[0].toLowerCase();
      const isCurrentlyHM = activeHM && currentEmail === activeHM.toLowerCase();

      let newEmail = "";
      if (isCurrentlyHM && activeTM) {
        newEmail = activeTM; // HM -> TM
        toast("🔄 Đã chuyển sang Nick Tiny", "#27ae60");
      } else if (activeHM) {
        newEmail = activeHM; // TM (hoặc khác) -> HM
        toast("🔄 Đã chuyển sang Nick Hotmail", "#27ae60");
      } else {
        throw new Error("Chưa có Nick đối ứng để switch");
      }

      // email|mk|2fa
      const pass = parts[1] || AUTO_PASSWORD_VALUE || "";
      const twofa = parts[parts.length - 1] || "";

      lines[targetIdx] = `${newEmail}|${pass}|${twofa}`;
      inputEl.value = lines.join("\n");
      build();
    } catch (err) {
       toast(`❌ ${err.message}`, "#e74c3c");
    } finally {
       btn.disabled = false;
       btn.style.opacity = "1";
       setTimeout(() => {
         updateSwitchModeButton().catch(() => {});
       }, 1500);
    }
  });

  document
    .getElementById("af-eq-hotmail-use")
    .addEventListener("click", async () => {
      const btn = document.getElementById("af-eq-hotmail-use");
      if (!btn) return;

      let target;
      try {
        target = await resolveHotmailUseTarget();
      } catch (err) { }
      
      if (!target || !target.email) {
        await showAfConfirmDialog({
          title: "Chưa có Hotmail",
          message: "⚠️ Bạn chưa chọn hoặc chưa lấy Hotmail nào.\nVui lòng ấn nút '🚀 HM New' ở trên để lấy 1 email trước nhé!",
          confirmText: "Đã hiểu",
        });
        return;
      }
      
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.textContent = "HM Use...";
      
      let usedEmail = String(target.email || "").trim();
      try {
        const fillResult = await fillHotmailNow(target, { silent: true });
        const autoContinued = await autoContinueAfterHotmailUse(fillResult);
        const countText = Number.isFinite(fillResult?.messageCount)
          ? ` (${fillResult.messageCount} mail)`
          : "";
        if (fillResult?.filled) {
          toast(
            autoContinued
              ? `Da dien Hotmail va bam Continue: ${usedEmail}${countText}`
              : `Da dien Hotmail: ${usedEmail}${countText}`,
            "#27ae60",
          );
        } else if (fillResult?.copied) {
          toast(`Hotmail copied: ${usedEmail}`, "#27ae60");
        }
        
        // Danh dau "used" tren web ngay lap tuc - khong doi, khong can biet thanh cong hay khong
        markHotmailUsedViaProxy(usedEmail);

        const lines = String(inputEl.value || "").split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        const primary = lastParsedCredentials[0];
        if (primary && primary.password) {
           const newCredentialLine = formatCredentialLine({
             account: usedEmail,
             password: primary.password,
             twofaSecret: primary.twofaSecret || ""
           });
           if (lines.length > 0) {
             lines[0] = newCredentialLine;
           } else {
             lines.push(newCredentialLine);
           }
           inputEl.value = lines.join("\n");
           build();
           await updateSwitchModeButton();
        }

        btn.textContent = "✅ HM Use";
        btn.style.background = "#27ae60";
      } catch (err) {
        toast(`❌ ${err.message || err}`, "#e74c3c");
        btn.textContent = "❌ HM Use";
      } finally {
        if (usedEmail) {
          markHotmailUsedInInput(usedEmail);
        }
        setTimeout(() => {
          if (!btn) return;
          btn.textContent = "HM Use";
          btn.style.background = "#0f766e";
          btn.style.opacity = "1";
          btn.disabled = false;
        }, 1400);
      }
    });

  document
    .getElementById("af-eq-hotmail-code")
    .addEventListener("click", async () => {
      const btn = document.getElementById("af-eq-hotmail-code");
      if (!btn) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.textContent = "HM Code...";
      try {
        const data = await storageLocalGet([HOTMAIL_ACTIVE_EMAIL_KEY]);
        const email = String(data[HOTMAIL_ACTIVE_EMAIL_KEY] || "").trim();
        if (!email) throw new Error("Chua co Hotmail active. Hay bam HM New hoac điền mail truoc.");

        const res = await readHotmailInboxViaProxy({ email, top: 5 });
        const msgs = res.messages || [];

        let code = "";
        for (const m of msgs) {
          const text = (m.body || m.bodyPreview || m.subject || "");
          const m6 = text.match(/\b(\d{6})\b/);
          if (m6) { code = m6[1]; break; }
          const m4 = text.match(/\b(\d{4})\b/);
          if (m4) { code = m4[1]; break; }
        }

        if (!code) throw new Error("Khong tim thay code 4-6 so trong 5 mail gan nhat");

        const codeEl = findVisibleVerificationCodeField();
        if (codeEl) {
          typeInto(codeEl, code);
          setTimeout(() => clickContinueWithRetry(12, 150), 100);
        }
        await navigator.clipboard.writeText(code);
        toast(codeEl ? `Hotmail OTP da dien: ${code}` : `Hotmail OTP copied: ${code}`, "#27ae60");
        btn.textContent = "✅ HM Code";
        btn.style.background = "#27ae60";
      } catch (err) {
        toast(`❌ ${err.message || err}`, "#e74c3c");
        btn.textContent = "❌ HM Code";
      } finally {
        setTimeout(() => {
          if (!btn) return;
          btn.textContent = "HM Code";
          btn.style.background = "#f97316";
          btn.style.opacity = "1";
          btn.disabled = false;
        }, 1400);
      }
    });

  // TempMail nút: ưu tiên dùng email active, chỉ tạo mới nếu chưa có
  document
    .getElementById("af-eq-tempmail")
    .addEventListener("click", async () => {
      const btn = document.getElementById("af-eq-tempmail");
      if (!btn) return;

      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.textContent = "TM Use...";

      try {
        await fillTempMailNow(false);
        await updateSwitchModeButton();
        btn.textContent = "✅ Done!";
        btn.style.background = "#27ae60";
        setTimeout(() => {
          if (btn) {
            btn.textContent = "TM Use";
            btn.style.background = "#0ea5e9";
          }
        }, 1200);
      } catch (err) {
        toast(`❌ Lỗi: ${err.message}`, "#e74c3c");
        btn.textContent = "❌ Lỗi";
        setTimeout(() => {
          if (btn) {
            btn.textContent = "TM Use";
            btn.style.background = "#0ea5e9";
          }
        }, 2000);
      } finally {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    });

  // Nút New: bắt buộc tạo email TempMail mới rồi điền ngay
  document
    .getElementById("af-eq-tempmail-new")
    .addEventListener("click", async () => {
      const ok = await showAfConfirmDialog({
        title: "Tao email TempMail moi",
        message: "Email cu se khong con duoc dung de lay code. Ban co chac chan?",
        confirmText: "Tao email moi",
      });
      if (!ok) return;

      const btn = document.getElementById("af-eq-tempmail-new");
      if (!btn) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.textContent = "TM New...";
      try {
        await fillTempMailNow(true);
        await updateSwitchModeButton();
        btn.textContent = "✅ New!";
        btn.style.background = "#27ae60";
        setTimeout(() => {
          if (btn) {
            btn.textContent = "TM New";
            btn.style.background = "#8b5cf6";
          }
        }, 1200);
      } catch (err) {
        toast(`❌ Lỗi: ${err.message}`, "#e74c3c");
        btn.textContent = "❌ Lỗi";
        setTimeout(() => {
          if (btn) {
            btn.textContent = "TM New";
            btn.style.background = "#8b5cf6";
          }
        }, 1800);
      } finally {
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    });

  // Nút Code: lấy OTP mới nhất, copy và điền vào ô code nếu thấy
  document.getElementById("af-eq-get-code").addEventListener("click", async () => {
    const btn = document.getElementById("af-eq-get-code");
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = "0.5";
      btn.textContent = "TM Code...";
    try {
      const code = await fetchLatestTempMailCode();
      const codeEl = findVisibleVerificationCodeField();
      if (codeEl) {
        typeInto(codeEl, code);
        setTimeout(() => {
          clickContinueWithRetry(12, 150);
        }, 100);
      }
      await navigator.clipboard.writeText(code);
      toast(codeEl ? `OTP da dien: ${code}` : `OTP copied: ${code}`, "#27ae60");
      btn.textContent = "✅ Code";
      btn.style.background = "#27ae60";
      setTimeout(() => {
        if (btn) {
          btn.textContent = "TM Code";
          btn.style.background = "#f59e0b";
        }
      }, 1500);
    } catch (err) {
      toast(`❌ ${err.message}`, "#e74c3c");
      btn.textContent = "❌ Lỗi";
      setTimeout(() => {
        if (btn) {
          btn.textContent = "TM Code";
          btn.style.background = "#f59e0b";
        }
      }, 1800);
    } finally {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });

  document.getElementById("af-eq-gen-2fa").addEventListener("click", async () => {
    const btn = document.getElementById("af-eq-gen-2fa");
    if (!btn) return;

    const primary = lastParsedCredentials?.[0] || null;
    const fallbackSecret = findVisibleTwofaSecretFromPage();
    const storedSecret = await getStoredTwofaSecretForHost();
    const secretToUse = String(
      primary?.twofaSecret || fallbackSecret || storedSecret || "",
    ).trim();
    if (!secretToUse) {
      toast("Thieu 2FA secret: dan tk|mk|2fa hoac mo popup secret", "#e67e22");
      return;
    }

    await saveTwofaSecretForHost(secretToUse);
    await savePrimaryCredentialToDock(secretToUse);

    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.textContent = "⏳ 2FA...";
    try {
      const code = await generateTotpFromSecret(secretToUse);
      const codeEl = findVisibleVerificationCodeField();
      if (codeEl) {
        typeInto(codeEl, code);
        setTimeout(() => {
          clickVerifyIfEnabled();
        }, 120);
      }
      await navigator.clipboard.writeText(code);
      toast(codeEl ? `2FA da dien: ${code}` : `2FA copied: ${code}`, "#c0392b");
      btn.textContent = "✅ 2FA";
      btn.style.background = "#27ae60";
      setTimeout(() => {
        if (btn) {
          btn.textContent = "2FA";
          btn.style.background = "#dc3f52";
        }
      }, 1500);
    } catch (err) {
      toast(`❌ ${err.message}`, "#e74c3c");
      btn.textContent = "❌ 2FA";
      setTimeout(() => {
        if (btn) btn.textContent = "2FA";
      }, 1500);
    } finally {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });

  document.getElementById("af-eq-push-chatgpt").addEventListener("click", async () => {
    const btn = document.getElementById("af-eq-push-chatgpt");
    if (!btn) return;

    const { apiUrl, token } = await getExtensionPushConfig();
    if (!apiUrl || !token) {
      toast("Chua cau hinh Push URL/Token trong popup extension", "#e67e22");
      return;
    }

    const credential = getPrimaryCredentialForPush();
    if (!credential?.ok) {
      toast(credential?.error || "Chua co tk|mk|2fa de day", "#e67e22");
      return;
    }

    const worker = await getStoredExtensionWorker();
    if (!worker?.id) {
      toast("Chua chon nguoi lam truoc khi Push", "#e67e22");
      workerSelectEl?.focus();
      return;
    }

    const oldText = btn.textContent;
    const oldBg = btn.style.background;
    btn.disabled = true;
    btn.style.opacity = "0.55";
    btn.textContent = "Dang day...";

    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-extension-push-token": token,
        },
        body: JSON.stringify({
          username: credential.username,
          password: credential.password,
          otpSecret: credential.otpSecret,
          workerId: worker.id,
          source: "extension_quick_dock",
          originHost: String(location.hostname || location.href || "").slice(0, 120),
        }),
      });
      const json = await resp.json().catch(() => ({}));

      if (resp.status === 409 || json?.duplicate) {
        btn.textContent = "Trung";
        btn.style.background = "#d97706";
        toast("Acc da co trong he thong", "#e67e22");
        return;
      }

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || `Push error HTTP ${resp.status}`);
      }

      const pushedUser = String(json?.account?.username || credential.username).trim();
      if (json?.worker?.id) {
        await setStoredExtensionWorker(json.worker);
        await renderExtensionWorkerSelect();
      }
      btn.textContent = "Da day";
      btn.style.background = "#16a34a";
      clearQuickDockInput();
      toast(
        `Da day len inventory va clear o nhap: ${pushedUser}${getHotmailLinkStatusText(json?.hotmailLink)}`,
        "#27ae60",
      );
    } catch (err) {
      btn.textContent = "Loi";
      btn.style.background = "#c0392b";
      toast(`❌ ${err.message || err}`, "#e74c3c");
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = oldText;
        btn.style.background = oldBg || "#2563eb";
      }, 1600);
    }
  });
}

function formatEmailQuickLine(rawEmail) {
  const cred = parseCredentialLine(rawEmail);
  return formatCredentialLine(cred);
}

// ============================================================
// CLICK ÃƒÂ¢Ã¢â‚¬ËœÃ‚Â  ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â AutoFill (thÃƒÂ¡Ã‚ÂºÃ‚Â» + Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹a chÃƒÂ¡Ã‚Â»Ã¢â‚¬Â°)
// ============================================================
// ============================================================
// CLICK ÃƒÂ¢Ã¢â‚¬ËœÃ‚Â  ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â AutoFill: CHÃƒÂ¡Ã‚Â»Ã‹â€  Ãƒâ€žÃ‚ÂIÃƒÂ¡Ã‚Â»Ã¢â€šÂ¬N THÃƒÂ¡Ã‚ÂºÃ‚Âº + Ãƒâ€žÃ‚ÂÃƒÂ¡Ã‚Â»Ã…Â A CHÃƒÂ¡Ã‚Â»Ã‹â€
// ============================================================
async function handleFillClick() {
  if (await blockIfCaptchaPresent("fill")) return;

  chrome.storage.local.get(
    ["cards", "cardIndex", "addresses", "addrIndex", "addressMode"],
    async (data) => {
      const picked = pickNextCardForAutofill(data);
      if (!picked) {
        toast("Khong co test card hop le.", "#e67e22");
        return;
      }

      // 1) Sinh data Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹a chÃƒÂ¡Ã‚Â»Ã¢â‚¬Â° ngÃƒÂ¡Ã‚ÂºÃ‚Â«u nhiÃƒÆ’Ã‚Âªn
      const addressMode = normalizeAddressMode(data.addressMode);
      const addrData = resolveAddressForAutofill(data, addressMode);

      // 2) KÃƒÆ’Ã‚Â­ch hoÃƒÂ¡Ã‚ÂºÃ‚Â¡t fill ThÃƒÂ¡Ã‚ÂºÃ‚Â» & Ãƒâ€žÃ‚ÂÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹a chÃƒÂ¡Ã‚Â»Ã¢â‚¬Â° (cho iframe)
      chrome.storage.local.set({
        fillTrigger: { cardData: picked.cardData, addrData, ts: Date.now() },
        cardIndex: picked.nextIndex,
        addrIndex: getAddressUsageValue(data.addresses, addressMode),
      });

      toast(
        picked.source === "sandbox"
          ? "AutoFill: Sandbox Card + Address"
          : "AutoFill: Card + Address",
        "#e91e63",
      );
    },
  );
}

function parseCardLine(line) {
  const parts = String(line || "")
    .split("|")
    .map((s) => s.trim());
  if (parts.length < 4) return null;

  const number = parts[0].replace(/\D/g, "");
  const monthRaw = parts[1].replace(/\D/g, "");
  const yearRaw = parts[2].replace(/\D/g, "");
  const cvvRaw = parts[3].replace(/\D/g, "");

  if (number.length < 12 || number.length > 19) return null;
  if (!isLuhnValid(number)) return null;
  if (!monthRaw || !yearRaw || !cvvRaw) return null;

  const month = monthRaw.padStart(2, "0").slice(-2);
  const year = yearRaw.slice(-2);
  const cvv = cvvRaw.slice(0, 4);
  const mm = Number(month);
  if (!(mm >= 1 && mm <= 12)) return null;
  if (year.length !== 2) return null;
  if (cvv.length < 3) return null;

  return { number, month, year, cvv };
}

function pickRandomItem(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}

function normalizeAddressMode(mode) {
  return [
    ADDRESS_MODE_RANDOM_KR,
    ADDRESS_MODE_RANDOM_KR_INDO_MIX,
    ADDRESS_MODE_RANDOM_US_INDO_MIX,
    ADDRESS_MODE_RANDOM_UK_INDO_MIX,
    ADDRESS_MODE_RANDOM_US,
    ADDRESS_MODE_RANDOM_UK,
    ADDRESS_MODE_RANDOM_JP,
    ADDRESS_MODE_RANDOM_INDONESIA,
    ADDRESS_MODE_RANDOM_INDIA,
    ADDRESS_MODE_RANDOM_ALGERIA,
    ADDRESS_MODE_RANDOM_KAZAKHSTAN,
    ADDRESS_MODE_RANDOM_CHILE,
    ADDRESS_MODE_RANDOM_ANY,
    ADDRESS_MODE_FIXED_KR,
    ADDRESS_MODE_FIXED_US,
    ADDRESS_MODE_FIXED_UK,
    ADDRESS_MODE_FIXED_JP,
    ADDRESS_MODE_FIXED_INDONESIA,
    ADDRESS_MODE_FIXED_INDIA,
    ADDRESS_MODE_FIXED_ALGERIA,
    ADDRESS_MODE_FIXED_KAZAKHSTAN,
    ADDRESS_MODE_FIXED_CHILE,
  ].includes(mode)
    ? mode
    : ADDRESS_MODE_RANDOM_KR_INDO_MIX;
}

function getQuickAddressModeLabel(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  if (normalizedMode === ADDRESS_MODE_RANDOM_US_INDO_MIX) return "Mode US+ID";
  if (normalizedMode === ADDRESS_MODE_RANDOM_UK_INDO_MIX) return "Mode UK+ID";
  return "Mode KR+ID";
}

async function syncQuickAddressModeButton() {
  const btn = document.getElementById("af-btn-mode");
  if (!btn) return;
  const data = await storageLocalGet(["addressMode"]);
  btn.textContent = getQuickAddressModeLabel(data.addressMode);
}

async function handleQuickAddressModeClick() {
  const data = await storageLocalGet(["addressMode"]);
  const currentMode = normalizeAddressMode(data.addressMode);
  const currentIndex = QUICK_TOOLBAR_ADDRESS_MODES.indexOf(currentMode);
  const nextMode =
    currentIndex >= 0
      ? QUICK_TOOLBAR_ADDRESS_MODES[
          (currentIndex + 1) % QUICK_TOOLBAR_ADDRESS_MODES.length
        ]
      : QUICK_TOOLBAR_ADDRESS_MODES[0];

  await storageLocalSet({
    addressMode: nextMode,
    lockedAddrData: null,
    lockedAddrMode: "",
  });
  syncQuickAddressModeButton();
  toast(`Address mode: ${getQuickAddressModeLabel(nextMode)}`, "#2980b9");
}

function isFixedAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_FIXED_KR ||
    normalizedMode === ADDRESS_MODE_FIXED_US ||
    normalizedMode === ADDRESS_MODE_FIXED_UK ||
    normalizedMode === ADDRESS_MODE_FIXED_JP ||
    normalizedMode === ADDRESS_MODE_FIXED_INDONESIA ||
    normalizedMode === ADDRESS_MODE_FIXED_INDIA ||
    normalizedMode === ADDRESS_MODE_FIXED_ALGERIA ||
    normalizedMode === ADDRESS_MODE_FIXED_KAZAKHSTAN ||
    normalizedMode === ADDRESS_MODE_FIXED_CHILE
  );
}

function isUsAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_US_INDO_MIX ||
    normalizedMode === ADDRESS_MODE_RANDOM_US ||
    normalizedMode === ADDRESS_MODE_FIXED_US
  );
}

function isKrIndoMixAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return normalizedMode === ADDRESS_MODE_RANDOM_KR_INDO_MIX;
}

function isUsIndoMixAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return normalizedMode === ADDRESS_MODE_RANDOM_US_INDO_MIX;
}

function isUkIndoMixAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return normalizedMode === ADDRESS_MODE_RANDOM_UK_INDO_MIX;
}

function isUkAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_UK_INDO_MIX ||
    normalizedMode === ADDRESS_MODE_RANDOM_UK ||
    normalizedMode === ADDRESS_MODE_FIXED_UK
  );
}

function isJapanAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_JP ||
    normalizedMode === ADDRESS_MODE_FIXED_JP
  );
}

function isIndonesiaAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_INDONESIA ||
    normalizedMode === ADDRESS_MODE_FIXED_INDONESIA
  );
}

function isIndiaAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_INDIA ||
    normalizedMode === ADDRESS_MODE_FIXED_INDIA
  );
}

function isAlgeriaAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_ALGERIA ||
    normalizedMode === ADDRESS_MODE_FIXED_ALGERIA
  );
}

function isKazakhstanAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_KAZAKHSTAN ||
    normalizedMode === ADDRESS_MODE_FIXED_KAZAKHSTAN
  );
}

function isChileAddressMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  return (
    normalizedMode === ADDRESS_MODE_RANDOM_CHILE ||
    normalizedMode === ADDRESS_MODE_FIXED_CHILE
  );
}

function getAddressPool(mode) {
  if (isChileAddressMode(mode)) return CHILE_BILLING_ADDRESS_POOL;
  if (isKazakhstanAddressMode(mode)) return KAZAKHSTAN_BILLING_ADDRESS_POOL;
  if (isAlgeriaAddressMode(mode)) return ALGERIA_BILLING_ADDRESS_POOL;
  if (isIndonesiaAddressMode(mode)) return INDONESIA_BILLING_ADDRESS_POOL;
  if (isIndiaAddressMode(mode)) return INDIA_BILLING_ADDRESS_POOL;
  if (isJapanAddressMode(mode)) return JAPAN_BILLING_ADDRESS_POOL;
  if (isUkAddressMode(mode)) return UK_BILLING_ADDRESS_POOL;
  if (isUsAddressMode(mode)) return US_BILLING_ADDRESS_POOL;
  return KR_BILLING_ADDRESS_POOL;
}

function getDefaultAddressForMode(mode) {
  const pool = getAddressPool(mode);
  return pickRandomItem(pool) || pool[0] || FIXED_BILLING_ADDRESS;
}

function getDefaultCountryForMode(mode) {
  if (isKrIndoMixAddressMode(mode)) return "South Korea";
  if (isChileAddressMode(mode)) return "Chile";
  if (isKazakhstanAddressMode(mode)) return "Kazakhstan";
  if (isAlgeriaAddressMode(mode)) return "Algeria";
  if (isIndonesiaAddressMode(mode)) return "Indonesia";
  if (isIndiaAddressMode(mode)) return "India";
  if (isJapanAddressMode(mode)) return "Japan";
  if (isUkAddressMode(mode)) return "United Kingdom";
  if (isUsAddressMode(mode)) return "United States";
  return "South Korea";
}

function randomIntInclusive(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function randomDigits(length) {
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomIntInclusive(0, 9));
  return out;
}

function randomUpper(length) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(randomIntInclusive(65, 90));
  }
  return out;
}

function buildGeneratedAddressForMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);

  const buildIndoBottomPart = () => {
    const indoCities = Object.keys(INDONESIA_CITY_DATA);
    const indoCity = pickRandomItem(indoCities) || "Jakarta";
    const cityData = INDONESIA_CITY_DATA[indoCity];
    const postalCode = String(
      randomIntInclusive(cityData.postalMin, cityData.postalMax),
    ).padStart(5, "0");
    const street = pickRandomItem(cityData.streets) || "Jl. Sudirman";
    const houseNumber = randomIntInclusive(1, 199);

    return {
      city: indoCity,
      address: `${street} No. ${houseNumber}`,
      postal: postalCode,
    };
  };

  if (isKrIndoMixAddressMode(normalizedMode)) {
    const krTop = pickRandomItem([
      { state: "Seoul", city: "Seoul" },
      { state: "Busan", city: "Busan" },
    ]) || { state: "Seoul", city: "Seoul" };
    const indoBottom = buildIndoBottomPart();

    return {
      country: "South Korea",
      state: krTop.state,
      city: indoBottom.city,
      address: indoBottom.address,
      postal: indoBottom.postal,
    };
  }

  if (isUsIndoMixAddressMode(normalizedMode)) {
    const usTop = pickRandomItem([
      { state: "California" },
      { state: "New York" },
      { state: "Texas" },
      { state: "Florida" },
    ]) || { state: "California" };
    const indoBottom = buildIndoBottomPart();
    return {
      country: "United States",
      state: usTop.state,
      city: indoBottom.city,
      address: indoBottom.address,
      postal: indoBottom.postal,
    };
  }

  if (isUkIndoMixAddressMode(normalizedMode)) {
    const ukTop = pickRandomItem([
      { state: "England" },
      { state: "Scotland" },
      { state: "Wales" },
    ]) || { state: "England" };
    const indoBottom = buildIndoBottomPart();
    return {
      country: "United Kingdom",
      state: ukTop.state,
      city: indoBottom.city,
      address: indoBottom.address,
      postal: indoBottom.postal,
    };
  }

  if (isUsAddressMode(normalizedMode)) {
    const usCityZipMap = [
      { city: "Los Angeles", postal: "90001" },
      { city: "Hollywood", postal: "90028" },
      { city: "Beverly Hills", postal: "90210" },
      { city: "Santa Monica", postal: "90401" },
      { city: "Long Beach", postal: "90801" },
      { city: "Pasadena", postal: "91101" },
      { city: "Burbank", postal: "91501" },
      { city: "Glendale", postal: "91201" },
      { city: "Anaheim", postal: "92801" },
      { city: "Santa Ana", postal: "92701" },
      { city: "Irvine", postal: "92602" },
      { city: "San Diego", postal: "92101" },
      { city: "Chula Vista", postal: "91910" },
      { city: "Riverside", postal: "92501" },
      { city: "San Bernardino", postal: "92401" },
      { city: "Fresno", postal: "93701" },
      { city: "Bakersfield", postal: "93301" },
      { city: "Sacramento", postal: "95814" },
      { city: "San Jose", postal: "95101" },
      { city: "San Francisco", postal: "94102" },
      { city: "Oakland", postal: "94601" },
      { city: "Berkeley", postal: "94701" },
      { city: "Stockton", postal: "95201" },
      { city: "Modesto", postal: "95351" },
      { city: "Santa Barbara", postal: "93101" },
    ];
    const pickedCity = pickRandomItem(usCityZipMap) || usCityZipMap[0];
    const streetName =
      pickRandomItem([
        "Figueroa",
        "Olive",
        "Flower",
        "Hope",
        "Sunset",
        "Broadway",
        "Main",
        "Grand",
        "Vine",
        "Wilshire",
      ]) || "Main";
    const streetType =
      pickRandomItem(["St", "Ave", "Blvd", "Rd", "Dr", "Ln"]) || "St";
    return {
      country: "United States",
      state: "California",
      city: pickedCity.city,
      address: `${randomIntInclusive(100, 9999)} ${streetName} ${streetType}`,
      postal: pickedCity.postal,
    };
  }

  if (isUkAddressMode(normalizedMode)) {
    const road =
      pickRandomItem([
        "Baker",
        "Oxford",
        "Regent",
        "Kensington",
        "Victoria",
        "Kingston",
        "Bridge",
        "Abbey",
        "River",
      ]) || "Baker";
    const suffix =
      pickRandomItem(["Road", "Street", "Lane", "Close", "Way", "Gardens"]) ||
      "Road";
    const outward =
      pickRandomItem([
        "SW",
        "SE",
        "NW",
        "N",
        "E",
        "W",
        "EC",
        "WC",
        "B",
        "M",
        "L",
      ]) || "SW";
    const postcode = `${outward}${randomIntInclusive(1, 99)} ${randomIntInclusive(1, 9)}${randomUpper(2)}`;
    return {
      country: "United Kingdom",
      state: "England",
      city: "London",
      address: `${randomIntInclusive(1, 250)} ${road} ${suffix}`,
      postal: postcode,
    };
  }

  if (isJapanAddressMode(normalizedMode)) {
    const area =
      pickRandomItem([
        "Nishi-Shinjuku",
        "Roppongi",
        "Marunouchi",
        "Shibuya",
        "Ueno",
        "Asakusa",
        "Akasaka",
        "Kanda",
      ]) || "Shibuya";
    return {
      country: "Japan",
      state: "Tokyo",
      city: "Tokyo",
      address: `${randomIntInclusive(1, 7)}-${randomIntInclusive(1, 40)}-${randomIntInclusive(1, 50)} ${area}`,
      postal: `${randomDigits(3)}-${randomDigits(4)}`,
    };
  }

  if (isIndonesiaAddressMode(normalizedMode)) {
    const idCityMap = [
      { state: "DKI Jakarta", city: "Jakarta Selatan", postal: "12190" },
      { state: "DKI Jakarta", city: "Jakarta Barat", postal: "11220" },
      { state: "Jawa Timur", city: "Surabaya", postal: "60271" },
      { state: "Jawa Barat", city: "Bandung", postal: "40111" },
      { state: "Banten", city: "Tangerang", postal: "15117" },
      { state: "Jawa Timur", city: "Sidoarjo", postal: "61212" },
      { state: "Jawa Barat", city: "Bekasi", postal: "17144" },
    ];
    const picked = pickRandomItem(idCityMap) || idCityMap[0];
    const roads = [
      "Jl. Sudirman",
      "Jl. Thamrin",
      "Jl. Ahmad Yani",
      "Jl. Pahlawan",
      "Jl. Diponegoro",
      "Jl. Gajah Mada",
    ];
    return {
      country: "Indonesia",
      state: picked.state,
      city: picked.city,
      address: `${pickRandomItem(roads) || "Jl. Sudirman"} No. ${randomIntInclusive(1, 199)}`,
      postal: picked.postal,
    };
  }

  if (isIndiaAddressMode(normalizedMode)) {
    const roads = [
      "Connaught Place",
      "Janpath Road",
      "Kasturba Gandhi Marg",
      "Barakhamba Road",
      "Sansad Marg",
      "Tolstoy Marg",
      "Bahadur Shah Zafar Marg",
      "Ashoka Road",
    ];
    const validPins = ["110001", "110002", "110003", "110011", "110021"];
    const road = pickRandomItem(roads) || "Connaught Place";
    const postal = pickRandomItem(validPins) || "110001";
    return {
      country: "India",
      state: "Delhi",
      city: "New Delhi",
      address: `${randomIntInclusive(1, 250)} ${road}`,
      postal,
    };
  }

  if (isAlgeriaAddressMode(normalizedMode)) {
    const city =
      pickRandomItem(["Algiers", "Oran", "Constantine", "Blida", "Annaba"]) ||
      "Algiers";
    const road =
      pickRandomItem([
        "Rue Didouche Mourad",
        "Boulevard Mohamed V",
        "Rue Larbi Ben Mhidi",
        "Avenue Pasteur",
        "Rue Hassiba Ben Bouali",
      ]) || "Rue Didouche Mourad";
    return {
      country: "Algeria",
      state: city === "Algiers" ? "Algiers Province" : "Oran Province",
      city,
      address: `${randomIntInclusive(1, 180)} ${road}`,
      postal: randomDigits(5),
    };
  }

  if (isKazakhstanAddressMode(normalizedMode)) {
    const city =
      pickRandomItem(["Almaty", "Astana", "Shymkent", "Karaganda", "Aktobe"]) ||
      "Almaty";
    const road =
      pickRandomItem([
        "Abylai Khan Ave",
        "Tole Bi St",
        "Nazarbayev Ave",
        "Panfilov St",
        "Kabanbay Batyr St",
        "Satpayev St",
      ]) || "Abylai Khan Ave";
    return {
      country: "Kazakhstan",
      state: city,
      city,
      address: `${randomIntInclusive(1, 220)} ${road}`,
      postal: randomDigits(6),
    };
  }

  if (isChileAddressMode(normalizedMode)) {
    const city =
      pickRandomItem([
        "Santiago",
        "Providencia",
        "Las Condes",
        "Vitacura",
        "Nunoa",
      ]) || "Santiago";
    const road =
      pickRandomItem([
        "Avenida Libertador Bernardo O'Higgins",
        "Calle Monjitas",
        "Avenida Providencia",
        "Calle Huerfanos",
        "Avenida Apoquindo",
        "Calle Merced",
        "Avenida Vitacura",
        "Calle Estado",
        "Avenida Irarrazazval",
        "Calle Compania",
      ]) || "Avenida Providencia";
    return {
      country: "Chile",
      state: "Santiago Metropolitan",
      city,
      address: `${randomIntInclusive(1, 999)} ${road}`,
      postal: `${randomIntInclusive(750, 839)}0000`,
    };
  }

  const krRegions = [
    {
      state: "Seoul",
      city: "Seoul",
      roads: [
        "Teheran-ro",
        "Gangnam-daero",
        "Itaewon-ro",
        "Bongeunsa-ro",
        "Mapo-daero",
      ],
      districts: [
        "Gangnam-gu",
        "Seocho-gu",
        "Mapo-gu",
        "Yongsan-gu",
        "Jongno-gu",
      ],
      postalPrefix: "0",
    },
    {
      state: "Busan",
      city: "Busan",
      roads: [
        "Haeundae-ro",
        "Centumnam-daero",
        "Gwangbok-ro",
        "Suyeong-ro",
        "Dongnae-ro",
      ],
      districts: [
        "Haeundae-gu",
        "Suyeong-gu",
        "Dongnae-gu",
        "Busanjin-gu",
        "Nam-gu",
      ],
      postalPrefix: "4",
    },
  ];
  const pickedKr = pickRandomItem(krRegions) || krRegions[0];
  const seoulDistrict = pickRandomItem([...pickedKr.districts]) || "Gangnam-gu";
  const seoulRoad = pickRandomItem([...pickedKr.roads]) || "Teheran-ro";
  return {
    country: "South Korea",
    state: pickedKr.state,
    city: pickedKr.city,
    address: `${randomIntInclusive(1, 140)}, ${seoulRoad}, ${seoulDistrict}`,
    postal: `${pickedKr.postalPrefix}${randomDigits(4)}`,
  };
}

function getAddressUsageValue(rawAddresses, mode) {
  if (!isFixedAddressMode(mode)) return 0;
  return countSavedAddresses(rawAddresses, getDefaultCountryForMode(mode))
    ? 1
    : 0;
}

function normalizeCountryToken(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (/(^|\s)(united states|usa|us)(\s|$)/.test(raw)) return "us";
  if (
    /(^|\s)(united kingdom|uk|gb|england|britain|great britain)(\s|$)/.test(raw)
  )
    return "uk";
  if (/(^|\s)(japan|jp)(\s|$)/.test(raw)) return "jp";
  if (/(^|\s)(south korea|korea|kr|republic of korea)(\s|$)/.test(raw))
    return "kr";
  if (/(^|\s)(indonesia|id)(\s|$)/.test(raw)) return "id";
  if (/(^|\s)(india|in)(\s|$)/.test(raw)) return "in";
  if (/(^|\s)(algeria|dz)(\s|$)/.test(raw)) return "dz";
  if (/(^|\s)(kazakhstan|kz)(\s|$)/.test(raw)) return "kz";
  if (/(^|\s)(chile|cl)(\s|$)/.test(raw)) return "cl";
  return raw;
}

function getCountryTokenForMode(mode) {
  const normalizedMode = normalizeAddressMode(mode);
  if (isKrIndoMixAddressMode(normalizedMode)) return "kr";
  if (isUsAddressMode(normalizedMode)) return "us";
  if (isUkAddressMode(normalizedMode)) return "uk";
  if (isJapanAddressMode(normalizedMode)) return "jp";
  if (isIndonesiaAddressMode(normalizedMode)) return "id";
  if (isIndiaAddressMode(normalizedMode)) return "in";
  if (isAlgeriaAddressMode(normalizedMode)) return "dz";
  if (isKazakhstanAddressMode(normalizedMode)) return "kz";
  if (isChileAddressMode(normalizedMode)) return "cl";
  return "kr";
}

function isAddressCountryMatchedMode(addr, mode) {
  const expected = getCountryTokenForMode(mode);
  const actual = normalizeCountryToken(addr?.country);
  if (!expected) return true;
  if (!actual) return false;
  return actual === expected;
}

function isAddressStructMatchedMode(addr, mode) {
  if (!addr || typeof addr !== "object") return false;
  const state = String(addr.state || "")
    .trim()
    .toLowerCase();
  const city = String(addr.city || "")
    .trim()
    .toLowerCase();
  const postal = String(addr.postal || "").replace(/\D/g, "");
  const normalizedMode = normalizeAddressMode(mode);

  if (
    normalizedMode === ADDRESS_MODE_RANDOM_KR ||
    normalizedMode === ADDRESS_MODE_FIXED_KR
  ) {
    const krLike = /[가-힣]/.test(
      `${addr.state || ""}${addr.city || ""}${addr.address || ""}`,
    );
    const hasKrCity = /seoul|busan/.test(state) || /seoul|busan/.test(city);
    return krLike || hasKrCity;
  }

  if (isIndonesiaAddressMode(normalizedMode)) {
    const idCity =
      /jakarta|surabaya|bandung|tangerang|bekasi|sidoarjo|depok|bogor/.test(
        city,
      );
    const idState =
      /jakarta|jawa|banten|bali|sumatera|sulawesi|kalimantan/.test(state);
    return (idCity || idState) && postal.length === 5;
  }

  return true;
}

function parseAddressLine(
  line,
  defaultCountry = FIXED_BILLING_ADDRESS.country,
) {
  const parts = String(line || "")
    .split("|")
    .map((s) => s.trim());

  while (parts.length && !parts[parts.length - 1]) parts.pop();
  if (parts.length < 4) return null;

  const lowerParts = parts.map((s) =>
    String(s || "")
      .trim()
      .toLowerCase(),
  );
  if (
    lowerParts.includes("name") ||
    lowerParts.includes("country") ||
    lowerParts.includes("state/province") ||
    lowerParts.includes("state") ||
    lowerParts.includes("city") ||
    lowerParts.includes("street address") ||
    lowerParts.includes("zip code")
  ) {
    return null;
  }

  let name = "";
  let country = defaultCountry || FIXED_BILLING_ADDRESS.country;
  let state = FIXED_BILLING_ADDRESS.state;
  let city = FIXED_BILLING_ADDRESS.city;
  let address = "";
  let postal = "";

  if (parts.length >= 6) {
    [name, country, state, city, address, postal] = parts;
  } else if (parts.length === 5) {
    [name, state, city, address, postal] = parts;
  } else {
    [name, state, address, postal] = parts;
    city = state;
  }

  if (!state || !address || !postal) return null;

  return {
    name,
    country: country || defaultCountry || FIXED_BILLING_ADDRESS.country,
    state,
    city: city || state || FIXED_BILLING_ADDRESS.city,
    address,
    postal,
  };
}

function countSavedAddresses(
  rawAddresses,
  defaultCountry = FIXED_BILLING_ADDRESS.country,
) {
  return String(rawAddresses || "")
    .split("\n")
    .map((line) => parseAddressLine(line, defaultCountry))
    .filter(Boolean).length;
}

function buildRandomAddress(
  name,
  rawAddresses = "",
  addressMode = ADDRESS_MODE_RANDOM_KR,
) {
  let modeToUse = addressMode;
  if (normalizeAddressMode(modeToUse) === ADDRESS_MODE_RANDOM_ANY) {
    const allRandomModes = [
      ADDRESS_MODE_RANDOM_KR,
      ADDRESS_MODE_RANDOM_US_INDO_MIX,
      ADDRESS_MODE_RANDOM_UK_INDO_MIX,
      ADDRESS_MODE_RANDOM_US,
      ADDRESS_MODE_RANDOM_UK,
      ADDRESS_MODE_RANDOM_JP,
      ADDRESS_MODE_RANDOM_INDONESIA,
      ADDRESS_MODE_RANDOM_INDIA,
      ADDRESS_MODE_RANDOM_ALGERIA,
      ADDRESS_MODE_RANDOM_KAZAKHSTAN,
      ADDRESS_MODE_RANDOM_CHILE,
    ];
    modeToUse =
      allRandomModes[Math.floor(Math.random() * allRandomModes.length)];
  }

  const normalizedMode = normalizeAddressMode(modeToUse);
  const defaultCountry = getDefaultCountryForMode(normalizedMode);
  const pool = getAddressPool(normalizedMode);
  const fallback = isFixedAddressMode(normalizedMode)
    ? pool[0] || FIXED_BILLING_ADDRESS
    : getDefaultAddressForMode(normalizedMode);
  const savedPool = String(rawAddresses || "")
    .split("\n")
    .map((line) => parseAddressLine(line, defaultCountry))
    .filter(Boolean);
  const savedPoolForMode = savedPool.filter(
    (addr) =>
      isAddressCountryMatchedMode(addr, normalizedMode) &&
      isAddressStructMatchedMode(addr, normalizedMode),
  );
  const picked = isFixedAddressMode(normalizedMode)
    ? savedPool[0] || fallback
    : buildGeneratedAddressForMode(normalizedMode) ||
      pickRandomItem(savedPoolForMode) ||
      fallback;

  const randomName = getRandomNameForMode(normalizedMode, name);

  return {
    name: isFixedAddressMode(normalizedMode)
      ? picked.name || name
      : picked.name || randomName,
    country:
      picked.country || fallback.country || FIXED_BILLING_ADDRESS.country,
    state: picked.state || fallback.state || FIXED_BILLING_ADDRESS.state,
    city: picked.city || fallback.city || FIXED_BILLING_ADDRESS.city,
    address:
      picked.address || fallback.address || FIXED_BILLING_ADDRESS.address,
    postal: picked.postal || fallback.postal || FIXED_BILLING_ADDRESS.postal,
  };
}

function buildRandomIdentity(addressMode = ADDRESS_MODE_RANDOM_KR_INDO_MIX) {
  const mode = normalizeAddressMode(addressMode);
  const name = getRandomNameForMode(mode, randomGlobalLatinName());
  const year = 1990 + Math.floor(Math.random() * 16); // 1990-2005
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  return {
    name,
    year,
    month,
    day,
    birthStr: `${month}/${day}/${year}`,
  };
}

async function getCurrentTempMailEmailForAutofill() {
  const config = await storageLocalGet(["useTempMail"]);
  if (!config.useTempMail) return null;

  // Try to get existing TempMail address (reuse if still valid)
  let tempMailData = await getLastTempMailAddress();
  
  if (!tempMailData) {
    // Generate new TempMail address
    tempMailData = await generateRandomTempMailAddress();
    if (!tempMailData) {
      console.warn("TempMail: Failed to generate address, falling back to manual emails");
      return null;
    }
  }

  return tempMailData.email;
}

// ============================================================
// TempMail Message Handler (for popup)
// ============================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generateTempMail") {
    generateRandomTempMailAddress()
      .then((result) => {
        if (result) {
          sendResponse({ success: true, email: result });
        } else {
          sendResponse({ success: false, error: "Failed to generate TempMail address" });
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep the message channel open for async response
  }

  if (request.action === "getTempMailInbox") {
    const email = String(request.email || "").trim();
    const [username, domain] = email.split("@");
    if (!username || !domain) {
      sendResponse({ success: false, error: "Invalid email format" });
      return false;
    }

    getTempMailInbox(domain, username, 1, Number(request.limit || 20))
      .then((inbox) => {
        sendResponse({ success: true, inbox });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Inbox error" });
      });
    return true;
  }

  if (request.action === "getTempMailLatestCode") {
    const email = String(request.email || "").trim();
    const [username, domain] = email.split("@");
    if (!username || !domain) {
      sendResponse({ success: false, error: "Invalid email format" });
      return false;
    }

    getTempMailInbox(domain, username, 1, 20)
      .then(async (inbox) => {
        const emails = Array.isArray(inbox?.emails) ? inbox.emails : [];
        if (!emails.length) {
          sendResponse({ success: true, code: "", source: null });
          return;
        }

        const sorted = [...emails].sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );
        const latest = sorted[0];
        let code = extractOtpCodeFromText(
          `${latest.subject || ""}\n${latest.body || ""}\n${latest.html_body || ""}`,
        );

        if (!code && latest?.id) {
          const detail = await getTempMailEmailDetail(domain, username, latest.id);
          code = extractOtpCodeFromText(
            `${detail?.subject || ""}\n${detail?.body || ""}\n${detail?.html_body || ""}`,
          );
        }

        sendResponse({
          success: true,
          code,
          source: {
            id: latest.id,
            subject: latest.subject || "",
            sender: latest.sender || "",
            date: latest.date || "",
          },
        });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Code extraction error" });
      });
    return true;
  }
});

async function fillIdentityOnMain(identity) {
  // Ãƒâ€žÃ‚ÂiÃƒÂ¡Ã‚Â»Ã‚Ân TÃƒÆ’Ã‚Âªn: Ãƒâ€ Ã‚Â°u tiÃƒÆ’Ã‚Âªn field Ãƒâ€žÃ¢â‚¬Ëœang hiÃƒÂ¡Ã‚Â»Ã†â€™n thÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹ Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã†â€™ trÃƒÆ’Ã‚Â¡nh Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã‚Â¥ng input ÃƒÂ¡Ã‚ÂºÃ‚Â©n
  const nameEl = findIdentityNameField();

  if (nameEl) {
    typeInputLikeUser(nameEl, identity.name);
    if (typeof nameEl.blur === "function") nameEl.blur();
  }

  await sleep(120);

  // Trang xÃƒÆ’Ã‚Â¡c minh tuÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¢i: Ãƒâ€žÃ¢â‚¬ËœiÃƒÂ¡Ã‚Â»Ã‚Ân kiÃƒÂ¡Ã‚Â»Ã†â€™u gÃƒÆ’Ã‚Âµ liÃƒÂ¡Ã‚Â»Ã‚Ân MMDDYYYY nhÃƒâ€ Ã‚Â° nhÃƒÂ¡Ã‚ÂºÃ‚Â­p tay
  if (isChatGPTAgeGate()) {
    let ok = await fillAgeGateAgeField(identity);
    if (!ok) {
      ok = await fillAgeGateBirthdayAsDigits(identity);
    }
    await sleep(40);
    const consentTicked = tickAgeGateConsentIfPresent();
    // Đợi Finish button enabled rồi click
    await sleep(Math.floor(Math.random() * 800) + 800);
    for (let i = 0; i < 20; i++) {
      const finishBtn = Array.from(document.querySelectorAll("button")).find(
        (el) =>
          !el.disabled &&
          matchesUiPatterns(el.textContent || "", FINISH_CREATE_PATTERNS),
      );
      if (finishBtn) {
        await sleep(Math.floor(Math.random() * 500) + 1200);
        clickLikeMouse(finishBtn);
        break;
      }
      await sleep(200);
    }
    return { dobFilled: ok, consentTicked };
  }

  // Ãƒâ€žÃ‚ÂiÃƒÂ¡Ã‚Â»Ã‚Ân ngÃƒÆ’Ã‚Â y sinh dÃƒÂ¡Ã‚ÂºÃ‚Â¡ng segmented (month/day/year) trÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã¢â‚¬Âºc
  const mSeg = qs(['[data-type="month"]']);
  const dSeg = qs(['[data-type="day"]']);
  const ySeg = qs(['[data-type="year"]']);

  if (mSeg && dSeg && ySeg) {
    await typeDateSegmentLikeUser(mSeg, identity.month);
    await typeDateSegmentLikeUser(dSeg, identity.day);
    await typeDateSegmentLikeUser(ySeg, String(identity.year));

    const group = ySeg.closest('[role="group"]');
    if (group) {
      group.dispatchEvent(new Event("input", { bubbles: true }));
      group.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (typeof ySeg.blur === "function") ySeg.blur();
    return { dobFilled: true };
  } else {
    // Fallback: input thÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Âng MM/DD/YYYY
    const birthEl = findBirthdayField();

    if (birthEl) {
      birthEl.focus();
      if (birthEl.type === "date") {
        typeInto(birthEl, `${identity.year}-${identity.month}-${identity.day}`);
      } else {
        const birthFingerprint = getFieldFingerprint(birthEl);
        const isKoreanBirthField = /생일|생년월일|연도|월|일/.test(
          birthFingerprint,
        );
        const birthText = isKoreanBirthField
          ? `${identity.year}. ${identity.month}. ${identity.day}.`
          : `${identity.month}/${identity.day}/${identity.year}`;
        const normalizedKoreanBirthField =
          isKoreanBirthField ||
          KOREAN_BIRTHDAY_HINT_RE.test(birthFingerprint) ||
          KOREAN_AGE_GATE_HEADING_RE.test(
            document.querySelector("h1")?.textContent || "",
          );
        const expectedDigits = normalizedKoreanBirthField
          ? `${identity.year}${identity.month}${identity.day}`
          : `${identity.month}${identity.day}${identity.year}`;
        if (normalizedKoreanBirthField) {
          await typeMaskedInputLikeKeyboard(birthEl, expectedDigits);
          await sleep(120);
          const currentDigits = String(birthEl.value || "").replace(/\D/g, "");
          if (currentDigits !== expectedDigits) {
            typeInputLikeUser(
              birthEl,
              `${identity.year}. ${identity.month}. ${identity.day}.`,
            );
          }
        } else {
          typeInputLikeUser(birthEl, birthText);
        }
        const current = String(birthEl.value || "");
        if (current.replace(/\D/g, "").length < 8) {
          typeStripe(birthEl, expectedDigits);
        }
      }
      return { dobFilled: true };
    }
  }
  return { dobFilled: false };
}

function tickAgeGateConsentIfPresent() {
  const byName = qs([
    'input[type="checkbox"][name="allCheckboxes"]',
    'input[type="checkbox"][id*="allCheckboxes" i]',
  ]);

  const byText = Array.from(
    document.querySelectorAll('input[type="checkbox"]'),
  ).find((el) => {
    const label = el.closest("label");
    const txt = String(label?.innerText || "");
    return matchesUiPatterns(txt, CONSENT_ALL_PATTERNS);
  });

  const cb = byName || byText;
  if (!cb || cb.checked) return false;

  const target = cb.closest("label") || cb;
  clickLikeMouse(target);

  if (!cb.checked) {
    cb.checked = true;
    cb.dispatchEvent(new Event("input", { bubbles: true }));
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return !!cb.checked;
}

// CLICK ÃƒÂ¢Ã¢â‚¬ËœÃ‚Â  ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Quick Pass: Ãƒâ€žÃ¢â‚¬ËœiÃƒÂ¡Ã‚Â»Ã‚Ân / copy ngay, khÃƒÆ’Ã‚Â´ng cÃƒÂ¡Ã‚ÂºÃ‚Â§n panel
// ============================================================
async function handleQuickPassClick() {
  const data = await storageLocalGet([
    "useTempMail",
    "lastTempMailAddress",
    "passes",
    "passIndex",
  ]);

  let email = "";
  let pass = AUTO_PASSWORD_VALUE || generateRandomPassword();
  let progressLabel = "TempMail";

  if (data.useTempMail && data.lastTempMailAddress?.email) {
    email = data.lastTempMailAddress.email;
  } else {
    const passes = String(data.passes || "")
      .split("\n")
      .filter((l) => l.trim());
    const pi = Number(data.passIndex || 0);

    if (!passes.length) {
      toast("Chua co email: tao TempMail hoac nhap danh sach Pass.", "#e67e22");
      return;
    }

    const picked = (passes[pi] || passes[passes.length - 1]).trim();
    const lastDot = picked.lastIndexOf(".");
    email = picked;
    pass = lastDot >= 0 ? picked.substring(0, lastDot) : picked;
    progressLabel = `${Math.min(pi + 1, passes.length)}/${passes.length}`;
    await storageLocalSet({ passIndex: pi + 1 });
  }

  const passEl = findVisiblePasswordField();
  const emailEl = findVisibleEmailField();
  let filled = false;

  if (emailEl) {
    typeInto(emailEl, email);
    filled = true;
  }
  if (passEl) {
    typeInto(passEl, pass);
    filled = true;
  }

  if (!filled) {
    await navigator.clipboard.writeText(email);
    toast(`Copied email: ${email}`, "#27ae60");
    return;
  }

  toast(`Filled (${progressLabel}) ${email}`, "#27ae60");
}

// ============================================================
// CLICK ÃƒÂ¢Ã¢â‚¬ËœÃ‚Â¡ ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Pass: hiÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡n mini panel
// ============================================================
async function handlePassClick() {
  const config = await storageLocalGet(["useTempMail", "passes", "passIndex"]);

  // Check if TempMail is enabled
  if (config.useTempMail) {
    const tempMailEmail = await getCurrentTempMailEmailForAutofill();
    if (tempMailEmail) {
      // Use TempMail email with current or random password
      const pass = AUTO_PASSWORD_VALUE || generateRandomPassword();
      showPassPanel(tempMailEmail, pass, 1, 1);
      return;
    }
    // Fall back to manual passes if TempMail fails
  }

  // Use manual passes
  const passes = (config.passes || "").split("\n").filter((l) => l.trim());
  const pi = config.passIndex || 0;

  if (!passes.length) {
    showPassPanel(null, null, 0, 0);
    return;
  }

  const email = (passes[pi] || passes[passes.length - 1]).trim();
  const lastDot = email.lastIndexOf(".");
  const pass = lastDot >= 0 ? email.substring(0, lastDot) : email;
  const index = Math.min(pi, passes.length - 1);

  showPassPanel(email, pass, index + 1, passes.length);
}

function showPassPanel(email, pass, cur, total) {
  // XÃƒÆ’Ã‚Â³a panel cÃƒâ€¦Ã‚Â© nÃƒÂ¡Ã‚ÂºÃ‚Â¿u cÃƒÆ’Ã‚Â³
  const old = document.getElementById("af-pass-panel");
  if (old) {
    old.remove();
    return;
  }

  const panel = document.createElement("div");
  panel.id = "af-pass-panel";
  panel.setAttribute("data-af-ui-root", "1");
  panel.style.cssText = `
    position: fixed;
    bottom: 65px;
    right: 20px;
    z-index: 2147483647;
    background: rgba(10, 14, 32, 0.97);
    border: 1px solid #8e44ad;
    border-radius: 14px;
    padding: 14px 16px;
    min-width: 280px;
    max-width: 360px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    font-family: 'Segoe UI', Arial, sans-serif;
    backdrop-filter: blur(10px);
    color: #e0e0e0;
  `;

  isolateFloatingUIEvents(panel);

  if (!email) {
    panel.innerHTML = `
      <div style="font-size:13px; color:#aaa; text-align:center">ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â ChÃƒâ€ Ã‚Â°a cÃƒÆ’Ã‚Â³ email!<br><small>MÃƒÂ¡Ã‚Â»Ã…Â¸ popup ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Tab ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Ëœ Pass ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ dÃƒÆ’Ã‚Â¡n danh sÃƒÆ’Ã‚Â¡ch emaili</small></div>
    `;
  } else {
    const passInput = `af-pass-val-${Date.now()}`;
    panel.innerHTML = `
      <div style="font-size:11px; color:#8e44ad; font-weight:700; margin-bottom:8px; text-transform:uppercase; letter-spacing:.5px">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Ëœ Pass tiÃƒÂ¡Ã‚ÂºÃ‚Â¿p theo (${cur}/${total})</div>
      <div style="font-size:11px; color:#888; margin-bottom:2px;">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â§ Email:</div>
      <div style="font-family:monospace; font-size:12px; color:#7fb3f5; margin-bottom:8px; word-break:break-all">${email}</div>
      <div style="font-size:11px; color:#888; margin-bottom:2px">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢ Pass:</div>
      <input id="${passInput}" value="${pass}" style="
        width:100%; padding:7px 10px; background:#16213e;
        border:1px solid #8e44ad; border-radius:8px;
        color:#c39bd3; font:700 13px monospace;
        outline:none; margin-bottom:10px; box-sizing:border-box;
      ">
      <div style="display:flex; gap:8px;">
        <button id="af-cp-btn" style="
          flex:1; padding:8px; background:#8e44ad; color:#fff;
          border:none; border-radius:8px; font:700 12px sans-serif;
          cursor:pointer;">&#x1F4CB; Copy</button>
        <button id="af-fill-btn" style="
          flex:1; padding:8px; background:#e94560; color:#fff;
          border:none; border-radius:8px; font:700 12px sans-serif;
          cursor:pointer;">&#x2B07;&#xFE0F; Ãƒâ€žÃ‚ÂiÃƒÂ¡Ã‚Â»Ã‚Ân vÃƒÆ’Ã‚Â o ÃƒÆ’Ã‚Â´</button>
        <button id="af-skip-btn" style="
          padding:8px 12px; background:#0f3460; color:#aaa;
          border:none; border-radius:8px; font:700 12px sans-serif;
          cursor:pointer;">ÃƒÂ¢Ã…Â¾Ã‚Â¡ÃƒÂ¯Ã‚Â¸Ã‚Â Skip</button>
      </div>
    `;

    setTimeout(() => {
      const inp = document.getElementById(passInput);

      // Copy
      document.getElementById("af-cp-btn").addEventListener("click", () => {
        const v = inp ? inp.value : pass;
        navigator.clipboard.writeText(v).then(() => {
          toast(`ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Â¹ ${v}`, "#8e44ad");
          panel.remove();
          advancePass();
        });
      });

      // Fill vÃƒÆ’Ã‚Â o ÃƒÆ’Ã‚Â´
      document.getElementById("af-fill-btn").addEventListener("click", () => {
        const v = inp ? inp.value : pass;
        const passEl = findVisiblePasswordField();
        const emailEl = findVisibleEmailField();
        if (emailEl) typeInto(emailEl, email);
        if (passEl) typeInto(passEl, v);
        if (!passEl && !emailEl) {
          toast(
            "ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â KhÃƒÆ’Ã‚Â´ng tÃƒÆ’Ã‚Â¬m thÃƒÂ¡Ã‚ÂºÃ‚Â¥y ÃƒÆ’Ã‚Â´ pass!",
            "#e67e22",
          );
        } else {
          toast(`ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Ãƒâ€žÃ‚ÂiÃƒÂ¡Ã‚Â»Ã‚Ân: ${v}`, "#27ae60");
          panel.remove();
          advancePass();
        }
      });

      // Skip
      document.getElementById("af-skip-btn").addEventListener("click", () => {
        panel.remove();
        advancePass();
        toast(
          "ÃƒÂ¢Ã…Â¾Ã‚Â¡ÃƒÂ¯Ã‚Â¸Ã‚Â Sang pass kÃƒÂ¡Ã‚ÂºÃ‚Â¿ tiÃƒÂ¡Ã‚ÂºÃ‚Â¿p!",
          "#555",
        );
      });
    }, 50);
  }

  document.body.appendChild(panel);
  makeFloatingMovable(panel, {
    noDragSelector: "button, input, textarea, select",
  });

  // Click ngoÃƒÆ’Ã‚Â i ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Ãƒâ€žÃ¢â‚¬ËœÃƒÆ’Ã‚Â³ng
  setTimeout(() => {
    document.addEventListener("click", function outsideClick(e) {
      if (!panel.contains(e.target) && e.target.id !== "af-btn-pass") {
        panel.remove();
        document.removeEventListener("click", outsideClick);
      }
    });
  }, 100);
}

function advancePass() {
  chrome.storage.local.get(["passIndex"], (d) => {
    chrome.storage.local.set({ passIndex: (d.passIndex || 0) + 1 });
  });
}

// ============================================================
// ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â DATA PANEL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â nhÃƒÂ¡Ã‚ÂºÃ‚Â­p liÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡u ngay trÃƒÆ’Ã‚Âªn trang, khÃƒÆ’Ã‚Â´ng cÃƒÂ¡Ã‚ÂºÃ‚Â§n popup
// ============================================================
function handleDataPanel() {
  const existing = document.getElementById("af-data-panel");
  if (existing) {
    existing.remove();
    return;
  }

  const panel = document.createElement("div");
  panel.id = "af-data-panel";
  panel.style.cssText = `
    position:fixed;bottom:65px;right:20px;z-index:2147483647;
    background:rgba(10,14,32,0.97);border:1px solid #2980b9;
    border-radius:16px;padding:16px;width:360px;
    box-shadow:0 10px 40px rgba(0,0,0,.7);
    font-family:'Segoe UI',Arial,sans-serif;color:#e0e0e0;
    backdrop-filter:blur(10px);
  `;

  panel.innerHTML = `
    <div id="af-dp-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;user-select:none;cursor:move">
      <span style="font:700 13px sans-serif;color:#2980b9">&#x1F4DD; B&#x1ED9; sinh d&#x1EEF; li&#x1EC7;u nhanh</span>
      <button id="af-dp-close" style="all:unset;cursor:pointer;color:#666;font-size:18px">&#x2715;</button>
    </div>
    <!-- Tabs -->
    <div id="af-dp-tabs" style="display:flex;gap:4px;margin-bottom:10px">
      <button class="af-dp-tab" data-tab="card" data-color="#e94560" style="all:unset;cursor:pointer;padding:5px 12px;border-radius:20px;font:700 11px sans-serif;background:#e94560;color:#fff">&#x1F4B3; Th&#x1EBB;</button>
      <button class="af-dp-tab" data-tab="addr" data-color="#27ae60" style="all:unset;cursor:pointer;padding:5px 12px;border-radius:20px;font:700 11px sans-serif;background:#0f3460;color:#888">&#x1F4E6; &#x110;&#x1ECB;a ch&#x1EC9;</button>
      <button class="af-dp-tab" data-tab="pass" data-color="#8e44ad" style="all:unset;cursor:pointer;padding:5px 12px;border-radius:20px;font:700 11px sans-serif;background:#0f3460;color:#888">&#x1F511; Pass</button>
    </div>

    <!-- Card panel -->
    <div id="af-dp-card">
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="af-dp-card-bin" type="text" style="flex:1;background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:5px 8px;font:12px monospace" placeholder="Nhap dau so (vd: 4, 34, 62) hoac n:20">
        <button id="af-dp-card-gen" style="all:unset;cursor:pointer;padding:5px 12px;background:#e94560;border-radius:6px;font:700 11px sans-serif;color:#fff">SANDBOX</button>
      </div>
      <textarea id="af-dp-card-txt" rows="5" style="width:100%;background:#0f3460;border:1px solid #1a4a8a;border-radius:8px;color:#e0e0e0;font:12px monospace;padding:8px;resize:none;outline:none;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button id="af-dp-card-save" style="all:unset;flex:1;cursor:pointer;padding:7px;background:#e94560;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff">&#x1F4BE; L&#x01B0;u v&#x00E0;o Autofill</button>
        <button id="af-dp-card-reset" style="all:unset;cursor:pointer;padding:7px 12px;background:#0f3460;border-radius:8px;font:700 12px sans-serif;color:#aaa">&#x1F504;</button>
      </div>
      <div id="af-dp-card-stat" style="font:11px sans-serif;color:#888;margin-top:4px;text-align:center"></div>
    </div>

    <!-- Address panel -->
    <div id="af-dp-addr" style="display:none">
      <div style="margin-bottom:6px">
        <select id="af-dp-addr-mode" style="width:100%;background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#e0e0e0;padding:6px 8px;font:12px sans-serif;outline:none">
          <option value="random_kr_indo_mix">Default KR top + Indo random</option>
          <option value="random_us_indo_mix">Random US top + Indo random</option>
          <option value="random_uk_indo_mix">Random UK top + Indo random</option>
          <option value="random_kr">Random KR</option>
          <option value="random_us">Random US</option>
          <option value="random_uk">Random UK</option>
          <option value="random_jp">Random JP</option>
          <option value="random_indonesia">Random Indonesia</option>
          <option value="random_india">Random India</option>
          <option value="random_algeria">Random Algeria</option>
          <option value="random_kazakhstan">Random Kazakhstan</option>
          <option value="random_chile">Random Chile</option>
          <option value="random_any" style="font-weight:bold;color:#e74c3c">Random Any (Global)</option>
          <option value="fixed_kr">Fixed KR</option>
          <option value="fixed_us">Fixed US</option>
          <option value="fixed_uk">Fixed UK</option>
          <option value="fixed_jp">Fixed JP</option>
          <option value="fixed_indonesia">Fixed Indonesia</option>
          <option value="fixed_india">Fixed India</option>
          <option value="fixed_algeria">Fixed Algeria</option>
          <option value="fixed_kazakhstan">Fixed Kazakhstan</option>
          <option value="fixed_chile">Fixed Chile</option>
        </select>
      </div>
       <div style="margin-bottom:6px">
        <button id="af-dp-addr-gen" style="all:unset;width:100%;cursor:pointer;padding:6px;background:#27ae60;border-radius:6px;font:700 11px sans-serif;color:#fff;text-align:center">T&#x1EA0;O 10 &#x110;&#x1ECA;A CH&#x1EC8; M&#x1EAA;U</button>
      </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <input id="af-dp-addr-name" type="text" style="background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px sans-serif;outline:none" placeholder="Name">
          <input id="af-dp-addr-country" type="text" style="background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px sans-serif;outline:none" placeholder="Country">
          <input id="af-dp-addr-state" type="text" style="background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px sans-serif;outline:none" placeholder="State/Province">
          <input id="af-dp-addr-city" type="text" style="background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px sans-serif;outline:none" placeholder="City">
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px;margin-bottom:6px">
          <input id="af-dp-addr-address" type="text" style="background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px sans-serif;outline:none" placeholder="Street address">
          <input id="af-dp-addr-postal" type="text" style="background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px sans-serif;outline:none" placeholder="ZIP/Postal">
        </div>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button id="af-dp-addr-add-line" style="all:unset;flex:1;cursor:pointer;padding:6px;background:#16a085;border-radius:6px;font:700 11px sans-serif;color:#fff;text-align:center">+ Them vao danh sach</button>
          <button id="af-dp-addr-replace" style="all:unset;flex:1;cursor:pointer;padding:6px;background:#8e44ad;border-radius:6px;font:700 11px sans-serif;color:#fff;text-align:center">Chi dung dong nay</button>
          <button id="af-dp-addr-load-first" style="all:unset;cursor:pointer;padding:6px 10px;background:#0f3460;border-radius:6px;font:700 11px sans-serif;color:#aaa">Lay dong 1</button>
        </div>
      <textarea id="af-dp-addr-txt" rows="5" style="width:100%;background:#0f3460;border:1px solid #1a4a8a;border-radius:8px;color:#e0e0e0;font:12px monospace;padding:8px;resize:none;outline:none;box-sizing:border-box" placeholder="김민서|Seoul|Seoul|43, Noksapyeong-daero 26-gil|04345&#10;John Carter|California|Los Angeles|845 S Figueroa St|90017&#10;Oliver Smith|England|London|63 Lower White Road|B32 2RU&#10;Taro Sato|Tokyo|Tokyo|1-1 Chiyoda|100-0001"></textarea>
      <div style="font:11px sans-serif;color:#666;margin-top:4px">Fixed mode lay dong dau tien. Random mode dung pool co san theo quoc gia.</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button id="af-dp-addr-save" style="all:unset;flex:1;cursor:pointer;padding:7px;background:#27ae60;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff">&#x1F4BE; L&#x01B0;u v&#x00E0;o Autofill</button>
        <button id="af-dp-addr-reset" style="all:unset;cursor:pointer;padding:7px 12px;background:#0f3460;border-radius:8px;font:700 12px sans-serif;color:#aaa">&#x1F504;</button>
      </div>
      <div id="af-dp-addr-stat" style="font:11px sans-serif;color:#888;margin-top:4px;text-align:center"></div>
    </div>

    <div id="af-dp-pass" style="display:none">
      <textarea id="af-dp-pass-txt" rows="4" style="width:100%;background:#0f3460;border:1px solid #1a4a8a;border-radius:8px;color:#e0e0e0;font:12px monospace;padding:8px;resize:none;outline:none;box-sizing:border-box" placeholder="vinhteam23@chatgptku.pro&#10;vinhteam25@chatgptku.pro"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button id="af-dp-pass-convert" style="all:unset;flex:1;cursor:pointer;padding:7px;background:#8e44ad;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff">&#x1F504; Chuy&#x1EC3;n &#x0111;&#x1ED5;i</button>
        <button id="af-dp-pass-save"    style="all:unset;cursor:pointer;padding:7px 10px;background:#27ae60;border-radius:8px;font:700 12px sans-serif;color:#fff">&#x1F4BE; L&#x01B0;u Pass</button>
        <button id="af-dp-pass-reset"   style="all:unset;cursor:pointer;padding:7px 10px;background:#0f3460;border-radius:8px;font:700 12px sans-serif;color:#aaa">&#x1F504;</button>
      </div>
      <div id="af-dp-pass-stat" style="font:11px sans-serif;color:#888;margin-top:4px;text-align:center"></div>
      <!-- K&#x1EBF;t qu&#x1EA3; chuy&#x1EC3;n &#x0111;&#x1ED5;i -->
      <div id="af-dp-pass-results" style="margin-top:8px;display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font:700 11px sans-serif;color:#8e44ad">K&#x1EBF;t qu&#x1EA3;:</span>
          <button id="af-dp-pass-copyall" style="all:unset;cursor:pointer;padding:4px 10px;background:#8e44ad;border-radius:6px;font:700 11px sans-serif;color:#fff">&#x1F4CB; Copy All</button>
        </div>
        <div id="af-dp-pass-list" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  makeFloatingMovable(panel, {
    handleSelector: "#af-dp-drag-handle",
    noDragSelector: "button, input, textarea, select",
  });

  // Load dÃƒÂ¡Ã‚Â»Ã‚Â¯ liÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡u hiÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡n tÃƒÂ¡Ã‚ÂºÃ‚Â¡i
  const addrModeEl = document.getElementById("af-dp-addr-mode");
  const addrTxtEl = document.getElementById("af-dp-addr-txt");
  const addrGenBtn = document.getElementById("af-dp-addr-gen");
  const addrNameEl = document.getElementById("af-dp-addr-name");
  const addrCountryEl = document.getElementById("af-dp-addr-country");
  const addrStateEl = document.getElementById("af-dp-addr-state");
  const addrCityEl = document.getElementById("af-dp-addr-city");
  const addrAddressEl = document.getElementById("af-dp-addr-address");
  const addrPostalEl = document.getElementById("af-dp-addr-postal");

  function getAddressPlaceholderForMode(mode) {
    if (mode === "random_any") {
      return "Random Any Country se lay ngau nhien 1 nuoc trong danh sach khi Fill...";
    }
    if (isKrIndoMixAddressMode(mode)) {
      return "John Vinh|South Korea|Seoul|Sidoarjo|Jl. Sudirman No. 52|61212";
    }
    if (isUsIndoMixAddressMode(mode)) {
      return "John Carter|United States|California|Sidoarjo|Jl. Pahlawan No. 31|61212";
    }
    if (isUkIndoMixAddressMode(mode)) {
      return "Oliver Smith|United Kingdom|England|Sidoarjo|Jl. Sudirman No. 52|61212";
    }
    if (isChileAddressMode(mode)) {
      return "Matias Gonzalez|Santiago Metropolitan|Santiago|123 Avenida Libertador Bernardo O'Higgins|8320000";
    }
    if (isKazakhstanAddressMode(mode)) {
      return "Aruzhan Bek|Almaty|Almaty|63 Abylai Khan Ave|050000";
    }
    if (isAlgeriaAddressMode(mode)) {
      return "Yacine Benali|Algiers Province|Algiers|12 Rue Didouche Mourad|16000";
    }
    if (isIndonesiaAddressMode(mode)) {
      return "Budi Santoso|Indonesia|Jawa Timur|Sidoarjo|Jl. Pahlawan No. 31|61212";
    }
    if (isIndiaAddressMode(mode)) {
      return "Arjun Mehta|Karnataka|Bengaluru|24 Church Street|560001";
    }
    if (isJapanAddressMode(mode)) {
      return "Taro Sato|Tokyo|Tokyo|1-1 Chiyoda|100-0001";
    }
    if (isUkAddressMode(mode)) {
      return "Oliver Smith|England|London|63 Lower White Road|B32 2RU";
    }
    if (isUsAddressMode(mode)) {
      return "John Carter|California|Los Angeles|845 S Figueroa St|90017";
    }
    return "김민서|Seoul|Seoul|43, Noksapyeong-daero 26-gil|04345";
  }

  function updateAddrModeUi(mode) {
    const normalizedMode = normalizeAddressMode(mode);
    if (addrModeEl) addrModeEl.value = normalizedMode;
    if (addrTxtEl)
      addrTxtEl.placeholder = getAddressPlaceholderForMode(normalizedMode);
    if (addrCountryEl && !String(addrCountryEl.value || "").trim()) {
      addrCountryEl.value = getDefaultCountryForMode(normalizedMode);
    }
    if (addrGenBtn) {
      addrGenBtn.textContent =
        normalizedMode === "random_any"
          ? "TAO 10 DIA CHI MAU (MIX)"
          : isKrIndoMixAddressMode(normalizedMode)
            ? "DEFAULT KR TOP + ID RANDOM"
            : isUsIndoMixAddressMode(normalizedMode)
              ? "US TOP + ID RANDOM"
              : isUkIndoMixAddressMode(normalizedMode)
                ? "UK TOP + ID RANDOM"
            : isChileAddressMode(normalizedMode)
              ? "TAO 10 DIA CHI MAU CL"
              : isKazakhstanAddressMode(normalizedMode)
                ? "TAO 10 DIA CHI MAU KZ"
                : isAlgeriaAddressMode(normalizedMode)
                  ? "TAO 10 DIA CHI MAU DZ"
                  : isIndonesiaAddressMode(normalizedMode)
                    ? "TAO 10 DIA CHI MAU ID"
                    : isIndiaAddressMode(normalizedMode)
                      ? "TAO 10 DIA CHI MAU IN"
                      : isJapanAddressMode(normalizedMode)
                        ? "TAO 10 DIA CHI MAU JP"
                        : isUkAddressMode(normalizedMode)
                          ? "TAO 10 DIA CHI MAU UK"
                          : isUsAddressMode(normalizedMode)
                            ? "TAO 10 DIA CHI MAU US"
                            : "TAO 10 DIA CHI MAU KR";
    }
  }

  function cleanPipeInput(v) {
    return String(v || "")
      .replace(/\|+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildAddressLineFromQuickForm() {
    const name = cleanPipeInput(addrNameEl?.value || "");
    const country = cleanPipeInput(addrCountryEl?.value || "");
    const state = cleanPipeInput(addrStateEl?.value || "");
    const city = cleanPipeInput(addrCityEl?.value || "");
    const address = cleanPipeInput(addrAddressEl?.value || "");
    const postal = cleanPipeInput(addrPostalEl?.value || "");

    if (!state || !city || !address || !postal) {
      toast("Can nhap it nhat State, City, Address, Postal.", "#e67e22");
      return "";
    }
    return [name, country, state, city, address, postal].join("|");
  }

  function loadQuickFormFromAddressLine(line) {
    const parts = String(line || "")
      .split("|")
      .map((p) => p.trim());
    if (!parts.length) return;
    if (addrNameEl) addrNameEl.value = parts[0] || "";
    if (addrCountryEl) addrCountryEl.value = parts[1] || "";
    if (addrStateEl) addrStateEl.value = parts[2] || "";
    if (addrCityEl) addrCityEl.value = parts[3] || "";
    if (addrAddressEl) addrAddressEl.value = parts[4] || "";
    if (addrPostalEl) addrPostalEl.value = parts[5] || "";
  }

  if (addrModeEl) {
    addrModeEl.addEventListener("change", () => {
      const mode = normalizeAddressMode(addrModeEl.value);
      updateAddrModeUi(mode);
      chrome.storage.local.set({
        addressMode: mode,
        lockedAddrData: null,
        lockedAddrMode: "",
      });
    });
  }

  chrome.storage.local.get(
    [
      "cards",
      "addresses",
      "passes",
      "cardIndex",
      "addrIndex",
      "passIndex",
      "lastBin",
      "addressMode",
    ],
    (d) => {
      const safeGet = (id) =>
        panel.isConnected ? document.getElementById(id) : null;
      const setValueIfPresent = (id, value) => {
        const el = safeGet(id);
        if (el) el.value = value;
      };
      const setTextIfPresent = (id, value) => {
        const el = safeGet(id);
        if (el) el.textContent = value;
      };

      if (d.cards) setValueIfPresent("af-dp-card-txt", d.cards);
      if (d.addresses) setValueIfPresent("af-dp-addr-txt", d.addresses);
      if (d.passes) setValueIfPresent("af-dp-pass-txt", d.passes);
      if (d.lastBin) setValueIfPresent("af-dp-card-bin", d.lastBin);
      updateAddrModeUi(d.addressMode);
      const firstAddrLine = String(d.addresses || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      if (firstAddrLine) loadQuickFormFromAddressLine(firstAddrLine);

      const cs = (d.cards || "").split("\n").filter((l) => l.trim()).length;
      const as = (d.addresses || "").split("\n").filter((l) => l.trim()).length;
      const ps = (d.passes || "").split("\n").filter((l) => l.trim()).length;
      setTextIfPresent(
        "af-dp-card-stat",
        `\u0110\u00e3 d\u00f9ng: ${d.cardIndex || 0}/${cs}`,
      );
      setTextIfPresent(
        "af-dp-addr-stat",
        `\u0110\u00e3 d\u00f9ng: ${d.addrIndex || 0}/${as}`,
      );
      setTextIfPresent(
        "af-dp-pass-stat",
        `\u0110\u00e3 d\u00f9ng: ${d.passIndex || 0}/${ps}`,
      );
    },
  );

  // Tab switching
  panel.querySelectorAll(".af-dp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".af-dp-tab").forEach((t) => {
        t.style.background = "#0f3460";
        t.style.color = "#888";
      });
      tab.style.background = tab.dataset.color;
      tab.style.color = "#fff";
      ["card", "addr", "pass"].forEach((n) => {
        document.getElementById(`af-dp-${n}`).style.display =
          n === tab.dataset.tab ? "block" : "none";
      });
    });
  });

  // Save + Reset helpers
  function bindSR(storKey, idxKey, tabId, statId) {
    document
      .getElementById(`af-dp-${tabId}-save`)
      .addEventListener("click", () => {
        const val = document.getElementById(`af-dp-${tabId}-txt`).value.trim();
        const savePayload = { [storKey]: val, [idxKey]: 0 };
        if (tabId === "addr") {
          savePayload.lockedAddrData = null;
          savePayload.lockedAddrMode = "";
        }
        chrome.storage.local.set(savePayload, () => {
          const cnt = val.split("\n").filter((l) => l.trim()).length;
          const statEl = document.getElementById(statId);
          if (statEl) {
            statEl.textContent = `\u2705 \u0110\u00e3 l\u01b0u ${cnt} d\u00f2ng`;
          }
          setTimeout(() => {
            const nextStatEl = document.getElementById(statId);
            if (nextStatEl) {
              nextStatEl.textContent = `\u0110\u00e3 d\u00f9ng: 0/${cnt}`;
            }
          }, 2000);
        });
      });
    document
      .getElementById(`af-dp-${tabId}-reset`)
      .addEventListener("click", () => {
        const resetPayload = { [idxKey]: 0 };
        if (tabId === "addr") {
          resetPayload.lockedAddrData = null;
          resetPayload.lockedAddrMode = "";
        }
        chrome.storage.local.set(resetPayload, () => {
          const statEl = document.getElementById(statId);
          if (statEl) statEl.textContent = "\u1F504 Reset v\u1EC1 0";
        });
      });
  }
  bindSR("cards", "cardIndex", "card", "af-dp-card-stat");
  bindSR("addresses", "addrIndex", "addr", "af-dp-addr-stat");

  // Logic TU SINH THE SANDBOX
  const binInput = document.getElementById("af-dp-card-bin");
  const cardTxt = document.getElementById("af-dp-card-txt");

  function fastGenCards() {
    const raw = String(binInput.value || "").trim();
    let count = 15;
    let prefix = "";

    const countMatch = raw.match(/^n\s*:\s*(\d{1,3})$/i);
    if (countMatch) {
      count = Math.max(1, Math.min(Number.parseInt(countMatch[1], 10), 60));
    } else {
      const digitsOnly = raw.replace(/\D/g, "");
      if (digitsOnly) {
        prefix = digitsOnly;
      }
    }

    let pool = SANDBOX_TEST_CARD_LINES.slice();
    if (prefix) {
      const matched = pool.filter((line) => line.startsWith(prefix));
      if (matched.length) {
        pool = matched;
      } else {
        toast("Khong co sandbox card khop dau so nay.", "#e67e22");
      }
    }

    const startOffset = Number(Date.now() % pool.length);
    const res = [];
    for (let i = 0; i < count; i++) {
      res.push(pool[(startOffset + i) % pool.length]);
    }
    cardTxt.value = res.join("\n");
    chrome.storage.local.set({ lastBin: raw || String(count) });
  }

  binInput.addEventListener("input", fastGenCards);
  document
    .getElementById("af-dp-card-gen")
    .addEventListener("click", fastGenCards);

  // Logic tao mau dia chi theo mode hien tai
  document.getElementById("af-dp-addr-gen").addEventListener("click", () => {
    let selectedMode = normalizeAddressMode(addrModeEl?.value);

    let res = [];
    for (let i = 0; i < 10; i++) {
      let sampleMode = selectedMode;
      if (selectedMode === "random_any") {
        const allModes = [
          "random_kr",
          "random_us_indo_mix",
          "random_uk_indo_mix",
          "random_us",
          "random_uk",
          "random_jp",
          "random_indonesia",
          "random_india",
          "random_algeria",
          "random_kazakhstan",
          "random_chile",
        ];
        sampleMode = allModes[Math.floor(Math.random() * allModes.length)];
      }

      const effectiveSampleMode = isChileAddressMode(sampleMode)
        ? ADDRESS_MODE_RANDOM_CHILE
        : isKazakhstanAddressMode(sampleMode)
          ? ADDRESS_MODE_RANDOM_KAZAKHSTAN
          : isAlgeriaAddressMode(sampleMode)
            ? ADDRESS_MODE_RANDOM_ALGERIA
          : isUsIndoMixAddressMode(sampleMode)
            ? ADDRESS_MODE_RANDOM_US_INDO_MIX
            : isUkIndoMixAddressMode(sampleMode)
              ? ADDRESS_MODE_RANDOM_UK_INDO_MIX
            : isIndonesiaAddressMode(sampleMode)
              ? ADDRESS_MODE_RANDOM_INDONESIA
              : isIndiaAddressMode(sampleMode)
                ? ADDRESS_MODE_RANDOM_INDIA
                : isJapanAddressMode(sampleMode)
                  ? ADDRESS_MODE_RANDOM_JP
                  : isUkAddressMode(sampleMode)
                    ? ADDRESS_MODE_RANDOM_UK
                    : isUsAddressMode(sampleMode)
                      ? ADDRESS_MODE_RANDOM_US
                      : ADDRESS_MODE_RANDOM_KR;

      const name = getRandomNameForMode(
        effectiveSampleMode,
        randomGlobalLatinName(),
      );
      const addr = buildRandomAddress(name, "", effectiveSampleMode);
      res.push(
        `${addr.name}|${addr.country}|${addr.state}|${addr.city}|${addr.address}|${addr.postal}`,
      );
    }
    document.getElementById("af-dp-addr-txt").value = res.join("\n");
    toast(
      `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ \u0110\u00e3 t\u1ef1 sinh 10 \u0111\u1ecba ch\u1ec9!`,
      "#27ae60",
    );
  });

  document
    .getElementById("af-dp-addr-add-line")
    .addEventListener("click", () => {
      const line = buildAddressLineFromQuickForm();
      if (!line) return;
      const cur = String(addrTxtEl?.value || "").trim();
      addrTxtEl.value = cur ? `${cur}\n${line}` : line;
      toast("Da them dia chi vao danh sach.", "#27ae60");
    });

  document
    .getElementById("af-dp-addr-replace")
    .addEventListener("click", () => {
      const line = buildAddressLineFromQuickForm();
      if (!line) return;
      addrTxtEl.value = line;
      toast("Da doi sang 1 dong dia chi hien tai.", "#8e44ad");
    });

  document
    .getElementById("af-dp-addr-load-first")
    .addEventListener("click", () => {
      const firstLine = String(addrTxtEl?.value || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      if (!firstLine) {
        toast("Danh sach dia chi dang trong.", "#e67e22");
        return;
      }
      loadQuickFormFromAddressLine(firstLine);
      toast("Da lay du lieu tu dong dau tien.", "#2980b9");
    });

  // Pass tab: Save riÃƒÆ’Ã‚Âªng (khÃƒÆ’Ã‚Â´ng dÃƒÆ’Ã‚Â¹ng bindSR vÃƒÆ’Ã‚Â¬ cÃƒÆ’Ã‚Â³ thÃƒÆ’Ã‚Âªm convert UI)
  document.getElementById("af-dp-pass-save").addEventListener("click", () => {
    const val = document.getElementById("af-dp-pass-txt").value.trim();
    // NÃƒÂ¡Ã‚ÂºÃ‚Â¿u cÃƒÆ’Ã‚Â³ ----, chÃƒÂ¡Ã‚Â»Ã¢â‚¬Â° lÃƒÂ¡Ã‚ÂºÃ‚Â¥y phÃƒÂ¡Ã‚ÂºÃ‚Â§n email (trÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã¢â‚¬Âºc ----)
    const cleaned = val
      .split("\n")
      .map((l) => {
        const line = l.trim();
        return line.includes("----") ? line.split("----")[0].trim() : line;
      })
      .filter((l) => l)
      .join("\n");
    chrome.storage.local.set({ passes: cleaned, passIndex: 0 }, () => {
      const cnt = cleaned.split("\n").filter((l) => l.trim()).length;
      const passStatEl = document.getElementById("af-dp-pass-stat");
      if (passStatEl) {
        passStatEl.textContent = `\u2705 L\u01b0u ${cnt} email`;
      }
    });
  });
  document.getElementById("af-dp-pass-reset").addEventListener("click", () => {
    chrome.storage.local.set({ passIndex: 0 }, () => {
      const passStatEl = document.getElementById("af-dp-pass-stat");
      if (passStatEl) {
        passStatEl.textContent = "\u1F504 Reset v\u1ec1 0";
      }
    });
  });

  // Convert button: chuyÃƒÂ¡Ã‚Â»Ã†â€™n Ãƒâ€žÃ¢â‚¬ËœÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¢i email ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ format ----
  document
    .getElementById("af-dp-pass-convert")
    .addEventListener("click", () => {
      const raw = document.getElementById("af-dp-pass-txt").value.trim();
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l);
      if (!lines.length) return;

      const results = lines.map((email) => {
        const clean = email.includes("----")
          ? email.split("----")[0].trim()
          : email;
        const lastDot = clean.lastIndexOf(".");
        const noTLD = lastDot >= 0 ? clean.substring(0, lastDot) : clean;
        return `${clean}----${noTLD}----https://generator.email/${clean}`;
      });

      const listEl = document.getElementById("af-dp-pass-list");
      listEl.innerHTML = "";
      results.forEach((r, i) => {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:4px;background:#0f3460;border-radius:6px;padding:4px 6px";
        row.innerHTML = `
        <span style="flex:1;font:11px monospace;color:#c39bd3;word-break:break-all">${r}</span>
        <button data-val="${r}" style="all:unset;cursor:pointer;padding:3px 8px;background:#8e44ad;border-radius:5px;font:700 10px sans-serif;color:#fff;white-space:nowrap">&#x1F4CB;</button>
      `;
        row.querySelector("button").addEventListener("click", function () {
          navigator.clipboard
            .writeText(this.dataset.val)
            .then(() => toast("\u1F4CB Copied!", "#8e44ad"));
        });
        listEl.appendChild(row);
      });

      document.getElementById("af-dp-pass-results").style.display = "block";

      // Copy All
      document.getElementById("af-dp-pass-copyall").onclick = () => {
        navigator.clipboard
          .writeText(results.join("\n"))
          .then(() => toast("\u1F4CB Copy All!", "#8e44ad"));
      };
    });

  document
    .getElementById("af-dp-close")
    .addEventListener("click", () => panel.remove());
  setTimeout(() => {
    document.addEventListener("click", function outside(e) {
      if (!panel.contains(e.target) && e.target.id !== "af-btn-data") {
        panel.remove();
        document.removeEventListener("click", outside);
      }
    });
  }, 100);
}

// ============================================================
// MANUAL EDIT PANEL — Sửa từng mục trước khi Fill
// ============================================================
async function handleEditPanel() {
  const existing = document.getElementById("af-edit-panel");
  if (existing) {
    existing.remove();
    return;
  }

  // Generate data mặc định
  const data = await storageLocalGet([
    "isAutoGenMode",
    "autoBIN",
    "autoBINList",
    "autoBinIndex",
    "autoBinUsageMap",
    "cardLength",
    "testCounter",
    "maxTestCount",
    "autoTestScope",
    "autoBinStrategy",
    "autoExpiryMode",
    "autoCvvMode",
    "cards",
    "cardIndex",
    "addresses",
    "addrIndex",
    "addressMode",
    "lockedAddrData",
    "lockedAddrMode",
    "usedCardsLog",
  ]);

  // Lấy card data
  let defaultCard = { number: "", month: "12", year: "30", cvv: "123" };
  const autoBins = parseAutoBINList(data.autoBINList || data.autoBIN || "");
  if (data.isAutoGenMode === true && autoBins.length) {
    const bin = autoBins[0];
    const cardLine = generateNextCardFromBIN(
      bin,
      data.cardLength || 16,
      normalizeAutoExpiryMode(data.autoExpiryMode),
      normalizeAutoCvvMode(data.autoCvvMode),
    );
    if (cardLine) {
      const parts = cardLine.split("|");
      defaultCard = {
        number: parts[0],
        month: parts[1],
        year: parts[2]?.slice(-2),
        cvv: parts[3],
      };
    }
  } else {
    const picked = pickNextCardForAutofill(data);
    if (picked) defaultCard = picked.cardData;
  }

  // Lấy address data
  const addressMode = normalizeAddressMode(data.addressMode);
  const identity = buildRandomIdentity(addressMode);
  const defaultAddr = buildRandomAddress(
    identity.name,
    data.addresses,
    addressMode,
  );
  const initialCardLine = cardDataToLogLine(defaultCard);

  const panel = document.createElement("div");
  panel.id = "af-edit-panel";
  panel.setAttribute("data-dd-privacy", "hidden");
  panel.style.cssText = `
    position:fixed;bottom:65px;right:20px;z-index:2147483647;
    background:rgba(10,14,32,0.97);border:1px solid #9b59b6;
    border-radius:16px;padding:16px;width:380px;
    box-shadow:0 10px 40px rgba(0,0,0,.7);
    font-family:'Segoe UI',Arial,sans-serif;color:#e0e0e0;
    backdrop-filter:blur(10px);
    max-height:85vh;overflow-y:auto;
  `;

  const inputStyle = `width:100%;background:#0f3460;border:1px solid #1a4a8a;border-radius:6px;color:#fff;padding:6px 8px;font:12px monospace;box-sizing:border-box;outline:none;`;
  const labelStyle = `display:block;font:700 11px sans-serif;color:#8e8e8e;margin:8px 0 3px 0;`;
  const halfGrid = `display:grid;grid-template-columns:1fr 1fr;gap:8px;`;
  const thirdGrid = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;`;

  panel.innerHTML = `
    <div id="af-ep-drag-handle" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;user-select:none;cursor:move">
      <span style="font:700 14px sans-serif;color:#9b59b6">\u270F\uFE0F S\u1EEDa th\u1EE7 c\u00F4ng</span>
      <button id="af-ep-close" style="all:unset;cursor:pointer;color:#666;font-size:18px">\u2715</button>
    </div>

    <!-- CARD SECTION -->
    <div style="background:#111a3a;border-radius:10px;padding:10px;margin-bottom:10px;border:1px solid #1a3060">
      <div style="font:700 12px sans-serif;color:#e94560;margin-bottom:6px">\uD83D\uDCB3 Th\u1EBB</div>
      <label style="${labelStyle}">S\u1ED1 th\u1EBB</label>
      <input id="af-ep-card-number" type="text" style="${inputStyle}" value="${defaultCard.number}" placeholder="4242424242424242">
      <div style="${thirdGrid}">
        <div>
          <label style="${labelStyle}">Th\u00E1ng</label>
          <input id="af-ep-card-month" type="text" style="${inputStyle}" value="${defaultCard.month}" placeholder="12">
        </div>
        <div>
          <label style="${labelStyle}">N\u0103m</label>
          <input id="af-ep-card-year" type="text" style="${inputStyle}" value="${defaultCard.year}" placeholder="30">
        </div>
        <div>
          <label style="${labelStyle}">CVV</label>
          <input id="af-ep-card-cvv" type="text" style="${inputStyle}" value="${defaultCard.cvv}" placeholder="123">
        </div>
      </div>
    </div>

    <!-- ADDRESS SECTION -->
    <div style="background:#11302a;border-radius:10px;padding:10px;margin-bottom:10px;border:1px solid #1a4a3a">
      <div style="font:700 12px sans-serif;color:#27ae60;margin-bottom:6px">\uD83C\uDFE0 \u0110\u1ECBa ch\u1EC9</div>
      <label style="${labelStyle}">T\u00EAn</label>
      <input id="af-ep-addr-name" type="text" style="${inputStyle}" value="${defaultAddr.name || ""}" placeholder="Kim Min Seo">
      <div style="${halfGrid}">
        <div>
          <label style="${labelStyle}">Qu\u1ED1c gia</label>
          <input id="af-ep-addr-country" type="text" style="${inputStyle}" value="${defaultAddr.country || ""}" placeholder="South Korea">
        </div>
        <div>
          <label style="${labelStyle}">T\u1EC9nh/State</label>
          <input id="af-ep-addr-state" type="text" style="${inputStyle}" value="${defaultAddr.state || ""}" placeholder="Seoul">
        </div>
      </div>
      <div style="${halfGrid}">
        <div>
          <label style="${labelStyle}">Th\u00E0nh ph\u1ED1</label>
          <input id="af-ep-addr-city" type="text" style="${inputStyle}" value="${defaultAddr.city || ""}" placeholder="Seoul">
        </div>
        <div>
          <label style="${labelStyle}">M\u00E3 b\u01B0u \u0111i\u1EC7n</label>
          <input id="af-ep-addr-postal" type="text" style="${inputStyle}" value="${defaultAddr.postal || ""}" placeholder="04345">
        </div>
      </div>
      <label style="${labelStyle}">\u0110\u1ECBa ch\u1EC9</label>
      <input id="af-ep-addr-address" type="text" style="${inputStyle}" value="${defaultAddr.address || ""}" placeholder="43, Noksapyeong-daero 26-gil">
    </div>

    <!-- BUTTONS -->
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button id="af-ep-random" style="all:unset;flex:1;cursor:pointer;padding:8px;background:#e67e22;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff;min-width:70px">\uD83C\uDFB2 Random</button>
      <button id="af-ep-fill-addr" style="all:unset;flex:1;cursor:pointer;padding:8px;background:#8e44ad;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff;min-width:70px">\uD83C\uDFE0 Ch\u1EC9 Fill \u0110C</button>
      <button id="af-ep-fill" style="all:unset;flex:1;cursor:pointer;padding:8px;background:#2980b9;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff;min-width:70px">\uD83D\uDCCB Fill All</button>
      <button id="af-ep-fill-submit" style="all:unset;flex:1;cursor:pointer;padding:8px;background:#27ae60;border-radius:8px;text-align:center;font:700 12px sans-serif;color:#fff;min-width:70px">\uD83D\uDE80 Fill & Submit</button>
    </div>
  `;

  document.body.appendChild(panel);
  makeFloatingMovable(panel, {
    handleSelector: "#af-ep-drag-handle",
    noDragSelector: "button, input, textarea, select",
  });

  // Close
  document
    .getElementById("af-ep-close")
    .addEventListener("click", () => panel.remove());

  // Random — generate lại toàn bộ data mới
  document
    .getElementById("af-ep-random")
    .addEventListener("click", async () => {
      // Card
      let newCard = { number: "", month: "12", year: "30", cvv: "123" };
      if (data.isAutoGenMode === true && autoBins.length) {
        const bin = autoBins[Math.floor(Math.random() * autoBins.length)];
        const cardLine = generateNextCardFromBIN(
          bin,
          data.cardLength || 16,
          normalizeAutoExpiryMode(data.autoExpiryMode),
          normalizeAutoCvvMode(data.autoCvvMode),
        );
        if (cardLine) {
          const parts = cardLine.split("|");
          newCard = {
            number: parts[0],
            month: parts[1],
            year: parts[2]?.slice(-2),
            cvv: parts[3],
          };
        }
      } else {
        const picked = pickNextCardForAutofill(data);
        if (picked) newCard = picked.cardData;
      }
      document.getElementById("af-ep-card-number").value = newCard.number;
      document.getElementById("af-ep-card-month").value = newCard.month;
      document.getElementById("af-ep-card-year").value = newCard.year;
      document.getElementById("af-ep-card-cvv").value = newCard.cvv;

      // Address
      const newIdentity = buildRandomIdentity(addressMode);
      const newAddr = buildRandomAddress(
        newIdentity.name,
        data.addresses,
        addressMode,
      );
      document.getElementById("af-ep-addr-name").value = newAddr.name || "";
      document.getElementById("af-ep-addr-country").value =
        newAddr.country || "";
      document.getElementById("af-ep-addr-state").value = newAddr.state || "";
      document.getElementById("af-ep-addr-city").value = newAddr.city || "";
      document.getElementById("af-ep-addr-postal").value = newAddr.postal || "";
      document.getElementById("af-ep-addr-address").value =
        newAddr.address || "";

      toast("\uD83C\uDFB2 \u0110\u00E3 t\u1EA1o data m\u1EDBi!", "#e67e22");
    });

  // Đọc giá trị từ panel
  function readEditPanelData() {
    const cardData = {
      number: document
        .getElementById("af-ep-card-number")
        .value.replace(/\D/g, ""),
      month: document
        .getElementById("af-ep-card-month")
        .value.replace(/\D/g, "")
        .padStart(2, "0")
        .slice(-2),
      year: document
        .getElementById("af-ep-card-year")
        .value.replace(/\D/g, "")
        .slice(-2),
      cvv: document.getElementById("af-ep-card-cvv").value.replace(/\D/g, ""),
    };
    const addrData = {
      name: document.getElementById("af-ep-addr-name").value.trim(),
      country: document.getElementById("af-ep-addr-country").value.trim(),
      state: document.getElementById("af-ep-addr-state").value.trim(),
      city: document.getElementById("af-ep-addr-city").value.trim(),
      address: document.getElementById("af-ep-addr-address").value.trim(),
      postal: document.getElementById("af-ep-addr-postal").value.trim(),
    };
    return { cardData, addrData };
  }

  function shouldUseRandomCardFromEdit(cardData) {
    const currentCardLine = cardDataToLogLine(cardData);
    return !currentCardLine || currentCardLine === initialCardLine;
  }

  // Fill Only Address — chỉ fill phần địa chỉ
  document
    .getElementById("af-ep-fill-addr")
    .addEventListener("click", async () => {
      const { addrData } = readEditPanelData();
      await storageLocalSet({
        fillTrigger: { cardData: null, addrData, ts: Date.now() },
      });
      toast("\u2705 \u0110\u00E3 fill \u0111\u1ECBa ch\u1EC9!", "#8e44ad");
    });

  // Fill All — fill cả thẻ và địa chỉ, không bấm Submit
  document.getElementById("af-ep-fill").addEventListener("click", async () => {
    const { cardData: rawCardData, addrData } = readEditPanelData();
    let cardData = rawCardData;
    const payload = {
      fillTrigger: { cardData: null, addrData, ts: Date.now() },
    };

    if (shouldUseRandomCardFromEdit(cardData)) {
      const latest = await storageLocalGet([
        "isAutoGenMode",
        "autoBIN",
        "autoBINList",
        "autoBinIndex",
        "cardLength",
        "autoBinStrategy",
        "autoExpiryMode",
        "autoCvvMode",
        "cards",
        "cardIndex",
      ]);
      const picked = pickRandomCardForFlexibleFill(latest);
      if (!picked.cardData) {
        toast("Khong co the de random!", "#e67e22");
        return;
      }
      cardData = picked.cardData;
      payload.cardIndex = picked.nextCardIndex;
    }

    payload.fillTrigger.cardData = cardData;
    await storageLocalSet({
      ...payload,
    });
    toast("\u2705 \u0110\u00E3 fill form!", "#27ae60");
  });

  // Fill & Submit — fill form rồi bấm Subscribe
  document
    .getElementById("af-ep-fill-submit")
    .addEventListener("click", async () => {
      const { cardData: rawCardData, addrData } = readEditPanelData();
      let cardData = rawCardData;

      if (shouldUseRandomCardFromEdit(cardData)) {
        const latest = await storageLocalGet([
          "isAutoGenMode",
          "autoBIN",
          "autoBINList",
          "autoBinIndex",
          "cardLength",
          "autoBinStrategy",
          "autoExpiryMode",
          "autoCvvMode",
          "cards",
          "cardIndex",
        ]);
        const picked = pickRandomCardForFlexibleFill(latest);
        if (!picked.cardData) {
          toast("Khong co the de random!", "#e67e22");
          return;
        }
        cardData = picked.cardData;
        if (typeof picked.nextCardIndex === "number") {
          await storageLocalSet({ cardIndex: picked.nextCardIndex });
        }
      }

      const usedCardLine = cardDataToLogLine(cardData);
      await storageLocalSet({
        fillTrigger: { cardData, addrData, ts: Date.now() },
        lastAttemptCardLine: usedCardLine,
      });
      await appendCardLog("usedCardsLog", usedCardLine);
      toast("\u0110ang fill v\u00E0 b\u1EA5m Submit...", "#27ae60");
      await sleep(2500);
      const subscribeBtn = findSubscribeButton();
      if (subscribeBtn && !subscribeBtn.disabled) {
        clickLikeMouse(subscribeBtn);
        toast("\u0110\u00E3 b\u1EA5m Submit!", "#27ae60");
      } else {
        toast("Khong thay nut Submit/Subscribe!", "#e67e22");
      }
    });

  // Click outside to close
  setTimeout(() => {
    document.addEventListener("click", function outside(e) {
      if (!panel.contains(e.target) && e.target.id !== "af-btn-edit") {
        panel.remove();
        document.removeEventListener("click", outside);
      }
    });
  }, 100);
}

// Danh sÃƒÆ’Ã‚Â¡ch tÃƒÆ’Ã‚Âªn HÃƒÆ’Ã‚Â n phÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¢ biÃƒÂ¡Ã‚ÂºÃ‚Â¿n
const KR_LAST = [
  "김",
  "이",
  "박",
  "최",
  "정",
  "강",
  "윤",
  "장",
  "임",
  "한",
  "오",
  "서",
  "신",
  "권",
  "황",
  "안",
  "송",
  "유",
  "홍",
  "문",
  "류",
  "백",
  "조",
  "남",
  "배",
  "허",
  "전",
  "고",
  "노",
  "하",
];

const KR_FIRST = [
  "지호",
  "민준",
  "서연",
  "하은",
  "예진",
  "태양",
  "현우",
  "지우",
  "수빈",
  "다은",
  "보람",
  "재현",
  "민서",
  "소연",
  "동현",
  "유나",
  "상우",
  "희정",
  "우진",
  "나연",
  "승민",
  "미래",
  "준호",
  "은지",
  "하준",
  "수아",
  "태민",
  "지은",
  "경호",
  "연지",
];

const US_FIRST = [
  "John",
  "Emily",
  "Michael",
  "Sarah",
  "David",
  "Jessica",
  "James",
  "Ashley",
  "Daniel",
  "Amanda",
];
const US_LAST = [
  "Carter",
  "Davis",
  "Brown",
  "Wilson",
  "Martinez",
  "Taylor",
  "Anderson",
  "Thomas",
  "Garcia",
  "White",
];

const UK_FIRST = [
  "Oliver",
  "Amelia",
  "Harry",
  "Isla",
  "Jack",
  "Emily",
  "George",
  "Sophia",
  "Noah",
  "Isabella",
];
const UK_LAST = [
  "Smith",
  "Jones",
  "Williams",
  "Taylor",
  "Brown",
  "Davies",
  "Evans",
  "Wilson",
  "Thomas",
  "Roberts",
];

const JP_FIRST = [
  "Satoshi",
  "Yuki",
  "Kenji",
  "Haruka",
  "Takeshi",
  "Misaki",
  "Hiroshi",
  "Ayaka",
  "Ryota",
  "Natsuki",
];
const JP_LAST = [
  "Yamamoto",
  "Tanaka",
  "Suzuki",
  "Sato",
  "Watanabe",
  "Ito",
  "Kobayashi",
  "Yamada",
  "Kato",
  "Yoshida",
];

function randomFrom(list, fallback = "") {
  if (!Array.isArray(list) || !list.length) return fallback;
  return list[Math.floor(Math.random() * list.length)] || fallback;
}

function randomUsName() {
  return `${randomFrom(US_FIRST, "John")} ${randomFrom(US_LAST, "Carter")}`;
}

function randomUkName() {
  return `${randomFrom(UK_FIRST, "Oliver")} ${randomFrom(UK_LAST, "Smith")}`;
}

function randomJpName() {
  return `${randomFrom(JP_FIRST, "Satoshi")} ${randomFrom(JP_LAST, "Yamamoto")}`;
}

const ID_FIRST = [
  "Budi",
  "Andi",
  "Rizky",
  "Dimas",
  "Fajar",
  "Ayu",
  "Putri",
  "Siti",
  "Nabila",
  "Intan",
];
const ID_LAST = [
  "Santoso",
  "Pratama",
  "Saputra",
  "Hidayat",
  "Wijaya",
  "Nugroho",
  "Kusuma",
  "Permana",
  "Lestari",
  "Ramadhan",
];

function randomIndonesiaName() {
  return `${randomFrom(ID_FIRST, "Budi")} ${randomFrom(ID_LAST, "Santoso")}`;
}

function randomGlobalLatinName() {
  const pick = pickRandomItem([
    randomUsName,
    randomUkName,
    randomJpName,
    randomChileName,
    randomIndonesiaName,
  ]);
  return (typeof pick === "function" ? pick() : "John Carter") || "John Carter";
}

const CL_FIRST = [
  "Matias",
  "Sebastian",
  "Camila",
  "Valentina",
  "Diego",
  "Catalina",
  "Andres",
  "Fernanda",
  "Nicolas",
  "Javiera",
];
const CL_LAST = [
  "Gonzalez",
  "Muñoz",
  "Rojas",
  "Diaz",
  "Perez",
  "Soto",
  "Contreras",
  "Silva",
  "Martinez",
  "Sepulveda",
];

function randomChileName() {
  return `${randomFrom(CL_FIRST, "Matias")} ${randomFrom(CL_LAST, "Gonzalez")}`;
}

function getRandomNameForMode(mode, fallbackName = "") {
  const normalizedMode = normalizeAddressMode(mode);
  if (isKrIndoMixAddressMode(normalizedMode)) return randomGlobalLatinName();
  if (isUsIndoMixAddressMode(normalizedMode)) return randomUsName();
  if (isUkIndoMixAddressMode(normalizedMode)) return randomUkName();
  if (
    normalizedMode === ADDRESS_MODE_RANDOM_KR ||
    normalizedMode === ADDRESS_MODE_FIXED_KR
  ) {
    return randomGlobalLatinName();
  }
  if (isUsAddressMode(normalizedMode)) return randomUsName();
  if (isUkAddressMode(normalizedMode)) return randomUkName();
  if (isJapanAddressMode(normalizedMode)) return randomJpName();
  if (isChileAddressMode(normalizedMode)) return randomChileName();
  if (isIndonesiaAddressMode(normalizedMode)) return "Budi Santoso";
  if (isIndiaAddressMode(normalizedMode)) return "Arjun Mehta";
  if (isAlgeriaAddressMode(normalizedMode)) return "Yacine Benali";
  if (isKazakhstanAddressMode(normalizedMode)) return "Aruzhan Bek";
  return randomGlobalLatinName() || fallbackName || "John Carter";
}

function randomKRName() {
  const last = KR_LAST[Math.floor(Math.random() * KR_LAST.length)];
  const first = KR_FIRST[Math.floor(Math.random() * KR_FIRST.length)];
  return `${last}${first}`; // Ghép họ và tên bằng tiếng Hàn KHÔNG CÓ KHOẢNG TRẮNG, vd: 김지호
}

async function handleNameClick() {
  if (await blockIfCaptchaPresent("name")) return;

  const data = await storageLocalGet(["addressMode"]);
  const mode = normalizeAddressMode(data.addressMode);
  const identity = buildRandomIdentity(mode);
  fillIdentityOnMain(identity).then((result) => {
    if (result && result.dobFilled === false) {
      toast(`Name: ${identity.name} (DOB fill loi)`, "#e67e22");
    } else {
      toast(`Name + DOB: ${identity.name} (${identity.birthStr})`, "#e67e22");
    }
  });
}

// LÃƒÂ¡Ã‚ÂºÃ‚Â¯ng nghe nameTrigger (trong address iframe)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.nameTrigger) return;
  if (!isAddressFrame) return;
  const { name } = changes.nameTrigger.newValue || {};
  if (!name) return;
  const el = qs([
    'input[autocomplete="name"]',
    'input[autocomplete="billing name"]',
    'input[name="name"]',
    'input[placeholder*="Full name" i]',
  ]);
  if (el) typeInto(el, name);
});

// ============================================================
// Ãƒâ€žÃ‚ÂIÃƒÂ¡Ã‚Â»Ã¢â€šÂ¬N THÃƒÂ¡Ã‚ÂºÃ‚Âº
// ============================================================
function fillPayment(card) {
  const month = String(card?.month || "")
    .replace(/\D/g, "")
    .padStart(2, "0")
    .slice(-2);
  const year = String(card?.year || "")
    .replace(/\D/g, "")
    .slice(-2);
  const expiry = `${month}${year}`;

  const cardEl = qs([
    'input[name="cardnumber"]',
    'input[autocomplete="cc-number"]',
    'input[placeholder*="Card number" i]',
  ]);
  const expEl = qs([
    'input[name="exp-date"]',
    'input[autocomplete="cc-exp"]',
    'input[placeholder*="MM/YY" i]',
    'input[placeholder*="MM / YY" i]',
    'input[placeholder*="Expir" i]',
  ]);
  const cvvEl = qs([
    'input[name="cvc"]',
    'input[autocomplete="cc-csc"]',
    'input[placeholder*="CVC" i]',
    'input[placeholder*="CVV" i]',
    'input[placeholder*="Security" i]',
  ]);

  // Fill card "ÃƒÂ¡Ã‚ÂºÃ‚Â©n": khÃƒÆ’Ã‚Â´ng focus/gÃƒÆ’Ã‚Âµ, chÃƒÂ¡Ã‚Â»Ã¢â‚¬Â° set value + event
  if (cardEl) typeStripeHidden(cardEl, card.number);
  if (expEl && month && year) {
    typeStripeHidden(expEl, expiry);
    const expected = `${month}${year}`;
    const readDigits = () =>
      String(expEl.value || "")
        .replace(/\D/g, "")
        .slice(0, 4);
    // Some Stripe builds ignore direct value set for expiry; fallback to real typing.
    if (readDigits() !== expected) {
      typeStripe(expEl, `${month}/${year}`);
      if (readDigits() !== expected) {
        typeStripe(expEl, expected);
      }
    }
  }
  if (cvvEl) typeStripeHidden(cvvEl, card.cvv);
}

// ============================================================
// Ãƒâ€žÃ‚ÂIÃƒÂ¡Ã‚Â»Ã¢â€šÂ¬N Ãƒâ€žÃ‚ÂÃƒÂ¡Ã‚Â»Ã…Â A CHÃƒÂ¡Ã‚Â»Ã‹â€
// ============================================================
async function fillAddress(addr) {
  const countryValue = addr.country || FIXED_BILLING_ADDRESS.country;
  const stateValue = addr.state || FIXED_BILLING_ADDRESS.state;
  const cityValue = addr.city || FIXED_BILLING_ADDRESS.city;
  const addressValue = addr.address || FIXED_BILLING_ADDRESS.address;
  const postalValue = addr.postal || FIXED_BILLING_ADDRESS.postal;

  const nameEl = qs([
    'input[autocomplete="name"]',
    'input[autocomplete="billing name"]',
    'input[name="name"]',
    'input[id*="nameInput" i]',
    'input[placeholder*="Full name" i]',
  ]);
  if (nameEl) typeInto(nameEl, addr.name);

  const countryEl = qs([
    'select[name="country"]',
    'select[autocomplete="country"]',
    'select[autocomplete="billing country"]',
    'select[id*="countryInput" i]',
  ]);
  if (countryEl) {
    setSelect(countryEl, countryValue);
    await sleep(500);
  }

  const stateEl = qs([
    'select[name="administrativeArea"]',
    "select#billingAddress-administrativeAreaInput",
    'select[autocomplete="billing address-level1"]',
    'select[autocomplete="address-level1"]',
  ]);
  if (stateEl) {
    setSelect(stateEl, stateValue);
    await sleep(800);
  }

  const cityEl = qs([
    'select[name="locality"]',
    'select[autocomplete="billing address-level2"]',
    'select[autocomplete="address-level2"]',
    'input[name="locality"]',
    'input[autocomplete="billing address-level2"]',
    'input[autocomplete="address-level2"]',
    'input[id*="localityInput" i]',
    'input[placeholder*="City" i]',
  ]);
  if (cityEl) {
    if (cityEl.tagName === "SELECT") setSelect(cityEl, cityValue);
    else typeInto(cityEl, cityValue);
  } else {
    await sleep(600);
    const cityEl2 = qs([
      'select[name="locality"]',
      'select[autocomplete="billing address-level2"]',
      'input[name="locality"]',
      'input[autocomplete="billing address-level2"]',
      'input[id*="localityInput" i]',
      'input[placeholder*="City" i]',
    ]);
    if (cityEl2) {
      if (cityEl2.tagName === "SELECT") setSelect(cityEl2, cityValue);
      else typeInto(cityEl2, cityValue);
    }
  }

  const addr1El = qs([
    'input[name="address"]',
    'input[name="line1"]',
    'input[autocomplete="billing address-line1"]',
    'input[autocomplete="address-line1"]',
    'input[id*="line1Input" i]',
    'input[placeholder*="Address" i]',
  ]);
  if (addr1El) typeInto(addr1El, addressValue);

  const postalEl = qs([
    'input[name="postalCode"]',
    'input[name="postal"]',
    'input[autocomplete="billing postal-code"]',
    'input[autocomplete="postal-code"]',
    'input[id*="postalCodeInput" i]',
    'input[placeholder*="Postal" i]',
  ]);
  if (postalEl) typeInto(postalEl, postalValue);

  // Stripe autocomplete can overwrite fields a moment later, so re-apply once.
  await sleep(250);
  if (addr1El) typeInto(addr1El, addressValue);
  if (postalEl) typeInto(postalEl, postalValue);
}

// ============================================================
// SET SELECT (React-compatible)
// ============================================================
function setSelect(el, value) {
  const opts = Array.from(el.options);
  const match = findBestSelectOption(opts, value);
  if (!match) return;
  el.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  ).set;
  nativeSetter.call(el, match.value);
  el.selectedIndex = opts.indexOf(match);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

function normalizeSelectToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findBestSelectOption(options, value) {
  const target = normalizeSelectToken(value);
  if (!target || !options.length) return null;

  const exact = options.find((o) => {
    const v = normalizeSelectToken(o.value);
    const t = normalizeSelectToken(o.text);
    return v === target || t === target;
  });
  if (exact) return exact;

  // Country dropdowns thường dùng mã ISO trong value (vd: IN cho India).
  if (target === "india") {
    const indiaIso = options.find(
      (o) => normalizeSelectToken(o.value) === "in",
    );
    if (indiaIso) return indiaIso;
  }

  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordBoundary = new RegExp(`(^|\\s)${escapedTarget}(\\s|$)`, "i");
  const wholeWord = options.find((o) =>
    wordBoundary.test(normalizeSelectToken(o.text)),
  );
  if (wholeWord) return wholeWord;

  return (
    options.find((o) => {
      const v = normalizeSelectToken(o.value);
      const t = normalizeSelectToken(o.text);
      return v.startsWith(target) || t.startsWith(target);
    }) || null
  );
}

// ============================================================
// typeInto ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Input thÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Âng (name, address, postal...)
// DÃƒÆ’Ã‚Â¹ng native setter: KHÃƒÆ’Ã¢â‚¬ÂNG focus/blur ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ KHÃƒÆ’Ã¢â‚¬ÂNG nhÃƒÂ¡Ã‚ÂºÃ‚Â¥p nhÃƒÆ’Ã‚Â¡y
// ============================================================
function typeInto(el, text) {
  if (!el || text == null) return;
  const val = String(text);
  try {
    el.focus();
    // Try native insertion first (best for React/modern apps)
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, val);

    // Verify if it worked
    if (String(el.value || "") !== val) {
       throw new Error("insertText failed to update value");
    }
  } catch (err) {
    // Force set fallback if insertText fails to stick
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(el, val);
    } else {
      el.value = val;
    }
  } finally {
    // Always trigger events to ensure app state updates
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof el.blur === "function") el.blur();
  }
}

// ============================================================
// typeStripe ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Stripe masked input (card, expiry, CVV)
// selectAll ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ insertText: replace Ãƒâ€žÃ¢â‚¬ËœÃƒÆ’Ã‚Âºng nÃƒÂ¡Ã‚Â»Ã¢â€žÂ¢i dung Stripe internal state
// ============================================================
function typeStripe(el, text) {
  if (!el || text == null) return;
  el.focus();
  // selectAll chÃƒÂ¡Ã‚Â»Ã‚Ân nÃƒÂ¡Ã‚Â»Ã¢â€žÂ¢i dung Stripe Ãƒâ€žÃ¢â‚¬Ëœang giÃƒÂ¡Ã‚Â»Ã‚Â¯ (kÃƒÂ¡Ã‚Â»Ã†â€™ cÃƒÂ¡Ã‚ÂºÃ‚Â£ giÃƒÆ’Ã‚Â¡ trÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹ cÃƒâ€¦Ã‚Â©)
  document.execCommand("selectAll", false);
  // insertText thay thÃƒÂ¡Ã‚ÂºÃ‚Â¿ toÃƒÆ’Ã‚Â n bÃƒÂ¡Ã‚Â»Ã¢â€žÂ¢ selection = khÃƒÆ’Ã‚Â´ng bÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¹ nÃƒÂ¡Ã‚Â»Ã¢â‚¬Ëœi sÃƒÂ¡Ã‚Â»Ã¢â‚¬Ëœ cÃƒâ€¦Ã‚Â©
  document.execCommand("insertText", false, String(text));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

// ============================================================
// HELPERS
// ============================================================
function qs(selectors) {
  for (const s of selectors) {
    try {
      const all = document.querySelectorAll(s);
      if (!all.length) continue;

      // Smart Priority: Uu tien o trong modal dang hien thi
      const candidates = Array.from(all).reverse();
      for (const el of candidates) {
        const isInModal = el.closest('[role="dialog"], [aria-modal="true"], .modal, .modal-box, .modal-content, [class*="modal"i], [class*="dialog"i]');
        if (isInModal && isInteractable(el)) return el;
      }

      // Neu khong tim thay trong modal, lay o interactable dau tai (search nguoc)
      for (const el of candidates) {
        if (isInteractable(el)) return el;
      }

      return candidates[0];
    } catch (_) {}
  }
  return null;
}

function isInteractable(el) {
  if (!el) return false;
  if (el.disabled) return false;
  if (el.readOnly) return false;
  if (el.type && String(el.type).toLowerCase() === "hidden") return false;
  if (
    typeof el.matches === "function" &&
    el.matches('[hidden], [aria-hidden="true"]')
  )
    return false;
  if (
    typeof el.closest === "function" &&
    el.closest('[hidden], [aria-hidden="true"]')
  )
    return false;
  if (typeof el.checkVisibility === "function") {
    try {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        return false;
    } catch (_) {}
  }

  const st = window.getComputedStyle(el);
  if (!st) return true;
  if (
    st.display === "none" ||
    st.visibility === "hidden" ||
    st.visibility === "collapse"
  )
    return false;
  if (Number(st.opacity) === 0) return false;
  if (
    typeof el.getClientRects === "function" &&
    el.getClientRects().length === 0
  )
    return false;

  // Final check: phai co kich thuoc thuc te
  const rect = el.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;

  return true;
}

function isChatGPTAgeGate() {
  const heading = document.querySelector("h1")?.textContent || "";
  if (matchesUiPatterns(heading, AGE_GATE_HEADING_PATTERNS)) return true;
  if (heading.includes("xÃƒÆ’Ã‚Â¡c minh tuÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¢i")) return true;

  if (findAgeField()) return true;
  const hasBirthdayHidden = !!document.querySelector(
    'input[type="hidden"][name="birthday"]',
  );
  const hasDateSegments =
    !!document.querySelector('[data-type="month"][role="spinbutton"]') &&
    !!document.querySelector('[data-type="day"][role="spinbutton"]') &&
    !!document.querySelector('[data-type="year"][role="spinbutton"]');
  return hasBirthdayHidden && hasDateSegments;
}

function clearAgeGateBirthdayField() {
  const mSeg = qs(['[data-type="month"]']);
  const dSeg = qs(['[data-type="day"]']);
  const ySeg = qs(['[data-type="year"]']);

  const clearSeg = (el) => {
    if (!el) return;
    el.focus();
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  clearSeg(mSeg);
  clearSeg(dSeg);
  clearSeg(ySeg);

  const group =
    ySeg?.closest?.('[role="group"]') || mSeg?.closest?.('[role="group"]');
  if (group) {
    group.dispatchEvent(new Event("input", { bubbles: true }));
    group.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (mSeg) mSeg.focus();
}

function getIdentityAge(identity) {
  const year = Number(identity?.year || 0);
  const month = Number(identity?.month || 1);
  const day = Number(identity?.day || 1);
  if (!year) return 21;
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDelta = today.getMonth() + 1 - month;
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < day)) {
    age -= 1;
  }
  return Math.max(18, age);
}

async function fillAgeGateAgeField(identity) {
  const ageEl = findAgeField();
  if (!ageEl) return false;
  const ageValue = String(getIdentityAge(identity));
  typeInto(ageEl, ageValue);
  await sleep(80);
  const currentDigits = String(ageEl.value || "").replace(/\D/g, "");
  if (currentDigits !== ageValue) {
    await typeInputLikeUser(ageEl, ageValue);
  }
  return String(ageEl.value || "").replace(/\D/g, "") === ageValue;
}

async function fillAgeGateBirthdayAsDigits(identity) {
  const mSeg = qs([
    '[data-type="month"][role="spinbutton"]',
    '[data-type="month"]',
  ]);
  const dSeg = qs([
    '[data-type="day"][role="spinbutton"]',
    '[data-type="day"]',
  ]);
  const ySeg = qs([
    '[data-type="year"][role="spinbutton"]',
    '[data-type="year"]',
  ]);
  if (!mSeg || !dSeg || !ySeg) return false;

  const expectedM = identity.month;
  const expectedD = identity.day;
  const expectedY = String(identity.year);
  const expected = `${expectedM}${expectedD}${expectedY}`;

  const typeAll = async () => {
    if (hasBirthdayDigits(mSeg, dSeg, ySeg)) {
      clearAgeGateBirthdayField();
      await sleep(20);
    }
    // Type like keyboard: click/focus then input MMDDYYYY
    await typeBirthdayDigitsFlow(mSeg, dSeg, ySeg, expected);

    const group =
      ySeg.closest('[role="group"]') || mSeg.closest('[role="group"]');
    if (group) {
      group.dispatchEvent(new Event("input", { bubbles: true }));
      group.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
  };

  await typeAll();
  const current = `${normSeg(mSeg, 2)}${normSeg(dSeg, 2)}${normSeg(ySeg, 4)}`;
  return current === expected;
}

function normSeg(el, width) {
  const raw = String(el?.textContent || "").replace(/\D/g, "");
  return raw.padStart(width, "0").slice(-width);
}

async function typeBirthdayDigitsFlow(mSeg, dSeg, ySeg, digits) {
  if (!mSeg || !dSeg || !ySeg || !digits) return;
  const raw = String(digits).replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
  const keyDelayMs = 70;

  // Prefer human-like navigation: focus Full name then press Tab to Birthday.
  const focusedByTab = await focusBirthdayViaNameTab(mSeg);
  if (!focusedByTab) {
    clickLikeMouse(mSeg);
    await sleep(25);
  }

  const active = document.activeElement;
  const isSegActive =
    active && active.getAttribute && active.getAttribute("data-type");
  if (!isSegActive) {
    clickLikeMouse(mSeg);
    await sleep(20);
  }

  for (const ch of raw) {
    const current = document.activeElement;
    const target =
      current && current.getAttribute && current.getAttribute("data-type")
        ? current
        : mSeg;
    if (document.activeElement !== target) clickLikeMouse(target);

    await sleep(5);
    pressDigitLikeKeyboard(target, ch);
    await sleep(keyDelayMs);
  }
}

function pressDigitLikeKeyboard(el, ch) {
  if (!el || !/^\d$/.test(String(ch))) return;
  const digit = String(ch);
  const codeNum = 48 + Number(digit);
  const eventInit = {
    key: digit,
    code: `Digit${digit}`,
    keyCode: codeNum,
    which: codeNum,
    bubbles: true,
    cancelable: true,
    composed: true,
  };

  if (document.activeElement !== el && typeof el.focus === "function")
    el.focus();
  el.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  el.dispatchEvent(new KeyboardEvent("keypress", eventInit));
  try {
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: digit,
        inputType: "insertText",
      }),
    );
  } catch (_) {}
  try {
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: digit,
        inputType: "insertText",
      }),
    );
  } catch (_) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new KeyboardEvent("keyup", eventInit));
}

function hasBirthdayDigits(mSeg, dSeg, ySeg) {
  const m = String(mSeg?.textContent || "").replace(/\D/g, "");
  const d = String(dSeg?.textContent || "").replace(/\D/g, "");
  const y = String(ySeg?.textContent || "").replace(/\D/g, "");
  return m.length + d.length + y.length > 0;
}

async function focusBirthdayViaNameTab(mSeg) {
  const nameEl = findIdentityNameField();
  if (!nameEl || !mSeg) return false;

  clickLikeMouse(nameEl);
  await sleep(25);

  nameEl.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  await sleep(8);
  nameEl.dispatchEvent(
    new KeyboardEvent("keyup", { key: "Tab", code: "Tab", bubbles: true }),
  );

  // Synthetic Tab may not move focus in all browsers, so keep a safe fallback.
  if (document.activeElement !== mSeg) clickLikeMouse(mSeg);
  await sleep(20);

  const active = document.activeElement;
  return !!(active && active.getAttribute && active.getAttribute("data-type"));
}

function placeCaretAtEnd(el) {
  if (!el) return;
  if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }
  try {
    const end = String(el.value || "").length;
    if (typeof el.setSelectionRange === "function") {
      el.setSelectionRange(end, end);
    }
  } catch (_) {}
}

function clickLikeMouse(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
  const y = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));

  const mouseOpts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
  };

  if (typeof PointerEvent !== "undefined") {
    el.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
  }
  el.dispatchEvent(new MouseEvent("mousedown", mouseOpts));

  if (typeof el.focus === "function") el.focus();

  if (typeof PointerEvent !== "undefined") {
    el.dispatchEvent(new PointerEvent("pointerup", mouseOpts));
  }
  el.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
  el.dispatchEvent(new MouseEvent("click", mouseOpts));
}

function typeStripeHidden(el, text) {
  if (!el || text == null) return;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (nativeSetter) nativeSetter.call(el, String(text));
  else el.value = String(text);

  try {
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: String(text),
        inputType: "insertText",
      }),
    );
  } catch (_) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function typeInputLikeUser(el, text, charDelayMs = 0) {
  if (!el || text == null) return;

  // 1. Phải click vào input như thao tác chuột của người
  clickLikeMouse(el);
  await sleep(Math.floor(Math.random() * 200) + 150);

  // Behavior 1: Giả lập việc copy/paste password (rất giống con người và vượt qua giới hạn Datadog 3KB vì ghi 1 lần duy nhất)
  if (charDelayMs <= 0) {
    el.focus();
    try {
      if (typeof el.select === "function") el.select();
      else document.execCommand("selectAll", false);
    } catch (_) {}
    try {
      if (!document.execCommand("insertText", false, String(text)))
        throw new Error();
    } catch (_) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) nativeSetter.call(el, String(text));
      else el.value = String(text);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: String(text),
          inputType: "insertText",
        }),
      );
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(150);
    el.blur();
    return;
  }

  // Behavior 2: Gõ chậm rãi y như người thật bằng execCommand (mô phỏng chuẩn xác React & Datadog tracking)
  const raw = String(text);
  el.focus();
  try {
    if (typeof el.select === "function") el.select();
    else document.execCommand("selectAll", false);
  } catch (_) {}
  document.execCommand("delete", false); // xóa dữ liệu cũ

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    el.focus(); // đảm bảo không mất focus
    const eventInit = {
      key: ch,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    el.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    el.dispatchEvent(new KeyboardEvent("keypress", eventInit));

    try {
      // execCommand("insertText") chính là API trình duyệt tự tạo ra chuỗi Event tự nhiên hoàn hảo nhất
      if (!document.execCommand("insertText", false, ch))
        throw new Error("Fallback");
    } catch (_) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      const nextVal = (el.value || "") + ch;
      if (nativeSetter) nativeSetter.call(el, nextVal);
      else el.value = nextVal;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: ch,
          inputType: "insertText",
        }),
      );
    }

    el.dispatchEvent(new KeyboardEvent("keyup", eventInit));

    // Thời gian gõ ngẫu nhiên không đều từ (charDelayMs - 40ms) đến (charDelayMs + 40ms)
    const variation = Math.floor(Math.random() * 80) - 40;
    const actualDelayMs = Math.max(15, charDelayMs + variation);
    await sleep(actualDelayMs);
  }

  // Đợi xíu và chuyển focus ra ngoài
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(Math.floor(Math.random() * 200) + 150);
  el.blur();
}

async function typeMaskedInputLikeKeyboard(el, text, keyDelayMs = 45) {
  if (!el || text == null) return;
  const raw = String(text);
  el.focus();
  try {
    if (typeof el.select === "function") el.select();
    else document.execCommand("selectAll", false);
    document.execCommand("delete", false);
  } catch (_) {}

  for (const ch of raw) {
    const isDigit = /^\d$/.test(ch);
    const keyCode = isDigit ? 48 + Number(ch) : ch === "." ? 190 : 0;
    const code = isDigit ? `Digit${ch}` : ch === "." ? "Period" : "";
    const eventInit = {
      key: ch,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    el.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    try {
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: ch,
          inputType: "insertText",
        }),
      );
    } catch (_) {}
    try {
      document.execCommand("insertText", false, ch);
    } catch (_) {
      const nextVal = String(el.value || "") + ch;
      typeInto(el, nextVal);
    }
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: ch,
          inputType: "insertText",
        }),
      );
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    await sleep(keyDelayMs);
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function typeDateSegmentLikeUser(el, text, keyDelayMs = 25) {
  if (!el || text == null) return;
  el.focus();
  document.execCommand("selectAll", false);
  document.execCommand("delete", false);
  for (const ch of String(text)) {
    placeCaretAtEnd(el);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true }));
    document.execCommand("insertText", false, ch);
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: ch,
          inputType: "insertText",
        }),
      );
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
    await sleep(keyDelayMs);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toast(msg, color = "#27ae60") {
  if (!isMainFrame) return;
  const uiRoot = document.documentElement || document.body;
  if (!uiRoot) return;
  let t = document.getElementById("af-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "af-toast";
    // Tàng hình thẻ DIV này khỏi trình quay video người dùng của Datadog (Session Replay)
    t.setAttribute("data-dd-privacy", "hidden");
    t.style.cssText = `
      position:fixed; bottom:80px; right:24px; z-index:2147483647;
      padding:10px 18px; border-radius:12px; pointer-events:none;
      font:600 13px 'Segoe UI',Arial,sans-serif; color:#fff;
      max-width:320px; box-shadow:0 4px 18px rgba(0,0,0,.4);
      opacity:0; transition:opacity .3s;
    `;
    uiRoot.appendChild(t);
  }
  t.style.background = color;
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._t);
  t._t = setTimeout(() => {
    t.style.opacity = "0";
  }, 3000);
}

function showAfConfirmDialog({
  title = "Xac nhan",
  message = "Ban co chac chan?",
  confirmText = "Dong y",
  cancelText = "Huy",
} = {}) {
  return new Promise((resolve) => {
    const uiRoot = document.documentElement || document.body;
    if (!uiRoot) {
      resolve(false);
      return;
    }

    const old = document.getElementById("af-confirm-overlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "af-confirm-overlay";
    overlay.setAttribute("data-dd-privacy", "hidden");
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      backdrop-filter: blur(2px);
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      width: min(460px, 96vw);
      background: linear-gradient(180deg, rgba(18, 27, 52, 0.98), rgba(9, 15, 32, 0.98));
      border: 1px solid #8e44ad;
      border-radius: 14px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.55);
      color: #eef3ff;
      font-family: 'Segoe UI', Arial, sans-serif;
      padding: 16px;
    `;

    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.cssText = "font-size:16px;font-weight:700;margin:0 0 8px 0;color:#ffffff;";

    const msgEl = document.createElement("div");
    msgEl.textContent = message;
    msgEl.style.cssText = "font-size:13px;line-height:1.45;color:#c8d4ef;margin:0 0 14px 0;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = cancelText;
    cancelBtn.style.cssText = `
      all: unset;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 9px;
      background: #2c3e50;
      color: #e6edf8;
      font: 700 12px 'Segoe UI', Arial, sans-serif;
    `;

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.textContent = confirmText;
    okBtn.style.cssText = `
      all: unset;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 9px;
      background: linear-gradient(135deg, #8e44ad, #5b7cfa);
      color: #ffffff;
      font: 700 12px 'Segoe UI', Arial, sans-serif;
      box-shadow: 0 6px 16px rgba(91, 124, 250, 0.35);
    `;

    const close = (result) => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };

    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(titleEl);
    box.appendChild(msgEl);
    box.appendChild(actions);
    overlay.appendChild(box);
    uiRoot.appendChild(overlay);
    document.addEventListener("keydown", onKeyDown, true);
    okBtn.focus();
  });
}

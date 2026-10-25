const http = require("http");
const https = require("https");
const http2 = require("http2");
const tls = require("tls");
const dns = require("dns");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { execSync } = require("child_process");
const forge = require("node-forge");

// ── Paths & Config ────────────────────────────────────────────────────────────
const APP_DIR = __dirname;
const CONFIG_FILE = path.join(APP_DIR, "config.json");
const LOCAL_CERTS_DIR = path.join(APP_DIR, "certs");

const SYSTEM_APPDATA = process.platform === "win32"
  ? (process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Roaming") : APP_DIR))
  : path.join(process.env.HOME || "/tmp", ".ainoname");
const PERSISTENT_CERTS_DIR = path.join(SYSTEM_APPDATA, "AiNoName", "certs");

const ROAMING_9ROUTER_CERT = path.join(SYSTEM_APPDATA, "9router", "mitm", "rootCA.crt");
const ROAMING_9ROUTER_KEY = path.join(SYSTEM_APPDATA, "9router", "mitm", "rootCA.key");

let CERTS_DIR = PERSISTENT_CERTS_DIR;
let ROOT_KEY_PATH = path.join(CERTS_DIR, "rootCA.key");
let ROOT_CERT_PATH = path.join(CERTS_DIR, "rootCA.crt");
const HOSTS_FILE = process.platform === "win32"
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32\\drivers\\etc\\hosts")
  : "/etc/hosts";

const HOSTS_TAG_START = "# >>> AINONAME ANTIGRAVITY DNS START >>>";
const HOSTS_TAG_END   = "# <<< AINONAME ANTIGRAVITY DNS END <<<";
const TARGET_DOMAINS  = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com"
];

const HOST_REWRITE = {
  "cloudcode-pa.googleapis.com": "daily-cloudcode-pa.googleapis.com",
};

const ANTIGRAVITY_IDE_VERSION = "2.24.0";

let config = {
  gatewayUrl: "https://ainoname.site",
  clientKey: "",
  autoDns: true,
  webPort: 20129,
  mitmPort: 443,
  modelMapping: {
    "gemini-3.8-flash-high": "ag/gemini-3.8-flash-high",
    "claude-sonnet-4-6": "ag/claude-sonnet-4-6",
    "claude-opus-4-6-thinking": "ag/claude-opus-4-6-thinking",
    "gpt-oss-120b-medium": "ag/gpt-oss-120b-medium"
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      config = { ...config, ...data };
    } else {
      saveConfig();
    }
  } catch (e) {
    console.error("Lỗi đọc config.json:", e.message);
  }
  if (process.env.GATEWAY_URL) {
    config.gatewayUrl = process.env.GATEWAY_URL.trim().replace(/\/+$/, "");
  }
  if (process.env.CLIENT_KEY) {
    config.clientKey = process.env.CLIENT_KEY.trim();
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.error("Lỗi ghi config.json:", e.message);
  }
}

// ── In-Memory Logs ────────────────────────────────────────────────────────────
const logQueue = [];
function log(msg, type = "info") {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  logQueue.push({ msg, type, time: Date.now() });
  if (logQueue.length > 300) logQueue.shift();
}

// ── Public DNS Resolver (bypasses hosts loop) ────────────────────────────────
const cachedTargetIPs = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTargetIP(hostname) {
  const cached = cachedTargetIPs[hostname];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ip;
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  try {
    const addresses = await resolve4(hostname);
    if (addresses && addresses.length > 0) {
      cachedTargetIPs[hostname] = { ip: addresses[0], ts: Date.now() };
      return addresses[0];
    }
  } catch (e) {}
  return "172.217.118.4"; // Reliable fallback Google IP
}

// ── ALPN Negotiation Cache (HTTP/2 vs HTTP/1.1) ──────────────────────────────
const alpnCache = new Map();
async function negotiateAlpn(host) {
  if (alpnCache.has(host)) return alpnCache.get(host);
  const ip = await resolveTargetIP(host);
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: ip,
      port: 443,
      servername: host,
      ALPNProtocols: ["h2", "http/1.1"],
      rejectUnauthorized: false,
    }, () => {
      const proto = socket.alpnProtocol || "http/1.1";
      alpnCache.set(host, proto);
      socket.end();
      resolve(proto);
    });
    socket.once("error", () => resolve("http/1.1"));
    socket.setTimeout(4000, () => {
      socket.destroy();
      resolve("http/1.1");
    });
  });
}

// ── Root CA & Leaf Cert Generation (node-forge with serverAuth) ───────────────
let rootCAKeyPem, rootCACertPem, rootCAForge;

function ensureRootCA() {
  // Priority 1: Check if 9Router Root CA exists (to share cert and prevent conflicts)
  if (fs.existsSync(ROAMING_9ROUTER_CERT) && fs.existsSync(ROAMING_9ROUTER_KEY)) {
    try {
      rootCAKeyPem = fs.readFileSync(ROAMING_9ROUTER_KEY, "utf8");
      rootCACertPem = fs.readFileSync(ROAMING_9ROUTER_CERT, "utf8");
      rootCAForge = {
        key: forge.pki.privateKeyFromPem(rootCAKeyPem),
        cert: forge.pki.certificateFromPem(rootCACertPem)
      };
      CERTS_DIR = path.dirname(ROAMING_9ROUTER_CERT);
      ROOT_KEY_PATH = ROAMING_9ROUTER_KEY;
      ROOT_CERT_PATH = ROAMING_9ROUTER_CERT;
      try {
        fs.mkdirSync(LOCAL_CERTS_DIR, { recursive: true });
        fs.writeFileSync(path.join(LOCAL_CERTS_DIR, "rootCA.key"), rootCAKeyPem, "utf8");
        fs.writeFileSync(path.join(LOCAL_CERTS_DIR, "rootCA.crt"), rootCACertPem, "utf8");
      } catch {}
      log("Sử dụng chứng chỉ 9Router Root CA tương thích hệ thống", "info");
      return;
    } catch (e) {
      console.warn("Lỗi đọc 9Router CA:", e.message);
    }
  }

  // Priority 2: Use existing persistent certs
  const persistentKey = path.join(PERSISTENT_CERTS_DIR, "rootCA.key");
  const persistentCert = path.join(PERSISTENT_CERTS_DIR, "rootCA.crt");
  if (fs.existsSync(persistentKey) && fs.existsSync(persistentCert)) {
    try {
      rootCAKeyPem = fs.readFileSync(persistentKey, "utf8");
      rootCACertPem = fs.readFileSync(persistentCert, "utf8");
      rootCAForge = {
        key: forge.pki.privateKeyFromPem(rootCAKeyPem),
        cert: forge.pki.certificateFromPem(rootCACertPem)
      };
      CERTS_DIR = PERSISTENT_CERTS_DIR;
      ROOT_KEY_PATH = persistentKey;
      ROOT_CERT_PATH = persistentCert;
      try {
        fs.mkdirSync(LOCAL_CERTS_DIR, { recursive: true });
        fs.writeFileSync(path.join(LOCAL_CERTS_DIR, "rootCA.key"), rootCAKeyPem, "utf8");
        fs.writeFileSync(path.join(LOCAL_CERTS_DIR, "rootCA.crt"), rootCACertPem, "utf8");
      } catch {}
      return;
    } catch (e) {}
  }

  // Priority 3: Create new Root CA in persistent dir
  fs.mkdirSync(PERSISTENT_CERTS_DIR, { recursive: true });
  try { fs.mkdirSync(LOCAL_CERTS_DIR, { recursive: true }); } catch {}

  log("🔐 Đang tạo mới chứng chỉ Root CA bảo mật vĩnh viễn...", "info");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: "AiNoName Antigravity Root CA" },
    { name: "organizationName", value: "AiNoName" },
    { name: "countryName", value: "VN" }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  rootCAKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  rootCACertPem = forge.pki.certificateToPem(cert);

  CERTS_DIR = PERSISTENT_CERTS_DIR;
  ROOT_KEY_PATH = persistentKey;
  ROOT_CERT_PATH = persistentCert;

  fs.writeFileSync(persistentKey, rootCAKeyPem, "utf8");
  fs.writeFileSync(persistentCert, rootCACertPem, "utf8");
  try {
    fs.writeFileSync(path.join(LOCAL_CERTS_DIR, "rootCA.key"), rootCAKeyPem, "utf8");
    fs.writeFileSync(path.join(LOCAL_CERTS_DIR, "rootCA.crt"), rootCACertPem, "utf8");
  } catch {}

  rootCAForge = {
    key: keys.privateKey,
    cert: cert
  };
  log("✅ Đã sinh chứng chỉ Root CA thành công", "success");
}

function installRootCAToWindows() {
  if (process.platform !== "win32") return true;

  // 1. Set NODE_EXTRA_CA_CERTS so Antigravity Electron/Node.js language server trusts the cert!
  process.env.NODE_EXTRA_CA_CERTS = ROOT_CERT_PATH;
  try {
    execSync(`setx NODE_EXTRA_CA_CERTS "${ROOT_CERT_PATH}"`, { stdio: "ignore", windowsHide: true });
    try { execSync(`setx NODE_EXTRA_CA_CERTS "${ROOT_CERT_PATH}" /M`, { stdio: "ignore", windowsHide: true }); } catch {}
    log("🔐 Đã cấu hình NODE_EXTRA_CA_CERTS cho Antigravity IDE", "success");
  } catch (e) {
    console.warn("Lỗi setx NODE_EXTRA_CA_CERTS:", e.message);
  }

  // 2. Install to Windows Trusted Root Authorities (LocalMachine and CurrentUser)
  try {
    log("🔐 Đang cập nhật Root CA vào Windows Trust Store...", "info");
    try { execSync(`certutil -addstore -f "Root" "${ROOT_CERT_PATH}"`, { stdio: "pipe" }); } catch {}
    try { execSync(`certutil -user -addstore -f "Root" "${ROOT_CERT_PATH}"`, { stdio: "pipe" }); } catch {}
    log("✅ Đã cập nhật Root CA vào Trusted Authorities thành công!", "success");
    return true;
  } catch (e) {
    log("⚠️ Không thể cài cert tự động: " + e.message, "warn");
    return false;
  }
}

function launchAntigravityIde() {
  if (process.platform !== "win32") {
    return { ok: false, message: "Chức năng chỉ hỗ trợ trên Windows" };
  }
  try {
    log("🔄 Đang đóng các tiến trình Antigravity IDE cũ...", "info");
    try {
      execSync('taskkill /F /IM "Antigravity IDE.exe" /IM "Antigravity.exe" /IM "language_server_windows_x64.exe"', { stdio: "ignore", windowsHide: true });
    } catch {}

    const candidates = [
      path.join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "Antigravity IDE", "Antigravity IDE.exe"),
      path.join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "Antigravity", "Antigravity.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Antigravity IDE", "Antigravity IDE.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Antigravity IDE", "Antigravity IDE.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Antigravity IDE", "Antigravity IDE.exe"),
    ];

    const targetExe = candidates.find(p => fs.existsSync(p));
    const childEnv = { ...process.env, NODE_EXTRA_CA_CERTS: ROOT_CERT_PATH };

    const { spawn } = require("child_process");
    if (targetExe) {
      log(`🚀 Khởi chạy Antigravity IDE từ: ${targetExe}`, "success");
      const child = spawn(targetExe, [], { detached: true, stdio: "ignore", env: childEnv });
      child.unref();
      return { ok: true, message: "Đã khởi động Antigravity IDE với chứng chỉ SSL thành công!" };
    } else {
      log("🚀 Khởi chạy Antigravity IDE qua lệnh shell...", "info");
      const child = spawn("cmd.exe", ["/c", "start", "antigravity"], { detached: true, stdio: "ignore", env: childEnv });
      child.unref();
      return { ok: true, message: "Đã gửi lệnh mở Antigravity IDE với chứng chỉ SSL!" };
    }
  } catch (e) {
    log(`❌ Lỗi khởi chạy IDE: ${e.message}`, "warn");
    return { ok: false, message: e.message };
  }
}

const certCache = new Map();
function getSecureContextForDomain(domain) {
  if (certCache.has(domain)) return certCache.get(domain);

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 1000000).toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  cert.setSubject([{ name: "commonName", value: domain }]);
  cert.setIssuer(rootCAForge.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true }, // Mandatory for TLS client verification!
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: domain },
        { type: 2, value: `*.${domain}` }
      ]
    }
  ]);
  cert.sign(rootCAForge.key, forge.md.sha256.create());

  const leafKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const leafCertPem = forge.pki.certificateToPem(cert);

  const ctx = tls.createSecureContext({
    key: leafKeyPem,
    cert: `${leafCertPem}\n${rootCACertPem}`
  });
  certCache.set(domain, ctx);
  return ctx;
}

// ── Hosts / DNS Management ────────────────────────────────────────────────────
function isDNSActive() {
  try {
    if (!fs.existsSync(HOSTS_FILE)) return false;
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    return content.includes(HOSTS_TAG_START) || /127\.0\.0\.1\s+.*cloudcode-pa\.googleapis\.com/i.test(content);
  } catch {
    return false;
  }
}

function enableDNS() {
  try {
    disableDNS();
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const lines = [
      "",
      HOSTS_TAG_START,
      ...TARGET_DOMAINS.map(d => `127.0.0.1 ${d}`),
      HOSTS_TAG_END,
      ""
    ].join("\r\n");

    fs.writeFileSync(HOSTS_FILE, content + lines, "utf8");
    try { execSync("ipconfig /flushdns", { stdio: "ignore", windowsHide: true }); } catch {}
    log("🌐 Đã kích hoạt chuyển hướng DNS Hosts cho Antigravity IDE!", "success");
    return true;
  } catch (e) {
    log("❌ Không thể ghi file hosts (Cần quyền Administrator): " + e.message, "warn");
    return false;
  }
}

function disableDNS() {
  try {
    if (!fs.existsSync(HOSTS_FILE)) return true;
    let content = fs.readFileSync(HOSTS_FILE, "utf8");
    const startIndex = content.indexOf(HOSTS_TAG_START);
    if (startIndex !== -1) {
      const endIndex = content.indexOf(HOSTS_TAG_END);
      if (endIndex !== -1) {
        content = content.slice(0, startIndex) + content.slice(endIndex + HOSTS_TAG_END.length);
      }
    }
    content = content.replace(/^[ \t]*127\.0\.0\.1[ \t]+.*cloudcode-pa\.googleapis\.com.*(\r?\n)?/gmi, "");
    content = content.replace(/^[ \t]*127\.0\.0\.1[ \t]+.*daily-cloudcode-pa\.googleapis\.com.*(\r?\n)?/gmi, "");
    fs.writeFileSync(HOSTS_FILE, content.trim() + "\r\n", "utf8");
    try { execSync("ipconfig /flushdns", { stdio: "ignore", windowsHide: true }); } catch {}
    try {
      execSync('powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable(\'NODE_EXTRA_CA_CERTS\', $null, \'User\')"', { stdio: "ignore", windowsHide: true });
    } catch {}
    delete process.env.NODE_EXTRA_CA_CERTS;
    log("🌐 Đã khôi phục cài đặt DNS Hosts mặc định và làm sạch mạng.", "info");
    return true;
  } catch (e) {
    log("⚠️ Lỗi dọn dẹp file hosts: " + e.message, "warn");
    return false;
  }
}

// Ensure cleanup on process termination
process.on("SIGINT", () => { disableDNS(); process.exit(); });
process.on("SIGTERM", () => { disableDNS(); process.exit(); });
process.on("exit", () => { disableDNS(); });

// ── Kill Process on Port 443 before binding ──────────────────────────────────
function killPort(port) {
  if (process.platform !== "win32") return;

  // Clear 9Router MITM PID/lock so background 9Router won't auto-restart and loop fight
  try {
    const roamingMitm = path.join(process.env.APPDATA || "", "9router", "mitm");
    const pidFile = path.join(roamingMitm, ".mitm.pid");
    const lockFile = path.join(roamingMitm, ".mitm.lock");
    if (fs.existsSync(pidFile)) {
      try {
        const p = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
        if (p && p > 4 && p !== process.pid) {
          execSync(`taskkill /F /PID ${p}`, { stdio: "ignore", windowsHide: true });
        }
      } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
    }
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile); } catch {}
    }
  } catch {}

  try {
    const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
      `"Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`;
    const out = execSync(psCmd, { encoding: "utf-8", windowsHide: true }).trim();
    if (!out) return;
    const pids = out.split(/\r?\n/).map(s => s.trim()).filter(p => p && Number(p) !== process.pid && Number(p) > 4);
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
        log(`Đã giải phóng port ${port} (PID ${pid})`);
      } catch {}
    }
  } catch {}
}

// ── Upstream Passthrough (HTTP/2 & HTTP/1.1) ──────────────────────────────────
async function passthroughHttp2(req, res, bodyBuffer, headers, targetHost) {
  const targetIP = await resolveTargetIP(targetHost);
  const h2Headers = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "host" || lk === "connection" || lk === "keep-alive" ||
        lk === "transfer-encoding" || lk === "upgrade" || lk === "proxy-connection") continue;
    h2Headers[lk] = v;
  }
  h2Headers[":method"] = req.method;
  h2Headers[":path"] = req.url;
  h2Headers[":scheme"] = "https";
  h2Headers[":authority"] = targetHost;

  return new Promise((resolve) => {
    const client = http2.connect(`https://${targetHost}`, {
      createConnection: () => tls.connect({
        host: targetIP,
        port: 443,
        servername: targetHost,
        ALPNProtocols: ["h2"],
        rejectUnauthorized: false,
      }),
    });

    client.once("error", (e) => {
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end("Bad Gateway");
      try { client.close(); } catch {}
      resolve();
    });

    const stream = client.request(h2Headers, { endStream: bodyBuffer.length === 0 });
    if (bodyBuffer.length > 0) stream.end(bodyBuffer);

    stream.once("response", (responseHeaders) => {
      const status = responseHeaders[":status"] || 200;
      const outHeaders = {};
      for (const [k, v] of Object.entries(responseHeaders)) {
        if (k.startsWith(":")) continue;
        if (k === "connection" || k === "keep-alive" || k === "transfer-encoding") continue;
        outHeaders[k] = v;
      }
      res.writeHead(status, outHeaders);
      stream.pipe(res);
      stream.on("end", () => {
        try { client.close(); } catch {}
        resolve();
      });
    });

    stream.once("error", () => {
      if (!res.headersSent) res.writeHead(502);
      if (!res.writableEnded) res.end();
      try { client.close(); } catch {}
      resolve();
    });
  });
}

async function passthroughHttps(req, res, bodyBuffer, headers, targetHost) {
  const targetIP = await resolveTargetIP(targetHost);
  return new Promise((resolve) => {
    const forwardReq = https.request({
      hostname: targetIP,
      port: 443,
      path: req.url,
      method: req.method,
      headers: { ...headers, host: targetHost },
      servername: targetHost,
      rejectUnauthorized: false,
      timeout: 10000
    }, (forwardRes) => {
      res.writeHead(forwardRes.statusCode, forwardRes.headers);
      forwardRes.pipe(res);
      forwardRes.on("end", resolve);
    });

    forwardReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Bad Gateway");
      resolve();
    });

    if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
    forwardReq.end();
  });
}

async function passthrough(req, res, bodyBuffer) {
  const originalHost = (req.headers.host || "daily-cloudcode-pa.googleapis.com").split(":")[0];
  const isChatEndpoint = req.url.includes(":generateContent") || req.url.includes(":streamGenerateContent");
  
  // CRITICAL: daily-cloudcode-pa rejects auth/login requests!
  // Only rewrite host for chat endpoints; keep cloudcode-pa for auth/onboarding!
  const targetHost = isChatEndpoint ? (HOST_REWRITE[originalHost] || originalHost) : originalHost;

  try {
    const proto = await negotiateAlpn(targetHost);
    if (proto === "h2") {
      return await passthroughHttp2(req, res, bodyBuffer, req.headers, targetHost);
    }
  } catch (e) {}

  return passthroughHttps(req, res, bodyBuffer, req.headers, targetHost);
}

// ── Helper: Model Extraction & Schema Sanitization (Learned from 9router) ──
function extractModel(url, body) {
  let urlModel = null;
  if (url) {
    const m = url.match(/\/models\/([^/:]+)/);
    if (m) urlModel = m[1];
  }
  let model = urlModel || body.model || body.request?.model || null;
  const cleanModelName = String(model || "").replace(/^models\//, "");

  if (cleanModelName === "gemini-3.6-flash-tiered" || cleanModelName === "gemini-3.7-flash-tiered" || cleanModelName === "gemini-3.8-flash-tiered") {
    const ver = cleanModelName.includes("3.8") ? "3.8" : cleanModelName.includes("3.7") ? "3.7" : "3.6";
    const rawLevel = body.request?.generationConfig?.thinkingConfig?.thinkingLevel
      || body.generationConfig?.thinkingConfig?.thinkingLevel;
    const level = ["high", "medium", "low"].includes(String(rawLevel).toLowerCase())
      ? String(rawLevel).toLowerCase()
      : "high";
    return `gemini-${ver}-flash-${level}`;
  }

  if (!cleanModelName) return "gemini-3.8-flash-high";
  if (/flash.*extra.*low|extra.*low.*flash|flash.*low|low.*flash/i.test(cleanModelName)) return "gemini-3.8-flash-low";
  if (/flash.*medium|medium.*flash/i.test(cleanModelName)) return "gemini-3.8-flash-medium";
  if (/flash.*agent|agent.*flash|flash/i.test(cleanModelName)) return "gemini-3.8-flash-high";
  if (/opus.*5[.-]5|5[.-]5.*opus/i.test(cleanModelName)) return "claude-opus-5-5";
  if (/sonnet.*5[.-]5|5[.-]5.*sonnet/i.test(cleanModelName)) return "claude-sonnet-5-5";
  if (/opus/i.test(cleanModelName)) return "claude-opus-4-6-thinking";
  if (/sonnet|claude/i.test(cleanModelName)) return "claude-sonnet-4-6";
  if (/gpt.*oss|oss/i.test(cleanModelName)) return "gpt-oss-120b-medium";

  return cleanModelName;
}

function resolveMappedModel(extractedModel) {
  if (config.modelMapping[extractedModel]) {
    return config.modelMapping[extractedModel];
  }
  for (const [k, v] of Object.entries(config.modelMapping)) {
    if (extractedModel.includes(k) || k.includes(extractedModel)) {
      return v;
    }
  }
  return config.modelMapping["gemini-3.8-flash-high"] || extractedModel;
}

function cleanToolSchemas(tools) {
  if (!Array.isArray(tools)) return;
  const bannedKeywords = [
    "$schema", "$defs", "definitions", "additionalProperties", "title",
    "minLength", "maxLength", "default", "examples", "propertyNames", "patternProperties"
  ];
  const sanitize = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of bannedKeywords) delete obj[k];
    if (obj.properties && typeof obj.properties === "object") {
      for (const val of Object.values(obj.properties)) sanitize(val);
    }
    if (obj.items && typeof obj.items === "object") {
      sanitize(obj.items);
    }
  };
  for (const group of tools) {
    if (Array.isArray(group.functionDeclarations)) {
      for (const fn of group.functionDeclarations) {
        if (fn.parameters) sanitize(fn.parameters);
      }
    }
  }
}

// ── MITM HTTPS Proxy (Port 443) ───────────────────────────────────────────────
let mitmServer = null;

function startMitmServer() {
  ensureRootCA();
  installRootCAToWindows();
  killPort(443);

  const sslOptions = {
    key: rootCAKeyPem,
    cert: rootCACertPem,
    SNICallback: (servername, cb) => {
      try {
        const ctx = getSecureContextForDomain(servername || "daily-cloudcode-pa.googleapis.com");
        cb(null, ctx);
      } catch (err) {
        cb(err);
      }
    }
  };

  mitmServer = https.createServer(sslOptions, async (req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks);
      let body = {};
      try { body = JSON.parse(rawBody.toString("utf8")); } catch {}

      // ── Detect chat prompt vs onboarding/telemetry ─────────────────────────
      const hasChatEndpoint = req.url.includes(":generateContent") || req.url.includes(":streamGenerateContent");
      const hasContents = !!(body.request?.contents || body.contents);
      const isChat = hasChatEndpoint && hasContents;

      // Tab-autocomplete (tab_jump_flash_lite_preview) must stay native passthrough
      const modelName = body.model || body.request?.model || "";
      const isTabCompletion = /^tab[_-]/i.test(modelName);

      if (!isChat || isTabCompletion) {
        return passthrough(req, res, rawBody);
      }

      // ── Handle Chat Prompt Routing to Gateway ──────────────────────────────
      const isStream = req.url.includes(":streamGenerateContent");
      try {
        const originalModel = extractModel(req.url, body);
        const mappedModel = resolveMappedModel(originalModel);

        log(`🚀 Gửi câu hỏi Antigravity: [${originalModel}] ➔ [${mappedModel}]`, "info");
        body.model = mappedModel;
        body.userAgent = "antigravity";

        // Strip blacklisted fields that trigger quota/schema errors on Google Gemini
        delete body.requestType;
        if (body.request) {
          delete body.request.requestType;
          delete body.request.thinking;
          delete body.request.output_config;
          delete body.request.reasoning_effort;
        }

        // Clean tool schemas to prevent Gemini 400 Bad Request
        if (body.request?.tools) {
          cleanToolSchemas(body.request.tools);
        }

        // Apply Antigravity IDE version metadata override
        if (body.metadata && typeof body.metadata === "object") {
          body.metadata.ideVersion = ANTIGRAVITY_IDE_VERSION;
        }

        const cleanGateway = (config.gatewayUrl || "https://ainoname.site")
          .trim()
          .replace(/\/+$/, "")
          .replace(/\/v1$/, "");
        const forwardUrl = `${cleanGateway}/v1/chat/completions`;

        const forwardHeaders = {
          "Content-Type": "application/json",
          "x-request-source": "local",
        };
        if (config.clientKey) {
          forwardHeaders["Authorization"] = `Bearer ${config.clientKey}`;
        }
        if (req.headers["user-agent"]) {
          forwardHeaders["User-Agent"] = req.headers["user-agent"].replace(/antigravity\/[^\s]+/, `antigravity/${ANTIGRAVITY_IDE_VERSION}`);
        }

        let forwardRes = null;
        let status = 200;
        let lastErrDetail = "";
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            log(`🔄 Đang thử lại kết nối Gateway (Lần ${attempt}/${maxRetries})...`, "warn");
            await new Promise(r => setTimeout(r, 1500));
          }

          try {
            forwardRes = await fetch(forwardUrl, {
              method: "POST",
              headers: forwardHeaders,
              body: JSON.stringify(body)
            });
            status = forwardRes.status || 200;

            if (status === 200) {
              break;
            }

            const errText = await forwardRes.text();
            try {
              const errObj = JSON.parse(errText);
              lastErrDetail = errObj.error?.message || errObj.message || errText;
            } catch {
              lastErrDetail = errText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
            }

            // Retry on transient Cloudflare/Gateway errors: 520, 524, 502, 503, 504
            if ([520, 524, 502, 503, 504].includes(status) && attempt < maxRetries) {
              log(`⚠️ Gateway tạm thời bận (${status}): ${lastErrDetail}. Sẽ thử lại ngay...`, "warn");
              continue;
            }

            break;
          } catch (fetchErr) {
            lastErrDetail = fetchErr.message;
            if (attempt < maxRetries) {
              log(`⚠️ Lỗi mạng Gateway (${fetchErr.message}). Sẽ thử lại ngay...`, "warn");
              continue;
            }
            break;
          }
        }

        if (!forwardRes || status !== 200) {
          log(`❌ Gateway trả về lỗi (${status}): ${lastErrDetail}`, "warn");

          if (isStream) {
            if (!res.headersSent) {
              res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
            }
            res.end(`data: ${JSON.stringify({ error: { code: status || 502, message: `[AiNoName Gateway Lỗi ${status}]: ${lastErrDetail}`, status: "UNAVAILABLE" } })}\r\n\r\n`);
          } else {
            if (!res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                error: {
                  code: 502,
                  message: `[AiNoName Gateway Lỗi ${status}]: ${lastErrDetail}`,
                  status: "UNAVAILABLE"
                }
              }));
            } else {
              res.end();
            }
          }
          return;
        }

        const ct = forwardRes.headers.get("content-type") || (isStream ? "text/event-stream" : "application/json");
        const resHeaders = {
          "Content-Type": ct,
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        };
        if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
        res.writeHead(status, resHeaders);

        if (!forwardRes.body) {
          const text = await forwardRes.text();
          res.end(text);
          log(`Trả lời Antigravity [${mappedModel}] hoàn tất (Status: ${status})`, "success");
          return;
        }

        const reader = forwardRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
        log(`Trả lời Antigravity [${mappedModel}] hoàn tất (Status: ${status})`, "success");
      } catch (err) {
        log(`Lỗi MITM Proxy: ${err.message}`, "warn");
        if (isStream) {
          if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end(`data: ${JSON.stringify({ error: { message: err.message } })}\r\n\r\n`);
        } else {
          if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      }
    });
  });

  mitmServer.listen(config.mitmPort || 443, "127.0.0.1", () => {
    log(`🛡️ Máy chủ MITM HTTPS (HTTP/2 + HTTP/1.1) đang lắng nghe tại 127.0.0.1:443`, "success");
  });

  mitmServer.on("tlsClientError", (err) => {
    log(`⚠️ Antigravity từ chối chứng chỉ TLS (${err.message})! Nếu IDE báo lỗi, hãy bấm nút "MỞ / RESET ANTIGRAVITY IDE" trên Dashboard hoặc chạy file "Khoi-Dong-Antigravity.bat"`, "warn");
  });

  mitmServer.on("clientError", (err) => {
    if (err.code !== "ECONNRESET") {
      log(`⚠️ Lỗi kết nối client: ${err.message}`, "warn");
    }
  });

  mitmServer.on("error", err => {
    if (err.code === "EADDRINUSE") {
      log(`❌ Cổng 443 đang bị ứng dụng khác chiếm giữ!`, "warn");
    } else {
      log(`Lỗi máy chủ MITM: ${err.message}`, "warn");
    }
  });
}

// ── Web UI Server (Port 20129) ────────────────────────────────────────────────
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function startWebServer() {
  let htmlContent = "";
  const candidatePaths = [
    path.join(__dirname, "ui.html"),
    path.join(__dirname, "src", "ui.html")
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try { htmlContent = fs.readFileSync(p, "utf8"); break; } catch {}
    }
  }

  const webServer = http.createServer((req, res) => {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
      return;
    }

    if (pathname === "/api/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        dnsActive: isDNSActive(),
        gatewayUrl: config.gatewayUrl,
        clientKey: config.clientKey || "",
        rawClientKey: config.clientKey || "",
        certExists: true,
        certTrusted: true,
        serverRunning: true,
        modelMapping: config.modelMapping,
        logs: logQueue.slice(-100),
      }));
      return;
    }

    if ((pathname === "/api/settings" || pathname === "/api/config") && req.method === "POST") {
      let b = "";
      req.on("data", c => b += c);
      req.on("end", () => {
        try {
          const payload = JSON.parse(b);
          if (payload.gatewayUrl !== undefined) {
            config.gatewayUrl = payload.gatewayUrl.trim().replace(/\/+$/, "");
            log(`🌐 Đã đổi Gateway URL sang: ${config.gatewayUrl}`, "info");
          }
          if (payload.clientKey !== undefined) {
            config.clientKey = payload.clientKey.trim();
            log(`🔑 Đã cập nhật Client Key mới`, "info");
          }
          if (payload.modelMapping) {
            config.modelMapping = { ...config.modelMapping, ...payload.modelMapping };
            log(`🔄 Đã cập nhật Model Mapping`, "info");
          }
          saveConfig();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, success: true, gatewayUrl: config.gatewayUrl, clientKey: config.clientKey }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === "/api/mapping" && req.method === "POST") {
      let b = "";
      req.on("data", c => b += c);
      req.on("end", () => {
        try {
          const payload = JSON.parse(b);
          config.modelMapping = { ...config.modelMapping, ...payload };
          log(`🔄 Đã cập nhật Model Mapping: ${JSON.stringify(payload)}`, "info");
          saveConfig();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, modelMapping: config.modelMapping }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (pathname === "/api/check-key") {
      if (!config.clientKey) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, label: "Chưa cấu hình", quota_info: "Chưa nhập Client Key" }));
        return;
      }
      (async () => {
        try {
          const cleanGw = (config.gatewayUrl || "https://ainoname.site").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
          const checkUrl = `${cleanGw}/api/client-keys/check`;
          const r = await fetch(checkUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: config.clientKey })
          });
          const d = await r.json();
          if (d.valid && d.keyData) {
            const usedMB = (Number(d.keyData.used_tokens || 0) / 1000000).toFixed(2);
            const quotaMB = d.keyData.quota_tokens > 0 ? (Number(d.keyData.quota_tokens) / 1000000).toFixed(0) + "M tokens" : "Không giới hạn";
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              label: d.keyData.label || "Khách Hàng AiNoName",
              quota_info: `Đang hoạt động (${usedMB}M / ${quotaMB})`,
              keyData: d.keyData
            }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: false,
              label: "Không hợp lệ",
              quota_info: d.error || "Key không tồn tại hoặc hết hạn"
            }));
          }
        } catch (err) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: false,
            label: "Lỗi kết nối Gateway",
            quota_info: `Không thể kết nối ${config.gatewayUrl}`
          }));
        }
      })();
      return;
    }

    if (pathname === "/api/logs" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(logQueue.slice(-100)));
      return;
    }

    if (pathname === "/api/dns/enable" && req.method === "POST") {
      const ok = enableDNS();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok, success: ok, dnsActive: isDNSActive() }));
      return;
    }

    if (pathname === "/api/launch-ide" && req.method === "POST") {
      const resData = launchAntigravityIde();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resData));
      return;
    }

    if (pathname === "/api/dns/disable" && req.method === "POST") {
      const ok = disableDNS();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok, success: ok, dnsActive: isDNSActive() }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  webServer.listen(config.webPort || 20129, "127.0.0.1", () => {
    log(`🚀 Giao diện Dashboard Client sẵn sàng tại: http://localhost:${config.webPort || 20129}`, "success");
  });
}

// ── Startup ──────────────────────────────────────────────────────────────────
function main() {
  loadConfig();

  const maskedKey = config.clientKey
    ? config.clientKey.slice(0, 10) + "..." + config.clientKey.slice(-4)
    : "<CHƯA CẤU HÌNH>";

  console.log("==================================================================");
  console.log("               AINONAME - ANTIGRAVITY IDE CLIENT                  ");
  console.log("==================================================================");
  console.log(`[*] Gateway Server: ${config.gatewayUrl}`);
  console.log(`[*] Client Key:     ${maskedKey}`);
  console.log(`[*] Dashboard UI:   http://localhost:${config.webPort || 20129}`);
  console.log("------------------------------------------------------------------");

  startMitmServer();
  startWebServer();

  if (config.autoDns) {
    enableDNS();
  }
}

main();

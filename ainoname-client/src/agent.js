const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const forge = require("node-forge");

// ── Paths & Config ────────────────────────────────────────────────────────────
const APP_DIR = process.cwd();
const CONFIG_FILE = path.join(APP_DIR, "config.json");
const CERTS_DIR = path.join(APP_DIR, "certs");
const ROOT_KEY_PATH = path.join(CERTS_DIR, "rootCA.key");
const ROOT_CERT_PATH = path.join(CERTS_DIR, "rootCA.crt");
const HOSTS_FILE = process.platform === "win32"
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32\\drivers\\etc\\hosts")
  : "/etc/hosts";

const HOSTS_TAG_START = "# >>> AINONAME ANTIGRAVITY DNS START >>>";
const HOSTS_TAG_END   = "# <<< AINONAME ANTIGRAVITY DNS END <<<";
const TARGET_DOMAINS  = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com"
];

let config = {
  gatewayUrl: "https://ainoname.site",
  clientKey: "ck-YOUR_CLIENT_KEY_HERE",
  webPort: 20129,
  mitmPort: 443,
  modelMapping: {
    "gemini-3.8-flash-high": "gemini-3.8-flash-high",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium": "gpt-oss-120b-medium"
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
  if (logQueue.length > 100) logQueue.shift();
}

// ── Root CA & Leaf Cert Generation (node-forge) ──────────────────────────────
let rootCAKeyPem, rootCACertPem, rootCAForge;

function ensureRootCA() {
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });

  if (fs.existsSync(ROOT_KEY_PATH) && fs.existsSync(ROOT_CERT_PATH)) {
    rootCAKeyPem = fs.readFileSync(ROOT_KEY_PATH, "utf8");
    rootCACertPem = fs.readFileSync(ROOT_CERT_PATH, "utf8");
    rootCAForge = {
      key: forge.pki.privateKeyFromPem(rootCAKeyPem),
      cert: forge.pki.certificateFromPem(rootCACertPem)
    };
    return;
  }

  log("🔐 Đang tạo mới chứng chỉ Root CA...", "info");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: "AiNoName MITM Root CA" },
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

  fs.writeFileSync(ROOT_KEY_PATH, rootCAKeyPem, "utf8");
  fs.writeFileSync(ROOT_CERT_PATH, rootCACertPem, "utf8");

  rootCAForge = {
    key: keys.privateKey,
    cert: cert
  };
  log("✅ Đã sinh chứng chỉ Root CA thành công", "success");
}

function installRootCAToWindows() {
  if (process.platform !== "win32") return true;
  try {
    const check = execSync(`certutil -store Root "AiNoName MITM Root CA"`, { stdio: "pipe" }).toString();
    if (check.includes("AiNoName MITM Root CA")) return true;
  } catch {}

  try {
    log("🔐 Đang cài đặt Root CA vào Windows Trust Store...", "info");
    execSync(`certutil -addstore -f "Root" "${ROOT_CERT_PATH}"`, { stdio: "pipe" });
    log("✅ Đã thêm Root CA vào Trusted Authorities", "success");
    return true;
  } catch (e) {
    log("⚠️ Không thể cài cert tự động (cần chạy với quyền Administrator): " + e.message, "warn");
    return false;
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
    {
      name: "subjectAltName",
      altNames: [{ type: 2, value: domain }]
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
    return content.includes(HOSTS_TAG_START);
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
    log("🌐 Đã bật chuyển hướng DNS Hosts thành công!", "success");
    return true;
  } catch (e) {
    log("❌ Lỗi khi ghi file hosts: " + e.message, "warn");
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
        fs.writeFileSync(HOSTS_FILE, content.trim() + "\r\n", "utf8");
      }
    }
    log("🌐 Đã tắt DNS Hosts, khôi phục mặc định.", "info");
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

// ── MITM HTTPS Proxy (Port 443) ───────────────────────────────────────────────
let mitmServer = null;

function startMitmServer() {
  ensureRootCA();
  installRootCAToWindows();

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
    const isStream = req.url.includes(":streamGenerateContent");
    const chunks = [];

    req.on("data", chunk => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString();
        let body = {};
        try { body = JSON.parse(rawBody); } catch {}

        const originalModel = body.model || "gemini-3.8-flash-high";
        const mappedModel = config.modelMapping[originalModel] || originalModel;

        log(`Intercept Antigravity: [${originalModel}] ➔ [${mappedModel}]`, "info");
        body.model = mappedModel;

        const forwardUrl = `${config.gatewayUrl.replace(/\/+$/, "")}/v1/chat/completions`;
        const forwardRes = await fetch(forwardUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.clientKey}`
          },
          body: JSON.stringify(body)
        });

        const status = forwardRes.status || 200;
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
    log(`🛡️ Máy chủ MITM HTTPS đang lắng nghe tại 127.0.0.1:443`, "success");
  });

  mitmServer.on("error", err => {
    if (err.code === "EADDRINUSE") {
      log(`❌ Cổng 443 đang bị ứng dụng khác chiếm giữ! Vui lòng tắt ứng dụng đang dùng cổng 443.`, "warn");
    } else {
      log(`Lỗi máy chủ MITM: ${err.message}`, "warn");
    }
  });
}

// ── Web UI Server (Port 20129) ────────────────────────────────────────────────
function startWebServer() {
  const htmlPath = path.join(__dirname, "ui.html");
  let htmlContent = "";
  try {
    htmlContent = fs.readFileSync(htmlPath, "utf8");
  } catch {
    htmlContent = "<h1>AiNoName Client</h1>";
  }

  const webServer = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${config.webPort}`);
    const pathname = parsedUrl.pathname;

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
      return;
    }

    if (pathname === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        certExists: fs.existsSync(ROOT_CERT_PATH),
        certTrusted: true,
        serverRunning: mitmServer && mitmServer.listening,
        dnsActive: isDNSActive(),
        gatewayUrl: config.gatewayUrl,
        clientKey: config.clientKey,
        modelMapping: config.modelMapping
      }));
      return;
    }

    if (pathname === "/api/dns/enable" && req.method === "POST") {
      const ok = enableDNS();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }

    if (pathname === "/api/dns/disable" && req.method === "POST") {
      const ok = disableDNS();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }

    if (pathname === "/api/mapping" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const newMap = JSON.parse(body);
          config.modelMapping = { ...config.modelMapping, ...newMap };
          saveConfig();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, modelMapping: config.modelMapping }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }

    if (pathname === "/api/check-key" && req.method === "POST") {
      try {
        const checkUrl = `${config.gatewayUrl.replace(/\/+$/, "")}/api/client-keys/check`;
        const resp = await fetch(checkUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: config.clientKey })
        });
        const data = await resp.json();
        const active = data.active !== false;
        const limitStr = data.max_concurrent ? `${data.max_concurrent} conn / ${data.rate_limit_per_minute || 60} rpm` : "Không giới hạn";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          label: data.label || "Khách Hàng AiNoName",
          quota_info: active ? `Hoạt động (${limitStr})` : "Tạm khóa",
          active: active
        }));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          label: "Khách Hàng AiNoName",
          quota_info: "Đã kết nối Gateway"
        }));
      }
      return;
    }

    if (pathname === "/api/logs") {
      res.writeHead(200, { "Content-Type": "application/json" });
      const currentLogs = [...logQueue];
      logQueue.length = 0;
      res.end(JSON.stringify(currentLogs));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  webServer.listen(config.webPort || 20129, "127.0.0.1", () => {
    log(`🚀 Giao diện Dashboard Client sẵn sàng tại: http://localhost:${config.webPort}`, "success");
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────
function main() {
  loadConfig();
  console.log("==================================================================");
  console.log("               AINONAME - ANTIGRAVITY IDE CLIENT                  ");
  console.log("==================================================================");
  console.log(`[*] Gateway Server: ${config.gatewayUrl}`);
  console.log(`[*] Client Key:     ${config.clientKey.slice(0, 10)}...${config.clientKey.slice(-4)}`);
  console.log(`[*] Dashboard UI:   http://localhost:${config.webPort}`);
  console.log("------------------------------------------------------------------");

  startMitmServer();
  startWebServer();
}

main();

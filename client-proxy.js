/**
 * Standalone Client Proxy for Antigravity (Gemini Code Assist)
 * 
 * This script runs on a client machine (e.g., developer's laptop) to intercept
 * the official Google Gemini Code Assist / Cloud Code extension traffic and redirect
 * it to your remote Antigravity Pool Server.
 * 
 * Features:
 * - Automatically generates SSL certificates for Google domains using openssl.
 * - Installs the Root CA in the OS trust store (Windows, macOS, Linux).
 * - Adds redirection entries to the hosts file.
 * - Intercepts HTTPS traffic on port 443 and proxies it to your server.
 * - Requires no external npm dependencies (uses native Node.js libraries).
 * 
 * Usage:
 *   node client-proxy.js --server <YOUR_SERVER_URL> --key <YOUR_ANTIGRAVITY_API_KEY>
 * 
 * Note: Must be run with Administrator / Root privileges to update hosts and trust certs.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

// Configuration
let PORTAL_URL = 'https://vinhcousera.vercel.app';
let API_KEY = '';
const LOCAL_PORT = 443;
const TARGET_DOMAINS = [
  'cloudcode-pa.googleapis.com',
  'daily-cloudcode-pa.googleapis.com'
];

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--server' || args[i] === '-s') && args[i + 1]) {
    PORTAL_URL = args[i + 1].replace(/\/+$/, '');
    i++;
  } else if ((args[i] === '--key' || args[i] === '-k') && args[i + 1]) {
    API_KEY = args[i + 1].trim();
    i++;
  }
}

const CERT_DIR = path.join(process.cwd(), 'certs');
const CA_KEY_PATH = path.join(CERT_DIR, 'rootCA.key');
const CA_CERT_PATH = path.join(CERT_DIR, 'rootCA.pem');
const SERVER_KEY_PATH = path.join(CERT_DIR, 'server.key');
const SERVER_CERT_PATH = path.join(CERT_DIR, 'server.pem');

// Helper: ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString();
  let prefix = `[${time}] [INFO]`;
  if (type === 'success') prefix = `${colors.green}[${time}] [SUCCESS]${colors.reset}`;
  if (type === 'warn') prefix = `${colors.yellow}[${time}] [WARNING]${colors.reset}`;
  if (type === 'error') prefix = `${colors.red}[${time}] [ERROR]${colors.reset}`;
  console.log(`${prefix} ${msg}`);
}

// Check admin privileges
function checkPrivileges() {
  if (process.platform === 'win32') {
    try {
      execSync('net session', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  } else {
    return process.getuid && process.getuid() === 0;
  }
}

// Generate Certificates using OpenSSL
function generateCertificates() {
  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR);
  }

  // Check if certificates already exist
  if (fs.existsSync(CA_KEY_PATH) && fs.existsSync(CA_CERT_PATH) && fs.existsSync(SERVER_KEY_PATH) && fs.existsSync(SERVER_CERT_PATH)) {
    log('Chứng chỉ SSL cũ đã tồn tại, bỏ qua bước tạo mới.', 'info');
    return;
  }

  log('Đang khởi tạo chứng chỉ SSL Root CA giả lập...', 'info');

  try {
    // Check if openssl is available
    try {
      execSync('openssl version', { stdio: 'ignore' });
    } catch {
      throw new Error('Không tìm thấy lệnh "openssl" trong hệ thống PATH. Vui lòng cài đặt OpenSSL hoặc Git (đã đi kèm OpenSSL).');
    }

    // 1. Generate Root CA key & cert
    execSync(`openssl genrsa -out "${CA_KEY_PATH}" 2048`, { stdio: 'ignore' });
    execSync(`openssl req -x509 -new -nodes -key "${CA_KEY_PATH}" -sha256 -days 3650 -out "${CA_CERT_PATH}" -subj "/CN=Antigravity Root CA/O=Antigravity Proxy/C=VN"`, { stdio: 'ignore' });

    // 2. Create OpenSSL configuration for target domains
    const extFilePath = path.join(CERT_DIR, 'domains.ext');
    const extContent = `
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = cloudcode-pa.googleapis.com
DNS.2 = daily-cloudcode-pa.googleapis.com
DNS.3 = daily-cloudcode-pa.sandbox.googleapis.com
`;
    fs.writeFileSync(extFilePath, extContent.trim());

    // 3. Generate server key & CSR
    execSync(`openssl genrsa -out "${SERVER_KEY_PATH}" 2048`, { stdio: 'ignore' });
    execSync(`openssl req -new -key "${SERVER_KEY_PATH}" -out "${path.join(CERT_DIR, 'server.csr')}" -subj "/CN=cloudcode-pa.googleapis.com/O=Antigravity Proxy/C=VN"`, { stdio: 'ignore' });

    // 4. Sign the certificate with Root CA
    execSync(`openssl x509 -req -in "${path.join(CERT_DIR, 'server.csr')}" -CA "${CA_CERT_PATH}" -CAkey "${CA_KEY_PATH}" -CAcreateserial -out "${SERVER_CERT_PATH}" -days 365 -sha256 -extfile "${extFilePath}"`, { stdio: 'ignore' });

    log('Khởi tạo thành công bộ chứng chỉ SSL giả lập.', 'success');
  } catch (err) {
    log(`Lỗi khi tạo chứng chỉ SSL: ${err.message}`, 'error');
    process.exit(1);
  }
}

// Trust CA Certificate
function trustCertificate() {
  log('Đang cài đặt Root CA vào hệ thống để các IDE tin cậy kết nối...', 'info');
  try {
    if (process.platform === 'win32') {
      execSync(`certutil -addstore -f "ROOT" "${CA_CERT_PATH}"`, { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${CA_CERT_PATH}"`);
    } else {
      // Ubuntu / Debian
      if (fs.existsSync('/usr/local/share/ca-certificates')) {
        fs.copyFileSync(CA_CERT_PATH, '/usr/local/share/ca-certificates/antigravity-rootCA.crt');
        execSync('update-ca-certificates', { stdio: 'ignore' });
      }
    }
    log('Chứng chỉ Root CA đã được thiết lập TIN CẬY trên hệ điều hành.', 'success');
  } catch (err) {
    log(`Không thể cài đặt chứng chỉ Root CA tự động: ${err.message}. Bạn có thể cần cài đặt thủ công file certs/rootCA.pem`, 'warn');
  }
}

// Modify Hosts File
function updateHostsFile(add = true) {
  const hostsPath = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';

  try {
    let content = fs.readFileSync(hostsPath, 'utf8');
    const markerStart = '\n# === ANTIGRAVITY REDIRECTION START ===';
    const markerEnd = '# === ANTIGRAVITY REDIRECTION END ===\n';
    
    // Clean old entries
    const startIndex = content.indexOf(markerStart);
    if (startIndex !== -1) {
      const endIndex = content.indexOf(markerEnd);
      if (endIndex !== -1) {
        content = content.substring(0, startIndex) + content.substring(endIndex + markerEnd.length);
      }
    }

    if (add) {
      let entries = markerStart + '\n';
      for (const domain of TARGET_DOMAINS) {
        entries += `127.0.0.1 ${domain}\n`;
      }
      entries += markerEnd;
      content = content.trim() + '\n' + entries;
      log('Đã cập nhật file hosts để chuyển hướng các API của Google về Localhost.', 'success');
    } else {
      log('Đã khôi phục file hosts về trạng thái cũ.', 'success');
    }

    fs.writeFileSync(hostsPath, content);
  } catch (err) {
    log(`Không thể cập nhật file hosts: ${err.message}. Vui lòng chạy command với quyền Admin/Sudo!`, 'error');
    process.exit(1);
  }
}

// Start Proxy Server
function startProxy() {
  if (!API_KEY) {
    log('CẢNH BÁO: Bạn chưa thiết lập API_KEY. Proxy sẽ chuyển tiếp request không kèm token và có thể bị máy chủ Portal từ chối.', 'warn');
  }

  const options = {
    key: fs.readFileSync(SERVER_KEY_PATH),
    cert: fs.readFileSync(SERVER_CERT_PATH)
  };

  const server = https.createServer(options, (req, res) => {
    // Log incoming requests
    log(`${req.method} ${req.url} (Host: ${req.headers.host})`, 'info');

    // Read full body
    let bodyData = [];
    req.on('data', chunk => bodyData.push(chunk));
    req.on('end', async () => {
      const payload = Buffer.concat(bodyData);
      
      // Build forwarding request to Portal Server
      // We will proxy /v1internal:... directly to the remote server's v1internal endpoint
      // Translate Google domain calls directly to portal endpoint
      const forwardUrl = `${PORTAL_URL}${req.url}`;
      
      const parsedUrl = new URL(forwardUrl);
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'antigravity/1.107.0',
        'x-request-source': 'local',
        'X-Machine-Session-Id': req.headers['x-machine-session-id'] || '',
        'Accept': req.headers['accept'] || 'application/json'
      };

      const proxyReq = https.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers: headers,
        rejectUnauthorized: false // bypass cert check for your own vercel/custom portal URL if needed
      }, (proxyRes) => {
        // Forward response headers
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        
        // Pipe response stream back to VS Code/JetBrains
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        log(`Không thể kết nối đến máy chủ Portal (${PORTAL_URL}): ${err.message}`, 'error');
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `Bad Gateway: ${err.message}`, code: 'PORTAL_UNREACHABLE' } }));
        }
      });

      if (payload.length > 0) {
        proxyReq.write(payload);
      }
      proxyReq.end();
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Cổng ${LOCAL_PORT} đã bị chiếm dụng! Có thể có một proxy khác (như 9router local) đang chạy. Vui lòng tắt đi trước khi chạy script này.`, 'error');
    } else {
      log(`Lỗi HTTPS Server: ${err.message}`, 'error');
    }
    process.exit(1);
  });

  server.listen(LOCAL_PORT, '127.0.0.1', () => {
    const line = '═'.repeat(60);
    console.log(`\n${colors.cyan}╔${line}╗`);
    console.log(`║      🚀 ANTIGRAVITY DETACHED CLIENT PROXY READY            ║`);
    console.log(`╚${line}╝${colors.reset}\n`);
    console.log(`  ${colors.bold}• Local Proxy:${colors.reset}   https://127.0.0.1:${LOCAL_PORT}`);
    console.log(`  ${colors.bold}• Portal Server:${colors.reset} ${PORTAL_URL}`);
    console.log(`  ${colors.bold}• API Key:${colors.reset}       ${API_KEY ? colors.green + 'Đã cấu hình' : colors.red + 'Chưa cấu hình (Sử dụng --key)'}${colors.reset}`);
    console.log(`  ${colors.bold}• Trạng thái:${colors.reset}    Đang bắt và chuyển hướng Gemini Code Assist...`);
    console.log(`\n  ${colors.yellow}Nhấn Ctrl+C để tắt Proxy và khôi phục cấu hình hệ thống.${colors.reset}\n`);
  });
}

// Clean shutdown
let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n');
  log('Đang dọn dẹp và khôi phục cấu hình hệ thống...', 'info');
  try {
    updateHostsFile(false);
  } catch (e) {
    log(`Lỗi khi dọn dẹp hosts file: ${e.message}`, 'warn');
  }
  log('Đã dừng Proxy thành công. Hẹn gặp lại!', 'success');
  process.exit(0);
}

// Main execution flow
function main() {
  if (!checkPrivileges()) {
    console.log(`\n${colors.red}${colors.bold}[LỖI QUYỀN TRUY CẬP]${colors.reset}`);
    console.log('Script này cần được chạy với quyền Administrator hoặc Root để chỉnh sửa file hosts và cài đặt chứng chỉ SSL.');
    console.log('\nCách chạy:');
    console.log(`  - Windows: Mở ${colors.bold}PowerShell (Admin)${colors.reset} hoặc Command Prompt (Admin) rồi chạy lại lệnh.`);
    console.log(`  - macOS / Linux: Chạy lệnh với ${colors.bold}sudo${colors.reset}:`);
    console.log(`    sudo node client-proxy.js --server ${PORTAL_URL} --key YOUR_API_KEY\n`);
    process.exit(1);
  }

  generateCertificates();
  trustCertificate();
  updateHostsFile(true);

  // Setup process termination listeners
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.platform === 'win32') {
    process.on('SIGBREAK', shutdown);
  }

  startProxy();
}

main();

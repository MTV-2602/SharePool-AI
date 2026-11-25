const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID, verify } = require("node:crypto");

const UPDATE_URL = "https://ainoname.site/api/client-keys/download-tool";
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;

function manifestMessage({ version, size, sha256 }) {
  return Buffer.from(JSON.stringify({ version, size, sha256 }));
}

function validateManifest(manifest, publicKey) {
  if (!Number.isSafeInteger(manifest?.version) || manifest.version < 1 ||
      !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > MAX_BUNDLE_BYTES ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256 || "") ||
      !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature || "") ||
      !verify(null, manifestMessage(manifest), publicKey, Buffer.from(manifest.signature, "base64"))) {
    throw new Error("Chữ ký hoặc thông tin bản cập nhật không hợp lệ.");
  }
  return manifest;
}

async function download(kind, limit, fetcher, version) {
  const url = new URL(UPDATE_URL);
  url.searchParams.set("update", kind);
  if (version !== undefined) url.searchParams.set("v", String(version));
  const response = await fetcher(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error(`Không tải được bản cập nhật (HTTP ${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("Bản tải về vượt kích thước cho phép.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function checkForUpdate(currentVersion, publicKey, fetcher = fetch) {
  const bytes = await download("manifest", 4096, fetcher);
  const release = validateManifest(JSON.parse(bytes.toString("utf8")), publicKey);
  return release.version > currentVersion ? release : null;
}

async function installUpdate({ currentVersion, publicKey, bundlePath, canInstall, fetcher = fetch }) {
  const release = await checkForUpdate(currentVersion, publicKey, fetcher);
  if (!release) return null;
  const bytes = await download("bundle", release.size, fetcher, release.version);
  if (bytes.length !== release.size || createHash("sha256").update(bytes).digest("hex") !== release.sha256) {
    throw new Error("File tải về sai mã kiểm tra. Vui lòng thử lại.");
  }

  const stagedPath = path.join(path.dirname(bundlePath), `.ainoname-update-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(stagedPath, bytes, { flag: "wx" });
    canInstall();
    await fs.rename(stagedPath, bundlePath);
  } finally {
    await fs.rm(stagedPath, { force: true }).catch(() => {});
  }
  return release.version;
}

module.exports = { checkForUpdate, installUpdate, manifestMessage, validateManifest };

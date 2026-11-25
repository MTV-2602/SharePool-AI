const { createHash, sign } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { manifestMessage, validateManifest } = require("../ainoname-client/src/updater.js");
const version = require("../ainoname-client/src/release-version.json");

const clientDir = path.resolve(__dirname, "../ainoname-client");
const keyFile = process.env.AINONAME_RELEASE_KEY || path.join(process.env.LOCALAPPDATA || "", "AiNoName", "release-signing", "client-ed25519.pem");
const secret = fs.readFileSync(keyFile);
const publicKey = fs.readFileSync(path.join(clientDir, "src/update-public-key.pem"));
const bytes = fs.readFileSync(path.join(clientDir, "ainoname-agent.bundle.js"));
const manifest = { version, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const manifestPath = path.join(clientDir, "update-manifest.json");
if (fs.existsSync(manifestPath)) {
  const previous = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")), publicKey);
  if (version < previous.version || (version === previous.version && manifest.sha256 !== previous.sha256)) {
    throw new Error("Tăng số bản trong ainoname-client/src/release-version.json trước khi ký bundle mới.");
  }
}
manifest.signature = sign(null, manifestMessage(manifest), secret).toString("base64");
validateManifest(manifest, publicKey);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Đã ký bản client ${version}.`);

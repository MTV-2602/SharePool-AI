const AdmZip = require("adm-zip");
const path = require("path");
const fs = require("fs");

const clientDir = path.join(__dirname, "..", "ainoname-client");
const zip = new AdmZip();
const files = [
  "ainoname-agent.bundle.js",
  "AiNoName-Antigravity.bat",
  "Khoi-Dong-Antigravity.bat",
  "run.ps1",
  "Reset-DNS.bat",
  "ui.html",
  "README.md",
  "config.json"
];

for (const f of files) {
  const p = path.join(clientDir, f);
  if (fs.existsSync(p)) {
    zip.addLocalFile(p);
    console.log("Added:", f);
  } else {
    console.warn("Missing:", f);
  }
}

const outPath = path.join(__dirname, "..", "public", "downloads", "AiNoName-Client.zip");
zip.writeZip(outPath);
console.log("Successfully written:", outPath);

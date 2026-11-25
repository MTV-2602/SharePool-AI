import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientDir = path.join(process.cwd(), "ainoname-client");
    const update = searchParams.get("update");
    if (update !== null) {
      if (update !== "manifest" && update !== "bundle") {
        return NextResponse.json({ error: "Unknown update asset" }, { status: 400 });
      }
      const file = path.join(clientDir, update === "manifest" ? "update-manifest.json" : "ainoname-agent.bundle.js");
      if (!fs.existsSync(file)) return NextResponse.json({ error: "Client update unavailable" }, { status: 404 });
      return new NextResponse(fs.readFileSync(file), {
        headers: {
          "Content-Type": update === "manifest" ? "application/json" : "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const key = searchParams.get("key") || "";
    const gateway = searchParams.get("gateway");
    const label = searchParams.get("label") || "client";

    const hostHeader = request.headers.get("host") || "localhost:20128";
    const protoHeader = request.headers.get("x-forwarded-proto") || (hostHeader.includes("localhost") ? "http" : "https");
    const defaultGateway = `${protoHeader}://${hostHeader}`;
    const gatewayUrl = (gateway && gateway.trim()) ? gateway.trim().replace(/\/+$/, "") : defaultGateway;

    if (!fs.existsSync(clientDir)) {
      return NextResponse.json({ error: "Client tool folder not found on server" }, { status: 500 });
    }

    const zip = new AdmZip();

    // Required files to bundle
    const filesToInclude = [
      "ainoname-agent.bundle.js",
      "AiNoName-Antigravity.bat",
      "Khoi-Dong-Antigravity.bat",
      "run.ps1",
      "Reset-DNS.bat",
      "ui.html",
      "README.md"
    ];

    for (const fileName of filesToInclude) {
      const filePath = path.join(clientDir, fileName);
      if (fs.existsSync(filePath)) {
        zip.addLocalFile(filePath);
      }
    }

    // Dynamic pre-configured config.json
    const configObj = {
      gatewayUrl: gatewayUrl,
      clientKey: key,
      autoDns: true,
      webPort: 20129,
      mitmPort: 443,
      modelMapping: {
        "gemini-4-hydrogen-high": "ag/gemini-4-hydrogen-high",
        "gemini-4-hydrogen-low": "ag/gemini-4-hydrogen-low",
        "gemini-3.8-flash-high": "ag/gemini-3.8-flash-high",
        "claude-sonnet-4-6": "ag/claude-sonnet-4-6",
        "claude-opus-4-6-thinking": "ag/claude-opus-4-6-thinking",
        "gpt-oss-120b-medium": "ag/gpt-oss-120b-medium"
      }
    };

    zip.addFile("config.json", Buffer.from(JSON.stringify(configObj, null, 2), "utf8"));

    const zipBuffer = zip.toBuffer();
    const safeKeySuffix = key.length > 8 ? key.slice(-8) : key;
    const cleanLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = key ? `AiNoName-Client-${cleanLabel}-${safeKeySuffix}.zip` : "AiNoName-Client.zip";

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": zipBuffer.length.toString(),
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("Error creating client zip:", err);
    return NextResponse.json({ error: "Failed to generate zip package: " + err.message }, { status: 500 });
  }
}

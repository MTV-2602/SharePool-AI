import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import updater from "../../ainoname-client/src/updater.js";

const { checkForUpdate, installUpdate, manifestMessage } = updater;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const replacement = Buffer.from("new signed bundle\n");

function signedRelease(version) {
  const manifest = { version, size: replacement.length, sha256: createHash("sha256").update(replacement).digest("hex") };
  return { ...manifest, signature: sign(null, manifestMessage(manifest), privateKey).toString("base64") };
}

function server(manifest, bundle = replacement) {
  return vi.fn(async (url, options) => {
    expect(url.origin).toBe("https://ainoname.site");
    expect(options.redirect).toBe("error");
    return new Response(url.searchParams.get("update") === "manifest" ? JSON.stringify(manifest) : bundle);
  });
}

async function withClient(action) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ainoname-updater-test-"));
  const bundlePath = path.join(dir, "ainoname-agent.bundle.js");
  const configPath = path.join(dir, "config.json");
  await fs.writeFile(bundlePath, "current bundle");
  await fs.writeFile(configPath, '{"clientKey":"ck-fixture","modelMapping":{"a":"b"}}');
  try {
    await action({ currentVersion: 1, publicKey, bundlePath, canInstall: () => {} });
    expect(await fs.readFile(configPath, "utf8")).toBe('{"clientKey":"ck-fixture","modelMapping":{"a":"b"}}');
    expect((await fs.readdir(dir)).sort()).toEqual(["ainoname-agent.bundle.js", "config.json"]);
  } finally {
    await fs.rm(configPath);
    await fs.rm(bundlePath);
    await fs.rmdir(dir);
  }
}

describe("AiNoName Client signed updates", () => {
  it("recognizes a signed newer release and ignores the current or older version", async () => {
    const fetcher = server(signedRelease(2));
    expect((await checkForUpdate(1, publicKey, fetcher))?.version).toBe(2);
    expect(await checkForUpdate(2, publicKey, fetcher)).toBeNull();
    expect(await checkForUpdate(3, publicKey, fetcher)).toBeNull();
  });

  it("installs only the signed bundle and preserves the user's config", async () => {
    await withClient(async (client) => {
      const fetcher = server(signedRelease(2));
      expect(await installUpdate({ ...client, fetcher })).toBe(2);
      expect(await fs.readFile(client.bundlePath)).toEqual(replacement);
      expect(fetcher.mock.calls[1][0].searchParams.get("v")).toBe("2");
    });
  });

  it.each([
    ["unsigned manifest", { ...signedRelease(2), version: 3 }, replacement],
    ["wrong bundle", signedRelease(2), Buffer.from("bad bundle")],
    ["oversize bundle", signedRelease(2), Buffer.alloc(replacement.length + 1)],
  ])("preserves the running bundle on a %s", async (_, manifest, bundle) => {
    await withClient(async (client) => {
      await expect(installUpdate({ ...client, fetcher: server(manifest, bundle) })).rejects.toThrow();
      expect(await fs.readFile(client.bundlePath, "utf8")).toBe("current bundle");
    });
  });

  it("checks that chat is idle immediately before replacing the bundle", async () => {
    await withClient(async (client) => {
      const canInstall = () => { throw new Error("Chat still active"); };
      await expect(installUpdate({ ...client, canInstall, fetcher: server(signedRelease(2)) })).rejects.toThrow("Chat still active");
      expect(await fs.readFile(client.bundlePath, "utf8")).toBe("current bundle");
    });
  });
});

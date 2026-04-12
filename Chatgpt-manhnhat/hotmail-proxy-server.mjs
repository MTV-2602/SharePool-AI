#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webTestPath = path.join(__dirname, "hotmail-web-test.html");
const accountStorePath = path.join(__dirname, "hotmail-accounts.json");

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function parseLine(rawLine) {
  const line = String(rawLine || "").trim();
  const parts = line.split("|").map((p) => String(p || "").trim());
  if (parts.length < 4) return null;
  return {
    email: parts[0],
    password: parts[1],
    refreshToken: parts[2],
    clientId: parts[3],
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function loadAccountStore() {
  try {
    if (!fs.existsSync(accountStorePath)) return {};
    const raw = fs.readFileSync(accountStorePath, "utf8");
    const json = JSON.parse(raw || "{}");
    return json && typeof json === "object" ? json : {};
  } catch (_) {
    return {};
  }
}

function saveAccountStore(store) {
  fs.writeFileSync(accountStorePath, JSON.stringify(store, null, 2), "utf8");
}

function updateAccount(email, patch) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const store = loadAccountStore();
  const existing = store[key] || { email: key };
  store[key] = {
    ...existing,
    ...patch,
    email: key,
    updatedAt: nowIso(),
  };
  saveAccountStore(store);
  return store[key];
}

function upsertAccount(cred) {
  const email = normalizeEmail(cred?.email);
  if (!email || !cred?.refreshToken || !cred?.clientId) return false;
  const store = loadAccountStore();
  const existing = store[email] || {};
  store[email] = {
    ...existing,
    email,
    refreshToken: String(cred.refreshToken || "").trim(),
    clientId: String(cred.clientId || "").trim(),
    password: String(cred.password || "").trim(),
    state: existing.state || "available",
    reservedAt: existing.reservedAt || "",
    usedAt: existing.usedAt || "",
    lastReadAt: existing.lastReadAt || "",
    usedCount: Number(existing.usedCount || 0),
    updatedAt: nowIso(),
  };
  saveAccountStore(store);
  return true;
}

function getAccountByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const store = loadAccountStore();
  return store[key] || null;
}

async function exchangeOutlookToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "offline_access https://outlook.office.com/IMAP.AccessAsUser.All",
  });

  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();

  if (!res.ok || !json.access_token) {
    const msg = json?.error_description || json?.error || `Token error HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

async function readOutlookInbox(accessToken, top = 5) {
  const url = new URL("https://outlook.office.com/api/v2.0/me/messages");
  url.searchParams.set("$top", String(Math.max(1, Math.min(20, Number(top) || 5))));
  url.searchParams.set("$select", "Id,Subject,ReceivedDateTime,From,IsRead,BodyPreview");
  url.searchParams.set("$orderby", "ReceivedDateTime desc");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || `Inbox error HTTP ${res.status}`;
    throw new Error(msg);
  }

  return (json.value || []).map((m) => ({
    id: m.Id || "",
    subject: m.Subject || "(No subject)",
    receivedDateTime: m.ReceivedDateTime || "",
    from: m?.From?.EmailAddress?.Address || "(unknown)",
    isRead: Boolean(m.IsRead),
    bodyPreview: m.BodyPreview || "",
  }));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && req.url === "/") {
    if (!fs.existsSync(webTestPath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("hotmail-web-test.html not found");
      return;
    }
    const html = fs.readFileSync(webTestPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && req.url === "/accounts") {
    const store = loadAccountStore();
    const accounts = Object.values(store)
      .map((a) => ({
        email: a.email,
        updatedAt: a.updatedAt || "",
        state: a.state || "available",
        reservedAt: a.reservedAt || "",
        usedAt: a.usedAt || "",
        lastReadAt: a.lastReadAt || "",
        usedCount: Number(a.usedCount || 0),
      }))
      .sort((a, b) => {
        const order = { available: 0, reserved: 1, used: 2 };
        const ao = order[a.state] ?? 9;
        const bo = order[b.state] ?? 9;
        if (ao !== bo) return ao - bo;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
    return sendJson(res, 200, { ok: true, count: accounts.length, accounts });
  }

  if (
    req.method !== "POST" ||
    ![
      "/read-hotmail",
      "/save-hotmail-account",
      "/delete-hotmail-account",
      "/reserve-hotmail-account",
      "/release-hotmail-account",
    ].includes(req.url)
  ) {
    return sendJson(res, 404, { ok: false, error: "Not found" });
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      req.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const input = JSON.parse(body || "{}");

      if (req.url === "/save-hotmail-account") {
        const cred = parseLine(input.line);
        if (!cred) {
          return sendJson(res, 400, {
            ok: false,
            error: "Sai dinh dang. Can: email|password|refresh_token|client_id",
          });
        }
        upsertAccount(cred);
        return sendJson(res, 200, {
          ok: true,
          email: normalizeEmail(cred.email),
          message: "Saved",
        });
      }

      if (req.url === "/delete-hotmail-account") {
        const email = normalizeEmail(input.email);
        if (!email) {
          return sendJson(res, 400, {
            ok: false,
            error: "Thieu email",
          });
        }
        const store = loadAccountStore();
        if (!store[email]) {
          return sendJson(res, 404, {
            ok: false,
            error: "Khong tim thay account",
          });
        }
        delete store[email];
        saveAccountStore(store);
        return sendJson(res, 200, {
          ok: true,
          email,
          message: "Deleted",
        });
      }

      if (req.url === "/reserve-hotmail-account") {
        const email = normalizeEmail(input.email);
        if (!email) {
          return sendJson(res, 400, {
            ok: false,
            error: "Thieu email",
          });
        }
        const store = loadAccountStore();
        if (!store[email]) {
          return sendJson(res, 404, {
            ok: false,
            error: "Khong tim thay account",
          });
        }
        updateAccount(email, {
          state: "reserved",
          reservedAt: nowIso(),
        });
        return sendJson(res, 200, {
          ok: true,
          email,
          state: "reserved",
        });
      }

      if (req.url === "/release-hotmail-account") {
        const email = normalizeEmail(input.email);
        if (!email) {
          return sendJson(res, 400, {
            ok: false,
            error: "Thieu email",
          });
        }
        const store = loadAccountStore();
        if (!store[email]) {
          return sendJson(res, 404, {
            ok: false,
            error: "Khong tim thay account",
          });
        }
        updateAccount(email, {
          state: "available",
          reservedAt: "",
        });
        return sendJson(res, 200, {
          ok: true,
          email,
          state: "available",
        });
      }

      let cred = null;
      const fromLine = parseLine(input.line);
      if (fromLine) {
        cred = fromLine;
        upsertAccount(fromLine);
      } else if (input.email) {
        cred = getAccountByEmail(input.email);
      }

      if (!cred) {
        return sendJson(res, 400, {
          ok: false,
          error: "Khong tim thay account. Hay gui line day du hoac luu account truoc.",
        });
      }

      const tokenData = await exchangeOutlookToken(cred.clientId, cred.refreshToken);
      const messages = await readOutlookInbox(tokenData.access_token, input.top || 5);

      if (tokenData.refresh_token) {
        upsertAccount({
          ...cred,
          refreshToken: tokenData.refresh_token,
        });
      }

      const normalizedEmail = normalizeEmail(cred.email);
      const store = loadAccountStore();
      const existing = store[normalizedEmail] || {};
      updateAccount(normalizedEmail, {
        state: "used",
        reservedAt: "",
        usedAt: nowIso(),
        lastReadAt: nowIso(),
        usedCount: Number(existing.usedCount || 0) + 1,
      });

      return sendJson(res, 200, {
        ok: true,
        email: normalizeEmail(cred.email),
        count: messages.length,
        scope: tokenData.scope || "",
        rotatedRefreshToken: tokenData.refresh_token || "",
        messages,
      });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: String(err?.message || err),
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Hotmail proxy listening at http://localhost:${PORT}`);
  console.log(`Open web UI: http://localhost:${PORT}`);
  console.log("POST /save-hotmail-account with JSON: { line: \"email|password|refresh_token|client_id\" }");
  console.log("POST /delete-hotmail-account with JSON: { email: \"abc@hotmail.com\" }");
  console.log("POST /read-hotmail with JSON: { line: \"email|password|refresh_token|client_id\", top: 5 } or { email: \"abc@hotmail.com\", top: 5 }");
});

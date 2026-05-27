// src/services/hotmail.js — Hotmail MS Graph helper functions
'use strict';

const fetch = require('node-fetch');
const HotmailAccount = require('../models/HotmailAccount');

function normalizeHotmailEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function parseHotmailLine(rawLine) {
  const parts = String(rawLine || "").trim().split("|").map((p) => String(p || "").trim());
  if (parts.length < 3) return null;
  if (parts.length === 3) return { email: parts[0].toLowerCase(), password: parts[1], secret2fa: parts[2] };
  return { email: parts[0].toLowerCase(), password: parts[1], refreshToken: parts[2], clientId: parts[3], secret2fa: parts[4] || "" };
}

function parseStrictHotmailSaveLine(rawLine) {
  const parts = String(rawLine || "").trim().split("|").map((p) => String(p || "").trim());
  if (parts.length !== 4 && parts.length !== 5) return null;
  return {
    email: normalizeHotmailEmail(parts[0]),
    password: String(parts[1] || "").trim(),
    refreshToken: String(parts[2] || "").trim(),
    clientId: String(parts[3] || "").trim(),
    secret2fa: String(parts[4] || "").trim(),
  };
}

const buildHotmailFormattedLine = (account = {}) =>
  account.refreshToken
    ? `${account.email}|${account.password}|${account.refreshToken}|${account.clientId}${account.secret2fa ? "|" + account.secret2fa : ""}`
    : `${account.email}|${account.password}|${account.secret2fa || ""}`;

function isMicrosoftInboxDomain(value = "") {
  const domain = String(value || "").trim().toLowerCase().split("@")[1] || "";
  if (!domain) return false;
  return domain === "live.com" || domain === "msn.com" ||
    domain.startsWith("hotmail.") || domain.startsWith("outlook.") ||
    domain.endsWith(".live.com") || domain.endsWith(".msn.com");
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertReadableHotmailAccount(cred) {
  if (!cred) throw createHttpError("Chưa có acc trong Hotmail.", 404);
  if (!cred.refreshToken) throw createHttpError("Acc Hotmail thiếu refresh token Outlook.", 400);
  if (!cred.clientId) throw createHttpError("Acc Hotmail thiếu clientId Outlook.", 400);
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
    body
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || json?.error || `Token error HTTP ${res.status}`);
  }
  return json;
}

async function readOutlookInbox(accessToken, top = 5, options = {}) {
  const url = new URL("https://outlook.office.com/api/v2.0/me/messages");
  url.searchParams.set("$top", String(Math.max(1, Math.min(20, Number(top) || 5))));
  const includeBody = options?.includeBody !== false;
  url.searchParams.set(
    "$select",
    includeBody
      ? "Id,Subject,ReceivedDateTime,From,IsRead,BodyPreview,Body"
      : "Id,Subject,ReceivedDateTime,From,IsRead,BodyPreview",
  );
  url.searchParams.set("$orderby", "ReceivedDateTime desc");
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Inbox error HTTP ${res.status}`);
  return (json.value || []).map((m) => ({
    id: m.Id || "",
    subject: m.Subject || "(No subject)",
    receivedDateTime: m.ReceivedDateTime || "",
    from: m?.From?.EmailAddress?.Address || "(unknown)",
    isRead: Boolean(m.IsRead),
    bodyPreview: m.BodyPreview || "",
    body: includeBody ? m?.Body?.Content || m.BodyPreview || "" : m.BodyPreview || "",
    html_body: includeBody && String(m?.Body?.ContentType || "").toLowerCase() === "html"
      ? m?.Body?.Content || "" : "",
  }));
}

async function readStoredHotmailInbox(cred, top = 5, options = {}) {
  assertReadableHotmailAccount(cred);
  const tokenData = await exchangeOutlookToken(cred.clientId, cred.refreshToken);
  const messages = await readOutlookInbox(tokenData.access_token, top, options);
  const now = new Date().toISOString();
  await HotmailAccount.updateOne(
    { email: normalizeHotmailEmail(cred.email) },
    { refreshToken: tokenData.refresh_token || cred.refreshToken, lastReadAt: now }
  );
  return { email: normalizeHotmailEmail(cred.email), messages, scope: tokenData.scope || "", rotatedRefreshToken: tokenData.refresh_token || "", lastReadAt: now };
}

async function validateHotmailCredentialLive(credInput = {}, options = {}) {
  const cred = {
    email: normalizeHotmailEmail(credInput?.email),
    password: String(credInput?.password || "").trim(),
    refreshToken: String(credInput?.refreshToken || "").trim(),
    clientId: String(credInput?.clientId || "").trim(),
    secret2fa: String(credInput?.secret2fa || "").trim(),
  };
  if (!isMicrosoftInboxDomain(cred.email)) throw createHttpError("Chi ho tro Hotmail, Outlook, Live va MSN.", 400);
  assertReadableHotmailAccount(cred);
  let tokenData = null;
  try { tokenData = await exchangeOutlookToken(cred.clientId, cred.refreshToken); }
  catch (error) { throw createHttpError(`Live check token Outlook that bai: ${error.message}`, 400); }
  let messages = [];
  try { messages = await readOutlookInbox(tokenData.access_token, options?.top || 1); }
  catch (error) { throw createHttpError(`Live check doc inbox Outlook that bai: ${error.message}`, 400); }
  return {
    credential: { ...cred, refreshToken: String(tokenData?.refresh_token || cred.refreshToken).trim() },
    validated: true,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    scope: String(tokenData?.scope || "").trim(),
    rotatedRefreshToken: String(tokenData?.refresh_token || "").trim(),
    liveMessage: messages.length > 0 ? "Live OK: doc inbox Outlook thanh cong." : "Live OK: inbox dang trong.",
  };
}

module.exports = {
  normalizeHotmailEmail,
  parseHotmailLine,
  parseStrictHotmailSaveLine,
  buildHotmailFormattedLine,
  isMicrosoftInboxDomain,
  createHttpError,
  exchangeOutlookToken,
  readOutlookInbox,
  readStoredHotmailInbox,
  validateHotmailCredentialLive
};

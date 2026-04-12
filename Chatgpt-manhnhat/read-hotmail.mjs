#!/usr/bin/env node

/**
 * Read Outlook/Hotmail inbox via OAuth refresh token.
 *
 * Required env:
 * - MS_CLIENT_ID
 * - MS_REFRESH_TOKEN
 *
 * Optional env:
 * - MS_CLIENT_SECRET (required for confidential client apps)
 * - MS_TENANT (default: consumers)
 * - MS_MODE (graph|outlook, default: graph)
 * - MS_SCOPE
 *   - graph default: offline_access https://graph.microsoft.com/Mail.Read
 *   - outlook default: offline_access https://outlook.office.com/IMAP.AccessAsUser.All
 * - MS_TOP (default: 5)
 */

const tenant = process.env.MS_TENANT || "consumers";
const clientId = (process.env.MS_CLIENT_ID || "").trim();
const refreshToken = (process.env.MS_REFRESH_TOKEN || "").trim();
const clientSecret = (process.env.MS_CLIENT_SECRET || "").trim();
const mode = (process.env.MS_MODE || "graph").trim().toLowerCase();
const defaultScope =
  mode === "outlook"
    ? "offline_access https://outlook.office.com/IMAP.AccessAsUser.All"
    : "offline_access https://graph.microsoft.com/Mail.Read";
const scope = (process.env.MS_SCOPE || defaultScope).trim();
const top = Math.max(1, Number.parseInt(process.env.MS_TOP || "5", 10) || 5);

if (!clientId || !refreshToken) {
  console.error("Missing env. Please set MS_CLIENT_ID and MS_REFRESH_TOKEN.");
  process.exit(1);
}

async function exchangeRefreshToken() {
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope,
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data?.error_description || data?.error || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${err}`);
  }

  return data;
}

async function getGraphProfile(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Failed to fetch profile: ${err}`);
  }

  return data;
}

async function getGraphMessages(accessToken) {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$select", "id,subject,receivedDateTime,from,isRead");
  url.searchParams.set("$orderby", "receivedDateTime desc");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Failed to read inbox: ${err}`);
  }

  return data.value || [];
}

async function getOutlookMessages(accessToken) {
  const url = new URL("https://outlook.office.com/api/v2.0/me/messages");
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$select", "Id,Subject,ReceivedDateTime,From,IsRead");
  url.searchParams.set("$orderby", "ReceivedDateTime desc");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data?.error?.message || data?.error_description || `HTTP ${res.status}`;
    throw new Error(`Failed to read inbox: ${err}`);
  }

  return (data.value || []).map((m) => ({
    id: m.Id || m.id,
    subject: m.Subject || m.subject,
    receivedDateTime: m.ReceivedDateTime || m.receivedDateTime,
    from: m.From || m.from,
    isRead: Boolean(m.IsRead ?? m.isRead),
  }));
}

function printMessages(messages) {
  if (!messages.length) {
    console.log("Inbox is empty or no permission to view messages.");
    return;
  }

  messages.forEach((m, idx) => {
    const from = m?.from?.emailAddress?.address || "(unknown)";
    const subject = (m?.subject || "(no subject)").replace(/\s+/g, " ").trim();
    const received = m?.receivedDateTime || "";
    const readFlag = m?.isRead ? "READ" : "UNREAD";
    console.log(`${idx + 1}. [${readFlag}] ${received}`);
    console.log(`   From   : ${from}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   ID     : ${m.id}`);
  });
}

async function main() {
  if (!["graph", "outlook"].includes(mode)) {
    throw new Error("Invalid MS_MODE. Use graph or outlook.");
  }

  const tokenData = await exchangeRefreshToken();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    throw new Error("No access_token returned from token endpoint.");
  }

  if (mode === "graph") {
    const profile = await getGraphProfile(accessToken);
    console.log(`Mode: graph`);
    console.log(`Signed in as: ${profile.displayName || ""} <${profile.userPrincipalName || ""}>`);
  } else {
    console.log("Mode: outlook");
  }

  const messages =
    mode === "graph"
      ? await getGraphMessages(accessToken)
      : await getOutlookMessages(accessToken);
  console.log(`\nLatest ${messages.length} messages:\n`);
  printMessages(messages);

  if (tokenData.refresh_token) {
    console.log("\nNote: Microsoft returned a rotated refresh token. Save it to avoid token expiration.");
  }
}

main().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});

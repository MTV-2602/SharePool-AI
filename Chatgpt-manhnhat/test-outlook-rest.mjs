#!/usr/bin/env node

const clientId = (process.env.MS_CLIENT_ID || "").trim();
const refreshToken = (process.env.MS_REFRESH_TOKEN || "").trim();
const scope = (
  process.env.MS_SCOPE || "offline_access https://outlook.office.com/IMAP.AccessAsUser.All"
).trim();

if (!clientId || !refreshToken) {
  console.error("Missing MS_CLIENT_ID or MS_REFRESH_TOKEN");
  process.exit(1);
}

async function exchangeToken() {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope,
  });

  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || `HTTP ${res.status}`);
  }

  if (!data.access_token) {
    throw new Error("No access_token in token response");
  }

  return data.access_token;
}

async function readMessages(token) {
  const url =
    "https://outlook.office.com/api/v2.0/me/messages?$top=5&$select=Subject,ReceivedDateTime,From";

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 3000));
}

(async () => {
  const token = await exchangeToken();
  await readMessages(token);
})().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});

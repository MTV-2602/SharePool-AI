'use strict';

// Monitor cookie changes on chatgpt.com
chrome.cookies.onChanged.addListener(async (changeInfo) => {
  const { cookie, removed } = changeInfo;
  
  // We only care about the session token cookie on chatgpt.com
  if (
    cookie.name === "__Secure-next-auth.session-token" && 
    cookie.domain.includes("chatgpt.com") && 
    !removed
  ) {
    console.log("Detected session token change:", cookie.value.substring(0, 10) + "...");
    
    // Check if auto-push is enabled
    const data = await chrome.storage.local.get(["autoPush", "portalUrl", "pushToken", "namePrefix"]);
    if (data.autoPush) {
      const portalUrl = (data.portalUrl || "http://localhost:3040").replace(/\/$/, "");
      const pushToken = data.pushToken || "b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b";
      const namePrefix = data.namePrefix || "AutoReg";
      
      const username = `${namePrefix}-${Date.now().toString().slice(-6)}`;
      
      chrome.cookies.get({ url: "https://chatgpt.com", name: "oai-did" }, async (oaiDidCookie) => {
        const deviceId = (oaiDidCookie && oaiDidCookie.value) ? oaiDidCookie.value : "";
        try {
          console.log(`Auto pushing account to ${portalUrl}...`);
          const resp = await fetch(`${portalUrl}/api/chatgpt-extension-push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-extension-push-token": pushToken
            },
            body: JSON.stringify({
              username,
              sessionToken: cookie.value,
              deviceId
            })
          });
          
          const resData = await resp.json();
          console.log("Auto push response:", resData);
        } catch (err) {
          console.error("Auto push failed:", err);
        }
      });
    }
  }
});

// ─── OAuth OpenAI Integration ──────────────────────────────────────────────

// Handle messages from popup to start OAuth
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_OAUTH") {
    const authUrl = `https://auth.openai.com/oauth/authorize?` + new URLSearchParams({
      response_type: 'code',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      redirect_uri: 'http://localhost:1455/auth/callback',
      scope: 'openid profile email offline_access',
      code_challenge: message.challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
      state: message.state
    }).toString();
    chrome.tabs.create({ url: authUrl });
  }
});

// Watch tab updates to intercept redirect callback
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.startsWith('http://localhost:1455/auth/callback')) {
    const url = new URL(changeInfo.url);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    
    // Close the tab immediately
    try {
      chrome.tabs.remove(tabId);
    } catch (e) {
      console.error(e);
    }

    const data = await chrome.storage.local.get([
      'oauth_verifier', 
      'oauth_state', 
      'portalUrl', 
      'pushToken', 
      'namePrefix'
    ]);
    
    if (!returnedState || returnedState !== data.oauth_state) {
      console.error('OAuth state mismatch or missing');
      chrome.runtime.sendMessage({
        type: 'OAUTH_STATUS',
        success: false,
        message: 'Lỗi: State mismatch (Yêu cầu OAuth bị giả mạo hoặc hết hạn).'
      });
      return;
    }
    
    const portalUrl = (data.portalUrl || "http://localhost:3040").replace(/\/$/, "");
    const pushToken = data.pushToken || "b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b";
    const namePrefix = data.namePrefix || "CodexOAuth";
    const username = `${namePrefix}-${Date.now().toString().slice(-6)}`;

    try {
      console.log('Sending authorization code to backend for exchange...');
      const resp = await fetch(`${portalUrl}/api/chatgpt-oauth-callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-extension-push-token": pushToken
        },
        body: JSON.stringify({
          username,
          code,
          codeVerifier: data.oauth_verifier,
          redirectUri: 'http://localhost:1455/auth/callback'
        })
      });
      
      const resData = await resp.json();
      console.log("OAuth push response:", resData);
      
      chrome.runtime.sendMessage({
        type: 'OAUTH_STATUS',
        success: resp.ok && resData.ok,
        message: resData.message || resData.error || 'Đăng nhập OAuth thành công và lưu vào pool!'
      });
    } catch (err) {
      console.error("OAuth exchange failed:", err);
      chrome.runtime.sendMessage({
        type: 'OAUTH_STATUS',
        success: false,
        message: 'Lỗi kết nối tới Portal: ' + err.message
      });
    }
  }
});

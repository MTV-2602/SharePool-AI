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
            sessionToken: cookie.value
          })
        });
        
        const resData = await resp.json();
        console.log("Auto push response:", resData);
      } catch (err) {
        console.error("Auto push failed:", err);
      }
    }
  }
});

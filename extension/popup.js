'use strict';

document.addEventListener("DOMContentLoaded", async () => {
  const portalUrlInput = document.getElementById("portalUrl");
  const pushTokenInput = document.getElementById("pushToken");
  const namePrefixInput = document.getElementById("namePrefix");
  const autoPushCheckbox = document.getElementById("autoPush");
  const cookieStatusDiv = document.getElementById("cookieStatus");
  const pushBtn = document.getElementById("pushBtn");
  const statusBox = document.getElementById("statusBox");
  
  // Load saved settings
  const settings = await chrome.storage.local.get([
    "portalUrl",
    "pushToken",
    "namePrefix",
    "autoPush"
  ]);
  
  portalUrlInput.value = settings.portalUrl || "http://localhost:3040";
  pushTokenInput.value = settings.pushToken || "b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b";
  namePrefixInput.value = settings.namePrefix || "CodexAcc";
  autoPushCheckbox.checked = settings.autoPush || false;
  
  // Save settings when input changes
  const saveSettings = () => {
    chrome.storage.local.set({
      portalUrl: portalUrlInput.value.trim(),
      pushToken: pushTokenInput.value.trim(),
      namePrefix: namePrefixInput.value.trim(),
      autoPush: autoPushCheckbox.checked
    });
  };
  
  portalUrlInput.addEventListener("input", saveSettings);
  pushTokenInput.addEventListener("input", saveSettings);
  namePrefixInput.addEventListener("input", saveSettings);
  autoPushCheckbox.addEventListener("change", saveSettings);
  
  // Check ChatGPT session cookie status
  let sessionToken = "";
  try {
    const cookies = await new Promise(resolve => {
      chrome.cookies.getAll({ domain: "chatgpt.com" }, resolve);
    });
    
    // Find next-auth session token cookie
    const cookie = cookies && cookies.find(c => c.name.includes("session-token"));
    
    if (cookie && cookie.value) {
      sessionToken = cookie.value;
      const masked = sessionToken.substring(0, 10) + "..." + sessionToken.slice(-6);
      cookieStatusDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
          <span>ChatGPT Session:</span>
          <span class="badge badge-ok">Active</span>
        </div>
        <div style="font-family:monospace; font-size:10px; color:var(--text2); word-break:break-all;">${masked}</div>
      `;
      pushBtn.disabled = false;
    } else {
      cookieStatusDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span>ChatGPT Session:</span>
          <span class="badge badge-none">Not Found</span>
        </div>
        <div style="font-size:11px; color:var(--text2); margin-top:6px;">Please log in to chatgpt.com first.</div>
        <div style="font-size:10px; color:#ff9800; margin-top:6px; line-height: 1.4;">⚠️ Nếu đã đăng nhập mà vẫn báo "Not Found": Click chuột phải vào icon Extension -> Chọn "Có thể đọc và thay đổi dữ liệu trang web" -> Chọn "Trên tất cả các trang web" (hoặc "Trên chatgpt.com"), sau đó bấm mở lại Extension.</div>
      `;
      pushBtn.disabled = true;
    }
  } catch (err) {
    console.error(err);
    cookieStatusDiv.textContent = "Error checking cookie permissions.";
    pushBtn.disabled = true;
  }
  
  // Push function
  pushBtn.addEventListener("click", async () => {
    if (!sessionToken) return;
    
    statusBox.className = "status-box";
    statusBox.style.display = "none";
    
    const portalUrl = portalUrlInput.value.trim().replace(/\/$/, "");
    const pushToken = pushTokenInput.value.trim();
    const namePrefix = namePrefixInput.value.trim();
    
    pushBtn.disabled = true;
    pushBtn.textContent = "Pushing...";
    
    const username = `${namePrefix}-${Date.now().toString().slice(-6)}`;
    
    chrome.cookies.getAll({ domain: "chatgpt.com" }, async (cookies) => {
      const oaiDidCookie = cookies && cookies.find(c => c.name === "oai-did");
      const deviceId = (oaiDidCookie && oaiDidCookie.value) ? oaiDidCookie.value : "";
      try {
        const resp = await fetch(`${portalUrl}/api/chatgpt-extension-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-extension-push-token": pushToken
          },
          body: JSON.stringify({
            username,
            sessionToken,
            deviceId
          })
        });
        
        const resData = await resp.json();
        if (resp.ok && resData.ok) {
          statusBox.className = "status-box success";
          statusBox.textContent = `Success! Account '${username}' pushed successfully to pool.`;
        } else {
          statusBox.className = "status-box error";
          statusBox.textContent = `Error: ${resData.error || "Failed to push session token."}`;
        }
      } catch (err) {
        console.error(err);
        statusBox.className = "status-box error";
        statusBox.textContent = "Network error: Make sure portal server is running and accessible.";
      } finally {
        statusBox.style.display = "block";
        pushBtn.disabled = false;
        pushBtn.textContent = "🚀 Push to Codex Pool";
      }
    });
  });
});

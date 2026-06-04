// AutoRegUnified - content_portal.js
// Runs on the Admin Portal website to relay Re-login click events instantly to the extension background script.

document.addEventListener("click", (e) => {
  // Handle Re-login buttons
  const btn = e.target.closest("button");
  if (btn) {
    const text = (btn.textContent || btn.innerText || "");
    if (text.includes("Re-login qua Extension") || text.includes("Mô phỏng lỗi")) {
      console.log("[AutoRegUnified] Nút Re-login/Mô phỏng lỗi được click. Kích hoạt re-login sau 1.5 giây...");
      
      // Đợi 1.5 giây để React hoàn thành gửi request cập nhật trạng thái Failed lên database trước
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "TRIGGER_AUTO_RELOGIN_NOW" }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[AutoRegUnified] Lỗi gửi tin tới background:", chrome.runtime.lastError.message);
          } else {
            console.log("[AutoRegUnified] Kết quả kích hoạt re-login:", response);
          }
        });
      }, 1500);
      return;
    }
  }

  // Handle 'Mở trang đăng nhập OpenAI' links (OAuth login)
  const link = e.target.closest("a");
  if (link) {
    const text = (link.textContent || link.innerText || "");
    if (text.includes("Mở trang đăng nhập OpenAI")) {
      const url = link.getAttribute("href");
      if (url) {
        e.preventDefault();
        console.log("[AutoRegUnified] Intercepted OAuth link. Asking background to open tab safely...");
        chrome.runtime.sendMessage({ type: "OPEN_OAUTH_TAB", url }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[AutoRegUnified] Failed to send OPEN_OAUTH_TAB:", chrome.runtime.lastError.message);
            // Fallback: open normally if extension is not responding
            window.open(url, "_blank");
          }
        });
      }
    }
  }
});

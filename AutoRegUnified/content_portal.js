// AutoRegUnified - content_portal.js
// Runs on the Admin Portal website to relay Re-login click events instantly to the extension background script.

document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  
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
  }
});

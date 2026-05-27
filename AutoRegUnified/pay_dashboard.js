let accountQueue = [];
let successAccounts = [];
let currentAccount = null;

const logDiv = document.getElementById("logs");
function addLog(msg) {
  const time = new Date().toLocaleTimeString();
  logDiv.innerHTML += `<div>[${time}] ${msg}</div>`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

document.getElementById("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().includes("|"));
  
  accountQueue = lines.map(line => {
    const parts = line.split("|");
    // Định dạng: email|pass|secret|token|fullSession
    return {
      email: parts[0] || "N/A",
      password: parts[1] || "N/A",
      fullSession: parts[parts.length - 1] // Giả định JSON nằm ở cuối
    };
  }).filter(a => a.fullSession.startsWith("{"));

  document.getElementById("stat-total").textContent = accountQueue.length;
  document.getElementById("stat-pending").textContent = accountQueue.length;
  addLog(`📂 Đã nạp ${accountQueue.length} tài khoản từ file.`);
  
  if (accountQueue.length > 0) {
    document.getElementById("current-acc-section").style.display = "block";
    showNextAccount();
  }
});

function showNextAccount() {
  if (accountQueue.length === 0) {
    currentAccount = null;
    document.getElementById("current-email").textContent = "Đã hết acc";
    addLog("🏁 Đã xử lý hết danh sách tài khoản.");
    return;
  }

  currentAccount = accountQueue.shift();
  document.getElementById("current-email").textContent = currentAccount.email;
  document.getElementById("stat-pending").textContent = accountQueue.length;
  addLog(`👉 Sẵn sàng cho: ${currentAccount.email}`);
}

document.getElementById("btn-get-link").addEventListener("click", async () => {
  if (!currentAccount) return;

  addLog(`🔗 Đang gọi API lấy link Midtrans cho: ${currentAccount.email}...`);
  
  // Thiết lập ongoingRegistration để content.js nhận diện
  const ongoing = {
    email: currentAccount.email,
    password: currentAccount.password,
    accountsLeft: 1,
    logs: `[${new Date().toLocaleTimeString()}] Thanh toán Dashboard cho: ${currentAccount.email}\n`,
    step: 99, 
    stepStartTime: Date.now(),
    mailSite: "pay_dashboard",
    gopayLinkRequested: false 
  };

  chrome.storage.local.set({ ongoingRegistration: ongoing }, () => {
    // Mở trang session để content.js lấy session và gọi API link
    chrome.tabs.create({ url: "https://chatgpt.com/api/auth/session" });
  });
});

document.getElementById("btn-next").addEventListener("click", () => {
  if (!currentAccount) return;
  
  successAccounts.push(currentAccount);
  document.getElementById("stat-success").textContent = successAccounts.textContent = successAccounts.length;
  addLog(`✅ Đã xong: ${currentAccount.email}. Chuyển acc tiếp...`);
  showNextAccount();
});

document.getElementById("btn-skip").addEventListener("click", () => {
  if (!currentAccount) return;
  addLog(`⚠️ Bỏ qua: ${currentAccount.email}. Chuyển acc khác...`);
  showNextAccount();
});

document.getElementById("btn-download-success").addEventListener("click", () => {
  if (successAccounts.length === 0) {
    alert("Chưa có acc thành công nào để tải!");
    return;
  }

  const text = successAccounts.map(a => `${a.email}|${a.password}|DONE`).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pay_success.txt";
  a.click();
  addLog(`📥 Đã xuất file pay_success.txt (${successAccounts.length} acc).`);
});

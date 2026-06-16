const fs = require('fs');
const path = require('path');

const reposDir = 'D:/codex xoay/src/lib/db/repos';
const helpersDir = 'D:/codex xoay/src/lib/db/helpers';
const libDir = 'D:/codex xoay/src/lib';

function fixFileContent(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // 1. Thêm await vào trước db.get, db.all, db.run, db.transaction, db.prepare (nếu có)
  // Chỉ thêm khi chưa có await phía trước (sử dụng regex negative lookbehind hoặc check substring)
  // Để an toàn, thay thế tất cả các pattern mà không có await
  content = content.replace(/(?<!await\s+)(db\.(all|get|run|transaction|prepare)\s*\()/g, 'await $1');
  content = content.replace(/(?<!await\s+)(adapter\.(all|get|run|transaction)\s*\()/g, 'await $1');

  // 2. Sửa các hàm sync có chứa db.get / db.run trong helper
  // Ví dụ: export function getMetaSync(...) -> export async function getMetaSync(...)
  content = content.replace(/export\s+function\s+(getMetaSync|setMetaSync)\s*\(/g, 'export async function $1(');

  // 3. Nếu trong hàm có db.transaction(async () => { ... }), đảm bảo callback là async và các lệnh gọi db/adapter bên trong đều có await
  // Hầu hết repo dùng db.transaction(() => { ... })
  // Ta cần đổi thành db.transaction(async (...) => { ... })
  content = content.replace(/db\.transaction\(\s*\(\s*\)\s*=>\s*\{/g, 'db.transaction(async () => {');
  content = content.replace(/db\.transaction\(\s*async\s*\(\s*\)\s*=>\s*\{/g, 'db.transaction(async () => {');

  // Thêm await trước db.transaction nếu chưa có
  content = content.replace(/(?<!await\s+)(db\.transaction)/g, 'await $1');

  // 4. Kiểm tra xem file có chứa getAdapterSync không
  // Rất nhiều chỗ dùng: const db = getAdapterSync()
  // Ta cần đổi thành: const db = await getAdapter()
  content = content.replace(/getAdapterSync\(\)/g, 'await getAdapter()');
  // Đổi import { getAdapterSync } thành import { getAdapter }
  content = content.replace(/getAdapterSync/g, 'getAdapter');

  // 5. Tìm các hàm chứa db calls nhưng chưa khai báo async
  // Chạy lặp lại để tìm các function định nghĩa dạng: function name(...) { ... db.something ... } hoặc const name = (...) => { ... db.something ... }
  // Để đơn giản và chính xác hơn, ta duyệt qua từng dòng hoặc thực hiện các chỉnh sửa thủ công nếu cần.
  // Đa số các hàm chính trong repo đều đã được định nghĩa async. Ta sẽ in ra xem file nào bị thay đổi.

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[FIXED] ${filePath}`);
  } else {
    console.log(`[NO CHANGE] ${filePath}`);
  }
}

// Fix all files in repos
const repoFiles = fs.readdirSync(reposDir);
for (const file of repoFiles) {
  if (file.endsWith('.js')) {
    fixFileContent(path.join(reposDir, file));
  }
}

// Fix all files in helpers
if (fs.existsSync(helpersDir)) {
  const helperFiles = fs.readdirSync(helpersDir);
  for (const file of helperFiles) {
    if (file.endsWith('.js')) {
      fixFileContent(path.join(helpersDir, file));
    }
  }
}

// Fix db files in lib root
const libFiles = ['localDb.js', 'usageDb.js', 'requestDetailsDb.js', 'disabledModelsDb.js'];
for (const file of libFiles) {
  const filePath = path.join(libDir, file);
  if (fs.existsSync(filePath)) {
    fixFileContent(filePath);
  }
}

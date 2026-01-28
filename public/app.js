const API_URL = 'http://localhost:3000/api';

// Tab Switching
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.innerText.toLowerCase().includes(tabName)) btn.classList.add('active');
    });

    document.querySelectorAll('section').forEach(sec => sec.style.display = 'none');
    document.getElementById(`${tabName}-section`).style.display = 'block';
}

// Modal handling
function openModal(id) {
    document.getElementById(id).style.display = 'block';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

window.onclick = function (event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
}

// Data Fetching
async function fetchData() {
    try {
        const response = await fetch(`${API_URL}/data`);
        const data = await response.json();
        renderChatGPT(data.chatgpt);
        // Coursera is now handled via Google Sheets embed, so no render needed
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

function renderChatGPT(accounts) {
    const tbody = document.getElementById('chatgpt-list');
    tbody.innerHTML = '';

    if (!accounts.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Chưa có dữ liệu</td></tr>';
        return;
    }

    accounts.forEach(acc => {
        const tr = document.createElement('tr');

        // Handle Unassigned Type
        let pkgHtml = '';
        if (acc.type === 'package1') {
            pkgHtml = '<span class="tag tag-package1">Gói 1: Chia sẻ</span>';
        } else if (acc.type === 'package2') {
            pkgHtml = '<span class="tag tag-package2">Gói 2: Linh hoạt</span>';
        } else {
            // Unassigned: Show Dropdown to Select Type
            pkgHtml = `
                <select onchange="updateAccountType('${acc.id}', this.value)" style="padding:4px; border-radius:4px; font-size:0.8rem; border:1px solid #f59e0b; background:#fffbeb; color:#d97706;">
                    <option value="unassigned">❓ Chọn Gói...</option>
                    <option value="package1">👥 Gói 1: Chia sẻ</option>
                    <option value="package2">🔒 Gói 2: Linh hoạt</option>
                </select>
            `;
        }

        const linkDisplay = (acc.link && acc.link.length > 5)
            ? `<a href="${acc.link}" target="_blank" class="btn-secondary" style="color:#fff; text-decoration:none; display:inline-block; padding:2px 8px; font-size:0.8rem;">Mở Mail</a>`
            : '<span style="color:#64748b">--</span>';

        // Slot Management Logic
        let slotInfo = '';
        const currentUsers = acc.users || []; // Moved up for reuse

        if (acc.type === 'package1') {
            const used = currentUsers.length;
            const limit = 3;
            const statusColor = used >= limit ? '#ef4444' : '#10b981';

            // List of users using this account (Added EDIT button)
            const userListHtml = currentUsers.map(u =>
                `<div style="font-size:0.8rem; border-bottom:1px solid #475569; padding:4px 0; display:flex; justify-content:space-between; align-items:center;">
                    <span>👤 ${u}</span>
                    <div>
                        <button onclick="editUserInPackage1('${acc.id}', '${u}')" style="background:none; border:none; color:#3b82f6; cursor:pointer; font-size:0.7rem; margin-right:5px;" title="Sửa tên">✏️</button>
                        <button onclick="removeUserFromShared('${acc.id}', '${u}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.7rem;" title="Xóa người này">x</button>
                    </div>
                </div>`
            ).join('');

            slotInfo = `
                <div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
                    <span style="font-weight:bold; color:${statusColor}; font-size:0.9rem;">${used}/${limit} Slot</span>
                    <button class="btn-secondary" style="padding:2px 8px; font-size:0.75rem; position:relative; z-index:10;" onclick="addCustomer('${acc.id}')" ${used >= limit ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
                        <i class="fas fa-user-plus"></i> Thêm
                    </button>
                </div>
                <div style="background:rgba(0,0,0,0.2); border-radius:6px; padding:6px; max-height:80px; overflow-y:auto; border:1px solid #334155;">
                    ${userListHtml || '<div style="font-size:0.8rem; color:#64748b; font-style:italic;">Chưa có khách</div>'}
                </div>
            `;
        } else if (acc.type === 'package2') {
            // Package 2 (Private)
            const owner = (currentUsers.length > 0) ? currentUsers[0] : null;
            slotInfo = owner
                ? `<div>👤 <b>${owner}</b> <button style="background:none; border:none; color:#3b82f6; cursor:pointer;" onclick="editCustomer('${acc.id}')" title="Sửa khách hàng"><i class="fas fa-edit"></i></button></div>`
                : `<button class="btn-secondary" style="padding:4px 10px; font-size:0.8rem;" onclick="addCustomer('${acc.id}')"><i class="fas fa-user-tag"></i> Gán Khách</button>`;
        } else {
            // Unassigned
            slotInfo = '<span style="font-size:0.8rem; color:#f59e0b; font-style:italic;">Hãy chọn gói trước để gán khách</span>';
        }

        tr.innerHTML = `
            <td>${pkgHtml}</td>
            <td>
                <div style="font-weight:500; display:flex; align-items:center; gap:5px;">
                    <i class="fas fa-user" style="color:#94a3b8; font-size:0.8rem;"></i> 
                    <span>${acc.username}</span>
                    <i class="fas fa-pencil-alt" onclick="editAccount('${acc.id}')" style="cursor:pointer; color:#3b82f6; font-size:0.8rem;" title="Sửa Tài Khoản"></i>
                    <i class="fas fa-copy" onclick="copyText('${acc.username}')" style="cursor:pointer; color:#64748b; font-size:0.8rem;" title="Copy User"></i>
                </div>
                <div style="font-size:0.9em;color:var(--text-secondary); margin-top:4px; display:flex; align-items:center; gap:5px;">
                    <i class="fas fa-key" style="color:#94a3b8; font-size:0.8rem;"></i> 
                    <span>${acc.password}</span>
                    <i class="fas fa-copy" onclick="copyText('${acc.password}')" style="cursor:pointer; color:#64748b; font-size:0.8rem;" title="Copy Pass"></i>
                </div>
            </td>
            <td>${linkDisplay}</td>
            <td style="min-width:200px;">
                ${slotInfo}
            </td>
            <td>
                <button class="action-btn btn-delete" onclick="deleteAccount('chatgpt', '${acc.id}')" title="Xóa tài khoản"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Helper: Copy Text
function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Có thể hiện toast nhỏ nếu muốn, tạm thời visual feedback là đủ
        // alert('Đã copy: ' + text); 
    }).catch(err => console.error('Copy failed', err));
}

// Open Add Customer Modal
function addCustomer(id) {
    document.getElementById('target-acc-id').value = id;
    document.getElementById('new-customer-name').value = '';
    openModal('modal-add-customer');
    document.getElementById('new-customer-name').focus();
}

// Confirm Add Action
async function confirmAddCustomer() {
    const id = document.getElementById('target-acc-id').value;
    const name = document.getElementById('new-customer-name').value.trim();

    if (!name) {
        alert('Vui lòng nhập tên khách!');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/data`);
        const data = await res.json();
        const acc = data.chatgpt.find(a => a.id == id);

        if (!acc) {
            alert('Không tìm thấy tài khoản để thêm!');
            closeModal('modal-add-customer');
            return;
        }

        const currentUsers = acc.users || [];
        // Shared limit check
        if (acc.type === 'package1' && currentUsers.length >= 3) {
            alert('Tài khoản này đã full slot!');
            closeModal('modal-add-customer');
            return;
        }

        const newUsers = [...currentUsers, name];

        let newStatus = acc.status;
        if (acc.type === 'package1' && newUsers.length >= 3) newStatus = 'sold';
        if (acc.type === 'package2' && newUsers.length >= 1) newStatus = 'sold';

        await fetch(`${API_URL}/chatgpt/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                users: newUsers,
                status: newStatus
            })
        });

        alert('Đã thêm khách thành công!');
        closeModal('modal-add-customer');
        fetchData(); // Reload list
    } catch (e) {
        console.error(e);
        alert('Lỗi cập nhật server');
    }
}

async function editCustomer(id) {
    // Simplification: clear users and re-add for now, or just edit name of first user
    if (!confirm('Tính năng sửa nhanh: Bạn muốn XÓA khách hiện tại để thêm lại?')) return;
    await fetch(`${API_URL}/chatgpt/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            users: [],
            status: 'available'
        })
    });
    fetchData();
}

// Add Account Actions
document.getElementById('form-chatgpt').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    await fetch(`${API_URL}/chatgpt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    closeModal('modal-chatgpt');
    e.target.reset();
    fetchData();
};

// Bulk Import Logic for ChatGPT
document.getElementById('form-bulk-chatgpt').onsubmit = async (e) => {
    e.preventDefault();
    const text = e.target.bulkData.value;
    const type = e.target.defaultType.value;

    const lines = text.split('\n');
    let importedCount = 0;

    for (const line of lines) {
        if (!line.trim()) continue;

        // Custom Parser for User's Format:
        // [Header]Email---Pass---Link
        // Separator can be '----' or '---'
        // Example: ...asia---zxcvbnm...----https://...

        let cleanLine = line.replace(/\[.*?\]/, '').trim(); // Remove [Header]

        // Split by 3 or more dashes
        const parts = cleanLine.split(/-{3,}/);

        if (parts.length >= 2) {
            const username = parts[0].trim();
            const password = parts[1].trim();
            // The 3rd part is the Link Mail (Verification Link)
            const link = parts.length > 2 ? parts[2].trim() : '';

            console.log('Detected Link:', link); // Debug: Check if link is correct

            await fetch(`${API_URL}/chatgpt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    username,
                    password,
                    link: link,
                    note: 'Imported via Bulk Tool',
                    status: 'available'
                })
            });
            importedCount++;
        }
    }

    alert(`Đã import thành công ${importedCount} tài khoản vào ${type === 'package1' ? 'Gói 1' : 'Gói 2'}.`);
    closeModal('modal-bulk-chatgpt');
    e.target.reset();
    fetchData();
};

// Bulk Import Logic for Coursera (Sheet Helper)
// Google Apps Script Integration
function toggleConfig() {
    const area = document.getElementById('config-area');
    area.style.display = (area.style.display === 'none') ? 'block' : 'none';
}

function saveScriptUrl() {
    const url = document.getElementById('apps-script-url').value.trim();
    if (url) {
        localStorage.setItem('appsScriptUrl', url);
        alert('Đã lưu cấu hình!');
        document.getElementById('config-area').style.display = 'none'; // Auto hide
    } else {
        alert('Vui lòng nhập URL!');
    }
}

// Bulk Import Logic for Coursera (Sheet Helper + Auto Fill)
document.getElementById('form-bulk-coursera').onsubmit = async (e) => {
    e.preventDefault();
    const text = e.target.bulkData.value;
    const subject = e.target.subjectCode.value || '';

    // Ưu tiên lấy URL đang hiện trong ô nhập (tránh trường hợp quên bấm Lưu)
    let scriptUrl = document.getElementById('apps-script-url').value.trim();
    if (!scriptUrl) scriptUrl = localStorage.getItem('appsScriptUrl'); // Fallback

    const lines = text.split('\n');
    let outputText = '';
    let parsedData = []; // Store object for Auto-Fill
    let count = 0;

    for (const line of lines) {
        if (!line.trim() || line.includes('[Header]')) continue;

        let cleanLine = line.replace(/\[.*?\]/, '').trim();

        // Support multiple separators: '----' or ',' or '|' or tab
        let parts;
        if (cleanLine.includes(',')) {
            parts = cleanLine.split(',').map(p => p.trim());
        } else if (cleanLine.includes('|')) {
            parts = cleanLine.split('|').map(p => p.trim());
        } else if (cleanLine.includes('\t')) {
            parts = cleanLine.split('\t').map(p => p.trim());
        } else {
            parts = cleanLine.split(/-{3,}/).map(p => p.trim());
        }

        if (parts.length >= 2) {
            const email = parts[0];
            const pass = parts[1];
            const rowSubject = (parts.length >= 3 && parts[2]) ? parts[2] : subject;

            // Prepare for Display/Copy
            outputText += `${email}\t${pass}\t${rowSubject}\n`;

            // Prepare for Auto-Fill (Must be Array of Arrays for Apps Script)
            parsedData.push([email, pass, rowSubject]);

            count++;
        }
    }

    if (count > 0) {
        // Option 1: Auto-Fill via Server Proxy
        if (scriptUrl) {
            const btn = e.submitter;
            const originalText = btn.innerText;
            btn.innerText = 'Đang gửi sang Sheet...';
            btn.disabled = true;

            // Clean & Get Info
            const sheetName = document.getElementById('coursera-sheet-name').value.trim();
            const cleanScriptUrl = scriptUrl.trim();

            if (sheetName) localStorage.setItem('lastSheetName', sheetName);

            console.log('Sending to Proxy:', {
                url: cleanScriptUrl,
                sheet: sheetName,
                rows: parsedData.length
            });



            try {
                // Send to our local proxy
                const res = await fetch(`${API_URL}/proxy-sheet`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scriptUrl: cleanScriptUrl, // Use trimmed URL
                        sheetName: sheetName, // Send sheet name
                        data: parsedData
                    })
                });

                const result = await res.json();

                if (result.result === 'success') {
                    alert(`✅ THÀNH CÔNG! Đã gửi ${count} dòng vào Sheet: ${sheetName || '(Mặc định)'}.`);
                    closeModal('modal-bulk-coursera');
                    e.target.reset();
                    // Restore sheet name
                    if (sheetName) document.getElementById('coursera-sheet-name').value = sheetName;
                } else {
                    throw new Error(result.error || 'Lỗi không xác định từ Apps Script');
                }

            } catch (err) {
                console.error(err);
                alert(`❌ LỖI: ${err.message}\n\nHãy kiểm tra lại URL Apps Script hoặc quyền truy cập.`);

                // Fallback to manual copy
                document.getElementById('parsed-count').innerText = count;
                document.getElementById('data-clipboard').value = outputText;
                document.getElementById('coursera-parsed-result').style.display = 'block';
                closeModal('modal-bulk-coursera');
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }

        } else {
            // Option 2: Manual Copy
            document.getElementById('parsed-count').innerText = count;
            document.getElementById('data-clipboard').value = outputText;
            document.getElementById('coursera-parsed-result').style.display = 'block';
            closeModal('modal-bulk-coursera');
            e.target.reset();
            alert(`Đã format ${count} dòng. Bạn chưa cấu hình Script URL nên hãy dùng nút COPY PASTE nhé.`);
        }

    } else {
        alert('Không nhận diện được dòng dữ liệu nào hợp lệ!');
    }
};

function copyToClipboard() {
    const el = document.getElementById('data-clipboard');
    el.select();
    document.execCommand('copy');
    alert('Đã copy dữ liệu! Hãy click vào Google Sheet bên dưới và ấn Ctrl+V.');
}

function clearParsedResult() {
    document.getElementById('coursera-parsed-result').style.display = 'none';
    document.getElementById('data-clipboard').value = '';
}

// NEW: Delete with Custom Modal
function deleteAccount(service, id) {
    document.getElementById('delete-service-type').value = service;
    document.getElementById('delete-target-id').value = id;
    document.getElementById('delete-msg').innerText = `Bạn có chắc chắn muốn xóa ${service === 'chatgpt' ? 'Acc ChatGPT' : 'Acc Coursera'} này?`;
    openModal('modal-confirm-delete');
}

async function executeDelete() {
    const service = document.getElementById('delete-service-type').value;
    const id = document.getElementById('delete-target-id').value;

    try {
        console.log(`Deleting ${service} with ID: ${id}`);
        const res = await fetch(`${API_URL}/${service}/${id}`, { method: 'DELETE' });

        if (res.ok) {
            closeModal('modal-confirm-delete');
            fetchData();
        } else {
            console.error('Failed to delete:', await res.text());
            alert('Lỗi Server: Không thể xóa!');
        }
    } catch (e) {
        console.error(e);
        alert('Lỗi kết nối!');
    }
}

// Initial Load
// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    const savedUrl = localStorage.getItem('appsScriptUrl');
    if (savedUrl) {
        const input = document.getElementById('apps-script-url');
        if (input) input.value = savedUrl;
    }

    // Load saved Sheet Name
    const savedSheetName = localStorage.getItem('lastSheetName');
    if (savedSheetName && document.getElementById('coursera-sheet-name')) {
        document.getElementById('coursera-sheet-name').value = savedSheetName;
    }
});

async function removeUserFromShared(id, userNameToDelete) {
    if (!confirm(`Bạn muốn xóa khách "${userNameToDelete}" khỏi tài khoản này?`)) return;

    try {
        const res = await fetch(`${API_URL}/data`);
        const data = await res.json();
        const acc = data.chatgpt.find(a => a.id == id);

        if (!acc) return;

        const currentUsers = acc.users || [];
        const newUsers = currentUsers.filter(u => u !== userNameToDelete);

        await fetch(`${API_URL}/chatgpt/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                users: newUsers,
                status: 'available'
            })
        });

        fetchData();
    } catch (e) {
        console.error(e);
        alert('Lỗi khi xóa khách hàng shared');
    }
}

// === NEW FEATURES: EDIT ACCOUNT & USERS ===

async function editAccount(id) {
    try {
        const res = await fetch(`${API_URL}/data`);
        const data = await res.json();
        const acc = data.chatgpt.find(a => a.id == id);
        if (!acc) return;

        const form = document.getElementById('form-edit-account');
        form.id.value = acc.id;
        form.username.value = acc.username;
        form.password.value = acc.password;
        form.type.value = acc.type || 'unassigned';
        form.link.value = acc.link || '';

        openModal('modal-edit-account');
    } catch (e) {
        console.error(e);
        alert('Lỗi khi tải thông tin tài khoản');
    }
}

async function saveAccountChanges(e) {
    e.preventDefault();
    const form = e.target;
    const id = form.id.value;

    const body = {
        username: form.username.value,
        password: form.password.value,
        type: form.type.value,
        link: form.link.value
    };

    try {
        await fetch(`${API_URL}/chatgpt/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        closeModal('modal-edit-account');
        fetchData();
        alert('Đã cập nhật tài khoản!');
    } catch (e) {
        console.error(e);
        alert('Lỗi khi lưu thay đổi');
    }
}

async function editUserInPackage1(id, oldName) {
    const newName = prompt("Sửa tên khách hàng:", oldName);
    if (newName === null || newName === oldName) return;
    if (!newName.trim()) { alert('Tên không được để trống'); return; }

    try {
        const res = await fetch(`${API_URL}/data`);
        const data = await res.json();
        const acc = data.chatgpt.find(a => a.id == id);
        if (!acc) return;

        const currentUsers = acc.users || [];
        const index = currentUsers.indexOf(oldName);
        if (index !== -1) {
            currentUsers[index] = newName.trim();
            await fetch(`${API_URL}/chatgpt/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ users: currentUsers })
            });
            fetchData();
        }
    } catch (e) {
        console.error(e);
        alert('Lỗi khi sửa tên khách');
    }
}

async function updateAccountType(id, newType) {
    try {
        await fetch(`${API_URL}/chatgpt/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: newType })
        });
        fetchData(); // Reload to update UI
    } catch (e) {
        console.error(e);
        alert('Lỗi khi cập nhật gói');
    }
}

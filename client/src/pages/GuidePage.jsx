import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Copy, Check, Terminal, Code, Cpu, Shield, ArrowLeft, Download } from 'lucide-react';
import Tilt from '../components/Tilt';
import ThreeSpaceBackground from '../components/ThreeSpaceBackground';

export default function GuidePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isAntigravityPath = location.pathname.includes('/antigravity');
  const [activeTab, setActiveTab] = useState(isAntigravityPath ? 'antigravity' : 'codex');
  const [copiedText, setCopiedText] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  
  const hasAuth = !!localStorage.getItem('adminKey');

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  useEffect(() => {
    setActiveTab(isAntigravityPath ? 'antigravity' : 'codex');
  }, [isAntigravityPath]);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedText(key);
    setTimeout(() => setCopiedText(''), 2000);
  };

  const currentHost = window.location.origin;

  const rawMarkdownCodex = `# 💻 Hướng Dẫn Cấu Hình Máy Khách Sử Dụng Codex API Portal

Tài liệu này hướng dẫn chi tiết cách cấu hình một máy tính bất kỳ (máy khách) để kết nối và sử dụng Codex qua hệ thống API Portal của bạn đã được triển khai (ví dụ: \`${currentHost}\`).

---

## 🛠️ Bước 1: Cài đặt ứng dụng Codex

Người dùng máy khách cần cài đặt một trong hai hình thức sau (hoặc cả hai):

### Cách 1: Sử dụng Codex Desktop App (Khuyên dùng)
Tải và cài đặt ứng dụng **Codex Desktop** chính thức do OpenAI phát hành trên máy tính.

### Cách 2: Sử dụng Codex CLI (Nếu dùng giao diện dòng lệnh)
Mở Terminal/PowerShell và cài đặt Codex CLI toàn cục qua npm:
\`\`\`bash
npm install -g @openai/codex
\`\`\`

---

## ⚙️ Bước 2: Thiết lập file cấu hình \`config.toml\`

Trên máy khách, cần tạo hoặc chỉnh sửa tệp cấu hình của Codex để chuyển tiếp cuộc gọi qua Server của bạn:

1. Tìm tệp cấu hình **\`config.toml\`** theo đường dẫn hệ điều hành:
   - **Windows**: \`C:\\Users\\<Tên_Tài_Khoản_Máy_Tính>\\.codex\\config.toml\`
   - **Mac / Linux**: \`~/.codex/config.toml\`
     _(Nếu chưa có thư mục \`.codex\` hoặc file \`config.toml\`, hãy tự tạo thư mục và file văn bản mới với tên tương ứng)._

2. Mở file \`config.toml\` bằng Notepad hoặc Text Editor và điền cấu hình sau:

\`\`\`toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "KHOA_API_KEY_CUA_MAY_KHACH"
name = "VinAi"
base_url = "${currentHost}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
\`\`\`

3. **Thay đổi các giá trị cấu hình phù hợp**:
   - Thay thế \`"KHOA_API_KEY_CUA_MAY_KHACH"\` bằng mã API Key bạn tạo riêng cho máy khách đó từ trang Admin Portal của bạn (có dạng \`sk-...\`).
   - Thay thế \`"${currentHost}/v1"\` nếu máy chủ Portal của bạn được triển khai ở địa chỉ khác.

---

## 🧪 Bước 3: Khởi động lại và Kiểm thử

1. Hãy **tắt hoàn toàn** ứng dụng Codex Desktop (hoặc đóng các cửa sổ Terminal đang mở) và khởi động lại để Codex nạp cấu hình mới.
2. Thử nghiệm gọi lệnh cơ bản qua CLI để kiểm tra kết nối:
\`\`\`bash
codex "say hello"
\`\`\`
3. Thử nghiệm tính năng chạy công cụ hệ thống (Tool-calling) của Codex trên máy khách:
\`\`\`bash
codex "tạo cho tôi 1 file test_connection.txt trong thư mục hiện tại"
\`\`\`

- **Kết quả đúng**: Codex tự động gọi công cụ tạo file cục bộ và báo thành công mà không trả ra văn bản JSON thô. Lịch sử sử dụng sẽ hiển thị trên Dashboard Admin Portal của bạn.`;

  const rawMarkdownAntigravity = `# Hướng dẫn kết nối máy khách đến AntiGravity Portal (Gemini Code Assist)

Tài liệu này hướng dẫn chi tiết cách kết nối các máy khách (Client) để sử dụng chung **Antigravity Pool (Gemini Code Assist)** xoay vòng tài khoản Google của bạn thông qua Server Portal (ví dụ: \`${currentHost}\`).

---

## 🧭 1. CƠ CHẾ HOẠT ĐỘNG

Extension **Google Gemini Code Assist (Cloud Code)** trên VS Code được lập trình cứng để gọi đến địa chỉ API Google mặc định. Do đó, để chuyển hướng traffic này về hệ thống của bạn, bắt buộc máy khách phải có cơ chế chặn và giả lập kết nối.

---

## 📡 2. HƯỚNG DẪN KẾT NỐI MÁY KHÁCH (CLIENT SETUP)

Có **3 phương pháp** để cấu hình các máy khách kết nối và sử dụng tài nguyên từ Server của bạn.

### PHƯƠNG PHÁP A: Dành cho các công cụ hỗ trợ Custom Base URL (Cursor, Cline, RooCode, Continue...)
Nếu người dùng sử dụng các công cụ hỗ trợ cấu hình Custom Base URL trực tiếp, việc cài đặt cực kỳ đơn giản:

1.  **Chọn Provider:** \`OpenAI Compatible\` (hoặc Custom OpenAI).
2.  **Base URL (API Endpoint):** \`${currentHost}/v1/antigravity\`
3.  **API Key:** Điền mã API Key được cấp trên Portal của bạn (dạng \`sk-...\`).
4.  **Model:** \`gemini-2.5-pro\`, \`gemini-2.5-flash\`, \`gemini-2.0-flash\`.

---

### PHƯƠNG PHÁP B: Sử dụng Script Proxy Siêu Nhẹ (Khuyên Dùng - Tốc độ cao & VS Code Extension)
Đây là cách tối ưu nhất để kết nối trực tiếp extension **Google Gemini Code Assist** chính thức trên VS Code mà không cần cài đặt phần mềm 9Router.

#### Các bước thực hiện trên máy khách:
1.  **Cài đặt Node.js:** Đảm bảo máy khách đã cài Node.js (phiên bản >= 18).
2.  **Tải file script:** Copy file \`client-proxy.js\` về máy khách.
3.  **Chạy script với quyền Administrator / Root:**
    *   **Trên Windows:** Mở PowerShell với quyền *Run as Administrator* rồi chạy:
        \`\`\`powershell
        node client-proxy.js --server ${currentHost} --key YOUR_PORTAL_API_KEY
        \`\`\`
    *   **Trên macOS / Linux:** Mở Terminal và chạy:
        \`\`\`bash
        sudo node client-proxy.js --server ${currentHost} --key YOUR_PORTAL_API_KEY
        \`\`\`
4.  **Khởi động lại VS Code:** Extension Gemini Code Assist sẽ tự động hoạt động thông qua pool tài khoản trên server của bạn. Khi tắt script bằng \`Ctrl+C\`, file \`hosts\` sẽ tự động được khôi phục về trạng thái sạch sẽ ban đầu.

---

### PHƯƠNG PHÁP C: Tích hợp thông qua phần mềm 9Router Client chính thức
Nếu máy khách muốn sử dụng giao diện Dashboard quản trị của 9Router để gộp chung với các combo AI khác.

#### Bước C.1: Khởi chạy 9Router trên máy khách
Mở Terminal/PowerShell trên máy khách và chạy:
\`\`\`bash
npm install -g 9router
9router
\`\`\`

#### Bước C.2: Cấu hình thêm Portal của bạn làm Provider trên 9Router Local
1.  Truy cập Dashboard local \`http://localhost:20128/dashboard\`.
2.  Mở menu **Providers** -> Chọn **Add Custom Provider**.
3.  Điền các thông số:
    *   **Name:** \`Codex Portal\`
    *   **Base URL:** \`${currentHost}/v1\`
    *   **API Key:** \`YOUR_PORTAL_API_KEY\` (Mã key \`sk-...\` do bạn cấp).
4.  Bấm **Save**.

#### Bước C.3: Kích hoạt chặn kết nối (MITM) trên máy khách
1.  Trên Dashboard 9Router local, chọn **CLI Tools** -> **Antigravity**.
2.  Bấm vào nút **Start MITM**.
3.  VS Code sẽ tự động hoạt động thông qua pool của server.`;

  const codeSnippets = {
    codexToml: `model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "KHOA_API_KEY_CUA_MAY_KHACH"
name = "VinAi"
base_url = "${currentHost}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`,
    
    installCodex: `npm install -g @openai/codex`,
    testCodex1: `codex "say hello"`,
    testCodex2: `codex "tạo cho tôi 1 file test_connection.txt trong thư mục hiện tại"`,

    proxyWin: `node client-proxy.js --server ${currentHost} --key YOUR_PORTAL_API_KEY`,
    proxyMac: `sudo node client-proxy.js --server ${currentHost} --key YOUR_PORTAL_API_KEY`,
    installNineRouter: `npm install -g 9router
9router`
  };

  const handleGoBack = () => {
    if (hasAuth) {
      navigate(isAntigravityPath ? '/antigravity/dashboard' : '/dashboard');
    } else {
      navigate(isAntigravityPath ? '/antigravity/login' : '/login');
    }
  };

  return (
    <div className="guide-page-container">
      {/* Three.js WebGL 3D Background */}
      <ThreeSpaceBackground activeTab={activeTab} />

      {/* Subtle noise and glow overlays */}
      <div className="login-noise" aria-hidden="true" style={{ opacity: 0.04 }} />

      <div style={{ maxWidth: 840, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        
        {/* Navigation & Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleGoBack}>
            <ArrowLeft size={14} /> {hasAuth ? 'Quay lại Dashboard' : 'Quay lại Đăng nhập'}
          </button>
          
          <button 
            className={`btn btn-sm ${activeTab === 'antigravity' ? 'btn-success ag-accent-bg' : 'btn-primary'}`}
            onClick={() => copyToClipboard(activeTab === 'antigravity' ? rawMarkdownAntigravity : rawMarkdownCodex, 'all')}
          >
            {copiedText === 'all' ? <Check size={14} /> : <Copy size={14} />}
            {copiedText === 'all' ? 'Đã sao chép tài liệu!' : 'Sao chép toàn bộ tài liệu (Markdown)'}
          </button>
        </div>

        <div className="page-header">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            <BookOpen size={24} className={activeTab === 'antigravity' ? 'icon-amber' : 'icon-indigo'} />
            Tài liệu Cấu hình Máy khách (Client Guide)
          </h1>
          <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--text-secondary)' }}>
            Hướng dẫn kết nối máy tính người dùng đến Server Portal của bạn
          </p>
        </div>

        {/* Tab Selection */}
        <div className="flex gap-2 mb-4" role="tablist" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
          <button
            role="tab"
            aria-selected={activeTab === 'codex'}
            onClick={() => {
              setActiveTab('codex');
              navigate('/guide');
            }}
            className={`btn btn-sm ${activeTab === 'codex' ? 'btn-primary' : 'btn-ghost'}`}
          >
            💻 Hướng dẫn Codex (README)
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'antigravity'}
            onClick={() => {
              setActiveTab('antigravity');
              navigate('/antigravity/guide');
            }}
            className={`btn btn-sm ${activeTab === 'antigravity' ? 'btn-primary ag-accent-bg' : 'btn-ghost'}`}
          >
            🪐 Kết nối AntiGravity (Gemini)
          </button>
        </div>

        {/* Content Container */}
        <div key={activeTab} className="reveal visible" style={{ marginTop: 20 }}>
          {activeTab === 'codex' ? (
            <div>
              {/* Codex Guide */}
              <Tilt className="stagger-item card mb-4" max={3} perspective={1200} style={{ animationDelay: '0ms' }}>
                <div className="card-header">
                  <span className="card-title">💻 Hướng Dẫn Cấu Hình Máy Khách Sử Dụng Codex API Portal</span>
                </div>
                <p style={{ fontSize: '0.92rem', color: 'var(--text-soft)' }}>
                  Tài liệu này hướng dẫn chi tiết cách cấu hình một máy tính bất kỳ (máy khách) để kết nối và sử dụng Codex qua hệ thống API Portal của bạn tại địa chỉ: <code className="font-mono">{currentHost}</code>
                </p>
              </Tilt>

              {/* Step 1 */}
              <Tilt className="stagger-item card mb-4" max={3} perspective={1200} style={{ animationDelay: '80ms' }}>
                <div className="card-header">
                  <span className="card-title"><Shield size={15} style={{ color: 'var(--accent-light)' }} /> Bước 1: Cài đặt ứng dụng Codex</span>
                </div>
                <div style={{ display: 'grid', gap: 16, fontSize: '0.88rem', color: 'var(--text-soft)' }}>
                  <div>
                    <strong>Cách 1: Sử dụng Codex Desktop App (Khuyên dùng)</strong>
                    <p style={{ color: 'var(--text-soft)', marginTop: 4, opacity: 0.85 }}>
                      Tải và cài đặt ứng dụng <strong>Codex Desktop</strong> chính thức do OpenAI phát hành trên máy tính của bạn.
                    </p>
                  </div>
                  <div>
                    <strong>Cách 2: Sử dụng Codex CLI (Nếu dùng giao diện dòng lệnh)</strong>
                    <p style={{ color: 'var(--text-soft)', marginTop: 4, marginBottom: 8, opacity: 0.85 }}>
                      Mở Terminal/PowerShell và cài đặt Codex CLI toàn cục:
                    </p>
                    <div className="code-container" style={{ position: 'relative' }}>
                      <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem' }}>
                        {codeSnippets.installCodex}
                      </pre>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.installCodex, 'instCodex')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                        {copiedText === 'instCodex' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </Tilt>

              {/* Step 2 */}
              <Tilt className="stagger-item card mb-4" max={3} perspective={1200} style={{ animationDelay: '160ms' }}>
                <div className="card-header">
                  <span className="card-title"><Code size={15} style={{ color: 'var(--accent-light)' }} /> Bước 2: Thiết lập file cấu hình config.toml</span>
                </div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-soft)', display: 'grid', gap: 10 }}>
                  <p>Trên máy khách, cần tạo hoặc chỉnh sửa tệp cấu hình của Codex để chuyển tiếp cuộc gọi qua Server:</p>
                  <div>
                    1. Tìm tệp cấu hình <strong><code>config.toml</code></strong> theo đường dẫn hệ điều hành:
                    <ul style={{ paddingLeft: 20, marginTop: 4, color: 'var(--text-soft)', opacity: 0.85 }}>
                      <li><strong>Windows</strong>: <code>C:\Users\&lt;Tên_Tài_Khoản_Máy_Tính&gt;\.codex\config.toml</code></li>
                      <li><strong>Mac / Linux</strong>: <code>~/.codex/config.toml</code></li>
                    </ul>
                    <p style={{ fontStyle: 'italic', fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: 4, opacity: 0.75 }}>
                      (Nếu chưa có thư mục <code>.codex</code> hoặc file <code>config.toml</code>, hãy tự tạo thư mục và file văn bản mới).
                    </p>
                  </div>
                  <div>
                    2. Mở file <code>config.toml</code> và điền cấu hình sau:
                    <div className="code-container" style={{ position: 'relative', marginTop: 8 }}>
                      <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '12px 38px 12px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto' }}>
                        {codeSnippets.codexToml}
                      </pre>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.codexToml, 'toml')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                        {copiedText === 'toml' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </Tilt>

              <Tilt className="stagger-item card" max={3} perspective={1200} style={{ animationDelay: '240ms' }}>
                <div className="card-header">
                  <span className="card-title"><Terminal size={15} style={{ color: 'var(--accent-light)' }} /> Bước 3: Khởi động lại và Kiểm thử</span>
                </div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-soft)', display: 'grid', gap: 12 }}>
                  <div>
                    1. Hãy <strong>tắt hoàn toàn</strong> ứng dụng Codex Desktop và khởi động lại.
                  </div>
                  <div>
                    2. Thử nghiệm gọi lệnh cơ bản qua CLI:
                    <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                      <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem' }}>
                        {codeSnippets.testCodex1}
                      </pre>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.testCodex1, 'test1')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                        {copiedText === 'test1' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    3. Thử nghiệm tính năng chạy công cụ hệ thống (Tool-calling):
                    <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                      <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem' }}>
                        {codeSnippets.testCodex2}
                      </pre>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.testCodex2, 'test2')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                        {copiedText === 'test2' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </Tilt>
            </div>
          ) : (
            <div>
              <Tilt className="stagger-item card mb-4" max={3} perspective={1200} style={{ animationDelay: '0ms' }}>
                <div className="card-header">
                  <span className="card-title">🪐 Hướng dẫn kết nối máy khách đến AntiGravity Portal</span>
                </div>
              </Tilt>

              <Tilt className="stagger-item card mb-4" max={3} perspective={1200} style={{ animationDelay: '80ms' }}>
                <div className="card-header">
                  <span className="card-title" style={{ color: 'var(--green)' }}><Code size={15} /> PHƯƠNG PHÁP A: Dành cho công cụ hỗ trợ Custom Base URL</span>
                </div>
                <div style={{ display: 'grid', gap: 10, fontSize: '0.88rem', background: 'var(--bg-elevated)', padding: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <div><strong>1. Provider:</strong> <code>OpenAI Compatible</code></div>
                  <div><strong>2. API URL:</strong> <code>{currentHost}/v1/antigravity</code></div>
                </div>
              </Tilt>

              <Tilt className="stagger-item card mb-4" max={3} perspective={1200} style={{ animationDelay: '160ms' }}>
                <div className="card-header">
                  <span className="card-title" style={{ color: '#e0a82e' }}><Terminal size={15} /> PHƯƠNG PHÁP B: Sử dụng script Proxy siêu nhẹ</span>
                </div>
                <div className="form-group mb-3">
                  <label>Chạy script proxy trên máy khách</label>
                  <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                    <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto' }}>
                      {codeSnippets.proxyWin}
                    </pre>
                  </div>
                </div>
                <div className="alert alert-info">
                  Khi tắt script (Ctrl+C), file <code>hosts</code> sẽ tự động khôi phục.
                </div>
              </Tilt>

              <Tilt className="stagger-item card" max={3} perspective={1200} style={{ animationDelay: '240ms' }}>
                <div className="card-header">
                  <span className="card-title" style={{ color: 'var(--purple)' }}><Cpu size={15} /> PHƯƠNG PHÁP C: Tích hợp thông qua phần mềm 9Router Client</span>
                </div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-soft)', marginBottom: 12, opacity: 0.85 }}>
                  Thích hợp nếu máy khách muốn sử dụng giao diện Dashboard quản trị của 9Router để gộp chung với các nguồn AI khác.
                </p>

                <div className="form-group mb-3">
                  <label>Bước C.1: Khởi chạy 9Router trên máy khách</label>
                  <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                    <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto' }}>
                      {codeSnippets.installNineRouter}
                    </pre>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.installNineRouter, '9r')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                      {copiedText === '9r' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                <div className="form-group mb-3" style={{ fontSize: '0.86rem', color: 'var(--text-soft)', display: 'grid', gap: 6 }}>
                  <label>Bước C.2: Cấu hình thêm Portal làm Provider trên 9Router Local</label>
                  <div>1. Truy cập Dashboard local <code>http://localhost:20128/dashboard</code>.</div>
                  <div>2. Mở menu <strong>Providers</strong> &rarr; Chọn <strong>Add Custom Provider</strong>.</div>
                  <div>3. Điền API Endpoint: <code>{currentHost}/v1</code> và API Key của bạn.</div>
                </div>

                <div className="form-group mb-3" style={{ fontSize: '0.86rem', color: 'var(--text-soft)', display: 'grid', gap: 6 }}>
                  <label>Bước C.3: Kích hoạt chặn kết nối (MITM) trên máy khách</label>
                  <div>1. Trên Dashboard 9Router local, chọn <strong>CLI Tools</strong> &rarr; <strong>Antigravity</strong>.</div>
                  <div>2. Bấm vào nút <strong>Start MITM</strong> để kích hoạt.</div>
                </div>
              </Tilt>
            </div>

          )}
        </div>

        {/* Back To Top — matching reference project .back-to-top class */}
        <button
          className={`back-to-top${showBackToTop ? ' visible' : ''}`}
          onClick={scrollToTop}
          aria-label="Quay lại đầu trang"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

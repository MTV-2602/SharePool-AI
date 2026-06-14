import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, Copy, Check, Terminal, Code, Cpu, Shield, AlertTriangle } from 'lucide-react';

export default function GuidePage() {
  const location = useLocation();
  const isAntigravityPath = location.pathname.includes('/antigravity');
  const [activeTab, setActiveTab] = useState(isAntigravityPath ? 'antigravity' : 'codex');
  const [copiedText, setCopiedText] = useState('');

  useEffect(() => {
    setActiveTab(isAntigravityPath ? 'antigravity' : 'codex');
  }, [isAntigravityPath]);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedText(key);
    setTimeout(() => setCopiedText(''), 2000);
  };

  const codeSnippets = {
    env: `REQUIRE_API_KEY=true
ADMIN_KEY=your_admin_key_here
ANTIGRAVITY_CLIENT_ID=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com
ANTIGRAVITY_CLIENT_SECRET=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`,
    
    proxyWin: `node client-proxy.js --server https://vinhcousera.vercel.app --key YOUR_PORTAL_API_KEY`,
    proxyMac: `sudo node client-proxy.js --server https://vinhcousera.vercel.app --key YOUR_PORTAL_API_KEY`,
    
    nineRouter: `npm install -g 9router
9router`,

    nodeOpenAI: `const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: 'YOUR_PORTAL_API_KEY', // Thay bằng API Key của bạn từ Admin Portal
  baseURL: 'https://vinhcousera.vercel.app/v1' // Trỏ về Portal xoay vòng ChatGPT
});

async function runChatbot() {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Chọn model ChatGPT muốn dùng
      messages: [
        { role: 'system', content: 'Bạn là một chatbot hỗ trợ đắc lực.' },
        { role: 'user', content: 'Xin chào, hãy giới thiệu bản thân nhé.' }
      ],
      stream: false
    });

    console.log('Bot trả lời:', completion.choices[0].message.content);
  } catch (error) {
    console.error('Lỗi khi gọi API:', error.message);
  }
}

runChatbot();`,

    pythonOpenAI: `from openai import OpenAI

client = OpenAI(
    api_key="YOUR_PORTAL_API_KEY", # Thay bằng API Key của bạn từ Admin Portal
    base_url="https://vinhcousera.vercel.app/v1" # Trỏ về Portal xoay vòng ChatGPT
)

try:
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Bạn là trợ lý AI thông thái."},
            {"role": "user", "content": "Làm thế nào để học lập trình nhanh?"}
        ]
    )
    print("Bot trả lời:", completion.choices[0].message.content)
except Exception as e:
    print("Lỗi kết nối:", e) `,

    jsFetch: `async function askChatbot(prompt) {
  const url = 'https://vinhcousera.vercel.app/v1/chat/completions';
  const apiKey = 'YOUR_PORTAL_API_KEY'; // Thay bằng API Key từ Portal

  const payload = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${apiKey}\`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Lỗi:', error.message);
  }
}`
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BookOpen size={24} className={activeTab === 'antigravity' ? 'icon-amber' : 'icon-indigo'} />
          Tài liệu Hướng dẫn & Tích hợp
        </h1>
        <p>Hướng dẫn kết nối API Key từ Portal của bạn vào các ứng dụng client</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4" role="tablist" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button
          role="tab"
          aria-selected={activeTab === 'antigravity'}
          onClick={() => setActiveTab('antigravity')}
          className={`btn btn-sm ${activeTab === 'antigravity' ? 'btn-primary ag-accent-bg' : 'btn-ghost'}`}
        >
          🪐 Hướng dẫn AntiGravity (Gemini)
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'codex'}
          onClick={() => setActiveTab('codex')}
          className={`btn btn-sm ${activeTab === 'codex' ? 'btn-primary' : 'btn-ghost'}`}
        >
          💬 Hướng dẫn ChatGPT API
        </button>
      </div>

      <div className="space-y-4">
        {activeTab === 'antigravity' ? (
          <div className="reveal visible">
            {/* Intro */}
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title">🚀 Giới thiệu AntiGravity Gemini Portal</span>
              </div>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                Hệ thống **AntiGravity** cho phép xoay vòng các tài khoản Google để gọi API Google Gemini Code Assist với hiệu năng cực cao và khả năng bảo mật tối đa. Dưới đây là 3 phương pháp tích hợp API Key vào máy khách.
              </p>
            </div>

            {/* Method A */}
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title" style={{ color: 'var(--green)' }}><Code size={16} /> PHƯƠNG PHÁP A: Tích hợp trực tiếp (Direct API)</span>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Dành cho các công cụ hỗ trợ cấu hình Custom Base URL trực tiếp như **Cursor, Cline, RooCode, Continue...**
              </p>
              <div style={{ display: 'grid', gap: 10, fontSize: '0.88rem', background: 'var(--bg-elevated)', padding: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div><strong>1. Provider:</strong> <code>OpenAI Compatible</code> (hoặc Custom OpenAI)</div>
                <div><strong>2. API URL (Base URL):</strong> <code>https://vinhcousera.vercel.app/v1/antigravity</code></div>
                <div><strong>3. API Key:</strong> Nhập API Key do Portal cung cấp (dạng <code>sk-...</code>)</div>
                <div><strong>4. Models hỗ trợ:</strong> <code>gemini-2.5-pro</code>, <code>gemini-2.5-flash</code>, <code>gemini-2.0-flash</code></div>
              </div>
            </div>

            {/* Method B */}
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title" style={{ color: '#e0a82e' }}><Terminal size={16} /> PHƯƠNG PHÁP B: Sử dụng script Proxy siêunhẹ (Khuyên dùng)</span>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Phương pháp tối ưu nhất để kết nối trực tiếp extension **Google Gemini Code Assist** gốc trên VS Code mà không cần cài đặt phần mềm 9Router.
              </p>

              <div className="form-group mb-3">
                <label>Bước 1: Cài đặt Node.js</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tải và cài đặt Node.js (phiên bản &gt;= 18) trên máy khách.</p>
              </div>

              <div className="form-group mb-3">
                <label>Bước 2: Chạy script proxy trên máy khách</label>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Chạy trên Windows (PowerShell với quyền Administrator):</span>
                    <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                      <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto' }}>
                        {codeSnippets.proxyWin}
                      </pre>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.proxyWin, 'win')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                        {copiedText === 'win' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Chạy trên macOS / Linux (Terminal):</span>
                    <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                      <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto' }}>
                        {codeSnippets.proxyMac}
                      </pre>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.proxyMac, 'mac')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                        {copiedText === 'mac' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="alert alert-info">
                <strong>Lưu ý:</strong> Khi bạn tắt script proxy (bằng cách ấn Ctrl+C), file <code>hosts</code> trên máy khách sẽ tự động được khôi phục về trạng thái sạch sẽ ban đầu.
              </div>
            </div>

            {/* Method C */}
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title" style={{ color: 'var(--purple)' }}><Cpu size={16} /> PHƯƠNG PHÁP C: Kết nối thông qua 9Router Client</span>
              </div>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                Thích hợp nếu máy khách đã cài đặt và sử dụng phần mềm quản lý 9Router Client local để gộp chung nhiều nguồn AI.
              </p>

              <div className="form-group mb-3">
                <label>Bước 1: Khởi chạy 9Router trên máy khách</label>
                <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                  <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto' }}>
                    {codeSnippets.nineRouter}
                  </pre>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.nineRouter, '9r')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                    {copiedText === '9r' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              <div className="form-group mb-3" style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', display: 'grid', gap: 6 }}>
                <label>Bước 2: Cấu hình trên Dashboard 9Router local (localhost:20128)</label>
                <div>1. Vào menu <strong>Providers</strong> &rarr; Click <strong>Add Custom Provider</strong></div>
                <div>2. Điền API Endpoint: <code>https://vinhcousera.vercel.app/v1</code> và API Key của bạn.</div>
                <div>3. Vào menu <strong>CLI Tools</strong> &rarr; Chọn <strong>Antigravity</strong> và click <strong>Start MITM</strong> để kích hoạt.</div>
              </div>
            </div>

            {/* Comparison */}
            <div className="card">
              <div className="card-header">
                <span className="card-title"><Shield size={16} /> Bảng so sánh các phương pháp</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Tiêu chí</th>
                      <th>Phương pháp A (Direct)</th>
                      <th>Phương pháp B (Script)</th>
                      <th>Phương pháp C (9Router)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Dành cho</td>
                      <td>Cursor, Cline, RooCode</td>
                      <td>Gemini Code Assist gốc</td>
                      <td>Gemini Code Assist gốc</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Cài đặt</td>
                      <td>Không cần cài gì thêm</td>
                      <td>Cần Node.js & script file</td>
                      <td>Cần cài 9router qua npm</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Quyền Admin</td>
                      <td>Không yêu cầu</td>
                      <td>Có (khi chạy script)</td>
                      <td>Có (khi Start MITM)</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Ưu điểm</td>
                      <td style={{ color: 'var(--green)' }}>Đơn giản nhất, không overhead</td>
                      <td style={{ color: 'var(--green)' }}>Dùng extension gốc, siêu nhẹ</td>
                      <td style={{ color: 'var(--green)' }}>Quản lý đa provider, giao diện web</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="reveal visible">
            {/* Codex ChatGPT Guide */}
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title">💬 Tích hợp API Chatbot (ChatGPT Rotation)</span>
              </div>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Đặc tả API và mã mẫu để cấu hình tích hợp API Portal của bạn làm backend cho chatbot qua giao thức tương thích OpenAI.
              </p>
              <div style={{ display: 'grid', gap: 10, fontSize: '0.88rem', background: 'var(--bg-elevated)', padding: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div><strong>HTTP Method:</strong> <code style={{ color: 'var(--green)' }}>POST</code></div>
                <div><strong>Endpoint:</strong> <code>https://vinhcousera.vercel.app/v1/chat/completions</code></div>
                <div><strong>Header:</strong> <code>Authorization: Bearer YOUR_PORTAL_API_KEY</code></div>
                <div><strong>Models hỗ trợ:</strong> <code>gpt-4o</code>, <code>gpt-4o-mini</code>, <code>gpt-3.5-turbo</code></div>
              </div>
            </div>

            {/* Code Snippets */}
            <div className="card">
              <div className="card-header">
                <span className="card-title"><Code size={16} /> Ví dụ các ngôn ngữ lập trình</span>
              </div>

              {/* Node.js OpenAI */}
              <div className="form-group mb-4">
                <label>1. Node.js (OpenAI SDK)</label>
                <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                  <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '12px 38px 12px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto', maxHeight: 300 }}>
                    {codeSnippets.nodeOpenAI}
                  </pre>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.nodeOpenAI, 'node')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                    {copiedText === 'node' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* Python OpenAI */}
              <div className="form-group mb-4">
                <label>2. Python (OpenAI SDK)</label>
                <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                  <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '12px 38px 12px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto', maxHeight: 300 }}>
                    {codeSnippets.pythonOpenAI}
                  </pre>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.pythonOpenAI, 'py')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                    {copiedText === 'py' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* JS Fetch */}
              <div className="form-group">
                <label>3. JavaScript (Native Fetch - No Library)</label>
                <div className="code-container" style={{ position: 'relative', marginTop: 4 }}>
                  <pre className="font-mono" style={{ background: 'var(--bg-elevated)', padding: '12px 38px 12px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.78rem', overflowX: 'auto', maxHeight: 300 }}>
                    {codeSnippets.jsFetch}
                  </pre>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => copyToClipboard(codeSnippets.jsFetch, 'js')} style={{ position: 'absolute', right: 6, top: 6, padding: 4 }}>
                    {copiedText === 'js' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

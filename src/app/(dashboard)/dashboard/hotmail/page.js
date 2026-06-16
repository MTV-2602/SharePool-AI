"use client";

import { useState, useEffect } from "react";

// ─── TOTP Helper Functions for 2FA ───────────────────────────────────────────
function base32tohex(base32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", hex = "";
  for (let i = 0; i < base32.length; i++) {
    const v = chars.indexOf(base32.charAt(i).toUpperCase());
    if (v !== -1) bits += v.toString(2).padStart(5, "0");
  }
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.substr(i, 4), 2).toString(16);
  return hex;
}

async function getTOTP(secret) {
  try {
    const hex = base32tohex(secret.replace(/\s/g, ''));
    const time = Math.floor(Math.floor(Date.now() / 1000) / 30).toString(16).padStart(16, "0");
    const timeBuffer = new Uint8Array(8);
    for (let i = 0; i < 8; i++) timeBuffer[i] = parseInt(time.substr(i * 2, 2), 16);
    const keyBuffer = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length / 2; i++) keyBuffer[i] = parseInt(hex.substr(i * 2, 2), 16);
    const key = await window.crypto.subtle.importKey("raw", keyBuffer, { name: "HMAC", hash: { name: "SHA-1" } }, false, ["sign"]);
    const hmac = new Uint8Array(await window.crypto.subtle.sign("HMAC", key, timeBuffer));
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return (code % 1000000).toString().padStart(6, "0");
  } catch (e) { console.error("TOTP error", e); return null; }
}

function TwoFactorCell({ secret }) {
  const [otp, setOtp] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateOtp = async () => {
    if (!secret) return;
    setLoading(true);
    try {
      const code = await getTOTP(secret);
      if (code) {
        setOtp(code);
        navigator.clipboard.writeText(code).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
        setTimeLeft(remaining);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!otp) return;
    const interval = setInterval(() => {
      const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
      if (rem <= 0 || rem > 30) {
        generateOtp();
      } else {
        setTimeLeft(rem);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [otp, secret]);

  if (!secret) return <span className="text-slate-500">—</span>;

  return (
    <div className="flex items-center gap-1.5">
      {otp ? (
        <div className="flex items-center gap-1">
          <span
            className="bg-emerald-500 text-slate-950 font-bold px-1.5 py-0.5 rounded font-mono text-[10px] cursor-pointer inline-block"
            onClick={generateOtp}
            title="Click to copy new OTP"
          >
            {otp}
          </span>
          <span className="text-[9px] text-slate-400">({timeLeft}s)</span>
          {copied && <span className="text-[9px] text-emerald-400">✓</span>}
        </div>
      ) : (
        <button
          onClick={generateOtp}
          disabled={loading}
          className="bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900 border border-indigo-500/30 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors"
        >
          {loading ? '...' : '🔑 OTP'}
        </button>
      )}
    </div>
  );
}

export default function HotmailPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Modals state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Selected state
  const [selectedEmail, setSelectedEmail] = useState("");
  const [selectedAccount, setSelectedAccount] = useState(null);
  
  // Inbox / OTP contents
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [otpInfo, setOtpInfo] = useState(null);
  const [otpLoading, setOtpLoading] = useState(false);

  // Form states
  const [bulkInput, setBulkInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [totpSecretInput, setTotpSecretInput] = useState("");
  const [clientIdInput, setClientIdInput] = useState("");
  const [refreshTokenInput, setRefreshTokenInput] = useState("");
  const [statusInput, setStatusInput] = useState("available");
  
  const [chatgptPasswordInput, setChatgptPasswordInput] = useState("");
  const [chatgptOtpSecretInput, setChatgptOtpSecretInput] = useState("");

  // Copy status
  const [copiedText, setCopiedText] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hotmail");
      const data = await res.json();
      if (res.ok) {
        setAccounts(data);
      } else {
        setError(data.error || "Failed to fetch accounts");
      }
    } catch (err) {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImport = async (e) => {
    e.preventDefault();
    const lines = bulkInput.split("\n").filter(l => l.trim());
    if (!lines.length) return;

    const parsed = lines.map(line => {
      const cleanLine = line.trim();
      const separator = cleanLine.includes('|') ? '|' : ':';
      const parts = cleanLine.split(separator).map(p => p.trim());
      if (parts.length < 2) return null;

      const email = parts[0];
      const password = parts[1];

      if (parts.length === 2) {
        return { email, password, refresh_token: null, client_id: null, totp_secret: null };
      }
      if (parts.length === 3) {
        return { email, password, refresh_token: null, client_id: null, totp_secret: parts[2] };
      }
      if (parts.length === 4) {
        return { email, password, refresh_token: parts[2], client_id: parts[3], totp_secret: null };
      }
      return { email, password, refresh_token: parts[2], client_id: parts[3], totp_secret: parts[4] };
    }).filter(Boolean);

    try {
      const res = await fetch("/api/hotmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: parsed }),
      });
      if (res.ok) {
        setShowBulkModal(false);
        setBulkInput("");
        fetchAccounts();
      } else {
        alert("Failed to import accounts");
      }
    } catch (err) {
      alert("Failed to connect to backend");
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!selectedAccount) return;

    try {
      const res = await fetch(`/api/hotmail/${selectedAccount.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput,
          password: passwordInput,
          totp_secret: totpSecretInput,
          client_id: clientIdInput,
          refresh_token: refreshTokenInput,
          status: statusInput,
          chatgpt_password: chatgptPasswordInput,
          chatgpt_otp_secret: chatgptOtpSecretInput,
        }),
      });
      if (res.ok) {
        setShowEditModal(false);
        setSelectedAccount(null);
        fetchAccounts();
      } else {
        alert("Failed to update account");
      }
    } catch (err) {
      alert("Failed to connect to backend");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this Hotmail account?")) return;
    try {
      const res = await fetch(`/api/hotmail/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchAccounts();
      } else {
        alert("Failed to delete account");
      }
    } catch (err) {
      alert("Failed to connect to backend");
    }
  };

  const viewInbox = async (email) => {
    setSelectedEmail(email);
    setShowInboxModal(true);
    setEmailsLoading(true);
    try {
      const res = await fetch(`/api/hotmail/inbox?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (res.ok) {
        setEmails(data.messages || []);
      } else {
        setEmails([]);
        alert(data.error || "Failed to fetch inbox");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEmailsLoading(false);
    }
  };

  const viewOtp = async (email) => {
    setSelectedEmail(email);
    setShowOtpModal(true);
    setOtpLoading(true);
    setOtpInfo(null);
    try {
      const res = await fetch(`/api/hotmail/otp?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (res.ok) {
        setOtpInfo(data);
      } else {
        alert(data.error || "Failed to fetch OTP");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setOtpLoading(false);
    }
  };

  const openEditModal = (acc) => {
    setSelectedAccount(acc);
    setEmailInput(acc.email);
    setPasswordInput(acc.password || "");
    setTotpSecretInput(acc.totp_secret || "");
    setClientIdInput(acc.client_id || "");
    setRefreshTokenInput(acc.refresh_token || "");
    setStatusInput(acc.status);
    setChatgptPasswordInput(acc.chatgpt?.password || "");
    setChatgptOtpSecretInput(acc.chatgpt?.otp_secret || "");
    setShowEditModal(true);
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-100 min-h-screen">
      <div className="flex justify-between items-center bg-slate-900/60 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl shadow-xl">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">Hotmail Accounts Pool</h1>
          <p className="text-slate-400 mt-1">Manage, rotate and read verification codes automatically from Microsoft Graph Outlook accounts.</p>
        </div>
        <button
          onClick={() => { setShowBulkModal(true); }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20 flex items-center gap-2"
        >
          <span className="material-symbols-outlined">playlist_add</span> Import Accounts
        </button>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 text-red-200 p-4 rounded-xl flex items-center gap-3">
          <span className="material-symbols-outlined text-red-400">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl">
          <span className="material-symbols-outlined text-slate-600 text-6xl">mail</span>
          <p className="text-slate-400 mt-4">No Hotmail accounts found. Click "Import Accounts" to add some.</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left">
              <thead className="bg-slate-950/40 text-slate-400 uppercase text-xs font-semibold tracking-wider">
                <tr>
                  <th className="px-6 py-4">Email Address</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-center">Usage Count</th>
                  <th className="px-6 py-4">Last Active</th>
                  <th className="px-6 py-4">Created At</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-800/30 transition-all align-top">
                    <td className="px-6 py-4 font-medium text-slate-200">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 font-mono text-indigo-400">
                          <span>{acc.email}</span>
                          <button onClick={() => copyText(acc.email)} className="text-slate-500 hover:text-slate-300" title="Copy Email">
                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                          </button>
                        </div>
                        {acc.reserved_by_ip && (
                          <div className="text-[10px] text-amber-400 font-normal">Reserved IP: {acc.reserved_by_ip}</div>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-normal">
                          {acc.password && (
                            <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800">
                              <span className="text-[9px] text-slate-500 font-sans">PW:</span>
                              <span className="font-mono">{acc.password}</span>
                              <button onClick={() => copyText(acc.password)} className="text-slate-500 hover:text-slate-300 flex" title="Copy Password">
                                <span className="material-symbols-outlined text-[12px]">content_copy</span>
                              </button>
                            </div>
                          )}
                          {acc.totp_secret && (
                            <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800">
                              <span className="text-[9px] text-slate-500 font-sans">2FA:</span>
                              <span className="font-mono truncate max-w-[80px]" title={acc.totp_secret}>{acc.totp_secret}</span>
                              <button onClick={() => copyText(acc.totp_secret)} className="text-slate-500 hover:text-slate-300 flex" title="Copy Secret">
                                <span className="material-symbols-outlined text-[12px]">content_copy</span>
                              </button>
                            </div>
                          )}
                          {acc.client_id && (
                            <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800">
                              <span className="text-[9px] text-slate-500 font-sans">CID:</span>
                              <span className="font-mono truncate max-w-[80px]" title={acc.client_id}>{acc.client_id}</span>
                              <button onClick={() => copyText(acc.client_id)} className="text-slate-500 hover:text-slate-300 flex" title="Copy Client ID">
                                <span className="material-symbols-outlined text-[12px]">content_copy</span>
                              </button>
                            </div>
                          )}
                        </div>
                        
                        {/* ChatGPT account mapping section */}
                        <div className="pt-1.5 mt-1.5 border-t border-slate-800/60">
                          {acc.hasChatGPT ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">ChatGPT Account Linked</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-normal">
                                {acc.chatgpt?.password && (
                                  <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800">
                                    <span className="text-[9px] text-slate-500 font-sans">GPT PW:</span>
                                    <span className="font-mono">{acc.chatgpt.password}</span>
                                    <button onClick={() => copyText(acc.chatgpt.password)} className="text-slate-500 hover:text-slate-300 flex" title="Copy GPT Password">
                                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                    </button>
                                  </div>
                                )}
                                {acc.chatgpt?.otp_secret && (
                                  <div className="flex items-center gap-1 bg-slate-950/40 px-1.5 py-0.5 rounded border border-slate-800">
                                    <span className="text-[9px] text-slate-500 font-sans">GPT 2FA:</span>
                                    <TwoFactorCell secret={acc.chatgpt.otp_secret} />
                                    <button onClick={() => copyText(acc.chatgpt.otp_secret)} className="text-slate-500 hover:text-slate-300 flex" title="Copy GPT 2FA Secret">
                                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500/60"></span>
                              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">No ChatGPT Account</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {acc.status === "reserved" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Reserved
                        </span>
                      ) : acc.status === "error" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                          Auth Error
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Available
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center font-mono text-slate-300">
                      {acc.usage_count}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {formatDate(acc.last_used_at)}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {formatDate(acc.created_at)}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => viewOtp(acc.email)}
                        className="bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900 border border-indigo-500/30 px-3 py-1.5 rounded-lg transition-colors text-xs"
                      >
                        OTP / TOTP
                      </button>
                      <button
                        onClick={() => viewInbox(acc.email)}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-slate-700 text-xs"
                      >
                        Inbox
                      </button>
                      <button
                        onClick={() => openEditModal(acc)}
                        className="bg-slate-800 hover:bg-slate-750 text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-slate-700 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(acc.id)}
                        className="bg-slate-800 hover:bg-red-950/60 hover:text-red-300 text-slate-400 px-3 py-1.5 rounded-lg transition-colors border border-slate-700 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BULK IMPORT MODAL */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-100">Bulk Import Accounts</h2>
              <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleBulkImport} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Account List (one per line)
                </label>
                <textarea
                  required
                  placeholder="email@hotmail.com|password|refresh_token|client_id&#10;email2@hotmail.com|password|refresh_token|client_id|totp_secret"
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors h-48 font-mono text-xs"
                />
                <p className="text-[10px] text-slate-500 mt-2">
                  Format: <code>email|password|refresh_token|client_id[|totp_secret]</code> or <code>email|password</code>
                </p>
              </div>
              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 font-medium px-4 py-2 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 rounded-xl transition-colors shadow-lg hover:shadow-indigo-500/10"
                >
                  Import Accounts
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-100">Edit Account Settings</h2>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
                  <input
                    type="text"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">TOTP Secret</label>
                  <input
                    type="text"
                    value={totpSecretInput}
                    onChange={(e) => setTotpSecretInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              
              {/* ChatGPT credentials section inside Edit Modal */}
              <div className="border-t border-slate-800/80 pt-4 mt-2">
                <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Linked ChatGPT Credentials
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">ChatGPT Password</label>
                    <input
                      type="text"
                      value={chatgptPasswordInput}
                      onChange={(e) => setChatgptPasswordInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors font-mono"
                      placeholder="No ChatGPT password"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">ChatGPT 2FA Secret</label>
                    <input
                      type="text"
                      value={chatgptOtpSecretInput}
                      onChange={(e) => setChatgptOtpSecretInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors font-mono"
                      placeholder="No ChatGPT 2FA secret"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">MS Client ID</label>
                  <input
                    type="text"
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</label>
                  <select
                    value={statusInput}
                    onChange={(e) => setStatusInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  >
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="error">Auth Error</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">MS Refresh Token</label>
                <textarea
                  value={refreshTokenInput}
                  onChange={(e) => setRefreshTokenInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors h-16 font-mono text-[10px]"
                />
              </div>
              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 font-medium px-4 py-2 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 rounded-xl transition-colors"
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INBOX MODAL */}
      {showInboxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Mailbox Inbox</h2>
                <p className="text-xs text-slate-400 mt-0.5">{selectedEmail}</p>
              </div>
              <button onClick={() => setShowInboxModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
              {emailsLoading ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                </div>
              ) : emails.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">No recent emails found (or MS Graph credentials incorrect).</div>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {emails.map((msg, i) => (
                    <div key={i} className="py-4 space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-indigo-400">From: {msg.from?.emailAddress?.name || msg.from?.emailAddress?.address}</span>
                        <span className="text-slate-500">{formatDate(msg.receivedDateTime)}</span>
                      </div>
                      <h3 className="font-bold text-slate-200 text-sm">{msg.subject}</h3>
                      <p className="text-slate-400 text-xs line-clamp-2">{msg.bodyPreview}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowInboxModal(false)}
                className="bg-indigo-650 hover:bg-indigo-750 text-white font-medium px-5 py-2 rounded-xl transition-colors"
              >
                Close Inbox
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP MODAL */}
      {showOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Get OTP Code</h2>
                <p className="text-xs text-slate-400 mt-0.5">{selectedEmail}</p>
              </div>
              <button onClick={() => setShowOtpModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 text-center">
              {otpLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                  <span className="text-slate-500 text-xs">Accessing mailbox & extracting code...</span>
                </div>
              ) : otpInfo ? (
                <div className="space-y-6">
                  {otpInfo.otp ? (
                    <div className="space-y-4">
                      <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                        Latest Code Found ({otpInfo.source})
                      </div>
                      <div className="flex justify-center items-center gap-3">
                        <div className="text-4xl font-extrabold font-mono text-indigo-400 bg-slate-950 px-6 py-3 rounded-2xl border border-indigo-500/20 select-all tracking-wider shadow-lg">
                          {otpInfo.otp}
                        </div>
                        <button
                          onClick={() => copyText(otpInfo.otp)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl transition-all shadow-md hover:shadow-indigo-500/10 flex items-center"
                        >
                          <span className="material-symbols-outlined">{copiedText ? "check" : "content_copy"}</span>
                        </button>
                      </div>
                      {otpInfo.subject && (
                        <div className="text-xs text-slate-500 bg-slate-950/40 p-3 rounded-xl border border-slate-850 text-left">
                          <span className="font-semibold text-slate-400 block mb-0.5">Email Subject:</span>
                          {otpInfo.subject}
                        </div>
                      )}
                      {otpInfo.received && (
                        <div className="text-[10px] text-slate-500">
                          Received: {formatDate(otpInfo.received)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-6 text-slate-400 text-sm">
                      <span className="material-symbols-outlined text-slate-600 text-4xl block mb-2">search_off</span>
                      No validation code/OTP pattern found in the 5 latest messages.
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6 text-red-400 text-sm">Failed to retrieve code.</div>
              )}
            </div>
            <div className="p-6 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowOtpModal(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-5 py-2 rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

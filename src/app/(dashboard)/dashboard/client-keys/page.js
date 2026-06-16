"use client";

import { useState, useEffect } from "react";

export default function ClientKeysPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  
  // Selected Key & logs
  const [selectedKey, setSelectedKey] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  
  // Form states
  const [label, setLabel] = useState("");
  const [quotaTokens, setQuotaTokens] = useState(1000000); // 1M tokens default
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [rateLimit, setRateLimit] = useState(60);
  const [expiresAt, setExpiresAt] = useState("");
  const [ownerNote, setOwnerNote] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Copy indicator
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/client-keys");
      const data = await res.json();
      if (res.ok) {
        setKeys(data);
      } else {
        setError(data.error || "Failed to fetch client keys");
      }
    } catch (err) {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/client-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          owner_note: ownerNote,
          quota_tokens: quotaTokens,
          max_concurrent: maxConcurrent,
          rate_limit_per_minute: rateLimit,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        resetForm();
        fetchKeys();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to create client key");
      }
    } catch (err) {
      alert("Failed to connect to backend");
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!selectedKey) return;
    try {
      const res = await fetch(`/api/client-keys/${selectedKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          owner_note: ownerNote,
          quota_tokens: quotaTokens,
          max_concurrent: maxConcurrent,
          rate_limit_per_minute: rateLimit,
          active: isActive,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      if (res.ok) {
        setShowEditModal(false);
        setSelectedKey(null);
        resetForm();
        fetchKeys();
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to update client key");
      }
    } catch (err) {
      alert("Failed to connect to backend");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this client key?")) return;
    try {
      const res = await fetch(`/api/client-keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchKeys();
      } else {
        alert("Failed to delete client key");
      }
    } catch (err) {
      alert("Failed to connect to backend");
    }
  };

  const fetchLogs = async (key) => {
    setSelectedKey(key);
    setShowLogModal(true);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/client-keys/${key.id}/usage`);
      const data = await res.json();
      if (res.ok) {
        setLogs(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLogsLoading(false);
    }
  };

  const openEditModal = (key) => {
    setSelectedKey(key);
    setLabel(key.label);
    setQuotaTokens(key.quota_tokens);
    setMaxConcurrent(key.max_concurrent);
    setRateLimit(key.rate_limit_per_minute);
    setOwnerNote(key.owner_note || "");
    setIsActive(key.active);
    setExpiresAt(key.expires_at ? new Date(key.expires_at).toISOString().split("T")[0] : "");
    setShowEditModal(true);
  };

  const resetForm = () => {
    setLabel("");
    setQuotaTokens(1000000);
    setMaxConcurrent(5);
    setRateLimit(60);
    setExpiresAt("");
    setOwnerNote("");
    setIsActive(true);
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleString();
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-slate-100 min-h-screen">
      <div className="flex justify-between items-center bg-slate-900/60 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl shadow-xl">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">Client Resale Keys</h1>
          <p className="text-slate-400 mt-1">Manage and distribute custom key access for ChatGPT and Antigravity (Gemini) APIs.</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreateModal(true); }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20 flex items-center gap-2"
        >
          <span className="material-symbols-outlined">add</span> Create Key
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
      ) : keys.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl">
          <span className="material-symbols-outlined text-slate-600 text-6xl">vpn_key</span>
          <p className="text-slate-400 mt-4">No client keys found. Create one to get started!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-left">
                <thead className="bg-slate-950/40 text-slate-400 uppercase text-xs font-semibold tracking-wider">
                  <tr>
                    <th className="px-6 py-4">Label</th>
                    <th className="px-6 py-4">Client API Key</th>
                    <th className="px-6 py-4">Usage (Tokens)</th>
                    <th className="px-6 py-4 text-center">Concurrency</th>
                    <th className="px-6 py-4 text-center">Rate Limit</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Expires</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {keys.map((key) => {
                    const quotaStr = key.quota_tokens > 0 ? (key.quota_tokens / 1000).toLocaleString() + "k" : "∞";
                    const usedStr = (key.used_tokens / 1000).toLocaleString() + "k";
                    const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
                    
                    return (
                      <tr key={key.id} className="hover:bg-slate-800/30 transition-all">
                        <td className="px-6 py-4 font-medium text-slate-200">
                          <div>
                            <div>{key.label}</div>
                            {key.owner_note && <div className="text-xs text-slate-500 font-normal mt-0.5">{key.owner_note}</div>}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 font-mono bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800/80 w-fit">
                            <span className="text-indigo-300">{key.key.slice(0, 10)}...{key.key.slice(-8)}</span>
                            <button
                              onClick={() => copyToClipboard(key.key, key.id)}
                              className="text-slate-500 hover:text-slate-300 transition-colors"
                              title="Copy Full Key"
                            >
                              <span className="material-symbols-outlined text-sm">
                                {copiedId === key.id ? "check" : "content_copy"}
                              </span>
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <span className="font-semibold text-slate-200">{usedStr}</span>
                            <span className="text-slate-500"> / {quotaStr}</span>
                          </div>
                          {key.quota_tokens > 0 && (
                            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                              <div
                                className="bg-indigo-500 h-1.5 rounded-full"
                                style={{ width: `${Math.min(100, (key.used_tokens / key.quota_tokens) * 100)}%` }}
                              ></div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center text-slate-300 font-medium">
                          {key.max_concurrent}
                        </td>
                        <td className="px-6 py-4 text-center text-slate-300 font-medium">
                          {key.rate_limit_per_minute}/m
                        </td>
                        <td className="px-6 py-4">
                          {!key.active ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-400"></span> Inactive
                            </span>
                          ) : isExpired ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span> Expired
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Active
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-400">
                          {key.expires_at ? formatDate(key.expires_at) : "Never"}
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button
                            onClick={() => fetchLogs(key)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-slate-700/80 inline-flex items-center gap-1 text-xs"
                            title="Usage Logs"
                          >
                            <span className="material-symbols-outlined text-sm">history</span> Log
                          </button>
                          <button
                            onClick={() => openEditModal(key)}
                            className="bg-slate-800 hover:bg-indigo-900/60 hover:text-indigo-200 text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-slate-700/80 inline-flex items-center gap-1 text-xs"
                            title="Edit settings"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span> Edit
                          </button>
                          <button
                            onClick={() => handleDelete(key.id)}
                            className="bg-slate-800 hover:bg-red-950/60 hover:text-red-200 text-slate-400 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors border border-slate-700/80 inline-flex items-center gap-1 text-xs"
                            title="Delete Key"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span> Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-100">Create Client Key</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Key Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Reseller Key A"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Quota Limit (Tokens)</label>
                  <input
                    type="number"
                    required
                    value={quotaTokens}
                    onChange={(e) => setQuotaTokens(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Max Concurrency</label>
                  <input
                    type="number"
                    required
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Requests / Minute</label>
                  <input
                    type="number"
                    required
                    value={rateLimit}
                    onChange={(e) => setRateLimit(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Expiration Date</label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</label>
                <textarea
                  placeholder="Optional note about the user or purchase..."
                  value={ownerNote}
                  onChange={(e) => setOwnerNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors h-20 resize-none"
                />
              </div>
              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 font-medium px-4 py-2 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 rounded-xl transition-colors shadow-lg hover:shadow-indigo-500/10"
                >
                  Generate Key
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
              <h2 className="text-xl font-bold text-slate-100">Edit Client Key</h2>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Key Label</label>
                <input
                  type="text"
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Quota Limit (Tokens)</label>
                  <input
                    type="number"
                    required
                    value={quotaTokens}
                    onChange={(e) => setQuotaTokens(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Max Concurrency</label>
                  <input
                    type="number"
                    required
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Requests / Minute</label>
                  <input
                    type="number"
                    required
                    value={rateLimit}
                    onChange={(e) => setRateLimit(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Expiration Date</label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</label>
                <textarea
                  value={ownerNote}
                  onChange={(e) => setOwnerNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none transition-colors h-20 resize-none"
                />
              </div>
              <div className="flex items-center gap-3 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/80">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-800 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-slate-300 select-none">
                  Key Active (Allows requests)
                </label>
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
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 rounded-xl transition-colors shadow-lg hover:shadow-indigo-500/10"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LOG MODAL */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Usage Logs</h2>
                <p className="text-xs text-slate-400 mt-0.5">Key: {selectedKey?.label}</p>
              </div>
              <button onClick={() => setShowLogModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
              {logsLoading ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">No usage logs available for this key.</div>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {logs.map((log) => (
                    <div key={log.id} className="py-3 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-semibold text-slate-200 text-sm">{log.model}</div>
                        <div className="text-slate-500 mt-0.5">{formatDate(log.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-slate-300 text-sm">{(log.billed_tokens).toLocaleString()} tokens</div>
                        <div className="text-slate-500 text-[10px] mt-0.5">
                          In: {log.prompt_tokens.toLocaleString()} | Out: {log.completion_tokens.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="bg-indigo-650 hover:bg-indigo-750 text-white font-medium px-5 py-2 rounded-xl transition-colors"
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

"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, ConfirmModal, Input, Modal } from "@/shared/components";
import ClientModelPolicyField, {
  detectPreset,
  extractRulesFromRaw,
  formatAllowlistForEditor,
  parseAllowlistInput,
  PRESET_OPTIONS,
} from "./components/ClientModelPolicyField";
import GlobalPayloadLimitCard from "./components/GlobalPayloadLimitCard";

const EMPTY_FORM = {
  label: "",
  quota_tokens: 1000000,
  max_concurrent: 15,
  rate_limit_per_minute: 1024,
  expires_at: "",
  owner_note: "",
  model_allowlist: "",
  active: true,
};

const number = new Intl.NumberFormat("vi-VN");
const compact = new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat("vi-VN");
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
const formatDate = (date, format = shortDate) => date && Number.isFinite(Date.parse(date))
  ? format.format(new Date(date))
  : "Không thời hạn";

function keyStatus(key) {
  if (!key.active) return { text: "Tạm dừng", variant: "default" };
  if (key.expires_at && Date.parse(key.expires_at) < Date.now()) return { text: "Hết hạn", variant: "warning" };
  return { text: "Hoạt động", variant: "success" };
}

export default function ClientKeysPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteKey, setDeleteKey] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState(null);

  async function fetchKeys(signal) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/client-keys", { signal, cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải danh sách key.");
      setKeys(data);
    } catch (err) {
      if (!signal?.aborted) setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetchKeys(controller.signal);
    return () => controller.abort();
  }, []);

  function openEditor(key = null) {
    const originalDate = key?.expires_at && Number.isFinite(Date.parse(key.expires_at))
      ? new Date(key.expires_at).toISOString().slice(0, 10)
      : "";
    setEditor({ key, originalDate });
    setFormError("");
    setForm(key ? {
      label: key.label || "",
      quota_tokens: key.quota_tokens ?? 0,
      max_concurrent: key.max_concurrent ?? 15,
      rate_limit_per_minute: key.rate_limit_per_minute ?? 1024,
      expires_at: originalDate,
      owner_note: key.owner_note || "",
      model_allowlist: formatAllowlistForEditor(key.model_allowlist),
      active: !!key.active,
    } : EMPTY_FORM);
  }

  function setField(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function saveKey(event) {
    event.preventDefault();
    if (saving) return;
    const key = editor?.key;
    setFormError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        label: form.label.trim(),
        quota_tokens: Number(form.quota_tokens),
        max_concurrent: Number(form.max_concurrent),
        rate_limit_per_minute: Number(form.rate_limit_per_minute),
        expires_at: key && form.expires_at === editor.originalDate
          ? key.expires_at
          : form.expires_at ? new Date(form.expires_at).toISOString() : null,
        model_allowlist: parseAllowlistInput(form.model_allowlist),
      };
      if (!payload.label) throw new Error("Vui lòng nhập tên key.");
      const res = await fetch(key ? `/api/client-keys/${key.id}` : "/api/client-keys", {
        method: key ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Không thể lưu key.");
      setEditor(null);
      await fetchKeys();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    if (!deleteKey || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/client-keys/${deleteKey.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Không thể xóa key.");
      await fetchKeys();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleteKey(null);
      setDeleting(false);
    }
  }

  async function copyKey(key) {
    try {
      await navigator.clipboard.writeText(key.key);
      setCopiedId(key.id);
      setTimeout(() => setCopiedId((current) => current === key.id ? null : current), 2000);
    } catch {
      setError("Trình duyệt không thể chép key. Vui lòng thử lại.");
    }
  }

  async function fetchLogs(key) {
    setHistory({ key, pending: true });
    try {
      const res = await fetch(`/api/client-keys/${key.id}/usage`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải lịch sử sử dụng.");
      setHistory((current) => current?.key === key ? { key, logs: data } : current);
    } catch (err) {
      setHistory((current) => current?.key === key ? { key, error: err.message } : current);
    }
  }

  const search = query.trim().toLocaleLowerCase();
  const visibleKeys = keys.filter((key) => {
    const fields = [key.label, key.owner_note, key.key?.slice(-8)];
    return fields.some((value) => value?.toLocaleLowerCase().includes(search));
  });

  return (
    <div className="mx-auto w-full max-w-[1440px] min-w-0 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Client Keys</h1>
          <p className="mt-1 text-sm text-text-muted">Cấp key, theo dõi hạn mức và tải bộ cài cho khách hàng.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/check" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-text-muted hover:bg-surface-2 hover:text-text-main">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">open_in_new</span> Cổng khách
          </a>
          <a href="/api/client-keys/download-tool" download="AiNoName-Client.zip" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border bg-surface-2 px-3 text-sm font-semibold hover:bg-surface-3">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span> Bộ cài chung
          </a>
          <Button type="button" icon="add" onClick={() => openEditor()}>Tạo key</Button>
        </div>
      </header>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">Danh sách key <Badge>{keys.length}</Badge></h2>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Input icon="search" aria-label="Tìm Client Key" placeholder="Tên, ghi chú hoặc đuôi key" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 sm:w-64" />
            <Button type="button" variant="secondary" icon="refresh" onClick={() => fetchKeys()} disabled={loading} aria-label="Làm mới" title="Làm mới" className="px-2.5" />
          </div>
        </div>

        {error && <p role="alert" className="border-b border-border-subtle px-4 py-3 text-sm text-red-500">{error}</p>}
        {loading && <p role="status" className="px-4 py-8 text-center text-sm text-text-muted">Đang tải danh sách key…</p>}
        {!loading && visibleKeys.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-text-muted">
            {search ? "Không tìm thấy key phù hợp." : "Chưa có Client Key. Bấm Tạo key để cấp quyền cho khách."}
          </p>
        )}
        {!loading && visibleKeys.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {visibleKeys.map((key) => {
              const status = keyStatus(key);
              const preset = detectPreset(key.model_allowlist);
              const policy = PRESET_OPTIONS.find((option) => option.id === preset);
              const rules = preset === "custom" ? extractRulesFromRaw(key.model_allowlist) : [];
              const used = key.used_tokens || 0;
              const quota = key.quota_tokens || 0;
              const percent = quota > 0 ? Math.min(100, used / quota * 100) : 0;
              const cleanLabel = (key.label || "client").replace(/[^a-zA-Z0-9_-]/g, "_");
              const download = `/api/client-keys/download-tool?key=${encodeURIComponent(key.key)}&label=${encodeURIComponent(cleanLabel)}`;
              return (
                <li key={key.id} className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 break-words text-sm font-semibold">{key.label || "Chưa đặt tên"}</h3>
                      <Badge variant={status.variant} size="sm" dot>{status.text}</Badge>
                    </div>
                    {key.owner_note && <p title={key.owner_note} className="mt-1 truncate text-xs text-text-muted">{key.owner_note}</p>}
                    <div className="mt-1 flex min-w-0 items-center gap-1">
                      <code className="truncate rounded bg-surface-2 px-2 py-1 text-xs text-text-muted">{key.key.slice(0, 9)}…{key.key.slice(-6)}</code>
                      <Button type="button" size="sm" variant="ghost" icon={copiedId === key.id ? "check" : "content_copy"} onClick={() => copyKey(key)} aria-label={copiedId === key.id ? "Đã chép key" : "Chép key"} title="Chép key" className="shrink-0 px-2" />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs text-text-muted">Token đã dùng / Hạn mức</p>
                    <p className="mt-1 text-sm tabular-nums" title={`${number.format(used)} / ${quota ? number.format(quota) : "Không giới hạn"} token`}>
                      <strong>{compact.format(used)}</strong><span className="text-text-muted"> / {quota ? compact.format(quota) : "Không giới hạn"}</span>
                    </p>
                    {quota > 0 && <progress max={100} value={percent} aria-label="Tỷ lệ sử dụng token" className="mt-2 block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-3 [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand-500 [&::-moz-progress-bar]:bg-brand-500" />}
                  </div>

                  <div className="min-w-0 space-y-1 text-xs text-text-muted">
                    <div title={rules.join(", ")}><Badge size="sm" variant={preset === "all" ? "default" : "primary"}>{preset === "all" ? "Tất cả model" : preset === "custom" ? `${rules.length} quyền tùy chỉnh` : policy?.badge}</Badge></div>
                    <p>{number.format(key.max_concurrent)} đồng thời · {number.format(key.rate_limit_per_minute)}/phút</p>
                    <p>{key.expires_at ? `Hết hạn ${formatDate(key.expires_at)}` : "Không thời hạn"}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                    <a href={download} download={`AiNoName-Client-${cleanLabel}.zip`} className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-border bg-surface-2 px-2 text-xs font-semibold hover:bg-surface-3" title="Tải bộ cài đã gắn sẵn key">
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span> Tải bộ cài
                    </a>
                    <Button type="button" size="sm" variant="ghost" icon="history" onClick={() => fetchLogs(key)} aria-label="Lịch sử sử dụng" title="Lịch sử sử dụng" className="px-2" />
                    <Button type="button" size="sm" variant="ghost" icon="edit" onClick={() => openEditor(key)} aria-label="Sửa key" title="Sửa key" className="px-2" />
                    <Button type="button" size="sm" variant="ghost" icon="delete" onClick={() => setDeleteKey(key)} aria-label="Xóa key" title="Xóa key" className="px-2 hover:text-red-500" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <GlobalPayloadLimitCard />

      {editor && (
        <Modal isOpen onClose={() => { if (!saving) setEditor(null); }} title={editor.key ? "Sửa Client Key" : "Tạo Client Key"} size="xl">
          <form onSubmit={saveKey} className="space-y-4">
            <Input id="client-key-label" label="Tên key" placeholder="Tên khách hoặc gói sử dụng" value={form.label} onChange={(event) => setField("label", event.target.value)} required />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input id="client-key-quota" label="Hạn mức token" hint="0 = không giới hạn" type="number" min="0" value={form.quota_tokens} onChange={(event) => setField("quota_tokens", event.target.value)} required />
              <Input id="client-key-concurrency" label="Request đồng thời" type="number" min="0" value={form.max_concurrent} onChange={(event) => setField("max_concurrent", event.target.value)} required />
              <Input id="client-key-rate" label="Request mỗi phút" type="number" min="0" value={form.rate_limit_per_minute} onChange={(event) => setField("rate_limit_per_minute", event.target.value)} required />
              <Input id="client-key-expires" label="Ngày hết hạn" type="date" hint="Để trống nếu không có ngày hết hạn" value={form.expires_at} onChange={(event) => setField("expires_at", event.target.value)} />
            </div>
            <ClientModelPolicyField value={form.model_allowlist} onChange={(value) => setField("model_allowlist", value)} />
            <div className="space-y-1.5">
              <label htmlFor="client-key-note" className="block text-sm font-medium">Ghi chú</label>
              <textarea id="client-key-note" rows={2} value={form.owner_note} onChange={(event) => setField("owner_note", event.target.value)} className="w-full rounded-[10px] border border-border-subtle bg-surface-2 px-3 py-2 text-sm focus:border-brand-500/50 focus:outline-none" />
            </div>
            {editor.key && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(event) => setField("active", event.target.checked)} className="accent-brand-500" />
                Cho phép key gửi request
              </label>
            )}
            {formError && <p role="alert" className="text-sm text-red-500">{formError}</p>}
            <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditor(null)}>Hủy</Button>
              <Button type="submit" loading={saving}>{editor.key ? "Lưu thay đổi" : "Tạo key"}</Button>
            </div>
          </form>
        </Modal>
      )}

      {history && (
        <Modal isOpen onClose={() => setHistory(null)} title={`Lịch sử sử dụng · ${history.key.label || "Client Key"}`} size="xl">
          {history.pending && <p role="status" className="text-sm text-text-muted">Đang tải lịch sử…</p>}
          {history.error && <p role="alert" className="text-sm text-red-500">{history.error}</p>}
          {history.logs?.length === 0 && <p className="text-sm text-text-muted">Key này chưa có lịch sử sử dụng.</p>}
          {history.logs && (
            <ul className="divide-y divide-border-subtle">
              {history.logs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0"><p className="break-all font-medium">{log.model}</p><p className="text-xs text-text-muted">{formatDate(log.created_at, dateTime)}</p></div>
                  <div className="tabular-nums"><p className="font-medium">{number.format(log.billed_tokens ?? 0)} token</p><p className="text-xs text-text-muted">Vào {number.format(log.prompt_tokens ?? 0)} · Ra {number.format(log.completion_tokens ?? 0)}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {deleteKey && (
        <ConfirmModal isOpen onClose={() => { if (!deleting) setDeleteKey(null); }} onConfirm={removeKey} title="Xóa Client Key" message={`Xóa key “${deleteKey.label || "Chưa đặt tên"}” và lịch sử sử dụng của key?`} confirmText="Xóa key" cancelText="Hủy" variant="danger" loading={deleting} />
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useId } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";

const MIN_MIB = 1;
const MAX_MIB = 32;
const BYTES_PER_MIB = 1048576; // 1024 * 1024
const MIN_BYTES = MIN_MIB * BYTES_PER_MIB;
const MAX_BYTES = MAX_MIB * BYTES_PER_MIB;
const VALID_SOURCES = new Set(["saved", "env", "default"]);

export function isValidServerMetadata(meta) {
  if (!meta || typeof meta !== "object") return false;
  const bytes = meta.effectiveBytes;
  const source = meta.source;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes)) return false;
  if (bytes < MIN_BYTES || bytes > MAX_BYTES) return false;
  if (!VALID_SOURCES.has(source)) return false;
  return true;
}

export function formatMiBTruthful(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "---";
  const mib = bytes / BYTES_PER_MIB;
  if (Number.isInteger(mib)) {
    return `${mib} MiB`;
  }
  return `${mib} MiB`;
}

export function getEditorSeedFromBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < MIN_BYTES || bytes > MAX_BYTES) {
    return { inputMiB: "", isFractional: false };
  }
  if (bytes % BYTES_PER_MIB === 0) {
    return { inputMiB: String(bytes / BYTES_PER_MIB), isFractional: false };
  }
  return { inputMiB: "", isFractional: true };
}

export default function GlobalPayloadLimitCard() {
  const inputId = useId();
  const isBusyRef = useRef(false);

  // Initial unknown and loading state (no fake current 8 before GET completes or on failure)
  const [inputMiB, setInputMiB] = useState("");
  const [effectiveBytes, setEffectiveBytes] = useState(null);
  const [effectiveSource, setEffectiveSource] = useState(null);
  const [isFractional, setIsFractional] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    let ignore = false;
    async function fetchPayloadLimitSettings() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (ignore) return;

        if (!isValidServerMetadata(data?.payloadLimit)) {
          throw new Error("Phản hồi cấu hình máy chủ thiếu metadata hợp lệ");
        }

        const effective = data.payloadLimit.effectiveBytes;
        const source = data.payloadLimit.source;
        const saved = data.chatCompletionsMaxBodyBytes ?? null;

        setEffectiveBytes(effective);
        setEffectiveSource(source);

        const targetBytes = (saved !== null && typeof saved === "number" && Number.isSafeInteger(saved))
          ? saved
          : effective;
        const seed = getEditorSeedFromBytes(targetBytes);
        setInputMiB(seed.inputMiB);
        setIsFractional(seed.isFractional);
      } catch (err) {
        if (!ignore) {
          setError("Không thể tải cấu hình giới hạn payload: " + (err?.message || err));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchPayloadLimitSettings();
    return () => {
      ignore = true;
    };
  }, []);

  const handleSave = async (e) => {
    e?.preventDefault();

    // Synchronous busy guard before any await to prevent duplicate save clicks
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    setError(null);
    setSuccess(null);

    // Untouched blank Save: strictly reject before any PATCH request
    const trimmed = String(inputMiB ?? "").trim();
    if (!trimmed) {
      setError(`Vui lòng nhập số nguyên MiB từ ${MIN_MIB} đến ${MAX_MIB} để lưu.`);
      isBusyRef.current = false;
      return;
    }

    // Strict whole MiB number 1..32: strictly reject 8.5, 8e1, junk, blank
    if (!/^\d+$/.test(trimmed)) {
      setError(`Giới hạn payload phải là số nguyên từ ${MIN_MIB} đến ${MAX_MIB} MiB.`);
      isBusyRef.current = false;
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < MIN_MIB || parsed > MAX_MIB) {
      setError(`Giới hạn payload phải là số nguyên từ ${MIN_MIB} đến ${MAX_MIB} MiB.`);
      isBusyRef.current = false;
      return;
    }

    setSaving(true);
    try {
      const bytesToSave = parsed * BYTES_PER_MIB;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatCompletionsMaxBodyBytes: bytesToSave }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Error retains previous effective values
        setError(data.error || "Không thể lưu giới hạn payload.");
        return;
      }

      // Require valid server metadata: valid byte integer 1..32 MiB and source enum
      if (!isValidServerMetadata(data?.payloadLimit)) {
        setError("Máy chủ không trả về metadata payloadLimit hợp lệ; đã giữ nguyên cấu hình hiện tại.");
        return;
      }

      // Success based on server return, not input
      const serverEffective = data.payloadLimit.effectiveBytes;
      const serverSource = data.payloadLimit.source;
      const serverSaved = data.chatCompletionsMaxBodyBytes ?? null;
      setEffectiveBytes(serverEffective);
      setEffectiveSource(serverSource);

      const targetBytes = (serverSaved !== null && typeof serverSaved === "number" && Number.isSafeInteger(serverSaved))
        ? serverSaved
        : serverEffective;
      const seed = getEditorSeedFromBytes(targetBytes);
      setInputMiB(seed.inputMiB);
      setIsFractional(seed.isFractional);
      setSuccess(`Đã lưu giới hạn request thành công: ${formatMiBTruthful(serverEffective)} (${serverEffective.toLocaleString()} bytes).`);
    } catch (err) {
      // Error retains previous effective values
      setError("Lỗi kết nối khi lưu cài đặt: " + (err?.message || err));
    } finally {
      isBusyRef.current = false;
      setSaving(false);
    }
  };

  const handleReset = async () => {
    // Synchronous busy guard before any await
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatCompletionsMaxBodyBytes: null }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Error retains previous effective values
        setError(data.error || "Không thể đặt lại giới hạn payload.");
        return;
      }

      // Require valid server metadata
      if (!isValidServerMetadata(data?.payloadLimit)) {
        setError("Máy chủ không trả về metadata payloadLimit hợp lệ; đã giữ nguyên cấu hình hiện tại.");
        return;
      }

      const serverEffective = data.payloadLimit.effectiveBytes;
      const serverSource = data.payloadLimit.source;
      setEffectiveBytes(serverEffective);
      setEffectiveSource(serverSource);

      const seed = getEditorSeedFromBytes(serverEffective);
      setInputMiB(seed.inputMiB);
      setIsFractional(seed.isFractional);
      setSuccess("Đã xóa tùy chỉnh; hệ thống chuyển sang kế thừa cấu hình môi trường hoặc mặc định.");
    } catch (err) {
      // Error retains previous effective values
      setError("Lỗi kết nối khi đặt lại: " + (err?.message || err));
    } finally {
      isBusyRef.current = false;
      setSaving(false);
    }
  };

  const sourceLabels = {
    saved: "Tùy chỉnh",
    env: "Biến môi trường",
    default: "Mặc định",
  };

  return (
    <Card padding="none">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-text-muted" aria-hidden="true">tune</span>
            <h2 className="text-sm font-semibold">Giới hạn kích thước request</h2>
          </div>
          <div className="flex items-center gap-2">
            {loading ? <Badge>Đang tải</Badge> : effectiveBytes === null ? (
              <Badge variant="error">Không tải được</Badge>
            ) : (
              <Badge>{formatMiBTruthful(effectiveBytes)} · {sourceLabels[effectiveSource]}</Badge>
            )}
            <span className="material-symbols-outlined text-[18px] text-text-muted group-open:rotate-180" aria-hidden="true">expand_more</span>
          </div>
        </summary>
        <div className="space-y-3 border-t border-border-subtle p-4">
          <p className="text-sm text-text-muted">Áp dụng cho <code>/v1/chat/completions</code>. Nhập từ {MIN_MIB} đến {MAX_MIB} MiB.</p>
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          {success && <p role="status" className="text-sm text-green-600 dark:text-green-400">{success}</p>}
          {isFractional && (
            <p className="text-sm text-text-muted">
              Giá trị hiện tại là {formatMiBTruthful(effectiveBytes)}. Chọn một số nguyên MiB để thay thế.
            </p>
          )}
          <form onSubmit={handleSave} className="flex flex-wrap items-end gap-2">
            <Input id={inputId} label="Giới hạn (MiB)" type="number" min={MIN_MIB} max={MAX_MIB} step="1"
              value={inputMiB} onChange={(event) => setInputMiB(event.target.value)}
              disabled={loading || saving} className="w-36" />
            <Button type="submit" icon="save" loading={saving} disabled={loading || !inputMiB.trim()}>Lưu</Button>
            <Button type="button" variant="secondary" icon="restart_alt" onClick={handleReset} disabled={loading || saving}>
              Kế thừa cấu hình
            </Button>
          </form>
        </div>
      </details>
    </Card>
  );
}

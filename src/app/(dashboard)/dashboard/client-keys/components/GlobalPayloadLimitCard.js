"use client";

import { useState, useEffect, useRef, useId } from "react";

const MIN_MIB = 1;
const MAX_MIB = 32;
const DEFAULT_MIB = 8;
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
  const [savedBytes, setSavedBytes] = useState(null);
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
        setSavedBytes(saved);

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
      setSavedBytes(serverSaved);

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
      setSavedBytes(null);

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

  const getSourceBadge = () => {
    if (loading) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-slate-800/60 text-slate-400 border-slate-700/50">
          Đang tải...
        </span>
      );
    }
    switch (effectiveSource) {
      case "saved":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-950/70 text-emerald-300 border-emerald-800/60">
            Tùy chỉnh (Đã lưu)
          </span>
        );
      case "env":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-blue-950/70 text-blue-300 border-blue-800/60">
            Biến môi trường (ENV)
          </span>
        );
      case "default":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-slate-800/80 text-slate-400 border-slate-700/60">
            Mặc định hệ thống (8 MiB)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-950/70 text-amber-300 border-amber-800/60">
            Chưa xác định
          </span>
        );
    }
  };

  return (
    <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-400">tune</span>
            <h2 className="text-xl font-bold text-slate-100">
              Giới hạn request chung (Chat Completions)
            </h2>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Cấu hình kích thước tối đa cho payload request gửi tới /v1/chat/completions (từ {MIN_MIB} đến {MAX_MIB} MiB).
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-slate-400">Nguồn áp dụng:</span>
          {getSourceBadge()}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 text-red-200 p-3 rounded-xl flex items-center gap-3 text-sm">
          <span className="material-symbols-outlined text-red-400 text-base">error</span>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 p-3 rounded-xl flex items-center gap-3 text-sm">
          <span className="material-symbols-outlined text-emerald-400 text-base">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Hiệu lực hiện tại</div>
          <div className="text-lg font-semibold text-slate-100 mt-1 flex items-baseline gap-2">
            {loading ? (
              <span className="text-sm text-slate-400 font-normal">Đang kiểm tra...</span>
            ) : effectiveBytes !== null ? (
              <>
                <span>{formatMiBTruthful(effectiveBytes)}</span>
                <span className="text-xs text-slate-400 font-mono">({effectiveBytes.toLocaleString()} bytes)</span>
              </>
            ) : (
              <span className="text-sm text-slate-400 font-normal">Chưa rõ (Lỗi tải)</span>
            )}
          </div>
          {savedBytes !== null && (
            <div className="text-[11px] text-slate-400 mt-1">
              Giá trị lưu riêng: {formatMiBTruthful(savedBytes)}
            </div>
          )}
        </div>

        <div className="md:col-span-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <label htmlFor={inputId} className="block text-xs font-medium text-slate-400 mb-1">
              Giới hạn mới (MiB)
            </label>
            <div className="relative">
              <input
                id={inputId}
                type="number"
                min={MIN_MIB}
                max={MAX_MIB}
                step="1"
                value={inputMiB}
                onChange={(e) => {
                  setInputMiB(e.target.value);
                }}
                disabled={loading || saving}
                placeholder={String(DEFAULT_MIB)}
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors pr-14 disabled:opacity-50 text-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none">
                MiB
              </span>
            </div>
            {isFractional && (
              <p className="text-xs text-amber-300/90 mt-1.5 flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">info</span>
                <span>
                  Cấu hình hiện tại có kích thước lẻ ({formatMiBTruthful(savedBytes ?? effectiveBytes)}). Vui lòng chọn số nguyên MiB ({MIN_MIB}–{MAX_MIB}) để thay thế.
                </span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-0 sm:pt-5">
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saving || !String(inputMiB ?? "").trim()}
              className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white font-medium px-4 py-2 rounded-xl transition-all shadow-md hover:shadow-indigo-500/20 flex items-center justify-center gap-2 text-sm disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">save</span>
                  <span>Lưu</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={loading || saving}
              title="Đặt lại để kế thừa biến môi trường MAX_REQUEST_BODY_BYTES hoặc mặc định 8 MiB"
              className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/50 text-slate-300 font-medium px-3.5 py-2 rounded-xl transition-all border border-slate-700 flex items-center justify-center gap-1.5 text-sm disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
              <span>Kế thừa / Đặt lại</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useId, useState } from "react";

export const PRESET_OPTIONS = [
  {
    id: "all",
    label: "All Models",
    ruleValue: "",
    badge: "All models",
    badgeClass: "bg-slate-800/80 text-slate-400 border-slate-700/60",
    description: "Không giới hạn model. Cho phép gọi tất cả các model được hỗ trợ trên hệ thống.",
  },
  {
    id: "gemini",
    label: "Gemini Only",
    ruleValue: "family:gemini",
    badge: "Gemini Only",
    badgeClass: "bg-emerald-950/70 text-emerald-300 border-emerald-800/60",
    description: "Chỉ cho phép các model thuộc họ Gemini (gemini-*). Không bao gồm Gemma hoặc Claude qua Antigravity (Gemini excludes Gemma).",
  },
  {
    id: "codex",
    label: "GPT / Codex Only",
    ruleValue: "family:codex",
    badge: "GPT/Codex Only",
    badgeClass: "bg-indigo-950/70 text-indigo-300 border-indigo-800/60",
    description: "Chỉ cho phép các model thuộc nhà cung cấp Codex upstream (codex/*, gpt-5.*, gpt-6.*). Lưu ý: Đây là provider/model upstream, KHÔNG phải ứng dụng client Codex (Codex application != Codex model).",
  },
  {
    id: "claude",
    label: "Claude Only",
    ruleValue: "family:claude",
    badge: "Claude Only",
    badgeClass: "bg-amber-950/70 text-amber-300 border-amber-800/60",
    description: "Chỉ cho phép các model thuộc họ Claude (claude-*).",
  },
  {
    id: "custom",
    label: "Custom Rules",
    ruleValue: null,
    badge: "Custom",
    badgeClass: "bg-purple-950/70 text-purple-300 border-purple-800/60",
    description: "Nhập danh sách quy tắc tùy chỉnh theo định dạng phân tách bởi dấu phẩy.",
  },
];

/**
 * Safely unwrap surrounding quotes from a token without touching valid bracketed suffixes like [1m].
 */
export function cleanRuleToken(item) {
  if (typeof item !== "string") return null;
  let s = item.trim();
  if (!s) return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  } else if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

/**
 * Robust parser to convert raw model_allowlist into a clean list of string rules.
 * - Preserves literal suffixes like [1m] (e.g. cx/gpt-5.6-terra[1m]).
 * - Preserves ALL items in nested JSON arrays without dropping targets.
 * - Does NOT silently repair malformed JSON; keeps raw invalid content to fail closed.
 * - Does NOT silently drop non-string elements; keeps stringified representation.
 */
export function extractRulesFromRaw(raw) {
  if (raw === null || raw === undefined) return [];

  let candidates = [];
  if (Array.isArray(raw)) {
    candidates = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "*" || trimmed === "[]") return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          candidates = parsed;
        } else {
          return [trimmed];
        }
      } catch {
        // Malformed JSON starting with [ -> DO NOT fallback split/strip! Preserve raw string so it fails closed.
        return [trimmed];
      }
    } else {
      candidates = trimmed.split(/[\n,]+/);
    }
  } else {
    return [String(raw)];
  }

  const result = [];
  for (const item of candidates) {
    if (typeof item !== "string") {
      if (item !== null && item !== undefined) {
        result.push(typeof item === "object" ? JSON.stringify(item) : String(item));
      }
      continue;
    }
    const clean = item.trim();
    if (!clean) continue;

    // Check if this string itself is a nested JSON array: e.g. '["family:gemini", "cx/gpt-5.6[1m]"]'
    if (clean.startsWith("[") && clean.endsWith("]")) {
      try {
        const inner = JSON.parse(clean);
        if (Array.isArray(inner)) {
          for (const sub of inner) {
            if (typeof sub !== "string") {
              if (sub !== null && sub !== undefined) {
                result.push(typeof sub === "object" ? JSON.stringify(sub) : String(sub));
              }
              continue;
            }
            const cleanedSub = cleanRuleToken(sub);
            if (cleanedSub && !result.includes(cleanedSub)) {
              result.push(cleanedSub);
            }
          }
          continue;
        }
      } catch {
        // Fall through
      }
    }

    const token = cleanRuleToken(clean);
    if (token && !result.includes(token)) {
      result.push(token);
    }
  }

  return result;
}

/**
 * Converts raw policy input to editor text string (e.g. "family:gemini, codex/gpt-5.6-terra[1m]")
 */
export function formatAllowlistForEditor(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "*" || trimmed === "[]") return "";
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const rules = extractRulesFromRaw(parsed);
          return rules.join(", ");
        }
        return trimmed;
      } catch {
        // Malformed JSON -> preserve raw so admin sees the exact error
        return trimmed;
      }
    }
    return trimmed;
  }
  const rules = extractRulesFromRaw(raw);
  return rules.join(", ");
}

/**
 * Parses user editor text into an array of clean rules for API submission.
 * - Preserves literal suffixes like [1m].
 * - Throws on malformed JSON or non-string inputs so invalid config errors rather than silently repairing or dropping.
 * - Returns null if unrestricted/empty.
 */
export function parseAllowlistInput(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") {
    if (Array.isArray(input)) {
      if (input.length === 0) return null;
      for (const item of input) {
        if (typeof item !== "string" || !item.trim()) {
          throw new Error("All model allowlist rules must be non-empty strings");
        }
      }
      return input;
    }
    throw new Error("model_allowlist must be a string or array");
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed === "*" || trimmed === "[]") return null;

  if (trimmed.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Malformed JSON allowlist: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error("model_allowlist JSON must be an array");
    }
    const rules = [];
    for (const item of parsed) {
      if (typeof item !== "string") {
        throw new Error("All model allowlist rules must be non-empty strings");
      }
      const trimmedItem = item.trim();
      if (!trimmedItem) {
        throw new Error("All model allowlist rules must be non-empty strings");
      }
      // Check if nested JSON string array
      if (trimmedItem.startsWith("[") && trimmedItem.endsWith("]")) {
        try {
          const inner = JSON.parse(trimmedItem);
          if (Array.isArray(inner)) {
            for (const sub of inner) {
              if (typeof sub !== "string" || !sub.trim()) {
                throw new Error("All model allowlist rules must be non-empty strings");
              }
              const cleanedSub = cleanRuleToken(sub);
              if (cleanedSub && !rules.includes(cleanedSub)) rules.push(cleanedSub);
            }
            continue;
          }
        } catch {
          // Fall through
        }
      }
      const cleaned = cleanRuleToken(trimmedItem);
      if (cleaned && !rules.includes(cleaned)) rules.push(cleaned);
    }
    return rules.length > 0 ? rules : null;
  }

  // Comma or newline separated rules
  const tokens = trimmed.split(/[\n,]+/);
  const rules = [];
  for (const token of tokens) {
    const cleaned = cleanRuleToken(token);
    if (cleaned && !rules.includes(cleaned)) {
      rules.push(cleaned);
    }
  }
  return rules.length > 0 ? rules : null;
}

/**
 * Determines which preset matches the given raw value or rules string.
 */
export function detectPreset(raw) {
  if (raw === null || raw === undefined || raw === "") return "all";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "*" || trimmed === "[]") return "all";
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) return "custom";
      } catch {
        return "custom";
      }
    }
  }
  const rules = extractRulesFromRaw(raw);
  if (rules.length === 0) return "all";
  if (rules.length === 1) {
    const r = rules[0].toLowerCase();
    for (const opt of PRESET_OPTIONS) {
      if (opt.id === "all" || opt.id === "custom" || !opt.ruleValue) continue;
      const targetRule = opt.ruleValue.toLowerCase();
      if (r === targetRule || r === targetRule.replace(/^family:/, "")) {
        return opt.id;
      }
    }
  }
  return "custom";
}

export default function ClientModelPolicyField({ value, onChange }) {
  const instanceId = useId();
  
  // Track custom mode explicitly so choosing Custom mode never gets lost
  const initialPreset = detectPreset(value);
  const [selectedPresetId, setSelectedPresetId] = useState(initialPreset);
  const [isCustomMode, setIsCustomMode] = useState(initialPreset === "custom");

  // Synchronize when value changes externally while NOT in custom mode
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isCustomMode) {
      const p = detectPreset(value);
      setSelectedPresetId(p);
      if (p === "custom") {
        setIsCustomMode(true);
      }
    }
  }

  const handlePresetSelect = (presetId) => {
    if (presetId === "custom") {
      setIsCustomMode(true);
      setSelectedPresetId("custom");
      // Keep current value intact - do NOT overwrite value so user can edit whatever was there
      return;
    }

    const option = PRESET_OPTIONS.find((opt) => opt.id === presetId);
    if (!option) return;

    setIsCustomMode(false);
    setSelectedPresetId(presetId);
    onChange(option.ruleValue);
  };

  const handleCustomTextChange = (e) => {
    // When typing in custom mode, stay in custom mode even if typed text matches a preset name
    setIsCustomMode(true);
    setSelectedPresetId("custom");
    onChange(e.target.value);
  };

  const currentRules = extractRulesFromRaw(value);

  return (
    <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
      <div>
        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
          Model Permission Policy
        </label>
        <p className="text-xs text-slate-400">
          Chọn cấu hình mẫu hoặc nhập danh sách quyền truy cập model cho Client Key.
        </p>
      </div>

      {/* Preset Radio Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {PRESET_OPTIONS.map((opt) => {
          const isSelected = selectedPresetId === opt.id;
          const radioInputId = `${instanceId}-preset-${opt.id}`;
          return (
            <label
              key={opt.id}
              htmlFor={radioInputId}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                isSelected
                  ? "bg-indigo-950/50 border-indigo-500 text-indigo-100 shadow-sm shadow-indigo-500/10"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/40 hover:text-slate-300"
              }`}
            >
              <input
                id={radioInputId}
                type="radio"
                name={`model-preset-${instanceId}`}
                value={opt.id}
                checked={isSelected}
                onChange={() => handlePresetSelect(opt.id)}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500 bg-slate-950 border-slate-700"
              />
              <div className="text-left">
                <div className="text-xs font-medium leading-none">{opt.label}</div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Custom Rules Input (Visible whenever Custom preset is active) */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 font-medium">
            Active Rules:{" "}
            <span className="text-slate-200 font-mono">
              {currentRules.length > 0 ? currentRules.join(", ") : "All models allowed (unrestricted)"}
            </span>
          </span>
          {!isCustomMode && (
            <button
              type="button"
              onClick={() => handlePresetSelect("custom")}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
            >
              Edit custom rules
            </button>
          )}
        </div>

        {isCustomMode && (
          <div>
            <textarea
              placeholder="e.g. family:gemini, codex/gpt-5.6-terra[1m], claude-3-7-sonnet"
              value={value || ""}
              onChange={handleCustomTextChange}
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2 text-slate-200 focus:outline-none transition-colors h-16 resize-none font-mono text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Nhập các rule phân cách bằng dấu phẩy. Hỗ trợ prefix `family:gemini`, `family:codex`, `family:claude`, hoặc tên model cụ thể (hỗ trợ suffix [1m]).
            </p>
          </div>
        )}
      </div>

      {/* Policy Security & Usage Routing Guidance - Collapsible by default to keep modal compact */}
      <details className="group bg-slate-900/90 rounded-lg border border-slate-800 text-[11px] text-slate-400 overflow-hidden">
        <summary className="p-3 cursor-pointer select-none flex items-center justify-between font-medium text-slate-300 hover:bg-slate-800/40 transition-colors">
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-indigo-400">shield</span>
            <span>Nguyên tắc kiểm soát quyền truy cập model &amp; ghi nhận Usage</span>
          </span>
          <span className="material-symbols-outlined text-sm text-slate-400 transition-transform duration-200 group-open:rotate-180">
            expand_more
          </span>
        </summary>
        <div className="p-3.5 pt-2 border-t border-slate-800/80 space-y-2">
          <ul className="list-disc list-inside space-y-1.5 pl-1 text-slate-400">
            <li>
              <strong className="text-slate-300">Tên model gửi vs Model thực tế (Combo Routing):</strong> Client có thể gửi tên combo (ví dụ: <code className="text-indigo-300">gpt-5.5</code>). Hệ thống kiểm soát quyền dựa trên model thực tế mà combo định tuyến tới (ví dụ: <code className="text-indigo-300">ag/gemini-3.8-flash-high</code>). Key &quot;Gemini Only&quot; vẫn được phép gọi nếu combo chỉ trỏ tới Gemini, nhưng request gọi trực tiếp tới model GPT thực tế sẽ bị chặn.
            </li>
            <li>
              <strong className="text-slate-300">Ghi nhận Usage theo Model thực tế (Actual Model):</strong> Bảng thống kê và log sử dụng ghi nhận theo model thực tế phục vụ request (từ header <code className="text-indigo-300">x-9r-actual-model</code>), không ghi theo tên combo thô.
            </li>
            <li>
              <strong className="text-slate-300">Quy tắc Fail-Closed trên Fallback:</strong> Nếu combo cấu hình nhiều model dự phòng, TẤT CẢ các fallback targets đều phải được cấp phép trong policy của key. Nếu có dù chỉ một target vi phạm, toàn bộ request sẽ bị từ chối 403 ngay từ preflight gate.
            </li>
            <li>
              <strong className="text-slate-300">Phạm vi Gemini Only (Loại trừ Gemma &amp; Antigravity Claude):</strong> Preset Gemini Only (<code className="text-indigo-300">family:gemini</code>) chỉ cho phép model Gemini (<code className="text-indigo-300">gemini-*</code>). Tuyệt đối KHÔNG cấp quyền cho model Gemma (Gemini excludes Gemma) và không cấp quyền cho Claude qua Antigravity (<code className="text-amber-300">ag/claude-*</code>).
            </li>
            <li>
              <strong className="text-slate-300">Phân biệt Nhà cung cấp Codex vs Ứng dụng Client Codex (Codex application != Codex model):</strong> Preset GPT/Codex (<code className="text-indigo-300">family:codex</code>) kiểm soát quyền gọi tới upstream Codex provider. Ứng dụng client Codex hoàn toàn có thể gọi model Gemini nếu key được cấp quyền Gemini và combo định tuyến tương ứng.
            </li>
            <li>
              <strong className="text-slate-300">Tự động tái kiểm tra:</strong> Khi danh sách fallback của combo thay đổi trong tương lai, hệ thống tự động đối soát lại theo chính sách đã cấp.
            </li>
          </ul>
        </div>
      </details>
    </div>
  );
}

/**
 * ChatgptAdminPanel.jsx
 * Premium admin panel for ChatGPT account management.
 * Based 100% on actual App.jsx logic — no fabrications.
 */

import { useState, useCallback, memo } from "react";
import {
  RefreshCw,
  Upload,
  Loader2,
  Copy,
  Mail,
  User,
  Calendar,
  ExternalLink,
  Trash2,
  Pencil,
  UserPlus,
  ArrowRightLeft,
  Search,
  X,
  ChevronUp,
  RotateCw,
  Shield,
  AlertTriangle,
  Plus,
  Package,
  ShoppingCart,
  Check,
  Filter,
  Layers,
  Database,
} from "lucide-react";

// ─── Pure helper functions (no App.jsx state deps) ───────────────────────────
const normalizeChatgptAccountType = (v) =>
  ["package1", "package2", "unassigned"].includes(String(v || "").trim())
    ? String(v || "").trim()
    : "unassigned";

const normalizePackage2Shelf = (v) => {
  if (v === "cheap") return "cheap";
  if (v === "main") return "main";
  return "none";
};

const normalizeChatgptWarehouseUiValue = (v) =>
  normalizePackage2Shelf(v) === "cheap" ? "cheap" : "none";

const supportsChatgptMarketType = (v) =>
  ["package1", "package2", "unassigned", ""].includes(String(v || "").trim());

const normalizeChatgptMailCheckStatus = (v) => {
  const n = String(v || "").trim().toLowerCase();
  if (n === "died") return "died";
  if (n === "clean") return "clean";
  return "unchecked";
};

const getChatgptMailCheckVisualState = (acc = {}) => {
  const status = normalizeChatgptMailCheckStatus(acc?.mailCheckStatus);
  if (status === "died") return { key: "died", label: "Mail die", tone: "border-red-700/60 bg-red-900/20 text-red-300" };
  if (acc?.mailCheckLastCheckedAt) return { key: "checked", label: "Da check", tone: "border-emerald-700/60 bg-emerald-900/20 text-emerald-300" };
  return { key: "unchecked", label: "Chua check", tone: "border-slate-700 bg-slate-800/80 text-slate-400" };
};

const getExpiryStatus = (iso) => {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso) - new Date()) / 86400000);
  if (days <= 0) return { text: `He${days === 0 ? "t" : " het"} han ${Math.abs(days)}d`, color: "text-red-400", urgent: true };
  if (days <= 7) return { text: `Con ${days}d`, color: "text-red-400", urgent: true };
  if (days <= 15) return { text: `Con ${days}d`, color: "text-amber-400", urgent: false };
  if (days <= 25) return { text: `Con ${days}d`, color: "text-yellow-400", urgent: false };
  return { text: `Con ${days}d`, color: "text-emerald-400", urgent: false };
};

const formatDate = (iso) => {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return "--"; }
};

const formatDateTime = (iso) => {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "--"; }
};

const getVisibleAccountNote = (note) => {
  const raw = String(note || "").trim();
  if (!raw) return "";
  // Strip system notes like [StoreWarrantyHold...] and [Legacy Datammo...]
  return raw
    .split("\n")
    .filter((l) => !/^\[(StoreWarrantyHold|Legacy Datammo customer)\]/i.test(l.trim()))
    .join("\n")
    .trim();
};

const getAccountUserDisplayName = (user) =>
  typeof user === "object" && user !== null
    ? String(user.name || "").trim()
    : String(user || "").trim();

const getVisibleAccountUserEntries = (account = {}) =>
  (Array.isArray(account?.users) ? account.users : []).reduce((acc, user, index) => {
    const name = getAccountUserDisplayName(user);
    if (!name) return acc;
    acc.push({ user, index, name });
    return acc;
  }, []);

const getDaysUsed = (user) => {
  if (!user || typeof user === "string") return null;
  if (!user.joinedAt) return null;
  return Math.floor((Date.now() - new Date(user.joinedAt)) / 86400000);
};

const getDaysRemaining = (user) => {
  if (!user || typeof user === "string") return null;
  if (!user.expiredAt) return null;
  return Math.ceil((new Date(user.expiredAt) - Date.now()) / 86400000);
};

const isDatammoManagedUser = (user) => {
  const name = getAccountUserDisplayName(user).trim().toLowerCase();
  return name.startsWith("datammo#") || name.startsWith("[datammo]") ||
    name.startsWith("shopmini#") || name.startsWith("[shopmini]");
};

// ─── Label helpers ────────────────────────────────────────────────────────────
const typeLabel = (v) => {
  const n = normalizeChatgptAccountType(v);
  if (n === "package1") return { text: "Gói 1", cls: "bg-blue-900/40 text-blue-300 border-blue-700/50" };
  if (n === "package2") return { text: "Gói 2", cls: "bg-violet-900/40 text-violet-300 border-violet-700/50" };
  return { text: "Chưa chọn", cls: "bg-slate-800 text-slate-400 border-slate-700" };
};

const shelfLabel = (v) => {
  const n = normalizeChatgptWarehouseUiValue(v);
  if (n === "cheap") return { text: "Kho market", cls: "bg-emerald-900/40 text-emerald-300 border-emerald-700/60" };
  return { text: "Kho tổng", cls: "bg-slate-800 text-slate-300 border-slate-600" };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Compact badge */
const Badge = memo(({ children, className = "" }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${className}`}>
    {children}
  </span>
));

/** Section pill tab */
const PillTab = memo(({ active, onClick, children, count, color = "bg-slate-600" }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
      active
        ? "bg-white/10 text-white ring-1 ring-white/20 shadow-md"
        : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
    }`}
  >
    {children}
    {count !== undefined && (
      <span className={`rounded-full px-1.5 py-px text-[10px] font-extrabold ${
        active ? `${color} text-white` : "bg-slate-700 text-slate-300"
      }`}>
        {count}
      </span>
    )}
  </button>
));

/** Summary stat card */
const StatCard = memo(({ label, value, sub, accent = "border-slate-700/50 bg-slate-800/60", icon: Icon, iconCls = "text-slate-400" }) => (
  <div className={`flex flex-col gap-1 rounded-2xl border p-3.5 ${accent}`}>
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{label}</span>
      {Icon && <Icon size={14} className={iconCls} />}
    </div>
    <div className="text-2xl font-black text-white tabular-nums">{value ?? "—"}</div>
    {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
  </div>
));

/** Single account card */
const AccountCard = memo(({
  acc,
  isExpanded,
  isSelected,
  isHighlighted,
  isMarket, // gptSubTab === "market"
  isMarketTracked, // marketplaceTrackedAccountIds.has(acc.id)
  loadingStates,
  onToggleSelect,
  onToggleExpand,
  onEdit,
  onDelete,
  onAddUser,
  onEditUser,
  onDeleteUser,
  onMoveUser,
  onExtendUser,
  onMailCheck,
  onCopy,
  onTypeChange,
  onShelfChange,
  getVisibleAccountUserEntries,
  getActiveStoreReservationTraces,
  getActiveStoreReservationCount,
  getStoreWarrantyHoldInfo,
  getStoreOrderIdentityForAccountUser,
  buildChatgpt2faLiveUrl,
  buildChatgptCopyText,
  getChatgptCopyButtonText,
  getChatgptCopySuccessText,
}) => {
  const visibleUsers = getVisibleAccountUserEntries(acc);
  const activeReservations = getActiveStoreReservationTraces(acc);
  const reservationCount = getActiveStoreReservationCount(acc);
  const warrantyHold = getStoreWarrantyHoldInfo(acc);
  const hasReservation = reservationCount > 0;
  const hasWarrantyHold = !!warrantyHold && !hasReservation;
  const isLockedFromSale = hasReservation || hasWarrantyHold;

  const mailState = getChatgptMailCheckVisualState(acc);
  const expiryStatus = acc.expiredAt ? getExpiryStatus(acc.expiredAt) : null;
  const accType = normalizeChatgptAccountType(acc?.effectiveType || acc?.type);
  const tl = typeLabel(accType);
  const sl = shelfLabel(acc?.package2Shelf);
  const isMarketable = supportsChatgptMarketType(acc.type);
  const isDied = normalizeChatgptMailCheckStatus(acc?.mailCheckStatus) === "died";
  const isMailChecking = loadingStates?.runChatgptMailCheckOne === String(acc?.id || "");
  const isTypeChanging = !!loadingStates?.changeType?.[acc.id];
  const isShelfChanging = !!loadingStates?.changeShelf?.[acc.id];
  const note = getVisibleAccountNote(acc.note);
  const hasMarketplaceSold = isMarketTracked;

  // User slot display for Pkg1
  const effectiveViewType = accType === "unassigned"
    ? visibleUsers.length > 1 ? "package1" : visibleUsers.length === 1 ? "package2" : "unassigned"
    : accType;

  return (
    <div
      id={`chatgpt-account-row-${acc.id}`}
      className={`group rounded-2xl border transition-all duration-150 ${
        isHighlighted
          ? "border-cyan-500/50 bg-cyan-900/10 ring-1 ring-cyan-500/30"
          : isExpanded
          ? "border-slate-600/60 bg-slate-800/60"
          : "border-slate-700/50 bg-slate-800/30 hover:border-slate-600/60 hover:bg-slate-800/50"
      }`}
    >
      {/* ── Card header ── */}
      <div className="flex items-start gap-2.5 p-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(acc.id, e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500 rounded"
          title="Chọn tài khoản"
        />

        {/* Main info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Row 1: username + badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-sm font-bold text-white">
              {acc.username}
            </span>
            <button
              onClick={() => onCopy(acc.username, "Đã copy tên tài khoản")}
              className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-200 transition hover:bg-slate-600"
            >
              <Copy size={10} /> Copy
            </button>

            {/* Type badge */}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${tl.cls}`}>
              {tl.text}
            </span>

            {/* Shelf badge (market only) */}
            {isMarket && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                hasMarketplaceSold
                  ? "border-amber-700/60 bg-amber-900/40 text-amber-300"
                  : isLockedFromSale
                  ? "border-cyan-700/60 bg-cyan-900/40 text-cyan-300"
                  : sl.cls
              }`}>
                {hasMarketplaceSold ? "Acc đã bán" : isLockedFromSale ? (hasReservation ? "Đơn web" : "BH web") : sl.text}
              </span>
            )}

            {/* Status badges */}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${mailState.tone}`}>
              {mailState.label}
            </span>
            {expiryStatus && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                expiryStatus.urgent
                  ? "border-red-700/60 bg-red-900/20 text-red-300"
                  : "border-slate-700 bg-slate-800/80 text-slate-300"
              }`}>
                {expiryStatus.text}
              </span>
            )}
            {acc.otpSecret && (
              <Badge className="border-cyan-700/60 bg-cyan-950/20 text-cyan-300">
                <Shield size={9} /> 2FA
              </Badge>
            )}
            {note && (
              <Badge className="border-yellow-700/60 bg-yellow-900/20 text-yellow-300">
                Ghi chú
              </Badge>
            )}
            {hasReservation && (
              <Badge className="border-cyan-600/60 bg-cyan-900/20 text-cyan-200">
                <ShoppingCart size={9} /> Giữ chỗ web
              </Badge>
            )}
            {hasWarrantyHold && (
              <Badge className="border-amber-700/60 bg-amber-900/20 text-amber-200">
                BH web
              </Badge>
            )}
          </div>

          {/* Row 2: user preview */}
          {visibleUsers.length > 0 && !isExpanded && (
            <div className="flex flex-wrap gap-1.5">
              {visibleUsers.slice(0, 2).map((entry) => {
                const remaining = getDaysRemaining(entry.user);
                const isMarketUser = isDatammoManagedUser(entry.user);
                return (
                  <span
                    key={entry.index}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                      isMarketUser
                        ? "border-amber-700/50 bg-amber-900/30 text-amber-200"
                        : "border-slate-700/60 bg-slate-900/50 text-slate-300"
                    }`}
                  >
                    <User size={9} />
                    {entry.name}
                    {remaining !== null && (
                      <span className={remaining <= 0 ? "text-red-400" : remaining <= 7 ? "text-amber-400" : "text-emerald-400"}>
                        ({remaining}d)
                      </span>
                    )}
                  </span>
                );
              })}
              {visibleUsers.length > 2 && (
                <span className="rounded-full border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[10px] text-slate-400">
                  +{visibleUsers.length - 2} khách
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {/* Copy all */}
            <button
              onClick={() => onCopy(buildChatgptCopyText(acc), getChatgptCopySuccessText(acc))}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/80 px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-indigo-500 shadow-sm shadow-indigo-900/30"
              title="Copy thông tin acc"
            >
              <Copy size={11} /> {getChatgptCopyButtonText(acc)}
            </button>

            {/* Expand */}
            <button
              onClick={() => onToggleExpand(acc.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all ${
                isExpanded
                  ? "border-slate-500 bg-slate-700 text-white"
                  : "border-slate-700 bg-slate-800 text-slate-400 hover:text-white"
              }`}
              title={isExpanded ? "Thu gọn" : "Mở rộng"}
            >
              <ChevronUp size={13} className={`transition-transform ${isExpanded ? "rotate-0" : "rotate-180"}`} />
            </button>
          </div>

          {/* Edit / Delete */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(acc)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-blue-700/50 bg-blue-900/30 text-blue-300 transition hover:bg-blue-700/50"
              title="Sửa acc"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => onDelete(acc)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-red-800/50 bg-red-900/20 text-red-400 transition hover:bg-red-800/40"
              title="Xóa acc"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Expanded section ── */}
      {isExpanded && (
        <div className="border-t border-slate-700/50 px-3 pb-3 pt-2.5 space-y-3">
          {/* Credentials */}
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Thông tin đăng nhập</span>
              {acc.expiredAt && (
                <span className={`text-[10px] font-semibold flex items-center gap-1 ${expiryStatus?.color || "text-slate-400"}`}>
                  <Calendar size={10} /> {formatDate(acc.expiredAt)}
                </span>
              )}
            </div>

            {/* Password */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-500">Mật khẩu</span>
              <code className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-white break-all">
                {acc.password}
              </code>
              <button
                onClick={() => onCopy(acc.password, "Đã copy mật khẩu")}
                className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-600"
              >
                <Copy size={10} /> Copy
              </button>
            </div>

            {/* 2FA */}
            {acc.otpSecret && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-500">2FA</span>
                <code className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-cyan-200 break-all">
                  {acc.otpSecret}
                </code>
                <button
                  onClick={() => onCopy(acc.otpSecret, "Đã copy 2FA")}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-600"
                >
                  <Copy size={10} /> Copy
                </button>
                <a
                  href={buildChatgpt2faLiveUrl(acc.otpSecret)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-cyan-700/80 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-cyan-600"
                >
                  <ExternalLink size={10} /> 2fa.live
                </a>
              </div>
            )}

            {/* Link mail */}
            {acc.link && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-500">Link</span>
                <a
                  href={acc.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-teal-700/80 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-teal-600"
                >
                  <Mail size={10} /> Mở mail
                </a>
                <button
                  onClick={() => onCopy(acc.link, "Đã copy link mail")}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-600"
                >
                  <Copy size={10} /> Copy
                </button>
              </div>
            )}

            {/* Note */}
            {note && (
              <div className="rounded-lg border border-yellow-700/30 bg-yellow-900/10 px-2 py-1.5 text-[10px] italic text-yellow-200">
                {note}
              </div>
            )}
          </div>

          {/* Type & Shelf selectors */}
          <div className="flex flex-wrap gap-2">
            {/* Type selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-500">Loại gói:</span>
              <select
                value={normalizeChatgptAccountType(acc?.effectiveType || acc?.type)}
                onChange={(e) => onTypeChange(acc, e.target.value)}
                disabled={isTypeChanging || isLockedFromSale}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold outline-none cursor-pointer appearance-none transition ${
                  isTypeChanging || isLockedFromSale ? "opacity-50 cursor-not-allowed" : ""
                } ${tl.cls}`}
              >
                <option value="unassigned">❓ Chưa chọn</option>
                <option value="package1">👥 Gói 1 – Chia sẻ</option>
                <option value="package2">🔒 Gói 2 – Linh hoạt</option>
              </select>
              {isTypeChanging && <Loader2 size={13} className="animate-spin text-blue-400" />}
            </div>

            {/* Shelf selector (market acc only) */}
            {isMarketable && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-500">Kho:</span>
                {hasMarketplaceSold ? (
                  <span className="rounded-lg border border-amber-700/60 bg-amber-900/30 px-2.5 py-1 text-[10px] font-bold text-amber-200">
                    🔒 Khóa đơn sàn
                  </span>
                ) : isLockedFromSale ? (
                  <span className="rounded-lg border border-cyan-700/60 bg-cyan-900/30 px-2.5 py-1 text-[10px] font-bold text-cyan-200">
                    {hasReservation ? "🔒 Đơn web đang giữ chỗ" : "🔒 Nick lỗi bảo hành"}
                  </span>
                ) : (
                  <select
                    value={normalizeChatgptWarehouseUiValue(acc.package2Shelf)}
                    onChange={(e) => onShelfChange(acc, e.target.value)}
                    disabled={isShelfChanging || visibleUsers.length > 0 || isLockedFromSale}
                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold outline-none cursor-pointer appearance-none transition ${
                      normalizeChatgptWarehouseUiValue(acc.package2Shelf) === "cheap"
                        ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                        : "border-slate-600 bg-slate-800 text-slate-300"
                    } ${isShelfChanging ? "opacity-50" : ""}`}
                  >
                    <option value="none">📦 Kho tổng</option>
                    <option value="cheap">🏪 Kho market</option>
                  </select>
                )}
                {isShelfChanging && <Loader2 size={13} className="animate-spin text-emerald-400" />}
              </div>
            )}
          </div>

          {/* Mail check section */}
          <div className="rounded-xl border border-rose-900/30 bg-rose-950/15 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-300">Mail check</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${mailState.tone}`}>
                  {mailState.label}
                </span>
                {acc?.mailCheckLastCheckedAt && (
                  <span className="text-[10px] text-slate-400">
                    {formatDateTime(acc.mailCheckLastCheckedAt)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onMailCheck(acc)}
                disabled={isDied || isMailChecking}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                title={isDied ? "Acc đã mail die, không đọc lại" : "Đọc mail"}
              >
                {isMailChecking ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                {isDied ? "Đã die" : "Đọc mail"}
              </button>
            </div>
            {acc?.mailCheckLastSubject && (
              <div className="mt-2 space-y-0.5">
                <div className="text-[10px] font-semibold text-white">{acc.mailCheckLastSubject}</div>
                <div className="text-[10px] text-slate-400">
                  {acc?.mailCheckLastSender || "--"}
                  {acc?.mailCheckLastMatchedAt ? ` · ${formatDateTime(acc.mailCheckLastMatchedAt)}` : ""}
                </div>
                {acc?.mailCheckLastSnippet && (
                  <div className="rounded-md border border-slate-700/50 bg-slate-900/50 px-2 py-1.5 text-[10px] text-slate-300">
                    {acc.mailCheckLastSnippet}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Store reservation info */}
          {hasReservation && activeReservations.length > 0 && (
            <div className="rounded-xl border border-cyan-700/30 bg-cyan-900/10 p-2.5">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-cyan-300">
                Đơn web đang giữ chỗ ({reservationCount})
              </div>
              {activeReservations.slice(0, 2).map((trace, i) => (
                <div key={i} className="flex flex-wrap gap-2 text-[10px] text-slate-300">
                  <span className="text-cyan-200">{trace?.orderId || "--"}</span>
                  <span>{trace?.customerName || trace?.customerEmail || "--"}</span>
                  <span className="text-slate-400">{trace?.packageName || "--"}</span>
                </div>
              ))}
            </div>
          )}

          {/* Warranty hold info */}
          {hasWarrantyHold && warrantyHold && (
            <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-2.5 text-[10px]">
              <div className="mb-1 font-bold uppercase tracking-[0.1em] text-amber-300">Nick lỗi bảo hành web</div>
              <div className="flex flex-wrap gap-2 text-slate-300">
                <span>{warrantyHold.customerName || warrantyHold.customerEmail || "--"}</span>
                {warrantyHold.orderId && <span className="text-amber-200">#{warrantyHold.orderId}</span>}
                <span className="text-slate-400">{warrantyHold.statusLabel || "--"}</span>
              </div>
            </div>
          )}

          {/* Users section */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Khách ({visibleUsers.length})
              </span>
              {effectiveViewType === "package1" && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className={`font-bold ${
                    (visibleUsers.length + reservationCount) >= 3 ? "text-red-400" : "text-emerald-400"
                  }`}>
                    {Math.min(3, visibleUsers.length + reservationCount)}/3 slot
                  </span>
                  {reservationCount > 0 && (
                    <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                      Giữ chỗ web: {reservationCount}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Add user button */}
            {!isLockedFromSale && (
              <button
                onClick={() => onAddUser(acc.id)}
                className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700/70 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-600"
              >
                <UserPlus size={11} /> Thêm khách
              </button>
            )}

            {/* User list */}
            <div className="space-y-1.5">
              {visibleUsers.map((entry) => {
                const { user, index, name } = entry;
                const daysUsed = getDaysUsed(user);
                const daysRemaining = getDaysRemaining(user);
                const isMarketUser = isDatammoManagedUser(user);
                const storeOrderId = getStoreOrderIdentityForAccountUser?.(acc, user);
                const isPastExpiry = daysRemaining !== null && daysRemaining <= 0;

                return (
                  <div
                    key={index}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-[10px] ${
                      isMarketUser
                        ? "border-amber-700/40 bg-amber-900/15"
                        : isPastExpiry
                        ? "border-red-800/40 bg-red-900/10"
                        : "border-slate-700/50 bg-slate-900/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <User size={11} className="text-slate-400 shrink-0" />
                      <span className={`font-semibold break-all ${isMarketUser ? "text-amber-200" : "text-white"}`}>
                        {name}
                      </span>
                      {daysUsed !== null && (
                        <span className="text-slate-500">{daysUsed}d đã dùng</span>
                      )}
                      {daysRemaining !== null && (
                        <span className={`font-bold ${
                          daysRemaining <= 0 ? "text-red-400" :
                          daysRemaining <= 7 ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {daysRemaining <= 0 ? `Hết hạn ${Math.abs(daysRemaining)}d` : `Còn ${daysRemaining}d`}
                        </span>
                      )}
                      {storeOrderId && (
                        <Badge className="border-cyan-700/40 bg-cyan-900/20 text-cyan-300">
                          Web
                        </Badge>
                      )}
                    </div>
                    {!isMarketUser && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onExtendUser(acc.id, index, user)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-700/50 bg-emerald-900/30 text-emerald-300 transition hover:bg-emerald-700/40"
                          title="Gia hạn"
                        >
                          <Calendar size={10} />
                        </button>
                        <button
                          onClick={() => onMoveUser(acc.id, index, user)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-700/50 bg-amber-900/30 text-amber-300 transition hover:bg-amber-700/40"
                          title="Chuyển khách"
                        >
                          <ArrowRightLeft size={10} />
                        </button>
                        <button
                          onClick={() => onEditUser(acc.id, index, user)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-blue-700/50 bg-blue-900/30 text-blue-300 transition hover:bg-blue-700/40"
                          title="Sửa"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={() => onDeleteUser(acc.id, index, name)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-red-800/50 bg-red-900/20 text-red-400 transition hover:bg-red-800/40"
                          title="Xóa"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleUsers.length === 0 && (
                <div className="text-[10px] text-slate-600 italic">Chưa có khách</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Main Panel ───────────────────────────────────────────────────────────────
export default function ChatgptAdminPanel({
  accounts = [],
  chatgptAdminPagination,
  chatgptAdminPageLoading,
  selectedChatgptIds = [],
  setSelectedChatgptIds,
  expandedChatgptAccountId,
  setExpandedChatgptAccountId,
  highlightedChatgptAccountId,
  searchQuery,
  setSearchQuery,
  gptSubTab,
  setGptSubTab,
  chatgptTotalTypeTab,
  setChatgptTotalTypeTab,
  package2ShelfTab,
  setPackage2ShelfTab,
  chatgptMailCheckFilter,
  setChatgptMailCheckFilter,
  chatgptCustomerFilter,
  setChatgptCustomerFilter,
  chatgptExpiryFilter,
  setChatgptExpiryFilter,
  chatgptExpiryMin,
  setChatgptExpiryMin,
  chatgptExpiryMax,
  setChatgptExpiryMax,
  chatgptCreatedFrom,
  setChatgptCreatedFrom,
  chatgptCreatedTo,
  setChatgptCreatedTo,
  soldPackage2ProviderFilter,
  setSoldPackage2ProviderFilter,
  chatgptAppliedFilters = {},
  applyCurrentChatgptDraftFilters,
  resetChatgptAdminFilters,
  requestChatgptAdminPage,
  loadAdminChatgptAccounts,
  openAddModal,
  openEditModal,
  handleDeleteAccount,
  handleBulkDeleteChatgpt,
  handleBulkWarehouseChange,
  setShowImportGPTModal,
  openAddUserModal,
  openEditUserModal,
  handleDeleteUser,
  openMoveUserModal,
  handleExtendUser,
  handleRunOneChatgptMailCheck,
  handleCopy,
  loadingStates = {},
  getVisibleAccountUserEntries,
  getActiveStoreReservationTraces,
  getActiveStoreReservationCount,
  getStoreWarrantyHoldInfo,
  getStoreOrderIdentityForAccountUser,
  buildChatgpt2faLiveUrl,
  buildChatgptCopyText,
  getChatgptCopyButtonText,
  getChatgptCopySuccessText,
  marketplaceTrackedAccountIds = new Set(),
  focusChatgptAccountById,
  onTypeChange,
  onShelfChange,
  handleRunSelectedChatgptMailCheck,
}) {
  const [showFilters, setShowFilters] = useState(false);

  const pagination = chatgptAdminPagination || {
    page: 1, totalPages: 1, total: 0, limit: 10,
    summary: { tabs: {}, totalTypeTabs: {}, mailCheckTabs: {}, marketShelfTabs: {} },
  };
  const summaryTabs = pagination.summary?.tabs || {};
  const totalTypeTabs = pagination.summary?.totalTypeTabs || {};
  const mailCheckTabs = pagination.summary?.mailCheckTabs || {};
  const marketShelfTabs = pagination.summary?.marketShelfTabs || {};
  const storeWarehouse = pagination.summary?.storeWarehouse || {};

  const selectedIdSet = new Set(selectedChatgptIds.map((id) => String(id || "")));
  const allFilteredSelected =
    accounts.length > 0 &&
    accounts.every((acc) => selectedIdSet.has(String(acc.id || "")));

  const handleToggleSelectAll = useCallback((checked) => {
    const ids = accounts.map((acc) => String(acc.id || ""));
    setSelectedChatgptIds((prev) => {
      const s = new Set(prev);
      if (checked) ids.forEach((id) => s.add(id));
      else ids.forEach((id) => s.delete(id));
      return Array.from(s);
    });
  }, [accounts, setSelectedChatgptIds]);

  const handleToggleExpand = useCallback((id) => {
    setExpandedChatgptAccountId((prev) =>
      String(prev || "") === String(id || "") ? "" : id,
    );
  }, [setExpandedChatgptAccountId]);

  const handleToggleSelect = useCallback((id, checked) => {
    const key = String(id || "");
    setSelectedChatgptIds((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((v) => v !== key);
    });
  }, [setSelectedChatgptIds]);

  // Stats cards
  const pkg2StoreWarehouse = storeWarehouse?.package2 || {};
  const pkg1StoreWarehouse = storeWarehouse?.package1 || {};

  const statCards = [
    {
      label: "Tổng acc",
      value: summaryTabs.all ?? pagination.total,
      icon: Database,
      iconCls: "text-slate-400",
      accent: "border-slate-700/50 bg-slate-800/50",
    },
    {
      label: "Kho tổng",
      value: summaryTabs.total,
      icon: Package,
      iconCls: "text-blue-400",
      accent: "border-blue-700/30 bg-blue-900/15",
    },
    {
      label: "Kho market",
      value: summaryTabs.market,
      icon: ShoppingCart,
      iconCls: "text-emerald-400",
      accent: "border-emerald-700/30 bg-emerald-900/15",
    },
    {
      label: "Dưới 25 ngày",
      value: summaryTabs.short,
      icon: AlertTriangle,
      iconCls: "text-amber-400",
      accent: "border-amber-700/30 bg-amber-900/15",
    },
    {
      label: "Mail die",
      value: mailCheckTabs.died,
      icon: Mail,
      iconCls: "text-red-400",
      accent: "border-red-700/30 bg-red-900/10",
    },
    {
      label: "Gói 2 sẵn bán",
      value: pkg2StoreWarehouse.availableNow,
      sub: `Tổng: ${pkg2StoreWarehouse.existingAccounts ?? "--"} · Có thể chuyển: ${pkg2StoreWarehouse.convertibleAccounts ?? "--"}`,
      icon: Shield,
      iconCls: "text-violet-400",
      accent: "border-violet-700/30 bg-violet-900/15",
    },
  ];

  // SubTab definitions
  const mainTabs = [
    { key: "all", label: "Tất cả", count: summaryTabs.all },
    { key: "total", label: "Kho tổng", count: summaryTabs.total },
    { key: "market", label: "Kho market", count: summaryTabs.market },
  ];

  // Market shelf sub-tabs (only visible in "market" tab)
  const marketShelfTabs2 = [
    { key: "all", label: "Tất cả", count: marketShelfTabs.all },
    { key: "sold", label: "Đã bán", count: marketShelfTabs.sold },
    { key: "soldDatammo", label: "Datammo", count: marketShelfTabs.soldDatammo },
    { key: "soldShopmini", label: "Shopmini", count: marketShelfTabs.soldShopmini },
  ];

  // Total type sub-tabs (visible in "total" tab)
  const totalTypeTabs2 = [
    { key: "all", label: "Tất cả", count: totalTypeTabs.all },
    { key: "package1", label: "Gói 1", count: totalTypeTabs.package1 },
    { key: "package2", label: "Gói 2", count: totalTypeTabs.package2 },
    { key: "unassigned", label: "Chưa chọn", count: totalTypeTabs.unassigned },
  ];

  // Mail check filter
  const mailFilters = [
    { key: "all", label: "Tất cả mail", count: mailCheckTabs.all },
    { key: "died", label: "Mail die", count: mailCheckTabs.died },
    { key: "checked", label: "Đã check", count: mailCheckTabs.checked },
    { key: "unchecked", label: "Chưa check", count: mailCheckTabs.unchecked },
  ];

  // Pagination
  const buildVisiblePages = () => {
    const total = Math.max(1, Number(pagination.totalPages || 1));
    const cur = Math.max(1, Math.min(total, Number(pagination.page || 1)));
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const s = new Set([1, total, cur - 1, cur, cur + 1]);
    if (cur <= 3) [2, 3, 4].forEach((p) => s.add(p));
    if (cur >= total - 2) [total - 1, total - 2, total - 3].forEach((p) => s.add(p));
    const sorted = Array.from(s).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const items = [];
    let prev = 0;
    sorted.forEach((p) => {
      if (prev > 0 && p - prev > 1) items.push(`ellipsis-${prev}-${p}`);
      items.push(p);
      prev = p;
    });
    return items;
  };
  const visiblePages = buildVisiblePages();
  const pageStart = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const pageEnd = pagination.total > 0 ? Math.min(pagination.total, pageStart + accounts.length - 1) : 0;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white">Kho ChatGPT</h2>
          <p className="text-[12px] text-slate-400">Quản lý tài khoản ChatGPT – Gói 1, Gói 2, Kho market</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => loadAdminChatgptAccounts({ silent: false, force: true })}
            disabled={chatgptAdminPageLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
            title="Tải lại"
          >
            <RotateCw size={13} className={chatgptAdminPageLoading ? "animate-spin" : ""} />
            Tải lại
          </button>
          <button
            onClick={() => setShowImportGPTModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-violet-600 shadow-sm"
          >
            <Upload size={13} /> Import
          </button>
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-600 shadow-sm"
          >
            <Plus size={13} /> Thêm acc
          </button>
        </div>
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      {/* ── Search bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tài khoản, khách, đơn hàng..."
            className="w-full rounded-xl border border-slate-700 bg-slate-800/90 py-2 pl-8 pr-8 text-sm text-white placeholder-slate-500 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-600 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
            showFilters ? "border-slate-500 bg-slate-700 text-white" : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          <Filter size={12} /> Lọc nâng cao
        </button>
      </div>

      {/* ── Advanced filters ── */}
      {showFilters && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {/* Mail filter */}
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Mail check</label>
              <select
                value={chatgptMailCheckFilter}
                onChange={(e) => setChatgptMailCheckFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white outline-none"
              >
                <option value="all">Tất cả</option>
                <option value="died">Mail die</option>
                <option value="checked">Đã check</option>
                <option value="unchecked">Chưa check</option>
              </select>
            </div>

            {/* Customer filter */}
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Khách hàng</label>
              <select
                value={chatgptCustomerFilter}
                onChange={(e) => setChatgptCustomerFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white outline-none"
              >
                <option value="all">Tất cả</option>
                <option value="with">Có khách</option>
                <option value="without">Không khách</option>
              </select>
            </div>

            {/* Expiry filter */}
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Hạn sử dụng</label>
              <select
                value={chatgptExpiryFilter}
                onChange={(e) => setChatgptExpiryFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white outline-none"
              >
                <option value="all">Tất cả</option>
                <option value="expired">Đã hết hạn</option>
                <option value="under_15">Dưới 15 ngày</option>
                <option value="15_20">15–20 ngày</option>
                <option value="20_25">20–25 ngày</option>
                <option value="25_31">25–31 ngày</option>
                <option value="no_expiry">Không có hạn</option>
              </select>
            </div>

            {/* Market provider filter (only market tab) */}
            {gptSubTab === "market" && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Kênh bán</label>
                <select
                  value={soldPackage2ProviderFilter}
                  onChange={(e) => setSoldPackage2ProviderFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white outline-none"
                >
                  <option value="all">Tất cả kênh</option>
                  <option value="datammo">Datammo</option>
                  <option value="shopmini">Shopmini</option>
                </select>
              </div>
            )}
          </div>

          {/* Expiry range */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500">Khoảng hạn (ngày):</span>
            <input
              type="number"
              value={chatgptExpiryMin}
              onChange={(e) => setChatgptExpiryMin(e.target.value)}
              placeholder="Từ"
              className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none"
            />
            <span className="text-slate-500">–</span>
            <input
              type="number"
              value={chatgptExpiryMax}
              onChange={(e) => setChatgptExpiryMax(e.target.value)}
              placeholder="Đến"
              className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none"
            />
          </div>

          {/* Date range */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500">Ngày tạo:</span>
            <input
              type="date"
              value={chatgptCreatedFrom}
              onChange={(e) => setChatgptCreatedFrom(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none"
            />
            <span className="text-slate-500">–</span>
            <input
              type="date"
              value={chatgptCreatedTo}
              onChange={(e) => setChatgptCreatedTo(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none"
            />
          </div>

          {/* Apply / reset */}
          <div className="flex items-center gap-2">
            <button
              onClick={applyCurrentChatgptDraftFilters}
              disabled={chatgptAdminPageLoading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-cyan-600 disabled:opacity-60"
            >
              <Check size={12} /> Áp dụng
            </button>
            <button
              onClick={resetChatgptAdminFilters}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-700"
            >
              <X size={12} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* ── Main tab bar (all / kho tổng / kho market) ── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700/50 pb-2">
        {mainTabs.map((tab) => (
          <PillTab
            key={tab.key}
            active={gptSubTab === tab.key}
            onClick={() => {
              setGptSubTab(tab.key);
              void requestChatgptAdminPage({ page: 1, subTab: tab.key });
            }}
            count={tab.count}
            color={tab.key === "market" ? "bg-emerald-600" : tab.key === "total" ? "bg-blue-600" : "bg-slate-600"}
          >
            {tab.key === "market" && <ShoppingCart size={11} />}
            {tab.key === "total" && <Package size={11} />}
            {tab.label}
          </PillTab>
        ))}
      </div>

      {/* ── Sub-tab bar (market shelf tabs when in market tab) ── */}
      {gptSubTab === "market" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">Trạng thái:</span>
          {marketShelfTabs2.map((tab) => (
            <PillTab
              key={tab.key}
              active={package2ShelfTab === tab.key}
              onClick={() => {
                setPackage2ShelfTab(tab.key);
                void requestChatgptAdminPage({ page: 1, package2ShelfTab: tab.key });
              }}
              count={tab.count}
              color={tab.key === "sold" || tab.key.startsWith("sold") ? "bg-amber-600" : "bg-slate-600"}
            >
              {tab.label}
            </PillTab>
          ))}
        </div>
      )}

      {/* ── Sub-tab bar (type tabs when in kho tổng) ── */}
      {gptSubTab === "total" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">Loại gói:</span>
          {totalTypeTabs2.map((tab) => (
            <PillTab
              key={tab.key}
              active={chatgptTotalTypeTab === tab.key}
              onClick={() => {
                setChatgptTotalTypeTab(tab.key);
                void requestChatgptAdminPage({ page: 1, totalType: tab.key });
              }}
              count={tab.count}
              color={tab.key === "package1" ? "bg-blue-600" : tab.key === "package2" ? "bg-violet-600" : "bg-slate-600"}
            >
              {tab.label}
            </PillTab>
          ))}
        </div>
      )}

      {/* ── Mail filter pill bar ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold text-slate-500">Mail:</span>
        {mailFilters.map((f) => (
          <PillTab
            key={f.key}
            active={chatgptMailCheckFilter === f.key}
            onClick={() => {
              setChatgptMailCheckFilter(f.key);
              void requestChatgptAdminPage({ page: 1, mailCheckFilter: f.key });
            }}
            count={f.count}
            color={f.key === "died" ? "bg-red-600" : f.key === "checked" ? "bg-emerald-600" : "bg-slate-600"}
          >
            {f.label}
          </PillTab>
        ))}
      </div>

      {/* ── Pagination & bulk controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700/50 bg-slate-800/40 px-3 py-2">
        {/* Info */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
            {pagination.total} acc
          </span>
          {pagination.total > 0 && (
            <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
              {pageStart}–{pageEnd} / {pagination.total}
            </span>
          )}
          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
            Trang {pagination.page}/{pagination.totalPages}
          </span>
          {chatgptAdminPageLoading && (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">
              <Loader2 size={11} className="animate-spin" /> Đang tải
            </span>
          )}
        </div>

        {/* Page size + nav */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Page sizes */}
          <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
            <span className="text-[10px] text-slate-500 mr-1">Trang:</span>
            {[5, 10, 20, 30, 50].map((n) => (
              <button
                key={n}
                onClick={() => requestChatgptAdminPage({ page: 1, limit: n })}
                disabled={pagination.limit === n && chatgptAdminPageLoading}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  pagination.limit === n
                    ? "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Prev */}
          <button
            onClick={() => requestChatgptAdminPage({ page: Math.max(1, pagination.page - 1) })}
            disabled={pagination.page <= 1 || chatgptAdminPageLoading}
            className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            « Trước
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-1">
            {visiblePages.map((p) =>
              typeof p === "string" ? (
                <span key={p} className="px-1 text-[11px] text-slate-600">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => requestChatgptAdminPage({ page: p })}
                  disabled={p === pagination.page || chatgptAdminPageLoading}
                  className={`min-w-[30px] rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${
                    p === pagination.page
                      ? "cursor-default border-violet-400/60 bg-violet-500/20 text-violet-200"
                      : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ),
            )}
          </div>

          {/* Next */}
          <button
            onClick={() => requestChatgptAdminPage({ page: Math.min(pagination.totalPages, pagination.page + 1) })}
            disabled={pagination.page >= pagination.totalPages || chatgptAdminPageLoading}
            className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/15 disabled:opacity-50"
          >
            Sau »
          </button>
        </div>
      </div>

      {/* ── Select all + bulk actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={(e) => handleToggleSelectAll(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-emerald-500"
            title="Chọn tất cả"
          />
          <span className="text-[11px] text-slate-400">
            Đã chọn <strong className="text-white">{selectedChatgptIds.length}</strong> acc
          </span>
          {selectedChatgptIds.length > 0 && (
            <button
              onClick={() => setSelectedChatgptIds([])}
              className="text-[10px] text-slate-500 hover:text-slate-300 underline"
            >
              Bỏ chọn
            </button>
          )}
        </div>

        {selectedChatgptIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleBulkWarehouseChange("cheap")}
              disabled={!!loadingStates.bulkWarehouseMove}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-800/70 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {loadingStates.bulkWarehouseMove ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
              → Kho market
            </button>
            <button
              onClick={() => void handleBulkWarehouseChange("none")}
              disabled={!!loadingStates.bulkWarehouseMove}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-800/70 px-3 py-1.5 text-[11px] font-bold text-blue-200 transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loadingStates.bulkWarehouseMove ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
              → Kho tổng
            </button>
            <button
              onClick={handleBulkDeleteChatgpt}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-800/60 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-700/70"
            >
              <Trash2 size={12} /> Xóa đã chọn
            </button>
          </div>
        )}
      </div>

      {/* ── Account list ── */}
      <div className="space-y-2">
        {chatgptAdminPageLoading && accounts.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span>Đang tải...</span>
          </div>
        )}
        {!chatgptAdminPageLoading && accounts.length === 0 && (
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 py-12 text-center">
            <p className="text-slate-500">Không có tài khoản nào khớp bộ lọc hiện tại.</p>
          </div>
        )}
        {accounts.map((acc) => (
          <AccountCard
            key={acc.id}
            acc={acc}
            isExpanded={String(expandedChatgptAccountId || "") === String(acc.id || "")}
            isSelected={selectedIdSet.has(String(acc.id || ""))}
            isHighlighted={String(highlightedChatgptAccountId || "") === String(acc.id || "")}
            isMarket={gptSubTab === "market"}
            isMarketTracked={marketplaceTrackedAccountIds.has(String(acc.id || ""))}
            loadingStates={loadingStates}
            onToggleSelect={handleToggleSelect}
            onToggleExpand={handleToggleExpand}
            onEdit={openEditModal}
            onDelete={handleDeleteAccount}
            onAddUser={(accId) => openAddUserModal(accId)}
            onEditUser={(accId, idx, user) => openEditUserModal(accId, idx, user)}
            onDeleteUser={(accId, idx, name) => handleDeleteUser(accId, idx, name)}
            onMoveUser={(accId, idx, user) => openMoveUserModal(accId, idx, user)}
            onExtendUser={(accId, idx, user) => handleExtendUser(accId, idx, user)}
            onMailCheck={handleRunOneChatgptMailCheck}
            onCopy={handleCopy}
            onTypeChange={onTypeChange}
            onShelfChange={onShelfChange}
            getVisibleAccountUserEntries={getVisibleAccountUserEntries}
            getActiveStoreReservationTraces={getActiveStoreReservationTraces}
            getActiveStoreReservationCount={getActiveStoreReservationCount}
            getStoreWarrantyHoldInfo={getStoreWarrantyHoldInfo}
            getStoreOrderIdentityForAccountUser={getStoreOrderIdentityForAccountUser}
            buildChatgpt2faLiveUrl={buildChatgpt2faLiveUrl}
            buildChatgptCopyText={buildChatgptCopyText}
            getChatgptCopyButtonText={getChatgptCopyButtonText}
            getChatgptCopySuccessText={getChatgptCopySuccessText}
          />
        ))}
      </div>
    </div>
  );
}

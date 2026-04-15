/**
 * ChatgptAdminPanel.jsx — Premium ChatGPT Admin Panel
 * All logic 100% mirrored from App.jsx. No fabrications.
 * Includes: market acc, store reservation, marketplace warranty (current/source/history),
 *           store warranty hold, admin trace summary, user management.
 */
import { useState, useCallback, memo } from "react";
import {
  RefreshCw, Upload, Loader2, Copy, Mail, User, Calendar,
  ExternalLink, Trash2, Pencil, UserPlus, ArrowRightLeft,
  Search, X, ChevronUp, RotateCw, Shield, AlertTriangle,
  Plus, Package, ShoppingCart, Check, Filter, Layers, Database,
  AlertCircle,
} from "lucide-react";

// ─── Pure pure helpers (no state deps) ───────────────────────────────────────

const normalizeChatgptAccountType = (v) =>
  ["package1", "package2", "unassigned"].includes(String(v || "").trim())
    ? String(v || "").trim() : "unassigned";

const normalizePackage2Shelf = (v) => {
  if (v === "cheap") return "cheap";
  if (v === "main") return "main";
  return "none";
};

const normalizeChatgptWarehouseUiValue = (v) =>
  normalizePackage2Shelf(v) === "cheap" ? "cheap" : "none";

const supportsChatgptMarketType = (v) =>
  ["package1", "package2", "unassigned", ""].includes(String(v || "").trim());

const isChatgptMarketWarehouse = (acc = {}) =>
  supportsChatgptMarketType(acc?.type) && normalizePackage2Shelf(acc?.package2Shelf) === "cheap";

const normalizeChatgptMailCheckStatus = (v) => {
  const n = String(v || "").trim().toLowerCase();
  if (n === "died") return "died";
  if (n === "clean") return "clean";
  return "unchecked";
};

const getChatgptMailCheckVisualState = (acc = {}) => {
  const status = normalizeChatgptMailCheckStatus(acc?.mailCheckStatus);
  if (status === "died") return { key: "died", label: "Mail die", tone: "border-red-700/60 bg-red-900/20 text-red-300" };
  if (acc?.mailCheckLastCheckedAt) return { key: "checked", label: "Đã check", tone: "border-emerald-700/60 bg-emerald-900/20 text-emerald-300" };
  return { key: "unchecked", label: "Chưa check", tone: "border-slate-700 bg-slate-800/80 text-slate-400" };
};

const normalizeMarketplaceProvider = (v, fallback = "datammo") => {
  const r = String(v || "").trim().toLowerCase();
  if (r === "shopmini") return "shopmini";
  if (r === "datammo") return "datammo";
  return fallback;
};

const getMarketplaceProviderLabel = (v) =>
  normalizeMarketplaceProvider(v) === "shopmini" ? "Shopmini" : "Datammo";

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

const getUserDate = (u) => {
  if (typeof u === "object" && u !== null && u.joinedAt) {
    try {
      const d = new Date(u.joinedAt);
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    } catch { return ""; }
  }
  return "";
};

const getDaysRemainingFromUser = (u) => {
  if (typeof u === "object" && u !== null) {
    if (u.expiredAt) {
      try { return Math.ceil((new Date(u.expiredAt) - new Date()) / 86400000); } catch { }
    }
    if (u.joinedAt) {
      try {
        const exp = new Date(u.joinedAt);
        exp.setMonth(exp.getMonth() + 1);
        return Math.ceil((exp - new Date()) / 86400000);
      } catch { }
    }
  }
  return null;
};

const getUserExpiryDate = (u) => {
  if (typeof u === "object" && u !== null) {
    if (u.expiredAt) return formatDateStr(u.expiredAt);
    if (u.joinedAt) {
      try {
        const d = new Date(u.joinedAt);
        d.setMonth(d.getMonth() + 1);
        return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      } catch { return ""; }
    }
  }
  return "";
};

const formatDateStr = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch { return ""; }
};

const formatDateTime = (iso) => {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "--"; }
};

const getUserName = (u) => getAccountUserDisplayName(u);

const getExpiryItemStatus = (acc = {}) => {
  if (!acc?.expiredAt) return null;
  const days = Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000);
  if (days <= 0) return { text: `Hết hạn ${Math.abs(days)}d`, color: "text-red-400", urgent: true };
  if (days <= 7) return { text: `Còn ${days}d`, color: "text-red-400", urgent: true };
  if (days <= 15) return { text: `Còn ${days}d`, color: "text-amber-400", urgent: false };
  return { text: `Còn ${days}d`, color: "text-emerald-400", urgent: false };
};

const isDatammoManagedUser = (user) => {
  const name = getAccountUserDisplayName(user).trim().toLowerCase();
  return name.startsWith("datammo#") || name.startsWith("[datammo]") ||
    name.startsWith("shopmini#") || name.startsWith("[shopmini]");
};

const isPlaceholderMarketplaceOrderId = (v) => {
  const r = String(v || "").trim();
  if (!r) return false;
  return r.includes("{") || r.includes("}") || /^(test|preview)$/i.test(r);
};

const getMarketplaceOrderInfoFromUser = (user) => {
  const rawName = getAccountUserDisplayName(user).trim();
  const d = /^datammo#(.+)$/i.exec(rawName);
  if (d?.[1]) return { provider: "datammo", orderId: String(d[1]).trim() };
  const s = /^shopmini#(.+)$/i.exec(rawName);
  if (s?.[1]) return { provider: "shopmini", orderId: String(s[1]).trim() };
  if (/^\[datammo\]/i.test(rawName)) return { provider: "datammo", orderId: "" };
  if (/^\[shopmini\]/i.test(rawName)) return { provider: "shopmini", orderId: "" };
  return { provider: "", orderId: "" };
};

const isPlaceholderMarketplaceManagedUser = (user) => {
  const info = getMarketplaceOrderInfoFromUser(user);
  return !!String(info?.orderId || "").trim() && isPlaceholderMarketplaceOrderId(info.orderId);
};

const isActiveMarketplaceManagedUser = (user) =>
  isDatammoManagedUser(user) && !isPlaceholderMarketplaceManagedUser(user);

const getLegacyMarketplaceInfoFromNote = (note) => {
  const lines = String(note || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/^\[Legacy Datammo customer\]/i.test(line)) continue;
    const body = line.replace(/^\[Legacy Datammo customer\]\s*/i, "");
    const parts = body.split("|").map((p) => p.trim()).filter(Boolean);
    const name = String(parts.shift() || "").trim();
    const orderInfo = getMarketplaceOrderInfoFromUser({ name });
    const joinedAt = String(parts.find((p) => /^joined:/i.test(p)) || "").replace(/^joined:\s*/i, "").trim();
    const expiredAt = String(parts.find((p) => /^expired:/i.test(p)) || "").replace(/^expired:\s*/i, "").trim();
    return { name, provider: orderInfo.provider || "", orderId: orderInfo.orderId || "", joinedAt, expiredAt };
  }
  return null;
};

const getVisibleAccountNote = (note) => {
  const raw = String(note || "").trim();
  if (!raw) return "";
  return raw
    .split("\n")
    .filter((l) => !/^\[(StoreWarrantyHold|Legacy Datammo customer)\]/i.test(l.trim()))
    .join("\n").trim();
};

const getPackage2ShelfLabel = (v) =>
  normalizeChatgptWarehouseUiValue(v) === "cheap" ? "Kho market" : "Kho tổng";

const normalizeMarketplaceScope = (scope) =>
  String(scope || "").trim().toLowerCase() === "team" ? "team" : "chatgpt";

// ─── Sub-components ───────────────────────────────────────────────────────────

const Badge = memo(({ children, className = "" }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${className}`}>
    {children}
  </span>
));

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

// ─── AccountCard ──────────────────────────────────────────────────────────────
const AccountCard = memo(({
  acc,
  isExpanded,
  isSelected,
  isHighlighted,
  isMarket,
  isMarketTracked,
  marketplaceTrackedAccountMap,
  datammoWarrantyCases,
  datammoOrderHistory,
  storeOrders,
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
  onOpenWarranty,
  getActiveStoreReservationTraces,
  getActiveStoreReservationCount,
  getStoreWarrantyHoldInfo,
  getStoreOrderIdentityForAccountUser,
  buildChatgpt2faLiveUrl,
  buildChatgptCopyText,
  getChatgptCopyButtonText,
  getChatgptCopySuccessText,
}) => {
  const visibleUserEntries = getVisibleAccountUserEntries(acc);
  const visibleUsers = visibleUserEntries.map((e) => e.user);
  const primaryUserEntry = visibleUserEntries[0] || null;
  const primaryUser = primaryUserEntry?.user || null;
  const primaryUserIndex = primaryUserEntry?.index ?? 0;

  const activeReservations = getActiveStoreReservationTraces(acc);
  const reservationCount = getActiveStoreReservationCount(acc);
  const warrantyHold = getStoreWarrantyHoldInfo(acc);
  const hasReservation = reservationCount > 0;
  const hasStoreWarrantyHold = !!warrantyHold && !hasReservation;
  const isLockedFromManualSale = hasReservation || hasStoreWarrantyHold;
  const latestStoreReservationTrace = activeReservations[0] || null;

  const mailState = getChatgptMailCheckVisualState(acc);
  const expiryStatus = getExpiryItemStatus(acc);
  const accType = normalizeChatgptAccountType(acc?.effectiveType || acc?.type);
  const isDied = normalizeChatgptMailCheckStatus(acc?.mailCheckStatus) === "died";
  const isMailChecking = loadingStates?.runChatgptMailCheckOne === String(acc?.id || "");
  const isTypeChanging = !!loadingStates?.changeType?.[acc.id];
  const isShelfChanging = !!loadingStates?.changeShelf?.[acc.id];
  const note = getVisibleAccountNote(acc.note);
  const hasMarketplaceTracking = isMarketTracked;

  // Effective view type for user slot
  const effectiveViewType = accType === "unassigned"
    ? visibleUsers.length > 1 ? "package1" : visibleUsers.length === 1 ? "package2" : "unassigned"
    : accType;

  // Marketplace data resolution (mirrors App.jsx exactly)
  const trackedEntry = marketplaceTrackedAccountMap?.get(String(acc?.id || "")) || null;
  const trackedSummary = trackedEntry?.summary || null;
  const storeTraceSummary = acc?.storeTraceSummary || null;
  const marketplaceTraceSummary = acc?.marketplaceTraceSummary || null;

  // Warranty info from datammo warranty cases
  const warrantyInfo = (() => {
    if (!datammoWarrantyCases || !acc?.id) return null;
    const normalizedId = String(acc.id).trim();
    for (const wc of (Array.isArray(datammoWarrantyCases) ? datammoWarrantyCases : [])) {
      if (normalizeMarketplaceScope(wc?.scope) !== "chatgpt") continue;
      if (String(wc?.currentAccountId || "") === normalizedId) return { role: "current", warrantyCase: wc };
      if (String(wc?.rootAccountId || "") === normalizedId) return { role: "root", warrantyCase: wc };
      const rounds = Array.isArray(wc?.rounds) ? wc.rounds : [];
      const participates = rounds.some(
        (r) => String(r?.fromAccountId || "") === normalizedId || String(r?.toAccountId || "") === normalizedId
      );
      if (participates) return { role: "history", warrantyCase: wc };
    }
    return null;
  })();
  const warrantyCase = warrantyInfo?.warrantyCase || null;
  const warrantyRounds = Array.isArray(warrantyCase?.rounds) ? warrantyCase.rounds : [];

  // Legacy marketplace info from note
  const legacyInfo = getLegacyMarketplaceInfoFromNote(acc.note);

  // Primary user's managed marketplace info
  const managedOrderInfo = primaryUser ? getMarketplaceOrderInfoFromUser(primaryUser) : { provider: "", orderId: "" };

  // Find the order in history
  const latestMarketplaceOrder = (() => {
    if (!datammoOrderHistory || !acc?.id) return null;
    const normalizedId = String(acc.id).trim();
    for (const order of (Array.isArray(datammoOrderHistory) ? datammoOrderHistory : [])) {
      if (normalizeMarketplaceScope(order?.scope) !== "chatgpt") continue;
      const accounts = Array.isArray(order?.accounts) ? order.accounts : [];
      if (accounts.some((a) => String(a?.accountId || "").trim() === normalizedId)) return order;
    }
    return null;
  })();

  const datammoOrderId = String(
    managedOrderInfo.orderId || legacyInfo?.orderId || trackedEntry?.orderId || latestMarketplaceOrder?.orderId || ""
  ).trim();
  const managedProvider = normalizeMarketplaceProvider(
    managedOrderInfo.provider || legacyInfo?.provider || trackedEntry?.provider || latestMarketplaceOrder?.provider
  );
  const providerLabel = getMarketplaceProviderLabel(managedProvider);
  const warrantyProviderLabel = getMarketplaceProviderLabel(warrantyCase?.provider || managedProvider);

  const trackedRole = String(trackedEntry?.role || "").trim();
  const hasActiveMarketplaceTracking = trackedRole === "sold" || trackedRole === "current";
  const hasVerifiedMarketplaceTrace = !!trackedEntry || !!latestMarketplaceOrder || !!warrantyCase;
  const hasActualManagedMarketplaceUser = !!primaryUser && isActiveMarketplaceManagedUser(primaryUser) && hasVerifiedMarketplaceTrace;
  const hasRegularVisibleUser = !!primaryUser && (!isActiveMarketplaceManagedUser(primaryUser) || !hasVerifiedMarketplaceTrace);
  const isLockedByStoreWarrantyHold = !!warrantyHold && !primaryUser && !hasReservation;
  const isInMarketWarehouse = normalizePackage2Shelf(acc.package2Shelf) === "cheap";
  const showMarketplaceManagementCard = hasActualManagedMarketplaceUser || !!trackedEntry || !!warrantyCase;

  const warrantyRoleLabel = warrantyInfo?.role === "current" ? "Acc đang thay"
    : warrantyInfo?.role === "history" ? "Acc đã thay" : "Acc lỗi gốc";
  const latestWarrantyTarget = warrantyCase?.currentUsername
    || warrantyRounds[warrantyRounds.length - 1]?.toUsername
    || warrantyCase?.currentAccountId || "";

  // Display user resolution (same as App.jsx)
  const displayUser = hasRegularVisibleUser ? primaryUser
    : hasActualManagedMarketplaceUser ? primaryUser
    : warrantyHold ? {
        name: warrantyHold.customerName || warrantyHold.customerEmail || `Don ${warrantyHold.orderId || "bao-hanh"}`,
        joinedAt: warrantyHold.createdAt || "",
        expiredAt: acc?.expiredAt || "",
      }
    : showMarketplaceManagementCard ? {
        name: legacyInfo?.name || trackedEntry?.label || trackedSummary?.currentUsername || trackedSummary?.soldUsername || `${providerLabel}#${datammoOrderId || "order"}`,
        joinedAt: legacyInfo?.joinedAt || trackedEntry?.order?.createdAt || latestMarketplaceOrder?.createdAt || "",
        expiredAt: legacyInfo?.expiredAt || "",
      }
    : null;

  const displayName = String(getUserName(displayUser) || trackedEntry?.label || trackedSummary?.currentUsername || trackedSummary?.soldUsername || "").trim();
  const linkedStoreOrder = displayUser ? getStoreOrderIdentityForAccountUser?.(acc, displayUser) : null;

  const displayPrimaryLabel = String(
    displayName || warrantyHold?.customerName || warrantyHold?.customerEmail
    || (warrantyHold?.orderId ? `Đơn ${warrantyHold.orderId}` : "")
    || linkedStoreOrder?.customerName || linkedStoreOrder?.orderId || ""
  ).trim();

  const displaySecondaryLabel = String(
    (warrantyHold ? [warrantyHold.orderId, warrantyHold.statusLabel, warrantyHold.packageName].filter(Boolean).join(" · ") : "")
    || linkedStoreOrder?.orderId || linkedStoreOrder?.contact || ""
  ).trim();

  const soldMarketplaceUsername = String(trackedSummary?.soldUsername || acc?.username || "").trim();
  const currentMarketplaceUsername = String(warrantyCase?.currentUsername || trackedSummary?.currentUsername || soldMarketplaceUsername || acc?.username || "").trim();
  const displayJoinedDate = getUserDate(displayUser) || formatDateStr(trackedEntry?.order?.createdAt || latestMarketplaceOrder?.createdAt) || "--";
  const displayExpiryDate = getUserExpiryDate(displayUser) || formatDateStr(acc?.expiredAt) || "";

  const daysRemaining = displayUser ? getDaysRemainingFromUser(displayUser) : null;
  const isExpired = daysRemaining !== null && daysRemaining <= 0;
  const isNearExpiry = daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3;

  const canOpenWarranty = showMarketplaceManagementCard && !!datammoOrderId;

  // Marketplace card color classes
  const marketplaceCardCls = warrantyInfo?.role === "current"
    ? "border-cyan-700/50 bg-cyan-950/20 text-cyan-100"
    : warrantyCase ? "border-amber-700/50 bg-amber-950/20 text-amber-100"
    : "border-indigo-700/40 bg-indigo-950/20 text-indigo-100";
  const marketplaceChipCls = warrantyInfo?.role === "current"
    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-200"
    : warrantyCase ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
    : "border-indigo-500/30 bg-indigo-500/15 text-indigo-200";
  const marketplaceStatusLabel = warrantyCase
    ? warrantyInfo?.role === "current" ? "Đang bảo hành" : "Lịch sử BH"
    : isLockedByStoreWarrantyHold ? "Giữ BH" : "Đã bán";

  // Admin trace summary
  const showAdminTraceSummary = Number(storeTraceSummary?.totalOrders || 0) > 0
    || Number(marketplaceTraceSummary?.orderCount || 0) > 0
    || Number(marketplaceTraceSummary?.warrantyCount || 0) > 0;

  // Type badge classes
  const typeCls = accType === "package1" ? "border-blue-700/50 bg-blue-900/40 text-blue-300"
    : accType === "package2" ? "border-violet-700/50 bg-violet-900/40 text-violet-300"
    : "border-slate-700 bg-slate-800 text-slate-400";
  const typeText = accType === "package1" ? "Gói 1" : accType === "package2" ? "Gói 2" : "Chưa chọn";
  const shelfCls = normalizeChatgptWarehouseUiValue(acc.package2Shelf) === "cheap"
    ? "border-emerald-700/60 bg-emerald-900/40 text-emerald-300"
    : "border-slate-700 bg-slate-800 text-slate-300";
  const shelfText = normalizeChatgptWarehouseUiValue(acc.package2Shelf) === "cheap" ? "Kho market" : "Kho tổng";

  // Package 2 shelf label (for display)
  const package2ShelfLabel = getPackage2ShelfLabel(acc.package2Shelf);

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
      {/* ── Card header row ── */}
      <div className="flex items-start gap-2.5 p-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(acc.id, e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500 rounded"
        />

        {/* Main info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Row 1: username + badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-all font-mono text-sm font-bold text-white">{acc.username}</span>
            <button
              onClick={() => onCopy(acc.username, "Đã copy tài khoản")}
              className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-200 transition hover:bg-slate-600"
            >
              <Copy size={9} /> Copy
            </button>
            {/* Type */}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${typeCls}`}>{typeText}</span>
            {/* Shelf (market tab) */}
            {isMarket && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                hasMarketplaceTracking
                  ? warrantyInfo?.role === "current"
                    ? "border-cyan-700/60 bg-cyan-900/40 text-cyan-300"
                    : warrantyCase
                    ? "border-amber-700/60 bg-amber-900/40 text-amber-300"
                    : "border-amber-700/60 bg-amber-900/40 text-amber-300"
                  : isLockedFromManualSale
                  ? "border-cyan-700/60 bg-cyan-900/40 text-cyan-300"
                  : shelfCls
              }`}>
                {hasMarketplaceTracking
                  ? warrantyCase ? (warrantyInfo?.role === "current" ? "Đang BH" : "Lịch sử BH") : "Đã bán"
                  : isLockedFromManualSale ? (hasReservation ? "Đơn web" : "Giữ BH web")
                  : shelfText}
              </span>
            )}
            {/* Mail check */}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${mailState.tone}`}>{mailState.label}</span>
            {/* Expiry */}
            {expiryStatus && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                expiryStatus.urgent ? "border-red-700/60 bg-red-900/20 text-red-300" : "border-slate-700 bg-slate-800/80 text-slate-300"
              }`}>{expiryStatus.text}</span>
            )}
            {/* Flags */}
            {acc.otpSecret && <Badge className="border-cyan-700/60 bg-cyan-950/20 text-cyan-300"><Shield size={9} /> 2FA</Badge>}
            {note && <Badge className="border-yellow-700/60 bg-yellow-900/20 text-yellow-300">Ghi chú</Badge>}
            {hasReservation && <Badge className="border-cyan-600/60 bg-cyan-900/20 text-cyan-200"><ShoppingCart size={9} /> Giữ chỗ web</Badge>}
            {hasStoreWarrantyHold && <Badge className="border-amber-700/60 bg-amber-900/20 text-amber-200"><Shield size={9} /> Giữ BH web</Badge>}
            {warrantyCase && <Badge className={warrantyInfo?.role === "current" ? "border-cyan-500/40 bg-cyan-900/20 text-cyan-200" : "border-amber-500/40 bg-amber-900/20 text-amber-200"}><Shield size={9} /> {warrantyRoleLabel}</Badge>}
          </div>

          {/* Row 2: user preview (collapsed only) */}
          {!isExpanded && (
            <>
              {/* Regular users preview */}
              {visibleUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {visibleUsers.slice(0, 2).map((user, i) => {
                    const name = getAccountUserDisplayName(user);
                    const rem = getDaysRemainingFromUser(user);
                    const isMarketUser = isDatammoManagedUser(user);
                    return (
                      <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                        isMarketUser ? "border-amber-700/50 bg-amber-900/30 text-amber-200" : "border-slate-700/60 bg-slate-900/50 text-slate-300"
                      }`}>
                        <User size={9} />{name}
                        {rem !== null && (
                          <span className={rem <= 0 ? "text-red-400" : rem <= 7 ? "text-amber-400" : "text-emerald-400"}>
                            ({rem <= 0 ? `HH${Math.abs(rem)}d` : `${rem}d`})
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
              {/* Market/warranty user preview */}
              {visibleUsers.length === 0 && displayPrimaryLabel && (
                <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[10px] ${marketplaceCardCls}`}>
                  <User size={10} />
                  <span className="font-semibold">{displayPrimaryLabel}</span>
                  {displaySecondaryLabel && <span className="text-slate-400">{displaySecondaryLabel}</span>}
                  {warrantyCase && (
                    <Badge className={warrantyInfo?.role === "current" ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-200" : "border-amber-500/30 bg-amber-500/15 text-amber-200"}>
                      {warrantyInfo?.role === "current" ? "Đang BH" : "Lịch sử BH"}
                    </Badge>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onCopy(buildChatgptCopyText(acc), getChatgptCopySuccessText(acc))}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/80 px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-indigo-500 shadow-sm"
            >
              <Copy size={11} /> {getChatgptCopyButtonText(acc)}
            </button>
            <button
              onClick={() => onToggleExpand(acc.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all ${
                isExpanded ? "border-slate-500 bg-slate-700 text-white" : "border-slate-700 bg-slate-800 text-slate-400 hover:text-white"
              }`}
              title={isExpanded ? "Thu gọn" : "Mở rộng"}
            >
              <ChevronUp size={13} className={`transition-transform ${isExpanded ? "rotate-0" : "rotate-180"}`} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(acc)} className="flex h-6 w-6 items-center justify-center rounded-md border border-blue-700/50 bg-blue-900/30 text-blue-300 transition hover:bg-blue-700/50" title="Sửa acc">
              <Pencil size={11} />
            </button>
            <button onClick={() => onDelete(acc)} className="flex h-6 w-6 items-center justify-center rounded-md border border-red-800/50 bg-red-900/20 text-red-400 transition hover:bg-red-800/40" title="Xóa acc">
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Expanded content ── */}
      {isExpanded && (
        <div className="border-t border-slate-700/50 px-3 pb-3 pt-2.5 space-y-3">

          {/* ── 1. Admin Trace Summary (fuchsia) ── */}
          {showAdminTraceSummary && (
            <div className="rounded-xl border border-fuchsia-700/40 bg-fuchsia-950/15 px-3 py-3 text-fuchsia-100">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-fuchsia-200">
                  Trace gắn với nick
                </span>
                {Number(storeTraceSummary?.totalOrders || 0) > 0 && (
                  <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[9px] font-bold uppercase text-cyan-200">
                    Web {storeTraceSummary.totalOrders}
                  </span>
                )}
                {Number(marketplaceTraceSummary?.orderCount || 0) > 0 && (
                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold uppercase text-emerald-200">
                    Sàn {marketplaceTraceSummary.orderCount}
                  </span>
                )}
                {Number(marketplaceTraceSummary?.warrantyCount || 0) > 0 && (
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase text-amber-200">
                    Bảo hành {marketplaceTraceSummary.warrantyCount}
                  </span>
                )}
              </div>
              <div className="space-y-1 text-[11px] text-slate-200">
                {(() => {
                  const latestTrace = Array.isArray(storeTraceSummary?.traces) && storeTraceSummary.traces.length > 0
                    ? storeTraceSummary.traces[0] : null;
                  return latestTrace ? (
                    <div>
                      <span className="text-slate-400">Đơn web mới nhất: </span>
                      <span className="font-semibold text-white">{latestTrace.orderId}</span>
                      {" "}· {latestTrace.status}
                      {(latestTrace.customerName || latestTrace.customerEmail) && (
                        <span className="text-fuchsia-200"> · {latestTrace.customerName || latestTrace.customerEmail}</span>
                      )}
                    </div>
                  ) : null;
                })()}
                {Number(marketplaceTraceSummary?.orderCount || 0) > 0 && (
                  <div>
                    <span className="text-slate-400">Đơn sàn gần nhất: </span>
                    <span className="font-semibold text-white">
                      {getMarketplaceProviderLabel(marketplaceTraceSummary?.latestProvider)} {marketplaceTraceSummary?.latestOrderId || "--"}
                    </span>
                  </div>
                )}
                {Number(marketplaceTraceSummary?.warrantyCount || 0) > 0 && (
                  <div>
                    <span className="text-slate-400">Đơn BH gần nhất: </span>
                    <span className="font-semibold text-white">{marketplaceTraceSummary?.latestWarrantyOrderId || "--"}</span>
                  </div>
                )}
                <div className="text-[10px] text-slate-500">Nếu đã xóa đơn mà khung này còn, nick đang dính trace ở collection khác.</div>
              </div>
            </div>
          )}

          {/* ── 2. Credentials ── */}
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Thông tin đăng nhập</span>
              {acc.expiredAt && expiryStatus && (
                <span className={`flex items-center gap-1 text-[10px] font-semibold ${expiryStatus.color}`}>
                  <Calendar size={10} /> {formatDateStr(acc.expiredAt)}
                </span>
              )}
            </div>
            {/* Password */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-500">Mật khẩu</span>
              <code className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-white break-all">{acc.password}</code>
              <button onClick={() => onCopy(acc.password, "Đã copy mật khẩu")} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-600">
                <Copy size={10} /> Copy
              </button>
            </div>
            {/* 2FA */}
            {acc.otpSecret && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-500">2FA</span>
                <code className="rounded-md bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-cyan-200 break-all">{acc.otpSecret}</code>
                <button onClick={() => onCopy(acc.otpSecret, "Đã copy 2FA")} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-600">
                  <Copy size={10} /> Copy
                </button>
                <a href={buildChatgpt2faLiveUrl(acc.otpSecret)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-cyan-700/80 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-cyan-600">
                  <ExternalLink size={10} /> 2fa.live
                </a>
              </div>
            )}
            {/* Link mail */}
            {acc.link && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-500">Link</span>
                <a href={acc.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-teal-700/80 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-teal-600">
                  <Mail size={10} /> Mở mail
                </a>
                <button onClick={() => onCopy(acc.link, "Đã copy link mail")} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-600">
                  <Copy size={10} /> Copy
                </button>
              </div>
            )}
            {/* Copy all */}
            <button onClick={() => onCopy(buildChatgptCopyText(acc), getChatgptCopySuccessText(acc))} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600/80 px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-indigo-500">
              <Copy size={11} /> {getChatgptCopyButtonText(acc)}
            </button>
            {/* Note */}
            {note && (
              <div className="rounded-lg border border-yellow-700/30 bg-yellow-900/10 px-2 py-1.5 text-[10px] italic text-yellow-200">{note}</div>
            )}
          </div>

          {/* ── 3. Type & Shelf selector ── */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-500">Loại gói:</span>
              <select
                value={normalizeChatgptAccountType(acc?.effectiveType || acc?.type)}
                onChange={(e) => onTypeChange(acc, e.target.value)}
                disabled={isTypeChanging || isLockedFromManualSale}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold outline-none cursor-pointer appearance-none transition ${typeCls} ${isTypeChanging || isLockedFromManualSale ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <option value="unassigned">❓ Chưa chọn</option>
                <option value="package1">👥 Gói 1 – Chia sẻ</option>
                <option value="package2">🔒 Gói 2 – Linh hoạt</option>
              </select>
              {isTypeChanging && <Loader2 size={13} className="animate-spin text-blue-400" />}
            </div>
            {supportsChatgptMarketType(acc.type) && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-500">Kho:</span>
                {hasMarketplaceTracking ? (
                  <span className="rounded-lg border border-amber-700/60 bg-amber-900/30 px-2.5 py-1 text-[10px] font-bold text-amber-200">🔒 Khóa đơn sàn</span>
                ) : isLockedFromManualSale ? (
                  <span className="rounded-lg border border-cyan-700/60 bg-cyan-900/30 px-2.5 py-1 text-[10px] font-bold text-cyan-200">
                    {hasReservation ? "🔒 Đơn web giữ chỗ" : "🔒 Nick lỗi BH web"}
                  </span>
                ) : (
                  <select
                    value={normalizeChatgptWarehouseUiValue(acc.package2Shelf)}
                    onChange={(e) => onShelfChange(acc, e.target.value)}
                    disabled={isShelfChanging || visibleUsers.length > 0 || isLockedFromManualSale}
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

          {/* ── 4. Mail check ── */}
          <div className="rounded-xl border border-rose-900/30 bg-rose-950/15 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-rose-300">Mail check</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${mailState.tone}`}>{mailState.label}</span>
                {acc?.mailCheckLastCheckedAt && (
                  <span className="text-[10px] text-slate-400">{formatDateTime(acc.mailCheckLastCheckedAt)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onMailCheck(acc)}
                disabled={isDied || isMailChecking}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                  <div className="rounded-md border border-slate-700/50 bg-slate-900/50 px-2 py-1.5 text-[10px] text-slate-300">{acc.mailCheckLastSnippet}</div>
                )}
              </div>
            )}
          </div>

          {/* ── 5. Store Reservation ── */}
          {hasReservation && activeReservations.length > 0 && (
            <div className="rounded-xl border border-cyan-700/30 bg-cyan-900/10 p-2.5">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-cyan-300">Đơn web đang giữ chỗ ({reservationCount})</div>
              {activeReservations.slice(0, 3).map((trace, i) => (
                <div key={i} className="flex flex-wrap gap-2 text-[10px] text-slate-300 mt-1">
                  <span className="text-cyan-200 font-semibold">{trace?.orderId || "--"}</span>
                  <span>{trace?.customerName || trace?.customerEmail || "--"}</span>
                  <span className="text-slate-400">{trace?.packageName || "--"}</span>
                  <span className="text-slate-500">{trace?.status || ""}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── 6. Store Warranty Hold (web) ── */}
          {hasStoreWarrantyHold && warrantyHold && (
            <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-2.5 text-[10px]">
              <div className="mb-1 font-bold uppercase tracking-[0.1em] text-amber-300">Nick lỗi – đang giữ BH web</div>
              <div className="flex flex-wrap gap-2 text-slate-300">
                <span className="font-semibold">{warrantyHold.customerName || warrantyHold.customerEmail || "--"}</span>
                {warrantyHold.orderId && <span className="text-amber-200">#{warrantyHold.orderId}</span>}
                <span className="text-slate-400">{warrantyHold.packageName || ""}</span>
                <span className="text-slate-500">{warrantyHold.statusLabel || ""}</span>
              </div>
            </div>
          )}

          {/* ── 7. Marketplace Warranty Info (datammo/shopmini) ── */}
          {warrantyCase && warrantyRounds.length > 0 && (
            <div className={`rounded-xl border px-3 py-2.5 text-[10px] shadow-sm ${
              warrantyInfo?.role === "current"
                ? "border-cyan-700/50 bg-cyan-950/20 text-cyan-100"
                : "border-amber-700/50 bg-amber-950/20 text-amber-100"
            }`}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center rounded-full border border-white/10 bg-slate-900/70 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-white">
                  {warrantyProviderLabel}
                </span>
                <span className="text-[10px] font-bold text-white">Bảo hành lần {warrantyRounds.length}</span>
              </div>
              <div className="text-slate-300 mb-0.5">Đơn {warrantyCase.orderId || datammoOrderId || "?"}</div>
              <div className="mb-2">
                <span className={warrantyInfo?.role === "current" ? "text-cyan-200 font-bold" : "text-amber-200 font-bold"}>{warrantyRoleLabel}</span>
                {warrantyInfo?.role === "current" ? (
                  <span className="text-slate-300"> · Acc hiện tại của đơn</span>
                ) : latestWarrantyTarget ? (
                  <span className="text-slate-300"> · Hiện tại: <span className="font-semibold text-white">{latestWarrantyTarget}</span></span>
                ) : null}
              </div>
              {/* Warranty rounds */}
              <div className="space-y-1.5">
                {warrantyRounds.map((round, ri) => {
                  const isTarget = String(round?.toAccountId || "") === String(acc.id || "");
                  const isSource = String(round?.fromAccountId || "") === String(acc.id || "");
                  return (
                    <div key={ri} className={`rounded-md border px-2 py-1.5 ${
                      isTarget ? "border-cyan-400/30 bg-cyan-500/10"
                        : isSource ? "border-amber-400/30 bg-amber-500/10"
                        : "border-slate-700/60 bg-slate-950/40"
                    }`}>
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[9px] font-black uppercase tracking-[0.08em] text-white/90">
                          Lần {round?.sequence || ri + 1}
                        </span>
                        {isTarget && <span className="text-[9px] font-bold text-cyan-200">Acc này</span>}
                        {isSource && !isTarget && <span className="text-[9px] font-bold text-amber-200">Đã đổi ra</span>}
                      </div>
                      <div className="break-all leading-relaxed text-slate-200">
                        <span className="text-slate-400">{round?.fromUsername || round?.fromAccountId || "Không rõ"}</span>
                        <span className="mx-1 text-slate-500">→</span>
                        <span className="font-semibold text-white">{round?.toUsername || round?.toAccountId || "Không rõ"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 8. Users Section ── */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Khách ({visibleUserEntries.length})
              </span>
              {effectiveViewType === "package1" && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className={`font-bold ${(visibleUsers.length + reservationCount) >= 3 ? "text-red-400" : "text-emerald-400"}`}>
                    {Math.min(3, visibleUsers.length + reservationCount)}/3 slot
                  </span>
                  {reservationCount > 0 && (
                    <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">Giữ chỗ: {reservationCount}</Badge>
                  )}
                </div>
              )}
            </div>

            {/* Add user button */}
            {!isLockedFromManualSale && !showMarketplaceManagementCard && (
              <button
                onClick={() => onAddUser(acc.id)}
                className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700/70 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-600"
              >
                <UserPlus size={11} /> Thêm khách
              </button>
            )}

            {/* ── Market/warranty management card (for acc with marketplace user or warranty) ── */}
            {(showMarketplaceManagementCard || hasStoreWarrantyHold || displayPrimaryLabel) && (
              <div className="mb-3">
                {showMarketplaceManagementCard ? (
                  <div className={`rounded-xl border px-3 py-3 shadow-sm ${marketplaceCardCls}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/40">
                            <Shield size={12} />
                          </span>
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white">Đơn sàn</div>
                            <div className="mt-0.5 text-[10px] leading-relaxed text-slate-300">
                              {providerLabel} · {displayName || "Khách sàn"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${marketplaceChipCls}`}>
                        {marketplaceStatusLabel}
                      </span>
                    </div>

                    {/* Details table */}
                    <div className="space-y-1.5 text-[10px]">
                      {[
                        ["Order", datammoOrderId || "Không rõ"],
                        ["Khách sàn", displayName || "--"],
                        ["Acc đã bán", soldMarketplaceUsername || "--"],
                        ["Acc hiện tại", currentMarketplaceUsername || "--"],
                        ["Ngày vào", displayJoinedDate],
                      ].map(([label, val]) => (
                        <div key={label} className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">{label}</span>
                          <span className="font-semibold text-white">{val}</span>
                        </div>
                      ))}
                      {displayExpiryDate && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Hết hạn</span>
                          <span className={`font-semibold ${isExpired ? "text-red-300" : isNearExpiry ? "text-yellow-300" : "text-emerald-300"}`}>
                            {displayExpiryDate}
                          </span>
                        </div>
                      )}
                      {daysRemaining !== null && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-slate-400">Tình trạng</span>
                          <span className={`font-semibold ${isExpired ? "text-red-300" : isNearExpiry ? "text-yellow-300" : "text-cyan-200"}`}>
                            {isExpired ? `Hết hạn ${Math.abs(daysRemaining)} ngày` : `Còn ${daysRemaining} ngày`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Badges */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[9px] font-bold uppercase text-cyan-200">{providerLabel}</span>
                      <span className="rounded-full border border-white/10 bg-slate-950/50 px-2 py-1 text-[9px] font-bold uppercase text-white/80">Đã bán</span>
                      {warrantyCase && (
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase text-amber-200">
                          BH lần {warrantyRounds.length}
                        </span>
                      )}
                    </div>

                    {/* Warranty role info */}
                    {warrantyCase && (
                      <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 px-2.5 py-2 text-[10px] text-slate-200">
                        <div className="font-semibold text-white">{warrantyRoleLabel}</div>
                        {warrantyInfo?.role === "current" ? (
                          <div className="mt-1 text-slate-300">Acc này đang là acc hiện tại của đơn.</div>
                        ) : latestWarrantyTarget ? (
                          <div className="mt-1 text-slate-300">
                            Hiện tại đang thay bởi <span className="font-semibold text-white">{latestWarrantyTarget}</span>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className={`mt-3 grid gap-2 ${canOpenWarranty && hasActualManagedMarketplaceUser && (isExpired || isNearExpiry) ? "grid-cols-2" : "grid-cols-1"}`}>
                      {canOpenWarranty && (
                        <button
                          type="button"
                          onClick={() => onOpenWarranty(acc)}
                          className="rounded-lg bg-cyan-700 hover:bg-cyan-600 px-2.5 py-2 text-[11px] font-bold text-white transition-colors"
                        >
                          🛡 Bảo hành {providerLabel}
                        </button>
                      )}
                      {hasActualManagedMarketplaceUser && (isExpired || isNearExpiry) && (
                        <button
                          type="button"
                          onClick={() => onExtendUser(acc.id, primaryUserIndex, primaryUser)}
                          className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-2.5 py-2 text-[11px] font-bold text-white transition-colors"
                        >
                          Gia hạn
                        </button>
                      )}
                      <div className={`rounded-lg border border-slate-700 bg-slate-950/50 px-2.5 py-2 text-center text-[10px] text-slate-400 ${canOpenWarranty || (hasActualManagedMarketplaceUser && (isExpired || isNearExpiry)) ? "col-span-2" : ""}`}>
                        Acc đã bán qua sàn – không chuyển tay. Nếu cần đổi acc, dùng Bảo hành.
                      </div>
                    </div>
                  </div>
                ) : hasStoreWarrantyHold ? (
                  /* Store warranty hold display (no marketplace order) */
                  <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 px-3 py-2.5 text-[10px]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black uppercase tracking-[0.12em] text-amber-300 mb-1">Đang giữ BH web</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {(isExpired || isNearExpiry) && (
                            isExpired ? <AlertCircle size={13} className="text-red-400 shrink-0" />
                              : <AlertTriangle size={13} className="text-yellow-400 shrink-0" />
                          )}
                          <span className="font-semibold text-white">{displayPrimaryLabel}</span>
                          {displaySecondaryLabel && <span className="text-slate-400">{displaySecondaryLabel}</span>}
                        </div>
                        {displayJoinedDate !== "--" && <div className="mt-1 text-slate-400">Vào: {displayJoinedDate}</div>}
                        {displayExpiryDate && (
                          <div className={`mt-0.5 font-semibold ${isExpired ? "text-red-300" : isNearExpiry ? "text-yellow-300" : "text-emerald-300"}`}>
                            🕑 HH: {displayExpiryDate}
                            {daysRemaining !== null && (
                              <span className="ml-1">({isExpired ? `HH ${Math.abs(daysRemaining)}d` : `Còn ${daysRemaining}d`})</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* ── Regular user list ── */}
            <div className="space-y-1.5">
              {visibleUserEntries.map((entry) => {
                const { user, index, name } = entry;
                const daysUsed = (() => {
                  if (typeof user !== "object" || !user?.joinedAt) return null;
                  return Math.ceil((Date.now() - new Date(user.joinedAt)) / 86400000);
                })();
                const daysRem = getDaysRemainingFromUser(user);
                const isPastExpiry = daysRem !== null && daysRem <= 0;
                const isMarketUser = isDatammoManagedUser(user);
                const storeOrderId = getStoreOrderIdentityForAccountUser?.(acc, user);

                return (
                  <div
                    key={index}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-[10px] ${
                      isMarketUser ? "border-amber-700/40 bg-amber-900/15"
                        : isPastExpiry ? "border-red-800/40 bg-red-900/10"
                        : "border-slate-700/50 bg-slate-900/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <User size={11} className="text-slate-400 shrink-0" />
                      <span className={`font-semibold break-all ${isMarketUser ? "text-amber-200" : "text-white"}`}>{name}</span>
                      {daysUsed !== null && <span className="text-slate-500">{daysUsed}d đã dùng</span>}
                      {daysRem !== null && (
                        <span className={`font-bold ${daysRem <= 0 ? "text-red-400" : daysRem <= 7 ? "text-amber-400" : "text-emerald-400"}`}>
                          {daysRem <= 0 ? `Hết hạn ${Math.abs(daysRem)}d` : `Còn ${daysRem}d`}
                        </span>
                      )}
                      {storeOrderId && <Badge className="border-cyan-700/40 bg-cyan-900/20 text-cyan-300">Web</Badge>}
                      {isMarketUser && <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-200">Sàn</Badge>}
                    </div>
                    {/* Action buttons for regular users */}
                    {!isMarketUser && !showMarketplaceManagementCard && !isLockedByStoreWarrantyHold && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => onExtendUser(acc.id, index, user)} className="flex h-6 w-6 items-center justify-center rounded-md border border-emerald-700/50 bg-emerald-900/30 text-emerald-300 transition hover:bg-emerald-700/40" title="Gia hạn">
                          <Calendar size={10} />
                        </button>
                        {daysRem !== null && daysRem > 0 ? (
                          <button onClick={() => onMoveUser(acc.id, index, user)} className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-700/50 bg-amber-900/30 text-amber-300 transition hover:bg-amber-700/40" title="Chuyển khách">
                            <ArrowRightLeft size={10} />
                          </button>
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-600 cursor-not-allowed" title="Hết hạn – không chuyển">
                            <ArrowRightLeft size={10} />
                          </span>
                        )}
                        <button onClick={() => onEditUser(acc.id, index, user)} className="flex h-6 w-6 items-center justify-center rounded-md border border-blue-700/50 bg-blue-900/30 text-blue-300 transition hover:bg-blue-700/40" title="Sửa">
                          <Pencil size={10} />
                        </button>
                        <button onClick={() => onDeleteUser(acc.id, index, name)} className="flex h-6 w-6 items-center justify-center rounded-md border border-red-800/50 bg-red-900/20 text-red-400 transition hover:bg-red-800/40" title="Xóa">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                    {/* If marketplace user: show extend (if near expiry) but locked otherwise */}
                    {isMarketUser && (isExpired || isNearExpiry) && (
                      <button onClick={() => onExtendUser(acc.id, index, user)} className="flex h-6 items-center gap-1 px-2 rounded-md border border-emerald-700/50 bg-emerald-900/30 text-emerald-300 text-[10px] transition hover:bg-emerald-700/40" title="Gia hạn">
                        <Calendar size={10} /> Gia hạn
                      </button>
                    )}
                  </div>
                );
              })}
              {visibleUserEntries.length === 0 && !displayPrimaryLabel && (
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
  handleRunSelectedChatgptMailCheck,
  handleCopy,
  loadingStates = {},
  getActiveStoreReservationTraces,
  getActiveStoreReservationCount,
  getStoreWarrantyHoldInfo,
  getStoreOrderIdentityForAccountUser,
  buildChatgpt2faLiveUrl,
  buildChatgptCopyText,
  getChatgptCopyButtonText,
  getChatgptCopySuccessText,
  marketplaceTrackedAccountIds = new Set(),
  marketplaceTrackedAccountMap,
  datammoWarrantyCases = [],
  datammoOrderHistory = [],
  storeOrders = [],
  onTypeChange,
  onShelfChange,
  onOpenWarranty, // openWarrantyModal from App.jsx
}) {
  const [showFilters, setShowFilters] = useState(false);

  const pagination = chatgptAdminPagination || {
    page: 1, totalPages: 1, total: 0, limit: 10,
    summary: { tabs: {}, totalTypeTabs: {}, mailCheckTabs: {}, marketShelfTabs: {}, storeWarehouse: {} },
  };
  const summaryTabs = pagination.summary?.tabs || {};
  const totalTypeTabs = pagination.summary?.totalTypeTabs || {};
  const mailCheckTabs = pagination.summary?.mailCheckTabs || {};
  const marketShelfTabsSummary = pagination.summary?.marketShelfTabs || {};
  const storeWarehouse = pagination.summary?.storeWarehouse || {};

  const selectedIdSet = new Set(selectedChatgptIds.map((id) => String(id || "")));
  const allFilteredSelected = accounts.length > 0 && accounts.every((acc) => selectedIdSet.has(String(acc.id || "")));

  const handleToggleSelectAll = useCallback((checked) => {
    const ids = accounts.map((acc) => String(acc.id || ""));
    setSelectedChatgptIds((prev) => {
      const s = new Set(prev);
      ids.forEach((id) => checked ? s.add(id) : s.delete(id));
      return Array.from(s);
    });
  }, [accounts, setSelectedChatgptIds]);

  const handleToggleExpand = useCallback((id) => {
    setExpandedChatgptAccountId((prev) => String(prev || "") === String(id || "") ? "" : id);
  }, [setExpandedChatgptAccountId]);

  const handleToggleSelect = useCallback((id, checked) => {
    const key = String(id || "");
    setSelectedChatgptIds((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((v) => v !== key);
    });
  }, [setSelectedChatgptIds]);

  // Stats grid
  const pkg2 = storeWarehouse?.package2 || {};
  const pkg1 = storeWarehouse?.package1 || {};

  const statCards = [
    { label: "Tổng acc", value: summaryTabs.all ?? pagination.total, icon: Database, iconCls: "text-slate-400", accent: "border-slate-700/50 bg-slate-800/50" },
    { label: "Kho tổng", value: summaryTabs.total, icon: Package, iconCls: "text-blue-400", accent: "border-blue-700/30 bg-blue-900/15" },
    { label: "Kho market", value: summaryTabs.market, icon: ShoppingCart, iconCls: "text-emerald-400", accent: "border-emerald-700/30 bg-emerald-900/15" },
    { label: "Dưới 25 ngày", value: summaryTabs.short, icon: AlertTriangle, iconCls: "text-amber-400", accent: "border-amber-700/30 bg-amber-900/15" },
    { label: "Mail die", value: mailCheckTabs.died, icon: Mail, iconCls: "text-red-400", accent: "border-red-700/30 bg-red-900/10" },
    { label: "Gói 2 sẵn bán", value: pkg2.availableNow, sub: `Tổng: ${pkg2.existingAccounts ?? "—"} · Chuyển được: ${pkg2.convertibleAccounts ?? "—"}`, icon: Shield, iconCls: "text-violet-400", accent: "border-violet-700/30 bg-violet-900/15" },
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
    const items = []; let prev = 0;
    sorted.forEach((p) => { if (prev > 0 && p - prev > 1) items.push(`e-${prev}-${p}`); items.push(p); prev = p; });
    return items;
  };
  const visiblePages = buildVisiblePages();
  const pageStart = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const pageEnd = pagination.total > 0 ? Math.min(pagination.total, pageStart + accounts.length - 1) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white">Kho ChatGPT</h2>
          <p className="text-[12px] text-slate-400">Quản lý tài khoản ChatGPT – Gói 1, Gói 2, Kho market, Bảo hành</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => loadAdminChatgptAccounts({ silent: false, force: true })} disabled={chatgptAdminPageLoading} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60">
            <RotateCw size={13} className={chatgptAdminPageLoading ? "animate-spin" : ""} /> Tải lại
          </button>
          {selectedChatgptIds.length > 0 && (
            <button onClick={handleRunSelectedChatgptMailCheck} disabled={!!loadingStates.runChatgptMailCheck} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-700/60 bg-rose-900/30 px-3 py-2 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-800/40 disabled:opacity-60">
              {loadingStates.runChatgptMailCheck ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Đọc mail đã chọn
            </button>
          )}
          <button onClick={() => setShowImportGPTModal(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-violet-600 shadow-sm">
            <Upload size={13} /> Import
          </button>
          <button onClick={openAddModal} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-600 shadow-sm">
            <Plus size={13} /> Thêm acc
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((c) => <StatCard key={c.label} {...c} />)}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tài khoản, khách, đơn hàng, mã order..."
            className="w-full rounded-xl border border-slate-700 bg-slate-800/90 py-2 pl-8 pr-8 text-sm text-white placeholder-slate-500 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-600 transition"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${showFilters ? "border-slate-500 bg-slate-700 text-white" : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
        >
          <Filter size={12} /> Lọc nâng cao
        </button>
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {[
              { label: "Mail check", value: chatgptMailCheckFilter, set: setChatgptMailCheckFilter, options: [["all","Tất cả"],["died","Mail die"],["checked","Đã check"],["unchecked","Chưa check"]] },
              { label: "Khách hàng", value: chatgptCustomerFilter, set: setChatgptCustomerFilter, options: [["all","Tất cả"],["with","Có khách"],["without","Không khách"]] },
              { label: "Hạn sử dụng", value: chatgptExpiryFilter, set: setChatgptExpiryFilter, options: [["all","Tất cả"],["expired","Đã hết hạn"],["under_15","Dưới 15 ngày"],["15_20","15–20 ngày"],["20_25","20–25 ngày"],["25_31","25–31 ngày"],["no_expiry","Không có hạn"]] },
            ].map(({ label, value, set, options }) => (
              <div key={label}>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">{label}</label>
                <select value={value} onChange={(e) => set(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white outline-none">
                  {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
            {gptSubTab === "market" && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Kênh bán</label>
                <select value={soldPackage2ProviderFilter} onChange={(e) => setSoldPackage2ProviderFilter(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white outline-none">
                  <option value="all">Tất cả kênh</option>
                  <option value="datammo">Datammo</option>
                  <option value="shopmini">Shopmini</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500">Khoảng hạn (ngày):</span>
            <input type="number" value={chatgptExpiryMin} onChange={(e) => setChatgptExpiryMin(e.target.value)} placeholder="Từ" className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none" />
            <span className="text-slate-500">–</span>
            <input type="number" value={chatgptExpiryMax} onChange={(e) => setChatgptExpiryMax(e.target.value)} placeholder="Đến" className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-500">Ngày tạo:</span>
            <input type="date" value={chatgptCreatedFrom} onChange={(e) => setChatgptCreatedFrom(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none" />
            <span className="text-slate-500">–</span>
            <input type="date" value={chatgptCreatedTo} onChange={(e) => setChatgptCreatedTo(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={applyCurrentChatgptDraftFilters} disabled={chatgptAdminPageLoading} className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-cyan-600 disabled:opacity-60">
              <Check size={12} /> Áp dụng
            </button>
            <button onClick={resetChatgptAdminFilters} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-700">
              <X size={12} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* Main tab bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700/50 pb-2">
        {[
          { key: "all", label: "Tất cả", count: summaryTabs.all },
          { key: "total", label: "Kho tổng", count: summaryTabs.total, icon: Package },
          { key: "market", label: "Kho market", count: summaryTabs.market, icon: ShoppingCart },
        ].map(({ key, label, count, icon: Icon }) => (
          <PillTab key={key} active={gptSubTab === key} count={count}
            color={key === "market" ? "bg-emerald-600" : key === "total" ? "bg-blue-600" : "bg-slate-600"}
            onClick={() => { setGptSubTab(key); void requestChatgptAdminPage({ page: 1, subTab: key }); }}>
            {Icon && <Icon size={11} />}{label}
          </PillTab>
        ))}
      </div>

      {/* Sub tabs */}
      {gptSubTab === "market" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">Trạng thái:</span>
          {[
            { key: "all", label: "Tất cả", count: marketShelfTabsSummary.all },
            { key: "sold", label: "Đã bán", count: marketShelfTabsSummary.sold },
            { key: "soldDatammo", label: "Datammo", count: marketShelfTabsSummary.soldDatammo },
            { key: "soldShopmini", label: "Shopmini", count: marketShelfTabsSummary.soldShopmini },
          ].map(({ key, label, count }) => (
            <PillTab key={key} active={package2ShelfTab === key} count={count}
              color={key !== "all" ? "bg-amber-600" : "bg-slate-600"}
              onClick={() => { setPackage2ShelfTab(key); void requestChatgptAdminPage({ page: 1, package2ShelfTab: key }); }}>
              {label}
            </PillTab>
          ))}
        </div>
      )}
      {gptSubTab === "total" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">Loại gói:</span>
          {[
            { key: "all", label: "Tất cả", count: totalTypeTabs.all },
            { key: "package1", label: "Gói 1", count: totalTypeTabs.package1 },
            { key: "package2", label: "Gói 2", count: totalTypeTabs.package2 },
            { key: "unassigned", label: "Chưa chọn", count: totalTypeTabs.unassigned },
          ].map(({ key, label, count }) => (
            <PillTab key={key} active={chatgptTotalTypeTab === key} count={count}
              color={key === "package1" ? "bg-blue-600" : key === "package2" ? "bg-violet-600" : "bg-slate-600"}
              onClick={() => { setChatgptTotalTypeTab(key); void requestChatgptAdminPage({ page: 1, totalType: key }); }}>
              {label}
            </PillTab>
          ))}
        </div>
      )}

      {/* Mail filter bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold text-slate-500">Mail:</span>
        {[
          { key: "all", label: "Tất cả", count: mailCheckTabs.all },
          { key: "died", label: "Mail die", count: mailCheckTabs.died },
          { key: "checked", label: "Đã check", count: mailCheckTabs.checked },
          { key: "unchecked", label: "Chưa check", count: mailCheckTabs.unchecked },
        ].map(({ key, label, count }) => (
          <PillTab key={key} active={chatgptMailCheckFilter === key} count={count}
            color={key === "died" ? "bg-red-600" : key === "checked" ? "bg-emerald-600" : "bg-slate-600"}
            onClick={() => { setChatgptMailCheckFilter(key); void requestChatgptAdminPage({ page: 1, mailCheckFilter: key }); }}>
            {label}
          </PillTab>
        ))}
      </div>

      {/* Pagination bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700/50 bg-slate-800/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">{pagination.total} acc</span>
          {pagination.total > 0 && <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">{pageStart}–{pageEnd} / {pagination.total}</span>}
          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">Trang {pagination.page}/{pagination.totalPages}</span>
          {chatgptAdminPageLoading && <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-cyan-200"><Loader2 size={11} className="animate-spin" /> Đang tải</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5">
            <span className="text-[10px] text-slate-500 mr-1">Trang:</span>
            {[5, 10, 20, 30, 50].map((n) => (
              <button key={n} onClick={() => requestChatgptAdminPage({ page: 1, limit: n })} disabled={pagination.limit === n}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${pagination.limit === n ? "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/30" : "text-slate-400 hover:text-white"}`}>
                {n}
              </button>
            ))}
          </div>
          <button onClick={() => requestChatgptAdminPage({ page: Math.max(1, pagination.page - 1) })} disabled={pagination.page <= 1 || chatgptAdminPageLoading} className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50">« Trước</button>
          <div className="flex items-center gap-1">
            {visiblePages.map((p) => typeof p === "string"
              ? <span key={p} className="px-1 text-[11px] text-slate-600">…</span>
              : <button key={p} onClick={() => requestChatgptAdminPage({ page: p })} disabled={p === pagination.page || chatgptAdminPageLoading}
                  className={`min-w-[30px] rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${p === pagination.page ? "cursor-default border-violet-400/60 bg-violet-500/20 text-violet-200" : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white"}`}>
                  {p}
                </button>
            )}
          </div>
          <button onClick={() => requestChatgptAdminPage({ page: Math.min(pagination.totalPages, pagination.page + 1) })} disabled={pagination.page >= pagination.totalPages || chatgptAdminPageLoading} className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/15 disabled:opacity-50">Sau »</button>
        </div>
      </div>

      {/* Select all + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={allFilteredSelected} onChange={(e) => handleToggleSelectAll(e.target.checked)} className="h-4 w-4 cursor-pointer accent-emerald-500" title="Chọn tất cả" />
          <span className="text-[11px] text-slate-400">Đã chọn <strong className="text-white">{selectedChatgptIds.length}</strong> acc</span>
          {selectedChatgptIds.length > 0 && <button onClick={() => setSelectedChatgptIds([])} className="text-[10px] text-slate-500 hover:text-slate-300 underline">Bỏ chọn</button>}
        </div>
        {selectedChatgptIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void handleBulkWarehouseChange("cheap")} disabled={!!loadingStates.bulkWarehouseMove} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-800/70 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-700 disabled:opacity-60">
              {loadingStates.bulkWarehouseMove ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />} → Kho market
            </button>
            <button onClick={() => void handleBulkWarehouseChange("none")} disabled={!!loadingStates.bulkWarehouseMove} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-800/70 px-3 py-1.5 text-[11px] font-bold text-blue-200 transition hover:bg-blue-700 disabled:opacity-60">
              {loadingStates.bulkWarehouseMove ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />} → Kho tổng
            </button>
            <button onClick={handleBulkDeleteChatgpt} className="inline-flex items-center gap-1.5 rounded-xl bg-red-800/60 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-700/70">
              <Trash2 size={12} /> Xóa đã chọn
            </button>
          </div>
        )}
      </div>

      {/* Account list */}
      <div className="space-y-2">
        {chatgptAdminPageLoading && accounts.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 size={20} className="animate-spin" /><span>Đang tải...</span>
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
            marketplaceTrackedAccountMap={marketplaceTrackedAccountMap}
            datammoWarrantyCases={datammoWarrantyCases}
            datammoOrderHistory={datammoOrderHistory}
            storeOrders={storeOrders}
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
            onOpenWarranty={onOpenWarranty}
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

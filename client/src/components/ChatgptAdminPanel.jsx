/**
 * ChatgptAdminPanel.jsx
 * Premium UI component for ChatGPT account management.
 * All business logic stays in App.jsx — this is purely presentation layer.
 */
import { useState, useMemo, useCallback, memo } from "react";
import {
  RefreshCw, Search, X, Plus, Upload, Trash2, Copy, ExternalLink,
  Mail, Pencil, ArrowRightLeft, RotateCw, Lock, Globe, AlertCircle,
  AlertTriangle, Calendar, ChevronLeft, ChevronRight, Loader2,
  Filter, CheckSquare, Square, BarChart2, Package, Shield,
  ShoppingBag, Zap, TrendingUp, Users, Clock, CheckCircle,
  ChevronDown, ChevronUp, Eye, EyeOff, Flame, Activity,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizeChatgptAccountType = (v) =>
  ["package1", "package2", "unassigned"].includes(String(v || "").trim())
    ? String(v).trim()
    : "unassigned";

const normalizePackage2Shelf = (v) =>
  v === "cheap" ? "cheap" : v === "main" ? "main" : "none";

const isChatgptMarketWarehouse = (acc = {}) =>
  ["package1","package2","unassigned",""].includes(String(acc?.type||"").trim()) &&
  normalizePackage2Shelf(acc?.package2Shelf) === "cheap";

const normalizeChatgptMailCheckStatus = (v) => {
  const n = String(v || "").trim().toLowerCase();
  if (n === "died") return "died";
  if (n === "checked") return "checked";
  if (n === "unchecked") return "unchecked";
  return "unchecked";
};

const getAccountDaysRemaining = (acc = {}) => {
  if (!acc?.expiredAt) return null;
  const ms = new Date(acc.expiredAt).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
};

const formatDateShort = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
};

const formatDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${hhmm} · ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear().toString().slice(-2)}`;
};

const getUserName = (user) =>
  typeof user === "object" && user !== null
    ? String(user.name || "").trim()
    : String(user || "").trim();

const getUserDate = (user) => {
  if (!user || typeof user !== "object") return "";
  const joined = String(user.joinedAt || "").trim();
  const expired = String(user.expiredAt || "").trim();
  if (!joined && !expired) return "";
  return [joined && formatDateShort(joined), expired && formatDateShort(expired)]
    .filter(Boolean).join(" → ");
};

const getJoinerDaysRemaining = (user) => {
  if (!user?.expiredAt) return null;
  const ms = new Date(user.expiredAt).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
};

// ─── Availability State Config ───────────────────────────────────────────────

const AVAIL_STATE_CONFIG = {
  sellable: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
    dot: "bg-emerald-400",
    label: "Sẵn bán",
    icon: CheckCircle,
  },
  assigned_to_store_order: {
    border: "border-violet-500/40",
    bg: "bg-violet-500/5",
    badge: "border-violet-500/40 bg-violet-500/15 text-violet-200",
    dot: "bg-violet-400",
    label: "Có khách",
    icon: Users,
  },
  reserved_for_pending_store_order: {
    border: "border-cyan-500/40",
    bg: "bg-cyan-500/5",
    badge: "border-cyan-500/40 bg-cyan-500/15 text-cyan-200",
    dot: "bg-cyan-400",
    label: "Giữ chỗ",
    icon: Lock,
  },
  warranty_hold_source: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    badge: "border-amber-500/40 bg-amber-500/15 text-amber-200",
    dot: "bg-amber-400",
    label: "Bảo hành",
    icon: Shield,
  },
  expired_unusable: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    badge: "border-red-500/30 bg-red-500/10 text-red-300",
    dot: "bg-red-500",
    label: "Hết hạn",
    icon: AlertCircle,
  },
  busy_in_marketplace: {
    border: "border-emerald-600/40",
    bg: "bg-emerald-600/5",
    badge: "border-emerald-600/40 bg-emerald-600/15 text-emerald-200",
    dot: "bg-emerald-500",
    label: "Đơn sàn",
    icon: ShoppingBag,
  },
  busy_in_warranty_replacement: {
    border: "border-orange-500/40",
    bg: "bg-orange-500/5",
    badge: "border-orange-500/40 bg-orange-500/15 text-orange-200",
    dot: "bg-orange-400",
    label: "Thay thế",
    icon: ArrowRightLeft,
  },
};

const getAvailConfig = (state) =>
  AVAIL_STATE_CONFIG[state] || {
    border: "border-slate-700/60",
    bg: "bg-slate-900/30",
    badge: "border-slate-600 bg-slate-800 text-slate-300",
    dot: "bg-slate-500",
    label: state || "Không rõ",
    icon: Activity,
  };

// ─── Sub-components ──────────────────────────────────────────────────────────

// Stat Card
const StatCard = memo(({ label, value, sub, tone, icon: Icon, onClick, active }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group relative overflow-hidden rounded-2xl border p-3 text-left transition-all duration-200 ${
      active
        ? `${tone.activeBorder} ${tone.activeBg} shadow-lg scale-[1.02]`
        : `${tone.border} ${tone.bg} hover:scale-[1.01] hover:shadow-md`
    }`}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${tone.label}`}>{label}</p>
        <p className={`mt-1 text-2xl font-black tabular-nums ${tone.value}`}>{value}</p>
        {sub && <p className={`mt-0.5 text-[10px] ${tone.sub}`}>{sub}</p>}
      </div>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.iconBg}`}>
        <Icon size={18} className={tone.iconColor} />
      </div>
    </div>
    {active && (
      <div className={`absolute inset-x-0 bottom-0 h-0.5 ${tone.activeLine}`} />
    )}
  </button>
));

// Filter Pill Button
const FilterPill = memo(({ label, active, onClick, count, dim }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all duration-150 ${
      active
        ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-100 shadow-sm shadow-indigo-500/10"
        : dim
        ? "border-slate-800 bg-slate-950/50 text-slate-600 hover:border-slate-700 hover:text-slate-400"
        : "border-slate-700/80 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-white"
    }`}
  >
    {label}
    {count !== undefined && count !== null && (
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${
        active ? "bg-indigo-400/30 text-indigo-100" : "bg-slate-800 text-slate-400"
      }`}>{count}</span>
    )}
  </button>
));

// Mail Check Badge
const MailBadge = memo(({ status }) => {
  const normalized = normalizeChatgptMailCheckStatus(status);
  if (normalized === "died") return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-300">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
      Mail Die
    </span>
  );
  if (normalized === "checked") return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300">
      ✓ OK
    </span>
  );
  return null;
});

// Type Badge
const TypeBadge = memo(({ type, effectiveType }) => {
  const t = normalizeChatgptAccountType(effectiveType || type);
  if (t === "package1") return (
    <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-200">
      Gói 1
    </span>
  );
  if (t === "package2") return (
    <span className="rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-fuchsia-200">
      Gói 2
    </span>
  );
  return (
    <span className="rounded-full border border-slate-600 bg-slate-800/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-400">
      Chưa chọn
    </span>
  );
});

// Joiner Row
const JoinerRow = memo(({ user, index, accId, isExpired: accExpired,
  onEdit, onDelete, onMove, onExtend, linkedStoreOrder }) => {
  const name = getUserName(user);
  const dateStr = getUserDate(user);
  const days = getJoinerDaysRemaining(user);
  const isJoinerExpired = days !== null && days <= 0;
  const isNearExpiry = days !== null && days > 0 && days <= 3;
  const displayName = name || linkedStoreOrder?.customerName || linkedStoreOrder?.orderId || "Khách";
  const subtitle = linkedStoreOrder?.orderId || "";

  return (
    <div className={`flex items-start justify-between gap-2 rounded-xl border p-2.5 transition-colors ${
      isJoinerExpired
        ? "border-red-800/50 bg-red-950/20"
        : isNearExpiry
        ? "border-amber-700/40 bg-amber-950/10"
        : "border-slate-700/50 bg-slate-900/40"
    }`}>
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-1.5 text-xs font-bold ${
          isJoinerExpired ? "text-red-400" : isNearExpiry ? "text-amber-300" : "text-white"
        }`}>
          {isJoinerExpired && <AlertCircle size={11} />}
          {isNearExpiry && !isJoinerExpired && <AlertTriangle size={11} />}
          <span className="truncate max-w-[160px]" title={displayName}>
            👤 {displayName}
          </span>
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate text-[10px] font-semibold text-cyan-300/80">{subtitle}</div>
        )}
        {dateStr && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
            <Calendar size={9} />
            <span>{dateStr}</span>
            {days !== null && (
              <span className={`font-bold ${
                isJoinerExpired ? "text-red-400"
                : isNearExpiry ? "text-amber-400"
                : days > 30 ? "text-purple-400"
                : "text-blue-400"
              }`}>
                ({isJoinerExpired ? `HH ${Math.abs(days)}d` : `+${days}d`})
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        {(isJoinerExpired || isNearExpiry) && (
          <button
            type="button"
            onClick={() => onExtend(accId, index, user)}
            className="rounded-lg bg-emerald-600/80 p-1.5 text-white transition hover:bg-emerald-500 hover:scale-105"
            title="Gia hạn"
          >
            <RotateCw size={12} />
          </button>
        )}
        {!isJoinerExpired && (
          <button
            type="button"
            onClick={() => onMove(accId, index, user)}
            className="rounded-lg bg-orange-600/80 p-1.5 text-white transition hover:bg-orange-500 hover:scale-105"
            title="Chuyển khách"
          >
            <ArrowRightLeft size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(accId, index, user)}
          className="rounded-lg bg-blue-600/80 p-1.5 text-white transition hover:bg-blue-500 hover:scale-105"
          title="Sửa"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(accId, index, name)}
          className="rounded-lg bg-red-600/80 p-1.5 text-white transition hover:bg-red-500 hover:scale-105"
          title="Xóa"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
});

// Slot Progress Bar (Package 1)
const SlotProgress = memo(({ current, reserved, max = 3 }) => {
  const total = Math.min(max, current + reserved);
  const full = total >= max;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        {Array.from({ length: max }, (_, i) => {
          const filled = i < current;
          const res = i >= current && i < current + reserved;
          return (
            <div
              key={i}
              className={`h-2 w-6 rounded-full transition-colors ${
                filled ? (full ? "bg-red-400" : "bg-indigo-400")
                : res ? "bg-cyan-400/70"
                : "bg-slate-700"
              }`}
            />
          );
        })}
      </div>
      <span className={`text-[10px] font-black tabular-nums ${full ? "text-red-400" : "text-slate-400"}`}>
        {total}/{max}
      </span>
    </div>
  );
});

// Account Card
const AccountCard = memo(({
  acc,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
  onCopy,
  onAddUser,
  onEditUser,
  onDeleteUser,
  onMoveUser,
  onExtendUser,
  onRunMailCheck,
  onFocusHighlight,
  visibleUserEntries,
  activeStoreReservationCount,
  activeStoreReservationTraces,
  storeWarrantyHoldInfo,
  loadingMailCheck,
  marketplaceTrackedAccountIds,
  getStoreOrderIdentityForAccountUser,
  buildChatgpt2faLiveUrl,
  buildChatgptCopyText,
  getChatgptCopyButtonText,
  getChatgptCopySuccessText,
}) => {
  const [showCredentials, setShowCredentials] = useState(false);
  const availConfig = getAvailConfig(acc?.currentAccountState?.availabilityState || acc?.availabilityState);
  const days = getAccountDaysRemaining(acc);
  const isExpired = acc?.currentAccountState?.isExpired || (days !== null && days <= 0);
  const mailStatus = normalizeChatgptMailCheckStatus(acc?.mailCheckStatus);
  const accType = normalizeChatgptAccountType(acc?.effectiveType || acc?.type);
  const hasUsers = visibleUserEntries.length > 0;
  const maxSlots = accType === "package1" ? 3 : 1;
  const canAddUser = !isExpired && (visibleUserEntries.length + activeStoreReservationCount) < maxSlots;
  const isMarket = isChatgptMarketWarehouse(acc);

  return (
    <div
      id={`chatgpt-acc-${acc.id}`}
      className={`group relative overflow-hidden rounded-2xl border transition-all duration-200 ${availConfig.border} ${availConfig.bg} ${
        selected ? "ring-2 ring-indigo-400/60 ring-offset-1 ring-offset-slate-950" : ""
      }`}
    >
      {/* Top Row */}
      <div className="flex items-start gap-2 p-3">
        {/* Checkbox */}
        <button
          type="button"
          onClick={() => onSelect(acc.id)}
          className="mt-0.5 shrink-0 text-slate-500 transition hover:text-indigo-400"
        >
          {selected
            ? <CheckSquare size={16} className="text-indigo-400" />
            : <Square size={16} />}
        </button>

        {/* Main Info */}
        <div className="min-w-0 flex-1">
          {/* Row 1: username + badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="cursor-pointer font-mono text-sm font-bold text-white hover:text-indigo-300 transition truncate max-w-[200px]"
              title={acc.username}
              onClick={() => onFocusHighlight && onFocusHighlight(acc.id)}
            >
              {acc.username}
            </span>
            {/* Availability Badge */}
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${availConfig.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${availConfig.dot}`} />
              {availConfig.label}
            </span>
            <TypeBadge type={acc.type} effectiveType={acc.effectiveType} />
            <MailBadge status={acc.mailCheckStatus} />
            {isMarket && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-600/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300">
                <Globe size={8} /> Market
              </span>
            )}
          </div>

          {/* Row 2: expiry + user slots */}
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {/* Expiry */}
            {acc.expiredAt ? (
              <div className={`flex items-center gap-1 text-[10px] ${
                isExpired ? "text-red-400" : days !== null && days <= 7 ? "text-amber-400" : "text-slate-400"
              }`}>
                <Calendar size={9} />
                <span>{formatDateShort(acc.expiredAt)}</span>
                {days !== null && (
                  <span className="font-bold">
                    {isExpired ? `(HH ${Math.abs(days)}d)` : `(+${days}d)`}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-slate-600">Không có hạn</span>
            )}

            {/* Slot Progress */}
            {accType === "package1" && (
              <SlotProgress
                current={visibleUserEntries.length}
                reserved={activeStoreReservationCount}
                max={3}
              />
            )}
            {accType === "package2" && (
              <SlotProgress
                current={visibleUserEntries.length}
                reserved={activeStoreReservationCount}
                max={1}
              />
            )}

            {/* Store reservation badge */}
            {activeStoreReservationCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-600/40 bg-cyan-600/10 px-2 py-0.5 text-[9px] font-bold text-cyan-200">
                <Lock size={8} /> Giữ chỗ {activeStoreReservationCount}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {canAddUser && (
            <button
              type="button"
              onClick={() => onAddUser(acc.id)}
              className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 p-1.5 text-indigo-300 transition hover:bg-indigo-500/25 hover:text-white"
              title="Thêm khách"
            >
              <Plus size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onCopy(buildChatgptCopyText(acc), getChatgptCopySuccessText(acc))}
            className="rounded-lg border border-slate-700 bg-slate-800/60 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white"
            title={getChatgptCopyButtonText(acc)}
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(acc)}
            className="rounded-lg border border-slate-700 bg-slate-800/60 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white"
            title="Sửa"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(acc)}
            className="rounded-lg border border-red-700/40 bg-red-900/10 p-1.5 text-red-400 transition hover:bg-red-700/20 hover:text-red-300"
            title="Xóa"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            onClick={() => onToggleExpand(acc.id)}
            className="rounded-lg border border-slate-700 bg-slate-800/60 p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white"
            title={expanded ? "Thu gọn" : "Mở rộng"}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-slate-800/60 p-3 space-y-3">
          {/* Credentials */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/50 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Thông tin đăng nhập</span>
              <button
                type="button"
                onClick={() => setShowCredentials(v => !v)}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400 transition hover:text-white"
              >
                {showCredentials ? <EyeOff size={10} /> : <Eye size={10} />}
                {showCredentials ? "Ẩn" : "Hiện"}
              </button>
            </div>

            {/* Username */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-12 text-[10px] font-semibold uppercase tracking-wider text-slate-500">TK</span>
              <span className="rounded-lg bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-white break-all">
                {acc.username}
              </span>
            </div>

            {/* Password */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-12 text-[10px] font-semibold uppercase tracking-wider text-slate-500">MK</span>
              <span className="rounded-lg bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-white break-all">
                {showCredentials ? acc.password : "••••••••••"}
              </span>
              <button
                onClick={() => onCopy(acc.password, "Đã copy Mật khẩu")}
                className="rounded-lg bg-slate-700 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-slate-600"
              >
                <Copy size={10} />
              </button>
            </div>

            {/* OTP */}
            {acc.otpSecret && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-12 text-[10px] font-semibold uppercase tracking-wider text-slate-500">2FA</span>
                <span className="rounded-lg bg-slate-800 px-2 py-1 font-mono text-xs font-bold text-cyan-200 break-all">
                  {showCredentials ? acc.otpSecret : "••••••••••••••••"}
                </span>
                <a
                  href={buildChatgpt2faLiveUrl(acc.otpSecret)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-cyan-700/80 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-cyan-600"
                >
                  <ExternalLink size={9} /> 2fa.live
                </a>
              </div>
            )}

            {/* Link */}
            {acc.link && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-12 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Mail</span>
                <a
                  href={acc.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-teal-700/80 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-teal-600"
                >
                  <Mail size={9} /> Mở Mail
                </a>
                <button
                  onClick={() => onCopy(acc.link, "Đã copy Link Mail")}
                  className="rounded-lg bg-slate-700 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-slate-600"
                >
                  <Copy size={10} />
                </button>
              </div>
            )}

            {/* Copy All */}
            <button
              onClick={() => onCopy(buildChatgptCopyText(acc), getChatgptCopySuccessText(acc))}
              className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600/70 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-indigo-500"
            >
              <Copy size={11} /> {getChatgptCopyButtonText(acc)}
            </button>
          </div>

          {/* Note */}
          {acc.note && !/^\[StoreWarrantyHold/i.test(acc.note) && (
            <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] italic text-amber-200">
              {acc.note}
            </div>
          )}

          {/* Mail Check */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-950/40 p-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Mail Check</span>
                <MailBadge status={acc.mailCheckStatus} />
                {acc.mailCheckLastCheckedAt && (
                  <span className="text-[10px] text-slate-500">
                    {formatDateTime(acc.mailCheckLastCheckedAt)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRunMailCheck(acc)}
                disabled={mailStatus === "died" || loadingMailCheck === String(acc?.id || "")}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMailCheck === String(acc?.id || "") ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : <Mail size={10} />}
                {mailStatus === "died" ? "Đã die" : "Đọc mail"}
              </button>
            </div>
            {acc.mailCheckLastSubject && (
              <div className="mt-2 space-y-1 text-[10px]">
                <div className="font-semibold text-white">{acc.mailCheckLastSubject}</div>
                <div className="text-slate-400">{acc.mailCheckLastSender || "--"}</div>
                {acc.mailCheckLastSnippet && (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-1.5 text-slate-300">
                    {acc.mailCheckLastSnippet}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Store Reservation Traces */}
          {activeStoreReservationTraces.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400">
                Đơn web đang giữ chỗ
              </div>
              {activeStoreReservationTraces.map((trace, i) => (
                <div
                  key={trace.orderId || i}
                  className="rounded-xl border border-cyan-700/40 bg-cyan-950/20 px-2.5 py-2 text-[10px]"
                >
                  <div className="font-bold text-cyan-100">{trace.orderId || "--"}</div>
                  {(trace.customerName || trace.customerEmail) && (
                    <div className="text-slate-300">{trace.customerName || trace.customerEmail}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Joiners */}
          {(hasUsers || accType !== "unassigned") && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  Khách ({visibleUserEntries.length}{accType === "package1" ? "/3" : "/1"})
                </span>
                {canAddUser && (
                  <button
                    type="button"
                    onClick={() => onAddUser(acc.id)}
                    className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-200 transition hover:bg-indigo-500/25"
                  >
                    + Thêm khách
                  </button>
                )}
                {!canAddUser && !isExpired && accType !== "unassigned" && (
                  <span className="text-[10px] font-bold text-red-400">Đã đầy</span>
                )}
              </div>
              {visibleUserEntries.length === 0 && accType !== "unassigned" && (
                <div className="text-[10px] italic text-slate-600">Chưa có khách</div>
              )}
              {visibleUserEntries.map(({ user, index }) => (
                <JoinerRow
                  key={index}
                  user={user}
                  index={index}
                  accId={acc.id}
                  isExpired={isExpired}
                  onEdit={onEditUser}
                  onDelete={onDeleteUser}
                  onMove={onMoveUser}
                  onExtend={onExtendUser}
                  linkedStoreOrder={getStoreOrderIdentityForAccountUser
                    ? getStoreOrderIdentityForAccountUser(acc, user)
                    : null}
                />
              ))}
            </div>
          )}

          {/* Warranty Hold Info */}
          {storeWarrantyHoldInfo && (
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 px-2.5 py-2 text-[10px]">
              <div className="font-black uppercase tracking-wider text-amber-300">Bảo hành web</div>
              <div className="mt-1 text-amber-100">
                {storeWarrantyHoldInfo.customerName || storeWarrantyHoldInfo.customerEmail || "--"}
              </div>
              {storeWarrantyHoldInfo.orderId && (
                <div className="text-slate-400">Đơn: {storeWarrantyHoldInfo.orderId}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Filter Bar ──────────────────────────────────────────────────────────────

const FilterBar = memo(({
  searchQuery,
  onSearchChange,
  onApply,
  onReset,
  // Draft state
  gptSubTab, setGptSubTab,
  chatgptTotalTypeTab, setChatgptTotalTypeTab,
  package2ShelfTab, setPackage2ShelfTab,
  chatgptMailCheckFilter, setChatgptMailCheckFilter,
  chatgptCustomerFilter, setChatgptCustomerFilter,
  chatgptExpiryFilter, setChatgptExpiryFilter,
  chatgptExpiryMin, setChatgptExpiryMin,
  chatgptExpiryMax, setChatgptExpiryMax,
  chatgptCreatedFrom, setChatgptCreatedFrom,
  chatgptCreatedTo, setChatgptCreatedTo,
  soldPackage2ProviderFilter, setSoldPackage2ProviderFilter,
  // Applied state
  chatgptAppliedFilters,
  loading,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const hasActiveFilters = useMemo(() => {
    const f = chatgptAppliedFilters || {};
    return (
      (f.subTab && f.subTab !== "all") ||
      (f.totalType && f.totalType !== "all") ||
      (f.package2ShelfTab && f.package2ShelfTab !== "all") ||
      (f.mailCheckFilter && f.mailCheckFilter !== "all") ||
      (f.customerFilter && f.customerFilter !== "all") ||
      (f.expiryFilter && f.expiryFilter !== "all") ||
      f.expiryMin || f.expiryMax ||
      f.createdFrom || f.createdTo
    );
  }, [chatgptAppliedFilters]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/80 shadow-lg">
      {/* Search + Main Filter Row */}
      <div className="flex flex-wrap items-center gap-2 p-3">
        {/* Search */}
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/70 px-3 py-2 transition focus-within:border-indigo-500/60">
          <Search size={14} className="shrink-0 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm username, note, mail..."
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
          />
          {searchQuery && (
            <button type="button" onClick={() => onSearchChange("")}
              className="rounded-full p-0.5 text-slate-500 hover:text-white">
              <X size={12} />
            </button>
          )}
        </label>

        {/* Kho Tabs */}
        <div className="flex rounded-xl border border-slate-700/60 bg-slate-950/50 p-1 gap-0.5">
          {[
            { v: "all", l: "Tất cả" },
            { v: "total", l: "Kho Tổng" },
            { v: "market", l: "Kho Market" },
          ].map(({ v, l }) => (
            <button
              key={v}
              type="button"
              onClick={() => setGptSubTab(v)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                gptSubTab === v
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >{l}</button>
          ))}
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
            hasActiveFilters
              ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200"
              : "border-slate-700/60 bg-slate-900/60 text-slate-400 hover:text-white"
          }`}
        >
          <Filter size={12} />
          Bộ lọc
          {hasActiveFilters && (
            <span className="rounded-full bg-indigo-500 px-1.5 text-[9px] font-black text-white">●</span>
          )}
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {/* Apply / Reset */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-[11px] font-bold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            Áp dụng
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[11px] text-slate-400 transition hover:border-red-500/50 hover:text-red-300"
            >
              <X size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="border-t border-slate-800/60 px-3 pb-3 pt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* Type filter (for total kho) */}
          {gptSubTab === "total" && (
            <div>
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Loại gói</div>
              <div className="flex flex-wrap gap-1">
                {[
                  { v: "all", l: "Tất cả" },
                  { v: "package1", l: "Gói 1" },
                  { v: "package2", l: "Gói 2" },
                  { v: "unassigned", l: "Chưa chọn" },
                ].map(({ v, l }) => (
                  <FilterPill key={v} label={l} active={chatgptTotalTypeTab === v}
                    onClick={() => setChatgptTotalTypeTab(v)} />
                ))}
              </div>
            </div>
          )}

          {/* Market shelf (for market kho) */}
          {gptSubTab === "market" && (
            <div>
              <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Trạng thái sàn</div>
              <div className="flex flex-wrap gap-1">
                {[
                  { v: "all", l: "Tất cả" },
                  { v: "sold", l: "Đã bán" },
                ].map(({ v, l }) => (
                  <FilterPill key={v} label={l} active={package2ShelfTab === v}
                    onClick={() => setPackage2ShelfTab(v)} />
                ))}
              </div>
              {package2ShelfTab === "sold" && (
                <div className="mt-1.5 flex gap-1">
                  {[
                    { v: "all", l: "Tất cả sàn" },
                    { v: "datammo", l: "Datammo" },
                    { v: "shopmini", l: "Shopmini" },
                  ].map(({ v, l }) => (
                    <FilterPill key={v} label={l} active={soldPackage2ProviderFilter === v}
                      onClick={() => setSoldPackage2ProviderFilter(v)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mail Check */}
          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Mail check</div>
            <div className="flex flex-wrap gap-1">
              {[
                { v: "all", l: "Tất cả" },
                { v: "died", l: "Mail Die" },
                { v: "checked", l: "Đã check" },
                { v: "unchecked", l: "Chưa check" },
              ].map(({ v, l }) => (
                <FilterPill key={v} label={l} active={chatgptMailCheckFilter === v}
                  onClick={() => setChatgptMailCheckFilter(v)} />
              ))}
            </div>
          </div>

          {/* Customer */}
          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Khách</div>
            <div className="flex flex-wrap gap-1">
              {[
                { v: "all", l: "Tất cả" },
                { v: "with", l: "Có khách" },
                { v: "without", l: "Không khách" },
              ].map(({ v, l }) => (
                <FilterPill key={v} label={l} active={chatgptCustomerFilter === v}
                  onClick={() => setChatgptCustomerFilter(v)} />
              ))}
            </div>
          </div>

          {/* Expiry */}
          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Hạn sử dụng</div>
            <div className="flex flex-wrap gap-1">
              {[
                { v: "all", l: "Tất cả" },
                { v: "expired", l: "Hết hạn" },
                { v: "under_15", l: "<15 ngày" },
                { v: "15_20", l: "15-20" },
                { v: "20_25", l: "20-25" },
                { v: "25_31", l: "25-31" },
                { v: "no_expiry", l: "Không hạn" },
              ].map(({ v, l }) => (
                <FilterPill key={v} label={l} active={chatgptExpiryFilter === v}
                  onClick={() => setChatgptExpiryFilter(v)} />
              ))}
            </div>
          </div>

          {/* Custom expiry range */}
          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Khoảng hạn (ngày)</div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Min"
                value={chatgptExpiryMin}
                onChange={(e) => setChatgptExpiryMin(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
              />
              <input
                type="number"
                placeholder="Max"
                value={chatgptExpiryMax}
                onChange={(e) => setChatgptExpiryMax(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Created range */}
          <div>
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Ngày tạo</div>
            <div className="flex gap-2">
              <input type="date" value={chatgptCreatedFrom}
                onChange={(e) => setChatgptCreatedFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500" />
              <input type="date" value={chatgptCreatedTo}
                onChange={(e) => setChatgptCreatedTo(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-indigo-500" />
            </div>
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="border-t border-slate-800/60 px-3 py-2 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-slate-500">Đang lọc:</span>
          {chatgptAppliedFilters?.subTab && chatgptAppliedFilters.subTab !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
              Kho: {chatgptAppliedFilters.subTab}
              <button onClick={() => { setGptSubTab("all"); setTimeout(onApply, 0); }}><X size={9}/></button>
            </span>
          )}
          {chatgptAppliedFilters?.mailCheckFilter && chatgptAppliedFilters.mailCheckFilter !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-200">
              Mail: {chatgptAppliedFilters.mailCheckFilter}
              <button onClick={() => { setChatgptMailCheckFilter("all"); setTimeout(onApply, 0); }}><X size={9}/></button>
            </span>
          )}
          {chatgptAppliedFilters?.expiryFilter && chatgptAppliedFilters.expiryFilter !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              Hạn: {chatgptAppliedFilters.expiryFilter}
              <button onClick={() => { setChatgptExpiryFilter("all"); setTimeout(onApply, 0); }}><X size={9}/></button>
            </span>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Bulk Action Bar ─────────────────────────────────────────────────────────

const BulkActionBar = memo(({
  count,
  onClearSelection,
  onBulkDelete,
  onBulkChangeWarehouse,
  onSelectAll,
  totalOnPage,
}) => {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-600/80 bg-slate-900/95 px-4 py-3 shadow-2xl shadow-slate-950/60 backdrop-blur-md">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <CheckSquare size={16} className="text-indigo-400" />
          <span>{count} acc</span>
        </div>
        <div className="mx-2 h-5 w-px bg-slate-700" />
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Chọn trang
        </button>
        <button
          type="button"
          onClick={onBulkChangeWarehouse}
          className="rounded-lg border border-indigo-500/50 bg-indigo-500/20 px-3 py-1.5 text-[11px] font-semibold text-indigo-200 transition hover:bg-indigo-500/30"
        >
          Đổi kho
        </button>
        <button
          type="button"
          onClick={onBulkDelete}
          className="rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-1.5 text-[11px] font-semibold text-red-300 transition hover:bg-red-500/25"
        >
          <Trash2 size={12} className="inline mr-1" />
          Xóa ({count})
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
});

// ─── Pagination ──────────────────────────────────────────────────────────────

const Pagination = memo(({ pagination, onPageChange, loading }) => {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total, limit } = pagination;

  const pages = useMemo(() => {
    const arr = [];
    const show = 5;
    let start = Math.max(1, page - Math.floor(show / 2));
    let end = Math.min(totalPages, start + show - 1);
    if (end - start < show - 1) start = Math.max(1, end - show + 1);
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/70 px-4 py-3">
      <div className="text-[11px] text-slate-400">
        Tổng <span className="font-bold text-white">{total}</span> acc ·
        Trang <span className="font-bold text-white">{page}</span>/{totalPages}
        · {limit} / trang
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
          className="rounded-xl border border-slate-700 p-1.5 text-slate-400 transition hover:border-slate-500 hover:text-white disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        {pages[0] > 1 && (
          <>
            <button type="button" onClick={() => onPageChange(1)}
              className="rounded-xl border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-white">1</button>
            {pages[0] > 2 && <span className="text-slate-600 px-1">…</span>}
          </>
        )}
        {pages.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition ${
              p === page
                ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-100 cursor-default"
                : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
            }`}
          >{p}</button>
        ))}
        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && <span className="text-slate-600 px-1">…</span>}
            <button type="button" onClick={() => onPageChange(totalPages)}
              className="rounded-xl border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-white">{totalPages}</button>
          </>
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || loading}
          className="rounded-xl border border-slate-700 p-1.5 text-slate-400 transition hover:border-slate-500 hover:text-white disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
});

// ─── Main Panel ──────────────────────────────────────────────────────────────

export default function ChatgptAdminPanel({
  // Data
  accounts,
  chatgptAdminPagination,
  chatgptAdminPageLoading,
  dashboardSummary,
  datammoOrderHistory,
  datammoWarrantyCases,
  // Selection
  selectedChatgptIds,
  setSelectedChatgptIds,
  expandedChatgptAccountId,
  setExpandedChatgptAccountId,
  highlightedChatgptAccountId,
  // Filter draft state
  searchQuery,
  setSearchQuery,
  gptSubTab, setGptSubTab,
  chatgptTotalTypeTab, setChatgptTotalTypeTab,
  package2ShelfTab, setPackage2ShelfTab,
  chatgptMailCheckFilter, setChatgptMailCheckFilter,
  chatgptCustomerFilter, setChatgptCustomerFilter,
  chatgptExpiryFilter, setChatgptExpiryFilter,
  chatgptExpiryMin, setChatgptExpiryMin,
  chatgptExpiryMax, setChatgptExpiryMax,
  chatgptCreatedFrom, setChatgptCreatedFrom,
  chatgptCreatedTo, setChatgptCreatedTo,
  soldPackage2ProviderFilter, setSoldPackage2ProviderFilter,
  // Applied filters
  chatgptAppliedFilters,
  // Handlers
  applyCurrentChatgptDraftFilters,
  resetChatgptAdminFilters,
  requestChatgptAdminPage,
  loadAdminChatgptAccounts,
  // Account actions
  openAddModal,
  openEditModal,
  handleDeleteAccount,
  handleBulkDeleteChatgpt,
  handleBulkWarehouseChange,
  setShowImportGPTModal,
  // User/joiner actions
  openAddUserModal,
  openEditUserModal,
  handleDeleteUser,
  openMoveUserModal,
  handleExtendUser,
  handleRunOneChatgptMailCheck,
  // Utilities passed from App.jsx
  handleCopy,
  loadingStates,
  // Helpers passed from App.jsx
  getVisibleAccountUserEntries,
  getActiveStoreReservationTraces,
  getActiveStoreReservationCount,
  getStoreWarrantyHoldInfo,
  getStoreOrderIdentityForAccountUser,
  buildChatgpt2faLiveUrl,
  buildChatgptCopyText,
  getChatgptCopyButtonText,
  getChatgptCopySuccessText,
  marketplaceTrackedAccountIds,
  focusChatgptAccountById,
}) {
  // ── Derived stats ──────────────────────────────────────────────────────────
  const paginationSummary = chatgptAdminPagination?.summary || {};
  const totalAccs = Number(paginationSummary.total || chatgptAdminPagination?.total || 0);
  const mailDieCount = Number(paginationSummary.mailDiedCount || dashboardSummary?.chatgptMailDiedCount || 0);
  const package1Count = Number(paginationSummary.package1Count || 0);
  const package2Count = Number(paginationSummary.package2Count || 0);
  const marketCount = Number(paginationSummary.marketCount || 0);
  const expiringSoonCount = Number(paginationSummary.expiringSoonCount || 0);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleToggleSelect = useCallback((id) => {
    setSelectedChatgptIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, [setSelectedChatgptIds]);

  const handleToggleExpand = useCallback((id) => {
    setExpandedChatgptAccountId(prev => prev === id ? "" : id);
  }, [setExpandedChatgptAccountId]);

  const handleSelectAll = useCallback(() => {
    const allIds = accounts.map(a => a.id);
    setSelectedChatgptIds(prev =>
      prev.length === allIds.length ? [] : allIds
    );
  }, [accounts, setSelectedChatgptIds]);

  const handlePageChange = useCallback((p) => {
    void requestChatgptAdminPage({ page: p });
  }, [requestChatgptAdminPage]);

  const handleRefresh = useCallback(() => {
    void loadAdminChatgptAccounts({ force: true });
  }, [loadAdminChatgptAccounts]);

  // ── Stats tones ─────────────────────────────────────────────────────────────
  const statsConfig = [
    {
      label: "Tổng kho",
      value: totalAccs,
      sub: `${chatgptAdminPagination?.totalPages || 1} trang`,
      icon: Package,
      filter: null,
      tone: {
        border: "border-slate-700/60", bg: "bg-slate-900/60",
        activeBorder: "border-indigo-500/60", activeBg: "bg-indigo-500/10",
        activeLine: "bg-indigo-500",
        label: "text-slate-400", value: "text-white",
        sub: "text-slate-500", iconBg: "bg-slate-800", iconColor: "text-slate-300",
      },
    },
    {
      label: "Gói 1", value: package1Count,
      sub: "Chia sẻ",
      icon: Users,
      tone: {
        border: "border-blue-700/40", bg: "bg-blue-900/10",
        activeBorder: "border-blue-500/60", activeBg: "bg-blue-500/15",
        activeLine: "bg-blue-400",
        label: "text-blue-400/80", value: "text-blue-100",
        sub: "text-blue-400/60", iconBg: "bg-blue-900/40", iconColor: "text-blue-300",
      },
    },
    {
      label: "Gói 2", value: package2Count,
      sub: "Riêng tư",
      icon: Shield,
      tone: {
        border: "border-fuchsia-700/40", bg: "bg-fuchsia-900/10",
        activeBorder: "border-fuchsia-500/60", activeBg: "bg-fuchsia-500/15",
        activeLine: "bg-fuchsia-400",
        label: "text-fuchsia-400/80", value: "text-fuchsia-100",
        sub: "text-fuchsia-400/60", iconBg: "bg-fuchsia-900/40", iconColor: "text-fuchsia-300",
      },
    },
    {
      label: "Kho Market", value: marketCount,
      sub: "Datammo / Shopmini",
      icon: ShoppingBag,
      tone: {
        border: "border-emerald-700/40", bg: "bg-emerald-900/10",
        activeBorder: "border-emerald-500/60", activeBg: "bg-emerald-500/15",
        activeLine: "bg-emerald-400",
        label: "text-emerald-400/80", value: "text-emerald-100",
        sub: "text-emerald-400/60", iconBg: "bg-emerald-900/40", iconColor: "text-emerald-300",
      },
    },
    {
      label: "Mail Die", value: mailDieCount,
      sub: mailDieCount > 0 ? "⚠ Cần xử lý" : "Tất cả OK",
      icon: mailDieCount > 0 ? Flame : CheckCircle,
      tone: {
        border: mailDieCount > 0 ? "border-red-700/50" : "border-slate-700/40",
        bg: mailDieCount > 0 ? "bg-red-950/15" : "bg-slate-900/40",
        activeBorder: "border-red-500/60", activeBg: "bg-red-500/15",
        activeLine: "bg-red-400",
        label: mailDieCount > 0 ? "text-red-400/80" : "text-slate-400",
        value: mailDieCount > 0 ? "text-red-300" : "text-slate-400",
        sub: mailDieCount > 0 ? "text-red-400/60 animate-pulse" : "text-slate-600",
        iconBg: mailDieCount > 0 ? "bg-red-900/40" : "bg-slate-800",
        iconColor: mailDieCount > 0 ? "text-red-300" : "text-slate-500",
      },
    },
    {
      label: "Sắp hết hạn", value: expiringSoonCount,
      sub: "≤ 7 ngày",
      icon: Clock,
      tone: {
        border: expiringSoonCount > 0 ? "border-amber-700/40" : "border-slate-700/40",
        bg: expiringSoonCount > 0 ? "bg-amber-950/10" : "bg-slate-900/40",
        activeBorder: "border-amber-500/60", activeBg: "bg-amber-500/10",
        activeLine: "bg-amber-400",
        label: expiringSoonCount > 0 ? "text-amber-400/80" : "text-slate-400",
        value: expiringSoonCount > 0 ? "text-amber-200" : "text-slate-500",
        sub: "text-amber-400/60",
        iconBg: expiringSoonCount > 0 ? "bg-amber-900/30" : "bg-slate-800",
        iconColor: expiringSoonCount > 0 ? "text-amber-300" : "text-slate-500",
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-400/80">
            Quản lý
          </div>
          <h2 className="mt-0.5 text-xl font-black text-white flex items-center gap-2">
            <span className="text-2xl">🤖</span> ChatGPT Dashboard
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowImportGPTModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-[12px] font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            <Upload size={13} /> Import
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/50 bg-indigo-600/80 px-3 py-2 text-[12px] font-bold text-white shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-500"
          >
            <Plus size={13} /> Thêm acc
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={chatgptAdminPageLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-[12px] font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-60"
          >
            <RefreshCw size={13} className={chatgptAdminPageLoading ? "animate-spin" : ""} />
            {chatgptAdminPageLoading ? "Đang tải..." : "Tải lại"}
          </button>
        </div>
      </div>

      {/* ── Stats Grid ─────────────────────────────────────────────────────── */}
      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {statsConfig.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onApply={applyCurrentChatgptDraftFilters}
        onReset={resetChatgptAdminFilters}
        gptSubTab={gptSubTab} setGptSubTab={setGptSubTab}
        chatgptTotalTypeTab={chatgptTotalTypeTab} setChatgptTotalTypeTab={setChatgptTotalTypeTab}
        package2ShelfTab={package2ShelfTab} setPackage2ShelfTab={setPackage2ShelfTab}
        chatgptMailCheckFilter={chatgptMailCheckFilter} setChatgptMailCheckFilter={setChatgptMailCheckFilter}
        chatgptCustomerFilter={chatgptCustomerFilter} setChatgptCustomerFilter={setChatgptCustomerFilter}
        chatgptExpiryFilter={chatgptExpiryFilter} setChatgptExpiryFilter={setChatgptExpiryFilter}
        chatgptExpiryMin={chatgptExpiryMin} setChatgptExpiryMin={setChatgptExpiryMin}
        chatgptExpiryMax={chatgptExpiryMax} setChatgptExpiryMax={setChatgptExpiryMax}
        chatgptCreatedFrom={chatgptCreatedFrom} setChatgptCreatedFrom={setChatgptCreatedFrom}
        chatgptCreatedTo={chatgptCreatedTo} setChatgptCreatedTo={setChatgptCreatedTo}
        soldPackage2ProviderFilter={soldPackage2ProviderFilter} setSoldPackage2ProviderFilter={setSoldPackage2ProviderFilter}
        chatgptAppliedFilters={chatgptAppliedFilters}
        loading={chatgptAdminPageLoading}
      />

      {/* ── Account List ────────────────────────────────────────────────────── */}
      {chatgptAdminPageLoading && accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 py-20">
          <Loader2 size={28} className="animate-spin text-indigo-400" />
          <span className="text-sm text-slate-400">Đang tải danh sách acc...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 py-20">
          <Package size={28} className="text-slate-600" />
          <span className="text-sm text-slate-500">Không tìm thấy acc nào</span>
          <button
            type="button"
            onClick={resetChatgptAdminFilters}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-400 transition hover:border-slate-500 hover:text-white"
          >
            Bỏ bộ lọc
          </button>
        </div>
      ) : (
        <div className={`grid gap-3 transition-opacity duration-200 ${chatgptAdminPageLoading ? "opacity-60" : "opacity-100"}`}>
          {accounts.map((acc) => {
            const visibleUserEntries = getVisibleAccountUserEntries
              ? getVisibleAccountUserEntries(acc)
              : (Array.isArray(acc.users) ? acc.users : []).reduce((arr, user, idx) => {
                  const name = getUserName(user);
                  if (name) arr.push({ user, index: idx, name });
                  return arr;
                }, []);

            const activeTraces = getActiveStoreReservationTraces
              ? getActiveStoreReservationTraces(acc)
              : [];
            const reservationCount = getActiveStoreReservationCount
              ? getActiveStoreReservationCount(acc)
              : activeTraces.length;
            const warrantyHoldInfo = getStoreWarrantyHoldInfo
              ? getStoreWarrantyHoldInfo(acc)
              : null;

            return (
              <AccountCard
                key={acc.id}
                acc={acc}
                selected={selectedChatgptIds.includes(acc.id)}
                expanded={expandedChatgptAccountId === acc.id}
                onSelect={handleToggleSelect}
                onToggleExpand={handleToggleExpand}
                onEdit={openEditModal}
                onDelete={handleDeleteAccount}
                onCopy={handleCopy}
                onAddUser={openAddUserModal}
                onEditUser={openEditUserModal}
                onDeleteUser={handleDeleteUser}
                onMoveUser={openMoveUserModal}
                onExtendUser={handleExtendUser}
                onRunMailCheck={handleRunOneChatgptMailCheck}
                onFocusHighlight={focusChatgptAccountById}
                visibleUserEntries={visibleUserEntries}
                activeStoreReservationCount={reservationCount}
                activeStoreReservationTraces={activeTraces}
                storeWarrantyHoldInfo={warrantyHoldInfo}
                loadingMailCheck={loadingStates?.runChatgptMailCheckOne}
                marketplaceTrackedAccountIds={marketplaceTrackedAccountIds}
                getStoreOrderIdentityForAccountUser={getStoreOrderIdentityForAccountUser}
                buildChatgpt2faLiveUrl={buildChatgpt2faLiveUrl}
                buildChatgptCopyText={buildChatgptCopyText}
                getChatgptCopyButtonText={getChatgptCopyButtonText}
                getChatgptCopySuccessText={getChatgptCopySuccessText}
              />
            );
          })}
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      <Pagination
        pagination={chatgptAdminPagination}
        onPageChange={handlePageChange}
        loading={chatgptAdminPageLoading}
      />

      {/* ── Bulk Actions ────────────────────────────────────────────────────── */}
      <BulkActionBar
        count={selectedChatgptIds.length}
        onClearSelection={() => setSelectedChatgptIds([])}
        onSelectAll={handleSelectAll}
        onBulkDelete={handleBulkDeleteChatgpt}
        onBulkChangeWarehouse={handleBulkWarehouseChange}
        totalOnPage={accounts.length}
      />
    </div>
  );
}

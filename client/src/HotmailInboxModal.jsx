import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, Copy, X } from "lucide-react";

const SERVICE_STYLES = {
  ChatGPT: {
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    code: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
  },
  Microsoft: {
    badge: "border-sky-500/25 bg-sky-500/10 text-sky-200",
    code: "border-sky-500/20 bg-sky-500/10 text-sky-100",
  },
  Google: {
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    code: "border-amber-500/20 bg-amber-500/10 text-amber-100",
  },
  Facebook: {
    badge: "border-blue-500/25 bg-blue-500/10 text-blue-200",
    code: "border-blue-500/20 bg-blue-500/10 text-blue-100",
  },
  Other: {
    badge: "border-slate-700/80 bg-slate-800/80 text-slate-300",
    code: "border-slate-700/80 bg-slate-800/80 text-slate-100",
  },
};

const VARIANT_STYLES = {
  admin: {
    accent: "text-indigo-300",
    accentSoft: "border-indigo-500/20 bg-indigo-500/10",
    selection:
      "border-indigo-400/30 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(129,140,248,0.14)]",
    button:
      "border-indigo-400/20 bg-indigo-600 text-white hover:bg-indigo-500",
  },
  public: {
    accent: "text-cyan-200",
    accentSoft: "border-cyan-400/20 bg-cyan-400/10",
    selection:
      "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(103,232,249,0.14)]",
    button:
      "border-cyan-300/20 bg-cyan-500 text-slate-950 hover:bg-cyan-400",
  },
};

const extractCode = (text = "") => {
  const raw = String(text || "");
  const sixDigits = raw.match(/\b(\d{6})\b/);
  if (sixDigits) return sixDigits[1];
  const fourDigits = raw.match(/\b(\d{4})\b/);
  return fourDigits ? fourDigits[1] : null;
};

const classifyService = (sender = "", subject = "") => {
  const normalized = `${sender} ${subject}`.toLowerCase();
  if (normalized.includes("chatgpt") || normalized.includes("openai")) {
    return "ChatGPT";
  }
  if (
    normalized.includes("microsoft") ||
    normalized.includes("outlook") ||
    normalized.includes("hotmail")
  ) {
    return "Microsoft";
  }
  if (normalized.includes("google")) return "Google";
  if (normalized.includes("facebook") || normalized.includes("meta")) {
    return "Facebook";
  }
  return "Other";
};

const formatTime = (value = "") => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const getMessageId = (message = {}, index = 0) =>
  String(message?.id || message?.internetMessageId || `hotmail-message-${index}`);

const getMessageSender = (message = {}) =>
  String(message?.sender || message?.from || "(unknown)").trim();

const getMessageSubject = (message = {}) =>
  String(message?.subject || "(No subject)").trim() || "(No subject)";

const getMessageTime = (message = {}) =>
  String(
    message?.receivedDateTime || message?.receivedAt || message?.date || "",
  ).trim();

const getMessageTimestamp = (message = {}) => {
  const date = new Date(getMessageTime(message));
  const ts = date.getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const getMessageBody = (message = {}) =>
  String(
    message?.html_body ||
      message?.body ||
      message?.bodyPreview ||
      message?.preview ||
      "",
  ).trim();

const stripHtml = (value = "") =>
  String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isHtmlBody = (message = {}) => {
  const htmlBody = String(message?.html_body || "").trim();
  if (htmlBody) return true;
  const body = String(message?.body || "").trim();
  return /<[^>]+>/.test(body);
};

const buildIframeDoc = (html = "") => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 24px;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.65;
        color: #0f172a;
        background: #f8fafc;
        word-break: break-word;
      }
      img { max-width: 100%; height: auto; }
      a { color: #0f766e; }
    </style>
  </head>
  <body>${html}</body>
</html>`;

export default function HotmailInboxModal({
  email,
  messages,
  serviceFilter = null,
  onClose,
  variant = "admin",
  eyebrow = "Hotmail Inbox",
}) {
  const [copiedId, setCopiedId] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const palette = VARIANT_STYLES[variant] || VARIANT_STYLES.admin;

  const displayed = useMemo(() => {
    const sorted = Array.isArray(messages)
      ? [...messages].sort(
          (left, right) => getMessageTimestamp(right) - getMessageTimestamp(left),
        )
      : [];
    return serviceFilter
      ? sorted.filter(
          (message) =>
            classifyService(getMessageSender(message), message?.subject) ===
            serviceFilter,
        )
      : sorted;
  }, [messages, serviceFilter]);

  const selectedMessage = useMemo(() => {
    if (!displayed.length) return null;
    return (
      displayed.find(
        (message, index) => getMessageId(message, index) === selectedId,
      ) || displayed[0]
    );
  }, [displayed, selectedId]);

  useEffect(() => {
    if (!displayed.length) {
      setSelectedId("");
      return;
    }
    const stillExists = displayed.some(
      (message, index) => getMessageId(message, index) === selectedId,
    );
    if (!stillExists) {
      setSelectedId(getMessageId(displayed[0], 0));
    }
  }, [displayed, selectedId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const { body, documentElement } = document;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - documentElement.clientWidth,
    );
    const computedPaddingRight = Number.parseFloat(
      window.getComputedStyle(body).paddingRight || "0",
    );

    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
      touchAction: body.style.touchAction,
    };
    const previousHtmlStyles = {
      overflow: documentElement.style.overflow,
      overscrollBehavior: documentElement.style.overscrollBehavior,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.touchAction = "none";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
    }
    documentElement.style.overflow = "hidden";
    documentElement.style.overscrollBehavior = "contain";

    return () => {
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.paddingRight = previousBodyStyles.paddingRight;
      body.style.touchAction = previousBodyStyles.touchAction;
      documentElement.style.overflow = previousHtmlStyles.overflow;
      documentElement.style.overscrollBehavior =
        previousHtmlStyles.overscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const copyCode = (value, id) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  };

  const selectedMessageId = selectedMessage
    ? getMessageId(selectedMessage, 0)
    : "";
  const code = extractCode(
    selectedMessage
      ? `${getMessageSubject(selectedMessage)} ${getMessageBody(selectedMessage)}`
      : "",
  );
  const service = selectedMessage
    ? classifyService(
        getMessageSender(selectedMessage),
        selectedMessage?.subject,
      )
    : serviceFilter || "Other";
  const serviceStyle = SERVICE_STYLES[service] || SERVICE_STYLES.Other;
  const body = selectedMessage ? getMessageBody(selectedMessage) : "";
  const readableCode = code ? code.split("").join(" ") : "";
  const displayCount = `${displayed.length} email`;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div className="relative flex h-[min(94dvh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-900/95 shadow-[0_30px_80px_rgba(15,23,42,0.55)] animate-in zoom-in-95 duration-200 sm:h-[min(90dvh,860px)]">
        <div className="border-b border-slate-800/90 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`hidden rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] sm:inline-flex ${palette.accentSoft} ${palette.accent}`}
                >
                  {eyebrow}
                </span>
                {serviceFilter ? (
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${serviceStyle.badge}`}
                  >
                    {serviceFilter}
                  </span>
                ) : null}
              </div>

              <h2 className="mt-2 break-all text-[1.1rem] font-bold leading-tight text-white sm:text-[1.8rem]">
                {email}
              </h2>
              <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                {displayCount} · Mới nhất trước
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/80 text-slate-300 transition hover:border-white/20 hover:bg-slate-800 hover:text-white sm:h-11 sm:w-11"
              aria-label="Close inbox modal"
            >
              <X className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1">
          <aside className="flex min-h-0 flex-col border-b border-slate-800/80 bg-slate-950/35 lg:border-b-0 lg:border-r lg:bg-slate-950/45">
            <div className="min-h-0 flex gap-2 overflow-x-auto px-3 py-3 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:p-3">
              {displayed.length === 0 ? (
                <div className="flex min-h-[180px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 px-6 text-center text-sm text-slate-500">
                  Không có email nào trong inbox này.
                </div>
              ) : (
                displayed.map((message, index) => {
                  const messageId = getMessageId(message, index);
                  const messageCode = extractCode(
                    `${getMessageSubject(message)} ${getMessageBody(message)}`,
                  );
                  const messageService = classifyService(
                    getMessageSender(message),
                    message?.subject,
                  );
                  const messageStyle =
                    SERVICE_STYLES[messageService] || SERVICE_STYLES.Other;
                  const isSelected = messageId === selectedMessageId;

                  return (
                    <button
                      key={messageId}
                      type="button"
                      onClick={() => setSelectedId(messageId)}
                      className={`min-w-[212px] max-w-[72vw] shrink-0 rounded-xl border px-3 py-2.5 text-left transition lg:min-w-0 lg:max-w-none ${
                        isSelected
                          ? palette.selection
                          : "border-slate-800/90 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80"
                      }`}
                    >
                      <div className="line-clamp-2 text-[13px] font-semibold leading-5 text-white sm:text-sm">
                        {getMessageSubject(message)}
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`inline-flex rounded-full border px-1.5 py-0.5 font-semibold ${messageStyle.badge}`}
                          >
                            {messageService}
                          </span>
                          <span className="truncate">
                            {formatTime(getMessageTime(message))}
                          </span>
                        </div>

                        {messageCode ? (
                          <span
                            className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] ${messageStyle.code}`}
                          >
                            {messageCode}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-slate-950/20">
            {!selectedMessage ? (
              <div className="flex min-h-[220px] flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
                Chọn một email để xem chi tiết.
              </div>
            ) : (
              <>
                <div className="border-b border-slate-800/80 px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${serviceStyle.badge}`}
                        >
                          {service}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {formatTime(getMessageTime(selectedMessage))}
                        </span>
                      </div>

                      <h3 className="mt-2 text-xl font-bold leading-tight text-white sm:text-[1.9rem]">
                        {getMessageSubject(selectedMessage)}
                      </h3>

                      <div className="mt-2 text-sm text-slate-300">
                        {getMessageSender(selectedMessage)}
                      </div>
                    </div>

                    {code ? (
                      <div className="w-full rounded-xl border border-slate-800/90 bg-slate-900/80 p-3 lg:w-[220px] lg:shrink-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          OTP / CODE
                        </div>
                        <div className="mt-2 break-words font-mono text-xl font-black tracking-[0.22em] text-white sm:text-2xl">
                          {readableCode}
                        </div>
                        <button
                          type="button"
                          onClick={() => copyCode(code, selectedMessageId)}
                          className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition active:scale-95 ${palette.button}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedId === selectedMessageId ? "Đã copy" : "Copy code"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="min-h-0 flex-1 p-3 sm:p-4">
                  {isHtmlBody(selectedMessage) ? (
                    <iframe
                      title="hotmail-email-content"
                      sandbox="allow-same-origin"
                      className="h-full min-h-[260px] w-full rounded-xl border border-slate-800 bg-white"
                      srcDoc={buildIframeDoc(
                        String(
                          selectedMessage?.html_body ||
                            selectedMessage?.body ||
                            selectedMessage?.bodyPreview ||
                            "",
                        ),
                      )}
                    />
                  ) : (
                    <div className="h-full min-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/72 px-4 py-4 text-sm leading-6 text-slate-200 sm:px-5">
                      {stripHtml(body) || "(Không có nội dung)"}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(modalContent, document.body);
}

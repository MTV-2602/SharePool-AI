import { useEffect, useMemo, useState } from "react";
import { Clock3, Copy, MailOpen, User2, X } from "lucide-react";

const SERVICE_STYLES = {
  ChatGPT: {
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    glow: "from-emerald-500/20 to-teal-500/10",
  },
  Microsoft: {
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    glow: "from-sky-500/20 to-blue-500/10",
  },
  Google: {
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    glow: "from-amber-500/20 to-orange-500/10",
  },
  Facebook: {
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    glow: "from-blue-500/20 to-indigo-500/10",
  },
  Other: {
    badge: "border-slate-600 bg-slate-800/90 text-slate-300",
    glow: "from-slate-500/10 to-slate-800/0",
  },
};

const VARIANT_STYLES = {
  admin: {
    panel: "border-violet-400/20 bg-slate-950/95",
    accentRing: "ring-violet-300/10",
    accentText: "text-violet-200",
    accentSoft: "border-violet-500/20 bg-violet-500/10",
    button: "border-violet-400/30 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20",
    selection: "border-violet-400/30 bg-violet-500/10 shadow-[0_0_0_1px_rgba(167,139,250,0.25)]",
  },
  public: {
    panel: "border-cyan-300/20 bg-slate-950/95",
    accentRing: "ring-cyan-300/10",
    accentText: "text-cyan-200",
    accentSoft: "border-cyan-400/20 bg-cyan-400/10",
    button: "border-cyan-300/30 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20",
    selection: "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]",
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

const getMessageTime = (message = {}) =>
  String(message?.receivedDateTime || message?.receivedAt || message?.date || "").trim();

const getMessageBody = (message = {}) =>
  String(
    message?.html_body ||
      message?.body ||
      message?.bodyPreview ||
      message?.preview ||
      "",
  ).trim();

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
      :root {
        color-scheme: light;
      }
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
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        color: #0f766e;
      }
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
    const base = Array.isArray(messages) ? messages : [];
    return serviceFilter
      ? base.filter(
          (message) =>
            classifyService(getMessageSender(message), message?.subject) ===
            serviceFilter,
        )
      : base;
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

  const copyCode = (value, id) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  };

  const code = extractCode(
    selectedMessage
      ? `${selectedMessage?.subject || ""} ${getMessageBody(selectedMessage)}`
      : "",
  );
  const service = selectedMessage
    ? classifyService(getMessageSender(selectedMessage), selectedMessage?.subject)
    : serviceFilter || "Other";
  const serviceStyle = SERVICE_STYLES[service] || SERVICE_STYLES.Other;
  const body = selectedMessage ? getMessageBody(selectedMessage) : "";
  const previewText = selectedMessage
    ? String(selectedMessage?.bodyPreview || selectedMessage?.body || "").trim()
    : "";
  const readableCode = code ? code.split("").join(" ") : "";

  return (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-slate-950/82 p-3 backdrop-blur-md sm:p-5"
      onClick={onClose}
    >
      <div
        className={`grid h-[min(92vh,860px)] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[30px] border ${palette.panel} shadow-[0_30px_120px_rgba(0,0,0,0.65)] ring-1 ${palette.accentRing}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/90 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${palette.accentSoft} ${palette.accentText}`}>
              {eyebrow}
            </div>
            <h2 className="mt-3 break-all text-xl font-black tracking-tight text-white sm:text-2xl">
              {email}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{displayed.length} message{displayed.length === 1 ? "" : "s"}</span>
              {serviceFilter ? (
                <span className={`rounded-full border px-2.5 py-1 font-semibold ${serviceStyle.badge}`}>
                  {serviceFilter}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700/80 bg-slate-900/90 text-slate-300 transition hover:border-white/20 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-slate-800/80 bg-slate-950/65 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-800/70 px-4 py-3 text-xs text-slate-400">
              Chon email de xem noi dung va OTP nhanh hon.
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto p-3">
              {displayed.length === 0 ? (
                <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-slate-800 bg-slate-900/40 px-6 text-center text-sm text-slate-500">
                  Khong co email nao trong inbox nay.
                </div>
              ) : (
                displayed.map((message, index) => {
                  const messageId = getMessageId(message, index);
                  const messageCode = extractCode(
                    `${message?.subject || ""} ${getMessageBody(message)}`,
                  );
                  const messageService = classifyService(
                    getMessageSender(message),
                    message?.subject,
                  );
                  const messageStyle =
                    SERVICE_STYLES[messageService] || SERVICE_STYLES.Other;
                  const selected = messageId === getMessageId(selectedMessage, 0);
                  return (
                    <button
                      key={messageId}
                      type="button"
                      onClick={() => setSelectedId(messageId)}
                      className={`group w-full rounded-[24px] border p-4 text-left transition ${selected ? palette.selection : "border-slate-800/90 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm font-bold leading-6 text-white">
                            {message?.subject || "(No subject)"}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            <span className={`rounded-full border px-2 py-1 font-semibold ${messageStyle.badge}`}>
                              {messageService}
                            </span>
                            <span>{formatTime(getMessageTime(message))}</span>
                          </div>
                        </div>
                        {messageCode ? (
                          <div className={`rounded-2xl border bg-gradient-to-br px-3 py-2 font-mono text-sm font-black tracking-[0.28em] ${messageStyle.badge} ${messageStyle.glow}`}>
                            {messageCode}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[12px] text-slate-400">
                        <User2 className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{getMessageSender(message)}</span>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
                        {String(
                          message?.bodyPreview ||
                            message?.body ||
                            "Khong co noi dung xem truoc.",
                        ).trim()}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.08),transparent_42%)]">
            {!selectedMessage ? (
              <div className="flex min-h-[320px] flex-1 items-center justify-center px-6 text-center text-slate-500">
                Chon mot email ben trai de xem chi tiet.
              </div>
            ) : (
              <>
                <div className="border-b border-slate-800/80 px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${serviceStyle.badge}`}>
                          {service}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatTime(getMessageTime(selectedMessage))}
                        </span>
                      </div>
                      <h3 className="mt-3 text-xl font-black leading-8 text-white sm:text-2xl">
                        {selectedMessage?.subject || "(No subject)"}
                      </h3>
                      <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm text-slate-300">
                        <MailOpen className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        <span className="truncate">{getMessageSender(selectedMessage)}</span>
                      </div>
                    </div>

                    {code ? (
                      <div className={`min-w-[220px] rounded-[26px] border bg-gradient-to-br p-4 ${serviceStyle.badge} ${serviceStyle.glow}`}>
                        <div className="text-[11px] font-black uppercase tracking-[0.24em]">
                          OTP / Code
                        </div>
                        <div className="mt-3 font-mono text-3xl font-black tracking-[0.36em] text-white sm:text-[2.5rem]">
                          {readableCode}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            copyCode(code, getMessageId(selectedMessage, 0))
                          }
                          className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${palette.button}`}
                        >
                          <Copy className="h-4 w-4" />
                          {copiedId === getMessageId(selectedMessage, 0)
                            ? "Da copy"
                            : "Copy code"}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {!code && previewText ? (
                    <div className="mt-4 rounded-[24px] border border-slate-800 bg-slate-900/70 p-4 text-sm leading-7 text-slate-300">
                      {previewText}
                    </div>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 p-4 sm:p-5">
                  {isHtmlBody(selectedMessage) ? (
                    <iframe
                      title="hotmail-email-content"
                      sandbox="allow-same-origin"
                      className="h-full min-h-[340px] w-full rounded-[26px] border border-slate-800 bg-white shadow-inner"
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
                    <div className="h-full min-h-[340px] overflow-y-auto whitespace-pre-wrap rounded-[26px] border border-slate-800 bg-slate-900/80 p-5 text-sm leading-7 text-slate-200">
                      {body || "(Khong co noi dung)"}
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
}

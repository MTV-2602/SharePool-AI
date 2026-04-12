import { useEffect, useMemo, useState } from "react";
import { Clock3, Copy, MailOpen, X } from "lucide-react";

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
    badge: "border-slate-700 bg-slate-800/90 text-slate-300",
    code: "border-slate-700 bg-slate-800/90 text-slate-100",
  },
};

const VARIANT_STYLES = {
  admin: {
    shell: "border-violet-400/15 bg-[#060913]",
    divider: "border-slate-800/90",
    accent: "text-violet-200",
    accentSoft: "border-violet-500/20 bg-violet-500/10",
    selection:
      "border-violet-400/25 bg-violet-500/10 shadow-[0_0_0_1px_rgba(167,139,250,0.16)]",
    button:
      "border-violet-400/25 bg-violet-500/10 text-violet-50 hover:bg-violet-500/20",
  },
  public: {
    shell: "border-cyan-300/15 bg-[#050b13]",
    divider: "border-slate-800/90",
    accent: "text-cyan-200",
    accentSoft: "border-cyan-400/20 bg-cyan-400/10",
    selection:
      "border-cyan-300/25 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.14)]",
    button:
      "border-cyan-300/25 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20",
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
        padding: 28px;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 14px;
        line-height: 1.7;
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
    const sorted = Array.isArray(messages)
      ? [...messages].sort(
          (left, right) =>
            getMessageTimestamp(right) - getMessageTimestamp(left),
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
    ? classifyService(
        getMessageSender(selectedMessage),
        selectedMessage?.subject,
      )
    : serviceFilter || "Other";
  const serviceStyle = SERVICE_STYLES[service] || SERVICE_STYLES.Other;
  const body = selectedMessage ? getMessageBody(selectedMessage) : "";
  const readableCode = code ? code.split("").join(" ") : "";

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/86 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute inset-0 p-2 sm:p-4">
        <div
          className={`mx-auto flex h-full w-full max-w-[1480px] flex-col overflow-hidden rounded-[24px] border ${palette.shell} shadow-[0_24px_80px_rgba(2,6,23,0.55)] sm:rounded-[30px]`}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className={`sticky top-0 z-20 border-b ${palette.divider} bg-slate-950/94 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${palette.accentSoft} ${palette.accent}`}
                  >
                    {eyebrow}
                  </span>
                  {serviceFilter ? (
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${serviceStyle.badge}`}
                    >
                      {serviceFilter}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-3 break-all text-lg font-black tracking-tight text-white sm:text-[28px]">
                  {email}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{displayed.length} message{displayed.length === 1 ? "" : "s"}</span>
                  <span>Newest first</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white sm:h-11 sm:w-11"
                aria-label="Close inbox reader"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-1">
            <aside className="flex min-h-0 flex-col border-b border-slate-800/90 bg-slate-950/70 lg:border-b-0 lg:border-r">
              <div className="border-b border-slate-800/80 px-4 py-3 text-[11px] text-slate-500">
                Chon mail can doc. Danh sach dang sap moi nhat truoc.
              </div>

              <div className="min-h-0 flex gap-3 overflow-x-auto overscroll-contain p-3 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto">
                {displayed.length === 0 ? (
                  <div className="flex min-h-[220px] w-full items-center justify-center rounded-[22px] border border-dashed border-slate-800 bg-slate-950/80 px-6 text-center text-sm text-slate-500">
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
                    const isSelected =
                      messageId === getMessageId(selectedMessage, 0);

                    return (
                      <button
                        key={messageId}
                        type="button"
                        onClick={() => setSelectedId(messageId)}
                        className={`min-w-[265px] max-w-[86vw] shrink-0 rounded-[22px] border px-4 py-3 text-left transition lg:min-w-0 lg:max-w-none ${
                          isSelected
                            ? palette.selection
                            : "border-slate-800 bg-slate-950/85 hover:border-slate-700 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-sm font-semibold leading-6 text-slate-100">
                              {message?.subject || "(No subject)"}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${messageStyle.badge}`}
                              >
                                {messageService}
                              </span>
                              <span className="truncate">{getMessageSender(message)}</span>
                            </div>
                            <div className="mt-2 text-[11px] text-slate-500">
                              {formatTime(getMessageTime(message))}
                            </div>
                          </div>

                          {messageCode ? (
                            <div
                              className={`rounded-xl border px-2.5 py-1.5 font-mono text-[10px] font-black tracking-[0.18em] ${messageStyle.code}`}
                            >
                              {messageCode}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <section className="flex min-h-0 flex-col bg-slate-950/55">
              {!selectedMessage ? (
                <div className="flex min-h-[260px] flex-1 items-center justify-center px-6 text-center text-slate-500">
                  Chon mot mail ben trai de xem noi dung.
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-800/80 px-4 py-4 sm:px-6 sm:py-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 font-semibold ${serviceStyle.badge}`}
                          >
                            {service}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatTime(getMessageTime(selectedMessage))}
                          </span>
                        </div>

                        <h3 className="mt-3 text-xl font-black leading-8 text-white sm:text-3xl sm:leading-10">
                          {selectedMessage?.subject || "(No subject)"}
                        </h3>

                        <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-slate-800 bg-slate-900/85 px-3 py-2 text-xs text-slate-300 sm:text-sm">
                          <MailOpen className="h-4 w-4 flex-shrink-0 text-slate-400" />
                          <span className="truncate">{getMessageSender(selectedMessage)}</span>
                        </div>
                      </div>

                      {code ? (
                        <div className="w-full rounded-[22px] border border-slate-800 bg-slate-900/92 p-4 xl:w-[320px] xl:shrink-0">
                          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                            OTP / Code
                          </div>
                          <div className="mt-3 break-words font-mono text-2xl font-black tracking-[0.26em] text-white sm:text-[2.1rem]">
                            {readableCode}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyCode(code, getMessageId(selectedMessage, 0))
                            }
                            className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition ${palette.button}`}
                          >
                            <Copy className="h-4 w-4" />
                            {copiedId === getMessageId(selectedMessage, 0)
                              ? "Da copy"
                              : "Copy code"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 p-3 sm:p-5">
                    {isHtmlBody(selectedMessage) ? (
                      <iframe
                        title="hotmail-email-content"
                        sandbox="allow-same-origin"
                        className="h-full min-h-[280px] w-full rounded-[24px] border border-slate-800 bg-white sm:min-h-[420px]"
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
                      <div className="h-full min-h-[280px] overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-[24px] border border-slate-800 bg-slate-900/88 px-4 py-5 text-sm leading-7 text-slate-200 sm:min-h-[420px] sm:px-6">
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
    </div>
  );
}

import { useState } from "react";
import axios from "./axiosConfig";

const extractCode = (text = "") => {
  const value = String(text || "");
  const sixDigits = value.match(/\b(\d{6})\b/);
  if (sixDigits) return sixDigits[1];
  const fourDigits = value.match(/\b(\d{4})\b/);
  return fourDigits ? fourDigits[1] : null;
};

const formatTime = (value = "") => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

function PublicInboxModal({ email, messages, onClose }) {
  const [copiedId, setCopiedId] = useState("");

  const copyCode = (code, id) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[min(94vw,780px)] flex-col overflow-hidden rounded-[30px] border border-cyan-300/20 bg-slate-950 shadow-[0_28px_90px_rgba(0,0,0,0.6)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
              Hotmail Reader
            </div>
            <h2 className="mt-1 break-all text-xl font-black text-white">
              {email}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Tìm thấy {messages.length} email mới nhất.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-lg leading-none text-slate-300 transition hover:border-cyan-300/50 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center text-slate-500">
              Inbox đang trống hoặc chưa có email mới.
            </div>
          ) : (
            messages.map((message, index) => {
              const id = message.id || `message-${index}`;
              const sender = message.from || message.sender || "(unknown)";
              const body = message.bodyPreview || message.body || message.subject || "";
              const code = extractCode(body);
              return (
                <article
                  key={id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/10"
                >
                  <div className="text-sm font-bold text-white">
                    {message.subject || "(No subject)"}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span>{sender}</span>
                    <span>{formatTime(message.receivedDateTime || message.receivedAt || message.date)}</span>
                  </div>
                  {code ? (
                    <div className="mt-3 inline-flex rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 font-mono text-2xl font-black tracking-[0.26em] text-cyan-100">
                      {code}
                    </div>
                  ) : null}
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
                    {message.bodyPreview || message.body || "Không có nội dung xem trước."}
                  </p>
                  {code ? (
                    <button
                      type="button"
                      onClick={() => copyCode(code, id)}
                      className="mt-3 rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-100 transition hover:border-cyan-300/50 hover:bg-slate-800"
                    >
                      {copiedId === id ? "Đã copy" : "Copy code"}
                    </button>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function HotmailReader() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const readInbox = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Nhập email Hotmail cần đọc.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await axios.post("/api/hotmail/public-read", {
        email: normalizedEmail,
        top: 10,
      });
      setResult({
        email: response.data?.email || normalizedEmail,
        messages: response.data?.messages || [],
      });
    } catch (requestError) {
      setError(
        requestError?.response?.data?.error ||
          requestError?.response?.data?.message ||
          requestError?.message ||
          "Không thể đọc inbox Hotmail.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#07111f] px-4 py-8 text-slate-100">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>
      <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center">
        <section className="w-full rounded-[34px] border border-cyan-300/20 bg-slate-950/75 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl md:p-8">
          <div className="mb-6">
            <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.22em] text-cyan-200">
              Public Hotmail Reader
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white md:text-5xl">
              Đọc inbox Hotmail
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400 md:text-base">
              Không cần đăng nhập. Chỉ nhập email Hotmail đã có trong hệ thống để đọc inbox mới nhất.
            </p>
          </div>

          <form onSubmit={readInbox} className="space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-300">Email Hotmail</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="example@hotmail.com"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
              />
            </label>
            {error ? (
              <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-cyan-500 px-5 py-3 font-black text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Đang đọc inbox..." : "Đọc inbox"}
            </button>
          </form>
        </section>
      </main>

      {result ? (
        <PublicInboxModal
          email={result.email}
          messages={result.messages}
          onClose={() => setResult(null)}
        />
      ) : null}
    </div>
  );
}

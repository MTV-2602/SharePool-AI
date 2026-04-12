import { useState } from "react";
import axios from "./axiosConfig";
import HotmailInboxModal from "./HotmailInboxModal";

export default function HotmailReader() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const readInbox = async (event) => {
    event.preventDefault();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Nhập email Hotmail / Outlook cần đọc.");
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

      <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center justify-center">
        <section className="w-full rounded-[34px] border border-cyan-300/20 bg-slate-950/75 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl md:p-8">
          <div className="mb-6">
            <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.22em] text-cyan-200">
              Public Hotmail Reader
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white md:text-5xl">
              Đọc inbox Microsoft mailbox
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 md:text-base">
              Không cần đăng nhập. Chỉ nhập email Hotmail, Outlook, Live hoặc MSN đã có trong hệ thống để đọc inbox mới nhất.
            </p>
          </div>

          <form onSubmit={readInbox} className="space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-300">
                Email Hotmail / Outlook
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="example@outlook.com"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
              />
            </label>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm leading-6 text-slate-400">
              Chỉ đọc inbox, không đánh dấu đã dùng. Nếu email chưa được import vào kho Microsoft mailbox, trang sẽ báo rõ để bạn biết ngay.
            </div>

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
        <HotmailInboxModal
          email={result.email}
          messages={result.messages}
          onClose={() => setResult(null)}
          variant="public"
          eyebrow="Public Hotmail Reader"
        />
      ) : null}
    </div>
  );
}

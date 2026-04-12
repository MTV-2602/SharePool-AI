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
    <div className="min-h-screen overflow-hidden bg-[#07111f] px-3 py-5 text-slate-100 sm:px-4 sm:py-8">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-4xl items-start justify-center pt-3 sm:min-h-[calc(100vh-4rem)] sm:items-center sm:pt-0">
        <section className="w-full rounded-[28px] border border-cyan-300/20 bg-slate-950/75 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:rounded-[34px] sm:p-6 md:p-8">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 text-center sm:mb-8">
              <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200 sm:text-xs">
                Public Hotmail Reader
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:mt-4 sm:text-3xl md:text-5xl">
                Đọc inbox nhanh
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400 sm:mt-3 md:text-base">
                Nhập email Hotmail hoặc Outlook đã có trong hệ thống để mở inbox ngay.
              </p>
            </div>

            <form
              onSubmit={readInbox}
              className="rounded-[24px] border border-slate-800/80 bg-slate-900/70 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)] sm:rounded-[28px]"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label className="min-w-0 flex-1">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                    Email Microsoft mailbox
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="example@outlook.com"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 font-mono text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-cyan-500 px-6 py-3 font-black text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60 md:mt-[1.55rem] md:w-auto"
                >
                  {loading ? "Đang đọc..." : "Đọc inbox"}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1">
                  Hotmail
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1">
                  Outlook
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1">
                  Live
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1">
                  MSN
                </span>
              </div>

              {error ? (
                <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
                  {error}
                </div>
              ) : null}
            </form>
          </div>
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

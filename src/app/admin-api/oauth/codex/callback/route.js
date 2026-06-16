import { exchangeTokens } from "@/lib/oauth/providers";
import { createProviderConnection } from "@/models";
import { getCodexSessionStatus } from "@/lib/oauth/utils/server";

export const dynamic = "force-dynamic";

function renderResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${message}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const errorDesc = searchParams.get("error_description");

  const session = state ? getCodexSessionStatus(state) : null;

  if (!session) {
    return new Response(
      renderResultPage(false, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 }
    );
  }

  try {
    if (errorParam) {
      throw new Error(errorDesc || errorParam);
    }
    if (!code) {
      throw new Error("No authorization code received");
    }

    const tokenData = await exchangeTokens(
      "codex",
      code,
      session.redirectUri,
      session.codeVerifier,
      state
    );

    const connection = await createProviderConnection({
      provider: "codex",
      authType: "oauth",
      ...tokenData,
      expiresAt: tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
        : null,
      testStatus: "active",
    });

    session.status = "done";
    session.connectionId = connection.id;
    session.email = connection.email;

    return new Response(
      renderResultPage(true, `Kết nối thành công! Tài khoản: ${connection.email || "Unknown"}`),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    session.status = "error";
    session.error = err.message;

    return new Response(
      renderResultPage(false, err.message),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 500 }
    );
  }
}

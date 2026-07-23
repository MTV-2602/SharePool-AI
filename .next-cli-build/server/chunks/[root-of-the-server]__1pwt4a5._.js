module.exports=[902157,(e,t,r)=>{t.exports=e.x("node:fs",()=>require("node:fs"))},874533,(e,t,r)=>{t.exports=e.x("node:child_process",()=>require("node:child_process"))},660526,(e,t,r)=>{t.exports=e.x("node:os",()=>require("node:os"))},693672,e=>{"use strict";var t=e.i(921517),r=e.i(792509),o=e.i(356945);let s=null,n=null,a=o.CODEX_CONFIG.fixedPort,i=new Map;function c(e,t){let r=e?"Authentication Successful":"Authentication Failed",o=String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");return`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${r}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${e?"#22c55e":"#ef4444"};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${e?"&#10003;":"&#10007;"}</div><h1>${r}</h1><p>${o}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`}function l(){n&&(clearTimeout(n),n=null),s&&(s.close(),s=null)}let u=null,d=null,h=new Map;function p(){d&&(clearTimeout(d),d=null),u&&(u.close(),u=null)}e.s(["clearCodexSession",0,function(e){i.delete(e)},"clearXaiSession",0,function(e){h.delete(e)},"getCodexSessionStatus",0,function(e){return i.get(e)||null},"getXaiSessionStatus",0,function(e){return h.get(e)||null},"registerCodexSession",0,function({state:e,codeVerifier:t,redirectUri:r}){return!!e&&!!t&&!!r&&(i.set(e,{codeVerifier:t,redirectUri:r,status:"pending",createdAt:Date.now()}),!0)},"registerXaiSession",0,function({state:e,codeVerifier:t,redirectUri:r}){return!!e&&!!t&&!!r&&(h.set(e,{codeVerifier:t,redirectUri:r,status:"pending",createdAt:Date.now()}),!0)},"startCodexProxy",0,function(o){return new Promise(u=>{if(s)return void u({success:!0});let d=t.default.createServer(async(t,s)=>{let n=new r.URL(t.url,"http://localhost");if("/callback"!==n.pathname&&"/auth/callback"!==n.pathname){s.writeHead(404),s.end("Not found");return}let a=n.searchParams.get("code"),u=n.searchParams.get("state"),d=n.searchParams.get("error"),h=u?i.get(u):null;if(h){try{if(d)throw Error(n.searchParams.get("error_description")||d);if(!a)throw Error("No authorization code received");let{exchangeTokens:t}=await e.A(197037),{createProviderConnection:r}=await e.A(395951),o=await t("codex",a,h.redirectUri,h.codeVerifier,u),i=await r({provider:"codex",authType:"oauth",...o,expiresAt:o.expiresIn?new Date(Date.now()+1e3*o.expiresIn).toISOString():null,testStatus:"active"});h.status="done",h.connectionId=i.id,h.email=i.email,s.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}),s.end(c(!0,"You can close this window."))}catch(e){h.status="error",h.error=e.message,s.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}),s.end(c(!1,e.message))}finally{l()}return}let p=`http://localhost:${o}/callback${n.search}`;s.writeHead(302,{Location:p}),s.end(),l()});d.listen(a,"127.0.0.1",()=>{s=d,n=setTimeout(()=>l(),3e5),u({success:!0})}),d.on("error",e=>{"EADDRINUSE"===e.code?u({success:!1,reason:"port_busy"}):u({success:!1,reason:e.message})})})},"startLocalServer",0,function(e,o=null){return new Promise((s,n)=>{let a=t.default.createServer((t,o)=>{let s=new r.URL(t.url,"http://localhost");if("/callback"===s.pathname||"/auth/callback"===s.pathname){let t=Object.fromEntries(s.searchParams);o.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}),o.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`),e(t)}else o.writeHead(404),o.end("Not found")});a.listen(o||0,"127.0.0.1",()=>{let{port:e}=a.address();s({server:a,port:e,close:()=>a.close()})}),a.on("error",e=>{"EADDRINUSE"===e.code&&o?n(Error(`Port ${o} is already in use. Please close other applications using this port.`)):n(e)})})},"startXaiProxy",0,function(o){return new Promise(s=>{if(u)return void s({success:!0});let n=t.default.createServer(async(t,s)=>{let n=new r.URL(t.url,"http://localhost");if("/callback"!==n.pathname&&"/auth/callback"!==n.pathname){s.writeHead(404),s.end("Not found");return}let a=n.searchParams.get("code"),i=n.searchParams.get("state"),l=n.searchParams.get("error"),u=i?h.get(i):null;if(u){try{if(l)throw Error(n.searchParams.get("error_description")||l);if(!a)throw Error("No authorization code received");let{exchangeTokens:t}=await e.A(197037),{createProviderConnection:r}=await e.A(395951),o=await t("xai",a,u.redirectUri,u.codeVerifier,i),d=await r({provider:"xai",authType:"oauth",...o,expiresAt:o.expiresIn?new Date(Date.now()+1e3*o.expiresIn).toISOString():null,testStatus:"active"});u.status="done",u.connectionId=d.id,u.email=d.email,s.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}),s.end(c(!0,"You can close this window."))}catch(e){u.status="error",u.error=e.message,s.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}),s.end(c(!1,e.message))}finally{p()}return}let d=`http://localhost:${o}/callback${n.search}`;s.writeHead(302,{Location:d}),s.end(),p()});n.listen(56121,"127.0.0.1",()=>{u=n,d=setTimeout(()=>p(),3e5),s({success:!0})}),n.on("error",e=>{"EADDRINUSE"===e.code?s({success:!1,reason:"port_busy"}):s({success:!1,reason:e.message})})})},"stopCodexProxy",0,l,"stopXaiProxy",0,p])},792509,(e,t,r)=>{t.exports=e.x("url",()=>require("url"))},921517,(e,t,r)=>{t.exports=e.x("http",()=>require("http"))},59639,(e,t,r)=>{t.exports=e.x("node:process",()=>require("node:process"))},870722,(e,t,r)=>{t.exports=e.x("tty",()=>require("tty"))},509656,(e,t,r)=>{t.exports=e.x("node:tty",()=>require("node:tty"))},231362,(e,t,r)=>{"use strict";t.exports=(e,t=process.argv)=>{let r=e.startsWith("-")?"":1===e.length?"-":"--",o=t.indexOf(r+e),s=t.indexOf("--");return -1!==o&&(-1===s||o<s)}},998496,(e,t,r)=>{"use strict";let o,s=e.r(446786),n=e.r(870722),a=e.r(231362),{env:i}=process;function c(e){return 0!==e&&{level:e,hasBasic:!0,has256:e>=2,has16m:e>=3}}function l(e,t){if(0===o)return 0;if(a("color=16m")||a("color=full")||a("color=truecolor"))return 3;if(a("color=256"))return 2;if(e&&!t&&void 0===o)return 0;let r=o||0;if("dumb"===i.TERM)return r;{let e=s.release().split(".");return Number(e[0])>=10&&Number(e[2])>=10586?Number(e[2])>=14931?3:2:1}}a("no-color")||a("no-colors")||a("color=false")||a("color=never")?o=0:(a("color")||a("colors")||a("color=true")||a("color=always"))&&(o=1),"FORCE_COLOR"in i&&(o="true"===i.FORCE_COLOR?1:"false"===i.FORCE_COLOR?0:0===i.FORCE_COLOR.length?1:Math.min(parseInt(i.FORCE_COLOR,10),3)),t.exports={supportsColor:function(e){return c(l(e,e&&e.isTTY))},stdout:c(l(!0,n.isatty(1))),stderr:c(l(!0,n.isatty(2)))}},395951,e=>{e.v(t=>Promise.all(["server/chunks/codex xoay_src_models_index_191be1e.js"].map(t=>e.l(t))).then(()=>t(928035)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__1pwt4a5._.js.map
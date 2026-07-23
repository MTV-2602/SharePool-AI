module.exports=[647390,e=>{"use strict";var t=e.i(798019),o=e.i(284871),a=e.i(874680),n=e.i(877144),r=e.i(469182),i=e.i(678096),c=e.i(495378),s=e.i(498288),l=e.i(817380),d=e.i(353114),u=e.i(231989),p=e.i(594515),g=e.i(580195),h=e.i(110648),C=e.i(859258),I=e.i(193695);e.i(477847);var m=e.i(918282);e.i(725926);var y=e.i(680436);async function R(e,{params:t}){let{id:o}=await t,{searchParams:a}=new URL(e.url),n=a.get("platform")||"windows",r=a.get("mode")||"config",{data:i,error:c}=await y.supabase.from("client_keys").select("key, label").eq("id",o).single();if(c||!i)return new Response("Client Key not found",{status:404});let s=i.key,l=e.headers.get("host")||"vinhcousera.vercel.app",d=e.headers.get("x-forwarded-proto")||"https",u=`${d}://${l}`;if("mitm"===r)return"windows"===n?new Response(`
@echo off
title 9Router MITM 1-Click Configurator
echo ====================================================
echo       9Router MITM 1-Click Configurator
echo ====================================================
echo.
echo Yeu cau quyen Administrator de bat MITM (Fake DNS va Port 443)...
echo.

:: Check for admin privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [LOI] Vui long chay script nay voi quyen Administrator!
    echo Chuot phai vao file va chon "Run as Administrator".
    echo.
    pause
    exit /b 1
)

echo Dang khoi chay 9Router local tren cong 20127 de tu dong cau hinh...
echo.
start "9Router Server" /min cmd /c npx 9router --port 20127 --no-browser

echo Cho server khoi dong trong 5 giay...
echo.
timeout /t 5 >nul

echo.
echo Dang thiet lap va bat MITM Proxy...
echo.

:: Write base64 string to a temp file
echo Y29uc3QgZnMgPSByZXF1aXJlKCdmcycpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpOwpjb25zdCBjcnlwdG8gPSByZXF1aXJlKCdjcnlwdG8nKTsKY29uc3QgaHR0cCA9IHJlcXVpcmUoJ2h0dHAnKTsKY29uc3Qgb3MgPSByZXF1aXJlKCdvcycpOwoKZnVuY3Rpb24gZGVmYXVsdERpcigpIHsKICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gIndpbjMyIikgewogICAgcmV0dXJuIHBhdGguam9pbihwcm9jZXNzLmVudi5BUFBEQVRBIHx8IHBhdGguam9pbihvcy5ob21lZGlyKCksICJBcHBEYXRhIiwgIlJvYW1pbmciKSwgIjlyb3V0ZXIiKTsKICB9CiAgcmV0dXJuIHBhdGguam9pbihvcy5ob21lZGlyKCksICIuOXJvdXRlciIpOwp9CmNvbnN0IERBVEFfRElSID0gcHJvY2Vzcy5lbnYuREFUQV9ESVIgfHwgZGVmYXVsdERpcigpOwoKbGV0IHJhd0lkID0gJyc7CnRyeSB7CiAgcmF3SWQgPSBmcy5yZWFkRmlsZVN5bmMocGF0aC5qb2luKERBVEFfRElSLCAnbWFjaGluZS1pZCcpLCAndXRmOCcpLnRyaW0oKTsKfSBjYXRjaCAoZSkgewogIGNvbnNvbGUuZXJyb3IoIkVycm9yOiBQbGVhc2UgcnVuIDlSb3V0ZXIgbG9jYWwgc2VydmVyIGZpcnN0LiIpOwogIHByb2Nlc3MuZXhpdCgxKTsKfQoKbGV0IGNsaVNlY3JldCA9ICcnOwp0cnkgewogIGNsaVNlY3JldCA9IGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4oREFUQV9ESVIsICdhdXRoJywgJ2NsaS1zZWNyZXQnKSwgJ3V0ZjgnKS50cmltKCk7Cn0gY2F0Y2ggKGUpIHsKICBjb25zb2xlLmVycm9yKCJFcnJvcjogUGxlYXNlIHJ1biA5Um91dGVyIGxvY2FsIHNlcnZlciBmaXJzdC4iKTsKICBwcm9jZXNzLmV4aXQoMSk7Cn0KCmNvbnN0IHRva2VuID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShyYXdJZCArICc5ci1jbGktYXV0aCcgKyBjbGlTZWNyZXQpLmRpZ2VzdCgnaGV4Jykuc3Vic3RyaW5nKDAsIDE2KTsKCmZ1bmN0aW9uIG1ha2VSZXF1ZXN0KG1ldGhvZCwgdXJsUGF0aCwgYm9keU9iaikgewogIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICBjb25zdCBwb3N0RGF0YSA9IEpTT04uc3RyaW5naWZ5KGJvZHlPYmopOwogICAgY29uc3QgcmVxID0gaHR0cC5yZXF1ZXN0KHsKICAgICAgaG9zdG5hbWU6ICcxMjcuMC4wLjEnLAogICAgICBwb3J0OiAyMDEyNywKICAgICAgcGF0aDogdXJsUGF0aCwKICAgICAgbWV0aG9kOiBtZXRob2QsCiAgICAgIGhlYWRlcnM6IHsKICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLAogICAgICAgICdDb250ZW50LUxlbmd0aCc6IEJ1ZmZlci5ieXRlTGVuZ3RoKHBvc3REYXRhKSwKICAgICAgICAneC05ci1jbGktdG9rZW4nOiB0b2tlbgogICAgICB9CiAgICB9LCAocmVzKSA9PiB7CiAgICAgIGxldCBkYXRhID0gJyc7CiAgICAgIHJlcy5vbignZGF0YScsIGNodW5rID0+IGRhdGEgKz0gY2h1bmspOwogICAgICByZXMub24oJ2VuZCcsICgpID0+IHsKICAgICAgICB0cnkgeyByZXNvbHZlKEpTT04ucGFyc2UoZGF0YSkpOyB9IGNhdGNoIHsgcmVzb2x2ZSh7IGVycm9yOiBkYXRhIHx8ICgnSFRUUCAnICsgcmVzLnN0YXR1c0NvZGUpIH0pOyB9CiAgICAgIH0pOwogICAgfSk7CiAgICByZXEub24oJ2Vycm9yJywgcmVqZWN0KTsKICAgIHJlcS53cml0ZShwb3N0RGF0YSk7CiAgICByZXEuZW5kKCk7CiAgfSk7Cn0KCmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7CiAgY29uc3QgYXBpS2V5ID0gcHJvY2Vzcy5hcmd2WzJdOwogIGNvbnN0IG9yaWdpbiA9IHByb2Nlc3MuYXJndlszXTsKICBjb25zdCBzdWRvUGFzc3dvcmQgPSBwcm9jZXNzLmFyZ3ZbNF0gfHwgIiI7CiAgdHJ5IHsKICAgIGNvbnN0IHBvc3RSZXMgPSBhd2FpdCBtYWtlUmVxdWVzdCgnUE9TVCcsICcvYXBpL2NsaS10b29scy9hbnRpZ3Jhdml0eS1taXRtJywgewogICAgICBhcGlLZXksIG1pdG1Sb3V0ZXJCYXNlVXJsOiBvcmlnaW4sIHN1ZG9QYXNzd29yZCwgZm9yY2VLaWxsUG9ydDQ0MzogdHJ1ZQogICAgfSk7CiAgICBjb25zb2xlLmxvZygiU2VydmVyIGNvbmZpZzoiLCBKU09OLnN0cmluZ2lmeShwb3N0UmVzKSk7CiAgICBpZiAocG9zdFJlcy5lcnJvcikgcHJvY2Vzcy5leGl0KDEpOwoKICAgIGZvciAoY29uc3QgdG9vbCBvZiBbJ2FudGlncmF2aXR5JywgJ2NvcGlsb3QnLCAna2lybyddKSB7CiAgICAgIGNvbnN0IHBSZXMgPSBhd2FpdCBtYWtlUmVxdWVzdCgnUEFUQ0gnLCAnL2FwaS9jbGktdG9vbHMvYW50aWdyYXZpdHktbWl0bScsIHsKICAgICAgICB0b29sLCBhY3Rpb246ICdlbmFibGUnLCBzdWRvUGFzc3dvcmQKICAgICAgfSk7CiAgICAgIGNvbnNvbGUubG9nKGBUb29sICR7dG9vbH06YCwgSlNPTi5zdHJpbmdpZnkocFJlcykpOwogICAgfQogIH0gY2F0Y2ggKGUpIHsKICAgIGNvbnNvbGUuZXJyb3IoIkVycm9yOiIsIGUubWVzc2FnZSk7CiAgICBwcm9jZXNzLmV4aXQoMSk7CiAgfQp9Cm1haW4oKTs= > "%TEMP%mitm_encoded.txt"

certutil -decode "%TEMP%mitm_encoded.txt" "%TEMP%mitm_configure.js" >nul 2>&1

node "%TEMP%mitm_configure.js" "${s}" "${u}"

del "%TEMP%mitm_encoded.txt" >nul 2>&1
del "%TEMP%mitm_configure.js" >nul 2>&1

echo.
echo ====================================================
echo CAU HINH MITM PROXY HOAN TAT!
echo ====================================================
echo Nho giu cua so terminal cua 9Router mo de duy tri MITM Proxy.
echo Bay gio ban da co the su dung cac IDE Tool ket noi truc tiep len Web!
echo.
pause
`.trim().replace(/\n/g,"\r\n"),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="setup-mitm-9router.bat"'}}):new Response(`
cat << 'EOF' > setup-mitm-9router.sh
#!/bin/bash
echo "===================================================="
echo "       9Router MITM 1-Click Configurator"
echo "===================================================="
echo ""
echo "Yeu cau nhap mat khau sudo de bat MITM (Fake DNS va Port 443)..."
echo ""

# Read sudo password once
read -s -p "Enter sudo password: " sudo_pwd
echo ""

echo "Dang khoi chay 9Router local tren cong 20127..."
npx 9router --port 20127 --no-browser >/dev/null 2>&1 &
SERVER_PID=$!

echo "Cho server khoi dong trong 5 giay..."
sleep 5

echo "Dang thiet lap va bat MITM Proxy..."
cat << 'JS_EOF' > /tmp/mitm_configure.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const os = require('os');

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}
const DATA_DIR = process.env.DATA_DIR || defaultDir();

let rawId = '';
try {
  rawId = fs.readFileSync(path.join(DATA_DIR, 'machine-id'), 'utf8').trim();
} catch (e) {
  console.error("Error: Please run 9Router local server first.");
  process.exit(1);
}

let cliSecret = '';
try {
  cliSecret = fs.readFileSync(path.join(DATA_DIR, 'auth', 'cli-secret'), 'utf8').trim();
} catch (e) {
  console.error("Error: Please run 9Router local server first.");
  process.exit(1);
}

const token = crypto.createHash('sha256').update(rawId + '9r-cli-auth' + cliSecret).digest('hex').substring(0, 16);

function makeRequest(method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(bodyObj);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 20127,
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-9r-cli-token': token
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ error: data || ('HTTP ' + res.statusCode) }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const apiKey = process.argv[2];
  const origin = process.argv[3];
  const sudoPassword = process.argv[4] || "";
  try {
    const postRes = await makeRequest('POST', '/api/cli-tools/antigravity-mitm', {
      apiKey, mitmRouterBaseUrl: origin, sudoPassword, forceKillPort443: true
    });
    console.log("Server config:", JSON.stringify(postRes));
    if (postRes.error) process.exit(1);

    for (const tool of ['antigravity', 'copilot', 'kiro']) {
      const pRes = await makeRequest('PATCH', '/api/cli-tools/antigravity-mitm', {
        tool, action: 'enable', sudoPassword
      });
      console.log(\`Tool \${tool}:\`, JSON.stringify(pRes));
    }
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}
main();
JS_EOF

node /tmp/mitm_configure.js "${s}" "${u}" "$sudo_pwd"
rm /tmp/mitm_configure.js

echo ""
echo "====================================================="
echo "Setup MITM Proxy Completed Successfully!"
echo "===================================================="
echo "Your local MITM Proxy is running (PID: $SERVER_PID)."
echo "Keep this terminal open to maintain MITM Proxy."
echo ""
read -p "Press Enter to exit..." temp_input
bg
fg
EOF
`.trim(),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="setup-mitm-9router.sh"'}});return"windows"===n?new Response(`
@echo off
title AntiGravity 1-Click Configurator
echo =========================================
echo       AntiGravity 1-Click Configurator   
echo =========================================
echo.
echo Khoi tao cau hinh tu dong cho AntiGravity...

:: Create directory
set "CODEX_DIR=%USERPROFILE%.codex"
if not exist "%CODEX_DIR%" (
    echo Dang tao thu muc: %CODEX_DIR%
    mkdir "%CODEX_DIR%"
)

:: Write config.toml
set "CONFIG_FILE=%CODEX_DIR%config.toml"
echo Dang ghi file cau hinh tai %CONFIG_FILE%...
(
echo model_reasoning_effort = "low"
echo model_provider = "openai-custom"
echo model = "gpt-5.4"
echo.
echo [model_providers.openai-custom]
echo experimental_bearer_token = "${s}"
echo name = "VinAi"
echo base_url = "${u}/v1"
echo wire_api = "responses"
echo requires_openai_auth = false
echo supports_websockets = false
) > "%CONFIG_FILE%"

echo.
echo =========================================
echo CAU HINH ANTI-GRAVITY HOAN TAT!
echo =========================================
echo Ban bay gio da co the bat dau su dung AntiGravity (Gemini-backed) 
echo tren IDE/CLI thong qua API Gateway Vercel ma khong can chay local!
echo.
pause
`.trim().replace(/\n/g,"\r\n"),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="setup-antigravity.bat"'}}):new Response(`
#!/bin/bash
echo "========================================="
echo "       AntiGravity 1-Click Configurator  "
echo "========================================="
echo ""

CODEX_DIR="$HOME/.codex"
if [ ! -d "$CODEX_DIR" ]; then
    echo "Creating directory: $CODEX_DIR"
    mkdir -p "$CODEX_DIR"
fi

CONFIG_FILE="$CODEX_DIR/config.toml"
echo "Writing configuration to $CONFIG_FILE..."

cat << 'EOF' > "$CONFIG_FILE"
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${s}"
name = "VinAi"
base_url = "${u}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
EOF

echo ""
echo "========================================="
echo "Setup AntiGravity Completed Successfully!"
echo "========================================="
echo "Your AntiGravity configuration is ready."
echo "You can now use AntiGravity (Gemini-backed) with your hosted API!"
echo ""
`.trim(),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="setup-antigravity.sh"'}})}e.s(["GET",0,R,"dynamic",0,"force-dynamic"],834551);var b=e.i(834551);let A=new t.AppRouteRouteModule({definition:{kind:o.RouteKind.APP_ROUTE,page:"/api/client-keys/[id]/setup-script/route",pathname:"/api/client-keys/[id]/setup-script",filename:"route",bundlePath:""},distDir:".next-cli-build",relativeProjectDir:"",resolvedPagePath:"[project]/codex xoay/src/app/api/client-keys/[id]/setup-script/route.js",nextConfigOutput:"",userland:b,...{}}),{workAsyncStorage:v,workUnitAsyncStorage:w,serverHooks:f}=A;async function G(e,t,a){a.requestMeta&&(0,n.setRequestMeta)(e,a.requestMeta),A.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let y="/api/client-keys/[id]/setup-script/route";y=y.replace(/\/index$/,"")||"/";let R=await A.prepare(e,t,{srcPage:y,multiZoneDraftMode:!1});if(!R)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:b,deploymentId:v,params:w,nextConfig:f,parsedUrl:G,isDraftMode:E,prerenderManifest:N,routerServerContext:S,isOnDemandRevalidate:Z,revalidateOnlyGenerated:k,resolvedPathname:T,clientReferenceManifest:B,serverActionsManifest:V}=R,D=(0,c.normalizeAppPath)(y),X=!!(N.dynamicRoutes[D]||N.routes[T]),K=async()=>((null==S?void 0:S.render404)?await S.render404(e,t,G,!1):t.end("This page could not be found"),null);if(X&&!E){let e=!!N.routes[T],t=N.dynamicRoutes[D];if(t&&!1===t.fallback&&!e){if(f.adapterPath)return await K();throw new I.NoFallbackError}}let O=null;!X||A.isDev||E||(O="/index"===(O=T)?"/":O);let _=!0===A.isDev||!X,F=X&&!_;V&&B&&(0,i.setManifestsSingleton)({page:y,clientReferenceManifest:B,serverActionsManifest:V});let H=e.method||"GET",x=(0,r.getTracer)(),P=x.getActiveScopeSpan(),J=!!(null==S?void 0:S.isWrappedByNextServer),Y=!!(0,n.getRequestMeta)(e,"minimalMode"),M=(0,n.getRequestMeta)(e,"incrementalCache")||await A.getIncrementalCache(e,f,N,Y);null==M||M.resetRequestCache(),globalThis.__incrementalCache=M;let U={params:w,previewProps:N.preview,renderOpts:{experimental:{authInterrupts:!!f.experimental.authInterrupts},cacheComponents:!!f.cacheComponents,supportsDynamicResponse:_,incrementalCache:M,cacheLifeProfiles:f.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,o,a,n)=>A.onRequestError(e,t,a,n,S)},sharedContext:{buildId:b,deploymentId:v}},W=new s.NodeNextRequest(e),j=new s.NodeNextResponse(t),L=l.NextRequestAdapter.fromNodeNextRequest(W,(0,l.signalFromNodeResponse)(t));try{let n,i=async e=>A.handle(L,U).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let o=x.getRootSpanAttributes();if(!o)return;if(o.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${o.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=o.get("next.route");if(a){let t=`${H} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t),n&&n!==e&&(n.setAttribute("http.route",a),n.updateName(t))}else e.updateName(`${H} ${y}`)}),c=async n=>{var r,c;let s=async({previousCacheEntry:o})=>{try{if(!Y&&Z&&k&&!o)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await i(n);e.fetchMetrics=U.renderOpts.fetchMetrics;let c=U.renderOpts.pendingWaitUntil;c&&a.waitUntil&&(a.waitUntil(c),c=void 0);let s=U.renderOpts.collectedTags;if(!X)return await (0,p.sendResponse)(W,j,r,U.renderOpts.pendingWaitUntil),null;{let e=await r.blob(),t=(0,g.toNodeOutgoingHttpHeaders)(r.headers);s&&(t[C.NEXT_CACHE_TAGS_HEADER]=s),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let o=void 0!==U.renderOpts.collectedRevalidate&&!(U.renderOpts.collectedRevalidate>=C.INFINITE_CACHE)&&U.renderOpts.collectedRevalidate,a=void 0===U.renderOpts.collectedExpire||U.renderOpts.collectedExpire>=C.INFINITE_CACHE?void 0:U.renderOpts.collectedExpire;return{value:{kind:m.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:o,expire:a}}}}catch(t){throw(null==o?void 0:o.isStale)&&await A.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:F,isOnDemandRevalidate:Z})},!1,S),t}},l=await A.handleResponse({req:e,nextConfig:f,cacheKey:O,routeKind:o.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:N,isRoutePPREnabled:!1,isOnDemandRevalidate:Z,revalidateOnlyGenerated:k,responseGenerator:s,waitUntil:a.waitUntil,isMinimalMode:Y});if(!X)return null;if((null==l||null==(r=l.value)?void 0:r.kind)!==m.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(c=l.value)?void 0:c.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});Y||t.setHeader("x-nextjs-cache",Z?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),E&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let d=(0,g.fromNodeOutgoingHttpHeaders)(l.value.headers);return Y&&X||d.delete(C.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||t.getHeader("Cache-Control")||d.get("Cache-Control")||d.set("Cache-Control",(0,h.getCacheControlHeader)(l.cacheControl)),await (0,p.sendResponse)(W,j,new Response(l.value.body,{headers:d,status:l.value.status||200})),null};J&&P?await c(P):(n=x.getActiveScopeSpan(),await x.withPropagatedContext(e.headers,()=>x.trace(d.BaseServerSpan.handleRequest,{spanName:`${H} ${y}`,kind:r.SpanKind.SERVER,attributes:{"http.method":H,"http.target":e.url}},c),void 0,!J))}catch(t){if(t instanceof I.NoFallbackError||await A.onRequestError(e,t,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:F,isOnDemandRevalidate:Z})},!1,S),X)throw t;return await (0,p.sendResponse)(W,j,new Response(null,{status:500})),null}}e.s(["handler",0,G,"patchFetch",0,function(){return(0,a.patchFetch)({workAsyncStorage:v,workUnitAsyncStorage:w})},"routeModule",0,A,"serverHooks",0,f,"workAsyncStorage",0,v,"workUnitAsyncStorage",0,w],647390)}];

//# sourceMappingURL=1g8g_next_dist_esm_build_templates_app-route_0ltd2n3.js.map
(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,892610,e=>{"use strict";var t=e.i(73083),s=e.i(202165);e.i(586329);var n=e.i(952042),r=e.i(95307),i=e.i(421473),o=e.i(997902);e.s(["default",0,function(){let e,[a,l]=(0,s.useState)(""),[c,d]=(0,s.useState)(""),[x,m]=(0,s.useState)(""),[h,p]=(0,s.useState)(0),[u,g]=(0,s.useState)(!1),[b,f]=(0,s.useState)(null),[j,y]=(0,s.useState)("password"),[N,v]=(0,s.useState)(!1),[C,w]=(0,s.useState)("Sign in with OIDC"),[k,_]=(0,s.useState)(!1),[A,I]=(0,s.useState)(""),[S,T]=(0,s.useState)(null),[O,P]=(0,s.useState)(null),[$,G]=(0,s.useState)("usage"),[K,D]=(0,s.useState)("codex"),[L,M]=(0,s.useState)(""),[E,R]=(0,s.useState)("https://vinhcousera.vercel.app"),[B,q]=(0,s.useState)(!1),[H,U]=(0,s.useState)([]),[V,W]=(0,s.useState)([]),[F,X]=(0,s.useState)(!1),[z,Y]=(0,s.useState)(!1),J=(0,o.useRouter)();(0,s.useEffect)(()=>{if(h<=0)return;let e=setInterval(()=>p(e=>e>0?e-1:0),1e3);return()=>clearInterval(e)},[h]),(0,s.useEffect)(()=>{{R(window.location.origin);let e=localStorage.getItem("clientKey");e?(T(e),ee(e)):Q()}},[]);let Q=async()=>{let e=new AbortController,t=setTimeout(()=>e.abort(),5e3),s=window.location.origin;try{let n=await fetch(`${s}/api/auth/status`,{signal:e.signal});if(clearTimeout(t),n.ok){let e=await n.json();if(!1===e.requireLogin){J.push("/dashboard"),J.refresh();return}f(!!e.hasPassword),y(e.authMode||"password"),v(!0===e.oidcConfigured),w(e.oidcLoginLabel||"Sign in with OIDC")}else f(!0)}catch(e){clearTimeout(t),f(!0)}},Z=async(e,t)=>{let s=t||S;if(s){X(!0);try{let t=await fetch(`/api/client-keys/${e}/usage?limit=50&include_summary=true`,{headers:{Authorization:`Bearer ${s}`,"Cache-Control":"no-cache, no-store, must-revalidate",Pragma:"no-cache"}});if(t.ok){let e=await t.json(),s=e=>{let t=e||"";return"gpt-5.4"===t||"ag/gpt-5.4"===t||"antigravity/gpt-5.4"===t?t="gemini-3.5-flash-high":("gpt-5.5"===t||"codex/gpt-5.5"===t)&&(t="gpt-5.5"),t.startsWith("ag/")&&(t=t.slice(3)),t.startsWith("antigravity/")&&(t=t.slice(12)),t.startsWith("codex/")&&(t=t.slice(6)),t},n=(e.logs||[]).map(e=>({...e,model:s(e.model)})),r=(e.summary||[]).reduce((e,t)=>{let n=s(t.model),r=e.find(e=>e.model===n);return r?(r.prompt_tokens+=Number(t.prompt_tokens)||0,r.completion_tokens+=Number(t.completion_tokens)||0,r.billed_tokens+=Number(t.billed_tokens)||0,r.count+=Number(t.count)||0):e.push({...t,model:n,prompt_tokens:Number(t.prompt_tokens)||0,completion_tokens:Number(t.completion_tokens)||0,billed_tokens:Number(t.billed_tokens)||0,count:Number(t.count)||0}),e},[]);U(n),W(r)}}catch(e){console.error("Lỗi khi tải lịch sử sử dụng:",e)}finally{X(!1)}}},ee=async e=>{g(!0),d("");try{let t=await fetch("/api/client-keys/check",{method:"POST",headers:{"Content-Type":"application/json","Cache-Control":"no-cache, no-store, must-revalidate",Pragma:"no-cache"},body:JSON.stringify({key:e})}),s=await t.json();t.ok?(P(s.keyData),T(e),localStorage.setItem("clientKey",e),Z(s.keyData.id,e)):(d(s.error||"Có lỗi xảy ra khi kiểm tra Key."),P(null),localStorage.removeItem("clientKey"),T(null),Q())}catch(e){d("Không thể kết nối đến máy chủ. Vui lòng thử lại.")}finally{g(!1)}},et=async e=>{e.preventDefault();let t=a.trim();if(t){if(g(!0),d(""),m(""),t.startsWith("ck-"))return void await ee(t);try{let e=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:t})});if(e.ok){if((await e.json()).mustChangePassword){_(!0),g(!1);return}J.push("/dashboard"),J.refresh()}else{let s=await fetch("/api/client-keys/check",{method:"POST",headers:{"Content-Type":"application/json","Cache-Control":"no-cache, no-store, must-revalidate",Pragma:"no-cache"},body:JSON.stringify({key:t})});if(s.ok){let e=await s.json();P(e.keyData),T(t),localStorage.setItem("clientKey",t),Z(e.keyData.id,t)}else{let t=await e.json();d(t.error||"Mật khẩu quản trị hoặc mã API Key không hợp lệ"),t.resetHint&&m(t.resetHint),t.retryAfter&&p(Number(t.retryAfter))}}}catch(e){d("Có lỗi kết nối xảy ra. Vui lòng thử lại.")}finally{g(!1)}}},es=async e=>{e.preventDefault(),g(!0),d("");try{let e=await fetch("/api/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:a,newPassword:A})});if(e.ok)J.push("/dashboard"),J.refresh();else{let t=await e.json();d(t.error||"Lỗi đặt mật khẩu")}}catch(e){d("Có lỗi xảy ra. Vui lòng thử lại.")}finally{g(!1)}},en=(e,t)=>{navigator.clipboard.writeText(e).catch(()=>{}),M(t),setTimeout(()=>M(""),2e3)},er=e=>{if(!e)return"N/A";let t=e.toLowerCase();if(t.startsWith("codex/")||t.startsWith("cx/")||t.includes("gpt-5.5")||t.includes("gpt-5.4-image")||t.includes("gpt-5.3"))return"Codex";let s="gpt-5.4"===t||"gemini-3-flash"===t||t.startsWith("gemini-3-flash-a")||t.includes("gemini-3-flash-agent")||t.includes("gemini-3.5-flash")||t.includes("gemini-pro-agent")||t.includes("gemini-3.1-pro-low")||t.includes("gemini-pro-default")||t.includes("gpt-oss")||t.includes("claude-sonnet-4-6")||t.includes("claude-opus-4-6-thinking");return t.startsWith("antigravity/")||t.startsWith("ag/")||s?"Antigravity":t.includes("gemini")?"Google Gemini":t.includes("gpt-")||t.startsWith("gpt")||t.includes("o1")||t.includes("o3")?"OpenAI":t.includes("claude")?"Anthropic":t.includes("deepseek")?"DeepSeek":t.includes("llama")||t.includes("meta")?"Meta":"Custom/Other"},ei=O?.used_tokens||0,eo=O?.quota_tokens||0,ea=0===eo||eo>=0xe8d4a50fff,el=ea?0:Math.max(0,eo-ei),ec=ea?0:Math.min(100,Math.round(ei/eo*100)),ed=ei/1e6*5,ex=(e={},V.forEach(t=>{let s=er(t.model);e[s]||(e[s]={name:s,prompt:0,completion:0,total:0,count:0,models:new Set}),e[s].prompt+=t.prompt_tokens||0,e[s].completion+=t.completion_tokens||0,e[s].total+=t.billed_tokens||0,e[s].count+=t.count||0,t.model&&e[s].models.add(t.model)}),Object.values(e).map(e=>({...e,models:Array.from(e.models)}))),em=N&&["oidc","both"].includes(j),eh="oidc"!==j||!N;return O?(0,t.jsxs)("div",{className:"min-h-screen bg-bg text-text-main selection:bg-brand-500 selection:text-white pb-12",children:[(0,t.jsx)("header",{className:"border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-20",children:(0,t.jsxs)("div",{className:"max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-4",children:[(0,t.jsxs)("div",{className:"flex items-center gap-3",children:[(0,t.jsx)("div",{className:"w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary",children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[24px]",children:"vpn_key"})}),(0,t.jsxs)("div",{children:[(0,t.jsx)("h1",{className:"text-xl font-bold tracking-tight",children:"9Router Client Portal"}),(0,t.jsxs)("p",{className:"text-xs text-text-muted",children:["Key: ",(0,t.jsx)("span",{className:"font-mono text-primary/80",children:O.label||"Unnamed Key"})]})]})]}),(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsxs)("button",{onClick:()=>ee(S),disabled:u,className:"inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer",children:[(0,t.jsx)("span",{className:`material-symbols-outlined text-[16px] ${u?"animate-spin":""}`,children:"refresh"}),"Làm mới"]}),(0,t.jsxs)("button",{onClick:()=>{localStorage.removeItem("clientKey"),T(null),P(null),l(""),d(""),Q()},className:"inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 text-sm font-medium transition-colors cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[16px]",children:"logout"}),"Đăng xuất"]})]})]})}),(0,t.jsxs)("main",{className:"max-w-6xl mx-auto px-4 mt-8",children:[(0,t.jsxs)("div",{className:"flex gap-2 border-b border-border pb-4 mb-6",children:[(0,t.jsxs)("button",{onClick:()=>G("usage"),className:`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 cursor-pointer ${"usage"===$?"bg-primary text-white shadow-md shadow-primary/20":"text-text-muted hover:bg-surface-2"}`,children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[18px]",children:"data_usage"}),"Hạn mức sử dụng"]}),(0,t.jsxs)("button",{onClick:()=>G("guide"),className:`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 cursor-pointer ${"guide"===$?"bg-primary text-white shadow-md shadow-primary/20":"text-text-muted hover:bg-surface-2"}`,children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[18px]",children:"menu_book"}),"Hướng dẫn kết nối máy khách"]})]}),"usage"===$&&(0,t.jsxs)("div",{className:"space-y-6",children:[(0,t.jsxs)("div",{className:"grid grid-cols-1 md:grid-cols-3 gap-6",children:[(0,t.jsx)(n.Card,{children:(0,t.jsxs)("div",{className:"flex justify-between items-start",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-sm text-text-muted",children:"Đã sử dụng"}),(0,t.jsx)("h3",{className:"text-3xl font-extrabold mt-1 text-primary",children:ei.toLocaleString()}),(0,t.jsx)("p",{className:"text-xs text-text-muted mt-2",children:"Tokens"})]}),(0,t.jsx)("div",{className:"p-3 bg-primary/10 rounded-xl text-primary",children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[24px]",children:"trending_up"})})]})}),(0,t.jsx)(n.Card,{children:(0,t.jsxs)("div",{className:"flex justify-between items-start",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-sm text-text-muted",children:"Còn lại"}),(0,t.jsx)("h3",{className:"text-3xl font-extrabold mt-1 text-green-500",children:ea?"∞":el.toLocaleString()}),(0,t.jsx)("p",{className:"text-xs text-text-muted mt-2",children:"Tokens"})]}),(0,t.jsx)("div",{className:"p-3 bg-green-500/10 rounded-xl text-green-500",children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[24px]",children:"hourglass_empty"})})]})}),(0,t.jsx)(n.Card,{children:(0,t.jsxs)("div",{className:"flex justify-between items-start",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-sm text-text-muted",children:"Tổng Quota"}),(0,t.jsx)("h3",{className:"text-3xl font-extrabold mt-1",children:ea?"Không giới hạn":eo.toLocaleString()}),(0,t.jsx)("p",{className:"text-xs text-text-muted mt-2",children:"Tokens"})]}),(0,t.jsx)("div",{className:"p-3 bg-surface-3 rounded-xl text-text-muted",children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[24px]",children:"database"})})]})})]}),!ea&&(0,t.jsx)(n.Card,{children:(0,t.jsxs)("div",{className:"space-y-2",children:[(0,t.jsxs)("div",{className:"flex justify-between text-sm",children:[(0,t.jsx)("span",{className:"font-medium",children:"Tỷ lệ tiêu thụ"}),(0,t.jsxs)("span",{className:"font-bold",children:[ec,"%"]})]}),(0,t.jsx)("div",{className:"w-full bg-surface-3 rounded-full h-3 overflow-hidden",children:(0,t.jsx)("div",{className:`h-full rounded-full transition-all duration-500 ${ec>80?"bg-red-500":"bg-primary"}`,style:{width:`${ec}%`}})}),(0,t.jsx)("p",{className:"text-xs text-text-muted",children:"Hạn mức sẽ tự khóa khi đạt đến 100% dung lượng. Vui lòng liên hệ quản trị viên để mua thêm."})]})}),(0,t.jsxs)("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-6",children:[(0,t.jsx)(n.Card,{title:"Chi tiết Key",icon:"info",children:(0,t.jsxs)("div",{className:"space-y-4 mt-2",children:[(0,t.jsxs)("div",{className:"flex justify-between border-b border-border pb-2 text-sm",children:[(0,t.jsx)("span",{className:"text-text-muted",children:"Trạng thái:"}),(0,t.jsxs)("span",{className:"font-semibold text-green-500 flex items-center gap-1",children:[(0,t.jsx)("span",{className:"w-2.5 h-2.5 bg-green-500 rounded-full animate-ping"}),"Hoạt động"]})]}),(0,t.jsxs)("div",{className:"flex justify-between border-b border-border pb-2 text-sm",children:[(0,t.jsx)("span",{className:"text-text-muted",children:"Ngày hết hạn:"}),(0,t.jsx)("span",{className:"font-semibold",children:O.expires_at?new Date(O.expires_at).toLocaleDateString("vi-VN",{year:"numeric",month:"long",day:"numeric"}):"Vô thời hạn"})]}),(0,t.jsxs)("div",{className:"flex justify-between border-b border-border pb-2 text-sm",children:[(0,t.jsx)("span",{className:"text-text-muted",children:"Chi phí ước tính (~USD):"}),(0,t.jsxs)("span",{className:"font-semibold text-primary",children:["$",ed.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4})]})]})]})}),(0,t.jsx)(n.Card,{title:"Giới hạn kỹ thuật",icon:"speed",children:(0,t.jsxs)("div",{className:"space-y-4 mt-2",children:[(0,t.jsxs)("div",{className:"flex justify-between border-b border-border pb-2 text-sm",children:[(0,t.jsx)("span",{className:"text-text-muted",children:"Tần suất tối đa (Rate Limit):"}),(0,t.jsxs)("span",{className:"font-semibold",children:[O.rate_limit_per_minute," requests / phút"]})]}),(0,t.jsxs)("div",{className:"flex justify-between border-b border-border pb-2 text-sm",children:[(0,t.jsx)("span",{className:"text-text-muted",children:"Kết nối đồng thời (Concurrency):"}),(0,t.jsxs)("span",{className:"font-semibold",children:[O.max_concurrent," session(s)"]})]}),(0,t.jsxs)("div",{className:"flex justify-between border-b border-border pb-2 text-sm",children:[(0,t.jsx)("span",{className:"text-text-muted",children:"Định danh Key:"}),(0,t.jsxs)("div",{className:"flex items-center gap-1 font-mono text-xs text-text-muted",children:[(0,t.jsxs)("span",{children:[S.slice(0,10),"...",S.slice(-10)]}),(0,t.jsx)("button",{onClick:()=>en(S,"fullKey"),className:"p-1 hover:bg-surface-3 rounded cursor-pointer",title:"Copy Key",children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"fullKey"===L?"check":"content_copy"})})]})]})]})})]}),(0,t.jsx)(n.Card,{title:z?"Lịch sử yêu cầu (chi tiết)":"Thống kê theo nhà cung cấp",icon:"history",action:H.length>0&&(0,t.jsxs)("button",{onClick:()=>Y(!z),className:"inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border bg-surface hover:bg-surface-2 text-text-main text-xs font-semibold transition-colors cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:z?"leaderboard":"list"}),z?"Xem tổng hợp":"Xem chi tiết"]}),children:F?(0,t.jsxs)("div",{className:"flex flex-col items-center justify-center py-12 text-text-muted",children:[(0,t.jsx)("span",{className:"material-symbols-outlined animate-spin text-[32px] text-primary",children:"sync"}),(0,t.jsx)("p",{className:"text-sm mt-2",children:"Đang tải lịch sử sử dụng..."})]}):0===H.length?(0,t.jsxs)("div",{className:"text-center py-12 text-text-muted",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[36px]",children:"history_toggle_off"}),(0,t.jsx)("p",{className:"text-sm mt-2",children:"Không có lịch sử yêu cầu nào gần đây."})]}):z?(0,t.jsx)("div",{className:"overflow-x-auto -mx-6 px-6 max-h-[400px] overflow-y-auto",children:(0,t.jsxs)("table",{className:"w-full text-left border-collapse text-sm",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{className:"border-b border-border text-text-muted font-medium text-xs uppercase tracking-wider",children:[(0,t.jsx)("th",{className:"pb-3 pr-4",children:"Thời gian"}),(0,t.jsx)("th",{className:"pb-3 px-4",children:"Provider"}),(0,t.jsx)("th",{className:"pb-3 px-4",children:"Model"}),(0,t.jsx)("th",{className:"pb-3 px-4 text-right",children:"Prompt"}),(0,t.jsx)("th",{className:"pb-3 px-4 text-right",children:"Completion"}),(0,t.jsx)("th",{className:"pb-3 pl-4 text-right",children:"Tổng (Billed)"})]})}),(0,t.jsx)("tbody",{children:H.map(e=>{let s=e.created_at?new Date(e.created_at).toLocaleString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit",day:"2-digit",month:"2-digit",year:"numeric"}):"Không rõ",n=er(e.model),r="bg-surface-3 text-text-muted border border-border";return e.model?.includes("gemini")?r="bg-blue-500/10 text-blue-400 border border-blue-500/20":e.model?.includes("gpt")||e.model?.includes("o1")||e.model?.includes("o3")?r="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20":e.model?.includes("claude")?r="bg-amber-500/10 text-amber-400 border border-amber-500/20":e.model?.includes("deepseek")&&(r="bg-purple-500/10 text-purple-400 border border-purple-500/20"),(0,t.jsxs)("tr",{className:"border-b border-border/50 hover:bg-surface-2/30 transition-colors last:border-0",children:[(0,t.jsx)("td",{className:"py-3 pr-4 font-mono text-xs text-text-muted whitespace-nowrap",children:s}),(0,t.jsx)("td",{className:"py-3 px-4 font-medium text-text-main whitespace-nowrap",children:n}),(0,t.jsx)("td",{className:"py-3 px-4 whitespace-nowrap",children:(0,t.jsx)("span",{className:`px-2 py-0.5 rounded-full text-xs font-mono font-medium ${r}`,children:e.model})}),(0,t.jsx)("td",{className:"py-3 px-4 text-right font-mono text-text-muted whitespace-nowrap",children:(e.prompt_tokens||0).toLocaleString()}),(0,t.jsx)("td",{className:"py-3 px-4 text-right font-mono text-text-muted whitespace-nowrap",children:(e.completion_tokens||0).toLocaleString()}),(0,t.jsx)("td",{className:"py-3 pl-4 text-right font-mono font-semibold text-primary whitespace-nowrap",children:(e.billed_tokens||0).toLocaleString()})]},e.id)})})]})}):(0,t.jsx)("div",{className:"overflow-x-auto -mx-6 px-6 max-h-[400px] overflow-y-auto",children:(0,t.jsxs)("table",{className:"w-full text-left border-collapse text-sm",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{className:"border-b border-border text-text-muted font-medium text-xs uppercase tracking-wider",children:[(0,t.jsx)("th",{className:"pb-3 pr-4",children:"Nhà cung cấp"}),(0,t.jsx)("th",{className:"pb-3 px-4 text-center",children:"Yêu cầu"}),(0,t.jsx)("th",{className:"pb-3 px-4",children:"Models đã gọi"}),(0,t.jsx)("th",{className:"pb-3 px-4 text-right",children:"Tổng Prompt"}),(0,t.jsx)("th",{className:"pb-3 px-4 text-right",children:"Tổng Completion"}),(0,t.jsx)("th",{className:"pb-3 pl-4 text-right",children:"Tổng Billed"})]})}),(0,t.jsx)("tbody",{children:ex.map(e=>{let s="text-text-main";return"Google Gemini"===e.name?s="text-blue-400 font-semibold":"OpenAI"===e.name?s="text-emerald-400 font-semibold":"Anthropic"===e.name?s="text-amber-400 font-semibold":"DeepSeek"===e.name?s="text-purple-400 font-semibold":"Antigravity"===e.name?s="text-amber-500 font-semibold":"Codex"===e.name&&(s="text-indigo-400 font-semibold"),(0,t.jsxs)("tr",{className:"border-b border-border/50 hover:bg-surface-2/30 transition-colors last:border-0",children:[(0,t.jsx)("td",{className:`py-4 pr-4 whitespace-nowrap ${s}`,children:e.name}),(0,t.jsx)("td",{className:"py-4 px-4 text-center font-mono whitespace-nowrap",children:e.count.toLocaleString()}),(0,t.jsx)("td",{className:"py-4 px-4 max-w-xs md:max-w-md",children:(0,t.jsx)("div",{className:"flex flex-wrap gap-1",children:e.models.map(e=>{let s="bg-surface-3 text-text-muted border border-border";return e.includes("gemini")?s="bg-blue-500/10 text-blue-400 border border-blue-500/20":e.includes("gpt")||e.includes("o1")||e.includes("o3")?s="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20":e.includes("claude")?s="bg-amber-500/10 text-amber-400 border border-amber-500/20":e.includes("deepseek")&&(s="bg-purple-500/10 text-purple-400 border border-purple-500/20"),(0,t.jsx)("span",{className:`px-2 py-0.5 rounded-full text-xs font-mono font-medium whitespace-nowrap ${s}`,children:e},e)})})}),(0,t.jsx)("td",{className:"py-4 px-4 text-right font-mono text-text-muted whitespace-nowrap",children:e.prompt.toLocaleString()}),(0,t.jsx)("td",{className:"py-4 px-4 text-right font-mono text-text-muted whitespace-nowrap",children:e.completion.toLocaleString()}),(0,t.jsx)("td",{className:"py-4 pl-4 text-right font-mono font-semibold text-primary whitespace-nowrap",children:e.total.toLocaleString()})]},e.name)})})]})})})]}),"guide"===$&&(0,t.jsxs)("div",{className:"space-y-6",children:[(0,t.jsxs)("div",{className:"flex gap-2 border-b border-border/60 pb-3 justify-between items-center flex-wrap gap-y-2",children:[(0,t.jsxs)("div",{className:"flex gap-2",children:["\uFEFF                  ",(0,t.jsx)("button",{onClick:()=>D("codex"),className:`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${"codex"===K?"bg-surface-2 text-primary":"text-text-muted hover:text-text-main"}`,children:"💻 Codex App & IDEs"}),(0,t.jsx)("button",{onClick:()=>D("openclaw"),className:`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${"openclaw"===K?"bg-surface-2 text-primary":"text-text-muted hover:text-text-main"}`,children:"🐾 OpenClaw"}),(0,t.jsx)("button",{onClick:()=>D("gemini"),className:`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${"gemini"===K?"bg-surface-2 text-primary":"text-text-muted hover:text-text-main"}`,children:"🐍 Google Gemini (SDK/API)"})]}),(0,t.jsxs)("button",{onClick:()=>{en("codex"===K?`# Hướng dẫn t\xedch hợp Client (Codex Desktop App & IDEs)

Hệ thống hỗ trợ 2 d\xf2ng model ch\xednh chạy qua cổng API Gateway:
- **Codex (ChatGPT-backed)**: Sử dụng Model ID \`gpt-5.5\`
- **AntiGravity (Gemini-backed)**: Sử dụng Model ID \`gpt-5.4\`

---

## 💻 1. Cấu h\xecnh tr\xean Codex Desktop App / IDE
T\xecm hoặc tạo thư mục cấu h\xecnh của Codex t\xf9y theo hệ điều h\xe0nh:
- **Windows**: \`%%USERPROFILE%%\\.codex\\config.toml\` (V\xed dụ: \`C:\\Users\\t\xean_user\\.codex\\config.toml\`)
- **Mac / Linux**: \`~/.codex/config.toml\`
*(Nếu chưa c\xf3 thư mục \`.codex\`, h\xe3y mở ứng dụng Codex một lần hoặc tự tạo thư mục mới).*

---

## ⚙️ 2. Cấu h\xecnh file config.toml
Tạo hoặc sửa file **config.toml** trong thư mục cấu h\xecnh tr\xean. Bạn chọn 1 trong 2 cấu h\xecnh dưới đ\xe2y tương ứng với model bạn muốn sử dụng l\xe0m model mặc định:

### C\xe1ch A: Cấu h\xecnh sử dụng model Codex (ChatGPT-backed - gpt-5.5)
\`\`\`toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "\${savedKey}"
name = "VinAi"
base_url = "\${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
\`\`\`

### C\xe1ch B: Cấu h\xecnh sử dụng model AntiGravity (Gemini-backed - gpt-5.4)
\`\`\`toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "\${savedKey}"
name = "VinAi"
base_url = "\${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
\`\`\`

---

## 🔑 3. Cấu h\xecnh file auth.json (Bypass Login)
Tạo tiếp file **auth.json** trong c\xf9ng thư mục \`.codex\` để bypass m\xe0n h\xecnh đăng nhập:
\`\`\`json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "\${savedKey}"
}
\`\`\`

*Lưu \xfd: Tắt ho\xe0n to\xe0n ứng dụng Codex Desktop App v\xe0 mở lại để \xe1p dụng cấu h\xecnh.*

---

## 🚀 4. Cấu h\xecnh tr\xean Cursor / Cline / RooCode (OpenAI Compatible)
Bạn cũng c\xf3 thể sử dụng c\xe1c c\xf4ng cụ lập tr\xecnh AI kh\xe1c kết nối với cổng Gateway th\xf4ng qua API tương th\xedch OpenAI:

### Cấu h\xecnh chung tr\xean IDE:
- **Provider**: Chọn \`OpenAI Compatible\` (hoặc Custom OpenAI)
- **Base URL**: \`\${origin}/v1\`
- **API Key**: Client Key của bạn (\`\${savedKey}\`)

### Lựa chọn Model ID:
- **Model Codex**: Nhập Model ID \`gpt-5.5\`
- **Model AntiGravity**: Nhập Model ID \`gpt-5.4\``:"openclaw"===K?`# Hướng dẫn cấu h\xecnh OpenClaw

Cấu h\xecnh OpenClaw để gọi qua API Gateway sử dụng c\xe1c model t\xedch hợp.

---

## 🛠️ 1. Cấu h\xecnh tự động từ Dashboard
Nếu bạn chạy OpenClaw cục bộ tr\xean c\xf9ng m\xe1y chủ 9Router:
1. Truy cập giao diện quản trị 9Router: **Dashboard** -> **CLI Tools** -> **OpenClaw**.
2. Chọn m\xf4 h\xecnh bạn muốn sử dụng v\xe0 nhấn **\xc1p dụng**. Hệ thống sẽ tự động ghi đ\xe8 tệp cấu h\xecnh của OpenClaw.

---

## 📄 2. Cấu h\xecnh thủ c\xf4ng qua openclaw.json
Nếu bạn muốn cấu h\xecnh thủ c\xf4ng hoặc chạy OpenClaw từ xa:
1. Mở hoặc tạo tệp cấu h\xecnh của OpenClaw theo hệ điều h\xe0nh:
   - **Windows**: \`%%USERPROFILE%%\\.openclaw\\openclaw.json\` (V\xed dụ: \`C:\\Users\\t\xean_user\\.openclaw\\openclaw.json\`)
   - **Mac / Linux**: \`~/.openclaw/openclaw.json\`
2. Chỉnh sửa tệp **openclaw.json** v\xe0 d\xe1n nội dung cấu h\xecnh nh\xe0 cung cấp \`9router\` v\xe0o phần \`models.providers\` (sử dụng \`gpt-5.5\` hoặc \`gpt-5.4\`):
\`\`\`json
{
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "${E}/v1",
        "apiKey": "${S}",
        "api": "openai-completions",
        "models": [
          { "id": "gpt-5.5", "name": "gpt-5.5" },
          { "id": "gpt-5.4", "name": "gpt-5.4" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/gpt-5.5"
      },
      "models": {
        "9router/gpt-5.5": {},
        "9router/gpt-5.4": {}
      }
    }
  }
}
\`\`\`
3. Khởi động lại **OpenClaw CLI** để \xe1p dụng cấu h\xecnh mới.`:`# Hướng dẫn t\xedch hợp trực tiếp Google Gemini

Bạn c\xf3 thể gọi v\xe0 t\xedch hợp trực tiếp c\xe1c model Google Gemini ch\xednh thức (v\xed dụ: \`gemini-2.5-flash\`, \`gemini-1.5-pro\`) th\xf4ng qua API Gateway bằng c\xe1c c\xe1ch dưới đ\xe2y:

---

## 🐍 1. Sử dụng Google GenAI SDK (Thư viện Gemini ch\xednh thức)
C\xe0i đặt thư viện ch\xednh thức của Google:
\`\`\`bash
pip install google-genai
\`\`\`

Sau đ\xf3 chạy đoạn m\xe3 Python dưới đ\xe2y. Thiết lập \`api_endpoint\` trỏ về địa chỉ Gateway của bạn:
\`\`\`python
from google import genai
from google.genai import types

client = genai.Client(
    api_key="\${savedKey}",
    http_options={"api_endpoint": "\${origin}"}
)

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Xin ch\xe0o! Bạn l\xe0 ai?"
)

print(response.text)
\`\`\`

---

## 🤖 2. Sử dụng OpenAI SDK tương th\xedch
C\xe0i đặt thư viện: \`pip install openai\`
\`\`\`python
import openai

client = openai.OpenAI(
    base_url="\${origin}/v1",
    api_key="\${savedKey}"
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Xin ch\xe0o! Bạn l\xe0 ai?"}
    ]
)

print(response.choices[0].message.content)
\`\`\`

---

## 📡 3. Gọi qua REST API Gemini gốc (cURL)
Bạn cũng c\xf3 thể gọi trực tiếp Endpoint tương th\xedch định dạng API của Google AI Studio:
\`\`\`bash
curl -X POST "\${origin}/v1beta/models/gemini-2.5-flash:generateContent?key=\${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '\\{
    "contents": [\\{
      "parts": [\\{
        "text": "Hello!"
      \\}]
    \\}]
  \\}'
\`\`\``,"fullMarkdown")},className:"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-text-main text-xs font-semibold transition-colors cursor-pointer animate-fade-in",title:"Sao chép toàn bộ hướng dẫn bằng định dạng Markdown",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[16px]",children:"fullMarkdown"===L?"check":"content_copy"}),"fullMarkdown"===L?"Đã sao chép!":"Copy Full Markdown"]})]}),"\uFEFF              ","codex"===K&&(0,t.jsxs)("div",{className:"space-y-6 animate-fade-in",children:[(0,t.jsx)(n.Card,{title:"⚙️ Thông số kết nối API cơ bản",icon:"api",children:(0,t.jsxs)("div",{className:"space-y-3 text-sm text-text-muted mt-2",children:[(0,t.jsx)("p",{children:"Sử dụng các thông số dưới đây để cấu hình thủ công hoặc điền vào các công cụ lập trình hỗ trợ Custom Base URL:"}),(0,t.jsxs)("div",{className:"bg-surface-2 border border-border rounded-lg p-4 space-y-3 text-text-main",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("strong",{children:"Base URL (Endpoint):"}),(0,t.jsxs)("code",{className:"bg-surface px-2 py-0.5 rounded border border-border text-xs ml-2 font-mono",children:[E,"/v1"]})]}),(0,t.jsxs)("button",{onClick:()=>en(`${E}/v1`,"urlBaseCodex"),className:"inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"urlBaseCodex"===L?"check":"content_copy"}),"urlBaseCodex"===L?"Đã copy":"Copy"]})]}),(0,t.jsxs)("div",{className:"flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("strong",{children:"API Key:"}),(0,t.jsx)("code",{className:"bg-surface px-2 py-0.5 rounded border border-border text-xs ml-2 font-mono",children:S})]}),(0,t.jsxs)("button",{onClick:()=>en(S,"keyBaseCodex"),className:"inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"keyBaseCodex"===L?"check":"content_copy"}),"keyBaseCodex"===L?"Đã copy":"Copy"]})]}),(0,t.jsxs)("div",{className:"space-y-1 text-xs text-text-muted",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("strong",{children:"Model Codex (ChatGPT-backed):"})," ",(0,t.jsx)("code",{className:"bg-surface px-1.5 py-0.5 rounded border border-border text-text-main font-mono",children:"gpt-5.5"})]}),(0,t.jsxs)("div",{className:"mt-1",children:[(0,t.jsx)("strong",{children:"Model AntiGravity (Gemini-backed):"})," ",(0,t.jsx)("code",{className:"bg-surface px-1.5 py-0.5 rounded border border-border text-text-main font-mono text-red-500 line-through",children:"gpt-5.4 (Cũ - Không khuyên dùng)"})]})]})]})]})}),(0,t.jsx)(n.Card,{title:"🚀 1-Click MITM Proxy (Khuyên dùng cho Antigravity IDE)",icon:"bolt",children:(0,t.jsxs)("div",{className:"space-y-3 text-sm text-text-muted mt-2",children:[(0,t.jsxs)("div",{className:"p-3 bg-indigo-50/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-400",children:[(0,t.jsx)("strong",{children:"💡 Lợi ích vượt trội:"})," Bạn sẽ được sử dụng trực tiếp extension ",(0,t.jsx)("strong",{children:"Antigravity IDE chính thức"})," trên VS Code mà không cần phải đổi file cấu hình hay chỉnh sửa model thành ",(0,t.jsx)("code",{children:"gpt-5.4"})," nữa. MITM Proxy sẽ tự động định tuyến toàn bộ yêu cầu qua cổng an toàn."]}),(0,t.jsx)("p",{children:"Tải xuống tệp cấu hình tự động 1-Click (MITM Proxy) tương ứng với hệ điều hành của bạn:"}),(0,t.jsxs)("div",{className:"flex flex-wrap gap-3 mt-3",children:[(0,t.jsxs)("a",{href:`/api/client-keys/${O.id}/setup-script?platform=windows&mode=mitm`,download:"setup-mitm-9router.bat",className:"inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[18px]",children:"download"}),"Tải MITM (.bat) cho Windows"]}),(0,t.jsxs)("a",{href:`/api/client-keys/${O.id}/setup-script?platform=mac&mode=mitm`,download:"setup-mitm-9router.sh",className:"inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-indigo-500/30 bg-surface hover:bg-surface-2 text-indigo-400 text-sm font-semibold transition-colors cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[18px]",children:"download"}),"Tải MITM (.sh) cho Mac/Linux"]})]}),(0,t.jsxs)("div",{className:"text-xs text-text-muted bg-surface-2 border border-border rounded-lg p-3.5 mt-2 space-y-2",children:[(0,t.jsx)("p",{className:"font-semibold text-text-main",children:"📋 Các bước sử dụng chi tiết:"}),(0,t.jsxs)("ol",{className:"list-decimal pl-5 space-y-1.5",children:[(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Chạy script với quyền quản trị:"}),(0,t.jsxs)("ul",{className:"list-disc pl-5 mt-1 space-y-1",children:[(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Windows:"})," Click chuột phải vào file ",(0,t.jsx)("code",{className:"bg-surface px-1 py-0.5 rounded border border-border text-text-main font-mono",children:"setup-mitm-9router.bat"})," và chọn ",(0,t.jsx)("strong",{children:'"Run as Administrator"'})," (Quyền Admin bắt buộc để cài CA Cert và sửa file hosts)."]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Mac/Linux:"})," Mở Terminal, cấp quyền chạy và thực thi bằng lệnh sudo:",(0,t.jsx)("pre",{className:"bg-surface border border-border rounded-md p-2 mt-1 font-mono text-text-main overflow-x-auto",children:"chmod +x setup-mitm-9router.sh && ./setup-mitm-9router.sh"})]})]})]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Giữ cửa sổ terminal mở:"})," Khi chạy, script sẽ tự khởi động server 9Router local và bật MITM Proxy. Hãy thu nhỏ cửa sổ terminal này xuống thanh taskbar, không được đóng lại khi đang viết code."]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Mở VS Code và code:"})," Bây giờ toàn bộ luồng request từ extension Antigravity chính thức trên IDE của bạn đã được chuyển thẳng qua hệ thống của chúng tôi."]})]})]})]})}),(0,t.jsx)(n.Card,{title:"⚡ Tự động cấu hình 1-Click cho AntiGravity (Cũ - Không khuyên dùng)",icon:"history",children:(0,t.jsxs)("div",{className:"space-y-3 text-sm text-text-muted mt-2",children:[(0,t.jsxs)("div",{className:"p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400",children:["⚠️ ",(0,t.jsx)("strong",{children:"Lưu ý quan trọng:"})," Từ phiên bản này, cách cấu hình file ",(0,t.jsx)("code",{children:"config.toml"})," của Antigravity với model ",(0,t.jsx)("code",{children:"gpt-5.4"})," ",(0,t.jsx)("strong",{children:"không còn được khuyên dùng"})," do không hỗ trợ đầy đủ các tính năng IDE mới nhất. Hãy dùng giải pháp ",(0,t.jsx)("strong",{children:"MITM Proxy"})," ở trên."]}),(0,t.jsx)("p",{children:"Nếu bạn vẫn cần dùng cách cấu hình file thủ công cũ, tải tệp sau:"}),(0,t.jsxs)("div",{className:"flex flex-wrap gap-3 mt-3",children:[(0,t.jsxs)("a",{href:`/api/client-keys/${O.id}/setup-script?platform=windows`,download:"setup-antigravity.bat",className:"inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface border border-border hover:bg-surface-2 text-text-main text-xs transition-colors cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[16px]",children:"download"}),"Tải cấu hình (.bat) Windows cũ"]}),(0,t.jsxs)("a",{href:`/api/client-keys/${O.id}/setup-script?platform=mac`,download:"setup-antigravity.sh",className:"inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-surface hover:bg-surface-2 text-text-main text-xs transition-colors cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[16px]",children:"download"}),"Tải cấu hình (.sh) Mac/Linux cũ"]})]})]})}),(0,t.jsx)(n.Card,{title:"💻 Cấu hình trên Codex Desktop App / IDE",icon:"laptop_mac",children:(0,t.jsxs)("div",{className:"space-y-4 text-sm text-text-muted mt-2",children:[(0,t.jsx)("p",{children:"Sử dụng ứng dụng Codex Desktop App và tự động bypass màn hình login:"}),(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-xs mb-2 font-semibold text-text-main",children:"1. Tìm hoặc tạo thư mục cấu hình của Codex:"}),(0,t.jsxs)("ul",{className:"list-disc pl-5 text-xs mb-3 space-y-1",children:[(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Windows"}),": ",(0,t.jsx)("code",{children:"%USERPROFILE%\\.codex\\config.toml"})," (Ví dụ: ",(0,t.jsx)("code",{children:"C:\\Users\\tên_user\\.codex\\config.toml"}),")"]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Mac / Linux"}),": ",(0,t.jsx)("code",{children:"~/.codex/config.toml"})]})]}),(0,t.jsxs)("div",{className:"space-y-4",children:[(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1.5",children:[(0,t.jsx)("span",{className:"text-xs font-semibold text-text-main",children:"Cấu hình file config.toml cho model Codex (gpt-5.5):"}),(0,t.jsxs)("button",{onClick:()=>en(`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${S}"
name = "VinAi"
base_url = "${E}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`,"tomlConfigCodex"),className:"inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"tomlConfigCodex"===L?"check":"content_copy"}),"tomlConfigCodex"===L?"Đã copy":"Copy"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${S}"
name = "VinAi"
base_url = "${E}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`})]}),(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1.5",children:[(0,t.jsx)("span",{className:"text-xs font-semibold text-text-main",children:"Cấu hình file config.toml cho model AntiGravity (gpt-5.4):"}),(0,t.jsxs)("button",{onClick:()=>en(`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${S}"
name = "VinAi"
base_url = "${E}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`,"tomlConfigAG"),className:"inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"tomlConfigAG"===L?"check":"content_copy"}),"tomlConfigAG"===L?"Đã copy":"Copy"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${S}"
name = "VinAi"
base_url = "${E}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`})]})]})]}),(0,t.jsxs)("div",{className:"pt-2 border-t border-border/40",children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1.5",children:[(0,t.jsx)("p",{className:"text-xs font-semibold text-text-main",children:"2. Tạo tiếp file auth.json trong cùng thư mục để bypass login:"}),(0,t.jsxs)("button",{onClick:()=>en(`{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "${S}"
}`,"authConfigCodex"),className:"inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"authConfigCodex"===L?"check":"content_copy"}),"authConfigCodex"===L?"Đã copy":"Copy"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "${S}"
}`})]}),(0,t.jsxs)("p",{className:"text-xs italic text-text-muted bg-surface-2 p-2.5 rounded-lg border border-border/60",children:["💡 Lưu ý: Tắt hoàn toàn ứng dụng ",(0,t.jsx)("strong",{children:"Codex Desktop App"})," và mở lại để áp dụng cấu hình mới. Cả 2 cách cấu hình trên đều gọi trực tiếp về hệ thống Codex của bạn."]})]})}),(0,t.jsx)(n.Card,{title:"🚀 Cấu hình trên Cursor / Cline / RooCode (OpenAI Compatible)",icon:"rocket",children:(0,t.jsxs)("div",{className:"space-y-4 text-sm text-text-muted mt-2",children:[(0,t.jsx)("p",{children:"Bạn có thể sử dụng trực tiếp khóa API này trên các IDE phổ biến để gọi model qua Gateway:"}),(0,t.jsxs)("div",{className:"space-y-3",children:[(0,t.jsx)("h4",{className:"font-semibold text-text-main text-xs",children:"Cấu hình chung:"}),(0,t.jsxs)("ul",{className:"list-disc pl-5 space-y-1 text-xs",children:[(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Provider:"})," Chọn ",(0,t.jsx)("code",{children:"OpenAI Compatible"})," (hoặc Custom OpenAI)"]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Base URL:"})," Điền ",(0,t.jsxs)("code",{children:[E,"/v1"]})]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"API Key:"})," Điền Client Key của bạn (",(0,t.jsx)("code",{children:S}),")"]})]})]}),(0,t.jsxs)("div",{className:"space-y-3 pt-3 border-t border-border/40",children:[(0,t.jsx)("h4",{className:"font-semibold text-text-main text-xs",children:"Lựa chọn Model ID:"}),(0,t.jsxs)("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-3",children:[(0,t.jsxs)("div",{className:"bg-surface-2 border border-border rounded-lg p-3",children:[(0,t.jsx)("strong",{className:"text-xs text-text-main block mb-1",children:"Model Codex (ChatGPT-backed)"}),(0,t.jsxs)("span",{className:"text-xs text-text-muted",children:["Nhập Model ID: ",(0,t.jsx)("code",{className:"bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold",children:"gpt-5.5"})]})]}),(0,t.jsxs)("div",{className:"bg-surface-2 border border-border rounded-lg p-3",children:[(0,t.jsx)("strong",{className:"text-xs text-text-main block mb-1",children:"Model AntiGravity (Gemini-backed)"}),(0,t.jsxs)("span",{className:"text-xs text-text-muted",children:["Nhập Model ID: ",(0,t.jsx)("code",{className:"bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold",children:"gpt-5.4"})]})]})]})]})]})})]}),"openclaw"===K&&(0,t.jsxs)("div",{className:"space-y-6 animate-fade-in",children:[(0,t.jsx)(n.Card,{title:"🛠️ 1. Cấu hình tự động từ Dashboard",icon:"construction",children:(0,t.jsxs)("div",{className:"space-y-3 text-sm text-text-muted mt-2",children:[(0,t.jsx)("p",{children:"Nếu bạn cài đặt OpenClaw cục bộ trên cùng máy chủ với 9Router:"}),(0,t.jsxs)("ul",{className:"list-disc pl-5 space-y-1 text-text-muted",children:[(0,t.jsxs)("li",{children:["Truy cập vào giao diện quản trị 9Router: ",(0,t.jsx)("strong",{children:"Dashboard"})," → ",(0,t.jsx)("strong",{children:"CLI Tools"})," → ",(0,t.jsx)("strong",{children:"OpenClaw"}),"."]}),(0,t.jsxs)("li",{children:["Chọn mô hình bạn mong muốn sử dụng và nhấn ",(0,t.jsx)("strong",{children:"Áp dụng"}),". Hệ thống sẽ tự động ghi đè tệp cấu hình của OpenClaw một cách chính xác."]})]})]})}),(0,t.jsx)(n.Card,{title:"💻 2. Cài đặt và Cấu hình thủ công",icon:"laptop_mac",children:(0,t.jsxs)("div",{className:"space-y-4 text-sm text-text-muted mt-2",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-xs mb-2",children:"1. Tìm hoặc tạo tệp cấu hình của OpenClaw tùy theo hệ điều hành:"}),(0,t.jsxs)("ul",{className:"list-disc pl-5 text-xs mb-2 space-y-1",children:[(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Windows"}),": ",(0,t.jsx)("code",{children:"%USERPROFILE%\\.openclaw\\openclaw.json"})," (Ví dụ: ",(0,t.jsx)("code",{children:"C:\\Users\\tên_user\\.openclaw\\openclaw.json"}),")"]}),(0,t.jsxs)("li",{children:[(0,t.jsx)("strong",{children:"Mac / Linux"}),": ",(0,t.jsx)("code",{children:"~/.openclaw/openclaw.json"})]})]}),(0,t.jsxs)("p",{className:"text-xs mb-2",children:["2. Chỉnh sửa tệp ",(0,t.jsx)("code",{children:"openclaw.json"})," và dán nội dung cấu hình nhà cung cấp ",(0,t.jsx)("code",{children:"9router"})," vào phần ",(0,t.jsx)("code",{children:"models.providers"}),":"]}),(0,t.jsxs)("div",{className:"relative bg-surface-2 border border-border rounded-lg p-3 font-mono text-xs text-text-main overflow-x-auto pr-12",children:[(0,t.jsx)("pre",{children:`{
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "${E}/v1",
        "apiKey": "${S}",
        "api": "openai-completions",
        "models": [
          { "id": "gpt-5.5", "name": "gpt-5.5" },
          { "id": "gpt-5.4", "name": "gpt-5.4" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/gpt-5.5"
      },
      "models": {
        "9router/gpt-5.5": {},
        "9router/gpt-5.4": {}
      }
    }
  }
}`}),(0,t.jsx)("button",{onClick:()=>en(`{
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "${E}/v1",
        "apiKey": "${S}",
        "api": "openai-completions",
        "models": [
          { "id": "gpt-5.5", "name": "gpt-5.5" },
          { "id": "gpt-5.4", "name": "gpt-5.4" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/gpt-5.5"
      },
      "models": {
        "9router/gpt-5.5": {},
        "9router/gpt-5.4": {}
      }
    }
  }
}`,"jsonConfigOpenClaw"),className:"absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer",title:"Copy cấu hình openclaw.json",children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[14px]",children:"jsonConfigOpenClaw"===L?"check":"content_copy"})})]})]}),(0,t.jsxs)("p",{className:"text-xs",children:["3. Khởi động lại ",(0,t.jsx)("strong",{children:"OpenClaw CLI"})," để áp dụng cấu hình mới."]})]})})]}),"gemini"===K&&(0,t.jsxs)("div",{className:"space-y-6 animate-fade-in",children:[(0,t.jsx)(n.Card,{title:"🐍 Tích hợp trực tiếp bằng Code (Python)",icon:"code",children:(0,t.jsxs)("div",{className:"space-y-4 text-sm text-text-muted mt-2",children:[(0,t.jsx)("p",{children:"Sử dụng thư viện chính thức hoặc thư viện tương thích OpenAI để gọi trực tiếp các model Gemini:"}),(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1",children:[(0,t.jsx)("span",{className:"font-semibold text-text-main text-xs",children:"Option 1: Sử dụng Google GenAI SDK (Thư viện chính thức):"}),(0,t.jsxs)("button",{onClick:()=>{en(`from google import genai\\n\\nclient = genai.Client(\\n    api_key="${S}",\\n    http_options={"api_endpoint": "${E}"}
)\\n\\nresponse = client.models.generate_content(\\n    model="gemini-2.5-flash",\\n    contents="Xin ch\xe0o! Bạn l\xe0 ai?"\\n)\\nprint(response.text)`,"codePythonGeminiSDK")},className:"inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[12px]",children:"codePythonGeminiSDK"===L?"check":"content_copy"}),"codePythonGeminiSDK"===L?"Đã copy":"Copy Code"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`from google import genai

client = genai.Client(
    api_key="${S}",
    http_options={"api_endpoint": "${E}"}
)

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Xin ch\xe0o! Bạn l\xe0 ai?"
)
print(response.text)`})]}),(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1",children:[(0,t.jsx)("span",{className:"font-semibold text-text-main text-xs",children:"Option 2: Sử dụng OpenAI SDK (Thư viện tương thích):"}),(0,t.jsxs)("button",{onClick:()=>{en(`import openai\\n\\nclient = openai.OpenAI(\\n    base_url="${E}/v1",\\n    api_key="${S}"\\n)\\n\\nresponse = client.chat.completions.create(\\n    model="gemini-2.5-flash",\\n    messages=[{"role": "user", "content": "Xin ch\xe0o! Bạn l\xe0 ai?"}]\\n)\\nprint(response.choices[0].message.content)`,"codePythonGeminiOpenAI")},className:"inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[12px]",children:"codePythonGeminiOpenAI"===L?"check":"content_copy"}),"codePythonGeminiOpenAI"===L?"Đã copy":"Copy Code"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`import openai

client = openai.OpenAI(
    base_url="${E}/v1",
    api_key="${S}"
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Xin ch\xe0o! Bạn l\xe0 ai?"}]
)
print(response.choices[0].message.content)`})]})]})}),(0,t.jsx)(n.Card,{title:"📡 Gọi nhanh qua cURL (Terminal)",icon:"terminal",children:(0,t.jsxs)("div",{className:"space-y-4 text-sm text-text-muted mt-2",children:[(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1",children:[(0,t.jsx)("span",{className:"font-semibold text-text-main text-xs",children:"Option 1: Gọi qua định dạng OpenAI Chat Completions:"}),(0,t.jsxs)("button",{onClick:()=>{en(`curl ${E}/v1/chat/completions \\\\n  -H "Content-Type: application/json" \\\\n  -H "Authorization: Bearer ${S}" \\\\n  -d '{\\n    "model": "gemini-2.5-flash",\\n    "messages": [{"role": "user", "content": "Xin ch\xe0o!"}]\\n  }'`,"curlGeminiOpenAI")},className:"inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[12px]",children:"curlGeminiOpenAI"===L?"check":"content_copy"}),"curlGeminiOpenAI"===L?"Đã copy":"Copy Code"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`curl ${E}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${S}" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Xin ch\xe0o!"}]
  }'`})]}),(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"flex justify-between items-center mb-1",children:[(0,t.jsx)("span",{className:"font-semibold text-text-main text-xs",children:"Option 2: Gọi qua REST API Gemini gốc (cURL):"}),(0,t.jsxs)("button",{onClick:()=>{en(`curl -X POST "${E}/v1beta/models/gemini-2.5-flash:generateContent?key=${S}" \\\\n  -H "Content-Type: application/json" \\\\n  -d '{\\n    "contents": [{"parts": [{"text": "Hello!"}]}]\\n  }'`,"curlGeminiREST")},className:"inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer",children:[(0,t.jsx)("span",{className:"material-symbols-outlined text-[12px]",children:"curlGeminiREST"===L?"check":"content_copy"}),"curlGeminiREST"===L?"Đã copy":"Copy Code"]})]}),(0,t.jsx)("pre",{className:"bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono",children:`curl -X POST "${E}/v1beta/models/gemini-2.5-flash:generateContent?key=${S}" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Hello!"}]}]
  }'`})]})]})})]})]})]})]}):null===b?(0,t.jsx)("div",{className:"min-h-screen flex items-center justify-center bg-bg p-4",children:(0,t.jsxs)("div",{className:"text-center",children:[(0,t.jsx)("div",{className:"inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"}),(0,t.jsx)("p",{className:"text-text-muted mt-4",children:"Loading..."})]})}):(0,t.jsxs)("div",{className:"min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden",children:[(0,t.jsx)("div",{className:"landing-grid absolute inset-0 pointer-events-none","aria-hidden":"true"}),(0,t.jsxs)("div",{className:"relative z-10 w-full max-w-md",children:[(0,t.jsxs)("div",{className:"text-center mb-8",children:[(0,t.jsx)("h1",{className:"text-3xl font-bold text-primary mb-2",children:"9Router Portal"}),(0,t.jsx)("p",{className:"text-text-muted",children:"Nhập Admin Key hoặc API Key để tiếp tục"})]}),(0,t.jsx)(n.Card,{children:k?(0,t.jsxs)("form",{onSubmit:es,className:"flex flex-col gap-4",children:[(0,t.jsx)("p",{className:"text-sm text-amber-600 dark:text-amber-400 text-center",children:"Set a new password before accessing the dashboard remotely."}),(0,t.jsxs)("div",{className:"flex flex-col gap-2",children:[(0,t.jsx)("label",{className:"text-sm font-medium",children:"New password"}),(0,t.jsx)(i.Input,{type:"password",placeholder:"Enter new password",value:A,onChange:e=>I(e.target.value),required:!0,autoFocus:!0}),c&&(0,t.jsx)("p",{className:"text-xs text-red-500",children:c})]}),(0,t.jsx)(r.Button,{type:"submit",variant:"primary",className:"w-full",loading:u,disabled:!A,children:"Set password"})]}):(0,t.jsxs)("div",{className:"flex flex-col gap-4",children:[em&&(0,t.jsx)(r.Button,{type:"button",variant:"primary",className:"w-full",onClick:()=>{window.location.href="/api/auth/oidc/start"},children:C}),em&&eh&&(0,t.jsx)("div",{className:"h-px bg-border/60"}),eh?(0,t.jsxs)("form",{onSubmit:et,className:"flex flex-col gap-4",children:[("oidc"===j&&!N||"both"===j&&!N)&&(0,t.jsx)("p",{className:"text-xs text-amber-600 dark:text-amber-400 text-center",children:"OIDC login is enabled, but issuer fields are not configured yet. Password login is still available."}),(0,t.jsxs)("div",{className:"flex flex-col gap-2",children:[(0,t.jsx)("label",{className:"text-sm font-medium",children:"Khóa truy cập"}),(0,t.jsxs)("div",{className:"relative",children:[(0,t.jsx)(i.Input,{type:B?"text":"password",placeholder:"Nhập Admin Key hoặc API Key...",value:a,onChange:e=>l(e.target.value),required:!0,autoFocus:!em,className:"pr-10"}),(0,t.jsx)("button",{type:"button",className:"absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main cursor-pointer",onClick:()=>q(!B),tabIndex:-1,children:(0,t.jsx)("span",{className:"material-symbols-outlined text-[18px] select-none",children:B?"visibility_off":"visibility"})})]}),c&&(0,t.jsx)("p",{className:"text-xs text-red-500",children:c}),h>0&&(0,t.jsxs)("p",{className:"text-xs text-amber-600 dark:text-amber-400",children:["Locked. Retry in ",(0,t.jsxs)("span",{className:"font-mono",children:[h,"s"]}),"."]}),x&&(0,t.jsxs)("p",{className:"text-xs text-text-muted",children:["Forgot password? Open ",(0,t.jsx)("code",{className:"bg-sidebar px-1 rounded",children:"9router"})," CLI on the host → ",(0,t.jsx)("b",{children:"Settings"})," → ",(0,t.jsx)("b",{children:"Reset Password to Default"}),"."]})]}),(0,t.jsx)(r.Button,{type:"submit",variant:"primary",className:"w-full",loading:u,disabled:h>0,children:h>0?`Wait ${h}s`:"Đăng nhập"}),!1===b&&(0,t.jsx)("p",{className:"text-xs text-center text-amber-600 dark:text-amber-400",children:"Security risk: no password set. You will be asked to set one when logging in remotely."})]}):c&&(0,t.jsx)("p",{className:"text-xs text-red-500",children:c})]})})]})]})}])}]);
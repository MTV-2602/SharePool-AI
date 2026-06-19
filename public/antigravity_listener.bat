@echo off
title Antigravity OAuth Listener
echo ===================================================
echo   Antigravity Google OAuth Redirect Listener
echo ===================================================
echo.
echo  [1/2] Dang lang nghe dang nhap tai: http://localhost:1455/auth/callback/
echo  [2/2] Vui long nhap chuot vao nut dang nhap tren trinh duyet.
echo.
echo  Dang cho Google tra ve ket qua...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=1455; $listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:'+$port+'/auth/callback/'); $listener.Start(); $context = $listener.GetContext(); $res = $context.Response; $res.Headers.Add('Content-Type', 'text/html; charset=utf-8'); $html = '<html><body style=\"font-family:sans-serif;text-align:center;padding:40px;\"><h2 style=\"color:#10b981;\">OAuth Captured!</h2><p>Da nhan duoc ma xac thuc tu Google. Ban co the dong tab nay va quay lai ung dung.</p><script>if(window.opener){window.opener.postMessage({type:\"oauth_callback\",data:{code:new URLSearchParams(window.location.search).get(\"code\"),state:new URLSearchParams(window.location.search).get(\"state\")}},\"*\");setTimeout(function(){window.close()},1000)}</script></body></html>\'; $buffer = [System.Text.Encoding]::UTF8.GetBytes($html); $res.ContentLength64 = $buffer.Length; $res.OutputStream.Write($buffer, 0, $buffer.Length); $res.Close(); $listener.Stop();"

echo.
echo  [XONG] Da tu dong truyen ma xac thuc ve ung dung va hoan tat ket noi!
echo.
pause

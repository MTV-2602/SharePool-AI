@echo off
title Antigravity OAuth Loop Listener
echo ===================================================
echo   Antigravity Google OAuth Loop Listener
echo ===================================================
echo.
echo  [*] Dang lang nghe lien tuc tai: http://localhost:1455/auth/callback/
echo  [*] Luon chay ngam de ban co the dang nhap nhieu tai khoan lien tiep.
echo  [*] Nhan [Ctrl + C] trong cua so nay de dung lai.
echo.
echo  Dang cho Google gui thong tin dang nhap...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=1455; $listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:'+$port+'/auth/callback/'); $listener.Start(); Write-Host 'Cua so nay se luon chay de ban dang nhap nhieu acc. An Ctrl+C de tat.'; while ($true) { try { $context = $listener.GetContext(); $res = $context.Response; $res.Headers.Add('Content-Type', 'text/html; charset=utf-8'); $html = '<html><body style=\"font-family:sans-serif;text-align:center;padding:40px;\"><h2 style=\"color:#10b981;\">OAuth Captured!</h2><p>Da nhan duoc ma xac thuc tu Google. Ban co the dong tab nay va tiep tuc dang nhap tai khoan khac.</p><script>if(window.opener){window.opener.postMessage({type:\"oauth_callback\",data:{code:new URLSearchParams(window.location.search).get(\"code\"),state:new URLSearchParams(window.location.search).get(\"state\")}},\"*\");setTimeout(function(){window.close()},1000)}</script></body></html>\'; $buffer = [System.Text.Encoding]::UTF8.GetBytes($html); $res.ContentLength64 = $buffer.Length; $res.OutputStream.Write($buffer, 0, $buffer.Length); $res.Close(); Write-Host ('Da bat va gui thanh cong 1 tai khoan luc: ' + (Get-Date -Format 'HH:mm:ss')); } catch { Write-Host 'Co loi xay ra nhung van tiep tuc lang nghe...' } } $listener.Stop();"

pause

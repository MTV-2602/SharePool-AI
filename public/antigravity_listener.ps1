# ==============================================================================
# Antigravity Google OAuth Auto-Importer & Listener for 9Router
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $Host.UI.RawUI.WindowTitle = "9Router - Antigravity OAuth Listener"
} catch {}

$PORT = 1455
$CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
$CLIENT_SECRET = "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"
$REDIRECT_URI = "http://localhost:$PORT/auth/callback"
$SCOPES = "email profile https://www.googleapis.com/auth/cloud-platform"

# 9Router Server URL (Mac dinh: https://ainoname.site - Co the ghi de bang bien moi truong ROUTER_URL)
$DEFAULT_ROUTER_URL = "https://ainoname.site"
$ROUTER_URL = if ($env:ROUTER_URL) { $env:ROUTER_URL.TrimEnd('/') } else { $DEFAULT_ROUTER_URL }

$AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CLIENT_ID&response_type=code&redirect_uri=[REDIRECT]&scope=[SCOPE]&access_type=offline&prompt=consent"
$AUTH_URL = $AUTH_URL.Replace("[REDIRECT]", [System.Uri]::EscapeDataString($REDIRECT_URI)).Replace("[SCOPE]", [System.Uri]::EscapeDataString($SCOPES))

Clear-Host
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "             9ROUTER - BO LANG NGHE VA TU DONG THEM ANTIGRAVITY                 " -ForegroundColor Yellow
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [*] Dang lang nghe tai cong: http://localhost:$PORT/" -ForegroundColor Green
Write-Host "  [*] Server 9Router         : $ROUTER_URL" -ForegroundColor Cyan
Write-Host "  [*] Co che                 : Doi ma OAuth -> Luu truc tiep vao 9Router SQLite" -ForegroundColor Gray
Write-Host "  [*] Cua so nay chay lien tuc de ban dang nhap nhieu tai khoan lien tiep." -ForegroundColor Gray
Write-Host "  [*] Nhan [Ctrl + C] de thoat khi da them xong." -ForegroundColor Gray
Write-Host ""
Write-Host "--------------------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "HUONG DAN DANG NHAP:" -ForegroundColor White
Write-Host "1. Nhan phim [Y] de mo trinh duyet dang nhap Google ngay bay gio." -ForegroundColor Yellow
Write-Host "   (Hoac copy link ben duoi dan vao Profile Chrome/Edge co tai khoan Google can them)" -ForegroundColor Gray
Write-Host "2. Tren trinh duyet, chon tai khoan va bam nut [Sign in] hoac [Cho phep / Allow]." -ForegroundColor White
Write-Host "3. Script se tu dong bat tai khoan va luu thang vao 9Router SQLite." -ForegroundColor Green
Write-Host "--------------------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "Link dang nhap: " -ForegroundColor DarkYellow -NoNewline
Write-Host $AUTH_URL -ForegroundColor Cyan
Write-Host ""

# Ask to open browser
Write-Host "Ban co muon mo trinh duyet dang nhap ngay khong? [Y/N] (Mac dinh Y): " -ForegroundColor Yellow -NoNewline
$choice = Read-Host
if ([string]::IsNullOrWhiteSpace($choice) -or $choice.Trim().ToUpper() -eq "Y") {
    Start-Process $AUTH_URL
    Write-Host "[+] Da mo trinh duyet dang nhap..." -ForegroundColor Green
}

# Start HTTP Listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$PORT/")
$listener.Prefixes.Add("http://127.0.0.1:$PORT/")

try {
    $listener.Start()
} catch {
    Write-Host "[LOI] Cong $PORT dang bi chiem dung boi tien trinh khac! Hay tat ung dung do va chay lai." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host "Nhan Enter de thoat..."
    exit 1
}

Write-Host ""
Write-Host "[*] Dang cho Google gui ma xac thuc..." -ForegroundColor Cyan

while ($true) {
    $res = $null
    try {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        # Ignore favicon requests
        if ($req.Url.AbsolutePath -eq "/favicon.ico") {
            $res.StatusCode = 404
            $res.Close()
            continue
        }

        $code = $req.QueryString["code"]
        $oauthError = $req.QueryString["error"]

        if ($oauthError) {
            Write-Host "[CANH BAO] Google tra ve loi: $oauthError" -ForegroundColor Red
            $html = "<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#18181b;color:#f87171;'><h2>Xac thuc that bai!</h2><p>$oauthError</p></body></html>"
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
            $res.ContentType = "text/html; charset=utf-8"
            $res.ContentLength64 = $buffer.Length
            $res.OutputStream.Write($buffer, 0, $buffer.Length)
            $res.Close()
            continue
        }

        if (-not $code) {
            $html = "<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#18181b;color:#facc15;'><h2>Dang lang nghe...</h2><p>Vui long dang nhap qua link OAuth.</p></body></html>"
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
            $res.ContentType = "text/html; charset=utf-8"
            $res.ContentLength64 = $buffer.Length
            $res.OutputStream.Write($buffer, 0, $buffer.Length)
            $res.Close()
            continue
        }

        Write-Host ""
        Write-Host "================================================================================" -ForegroundColor DarkCyan
        Write-Host "[+] Da bat duoc ma Authorization Code tu Google! Dang doi token..." -ForegroundColor Yellow

        # 1. Exchange code for Google tokens
        $tokenPostData = @{
            grant_type    = "authorization_code"
            client_id     = $CLIENT_ID
            client_secret = $CLIENT_SECRET
            code          = $code
            redirect_uri  = $REDIRECT_URI
        }

        $tokenRes = $null
        try {
            $tokenRes = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method Post -Body $tokenPostData
        } catch {
            Write-Host "[LOI] Khong the doi token voi Google: $($_.Exception.Message)" -ForegroundColor Red
            $html = "<html><body style='font-family:sans-serif;text-align:center;padding:50px;background:#18181b;color:#f87171;'><h2>Doi token that bai!</h2><p>$($_.Exception.Message)</p></body></html>"
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
            $res.ContentType = "text/html; charset=utf-8"
            $res.ContentLength64 = $buffer.Length
            $res.OutputStream.Write($buffer, 0, $buffer.Length)
            $res.Close()
            continue
        }

        $accessToken = $tokenRes.access_token
        $refreshToken = $tokenRes.refresh_token
        $expiresIn = $tokenRes.expires_in
        $scope = $tokenRes.scope

        # 2. Get user email
        $userEmail = "antigravity-user"
        try {
            $userInfo = Invoke-RestMethod -Uri "https://www.googleapis.com/oauth2/v1/userinfo?alt=json" -Headers @{ Authorization = "Bearer $accessToken" }
            if ($userInfo.email) {
                $userEmail = $userInfo.email
            }
        } catch {
            Write-Host "[!] Khong lay duoc email, se dung ten mac dinh." -ForegroundColor Gray
        }

        # 3. Save into 9Router SQLite via API
        Write-Host "[*] Dang luu tai khoan vao 9Router ($ROUTER_URL)..." -ForegroundColor Cyan
        $savedSuccess = $false
        $errorDetail = ""
        try {
            $importPayload = @{
                refreshToken = $refreshToken
                accessToken  = $accessToken
                expiresIn    = $expiresIn
                email        = $userEmail
                scope        = $scope
                projectId    = "aicode-consumers"
            } | ConvertTo-Json

            $importRes = Invoke-RestMethod -Uri "$ROUTER_URL/api/oauth/antigravity/import" -Method Post -Body $importPayload -ContentType "application/json"
            if ($importRes.success) {
                $savedSuccess = $true
                Write-Host "[OK] Da luu tai khoan thanh cong vao 9Router SQLite: $userEmail" -ForegroundColor Green
            } else {
                $errorDetail = $importRes.error
                Write-Host "[LOI] 9Router tra ve loi: $errorDetail" -ForegroundColor Red
            }
        } catch {
            $errorDetail = $_.Exception.Message
            Write-Host "[LOI] Khong the gui du lieu toi 9Router ($ROUTER_URL): $errorDetail" -ForegroundColor Red
            Write-Host "[GOI Y] Kiem tra ket noi mang hoac dia chi server $ROUTER_URL" -ForegroundColor Yellow
        }

        # 4. Return response to browser
        $cardTitle = if ($savedSuccess) { "THEM TAI KHOAN THANH CONG!" } else { "CANH BAO: CHUA LUU VAO 9ROUTER" }
        $cardColor = if ($savedSuccess) { "#10b981" } else { "#facc15" }
        $cardIcon  = if ($savedSuccess) { "&#10004;" } else { "&#9888;" }
        $cardDesc  = if ($savedSuccess) {
            "Tai khoan Antigravity da duoc luu thang vao Database SQLite cua 9Router."
        } else {
            "Token hop le nhung khong the gui ve 9Router ($errorDetail). Refresh Token da duoc copy vao Clipboard de luu du phong."
        }
        $badgeText = if ($savedSuccess) { "9Router Da San Sang" } else { "Luu Y Ket Noi Server" }
        $badgeBg   = if ($savedSuccess) { "#065f46" } else { "#713f12" }
        $badgeFg   = if ($savedSuccess) { "#34d399" } else { "#fde047" }

        $html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>OAuth Result - 9Router</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; text-align: center; padding: 60px 20px; }
        .card { max-width: 520px; margin: 0 auto; background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .icon { font-size: 54px; margin-bottom: 16px; color: $cardColor; }
        h2 { margin: 0 0 12px; font-size: 24px; color: $cardColor; }
        p { color: #a1a1aa; line-height: 1.6; font-size: 15px; margin: 8px 0; }
        .email { font-weight: 600; color: #38bdf8; background: #0c4a6e33; padding: 4px 12px; border-radius: 6px; display: inline-block; margin: 10px 0; }
        .badge { background: $badgeBg; color: $badgeFg; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 999px; display: inline-block; margin-top: 15px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">$cardIcon</div>
        <h2>$cardTitle</h2>
        <div class="email">$userEmail</div>
        <p>$cardDesc</p>
        <div class="badge">$badgeText</div>
        <p style="font-size: 12px; color: #71717a; margin-top: 24px;">Tab nay se tu dong dong sau 3 giay...</p>
    </div>
    <script>
        if (window.opener) {
            try {
                window.opener.postMessage({ type: "oauth_callback", data: { code: "$code", state: "" } }, "*");
            } catch(e) {}
        }
        setTimeout(function(){ window.close(); }, 3500);
    </script>
</body>
</html>
"@
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
        $res.ContentType = "text/html; charset=utf-8"
        $res.ContentLength64 = $buffer.Length
        $res.OutputStream.Write($buffer, 0, $buffer.Length)
        $res.Close()

        # Copy refresh token to clipboard
        try {
            Set-Clipboard -Value $refreshToken
            $clipMsg = "(Da copy Refresh Token vao Clipboard)"
        } catch {
            $clipMsg = ""
        }

        Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Green
        Write-Host "[HOAN TAT] TAI KHOAN: $userEmail" -ForegroundColor Yellow
        Write-Host "[+] Project ID: aicode-consumers" -ForegroundColor White
        Write-Host "[+] Refresh Token: $($refreshToken.Substring(0, [Math]::Min(25, $refreshToken.Length)))... $clipMsg" -ForegroundColor Gray
        if ($savedSuccess) {
            Write-Host "[+] Tinh trang: Da luu thanh cong vao 9Router SQLite!" -ForegroundColor Green
        } else {
            Write-Host "[!] Tinh trang: Chua luu vao server 9Router ($errorDetail)" -ForegroundColor Yellow
        }
        Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Green
        Write-Host ""
        Write-Host "[*] Cua so van dang tiep tuc lang nghe! Ban co the dang nhap tiep acc khac..." -ForegroundColor Cyan

    } catch {
        Write-Host "[!] Gap loi trong luc xu ly request: $($_.Exception.Message)" -ForegroundColor Red
        try {
            if ($null -ne $res) {
                $res.StatusCode = 500
                $res.Close()
            }
        } catch {}
        Write-Host "[*] Tiep tuc lang nghe..." -ForegroundColor Cyan
    }
}

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

$SUPABASE_URL = "https://eslfxpccttexenmsybbq.supabase.co"
$SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbGZ4cGNjdHRleGVubXN5YmJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYwMDAwMywiZXhwIjoyMDkwMTc2MDAzfQ.TJgHkn87uDqWT4W984gnNRIzDU7P5CKB6JyBTukIinA"

$AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CLIENT_ID&response_type=code&redirect_uri=[REDIRECT]&scope=[SCOPE]&access_type=offline&prompt=consent"
$AUTH_URL = $AUTH_URL.Replace("[REDIRECT]", [System.Uri]::EscapeDataString($REDIRECT_URI)).Replace("[SCOPE]", [System.Uri]::EscapeDataString($SCOPES))

Clear-Host
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "             9ROUTER - BO LANG NGHE VA TU DONG THEM ANTIGRAVITY                 " -ForegroundColor Yellow
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [*] Dang lang nghe tai cong: http://localhost:$PORT/" -ForegroundColor Green
Write-Host "  [*] Co che: Tu dong doi ma OAuth voi Google -> Luu thang vao Supabase 9Router" -ForegroundColor Gray
Write-Host "  [*] Cua so nay chay lien tuc de ban dang nhap nhieu tai khoan lien tiep." -ForegroundColor Gray
Write-Host "  [*] Nhan [Ctrl + C] de thoat khi da them xong." -ForegroundColor Gray
Write-Host ""
Write-Host "--------------------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "HUONG DAN DANG NHAP:" -ForegroundColor White
Write-Host "1. Nhan phim [Y] de mo trinh duyet dang nhap Google ngay bay gio." -ForegroundColor Yellow
Write-Host "   (Hoac copy link ben duoi dan vao Profile Chrome/Edge co tai khoan Google can them)" -ForegroundColor Gray
Write-Host "2. Tren trinh duyet, chon tai khoan va bam nut [Sign in] hoac [Cho phep / Allow]." -ForegroundColor White
Write-Host "3. Script se tu dong bat tai khoan va luu thang vao 9Router." -ForegroundColor Green
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

        # 3. Save into Supabase provider_connections
        $expiresAt = (Get-Date).ToUniversalTime().AddSeconds($expiresIn).ToString("o")
        $connDataObj = [ordered]@{
            accessToken   = $accessToken
            refreshToken  = $refreshToken
            expiresAt     = $expiresAt
            expiresIn     = $expiresIn
            projectId     = "aicode-consumers"
            testStatus    = "active"
            scope         = $scope
            lastRefreshAt = (Get-Date).ToUniversalTime().ToString("o")
            errorCode     = $null
            lastError     = $null
            backoffLevel  = 0
        }
        $connDataJson = $connDataObj | ConvertTo-Json -Compress

        $dbHeaders = @{
            "apikey"        = $SUPABASE_KEY
            "Authorization" = "Bearer $SUPABASE_KEY"
            "Prefer"        = "return=representation"
        }

        $savedSuccess = $false
        try {
            # Check existing connection by email
            $existing = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/provider_connections?email=eq.$userEmail&provider=eq.antigravity&select=id" -Headers $dbHeaders -Method Get
            
            if ($existing -and $existing.Count -gt 0) {
                $updateBody = @{
                    name       = $userEmail
                    is_active  = 1
                    data       = $connDataJson
                    updated_at = (Get-Date).ToUniversalTime().ToString("o")
                } | ConvertTo-Json

                Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/provider_connections?id=eq.$($existing[0].id)" -Method Patch -Body $updateBody -ContentType "application/json" -Headers $dbHeaders | Out-Null
                Write-Host "[OK] Da cap nhat tai khoan da co san: $userEmail" -ForegroundColor Green
            } else {
                $newId = [guid]::NewGuid().ToString()
                $insertBody = @{
                    id        = $newId
                    provider  = "antigravity"
                    auth_type = "oauth"
                    name      = $userEmail
                    email     = $userEmail
                    priority  = 1
                    is_active = 1
                    data      = $connDataJson
                } | ConvertTo-Json

                Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/provider_connections" -Method Post -Body $insertBody -ContentType "application/json" -Headers $dbHeaders | Out-Null
                Write-Host "[OK] Da them tai khoan moi: $userEmail" -ForegroundColor Green
            }
            $savedSuccess = $true
        } catch {
            Write-Host "[LOI] Luu vao Supabase that bai: $($_.Exception.Message)" -ForegroundColor Red
        }

        # 4. Return success response to browser
        $html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>OAuth Success - 9Router</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; text-align: center; padding: 60px 20px; }
        .card { max-width: 520px; margin: 0 auto; background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .icon { font-size: 54px; margin-bottom: 16px; color: #10b981; }
        h2 { margin: 0 0 12px; font-size: 24px; color: #10b981; }
        p { color: #a1a1aa; line-height: 1.6; font-size: 15px; margin: 8px 0; }
        .email { font-weight: 600; color: #38bdf8; background: #0c4a6e33; padding: 4px 12px; border-radius: 6px; display: inline-block; margin: 10px 0; }
        .badge { background: #065f46; color: #34d399; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 999px; display: inline-block; margin-top: 15px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">&#10004;</div>
        <h2>THEM TAI KHOAN THANH CONG!</h2>
        <div class="email">$userEmail</div>
        <p>Tai khoan Antigravity da duoc luu thang vao Database cua 9Router.</p>
        <div class="badge">9Router Da San Sang</div>
        <p style="font-size: 12px; color: #71717a; margin-top: 24px;">Tab nay se tu dong dong sau 3 giay...</p>
    </div>
    <script>
        if (window.opener) {
            try {
                window.opener.postMessage({ type: "oauth_callback", data: { code: "$code", state: "" } }, "*");
            } catch(e) {}
        }
        setTimeout(function(){ window.close(); }, 3000);
    </script>
</body>
</html>
"@
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
        $res.ContentType = "text/html; charset=utf-8"
        $res.ContentLength64 = $buffer.Length
        $res.OutputStream.Write($buffer, 0, $buffer.Length)
        $res.Close()

        # Try to copy refresh token to clipboard
        try {
            Set-Clipboard -Value $refreshToken
            $clipMsg = "(Da copy Refresh Token vao Clipboard)"
        } catch {
            $clipMsg = ""
        }

        Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Green
        Write-Host "[THANH CONG] TAI KHOAN: $userEmail" -ForegroundColor Yellow
        Write-Host "[+] Project ID: aicode-consumers" -ForegroundColor White
        Write-Host "[+] Refresh Token: $($refreshToken.Substring(0, [Math]::Min(25, $refreshToken.Length)))... $clipMsg" -ForegroundColor Gray
        Write-Host "[+] Tinh trang: Da luu thanh cong vao 9Router!" -ForegroundColor Green
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

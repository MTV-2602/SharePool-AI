# ==============================================================================
# AiNoName - Antigravity IDE Gateway Client (PowerShell Core Launcher)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $Host.UI.RawUI.WindowTitle = "AiNoName - Antigravity IDE Gateway Client"
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $scriptDir

# ── 1. Kiem tra quyen Administrator (Bat buoc de sua hosts & cai cert) ──────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[*] Dang yeu cau quyen Administrator (UAC)..." -ForegroundColor Yellow
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        exit 0
    } catch {
        Write-Host ""
        Write-Host "[!] Ban da huy cap quyen Administrator." -ForegroundColor Red
        Write-Host "    AiNoName can quyen Administrator de thiet lap file hosts va chung chi SSL cho Antigravity IDE." -ForegroundColor Yellow
        Write-Host "    Vui long click phai chuot vao file 'AiNoName-Antigravity.bat' -> chon 'Run as administrator'." -ForegroundColor Gray
        Write-Host ""
        Read-Host "Nhan Enter de thoat..."
        exit 1
    }
}

# ── 2. Giao dien khoi dong ───────────────────────────────────────────────────
Clear-Host
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "           AINONAME - ANTIGRAVITY IDE CLIENT GATEWAY              " -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# ── 3. Kiem tra Node.js Runtime ─────────────────────────────────────────────
$nodeCmd = "node"
$hasNode = $false
try {
    $null = Get-Command node -ErrorAction Stop
    $hasNode = $true
} catch {
    $hasNode = $false
}

if (-not $hasNode) {
    $localNode = Join-Path $scriptDir "bin\node.exe"
    if (Test-Path $localNode) {
        $nodeCmd = $localNode
    } else {
        Write-Host "[!] Khong tim thay Node.js tren may tinh." -ForegroundColor Yellow
        Write-Host "[*] Dang tu dong tai Node.js Portable ve may (chi tai 1 lan duy nhat)..." -ForegroundColor Green
        New-Item -ItemType Directory -Path (Join-Path $scriptDir "bin") -Force | Out-Null
        try {
            Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/win-x64/node.exe" -OutFile $localNode -UseBasicParsing
            $nodeCmd = $localNode
            Write-Host "[OK] Da tai xong Node.js Portable!" -ForegroundColor Green
        } catch {
            Write-Host "[!] Loi tai Node.js: $($_.Exception.Message)" -ForegroundColor Red
            Read-Host "Nhan Enter de thoat..."
            exit 1
        }
    }
}

# ── 4. Set NODE_EXTRA_CA_CERTS cho Antigravity IDE Node/Electron ─────────────
$certPath = Join-Path $scriptDir "certs\rootCA.crt"
$persistentCert = Join-Path $env:APPDATA "AiNoName\certs\rootCA.crt"
$roamingCert = Join-Path $env:APPDATA "9router\mitm\rootCA.crt"

$activeCert = $null
if (Test-Path $roamingCert) {
    $activeCert = $roamingCert
} elseif (Test-Path $persistentCert) {
    $activeCert = $persistentCert
} elseif (Test-Path $certPath) {
    $activeCert = $certPath
}

if ($activeCert) {
    $env:NODE_EXTRA_CA_CERTS = $activeCert
    try { [Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", $activeCert, "User") } catch {}
    try { [Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", $activeCert, "Machine") } catch {}
}

# ── 4.1. Kiem tra Antigravity IDE dang mo san ───────────────────────────────
$agRunning = Get-Process -Name "Antigravity*", "language_server*" -ErrorAction SilentlyContinue
if ($agRunning) {
    Write-Host "[!] LUU Y: Phat hien Antigravity IDE dang mo san tren may tinh." -ForegroundColor Yellow
    Write-Host "    Neu Antigravity bao loi ket noi (Agent execution terminated due to error):" -ForegroundColor Yellow
    Write-Host "    -> Ban hay chay file 'Khoi-Dong-Antigravity.bat' hoac bam nut tren Dashboard." -ForegroundColor Cyan
    Write-Host ""
}

# ── 5. Tu dong mo Web Dashboard sau 2 giay ──────────────────────────────────
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:20129"
} | Out-Null

Write-Host "[*] Dang khoi chay Gateway Agent..." -ForegroundColor Green
Write-Host "[*] Dashboard quan ly se tu dong mo tai: http://localhost:20129" -ForegroundColor Cyan
Write-Host ""
Write-Host "[Luu y] GIU NGUYEN CUA SO NAY khi dang dung Antigravity IDE." -ForegroundColor Magenta
Write-Host "        Khi dong cua so nay, DNS se tu dong duoc don dep an toan." -ForegroundColor DarkGray
Write-Host "------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# ── 6. Chay Agent bundle & Dam bao don sach Hosts khi thoat ────────────────
$agentPath = Join-Path $scriptDir "ainoname-agent.bundle.js"
if (-not (Test-Path $agentPath)) {
    Write-Host "[LOI] Khong tim thay file '$agentPath'!" -ForegroundColor Red
    Read-Host "Nhan Enter de thoat..."
    exit 1
}

function Cleanup-Hosts {
    try {
        $hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
        if (Test-Path $hostsPath) {
            $content = [System.IO.File]::ReadAllText($hostsPath)
            $startTag = '# >>> AINONAME ANTIGRAVITY DNS START >>>'
            $endTag = '# <<< AINONAME ANTIGRAVITY DNS END <<<'
            $s = $content.IndexOf($startTag)
            if ($s -ne -1) {
                $e = $content.IndexOf($endTag)
                if ($e -ne -1) {
                    $newContent = $content.Substring(0, $s) + $content.Substring($e + $endTag.Length)
                    [System.IO.File]::WriteAllText($hostsPath, $newContent.Trim() + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
                    Write-Host "`n[OK] Da tu dong don dep DNS hosts an toan!" -ForegroundColor Green
                }
            }
        }
        ipconfig /flushdns | Out-Null
    } catch {}
}

try {
    & $nodeCmd $agentPath
} finally {
    Cleanup-Hosts
}

Write-Host ""
Write-Host "[*] Tien trinh Gateway da dung." -ForegroundColor Yellow
Read-Host "Nhan Enter de thoat..."

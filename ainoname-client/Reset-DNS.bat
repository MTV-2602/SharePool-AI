@echo off
setlocal
cd /d "%~dp0"
title Khoi Phuc Cai Dat DNS Mac Dinh - AiNoName

:: Check Administrator permissions
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Dang yeu cau quyen Administrator (UAC) de khoi phuc file hosts...
    powershell.exe -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo [*] Dang tien hanh go bo DNS redirect khoi file hosts...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts';" ^
    "if (Test-Path $hosts) {" ^
    "    $raw = [System.IO.File]::ReadAllText($hosts);" ^
    "    $clean = $raw -replace '(?ms)# >>> AINONAME ANTIGRAVITY DNS START >>>.*?# <<< AINONAME ANTIGRAVITY DNS END <<<(\r?\n)?', '';" ^
    "    $clean = $clean -replace '(?m)^\s*127\.0\.0\.1\s+.*cloudcode-pa\.googleapis\.com.*$\r?\n?', '';" ^
    "    [System.IO.File]::WriteAllText($hosts, $clean.Trim() + [Environment]::NewLine, [System.Text.Encoding]::UTF8);" ^
    "    Write-Host '[OK] Da go bo hoan toan DNS khoi file hosts!' -ForegroundColor Green;" ^
    "}"

ipconfig /flushdns >nul
echo [OK] Da lam sach DNS Cache (Flush DNS)!
echo.
echo ==================================================================
echo [THANH CONG] File hosts va DNS da tro ve mac dinh cua Google.
echo Ban co the dang nhap Antigravity IDE bang tai khoan Google binh thuong.
echo ==================================================================
echo.
pause

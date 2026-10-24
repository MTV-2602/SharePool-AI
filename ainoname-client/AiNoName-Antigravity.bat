@echo off
chcp 65001 >nul
title AiNoName - Antigravity IDE Gateway Client

:: ── Kiem tra quyen Administrator (Bat buoc de ghi hosts va cai cert) ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Dang yeu cau quyen Administrator de cau hinh ket noi...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c cd /d \"%~dp0\" && call \"%~nx0\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

echo ==================================================================
echo              AINONAME - ANTIGRAVITY IDE CLIENT GATEWAY
echo ==================================================================
echo.

:: ── Kiem tra Node.js ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "bin\node.exe" (
        set "NODE_CMD=bin\node.exe"
    ) else (
        echo [!] Khong tim thay Node.js tren may tinh!
        echo [*] Dang tu dong tai phien ban Node.js Portable sieu nhe ve may...
        mkdir bin >nul 2>&1
        powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/win-x64/node.exe' -OutFile 'bin\node.exe'"
        set "NODE_CMD=bin\node.exe"
    )
) else (
    set "NODE_CMD=node"
)

:: ── Tu dong mo trinh duyet sau 1.5s ──
start /min powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500; Start-Process 'http://localhost:20129'"

:: ── Khoi chay Agent ──
echo [*] Dang khoi chay Gateway Agent...
echo [*] Giao dien quan ly se tu dong mo tai: http://localhost:20129
echo.
echo [Luu y] Giu nguyen cua so nay khi dang su dung Antigravity IDE.
echo         Khi muon tat ket noi, chi can dong cua so nay lai.
echo ------------------------------------------------------------------

%NODE_CMD% ainoname-agent.bundle.js

pause

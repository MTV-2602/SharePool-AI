@echo off
chcp 65001 > nul
title 🚀 Codex API Portal
color 0A

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║    API KEY MANAGEMENT PORTAL  v2.0           ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Please download from: https://nodejs.org
    pause & exit /b 1
)

:: Show Node version
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% detected

:: Install dependencies if needed
if not exist "node_modules\express" (
    echo.
    echo  [INFO] Installing dependencies (first run)...
    echo  This may take 1-2 minutes...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install failed!
        pause & exit /b 1
    )
    echo.
    echo  [OK] Dependencies installed!
)

:: Create .env if not exists
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  [INFO] Created .env from .env.example
        echo  [WARN] Please edit .env to set your ADMIN_KEY!
    )
)

:: Start server & telegram bot
echo.
echo  [INFO] Starting server and telegram bot...
echo  [INFO] Press Ctrl+C to stop
echo.
start "🤖 Codex Telegram Bot" cmd /c "node telegram-bot.js & pause"
node server.js

pause

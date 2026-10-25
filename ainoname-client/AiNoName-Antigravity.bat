@echo off
setlocal
cd /d "%~dp0"
title AiNoName - Antigravity IDE Gateway
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [Thong bao] Tien trinh da ket thuc. Nhan phim bat ky de dong...
    pause >nul
)

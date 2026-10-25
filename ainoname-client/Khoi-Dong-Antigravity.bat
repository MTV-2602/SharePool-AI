@echo off
setlocal
title Khoi dong Antigravity IDE (Da nap chung chi SSL)
cd /d "%~dp0"

echo ==================================================================
echo         KHOI DONG ANTIGRAVITY IDE VOI CHUNG CHI AINONAME
echo ==================================================================
echo.

echo [*] Dang tat cac tien trinh Antigravity IDE cu...
taskkill /F /IM "Antigravity IDE.exe" >nul 2>&1
taskkill /F /IM "Antigravity.exe" >nul 2>&1
taskkill /F /IM "language_server_windows_x64.exe" >nul 2>&1
timeout /t 1 /nobreak >nul

set CERT_PATH=%~dp0certs\rootCA.crt
if exist "%APPDATA%\AiNoName\certs\rootCA.crt" (
    set CERT_PATH=%APPDATA%\AiNoName\certs\rootCA.crt
) else if exist "%APPDATA%\9router\mitm\rootCA.crt" (
    set CERT_PATH=%APPDATA%\9router\mitm\rootCA.crt
)

echo [*] Su dung chung chi: %CERT_PATH%
set NODE_EXTRA_CA_CERTS=%CERT_PATH%

echo [*] Dang khoi chay Antigravity IDE...
if exist "%USERPROFILE%\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe" (
    start "" "%USERPROFILE%\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe"
) else if exist "%USERPROFILE%\AppData\Local\Programs\Antigravity\Antigravity.exe" (
    start "" "%USERPROFILE%\AppData\Local\Programs\Antigravity\Antigravity.exe"
) else if exist "%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe" (
    start "" "%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"
) else if exist "%ProgramFiles%\Antigravity IDE\Antigravity IDE.exe" (
    start "" "%ProgramFiles%\Antigravity IDE\Antigravity IDE.exe"
) else if exist "%ProgramFiles(x86)%\Antigravity IDE\Antigravity IDE.exe" (
    start "" "%ProgramFiles(x86)%\Antigravity IDE\Antigravity IDE.exe"
) else (
    start "" antigravity
)

echo.
echo [OK] Antigravity IDE da duoc khoi dong thanh cong voi SSL!
timeout /t 3 >nul
exit

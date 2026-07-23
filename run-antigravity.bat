@echo off
title Khoi Chay Antigravity IDE voi 9Router
echo Dang tat cac tien trinh Antigravity IDE dang chay ngam...
taskkill /F /IM "Antigravity IDE.exe" >nul 2>&1
taskkill /F /IM "Antigravity.exe" >nul 2>&1
timeout /t 1 >nul

echo Dang thiet lap chung chi bao mat local...
set NODE_EXTRA_CA_CERTS=%APPDATA%\9router\mitm\rootCA.crt

echo Dang khoi chay Antigravity IDE...
if exist "%USERPROFILE%\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe" (
    start "" "%USERPROFILE%\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe"
) else if exist "%USERPROFILE%\AppData\Local\Programs\Antigravity\Antigravity.exe" (
    start "" "%USERPROFILE%\AppData\Local\Programs\Antigravity\Antigravity.exe"
) else (
    echo [LOI] Khong tim thay duong dan cai dat cua Antigravity IDE!
    pause
    exit /b 1
)

echo Kich hoat hoan tat! IDE se di qua 9Router ke tu bay gio.
exit

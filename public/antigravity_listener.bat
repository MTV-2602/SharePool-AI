@echo off
chcp 65001 >nul
title 9Router - Antigravity OAuth Listener
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0antigravity_listener.ps1"
pause

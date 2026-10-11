@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\web\Play-Realms.ps1" %*
exit /b %ERRORLEVEL%

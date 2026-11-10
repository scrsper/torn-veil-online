@echo off
rem Historical isometric living-world comparison. The current launcher (Play-Realms.ps1) has no isometric view.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\web\Play-Web.ps1" -View isometric %*
exit /b %ERRORLEVEL%

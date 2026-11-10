@echo off
setlocal
rem Historical isometric living-world comparison. "Play Torn Veil Web.cmd" now opens the connected
rem realms launcher, which has no isometric view, so this calls the older web launcher directly.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\web\Play-Web.ps1" -View isometric %*
set "TV_WEB_EXIT=%ERRORLEVEL%"
if not "%TV_WEB_EXIT%"=="0" pause
exit /b %TV_WEB_EXIT%

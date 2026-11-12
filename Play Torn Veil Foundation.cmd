@echo off
cd /d "%~dp0"
node scripts\foundation\play.mjs %*
exit /b %ERRORLEVEL%

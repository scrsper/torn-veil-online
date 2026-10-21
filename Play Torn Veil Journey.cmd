@echo off
cd /d "%~dp0"
node scripts\world\play-campaign.mjs %*
exit /b %ERRORLEVEL%

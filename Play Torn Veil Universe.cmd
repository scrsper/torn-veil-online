@echo off
cd /d "%~dp0"
node scripts\world\play-universe.mjs
if errorlevel 1 pause

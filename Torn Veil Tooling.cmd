@echo off
cd /d "%~dp0"
node --import tsx scripts/tooling/start.ts
pause

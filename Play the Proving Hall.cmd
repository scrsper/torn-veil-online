@echo off
rem The Proving Hall of Chrysanthus: every element and form of magic, training dummies, N summons foes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\web\Play-Combat-Gym.ps1" -Hall %*

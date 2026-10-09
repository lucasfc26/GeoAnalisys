@echo off
rem Inicia API (porta 3000) + interface Vite (porta 5173). Abra http://localhost:5173
cd /d "%~dp0"
call npm.cmd run dev
pause

@echo off
rem Compila tudo e sobe um servidor unico. Abra http://localhost:3000
cd /d "%~dp0"
call npm.cmd run start
pause

@echo off
chcp 65001 >nul
cls
echo.
echo  BilboWeb Planning — iniciando...
echo.

cd /d "%~dp0"

:: Matar proceso en puerto 3000 si ya hay uno corriendo
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

timeout /t 1 /nobreak >nul

:: Arrancar servidor — /d fija el directorio de trabajo sin comillas anidadas
start "BilboWeb Servidor" /d "%~dp0" /min cmd /k node servidor.js

:: Esperar a que arranque y abrir navegador
timeout /t 3 /nobreak >nul
start "" http://localhost:3000

echo  Listo. Puedes cerrar esta ventana.
timeout /t 3 /nobreak >nul

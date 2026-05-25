@echo off
chcp 65001 >nul
echo.
echo Arrancando servidor BilboWeb Planning...
echo.
echo Cuando veas el mensaje de confirmacion, abre el navegador en:
echo    http://localhost:3000
echo.
echo Para parar el servidor cierra esta ventana.
echo.
node servidor.js
pause

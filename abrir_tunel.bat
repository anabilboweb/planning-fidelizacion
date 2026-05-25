@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════╗
echo ║       🌐  Túnel BilboWeb → Internet          ║
echo ╚══════════════════════════════════════════════╝
echo.
echo IMPORTANTE: El servidor debe estar arrancado.
echo Si no lo has hecho, abre primero arrancar_servidor.bat
echo en OTRA ventana y luego vuelve aquí.
echo.
echo Abriendo túnel hacia http://localhost:3000 ...
echo.
echo Cuando aparezca la URL (https://xxxx.trycloudflare.com)
echo cópiala y compártela con tu equipo.
echo.
echo Para cerrar el túnel: Ctrl + C o cierra esta ventana.
echo.
cloudflared.exe tunnel --url http://localhost:3000
pause

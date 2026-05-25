@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║   BilboWeb — Generador de Planning   ║
echo ╚══════════════════════════════════════╝
echo.
echo Leyendo configuracion de config.json...
echo.

REM Lee la API key del archivo .env.ors si existe
set ORS_KEY=
if exist ".env.ors" (
  for /f "tokens=2 delims==" %%a in ('findstr "ORS_API_KEY" .env.ors') do set ORS_KEY=%%a
)

if "%ORS_KEY%"=="" (
  echo AVISO: No se encontro API key de ORS. Se usaran distancias estimadas.
  echo Para rutas reales, asegurate de que existe el archivo .env.ors
  echo.
  node planning.js
) else (
  echo API key ORS detectada. Se usaran tiempos reales de conduccion.
  echo.
  node planning.js %ORS_KEY%
)

echo.
if %ERRORLEVEL% EQU 0 (
  echo Planning generado correctamente.
  echo Abriendo el mapa en el navegador...
  start planning_mapa.html
) else (
  echo ERROR al generar el planning. Revisa los mensajes anteriores.
)
echo.
pause

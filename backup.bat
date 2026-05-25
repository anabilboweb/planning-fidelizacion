@echo off
chcp 65001 >nul
echo Realizando backup de archivos BilboWeb Planning...
echo.

set FECHA=%date:~6,4%-%date:~3,2%-%date:~0,2%
set DESTINO=backup_%FECHA%

if not exist "backups" mkdir backups
if not exist "backups\%DESTINO%" mkdir "backups\%DESTINO%"

copy "geocoding_cache.json" "backups\%DESTINO%\" >nul
copy "config.json" "backups\%DESTINO%\" >nul
copy "festivos.json" "backups\%DESTINO%\" >nul
if exist "bilboweb_planning.db" copy "bilboweb_planning.db" "backups\%DESTINO%\" >nul
if exist "planning_visitas.xlsx" copy "planning_visitas.xlsx" "backups\%DESTINO%\" >nul

echo Backup completado en: backups\%DESTINO%\
echo.
pause

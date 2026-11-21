@echo off
rem Doppelklick: alle Aenderungen committen und nach GitHub pushen.
rem Optional mit Nachricht:  push.cmd "Was sich geaendert hat"
setlocal
cd /d "%~dp0"
set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update"
git add -A
git commit -m "%MSG%"
git push
echo.
pause

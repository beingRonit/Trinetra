@echo off
echo ========================================
echo    Starting Trinetra Stack
echo ========================================
echo.

start "Trinetra Frontend" cmd /c "%~dp0start-frontend.bat"
start "Trinetra Pipeline" cmd /c "%~dp0start-pipeline.bat"
start "Trinetra Backend" cmd /c "%~dp0start-backend.bat"

echo Started:
echo   Frontend : http://127.0.0.1:3000
echo   Pipeline : http://127.0.0.1:8003
echo   Backend  : http://127.0.0.1:3003
echo.
echo Press any key to exit...
pause > nul
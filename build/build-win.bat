@echo off
rem Diter — Windows installer build (NSIS)
rem Run this on Windows to produce the NSIS setup exe.
cd /d "%~dp0.."

echo === 1/2 Installing dependencies ===
call npm install
if errorlevel 1 goto :fail

echo === 2/2 Building frontend + NSIS installer ===
call npm run dist:win
if errorlevel 1 goto :fail

echo.
echo === Done! Installer is in the release folder ===
dir /b release\*-setup.exe
goto :eof

:fail
echo.
echo Build failed. See the messages above.
pause
exit /b 1

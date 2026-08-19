@echo off
REM One-click launcher for Windows: double-click this file.
REM It runs the app inside WSL (Ubuntu) and opens your browser automatically.
REM Close this window or press Ctrl+C to stop the server.

title Bus Sun-Side Advisor
echo Starting the Bus Sun-Side Advisor inside WSL...
echo.

wsl.exe -d Ubuntu -- bash -lc "cd '/home/mhosny/ibrahim tools/bus-sun-advisor' && ./run.sh"

echo.
echo Server stopped.
pause

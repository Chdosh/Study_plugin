@echo off
setlocal
cd /d "%~dp0\..\.."
node tools\agent-runner\index.mjs --ui --mock
echo.
pause

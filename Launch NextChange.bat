@echo off
echo Starting NextChange Hub...
cd /d "%~dp0"
npm run electron:dev
pause

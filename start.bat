@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js 22 или новее: https://nodejs.org/
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo Нужен Node.js 22 или новее: https://nodejs.org/
  pause
  exit /b 1
)
echo Заявки. Не закрывайте это окно во время работы.
node server.js --open
pause

@echo off
cd /d "%~dp0"
start "CSKV API (cong 3001)" cmd /k "npm run dev:api"
timeout /t 6 /nobreak >nul
start "CSKV WEB (cong 5173)" cmd /k "npm run dev:web"

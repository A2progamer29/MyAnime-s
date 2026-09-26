@echo off
cd /d "%~dp0"
echo Deploiement de LumaAnime sur Cloudflare...
echo.
call npx wrangler deploy
echo.
pause

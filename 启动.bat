@echo off
setlocal
cd /d "%~dp0"

echo [1/2] build single-file index.html from src\ ...
where python >nul 2>nul
if %errorlevel%==0 (
  python build.py
) else (
  echo       python not found on PATH, skipping rebuild
)

if not exist "index.html" (
  echo [error] index.html is missing and could not be built.
  echo         Install Python 3 and re-run this file.
  pause
  exit /b 1
)

echo [2/2] opening index.html in default browser ...
start "" "index.html"

endlocal

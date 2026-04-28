@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "PYTHON=python"
if exist "%ROOT%\.venv\Scripts\python.exe" set "PYTHON=%ROOT%\.venv\Scripts\python.exe"
if not exist "%ROOT%\.venv\Scripts\python.exe" (
  where python >nul 2>nul || set "PYTHON=py"
)

start "Trinetra Pipeline" cmd /k "cd /d ""%ROOT%\pipeline"" && %PYTHON% -m uvicorn app.api.server:app --reload --host 0.0.0.0 --port 8003"
start "Trinetra Dapp" cmd /k "cd /d ""%ROOT%\dapp"" && set ""PYTHONPATH=%ROOT%"" && %PYTHON% -m uvicorn main:app --reload --host 0.0.0.0 --port 3003"
start "Trinetra Frontend" cmd /k "cd /d ""%ROOT%\frontend"" && npm run dev"

echo Started Trinetra development stack.
echo   frontend : http://127.0.0.1:3000
echo   pipeline : http://127.0.0.1:8003
echo   dapp     : http://127.0.0.1:3003

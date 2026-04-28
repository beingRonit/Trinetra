@echo off
echo Starting Trinetra Backend (dapp)...
cd /d "%~dp0..\dapp"
set PYTHONPATH=%~dp0..
python -m uvicorn main:app --reload --host 0.0.0.0 --port 3003
@echo off
echo Starting Trinetra Pipeline...
cd /d "%~dp0..\pipeline"
python -m uvicorn app.api.server:app --reload --host 0.0.0.0 --port 8003
@echo off
echo ========================================
echo Image Authenticity Pipeline - Setup
echo ========================================
echo.

echo [1/4] Installing Python dependencies...
pip install -r requirements.txt

echo.
echo [2/4] Creating data directories...
if not exist "data\temp" mkdir "data\temp"
if not exist "data\output" mkdir "data\output"
if not exist "data\uploads" mkdir "data\uploads"

echo.
echo [3/4] Setting up environment file...
if not exist ".env" (
    copy .env.example .env
    echo Created .env file - Please edit with your API keys!
) else (
    echo .env file already exists
)

echo.
echo [4/4] Setup complete!
echo.
echo ========================================
echo NEXT STEPS:
echo ========================================
echo 1. Edit .env file and add your SERPER_API_KEY
echo    (Get free key at https://serper.dev)
echo.
echo 2. Run the CLI to analyze an image:
echo    python cli.py analyze path\to\image.jpg
echo.
echo 3. Or start the API server:
echo    python cli.py serve
echo.
echo ========================================

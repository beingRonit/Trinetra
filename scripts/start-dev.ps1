$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pipelineDir = Join-Path $root "pipeline"
$dappDir = Join-Path $root "dapp"
$frontendDir = Join-Path $root "frontend"

function Get-PythonLauncher {
    $sharedPython = Join-Path $root ".venv\\Scripts\\python.exe"
    if (Test-Path $sharedPython) {
        return $sharedPython
    }

    if (Get-Command python -ErrorAction SilentlyContinue) {
        return "python"
    }

    if (Get-Command py -ErrorAction SilentlyContinue) {
        return "py"
    }

    throw "Python was not found on PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found on PATH."
}

$pythonLauncher = Get-PythonLauncher

$pipelineCommand = "Set-Location '$pipelineDir'; & $pythonLauncher -m uvicorn app.api.server:app --reload --host 0.0.0.0 --port 8003"
$dappCommand = "Set-Location '$dappDir'; `$env:PYTHONPATH = '$root'; & $pythonLauncher -m uvicorn main:app --reload --host 0.0.0.0 --port 3003"
$frontendCommand = "Set-Location '$frontendDir'; npm run dev"

Start-Process powershell.exe -WorkingDirectory $pipelineDir -ArgumentList @("-NoExit", "-Command", $pipelineCommand)
Start-Process powershell.exe -WorkingDirectory $dappDir -ArgumentList @("-NoExit", "-Command", $dappCommand)
Start-Process powershell.exe -WorkingDirectory $frontendDir -ArgumentList @("-NoExit", "-Command", $frontendCommand)

Write-Host "Started Trinetra development stack:"
Write-Host "  frontend : http://127.0.0.1:3000"
Write-Host "  pipeline : http://127.0.0.1:8003"
Write-Host "  dapp     : http://127.0.0.1:3003"

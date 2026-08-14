$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvRoot = Join-Path $projectRoot '.venv-rvc'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'

Push-Location $projectRoot
try {
    & py -3.12 -c "import sys; assert sys.maxsize > 2**32; print(sys.version)"
    if ($LASTEXITCODE -ne 0) {
        throw '64-bit Python 3.12 is required. Install it with: winget install --id Python.Python.3.12 -e --scope user'
    }

    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Host '[voice-setup] Creating isolated Python environment...'
        & py -3.12 -m venv $venvRoot
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create .venv-rvc.' }
    }

    Write-Host '[voice-setup] Installing CUDA RVC and model assets. The first run downloads several GB.'
    & $venvPython (Join-Path $projectRoot 'colab\bootstrap_local.py')
    if ($LASTEXITCODE -ne 0) { throw 'Local RVC bootstrap failed.' }
    Write-Host '[voice-setup] Local RTX voice backend is ready.'
}
finally {
    Pop-Location
}

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$bundleRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $PSScriptRoot) -ne 'local') {
    $bundleRoot = $PSScriptRoot
}
$defaultProjectRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Documents\DiscordBOT'
$existingPython = Join-Path $defaultProjectRoot '.venv-rvc\Scripts\python.exe'
$existingRvcRoot = Join-Path $defaultProjectRoot '.runtime\Retrieval-based-Voice-Conversion-WebUI'
$venvRoot = Join-Path $bundleRoot '.laptop-venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$reuseExistingRuntime = $false

Push-Location $bundleRoot
try {
    if (-not $env:RVC_ROOT -and (Test-Path -LiteralPath $existingRvcRoot)) {
        $env:RVC_ROOT = $existingRvcRoot
        $reuseExistingRuntime = $true
        Write-Host "[Digital Me] Reusing the existing RVC runtime at $existingRvcRoot"
    }
    if (Test-Path -LiteralPath $existingPython) {
        $python = $existingPython
        Write-Host "[Digital Me] Reusing the existing local voice Python environment."
    }
    else {
        & py -3.12 -c "import sys; assert sys.maxsize > 2**32; print(sys.version)"
        if ($LASTEXITCODE -ne 0) {
            throw '64-bit Python 3.12 is required. Install it with: winget install --id Python.Python.3.12 -e --scope user'
        }
        if (-not (Test-Path -LiteralPath $venvPython)) {
            Write-Host '[Digital Me] Creating the isolated laptop training environment...'
            & py -3.12 -m venv $venvRoot
            if ($LASTEXITCODE -ne 0) { throw 'Failed to create the laptop Python environment.' }
        }
        $python = $venvPython
    }

    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
        throw 'FFmpeg is required on PATH. Run the DiscordBOT local voice setup first, or install FFmpeg before retrying.'
    }

    $bootstrapArguments = @((Join-Path $bundleRoot 'scripts\bootstrap_training.py'))
    if ($reuseExistingRuntime -and (Test-Path -LiteralPath (Join-Path $existingRvcRoot 'assets\pretrained_v2\f0G40k.pth'))) {
        $bootstrapArguments += '--skip-install'
    }
    & $python @bootstrapArguments
    if ($LASTEXITCODE -ne 0) { throw 'The local RVC setup or verification failed.' }

    $env:PYTORCH_CUDA_ALLOC_CONF = 'expandable_segments:True'
    $env:CUDA_MODULE_LOADING = 'LAZY'
    & $python (Join-Path $bundleRoot 'scripts\run_training.py')
    if ($LASTEXITCODE -ne 0) { throw 'Laptop training failed. Read outputs\*\vast_training.log for the exact error.' }
}
finally {
    Pop-Location
}

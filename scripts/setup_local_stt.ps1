$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvRoot = Join-Path $projectRoot '.venv-stt'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'

Push-Location $projectRoot
try {
    & py -3.12 -c "import sys; assert sys.maxsize > 2**32; print(sys.version)"
    if ($LASTEXITCODE -ne 0) {
        throw '64-bit Python 3.12 is required.'
    }
    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Host '[stt-setup] Creating isolated Python environment...'
        & py -3.12 -m venv $venvRoot
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create .venv-stt.' }
    }

    Write-Host '[stt-setup] Installing the official Qwen3-ASR local runtime...'
    & $venvPython -m pip install --upgrade pip wheel
    if ($LASTEXITCODE -ne 0) { throw 'Failed to update pip.' }
    & $venvPython -m pip install --upgrade qwen-asr
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install qwen-asr.' }

    # PyPI's Windows torch wheel may be CPU-only. Use the CUDA build already validated by the RVC stack.
    Write-Host '[stt-setup] Installing CUDA-enabled PyTorch...'
    & $venvPython -m pip install --upgrade --force-reinstall torch==2.7.1 --index-url https://download.pytorch.org/whl/cu118
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install CUDA-enabled PyTorch.' }

    Write-Host '[stt-setup] Installing accelerated Hugging Face transfers...'
    & $venvPython -m pip install hf_xet
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install hf_xet.' }

    Write-Host '[stt-setup] Downloading accurate Qwen3-ASR-1.7B and low-VRAM fallback model files...'
    & $venvPython -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-ASR-1.7B'); snapshot_download('Qwen/Qwen3-ASR-0.6B')"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to download Qwen3-ASR model files.' }

    & $venvPython -c "import torch; from qwen_asr import Qwen3ASRModel; assert torch.cuda.is_available(), 'CUDA is unavailable'; print('CUDA:', torch.cuda.is_available(), torch.version.cuda); print('Qwen3-ASR import OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Qwen3-ASR verification failed.' }
    Write-Host '[stt-setup] Local Thai-English STT is ready.'
}
finally {
    Pop-Location
}

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$VirtualEnv = Join-Path $ProjectRoot '.venv-jaitts'
$Python = Join-Path $VirtualEnv 'Scripts\python.exe'
$RuntimeRoot = Join-Path $ProjectRoot '.runtime'
$ThonburianRoot = Join-Path $RuntimeRoot 'thonburian-tts'
$HuggingFaceRoot = Join-Path $RuntimeRoot 'huggingface'
$PinnedThonburianCommit = '032fe7e'

Write-Host '=== DIGITAL ME JAITTS LOCAL SETUP ==='
Write-Host 'This installs the expressive Thai source model used before RVC.'

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
  Write-Host '[1/5] Creating the Python 3.11 environment...'
  & py -3.11 -m venv $VirtualEnv
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
  throw 'Python 3.11 is required. Install it, then run npm run jaitts:setup again.'
}

Write-Host '[2/5] Installing CUDA PyTorch...'
& $Python -m pip install --upgrade pip setuptools wheel
& $Python -m pip install torch==2.7.1+cu118 torchaudio==2.7.1+cu118 torchvision==0.22.1+cu118 --index-url https://download.pytorch.org/whl/cu118

New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $ThonburianRoot '.git') -PathType Container)) {
  Write-Host '[3/5] Downloading the Thai F5-TTS runtime...'
  & git clone https://github.com/biodatlab/thonburian-tts.git $ThonburianRoot
  & git -C $ThonburianRoot checkout $PinnedThonburianCommit
} else {
  Write-Host '[3/5] Reusing the existing Thai F5-TTS runtime.'
}

Write-Host '[4/5] Installing JaiTTS dependencies...'
& $Python -m pip install --editable $ThonburianRoot
& $Python -m pip install fastapi uvicorn

Write-Host '[5/5] Caching the JaiTTS model and vocabulary...'
New-Item -ItemType Directory -Path $HuggingFaceRoot -Force | Out-Null
$env:HF_HOME = $HuggingFaceRoot
& $Python -c "from huggingface_hub import hf_hub_download; [hf_hub_download('JTS-AI/JaiTTS-F5TTS', f) for f in ('model.pt', 'vocab.txt')]; print('JaiTTS model cache is ready.')"

Write-Host ''
Write-Host 'JaiTTS setup complete. Start everything with: npm run start:local'

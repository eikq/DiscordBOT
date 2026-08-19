[CmdletBinding()]
param(
    [string]$OllamaModel = 'digital-me-qwen38:27b-ad-q4km',
    [switch]$SkipDownload
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime'))
$toolsVenv = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'model-tools-venv'))
$modelRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'models\qwen3.8-27b'))
$ggufName = 'Qwen3.8-27B-AD-Q4_K_M.gguf'
$ggufPath = Join-Path $modelRoot $ggufName
$ggufSha256 = '9f21564b0c962fd397509672a4a6d11a008c6b80cc6573295bb562832492abf0'

if (-not $runtimeRoot.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved runtime directory escaped the DiscordBOT project.'
}

$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
    $knownPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path -LiteralPath $knownPath) { $ollama = Get-Item -LiteralPath $knownPath }
}
if (-not $ollama) { throw 'Ollama is not installed or is not visible to this PowerShell session.' }
$ollamaPath = $ollama.Source
if (-not $ollamaPath) { $ollamaPath = $ollama.FullName }

New-Item -ItemType Directory -Path $modelRoot -Force | Out-Null
if (-not $SkipDownload -and -not (Test-Path -LiteralPath $ggufPath)) {
    $aria2 = Get-Command aria2c -ErrorAction SilentlyContinue
    $aria2Path = if ($aria2) { $aria2.Source } else { $null }
    if (-not $aria2Path) {
        $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        if (Test-Path -LiteralPath $wingetPackages) {
            $aria2Path = Get-ChildItem -LiteralPath $wingetPackages -Filter aria2c.exe -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
        }
    }
    if ($aria2Path) {
        $downloadUrl = "https://huggingface.co/AtomicChat/Qwen3.8-27B-GGUF/resolve/main/$ggufName`?download=true"
        & $aria2Path --continue=true --max-connection-per-server=16 --split=16 --min-split-size=8M `
            --file-allocation=none --auto-file-renaming=false --allow-overwrite=true `
            --dir=$modelRoot --out=$ggufName $downloadUrl
    } else {
        if (-not (Test-Path -LiteralPath (Join-Path $toolsVenv 'Scripts\python.exe'))) {
            python -m venv $toolsVenv
        }
        $python = Join-Path $toolsVenv 'Scripts\python.exe'
        & $python -m pip install --disable-pip-version-check 'huggingface_hub>=0.34,<2'
        # Direct HTTP works without an extra downloader, although it is slower on large GGUF files.
        $env:HF_HUB_DISABLE_XET = '1'
        & (Join-Path $toolsVenv 'Scripts\hf.exe') download AtomicChat/Qwen3.8-27B-GGUF $ggufName --local-dir $modelRoot
    }
}
if (-not (Test-Path -LiteralPath $ggufPath)) { throw "GGUF is missing at $ggufPath" }
$actualSha256 = (Get-FileHash -LiteralPath $ggufPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $ggufSha256) {
    throw "GGUF checksum mismatch: expected $ggufSha256, got $actualSha256"
}
Write-Host "Verified AtomicChat GGUF SHA256 $actualSha256"

$modelfilePath = Join-Path $modelRoot 'Modelfile.digital-me'
$modelfile = @"
FROM $($ggufPath.Replace('\', '/'))
PARAMETER num_ctx 8192
PARAMETER temperature 0.45
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.08
SYSTEM You are the local intelligence core for Digital Me, a Thai-first Discord voice companion. Follow the application's system message, use tools exactly, and never invent tool results or citations.
"@
Set-Content -LiteralPath $modelfilePath -Value $modelfile -Encoding UTF8
& $ollamaPath create $OllamaModel -f $modelfilePath
& $ollamaPath show $OllamaModel

Write-Host "Qwen3.8 profile $OllamaModel is ready in Ollama."

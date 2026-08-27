# Shared helpers for owner/community one-click launchers.
$ErrorActionPreference = 'Stop'
$script:JarvisLaunchersDir = $PSScriptRoot

function Get-JarvisRepoRoot {
  return (Resolve-Path (Join-Path $script:JarvisLaunchersDir '..')).Path
}

function Test-TcpOpen([int]$Port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $ok = $client.ConnectAsync('127.0.0.1', $Port).Wait(400)
    $client.Close()
    return [bool]$ok
  } catch {
    return $false
  }
}

function Get-HttpText([string]$Url, [int]$TimeoutMs = 1500) {
  try {
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Timeout = $TimeoutMs
    $request.ReadWriteTimeout = $TimeoutMs
    $request.Method = 'GET'
    $response = $request.GetResponse()
    try {
      $reader = [IO.StreamReader]::new($response.GetResponseStream())
      $text = $reader.ReadToEnd()
      $reader.Close()
      return $text
    } finally {
      $response.Close()
    }
  } catch {
    return $null
  }
}

function Test-HttpOk([string]$Url) {
  return $null -ne (Get-HttpText $Url)
}

function Test-JarvisHealth([int]$Port) {
  $text = Get-HttpText "http://127.0.0.1:$Port/api/health"
  if ([string]::IsNullOrWhiteSpace($text)) { return $false }
  try {
    $payload = $text | ConvertFrom-Json
  } catch {
    return $false
  }
  $status = [string]$payload.status
  return $status -eq 'ok' -or $status -eq 'healthy' -or $payload.ok -eq $true
}

function Select-FreeJarvisPort([int]$Preferred, [int]$Fallback) {
  if (-not (Test-TcpOpen $Preferred)) { return $Preferred }
  if (Test-JarvisHealth $Preferred) { return $Preferred }
  Write-Host "Port $Preferred is in use by something that is not this Jarvis. Trying $Fallback."
  return $Fallback
}

function Ensure-NodeJs {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
      $env:Path = "$env:ProgramFiles\nodejs;$env:Path"
      $node = Get-Command node -ErrorAction SilentlyContinue
    }
  }
  if (-not $node) {
    throw 'Node.js was not found. Install Node 18+ and try again.'
  }
  $major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
  if ($major -lt 18) {
    throw "Node.js 18+ is required. Found $(node -v)."
  }
}

function Ensure-NpmModules([string]$RepoRoot) {
  $modules = Join-Path $RepoRoot 'node_modules'
  if (Test-Path -LiteralPath $modules) { return }
  Write-Host 'Dependencies are missing (node_modules).'
  $answer = Read-Host 'Install them now with npm ci? This runs once. [Y/N]'
  if ($answer -notmatch '^(y|yes)$') {
    throw 'Start cancelled. Run npm ci in the repo once, then use this shortcut again.'
  }
  Push-Location $RepoRoot
  try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  } finally {
    Pop-Location
  }
}

function Find-LlamaServerExe {
  if ($env:JARVIS_LLAMA_SERVER -and (Test-Path -LiteralPath $env:JARVIS_LLAMA_SERVER)) {
    return (Resolve-Path -LiteralPath $env:JARVIS_LLAMA_SERVER).Path
  }
  $cmd = Get-Command llama-server -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $winget = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $winget) {
    $found = Get-ChildItem -LiteralPath $winget -Filter 'llama-server.exe' -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Find-QwenGguf {
  if ($env:JARVIS_QWEN_GGUF -and (Test-Path -LiteralPath $env:JARVIS_QWEN_GGUF)) {
    return (Resolve-Path -LiteralPath $env:JARVIS_QWEN_GGUF).Path
  }
  $hits = @()
  $hub = Join-Path $env:USERPROFILE '.cache\huggingface\hub'
  if (Test-Path -LiteralPath $hub) {
    $repos = Get-ChildItem -LiteralPath $hub -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'Qwen3\.8|qwen38|Qwen3.8' }
    foreach ($repo in $repos) {
      $hits += @(Get-ChildItem -LiteralPath $repo.FullName -Recurse -Filter '*abliterated*Q4_K_M*.gguf' -ErrorAction SilentlyContinue)
      $hits += @(Get-ChildItem -LiteralPath $repo.FullName -Recurse -Filter '*cyber*Q4_K_M*.gguf' -ErrorAction SilentlyContinue)
    }
  }
  $runtimeModels = Join-Path (Get-JarvisRepoRoot) '.runtime\models'
  if (Test-Path -LiteralPath $runtimeModels) {
    $hits += @(Get-ChildItem -LiteralPath $runtimeModels -Recurse -Filter '*Q4_K_M*.gguf' -ErrorAction SilentlyContinue)
  }
  $file = $hits | Where-Object { $_ -and $_.Length -gt 1GB } | Select-Object -First 1
  if ($file) { return $file.FullName }
  return $null
}

function Wait-QwenServer([int]$Seconds = 180) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Get-HttpText 'http://127.0.0.1:8086/v1/models' 4000) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Start-OllamaIfNeeded {
  if (Test-HttpOk 'http://127.0.0.1:11434/api/version') {
    Write-Host 'Ollama is already up on 127.0.0.1:11434 (fallback only; Jarvis prefers llama.cpp :8086).'
    return 'ollama:11434'
  }
  $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
  $exe = $null
  if ($ollamaCmd) {
    $exe = $ollamaCmd.Source
  } else {
    $candidates = @(
      (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
      (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($found) { $exe = $found }
  }
  if (-not $exe) { return $null }
  Write-Host 'Starting Ollama serve as a fallback (Qwen llama.cpp was not started).'
  Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpOk 'http://127.0.0.1:11434/api/version') {
      Write-Host 'Ollama is ready.'
      return 'ollama:11434'
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Start-LocalModelIfNeeded {
  if (Test-HttpOk 'http://127.0.0.1:8086/v1/models') {
    Write-Host 'Qwen llama.cpp is already up on 127.0.0.1:8086.'
    return 'llama.cpp:8086'
  }
  if (Test-TcpOpen 8086) {
    Write-Host 'Port 8086 is already in use, but /v1/models is not ready. Not starting a second Qwen server.'
    return $null
  }

  $server = Find-LlamaServerExe
  $gguf = Find-QwenGguf
  if ($server -and $gguf) {
    if (Test-HttpOk 'http://127.0.0.1:11434/api/version') {
      Write-Host 'Ollama is already on :11434. Starting Qwen on :8086 anyway; they may compete for VRAM.'
    }
    $ctx = if ($env:JARVIS_QWEN_CTX) { $env:JARVIS_QWEN_CTX } else { '32768' }
    $ngl = if ($env:JARVIS_QWEN_NGL) { $env:JARVIS_QWEN_NGL } else { '99' }
    Write-Host "Starting Qwen llama.cpp on 127.0.0.1:8086 as qwen38-cyber"
    Write-Host "  server: $server"
    Write-Host "  model:  $gguf"
    Write-Host 'Loading into VRAM can take a minute. A llama-server window will stay open.'
    $argList = @(
      '-m', $gguf,
      '--host', '127.0.0.1',
      '--port', '8086',
      '--alias', 'qwen38-cyber',
      '-c', $ctx,
      '-ngl', $ngl
    )
    Start-Process -FilePath $server -ArgumentList $argList
    if (Wait-QwenServer 180) {
      Write-Host 'Qwen llama.cpp is ready on 127.0.0.1:8086.'
      return 'llama.cpp:8086'
    }
    Write-Host 'Qwen llama.cpp did not become ready in time. Jarvis UI will still open; answers may stay offline.'
    return $null
  }

  if (-not $server) {
    Write-Host 'llama-server.exe was not found. Install llama.cpp or set JARVIS_LLAMA_SERVER.'
  }
  if (-not $gguf) {
    Write-Host 'Qwen GGUF was not found. Set JARVIS_QWEN_GGUF to the .gguf path.'
  }
  $fallback = Start-OllamaIfNeeded
  if ($fallback) { return $fallback }
  Write-Host 'No local Qwen server started. Jarvis UI will still open.'
  return $null
}

function Open-Browser([string]$Url) {
  Start-Process $Url
}

function Stop-ListenerOnPort([int]$Port, [string]$Label) {
  if (-not (Test-TcpOpen $Port)) {
    Write-Host "$Label is not listening on 127.0.0.1:$Port."
    return
  }
  if (-not (Test-JarvisHealth $Port)) {
    Write-Host "Port $Port is open, but it does not look like $Label. Not killing it."
    return
  }
  $conns = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $pids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($procId in $pids) {
    if ($procId -and $procId -gt 0) {
      Write-Host "Stopping $Label pid $procId on port $Port..."
      Stop-Process -Id $procId -ErrorAction SilentlyContinue
    }
  }
}

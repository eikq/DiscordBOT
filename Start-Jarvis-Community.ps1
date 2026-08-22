#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Test-TcpPort([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(400, $false)
    if ($ok) { $client.EndConnect($async) | Out-Null }
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

Write-Host 'JARVIS Community Edition launcher'
Write-Host 'Local bind only. Administrator is not required.'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is not on PATH. Install Node.js 18 or newer.'
  exit 1
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 18) {
  Write-Error "Node.js 18 or newer is required. Found $(node -v)."
  exit 1
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Error 'Dependencies are missing. Run npm ci first.'
  exit 1
}

if (-not (Test-Path -LiteralPath '.env.community') -and (Test-Path -LiteralPath '.env.community.example')) {
  Copy-Item -LiteralPath '.env.community.example' -Destination '.env.community'
  Write-Host 'Created .env.community from the sanitized example. Edit the model endpoint if needed.'
}

$env:JARVIS_EDITION = 'community'
$env:JARVIS_STANDALONE = '1'
$env:HOST = '127.0.0.1'
if (-not $env:PORT) {
  $env:PORT = if (Test-TcpPort 3012) { '3013' } else { '3012' }
}

Write-Host "Starting Community JARVIS at http://127.0.0.1:$($env:PORT)/jarvis"
Write-Host 'This launcher does not install models or change Windows security.'
npm run jarvis:community

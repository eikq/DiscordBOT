#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\shared.ps1')

$root = Get-JarvisRepoRoot
Set-Location -LiteralPath $root

Write-Host '========================================'
Write-Host '  JARVIS  —  Community Edition'
Write-Host '========================================'
Write-Host "Repo: $root"
Write-Host 'Data: data\community\'
Write-Host ''

Ensure-NodeJs
Ensure-NpmModules $root
Start-LocalModelIfNeeded | Out-Null

$exampleCandidates = @(
  (Join-Path $root '.env.community.example'),
  (Join-Path $root '.env.community.example')
)
$envFile = Join-Path $root '.env.community'
if (-not (Test-Path -LiteralPath $envFile)) {
  $example = $exampleCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($example) {
    Copy-Item -LiteralPath $example -Destination $envFile
    Write-Host 'Created .env.community from the example. Edit the model URL if yours is not :8086.'
  }
}

$env:JARVIS_EDITION = 'community'
$env:JARVIS_STANDALONE = '1'
$env:HOST = '127.0.0.1'
$port = Select-FreeJarvisPort 3012 3013
$env:PORT = [string]$port
$url = "http://127.0.0.1:$port/jarvis"

if (Test-JarvisHealth $port) {
  Write-Host "Community Jarvis is already running. Opening $url"
  Open-Browser $url
  Start-Sleep -Seconds 2
  exit 0
}

Write-Host "Starting Community Jarvis on $url"
Write-Host 'First run may open /setup. Keep the JARVIS Community window open.'
Write-Host 'This shortcut does not start Discord, CCTV, or private owner services.'
Write-Host ''

$startCmd = "title JARVIS Community && set JARVIS_EDITION=community&& set JARVIS_STANDALONE=1&& set HOST=127.0.0.1&& set PORT=$port&& npm run jarvis:community"
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $startCmd) -WorkingDirectory $root

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  if (Test-JarvisHealth $port) { break }
  Start-Sleep -Milliseconds 500
}

if (Test-JarvisHealth $port) {
  Open-Browser $url
  Write-Host "Opened $url"
} else {
  Write-Host 'Server did not become healthy in time. Check the JARVIS Community window.'
}
Start-Sleep -Seconds 3

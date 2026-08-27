#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\shared.ps1')

$root = Get-JarvisRepoRoot
Set-Location -LiteralPath $root

Write-Host '========================================'
Write-Host '  JARVIS  —  Owner Edition'
Write-Host '========================================'
Write-Host "Repo: $root"
Write-Host 'Data: data\jarvis\'
Write-Host ''

Ensure-NodeJs
Ensure-NpmModules $root
Start-LocalModelIfNeeded | Out-Null

Remove-Item Env:JARVIS_EDITION -ErrorAction SilentlyContinue
$env:JARVIS_STANDALONE = '1'
$env:HOST = '127.0.0.1'
$port = Select-FreeJarvisPort 3010 3011
$env:PORT = [string]$port
$url = "http://127.0.0.1:$port/jarvis"
$lab = "http://127.0.0.1:$port/jarvis-lab"

if (Test-JarvisHealth $port) {
  Write-Host "Owner Jarvis is already running. Opening $url"
  Open-Browser $url
  Start-Sleep -Seconds 2
  exit 0
}

Write-Host "Starting Owner Jarvis on $url"
Write-Host "Lab: $lab"
Write-Host 'Keep the JARVIS Owner window open. Close it or use Stop to shut down.'
Write-Host 'This shortcut does not start Discord, CCTV, or the Night Agent.'
Write-Host ''

$startCmd = "title JARVIS Owner && set JARVIS_STANDALONE=1&& set HOST=127.0.0.1&& set PORT=$port&& set JARVIS_EDITION=&& npm run dev"
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
  Write-Host 'Server did not become healthy in time. Check the JARVIS Owner window.'
}
Start-Sleep -Seconds 3

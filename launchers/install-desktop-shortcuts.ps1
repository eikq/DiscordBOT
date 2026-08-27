#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$root = Join-Path $desktop 'JARVIS'

$ownerDir = Join-Path $root 'Owner Edition'
$communityDir = Join-Path $root 'Community Edition'
New-Item -ItemType Directory -Force -Path $ownerDir | Out-Null
New-Item -ItemType Directory -Force -Path $communityDir | Out-Null

foreach ($stale in @(
  '1 Start Owner JARVIS.lnk',
  '2 Stop Owner JARVIS.lnk',
  '1 Start Owner JARVIS.lnk',
  '2 Stop Owner JARVIS.lnk'
)) {
  $path = Join-Path $ownerDir $stale
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
foreach ($stale in @(
  '1 Start Community JARVIS.lnk',
  '2 Stop Community JARVIS.lnk',
  '1 Start Community JARVIS.lnk',
  '2 Stop Community JARVIS.lnk'
)) {
  $path = Join-Path $communityDir $stale
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

function New-JarvisShortcut([string]$LinkPath, [string]$Target, [string]$WorkDir, [string]$Description) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($LinkPath)
  $shortcut.TargetPath = $Target
  $shortcut.WorkingDirectory = $WorkDir
  $shortcut.WindowStyle = 1
  $shortcut.Description = $Description
  $shortcut.Save()
}

New-JarvisShortcut (Join-Path $ownerDir '1 Start Owner JARVIS.lnk') (Join-Path $repo 'launchers\owner\start.cmd') (Join-Path $repo 'launchers\owner') 'Start owner JARVIS with local model if available'
New-JarvisShortcut (Join-Path $ownerDir '2 Stop Owner JARVIS.lnk') (Join-Path $repo 'launchers\owner\stop.cmd') (Join-Path $repo 'launchers\owner') 'Stop owner JARVIS (does not stop Ollama/llama.cpp)'
New-JarvisShortcut (Join-Path $communityDir '1 Start Community JARVIS.lnk') (Join-Path $repo 'launchers\community\start.cmd') (Join-Path $repo 'launchers\community') 'Start Community JARVIS with local model if available'
New-JarvisShortcut (Join-Path $communityDir '2 Stop Community JARVIS.lnk') (Join-Path $repo 'launchers\community\stop.cmd') (Join-Path $repo 'launchers\community') 'Stop Community JARVIS (does not stop Ollama/llama.cpp)'

@'
Owner Edition (your private Jarvis)

Double-click:  1 Start Owner JARVIS.lnk

That starts:
- Qwen llama.cpp on http://127.0.0.1:8086 (alias qwen38-cyber) if it is not already running
- Owner Jarvis on http://127.0.0.1:3010/jarvis  (3011 if 3010 is busy)

Stop with:  2 Stop Owner JARVIS.lnk
Stop does not kill the Qwen / llama.cpp window.

Do not use Community shortcuts here.
'@ | Set-Content -Encoding UTF8 (Join-Path $ownerDir 'README.txt')

@'
Community Edition (isolated public-style Jarvis)

Double-click:  1 Start Community JARVIS.lnk

That starts:
- Qwen llama.cpp on http://127.0.0.1:8086 (alias qwen38-cyber) if it is not already running
- Community Jarvis on http://127.0.0.1:3012/jarvis  (3013 if 3012 is busy)
- First run may open the setup wizard

Stop with:  2 Stop Community JARVIS.lnk
Stop does not kill the Qwen / llama.cpp window.

Uses data\community\  — not owner data\jarvis\
'@ | Set-Content -Encoding UTF8 (Join-Path $communityDir 'README.txt')

Write-Host "Shortcuts installed at:"
Write-Host "  $ownerDir"
Write-Host "  $communityDir"

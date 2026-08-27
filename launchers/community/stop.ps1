#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\shared.ps1')

Write-Host 'Stopping Community Jarvis (ports 3012/3013). Local model servers are left running.'
Stop-ListenerOnPort 3012 'Community Jarvis'
Stop-ListenerOnPort 3013 'Community Jarvis'
Write-Host 'Done.'
Start-Sleep -Seconds 2

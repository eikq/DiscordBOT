#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\shared.ps1')

Write-Host 'Stopping Owner Jarvis (ports 3010/3011). Local model servers are left running.'
Stop-ListenerOnPort 3010 'Owner Jarvis'
Stop-ListenerOnPort 3011 'Owner Jarvis'
Write-Host 'Done.'
Start-Sleep -Seconds 2

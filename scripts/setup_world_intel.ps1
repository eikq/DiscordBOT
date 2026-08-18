[CmdletBinding()]
param(
    [string]$Commit = '9254192d83f88bd7e5312b074c11f09398b84ca9'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime'))
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'world-intel-mcp'))
$venvRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot 'world-intel-venv'))

if (-not $runtimeRoot.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved runtime directory escaped the DiscordBOT project.'
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '.git'))) {
    git clone --filter=blob:none --no-checkout https://github.com/marc-shade/world-intel-mcp.git $sourceRoot
}

$remote = (git -C $sourceRoot remote get-url origin).Trim()
if ($remote -notmatch '^https://github\.com/marc-shade/world-intel-mcp(?:\.git)?$') {
    throw "Unexpected world-intel-mcp remote: $remote"
}

git -C $sourceRoot fetch --filter=blob:none origin $Commit
git -C $sourceRoot checkout --detach $Commit
$actualCommit = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($actualCommit -ne $Commit) {
    throw "world-intel-mcp checkout mismatch: expected $Commit, got $actualCommit"
}

if (-not (Test-Path -LiteralPath (Join-Path $venvRoot 'Scripts\python.exe'))) {
    python -m venv $venvRoot
}
$python = Join-Path $venvRoot 'Scripts\python.exe'
& $python -m pip install --disable-pip-version-check $sourceRoot
$mcpExecutable = Join-Path $venvRoot 'Scripts\world-intel-mcp.exe'
$intelCli = Join-Path $venvRoot 'Scripts\intel.exe'
if (-not (Test-Path -LiteralPath $mcpExecutable)) {
    throw "world-intel-mcp MCP server executable is missing at $mcpExecutable"
}
if (Test-Path -LiteralPath $intelCli) {
    & $intelCli status
} else {
    Write-Warning "intel.exe CLI was not installed; MCP server $mcpExecutable is still present."
}

Write-Host "world-intel-mcp is pinned and ready at $actualCommit"
Write-Host "MCP stdio command: $mcpExecutable"

# Builds the native panel-validation subject and all prerequisite Slate libraries, then optionally runs it.
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')] [string] $Configuration = 'Release',
    [switch] $Rebuild,
    [switch] $Run
)

$ErrorActionPreference = 'Stop'
$Construct = Join-Path $PSScriptRoot 'Construct.ps1'
$Arguments = @('-Configuration', $Configuration, '-Subject', 'PanelValidationHost')
if ($Rebuild) { $Arguments += '-Rebuild' }

& powershell -NoProfile -ExecutionPolicy Bypass -File $Construct @Arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Run)
{
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
    $Executable = Join-Path $RepositoryRoot "_AgentScratch\build\$Configuration\Bin\PanelValidationHost.exe"
    if (-not (Test-Path $Executable)) { throw "PanelValidationHost was not produced at $Executable" }
    & $Executable
    exit $LASTEXITCODE
}

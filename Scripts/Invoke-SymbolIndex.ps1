#============================================================================================================================================
#                                                           INVOKE-SYMBOLINDEX.PS1
#============================================================================================================================================
# 🧩 Invokes the Slate symbol indexer tool (Tools/SymbolIndex.py) across the repository.

#------------------------------------------------------------------------------------------------------------------------
#                                                        SYMBOL INDEX EXECUTION
#------------------------------------------------------------------------------------------------------------------------

function Invoke-SymbolIndex {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Command = "build",

        [Parameter(Position = 1)]
        [string]$Target = "",

        [string]$Root = "Engine",

        [switch]$NoCallSites,

        [switch]$All
    )

    $ToolsPath = "C:\Users\OS\Documents\Slate\Tools\SymbolIndex.py"
    if (-not (Test-Path -Path $ToolsPath)) {
        Write-Error "🔴 SymbolIndex.py not found at $ToolsPath"
        return
    }

    $ArgumentList = @($ToolsPath, "--root", $Root)

    if ($NoCallSites) {
        $ArgumentList += "--no-call-sites"
    }

    $ArgumentList += $Command

    if ($Target) {
        $ArgumentList += $Target
    }

    if ($All) {
        $ArgumentList += "--all"
    }

    & python $ArgumentList
}

Invoke-SymbolIndex @args

# Construct.ps1 — builds every Slate unit with cl.exe, lib.exe and link.exe directly.
#
# 🔴 /MD in every configuration, including Debug. SLATE_DEBUG selects the debug path; _DEBUG is never
#    defined, because it selects the debug CRT and mixing that with /MD is a link failure at best.
#
#     powershell -File Build\Construct.ps1
#     powershell -File Build\Construct.ps1 -Configuration Debug
#     powershell -File Build\Construct.ps1 -Unit SlateMath -Rebuild

[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')] [string] $Configuration = 'Release',
    [string]                                   $Unit          = '',
    [switch]                                   $Rebuild,

    # 📝 Zero means "one translation per logical processor", which is what /MP does when given no count.
    #    A figure is accepted so a machine that is also doing something else can be told to leave room.
    [int]                                      $Parallel      = 0
)

$ErrorActionPreference = 'Stop'

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$EngineRoot     = Join-Path $RepositoryRoot 'Engine'
$PackageRoot    = Join-Path $RepositoryRoot 'ExternalPackages'
$ScriptRoot     = Join-Path $RepositoryRoot 'Scripts'
$OutputRoot     = Join-Path $RepositoryRoot "_AgentScratch\build\$Configuration"

# Each dependency script is invoked at most once per session even when multiple subjects
#    are linked. The flag is set after the first successful invocation and suppresses repeats.
$script:GlfwBuilt   = $false
$script:ThorVGBuilt = $false

#---
#                                        CONSOLE REPORTING
#---

# 📝 The tag is padded to a fixed width so the messages after it line up as a column regardless of which
#    stage wrote them.
function Write-Report([string] $Tag, [System.ConsoleColor] $Colour, [string] $Message)
{
    Write-Host ("[$Tag]".PadRight(10)) -ForegroundColor $Colour -NoNewline
    Write-Host " $Message"
}

function Write-Building([string] $Message) { Write-Report 'Build'    DarkGray $Message }
function Write-Skipped([string]  $Message) { Write-Report 'SKIP'     Cyan     $Message }
function Write-Refused([string]  $Message) { Write-Report 'FAILED'   Red      $Message }
function Write-Produced([string] $Message) { Write-Report 'Compiled' Green    $Message }
function Write-Lowered([string]  $Message) { Write-Report 'SPIR-V'   Magenta  $Message }

#---
#                                          THE UNIT ORDER
#---

#---
#                                    THE DECLARED UNIT GRAPH
#---

# 🔴 `Module.toml` is the authority and this script derives the graph from it. The array that used to sit
#    here restated the same facts in a second place, and two statements of one graph are two things to keep
#    agreeing — `SlateUI` had carried four requirements it did not use for exactly as long as nothing read
#    the manifests.
#
# 🔴 Two DIFFERENT facts are read, and conflating them is the mistake this arrangement exists to prevent:
#      [requires].unit  — what a unit may **include**. Enforced by `Scripts/VerifyPartition.ps1`.
#      [link].unit      — what an executable must **link**, most-dependent first.
#    They coincide for most units and part for `SlateUI`, which links four archives and includes none.
#
# 📝 Translation order is a topological sort of `[link].unit`, because a unit's archive must exist before
#    anything that links it. `[requires]` cannot order the build: `SlateUI` requires nothing and must still
#    be translated last of the libraries.
function Read-UnitGraph
{
    $Declared = @{}

    foreach ($Manifest in Get-ChildItem $EngineRoot -Filter 'Module.toml' -File -Recurse)
    {
        $Content  = Get-Content $Manifest.FullName -Raw
        $UnitRoot = Split-Path -Parent $Manifest.FullName
        $UnitName = Split-Path -Leaf $UnitRoot

        if ($Content -match '(?ms)^\[unit\].*?^name\s*=\s*"([^"]+)"')
        {
            $UnitName = $Matches[1]
        }

        $Product = if ($Content -match '(?ms)^\[unit\].*?^product\s*=\s*"([^"]+)"') { $Matches[1] }
                   else                                                               { 'StaticLibrary' }

        # 📝 A subject names one source folder that becomes its own link target. `32` §5's "separate editors
        #    or one Editor" is this field: every folder named here links an executable of its own name from
        #    one shared set of archives. A StaticLibrary ignores it and archives its whole tree.
        $Subject = @()

        if ($Content -match '(?ms)^\[unit\].*?^subject\s*=\s*\[(.*?)\]')
        {
            $Subject = [regex]::Matches($Matches[1], '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
        }

        $Linked = @()

        if ($Content -match '(?ms)^\[link\].*?^unit\s*=\s*\[(.*?)\]')
        {
            $Linked = [regex]::Matches($Matches[1], '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
        }

        $Declared[$UnitName] = @{
            Name     = $UnitName
            Product  = $Product
            Subject  = @($Subject)
            Requires = @($Linked)
            Root     = $UnitRoot
        }
    }

    return $Declared
}

# 🔴 Kahn's algorithm, so a cycle is reported as a cycle rather than as a stack overflow or an arbitrary
#    order. An unknown unit is refused here too: naming an archive that no manifest declares would reach
#    link.exe as a missing file, which names the path and not the declaration that asked for it.
function Resolve-TranslationOrder([hashtable] $Declared)
{
    $Remaining = @{}
    $Ordered   = New-Object System.Collections.Generic.List[hashtable]

    foreach ($UnitName in $Declared.Keys)
    {
        foreach ($Required in $Declared[$UnitName].Requires)
        {
            if (-not $Declared.ContainsKey($Required))
            {
                throw "$UnitName links $Required, which declares no Module.toml"
            }
        }

        $Remaining[$UnitName] = [System.Collections.Generic.HashSet[string]]::new(
            [string[]] $Declared[$UnitName].Requires)
    }

    while ($Remaining.Count -gt 0)
    {
        # 📝 Sorted so the order is reproducible. Two units with no remaining dependency are equally valid
        #    at this position, and an unsorted pass would translate them in hashtable order — which differs
        #    between runs and turns a reproducible build into an almost-reproducible one.
        $Ready = @($Remaining.Keys | Where-Object { $Remaining[$_].Count -eq 0 } | Sort-Object)

        if ($Ready.Count -eq 0)
        {
            $Stuck = ($Remaining.Keys | Sort-Object) -join ', '
            throw "the unit graph holds a cycle among: $Stuck"
        }

        foreach ($UnitName in $Ready)
        {
            $Ordered.Add($Declared[$UnitName])
            $Remaining.Remove($UnitName)
        }

        foreach ($UnitName in @($Remaining.Keys))
        {
            foreach ($Settled in $Ready)
            {
                [void] $Remaining[$UnitName].Remove($Settled)
            }
        }
    }

    return $Ordered.ToArray()
}

# 🔴 A subject declared twice would have one host's objects overwrite the other's in a shared folder, and
#    both would compile. Refused here rather than discovered as a host that runs the wrong main().
function Test-SubjectUniqueness([hashtable] $Declared)
{
    $Seen = @{}

    foreach ($UnitName in ($Declared.Keys | Sort-Object))
    {
        foreach ($Subject in $Declared[$UnitName].Subject)
        {
            if ($Seen.ContainsKey($Subject))
            {
                throw "subject $Subject is declared by both $($Seen[$Subject]) and $UnitName"
            }

            $Seen[$Subject] = $UnitName
        }
    }
}

$DeclaredUnits = Read-UnitGraph
Test-SubjectUniqueness $DeclaredUnits
$UnitOrder = Resolve-TranslationOrder $DeclaredUnits


#---
#                                       TOOLCHAIN ACQUISITION
#---

# 📝 cl.exe is not on PATH in this environment, so the Visual Studio environment is imported here rather
#    than assumed. vcvarsall.bat runs once and the environment it produced is read back into this session.
function Import-ToolchainEnvironment
{
    if (Get-Command cl.exe -ErrorAction SilentlyContinue)
    {
        Write-Skipped 'toolchain already on PATH'
        return
    }

    $Candidates = @(
        'C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat'
        'C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvarsall.bat'
        'C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvarsall.bat'
        'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat'
        'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat'
    )

    $Selected = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($null -eq $Selected)
    {
        throw 'no vcvarsall.bat was found; the C++ toolchain is not installed where this script looks'
    }

    Write-Building "toolchain $Selected"

    $Captured = cmd.exe /c "`"$Selected`" x64 > nul & set"

    foreach ($Line in $Captured)
    {
        if ($Line -match '^([^=]+)=(.*)$')
        {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] -ErrorAction SilentlyContinue
        }
    }

    if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue))
    {
        throw 'vcvarsall.bat ran but cl.exe is still absent from PATH'
    }
}

function Resolve-VulkanRoot
{
    if ($env:VULKAN_SDK -and (Test-Path $env:VULKAN_SDK))
    {
        return $env:VULKAN_SDK
    }

    $Installed = Get-ChildItem 'C:\VulkanSDK' -Directory -ErrorAction SilentlyContinue |
                 Sort-Object Name -Descending |
                 Select-Object -First 1

    if ($null -eq $Installed)
    {
        throw 'no Vulkan SDK was found; VULKAN_SDK is unset and C:\VulkanSDK holds nothing'
    }

    return $Installed.FullName
}

#---
#                                         COMPILATION FLAGS
#---

# 🔴 /fp:precise is not decoration. The exact orientation predicate relies on round-to-nearest and on the
#    absence of contraction; /fp:fast reassociates the filtered determinant and its sign stops being exact.
function Get-CompilationFlags([string] $Selection)
{
    $Common = @(
        '/nologo'
        '/c'
        '/EHsc'
        # 🔴 /MP compiles the batch across processes. It is incompatible with /Gm (retired), with #import,
        #    and with a per-translation /Fd — which is why the object folder receives one shared database
        #    below rather than each translation naming its own.
        $(if ($Parallel -gt 0) { "/MP$Parallel" } else { '/MP' })
        '/MD'
        '/std:c++20'
        '/permissive-'
        '/fp:precise'
        '/W4'
        '/utf-8'
        '/Zc:__cplusplus'
        '/DWIN32_LEAN_AND_MEAN'
        '/DNOMINMAX'
        '/DGLFW_DLL'
    )

    # 📝 ⏱️ /Zf with /Zi. Debug records are otherwise serialised through mspdbsrv.exe, and under /MP that
    #    single writer is what the parallel translations queue behind — the flag exists for exactly this
    #    arrangement and costs nothing when only one translation is running.
    if ($Selection -eq 'Debug')
    {
        # 📝 🔴 SLATE_DEBUG selects every debug path in the engine. _DEBUG is never defined — it selects the
        #    debug CRT, and /MD is declared for every configuration, so the two cannot both be honoured.
        return $Common + @('/Od', '/Zi', '/Zf', '/DSLATE_DEBUG=1')
    }

    return $Common + @('/O2', '/Zi', '/Zf', '/DNDEBUG')
}

#---
#                                           PATH ASSEMBLY
#---

function Get-IncludePath([hashtable] $UnitEntry, [string] $VulkanRoot)
{
    # 📝 Contract/ and Shared/ are reachable from every unit through the engine root, and so is every other
    #    unit's Api/ folder. The partition is not enforced by hiding headers — it is enforced by the link:
    #    SlateDocument is never handed SlateVulkan.lib, so a device reference fails to resolve.
    $Paths  = @($EngineRoot)
    $Paths += (Join-Path $PackageRoot 'glfw\include')
    $Paths += (Join-Path $VulkanRoot  'Include')

    if ($UnitEntry.Name -eq 'SlateUI')
    {
        $Paths += (Join-Path $PackageRoot 'imgui')
        $Paths += (Join-Path $PackageRoot 'thorvg\inc')
    }

    # 🔴 `10` §1's codecs compile the vendored readers — stb and fast_obj — into their own translation units,
    #    so SlateDocument reaches the package root and no other unit does. The scoping is the point: a second
    #    unit that included one of these headers would compile a second copy of the implementation into the
    #    link, and the duplicate-symbol failure that follows names the linker rather than the include.
    if ($UnitEntry.Name -eq 'SlateDocument')
    {
        $Paths += $PackageRoot
    }

    return @($Paths | ForEach-Object { "/I$_" })
}

function Get-UnitSource([hashtable] $UnitEntry, [string] $Subject = '')
{
    $UnitRoot = Join-Path $EngineRoot $UnitEntry.Name

    # 📝 A subject scopes the gather to its own folder, which is what keeps one host's main() out of another's
    #    link. Without the scoping every host would carry every other host's entry point and the linker would
    #    refuse the duplicate — naming main() rather than naming the arrangement that produced it.
    if ($Subject)
    {
        $UnitRoot = Join-Path $UnitRoot $Subject

        if (-not (Test-Path $UnitRoot))
        {
            throw "$($UnitEntry.Name) declares subject $Subject but $UnitRoot does not exist"
        }
    }

    $Sources  = @(Get-ChildItem $UnitRoot -Recurse -Filter '*.cpp' -File | ForEach-Object { $_.FullName })

    # 📝 🔴 `00` §2.2: exactly one copy of ImGui exists in the process and it is compiled into SlateUI. The
    #    vendored translation units are appended here rather than built into a library of their own, so a
    #    second copy cannot enter the link.
    if ($UnitEntry.Name -eq 'SlateUI')
    {
        $Sources += @(
            (Join-Path $PackageRoot 'imgui\imgui.cpp')
            (Join-Path $PackageRoot 'imgui\imgui_draw.cpp')
            (Join-Path $PackageRoot 'imgui\imgui_tables.cpp')
            (Join-Path $PackageRoot 'imgui\imgui_widgets.cpp')
            (Join-Path $PackageRoot 'imgui\backends\imgui_impl_glfw.cpp')
            (Join-Path $PackageRoot 'imgui\backends\imgui_impl_vulkan.cpp')
        )
    }

    return $Sources
}

#---
#                                           TRANSLATION
#---

# 📝 MSVC writes its diagnostics to stdout, so nothing here redirects stderr. Redirecting a native
#    executable's stderr in Windows PowerShell wraps each line in an ErrorRecord and, under an Stop
#    preference, turns a plain warning into a thrown build failure.
#---
#                                          RESPONSE FILES
#---

# 🔴 cl.exe is handed its arguments in a response file rather than on the command line. A batch of
#    thirty-five absolute source paths plus the include path passes the 32 767 character Windows command
#    line on a deep checkout, and the truncation that follows names neither the build nor the file it cut.
#
# 🔴 Quoting follows CommandLineToArgvW, which is what cl.exe parses with: an argument is quoted only when
#    it carries a space, a tab or a quote, and any run of backslashes immediately before the closing quote
#    is doubled. `/FoC:\Program Files\build\` is exactly that case — unquoted it splits in two, and quoted
#    without doubling the final backslash escapes the quote and swallows the next argument.
function Write-ResponseFile([string] $ResponsePath, [string[]] $Arguments)
{
    $Quoted = foreach ($Argument in $Arguments)
    {
        if ($Argument -notmatch '[ \t"]')
        {
            $Argument
        }
        else
        {
            $Trailing = 0

            while ($Trailing -lt $Argument.Length -and
                   $Argument[$Argument.Length - 1 - $Trailing] -eq '\')
            {
                ++$Trailing
            }

            '"' + $Argument + ('\' * $Trailing) + '"'
        }
    }

    # 📝 ASCII, and no byte-order mark. cl.exe reads a response file in the system code page and a UTF-8
    #    BOM arrives as three stray characters at the head of the first argument.
    Set-Content -Path $ResponsePath -Value ($Quoted -join "`r`n") -Encoding ASCII
}

#---
#                                        TRANSLATION FRESHNESS
#---

# 🔴 An object is stale when any header it included is newer than it — not merely when its own .cpp is.
#    Comparing the .cpp alone is the defect this function exists to remove: editing a header rebuilt
#    nothing, the link succeeded against yesterday's objects, and the executable ran code from the
#    previous edit with no diagnostic anywhere. `32` §4.1 already states the shape of that failure for
#    shaders — "an engine that runs correct code from the previous edit" — and it applied here too.
#
# 📝 cl.exe /sourceDependencies writes the full include closure as JSON beside the object. The record is
#    written by the same invocation that produced the object, so the two cannot describe different
#    translations.
function Test-ObjectFresh([string] $ObjectPath, [string] $SourcePath, [string] $DependencyPath)
{
    if ($Rebuild)                        { return $false }
    if (-not (Test-Path $ObjectPath))    { return $false }
    if (-not (Test-Path $SourcePath))    { return $false }

    $ObjectWritten = (Get-Item $ObjectPath).LastWriteTimeUtc

    if ($ObjectWritten -le (Get-Item $SourcePath).LastWriteTimeUtc)
    {
        return $false
    }

    # 🔴 No record means no knowledge, and no knowledge means retranslate. Treating an absent record as
    #    "probably fine" reinstates exactly the defect this function removes — on the one build where it
    #    matters, which is the first build after someone deleted the scratch folder by hand.
    if (-not (Test-Path $DependencyPath))
    {
        return $false
    }

    try
    {
        $Recorded = Get-Content $DependencyPath -Raw | ConvertFrom-Json
        $Included = $Recorded.Data.Includes
    }
    catch
    {
        return $false
    }

    if ($null -eq $Included)
    {
        return $false
    }

    foreach ($Header in $Included)
    {
        # A header that has been deleted since the last translation changes the closure, so the object
        # no longer describes the source it was built from.
        if (-not (Test-Path $Header))
        {
            return $false
        }

        # ⚠️ `-ge` and not `-gt`. A header written inside the same filesystem tick as the object is not
        #    provably older than it, and NTFS timestamps are coarse enough for that to happen on a fast
        #    edit-and-build. Retranslating a fresh object costs seconds; trusting a stale one costs a
        #    debugging session.
        if ((Get-Item $Header).LastWriteTimeUtc -ge $ObjectWritten)
        {
            return $false
        }
    }

    return $true
}

function Invoke-Translation([hashtable] $UnitEntry, [string] $Selection, [string] $VulkanRoot, [string] $Subject = '')
{
    $UnitName    = $UnitEntry.Name

    # 📝 Objects are kept in a per-subject folder. Two subjects may carry a file of the same stem, and a shared
    #    object folder would have one overwrite the other's — silently, since both compile.
    $ObjectRoot  = if ($Subject) { Join-Path $OutputRoot "Object\$UnitName\$Subject" }
                   else          { Join-Path $OutputRoot "Object\$UnitName" }
    $Sources     = Get-UnitSource $UnitEntry $Subject
    $IncludePath = Get-IncludePath $UnitEntry $VulkanRoot
    $Flags       = Get-CompilationFlags $Selection

    if ($Sources.Count -eq 0)
    {
        throw "$UnitName$(if ($Subject) { " / $Subject" }) declares no translation unit"
    }

    if (-not (Test-Path $ObjectRoot))
    {
        New-Item -ItemType Directory -Force -Path $ObjectRoot | Out-Null
    }

    Write-Building "$UnitName — $($Sources.Count) translation units"

    $Produced = New-Object System.Collections.Generic.List[string]
    $Stale    = New-Object System.Collections.Generic.List[string]

    foreach ($Source in $Sources)
    {
        $Stem           = [System.IO.Path]::GetFileNameWithoutExtension($Source)
        $ObjectPath     = Join-Path $ObjectRoot "$Stem.obj"
        $DependencyPath = Join-Path $ObjectRoot "$Stem.deps.json"
        $Produced.Add($ObjectPath)

        if (-not (Test-ObjectFresh $ObjectPath $Source $DependencyPath))
        {
            $Stale.Add($Source)
        }
    }

    if ($Stale.Count -eq 0)
    {
        Write-Skipped "$UnitName unchanged"
        return $Produced.ToArray()
    }

    # 🔴 ⏱️ Every stale translation is handed to ONE cl.exe invocation, because /MP parallelises within an
    #    invocation and not across them. One file per invocation — which is what this loop used to do —
    #    pays process start-up and toolchain initialisation per translation unit and leaves every core but
    #    one idle. Thirty-five translations in one call is the whole of the speed-up.
    # 🔴 /Fo receives the object DIRECTORY and not a file. A batch cannot name one output per input, so the
    #    compiler derives each object from its source stem. Verified safe: no unit carries two sources of
    #    the same stem, including the six vendored ImGui translations SlateUI compiles.
    # 📝 /Fd is one database for the whole object folder. /MP forbids a per-translation database, and two
    #    invocations sharing one corrupt it — which is why the batch is single-invocation.
    # 📝 /sourceDependencies writes one record per translation, named after the source stem, so
    #    the per-translation-unit precision the freshness predicate depends on survives batching.
    $DependencyRoot = Join-Path $ObjectRoot 'Dependency'

    if (-not (Test-Path $DependencyRoot))
    {
        New-Item -ItemType Directory -Force -Path $DependencyRoot | Out-Null
    }

    # 📝 /sourceDependencies receives the destination directory for per-translation JSON dependency records.
    #    A trailing backslash distinguishes a directory operand from a file operand.
    $Arguments = $Flags + $IncludePath + @(
        ('/Fo' + $ObjectRoot + '\')
        "/Fd$(Join-Path $ObjectRoot "$UnitName.pdb")"
        ('/sourceDependencies' + $DependencyRoot + '\')
    ) + $Stale

    # 🔴 The argument list is handed over in a response file. Thirty-five absolute paths plus the include
    #    path exceeds the 32 767 character command line on a deep checkout, and the failure that produces
    #    names neither the build nor the file it truncated.
    $ResponsePath = Join-Path $ObjectRoot "$UnitName.rsp"
    Write-ResponseFile $ResponsePath $Arguments

    Write-Building "$UnitName — translating $($Stale.Count) of $($Sources.Count)"

    $Diagnostics = & cl.exe '/nologo' "@$ResponsePath"
    $Refused     = $LASTEXITCODE -ne 0

    $Notable = $Diagnostics | Where-Object { $_ -match ': (warning|error) ' -or $_ -match 'Command line (warning|error)' -or $_ -match 'fatal error' }

    if ($Notable)
    {
        $Notable | ForEach-Object { Write-Host "    $_" }
    }

    if ($Refused)
    {
        if (-not $Notable -and $Diagnostics)
        {
            $Diagnostics | ForEach-Object { Write-Host "    $_" }
        }
        Write-Refused "$UnitName — cl.exe refused the translation batch"
        throw "$UnitName — cl.exe refused the translation batch"
    }

    # 📝 The records land beside the objects under the name the predicate looks for. Moved rather than
    #    written in place because /sourceDependencies names each record for its source stem (or filename) and
    #    the predicate reads "<stem>.deps.json" next to the object.
    # 🔴 A record that never arrived is REPORTED. This loop previously skipped a missing record in silence,
    #    which is exactly how a malformed flag went unnoticed: no record meant every object was judged stale,
    #    every build retranslated the whole engine, and the only symptom was a build that stayed slow. A
    #    correctness defect that presents as "no incremental build" must say so, because nothing else will.
    $Recorded = 0

    foreach ($Source in $Stale)
    {
        $Stem              = [System.IO.Path]::GetFileNameWithoutExtension($Source)
        $FileName          = [System.IO.Path]::GetFileName($Source)
        $WrittenCandidateA = Join-Path $DependencyRoot "$FileName.json"
        $WrittenCandidateB = Join-Path $DependencyRoot "$Stem.json"
        $Wanted            = Join-Path $ObjectRoot     "$Stem.deps.json"

        if (Test-Path $WrittenCandidateA)
        {
            Move-Item $WrittenCandidateA $Wanted -Force
            ++$Recorded
        }
        elseif (Test-Path $WrittenCandidateB)
        {
            Move-Item $WrittenCandidateB $Wanted -Force
            ++$Recorded
        }
    }

    if ($Recorded -lt $Stale.Count)
    {
        $Absent = $Stale.Count - $Recorded
        Write-Refused "$UnitName — $Absent of $($Stale.Count) translations wrote no dependency record"
        Write-Refused "$UnitName — the next build cannot be incremental until that is corrected"
    }

    return $Produced.ToArray()
}

#---
#                                         SHADER LOWERING
#---

# 📝 🔴 The second half of the dual-toolchain arrangement. Everything under Shared/ and every constant in
#    Contract/ToleranceContract.h is compiled once by cl.exe above and once by slangc here, from one source,
#    with SLATE_SHADER_TOOLCHAIN selecting the spellings. A shader authored but lowered by nothing is a
#    translation that has never been checked — all three atmosphere entry points carried a signature no
#    toolchain accepts for as long as this stage was absent.
function Resolve-ShaderCompiler([string] $VulkanRoot)
{
    $Compiler = Join-Path $VulkanRoot 'Bin\slangc.exe'

    if (-not (Test-Path $Compiler))
    {
        throw "the Vulkan SDK at $VulkanRoot carries no slangc.exe"
    }

    return $Compiler
}

# 📝 🔴 A .slang file carrying no [shader(...)] attribute is an include and not a translation. Lowering one
#    on its own asks slangc for an entry point it will not find, which reads as a broken shader rather than
#    as a file that was never meant to be lowered alone — AtmosphereUniform.slang and SkyRadiance.slang are
#    both of that kind and are compiled through the entry points that include them.
function Get-ShaderSource([hashtable] $UnitEntry)
{
    $UnitRoot = Join-Path $EngineRoot $UnitEntry.Name

    if (-not (Test-Path $UnitRoot))
    {
        return @()
    }

    return @(Get-ChildItem $UnitRoot -Recurse -Filter '*.slang' -File |
             Where-Object { (Get-Content $_.FullName -Raw) -match '\[\s*shader\s*\(' } |
             ForEach-Object { $_.FullName })
}

# 📝 An entry point reaches Contract/ and Shared/ through its includes, and a timestamp comparison against
#    the .slang alone would hold a stale SPIR-V after either was amended — which is the one staleness this
#    stage exists to catch, since those two folders are precisely what the shader toolchain and the host
#    toolchain share. The newest write across both is folded into every comparison below. It is coarser than
#    a real include scan and deliberately so: it can only ever lower more than necessary, never less.
# 📝 The shader path is guarded coarsely rather than by a per-entry-point include closure: the newest write
#    anywhere under Contract/ or Shared/ invalidates every lowered stream. That over-lowers — a change to one
#    shared header re-lowers shaders that never included it — and it is left that way deliberately, because
#    the error is in the safe direction and slangc's dependency output is not the same shape as cl.exe's.
#    The C++ path cannot afford the same coarseness: it would retranslate the whole engine on every edit.
# 🚧 Worth replacing with slangc's own depfile once the shader toolchain of `32` §4.1 stage B exists.
function Get-SeamTimestamp
{
    if ($null -ne $script:SeamTimestamp)
    {
        return $script:SeamTimestamp
    }

    $Newest = @('Contract', 'Shared') |
              ForEach-Object { Join-Path $EngineRoot $_ } |
              Where-Object   { Test-Path $_ } |
              ForEach-Object { Get-ChildItem $_ -Recurse -File } |
              Sort-Object LastWriteTimeUtc -Descending |
              Select-Object -First 1

    $script:SeamTimestamp = if ($null -eq $Newest) { [datetime]::MinValue } else { $Newest.LastWriteTimeUtc }

    return $script:SeamTimestamp
}

function Invoke-ShaderTranslation([hashtable] $UnitEntry, [string] $VulkanRoot)
{
    $UnitName = $UnitEntry.Name
    $Sources  = Get-ShaderSource $UnitEntry

    if ($Sources.Count -eq 0)
    {
        return
    }

    $Compiler   = Resolve-ShaderCompiler $VulkanRoot
    $SpirvRoot  = Join-Path $OutputRoot "Shader\$UnitName"
    $Seam       = Get-SeamTimestamp

    if (-not (Test-Path $SpirvRoot))
    {
        New-Item -ItemType Directory -Force -Path $SpirvRoot | Out-Null
    }

    Write-Building "$UnitName — $($Sources.Count) shader entry points"

    $Lowered = 0

    foreach ($Source in $Sources)
    {
        $Stem      = [System.IO.Path]::GetFileNameWithoutExtension($Source)
        $SpirvPath = Join-Path $SpirvRoot "$Stem.spv"

        $Newest = (Get-Item $Source).LastWriteTimeUtc
        if ($Seam -gt $Newest)
        {
            $Newest = $Seam
        }

        if (-not $Rebuild -and (Test-Path $SpirvPath) -and
            (Get-Item $SpirvPath).LastWriteTimeUtc -gt $Newest)
        {
            continue
        }

        # 📝 🔴 No -entry is passed and none may be. The entry points sit inside `namespace Slate`, and the
        #    name handed to -entry is looked up at global scope alone — every one of them is reported as an
        #    undefined identifier that way. The [shader("compute")] attribute is what names them instead,
        #    which is also what keeps the entry point's own name out of this script.
        $Arguments = @(
            $Source
            '-DSLATE_SHADER_TOOLCHAIN=1'
            "-I$EngineRoot"
            '-target'
            'spirv'
            '-profile'
            'glsl_450'
            '-o'
            $SpirvPath
        )

        # 📝 slangc writes its diagnostics to stderr, which is left unredirected for the same reason cl.exe's
        #    is above: redirecting a native executable's stderr in Windows PowerShell wraps each line in an
        #    ErrorRecord and turns a warning into a thrown failure. The lines reach the console on their own.
        & $Compiler @Arguments | ForEach-Object { Write-Host "    $_" }
        $Refused = $LASTEXITCODE -ne 0
        ++$Lowered

        if ($Refused)
        {
            Write-Refused "$UnitName — slangc refused $([System.IO.Path]::GetFileName($Source))"
            throw "$UnitName — slangc refused $([System.IO.Path]::GetFileName($Source))"
        }
    }

    if ($Lowered -eq 0)
    {
        Write-Skipped "$UnitName shaders unchanged"
        return
    }

    Write-Lowered "$SpirvRoot — $Lowered lowered"
}

#---
#                                           ARCHIVING
#---

function Invoke-Archive([hashtable] $UnitEntry, [string[]] $ObjectPath)
{
    $LibraryRoot = Join-Path $OutputRoot 'Library'

    if (-not (Test-Path $LibraryRoot))
    {
        New-Item -ItemType Directory -Force -Path $LibraryRoot | Out-Null
    }

    $LibraryPath = Join-Path $LibraryRoot "$($UnitEntry.Name).lib"
    $Diagnostics = & lib.exe /nologo "/OUT:$LibraryPath" @ObjectPath

    if ($LASTEXITCODE -ne 0)
    {
        $Diagnostics | ForEach-Object { Write-Host "    $_" }
        Write-Refused "$($UnitEntry.Name) — lib.exe refused the archive"
        throw "$($UnitEntry.Name) — lib.exe refused the archive"
    }

    Write-Produced $LibraryPath
}

#---
#                                          HOST LINKING
#---

function Invoke-HostLink([hashtable] $UnitEntry, [string[]] $ObjectPath, [string] $VulkanRoot, [string] $Subject)
{
    $BinaryRoot  = Join-Path $OutputRoot 'Binary'
    $LibraryRoot = Join-Path $OutputRoot 'Library'

    if (-not (Test-Path $BinaryRoot))
    {
        New-Item -ItemType Directory -Force -Path $BinaryRoot | Out-Null
    }

    # GLFW and ThorVG are built from submodule source the first time they are absent.
    #    The build scripts are invoked here - after the toolchain environment is imported -
    #    so cl.exe and the MSVC environment are already on PATH when they run.
    $GlfwLib = Join-Path $PackageRoot 'glfw\lib-vc2022\glfw3dll.lib'
    if (-not (Test-Path $GlfwLib) -and -not $script:GlfwBuilt)
    {
        Write-Building 'GLFW binaries absent - invoking BuildGLFW.ps1'
        & powershell -File (Join-Path $ScriptRoot 'BuildGLFW.ps1')
        if ($LASTEXITCODE -ne 0)
        {
            throw 'BuildGLFW.ps1 failed; GLFW binaries were not produced'
        }
        $script:GlfwBuilt = $true
    }

    $ThorVGLib = Join-Path $PackageRoot 'thorvg\lib\thorvg.lib'
    if (-not (Test-Path $ThorVGLib) -and -not $script:ThorVGBuilt)
    {
        Write-Building 'ThorVG library absent - invoking BuildThorVG.ps1'
        & powershell -File (Join-Path $ScriptRoot 'BuildThorVG.ps1')
        if ($LASTEXITCODE -ne 0)
        {
            throw 'BuildThorVG.ps1 failed; ThorVG static library was not produced'
        }
        $script:ThorVGBuilt = $true
    }

    # 📝 Requires is already declared most-dependent first, which is the order the linker resolves against.
    $Linked = @($UnitEntry.Requires | ForEach-Object { Join-Path $LibraryRoot "$_.lib" })

    $Linked += (Join-Path $VulkanRoot  'Lib\vulkan-1.lib')
    $Linked += (Join-Path $PackageRoot 'glfw\lib-vc2022\glfw3dll.lib')

    # 📝 ThorVG is reached only from SlateUI's GlyphDepot, but a static archive resolves at the host link,
    #    so it is named here alongside the other import libraries rather than at the unit that uses it.
    $Linked += (Join-Path $PackageRoot 'thorvg\lib\thorvg.lib')

    # 📝 🔴 gdi32.lib is named rather than inherited. `04`'s display-density read is the only reference into
    #    it, and the device context calls either side of that read resolve through the import libraries
    #    above — so omitting it fails at the one symbol and reads as a defect in the density read itself.
    $Linked += 'gdi32.lib'

    # 📝 The executable is named for its subject folder. `Engine/Application/PaintHost/` becomes PaintHost.exe with
    #    nothing in this script naming a host — adding one is a folder and one array entry.
    $ExecutablePath = Join-Path $BinaryRoot "$Subject.exe"

    $Arguments = @(
        '/nologo'
        '/DEBUG'
        '/SUBSYSTEM:CONSOLE'
        "/OUT:$ExecutablePath"
        "/PDB:$(Join-Path $BinaryRoot "$Subject.pdb")"
    ) + $ObjectPath + $Linked

    $Diagnostics = & link.exe @Arguments

    if ($LASTEXITCODE -ne 0)
    {
        $Diagnostics | ForEach-Object { Write-Host "    $_" }
        Write-Refused "link.exe refused $Subject"
        throw "link.exe refused $Subject"
    }

    # 📝 🔴 glfw3dll.lib is an import library. Without glfw3.dll beside the executable the process fails to
    #    start, and the operating system reports a missing dependency rather than anything a reader can act
    #    on. Copying it here is what keeps that failure out of the run.
    Copy-Item (Join-Path $PackageRoot 'glfw\lib-vc2022\glfw3.dll') $BinaryRoot -Force

    Write-Produced $ExecutablePath
}

#---
#                                          POST-CONSTRUCTION
#---

# 📝 🔴 Both steps run only after every unit has been archived or linked, and only in a whole-repository
#    run. A -Unit run has constructed a fraction of the engine, so transferring the whole of Engine/ from
#    it would publish sources the build never touched.
function Invoke-PostConstruction
{
    $Deferred = @(
        @{ Tag = 'symbol index'; Path = (Join-Path $ScriptRoot 'RunSymbolIndex.py');    Arguments = @('build') }
        @{ Tag = 'upload';       Path = (Join-Path $ScriptRoot 'RunUploadTransfer.py'); Arguments = @() }
    )

    # 📝 The indexer and the transfer both emit emoji. Windows PowerShell hands python a cp1252 console by
    #    default, on which those writes raise UnicodeEncodeError and the step dies for a reporting reason.
    $env:PYTHONIOENCODING = 'utf-8'

    foreach ($Step in $Deferred)
    {
        if (-not (Test-Path $Step.Path))
        {
            Write-Skipped "$($Step.Tag) — $([System.IO.Path]::GetFileName($Step.Path)) is absent"
            continue
        }

        Write-Building "$($Step.Tag) — $([System.IO.Path]::GetFileName($Step.Path))"

        Push-Location $RepositoryRoot
        try
        {
            & python $Step.Path @($Step.Arguments)
            $Refused = $LASTEXITCODE -ne 0
        }
        finally
        {
            Pop-Location
        }

        if ($Refused)
        {
            Write-Refused "$($Step.Tag) refused with exit code $LASTEXITCODE"
            throw "$($Step.Tag) refused"
        }
    }
}

#---
#                                             THE RUN
#---

Write-Host "Slate — $Configuration"

if ($Rebuild -and (Test-Path (Join-Path $OutputRoot 'Object')))
{
    Remove-Item (Join-Path $OutputRoot 'Object') -Recurse -Force
}

if ($Rebuild -and (Test-Path (Join-Path $OutputRoot 'Shader')))
{
    Remove-Item (Join-Path $OutputRoot 'Shader') -Recurse -Force
}

if (-not (Test-Path $OutputRoot))
{
    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
}

Import-ToolchainEnvironment

$VulkanRoot = Resolve-VulkanRoot
Write-Building "vulkan $VulkanRoot"

# 🔴 Slate's ImGui divergence is applied before any unit is translated, because SlateUI compiles the
#    vendored ImGui sources directly. Applied here rather than inside the SlateUI branch so that a
#    -Unit SlateUI build and a whole-tree build patch the submodule identically. Re-running is a
#    no-op: the script detects an applied patch and skips it.
& powershell -File (Join-Path $ScriptRoot 'ApplyImGuiPatches.ps1')

if ($LASTEXITCODE -ne 0)
{
    throw 'ApplyImGuiPatches.ps1 failed; the ImGui tab-shape patches were not applied'
}

# 🔴 The dependency partition is proven before anything is translated, because a forbidden include should
#    refuse at the start of a build rather than as an unresolved symbol at the end of one. The check is a
#    scan of the include lines against what each Module.toml declares; it costs a fraction of a second.
& powershell -File (Join-Path $ScriptRoot 'VerifyPartition.ps1')

if ($LASTEXITCODE -ne 0)
{
    throw 'VerifyPartition.ps1 refused; a unit reaches past what it declares'
}

Write-Host ''

$Selected = if ($Unit) { @($UnitOrder | Where-Object { $_.Name -eq $Unit }) } else { $UnitOrder }

if ($Selected.Count -eq 0)
{
    throw "no unit is named $Unit"
}

foreach ($UnitEntry in $Selected)
{
    if ($UnitEntry.Product -eq 'StaticLibrary')
    {
        $Produced = Invoke-Translation $UnitEntry $Configuration $VulkanRoot

        # 📝 The shaders are lowered after the unit's own translation units and before it is archived, so a seam
        #    the host toolchain has just refused is never lowered by the shader toolchain against a source the
        #    build has already rejected.
        Invoke-ShaderTranslation $UnitEntry $VulkanRoot

        Invoke-Archive $UnitEntry $Produced
    }
    else
    {
        # 📝 The shaders are lowered once for the unit, not once per subject — they belong to the unit's tree and
        #    lowering them per subject would lower each of them as many times as there are hosts.
        Invoke-ShaderTranslation $UnitEntry $VulkanRoot

        foreach ($Subject in $UnitEntry.Subject)
        {
            $Produced = Invoke-Translation $UnitEntry $Configuration $VulkanRoot $Subject
            Invoke-HostLink $UnitEntry $Produced $VulkanRoot $Subject
        }
    }
}

Write-Host ''

if ($Unit)
{
    Write-Skipped "post-construction — $Unit alone was constructed"
}
else
{
    Invoke-PostConstruction
}

Write-Host ''
Write-Produced "constructed into $OutputRoot"

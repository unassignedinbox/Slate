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
    [switch]                                   $Rebuild
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

# 📝 The order below IS the dependency DAG. A unit is compiled only after every unit it requires, and the
#    Requires list is what the linker is handed — reversed, since a static library only satisfies references
#    the linker has already seen.
$UnitOrder = @(
    @{ Name = 'SlateMath';     Product = 'StaticLibrary'; Requires = @() }
    @{ Name = 'SlateDocument'; Product = 'StaticLibrary'; Requires = @('SlateMath') }
    @{ Name = 'SlateVulkan';   Product = 'StaticLibrary'; Requires = @('SlateMath') }
    @{ Name = 'SlateCompute';  Product = 'StaticLibrary'; Requires = @('SlateVulkan', 'SlateDocument', 'SlateMath') }
    @{ Name = 'SlateUI';       Product = 'StaticLibrary'; Requires = @('SlateCompute', 'SlateVulkan', 'SlateDocument', 'SlateMath') }
    # 📝 🔴 Subject names one source folder that becomes its own link target. `32` §5's "separate editors or one
    #    Editor" is exactly this array: every folder here links an executable named for it, from one shared set of
    #    unit archives. A StaticLibrary unit ignores the field and archives its whole tree as before.
    @{ Name = 'Application';   Product = 'Executable';    Requires = @('SlateUI', 'SlateCompute', 'SlateVulkan', 'SlateDocument', 'SlateMath');
       Subject = @('ConsoleHost', 'PaintHost', 'EditorHost', 'InterfaceValidationHost') }
)

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

    if ($Selection -eq 'Debug')
    {
        # 📝 🔴 SLATE_DEBUG selects every debug path in the engine. _DEBUG is never defined — it selects the
        #    debug CRT, and /MD is declared for every configuration, so the two cannot both be honoured.
        return $Common + @('/Od', '/Zi', '/DSLATE_DEBUG=1')
    }

    return $Common + @('/O2', '/Zi', '/DNDEBUG')
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

    $Produced  = New-Object System.Collections.Generic.List[string]
    $Retranslated = 0

    foreach ($Source in $Sources)
    {
        $Stem           = [System.IO.Path]::GetFileNameWithoutExtension($Source)
        $ObjectPath     = Join-Path $ObjectRoot "$Stem.obj"
        $DependencyPath = Join-Path $ObjectRoot "$Stem.deps.json"
        $Produced.Add($ObjectPath)

        if (Test-ObjectFresh $ObjectPath $Source $DependencyPath)
        {
            continue
        }

        # 📝 /Fd names a per-unit database. Sharing one across units serialises the compiler on it, and
        #    concurrent invocations corrupt it outright.
        # 📝 /sourceDependencies writes the include closure beside the object, in the same invocation that
        #    produces it. Written per translation unit rather than per unit, because two translation units
        #    in one unit include different headers and a shared record would over-rebuild both.
        $Arguments = $Flags + $IncludePath + @(
            "/Fo$ObjectPath"
            "/Fd$(Join-Path $ObjectRoot "$UnitName.pdb")"
            "/sourceDependencies$DependencyPath"
            $Source
        )

        $Diagnostics = & cl.exe @Arguments
        $Refused     = $LASTEXITCODE -ne 0
        ++$Retranslated

        $Notable = $Diagnostics | Where-Object { $_ -match ': (warning|error) ' }

        if ($Notable)
        {
            $Notable | ForEach-Object { Write-Host "    $_" }
        }

        if ($Refused)
        {
            Write-Refused "$UnitName — cl.exe refused $([System.IO.Path]::GetFileName($Source))"
            throw "$UnitName — cl.exe refused $([System.IO.Path]::GetFileName($Source))"
        }
    }

    if ($Retranslated -eq 0)
    {
        Write-Skipped "$UnitName unchanged"
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

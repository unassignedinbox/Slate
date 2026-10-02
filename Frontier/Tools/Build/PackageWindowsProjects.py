#!/usr/bin/env python3
"""Stage the MSVC Release host and both projects, verifying DLL ABI and actual opening-scene import before upload."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import sys
import tomllib

Root = Path(__file__).resolve().parents[2]
Binary = Root / "Build/Output/Windows/Release/Binary"
Destination = Root.parent / "_AgentScratch/build/Frontier-Windows-Release"
Projects = (("Project-Zero", "ProjectZero"), ("Project-Drive", "ProjectDrive"))


class ProjectInterchange(ctypes.Structure):
    # Exact revision-2 C layout from Engine/ProjectInterchange/ProjectInterchange.h.
    _fields_ = [("StructureSize", ctypes.c_uint32), ("CodeInterchangeNumber", ctypes.c_uint32),
                ("InterfaceFingerprint", ctypes.c_uint64), ("ConstructProject", ctypes.c_void_p),
                ("AdvanceProject", ctypes.c_void_p), ("RetireProject", ctypes.c_void_p)]


class ProjectRefusal(ctypes.Structure):
    _fields_ = [("Number", ctypes.c_uint32), ("Explanation", ctypes.c_char * 1024)]


def VerifyImage(Location: Path, Dll: bool) -> None:
    Content = Location.read_bytes()
    if Content[:2] != b"MZ":
        raise RuntimeError(f"Not a Windows binary: {Location}")
    Offset = struct.unpack_from("<I", Content, 0x3C)[0]
    if Content[Offset:Offset + 4] != b"PE\0\0":
        raise RuntimeError(f"Missing PE signature: {Location}")
    Machine = struct.unpack_from("<H", Content, Offset + 4)[0]
    Characteristics = struct.unpack_from("<H", Content, Offset + 22)[0]
    if Machine != 0x8664 or bool(Characteristics & 0x2000) != Dll:
        raise RuntimeError(f"Expected an x64 {'DLL' if Dll else 'executable'}: {Location}")


def VerifyInterchange(Location: Path, Specification: dict) -> None:
    Image = ctypes.CDLL(str(Location))
    Entry = Image.ConstructProjectInterchange
    Entry.argtypes = [ctypes.c_uint32, ctypes.c_uint64,
                      ctypes.POINTER(ProjectInterchange), ctypes.POINTER(ProjectRefusal)]
    Entry.restype = ctypes.c_uint32
    Delivered = ProjectInterchange()
    Refusal = ProjectRefusal()
    Revision = Specification["CodeInterchangeNumber"]
    Fingerprint = Specification["InterfaceFingerprint"]
    if Revision != 2:
        raise RuntimeError("The package verifier requires the revision-2 C layout")
    if Entry(Revision, Fingerprint, ctypes.byref(Delivered), ctypes.byref(Refusal)) != 1:
        raise RuntimeError(f"{Location.name} rejected its specification: {Refusal.Explanation!r}")
    if (Delivered.StructureSize != ctypes.sizeof(ProjectInterchange)
            or Delivered.CodeInterchangeNumber != Revision
            or Delivered.InterfaceFingerprint != Fingerprint
            or not all((Delivered.ConstructProject, Delivered.AdvanceProject, Delivered.RetireProject))):
        raise RuntimeError(f"Invalid code interchange from {Location.name}")
    for RequestedRevision, RequestedFingerprint in ((Revision - 1, Fingerprint), (Revision, Fingerprint ^ 1)):
        Refusal = ProjectRefusal()
        if (Entry(RequestedRevision, RequestedFingerprint, ctypes.byref(Delivered), ctypes.byref(Refusal)) != 0
                or Refusal.Number == 0):
            raise RuntimeError(f"{Location.name} accepted an incompatible code interchange")
    print(f"PASS {Location.name}: x64 DLL loaded; revision and fingerprint accepted; incompatible requests refused")


def VerifyScene(SpecificationPath: Path, SceneOverride: Path | None = None, ExpectedCode: int = 0) -> None:
    Command = [str(Destination / "Frontier.exe"), str(SpecificationPath), "--verify-opening-scene"]
    if SceneOverride is not None:
        Command += ["--scene", str(SceneOverride)]
    Completed = subprocess.run(Command, cwd=Destination, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               encoding="utf-8", errors="replace", timeout=180)
    print(Completed.stdout)
    if Completed.returncode != ExpectedCode:
        raise RuntimeError(f"Scene verification returned {Completed.returncode}, expected {ExpectedCode}: {Command}")
    if ExpectedCode == 0 and "PASS opening scene import:" not in Completed.stdout:
        raise RuntimeError("Host did not confirm the opening-scene import")


def Main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.platform != "win32" or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError("Run after the Release build using x64 Python on Windows")
    VerifyImage(Binary / "Frontier.exe", False)
    VerifyImage(Binary / "glfw3.dll", True)
    Shaders = sorted((Binary / "Engine/Shaders").glob("*.spv"))
    if not Shaders:
        raise RuntimeError("No compiled Vulkan shaders found")
    for Name in ("DistanceFieldConstruct", "DistanceFieldRadiance", "DistanceFieldGIResolve", "DistanceFieldGIResolveFixed"):
        if not (Binary / f"Engine/Shaders/{Name}.spv").is_file():
            raise RuntimeError(f"Missing compiled {Name} shader")
    for Shader in Shaders:
        if Shader.read_bytes()[:4] != b"\x03\x02\x23\x07":
            raise RuntimeError(f"Invalid SPIR-V signature: {Shader}")

    if Destination.exists():
        shutil.rmtree(Destination)
    shutil.copytree(Binary, Destination, ignore=shutil.ignore_patterns("*.pdb", "*.ilk", "*.lib", "*.exp"))
    shutil.copytree(Root / "EngineContent", Destination / "EngineContent", dirs_exist_ok=True)
    PackagedProjects = []
    for Folder, Name in Projects:
        Source = Root / "Projects" / Folder
        SpecificationPath = Source / f"{Name}.frontier"
        Specification = tomllib.loads(SpecificationPath.read_text(encoding="utf-8"))["Project"]
        if Specification["CodeImage"] != f"Build/{Name}.dll" or Specification["ContentLocation"] != "Content":
            raise RuntimeError(f"Unexpected project layout: {SpecificationPath}")
        Target = Destination / "Projects" / Folder
        (Target / "Build").mkdir(parents=True)
        shutil.copy2(SpecificationPath, Target)
        shutil.copytree(Source / "Content", Target / "Content")
        Library = Target / Specification["CodeImage"]
        shutil.copy2(Source / Specification["CodeImage"], Library)
        VerifyImage(Library, True)
        VerifyInterchange(Library, Specification)

        OpeningScene = Target / Specification["OpeningScene"]
        Preparation = ""
        if Name == "ProjectDrive":
            Author = Target / "Build/DriveContentHost.exe"
            shutil.copy2(Source / "Build/DriveContentHost.exe", Author)
            VerifyImage(Author, False)
            # Export only missing content; malformed existing content must fail, not be silently replaced.
            subprocess.run([str(Author), "--ensure", str(OpeningScene)], check=True, timeout=180)
            Preparation = (
                f'if exist "%~dp0Projects\\{Folder}\\Content\\Scenes\\DriveCourse.gltf" goto LaunchFrontier\n'
                f'"%~dp0Projects\\{Folder}\\Build\\DriveContentHost.exe" --ensure '
                f'"%~dp0Projects\\{Folder}\\Content\\Scenes\\DriveCourse.gltf"\n'
                'if errorlevel 1 goto Finished\n:LaunchFrontier\n')
        VerifyScene(Target / SpecificationPath.name)
        if not OpeningScene.is_file() or OpeningScene.stat().st_size == 0:
            raise RuntimeError(f"Package has no opening scene: {OpeningScene}")
        # Exercise the exact failure this gate missed previously, plus a present but corrupt glTF.
        with tempfile.TemporaryDirectory(prefix="Scene verification ", dir=Destination.parent) as Scratch:
            Missing = Path(Scratch) / "missing.gltf"
            Corrupt = Path(Scratch) / "corrupt.gltf"
            Corrupt.write_text("this is not glTF", encoding="ascii")
            VerifyScene(Target / SpecificationPath.name, Missing, ExpectedCode=1)
            VerifyScene(Target / SpecificationPath.name, Corrupt, ExpectedCode=1)
        print(f"PASS {Name}: packaged scene imports; missing and corrupt scenes are refused without a GPU")
        Launcher = Destination / f"Start-{Name}.cmd"
        Launcher.write_text(
            '@echo off\nsetlocal\ncd /d "%~dp0"\n' + Preparation +
            f'"%~dp0Frontier.exe" "%~dp0Projects\\{Folder}\\{Name}.frontier" %*\n'
            ':Finished\nset "FrontierExitCode=%ERRORLEVEL%"\nif not "%FrontierExitCode%"=="0" pause\n'
            'exit /b %FrontierExitCode%\n', encoding="ascii", newline="\r\n")
        PackagedProjects.append({"name": Name, "launcher": Launcher.name,
                                 "specification": SpecificationPath.relative_to(Root).as_posix(),
                                 "dllAbiVerified": True, "openingSceneImported": True,
                                 "openingScene": OpeningScene.relative_to(Destination).as_posix(),
                                 "missingAndCorruptSceneRefusalVerified": True})

    Manifest = {"sourceCommit": os.environ.get("GITHUB_SHA", "local"),
                "configuration": "Release", "architecture": "x64", "compiler": "MSVC",
                "projects": PackagedProjects, "compiledShaderCount": len(Shaders),
                "gpuRuntimeVerified": False,
                "sdfGi": {"importedCommit": "46476f3e5632256297de795ef1a6ab247f92f5f0",
                          "shaderCompiled": True, "runtimeEnabled": True,
                          "transport": "Three camera-snapped distance volumes, GPU Jacobi radiance cache, exact mesh secondary rays",
                          "activation": "Only after all scene resources and shader pipelines are ready",
                          "fallback": "Existing Surfel GI, or existing compute fallback if Surfel is unavailable"},
                "requirements": ["Windows x64", "Microsoft Visual C++ x64 runtime",
                                 "Compatible Vulkan GPU and its installed driver"],
                "sha256": {Location.relative_to(Destination).as_posix(): hashlib.sha256(Location.read_bytes()).hexdigest()
                           for Location in sorted(Destination.rglob("*")) if Location.is_file()}}
    (Destination / "BuildManifest.json").write_text(json.dumps(Manifest, indent=2) + "\n", encoding="utf-8")
    print(f"PASS package: Frontier.exe, both project DLLs, specifications, content and {len(Shaders)} shaders")
    print(f"Package: {Destination}")


if __name__ == "__main__":
    try:
        Main()
    except (OSError, RuntimeError, ValueError, AttributeError, struct.error, subprocess.SubprocessError) as Error:
        print(f"Package failed: {Error}", file=sys.stderr)
        raise SystemExit(1)

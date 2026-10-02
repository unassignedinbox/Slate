#!/usr/bin/env python3
"""Stage the MSVC Release host and both projects, verifying their DLL ABI before upload."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
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


def Main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.platform != "win32" or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError("Run after the Release build using x64 Python on Windows")
    VerifyImage(Binary / "Frontier.exe", False)
    VerifyImage(Binary / "glfw3.dll", True)
    Shaders = sorted((Binary / "Engine/Shaders").glob("*.spv"))
    if not Shaders:
        raise RuntimeError("No compiled Vulkan shaders found")
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
        Launcher = Destination / f"Start-{Name}.cmd"
        Launcher.write_text(
            '@echo off\nsetlocal\ncd /d "%~dp0"\n'
            f'"%~dp0Frontier.exe" "%~dp0Projects\\{Folder}\\{Name}.frontier" %*\n'
            'set "FrontierExitCode=%ERRORLEVEL%"\nif not "%FrontierExitCode%"=="0" pause\n'
            'exit /b %FrontierExitCode%\n', encoding="ascii", newline="\r\n")
        PackagedProjects.append({"name": Name, "launcher": Launcher.name,
                                 "specification": SpecificationPath.relative_to(Root).as_posix(),
                                 "dllAbiVerified": True})

    Manifest = {"sourceCommit": os.environ.get("GITHUB_SHA", "local"),
                "configuration": "Release", "architecture": "x64", "compiler": "MSVC",
                "projects": PackagedProjects, "compiledShaderCount": len(Shaders),
                "gpuRuntimeVerified": False,
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
    except (OSError, RuntimeError, ValueError, AttributeError, struct.error) as Error:
        print(f"Package failed: {Error}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Compile and execute the production SDF Vulkan pipeline with validation; never substitute a hand-written shader approximation."""
from pathlib import Path
import os
import struct
import shutil
import time
import subprocess
import sys
import zlib

Root = Path(__file__).resolve().parents[2]
Engine = Root / "Frontier"
Output = Root / "_AgentScratch/build/sdf-execution"
Shaders = Output / "Shaders"
Images = Output / "Images"
# Use the CPU Vulkan implementation, not a rewritten approximation of the shader equations.
CpuDrivers = sorted(Path("/usr/share/vulkan/icd.d").glob("*lvp*.json"))
if CpuDrivers:
    os.environ["VK_ICD_FILENAMES"] = str(CpuDrivers[0])
# Mesa's documented nopt switch only disables expensive LLVM optimization passes; the same
# production SPIR-V still executes, with all texture paths and Vulkan validation enabled.
os.environ.setdefault("GALLIVM_PERF", "nopt")
Shaders.mkdir(parents=True, exist_ok=True)
Images.mkdir(parents=True, exist_ok=True)
for Name in ("DistanceFieldConstruct", "DistanceFieldCapture", "DistanceFieldCaptureFixed", "DistanceFieldRadiance", "DistanceFieldGIResolve", "DistanceFieldGIResolveFixed"):
    subprocess.run(["glslc", "--target-env=vulkan1.2", "-fshader-stage=compute", "-I" + str(Engine / "Engine/Shaders"),
                    "-I" + str(Engine / "Engine"), str(Engine / f"Engine/Shaders/{Name}.slang"),
                    "-o", str(Shaders / f"{Name}.spv")], check=True)
    subprocess.run(["spirv-val", "--target-env", "vulkan1.2", str(Shaders / f"{Name}.spv")], check=True)
# Keep the SDK-free native editor declaration route working alongside the real Vulkan execution route.
subprocess.run([os.environ.get("CXX", "g++"), "-std=c++20", "-fsyntax-only", "-DFRONTIER_DEVELOPMENT",
                "-I" + str(Engine), "-I" + str(Engine / "Engine"),
                "-I" + str(Engine / "Exhibits/Workbench/Editor/Counterparts"),
                str(Engine / "Engine/Host/RayTracingSolver.cpp")], check=True)
Sources = [Root / "VisualProof/DistanceFieldGI/DistanceFieldExecution.cpp",
           Engine / "Engine/DeviceExchange/DistanceFieldGIStage.cpp",
           Engine / "Engine/GeometricRaster/DistanceFieldStructure.cpp"]
subprocess.run([os.environ.get("CXX", "g++"), "-std=c++20", "-O2", "-g", "-Wall", "-Wextra", "-Wno-missing-field-initializers",
                "-I" + str(Engine), *map(str, Sources), "-lvulkan", "-o", str(Output / "DistanceFieldExecution")], check=True)
def EncodeReadbacks(Directory):
    for Source in Directory.glob("*.ppm"):
        Magic, Extent, Maximum, Pixels = Source.read_bytes().split(b"\n", 3)
        Width, Height = map(int, Extent.split())
        if Magic != b"P6" or Maximum != b"255" or len(Pixels) != Width * Height * 3:
            raise SystemExit(f"Invalid Vulkan readback image: {Source}")
        def Chunk(Kind, Content):
            return struct.pack(">I", len(Content)) + Kind + Content + struct.pack(">I", zlib.crc32(Kind + Content) & 0xFFFFFFFF)
        Raster = b"".join(b"\0" + Pixels[Row*Width*3:(Row+1)*Width*3] for Row in range(Height))
        Image = b"\x89PNG\r\n\x1a\n" + Chunk(b"IHDR", struct.pack(">IIBBBBB", Width, Height, 8, 2, 0, 0, 0))
        Image += Chunk(b"IDAT", zlib.compress(Raster)) + Chunk(b"IEND", b"")
        Source.with_suffix(".png").write_bytes(Image)

BaselineCommit = "a42147b1148ffa13f08d4d11f42b665a8afb1a0d"
subprocess.run(["git", "fetch", "--depth=1", "origin", BaselineCommit], cwd=Root, check=True)
BaselineSources = Output / "BaselineSources"
shutil.copytree(Engine / "Engine/Shaders", BaselineSources, dirs_exist_ok=True)
for Name in ("DistanceFieldTransport.slang", "DistanceFieldGIResolveBody.slang", "DistanceFieldRadiance.slang"):
    Content = subprocess.check_output(["git", "show", BaselineCommit + ":Frontier/Engine/Shaders/" + Name], cwd=Root)
    (BaselineSources / Name).write_bytes(Content)
BaselineShaders = Output / "BaselineShaders"
BaselineShaders.mkdir(exist_ok=True)
for Name in ("DistanceFieldConstruct", "DistanceFieldCapture", "DistanceFieldCaptureFixed", "DistanceFieldRadiance", "DistanceFieldGIResolve", "DistanceFieldGIResolveFixed"):
    subprocess.run(["glslc", "--target-env=vulkan1.2", "-fshader-stage=compute", "-I"+str(BaselineSources),
                    "-I"+str(Engine / "Engine"), str(BaselineSources / (Name+".slang")),
                    "-o", str(BaselineShaders / (Name+".spv"))], check=True)
    subprocess.run(["spirv-val", "--target-env", "vulkan1.2", str(BaselineShaders / (Name+".spv"))], check=True)
Failures = []
for Phase, Programs in (("ArtifactBaseline", BaselineShaders), ("ArtifactAfter", Shaders), ("Regression", Shaders)):
    Directory = Images / Phase
    Directory.mkdir(exist_ok=True)
    Environment = dict(os.environ)
    if Phase == "ArtifactAfter": Environment["SDF_REQUIRE_ARTIFACTS"] = "1"
    Command = [str(Output / "DistanceFieldExecution"), str(Programs), str(Directory)]
    if Phase != "Regression": Command += ["--artifacts"]
    Started = time.monotonic()
    try:
        Completed = subprocess.run(Command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, env=Environment, timeout=700)
        Transcript = Completed.stdout
        Code = Completed.returncode
    except subprocess.TimeoutExpired as Failure:
        Transcript = Failure.stdout or b""
        if isinstance(Transcript, bytes): Transcript = Transcript.decode("utf-8", errors="replace")
        Transcript += "\nFAIL CPU shader execution timed out\n"
        Code = 124
    Transcript += f"\nExecution seconds: {time.monotonic()-Started:.2f}\n"
    (Output / (Phase+".log")).write_text(Transcript, encoding="utf-8")
    print(Phase+"\n"+Transcript, flush=True)
    EncodeReadbacks(Directory)
    if Code:
        Failures.append(Phase)
        for Line in Transcript.splitlines():
            if "FAIL" in Line or "VUID" in Line:
                print("::error::"+Line.replace("%","%25").replace("\r","%0D"), flush=True)
if Failures: raise SystemExit("Failed CPU shader passes: "+", ".join(Failures))
print("PASS production shaders executed on CPU: paired artifacts and complete SDF regression")

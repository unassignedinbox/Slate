#!/usr/bin/env python3
"""Compile and execute the production SDF Vulkan pipeline with validation; never substitute a CPU renderer."""
from pathlib import Path
import os
import struct
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
try:
    Completed = subprocess.run([str(Output / "DistanceFieldExecution"), str(Shaders), str(Images)],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=600)
except subprocess.TimeoutExpired as Failure:
    Captured = Failure.stdout or b""
    if isinstance(Captured, bytes):
        Captured = Captured.decode("utf-8", errors="replace")
    (Output / "Execution.log").write_text(Captured, encoding="utf-8")
    print(Captured, flush=True)
    print("::error::Production Vulkan execution exceeded 600 seconds; partial execution log retained", flush=True)
    raise
(Output / "Execution.log").write_text(Completed.stdout, encoding="utf-8")
print(Completed.stdout)
if Completed.returncode:
    if Completed.returncode < 0:
        Crash = subprocess.run(["gdb", "--batch", "-ex", "run", "-ex", "bt 20", "--args",
                                str(Output / "DistanceFieldExecution"), str(Shaders), str(Images)],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
        (Output / "Crash.log").write_text(Crash.stdout, encoding="utf-8")
        print(Crash.stdout)
    # Emit the actual driver/validation refusal in Actions annotations, even when artifact downloads are unavailable.
    for Line in Completed.stdout.splitlines():
        if "FAIL" in Line or "Validation Error" in Line or "VUID" in Line:
            print("::error::" + Line.replace("%", "%25").replace("\r", "%0D"))
    raise SystemExit(Completed.returncode)
for Source in Images.glob("*.ppm"):
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
print("PASS: production SPIR-V validated and executed; pixel proofs saved (device identity recorded in Execution.log)")

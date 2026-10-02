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
Shaders.mkdir(parents=True, exist_ok=True)
Images.mkdir(parents=True, exist_ok=True)
for Name in ("DistanceFieldConstruct", "DistanceFieldRadiance", "DistanceFieldGIResolve", "DistanceFieldGIResolveFixed"):
    subprocess.run(["glslc", "--target-env=vulkan1.2", "-fshader-stage=compute", "-I" + str(Engine / "Engine/Shaders"),
                    "-I" + str(Engine / "Engine"), str(Engine / f"Engine/Shaders/{Name}.slang"),
                    "-o", str(Shaders / f"{Name}.spv")], check=True)
    subprocess.run(["spirv-val", "--target-env", "vulkan1.2", str(Shaders / f"{Name}.spv")], check=True)
Sources = [Root / "VisualProof/DistanceFieldGI/DistanceFieldExecution.cpp",
           Engine / "Engine/DeviceExchange/DistanceFieldGIStage.cpp",
           Engine / "Engine/GeometricRaster/DistanceFieldStructure.cpp"]
subprocess.run([os.environ.get("CXX", "g++"), "-std=c++20", "-O2", "-Wall", "-Wextra", "-Wno-missing-field-initializers",
                "-I" + str(Engine), *map(str, Sources), "-lvulkan", "-o", str(Output / "DistanceFieldExecution")], check=True)
Completed = subprocess.run([str(Output / "DistanceFieldExecution"), str(Shaders), str(Images)],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=240)
(Output / "Execution.log").write_text(Completed.stdout, encoding="utf-8")
print(Completed.stdout)
if Completed.returncode:
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

#!/usr/bin/env python3
"""Retrieve executed CI pixels on an Actions runner (the local sandbox cannot reach Azure artifact storage)."""
from pathlib import Path
import json
import shutil
import struct
import subprocess
import sys
import zlib

Root = Path(__file__).resolve().parents[2]
Scratch = Root / "_AgentScratch/build/execution-export"
Scratch.mkdir(parents=True, exist_ok=True)
BrowserRun, SdfRun = sys.argv[1:3]
Provenance = {}
for Kind, Run, Prefix in (("Browser", BrowserRun, "project-opening"), ("SDF", SdfRun, "sdf-vulkan-execution")):
    Commit = json.loads(subprocess.check_output(["gh", "run", "view", Run, "--json", "headSha"], text=True))["headSha"]
    subprocess.run(["gh", "run", "download", Run, "-n", Prefix + "-" + Commit, "-D", str(Scratch / Kind)], check=True)
    Provenance[Kind] = {"commit": Commit, "run": "https://github.com/unassignedinbox/Slate/actions/runs/" + Run}
Native = Scratch / "Browser/ProjectBrowserWindows.png"
assert Native.is_file(), "A real DX11 readback, not the shared CPU UI proof, is required"
shutil.copyfile(Native, Root / "VisualProof/ProjectOpening/ProjectBrowserWindows.png")
Log = (Scratch / "SDF/Execution.log").read_text(encoding="utf-8", errors="replace")
Verified = "zero errors" in Log and "PASS spatial atlas" in Log and "PASS artifact checks" in Log
assert Verified or "FAIL" in Log, "Incomplete run: retain its artifact, but do not publish it as verified pixels"
Target = Root / ("VisualProof/DistanceFieldGI/Executed" if Verified else "VisualProof/DistanceFieldGI/ArtifactFailure")
Target.mkdir(parents=True, exist_ok=True)
Images = list((Scratch / "SDF/Images").glob("*.ppm"))
assert len(Images) >= (20 if Verified else 1), "No suitable execution pixels were produced"
for Previous in Target.glob("*.png"):
    Previous.unlink()
Frames = {}
for Source in Images:
    Magic, Extent, Maximum, Pixels = Source.read_bytes().split(b"\n", 3)
    Width, Height = map(int, Extent.split())
    assert Magic == b"P6" and Maximum == b"255" and len(Pixels) == Width * Height * 3
    Zoom = max(1, 512 // Width)
    Rows = []
    for Y in range(Height):
        Row = b"".join(Pixels[(Y*Width+X)*3:(Y*Width+X+1)*3] * Zoom for X in range(Width))
        Rows.extend([b"\0" + Row] * Zoom)
    def Chunk(Kind, Data):
        return struct.pack(">I", len(Data)) + Kind + Data + struct.pack(">I", zlib.crc32(Kind + Data) & 0xFFFFFFFF)
    Png = b"\x89PNG\r\n\x1a\n" + Chunk(b"IHDR", struct.pack(">IIBBBBB", Width*Zoom, Height*Zoom, 8, 2, 0, 0, 0))
    Compressed = zlib.compress(b"".join(Rows), 9)
    Png += Chunk(b"IDAT", Compressed) + Chunk(b"IEND", b"")
    if Source.stem.startswith("static-frame-"):
        Frames[int(Source.stem.rsplit("-", 1)[1])] = (Width*Zoom, Height*Zoom, Compressed)
    (Target / (Source.stem + ".png")).write_bytes(Png)
if len(Frames) == 16:
    Width, Height, _ = Frames[0]
    Animation = b"\x89PNG\r\n\x1a\n" + Chunk(b"IHDR", struct.pack(">IIBBBBB", Width, Height, 8, 2, 0, 0, 0))
    Animation += Chunk(b"acTL", struct.pack(">II", len(Frames), 0))
    Sequence = 0
    for Index in sorted(Frames):
        FrameWidth, FrameHeight, Compressed = Frames[Index]
        assert (FrameWidth, FrameHeight) == (Width, Height)
        Animation += Chunk(b"fcTL", struct.pack(">IIIIIHHBB", Sequence, Width, Height, 0, 0, 1, 8, 0, 0))
        Sequence += 1
        if Index == 0:
            Animation += Chunk(b"IDAT", Compressed)
        else:
            Animation += Chunk(b"fdAT", struct.pack(">I", Sequence) + Compressed)
            Sequence += 1
    (Target / "static-sequence.png").write_bytes(Animation + Chunk(b"IEND", b""))
Provenance["SDF"]["artifact_checks_passed"] = Verified
Provenance["SDF"]["display"] = "Nearest-neighbour enlargement of exact production Vulkan readback pixels; no reconstructed renderer or image generation. The top-left background sentinel is intentionally black."
Provenance["SDF"]["execution"] = [Line for Line in Log.splitlines() if "device" in Line.lower() or Line.startswith(("PASS", "FAIL", "ARTIFACT", "CPU JIT"))]
(Target / "Provenance.json").write_text(json.dumps(Provenance, indent=2) + "\n")
print("Retained actual DX11 card and", len(Images), "production SDF readbacks")

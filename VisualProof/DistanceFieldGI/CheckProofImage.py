#!/usr/bin/env python3
"""Check the CPU proof's PNG header, chunk CRCs, and decoded raster byte count."""
import struct
import sys
import zlib
from pathlib import Path

Image = Path(sys.argv[1]).read_bytes()
if Image[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit("Invalid proof PNG signature")
Offset = 8
Compressed = bytearray()
Width = Height = 0
while Offset < len(Image):
    Length = struct.unpack_from(">I", Image, Offset)[0]
    Kind = Image[Offset + 4:Offset + 8]
    Content = Image[Offset + 8:Offset + 8 + Length]
    Checksum = struct.unpack_from(">I", Image, Offset + 8 + Length)[0]
    if zlib.crc32(Kind + Content) & 0xFFFFFFFF != Checksum:
        raise SystemExit(f"Invalid proof PNG checksum: {Kind!r}")
    if Kind == b"IHDR":
        Width, Height, Depth, Colour = struct.unpack_from(">IIBB", Content)
        if (Width, Height, Depth, Colour) != (1920, 720, 8, 2):
            raise SystemExit(f"Invalid proof PNG raster header: {Width}x{Height}, {Depth}, {Colour}")
    if Kind == b"IDAT":
        Compressed.extend(Content)
    Offset += Length + 12
if len(zlib.decompress(Compressed)) != (Width * 3 + 1) * Height:
    raise SystemExit("Proof PNG header disagrees with the actual pixel data")
print(f"PASS CPU proof image: {Width}x{Height}, valid chunk checksums and decoded raster size")

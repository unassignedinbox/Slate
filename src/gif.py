#!/usr/bin/env python3
"""Render animation clips from the GLB straight to animated GIFs.

Dependency-free: includes a 6x6x6-cube quantiser and an LZW GIF encoder, so
the animations can be watched without a browser or a server.

  python3 gif.py Walk ../docs/walk.gif --fps 15 --view hero
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render import load_glb, render
from sheets import VIEWS, GLB


# ------------------------------------------------------------ quantisation
LEVELS = [0, 51, 102, 153, 204, 255]


def palette():
    pal = bytearray()
    for r in LEVELS:
        for g in LEVELS:
            for b in LEVELS:
                pal += bytes((r, g, b))
    for i in range(40):                       # extra greys for smooth chitin
        v = int(255 * i / 39.0)
        pal += bytes((v, v, v))
    return bytes(pal)


def quantise(px, n):
    out = bytearray(n)
    for i in range(n):
        r, g, b = px[i * 3], px[i * 3 + 1], px[i * 3 + 2]
        if abs(r - g) < 10 and abs(g - b) < 10:            # grey ramp
            out[i] = 216 + min(39, (r * 39 + 127) // 255)
        else:
            out[i] = (((r + 25) // 51) * 36 + ((g + 25) // 51) * 6 +
                      ((b + 25) // 51))
    return bytes(out)


# -------------------------------------------------------------- LZW / GIF
def lzw(data, min_code=8):
    clear, end = 1 << min_code, (1 << min_code) + 1
    size = min_code + 1
    table = {bytes([i]): i for i in range(1 << min_code)}
    nxt = end + 1
    out, cur, nbits = bytearray(), 0, 0

    def put(code):
        nonlocal cur, nbits
        cur |= code << nbits
        nbits += size
        while nbits >= 8:
            out.append(cur & 0xFF)
            cur >>= 8
            nbits -= 8

    put(clear)
    w = b""
    for ch in data:
        c = bytes([ch])
        if w + c in table:
            w += c
        else:
            put(table[w])
            table[w + c] = nxt
            nxt += 1
            if nxt > (1 << size) and size < 12:
                size += 1
            elif nxt > 4095:
                put(clear)
                table = {bytes([i]): i for i in range(1 << min_code)}
                nxt, size = end + 1, min_code + 1
            w = c
    if w:
        put(table[w])
    put(end)
    if nbits:
        out.append(cur & 0xFF)
    return bytes(out)


def write_gif(path, frames, W, H, delay_cs):
    pal = palette()
    pal = pal + b"\x00" * (768 - len(pal))
    f = open(path, "wb")
    f.write(b"GIF89a")
    f.write(struct.pack("<HHBBB", W, H, 0xF7, 0, 0))
    f.write(pal)
    f.write(b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00")   # loop forever
    for fr in frames:
        f.write(b"\x21\xF9\x04\x04" + struct.pack("<H", delay_cs) +
                b"\x00\x00")
        f.write(b"\x2C" + struct.pack("<HHHH", 0, 0, W, H) + b"\x00")
        f.write(b"\x08")
        data = lzw(fr, 8)
        for i in range(0, len(data), 255):
            blk = data[i:i + 255]
            f.write(bytes([len(blk)]) + blk)
        f.write(b"\x00")
    f.write(b"\x3B")
    f.close()
    return os.path.getsize(path)


def make(clip, out, fps=15, view="hero", W=460, H=320, cycles=1, fov=32.0):
    js, bn = load_glb(GLB)
    dur = next(a for a in js["animations"] if a["name"] == clip)
    times = [s["input"] for s in dur["samplers"]]
    from render import read_acc
    length = max(read_acc(js, bn, t)[-1] for t in times)
    n = max(2, int(round(length * fps)))
    eye, tgt, up = VIEWS[view]
    frames = []
    for i in range(n):
        t = length * i / float(n)
        px, w, h = render(js, bn, W, H, clip, t, eye=eye, target=tgt, up=up,
                          fov=fov)
        frames.append(quantise(px, w * h))
        sys.stdout.write("\r  %s %d/%d" % (clip, i + 1, n))
        sys.stdout.flush()
    frames = frames * cycles
    size = write_gif(out, frames, W, H, int(round(100.0 / fps)))
    print("\r  %s -> %s  (%d frames, %.2f s loop, %.1f KB)"
          % (clip, os.path.basename(out), n, length, size / 1024.0))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("clip"); ap.add_argument("out")
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--view", default="hero")
    ap.add_argument("--w", type=int, default=460)
    ap.add_argument("--h", type=int, default=320)
    ap.add_argument("--cycles", type=int, default=1)
    ap.add_argument("--fov", type=float, default=32.0)
    a = ap.parse_args()
    make(a.clip, a.out, a.fps, a.view, a.w, a.h, a.cycles, a.fov)

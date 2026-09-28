#!/usr/bin/env python3
"""360-degree turntable GIF of the rest pose."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render import load_glb, render
from sheets import GLB
from gif import quantise, write_gif

N, W, H = 40, 460, 320
R, EY = 0.315, 0.135
TGT = (-0.015, 0.028, 0.0)
js, bn = load_glb(GLB)
frames = []
for i in range(N):
    a = 2 * math.pi * i / N
    eye = (TGT[0] + R * math.cos(a), EY, TGT[2] + R * math.sin(a))
    px, w, h = render(js, bn, W, H, "Idle", 3.0 * i / N, eye=eye,
                      target=TGT, up=(0, 1, 0), fov=30.0)
    frames.append(quantise(px, w * h))
    sys.stdout.write("\r  turntable %d/%d" % (i + 1, N)); sys.stdout.flush()
out = os.path.join(os.path.dirname(GLB), "..", "docs", "turntable.gif")
out = os.path.normpath(out)
print("\r  -> %s (%.1f KB)" % (out, write_gif(out, frames, W, H, 7) / 1024.0))

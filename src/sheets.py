#!/usr/bin/env python3
"""Render documentation contact sheets from the built GLB."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render import load_glb, render, write_png

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.normpath(os.path.join(HERE, "..", "model", "scorpion.glb"))
DOCS = os.path.normpath(os.path.join(HERE, "..", "docs"))

VIEWS = {
    "persp": ((0.26, 0.20, 0.30), (-0.020, 0.030, 0.0), (0, 1, 0)),
    "hero":  ((0.295, 0.105, 0.185), (0.005, 0.030, 0.0), (0, 1, 0)),
    "side":  ((0.0, 0.045, 0.42), (-0.025, 0.035, 0.0), (0, 1, 0)),
    "top":   ((-0.025, 0.46, 0.0), (-0.025, 0.0, 0.0), (-1, 0, 0)),
    "front": ((0.40, 0.075, 0.0), (0.0, 0.028, 0.0), (0, 1, 0)),
}


def shot(js, bn, view, W, H, anim=None, t=0.0, fov=32.0):
    eye, tgt, up = VIEWS[view]
    return render(js, bn, W, H, anim, t, eye=eye, target=tgt, up=up, fov=fov)


def grid(tiles, cols, W, H):
    rows = (len(tiles) + cols - 1) // cols
    out = bytearray(cols * W * rows * H * 3)
    for k, px in enumerate(tiles):
        cx, cy = k % cols, k // cols
        for y in range(H):
            src = y * W * 3
            dst = ((cy * H + y) * cols * W + cx * W) * 3
            out[dst:dst + W * 3] = px[src:src + W * 3]
    return bytes(out), cols * W, rows * H


def main():
    js, bn = load_glb(GLB)
    W, H = 640, 440

    tiles = [shot(js, bn, v, W, H)[0]
             for v in ("persp", "side", "top", "front")]
    px, w, h = grid(tiles, 2, W, H)
    write_png(os.path.join(DOCS, "orthographic.png"), px, w, h)
    print("orthographic.png")

    tiles = [shot(js, bn, "hero", W, H, "Walk", 1.05 * i / 6.0)[0]
             for i in range(6)]
    px, w, h = grid(tiles, 3, W, H)
    write_png(os.path.join(DOCS, "walk_cycle.png"), px, w, h)
    print("walk_cycle.png")

    times = [0.00, 0.22, 0.42, 0.56, 0.66, 1.10]
    tiles = [shot(js, bn, "hero", W, H, "Attack", t)[0] for t in times]
    px, w, h = grid(tiles, 3, W, H)
    write_png(os.path.join(DOCS, "attack.png"), px, w, h)
    print("attack.png")

    px, w, h = shot(js, bn, "persp", 1400, 950, "Idle", 0.0, fov=26.0)
    write_png(os.path.join(DOCS, "hero.png"), px, w, h)
    print("hero.png")


if __name__ == "__main__":
    main()

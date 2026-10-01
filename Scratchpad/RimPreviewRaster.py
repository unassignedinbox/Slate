#!/usr/bin/env python3
"""Scratchpad-only software preview of the rim OBJ dumps (no Vulkan in this sandbox).

Z-buffered rasteriser with a studio-ish three-light rig and per-slot material tint, so the spoke silhouette,
the window bevels and the barrel read clearly. Usage: RimPreviewRaster.py <obj> <png> [--view front|three-quarter|side]
"""
import sys, math
import numpy as np
from PIL import Image

SLOT_TINT = {0: (0.78, 0.79, 0.80), 1: (0.10, 0.10, 0.11), 2: (0.86, 0.87, 0.88),
             3: (0.16, 0.16, 0.17), 4: (0.55, 0.56, 0.58), 5: (0.20, 0.21, 0.23)}
SLOT_GLOSS = {0: 0.80, 1: 0.25, 2: 0.95, 3: 0.30, 4: 0.55, 5: 0.40}


def load(path):
    pos, nrm, faces, slots = [], [], [], []
    slot = 0
    for line in open(path):
        if line.startswith('v '):
            pos.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vn '):
            nrm.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('usemtl'):
            slot = int(line.strip().split('_')[-1])
        elif line.startswith('f '):
            tri = []
            for chunk in line.split()[1:4]:
                v, _t, n = chunk.split('/')
                tri.append((int(v) - 1, int(n) - 1))
            faces.append(tri)
            slots.append(slot)
    return np.array(pos, np.float64), np.array(nrm, np.float64), np.array(faces, np.int64), np.array(slots, np.int32)


def render(obj, out, view='three-quarter', size=1100, ss=2):
    pos, nrm, faces, slots = load(obj)
    w = h = size * ss
    centre = 0.5 * (pos.min(0) + pos.max(0))
    radius = np.linalg.norm(pos - centre, axis=1).max()

    if view == 'front':
        eye_dir = np.array([0.18, 0.12, 1.0])
    elif view == 'side':
        eye_dir = np.array([0.0, 1.0, 0.08])
    else:
        eye_dir = np.array([0.55, 0.78, 0.62])
    eye_dir = eye_dir / np.linalg.norm(eye_dir)
    up = np.array([0.0, 0.0, 1.0]) if abs(eye_dir[2]) < 0.9 else np.array([0.0, 1.0, 0.0])
    right = np.cross(up, eye_dir); right /= np.linalg.norm(right)
    up = np.cross(eye_dir, right)

    rel = pos - centre
    sx = rel @ right
    sy = rel @ up
    sz = rel @ eye_dir
    scale = 0.92 * (w / 2) / radius
    px = w / 2 + sx * scale
    py = h / 2 - sy * scale

    zbuf = np.full((h, w), -1e30)
    colour = np.zeros((h, w, 3), np.float32)
    # background: soft vertical studio gradient
    grad = np.linspace(0.16, 0.035, h, dtype=np.float32)[:, None]
    colour += grad[:, :, None] if grad.ndim == 3 else grad[:, :, None]

    lights = [(np.array([0.5, 0.35, 0.78]), np.array([1.0, 0.98, 0.95]), 1.25),
              (np.array([-0.75, 0.25, 0.3]), np.array([0.55, 0.62, 0.78]), 0.55),
              (np.array([0.1, -0.9, -0.2]), np.array([0.5, 0.45, 0.42]), 0.35)]
    lights = [(d / np.linalg.norm(d), c, i) for d, c, i in lights]

    f0 = faces[:, :, 0]
    x = px[f0]; y = py[f0]; z = sz[f0]
    n = nrm[faces[:, :, 1]]

    order = np.argsort(-z.mean(1))
    for fi in order:
        x0, x1, x2 = x[fi]; y0, y1, y2 = y[fi]
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if area >= 0:            # back-facing in screen space (CCW outward ⇒ negative with y flipped)
            continue
        lo_x = max(int(math.floor(min(x0, x1, x2))), 0); hi_x = min(int(math.ceil(max(x0, x1, x2))), w - 1)
        lo_y = max(int(math.floor(min(y0, y1, y2))), 0); hi_y = min(int(math.ceil(max(y0, y1, y2))), h - 1)
        if lo_x > hi_x or lo_y > hi_y:
            continue
        gx, gy = np.meshgrid(np.arange(lo_x, hi_x + 1), np.arange(lo_y, hi_y + 1))
        gxf = gx + 0.5; gyf = gy + 0.5
        w0 = ((x1 - x0) * (gyf - y0) - (y1 - y0) * (gxf - x0)) / area
        w1 = ((x2 - x1) * (gyf - y1) - (y2 - y1) * (gxf - x1)) / area
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        zz = w2 * z[fi, 0] + w0 * z[fi, 2] + w1 * z[fi, 1]
        sub = zbuf[lo_y:hi_y + 1, lo_x:hi_x + 1]
        hit = inside & (zz > sub)
        if not hit.any():
            continue
        nn = (w2[..., None] * n[fi, 0] + w0[..., None] * n[fi, 2] + w1[..., None] * n[fi, 1])
        nn /= np.maximum(np.linalg.norm(nn, axis=-1, keepdims=True), 1e-12)
        slot = int(slots[fi])
        albedo = np.array(SLOT_TINT.get(slot, (0.6, 0.6, 0.6)))
        gloss = SLOT_GLOSS.get(slot, 0.5)
        shade = np.zeros(nn.shape, np.float64)
        viewd = eye_dir
        for d, c, i in lights:
            lam = np.clip(nn @ d, 0, 1)
            hv = d + viewd; hv /= np.linalg.norm(hv)
            spec = np.clip(nn @ hv, 0, 1) ** (12 + 400 * gloss)
            shade += (lam[..., None] * albedo + spec[..., None] * gloss * 1.6) * c * i
        fres = (1 - np.clip(np.abs(nn @ viewd), 0, 1)) ** 4
        shade += fres[..., None] * 0.25 * gloss
        shade += albedo * 0.09
        sub[hit] = zz[hit]
        tile = colour[lo_y:hi_y + 1, lo_x:hi_x + 1]
        tile[hit] = np.clip(shade[hit], 0, 20)

    img = colour / (1.0 + colour)                      # Reinhard
    img = np.clip(img, 0, 1) ** (1 / 2.2)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    im.save(out)
    print('wrote', out)


if __name__ == '__main__':
    view = 'three-quarter'
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    for a in sys.argv[1:]:
        if a.startswith('--view'):
            view = a.split('=')[-1]
    render(args[0], args[1], view)

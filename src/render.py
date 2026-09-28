#!/usr/bin/env python3
"""Standalone GLB reader + software rasteriser used to visually verify the
model and its animation poses (no GPU / browser needed).

  python3 render.py ../model/scorpion.glb out.png --anim Walk --time 0.3
"""
import json
import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutil import vsub, vcross, vnorm, vdot, vadd, vmul


# ------------------------------------------------------------------ GLB IO
def load_glb(path):
    data = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and ver == 2, "not a glTF 2.0 binary"
    off = 12
    js = bin_ = None
    while off < total:
        ln, ty = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        else:
            bin_ = chunk
        off += 8 + ln
    return js, bin_


CT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
      5125: ("I", 4), 5126: ("f", 4)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_acc(js, bin_, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    fmt, sz = CT[a["componentType"]]
    n = NC[a["type"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    cnt = a["count"] * n
    vals = struct.unpack_from("<%d%s" % (cnt, fmt), bin_, base)
    if n == 1:
        return list(vals)
    return [tuple(vals[k * n:(k + 1) * n]) for k in range(a["count"])]


# -------------------------------------------------------------- transforms
def q_to_m(q):
    x, y, z, w = q
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def mat(t, r, s):
    m = q_to_m(r)
    return [[m[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)]


def mmul(a, b):
    out = []
    for i in range(3):
        row = []
        for j in range(3):
            row.append(sum(a[i][k] * b[k][j] for k in range(3)))
        row.append(sum(a[i][k] * b[k][3] for k in range(3)) + a[i][3])
        out.append(row)
    return out


def mapply(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]
                 for i in range(3))


def mrot(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2]
                 for i in range(3))


def slerp(a, b, t):
    d = sum(a[i] * b[i] for i in range(4))
    if d < 0:
        b = tuple(-v for v in b); d = -d
    if d > 0.9995:
        r = tuple(a[i] + (b[i] - a[i]) * t for i in range(4))
    else:
        th = math.acos(max(-1, min(1, d)))
        s = math.sin(th)
        w1, w2 = math.sin((1 - t) * th) / s, math.sin(t * th) / s
        r = tuple(a[i] * w1 + b[i] * w2 for i in range(4))
    l = math.sqrt(sum(v * v for v in r))
    return tuple(v / l for v in r)


def sample(times, values, t, kind):
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    lo = 0
    for i in range(len(times) - 1):
        if times[i] <= t <= times[i + 1]:
            lo = i
            break
    u = (t - times[lo]) / (times[lo + 1] - times[lo])
    a, b = values[lo], values[lo + 1]
    if kind == "rotation":
        return slerp(a, b, u)
    return tuple(a[i] + (b[i] - a[i]) * u for i in range(len(a)))


def world_matrices(js, bin_, anim_name=None, time=0.0):
    nodes = js["nodes"]
    trs = []
    for n in nodes:
        trs.append([list(n.get("translation", [0, 0, 0])),
                    list(n.get("rotation", [0, 0, 0, 1])),
                    list(n.get("scale", [1, 1, 1]))])
    if anim_name:
        anim = next((a for a in js["animations"] if a["name"] == anim_name),
                    None)
        if anim:
            for ch in anim["channels"]:
                s = anim["samplers"][ch["sampler"]]
                times = read_acc(js, bin_, s["input"])
                vals = read_acc(js, bin_, s["output"])
                path = ch["target"]["path"]
                v = sample(times, vals, time % (times[-1] + 1e-9), path)
                idx = {"translation": 0, "rotation": 1, "scale": 2}[path]
                trs[ch["target"]["node"]][idx] = list(v)
    world = [None] * len(nodes)

    def rec(i, parent):
        t, r, s = trs[i]
        m = mat(t, r, s)
        m = mmul(parent, m) if parent else m
        world[i] = m
        for c in nodes[i].get("children", []):
            rec(c, m)
    ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
    for r in js["scenes"][js.get("scene", 0)]["nodes"]:
        rec(r, ident)
    return world


# ------------------------------------------------------------- rasteriser
def render(js, bin_, W=1000, H=700, anim=None, time=0.0,
           eye=None, target=None, up=(0, 1, 0), fov=32.0, bg=(0.10, 0.11, 0.12)):
    world = world_matrices(js, bin_, anim, time)
    mats = []
    for m in js["materials"]:
        p = m["pbrMetallicRoughness"]
        mats.append((p["baseColorFactor"][:3], p.get("roughnessFactor", 0.5),
                     p.get("metallicFactor", 0.0)))

    tris = []
    for ni, n in enumerate(js["nodes"]):
        if "mesh" not in n:
            continue
        M = world[ni]
        for prim in js["meshes"][n["mesh"]]["primitives"]:
            P = read_acc(js, bin_, prim["attributes"]["POSITION"])
            Nn = read_acc(js, bin_, prim["attributes"]["NORMAL"])
            I = read_acc(js, bin_, prim["indices"])
            wp = [mapply(M, p) for p in P]
            wn = [vnorm(mrot(M, p)) for p in Nn]
            mi = prim.get("material", 0)
            for k in range(0, len(I), 3):
                tris.append((wp[I[k]], wp[I[k + 1]], wp[I[k + 2]],
                             wn[I[k]], wn[I[k + 1]], wn[I[k + 2]], mi))

    allp = [t[j] for t in tris for j in range(3)]
    cx = sum(p[0] for p in allp) / len(allp)
    cy = sum(p[1] for p in allp) / len(allp)
    cz = sum(p[2] for p in allp) / len(allp)
    if target is None:
        target = (cx, cy, cz)
    if eye is None:
        eye = (cx + 0.26, cy + 0.14, cz + 0.20)

    fwd = vnorm(vsub(target, eye))
    right = vnorm(vcross(fwd, up))
    upv = vcross(right, fwd)
    f = 1.0 / math.tan(math.radians(fov) * 0.5)
    near = 0.005

    zbuf = [1e30] * (W * H)
    img = [bg[0], bg[1], bg[2]] * (W * H)
    img = [v for _ in range(W * H) for v in bg]

    L1 = vnorm((-0.45, 0.85, 0.35))     # key
    L2 = vnorm((0.6, 0.25, -0.7))       # rim
    L3 = vnorm((0.1, -0.7, 0.3))        # bounce

    def project(p):
        d = vsub(p, eye)
        vx, vy, vz = vdot(d, right), vdot(d, upv), vdot(d, fwd)
        return vx, vy, vz

    for (p0, p1, p2, n0, n1, n2, mi) in tris:
        v0, v1, v2 = project(p0), project(p1), project(p2)
        if v0[2] < near or v1[2] < near or v2[2] < near:
            continue
        s = []
        for v in (v0, v1, v2):
            s.append((W * 0.5 + f * v[0] / v[2] * H * 0.5,
                      H * 0.5 - f * v[1] / v[2] * H * 0.5, v[2]))
        area = ((s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) -
                (s[1][1] - s[0][1]) * (s[2][0] - s[0][0]))
        if area >= -1e-9:
            continue                      # back-face / degenerate
        minx = max(0, int(min(q[0] for q in s)))
        maxx = min(W - 1, int(max(q[0] for q in s)) + 1)
        miny = max(0, int(min(q[1] for q in s)))
        maxy = min(H - 1, int(max(q[1] for q in s)) + 1)
        if minx > maxx or miny > maxy:
            continue
        base, rough, metal = mats[mi]
        iz = [1.0 / q[2] for q in s]
        for y in range(miny, maxy + 1):
            py = y + 0.5
            for x in range(minx, maxx + 1):
                px = x + 0.5
                w0 = ((s[1][0] - px) * (s[2][1] - py) -
                      (s[1][1] - py) * (s[2][0] - px)) / area
                if w0 < 0: continue
                w1 = ((s[2][0] - px) * (s[0][1] - py) -
                      (s[2][1] - py) * (s[0][0] - px)) / area
                if w1 < 0: continue
                w2 = 1.0 - w0 - w1
                if w2 < 0: continue
                z = 1.0 / (w0 * iz[0] + w1 * iz[1] + w2 * iz[2])
                o = y * W + x
                if z >= zbuf[o]:
                    continue
                zbuf[o] = z
                nx = w0 * n0[0] + w1 * n1[0] + w2 * n2[0]
                ny = w0 * n0[1] + w1 * n1[1] + w2 * n2[1]
                nz = w0 * n0[2] + w1 * n1[2] + w2 * n2[2]
                nn = vnorm((nx, ny, nz))
                view = vnorm(vsub(eye, (w0 * p0[0] + w1 * p1[0] + w2 * p2[0],
                                        w0 * p0[1] + w1 * p1[1] + w2 * p2[1],
                                        w0 * p0[2] + w1 * p1[2] + w2 * p2[2])))
                if vdot(nn, view) < 0:
                    nn = tuple(-c for c in nn)
                col = [0.0, 0.0, 0.0]
                shin = max(2.0, 2.0 / max(1e-3, rough ** 2))
                for Ld, Lc, Li in ((L1, (1.0, 0.97, 0.92), 1.15),
                                   (L2, (0.55, 0.65, 0.85), 0.55),
                                   (L3, (0.35, 0.30, 0.28), 0.25)):
                    d = max(0.0, vdot(nn, Ld))
                    h = vnorm(vadd(Ld, view))
                    sp = max(0.0, vdot(nn, h)) ** shin
                    for ci in range(3):
                        col[ci] += Li * Lc[ci] * (base[ci] * d +
                                                  sp * (0.35 + 0.65 * metal) *
                                                  (base[ci] * metal +
                                                   (1 - metal) * 0.9))
                fres = (1.0 - max(0.0, vdot(nn, view))) ** 3
                for ci in range(3):
                    col[ci] += 0.06 * base[ci] + 0.10 * fres
                    img[o * 3 + ci] = col[ci]
    # tonemap + gamma
    px = bytearray(W * H * 3)
    for i in range(W * H * 3):
        c = img[i]
        c = c / (1.0 + c)
        px[i] = int(255 * (c ** (1 / 2.2)) + 0.5)
    return bytes(px), W, H


def write_png(path, px, W, H):
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        raw += px[y * W * 3:(y + 1) * W * 3]
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("glb"); ap.add_argument("out")
    ap.add_argument("--anim", default=None)
    ap.add_argument("--time", type=float, default=0.0)
    ap.add_argument("--w", type=int, default=900)
    ap.add_argument("--h", type=int, default=620)
    ap.add_argument("--view", default="persp")
    ap.add_argument("--fov", type=float, default=32.0)
    a = ap.parse_args()
    js, bn = load_glb(a.glb)
    eye = None
    tgt = (0.0, 0.03, 0.0)
    R = 0.30
    tgt = (-0.020, 0.030, 0.0)
    if a.view == "persp":   eye = (0.26, 0.20, 0.30)
    elif a.view == "hero":  eye = (0.235, 0.085, 0.145)
    elif a.view == "side":  eye = (0.0, 0.045, 0.42); tgt = (-0.025, 0.035, 0)
    elif a.view == "top":   eye = (-0.025, 0.46, 0.0); tgt = (-0.025, 0, 0)
    elif a.view == "front": eye = (0.40, 0.075, 0.0); tgt = (0.0, 0.028, 0)
    elif a.view == "close": eye = (0.13, 0.085, 0.13); tgt = (0.005, 0.022, 0)
    up = (-1.0, 0.0, 0.0) if a.view == "top" else (0.0, 1.0, 0.0)
    px, W, H = render(js, bn, a.w, a.h, a.anim, a.time, eye=eye, target=tgt,
                      up=up, fov=a.fov)
    write_png(a.out, px, W, H)
    print("wrote", a.out)

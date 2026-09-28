"""Procedural surface construction: swept tubes, ellipsoids, spines, cones."""
import math
from mathutil import (vadd, vsub, vmul, vdot, vcross, vnorm, vlen, q_rot,
                      hash01, lerp)


class Mesh:
    def __init__(self, material=0):
        self.v = []          # positions
        self.n = []          # normals (computed later)
        self.uv = []
        self.idx = []
        self.material = material

    def add_vert(self, p, uv=(0.0, 0.0)):
        self.v.append(tuple(p))
        self.uv.append(tuple(uv))
        return len(self.v) - 1

    def tri(self, a, b, c):
        self.idx += [a, b, c]

    def quad(self, a, b, c, d):
        self.idx += [a, b, c, a, c, d]

    def merge(self, other):
        o = len(self.v)
        self.v += other.v
        self.uv += other.uv
        self.idx += [i + o for i in other.idx]

    def transform(self, fn):
        self.v = [fn(p) for p in self.v]

    def translate(self, t):
        self.transform(lambda p: vadd(p, t))

    def scale(self, s):
        if isinstance(s, (int, float)):
            s = (s, s, s)
        self.transform(lambda p: (p[0] * s[0], p[1] * s[1], p[2] * s[2]))

    def rotate(self, q):
        self.transform(lambda p: q_rot(q, p))

    def compute_normals(self, smooth=True):
        acc = [[0.0, 0.0, 0.0] for _ in self.v]
        for k in range(0, len(self.idx), 3):
            a, b, c = self.idx[k], self.idx[k + 1], self.idx[k + 2]
            p, q, r = self.v[a], self.v[b], self.v[c]
            fn = vcross(vsub(q, p), vsub(r, p))
            for i in (a, b, c):
                acc[i][0] += fn[0]; acc[i][1] += fn[1]; acc[i][2] += fn[2]
        self.n = [vnorm(tuple(a)) if vlen(tuple(a)) > 1e-20 else (0.0, 1.0, 0.0)
                  for a in acc]

    def bounds(self):
        mn = [min(p[i] for p in self.v) for i in range(3)]
        mx = [max(p[i] for p in self.v) for i in range(3)]
        return mn, mx


# --------------------------------------------------------------- sweeping
def frames_along(path, up=(0.0, 1.0, 0.0)):
    """parallel-transport-ish frames: tangent t, side s, normal n"""
    out = []
    n = len(path)
    for i in range(n):
        if i == 0:
            t = vsub(path[1], path[0])
        elif i == n - 1:
            t = vsub(path[-1], path[-2])
        else:
            t = vsub(path[i + 1], path[i - 1])
        t = vnorm(t)
        s = vcross(t, up)
        if vlen(s) < 1e-6:
            s = vcross(t, (1.0, 0.0, 0.0))
        s = vnorm(s)
        u = vnorm(vcross(s, t))
        out.append((t, s, u))
    return out


def sweep(path, profile, segs=20, cap_start=True, cap_end=True,
          roll=None, squash_fn=None, material=0, noise=0.0, noise_scale=9.0,
          seed=0):
    """Sweep an elliptical profile along a 3-D path.

    profile: list of (half_width, half_height) per path point (in the
             side / up plane of the local frame).
    squash_fn: optional f(i_ring, angle) -> radial multiplier, for
               flattening tergites / faceting chitin plates.
    """
    m = Mesh(material)
    fr = frames_along(path)
    rings = []
    for i, (p, (w, h)) in enumerate(zip(path, profile)):
        t, s, u = fr[i]
        if roll is not None:
            ang0 = roll[i]
            s2 = vadd(vmul(s, math.cos(ang0)), vmul(u, math.sin(ang0)))
            u2 = vadd(vmul(s, -math.sin(ang0)), vmul(u, math.cos(ang0)))
            s, u = s2, u2
        ring = []
        for j in range(segs):
            a = 2.0 * math.pi * j / segs
            k = 1.0
            if squash_fn:
                k = squash_fn(i, a)
            if noise > 0.0:
                nz = (hash01(i * 131 + j * 17 + seed) - 0.5)
                nz += 0.5 * (hash01(i * 7 + j * 977 + seed * 3) - 0.5)
                k *= 1.0 + noise * nz
            off = vadd(vmul(s, math.cos(a) * w * k),
                       vmul(u, math.sin(a) * h * k))
            ring.append(m.add_vert(vadd(p, off),
                                   (j / float(segs), i / float(len(path) - 1))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(segs):
            jn = (j + 1) % segs
            m.quad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j])
    if cap_start:
        c = m.add_vert(path[0])
        for j in range(segs):
            m.tri(c, rings[0][(j + 1) % segs], rings[0][j])
    if cap_end:
        c = m.add_vert(path[-1])
        for j in range(segs):
            m.tri(c, rings[-1][j], rings[-1][(j + 1) % segs])
    return m


def ellipsoid(rx, ry, rz, u_segs=24, v_segs=14, material=0, noise=0.0, seed=0):
    m = Mesh(material)
    grid = []
    for i in range(v_segs + 1):
        phi = math.pi * i / v_segs
        row = []
        for j in range(u_segs):
            th = 2.0 * math.pi * j / u_segs
            k = 1.0
            if noise > 0.0:
                k += noise * (hash01(i * 53 + j * 29 + seed) - 0.5)
            row.append(m.add_vert((rx * math.sin(phi) * math.cos(th) * k,
                                   ry * math.cos(phi) * k,
                                   rz * math.sin(phi) * math.sin(th) * k),
                                  (j / float(u_segs), i / float(v_segs))))
        grid.append(row)
    for i in range(v_segs):
        for j in range(u_segs):
            jn = (j + 1) % u_segs
            m.quad(grid[i][j], grid[i][jn], grid[i + 1][jn], grid[i + 1][j])
    return m


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n):
        t = i / float(n - 1)
        mt = 1 - t
        out.append(tuple(mt**3 * p0[k] + 3 * mt * mt * t * p1[k] +
                         3 * mt * t * t * p2[k] + t**3 * p3[k]
                         for k in range(3)))
    return out


def taper(n, a, b, power=1.0, bulge=0.0):
    """radius list of length n from a -> b with optional mid bulge"""
    out = []
    for i in range(n):
        t = i / float(n - 1)
        r = lerp(a, b, t ** power)
        r *= 1.0 + bulge * math.sin(math.pi * t)
        out.append(r)
    return out


def spine(length, base_r, curve=0.0, segs=9, rings=7, material=0):
    """A sharp tapering claw / seta / aculeus, curving in +Y."""
    path = []
    for i in range(rings):
        t = i / float(rings - 1)
        path.append((length * t,
                     curve * (t ** 1.8),
                     0.0))
    prof = [(base_r * (1 - t / float(rings - 1)) ** 0.75 + 1e-5,) * 2
            for t in range(rings)]
    return sweep(path, prof, segs=segs, cap_start=True, cap_end=False,
                 material=material)

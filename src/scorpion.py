#!/usr/bin/env python3
"""
Procedural anatomically-structured scorpion (Pandinus imperator-like),
exported as a rigged, animated glTF 2.0 binary (.glb).

Coordinate system:  +X forward (anterior)   +Y up (dorsal)   +Z right
Units: metres.  Body length (prosoma + mesosoma + metasoma) ~ 0.19 m,
matching an adult emperor scorpion (~18-20 cm).

Anatomy implemented (after Polis, "The Biology of Scorpions", and the
dorsal/lateral photo references in ../reference):
  prosoma (cephalothorax) -- carapace with median ocelli + 3 lateral ocelli
  chelicerae (2)          -- small 2-fingered jaws
  pedipalps (2)           -- coxa, trochanter, femur, patella, chela
                             (manus + fixed finger + movable finger)
  legs (8)                -- coxa/trochanter, femur, patella, tibia,
                             basitarsus+tarsus, paired ungues (claws)
  pectines (2)            -- comb organs on the ventral mesosoma
  mesosoma                -- 7 overlapping tergites / sternites
  metasoma                -- 5 segments, keeled and granulated
  telson                  -- vesicle (venom bulb) + aculeus (the stinger)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mathutil import (q_id, qx, qy, qz, q_mul, q_axis, lerp, smoothstep,
                      hash01)
import geom
from geom import Mesh, sweep, ellipsoid, taper, bezier, spine
from gltf import GLTF

TAU = math.pi * 2
D2R = math.pi / 180.0

# ----------------------------------------------------------------- scale
BODY_Y = 0.0180           # ride height of the prosoma above the ground

# =====================================================================
#  MATERIALS
# =====================================================================
g = GLTF()
M_CHITIN = g.add_material("chitin_dorsal", (0.055, 0.045, 0.043, 1.0),
                          metallic=0.35, rough=0.33)
M_CHITIN_L = g.add_material("chitin_ventral", (0.115, 0.082, 0.062, 1.0),
                            metallic=0.25, rough=0.55)
M_MEMBRANE = g.add_material("arthrodial_membrane", (0.28, 0.20, 0.14, 1.0),
                            metallic=0.0, rough=0.85)
M_CLAW = g.add_material("claw_keratin", (0.035, 0.028, 0.026, 1.0),
                        metallic=0.5, rough=0.16)
M_TELSON = g.add_material("telson_aculeus", (0.42, 0.17, 0.06, 1.0),
                          metallic=0.2, rough=0.3)
M_EYE = g.add_material("ocellus", (0.02, 0.02, 0.025, 1.0),
                       metallic=0.9, rough=0.05)


def flat_bottom(strength=0.42, top=1.0):
    def f(i, a):
        s = math.sin(a)
        k = top
        if s < 0:
            k *= 1.0 - strength * (-s)
        return k
    return f


def keeled(strength=0.10, n=4):
    """granular longitudinal keels, as on the metasoma"""
    def f(i, a):
        return 1.0 + strength * (0.5 + 0.5 * math.cos(n * a))
    return f


# =====================================================================
#  PART GEOMETRY  (each authored in its own bone space, +X = distal)
# =====================================================================
def make_carapace():
    """Prosoma: broad trapezoidal carapace, flat-bottomed, granulated."""
    parts = []
    X0, X1 = -0.0215, 0.0205        # 42 mm long
    n = 13
    path = [(X0 + (X1 - X0) * (i / (n - 1.0)), 0.0, 0.0) for i in range(n)]
    # widest at the posterior margin, narrowing to the anterior margin
    w = [0.0168, 0.0172, 0.0174, 0.0173, 0.0170, 0.0165, 0.0158,
         0.0149, 0.0139, 0.0127, 0.0114, 0.0100, 0.0086]
    h = [0.0058, 0.0063, 0.0067, 0.0069, 0.0070, 0.0070, 0.0069,
         0.0067, 0.0064, 0.0060, 0.0055, 0.0049, 0.0042]
    p2 = [(x, y + 0.0013 * math.sin(math.pi * i / (n - 1.0)), z)
          for i, (x, y, z) in enumerate(path)]
    parts.append(sweep(p2, list(zip(w, h)), segs=28,
                       squash_fn=flat_bottom(0.58),
                       material=M_CHITIN, noise=0.035, seed=11))

    # ocular tubercle + the pair of median ocelli, just behind mid-carapace
    tub = ellipsoid(0.0034, 0.0024, 0.0042, 16, 10, material=M_CHITIN)
    tub.translate((0.0005, 0.0066, 0.0))
    parts.append(tub)
    for z in (-0.0023, 0.0023):
        e = ellipsoid(0.0014, 0.0014, 0.0014, 12, 8, material=M_EYE)
        e.translate((0.0012, 0.0078, z))
        parts.append(e)
    # three pairs of lateral ocelli on the antero-lateral margin
    for s_ in (-1, 1):
        for k in range(3):
            e = ellipsoid(0.00075, 0.00075, 0.00075, 8, 6, material=M_EYE)
            e.translate((0.0168 - k * 0.0024, 0.0040,
                         s_ * (0.0072 + 0.0009 * k)))
            parts.append(e)
    # anterior median furrow
    fur = sweep([(0.004, 0.0062, 0.0), (0.019, 0.0044, 0.0)],
                [(0.0009, 0.0009), (0.0007, 0.0007)], segs=8,
                material=M_CHITIN_L)
    parts.append(fur)
    # ventral sternum between the leg coxae
    st = sweep([(-0.0115, -0.0048, 0.0), (-0.002, -0.0056, 0.0),
                (0.0105, -0.0050, 0.0)],
               [(0.0042, 0.0013), (0.0058, 0.0015), (0.0042, 0.0012)],
               segs=16, material=M_CHITIN_L)
    parts.append(st)
    return parts


def make_chelicera(side):
    """Small 2-fingered jaw in front of the mouth."""
    parts = []
    base = sweep([(0, 0, 0), (0.005, 0.0004, 0), (0.0092, 0.0006, 0)],
                 [(0.0028, 0.0026), (0.0026, 0.0024), (0.0020, 0.0019)],
                 segs=12, material=M_CHITIN_L, noise=0.03, seed=3)
    parts.append(base)
    for k, dy in ((0, 0.0013), (1, -0.0013)):
        f = spine(0.0055, 0.0010, curve=-0.0016 if dy > 0 else 0.0016,
                  segs=8, rings=6, material=M_CLAW)
        f.translate((0.0088, dy, 0.0))
        parts.append(f)
    return parts


LEG_SCALE = 0.95     # calibrated so leg IV spans ~50 mm, as in P. imperator


def leg_dims(i):
    """femur, patella, tibia, tarsus lengths for leg pair i (0 = front)."""
    d = [(0.0165, 0.0145, 0.0130, 0.0100),
         (0.0185, 0.0163, 0.0143, 0.0108),
         (0.0208, 0.0182, 0.0158, 0.0116),
         (0.0246, 0.0214, 0.0184, 0.0128)][i]
    return tuple(v * LEG_SCALE for v in d)


def make_leg_segment(length, r0, r1, bow=0.0, mat=M_CHITIN, seed=0,
                     bristles=0):
    n = 8
    path = [(length * t / (n - 1.0), bow * math.sin(math.pi * t / (n - 1.0)),
             0.0) for t in range(n)]
    prof = list(zip(taper(n, r0, r1, 1.1, bulge=0.06),
                    taper(n, r0 * 0.92, r1 * 0.92, 1.1, bulge=0.06)))
    m = sweep(path, prof, segs=14, material=mat, noise=0.05, seed=seed)
    parts = [m]
    # membranous joint collar at the proximal end
    col = sweep([(-0.0012, 0, 0), (0.0009, 0, 0)],
                [(r0 * 0.80, r0 * 0.80), (r0 * 0.86, r0 * 0.86)],
                segs=12, material=M_MEMBRANE)
    parts.append(col)
    for b in range(bristles):
        t = 0.25 + 0.6 * hash01(seed * 31 + b)
        ang = TAU * hash01(seed * 17 + b * 5)
        s = spine(0.0035 + 0.002 * hash01(b + seed), 0.00028,
                  curve=0.0008, segs=5, rings=4, material=M_CLAW)
        s.rotate(q_mul(q_axis((1, 0, 0), ang), qz(-0.9)))
        rr = lerp(r0, r1, t)
        s.translate((length * t, -math.cos(ang) * rr * 0.6,
                     math.sin(ang) * rr * 0.9))
        parts.append(s)
    return parts


def make_tarsus(length, r0):
    parts = make_leg_segment(length, r0, r0 * 0.45, bow=-0.0008,
                             mat=M_CHITIN, seed=77, bristles=4)
    # paired ungues (tarsal claws) + median dactyl
    for z in (-0.0011, 0.0011):
        c = spine(0.0034, 0.00055, curve=-0.0022, segs=7, rings=6,
                  material=M_CLAW)
        c.rotate(qz(-0.35))
        c.translate((length - 0.0004, 0.0, z))
        parts.append(c)
    return parts


def make_pedipalp_femur(L):
    n = 8
    path = [(L * t / (n - 1.0), 0.0006 * math.sin(math.pi * t / (n - 1.0)), 0)
            for t in range(n)]
    prof = list(zip(taper(n, 0.0042, 0.0050, 1.0, bulge=0.05),
                    taper(n, 0.0038, 0.0046, 1.0, bulge=0.05)))
    m = sweep(path, prof, segs=16, squash_fn=keeled(0.05, 3),
              material=M_CHITIN, noise=0.07, seed=21)
    col = sweep([(-0.0014, 0, 0), (0.001, 0, 0)],
                [(0.0034, 0.0034), (0.0038, 0.0038)], segs=12,
                material=M_MEMBRANE)
    return [m, col]


def make_pedipalp_patella(L):
    n = 8
    path = [(L * t / (n - 1.0), 0.0, 0.0) for t in range(n)]
    prof = list(zip(taper(n, 0.0050, 0.0058, 1.0, bulge=0.08),
                    taper(n, 0.0046, 0.0052, 1.0, bulge=0.08)))
    m = sweep(path, prof, segs=16, squash_fn=keeled(0.06, 3),
              material=M_CHITIN, noise=0.07, seed=22)
    col = sweep([(-0.0016, 0, 0), (0.001, 0, 0)],
                [(0.0042, 0.0042), (0.0046, 0.0046)], segs=12,
                material=M_MEMBRANE)
    return [m, col]


CHELA_S = 0.78       # chela overall length ~45 mm


def make_chela(side):
    """Manus (hand) + immovable finger.  Heavy, granulated, reticulated."""
    parts = []
    n = 12
    # the manus swells laterally and is dorso-ventrally flattened
    path = []
    for t in range(n):
        u = t / (n - 1.0)
        path.append((0.0300 * u, 0.0, side * 0.0035 * math.sin(math.pi * u)))
    w = [0.0055, 0.0075, 0.0092, 0.0104, 0.0111, 0.0114, 0.0113,
         0.0108, 0.0098, 0.0084, 0.0066, 0.0046]
    h = [0.0048, 0.0060, 0.0069, 0.0074, 0.0077, 0.0077, 0.0075,
         0.0071, 0.0064, 0.0055, 0.0044, 0.0032]
    m = sweep(path, list(zip(w, h)), segs=26,
              squash_fn=lambda i, a: 1.0 + 0.045 * math.cos(2 * a),
              material=M_CHITIN, noise=0.075, seed=31)
    parts.append(m)

    # immovable (fixed) finger: long, gently incurved, with a dentate margin
    fn = 12
    fpath = bezier((0.0292, -0.0018, side * 0.0016),
                   (0.0400, -0.0030, side * 0.0022),
                   (0.0500, -0.0034, side * 0.0006),
                   (0.0585, -0.0028, -side * 0.0020), fn)
    fprof = list(zip(taper(fn, 0.0036, 0.0004, 1.35),
                     taper(fn, 0.0032, 0.0004, 1.35)))
    f = sweep(fpath, fprof, segs=14, material=M_CHITIN, noise=0.05, seed=32)
    parts.append(f)
    # denticles along the cutting edge
    for k in range(7):
        u = 0.12 + 0.72 * k / 6.0
        idx = int(u * (fn - 1))
        p = fpath[idx]
        d = spine(0.0016 + 0.0006 * hash01(k), 0.00040, curve=-0.0004,
                  segs=6, rings=4, material=M_CLAW)
        d.rotate(qy(-side * math.pi * 0.5))
        d.translate((p[0], p[1] + 0.0008, p[2] - side * 0.0004))
        parts.append(d)
    # trichobothria (sensory hairs) on the manus
    for k in range(9):
        a = TAU * hash01(k * 13 + 5)
        u = 0.15 + 0.7 * hash01(k * 29)
        s = spine(0.0030, 0.00022, curve=0.0006, segs=5, rings=4,
                  material=M_CLAW)
        s.rotate(q_mul(q_axis((1, 0, 0), a), qz(-1.1)))
        rw = lerp(0.006, 0.010, math.sin(math.pi * u))
        s.translate((0.030 * u, math.sin(a) * rw * 0.75,
                     math.cos(a) * rw * 0.95 + side * 0.0035 *
                     math.sin(math.pi * u)))
        parts.append(s)
    for p in parts:
        p.scale(CHELA_S)
    return parts


def make_movable_finger(side):
    parts = []
    n = 12
    p = bezier((0.0, 0.0, 0.0), (0.0110, 0.0022, side * 0.0008),
               (0.0215, 0.0026, -side * 0.0004),
               (0.0300, 0.0008, -side * 0.0026), n)
    prof = list(zip(taper(n, 0.0038, 0.00045, 1.3),
                    taper(n, 0.0035, 0.00045, 1.3)))
    parts.append(sweep(p, prof, segs=14, material=M_CHITIN,
                       noise=0.05, seed=41))
    for k in range(8):
        u = 0.08 + 0.78 * k / 7.0
        idx = int(u * (n - 1))
        q = p[idx]
        d = spine(0.0016 + 0.0006 * hash01(k + 3), 0.00040, curve=-0.0004,
                  segs=6, rings=4, material=M_CLAW)
        d.rotate(qy(-side * math.pi * 0.5))
        d.rotate(qx(math.pi))
        d.translate((q[0], q[1] - 0.0008, q[2] - side * 0.0004))
        parts.append(d)
    for p in parts:
        p.scale(CHELA_S)
    return parts


def make_tergite(i, L, w0, w1, h0, h1):
    """One overlapping dorsal plate of the mesosoma."""
    n = 6
    path = [(L * t / (n - 1.0), 0.0, 0.0) for t in range(n)]
    prof = list(zip(taper(n, w0, w1), taper(n, h0, h1)))
    m = sweep(path, prof, segs=26, squash_fn=flat_bottom(0.50),
              material=M_CHITIN, noise=0.03, seed=50 + i)
    # posterior overlapping lip
    lip = sweep([(L - 0.0020, 0, 0), (L + 0.0032, 0, 0)],
                [(w1 * 1.05, h1 * 1.04), (w1 * 0.99, h1 * 0.98)],
                segs=26, squash_fn=flat_bottom(0.50), material=M_CHITIN)
    # ventral sternite, paler
    st = sweep([(0.0008, -h0 * 0.52, 0), (L - 0.001, -h1 * 0.52, 0)],
               [(w0 * 0.80, h0 * 0.16), (w1 * 0.80, h1 * 0.16)],
               segs=18, material=M_CHITIN_L)
    return [m, lip, st]


def make_mesosoma():
    parts = []
    x = 0.0
    segs = [
        # L,     w0,     w1,     h0,     h1
        (0.0088, 0.0150, 0.0156, 0.0060, 0.0062),
        (0.0090, 0.0156, 0.0160, 0.0062, 0.0063),
        (0.0090, 0.0160, 0.0158, 0.0063, 0.0062),
        (0.0088, 0.0158, 0.0151, 0.0062, 0.0060),
        (0.0086, 0.0151, 0.0140, 0.0060, 0.0056),
        (0.0082, 0.0140, 0.0124, 0.0056, 0.0051),
        (0.0080, 0.0124, 0.0096, 0.0051, 0.0044),
    ]
    out = []
    for i, (L, w0, w1, h0, h1) in enumerate(segs):
        for p in make_tergite(i, L, w0, w1, h0, h1):
            # authored along +X: mirror to -X (anterior -> posterior)
            p.transform(lambda q: (-q[0], q[1], q[2]))
            p.idx = [p.idx[k + o] for k in range(0, len(p.idx), 3)
                     for o in (0, 2, 1)]
            p.translate((-x, 0.0, 0.0))
            out.append(p)
        x += L

    # book-lung spiracles (4 pairs, ventral)
    for k in range(4):
        for s in (-1, 1):
            sp = ellipsoid(0.0016, 0.0004, 0.0006, 10, 6,
                           material=M_MEMBRANE)
            sp.translate((-0.020 - k * 0.0086, -0.0038, s * 0.0072))
            out.append(sp)
    return out


def make_pecten(side):
    """Comb organ: a shaft bearing ~18 teeth, unique to scorpions."""
    parts = []
    shaft = sweep([(0, 0, 0), (0.0055, 0.0, side * 0.0012),
                   (0.0105, 0.0, side * 0.0030)],
                  [(0.0013, 0.0009), (0.0012, 0.0008), (0.0009, 0.0006)],
                  segs=10, material=M_CHITIN_L)
    parts.append(shaft)
    N = 16
    for k in range(N):
        u = 0.06 + 0.9 * k / (N - 1.0)
        L = 0.0042 * (1.0 - 0.35 * abs(u - 0.45))
        t = spine(L, 0.00042, curve=0.0004, segs=5, rings=4,
                  material=M_CHITIN_L)
        t.rotate(qz(-0.15))
        t.rotate(qy(side * 1.30))
        t.translate((0.0105 * u, -0.0004, side * (0.0030 * u * u + 0.0008)))
        parts.append(t)
    return parts


def make_metasomal_segment(i, L, r0, r1):
    n = 7
    path = [(L * t / (n - 1.0), 0.0, 0.0) for t in range(n)]
    prof = list(zip(taper(n, r0, r1, 1.0, bulge=0.05),
                    taper(n, r0 * 0.97, r1 * 0.97, 1.0, bulge=0.05)))
    m = sweep(path, prof, segs=20, squash_fn=keeled(0.085, 4),
              material=M_CHITIN, noise=0.06, seed=60 + i)
    col = sweep([(-0.0016, 0, 0), (0.0012, 0, 0)],
                [(r0 * 0.80, r0 * 0.80), (r0 * 0.88, r0 * 0.88)],
                segs=16, material=M_MEMBRANE)
    parts = [m, col]
    # setae on the ventral keels
    for k in range(5):
        u = 0.2 + 0.6 * hash01(k + i * 9)
        s = spine(0.0026, 0.00024, curve=0.0005, segs=5, rings=4,
                  material=M_CLAW)
        a = math.pi * (0.85 + 0.3 * hash01(k * 3 + i))
        s.rotate(q_mul(q_axis((1, 0, 0), a), qz(-1.0)))
        rr = lerp(r0, r1, u)
        s.translate((L * u, math.sin(a) * rr * 0.9, math.cos(a) * rr * 0.9))
        parts.append(s)
    return parts


def make_telson():
    """Vesicle (venom bulb) + aculeus (the sting)."""
    parts = []
    n = 10
    path = []
    for t in range(n):
        u = t / (n - 1.0)
        path.append((0.0145 * u, -0.0012 * math.sin(math.pi * u), 0.0))
    w = [0.0038, 0.0050, 0.0058, 0.0062, 0.0063, 0.0061, 0.0056,
         0.0048, 0.0037, 0.0024]
    h = [0.0040, 0.0053, 0.0062, 0.0066, 0.0067, 0.0064, 0.0058,
         0.0049, 0.0037, 0.0024]
    v = sweep(path, list(zip(w, h)), segs=22, material=M_CHITIN,
              noise=0.045, seed=71)
    parts.append(v)
    # subaculear tubercle
    tb = ellipsoid(0.0016, 0.0012, 0.0012, 10, 8, material=M_CHITIN)
    tb.translate((0.0138, -0.0022, 0.0))
    parts.append(tb)
    return parts


def make_aculeus():
    """The sharply recurved sting itself, amber-coloured at the tip."""
    n = 14
    p = bezier((0.0, 0.0, 0.0), (0.0034, 0.0006, 0.0),
               (0.0068, -0.0022, 0.0), (0.0092, -0.0072, 0.0), n)
    prof = list(zip(taper(n, 0.0026, 0.00018, 1.45),
                    taper(n, 0.0026, 0.00018, 1.45)))
    m = sweep(p, prof, segs=14, cap_end=False, material=M_TELSON,
              noise=0.015, seed=81)
    return [m]


# =====================================================================
#  RIG
# =====================================================================
def add(name, parts, t=(0, 0, 0), r=q_id(), parent=None):
    for p in parts:
        p.compute_normals()
    mi = g.add_mesh(name, parts) if parts else None
    return g.add_node(name, t, r, mesh=mi, parent=parent)


N = {}   # name -> node index

root = g.add_node("scorpion_root", (0, 0, 0))
body = g.add_node("body", (0, BODY_Y, 0), parent=root)
N['body'] = body

prosoma = add("prosoma", make_carapace(), parent=body)
N['prosoma'] = prosoma

# --- chelicerae -------------------------------------------------------
for s, tag in ((1, 'L'), (-1, 'R')):
    n = add("chelicera_%s" % tag, make_chelicera(s),
            t=(0.0185, 0.0020, -s * 0.0034),
            r=qy(s * 0.18), parent=prosoma)
    N['chel_' + tag] = n

# --- pedipalps --------------------------------------------------------
PP_FEMUR, PP_PATELLA = 0.0215, 0.0225
for s, tag in ((1, 'L'), (-1, 'R')):
    coxa = add("pedipalp_coxa_%s" % tag, [],
               t=(0.0158, -0.0014, -s * 0.0082), parent=prosoma)
    fem = add("pedipalp_femur_%s" % tag, make_pedipalp_femur(PP_FEMUR),
              t=(0.0, 0.0, 0.0), parent=coxa)
    pat = add("pedipalp_patella_%s" % tag, make_pedipalp_patella(PP_PATELLA),
              t=(PP_FEMUR, 0.0, 0.0), parent=fem)
    che = add("chela_%s" % tag, make_chela(s),
              t=(PP_PATELLA, 0.0, 0.0), parent=pat)
    mov = add("finger_movable_%s" % tag, make_movable_finger(s),
              t=(0.0292 * CHELA_S, 0.0016 * CHELA_S, s * 0.0016 * CHELA_S),
              parent=che)
    N['pp_coxa_' + tag] = coxa
    N['pp_fem_' + tag] = fem
    N['pp_pat_' + tag] = pat
    N['pp_che_' + tag] = che
    N['pp_mov_' + tag] = mov

# --- walking legs -----------------------------------------------------
HIPS = []          # (tag, side, hip_pos, dims, rest_yaw)
HIP_X = [0.0108, 0.0016, -0.0080, -0.0172]
HIP_Z = [0.0084, 0.0098, 0.0100, 0.0092]
REST_YAW = [62.0, 26.0, -14.0, -50.0]      # degrees, outward/forward splay
for i in range(4):
    for s, tag in ((1, 'L'), (-1, 'R')):
        name = "leg_%s%d" % (tag, i + 1)
        dims = leg_dims(i)
        hip = (HIP_X[i], -0.0030, -s * HIP_Z[i])
        r0 = 0.0043 - 0.00022 * (3 - i)
        cx = sweep([(-0.0040, 0.0006, 0.0), (0.0, 0.0, 0.0),
                    (0.0042, -0.0002, 0.0)],
                   [(r0 * 1.35, r0 * 1.25), (r0 * 1.22, r0 * 1.12),
                    (r0 * 1.02, r0 * 0.98)],
                   segs=14, material=M_CHITIN_L, noise=0.04, seed=200 + i)
        tro = sweep([(0.0036, 0.0, 0.0), (0.0062, 0.0, 0.0)],
                    [(r0 * 1.0, r0 * 0.96), (r0 * 0.94, r0 * 0.90)],
                    segs=12, material=M_MEMBRANE)
        for _p in (cx, tro):
            _p.rotate(qy(REST_YAW[i] * D2R * s))   # coxa fixed at its splay
        coxa = add(name + "_coxa", [cx, tro], t=hip, parent=prosoma)
        fem = add(name + "_femur",
                  make_leg_segment(dims[0], r0, r0 * 0.86, bow=0.0006,
                                   seed=100 + i * 4 + (0 if s > 0 else 2),
                                   bristles=2),
                  parent=coxa)
        pat = add(name + "_patella",
                  make_leg_segment(dims[1], r0 * 0.88, r0 * 0.74, bow=0.0004,
                                   seed=140 + i * 4, bristles=2),
                  t=(dims[0], 0, 0), parent=fem)
        tib = add(name + "_tibia",
                  make_leg_segment(dims[2], r0 * 0.74, r0 * 0.58, bow=0.0003,
                                   seed=180 + i * 4, bristles=3),
                  t=(dims[1], 0, 0), parent=pat)
        tar = add(name + "_tarsus", make_tarsus(dims[3], r0 * 0.58),
                  t=(dims[2], 0, 0), parent=tib)
        N[name] = (coxa, fem, pat, tib, tar)
        HIPS.append((name, s, hip, dims, REST_YAW[i] * D2R * s))

# --- pectines ---------------------------------------------------------
for s, tag in ((1, 'L'), (-1, 'R')):
    n = add("pecten_%s" % tag, make_pecten(-s),
            t=(-0.0230, -0.0050, -s * 0.0030),
            r=qy(s * 0.55), parent=prosoma)
    N['pect_' + tag] = n

# --- mesosoma + metasoma + telson ------------------------------------
meso = add("mesosoma", make_mesosoma(), t=(-0.0205, 0.0006, 0.0),
           parent=prosoma)
N['meso'] = meso

META_L = [0.0118, 0.0128, 0.0136, 0.0148, 0.0175]
META_R = [(0.0068, 0.0064), (0.0064, 0.0061), (0.0061, 0.0058),
          (0.0058, 0.0055), (0.0055, 0.0048)]
parent = meso
tx = (-0.0604, 0.0012, 0.0)             # posterior end of the mesosoma
for i in range(5):
    r0, r1 = META_R[i]
    n = add("metasoma_%d" % (i + 1), make_metasomal_segment(i, META_L[i],
                                                            r0, r1),
            t=tx if i == 0 else (META_L[i - 1], 0, 0),
            r=qy(math.pi) if i == 0 else q_id(), parent=parent)
    N['meta%d' % (i + 1)] = n
    parent = n
tel = add("telson_vesicle", make_telson(), t=(META_L[4], 0, 0), parent=parent)
acu = add("aculeus", make_aculeus(), t=(0.0140, -0.0010, 0.0), parent=tel)
N['telson'] = tel
N['aculeus'] = acu


# =====================================================================
#  INVERSE KINEMATICS  (analytic, 4-link planar leg + yaw)
# =====================================================================
def leg_ik(hip, target, dims, knee_up=True):
    """Return (yaw, a_femur, a_patella, a_tibia, a_tarsus) for a foot
    target given in body space."""
    L1, L2, L3, L4 = dims
    dx = target[0] - hip[0]
    dy = target[1] - hip[1]
    dz = target[2] - hip[2]
    yaw = math.atan2(-dz, dx)
    r = math.hypot(dx, dz)

    psi = -1.02          # world pitch of the tibia (down & outward)
    phi = -1.48          # world pitch of the tarsus (nearly vertical)
    wr = r - L3 * math.cos(psi) - L4 * math.cos(phi)
    wy = dy - L3 * math.sin(psi) - L4 * math.sin(phi)

    d = math.hypot(wr, wy)
    d = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, d))
    base = math.atan2(wy, wr)
    ca = (d * d + L1 * L1 - L2 * L2) / (2 * d * L1)
    ca = max(-1.0, min(1.0, ca))
    cb = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)
    cb = max(-1.0, min(1.0, cb))
    sign = 1.0 if knee_up else -1.0
    a1 = base + sign * math.acos(ca)
    a2 = -sign * (math.pi - math.acos(cb))
    a3 = psi - (a1 + a2)
    a4 = phi - psi
    return yaw, a1, a2, a3, a4


def leg_pose(hip, target, dims):
    yaw, a1, a2, a3, a4 = leg_ik(hip, target, dims)
    return {0: q_mul(qy(yaw), qz(a1)), 1: qz(a2), 2: qz(a3), 3: qz(a4)}


# rest foot positions, derived from splay + a natural 78 % reach
REST_FOOT = {}
for name, s, hip, dims, yaw in HIPS:
    reach = 0.84 * sum(dims)
    REST_FOOT[name] = (hip[0] + math.cos(yaw) * reach,
                       -BODY_Y,
                       hip[2] - math.sin(yaw) * reach * (1.0))


def set_rest_pose():
    """Write the natural standing pose into the node bind transforms so the
    model looks correct even with no animation playing."""
    for i in range(5):
        base = q_mul(qy(math.pi), qz(TAIL_REST[i])) if i == 0 \
            else qz(TAIL_REST[i])
        g.nodes[N['meta%d' % (i + 1)]]['rotation'] = list(base)
    g.nodes[N['telson']]['rotation'] = list(qz(TAIL_REST[5]))
    for s, tag in ((1, 'L'), (-1, 'R')):
        p = PP_REST
        g.nodes[N['pp_coxa_' + tag]]['rotation'] = list(
            q_mul(qy(s * p['coxa_yaw']), qz(p['coxa_pitch'])))
        g.nodes[N['pp_fem_' + tag]]['rotation'] = list(qz(p['fem_pitch']))
        g.nodes[N['pp_pat_' + tag]]['rotation'] = list(
            q_mul(qy(s * p['pat_yaw']), qz(p['pat_pitch'])))
        g.nodes[N['pp_che_' + tag]]['rotation'] = list(
            q_mul(qy(s * p['che_yaw']), qz(p['che_pitch'])))
        g.nodes[N['pp_mov_' + tag]]['rotation'] = list(qy(-s * p['gape']))
    for name, s, hip, dims, yaw in HIPS:
        q = leg_pose(hip, REST_FOOT[name], dims)
        nd = N[name]
        for k in range(4):
            g.nodes[nd[k + 1]]['rotation'] = list(q[k])


# =====================================================================
#  ANIMATION
# =====================================================================
FPS = 30


class Clip:
    def __init__(self, name, duration):
        self.name = name
        self.dur = duration
        self.tracks = {}      # (node, path) -> [(t, value)]

    def key(self, node, path, t, value):
        self.tracks.setdefault((node, path), []).append((t, tuple(value)))

    def emit(self):
        out = []
        for (node, path), kf in self.tracks.items():
            kf.sort(key=lambda k: k[0])
            out.append((node, path, [k[0] for k in kf], [k[1] for k in kf]))
        return out


def pose_tail(clip, t, angles):
    """angles: 5 metasomal pitches + telson pitch (radians, + = curl up)."""
    for i in range(5):
        clip.key(N['meta%d' % (i + 1)], 'rotation', t,
                 q_mul(qy(math.pi), qz(angles[i])) if i == 0
                 else qz(angles[i]))
    clip.key(N['telson'], 'rotation', t, qz(angles[5]))


def pose_pedipalp(clip, t, tag, s, coxa_yaw, coxa_pitch, fem_pitch,
                  pat_yaw, pat_pitch, che_yaw, che_pitch, gape):
    clip.key(N['pp_coxa_' + tag], 'rotation', t,
             q_mul(qy(s * coxa_yaw), qz(coxa_pitch)))
    clip.key(N['pp_fem_' + tag], 'rotation', t, qz(fem_pitch))
    clip.key(N['pp_pat_' + tag], 'rotation', t,
             q_mul(qy(s * pat_yaw), qz(pat_pitch)))
    clip.key(N['pp_che_' + tag], 'rotation', t,
             q_mul(qy(s * che_yaw), qz(che_pitch)))
    clip.key(N['pp_mov_' + tag], 'rotation', t, qy(-s * gape))


# rest/idle constants for the pedipalps (held forward, chelae level)
PP_REST = dict(coxa_yaw=0.86, coxa_pitch=0.30, fem_pitch=0.04,
               pat_yaw=-0.98, pat_pitch=-0.26, che_yaw=0.34,
               che_pitch=0.08, gape=0.10)
TAIL_REST = [1.20, 0.58, 0.50, 0.42, -0.28, -0.55]


def clip_idle():
    c = Clip("Idle", 3.0)
    n = int(c.dur * FPS) + 1
    for f in range(n):
        t = f / float(FPS)
        u = t / c.dur
        br = math.sin(u * TAU)             # slow "breathing"
        c.key(root, 'translation', t, (0, 0, 0))
        c.key(body, 'translation', t,
              (0.0, BODY_Y + 0.0006 * br, 0.0))
        c.key(body, 'rotation', t, qz(0.010 * math.sin(u * TAU + 0.6)))
        tail = [TAIL_REST[i] + 0.05 * math.sin(u * TAU + i * 0.5)
                for i in range(6)]
        pose_tail(c, t, tail)
        for s, tag in ((1, 'L'), (-1, 'R')):
            p = dict(PP_REST)
            p['coxa_yaw'] += 0.05 * math.sin(u * TAU + (0 if s > 0 else 1.7))
            p['pat_pitch'] += 0.04 * math.sin(u * TAU * 2 + s)
            p['gape'] = 0.12 + 0.05 * math.sin(u * TAU + s)
            pose_pedipalp(c, t, tag, s, **p)
        for name, s, hip, dims, yaw in HIPS:
            ft = REST_FOOT[name]
            tgt = (ft[0], ft[1] - 0.0006 * br, ft[2])
            hipw = (hip[0], hip[1], hip[2])
            q = leg_pose(hipw, (tgt[0] - 0.0,
                                tgt[1] - 0.0006 * br, tgt[2]), dims)
            nodes = N[name]
            for k in range(4):
                c.key(nodes[k + 1] if k else nodes[1], 'rotation', t,
                      q[k]) if False else None
            c.key(nodes[1], 'rotation', t, q[0])
            c.key(nodes[2], 'rotation', t, q[1])
            c.key(nodes[3], 'rotation', t, q[2])
            c.key(nodes[4], 'rotation', t, q[3])
    return c


# --- gait --------------------------------------------------------------
# Scorpions use the arachnid alternating-tetrapod gait: legs 1 & 3 of one
# side step together with legs 2 & 4 of the other side, the two sets in
# antiphase.  (Bowerman 1975; Root & Bowerman 1978.)
GAIT_PHASE = {}
for i in range(4):
    for s, tag in ((1, 'L'), (-1, 'R')):
        nm = "leg_%s%d" % (tag, i + 1)
        group_a = (tag == 'L' and i in (0, 2)) or (tag == 'R' and i in (1, 3))
        GAIT_PHASE[nm] = 0.0 if group_a else 0.5

DUTY = 0.62          # fraction of the cycle a leg is on the ground


def foot_at(name, ph, stride, lift):
    """Foot position for phase ph in [0,1): stance = drag backwards,
    swing = lift and reach forward."""
    rest = REST_FOOT[name]
    yaw = [h[4] for h in HIPS if h[0] == name][0]
    fwd = (math.cos(yaw), 0.0, -math.sin(yaw))
    # step direction is body-forward (+X), not along the leg axis
    dirv = (1.0, 0.0, 0.0)
    if ph < DUTY:
        u = ph / DUTY
        off = lerp(0.5, -0.5, u)
        y = 0.0
    else:
        u = (ph - DUTY) / (1.0 - DUTY)
        off = lerp(-0.5, 0.5, smoothstep(u))
        y = lift * math.sin(math.pi * u) ** 0.85
    return (rest[0] + dirv[0] * off * stride,
            rest[1] + y,
            rest[2] + dirv[2] * off * stride)


def clip_walk(name="Walk", dur=1.0, stride=0.020, lift=0.009, speed_bob=1.0,
              travel=False):
    c = Clip(name, dur)
    n = int(dur * FPS) + 1
    for f in range(n):
        t = f / float(FPS)
        u = (t / dur) % 1.0
        # body oscillates twice per cycle (two tetrapod steps)
        c.key(body, 'translation', t,
              (0.0,
               BODY_Y + speed_bob * 0.0011 * math.sin(2 * TAU * u + 0.4),
               speed_bob * 0.0012 * math.sin(TAU * u)))
        c.key(body, 'rotation', t,
              q_mul(qy(speed_bob * 0.028 * math.sin(TAU * u)),
                    q_mul(qx(speed_bob * 0.035 * math.sin(TAU * u + 1.2)),
                          qz(speed_bob * 0.012 *
                             math.sin(2 * TAU * u)))))
        if travel:
            c.key(root, 'translation', t, (stride * (t / dur) * 2.0, 0, 0))
        # tail counter-sways, held arched
        tail = [TAIL_REST[i] + 0.06 * math.sin(TAU * u + i * 0.6)
                for i in range(6)]
        tail[0] += 0.05 * math.sin(2 * TAU * u)
        pose_tail(c, t, tail)
        for i in range(5):
            nd = N['meta%d' % (i + 1)]
            q = qy(0.055 * math.sin(TAU * u + i * 0.55))
            base = q_mul(qy(math.pi), qz(tail[i])) if i == 0 else qz(tail[i])
            c.key(nd, 'rotation', t, q_mul(base, q))
        # pedipalps held out front, bobbing, chelae slightly open
        for s, tag in ((1, 'L'), (-1, 'R')):
            p = dict(PP_REST)
            ps = 0.0 if s > 0 else 0.5
            p['coxa_yaw'] += 0.07 * math.sin(TAU * (u + ps))
            p['coxa_pitch'] += 0.05 * math.sin(TAU * (u + ps) + 1.0)
            p['pat_yaw'] += 0.06 * math.sin(TAU * (u + ps) + 2.0)
            p['gape'] = 0.16 + 0.06 * math.sin(TAU * (u + ps))
            pose_pedipalp(c, t, tag, s, **p)
        # pectines sweep the substrate
        for s, tag in ((1, 'L'), (-1, 'R')):
            c.key(N['pect_' + tag], 'rotation', t,
                  q_mul(qy(s * (0.55 + 0.22 * math.sin(TAU * u + s))),
                        qz(0.10 * math.sin(TAU * u * 2))))
        for nm, s, hip, dims, yaw in HIPS:
            ph = (u + GAIT_PHASE[nm]) % 1.0
            tgt = foot_at(nm, ph, stride, lift)
            q = leg_pose(hip, tgt, dims)
            nd = N[nm]
            for k in range(4):
                c.key(nd[k + 1], 'rotation', t, q[k])
    return c


def clip_attack():
    """Pedipalp seizure followed by the over-the-carapace sting.

    Timing follows high-speed footage of buthid/scorpionid strikes:
    grab with the chelae (~120 ms), telson arrives ~150-250 ms later,
    jab, hold, then withdraw.
    """
    dur = 1.90
    c = Clip("Attack", dur)
    n = int(dur * FPS) + 1

    def seg(t, a, b):
        return max(0.0, min(1.0, (t - a) / (b - a)))

    for f in range(n):
        t = f / float(FPS)
        crouch = smoothstep(seg(t, 0.00, 0.18)) - smoothstep(seg(t, 0.55, 0.9))
        lunge = smoothstep(seg(t, 0.18, 0.38)) - smoothstep(seg(t, 0.95, 1.5))
        grab = smoothstep(seg(t, 0.30, 0.40)) - smoothstep(seg(t, 1.25, 1.6))
        cock = smoothstep(seg(t, 0.15, 0.42))
        strike = smoothstep(seg(t, 0.42, 0.60))
        jab = math.sin(math.pi * seg(t, 0.58, 0.72)) if 0.58 < t < 0.72 else 0.0
        hold = smoothstep(seg(t, 0.55, 0.65)) - smoothstep(seg(t, 1.05, 1.55))

        body_dx = -0.004 * crouch + 0.012 * lunge
        body_dy = -0.004 * crouch + 0.0035 * lunge
        c.key(body, 'translation', t,
              (body_dx, BODY_Y + body_dy, 0.0))
        c.key(body, 'rotation', t,
              qz(0.10 * crouch - 0.16 * lunge + 0.05 * hold))

        # --- metasoma: rest arch -> cocked -> whipped forward over head
        # cumulative curl from the tail base; ~128 deg at rest, ~200 deg
        # at full extension, which puts the aculeus forward-and-down over
        # the anterior mesosoma -- the geometry of a real scorpion strike.
        cocked = [1.05, 0.50, 0.42, 0.26, -0.62, -0.70]
        struck = [2.12, 0.40, 0.30, 0.24, 0.18, 0.34]
        tail = []
        for i in range(6):
            a = lerp(TAIL_REST[i], cocked[i], cock)
            a = lerp(a, struck[i], strike)
            a += jab * (0.10 if i < 4 else 0.35)
            a = lerp(a, TAIL_REST[i],
                     smoothstep(seg(t, 1.15, 1.70)))
            tail.append(a)
        for i in range(5):
            base = q_mul(qy(math.pi), qz(tail[i])) if i == 0 else qz(tail[i])
            c.key(N['meta%d' % (i + 1)], 'rotation', t, base)
        c.key(N['telson'], 'rotation', t, qz(tail[5]))

        # --- pedipalps: cock back, thrust, snap shut, hold
        for s, tag in ((1, 'L'), (-1, 'R')):
            p = dict(PP_REST)
            p['coxa_yaw'] = lerp(PP_REST['coxa_yaw'], 0.95, crouch)
            p['coxa_yaw'] = lerp(p['coxa_yaw'], 0.30, lunge)
            p['coxa_pitch'] = lerp(PP_REST['coxa_pitch'], 0.45, crouch)
            p['coxa_pitch'] = lerp(p['coxa_pitch'], -0.05, lunge)
            p['fem_pitch'] = lerp(PP_REST['fem_pitch'], 0.30, crouch)
            p['fem_pitch'] = lerp(p['fem_pitch'], 0.02, lunge)
            p['pat_yaw'] = lerp(PP_REST['pat_yaw'], -1.30, crouch)
            p['pat_yaw'] = lerp(p['pat_yaw'], -0.55, lunge)
            p['che_yaw'] = lerp(PP_REST['che_yaw'], 0.45, crouch)
            p['che_yaw'] = lerp(p['che_yaw'], 0.10, lunge)
            p['che_pitch'] = lerp(PP_REST['che_pitch'], -0.18, lunge)
            gape_open = 0.72 * (crouch * 0.6 + lunge)
            p['gape'] = lerp(PP_REST['gape'] + gape_open, -0.02, grab)
            p['coxa_yaw'] += 0.05 * math.sin(t * 22.0) * hold
            pose_pedipalp(c, t, tag, s, **p)

        # --- legs: crouch, push off, brace forwards
        for nm, s, hip, dims, yaw in HIPS:
            rest = REST_FOOT[nm]
            rear = nm[-1] in '34'
            fx = rest[0] + (0.004 if rear else -0.002) * crouch \
                 + (0.010 if rear else 0.004) * lunge
            fy = rest[1]
            fz = rest[2] * (1.0 + 0.10 * crouch)
            # front legs lift slightly during the strike
            if nm[-1] == '1':
                fy += 0.006 * lunge
                fx += 0.004 * lunge
            tgt = (fx - body_dx, fy - body_dy, fz)
            q = leg_pose(hip, tgt, dims)
            nd = N[nm]
            for k in range(4):
                c.key(nd[k + 1], 'rotation', t, q[k])
    return c


def clip_sting_only():
    dur = 1.10
    c = Clip("Sting", dur)
    n = int(dur * FPS) + 1
    for f in range(n):
        t = f / float(FPS)
        cock = smoothstep(max(0.0, min(1.0, t / 0.30)))
        strike = smoothstep(max(0.0, min(1.0, (t - 0.30) / 0.14)))
        back = smoothstep(max(0.0, min(1.0, (t - 0.62) / 0.45)))
        cocked = [1.02, 0.48, 0.40, 0.24, -0.64, -0.72]
        struck = [2.16, 0.42, 0.32, 0.26, 0.20, 0.38]
        for i in range(6):
            a = lerp(TAIL_REST[i], cocked[i], cock)
            a = lerp(a, struck[i], strike)
            a = lerp(a, TAIL_REST[i], back)
            if i < 5:
                base = q_mul(qy(math.pi), qz(a)) if i == 0 else qz(a)
                c.key(N['meta%d' % (i + 1)], 'rotation', t, base)
            else:
                c.key(N['telson'], 'rotation', t, qz(a))
        c.key(body, 'rotation', t, qz(-0.05 * strike + 0.03 * cock))
    return c


# =====================================================================
#  BAKE
# =====================================================================
def main():
    set_rest_pose()
    clips = [clip_idle(),
             clip_walk("Walk", dur=1.05, stride=0.020, lift=0.0085),
             clip_walk("Run", dur=0.62, stride=0.028, lift=0.012,
                       speed_bob=1.6),
             clip_attack(),
             clip_sting_only()]
    for c in clips:
        g.add_animation(c.name, c.emit())

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "model", "scorpion.glb")
    out = os.path.normpath(out)
    size = g.save_glb(out)

    tris = sum(len(p["indices"] and []) for m in g.meshes for p in
               m["primitives"])
    ntri = 0
    for m in g.meshes:
        for p in m["primitives"]:
            ntri += g.accessors[p["indices"]]["count"] // 3
    nvert = 0
    for m in g.meshes:
        for p in m["primitives"]:
            nvert += g.accessors[p["attributes"]["POSITION"]]["count"]
    print("wrote %s" % out)
    print("  %d nodes, %d meshes, %d primitives"
          % (len(g.nodes), len(g.meshes),
             sum(len(m["primitives"]) for m in g.meshes)))
    print("  %d triangles, %d vertices" % (ntri, nvert))
    print("  %d animations: %s" % (len(g.animations),
                                   ", ".join(a["name"] for a in
                                             g.animations)))
    print("  %.2f MB" % (size / 1048576.0))


if __name__ == "__main__":
    main()

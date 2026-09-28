#!/usr/bin/env python3
"""Build a rigged, procedural scorpion as a self-contained glTF 2.0 asset.

Coordinate system: +X is forward, +Y is the animal's left, +Z is up.
The generated asset is deliberately assembled from named anatomical parts rather
than a single blob so the four-pair walking gait and attack can be inspected and
edited in any glTF-capable DCC.
"""
from __future__ import annotations

import json
import math
import os
import struct
from typing import Dict, List, Sequence, Tuple

Vec3 = Tuple[float, float, float]
Quat = Tuple[float, float, float, float]

OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "scorpion.glb")

# ---------------------------- math helpers ----------------------------

def vadd(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])

def vsub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

def vmul(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)

def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

def length(a: Vec3) -> float:
    return math.sqrt(dot(a, a))

def norm(a: Vec3) -> Vec3:
    l = length(a)
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-9 else (1.0, 0.0, 0.0)

def qmul(a: Quat, b: Quat) -> Quat:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)

def qconj(q: Quat) -> Quat:
    return (-q[0], -q[1], -q[2], q[3])

def qnorm(q: Quat) -> Quat:
    l = math.sqrt(sum(x * x for x in q))
    return tuple(x / l for x in q)  # type: ignore

def qaxis(axis: Vec3, angle: float) -> Quat:
    s = math.sin(angle * 0.5)
    c = math.cos(angle * 0.5)
    a = norm(axis)
    return (a[0] * s, a[1] * s, a[2] * s, c)

def qfrom_to(a: Vec3, b: Vec3) -> Quat:
    """Quaternion rotating unit vector a onto unit vector b."""
    aa, bb = norm(a), norm(b)
    c = dot(aa, bb)
    if c < -0.9999:
        axis = cross(aa, (0.0, 0.0, 1.0))
        if length(axis) < 1e-5:
            axis = cross(aa, (0.0, 1.0, 0.0))
        return qaxis(axis, math.pi)
    axis = cross(aa, bb)
    return qnorm((axis[0], axis[1], axis[2], 1.0 + c))

def qbetween(direction: Vec3) -> Quat:
    return qfrom_to((1.0, 0.0, 0.0), direction)

def qoffset(base: Quat, z_turn: float = 0.0, y_turn: float = 0.0, x_turn: float = 0.0) -> Quat:
    # post-multiply: offsets are in the segment's local frame
    q = qaxis((0.0, 0.0, 1.0), z_turn)
    q = qmul(q, qaxis((0.0, 1.0, 0.0), y_turn))
    q = qmul(q, qaxis((1.0, 0.0, 0.0), x_turn))
    return qnorm(qmul(base, q))

# ---------------------------- glTF writer ----------------------------

class GLTF:
    def __init__(self):
        self.nodes: List[dict] = []
        self.meshes: List[dict] = []
        self.materials: List[dict] = []
        self.accessors: List[dict] = []
        self.buffer_views: List[dict] = []
        self.bin = bytearray()
        self.animations: List[dict] = []
        self.material_index: Dict[str, int] = {}
        self.mesh_cache: Dict[str, int] = {}

    def align(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def add_material(self, name: str, color: Sequence[float], roughness=0.42, metallic=0.0, emissive=None):
        if name in self.material_index:
            return self.material_index[name]
        pbr = {"baseColorFactor": list(color), "metallicFactor": metallic, "roughnessFactor": roughness}
        mat = {"name": name, "pbrMetallicRoughness": pbr}
        if emissive:
            mat["emissiveFactor"] = list(emissive)
        i = len(self.materials)
        self.materials.append(mat)
        self.material_index[name] = i
        return i

    def add_accessor(self, values: Sequence[float] | bytes, component_type: int, typ: str, count: int, *, target=None, minv=None, maxv=None):
        self.align()
        offset = len(self.bin)
        if isinstance(values, bytes):
            raw = values
        else:
            if component_type == 5126:
                raw = struct.pack("<" + "f" * len(values), *values)
            elif component_type == 5123:
                raw = struct.pack("<" + "H" * len(values), *values)
            elif component_type == 5125:
                raw = struct.pack("<" + "I" * len(values), *values)
            else:
                raise ValueError(component_type)
        self.bin.extend(raw)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(raw)}
        if target is not None:
            view["target"] = target
        vi = len(self.buffer_views)
        self.buffer_views.append(view)
        sizes = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
        acc = {"bufferView": vi, "componentType": component_type, "count": count, "type": typ}
        if minv is not None:
            acc["min"] = list(minv)
        if maxv is not None:
            acc["max"] = list(maxv)
        ai = len(self.accessors)
        self.accessors.append(acc)
        return ai

    def add_mesh(self, name: str, vertices: List[Vec3], normals: List[Vec3], indices: List[int], material: str):
        key = name
        if key in self.mesh_cache:
            return self.mesh_cache[key]
        flat_v = [x for v in vertices for x in v]
        flat_n = [x for n in normals for x in n]
        pos = self.add_accessor(flat_v, 5126, "VEC3", len(vertices), target=34962,
                                minv=[min(v[i] for v in vertices) for i in range(3)],
                                maxv=[max(v[i] for v in vertices) for i in range(3)])
        nor = self.add_accessor(flat_n, 5126, "VEC3", len(normals), target=34962)
        idx_type = 5123 if len(vertices) < 65536 else 5125
        idx = self.add_accessor(indices, idx_type, "SCALAR", len(indices), target=34963)
        prim = {"attributes": {"POSITION": pos, "NORMAL": nor}, "indices": idx, "material": self.material_index[material]}
        mi = len(self.meshes)
        self.meshes.append({"name": name, "primitives": [prim]})
        self.mesh_cache[key] = mi
        return mi

    def add_node(self, name: str, mesh=None, parent=None, translation=None, rotation=None, scale=None, children=None, extras=None):
        node = {"name": name}
        if mesh is not None:
            node["mesh"] = mesh
        if translation is not None:
            node["translation"] = list(translation)
        if rotation is not None:
            node["rotation"] = list(rotation)
        if scale is not None:
            node["scale"] = list(scale)
        if children:
            node["children"] = list(children)
        if extras:
            node["extras"] = extras
        idx = len(self.nodes)
        self.nodes.append(node)
        if parent is not None:
            self.nodes[parent].setdefault("children", []).append(idx)
        return idx

    def add_animation(self, name: str, duration: float, tracks: List[Tuple[int, str, List[float], List[Sequence[float]], str]]):
        """tracks: node, path, times, values, interpolation."""
        samplers, channels = [], []
        for node, path, times, values, interpolation in tracks:
            ti = self.add_accessor(times, 5126, "SCALAR", len(times))
            flat = [x for v in values for x in v]
            typ = {1: "SCALAR", 3: "VEC3", 4: "VEC4"}[len(values[0])]
            oi = self.add_accessor(flat, 5126, typ, len(values))
            si = len(samplers)
            samplers.append({"input": ti, "output": oi, "interpolation": interpolation})
            channels.append({"sampler": si, "target": {"node": node, "path": path}})
        self.animations.append({"name": name, "samplers": samplers, "channels": channels, "extras": {"duration": duration}})

    def write(self, path: str):
        gltf = {
            "asset": {"version": "2.0", "generator": "Slate Scorpion Builder 1.0"},
            "scene": 0,
            "scenes": [{"name": "Scorpion Studio", "nodes": [0]}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{"byteLength": len(self.bin)}],
            "animations": self.animations,
            "extras": {
                "anatomy": "Scorpiones: prosoma/carapace, seven-segment mesosoma, five-segment metasoma, telson with aculeus, pedipalps and four pairs of walking legs",
                "axis": "+X forward, +Y left, +Z up",
                "gait": "alternate tetrapod; set A = left 1 + left 3 + right 2 + right 4",
                "scale_note": "stylized adult emperor-type proportions; model units are decimeters",
            },
        }
        j = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        while len(j) % 4:
            j += b" "
        b = bytes(self.bin)
        while len(b) % 4:
            b += b"\0"
        header = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(b))
        out = header + struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(b), 0x004E4942) + b
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(out)
        print(f"wrote {path} ({len(out) / 1024:.1f} KiB, {len(self.nodes)} nodes, {len(self.meshes)} meshes, {len(self.animations)} animations)")

# ---------------------------- geometry ----------------------------

def uv_ellipsoid(rx: float, ry: float, rz: float, rings=12, sides=24):
    verts, norms, inds = [], [], []
    for r in range(rings + 1):
        phi = -math.pi / 2 + math.pi * r / rings
        cp, sp = math.cos(phi), math.sin(phi)
        for s in range(sides):
            th = 2 * math.pi * s / sides
            c, si = math.cos(th), math.sin(th)
            # Slightly irregular armor is deterministic but not perfectly machined.
            rr = 1.0 + 0.018 * math.sin(5 * th + 2.7 * phi)
            verts.append((rx * cp * c * rr, ry * cp * si * rr, rz * sp * rr))
            n = norm((cp * c / max(rx, 1e-5), cp * si / max(ry, 1e-5), sp / max(rz, 1e-5)))
            norms.append(n)
    for r in range(rings):
        for s in range(sides):
            a = r * sides + s
            b = r * sides + (s + 1) % sides
            c = (r + 1) * sides + (s + 1) % sides
            d = (r + 1) * sides + s
            inds.extend((a, b, c, a, c, d))
    return verts, norms, inds

def capsule_x(length_: float, r0: float, r1: float, sides=14, rings=6):
    # Low-poly exoskeleton section with rounded shoulders at both ends.
    verts, norms, inds = [], [], []
    xs = [0.0, length_ * 0.08, length_ * 0.22, length_ * 0.5, length_ * 0.78, length_ * 0.92, length_]
    for ri, x in enumerate(xs):
        t = x / max(length_, 1e-5)
        bulge = math.sin(math.pi * t) ** 0.20
        rad = (r0 * (1 - t) + r1 * t) * (0.58 + 0.42 * bulge)
        for s in range(sides):
            th = 2 * math.pi * s / sides
            y, z = rad * math.cos(th), rad * math.sin(th)
            verts.append((x, y, z))
            dx = (r0 - r1) / max(length_, 1e-5)
            norms.append(norm((-dx, math.cos(th), math.sin(th))))
    for r in range(len(xs) - 1):
        for s in range(sides):
            a = r * sides + s
            b = r * sides + (s + 1) % sides
            c = (r + 1) * sides + (s + 1) % sides
            d = (r + 1) * sides + s
            inds.extend((a, d, c, a, c, b))
    # end caps
    for x, rad, flip in ((0.0, r0 * 0.58, -1), (length_, r1 * 0.58, 1)):
        center = len(verts)
        verts.append((x, 0, 0)); norms.append((float(flip), 0, 0))
        start = len(verts)
        for s in range(sides):
            th = 2 * math.pi * s / sides
            verts.append((x, rad * math.cos(th), rad * math.sin(th))); norms.append((float(flip), 0, 0))
        for s in range(sides):
            a = center; b = start + s; c = start + (s + 1) % sides
            inds.extend((a, c, b) if flip < 0 else (a, b, c))
    return verts, norms, inds

def tube_polyline(points: Sequence[Vec3], radii: Sequence[float], sides=10):
    verts, norms, inds = [], [], []
    for i, p in enumerate(points):
        if i == 0:
            tangent = norm(vsub(points[1], p))
        elif i == len(points) - 1:
            tangent = norm(vsub(p, points[i - 1]))
        else:
            tangent = norm(vsub(points[i + 1], points[i - 1]))
        ref = (0.0, 0.0, 1.0) if abs(tangent[2]) < 0.85 else (0.0, 1.0, 0.0)
        side = norm(cross(tangent, ref))
        up = norm(cross(side, tangent))
        for s in range(sides):
            th = 2 * math.pi * s / sides
            off = vadd(vmul(side, math.cos(th) * radii[i]), vmul(up, math.sin(th) * radii[i]))
            verts.append(vadd(p, off))
            norms.append(norm(off))
    for i in range(len(points) - 1):
        for s in range(sides):
            a = i * sides + s; b = i * sides + (s + 1) % sides
            c = (i + 1) * sides + (s + 1) % sides; d = (i + 1) * sides + s
            inds.extend((a, d, c, a, c, b))
    return verts, norms, inds

def cone_x(length_: float, r0: float, r1: float, sides=16):
    verts, norms, inds = [], [], []
    for x, r in ((0.0, r0), (length_, r1)):
        for s in range(sides):
            th = 2 * math.pi * s / sides
            verts.append((x, r * math.cos(th), r * math.sin(th)))
            norms.append(norm(((r0 - r1) / max(length_, 1e-6), math.cos(th), math.sin(th))))
    for s in range(sides):
        a=s; b=(s+1)%sides; c=sides+(s+1)%sides; d=sides+s
        inds.extend((a,d,c,a,c,b))
    verts.extend([(0,0,0),(length_,0,0)])
    norms.extend([(-1,0,0),(1,0,0)])
    for s in range(sides):
        inds.extend((len(verts)-2, (s+1)%sides, s))
        inds.extend((len(verts)-1, sides+s, sides+(s+1)%sides))
    return verts, norms, inds

def add_object(g: GLTF, cache_name: str, geo, material: str, name: str, parent=None, pos=None, rot=None, scale=None, extras=None):
    mesh = g.add_mesh(cache_name, *geo, material)
    return g.add_node(name, mesh=mesh, parent=parent, translation=pos, rotation=rot, scale=scale, extras=extras)

def segment_chain(g: GLTF, name: str, points: Sequence[Vec3], radii: Sequence[float], material: str, parent: int, mesh_prefix: str, detail=12):
    """Create a bone-like hierarchy. Segment meshes point along +X; joints are local."""
    nodes, globals_, lengths = [], [], []
    for i in range(len(points) - 1):
        d = vsub(points[i + 1], points[i]); lengths.append(length(d)); globals_.append(qbetween(d))
    prev = parent
    for i, ln in enumerate(lengths):
        r0 = radii[i] if i < len(radii) else radii[-1]
        r1 = radii[i + 1] if i + 1 < len(radii) else r0 * 0.82
        geo = capsule_x(ln, r0, r1, sides=detail)
        local_q = globals_[i] if i == 0 else qmul(qconj(globals_[i-1]), globals_[i])
        n = add_object(g, f"{mesh_prefix}_{i}", geo, material, f"{name}_{i+1:02d}", parent=prev, pos=points[0] if i == 0 else (lengths[i-1],0,0), rot=local_q)
        nodes.append(n); prev = n
    return {"nodes": nodes, "globals": globals_, "lengths": lengths, "points": list(points)}

def pose_chain_rotations(points: Sequence[Vec3], lengths: Sequence[float]):
    gs = [qbetween(vsub(points[i+1], points[i])) for i in range(len(points)-1)]
    locals_ = []
    for i, q in enumerate(gs):
        locals_.append(q if i == 0 else qmul(qconj(gs[i-1]), q))
    return locals_

def add_joint_sphere(g: GLTF, unit_mesh: int, name: str, pos: Vec3, radius: float, parent=None, material="joint"):
    return g.add_node(name, mesh=unit_mesh, parent=parent, translation=pos, scale=(radius, radius, radius))

# ---------------------------- asset assembly ----------------------------

def build():
    g = GLTF()
    # Materials are intentionally multi-tone: hard sclerites, softer articulating membrane,
    # setae and glossy ocelli read separately under neutral studio lighting.
    g.add_material("carapace_chestnut", (0.075, 0.018, 0.006, 1), 0.32)
    g.add_material("sclerite_umber", (0.14, 0.035, 0.009, 1), 0.38)
    g.add_material("sclerite_highlight", (0.25, 0.072, 0.018, 1), 0.31)
    g.add_material("articular_membrane", (0.19, 0.045, 0.012, 1), 0.52)
    g.add_material("setae", (0.24, 0.105, 0.025, 1), 0.48)
    g.add_material("eye_black", (0.004, 0.002, 0.001, 1), 0.12, metallic=0.18)
    g.add_material("eye_glint", (0.38, 0.20, 0.06, 1), 0.10, metallic=0.35, emissive=(0.025, 0.008, 0.001))
    g.add_material("pectine_amber", (0.34, 0.105, 0.018, 1), 0.4)
    g.add_material("sting_russet", (0.30, 0.055, 0.008, 1), 0.28)
    g.add_material("ground", (0.055, 0.025, 0.012, 1), 0.9)

    root = g.add_node("Scorpion_Root", extras={
        "species_reference": "adult emperor-type scorpion proportions; anatomy follows general Scorpiones morphology",
        "part_counts": {"mesosoma_tergites": 7, "metasoma_segments": 5, "walking_legs": 8, "pedipalps": 2},
    })
    sphere_mesh = g.add_mesh("detail_unit_sphere", *uv_ellipsoid(1,1,1, rings=10, sides=18), "sclerite_highlight")
    dark_sphere_mesh = g.add_mesh("eye_unit_sphere", *uv_ellipsoid(1,1,1, rings=10, sides=18), "eye_black")

    # Prosoma / carapace. The raised rim and median furrow keep the head shield readable.
    add_object(g, "carapace_shell", uv_ellipsoid(1.48, 1.16, 0.47, 18, 32), "carapace_chestnut", "Prosoma_Carapace", root, (1.55,0,1.48), extras={"anatomy": "prosoma / carapace"})
    add_object(g, "carapace_rim", tube_polyline([(2.55,-0.83,1.66),(2.82,0,1.66),(2.55,0.83,1.66)], [0.07,0.09,0.07], 10), "sclerite_highlight", "Carapace_Anterior_Rim", root)
    add_object(g, "carapace_furrow", tube_polyline([(2.48,0,1.92),(1.8,0,1.98),(1.05,0,1.90)], [0.035,0.028,0.02], 8), "sclerite_highlight", "Carapace_Median_Keel", root)

    # Two median eyes and three lateral eyes per side (small, glossy ocelli).
    for side in (-1, 1):
        add_joint_sphere(g, dark_sphere_mesh, f"Median_Eye_{side}", (2.42, side*0.16, 1.88), 0.105, root, "eye_black")
        for j, yy in enumerate((0.52, 0.73, 0.91)):
            add_joint_sphere(g, dark_sphere_mesh, f"Lateral_Eye_{side}_{j+1}", (2.25, side*yy, 1.78 + 0.04*j), 0.065, root, "eye_black")

    # Mesosoma: exactly seven overlapping tergites, with a soft pleural strip between them.
    meso_x = [0.73, 0.18, -0.38, -0.94, -1.50, -2.06, -2.60]
    meso_ry = [1.10, 1.12, 1.08, 1.04, 0.99, 0.92, 0.84]
    meso_rx = [0.53, 0.55, 0.54, 0.53, 0.52, 0.49, 0.44]
    for i, (x, ry, rx) in enumerate(zip(meso_x, meso_ry, meso_rx), 1):
        add_object(g, f"mesosoma_tergite_{i}", uv_ellipsoid(rx, ry, 0.235, 12, 28), "sclerite_umber" if i % 2 else "sclerite_highlight", f"Mesosoma_Tergite_{i:02d}", root, (x,0,1.42), extras={"anatomy": "mesosoma dorsal tergite"})
        # dorsal keel and short lateral keels mimic the raised linear ridges visible on real sclerites
        for y in (-0.58*ry, 0.0, 0.58*ry):
            add_object(g, f"tergite_{i}_keel_{y}", capsule_x(rx*1.30, 0.022 if y else 0.032, 0.016, 7, 3), "sclerite_highlight", f"Tergite_{i:02d}_Keel", root, (x-rx*0.55,y,1.65), qbetween((1,0,0)))
        # visible pleural membrane / spiracle line on both sides
        for side in (-1, 1):
            add_object(g, f"pleural_{i}_{side}", capsule_x(rx*1.0, 0.045, 0.035, 8, 3), "articular_membrane", f"Pleural_Membrane_{i}_{side}", root, (x-rx*0.45,side*(ry*0.92),1.33), qbetween((1,0,0)))
            add_joint_sphere(g, dark_sphere_mesh, f"Spiracle_{i}_{side}", (x,side*(ry*0.98),1.30), 0.035, root, "eye_black")

    # Ventral sternites and paired pectines: comb-like sensory organs under segments 2-4.
    for i, x in enumerate((0.12, -0.40, -0.92), 1):
        add_object(g, f"sternite_{i}", uv_ellipsoid(0.34,0.72,0.075,8,18), "articular_membrane", f"Sternite_{i}", root, (x,0,1.18))
    for side in (-1, 1):
        bar = add_object(g, f"pectine_bar_{side}", capsule_x(0.9,0.055,0.045,8,3), "pectine_amber", f"Pectine_{side}", root, (-0.45,side*0.42,1.08), qbetween((0,side,0)))
        # 11 comb teeth, angled down into the substrate
        for j in range(11):
            x = -0.85 + j*0.08
            add_object(g, f"pectine_tooth_{side}_{j}", cone_x(0.22,0.026,0.006,7), "pectine_amber", f"Pectine_{side}_Tooth_{j+1:02d}", bar, (x+0.45,0,-0.02), qbetween((0,0,-1)))

    # Metasoma and telson. Five true tail segments are connected by visible articulating rings.
    tail_points = [(-2.92,0,1.49), (-3.48,0,1.60), (-4.03,0,1.92), (-4.38,0,2.40), (-4.38,0,2.94), (-4.04,0,3.40)]
    tail_radii = [0.42,0.39,0.35,0.31,0.28,0.25]
    tail = segment_chain(g, "Metasoma", tail_points, tail_radii, "sclerite_umber", root, "metasoma_segment", detail=14)
    for i, p in enumerate(tail_points[:-1], 1):
        add_object(g, f"tail_ring_{i}", uv_ellipsoid(0.12, tail_radii[i-1]*1.07, tail_radii[i-1]*0.62, 8, 16), "articular_membrane", f"Metasoma_Articular_Ring_{i}", root, p, tail["globals"][i-1])
    telson_pos = tail_points[-1]
    # The telson child continues the final metasoma tangent; its bulb is symmetric, so
    # the child rotation stays identity and the aculeus can articulate in that local frame.
    telson = add_object(g, "telson_bulb", uv_ellipsoid(0.42,0.33,0.36,14,22), "sting_russet", "Telson_Venom_Bulb", tail["nodes"][-1], (tail["lengths"][-1],0,0), (0,0,0,1), extras={"anatomy": "telson / venom bulb"})
    stinger_geo = cone_x(0.74,0.14,0.008,18)
    stinger = add_object(g, "aculeus", stinger_geo, "sting_russet", "Aculeus_Stinger", telson, (0.34,0,0), qbetween((0.83,0,-0.55)), extras={"anatomy": "aculeus (sting)"})
    add_object(g, "stinger_groove", tube_polyline([(0.10,0,0.12),(0.54,0,0.07),(0.70,0,0.01)], [0.018,0.012,0.004], 6), "sclerite_highlight", "Aculeus_Groove", stinger)

    # Four pairs of walking legs; each contains coxa, trochanter, femur, patella,
    # tibia, basitarsus, tarsus and two apotele claws.
    leg_info = []
    leg_x = [1.18, 0.48, -0.25, -0.98]
    reach = [0.82, 0.48, -0.30, -0.78]
    for side in (-1, 1):
        side_name = "R" if side == -1 else "L"
        for li, (x, fore) in enumerate(zip(leg_x, reach), 1):
            # Side-specific natural outward sweep; joints stay low and articulated.
            p0 = (x, side*0.78, 1.33)
            p1 = (x+0.10*fore, side*1.02, 1.28)
            p2 = (x+0.24*fore, side*1.30, 1.02)
            p3 = (x+0.55*fore, side*(1.58+0.03*li), 0.72)
            p4 = (x+0.85*fore, side*(1.98+0.06*li), 0.42)
            p5 = (x+1.05*fore, side*(2.31+0.07*li), 0.20)
            p6 = (x+1.14*fore, side*(2.53+0.06*li), 0.18)
            p7 = (x+1.20*fore, side*(2.67+0.06*li), 0.16)
            pts = [p0,p1,p2,p3,p4,p5,p6,p7]
            radii = [0.16,0.13,0.105,0.095,0.072,0.055,0.040,0.022]
            leg = segment_chain(g, f"Leg_{side_name}{li}", pts, radii, "sclerite_umber", root, f"leg_{side_name}{li}", detail=10)
            leg_info.append({"side": side, "idx": li-1, "name": f"{side_name}{li}", "chain": leg})
            for j, p in enumerate(pts[1:-1], 1):
                add_joint_sphere(g, sphere_mesh, f"Leg_{side_name}{li}_Joint_{j}", p, radii[j]*0.9, root, "sclerite_highlight")
            # Paired terminal claws, thin and curved, placed as independent tactile apoteles.
            for claw_side in (-1, 1):
                lateral = side * (0.035 * claw_side)
                claw_pts = [(0,0,0),(0.10, lateral, -0.018),(0.19, lateral*1.3, -0.065)]
                add_object(g, f"leg_{side_name}{li}_claw_{claw_side}", tube_polyline(claw_pts,[0.026,0.018,0.004],7), "sclerite_highlight", f"Leg_{side_name}{li}_Apotele_{claw_side}", leg["nodes"][-1], (leg["lengths"][-1],0,0), leg["globals"][-1])

    # Pedipalps: six articles each, terminating in a large fixed and movable finger.
    pincer_info = []
    for side in (-1, 1):
        sn = "R" if side == -1 else "L"
        p0 = (2.45, side*0.83, 1.57)
        p1 = (2.84, side*1.06, 1.61)
        p2 = (3.32, side*1.35, 1.69)
        p3 = (3.72, side*1.61, 1.70)
        p4 = (4.12, side*1.83, 1.64)
        # coxa, trochanter, femur, patella, then the chela manus wrist.
        chain = segment_chain(g, f"Pedipalp_{sn}", [p0,p1,p2,p3,p4], [0.19,0.16,0.14,0.17,0.22], "sclerite_highlight", root, f"pedipalp_{sn}", detail=14)
        manus_dir = norm((0.84, side*0.22, 0.02))
        manus_q = qbetween(manus_dir)
        manus_len = 0.78
        manus_local_q = qmul(qconj(chain["globals"][-1]), manus_q)
        manus = add_object(g, f"pedipalp_{sn}_manus", capsule_x(manus_len,0.24,0.20,16,6), "sclerite_highlight", f"Pedipalp_{sn}_Chela_Manus", chain["nodes"][-1], (chain["lengths"][-1],0,0), manus_local_q, extras={"anatomy": "pedipalp tibia / chela manus"})
        # fixed finger and movable finger are actual separate articulated children.
        fixed_geo = tube_polyline([(0,0,0),(0.33,side*0.10,-0.01),(0.63,side*0.23,-0.11),(0.82,side*0.17,-0.25)], [0.13,0.105,0.06,0.008], 12)
        move_geo = tube_polyline([(0,0,0),(0.29,-side*0.10,0.02),(0.56,-side*0.24,0.13),(0.77,-side*0.18,0.27)], [0.12,0.095,0.055,0.008], 12)
        fixed = add_object(g, f"fixed_finger_{sn}", fixed_geo, "sclerite_highlight", f"Pedipalp_{sn}_Fixed_Finger", manus, (0.52,side*0.14,0.0), extras={"anatomy": "fixed finger"})
        move = add_object(g, f"movable_finger_{sn}", move_geo, "sclerite_umber", f"Pedipalp_{sn}_Movable_Finger", manus, (0.52,-side*0.14,0.0), extras={"anatomy": "movable finger / tarsus"})
        # Sensory trichobothria: short, evenly distributed hairs on the manus.
        for h in range(7):
            along = 0.12 + h*0.095
            base = (along, side*0.21, 0.16 + 0.025*math.sin(h))
            hair_geo = tube_polyline([(0,0,0),(0.08,0.015*side,0.09),(0.13,0.02*side,0.16)], [0.012,0.008,0.002], 5)
            add_object(g, f"trichobothrium_{sn}_{h}", hair_geo, "setae", f"Pedipalp_{sn}_Trichobothrium_{h+1:02d}", manus, base)
        pincer_info.append({"side": side, "manus": manus, "move": move, "fixed": fixed})

    # Small chelicerae tucked below the anterior shield (not the large pedipalps).
    for side in (-1, 1):
        sn = "R" if side == -1 else "L"
        chel_pts = [(2.72,side*0.31,1.35),(3.02,side*0.42,1.22),(3.18,side*0.46,1.17)]
        segment_chain(g, f"Chelicera_{sn}", chel_pts, [0.08,0.065,0.035], "sclerite_umber", root, f"chelicera_{sn}", detail=9)
        fang = cone_x(0.23,0.04,0.004,10)
        add_object(g, f"chelicera_fang_{sn}", fang, "sting_russet", f"Chelicera_{sn}_Fang", root, (3.18,side*0.46,1.17), qbetween((0.6,side*0.2,-0.75)))

    # ---------------------------- animation tracks ----------------------------
    walk_times = [0.0, 0.25, 0.5, 0.75, 1.0]
    walk_tracks = []
    # Body breathing/bob: subtle, not a cartoon bounce.
    walk_tracks.append((root, "translation", walk_times, [(0,0,0),(0,0,0.045),(0,0,0),(0,0,0.045),(0,0,0)], "LINEAR"))
    for rec in leg_info:
        chain = rec["chain"]
        group_a = ((rec["idx"] + (1 if rec["side"] == -1 else 0)) % 2 == 0)
        for seg_i, node in enumerate(chain["nodes"]):
            base = chain["globals"][seg_i] if seg_i == 0 else qmul(qconj(chain["globals"][seg_i-1]), chain["globals"][seg_i])
            vals = []
            for t in walk_times:
                phase = (t + (0.0 if group_a else 0.5)) % 1.0
                swing = math.sin(2*math.pi*phase)
                lift = max(0.0, math.sin(2*math.pi*phase))
                if seg_i == 0:
                    vals.append(qoffset(base, z_turn=0.035*swing, y_turn=-0.028*lift))
                elif seg_i == 1:
                    vals.append(qoffset(base, z_turn=-0.09*swing, y_turn=0.05*lift))
                elif seg_i == 2:
                    vals.append(qoffset(base, z_turn=0.20*swing, y_turn=-0.23*lift))
                elif seg_i == 3:
                    vals.append(qoffset(base, z_turn=-0.27*swing, y_turn=0.34*lift))
                elif seg_i == 4:
                    vals.append(qoffset(base, z_turn=0.18*swing, y_turn=-0.18*lift))
                elif seg_i == 5:
                    vals.append(qoffset(base, z_turn=-0.10*swing, y_turn=0.12*lift))
                else:
                    vals.append(qoffset(base, z_turn=0.07*swing, y_turn=-0.09*lift))
            walk_tracks.append((node, "rotation", walk_times, vals, "LINEAR"))
    # Gentle tail counter-sway while walking.
    for i, node in enumerate(tail["nodes"]):
        base = tail["globals"][i] if i == 0 else qmul(qconj(tail["globals"][i-1]), tail["globals"][i])
        vals = [qoffset(base, z_turn=0.035*math.sin(2*math.pi*t + i*0.35)) for t in walk_times]
        walk_tracks.append((node, "rotation", walk_times, vals, "LINEAR"))
    # Pincer finger micro-flex during locomotion.
    for p in pincer_info:
        walk_tracks.append((p["move"], "rotation", walk_times, [(0,0,0,1), qaxis((0,0,1),0.06*p["side"]), (0,0,0,1), qaxis((0,0,1),-0.04*p["side"]), (0,0,0,1)], "LINEAR"))
    g.add_animation("Walk_Alternate_Tetrapod", 1.0, walk_tracks)

    # Attack: tail cocks over the dorsum, chelae close, then the aculeus snaps forward.
    attack_times = [0.0, 0.22, 0.42, 0.56, 0.78, 1.12, 1.60]
    attack_tracks = [(root, "translation", attack_times, [(0,0,0),(0,0,0.03),(0,0,0.02),(0,0,0.01),(0,0,0.01),(0,0,0),(0,0,0)], "LINEAR")]
    base_tail_local = []
    for i in range(5):
        base_tail_local.append(tail["globals"][i] if i == 0 else qmul(qconj(tail["globals"][i-1]), tail["globals"][i]))
    cocked_points = [(-2.92,0,1.49),(-3.40,0,1.78),(-3.72,0,2.38),(-3.48,0,3.04),(-2.90,0,3.54),(-2.20,0,3.72)]
    strike_points = [(-2.92,0,1.49),(-3.34,0,1.73),(-3.42,0,2.28),(-3.08,0,2.78),(-2.35,0,3.07),(-1.42,0,3.02)]
    recover_points = [(-2.92,0,1.49),(-3.43,0,1.66),(-3.94,0,1.96),(-4.22,0,2.50),(-4.20,0,3.02),(-3.90,0,3.40)]
    poses = [tail_points, cocked_points, cocked_points, strike_points, strike_points, recover_points, tail_points]
    for i, node in enumerate(tail["nodes"]):
        vals=[]
        for pose in poses:
            local = pose_chain_rotations(pose, tail["lengths"])
            vals.append(local[i])
        attack_tracks.append((node, "rotation", attack_times, vals, "LINEAR"))
    # Telson and sting lead the strike; their local orientation changes as the chain curls.
    telson_base_local = tail["globals"][-1]
    # Telson is parented to final segment, so keep it aligned to the final tangent.
    telson_attack = []
    stinger_attack = []
    for pose in poses:
        gs = [qbetween(vsub(pose[i+1],pose[i])) for i in range(5)]
        last_global = gs[-1]
        telson_attack.append(qmul(qconj(last_global), last_global))  # identity in the final segment frame
        # local sting direction follows the desired forward/downward strike.
        desired = (0.98, 0.0, -0.18 if pose is strike_points else -0.55)
        stinger_attack.append(qbetween(desired))
    # The telson node is aligned with its parent in rest, so leave it stable and animate aculeus.
    attack_tracks.append((stinger, "rotation", attack_times, stinger_attack, "LINEAR"))
    for p in pincer_info:
        move_vals=[]
        fixed_vals=[]
        for t in attack_times:
            if t < 0.42:
                close = 0.0
            elif t < 0.78:
                close = (t-0.42)/0.36
            elif t < 1.12:
                close = 1.0-(t-0.78)/0.34
            else:
                close = 0.0
            move_vals.append(qaxis((0,0,1), -p["side"]*0.72*close))
            fixed_vals.append((0,0,0,1))
        attack_tracks.append((p["move"], "rotation", attack_times, move_vals, "LINEAR"))
        attack_tracks.append((p["fixed"], "rotation", attack_times, fixed_vals, "LINEAR"))
    # Brace the walking legs slightly during the strike, preserving their articulated pose.
    for rec in leg_info:
        chain=rec["chain"]
        for seg_i,node in enumerate(chain["nodes"]):
            base = chain["globals"][seg_i] if seg_i==0 else qmul(qconj(chain["globals"][seg_i-1]),chain["globals"][seg_i])
            vals=[qoffset(base, y_turn=(-0.035 if seg_i in (2,3) else 0.0)*max(0,math.sin(math.pi*t/0.78))) for t in attack_times]
            attack_tracks.append((node,"rotation",attack_times,vals,"LINEAR"))
    g.add_animation("Attack_Chelae_And_Aculeus", 1.60, attack_tracks)

    g.write(OUT)

if __name__ == "__main__":
    build()

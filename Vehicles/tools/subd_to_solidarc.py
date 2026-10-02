#!/usr/bin/env python3
"""Convert the Liger's authored Catmull-Clark body cage to native SolidArc patches.

Unlike the earlier nearest-point station loft, this converter preserves the Blender
cage topology. Every authored quad becomes a bicubic tensor-product patch fitted
to its level-2 Catmull-Clark limit samples. Adjacent patches interpolate the same
four edge samples, so their boundaries are exactly coincident. The authored half
is reflected about the recentered XZ plane.

Run with the bpy Python installed by setup_bpy.sh:
  LD_LIBRARY_PATH=~/.bpystubs ~/.bpyenv/bin/python \
      Vehicles/tools/subd_to_solidarc.py Vehicles/Liger/Source/Liger_named.blend \
      Vehicles/Liger/Liger_Body_CAD.arc
"""
from __future__ import annotations

import math
import os
import sys
from collections import defaultdict

import bpy
from mathutils import Vector

SOURCE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "Vehicles/Liger/Source/Liger_named.blend")
OUTPUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else "Vehicles/Liger/Liger_Body_CAD.arc")
PARTS = (
    ("Body_Main_Shell", "Shell", (0.72, 0.76, 0.82)),
    ("Body_Front_Cowl", "Cowl", (0.58, 0.63, 0.72)),
    ("Body_Roof_Glass_Frame", "Roof", (0.16, 0.22, 0.30)),
)
LEVEL = 2
SCALE = 0.01                         # Blender centimetres -> metres
TARGETS = (0.0, 0.25, 0.75, 1.0)
GRID_COLUMNS = 64


def inverse(a):
    """Small Gauss-Jordan inverse; avoids requiring NumPy in Blender's Python."""
    n = len(a)
    m = [list(map(float, row)) + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1.0e-12:
            raise RuntimeError("singular interpolation matrix")
        m[col], m[pivot] = m[pivot], m[col]
        q = m[col][col]
        m[col] = [v / q for v in m[col]]
        for row in range(n):
            if row == col:
                continue
            q = m[row][col]
            m[row] = [m[row][k] - q * m[col][k] for k in range(2 * n)]
    return [row[n:] for row in m]


def bernstein(t):
    s = 1.0 - t
    return (s * s * s, 3.0 * s * s * t, 3.0 * s * t * t, t * t * t)


B_INV = inverse([bernstein(t) for t in TARGETS])


def mat_fit(samples):
    """C = B^-1 S B^-T for a boundary-compatible 4x4 sample grid."""
    temp = [[Vector((0.0, 0.0, 0.0)) for _ in range(4)] for _ in range(4)]
    control = [[Vector((0.0, 0.0, 0.0)) for _ in range(4)] for _ in range(4)]
    for a in range(4):
        for j in range(4):
            temp[a][j] = sum((samples[i][j] * B_INV[a][i] for i in range(4)), Vector())
    for a in range(4):
        for b in range(4):
            control[a][b] = sum((temp[a][j] * B_INV[b][j] for j in range(4)), Vector())
    return control


def evaluate(control, u, v):
    bu, bv = bernstein(u), bernstein(v)
    return sum((control[a][b] * bu[a] * bv[b] for a in range(4) for b in range(4)), Vector())


def point_text(point, centre_y):
    return f"({point.x * SCALE:.6f},{(point.y - centre_y) * SCALE:.6f},{point.z * SCALE:.6f})"


def patch_line(name, control, centre_y, mirrored=False):
    rows = list(reversed(control)) if mirrored else control
    points = []
    for row in rows:
        for point in row:
            p = point.copy()
            if mirrored:
                p.y = 2.0 * centre_y - p.y
            points.append(point_text(p, centre_y))
    return f"patch 4 4 {' '.join(points)} --degree=3 --name={name}"


def install_face_uv(mesh):
    """Give every source quad a private [0,1]^2 tile that survives subdivision."""
    old = mesh.uv_layers.get("SolidArcFaceParameter")
    if old:
        mesh.uv_layers.remove(old)
    uv = mesh.uv_layers.new(name="SolidArcFaceParameter", do_init=False)
    # Keep non-quad faces out of tile zero; their default UV would otherwise
    # contaminate source face 0 after Catmull-Clark interpolation.
    for datum in uv.data:
        datum.uv = (-1000.0, -1000.0)
    usable = []
    fallback = []
    for face in mesh.polygons:
        if len(face.loop_indices) != 4:
            fallback.append(face.index)
            continue
        tile_x = face.index % GRID_COLUMNS
        tile_y = face.index // GRID_COLUMNS
        corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
        for loop_index, (u, v) in zip(face.loop_indices, corners):
            uv.data[loop_index].uv = (tile_x * 2.0 + u, tile_y * 2.0 + v)
        usable.append(face.index)
    mesh.uv_layers.active = uv
    return usable, fallback


def source_face(uv):
    tile_x = int(math.floor((uv.x + 1.0e-5) / 2.0))
    tile_y = int(math.floor((uv.y + 1.0e-5) / 2.0))
    return tile_y * GRID_COLUMNS + tile_x, uv.x - tile_x * 2.0, uv.y - tile_y * 2.0


def nearest_sample(samples, u, v):
    key = min(samples, key=lambda q: (q[0] - u) ** 2 + (q[1] - v) ** 2)
    if abs(key[0] - u) > 2.0e-3 or abs(key[1] - v) > 2.0e-3:
        raise RuntimeError(f"missing subdivision sample ({u},{v}); nearest is {key[:2]}")
    return key[2]


def fallback_patch(face, obj):
    """A Coons-like bilinear patch for the few triangle/ngon cage faces."""
    points = [obj.matrix_world @ obj.data.vertices[i].co for i in face.vertices]
    if len(points) == 3:
        corners = (points[0], points[1], points[2], points[2])
    else:
        corners = (points[0], points[len(points) // 4], points[len(points) // 2], points[(3 * len(points)) // 4])
    p00, p10, p11, p01 = corners
    return [[p00 * (1-u) * (1-v) + p10 * u * (1-v) + p01 * (1-u) * v + p11 * u * v
             for v in (0.0, 1/3, 2/3, 1.0)] for u in (0.0, 1/3, 2/3, 1.0)]


def convert_part(obj, stem, tint):
    usable, fallback = install_face_uv(obj.data)
    # Keep only the authored half and Catmull-Clark. Mirror is emitted exactly in SolidArc;
    # solidify would destroy the editable exterior skin and mask is an authoring aid.
    for modifier in obj.modifiers:
        modifier.show_viewport = modifier.type == "SUBSURF"
        if modifier.type == "SUBSURF":
            modifier.levels = LEVEL
            modifier.render_levels = LEVEL
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    uv_layer = mesh.uv_layers.get("SolidArcFaceParameter")
    if not uv_layer:
        raise RuntimeError(f"{obj.name}: temporary face parameter did not survive evaluation")

    gathered = defaultdict(dict)
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            loop = mesh.loops[loop_index]
            uv = uv_layer.data[loop_index].uv
            face_index, u, v = source_face(uv)
            if face_index not in usable:
                continue
            # UV values are shared by adjacent evaluated quads; one position per key is enough.
            key = (round(max(0.0, min(1.0, u)), 6), round(max(0.0, min(1.0, v)), 6))
            gathered[face_index][key] = obj.matrix_world @ mesh.vertices[loop.vertex_index].co

    records = []
    worst = 0.0
    worst_face = -1
    square_errors = []
    for face_index in usable:
        entries = [(u, v, point) for (u, v), point in gathered[face_index].items()]
        try:
            samples = [[nearest_sample(entries, u, v) for v in TARGETS] for u in TARGETS]
        except (ValueError, RuntimeError) as refusal:
            raise RuntimeError(f"{obj.name} face {face_index}: {refusal}") from refusal
        control = mat_fit(samples)
        # Validate against every level-2 sample, including the withheld u/v=0.5 row.
        for u, v, point in entries:
            error = (evaluate(control, u, v) - point).length
            if error > worst:
                worst = error
                worst_face = face_index
            square_errors.append(error * error)
        records.append((face_index, control, False))
    for face_index in fallback:
        records.append((face_index, fallback_patch(obj.data.polygons[face_index], obj), True))

    evaluated.to_mesh_clear()
    rms = math.sqrt(sum(square_errors) / max(1, len(square_errors)))
    lines = [f"# {stem}: {len(usable)} bicubic Catmull-Clark patches + {len(fallback)} exceptional fallback patches",
             f"# Fit residual at level-{LEVEL} withheld samples: RMS {rms * SCALE * 1000:.3f} mm, max {worst * SCALE * 1000:.3f} mm"]
    names = []
    for face_index, control, exceptional in records:
        right = f"R_{stem}_{face_index:04d}"
        left = f"L_{stem}_{face_index:04d}"
        suffix = "  # exceptional non-quad cage face" if exceptional else ""
        lines.append(patch_line(right, control, MIRROR_Y, False) + suffix)
        lines.append(patch_line(left, control, MIRROR_Y, True) + suffix)
        names.extend((right, left))
    # Tint in chunks to stay comfortably below console line limits.
    rgb = " ".join(f"{channel:.2f}" for channel in tint)
    for start in range(0, len(names), 100):
        lines.append(f"tint {' '.join(names[start:start+100])} {rgb}")
    lines.append("")
    print(f"{obj.name}: {len(records) * 2} CAD patches, RMS {rms*SCALE*1000:.3f} mm, max {worst*SCALE*1000:.3f} mm (face {worst_face})")
    return lines, len(records) * 2, rms * SCALE, worst * SCALE, names


bpy.ops.wm.open_mainfile(filepath=SOURCE)
# The mirror plane is the common body-part origin in world Y. Recenter it to Y=0.
MIRROR_Y = bpy.data.objects[PARTS[0][0]].matrix_world.translation.y
output = [
    "# SolidArc native document v1",
    "# Liger — topology-preserving CAD rebuild from the authored Blender subdivision cages.",
    "# Units metres, +Z up, +X front, symmetry plane Y=0.",
    "# Every regular cage quad is an editable bicubic B-spline patch; left and right boundaries coincide exactly.",
    "show shading plastic",
    "show cages off",
    "show iso off",
    "",
]
count = 0
metrics = []
sew_groups = []
for object_name, stem, tint in PARTS:
    lines, part_count, rms, worst, names = convert_part(bpy.data.objects[object_name], stem, tint)
    output.extend(lines)
    count += part_count
    metrics.append((object_name, part_count, rms, worst))
    sew_groups.extend(((f"R_Liger_{stem}", names[0::2], tint), (f"L_Liger_{stem}", names[1::2], tint)))
output.append("# Stitch each authored half/part into an oriented B-rep sheet while preserving wheel, cabin and vent openings.")
for body_name, names, tint in sew_groups:
    output.append(f"sew {' '.join(names)} --name={body_name}")
    output.append(f"tint {body_name} {' '.join(f'{channel:.2f}' for channel in tint)}")
output.extend([
    f"# Total: {count} native bicubic faces in six stitched B-rep sheets.",
    "view iso",
    "view fit",
])
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w", encoding="utf-8") as stream:
    stream.write("\n".join(output) + "\n")
with open(os.path.splitext(OUTPUT)[0] + "_metrics.txt", "w", encoding="utf-8") as stream:
    stream.write("Liger topology-preserving CAD rebuild\n")
    stream.write(f"Symmetry plane in source: world Y={MIRROR_Y:.6f} cm; output recentered to Y=0 m\n")
    for name, patches, rms, worst in metrics:
        stream.write(f"{name}: {patches} patches; withheld-sample RMS={rms*1000:.3f} mm; max={worst*1000:.3f} mm\n")
    stream.write(f"Total: {count} patches\n")
print(f"wrote {OUTPUT} ({count} native patches)")

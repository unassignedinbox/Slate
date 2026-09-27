import bpy, sys, os
path = sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=path)
print("=== SCENE:", os.path.basename(path), "===")
print("objects:", len(bpy.data.objects), " meshes:", len(bpy.data.meshes), " armatures:", len(bpy.data.armatures))
print("unit scale:", bpy.context.scene.unit_settings.scale_length, bpy.context.scene.unit_settings.system)
tot_v=0; tot_f=0
rows=[]
for o in bpy.data.objects:
    d = o.dimensions
    mods = [(m.type, getattr(m,'operation','') , (m.object.name if getattr(m,'object',None) else '')) for m in o.modifiers]
    nv = len(o.data.vertices) if o.type=='MESH' else 0
    nf = len(o.data.polygons) if o.type=='MESH' else 0
    tot_v+=nv; tot_f+=nf
    rows.append((o.name, o.type, nv, nf, tuple(round(x,4) for x in d), tuple(round(x,4) for x in o.location), o.parent.name if o.parent else '', mods, o.hide_viewport, o.hide_render, [ms.name for ms in o.material_slots]))
rows.sort(key=lambda r:-r[2])
for r in rows:
    print(f"{r[0]!r:34} {r[1]:9} v={r[2]:7} f={r[3]:7} dim={r[4]} loc={r[5]} parent={r[6]!r} hideV={r[8]} mods={r[7]} mats={r[10]}")
print("TOTAL verts", tot_v, "faces", tot_f)
print("=== MATERIALS ===")
for m in bpy.data.materials: print(" ", m.name)
print("=== IMAGES ===")
for i in bpy.data.images: print("  ", i.name, i.source, i.filepath, "packed" if i.packed_file else "NOTPACKED", i.size[:])
print("=== COLLECTIONS ===")
for c in bpy.data.collections: print("  ", c.name, [o.name for o in c.objects][:20])

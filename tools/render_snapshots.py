import bpy, sys, os, mathutils, glob
indir, outdir = sys.argv[-2], sys.argv[-1]
os.makedirs(outdir, exist_ok=True)

PAL = {
 'shell':((0.88,0.90,0.92,1),0.12,0.28,0),'shellDark':((0.10,0.12,0.15,1),0.5,0.35,0),
 'frame':((0.045,0.05,0.06,1),0.95,0.30,0),'joint':((0.24,0.26,0.30,1),1.0,0.18,0),
 'steel':((0.76,0.80,0.84,1),1.0,0.14,0),'stylet':((0.90,0.93,0.96,1),1.0,0.08,0),
 'eye':((0.02,0.035,0.07,1),0.45,0.06,0),'membrane':((0.60,0.68,0.78,1),0.1,0.10,0),
 'wing':((0.60,0.68,0.78,1),0.1,0.10,0),'scaleBand':((0.03,0.04,0.05,1),0.2,0.55,0),
 'accent':((0.10,0.80,1.0,1),0,0.4,6.0),'accentHot':((1.0,0.42,0.06,1),0,0.4,8.0),
 'fluid':((0.90,0.62,0.16,1),0,0.12,2.0),'vehicle':((0.17,0.20,0.25,1),0.5,0.5,0),
}
def make_mat(key):
    m = bpy.data.materials.new("X_"+key); m.use_nodes=True
    b = m.node_tree.nodes["Principled BSDF"]
    col, metal, rough, emit = PAL[key]
    b.inputs["Base Color"].default_value = col
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = emit
    if key in ('membrane','wing'):
        b.inputs["Alpha"].default_value = 0.38
        m.blend_method='BLEND'; m.show_transparent_back=False
    return m

VIEWS = {"lateral":(1.0,0.05,0.10), "persp":(1.0,0.62,0.52)}

for f in sorted(glob.glob(os.path.join(indir,"*.obj"))):
    base = os.path.splitext(os.path.basename(f))[0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=32
    sc.cycles.use_denoising=False
    sc.render.resolution_x=1500; sc.render.resolution_y=950
    w=bpy.data.worlds.new("W"); sc.world=w; w.use_nodes=True
    bgn=w.node_tree.nodes["Background"]
    bgn.inputs[0].default_value=(0.028,0.037,0.05,1); bgn.inputs[1].default_value=1.0
    for nm,loc,e,sz in [("k",(6,-8,7),4500,6),("fi",(-8,-5,2),1500,8),("r",(2,9,4),2600,8),("u",(0,-1,-7),800,10)]:
        ld=bpy.data.lights.new(nm,'AREA'); ld.energy=e; ld.size=sz
        ob=bpy.data.objects.new(nm,ld); ob.location=loc
        ob.rotation_euler=(mathutils.Vector((0,0,0))-mathutils.Vector(loc)).to_track_quat('-Z','Y').to_euler()
        sc.collection.objects.link(ob)

    bpy.ops.wm.obj_import(filepath=f, forward_axis='NEGATIVE_Z', up_axis='Y')
    meshes=[o for o in sc.objects if o.type=='MESH']
    for o in meshes:
        key = o.name.split('.')[0]
        if key not in PAL: key='shell'
        o.data.materials.clear(); o.data.materials.append(make_mat(key))
        for p in o.data.polygons: p.use_smooth=True

    focus=[o for o in meshes if o.name.split(".")[0]!="vehicle"] or meshes
    mn=mathutils.Vector((1e9,)*3); mx=mathutils.Vector((-1e9,)*3)
    dg=bpy.context.evaluated_depsgraph_get()
    for o in focus:
        mw=o.matrix_world
        for vt in o.data.vertices:
            v=mw @ vt.co
            for i in range(3): mn[i]=min(mn[i],v[i]); mx[i]=max(mx[i],v[i])
    ctr=(mn+mx)/2; size=max(mx-mn)*1.55   # leave the surroundings in shot
    print("FOCUS", base, [o.name for o in focus], "ctr", [round(x,2) for x in ctr], "size", round(size,2))

    cd=bpy.data.cameras.new("C"); cd.type='ORTHO'; cd.ortho_scale=size
    cam=bpy.data.objects.new("C",cd); sc.collection.objects.link(cam); sc.camera=cam
    for vn,d in VIEWS.items():
        dv=mathutils.Vector(d).normalized()
        cam.location=ctr+dv*size*6
        cam.rotation_euler=(-dv).to_track_quat('-Z','Y').to_euler()
        sc.render.filepath=os.path.join(outdir,f"{base}_{vn}.png")
        bpy.ops.render.render(write_still=True); print("R",sc.render.filepath)

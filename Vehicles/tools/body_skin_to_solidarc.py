#!/usr/bin/env python3
"""Build the Liger's primary body shape as one continuous CAD loft.

This is deliberately not a subdivision-cage conversion and not a panel model.
It intersects the evaluated reference body with transverse planes, extracts the
outer radial envelope, fits consistent section curves, and lofts those curves
as one multi-span bicubic NURBS surface in SolidArc.
"""
from __future__ import annotations
import math, os, sys
import bpy
from mathutils import Vector

SOURCE = os.path.abspath(sys.argv[1] if len(sys.argv)>1 else 'Vehicles/Liger/Source/Liger_named.blend')
OUTPUT = os.path.abspath(sys.argv[2] if len(sys.argv)>2 else 'Vehicles/Liger/Liger_Body_Skin.arc')
OBJECT = 'Body_Main_Shell'
SCALE = 0.01
X_STEP = 5.0                    # cm; loft span spacing
ANGLES = 49                    # points per transverse section
ANGLE_A = math.radians(-24.0)  # right lower body edge
ANGLE_B = math.radians(204.0)  # over roof to left lower body edge
CENTRE_Z = 56.0                # radial-envelope origin [cm]
MARGIN = 1.0                   # avoid unstable zero-area extreme sections [cm]


def cross(a,b): return a[0]*b[1]-a[1]*b[0]

def ray_segment(theta, a, b):
    """Distance r where centre+r*d intersects yz segment a..b, or None."""
    d=(math.cos(theta),math.sin(theta)); e=(b[0]-a[0],b[1]-a[1]); q=(a[0],a[1]-CENTRE_Z)
    den=cross(d,e)
    if abs(den)<1e-10:return None
    r=cross(q,e)/den; t=cross(q,d)/den
    return r if r>=0 and -1e-7<=t<=1+1e-7 else None

def plane_segments(vertices, triangles, x):
    out=[]
    for ia,ib,ic in triangles:
        tri=(vertices[ia],vertices[ib],vertices[ic]); hits=[]
        for p,q in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
            dp=p.x-x; dq=q.x-x
            if abs(dp)<1e-9: hits.append((p.y,p.z))
            if dp*dq<0:
                t=dp/(dp-dq); hits.append((p.y+(q.y-p.y)*t,p.z+(q.z-p.z)*t))
        unique=[]
        for h in hits:
            if not any((h[0]-u[0])**2+(h[1]-u[1])**2<1e-10 for u in unique):unique.append(h)
        if len(unique)>=2:out.append((unique[0],unique[1]))
    return out

def section(vertices,triangles,x):
    segs=plane_segments(vertices,triangles,x)
    # First locate the actual connected exterior arc that passes over the roof.
    # Its angular ends naturally rise around wheel openings, so the loft boundary
    # follows the wheel arches rather than bridging them with a flat sill.
    scan_n=181; scan_a=math.radians(-55); scan_b=math.radians(235)
    scan=[]
    for j in range(scan_n):
        theta=scan_a+(scan_b-scan_a)*j/(scan_n-1)
        hits=[r for a,b in segs if (r:=ray_segment(theta,a,b)) is not None]
        scan.append(max(hits) if hits else None)
    centre=min(range(scan_n),key=lambda j:abs((scan_a+(scan_b-scan_a)*j/(scan_n-1))-math.pi/2))
    if scan[centre] is None:return None
    lo=hi=centre
    # Permit isolated one-sample numerical gaps, but stop at a real opening.
    while lo>0 and (scan[lo-1] is not None or (lo>1 and scan[lo-2] is not None)):lo-=1
    while hi+1<scan_n and (scan[hi+1] is not None or (hi+2<scan_n and scan[hi+2] is not None)):hi+=1
    valid=[j for j in range(lo,hi+1) if scan[j] is not None]
    if len(valid)<ANGLES//2:return None
    theta_lo=scan_a+(scan_b-scan_a)*valid[0]/(scan_n-1)
    theta_hi=scan_a+(scan_b-scan_a)*valid[-1]/(scan_n-1)
    pts=[]
    for j in range(ANGLES):
        theta=theta_lo+(theta_hi-theta_lo)*j/(ANGLES-1)
        q=(theta-scan_a)/(scan_b-scan_a)*(scan_n-1)
        a=max((k for k in valid if k<=q),default=valid[0]); b=min((k for k in valid if k>=q),default=valid[-1])
        r=scan[a] if a==b else scan[a]+(scan[b]-scan[a])*(q-a)/(b-a)
        pts.append((x,r*math.cos(theta),CENTRE_Z+r*math.sin(theta)))
    return pts

def fmt(p):return f'({p[0]*SCALE:.6f},{p[1]*SCALE:.6f},{p[2]*SCALE:.6f})'

bpy.ops.wm.open_mainfile(filepath=SOURCE)
o=bpy.data.objects[OBJECT]
for md in o.modifiers:
    md.show_viewport=md.type in ('MIRROR','SUBSURF')
    if md.type=='SUBSURF':md.levels=2;md.render_levels=2
bpy.context.view_layer.update(); dg=bpy.context.evaluated_depsgraph_get(); oe=o.evaluated_get(dg); me=oe.to_mesh()
centre_y=o.matrix_world.translation.y
vertices=[o.matrix_world@v.co for v in me.vertices]
for p in vertices:p.y-=centre_y
triangles=[]
for poly in me.polygons:
    vs=list(poly.vertices)
    for i in range(1,len(vs)-1):triangles.append((vs[0],vs[i],vs[i+1]))
xmin=min(v.x for v in vertices)+MARGIN; xmax=max(v.x for v in vertices)-MARGIN
count=max(2,round((xmax-xmin)/X_STEP)+1)
xs=[xmin+(xmax-xmin)*i/(count-1) for i in range(count)]
sections=[]
for x in xs:
    s=section(vertices,triangles,x)
    if s:sections.append((x,s))
oe.to_mesh_clear()
if len(sections)<4:raise RuntimeError('not enough valid transverse sections')

# Fair the sampled envelope longitudinally. Raw triangle/plane intersections jump
# between tiny vents and crease faces; those are later panel details, not the
# primary body shape requested here. A repeated cubic binomial filter removes
# those high-frequency jumps while retaining the roof, haunches and nose profile.
for _ in range(4):
    fair=[]
    for i,(x,pts) in enumerate(sections):
        smoothed=[]
        for j,p in enumerate(pts):
            acc=[0.0,0.0,0.0]; total=0.0
            for offset,weight in ((-2,1),(-1,4),(0,6),(1,4),(2,1)):
                k=max(0,min(len(sections)-1,i+offset)); q=sections[k][1][j]
                for axis in range(3):acc[axis]+=weight*q[axis]
                total+=weight
            smoothed.append((x,acc[1]/total,acc[2]/total))
        fair.append((x,smoothed))
    sections=fair

out=['# SolidArc native document v1',
     '# Liger primary body shape — one continuous multi-span NURBS skin.',
     '# Derived from transverse intersections of the evaluated reference; not from subdivision face conversion.',
     '# Units metres, +Z up, +X front, symmetry plane Y=0.',
     'show shading plastic','show cages off','show iso off','']
names=[]
for i,(x,pts) in enumerate(sections):
    name=f'BodySection_{i:03d}'; names.append(name)
    # The envelope samples are used as bounded cubic control poles. This avoids
    # the oscillation of a 49-point global interpolation while retaining the
    # common knot vector needed for a compact 49xN tensor-product surface.
    out.append(f"cpcurve {' '.join(fmt(p) for p in pts)} --degree=3 --name={name}")
out += ['',f"loft {' '.join(names)} --degree=3 --sheet --no-align --name=Liger_Body_Skin",
        f"delete {' '.join(names)}",'tint Liger_Body_Skin 0.72 0.76 0.82','view iso','view fit','']
os.makedirs(os.path.dirname(OUTPUT),exist_ok=True)
open(OUTPUT,'w').write('\n'.join(out))
open(os.path.splitext(OUTPUT)[0]+'_metrics.txt','w').write(
    f'Liger continuous CAD body skin\nsections={len(sections)}\npoints_per_section={ANGLES}\n'
    f'x_range_cm={sections[0][0]:.3f}..{sections[-1][0]:.3f}\nspan_spacing_cm~={(sections[-1][0]-sections[0][0])/(len(sections)-1):.3f}\n'
    'result=one degree-3 x degree-3 multi-span NURBS sheet\n')
print(f'wrote {OUTPUT}: {len(sections)} sections x {ANGLES} points -> one NURBS skin')

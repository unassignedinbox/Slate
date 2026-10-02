#!/usr/bin/env python3
"""Pack topology-preserving per-face Liger CAD patches into larger NURBS surfaces.

Regular Catmull-Clark quad regions are unfolded into integer grids.  Rectangular
face packs are represented by one clamped-uniform bicubic NURBS surface fitted
to the already validated per-face limit patches.  Packs are recursively split
until their maximum sampled deviation is below TOLERANCE.  Extraordinary,
non-quad and boundary regions retain the validated small patches.
"""
from __future__ import annotations
import os,re,sys,math
from pathlib import Path
from collections import defaultdict,deque
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
BLEND=ROOT/'Liger/Source/Liger_named.blend'; SOURCE=ROOT/'Liger/Liger_Body_CAD.arc'; OUTPUT=ROOT/'Liger/Liger_Body_ExteriorPacked.arc'
TOL=0.00075 # 0.75 mm maximum sampled departure from validated CAD reference
SAMPLE_PER_FACE=5
PARTS=[('Body_Main_Shell','Shell',(0.72,0.76,0.82)),('Body_Front_Cowl','Cowl',(0.58,0.63,0.72)),('Body_Roof_Glass_Frame','Roof',(0.16,0.22,0.30))]
pat=re.compile(r'^patch 4 4 (.*?) --degree=3 --name=R_(Shell|Cowl|Roof)_(\d+)(?:\s+#.*)?$')
pt=re.compile(r'\(([-+0-9.eE]+),([-+0-9.eE]+),([-+0-9.eE]+)\)')
controls={}; original={}
for line in SOURCE.read_text().splitlines():
 m=pat.match(line)
 if not m: continue
 p=np.array([[float(a),float(b),float(c)] for a,b,c in pt.findall(m.group(1))]).reshape(4,4,3)
 key=(m.group(2),int(m.group(3)));controls[key]=p;original[key]=line

def bern(t):
 t=np.asarray(t);s=1-t
 return np.stack((s**3,3*s*s*t,3*s*t*t,t**3),axis=-1)
def bez(ctrl,u,v): return np.einsum('...i,...j,ijc->...c',bern(u),bern(v),ctrl)
def knots(count,degree=3):
 interior=count-degree-1
 return np.array([0.]*(degree+1)+[i/(interior+1) for i in range(1,interior+1)]+[1.]*(degree+1))
def basis(ts,count,degree=3):
 K=knots(count,degree);ts=np.asarray(ts);N=np.zeros((len(ts),count))
 for i in range(count): N[:,i]=((ts>=K[i])&(ts<K[i+1]))
 N[ts==1,-1]=1
 for p in range(1,degree+1):
  Q=np.zeros_like(N)
  for i in range(count):
   if K[i+p]>K[i]:Q[:,i]+=(ts-K[i])/(K[i+p]-K[i])*N[:,i]
   if i+1<count and K[i+p+1]>K[i+1]:Q[:,i]+=(K[i+p+1]-ts)/(K[i+p+1]-K[i+1])*N[:,i+1]
  N=Q
 return N
SQ=[(0,0),(1,0),(1,1),(0,1)]
def rotations():
 # Blender source faces are not guaranteed to share one winding convention, so
 # include the four rotations and their reflected forms.  Shared vertices and
 # the non-overlap test select the unique adjacent grid cell.
 out=[]
 for reflected in (False,True):
  for k in range(4):
   def rot(p,k=k,reflected=reflected):
    x,y=p
    if reflected:y=-y
    for _ in range(k):x,y=-y,x
    return (x,y)
   out.append([rot(p) for p in SQ])
 return out
ROTS=rotations()
def topology(obj,stem):
 me=obj.data;vf=defaultdict(int);edgefaces=defaultdict(list)
 for e in me.edges:
  for v in e.vertices:vf[v]+=1
 for f in me.polygons:
  for e in f.edge_keys:edgefaces[tuple(sorted(e))].append(f.index)
 eligible={f.index for f in me.polygons if len(f.vertices)==4 and (stem,f.index) in controls}
 maps={};components=[]
 for root in sorted(eligible):
  if root in maps:continue
  rv=list(me.polygons[root].vertices);maps[root]={v:SQ[i] for i,v in enumerate(rv)};comp=[];q=deque([root])
  while q:
   fi=q.popleft();comp.append(fi);f=me.polygons[fi];fm=maps[fi]
   for a,b in f.edge_keys:
    e=tuple(sorted((a,b))); fs=edgefaces[e]
    if len(fs)!=2 or vf[a]!=4 or vf[b]!=4:continue
    ni=fs[0] if fs[1]==fi else fs[1]
    if ni not in eligible:continue
    nv=list(me.polygons[ni].vertices);ia,ib=nv.index(a),nv.index(b);candidate=None
    for shape in ROTS:
     dx=fm[a][0]-shape[ia][0];dy=fm[a][1]-shape[ia][1]
     mm={v:(shape[k][0]+dx,shape[k][1]+dy) for k,v in enumerate(nv)}
     if mm[b]==fm[b] and set(mm.values())!=set(fm.values()):candidate=mm;break
    if candidate is None:continue
    if ni in maps:
     continue
    maps[ni]=candidate;q.append(ni)
  components.append(comp)
 return maps,components

def face_cell(mm):
 xs=[p[0] for p in mm.values()];ys=[p[1] for p in mm.values()];return min(xs),min(ys)
def rectangles(cells):
 remaining=set(cells);out=[]
 while remaining:
  best=None
  # largest full rectangle anchored at each remaining cell
  for x0,y0 in list(remaining):
   maxw=0
   while (x0+maxw,y0) in remaining:maxw+=1
   w=maxw;h=0
   while w:
    row=0
    while row<w and (x0+row,y0+h) in remaining:row+=1
    w=min(w,row)
    if not w:break
    h+=1
    cand=(w*h,w,h,x0,y0)
    if best is None or cand>best:best=cand
  _,w,h,x,y=best;rect={(i,j) for i in range(x,x+w) for j in range(y,y+h)}
  remaining-=rect;out.append((x,y,w,h))
 return out

def local_uv(mm,verts,gx,gy):
 # affine map from source local square to unfolded grid
 p0=np.array(mm[verts[0]],float);p1=np.array(mm[verts[1]],float);p3=np.array(mm[verts[3]],float)
 A=np.column_stack((p1-p0,p3-p0));return np.linalg.solve(A,np.array([gx,gy])-p0)
def fit_rect(rect,cellface,maps,obj,stem):
 x0,y0,w,h=rect;nu,nv=w+3,h+3
 us=np.linspace(0,w,w*SAMPLE_PER_FACE+1);vs=np.linspace(0,h,h*SAMPLE_PER_FACE+1)
 S=np.zeros((len(us),len(vs),3))
 for iu,u in enumerate(us):
  for iv,v in enumerate(vs):
   cx=x0+min(w-1,int(math.floor(u-1e-10 if u==w else u)));cy=y0+min(h-1,int(math.floor(v-1e-10 if v==h else v)))
   fi=cellface[(cx,cy)];f=obj.data.polygons[fi];lu,lv=local_uv(maps[fi],list(f.vertices),x0+u,y0+v)
   S[iu,iv]=bez(controls[(stem,fi)],lu,lv)
 Bu=basis(us/w,nu);Bv=basis(vs/h,nv)
 C=np.einsum('ai,ijc,bj->abc',np.linalg.pinv(Bu),S,np.linalg.pinv(Bv))
 pred=np.einsum('ia,jb,abc->ijc',Bu,Bv,C);err=np.linalg.norm(pred-S,axis=2)
 return C,float(np.sqrt(np.mean(err*err))),float(err.max())
def split_fit(rect,cellface,maps,obj,stem):
 C,rms,mx=fit_rect(rect,cellface,maps,obj,stem);x,y,w,h=rect
 if mx<=TOL or w*h==1:return [(rect,C,rms,mx)]
 if w>=h and w>1:
  a=w//2;parts=[(x,y,a,h),(x+a,y,w-a,h)]
 else:
  a=h//2;parts=[(x,y,w,a),(x,y+a,w,h-a)]
 return sum((split_fit(r,cellface,maps,obj,stem) for r in parts),[])
def fmt(p):return f'({p[0]:.6f},{p[1]:.6f},{p[2]:.6f})'
def patchline(name,C,mirror=False):
 Q=C[::-1].copy() if mirror else C.copy()
 if mirror:Q[:,:,1]*=-1
 return f'patch {len(Q)} {len(Q[0])} '+ ' '.join(fmt(p) for row in Q for p in row)+f' --degree=3 --name={name}'

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
out=['# SolidArc native document v1','# Liger exterior — packed bicubic CAD conversion of evaluated Catmull-Clark limit surfaces.','# Regular quad grids become larger NURBS surfaces; exceptional topology remains locally patched.','# Units metres, +Z up, +X front, symmetry plane Y=0.','show shading plastic','show cages off','show iso off','']
metrics=[]
for oname,stem,tint in PARTS:
 obj=bpy.data.objects[oname];maps,comps=topology(obj,stem);assigned=set();packs=[]
 print(stem,'topology components',len(comps),'largest',sorted((len(c) for c in comps),reverse=True)[:10])
 for comp in comps:
  bycell={face_cell(maps[f]):f for f in comp}
  # Wrapped components can revisit a grid coordinate around a topological loop.
  # Keep one collision-free chart here; colliding faces remain validated locals.
  for rect in rectangles(bycell):
   for rec in split_fit(rect,bycell,maps,obj,stem):packs.append(rec)
   x,y,w,h=rect;assigned|={bycell[(i,j)] for i in range(x,x+w) for j in range(y,y+h)}
 names=[];errs=[];k=0
 for rect,C,rms,mx in packs:
  x,y,w,h=rect
  n=f'{stem}_Pack_{k:04d}';k+=1;names.extend(('R_'+n,'L_'+n));out += [patchline('R_'+n,C),patchline('L_'+n,C,True)];errs.append((rms,mx,w*h))
 # Non-quad, irregular and any unsafe/unfoldable regular faces stay as validated local CAD patches.
 leftovers=sorted(fi for (s,fi) in controls if s==stem and fi not in assigned)
 for fi in leftovers:
  C=controls[(stem,fi)];n=f'{stem}_Local_{fi:04d}';names.extend(('R_'+n,'L_'+n));out += [patchline('R_'+n,C),patchline('L_'+n,C,True)]
 rgb=' '.join(f'{c:.2f}' for c in tint)
 for i in range(0,len(names),100):out.append(f'tint {" ".join(names[i:i+100])} {rgb}')
 out.append('')
 rms=math.sqrt(sum(r*r*a for r,m,a in errs)/max(1,sum(a for r,m,a in errs)));mx=max((m for r,m,a in errs),default=0)
 metrics.append((stem,len(packs),len(leftovers),sum(a for r,m,a in errs),rms,mx));print(stem,metrics[-1])
out += ['view iso','view fit','']
OUTPUT.write_text('\n'.join(out)+'\n')
(Path(str(OUTPUT).replace('.arc','_metrics.txt'))).write_text('\n'.join(f'{s}: packed surfaces={p}; local surfaces={l}; packed source faces={a}; fit RMS={r*1000:.4f} mm; max={m*1000:.4f} mm' for s,p,l,a,r,m in metrics)+'\n')
print('wrote',OUTPUT)

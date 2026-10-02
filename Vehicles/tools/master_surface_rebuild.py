#!/usr/bin/env python3
"""Start the Liger's proper curve-driven CAD reconstruction.

Outputs:
  Liger_Body_MasterCurves.arc     cleaned primary design/construction network
  Liger_Body_PrimarySurfaces.arc first accepted curve-bounded upper surfaces

No subdivision faces are emitted. Every surface is a loft whose first and last
sections are named extracted design curves. Intermediate rails are fitted to the
reference solely to carry compound curvature.
"""
from __future__ import annotations
import json,sys
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from scipy.signal import savgol_filter

ROOT=Path(__file__).resolve().parents[1];CAR=sys.argv[1] if len(sys.argv)>1 else 'Liger';OUT=ROOT/CAR;SRC=OUT/'Source'
S=.01;N=32;RAIL_COUNT=7
D=json.load(open(SRC/'curves.json'));C=D['curves'];yc=float(D['mirror_offset_applied'])
M=np.load(SRC/'mesh/Body_Main_Shell.npz');V=M['V'].astype(float);V[:,1]-=yc;T=M['T'];tree=cKDTree(V)
fn=np.cross(V[T[:,1]]-V[T[:,0]],V[T[:,2]]-V[T[:,0]]);VN=np.zeros_like(V)
for k in range(3):np.add.at(VN,T[:,k],fn)
VN/=np.linalg.norm(VN,axis=1)[:,None]+1e-12

def cv(i):return np.array(C[i]['pts'],float)
def mir(p):q=p.copy();q[:,1]*=-1;return q
def half(p):return p[p[:,1]>=-1e-6]
def rx(p,x0,x1):
 p=p[np.argsort(p[:,0])];x=np.linspace(x0,x1,N);return np.c_[x,np.interp(x,p[:,0],p[:,1]),np.interp(x,p[:,0],p[:,2])]
def fit_between(a,b):
 rails=[]
 for j,t in enumerate(np.linspace(0,1,RAIL_COUNT)):
  p=(1-t)*a+t*b
  if 0<j<RAIL_COUNT-1:
   q=V[tree.query(p)[1]].copy();q[:,0]=p[:,0]
   q[:,1]=savgol_filter(q[:,1],7,2,mode='interp');q[:,2]=savgol_filter(q[:,2],7,2,mode='interp')
   # Restrict correction to avoid jumping across openings/nearby surfaces.
   delta=q-p;mag=np.linalg.norm(delta,axis=1);cap=np.maximum(1.5,.22*np.linalg.norm(b-a,axis=1))
   delta*=np.minimum(1,cap/(mag+1e-9))[:,None];p=p+delta
  rails.append(p)
 return rails
def xyz(p,dec=5):return ' '.join(f'({q[0]*S:.{dec}f},{q[1]*S:.{dec}f},{q[2]*S:.{dec}f})' for q in p)

# A deliberately small network: only major styling/boundary rails, not every extracted crease.
MASTER=[
 (75,'Rear deck centre rail'),(73,'Rear deck step rail'),(34,'Rear deck ledge'),(60,'Rear deck outer rail'),
 (27,'Rear shoulder'),(70,'Rear quarter crown'),(76,'Rear cross-body crown'),
 (62,'Cockpit opening rim'),(22,'Cockpit/bonnet side rail'),(63,'Door shoulder'),(29,'Sill rail'),
 (24,'Bonnet crown rail'),(25,'Front fender crown'),(64,'Front fender cut'),
 (175,'Rear wheel opening'),(194,'Front wheel opening'),(173,'Lower sill boundary'),(174,'Rear lower boundary'),
 (80,'Tail upper section'),(85,'Tail lip section'),(90,'Tail lower section'),(3,'Nose upper section'),
 (9,'Nose mid section'),(18,'Nose lower section')]
master=['# SolidArc native document v1','# Liger master curve network — selected primary rails and boundaries.','# Curves are fitted source design lines; silhouettes and incidental mesh creases are excluded.','show shading plastic','']
manifest=[]
for i,role in MASTER:
 p=cv(i);name=f'Master_{C[i]["name"]}';deg=min(3,len(p)-1)
 master.append(f'spline {xyz(p)} --degree={deg}{" --closed" if C[i].get("closed") else ""} --name={name}')
 colour='0.12 0.42 1.00' if C[i]['kind']=='BOUNDARY' else ('0.95 0.45 0.08' if 'section' in role.lower() else '0.90 0.12 0.12')
 master.append(f'tint {name} {colour}')
 manifest.append(f'{i:03d} {name}: {role} [{C[i]["kind"]}]')
master += ['view iso','view fit','']
(OUT/f'{CAR}_Body_MasterCurves.arc').write_text('\n'.join(master)+'\n')
(OUT/f'{CAR}_Body_MasterCurves.txt').write_text('\n'.join(manifest)+'\n')

# Accepted upper-surface topology. These pairs are adjacent in the design network.
# m = mirror second rail across Y=0; h = positive-Y half of a cross-body rail.
PLAN=[
 ('RearDeckCentre',75,('m',75)),('RearDeckStep',75,73),('RearDeckLedge',73,34),
 ('RearDeckOuter',34,60),('RearShoulder',60,27),('RearQuarterCrown',27,70),
 ('CockpitCantRail',('h',62),22),('BonnetCentre',24,('m',24)),('BonnetShoulder',24,25)]
def get(s):
 if isinstance(s,tuple):return mir(cv(s[1])) if s[0]=='m' else half(cv(s[1]))
 return cv(s)
def lbl(s):return C[s[1]]['name']+(' mirrored' if s[0]=='m' else ' +Y half') if isinstance(s,tuple) else C[s]['name']

surf=['# SolidArc native document v1','# Liger primary upper body surfaces — curve-bounded multi-rail NURBS lofts.',
      '# This is the first proper surfacing increment, not a complete body.','show shading plastic','show cages off','show iso off','']
metrics=[];accepted=[]
for name,aa,bb in PLAN:
 A,B=get(aa),get(bb);x0=max(A[:,0].min(),B[:,0].min());x1=min(A[:,0].max(),B[:,0].max())
 if x1-x0<8:continue
 A,B=rx(A,x0,x1),rx(B,x0,x1);centre=isinstance(bb,tuple) and bb[0]=='m';base=fit_between(A,B)
 for side,sign in ([('C',1)] if centre else [('R',1),('L',-1)]):
  railnames=[]
  for j,p0 in enumerate(base):
   p=p0.copy();p[:,1]*=sign
   if sign<0:p=p[::-1]
   rn=f'{side}_{name}_Rail{j+1}';railnames.append(rn);surf.append(f'spline {xyz(p)} --degree=3 --name={rn}')
  mid=base[len(base)//2][N//2];normal=np.cross(A[N//2+1]-A[N//2-1],B[N//2]-A[N//2])
  if np.dot(normal,VN[tree.query(mid)[1]])<0:railnames=railnames[::-1]
  sn=f'{side}_{name}';accepted.append(sn)
  surf += [f'loft {" ".join(railnames)} --degree=3 --sheet --no-align --name={sn}',f'delete {" ".join(railnames)}',f'tint {sn} 0.74 0.78 0.84','']
 sample=np.vstack(base);dist=tree.query(sample)[0]
 metrics.append(f'{name}: {lbl(aa)} -> {lbl(bb)}; x={x0:.1f}..{x1:.1f} cm; rails={RAIL_COUNT}; rail/reference mean={dist.mean():.2f} cm max={dist.max():.2f} cm')
surf += ['view iso','view fit','']
(OUT/f'{CAR}_Body_PrimarySurfaces.arc').write_text('\n'.join(surf)+'\n')
(OUT/f'{CAR}_Body_PrimarySurfaces_metrics.txt').write_text('\n'.join(metrics)+'\n')
print(f'{len(MASTER)} master curves; {len(accepted)} accepted upper loft surfaces')
print('\n'.join(metrics))

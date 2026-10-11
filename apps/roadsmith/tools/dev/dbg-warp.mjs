import { RoadNetwork, resetIds } from '../../src/road/network.js';
import { defaultProfile, ROAD_CLASS } from '../../src/road/profile.js';
import { buildSurface } from '../../src/road/build.js';
import { FLOATS_PER_VERTEX as F } from '../../src/core/mesh.js';
const SURFNAMES = Object.entries((await import('../../src/core/mesh.js')).SURF).reduce((a,[k,v])=>(a[v]=k,a),{});
resetIds();
const net = new RoadNetwork();
const c = net.addNode({x:0,y:0,z:0},{control:'signal'});
const e = net.addNode({x:70,y:0,z:0});
const w = net.addNode({x:-80,y:0,z:0});
const n = net.addNode({x:0,y:0,z:-75});
const s = net.addNode({x:0,y:0,z:90});
const t = net.addNode({x:70,y:0,z:70});
const y = net.addNode({x:-60,y:0,z:60});
net.addEdge(c.id,e.id,{profile:defaultProfile(ROAD_CLASS.ARTERIAL)});
net.addEdge(c.id,w.id,{profile:defaultProfile(ROAD_CLASS.ARTERIAL)});
net.addEdge(c.id,n.id,{profile:defaultProfile(ROAD_CLASS.COLLECTOR)});
net.addEdge(c.id,s.id,{profile:defaultProfile(ROAD_CLASS.COLLECTOR),via:[{x:12,y:0,z:45}]});
net.addEdge(e.id,t.id,{profile:defaultProfile(ROAD_CLASS.LOCAL)});
net.addEdge(s.id,t.id,{profile:defaultProfile(ROAD_CLASS.LOCAL),via:[{x:55,y:0,z:95}]});
net.addEdge(w.id,y.id,{profile:defaultProfile(ROAD_CLASS.LOCAL)});
net.addEdge(y.id,s.id,{profile:defaultProfile(ROAD_CLASS.LOCAL)});
const r = buildSurface(net,{});
const V = r.mesh.vertices, Q = r.mesh.quads;
const P=i=>({x:V[i*F],y:V[i*F+1],z:V[i*F+2],surf:SURFNAMES[V[i*F+11]]});
function area(p){const tri=(a,b,c)=>{const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;return 0.5*Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)};return tri(p[0],p[1],p[2])+tri(p[0],p[2],p[3])}
function warp(p){const ux=p[1].x-p[0].x,uy=p[1].y-p[0].y,uz=p[1].z-p[0].z,vx=p[2].x-p[0].x,vy=p[2].y-p[0].y,vz=p[2].z-p[0].z;let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz);if(l<1e-9)return 9;nx/=l;ny/=l;nz/=l;const d=Math.abs((p[3].x-p[0].x)*nx+(p[3].y-p[0].y)*ny+(p[3].z-p[0].z)*nz);return d/(Math.sqrt(area(p))||1)}
const list=[];
for(let q=0;q<Q.length;q+=4){const pts=[Q[q],Q[q+1],Q[q+2],Q[q+3]].map(P);list.push({w:warp(pts),a:area(pts),pts})}
list.sort((x,y)=>y.w-x.w);
for(const it of list.slice(0,10)) console.log(it.w.toFixed(3), 'area',it.a.toFixed(4), it.pts.map(p=>`${p.surf}(${p.x.toFixed(2)},${p.y.toFixed(3)},${p.z.toFixed(2)})`).join(' '));
const hist={};for(const it of list){const k=it.w>0.5?'>0.5':it.w>0.25?'0.25-0.5':it.w>0.1?'0.1-0.25':'<0.1';hist[k]=(hist[k]||0)+1}
console.log(hist);

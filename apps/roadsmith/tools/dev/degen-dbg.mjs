import { buildScene, defaultSettings } from '../../src/road/scene.js';
import { FLOATS_PER_VERTEX as F, SURF_NAMES } from '../../src/core/mesh.js';
const scene = buildScene(defaultSettings('downtown'));
const m = scene.surface.mesh, V = m.vertices, Q = m.quads;
const P = i => ({x:V[i*F],y:V[i*F+1],z:V[i*F+2]});
const surf = i => V[i*F+9];
const tri=(a,b,c)=>{const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;return 0.5*Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);};
let degen=[];
for (let q=0;q<Q.length;q+=4){const idx=[Q[q],Q[q+1],Q[q+2],Q[q+3]];const p=idx.map(P);const a=tri(p[0],p[1],p[2])+tri(p[0],p[2],p[3]);if(a<1e-6)degen.push({q:q/4,idx,p,a,s:SURF_NAMES[surf(idx[0])]});}
console.log('degenerate', degen.length);
const bySurf={}; for(const d of degen) bySurf[d.s]=(bySurf[d.s]||0)+1;
console.log(bySurf);
for (const d of degen.slice(0,4)) console.log(d.q, d.a.toExponential(2), d.p.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).join(' | '));
// which submesh / junction? find nearest node
const near = (p)=>{let best=null,bd=1e9;for(const n of scene.net.nodes.values()){const d=Math.hypot(n.p.x-p.x,n.p.z-p.z);if(d<bd){bd=d;best=n;}}return `${best.id}@${bd.toFixed(1)}m edges=${best.edges.length}`;};
for (const d of degen.slice(0,6)) console.log('  near', near(d.p[0]));
// non-manifold edges
const T=m.indices, use=new Map();
for(let t=0;t<T.length;t+=3)for(let k=0;k<3;k++){const a=T[t+k],b=T[t+(k+1)%3];const key=a<b?`${a}_${b}`:`${b}_${a}`;use.set(key,(use.get(key)||0)+1);}
let nm=0; for(const [key,n] of use) if(n>2){nm++; if(nm<=6){const [a,b]=key.split('_').map(Number);console.log('nm edge',n,'faces', P(a), P(b), SURF_NAMES[surf(a)], SURF_NAMES[surf(b)], near(P(a)));}}
console.log('non-manifold', nm);

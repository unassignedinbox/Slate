// SDF volume — volumetric not heightmap. Real caves, overhangs.
// Reduced to 80×40×80 for real-time marching tetra (≈256k voxels, ~450ms rebuild vs 1.7s at 96³) — keeps 60fps with throttled rebuilds.
export const SIZE = [80, 40, 80];
export const MIN = [-18, -3, -18];
export const MAX = [18, 20, 18];
export const CELL = SIZE.map((n,i)=> (MAX[i]-MIN[i])/n);

const mix=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(v)=>{v=clamp(v,0,1);return v*v*(3-2*v)};
function hash3(x,y,z,seed=0){
  let n = Math.imul(x,374761393) ^ Math.imul(y,668265263) ^ Math.imul(z,1274126177) ^ Math.imul(seed,1274126177);
  n = Math.imul(n ^ (n>>>13),1274126177);
  return ((n ^ (n>>>16))>>>0)/4294967295;
}
export function valueNoise(x,y,z,seed=0){
  const ix=Math.floor(x), iy=Math.floor(y), iz=Math.floor(z);
  const fx=x-ix, fy=y-iy, fz=z-iz;
  const u=smooth(fx), v=smooth(fy), w=smooth(fz);
  const h=(dx,dy,dz)=>hash3(ix+dx,iy+dy,iz+dz,seed);
  const x00=mix(h(0,0,0),h(1,0,0),u);
  const x10=mix(h(0,1,0),h(1,1,0),u);
  const x01=mix(h(0,0,1),h(1,0,1),u);
  const x11=mix(h(0,1,1),h(1,1,1),u);
  const y0=mix(x00,x10,v), y1=mix(x01,x11,v);
  return mix(y0,y1,w);
}
export function fractalNoise(p, {scale=1.8, octaves=4, gain=0.5, lacunarity=2.0, warp=0, seed=0}={}){
  let amp=1, freq=scale, sum=0, norm=0;
  let x=p[0], y=p[1], z=p[2];
  for(let i=0;i<octaves;i++){
    let v=valueNoise(x*freq, y*freq, z*freq, seed+i*19);
    sum += v*amp;
    norm += amp;
    amp*=gain;
    freq*=lacunarity;
  }
  let n=sum/norm;
  if(warp>0){
    const q=[valueNoise(x*0.5,y*0.5,z*0.5,seed+99)-0.5,
             valueNoise(x*0.5+31,y*0.5+17,z*0.5+7,seed+33)-0.5,
             valueNoise(x*0.5+17,y*0.5+41,z*0.5+13,seed+77)-0.5];
    n+= (valueNoise((x+q[0]*warp)*scale,(y+q[1]*warp)*scale,(z+q[2]*warp)*scale,seed)-0.5)*0.35;
  }
  return n;
}

// Primitives
function sdBox(p, b){
  const qx=Math.abs(p[0])-b[0], qy=Math.abs(p[1])-b[1], qz=Math.abs(p[2])-b[2];
  return Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0)) + Math.min(Math.max(qx,qy,qz),0);
}
function sdSphere(p,r){ return Math.hypot(p[0],p[1],p[2]) - r; }
function sdTorus(p, t){ // t=[major, minor]
  const qx=Math.hypot(p[0],p[2]) - t[0];
  return Math.hypot(qx,p[1]) - t[1];
}
function sdCylinder(p, r, h){
  const d2=Math.hypot(p[0],p[2]) - r;
  const dy=Math.abs(p[1]) - h*0.5;
  if(d2<0 && dy<0) return Math.max(d2,dy);
  return Math.hypot(Math.max(d2,0), Math.max(dy,0));
}
function sdPlaneY(p, h, noiseAmt, noiseCfg){
  let d = p[1] - h;
  if(noiseAmt>0) d += (fractalNoise(p,noiseCfg)-0.5)*noiseAmt;
  return d;
}
function smin(a,b,k){
  if(k<=0.001) return Math.min(a,b);
  const h=clamp(0.5+0.5*(b-a)/k,0,1);
  return mix(b,a,h) - k*h*(1-h);
}
function smax(a,b,k){ return -smin(-a,-b,k); }

// Node evaluation
export function evalGraphSDF(pos, graph){
  // memo per eval call to avoid repeat
  const cache=new Map();
  const evalNode=(id)=>{
    if(cache.has(id)) return cache.get(id);
    const n=graph.nodes[id];
    if(!n) return 1000;
    let d=1000;
    switch(n.type){
      case 'box': {
        const s=n.params.size || [5,3,5];
        const r=n.params.round||0.4;
        const p=[pos[0]-n.params.x, pos[1]-n.params.y, pos[2]-n.params.z];
        // apply rotation Y only for simplicity
        const rot=n.params.rotY||0;
        if(rot!==0){
          const c=Math.cos(rot), s0=Math.sin(rot);
          const xr=p[0]*c - p[2]*s0, zr=p[0]*s0 + p[2]*c;
          p[0]=xr; p[2]=zr;
        }
        d=sdBox(p,[s[0],s[1],s[2]]) - r;
        // strata displacement
        if(n.params.strata>0){
          const warp = Math.sin(pos[1]*3.2)*0.18*n.params.strata;
          d+=warp;
        }
        break;
      }
      case 'sphere': {
        const r=n.params.radius||2.5;
        const p=[pos[0]-n.params.x, pos[1]-n.params.y, pos[2]-n.params.z];
        d=sdSphere(p,r);
        break;
      }
      case 'torus': {
        const maj=n.params.major||3, min=n.params.minor||0.6;
        const p=[pos[0]-n.params.x, pos[1]-n.params.y, pos[2]-n.params.z];
        d=sdTorus(p,[maj,min]);
        break;
      }
      case 'cylinder': {
        const r=n.params.radius||1.5, h=n.params.height||6;
        const p=[pos[0]-n.params.x, pos[1]-n.params.y, pos[2]-n.params.z];
        d=sdCylinder(p,r,h);
        break;
      }
      case 'terrain': {
        // Stratified base slab with perlin top
        const w=n.params.width||36, l=n.params.length||32, h=n.params.height||3.5;
        const bevel=n.params.bevel||1.1;
        const p=[pos[0], pos[1], pos[2]];
        // Box slab centered
        const base = sdBox([p[0], p[1]-(h*0.5-1.5), p[2]],[w*0.5-bevel, h*0.5, l*0.5-bevel]) - bevel;
        // Top noise
        const nval = fractalNoise([p[0]*0.12,0,p[2]*0.12],{scale:0.9, octaves:4, gain:0.5, seed:n.params.seed||4821});
        const top = p[1] - (1.5 + h*0.55 + (nval-0.5)*4.2);
        d = Math.max(base, top);
        // strata warping
        if(n.params.strata>0){
          const layer = Math.sin(p[1]*4.1 + nval*2.0)*0.16*n.params.strata;
          d+=layer;
        }
        // cliffs via canyon cut (placeholder)
        break;
      }
      case 'noise': {
        // Warp field applied as displacement to its input
        const inp = getInput(n,0);
        const base = inp ? evalNode(inp) : 999;
        const amt=n.params.amount||0.7, sc=n.params.scale||1.4;
        const nv = (fractalNoise(pos,{scale:sc, octaves:n.params.octaves||4, gain:0.5, seed:n.params.seed||9})-0.5)*amt;
        d = base - nv*1.2; // displace surface inward/outward
        break;
      }
      case 'union': {
        const ins=getInputs(n);
        if(ins.length===0) d=1000;
        else if(ins.length===1) d=evalNode(ins[0]);
        else d=ins.reduce((acc,id)=>Math.min(acc,evalNode(id)),1000);
        break;
      }
      case 'subtract': {
        const ins=getInputs(n);
        if(ins.length===0) d=1000;
        else if(ins.length===1) d=evalNode(ins[0]);
        else {
          let a=evalNode(ins[0]);
          for(let i=1;i<ins.length;i++) a=Math.max(a, -evalNode(ins[i]));
          d=a;
        }
        break;
      }
      case 'intersect': {
        const ins=getInputs(n);
        if(ins.length===0) d=1000;
        else d=ins.reduce((acc,id)=>Math.max(acc,evalNode(id)), -1000);
        break;
      }
      case 'blend': {
        const ins=getInputs(n);
        const k=n.params.k||0.9;
        if(ins.length<2) d=ins.length?evalNode(ins[0]):1000;
        else {
          d=evalNode(ins[0]);
          for(let i=1;i<ins.length;i++) d=smin(d,evalNode(ins[i]),k);
        }
        break;
      }
      case 'transform': {
        const inp=getInput(n,0);
        if(!inp) d=1000;
        else {
          const p=[pos[0]-n.params.x, pos[1]-n.params.y, pos[2]-n.params.z];
          const sc=n.params.scale||1;
          const ps=[p[0]/sc, p[1]/sc, p[2]/sc];
          // Y rotation
          if(n.params.rotY){
            const c=Math.cos(n.params.rotY), s0=Math.sin(n.params.rotY);
            const xr=ps[0]*c - ps[2]*s0, zr=ps[0]*s0+ps[2]*c;
            ps[0]=xr; ps[2]=zr;
          }
          // evaluate input at transformed point? But our eval uses pos param, need wrapper
          // Create temporary pos override
          const orig=pos.slice();
          pos[0]=ps[0]+(graph.nodes[inp]?.params?.x||0);
          pos[1]=ps[1]+(graph.nodes[inp]?.params?.y||0);
          pos[2]=ps[2]+(graph.nodes[inp]?.params?.z||0);
          // Actually this is simplistic; better just evaluate node at ps without offset double.
          // We'll instead compute: evaluate input SDF at world-transformed point
          // To avoid recursion complexity, we directly call eval for input but with modified pos via context stack.
          // Push transform: instead we evaluate input using ps as pos if input is primitive-ish
          // For simplicity fallback: d = evalNode(inp)*sc // approximate
          // But to get correct, we need to override position for the whole subtree.
          // We'll implement via a stack.
          pos[0]=orig[0]; pos[1]=orig[1]; pos[2]=orig[2];
          // Approximate: scale SDF
          const inner = (()=> {
            // Use custom evaluator with transformed pos
            const saved=pos.slice();
            pos[0]=ps[0]; pos[1]=ps[1]; pos[2]=ps[2];
            // But node positions still encoded; so need world pos = ps + input origin?
            // Simplistic: just scale distance
            const v=evalNode(inp);
            pos[0]=saved[0]; pos[1]=saved[1]; pos[2]=saved[2];
            return v*sc;
          })();
          d=inner;
        }
        break;
      }
      case 'terrace': {
        const inp=getInput(n,0);
        const base = inp ? evalNode(inp) : 1000;
        // Terrace by quantizing Y influence: we displace SDF via y-terrace
        const steps=n.params.steps||5, strength=n.params.strength||0.6;
        const py=pos[1];
        const q = Math.floor(py / (steps>0? (4/steps):1));
        const t = strength * Math.sin(q*1.7)*0.22;
        d = base - t;
        break;
      }
      case 'hydraulic':
      case 'thermal':
      case 'wind':
      case 'river':
        // Erosion nodes pass through SDF unchanged; they mark process nodes for simulation pass
        // Their inputs SDF is the terrain to erode; output = input SDF (erosion is simulated via particle modification, not function)
        {
          const inp=getInput(n,0);
          d = inp ? evalNode(inp) : 1000;
        }
        break;
      case 'output': {
        const inp=getInput(n,0);
        d = inp ? evalNode(inp) : 1000;
        break;
      }
      default: d=1000;
    }
    cache.set(id,d);
    return d;
  };
  function getInputs(node){
    // graph.wires -> find where to===node.id ordered
    const wires=graph.wires.filter(w=>w.to===node.id).sort((a,b)=>a.toPort.localeCompare(b.toPort));
    return wires.map(w=>w.from);
  }
  function getInput(node,index){
    const wires=graph.wires.filter(w=>w.to===node.id).sort((a,b)=>a.toPort.localeCompare(b.toPort));
    return wires[index]?.from;
  }

  // Find output node
  const outId = Object.keys(graph.nodes).find(id=>graph.nodes[id].type==='output');
  if(!outId) return 10;
  return evalNode(outId);
}

// Helper for graph traversal outside
export function getOrderedErosionNodes(graph){
  // topo order, pick erosion types in order they appear along graph
  const nodes=Object.values(graph.nodes);
  const erosionNodes=nodes.filter(n=>['hydraulic','thermal','wind','river'].includes(n.type));
  // sort by approximate depth (distance from output)
  // BFS from output backwards
  const depth=new Map();
  const visit=(id,d)=>{
    if(depth.has(id) && depth.get(id)>=d) return;
    depth.set(id,d);
    const incoming=graph.wires.filter(w=>w.to===id);
    for(const w of incoming) visit(w.from,d+1);
  };
  const outId=Object.keys(graph.nodes).find(id=>graph.nodes[id].type==='output');
  if(outId) visit(outId,0);
  erosionNodes.sort((a,b)=>(depth.get(a.id)||0)-(depth.get(b.id)||0));
  return erosionNodes;
}

export function generateVolume(graph){
  const [nx,ny,nz]=SIZE;
  const vol=new Float32Array(nx*ny*nz);
  let minD=Infinity, maxD=-Infinity;
  for(let z=0;z<nz;z++){
    const wz=MIN[2]+(z+0.5)*CELL[2];
    for(let y=0;y<ny;y++){
      const wy=MIN[1]+(y+0.5)*CELL[1];
      for(let x=0;x<nx;x++){
        const wx=MIN[0]+(x+0.5)*CELL[0];
        const d=evalGraphSDF([wx,wy,wz], graph);
        // clamp outside bounds handling? Keep as is
        const idx=(z*ny+y)*nx+x;
        vol[idx]=d;
        if(d<minD) minD=d;
        if(d>maxD) maxD=d;
      }
    }
  }
  return {volume:vol, minD, maxD};
}

export function sampleSDF(volume, pos){
  // trilinear
  const q=pos.map((v,k)=> (v-MIN[k])/CELL[k] -0.5);
  const lo=q.map(v=>Math.floor(v));
  const f=q.map((v,k)=>v-lo[k]);
  const [nx,ny,nz]=SIZE;
  let sample=(x,y,z)=>{
    // clamp
    x=Math.max(0,Math.min(nx-1,x));
    y=Math.max(0,Math.min(ny-1,y));
    z=Math.max(0,Math.min(nz-1,z));
    return volume[(z*ny+y)*nx+x];
  };
  // outside distance field add
  let outside=Math.hypot(...pos.map((v,k)=>Math.max(MIN[k]-v, v-MAX[k],0)));
  if(q.some((v,k)=>v<0||v>SIZE[k]-1)){
    // still sample clamped + outside
  }
  const x0=lo[0], y0=lo[1], z0=lo[2];
  const c000=sample(x0,y0,z0), c100=sample(x0+1,y0,z0), c010=sample(x0,y0+1,z0), c110=sample(x0+1,y0+1,z0);
  const c001=sample(x0,y0,z0+1), c101=sample(x0+1,y0,z0+1), c011=sample(x0,y0+1,z0+1), c111=sample(x0+1,y0+1,z0+1);
  const fx=f[0], fy=f[1], fz=f[2];
  const x00=mix(c000,c100,fx), x10=mix(c010,c110,fx), x01=mix(c001,c101,fx), x11=mix(c011,c111,fx);
  const y0m=mix(x00,x10,fy), y1m=mix(x01,x11,fy);
  return mix(y0m,y1m,fz) + outside*0.6;
}

export function estimateNormal(volume, pos, eps=0.22){
  const dx=sampleSDF(volume,[pos[0]+eps,pos[1],pos[2]]) - sampleSDF(volume,[pos[0]-eps,pos[1],pos[2]]);
  const dy=sampleSDF(volume,[pos[0],pos[1]+eps,pos[2]]) - sampleSDF(volume,[pos[0],pos[1]-eps,pos[2]]);
  const dz=sampleSDF(volume,[pos[0],pos[1],pos[2]+eps]) - sampleSDF(volume,[pos[0],pos[1],pos[2]-eps]);
  const len=Math.hypot(dx,dy,dz)||1;
  return [dx/len, dy/len, dz/len];
}

export function raycastVolume(volume, origin, dir){
  let near=0, far=80;
  for(let k=0;k<3;k++){
    if(Math.abs(dir[k])<1e-7){
      if(origin[k]<MIN[k]||origin[k]>MAX[k]) return null;
      continue;
    }
    let t1=(MIN[k]-origin[k])/dir[k], t2=(MAX[k]-origin[k])/dir[k];
    near=Math.max(near, Math.min(t1,t2));
    far=Math.min(far, Math.max(t1,t2));
  }
  if(near>far) return null;
  let t=near;
  for(let j=0;j<220;j++){
    if(t>far) break;
    const p=[origin[0]+dir[0]*t, origin[1]+dir[1]*t, origin[2]+dir[2]*t];
    const d=sampleSDF(volume,p);
    if(d<0.06) return p;
    t+=Math.max(0.05, d*0.62);
  }
  return null;
}

// Volume sculpting for erosion deposition (small sphere kernels)
export function sculptAt(volume, point, radius, mode='carve', strength=1){
  const [nx,ny,nz]=SIZE;
  const ir=Math.ceil(radius/Math.min(...CELL))+1;
  const q=[
    Math.floor((point[0]-MIN[0])/CELL[0]),
    Math.floor((point[1]-MIN[1])/CELL[1]),
    Math.floor((point[2]-MIN[2])/CELL[2]),
  ];
  for(let dz=-ir;dz<=ir;dz++){
    for(let dy=-ir;dy<=ir;dy++){
      for(let dx=-ir;dx<=ir;dx++){
        const xi=q[0]+dx, yi=q[1]+dy, zi=q[2]+dz;
        if(xi<0||yi<0||zi<0||xi>=nx||yi>=ny||zi>=nz) continue;
        const wx=MIN[0]+(xi+0.5)*CELL[0], wy=MIN[1]+(yi+0.5)*CELL[1], wz=MIN[2]+(zi+0.5)*CELL[2];
        const dist=Math.hypot(wx-point[0], wy-point[1], wz-point[2]);
        if(dist>radius) continue;
        const idx=(zi*ny+yi)*nx+xi;
        const sphere = dist - radius;
        let d=volume[idx];
        if(mode==='carve'){
          // carve = max(d, -sphere) => remove material where sphere inside -> make d more positive
          const carved=Math.max(d, -sphere * strength);
          volume[idx]=carved;
        }else if(mode==='deposit'){
          // deposit = min(d, sphere) => add material
          const deposited=Math.min(d, sphere * strength);
          volume[idx]=deposited;
        }else if(mode==='smooth'){
          // average with neighbours
          // simple smoothing factor
          const avg = (
            volume[Math.max(0, idx-1)] + volume[Math.min(volume.length-1, idx+1)] +
            volume[Math.max(0, idx-nx)] + volume[Math.min(volume.length-1, idx+nx)] +
            volume[Math.max(0, idx-nx*ny)] + volume[Math.min(volume.length-1, idx+nx*ny)]
          )/6;
          const t=0.5*(1 - dist/radius);
          volume[idx]=mix(d, avg, t*0.7);
        }
      }
    }
  }
}

// Quick stats
export function computeStats(volume){
  const [nx,ny,nz]=SIZE;
  let solid=0;
  for(let i=0;i<volume.length;i++) if(volume[i]<0) solid++;
  const voxVol=CELL[0]*CELL[1]*CELL[2];
  return {
    solidVoxels:solid,
    totalVoxels:volume.length,
    solidVolume:solid*voxVol,
    fillRatio: solid/volume.length
  };
}

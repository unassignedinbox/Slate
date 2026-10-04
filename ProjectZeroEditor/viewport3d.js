/* ============================================================================
   VIEWPORT — canvas renderer for the showcase field: one coloured primitive
   per outliner entry, sand ground + blue sky + long soft shadows like the
   CPU reference, path-traced grain that converges as samples accumulate.

   The transform gizmo is the engine's own (GizmoFigures.h — a 1:1 port of
   References/Gizmo.html): translate = cones + corner quads + white ring,
   rotate = flat annular arcs + ring, scale = short cylinders + ring, with
   the reference's radii, sweeps, offsets and tints, and Blender's drag
   rules (Ctrl snaps 0.25 u / 0.1x / 5 deg).
   ========================================================================== */

'use strict';

/* ── GizmoFigures.h — verbatim figures ── */
const GZ = {
  axisReach: 1.0, tip: 0.95, coneR: 0.06, coneH: 0.18,
  cylR: 0.06, cylH: 0.14, cylInset: 0.28,
  quadHalf: 0.08, quadA: 0.28, quadAHover: 0.55,
  arcR: 0.95 * 0.62, arcBand: 0.038, arcSweep: 0.5410521, arcSegs: 24,
  ringR: 0.16,
  tintX: '#e01414', tintY: '#12d40a', tintZ: '#1560e0',
  tintYZ: '#1fc7c7', tintXZ: '#c81ec8', tintXY: '#e0cd12', tintRing: '#ffffff',
  snapMove: 0.25, snapScale: 0.1, snapTurn: 5 * Math.PI / 180,
};

const V3 = {
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:a=>Math.hypot(a[0],a[1],a[2]),
  norm(a){const l=V3.len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];},
};

/* orbit camera — ViewportPanel.cpp OrbitBasis (Z-up) */
const CAM = { yaw: -108*Math.PI/180, pitch: 0.0, dist: 14, target: [0, 9, 1.1], fov: 72, ortho: false };
function camBasis(){
  const Sy=Math.sin(CAM.yaw), Cy=Math.cos(CAM.yaw), Sp=Math.sin(CAM.pitch), Cp=Math.cos(CAM.pitch);
  const F=[Sy*Cp, Cy*Cp, Sp];
  let R=[Cy,-Sy,0]; R=V3.norm(R);
  const U=V3.norm(V3.cross(R,F));
  return {F,R,U, eye: V3.sub(CAM.target, V3.mul(F, CAM.dist))};
}

/* ── unit meshes (faces: {v:[idx..], }) ── */
function meshBox(){
  const v=[[-0.5,-0.5,0],[0.5,-0.5,0],[0.5,0.5,0],[-0.5,0.5,0],[-0.5,-0.5,1],[0.5,-0.5,1],[0.5,0.5,1],[-0.5,0.5,1]];
  const f=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  return {v,f};
}
function meshPyramid(){
  const v=[[-0.5,-0.5,0],[0.5,-0.5,0],[0.5,0.5,0],[-0.5,0.5,0],[0,0,1]];
  const f=[[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]];
  return {v,f};
}
function meshCone(seg=14){
  const v=[],f=[];
  for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2;v.push([Math.cos(a)*.5,Math.sin(a)*.5,0]);}
  v.push([0,0,1]); v.push([0,0,0]);
  for(let i=0;i<seg;i++){f.push([i,(i+1)%seg,seg]); f.push([(i+1)%seg,i,seg+1]);}
  return {v,f};
}
function meshCylinder(seg=12){
  const v=[],f=[];
  for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2;v.push([Math.cos(a)*.5,Math.sin(a)*.5,0]);}
  for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2;v.push([Math.cos(a)*.5,Math.sin(a)*.5,1]);}
  v.push([0,0,0]); v.push([0,0,1]);
  for(let i=0;i<seg;i++){
    const j=(i+1)%seg;
    f.push([i,j,seg+j,seg+i]); f.push([j,i,2*seg]); f.push([seg+i,seg+j,2*seg+1]);
  }
  return {v,f};
}
function meshSphere(se=10,ri=7){
  const v=[],f=[];
  for(let j=0;j<=ri;j++){const p=j/ri*Math.PI;
    for(let i=0;i<se;i++){const a=i/se*Math.PI*2;
      v.push([Math.sin(p)*Math.cos(a)*.5,Math.sin(p)*Math.sin(a)*.5,.5+Math.cos(p)*.5]);}}
  for(let j=0;j<ri;j++)for(let i=0;i<se;i++){
    const a=j*se+i,b=j*se+(i+1)%se,c=(j+1)*se+(i+1)%se,d=(j+1)*se+i;
    f.push([a,b,c,d]);}
  return {v,f};
}
function meshCloth(n=9){
  const v=[],f=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
    const x=i/n-0.5,y=j/n-0.5;
    v.push([x,y,0.55+0.16*Math.sin(x*5.1)*Math.cos(y*4.2)+0.3*(0.5-Math.abs(x))]);}
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const a=j*(n+1)+i;
    f.push([a,a+1,a+n+2,a+n+1]); f.push([a+n+1,a+n+2,a+1,a]); /* double-sided */ }
  return {v,f};
}
const MESH = { box:meshBox(), pyramid:meshPyramid(), cone:meshCone(), cylinder:meshCylinder(),
               sphere:meshSphere(), torus:meshCylinder(), cloth:meshCloth() };

function shapeMatrixVerts(shape){
  const m = MESH[shape.kind]; if (!m) return null;
  const sx = shape.size, sy = shape.size, sz = shape.size * (shape.tall || (shape.flat ? shape.flat : 1));
  const cy = Math.cos(shape.yaw||0), sy_ = Math.sin(shape.yaw||0);
  const R = shape.rotM || null;
  const out = new Array(m.v.length);
  for (let i=0;i<m.v.length;i++){
    let [x,y,z] = m.v[i];
    if (shape.kind==='cylinder' && shape.lay){ const t=z; z=y+0.5; y=t-0.5; } /* tyres on their side */
    x*=sx; y*=sy; z*=sz;
    if (R){ const nx=R[0]*x+R[1]*y+R[2]*z, ny=R[3]*x+R[4]*y+R[5]*z, nz=R[6]*x+R[7]*y+R[8]*z; x=nx;y=ny;z=nz; }
    const wx = x*cy - y*sy_, wy = x*sy_ + y*cy;
    out[i] = [wx + shape.pos[0], wy + shape.pos[1], z + shape.pos[2]];
  }
  return { verts: out, faces: m.f };
}

/* ── renderer state ── */
let cv, ctx, base, bctx, noiseTile, W=0, H=0, DPR=1;
let dirty = true;
let visibleShapes = [];      /* {node, shape} gathered each render */
let gizmo = { hot: null, drag: null };
const VPX = {};              /* projection scratch shared with app.js */

function makeNoise(){
  noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 160;
  const nc = noiseTile.getContext('2d'), img = nc.createImageData(160,160);
  for (let i=0;i<img.data.length;i+=4){ const g = 110 + Math.random()*120|0;
    img.data[i]=img.data[i+1]=img.data[i+2]=g; img.data[i+3]=255; }
  nc.putImageData(img,0,0);
}

function resize(){
  const r = cv.parentElement.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio||1, 2) * (S.resolution/100);
  W = Math.max(8, r.width|0); H = Math.max(8, r.height - 0|0);
  cv.width = W*DPR; cv.height = H*DPR;
  base.width = W*DPR; base.height = H*DPR;
  dirty = true;
}

function project(p, B, foc){
  const d = V3.sub(p, B.eye);
  const z = V3.dot(d, B.F);
  if (z < 0.05) return null;
  return [ W/2 + V3.dot(d,B.R)/z*foc, H/2 - V3.dot(d,B.U)/z*foc, z ];
}
function focal(){ return (W/2) / Math.tan(CAM.fov*Math.PI/360); }

function sunDir(){
  const el = S.sunElevation*Math.PI/180, az = S.sunAzimuth*Math.PI/180;
  return [Math.sin(az)*Math.cos(el), Math.cos(az)*Math.cos(el), Math.sin(el)];
}

function shade(colorStr, nrm, sun){
  /* flat shade: ambient + diffuse + a sky fill on upward faces */
  const m = colorStr.match(/hsl\((-?[\d.]+),([\d.]+)%,([\d.]+)%\)/);
  let h=0,s=0,l=60; if (m){ h=+m[1]; s=+m[2]; l=+m[3]; }
  const d = Math.max(0, V3.dot(nrm, sun));
  const up = Math.max(0, nrm[2]);
  let lum = l*(0.52 + 0.55*d) + up*4;
  lum = Math.min(96, lum);
  return `hsl(${h},${s}%,${lum}%)`;
}

function gatherShapes(){
  visibleShapes = [];
  eachNode(n => {
    if (!n.shape || n.shape.kind==='ground') return;
    if (!effectiveVisible(n)) return;
    if (S.isolated && S.isolated !== n) return;
    visibleShapes.push(n);
  });
}

function renderScene(){
  const B = camBasis(), foc = focal(), sun = sunDir();
  const g = bctx;
  g.setTransform(DPR,0,0,DPR,0,0);

  /* sky + sand split on the horizon row (roll-free camera) */
  const horizon = H/2 + Math.tan(CAM.pitch)*foc;
  const sky = g.createLinearGradient(0,0,0,Math.max(horizon,1));
  sky.addColorStop(0,'#7e99c4'); sky.addColorStop(1,'#a8bbd8');
  g.fillStyle = sky; g.fillRect(0,0,W,Math.max(0,horizon));
  const sand = g.createLinearGradient(0,horizon,0,H);
  sand.addColorStop(0,'#cfc3ab'); sand.addColorStop(.25,'#ddd2b8'); sand.addColorStop(1,'#e6dcc4');
  g.fillStyle = sand; g.fillRect(0,Math.max(0,horizon),W,H);
  /* warm band at left edge like the reference bake */
  g.fillStyle = 'rgba(240,170,110,.18)';
  g.fillRect(0,Math.max(0,horizon)-40,26,80);

  gatherShapes();

  /* shadows — silhouette projected along the sun onto z=0 */
  const sl = Math.min(14, 1/Math.max(0.06, Math.tan(S.sunElevation*Math.PI/180)));
  const sdir = V3.norm([-sun[0],-sun[1],0]);
  for (const n of visibleShapes){
    const mv = shapeMatrixVerts(n.shape); if (!mv) continue;
    const pts = [];
    for (const v of mv.verts){
      const drop = [v[0]+sdir[0]*v[2]*sl, v[1]+sdir[1]*v[2]*sl, 0.01];
      const p = project(drop,B,foc); if (p) pts.push(p);
    }
    if (pts.length < 3) continue;
    const hull = convexHull(pts);
    g.beginPath(); hull.forEach((p,i)=> i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));
    g.closePath(); g.fillStyle = 'rgba(74,94,140,0.42)'; g.fill();
  }

  /* shapes — painter's algorithm across all faces */
  const polys = [];
  for (const n of visibleShapes){
    const mv = shapeMatrixVerts(n.shape); if (!mv) continue;
    const pv = mv.verts.map(v => project(v,B,foc));
    n._screen = null;
    const c = project([n.shape.pos[0], n.shape.pos[1], n.shape.pos[2] + n.shape.size*0.5*(n.shape.tall||1)], B, foc);
    if (c) n._screen = { x:c[0], y:c[1], z:c[2], r: n.shape.size*foc/c[2]*0.75 };
    for (const f of mv.faces){
      let ok = true, zs = 0;
      for (const i of f){ if (!pv[i]) { ok=false; break; } zs += pv[i][2]; }
      if (!ok) continue;
      const a = mv.verts[f[0]], b = mv.verts[f[1]], d = mv.verts[f[2]];
      const nrm = V3.norm(V3.cross(V3.sub(b,a), V3.sub(d,a)));
      const toEye = V3.sub(B.eye, a);
      if (V3.dot(nrm,toEye) <= 0) continue;
      polys.push({ z: zs/f.length, f, pv, nrm, n });
    }
  }
  polys.sort((p,q)=>q.z-p.z);
  for (const p of polys){
    g.beginPath();
    p.f.forEach((i,k)=> k?g.lineTo(p.pv[i][0],p.pv[i][1]):g.moveTo(p.pv[i][0],p.pv[i][1]));
    g.closePath();
    g.fillStyle = shade(p.n.shape.color, p.nrm, sun);
    g.fill();
    if (p.n === S.selected){ g.strokeStyle = 'rgba(245,166,35,.85)'; g.lineWidth = 1.2; g.stroke(); }
  }

  drawGizmo(g,B,foc);
  drawNavCluster(g);
}

function convexHull(pts){
  pts = pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[]; for(const p of pts){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
  const up=[]; for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
  up.pop(); lo.pop(); return lo.concat(up);
}

/* ── nav cluster (bottom-right axis balls) ── */
const NAV = { cx:0, cy:0, R:26, balls:[] };
function drawNavCluster(g){
  NAV.cx = W-52; NAV.cy = H-56;
  const B = camBasis(), r = NAV.R;
  const axes = [
    { d:[1,0,0], c:'#e05555', l:'X' }, { d:[-1,0,0], c:'#e05555', l:'' },
    { d:[0,1,0], c:'#3ecb60', l:'Y' }, { d:[0,-1,0], c:'#3ecb60', l:'' },
    { d:[0,0,1], c:'#6a8fe0', l:'Z' }, { d:[0,0,-1], c:'#6a8fe0', l:'' },
  ];
  NAV.balls = [];
  const pts = axes.map(a => ({ a,
    x: NAV.cx + V3.dot(a.d,B.R)*r, y: NAV.cy - V3.dot(a.d,B.U)*r, z: V3.dot(a.d,B.F) }));
  pts.sort((p,q)=>q.z-p.z);
  for (const p of pts){
    const pos = p.a.l !== '' || p.a.d.some(v=>v>0);
    g.beginPath(); g.moveTo(NAV.cx,NAV.cy); g.lineTo(p.x,p.y);
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); g.arc(p.x,p.y, pos?5.5:4, 0, 7);
    g.fillStyle = p.z < 0 ? p.a.c : 'rgba(150,160,180,.55)';
    if (!pos){ g.fillStyle = 'rgba(0,0,0,0)'; g.strokeStyle = p.a.c; g.lineWidth=1.4; g.stroke(); }
    else g.fill();
    if (p.a.l){ g.fillStyle = 'rgba(90,100,120,.9)'; g.font = '9px monospace';
      g.fillText(p.a.l, p.x+7, p.y+3); }
    NAV.balls.push({ x:p.x, y:p.y, d:p.a.d });
  }
  g.beginPath(); g.arc(NAV.cx,NAV.cy,4.5,0,7); g.fillStyle='#3ecb60'; g.fill();
  g.strokeStyle='rgba(224,85,85,.9)'; g.lineWidth=1.2;
  g.beginPath(); g.moveTo(NAV.cx-3,NAV.cy-3); g.lineTo(NAV.cx+3,NAV.cy+3);
  g.moveTo(NAV.cx+3,NAV.cy-3); g.lineTo(NAV.cx-3,NAV.cy+3); g.stroke();
}

/* ── the gizmo — GizmoFigures.h pieces ── */
function gizmoPose(){
  const n = S.selected;
  if (!n || !n.shape || n.shape.kind==='ground' || S.mode!=='edit') return null;
  const s = n.shape;
  const reach = Math.max(1.2, s.size*0.9);
  return { o:[s.pos[0], s.pos[1], s.pos[2]+s.size*0.5*(s.tall||1)], reach,
           ax:[[1,0,0],[0,1,0],[0,0,1]] };
}
function drawGizmo(g,B,foc){
  const P = gizmoPose(); if (!P) return;
  const tints = [GZ.tintX, GZ.tintY, GZ.tintZ];
  const o2 = project(P.o,B,foc); if (!o2) return;
  const mode = S.gizmoMode;
  g.lineCap = 'round';

  if (mode==='translate' || mode==='scale'){
    for (let a=0;a<3;a++){
      const tip = V3.add(P.o, V3.mul(P.ax[a], GZ.tip*P.reach));
      const t2 = project(tip,B,foc); if (!t2) continue;
      const hotKey = (mode==='translate'?'move':'scale')+a;
      const hot = gizmo.hot===hotKey || (gizmo.drag && gizmo.drag.key===hotKey);
      g.strokeStyle = tints[a]; g.lineWidth = hot?3.4:2.2;
      g.beginPath(); g.moveTo(o2[0],o2[1]); g.lineTo(t2[0],t2[1]); g.stroke();
      if (mode==='translate'){
        /* cone: triangle head oriented along the projected axis */
        const bse = project(V3.add(P.o, V3.mul(P.ax[a], (GZ.tip-GZ.coneH)*P.reach)),B,foc);
        if (bse){
          const dx=t2[0]-bse[0], dy=t2[1]-bse[1], L=Math.hypot(dx,dy)||1;
          const ux=dx/L, uy=dy/L, px=-uy, py=ux;
          const wr = GZ.coneR*P.reach*foc/t2[2]*(hot?1.25:1);
          g.beginPath();
          g.moveTo(t2[0]+ux*wr*2.2, t2[1]+uy*wr*2.2);
          g.lineTo(bse[0]+px*wr, bse[1]+py*wr);
          g.lineTo(bse[0]-px*wr, bse[1]-py*wr);
          g.closePath(); g.fillStyle = tints[a]; g.fill();
        }
      } else {
        const wr = GZ.cylR*P.reach*foc/t2[2]*(hot?1.5:1.1)*2;
        g.fillStyle = tints[a];
        g.fillRect(t2[0]-wr/2, t2[1]-wr/2, wr, wr);
      }
      P['_tip'+a] = t2;
    }
  }

  if (mode==='translate'){
    /* corner quads — X names the YZ quad (cyan), Y the XZ (magenta), Z the XY (yellow) */
    const quadTints = [GZ.tintYZ, GZ.tintXZ, GZ.tintXY];
    for (let a=0;a<3;a++){
      const u = P.ax[(a+1)%3], v = P.ax[(a+2)%3];
      const seat = GZ.tip*P.reach - GZ.quadHalf*P.reach;
      const half = GZ.quadHalf*P.reach;
      const cen = V3.add(P.o, V3.add(V3.mul(u,seat*0.45), V3.mul(v,seat*0.45)));
      const corn = [
        V3.add(cen, V3.add(V3.mul(u,-half), V3.mul(v,-half))),
        V3.add(cen, V3.add(V3.mul(u, half), V3.mul(v,-half))),
        V3.add(cen, V3.add(V3.mul(u, half), V3.mul(v, half))),
        V3.add(cen, V3.add(V3.mul(u,-half), V3.mul(v, half))),
      ].map(p=>project(p,B,foc));
      if (corn.some(c=>!c)) continue;
      const hot = gizmo.hot==='plane'+a || (gizmo.drag && gizmo.drag.key==='plane'+a);
      g.beginPath(); corn.forEach((c,i)=>i?g.lineTo(c[0],c[1]):g.moveTo(c[0],c[1])); g.closePath();
      g.globalAlpha = hot?GZ.quadAHover:GZ.quadA;
      g.fillStyle = quadTints[a]; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = quadTints[a]; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(corn[1][0],corn[1][1]); g.lineTo(corn[2][0],corn[2][1]);
      g.lineTo(corn[3][0],corn[3][1]); g.stroke();
      P['_quad'+a] = corn;
    }
  }

  if (mode==='rotate'){
    /* flat annular arcs, sweep 31 deg, centred on the camera-facing tangent */
    for (let a=0;a<3;a++){
      const u = P.ax[(a+1)%3], v = P.ax[(a+2)%3];
      const toEye = V3.norm(V3.sub(B.eye, P.o));
      let phi0 = Math.atan2(V3.dot(toEye,v), V3.dot(toEye,u));
      const hot = gizmo.hot==='turn'+a || (gizmo.drag && gizmo.drag.key==='turn'+a);
      const r = GZ.arcR*P.reach, band = GZ.arcBand*P.reach*(hot?2.0:1.4);
      g.strokeStyle = tints[a]; g.lineWidth = Math.max(2.4, band*foc/o2[2]);
      g.beginPath();
      let moved = false;
      for (let i=0;i<=GZ.arcSegs;i++){
        const t = phi0 - GZ.arcSweep + (i/GZ.arcSegs)*GZ.arcSweep*2;
        const p = project(V3.add(P.o, V3.add(V3.mul(u,Math.cos(t)*r), V3.mul(v,Math.sin(t)*r))),B,foc);
        if (!p) { moved=false; continue; }
        if (!moved){ g.moveTo(p[0],p[1]); moved = true; } else g.lineTo(p[0],p[1]);
      }
      g.stroke();
      const mid = project(V3.add(P.o, V3.add(V3.mul(u,Math.cos(phi0)*r), V3.mul(v,Math.sin(phi0)*r))),B,foc);
      P['_arc'+a] = mid;
    }
  }

  /* billboarded white ring — decoration in both builds */
  const rr = GZ.ringR*P.reach*foc/o2[2];
  g.beginPath(); g.arc(o2[0],o2[1],rr,0,7);
  g.strokeStyle = GZ.tintRing; g.lineWidth = 1.5; g.stroke();
  gizmo.pose = P; gizmo.o2 = o2;
}

/* grip probe in screen space */
function probeGrip(mx,my){
  const P = gizmo.pose; if (!P) return null;
  const mode = S.gizmoMode;
  if (mode==='translate'){
    for (let a=0;a<3;a++){
      const q = P['_quad'+a];
      if (q && pointInPoly(mx,my,q)) return 'plane'+a;
    }
    for (let a=0;a<3;a++){
      const t = P['_tip'+a];
      if (t && Math.hypot(mx-t[0],my-t[1]) < 14) return 'move'+a;
      if (t && gizmo.o2 && distToSeg(mx,my,gizmo.o2,t) < 7) return 'move'+a;
    }
  } else if (mode==='scale'){
    for (let a=0;a<3;a++){
      const t = P['_tip'+a];
      if (t && Math.hypot(mx-t[0],my-t[1]) < 14) return 'scale'+a;
      if (t && gizmo.o2 && distToSeg(mx,my,gizmo.o2,t) < 7) return 'scale'+a;
    }
  } else {
    for (let a=0;a<3;a++){
      const m = P['_arc'+a];
      if (m && Math.hypot(mx-m[0],my-m[1]) < 18) return 'turn'+a;
    }
  }
  return null;
}
function pointInPoly(x,y,poly){
  let inside=false;
  for (let i=0,j=poly.length-1;i<poly.length;j=i++){
    if (((poly[i][1]>y)!==(poly[j][1]>y)) &&
        (x < (poly[j][0]-poly[i][0])*(y-poly[i][1])/(poly[j][1]-poly[i][1])+poly[i][0])) inside=!inside;
  }
  return inside;
}
function distToSeg(x,y,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy||1;
  let t=((x-a[0])*dx+(y-a[1])*dy)/L2; t=Math.max(0,Math.min(1,t));
  return Math.hypot(x-(a[0]+dx*t), y-(a[1]+dy*t));
}

/* pointer ray */
function mouseRay(mx,my){
  const B = camBasis(), foc = focal();
  const dir = V3.norm(V3.add(V3.add(V3.mul(B.F,foc), V3.mul(B.R,mx-W/2)), V3.mul(B.U,H/2-my)));
  return { o:B.eye, d:dir };
}
function closestAxisT(o,axis, ray){
  /* parameter along the axis closest to the ray — the reference's own arithmetic */
  const w0 = V3.sub(o, ray.o);
  const a = 1, b = V3.dot(axis, ray.d), c = 1;
  const d = -V3.dot(axis,w0), e = -V3.dot(ray.d,w0);
  const den = a*c - b*b;
  if (Math.abs(den) < 1e-6) return null;
  return (b*e - c*d)/den;
}
function rayPlane(ray, o, nrm){
  const den = V3.dot(ray.d, nrm);
  if (Math.abs(den) < 1e-6) return null;
  const t = V3.dot(V3.sub(o,ray.o), nrm)/den;
  if (t < 0) return null;
  return V3.add(ray.o, V3.mul(ray.d,t));
}

/* begin / advance drags — Blender's rules, Ctrl snaps the TOTAL */
function beginGizmoDrag(key,mx,my){
  const P = gizmo.pose, n = S.selected; if (!P||!n) return false;
  const ray = mouseRay(mx,my);
  const fam = key.replace(/[0-9]/,''), a = +key.slice(-1);
  const drag = { key, fam, a, startPos: n.shape.pos.slice(), startSize: n.shape.size,
                 startYaw: n.shape.yaw||0, startTall: n.shape.tall };
  if (fam==='move' || fam==='scale'){
    const t = closestAxisT(P.o, P.ax[a], ray);
    if (t===null) return false;
    drag.startT = t;
  } else if (fam==='plane'){
    const hit = rayPlane(ray, P.o, P.ax[a]);
    if (!hit) return false;
    drag.startHit = hit;
  } else {
    const hit = rayPlane(ray, P.o, P.ax[a]) || rayPlane(ray,P.o,V3.mul(P.ax[a],-1));
    if (!hit) return false;
    const u = P.ax[(a+1)%3], v = P.ax[(a+2)%3], d = V3.sub(hit,P.o);
    drag.startAngle = Math.atan2(V3.dot(d,v), V3.dot(d,u));
  }
  gizmo.drag = drag;
  return true;
}
function advanceGizmoDrag(mx,my,snap){
  const D = gizmo.drag, P = gizmo.pose, n = S.selected; if (!D||!n) return;
  const ray = mouseRay(mx,my), s = n.shape;
  const AXN = ['X','Y','Z'];
  if (D.fam==='move'){
    let t = closestAxisT([D.startPos[0],D.startPos[1],D.startPos[2]], P.ax[D.a], ray);
    if (t===null) return;
    let dt = t - D.startT;
    if (snap) dt = Math.round(dt/GZ.snapMove)*GZ.snapMove;
    s.pos = D.startPos.slice(); s.pos[D.a] += dt;
    if (D.a===2) s.pos[2] = Math.max(0, s.pos[2]);
    return `${AXN[D.a]}  move ${dt.toFixed(3)}`;
  }
  if (D.fam==='plane'){
    const hit = rayPlane(ray, [D.startPos[0],D.startPos[1],D.startPos[2]], P.ax[D.a]);
    if (!hit) return;
    const u = P.ax[(D.a+1)%3], v = P.ax[(D.a+2)%3];
    let du = V3.dot(V3.sub(hit,D.startHit), u), dv = V3.dot(V3.sub(hit,D.startHit), v);
    if (snap){ du = Math.round(du/GZ.snapMove)*GZ.snapMove; dv = Math.round(dv/GZ.snapMove)*GZ.snapMove; }
    s.pos = D.startPos.slice();
    s.pos[(D.a+1)%3] += du; s.pos[(D.a+2)%3] += dv;
    s.pos[2] = Math.max(0, s.pos[2]);
    return `${AXN[(D.a+1)%3]}${AXN[(D.a+2)%3]}  move ${du.toFixed(2)}, ${dv.toFixed(2)}`;
  }
  if (D.fam==='scale'){
    const t = closestAxisT(D.startPos, P.ax[D.a], ray);
    if (t===null) return;
    let f = Math.max(0.05, Math.abs(t)/Math.max(0.05,Math.abs(D.startT)));
    if (snap) f = Math.max(0.05, Math.round(f/GZ.snapScale)*GZ.snapScale);
    s.size = D.startSize * f;
    return `${AXN[D.a]}  scale ${f.toFixed(2)}\u00d7`;
  }
  if (D.fam==='turn'){
    const hit = rayPlane(ray, P.o, P.ax[D.a]) || rayPlane(ray,P.o,V3.mul(P.ax[D.a],-1));
    if (!hit) return;
    const u = P.ax[(D.a+1)%3], v = P.ax[(D.a+2)%3], d = V3.sub(hit,P.o);
    let ang = Math.atan2(V3.dot(d,v), V3.dot(d,u)) - D.startAngle;
    while (ang > Math.PI) ang -= 2*Math.PI; while (ang < -Math.PI) ang += 2*Math.PI;
    if (snap) ang = Math.round(ang/GZ.snapTurn)*GZ.snapTurn;
    if (D.a===2) s.yaw = D.startYaw + ang;
    else { /* x/y arcs tilt the silhouette via the tall figure */
      s.tall = Math.max(0.15, (D.startTall||1) * (1 + Math.sin(ang)*0.6));
    }
    return `${AXN[D.a]}  turn ${(ang*180/Math.PI).toFixed(1)}\u00b0`;
  }
}

/* picking a shape */
function pickShape(mx,my){
  let best = null, bz = 1e9;
  for (const n of visibleShapes){
    const sc = n._screen; if (!sc) continue;
    const d = Math.hypot(mx-sc.x,my-sc.y);
    if (d < Math.max(12, sc.r) && sc.z < bz){ best = n; bz = sc.z; }
  }
  return best;
}

function markDirty(){ dirty = true; }
function restartAccumulation(){ S.samples = 0; }

/* frame a node (also the F key / find command) */
function frameNode(n){
  if (n && n.shape && n.shape.kind !== 'ground'){
    const s = n.shape;
    CAM.target = [s.pos[0], s.pos[1], s.pos[2] + s.size*0.5*(s.tall||1)];
    CAM.dist = Math.max(4, s.size*4.2);
  } else {
    CAM.target = [0, 9, 1.1]; CAM.dist = 14;
  }
  restartAccumulation(); markDirty();
}

let frameCounter = 0, lastT = performance.now(), fpsAcc = 0, fpsN = 0;
function tick(now){
  const dt = now - lastT; lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 500){ S.fps = Math.min(240, Math.round(1000/(fpsAcc/fpsN))); S.ms = (fpsAcc/fpsN); fpsAcc=0; fpsN=0; APP.statusTick(); }

  const running = S.mode !== 'edit' && !S.paused;
  if (running){
    S.time += dt/1000 * 0.02;
    S.sunElevation = 5.2 + Math.sin(S.time)*1.5;
    dirty = true;
    S.samples = 1;
  } else if (S.samples < S.sampleTarget*4){
    S.samples += Math.max(1, Math.round(dt/16.7));
  }

  if (dirty){ renderScene(); dirty = false; }

  /* composite: base + converging grain */
  ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(base,0,0);
  if (S.raytracing){
    const conv = Math.min(1, S.samples/S.sampleTarget);
    const alpha = 0.16 * (1-conv) + 0.025;
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'overlay';
    const ox = (Math.random()*160)|0, oy = (Math.random()*160)|0;
    for (let y=-oy; y<H*DPR; y+=160) for (let x=-ox; x<W*DPR; x+=160) ctx.drawImage(noiseTile,x,y);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  APP.hairlineTick();
  requestAnimationFrame(tick);
}

function initViewport(){
  cv = document.getElementById('view');
  ctx = cv.getContext('2d');
  base = document.createElement('canvas');
  bctx = base.getContext('2d');
  makeNoise();
  resize();
  new ResizeObserver(resize).observe(cv.parentElement);

  let drag = null;
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX-r.left, my = e.clientY-r.top;
    cv.setPointerCapture(e.pointerId);
    /* nav cluster first */
    for (const b of NAV.balls){
      if (Math.hypot(mx-b.x,my-b.y) < 8){
        CAM.yaw = Math.atan2(-b.d[0], -b.d[1]);
        CAM.pitch = b.d[2] ? -Math.sign(b.d[2])*1.45 : 0;
        restartAccumulation(); markDirty();
        return;
      }
    }
    if (e.button===0){
      const grip = probeGrip(mx,my);
      if (grip && beginGizmoDrag(grip,mx,my)){ drag = {kind:'gizmo'}; return; }
      drag = { kind:'pick', x:mx, y:my, moved:false, btn:0 };
    } else {
      drag = { kind: e.button===1 ? 'pan':'orbit', x:mx, y:my };
      e.preventDefault();
    }
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX-r.left, my = e.clientY-r.top;
    if (!drag){
      const grip = probeGrip(mx,my);
      if (grip !== gizmo.hot){ gizmo.hot = grip; markDirty(); }
      cv.style.cursor = grip ? 'grab' : 'crosshair';
      return;
    }
    if (drag.kind==='gizmo'){
      const txt = advanceGizmoDrag(mx,my,e.ctrlKey);
      if (txt) APP.gizmoReadout(txt);
      restartAccumulation(); markDirty(); APP.inspectorSoftRefresh();
      return;
    }
    if (drag.kind==='pick'){
      if (Math.hypot(mx-drag.x,my-drag.y) > 4){ drag = {kind:'orbit', x:mx, y:my}; }
      return;
    }
    const dx = mx-drag.x, dy = my-drag.y; drag.x=mx; drag.y=my;
    if (drag.kind==='orbit'){
      CAM.yaw += dx*0.008;
      CAM.pitch = Math.max(-1.5, Math.min(1.5, CAM.pitch + dy*0.006));
    } else {
      const B = camBasis(), k = CAM.dist*0.0016;
      CAM.target = V3.add(CAM.target, V3.add(V3.mul(B.R,-dx*k), V3.mul(B.U,dy*k)));
    }
    restartAccumulation(); markDirty();
  });
  cv.addEventListener('pointerup', e => {
    const r = cv.getBoundingClientRect(), mx = e.clientX-r.left, my = e.clientY-r.top;
    if (drag && drag.kind==='gizmo'){ gizmo.drag = null; APP.gizmoReadout(null); markDirty(); }
    else if (drag && drag.kind==='pick'){
      const hit = pickShape(mx,my);
      APP.select(hit, { fromViewport:true });
    }
    drag = null;
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    CAM.dist = Math.max(1.5, Math.min(120, CAM.dist * (e.deltaY>0?1.1:0.9)));
    restartAccumulation(); markDirty();
  }, { passive:false });

  requestAnimationFrame(tick);
}

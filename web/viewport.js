import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sketch, addEntity, setSelection, dist, removeNode } from "./model.js";
import { specFor, isDrawing } from "./tools.js";

// ============================================================================
//  Slate viewport — grid + workplanes + real sketch geometry + draw + gizmo.
//  Sketch coords are on the Ground (XZ) plane: model {x,z} -> world (x, 0, z).
// ============================================================================

const COLORS = {
  bg:0x11151b, x:0xe0483f, y:0x7ee787, z:0x4a7fff,
  planeX:0x1fc7c7, planeY:0xc81ec8, planeZ:0xe0cd12, ring:0xffffff,
  grid:0x2a3038, gridMajor:0x3a4450,
  geom:0x8fb0ff, geomFill:0x4a7fff, sel:0xffb44e, hover:0xffffff,
  construction:0x8a94a2, preview:0x7ee787, point:0xe6ebf2,
};

const canvas = document.getElementById("gl");
const viewport = document.getElementById("viewport");
const readoutEl = document.getElementById("readout");
const hintEl = document.getElementById("hint");

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
camera.position.set(5.5, 5, 6.5);

const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:"high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

// ---- on-screen diagnostics helper ----
const _diag = (m, ok=true) => { const e=document.getElementById('diag'); if(e){ e.textContent=m; e.style.color=ok?'#7fe0a0':'#ff8080'; } };
if (!renderer.getContext()) _diag('NO WEBGL CONTEXT', false);
let _frames = 0;

// 🔴 CONTEXT-LOSS RECOVERY. In a preview iframe the browser can throw away the
//    WebGL context (tab backgrounded, GPU pressure, iframe re-layout); without
//    a handler the canvas stays permanently blank. Prevent the default so the
//    context can be restored, then rebuild GPU resources when it comes back.
let contextLost = false;
canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); contextLost = true; }, false);
canvas.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  resize();
  rebuildAll();
}, false);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
// 🔴 ZOOM BEHAVIOUR. Keep the camera well in front of the near plane so zooming
//    in can never dive "into" the grid and go black, zoom toward the cursor so
//    it feels like a CAD app, and slow the wheel so one notch isn't a huge jump.
controls.minDistance = 2.5;
controls.maxDistance = 80;
controls.zoomSpeed = 0.6;
controls.zoomToCursor = true;
// left is reserved for drawing/selection; orbit on middle-drag, pan on right, dolly on wheel
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dl = new THREE.DirectionalLight(0xffffff, 0.85); dl.position.set(5,8,6); scene.add(dl);

// ---- grid + world axes ----
const grid = new THREE.GridHelper(40, 40, COLORS.gridMajor, COLORS.grid);
grid.material.opacity = 0.5; grid.material.transparent = true; scene.add(grid);
function axisLine(a,b,c){ return new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([a,b]),
  new THREE.LineBasicMaterial({color:c,transparent:true,opacity:0.55})); }
scene.add(axisLine(new THREE.Vector3(-20,0.002,0), new THREE.Vector3(20,0.002,0), COLORS.x));
scene.add(axisLine(new THREE.Vector3(0,0.002,-20), new THREE.Vector3(0,0.002,20), COLORS.z));

// ---- workplanes ----
const planesGroup = new THREE.Group(); scene.add(planesGroup);
function workplane(color, setup){
  const S=3.0, geo=new THREE.PlaneGeometry(S,S);
  const fill=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:0.07,depthWrite:false}));
  const frame=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color,transparent:true,opacity:0.4}));
  const g=new THREE.Group(); g.add(fill); g.add(frame); setup(g); planesGroup.add(g); return g;
}
workplane(COLORS.planeY,(g)=>{g.rotation.x=-Math.PI/2; g.position.y=0.001;}); // Ground XZ
workplane(COLORS.planeZ,(g)=>{});                                              // Front XY
workplane(COLORS.planeX,(g)=>{g.rotation.y=Math.PI/2;});                       // Right YZ

// ============================================================================
//  ENTITY RENDERING
// ============================================================================
const P = (p) => new THREE.Vector3(p.x, 0.004, p.z);   // lift a sketch point
const entityGroup = new THREE.Group(); scene.add(entityGroup);
const meshById = new Map();      // entity id -> { picks:[Object3D], visuals:[Object3D] }

function ringPoints(kind, g) {
  // returns an array of {x,z} forming the outline (closed for regions)
  switch (kind) {
    case 'line': return [g.a, g.b];
    case 'construction': return [g.a, g.b];
    case 'polyline': return g.pts;
    case 'rectangle': {
      const {a,b}=g; return [a,{x:b.x,z:a.z},b,{x:a.x,z:b.z},a];
    }
    case 'circle': {
      const out=[]; const N=64; for(let i=0;i<=N;i++){const t=i/N*Math.PI*2; out.push({x:g.c.x+g.r*Math.cos(t), z:g.c.z+g.r*Math.sin(t)});} return out;
    }
    case 'ellipse': {
      const out=[]; const N=64; for(let i=0;i<=N;i++){const t=i/N*Math.PI*2; out.push({x:g.c.x+g.rx*Math.cos(t), z:g.c.z+g.rz*Math.sin(t)});} return out;
    }
    case 'polygon': {
      const out=[]; const N=g.sides; for(let i=0;i<=N;i++){const t=i/N*Math.PI*2 - Math.PI/2; out.push({x:g.c.x+g.r*Math.cos(t), z:g.c.z+g.r*Math.sin(t)});} return out;
    }
    case 'slot': {
      const {a,b,r}=g; const dx=b.x-a.x, dz=b.z-a.z, len=Math.hypot(dx,dz)||1;
      const nx=-dz/len*r, nz=dx/len*r; const out=[];
      const N=16;
      for(let i=0;i<=N;i++){const t=Math.atan2(dz,dx)+Math.PI/2 - Math.PI*i/N; out.push({x:b.x+r*Math.cos(t),z:b.z+r*Math.sin(t)});}
      for(let i=0;i<=N;i++){const t=Math.atan2(dz,dx)-Math.PI/2 - Math.PI*i/N; out.push({x:a.x+r*Math.cos(t),z:a.z+r*Math.sin(t)});}
      out.push(out[0]); return out;
    }
    case 'arc': {
      // through a,b with bulge at m
      const pts=arcThrough(g.a, g.m, g.b); return pts;
    }
    case 'bezier':  return bezierCurve(g.pts);
    case 'spline':  return catmullRom(g.pts);
    default: return [];
  }
}
function isClosed(kind){ return ['rectangle','circle','ellipse','polygon','slot'].includes(kind); }

// ---- smooth curves ------------------------------------------------------
// De Casteljau Bézier through an arbitrary number of control points.
function bezierCurve(cps, perSeg=24){
  if(!cps || cps.length<2) return cps? [...cps] : [];
  if(cps.length===2) return [cps[0], cps[1]];
  const out=[]; const N=Math.max(perSeg, cps.length*12);
  for(let s=0;s<=N;s++){
    const t=s/N; const pts=cps.map((p)=>({x:p.x,z:p.z}));
    for(let k=1;k<pts.length;k++)
      for(let i=0;i<pts.length-k;i++){
        pts[i]={ x:pts[i].x+(pts[i+1].x-pts[i].x)*t, z:pts[i].z+(pts[i+1].z-pts[i].z)*t };
      }
    out.push(pts[0]);
  }
  return out;
}
// Catmull-Rom spline that passes THROUGH every control point (smooth, not kinked).
function catmullRom(cps, perSeg=20){
  if(!cps || cps.length<2) return cps? [...cps] : [];
  if(cps.length===2) return [cps[0], cps[1]];
  const p=cps; const out=[];
  const pt=(i)=>p[Math.max(0,Math.min(p.length-1,i))];
  for(let i=0;i<p.length-1;i++){
    const p0=pt(i-1),p1=pt(i),p2=pt(i+1),p3=pt(i+2);
    for(let s=0;s<perSeg;s++){
      const t=s/perSeg, t2=t*t, t3=t2*t;
      out.push({
        x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        z:0.5*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3),
      });
    }
  }
  out.push(p[p.length-1]);
  return out;
}

function arcThrough(a,m,b){
  // circle through 3 points; fall back to straight if collinear
  const ax=a.x,az=a.z,bx=m.x,bz=m.z,cx=b.x,cz=b.z;
  const d=2*(ax*(bz-cz)+bx*(cz-az)+cx*(az-bz));
  if(Math.abs(d)<1e-6) return [a,m,b];
  const ux=((ax*ax+az*az)*(bz-cz)+(bx*bx+bz*bz)*(cz-az)+(cx*cx+cz*cz)*(az-bz))/d;
  const uz=((ax*ax+az*az)*(cx-bx)+(bx*bx+bz*bz)*(ax-cx)+(cx*cx+cz*cz)*(bx-ax))/d;
  const cxy={x:ux,z:uz}; const r=Math.hypot(ax-ux,az-uz);
  let a0=Math.atan2(az-uz,ax-ux), a1=Math.atan2(cz-uz,cx-ux), am=Math.atan2(bz-uz,bx-ux);
  const norm=(x)=>{while(x<0)x+=2*Math.PI;while(x>=2*Math.PI)x-=2*Math.PI;return x;};
  a0=norm(a0);a1=norm(a1);am=norm(am);
  let start=a0,end=a1;
  // ensure am lies on the swept arc; pick direction
  let sweep=norm(end-start); let mid=norm(am-start);
  if(mid>sweep){ // go the other way
    const tmp=start;start=end;end=tmp; sweep=norm(end-start);
  }
  const out=[]; const N=48;
  for(let i=0;i<=N;i++){const t=start+sweep*i/N; out.push({x:ux+r*Math.cos(t), z:uz+r*Math.sin(t)});}
  return out;
}

function buildEntityObjects(ent){
  const objs = { picks:[], visuals:[], ent };
  const color = ent.construction ? COLORS.construction : COLORS.geom;

  if (ent.kind === 'point') {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06,16,16),
      new THREE.MeshBasicMaterial({color:COLORS.point}));
    dot.position.copy(P(ent.geom.p));
    objs.visuals.push(dot); objs.picks.push(dot);
    entityGroup.add(dot);
    meshById.set(ent.id, objs); dot.userData.entId = ent.id; return objs;
  }

  const outline = ringPoints(ent.kind, ent.geom).map(P);
  if (outline.length >= 2) {
    const mat = new THREE.LineBasicMaterial({ color });
    if (ent.construction) { mat.transparent=true; mat.opacity=0.7; }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), mat);
    objs.visuals.push(line); objs.picks.push(line);
    entityGroup.add(line);

    // filled face for closed regions
    if (isClosed(ent.kind)) {
      const shape = new THREE.Shape(outline.map((v)=>new THREE.Vector2(v.x, v.z)));
      const geo = new THREE.ShapeGeometry(shape);
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color:COLORS.geomFill, transparent:true, opacity:0.14, side:THREE.DoubleSide, depthWrite:false }));
      fill.rotation.x = Math.PI/2; fill.position.y = 0.003;
      objs.visuals.push(fill); objs.picks.push(fill);
      entityGroup.add(fill);
    }
    // control polygon (dashed) for curves so the controls are visible
    if (ent.kind==='bezier' || ent.kind==='spline') {
      const cps=(ent.geom.pts||[]).map(P);
      if(cps.length>=2){
        const cg=new THREE.BufferGeometry().setFromPoints(cps);
        const cmat=new THREE.LineDashedMaterial({color:COLORS.construction, dashSize:0.18, gapSize:0.12, transparent:true, opacity:0.55});
        const cline=new THREE.Line(cg,cmat); cline.computeLineDistances();
        objs.visuals.push(cline); entityGroup.add(cline);
      }
    }
    // vertex / control handles
    const vpts = ent.kind==='circle'||ent.kind==='polygon'||ent.kind==='ellipse'
      ? [ent.geom.c]
      : ent.kind==='bezier'||ent.kind==='spline'||ent.kind==='polyline'
      ? (ent.geom.pts||[])
      : ringPoints(ent.kind, ent.geom);
    for (const vp of vpts) {
      const h=new THREE.Mesh(new THREE.SphereGeometry(0.05,12,12),
        new THREE.MeshBasicMaterial({color:0xffd166}));
      h.position.copy(P(vp)); h.visible=false; objs.visuals.push(h); entityGroup.add(h); objs.handles = objs.handles||[]; objs.handles.push(h);
    }
  }
  objs.picks.forEach((o)=>o.userData.entId = ent.id);
  meshById.set(ent.id, objs);
  return objs;
}

function clearEntityObjects(id){
  const o = meshById.get(id); if(!o) return;
  [...o.visuals].forEach((m)=>{ entityGroup.remove(m); m.geometry?.dispose?.(); m.material?.dispose?.(); });
  meshById.delete(id);
}

export function rebuildAll(){
  [...meshById.keys()].forEach(clearEntityObjects);
  const seen = new Set();
  const walk = (list)=>list.forEach((n)=>{ if(n.type==='folder') walk(n.children); else { buildEntityObjects(n); seen.add(n.id);} });
  walk(Sketch.root);
  applySelectionStyles();
}

function applySelectionStyles(){
  for (const [id,o] of meshById) {
    const selected = Sketch.selection.has(id);
    const hovered = Sketch.hover === id;
    const base = o.ent.construction ? COLORS.construction : (o.ent.kind==='point'?COLORS.point:COLORS.geom);
    const col = selected ? COLORS.sel : hovered ? COLORS.hover : base;
    for (const v of o.visuals) {
      if (v.type==='Line' && v.material?.color) { v.material.color.setHex(col); }
      else if (o.ent.kind==='point' && v.material?.color) { v.material.color.setHex(col); }
    }
    if (o.handles) o.handles.forEach((h)=>h.visible=selected);
  }
}

// ============================================================================
//  POINTER: snapping + drawing + selection
// ============================================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
let snapEnabled = true;
const GRID_STEP = 0.5;

function setPointer(e){
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX-r.left)/r.width)*2-1;
  pointer.y = -((e.clientY-r.top)/r.height)*2+1;
}
function groundPoint(e, snap){
  setPointer(e); raycaster.setFromCamera(pointer, camera);
  const hit=new THREE.Vector3();
  if(!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
  let x=hit.x, z=hit.z;
  if (snap && snapEnabled) { x=Math.round(x/GRID_STEP)*GRID_STEP; z=Math.round(z/GRID_STEP)*GRID_STEP; }
  return {x, z};
}

// ---- live preview objects ----
const previewGroup = new THREE.Group(); scene.add(previewGroup);
function clearPreview(){ [...previewGroup.children].forEach((c)=>{previewGroup.remove(c);c.geometry?.dispose?.();c.material?.dispose?.();}); }
function drawPreviewOutline(pts, closed, color=COLORS.preview, control=null){
  clearPreview();
  if(pts.length>=2){
    const v=pts.map(P);
    const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(v),
      new THREE.LineBasicMaterial({color, transparent:true, opacity:0.9}));
    previewGroup.add(l);
  }
  // dashed control polygon for curves
  if(control && control.length>=2){
    const cv=control.map(P);
    const cl=new THREE.Line(new THREE.BufferGeometry().setFromPoints(cv),
      new THREE.LineDashedMaterial({color:COLORS.construction, dashSize:0.16, gapSize:0.11, transparent:true, opacity:0.5}));
    cl.computeLineDistances(); previewGroup.add(cl);
  }
  // control/vertex dots: use control points for curves, else the outline
  const dots = control || pts;
  for(const p of dots){
    const d=new THREE.Mesh(new THREE.SphereGeometry(0.05,10,10), new THREE.MeshBasicMaterial({color:0xffd166}));
    d.position.copy(P(p)); previewGroup.add(d);
  }
}

// ---- drawing state machine ----
let draw = null;   // { glyph, spec, pts:[] }
function beginDrawIfNeeded(){
  const g = Sketch.activeTool.glyph;
  if (isDrawing(g)) { draw = { glyph:g, spec:specFor(g), pts:[] }; }
  else draw = null;
}

function previewFor(glyph, pts, cursor){
  const spec = specFor(glyph); const kind = spec.kind;
  const all = cursor ? [...pts, cursor] : pts;
  if (kind==='line' || glyph==='construction') return { pts: all.slice(0,2), closed:false };
  if (kind==='polyline') return { pts: all, closed:false };
  if (kind==='bezier') return { pts: bezierCurve(all), closed:false, control:all };
  if (kind==='spline') return { pts: catmullRom(all), closed:false, control:all };
  if (kind==='rectangle' && all.length>=2){ const a=all[0],b=all[1];
    return { pts:[a,{x:b.x,z:a.z},b,{x:a.x,z:b.z},a], closed:true }; }
  if (kind==='circle' && all.length>=2){ const c=all[0]; const r=dist(c,all[1]);
    return { pts: ringPoints('circle',{c,r}), closed:true }; }
  if (kind==='ellipse' && all.length>=2){ const c=all[0]; const rx=Math.abs(all[1].x-c.x), rz=Math.abs(all[1].z-c.z);
    return { pts: ringPoints('ellipse',{c,rx:rx||0.01,rz:rz||0.01}), closed:true }; }
  if (kind==='polygon' && all.length>=2){ const c=all[0]; const r=dist(c,all[1]);
    return { pts: ringPoints('polygon',{c,r,sides:spec.sides||6}), closed:true }; }
  if (kind==='slot' && all.length>=2){ const a=all[0],b=all[1];
    return { pts: ringPoints('slot',{a,b,r:0.4}), closed:true }; }
  if (kind==='arc' && all.length>=2){
    if(all.length===2) return { pts:[all[0],all[1]], closed:false };
    return { pts: arcThrough(all[0], all[2], all[1]), closed:false };
  }
  if (kind==='point') return { pts: all.slice(0,1), closed:false };
  return { pts: all, closed:false };
}

function commitDraw(){
  if(!draw) return;
  const {glyph, spec, pts}=draw; const kind=spec.kind;
  let ent=null;
  const targetFolder = firstSelectedFolder();
  if (kind==='point') ent = { kind, glyph, construction:spec.construction, geom:{p:pts[0]} };
  else if (kind==='line') ent = { kind, glyph, construction:spec.construction, geom:{a:pts[0],b:pts[1]} };
  else if (kind==='rectangle') ent = { kind, glyph, geom:{a:pts[0],b:pts[1]} };
  else if (kind==='circle') ent = { kind, glyph, geom:{c:pts[0], r:dist(pts[0],pts[1])} };
  else if (kind==='ellipse') ent = { kind, glyph, geom:{c:pts[0], rx:Math.abs(pts[1].x-pts[0].x)||0.5, rz:Math.abs(pts[1].z-pts[0].z)||0.5} };
  else if (kind==='polygon') ent = { kind, glyph, geom:{c:pts[0], r:dist(pts[0],pts[1]), sides:spec.sides||6} };
  else if (kind==='slot') ent = { kind, glyph, geom:{a:pts[0],b:pts[1],r:0.4} };
  else if (kind==='polyline') ent = { kind, glyph, geom:{pts:[...pts]} };
  else if (kind==='bezier') ent = { kind, glyph, geom:{pts:[...pts]} };
  else if (kind==='spline') ent = { kind, glyph, geom:{pts:[...pts]} };
  else if (kind==='arc') ent = { kind, glyph, geom:{a:pts[0], b:pts[1], m:pts[2]} };
  if(!ent) { draw=null; clearPreview(); return; }
  ent.name = labelForEnt(ent);
  addEntity(ent, targetFolder);
  const g=Sketch.activeTool.glyph;
  draw = isDrawing(g) ? { glyph:g, spec:specFor(g), pts:[] } : null; // ready for the next one
  clearPreview();
  Sketch.emit('draw');
  setSelection([ent.id]);
}

function labelForEnt(ent){
  switch(ent.kind){
    case 'line': return (ent.construction?'Guide · ':'Line · ')+round(dist(ent.geom.a,ent.geom.b))+' m';
    case 'rectangle': return `Rectangle · ${round(Math.abs(ent.geom.b.x-ent.geom.a.x))}×${round(Math.abs(ent.geom.b.z-ent.geom.a.z))}`;
    case 'circle': return `Circle · r ${round(ent.geom.r)} m`;
    case 'ellipse': return `Ellipse · ${round(ent.geom.rx)}×${round(ent.geom.rz)}`;
    case 'polygon': return `Polygon · ${ent.geom.sides} sides`;
    case 'slot': return `Slot · ${round(dist(ent.geom.a,ent.geom.b))} m`;
    case 'polyline': return `Polyline · ${ent.geom.pts.length} pts`;
    case 'bezier': return `Bézier · ${ent.geom.pts.length} ctrl pts`;
    case 'spline': return `Spline · ${ent.geom.pts.length} pts`;
    case 'arc': return `Arc`;
    case 'point': return `Point`;
    default: return ent.kind;
  }
}
const round=(v)=>Math.round(v*100)/100;

function firstSelectedFolder(){
  for(const id of Sketch.selection){ const n=Sketch.index.get(id);
    if(n?.type==='folder') return n; if(n?.parent) return n.parent; }
  // default: first top-level folder if any
  const f=Sketch.root.find((n)=>n.type==='folder'); return f||null;
}

function readout(t){ readoutEl.textContent=t; readoutEl.classList.remove('hidden'); }
function hideReadout(){ readoutEl.classList.add('hidden'); }

// ---- pointer events ----
renderer.domElement.addEventListener('contextmenu',(e)=>e.preventDefault());

renderer.domElement.addEventListener('pointermove',(e)=>{
  if (gizmoDrag) return;   // handled by the gizmo drag listener below
  const drawing = draw && isDrawing(Sketch.activeTool.glyph);
  if (drawing) {
    const cur = groundPoint(e, true);
    if (cur){
      const pv = previewFor(draw.glyph, draw.pts, cur);
      drawPreviewOutline(pv.pts, pv.closed, COLORS.preview, pv.control);
      const stepInfo = liveDimText(draw, cur);
      readout(stepInfo);
    }
    return;
  }
  // hover-pick entities
  setPointer(e); raycaster.setFromCamera(pointer,camera);
  const picks=[]; for(const o of meshById.values()) picks.push(...o.picks);
  const hit=raycaster.intersectObjects(picks,false)[0];
  const id = hit? hit.object.userData.entId : null;
  if (id!==Sketch.hover){ Sketch.hover=id; applySelectionStyles();
    renderer.domElement.style.cursor = id?'pointer':(drawing?'crosshair':'default'); }
});

renderer.domElement.addEventListener('pointerdown',(e)=>{
  if(e.button!==0) return;   // left only for tools/selection
  const glyph=Sketch.activeTool.glyph;
  if (isDrawing(glyph)) {
    if(!draw) beginDrawIfNeeded();
    const p = groundPoint(e, true); if(!p) return;
    draw.pts.push(p);
    const spec=draw.spec;
    if (spec.clicks && draw.pts.length>=spec.clicks) commitDraw();
    else { const pv=previewFor(draw.glyph, draw.pts, p); drawPreviewOutline(pv.pts,pv.closed,COLORS.preview,pv.control); }
    return;
  }
  // selection pick
  setPointer(e); raycaster.setFromCamera(pointer,camera);
  const picks=[]; for(const o of meshById.values()) picks.push(...o.picks);
  const hit=raycaster.intersectObjects(picks,false)[0];
  if(hit){ setSelection([hit.object.userData.entId], e.shiftKey||e.ctrlKey||e.metaKey); }
  else if(!e.shiftKey){ setSelection([]); }
});

// double-click / enter / esc finishes a chain (polyline)
renderer.domElement.addEventListener('dblclick',()=>{
  if(draw && draw.spec.chain && draw.pts.length>=2){ commitDraw(); }
});
window.addEventListener('keydown',(e)=>{
  if(e.key==='Enter' && draw && draw.spec.chain && draw.pts.length>=2){ commitDraw(); }
  if(e.key==='Escape'){ if(draw){ draw.pts=[]; clearPreview(); hideReadout(); } setSelection([]); }
  if(e.key==='Delete'||e.key==='Backspace'){
    const tag=(e.target&&e.target.tagName)||''; if(tag==='INPUT'||tag==='TEXTAREA') return;
    const ids=[...Sketch.selection]; if(ids.length){ ids.forEach((id)=>removeNode(id)); Sketch.emit('remove'); }
  }
  if(e.key==='g') { snapEnabled=!snapEnabled; readout(`snap ${snapEnabled?'on':'off'}`); setTimeout(hideReadout,900); }
});

function liveDimText(draw, cur){
  const {glyph,pts,spec}=draw; const kind=spec.kind;
  if(kind==='line'&&pts.length>=1) return `L ${round(dist(pts[0],cur))} m`;
  if(kind==='rectangle'&&pts.length>=1) return `${round(Math.abs(cur.x-pts[0].x))} × ${round(Math.abs(cur.z-pts[0].z))} m`;
  if(kind==='circle'&&pts.length>=1) return `r ${round(dist(pts[0],cur))} m`;
  if(kind==='polygon'&&pts.length>=1) return `r ${round(dist(pts[0],cur))} m · ${spec.sides} sides`;
  if(kind==='polyline') return `${pts.length} pts · click to add · double-click to finish`;
  if(kind==='point') return `point`;
  return `click to place`;
}

// react to tool changes
Sketch.on((reason)=>{
  if(reason==='tool'){ beginDrawIfNeeded(); clearPreview(); hideReadout();
    const g=Sketch.activeTool.glyph;
    renderer.domElement.style.cursor = isDrawing(g)?'crosshair':'default';
    hintEl.textContent = isDrawing(g)
      ? `${Sketch.activeTool.name}: click on the Ground plane to place points · G toggles snap`
      : `${Sketch.activeTool.name} is not an interactive tool yet · pick a 2D primitive`;
  }
  if(['draw','remove','move','seed','newfolder'].includes(reason)) rebuildAll();
  if(reason==='selection') { applySelectionStyles(); syncGizmoTarget(); }
});

// ============================================================================
//  TRANSFORM GIZMO (shown on the selected entity's centroid)
// ============================================================================
const gizmo = new THREE.Group(); scene.add(gizmo); gizmo.visible=false;
const gizmoHandles=[];
buildGizmo();
function buildGizmo(){
  const AX=[
    {n:'x',c:COLORS.x,d:new THREE.Vector3(1,0,0)},
    {n:'y',c:COLORS.y,d:new THREE.Vector3(0,1,0)},
    {n:'z',c:COLORS.z,d:new THREE.Vector3(0,0,1)},
  ];
  const TIP=1.0;
  const orientY=(m,d)=>{const q=new THREE.Quaternion();q.setFromUnitVectors(new THREE.Vector3(0,1,0),d);m.quaternion.copy(q);};
  for(const a of AX){
    const mat=new THREE.MeshStandardMaterial({color:a.c,roughness:0.45,metalness:0.1});
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.012,TIP-0.2,8),mat.clone());
    shaft.position.copy(a.d.clone().multiplyScalar((TIP-0.2)/2)); orientY(shaft,a.d); gizmo.add(shaft);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(0.06,0.18,20),mat.clone());
    cone.position.copy(a.d.clone().multiplyScalar(TIP)); orientY(cone,a.d); gizmo.add(cone);
    cone.userData={axis:a.n,dir:a.d.clone()}; gizmoHandles.push(cone);
  }
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.16,0.008,10,40),new THREE.MeshBasicMaterial({color:COLORS.ring}));
  gizmo.add(ring); gizmo.userData.ring=ring;
}
function entityCentroid(ent){
  const pts = ent.kind==='point'?[ent.geom.p]
    : ent.kind==='circle'||ent.kind==='polygon'||ent.kind==='ellipse'?[ent.geom.c]
    : ringPoints(ent.kind, ent.geom);
  let sx=0,sz=0; pts.forEach((p)=>{sx+=p.x;sz+=p.z;}); const n=pts.length||1;
  return {x:sx/n, z:sz/n};
}
let gizmoEnt=null;
function syncGizmoTarget(){
  const ids=[...Sketch.selection].filter((id)=>Sketch.index.get(id)?.type==='entity');
  if(ids.length!==1){ gizmo.visible=false; gizmoEnt=null; return; }
  gizmoEnt=Sketch.index.get(ids[0]);
  const c=entityCentroid(gizmoEnt);
  gizmo.position.set(c.x,0.02,c.z); gizmo.visible=true;
}
// drag the gizmo to translate the whole entity on the ground plane
let gizmoDrag=null;
renderer.domElement.addEventListener('pointerdown',(e)=>{
  if(e.button!==0||!gizmo.visible||isDrawing(Sketch.activeTool.glyph)) return;
  setPointer(e); raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(gizmoHandles,false)[0];
  if(!hit) return;
  e.stopPropagation(); controls.enabled=false;
  const axis=hit.object.userData.axis;
  gizmoDrag={ axis, start:groundPoint(e,false), origin:snapshot(gizmoEnt) };
},true);
renderer.domElement.addEventListener('pointermove',(e)=>{
  if(!gizmoDrag) return;
  const cur=groundPoint(e,false); if(!cur) return;
  let dx=cur.x-gizmoDrag.start.x, dz=cur.z-gizmoDrag.start.z;
  if(gizmoDrag.axis==='x') dz=0; if(gizmoDrag.axis==='z') dx=0;
  if(gizmoDrag.axis==='y'){ dx=0; dz=0; } // ground sketch: no Y move
  translateEntity(gizmoEnt, gizmoDrag.origin, dx, dz);
  rebuildAll(); syncGizmoTarget();
  readout(`move ${gizmoDrag.axis.toUpperCase()} Δ ${round(Math.hypot(dx,dz))} m`);
});
window.addEventListener('pointerup',()=>{ if(gizmoDrag){ gizmoDrag=null; controls.enabled=true; hideReadout(); Sketch.emit('draw'); } });

function snapshot(ent){ return JSON.parse(JSON.stringify(ent.geom)); }
function translateEntity(ent, origin, dx, dz){
  const shift=(p)=>({x:p.x+dx, z:p.z+dz});
  const g=ent.geom;
  if(ent.kind==='point') g.p=shift(origin.p);
  else if('a' in origin && 'b' in origin){ g.a=shift(origin.a); g.b=shift(origin.b); if(origin.m)g.m=shift(origin.m); }
  else if('c' in origin){ g.c=shift(origin.c); }
  else if('pts' in origin){ g.pts=origin.pts.map(shift); }
}

// ============================================================================
//  CORNER NAV GIZMO
// ============================================================================
const navScene=new THREE.Scene();
const navCam=new THREE.OrthographicCamera(-1.6,1.6,1.6,-1.6,0.1,10); navCam.position.set(0,0,4);
const navGroup=new THREE.Group(); navScene.add(navGroup);
function navBall(dir,color,letter,filled){
  const g=new THREE.Group();
  const ball=new THREE.Mesh(new THREE.SphereGeometry(0.34,18,18),
    filled?new THREE.MeshBasicMaterial({color}):new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.35}));
  ball.position.copy(dir); g.add(ball);
  if(filled){
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),dir]),new THREE.LineBasicMaterial({color})));
    const cv=document.createElement('canvas');cv.width=cv.height=64;const cx=cv.getContext('2d');
    cx.fillStyle='#0a0a0a';cx.font='bold 44px sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(letter,32,34);
    const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),depthTest:false}));
    spr.scale.set(0.5,0.5,0.5);spr.position.copy(dir);g.add(spr);
  }
  navGroup.add(g);
}
navBall(new THREE.Vector3(1,0,0),COLORS.x,'X',true); navBall(new THREE.Vector3(-1,0,0),COLORS.x,'',false);
navBall(new THREE.Vector3(0,1,0),COLORS.y,'Y',true); navBall(new THREE.Vector3(0,-1,0),COLORS.y,'',false);
navBall(new THREE.Vector3(0,0,1),COLORS.z,'Z',true); navBall(new THREE.Vector3(0,0,-1),COLORS.z,'',false);

// ============================================================================
//  LOOP
// ============================================================================
function resize(){
  // 🔴 A ZERO OR DEGENERATE SIZE MAKES camera.aspect NaN AND BLANKS THE VIEW.
  //    The viewport can measure 0×0 for a frame during panel layout or when the
  //    preview iframe is first shown; guard against it so the projection stays
  //    finite and the canvas keeps drawing.
  const w = Math.max(1, viewport.clientWidth);
  const h = Math.max(1, viewport.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
// re-measure when the tab/preview becomes visible again
document.addEventListener('visibilitychange', () => { if (!document.hidden) resize(); });
window.addEventListener('focus', resize);
resize();

function render(){
  requestAnimationFrame(render);
  // don't touch a lost context, and skip frames where the panel has no size yet
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (contextLost || w < 2 || h < 2) return;

  try {
    _frames++;
    if (_frames % 60 === 0) _diag(`live · ${w}×${h} · cam ${camera.position.distanceTo(controls.target).toFixed(1)}u · f${_frames}`);
    controls.update();
    if(gizmo.visible){ const d=camera.position.distanceTo(gizmo.position); gizmo.scale.setScalar(d*0.11);
      gizmo.userData.ring.quaternion.copy(camera.quaternion); }
    renderer.setViewport(0,0,w,h); renderer.setScissorTest(false);
    renderer.render(scene,camera);
    const size=90,pad=12; navGroup.quaternion.copy(camera.quaternion).invert();
    renderer.clearDepth(); renderer.setScissorTest(true);
    const x=w-size-pad, y=h-size-pad;
    renderer.setViewport(x,y,size,size); renderer.setScissor(x,y,size,size);
    renderer.render(navScene,navCam); renderer.setScissorTest(false);
  } catch (err) {
    // a transient error must never permanently stop the loop (rAF is already queued)
    console.error('[viewport] frame error:', err);
  }
}
render();

export function initViewport(){ rebuildAll(); }

/* ============================================================================
   SCENE — the Project-Zero "Showcase" roster the native editor seeds
   (EditorHost + ProjectZeroInterchange), extended with the generator
   entities the request asked for: a Vehicle rig (tyres, rims, suspension)
   and a Cloth sheet, each with its newly-filled-in artwork.
   Narrowing masks and pill tints mirror EditorHost.cpp's filter catalogue.
   ========================================================================== */

'use strict';

/* seeded RNG so the showcase field is identical every run (deterministic proofs) */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rng = mulberry32(0x5A17);

const NARROW = {
  Lights:   { tint:'#FFB454' },
  Sky:      { tint:'#5AA9FF' },
  Bodies:   { tint:'#DFE6F5' },
  Geometry: { tint:'#E2E8F0' },
  Camera:   { tint:'#34C759' },
};

let _id = 0;
function N(label, opts = {}) {
  return Object.assign({
    id: ++_id, label, icon: 'mesh', cat: 'Geometry', narrow: 'Geometry',
    value: '', status: 'ok', visible: true, locked: false, dynamic: false,
    physics: false, open: false, children: null, shape: null, notes: '',
    artTint: null, sheet: null,
  }, opts);
}

/* per-entry colour — "a box with a different colour for each entry" */
const HUES = [312, 2, 190, 215, 28, 262, 95, 330, 160, 45, 285, 10, 205, 140, 350, 70, 230, 18];
function entryColour(i){
  const h = HUES[i % HUES.length] + (rng()*18 - 9);
  const s = 52 + rng()*26, l = 48 + rng()*16;
  return `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`;
}

const KIND_TRIS = { box:12, pyramid:6, sphere:960, cone:64, cylinder:128, torus:768, plane:2 };

/* scattered primitive field matching the showcase CPU reference */
function makeField(count){
  const kinds = ['box','pyramid','box','pyramid','sphere','cone','box','pyramid','cylinder'];
  const out = [];
  for (let i = 0; i < count; i++){
    const kind = kinds[(rng()*kinds.length)|0];
    const s = 0.5 + rng()*1.7;
    const d = 3 + rng()*34;
    const a = rng()*Math.PI*2;
    const nm = kind[0].toUpperCase()+kind.slice(1)+' '+String(i+1).padStart(3,'0');
    out.push(N(nm, {
      icon: kind, value: KIND_TRIS[kind]>=1000 ? (KIND_TRIS[kind]/1000).toFixed(1)+'k tris' : KIND_TRIS[kind]+' tris',
      dynamic: rng() < .3, physics: rng() < .2,
      shape: { kind, pos:[Math.sin(a)*d, Math.cos(a)*d, 0], size:s, yaw: rng()*Math.PI*2,
               color: entryColour(i), tris: KIND_TRIS[kind] },
    }));
  }
  return out;
}

/* ── the named Cornell-shelf actors the command line knows ── */
const NAMED = [
  N('Tall Box',  { icon:'box',     value:'12 tris',  dynamic:true, shape:{kind:'box',    pos:[ 0.0,  6.0,0], size:2.2, tall:2.1, yaw:.35, color:'hsl(302,72%,58%)', tris:12 }}),
  N('Cube',      { icon:'box',     value:'12 tris',  dynamic:true, shape:{kind:'box',    pos:[-3.2,  9.5,0], size:1.7, yaw:.1,  color:'hsl(212,62%,58%)', tris:12 }}),
  N('Sphere',    { icon:'sphere',  value:'960 tris', dynamic:true, shape:{kind:'sphere', pos:[ 3.4,  8.2,0], size:1.2, yaw:0,   color:'hsl(158,55%,52%)', tris:960 }}),
  N('Pyramid',   { icon:'pyramid', value:'6 tris',   dynamic:true, shape:{kind:'pyramid',pos:[ 1.6, 11.5,0], size:2.6, tall:1.6, yaw:.6, color:'hsl(6,64%,56%)',  tris:6 }}),
  N('Cone',      { icon:'cone',    value:'64 tris',  dynamic:true, shape:{kind:'cone',   pos:[-1.8, 13.8,0], size:1.9, tall:1.4, yaw:0,  color:'hsl(188,60%,52%)', tris:64 }}),
];

/* ── vehicle rig + cloth — the entries whose icons were missing ── */
const VEHICLE_KIDS = [
  N('Body',            { icon:'vehicle',   value:'12.4k tris', dynamic:true, physics:true,
      shape:{kind:'box', pos:[7.5,14,1.05], size:4.4, tall:.62, flat:.42, yaw:-.5, color:'hsl(348,60%,50%)', tris:12412 }}),
  N('Tyre FL',         { icon:'tyre',      value:'245/35 R21', dynamic:true, physics:true,
      shape:{kind:'cylinder', pos:[6.1,12.6,0.45], size:.9, tall:.42, lay:true, yaw:-.5, color:'hsl(220,8%,16%)', tris:1824 }}),
  N('Tyre FR',         { icon:'tyre',      value:'245/35 R21', dynamic:true, physics:true,
      shape:{kind:'cylinder', pos:[7.9,11.8,0.45], size:.9, tall:.42, lay:true, yaw:-.5, color:'hsl(220,8%,16%)', tris:1824 }}),
  N('Tyre RL',         { icon:'tyre',      value:'305/30 R21', dynamic:true, physics:true,
      shape:{kind:'cylinder', pos:[7.2,16.1,0.45], size:.95, tall:.5, lay:true, yaw:-.5, color:'hsl(220,8%,16%)', tris:1824 }}),
  N('Tyre RR',         { icon:'tyre',      value:'305/30 R21', dynamic:true, physics:true,
      shape:{kind:'cylinder', pos:[9.0,15.3,0.45], size:.95, tall:.5, lay:true, yaw:-.5, color:'hsl(220,8%,16%)', tris:1824 }}),
  N('Rim Set',         { icon:'rim',       value:'21 in',  dynamic:true, narrow:'Bodies' }),
  N('Suspension',      { icon:'suspension',value:'4 coils', dynamic:true, physics:true, narrow:'Bodies' }),
];

const SCENE = [
  N('Environment', { icon:'folderEnv', cat:'Folder', narrow:'Sky', open:true, children: [
    N('Atmosphere',      { icon:'atmosphere', cat:'Env', narrow:'Sky', value:'AM 10.2' }),
    N('Sun',             { icon:'sun',  cat:'Light', narrow:'Lights', value:'5.2°', dynamic:true, artTint:'#f5a623' }),
    N('Sky',             { icon:'sky',  cat:'Env', narrow:'Sky', value:'5.00 kcd' }),
    N('Stars',           { icon:'stars',cat:'Env', narrow:'Sky', value:'mag ~1.3', status:'warn', notes:'Washed out while the sun is above the horizon.' }),
    N('Moon',            { icon:'moon', cat:'Light', narrow:'Lights', value:'1/4' }),
    N('Wind',            { icon:'wind', cat:'Env', narrow:'Sky', value:'4.2 m/s SW', dynamic:true }),
    N('Height Fog',      { icon:'fog',  cat:'Env', narrow:'Sky', value:'391 m' }),
    N('Atmospheric Fog', { icon:'fog',  cat:'Env', narrow:'Sky', value:'56 km' }),
    N('Clouds',          { icon:'cloud',cat:'Env', narrow:'Sky', value:'42%', dynamic:true }),
    N('Precipitation',   { icon:'rain', cat:'Env', narrow:'Sky', value:'0 mm/h', status:'quiet' }),
    N('Rainbow',         { icon:'rainbow', cat:'Env', narrow:'Sky', value:'', status:'quiet', visible:false }),
    N('Lens Flare',      { icon:'lensflare', cat:'Env', narrow:'Sky', value:'0.4×' }),
  ]}),
  N('Cameras', { icon:'camera', cat:'Folder', narrow:'Camera', open:true, children: [
    N('Main Camera', { icon:'camera', cat:'Camera', narrow:'Camera', value:'55°', dynamic:true }),
    N('Camera', { icon:'camera', cat:'Camera', narrow:'Camera', value:'72°', open:true, children: [
      N('Post Pro',    { icon:'postpro', cat:'Camera', narrow:'Camera', value:'+0.4 EV', badge:'COMP' }),
      N('Cine Camera', { icon:'cine',    cat:'Camera', narrow:'Camera', value:'35 mm' }),
    ]}),
  ]}),
  N('World', { icon:'folderWorld', cat:'Folder', narrow:'Bodies', open:true, children: [
    N('Ground', { icon:'plane', value:'2 tris', shape:{kind:'ground'} }),
    ...NAMED,
    N('Vehicle', { icon:'vehicle', cat:'Folder', narrow:'Bodies', open:false, children: VEHICLE_KIDS }),
    N('Cloth',   { icon:'cloth', value:'64×64', dynamic:true, physics:true, narrow:'Bodies',
        shape:{kind:'cloth', pos:[-7.5,13,0], size:2.6, yaw:.4, color:'hsl(42,65%,72%)', tris:8192 }}),
    N('Geometry', { icon:'folder', cat:'Folder', narrow:'Geometry', open:false, children: makeField(92) }),
  ]}),
];

/* flattened traversal helpers */
function eachNode(fn, nodes = SCENE, depth = 0, parent = null){
  for (const n of nodes){
    fn(n, depth, parent);
    if (n.children) eachNode(fn, n.children, depth + 1, n);
  }
}
function findNode(pred){
  let hit = null;
  eachNode(n => { if (!hit && pred(n)) hit = n; });
  return hit;
}
function findByName(text){
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return findNode(n => n.label.toLowerCase() === t) ||
         findNode(n => n.label.toLowerCase().startsWith(t)) ||
         findNode(n => n.label.toLowerCase().includes(t));
}
function nodeCount(){ let c = 0; eachNode(() => c++); return c; }
function parentOf(node){
  let p = null;
  eachNode((n, d, par) => { if (n === node) p = par; });
  return p;
}
function effectiveVisible(node){
  if (!node.visible) return false;
  const p = parentOf(node);
  return p ? effectiveVisible(p) : true;
}

/* ── command-line verb table — verbatim from ViewportPanel.cpp kVerbs ── */
const VERBS = [
  { keys:'find|locate|select|where is|go to|show me|pick', usage:'find <entity>',
    help:'select it, reveal it in the tree and frame it' },
  { keys:'rotate|turn|spin|yaw|pitch|roll', usage:'rotate <entity> 40 degrees on z',
    help:'degrees by default, radians if you say so' },
  { keys:'move|translate|shift|nudge|push|place|put', usage:'move <entity> 2 m on x',
    help:'or "move cube to x 4 y 1 z 0"' },
  { keys:'scale|resize|grow|shrink', usage:'scale <entity> 2x', help:'uniform, or add "on y" for one axis' },
  { keys:'add|create|spawn|new|insert|drop', usage:'add sphere at x 3 y 2 z -1', help:'any entity type, anywhere' },
  { keys:'enable physics|disable physics|turn on physics|turn off physics|add physics|remove physics|physics',
    usage:'enable physics on <entity>', help:'bodies fall and settle while the world runs' },
  { keys:'exit isolation|unisolate|leave isolation|clear isolation|show everything', usage:'exit isolation',
    help:'bring the rest of the world back' },
  { keys:'delete from ram|remove from ram|delete from memory|purge|wipe|free|destroy|nuke',
    usage:'delete from ram <entity>', help:'deletes it and disposes its GPU + RAM buffers for good' },
  { keys:'hide|unhide|show', usage:'hide <entity>', help:'visibility, same as the eye in the outliner' },
  { keys:'frame|focus|look at|zoom to', usage:'frame <entity|everything>', help:'' },
  { keys:'set time|time|set the time|make it', usage:'set time to golden hour',
    help:'a clock time, or sunrise / noon / dusk / midnight' },
  { keys:'play|run', usage:'play', help:'run the world through a camera' },
  { keys:'close popups|close all popups|clear popups', usage:'close popups', help:'' },
  { keys:'set|make', usage:'set roughness of <entity> to 0.2', help:'any property on any entity' },
  { keys:'help|commands|what can i say|?', usage:'help', help:'' },
];

/* the empty line offers nine sayable things — kExamples */
const EXAMPLES = [
  'find tall box', 'rotate tall box 40 degrees on z', 'move sphere 2 m on x',
  'add sphere at x 3 y 2 z -1', 'enable physics on selected objects', 'isolate selection',
  'set time to golden hour', 'hide moon', 'scale cone 2x',
];

/* add-menu — verbatim from ViewportPanel.cpp RecordBar's ##addmenu,
   plus the Generators group the icons were filled in for */
const ADD_MENU = [
  { head:'Lights', items:[
    ['pointLight','Directional Light (Sun)'], ['pointLight','Point Light'],
    ['spotLight','Spot Light'], ['areaLight','Rect / Area Light'] ]},
  { head:'World & Celestial', items:[
    ['atmosphere','Atmosphere Medium'], ['sky','Sky Atmosphere'], ['cloud','Cloud Layer'],
    ['localFog','Local Volumetric Fog'], ['wind','Wind Field'], ['rainbow','Rainbow'],
    ['lensflare','Lens Flare'], ['moon','Moon / Satellite'] ]},
  { head:'Cameras', items:[
    ['camera','Main Camera'], ['cine','Cine Camera (35mm)'], ['cine','Cine Camera (50mm)'],
    ['cine','Cine Camera (85mm)'], ['postpro','Post Process Volume'] ]},
  { head:'Geometry Primitives', items:[
    ['plane','Plane / Ground'], ['box','Cube / Box'], ['sphere','Sphere'],
    ['cylinder','Cylinder'], ['cone','Cone'], ['torus','Torus'] ]},
  { head:'Generators', items:[
    ['tyre','Tyre'], ['rim','Rim'], ['vehicle','Vehicle Rig'],
    ['cloth','Cloth Sheet'], ['suspension','Suspension Coil'] ]},
];

/* construct groups — NativeConstructPanel.h Groups[] */
const CONSTRUCT_GROUPS = ['All','Environment','Weather','Cameras','Geometry','Lighting'];
function constructGroup(n){
  if (['wind','rain','cloud','localCloud','localFog','fog'].includes(n.icon)) return 2;
  if (n.cat === 'Camera') return 3;
  if (n.cat === 'Geometry') return 4;
  if (n.cat === 'Light') return 5;
  return 1;
}

/* control-centre quick tiles — ControlCentreHost.cpp TileTable + proof labels */
const QUICK_TILES = [
  { key:'gi',      icon:'sunIllum', label:()=>S.gi ? `GI: ${S.giBounces} Bounces` : 'GI: Off', on:()=>S.gi },
  { key:'refl',    icon:'sparkles', label:()=>'Refl: ' + S.reflections, on:()=>S.reflections !== 'Off' },
  { key:'aa',      icon:'sparkles', label:()=>'Anti-Aliasing', on:()=>S.antiAliasing },
  { key:'fps',     icon:'gauge',    label:()=>'FPS Overlay', on:()=>S.fpsOverlay },
  { key:'notif',   icon:'bell',     label:()=>'Notifications', on:()=>S.notifications },
  { key:'quality', icon:'sliders',  label:()=>S.quality, on:()=>true },
  { key:'patches', icon:'sliders',  label:()=>'Patches: ' + (S.patches ? 'On' : 'Off'), on:()=>S.patches },
  { key:'rt',      icon:'raySlash', label:()=>'Raytracing', on:()=>S.raytracing },
];

/* global ui/render state */
const S = {
  selected: null, mode:'edit', paused:false, realtime:true,
  gizmoMode:'translate',
  samples:0, sampleTarget:256,
  filters:{}, searchText:'', compact:false,
  gi:true, giBounces:2, reflections:'Raytraced', antiAliasing:true, fpsOverlay:false,
  notifications:true, quality:'Standard', patches:false, raytracing:true,
  resolution:100, isolated:null,
  sunElevation:5.2, sunAzimuth:231, time:6.2,
  fps:60, ms:16.7,
};

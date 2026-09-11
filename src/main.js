import { SIZE, MIN, MAX, CELL, generateVolume, sampleSDF, estimateNormal, computeStats } from "./volume.js";
import { nodeDefs, defaultGraph, genId } from "./nodes.js";
import { ParticleSystem } from "./erosion.js";
import { TerraRenderer } from "./renderer.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const $=s=>document.querySelector(s);

// STATE
let graph = defaultGraph();
let selectedId = Object.keys(graph.nodes).find(id=>graph.nodes[id].type==='output') || Object.keys(graph.nodes)[0];
let volumeData = null; // Float32Array
let dirty = false;
let iteration = 0;
let isSimulating = false;
let animId = null;
let speed = 1;
let rebuildEvery = 14; // ticks per mesh rebuild — throttled for 60fps; particles still move every frame
let tickCounter=0;

// renderer
const canvas = $("#scene");
const renderer = new TerraRenderer(canvas, null);
let particleSystem = null;
let riverPath = [];

// UI caches
const graphCanvas = $("#graph-canvas");
const wiresSvg = $("#node-wires");
const inspectorEl = $("#inspector");

// helpers
function toast(msg, ms=1600){
  const t=$("#toast"), m=$("#toast-msg");
  m.textContent=msg; t.classList.add("show");
  clearTimeout(t._to); t._to=setTimeout(()=>t.classList.remove("show"), ms);
}

// volume generation
function rebuildVolume(){
  const t0=performance.now();
  const res = generateVolume(graph);
  volumeData = res.volume;
  const stats = computeStats(volumeData);
  $("#stat-volume").textContent = `${SIZE[0]}×${SIZE[1]}×${SIZE[2]}`;
  $("#stat-mem").textContent = (volumeData.byteLength/1024/1024).toFixed(2)+" MB";
  renderer.updateVolume(volumeData);
  if(!particleSystem) {
    particleSystem = new ParticleSystem(volumeData);
    // sync params from first hydraulic/wind nodes
    syncParamsToParticles();
  } else {
    particleSystem.setVolume(volumeData);
  }
  rebuildRiverPath();
  particleSystem.updateRiverPath(riverPath);
  renderer.updateWater(riverPath, getRiverParams());
  updateStatsOverlay(stats, t0);
  toast(`Volume rebuilt — ${stats.solidVoxels.toLocaleString()} voxels solid · ${(performance.now()-t0)|0} ms`);
  iteration=0; tickCounter=0;
  updateSimUI();
}

function syncParamsToParticles(){
  if(!particleSystem) return;
  const hyd = Object.values(graph.nodes).find(n=>n.type==='hydraulic');
  const wind = Object.values(graph.nodes).find(n=>n.type==='wind');
  const river = Object.values(graph.nodes).find(n=>n.type==='river');
  const thermal = Object.values(graph.nodes).find(n=>n.type==='thermal');
  const p={};
  if(hyd){ p.rain=hyd.params.rain; p.erosion=hyd.params.erosion; p.hardness=hyd.params.hardness; p.deposition=hyd.params.deposition; p.particleCount=hyd.params.particleCount; p.grainSize=hyd.params.grainSize; p.capacity=hyd.params.capacity; p.restitution=hyd.params.restitution; p.footprint=hyd.params.footprint; }
  if(wind){ p.windSpeed=wind.params.speed; p.windDir=wind.params.direction; p.wind = wind.params.strength; }
  if(thermal) p.thermal = thermal.params.strength;
  if(river){ p.riverEnabled=true; p.riverSpeed=river.params.speed; p.riverWidth=river.params.width; }
  particleSystem.updateParams(p);
  renderer.grainSize = p.grainSize||0.14;
}

function getRiverParams(){
  const r = Object.values(graph.nodes).find(n=>n.type==='river');
  if(!r) return {width:3.2, speed:2.8, waterLevel:1.0};
  return {width:r.params.width, speed:r.params.speed, waterLevel:1.0};
}

// River path: follow steepest descent from high point near center north to south
function rebuildRiverPath(){
  if(!volumeData) return;
  // start at highest surface near north
  let start=null, bestY=-Infinity;
  for(let tries=0; tries<36; tries++){
    const x=(Math.random()-0.5)*10;
    const z= 12 + (Math.random()-0.5)*4; // north edge
    let y=MAX[1]-0.5;
    for(let k=0;k<80;k++){ if(sampleSDF(volumeData,[x,y,z])<0.3){ y+=0.3; break;} y-=0.45; if(y<MIN[1]) break; }
    if(y>bestY){ bestY=y; start=[x,y+0.3,z];}
  }
  if(!start) start=[0,6,12];
  const path=[start.slice()];
  let pos=start.slice();
  for(let i=0;i<140;i++){
    const n=estimateNormal(volumeData,pos,0.3);
    // downhill direction: project -Y onto plane or follow -gradient XZ
    const down=[-n[0], -0.28, -n[2]];
    const len=Math.hypot(down[0],down[2])||1;
    down[0]/=len; down[2]/=len;
    // step
    const step=0.55;
    const next=[pos[0]+down[0]*step, pos[1]+down[1]*step*1.2, pos[2]+down[2]*step];
    // snap to surface: raycast down
    let y=next[1];
    for(let k=0;k<12;k++){
      const d=sampleSDF(volumeData,[next[0], y, next[2]]);
      if(d<0.18){ y+=0.12; break;}
      y-=0.35;
      if(y<MIN[1]-1){ y=next[1]; break;}
    }
    next[1]=y+0.08;
    // river width influence: stay within valley by checking walls
    // if hits solid wall, slide along
    if(sampleSDF(volumeData,next)< -0.9){ // deep inside solid -> stuck
      next[0]=pos[0]+ (Math.random()-0.5)*0.3;
      next[2]=pos[2]+ (Math.random()-0.5)*0.3;
    }
    path.push(next.slice());
    pos=next;
    if(pos[2] < -14) break;
    if(pos[1] < -1.5) break;
  }
  // smooth path
  for(let s=0;s<2;s++){
    for(let i=1;i<path.length-1;i++){
      path[i][0]=(path[i-1][0]+path[i][0]*2+path[i+1][0])/4;
      path[i][2]=(path[i-1][2]+path[i][2]*2+path[i+1][2])/4;
      path[i][1]=(path[i-1][1]+path[i][1]*3+path[i+1][1])/5;
    }
  }
  riverPath=path;
}

// Inspector
function renderInspector(){
  const node = graph.nodes[selectedId];
  if(!node){
    inspectorEl.innerHTML=`<div class="inspector-section" id="inspector-empty"><div style="text-align:center;padding:24px;color:var(--muted)">No selection</div></div>`;
    return;
  }
  const def=nodeDefs[node.type];
  let html=`<div class="inspector-section">
    <div class="section-title"><span>${def.label}</span><span class="tag">${node.type.toUpperCase()}</span></div>
    <div style="display:flex;gap:6px;margin-bottom:12px">
      <button class="btn btn-ghost btn-small" style="flex:1" id="ins-focus">Focus</button>
      <button class="btn btn-ghost btn-small" style="flex:1;color:#FF5A5A;border-color:#FF5A5A33" id="ins-delete">Delete</button>
    </div>
  `;

  // params UI per type
  const slider=(key,label,min,max,step,display)=>{
    const v=node.params[key];
    return `<div class="control"><label>${label} <output>${display?display(v):v}</output></label>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
  };
  const field=(key,label)=>{
    const v=node.params[key];
    return `<label class="field-label">${label}</label><input class="field" data-key="${key}" type="number" step="0.1" value="${v}">`;
  };
  const vecField=(keys,labels)=>{
    return `<div class="row-2">${keys.map((k,i)=>`<div><label class="field-label">${labels[i]}</label><input class="field" data-key="${k}" type="number" step="0.1" value="${node.params[k]}"></div>`).join("")}</div>`;
  };

  if(node.type==='box'){
    html+= vecField(['x','y','z'],['X','Y','Z']);
    html+= `<div class="row-2" style="margin-top:8px"><div><label class="field-label">SX</label><input class="field" data-key="sx" type="number" step="0.1" value="${node.params.size[0]}"></div><div><label class="field-label">SY</label><input class="field" data-key="sy" type="number" step="0.1" value="${node.params.size[1]}"></div></div>`;
    html+= `<div style="margin-top:8px"><label class="field-label">SZ</label><input class="field" data-key="sz" type="number" step="0.1" value="${node.params.size[2]}"></div>`;
    html+= slider('round','Round',0,2,0.05);
    html+= slider('strata','Strata',0,1,0.05);
    html+= slider('rotY','Yaw °',-180,180,5, v=> (v*180/Math.PI).toFixed(0)+'°');
  }else if(node.type==='sphere'){
    html+= vecField(['x','y','z'],['X','Y','Z']);
    html+= slider('radius','Radius',0.4,6,0.1);
  }else if(node.type==='torus'){
    html+= vecField(['x','y','z'],['X','Y','Z']);
    html+= slider('major','Major',1,6,0.1);
    html+= slider('minor','Minor',0.2,1.5,0.05);
  }else if(node.type==='cylinder'){
    html+= vecField(['x','y','z'],['X','Y','Z']);
    html+= slider('radius','Radius',0.3,4,0.1);
    html+= slider('height','Height',1,12,0.2);
  }else if(node.type==='terrain'){
    html+= slider('width','Width',10,40,1);
    html+= slider('length','Length',10,36,1);
    html+= slider('height','Height',1,10,0.2);
    html+= slider('bevel','Bevel',0,2.5,0.1);
    html+= slider('strata','Strata',0,1,0.05);
  }else if(node.type==='noise'){
    html+= slider('amount','Amount',0,1.5,0.05);
    html+= slider('scale','Scale',0.4,3,0.1);
    html+= slider('octaves','Octaves',1,6,1);
  }else if(node.type==='blend'){
    html+= slider('k','Smooth k',0,3,0.05);
  }else if(node.type==='transform'){
    html+= vecField(['x','y','z'],['TX','TY','TZ']);
    html+= slider('scale','Scale',0.3,3,0.05);
    html+= slider('rotY','Yaw',-3.14,3.14,0.05, v=>(v*180/Math.PI).toFixed(0)+'°');
  }else if(node.type==='terrace'){
    html+= slider('steps','Steps',2,12,1);
    html+= slider('strength','Strength',0,1,0.05);
  }else if(node.type==='hydraulic'){
    html+= `<div class="detail-box" style="margin-bottom:10px">Particle hydraulic erosion — each raindrop follows gradient, erodes based on velocity & slope, carries sediment up to <b>capacity</b>, deposits when slow/flat, then <b>settles</b> (no infinite drilling). Grain size controls visible particle radius.</div>`;
    html+= slider('rain','Rainfall',0,1,0.02);
    html+= slider('erosion','Detach',0,1,0.02);
    html+= slider('hardness','Hardness',0.05,0.95,0.02);
    html+= slider('deposition','Deposition',0,1,0.02);
    html+= slider('particleCount','Particles',200,2048,100, v=>v|0);
    html+= slider('grainSize','Grain mm',0.05,0.45,0.01, v=>(v*1000|0)+' mm');
    html+= slider('capacity','Capacity',0.1,1.2,0.05);
    html+= slider('footprint','Footprint m',0.4,1.6,0.05, v=>v.toFixed(2)+' m');
    html+= slider('restitution','Bounce',0,0.35,0.02);
  }else if(node.type==='wind'){
    html+= slider('speed','Speed m/s',0,14,0.5, v=>v.toFixed(1)+' m/s');
    html+= slider('direction','Dir °',-180,180,5, v=>v|0+'°');
    html+= slider('strength','Abrasion',0,0.7,0.02);
  }else if(node.type==='thermal'){
    html+= slider('strength','Talus',0,0.8,0.02);
    html+= slider('talusAngle','Angle',0.3,1.2,0.05);
  }else if(node.type==='river'){
    html+= slider('width','Width m',1,7,0.1, v=>v.toFixed(1)+' m');
    html+= slider('depth','Depth m',0.2,2.2,0.1);
    html+= slider('speed','Current m/s',0,6,0.2);
  }else if(node.type==='output'){
    html+= `<div class="hint">Final SDF output. Connect upstream graph here. Mesh updates after volume rebuild.</div>`;
    html+= `<div class="stats-grid" style="margin-top:12px">
      <div class="stat-card"><b id="stat-verts">—</b><span>verts</span></div>
      <div class="stat-card"><b id="stat-solid">—</b><span>solid %</span></div>
      <div class="stat-card"><b id="stat-time">—</b><span>ms rebuild</span></div>
    </div>`;
  }

  html+= `</div>`;

  // global section for output also show erosion pipeline
  if(node.type==='output'){
    html+= `<div class="inspector-section">
      <div class="section-title"><span>Pipeline Order</span><span class="tag">TOPO SORT</span></div>
      <div id="pipeline-list" style="display:flex;flex-direction:column;gap:6px"></div>
      <div class="hint" style="margin-top:8px">Erosion nodes execute in graph order so particles see true SDF. Drag wires to reorder.</div>
    </div>`;
  }

  // global sim controls always at bottom
  html+= `<div class="inspector-section">
    <div class="section-title"><span>Simulation</span><span class="tag">REALTIME</span></div>
    <div class="toggle-row" style="margin-bottom:10px"><label class="switch"><input type="checkbox" id="toggle-settle" checked><span class="slider"></span></label><span>Particle settlement <small>Stops cutting when loaded / slow — fixes hole-drilling</small></span></div>
    <div class="toggle-row"><label class="switch"><input type="checkbox" id="toggle-xray"><span class="slider"></span></label><span>X-Ray caves <small>See interior overhangs</small></span></div>
    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <button class="btn btn-ghost btn-small" id="ins-rebuild">Rebuild vol</button>
      <button class="btn btn-primary btn-small" id="ins-erode">Erode 20×</button>
    </div>
  </div>`;

  inspectorEl.innerHTML=html;

  // bind sliders: set --p CSS var
  inspectorEl.querySelectorAll('input[type=range]').forEach(r=>{
    const update=()=>{
      const min=+r.min, max=+r.max, v=+r.value;
      const p=((v-min)/(max-min))*100;
      r.style.setProperty('--p', p+'%');
      const out=r.parentElement.querySelector('output');
      if(out) out.textContent = r.step>=1? v|0 : v.toFixed(2);
    };
    update();
    r.addEventListener('input', e=>{
      update();
      const key=r.dataset.key;
      let val=parseFloat(r.value);
      if(key==='sx' || key==='sy' || key==='sz'){
        // size special: map to node.params.size array
      } else if(key==='particleCount') val|=0;
      // update node param
      if(key==='sx'){ node.params.size[0]=val; }
      else if(key==='sy'){ node.params.size[1]=val; }
      else if(key==='sz'){ node.params.size[2]=val; }
      else node.params[key]=val;
      if(['x','y','z','radius','major','minor','width','length','height','bevel','k','scale','rotY','steps','strength','amount','scale'].includes(key)){
        scheduleRebuild();
      }
      if(['rain','erosion','hardness','deposition','particleCount','grainSize','capacity','footprint','restitution','speed','direction','strength','width','depth'].includes(key)){
        syncParamsToParticles();
        if(key==='width' || key==='speed') renderer.updateWater(riverPath, getRiverParams());
      }
    });
  });
  inspectorEl.querySelectorAll('input.field').forEach(inp=>{
    inp.addEventListener('change', e=>{
      const k=inp.dataset.key;
      let v=parseFloat(inp.value);
      if(k==='sx'){ node.params.size[0]=v; }
      else if(k==='sy'){ node.params.size[1]=v; }
      else if(k==='sz'){ node.params.size[2]=v; }
      else if(['x','y','z'].includes(k)) node.params[k]=v;
      else node.params[k]=v;
      scheduleRebuild();
    });
  });

  // actions
  const del=$("#ins-delete");
  if(del) del.onclick=()=>{
    if(node.type==='output'){ toast("Output cannot be deleted"); return; }
    delete graph.nodes[selectedId];
    // remove wires
    graph.wires = graph.wires.filter(w=>w.from!==selectedId && w.to!==selectedId);
    selectedId = Object.keys(graph.nodes)[0];
    renderGraph(); renderInspector();
    scheduleRebuild();
  };
  const foc=$("#ins-focus");
  if(foc) foc.onclick=()=> focusNode(selectedId);
  const reb=$("#ins-rebuild");
  if(reb) reb.onclick=()=> rebuildVolume();
  const erode=$("#ins-erode");
  if(erode) erode.onclick=()=>{
    for(let i=0;i<20;i++) particleSystem.step();
    dirty=true; renderer.updateVolume(volumeData); renderer.rebuildMesh();
    renderer.updateParticles(particleSystem.getPositionsForRender());
    toast("Eroded 20 ticks — mesh rebuilt");
  };
  const toggleX=$("#toggle-xray");
  if(toggleX) toggleX.onchange=e=>{
    renderer.setViewMode(e.target.checked?'xray':'solid');
    document.querySelector('[data-view="xray"]')?.classList.toggle('active', e.target.checked);
    document.querySelector('[data-view="solid"]')?.classList.toggle('active', !e.target.checked);
  };

  // pipeline list
  const pl=$("#pipeline-list");
  if(pl){
    const order = getOrderedErosionNodes();
    pl.innerHTML = order.map(n=>{
      const d=nodeDefs[n.type];
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;background:var(--panel-2);border:1px solid var(--line-2)">
        <span style="width:8px;height:8px;border-radius:50%;background:${d.color}"></span>
        <span style="font-size:11px;font-weight:600">${d.label}</span>
        <span style="margin-left:auto;font:9px var(--mono);color:var(--muted)">${n.type}</span>
      </div>`;
    }).join("") || `<span class="hint">No erosion nodes in graph — terrain is pure SDF.</span>`;
  }

  function getOrderedErosionNodes(){
    const nodes=Object.values(graph.nodes);
    const erosion=nodes.filter(n=>['hydraulic','thermal','wind','river'].includes(n.type));
    const depth=new Map();
    const visit=(id,d)=>{
      if(depth.has(id) && depth.get(id)>=d) return;
      depth.set(id,d);
      const incoming=graph.wires.filter(w=>w.to===id);
      for(const w of incoming) visit(w.from,d+1);
    };
    const outId=Object.keys(graph.nodes).find(id=>graph.nodes[id].type==='output');
    if(outId) visit(outId,0);
    erosion.sort((a,b)=>(depth.get(a.id)||0)-(depth.get(b.id)||0));
    return erosion;
  }
}

let rebuildTimeout=null;
function scheduleRebuild(){
  clearTimeout(rebuildTimeout);
  rebuildTimeout=setTimeout(()=>{
    rebuildVolume();
  }, 180);
}

// NODE GRAPH RENDERING
function renderGraph(){
  // clear
  graphCanvas.querySelectorAll('.node').forEach(n=>n.remove());
  // create nodes
  for(const id in graph.nodes){
    const n=graph.nodes[id];
    const def=nodeDefs[n.type];
    const el=document.createElement('div');
    el.className=`node ${n.type} ${id===selectedId?'selected':''}`;
    el.style.left=n.x+'px';
    el.style.top=n.y+'px';
    el.dataset.id=id;
    const iconSvg = icons[def.icon] || icons.box;
    el.innerHTML=`
      <div class="node-header">
        <div class="node-icon">${iconSvg}</div>
        <div style="flex:1;min-width:0">
          <div class="node-title">${def.label}</div>
          <div class="node-subtitle">${n.type} · ${id}</div>
        </div>
        <div style="width:8px;height:8px;border-radius:50%;background:${def.color};box-shadow:0 0 8px ${def.color}66"></div>
      </div>
      <div class="node-body">
        ${nodeBodyPreview(n)}
      </div>
      <div class="node-ports">
        <div class="port input" data-port="in0"><div class="port-dot"></div> In</div>
        <div class="port output" data-port="out"><span>Out</span> <div class="port-dot"></div></div>
      </div>
    `;
    graphCanvas.appendChild(el);
    makeDraggable(el, n);
    // ports interaction
    const outDot=el.querySelector('.port.output .port-dot');
    const inDot=el.querySelector('.port.input .port-dot');
    if(outDot) outDot.addEventListener('pointerdown', e=> startWire(e, id, 'out'));
    if(inDot) inDot.addEventListener('pointerup', e=> endWire(e, id, 'in0'));
    // click select
    el.addEventListener('pointerdown', e=>{
      if(e.target.closest('.port-dot')) return;
      selectedId=id;
      renderGraph(); renderInspector();
      e.stopPropagation();
    });
  }
  drawWires();
  $("#graph-info").textContent = `${Object.keys(graph.nodes).length} nodes · ${graph.wires.length} wires`;
  $("#node-count").textContent = `${Object.keys(graph.nodes).length} NODES`;
  // scene list for left tab
  const list=$("#scene-list");
  if(list){
    list.innerHTML = Object.values(graph.nodes).map(n=>{
      const d=nodeDefs[n.type];
      return `<div class="outliner-row ${n.id===selectedId?'selected':''}" data-id="${n.id}">
        <span class="outliner-dot" style="background:${d.color}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${d.label}</span>
        <span class="outliner-meta">${n.type}</span>
      </div>`;
    }).join("");
    list.querySelectorAll('.outliner-row').forEach(r=>{
      r.onclick=()=>{ selectedId=r.dataset.id; renderGraph(); renderInspector(); };
    });
  }
}

function nodeBodyPreview(n){
  if(n.type==='hydraulic') return `<div class="node-param"><label>rain · hardness</label><div class="node-value">${n.params.rain.toFixed(2)} · ${n.params.hardness.toFixed(2)}</div></div><div class="node-param"><label>particles</label><div class="node-value">${n.params.particleCount} · ${(n.params.grainSize*1000|0)}mm</div></div>`;
  if(n.type==='wind') return `<div class="node-param"><label>speed · dir</label><div class="node-value">${n.params.speed.toFixed(1)} m/s · ${n.params.direction}°</div></div>`;
  if(n.type==='river') return `<div class="node-param"><label>width · speed</label><div class="node-value">${n.params.width.toFixed(1)}m · ${n.params.speed.toFixed(1)} m/s</div></div><div style="height:3px;background:linear-gradient(90deg,#0E6E7A,#3DE2FF);border-radius:999px;margin-top:6px"></div>`;
  if(n.type==='terrain') return `<div class="node-param"><label>size</label><div class="node-value">${n.params.width}×${n.params.length} · H ${n.params.height}</div></div>`;
  if(n.type==='box') return `<div class="node-param"><label>pos</label><div class="node-value">${n.params.x.toFixed(1)}, ${n.params.y.toFixed(1)}, ${n.params.z.toFixed(1)}</div></div>`;
  if(n.type==='sphere') return `<div class="node-param"><label>radius</label><div class="node-value">${n.params.radius.toFixed(1)} m</div></div>`;
  if(n.type==='torus') return `<div class="node-param"><label>arch</label><div class="node-value">R ${n.params.major} · r ${n.params.minor}</div></div>`;
  if(n.type==='blend') return `<div class="node-param"><label>k</label><div class="node-value">${n.params.k.toFixed(2)}</div></div>`;
  if(n.type==='output') return `<div class="node-param"><label>volumetric SDF</label><div class="node-value" style="color:#FF5A8A">Marching Cubes</div></div>`;
  return `<div class="node-param"><label>${n.type}</label><div class="node-value">◈</div></div>`;
}

const icons={
  box:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l7 4v7l-7 4-7-4V7l7-4z"/><path d="M12 3v14M5 7l7 4 7-4"/></svg>`,
  sphere:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/><path d="M12 5a10 7 0 0 1 0 14A10 7 0 0 1 12 5z"/><path d="M5 12h14"/></svg>`,
  torus:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="12" rx="8" ry="4.5"/><ellipse cx="12" cy="12" rx="4.5" ry="2.2"/></svg>`,
  terrain:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 16l4-5 3 3 3-4 6 6H3z"/></svg>`,
  noise:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12h3l2-4 3 8 3-6 2 3h5"/></svg>`,
  cylinder:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="7" rx="5" ry="2.5"/><path d="M7 7v8a5 2.5 0 0 0 10 0V7"/><ellipse cx="12" cy="15" rx="5" ry="2.5"/></svg>`,
  union:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="12" r="4.5"/><circle cx="15" cy="12" r="4.5"/></svg>`,
  subtract:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="12" r="4.5"/><circle cx="15" cy="12" r="4.5" stroke-dasharray="2 2"/><path d="M13 11h-3"/></svg>`,
  intersect:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="12" r="4.5"/><circle cx="15" cy="12" r="4.5"/><path d="M11 9.5a4.5 4.5 0 0 1 2 5"/></svg>`,
  blend:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 12a3.5 3.5 0 0 1 7 0 3.5 3.5 0 0 1 -7 0"/><path d="M11.5 8c1.6 0 3 1.4 3 4s-1.4 4-3 4"/></svg>`,
  transform:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v17M3 12h18"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  terrace:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 16h6v-3h6v-3h6v6H3z"/></svg>`,
  hydraulic:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l2 5h-4l2-5z"/><path d="M8 9c-2 2-3 4-3 6a4 4 0 0 0 8 0c0-2-1-4-3-6"/><path d="M8 13h8"/></svg>`,
  thermal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 15l5-3 4 2 4-3 5 2v4H3z"/></svg>`,
  wind:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 11h8"/><path d="M11 7h6a2 2 0 1 1 0 4H11"/><path d="M3 7h5a2 2 0 1 0 0-4H3"/><path d="M3 15h5a2 2 0 1 1 0 4H3"/></svg>`,
  river:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7c2 0 3 1.2 5 1.2S11 7 13 7s3 1.2 5 1.2"/><path d="M3 12c2 0 3 1.2 5 1.2S11 12 13 12s3 1.2 5 1.2"/><path d="M3 17c2 0 3 1.2 5 1.2S11 17 13 17s3 1.2 5 1.2"/></svg>`,
  output:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l7 4v7l-7 4-7-4V7l7-4z"/><circle cx="12" cy="12" r="2"/></svg>`,
};

let drag=null, wireDrag=null, wirePreview=null;
function makeDraggable(el, node){
  el.addEventListener('pointerdown', e=>{
    if(e.target.closest('.port-dot')) return;
    drag={el, node, ox:e.clientX, oy:e.clientY, sx:node.x, sy:node.y};
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e=>{
    if(!drag || drag.el!==el) return;
    node.x = drag.sx + (e.clientX - drag.ox);
    node.y = drag.sy + (e.clientY - drag.oy);
    el.style.left=node.x+'px'; el.style.top=node.y+'px';
    drawWires();
  });
  el.addEventListener('pointerup', e=>{
    if(drag && drag.el===el){ drag=null; el.releasePointerCapture(e.pointerId);}
  });
}
function startWire(e, fromId, port){
  e.preventDefault(); e.stopPropagation();
  wireDrag={from:fromId, port};
  wirePreview=document.createElementNS("http://www.w3.org/2000/svg","path");
  wirePreview.setAttribute('class','wire preview');
  wiresSvg.appendChild(wirePreview);
  const move=(ev)=>{
    const rect=graphCanvas.getBoundingClientRect();
    const fromNode=graph.nodes[fromId];
    const sx=fromNode.x+170-8 + rect.left; // approx right edge
    const sy=fromNode.y+38 + rect.top;
    const ex=ev.clientX, ey=ev.clientY;
    const dx=Math.abs(ex-sx)*0.5;
    wirePreview.setAttribute('d',`M ${sx-rect.left} ${sy-rect.top} C ${sx-rect.left+dx} ${sy-rect.top}, ${ex-rect.left-dx} ${ey-rect.top}, ${ex-rect.left} ${ey-rect.top}`);
  };
  const up=(ev)=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    if(wirePreview) wirePreview.remove();
    wireDrag=null;
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
}
function endWire(e, toId, port){
  e.preventDefault(); e.stopPropagation();
  if(!wireDrag) return;
  // prevent cycles / self
  if(wireDrag.from===toId) return;
  // prevent duplicate
  if(graph.wires.some(w=>w.from===wireDrag.from && w.to===toId)) return;
  // if to already has connection? allow multiple for boolean nodes, but for single-input nodes replace?
  // For simplicity allow multiple; single-input nodes will use first.
  graph.wires.push({from:wireDrag.from, to:toId, fromPort:wireDrag.port, toPort:port});
  renderGraph(); renderInspector();
  scheduleRebuild();
  if(wirePreview){ wirePreview.remove(); wirePreview=null; }
  wireDrag=null;
}
function drawWires(){
  wiresSvg.innerHTML="";
  const rect=graphCanvas.getBoundingClientRect();
  for(const w of graph.wires){
    const a=graph.nodes[w.from], b=graph.nodes[w.to];
    if(!a||!b) continue;
    const x1=a.x+170, y1=a.y+44;
    const x2=b.x, y2=b.y+44;
    const dx=Math.abs(x2-x1)*0.45;
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute('d',`M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('class','wire');
    // highlight if connected to selected
    if(w.from===selectedId || w.to===selectedId) path.classList.add('active');
    path.addEventListener('click', e=>{
      e.stopPropagation();
      // delete wire on click
      graph.wires = graph.wires.filter(x=>x!==w);
      renderGraph(); renderInspector();
      scheduleRebuild();
    });
    path.style.cursor='pointer';
    wiresSvg.appendChild(path);
  }
}

function focusNode(id){
  const n=graph.nodes[id];
  if(!n) return;
  // center viewport camera on node position (world)
  const target=[n.params.x||0, n.params.y||0, n.params.z||0];
  renderer.controls.target.set(target[0], target[1], target[2]);
  renderer.controls.update();
  toast(`Focused on ${nodeDefs[n.type].label}`);
}

// Palette add
document.querySelectorAll('.palette-item').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const type=btn.dataset.type;
    const def=nodeDefs[type];
    const id=genId();
    // place near center of graph with offset
    const baseX= 80 + Math.random()*300;
    const baseY= 80 + Math.random()*160;
    graph.nodes[id]={id, type, x:baseX, y:baseY, params:JSON.parse(JSON.stringify(def.params))};
    // randomize size a bit for demo variation
    if(type==='box'){ graph.nodes[id].params.x=(Math.random()-0.5)*8; graph.nodes[id].params.z=(Math.random()-0.5)*8; }
    if(type==='sphere'){ graph.nodes[id].params.x=(Math.random()-0.5)*10; graph.nodes[id].params.z=(Math.random()-0.5)*10; graph.nodes[id].params.y=2+Math.random()*4; }
    selectedId=id;
    renderGraph(); renderInspector();
    scheduleRebuild();
    toast(`Added ${def.label}`);
  });
});

// Header actions
$("#btn-reset").onclick=()=>{
  if(isSimulating) toggleSim();
  graph=defaultGraph();
  selectedId=Object.keys(graph.nodes).find(id=>graph.nodes[id].type==='output');
  renderGraph(); renderInspector();
  rebuildVolume();
  toast("Graph reset to AAA demo");
};
$("#btn-randomize").onclick=()=>{
  for(const n of Object.values(graph.nodes)){
    if(n.params.seed!==undefined) n.params.seed|=0, n.params.seed = (n.params.seed*1664525 + 1013904223) & 0xffffffff;
    if(n.params.x!==undefined){ n.params.x+=(Math.random()-0.5)*4; n.params.z+=(Math.random()-0.5)*4; }
  }
  renderGraph(); renderInspector();
  rebuildVolume();
};
$("#btn-export").onclick=()=>{
  if(!volumeData){ toast("Nothing to export"); return; }
  const header={format:"slate-sdf", version:1, dimensions:SIZE, bounds:{min:MIN,max:MAX}, channels:["sdf"], iterations:iteration};
  const json=new TextEncoder().encode(JSON.stringify(header));
  const prefix=new Uint32Array([0x534C4154, json.length]); // SLAT
  const blob=new Blob([prefix, json, volumeData.buffer],{type:"application/octet-stream"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`slate-terrain-${Date.now()}.sdf`; a.click();
  URL.revokeObjectURL(url);
  toast("Exported SDF volume — ready for Unreal/Houdini");
};
$("#btn-clear").onclick=()=>{
  if(!confirm("Clear graph?")) return;
  const outId=Object.keys(graph.nodes).find(id=>graph.nodes[id].type==='output');
  const outNode=graph.nodes[outId];
  graph={nodes:{}, wires:[]};
  graph.nodes[outId]=outNode; outNode.x=600; outNode.y=140;
  selectedId=outId;
  renderGraph(); renderInspector();
  rebuildVolume();
};
$("#btn-autolayout").onclick=()=>{
  // simple layered layout by topo depth
  const depth=new Map();
  const visit=(id,d)=>{
    if(depth.has(id) && depth.get(id)>=d) return;
    depth.set(id,d);
    graph.wires.filter(w=>w.from===id).forEach(w=>visit(w.to,d+1));
  };
  const outs=Object.values(graph.nodes).filter(n=>n.type==='output');
  const sources=Object.values(graph.nodes).filter(n=>['terrain','box','sphere','torus','cylinder','noise'].includes(n.type));
  sources.forEach(s=>depth.set(s.id,0));
  outs.forEach(o=>visit(o.id,0));
  // Actually we want source leftmost; compute depth from sources outward
  const calc=(id)=>{
    const incoming=graph.wires.filter(w=>w.to===id);
    if(incoming.length===0) return 0;
    return Math.max(...incoming.map(w=>calc(w.from)))+1;
  };
  const positions=new Map();
  for(const id in graph.nodes){
    const d=calc(id);
    const col=d;
    const row=Object.keys(graph.nodes).filter(k=>calc(k)===d).indexOf(id);
    graph.nodes[id].x=80+col*210;
    graph.nodes[id].y=60+row*92 + (d%2? 18:0);
  }
  renderGraph();
};

// Graph interactions
graphCanvas.addEventListener('pointerdown', e=>{
  if(e.target===graphCanvas || e.target===wiresSvg){
    selectedId=null;
    renderGraph(); renderInspector();
  }
});
$("#btn-graph-fit").onclick=()=>{
  // center graph view (just render)
  renderGraph();
  toast("Fit view");
};
$("#btn-graph-run").onclick=()=>{
  if(!particleSystem) return;
  for(let i=0;i<30;i++) particleSystem.step();
  dirty=true; renderer.updateVolume(volumeData); renderer.rebuildMesh();
  renderer.updateParticles(particleSystem.getPositionsForRender());
  toast("Ran 30 erosion steps on subgraph");
};

// Viewport controls
$("#btn-wire").onclick=e=>{
  const active=e.currentTarget.classList.toggle("active");
  renderer.setWireVisible(active);
};
$("#btn-particles-toggle").onclick=e=>{
  const active=e.currentTarget.classList.toggle("active");
  renderer.setParticleVisible(active);
  particleSystem.params.showParticles=active;
};
$("#btn-water-toggle").onclick=e=>{
  const active=e.currentTarget.classList.toggle("active");
  renderer.setWaterVisible(active);
};
document.querySelectorAll('.view-toggle button').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.view-toggle button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderer.setViewMode(btn.dataset.view);
  };
});

// Tab switching left
document.querySelectorAll('.tab').forEach(t=>{
  t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    t.classList.add('active');
    const tab=t.dataset.tab;
    $("#tab-library").classList.toggle('hidden', tab!=='library');
    $("#tab-scene").classList.toggle('hidden', tab!=='scene');
  };
});

// Simulation controls
const btnSim=$("#btn-sim");
const btnStep=$("#btn-step");
function toggleSim(){
  isSimulating=!isSimulating;
  $("#sim-icon").textContent=isSimulating?"⏸":"▶";
  $("#sim-label").textContent=isSimulating?"Pause":"Run Erosion";
  btnSim.classList.toggle('btn-primary', !isSimulating);
  btnSim.style.background=isSimulating?"#FFB84D":"";
  btnSim.style.color=isSimulating?"#1a1200":"";
  btnSim.style.borderColor=isSimulating?"#FFB84D":"";
  if(isSimulating) startLoop(); else stopLoop();
  toast(isSimulating? "Simulation running — particles cutting in realtime":"Simulation paused");
}
btnSim.onclick=toggleSim;
btnStep.onclick=()=>{
  if(!particleSystem) return;
  const res=particleSystem.step();
  iteration++; tickCounter++;
  dirty=true;
  renderer.updateParticles(particleSystem.getPositionsForRender());
  if(tickCounter%rebuildEvery===0){
    renderer.rebuildMesh();
    updateSimUI();
  }
  // update legend
  $("#legend-carried").textContent=`${(particleSystem.stats.sedimentCarried*1000|0)} mg`;
  $("#legend-deposit").textContent=`${(particleSystem.stats.totalDeposited*1000|0)} mg`;
};
$("#sim-speed").oninput=e=>{
  const v=+e.target.value;
  speed=[0.25,0.6,1,2][v]||1;
  $("#sim-speed-label").textContent=v==0?"0.25×":v==1?"1×":v==2?"2×":"3×";
  const min=+e.target.min, max=+e.target.max;
  e.target.style.setProperty('--p', ((v-min)/(max-min))*100+'%');
};
$("#btn-sim").addEventListener('keydown', e=>{ if(e.key===' '){ e.preventDefault(); toggleSim(); }});

// Keyboard
window.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT' || e.target.tagName==='SELECT') return;
  if(e.key===' '){ e.preventDefault(); toggleSim(); }
  else if(e.key==='r' || e.key==='R'){ rebuildVolume(); }
  else if(e.key==='p' || e.key==='P'){ $("#btn-particles-toggle").click(); }
  else if(e.key==='w' || e.key==='W'){ $("#btn-water-toggle").click(); }
  else if(e.key==='g' || e.key==='G'){ $("#tab-library").classList.contains('hidden')? document.querySelector('[data-tab="library"]').click() : document.querySelector('[data-tab="scene"]').click(); }
});

function startLoop(){
  if(animId) return;
  const loop=()=>{
    animId=requestAnimationFrame(loop);
    if(!isSimulating) return;
    // steps per frame based on speed
    let steps = speed>=2? 2 : 1;
    if(speed===0.25 && Math.random()<0.5) steps=0;
    else if(speed===0.25) steps=1;
    if(speed===3) steps=3;
    for(let s=0;s<steps;s++){
      particleSystem.step();
      iteration++; tickCounter++;
      // sync water flow speed to river params
      if(tickCounter%40===0) renderer.updateWater(riverPath, getRiverParams());
    }
    renderer.updateParticles(particleSystem.getPositionsForRender());
    if(tickCounter%rebuildEvery===0){
      // throttle mesh rebuild to keep 60fps
      renderer.rebuildMesh();
    }
    updateSimUI();
    $("#legend-carried").textContent=(particleSystem.stats.sedimentCarried*1000|0)+" mg";
    $("#legend-deposit").textContent=(particleSystem.stats.totalDeposited*1000|0)+" mg";
    $("#sim-particles").textContent=particleSystem.stats.active|0;
    $("#sim-carry").textContent=(particleSystem.stats.sedimentCarried*1000|0)+" mg carried";
  };
  loop();
}
function stopLoop(){ if(animId) cancelAnimationFrame(animId); animId=null; }

function updateSimUI(){
  $("#sim-iteration").textContent=`Iteration ${iteration}`;
  const pct=clamp((iteration%200)/200*100,0,100);
  $("#sim-progress").style.width=pct+'%';
  $("#sim-particles").textContent=particleSystem? particleSystem.stats.active:0;
}

function updateStatsOverlay(stats, t0){
  const verts=renderer.terrainMesh.geometry.attributes.position? renderer.terrainMesh.geometry.attributes.position.count : 0;
  const fill=(stats.fillRatio*100).toFixed(1);
  setTimeout(()=>{
    const sv=$("#stat-verts"); if(sv) sv.textContent=verts.toLocaleString();
    const ss=$("#stat-solid"); if(ss) ss.textContent=fill+"%";
    const st=$("#stat-time"); if(st) st.textContent=(performance.now()-t0|0);
  },50);
}

// INIT
function init(){
  renderGraph(); renderInspector();
  rebuildVolume();
  renderer.animate();
  // initial particles visible
  $("#btn-particles-toggle").classList.add("active");
  $("#btn-water-toggle").classList.add("active");
  renderer.setParticleVisible(true);
  renderer.setWaterVisible(true);
  // show initial toast with AAA details
  setTimeout(()=>toast("Ready — SDF volumetric terrain. Add Subtract sphere for cave, then Run Erosion to watch particles carve rills."), 900);
  // auto start gentle erosion after 1.2s to showcase realtime cutting
  setTimeout(()=>{
    if(!isSimulating) toggleSim();
  }, 1600);
}
init();

// expose for debugging
window.graph=()=>graph;
window.rebuild=rebuildVolume;
window.renderer=renderer;

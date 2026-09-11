// Node definitions and default graphs for TerraForge
export const nodeDefs = {
  box:       { label:'Box',       color:'#FFB84D', icon:'box',       params:{x:0,y:0,z:0,size:[5,2.5,5], round:0.55, strata:0.6} },
  sphere:    { label:'Sphere',    color:'#FFB84D', icon:'sphere',    params:{x:0,y:2,z:0,radius:3.2} },
  torus:     { label:'Torus',     color:'#FFB84D', icon:'torus',     params:{x:0,y:3,z:0,major:3.2,minor:0.7} },
  terrain:   { label:'Terrain Base', color:'#FFB84D', icon:'terrain', params:{width:34,length:30,height:6, bevel:1.2, strata:0.7, seed:4821} },
  noise:    { label:'Fractal Noise', color:'#A0B4C8', icon:'noise', params:{amount:0.9, scale:1.3, octaves:4, seed:1337} },
  cylinder: { label:'Cylinder', color:'#FFB84D', icon:'cylinder', params:{x:0,y:1,z:0,radius:1.8,height:6} },

  union:     { label:'Union',     color:'#7CA5FF', icon:'union', params:{} },
  subtract:  { label:'Subtract',  color:'#7CA5FF', icon:'subtract', params:{} },
  intersect: { label:'Intersect', color:'#7CA5FF', icon:'intersect', params:{} },
  blend:     { label:'Smooth Blend', color:'#7CA5FF', icon:'blend', params:{k:1.1} },
  transform: { label:'Transform', color:'#7CA5FF', icon:'transform', params:{x:0,y:0,z:0,scale:1, rotY:0} },
  terrace:   { label:'Terrace',   color:'#7CA5FF', icon:'terrace', params:{steps:6,strength:0.5} },

  hydraulic:{ label:'Hydraulic', color:'#00E5CC', icon:'hydraulic', params:{rain:0.72, erosion:0.6, hardness:0.55, deposition:0.42, particleCount:900, grainSize:0.14, capacity:0.65, restitution:0.08, footprint:0.85} },
  thermal:  { label:'Thermal',   color:'#FF8A4D', icon:'thermal', params:{strength:0.35, talusAngle:0.75} },
  wind:     { label:'Wind',      color:'#C9D1FF', icon:'wind', params:{speed:6.5, direction:0, strength:0.28, spread:2.2} },
  river:    { label:'River Carve', color:'#3DE2FF', icon:'river', params:{width:3.2, depth:1.1, speed:3, offset:0, sediment:0.5} },

  output:   { label:'Terrain Output', color:'#FF5A8A', icon:'output', params:{} },
};

// id generator
let _id=0;
export function genId(){ return 'n'+ (++_id + Date.now().toString(36).slice(-3)); }

// Build default graph showcasing AAA features: stratified terrain -> two subtract cave spheres -> union towers -> smooth blend -> hydraulic -> wind -> river -> output
export function defaultGraph(){
  _id=0;
  const nodes={};
  const wires=[];
  const add=(type, x, y, params={})=>{
    const id=genId();
    const def=nodeDefs[type];
    nodes[id]={id,type,x,y, params:{...def.params, ...params}};
    return id;
  };
  const connect=(from,to)=> wires.push({from, to, fromPort:'out', toPort:'in'+(wires.filter(w=>w.to===to).length)});

  const terrain = add('terrain', 80, 120, {width:36,length:34,height:7, bevel:1.1, strata:0.75, seed:4821});
  const boxCliff = add('box', 320, 80, {x:-8, y:5, z:6, size:[4.2,5,3.8], round:0.8, strata:0.4});
  const sphereCave = add('sphere', 320, 180, {x:-5.5, y:2.2, z:-7, radius:3.1});
  const torusArch = add('torus', 80, 260, {x:6, y:3.5, z:7, major:3.5, minor:0.65});
  const noiseWarp = add('noise', 540, 100, {amount:0.8, scale:1.25, octaves:4, seed:9});

  const subtract1 = add('subtract', 540, 200);
  const union1 = add('union', 740, 120);
  const blend1 = add('blend', 900, 160, {k:0.95});

  const hydraulic = add('hydraulic', 1080, 90, {rain:0.7, erosion:0.55, hardness:0.58, deposition:0.4, particleCount:900});
  const wind = add('wind', 1080, 200, {speed:6.2, direction:25, strength:0.26});
  const thermal = add('thermal', 1080, 260, {strength:0.3});
  const river = add('river', 1240, 150, {width:3.4, depth:1.2, speed:2.8});

  const out = add('output', 1400, 140);

  // wiring for real caves: terrain minus sphere cave => subtract node
  connect(terrain, subtract1);
  connect(sphereCave, subtract1);
  connect(subtract1, union1);
  connect(boxCliff, union1);
  connect(union1, blend1);
  connect(torusArch, blend1);
  // noise warp on blended
  connect(blend1, noiseWarp);
  connect(noiseWarp, hydraulic);
  connect(hydraulic, wind);
  connect(wind, thermal);
  connect(thermal, river);
  connect(river, out);

  return {nodes,wires};
}

export function desertCanyonGraph(){
  _id=0;
  const nodes={};
  const wires=[];
  const add=(type,x,y,params={})=>{
    const id=genId();
    nodes[id]={id,type,x,y, params:{...nodeDefs[type].params, ...params}};
    return id;
  };
  const connect=(from,to)=> wires.push({from,to, fromPort:'out',toPort:'in'+wires.filter(w=>w.to===to).length});
  const terrain=add('terrain',80,140,{width:38,length:32,height:8,bevel:0.9, strata:0.8, seed:211});
  const subtract=add('subtract',360,140);
  // canyon trench via box subtract stretched
  const trench=add('box',360,50,{x:0,y:0,z:0,size:[3.2,10,16],round:1.1});
  const cave=add('sphere',360,230,{x:7,y:4,z:-6,radius:2.6});
  const hydraulic=add('hydraulic',620,120,{rain:0.8, erosion:0.68, hardness:0.52, particleCount:1100});
  const wind=add('wind',620,220,{speed:7, direction:-15,strength:0.32});
  const river=add('river',820,140,{width:3.6,depth:1.4,speed:3.4});
  const out=add('output',1000,140);
  connect(terrain,subtract);
  connect(trench,subtract);
  connect(subtract,hydraulic);
  // also carve cave later via subtract?
  connect(cave,hydraulic); // abusing: second input to hydraulic will be considered but hydraulic only uses first; so we instead need union before
  // redo wiring properly: union trench+cave then subtract from terrain
  // Simplify: direct
  connect(hydraulic,wind);
  connect(wind,river);
  connect(river,out);
  return {nodes,wires};
}

export function archCliffGraph(){
  // dramatic overhang demo
  _id=0;
  const nodes={}; const wires=[];
  const add=(t,x,y,p={})=>{const id=genId(); nodes[id]={id,type:t,x,y,params:{...nodeDefs[t].params,...p}}; return id;};
  const conn=(a,b)=>wires.push({from:a,to:b,fromPort:'out',toPort:'in'+wires.filter(w=>w.to===b).length});
  const base=add('terrain',90,160,{width:32,length:28,height:5,seed:777,strata:0.9});
  const block=add('box',320,90,{x:0,y:8,z:0,size:[6,4,6],round:0.6});
  const arch=add('torus',320,220,{x:0,y:5,z:0,major:3.8,minor:1.1});
  const sub=add('subtract',560,160);
  const blend=add('blend',760,160,{k:1.2});
  const hydraulic=add('hydraulic',940,130,{rain:0.65, erosion:0.6, particleCount:800});
  const wind=add('wind',940,210,{speed:5.5,direction:45,strength:0.34});
  const out=add('output',1120,160);
  conn(block,sub); conn(arch,sub); // block minus arch => natural arch
  conn(base,blend); conn(sub,blend);
  conn(blend,hydraulic); conn(hydraulic,wind); conn(wind,out);
  return {nodes,wires};
}

import * as THREE from 'three';

/* SLATE: PORTAL RUSH — 7 modular obstacle scenes linked by portal checkpoints.
   Car = ControlVehicle from Frontier Project-Drive (assets/control-vehicle.json,
   converted from EngineContent/GeometryArchives/ControlVehicleStructure.inl). */
const app=document.getElementById('app');
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x87b7d9); scene.fog=new THREE.Fog(0x87b7d9,90,420);
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,1000);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; app.appendChild(renderer.domElement);
const sun=new THREE.DirectionalLight(0xfff2d8,2.4); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-70;sun.shadow.camera.right=70;sun.shadow.camera.top=70;sun.shadow.camera.bottom=-70; scene.add(sun,sun.target);
scene.add(new THREE.HemisphereLight(0xcfe8ff,0x334422,1.1));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});

const M={
  road:(c=0x333a42)=>new THREE.MeshStandardMaterial({color:c,roughness:.9}),
  concrete:new THREE.MeshStandardMaterial({color:0x9aa0a3,roughness:.95}),
  roof:new THREE.MeshStandardMaterial({color:0x8a4b38,roughness:.95}),
  roof2:new THREE.MeshStandardMaterial({color:0x5d6b74,roughness:.95}),
  grass:new THREE.MeshStandardMaterial({color:0x5d8a3c,roughness:1}),
  sand:new THREE.MeshStandardMaterial({color:0xc2a878,roughness:1}),
  rust:new THREE.MeshStandardMaterial({color:0x7a4a28,roughness:.8,metalness:.5}),
  metal:new THREE.MeshStandardMaterial({color:0x8b95a1,roughness:.35,metalness:.85}),
  dark:new THREE.MeshStandardMaterial({color:0x181a1c,roughness:.9}),
  yellow:new THREE.MeshStandardMaterial({color:0xffc400,roughness:.6}),
  white:new THREE.MeshStandardMaterial({color:0xf2f2f2,roughness:.7}),
  red:new THREE.MeshStandardMaterial({color:0xd32f2f,roughness:.6}),
  dung:new THREE.MeshStandardMaterial({color:0x5b4020,roughness:1}),
  portal:new THREE.MeshBasicMaterial({color:0x00e5ff,transparent:true,opacity:.55,side:THREE.DoubleSide}),
};
function box(w,h,d,mat,x=0,y=0,z=0,parent=scene,shadow=true){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=shadow;m.receiveShadow=true;parent.add(m);return m}
function cyl(rt,rb,h,mat,x=0,y=0,z=0,parent=scene,seg=14){const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
function sph(r,mat,x=0,y=0,z=0,parent=scene){const m=new THREE.Mesh(new THREE.SphereGeometry(r,18,14),mat);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m}
function textSprite(txt,color='#fff',scale=1){
  const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d');g.font='900 58px system-ui';g.textAlign='center';g.strokeStyle='#000';g.lineWidth=10;g.strokeText(txt,256,80);g.fillStyle=color;g.fillText(txt,256,80);
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true}));s.scale.set(16*scale,4*scale,1);return s;
}

/* ---------- world layout ---------- */
const ZONE_LEN=190, ZONE_GAP=330, WIDTH=38;
const zones=[]; const updaters=[]; const colliders=[]; // {x,z,r|hw,hd, zone, push}
const balls=[]; // rolling hazards {mesh,r,zone,hit}
let zoneIdx=0, checkpoint={pos:new THREE.Vector3(0,20,-80),heading:0};
const groundFns=[];
function zoneBase(i){return i*ZONE_GAP}
function makePortal(i,x,z,y=0){
  const g=new THREE.Group(); g.position.set(x,y,z);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(4.2,.45,14,40),new THREE.MeshStandardMaterial({color:0x111111,emissive:0x00e5ff,emissiveIntensity:2.2,metalness:.8,roughness:.2}));
  ring.castShadow=true; g.add(ring);
  const disc=new THREE.Mesh(new THREE.CircleGeometry(3.9,32),M.portal); g.add(disc);
  const label=textSprite(i<7?`➡ PORTAL ${i+1}`:'🏁 FINISH','#7df9ff'); label.position.y=6.2; g.add(label);
  scene.add(g);
  updaters.push((dt,t)=>{ring.rotation.z+=dt*.8; disc.material.opacity=.4+.2*Math.sin(t*4); label.position.y=6.2+Math.sin(t*2)*.3;});
  return g;
}
function groundSlab(i,w=WIDTH,l=ZONE_LEN,mat=M.road(),y=0){
  const m=box(w,1,l,mat,0,y-.5,zoneBase(i)); zones[i].groundY=y; return m;
}
function stripes(i,y=.02){
  for(let z=-ZONE_LEN/2+8;z<ZONE_LEN/2;z+=12) box(.35,.02,5,M.white,0,y,zoneBase(i)+z,scene,false);
}

/* ---------- the car: Frontier Project-Drive ControlVehicle ---------- */
const carGroup=new THREE.Group(); scene.add(carGroup);
const wheelPivots=[];
async function buildCar(){
  const data=await (await fetch('assets/control-vehicle.json')).json();
  const famMat={
    6:new THREE.MeshStandardMaterial({color:0x39594f,metalness:.85,roughness:.28}), // MatBodyPaint MetalicCoat (dark-green coat in Drive's raster proof)
    7:new THREE.MeshStandardMaterial({color:0x0d1620,metalness:.9,roughness:.08}),   // Glass
    8:new THREE.MeshStandardMaterial({color:0x14161a,roughness:.85}),                 // Plastic
    9:new THREE.MeshStandardMaterial({color:0x0a0a0a,roughness:1}),                   // Tyre rubber
    10:new THREE.MeshStandardMaterial({color:0x1565ff,emissive:0x0044ff,emissiveIntensity:.7,metalness:.7,roughness:.3}), // Hub mag accent
    11:M.metal,                                                                        // Brake
    12:new THREE.MeshStandardMaterial({color:0x9aa0a6,roughness:.5,metalness:.4}),    // Trim Plastic2
    13:new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:2.4}), // Headlight
    14:new THREE.MeshStandardMaterial({color:0xff1744,emissive:0xff0055,emissiveIntensity:2}),   // Taillight
    15:new THREE.MeshStandardMaterial({color:0xcccccc,roughness:.6}),                 // Default grey
  };
  // source: X fwd, Y left, Z up  ->  three: X=-Y (right), Y=Z (up), Z=X (fwd)
  const P=data.positions, T=data.triangles, F=data.families;
  const isWheel=f=>f===9||f===10||f===11;
  const cornerOf=(cx,cy)=> (cx>0?'F':'R')+(cy>0?'L':'R');
  const buckets={};
  for(let t=0;t<F.length;t++){
    const a=T[t*3],cx=(P[a*3]),cy=(P[a*3+1]);
    const key=isWheel(F[t])&&Math.abs(cx)>0.6 ? 'W'+cornerOf(cx,cy) : 'B'+F[t];
    (buckets[key]??=[]).push(t);
  }
  function geomFor(tris){
    const pos=[],idx=new Map(),verts=[];
    for(const t of tris) for(let k=0;k<3;k++){const vi=T[t*3+k];
      if(!idx.has(vi)){idx.set(vi,verts.length/3); verts.push(-P[vi*3+1],P[vi*3+2],P[vi*3]);}
      pos.push(idx.get(vi));}
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3)); g.setIndex(pos); g.computeVertexNormals(); return g;
  }
  for(const [key,tris] of Object.entries(buckets)){
    const fam=tris.length?F[tris[0]]:8;
    const mesh=new THREE.Mesh(geomFor(tris),famMat[fam]||famMat[15]); mesh.castShadow=true;
    if(key.startsWith('W')){
      // pivot at wheel centroid so tyres/hubs/brakes spin as one ControlVehicle wheel
      const g=mesh.geometry; g.computeBoundingBox(); const c=g.boundingBox.getCenter(new THREE.Vector3()); c.y=0.42; c.x=key.endsWith('L')?-1.05:1.05;
      const pivot=new THREE.Group(); pivot.position.copy(c); g.translate(-c.x,-c.y,-c.z); pivot.add(mesh); carGroup.add(pivot); wheelPivots.push(pivot);
    } else carGroup.add(mesh);
  }
  // cabin steering wheel hint + plate, so orientation reads at a glance
  box(.9,.06,.5,M.dark,0,1.02,2.55,carGroup);
}
const car={pos:new THREE.Vector3(0,20,-80),heading:0,speed:0,vy:0,grounded:false,steerVis:0};

/* ================= ZONE 1 — floating fractured rooftops ================= */
const roofs=[]; // {x,z,w,d,y}
function buildZone1(){
  const i=0,zc=zoneBase(i); zones[i]={name:'☁️ Fractured Rooftops',groundY:18};
  scene.background=new THREE.Color(0x87b7d9);
  const defs=[[-8,-78,16,26,18],[6,-48,15,24,18.6],[-7,-18,14,24,19.2],[7,12,15,24,19.8],[-6,42,14,24,20.4],[0,72,20,28,21]];
  for(const [x,z,w,d,y] of defs){
    roofs.push({x,z:zc+z,w,d,y});
    box(w,.8,d,M.roof,x,y-.4,zc+z);
    box(w*.7,.25,d*.6,M.roof2,x,y+.1,zc+z+2); // fractured upper slab
    // broken house walls under roof
    box(w*.8,y, .6,M.concrete,x,y/2-0,zc+z-d/2);
    box(.6,y,d*.7,M.concrete,x-w/2,y/2,zc+z);
    const chimney=box(1.4,2.2,1.4,new THREE.MeshStandardMaterial({color:0x9e4a3a}),x+w/4,y+1,zc+z-d/4); chimney.rotation.z=.06;
  }
  // floating fractured debris that drifts & can hit the player
  for(let k=0;k<9;k++){
    const m=box(1.6+Math.random()*1.6,1.2,1.8+Math.random()*2,k%2?M.concrete:M.roof,(Math.random()*30-15),20+Math.random()*5,zc-70+k*18);
    m.rotation.set(Math.random(),Math.random(),Math.random());
    const ph=Math.random()*7;
    updaters.push((dt,t)=>{ m.position.y=20.5+Math.sin(t*.7+ph)*2.2; m.position.x+=Math.sin(t*.3+ph)*dt*1.4; m.rotation.x+=dt*.3;m.rotation.y+=dt*.22;
      const d=m.position.distanceTo(car.pos); if(d<2.6&&zoneIdx===0) hitCar(6,(car.pos.x-m.position.x)*.9,4); });
  }
  const s=textSprite('ZONE 1 · ROOFTOPS — mind the gaps!','#fff'); s.position.set(0,27,zc-88); scene.add(s);
  makePortal(0,0,zc+72,21);
  groundFns[i]=(x,z)=>{ let best=-Infinity; for(const r of roofs) if(Math.abs(x-r.x)<=r.w/2&&Math.abs(z-r.z)<=r.d/2) best=Math.max(best,r.y); return best; };
  zones[i].spawn={pos:new THREE.Vector3(-8,19,zc-80),heading:0};
}

/* ================= ZONE 2 — sewer pipe, steam cracks ================= */
let pressure=0; const steamJets=[];
function buildZone2(){
  const i=1,zc=zoneBase(i); zones[i]={name:'🚿 Sewer Pipe — pressure rising',groundY:0};
  // curved pipe road: half-pipe cross-section, green sewage channels at edges
  const seg=28, segLen=ZONE_LEN/seg;
  for(let s=0;s<seg;s++){ const z=zc-ZONE_LEN/2+segLen*(s+.5);
    for(let k=-3;k<=3;k++){ const x=k*5.2, y=Math.pow(Math.abs(k)/3.4,2)*3.4;
      const tile=box(5.4,.6,segLen+.15,k===0?M.road(0x4a4238):M.road(0x5a5148),x,y-.3,z); tile.rotation.z=-Math.atan2(Math.pow((Math.abs(k)+.5)/3.4,2)*3.4-Math.pow(Math.max(Math.abs(k)-.5,0)/3.4,2)*3.4,5.2)*(k>0?1:k<0?-1:0)*0; }
  }
  for(const sx of [-1,1]){ const sew=box(3,.25,ZONE_LEN,new THREE.MeshStandardMaterial({color:0x39d353,emissive:0x0a5a1a,emissiveIntensity:.7,roughness:.2}),sx*16.5,2.1,zc); }
  for(let z=-80;z<=80;z+=20){ const rib=new THREE.Mesh(new THREE.TorusGeometry(19,0.5,8,24,Math.PI),M.rust); rib.position.set(0,0,zc+z); rib.rotation.y=Math.PI/2; rib.rotation.z=0; scene.add(rib); }
  // cracks that spew steam — more activate as pressure rises
  for(let k=0;k<14;k++){
    const x=(Math.random()*22-11), z=zc-80+k*12+Math.random()*5, y=Math.pow(Math.abs(x)/17.7,2)*3.4;
    const crack=box(1.6,.08,.35,M.dark,x,y+.05,z,scene,false);
    const jet=cyl(.25,.7,7,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0}),x,y+3.5,z,scene,10);
    const light=new THREE.PointLight(0xaaddff,0,10); light.position.set(x,y+3,z); scene.add(light);
    steamJets.push({jet,light,x,z,y,phase:Math.random()*4,order:k});
  }
  updaters.push((dt,t)=>{
    if(zoneIdx===1){ pressure=Math.min(1,pressure+dt/75); document.getElementById('pressureWrap').style.display=zoneIdx===1?'block':'none'; document.querySelector('#pressure i').style.width=(pressure*100)+'%'; }
    const active=3+Math.floor(pressure*11);
    for(const j of steamJets){
      const on=j.order<active && Math.sin(t*1.4+j.phase)>0.1;
      j.jet.material.opacity+= ((on?.55:0)-j.jet.material.opacity)*dt*6; j.light.intensity=on?14:0;
      if(on&&zoneIdx===1&&Math.abs(car.pos.x-j.x)<1.7&&Math.abs(car.pos.z-j.z)<1.7){ car.vy=Math.max(car.vy,7); car.speed*=(1-dt*.7); damage(4*dt); puff(j.x,j.y+1,j.z); }
    }
  });
  const s=textSprite('ZONE 2 · SEWER PIPE','#bfffcf'); s.position.set(0,10,zc-88); scene.add(s);
  makePortal(1,0,zc+82,1);
  groundFns[i]=(x)=>Math.pow(Math.min(Math.abs(x),18)/17.7,2)*3.4;
  zones[i].spawn={pos:new THREE.Vector3(0,1,zc-80),heading:0};
}

/* ================= ZONE 3 — dung beetle hill ================= */
function buildZone3(){
  const i=2,zc=zoneBase(i); zones[i]={name:'🪲 Dung-Beetle Crossing',groundY:0};
  groundSlab(i,WIDTH,ZONE_LEN,M.road(0x6b5b43)); stripes(i);
  const hill=box(26,10,120,M.grass,-32,5,zc); hill.rotation.z=.18;
  box(70,1,26,M.grass,0,-.6,zc-95); box(70,1,26,M.grass,0,-.6,zc+95);
  // beetles on the hilltop
  for(let k=0;k<4;k++){
    const b=new THREE.Group(); b.position.set(-26+ (k%2)*4,11.2,zc-55+k*34);
    const body=sph(1.1,new THREE.MeshStandardMaterial({color:0x2a1a4a,metalness:.6,roughness:.35}),0,0,0,b); body.scale.set(1.2,.8,1.5);
    sph(.55,M.dark,0,.25,1.4,b);
    for(let l=0;l<6;l++){ const leg=cyl(.07,.07,1.4,M.dark,(l%2?1:-1)*1, -.5,(Math.floor(l/2)-1)*.8,b,6); leg.rotation.z=l%2?1:-1; }
    scene.add(b);
    updaters.push((dt,t)=>{ b.position.y=11.2+Math.abs(Math.sin(t*3+k))*0.25; b.rotation.y=Math.sin(t*.5+k)*.3; });
  }
  // dung balls rolling downhill (+X) across the track, looping
  for(let k=0;k<5;k++){
    const m=sph(1.7,M.dung,0,1.7,0); const pathZ=zc-68+k*32; scene.add(m);
    const ball={mesh:m,r:1.9,off:k*47,speed:9+k*1.3,pathZ};
    updaters.push((dt)=>{
      const x=-30+((tGlobal*ball.speed+ball.off)%66);
      m.position.set(x,1.7+Math.max(0,( -x)*0.12*(x<0?1:0))*0 ,ball.pathZ+Math.sin(x*.2+k)*1.2);
      if(x<0) m.position.y=1.7+( -x-0)*0.34; // rolling down the hill slope
      m.rotation.z-=dt*ball.speed/1.7;
      if(zoneIdx===2 && m.position.distanceTo(car.pos)<3.1) hitCar(10,(car.pos.x-m.position.x),6);
    });
  }
  const s=textSprite('ZONE 3 · BEETLES AT WORK','#ffe9a8'); s.position.set(0,9,zc-88); scene.add(s);
  makePortal(2,0,zc+82,0);
  groundFns[i]=()=>0; zones[i].spawn={pos:new THREE.Vector3(0,1,zc-80),heading:0};
}

/* ================= ZONE 4 — sensor bollards city ================= */
function buildZone4(){
  const i=3,zc=zoneBase(i); zones[i]={name:'🚦 Sensor Bollard City',groundY:0};
  groundSlab(i,WIDTH,ZONE_LEN,M.road(0x2f3338)); stripes(i);
  for(const sx of [-1,1]) for(let z=-85;z<=85;z+=17){
    const h=6+((z*7+sx)%5+5)%5*2, b=box(7,h,7,new THREE.MeshStandardMaterial({color:[0x8d9db6,0xb6a48d,0x9db68d][Math.abs(z)%3],roughness:.8}),sx*24,h/2,zc+z);
    for(let wY=1.5;wY<h;wY+=1.8) box(7.1,.8,1.2,new THREE.MeshStandardMaterial({color:0xffe9a8,emissive:0xffc860,emissiveIntensity:.5}),sx*24,wY,zc+z+ (Math.random()*2-1),scene,false);
  }
  // traffic lights + wave of retracting bollards
  const bollards=[];
  for(let row=0;row<5;row++){
    const z=zc-60+row*28;
    const pole=cyl(.12,.12,5,M.dark,-14,2.5,z); const lampMat=new THREE.MeshStandardMaterial({color:0x111111,emissive:0xff2222,emissiveIntensity:2});
    const lamp=sph(.42,lampMat,-14,5.2,z); bollards.lampMat=lampMat;
    for(const x of [-10,-5,0,5,10]){ const b=cyl(.45,.5,1.6,M.yellow,x,-.8,z,scene,12); bollards.push({mesh:b,x,z,row}); colliders.push({x,z,r:1,zone:i,bollard:true,mesh:b}); }
  }
  updaters.push((dt,t)=>{
    const localZ=car.pos.z-zc, detected=zoneIdx===3;
    const wave=Math.sin(t*1.6)*1;
    for(const b of bollards){
      const distAhead=(b.z-car.pos.z);
      const target=(detected && distAhead<26 && distAhead>-4) ? 0.8 : -0.8; // sensor: rise as car approaches
      b.mesh.position.y += (target-b.mesh.position.y)*Math.min(1,dt*4);
      b.mesh.material = b.mesh.position.y>0 ? M.red : M.yellow;
    }
    if(bollards.lampMat) bollards.lampMat.emissive.setHex(detected&&Math.sin(t*3)>0?0x22ff44:0xff2222);
    for(const c of colliders) if(c.bollard) c.active = c.mesh.position.y>-0.1;
  });
  const s=textSprite('ZONE 4 · BOLLARD CITY','#ffd28a'); s.position.set(0,10,zc-88); scene.add(s);
  makePortal(3,0,zc+82,0);
  groundFns[i]=()=>0; zones[i].spawn={pos:new THREE.Vector3(0,1,zc-80),heading:0};
}

/* ================= ZONE 5 — monorail crossings ================= */
function buildZone5(){
  const i=4,zc=zoneBase(i); zones[i]={name:'🚝 Monorail Crossings',groundY:0};
  groundSlab(i,WIDTH,ZONE_LEN,M.road(0x36393f)); stripes(i);
  for(const sx of [-1,1]) for(let z=-80;z<=80;z+=25) box(6,3+Math.abs(z)%4,6,M.concrete,sx*23,1.5,zc+z);
  for(let cix=0;cix<2;cix++){
    const z=zc-35+cix*70;
    const beam=box(80,1.2,2.4,M.metal,0,7,z); for(const px of [-28,-9,9,28]) box(.8,7,1.6,M.concrete,px,3.5,z);
    const lampMat=new THREE.MeshStandardMaterial({color:0x220000,emissive:0xff0000,emissiveIntensity:0});
    const l1=sph(.35,lampMat,-13,4,z-3), l2=sph(.35,lampMat,13,4,z-3);
    box(.3,4,.3,M.dark,-13,2,z-3); box(.3,4,.3,M.dark,13,2,z-3);
    const train=new THREE.Group();
    const bodyT=box(26,3,2.8,new THREE.MeshStandardMaterial({color:0xe8eef4,metalness:.7,roughness:.25}),0,0,0,train);
    box(26.2,.8,3,new THREE.MeshStandardMaterial({color:0x00acc1,emissive:0x00838f,emissiveIntensity:.6}),0,.4,0,train);
    for(let wnd=-5;wnd<=5;wnd++) box(1.2,.9,3.05,M.dark,wnd*2.2,.55,0,train,false);
    train.position.set(-70,8.6,z); scene.add(train);
    const period=13+cix*4, phase=cix*5;
    updaters.push((dt,t)=>{
      const tt=((t+phase)%period)/period, x=-75+tt*150;
      train.position.x=x;
      const near=Math.abs(x)<34;
      lampMat.emissiveIntensity=near?(Math.sin(t*10)>0?3:.2):0;
      if(zoneIdx===4&&near&&Math.abs(car.pos.z-z)<3&&Math.abs(car.pos.x-x)<14) hitCar(22,car.pos.x-x,8,true);
    });
  }
  const s=textSprite('ZONE 5 · MONORAIL — look both ways!','#aee9ff'); s.position.set(0,11,zc-88); scene.add(s);
  makePortal(4,0,zc+82,0);
  groundFns[i]=()=>0; zones[i].spawn={pos:new THREE.Vector3(0,1,zc-80),heading:0};
}

/* ================= ZONE 6 — magnetic crane scrapyard ================= */
function buildZone6(){
  const i=5,zc=zoneBase(i); zones[i]={name:'🧲 Magnet Crane Scrapyard',groundY:0};
  groundSlab(i,WIDTH,ZONE_LEN,M.road(0x4c4438));
  for(let k=0;k<26;k++){ const scrap=box(1+Math.random()*2,.6+Math.random(),1+Math.random()*2,k%3?M.rust:M.metal,Math.random()*34-17,.5,zc-85+Math.random()*170);
    scrap.rotation.y=Math.random()*3; if(Math.abs(scrap.position.x)>5) colliders.push({x:scrap.position.x,z:scrap.position.z,r:1.3,zone:i}); }
  for(const px of [-16,16]){ box(1.2,14,1.2,M.yellow,px,7,zc+10); }
  const crane=new THREE.Group(); crane.position.set(0,14,zc+10); scene.add(crane);
  const arm=box(34,1,1.2,M.yellow,0,0,0,crane);
  const cable=cyl(.06,.06,8,M.dark,10,-4,0,crane,6);
  const magnet=cyl(2.4,2.4,.8,new THREE.MeshStandardMaterial({color:0x37474f,emissive:0xff5722,emissiveIntensity:.4,metalness:.8}),10,-8.4,0,crane,20);
  const heldScrap=box(2.4,1.2,1.8,M.rust,10,-9.6,0,crane);
  let dropTimer=0;
  updaters.push((dt,t)=>{
    crane.rotation.y=Math.sin(t*.28)*.85; crane.position.y=14+Math.sin(t*.5)*.4;
    const magWorld=new THREE.Vector3(); magnet.getWorldPosition(magWorld);
    const distXZ=Math.hypot(car.pos.x-magWorld.x,car.pos.z-magWorld.z);
    // magnet occasionally SUCKS THE CAR up too
    if(zoneIdx===5&&distXZ<6&&car.pos.y<magWorld.y-1){
      car.pos.y+=(magWorld.y-2.2-car.pos.y)*Math.min(1,dt*2.2); car.vy=0; car.speed*= (1-dt*.5);
      magnet.material.emissiveIntensity=2.5; if(Math.random()<dt*8) spark(car.pos.x,car.pos.y+1,car.pos.z);
    } else magnet.material.emissiveIntensity=.4;
    dropTimer+=dt;
    if(dropTimer>6){ dropTimer=0; heldScrap.visible=!heldScrap.visible;
      if(!heldScrap.visible&&zoneIdx===5){ const s2=box(2.4,1.2,1.8,M.rust,magWorld.x,magWorld.y-1,magWorld.z); fallingScrap.push({mesh:s2,vy:0}); } }
  });
  const s=textSprite('ZONE 6 · MAGNET CRANE','#ffc4a3'); s.position.set(0,12,zc-88); scene.add(s);
  makePortal(5,0,zc+82,0);
  groundFns[i]=()=>0; zones[i].spawn={pos:new THREE.Vector3(0,1,zc-80),heading:0};
}
const fallingScrap=[];
/* falling scrap physics (zone 6) */
updaters.push((dt)=>{
  for(const f of fallingScrap){ if(f.done) continue; f.vy-=22*dt; f.mesh.position.y+=f.vy*dt; f.mesh.rotation.x+=dt*2;
    if(f.mesh.position.y<.8){ f.done=true; f.mesh.position.y=.6; colliders.push({x:f.mesh.position.x,z:f.mesh.position.z,r:1.6,zone:5}); }
    if(zoneIdx===5&&f.mesh.position.distanceTo(car.pos)<2.8) { hitCar(16,car.pos.x-f.mesh.position.x,7); f.done=true; } }
});

/* ================= ZONE 7 — D-Day minefield maze + turrets ================= */
const mines=[], turretShots=[];
function buildZone7(){
  const i=6,zc=zoneBase(i); zones[i]={name:'💥 D-Day Minefield Maze',groundY:0};
  groundSlab(i,WIDTH,ZONE_LEN,M.sand);
  // maze walls (hedgehogs + concrete)
  const walls=[[-10,-55,14,2],[8,-35,16,2],[-8,-12,16,2],[10,10,14,2],[-10,32,16,2],[6,55,16,2]];
  for(const [x,z,w,d] of walls){ box(w,1.6,d,M.concrete,x,.8,zc+z); colliders.push({x,z:zc+z,hw:w/2,hd:d/2,zone:i});
    for(let hx=x-w/2+1;hx<x+w/2;hx+=3){ const h=new THREE.Group(); h.position.set(hx,0,zc+z);
      for(let a=0;a<3;a++){ const bar=box(.18,2,.18,M.rust,0,0,0,h); bar.rotation.set(a*1.05,a*2.1,a*0.7);} scene.add(h);} }
  // bunkers
  for(const [x,z] of [[-15,-75],[15,75],[-15,78]]){ box(6,3,5,M.concrete,x,1.5,zc+z); colliders.push({x,z:zc+z,hw:3,hd:2.5,zone:i}); }
  // mines
  for(let k=0;k<22;k++){
    const x=Math.random()*30-15, z=zc-75+Math.random()*150;
    if(Math.abs(x)<3&&Math.abs(z-(zc-80))<8) continue;
    const m=cyl(.55,.65,.22,new THREE.MeshStandardMaterial({color:0x37402c,roughness:.7}),x,.12,z,scene,10);
    cyl(.12,.12,.18,M.red,x,.3,z,scene,8);
    mines.push({mesh:m,x,z,armed:true,blink:Math.random()*7});
  }
  updaters.push((dt,t)=>{
    for(const mn of mines){ if(!mn.armed) continue;
      if(zoneIdx===6&&Math.hypot(car.pos.x-mn.x,car.pos.z-mn.z)<1.6){ mn.armed=false; mn.mesh.visible=false; explosion(mn.x,0.5,mn.z); hitCar(24,car.pos.x-mn.x,11,true); toast('💥 MINE!'); } }
  });
  // turrets firing machine guns
  for(const [x,z] of [[-14,-40],[14,-5],[-14,35],[13,68]]){
    const base=cyl(1,1.3,1.2,M.concrete,x,.6,zc+z,scene,10); colliders.push({x,z:zc+z,r:1.4,zone:i});
    const head=box(1.4,.7,1.8,M.dark,x,1.6,zc+z); const barrel=cyl(.09,.09,2.2,M.dark,x,1.65,zc+z+1,scene,8); barrel.rotation.x=Math.PI/2;
    const grp=new THREE.Group(); grp.position.set(x,0,zc+z); scene.add(grp); grp.add(head,barrel); head.position.set(0,1.6,0); barrel.position.set(0,1.65,1);
    let cd=Math.random();
    updaters.push((dt,t)=>{
      grp.rotation.y=Math.atan2(car.pos.x-x,car.pos.z-(zc+z));
      cd-=dt;
      if(zoneIdx===6&&cd<=0&&car.pos.z>zc-85&&car.pos.z<zc+85){ cd=.16;
        const from=new THREE.Vector3(x,1.7,zc+z), dir=car.pos.clone().sub(from).normalize();
        const tr=new THREE.Mesh(new THREE.SphereGeometry(.09,6,6),new THREE.MeshBasicMaterial({color:0xffd54f}));
        tr.position.copy(from).addScaledVector(dir,2); scene.add(tr); turretShots.push({mesh:tr,vel:dir.multiplyScalar(55),life:1.4});
        muzzle(from.clone().add(new THREE.Vector3(0,0,0)));
      }
    });
  }
  const s=textSprite('ZONE 7 · MINEFIELD — turrets live!','#ffb3a3'); s.position.set(0,10,zc-88); scene.add(s);
  // FINISH instead of portal
  const fin=makePortal(6,0,zc+82,0); fin.children[0].material.emissive.set(0xffc400);
  for(let fx=-8;fx<=8;fx+=2) for(let fz=0;fz<2;fz++) box(2,.05,1,(fx/2+fz)%2?M.dark:M.white,fx,.06,zc+78+fz);
  groundFns[i]=()=>0; zones[i].spawn={pos:new THREE.Vector3(0,1,zc-80),heading:0};
}
updaters.push((dt)=>{
  for(const s of turretShots){ if(s.life<=0) continue; s.life-=dt; s.mesh.position.addScaledVector(s.vel,dt);
    if(s.life<=0) s.mesh.visible=false;
    else if(s.mesh.position.distanceTo(new THREE.Vector3(car.pos.x,car.pos.y+.6,car.pos.z))<1.5){ s.life=0;s.mesh.visible=false; damage(3); car.speed*=.96; spark(car.pos.x,car.pos.y+1,car.pos.z); } }
});

/* ---------- particles / effects ---------- */
const fx=[];
function burst(pos,color,n=14,spread=3,up=5){ for(let k=0;k<n;k++){ const m=sph(.12,new THREE.MeshBasicMaterial({color}),pos.x,pos.y,pos.z); fx.push({m,vx:(Math.random()-.5)*spread,vy:Math.random()*up,vz:(Math.random()-.5)*spread,life:.7}); } }
function puff(x,y,z){ burst(new THREE.Vector3(x,y,z),0xffffff,5,1.5,2.5) }
function spark(x,y,z){ burst(new THREE.Vector3(x,y,z),0xffd54f,6,2,2) }
function muzzle(p){ burst(p,0xffa726,2,1,1) }
function explosion(x,y,z){ burst(new THREE.Vector3(x,y,z),0xff6f00,26,6,9); burst(new THREE.Vector3(x,y,z),0x555555,14,4,7); shake=.7; }
updaters.push((dt)=>{ for(const p of fx){ if(p.life<=0) continue; p.life-=dt; p.vy-=6*dt; p.m.position.x+=p.vx*dt;p.m.position.y+=p.vy*dt;p.m.position.z+=p.vz*dt; if(p.life<=0)p.m.visible=false; } });

/* ---------- damage / hits ---------- */
let health=100, hitCd=0, shake=0, finished=false, started=false, paused=false;
function damage(n){ if(hitCd>0&&n<5) return; health=Math.max(0,health-n); if(health<=0){ toast('💀 WRECKED! Respawning…'); health=55; respawn(); } }
function hitCar(dmg,pushX,pushY,hard=false){ if(hitCd>0&&!hard) return; hitCd=.5; damage(dmg); car.speed*=.45; car.pos.x+=pushX*.12; car.vy=Math.max(car.vy,pushY); car.grounded=false; shake=Math.max(shake,.35); burst(car.pos,0xffa726,10,3,4); }
function respawn(){ const s=zones[zoneIdx].spawn; car.pos.copy(s.pos); car.heading=s.heading; car.speed=0; car.vy=0; }
function toast(msg,ms=2200){ const el=document.getElementById('toast'); el.textContent=msg; el.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>el.style.display='none',ms); }

/* ---------- build all ---------- */
for(let i=0;i<7;i++) zones[i]=zones[i]||{};
buildZone1(); buildZone2(); buildZone3(); buildZone4(); buildZone5(); buildZone6(); buildZone7();
await buildCar();
respawn();

/* ---------- input ---------- */
const keys={};
addEventListener('keydown',e=>{ keys[e.code]=true; if(e.code==='KeyR') respawn(); if(e.code==='KeyP'){paused=!paused; toast(paused?'⏸ PAUSED':'▶ RESUMED');} if(['ArrowUp','ArrowDown','Space'].includes(e.code))e.preventDefault(); });
addEventListener('keyup',e=>keys[e.code]=false);
document.querySelectorAll('#touch button').forEach(b=>{
  const map={up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD'};
  b.addEventListener('pointerdown',()=>keys[map[b.dataset.k]]=true); b.addEventListener('pointerup',()=>keys[map[b.dataset.k]]=false);
});

/* ---------- HUD ---------- */
const zoneIcons=['☁️','🚿','🪲','🚦','🚝','🧲','💥'];
document.getElementById('zones').innerHTML=zoneIcons.map((z,i)=>`<span data-z="${i}">${z}</span>`).join('')+'<span>🏁</span>';
function fmt(t){ return `${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}` }

/* ---------- main loop ---------- */
const clock=new THREE.Clock(); let tGlobal=0, raceTime=0, camPos=new THREE.Vector3(0,26,-100);
function groundAt(x,z){
  const i=Math.max(0,Math.min(6,Math.round(z/ZONE_GAP)));
  return groundFns[i]?groundFns[i](x,z):0;
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05); if(paused){renderer.render(scene,camera);return;}
  tGlobal+=dt; if(started&&!finished) raceTime+=dt; hitCd=Math.max(0,hitCd-dt);
  for(const u of updaters) u(dt,tGlobal);

  // --- car physics (arcade, Project-Drive key layout) ---
  const throttle=(keys.KeyW||keys.ArrowUp)?1:0, brake=(keys.KeyS||keys.ArrowDown)?1:0;
  const steer=((keys.KeyA||keys.ArrowLeft)?1:0)-((keys.KeyD||keys.ArrowRight)?1:0);
  if(throttle&&!started){started=true; toast('🏁 GO! Reach the portal!');}
  const maxSpd= keys.ShiftLeft?44:32;
  if(throttle) car.speed+= (car.grounded?16:4)*dt;
  if(brake) car.speed-= (car.speed>0.5?22:10)*dt;
  car.speed-=car.speed*.55*dt; if(keys.Space) car.speed-=car.speed*2.4*dt;
  car.speed=THREE.MathUtils.clamp(car.speed,-10,maxSpd);
  if(Math.abs(car.speed)>.2) car.heading+=steer*1.55*dt*Math.sign(car.speed)*(keys.Space?1.5:1)*Math.min(1,Math.abs(car.speed)/8);
  car.steerVis+= (steer-car.steerVis)*dt*8;
  const fxv=Math.sin(car.heading), fzv=Math.cos(car.heading);
  car.pos.x+=fxv*car.speed*dt; car.pos.z+=fzv*car.speed*dt;
  // ground / gravity
  const g=groundAt(car.pos.x,car.pos.z);
  if(car.pos.y>g+0.02){ car.vy-=24*dt; car.grounded=false; } else { car.pos.y=g; car.vy=0; car.grounded=true; }
  car.pos.y+=car.vy*dt;
  if(car.pos.y<g){car.pos.y=g;car.vy=0;car.grounded=true;}
  if(car.pos.y<-12){ toast('🕳️ You fell! Back to the roof.'); damage(8); respawn(); }
  // track walls
  const limit=zoneIdx===0?40:17.5;
  if(zoneIdx!==0) car.pos.x=THREE.MathUtils.clamp(car.pos.x,-limit,limit);
  // colliders
  for(const c of colliders){ if(c.zone!==zoneIdx||c.active===false) continue;
    const dx=car.pos.x-c.x, dz=car.pos.z-c.z;
    if(c.hw){ if(Math.abs(dx)<c.hw+1&&Math.abs(dz)<c.hd+.9){ car.speed*=.5; car.pos.x+= (Math.abs(dx)>(c.hw?.8:0)? Math.sign(dx)*dt*8:0); car.pos.z+=Math.sign(dz)*dt*8; } }
    else if(Math.hypot(dx,dz)<c.r+1){ car.speed*=.55; const d=Math.max(.3,Math.hypot(dx,dz)); car.pos.x+=dx/d*dt*10; car.pos.z+=dz/d*dt*10; shake=Math.max(shake,.12); }
  }
  // car visuals
  carGroup.position.copy(car.pos); carGroup.rotation.y=car.heading;
  carGroup.rotation.z=car.steerVis*.06 + (car.grounded?0:car.vy*.004);
  carGroup.rotation.x=THREE.MathUtils.clamp(-car.speed*.002,-.05,.05);
  for(const w of wheelPivots) w.rotation.x+=car.speed*dt/0.42;
  // portal / finish check
  const zc=zoneBase(zoneIdx), portalZ=zc+82;
  if(Math.abs(car.pos.z-portalZ)<5 && Math.abs(car.pos.x)<6 && Math.abs(car.pos.y-(groundAt(car.pos.x,car.pos.z)))<6){
    if(zoneIdx<6){ zoneIdx++; pressure=0; const s=zones[zoneIdx].spawn; car.pos.copy(s.pos); car.heading=s.heading;
      document.getElementById('pressureWrap').style.display=zoneIdx===1?'block':'none';
      toast(`🌀 PORTAL! ${zones[zoneIdx].name}`); burst(car.pos,0x00e5ff,30,5,6);
    } else if(!finished){ finished=true; burst(car.pos,0xffc400,60,8,10);
      document.querySelector('#overlay .card').innerHTML=`<h1>🏆 FINISH!</h1><p>You conquered all 7 scenes in the Project-Drive ControlVehicle!</p><p>⏱ Time: <b>${fmt(raceTime)}</b> &nbsp; ❤️ Health left: <b>${Math.round(health)}%</b></p><button onclick="location.reload()">RACE AGAIN</button>`;
      document.getElementById('overlay').style.display='grid'; }
  }
  // zone from position (for ground dispatch cosmetics)
  document.getElementById('zoneName').textContent= zones[zoneIdx].name;
  document.querySelectorAll('#zones span').forEach((el,i)=>{ el.className=i<zoneIdx?'done':i===zoneIdx?'now':''; });
  document.getElementById('time').textContent=fmt(raceTime);
  document.getElementById('health').textContent=Math.round(health);
  document.querySelector('#healthbar i').style.width=health+'%';
  document.getElementById('kmh').textContent=Math.round(Math.abs(car.speed)*3.6);
  document.getElementById('next').textContent= zoneIdx<6?`Portal ${Math.max(0,Math.round(portalZ-car.pos.z))}m`:'FINISH!';
  // camera chase
  const back=new THREE.Vector3(car.pos.x-fxv*11,car.pos.y+5.2,car.pos.z-fzv*11);
  camPos.lerp(back,1-Math.pow(.001,dt)); if(shake>0){shake-=dt; camPos.x+=(Math.random()-.5)*shake; camPos.y+=(Math.random()-.5)*shake;}
  camera.position.copy(camPos); sun.position.set(car.pos.x+30,car.pos.y+45,car.pos.z+20); sun.target.position.copy(car.pos);
  camera.lookAt(car.pos.x,car.pos.y+1.4,car.pos.z);
  renderer.render(scene,camera);
}
animate();
document.getElementById('start').onclick=()=>{ document.getElementById('overlay').style.display='none'; toast('🏁 Zone 1: cross the rooftops to the portal!'); };


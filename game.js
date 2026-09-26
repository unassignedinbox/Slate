// Try several trusted ESM mirrors. Preview sandboxes occasionally block one CDN while allowing another.
const engineSources = [
  'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js',
  'https://unpkg.com/three@0.160.1/build/three.module.js',
  'https://esm.sh/three@0.160.1'
];
async function loadEngine() {
  let lastError;
  for (const source of engineSources) {
    try { return await import(source); } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Unable to load the 3D engine.');
}

loadEngine().then((THREE) => {
const canvas = document.querySelector('#game');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x94adb3);
scene.fog = new THREE.FogExp2(0x9aafb0, 0.00235);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const camera = new THREE.PerspectiveCamera(59, window.innerWidth / window.innerHeight, 0.1, 1300);
camera.position.set(9, 9, 20);

const hemi = new THREE.HemisphereLight(0xc4e0e0, 0x4e3f2c, 2.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe3b8, 2.8);
sun.position.set(-120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -250;
sun.shadow.camera.right = 250;
sun.shadow.camera.top = 250;
sun.shadow.camera.bottom = -250;
scene.add(sun);

const clock = new THREE.Clock();
const gameRoot = new THREE.Group();
scene.add(gameRoot);
const dynamicRoot = new THREE.Group();
scene.add(dynamicRoot);

const ui = {
  health: document.querySelector('#health-number'), healthBar: document.querySelector('#health-bar'),
  tide: document.querySelector('#tide-number'), tideBar: document.querySelector('#tide-bar'),
  distance: document.querySelector('#distance'), intro: document.querySelector('#intro'),
  launch: document.querySelector('#launch'), message: document.querySelector('#message')
};

const C = {
  sand: 0xb79b6a, sandLight: 0xd1b982, dirt: 0x725c3e, dirtDark: 0x40382b,
  road: 0x605746, roadEdge: 0x80765c, concrete: 0x8b887b, concreteDark: 0x595a52,
  olive: 0x475044, oliveLight: 0x626b50, metal: 0x2f3530, gun: 0x202622,
  rust: 0x9c5a32, red: 0xbc432f, water: 0x3c8998, wire: 0x272b27,
  bag: 0x918264, yellow: 0xe0a245, black: 0x1a1b18, glass: 0x25424a
};
const mat = {};
for (const [name, color] of Object.entries(C)) {
  mat[name] = new THREE.MeshStandardMaterial({ color, roughness: name === 'water' ? 0.22 : 0.84, metalness: name === 'metal' || name === 'gun' ? 0.45 : 0.02, flatShading: true });
}
mat.glass = new THREE.MeshStandardMaterial({ color: C.glass, roughness: .16, metalness: .4, flatShading: true });
mat.water.transparent = true; mat.water.opacity = .78; mat.water.metalness = .15;
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x393a32, transparent: true, opacity: .62 });

function mesh(geometry, material, pos, rotation, scale, parent = gameRoot) {
  const m = new THREE.Mesh(geometry, material);
  if (pos) m.position.set(...pos);
  if (rotation) m.rotation.set(...rotation);
  if (scale) m.scale.set(...scale);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(w, h, d, material, pos, rotation, parent) { return mesh(new THREE.BoxGeometry(w, h, d), material, pos, rotation, null, parent); }
function cyl(rt, rb, h, seg, material, pos, rotation, parent) { return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material, pos, rotation, null, parent); }
function sphere(r, material, pos, seg = 8, parent) { return mesh(new THREE.IcosahedronGeometry(r, Math.max(0, seg - 6)), material, pos, null, null, parent); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// Terrain: smooth, clean low-poly beach with deliberate earth mounds around the route.
const earthMounds = [
  [-160, 112, 31, 3.6], [130, 90, 36, 5.2], [-80, 12, 27, 4.6], [150, -35, 42, 6.4],
  [-148, -65, 36, 5.4], [99, -132, 28, 4.2], [-114, -194, 42, 5.9], [147, -250, 35, 6.3],
  [-85, -302, 45, 5.2], [96, -352, 33, 4.4], [-218, -280, 62, 8.5], [206, -150, 65, 8.1]
];
function terrainHeight(x, z) {
  let h = -1.8 + Math.sin(x * .026) * .35 + Math.cos(z * .021) * .4 + Math.sin((x + z) * .018) * .24;
  for (const [mx, mz, radius, height] of earthMounds) {
    const dx = x - mx, dz = z - mz, d = Math.sqrt(dx * dx + dz * dz);
    if (d < radius * 2.1) h += height * Math.pow(Math.max(0, 1 - d / (radius * 2.1)), 2.45);
  }
  // A subtly lifted, dry beach beside the water.
  h += Math.max(0, (-x - 210) * .018);
  return h;
}
function createTerrain() {
  const xMin = -330, xMax = 305, zMin = -475, zMax = 220, cols = 86, rows = 92;
  const positions = [], colors = [], indices = [];
  const base = new THREE.Color(C.sand), dark = new THREE.Color(0x9a805a), green = new THREE.Color(0x84906a);
  for (let z = 0; z <= rows; z++) {
    for (let x = 0; x <= cols; x++) {
      const px = THREE.MathUtils.lerp(xMin, xMax, x / cols);
      const pz = THREE.MathUtils.lerp(zMin, zMax, z / rows);
      const y = terrainHeight(px, pz);
      positions.push(px, y, pz);
      const v = (Math.sin(px * .12 + pz * .06) + 1) * .045;
      const col = base.clone().lerp(dark, clamp((y + 2) / 14, 0, .22)).lerp(green, clamp((y - 4) / 18, 0, .12));
      col.offsetHSL(0, 0, v - .04);
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const a = z * (cols + 1) + x, b = a + 1, c = a + cols + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const ground = new THREE.Mesh(g, material); ground.receiveShadow = true; gameRoot.add(ground);
}
createTerrain();

// Winding raised road rather than a straight runway.
const routePoints = [
  new THREE.Vector3(-13, 0, 184), new THREE.Vector3(43, 0, 137), new THREE.Vector3(13, 0, 82),
  new THREE.Vector3(-37, 0, 30), new THREE.Vector3(20, 0, -22), new THREE.Vector3(61, 0, -70),
  new THREE.Vector3(22, 0, -120), new THREE.Vector3(-48, 0, -166), new THREE.Vector3(-20, 0, -222),
  new THREE.Vector3(48, 0, -267), new THREE.Vector3(27, 0, -322), new THREE.Vector3(1, 0, -386)
];
const routeCurve = new THREE.CatmullRomCurve3(routePoints, false, 'centripetal');
function createRoad() {
  const count = 330, width = 8.7, p = [], uv = [], ind = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count, point = routeCurve.getPoint(t), tangent = routeCurve.getTangent(t).normalize();
    const nx = tangent.z, nz = -tangent.x;
    const roadW = width + Math.sin(t * 31) * .45;
    for (const side of [-1, 1]) {
      const x = point.x + nx * roadW * side;
      const z = point.z + nz * roadW * side;
      p.push(x, terrainHeight(x, z) + .13, z); uv.push(side === -1 ? 0 : 1, t * 16);
    }
  }
  for (let i = 0; i < count; i++) { const a = i * 2; ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setIndex(ind); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C.road, roughness: .98, flatShading: true })); road.receiveShadow = true; gameRoot.add(road);
  // irregular pale edge stones make the route legible without turning it into a highway.
  for (let i = 7; i < count; i += 8) {
    const t = i / count, q = routeCurve.getPoint(t), tan = routeCurve.getTangent(t).normalize(), nx = tan.z, nz = -tan.x;
    for (const side of [-1, 1]) {
      const x = q.x + nx * (width + .42) * side, z = q.z + nz * (width + .42) * side;
      const stone = box(.45, .18, 1.05, mat.roadEdge, [x, terrainHeight(x,z)+.14,z], [0, Math.atan2(tan.x,tan.z), 0]);
      stone.castShadow = false;
    }
  }
}
createRoad();

function addMoundDecor() {
  for (const [x, z, radius, height] of earthMounds) {
    const rock = mesh(new THREE.DodecahedronGeometry(radius * .46, 1), mat.dirt, [x, terrainHeight(x,z) + height * .22, z], [0, Math.random(), 0], [1.4, .3, 1.15]);
    rock.castShadow = false;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.08 + .5, r = radius * (1.05 + i * .23), rx = x + Math.cos(a) * r, rz = z + Math.sin(a) * r;
      sphere(.65 + i * .23, mat.dirtDark, [rx, terrainHeight(rx,rz) + .23, rz], 6).rotation.y = a;
    }
  }
}
addMoundDecor();

// Ocean on the western side; vertex waves and a waterline that climbs through the run.
const waterGeo = new THREE.PlaneGeometry(245, 760, 30, 92);
waterGeo.rotateX(-Math.PI / 2);
const water = new THREE.Mesh(waterGeo, mat.water);
water.position.set(-427, -7.8, -130); water.receiveShadow = true; gameRoot.add(water);
const waterBase = waterGeo.attributes.position.array.slice();
function buildSeaCliff() {
  for (let z = -455; z < 220; z += 18) {
    const x = -296 + Math.sin(z * .045) * 7;
    const h = terrainHeight(x,z);
    const cliff = mesh(new THREE.DodecahedronGeometry(6.2, 0), mat.dirtDark, [x, h - 1.4, z], [0, (z % 7) * .15, 0], [1.35,.65,1.8]);
    cliff.castShadow = false;
  }
}
buildSeaCliff();

function addSandbagRow(x, z, count, axis = 'x') {
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * .76;
    const px = x + (axis === 'x' ? offset : 0), pz = z + (axis === 'z' ? offset : 0);
    const bag = mesh(new THREE.DodecahedronGeometry(.48, 1), mat.bag, [px, terrainHeight(px,pz) + .34 + (i % 2) * .025, pz], [0, i * .8, 0], [1.15,.58,.72]);
    bag.castShadow = true;
  }
}
function addTrench(x, z, length, angle) {
  const g = new THREE.Group(); g.position.set(x, terrainHeight(x,z) + .04, z); g.rotation.y = angle; gameRoot.add(g);
  const trench = box(length, .08, 3.2, mat.dirtDark, [0, 0, 0], null, g); trench.castShadow = false;
  for (const side of [-1,1]) {
    const bank = box(length + .8, .52, .56, mat.dirt, [0,.2,side * 1.85], [0,0,0], g); bank.rotation.z = side * .12;
    for (let i = 0; i < Math.ceil(length/2.8); i++) {
      const b = mesh(new THREE.DodecahedronGeometry(.52, 0), mat.dirt, [-length/2 + .9 + i*2.7,.56,side*2.05], [0,i,.15], [1.3,.34,.75], g); b.castShadow=false;
    }
  }
  // duckboards at intervals visibly mark a usable trench line.
  for (let i=-length/2+.8; i<length/2; i+=2.2) { const plank=box(.18,.08,2.55,mat.roadEdge,[i,.12,0],null,g); plank.castShadow=false; }
}
addTrench(-123, 68, 48, -.16);
addTrench(118, -18, 58, .28);
addTrench(-112, -245, 64, .18);
addTrench(125, -312, 55, -.35);
addSandbagRow(-88, 53, 9, 'x'); addSandbagRow(86, -103, 11, 'x'); addSandbagRow(-72, -286, 12, 'x');

function addBarbedWire(x, z, length, angle) {
  const group = new THREE.Group(); group.position.set(x, terrainHeight(x,z) + .06, z); group.rotation.y = angle; gameRoot.add(group);
  const postMat = mat.metal;
  for (let i = 0; i <= length; i += 3) {
    const post = cyl(.07, .09, 1.5, 5, postMat, [i - length/2, .75, 0], [.05,0,.05], group); post.castShadow=false;
    for (const y of [.56, 1.05]) {
      const pts = [];
      for (let j = 0; j <= 6; j++) pts.push(new THREE.Vector3(i - length/2 - .1 + j * .52, y + (j % 2 ? .12 : -.08), 0));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:C.wire})); group.add(line);
    }
  }
  for (let i = 1; i < length; i += 1.45) {
    const barb = box(.55,.025,.025,mat.wire,[i-length/2,.98,0],[0,0,.7],group); barb.castShadow=false;
  }
}
addBarbedWire(-137, 12, 59, -.10); addBarbedWire(124, 52, 50, .19); addBarbedWire(-132, -126, 62, -.31); addBarbedWire(133, -208, 54, .1); addBarbedWire(-100, -350, 80, .12);

function addBarricade(x,z,angle=0) {
  const g = new THREE.Group(); g.position.set(x,terrainHeight(x,z)+.9,z); g.rotation.y=angle; gameRoot.add(g);
  for (const dir of [-1,1]) {
    const plank=box(.27,3.4,.22,mat.rust,[0,0,0],[0,0,dir*.68],g); plank.rotation.x=dir*.72;
    const foot=box(2.2,.22,.5,mat.dirtDark,[0,-1.4,0],null,g); foot.castShadow=false;
  }
  const stripe=box(2.8,.48,.12,mat.yellow,[0,.15,-.17],null,g); stripe.rotation.z=.06;
  for (let i=-1; i<=1; i+=2) box(.15,.52,.13,mat.black,[i*.55,.15,-.24],null,g);
  return g;
}
addBarricade(49,88,.2); addBarricade(-8,-82,-.55); addBarricade(-3,-193,.4); addBarricade(61,-340,-.32);

// Stationary armored vehicles; tank treads never move.
function addTank(x, z, angle) {
  const g = new THREE.Group(); g.position.set(x, terrainHeight(x,z) + .55, z); g.rotation.y = angle; gameRoot.add(g);
  const treadMat = new THREE.MeshStandardMaterial({color:0x2a302a,roughness:.86,flatShading:true});
  for (const s of [-1,1]) {
    const tread = box(.68,.68,3.5,treadMat,[s*.86,0,0],null,g);
    for (let q=-1.18;q<=1.18;q+=.58) { const wheel=cyl(.27,.27,.12,8,mat.metal,[s*1.23,-.13,q],[0,0,Math.PI/2],g); wheel.castShadow=false; }
  }
  box(2.18,.67,2.25,mat.olive,[0,.42,0],null,g);
  const turret = cyl(.78,.92,.42,8,mat.oliveLight,[0,.98,-.08],[0,.25,0],g); turret.rotation.y=.22;
  const barrel=box(.22,.22,2.35,mat.gun,[.17,1.11,-1.12],[0,.22,0],g); barrel.castShadow=true;
  sphere(.18,mat.rust,[.25,1.1,-2.25],7,g);
  return g;
}
addTank(-88, 103, .75); addTank(135, -115, -.5); addTank(-106,-220,.5); addTank(112,-342,-.8);

const hazards = [];
function addTankMine(x, z) {
  const g = new THREE.Group(); g.position.set(x, terrainHeight(x,z) + .16, z); gameRoot.add(g);
  const base = cyl(.72,.78,.18,12,mat.metal,[0,0,0],null,g); base.castShadow=false;
  const top = cyl(.57,.63,.14,12,mat.gun,[0,.14,0],null,g); top.castShadow=false;
  for (let i=0;i<8;i++) { const a=i*Math.PI/4; const lug=box(.12,.11,.24,mat.metal,[Math.cos(a)*.61,.18,Math.sin(a)*.61],[0,-a,0],g); lug.castShadow=false; }
  // Correct tank-mine warning: a strong high-visibility X across its pressure plate.
  for (const r of [-.72,.72]) { const mark=box(.11,.028,1.05,mat.yellow,[0,.225,0],[0,r,0],g); mark.castShadow=false; }
  const h = { type:'mine', group:g, x,z, radius:4.1, active:true, damage:31 }; hazards.push(h); return h;
}
[
  [24,121], [11,67], [-8,45], [55,-34], [41,-53], [5,-111], [-11,-145], [-30,-207],
  [17,-246], [43,-287], [8,-325], [-16,-362], [-63,-59], [92,-175], [-84,-284]
].forEach(p=>addTankMine(...p));

const turrets = [], bullets = [], explosions = [], bombs = [], planes = [];
function addBunker(x, z, angle = 0) {
  const group = new THREE.Group(); group.position.set(x,terrainHeight(x,z),z); group.rotation.y=angle; gameRoot.add(group);
  // chunky three-side concrete fighting position, open toward the beach.
  box(5.8,2.1,.8,mat.concreteDark,[0,1.05,1.9],null,group);
  box(.9,1.65,3.6,mat.concrete,[2.45,.82,.45],null,group);
  box(.9,1.65,3.6,mat.concrete,[-2.45,.82,.45],null,group);
  box(5.4,.54,.62,mat.concrete,[0,1.05,-1.55],null,group);
  addSandbagGroup(group, -1.8,-1.85, 6);
  const turret = new THREE.Group(); turret.position.set(0,1.35,-.82); group.add(turret);
  cyl(.31,.41,.38,7,mat.gun,[0,0,0],null,turret);
  const shield=box(1.14,.67,.12,mat.metal,[0,.35,-.23],null,turret); shield.castShadow=false;
  const barrel=box(.15,.15,1.48,mat.gun,[0,.43,-.9],null,turret); barrel.castShadow=false;
  const handle=box(.1,.1,.42,mat.metal,[.25,.2,.1],null,turret); handle.castShadow=false;
  turrets.push({ group, turret, cooldown:1.5 + Math.random(), range:205, destroyed:false });
}
function addSandbagGroup(parent, x,z,n) {
  for(let i=0;i<n;i++) {
    const o=(i-(n-1)/2)*.65;
    const bag=mesh(new THREE.DodecahedronGeometry(.43,1),mat.bag,[x+o,.63,z],[0,i,.15],[1.18,.55,.67],parent); bag.castShadow=true;
  }
}
addBunker(-103,-73,-.08); addBunker(119,-177,.12); addBunker(-94,-315,-.2); addBunker(103,-372,.16);

function createWall() {
  const z=-414;
  // Sections leave a single breach/gate — this is the actual finish point.
  const spans=[[-258,-16],[25,275]];
  for(const [a,b] of spans) {
    for(let x=a+7;x<b;x+=14) {
      const y=terrainHeight(x,z)+4.9;
      box(13.2,9.8,4.2,mat.concrete,[x,y,z],null);
      box(12.4,.5,4.9,mat.concreteDark,[x,y+5.15,z],null);
      // fracture / stepped blocks preserve the low-poly fortification silhouette.
      if (Math.abs(x)%28<7) box(2.2,2.1,4.6,mat.concreteDark,[x,y+5.9,z],null);
    }
  }
  for (const x of [-17,25]) {
    const y=terrainHeight(x,z)+5.6;
    box(2.3,11.5,5.5,mat.concrete,[x,y,z],null);
    cyl(.28,.4,2.2,6,mat.gun,[x,y+6.25,z],null);
  }
  // gate frame with amber markers, wide enough to drive through.
  const gy=terrainHeight(4,z);
  box(4.2,11.2,4.8,mat.concrete,[-16,gy+5.5,z],null);
  box(4.2,11.2,4.8,mat.concrete,[25,gy+5.5,z],null);
  box(44,3.2,5.1,mat.concrete, [4,gy+11,z],null);
  for(const x of [-12,20]) { sphere(.48,mat.yellow,[x,gy+6.8,z-2.7],7); }
}
createWall();

function createPlane(color) {
  const g = new THREE.Group(); dynamicRoot.add(g);
  const body = cyl(.42,.62,4.6,7,new THREE.MeshStandardMaterial({color,roughness:.72,flatShading:true}),[0,0,0],[Math.PI/2,0,0],g);
  // fuselage points forward along +/-X for a clean flyover silhouette.
  const wing = mesh(new THREE.ConeGeometry(3.05,.08,3), new THREE.MeshStandardMaterial({color,roughness:.8,flatShading:true}), [0,-.06,0], [0,0,Math.PI/2], [1,1,.7], g);
  wing.rotation.y=Math.PI/6;
  box(.13,.82,1.25,mat.olive,[1.4,.36,0],[-.25,0,0],g);
  box(.16,.58,.9,mat.olive,[1.5,.55,0],[0,0,0],g);
  const pilot=sphere(.22,mat.glass,[.12,.38,0],7,g); pilot.castShadow=false;
  g.scale.set(.92,.92,.92);
  return { group:g, speed: 28 + Math.random()*11, nextDrop: 7 + Math.random()*5, lane: Math.random()*2-1 };
}
planes.push(createPlane(0x4d5849),createPlane(0x677054));
planes[0].group.position.set(-255,49,-110); planes[1].group.position.set(180,63,-288); planes[1].speed *= -1;

function dropBomb(plane) {
  const p = plane.group.position;
  const bomb = mesh(new THREE.ConeGeometry(.25,.72,8),mat.gun,[p.x,p.y-.5,p.z],[Math.PI,0,0],null,dynamicRoot);
  const fins=box(.65,.07,.65,mat.metal,[p.x,p.y-.2,p.z],null,dynamicRoot); fins.rotation.y=.6;
  // The bomber must lead the moving vehicle, not simply decorate the sky with random impacts.
  const fallTime = 2.55;
  bombs.push({ mesh:bomb, fins, velocity:new THREE.Vector3((car.position.x-p.x)/fallTime,-2,(car.position.z-p.z)/fallTime), armed: .5 });
}

function burst(position, colour = 0xf09c3e, size=1) {
  const group = new THREE.Group(); group.position.copy(position); dynamicRoot.add(group);
  const core = mesh(new THREE.IcosahedronGeometry(.32*size,1),new THREE.MeshBasicMaterial({color:colour}),[0,0,0],null,null,group);
  const particles=[];
  for(let i=0;i<15;i++) {
    const p=mesh(new THREE.DodecahedronGeometry(.1+Math.random()*.15,0),new THREE.MeshBasicMaterial({color:i%3?colour:0x31332c}),[0,0,0],null,null,group);
    p.userData.vel=new THREE.Vector3((Math.random()-.5)*7,Math.random()*5,(Math.random()-.5)*7); particles.push(p);
  }
  explosions.push({group,core,particles,age:0});
}
function damage(amount, label) {
  if (!state.active || state.complete) return;
  state.health = Math.max(0, state.health - amount);
  state.shake = Math.min(.95, state.shake + amount*.016);
  flashMessage(label, amount > 25 ? 'Find cover and stay on the road edge.' : 'Vehicle armor compromised.');
  if (state.health <= 0) {
    state.active=false; state.complete=true;
    flashMessage('VEHICLE DISABLED', 'Press R to make another run.', 5);
  }
}
let messageTimer;
function flashMessage(title, sub='', timeout=2.2) {
  ui.message.innerHTML = `${title}${sub ? `<span>${sub}</span>` : ''}`;
  ui.message.classList.remove('hidden'); clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>ui.message.classList.add('hidden'), timeout*1000);
}

const car = new THREE.Group(); dynamicRoot.add(car);
function buildCar() {
  // A recognizably low-poly compact sedan: hood, trunk, glazed cabin, wheels, lamps — no cube substitute.
  const carPaint = new THREE.MeshStandardMaterial({color:0xb53f2f,roughness:.38,metalness:.26,flatShading:true});
  const darkPaint = new THREE.MeshStandardMaterial({color:0x7a2a25,roughness:.52,metalness:.16,flatShading:true});
  const base = box(2.16,.47,4.46,carPaint,[0,.52,0],null,car); base.geometry.translate(0,0,0);
  const hood=box(2.04,.23,1.32,carPaint,[0,.8,-1.36],[-.055,0,0],car);
  const trunk=box(1.98,.24,.85,carPaint,[0,.83,1.58],[.05,0,0],car);
  // Tapered greenhouse, manually faceted to keep the car clean and low poly.
  const verts = [
    -.91,.77,-.76, .91,.77,-.76, -.86,.77,1.12, .86,.77,1.12,
    -.68,1.46,-.42, .68,1.46,-.42, -.63,1.43,.72, .63,1.43,.72
  ];
  // Winding faces point outward. Keeping these normals correct prevents the classic inside-out car body problem.
  const ids = [0,5,1,0,4,5, 1,7,3,1,5,7, 3,6,2,3,7,6, 2,4,0,2,6,4, 4,7,5,4,6,7];
  const cabGeo=new THREE.BufferGeometry();cabGeo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));cabGeo.setIndex(ids);cabGeo.computeVertexNormals();
  const cabin=mesh(cabGeo,mat.glass,[0,0,0],null,null,car); cabin.castShadow=true;
  // Window frames and windshield/side definition.
  for(const s of [-1,1]) {
    const frame=box(.065,.74,1.53,darkPaint,[s*.91,1.1,.17],[0,0,-.11],car); frame.castShadow=false;
    const mirror=sphere(.14,mat.gun,[s*1.15,1.02,-.55],7,car); mirror.scale.set(1,.55,.7);
  }
  box(1.5,.055,.07,mat.metal,[0,1.44,.11],[-.12,0,0],car).castShadow=false;
  for(const s of [-1,1]) {
    const wheel = cyl(.48,.48,.31,10,mat.black,[s*1.12,.42,-1.37],[0,0,Math.PI/2],car); wheel.castShadow=true;
    const wheel2 = cyl(.48,.48,.31,10,mat.black,[s*1.12,.42,1.37],[0,0,Math.PI/2],car); wheel2.castShadow=true;
    for(const z of [-1.37,1.37]) { const hub=cyl(.25,.25,.325,8,mat.metal,[s*1.12,.42,z],[0,0,Math.PI/2],car); hub.castShadow=false; }
    const head=box(.36,.19,.06,mat.yellow,[s*.65,.77,-2.26],null,car); head.castShadow=false;
    const tail=box(.36,.18,.06,new THREE.MeshStandardMaterial({color:0x9d241e,emissive:0x3e0806}),[s*.65,.77,2.25],null,car); tail.castShadow=false;
  }
  const bumper=box(2.05,.18,.13,mat.metal,[0,.43,-2.29],null,car); bumper.castShadow=false;
}
buildCar();

const state = {
  active:false, complete:false, health:100, elapsed:0, speed:0, steer:0, shake:0,
  tideStart:-7.8, nearObstacle:0
};
const keys={};
window.addEventListener('keydown',e=>{ keys[e.code]=true; if(e.code==='KeyR') reset(); if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault(); });
window.addEventListener('keyup',e=>keys[e.code]=false);
function startDday() {
  if (state.active) return;
  ui.intro.classList.add('dismissed');
  state.active=true;
  const status = document.querySelector('#engine-status');
  if (status) status.textContent = 'The tide rises continuously. Press R to reset.';
  flashMessage('GO. GO. GO.', 'The breach is 640 meters inland.');
}
window.startDday = startDday;
ui.launch.addEventListener('click', startDday);

function reset() {
  state.active=true; state.complete=false; state.health=100; state.elapsed=0; state.speed=0; state.shake=0;
  car.position.set(-13, terrainHeight(-13,184)+.52,184); car.rotation.set(0,0,0);
  hazards.forEach(h=>{h.active=true; h.group.visible=true; h.group.scale.set(1,1,1);});
  [...bullets].forEach(b=>{dynamicRoot.remove(b.mesh); bullets.splice(bullets.indexOf(b),1);});
  [...bombs].forEach(b=>{dynamicRoot.remove(b.mesh);dynamicRoot.remove(b.fins);bombs.splice(bombs.indexOf(b),1);});
  [...explosions].forEach(e=>{dynamicRoot.remove(e.group);explosions.splice(explosions.indexOf(e),1);});
  turrets.forEach(t=>t.cooldown=1.4+Math.random());
  ui.intro.classList.add('dismissed'); flashMessage('RUN RESET', 'The tide starts climbing again.');
}
reset(); state.active=false;
window.__ddayEngineReady = true;
if (window.__ddayStartRequested) startDday();

function spawnBullet(turret) {
  const start = new THREE.Vector3(); turret.turret.getWorldPosition(start);
  const dir = new THREE.Vector3(-Math.sin(turret.turret.rotation.y), 0, -Math.cos(turret.turret.rotation.y));
  start.addScaledVector(dir,1.45); start.y+=.38;
  const bullet=mesh(new THREE.SphereGeometry(.105,7,5),new THREE.MeshStandardMaterial({color:0xd99a3d,emissive:0x55300b,roughness:.35}),start,null,null,dynamicRoot);
  bullet.castShadow=false;
  bullets.push({mesh:bullet, velocity:dir.multiplyScalar(64).add(new THREE.Vector3(0,-.7,0)), life:3});
}
function updateTurrets(dt) {
  for(const t of turrets) {
    const origin = new THREE.Vector3(); t.group.getWorldPosition(origin);
    const d=dist2D(origin,car.position); t.cooldown-=dt;
    if(d<t.range && t.cooldown<=0 && state.active) {
      const dx=car.position.x-origin.x,dz=car.position.z-origin.z;
      // local barrel faces -Z.
      t.turret.rotation.y=Math.atan2(-dx,-dz);
      spawnBullet(t); t.cooldown=1.65+Math.random()*.85;
    }
  }
  for(let i=bullets.length-1;i>=0;i--) {
    const b=bullets[i]; b.life-=dt; b.mesh.position.addScaledVector(b.velocity,dt);
    if(dist2D(b.mesh.position,car.position)<1.33 && Math.abs(b.mesh.position.y-car.position.y)<1.7) {
      burst(b.mesh.position,0xe1a143,.38); damage(7,'MACHINE-GUN HIT'); b.life=0;
    }
    if(b.life<=0) {dynamicRoot.remove(b.mesh);bullets.splice(i,1);}
  }
}
function updateBombs(dt) {
  for(const plane of planes) {
    plane.group.position.x += plane.speed*dt;
    plane.group.rotation.z = plane.speed>0 ? -.035 : .035;
    plane.group.rotation.y = plane.speed>0 ? -Math.PI/2 : Math.PI/2;
    if(plane.group.position.x>330 || plane.group.position.x<-330) {
      plane.group.position.x*=-1; plane.speed*=-1; plane.group.position.z=car.position.z+(Math.random()-.5)*160; plane.group.position.y=48+Math.random()*20;
    }
    plane.nextDrop-=dt;
    if(state.active && plane.nextDrop<0 && Math.abs(plane.group.position.x-car.position.x)<108) {
      // Pull across the current sector before releasing: the bombs intentionally threaten the vehicle.
      plane.group.position.z=car.position.z + plane.lane*13;
      dropBomb(plane); plane.nextDrop=8+Math.random()*6;
    }
  }
  for(let i=bombs.length-1;i>=0;i--) {
    const b=bombs[i]; b.armed-=dt; b.velocity.y-=15*dt; b.mesh.position.addScaledVector(b.velocity,dt); b.fins.position.copy(b.mesh.position).add(new THREE.Vector3(0,.28,0)); b.fins.rotation.y+=dt*4;
    const floor=terrainHeight(b.mesh.position.x,b.mesh.position.z)+.12;
    if(b.mesh.position.y<=floor) {
      const p=b.mesh.position.clone(); p.y=floor+.35; burst(p,0xf08d2c,2.5);
      if(dist2D(p,car.position)<10) damage(Math.round(42*(1-dist2D(p,car.position)/12)),'BOMB BLAST');
      dynamicRoot.remove(b.mesh);dynamicRoot.remove(b.fins);bombs.splice(i,1);
    }
  }
}
function updateExplosions(dt) {
  for(let i=explosions.length-1;i>=0;i--) {
    const e=explosions[i];e.age+=dt; e.core.scale.setScalar(1+e.age*7); e.core.visible=e.age<.17;
    for(const p of e.particles) { p.position.addScaledVector(p.userData.vel,dt); p.userData.vel.y-=11*dt; p.rotation.x+=dt*7; }
    if(e.age>.75) {dynamicRoot.remove(e.group);explosions.splice(i,1);}
  }
}
function updateHazards() {
  for(const h of hazards) if(h.active && dist2D(h,car.position)<h.radius) {
    h.active=false; h.group.visible=false;
    const p=new THREE.Vector3(h.x,terrainHeight(h.x,h.z)+.4,h.z); burst(p,0xe8732b,2.1); damage(h.damage,'TANK MINE'); state.speed*=.42;
  }
}

const camWanted=new THREE.Vector3(), camLook=new THREE.Vector3();
function updatePlayer(dt) {
  const forwardKey=keys.KeyW||keys.ArrowUp, backKey=keys.KeyS||keys.ArrowDown;
  const leftKey=keys.KeyA||keys.ArrowLeft, rightKey=keys.KeyD||keys.ArrowRight;
  const throttle=(forwardKey?1:0)-(backKey?1:0);
  const boost=(keys.ShiftLeft||keys.ShiftRight) && throttle>0;
  const max=boost?34:24;
  if(throttle) state.speed+=throttle*(boost?22:15)*dt; else state.speed*=Math.pow(.20,dt);
  if(keys.Space) state.speed*=Math.pow(.025,dt);
  state.speed=clamp(state.speed,-10,max);
  const steer=(leftKey?1:0)-(rightKey?1:0);
  if(Math.abs(state.speed)>.5) car.rotation.y+=steer*Math.sign(state.speed)*dt*(1.65/(.45+Math.abs(state.speed)*.035));
  const f=new THREE.Vector3(-Math.sin(car.rotation.y),0,-Math.cos(car.rotation.y));
  car.position.addScaledVector(f,state.speed*dt);
  car.position.x=clamp(car.position.x,-273,265); car.position.z=clamp(car.position.z,-410,205);
  const floor=terrainHeight(car.position.x,car.position.z); car.position.y=THREE.MathUtils.lerp(car.position.y,floor+.52,1-Math.exp(-dt*12));
  car.rotation.z=THREE.MathUtils.lerp(car.rotation.z,-steer*Math.min(Math.abs(state.speed)/max,.9)*.11,1-Math.exp(-dt*7));
  car.rotation.x=THREE.MathUtils.lerp(car.rotation.x,-f.z*0.014,1-Math.exp(-dt*5));
  // Finish through the breach in the giant sea wall.
  if(car.position.z<-404 && car.position.x>-14 && car.position.x<22 && !state.complete) {
    state.complete=true;state.active=false; state.speed=0; flashMessage('WALL BREACH REACHED','Mission complete. The convoy has a way through.',8);
  }
}
function updateWater() {
  const tideY=state.tideStart+Math.min(10.8,state.elapsed*.11);
  water.position.y=tideY;
  const a=waterGeo.attributes.position.array;
  for(let i=0;i<a.length;i+=3) {
    const x=waterBase[i], z=waterBase[i+2];
    a[i+1]=Math.sin(z*.063+state.elapsed*1.7)*.42+Math.sin(x*.10+state.elapsed*.86)*.22;
  }
  waterGeo.attributes.position.needsUpdate=true;
  if(state.active && car.position.x<-234 && car.position.y<tideY+.8) damage(.16,'RISING WATER');
}
function updateCamera(dt) {
  const behind=new THREE.Vector3(Math.sin(car.rotation.y)*10,6.4,Math.cos(car.rotation.y)*10);
  camWanted.copy(car.position).add(behind); camWanted.y=Math.max(camWanted.y,terrainHeight(camWanted.x,camWanted.z)+3.6);
  camera.position.lerp(camWanted,1-Math.exp(-dt*3.8));
  camLook.copy(car.position).add(new THREE.Vector3(-Math.sin(car.rotation.y)*3,1.15,-Math.cos(car.rotation.y)*3));
  if(state.shake>0) { camera.position.x+=(Math.random()-.5)*state.shake;camera.position.y+=(Math.random()-.5)*state.shake;state.shake=Math.max(0,state.shake-dt*1.8); }
  camera.lookAt(camLook);
}
function updateHud() {
  const health=Math.round(state.health); ui.health.textContent=`${health}%`;ui.healthBar.style.width=`${health}%`;
  const tide=Math.round(clamp(18+state.elapsed*.55,0,100)); ui.tide.textContent=`${tide}%`;ui.tideBar.style.width=`${tide}%`;
  const d=Math.max(0,Math.round((car.position.z+404)*1.18));ui.distance.textContent=state.complete?'SECURED':`${d}m`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.045);
  if(state.active) { state.elapsed+=dt; updatePlayer(dt); updateTurrets(dt); updateHazards(); updateBombs(dt); }
  else { // distant aircraft still sell the battlefield while awaiting launch.
    for(const plane of planes) { plane.group.position.x+=plane.speed*dt*.13; if(Math.abs(plane.group.position.x)>330) plane.speed*=-1; }
  }
  updateWater(); updateExplosions(dt); updateCamera(dt); updateHud();
  renderer.render(scene,camera);
}
animate();
window.addEventListener('resize',()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
}).catch((error) => {
  console.error('D-DAY engine failed to load:', error);
  const note = document.querySelector('#engine-status');
  if (note) {
    note.textContent = '3D engine could not load. Refresh the preview and try again.';
    note.classList.add('engine-error');
  }
});

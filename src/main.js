// Slate SDF GI — WebGPU implementation of Unreal Lumen's documented architecture:
//   per-mesh distance fields -> Global Distance Field clipmaps (composed per frame
//   from placement matrices) -> Surface Cache mesh cards (captured once, lit in
//   world space, radiosity amortised across frames) -> screen-trace + GDF screen
//   probes -> final gather. The ControlVehicle from Project-Drive drives through
//   it; nothing in the GI path traces triangles or uses an alias table.
import { buildScene, buildCards, meshBounds, VEHICLE } from './scene.js';
import { MATERIALS } from './course.js';
import { bakeMeshDF } from './meshdf.js';
import { Vehicle } from './vehicle.js';
import { buildShaders } from './shaders.js';
import { matMultiply, matTranslation, matRotZ, matRotY, matChassis, matInvert, transformPoint, perspective, lookAt, V3 } from './math.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), statusEl = $('status');
const setStatus = (t) => { statusEl.textContent = t; };
function fail(msg) { $('failure').hidden = false; $('failureText').textContent = msg; setStatus('Failed'); console.error(msg); }

const ATLAS_W = 1024, ATLAS_H = 512, ATLAS_N = ATLAS_W * ATLAS_H;
const GDF_N = 64 * 64 * 64;
const CLIP_VOXEL = [0.16, 0.5, 1.5];

const keys = {};
let cameraMode = 'chase';
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyC') toggleCamera();
  if (e.code === 'KeyR') vehicle.reset();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

const vehicle = new Vehicle();
let orbit = { yaw: 2.4, pitch: 0.42, dist: 11 };
let camPos = [-16, -8, 4], camTarget = [0, 0, 1];
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); dragging = true; lastMouse = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.yaw -= (e.clientX - lastMouse[0]) * 0.005;
  orbit.pitch = V3.clamp(orbit.pitch + (e.clientY - lastMouse[1]) * 0.004, 0.05, 1.35);
  lastMouse = [e.clientX, e.clientY];
  if (cameraMode === 'chase') toggleCamera();
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = V3.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.09), 4, 40); }, { passive: false });
let dragging = false, lastMouse = [0, 0];
function toggleCamera() {
  cameraMode = cameraMode === 'chase' ? 'free' : 'chase';
  $('cameraMode').textContent = 'Camera: ' + (cameraMode === 'chase' ? 'Chase' : 'Free') + ' (C)';
}
$('cameraMode').onclick = toggleCamera;
$('resetVehicle').onclick = () => vehicle.reset();
let paused = false;
$('pauseBtn').onclick = () => { paused = !paused; $('pauseBtn').textContent = paused ? 'Resume' : 'Pause'; };

async function init() {
  if (!navigator.gpu) return fail('navigator.gpu is missing. WebGPU needs a current Chrome/Edge (or Firefox Nightly) over https/localhost.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return fail('No WebGPU adapter was returned by the browser/driver.');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e) => { console.error(e.error); setStatus('GPU error: ' + e.error.message); });
  $('status').insertAdjacentHTML('beforebegin', '');
  setStatus('Adapter ready. Building scene (ControlVehicle + DriveCourse)…');
  await new Promise(r => setTimeout(r, 10));

  // ---------- scene / cards ----------
  const scene = buildScene();
  const cardsData = buildCards(scene, ATLAS_W, ATLAS_H);
  const cards = cardsData.cards;
  const triCountByMesh = scene.meshes.map(m => { m.triCount = m.positions.length / 9; return m.triCount; });
  let triCursor = 0; scene.meshes.forEach(m => { m.triOffset = triCursor; triCursor += m.triCount; });
  const totalTris = triCursor;
  scene.placements.forEach(pl => { pl.bounds = meshBounds(scene.meshes[pl.mesh]); });

  // ---------- mesh distance fields (fresh baker, see meshdf.js) ----------
  const dfMeshList = [...new Set(scene.placements.map(p => p.dfMesh))];
  const dfIndexByMesh = new Map(dfMeshList.map((m, i) => [m, i]));
  const dfResults = [];
  for (let i = 0; i < dfMeshList.length; i++) {
    const mesh = scene.meshes[dfMeshList[i]];
    setStatus(`Baking mesh distance field ${i + 1}/${dfMeshList.length}: ${mesh.name} (${mesh.triCount} tris)…`);
    dfResults.push(await bakeMeshDF(mesh, async (p) => {
      setStatus(`Baking mesh distance field ${i + 1}/${dfMeshList.length}: ${mesh.name} — ${Math.round(p * 100)}%`);
      await new Promise(r => requestAnimationFrame(r));
    }));
  }
  const totalDfVoxels = dfResults.reduce((a, d) => a + d.voxelCount, 0);
  setStatus(`Mesh fields baked (${totalDfVoxels.toLocaleString()} voxels). Creating WebGPU pipelines…`);

  // ---------- packed GPU data ----------
  // Triangles + material records appended after MAT_BASE.
  const triData = new Float32Array((totalTris + MATERIALS.length) * 16);
  scene.meshes.forEach(m => {
    const p = m.positions;
    for (let t = 0; t < m.triCount; t++) {
      const o = (m.triOffset + t) * 16, po = t * 9;
      const ax=p[po],ay=p[po+1],az=p[po+2], bx=p[po+3],by=p[po+4],bz=p[po+5], cx=p[po+6],cy=p[po+7],cz=p[po+8];
      let nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay), ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az), nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      const l = Math.hypot(nx,ny,nz) || 1; nx/=l; ny/=l; nz/=l;
      triData.set([ax,ay,az,m.materials[t], bx,by,bz,0, cx,cy,cz,0, nx,ny,nz,0], o);
    }
  });
  MATERIALS.forEach((mat, i) => {
    triData.set([...mat.albedo, mat.roughness, ...mat.emissive, mat.metalness, 0,0,0,0, 0,0,0,0], (totalTris + i) * 16);
  });
  // DFAll: 3 vec4 per desc, then voxel data.
  let dfVoxelCursor = dfResults.length * 3;
  const dfOffsets = dfResults.map(d => { const o = dfVoxelCursor; dfVoxelCursor += d.voxelCount; return o; });
  const dfData = new Float32Array(dfVoxelCursor * 4);
  dfResults.forEach((d, i) => {
    dfData.set([...d.bmin, 0, ...d.bmax, 0, d.res[0], d.res[1], d.res[2], dfOffsets[i]], i * 12);
    for (let v = 0; v < d.voxelCount; v++) { dfData[(dfOffsets[i] + v) * 4] = d.dist[v]; dfData[(dfOffsets[i] + v) * 4 + 1] = d.tri[v]; }
  });
  // Cards buffer (112 B each).
  const cardData = new ArrayBuffer(cards.length * 112);
  {
    const f = new Float32Array(cardData), u = new Uint32Array(cardData);
    cards.forEach((c, i) => {
      const b = i * 28;
      f.set([...c.origin, 0, ...c.normal, 0, ...c.tangent, 0, ...c.bitangent, 0, c.uvMin[0], c.uvMin[1], c.uvSize[0], c.uvSize[1]], b);
      u.set([...c.atlas, c.res[0], c.res[1], c.placement, scene.meshes[c.mesh].triOffset, scene.meshes[c.mesh].triCount, c.mesh], b + 20);
    });
  }
  // U32All: atlas map, dynamic list, static list, counters.
  const COUNTER_BASE = ATLAS_N + cardsData.dynamicTexels.length + cardsData.staticTexels.length;
  const u32Data = new Uint32Array(COUNTER_BASE + 16);
  u32Data.set(new Uint32Array(cardsData.atlasMap.buffer, 0, ATLAS_N), 0);
  u32Data.set(cardsData.dynamicTexels, ATLAS_N);
  u32Data.set(cardsData.staticTexels, ATLAS_N + cardsData.dynamicTexels.length);

  // ---------- shaders / pipelines ----------
  const shaders = buildShaders({ ATLAS_N, GDF_N, triCount: totalTris, dynCount: cardsData.dynamicTexels.length, staticCount: cardsData.staticTexels.length });
  const mkModule = async (code, label) => {
    const mod = device.createShaderModule({ code, label });
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw new Error(label + ' WGSL: ' + errs.map(e => `line ${e.lineNum}: ${e.message}`).join(' | '));
    return mod;
  };
  const [modGDF, modCapture, modLighting, modProbe, modFinal, modRaster, modBlit] = await Promise.all([
    mkModule(shaders.GDF, 'GDF'), mkModule(shaders.CAPTURE, 'Capture'), mkModule(shaders.LIGHTING, 'Lighting'),
    mkModule(shaders.PROBE, 'Probe'), mkModule(shaders.FINAL, 'Final'), mkModule(shaders.RASTER, 'Raster'), mkModule(shaders.BLIT, 'Blit'),
  ]);

  const ctx = canvas.getContext('webgpu');
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const buf = (data, extra = 0) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength || data), usage: usage | extra }); if (data.byteLength) device.queue.writeBuffer(b, 0, data); return b; };
  const placementsBuf = device.createBuffer({ size: Math.max(16, scene.placements.length * 224), usage });
  const cardsBuf = buf(cardData);
  const triBuf = buf(triData);
  const dfBuf = buf(dfData);
  const gdfBuf = device.createBuffer({ size: GDF_N * 3 * 8, usage });
  const atlasBuf = device.createBuffer({ size: ATLAS_N * 8 * 16, usage });
  const u32Buf = buf(u32Data, GPUBufferUsage.COPY_SRC);
  const uniformBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const globalLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ...[1,2,3,4,5,6,7].map(b => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })),
  ]});
  const globalGroup = device.createBindGroup({ layout: globalLayout, entries: [
    { binding: 0, resource: { buffer: uniformBuf } },
    { binding: 1, resource: { buffer: placementsBuf } }, { binding: 2, resource: { buffer: cardsBuf } },
    { binding: 3, resource: { buffer: triBuf } }, { binding: 4, resource: { buffer: dfBuf } },
    { binding: 5, resource: { buffer: gdfBuf } }, { binding: 6, resource: { buffer: atlasBuf } },
    { binding: 7, resource: { buffer: u32Buf } },
  ]});
  const passLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] });
  const emptyLayout = device.createBindGroupLayout({ entries: [] });
  const emptyGroup = device.createBindGroup({ layout: emptyLayout, entries: [] });
  const mkPass = () => {
    const buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return { buffer, group: device.createBindGroup({ layout: passLayout, entries: [{ binding: 0, resource: { buffer } }] }),
             set(p, q = [0,0,0,0]) { const a = new ArrayBuffer(32); new Uint32Array(a).set(p); new Float32Array(a).set(q, 4); device.queue.writeBuffer(buffer, 0, a); } };
  };
  const passGDF = mkPass(), passCapture = mkPass(), passDirect = mkPass(), passRadDyn = mkPass(), passRadStatic = mkPass(), passResolve = mkPass(), passProbe = mkPass(), passFinal = mkPass();

  const probeTexLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ]});
  const finalTexLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write-only', viewDimension: '2d' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ]});
  const layoutWith = (texLayout) => device.createPipelineLayout({ bindGroupLayouts: [globalLayout, texLayout, passLayout] });
  const pipe = async (mod, entry, texLayout, passGroup) => {
    const p = await device.createComputePipelineAsync({ layout: layoutWith(texLayout), compute: { module: mod, entryPoint: entry } });
    return { pipeline: p, passGroup };
  };
  const [pGDF, pCapture, pDirect, pRad, pResolve] = await Promise.all([
    pipe(modGDF, 'main', emptyLayout, passGDF), pipe(modCapture, 'main', emptyLayout, passCapture),
    pipe(modLighting, 'mainDirect', emptyLayout, passDirect), pipe(modLighting, 'mainRadiosity', emptyLayout, passRadDyn),
    pipe(modLighting, 'mainResolve', emptyLayout, passResolve),
  ]);
  const pProbe = await pipe(modProbe, 'main', probeTexLayout, passProbe);
  const pFinal = await pipe(modFinal, 'main', finalTexLayout, passFinal);
  // Capture pipeline shares the direct pass group slot; give it the direct one (values unused).
  // (pCapture.passGroup may be undefined on first creation; normalise:)
  pCapture.passGroup = passDirect;

  // ---------- raster GBuffer ----------
  // Vertex: pos3, normal3, albedo4 (rgb, roughness), emissive4 (rgb, metalness), data4 (placement,0,0,0)
  const verts = [];
  scene.placements.forEach((pl, pi) => {
    const m = scene.meshes[pl.mesh], p = m.positions;
    for (let t = 0; t < m.triCount; t++) {
      const mat = MATERIALS[m.materials[t]], o = t * 9;
      let nx=0, ny=0, nz=0;
      {
        const ax=p[o],ay=p[o+1],az=p[o+2], bx=p[o+3],by=p[o+4],bz=p[o+5], cx=p[o+6],cy=p[o+7],cz=p[o+8];
        nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay); ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az); nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
        const l = Math.hypot(nx,ny,nz) || 1; nx/=l; ny/=l; nz/=l;
      }
      for (let k = 0; k < 3; k++) verts.push(p[o+k*3], p[o+k*3+1], p[o+k*3+2], nx, ny, nz,
        mat.albedo[0], mat.albedo[1], mat.albedo[2], mat.roughness, mat.emissive[0], mat.emissive[1], mat.emissive[2], mat.metalness, pi, 0, 0, 0);
    }
  });
  const vertexBuf = buf(new Float32Array(verts), GPUBufferUsage.VERTEX);
  const vertexCount = verts.length / 18;
  const rasterLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
  ]});
  const rasterGroup = device.createBindGroup({ layout: rasterLayout, entries: [
    { binding: 0, resource: { buffer: uniformBuf } }, { binding: 1, resource: { buffer: placementsBuf } },
  ]});
  const rasterPipe = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [rasterLayout] }),
    vertex: { module: modRaster, entryPoint: 'vs', buffers: [{ arrayStride: 72, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x4' },
      { shaderLocation: 4, offset: 56, format: 'float32x4' },
    ]}]},
    fragment: { module: modRaster, entryPoint: 'fs', targets: [{ format: 'rgba16float' }, { format: 'rgba16float' }, { format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const blitPipe = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: modBlit, entryPoint: 'vs' },
    fragment: { module: modBlit, entryPoint: 'fs', targets: [{ format: canvasFormat }] },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  // ---------- resizeable targets ----------
  let targets = null;
  function resize() {
    const scale = parseFloat($('renderScale').value);
    const w = Math.max(64, Math.floor(canvas.clientWidth * scale)), h = Math.max(64, Math.floor(canvas.clientHeight * scale));
    if (targets && targets.w === w && targets.h === h) return;
    canvas.width = w; canvas.height = h;
    if (targets) { targets.textures.forEach(t => t.destroy()); targets.probeBuf.destroy(); }
    const mkTex = (format, usageFlags) => device.createTexture({ size: [w, h], format, usage: usageFlags });
    const gAlbedo = mkTex('rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    const gNormal = mkTex('rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    const gEmissive = mkTex('rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    const gDepth = device.createTexture({ size: [w, h], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const outTex = mkTex('rgba16float', GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING);
    const gridX = Math.ceil(w / 8), gridY = Math.ceil(h / 8), probeCount = gridX * gridY;
    const probeBuf = device.createBuffer({ size: Math.max(16, probeCount * 6 * 16), usage });
    const probeGroup = device.createBindGroup({ layout: probeTexLayout, entries: [
      { binding: 0, resource: gAlbedo.createView() }, { binding: 1, resource: gNormal.createView() },
      { binding: 2, resource: gEmissive.createView() }, { binding: 3, resource: gDepth.createView() },
      { binding: 4, resource: { buffer: probeBuf } },
    ]});
    const finalGroup = device.createBindGroup({ layout: finalTexLayout, entries: [
      { binding: 0, resource: gAlbedo.createView() }, { binding: 1, resource: gNormal.createView() },
      { binding: 2, resource: gEmissive.createView() }, { binding: 3, resource: gDepth.createView() },
      { binding: 4, resource: outTex.createView() }, { binding: 5, resource: { buffer: probeBuf } },
    ]});
    const blitGroup = device.createBindGroup({ layout: blitPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: outTex.createView() }, { binding: 1, resource: sampler },
    ]});
    targets = { w, h, gridX, gridY, probeCount, probeBuf, probeGroup, finalGroup, blitGroup,
                textures: [gAlbedo, gNormal, gEmissive, gDepth, outTex],
                views: [gAlbedo.createView(), gNormal.createView(), gEmissive.createView()], depthView: gDepth.createView() };
    // PiP label placement
    const pipSize = Math.min(300, Math.floor(w * 0.32));
    const label = $('pipLabel');
    label.style.left = (canvas.clientWidth - pipSize / scale - 16) + 'px';
    label.style.top = (canvas.clientHeight - pipSize / scale - 16 - 22) + 'px';
    targets.pipSize = pipSize;
  }

  // ---------- placement packing ----------
  const placementData = new ArrayBuffer(scene.placements.length * 224);
  function packPlacements(matrices) {
    const f = new Float32Array(placementData), u = new Uint32Array(placementData);
    scene.placements.forEach((pl, i) => {
      const m = matrices[i], inv = matInvert(m);
      const df = dfResults[dfIndexByMesh.get(pl.dfMesh)];
      const b = i * 56;
      f.set(m, b); f.set(inv, b + 16);
      // local DF bounds + conservative distance scale (min basis length)
      const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
      f.set([...df.bmin, Math.min(sx, sy, sz)], b + 32);
      f.set([...df.bmax, df.bmax[0]], b + 36);
      // world bounds from the 8 DF-box corners
      const wmn = [1e30,1e30,1e30], wmx = [-1e30,-1e30,-1e30];
      for (let cxi = 0; cxi < 8; cxi++) {
        const corner = [cxi & 1 ? df.bmax[0] : df.bmin[0], cxi & 2 ? df.bmax[1] : df.bmin[1], cxi & 4 ? df.bmax[2] : df.bmin[2]];
        const w = transformPoint(m, corner);
        for (let a = 0; a < 3; a++) { wmn[a] = Math.min(wmn[a], w[a]); wmx[a] = Math.max(wmx[a], w[a]); }
      }
      f.set([...wmn, 0], b + 40); f.set([...wmx, 0], b + 44);
      const mesh = scene.meshes[pl.mesh];
      const culled = (pl.kind === 'smallEmissive' && !$('includeSmall').checked) ? 1 : 0;
      u.set([mesh.triOffset, mesh.triCount, dfIndexByMesh.get(pl.dfMesh), pl.firstCard], b + 48);
      u.set([pl.cardCount, 0xFFFFFFFF, culled, pl.dynamic ? 1 : 0], b + 52);
    });
    device.queue.writeBuffer(placementsBuf, 0, placementData);
  }
  function vehicleMatrices() {
    const mats = scene.placements.map(pl => pl.matrix);
    const chassis = matChassis(vehicle.pos, vehicle.yaw, vehicle.pitch, vehicle.roll);
    mats[scene.bodyPlacement] = chassis;
    scene.wheelPlacements.forEach((wp, i) => {
      const [ax, ay] = VEHICLE.Axles[i];
      const steer = i < 2 ? vehicle.steerAngle : 0;
      let local = matMultiply(matTranslation([ax, ay, VEHICLE.HubLocalZ - vehicle.wheelTravel[i] * 0.4]),
                    matMultiply(matRotZ(steer), matRotY(vehicle.wheelSpin)));
      mats[wp] = matMultiply(chassis, local);
    });
    return mats;
  }

  // ---------- per-frame uniforms ----------
  const uniformData = new ArrayBuffer(1024);
  const uf = new Float32Array(uniformData), uu = new Uint32Array(uniformData);
  let frame = 0, outgoingRead = 6, probeReadSel = 0, staticStart = 0;
  let clipCenters = [[0,0,1],[0,0,1],[0,0,1]];
  const counterStaging = device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  let counterPending = false;
  // ---------- one-time capture ----------
  resize();
  packPlacements(vehicleMatrices());
  {
    // GDF must exist before capture lighting seeds; compose all levels once.
    const enc = device.createCommandEncoder();
    const run = (p, entry, groups) => { const c = enc.beginComputePass(); c.setPipeline(p.pipeline); c.setBindGroup(0, globalGroup); c.setBindGroup(1, emptyGroup); c.setBindGroup(2, p.passGroup.group); c.dispatchWorkgroups(...groups); c.end(); };
    writeUniforms(enc, { levelMask: 7, outgoing: [6, 7], probeSel: 0 });
    run(pGDF, 'main', [16, 16, 16]);
    run(pCapture, 'main', [ATLAS_W / 16, ATLAS_H / 16]);
    run(pDirect, 'mainDirect', [ATLAS_W / 16, ATLAS_H / 16]);
    run(pResolve, 'mainResolve', [ATLAS_W / 16, ATLAS_H / 16]);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  setStatus('Running. Drive with W/A/S/D or watch auto-drive; the GDF slice (bottom-right) is composed live from the moving car.');
  $('statScene').textContent = `${scene.placements.length} placements · ${cards.length} cards · ${totalTris.toLocaleString()} tris · ${totalDfVoxels.toLocaleString()} mesh-DF voxels`;
  $('culledList').textContent = 'Culled from Lumen Scene right now: ' +
    ($('includeSmall').checked ? 'none (toggle off to cull)' : scene.smallEmissives.map(i => scene.placements[i].name).join(', '));

  function writeUniforms(enc, opts) {
    const az = parseFloat($('sunAz').value) * Math.PI / 180, el = parseFloat($('sunEl').value) * Math.PI / 180;
    const sunDir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const aspect = targets.w / targets.h;
    const proj = perspective(0.96, aspect, 0.1, 320);
    const view = lookAt(camPos, camTarget, [0, 0, 1]);
    const vp = matMultiply(proj, view);
    uf.set(vp, 0); uf.set(matInvert(vp), 16);
    const F = (i, v) => uf.set(v, 32 + i * 4);
    const freeze = $('freezeGdf').checked;
    if (!freeze) {
      clipCenters = clipCenters.map((c, li) => {
        const snap = CLIP_VOXEL[li] * 2;
        return [
          Math.round(vehicle.pos[0] / snap) * snap, Math.round(vehicle.pos[1] / snap) * snap,
          Math.max(CLIP_VOXEL[li] * 16, Math.round((vehicle.pos[2] + 0.8) / snap) * snap),
        ];
      });
    }
    F(0, [...camPos, parseFloat($('exposure').value)]);
    F(1, [...sunDir, 3.2]);
    F(2, [1.0, 0.96, 0.88, performance.now() / 1000]);
    F(3, [0.30, 0.40, 0.65, 1.0]);
    clipCenters.forEach((c, li) => F(4 + li, [...c, CLIP_VOXEL[li]]));
    F(7, [...vehicle.pos, vehicle.pos[2] + 0.2]);
    F(8, [targets.w, targets.h, targets.gridX, targets.gridY]);
    F(9, [-3, 0, 5.0, 110]);            // point light 1: overhead panel area
    F(10, [1.0, 0.88, 0.70, 60]);        // colour 1, point light 2 intensity
    F(11, [17, -3, 2.6, 0]);
    F(12, [0.45, 0.75, 1.0, 1.0]);       // colour 2, reflection scale
    const pipOn = $('pip').checked && parseInt($('viewMode').value) !== 5;
    const ps = targets.pipSize || 300;
    F(13, pipOn ? [targets.w - ps - 16, targets.h - ps - 16, targets.w - 16, targets.h - 16] : [0, 0, 0, 0]);
    F(15, [9.0, 0, 0, 0]);
    const U = (i, v) => uu.set(v, 128 + i * 4);
    let flags = 0;
    if ($('screenTraces').checked) flags |= 2;
    if (pipOn) flags |= 8;
    U(0, [frame, parseInt($('viewMode').value), 0, flags]);
    U(1, [scene.placements.length, cards.length, totalTris, dfResults.length]);
    U(2, [ATLAS_W, ATLAS_H, cardsData.dynamicTexels.length, cardsData.staticTexels.length]);
    U(4, [opts.levelMask, 0, 0, 0]);
    U(6, [outgoingRead, outgoingRead === 6 ? 7 : 6, 0, 0]);
    device.queue.writeBuffer(uniformBuf, 0, uniformData);
    return { sunDir };
  }

  // ---------- main loop ----------
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsShown = 0;
  async function loop(now) {
    requestAnimationFrame(loop);
    const dtMs = now - last; last = now;
    const dt = Math.min(dtMs / 1000, 0.05);
    fpsAcc += dtMs; fpsN++;
    resize();
    if (!paused) {
      if (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || keys.Space) { vehicle.auto = false; $('autoDrive').checked = false; }
      vehicle.auto = $('autoDrive').checked;
      vehicle.step(dt, keys);
    }
    // camera
    if (cameraMode === 'chase') {
      const fwd = vehicle.forward();
      const desired = [vehicle.pos[0] - fwd[0] * 9.5, vehicle.pos[1] - fwd[1] * 9.5, vehicle.pos[2] + 3.4];
      const k = 1 - Math.exp(-dt * 4.5);
      camPos = camPos.map((c, i) => c + (desired[i] - c) * k);
      camTarget = [vehicle.pos[0] + fwd[0] * 5, vehicle.pos[1] + fwd[1] * 5, vehicle.pos[2] + 0.9];
    } else {
      camTarget = [vehicle.pos[0], vehicle.pos[1], vehicle.pos[2] + 0.6];
      camPos = [
        camTarget[0] + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist,
        camTarget[1] + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist,
        camTarget[2] + Math.sin(orbit.pitch) * orbit.dist,
      ];
    }
    packPlacements(vehicleMatrices());
    const freeze = $('freezeGdf').checked;
    const levelMask = freeze ? 0 : (1 | (frame % 2 === 0 ? 2 : 0) | (frame % 4 === 0 ? 4 : 0));
    // zero probe-trace counters for this frame
    device.queue.writeBuffer(u32Buf, COUNTER_BASE * 4, new Uint32Array(16));
    const enc = device.createCommandEncoder();
    writeUniforms(enc, { levelMask, probeSel: probeReadSel });
    const run = (p, groups, texGroup) => {
      const c = enc.beginComputePass(); c.setPipeline(p.pipeline); c.setBindGroup(0, globalGroup);
      c.setBindGroup(1, texGroup || emptyGroup); c.setBindGroup(2, p.passGroup.group);
      c.dispatchWorkgroups(...groups); c.end();
    };
    // 1) Global Distance Field clipmap composition (placement matrices only — no rebake)
    if (levelMask) run(pGDF, [16, 16, 16]);
    // 2) surface-cache direct lighting (world-space card positions, GDF soft shadows)
    run(pDirect, [ATLAS_W / 16, ATLAS_H / 16]);
    // 3) radiosity, amortised: dynamic (vehicle) cards every frame, static texels in rotation
    const raysStatic = parseInt($('raysStatic').value);
    const fraction = parseFloat($('updateFraction').value);
    const budget = Math.max(64, Math.ceil(cardsData.staticTexels.length * fraction));
    passRadDyn.set([0, 0, 0, 4]);
    run(pRad, [Math.ceil(cardsData.dynamicTexels.length / 64)], undefined);
    // radiosity static uses its own pass group:
    {
      const c = enc.beginComputePass(); c.setPipeline(pRad.pipeline); c.setBindGroup(0, globalGroup);
      c.setBindGroup(1, emptyGroup); c.setBindGroup(2, passRadStatic.group);
      passRadStatic.set([1, staticStart, budget, raysStatic]);
      c.dispatchWorkgroups(Math.ceil(budget / 64)); c.end();
    }
    staticStart = (staticStart + budget) % Math.max(1, cardsData.staticTexels.length);
    // 4) resolve outgoing radiance (reads this frame's direct + accumulated indirect)
    run(pResolve, [ATLAS_W / 16, ATLAS_H / 16]);
    // 5) raster primary visibility (GBuffer)
    {
      const pass = enc.beginRenderPass({
        colorAttachments: targets.views.map(v => ({ view: v, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' })),
        depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(rasterPipe); pass.setBindGroup(0, rasterGroup); pass.setVertexBuffer(0, vertexBuf);
      pass.draw(vertexCount); pass.end();
    }
    // 6) screen probes (screen trace, then GDF trace; temporal history rejection)
    const probeWriteSel = 1 - probeReadSel;
    passProbe.set([0, probeReadSel, probeWriteSel, parseInt($('probeRays').value)]);
    run(pProbe, [Math.ceil(targets.gridX / 8), Math.ceil(targets.gridY / 8)], targets.probeGroup);
    // 7) final gather
    passFinal.set([0, probeWriteSel, 0, 0]);
    run(pFinal, [Math.ceil(targets.w / 8), Math.ceil(targets.h / 8)], targets.finalGroup);
    // 8) blit
    {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(blitPipe); pass.setBindGroup(0, targets.blitGroup); pass.draw(3); pass.end();
    }
    if (frame % 60 === 30) enc.copyBufferToBuffer(u32Buf, COUNTER_BASE * 4, counterStaging, 0, 32);
    device.queue.submit([enc.finish()]);
    outgoingRead = outgoingRead === 6 ? 7 : 6;
    probeReadSel = probeWriteSel;
    if (frame % 60 === 30 && !counterPending) {
      counterPending = true;
      counterStaging.mapAsync(GPUMapMode.READ).then(() => {
        const v = new Uint32Array(counterStaging.getMappedRange());
        $('statCounters').textContent = `${v[1].toLocaleString()} rays · ${v[2].toLocaleString()} march steps · ${v[3].toLocaleString()} surface hits · ${v[4].toLocaleString()} sky`;
        counterStaging.unmap(); counterPending = false;
      }).catch(() => { counterPending = false; });
    }
    frame++;
    if (fpsAcc > 500) {
      fpsShown = Math.round(1000 / (fpsAcc / fpsN)); fpsAcc = 0; fpsN = 0;
      $('statFps').textContent = `${fpsShown} fps · ${targets.w}×${targets.h}`;
      const composed = (levelMask ? [1,2,4].filter(b => levelMask & b).length : 0) * GDF_N;
      $('statPasses').textContent = freeze ? 'GDF FROZEN' :
        `${composed.toLocaleString()} GDF voxels composed · ${(cardsData.dynamicTexels.length + budget).toLocaleString()} cache texels relit · ${targets.probeCount.toLocaleString()} probes`;
      $('statVehicle').textContent = `${Math.round(vehicle.speed * 3.6)} km/h · gear ${vehicle.gear} · ${Math.round(vehicle.rpm)} rpm · pos ${vehicle.pos[0].toFixed(1)}, ${vehicle.pos[1].toFixed(1)}`;
      $('statClips').textContent = clipCenters.map((c, i) => `L${i} ${c[0].toFixed(0)},${c[1].toFixed(0)}`).join(' · ') + (freeze ? ' (frozen)' : '');
      $('culledList').textContent = 'Culled from Lumen Scene right now: ' +
        ($('includeSmall').checked ? 'none (toggle off to cull)' : scene.smallEmissives.map(i => scene.placements[i].name).join(', '));
    }
    for (const [id, val, suffix] of [['sunAz', 'sunAzVal', '°'], ['sunEl', 'sunElVal', '°'], ['exposure', 'exposureVal', '×'], ['renderScale', 'scaleVal', '×']])
      $(val).textContent = ` ${$(id).value}${suffix}`;
  }
  requestAnimationFrame(loop);
}

init().catch(e => fail(e.message + (e.stack ? '\n' + e.stack.split('\n').slice(0, 4).join('\n') : '')));

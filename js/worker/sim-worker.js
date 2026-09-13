// Sim worker: owns the VoxelField + mesh cache. Erosion runs in slices so the
// UI stays live (progress, cancel, intermediate remeshes).
import { VoxelField, buildStack } from '../sim/field.js';
import { runHydraulic } from '../sim/erode-hydraulic.js';
import { runThermal } from '../sim/erode-thermal.js';
import { runWind } from '../sim/erode-wind.js';
import { runRivers } from '../sim/erode-river.js';
import { surfaceMesh, colorize } from '../sim/mesher.js';
import { meshToOBJ } from '../sim/mesher.js';

let field = null;
let mesh = null; // {positions, normals, indices, attr, colors, ...}
let colorMode = 'material', seaLevel = 7.5, snowline = 34;
let stopFlag = false;
let jobSeq = 0;
const ledger = { eroded: 0, deposited: 0, particles: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendMesh(id, type, extra = {}) {
  if (!mesh) return;
  const m = {
    type, id,
    positions: mesh.positions, normals: mesh.normals,
    colors: mesh.colors, indices: mesh.indices,
    nv: mesh.nv, tris: mesh.tris, ...extra,
  };
  postMessage(m, [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer]);
  // mesh buffers are now detached — rebuild lightweight refs for recolor:
  mesh.positions = null; mesh.normals = null; mesh.colors = null; mesh.indices = null;
}
function remesh(id, label) {
  const t0 = Date.now();
  mesh = surfaceMesh(field);
  mesh.colors = colorize(mesh, field, colorMode, seaLevel, snowline);
  mesh.ms = Date.now() - t0;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'cancel') { stopFlag = true; return; }
  if (msg.type === 'build') return doBuild(msg);
  if (msg.type === 'erode') return doErode(msg);
  if (msg.type === 'remesh') {
    remesh(msg.id);
    sendMesh(msg.id, 'mesh');
    return;
  }
  if (msg.type === 'recolor') {
    colorMode = msg.mode; seaLevel = msg.sea; snowline = msg.snow;
    if (mesh && mesh.attr) {
      const colors = colorize(mesh, field, colorMode, seaLevel, snowline);
      mesh.colors = colors;
      postMessage({ type: 'colors', id: msg.id, colors }, [colors.buffer]);
      mesh.colors = null;
    }
    return;
  }
  if (msg.type === 'heightmap') {
    const { nx, nz, ny } = field;
    const data = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let h = -1e9;
      for (let y = ny - 1; y >= 0; y--) {
        if (field.den[field.idx(x, y, z)] > 0) { h = field.voxToWorldY(y); break; }
      }
      data[z * nx + x] = h;
    }
    postMessage({ type: 'heightmapData', id: msg.id, w: nx, h: nz, data }, [data.buffer]);
    return;
  }
  if (msg.type === 'exportObj') {
    if (!mesh || !mesh.positions) remesh(msg.id);
    if (!mesh.colors) mesh.colors = colorize(mesh, field, colorMode, seaLevel, snowline);
    const text = meshToOBJ(mesh);
    postMessage({ type: 'obj', id: msg.id, text });
    return;
  }
};

async function doBuild(msg) {
  const myJob = ++jobSeq;
  stopFlag = false;
  const P = msg.project;
  seaLevel = P.seaLevel; snowline = P.snowline;
  const N = P.resN, NY = Math.round(N / 2);
  postMessage({ type: 'progress', id: msg.id, frac: 0, label: 'allocating ' + N + '×' + NY + '×' + N });
  await sleep(10);
  field = new VoxelField(N, NY, N, P.size, P.size / 2, P.size, 0);
  ledger.eroded = 0; ledger.deposited = 0; ledger.particles = 0;
  const stats = buildStack(field, msg.layers, P, (frac, label) => {
    postMessage({ type: 'progress', id: msg.id, frac: frac * 0.85, label });
  });
  if (myJob !== jobSeq) return;
  postMessage({ type: 'progress', id: msg.id, frac: 0.9, label: 'meshing' });
  await sleep(5);
  remesh(msg.id);
  postMessage({ type: 'progress', id: msg.id, frac: 1, label: 'done' });
  sendMesh(msg.id, 'built', { stats, meshMs: mesh.ms, ledger: { ...ledger } });
}

async function doErode(msg) {
  const myJob = ++jobSeq;
  stopFlag = false;
  if (!field) { postMessage({ type: 'eroded', id: msg.id, kind: msg.kind, error: 'no field — build first' }); return; }
  seaLevel = msg.seaLevel;
  const kind = msg.kind;
  const P = msg.params;
  const t0 = Date.now();
  let acc = { particles: 0, eroded: 0, deposited: 0, drift: 0 };
  let riverPaths = null;
  const sliceTarget = kind === 'river' ? 1 : Math.max(1, Math.ceil((P.count || P.samples || 1000) / (msg.slice || 8000)));
  let lastMeshT = 0;
  const totalUnits = kind === 'river' ? 1 : kind === 'thermal' ? P.samples : P.count;
  for (let s = 0; s < sliceTarget; s++) {
    if (stopFlag || myJob !== jobSeq) break;
    const frac0 = s / sliceTarget;
    let res;
    const hooks = {
      onProgress: (f, viz) => {
        const frac = (s + f) / sliceTarget;
        if (viz && viz.length) {
          const copy = Float32Array.from(viz.subarray(0, Math.min(viz.length, 60000)));
          postMessage({ type: 'erodeProgress', id: msg.id, kind, frac, viz: copy, vizN: copy.length / 3 }, [copy.buffer]);
        } else {
          postMessage({ type: 'erodeProgress', id: msg.id, kind, frac });
        }
      },
    };
    if (kind === 'hydro') {
      const n0 = Math.floor((totalUnits * s) / sliceTarget), n1 = Math.floor((totalUnits * (s + 1)) / sliceTarget);
      res = runHydraulic(field, { ...P, count: n1 - n0, seed: (P.seed | 0) + s * 7919 }, seaLevel, hooks);
    } else if (kind === 'thermal') {
      const n0 = Math.floor((totalUnits * s) / sliceTarget), n1 = Math.floor((totalUnits * (s + 1)) / sliceTarget);
      res = runThermal(field, { ...P, samples: n1 - n0, seed: (P.seed | 0) + s * 104729 }, hooks);
    } else if (kind === 'wind') {
      const n0 = Math.floor((totalUnits * s) / sliceTarget), n1 = Math.floor((totalUnits * (s + 1)) / sliceTarget);
      res = runWind(field, { ...P, count: n1 - n0, seed: (P.seed | 0) + s * 1299709 }, hooks);
    } else if (kind === 'river') {
      res = runRivers(field, P, seaLevel, hooks);
      riverPaths = res.paths;
    }
    acc.particles += res.particles; acc.eroded += res.eroded; acc.deposited += res.deposited;
    ledger.eroded += res.eroded; ledger.deposited += res.deposited; ledger.particles += res.particles;
    // intermediate live remesh (throttled)
    const now = Date.now();
    if ((now - lastMeshT > 900 || s === sliceTarget - 1) && !stopFlag && myJob === jobSeq) {
      lastMeshT = now;
      remesh(msg.id);
      const prog = (s + 1) / sliceTarget;
      postMessage({ type: 'erodeProgress', id: msg.id, kind, frac: prog, live: true });
      sendMesh(msg.id, 'mesh', { live: true });
    }
    postMessage({ type: 'erodeProgress', id: msg.id, kind, frac: (s + 1) / sliceTarget });
    await sleep(0); // let cancel land
  }
  acc.drift = acc.eroded - acc.deposited;
  acc.ms = Date.now() - t0;
  acc.cancelled = stopFlag || myJob !== jobSeq;
  if (!acc.cancelled) {
    remesh(msg.id);
    sendMesh(msg.id, 'mesh', { live: false });
  }
  postMessage({
    type: 'eroded', id: msg.id, kind, ledger: { ...acc },
    global: { ...ledger }, rivers: riverPaths,
    driftPct: acc.eroded > 0 ? (100 * Math.abs(acc.drift) / acc.eroded).toFixed(2) : '0.00',
  });
}

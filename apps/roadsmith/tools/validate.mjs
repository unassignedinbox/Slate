#!/usr/bin/env node
// Topology audit for the Roadsmith generator. Runs headless (no WebGPU, no DOM).
//
//   node tools/validate.mjs            default city
//   node tools/validate.mjs --preset downtown --seed 12 --verbose

import { RoadNetwork, resetIds } from '../src/road/network.js';
import { defaultProfile, ROAD_CLASS } from '../src/road/profile.js';
import { buildSurface } from '../src/road/build.js';
import { FLOATS_PER_VERTEX, SURF } from '../src/core/mesh.js';
import { buildScene, assembleScene, defaultSettings } from '../src/road/scene.js';
import { solveNetwork } from '../src/road/junction.js';
import { pointInPolygonXZ } from '../src/core/math.js';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const verbose = args.includes('--verbose');

function testNetwork() {
  resetIds();
  const net = new RoadNetwork();
  const c = net.addNode({ x: 0, y: 0, z: 0 }, { control: 'signal' });
  const e = net.addNode({ x: 70, y: 0, z: 0 });
  const w = net.addNode({ x: -80, y: 0, z: 0 });
  const n = net.addNode({ x: 0, y: 0, z: -75 });
  const s = net.addNode({ x: 0, y: 0, z: 90 });
  const t = net.addNode({ x: 70, y: 0, z: 70 });
  const y = net.addNode({ x: -60, y: 0, z: 60 });

  const arterial = defaultProfile(ROAD_CLASS.ARTERIAL);
  const local = defaultProfile(ROAD_CLASS.LOCAL);
  const collector = defaultProfile(ROAD_CLASS.COLLECTOR);

  net.addEdge(c.id, e.id, { profile: { ...arterial } });
  net.addEdge(c.id, w.id, { profile: { ...arterial } });
  net.addEdge(c.id, n.id, { profile: { ...collector } });
  net.addEdge(c.id, s.id, { profile: { ...collector }, via: [{ x: 12, y: 0, z: 45 }] });
  net.addEdge(e.id, t.id, { profile: { ...local } });
  net.addEdge(s.id, t.id, { profile: { ...local }, via: [{ x: 55, y: 0, z: 95 }] });
  net.addEdge(w.id, y.id, { profile: { ...local } });
  net.addEdge(y.id, s.id, { profile: { ...local } });

  // damage + calming so the displacement paths are exercised
  const first = [...net.edges.values()][0];
  first.features.potholes.push({ s: 30, t: 2.4, r: 0.75, depth: 0.09 });
  first.features.potholes.push({ s: 42, t: -3.1, r: 0.5, depth: 0.06 });
  const localEdge = [...net.edges.values()][4];
  localEdge.features.speedBumps.push({ s: 18, length: 3.7, height: 0.1, type: 'hump' });
  localEdge.features.construction.push({ s0: 30, s1: 42, t0: -5, t1: -1.2, depth: 0.55, kind: 'trench' });
  return net;
}

function audit(result) {
  const { mesh } = result;
  const V = mesh.vertices, F = FLOATS_PER_VERTEX;
  const issues = [];
  const stat = {
    vertices: mesh.vertexCount,
    quads: mesh.quadCount,
    tris: mesh.triCount,
    welds: mesh.welds,
    quadRatio: 0,
    degenerate: 0,
    nonManifold: 0,
    boundaryEdges: 0,
    duplicateFaces: 0,
    maxQuadWarp: 0,
    warpP99: 0,
    minQuadArea: Infinity,
    nanVertices: 0,
  };

  // quads cover 2 tris each
  const triFromQuads = mesh.quadCount * 2;
  stat.quadRatio = triFromQuads / mesh.triCount;

  for (let i = 0; i < mesh.vertexCount; i++) {
    const o = i * F;
    for (let k = 0; k < 3; k++) if (!Number.isFinite(V[o + k])) stat.nanVertices++;
    const nl = Math.hypot(V[o + 3], V[o + 4], V[o + 5]);
    if (!(nl > 0.5)) issues.push(`vertex ${i} has a degenerate normal`);
  }

  const P = (i) => ({ x: V[i * F], y: V[i * F + 1], z: V[i * F + 2] });
  const warps = [];
  const edgeUse = new Map();
  const faceKeys = new Set();
  const Q = mesh.quads;
  for (let q = 0; q < Q.length; q += 4) {
    const idx = [Q[q], Q[q + 1], Q[q + 2], Q[q + 3]];
    const pts = idx.map(P);
    const area = quadArea(pts);
    if (area < 1e-6) stat.degenerate++;
    stat.minQuadArea = Math.min(stat.minQuadArea, area);
    const wp = quadWarp(pts);
    warps.push(wp);
    stat.maxQuadWarp = Math.max(stat.maxQuadWarp, wp);
    const fk = idx.slice().sort((a, b) => a - b).join(',');
    if (faceKeys.has(fk)) stat.duplicateFaces++;
    faceKeys.add(fk);
  }
  warps.sort((a, b) => a - b);
  stat.warpP99 = warps.length ? warps[Math.floor(warps.length * 0.99)] : 0;
  stat.warpP50 = warps.length ? warps[Math.floor(warps.length * 0.5)] : 0;
  const T = mesh.indices;
  for (let t = 0; t < T.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = T[t + k], b = T[t + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
    }
  }
  for (const [, n] of edgeUse) {
    if (n === 1) stat.boundaryEdges++;
    else if (n > 2) stat.nonManifold++;
  }
  return { stat, issues };
}

function quadArea(p) {
  const tri = (a, b, c) => {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  return tri(p[0], p[1], p[2]) + tri(p[0], p[2], p[3]);
}

function quadWarp(p) {
  // distance of the 4th corner from the plane of the first three, relative to the quad size
  const ux = p[1].x - p[0].x, uy = p[1].y - p[0].y, uz = p[1].z - p[0].z;
  const vx = p[2].x - p[0].x, vy = p[2].y - p[0].y, vz = p[2].z - p[0].z;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return 1;
  nx /= l; ny /= l; nz /= l;
  const d = Math.abs((p[3].x - p[0].x) * nx + (p[3].y - p[0].y) * ny + (p[3].z - p[0].z) * nz);
  const size = Math.sqrt(quadArea(p)) || 1;
  return d / size;
}

/** Mouth rows must be welded into the junction plates: no duplicated positions at a seam. */
function auditSeams(net, result) {
  const { mesh } = result;
  const V = mesh.vertices, F = FLOATS_PER_VERTEX;
  const bucket = new Map();
  for (let i = 0; i < mesh.vertexCount; i++) {
    const o = i * F;
    const key = `${Math.round(V[o] * 1e3)},${Math.round(V[o + 1] * 1e3)},${Math.round(V[o + 2] * 1e3)}`;
    bucket.set(key, (bucket.get(key) || 0) + 1);
  }
  let coincident = 0;
  for (const [, n] of bucket) if (n > 1) coincident += n - 1;
  return { coincident };
}

const sceneMode = args.some((a) => a.startsWith('--scene'));
const presetArg = arg('preset', 'downtown');
const seed = Number(arg('seed', 7));

const pass = [];
const fail = [];
const check = (ok, label, detail) => (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ''}`);
const fmt = (n) => n.toLocaleString();

console.log('\n\u001b[1mRoadsmith · topology audit\u001b[0m');
console.log('─'.repeat(64));

if (!sceneMode) {
  const net = testNetwork();
  const t0 = performance.now();
  const result = buildSurface(net, { seed });
  const ms = performance.now() - t0;
  const { stat, issues } = audit(result);
  const seams = auditSeams(net, result);
  report(`${net.nodes.size} nodes · ${net.edges.size} roads · ${result.junctions.size} junction plates`, stat, ms);
  runChecks(stat, issues, seams, result.mesh.vertexCount);
  if (verbose) {
    for (const [id, j] of result.junctions) {
      console.log(`  · ${id} ${j.kind} r=${j.radius.toFixed(1)}m branches=${j.branchCount} ctrl=${j.control}`);
    }
  }
} else {
  const settings = defaultSettings(presetArg);
  settings.seed = seed;
  const t0 = performance.now();
  const scene = buildScene(settings);
  const ms = performance.now() - t0;
  const { stat, issues } = audit(scene.surface);
  const seams = auditSeams(scene.net, scene.surface);
  report(`${presetArg} · ${scene.stats.nodes} nodes · ${scene.stats.roads} roads · ${scene.stats.junctions} junctions · ${scene.stats.lengthKm.toFixed(2)} km`, stat, ms);
  console.log(`whole scene    ${fmt(scene.stats.vertices)} verts · ${fmt(scene.stats.quads)} quads · ${fmt(scene.stats.triangles)} tris · ${(scene.stats.quadRatio * 100).toFixed(1)}% quad`);
  console.log(`city           ${scene.blocks.blocks.length} blocks · ${scene.rail.crossings.length} level crossings · ${scene.parked.length} parked · ${scene.stats.vehicles} AI vehicles`);
  console.log(`stage ms       ${Object.entries(scene.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join('  ')}`);
  runChecks(stat, issues, seams, scene.surface.mesh.vertexCount);

  // every other mesh must also be finite, quad-dominant and non-degenerate
  let subQuad = 0, subTri = 0, bad = 0, nan = 0;
  for (const [name, m] of sceneMeshes(scene)) {
    subQuad += m.quadCount; subTri += m.triCount;
    const V = m.vertices;
    for (let i = 0; i < m.vertexCount; i++) {
      const o = i * FLOATS_PER_VERTEX;
      if (!Number.isFinite(V[o]) || !Number.isFinite(V[o + 1]) || !Number.isFinite(V[o + 2])) { nan++; break; }
    }
    const { stat: st } = audit({ mesh: m });
    if (st.degenerate > m.quadCount * 0.01) { bad++; if (verbose) console.log(`  · ${name} ${st.degenerate} slivers of ${m.quadCount}`); }
  }
  check(nan === 0, 'all scene meshes finite', `${nan} meshes with NaN`);
  check(bad === 0, 'prop/block meshes free of slivers', `${bad} meshes above 1% degenerate`);
  check(subTri === 0 || (subQuad * 2) / subTri > 0.93, 'props + city quad-dominant', `${(((subQuad * 2) / subTri) * 100).toFixed(1)}%`);

  // traffic soak
  const sim = scene.traffic;
  let nanPose = 0, maxV = 0, stuck = 0, over = 0;
  for (let i = 0; i < 1800; i++) {
    sim.step(1 / 60);
    if (scene.trains) scene.trains.step(1 / 60, sim);
    if (sim.vehicles.length > 25) over++;
    for (const v of sim.vehicles) {
      if (!Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.y) || !Number.isFinite(v.pos.z) || !Number.isFinite(v.yaw)) nanPose++;
      maxV = Math.max(maxV, v.v);
    }
  }
  for (const v of sim.vehicles) if (v.stoppedFor > 45) stuck++;
  const moving = sim.vehicles.filter((v) => v.v > 0.5).length;
  console.log(`traffic 30 s   ${sim.vehicles.length} live · ${moving} moving · ${(maxV * 3.6).toFixed(0)} km/h peak · ${sim.recycled} recycled`);
  check(nanPose === 0, 'vehicle poses finite', `${nanPose} bad poses`);
  check(over === 0, 'fleet never exceeds 25 vehicles', `${over} frames over cap`);
  check(stuck === 0, 'no permanently stuck vehicles', `${stuck} stuck > 45 s`);
  check(moving >= Math.min(4, sim.vehicles.length), 'traffic actually flows', `${moving} moving`);
  check(scene.blocks.blocks.length >= 4, 'city blocks closed', `${scene.blocks.blocks.length} blocks`);

  // ---- directional props: a sign that faces the wrong way is worse than no sign ----------
  {
    const faceSurf = new Set([SURF.SIGN_SPEED, SURF.SIGN_STOP, SURF.SIGN_GIVEWAY, SURF.SIGN_INFO]);
    const sg = scene.props.meshes.signage;
    let flat = 0, plates = 0;
    const faces = [];
    if (sg) {
      for (let t = 0; t < sg.indices.length; t += 3) {
        const o = sg.indices[t] * FLOATS_PER_VERTEX;
        if (!faceSurf.has(Math.round(sg.vertices[o + 11]))) continue;
        const N = { x: sg.vertices[o + 3], y: sg.vertices[o + 4], z: sg.vertices[o + 5] };
        plates++;
        if (Math.abs(N.y) > 0.5) flat++;
        faces.push({ p: { x: sg.vertices[o], y: sg.vertices[o + 1], z: sg.vertices[o + 2] }, N });
      }
    }
    let wrongWay = 0, rightWay = 0;
    for (const [, j] of scene.surface.junctions) {
      for (const mo of j.mouths) {
        if (!mo.kerbR) continue;
        for (const f of faces) {
          if (Math.hypot(f.p.x - mo.kerbR.x, f.p.z - mo.kerbR.z) > 6) continue;
          const d = f.N.x * mo.dir.x + f.N.z * mo.dir.z;
          if (d > 0.3) rightWay++; else if (d < -0.3) wrongWay++;
        }
      }
    }
    check(flat === 0, 'sign plates stand vertical', `${flat}/${plates} faces lying flat`);
    check(wrongWay === 0, 'junction signs face oncoming traffic', `${rightWay} aimed at traffic · ${wrongWay} aimed away`);

    let backwards = 0;
    for (const v of scene.traffic.vehicles) {
      const path = v.conn ? v.conn.path : v.lane.pts;
      if (!path || path.length < 2) continue;
      const i = Math.max(0, Math.min(path.length - 2, Math.floor(v.s / 3)));
      const d = { x: path[i + 1].x - path[i].x, z: path[i + 1].z - path[i].z };
      if (Math.cos(v.yaw) * d.x + Math.sin(v.yaw) * d.z < 0) backwards++;
    }
    check(backwards === 0, 'vehicles drive nose first', `${backwards}/${scene.traffic.vehicles.length} reversed`);
  }
  check(scene.laneGraph.lanes.size > 20 && scene.laneGraph.connections.length > 20,
    'lane graph connected', `${scene.laneGraph.lanes.size} lanes · ${scene.laneGraph.connections.length} turns`);


  // ---- terrain: the apron must never cover the road it sits beside
  {
    const g = scene.ground;
    const STRIDE = 20, GC = 24;
    const gh = new Map();
    for (let t = 0; t < g.indices.length; t += 3) {
      const T = [0, 1, 2].map((k) => {
        const o = g.indices[t + k] * STRIDE;
        return { x: g.vertices[o], y: g.vertices[o + 1], z: g.vertices[o + 2] };
      });
      const mnx = Math.min(T[0].x, T[1].x, T[2].x), mxx = Math.max(T[0].x, T[1].x, T[2].x);
      const mnz = Math.min(T[0].z, T[1].z, T[2].z), mxz = Math.max(T[0].z, T[1].z, T[2].z);
      for (let i = Math.floor(mnx / GC); i <= Math.floor(mxx / GC); i++) {
        for (let j = Math.floor(mnz / GC); j <= Math.floor(mxz / GC); j++) {
          const k = `${i},${j}`;
          let l = gh.get(k); if (!l) gh.set(k, (l = []));
          l.push(T);
        }
      }
    }
    const groundAt = (x, z) => {
      const l = gh.get(`${Math.floor(x / GC)},${Math.floor(z / GC)}`);
      if (!l) return null;
      let best = null;
      for (const [A, B, C] of l) {
        const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
        if (Math.abs(d) < 1e-9) continue;
        const w0 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / d;
        const w1 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const y = w0 * A.y + w1 * B.y + w2 * C.y;
        if (best === null || y > best) best = y;
      }
      return best;
    };
    let gBuried = 0, gWorst = 0, gTotal = 0;
    for (const rib of scene.surface.ribbons.values()) {
      const prof = rib.edge?.profile || {};
      // Classes with no footway reuse the walk/kerb group names for a drainage ditch, which is
      // meant to sit below the surrounding ground: only the carriageway must stay clear.
      const ditch = !(prof.footwayL > 0) && !(prof.footwayR > 0);
      for (const st of rib.stations) {
        for (const q of st.row.pts) {
          if (ditch && (q.group === 'walk' || q.group === 'kerb' || q.group === 'verge')) continue;
          const p = q.world || q.p;
          gTotal++;
          const gy = groundAt(p.x, p.z);
          if (gy === null) continue;
          const over = gy - p.y;
          if (over > 0.12) { gBuried++; gWorst = Math.max(gWorst, over); }
        }
      }
    }
    let plateUnder = 0, plateTotal = 0;
    for (const info of scene.surface.junctions.values()) {
      // Sample the disc but only score points that actually land on the plate: a 2-branch joint
      // on a 41 m motorway has a radius of 16 m and a plate only a few metres deep, so most of
      // the disc is verge, where the apron is *supposed* to sit at terrain level.
      const ring = info.boundary;
      for (let a = 0; a < 12; a++) {
        for (const f of [0.3, 0.6, 0.9]) {
          const r = info.radius * f;
          const x = info.centre.x + Math.cos((a / 12) * Math.PI * 2) * r;
          const z = info.centre.z + Math.sin((a / 12) * Math.PI * 2) * r;
          if (ring && ring.length > 2 && !pointInPolygonXZ({ x, y: 0, z }, ring)) continue;
          plateTotal++;
          const gy = groundAt(x, z);
          if (gy !== null && gy > (info.centre.y ?? 0) + 0.05) plateUnder++;
        }
      }
    }
    check(gBuried === 0, 'terrain never covers the road surface',
      gBuried ? `${gBuried}/${gTotal} road points under the apron (worst ${gWorst.toFixed(2)} m)` : `${gTotal} road points checked`);
    check(plateUnder === 0, 'terrain never covers a junction plate', `${plateUnder}/${plateTotal} plate samples buried`);
  }

  // ---- gizmo edit: drag an intersection and make sure the whole junction re-solves cleanly
  const movable = [...scene.net.nodes.values()].filter((n) => n.edges.length >= 3 && !n.locked);
  const target = movable[Math.floor(movable.length / 2)];
  const before = { x: target.p.x, z: target.p.z };
  const plateBefore = scene.surface.junctions.get(target.id)?.centre;
  const dragMs0 = performance.now();
  scene.net.moveNode(target.id, { x: before.x + 13.5, z: before.z - 9.25 });
  solveNetwork(scene.net);
  const moved = assembleScene({ net: scene.net, rails: scene.rails, subway: scene.subway, meta: scene.meta }, settings);
  const dragMs = performance.now() - dragMs0;
  const { stat: mstat, issues: mi } = audit(moved.surface);
  const mseams = auditSeams(scene.net, moved.surface);
  console.log(`gizmo drag     ${target.id} +13.5/-9.25 m · rebuilt in ${dragMs.toFixed(0)} ms · ${fmt(mstat.tris)} tris`);
  check(mstat.nanVertices === 0 && mi.length === 0, 'moved junction stays finite', `${mstat.nanVertices} NaN · ${mi.length} normal issues`);
  check(mstat.degenerate === 0, 'moved junction has no degenerate quads', `${mstat.degenerate}`);
  check(mstat.nonManifold === 0, 'moved junction stays manifold', `${mstat.nonManifold} over-used edges`);
  check(mstat.duplicateFaces === 0, 'moved junction has no stacked faces', `${mstat.duplicateFaces}`);
  check(mstat.quadRatio > 0.985, 'moved junction stays quad-dominant', `${(mstat.quadRatio * 100).toFixed(2)}%`);
  check(mseams.coincident < Math.max(64, moved.surface.mesh.vertexCount * 0.02), 'moved junction still welded', `${mseams.coincident} coincident`);
  const info = moved.surface.junctions.get(target.id);
  // the plate is re-solved around the node, so it must stay centred on it (an asymmetric
  // junction legitimately shifts its centroid a little as the approach angles change)
  const centred = info ? Math.hypot(info.centre.x - target.p.x, info.centre.z - target.p.z) : Infinity;
  const was = plateBefore ? Math.hypot(plateBefore.x - before.x, plateBefore.z - before.z) : 0;
  check(centred < Math.max(4, (info?.radius ?? 8) * 0.35),
    'junction plate stays centred on the moved node',
    `${centred.toFixed(2)} m off centre (was ${was.toFixed(2)} m, plate r=${(info?.radius ?? 0).toFixed(1)} m)`);
}

console.log('─'.repeat(64));
for (const p of pass) console.log(`  \u001b[32m✓\u001b[0m ${p}`);
for (const f of fail) console.log(`  \u001b[31m✗\u001b[0m ${f}`);
console.log('');
process.exit(fail.length ? 1 : 0);

function sceneMeshes(scene) {
  const list = [['blocks', scene.blocks.mesh], ['ground', scene.ground], ['rail', scene.rail.mesh],
    ['crossing', scene.crossing.mesh], ['subway', scene.subwayMesh],
    ['bridges', scene.structures.meshes.bridges], ['retaining', scene.structures.meshes.retaining],
    ['tunnels', scene.structures.meshes.tunnels]];
  for (const [k, m] of Object.entries(scene.props.meshes)) list.push([k, m]);
  for (const [k, m] of Object.entries(scene.vehicleMeshes)) list.push([`vehicle:${k}`, m.mesh]);
  return list.filter(([, m]) => m && m.vertexCount > 0);
}

function report(line, stat, ms) {
  console.log(`network        ${line}`);
  console.log(`road surface   ${fmt(stat.vertices)} verts · ${fmt(stat.quads)} quads · ${fmt(stat.tris)} tris`);
  console.log(`welds          ${fmt(stat.welds || 0)} vertices fused during build`);
  console.log(`build time     ${ms.toFixed(1)} ms`);
  console.log(`min quad area  ${stat.minQuadArea.toExponential(2)} m²   boundary edges ${fmt(stat.boundaryEdges)}`);
  console.log(`quad warp      p50 ${stat.warpP50.toFixed(3)} · p99 ${stat.warpP99.toFixed(3)} · max ${stat.maxQuadWarp.toFixed(3)}`);
}

function runChecks(stat, issues, seams, vcount) {
  check(stat.nanVertices === 0, 'finite geometry', `${stat.nanVertices} NaN components`);
  check(stat.quadRatio > 0.985, 'quad-dominant topology', `${(stat.quadRatio * 100).toFixed(2)}% of triangles come from quads`);
  check(stat.degenerate === 0, 'no degenerate quads', `${stat.degenerate}`);
  check(stat.duplicateFaces === 0, 'no duplicated faces (no stacked geometry)', `${stat.duplicateFaces}`);
  check(stat.nonManifold === 0, 'manifold edges (<=2 faces per edge)', `${stat.nonManifold} over-used edges`);
  check(stat.warpP99 < 0.15, 'quads near-planar (p99)', `p99 ${stat.warpP99.toFixed(3)} · max ${stat.maxQuadWarp.toFixed(3)}`);
  check(seams.coincident < Math.max(64, vcount * 0.02), 'junction seams welded', `${seams.coincident} coincident vertices (surface-id splits only)`);
  check(issues.length === 0, 'vertex normals valid', `${issues.length} problems`);
}

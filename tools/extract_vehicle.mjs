// extract_vehicle.mjs — converts the authored ControlVehicle geometry archives
// (Frontier- @ arena/4f07c82a-frontier) into the compact binary this app streams.
//
//   Sources (read-only, never modified):
//     ref/frontier/EngineContent/GeometryArchives/ControlVehicleStructure.inl   (body + wiper/armature tris)
//     ref/frontier/Projects/Project-Drive/Source/ControlVehicleRimMesh.inl      (hub-local rim)
//     ref/frontier/Projects/Project-Drive/Source/ControlVehicleTyreMesh.inl     (hub-local tyre)
//
//   Output:  assets/car.bin     (positions, smooth vertex normals, indices, per-tri material family)
//            assets/car.manifest.json
//
// Run:  node tools/extract_vehicle.mjs [path-to-frontier-checkout]
// Default frontier checkout:  ../ref/frontier  (a sibling of the Slate repo)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FRONTIER = path.resolve(process.argv[2] ?? path.join(ROOT, "..", "ref", "frontier"));

const SRC_BODY = path.join(FRONTIER, "EngineContent/GeometryArchives/ControlVehicleStructure.inl");
const SRC_RIM  = path.join(FRONTIER, "Projects/Project-Drive/Source/ControlVehicleRimMesh.inl");
const SRC_TYRE = path.join(FRONTIER, "Projects/Project-Drive/Source/ControlVehicleTyreMesh.inl");

// ---------------------------------------------------------------- inl parsing ---------------------------------------------------
function parseArray(text, name, isFloat) {
  const re = new RegExp(`${name}\\s*(?:\\[\\s*\\])?\\s*=\\s*\\{([^}]*)\\}`, "s");
  const m = re.exec(text);
  if (!m) throw new Error(`array ${name} not found`);
  const cleaned = m[1].replace(/\/\/[^\n]*/g, "");
  const out = [];
  for (let tok of cleaned.split(/[,\s]+/)) {
    if (!tok) continue;
    if (isFloat && (tok.endsWith("f") || tok.endsWith("F"))) tok = tok.slice(0, -1);
    if (!isFloat && (tok.endsWith("u") || tok.endsWith("U"))) tok = tok.slice(0, -1);
    if (!/^-?[\d.eE+]+$/.test(tok)) continue;
    const v = isFloat ? parseFloat(tok) : parseInt(tok, 10);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function readMesh(file, { vKey = "kPositions", tKey = "kTriangles", fKey = "kTriangleFamily" } = {}) {
  const src = fs.readFileSync(file, "utf8");
  const positions = parseArray(src, vKey, true);
  const triangles = parseArray(src, tKey, false);
  let family = [];
  try { family = parseArray(src, fKey, false); } catch { /* family array name differs per archive */ }
  if (family.length === 0) family = parseArray(src, "kTriangleMaterial", false);
  const vCount = positions.length / 3, tCount = triangles.length / 3;
  if (!Number.isInteger(vCount) || !Number.isInteger(tCount)) throw new Error(`ragged mesh ${file}`);
  if (family.length !== tCount) throw new Error(`family array length ${family.length} != tris ${tCount} in ${file}`);
  return { positions, triangles, family, vCount, tCount };
}

// ---------------------------------------------------------- smooth vertex normals ----------------------------------------------
function smoothNormals(mesh) {
  const { positions: p, triangles: t, vCount } = mesh;
  const n = new Array(vCount * 3).fill(0);
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function boundsOf(p) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
  return { min: lo, max: hi };
}

// ------------------------------------------------------------------ run ----------------------------------------------------------
const body = readMesh(SRC_BODY);
const rim  = readMesh(SRC_RIM, { fKey: "kTriangleMaterial" });
const tyre = readMesh(SRC_TYRE, { fKey: "kTriangleMaterial" });
for (const m of [body, rim, tyre]) m.normals = smoothNormals(m);

console.log(`body : ${body.vCount} verts ${body.tCount} tris  bounds`, boundsOf(body.positions));
console.log(`rim  : ${rim.vCount} verts ${rim.tCount} tris`);
console.log(`tyre : ${tyre.vCount} verts ${tyre.tCount} tris`);

// Binary layout (little endian):
//   header:  magic u32('SLCV') | version u32 | counts u32 x 6 (bodyV, bodyT, rimV, rimT, tyreV, tyreT)
//   per mesh, aligned to section order body/rim/tyre:
//     positions f32[v*3] · normals f32[v*3] · triangles u32[t*3] · family u32[t]
const headerU32 = new Uint32Array([0x534C4356, 1, body.vCount, body.tCount, rim.vCount, rim.tCount, tyre.vCount, tyre.tCount]);
const f32 = [];
f32.push(new Uint8Array(headerU32.buffer));
for (const m of [body, rim, tyre]) {
  f32.push(new Uint8Array(new Float32Array(m.positions).buffer));
  f32.push(new Uint8Array(new Float32Array(m.normals).buffer));
  f32.push(new Uint8Array(new Uint32Array(m.triangles).buffer));
  f32.push(new Uint8Array(new Uint32Array(m.family).buffer));
}
const blob = Buffer.concat(f32.map(b => Buffer.from(b)));
fs.mkdirSync(path.join(ROOT, "assets"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "assets", "car.bin"), blob);

// Authored physical record (VehicleGeometry.h ControlVehicleSockets): axle-mount hub sockets, +X fwd / +Y left / +Z up.
const manifest = {
  source: "Frontier- @ arena/4f07c82a-frontier (ControlVehicle.blend authored archives)",
  counts: { bodyV: body.vCount, bodyT: body.tCount, rimV: rim.vCount, rimT: rim.tCount, tyreV: tyre.vCount, tyreT: tyre.tCount },
  bounds: { body: boundsOf(body.positions), rim: boundsOf(rim.positions), tyre: boundsOf(tyre.positions) },
  hubs: { FL: [1.7274, 1.0475, 0.0914], FR: [1.7274, -1.0475, 0.0914], RL: [-1.6686, 1.0475, 0.0914], RR: [-1.6686, -1.0475, 0.0914] },
  wheelbase: 3.396, track: 2.095, tyreRadius: 0.50855, comHeight: 0.53,
};
fs.writeFileSync(path.join(ROOT, "assets", "car.manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`wrote assets/car.bin (${(blob.length / 1024).toFixed(1)} KiB) + assets/car.manifest.json`);

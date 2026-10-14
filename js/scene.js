//============================================================================================================================================
//                                                               SCENE.JS
//============================================================================================================================================
// 📦 Builds the render-side scene: the DriveCourse statics (ported emitter) + the authored ControlVehicle
//    (streamed from assets/car.bin, produced by tools/extract_vehicle.mjs from the Frontier- archives).
//    Emits Lumen-scene object records: indexed meshes with per-triangle material family, model matrices,
//    mesh-SDF descriptors for the two dynamic meshes, and the material record table (LINEAR Rec.709 values
//    straight from DriveSceneAuthor::AuthorMaterials).

import { emitCourseTriangles, Mat, Course } from "./course.js";

// ---- Material table — same order & linear values as DriveCourse.h / DriveSceneAuthor.cpp -------------------
export const MATERIALS = [
  { name: "CheckerLight", base: [0.82, 0.82, 0.84], metal: 0, rough: 0.35, emissive: [0, 0, 0], flag: 0 },
  { name: "CheckerDark",  base: [0.05, 0.05, 0.06], metal: 0, rough: 0.35, emissive: [0, 0, 0], flag: 0 },
  { name: "Surround",     base: [0.35, 0.36, 0.38], metal: 0, rough: 0.55, emissive: [0, 0, 0], flag: 0 },
  { name: "Ramp",         base: [0.42, 0.43, 0.45], metal: 0, rough: 0.40, emissive: [0, 0, 0], flag: 0 },
  { name: "SpeedBump",    base: [0.90, 0.72, 0.08], metal: 0, rough: 0.45, emissive: [0, 0, 0], flag: 0 },
  { name: "Cone",         base: [0.95, 0.35, 0.05], metal: 0, rough: 0.40, emissive: [0, 0, 0], flag: 0 },
  { name: "MetalicCoat",  base: [0.680005 * 0.78, 0.800458 * 0.78, 0.0], metal: 0, rough: 0.10, emissive: [0, 0, 0], flag: 2 },
  { name: "Glass",        base: [1, 1, 1], metal: 0, rough: 0.02, emissive: [0, 0, 0], flag: 1 },
  { name: "Plastic",      base: [0.012, 0.014, 0.018], metal: 0, rough: 0.50, emissive: [0, 0, 0], flag: 0 },
  { name: "Tyre",         base: [0.03741, 0.03741, 0.03741], metal: 0, rough: 0.76087, emissive: [0, 0, 0], flag: 0 },
  { name: "Hub",          base: [0.06, 0.22, 0.62], metal: 1, rough: 0.22, emissive: [0.0, 0.277313 * 0.12, 1.0 * 0.12], flag: 0 },
  { name: "Brake",        base: [0.30, 0.075, 0.025], metal: 0.82, rough: 0.29, emissive: [0, 0, 0], flag: 0 },
  { name: "Trim",         base: [0.8, 0.8, 0.8], metal: 0, rough: 0.50, emissive: [0, 0, 0], flag: 0 },
  { name: "Headlight",    base: [0.8, 0.8, 0.8], metal: 0, rough: 0.10, emissive: [48.7, 48.7, 48.7], flag: 0 },
  { name: "Taillight",    base: [0.8, 0.8, 0.8], metal: 0, rough: 0.10, emissive: [6.5, 0.0, 6.5 * 0.016442], flag: 0 },
  { name: "DefaultGrey",  base: [0.8, 0.8, 0.8], metal: 0, rough: 0.50, emissive: [0, 0, 0], flag: 0 },
];

export async function loadCar(urlBin = "assets/car.bin", urlManifest = "assets/car.manifest.json") {
  const [buf, manifest] = await Promise.all([
    fetch(urlBin).then(r => { if (!r.ok) throw new Error(`car.bin: HTTP ${r.status}`); return r.arrayBuffer(); }),
    fetch(urlManifest).then(r => r.json()),
  ]);
  const u32 = new Uint32Array(buf, 0, 8);
  if (u32[0] !== 0x534C4356) throw new Error("car.bin: bad magic");
  const [, , bodyV, bodyT, rimV, rimT, tyreV, tyreT] = u32;
  let off = 32;
  const take = (Ctor, n) => { const a = new Ctor(buf, off, n); off += n * a.BYTES_PER_ELEMENT; return a; };
  const read = (v, t) => ({
    positions: take(Float32Array, v * 3), normals: take(Float32Array, v * 3),
    triangles: take(Uint32Array, t * 3), family: take(Uint32Array, t),
  });
  const car = { body: read(bodyV, bodyT), rim: read(rimV, rimT), tyre: read(tyreV, tyreT), manifest };
  // merge wheel: hub-local rim + tyre in one indexed mesh
  const wv = rimV + tyreV, wt = rimT + tyreT;
  car.wheel = {
    positions: new Float32Array(wv * 3), normals: new Float32Array(wv * 3),
    triangles: new Uint32Array(wt * 3), family: new Uint32Array(wt),
  };
  car.wheel.positions.set(car.rim.positions); car.wheel.positions.set(car.tyre.positions, rimV * 3);
  car.wheel.normals.set(car.rim.normals); car.wheel.normals.set(car.tyre.normals, rimV * 3);
  car.wheel.triangles.set(car.rim.triangles);
  for (let i = 0; i < car.tyre.triangles.length; i++) car.wheel.triangles[rimT * 3 + i] = car.tyre.triangles[i] + rimV;
  car.wheel.family.set(car.rim.family); car.wheel.family.set(car.tyre.family, rimT);
  return car;
}

export function buildCourseMeshes() {
  const all = [];
  emitCourseTriangles((ax, ay, az, bx, by, bz, cx, cy, cz, m) => all.push([ax, ay, az, bx, by, bz, cx, cy, cz, m]));
  const gather = filter => {
    const pos = [], fam = [];
    for (const t of all) {
      if (!filter(t[9])) continue;
      pos.push(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8]);
      fam.push(t[9] & 0x7FFF);
    }
    return [pos, fam];
  };
  const bu = ([pos, fam]) => {
    const mesh = {
      positions: new Float32Array(pos),
      triangles: new Uint32Array(fam.length * 3),
      family: new Uint32Array(fam),
      normals: new Float32Array(pos.length),
    };
    for (let i = 0; i < mesh.triangles.length; i++) mesh.triangles[i] = i;
    for (let t = 0; t < fam.length; t++) {
      const a = t * 9, b = a + 3, c = a + 6;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      for (const k of [a, b, c]) { mesh.normals[k] = nx / l; mesh.normals[k + 1] = ny / l; mesh.normals[k + 2] = nz / l; }
    }
    return mesh;
  };
  return {
    pad: bu(gather(m => (m & 0x8000) === 0 && (m & 0x7FFF) <= Mat.Bump && m !== Mat.Surround)),
    surround: bu(gather(m => m === Mat.Surround)),    kerb: bu(gather(m => (m & 0x8000) !== 0)),
    ramp: bu(gather(m => (m & 0x8000) === 0 && m === Mat.Ramp)),
    cones: bu(gather(m => (m & 0x8000) === 0 && m === Mat.Cone)),
  };
}

// ---- coarse distance soup for far clipmaps (Lumen uses one mesh SDF for all; our far soup is decimated) ----
export function buildCoarseCourse() {
  const C = Course, pos = [], fam = [];
  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, m) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    fam.push(m, m);
  };
  const H = C.PadHalfExtent;
  quad(-H, -H, 0, H, -H, 0, H, H, 0, -H, H, 0, Mat.Surround);            // whole pad as ONE quad
  const G = H * 4;
  quad(-G, -G, -0.02, G, -G, -0.02, G, G, -0.02, -G, G, -0.02, Mat.Surround);
  { // kerb box
    const K = C.Kerb, Y0 = K.CentreY, Y1 = K.CentreY + K.Depth, h = K.Height;
    quad(K.NearX, Y0, h, K.FarX, Y0, h, K.FarX, Y1, h, K.NearX, Y1, h, Mat.Surround);
    quad(K.NearX, Y0, 0, K.FarX, Y0, 0, K.FarX, Y0, h, K.NearX, Y0, h, Mat.Surround);
    quad(K.FarX, Y1, 0, K.NearX, Y1, 0, K.NearX, Y1, h, K.FarX, Y1, h, Mat.Surround);
  }
  { // ramp wedge
    const x0 = C.RampNearX, x1 = x0 + C.RampRunX, y0 = -C.RampHalfWidth, y1 = C.RampHalfWidth, h = C.RampRise;
    quad(x0, y0, 0, x1, y0, h, x1, y1, h, x0, y1, 0, Mat.Ramp);
    pos.push(x1, y0, 0, x1, y0, h, x1, y1, h, x1, y0, 0, x1, y1, h, x1, y1, 0); fam.push(Mat.Ramp, Mat.Ramp);
    pos.push(x0, y0, 0, x1, y0, 0, x1, y0, h, x0, y1, 0, x1, y1, h, x1, y1, 0); fam.push(Mat.Ramp, Mat.Ramp);
  }
  const tri = fam.length;
  const mesh = { positions: new Float32Array(pos), triangles: new Uint32Array(tri * 3), family: new Uint32Array(fam), normals: new Float32Array(pos.length) };
  for (let i = 0; i < mesh.triangles.length; i++) mesh.triangles[i] = i;
  for (let t = 0; t < tri; t++) {
    const a = t * 9, b = a + 3, c = a + 6;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const k of [a, b, c]) { mesh.normals[k] = nx / l; mesh.normals[k + 1] = ny / l; mesh.normals[k + 2] = nz / l; }
  }
  return mesh;
}

// ---- full object list --------------------------------------------------------------------------------------
// Transform index order (must match ir places that address transforms[]):
//   0 pad · 1 kerb · 2 ramp · 3 cones · 4 body · 5 wheel FL · 6 wheel FR · 7 wheel RL · 8 wheel RR
// Transform index order (must match every place that addresses transforms[]):
//   0 pad · 1 surround · 2 kerb · 3 ramp · 4 cones · 5 body · 6 wheel FL · 7 wheel FR · 8 wheel RL · 9 wheel RR
export function buildSceneObjects(course, car) {
  return [
    { name: "pad",     tfIndex: 0, mesh: course.pad,     dynamic: false, texel: 0.25 },
    { name: "surround", tfIndex: 1, mesh: course.surround, dynamic: false, texel: 4.0 },
    { name: "kerb",    tfIndex: 2, mesh: course.kerb,    dynamic: false, texel: 0.10 },
    { name: "ramp",    tfIndex: 3, mesh: course.ramp,    dynamic: false, texel: 0.14 },
    { name: "cones",   tfIndex: 4, mesh: course.cones,   dynamic: false, texel: 0.030 },
    { name: "body",    tfIndex: 5, mesh: car.body,       dynamic: true,  texel: 0.055,
      sdf: { dims: [112, 48, 32], atlasBase: [0, 0, 0], atlasDims: [160, 64, 64], margin: 0.06 } },
    { name: "wheelFL", tfIndex: 6, mesh: car.wheel,      dynamic: true,  texel: 0.034,
      sdf: { dims: [24, 12, 24], atlasBase: [112, 0, 0], atlasDims: [160, 64, 64], margin: 0.05 } },
    { name: "wheelFR", tfIndex: 7, mesh: car.wheel,      dynamic: true,  texel: 0.034 },
    { name: "wheelRL", tfIndex: 8, mesh: car.wheel,      dynamic: true,  texel: 0.034 },
    { name: "wheelRR", tfIndex: 9, mesh: car.wheel,      dynamic: true,  texel: 0.034 },
  ];
}

// Baked G-buffer / capture streams. Render stream (gbuffer) and card-capture stream share one layout:
// pos f32x3 | nrm f32x3 | matId u32 | aux u32 (object id in render stream, card id in capture stream) = 32 B.
// Indexed source gets EXPANDED (3 verts/tri) so per-triangle constants arrive per-vertex.
export function bakeRenderStream(objects) {
  let verts = 0;
  for (const o of objects) verts += o.mesh.family.length * 3;
  const data = new ArrayBuffer(verts * 32);
  const f32 = new Float32Array(data), u32 = new Uint32Array(data);
  let o8 = 0;
  const objSpans = [];
  for (const o of objects) {
    const m = o.mesh, start = o8 / 8;
    const n = m.family.length;
    for (let t = 0; t < n; t++) {
      const mat = m.family[t];
      for (let k = 0; k < 3; k++) {
        const vi = m.triangles[t * 3 + k];
        f32[o8] = m.positions[vi * 3]; f32[o8 + 1] = m.positions[vi * 3 + 1]; f32[o8 + 2] = m.positions[vi * 3 + 2];
        f32[o8 + 3] = m.normals[vi * 3]; f32[o8 + 4] = m.normals[vi * 3 + 1]; f32[o8 + 5] = m.normals[vi * 3 + 2];
        u32[o8 + 6] = mat; u32[o8 + 7] = o.tfIndex;
        o8 += 8;
      }
    }
    objSpans.push({ first: start, count: n * 3 });
  }
  return { buffer: data, vertexCount: verts, objSpans };
}

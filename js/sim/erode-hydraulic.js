// SDF-native hydraulic droplet erosion (Hans Theobald Beyer model adapted to volumes).
// Particles ONLY edit the density field via clamped volumetric splats — they never
// displace mesh vertices (the "push/pull" artifact fix). Mass-conserving: droplets
// deposit all remaining sediment on death (sea / evaporation / TTL).
import { mulberry32 } from './noise.js';
import { clamp } from './sdf.js';

export const HYDRO_DEFAULTS = {
  count: 60000, ttl: 48, radius: 1.35, gravity: 5.0, inertia: 0.25,
  capacity: 4.0, erodeK: 0.32, depositK: 0.28, evap: 0.014, minSlope: 0.015,
  maxStepErode: 0.05, // max density removed per step, in voxel-world units (×vox)
  impact: 0.35, hardResist: 0.85, seed: 1234,
};

export function runHydraulic(field, P, seaLevel, hooks = {}) {
  const { onProgress = null, shouldStop = null, vizCap = 24000 } = hooks;
  const rng = mulberry32((P.seed | 0) * 2654435761 | 0);
  const { nx, ny, nz, vox } = field;
  const viz = new Float32Array(vizCap * 3);
  let vizN = 0; // ring buffer: always shows the most recent activity
  const pushViz = (fx, fy, fz) => {
    const k = vizN % vizCap; vizN++;
    const w = field.voxToWorld(fx, fy, fz);
    viz[k * 3] = w[0]; viz[k * 3 + 1] = w[1]; viz[k * 3 + 2] = w[2];
  };
  const vizCount = () => Math.min(vizN, vizCap);
  const g = [0, 0, 0];
  const seaY = field.worldToVoxY(seaLevel);
  const maxErode = P.maxStepErode * vox;
  const stepLen = 1.0; // voxels per flow step
  let eroded = 0, deposited = 0, killed = 0;
  const count = P.count | 0;
  const reportEvery = Math.max(1, Math.floor(count / 40));

  for (let n = 0; n < count; n++) {
    if (shouldStop && shouldStop()) break;
    // --- spawn above terrain ---
    let fx = 1 + rng() * (nx - 3), fz = 1 + rng() * (nz - 3), fy = ny - 2;
    // fall until near surface
    let fall = 0;
    while (fy > 0.5 && field.denAt(fx, fy, fz) < -vox * 0.75 && fall < ny + 4) { fy -= 1; fall++; }
    if (fy <= 0.5) { killed++; continue; }
    const p = [fx, fy, fz];
    field.projectToSurface(p, 2);
    fx = p[0]; fy = p[1]; fz = p[2];
    let dx = 0, dz = 0, dy = 0, speed = 0.9, water = 1, sed = 0;
    // rain impact shatters a tiny crater (debris joins the droplet's load)
    if (P.impact > 0) {
      const hard = clamp(field.sample(field.hard, fx, fy, fz), 0, 1);
      const imp = Math.min(maxErode * P.impact, P.impact * vox * 0.06 * (1 - hard * P.hardResist) * (0.5 + fall / ny));
      if (imp > 1e-6) { const took = -field.splat(fx, fy, fz, P.radius * 0.7, -imp, { dWet: 0.1 }); eroded += took; sed += took; }
    }
    const ttl = P.ttl;
    for (let s = 0; s < ttl; s++) {
      field.gradAt(fx, fy, fz, g);
      const gl = Math.hypot(g[0], g[1], g[2]);
      if (gl < 1e-6) break;
      // outward normal (density grows inward)
      const nx_ = -g[0] / gl, ny_ = -g[1] / gl, nz_ = -g[2] / gl;
      // gravity projected on tangent plane (downhill direction)
      let tx = 0 - nx_ * (0 * nx_ + -1 * ny_ + 0 * nz_);
      let ty = -1 - ny_ * (-ny_);
      let tz = 0 - nz_ * (-ny_);
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-6) { tx /= tl; ty /= tl; tz /= tl; } else { tx = 0; ty = -1; tz = 0; }
      dx = dx * P.inertia + tx * (1 - P.inertia);
      dy = dy * P.inertia + ty * (1 - P.inertia);
      dz = dz * P.inertia + tz * (1 - P.inertia);
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      const px = fx, py = fy, pz = fz;
      fx += dx * stepLen; fy += dy * stepLen; fz += dz * stepLen;
      // keep on surface: re-project; if far outside (cliff edge), fall
      let d = field.denAt(fx, fy, fz);
      if (d < -vox * 2.5) {
        let f2 = 0;
        while (fy > 0.5 && field.denAt(fx, fy, fz) < -vox * 0.75 && f2 < ny) { fy -= 1; f2++; speed = Math.min(3, speed + f2 * 0.05); }
        if (fy <= 0.5 || f2 >= ny) { break; }
        d = field.denAt(fx, fy, fz);
      }
      if (fx < 1 || fz < 1 || fx > nx - 2 || fz > nz - 2 || fy < 0.5 || fy > ny - 1) break;
      const q = [fx, fy, fz];
      field.projectToSurface(q, 1);
      fx = q[0]; fy = q[1]; fz = q[2];
      const dh = (py - fy) * vox; // descent in world units
      const slope = Math.max(0, dh / (stepLen * vox));
      speed = Math.sqrt(Math.max(0.02, speed * speed + dh * P.gravity * 0.15));
      const cap = Math.max(0, slope - P.minSlope) * speed * water * P.capacity * vox * 0.25 + 1e-5;
      const hard = clamp(field.sample(field.hard, fx, fy, fz), 0, 1);
      const soft = 1 - hard * P.hardResist;
      if (s % 3 === 0) pushViz(fx, fy, fz);
      // below sea: dump everything, die
      if (fy < seaY) {
        if (sed > 1e-5) deposited += field.splat(fx, fy, fz, P.radius * 1.4, sed, { dSed: sed, dWet: 0.4, setHard: 0.12, hardMix: 0.5 });
        sed = 0; break;
      }
      if (sed > cap || dh < 0) {
        const amt = dh < 0 ? Math.min(sed, sed * P.depositK + 0.002 * vox) : (sed - cap) * P.depositK;
        if (amt > 1e-6) {
          deposited += field.splat(fx, fy, fz, P.radius, amt, { dSed: amt, dWet: 0.12, setHard: 0.14, hardMix: 0.4 });
          sed -= amt;
        }
        if (dh < 0) speed *= 0.6;
      } else {
        let amt = Math.min((cap - sed) * P.erodeK * soft, maxErode * (0.3 + 0.7 * soft));
        amt = Math.min(amt, Math.max(0, dh) * 0.6 + 0.004 * vox); // never dig more than descent allows
        if (amt > 1e-7) {
          const took = -field.splat(fx, fy, fz, P.radius, -amt, { dWet: 0.1 });
          eroded += took; sed += took;
        }
      }
      water *= (1 - P.evap);
      if (water < 0.02) break;
    }
    // conservation: deposit carried load where the droplet dies
    if (sed > 1e-5 && fy > 0.5 && fx > 0 && fz > 0 && fx < nx - 1 && fz < nz - 1) {
      deposited += field.splat(fx, fy, fz, P.radius * 1.2, sed, { dSed: sed, dWet: 0.15, setHard: 0.14, hardMix: 0.4 });
      sed = 0;
    } else sed = 0;
    if (onProgress && (n % reportEvery === 0 || n === count - 1)) onProgress(n / count, viz.subarray(0, vizCount() * 3), vizCount());
  }
  return { particles: count, eroded, deposited, killed, drift: eroded - deposited, viz: viz.subarray(0, vizCount() * 3), vizN: vizCount() };
}

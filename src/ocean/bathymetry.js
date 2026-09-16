// Analytic bathymetry D(x,z) in meters (positive = water depth).
// MUST match the GLSL in src/ocean/glsl.js (BATHY_GLSL) exactly.
export const BATHY_MODES = ['Open ocean', 'Beach', 'Sandbar', 'Reef (Pipeline)', 'Point break'];

export function defaultBathyParams() {
  return {
    mode: 1,
    shoreX: 40,      // beach: x of the waterline (m)
    slope: 0.02,     // beach slope
    tide: 0.0,       // m above datum
    barX: 190,       // sandbar crest x
    barH: 2.4,       // sandbar height (m)
    barW: 38,        // sandbar width (m)
    reefEdge: -160,  // reef: x of the reef edge
    reefDepth: 1.6,  // reef flat depth (m)
    reefDeep: 30,    // depth seaward of reef (m)
    angleDeg: 28,    // point-break rotation (deg)
  };
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function depthAt(x, z, P) {
  const mode = P.mode | 0;
  if (mode === 0) return 250;
  let X = x, Z = z;
  if (mode === 4) {
    const a = (P.angleDeg * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    X = c * x - s * z; Z = s * x + c * z;
  }
  const wig = 30 * Math.sin(Z * 0.008) + 15 * Math.sin(Z * 0.023 + 1.7);
  const beach = (X, extraDeep = true) => {
    const d = X - (P.shoreX + wig);
    let D = d * P.slope + P.tide;
    if (extraDeep && d > 600) { const e = d - 600; D += 0.00004 * e * e; }
    return D;
  };
  let D;
  if (mode === 1) {
    D = beach(X);
  } else if (mode === 2) {
    D = beach(X);
    const t = (X - P.barX) / P.barW;
    D -= P.barH * Math.exp(-t * t);
  } else {
    // reef / point: deep -> sudden shelf -> flat -> sand ramp
    const shelf = smoothstep(P.reefEdge - 60, P.reefEdge + 60, X);
    D = P.reefDeep + (P.reefDepth - P.reefDeep) * shelf;
    const ramp = smoothstep(P.shoreX - 60, P.shoreX + 40, X);
    D = D + (-2.0 - D) * ramp;
    D += P.tide;
  }
  return Math.min(300, Math.max(-4, D));
}

// Direction toward shore (downhill of depth), numeric gradient.
export function shoreDirAt(x, z, P, out = { x: 1, z: 0 }) {
  const e = 2.0;
  const dx = depthAt(x + e, z, P) - depthAt(x - e, z, P);
  const dz = depthAt(x, z + e, P) - depthAt(x, z - e, P);
  const n = Math.hypot(dx, dz);
  if (n < 1e-6) { out.x = 1; out.z = 0; return out; }
  out.x = -dx / n; out.z = -dz / n;
  return out;
}

// Green's-law + group-velocity shoaling gain for wavenumber k at depth D.
export function shoalingGain(k, D, Dref = 250) {
  if (!(k > 0) || !(D > 0.15)) return 1;
  const g = 9.81;
  const w0 = Math.sqrt(g * k);
  const cg0 = 0.5 * (w0 / k);
  const c = Math.sqrt((g / k) * Math.tanh(k * D));
  const kd = k * D;
  const s = Math.sinh(2 * kd);
  const n = s > 1e-6 ? 0.5 * (1 + (2 * kd) / s) : 1.0;
  const cg = Math.max(c * n, 1e-3);
  return Math.min(2.6, Math.max(0.5, Math.sqrt(cg0 / cg)));
}

// Realistic erosion simulations operating on a Heightfield.
// Each mutates the field and returns terrain signals used by the satmap.

function hash(i) {
  let h = (i | 0) * 374761393 + 1442695040;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeRng(seed) {
  let s = (seed | 0) * 2654435761 + 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** D8 flow accumulation over the field. Returns raw accumulation (cells). */
export function flowAccumulation(field) {
  const s = field.size, d = field.data;
  const acc = new Float32Array(s * s).fill(1);
  const order = new Int32Array(s * s);
  for (let i = 0; i < s * s; i++) order[i] = i;
  // sort indices by height descending
  const sorted = Array.from(order).sort((a, b) => d[b] - d[a]);
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  for (let k = 0; k < sorted.length; k++) {
    const i = sorted[k];
    const x = i % s, y = (i / s) | 0;
    let best = -1, bestDrop = 0;
    for (let n = 0; n < 8; n++) {
      const nx = x + dx[n], ny = y + dy[n];
      if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
      const dist = (dx[n] && dy[n]) ? 1.4142 : 1;
      const drop = (d[i] - d[ny * s + nx]) / dist;
      if (drop > bestDrop) { bestDrop = drop; best = ny * s + nx; }
    }
    if (best >= 0) acc[best] += acc[i];
  }
  return acc;
}

function normalizeLog(acc, out) {
  let mx = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > mx) mx = acc[i];
  const logMax = Math.log(1 + mx);
  for (let i = 0; i < acc.length; i++) out[i] = Math.log(1 + acc[i]) / Math.max(logMax, 1e-6);
  return out;
}

/**
 * Particle-based hydraulic erosion (Beyer-style droplets).
 * Carves channels, deposits sediment, and records flow / deposition signals.
 */
export function hydraulicErode(field, params) {
  const s = field.size, d = field.data;
  const rng = makeRng(params.seed || 12);
  const flow = new Float32Array(s * s);
  const deposition = new Float32Array(s * s);
  const droplets = Math.round(params.droplets ?? 28000);
  const lifetime = Math.round(params.lifetime ?? 42);
  const inertia = params.inertia ?? 0.045;
  const capacityFactor = params.capacity ?? 3.2;
  const depositionRate = params.deposition ?? 0.28;
  const erosionRate = params.erosion ?? 0.35;
  const evaporation = params.evaporation ?? 0.022;
  const gravity = params.gravity ?? 5.5;
  const minSlope = params.minSlope ?? 0.012;
  const radius = Math.round(params.radius ?? 3);
  const depositFeedback = params.sedimentFeedback !== 0;

  // precompute brush offsets with normalized weights
  const brush = [];
  let brushSum = 0;
  for (let by = -radius; by <= radius; by++) {
    for (let bx = -radius; bx <= radius; bx++) {
      const r2 = bx * bx + by * by;
      if (r2 > radius * radius) continue;
      const w = 1 - Math.sqrt(r2) / (radius + 0.5);
      brush.push([bx, by, w]);
      brushSum += w;
    }
  }
  for (const b of brush) b[2] /= brushSum;

  const heightGrad = (px, py) => {
    const x = Math.min(s - 2, Math.max(0, px | 0));
    const y = Math.min(s - 2, Math.max(0, py | 0));
    const fx = px - x, fy = py - y;
    const i = y * s + x;
    const h00 = d[i], h10 = d[i + 1], h01 = d[i + s], h11 = d[i + s + 1];
    const h = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
    const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
    return [h, gx, gy];
  };

  for (let n = 0; n < droplets; n++) {
    let px = rng() * (s - 2) + 0.5;
    let py = rng() * (s - 2) + 0.5;
    let dirX = 0, dirY = 0, speed = 1, water = 1, sediment = 0;

    for (let step = 0; step < lifetime; step++) {
      const [h, gx, gy] = heightGrad(px, py);
      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-8) {
        const a = rng() * Math.PI * 2;
        dirX = Math.cos(a); dirY = Math.sin(a);
      } else {
        dirX /= len; dirY /= len;
      }
      const nx = px + dirX, ny = py + dirY;
      if (nx < 1 || ny < 1 || nx >= s - 2 || ny >= s - 2) {
        // drop leaves the map — dump remaining sediment
        const cx = Math.min(s - 1, Math.max(0, px | 0)), cy = Math.min(s - 1, Math.max(0, py | 0));
        d[cy * s + cx] += sediment;
        deposition[cy * s + cx] += sediment;
        sediment = 0;
        break;
      }
      const [nh] = heightGrad(nx, ny);
      const deltaH = nh - h;

      const cx = Math.min(s - 1, Math.max(0, nx | 0));
      const cy = Math.min(s - 1, Math.max(0, ny | 0));
      const cell = cy * s + cx;
      flow[cell] += water;

      // Capacity is scaled to the height-field units (fields live near 0..1),
      // so droplets carry material comparable to local relief, not more.
      const capacity = Math.min(Math.max(-deltaH, minSlope * 0.3) * speed * water * capacityFactor * 0.22, 0.6);

      if (sediment > capacity || deltaH > 0) {
        const amount = Math.min(
          deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - capacity) * depositionRate,
          sediment,
        );
        sediment -= amount;
        // bilinear deposit
        const fx = nx - (nx | 0), fy = ny - (ny | 0);
        const x0 = nx | 0, y0 = ny | 0;
        if (x0 >= 0 && y0 >= 0 && x0 + 1 < s && y0 + 1 < s) {
          d[y0 * s + x0] += amount * (1 - fx) * (1 - fy);
          d[y0 * s + x0 + 1] += amount * fx * (1 - fy);
          d[(y0 + 1) * s + x0] += amount * (1 - fx) * fy;
          d[(y0 + 1) * s + x0 + 1] += amount * fx * fy;
          if (depositFeedback) {
            deposition[cell] += amount * 0.7;
            deposition[y0 * s + x0] += amount * 0.1;
            deposition[y0 * s + x0 + 1] += amount * 0.1;
            deposition[(y0 + 1) * s + x0] += amount * 0.05;
            deposition[(y0 + 1) * s + x0 + 1] += amount * 0.05;
          } else {
            deposition[cell] += amount;
          }
        }
      } else {
        // per-step erosion is scaled to the height units — with tens of
        // thousands of droplet visits per cell, unscaled rates churn the
        // whole surface instead of carving channels
        const amount = Math.min((capacity - sediment) * erosionRate, -deltaH, 0.08) * 0.1;
        if (amount > 0) {
          for (let b = 0; b < brush.length; b++) {
            const [bx, by, w] = brush[b];
            const ex = cx + bx, ey = cy + by;
            if (ex < 0 || ey < 0 || ex >= s || ey >= s) continue;
            d[ey * s + ex] -= amount * w;
          }
          sediment += amount;
        }
      }

      speed = Math.min(2.6, Math.sqrt(Math.max(0, speed * speed - deltaH * gravity)));
      water *= (1 - evaporation);
      px = nx; py = ny;
    }
    // lifetime over — settle whatever the droplet still carries (mass conservation)
    if (sediment > 1e-6) {
      const cx = Math.min(s - 1, Math.max(0, px | 0)), cy = Math.min(s - 1, Math.max(0, py | 0));
      d[cy * s + cx] += sediment;
      deposition[cy * s + cx] += sediment;
    }
  }

  const flowNorm = new Float32Array(s * s);
  normalizeLog(flow, flowNorm);
  let dMax = 0;
  for (let i = 0; i < deposition.length; i++) if (deposition[i] > dMax) dMax = deposition[i];
  if (dMax > 0) for (let i = 0; i < deposition.length; i++) deposition[i] /= dMax;
  return { flow: flowNorm, deposition };
}

/** Thermal / talus erosion — material above the repose angle slides downhill. */
export function thermalErode(field, params) {
  const s = field.size, d = field.data;
  const talus = params.talus ?? 0.62;
  const iterations = Math.round(params.iterations ?? 42);
  const rate = params.rate ?? 0.42;
  const slide = new Float32Array(s * s);
  const dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
  for (let it = 0; it < iterations; it++) {
    const delta = new Float32Array(s * s);
    for (let y = 1; y < s - 1; y++) {
      for (let x = 1; x < s - 1; x++) {
        const i = y * s + x;
        const h = d[i];
        let lowest = h;
        const drops = [0, 0, 0, 0];
        let total = 0;
        for (let n = 0; n < 4; n++) {
          const j = (y + dy[n]) * s + (x + dx[n]);
          const hn = d[j];
          if (hn < lowest) lowest = hn;
          const diff = h - hn;
          if (diff > talus * 0.02) {
            drops[n] = diff - talus * 0.02;
            total += drops[n];
          }
        }
        if (total <= 0) continue;
        // move at most half the excess, never more material than keeps the
        // cell above its lowest neighbour — guarantees convergence
        const excess = h - lowest - talus * 0.02;
        const move = Math.min(total * 0.5 * rate, Math.max(0, excess) * 0.5);
        if (move <= 0) continue;
        for (let n = 0; n < 4; n++) {
          if (drops[n] <= 0) continue;
          const amount = move * (drops[n] / total);
          const j = (y + dy[n]) * s + (x + dx[n]);
          delta[i] -= amount;
          delta[j] += amount;
          slide[j] += amount;
        }
      }
    }
    for (let i = 0; i < d.length; i++) d[i] += delta[i];
  }
  let mx = 0;
  for (let i = 0; i < slide.length; i++) if (slide[i] > mx) mx = slide[i];
  if (mx > 0) for (let i = 0; i < slide.length; i++) slide[i] /= mx;
  return { slide };
}

/** Aeolian (wind) erosion — abrasion on windward faces, drift in the lee. */
export function windErode(field, params) {
  const s = field.size, d = field.data;
  const rng = makeRng(params.seed || 27);
  const strength = params.strength ?? 0.45;
  const abrasion = params.abrasion ?? 0.55;
  const deposition = params.deposition ?? 0.5;
  const duneScale = params.duneScale ?? 2.6;
  const iterations = Math.round(params.iterations ?? 18);
  const dir = (params.direction ?? 38) * Math.PI / 180;
  const wx = Math.cos(dir), wy = Math.sin(dir);
  const drift = new Float32Array(s * s);
  const stepX = wx * 1.6, stepY = wy * 1.6;
  for (let it = 0; it < iterations; it++) {
    const delta = new Float32Array(s * s);
    for (let y = 2; y < s - 2; y++) {
      for (let x = 2; x < s - 2; x++) {
        const i = y * s + x;
        // upwind fetch height
        const ux = x - stepX * 2, uy = y - stepY * 2;
        const ui = ((uy | 0) * s + (ux | 0));
        const fetch = d[ui] - d[i];
        const exposure = Math.max(0, fetch);
        if (exposure > 0.0008) {
          const cut = Math.min(exposure * strength * abrasion * (0.65 + rng() * 0.35) * 0.07, 0.05);
          delta[i] -= cut;
          // deposit some material downwind
          const dxp = x + stepX * 2, dyp = y + stepY * 2;
          const di = ((dyp | 0) * s + (dxp | 0));
          if (di >= 0 && di < delta.length) {
            delta[di] += cut * deposition * 0.75;
            drift[di] += cut;
          }
          drift[i] += cut * 0.15;
        }
        // gentle dune drift aligned with wind
        const ripple = Math.sin((x * wx + y * wy) * (0.11 * duneScale) + it * 0.13)
          * Math.cos((x * -wy + y * wx) * (0.028 * duneScale) + 1.7);
        delta[i] += ripple * strength * 0.0012 * (0.4 + deposition * 0.6);
      }
    }
    for (let i = 0; i < d.length; i++) d[i] += delta[i];
  }
  let mx = 0;
  for (let i = 0; i < drift.length; i++) if (drift[i] > mx) mx = drift[i];
  if (mx > 0) for (let i = 0; i < drift.length; i++) drift[i] /= mx;
  return { drift };
}

/**
 * River incision — carve channels along high flow-accumulation paths and
 * soften their banks. Uses (or recomputes) the flow field.
 */
export function riverIncise(field, params, flowIn) {
  const s = field.size, d = field.data;
  const power = params.power ?? 1.35;
  const depth = params.depth ?? 0.35;
  const bankSoftness = params.bankSoftness ?? 0.35;
  const threshold = params.threshold ?? 0.06;
  const tributary = params.tributary ?? 0.4;
  const acc = new Float32Array(s * s);
  normalizeLog(flowIn ?? flowAccumulation(field), acc);
  const cut = new Float32Array(s * s);
  for (let y = 1; y < s - 1; y++) {
    for (let x = 1; x < s - 1; x++) {
      const i = y * s + x;
      const f = acc[i];
      if (f <= threshold) continue;
      const t = (f - threshold) / (1 - threshold);
      cut[i] = Math.pow(t, power) * depth * (0.55 + tributary * 0.45);
    }
  }
  // spread cuts slightly to banks
  const spread = new Float32Array(s * s);
  const r = 1 + Math.round(bankSoftness * 2);
  for (let y = r; y < s - r; y++) {
    for (let x = r; x < s - r; x++) {
      let sum = 0, n = 0;
      for (let by = -r; by <= r; by++) {
        for (let bx = -r; bx <= r; bx++) {
          sum += cut[(y + by) * s + (x + bx)]; n++;
        }
      }
      spread[y * s + x] = sum / n;
    }
  }
  for (let i = 0; i < d.length; i++) {
    const amount = cut[i] * (1 - bankSoftness * 0.6) + spread[i] * bankSoftness * 0.9;
    d[i] -= amount;
    // alluvial bank — a little material beside the channel
    if (amount > 0 && spread[i] > 0 && cut[i] < spread[i] * 0.7) {
      d[i] += (spread[i] - cut[i]) * 0.22 * bankSoftness;
    }
  }
  return { flow: acc };
}

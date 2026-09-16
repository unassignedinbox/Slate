// Live GPU sea diagnostics: proves the FFT field is alive and physical.
// Reads back center rects of the displacement textures and reports Hs,
// per-cascade variance, NaN counts, and whether sim time is advancing.
import * as THREE from 'three';
import { halfToFloat } from './probes.js';

export class Diagnostics {
  constructor(renderer, field, shared) {
    this.renderer = renderer;
    this.field = field;
    this.shared = shared;
    this.S = 64;
    const n = this.S * this.S * 4;
    this.bufF = new Float32Array(n);
    this.bufU = new Uint16Array(n);
    this.lastT = -1;
  }

  sample(modelHs = 0) {
    const { renderer, field } = this;
    const per = [];
    let totalVar = 0;
    let nan = 0;
    for (let c = 0; c < 3; c++) {
      const rt = field.cascades[c].rtDisp;
      const N = field.N;
      const s = Math.min(this.S, N);
      const x0 = Math.floor((N - s) / 2);
      const y0 = Math.floor((N - s) / 2);
      const isFloat = rt.texture.type === THREE.FloatType;
      const buf = isFloat ? this.bufF : this.bufU;
      renderer.readRenderTargetPixels(rt, x0, y0, s, s, buf);
      let mean = 0, m2 = 0, n = 0, mn = Infinity, mx = -Infinity;
      for (let i = 0; i < s * s; i++) {
        const v = isFloat ? buf[i * 4 + 1] : halfToFloat(buf[i * 4 + 1]);
        if (!Number.isFinite(v)) { nan++; continue; }
        n++;
        const d = v - mean;
        mean += d / n;
        m2 += d * (v - mean);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const variance = n > 1 ? m2 / (n - 1) : 0;
      totalVar += variance;
      per.push({ mean, var: variance, min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx });
    }
    const Hs = 4 * Math.sqrt(Math.max(totalVar, 0));
    const t = this.shared.uTime.value;
    const timeFrozen = t === this.lastT;
    this.lastT = t;
    let verdict = 'OK';
    if (nan > 0) verdict = 'BROKEN-NaN';
    else if (Hs < 0.02) verdict = 'FLAT';
    else if (modelHs > 0 && (Hs < modelHs * 0.3 || Hs > modelHs * 3)) verdict = 'SUSPECT';
    return { t, Hs, modelHs, per, nan, verdict, timeFrozen };
  }
}

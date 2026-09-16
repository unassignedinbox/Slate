// Wave probes (true GPU height readback + stats) and adaptive canceller tuning.
import * as THREE from 'three';
import { depthAt, shoalingGain } from './bathymetry.js';
import { analyticHeightJS, SRC_CANCEL } from './sources.js';

const PROBE_COLORS = { A: 0x46d6c4, B: 0xffb454, sensor: 0xff5f8f };
const HIST_MAX = 1024;

// IEEE 754 half -> float (for half-float displacement readback fallback).
export function halfToFloat(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

export class ProbeManager {
  constructor(renderer, field, shared, scene, sources, getBathy) {
    this.renderer = renderer;
    this.field = field;
    this.shared = shared;
    this.scene = scene;
    this.sources = sources;
    this.getBathy = getBathy;
    this.probes = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bufF = new Float32Array(4);
    this.bufU = new Uint16Array(4);
    this.frame = 0;
    this.poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 7, 6);
    this.ballGeo = new THREE.SphereGeometry(0.55, 14, 12);
    this.ringGeo = new THREE.TorusGeometry(1.6, 0.09, 8, 32);
  }

  makeMesh(kind) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: PROBE_COLORS[kind] ?? 0xffffff, roughness: 0.4, metalness: 0.1,
      emissive: PROBE_COLORS[kind] ?? 0xffffff, emissiveIntensity: 0.35,
    });
    const pole = new THREE.Mesh(this.poleGeo, mat);
    pole.position.y = 2.5;
    const ball = new THREE.Mesh(this.ballGeo, mat);
    ball.position.y = 6.2;
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    g.add(pole, ball, ring);
    if (kind === 'sensor') g.scale.setScalar(0.7);
    this.group.add(g);
    return g;
  }

  placeProbe(x, z) {
    // alternate A / B slots
    let p = this.probes.find((q) => q.kind === 'A' || q.kind === 'B');
    const kinds = this.probes.filter((q) => q.kind === 'A' || q.kind === 'B');
    if (kinds.length < 2) {
      const kind = kinds.some((q) => q.kind === 'A') ? 'B' : 'A';
      p = { kind, x, z, t: new Float32Array(HIST_MAX), h: new Float32Array(HIST_MAX), n: 0, mesh: this.makeMesh(kind) };
      this.probes.push(p);
    } else {
      // overwrite the oldest
      kinds.sort((a, b) => a.seq - b.seq);
      p = kinds[0];
    }
    p.x = x; p.z = z; p.n = 0; p.seq = this.frame;
    p.mesh.position.set(x, 0, z);
    return p;
  }

  ensureSensor(x, z) {
    let p = this.probes.find((q) => q.kind === 'sensor');
    if (!p) {
      p = { kind: 'sensor', x, z, t: new Float32Array(HIST_MAX), h: new Float32Array(HIST_MAX), n: 0, mesh: this.makeMesh('sensor') };
      this.probes.push(p);
    }
    p.x = x; p.z = z; p.n = 0;
    p.mesh.position.set(x, 0, z);
    return p;
  }

  removeSensor() {
    const i = this.probes.findIndex((q) => q.kind === 'sensor');
    if (i >= 0) {
      this.group.remove(this.probes[i].mesh);
      this.probes.splice(i, 1);
    }
  }

  clearUserProbes() {
    for (const p of this.probes) {
      if (p.kind !== 'sensor') this.group.remove(p.mesh);
    }
    this.probes = this.probes.filter((p) => p.kind === 'sensor');
  }

  // Read one displacement texel (handles float or half-float targets).
  readDispY(cascade, L, N, x, z) {
    const fx = ((((x / L + 0.5) % 1) + 1) % 1) * N;
    const fz = ((((z / L + 0.5) % 1) + 1) % 1) * N;
    const ix = Math.min(N - 1, Math.max(0, Math.floor(fx)));
    const iy = Math.min(N - 1, Math.max(0, Math.floor(fz)));
    const rt = cascade.rtDisp;
    if (rt.texture.type === THREE.FloatType) {
      this.renderer.readRenderTargetPixels(rt, ix, iy, 1, 1, this.bufF);
      return this.bufF[1];
    }
    this.renderer.readRenderTargetPixels(rt, ix, iy, 1, 1, this.bufU);
    return halfToFloat(this.bufU[1]);
  }

  // True rendered height: GPU FFT sum + analytic, shoaled + capped like the vertex shader.
  readHeight(x, z, t) {
    const field = this.field;
    let dy = 0;
    for (let c = 0; c < 3; c++) dy += this.readDispY(field.cascades[c], field.tiles[c], field.N, x, z);
    const h0 = dy + analyticHeightJS(this.sources.sources, x, z, t);
    const P = this.getBathy();
    const D = depthAt(x, z, P);
    const Ks = shoalingGain(this.shared.uPeakK.value, D);
    let y = h0 * Ks;
    if (D < 60) y = Math.min(y, 0.62 * Math.max(D, 0) + 0.35);
    return { y, depth: D };
  }

  pushSample(p, t, h) {
    if (p.n < HIST_MAX) {
      p.t[p.n] = t; p.h[p.n] = h; p.n++;
    } else {
      p.t.copyWithin(0, 1); p.h.copyWithin(0, 1);
      p.t[HIST_MAX - 1] = t; p.h[HIST_MAX - 1] = h;
    }
    p.lastH = h;
  }

  update(t) {
    this.frame++;
    // stagger: probes at ~20Hz, buoy swell offsets at ~6Hz
    const sampler = [];
    for (const p of this.probes) {
      const slot = p.kind === 'sensor' ? 0 : p.kind === 'A' ? 1 : 2;
      if ((this.frame + slot) % 3 === 0) sampler.push({ type: 'probe', p });
    }
    const srcs = this.sources.sources;
    for (let i = 0; i < srcs.length; i++) {
      if ((this.frame + i * 5) % 15 === 0) sampler.push({ type: 'buoy', s: srcs[i] });
    }
    for (const job of sampler.slice(0, 3)) {
      if (job.type === 'probe') {
        const { y } = this.readHeight(job.p.x, job.p.z, t);
        this.pushSample(job.p, t, y);
      } else {
        // FFT-only offset for buoy riding (analytic part handled on CPU)
        const field = this.field;
        let dy = 0;
        for (let c = 0; c < 3; c++) dy += this.readDispY(field.cascades[c], field.tiles[c], field.N, job.s.x, job.s.z);
        const D = depthAt(job.s.x, job.s.z, this.getBathy());
        job.s.gpuTarget = dy * shoalingGain(this.shared.uPeakK.value, D);
      }
    }
    // bob meshes
    for (const p of this.probes) {
      if (p.lastH !== undefined) {
        p.mesh.position.y += ((p.lastH) - p.mesh.position.y) * 0.25;
      }
    }
  }

  stats(kind, windowS = 30) {
    const p = this.probes.find((q) => q.kind === kind);
    if (!p || p.n < 16) return null;
    const tEnd = p.t[p.n - 1];
    let i0 = 0;
    while (i0 < p.n && tEnd - p.t[i0] > windowS) i0++;
    const n = p.n - i0;
    if (n < 16) return null;
    let mean = 0;
    for (let i = i0; i < p.n; i++) mean += p.h[i];
    mean /= n;
    let v = 0;
    for (let i = i0; i < p.n; i++) v += (p.h[i] - mean) * (p.h[i] - mean);
    v /= n;
    const sigma = Math.sqrt(v);
    // peak period from up-crossings
    const cross = [];
    for (let i = i0 + 1; i < p.n; i++) {
      if (p.h[i - 1] < mean && p.h[i] >= mean) {
        const f = (mean - p.h[i - 1]) / ((p.h[i] - p.h[i - 1]) || 1e-9);
        cross.push(p.t[i - 1] + f * (p.t[i] - p.t[i - 1]));
      }
    }
    let Tp = 0;
    if (cross.length >= 3) {
      let sum = 0;
      for (let i = 1; i < cross.length; i++) sum += cross[i] - cross[i - 1];
      Tp = sum / (cross.length - 1);
    }
    return { mean, rms: sigma, Hs: 4 * sigma, Tp, n, probe: p };
  }

  cancelMeter(windowS = 30) {
    const A = this.stats('A', windowS);
    const B = this.stats('B', windowS);
    if (!A || !B || A.rms < 1e-4) return null;
    const ratio = B.rms / A.rms;
    return { ratio, dB: -20 * Math.log10(Math.max(ratio, 1e-4)), pct: (1 - ratio) * 100, A, B };
  }
}

// Adaptive feedforward canceller: sense -> fit (A,B) at swell omega -> emit anti-phase.
// Closed on the residual (measured minus our own known emission), with forgetting,
// exactly like an adaptive active-noise-control loop.
export class CancellerTuner {
  constructor(probes, sources) {
    this.probes = probes;
    this.sources = sources;
    this.source = null;
    this.sensor = null;
    this.enabled = true;
    this.gain = 1.0;
    this.omega = 0.5;
    this.k = 0.02;
    this.sensS = 0;   // along-beam distance buoy -> sensor
    this.G = 1;       // gate*beam*decay at sensor
    this.reset();
  }

  reset() {
    this.Sss = 1e-6; this.Scc = 1e-6; this.Ssc = 0; this.Ssy = 0; this.Scy = 0;
    this.At = 0; this.Bt = 0;   // target fit
    this.Aa = 0; this.Ba = 0;   // applied (smoothed) fit
    this.collect = 0;
    this.ramp = 0;
    this.status = 'idle';
  }

  place(x, z, dom, opts = {}) {
    this.clear();
    const lambda = (2 * Math.PI) / dom.k;
    this.omega = dom.omega;
    this.k = dom.k;
    const beamW = (opts.beamWaves ?? 3) * lambda;
    const decay = (opts.decayWaves ?? 8) * lambda;
    this.source = this.sources.addSource({
      type: SRC_CANCEL, x, z, amp: 0, lambda,
      dirX: dom.dirX, dirZ: dom.dirZ, phase: 0,
      beam: beamW, decay, on: true, buoy: true,
    });
    if (!this.source) return null;
    this.sensS = 0.75 * lambda;
    const sx = x + dom.dirX * this.sensS;
    const sz = z + dom.dirZ * this.sensS;
    this.sensor = this.probes.ensureSensor(sx, sz);
    const g = 0.75;
    const gate = g * g * (3 - 2 * g);
    this.G = gate * 1.0 * Math.exp(-this.sensS / decay);
    this.reset();
    this.status = 'sensing…';
    return this.source;
  }

  clear() {
    if (this.source) this.sources.removeSource(this.source.id);
    this.source = null;
    this.sensor = null;
    this.probes.removeSensor();
    this.status = 'idle';
  }

  retune() {
    if (!this.source) return;
    this.reset();
    this.status = 'sensing…';
  }

  update(t, dt) {
    if (!this.source || !this.sensor || !this.enabled) return;
    const p = this.sensor;
    if (p.n < 2) return;
    const tS = p.t[p.n - 1];
    const hS = p.h[p.n - 1];
    // our own current emission at the sensor (exact formula the GPU renders)
    const ampA = Math.hypot(this.Aa, this.Ba) / Math.max(this.G, 1e-6);
    const psiA = Math.atan2(-this.Ba, this.Aa);
    const emit = ampA * Math.sin(this.k * this.sensS - this.omega * tS + (psiA - this.k * this.sensS)) * this.G;
    const resid = hS - emit;
    // forgetting least squares at omega
    const lam = 0.9985;
    const s = Math.sin(this.omega * tS), c = Math.cos(this.omega * tS);
    this.Sss = lam * this.Sss + s * s;
    this.Scc = lam * this.Scc + c * c;
    this.Ssc = lam * this.Ssc + s * c;
    this.Ssy = lam * this.Ssy + s * resid;
    this.Scy = lam * this.Scy + c * resid;
    const det = this.Sss * this.Scc - this.Ssc * this.Ssc;
    if (Math.abs(det) > 1e-9) {
      this.At = (this.Ssy * this.Scc - this.Scy * this.Ssc) / det;
      this.Bt = (this.Sss * this.Scy - this.Ssc * this.Ssy) / det;
    }
    // collect ~1.5 periods, then ramp the loop gain in
    const Tp = (2 * Math.PI) / this.omega;
    this.collect += dt;
    if (this.status === 'sensing…' && this.collect > 1.5 * Tp) this.status = 'cancelling';
    const target = this.status === 'cancelling' ? this.gain : 0;
    this.ramp += (target - this.ramp) * Math.min(1, dt / Math.max(Tp * 0.5, 0.5));
    this.Aa += (this.At * this.ramp - this.Aa) * Math.min(1, dt * 1.5);
    this.Ba += (this.Bt * this.ramp - this.Ba) * Math.min(1, dt * 1.5);
    const amp = Math.hypot(this.Aa, this.Ba) / Math.max(this.G, 1e-6);
    const psi = Math.atan2(-this.Ba, this.Aa);
    this.source.amp = amp;
    this.source.phase = psi - this.k * this.sensS;
    this.sources.pushUniforms();
  }
}

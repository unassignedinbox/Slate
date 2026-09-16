// Analytic wave sources: point emitters, plane trains, canceller beams + buoys.
import * as THREE from 'three';

export const SRC_POINT = 0;
export const SRC_PLANE = 1;
export const SRC_CANCEL = 2;

// JS mirror of ANALYTIC_GLSL (for probes, buoys, cancellation tuning).
export function analyticHeightJS(sources, x, z, t) {
  let h = 0;
  for (const s of sources) {
    if (!s.on || Math.abs(s.amp) < 1e-9) continue;
    const lambda = Math.max(s.lambda, 0.5);
    const k = (2 * Math.PI) / lambda;
    const om = Math.sqrt(9.81 * k);
    const rx = x - s.x, rz = z - s.z;
    if (s.type === SRC_POINT) {
      const r = Math.hypot(rx, rz);
      const env = Math.exp(-r / Math.max(s.decay, 1)) * smoothstepJS(0, 0.5 * lambda, r);
      h += s.amp * Math.sin(k * r - om * t + s.phase) * env;
    } else {
      const n = Math.hypot(s.dirX, s.dirZ) || 1;
      const dx = s.dirX / n, dz = s.dirZ / n;
      const sp = rx * dx + rz * dz;
      const perp = rx * -dz + rz * dx;
      const wdt = Math.max(s.beam, 1);
      const beam = Math.exp(-(perp * perp) / (wdt * wdt));
      const gate = smoothstepJS(0, lambda, sp) * Math.exp(-Math.max(sp, 0) / Math.max(s.decay, 10));
      h += s.amp * Math.sin(k * sp - om * t + s.phase) * beam * gate;
    }
  }
  return h;
}

function smoothstepJS(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

let nextId = 1;

export class SourceManager {
  constructor(scene, shared) {
    this.scene = scene;
    this.shared = shared;
    this.sources = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buoyGeoBase = new THREE.CylinderGeometry(0.9, 1.2, 1.6, 12);
    this.buoyGeoTop = new THREE.SphereGeometry(0.55, 12, 10);
    this.buoyGeoMast = new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6);
    this.matCanceller = new THREE.MeshStandardMaterial({ color: 0xff5533, roughness: 0.5, metalness: 0.2 });
    this.matPoint = new THREE.MeshStandardMaterial({ color: 0x33bbff, roughness: 0.5, metalness: 0.2 });
    this.matPlane = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.5, metalness: 0.2 });
    this.matDark = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.7 });
  }

  addSource(o) {
    if (this.sources.length >= 8) return null;
    const s = {
      id: nextId++,
      type: o.type ?? SRC_POINT,
      x: o.x ?? 0, z: o.z ?? 0,
      amp: o.amp ?? 0.5,
      lambda: o.lambda ?? 40,
      dirX: o.dirX ?? 1, dirZ: o.dirZ ?? 0,
      phase: o.phase ?? 0,
      beam: o.beam ?? 60,
      decay: o.decay ?? 300,
      on: o.on ?? true,
      buoy: o.buoy ?? true,
      gpuOffset: 0, // low-frequency FFT swell offset from readback
      gpuTarget: 0,
    };
    s.mesh = s.buoy ? this.makeBuoy(s) : null;
    this.sources.push(s);
    this.pushUniforms();
    return s;
  }

  removeSource(id) {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [s] = this.sources.splice(i, 1);
    if (s.mesh) this.group.remove(s.mesh);
    this.pushUniforms();
  }

  clear() {
    for (const s of this.sources) if (s.mesh) this.group.remove(s.mesh);
    this.sources = [];
    this.pushUniforms();
  }

  makeBuoy(s) {
    const g = new THREE.Group();
    const mat = s.type === SRC_CANCEL ? this.matCanceller : s.type === SRC_PLANE ? this.matPlane : this.matPoint;
    const base = new THREE.Mesh(this.buoyGeoBase, mat);
    base.position.y = 0.4;
    const top = new THREE.Mesh(this.buoyGeoTop, mat);
    top.position.y = 1.4;
    const mast = new THREE.Mesh(this.buoyGeoMast, this.matDark);
    mast.position.y = 2.4;
    g.add(base, top, mast);
    g.position.set(s.x, 0, s.z);
    const sc = s.type === SRC_CANCEL ? 1.6 : 1.0;
    g.scale.setScalar(sc);
    this.group.add(g);
    return g;
  }

  pushUniforms() {
    const S = this.shared;
    S.uSrcCount.value = this.sources.length;
    for (let i = 0; i < 8; i++) {
      const s = this.sources[i];
      if (s && s.on) {
        S.uSrcA.value[i].set(s.x, s.z, s.type, s.amp);
        S.uSrcB.value[i].set(s.dirX, s.dirZ, s.lambda, s.phase);
        S.uSrcC.value[i].set(s.beam, s.decay, 0, 0);
      } else {
        S.uSrcA.value[i].set(0, 0, 0, 0);
        S.uSrcB.value[i].set(1, 0, 40, 0);
        S.uSrcC.value[i].set(60, 300, 0, 0);
      }
    }
  }

  // Buoys ride analytic waves exactly + smoothed GPU swell offset.
  updateBuoys(t) {
    for (const s of this.sources) {
      if (!s.mesh) continue;
      s.gpuOffset += (s.gpuTarget - s.gpuOffset) * 0.06;
      const h = analyticHeightJS([s], s.x, s.z, t);
      s.mesh.position.y = h + s.gpuOffset;
      const e = 1.5;
      const hx = analyticHeightJS([s], s.x + e, s.z, t) - analyticHeightJS([s], s.x - e, s.z, t);
      const hz = analyticHeightJS([s], s.x, s.z + e, t) - analyticHeightJS([s], s.x, s.z - e, t);
      s.mesh.rotation.x = Math.atan(hz / (2 * e)) * 0.8;
      s.mesh.rotation.z = -Math.atan(hx / (2 * e)) * 0.8;
    }
  }
}

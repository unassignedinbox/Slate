// Camera rig: free fly camera, a chase camera that follows a vehicle or air unit, and an
// auto "director" that cuts between the most interesting targets. Any manual input switches to free.
import * as THREE from 'three';

export const MODES = ['free', 'follow', 'director'];

export class CameraRig {
  constructor(view, sim) {
    this.view = view;
    this.sim = sim;
    this.mode = 'director';
    this.target = null;       // Vehicle or air unit
    this.cutT = 0;
    this.smooth = new THREE.Vector3();
    this.lookSmooth = new THREE.Vector3();
    this.initialised = false;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    if (mode !== 'free' && !this.target) this.target = this.pickTarget(true);
    this.mode = mode;
    if (mode !== 'free') this.initialised = false;
    this.view.controls.flyTo = null;
    this.syncSelection();
  }

  // Candidate targets: racers, police and air units.
  candidates() {
    const out = [];
    for (const r of this.sim.race.racers) if (r.alive) out.push(r);
    for (const v of this.sim.vehicles) if (v.alive && v.kind === 'police' && !v.parked) out.push(v);
    for (const u of this.sim.air.units) if (u.alive) out.push(u);
    return out;
  }

  pickTarget(preferHot = false) {
    const list = this.candidates();
    if (!list.length) return null;
    if (preferHot) {
      const hot = list.filter(x => x.wanted >= 10 || x.kind === 'heli');
      if (hot.length) return hot.reduce((a, b) => ((a.wanted || 0) >= (b.wanted || 0) ? a : b));
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  cycle(step = 1) {
    const list = this.candidates();
    if (!list.length) return;
    const i = Math.max(0, list.indexOf(this.target));
    this.target = list[(i + step + list.length) % list.length];
    this.initialised = false;
    this.mode = this.mode === 'free' ? 'follow' : this.mode;
    this.syncSelection();
  }

  syncSelection() {
    const t = this.target;
    this.view.selectedId = t && t.e !== undefined && this.mode !== 'free' ? t.id : null;
  }

  update(dt) {
    const c = this.view.camera;
    // Manual input hands control back to the free camera.
    const ctl = this.view.controls;
    if (this.mode !== 'free' && (ctl.keys.size > 0 || ctl.mode)) { this.mode = 'free'; this.view.selectedId = null; }

    if (this.mode === 'free') {
      ctl.update(dt);
      this.view.selectedId = null;
      return;
    }
    if (this.mode === 'director') {
      this.cutT -= dt;
      const dead = !this.target || !this.target.alive;
      if (dead || this.cutT <= 0) {
        const pick = this.pickTarget(true);
        if (pick && pick !== this.target) { this.target = pick; this.initialised = false; }
        this.cutT = 9 + Math.random() * 4;
        this.syncSelection();
      }
    } else if (!this.target || !this.target.alive) {
      this.target = this.pickTarget(true);
      this.initialised = false;
      this.syncSelection();
    }
    const t = this.target;
    if (!t) { ctl.update(dt); return; }

    const isAir = t.e === undefined;
    const hx = t.hx ?? 1, hz = t.hz ?? 0;
    const hl = Math.hypot(hx, hz) || 1;
    const fx = hx / hl, fz = hz / hl;
    let desired, look;
    if (isAir && t.kind === 'heli') {
      // Side-on view of the helicopter, hanging back from it.
      desired = new THREE.Vector3(t.x - fx * 70 + fz * 60, t.y + 26, t.z - fz * 70 - fx * 60);
      look = new THREE.Vector3(t.x, t.y - 4, t.z);
    } else if (isAir) {
      desired = new THREE.Vector3(t.x - fx * 18, t.y + 8, t.z - fz * 18);
      look = new THREE.Vector3(t.x, t.y, t.z);
    } else {
      const speed = t.v || 0;
      const dist = 16 + Math.min(16, speed * 0.4);
      desired = new THREE.Vector3(t.x - fx * dist, t.y + 7 + Math.min(4, speed * 0.06), t.z - fz * dist);
      look = new THREE.Vector3(t.x + fx * 6, t.y + 1.2, t.z + fz * 6);
    }
    if (desired.y < 2.5) desired.y = 2.5;
    if (!this.initialised) { this.smooth.copy(desired); this.lookSmooth.copy(look); this.initialised = true; }
    const k = 1 - Math.exp(-dt * (this.mode === 'director' ? 2.6 : 5));
    this.smooth.lerp(desired, k);
    this.lookSmooth.lerp(look, k);
    c.position.copy(this.smooth);
    c.lookAt(this.lookSmooth);
    // keep the controller's yaw/pitch roughly consistent for when the user returns to free mode
    const d = new THREE.Vector3(); c.getWorldDirection(d);
    ctl.yaw = Math.atan2(-d.x, -d.z); ctl.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }

  label() {
    const t = this.target;
    if (this.mode === 'free') return 'FREE CAMERA';
    if (!t) return this.mode.toUpperCase();
    return `${this.mode.toUpperCase()} · ${t.kind === 'heli' ? 'HELICOPTER' : t.kind === 'recon' || t.kind === 'intercept' ? 'DRONE' : (t.name || t.kind).toUpperCase()}`;
  }
}

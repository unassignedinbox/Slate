// Draws the level: every body is one instance of a single BatchedMesh (one
// multi-draw for ~2000 independently moving fragments), plus the designer
// overlay (racing line, distance ticks, respawns, labels).
import * as THREE from 'three';

const ONE = new THREE.Vector3(1, 1, 1);
const SURF_COL = {
  road: 0xe8e2c8, kicker: 0xff9a6a, roof: 0x9fc4e8, pitched: 0x8fb0ff, floor: 0xe0b878,
  bridge: 0xa8d8a0, plaza: 0xc8a8e8, nave: 0xe8c890, air: 0xff7050,
};

export class LevelView {
  constructor(level, material) {
    this.level = level;
    const bodies = level.world.bodies.filter((b) => b.geometry);
    let v = 0, i = 0;
    for (const b of bodies) { v += b.geometry.attributes.position.count; i += b.geometry.index.count; }
    this.mesh = new THREE.BatchedMesh(bodies.length + 16, v + 64, i + 256, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.sortObjects = false;
    for (const b of bodies) {
      const gid = this.mesh.addGeometry(b.geometry);
      b.instanceId = this.mesh.addInstance(gid);
      b._vis = true;
    }
    this.bodies = bodies;
    this._m = new THREE.Matrix4();
  }

  update(world) {
    const m = this._m, mesh = this.mesh;
    for (const b of this.bodies) {
      if (!b.visible) {
        if (b._vis) { mesh.setVisibleAt(b.instanceId, false); b._vis = false; }
        continue;
      }
      if (!b._vis) { mesh.setVisibleAt(b.instanceId, true); b._vis = true; }
      world.ensure(b);
      m.compose(b.pos, b.quat, ONE);
      mesh.setMatrixAt(b.instanceId, m);
    }
  }
}

/** Designer overlay: racing line coloured by surface, 50 m ticks, respawns. */
export function buildOverlay(level) {
  const group = new THREE.Group();
  group.renderOrder = 10;
  for (const sec of level.sections) {
    const R = sec.route;
    const pos = [], col = [];
    const c = new THREE.Color();
    for (let s = 0; s <= R.length; s += 1) {
      const f = R.at(s);
      pos.push(f.p.x, f.p.y + 0.35, f.p.z);
      c.setHex(SURF_COL[f.surface] ?? 0xffffff);
      col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false }));
    line.renderOrder = 10;
    line.userData.xray = true;
    group.add(line);
    // ticks every 50 m (taller each 100 m), beat gates
    const tp = [];
    for (let s = 0; s <= R.length; s += 50) {
      const f = R.at(s);
      const h = s % 100 === 0 ? 3 : 1.5;
      tp.push(f.p.x, f.p.y + 0.3, f.p.z, f.p.x, f.p.y + 0.3 + h, f.p.z);
    }
    for (const b of R.beats) {
      const f = R.at(b.s0);
      const hw = (f.width || 14) / 2 + 1;
      const a = f.p.clone().addScaledVector(f.r, -hw), bb = f.p.clone().addScaledVector(f.r, hw);
      tp.push(a.x, a.y + 0.2, a.z, a.x, a.y + 6, a.z, bb.x, bb.y + 0.2, bb.z, bb.x, bb.y + 6, bb.z, a.x, a.y + 6, a.z, bb.x, bb.y + 6, bb.z);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    const ticks = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xfff4c8, transparent: true, opacity: 0.7, depthTest: true }));
    ticks.renderOrder = 10;
    ticks.userData.xray = true;
    group.add(ticks);
    // respawn markers: small diamonds
    const rp = [];
    for (const r of sec.ctx.respawns) {
      const p = r.pos;
      const d = 0.8;
      const pts = [[0, d, 0], [d, 0, 0], [0, -d, 0], [-d, 0, 0]];
      for (let k = 0; k < 4; k++) {
        const A = pts[k], B = pts[(k + 1) % 4];
        rp.push(p.x + A[0], p.y + 1.6 + A[1], p.z + A[2], p.x + B[0], p.y + 1.6 + B[1], p.z + B[2]);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    const rm = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fe0b0, transparent: true, opacity: 0.8, depthTest: false }));
    rm.renderOrder = 10;
    rm.userData.xray = true;
    group.add(rm);
  }
  return group;
}

/** World-anchored HTML labels (crisp text, no textures). */
export class Labels {
  constructor(container, labels, routeTicks) {
    this.items = [];
    this.el = document.createElement('div');
    this.el.className = 'labels';
    container.appendChild(this.el);
    for (const L of labels) this.add(L.text, L.pos, L.kind, L.beat);
    for (const t of routeTicks || []) this.add(t.text, t.pos, 'tick', null);
    this.visible = true;
    this._v = new THREE.Vector3();
  }
  add(text, pos, kind, beat = null) {
    const d = document.createElement('div');
    d.className = `label label-${kind}`;
    d.textContent = text;
    this.el.appendChild(d);
    this.items.push({ d, pos: pos.clone(), kind, beat, on: true });
  }
  setVisible(v) { this.visible = v; this.el.style.display = v ? '' : 'none'; }
  /** wide: designer cameras (everything); otherwise only labels of the given beats. */
  update(camera, w, h, wide = false, beats = null) {
    if (!this.visible) return;
    const v = this._v;
    const k = wide ? 4 : 1;
    for (const it of this.items) {
      v.copy(it.pos).applyMatrix4(camera.matrixWorldInverse);
      const dist = -v.z;
      const maxD = (it.kind === 'tick' ? 120 : it.kind === 'portal' ? 450 : it.kind === 'note' ? 160 : 300) * k;
      const relevant = wide || !beats || it.kind === 'portal' || (it.kind !== 'tick' && beats.includes(it.beat));
      const show = relevant && dist > 2 && dist < maxD;
      if (!show) { if (it.on) { it.d.style.display = 'none'; it.on = false; } continue; }
      v.applyMatrix4(camera.projectionMatrix);
      if (Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { if (it.on) { it.d.style.display = 'none'; it.on = false; } continue; }
      if (!it.on) { it.d.style.display = ''; it.on = true; }
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      it.d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      it.d.style.opacity = String(Math.max(0.25, Math.min(1, 1.4 - dist / maxD)));
    }
  }
}

/* ============================================================================
   Props — street furniture geometry + placement rules.

   Every prop is a single merged BufferGeometry drawn with InstancedMesh, so
   ten thousand bollards cost one draw call.
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';


/* ------------------------------------------------------------ geometry --- */

/** Merge mixed indexed/non-indexed primitives into one non-indexed geometry. */
function merge(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(flat, false);
  for (const g of flat) if (!parts.includes(g)) g.dispose();
  return m;
}

const box = (w, h, d, x = 0, y = 0, z = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, seg = 10, x = 0, y = 0, z = 0) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
};
const tube = (r, h, seg = 8, x = 0, y = 0, z = 0) => {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  g.translate(x, y, z);
  return g;
};

function bollardGeometry(heritage = false) {
  const parts = [];
  if (heritage) {
    parts.push(cyl(0.055, 0.075, 0.95, 12, 0, 0.475, 0));
    parts.push(cyl(0.085, 0.085, 0.06, 12, 0, 0.98, 0));
    parts.push(cyl(0.10, 0.11, 0.10, 12, 0, 0.05, 0));
    for (let i = 0; i < 3; i++) parts.push(cyl(0.062, 0.062, 0.035, 12, 0, 0.62 + i * 0.2, 0));
  } else {
    parts.push(tube(0.084, 1.0, 12, 0, 0.5, 0));
    parts.push(cyl(0.088, 0.088, 0.06, 12, 0, 1.02, 0));
    parts.push(cyl(0.092, 0.092, 0.035, 12, 0, 0.86, 0));
    parts.push(cyl(0.092, 0.092, 0.035, 12, 0, 0.78, 0));
    parts.push(cyl(0.10, 0.10, 0.03, 12, 0, 0.015, 0));
  }
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function lampGeometry(kind = 'arm') {
  const parts = [];
  const h = kind === 'wall' ? 0 : 8.0;
  const armLen = kind === 'wall' ? 0 : 1.6;
  if (kind !== 'wall') {
    parts.push(cyl(0.075, 0.13, h, 10, 0, h / 2, 0));
    parts.push(cyl(0.105, 0.105, 0.55, 10, 0, 0.275, 0));
    // arm sweeps to +X
    parts.push(box(armLen, 0.075, 0.075, armLen / 2, h - 0.1, 0));
    parts.push(cyl(0.05, 0.05, 0.28, 8, armLen, h - 0.22, 0));
  } else {
    parts.push(box(0.09, 0.09, 0.55, 0, 0, 0.28));
  }
  // luminaire
  const lx = kind === 'wall' ? 0 : armLen;
  const ly = kind === 'wall' ? 0.05 : h - 0.34;
  parts.push(box(0.72, 0.11, 0.26, lx - 0.12, ly, 0));
  parts.push(box(0.60, 0.05, 0.20, lx - 0.12, ly + 0.05, 0));
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function treeGeometry() {
  const parts = [];
  parts.push(cyl(0.14, 0.24, 3.4, 8, 0, 1.7, 0));
  // two crossed canopy shells read as a full crown from any angle
  for (let i = 0; i < 2; i++) {
    const g = new THREE.IcosahedronGeometry(2.0, 1);
    g.scale(1, 0.85, 1);
    g.translate(0, 4.3 + i * 1.0, 0);
    g.rotateY(i * 0.7);
    parts.push(g);
  }
  const m = merge(parts);
  m.computeVertexNormals();
  return m;
}

function gullyGeometry() {
  const parts = [];
  parts.push(box(0.42, 0.05, 0.30, 0, 0.025, 0));
  for (let i = 0; i < 4; i++) parts.push(box(0.36, 0.02, 0.035, 0, 0.055, -0.09 + i * 0.06));
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function catenaryMastGeometry() {
  const parts = [];
  parts.push(cyl(0.09, 0.16, 6.4, 8, 0, 3.2, 0));
  parts.push(box(2.6, 0.10, 0.10, -1.1, 6.15, 0));
  parts.push(cyl(0.045, 0.045, 0.5, 6, -2.3, 5.9, 0));
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function crossbuckGeometry() {
  const parts = [];
  parts.push(cyl(0.05, 0.05, 2.6, 8, 0, 1.3, 0));
  for (const s of [-1, 1]) {
    const g = box(1.25, 0.16, 0.05, 0.55, 2.45, 0);
    g.rotateZ(s * 0.62);
    g.translate(0, 0.0, 0);
    parts.push(g);
  }
  parts.push(box(0.05, 0.16, 0.05, 0.55, 2.45, 0));
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function boomGeometry() {
  const parts = [];
  parts.push(cyl(0.07, 0.07, 1.4, 8, 0, 0.7, 0));
  parts.push(box(0.10, 0.10, 0.10, 0, 1.45, 0));
  // half boom, red/white striped (colour via material)
  for (let i = 0; i < 6; i++) {
    parts.push(box(0.62, 0.16, 0.05, 0, 1.2, 0.42 + i * 0.62));
  }
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

function signGeometry() {
  const parts = [];
  parts.push(cyl(0.045, 0.045, 2.5, 8, 0, 1.25, 0));
  parts.push(box(0.02, 0.62, 0.62, 0.06, 2.35, 0));
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

export function buildPropGeometries() {
  const m = new Map();
  m.set('bollard', bollardGeometry(false));
  m.set('bollard_heritage', bollardGeometry(true));
  m.set('lamp', lampGeometry('arm'));
  m.set('lamp_wall', lampGeometry('wall'));
  m.set('tree', treeGeometry());
  m.set('gully', gullyGeometry());
  m.set('catenaryMast', catenaryMastGeometry());
  m.set('crossbuck', crossbuckGeometry());
  m.set('boom', boomGeometry());
  m.set('sign', signGeometry());
  return m;
}

/* ----------------------------------------------------------- placement --- */

/**
 * Place all furniture for one edge.
 * @param {PropSink} propSink
 * @param {number} detail 0 = full, 1 = reduced (skip small props)
 */
export function placeProps(edge, net, propSink, ribbon, section, ctx = {}) {
  const f = edge.featuresOf();
  const detail = ctx.detail ?? 0;
  if (detail > 0) return;

  const L = ribbon.length;
  if (L < 4) return;
  const trimStart = ctx.trimStart ?? 0;
  const trimEnd = ctx.trimEnd ?? 0;
  const s0 = trimStart + 1.0;
  const s1 = L - trimEnd - 1.0;
  if (s1 - s0 < 3) return;

  const lanes = section.lanes;
  const walk = lanes.filter((l) => l.k === 'sidewalk');
  const cycle = lanes.filter((l) => l.isCycle);
  const kerbL = section.carriageway.l0;
  const kerbR = section.carriageway.l1;

  /* ---- bollards ---- */
  const bol = f.bollards;
  if (bol && bol.on !== false) {
    const spacing = bol.spacing ?? 8;
    const off = bol.offset ?? 0.35;
    const type = f.lighting?.heritage ? 'bollard_heritage' : 'bollard';
    const targets = walk.length ? walk : (cycle.length ? cycle : []);
    for (const ln of targets) {
      const lInner = Math.abs(ln.l0) < Math.abs(ln.l1) ? ln.l1 : ln.l0;
      const l = lInner - Math.sign(lInner) * off;
      for (let s = s0 + spacing * 0.5; s < s1; s += spacing) {
        const p = ribbon.point(s, l, new THREE.Vector3());
        const fwd = ribbon.forward(s, new THREE.Vector3());
        propSink.addTRS(type, p.x, p.y, p.z, Math.atan2(fwd.x, fwd.z));
      }
    }
  }

  /* ---- lighting ---- */
  const li = f.lighting;
  if (li && li.on) {
    const spacing = li.spacing ?? 26;
    const side = li.side ?? 'right';
    const h = li.h ?? 8;
    const scale = h / 8;
    const wall = !!li.wall;
    const type = wall ? 'lamp_wall' : 'lamp';
    const sides = side === 'both' ? [-1, 1] : side === 'left' ? [-1] : [1];
    for (const sd of sides) {
      for (const ln of (walk.length ? walk : [null])) {
        let l;
        if (ln) {
          const lOuter = Math.abs(ln.l0) > Math.abs(ln.l1) ? ln.l0 : ln.l1;
          l = lOuter - Math.sign(lOuter) * 0.45;
        } else {
          l = sd > 0 ? section.l1 - 0.6 : section.l0 + 0.6;
        }
        if (sd < 0 && l > 0) continue;
        if (sd > 0 && l < 0) continue;
        for (let s = s0 + spacing * 0.5; s < s1; s += spacing) {
          const p = ribbon.point(s, l, new THREE.Vector3());
          const fwd = ribbon.forward(s, new THREE.Vector3());
          // luminaire arm points back over the carriageway
          const ry = Math.atan2(-fwd.x, -fwd.z) + (l > 0 ? Math.PI : 0);
          propSink.addTRS(type, p.x, p.y, p.z, ry, 1, scale, 1);
        }
      }
    }
  }

  /* ---- street trees ---- */
  const tr = f.trees;
  if (tr && tr.on) {
    const spacing = tr.spacing ?? 12;
    for (const ln of (walk.length ? walk : [])) {
      const l = (ln.l0 + ln.l1) / 2;
      for (let s = s0 + spacing * 0.5; s < s1; s += spacing) {
        const p = ribbon.point(s, l, new THREE.Vector3());
        const jitter = ((Math.sin(s * 12.9898 + edge.id.length) * 43758.5453) % 1) || 0;
        propSink.addTRS('tree', p.x, p.y, p.z, jitter * 6.28, 0.85 + Math.abs(jitter) * 0.4, 0.9 + Math.abs(jitter) * 0.35, 0.85 + Math.abs(jitter) * 0.4);
      }
    }
  }

  /* ---- gullies at the kerb ---- */
  if (f.gullies && walk.length) {
    for (let s = s0; s < s1; s += 22) {
      for (const l of [kerbL + 0.25, kerbR - 0.25]) {
        const p = ribbon.point(s, l, new THREE.Vector3());
        const fwd = ribbon.forward(s, new THREE.Vector3());
        propSink.addTRS('gully', p.x, p.y, p.z, Math.atan2(fwd.x, fwd.z));
      }
    }
  }

  /* ---- marker posts / verge posts on rural roads ---- */
  if (f.hedges) {
    for (let s = s0; s < s1; s += 7) {
      for (const l of [section.l0 + 0.4, section.l1 - 0.4]) {
        const p = ribbon.point(s, l, new THREE.Vector3());
        propSink.addTRS('sign', p.x, p.y, p.z, 0, 1, 0.42, 1);
      }
    }
  }
}

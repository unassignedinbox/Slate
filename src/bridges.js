// Proper bridge structures: girder, arch, cable-stayed and through-truss.
// Each returns pieces [{mat, geos}] merged into the owning segment buckets.
import * as THREE from 'three';
import { sampleAt, ribbonGeometry, wallGeometry, polylineSampleLength } from './roadbuilder.js';

function box(w, h, d, x, y, z, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Box beam spanning two world points (used for cables, truss bars, braces). */
function strut(ax, ay, az, bx, by, bz, thick = 0.12) {
  const a = new THREE.Vector3(ax, ay, az);
  const b = new THREE.Vector3(bx, by, bz);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(thick, thick, Math.max(0.2, len));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  g.applyQuaternion(q);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Concrete parapet + steel handrail along an edge offset. */
function edgeRailing(samples, x, topY, style, pieces) {
  if (style === 'none') return;
  if (style === 'concrete') {
    pieces.concrete.push(
      wallGeometry(samples, x, topY, topY + 0.95),
      ribbonGeometry(samples, x - 0.16, x + 0.16, topY + 0.95, { vScale: 0.4 })
    );
    // recessed panel line
    pieces.concreteDark.push(wallGeometry(samples, x + 0.01, topY + 0.25, topY + 0.3));
    return;
  }
  // steel: posts + three rails
  const total = polylineSampleLength(samples);
  for (let s = 1; s < total; s += 2.8) {
    const sm = sampleAt(samples, s);
    pieces.metalDark.push(box(0.09, 1.15, 0.09, sm.x + sm.nx * x, sm.y + topY + 0.57, sm.z + sm.nz * x));
  }
  for (const [dy, th] of [[1.12, 0.07], [0.78, 0.05], [0.44, 0.05]]) {
    pieces.metalDark.push(
      ribbonGeometry(samples, x - th / 2, x + th / 2, topY + dy, { vScale: 0.5 }),
      wallGeometry(samples, x - th / 2, topY + dy - th / 2, topY + dy + th / 2),
      wallGeometry(samples, x + th / 2, topY + dy - th / 2, topY + dy + th / 2)
    );
  }
}

/** Lamp column along the deck. */
function deckLamp(sm, x, y, pieces) {
  pieces.metalDark.push(box(0.3, 0.14, 0.3, sm.x + sm.nx * x, sm.y + y + 0.08, sm.z + sm.nz * x));
  pieces.metalDark.push(box(0.1, 5.6, 0.1, sm.x + sm.nx * x, sm.y + y + 2.8, sm.z + sm.nz * x));
  const armDir = -Math.sign(x) || 1;
  pieces.metalDark.push(
    box(0.09, 0.09, 1.9, sm.x + sm.nx * (x + armDir * 0.9), sm.y + y + 5.55, sm.z + sm.nz * (x + armDir * 0.9))
  );
  pieces.lampGlass.push(
    box(0.34, 0.1, 0.8, sm.x + sm.nx * (x + armDir * 1.75), sm.y + y + 5.42, sm.z + sm.nz * (x + armDir * 1.75))
  );
}

function newPieces() {
  return {
    concrete: [],
    concreteDark: [],
    pillar: [],
    metalDark: [],
    metalLight: [],
    lampGlass: [],
  };
}

/**
 * Build bridge structure pieces for a segment.
 * samples: segment samples (deck height), half: half roadway width,
 * spec: {type:'girder'|'arch'|'cable'|'truss', railing:'steel'|'concrete'|'none'}
 */
export function buildBridgePieces(samples, half, spec = {}) {
  const type = spec.type || 'girder';
  const railing = spec.railing || (type === 'truss' ? 'none' : 'steel');
  const pieces = newPieces();
  const total = polylineSampleLength(samples);
  const roadTop = 0.02;

  // ===== common: deck slab, edge beams, abutments =====
  pieces.concreteDark.push(
    ribbonGeometry(samples, -half + 0.1, half - 0.1, -0.55, { vScale: 0.08 }),
    wallGeometry(samples, -half + 0.1, -1.25, -0.55),
    wallGeometry(samples, half - 0.1, -1.25, -0.55),
    ribbonGeometry(samples, -half + 0.1, half - 0.1, -1.25, { vScale: 0.08 })
  );

  // abutment blocks at both ends
  for (const t of [0, 1]) {
    const sm = sampleAt(samples, t * total);
    const dir = t === 0 ? -1 : 1;
    const ang = Math.atan2(sm.tx, sm.tz);
    pieces.pillar.push(
      box(half * 2 + 1.2, Math.max(3, sm.y + 2.2), 3.2,
        sm.x + sm.tx * dir * 1.4, sm.y - (Math.max(3, sm.y + 2.2) / 2) + 1.15 - 0.6,
        sm.z + sm.tz * dir * 1.4, ang)
    );
    pieces.concrete.push(
      box(half * 2 + 1.6, 0.55, 3.6,
        sm.x + sm.tx * dir * 1.4, sm.y - 0.32, sm.z + sm.tz * dir * 1.4, ang)
    );
  }

  if (type === 'girder') {
    // I-girders under the deck
    const girderOffsets = [-half + 1.4, -half / 3, half / 3, half - 1.4];
    for (const gx of girderOffsets) {
      pieces.metalDark.push(
        ribbonGeometry(samples, gx - 0.22, gx + 0.22, -0.72, { vScale: 0.2 }),
        wallGeometry(samples, gx - 0.22, -1.55, -0.72),
        wallGeometry(samples, gx + 0.22, -1.55, -0.72),
        ribbonGeometry(samples, gx - 0.3, gx + 0.3, -1.55, { vScale: 0.2 })
      );
    }
    // hammerhead piers
    for (let s = 14; s < total - 10; s += 24) {
      const sm = sampleAt(samples, s);
      const h = Math.max(2.2, sm.y + 1.85);
      pieces.pillar.push(box(1.7, h, 1.35, sm.x, sm.y + 1.4 - h / 2 - 0.15, sm.z, Math.atan2(sm.tx, sm.tz)));
      pieces.pillar.push(
        box(5.4, 0.7, 1.7, sm.x, sm.y - 1.05, sm.z, Math.atan2(sm.tx, sm.tz))
      );
    }
  } else if (type === 'arch') {
    // two parabolic arch ribs + spandrel columns + cross braces
    const spanT0 = 0.12;
    const spanT1 = 0.88;
    for (const ax of [-half + 1.8, half - 1.8]) {
      const n = 22;
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = spanT0 + (spanT1 - spanT0) * (i / n);
        const s = t * total;
        const sm = sampleAt(samples, s);
        const u = (i / n) * 2 - 1; // -1..1
        const ribDrop = 7.5 * (1 - Math.sqrt(Math.max(0, 1 - u * u))) + 1.4;
        const px = sm.x + sm.nx * ax;
        const pz = sm.z + sm.nz * ax;
        const py = sm.y - ribDrop;
        if (prev) {
          pieces.concrete.push(strut(prev.x, prev.y, prev.z, px, py, pz, 1.05));
          // spandrel column up to deck
          if (i > 1 && i < n) {
            const colH = ribDrop - 1.05;
            pieces.concrete.push(box(0.85, colH, 0.85, px, sm.y - 1.05 - colH / 2, pz, Math.atan2(sm.tx, sm.tz)));
          }
        }
        prev = { x: px, y: py, z: pz };
      }
    }
    // transverse braces between ribs every 1/5 span
    for (let i = 3; i < 20; i += 4) {
      const t = spanT0 + (spanT1 - spanT0) * (i / 22);
      const sm = sampleAt(samples, t * total);
      const u = (i / 22) * 2 - 1;
      const ribDrop = 7.5 * (1 - Math.sqrt(Math.max(0, 1 - u * u))) + 1.4;
      pieces.concrete.push(
        strut(
          sm.x + sm.nx * (-half + 1.8), sm.y - ribDrop, sm.z + sm.nz * (-half + 1.8),
          sm.x + sm.nx * (half - 1.8), sm.y - ribDrop, sm.z + sm.nz * (half - 1.8),
          0.55, 'concrete'
        )
      );
    }
  } else if (type === 'cable') {
    // single central pylons with fan stays
    const pylonTs = [0.3, 0.7];
    for (const pt of pylonTs) {
      const sm = sampleAt(samples, pt * total);
      const ang = Math.atan2(sm.tx, sm.tz);
      const h = 22;
      // tapered pylon legs (two legs straddling the deck)
      for (const lx of [-1.7, 1.7]) {
        const px = sm.x + sm.nx * lx;
        const pz = sm.z + sm.nz * lx;
        pieces.pillar.push(box(1.15, h + 4, 1.15, px, sm.y + (h + 4) / 2 - 2, pz, ang));
      }
      // cross beams
      for (const cy of [6, 13, h - 1]) {
        pieces.pillar.push(
          strut(
            sm.x + sm.nx * -1.7, sm.y + cy, sm.z + sm.nz * -1.7,
            sm.x + sm.nx * 1.7, sm.y + cy, sm.z + sm.nz * 1.7,
            0.8
          )
        );
      }
      // pier below
      pieces.pillar.push(box(2.4, Math.max(3, sm.y + 2), 2.1, sm.x, sm.y + 1 - (Math.max(3, sm.y + 2) / 2) - 0.4, sm.z, ang));

      // stay cables fanning forward/back to deck edges
      for (const dir of [-1, 1]) {
        for (let k = 1; k <= 6; k++) {
          const s2 = (pt + dir * k * 0.055) * total;
          if (s2 < 2 || s2 > total - 2) continue;
          const d2 = sampleAt(samples, s2);
          for (const ex of [-half + 0.7, half - 0.7]) {
            pieces.metalLight.push(strut(
              sm.x + sm.nx * 0, sm.y + h - 1.5 - k * 0.4, sm.z + sm.nz * 0,
              d2.x + d2.nx * ex, d2.y + 0.15, d2.z + d2.nz * ex,
              0.16
            ));
          }
        }
      }
    }
  } else if (type === 'truss') {
    // through-truss: side trusses + top bracing
    for (const sx of [-half + 0.55, half - 0.55]) {
      const bays = Math.max(4, Math.round(total / 5.5));
      let prev = null;
      for (let i = 0; i <= bays; i++) {
        const s = (i / bays) * total;
        const sm = sampleAt(samples, s);
        const px = sm.x + sm.nx * sx;
        const pz = sm.z + sm.nz * sx;
        const yTop = sm.y + 5.2;
        // vertical
        pieces.metalDark.push(strut(px, sm.y + 0.1, pz, px, yTop, pz, 0.18));
        if (prev) {
          // top chord
          pieces.metalDark.push(strut(prev.x, prev.yTop, prev.z, px, yTop, pz, 0.22));
          // bottom chord
          pieces.metalDark.push(strut(prev.x, prev.yBot, prev.z, px, sm.y + 0.1, pz, 0.2));
          // diagonal (Warren)
          const up = i % 2 === 0;
          pieces.metalDark.push(
            up
              ? strut(prev.x, prev.yBot, prev.z, px, yTop, pz, 0.16)
              : strut(prev.x, prev.yTop, prev.z, px, sm.y + 0.1, pz, 0.16)
          );
        }
        prev = { x: px, yTop, yBot: sm.y + 0.1, z: pz };
      }
    }
    // top lateral bracing
    const bays = Math.max(4, Math.round(total / 5.5));
    for (let i = 1; i < bays; i += 2) {
      const s = (i / bays) * total;
      const sm = sampleAt(samples, s);
      pieces.metalDark.push(
        strut(
          sm.x + sm.nx * (-half + 0.55), sm.y + 5.1, sm.z + sm.nz * (-half + 0.55),
          sm.x + sm.nx * (half - 0.55), sm.y + 5.1, sm.z + sm.nz * (half - 0.55),
          0.13
        )
      );
    }
  }

  // ===== railings =====
  if (type !== 'truss') {
    for (const side of [-1, 1]) {
      edgeRailing(samples, side * (half - 0.32), roadTop + 0.05, railing, pieces);
    }
  }

  // ===== deck lamps =====
  if (total > 45) {
    for (let s = 20; s < total - 12; s += 38) {
      const sm = sampleAt(samples, s);
      deckLamp(sm, half - 1.15, 0.05, pieces);
    }
  }

  return pieces;
}

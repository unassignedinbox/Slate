//============================================================================================================================================
//                                                               CARDS.JS
//============================================================================================================================================
// 📦 Mesh card generation — the same construction Lumen calls "mesh cards": every object is partitioned into
//    axis-aligned orthographic sprites over six canonical directions. A card owns an 8×8 texel window of the
//    surface-cache atlas and depth-selects the closest surface along its normal.
//
//    Bucket rule (duplication budget mirrors Lumen's secondary-card heuristic): a triangle always lands in
//    its dominant-axis bucket, and also in the second axis bucket when |n·axis2| > 0.60, so silhouettes keep
//    surface coverage from both sides. Buckets are gridded in uv at cellSize = cardTexels·texelSize, split
//    once more where a cell still overflows 48 triangles.
//
//    Direction frames MUST match shaders/common.wgsl cardN/cardT/cardB exactly.

const CARD_DIRS = [
  { n: [1, 0, 0],  t: [0, 1, 0], b: [0, 0, 1] },   // 0 +X
  { n: [-1, 0, 0], t: [0, 1, 0], b: [0, 0, -1] },  // 1 -X
  { n: [0, 1, 0],  t: [1, 0, 0], b: [0, 0, -1] },  // 2 +Y
  { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, 1] },   // 3 -Y
  { n: [0, 0, 1],  t: [1, 0, 0], b: [0, 1, 0] },   // 4 +Z
  { n: [0, 0, -1], t: [1, 0, 0], b: [0, -1, 0] },  // 5 -Z
];
export const CARD_TEXELS = 8;
export const MAX_CARDS = 16384;

function triNormal(p, t) {
  const a = t * 9, ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2];
  const vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export function buildCardsForObject(obj, firstCard) {
  const mesh = obj.mesh, texel = obj.texel;
  const p = mesh.positions;
  const cards = [];
  const triCards = new Map();            // triIndex -> [cardIndex, ...]

  // expanded positions: 9 floats per tri
  const ep = new Float32Array(mesh.family.length * 9);
  for (let t = 0; t < mesh.family.length; t++)
    for (let k = 0; k < 3; k++) {
      const vi = mesh.triangles[t * 3 + k];
      ep.set([p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]], t * 9 + k * 3);
    }

  const buckets = [[], [], [], [], [], []];
  for (let t = 0; t < mesh.family.length; t++) {
    const n = triNormal(ep, t);
    const ax = [0, 1, 2].sort((a, b) => Math.abs(n[b]) - Math.abs(n[a]));
    const prim = ax[0], d0 = prim * 2 + (n[prim] > 0 ? 0 : 1);
    buckets[d0].push(t);
    const sec = ax[1];
    if (Math.abs(n[sec]) > 0.60) {
      const d1 = sec * 2 + (n[sec] > 0 ? 0 : 1);
      buckets[d1].push(t);
    }
  }

  for (let d = 0; d < 6; d++) {
    const tris = buckets[d];
    if (tris.length === 0) continue;
    const { t: T, b: B, n: N } = CARD_DIRS[d];
    const dot = (q, v) => q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
    const cellSize = CARD_TEXELS * texel;
    const cells = new Map();             // "cu,cv,sub" -> [tri,...]
    for (const t of tris) {
      let cu = Infinity, cv = Infinity, u1 = -Infinity, v1 = -Infinity;
      let w0 = Infinity, w1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const q = [ep[t * 9 + k * 3], ep[t * 9 + k * 3 + 1], ep[t * 9 + k * 3 + 2]];
        const u = dot(q, T), v = dot(q, B), w = dot(q, N);
        cu = Math.min(cu, u); cv = Math.min(cv, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v);
        w0 = Math.min(w0, w); w1 = Math.max(w1, w);
      }
      const subdivide = (cellU0, cellV0) => {
        const key = cellU0 + "," + cellV0;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ t, w0, w1 });
      };
      const cu0 = Math.floor(cu / cellSize), cv0 = Math.floor(cv / cellSize);
      const cu1 = Math.floor(u1 / cellSize), cv1 = Math.floor(v1 / cellSize);
      for (let i = cu0; i <= cu1; i++) for (let j = cv0; j <= cv1; j++) subdivide(i, j);
    }

    // second pass: split overfull cells (one level) and emit cards
    for (const [key, list] of cells) {
      const [icu, icv] = key.split(",").map(Number);
      const emit = (list, u0, v0, cell) => {
        const h = cell / 2;
        // w range clamp: cards cover the slab they saw; thin clamp keeps depth resolution high
        let w0 = Infinity, w1 = -Infinity;
        for (const it of list) { w0 = Math.min(w0, it.w0); w1 = Math.max(w1, it.w1); }
        const wMid = (w0 + w1) / 2, wPad = Math.max((w1 - w0) / 2, texel * 0.75);
        const nDim = N[0] !== 0 ? 0 : N[1] !== 0 ? 1 : 2;
        const org = [0, 0, 0];
        org[nDim] = wMid;
        const uDim = T[0] !== 0 ? 0 : T[1] !== 0 ? 1 : 2;
        const vDim = B[0] !== 0 ? 0 : B[1] !== 0 ? 1 : 2;
        org[uDim] = u0 + h; org[vDim] = v0 + h;
        const cardIndex = firstCard + cards.length;
        cards.push({
          obj, dirIdx: d, org, halfU: h, halfV: h, wLo: wMid - wPad, wHi: wMid + wPad,
          tris: list.map(it => it.t),
        });
        for (const it of list) {
          if (!triCards.has(it.t)) triCards.set(it.t, []);
          triCards.get(it.t).push(cardIndex);
        }
      };
      if (list.length > 48 && cellSize > texel * 2.1) {
        // quadtree split once: 4 subcells
        const u0 = icu * cellSize, v0 = icv * cellSize;
        for (let su = 0; su < 2; su++) for (let sv = 0; sv < 2; sv++) {
          const sub = list.filter(it => {
            // membership by triangle centroid projection
            const t = it.t;
            const qx = (ep[t * 9] + ep[t * 9 + 3] + ep[t * 9 + 6]) / 3;
            const qy = (ep[t * 9 + 1] + ep[t * 9 + 4] + ep[t * 9 + 7]) / 3;
            const qz = (ep[t * 9 + 2] + ep[t * 9 + 5] + ep[t * 9 + 8]) / 3;
            const u = qx * T[0] + qy * T[1] + qz * T[2] - u0;
            const v = qx * B[0] + qy * B[1] + qz * B[2] - v0;
            return (su === 0 ? u < cellSize / 2 : u >= cellSize / 2) && (sv === 0 ? v < cellSize / 2 : v >= cellSize / 2);
          });
          if (sub.length) emit(sub, u0 + su * cellSize / 2, v0 + sv * cellSize / 2, cellSize / 2);
        }
      } else {
        emit(list, icu * cellSize, icv * cellSize, cellSize);
      }
    }
  }
  return { cards, triCards, expanded: ep };
}

// Builds cards for all objects and bakes the capture streams.
// Capture vertex: pos f32x3 | cardId u32 | matId u32 | nrm f32x3  (32 B), exactly sc_capture.wgsl's layout.
export function buildCardSystem(objects) {
  const allCards = [];
  const perObj = [];
  for (const obj of objects) {
    const r = buildCardsForObject(obj, allCards.length);
    allCards.push(...r.cards);
    perObj.push({ obj, cards: r.cards, triCards: r.triCards, expanded: r.expanded });
  }
  if (allCards.length > MAX_CARDS) throw new Error(`card overflow: ${allCards.length} > ${MAX_CARDS}`);

  let verts = 0;
  for (const r of perObj) for (const c of r.cards) verts += c.tris.length * 3;
  const data = new ArrayBuffer(verts * 32);
  const f32 = new Float32Array(data), u32 = new Uint32Array(data);
  let o8 = 0, spansStatic = { first: 0, count: 0 };
  const objSpans = perObj.map((r, i) => {
    const m = r.obj.mesh, start = o8 / 8;
    for (let ci = 0; ci < r.cards.length; ci++) {
      const card = r.cards[ci];
      for (const t of card.tris) {
        const mat = m.family[t];
        for (let k = 0; k < 3; k++) {
          const vi = m.triangles[t * 3 + k];
          f32[o8] = m.positions[vi * 3]; f32[o8 + 1] = m.positions[vi * 3 + 1]; f32[o8 + 2] = m.positions[vi * 3 + 2];
          u32[o8 + 3] = cardIndexOf(perObj, r) + ci;
          u32[o8 + 4] = mat;
          f32[o8 + 5] = m.normals[vi * 3]; f32[o8 + 6] = m.normals[vi * 3 + 1]; f32[o8 + 7] = m.normals[vi * 3 + 2];
          o8 += 8;
        }
      }
    }
    return { first: start, count: o8 / 8 - start, obj: r.obj };
  });
  const staticCount = objSpans.filter(s => !s.obj.dynamic).reduce((a, s) => a + s.count, 0);
  return { cards: allCards, capture: { buffer: data, vertexCount: verts, objSpans }, staticVertexCount: staticCount, perObj };
}
function cardIndexOf(perObj, r) {
  let base = 0;
  for (const q of perObj) { if (q === r) return base; base += q.cards.length; }
  return base;
}

// Packs the CardWorld frame array (org|halfU, t|halfV, b|wLo, n|wHi), transformed to world by `mat` (or identity).
export function packCardsWorld(cards, firstCard, mat = null) {
  const out = new Float32Array(cards.length * 16);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const d = CARD_DIRS[c.dirIdx];
    let org = c.org, T = d.t, B = d.b, N = d.n, hu = c.halfU, hv = c.halfV, wl = c.wLo, wh = c.wHi;
    if (mat) {
      // world frame from object frame — method of transform of point + rotation of axes
      const mp = (q) => [
        mat[0] * q[0] + mat[4] * q[1] + mat[8] * q[2] + mat[12],
        mat[1] * q[0] + mat[5] * q[1] + mat[9] * q[2] + mat[13],
        mat[2] * q[0] + mat[6] * q[1] + mat[10] * q[2] + mat[14]];
      const mr = (q) => [
        mat[0] * q[0] + mat[4] * q[1] + mat[8] * q[2],
        mat[1] * q[0] + mat[5] * q[1] + mat[9] * q[2],
        mat[2] * q[0] + mat[6] * q[1] + mat[10] * q[2]];
      org = mp(org); T = mr(T); B = mr(B); N = mr(N);
    }
    out.set([org[0], org[1], org[2], hu], i * 16);
    out.set([T[0], T[1], T[2], hv], i * 16 + 4);
    out.set([B[0], B[1], B[2], wl], i * 16 + 8);
    out.set([N[0], N[1], N[2], wh], i * 16 + 12);
  }
  return out;
}

// world-space axis-aligned bounds of a card (for tile membership). org sits at the slab centre:
// uv at the cell middle, w at the midpoint of [wLo,wHi].
export function cardWorldAABB(card, mat = null) {
  const d = CARD_DIRS[card.dirIdx];
  const halfW = (card.wHi - card.wLo) / 2;
  const localHalf = (k) => Math.abs(d.t[k]) * card.halfU + Math.abs(d.b[k]) * card.halfV + Math.abs(d.n[k]) * halfW;
  const lh = [localHalf(0), localHalf(1), localHalf(2)];
  const M = (row, col) => mat ? mat[col * 4 + row] : (row === col ? 1 : 0);
  const t = mat ? [mat[12], mat[13], mat[14]] : [0, 0, 0];
  const c = [0, 0, 0], e = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    c[a] = t[a] + M(a, 0) * card.org[0] + M(a, 1) * card.org[1] + M(a, 2) * card.org[2];
    e[a] = Math.abs(M(a, 0)) * lh[0] + Math.abs(M(a, 1)) * lh[1] + Math.abs(M(a, 2)) * lh[2];
  }
  return { min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]], max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]] };
}

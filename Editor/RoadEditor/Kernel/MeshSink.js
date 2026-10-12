//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/MeshSink.js — The packed vertex format and the tile router every solver writes into
//============================================================================================================================================
// Layout is chosen for the road shader, not for convenience: position plus (s,t) in metres, the distance to each band edge and to each road end
//    as floats (markings must be crisp), and the material/tint/symbol/flag and marking-code ids as quantised bytes with `flat` interpolation so a
//    code can never be smeared across a band. Normals are deliberately absent: every quad emitted here is planar, so the fragment shader rebuilds
//    them from screen-space derivatives for free. 48 bytes a vertex, no per-feature special case.
'use strict';

import { clamp } from './CurveKit.js';

/** Per-vertex flags, packed into aMisc.w. */
export const FLAG = { FACE: 1, PATCH: 2, RAMP: 4, LIT: 8, UNDER: 16, JUNC_A: 32, JUNC_B: 64, ONEWAY: 128 };

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  Vertex streams, routed into world tiles so the renderer can cull by sector
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export class VBO {
    constructor(cap = 512) {
        this.n = 0; this.in = 0;
        this.min = [Infinity, Infinity]; this.max = [-Infinity, -Infinity]; this.hi = -Infinity; this.lo = Infinity;
        this.alloc(cap);
        this.idx = new Uint32Array(Math.max(64, cap * 3));
    }
    alloc(cap) {
        this.cap = cap;
        this.pos = new Float32Array(cap * 3); this.st = new Float32Array(cap * 2); this.dist = new Float32Array(cap * 4);
        this.misc = new Uint8Array(cap * 4); this.mark = new Uint8Array(cap * 4); this.bump = new Float32Array(cap);
    }
    _grow(nv) {
        let cap = this.cap || 64;
        while (cap < this.n + nv) cap *= 2;
        while (cap * 3 < this.in + 12) cap *= 2;
        const take = (src, Arr, mul) => { const d = new Arr(cap * mul); d.set(src.subarray(0, this.n * mul)); return d; };
        const pos = take(this.pos, Float32Array, 3), st = take(this.st, Float32Array, 2), dist = take(this.dist, Float32Array, 4);
        const misc = take(this.misc, Uint8Array, 4), mk = take(this.mark, Uint8Array, 4), bump = take(this.bump, Float32Array, 1);
        const idx = new Uint32Array(Math.max(cap * 3, this.in + 12)); idx.set(this.idx.subarray(0, this.in));
        this.alloc(cap);
        this.pos = pos; this.st = st; this.dist = dist; this.misc = misc; this.mark = mk; this.bump = bump; this.idx = idx;
    }
    v(x, y, z, s, t, dl, dr, ds, de, mat, tint, sym, flags, m0, m1, per, sf, bump) {
        if (this.n + 1 > this.cap) this._grow(1);
        const i = this.n++, i3 = i * 3, i2 = i * 2, i4 = i * 4;
        this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
        this.st[i2] = s; this.st[i2 + 1] = t;
        this.dist[i4] = dl; this.dist[i4 + 1] = dr; this.dist[i4 + 2] = ds; this.dist[i4 + 3] = de;
        this.misc[i4] = mat; this.misc[i4 + 1] = tint; this.misc[i4 + 2] = sym; this.misc[i4 + 3] = flags;
        this.mark[i4] = m0; this.mark[i4 + 1] = m1; this.mark[i4 + 2] = per; this.mark[i4 + 3] = sf;
        this.bump[i] = bump || 0;
        if (x < this.min[0]) this.min[0] = x; if (z < this.min[1]) this.min[1] = z;
        if (x > this.max[0]) this.max[0] = x; if (z > this.max[1]) this.max[1] = z;
        if (y > this.hi) this.hi = y; if (y < this.lo) this.lo = y;
        return i;
    }
    tri(a, b, c) {
        if (this.in + 3 > this.idx.length) { const d = new Uint32Array(this.idx.length * 2); d.set(this.idx.subarray(0, this.in)); this.idx = d; }
        this.idx[this.in++] = a; this.idx[this.in++] = b; this.idx[this.in++] = c;
    }
    get empty() { return this.n === 0; }
    snapshot() {
        return {
            pos: this.pos.slice(0, this.n * 3), st: this.st.slice(0, this.n * 2), dist: this.dist.slice(0, this.n * 4),
            misc: this.misc.slice(0, this.n * 4), mark: this.mark.slice(0, this.n * 4),
            bump: this.bump.slice(0, this.n), idx: this.idx.slice(0, this.in),
            min: this.min, max: this.max, hi: this.hi, lo: this.lo, verts: this.n, tris: this.in / 3,
        };
    }
}

export class Sectors {
    constructor(size) { this.size = size; this.map = new Map(); this.list = []; }
    at(x, z) {
        const i = Math.floor(x / this.size), j = Math.floor(z / this.size);
        const k = (i + 4096) * 8192 + (j + 4096);
        let s = this.map.get(k);
        if (!s) { s = { i, j, v: new VBO(256) }; this.map.set(k, s); this.list.push(s); }
        return s.v;
    }
    finish() {
        const out = [];
        for (const s of this.list) if (!s.v.empty) out.push({ i: s.i, j: s.j, ...s.v.snapshot() });
        out.sort((a, b) => (a.i - b.i) || (a.j - b.j));
        return out;
    }
}

/**
 * Emit a quad. Corners are given (sA,t0) (sB,t0) (sB,t1) (sA,t1) — that order yields an upward normal for a flat road.
 * `o.up` forces the normal skyward for arbitrary polygons (lots, junction patches, ground).
 */
export function quad(sinks, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, o) {
    // The cross product is only used to decide the winding (and, for `up`, to flip it); the road shader recovers the
    //    normal itself from screen-space derivatives, which is exact because every quad here is planar.
    let nx = (by - ay) * (dz - az) - (bz - az) * (dy - ay);
    let ny = (bz - az) * (dx - ax) - (bx - ax) * (dz - az);
    let nz = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-7) return;
    nx /= l; ny /= l; nz /= l;
    if (o.up && ny < 0) {
        let t;
        t = [ax, ay, az]; ax = bx; ay = by; az = bz; bx = t[0]; by = t[1]; bz = t[2];
        t = [dx, dy, dz]; dx = cx; dy = cy; dz = cz; cx = t[0]; cy = t[1]; cz = t[2];
        nx = -nx; ny = -ny; nz = -nz;
    }
    const sk = sinks.at((ax + cx) * 0.5, (az + cz) * 0.5);
    const w = Math.abs(o.t1 - o.t0), L = o.L ?? 0;
    const put = (x, y, z, s, t, dl, dr, bump) =>
        sk.v(x, y, z, s, t, dl, dr, s, L - s, o.mat, o.tint | 0, o.sym | 0, o.flags | 0, o.m0 | 0, o.m1 | 0, o.per | 0, o.sf | 0, bump);
    const i0 = put(ax, ay, az, o.sA, o.t0, 0, w, o.bA);
    const i1 = put(bx, by, bz, o.sB, o.t0, 0, w, o.bB);
    const i2 = put(cx, cy, cz, o.sB, o.t1, w, 0, o.bB);
    const i3 = put(dx, dy, dz, o.sA, o.t1, w, 0, o.bA);
    sk.tri(i0, i1, i2); sk.tri(i0, i2, i3);
}

/** Flat triangle, normal forced up. Used for ear-clipped patches and lots. */
export function tri(sinks, a, b, c, y, o) {
    const cr = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cr) < 1e-5) return;
    const p = cr > 0 ? [a, b, c] : [a, c, b];
    const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3;
    const sk = sinks.at(x, z);
    const put = (P) => sk.v(P.x, y, P.z, x, z, 4, 4, 0, 0, o.mat, o.tint | 0, o.sym | 0, o.flags | 0, 0, 0, 0, 0, 0);
    const i0 = put(p[0]), i1 = put(p[1]), i2 = put(p[2]);
    sk.tri(i0, i1, i2);
}



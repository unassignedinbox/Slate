//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/CurveKit.js — Deterministic sampling/fairing of centrelines: everything downstream eats stations, not splines
//============================================================================================================================================
// A road is a fair polyline. Fairing is two iterations of Chaikin corner cutting (G1-ish, and it is the identity on collinear runs, so grid
//    streets stay dead straight) followed by arc-length resampling whose step tightens with curvature — the station spacing is therefore the
//    single knob that trades vertex count for curb-radius fidelity. Every routine here is pure and seed-driven so the bake worker and the
//    editor preview derive byte-identical geometry from the same document.
'use strict';

/** [m] half-widths of the world the generator is allowed to fill. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1); return t * t * (3 - 2 * t); };

/** mulberry32 — 32-bit state, no allocation in the hot loop. */
export function Rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const f = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (n) => Math.floor(f() * n);
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
}

/** Integer hash → [0,1). Used for per-cell / per-instance variation that must not depend on traversal order. */
export function hash3(i, j, k = 0) {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** Value noise on an integer lattice with quintic interpolation. `scale` is the cell size [m]. */
export function noise2(x, z, scale = 100, oct = 3, seed = 0) {
    let amp = 1, sum = 0, norm = 0, sx = x / scale, sz = z / scale, sc = scale;
    for (let o = 0; o < oct; ++o) {
        const gx = Math.floor(sx), gz = Math.floor(sz);
        const fx = sx - gx, fz = sz - gz;
        const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
        const v = (a, b) => hash3(gx + a, gz + b, seed + o * 7919);
        const top = lerp(v(0, 0), v(1, 0), ux), bot = lerp(v(0, 1), v(1, 1), ux);
        sum += amp * lerp(top, bot, uz); norm += amp;
        amp *= 0.5; sc *= 0.5; sx = x / sc; sz = z / sc;
    }
    return sum / norm; // [0,1]
}

/** Ground elevation of the whole world [m]. Flat by default; `amp` opens up gentle undulation for long-sight boulevards. */
export function terrainY(x, z, amp = 0, seed = 0) {
    if (amp <= 1e-4) return 0;
    return (noise2(x, z, 620, 3, seed) - 0.5) * 2 * amp;
}

/** @returns {number} length of a polyline [m]. */
export function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; ++i) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    return L;
}

/** Chaikin corner cutting. Endpoints are pinned so road ends stay glued to their junction node. */
export function chaikin(pts, iterations = 2, closed = false) {
    let out = pts;
    for (let it = 0; it < iterations; ++it) {
        if (out.length < 3) break;
        const next = [out[0]];
        for (let i = 0; i < out.length - 1; ++i) {
            const a = out[i], b = out[i + 1];
            next.push({ x: lerp(a.x, b.x, 0.25), z: lerp(a.z, b.z, 0.25), y: lerp(a.y ?? 0, b.y ?? 0, 0.25) });
            next.push({ x: lerp(a.x, b.x, 0.75), z: lerp(a.z, b.z, 0.75), y: lerp(a.y ?? 0, b.y ?? 0, 0.75) });
        }
        next.push(out[out.length - 1]);
        out = next;
    }
    return out;
}

/**
 * Resample a polyline to (near-)uniform stations, densifying where it curves.
 * @param {number} step   nominal station spacing on straights [m]
 * @param {number} minStep spacing inside tight curvature [m]
 * @returns {{x:number,z:number,y:number,s:number,tx:number,tz:number,k:number}[]}
 */
export function sample(pts, step = 8, minStep = 2.5, opts = {}) {
    const fair = opts.fair === false ? pts : chaikin(pts, opts.fairIterations ?? 2);
    if (fair.length < 2) return [];
    const stations = [];
    const push = (x, z, y) => stations.push({ x, z, y: y ?? 0, s: 0, tx: 1, tz: 0, k: 0 });
    push(fair[0].x, fair[0].z, fair[0].y);
    // `acc` carries the distance since the last station across segment boundaries, so spacing is uniform along the whole
    //    curve rather than restarting inside every input segment (which is what starved the short segments a trim leaves behind).
    let acc = 0;
    for (let i = 1; i < fair.length; ++i) {
        const a = fair[i - 1], b = fair[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const seg = Math.hypot(dx, dz);
        if (seg < 1e-9) continue;
        const bend = i > 1 ? turnAngle(fair[i - 2], a, b) : 0;
        const target = clamp(step / (1 + bend * 26), minStep, step);
        let pos = 0;
        for (;;) {
            const need = target - acc;
            if (pos + need > seg) { acc += seg - pos; break; }
            pos += need; acc = 0;
            const u = pos / seg;
            push(a.x + dx * u, a.z + dz * u, lerp(a.y ?? 0, b.y ?? 0, u));
        }
    }
    const last = fair[fair.length - 1];
    const tail = stations[stations.length - 1];
    if (Math.hypot(last.x - tail.x, last.z - tail.z) > 1e-4) push(last.x, last.z, last.y);

    let s = 0;
    for (let i = 0; i < stations.length; ++i) {
        const p = stations[i];
        if (i > 0) s += Math.hypot(p.x - stations[i - 1].x, p.z - stations[i - 1].z);
        p.s = s;
    }
    // tangent + curvature from neighbours
    for (let i = 0; i < stations.length; ++i) {
        const p = stations[i];
        const a = stations[Math.max(0, i - 1)], b = stations[Math.min(stations.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        p.tx = dx / l; p.tz = dz / l;
        const ds = Math.max(1e-3, b.s - a.s);
        p.k = turnAngle(a, p, b) / ds; // [1/m] curvature magnitude
    }
    return stations;
}

function turnAngle(a, b, c) {
    const ax = b.x - a.x, az = b.z - a.z, cx = c.x - b.x, cz = c.z - b.z;
    const la = Math.hypot(ax, az), lc = Math.hypot(cx, cz);
    if (la < 1e-9 || lc < 1e-9) return 0;
    const dot = (ax * cx + az * cz) / (la * lc);
    const cr = (ax * cz - az * cx) / (la * lc);
    return Math.abs(Math.atan2(cr, dot));
}

/** Right-hand normal at every station: n = (tz,-tx), so +t is to the right of travel. */
export function normals(stations) {
    for (const p of stations) { p.nx = p.tz; p.nz = -p.tx; } // [-] unit, points to the *right* of travel
    return stations;
}

/** Signed turn between travel direction and +t side; used to mirror markings. */
export function isLeft(t) { return t < 0; }

/** Nearest point on a polyline (world XZ). @returns {{i:number,u:number,x:number,z:number,dist:number,s:number,tx:number,tz:number}} */
export function nearestOnPolyline(pts, x, z) {
    let best = { i: 0, u: 0, x: pts[0].x, z: pts[0].z, dist: Infinity, s: 0, tx: 1, tz: 0 };
    let acc = 0;
    for (let i = 1; i < pts.length; ++i) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        let u = l2 > 1e-12 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
        u = clamp(u, 0, 1);
        const px = a.x + dx * u, pz = a.z + dz * u;
        const d = Math.hypot(x - px, z - pz);
        if (d < best.dist) {
            const seg = Math.sqrt(l2);
            best = { i, u, x: px, z: pz, dist: d, s: acc + seg * u, tx: seg > 1e-9 ? dx / seg : 1, tz: seg > 1e-9 ? dz / seg : 0 };
        }
        acc += Math.sqrt(l2);
    }
    return best;
}

/** Segment/segment intersection in XZ. @returns {?{x,z,t,u}} */
export function segIntersect(p0, p1, p2, p3) {
    const r1x = p1.x - p0.x, r1z = p1.z - p0.z, r2x = p3.x - p2.x, r2z = p3.z - p2.z;
    const den = r1x * r2z - r1z * r2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((p2.x - p0.x) * r2z - (p2.z - p0.z) * r2x) / den;
    const u = ((p2.x - p0.x) * r1z - (p2.z - p0.z) * r1x) / den;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
    return { x: p0.x + r1x * t, z: p0.z + r1z * t, t, u };
}

/** True if two polylines cross anywhere (XZ). */
export function polylinesCross(a, b, pad = 0) {
    for (let i = 1; i < a.length; ++i) {
        for (let j = 1; j < b.length; ++j) {
            const hit = segIntersect(a[i - 1], a[i], b[j - 1], b[j]);
            if (hit) {
                if (pad <= 0) return hit;
                // Reject hits that are really a shared endpoint.
                if (Math.hypot(hit.x - a[i].x, hit.z - a[i].z) < pad) continue;
                return hit;
            }
        }
    }
    return null;
}

/** Uniform grid bucket index for a world coordinate. */
export function cellKey(x, z, size) { return `${Math.floor(x / size)},${Math.floor(z / size)}`; }

/** Arc-length window: sub-polyline of `pts` between s0..s1 (assumes pts already carry .s or are stations). */
export function sliceStations(stations, s0, s1) {
    const out = [];
    for (const p of stations) if (p.s >= s0 - 1e-6 && p.s <= s1 + 1e-6) out.push(p);
    return out;
}

/** Catmull-Rom through waypoints → dense polyline. Used for rail/metro alignment fairing. */
export function catmullPolyline(pts, perSpan = 16, closed = false) {
    if (pts.length < 3) return pts.slice();
    const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1], pts[pts.length - 2]];
    const out = [];
    const n = P.length;
    for (let i = 1; i < n - 2; ++i) {
        const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
        for (let k = 0; k < perSpan; ++k) {
            const t = k / perSpan, t2 = t * t, t3 = t2 * t;
            const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z), y: cr(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0) });
        }
    }
    out.push({ x: P[n - 2].x, z: P[n - 2].z, y: P[n - 2].y ?? 0 });
    return out;
}

/** Circular arc polyline from a to b around centre, sampled to chord tolerance. */
export function arc(cx, cz, r, a0, a1, tol = 0.12) {
    const sweep = a1 - a0;
    const n = Math.max(2, Math.ceil(Math.abs(sweep) * r / Math.sqrt(Math.max(1e-6, 8 * r * tol))));
    const out = [];
    for (let i = 0; i <= n; ++i) {
        const a = a0 + sweep * (i / n);
        out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
    return out;
}

/**
 * Biarc fillet between two rays leaving `origin` along `dA` and `dB` (both unit, XZ), tangent-continuous,
 * used for ramp throats and curb radius. Returns the tangent points.
 */
export function filletPoints(origin, dA, dB, r) {
    let dx = dA.x + dB.x, dz = dA.z + dB.z;
    const l = Math.hypot(dx, dz) || 1;
    const bis = { x: dx / l, z: dz / l };
    const halfTurn = Math.acos(clamp(-(dA.x * dB.x + dA.z * dB.z), -1, 1)) / 2; // [rad] interior
    const t = r / Math.max(0.12, Math.tan(Math.max(0.12, Math.min(1.45, (Math.PI - halfTurn)))));
    return { a: { x: origin.x + dA.x * t, z: origin.z + dA.z * t }, b: { x: origin.x + dB.x * t, z: origin.z + dB.z * t }, t };
}

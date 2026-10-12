//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/TransitSolver.js — Bored tunnels, station shells and vent shafts for the underground
//============================================================================================================================================
// Underground geometry is deliberately dumb — a twin-bore tube swept along the alignment and a platform box at each station — because its job is
//    to be *correct when you look*: the X-ray view and the fly-under should both show a real section. Both skins are emitted (excavation outside,
//    segment lining inside) so the bore reads from either side without a double-sided material, which the rest of the world never needs.
'use strict';

import { sample, clamp } from './CurveKit.js';
import { MAT, TINT, SYM, MARK } from './ProfileSolver.js';
import { quad, tri, FLAG } from './MeshSink.js';

const RING = 14;

export function buildTransit(sinks, doc, S) {
    for (const line of doc.transit || []) {
        const depth = line.depth ?? -17.5;
        if (line.mode === 'tunnel') {
            for (const align of line.alignments || []) {
                const st = frame(align);
                if (st.length < 2) continue;
                for (const side of [-1, 1]) bore(sinks, st, depth, side * 2.35, 3.25);
                vents(sinks, st, depth);
            }
        }
        for (const s of line.stations || []) station(sinks, s, line, depth);
    }
}

function frame(pts) {
    const st = sample(pts, 11, 4, { fair: true });
    for (const p of st) { p.nx = p.tz; p.nz = -p.tx; }
    return st;
}

function bore(sinks, st, y, off, r) {
    const band = { mat: MAT.CONCRETE, tint: TINT.NONE, sym: SYM.NONE, m0: 0, m1: 0, per: 0, sf: 0, flags: FLAG.UNDER, bA: 0, bB: 0, L: 1 };
    const ring = (P, k, radius, up) => {
        const a = (k / RING) * Math.PI * 2;
        return { x: P.x + P.nx * (off + Math.cos(a) * radius * 0.86), y: up + Math.sin(a) * radius, z: P.z + P.nz * (off + Math.cos(a) * radius * 0.86) };
    };
    for (let skin = 0; skin < 2; ++skin) {
        const rad = skin ? r : r + 0.22;
        const mat = skin ? MAT.CONCRETE : MAT.DIRT;
        for (let i = 0; i + 1 < st.length; ++i) {
            const A = st[i], B = st[i + 1];
            for (let k = 0; k < RING; ++k) {
                const a0 = ring(A, k, rad, y), a1 = ring(A, k + 1, rad, y), b0 = ring(B, k, rad, y), b1 = ring(B, k + 1, rad, y);
                if (skin) {
                    quad(sinks, a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z,
                        { sA: A.s, sB: B.s, t0: -rad, t1: rad, ...band, mat, up: 0 });
                } else {
                    quad(sinks, a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z,
                        { sA: A.s, sB: B.s, t0: -rad, t1: rad, ...band, mat, up: 0 });
                }
            }
        }
    }
}

/** A shaft to the surface every ~200 m so the alignment is legible from the street, and a grating frame at the top. */
function vents(sinks, st, depth) {
    let acc = 0;
    const band = { mat: MAT.CONCRETE, tint: TINT.NONE, sym: SYM.NONE, m0: 0, m1: 0, per: 0, sf: 0, flags: FLAG.UNDER, bA: 0, bB: 0, L: 1 };
    for (let i = 0; i + 1 < st.length; ++i) {
        acc += Math.hypot(st[i + 1].x - st[i].x, st[i + 1].z - st[i].z);
        if (acc < 200) continue;
        acc = 0;
        const P = st[i], Q = st[Math.min(st.length - 1, i + 3)];
        for (const side of [-1, 1]) {
            const cx = P.x + P.nx * side * 6.4, cz = P.z + P.nz * side * 6.4;
            const w = 1.5;
            const c = [[-w, -w], [w, -w], [w, w], [-w, w]];
            for (let k = 0; k < 4; ++k) {
                const a = c[k], b = c[(k + 1) % 4];
                quad(sinks,
                    cx + a[0] * P.tx + a[1] * P.nx, depth - 1, cz + a[0] * P.tz + a[1] * P.nz,
                    cx + b[0] * P.tx + b[1] * P.nx, depth - 1, cz + b[0] * P.tz + b[1] * P.nz,
                    cx + b[0] * P.tx + b[1] * P.nx, 0.2, cz + b[0] * P.tz + b[1] * P.nz,
                    cx + a[0] * P.tx + a[1] * P.nx, 0.2, cz + a[0] * P.tz + a[1] * P.nz,
                    { sA: 0, sB: 1, t0: -w, t1: w, ...band, up: 1 });
            }
            void Q;
        }
    }
}

/** Station shell: hall floor with two platforms, track slots, ceiling and the escalator shafts up to the street. */
function station(sinks, s, line, depth) {
    const L = s.hallLength ?? 52, W = s.hallWidth ?? 22, H = 7.4;
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    const P = (u, v, y) => ({ x: s.x + ca * u + sa * v, y, z: s.z + sa * u - ca * v });
    const conc = { mat: MAT.CONCRETE, tint: TINT.NONE, sym: SYM.NONE, m0: 0, m1: 0, per: 0, sf: 0, flags: FLAG.UNDER, bA: 0, bB: 0, L: 1 };
    const slab = { ...conc, mat: MAT.CONCRETE_SLAB };
    const plat = { ...conc, mat: MAT.PAVER };
    const track = { ...conc, mat: MAT.BALLAST };
    const lit = { ...conc, mat: MAT.STEEL, flags: FLAG.UNDER | FLAG.LIT, tint: TINT.NONE };
    const y0 = depth, y1 = depth + H;
    // floor: two track ways and a raised platform between them
    quad(sinks, ...flat(P, -L / 2, -W / 2, L / 2, -3.6, y0), { ...track, up: 1, sA: -L / 2, sB: L / 2, t0: -W / 2, t1: -3.6 });
    quad(sinks, ...flat(P, -L / 2, 3.6, L / 2, W / 2, y0), { ...track, up: 1, sA: -L / 2, sB: L / 2, t0: 3.6, t1: W / 2 });
    quad(sinks, ...flat(P, -L / 2, -3.6, -L / 2, 3.6, y0 + 1.05), { ...plat, up: 1, sA: -L / 2, sB: L / 2, t0: -3.6, t1: 3.6 });
    // platform edges (yellow band) + kerb face both sides
    for (const side of [-1, 1]) {
        const tv = side * 3.6, th = side * 3.42;
        for (let i = 0; i + 1 < 9; ++i) {
            const u0 = -L / 2 + (i / 8) * L, u1 = -L / 2 + ((i + 1) / 8) * L;
            quad(sinks,
                P(u0, tv, y0 + 1.06).x, y0 + 1.06, P(u0, tv, y0 + 1.06).z,
                P(u1, tv, y0 + 1.06).x, y0 + 1.06, P(u1, tv, y0 + 1.06).z,
                P(u1, th, y0 + 1.06).x, y0 + 1.06, P(u1, th, y0 + 1.06).z,
                P(u0, th, y0 + 1.06).x, y0 + 1.06, P(u0, th, y0 + 1.06).z,
                { sA: u0, sB: u1, t0: th, t1: tv, ...slab, up: 1, m0: MARK.SOLID_Y, m1: MARK.SOLID_Y, sf: 2 });
        }
    }
    // ceiling, walls, end walls
    quad(sinks, ...flat(P, -L / 2, -W / 2, L / 2, W / 2, y1), { ...conc, up: 0, sA: -L / 2, sB: L / 2, t0: -W / 2, t1: W / 2 });
    for (const side of [-1, 1]) {
        const v = side * W / 2;
        for (let i = 0; i + 1 < 9; ++i) {
            const u0 = -L / 2 + (i / 8) * L, u1 = -L / 2 + ((i + 1) / 8) * L;
            const a = P(u0, v, y0), b = P(u1, v, y0), c = P(u1, v, y1), d = P(u0, v, y1);
            quad(sinks, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z,
                { sA: u0, sB: u1, t0: y0, t1: y1, ...conc });
            // light strip under the ceiling
            const l1 = P(u0, v * 0.5, y1 - 0.35), l2 = P(u1, v * 0.5, y1 - 0.35), l3 = P(u1, v * 0.5 + 0.3, y1 - 0.35), l4 = P(u0, v * 0.5 + 0.3, y1 - 0.35);
            quad(sinks, l1.x, l1.y, l1.z, l2.x, l2.y, l2.z, l3.x, l3.y, l3.z, l4.x, l4.y, l4.z,
                { sA: u0, sB: u1, t0: -0.15, t1: 0.15, ...lit, up: 1 });
        }
    }
    // escalator shafts up to street level
    for (const side of [-1, 1]) {
        const u = side * (L / 2 - 6);
        const a = P(u - 2.4, -5.2, y1), b = P(u + 2.4, -5.2, y1), c = P(u + 2.4, -2.2, y1), d = P(u - 2.4, -2.2, y1);
        quad(sinks, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z, { sA: u, sB: u + 1, t0: -5.2, t1: -2.2, ...slab, up: 1 });
        for (const v of [-5.2, -2.2]) {
            const p0 = P(u - 2.4, v, y1), p1 = P(u + 2.4, v, y1), p2 = P(u + 2.4, v, 0.4), p3 = P(u - 2.4, v, 0.4);
            quad(sinks, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, { sA: u, sB: u + 1, t0: y1, t1: 0.4, ...conc });
        }
    }
    void tri; void clamp; void sample;
}
function flat(P, u0, v0, u1, v1, y) {
    const a = P(u0, v0, y), b = P(u1, v0, y), c = P(u1, v1, y), d = P(u0, v1, y);
    return [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z];
}

//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/SkinSolver.js — Sweeps resolved sections along fair centrelines into sector-packed triangle soup
//============================================================================================================================================
// One emitter for the whole world. Every band of a profile becomes a strip of quads swept between stations, and each quad carries what the road
//    shader needs to paint the surface and its markings: arc length, lateral offset, distance to each band edge, distance to each road end, the two
//    edge marking codes and the lane symbol cell. Everything else is that mechanism in different clothes — a kerb face is a zero-width band, a
//    barrier or tunnel wall is a tall one, an embankment or bridge soffit is a band appended from the structure height, a junction is an ear-clipped
//    polygon bounded by quadratic fillet arcs, and a dropped kerb is a lateral×longitudinal multiplier on band heights, which is why section
//    continuity can never break: both edges of every band at the same t get the same multiplier, whatever material they belong to.
'use strict';

import earcut from 'earcut';
import { getProfile, MAT, MARK, SYM, TINT, profileSpeed } from './ProfileSolver.js';
import { sample, chaikin, terrainY, clamp, lerp, smoothstep } from './CurveKit.js';
import { buildProps } from './PropSolver.js';
import { resolveClashes } from './ClashSolver.js';
import { buildTransit } from './TransitSolver.js';

import { FLAG, VBO, Sectors, quad, tri } from './MeshSink.js';

/** Bake settings; the UI exposes every one of them so a preset can move them together. */
export const DEFAULTS = {
    step: 7,          // [m] nominal station spacing on straights
    minStep: 2.0,     // [m] station spacing inside tight curvature
    fair: 2,          // [-] Chaikin iterations applied to every centreline
    amp: 0,           // [m] ground undulation amplitude
    seed: 1,
    markings: 1,      // [-] 0 = bare surfaces (fastest bake)
    props: 1,         // [-] street furniture pass (PropSolver)
    curbRadius: 1,    // [-] scales every kerb radius at junctions
    humpAmp: 0.095,   // [m] speed hump rise
    sector: 220,      // [m] tile size for culling/streaming
    world: 3200,      // [m] half-extent of the ground plane
    groundGrid: 200,  // [m] ground plane quad size
    structure: 1,     // [-] embankments, retaining walls, bridge soffits
    crossing: 1,      // [-] at-grade rail/road clashes
    propDensity: 1,   // [-] spacing multiplier for lamps and walkway furniture (lower = denser)
    propMacro: 660,   // [m] culling tile for instanced props
    propsLamps: 1, propsSigns: 1, propsTrees: 1, propsRail: 1, propsDrainage: 1, propsLots: 1,
};


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  Centrelines
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Fair a road's waypoints and tabulate arc length. Endpoints stay pinned, so roads keep their grip on junction nodes. */
export function fairRoad(road, S = DEFAULTS) {
    const pts = road.points;
    if (!pts || pts.length < 2) return null;
    const fair = chaikin(pts, S.fair ?? 2, !!road.closed);
    if (fair.length < 2) return null;
    let s = 0; const out = [];
    for (let i = 0; i < fair.length; ++i) {
        const p = fair[i];
        if (i > 0) s += Math.hypot(p.x - fair[i - 1].x, p.z - fair[i - 1].z);
        out.push({ x: p.x, z: p.z, y: p.y ?? 0, s });
    }
    if (!(s >= 0.5)) return null;   // [-] also rejects NaN from a malformed edit (undefined waypoint coordinate)
    for (const q of out) if (!(isFinite(q.x) && isFinite(q.z))) return null;
    out.len = s;
    return out;
}

/** Point at arc length s along a tabulated polyline. */
export function atLength(fair, s) {
    const last = fair.length - 1;
    s = clamp(s, 0, fair[last].s);
    let lo = 0, hi = last;
    while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (fair[m].s < s) lo = m; else hi = m; }
    const a = fair[lo], b = fair[hi];
    const u = b.s - a.s > 1e-9 ? (s - a.s) / (b.s - a.s) : 0;
    return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), y: lerp(a.y ?? 0, b.y ?? 0, u), s };
}

/** Outward frame at one end: origin, unit vector pointing away from the node, and its right-hand normal. */
export function endFrame(fair, which, span = 16) {
    const n = fair.length;
    const tip = which === 'A' ? fair[0] : fair[n - 1];
    const L = fair[n - 1].s;
    const ref = atLength(fair, which === 'A' ? Math.min(span, L) : Math.max(0, L - span));
    let ux = which === 'A' ? ref.x - tip.x : tip.x - ref.x;
    let uz = which === 'A' ? ref.z - tip.z : tip.z - ref.z;
    const l = Math.hypot(ux, uz) || 1;
    return { x: tip.x, z: tip.z, ux: ux / l, uz: uz / l, rx: uz / l, rz: -ux / l };
}

/**
 * Stations between the trims, with base elevation and frames. Stations are inserted at each speed-hump toe and crest so
 * the hump reads as a curve without shrinking the quads of the whole road.
 */
/** The natural surface under a point — the reference every embankment, cut wall and lot cap is measured against. */
export const groundY = (x, z, S) => (S && S.amp ? terrainY(x, z, S.amp, S.seed) : 0);

export function stationsFor(road, fair, trimA, trimB, S = DEFAULTS, yA, yB) {
    const L = fair[fair.length - 1].s;
    const to = Math.max(trimA + 1.5, L - trimB);
    if (to - trimA < 1.6) return [];
    const carrier = [];
    for (let s = trimA; s <= to; s += 2.0) carrier.push(atLength(fair, s));
    carrier.push(atLength(fair, to));
    if (carrier.length < 2) return [];
    // A free polyline (no nodes on either end — rail, metro, water) carries its own elevations on its waypoints; a road
    //    hung between two junction nodes must take them, so the junction stays flat across its mouth.
    const free = yA == null && yB == null && road.y0 == null && road.y1 == null;
    const y0 = yA ?? road.y0 ?? 0, y1 = yB ?? road.y1 ?? 0, camber = road.camber ?? 0;
    const elev = (px, pz, sAbs, fy) => {
        const u = clamp(sAbs / Math.max(1e-6, L), 0, 1);
        const grade = free ? (fy ?? 0) : lerp(y0, y1, u);
        return grade + camber * Math.sin(Math.PI * u) + groundY(px, pz, S);
    };
    // Stations merged from two sources (uniform sampling plus hump break points) need s, tangents and elevation derived
    //    together, otherwise the inserted points arrive with no tangent and every band swept from them is NaN.
    const finish = (list) => {
        let s = 0;
        for (let i = 0; i < list.length; ++i) {
            const p = list[i];
            if (i > 0) s += Math.hypot(p.x - list[i - 1].x, p.z - list[i - 1].z);
            p.s = s;
        }
        for (let i = 0; i < list.length; ++i) {
            const p = list[i];
            const a = list[Math.max(0, i - 1)], b = list[Math.min(list.length - 1, i + 1)];
            let dx = b.x - a.x, dz = b.z - a.z;
            const l = Math.hypot(dx, dz);
            if (l < 1e-6) { dx = p.tx ?? 1; dz = p.tz ?? 0; } else { dx /= l; dz /= l; }
            p.tx = dx; p.tz = dz; p.nx = dz; p.nz = -dx;
            p.base = elev(p.x, p.z, p.s + trimA, p.y);
            p.groundY = groundY(p.x, p.z, S);
        }
        return list;
    };
    const dedupe = (list) => {
        const out = [];
        for (const p of list) { if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.z - out[out.length - 1].z) > 1e-3) out.push(p); }
        return out;
    };
    let st = finish(sample(carrier, S.step, S.minStep, { fair: false }));
    if (st.length < 2) return st;
    if (road.bumps && road.bumps.length) {
        const ins = [];
        for (const b of road.bumps) {
            const w = b.w ?? 3.6;
            for (const c of [-w * 0.62, -w * 0.34, 0, w * 0.34, w * 0.62]) {
                const sAbs = b.s + c;
                if (sAbs > trimA + 0.4 && sAbs < to - 0.4) ins.push(atLength(fair, sAbs));
            }
        }
        if (ins.length) st = finish(dedupe(st.concat(ins).sort((a, b) => a.s - b.s)));
    }
    return st;
}

export function bumpHeight(road, s, S = DEFAULTS) {
    if (!road.bumps || !road.bumps.length) return 0;
    let h = 0;
    for (const b of road.bumps) {
        const w = b.w ?? 3.6, d = Math.abs(s - b.s);
        if (d < w * 0.5) { const u = Math.cos((d / (w * 0.5)) * Math.PI * 0.5); h = Math.max(h, (b.h ?? S.humpAmp) * u * u); }
    }
    return h;
}
function bumpDist(road, s) {
    if (!road.bumps || !road.bumps.length) return 40;
    let d = 40;
    for (const b of road.bumps) d = Math.min(d, Math.abs(s - b.s));
    return d;
}
const inGaps = (road, s) => { if (!road.gaps) return false; for (const g of road.gaps) if (s > g.a && s < g.b) return true; return false; };

/** 1 = keep the band height as authored, 0 = press it flush into the carriageway (dropped kerb at a junction mouth). */
function kerbBlend(s, L, t, roadHalf, juncA, juncB) {
    if (!juncA && !juncB) return 1;
    const d = Math.min(juncA ? s : 1e9, juncB ? L - s : 1e9);
    if (d > 4.4) return 1;
    const lat = clamp((Math.abs(t) - roadHalf) / 1.3, 0, 1);
    if (lat <= 0) return 1;
    return 1 - lat * (1 - smoothstep(0.8, 4.4, d));
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  Road skin
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {Sectors} sinks
 * @param o {{trimA?:number,trimB?:number,juncA?:boolean,juncB?:boolean,yA?:number,yB?:number}}
 */
export function skinRoad(sinks, road, fair, S, o = {}) {
    const prof = getProfile(road.profile);
    const trimA = o.trimA ?? 0, trimB = o.trimB ?? 0;
    // Markings are procedural, so tessellation is only paid for where the road actually bends: a 14 m station step on a
    //    straight local costs a seventh of what a 2 m step does and looks identical, while ramps and loops still tighten to minStep.
    const stepScale = road.cls === 'highway' ? 1 : road.cls === 'arterial' ? 1.15 : road.cls === 'rail' ? 1.5 : 1.7;
    const st = stationsFor(road, fair, trimA, trimB, { ...S, step: S.step * stepScale, minStep: S.minStep * (stepScale > 1.5 ? 0.8 : 1) }, o.yA, o.yB);
    const NS = st.length;
    if (NS < 2) return { st, prof, len: 0 };
    const L = st[NS - 1].s;
    const roadHalf = Math.max(prof.roadHalf[0], prof.roadHalf[1]);
    const speed = profileSpeed(prof.def);
    const mkOn = (road.markings ?? 1) && S.markings;
    const flags0 = (o.juncA ? FLAG.JUNC_A : 0) | (o.juncB ? FLAG.JUNC_B : 0) | (prof.oneWay ? FLAG.ONEWAY : 0);
    const humps = !!(road.bumps && road.bumps.length);

    for (const sg of prof.segs) {
        const t0 = sg.t0, t1 = sg.t1, isFace = Math.abs(t1 - t0) < 1e-4;
        if (!isFace && Math.abs(t1 - t0) < 0.02) continue;
        const flags = flags0 | (isFace ? FLAG.FACE : 0) | (sg.lit ? FLAG.LIT : 0);
        const midT = 0.5 * (t0 + t1);
        const dashed = sg.m0 === MARK.DASH_W || sg.m0 === MARK.DASH_Y || sg.m0 === MARK.DOUBLEDASH_Y || sg.m1 === MARK.DASH_W || sg.m1 === MARK.DASH_Y || sg.m1 === MARK.DOUBLEDASH_Y;
        const base = {
            mat: sg.mat, tint: sg.tint, sym: mkOn ? sg.sym : SYM.NONE, flags,
            m0: mkOn ? sg.m0 : MARK.NONE, m1: mkOn ? sg.m1 : MARK.NONE,
            // A 30 km/h street and a 100 km/h motorway do not share a dash rhythm; the period is a marking, so it follows the design speed.
            per: clamp(Math.round(sg.symPeriod || (dashed ? 4.5 + speed * 0.17 : 24)), 2, 250),
            sf: (sg.symNearEnd ? 1 : 0) | (sg.mat === MAT.OXIDE || sg.mat === MAT.RUBBER ? 2 : 0) | (midT < 0 ? 4 : 0),
        };
        // Lane-use arrows are a property of the carriageway and its ends, not of a profile author's memory: any through lane
        //    whose downstream end is a junction gets a straight-ahead arrow at the approach.
        const laneW = Math.abs(t1 - t0);
        const paved = sg.mat === MAT.ASPHALT || sg.mat === MAT.ASPHALT_OLD || sg.mat === MAT.CONCRETE || sg.mat === MAT.COBBLE || sg.mat === MAT.STONE_SETT || sg.mat === MAT.TARMAC;
        const downstream = prof.oneWay ? o.juncB : (midT >= 0 ? o.juncB : o.juncA);
        if (mkOn && !sg.rail && paved && !isFace && laneW >= 2.5 && laneW <= 4.9 && Math.abs(midT) <= roadHalf + 0.15 && downstream) {
            base.sym = road.bumps && road.bumps.length ? SYM.SLOW : SYM.ARROW_THRU;
            base.per = road.bumps && road.bumps.length ? 12 : 9;
            base.sf |= 1;
        }
        for (let i = 0; i + 1 < NS; ++i) {
            const A = st[i], B = st[i + 1];
            if (inGaps(road, (A.s + B.s) * 0.5)) continue;
            const kA0 = kerbBlend(A.s, L, t0, roadHalf, o.juncA, o.juncB), kA1 = kerbBlend(A.s, L, t1, roadHalf, o.juncA, o.juncB);
            const kB0 = kerbBlend(B.s, L, t0, roadHalf, o.juncA, o.juncB), kB1 = kerbBlend(B.s, L, t1, roadHalf, o.juncA, o.juncB);
            const ramp = Math.min(kA0, kA1, kB0, kB1) < 0.75 ? FLAG.RAMP : 0;
            const bA = humps ? bumpHeight(road, A.s, S) : 0, bB = humps ? bumpHeight(road, B.s, S) : 0;
            quad(sinks,
                A.x + A.nx * t0, A.base + sg.h0 * kA0 + bA, A.z + A.nz * t0,
                B.x + B.nx * t0, B.base + sg.h0 * kB0 + bB, B.z + B.nz * t0,
                B.x + B.nx * t1, B.base + sg.h1 * kB1 + bB, B.z + B.nz * t1,
                A.x + A.nx * t1, A.base + sg.h1 * kA1 + bA, A.z + A.nz * t1,
                { sA: A.s, sB: B.s, t0, t1, ...base, flags: flags | ramp, bA, bB, L });
        }
        if (sg.rail) emitRails(sinks, st, prof, sg, L);
    }
    if (S.structure && !road.noStructure) emitStructure(sinks, st, prof, road, S);
    if (road.crossings && S.crossing) for (const c of road.crossings) emitGradeCrossing(sinks, st, c, L);
    return { st, prof, len: L };
}

/** Steel riding lines: head ribbon + inner web, one pair per track carried by the band. */
function emitRails(sinks, st, prof, sg, L) {
    const gauge = sg.rail || 1.435, count = sg.rails || 1;
    const a = Math.min(sg.t0, sg.t1), b = Math.max(sg.t0, sg.t1), w = b - a;
    const steel = { mat: MAT.STEEL, tint: TINT.NONE, sym: SYM.NONE, flags: 0, m0: 0, m1: 0, per: 0, sf: 0, L, bA: 0, bB: 0 };
    for (let k = 0; k < count; ++k) {
        const c = a + w * ((k + 1) / (count + 1));
        for (const side of [-1, 1]) {
            const t = c + side * gauge * 0.5, hw = 0.036, H = 0.155;
            for (let i = 0; i + 1 < st.length; ++i) {
                const A = st[i], B = st[i + 1];
                const hA = A.base + prof.heightAt(t) + 0.05, hB = B.base + prof.heightAt(t) + 0.05;
                quad(sinks,
                    A.x + A.nx * (t - hw), hA + H, A.z + A.nz * (t - hw),
                    B.x + B.nx * (t - hw), hB + H, B.z + B.nz * (t - hw),
                    B.x + B.nx * (t + hw), hB + H, B.z + B.nz * (t + hw),
                    A.x + A.nx * (t + hw), hA + H, A.z + A.nz * (t + hw),
                    { sA: A.s, sB: B.s, t0: t - hw, t1: t + hw, ...steel });
                const tin = side > 0 ? t - hw : t + hw;
                quad(sinks,
                    A.x + A.nx * tin, hA, A.z + A.nz * tin,
                    B.x + B.nx * tin, hB, B.z + B.nz * tin,
                    B.x + B.nx * tin, hB + H, B.z + B.nz * tin,
                    A.x + A.nx * tin, hA + H, A.z + A.nz * tin,
                    { sA: A.s, sB: B.s, t0: tin - 0.012, t1: tin + 0.012, ...steel, flags: FLAG.FACE });
            }
        }
    }
}

/** Overhead contact wire for electrified lines: a 6 cm ribbon at 6.1 m above the bed. */
export function emitCatenary(sinks, st, L, offsets) {
    const wire = { mat: MAT.STEEL, tint: TINT.NONE, sym: SYM.NONE, flags: 0, m0: 0, m1: 0, per: 0, sf: 0, L, bA: 0, bB: 0 };
    for (const off of offsets) {
        for (let i = 0; i + 1 < st.length; ++i) {
            const A = st[i], B = st[i + 1];
            quad(sinks,
                A.x + A.nx * (off - 0.03), A.base + 6.1, A.z + A.nz * (off - 0.03),
                B.x + B.nx * (off - 0.03), B.base + 6.1, B.z + B.nz * (off - 0.03),
                B.x + B.nx * (off + 0.03), B.base + 6.1, B.z + B.nz * (off + 0.03),
                A.x + A.nx * (off + 0.03), A.base + 6.1, A.z + A.nz * (off + 0.03),
                { sA: A.s, sB: B.s, t0: off - 0.03, t1: off + 0.03, ...wire });
        }
    }
}

/** At-grade rail crossing: the road carries the riding rails through its own surface. */
function emitGradeCrossing(sinks, st, c, L) {
    const s0 = c.s - c.half, s1 = c.s + c.half;
    const steel = { mat: MAT.STEEL, tint: TINT.NONE, sym: SYM.NONE, flags: 0, m0: 0, m1: 0, per: 0, sf: 0, L, bA: 0, bB: 0 };
    for (const t of [c.t - 0.7175, c.t + 0.7175]) {
        for (let i = 0; i + 1 < st.length; ++i) {
            const A = st[i], B = st[i + 1];
            if (B.s < s0 - 0.5 || A.s > s1 + 0.5) continue;
            quad(sinks,
                A.x + A.nx * (t - 0.035), A.base + 0.015, A.z + A.nz * (t - 0.035),
                B.x + B.nx * (t - 0.035), B.base + 0.015, B.z + B.nz * (t - 0.035),
                B.x + B.nx * (t + 0.035), B.base + 0.015, B.z + B.nz * (t + 0.035),
                A.x + A.nx * (t + 0.035), A.base + 0.015, A.z + A.nz * (t + 0.035),
                { sA: Math.max(A.s, s0), sB: Math.min(B.s, s1), t0: t - 0.035, t1: t + 0.035, ...steel });
        }
    }
}

/** Fill slopes, cut walls, bridge soffits — decided from the structure height at each station. */
function emitStructure(sinks, st, prof, road, S) {
    const NS = st.length;
    const kind = road.struct || 'auto';
    const roadHalf = Math.max(prof.roadHalf[0], prof.roadHalf[1]);
    const tL = -Math.max(prof.kerbHalf[0], roadHalf) - 0.04, tR = Math.max(prof.kerbHalf[1], roadHalf) + 0.04;
    const soil = { mat: MAT.GRASS, tint: TINT.NONE, sym: SYM.NONE, flags: 0, m0: 0, m1: 0, per: 0, sf: 0, bA: 0, bB: 0, L: st[NS - 1].s };
    const conc = { ...soil, mat: MAT.CONCRETE };
    const slope = road.slope ?? 1.75;
    const soffit = -(prof.def.metro ? 2.1 : 0.85);
    for (let i = 0; i + 1 < NS; ++i) {
        const A = st[i], B = st[i + 1];
        // Structure is decided by the road's height *above the surface it crosses*, so an undulating site does not turn every metre of
        //    pavement above datum into an embankment.
        const gA = A.groundY ?? 0, gB = B.groundY ?? 0;
        const footA = gA - 0.22, footB = gB - 0.22;
        const relA = A.base - gA, relB = B.base - gB;
        const hm = Math.max(relA, relB), hmin = Math.min(relA, relB);
        if (kind === 'bridge' || hm > 1.35) {
            const wallA = Math.min(A.base - 0.05, footA), wallB = Math.min(B.base - 0.05, footB);
            for (const t of [tL, tR]) {
                quad(sinks,
                    A.x + A.nx * t, wallA, A.z + A.nz * t,
                    B.x + B.nx * t, wallB, B.z + B.nz * t,
                    B.x + B.nx * t, B.base + soffit, B.z + B.nz * t,
                    A.x + A.nx * t, A.base + soffit, A.z + A.nz * t,
                    { sA: A.s, sB: B.s, t0: t - 0.2, t1: t + 0.2, ...conc, flags: FLAG.FACE });
            }
            quad(sinks,
                A.x + A.nx * tL, A.base + soffit, A.z + A.nz * tL,
                B.x + B.nx * tL, B.base + soffit, B.z + B.nz * tL,
                B.x + B.nx * tR, B.base + soffit, B.z + B.nz * tR,
                A.x + B.nx * tR, A.base + soffit, A.z + A.nz * tR,
                { sA: A.s, sB: B.s, t0: tL, t1: tR, ...conc });
            continue;
        }
        if (hm > 0.3) {
            for (const t of [tL, tR]) {
                const sgn = t < 0 ? -1 : 1;
                const out = (rel) => t + sgn * (Math.max(0.05, rel) * slope + 1.2);
                const aO = out(relA), bO = out(relB);
                quad(sinks,
                    A.x + A.nx * t, A.base - 0.04, A.z + A.nz * t,
                    B.x + B.nx * t, B.base - 0.04, B.z + B.nz * t,
                    B.x + B.nx * bO, footB, B.z + B.nz * bO,
                    A.x + B.nx * aO, footA, A.z + A.nz * aO,
                    { sA: A.s, sB: B.s, t0: Math.min(t, aO, bO), t1: Math.max(t, aO, bO), ...soil });
            }
        } else if (hmin < -0.3) {
            for (const t of [tL, tR]) {
                quad(sinks,
                    A.x + A.nx * t, A.base - 0.04, A.z + A.nz * t,
                    B.x + B.nx * t, B.base - 0.04, B.z + B.nz * t,
                    B.x + B.nx * t, gB + 0.3, B.z + B.nz * t,
                    A.x + A.nx * t, gA + 0.3, A.z + A.nz * t,
                    { sA: A.s, sB: B.s, t0: t - 0.25, t1: t + 0.25, ...conc, flags: FLAG.FACE });
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  Junctions: mouth lines, quadratic fillet arcs, ear-clipped patch, raised corner bulbs with dropped kerbs
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Where two kerb lines cross — the corner point the fillet is tangent to both of. */
function kerbLineHit(node, ri, rj) {
    const p0 = { x: node.x - ri.rx * ri.wL, z: node.z - ri.rz * ri.wL };
    const p1 = { x: node.x + rj.rx * rj.wR, z: node.z + rj.rz * rj.wR };
    const den = ri.ux * rj.uz - ri.uz * rj.ux;
    if (Math.abs(den) < 1e-3) return null;
    const t = ((p1.x - p0.x) * rj.uz - (p1.z - p0.z) * rj.ux) / den;
    const u = ((p1.x - p0.x) * ri.uz - (p1.z - p0.z) * ri.ux) / den;
    return { x: p0.x + ri.ux * t, z: p0.z + ri.uz * t, t, u };
}

/**
 * @returns {{trims:Map<number,{A:number,B:number}>, built:number, caps:number}} trims feed straight back into skinRoad.
 */
export function buildJunctions(sinks, doc, fairById, S) {
    const trims = new Map();
    const byNode = new Map();
    for (const road of doc.roads) {
        if (road.noJunction) continue;
        const fair = fairById.get(road.id);
        if (!fair) continue;
        const prof = getProfile(road.profile);
        for (const which of ['A', 'B']) {
            const nid = road['node' + which];
            if (nid == null) continue;
            if (road.noJunctionEnd && road.noJunctionEnd[which]) continue;   // [-] bridge abutments and similar hard edges
            const fr = endFrame(fair, which, 16);
            if (!byNode.has(nid)) byNode.set(nid, []);
            byNode.get(nid).push({
                id: road.id, end: which, road, prof,
                x: fr.x, z: fr.z, ux: fr.ux, uz: fr.uz, rx: fr.rx, rz: fr.rz,
                wL: Math.max(0.6, prof.roadHalf[0]), wR: Math.max(0.6, prof.roadHalf[1]),
                walkW: Math.max(1.3, Math.max(-prof.tMin - prof.roadHalf[0], prof.tMax - prof.roadHalf[1])),
                rampR: road.curbRadius ?? (prof.cls === 'highway' ? 16 : prof.cls === 'arterial' ? 7.5 : prof.cls === 'collector' ? 5.5 : prof.cls === 'path' ? 1.4 : 4.2),
            });
        }
    }
    let built = 0, caps = 0;
    for (const [nid, inc] of byNode) {
        const node = doc.nodes[nid];
        if (!node) continue;
        if (inc.length === 1) { caps++; paintCulDeSac(sinks, node, inc[0], trims, S); continue; }
        if (inc.length === 2 && throughRun(inc[0], inc[1])) continue;   // [-] straight through-run: the two roads meet flush, no patch
        built++;
        const ring = solveJunction(node, inc, S);
        paintPatch(sinks, node, ring, S);
        for (const r of ring) {
            const cur = trims.get(r.id) || {};
            cur[r.end] = Math.max(cur[r.end] ?? 0, r.d);
            trims.set(r.id, cur);
        }
    }
    return { trims, built, caps };
}

const throughRun = (a, b) => Math.abs(Math.atan2(a.ux * b.uz - a.uz * b.ux, a.ux * b.ux + a.uz * b.uz)) > Math.PI - 0.10;

/** Radius ⇒ tangent length ⇒ trim distance, twice — it converges on the second pass. */
function solveJunction(node, inc, S) {
    const ring = inc.slice().sort((a, b) => Math.atan2(a.uz, a.ux) - Math.atan2(b.uz, b.ux));
    const n = ring.length;
    const corners = new Array(n);
    for (const r of ring) r.d = 1.4;
    for (let pass = 0; pass < 3; ++pass) {
        for (let i = 0; i < n; ++i) {
            const ri = ring[i], rj = ring[(i + 1) % n];
            const hit = kerbLineHit(node, ri, rj);
            const phi = Math.acos(clamp(ri.ux * rj.ux + ri.uz * rj.uz, -0.999, 0.999)); // [rad] between the outward directions
            const r = clamp(ri.rampR * (S.curbRadius ?? 1), 1.2, 18);
            const t = Math.min(30, r / Math.max(0.32, Math.tan(Math.max(0.30, Math.PI - phi) * 0.5)));
            corners[i] = { hit, phi, t, r };
            if (hit) { ri.d = Math.max(ri.d, hit.t + t); rj.d = Math.max(rj.d, -hit.u + t); }
        }
        for (const r of ring) r.d = clamp(r.d, 1.4, 44);
    }
    ring.corners = corners;
    return ring;
}

function paintPatch(sinks, node, ring, S) {
    const n = ring.length, corners = ring.corners;
    const pts = [], arcs = [], cc = [];
    for (let i = 0; i < n; ++i) {
        const ri = ring[i], rj = ring[(i + 1) % n], c = corners[i] || {};
        const B = { x: ri.x + ri.ux * ri.d - ri.rx * ri.wL, z: ri.z + ri.uz * ri.d - ri.rz * ri.wL };
        const A = { x: rj.x + rj.ux * rj.d + rj.rx * rj.wR, z: rj.z + rj.uz * rj.d + rj.rz * rj.wR };
        const Q = c.hit || { x: node.x, z: node.z };
        cc.push({ A, B, Q, ri, rj, r: c.r ?? 4 });
    }
    for (let i = 0; i < n; ++i) {
        const c = cc[i];
        pts.push({ x: c.ri.x + c.ri.ux * c.ri.d + c.ri.rx * c.ri.wR, z: c.ri.z + c.ri.uz * c.ri.d + c.ri.rz * c.ri.wR });
        pts.push(c.B);
        const N = clamp(Math.round(c.r * 0.8), 4, 18);
        const arc = [];
        for (let k = 0; k <= N; ++k) {
            const t = k / N, u = 1 - t;
            arc.push({ x: u * u * c.B.x + 2 * u * t * c.Q.x + t * t * c.A.x, z: u * u * c.B.z + 2 * u * t * c.Q.z + t * t * c.A.z });
        }
        arcs.push(arc);
    }
    if (pts.length < 4) return;
    const flat = [];
    for (const p of pts) flat.push(p.x, p.z);
    let idx; try { idx = earcut(flat); } catch { return; }
    const tally = new Map();
    for (const r of ring) { const m = nearestBand(r.prof, 0); tally.set(m, (tally.get(m) || 0) + 1); }
    let mat = MAT.ASPHALT, best = -1;
    for (const [m, c] of tally) if (c > best) { best = c; mat = m; }
    const y = (node.y ?? 0) + 0.005 + groundY(node.x, node.z, S);
    for (let t = 0; t < idx.length; t += 3) tri(sinks, pts[idx[t]], pts[idx[t + 1]], pts[idx[t + 2]], y, { mat, tint: TINT.NONE, sym: SYM.NONE, flags: FLAG.PATCH });
    for (let i = 0; i < arcs.length; ++i) {
        const c = cc[i];
        const wWalk = Math.max(c.ri.walkW, c.rj.walkW, 1.5) * 1.06 + 0.25;
        const wm = walkMaterial(c.ri.prof) === walkMaterial(c.rj.prof) ? walkMaterial(c.ri.prof) : MAT.CONCRETE_SLAB;
        sweepRibbon(sinks, arcs[i], wWalk, node, wm, 0.15, y + 0.008);
    }
}

function nearestBand(prof, t) {
    let bd = Infinity, m = MAT.ASPHALT;
    for (const s of prof.segs) {
        if (Math.abs(s.t1 - s.t0) < 0.05) continue;
        const a = Math.min(s.t0, s.t1), b = Math.max(s.t0, s.t1);
        const d = Math.abs(clamp(t, a, b) - t);
        if (d < bd) { bd = d; m = s.mat; }
    }
    return m;
}
const WALKY = new Set([MAT.CONCRETE_SLAB, MAT.PAVER, MAT.BRICK_RUNNING, MAT.BRICK, MAT.BRICK_RED, MAT.STONE_SETT, MAT.TILE, MAT.TIMBER]);
function walkMaterial(prof) {
    for (let i = prof.segs.length - 1; i >= 0; --i) if (WALKY.has(prof.segs[i].mat)) return prof.segs[i].mat;
    return MAT.CONCRETE_SLAB;
}

/** Ribbon swept outward along a polyline: kerb face on the inside, paved top, ends tapered into the adjoining footway. */
function sweepRibbon(sinks, line, wOut, node, walkMat, h, y) {
    const n = line.length;
    if (n < 2) return;
    const kerb = { mat: MAT.CURB, tint: TINT.NONE, sym: SYM.NONE, m0: 0, m1: 0, per: 0, sf: 0, bA: 0, bB: 0, L: n };
    const walk = { ...kerb, mat: walkMat };
    for (let i = 0; i + 1 < n; ++i) {
        const a = line[i], b = line[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        let ox = dz, oz = -dx;
        if (ox * (a.x - node.x) + oz * (a.z - node.z) < 0) { ox = -ox; oz = -oz; }
        const taper = 0.6 + 0.4 * Math.min(1, Math.min(i, n - 2 - i) / 1.5);
        const w = wOut * taper;
        const P = (p, off, up) => ({ x: p.x + ox * off, y: y + up, z: p.z + oz * off });
        const a0 = P(a, 0, 0), a1 = P(a, 0, h), a2 = P(a, w, h);
        const b0 = P(b, 0, 0), b1 = P(b, 0, h), b2 = P(b, w, h);
        quad(sinks, a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z,
            { sA: i, sB: i + 1, t0: -0.02, t1: 0.02, ...kerb, flags: FLAG.FACE | FLAG.RAMP });
        quad(sinks, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z,
            { sA: i, sB: i + 1, t0: 0, t1: w, ...walk, flags: FLAG.RAMP, up: 1 });
    }
}

/** Hammerhead head at an unconnected road end, so dead ends are paved rather than sheared off. */
function paintCulDeSac(sinks, node, inc, trims, S = DEFAULTS) {
    const r = Math.max(5.2, inc.prof.roadHalf[1] + 4.2);
    const cx = node.x - inc.ux * (r * 0.7), cz = node.z - inc.uz * (r * 0.7);
    const a0 = Math.atan2(-inc.uz, -inc.ux);
    const N = 20, pts = [{ x: cx, z: cz }];
    for (let i = 0; i <= N; ++i) { const a = a0 + Math.PI * (i / N); pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }); }
    const y = (node.y ?? 0) + 0.004 + groundY(node.x, node.z, S);
    const mat = nearestBand(inc.prof, 0);
    for (let i = 1; i + 1 < pts.length; ++i) tri(sinks, pts[0], pts[i], pts[i + 1], y, { mat, tint: TINT.NONE, sym: SYM.NONE, flags: FLAG.PATCH });
    const kerbMat = inc.prof.segs.some((s) => s.mat === MAT.CURB) ? MAT.CURB : walkMaterial(inc.prof);
    sweepRibbon(sinks, pts.slice(1), Math.max(1.5, inc.walkW), { x: cx, z: cz }, kerbMat, 0.15, y + 0.006);
    const cur = trims.get(inc.id) || {}; cur[inc.end] = 0.25; trims.set(inc.id, cur);
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  Ground plane and block interiors
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function buildGround(sinks, S) {
    const R = S.world, step = S.groundGrid;
    const band = { mat: MAT.DIRT, tint: TINT.NONE, sym: SYM.NONE, m0: 0, m1: 0, per: 0, sf: 0, flags: 0, bA: 0, bB: 0, L: 1 };
    const py = (px, pz) => -0.12 + (S.amp ? terrainY(px, pz, S.amp, S.seed) : 0);
    for (let x = -R; x < R - 1; x += step) {
        for (let z = -R; z < R - 1; z += step) {
            const x1 = Math.min(x + step, R), z1 = Math.min(z + step, R);
            quad(sinks, x, py(x, z), z, x1, py(x1, z), z, x1, py(x1, z1), z1, x, py(x, z1), z1,
                { sA: x, sB: x1, t0: z, t1: z1, ...band, up: 1 });
        }
    }
}

export function buildLots(sinks, doc, S = DEFAULTS) {
    const tri0 = [];
    for (const lot of doc.lots || []) {
        const poly = lot.p;
        if (!poly || poly.length < 3) continue;
        const flat = [];
        for (const q of poly) flat.push(q.x, q.z);
        let idx; try { idx = earcut(flat); } catch { continue; }
        const o = { mat: lot.mat ?? MAT.DIRT, tint: TINT.NONE, sym: SYM.NONE, flags: 0 };
        const authored = lot.y != null;
        for (let t = 0; t < idx.length; t += 3) {
            const a = poly[idx[t]], b = poly[idx[t + 1]], c = poly[idx[t + 2]];
            const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
            const y = (authored ? lot.y : 0.03) + (lot.flat || lot.y === -1.1 ? 0 : groundY(cx, cz, S));
            tri0.push(y);
            tri(sinks, a, b, c, y, o);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  World build
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Bake a document into sector-packed geometry. Pure — the same document and settings give byte-identical buffers, which is what lets the editor
 * re-run it in a worker and diff sectors against what is already on the GPU.
 * @param {{roads:Array,nodes:Object,lots?:Array}} doc
 */
export function buildWorld(doc, settings = {}) {
    const S = { ...DEFAULTS, ...settings };
    const t0 = nowMs();
    const sinks = new Sectors(S.sector);
    const fairById = new Map();
    for (const road of doc.roads) { const f = fairRoad(road, S); if (f) fairById.set(road.id, f); }
    // A junction is flat across its mouth, so node elevation wins over the per-road ends.
    const yOf = (road, which) => {
        const nid = road['node' + which];
        if (nid != null && doc.nodes[nid] && doc.nodes[nid].y != null) return doc.nodes[nid].y;
        return road[which === 'A' ? 'y0' : 'y1'] ?? null;
    };
    if (S.crossing) resolveClashes(doc, S);
    const j = buildJunctions(sinks, doc, fairById, S);
    const cache = new Map();
    let roads = 0, metres = 0, verts = 0;
    for (const road of doc.roads) {
        const fair = fairById.get(road.id);
        if (!fair) continue;
        const tr = j.trims.get(road.id) || {};
        const r = skinRoad(sinks, road, fair, S, {
            trimA: tr.A ?? 0, trimB: tr.B ?? 0,
            juncA: (tr.A ?? 0) > 0.5, juncB: (tr.B ?? 0) > 0.5,
            yA: yOf(road, 'A'), yB: yOf(road, 'B'),
        });
        if (road.electrified && r.st.length > 1) emitCatenary(sinks, r.st, r.len, [-2.15, 2.15]);
        if (r.st && r.st.length > 1) cache.set(road.id, { st: r.st, prof: r.prof, road, juncA: (tr.A ?? 0) > 0.5, juncB: (tr.B ?? 0) > 0.5 });
        roads++; metres += r.len;
    }
    buildLots(sinks, doc, S);
    buildTransit(sinks, doc, S);
    if (S.ground !== false) buildGround(sinks, S);
    let propResult = null;
    if (S.props) propResult = buildProps(doc, S, cache);
    const sectors = sinks.finish();
    for (const s of sectors) verts += s.verts;
    return {
        sectors,
        props: propResult ? propResult.props : null,
        propStats: propResult ? propResult.stats : null,
        stats: {
            ms: Math.round(nowMs() - t0), roads, km: metres / 1000, verts,
            tris: sectors.reduce((a, s) => a + s.tris, 0), sectors: sectors.length,
            junctions: j.built, culsac: j.caps,
        },
    };
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

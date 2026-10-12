//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/PropSolver.js — Street furniture, derived from the section rather than from a profile name
//============================================================================================================================================
// Every rule here reads the *resolved cross-section* — where the kerb is, whether a footway exists, which band is the bus lane, what the design
//    speed is — so a hand-authored profile gets the same lamps, drains, trees and signage as a generated one, and editing the section moves the
//    furniture with it. Output is instanced records bucketed into macro cells (three sectors wide) so the renderer culls groups of props instead of
//    individual bollards; the geometry, and therefore the triangle budget per type, lives in the presentation layer.
'use strict';

import { getProfile, profileSpeed, profileIsHard, MAT, MARK, SYM, TINT } from './ProfileSolver.js';
import { hash3, clamp, terrainY } from './CurveKit.js';

/** Sign plates, indexed into the sign atlas. Keep in sync with Presentation/SignAtlas.js, which draws them in this order. */
export const SIGN = {
    STOP: 0, YIELD: 1, SPEED20: 2, SPEED30: 3, SPEED40: 4, SPEED50: 5, SPEED60: 6, SPEED80: 7, SPEED100: 8,
    ONEWAY: 9, NOPARKING: 10, BUSLANE: 11, BIKE: 12, PEDESTRIAN: 13, TRAM: 14, ROUNDABOUT: 15, RAILCROSS: 16,
    SCHOOL: 17, DEADEND: 18, KEEPLEFT: 19, TAXI: 20, SLOW: 21, ZONE20: 22, HEIGHT: 23, CROSSWALK: 24, NOENTRY: 25,
    GIVEWAY: 26, MERGE: 27, WORKS: 28, HUMP: 29, BUSSTOP: 30, ONEWAY_R: 31,
};
export const SPEED_SIGN = { 20: SIGN.SPEED20, 30: SIGN.SPEED30, 40: SIGN.SPEED40, 50: SIGN.SPEED50, 60: SIGN.SPEED60, 80: SIGN.SPEED80, 100: SIGN.SPEED100 };

/** Prop catalogue: lod tier (0 close-only, 1 mid, 2 far) and the anchor height the geometry is authored around. */
export const PROPS = {
    bollard: { lod: 0 }, bin: { lod: 0 }, bench: { lod: 0 }, hydrant: { lod: 0 }, meter: { lod: 0 }, rack: { lod: 0 },
    manhole: { lod: 0 }, drain: { lod: 0 }, cabinet: { lod: 0 }, planter: { lod: 0 }, vent: { lod: 0 }, beacon: { lod: 1 },
    fence: { lod: 1 }, gate: { lod: 1 }, crossbuck: { lod: 1 }, shelter: { lod: 1 }, busFlag: { lod: 1 }, subwayIn: { lod: 1 },
    tree: { lod: 2 }, lamp: { lod: 2 }, lampSmall: { lod: 2 }, sign: { lod: 2 }, flasher: { lod: 2 }, mast: { lod: 2 },
    pier: { lod: 2 }, trafficLight: { lod: 2 }, lampGlow: { lod: 2, glow: 1 }, tunnelLight: { lod: 1, glow: 1 },
};
export const PROP_TYPES = Object.keys(PROPS);

export class PropSink {
    /** @param {number} macro tile size in metres for culling buckets */
    constructor(macro) { this.macro = macro || (PROPS.macro = 660); this.byType = new Map(); this.count = 0; }
    add(type, x, y, z, yaw = 0, scale = 1, cell = 0, color = 0, extra = 0) {
        const m = this.macro;
        const key = type + ':' + Math.floor(x / m) + ':' + Math.floor(z / m);
        let a = this.byType.get(key);
        if (!a) { a = []; a.type = type; a.mx = Math.floor(x / m); a.mz = Math.floor(z / m); this.byType.set(key, a); }
        a.push(x, y, z, yaw, scale, cell, color, extra);
        this.count++;
    }
    /** @returns {{types: Array, count: number}} instances grouped by (type, macro-cell) for one draw call each. */
    finish() {
        const groups = new Map();
        for (const a of this.byType.values()) {
            const g = groups.get(a.type) || { type: a.type, cells: [] };
            const data = new Float32Array(a);
            g.cells.push({ mx: a.mx, mz: a.mz, count: data.length / 8, data });
            groups.set(a.type, g);
        }
        return { macro: this.macro, types: Array.from(groups.values()), count: this.count };
    }
}

/* ── section facts ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * @typedef {{kerb:(?number)[],walk:(?number)[],outer:number[],bike:number[],bus:number[],park:number[],pit:number[],median:number[],
 *            hard:boolean,speed:number,rail:boolean,water:boolean,metro:boolean}} Features
 * Everything the prop rules need, read off the resolved section so custom profiles behave sensibly.
 */
const WALKY = new Set([MAT.PAVER, MAT.BRICK, MAT.BRICK_RED, MAT.STONE_SETT, MAT.TILE, MAT.COBBLE, MAT.CONCRETE_SLAB, MAT.CONCRETE, MAT.BRICK_RUNNING]);
const featureCache = new Map();
export function features(prof) {
    let f = featureCache.get(prof.def.id);
    if (f) return f;
    const edge = Math.max(Math.abs(prof.roadHalf[0]), Math.abs(prof.roadHalf[1]));
    f = {
        kerb: [null, null], walk: [null, null], outer: [prof.tMin, prof.tMax],
        bike: [], bus: [], park: [], pit: [], median: [], hard: profileIsHard(prof.def), speed: profileSpeed(prof.def),
        rail: !!prof.rail, water: !!prof.water, metro: !!prof.metro,
    };
    for (const s of prof.segs) {
        if (s.fall !== 0) continue;                                    // [-] a crowned band's centre is not a usable offset
        const mid = 0.5 * (s.t0 + s.t1), side = mid >= 0 ? 1 : 0;
        if (s.mat === MAT.CURB && f.kerb[side] == null && Math.abs(mid) > edge - 0.6) f.kerb[side] = mid + (side ? 0.3 : -0.3);
        if (WALKY.has(s.mat) && Math.abs(mid) > edge && f.walk[side] == null) f.walk[side] = mid;
        if (s.sym === SYM.BIKE || s.sym === SYM.CHEV) f.bike.push(mid);
        if (s.mat === MAT.OXIDE || s.mat === MAT.RUBBER) f.bus.push(mid);
        if (s.m0 === MARK.PARKBAY || s.m1 === MARK.PARKBAY) f.park.push(mid);
        if ((s.mat === MAT.GRAVEL || s.mat === MAT.GRATE) && Math.abs(mid) > edge && s.t1 - s.t0 < 2.4) f.pit.push(mid);
        if (Math.abs(mid) < 3 && s.t1 - s.t0 > 0.4 && (s.mat === MAT.GRASS || s.mat === MAT.CONCRETE || s.mat === MAT.TARMAC)) f.median.push(mid);
    }
    if (f.kerb[1] == null && prof.roadHalf[1] > 0.5) f.kerb[1] = prof.roadHalf[1];
    if (f.kerb[0] == null && prof.roadHalf[0] < -0.5) f.kerb[0] = prof.roadHalf[0];
    if (f.walk[1] == null && prof.walkH[1] > 0.02) f.walk[1] = 0.5 * (prof.tMax + (f.kerb[1] ?? prof.roadHalf[1]));
    if (f.walk[0] == null && prof.walkH[0] > 0.02) f.walk[0] = 0.5 * (prof.tMin + (f.kerb[0] ?? prof.roadHalf[0]));
    featureCache.set(prof.def.id, f);
    return f;
}

/* ── the pass ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * @param {object} doc
 * @param {object} S bake settings
 * @param {Map<number,{st:Array,prof:object,road:object,juncA:boolean,juncB:boolean}>} cache skinned roads, with their stations
 * @returns {{props:object,stats:object}}
 */
export function buildProps(doc, S, cache) {
    const out = new PropSink(S.propMacro || 660);
    const on = { lamps: S.propsLamps ?? 1, signs: S.propsSigns ?? 1, trees: S.propsTrees ?? 1, rail: S.propsRail ?? 1, drainage: S.propsDrainage ?? 1, lots: S.propsLots ?? 1 };
    let roads = 0;
    for (const { st, prof, road, juncA, juncB } of cache.values()) {
        if (!st || st.length < 2) continue;
        roads++;
        const f = features(prof);
        const L = st[st.length - 1].s;
        const seed = road.id;
        if (prof.water) { riverside(out, st, prof, road); continue; }
        furniture(out, st, prof, f, road, { juncA, juncB, L, seed, on, S });
        if (f.rail && on.rail) railway(out, st, prof, f, road, S);
    }
    if (on.lots) blocks(out, doc, S);
    if (on.rail) transit(out, doc, S);
    const r = out.finish();
    return { props: r, stats: { propInstances: r.count, propRoads: roads } };
}

/** Generic street furniture, placed by walking the trimmed stations. */
function furniture(out, st, prof, f, road, c) {
    const walkable = f.walk[0] != null || f.walk[1] != null;
    const kerbOrEdge = (side) => (f.walk[side] ?? f.kerb[side] ?? (side ? prof.tMax : prof.tMin));
    const at = (p, t) => ({ x: p.x + p.nx * t, z: p.z + p.nz * t });
    const yOf = (p, t) => p.base + prof.heightAt(t);
    const stepFor = (base) => base * (c.S.propDensity ?? 1);

    let acc = 0, nextLamp = stepFor(18), side = 1, n = 0;
    let acc2 = 0, nextDrain = 22, acc3 = 0, nextMan = 34, acc4 = 0, nextWalk = stepFor(46), acc5 = 0, nextBike = 52, acc6 = 0, nextPark = 26, nextBin = 38;
    const lampSpacing = prof.cls === 'highway' ? 34 : prof.cls === 'arterial' ? 28 : prof.cls === 'path' ? 16 : 21;
    const big = prof.cls === 'highway' || prof.cls === 'arterial';
    for (let i = 1; i < st.length; ++i) {
        const P = st[i], Q = st[i - 1];
        const d = Math.hypot(P.x - Q.x, P.z - Q.z);
        acc += d; acc2 += d; acc3 += d; acc4 += d; acc5 += d; acc6 += d;
        const yaw = Math.atan2(P.tx, P.tz);
        if (c.on.lamps && acc >= nextLamp) {
            nextLamp = acc + lampSpacing;
            for (const sgn of [side, -side]) {
                const t = sgn > 0 ? kerbOrEdge(1) + 0.55 : kerbOrEdge(0) - 0.55;
                const p = at(P, t), y = yOf(P, t);
                if (prof.cls === 'path') out.add('lampSmall', p.x, y, p.z, yaw, 1, 0, 0, 0);
                else out.add(big ? 'lamp' : 'lampSmall', p.x, y, p.z, yaw, 1, 0, 0, 0);
                const gh = prof.cls === 'path' ? 4.1 : big ? 7.7 : 5.7;
                out.add('lampGlow', p.x + P.nx * (sgn > 0 ? -1.15 : 1.15), y + gh, p.z + P.nz * (sgn > 0 ? -1.15 : 1.15), yaw, 1, 0, 0, 0);
            }
            side = -side;
        }
        if (c.on.drainage && f.hard && acc2 >= nextDrain) {
            nextDrain = acc2 + 22 + hash3(road.id, i, 3) * 6;
            for (const sgn of [-1, 1]) {
                const kt = sgn > 0 ? f.kerb[1] : f.kerb[0];
                if (kt == null) continue;
                const t = kt - sgn * 0.42, p = at(P, t);
                out.add('drain', p.x, yOf(P, t), p.z, yaw, 1, 0, 0, 0);
            }
        }
        if (c.on.drainage && prof.cls !== 'path' && acc3 >= nextMan) {
            nextMan = acc3 + 30 + hash3(road.id, i, 4) * 24;
            for (const sgn of [-1, 1]) {
                const half = sgn > 0 ? prof.roadHalf[1] : prof.roadHalf[0];
                const t = half * 0.45, p = at(P, t);
                out.add('manhole', p.x, yOf(P, t), p.z, yaw, 0.9 + hash3(road.id, i, 5) * 0.3, 0, 0, 0);
                if (hash3(road.id, i, 6) > 0.72) out.add('manhole', p.x, yOf(P, t), p.z, yaw + 1.1, 0.62, 1, 0, 0);
            }
        }
        if (c.on.lamps && walkable && acc4 >= nextWalk) {
            nextWalk = acc4 + 46 + hash3(road.id, i, 7) * 26;
            const sgn = hash3(road.id, i, 8) > 0.5 ? 1 : -1;
            const t = sgn > 0 ? f.walk[1] ?? kerbOrEdge(1) + 1.4 : f.walk[0] ?? kerbOrEdge(0) - 1.4;
            const p = at(P, t), y = yOf(P, t);
            if (prof.cls !== 'path') out.add('bench', p.x, y, p.z, yaw + (sgn > 0 ? Math.PI : 0), 1, 0, 0, 0);
            out.add('bin', p.x + P.tx * 3.2, y, p.z + P.tz * 3.2, yaw, 1, 0, sgn > 0 ? 1 : 2, 0);
            if (hash3(road.id, i, 9) > 0.75) out.add('cabinet', p.x - P.tx * 2, y, p.z - P.tz * 2, yaw, 1, 0, 0, 0);
        }
        if (c.on.lamps && walkable && acc6 >= nextBin) {
            nextBin = acc6 + 38;
            const t = (f.walk[0] ?? -1) - 1.8;
            const p = at(P, t);
            out.add('hydrant', p.x, yOf(P, t), p.z, yaw, 1, 0, 0, 0);
        }
        if (f.bike.length && c.on.lamps && acc5 >= nextBike) {
            nextBike = acc5 + 52 + hash3(road.id, i, 10) * 20;
            const t = (f.walk[1] ?? prof.tMax - 0.8) - 1.2;
            const p = at(P, t);
            out.add('rack', p.x, yOf(P, t), p.z, yaw, 1, 0, 0, 0);
        }
        if (f.park.length && c.on.lamps && acc6 >= nextPark && Math.abs(acc6 - nextPark) < 12) {
            nextPark = acc6 + 24;
            const t = f.park[0] + (f.park[0] > 0 ? -1.1 : 1.1);
            const p = at(P, t);
            out.add('meter', p.x, yOf(P, t), p.z, yaw, 1, 0, 0, 0);
        }
        // tree pits are authored in the section — the pits themselves are geometry, the trees are instances on top of them
        if (c.on.trees && f.pit.length) {
            for (const t of f.pit) {
                const centre = Math.round((P.s - 4.25) / 8.5) !== Math.round((Q.s - 4.25) / 8.5);
                if (!centre) continue;
                const p = at(P, t);
                out.add('tree', p.x, yOf(P, t) - 0.06, p.z, yaw + hash3(road.id, n, 11) * 6.28, 0.82 + hash3(road.id, n, 12) * 0.4, 0, Math.floor(hash3(road.id, n, 13) * 3), t);
            }
        }
        if (c.on.trees && f.median.length && prof.def.id === 'BLVD-TREE') {
            if (Math.round(P.s / 11) !== Math.round(Q.s / 11)) {
                const t = f.median[0], p = at(P, t);
                out.add('tree', p.x, yOf(P, t) - 0.02, p.z, hash3(road.id, n, 14) * 6.28, 0.9 + hash3(road.id, n, 15) * 0.3, 0, 1, 0);
            }
        }
        n++;
    }
    // chicanes / narrowing planters on shared surfaces
    if (prof.def.id === 'CALLE-30' || prof.def.id === 'PROMENADE' || prof.def.id === 'PATH-PEDE') {
        const spacing = prof.def.id === 'CALLE-30' ? 52 : 34;
        for (let i = 1; i < st.length; ++i) {
            const P = st[i], Q = st[i - 1];
            if (Math.floor(P.s / spacing) === Math.floor(Q.s / spacing)) continue;
            const sgn = Math.round(P.s / spacing) % 2 ? 1 : -1;
            const t = sgn * (Math.abs(prof.roadHalf[0]) + 1.1);
            const p = at(P, t);
            out.add('planter', p.x, yOf(P, t), p.z, Math.atan2(P.tx, P.tz), 1, 0, 0, 0);
            out.add('bollard', p.x - P.nx * 2.4, yOf(P, t - sgn * 2.4), p.z - P.nz * 2.4, 0, 1, 0, 0, 0);
        }
    }
    // bollards across the mouth of every pedestrian route at a junction, and along shared surfaces
    if ((prof.cls === 'path' || prof.def.id === 'PROMENADE' || prof.def.id === 'BOARDWALK') && (c.juncA || c.juncB)) {
        for (const which of [[c.juncA, 0], [c.juncB, st.length - 1]]) {
            if (!which[0]) continue;
            const P = st[clamp(which[1], 0, st.length - 1)];
            for (let k = -2; k <= 2; ++k) {
                const t = k * 1.6;
                if (Math.abs(t) > Math.max(prof.width * 0.5, 2.2)) continue;
                const p = at(P, t);
                if (k === 0 && prof.cls === 'path') continue;             // [-] leave a gap for maintenance vehicles
                out.add('bollard', p.x, yOf(P, t), p.z, 0, 1, 0, 0, 0);
            }
        }
    }
    if (c.on.signs) signage(out, st, prof, f, road, c);
    if (prof.metro || prof.cls === 'street') transitStreets(out, st, prof, road, f);
}

/** Regulatory and warning plates: a limit at the start, priority at the mouth, and event signs for humps, crossings and bus lanes. */
function signage(out, st, prof, f, road, c) {
    const yOf = (p, t) => p.base + prof.heightAt(t);
    const at = (p, t) => ({ x: p.x + p.nx * t, z: p.z + p.nz * t });
    const cls = prof.cls;
    const limit = SPEED_SIGN[Math.round(f.speed / 10) * 10] ?? SPEED_SIGN[50];
    for (const end of [['A', 1, c.juncA], ['B', -2, c.juncB]]) {
        const [which, off, hasJ] = end;
        if (!hasJ) continue;
        const P = st[clamp(off, 0, st.length - 1)];
        const yaw = Math.atan2(P.tx, P.tz) + (which === 'A' ? Math.PI : 0);
        for (const sgn of [-1, 1]) {
            const kerb = sgn > 0 ? (f.kerb[1] ?? prof.tMax) : (f.kerb[0] ?? prof.tMin);
            const p = at(P, kerb + sgn * 0.75), y = yOf(P, kerb + sgn * 0.75);
            const cell = cls === 'path' || cls === 'service' ? SIGN.YIELD : (road.id + (which === 'A' ? 1 : 0)) % 3 === 0 && sgn < 0 ? SIGN.YIELD : SIGN.STOP;
            out.add('sign', p.x, y, p.z, yaw, 1, cell, sgn > 0 ? 1 : 0, 0);
            if (prof.oneWay) out.add('sign', p.x + P.tx * 2.4, y, p.z + P.tz * 2.4, yaw, 1, SIGN.ONEWAY, 0, 0);
        }
    }
    // speed limit + hazard plates mid-block, both directions
    if (cls !== 'path' && st.length > 3) {
        for (const frac of [0.08, 0.5, 0.92]) {
            const P = st[Math.round(frac * (st.length - 1))];
            for (const sgn of [-1, 1]) {
                const kerb = sgn > 0 ? (f.kerb[1] ?? prof.tMax) : (f.kerb[0] ?? prof.tMin);
                const p = at(P, kerb + sgn * 0.7), y = yOf(P, kerb + sgn * 0.7);
                if (frac === 0.08) out.add('sign', p.x, y, p.z, Math.atan2(P.tx, P.tz) + (sgn > 0 ? Math.PI : 0), 1, limit, 0, 0);
                else if (frac === 0.5 && prof.cls === 'local' && hash3(road.id, 3, 17) > 0.6) out.add('sign', p.x, y, p.z, Math.atan2(P.tx, P.tz) + (sgn > 0 ? Math.PI : 0), 1, SIGN.SCHOOL, 0, 0);
                else if (frac === 0.5 && road.bumps && road.bumps.length) out.add('sign', p.x, y, p.z, Math.atan2(P.tx, P.tz) + (sgn > 0 ? Math.PI : 0), 1, SIGN.HUMP, 0, 0);
                else if (frac === 0.92 && f.bus.length) out.add('sign', p.x, y, p.z, Math.atan2(P.tx, P.tz) + (sgn > 0 ? Math.PI : 0), 1, SIGN.BUSLANE, 0, 0);
            }
        }
    }
    // level-crossing furniture on the street and the railway
    for (const x of road.crossings || []) {
        const P = st[nearestStation(st, x.s)];
        const nx = Math.cos(x.roadAngle), nz = -Math.sin(x.roadAngle);
        for (const sgn of [-1, 1]) {
            const edge = (sgn > 0 ? Math.max(...prof.roadHalf) : Math.min(...prof.roadHalf)) + sgn * 1.6;
            const px = P.x + P.nx * edge, pz = P.z + P.nz * edge, py = yOf(P, edge);
            out.add('crossbuck', px, py, pz, x.roadAngle + Math.PI / 2, 1, 0, 0, 0);
            if (x.flash) out.add('flasher', px + nx * sgn * 0.9, py, pz + nz * sgn * 0.9, x.roadAngle + Math.PI / 2, 1, 0, 0, 0);
            if (x.gate !== false) out.add('gate', px, py, pz, x.angle, 1, 0, sgn > 0 ? 1 : 0, x.half);
        }
    }
}
function nearestStation(st, s) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < st.length; ++i) { const d = Math.abs(st[i].s - s); if (d < bd) { bd = d; best = i; } }
    return best;
}

/** Bus stops, cycle stands and subway kiosks that belong to a street profile. */
function transitStreets(out, st, prof, road, f) {
    if (!f.bus.length) return;
    for (const frac of [0.34, 0.71]) {
        if (hash3(road.id, Math.round(frac * 100), 21) < 0.55) continue;
        const P = st[Math.round(frac * (st.length - 1))];
        const t = f.bus[0] + (f.bus[0] > 0 ? 1.1 : -1.1);
        out.add('shelter', P.x + P.nx * t, P.base + prof.heightAt(t), P.z + P.nz * t, Math.atan2(P.tx, P.tz), 1, 0, 0, 0);
        out.add('busFlag', P.x + P.nx * (t + (t > 0 ? 2.6 : -2.6)), P.base + prof.heightAt(t), P.z + P.nz * (t + (t > 0 ? 2.6 : -2.6)), Math.atan2(P.tx, P.tz), 1, 0, 0, 0);
    }
}

function riverside(out, st, prof, road) {
    for (let i = 1; i < st.length; ++i) {
        const P = st[i], Q = st[i - 1];
        if (Math.floor(P.s / 26) === Math.floor(Q.s / 26)) continue;
        for (const sgn of [-1, 1]) {
            const side2 = sgn > 0 ? 1 : 0;
            const t = sgn * (prof.walkH[side2] > 0 ? (sgn > 0 ? prof.tMax - 1.2 : prof.tMin + 1.2) : (sgn > 0 ? prof.roadHalf[1] + 1.0 : prof.roadHalf[0] - 1.0));
            const p = { x: P.x + P.nx * t, z: P.z + P.nz * t };
            out.add('bench', p.x, P.base + prof.heightAt(t), p.z, Math.atan2(P.tx, P.tz) + (sgn > 0 ? 0 : Math.PI), 1, 0, 0, 0);
            out.add('lampSmall', p.x + P.tx * 12, P.base + prof.heightAt(t), p.z + P.tz * 12, 0, 1, 0, 0, 0);
        }
    }
    void road;
}

/** Lineside: catenary masts, security fence, markers and the sleeper-free quiet bits. */
function railway(out, st, prof, f, road, S) {
    const main = prof.def.id === 'RAIL-2T' || prof.railMain;
    const half = Math.max(...prof.roadHalf.map(Math.abs));
    if (road.electrified) {
        for (let i = 1; i < st.length; ++i) {
            const P = st[i], Q = st[i - 1];
            if (Math.floor(P.s / 55) === Math.floor(Q.s / 55)) continue;
            const sgn = Math.round(P.s / 55) % 2 ? 1 : -1;
            const t = sgn * (half + 1.5);
            out.add('mast', P.x + P.nx * t, P.base + prof.heightAt(t), P.z + P.nz * t, Math.atan2(P.tx, P.tz), 1, 0, 0, sgn);
        }
    }
    if (main) {
        for (let i = 1; i < st.length; ++i) {
            const P = st[i], Q = st[i - 1];
            if (Math.floor(P.s / 3) === Math.floor(Q.s / 3)) continue;
            for (const sgn of [-1, 1]) {
                const t = sgn * (half + 0.7);
                out.add('fence', P.x + P.nx * t, P.base + prof.heightAt(t) - 0.05, P.z + P.nz * t, Math.atan2(P.tx, P.tz), 1, 0, 0, 0);
            }
        }
    }
}

/** Blocks: frontage trees and hedges along residential edges, fences around industrial and railway land. */
function blocks(out, doc, S) {
    for (let li = 0; li < (doc.lots || []).length; ++li) {
        const lot = doc.lots[li];
        if (!lot || !lot.p || lot.p.length < 3) continue;
        const zone = lot.zone || (lot.mat === MAT.GRASS ? 'park' : lot.mat === MAT.GRAVEL ? 'industrial' : 'residential');
        if (zone === 'water' || zone === 'railway') continue;
        const P = lot.p;
        let per = 0; for (let i = 1; i < P.length; ++i) per += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
        if (per > 900) continue;
        // centroid, so frontage edges can be found by distance
        let cx = 0, cz = 0; for (const p of P) { cx += p.x; cz += p.z; } cx /= P.length; cz /= P.length;
        for (let i = 0; i < P.length; ++i) {
            const A = P[i], B = P[(i + 1) % P.length];
            const dx = B.x - A.x, dz = B.z - A.z, l = Math.hypot(dx, dz);
            if (l < 6) continue;
            const ux = dx / l, uz = dz / l;
            const outward = Math.sign((A.x + dx * 0.5 - cx) * -uz + (A.z + dz * 0.5 - cz) * ux) || 1;
            const yaw = Math.atan2(ux, uz);
            if (zone === 'park' || lot.mat === MAT.GRASS) {
                if (S.propsTrees === 0) continue;
                const n = Math.min(26, Math.max(1, Math.round(l / 13)));
                for (let k = 0; k < n; ++k) {
                    const h = hash3(li, i, k);
                    if (h < 0.42) continue;
                    const d = (k + 0.5) / n * l;
                    const deep = 2 + hash3(li, i, k + 99) * 16;
                    const x = A.x + ux * d - uz * outward * deep, z = A.z + uz * d + ux * outward * deep;
                    const y = terrainY(x, z, S) + 0.05;
                    out.add('tree', x, y, z, h * 6.28, 1.05 + hash3(li, i, k + 7) * 0.85, 0, Math.floor(h * 3), 0);
                }
            } else if (zone === 'industrial' || zone === 'railway') {
                const n = Math.min(30, Math.max(1, Math.round(l / 2.9)));
                for (let k = 0; k < n; ++k) {
                    const d = (k + 0.5) / n * l;
                    const x = A.x + ux * d, z = A.z + uz * d;
                    out.add('fence', x, terrainY(x, z, S) + 0.04, z, yaw, 1, 0, 0, 0);
                }
            } else {
                // residential frontage: a hedge line and the odd garden tree, only along the road-facing edge
                if (l < 20) continue;
                const n = Math.round(l / 22);
                for (let k = 0; k < n; ++k) {
                    const h = hash3(li, i, k + 3);
                    if (h < 0.55) continue;
                    const d = (k + 0.5) / n * l;
                    const x = A.x + ux * d, z = A.z + uz * d;
                    out.add('tree', x - uz * outward * 4.5, terrainY(x, z, S) + 0.05, z + ux * outward * 4.5, h * 6.28, 0.7 + h * 0.5, 0, Math.floor(h * 3), 0);
                }
            }
        }
    }
}

/** Metro kiosks and vents at the surface, and bridge piers where a viaduct crosses open ground. */
function transit(out, doc, S) {
    for (const line of doc.transit || []) {
        if (line.kind !== 'metro' && line.kind !== 'rail') continue;
        // Kiosks sit on the street: beside the deck for a viaduct station, up the shafts for a buried one.
        const atGrade = line.mode !== 'tunnel';
        const off = atGrade ? (line.halfWidth ?? 11) + 2.8 : 13.5;
        for (const s of line.stations || []) {
            const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
            for (const side of [-1, 1]) {
                out.add('subwayIn', s.x + sa * off * side, (s.y ?? 0) + 0.06, s.z - ca * off * side, s.angle, 1, atGrade ? (side > 0 ? 1 : 2) : 0, 0, 0);
                if (!atGrade) out.add('bench', s.x + sa * (13.5 - 4) * side, (s.y ?? 0) + 0.1, s.z - ca * (13.5 - 4) * side, s.angle, 1, 0, 0, 0);
            }
        }
        if (line.mode === 'tunnel') {
            for (const align of line.alignments || []) {
                for (let i = 1; i < align.length; ++i) {
                    const A = align[i - 1], B = align[i];
                    const l = Math.hypot(B.x - A.x, B.z - A.z);
                    const n = Math.max(1, Math.round(l / 180));
                    for (let k = 0; k < n; ++k) {
                        const u = (k + 0.5) / n;
                        const x = A.x + (B.x - A.x) * u, z = A.z + (B.z - A.z) * u;
                        out.add('vent', x, terrainY(x, z, S) + 0.06, z, Math.atan2(B.x - A.x, B.z - A.z), 1, 0, 0, 0);
                        out.add('cabinet', x + 3.2, terrainY(x, z, S) + 0.06, z + 2.4, 0.4, 1, 0, 3, 0);
                    }
                }
            }
        }
    }
    // piers under every bridge deck
    for (const road of doc.roads || []) {
        if (road.struct !== 'bridge' && (road.y0 ?? 0) < 1.5) continue;
        if (!(road.points && road.points.length > 1)) continue;
        const prof = getProfile(road.profile);
        const A = road.points[0], B = road.points[road.points.length - 1];
        const span = Math.hypot(B.x - A.x, B.z - A.z);
        const lift = Math.max(road.y0 ?? 0, road.y1 ?? 0, ...road.points.map((p) => p.y || 0));
        if (lift < 1.6 || span < 24) continue;
        const n = Math.max(1, Math.round(span / 26));
        for (let k = 0; k < n; ++k) {
            const u = (k + 1) / (n + 1);
            const x = A.x + (B.x - A.x) * u, z = A.z + (B.z - A.z) * u;
            const half = Math.max(...prof.roadHalf.map(Math.abs));
            for (const sgn of [-1, 1]) {
                const nx = (B.z - A.z) / span, nz = -(B.x - A.x) / span;
                out.add('pier', x + nx * sgn * (half - 1.2), terrainY(x, z, S) - 0.6, z + nz * sgn * (half - 1.2), 0, 1, 0, 0, lift + 1.4);
            }
        }
    }
}

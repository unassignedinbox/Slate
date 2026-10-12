//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/ProfileSolver.js — Cross-section algebra: a profile is a piecewise-linear section swept by the skin pass
//============================================================================================================================================
// Everything the brief asks for — kerbs, gutters, paving, brick, cycle tracks, bus lanes, parking bays, medians, sound barriers, bridge
//    parapets, tunnel walls, quay walls — is the *same primitive*: one segment of the section polyline (t0,h0)→(t1,h1) carrying a surface
//    material, a marking code per edge and an optional lane symbol. Δt = 0 gives a vertical face, which is why there is no separate
//    "kerb/barrier" system to keep in sync. Profiles author either `sym` (right of the axis, mirrored) or `full` (left edge → right edge).
'use strict';

/** Surface material ids — the fragment shader branches on these. Order is baked into geometry, so never renumber. */
export const MAT = {
    ASPHALT: 0,          // [-] hot-rolled course, aggregate + patch stains
    ASPHALT_OLD: 1,      // [-] darker, more cracking — highways, alleys
    CONCRETE: 2,         // [-] slipform slab with saw joints
    CONCRETE_SLAB: 3,    // [-] large paving slabs (sidewalks, plazas)
    BRICK: 4,            // [-] herringbone clay pavers
    BRICK_RUNNING: 5,    // [-] running-bond clay pavers (felt)
    COBBLE: 6,           // [-] granite setts
    CURB: 7,             // [-] granite/precast kerb stone (faces and tops)
    GRAVEL: 8,           // [-] loose aggregate verges, rural shoulders
    GRASS: 9,            // [-] verge / median / tree-pit soil
    PAVER: 10,           // [-] 600×600 concrete flags (European footway)
    TILE: 11,            // [-] small mosaic tiles (promenade)
    STEEL: 12,           // [-] rails, gratings, barrier faces
    GRATE: 13,           // [-] channel grating, subway vent
    DIRT: 14,            // [-] unpainted lots, rural verge
    WATER: 15,           // [-] canal / river
    RUBBER: 16,          // [-] coloured surfacing (cycle, shared)
    OXIDE: 17,           // [-] bus-lane red oxide mastic
    PATCH: 18,           // [-] utility patch / cold-lap
    TIMBER: 19,          // [-] boardwalk deck, crossing panels
    BALLAST: 20,         // [-] track ballast with sleeper shadows
    TARMAC: 21,          // [-] fine, dark shared-use path
    BRICK_RED: 22,       // [-] red clay footway
    STONE_SETT: 23,      // [-] worn setts with kerb channels
};
export const MAT_NAME = Object.keys(MAT);
export const MAT_COLOR = {
    0: '#2c2f34', 1: '#23262a', 2: '#7d8186', 3: '#8b8f93', 4: '#a05c48', 5: '#9a5a48', 6: '#7a6f66', 7: '#a7a29a',
    8: '#6e6a62', 9: '#3f5a37', 10: '#95908a', 11: '#8d8478', 12: '#b8bcc0', 13: '#5c6063', 14: '#5a4f42', 15: '#22414f',
    16: '#2f6b4a', 17: '#7d3b32', 18: '#33373c', 19: '#8a6a48', 20: '#4f5155', 21: '#26292d', 22: '#8f4a3c', 23: '#6f6660',
};

/** Edge marking codes painted by the shader at a band edge. Kept < 64 so they survive a quantised byte. */
export const MARK = {
    NONE: 0, SOLID_W: 1, DASH_W: 2, SOLID_Y: 3, DASH_Y: 4, DOUBLE_Y: 5, FOG_W: 6, CHEVRON: 7, RUMBLE: 8, BIKE: 9,
    BUS: 10, STOP: 11, CROSSWALK: 12, PARKBAY: 13, HATCH: 14, REV: 15, RXR: 16, SLOW: 17, STOPWORD: 18, TAXI: 19,
    DOOR: 20, TRAM: 21, GUTTER_Y: 22, EDGE_Y: 23, LANE_W: 24, SCHOOLSLOW: 25, DOUBLEDASH_Y: 26, CHEVRON_DOWN: 27,
};

/** Lane symbol cells drawn from the procedurally generated marking atlas (see MarkingAtlas). */
export const SYM = { NONE: 0, ARROW_THRU: 1, ARROW_LEFT: 2, ARROW_RIGHT: 3, ARROW_THRU_LEFT: 4, ARROW_THRU_RIGHT: 5, ARROW_UTURN: 6, BIKE: 7, BUS: 8, TAXI: 9, TRAM: 10, PED: 11, DISABLED: 12, CHEV: 13, SHARE: 14, ARROW_BOTH: 15, RXR: 16, SLOW: 17, STOPWORD: 18, YIELDWORD: 19 };

export const TINT = { NONE: 0, BIKE_GREEN: 1, BIKE_RED: 2, BUS_RED: 3, PARK_GREY: 4, WARM_CONCRETE: 5, BLUE_ASPHALT: 6 };

/** The road-level materials: used by the junction builder to seat a patch flush against the carriageway. */
const ROAD_MATS = new Set([MAT.ASPHALT, MAT.ASPHALT_OLD, MAT.OXIDE, MAT.RUBBER, MAT.PATCH, MAT.STONE_SETT, MAT.COBBLE, MAT.BRICK, MAT.BRICK_RUNNING, MAT.BRICK_RED, MAT.TARMAC, MAT.CONCRETE, MAT.TIMBER,
    MAT.GRAVEL, MAT.DIRT]);      // [-] unmade roads: the whole width is the carriageway, there is no kerb line to seat against
const KERB_MATS = new Set([...ROAD_MATS, MAT.CURB, MAT.GRAVEL, MAT.GRATE, MAT.BALLAST, MAT.PAVER, MAT.TILE, MAT.CONCRETE_SLAB, MAT.DIRT, MAT.GRASS]);

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  Section builder
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
class Section {
    constructor(mode) {
        this.mode = mode;                 // [-] 'sym' (author right of axis) or 'full' (author left→right)
        this.segs = [];
        this.t = 0; this.h = 0;
        this.crown = 0.022;               // [-] normal crossfall [m/m]
        this.axisMark = MARK.DOUBLE_Y;    // [-] applied across the axis in 'sym' mode
        this.fallMats = new Set([MAT.ASPHALT, MAT.ASPHALT_OLD, MAT.OXIDE, MAT.RUBBER, MAT.CONCRETE, MAT.CONCRETE_SLAB, MAT.PATCH, MAT.TARMAC,
            MAT.STONE_SETT, MAT.COBBLE, MAT.BRICK, MAT.BRICK_RUNNING, MAT.BRICK_RED, MAT.TIMBER, MAT.PAVER, MAT.TILE, MAT.GRAVEL, MAT.DIRT, MAT.GRASS, MAT.BALLAST]);
    }
    _push(t1, h1, o) {
        if (Math.abs(t1 - this.t) < 1e-4 && Math.abs(h1 - this.h) < 1e-4) return; // [-] drop degenerate segments
        this.segs.push({
            t0: this.t, h0: this.h, t1, h1,
            mat: o.mat ?? MAT.ASPHALT,
            tint: o.tint ?? TINT.NONE,
            sym: o.sym ?? SYM.NONE,
            symPeriod: o.symPeriod ?? 24,
            symNearEnd: o.symNearEnd ? 1 : 0,
            m0: o.m0 ?? MARK.NONE, m1: o.m1 ?? MARK.NONE,
            fall: o.fall === undefined ? this.fallMats.has(o.mat ?? MAT.ASPHALT) : o.fall,
            lit: o.lit ?? 0, rough: o.rough ?? 1,
        });
        this.t = t1; this.h = h1;
    }
    /** Generic advance: `w` to the right (or left when negative), `dh` up. */
    step(w, dh, o = {}) { this._push(this.t + w, this.h + dh, o); return this; }
    flat(w, mat, o = {}) { return this.step(w, o.dh ?? 0, { ...o, mat }); }
    slope(w, dh, mat, o = {}) { return this.step(w, dh, { ...o, mat }); }
    wall(dh, mat = MAT.CURB, o = {}) { return this.step(0, dh, { ...o, mat }); }

    // ── named blocks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    lane(w = 3.4, o = {}) { return this.flat(w, o.mat ?? (o.bus ? MAT.OXIDE : MAT.ASPHALT), { tint: o.tint ?? (o.bus ? TINT.BUS_RED : TINT.NONE), sym: o.sym, symPeriod: o.symPeriod, symNearEnd: o.symNearEnd, m0: o.m0, m1: o.m1 }); }
    bike(w = 1.8, o = {}) { return this.flat(w, o.mat ?? MAT.ASPHALT, { tint: o.tint ?? TINT.BIKE_GREEN, sym: o.sym ?? SYM.BIKE, symPeriod: 30, m0: o.m0 ?? MARK.SOLID_W, m1: o.m1 ?? MARK.BIKE }); }
    parking(w = 2.4, o = {}) { return this.flat(w, MAT.ASPHALT, { tint: TINT.PARK_GREY, m0: o.m0 ?? MARK.NONE, m1: o.m1 ?? MARK.PARKBAY, sym: o.sym, symPeriod: 18 }); }
    busLane(w = 3.3, o = {}) { return this.flat(w, MAT.OXIDE, { tint: TINT.BUS_RED, sym: SYM.BUS, symPeriod: 26, m0: o.m0 ?? MARK.SOLID_Y, m1: o.m1 ?? MARK.SOLID_Y }); }
    gutter(w = 0.45, dh = -0.055, o = {}) { return this.slope(w, dh, o.mat ?? MAT.ASPHALT, { m0: o.m0, m1: o.m1 }); }
    /** Vertical kerb face + its revealed top; leaves the cursor on footway level. */
    kerb(h = 0.15, o = {}) { this.wall(o.faceH ?? h * 0.9, MAT.CURB, { fall: o.faceFall ?? false }); return this.flat(o.top ?? 0.15, o.mat ?? MAT.CURB, { fall: false }); }
    /** Back down to the carriageway (used on the far side in 'full' profiles). */
    kerbDown(h = 0.15, o = {}) { this.flat(o.top ?? 0.15, o.mat ?? MAT.CURB, { fall: false }); return this.wall(-h, MAT.CURB, { fall: false }); }
    walk(w = 2.4, o = {}) { return this.flat(w, o.mat ?? (o.brick ? MAT.BRICK_RUNNING : o.flags ? MAT.PAVER : o.sett ? MAT.STONE_SETT : MAT.CONCRETE_SLAB), { m0: o.m0, m1: o.m1, fall: false }); }
    verge(w = 1.4, o = {}) { return this.flat(w, o.mat ?? MAT.GRASS, { fall: false }); }
    treePit(w = 1.5, o = {}) { return this.flat(w, o.grate ? MAT.GRATE : MAT.GRAVEL, { fall: false }); }
    median(w = 2.6, o = {}) {
        if (o.mounted) this.wall(0.14, MAT.CURB, { fall: false });
        this.flat(w, o.mat ?? MAT.GRASS, { fall: false, m0: o.m0, m1: o.m1 });
        if (o.mounted) this.wall(-0.16, MAT.CURB, { fall: false });
        return this;
    }
    /** Concrete safety shape (Jersey / F-shape). */
    jersey(h = 0.9, o = {}) {
        const w = o.w ?? 0.6;
        this.wall(h * 0.45, MAT.CONCRETE, { fall: false });
        this.flat(w * 0.4, MAT.CONCRETE, { fall: false });
        this.wall(h * 0.55, MAT.CONCRETE, { fall: false });
        this.flat(w * 0.6, MAT.CONCRETE, { fall: false });
        return this;
    }
    guardrail(h = 0.75, o = {}) {
        if (o.berm !== 0) this.flat(o.berm ?? 0.6, o.bermMat ?? MAT.GRAVEL, { fall: false });
        this.wall(h * 0.55, o.postMat ?? MAT.CONCRETE, { fall: false });
        this.flat(0.12, MAT.STEEL, { fall: false });
        this.wall(h * 0.45, MAT.STEEL, { fall: false });
        this.flat(0.1, MAT.STEEL, { fall: false });
        this.wall(-h, MAT.STEEL, { fall: false });
        if (o.close) this.flat(0.12, MAT.CONCRETE, { fall: false });
        return this;
    }
    soundWall(h = 3.4, o = {}) { this.wall(h, o.mat ?? MAT.CONCRETE, { fall: false }); return this.flat(o.thick ?? 0.4, o.mat ?? MAT.CONCRETE, { fall: false }); }
    railing(h = 1.05, o = {}) { this.flat(o.ledge ?? 0.25, MAT.CONCRETE, { fall: false }); this.wall(h, o.mat ?? MAT.STEEL, { fall: false }); this.flat(0.1, o.mat ?? MAT.STEEL, { fall: false }); this.wall(-h, o.mat ?? MAT.STEEL, { fall: false }); return this.flat(0.25, MAT.CONCRETE, { fall: false }); }
    tunnelWall(h = 5.2, o = {}) { this.wall(h, o.mat ?? MAT.CONCRETE, { fall: false, lit: 1 }); return this.flat(o.thick ?? 0.7, MAT.CONCRETE, { fall: false }); }
    water(w = 40, o = {}) {
        const d = o.depth ?? 2.6, e = o.edge ?? MAT.CONCRETE, s = o.side ?? Math.min(4, w * 0.08);
        this.slope(s, -d, e, { fall: false }); this.flat(w - 2 * s, MAT.WATER, { fall: false }); this.slope(s, d, e, { fall: false });
        return this;
    }
    track(w = 5.0, o = {}) {        // [-] tram / metro bed in paving or ballast
        const m = o.mat ?? MAT.STONE_SETT;
        this.flat(w, m, { fall: false, m0: o.m0 ?? MARK.TRAM, m1: o.m1 ?? MARK.TRAM });
        return this;
    }
    fence(o = {}) { this.flat(o.ledge ?? 0.2, MAT.CONCRETE, { fall: false }); this.wall(o.h ?? 1.8, MAT.STEEL, { fall: false }); return this.flat(0.1, MAT.STEEL, { fall: false }); }

    /** @returns resolved {segs ordered left→right, widths, half-extents} */
    resolve(def) {
        let segs;
        if (this.mode === 'sym') {
            const left = this.segs.slice().reverse().map((s) => ({
                ...s, t0: -s.t1, h0: s.h1, t1: -s.t0, h1: s.h0, m0: s.m1, m1: s.m0,
            }));
            segs = left.concat(this.segs);
        } else segs = this.segs.slice();

        let tMin = Infinity, tMax = -Infinity;
        for (const s of segs) { tMin = Math.min(tMin, s.t0, s.t1); tMax = Math.max(tMax, s.t0, s.t1); }
        // Centre the section on the road axis unless the profile anchors on an edge.
        const shift = def.centered === false ? 0 : -(tMin + tMax) / 2;
        for (const s of segs) { s.t0 += shift; s.t1 += shift; }
        tMin += shift; tMax += shift;
        const crownT = def.crownAt === 'left' ? tMin : def.crownAt === 'right' ? tMax : typeof def.crownAt === 'number' ? def.crownAt : (tMin + tMax) / 2;
        const fall = def.crown ?? this.crown;
        for (const s of segs) { if (s.fall) { s.h0 -= fall * Math.abs(s.t0 - crownT); s.h1 -= fall * Math.abs(s.t1 - crownT); } else { s.h0 += def.h0 ?? 0; s.h1 += def.h0 ?? 0; } }

        if (this.mode === 'sym' && this.axisMark) {
            const iR = segs.findIndex((s) => s.t1 >= -1e-6);   // [-] first segment right of the axis
            if (iR > 0) segs[iR - 1].m1 = this.axisMark;
            if (iR < segs.length) segs[iR].m0 = this.axisMark;
        }
        let roadL = 0.6, roadR = 0.6, kerbL = 0.6, kerbR = 0.6, walkH = 0;
        for (const s of segs) {
            const a = Math.min(s.t0, s.t1), b = Math.max(s.t0, s.t1);
            walkH = Math.max(walkH, s.h0, s.h1);
            const road = ROAD_MATS.has(s.mat), kerb = road || KERB_MATS.has(s.mat) || s.mat === MAT.STEEL;
            if (road) { roadL = Math.max(roadL, -a); roadR = Math.max(roadR, b); }
            if (kerb) { kerbL = Math.max(kerbL, -a); kerbR = Math.max(kerbR, b); }
        }
        if (def.cls === 'path' || def.centered === 'full') { roadL = -tMin; roadR = tMax; }
        const heightAt = (t) => {
            let best = 0, bd = Infinity;
            for (const s of segs) {
                const a = Math.min(s.t0, s.t1), b = Math.max(s.t0, s.t1);
                const d = t < a ? a - t : t > b ? t - b : 0;
                if (d < bd) { bd = d; const u = b - a < 1e-6 ? 0.5 : (t - a) / (b - a); best = (s.t0 <= s.t1 ? s.h0 + (s.h1 - s.h0) * u : s.h1 + (s.h0 - s.h1) * u); }
            }
            return best;
        };
        return {
            id: def.id, name: def.name, cls: def.cls, tags: def.tags || [], def, heightAt,
            segs, tMin, tMax, width: tMax - tMin,
            roadHalf: [roadL, roadR], kerbHalf: [kerbL, kerbR], walkH,
            oneWay: !!def.oneWay, water: !!def.water, rail: !!def.rail, metro: !!def.metro, ramp: !!def.ramp, bumps: def.bumps || 0,
        };
    }
}

const profile = (id, cls, name, mode, body, o = {}) => ({ id, cls, name, mode, body, ...o });

export const PROFILES = [
    // ── local / residential ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
    profile('RES-2', 'local', 'Residential · 2 lanes, kerbside parking, footway', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.lane(3.2).parking(2.3).gutter().kerb().walk(2.2, { flags: 1 }).verge(0.8);
    }, { tags: ['parking', 'quiet'] }),
    profile('RES-2B', 'local', 'Residential · bays + advisory cycle lanes', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.lane(3.1).parking(2.3).bike(1.7, { m1: MARK.DASH_W }).gutter().kerb().walk(2.0).treePit(1.2).walk(0.6);
    }, { tags: ['bike', 'parking'] }),
    profile('RES-CONN', 'local', 'Connector · 2 lanes, cycle lanes, footway', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.lane(3.3, { m1: MARK.SOLID_W }).bike(1.8).gutter().kerb().walk(2.6, { flags: 1 });
    }),
    profile('RES-CUL', 'local', 'Cul-de-sac · narrow, shared surface', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.015;
        s.lane(3.0).flat(1.2, MAT.BRICK).flat(0.16, MAT.CURB, { fall: false }).walk(1.4, { flags: 1 });
    }),
    profile('COL-2', 'collector', 'Collector · 2 lanes, gutters, tree belt', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.lane(3.4).gutter(0.5, -0.06).kerb().walk(2.6, { flags: 1 }).treePit(1.4, { grate: 1 }).walk(0.8);
    }),
    profile('COL-2B', 'collector', 'Collector · buffered cycle lanes', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.lane(3.3).flat(0.5, MAT.ASPHALT, { m0: MARK.SOLID_W, m1: MARK.SOLID_W }).bike(1.9).gutter().kerb().walk(2.6, { flags: 1 });
    }),
    profile('COL-PARKWAY', 'collector', 'Parkway · single carriageway, meandering, no kerb', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.03;
        s.lane(3.2, { m1: MARK.EDGE_Y }).flat(0.9, MAT.GRAVEL, { fall: false }).verge(2.4).flat(1.6, MAT.TARMAC, { fall: false, sym: SYM.BIKE, symPeriod: 24 });
    }, { tags: ['scenic', 'park'] }),
    // ── arterial ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    profile('ART-2', 'arterial', 'Arterial · 1 lane per side, parking, cycle lane', 'sym', (s) => {
        s.axisMark = MARK.DOUBLE_Y;
        s.lane(3.6, { m1: MARK.DASH_W }).parking(2.5).bike(2.0).gutter().kerb().walk(3.2, { flags: 1 });
    }),
    profile('ART-2x2-MED', 'arterial', 'Boulevard · 2×2, planted median, bus + cycle', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.flat(1.0, MAT.CURB, { fall: false, m0: MARK.SOLID_Y }).median(2.6, { mounted: 1 }).flat(1.0, MAT.CURB, { fall: false, m1: MARK.SOLID_Y });
        s.lane(3.4, { m0: MARK.SOLID_W, m1: MARK.DASH_W }).lane(3.4, { m1: MARK.SOLID_W }).busLane(3.3).bike(1.9).gutter().kerb()
            .walk(2.6, { flags: 1 }).treePit(1.5, { grate: 1 }).walk(1.2);
    }, { tags: ['bus', 'bike', 'transit'] }),
    profile('ART-3x3', 'arterial', 'Arterial · 3×3 with kerbside bus lanes', 'sym', (s) => {
        s.axisMark = MARK.DOUBLE_Y;
        s.lane(3.3, { m0: MARK.REV, m1: MARK.DASH_W }).lane(3.3, { m1: MARK.DASH_W }).lane(3.2, { m1: MARK.SOLID_W })
            .busLane(3.4).parking(2.4).bike(1.9).gutter().kerb().walk(3.4, { flags: 1 });
    }),
    profile('ONEWAY-3', 'arterial', 'One-way · 3 lanes, contraflow cycle lane', 'full', (s) => {
        s.flat(2.6, MAT.CONCRETE_SLAB, { fall: false }).kerbDown();
        s.bike(2.0, { m1: MARK.SOLID_W }).lane(3.4, { m1: MARK.DASH_W }).lane(3.4, { m1: MARK.DASH_W }).lane(3.3, { m1: MARK.SOLID_W })
            .parking(2.5).gutter().kerb().walk(3.0, { flags: 1 });
    }, { oneWay: 1, tags: ['cbd'] }),
    profile('ONEWAY-2-BUS', 'arterial', 'One-way · 2 lanes + bus lane + transit sidewalk', 'full', (s) => {
        s.flat(3.4, MAT.CONCRETE_SLAB, { fall: false }).kerbDown().busLane(3.4).lane(3.5, { m1: MARK.DASH_W }).lane(3.4, { m1: MARK.SOLID_W })
            .gutter().kerb().walk(3.6, { brick: 1 });
    }, { oneWay: 1 }),
    profile('ART-BRICK', 'arterial', 'High street · brick felt, tram tracks, wide promenade', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.015;
        s.flat(2.8, MAT.BRICK_RUNNING, { m1: MARK.TRAM }).track(4.6, { mat: MAT.BRICK_RUNNING }).flat(2.8, MAT.BRICK_RUNNING, { m0: MARK.TRAM });
        s.flat(1.0, MAT.STONE_SETT, { fall: false }).flat(3.4, MAT.PAVER, { fall: false }).treePit(1.4, { mat: MAT.BRICK }).flat(2.0, MAT.PAVER, { fall: false });
    }, { rail: 1, tags: ['historic', 'tram', 'paving'] }),
    profile('BLVD-TREE', 'arterial', 'Parkway · 2×2, tree mall, footpaths both sides', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.flat(0.8, MAT.CURB, { fall: false }).median(4.4).flat(0.8, MAT.CURB, { fall: false });
        s.lane(3.4, { m1: MARK.DASH_W }).lane(3.3).gutter().kerb().walk(2.8, { brick: 1 });
    }, { tags: ['trees', 'scenic'] }),
    profile('DUTCH-2x2', 'arterial', 'Dutch · 2×2 with separate two-way cycle track', 'sym', (s) => {
        s.axisMark = MARK.NONE;
        s.lane(3.2, { m1: MARK.SOLID_W }).flat(0.28, MAT.CURB, { fall: false }).verge(1.5, { mat: MAT.GRASS }).flat(3.0, MAT.TARMAC, { fall: false, sym: SYM.BIKE, symPeriod: 20 }).flat(0.28, MAT.CURB, { fall: false }).walk(1.6, { flags: 1 });
    }, { tags: ['bike', 'protected'] }),
    profile('MAIN-ST', 'local', 'Main street · shared surface, brick, no markings', 'full', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.012;
        s.flat(3.0, MAT.PAVER, { fall: false }).flat(7.0, MAT.BRICK).flat(3.0, MAT.PAVER, { fall: false });
    }, { tags: ['shared', 'town centre'] }),
    profile('CALLE-30', 'local', 'Home zone · 30 km/h, brick, buildouts, planters', 'full', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.01;
        s.flat(1.8, MAT.PAVER, { fall: false }).flat(5.2, MAT.COBBLE).flat(1.0, MAT.GRASS, { fall: false }).flat(1.6, MAT.PAVER, { fall: false });
    }, { bumps: 1, tags: ['calming', '30'] }),
    profile('SERV-1', 'service', 'Service road · single concrete carriageway', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.015;
        s.flat(4.2, MAT.CONCRETE).flat(0.16, MAT.CURB, { fall: false }).flat(1.6, MAT.DIRT, { fall: false });
    }),
    profile('GRAVEL', 'service', 'Unmade road · gravel with dirt shoulders', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.03;
        s.flat(6.0, MAT.GRAVEL).flat(2.0, MAT.DIRT, { fall: false });
    }),
    profile('PARKING-ST', 'service', 'Parking street · angled bays both kerbs, drive aisle', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.02;
        s.lane(6.0).flat(2.6, MAT.ASPHALT, { m1: MARK.PARKBAY, tint: TINT.PARK_GREY }).flat(0.6, MAT.CURB, { fall: false }).walk(1.2, { flags: 1 });
    }, { tags: ['lot'] }),
    // ── high speed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    profile('HWY-2x2', 'highway', 'Motorway · 2×2, hard shoulders, central reservation', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.025;
        s.flat(0.6, MAT.CONCRETE, { fall: false, m0: MARK.SOLID_Y }).jersey(1.05).flat(0.6, MAT.CONCRETE, { fall: false, m1: MARK.SOLID_Y });
        s.lane(3.65, { m0: MARK.SOLID_W, m1: MARK.DASH_W }).lane(3.65, { m1: MARK.SOLID_W })
            .flat(2.8, MAT.ASPHALT_OLD, { m1: MARK.SOLID_W }).gutter(0.6, -0.05).verge(1.8).guardrail(0.75).flat(2.4, MAT.GRASS, { fall: false });
    }, { tags: ['motorway', 'barrier'], speed: 110 }),
    profile('HWY-3x3', 'highway', 'Motorway · 3×3, HGV lane, sound walls', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.025;
        s.flat(0.6, MAT.CONCRETE, { fall: false, m0: MARK.SOLID_Y }).jersey(1.1).flat(0.6, MAT.CONCRETE, { fall: false, m1: MARK.SOLID_Y });
        s.lane(3.6, { m0: MARK.SOLID_W, m1: MARK.DASH_W }).lane(3.6, { m1: MARK.DASH_W }).lane(3.7, { m1: MARK.SOLID_W })
            .flat(3.0, MAT.ASPHALT_OLD, { m1: MARK.SOLID_W }).gutter(0.6, -0.05).flat(3.0, MAT.GRASS, { fall: false }).soundWall(3.6);
    }, { tags: ['motorway'], speed: 120 }),
    profile('EXPRESS-2x2', 'highway', 'Expressway · concrete slab, wide purge, lit', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.02;
        s.flat(0.7, MAT.CONCRETE, { fall: false, m0: MARK.SOLID_Y }).jersey(0.95).flat(0.7, MAT.CONCRETE, { fall: false, m1: MARK.SOLID_Y });
        s.flat(3.65, MAT.CONCRETE, { m0: MARK.SOLID_W, m1: MARK.DASH_W }).flat(3.65, MAT.CONCRETE, { m1: MARK.SOLID_W })
            .flat(3.0, MAT.CONCRETE, { m1: MARK.SOLID_W }).flat(2.8, MAT.GRAVEL, { fall: false }).guardrail(0.7, { berm: 0.3 });
    }, { tags: ['concrete'], speed: 100 }),
    profile('RAMP-1', 'highway', 'Interchange ramp · single lane, barriers', 'full', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.05;
        s.flat(0.4, MAT.CONCRETE, { fall: false }); s.guardrail(0.85, { berm: 0.25 });
        s.flat(4.6, MAT.ASPHALT, { m0: MARK.SOLID_W, m1: MARK.SOLID_W });
        s.gutter(0.5, -0.05).flat(0.25, MAT.CONCRETE, { fall: false }).guardrail(0.85, { berm: 0 });
    }, { ramp: 1, tags: ['freeway'], speed: 50 }),
    profile('BRIDGE-2x2', 'arterial', 'Bridge deck · 2×2, parapets, open deck drain', 'sym', (s) => {
        s.axisMark = MARK.DOUBLE_Y; s.crown = 0.02;
        s.railing(1.1, { mat: MAT.STEEL }).flat(3.5, MAT.ASPHALT, { m0: MARK.SOLID_W, m1: MARK.DASH_W }).flat(3.5, MAT.ASPHALT, { m1: MARK.SOLID_W })
            .gutter(0.5, -0.06).flat(0.35, MAT.GRATE, { fall: false }).railing(1.1, { mat: MAT.STEEL });
    }, { tags: ['structure'] }),
    profile('TUNNEL-2x2', 'arterial', 'Tunnel bore · tile walls, gutter channel', 'sym', (s) => {
        s.axisMark = MARK.DOUBLE_Y; s.crown = 0.02;
        s.flat(0.5, MAT.CONCRETE, { fall: false, m0: MARK.SOLID_Y }).tunnelWall(5.0, { thick: 0.6 });
        s.lane(3.6, { m1: MARK.SOLID_W }).lane(3.4).gutter(0.8, -0.1, { mat: MAT.GRATE }).flat(0.9, MAT.CONCRETE, { fall: false }).tunnelWall(5.0, { thick: 0.6 });
    }, { tags: ['lit', 'enclosed'] }),
    // ── active travel ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    profile('PATH-BIKE', 'path', 'Cycle track · asphalt, isolated, lit', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.03;
        s.flat(1.3, MAT.TARMAC, { sym: SYM.BIKE, symPeriod: 22 }).flat(0.7, MAT.GRASS, { fall: false });
    }, { path: 1 }),
    profile('PATH-PEDE', 'path', 'Footpath · concrete flags through the park', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.025;
        s.flat(1.4, MAT.PAVER, { fall: false }).flat(1.0, MAT.GRAVEL, { fall: false });
    }, { path: 1 }),
    profile('PATH-BRICK', 'path', 'Garden walk · brick with sett edges', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.03;
        s.flat(1.6, MAT.BRICK, { fall: false }).flat(0.9, MAT.STONE_SETT, { fall: false });
    }, { path: 1 }),
    profile('PROMENADE', 'path', 'Waterfront · tiles, granite channel, railing', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.018;
        s.flat(3.4, MAT.PAVER, { fall: false }).flat(0.5, MAT.CURB, { fall: false }).flat(2.8, MAT.TILE, { fall: false }).railing(1.15, { mat: MAT.STEEL });
    }, { path: 1, tags: ['water', 'pedestrian'] }),
    profile('BOARDWALK', 'path', 'Boardwalk · timber deck, 0.35 m raised', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.015;
        s.flat(0.35, MAT.CONCRETE, { fall: false });           // [-] skirt on the left
        s.railing(1.0, { mat: MAT.TIMBER }).flat(3.0, MAT.TIMBER, { fall: false }).railing(1.0, { mat: MAT.TIMBER });
    }, { path: 1, raised: 0.35 }),
    profile('RIVER', 'water', 'River · quay walls, water, towpath', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0;
        s.flat(2.2, MAT.DIRT, { fall: false }).flat(1.6, MAT.TARMAC, { fall: false }).water(46, { depth: 3.2, edge: MAT.STONE_SETT });
    }, { water: 1, noJunction: 1 }),
    // ── rail & transit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    profile('RAIL-2T', 'rail', 'Mainline · double track, ballast, fence, catenary', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0;
        s.flat(1.6, MAT.DIRT, { fall: false }).slope(4.2, 0.55, MAT.BALLAST, { fall: false }).flat(11.0, MAT.BALLAST, { fall: false })
            .slope(4.2, -0.55, MAT.BALLAST, { fall: false }).flat(1.6, MAT.DIRT, { fall: false });
    }, { rail: 1, noJunction: 1, noProps: 1 }),
    profile('RAIL-TRAM', 'street', 'Tram in mixed traffic · grooved rails in setts', 'sym', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.015;
        s.track(2.6).flat(3.0, MAT.STONE_SETT).track(2.6);
        s.flat(1.0, MAT.PAVER, { fall: false });
    }, { rail: 1, inRoad: 1 }),
    profile('METRO-VIADUCT', 'rail', 'Elevated metro · concrete deck, parapet, walkway', 'full', (s) => {
        s.axisMark = MARK.NONE; s.crown = 0.01;
        s.flat(0.9, MAT.CONCRETE, { fall: false }).railing(1.2, { mat: MAT.STEEL }).flat(0.6, MAT.CONCRETE, { fall: false });
        s.flat(4.8, MAT.CONCRETE, { m0: MARK.SOLID_Y, fall: false }).flat(4.8, MAT.CONCRETE, { m1: MARK.SOLID_Y, fall: false });
        s.flat(0.6, MAT.CONCRETE, { fall: false }).railing(1.2, { mat: MAT.STEEL }).flat(0.9, MAT.CONCRETE, { fall: false });
    }, { metro: 1, noJunction: 1, noProps: 1 }),
];

const cache = new Map();
export function getProfile(id) {
    let r = cache.get(id);
    if (r) return r;
    const def = PROFILES.find((p) => p.id === id) || PROFILES[0];
    const sec = new Section(def.mode || 'sym');
    def.body(sec);
    r = sec.resolve(def);
    cache.set(id, r);
    return r;
}
export const PROFILE_IDS = PROFILES.map((p) => p.id);
export const PROFILE_BY_CLASS = (() => { const m = new Map(); for (const p of PROFILES) { if (!m.has(p.cls)) m.set(p.cls, []); m.get(p.cls).push(p); } return m; })();

/** Rough speed band [km/h] used for markings style, prop spacing and camera presets. */
export function profileSpeed(id) { const d = PROFILES.find((p) => p.id === id); return d?.speed ?? (d?.cls === 'highway' ? 110 : d?.cls === 'arterial' ? 60 : d?.cls === 'collector' ? 50 : d?.cls === 'path' ? 20 : 30); }
export function profileIsHard(id) { const p = getProfile(id); return !p.water && !p.rail; }

/** Section drawing for the asset browser / inspector. */
export function profileSvg(id, w = 320, h = 84) {
    const p = getProfile(id);
    const t0 = p.tMin - 0.4, t1 = p.tMax + 0.4;
    let hMin = 0, hMax = 0.2;
    for (const s of p.segs) { hMin = Math.min(hMin, s.h0, s.h1); hMax = Math.max(hMax, s.h0, s.h1); }
    const sx = (w - 8) / (t1 - t0), sy = Math.min(30, (h - 26) / Math.max(0.5, hMax - hMin));
    const X = (t) => 4 + (t - t0) * sx, Y = (hh) => h - 12 - (hh - hMin) * sy;
    let out = '';
    for (const s of p.segs) {
        const a = Math.min(s.t0, s.t1), b = Math.max(s.t0, s.t1);
        const ha = s.t0 <= s.t1 ? s.h0 : s.h1, hb = s.t0 <= s.t1 ? s.h1 : s.h0;
        const x0 = X(a), x1 = Math.max(X(b), x0 + 0.9), yTop = Y(Math.max(ha, hb)), yBot = Y(Math.min(ha, hb));
        out += `<rect x="${x0.toFixed(1)}" y="${yTop.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${Math.max(1.6, yBot - yTop).toFixed(1)}" fill="${MAT_COLOR[s.mat] || '#3a3f45'}"/>`;
        out += `<path d="M ${X(s.t0).toFixed(1)} ${Y(s.h0).toFixed(1)} L ${X(s.t1).toFixed(1)} ${Y(s.h1).toFixed(1)}" stroke="#0b0c0d" stroke-width="1.2" fill="none"/>`;
        const mk = (m, x) => (m && m !== MARK.NONE ? `<rect x="${(x - 0.8).toFixed(1)}" y="${(Y(ha === hb ? ha : ha) - 1.6).toFixed(1)}" width="1.7" height="3.2" fill="#e8ecf0" opacity=".95"/>` : '');
        out += mk(s.m0, X(s.t0)) + mk(s.m1, X(s.t1));
    }
    const axis = X(0);
    out += `<line x1="${axis.toFixed(1)}" y1="4" x2="${axis.toFixed(1)}" y2="${h - 4}" stroke="#4fd8e0" stroke-width="1" stroke-dasharray="3 3" opacity=".55"/>`;
    out += `<text x="6" y="${h - 2}" font-size="9" fill="#888" font-family="ui-monospace,monospace">${p.width.toFixed(1)} m wide · ${p.segs.length} bands</text>`;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

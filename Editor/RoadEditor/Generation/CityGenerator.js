//============================================================================================================================================
// 📦 Editor/RoadEditor/Generation/CityGenerator.js — Hierarchy first, then blocks: motorway frame → arterials → collectors → locals → paths
//============================================================================================================================================
// Cities are grown, not tiled. A jittered lattice carries the whole street frame and each edge is classified by how far it sits from the centre
//    and by a zone field (cbd / mixed / residential / park / industrial / vacant), so density and character change together the way they do in a
//    real region. Free alignments — ring road, radials, river, mainline rail, metro, park walks — are laid over the top and *cut* the lattice:
//    every crossing inserts a node and splits the edge it lands on, which is what produces through-running boulevards, T-junctions into a
//    highway corridor that was carved away, and bridges where a street meets water. Everything the brief asks for (bus lanes, cycle tracks,
//    parking, brick, pathways, humps) is decided by the profile chosen for the edge, so the generator never invents geometry of its own.
'use strict';

import { Rng, noise2, hash3, clamp, lerp, segIntersect, catmullPolyline, terrainY, polyLength } from '../Kernel/CurveKit.js';
import { PROFILE_IDS, getProfile, MAT } from '../Kernel/ProfileSolver.js';

export const STYLES = {
    grid: { label: 'Grid · American city', jitter: 0.05, prune: 0, super: 0.14, spur: 0.10, radial: 0, park: 0.13, industrial: 0.16, vacant: 0.10, oneWay: 0.35, brick: 0.05, curve: 0.04 },
    organic: { label: 'Organic · European old city', jitter: 0.40, prune: 1, super: 0.02, spur: 0.06, radial: 3, park: 0.12, industrial: 0.10, vacant: 0.12, oneWay: 0.5, brick: 0.35, curve: 0.16 },
    superblock: { label: 'Superblock · Barcelona / Houston', jitter: 0.06, prune: 0, super: 0.85, spur: 0.04, radial: 1, park: 0.15, industrial: 0.14, vacant: 0.08, oneWay: 0.2, brick: 0.06, curve: 0.05 },
    sprawl: { label: 'Sprawl · suburban arterials', jitter: 0.16, prune: 1, super: 0.3, spur: 0.85, radial: 2, park: 0.18, industrial: 0.2, vacant: 0.22, oneWay: 0.1, brick: 0.02, curve: 0.28 },
    dutch: { label: 'Dutch · cycle-first', jitter: 0.14, prune: 1, super: 0.12, spur: 0.2, radial: 1, park: 0.18, industrial: 0.1, vacant: 0.1, oneWay: 0.4, brick: 0.45, curve: 0.1, water: 0.8 },
    circuit: { label: 'NFS circuit · open map', jitter: 0.08, prune: 1, super: 0.1, spur: 0.12, radial: 4, park: 0.3, industrial: 0.1, vacant: 0.5, oneWay: 0.1, brick: 0.02, curve: 0.22 },
};

export const ZONES = ['cbd', 'mixed', 'residential', 'park', 'industrial', 'vacant'];

/** @returns {{nodes:Object, roads:Array, lots:Array, transit:Array, meta:object}} a plain, serialisable document */
export function generateCity(opts = {}) {
    const O = normalize(opts);
    const rng = Rng(O.seed);
    const st = STYLES[O.style] || STYLES.grid;
    const rot = O.rotation ?? (O.style === 'grid' ? Math.round(rng.range(-24, 24)) * 1 : rng.range(-30, 30));
    const ca = Math.cos(rot * Math.PI / 180), sa = Math.sin(rot * Math.PI / 180);
    const T = (x, z) => ({ x: x * ca - z * sa + O.ox, z: x * sa + z * ca + O.oz });   // [-] lattice frame → world

    const g = new Grid(O, st, rng, T);
    g.lattice();
    g.classify();
    g.carveCorridors();
    if (st.spur > 0) g.spurs();
    if (O.water > 0) g.river();
    if (O.rail) g.railway();
    if (O.metro > 0) g.metro();
    if (O.ringHWY) g.motorwayRing();
    g.parkPaths();
    g.finalize();
    return g.doc;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function normalize(o) {
    const half = o.half ?? 2300;
    return {
        seed: o.seed ?? 1337,
        style: o.style ?? 'grid',
        half,                                  // [m] lattice extends to ±half
        ox: 0, oz: 0,
        rotation: o.rotation ?? null,
        cell: o.cell ?? 118,                   // [m] local spacing; arterials sit on every 4th line
        arterialEvery: o.arterialEvery ?? 4,
        collectorEvery: o.collectorEvery ?? 2,
        density: o.density ?? 1,               // [-] multiplies the keep probability of low-class edges
        water: o.water ?? 1,                   // [-] 0 = none, 1 = river, 2 = river + lake
        rail: o.rail ?? 1,                     // [-] mainline with level crossings
        metro: o.metro ?? 2,                   // [-] number of metro lines
        ringHWY: o.ringHWY ?? 1,
        bike: o.bike ?? 1, bus: o.bus ?? 1, parking: o.parking ?? 1,
        humps: o.humps ?? 1,
        terrain: o.terrain ?? 0,               // [m] ground amplitude, applied to node elevations
        historicChance: o.historicChance ?? 0.12,
        edgeMargin: o.edgeMargin ?? 60,        // [m] kept clear at the map border
        lots: o.lots ?? 1,
        maxRoads: o.maxRoads ?? 5200,
    };
}

class Grid {
    constructor(O, st, rng, T) {
        this.O = O; this.st = st; this.rng = rng; this.T = T;
        this.nodes = {};                        // [-] id → {id,x,z,y,i,j,cls}
        this.nodeAt = new Map();                // [-] "i,j" → id
        this.edges = new Map();                 // [-] "a:b" (sorted) → {a,b,cls,keep}
        this.free = [];                         // [-] extra alignments: {pts,cls,profile,noJunction,cut,deck}
        this.waterPolygons = [];                // [-] closed rings (lakes) → water lots
        this.doc = { nodes: null, roads: [], lots: [], transit: [], meta: {} };
    }

    // ── lattice ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    key(i, j) { return i * 8192 + j; }
    node(i, j, create = true) {
        const k = this.key(i, j);
        let id = this.nodeAt.get(k);
        if (id != null || !create) return id;
        const O = this.O, c = O.cell;
        const jx = (hash3(i, j, 1) - 0.5) * 2 * this.st.jitter * c;
        const jz = (hash3(i, j, 2) - 0.5) * 2 * this.st.jitter * c;
        // Gentle meander on top of the jitter, so long streets breathe instead of being ruler-straight.
        const wx = i * c + jx + Math.sin(j * 0.55 + i * 0.11) * this.st.curve * c;
        const wz = j * c + jz + Math.sin(i * 0.47 + j * 0.13) * this.st.curve * c;
        if (Math.abs(wx) > O.half || Math.abs(wz) > O.half) return undefined;
        const p = this.T(wx, wz);
        id = Object.keys(this.nodes).length + 1;
        // Node heights stay at the datum: the surface is a field the bake samples, so a road conforms without the document
        //    duplicating the terrain. Only engineered structure (a deck, a trackbed) writes a height, and it writes an offset.
        this.nodes[id] = { id, x: p.x, z: p.z, y: 0, i, j };
        this.nodeAt.set(k, id);
        return id;
    }
    lattice() {
        const O = this.O, n = Math.floor(O.half / O.cell);
        for (let i = -n; i <= n; ++i) for (let j = -n; j <= n; ++j) this.node(i, j);
        const add = (a, b) => {
            if (a == null || b == null || a === b) return;
            const k = a < b ? a + ':' + b : b + ':' + a;
            if (this.edges.has(k)) return;
            this.edges.set(k, { a, b, cls: 'local', keep: 1, key: k });
        };
        for (let i = -n; i <= n; ++i) for (let j = -n; j <= n; ++j) {
            add(this.node(i, j), this.node(i + 1, j));
            add(this.node(i, j), this.node(i, j + 1));
        }
    }

    zoneOf(x, z) {
        const O = this.O;
        const r = Math.hypot(x - O.ox, z - O.oz) / O.half;
        const n = noise2(x, z, 760, 3, O.seed + 31);
        const m = noise2(x, z, 330, 2, O.seed + 77);
        if (r > 0.985) return 'vacant';
        if (m > 1 - this.st.park && r > 0.2) return 'park';
        if (m < 0.18 && r > 0.32) return 'industrial';
        if (r < 0.16 && n > 0.34) return 'cbd';
        if (r < 0.42) return 'mixed';
        if (n < 0.2) return 'vacant';
        return 'residential';
    }
    classify() {
        const O = this.O;
        for (const e of this.edges.values()) {
            const A = this.nodes[e.a], B = this.nodes[e.b];
            const mx = (A.x + B.x) * 0.5, mz = (A.z + B.z) * 0.5;
            const zone = this.zoneOf(mx, mz);
            e.zone = zone;
            const ia = Math.round((A.i + B.i) / 2), ib = Math.round((A.j + B.j) / 2);
            const onArt = (v) => ((v % O.arterialEvery) + O.arterialEvery * 4) % O.arterialEvery === 0;
            const onCol = (v) => ((v % O.collectorEvery) + O.collectorEvery * 4) % O.collectorEvery === 0;
            const horiz = A.i === B.i;
            const idx = horiz ? ib : ia;
            let cls = 'local';
            if (onArt(idx)) cls = 'arterial';
            else if (onCol(idx)) cls = 'collector';
            if (zone === 'cbd' && cls === 'local' && onCol(idx)) cls = 'arterial';
            // Superblocks: locals inside a block disappear; only the perimeter keeps running.
            if (cls === 'local') {
                const inBlock = !onCol(ia) && !onCol(ib);
                const s = this.st.super * (zone === 'cbd' || zone === 'industrial' ? 1.15 : 0.75);
                if (inBlock && hash3(ia, ib, 91) < s) e.keep = 0;
            }
            if (zone === 'park') { e.keep = cls === 'arterial' ? 1 : (hash3(ia, ib, 5) < 0.35 ? 1 : 0); if (e.keep) e.cls = 'collector'; }
            if (zone === 'vacant') { e.keep = cls !== 'local' ? 1 : (hash3(ia, ib, 7) < 0.28 ? 1 : 0); }
            if (zone === 'industrial' && cls === 'local') e.keep = hash3(ia, ib, 9) < 0.7 ? 1 : 0;
            if (cls === 'local' && this.rng.chance(1 - clamp(O.density, 0.2, 2) * 0.16)) e.keep = 0;
            if (!e.keep) continue;
            e.cls = cls;
        }
        for (const e of this.edges.values()) if (e.keep && !e.cls) e.cls = 'local';
    }

    /** Drop edges that would run through a freeway / rail corridor, and mark those that touch it. */
    carveCorridors() {
        const O = this.O;
        if (!O.ringHWY) return;
        const R = O.half * 0.8;
        const ring = this.ringPts = [];
        const steps = 46;
        for (let k = 0; k <= steps; ++k) {
            const a = (k / steps) * Math.PI * 2;
            const rr = R * (1 + 0.055 * Math.sin(a * 3 + O.seed % 7) + 0.03 * Math.cos(a * 5));
            const wx = Math.cos(a) * rr, wz = Math.sin(a) * rr;
            ring.push(this.T(wx, wz));
        }
        this.free.push({ pts: ring, cls: 'highway', profile: O.style === 'circuit' ? 'HWY-3x3' : 'HWY-2x2', cut: 26, noJunction: false, free: true, ring: true });
        // Radials from the centre to the ring, evenly spaced with a random phase.
        const nr = O.style === 'circuit' ? 8 : 6;
        for (let k = 0; k < nr; ++k) {
            const a = (k / nr) * Math.PI * 2 + (O.seed % 13) * 0.11;
            const p = [];
            const steps = 12;
            for (let q = 0; q <= steps; ++q) {
                const u = q / steps;
                const rr = u * R;
                const wig = Math.sin(u * 5.5 + k) * 0.035 * R * (1 - u);
                p.push(this.T(Math.cos(a) * rr - Math.sin(a) * wig, Math.sin(a) * rr + Math.cos(a) * wig));
            }
            this.free.push({ pts: p, cls: 'arterial', profile: 'ART-2x2-MED', cut: 0, free: true, radial: true, ringEnd: { a, r: R } });
        }
    }

    /** Suburban curvilinear spurs + cul-de-sacs hung off collector lines. */
    spurs() {
        const O = this.O;
        const n = Math.floor(O.half / O.cell);
        for (let i = -n; i <= n; ++i) {
            for (let j = -n; j <= n; ++j) {
                const a = this.node(i, j), b = this.node(i + 1, j);
                if (a == null || b == null) continue;
                const e = this.edges.get(a < b ? a + ':' + b : b + ':' + a);
                if (!e || e.cls === 'local') continue;
                if (e.zone === 'vacant' || e.zone === 'park') continue;
                if (hash3(i, j, 21) > this.st.spur) continue;
                for (const side of [-1, 1]) {
                    if (hash3(i * 3 + side, j, 23) > 0.72) continue;
                    const A = this.nodes[a], B = this.nodes[b];
                    let dx = B.x - A.x, dz = B.z - A.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
                    let nx = dz * side, nz = -dx * side;
                    const hang = hash3(i, j * 5 + side, 27);
                    const len = O.cell * (1.3 + hang * 1.6);
                    const bow = (hash3(i, j, 29 + side) - 0.5) * len * 0.55;
                    const p0 = { x: lerp(A.x, B.x, 0.25 + hang * 0.5), z: lerp(A.z, B.z, 0.25 + hang * 0.5) };
                    const pts = [
                        p0,
                        { x: p0.x + nx * len * 0.5 + dx * bow * 0.4, z: p0.z + nz * len * 0.5 + dz * bow * 0.4 },
                        { x: p0.x + nx * len + dx * bow, z: p0.z + nz * len + dz * bow },
                    ];
                    if (this.rng.chance(0.42)) pts.push({ x: pts[2].x + nx * len * 0.42 + dx * len * 0.3, z: pts[2].z + nz * len * 0.42 + dz * len * 0.3 });
                    this.free.push({ pts, cls: 'local', profile: 'RES-CUL', spur: true, hang: true });
                    void nx; void nz;
                }
            }
        }
    }

    river() {
        const O = this.O;
        const H = O.half;
        const p = [];
        const steps = 26;
        const off = (hash3(O.seed, 3, 1) - 0.5) * H * 0.7;
        for (let k = 0; k <= steps; ++k) {
            const u = k / steps, z = -H * 1.15 + u * H * 2.3;
            const x = off + Math.sin(u * 3.1 + 0.7) * H * 0.36 + Math.sin(u * 7.4) * H * 0.07;
            p.push(this.T(x, z));
        }
        const width = 34 + hash3(O.seed, 9, 3) * 26;
        this.riverPts = p;
        this.free.push({ pts: p, cls: 'water', profile: 'RIVER', noJunction: true, water: 1, width });
        if (O.water >= 2) {
            // A lake in a park-ish quadrant, drawn as a closed water ring.
            const a = O.seed % 4 * Math.PI / 2 + 0.6, r = H * (0.45 + (hash3(1, 2, 3) % 1) * 0.2);
            const cx = Math.cos(a) * r, cz = Math.sin(a) * r, rr = H * 0.13;
            const ring = [];
            for (let k = 0; k < 22; ++k) { const t = (k / 22) * Math.PI * 2; ring.push(this.T(cx + Math.cos(t) * rr * 1.25, cz + Math.sin(t) * rr)); }
            this.lake = { c: this.T(cx, cz), r: rr };
            this.free.push({ pts: ring, cls: 'water', profile: 'RIVER', noJunction: true, water: 1, width: rr * 1.6, closed: true });
        }
    }

    railway() {
        const O = this.O;
        const H = O.half;
        const p = [];
        const a = (hash3(O.seed, 41, 1) - 0.5) * 1.1;
        const steps = 20;
        for (let k = 0; k <= steps; ++k) {
            const u = k / steps, s = -H * 1.2 + u * H * 2.4;
            const perp = Math.sin(u * 2.2 + 1.1) * H * 0.2 + (hash3(k, 3, 7) - 0.5) * 40;
            p.push(this.T(Math.cos(a) * s - Math.sin(a) * perp, Math.sin(a) * s + Math.cos(a) * perp));
        }
        this.railPts = p;
        this.free.push({
            pts: p, cls: 'rail', profile: 'RAIL-2T', noJunction: true, rail: true, electrified: true,
            grade: 'at', cut: 14, deck: 6.6,
        });
    }

    metro() {
        const O = this.O;
        const H = O.half;
        for (let q = 0; q < O.metro; ++q) {
            const viaduct = hash3(q, O.seed, 61) < 0.34;
            const pts = [];
            const a0 = (q / O.metro) * Math.PI + hash3(q, 7, 3) * 0.8;
            const steps = 10;
            for (let k = 0; k <= steps; ++k) {
                const u = k / steps, s = (u - 0.5) * 2 * H * 0.82;
                const perp = Math.sin(u * 2.6 + q * 1.7) * H * 0.26;
                pts.push(this.T(Math.cos(a0) * s - Math.sin(a0) * perp, Math.sin(a0) * s + Math.cos(a0) * perp));
            }
            const fair = catmullPolyline(pts, 8);
            const line = {
                kind: 'metro', id: 'M' + (q + 1), name: `Line ${q + 1}`, mode: viaduct ? 'viaduct' : 'tunnel',
                color: ['#d84f4f', '#4f8ed8', '#54b363', '#c9a13b'][q % 4],
                depth: -17.5, align: fair, stations: [],
            };
            // Stations roughly where the line meets an arterial node, otherwise every ~600 m.
            let acc = 0;
            const wanted = [];
            for (let k = 1; k < fair.length; ++k) {
                acc += Math.hypot(fair[k].x - fair[k - 1].x, fair[k].z - fair[k - 1].z);
                if (acc > 620) { acc = 0; wanted.push(k); }
            }
            for (const k of wanted) {
                const p = fair[k], n = fair[Math.min(fair.length - 1, k + 1)], pv = fair[Math.max(0, k - 1)];
                const ang = Math.atan2(n.z - pv.z, n.x - pv.x);
                const s = { x: p.x, z: p.z, y: viaduct ? 7.2 : line.depth, angle: ang, line: line.id, name: 'Sta ' + (line.stations.length + 1) };
                line.stations.push(s);
            }
            this.doc.transit.push(line);
            if (viaduct) {
                this.free.push({ pts: fair, cls: 'rail', profile: 'METRO-VIADUCT', noJunction: true, metro: 1, deck: 7.2, y: 7.2, electrified: true, metroLine: line.id });
            } else {
                // Tunnel alignments are not roads: they ride along under the street network and only surface as shafts and vents.
                this.doc.transit[this.doc.transit.length - 1].alignments = [fair];
            }
        }
    }

    motorwayRing() { /* handled in carveCorridors, which also plants the radials */ }

    parkPaths() {
        const O = this.O;
        const n = Math.floor(O.half / O.cell);
        for (let i = -n; i <= n; ++i) {
            for (let j = -n; j <= n; ++j) {
                const a = this.node(i, j), b = this.node(i + 1, j + 1);
                if (a == null || b == null) continue;
                const A = this.nodes[a], B = this.nodes[b];
                if (this.zoneOf((A.x + B.x) / 2, (A.z + B.z) / 2) !== 'park') continue;
                if (hash3(i, j, 33) > 0.5) continue;
                const mid = { x: (A.x + B.x) / 2 + (hash3(i, j, 35) - 0.5) * O.cell * 0.8, z: (A.z + B.z) / 2 + (hash3(i, j, 37) - 0.5) * O.cell * 0.8 };
                this.free.push({ pts: [A, mid, B], cls: 'path', profile: hash3(i, j, 39) < 0.5 ? 'PATH-PEDE' : 'PATH-BIKE', path: true });
            }
        }
        // Waterfront promenade along the river, both banks.
        if (this.riverPts) {
            for (const side of [-1, 1]) {
                const w = (this.free.find((f) => f.water && !f.closed)?.width ?? 40) * 0.5 + 4;
                const pts = [];
                for (let k = 0; k < this.riverPts.length; ++k) {
                    const a = this.riverPts[Math.max(0, k - 1)], b = this.riverPts[Math.min(this.riverPts.length - 1, k + 1)];
                    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
                    pts.push({ x: this.riverPts[k].x + (dz / l) * w * side, z: this.riverPts[k].z - (dx / l) * w * side });
                }
                this.free.push({ pts, cls: 'path', profile: 'PROMENADE', path: 1, bank: true });
            }
        }
    }

    // ── assembly ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    /** Project a world point onto a lattice edge's node pair, inserting a node and splitting the edge. */
    attachToEdge(e, x, z, tag) {
        const A = this.nodes[e.a], B = this.nodes[e.b];
        const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz;
        const u = l2 > 1e-6 ? clamp(((x - A.x) * dx + (z - A.z) * dz) / l2, 0, 1) : 0;
        if (u < 0.06 || u > 0.94) return null;
        const px = A.x + dx * u, pz = A.z + dz * u;
        const id = this.addNode(px, pz, lerp(A.y, B.y, u), tag);
        this.edges.delete(e.key);
        const k1 = Math.min(e.a, id) + ':' + Math.max(e.a, id), k2 = Math.min(id, e.b) + ':' + Math.max(id, e.b);
        const e1 = { a: e.a, b: id, cls: e.cls, zone: e.zone, keep: 1, key: k1, tag };
        const e2 = { a: id, b: e.b, cls: e.cls, zone: e.zone, keep: 1, key: k2, tag };
        this.edges.set(k1, e1); this.edges.set(k2, e2);
        return { id, e1, e2 };
    }
    addNode(x, z, y = 0, tag) {
        const id = Object.keys(this.nodes).length + 1;
        this.nodes[id] = { id, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, y: Math.round(y * 100) / 100, i: null, j: null, tag };
        return id;
    }

    finalize() {
        const O = this.O;
        // 1. Free alignments become nodes + edges, snapping onto nearby lattice nodes.
        const snap = O.cell * 0.30;
        const edgeList = () => Array.from(this.edges.values());
        for (const f of this.free) {
            const ids = [];
            for (let k = 0; k < f_pts(f).length; ++k) {
                const p = f_pts(f)[k];
                let near = null, nd = snap;
                for (const id of this.nearNodes(p.x, p.z, snap)) { const d = Math.hypot(this.nodes[id].x - p.x, this.nodes[id].z - p.z); if (d < nd) { nd = d; near = id; } }
                ids.push(near != null && !f.noJunction ? near : this.addNode(p.x, p.z, f.y ?? 0));
            }
            f.ids = ids;
        }
        // 1b. Where two free alignments meet — a radial reaching the ring road — share the node, or the ring is an unreachable ribbon.
        for (let a = 0; a < this.free.length; ++a) {
            for (let b = a + 1; b < this.free.length; ++b) {
                const fa = this.free[a], fb = this.free[b];
                if (!fa.ids || !fb.ids || fa.noJunction || fb.noJunction) continue;
                const ea = [0, fa.ids.length - 1], eb = [0, fb.ids.length - 1];
                for (const i of ea) {
                    for (const j of eb) {
                        const na = this.nodes[fa.ids[i]], nb = this.nodes[fb.ids[j]];
                        if (!na || !nb || fa.ids[i] === fb.ids[j]) continue;
                        if (Math.hypot(na.x - nb.x, na.z - nb.z) > 30) continue;
                        // Prefer the lattice node — it carries the block edges. An unreferenced leftover node is harmless and stays.
                        const prefer = na.i != null ? fa.ids[i] : nb.i != null ? fb.ids[j] : Math.min(fa.ids[i], fb.ids[j]);
                        fa.ids[i] = prefer; fb.ids[j] = prefer;
                    }
                }
            }
        }
        // 2. Crossings between free alignments and the lattice split the lattice edge (this is what makes T-junctions and carved freeway gaps).
        for (const f of this.free) {
            const fp = f_pts(f);
            for (let k = 1; k < fp.length; ++k) {
                const cand = this.nearEdges(fp[k - 1], fp[k]);
                for (const e of cand) {
                    if (f.noJunction || f.cut > 0) continue;
                    const A = this.nodes[e.a], B = this.nodes[e.b];
                    const hit = segIntersect(fp[k - 1], fp[k], A, B);
                    if (hit) this.attachToEdge(e, hit.x, hit.z, f.cls);
                }
            }
        }
        // 3. Carve: remove lattice edges that run inside a corridor that must stay free (freeway, rail), and cap the ends.
        for (const f of this.free) {
            if (!f.cut) continue;
            const fp = f_pts(f);
            for (const e of edgeList()) {
                const A = this.nodes[e.a], B = this.nodes[e.b];
                if (this.segNearPolyline(A, B, fp, f.cut)) { e.keep = 0; e.carved = true; }
            }
        }
        // 4. Free alignments emit their own roads (span by span, so every node along them is real).
        for (const f of this.free) {
            if (f.water) continue;                                       // [-] water is not a road; it becomes a lot + a special profile
            const ids = f.ids;
            if (!ids) continue;
            for (let k = 0; k + 1 < ids.length; ++k) {
                const a = ids[k], b = ids[k + 1];
                if (a == null || b == null || a === b) continue;
                const A = this.nodes[a], B = this.nodes[b];
                if (Math.hypot(A.x - B.x, A.z - B.z) < 6) continue;
                const key = Math.min(a, b) + ':' + Math.max(a, b);
                if (this.edges.has(key)) continue;
                this.edges.set(key, {
                    a, b, key, cls: f.cls, keep: 1, profile: f.profile, noJunction: f.noJunction, freeId: this.free.indexOf(f),
                    rail: f.rail, metro: f.metro, electrified: f.electrified, struct: f.deck ? 'bridge' : undefined, ring: f.ring, deck: f.deck, y: f.y, spur: f.spur, path: f.path,
                });
            }
        }
        // 5. Water: the river and lakes become wide water alignments (a `noJunction` road so the banks are swept) plus lot polygons.
        for (const f of this.free) {
            if (!f.water) continue;
            const ids = f.ids || [];
            const pts = f_pts(f);
            if (f.closed) { this.waterPolygons.push?.(pts); continue; }
            if (ids.length > 1) {
                for (let k = 0; k + 1 < ids.length; ++k) {
                    const a = ids[k], b = ids[k + 1];
                    if (a == null || b == null || a === b) continue;
                    const key = Math.min(a, b) + ':' + Math.max(a, b);
                    if (this.edges.has(key)) continue;
                    this.edges.set(key, { a, b, key, cls: 'water', keep: 1, profile: 'RIVER', noJunction: true, water: 1 });
                }
            }
        }
        // 6. Bridges: any kept street edge that crosses a water or separated-rail alignment gets lifted.
        this.structure();
        // 6b. Ragged ends: a dropped neighbour must not leave a 40 m tongue of asphalt. Iterative, so chains of stubs go too.
        for (let pass = 0; pass < 4; ++pass) {
            const deg = new Map();
            for (const e of this.edges.values()) {
                if (!e.keep) continue;
                deg.set(e.a, (deg.get(e.a) || 0) + 1);
                deg.set(e.b, (deg.get(e.b) || 0) + 1);
            }
            let dropped = 0;
            for (const e of this.edges.values()) {
                if (!e.keep || e.spur || e.path || e.freeId != null) continue;
                const la = deg.get(e.a) || 0, lb = deg.get(e.b) || 0;
                if (la > 1 && lb > 1) continue;
                const A = this.nodes[e.a], B = this.nodes[e.b];
                if (!A || !B) { e.keep = 0; dropped++; continue; }
                const len = Math.hypot(A.x - B.x, A.z - B.z);
                const dangling = (la === 1 ? !this.hasLatticeNode(e.a) : false) || (lb === 1 ? !this.hasLatticeNode(e.b) : false);
                if (len < (this.st.spur > 0.5 ? 210 : 150) || (dangling && len < 260)) { e.keep = 0; dropped++; }
            }
            if (!dropped) break;
        }
        this.collapse();
        // 7. Profiles, one-ways, humps.
        const roads = [];
        let id = 1;
        const counts = { };
        for (const e of this.edges.values()) {
            if (!e.keep) continue;
            if (Object.keys(this.nodes).length > 0 && roads.length >= O.maxRoads) break;
            const A = this.nodes[e.a], B = this.nodes[e.b];
            if (!A || !B) continue;
            const len = Math.hypot(A.x - B.x, A.z - B.z);
            if (len < 5) continue;
            const prof = e.profile || this.pickProfile(e);
            const road = {
                id, name: `${prof}-${id}`, profile: prof, cls: e.cls || 'local',
                nodeA: e.a, nodeB: e.b,
                points: [{ x: A.x, z: A.z }, { x: B.x, z: B.z }],
                zone: e.zone || 'residential',
            };
            if (e.noJunction) road.noJunction = true;
            if (e.rail) { road.electrified = true; road.grade = 'at'; }
            if (e.metro) { road.metro = e.metro; }
            if (e.struct) { road.struct = e.struct; road.y0 = e.y ?? 0; road.y1 = e.y ?? 0; }
            if (e.noEndJunction) road.noJunctionEnd = { A: true, B: true };
            if (e.water) road.water = 1;
            if (e.oneWay) { road.oneWay = 1; if (e.flip) road.flip = 1; }
            if (e.spur) road.curbRadius = 4.5;
            if (O.humps && this.wantHumps(e)) road.bumps = this.humpsFor(road);
            if (e.ring) road.speed = 110;
            counts[prof] = (counts[prof] || 0) + 1;
            roads.push(road); id++;
        }
        this.doc.roads = roads;
        this.doc.nodes = this.nodes;
        if (O.lots) this.buildLots();
        // Closed water rings become water lots.
        for (const poly of this.waterPolygons || []) this.doc.lots.push({ p: poly, mat: MAT.WATER, y: -0.55, flat: 1 });
        this.doc.meta = {
            style: O.style, seed: O.seed, half: O.half, roads: roads.length, nodes: Object.keys(this.nodes).length,
            profiles: counts, zones: this.zoneTally(), river: !!this.riverPts, rail: !!this.railPts,
        };
    }

    nearNodes(x, z, r) {
        const O = this.O, out = [];
        const c = O.cell;
        const i0 = Math.floor((x - r) / c) - 1, i1 = Math.ceil((x + r) / c) + 1;
        const j0 = Math.floor((z - r) / c) - 1, j1 = Math.ceil((z + r) / c) + 1;
        for (let i = i0; i <= i1; ++i) for (let j = j0; j <= j1; ++j) { const id = this.nodeAt.get(this.key(i, j)); if (id != null) out.push(id); }
        return out;
    }
    hasLatticeNode(id) { const n = this.nodes[id]; return !!n && n.i != null; }

    /**
     * Splitting an edge to snap a river or a spur to it leaves short stumps, and a 4 m street is not a street — it is a junction artifact with an
     *    id. So each end of one is merged into its neighbour: the surviving edges are rewired, the stump disappears, and parallel duplicates that
     *    the rewiring creates are dropped. Free alignments are chained polylines and are left alone.
     */
    collapse() {
        for (let pass = 0; pass < 8; ++pass) {
            const at = new Map();
            for (const e of this.edges.values()) {
                if (!e.keep) continue;
                for (const id of [e.a, e.b]) { if (!at.has(id)) at.set(id, []); at.get(id).push(e); }
            }
            let did = 0;
            for (const [id, list] of at) {
                if (!list.length || list.length > 2) continue;
                const A = this.nodes[id];
                if (!A) continue;
                let best = null;
                for (const e of list) {
                    if (e.freeId != null || e.path) continue;
                    const o = this.nodes[e.a === id ? e.b : e.a];
                    if (!o) continue;
                    const l = Math.hypot(o.x - A.x, o.z - A.z);
                    if (l > 48) continue;
                    if (!best || l < best.l) best = { e, l, o };
                }
                if (!best) continue;
                const keepId = best.o.id;
                if (this.nodes[id].i != null && this.nodes[keepId].i != null) {
                    // Two lattice nodes may not merge: they are the block grid, and collapsing one would shift a whole row of corners.
                    if (best.l > 24) continue;
                }
                for (const e of list) {
                    if (e === best.e) { e.keep = 0; continue; }
                    const other = e.a === id ? e.b : e.a;
                    if (other === keepId) { e.keep = 0; did++; continue; }
                    if (this.hasEdgeBetween(other, keepId)) { e.keep = 0; did++; continue; }
                    if (e.a === id) e.a = keepId; else e.b = keepId;
                    const O = this.nodes[other];
                    if (O && Math.hypot(O.x - this.nodes[keepId].x, O.z - this.nodes[keepId].z) < 8) e.keep = 0;
                    did++;
                }
                if (this.nodes[id].i != null) this.nodeAt.delete(this.key(this.nodes[id].i, this.nodes[id].j));
                delete this.nodes[id];
            }
            if (!did) break;
        }
        // Collapsing rewires endpoints, so two map entries can now describe the same pair of nodes. Keep the longer span and re-key it.
        const seen = new Map();
        for (const e of Array.from(this.edges.values())) {
            if (!e.keep) { this.edges.delete(e.key); continue; }
            const key = Math.min(e.a, e.b) + ':' + Math.max(e.a, e.b);
            const prev = seen.get(key);
            const len = (x) => { const A = this.nodes[x.a], B = this.nodes[x.b]; return A && B ? Math.hypot(A.x - B.x, A.z - B.z) : 0; };
            if (prev && len(prev) >= len(e)) { e.keep = 0; this.edges.delete(e.key); continue; }
            if (prev) { prev.keep = 0; this.edges.delete(prev.key); }
            if (e.key !== key) { this.edges.delete(e.key); e.key = key; this.edges.set(key, e); }
            seen.set(key, e);
        }
    }
    /**
     * A degree-two node between two short spans is a waypoint wearing a road's clothes: it costs a junction, a trim and a mesh seam for nothing.
     *    Same profile, same class, no block corner involved — so dissolve it into one alignment.
     */
    mergeMicroRoads(maxLen) {
        for (let pass = 0; pass < 6; ++pass) {
            const deg = new Map(), byNode = new Map();
            for (const r of this.doc.roads) {
                for (const n of [r.nodeA, r.nodeB]) if (n != null) {
                    deg.set(n, (deg.get(n) || 0) + 1);
                    if (!byNode.has(n)) byNode.set(n, []);
                    byNode.get(n).push(r);
                }
            }
            const len = (r) => { let a = 0; for (let i = 1; i < r.points.length; ++i) a += Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].z - r.points[i - 1].z); return a; };
            let did = 0;
            for (const r of this.doc.roads) {
                if (r._gone || len(r) > maxLen) continue;
                for (const n of [r.nodeA, r.nodeB]) {
                    if (n == null || deg.get(n) !== 2) continue;
                    const node = this.nodes[n];
                    if (!node || node.i != null) continue;                       // [-] lattice corners are intersections even at degree two
                    const q = (byNode.get(n) || []).find((o) => o !== r && !o._gone);
                    if (!q || q.profile !== r.profile || q.cls !== r.cls) continue;
                    if (len(q) > maxLen * 3) continue;
                    const otherEnd = r.nodeA === n ? r.nodeB : r.nodeA;
                    const qOther = q.nodeA === n ? q.nodeB : q.nodeA;
                    const ptsQ = q.nodeA === n ? q.points : q.points.slice().reverse();
                    const ptsR = r.nodeA === n ? r.points : r.points.slice().reverse();
                    q.points = ptsQ.concat(ptsR.slice(1));
                    q.nodeA = qOther; q.nodeB = otherEnd;
                    const a0 = this.nodes[qOther], b0 = this.nodes[otherEnd];
                    q.y0 = a0 ? a0.y ?? q.y0 : q.y0; q.y1 = b0 ? b0.y ?? q.y1 : q.y1;
                    if (r.bumps && r.bumps.length) q.bumps = (q.bumps || []).concat(r.bumps);
                    r._gone = 1; delete this.nodes[n]; did++;
                    break;
                }
            }
            if (!did) break;
            this.doc.roads = this.doc.roads.filter((r) => !r._gone);
        }
        this.doc.roads = this.doc.roads.filter((r) => !r._gone);
    }
    hasEdgeBetween(a, b) {
        for (const e of this.edges.values()) if (e.keep && ((e.a === a && e.b === b) || (e.a === b && e.b === a))) return true;
        return false;
    }
    nearEdges(p0, p1) {
        const O = this.O, c = O.cell, out = new Set();
        const x0 = Math.min(p0.x, p1.x) - c, x1 = Math.max(p0.x, p1.x) + c;
        const z0 = Math.min(p0.z, p1.z) - c, z1 = Math.max(p0.z, p1.z) + c;
        for (let i = Math.floor(x0 / c) - 1; i <= Math.ceil(x1 / c) + 1; ++i) {
            for (let j = Math.floor(z0 / c) - 1; j <= Math.ceil(z1 / c) + 1; ++j) {
                const id = this.nodeAt.get(this.key(i, j));
                if (id == null) continue;
                for (const other of this.nearNodes(this.nodes[id].x, this.nodes[id].z, c * 1.2)) {
                    const k = id < other ? id + ':' + other : other + ':' + id;
                    const e = this.edges.get(k); if (e && e.keep) out.add(e);
                }
            }
        }
        return Array.from(out);
    }
    segNearPolyline(a, b, poly, r) {
        for (let k = 1; k < poly.length; ++k) {
            const c = poly[k - 1], d = poly[k];
            if (segIntersect(a, b, c, d)) return true;
            if (ptSegDist(a, c, d) < r || ptSegDist(b, c, d) < r || ptSegDist(c, a, b) < r) return true;
        }
        return false;
    }

    /** Lift streets over water and over the mainline: split at the obstacle, deck across, taper back down. */
    structure() {
        const O = this.O;
        const obs = this.free.filter((f) => (f.water && !f.closed) || (f.rail && f.grade === 'separated') || f.deck);
        for (const f of obs) {
            const fp = f_pts(f);
            const half = (f.width ? f.width * 0.5 : 9) + (f.water ? 6 : 4);
            for (const e of Array.from(this.edges.values())) {
                if (!e.keep || e.noJunction || e.cls === 'water') continue;
                const A = this.nodes[e.a], B = this.nodes[e.b];
                const hit = this.segHitsPolyline(A, B, fp);
                if (!hit) continue;
                const len = Math.hypot(B.x - A.x, B.z - A.z);
                const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
                const along = Math.hypot(hit.x - A.x, hit.z - A.z) * Math.sign(dx * (hit.x - A.x) + dz * (hit.z - A.z));
                const span = Math.min(len * 0.46, half + 26);
                const s0 = clamp(along - span, 4, len - 4), s1 = clamp(along + span, 4, len - 4);
                if (s1 - s0 < 8) continue;
                const p0 = { x: A.x + dx * s0, z: A.z + dz * s0 }, p1 = { x: A.x + dx * s1, z: A.z + dz * s1 };
                const deck = f.deck ?? (f.water ? 5.4 : 6.6);
                const n0 = this.addNode(p0.x, p0.z, deck, 'abutment');
                const e1 = this.attachToEdge(e, p0.x, p0.z, 'abutment');
                if (!e1) { delete this.nodes[n0]; continue; }
                const e2 = this.attachToEdge(e1.e2, p1.x, p1.z, 'abutment');
                if (!e2) continue;
                const mid = e2.e1;
                const other = this.nodes[e2.e2.b];
                this.nodes[e1.e1.b].y = deck; this.nodes[mid.b].y = deck;
                mid.profile = 'BRIDGE-2x2';
                mid.struct = 'bridge'; mid.deck = deck; mid.noEndJunction = true;
                mid.cls = e.cls === 'local' ? 'collector' : e.cls;
                void other;
                // Nothing may cross the deck: a street running through a bridge is geometry fighting in mid-air.
                const deckPoly = [this.nodes[e1.e1.b], this.nodes[mid.b]];
                for (const o of Array.from(this.edges.values())) {
                    if (!o.keep || o === e1.e1 || o === mid || o === e2.e2) continue;
                    if (this.segNearPolyline(this.nodes[o.a], this.nodes[o.b], deckPoly, 7)) o.keep = 0;
                }
                void s0; void s1; void along;
            }
        }
    }
    segHitsPolyline(a, b, poly) {
        for (let k = 1; k < poly.length; ++k) { const h = segIntersect(a, b, poly[k - 1], poly[k]); if (h) return h; }
        return null;
    }

    wantHumps(e) {
        if (e.cls !== 'local' && e.cls !== 'collector') return false;
        if (e.zone === 'industrial' || e.zone === 'vacant' || e.zone === 'park') return false;
        return hash3(e.a, e.b, 71) < 0.22;
    }
    humpsFor(road) {
        const L = Math.hypot(road.points[1].x - road.points[0].x, road.points[1].z - road.points[0].z);
        const out = [];
        const n = Math.max(1, Math.floor(L / 95));
        for (let k = 1; k <= n; ++k) out.push({ s: (k / (n + 1)) * L, w: 3.6, h: 0.095 });
        return out;
    }

    /** The heart of the character: class + zone + style decides the assembled cross-section. */
    pickProfile(e) {
        const O = this.O, st = this.st;
        const h = hash3(e.a, e.b, 101);
        const zone = e.zone || 'residential';
        const near = (a, b) => a + (b - a) * h;
        if (e.cls === 'highway') return h < 0.5 ? 'HWY-2x2' : 'HWY-3x3';
        if (e.cls === 'rail') return 'RAIL-2T';
        if (e.cls === 'water') return 'RIVER';
        if (e.cls === 'path') return h < 0.4 ? 'PATH-PEDE' : h < 0.75 ? 'PATH-BIKE' : 'PATH-BRICK';
        if (e.spur) return O.style === 'sprawl' ? 'RES-CUL' : 'RES-CUL';
        if (e.cls === 'arterial') {
            if (zone === 'cbd') return O.bus && h < 0.55 ? 'ART-3x3' : 'ART-2x2-MED';
            if (zone === 'park') return 'BLVD-TREE';
            if (zone === 'industrial') return O.bike ? 'ART-2' : 'EXPRESS-2x2';
            if (h < st.brick) return 'ART-BRICK';
            if (O.style === 'dutch' && O.bike) return 'DUTCH-2x2';
            if (O.bus && h < 0.5) return 'ART-2x2-MED';
            if (O.style === 'sprawl' && h > 0.6) return 'ART-3x3';
            return 'ART-2';
        }
        if (e.cls === 'collector') {
            if (zone === 'park') return 'COL-PARKWAY';
            if (zone === 'cbd' && h < 0.45) return e.oneWay ? 'ONEWAY-3' : 'ART-2';
            if (O.bike && h < 0.5) return 'COL-2B';
            if (zone === 'industrial') return 'COL-2';
            return 'COL-2';
        }
        // local
        if (zone === 'cbd') { if (h < 0.4) return O.bike ? 'RES-2B' : 'RES-2'; if (h < 0.55) return 'ONEWAY-2-BUS'; if (h < st.brick) return 'MAIN-ST'; return 'RES-2'; }
        if (zone === 'industrial') return h < 0.45 ? 'SERV-1' : 'COL-2';
        if (zone === 'vacant') return h < 0.6 ? 'GRAVEL' : 'RES-2';
        if (zone === 'park') return h < 0.5 ? 'COL-PARKWAY' : 'RES-2';
        if (h < st.brick * 2.2) return h < st.brick ? 'CALLE-30' : 'MAIN-ST';
        if (O.parking && O.bike && h < 0.45) return 'RES-2B';
        if (O.parking) return 'RES-2';
        return 'RES-CONN';
    }

    /** Block interiors: one polygon per lattice cell, split into strips so lots read like real parcels. */
    buildLots() {
        const O = this.O, c = O.cell, n = Math.floor(O.half / c);
        const kept = this.edges;
        const has = (a, b) => { const k = Math.min(a, b) + ':' + Math.max(a, b); const e = kept.get(k); return e && e.keep; };
        let budget = 2600;
        for (let i = -n; i <= n && budget > 0; ++i) {
            for (let j = -n; j <= n && budget > 0; ++j) {
                const a = this.node(i, j), b = this.node(i + 1, j), cc = this.node(i + 1, j + 1), d = this.node(i, j + 1);
                if (a == null || b == null || cc == null || d == null) continue;
                const A = this.nodes[a], B = this.nodes[b], C = this.nodes[cc], D = this.nodes[d];
                const mx = (A.x + C.x) / 2, mz = (A.z + C.z) / 2;
                const zone = this.zoneOf(mx, mz);
                if (zone === 'vacant' && hash3(i, j, 51) < 0.5) continue;
                const openEdges = [has(a, b), has(b, cc), has(cc, d), has(d, a)].filter(Boolean).length;
                if (openEdges < 2) continue;                     // [-] not a block we can define
                budget--;
                const mat = zone === 'park' ? MAT.GRASS : zone === 'industrial' ? MAT.GRAVEL : zone === 'cbd' ? MAT.CONCRETE_SLAB : hash3(i, j, 53) < 0.18 ? MAT.ASPHALT_OLD : MAT.GRASS;
                const splits = zone === 'residential' || zone === 'cbd' ? 2 + (hash3(i, j, 55) < 0.5 ? 1 : 0) : 1;
                for (let k = 0; k < splits; ++k) {
                    const u0 = k / splits, u1 = (k + 1) / splits;
                    const inset = 0.35 + hash3(i, j, k + 57) * 0.3;
                    const P = (u, v) => ({
                        x: lerp(lerp(A.x, B.x, u), lerp(D.x, C.x, u), v) + (hash3(i * 7 + k, j, 59) - 0.5) * inset,
                        z: lerp(lerp(A.z, B.z, u), lerp(D.z, C.z, u), v) + (hash3(i, j * 7 + k, 61) - 0.5) * inset,
                    });
                    this.doc.lots.push({
                        p: [P(u0, 0.02), P(u1, 0.02), P(u1, 0.98), P(u0, 0.98)],
                        mat, y: null, zone, i, j,
                    });
                }
            }
        }
    }
    zoneTally() {
        const t = {};
        for (const e of this.edges.values()) if (e.keep) t[e.zone || 'residential'] = (t[e.zone || 'residential'] || 0) + 1;
        return t;
    }
}

const f_pts = (f) => (f._fair || (f._fair = f.spur || f.path || f.rail || f.metro || f.ring || f.radial ? catmullPolyline(f.pts, 6, !!f.closed) : f.pts));

function ptSegDist(p, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const u = l2 > 1e-9 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1) : 0;
    return Math.hypot(p.x - a.x - dx * u, p.z - a.z - dz * u);
}

/** Every profile the generator may reach for — used by the UI to validate and by the asset browser to offer the rest. */
export const GENERATOR_PROFILES = PROFILE_IDS;
export { polyLength };

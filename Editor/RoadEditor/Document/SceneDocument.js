//============================================================================================================================================
// 📦 Editor/RoadEditor/Document/SceneDocument.js — The one model everything else reads
//============================================================================================================================================
// Roads are polylines whose ends reference shared nodes; that sharing is the whole intersection model — snap an end to a node and the junction, its
//    fillets and its patch come out of the bake. Every mutation here records an inverse operation, so undo is exact rather than a snapshot of the
//    world, and a drag that ends where it started records nothing at all. Layers are visibility masks that the bake also honours, which is what lets
//    a rail corridor or a park system be silenced without deleting it.
'use strict';

import { nearestOnPolyline, clamp } from '../Kernel/CurveKit.js';
import { PROFILE_IDS } from '../Kernel/ProfileSolver.js';

export const LAYERS = ['streets', 'paths', 'transit', 'water', 'terrain', 'props'];

export class SceneDocument {
    constructor() {
        this.reset();
    }
    reset() {
        this.roads = [];
        this.nodes = {};
        this.lots = [];
        this.transit = [];
        this.crossings = [];
        this.nextRoadId = 1;
        this.nextNodeId = 1;
        this.layers = Object.fromEntries(LAYERS.map((l) => [l, 1]));
        this.meta = { name: 'untitled', style: 'grid', seed: 1, terrain: 0 };
        this.selection = new Set();
        this.selectedNodes = new Set();
        this.version = 0;
        this._ops = null;
        this._listeners = new Map();
        this.settings = {};
        return this;
    }

    /* ── events ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    on(type, fn) { if (!this._listeners.has(type)) this._listeners.set(type, new Set()); this._listeners.get(type).add(fn); return () => this._listeners.get(type).delete(fn); }
    emit(type, payload) { for (const fn of this._listeners.get(type) || []) fn(payload); }

    /* ── history ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    /** @template T @param {string} label @param {() => T} mutate */
    transaction(label, mutate) {
        const nested = !!this._ops;
        if (!nested) this._ops = { label, undo: [], doc: this };
        let result;
        try {
            result = mutate();
        } finally {
            if (!nested) {
                const ops = this._ops;
                this._ops = null;
                if (ops.undo.length) { this.emit('record', ops); this.emit('change', { reason: label }); }
            }
        }
        if (!nested) this.version++;
        return result;
    }
    _record(op) { if (this._ops) this._ops.undo.push(op); }
    /** Applies ops in the given direction; `dir` is -1 for undo, +1 for redo. */
    applyOps(ops, dir) {
        for (let k = dir < 0 ? ops.length - 1 : 0; dir < 0 ? k >= 0 : k < ops.length; k += dir) applyOp(this, ops[k], dir);
        this.version++;
        this.emit('change', { reason: 'history' });
    }

    /* ── nodes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    nodeAt(x, z, tol = 0.35) {
        for (const key in this.nodes) {
            const n = this.nodes[key];
            if (Math.hypot(n.x - x, n.z - z) <= tol) return n;
        }
        return null;
    }
    addNode(x, z, y = 0) {
        const hit = this.nodeAt(x, z, 0.35);
        if (hit) return hit.id;
        return this.transaction('Add node', () => {
            const id = this.nextNodeId++;
            const node = { id, x, z, y };
            this.nodes[id] = node;
            this._record({ t: 'node.add', node: { ...node } });
            return id;
        });
    }
    degree(id) {
        let d = 0;
        for (const r of this.roads) if (r.nodeA === id || r.nodeB === id) d++;
        return d;
    }
    dropNodeIfUnused(id) {
        if (id == null || !this.nodes[id]) return;
        if (this.degree(id) > 0) return;
        this.transaction('Drop node', () => {
            const node = { ...this.nodes[id] };
            delete this.nodes[id];
            this._record({ t: 'node.del', node });
        });
    }
    moveNode(id, x, z, y) {
        const n = this.nodes[id];
        if (!n) return;
        const before = { x: n.x, z: n.z, y: n.y };
        if (Math.abs(before.x - x) < 1e-4 && Math.abs(before.z - z) < 1e-4 && (y == null || Math.abs(before.y - y) < 1e-4)) return;
        this.transaction('Move node', () => {
            n.x = x; n.z = z;
            if (y != null) n.y = y;
            for (const r of this.roads) {
                if (r.nodeA === id) { r.points[0].x = x; r.points[0].z = z; r.points[0].y = n.y; }
                if (r.nodeB === id) { const p = r.points[r.points.length - 1]; p.x = x; p.z = z; p.y = n.y; }
            }
            this._record({ t: 'node.move', id, before, after: { x, z, y: n.y } });
        });
    }

    /* ── roads ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    /**
     * @param {{profile:string, points:{x:number,z:number,y?:number}[], nodeA?:number, nodeB?:number, opts?:object}} spec
     * @returns {object} the road
     */
    addRoad(spec) {
        return this.transaction(spec.label || 'Add road', () => this._addRoad(spec));
    }
    _addRoad(spec) {
        const profile = PROFILE_IDS.includes(spec.profile) ? spec.profile : 'RES-2';
        const pts = spec.points.map((p) => ({ x: p.x, z: p.z, y: p.y ?? 0 }));
        if (pts.length < 2) throw new Error('a road needs two points');
        const road = {
            id: this.nextRoadId++,
            profile,
            points: pts,
            nodeA: spec.nodeA ?? null, nodeB: spec.nodeB ?? null,
            camber: spec.camber ?? 0.02,
            bumps: spec.bumps ? spec.bumps.slice() : [],
            markings: spec.markings ?? 1,
            struct: spec.struct,
            slope: spec.slope,
            electrified: spec.electrified ?? 0,
            curbRadius: spec.curbRadius,
            noJunction: spec.noJunction ? 1 : 0,
            noStructure: spec.noStructure ? 1 : 0,
            layer: spec.layer || layerFor(profile),
            cls: spec.cls,
            grade: spec.grade,
            gaps: spec.gaps ? spec.gaps.slice() : undefined,
        };
        this.roads.push(road);
        this._record({ t: 'road.add', road: clone(road) });
        // An end without a node is a dead end; give it one so future edits can snap to it and the cap solver can find it.
        if (road.nodeA == null) road.nodeA = this.addNode(pts[0].x, pts[0].z, pts[0].y);
        if (road.nodeB == null) road.nodeB = this.addNode(pts[pts.length - 1].x, pts[pts.length - 1].z, pts[pts.length - 1].y);
        this._record({ t: 'road.ends', id: road.id, before: { nodeA: null, nodeB: null }, after: { nodeA: road.nodeA, nodeB: road.nodeB } });
        return road;
    }
    /** Snap a road end onto an existing node, merging the free node if one was created. */
    attachEnd(roadId, which, nodeId) {
        const road = this.byId(roadId);
        if (!road) return;
        const key = 'node' + which;
        const before = road[key];
        if (before === nodeId) return;
        this.transaction('Attach end', () => {
            road[key] = nodeId;
            const n = this.nodes[nodeId];
            if (n) {
                const p = which === 'A' ? road.points[0] : road.points[road.points.length - 1];
                p.x = n.x; p.z = n.z; p.y = n.y ?? 0;
            }
            this._record({ t: 'road.end', id: roadId, which, before, after: nodeId });
            if (before != null) this.dropNodeIfUnused(before);
        });
    }
    removeRoad(id) {
        this.transaction('Delete road', () => {
            const i = this.roads.findIndex((r) => r.id === id);
            if (i < 0) return;
            const road = this.roads[i];
            const ends = [road.nodeA, road.nodeB];
            this.roads.splice(i, 1);
            this._record({ t: 'road.del', index: i, road: clone(road) });
            for (const e of ends) this.dropNodeIfUnused(e);
            this.selection.delete(id);
        });
    }
    removeRoads(ids) {
        this.transaction('Delete roads', () => { for (const id of ids) this.removeRoad(id); });
    }
    byId(id) { return this.roads.find((r) => r.id === id) || null; }
    setRoad(roadId, key, value) {
        const road = this.byId(roadId);
        if (!road || road[key] === value) return;
        this.transaction('Set road field', () => {
            const before = road[key];
            road[key] = value;
            this._record({ t: 'road.set', id: roadId, key, before, after: value });
        });
    }
    /** Applies one key to every selected road: the inspector's batch path. */
    setRoads(ids, key, value) {
        this.transaction('Set ' + key, () => { for (const id of ids) this.setRoad(id, key, value); });
    }
    /** Insert a waypoint at the nearest point on the centreline — the core of "pull a curve out of a straight". */
    insertPoint(roadId, x, z) {
        const road = this.byId(roadId);
        if (!road) return -1;
        // (the transaction is opened below)
        const near = nearestOnPolyline(road.points, x, z);
        const i = clamp(near.i, 1, road.points.length - 1);
        const p = { x: near.x, y: lerpY(road.points, near), z: near.z };
        this.transaction('Insert point', () => {
            road.points.splice(i, 0, p);
            this._record({ t: 'point.add', id: roadId, index: i, point: { ...p } });
        });
        return i;
    }
    movePoint(roadId, index, x, z, y) {
        const road = this.byId(roadId);
        if (!road || !road.points[index]) return;
        const p = road.points[index];
        const before = { x: p.x, y: p.y ?? 0, z: p.z };
        if (Math.abs(before.x - x) < 1e-4 && Math.abs(before.z - z) < 1e-4) return;
        const endpoint = index === 0 ? 'A' : index === road.points.length - 1 ? 'B' : null;
        this.transaction('Move point', () => {
            p.x = x; p.z = z;
            if (y != null) p.y = y;
            if (endpoint && road['node' + endpoint] != null) {
                const n = this.nodes[road['node' + endpoint]];
                if (n) { n.x = x; n.z = z; if (y != null) n.y = y; }
            }
            this._record({ t: 'point.move', id: roadId, index, before, after: { x, y: p.y ?? 0, z } });
        });
    }
    removePoint(roadId, index) {
        const road = this.byId(roadId);
        if (!road || road.points.length <= 2 || !road.points[index]) return;
        const p = road.points.splice(index, 1)[0];
        this._record({ t: 'point.del', id: roadId, index, point: { ...p } });
    }
    /** Split a road at its nearest point to (x,z), creating a real intersection node — the tool that turns a cross into four junctions. */
    splitRoad(roadId, x, z) {
        const road = this.byId(roadId);
        if (!road) return null;
        const near = nearestOnPolyline(road.points, x, z);
        const i = clamp(near.i, 1, road.points.length - 1);
        const point = { x: near.x, y: lerpY(road.points, near), z: near.z };
        return this.transaction('Split road', () => {
            const pre = { a: { id: road.id, points: road.points.map((p) => ({ ...p })), nodeA: road.nodeA, nodeB: road.nodeB }, b: null };
            const head = road.points.slice(0, i).map((p) => ({ ...p }));
            const tail = road.points.slice(i).map((p) => ({ ...p }));
            head.push({ ...point });
            tail.unshift({ ...point });
            const other = { ...clone(road), id: this.nextRoadId++, points: tail, nodeA: null };
            road.points = head;
            road.nodeB = null;
            const nodeId = this.addNode(point.x, point.z, point.y);
            road.nodeB = nodeId;
            other.nodeA = nodeId;
            this.roads.push(other);
            const post = { a: { id: road.id, points: road.points.map((p) => ({ ...p })), nodeA: road.nodeA, nodeB: road.nodeB }, b: clone(other) };
            this._record({ t: 'road.split', pre, post, nodeId });
            return other;
        });
    }
    /** Reverse a one-way street, keeping its profile. */
    setNodeField(id, key, value) {
        const n = this.nodes[id];
        if (!n || n[key] === value) return;
        this.transaction('Set node field', () => {
            const before = n[key];
            n[key] = value;
            this._record({ t: 'node.set', id, key, before, after: value });
        });
    }
    addLot(lot) { this.transaction('Add lot', () => { this.lots.push(lot); this._record({ t: 'lot.add', lot }); }); }
    addTransit(line) { return this.transaction('Add transit line', () => { this.transit.push(line); this._record({ t: 'transit.add', line }); return line; }); }
    setLayer(name, on) {
        if (this.layers[name] === (on ? 1 : 0)) return;
        this.transaction('Toggle layer', () => {
            const before = this.layers[name];
            this.layers[name] = on ? 1 : 0;
            this._record({ t: 'layer.set', name, before, after: this.layers[name] });
        });
        this.emit('change', { reason: 'layer' });
    }
    clearAll() {
        this.transaction('Clear', () => {
            for (const r of this.roads.slice()) this.removeRoad(r.id);
            for (const key in this.nodes) this.dropNodeIfUnused(+key);
            this.lots.length = 0;
            this.transit.length = 0;
        });
    }
    reverse(roadId) {
        const road = this.byId(roadId);
        if (!road) return;
        this.transaction('Reverse', () => {
            road.points.reverse();
            const a = road.nodeA; road.nodeA = road.nodeB; road.nodeB = a;
            this._record({ t: 'road.reverse', id: roadId });
        });
    }
    select(ids, additive) {
        if (!additive) this.selection.clear();
        for (const id of ids) { if (id == null) continue; if (this.selection.has(id)) { if (additive) this.selection.delete(id); } else this.selection.add(id); }
        this.emit('selection', Array.from(this.selection));
    }
    pick(x, z, radius = 6) {
        let best = null, bd = radius;
        for (const r of this.roads) {
            if (!this.layers[r.layer || 'streets']) continue;
            const near = nearestOnPolyline(r.points, x, z);
            if (near.dist < bd) { bd = near.dist; best = { road: r, near, dist: near.dist }; }
        }
        return best;
    }
    pickNode(x, z, radius = 8) {
        let best = null, bd = radius;
        for (const key in this.nodes) {
            const n = this.nodes[key];
            const d = Math.hypot(n.x - x, n.z - z);
            if (d < bd) { bd = d; best = n; }
        }
        return best;
    }
    /** The document the bake should see: hidden layers are filtered out rather than deleted. */
    forBake() {
        const keep = (r) => this.layers[r.layer || 'streets'];
        const roads = this.roads.filter(keep);
        const used = new Set();
        for (const r of roads) { if (r.nodeA != null) used.add(r.nodeA); if (r.nodeB != null) used.add(r.nodeB); }
        const nodes = {};
        for (const id of used) if (this.nodes[id]) nodes[id] = this.nodes[id];
        return {
            roads, nodes,
            lots: this.layers.terrain ? this.lots : [],
            transit: this.layers.transit ? this.transit : [],
            crossings: [],
            meta: this.meta,
        };
    }
    stats() {
        let km = 0;
        for (const r of this.roads) for (let i = 1; i < r.points.length; ++i) km += Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].z - r.points[i - 1].z);
        const deg = new Map();
        for (const r of this.roads) {
            for (const n of [r.nodeA, r.nodeB]) if (n != null) deg.set(n, (deg.get(n) || 0) + 1);
        }
        let dead = 0, hub = 0;
        for (const [, d] of deg) { if (d === 1) dead++; else if (d >= 4) hub++; }
        return { roads: this.roads.length, nodes: Object.keys(this.nodes).length, km: km / 1000, dead, hubs: hub, lots: this.lots.length, version: this.version };
    }
    bbox() {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const r of this.roads) for (const p of r.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
        if (!isFinite(x0)) return null;
        return { x0, x1, z0, z1 };
    }
    serialize() {
        return JSON.stringify({
            v: 3, meta: this.meta, nextRoadId: this.nextRoadId, nextNodeId: this.nextNodeId, layers: this.layers, settings: this.settings,
            nodes: Object.values(this.nodes), roads: this.roads, lots: this.lots, transit: this.transit,
        });
    }
    load(json, label = 'Import') {
        const data = typeof json === 'string' ? JSON.parse(json) : json;
        this.transaction(label, () => {
            for (const r of this.roads.slice()) this.removeRoad(r.id);
            for (const key in this.nodes) delete this.nodes[key];
            this.lots.length = 0; this.transit.length = 0;
            const nodeList = Array.isArray(data.nodes) ? data.nodes : Object.values(data.nodes || {});
            for (const n of nodeList) { this.nodes[n.id] = n; this.nextNodeId = Math.max(this.nextNodeId, n.id + 1); }
            for (const r of (Array.isArray(data.roads) ? data.roads : Object.values(data.roads || {})) || []) {
                this.roads.push(r);
                this.nextRoadId = Math.max(this.nextRoadId, r.id + 1);
                this._record({ t: 'road.del', index: this.roads.length - 1, road: clone(r) });
            }
            for (const l of data.lots || []) { this.lots.push(l); this._record({ t: 'lot.add', lot: l }); }
            for (const t of data.transit || []) { this.transit.push(t); this._record({ t: 'transit.add', line: t }); }
            this.meta = data.meta || this.meta;
            this.layers = { ...this.layers, ...(data.layers || {}) };
            this.settings = data.settings || {};
        });
        this.selection.clear();
        this.emit('change', { reason: label });
        return this;
    }
}

function layerFor(profile) {
    if (/^PATH|^PROMENADE|^BOARDWALK/.test(profile)) return 'paths';
    if (/^RAIL|^METRO/.test(profile)) return 'transit';
    if (profile === 'RIVER') return 'water';
    return 'streets';
}
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Elevation of the nearest-point projection, so a split or an insert does not flatten a graded road. */
function lerpY(pts, near) {
    const a = pts[near.i - 1], b = pts[near.i];
    if (!a || !b) return 0;
    return (a.y ?? 0) * (1 - near.u) + (b.y ?? 0) * near.u;
}

function applyOp(doc, op, dir) {
    const set = (obj, key, v) => { obj[key] = v; };
    switch (op.t) {
        case 'node.add': if (dir < 0) delete doc.nodes[op.node.id]; else doc.nodes[op.node.id] = { ...op.node }; break;
        case 'node.del': if (dir < 0) doc.nodes[op.node.id] = { ...op.node }; else delete doc.nodes[op.node.id]; break;
        case 'node.move': { const n = doc.nodes[op.id]; if (n) { const v = dir < 0 ? op.before : op.after; set(n, 'x', v.x); set(n, 'z', v.z); if (v.y != null) set(n, 'y', v.y); } break; }
        case 'road.add': if (dir < 0) { const i = doc.roads.findIndex((r) => r.id === op.road.id); if (i >= 0) doc.roads.splice(i, 1); } else doc.roads.push(clone(op.road)); break;
        case 'road.del': if (dir < 0) doc.roads.splice(Math.min(op.index, doc.roads.length), 0, clone(op.road)); else { const i = doc.roads.findIndex((r) => r.id === op.road.id); if (i >= 0) doc.roads.splice(i, 1); } break;
        case 'road.set': { const r = doc.byId(op.id); if (r) set(r, op.key, dir < 0 ? op.before : op.after); break; }
        case 'node.set': { const n = doc.nodes[op.id]; if (n) set(n, op.key, dir < 0 ? op.before : op.after); break; }
        case 'layer.set': doc.layers[op.name] = dir < 0 ? op.before : op.after; break;
        case 'road.end': case 'road.ends': { const r = doc.byId(op.id); if (r) { const v = dir < 0 ? op.before : op.after; if (v) { for (const k of ['nodeA', 'nodeB']) if (v[k] !== undefined) r[k] = v[k]; } } break; }
        case 'road.reverse': { const r = doc.byId(op.id); if (r) { r.points.reverse(); const a = r.nodeA; r.nodeA = r.nodeB; r.nodeB = a; } break; }
        case 'point.add': { const r = doc.byId(op.id); if (!r) break; if (dir < 0) r.points.splice(op.index, 1); else r.points.splice(op.index, 0, { ...op.point }); break; }
        case 'point.del': { const r = doc.byId(op.id); if (!r) break; if (dir < 0) r.points.splice(op.index, 0, { ...op.point }); else r.points.splice(op.index, 1); break; }
        case 'point.move': { const r = doc.byId(op.id); if (!r || !r.points[op.index]) break; const v = dir < 0 ? op.before : op.after; const p = r.points[op.index]; p.x = v.x; p.z = v.z; if (v.y != null) p.y = v.y; break; }
        case 'road.split': {
            const state = dir < 0 ? op.pre : op.post;
            const a = doc.byId(state.a.id);
            if (a) { a.points = state.a.points.map((p) => ({ ...p })); a.nodeA = state.a.nodeA; a.nodeB = state.a.nodeB; }
            if (dir < 0) {
                const i = doc.roads.findIndex((r) => r.id === op.post.b.id);
                if (i >= 0) doc.roads.splice(i, 1);
                if (doc.degree(op.nodeId) === 0) delete doc.nodes[op.nodeId];
            } else if (state.b) {
                doc.roads.push(clone(state.b));
                doc.nodes[op.nodeId] = doc.nodes[op.nodeId] || { id: op.nodeId, x: state.a.points[state.a.points.length - 1].x, y: state.a.points[state.a.points.length - 1].y ?? 0, z: state.a.points[state.a.points.length - 1].z };
            }
            break;
        }
        case 'lot.add': if (dir < 0) { const i = doc.lots.indexOf(op.lot); if (i >= 0) doc.lots.splice(i, 1); } else doc.lots.push(op.lot); break;
        case 'transit.add': if (dir < 0) { const i = doc.transit.indexOf(op.line); if (i >= 0) doc.transit.splice(i, 1); } else doc.transit.push(op.line); break;
        default: break;
    }
}

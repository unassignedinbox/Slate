//============================================================================================================================================
// 📦 Editor/RoadEditor/Interaction/Snapper.js — One resolution order for every point the editor accepts
//============================================================================================================================================
// A click is not a coordinate: it is an intention that should snap to what is already there. This resolves a raw ground-plane point through the
//    same chain every tool uses — typed number, axis lock, node, then centreline, then grid — and reports what it locked to, which is what lets the
//    status line say "node 41" instead of shrugging. It is pure: the caller supplies the projection, so the whole policy is testable without a GPU.
'use strict';

import { clamp } from '../Kernel/CurveKit.js';

export const SNAP = { NONE: 'free', NUMBER: 'typed', AXIS: 'axis', NODE: 'node', LINE: 'line', GRID: 'grid', ANGLE: 'angle' };

/**
 * @param {object} ctx {
 *   doc, raw:{x,z}, project:(x,z,y)=>[sx,sy], from:{x,z}|null, opts:{
 *     grid:number|null, pxTol:number, nodes:boolean, lines:boolean, axis:'x'|'z'|null,
 *     ortho:number|null, angleLock:number|null, length:number|null, dir:{x,z}|null,
 *     elevation:number|null, terrain:(x,z)=>number|null
 *   }
 * }
 * @returns {{x:number,z:number,y:number,kind:string,node:number|null,road:number|null,note:string}}
 */
export function resolveSnap(ctx) {
    const { doc, raw, project, from, opts = {} } = ctx;
    let x = raw.x, z = raw.z, kind = SNAP.NONE, note = '';
    const node = null;
    // A typed number outranks everything: it is the only input the user chose rather than aimed at.
    if (opts.length != null && opts.dir && from) {
        const l = Math.hypot(opts.dir.x, opts.dir.z) || 1;
        x = from.x + (opts.dir.x / l) * opts.length;
        z = from.z + (opts.dir.z / l) * opts.length;
        kind = SNAP.NUMBER;
        note = `${opts.length.toFixed(2)} m`;
        if (opts.angleLock != null) {
            const a = opts.angleLock;
            x = from.x + Math.cos(a) * opts.length;
            z = from.z + Math.sin(a) * opts.length;
            note = `${(a * 180 / Math.PI).toFixed(1)}°  ${opts.length.toFixed(2)} m`;
            kind = SNAP.ANGLE;
        }
    }
    if (opts.ortho != null && from) {
        const dx = x - from.x, dz = z - from.z;
        const step = opts.ortho;
        const a = Math.round(Math.atan2(dz, dx) / step) * step;
        const len = Math.hypot(dx, dz);
        x = from.x + Math.cos(a) * len;
        z = from.z + Math.sin(a) * len;
        if (kind === SNAP.NONE) { kind = SNAP.ANGLE; note = `${(a * 180 / Math.PI).toFixed(0)}° ortho`; }
    }
    if (opts.axis && from) {
        if (opts.axis === 'x') z = from.z;
        else x = from.x;
        if (kind === SNAP.NONE) { kind = SNAP.AXIS; note = `locked ${opts.axis.toUpperCase()}`; }
    }
    if (kind !== SNAP.NUMBER && kind !== SNAP.ANGLE && kind !== SNAP.AXIS) {
        if (opts.nodes !== false && doc) {
            const hit = nearestNode(doc, x, z, project, opts.pxTol ?? 16);
            if (hit) {
                x = hit.x; z = hit.z;
                kind = SNAP.NODE;
                note = `node ${hit.id}`;
                if (opts.lockElevation !== false && hit.y != null) {
                    ctx.snapY = hit.y;
                }
            }
        }
        if (kind === SNAP.NONE && opts.lines !== false && doc) {
            const hit = nearestCentreline(doc, x, z, opts.worldTol ?? 2.4);
            if (hit) {
                x = hit.x; z = hit.z;
                kind = SNAP.LINE;
                note = `road ${hit.id} @ ${hit.s.toFixed(0)} m`;
                ctx.snapRoad = hit;
            }
        }
        if (kind === SNAP.NONE && opts.grid) {
            const g = opts.grid;
            x = Math.round(x / g) * g; z = Math.round(z / g) * g;
            kind = SNAP.GRID;
            note = `${g} m grid`;
        }
    }
    let y = opts.elevation ?? ctx.snapY ?? null;
    if (y == null && opts.terrain) y = opts.terrain(x, z);
    return { x, z, y: y ?? 0, kind, node: kind === SNAP.NODE ? note : null, road: ctx.snapRoad ? ctx.snapRoad.id : null, note: note || 'free' };
}

function nearestNode(doc, x, z, project, pxTol) {
    let best = null, bd = Infinity;
    for (const key in doc.nodes) {
        const n = doc.nodes[key];
        const d = Math.hypot(n.x - x, n.z - z);
        if (d > 40) continue;
        let score = d;
        if (project) {
            const [sx, sy] = project(n.x, n.z, n.y ?? 0);
            const [px, py] = project(x, z, n.y ?? 0);
            if (sx == null) continue;
            score = Math.hypot(sx - px, sy - py);
            if (score > pxTol) continue;
            score += d * 0.02;
        } else if (d > 6) continue;
        if (score < bd) { bd = score; best = n; }
    }
    return best;
}
function nearestCentreline(doc, x, z, worldTol) {
    let best = null, bd = worldTol;
    for (const r of doc.roads) {
        if (r.points.length < 2) continue;
        for (let i = 1; i < r.points.length; ++i) {
            const a = r.points[i - 1], b = r.points[i];
            const dx = b.x - a.x, dz = b.z - a.z;
            const l2 = dx * dx + dz * dz;
            if (l2 < 1e-9) continue;
            const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
            const px = a.x + dx * u, pz = a.z + dz * u;
            const d = Math.hypot(x - px, z - pz);
            if (d < bd) {
                bd = d;
                best = { id: r.id, x: px, z: pz, u, i, s: Math.sqrt(l2) * u, y: (a.y ?? 0) * (1 - u) + (b.y ?? 0) * u };
            }
        }
    }
    return best;
}

/** Grid step the UI offers; small steps only become available when zoomed in, so snapping never fights the mouse. */
export function gridSteps(zoomHeight) {
    const base = zoomHeight > 400 ? [0, 50, 100, 250] : zoomHeight > 120 ? [0, 5, 10, 25, 50] : [0, 0.5, 1, 2.5, 5, 10, 25];
    return base;
}
/** Direction the tool should extend along: the current rubber band, or the camera's gaze when there is nothing to follow. */
export function rubberDir(from, to, camera) {
    if (from && to) {
        const dx = to.x - from.x, dz = to.z - from.z;
        if (Math.hypot(dx, dz) > 1e-4) return { x: dx, z: dz };
    }
    // The fly camera keeps its own yaw; a raw three camera would have rotation.y. Either reads, and neither has to exist.
    const yaw = camera ? (camera.yaw ?? camera.rotation?.y ?? 0) : null;
    if (yaw != null) return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    return { x: 0, z: -1 };
}

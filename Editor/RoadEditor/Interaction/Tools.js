//============================================================================================================================================
// 📦 Editor/RoadEditor/Interaction/Tools.js — What each prompt means, per tool
//============================================================================================================================================
// Tools are data plus four small callbacks on top of ToolSession: pick a point, preview the rubber band, build the geometry, clean up. The important
//    one is the first: a drawn polyline is broken into roads at every existing node it passes through, because a node only becomes an intersection
//    when two road ends share it — and a road that "visually" crosses another without sharing a node is a crash, not a junction.
'use strict';

import { ToolSession } from './ToolSession.js';
import { getProfile, PROFILE_IDS, PROFILE_BY_CLASS } from '../Kernel/ProfileSolver.js';
import { nearestOnPolyline } from '../Kernel/CurveKit.js';

const SNAP_TOL = 1.2;

/** @param {object} ctx {doc, viewport, camera, settings, ui, project, terrain, currentProfile, history} */
export function makeTools(ctx) {
    const roadsThroughNodes = (points, doc) => {
        // Break the chain wherever an interior point sits on an existing node, so every end that can share a node does.
        const cuts = [0];
        for (let i = 1; i < points.length - 1; ++i) {
            const n = doc.nodeAt(points[i].x, points[i].z, SNAP_TOL);
            if (n) cuts.push(i);
        }
        cuts.push(points.length - 1);
        const spans = [];
        for (let k = 0; k + 1 < cuts.length; ++k) spans.push(points.slice(cuts[k], cuts[k + 1] + 1));
        return spans.filter((s) => s.length >= 2);
    };

    const draw = (profileDefault, label, id) => ({
        id, label,
        prompts: ['First point', 'Next point — Enter to finish', 'Next point'],
        group: 'Draw',
        start() {
            return new ToolSession({
                id, label, multi: true,
                prompts: ['Click a start point (or type x,z)', 'Click the next point — Enter finishes, right-click backs out', 'Continue'],
                snap: { nodes: true, lines: true },
                preview: (s) => ctx.ui?.previewTool?.(s),
                point: (s) => (s.points.length >= 2 && ctx.settings?.autoFinish ? 'commit' : undefined),
                commit: (pts) => {
                    const profile = ctx.currentProfile?.() || profileDefault;
                    if (pts.length < 2) { ctx.ui?.notify?.(`${label}: need two points`); return; }
                    const spans = roadsThroughNodes(pts, ctx.doc);
                    let made = 0;
                    ctx.doc.transaction(`Draw ${label}`, () => {
                        for (const sp of spans) {
                            const a = ctx.doc.nodeAt(sp[0].x, sp[0].z, SNAP_TOL);
                            const b = ctx.doc.nodeAt(sp[sp.length - 1].x, sp[sp.length - 1].z, SNAP_TOL);
                            const road = ctx.doc._addRoad({ profile, points: sp, nodeA: a ? a.id : null, nodeB: b ? b.id : null, label: `Draw ${label}` });
                            made++;
                            ctx.doc.selection.add(road.id);
                        }
                    });
                    ctx.ui?.notify?.(`${label}: ${made} road${made === 1 ? '' : 's'}`);
                    ctx.requestBake?.();
                },
            }, ctx);
        },
    });

    const tools = {
        select: {
            id: 'select', label: 'Select', group: 'Pick', prompts: ['Click a road'],
            instant: (p) => {
                const hit = ctx.doc.pick(p.x, p.z, Math.max(3.5, ctx.pickRadius ?? 6));
                ctx.doc.select(hit ? [hit.road.id] : [], false);
                ctx.ui?.syncSelection?.();
            },
        },
        road: draw(ctx.currentProfile?.() || 'RES-2', 'Street', 'road'),
        connect: {
            id: 'connect', label: 'Connect', group: 'Draw',
            prompts: ['Road A end', 'Road B end'],
            description: 'Snap two free ends together to close a block or form a T.',
        },
        moveNode: {
            id: 'moveNode', label: 'Move node', group: 'Edit',
            prompts: ['Node to move', 'New position'],
            start() {
                let picked = null;
                return new ToolSession({
                    id: 'moveNode', label: 'Move node',
                    prompts: ['Click the node', 'Click the new position'],
                    snap: { nodes: false, lines: true },
                    point: (s) => {
                        if (s.points.length === 1) {
                            picked = ctx.doc.pickNode(s.points[0].x, s.points[0].z, Math.max(10, (ctx.pickRadius ?? 6) * 1.8));
                            if (!picked) { ctx.ui?.notify?.('no node there'); return 'cancel'; }
                            return undefined;
                        }
                        const p = s.points[s.points.length - 1];
                        ctx.doc.moveNode(picked.id, p.x, p.z);
                        ctx.requestBake?.();
                        return 'commit';
                    },
                    preview: (s) => ctx.ui?.previewNode?.(picked, s.raw),
                    cancel: () => ctx.ui?.previewNode?.(null, null),
                }, ctx);
            },
        },
        radius: {
            id: 'radius', label: 'Corner radius', group: 'Edit',
            prompts: ['Corner', 'Radius [m]'],
            start() {
                let node = null;
                return new ToolSession({
                    id: 'radius', label: 'Corner radius',
                    prompts: ['Click the corner node', 'Type a radius, e.g. r12'],
                    snap: { nodes: true, lines: false },
                    point: (s) => {
                        if (s.points.length === 1) {
                            node = ctx.doc.pickNode(s.points[0].x, s.points[0].z, 14);
                            if (!node) { ctx.ui?.notify?.('no node there'); return 'cancel'; }
                            s.hint = `corner ${node.id} — type r<metres>`;
                            return undefined;
                        }
                        return undefined;
                    },
                    commit: (pts, s) => {
                        void pts;
                        const r = Math.abs(s.radius ?? 8);
                        if (!node) { ctx.ui?.notify?.('radius: pick a corner first'); return; }
                        const hit = ctx.doc.pick(node.x, node.z, 40);
                        if (!hit) { ctx.ui?.notify?.('radius: no road at that corner'); return; }
                        ctx.doc.setRoad(hit.road.id, 'curbRadius', clampRadius(r));
                        ctx.requestBake?.();
                    },
                }, ctx);
            },
        },
        split: {
            id: 'split', label: 'Split road', group: 'Edit', prompts: ['Road to split'],
            instant: (p) => {
                const hit = ctx.doc.pick(p.x, p.z, Math.max(3.5, ctx.pickRadius ?? 6));
                if (!hit) { ctx.ui?.notify?.('no road there'); return; }
                ctx.doc.splitRoad(hit.road.id, p.x, p.z);
                ctx.ui?.notify?.('split');
                ctx.requestBake?.();
            },
        },
        vertex: {
            id: 'vertex', label: 'Add vertex', group: 'Edit', prompts: ['Road to bend'],
            instant: (p) => {
                const hit = ctx.doc.pick(p.x, p.z, Math.max(3.5, ctx.pickRadius ?? 6));
                if (!hit) return;
                const near = nearestOnPolyline(hit.road.points, p.x, p.z);
                ctx.doc.insertPoint(hit.road.id, near.x, near.z);
                ctx.requestBake?.();
            },
        },
        remove: {
            id: 'remove', label: 'Delete', group: 'Edit', prompts: ['Road to delete'],
            instant: (p) => {
                const sel = Array.from(ctx.doc.selection);
                if (sel.length) { ctx.doc.removeRoads(sel); ctx.ui?.notify?.(`deleted ${sel.length}`); ctx.requestBake?.(); return; }
                const hit = ctx.doc.pick(p.x, p.z, Math.max(3.5, ctx.pickRadius ?? 6));
                if (hit) { ctx.doc.removeRoad(hit.road.id); ctx.requestBake?.(); }
            },
        },
        hump: {
            id: 'hump', label: 'Speed hump', group: 'Detail', prompts: ['Click where the hump goes'],
            instant: (p, s) => {
                const hit = ctx.doc.pick(p.x, p.z, Math.max(3.5, ctx.pickRadius ?? 6));
                if (!hit) return;
                const near = nearestOnPolyline(hit.road.points, p.x, p.z);
                let s0 = 0;
                for (let i = 1; i <= near.i; ++i) {
                    const a = hit.road.points[i - 1], b = hit.road.points[i];
                    if (i < near.i) s0 += Math.hypot(b.x - a.x, b.z - a.z);
                    else s0 += Math.hypot(b.x - a.x, b.z - a.z) * near.u;
                }
                const bumps = (hit.road.bumps || []).slice();
                bumps.push({ s: s0, w: s.humpWidth ?? 3.6, h: s.humpHeight ?? 0.09 });
                ctx.doc.setRoad(hit.road.id, 'bumps', bumps);
                ctx.requestBake?.();
            },
        },
        mark: {
            id: 'mark', label: 'Toggle markings', group: 'Detail', prompts: ['Click a road'],
            instant: (p) => {
                const hit = ctx.doc.pick(p.x, p.z, Math.max(3.5, ctx.pickRadius ?? 6));
                if (!hit) return;
                ctx.doc.setRoad(hit.road.id, 'markings', hit.road.markings ? 0 : 1);
                ctx.requestBake?.();
            },
        },
    };
    // The two ends of a road can be welded by a tool too; it is the same operation as drawing but it is what people reach for first.
    tools.connect.start = () => new ToolSession({
        id: 'connect', label: 'Connect',
        prompts: ['Click a free end', 'Click the other end'],
        snap: { nodes: true, lines: true },
        point: () => undefined,
        commit: (pts, s) => {
            const a = ctx.doc.pickNode(pts[0].x, pts[0].z, 16);
            const b = ctx.doc.pickNode(pts[1].x, pts[1].z, 16);
            if (!a || !b) { ctx.ui?.notify?.('connect needs two nodes'); return; }
            const ra = roadAt(ctx.doc, a.id), rb = roadAt(ctx.doc, b.id);
            if (!ra || !rb) return;
            ctx.doc.transaction('Connect', () => {
                ctx.doc.attachEnd(ra.road.id, ra.which, a.id);
                ctx.doc.attachEnd(rb.road.id, rb.which, a.id);
            });
            ctx.requestBake?.();
            void s;
        },
    }, ctx);

    return tools;
}
function roadAt(doc, nodeId) {
    for (const r of doc.roads) {
        if (r.nodeA === nodeId) return { road: r, which: 'A' };
        if (r.nodeB === nodeId) return { road: r, which: 'B' };
    }
    return null;
}
/** The kernel takes the kerb radius in metres, clamped to what a mountable corner can actually be. */
function clampRadius(r) { return Math.max(1.2, Math.min(44, r || 6)); }
export { clampRadius };
export { PROFILE_IDS, PROFILE_BY_CLASS };

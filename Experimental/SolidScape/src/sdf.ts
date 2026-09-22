//============================================================================================================================================
// SolidScape — SDF foundation: edit-tape document, graph compiler, CPU field evaluation and ray picking
//
// The node graph is compiled into a flat instruction tape (see docs/SDF-Research.md §10). Each instruction is 3 RGBA32F
// texels; the same tape is interpreted by the GPU raymarcher (sdfPass.ts) and by the CPU evaluator below for brush picking.
//
//   OP_PUSH    push a primitive distance onto the stack        a=[0, shape, 0, 0]        b=[x,y,z, p0]   c=[p1, ax, ay, az]  (ax/ay/az only for capsule shape 4)
//   OP_COMBINE pop two, push boolean combination               a=[1, mode,  k, 0]
//   OP_DAB     modify top of stack with a sculpt dab           a=[2, shape, k, mode]     b=[x,y,z, r]    c=[p1, ax, ay, az]
//
//   shape: 0 sphere · 1 rounded box · 2 capped cylinder · 3 ground plane · 4 capsule (axis = (ax,ay,az), halfLen = p1)
//   mode:  0 add (smooth union) · 1 carve (smooth subtraction) · 2 intersect (smooth intersection)
//============================================================================================================================================

import type { GraphSurface } from './graph';
import { CatalogueIndex } from './nodeCatalogue';

export const MaxInstructions     = 1024;
export const TexelsPerInstruction = 3;
export const FloatsPerInstruction = TexelsPerInstruction * 4;

export type ShapeType = 0 | 1 | 2 | 3 | 4;
export type BoolMode  = 0 | 1 | 2;

export const OP_PUSH    = 0;
export const OP_COMBINE = 1;
export const OP_DAB     = 2;

export interface DabRecord
{
    shape: ShapeType;
    mode:  BoolMode;
    x: number; y: number; z: number;
    r: number;                                        // radius / half-extent            [m]
    k: number;                                        // blend smoothness                [m]
    p1: number;                                       // shape extra (cylinder height / capsule halfLen) [m]
    ax?: number; ay?: number; az?: number;            // capsule axis (unit) — only for shape 4
}

export interface StrokeRecord
{
    node: string;                                     // primitive node uid the stroke is bound to
    dabs: DabRecord[];
}

export interface CompiledField
{
    data:      Float32Array;                          // MaxInstructions × FloatsPerInstruction
    count:     number;                                // instructions written
    truncated: boolean;                               // tape budget exceeded
    primitiveRanges: Map<string, { start: number; end: number }>;
}

const PrimitiveIds = new Set(['sdf-sphere', 'sdf-box', 'sdf-cylinder', 'sdf-plane']);
const CombineIds: Record<string, BoolMode> = { union: 0, subtract: 1, intersect: 2 };
const PassThroughInput: Record<string, string> =
{
    warp: 'in', terrace: 'in', erode: 'in', displace: 'in',
    'slope-mask': 'in', 'height-mask': 'in', mix: 'a', 'terrain-out': 'sdf',
};

//--------------------------------------------------------------------------------------------------------------------------
// Graph → tape compiler
//--------------------------------------------------------------------------------------------------------------------------
export function CompileField(graph: GraphSurface, strokes: StrokeRecord[]): CompiledField
{
    const data = new Float32Array(MaxInstructions * FloatsPerInstruction);
    const ranges = new Map<string, { start: number; end: number }>();
    let count = 0;
    let truncated = false;

    const Emit = (a: number[], b: number[] = [0, 0, 0, 0], c: number[] = [0, 0, 0, 0]): boolean =>
    {
        if (count >= MaxInstructions) { truncated = true; return false; }
        const o = count * FloatsPerInstruction;
        data.set(a, o); data.set(b, o + 4); data.set(c, o + 8);
        count += 1;
        return true;
    };

    // dabs grouped per primitive, global stroke order preserved
    const dabsByNode = new Map<string, DabRecord[]>();
    for (const s of strokes)
    {
        const list = dabsByNode.get(s.node) ?? [];
        list.push(...s.dabs);
        dabsByNode.set(s.node, list);
    }

    // input wire lookup
    const inputSource = new Map<string, string>();                        // "toNode:toPort" → fromNode
    for (const w of graph.wires.values()) inputSource.set(`${w.toNode}:${w.toPort}`, w.fromNode);

    const visiting = new Set<string>();

    const EvalNode = (uid: string): boolean =>
    {
        if (visiting.has(uid)) return false;                              // cycle guard
        const node = graph.nodes.get(uid);
        if (!node) return false;
        const spec = CatalogueIndex.get(node.specId);
        if (!spec) return false;
        visiting.add(uid);

        let produced = false;
        try
        {
            //------------------------------------------------------------ primitives
            if (PrimitiveIds.has(node.specId) && !node.muted)
            {
                const p = node.params;
                const start = count;
                let ok = false;
                switch (node.specId)
                {
                    case 'sdf-sphere':
                        ok = Emit([OP_PUSH, 0, 0, 0], [p['posX'] ?? 0, p['posY'] ?? 0, p['posZ'] ?? 0, p['radius'] ?? 10]);
                        break;
                    case 'sdf-box':
                        ok = Emit([OP_PUSH, 1, 0, 0], [p['posX'] ?? 0, p['posY'] ?? 0, p['posZ'] ?? 0, p['extent'] ?? 8],
                                  [Math.min(p['round'] ?? 0, (p['extent'] ?? 8) * 0.95), 0, 0, 0]);
                        break;
                    case 'sdf-cylinder':
                        ok = Emit([OP_PUSH, 2, 0, 0], [p['posX'] ?? 0, p['posY'] ?? 0, p['posZ'] ?? 0, p['radius'] ?? 6],
                                  [p['height'] ?? 16, 0, 0, 0]);
                        break;
                    case 'sdf-plane':
                        ok = Emit([OP_PUSH, 3, 0, 0], [0, p['offset'] ?? 0, 0, 0]);
                        break;
                }
                if (ok)
                {
                    for (const d of dabsByNode.get(uid) ?? [])
                    {
                        if (!Emit([OP_DAB, d.shape, d.k, d.mode], [d.x, d.y, d.z, d.r],
                                  [d.p1, d.ax ?? 0, d.ay ?? 0, d.az ?? 0])) break;
                    }
                    ranges.set(uid, { start, end: count });
                    produced = true;
                }
            }
            //------------------------------------------------------------ boolean combinators
            else if (node.specId in CombineIds && !node.muted)
            {
                const a = inputSource.get(`${uid}:a`);
                const b = inputSource.get(`${uid}:b`);
                const gotA = a ? EvalNode(a) : false;
                const gotB = b ? EvalNode(b) : false;
                if (gotA && gotB)
                {
                    produced = Emit([OP_COMBINE, CombineIds[node.specId], node.params['smooth'] ?? 0, 0]);
                }
                else produced = gotA || gotB;                              // single operand passes through
            }
            //------------------------------------------------------------ pass-through (deformers, masks, output) + muted nodes
            else
            {
                const portKey = PassThroughInput[node.specId]
                    ?? (spec.inputs.find((i) => i.type === 'field')?.key ?? '');
                const from = portKey ? inputSource.get(`${uid}:${portKey}`) : undefined;
                produced = from ? EvalNode(from) : false;
            }
        }
        finally { visiting.delete(uid); }
        return produced;
    };

    //---------------------------------------------------------------- root selection: terrain output chain + dangling field nodes
    const consumed = new Set<string>();
    for (const w of graph.wires.values()) consumed.add(w.fromNode);

    const roots: string[] = [];
    for (const n of graph.nodes.values()) if (n.specId === 'terrain-out') { roots.push(n.uid); break; }
    for (const n of graph.nodes.values())
    {
        if (n.specId === 'terrain-out' || consumed.has(n.uid)) continue;
        const spec = CatalogueIndex.get(n.specId);
        if (!spec || !spec.outputs.some((o) => o.type === 'field')) continue;
        roots.push(n.uid);
    }

    let emittedRoots = 0;
    for (const uid of roots)
    {
        if (EvalNode(uid))
        {
            emittedRoots += 1;
            if (emittedRoots > 1) Emit([OP_COMBINE, 0, 0, 0]);            // implicit hard union between roots
        }
    }

    return { data, count, truncated, primitiveRanges: ranges };
}

//--------------------------------------------------------------------------------------------------------------------------
// CPU evaluation — mirrors the GLSL interpreter exactly (used for brush picking and dab attribution)
//--------------------------------------------------------------------------------------------------------------------------
function SmoothUnion(a: number, b: number, k: number): number
{
    if (k <= 0) return Math.min(a, b);
    const h = Math.min(Math.max(0.5 + 0.5 * (b - a) / k, 0), 1);
    return b + (a - b) * h - k * h * (1 - h);
}

function SmoothSubtract(a: number, b: number, k: number): number
{
    if (k <= 0) return Math.max(a, -b);
    const h = Math.min(Math.max(0.5 - 0.5 * (a + b) / k, 0), 1);
    return a + (-b - a) * h + k * h * (1 - h);
}

function SmoothIntersect(a: number, b: number, k: number): number
{
    if (k <= 0) return Math.max(a, b);
    const h = Math.min(Math.max(0.5 - 0.5 * (b - a) / k, 0), 1);
    return b + (a - b) * h + k * h * (1 - h);
}

function ShapeDistance(shape: number, px: number, py: number, pz: number,
                       cx: number, cy: number, cz: number, p0: number, p1: number,
                       ax = 0, ay = 0, az = 0): number
{
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    switch (shape)
    {
        case 0:                                                            // sphere
            return Math.hypot(dx, dy, dz) - p0;
        case 1:                                                            // rounded box, half-extent p0, round p1
        {
            const e = p0 - p1;
            const qx = Math.abs(dx) - e, qy = Math.abs(dy) - e, qz = Math.abs(dz) - e;
            const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
            return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - p1;
        }
        case 2:                                                            // capped cylinder, radius p0, height p1
        {
            const rx = Math.hypot(dx, dz) - p0;
            const ry = Math.abs(dy) - p1 * 0.5;
            const mx = Math.max(rx, 0), my = Math.max(ry, 0);
            return Math.min(Math.max(rx, ry), 0) + Math.hypot(mx, my);
        }
        case 3:                                                            // ground plane at y = cy
            return py - cy;
        case 4:                                                            // capsule: segment centre c, halfLen p1, axis (ax,ay,az), radius p0
        {
            // closest point on segment [-axis*h, +axis*h] through c
            const h = p1;
            if (h <= 0.001) return Math.hypot(dx, dy, dz) - p0;            // degenerate → sphere
            // project pa onto axis
            const paX = dx, paY = dy, paZ = dz;
            const proj = paX * ax + paY * ay + paZ * az;
            const cproj = Math.max(-h, Math.min(h, proj));
            const cx2 = cproj * ax, cy2 = cproj * ay, cz2 = cproj * az;
            return Math.hypot(paX - cx2, paY - cy2, paZ - cz2) - p0;
        }
        default:
            return 1e9;
    }
}

export function EvalField(data: Float32Array, count: number,
                          px: number, py: number, pz: number,
                          start = 0, end = -1): number
{
    const stack = new Float64Array(16);
    let sp = 0;
    const last = end < 0 ? count : end;

    for (let i = start; i < last; i++)
    {
        const o = i * FloatsPerInstruction;
        const op = data[o];

        if (op === OP_PUSH)
        {
            if (sp < 16)
                stack[sp++] = ShapeDistance(data[o + 1], px, py, pz,
                    data[o + 4], data[o + 5], data[o + 6], data[o + 7], data[o + 8],
                    data[o + 9], data[o + 10], data[o + 11]);
        }
        else if (op === OP_COMBINE && sp >= 2)
        {
            const b = stack[--sp];
            const a = stack[sp - 1];
            const k = data[o + 2];
            const mode = data[o + 1];
            stack[sp - 1] = mode === 0 ? SmoothUnion(a, b, k)
                          : mode === 1 ? SmoothSubtract(a, b, k)
                          :              SmoothIntersect(a, b, k);
        }
        else if (op === OP_DAB && sp >= 1)
        {
            const d = ShapeDistance(data[o + 1], px, py, pz,
                data[o + 4], data[o + 5], data[o + 6], data[o + 7], data[o + 8],
                data[o + 9], data[o + 10], data[o + 11]);
            const k = data[o + 2];
            const mode = data[o + 3];
            const a = stack[sp - 1];
            stack[sp - 1] = mode === 0 ? SmoothUnion(a, d, k)
                          : mode === 1 ? SmoothSubtract(a, d, k)
                          :              SmoothIntersect(a, d, k);
        }
    }

    if (sp === 0) return 1e9;
    let result = stack[0];
    for (let i = 1; i < sp; i++) result = Math.min(result, stack[i]);      // unmerged roots union implicitly
    return result;
}

//--------------------------------------------------------------------------------------------------------------------------
// Ray picking — conservative march (smooth operators break the distance bound) with bisection refinement
//--------------------------------------------------------------------------------------------------------------------------
export interface RayHit { t: number; x: number; y: number; z: number }

export function RaycastField(data: Float32Array, count: number,
                             ox: number, oy: number, oz: number,
                             dx: number, dy: number, dz: number,
                             tMax = 3000): RayHit | null
{
    if (count === 0) return null;

    let t = 0.05;
    let tPrev = t;
    let dPrev = EvalField(data, count, ox + dx * t, oy + dy * t, oz + dz * t);
    if (dPrev < 0) return null;                                            // camera starts inside

    for (let i = 0; i < 320 && t < tMax; i++)
    {
        const step = Math.min(Math.max(dPrev * 0.7, 0.03), 24);
        tPrev = t;
        t += step;
        const d = EvalField(data, count, ox + dx * t, oy + dy * t, oz + dz * t);

        if (d < 0.001 * t + 0.002 || d < 0)
        {
            // bisect [tPrev, t] to the crossing
            let lo = tPrev, hi = t;
            for (let j = 0; j < 14; j++)
            {
                const mid = (lo + hi) * 0.5;
                const dm = EvalField(data, count, ox + dx * mid, oy + dy * mid, oz + dz * mid);
                if (dm > 0) lo = mid; else hi = mid;
            }
            const th = (lo + hi) * 0.5;
            return { t: th, x: ox + dx * th, y: oy + dy * th, z: oz + dz * th };
        }
        dPrev = d;
    }
    return null;
}

//--------------------------------------------------------------------------------------------------------------------------
// CPU surface normal — central differences, used to offset dab centres along the surface
//--------------------------------------------------------------------------------------------------------------------------
export function FieldNormalCpu(data: Float32Array, count: number,
                               x: number, y: number, z: number, eps = 0.02): [number, number, number]
{
    const nx = EvalField(data, count, x + eps, y, z) - EvalField(data, count, x - eps, y, z);
    const ny = EvalField(data, count, x, y + eps, z) - EvalField(data, count, x, y - eps, z);
    const nz = EvalField(data, count, x, y, z + eps) - EvalField(data, count, x, y, z - eps);
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

//--------------------------------------------------------------------------------------------------------------------------
//--------------------------------------------------------------------------------------------------------------------------
// Stroke coalescing — replaces runs of overlapping sphere dabs with oriented capsules
//
// A raw stroke for the sphere tip is hundreds of overlapping spheres at spacing 0.45r.
// For straight sections the union of those spheres is indistinguishable from a single
// capsule that spans the same endpoints, so we collapse the run using a polyline
// simplification (Ramer–Douglas–Peucker) and emit one capsule per kept segment.
// Typical straight strokes compress 10–50×; curved strokes 3–8× — the same win quoted
// in the erosion report's Part A. Debug: brick cache (Phase 2) will make the residual
// cost O(1) anyway, but coalescing keeps the tape short until then and is a strict
// improvement to the document (shorter edit list, same surface).
//--------------------------------------------------------------------------------------------------------------------------

function DistPointToSegment(px: number, py: number, pz: number,
                            ax: number, ay: number, az: number,
                            bx: number, by: number, bz: number): number
{
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const ab2 = abx * abx + aby * aby + abz * abz;
    if (ab2 < 1e-12) return Math.hypot(apx, apy, apz);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2));
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t));
}

function SimplifyRDP(points: DabRecord[], eps: number, first: number, last: number, keep: boolean[]): void
{
    let maxDist = 0;
    let idx = -1;
    const ax = points[first].x, ay = points[first].y, az = points[first].z;
    const bx = points[last].x,  by = points[last].y,  bz = points[last].z;
    for (let i = first + 1; i < last; i++)
    {
        const d = DistPointToSegment(points[i].x, points[i].y, points[i].z, ax, ay, az, bx, by, bz);
        if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (idx !== -1 && maxDist > eps)
    {
        keep[idx] = true;
        SimplifyRDP(points, eps, first, idx, keep);
        SimplifyRDP(points, eps, idx, last, keep);
    }
}

export interface CoalesceResult
{
    dabs: DabRecord[];
    raw: number;                                                   // input count
    kept: number;                                                  // output count
    ratio: number;                                                 // raw / max(kept,1)
}

/** Coalesce a single stroke's dab array. Non-sphere strokes pass through unchanged. */
export function CoalesceStroke(dabs: DabRecord[]): CoalesceResult
{
    const raw = dabs.length;
    if (raw < 4) return { dabs, raw, kept: raw, ratio: 1 };

    // only coalesce homogeneous sphere runs — box / cylinder / mixed-mode strokes stay verbatim
    const mode0 = dabs[0].mode;
    const k0    = dabs[0].k;
    const r0    = dabs[0].r;
    const isSphereRun = dabs.every((d) => d.shape === 0 && d.mode === mode0);
    if (!isSphereRun) return { dabs, raw, kept: raw, ratio: 1 };

    // reject strokes with wildly varying k/r (pressure-varying) — averaging would be lossy
    let kMin = k0, kMax = k0, rMin = r0, rMax = r0;
    for (const d of dabs) { kMin = Math.min(kMin, d.k); kMax = Math.max(kMax, d.k); rMin = Math.min(rMin, d.r); rMax = Math.max(rMax, d.r); }
    if (kMax - kMin > 0.6 || rMax - rMin > r0 * 0.5) return { dabs, raw, kept: raw, ratio: 1 };

    const eps = r0 * 0.28;                                         // collinearity tolerance — tuned so straight strokes collapse to 1 capsule
    const keep = new Array<boolean>(raw).fill(false);
    keep[0] = true; keep[raw - 1] = true;
    SimplifyRDP(dabs, eps, 0, raw - 1, keep);

    const indices: number[] = [];
    for (let i = 0; i < raw; i++) if (keep[i]) indices.push(i);

    const out: DabRecord[] = [];
    const avgK = dabs.reduce((s, d) => s + d.k, 0) / raw;
    const avgR = dabs.reduce((s, d) => s + d.r, 0) / raw;

    for (let s = 0; s < indices.length - 1; s++)
    {
        const a = dabs[indices[s]];
        const b = dabs[indices[s + 1]];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const len = Math.hypot(dx, dy, dz);

        // degenerate segment — emit a single sphere at the midpoint
        if (len < 0.08)
        {
            out.push({ shape: 0, mode: mode0, x: a.x, y: a.y, z: a.z, r: avgR, k: avgK, p1: 0 });
            continue;
        }

        // very short segment relative to radius — also a sphere avoids a near-zero halfLen capsule
        if (len < avgR * 0.55)
        {
            const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5, mz = (a.z + b.z) * 0.5;
            out.push({ shape: 0, mode: mode0, x: mx, y: my, z: mz, r: avgR, k: avgK, p1: 0 });
            continue;
        }

        const half = len * 0.5;
        const ax = dx / len, ay = dy / len, az = dz / len;
        const cx = (a.x + b.x) * 0.5, cy = (a.y + b.y) * 0.5, cz = (a.z + b.z) * 0.5;
        out.push({ shape: 4, mode: mode0, x: cx, y: cy, z: cz, r: avgR, k: avgK, p1: half, ax, ay, az });
    }

    if (out.length === 0) return { dabs, raw, kept: raw, ratio: 1 };
    const ratio = raw / out.length;
    // only keep coalescing if it actually compressed by ≥25% — otherwise the capsule error isn't worth it
    if (ratio < 1.25) return { dabs, raw, kept: raw, ratio: 1 };
    return { dabs: out, raw, kept: out.length, ratio };
}

export function CoalesceStrokeRecord(rec: StrokeRecord): CoalesceResult
{
    const res = CoalesceStroke(rec.dabs);
    if (res.dabs !== rec.dabs) rec.dabs = res.dabs;                // in-place update for the caller
    return res;
}

// Dab attribution — which primitive owns the surface at a point (smallest sub-field wins)
//--------------------------------------------------------------------------------------------------------------------------
export function AttributePoint(field: CompiledField, x: number, y: number, z: number): string | null
{
    let best: string | null = null;
    let bestD = Infinity;
    for (const [uid, r] of field.primitiveRanges)
    {
        const d = EvalField(field.data, field.count, x, y, z, r.start, r.end);
        if (d < bestD) { bestD = d; best = uid; }
    }
    return best;
}

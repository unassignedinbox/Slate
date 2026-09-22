//============================================================================================================================================
// SolidScape — SDF foundation: edit-tape document, graph compiler, CPU field evaluation and ray picking
//
// The node graph is compiled into a flat instruction tape (see docs/SDF-Research.md §10). Each instruction is 3 RGBA32F
// texels; the same tape is interpreted by the GPU raymarcher (sdfPass.ts) and by the CPU evaluator below for brush picking.
//
//   OP_PUSH    push a primitive distance onto the stack        a=[0, shape, 0, 0]        b=[x,y,z, p0]   c=[p1, 0,0,0]
//   OP_COMBINE pop two, push boolean combination               a=[1, mode,  k, 0]
//   OP_DAB     modify top of stack with a sculpt dab           a=[2, shape, k, mode]     b=[x,y,z, r]    c=[p1, 0,0,0]
//
//   shape: 0 sphere · 1 rounded box · 2 capped cylinder · 3 ground plane
//   mode:  0 add (smooth union) · 1 carve (smooth subtraction) · 2 intersect (smooth intersection)
//============================================================================================================================================

import type { GraphSurface } from './graph';
import { CatalogueIndex } from './nodeCatalogue';

export const MaxInstructions     = 1024;
export const TexelsPerInstruction = 3;
export const FloatsPerInstruction = TexelsPerInstruction * 4;

export type ShapeType = 0 | 1 | 2 | 3;
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
    p1: number;                                       // shape extra (cylinder height…)  [m]
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
                        if (!Emit([OP_DAB, d.shape, d.k, d.mode], [d.x, d.y, d.z, d.r], [d.p1, 0, 0, 0])) break;
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
                       cx: number, cy: number, cz: number, p0: number, p1: number): number
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
                    data[o + 4], data[o + 5], data[o + 6], data[o + 7], data[o + 8]);
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
                data[o + 4], data[o + 5], data[o + 6], data[o + 7], data[o + 8]);
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

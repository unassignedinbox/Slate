//============================================================================================================================================
// SolidScape — Sparse brick cache bookkeeping (Part A, Phase 2 scaffold)
//
// Documents the per-brick dirty logic that will become the true O(1) render path. Right now the cache is
// *measured* but not yet *rendered*: the analytic raymarcher is still the display path, while this module
// tracks what the brick path *would* dirty each stroke. That lets us assert the key scaling invariant
// ("~30–50 bricks touched per dab, independent of model size") before we flip the renderer.
//
// Design docs: docs/SDF-Research.md §8, §12 — §13 and docs/Erosion-Plan.md Part A.
//============================================================================================================================================

import type { DabRecord } from './sdf';

//------------------------------------------------------------------ constants (match research §12)
export const BRICK_DIM         = 8;                    // interior voxels per edge
export const BRICK_APRON       = 1;                    // GVDB apron
export const BRICK_ALLOC       = BRICK_DIM + 2 * BRICK_APRON; // 10
export const BAND_VOXELS       = 6;                    // narrow-band threshold |f| < 6 voxels

// For the web scaffold we use a single global voxel size; adaptive per-brick LOD lands with the volume.
// Voxel size is world metres per voxel — choose so that one brick spans ~1.5–3 m (detail where sculpting happens).
export const DEFAULT_VOXEL     = 0.38;                 // [m]  → brick world ≈ 3.0 m (8 × 0.38) — balances dirty-set size vs detail for the scaffold; adaptive LOD will refine where needed
export const DEFAULT_BAND      = 4 * DEFAULT_VOXEL;           // [m] ≈ 1.5 m — Claybook's ±4 band; |f| > band → brick culled

export function WorldToBrick(x: number, voxel = DEFAULT_VOXEL): number
{
    const brickWorld = BRICK_DIM * voxel;
    return Math.floor(x / brickWorld);
}

export function BrickKey(ix: number, iy: number, iz: number): string
{
    return `${ix},${iy},${iz}`;
}

// per-dab world AABB — tight for capsules (segment + radius), conservative for others
function DabAabb(d: DabRecord): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
{
    const pad = Math.abs(d.k) * 0.85 + 0.08 + DEFAULT_BAND + BRICK_APRON * DEFAULT_VOXEL;
    if (d.shape === 4 && d.p1 > 0)                          // capsule: segment endpoints ± (r+pad)
    {
        const hx = (d.ax ?? 0) * d.p1, hy = (d.ay ?? 0) * d.p1, hz = (d.az ?? 0) * d.p1;
        const x0 = d.x - hx, x1 = d.x + hx;
        const y0 = d.y - hy, y1 = d.y + hy;
        const z0 = d.z - hz, z1 = d.z + hz;
        const rr = d.r + pad;
        return {
            minX: Math.min(x0, x1) - rr, maxX: Math.max(x0, x1) + rr,
            minY: Math.min(y0, y1) - rr, maxY: Math.max(y0, y1) + rr,
            minZ: Math.min(z0, z1) - rr, maxZ: Math.max(z0, z1) + rr,
        };
    }
    const r = d.r + pad + (d.shape === 1 || d.shape === 2 ? d.p1 * 0.5 : 0);
    return { minX: d.x - r, maxX: d.x + r, minY: d.y - r, maxY: d.y + r, minZ: d.z - r, maxZ: d.z + r };
}

//------------------------------------------------------------------ BrickPool — dirty-set tracker

export interface BrickMetrics
{
    totalBricks: number;                               // unique bricks ever touched
    dirtyBricks: number;                               // bricks dirty for the last committed stroke
    rawDabs: number;                                   // dabs before coalescing
    keptDabs: number;                                  // dabs after coalescing
    coalesceRatio: number;                             // raw / kept
    avgDirtyPerDab: number;                            // dirtyBricks / max(kept,1)
}

export class BrickPool
{
    voxel: number;
    // occupancy — which bricks have ever been touched (sparse set)
    readonly bricks = new Set<string>();
    // per-frame dirty — reset on each stroke
    readonly dirty  = new Set<string>();
    lastDirty = 0;
    private lastRaw  = 0;
    private lastKept = 0;
    private lastRatio = 1;

    constructor(voxel = DEFAULT_VOXEL)
    {
        this.voxel = voxel;
    }

    SetVoxelSize(voxel: number): void
    {
        this.voxel = voxel;
        this.bricks.clear();
        this.dirty.clear();
    }

    /** Mark a single dab's influence region and its 7-brick negative halo (research §8). */
    MarkDab(d: DabRecord): void
    {
        const aabb = DabAabb(d);

        const x0 = WorldToBrick(aabb.minX, this.voxel), x1 = WorldToBrick(aabb.maxX, this.voxel);
        const y0 = WorldToBrick(aabb.minY, this.voxel), y1 = WorldToBrick(aabb.maxY, this.voxel);
        const z0 = WorldToBrick(aabb.minZ, this.voxel), z1 = WorldToBrick(aabb.maxZ, this.voxel);

        // clamp iteration volume — a single sculpt dab should never touch more than a few bricks;
        // if it does, the voxel size is wrong for the brush radius (defensive clamp: max 8×8×8 region).
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const rx0 = clamp(x0, -8192, 8191), rx1 = clamp(x1, -8192, 8191);
        const ry0 = clamp(y0, -8192, 8191), ry1 = clamp(y1, -8192, 8191);
        const rz0 = clamp(z0, -8192, 8191), rz1 = clamp(z1, -8192, 8191);

        for (let ix = rx0; ix <= rx1; ix++)
        {
            for (let iy = ry0; iy <= ry1; iy++)
            {
                for (let iz = rz0; iz <= rz1; iz++)
                {
                    const key = BrickKey(ix, iy, iz);
                    this.bricks.add(key);
                    this.dirty.add(key);
                    // asymmetric 7-brick negative halo — bricks that read D via their + apron (research §8)
                    for (const [dx, dy, dz] of [[-1,0,0],[0,-1,0],[0,0,-1],[-1,-1,0],[-1,0,-1],[0,-1,-1],[-1,-1,-1]] as const)
                    {
                        const hk = BrickKey(ix + dx, iy + dy, iz + dz);
                        this.bricks.add(hk);
                        this.dirty.add(hk);
                    }
                }
            }
        }
    }

    MarkDabs(dabs: readonly DabRecord[]): void
    {
        for (const d of dabs) this.MarkDab(d);
    }

    /** Call at stroke commit to record coalesce stats + dirty set for that stroke; resets dirty afterwards. */
    CommitStroke(raw: number, kept: number): BrickMetrics
    {
        this.lastRaw = raw;
        this.lastKept = kept;
        this.lastRatio = raw / Math.max(kept, 1);
        this.lastDirty = this.dirty.size;
        const metrics: BrickMetrics = {
            totalBricks: this.bricks.size,
            dirtyBricks: this.dirty.size,
            rawDabs: this.lastRaw,
            keptDabs: this.lastKept,
            coalesceRatio: this.lastRatio,
            avgDirtyPerDab: this.dirty.size / Math.max(kept, 1),
        };
        this.dirty.clear();
        return metrics;
    }

    /** Graph topology changed (node moved / new primitive) — conservative invalidate. */
    InvalidateAll(): void
    {
        // keep occupancy for instrumentation, but mark all known bricks dirty for the next evaluation pass
        for (const k of this.bricks) this.dirty.add(k);
    }

    Reset(): void
    {
        this.bricks.clear();
        this.dirty.clear();
        this.lastRaw = this.lastKept = 0;
        this.lastRatio = 1;
    }
}

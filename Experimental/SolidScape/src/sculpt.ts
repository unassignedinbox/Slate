//============================================================================================================================================
// SolidScape — Sculpt controller: brush engine over the edit tape (dab spacing, stroke binding, cursor projection)
//
// A stroke raycasts against a snapshot of the field taken at pointer-down (prevents the surface chasing the cursor),
// spaces dabs by travelled arc length with a carried remainder (research §8), and binds every dab to the primitive
// node that owns the surface under the first hit — so strokes flow through the node graph like any other edit.
//============================================================================================================================================

import * as THREE from 'three';
import type { ViewportPresentation } from './viewport';
import type { FieldPass } from './sdfPass';
import {
    type CompiledField, type DabRecord, type StrokeRecord, type ShapeType, type BoolMode,
    RaycastField, AttributePoint, FieldNormalCpu, CoalesceStroke,
} from './sdf';

export type SculptTool = 'select' | 'build' | 'carve' | 'smooth';

export interface BrushState
{
    shape:      ShapeType;                            // dab primitive: 0 sphere · 1 box · 2 cylinder
    radius:    number;                                // [m]
    strength:  number;                                // 0..1 → blend smoothness / intensity
    spacing:   number;                                // dab spacing as a fraction of radius
    falloff:   number;                                // 0 soft → 1 hard
    autosmooth: boolean;                              // lightly relax neighbours per dab
}

//--------------------------------------------------------------------------------------------------------------------------
export class SculptController
{
    tool: SculptTool = 'select';
    brush: BrushState = { shape: 0, radius: 2.0, strength: 0.5, spacing: 0.45, falloff: 0.5, autosmooth: false };

    onStrokeLive:      (() => void) | null = null;    // dab appended mid-stroke → recompile
    onStrokeCommitted: ((stroke: StrokeRecord) => void) | null = null;
    /** fired at stroke end with the raw vs kept dab counts after coalescing */
    onStrokeCoalesced: ((raw: number, kept: number, ratio: number) => void) | null = null;
    onToolChanged:     ((tool: SculptTool) => void) | null = null;
    onBrushChanged:    (() => void) | null = null;
    onMissedSurface:   (() => void) | null = null;    // stroke began over empty space

    coalesceEnabled = true;

    liveStroke: StrokeRecord | null = null;

    private field: CompiledField | null = null;
    private strokeSnapshot: { data: Float32Array; count: number } | null = null;
    private lastDab = new THREE.Vector3();
    private carry = 0;                                // spacing remainder      [m]
    private hover: THREE.Vector3 | null = null;
    private pointerId = -1;

    private readonly viewport: ViewportPresentation;
    private readonly pass: FieldPass;
    private readonly canvas: HTMLCanvasElement;
    private readonly ray = new THREE.Vector3();

    constructor(viewport: ViewportPresentation, pass: FieldPass, canvas: HTMLCanvasElement)
    {
        this.viewport = viewport;
        this.pass = pass;
        this.canvas = canvas;
        this.Bind();
    }

    //----------------------------------------------------------------------------------------------------------------------
    SetField(field: CompiledField): void
    {
        this.field = field;
    }

    SetTool(tool: SculptTool): void
    {
        this.tool = tool;
        this.viewport.primaryFree = tool === 'select';
        if (tool === 'select') this.pass.SetBrushCursor(null, 0, -1);
        this.onToolChanged?.(tool);
    }

    private ModeForTool(carveInvert: boolean): BoolMode
    {
        if (this.tool === 'carve') return carveInvert ? 0 : 1;
        if (this.tool === 'build') return carveInvert ? 1 : 0;
        return 0;                                     // smooth builds with heavy blend
    }

    private CursorTint(): number
    {
        return this.tool === 'carve' ? 1 : this.tool === 'smooth' ? 2 : 0;
    }

    //----------------------------------------------------------------------------------------------------------------------
    private RayFromEvent(e: PointerEvent): { origin: THREE.Vector3; dir: THREE.Vector3 }
    {
        const r = this.canvas.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
        const cam = this.viewport.camera;
        this.ray.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
        return { origin: cam.position.clone(), dir: this.ray.clone() };
    }

    private Pick(e: PointerEvent, snapshot = false): THREE.Vector3 | null
    {
        const src = snapshot && this.strokeSnapshot ? this.strokeSnapshot : this.field;
        if (!src || src.count === 0) return null;
        const { origin, dir } = this.RayFromEvent(e);
        const hit = RaycastField(src.data, src.count, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
        return hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : null;
    }

    //----------------------------------------------------------------------------------------------------------------------
    private PlaceDab(p: THREE.Vector3, carveInvert: boolean): void
    {
        if (!this.liveStroke || !this.strokeSnapshot) return;

        const mode = this.ModeForTool(carveInvert);
        const r = this.brush.radius;
        const [nx, ny, nz] = FieldNormalCpu(this.strokeSnapshot.data, this.strokeSnapshot.count, p.x, p.y, p.z);

        let cx = p.x, cy = p.y, cz = p.z;
        let radius = r;
        // falloff reshapes the blend: 0 = soft (×1.45), 0.5 = neutral, 1 = hard (×0.45)
        const falloffMult = 1.45 - this.brush.falloff * 1.0;
        let k = r * (0.25 + this.brush.strength * 0.9) * falloffMult;

        if (this.tool === 'smooth')
        {
            // polish: a heavily-blended dab sunk into the surface rounds creases without net growth
            const sink = r * 0.42;
            cx -= nx * sink; cy -= ny * sink; cz -= nz * sink;
            radius = r * 0.8;
            k = r * (0.9 + this.brush.strength * 1.4) * falloffMult;
        }
        else if (mode === 0)
        {
            const lift = r * 0.28;                    // build: crown proud of the surface
            cx += nx * lift; cy += ny * lift; cz += nz * lift;
        }
        else
        {
            const sink = r * 0.22;                    // carve: bite below the surface
            cx -= nx * sink; cy -= ny * sink; cz -= nz * sink;
        }

        // autosmooth slightly softens each dab, like Blender/ZBrush's autsmooth — keeps ridges from stacking
        if (this.brush.autosmooth && this.tool !== 'smooth') k *= 1.22;

        const dab: DabRecord = {
            shape: this.brush.shape, mode,
            x: cx, y: cy, z: cz,
            r: radius, k,
            p1: this.brush.shape === 2 ? radius * 1.6 : this.brush.shape === 1 ? radius * 0.25 : 0,
        };
        this.liveStroke.dabs.push(dab);
        this.onStrokeLive?.();
    }

    //----------------------------------------------------------------------------------------------------------------------
    private Bind(): void
    {
        const c = this.canvas;

        c.addEventListener('pointerdown', (e) =>
        {
            if (this.tool === 'select' || e.button !== 0) return;
            if (!this.field || this.field.count === 0) { this.onMissedSurface?.(); return; }

            const hit = this.Pick(e);
            if (!hit) { this.onMissedSurface?.(); return; }

            const owner = AttributePoint(this.field, hit.x, hit.y, hit.z);
            if (!owner) { this.onMissedSurface?.(); return; }

            e.preventDefault();
            e.stopImmediatePropagation();             // camera must not receive this press
            c.focus();
            this.pointerId = e.pointerId;
            c.setPointerCapture(e.pointerId);

            this.strokeSnapshot = {
                data: this.field.data.slice(),
                count: this.field.count,
            };
            this.liveStroke = { node: owner, dabs: [] };
            this.lastDab.copy(hit);
            this.carry = 0;
            this.PlaceDab(hit, e.ctrlKey || e.metaKey);
        }, true);                                     // capture phase: runs before the camera handler

        c.addEventListener('pointermove', (e) =>
        {
            if (this.tool === 'select') return;

            if (this.liveStroke && e.pointerId === this.pointerId)
            {
                const hit = this.Pick(e, true);
                if (!hit) return;
                this.pass.SetBrushCursor(hit, this.brush.radius, this.CursorTint());

                const spacing = Math.max(this.brush.radius * this.brush.spacing, 0.05);
                let travelled = this.lastDab.distanceTo(hit) + this.carry;
                if (travelled < spacing) { this.carry = travelled; this.lastDab.copy(hit); return; }

                // walk the segment placing evenly-spaced dabs, carry the remainder
                const dir = hit.clone().sub(this.lastDab);
                const segLen = dir.length();
                if (segLen > 1e-6) dir.divideScalar(segLen);
                let along = spacing - this.carry;
                const invert = e.ctrlKey || e.metaKey;
                while (along <= segLen)
                {
                    const q = this.lastDab.clone().addScaledVector(dir, along);
                    this.PlaceDab(q, invert);
                    along += spacing;
                }
                this.carry = segLen - (along - spacing);
                this.lastDab.copy(hit);
                return;
            }

            // idle hover: project the cursor ring
            const hit = this.Pick(e);
            this.hover = hit;
            this.pass.SetBrushCursor(hit, this.brush.radius, hit ? this.CursorTint() : -1);
        });

        const finish = (e: PointerEvent) =>
        {
            if (!this.liveStroke || e.pointerId !== this.pointerId) return;
            const stroke = this.liveStroke;
            this.liveStroke = null;
            this.strokeSnapshot = null;
            this.pointerId = -1;
            if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
            if (stroke.dabs.length === 0) return;

            const raw = stroke.dabs.length;
            if (this.coalesceEnabled && raw >= 4)
            {
                const coalesced = CoalesceStroke(stroke.dabs);
                (stroke as unknown as { __raw?: number }).__raw = raw;
                stroke.dabs = coalesced.dabs;
                this.onStrokeCoalesced?.(coalesced.raw, coalesced.kept, coalesced.ratio);
            }
            else
            {
                (stroke as unknown as { __raw?: number }).__raw = raw;
                this.onStrokeCoalesced?.(raw, raw, 1);
            }
            this.onStrokeCommitted?.(stroke);
        };
        c.addEventListener('pointerup', finish, true);
        c.addEventListener('pointercancel', finish, true);

        c.addEventListener('pointerleave', () =>
        {
            if (!this.liveStroke) this.pass.SetBrushCursor(null, 0, -1);
        });

        // Ctrl+wheel trims brush radius when a sculpt tool is active
        c.addEventListener('wheel', (e) =>
        {
            if (this.tool === 'select' || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.brush.radius = Math.min(Math.max(this.brush.radius * (e.deltaY < 0 ? 1.12 : 0.89), 0.1), 40);
            if (this.hover) this.pass.SetBrushCursor(this.hover, this.brush.radius, this.CursorTint());
            this.onBrushChanged?.();
        }, { passive: false, capture: true });

        c.addEventListener('keydown', (e) =>
        {
            if (this.tool === 'select') return;
            if (e.code === 'BracketLeft')
            {
                this.brush.radius = Math.max(this.brush.radius * 0.85, 0.1);
                this.onBrushChanged?.();
            }
            else if (e.code === 'BracketRight')
            {
                this.brush.radius = Math.min(this.brush.radius * 1.18, 40);
                this.onBrushChanged?.();
            }
        });
    }
}

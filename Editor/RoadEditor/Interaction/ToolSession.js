//============================================================================================================================================
// 📦 Editor/RoadEditor/Interaction/ToolSession.js — The prompt machine every draw tool runs on
//============================================================================================================================================
// A tool is a list of prompts, and each prompt is satisfied either by a snapped click or by typing a number — Blender's grammar, because it is the
//    fastest way to put a 40 m fillet on a corner without leaving the keyboard. The session owns the numeric buffer, the field cursor, the axis and
//    ortho locks, the rubber band and the cancel/back-out ladder; the tool only supplies what a point means and what to build from the list.
'use strict';

import { resolveSnap, rubberDir, SNAP } from './Snapper.js';

const TYPED = /^(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)*)$/;

export class ToolSession {
    /**
     * @param {object} def {id, label, prompts:string[], fields?:object[], snap?:object,
     *   point?(ctx):boolean, preview?(ctx), commit?(points, ctx), cancel?(ctx)}
     */
    constructor(def, ctx) {
        this.def = def;
        this.ctx = ctx;               // {doc, camera, viewport, settings, ui}
        this.points = [];
        this.raw = null;
        this.typed = '';
        this.field = 0;
        this.axis = null;
        this.ortho = null;
        this.lockLength = null;
        this.grid = ctx.settings?.snapGrid ?? 0;
        this.snapOpts = { nodes: true, lines: true, ...def.snap };
        this.hint = '';
        this.log = [];
    }
    get prompt() {
        const p = this.def.prompts;
        if (!p || !p.length) return '';
        return p[Math.min(this.points.length, p.length - 1)];
    }
    state() {
        return {
            tool: this.def.id,
            label: this.def.label,
            prompt: this.prompt,
            typed: this.typed,
            field: this.field,
            points: this.points.length,
            axis: this.axis,
            ortho: this.ortho != null ? `${(this.ortho * 180 / Math.PI).toFixed(0)}°` : null,
            grid: this.grid,
            hint: this.hint,
        };
    }
    /* ── input ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    move(clientX, clientY) {
        const vp = this.ctx.viewport;
        const g = vp.groundAt(clientX, clientY, this.ctx.workPlane ?? 0);
        if (!g) return null;
        this.raw = this.snap(g);
        this.rawScreen = [clientX, clientY];
        this.def.preview?.(this);
        return this.raw;
    }
    /** Resolves a raw world point through the snap chain, with the typed number folded in. */
    snap(raw) {
        const from = this.points.length ? this.points[this.points.length - 1] : null;
        const opts = { ...this.snapOpts, grid: this.grid || null, axis: this.axis, ortho: this.ortho, from };
        if (this.lockLength != null) {
            opts.length = this.lockLength;
            opts.dir = rubberDir(from, raw, this.ctx.camera);
            if (this._angle != null) opts.angleLock = this._angle;
        }
        const res = resolveSnap({ doc: this.ctx.doc, raw, project: this.ctx.project, from, opts, terrain: this.ctx.terrain });
        if (this.lockLength != null) res.kind = SNAP.NUMBER;
        this.hint = res.kind === SNAP.NODE ? `snap: ${res.note}` : res.kind === SNAP.LINE ? `snap: ${res.note}` : res.note;
        return res;
    }
    click(clientX, clientY, button) {
        const p = this.raw ?? (clientX != null ? this.move(clientX, clientY) : null);
        if (!p) return false;
        if (button === 2) { this.pop(); return false; }
        this.points.push({ x: p.x, y: p.y ?? 0, z: p.z });
        this.log.push(`${p.x.toFixed(2)},${p.z.toFixed(2)} (${p.kind})`);
        this.lockLength = null;
        this._angle = null;
        this.typed = '';
        this.axis = null;
        const done = this.def.point?.(this);
        if (done === 'commit') this.commit();
        else if (done === 'cancel') this.cancel();
        // A `multi` tool keeps taking points until Enter, so its prompt list is a label strip, not a counter.
        else if (!this.def.multi && this.def.prompts && this.points.length >= this.def.prompts.length) this.commit();
        this.def.preview?.(this);
        return true;
    }
    commit() {
        if (this.def.commit) this.def.commit(this.points, this);
        else this.ctx.ui?.notify?.(`${this.def.label}: no commit handler`);
        this.reset();
    }
    cancel() { this.def.cancel?.(this); this.reset(); }
    reset() {
        this.points.length = 0;
        this.typed = '';
        this.lockLength = null;
        this._angle = null;
        this.axis = null;
        this.hint = '';
        this.def.preview?.(this);
        // The owner (main.js) holds the reference, so it has to hear that the gesture is over — commit or cancel, either way.
        this.onDone?.();
    }
    pop() {
        if (this.points.length) this.points.pop();
        this.lockLength = null;
        this.def.preview?.(this);
    }
    /** @returns {boolean} consumed */
    key(e) {
        const k = e.key;
        if (k === 'Escape') { if (this.typed) { this.typed = ''; } else if (this.points.length) { this.pop(); } else this.cancel(); return true; }
        if (k === 'Enter') {
            if (this.typed) { this._acceptTyped(); return true; }
            if (this.points.length) this.commit(); else this.cancel();
            return true;
        }
        if (k === 'Tab') { this.field = (this.field + (e.shiftKey ? -1 : 1) + 8) % 8; return true; }
        if (k === 'Backspace') { this.typed = this.typed.slice(0, -1); return true; }
        if (k === 'Shift' && !this.typed) { this.ortho = this.ortho == null ? Math.PI / 4 : null; return true; }
        if (!this.typed && (k === 'x' || k === 'z')) { this.axis = this.axis === k ? null : k; return true; }
        if (!this.typed && (k === 'g' || k === 'f')) { this.grid = this.grid ? 0 : (this.ctx.settings?.snapGrid || 5); return true; }
        if (/^[\d.,-]$/.test(k)) { this.typed += k; return true; }
        if (!this.typed && /^[a-z]$/.test(k) && 'raec'.includes(k)) { this.typed = k; return true; }
        if (this.typed && /^[\da-z.,-]+$/i.test(k)) { this.typed += k; return true; }
        return false;
    }
    _acceptTyped() {
        const t = this.typed.trim();
        const parsed = parseTyped(t);
        this.typed = '';
        if (!parsed) { this.hint = `not a number: ${t}`; return; }
        const from = this.points.length ? this.points[this.points.length - 1] : null;
        if (parsed.kind === 'xy' && from) { this._finish({ x: parsed.x ?? from.x, y: from.y ?? 0, z: parsed.z ?? from.z }); return; }
        if (parsed.kind === 'length') {
            this.lockLength = parsed.length;
            this._angle = parsed.angle != null ? parsed.angle * Math.PI / 180 : null;
            if (this.raw) this.raw = this.snap(this.raw);
            if (this.ctx.settings?.autoCommit !== false && from) this._finish(this.raw || this.snap({ x: from.x, z: from.z }));
            return;
        }
        if (parsed.kind === 'radius') { this.radius = parsed.radius; this.commit(); return; }
        if (parsed.kind === 'angle') { this._angle = parsed.angle * Math.PI / 180; this.hint = `angle ${parsed.angle}°`; return; }
        this.hint = `typed ${t}`;
    }
    _finish(p) {
        if (!p) return;
        this.points.push({ x: p.x, y: p.y ?? 0, z: p.z });
        const done = this.def.point?.(this);
        if (done === 'commit' || (this.def.prompts && this.points.length >= this.def.prompts.length)) this.commit();
        else this.def.preview?.(this);
    }
}

/** `3`, `12.5,30`, `a45`, `r8`, `@2,1`, `x12` — the accepted forms, and what each means. */
export function parseTyped(text) {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    let m = t.match(/^a\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { kind: 'angle', angle: +m[1] };
    m = t.match(/^r\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { kind: 'radius', radius: +m[1] };
    m = t.match(/^([xz])\s*(-?\d+(?:\.\d+)?)$/);
    if (m) { const o = { kind: 'xy' }; o[m[1]] = +m[2]; return o; }
    m = t.match(/^@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { kind: 'xy', x: +m[1], z: +m[2] };
    if (TYPED.test(t)) {
        const nums = t.split(/\s*,\s*/).map(Number);
        if (nums.length === 1) return { kind: 'length', length: nums[0] };
        if (nums.length === 2) return { kind: 'length', length: nums[1], angle: nums[0] };
        return { kind: 'length', length: nums[0] };
    }
    return null;
}

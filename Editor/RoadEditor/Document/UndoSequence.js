//============================================================================================================================================
// 📦 Editor/RoadEditor/Document/UndoSequence.js — History, with drags folded into one step
//============================================================================================================================================
// The document records inverse operations; this decides how they are grouped and walked. Rapid edits of the same target inside one gesture — a
//    slider, a node drag, repeated nudges — coalesce into a single entry so undo backs out of the gesture rather than the frame. `label` is what the
//    UI lists, and the console can dump it.
'use strict';

const COALESCE_MS = 700;

export class UndoSequence {
    constructor(doc, { limit = 120 } = {}) {
        this.doc = doc;
        this.limit = limit;
        this.undoStack = [];
        this.redoStack = [];
        this._open = null;
        this._off = doc.on('record', (rec) => this._record(rec));
        this._listeners = new Set();
    }
    on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _emit() { for (const fn of this._listeners) fn(this.state()); }
    state() {
        return {
            depth: this.undoStack.length,
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0,
            label: this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : '—',
            next: this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null,
        };
    }
    _record(rec) {
        const top = this.undoStack[this.undoStack.length - 1];
        const now = performance.now();
        if (this._open && top && top.label === rec.label && now - this._open < COALESCE_MS && this.redoStack.length === 0) {
            top.undo = top.undo.concat(rec.undo);
            this._open = now;
            this._emit();
            return;
        }
        this.undoStack.push(rec);
        this.redoStack.length = 0;
        this._open = now;
        while (this.undoStack.length > this.limit) this.undoStack.shift();
        this._emit();
    }
    /** Call when a gesture ends so the next edit of the same name starts a fresh entry. */
    seal() { this._open = 0; }
    undo() {
        if (this.undoStack.length < 1) return null;
        const rec = this.undoStack.pop();
        if (!rec) return null;
        this.doc.applyOps(rec.undo, -1);
        this.redoStack.push(rec);
        this._open = 0;
        this._emit();
        return rec.label;
    }
    redo() {
        const rec = this.redoStack.pop();
        if (!rec) return null;
        this.doc.applyOps(rec.undo, +1);
        this.undoStack.push(rec);
        this._open = 0;
        this._emit();
        return rec.label;
    }
    /** Everything after the current point, as a replayable list — used by the save format and by `history` in the console. */
    log() { return this.undoStack.map((r) => ({ label: r.label, ops: r.undo.length })); }
    dispose() { this._off(); }
}

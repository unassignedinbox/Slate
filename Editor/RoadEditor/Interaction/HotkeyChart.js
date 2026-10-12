//============================================================================================================================================
// 📦 Editor/RoadEditor/Interaction/HotkeyChart.js — Two layers of keybindings, editable at runtime
//============================================================================================================================================
// A global chart for the app-wide verbs and a modal chart owned by whatever tool is running; the modal one is consulted first and can shadow the
//    global keys, which is the only way a tool can borrow WASD or Escape without fighting the camera. Bindings are data, so the console can rebind
//    them (`bind shift+f focus`), the UI can render the table from the same source, and a user can paste their own chart in.
'use strict';

export function keyName(e) {
    const k = e.key;
    let name = k;
    if (k === ' ') name = 'space';
    else if (k === 'Escape') name = 'esc';
    else if (k === 'Enter') name = 'enter';
    else if (k === 'Tab') name = 'tab';
    else if (k === 'Backspace') name = 'backspace';
    else if (k.length === 1) name = k.toLowerCase();
    else name = k.toLowerCase();
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey && (k.length > 1 || e.ctrlKey || e.altKey)) mods.push('shift');
    return mods.length ? `${mods.join('+')}+${name}` : name;
}

export class HotkeyChart {
    constructor() {
        this.global = new Map();
        this.modal = null;
        this.listeners = new Set();
        this.ignoreTargets = ['INPUT', 'TEXTAREA', 'SELECT'];
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit() { for (const fn of this.listeners) fn(this.list()); }
    /** @param {string} keys "w" or "ctrl+shift+z" @param {{label:string, run:(e:KeyboardEvent)=>void, scope?:string}} action */
    bind(keys, action) {
        for (const k of keys.split(/\s*,\s*/)) {
            if (!k) continue;
            this.global.set(k, action);
        }
        this._emit();
        return this;
    }
    unbind(keys) {
        for (const k of String(keys).split(/\s*,\s*/)) this.global.delete(k);
        this._emit();
        return this;
    }
    setModal(map) { this.modal = map && map.size ? map : null; this._emit(); return this; }
    /** @returns {boolean} true when the event was consumed */
    handle(e) {
        const t = e.target;
        if (t && (this.ignoreTargets.includes(t.tagName) || t.isContentEditable)) return false;
        const name = keyName(e);
        const hit = (this.modal && this.modal.get(name)) || this.global.get(name);
        if (!hit) return false;
        if (!hit.allowShift || name.includes('+')) { /* modifiers already matched in the name */ }
        e.preventDefault();
        e.stopPropagation?.();
        try { hit.run(e, hit); } catch (err) { console.error('[hotkey]', name, err); }
        this._emit();
        return true;
    }
    list(scope = 'global') {
        const out = [];
        for (const [keys, a] of this.global) out.push({ keys, label: a.label, scope: a.scope || 'global', group: a.group || 'Other' });
        if (this.modal) for (const [keys, a] of this.modal) out.unshift({ keys, label: a.label, scope: 'tool', group: 'Tool' });
        void scope;
        return out.sort((a, b) => (a.group + a.keys).localeCompare(b.group + b.keys));
    }
    export() {
        const o = {};
        for (const [k, a] of this.global) o[k] = a.label;
        return o;
    }
    import(map, chart) {
        for (const [keys, label] of Object.entries(map)) {
            const run = chart.get(label);
            if (run) this.bind(keys, { label, run, group: 'Imported' });
        }
        return this;
    }
}

//============================================================================================================================================
// 📦 Editor/RoadEditor/UI/Console.js — A verb line for everything the panels can do, and some things they cannot
//============================================================================================================================================
// Verbs are registered by the app, so the console never drifts from what exists: `help` prints the live list, and `bind`/`unbind`/`hotkeys` edit the
//    keymap the same way the chart stores it. History with the up arrow, tab completion on verb names, and a compact log that doubles as the
//    notification feed — because an editor that cannot be driven from text is an editor with a ceiling.
'use strict';

export class Console {
    /** @param {object} app */
    constructor(app) {
        this.app = app;
        this.verbs = new Map();
        this.logLines = [];
        this.hist = [];
        this.hi = -1;
        this.open = false;
        this.root = document.createElement('div');
        this.root.className = 'console hide';
        this.logEl = document.createElement('div');
        this.logEl.className = 'clog';
        this.input = document.createElement('input');
        this.input.className = 'cin';
        this.input.spellcheck = false;
        this.input.placeholder = 'verb — try: help · generate style=organic seed=7 · bind shift+g generate · hotkeys';
        this.input.addEventListener('keydown', (e) => this._key(e));
        this.root.append(this.logEl, this.input);
    }
    add(name, help, run) { this.verbs.set(name, { help, run }); return this; }
    element() { return this.root; }
    toggle(on) {
        this.open = on == null ? !this.open : !!on;
        this.root.classList.toggle('hide', !this.open);
        if (this.open) this.input.focus();
        return this.open;
    }
    print(text, kind = 'out') {
        const line = document.createElement('div');
        line.className = 'cline ' + kind;
        line.textContent = text;
        this.logEl.append(line);
        this.logEl.scrollTop = this.logEl.scrollHeight;
        this.logLines.push(text);
        while (this.logLines.length > 400) this.logLines.shift();
    }
    run(text) {
        const t = String(text || '').trim();
        if (!t) return null;
        this.print('› ' + t, 'in');
        const [verb, ...rest] = t.split(/\s+/);
        const entry = this.verbs.get(verb.toLowerCase());
        if (!entry) { this.print(`unknown verb: ${verb}   (help lists ${this.verbs.size})`, 'err'); return null; }
        try {
            const out = entry.run(rest, t);
            if (out != null && out !== false) this.print(String(out), 'ok');
        } catch (err) {
            this.print('! ' + (err && err.message ? err.message : err), 'err');
            if (err) console.error(err);
        }
        return true;
    }
    _key(e) {
        if (e.key === 'Escape') { e.preventDefault(); this.toggle(false); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const v = this.input.value;
            this.input.value = '';
            if (v.trim()) { this.hist.push(v); this.hi = this.hist.length; this.run(v); }
            return;
        }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (this.hist.length) { this.hi = Math.max(0, this.hi - 1); this.input.value = this.hist[this.hi] || ''; } return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.hi = Math.min(this.hist.length, this.hi + 1); this.input.value = this.hist[this.hi] || ''; return; }
        if (e.key === 'Tab') {
            const v = this.input.value;
            if (!v.includes(' ')) {
                e.preventDefault();
                const hit = Array.from(this.verbs.keys()).find((k) => k.startsWith(v.toLowerCase()));
                if (hit) this.input.value = hit + ' ';
            }
        }
    }
}

/** Registers the verbs the app understands; kept here so main.js stays wiring-only. */
export function installVerbs(console_, app) {
    const doc = app.doc;
    const kv = (toks) => {
        const o = {};
        for (const t of toks) { const m = /^([\w]+)=(.+)$/.exec(t); if (m) o[m[1]] = /^-?\d+(\.\d+)?$/.test(m[2]) ? +m[2] : m[2]; }
        return o;
    };
    console_.add('help', 'list verbs', () => Array.from(console_.verbs.entries()).map(([k, v]) => `${k.padEnd(10)} ${v.help}`).join('\n'));
    console_.add('generate', 'generate [style=grid] [seed=n] [half=m] — rebuilds the city', (a) => {
        const o = kv(a);
        Object.assign(app.genSettings, o);
        app.requestGenerate(true);
        return `generating ${app.genSettings.style} seed ${app.genSettings.seed} half ${app.genSettings.half}`;
    });
    console_.add('half', 'half-extent of the next generated city [m]', ([v]) => { app.genSettings.half = Math.max(200, +v || 1200); app.chrome?.sync(); return `half = ${app.genSettings.half} m (then regen)`; });
    console_.add('terrain', 'relief amplitude of the next generated city [m]', ([v]) => { app.genSettings.terrain = Math.max(0, +v || 0); app.chrome?.sync(); return `terrain = ${app.genSettings.terrain} m (then regen)`; });
    console_.add('style', 'set the city style preset', ([s]) => { app.genSettings.style = s || app.genSettings.style; app.chrome?.sync(); return 'style = ' + app.genSettings.style; });
    console_.add('seed', 'set the seed', ([n]) => { app.genSettings.seed = n == null ? (Math.random() * 1e6) | 0 : +n | 0; app.requestGenerate(true); return 'seed = ' + app.genSettings.seed; });
    console_.add('bake', 're-bake the world now', () => { app.requestBake(true); return 'baking'; });
    console_.add('profile', 'profile <id> [roadId…] — assign a section', (a) => {
        const id = a[0];
        if (!id) return 'profiles: see the atlas panel; `profiles` lists ids';
        const ids = a.slice(1).map(Number).filter(Boolean);
        const targets = ids.length ? ids : Array.from(doc.selection);
        if (!targets.length) return 'nothing selected';
        doc.setRoads(targets, 'profile', id);
        app.requestBake();
        return `${targets.length} road(s) → ${id}`;
    });
    console_.add('profiles', 'list section ids', () => app.profileIds.join(' '));
    console_.add('select', 'select <roadId…> | select none', (a) => {
        const ids = a.map(Number).filter(Boolean);
        doc.select(ids, false);
        app.chrome?.sync();
        return `selected ${ids.length}`;
    });
    console_.add('goto', 'goto x,z[,y] — fly the camera', ([s]) => {
        const p = (s || '0,0').split(',').map(Number);
        app.camera.goTo(p[0] || 0, p[1] || 0, p[2] == null ? 60 : p[2]);
        return `fly to ${p.join(', ')}`;
    });
    console_.add('home', 'frame the whole city', () => { app.flyHome(); return 'ok'; });
    console_.add('speed', 'speed <m/s>', ([n]) => { app.camera.speed = Math.max(1, +n || 40); return 'speed = ' + app.camera.speed.toFixed(1); });
    console_.add('mood', 'mood noon|golden|dusk|night|overcast', ([m]) => { app.setMood(m); return 'mood = ' + m; });
    console_.add('xray', 'xray on|off — show the underground', ([v]) => { app.setXray(v !== 'off'); return 'xray ' + (v !== 'off'); });
    console_.add('props', 'props on|off — street furniture', ([v]) => { app.settings.props = v === 'off' ? 0 : 1; app.requestBake(true); return 'props ' + (v !== 'off'); });
    console_.add('markings', 'markings on|off', ([v]) => { const on = v !== 'off'; app.viewport.setMarkings(on); app.settings.markings = on ? 1 : 0; return 'markings ' + on; });
    console_.add('step', 'step <m> — station spacing', ([n]) => { app.settings.step = +n || 7; app.requestBake(true); return 'step = ' + app.settings.step; });
    console_.add('sector', 'sector <m> — tile size', ([n]) => { app.settings.sector = +n || 220; app.requestBake(true); return 'sector = ' + app.settings.sector; });
    console_.add('undo', 'step back', () => { app.history.undo(); return 'undo'; });
    console_.add('redo', 'step forward', () => { app.history.redo(); return 'redo'; });
    console_.add('history', 'print the undo log', () => app.history.log().map((r, i) => `${i + 1}. ${r.label} (${r.ops})`).join('\n') || 'empty');
    console_.add('stats', 'document + bake stats', () => {
        const s = doc.stats();
        const b = app.lastStats || {};
        return `roads ${s.roads} · nodes ${s.nodes} · ${s.km.toFixed(1)} km · hubs ${s.hubs} · dead ${s.dead} · lots ${s.lots}\n`
            + `bake ${b.ms ?? '—'} ms · ${((b.tris || 0) / 1000).toFixed(0)}k tris · ${b.sectors ?? 0} sectors · ${b.junctions ?? 0} junctions · ${app.viewport.stats.fps} fps · ${app.viewport.stats.calls} draws`;
    });
    console_.add('hotkeys', 'print the keymap', () => app.chart.list().map((h) => `${h.keys.padEnd(12)} ${h.label}`).join('\n'));
    console_.add('bind', 'bind <key> <verb…> — rebind a key to a console verb', ([key, ...rest]) => {
        if (!key || !rest.length) return 'usage: bind shift+g generate style=organic';
        const cmd = rest.join(' ');
        app.chart.bind(key, { label: cmd, group: 'Bound', run: () => console_.run(cmd) });
        return `${key} → ${cmd}`;
    });
    console_.add('unbind', 'unbind <key>', ([key]) => { app.chart.unbind(key); return 'unbound ' + key; });
    console_.add('save', 'download the document as JSON', () => { app.save(); return 'saving'; });
    console_.add('clear', 'clear the log', () => { console_.logEl.replaceChildren(); return false; });
    // Aliases for the words people type before they read the list — they resolve to the same handler, so they cannot drift.
    for (const [from, to] of [['sectors', 'sector'], ['regen', 'generate'], ['rebuild', 'generate'], ['go', 'goto'], ['fly', 'goto'], ['fit', 'home'], ['export', 'save'], ['print', 'stats']]) {
        const v = console_.verbs.get(to);
        if (v) console_.verbs.set(from, { help: `${to} — ${v.help}`, run: v.run });
    }
    return console_;
}

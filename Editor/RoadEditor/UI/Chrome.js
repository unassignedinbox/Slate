//============================================================================================================================================
// 📦 Editor/RoadEditor/UI/Chrome.js — Panels, the record bar and the profile browser
//============================================================================================================================================
// The chrome is deliberately Frontier's: a 34 px tabline, a three-zone strip where the middle *is* the mode rather than a label for it, 26 px
//    controls, small caps with letterspacing, and one 2 px hairline under the rail that fills as the bake runs. Every widget here is a function that
//    reads and writes the live document — there is no second copy of state to fall out of sync, which is the only way an editor like this stays honest.
'use strict';

import { PROFILE_IDS, getProfile, profileSvg, profileSpeed, PROFILE_BY_CLASS } from '../Kernel/ProfileSolver.js';
import { STYLES, GENERATOR_PROFILES } from '../Generation/CityGenerator.js';
import { LAYERS } from '../Document/SceneDocument.js';
import { HotkeyChart } from '../Interaction/HotkeyChart.js';

const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (k === 'class') n.className = v;
        else if (k === 'style') n.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    }
    for (const kid of kids.flat(3)) {
        if (kid == null || kid === false) continue;
        n.append(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    }
    return n;
};

export class Chrome {
    /** @param {object} app the wiring object from main.js */
    constructor(app) {
        this.app = app;
        this.doc = app.doc;
        this.chart = app.chart || new HotkeyChart();
        this.mode = 'edit';
        this.openPanels = new Set(['city', 'layers', 'selection', 'bake', 'view']);
        this._profileFilter = '';
        this.modal = null;
    }
    mount(root) {
        this.root = root;
        root.classList.add('re-root');
        this.tabline = this._tabline();
        this.left = this._panel('left');
        this.right = this._panel('right');
        this.center = el('div', { class: 'center' });
        this.record = this._recordBar();
        this.conv = el('div', { class: 'conv' });
        this.progress = el('i', { class: 'bar' });
        this.conv.append(this.progress);
        this.center.append(el('div', { class: 'stagewrap' }, this.app.canvasEl, this.conv, this._corner()), this.record);
        root.append(el('div', { class: 'tabline' }, this.tabline), el('div', { class: 'body' }, this.left, this.center, this.right));
        this.rebuild();
        return this;
    }
    /* ── top rail ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    _tabline() {
        const modes = ['edit', 'drive', 'inspect'];
        this.modePill = el('div', { class: 'modes' }, ...modes.map((m) => el('button', {
            class: 'mode' + (m === this.mode ? ' on' : ''), 'data-mode': m,
            onclick: () => this.setMode(m),
        }, m)));
        this.docName = el('input', { class: 'name', value: this.doc.meta.name || 'untitled', spellcheck: 'false', oninput: (e) => { this.doc.meta.name = e.target.value; } });
        this.live = el('span', { class: 'live' });
        this.stat = el('span', { class: 'stat' }, '—');
        const mood = el('select', { class: 'sel', onchange: (e) => this.app.setMood(e.target.value) },
            ...Object.entries(this.app.moods).map(([k, v]) => el('option', { value: k, selected: k === this.app.mood ? 'selected' : null }, v.label || k)));
        return el('div', { class: 'tabin' },
            el('div', { class: 'zone l' }, this.live, el('span', { class: 'brand' }, 'ROAD EDITOR'), this.docName,
                el('span', { class: 'ghost' }, 'SLATE'), el('span', { class: 'sep' }), this.stat),
            el('div', { class: 'zone c' }, this.modePill),
            el('div', { class: 'zone r' },
                el('button', { class: 'ctl', title: 'Re-bake (B)', onclick: () => this.app.requestBake(true) }, 'bake'),
                el('button', { class: 'ctl', title: 'Save JSON', onclick: () => this.app.save() }, 'save'),
                el('button', { class: 'ctl', title: 'Open JSON', onclick: () => this.app.openFile() }, 'open'),
                el('button', { class: 'ctl' + (this.app.xray ? ' on' : ''), title: 'X-ray underground', onclick: (e) => { this.app.setXray(!this.app.xray); e.target.classList.toggle('on'); } }, 'x-ray'),
                mood,
                el('button', { class: 'ctl', title: 'Hotkeys (H)', onclick: () => this.showHotkeys() }, 'keys'),
                el('button', { class: 'ctl', title: 'Console (~)', onclick: () => this.app.toggleConsole() }, 'cons')));
    }
    _corner() {
        this.minimapHost = el('div', { class: 'mmhost' });
        this.hint = el('div', { class: 'hint' });
        return el('div', { class: 'corner' }, this.minimapHost, this.hint);
    }
    /* ── record bar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    _recordBar() {
        this.prompt = el('span', { class: 'prompt' }, 'ready');
        this.typedEl = el('span', { class: 'typed' }, '');
        this.snapEl = el('span', { class: 'snap' }, 'free');
        this.busy = el('span', { class: 'busy' }, '');
        return el('div', { class: 'record' },
            el('span', { class: 'rec-tool' }, '—'),
            el('span', { class: 'rec-sep' }),
            this.prompt, this.typedEl,
            el('span', { class: 'grow' }), this.snapEl, this.busy);
    }
    setToolLabel(t) { const n = this.record.querySelector('.rec-tool'); if (n) n.textContent = t || '—'; }
    notify(msg, kind) {
        this.busy.textContent = msg || '';
        this.busy.className = 'busy' + (kind ? ' ' + kind : '');
        clearTimeout(this._nb);
        this._nb = setTimeout(() => { this.busy.textContent = ''; }, 3600);
        this.app.consoleLog?.(msg, kind);
    }
    progressTo(p, label) {
        this.progress.style.width = `${Math.round(p * 100)}%`;
        if (label) this.snapEl.textContent = label;
    }
    /* ── panels ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    _panel(side) {
        const n = el('div', { class: `panel ${side}` });
        this[side + 'Panel'] = n;
        return n;
    }
    card(title, key, ...body) {
        const open = this.openPanels.has(key);
        const kids = el('div', { class: 'cardbody' + (open ? '' : ' hide') }, ...body);
        const head = el('button', {
            class: 'cardhead' + (open ? ' open' : ''),
            onclick: (e) => { const on = e.currentTarget.classList.toggle('open'); kids.classList.toggle('hide', !on); if (on) this.openPanels.add(key); else this.openPanels.delete(key); },
        }, el('span', { class: 'chev' }, '▸'), title, el('span', { class: 'cardtag' }, key));
        return el('section', { class: 'card' }, head, kids);
    }
    rebuild() {
        this.leftPanel.replaceChildren(this._cityCard(), this._layersCard(), this._toolsCard());
        this.rightPanel.replaceChildren(this._selectionCard(), this._profilesCard(), this._bakeCard(), this._viewCard());
        this.sync();
    }
    _cityCard() {
        const app = this.app, gen = app.genSettings;
        const chips = el('div', { class: 'chips' }, ...Object.entries(STYLES).map(([k, v]) => el('button', {
            class: 'chip' + (gen.style === k ? ' on' : ''), 'data-style': k, title: v.label,
            onclick: () => { gen.style = k; app.requestGenerate?.(); this.sync(); },
        }, v.label)));
        const sliders = el('div', { class: 'grid2' },
            this.slider('extent', 'half', 600, 3200, 50, gen),
            this.slider('block', 'cell', 80, 220, 2, gen),
            this.slider('arterial every', 'arterialEvery', 2, 9, 1, gen),
            this.slider('density', 'density', 0.3, 1.6, 0.05, gen),
            this.slider('water', 'water', 0, 1, 0.05, gen),
            this.slider('rail', 'rail', 0, 1, 1, gen, true),
            this.slider('metro', 'metro', 0, 3, 1, gen, true),
            this.slider('bike', 'bike', 0, 1, 0.05, gen),
            this.slider('bus', 'bus', 0, 1, 0.05, gen),
            this.slider('parking', 'parking', 0, 1, 0.05, gen),
            this.slider('humps', 'humps', 0, 1, 0.05, gen),
            this.slider('terrain', 'terrain', 0, 1, 0.05, gen),
            this.slider('ring', 'ringHWY', 0, 1, 1, gen, true));
        const seed = el('div', { class: 'row' },
            el('label', { class: 'lbl' }, 'seed'),
            el('input', { class: 'num', type: 'number', value: gen.seed, onchange: (e) => { gen.seed = +e.target.value | 0; } }),
            el('button', { class: 'btn', title: 'Random seed and regenerate', onclick: () => { gen.seed = (Math.random() * 1e6) | 0; app.requestGenerate?.(); this.sync(); } }, 'reseed'),
            el('button', { class: 'btn primary', onclick: () => app.requestGenerate?.() }, 'generate'));
        return this.card('City', 'city', chips, sliders, seed,
            el('div', { class: 'note' }, `${GENERATOR_PROFILES.length} sections available — every street type in the atlas is placed by the generator or by hand.`));
    }
    _layersCard() {
        const rows = LAYERS.map((name) => el('label', { class: 'lay', 'data-layer': name },
            el('input', { type: 'checkbox', checked: this.doc.layers[name] ? 'checked' : null, onchange: (e) => { this.doc.setLayer(name, e.target.checked); this.app.requestBake(); this.sync(); } }),
            el('span', { class: 'ln' }, name), el('span', { class: 'lc', 'data-count': name }, '')));
        return this.card('Layers', 'layers', ...rows, el('div', { class: 'row' },
            el('button', { class: 'btn', onclick: () => { this.app.flyHome?.(); } }, 'fit city')));
    }
    _toolsCard() {
        const groups = new Map();
        for (const [id, t] of Object.entries(this.app.tools || {})) {
            if (!t.label) continue;
            const g = t.group || 'Other';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push([id, t]);
        }
        const rows = [];
        for (const [g, list] of groups) {
            rows.push(el('div', { class: 'grouplbl' }, g));
            rows.push(el('div', { class: 'toolgrid' }, ...list.map(([id, t]) => el('button', {
                class: 'tool' + (this.app.tool === id ? ' on' : ''), 'data-tool': id, title: t.description || t.label,
                onclick: () => this.app.startTool(id),
            }, t.label, el('kbd', {}, this.app.hotkeyFor?.(id) || '·')))));
        }
        return this.card('Tools', 'tools', ...rows);
    }
    _selectionCard() {
        // A reload can retire ids, and a draw adds to the selection directly, so never assume an id resolves or that exactly one road is picked.
        const sel = Array.from(this.doc.selection).filter((id) => this.doc.byId(id));
        const many = sel.length > 1;
        const one = sel.length === 1 ? this.doc.byId(sel[0]) : null;
        const stats = this.doc.stats();
        const head = el('div', { class: 'kv' },
            el('span', {}, 'roads'), el('b', { class: 'v', 'data-k': 'roads' }, String(stats.roads)),
            el('span', {}, 'network'), el('b', { class: 'v', 'data-k': 'km' }, `${stats.km.toFixed(1)} km`),
            el('span', {}, 'hubs / dead'), el('b', { class: 'v', 'data-k': 'hubs' }, `${stats.hubs} / ${stats.dead}`),
            el('span', {}, 'selected'), el('b', { class: 'v', 'data-k': 'sel' }, sel.length ? (many ? `${sel.length} roads` : String(sel[0])) : '—'));
        const profileSel = el('select', { class: 'sel wide', onchange: (e) => { this.doc.setRoads(sel, 'profile', e.target.value); this.app.requestBake(); this.sync(); } },
            ...PROFILE_IDS.map((id) => el('option', { value: id, selected: one && one.profile === id ? 'selected' : null }, `${id}  ·  ${getProfile(id).cls}`)));
        if (!sel.length) return this.card('Selection', 'selection', head, el('div', { class: 'note' }, 'Click a road. Shift-click to add, Esc to clear.'));
        const bulk = el('div', { class: 'row wrap' },
            el('div', { class: 'note' }, `${sel.length} roads — the section, markings and deletion below apply to every one of them.`),
            el('button', { class: 'mini', onclick: () => { this.doc.setRoads(sel, 'markings', one ? 0 : 1); this.app.requestBake(); this.sync(); } }, 'markings'),
            el('button', { class: 'mini', onclick: () => { this.app.startTool('connect'); } }, 'weld ends'),
            el('button', { class: 'mini danger', onclick: () => { this.doc.removeRoads(sel); this.app.requestBake(); this.rebuild(); } }, 'delete'));
        if (!one) return this.card('Selection', 'selection', head, profileSel, bulk);
        const prev = el('div', { class: 'svgprev' });
        prev.innerHTML = profileSvg(one.profile, 300, 92);
        const fields = el('div', { class: 'grid2' },
            this.num('camber', one, 'camber', -0.06, 0.09, 0.005),
            this.num('kerb r', one, 'curbRadius', 1.2, 44, 0.5),
            this.num('y at A', one, 'y0', -30, 60, 0.5),
            this.num('y at B', one, 'y1', -30, 60, 0.5));
        const toggles = el('div', { class: 'row wrap' },
            this.tog('markings', one, 'markings'), this.tog('junction', one, 'noJunction'),
            this.tog('structure', one, 'noStructure'), this.tog('electrified', one, 'electrified'),
            this.tog('one-way', one, 'oneWay'));
        const bumps = el('div', { class: 'bumps' },
            el('div', { class: 'grouplbl' }, `speed humps (${(one.bumps || []).length})`),
            ...((one.bumps || []).map((b, i) => el('div', { class: 'bumprow' },
                el('span', { class: 'blabel' }, `s ${b.s.toFixed(1)} m`),
                el('span', { class: 'blabel' }, `w ${b.w.toFixed(1)}`),
                el('span', { class: 'blabel' }, `h ${(b.h * 100).toFixed(0)} cm`),
                el('button', { class: 'mini', onclick: () => { const l = (one.bumps || []).slice(); l.splice(i, 1); this.doc.setRoad(one.id, 'bumps', l); this.app.requestBake(); this.sync(); } }, '×')))),
            el('div', { class: 'row' },
                el('button', { class: 'mini', onclick: () => { const l = (one.bumps || []).slice(); l.push({ s: Math.round(midLength(one) / 2), w: 3.6, h: 0.09 }); this.doc.setRoad(one.id, 'bumps', l); this.app.requestBake(); this.sync(); } }, '＋ hump'),
                el('button', { class: 'mini', onclick: () => { this.doc.reverse(one.id); this.app.requestBake(); this.sync(); } }, 'reverse'),
                el('button', { class: 'mini', onclick: () => { this.doc.splitRoad(one.id, midPoint(one).x, midPoint(one).z); this.app.requestBake(); this.sync(); } }, 'split'),
                el('button', { class: 'mini danger', onclick: () => { this.doc.removeRoads(sel); this.app.requestBake(); this.rebuild(); } }, 'delete')));
        const ends = el('div', { class: 'ends' }, ...['A', 'B'].map((which) => {
            const nid = one['node' + which];
            const n = nid != null ? this.doc.nodes[nid] : null;
            return el('div', { class: 'endrow' },
                el('span', { class: 'lbl' }, `node ${which}`),
                el('span', { class: 'val' }, n ? `${n.id} · ${n.x.toFixed(0)}, ${n.z.toFixed(0)}` : '—'),
                el('input', { class: 'num', type: 'number', step: '0.5', value: n ? (n.y ?? 0).toFixed(2) : '', title: 'node elevation', onchange: (e) => { if (n) { this.doc.setNodeField(n.id, 'y', +e.target.value); this.app.requestBake(); } } }),
                el('button', { class: 'mini', onclick: () => { this.app.startTool('connect'); } }, 'weld'));
        }));
        return this.card('Selection', 'selection', head, profileSel, prev, many ? bulk : null, fields, toggles, ends, bumps);
    }
    _profilesCard() {
        this.profileHost = el('div', { class: 'pgrid' });
        const filter = el('input', { class: 'search', placeholder: 'filter sections…', oninput: (e) => { this._profileFilter = e.target.value.toLowerCase(); this.sync(); } });
        return this.card('Section atlas', 'profiles', filter, el('div', { class: 'note' }, 'Click to set the draw section, or retarget the selection.'), this.profileHost);
    }
    _bakeCard() {
        const S = this.app.settings;
        const rows = el('div', { class: 'grid2' },
            this.num2('step', S, 'step', 3, 24, 0.5), this.num2('min step', S, 'minStep', 0.5, 8, 0.25),
            this.num2('fairing', S, 'fair', 0, 4, 1), this.num2('curb scale', S, 'curbRadius', 0.2, 3, 0.05),
            this.num2('hump rise', S, 'humpAmp', 0, 0.22, 0.005), this.num2('sector', S, 'sector', 80, 600, 10),
            this.num2('ground grid', S, 'groundGrid', 60, 600, 10), this.num2('prop density', S, 'propDensity', 0.4, 2.5, 0.05));
        const t = el('div', { class: 'row wrap' },
            this.tog2('markings', S), this.tog2('structure', S), this.tog2('crossings', S), this.tog2('props', S),
            this.tog2('ground', S, 'ground'), this.tog2('lamps', S, 'propsLamps'), this.tog2('signs', S, 'propsSigns'),
            this.tog2('trees', S, 'propsTrees'), this.tog2('rail', S, 'propsRail'), this.tog2('frontage', S, 'propsLots'));
        return this.card('Bake', 'bake', rows, t, el('div', { class: 'row' },
            el('button', { class: 'btn primary', onclick: () => this.app.requestBake(true) }, 're-bake all'),
            el('button', { class: 'btn', onclick: () => { this.app.resetSettings(); this.rebuild(); } }, 'defaults')));
    }
    _viewCard() {
        const app = this.app;
        return this.card('View', 'view',
            el('div', { class: 'grid2' },
                this.num3('fly speed', app.camera, 'speed', 2, 900, 1),
                this.num3('fov', app.viewport.camera, 'fov', 30, 100, 1, () => app.viewport.camera.updateProjectionMatrix()),
                this.num3('lod range', app.viewport, 'lodScale', 0.2, 4, 0.1)),
            el('div', { class: 'row wrap' },
                el('button', { class: 'btn', onclick: () => app.setXray(!app.xray) }, 'x-ray'),
                el('button', { class: 'btn', onclick: () => app.toggleProps?.() }, 'props'),
                el('button', { class: 'btn', onclick: () => app.togglePointerLock?.() }, 'pawn')),
            el('div', { class: 'note' }, 'Right-drag looks · WASD flies · Q/E down/up · Shift sprints · wheel sets speed · F locks the pointer.'));
    }
    /* ── widget factories ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    slider(label, key, min, max, step, obj) {
        const out = el('span', { class: 'sv' }, String(obj[key]));
        return el('label', { class: 'w' }, el('span', { class: 'wl' }, label),
            el('input', {
                class: 'rng', type: 'range', min, max, step, value: obj[key],
                oninput: (e) => { obj[key] = +e.target.value; out.textContent = fmt(e.target.value); },
                onchange: () => { this.app.onGenSetting?.(key); this.sync(); },
            }), out);
    }
    num(label, road, key, min, max, step) {
        if (!road) return el('label', { class: 'w' }, el('span', { class: 'wl' }, label), el('input', { class: 'num', disabled: 'true' }));
        const v = road[key];
        return el('label', { class: 'w' }, el('span', { class: 'wl' }, label),
            el('input', {
                class: 'num', type: 'number', min, max, step: step || 0.1, value: v == null ? '' : v,
                onchange: (e) => { this.doc.setRoads(Array.from(this.doc.selection), key, +e.target.value); this.app.requestBake(); },
            }));
    }
    num2(label, obj, key, min, max, step) {
        return el('label', { class: 'w' }, el('span', { class: 'wl' }, label),
            el('input', {
                class: 'num', type: 'number', min, max, step, value: obj[key],
                onchange: (e) => { obj[key] = +e.target.value; this.app.requestBake(); },
            }));
    }
    num3(label, obj, key, min, max, step, after) {
        return el('label', { class: 'w' }, el('span', { class: 'wl' }, label),
            el('input', {
                class: 'num', type: 'number', min, max, step, value: obj[key] ?? 1,
                onchange: (e) => { obj[key] = +e.target.value; after?.(); },
            }));
    }
    tog(label, road, key) {
        return el('label', { class: 'tg' }, el('input', {
            type: 'checkbox', checked: road && road[key] ? 'checked' : null,
            onchange: (e) => { this.doc.setRoads(Array.from(this.doc.selection), key, e.target.checked ? 1 : 0); this.app.requestBake(); },
        }), el('span', {}, label));
    }
    tog2(label, obj, key) {
        const k = key || label;
        return el('label', { class: 'tg' }, el('input', {
            type: 'checkbox', checked: obj[k] ? 'checked' : null,
            onchange: (e) => { obj[k] = e.target.checked ? 1 : 0; this.app.requestBake(); },
        }), el('span', {}, label));
    }
    /* ── sync ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    sync() {
        const doc = this.doc, stats = doc.stats(), app = this.app;
        const set = (k, v) => { const n = this.root.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
        set('roads', String(stats.roads)); set('km', `${stats.km.toFixed(1)} km`); set('hubs', `${stats.hubs} / ${stats.dead}`);
        set('sel', doc.selection.size ? Array.from(doc.selection).join(' ') : '—');
        this.stat.textContent = app.lastStats ? `${app.lastStats.roads} roads · ${app.lastStats.km.toFixed(1)} km · ${(app.lastStats.tris / 1000).toFixed(0)}k tris · ${app.lastStats.ms} ms · ${app.fps || 0} fps · ${app.viewport?.stats?.calls ?? 0} draws`
            : `${stats.roads} roads · ${stats.km.toFixed(1)} km`;
        for (const name of LAYERS) {
            const n = this.leftPanel.querySelector(`[data-count="${name}"]`);
            if (n) n.textContent = String(countLayer(doc, name));
        }
        for (const b of this.leftPanel.querySelectorAll('[data-style]')) b.classList.toggle('on', b.dataset.style === app.genSettings.style);
        for (const b of this.leftPanel.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === app.tool);
        for (const b of this.rightPanel.querySelectorAll('[data-profile]')) b.classList.toggle('on', doc.selection.size && Array.from(doc.selection).every((id) => doc.byId(id)?.profile === b.dataset.profile));
        if (this.profileHost) {
            const f = this._profileFilter;
            const ids = PROFILE_IDS.filter((id) => !f || id.toLowerCase().includes(f) || getProfile(id).cls.includes(f));
            this.profileHost.replaceChildren(...ids.slice(0, 60).map((id) => profileCell(id, this)));
        }
        if (app.session) {
            const s = app.session.state();
            this.prompt.textContent = s.prompt || '—';
            this.typedEl.textContent = s.typed ? `⌨ ${s.typed}` : '';
            this.snapEl.textContent = s.hint || s.note || 'free';
        } else {
            this.prompt.textContent = doc.selection.size ? 'selected — edit on the right' : 'idle';
            this.typedEl.textContent = '';
        }
        this.setToolLabel(app.toolLabel || null);
    }
    /* ── modals ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    showHotkeys() {
        const rows = this.chart.list().map((h) => el('tr', {}, el('td', {}, el('kbd', {}, h.keys)), el('td', {}, h.label), el('td', { class: 'grp' }, h.group || h.scope)));
        const body = el('div', { class: 'modalbody' },
            el('h3', {}, 'Hotkeys'), el('p', { class: 'note' }, 'Rebind from the console: bind shift+g generate — the table is the binding.'),
            el('table', { class: 'hk' }, el('tr', {}, el('th', {}, 'key'), el('th', {}, 'action'), el('th', {}, 'scope')), rows),
            el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => this.closeModal() }, 'close')));
        this.openModal(body);
    }
    openModal(body) {
        this.closeModal();
        this.modal = el('div', { class: 'modal' }, el('div', { class: 'scrim', onclick: () => this.closeModal() }), el('div', { class: 'sheet' }, body));
        this.root.append(this.modal);
    }
    closeModal() { if (this.modal) { this.modal.remove(); this.modal = null; } }
    /* ── tool previews ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    previewTool(session) {
        const pts = session.points.slice();
        if (session.raw) pts.push({ x: session.raw.x, y: session.raw.y ?? 0, z: session.raw.z });
        this.app.viewport.drawToolRibbon(pts, 0.5, { y: 0.12 });
        this.sync();
    }
    previewNode() { }
    setMode(m) { this.app.setMode?.(m); }
    /** The mode pill and the panel dimming are consequences of the mode, never its source — `app.setMode` calls this on the way out. */
    updateModePills(m) {
        this.mode = m;
        for (const b of this.modePill.querySelectorAll('.mode')) b.classList.toggle('on', b.dataset.mode === m);
        if (this.leftPanel) this.leftPanel.classList.toggle('dim', m === 'drive');
        if (this.rightPanel) this.rightPanel.classList.toggle('dim', m === 'drive');
    }
    setMinimap(node) { this.minimapHost.replaceChildren(node); }
}

const fmt = (v) => (Math.abs(+v) >= 100 ? String(Math.round(+v)) : String(+(+v).toFixed(2)));
function midLength(road) {
    let s = 0;
    for (let i = 1; i < road.points.length; ++i) s += Math.hypot(road.points[i].x - road.points[i - 1].x, road.points[i].z - road.points[i - 1].z);
    return s;
}
function midPoint(road) {
    const half = midLength(road) / 2;
    let s = 0;
    for (let i = 1; i < road.points.length; ++i) {
        const a = road.points[i - 1], b = road.points[i];
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        if (s + l >= half) { const u = (half - s) / (l || 1); return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }; }
        s += l;
    }
    return road.points[0];
}
function countLayer(doc, name) {
    if (name === 'props') return doc.roads.length;
    if (name === 'terrain') return doc.lots.length;
    if (name === 'transit') return doc.transit.length;
    return doc.roads.filter((r) => (r.layer || 'streets') === name).length;
}
const svgCache = new Map();
function svgCell(id) {
    let s = svgCache.get(id);
    if (!s) { s = profileSvg(id, 150, 34); svgCache.set(id, s); }
    const n = el('span', { class: 'psvg' });
    n.innerHTML = s;
    return n;
}
function profileCell(id, chrome) {
    const p = getProfile(id);
    return el('button', {
        class: 'pchip', 'data-profile': id, title: `${id} · ${p.cls} · ${profileSpeed(p.def)} km/h · ${p.width.toFixed(1)} m wide`,
        onclick: () => {
            if (chrome.doc.selection.size) { chrome.doc.setRoads(Array.from(chrome.doc.selection), 'profile', id); chrome.app.requestBake(); }
            else chrome.app.setCurrentProfile(id);
            chrome.sync();
        },
    }, el('span', { class: 'pid' }, id), el('span', { class: 'pmeta' }, `${p.cls} · ${p.width.toFixed(1)} m · ${profileSpeed(p.def)}`), svgCell(id));
}
export { PROFILE_BY_CLASS };

// Right panel: parameters for the selected layer, blend/opacity, mask (Gaea-style influence map).
import { h } from './dom.js';
import { NODES, maskParams, defaultParams } from '../engine/registry.js';
import { BLEND } from '../engine/ops.js';
import { BLEND_NAMES, MASK_NAMES } from './names.js';

const IMPORT_NODES = new Set([219, 220, 226, 228]);
const MASK_IDS = Object.keys(MASK_NAMES).map(Number);

function paramField(spec, value, onChange) {
  if (spec.t === 'num') {
    const range = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.s, value });
    const num = h('input', { type: 'number', min: spec.min, max: spec.max, step: spec.s, value });
    const sync = (v) => { range.value = v; num.value = v; onChange(+v); };
    range.addEventListener('input', () => sync(range.value));
    num.addEventListener('change', () => sync(num.value));
    return h('label', { class: 'field' }, h('span', {}, spec.l), h('div', { class: 'pair' }, range, num));
  }
  if (spec.t === 'sel') {
    const s = h('select', {}, spec.opts.map((o) => h('option', { value: o, selected: String(o) === String(value) }, String(o))));
    s.addEventListener('change', () => onChange(isNaN(+s.value) || typeof spec.d === 'string' ? s.value : +s.value));
    return h('label', { class: 'field' }, h('span', {}, spec.l), s);
  }
  if (spec.t === 'col') {
    const c = h('input', { type: 'color', value });
    c.addEventListener('input', () => onChange(c.value));
    return h('label', { class: 'field' }, h('span', {}, spec.l), c);
  }
  if (spec.t === 'bool') {
    const c = h('input', { type: 'checkbox', checked: !!value });
    c.addEventListener('change', () => onChange(c.checked));
    return h('label', { class: 'field' }, h('span', {}, spec.l), c);
  }
  const t = h('input', { type: 'text', value: value ?? '' });
  t.addEventListener('change', () => onChange(t.value));
  return h('label', { class: 'field' }, h('span', {}, spec.l), t);
}

export function renderProps(el, project, layer, ctx) {
  el.replaceChildren();
  if (!layer) { el.append(h('div', { class: 'empty' }, 'Select a layer to edit its parameters.')); return; }
  const node = NODES[layer.nodeId];
  const change = (fn) => { fn(); ctx.onChange(); };
  el.append(h('div', { class: 'ph' }, h('b', {}, node.name), h('small', {}, ` #${node.id} · ${node.cat} · ${node.mode}`)));

  el.append(h('div', { class: 'sec' }, h('label', { class: 'field' }, h('span', {}, 'Layer name'),
    h('input', { type: 'text', value: layer.name || '', placeholder: node.name, onchange: (e) => change(() => { layer.name = e.target.value; }) }))));

  const basics = [h('label', { class: 'field' }, h('span', {}, 'Enabled'), h('input', { type: 'checkbox', checked: layer.enabled, onchange: (e) => change(() => { layer.enabled = e.target.checked; }) }))];
  basics.push(h('label', { class: 'field' }, h('span', {}, 'Opacity'), h('div', { class: 'pair' },
    h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: layer.opacity, oninput: (e) => { layer.opacity = +e.target.value; ctx.onChange(false); } }),
    h('input', { type: 'number', min: 0, max: 1, step: 0.01, value: layer.opacity, onchange: (e) => change(() => { layer.opacity = +e.target.value; }) }))));
  const usesBlend = !['mod', 'xform', 'combine'].includes(node.mode);
  if (usesBlend) {
    const bsel = h('select', {}, Object.keys(BLEND).map((k) => h('option', { value: k, selected: +k === layer.blend }, `${k} · ${BLEND_NAMES[k]}`)));
    bsel.addEventListener('change', () => change(() => { layer.blend = +bsel.value; }));
    basics.push(h('label', { class: 'field' }, h('span', {}, 'Blend (Gaea combiner)'), bsel));
  } else {
    basics.push(h('div', { class: 'note' }, node.mode === 'mod' ? 'Modifies height; applied by opacity × mask.' : node.mode === 'xform' ? 'Transforms the whole stack state.' : 'Blend mode is set by the combiner node itself.'));
  }
  el.append(h('div', { class: 'sec' }, h('h4', {}, 'Layer'), basics));

  if (node.params.length) {
    el.append(h('div', { class: 'sec' }, h('h4', {}, 'Parameters'), node.params.map((spec) => paramField(spec, layer.params[spec.k] ?? spec.d, (v) => { layer.params[spec.k] = v; ctx.onChange(false); }))));
  }

  // combiner secondary source
  if (node.mode === 'combine') {
    el.append(h('div', { class: 'note' }, 'Combiner: blends the stack height with a secondary source using this node’s Gaea blend mode.'));
  }
  if (IMPORT_NODES.has(node.id) || (node.mode === 'combine' && layer.params.source === 'imported')) {
    const file = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,.raw,.r16,.bin' });
    file.addEventListener('change', () => file.files[0] && ctx.onImport(layer, file.files[0]));
    el.append(h('div', { class: 'sec' }, h('h4', {}, 'Imported heightmap'), file,
      h('div', { class: 'note' }, layer.imported ? `Loaded ${layer.imported.N}×${layer.imported.N}` : 'No heightmap loaded (accepts 8-bit PNG/JPG or 16-bit RAW).'),
      layer.imported ? h('button', { onclick: () => change(() => { layer.imported = null; }) }, 'Clear import') : null));
  }

  // ---- mask ----
  const m = layer.mask || (layer.mask = { type: null, params: {}, invert: false, contrast: 1, feather: 0 });
  const msel = h('select', {}, [h('option', { value: '' }, 'None (full influence)'), ...MASK_IDS.map((id) => h('option', { value: id, selected: m.type === id }, `#${id} ${MASK_NAMES[id]}`))]);
  msel.addEventListener('change', () => change(() => {
    m.type = msel.value === '' ? null : +msel.value;
    m.params = m.type == null ? {} : defaultParams(NODES[m.type]);
    if (m.type === 178 && !m.painted) m.painted = { N: project.N, data: new Float32Array(project.N * project.N).fill(1) };
  }));
  const maskBox = [h('label', { class: 'field' }, h('span', {}, 'Mask'), msel)];
  if (m.type != null) {
    for (const spec of maskParams(m.type)) maskBox.push(paramField(spec, m.params[spec.k] ?? spec.d, (v) => { m.params[spec.k] = v; ctx.onChange(false); }));
    maskBox.push(h('label', { class: 'field' }, h('span', {}, 'Contrast'), h('input', { type: 'range', min: 0, max: 4, step: 0.05, value: m.contrast ?? 1, oninput: (e) => { m.contrast = +e.target.value; ctx.onChange(false); } })));
    maskBox.push(h('label', { class: 'field' }, h('span', {}, 'Feather'), h('input', { type: 'range', min: 0, max: 10, step: 0.1, value: m.feather ?? 0, oninput: (e) => { m.feather = +e.target.value; ctx.onChange(false); } })));
    maskBox.push(h('label', { class: 'field' }, h('span', {}, 'Invert'), h('input', { type: 'checkbox', checked: !!m.invert, onchange: (e) => change(() => { m.invert = e.target.checked; }) })));
    if (m.type === 178) {
      const paint = ctx.paint;
      maskBox.push(h('div', { class: 'paintbar' },
        h('button', { class: paint.on ? 'on' : '', onclick: () => { paint.on = !paint.on; ctx.onPaintChange(); } }, paint.on ? 'Painting: on (2D view)' : 'Paint mask'),
        h('label', { class: 'inline' }, 'Brush ', h('input', { type: 'range', min: 1, max: 40, value: paint.radius, oninput: (e) => { paint.radius = +e.target.value; } })),
        h('button', { onclick: () => change(() => { m.painted = { N: project.N, data: new Float32Array(project.N * project.N).fill(1) }; }) }, 'Fill 1'),
        h('button', { onclick: () => change(() => { m.painted = { N: project.N, data: new Float32Array(project.N * project.N) }; }) }, 'Clear 0')));
      maskBox.push(h('div', { class: 'note' }, 'Left-drag paints influence (1), Shift-drag erases (0).'));
    }
  }
  el.append(h('div', { class: 'sec' }, h('h4', {}, 'Mask (grayscale influence)'), maskBox));
}

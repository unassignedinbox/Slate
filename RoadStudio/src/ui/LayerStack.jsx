import React from 'react';
import { LAYER_TYPES, BLEND, MASK, STACK_SLOTS, STACK_NAMES, typeOf, newLayer } from '../engine/textures.js';
import { Button, Select, Slider, Toggle, hexOf, rgbOf } from './Controls.jsx';

const MASK_OPTIONS = Object.keys(MASK).map((k) => ({ value: k, label: { none: 'None', lanes: 'Lane bands', curb: 'Curb edge', blotch: 'Blotches' }[k] }));
const BLEND_OPTIONS = Object.keys(BLEND).map((k) => ({ value: k, label: { normal: 'Normal', multiply: 'Multiply', add: 'Add' }[k] }));
const TYPE_OPTIONS = LAYER_TYPES.map((t) => ({ value: t.key, label: `${t.group} · ${t.label}` }));

// Layerstack: ordered procedural texture layers for one surface. Layers evaluate
// top-to-bottom in the shader; each contributes albedo and height.
export function LayerStack({ doc, surface, setSurface, commit }) {
  const list = doc.stacks[surface] || [];
  const setList = (next) => commit({ ...doc, stacks: { ...doc.stacks, [surface]: next } });
  const update = (i, patch) => setList(list.map((L, k) => (k === i ? { ...L, ...patch } : L)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const remove = (i) => setList(list.filter((_, k) => k !== i));
  const add = (key) => {
    if (list.length >= STACK_SLOTS) return;
    setList([...list, newLayer(key)]);
  };
  return (
    <section className="card layerstack">
      <header className="card-heading">
        <span>Layerstack</span>
        <span className="card-actions">{list.length}/{STACK_SLOTS}</span>
      </header>
      <div className="seg">
        {Object.keys(STACK_NAMES).map((k) => (
          <button key={k} type="button" className={surface === k ? 'on' : ''} onClick={() => setSurface(k)}>{STACK_NAMES[k]}</button>
        ))}
      </div>
      <AddLayer onAdd={add} disabled={list.length >= STACK_SLOTS} />
      {list.length === 0 ? <p className="hint">No layers. Add one above. Empty stacks render flat albedo.</p> : null}
      {list.map((L, i) => {
        const t = typeOf(L.key);
        return (
          <div className={`layer${L.enabled ? '' : ' off'}`} key={i}>
            <div className="layer-head">
              <button type="button" className="icon" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
              <button type="button" className="icon" title="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}>▼</button>
              <span className="layer-name">{t?.label ?? L.key}</span>
              <Toggle checked={L.enabled} label="" onChange={(v) => update(i, { enabled: v })} />
              <button type="button" className="icon" title="Delete layer" onClick={() => remove(i)}>✕</button>
            </div>
            <div className="layer-grid">
              <label className="field"><span className="field-label">Blend</span>
                <Select value={L.blend} options={BLEND_OPTIONS} onChange={(v) => update(i, { blend: v })} /></label>
              <label className="field"><span className="field-label">Mask</span>
                <Select value={L.mask} options={MASK_OPTIONS} onChange={(v) => update(i, { mask: v })} /></label>
              <label className="field"><span className="field-label">Colour</span>
                <input type="color" className="color" value={hexOf(L.color)} onChange={(e) => update(i, { color: rgbOf(e.target.value) })} /></label>
            </div>
            <Slider label="Opacity" value={L.opacity} min={0} max={1} step={0.01} onChange={(v) => update(i, { opacity: v })} />
            <Slider label="Intensity" value={L.intensity} min={0} max={1.5} step={0.01} onChange={(v) => update(i, { intensity: v })} />
            <Slider label="Scale (m)" value={L.scale} min={0.1} max={20} step={0.05} onChange={(v) => update(i, { scale: v })} />
            <Slider label="Roughness" value={L.roughness} min={0} max={1} step={0.01} onChange={(v) => update(i, { roughness: v })} />
            {t?.params.map(([label, min, max, step], pi) => (
              <Slider key={pi} label={label} value={L.p[pi] ?? 0} min={min} max={max} step={step}
                onChange={(v) => update(i, { p: L.p.map((x, k) => (k === pi ? v : x)) })} />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function AddLayer({ onAdd, disabled }) {
  const [pick, setPick] = React.useState(LAYER_TYPES[0].key);
  return (
    <div className="add-layer">
      <Select value={pick} options={TYPE_OPTIONS} onChange={setPick} />
      <Button onClick={() => onAdd(pick)} disabled={disabled}>Add layer</Button>
    </div>
  );
}

import { Card, Toggle, Field, NumberInput, Slider, Select, Button } from './Controls.jsx';
import { ROAD_CLASSES, CONTROLS, CONTROL_NAMES, LIGHT_DESIGNS, BOLLARD_DESIGNS, RAIL_DESIGNS, applyClass, roadsAt } from '../engine/network.js';
import { patchRoad, patchJunction, removeRoad, removeJunction, removeWaypoint, addBump, addPothole, patchFeature, removeFeature } from '../engine/network.js';

const VIS_LABELS = {
  roads: 'Roads', markings: 'Markings', curbs: 'Curbs & pavement', crosswalks: 'Crosswalks', junctions: 'Junction hubs',
  lights: 'Streetlights', bollards: 'Bollards', railings: 'Railings', bumps: 'Speed bumps', potholes: 'Potholes',
  traffic: 'Traffic', ground: 'Ground',
};

export function Inspector({ doc, selection, commit, live, onFocus }) {
  if (!selection) return <SceneCard doc={doc} commit={commit} />;
  if (selection.kind === 'junction') {
    const J = doc.junctions[selection.id];
    if (!J) return <SceneCard doc={doc} commit={commit} />;
    return <JunctionCard doc={doc} J={J} commit={commit} live={live} onFocus={onFocus} />;
  }
  const R = doc.roads[selection.id];
  if (!R) return <SceneCard doc={doc} commit={commit} />;
  return <RoadCard doc={doc} R={R} commit={commit} onFocus={onFocus} />;
}

function JunctionCard({ doc, J, commit, live, onFocus }) {
  const roads = roadsAt(doc, J.id);
  return (
    <>
      <Card title="Junction" actions={<Button variant="ghost" onClick={() => onFocus()}>Focus</Button>}>
        <Field label="Name">
          <input className="text" value={J.name} onChange={(e) => live(patchJunction(doc, J.id, { name: e.target.value }))} />
        </Field>
        <div className="row3">
          <Field label="X (m)"><NumberInput value={J.p[0]} step={0.5} onChange={(v) => commit(patchJunction(doc, J.id, { p: [v, J.p[1], J.p[2]] }))} /></Field>
          <Field label="Y (m)"><NumberInput value={J.p[1]} step={0.5} onChange={(v) => commit(patchJunction(doc, J.id, { p: [J.p[0], v, J.p[2]] }))} /></Field>
          <Field label="Z (m)"><NumberInput value={J.p[2]} step={0.5} onChange={(v) => commit(patchJunction(doc, J.id, { p: [J.p[0], J.p[1], v] }))} /></Field>
        </div>
        <Field label="Control">
          <Select value={J.control} options={CONTROLS.map((c) => ({ value: c, label: CONTROL_NAMES[c] }))} onChange={(v) => commit(patchJunction(doc, J.id, { control: v }))} />
        </Field>
        <Toggle checked={J.crosswalks} label="Crosswalks on approaches" onChange={(v) => commit(patchJunction(doc, J.id, { crosswalks: v }))} />
        <p className="hint">{roads.length} road end{roads.length === 1 ? '' : 's'} meet here. Drag the gizmo in the viewport to move the whole intersection.</p>
        <div className="btn-row">
          <Button variant="danger" onClick={() => commit(removeJunction(doc, J.id))}>Delete junction and roads</Button>
        </div>
      </Card>
    </>
  );
}

function RoadCard({ doc, R, commit, onFocus }) {
  const set = (patch) => commit(patchRoad(doc, R.id, patch));
  const setSub = (key, patch) => set({ [key]: { ...R[key], ...patch } });
  const A = doc.junctions[R.a]?.name ?? R.a, B = doc.junctions[R.b]?.name ?? R.b;
  return (
    <>
      <Card title="Road" actions={<Button variant="ghost" onClick={() => onFocus()}>Focus</Button>}>
        <Field label="Name"><input className="text" value={R.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <p className="hint">{A} to {B} · {R.wps.length} spline point{R.wps.length === 1 ? '' : 's'}</p>
        <Field label="Class">
          <Select value={R.cls} options={Object.entries(ROAD_CLASSES).map(([k, c]) => ({ value: k, label: c.label }))} onChange={(v) => commit(patchRoad(doc, R.id, () => applyClass(R, v)))} />
        </Field>
        <Slider label="Lanes per direction" value={R.lanes} min={1} max={4} step={1} onChange={(v) => set({ lanes: v })} />
        <Slider label="Lane width (m)" value={R.laneWidth} min={2.6} max={4.2} step={0.05} onChange={(v) => set({ laneWidth: v })} />
        <Slider label="Median (m)" value={R.median} min={0} max={8} step={0.5} onChange={(v) => set({ median: v })} />
        <Slider label="Shoulder (m)" value={R.shoulder} min={0} max={3} step={0.1} onChange={(v) => set({ shoulder: v })} />
        <Slider label="Kerb height (m)" value={R.curb} min={0} max={0.25} step={0.01} onChange={(v) => set({ curb: v })} />
        <Toggle checked={R.sidewalk} label="Sidewalk" onChange={(v) => set({ sidewalk: v })} />
        {R.sidewalk ? <Slider label="Sidewalk width (m)" value={R.sidewalkW} min={1} max={5} step={0.1} onChange={(v) => set({ sidewalkW: v })} /> : null}
        <Toggle checked={R.bridge} label="Elevated bridge deck" onChange={(v) => set({ bridge: v })} />
        {R.bridge ? <Slider label="Deck thickness (m)" value={R.deckT} min={0.6} max={2.5} step={0.05} onChange={(v) => set({ deckT: v })} /> : null}
      </Card>

      <Card title="Roadside" dense>
        <Toggle checked={R.lights.on} label="Streetlights" onChange={(v) => setSub('lights', { on: v })} />
        {R.lights.on ? (
          <>
            <Slider label="Spacing (m)" value={R.lights.spacing} min={12} max={60} step={1} onChange={(v) => setSub('lights', { spacing: v })} />
            <Field label="Design"><Select value={R.lights.design} options={LIGHT_DESIGNS} onChange={(v) => setSub('lights', { design: v })} /></Field>
          </>
        ) : null}
        <Toggle checked={R.bollards.on} label="Bollards" onChange={(v) => setSub('bollards', { on: v })} />
        {R.bollards.on ? (
          <>
            <Slider label="Spacing (m)" value={R.bollards.spacing} min={1} max={6} step={0.1} onChange={(v) => setSub('bollards', { spacing: v })} />
            <Field label="Design"><Select value={R.bollards.design} options={BOLLARD_DESIGNS} onChange={(v) => setSub('bollards', { design: v })} /></Field>
          </>
        ) : null}
        <Toggle checked={R.rail.on} label="Railing / guard rail" onChange={(v) => setSub('rail', { on: v })} />
        {R.rail.on ? <Field label="Design"><Select value={R.rail.design} options={RAIL_DESIGNS} onChange={(v) => setSub('rail', { design: v })} /></Field> : null}
      </Card>

      <Card title={`Speed bumps (${R.bumps.length})`} dense actions={<Button variant="ghost" onClick={() => commit(addBump(doc, R.id, 0.5))}>Add</Button>}>
        {R.bumps.length === 0 ? <p className="hint">No speed bumps on this road.</p> : null}
        {R.bumps.map((b, i) => (
          <div className="feature" key={i}>
            <Slider label="Position along road" value={b.t} min={0} max={1} step={0.01} onChange={(v) => commit(patchFeature(doc, R.id, 'bumps', i, { t: v }))} />
            <Slider label="Length (m)" value={b.len} min={2} max={6} step={0.1} onChange={(v) => commit(patchFeature(doc, R.id, 'bumps', i, { len: v }))} />
            <Slider label="Height (m)" value={b.h} min={0.03} max={0.15} step={0.005} onChange={(v) => commit(patchFeature(doc, R.id, 'bumps', i, { h: v }))} />
            <Button variant="ghost" onClick={() => commit(removeFeature(doc, R.id, 'bumps', i))}>Remove bump</Button>
          </div>
        ))}
      </Card>

      <Card title={`Potholes (${R.potholes.length})`} dense actions={<Button variant="ghost" onClick={() => commit(addPothole(doc, R.id, 0.5, 0.35))}>Add</Button>}>
        {R.potholes.length === 0 ? <p className="hint">No potholes on this road.</p> : null}
        {R.potholes.map((p, i) => (
          <div className="feature" key={i}>
            <Slider label="Position along road" value={p.t} min={0} max={1} step={0.01} onChange={(v) => commit(patchFeature(doc, R.id, 'potholes', i, { t: v }))} />
            <Slider label="Lateral offset (m)" value={p.lat} min={-3} max={3} step={0.05} onChange={(v) => commit(patchFeature(doc, R.id, 'potholes', i, { lat: v }))} />
            <Slider label="Radius (m)" value={p.r} min={0.2} max={1} step={0.01} onChange={(v) => commit(patchFeature(doc, R.id, 'potholes', i, { r: v }))} />
            <Slider label="Depth (m)" value={p.depth} min={0.02} max={0.15} step={0.005} onChange={(v) => commit(patchFeature(doc, R.id, 'potholes', i, { depth: v }))} />
            <Button variant="ghost" onClick={() => commit(removeFeature(doc, R.id, 'potholes', i))}>Remove pothole</Button>
          </div>
        ))}
      </Card>

      <Card title={`Spline points (${R.wps.length})`} dense>
        {R.wps.length === 0 ? <p className="hint">Straight road. Use Draw road and click to add points.</p> : null}
        {R.wps.map((w, i) => (
          <div className="wp-row" key={i}>
            <span>P{i + 1} · {w[0].toFixed(1)}, {w[2].toFixed(1)}</span>
            <Button variant="ghost" onClick={() => commit(removeWaypoint(doc, R.id, i))}>Remove</Button>
          </div>
        ))}
      </Card>

      <div className="btn-row">
        <Button variant="danger" onClick={() => commit(removeRoad(doc, R.id))}>Delete road</Button>
      </div>
    </>
  );
}

function SceneCard({ doc, commit }) {
  const set = (patch) => commit({ ...doc, ...patch });
  const env = (patch) => commit({ ...doc, env: { ...doc.env, ...patch } });
  const traffic = (patch) => commit({ ...doc, traffic: { ...doc.traffic, ...patch } });
  const vis = (key, v) => commit({ ...doc, vis: { ...doc.vis, [key]: v } });
  const hh = Math.floor(doc.env.time), mm = Math.round((doc.env.time - hh) * 60);
  return (
    <>
      <Card title="Network">
        <Field label="Name"><input className="text" value={doc.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Slider label="Vehicles (max 25)" value={doc.traffic.count} min={0} max={25} step={1} onChange={(v) => traffic({ count: v })} />
        <Slider label="Time of day" value={doc.env.time} min={0} max={24} step={0.25} format={() => `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`} onChange={(v) => env({ time: v })} />
        <Slider label="Wetness" value={doc.env.wetness} min={0} max={1} step={0.01} onChange={(v) => env({ wetness: v })} />
        <Slider label="Exposure" value={doc.env.exposure} min={0.4} max={1.8} step={0.01} onChange={(v) => env({ exposure: v })} />
        <Slider label="Haze" value={doc.env.fog} min={0} max={0.00005} step={0.000001} format={(v) => (v * 1e5).toFixed(1)} onChange={(v) => env({ fog: v })} />
        <Toggle checked={doc.env.shadows} label="Sun shadows" onChange={(v) => env({ shadows: v })} />
      </Card>
      <Card title="Display" dense>
        <div className="toggle-grid">
          {Object.keys(VIS_LABELS).map((k) => (
            <Toggle key={k} checked={doc.vis[k] !== false} label={VIS_LABELS[k]} onChange={(v) => vis(k, v)} />
          ))}
        </div>
      </Card>
    </>
  );
}

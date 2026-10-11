import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage } from './render/stage.js';
import { Inspector } from './ui/Inspector.jsx';
import { LayerStack } from './ui/LayerStack.jsx';
import { Button, Toggle } from './ui/Controls.jsx';
import {
  createDemoDoc, emptyDoc, serialize, deserialize, ROAD_CLASSES, patchJunction,
  addJunction, addRoad, removeRoad, removeJunction, roadsAt,
} from './engine/network.js';

const TOGGLES = [
  ['traffic', 'Traffic'], ['lights', 'Lights'], ['bollards', 'Bollards'], ['railings', 'Railings'],
  ['markings', 'Markings'], ['crosswalks', 'Crosswalks'], ['ground', 'Ground'],
];
const MAX_HISTORY = 120;
const SNAP = 0.5;
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const snapP = (p) => [Math.round(p[0] / SNAP) * SNAP, p[1], Math.round(p[2] / SNAP) * SNAP];

export default function App() {
  const [doc, setDocState] = useState(() => createDemoDoc());
  const [selection, setSelection] = useState(null);
  const [mode, setMode] = useState('select');
  const [draft, setDraftState] = useState(null);
  const [tab, setTab] = useState('network');
  const [surface, setSurface] = useState('asphalt');
  const [roadClass, setRoadClass] = useState('arterial');
  const [snap, setSnap] = useState(true);
  const [stats, setStats] = useState(null);
  const [building, setBuilding] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  const docRef = useRef(doc);
  const draftRef = useRef(null);
  const hist = useRef({ past: [], future: [] });
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const H = useRef({});

  const applyDoc = (next) => { docRef.current = next; setDocState(next); };
  const commit = (next) => {
    const h = hist.current;
    h.past.push(docRef.current);
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.future = [];
    applyDoc(next);
  };
  const live = (next) => applyDoc(next);
  const undo = () => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(docRef.current);
    applyDoc(prev);
  };
  const redo = () => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    applyDoc(next);
  };
  const setDraft = (d) => { draftRef.current = d; setDraftState(d); };

  // Handlers are read through a ref so the stage always sees current state.
  H.current = {
    onSelect: (s) => { if (draftRef.current) return; setSelection(s); },
    onMoveBegin: () => {
      const h = hist.current;
      h.past.push(docRef.current);
      if (h.past.length > MAX_HISTORY) h.past.shift();
      h.future = [];
    },
    onMoveJunction: (id, p) => live(patchJunction(docRef.current, id, { p })),
    onMoveEnd: () => {},
    onDraftClick: ({ p, jid }) => {
      const d = draftRef.current;
      if (!d) {
        let next = docRef.current;
        let id = jid;
        const created = [];
        if (!id) {
          const r = addJunction(next, snapP(p));
          next = r.doc;
          id = r.id;
          created.push(id);
        }
        commit(next);
        setDraft({ a: id, wps: [], created });
        setNotice('Click to add spline points. Click a junction or double-click to finish. Esc cancels.');
        return;
      }
      if (jid && jid === d.a) return;
      if (jid) { finishRoad(d, jid, docRef.current); return; }
      const start = docRef.current.junctions[d.a].p;
      const last = d.wps.length ? d.wps[d.wps.length - 1] : start;
      if (dist2(last, p) < 1.5) return;
      setDraft({ ...d, wps: [...d.wps, snapOrRaw(p)] });
    },
    onDraftFinish: ({ p, jid }) => {
      const d = draftRef.current;
      if (!d) return;
      let next = docRef.current;
      let wps = [...d.wps];
      let endId = jid;
      if (!endId) {
        if (wps.length && dist2(wps[wps.length - 1], p) < 1.5) wps = wps.slice(0, -1);
        if (dist2(next.junctions[d.a].p, p) < 1.5) { cancelDraft(d); return; }
        const r = addJunction(next, snapOrRaw(p));
        next = r.doc;
        endId = r.id;
      }
      if (endId === d.a) { cancelDraft(d); return; }
      finishRoad({ ...d, wps }, endId, next, true);
    },
  };

  function snapOrRaw(p) { return snap ? snapP(p) : p; }

  function finishRoad(d, endId, base, createdEnd) {
    const r = addRoad(base, d.a, endId, d.wps, roadClass);
    commit(r.doc);
    setSelection({ kind: 'road', id: r.id });
    setDraft(null);
    if (createdEnd) setNotice('');
  }

  function cancelDraft(d) {
    let next = docRef.current;
    let changed = false;
    for (const id of d?.created || []) {
      if (next.junctions[id] && roadsAt(next, id).length === 0) {
        next = removeJunction(next, id);
        changed = true;
      }
    }
    if (changed) commit(next);
    setDraft(null);
    setNotice('');
  }

  // Stage lifecycle: create once, dispose on unmount.
  useEffect(() => {
    const stage = new Stage({
      canvas: canvasRef.current,
      overlay: overlayRef.current,
      handlers: {
        onSelect: (s) => H.current.onSelect(s),
        onMoveBegin: (id) => H.current.onMoveBegin(id),
        onMoveJunction: (id, p) => H.current.onMoveJunction(id, p),
        onMoveEnd: (id) => H.current.onMoveEnd(id),
        onDraftClick: (c) => H.current.onDraftClick(c),
        onDraftFinish: (c) => H.current.onDraftFinish(c),
        onStats: (s) => { setStats(s); setBuilding(false); },
        onBuildStart: () => setBuilding(true),
        onError: (m) => setError(m),
      },
    });
    stageRef.current = stage;
    stage.start()
      .then(() => { setReady(true); stage.setDoc(docRef.current); })
      .catch((e) => setError(String(e?.message || e)));
    return () => stage.dispose();
  }, []);

  useEffect(() => { stageRef.current?.setDoc(doc); }, [doc]);
  useEffect(() => { stageRef.current?.setUi({ selection, mode, draft, snap }); }, [selection, mode, draft, snap]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape') {
        if (draftRef.current) cancelDraft(draftRef.current);
        else if (mode === 'draw') setMode('select');
        else setSelection(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
      } else if (e.key.toLowerCase() === 'd' && !mod) {
        setTab('network');
        setMode('draw');
      } else if (e.key.toLowerCase() === 'v' && !mod) {
        setMode('select');
      } else if (e.key.toLowerCase() === 'f') {
        stageRef.current?.focusSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function deleteSelection() {
    if (!selection) return;
    const cur = docRef.current;
    if (selection.kind === 'junction' && cur.junctions[selection.id]) commit(removeJunction(cur, selection.id));
    else if (selection.kind === 'road' && cur.roads[selection.id]) commit(removeRoad(cur, selection.id));
    setSelection(null);
  }

  function save() {
    const blob = new Blob([serialize(docRef.current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(docRef.current.name || 'network').replace(/[^\w-]+/g, '_')}.roadstudio.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Network saved as JSON.');
  }

  async function load(file) {
    try {
      const next = deserialize(await file.text());
      commit(next);
      setSelection(null);
      setNotice(`Loaded ${file.name}`);
    } catch (e) {
      setError(`Could not load file: ${e.message}`);
    }
  }

  const junctions = Object.values(doc.junctions);
  const roads = Object.values(doc.roads);
  const warnings = stats?.warnings ?? [];
  const selectedLabel = useMemo(() => {
    if (!selection) return 'Nothing selected';
    if (selection.kind === 'junction') return doc.junctions[selection.id]?.name ?? '';
    return doc.roads[selection.id]?.name ?? '';
  }, [selection, doc]);

  const hint = draft
    ? 'Spline in progress: click the ground to add points, click a junction to connect, double-click to finish, Esc to cancel.'
    : mode === 'draw'
      ? 'Draw road: click the ground or an existing junction to start a spline.'
      : tab === 'texture'
        ? 'Texture stage: layers apply to carriageways (asphalt) and sidewalks/plazas (paving).'
        : 'Click a junction or road to select. Drag the gizmo to move an intersection. Right-drag to pan, wheel to zoom.';

  const headerToggle = (key, label) => (
    <Toggle key={key} checked={doc.vis[key] !== false} label={label} onChange={(v) => live({ ...doc, vis: { ...doc.vis, [key]: v } })} />
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="mark" />Road Studio</div>
        <div className="stage-tabs">
          <button type="button" className={tab === 'network' ? 'on' : ''} onClick={() => setTab('network')}>1 · Network</button>
          <button type="button" className={tab === 'texture' ? 'on' : ''} onClick={() => { setTab('texture'); setMode('select'); }}>2 · Texture</button>
        </div>
        <div className="top-toggles">
          {TOGGLES.map(([k, l]) => headerToggle(k, l))}
          <Toggle checked={doc.env.shadows} label="Shadows" onChange={(v) => live({ ...doc, env: { ...doc.env, shadows: v } })} />
        </div>
        <div className="top-actions">
          <Button variant="ghost" onClick={undo} title="Undo (Ctrl+Z)" disabled={!hist.current.past.length}>Undo</Button>
          <Button variant="ghost" onClick={redo} title="Redo (Ctrl+Shift+Z)" disabled={!hist.current.future.length}>Redo</Button>
          <Button variant="ghost" onClick={() => { commit(createDemoDoc()); setSelection(null); }}>Demo</Button>
          <Button variant="ghost" onClick={() => { commit(emptyDoc()); setSelection(null); }}>New</Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>Open</Button>
          <Button onClick={save}>Save</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
        </div>
      </header>

      <aside className="left">
        <section className="card">
          <header className="card-heading"><span>Tools</span></header>
          <div className="card-body">
            {tab === 'network' ? (
              <>
                <div className="seg">
                  <button type="button" className={mode === 'select' ? 'on' : ''} onClick={() => setMode('select')} title="Select (V)">Select</button>
                  <button type="button" className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')} title="Draw road (D)">Draw road</button>
                </div>
                <div className="field">
                  <span className="field-label">New road class</span>
                  <select className="select" value={roadClass} onChange={(e) => setRoadClass(e.target.value)}>
                    {Object.entries(ROAD_CLASSES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                  </select>
                </div>
                <Toggle checked={snap} label="Snap to 0.5 m grid" onChange={setSnap} />
              </>
            ) : (
              <p className="hint">Pick a surface below. Its layerstack is edited on the right and applies everywhere that surface is used.</p>
            )}
          </div>
        </section>

        <section className="card outliner">
          <header className="card-heading"><span>Outliner</span><span className="card-actions">{junctions.length} J · {roads.length} R</span></header>
          <div className="card-body tree">
            <div className="tree-group">Surfaces</div>
            {[['asphalt', 'Carriageway (asphalt)'], ['paving', 'Sidewalk & plaza (paving)']].map(([k, l]) => (
              <button key={k} type="button" className={`tree-row${surface === k ? ' sel' : ''}`} onClick={() => setSurface(k)}>
                <span className="glyph">▦</span><span className="name">{l}</span><span className="meta">{doc.stacks[k].length} layers</span>
              </button>
            ))}
            <div className="tree-group">Junctions</div>
            {junctions.length === 0 ? <p className="hint">No junctions. Use Draw road to create one.</p> : null}
            {junctions.map((J) => (
              <button key={J.id} type="button" className={`tree-row${selection?.id === J.id ? ' sel' : ''}`} onClick={() => { setSelection({ kind: 'junction', id: J.id }); setMode('select'); }}>
                <span className="glyph">◉</span><span className="name">{J.name}</span><span className="meta">{roadsAt(doc, J.id).length} ends</span>
              </button>
            ))}
            <div className="tree-group">Roads</div>
            {roads.length === 0 ? <p className="hint">No roads yet.</p> : null}
            {roads.map((R) => (
              <button key={R.id} type="button" className={`tree-row${selection?.id === R.id ? ' sel' : ''}`} onClick={() => { setSelection({ kind: 'road', id: R.id }); setMode('select'); }}>
                <span className="glyph">━</span><span className="name">{R.name}</span>
                <span className="meta">{ROAD_CLASSES[R.cls]?.label ?? R.cls}{R.bridge ? ' · bridge' : ''}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="viewport">
        <canvas ref={canvasRef} className="gpu" />
        <canvas ref={overlayRef} className="overlay" />
        <div className="hint-bar">{hint}</div>
        {notice ? <div className="toast" onClick={() => setNotice('')}>{notice}</div> : null}
        {!ready && !error ? <div className="veil">Starting WebGPU…</div> : null}
        {error ? (
          <div className="veil error">
            <strong>Road Studio could not start.</strong>
            <span>{error}</span>
            <span className="hint">This app needs a browser with WebGPU enabled (current Chrome, Edge, or Safari 18+).</span>
          </div>
        ) : null}
      </main>

      <aside className="right">
        {tab === 'texture' ? (
          <>
            <LayerStack doc={doc} surface={surface} setSurface={setSurface} commit={commit} />
            <Inspector doc={doc} selection={selection} commit={commit} live={live} onFocus={() => stageRef.current?.focusSelection()} />
          </>
        ) : (
          <>
            <section className="card">
              <header className="card-heading"><span>{selection ? 'Inspector' : 'Scene'}</span>
                {selection ? <span className="card-actions"><Button variant="ghost" onClick={() => setSelection(null)}>Clear</Button></span> : null}</header>
              <div className="card-body sel-name">{selectedLabel}</div>
            </section>
            <Inspector doc={doc} selection={selection} commit={commit} live={live} onFocus={() => stageRef.current?.focusSelection()} />
            <LayerStack doc={doc} surface={surface} setSurface={setSurface} commit={commit} />
          </>
        )}
      </aside>

      <footer className="statusbar">
        <span className={building ? 'pulse' : 'ok'}>{building ? 'Building…' : 'Up to date'}</span>
        {stats ? (
          <>
            <span>{stats.quads.toLocaleString()} quads</span>
            <span>{stats.tris.toLocaleString()} tris</span>
            <span>{stats.degenerate} degenerate</span>
            <span>{stats.buildMs} ms build</span>
          </>
        ) : null}
        <span>{Math.min(25, doc.traffic.count)} vehicles (max 25)</span>
        <span className="grow" />
        {warnings.length ? <span className="warn" title={warnings.map((w) => w.msg).join('\n')}>⚠ {warnings[0].msg}{warnings.length > 1 ? ` (+${warnings.length - 1})` : ''}</span> : <span>No topology warnings</span>}
        <span className="muted">{selectedLabel && selection ? selectedLabel : ''}</span>
      </footer>
    </div>
  );
}

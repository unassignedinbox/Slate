import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { getNodeDef, PORT_COLORS, type GraphNode } from '../../core/graph/types';
import { Icon } from '../icons';
import { NodeCard, type PortHit } from './NodeCard';
import { AddPalette } from './AddPalette';
import { ViewSettings } from './ViewSettings';
import { Inspector } from './Inspector';
import { NODE_W, nodeHeight, portOffset, wirePath } from './geometry';
import { useThumbs } from '../thumbs';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'node'; ids: string[]; sx: number; sy: number; origin: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'wire'; from: PortHit; x: number; y: number }
  | { kind: 'marquee'; sx: number; sy: number; x: number; y: number }
  | null;

export function NodeEditor() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const pinned = useStore((s) => s.pinned);
  const issues = useStore((s) => s.issues);
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const progressLabel = useStore((s) => s.progressLabel);
  const pan = useStore((s) => s.pan);
  const zoom = useStore((s) => s.zoom);
  const background = useStore((s) => s.background);
  const canvasControls = useStore((s) => s.canvasControls);
  const autoBuild = useStore((s) => s.autoBuild);

  const store = useStore;
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const dragRef = useRef<Drag>(null);
  dragRef.current = drag;
  const [hotPort, setHotPort] = useState<PortHit | null>(null);
  const hotRef = useRef<PortHit | null>(null);
  hotRef.current = hotPort;
  const [palette, setPalette] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const thumbs = useThumbs((s) => s.map);
  const thumbsOn = useThumbs((s) => s.enabled);

  const nodeById = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);

  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (cx - r.left - pan.x) / zoom, y: (cy - r.top - pan.y) / zoom };
    },
    [pan, zoom],
  );

  const toScreen = useCallback(
    (wx: number, wy: number) => ({ x: wx * zoom + pan.x, y: wy * zoom + pan.y }),
    [pan, zoom],
  );

  // ------------------------------------------------------------ wheel zoom
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const s = store.getState();
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        const factor = Math.exp(-e.deltaY * 0.0016);
        const nz = Math.min(2.4, Math.max(0.12, s.zoom * factor));
        const k = nz / s.zoom;
        store.setState({
          zoom: nz,
          pan: { x: mx - (mx - s.pan.x) * k, y: my - (my - s.pan.y) * k },
        });
      } else {
        store.setState({ pan: { x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY } });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store]);

  // --------------------------------------------------------------- pointer
  const onPointerDownBG = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey) || e.button === 2) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) {
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ kind: 'marquee', sx: w.x, sy: w.y, x: w.x, y: w.y });
      if (!e.shiftKey) store.getState().select([]);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  };

  const onPointerDownCard = (e: React.PointerEvent, node: GraphNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = store.getState();
    let ids = s.selection;
    if (!ids.includes(node.id)) {
      ids = e.shiftKey ? [...ids, node.id] : [node.id];
      s.select(ids);
    }
    if (node.locked) return;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const n = nodeById.get(id);
      if (n) origin.set(id, { x: n.x, y: n.y });
    }
    setDrag({ kind: 'node', ids, sx: e.clientX, sy: e.clientY, origin, moved: false });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPortDown = (e: React.PointerEvent, hit: PortHit) => {
    if (e.button !== 0) return;
    const s = store.getState();
    if (hit.dir === 'in') {
      // grabbing a connected input detaches it and lets you re-drop it
      const edge = s.doc.edges.find((ed) => ed.to === hit.nodeId && ed.toPort === hit.portId);
      if (edge) {
        const src = nodeById.get(edge.from);
        s.disconnect(edge.id);
        if (src) {
          const w = toWorld(e.clientX, e.clientY);
          setDrag({ kind: 'wire', from: { nodeId: edge.from, portId: edge.fromPort, dir: 'out', type: hit.type }, x: w.x, y: w.y });
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    const w = toWorld(e.clientX, e.clientY);
    setDrag({ kind: 'wire', from: hit, x: w.x, y: w.y });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPortUp = (_e: React.PointerEvent, hit: PortHit) => {
    const d = dragRef.current;
    if (d?.kind !== 'wire') return;
    finishWire(hit);
  };

  const finishWire = (hit: PortHit | null) => {
    const d = dragRef.current;
    if (d?.kind !== 'wire') return;
    if (hit && hit.dir !== d.from.dir && hit.type === d.from.type) {
      const s = store.getState();
      if (d.from.dir === 'out') s.connect(d.from.nodeId, d.from.portId, hit.nodeId, hit.portId);
      else s.connect(hit.nodeId, hit.portId, d.from.nodeId, d.from.portId);
    }
    setDrag(null);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const s = store.getState();
      if (d.kind === 'pan') {
        s.setView({ pan: { x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) } });
      } else if (d.kind === 'node') {
        const dx = (e.clientX - d.sx) / zoom;
        const dy = (e.clientY - d.sy) / zoom;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) d.moved = true;
        const snap = e.ctrlKey || e.metaKey ? 20 : 1;
        store.setState((st) => ({
          doc: {
            ...st.doc,
            nodes: st.doc.nodes.map((n) => {
              const o = d.origin.get(n.id);
              if (!o) return n;
              return { ...n, x: Math.round((o.x + dx) / snap) * snap, y: Math.round((o.y + dy) / snap) * snap };
            }),
          },
        }));
      } else if (d.kind === 'wire') {
        const w = toWorld(e.clientX, e.clientY);
        setDrag({ ...d, x: w.x, y: w.y });
      } else if (d.kind === 'marquee') {
        const w = toWorld(e.clientX, e.clientY);
        setDrag({ ...d, x: w.x, y: w.y });
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) { setDrag(null); return; }
      const s = store.getState();
      if (d.kind === 'node') {
        if (d.moved) {
          // record a history entry for the completed move
          const snapshot = JSON.stringify(s.doc);
          store.setState((st) => ({ past: [...st.past, snapshot].slice(-80), future: [] }));
        }
      } else if (d.kind === 'wire') {
        const target = hotRef.current;
        if (target) finishWire(target);
        else {
          // dropped on empty canvas -> offer the palette there
          const r = rootRef.current?.getBoundingClientRect();
          if (r) {
            const w = toWorld(e.clientX, e.clientY);
            setPalette({ x: e.clientX - r.left, y: e.clientY - r.top, wx: w.x, wy: w.y });
            pendingWire.current = d.from;
          }
        }
      } else if (d.kind === 'marquee') {
        const x0 = Math.min(d.sx, d.x);
        const x1 = Math.max(d.sx, d.x);
        const y0 = Math.min(d.sy, d.y);
        const y1 = Math.max(d.sy, d.y);
        if (x1 - x0 > 4 || y1 - y0 > 4) {
          const hits = s.doc.nodes
            .filter((n) => {
              const h = nodeHeight(n, { hasThumb: thumbsOn && !!thumbs[n.id], issue: issues.some((i) => i.nodeId === n.id) });
              return n.x < x1 && n.x + NODE_W > x0 && n.y < y1 && n.y + h > y0;
            })
            .map((n) => n.id);
          s.select(hits, e.shiftKey);
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, zoom, toWorld, store, thumbs, thumbsOn, issues]);

  const pendingWire = useRef<PortHit | null>(null);

  // ------------------------------------------------------------- shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = store.getState();
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); }
      else if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); s.redo(); }
      else if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateNodes(s.selection); }
      else if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); s.select(s.doc.nodes.map((n) => n.id)); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (s.selection.length) { e.preventDefault(); s.removeNodes(s.selection); } }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const r = rootRef.current?.getBoundingClientRect();
        if (r) {
          const cx = r.width / 2;
          const cy = r.height / 2;
          setPalette({ x: cx - 146, y: cy - 200, wx: (cx - pan.x) / zoom, wy: (cy - pan.y) / zoom });
        }
      } else if (e.key.toLowerCase() === 'f' && s.selection.length) {
        e.preventDefault();
        frameNodes(s.selection);
      } else if (e.key.toLowerCase() === 'p' && s.selection.length === 1) {
        e.preventDefault();
        s.pin(s.pinned === s.selection[0] ? null : s.selection[0]);
      } else if (e.key.toLowerCase() === 'm' && s.selection.length) {
        e.preventDefault();
        for (const id of s.selection) {
          const n = s.doc.nodes.find((x) => x.id === id);
          if (n) s.setNodeFlag(id, 'bypassed', !n.bypassed);
        }
      } else if (e.key === 'Escape') {
        setPalette(null);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, pan, zoom]);

  const frameNodes = (ids: string[]) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const list = ids.length ? doc.nodes.filter((n) => ids.includes(n.id)) : doc.nodes;
    if (!list.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) {
      const h = nodeHeight(n, { hasThumb: thumbsOn && !!thumbs[n.id], issue: false });
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + NODE_W); y1 = Math.max(y1, n.y + h);
    }
    const pad = 80;
    const z = Math.min(1.2, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)));
    const nz = Math.max(0.12, z);
    store.setState({
      zoom: nz,
      pan: { x: r.width / 2 - ((x0 + x1) / 2) * nz, y: r.height / 2 - ((y0 + y1) / 2) * nz },
    });
  };

  // --------------------------------------------------------------- wires
  const wires = useMemo(() => {
    const out: { id: string; d: string; color: string; from: string; to: string }[] = [];
    for (const e of doc.edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      const pa = portOffset(a, e.fromPort, 'out');
      const pb = portOffset(b, e.toPort, 'in');
      const def = getNodeDef(a.type);
      const type = def?.outputs.find((o) => o.id === e.fromPort)?.type ?? 'field';
      out.push({
        id: e.id,
        d: wirePath(a.x + pa.x, a.y + pa.y, b.x + pb.x, b.y + pb.y),
        color: PORT_COLORS[type],
        from: e.from,
        to: e.to,
      });
    }
    return out;
  }, [doc.edges, nodeById]);

  const liveWire = useMemo(() => {
    if (drag?.kind !== 'wire') return null;
    const n = nodeById.get(drag.from.nodeId);
    if (!n) return null;
    const p = portOffset(n, drag.from.portId, drag.from.dir);
    const a = { x: n.x + p.x, y: n.y + p.y };
    return drag.from.dir === 'out'
      ? wirePath(a.x, a.y, drag.x, drag.y)
      : wirePath(drag.x, drag.y, a.x, a.y);
  }, [drag, nodeById]);

  const connectedIn = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of doc.edges) {
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.to)!.add(e.toPort);
    }
    return m;
  }, [doc.edges]);

  const connectedOut = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of doc.edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      m.get(e.from)!.add(e.fromPort);
    }
    return m;
  }, [doc.edges]);

  const issuesByNode = useMemo(() => {
    const m = new Map<string, typeof issues>();
    for (const i of issues) {
      if (!m.has(i.nodeId)) m.set(i.nodeId, []);
      m.get(i.nodeId)!.push(i);
    }
    return m;
  }, [issues]);

  // node toolbar anchored above the single selected node
  const toolbarFor = selection.length === 1 ? nodeById.get(selection[0]) : undefined;
  const toolbarPos = toolbarFor ? toScreen(toolbarFor.x, toolbarFor.y) : null;

  const addAt = (type: string) => {
    if (!palette) return;
    const s = store.getState();
    const id = s.addNode(type, palette.wx, palette.wy - 40);
    const pw = pendingWire.current;
    if (id && pw) {
      const def = getNodeDef(type);
      if (def) {
        if (pw.dir === 'out') {
          const port = def.inputs.find((p) => p.type === pw.type);
          if (port) s.connect(pw.nodeId, pw.portId, id, port.id);
        } else {
          const port = def.outputs.find((p) => p.type === pw.type);
          if (port) s.connect(id, port.id, pw.nodeId, pw.portId);
        }
      }
    }
    pendingWire.current = null;
    setPalette(null);
  };

  const marquee = drag?.kind === 'marquee' ? drag : null;

  return (
    <div
      className="editor-root"
      ref={rootRef}
      onContextMenu={(e) => {
        e.preventDefault();
        const r = rootRef.current!.getBoundingClientRect();
        const w = toWorld(e.clientX, e.clientY);
        setPalette({ x: Math.min(e.clientX - r.left, r.width - 300), y: Math.min(e.clientY - r.top, r.height - 470), wx: w.x, wy: w.y });
      }}
    >
      <div
        className={`editor-bg ${background}`}
        style={background === 'dots' ? { backgroundSize: `${22 * zoom}px ${22 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` } : undefined}
        onPointerDown={onPointerDownBG}
        onDoubleClick={(e) => {
          const r = rootRef.current!.getBoundingClientRect();
          const w = toWorld(e.clientX, e.clientY);
          setPalette({ x: Math.min(e.clientX - r.left, r.width - 300), y: Math.min(e.clientY - r.top, r.height - 470), wx: w.x, wy: w.y });
        }}
      />

      <div className="editor-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="wire-layer" width="1" height="1">
          {wires.map((w) => (
            <g key={w.id}>
              <path
                className="wire-hit"
                d={w.d}
                onPointerEnter={() => setHoverEdge(w.id)}
                onPointerLeave={() => setHoverEdge(null)}
                onPointerDown={(e) => {
                  if (e.altKey || e.button === 1) { e.stopPropagation(); store.getState().disconnect(w.id); }
                }}
              />
              <path
                className="wire"
                d={w.d}
                stroke={hoverEdge === w.id ? '#e8e8ea' : w.color}
                strokeWidth={hoverEdge === w.id ? 2.4 : 1.7}
                opacity={selection.length && !selection.includes(w.from) && !selection.includes(w.to) ? 0.5 : 0.95}
              />
            </g>
          ))}
          {liveWire && (
            <path className="wire" d={liveWire} stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" />
          )}
        </svg>

        {doc.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selected={selection.includes(n.id)}
            pinned={pinned === n.id}
            dragging={drag?.kind === 'node' && drag.ids.includes(n.id)}
            connectedIn={connectedIn.get(n.id) ?? EMPTY}
            connectedOut={connectedOut.get(n.id) ?? EMPTY}
            issues={issuesByNode.get(n.id) ?? EMPTY_ARR}
            hotPort={hotPort}
            onPointerDownCard={onPointerDownCard}
            onPortDown={onPortDown}
            onPortUp={onPortUp}
            onPortEnter={setHotPort}
            onDoubleClick={(node) => store.getState().pin(store.getState().pinned === node.id ? null : node.id)}
          />
        ))}

        {marquee && (
          <div
            className="marquee"
            style={{
              left: Math.min(marquee.sx, marquee.x),
              top: Math.min(marquee.sy, marquee.y),
              width: Math.abs(marquee.x - marquee.sx),
              height: Math.abs(marquee.y - marquee.sy),
            }}
          />
        )}
      </div>

      {/* floating toolbar above the selected node */}
      {toolbarFor && toolbarPos && (
        <div className="node-toolbar" style={{ left: toolbarPos.x, top: toolbarPos.y - 42 }}>
          <button className="iconbtn" title={toolbarFor.folded ? 'Expand' : 'Collapse'} onClick={() => store.getState().setNodeFlag(toolbarFor.id, 'folded', !toolbarFor.folded)}>
            <Icon name={toolbarFor.folded ? 'plus' : 'minus'} size={13} />
          </button>
          <button className={`iconbtn${pinned === toolbarFor.id ? ' accent on' : ''}`} title="Preview in viewport (P)" onClick={() => store.getState().pin(pinned === toolbarFor.id ? null : toolbarFor.id)}>
            <Icon name="eye" size={13} />
          </button>
          <button className={`iconbtn${toolbarFor.bypassed ? ' accent on' : ''}`} title="Bypass (M)" onClick={() => store.getState().setNodeFlag(toolbarFor.id, 'bypassed', !toolbarFor.bypassed)}>
            <Icon name="diamond" size={13} />
          </button>
          <button className={`iconbtn${toolbarFor.locked ? ' on' : ''}`} title="Lock position" onClick={() => store.getState().setNodeFlag(toolbarFor.id, 'locked', !toolbarFor.locked)}>
            <Icon name={toolbarFor.locked ? 'lock' : 'unlock'} size={13} />
          </button>
          <button className="iconbtn" title="Open parameters" onClick={() => setInspectorOpen(true)}>
            <Icon name="text" size={13} />
          </button>
          <button className="iconbtn" title="Frame (F)" onClick={() => frameNodes([toolbarFor.id])}>
            <Icon name="search" size={13} />
          </button>
          <button className="iconbtn danger" title="Delete" onClick={() => store.getState().removeNodes([toolbarFor.id])}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {/* top-left pill */}
      <div className="ed-top">
        <div className="pill">
          <button
            className={`iconbtn${background === 'dots' ? ' on' : ''}`}
            title="Toggle dotted grid"
            onClick={() => store.getState().setView({ background: background === 'dots' ? 'blank' : 'dots' })}
          >
            <Icon name="grid" size={15} />
          </button>
          <button className={`iconbtn${inspectorOpen ? ' on' : ''}`} title="Parameters" onClick={() => setInspectorOpen((v) => !v)}>
            <Icon name="sliders" size={15} />
          </button>
          <button
            className={`iconbtn${status === 'building' ? ' accent' : ''}`}
            title={autoBuild ? 'Rebuild now' : 'Build'}
            onClick={() => store.getState().requestBuild()}
          >
            <Icon name={status === 'building' ? 'pause' : 'play'} size={15} />
          </button>
        </div>
        {canvasControls && (
          <div className="pill">
            <button className="iconbtn" title="Zoom out" onClick={() => store.setState((s) => ({ zoom: Math.max(0.12, s.zoom * 0.85) }))}><Icon name="minus" size={14} /></button>
            <span className="pill-label" style={{ padding: '0 4px', minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
            <button className="iconbtn" title="Zoom in" onClick={() => store.setState((s) => ({ zoom: Math.min(2.4, s.zoom * 1.18) }))}><Icon name="plus" size={14} /></button>
            <div className="pill-sep" />
            <button className="iconbtn" title="Frame all (F)" onClick={() => frameNodes([])}><Icon name="search" size={14} /></button>
          </div>
        )}
      </div>

      {/* top-right */}
      <div className="ed-topright" style={{ position: 'absolute' }}>
        <div style={{ position: 'relative' }}>
          <button className={`round-btn${settingsOpen ? ' on' : ''}`} onClick={() => setSettingsOpen((v) => !v)} title="Canvas settings">
            <Icon name="sliders" size={15} />
          </button>
          {settingsOpen && <ViewSettings onClose={() => setSettingsOpen(false)} />}
        </div>
      </div>

      {inspectorOpen && <Inspector onClose={() => setInspectorOpen(false)} />}

      {/* build status, bottom-left */}
      <div className="build-status">
        <div className="build-row">
          <span className="build-label">
            {status === 'building' ? progressLabel || 'Building' : status === 'error' ? 'Build failed' : 'Built'}
          </span>
          <span className="build-pct">{Math.round((status === 'building' ? progress : 1) * 100)}%</span>
        </div>
        <div className={`build-bar${status === 'building' ? ' busy' : status === 'error' ? ' err' : ''}`}>
          <i style={{ width: `${(status === 'building' ? progress : 1) * 100}%` }} />
        </div>
      </div>

      <div className="ctxhint">
        <div>Tab / double-click · add node</div>
        <div>drag port · connect &nbsp; alt+click wire · cut</div>
      </div>

      {palette && (
        <AddPalette
          x={palette.x}
          y={palette.y}
          onPick={addAt}
          onClose={() => { setPalette(null); pendingWire.current = null; }}
        />
      )}
    </div>
  );
}

const EMPTY = new Set<string>();
const EMPTY_ARR: any[] = [];

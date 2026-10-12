import { isCurbAccess, anchorCurbAccess } from './lib/streetscape.js';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  Download,
  Play,
  Square,
  Route as Road,
  Sparkles,
  Box,
  Undo2,
  Redo2,
  HelpCircle,
  Save,
  FolderOpen,
  FileJson,
  Copy,
  Trash2,
  Focus,
  Keyboard,
  X,
  PanelRight,
  Circle,
  Grid2X2,
  Route,
  Network,
  LoaderCircle,
  AlertTriangle,
  ArrowUpRight,
  SlidersHorizontal,
} from 'lucide-react';
import Library, { AssetTray } from './components/Library.jsx';
import Inspector, { DetailInspector } from './components/Inspector.jsx';
import Viewport from './components/Viewport.jsx';
import { GeneratorDialog, ExportDialog, HelpDialog } from './components/Dialogs.jsx';
import {
  createInitialNetwork,
  createRoad,
  networkStats,
  updateRoad,
  movePoint,
  splitRoad,
  validateNetwork,
  downloadFile,
  roadWidth,
  roadLength,
  addRoadWithIntersections,
  createRoundabout,
  createBridge,
  isBridgePreset,
  cloverleafFromGesture,
  diamondFromGesture,
  junctionFromGesture,
  insertRoads,
  DETAILS,
} from './lib/network.js';

import {
  detailPlacement,
  anchorRoadMarking,
  updatePlacedDetail,
  reconcileRoadDetails,
  isRoadMarking,
  isRoadAttachedDetail,
  resolveAttachedDetail,
} from './lib/placement.js';
import { structurePlacementConflict } from './lib/infrastructure.js';
import { addBezierHandle, frameAt } from './lib/curves.js';

const STORAGE_KEY = 'frontier-road-studio-v1';
function initialProject() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return reconcileRoadDetails(validateNetwork(JSON.parse(stored)));
  } catch {
    /* Corrupt or old browser data never prevents booting. */
  }
  return createInitialNetwork();
}
function historyReducer(state, action) {
  if (action.type === 'undo' && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1),
      future: [state.present, ...state.future],
    };
  if (action.type === 'redo' && state.future.length)
    return {
      past: [...state.past, state.present].slice(-35),
      present: state.future[0],
      future: state.future.slice(1),
    };
  if (action.type === 'change') {
    const requested = typeof action.next === 'function' ? action.next(state.present) : action.next;
    if (requested === state.present) return state;
    const next = reconcileRoadDetails(requested, state.present);
    return { past: [...state.past, state.present].slice(-35), present: next, future: [] };
  }
  return state;
}

function FrontierLogo() {
  return (
    <svg className="brand-logo" viewBox="0 0 29 30" aria-hidden="true">
      <path d="M3 23V8l7-4v18l-7 4z" fill="#c6cabe" />
      <path d="M12 21V7l7-4v15l-7 4z" fill="#969f8e" />
      <path d="M21 17V6l5-3v12l-5 3z" fill="#d8bd86" />
      <path d="M3 8l7-4 16-1-7 4z" fill="#d0d2c0" />
      <path d="M12 17l7-4 7-1v3l-14 9z" fill="#d8bd86" />
    </svg>
  );
}

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, null, () => ({
    past: [],
    present: initialProject(),
    future: [],
  }));
  const network = history.present;
  const [selectedId, setSelectedId] = useState(
    () =>
      network.roads.find(
        (r) => r.type === 'arterial' && Math.abs(r.points[0].x) < 1 && Math.abs(r.points[0].z) < 1,
      )?.id || network.roads[0]?.id,
  );
  const [selectedPropId, setSelectedPropId] = useState(null);
  const selectedProp = network.props.find((p) => p.id === selectedPropId);
  const selected = network.roads.find((r) => r.id === selectedId) || null;
  const stats = useMemo(() => networkStats(network), [network]);
  const [activePreset, setActivePreset] = useState('arterial');
  const [activeDetail, setActiveDetail] = useState(null);
  const [tool, setTool] = useState('select');
  const [snap, setSnap] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);
  const [tab, setTab] = useState('Library');
  const [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [toast, setToast] = useState(null);
  const [driving, setDriving] = useState(false);
  const [assetExpanded, setAssetExpanded] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const viewport = useRef(null),
    importInput = useRef(null),
    toastTimer = useRef(null),
    menuRef = useRef(null);
  const projectRef = useRef(network);
  projectRef.current = network;
  const change = useCallback((next) => {
    setSaved(false);
    dispatch({ type: 'change', next });
  }, []);
  const notify = useCallback((message, kind = 'success') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);
  const save = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projectRef.current));
      setSaved(true);
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      setSaved(false);
      return false;
    }
  }, []);
  useEffect(() => {
    if (saved) return;
    const timer = setTimeout(save, 500);
    return () => clearTimeout(timer);
  }, [network, saved, save]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const hide = () => {
      save();
    };
    const visibility = () => {
      if (document.hidden) save();
    };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [save]);
  useEffect(() => {
    if (!network.props.some((p) => p.id === selectedPropId)) setSelectedPropId(null);
  }, [network.props, selectedPropId]);
  useEffect(() => {
    if (!network.roads.some((r) => r.id === selectedId)) setSelectedId(network.roads[0]?.id);
  }, [network, selectedId]);
  useEffect(() => {
    const listener = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setHeaderMenu(null);
    };
    document.addEventListener('pointerdown', listener);
    return () => document.removeEventListener('pointerdown', listener);
  }, []);
  const undo = useCallback(() => {
    if (!history.past.length) return;
    setSaved(false);
    dispatch({ type: 'undo' });
    setDriving(false);
  }, [history.past.length]);
  const redo = useCallback(() => {
    if (!history.future.length) return;
    setSaved(false);
    dispatch({ type: 'redo' });
    setDriving(false);
  }, [history.future.length]);
  const select = (id) => {
    setSelectedPropId(null);
    setSelectedId(id);
    const road = network.roads.find((r) => r.id === id);
    if (road) setActivePreset(road.presetId || road.type);
  };
  const choosePreset = (id) => {
    setActivePreset(id);
    setActiveDetail(null);
    setTool('draw');
    setDriving(false);
  };
  const chooseTool = (id) => {
    setTool(id);
    setDriving(false);
    if (id !== 'prop') setActiveDetail(null);
  };
  const removeSelected = () => {
    if (selectedProp) {
      change((n) => ({ ...n, props: n.props.filter((p) => p.id !== selectedPropId) }));
      notify('Placed detail removed. Undo to restore.');
      return;
    }
    if (!selected) return;
    change((n) => ({ ...n, roads: n.roads.filter((r) => r.id !== selectedId) }));
    notify(`${selected.name} segment removed. Undo to restore.`);
  };
  const duplicate = () => {
    if (selectedProp) {
      if (network.props.length >= 5000) {
        notify('The browser project limit is 5,000 placed details.', 'error');
        return;
      }
      let prop = { ...selectedProp, id: `detail-${crypto.randomUUID()}`, x: selectedProp.x + 3 };
      if (selectedProp.roadId && isRoadAttachedDetail(selectedProp)) {
        const resolved = resolveAttachedDetail(network, selectedProp);
        if (!resolved) {
          notify('Reattach this detail to a road before duplicating it.', 'error');
          return;
        }
        const direction =
          resolved.distance + 8 < resolved.plan.length - resolved.plan.endTrim - 3 ? 1 : -1;
        const frame = frameAt(
          resolved.plan.curve,
          resolved.distance + direction * 8,
          resolved.plan.length,
        );
        const position = frame.point
          .clone()
          .addScaledVector(
            frame.normal,
            isCurbAccess(selectedProp)
              ? resolved.side * (resolved.plan.carriage / 2 + resolved.plan.road.sidewalk / 2)
              : resolved.prop.roadAnchor.offset,
          );
        prop = updatePlacedDetail(network, prop, { x: position.x, z: position.z, y: position.y });
        if (!prop || Math.hypot(prop.x - selectedProp.x, prop.z - selectedProp.z) < 3) {
          notify('Not enough clear road span to duplicate this detail.', 'error');
          return;
        }
      }
      change((n) => ({ ...n, props: [...n.props, prop] }));
      setSelectedPropId(prop.id);
      notify('Detail duplicated.');
      return;
    }
    if (!selected) return;
    const copiesNeeded = selected.interchangeId
      ? network.roads.filter((r) => r.interchangeId === selected.interchangeId).length
      : selected.roundaboutId
        ? network.roads.filter((r) => r.roundaboutId === selected.roundaboutId).length
        : 1;
    if (network.roads.length + copiesNeeded > 2000) {
      notify('Not enough room to duplicate (2,000 segment limit).', 'error');
      return;
    }
    if (selected.interchangeId) {
      const cluster = network.roads.filter((r) => r.interchangeId === selected.interchangeId);
      const id = `clover-${crypto.randomUUID()}`,
        nodes = new Map();
      const xs = cluster.flatMap((r) => r.points.map((p) => p.x));
      const shift = Math.max(...xs) - Math.min(...xs) + 100;
      const copies = cluster.map((r, i) => ({
        ...r,
        id: `${id}-r${i}`,
        interchangeId: id,
        points: r.points.map((p) => {
          if (p.nodeId && !nodes.has(p.nodeId)) nodes.set(p.nodeId, `node-${crypto.randomUUID()}`);
          return { ...p, x: p.x + shift, ...(p.nodeId ? { nodeId: nodes.get(p.nodeId) } : {}) };
        }),
      }));
      if (network.roads.length + copies.length > 2000) {
        notify('Not enough room for another interchange (2,000 segment limit).', 'error');
        return;
      }
      change((n) => ({ ...n, roads: [...n.roads, ...copies] }));
      setSelectedId(copies[0].id);
      setResetSignal((s) => s + 1);
      notify('Entire connected interchange duplicated.');
      return;
    }
    if (selected.roundaboutId) {
      const cluster = network.roads.filter((r) => r.roundaboutId === selected.roundaboutId);
      const id = `circle-${crypto.randomUUID()}`,
        shift = selected.radius * 2 + roadWidth(selected) + 10,
        nodes = new Map();
      const copies = cluster.map((r, i) => ({
        ...r,
        id: `${id}-arc-${i}`,
        name: 'Roundabout copy',
        roundaboutId: id,
        center: { ...r.center, x: r.center.x + shift },
        points: r.points.map((p) => {
          if (p.nodeId && !nodes.has(p.nodeId)) nodes.set(p.nodeId, `node-${crypto.randomUUID()}`);
          return { ...p, x: p.x + shift, ...(p.nodeId ? { nodeId: nodes.get(p.nodeId) } : {}) };
        }),
      }));
      change((n) => ({ ...n, roads: [...n.roads, ...copies] }));
      setSelectedId(copies[0].id);
      notify('Entire roundabout duplicated with fresh connection nodes.');
      return;
    }
    const road = {
      ...selected,
      id: `road-${crypto.randomUUID()}`,
      name: `${selected.name} copy`,
      ...(selected.center
        ? { center: { ...selected.center, x: selected.center.x + roadWidth(selected) + 12 } }
        : {}),
      points: selected.points.map((p) => ({
        ...p,
        x: p.x + roadWidth(selected) + 12,
        nodeId: `node-${crypto.randomUUID()}`,
      })),
    };
    change((n) => ({ ...n, roads: [...n.roads, road] }));
    setSelectedId(road.id);
    notify('Segment duplicated beside the original.');
  };
  const updateSelected = (changes) => {
    if (!selected) return;
    if ('elevation' in changes && selected.interchangeId) {
      const height = Math.max(6, Math.min(20, changes.elevation));
      change((n) => ({
        ...n,
        roads: n.roads.map((r) =>
          r.interchangeId !== selected.interchangeId
            ? r
            : {
                ...r,
                interchangeHeight: height,
                elevation: r.elevation ? height : 0,
                points: r.points.map((p) => ({
                  ...p,
                  y: ((p.y || 0) * height) / r.interchangeHeight,
                })),
              },
        ),
      }));
      return;
    }
    if ('elevation' in changes && selected.curveType === 'bezier') {
      const base = Math.max(
        0.1,
        selected.elevation || Math.max(...selected.points.map((p) => p.y || 0)),
      );
      const points = selected.points.map((p) => ({
        ...p,
        y: ((p.y || 0) * changes.elevation) / base,
      }));
      // Shared endpoints must follow the same height, including connected roads.
      const moved = new Map(points.filter((p) => p.nodeId).map((p) => [p.nodeId, p.y]));
      change((n) => ({
        ...n,
        roads: n.roads.map((r) =>
          r.id === selected.id
            ? { ...r, ...changes, points }
            : {
                ...r,
                points: r.points.map((p) =>
                  moved.has(p.nodeId) ? { ...p, y: moved.get(p.nodeId) } : p,
                ),
              },
        ),
      }));
      return;
    }
    if ('elevation' in changes) {
      const value = changes.elevation;
      let points = selected.points.map((p, i) => ({ ...p, y: p.nodeId ? p.y || 0 : value }));
      if (points.length === 2) {
        const a = points[0],
          b = points[1];
        points = [
          a,
          { x: a.x + (b.x - a.x) * 0.3, z: a.z + (b.z - a.z) * 0.3, y: value },
          { x: a.x + (b.x - a.x) * 0.7, z: a.z + (b.z - a.z) * 0.7, y: value },
          b,
        ];
      }
      changes = { ...changes, points };
    }
    if (changes.points) changes.customSpline = true;
    change((n) => updateRoad(n, selectedId, changes));
  };
  const create = (preset, positions) => {
    if (network.roads.length >= 2000) {
      notify('The browser project limit is 2,000 road segments.', 'error');
      return;
    }
    let points = positions;
    if (preset === 'subway') points = positions.map(({ nodeId, ...p }) => ({ ...p, y: -9 }));
    if (['tjunction', 'ymerge', 'crossroad'].includes(preset)) {
      try {
        const { base, roads } = junctionFromGesture(network, preset, positions);
        const next = insertRoads(base, roads);
        if (next.roads.length > 2000)
          throw new Error('Connections would exceed the 2,000 segment limit.');
        change(next);
        setSelectedId(roads[0].id);
        setSelectedPropId(null);
        setTool('select');
        setResetSignal((s) => s + 1);
        notify('Connected to the existing street · shared junction, no duplicate mainline.');
      } catch (error) {
        notify(error.message, 'error');
      }
      return;
    }
    if (['cloverleaf', 'diamond'].includes(preset)) {
      const roads =
        preset === 'diamond'
          ? diamondFromGesture(positions, network.standard)
          : cloverleafFromGesture(positions, network.standard);
      if (structurePlacementConflict(network, roads)) {
        notify(
          'Interchange streets overlap parallel roads. Place in clear space; use a connector tool to merge into an existing street.',
          'error',
        );
        return;
      }
      if (network.roads.length + roads.length > 2000) {
        notify('Not enough room for an interchange (2,000 segment limit).', 'error');
        return;
      }
      const next = insertRoads(network, roads);
      if (next.roads.length > 2000) {
        notify('Interchange connections would exceed the 2,000 segment limit.', 'error');
        return;
      }
      change(next);
      setSelectedId(roads[0].id);
      setSelectedPropId(null);
      setTool('select');
      setResetSignal((s) => s + 1);
      notify(
        preset === 'diamond'
          ? 'Diamond placed · 4 slip roads, 2 ramp terminals and a raised highway.'
          : 'Cloverleaf placed · 4 loops, 4 connectors and a grade-separated overpass.',
      );
      return;
    }
    if (preset === 'roundabout') {
      const center = positions[0],
        radius = Math.hypot(positions.at(-1).x - center.x, positions.at(-1).z - center.z);
      const circularRoads = createRoundabout(center, radius);
      change((n) => ({ ...n, roads: [...n.roads, ...circularRoads] }));
      setSelectedId(circularRoads[0].id);
      setSelectedPropId(null);
      setTool('select');
      notify('Roundabout created with 12 shared entry nodes. Snap roads to connect.');
      return;
    }
    setSelectedPropId(null);
    const road = isBridgePreset(preset)
      ? createBridge(positions, preset)
      : createRoad(preset, points);
    const next = addRoadWithIntersections(network, road);
    if (next.roads.length > 2000) {
      notify('Crossings would exceed the 2,000 segment limit.', 'error');
      return;
    }
    change(next);
    setSelectedId(road.id);
    setTool('select');
    notify(`${road.name} created · ${roadLength(road).toFixed(0)} m.`);
  };
  const placeDetail = (detail, position) => {
    if (!detail) return;
    if (network.props.length >= 5000) {
      notify('This project has reached the 5,000 detail limit.', 'error');
      return;
    }
    const placement = detailPlacement(network, detail.id, position, selectedId);
    if (!placement) {
      notify(
        isCurbAccess({ type: detail.id })
          ? 'Place curb ramps on a road with sidewalks, clear of junctions and railway decks.'
          : 'Place markings on a clear paved road, away from junctions and rail crossings.',
        'error',
      );
      return;
    }
    let prop = {
      id: `detail-${crypto.randomUUID()}`,
      type: detail.id,
      x: placement.x,
      z: placement.z,
      y: placement.y,
      rotation: placement.rotation,
      width: placement.width,
    };
    if (isCurbAccess(prop)) prop = anchorCurbAccess(prop, placement);
    else if (isRoadMarking(prop))
      prop = anchorRoadMarking(prop, placement, {
        snapLane: detail.id === 'arrow',
        standard: network.standard,
      });
    change((n) => ({ ...n, props: [...n.props, prop] }));
    setSelectedPropId(prop.id);
    notify(`${detail.name} placed. Click again to add another.`);
  };
  const updateDetail = (id, changes) => {
    const prop = network.props.find((p) => p.id === id);
    if (!prop) return;
    const next = updatePlacedDetail(network, prop, changes);
    if (!next) {
      notify(
        isCurbAccess(prop)
          ? 'No clear sidewalk here. Use a road with paving, away from railway decks.'
          : 'No safe road surface here. Drag the marking onto a clear carriageway.',
        'error',
      );
      return;
    }
    change((n) => ({ ...n, props: n.props.map((p) => (p.id === id ? next : p)) }));
  };
  const split = () => {
    if (!selected) return;
    if (selected.closed) {
      notify(
        'Roundabouts are already closed loops. Add entry roads with endpoint snapping.',
        'error',
      );
      return;
    }
    change((n) => splitRoad(n, selectedId));
    notify('Segment split. The new junction shares both endpoints.');
  };
  const importProject = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Project file must be smaller than 8 MB.');
      const imported = validateNetwork(JSON.parse(await file.text()));
      setSelectedPropId(null);
      change(imported);
      setSelectedId(imported.roads[0]?.id);
      setActivePreset(imported.roads[0]?.presetId || imported.roads[0]?.type || 'arterial');
      setResetSignal((s) => s + 1);
      setDriving(false);
      notify(`${imported.name} project opened.`);
    } catch (e) {
      notify(`Could not open project: ${e.message}`, 'error');
    }
  };
  const exportJSON = () => {
    downloadFile(
      `${network.name.toLowerCase().replace(/\W+/g, '-')}.roads.json`,
      JSON.stringify(network, null, 2),
    );
    notify('Editable road project downloaded.');
  };
  const generate = (next) => {
    setSelectedPropId(null);
    change(next);
    setSelectedId(next.roads.find((r) => r.type === 'arterial')?.id || next.roads[0]?.id);
    setActivePreset(
      next.roads.find((r) => r.type === 'arterial')?.type || next.roads[0]?.type || 'arterial',
    );
    setTool('select');
    setDialog(null);
    setDriving(false);
    setResetSignal((s) => s + 1);
    notify(`${next.name} generated · ${next.roads.length} connected road segments.`);
  };
  const moveHandle = (id, index, position) => {
    const next = movePoint(network, id, index, position);
    if (next === network) {
      notify('That move would collapse a segment. Keep endpoints apart.', 'error');
      return;
    }
    change(next);
  };
  const addControlPoint = () => {
    if (!selected || selected.points.length >= 128) return;
    if (selected.curveType === 'bezier') {
      if (selected.points.length > 125) return;
      updateSelected({ points: addBezierHandle(selected) });
      setTool('move');
      notify('Bézier handles added without changing the curve.');
      return;
    }
    const index = Math.floor(selected.points.length / 2),
      a = selected.points[index - 1],
      b = selected.points[index];
    const points = [...selected.points];
    points.splice(index, 0, {
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      y: ((a.y || 0) + (b.y || 0)) / 2,
    });
    updateSelected({ points });
    setTool('move');
    notify('Midpoint handle added. Drag it to bend the road.');
  };
  const rebuild = () => {
    if (!selected) return;
    change((n) => updateRoad(n, selectedId, {}));
    notify('Segment rebuilt · indexed mesh and markings updated.');
  };

  useEffect(() => {
    const listener = (e) => {
      if (dialog) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        if (save()) notify('Project saved in this browser.');
        else notify('Browser storage is full. Export JSON to keep your work.', 'error');
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault();
        document.querySelector('.library-search input')?.focus();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyV') chooseTool('select');
      if (e.code === 'KeyG') chooseTool('move');
      if (e.code === 'KeyR') chooseTool('draw');
      if (e.code === 'KeyF') {
        e.preventDefault();
        viewport.current?.focus();
      }
      if (e.code === 'Home') {
        e.preventDefault();
        viewport.current?.fit();
      }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        removeSelected();
      }
      if (e.key === 'Escape') {
        chooseTool('select');
        setDriving(false);
        setHeaderMenu(null);
      }
      if (e.key === '?') setDialog('help');
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [dialog, selectedId, selected, selectedPropId, selectedProp, save, undo, redo, activePreset]);

  const fileItems = [
    { label: 'Generate a city', icon: Sparkles, action: () => setDialog('generate') },
    { label: 'Open road project…', icon: FolderOpen, action: () => importInput.current.click() },
    {
      label: 'Save in this browser',
      icon: Save,
      key: '⌘ S',
      action: () => {
        save()
          ? notify('Project saved in this browser.')
          : notify('Storage unavailable. Export JSON instead.', 'error');
      },
    },
    { label: 'Download road project', icon: FileJson, action: exportJSON },
  ];
  const editItems = [
    { label: 'Undo', icon: Undo2, key: '⌘ Z', action: undo, disabled: !history.past.length },
    { label: 'Redo', icon: Redo2, key: '⇧ ⌘ Z', action: redo, disabled: !history.future.length },
    { label: 'Duplicate segment', icon: Copy, action: duplicate, disabled: !selected },
    {
      label: 'Delete segment',
      icon: Trash2,
      key: 'Del',
      action: removeSelected,
      disabled: !selected,
    },
  ];
  const viewItems = [
    { label: 'Frame network', icon: Focus, key: 'Home', action: () => viewport.current?.fit() },
    { label: 'Focus selection', icon: Focus, key: 'F', action: () => viewport.current?.focus() },
    {
      label: inspectorOpen ? 'Hide inspector' : 'Show inspector',
      icon: PanelRight,
      action: () => setInspectorOpen(!inspectorOpen),
    },
    { label: 'Keyboard shortcuts', icon: Keyboard, key: '?', action: () => setDialog('help') },
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => viewport.current?.fit()} title="Frame your world">
          <FrontierLogo />
          <span>
            frontier<span className="brand-period">.</span>
          </span>
        </button>
        <div className="header-divider" />
        <span className="product-title">Road Studio</span>
        <span className="experimental-badge">EXPERIMENTAL</span>
        <nav className="header-menus" ref={menuRef} aria-label="Main menu">
          {[
            { label: 'File', items: fileItems },
            { label: 'Edit', items: editItems },
            { label: 'View', items: viewItems },
          ].map((m) => (
            <div className="relative" key={m.label}>
              <button
                className={headerMenu === m.label ? 'active' : ''}
                onClick={() => setHeaderMenu(headerMenu === m.label ? null : m.label)}
              >
                {m.label}
              </button>
              {headerMenu === m.label && (
                <div className="dropdown-menu header-dropdown">
                  {m.items.map((i) => (
                    <button
                      key={i.label}
                      onClick={() => {
                        i.action();
                        setHeaderMenu(null);
                      }}
                      disabled={i.disabled}
                    >
                      <i.icon size={13} />
                      {i.label}
                      {i.key && <kbd>{i.key}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="project-breadcrumb">
          <FolderOpen size={13} />
          <span>Projects</span>
          <ChevronRight size={11} />
          <strong>{network.name}</strong>
        </div>
        <div className="header-right">
          <button
            className={`save-indicator ${storageError ? 'error' : ''}`}
            onClick={() => {
              if (save()) notify('All changes saved in this browser.');
              else notify('Storage unavailable. Export JSON to keep your work.', 'error');
            }}
            title="Saved locally in this browser"
          >
            {storageError ? (
              <AlertTriangle size={12} />
            ) : saved ? (
              <Check size={12} />
            ) : (
              <LoaderCircle size={12} className="spin" />
            )}
            {storageError ? 'Export to save' : saved ? 'All changes saved' : 'Saving changes…'}
          </button>
          <button
            className={`preview-button ${driving ? 'playing' : ''}`}
            onClick={() => {
              setDriving(!driving);
              setTool('select');
            }}
            disabled={!network.roads.length}
          >
            {driving ? <Square size={12} /> : <Play size={12} />}
            {driving ? 'Stop preview' : 'Drive preview'}
          </button>
          <button className="primary-button export-button" onClick={() => setDialog('export')}>
            <Download size={13} />
            Export
            <ChevronDown size={11} />
          </button>
        </div>
      </header>
      <div className="workspace-toolbar">
        <div className="workspace-tabs">
          <button
            className="active"
            onClick={() => {
              setTab('Library');
              setAssetExpanded(false);
              setTool('select');
            }}
          >
            <Road size={15} />
            Road editor
            <span className="tab-dot" />
          </button>
          <button onClick={() => setDialog('generate')}>
            <Sparkles size={14} />
            City generator
          </button>
          <button
            className={assetExpanded ? 'asset-active' : ''}
            onClick={() => setAssetExpanded(!assetExpanded)}
          >
            <Box size={14} />
            Asset browser
          </button>
        </div>
        <div className="workspace-right">
          <span className="world-seed">
            WORLD SEED <b>{String(network.seed).padStart(4, '0')}</b>
          </span>
          <span className="workspace-separator" />
          <button
            title="Toggle inspector"
            aria-label="Toggle inspector"
            className={inspectorOpen ? 'active' : ''}
            onClick={() => setInspectorOpen(!inspectorOpen)}
          >
            <PanelRight size={14} />
          </button>
          <button
            title="Help & keyboard shortcuts"
            aria-label="Help and keyboard shortcuts"
            onClick={() => setDialog('help')}
          >
            <HelpCircle size={15} />
          </button>
        </div>
      </div>
      <main className={`editor-workspace ${inspectorOpen ? '' : 'inspector-closed'}`}>
        <Library
          network={network}
          selectedId={selectedId}
          activePreset={activePreset}
          onPresetSelect={choosePreset}
          onSelect={select}
          onGenerate={() => setDialog('generate')}
          onVisibility={(id) =>
            change((n) => updateRoad(n, id, { hidden: !n.roads.find((r) => r.id === id).hidden }))
          }
          tab={tab}
          onTabChange={setTab}
          selectedPropId={selectedPropId}
          onSelectProp={(id) => {
            setSelectedPropId(id);
            setTool('select');
          }}
        />
        <div className="center-panel">
          <Viewport
            ref={viewport}
            network={network}
            selectedId={selectedId}
            activePreset={activePreset}
            activeDetail={activeDetail}
            selectedPropId={selectedPropId}
            onSelectProp={(id) => setSelectedPropId(id)}
            onMoveProp={updateDetail}
            tool={tool}
            onToolChange={chooseTool}
            onSelect={select}
            onCreateRoad={create}
            onMovePoint={moveHandle}
            onPlaceDetail={placeDetail}
            onNotify={notify}
            snap={snap}
            onSnapChange={setSnap}
            driving={driving}
            onDrivingChange={setDriving}
            onSplit={split}
            onUndo={undo}
            onRedo={redo}
            canUndo={!!history.past.length}
            canRedo={!!history.future.length}
            resetSignal={resetSignal}
            blocked={!!dialog}
          />
          <AssetTray
            activeDetail={activeDetail}
            onSelect={(detail) => {
              setActiveDetail(detail);
              setTool('prop');
              setDriving(false);
            }}
            expanded={assetExpanded}
            onExpand={() => setAssetExpanded(!assetExpanded)}
          />
        </div>
        {inspectorOpen &&
          (selectedProp ? (
            <DetailInspector
              prop={selectedProp}
              network={network}
              onUpdate={(changes) => updateDetail(selectedPropId, changes)}
              onFocus={() => viewport.current?.focus()}
              onDuplicate={duplicate}
              onDelete={removeSelected}
            />
          ) : (
            <Inspector
              road={selected}
              network={network}
              onUpdate={updateSelected}
              onStandardChange={(standard) => change((n) => ({ ...n, standard }))}
              onFocus={() => viewport.current?.focus()}
              onDuplicate={duplicate}
              onDelete={removeSelected}
              onRebuild={rebuild}
              onMovePoint={moveHandle}
              onAddControlPoint={addControlPoint}
            />
          ))}
      </main>
      <footer className="status-bar">
        <div className="status-ready">
          <span className="live-dot" />
          {tool === 'draw'
            ? 'Drawing road'
            : tool === 'move'
              ? 'Spline editing'
              : tool === 'prop'
                ? 'Placing detail'
                : driving
                  ? 'Drive preview running'
                  : 'Ready to build'}
        </div>
        <span className="status-divider" />
        <span>
          <Route size={11} />
          <strong>{stats.segments}</strong> road segments
        </span>
        <span>
          <Network size={11} />
          <strong>{stats.junctions}</strong> junctions
        </span>
        <span>
          <Grid2X2 size={11} />
          <strong>{(stats.length / 1000).toFixed(1)} km</strong> network
        </span>
        <div className="status-right">
          <span>
            Units: <strong>Meters</strong>
          </span>
          <span className="status-divider" />
          <span>
            Project-Zero <b>·</b> Road Studio 0.1
          </span>
        </div>
      </footer>
      <input
        type="file"
        accept="application/json,.json"
        className="hidden-input"
        ref={importInput}
        onChange={importProject}
        aria-label="Import road project"
      />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {dialog === 'generate' && (
        <GeneratorDialog network={network} onClose={() => setDialog(null)} onGenerate={generate} />
      )}
      {dialog === 'export' && (
        <ExportDialog
          network={network}
          onClose={() => setDialog(null)}
          onExport={async (format, coords, options) => {
            if (format === 'json') exportJSON();
            else {
              await viewport.current.exportMesh(format, coords, options);
              notify(`${format.toUpperCase()} road network exported.`);
            }
          }}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

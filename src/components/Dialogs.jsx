import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Sparkles,
  ArrowRight,
  Shuffle,
  Grid3X3,
  CircleDot,
  Spline,
  Box,
  FileJson,
  Download,
  Check,
  ChevronDown,
  Keyboard,
  Navigation,
  Layers3,
  LoaderCircle,
  Info,
  Globe2,
  ArrowUpRight,
  FolderOpen,
  Network,
} from 'lucide-react';
import { generateNetwork, networkStats, createCurve } from '../lib/network.js';
import { Toggle } from './Inspector.jsx';

export function Modal({ children, onClose, className = '', label }) {
  const panel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const first = panel.current?.querySelector('button, input, select, [tabindex="0"]');
    first?.focus();
    const listener = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key !== 'Tab') return;
      const nodes = [
        ...panel.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ];
      if (!nodes.length) return;
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0].focus();
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => {
      document.removeEventListener('keydown', listener, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={panel}
      >
        {children}
      </div>
    </div>
  );
}

function NetworkPreview({ network }) {
  const points = network.roads.flatMap((r) => r.points);
  const extent =
    Math.max(...points.map((p) => Math.abs(p.x)), ...points.map((p) => Math.abs(p.z)), 100) * 1.1;
  return (
    <svg
      viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
      className="generator-preview"
      aria-label="Generated network preview"
    >
      <defs>
        <pattern
          id="generate-grid"
          width={extent / 7}
          height={extent / 7}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M${extent / 7} 0H0V${extent / 7}`}
            stroke="#84917a"
            strokeWidth={extent / 400}
            fill="none"
            opacity=".25"
          />
        </pattern>
      </defs>
      <rect x={-extent} y={-extent} width={extent * 2} height={extent * 2} fill="#29332b" />
      <rect
        x={-extent}
        y={-extent}
        width={extent * 2}
        height={extent * 2}
        fill="url(#generate-grid)"
      />
      {network.roads.map((r) => (
        <path
          key={r.id}
          d={createCurve(r)
            .getSpacedPoints(r.points.length > 2 ? 48 : 1)
            .map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.z}`)
            .join(' ')}
          fill="none"
          stroke={
            r.type === 'railway'
              ? '#c1b0cd'
              : r.type === 'bridge'
                ? '#d7bb82'
                : r.type === 'subway'
                  ? '#a18bb5'
                  : r.type === 'boulevard'
                    ? '#d7bb82'
                    : r.type === 'path'
                      ? '#789780'
                      : '#9ca992'
          }
          strokeWidth={
            extent * (r.type === 'boulevard' ? 0.022 : r.type === 'arterial' ? 0.016 : 0.008)
          }
          strokeDasharray={r.type === 'subway' ? `${extent / 30} ${extent / 50}` : undefined}
          opacity={r.type === 'local' ? 0.65 : 0.9}
        />
      ))}
    </svg>
  );
}

export function GeneratorDialog({ network, onClose, onGenerate }) {
  const [options, setOptions] = useState({
    name: network.name,
    size: 2000,
    seed: 2841,
    density: 7,
    layout: 'grid',
    cycle: true,
    bus: true,
    parking: true,
    bridge: true,
    subway: true,
    railway: false,
    loopRadius: 55,
    bridgeHeight: 8,
    standard: network.standard,
  });
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => generateNetwork(options), [options]);
  const stats = networkStats(preview);
  const set = (key, value) => setOptions((o) => ({ ...o, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => onGenerate(preview), 80);
  };
  return (
    <Modal onClose={onClose} className="generator-modal" label="Generate a city">
      <form onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-symbol">
            <Sparkles size={21} />
          </div>
          <div>
            <span className="eyebrow">PROCEDURAL WORLD BUILDING</span>
            <h2>A city, from the ground up.</h2>
            <p>Connected streets. Real-world scale. Endless possibilities.</p>
          </div>
          <button
            type="button"
            className="icon-button modal-close"
            aria-label="Close generator"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="generator-body">
          <div className="generator-controls">
            <label className="form-label">
              World name
              <input
                aria-label="World name"
                value={options.name}
                maxLength={48}
                required
                onChange={(e) => set('name', e.target.value)}
              />
            </label>
            <span className="form-label-text">Network layout</span>
            <div className="layout-options">
              {[
                { id: 'grid', name: 'City grid', icon: Grid3X3 },
                { id: 'organic', name: 'Organic', icon: Spline },
                { id: 'radial', name: 'Radial', icon: CircleDot },
                { id: 'cloverleaf', name: 'Cloverleaf', icon: Network },
              ].map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={options.layout === l.id ? 'selected' : ''}
                  onClick={() => set('layout', l.id)}
                >
                  <l.icon size={24} />
                  <span>{l.name}</span>
                  {options.layout === l.id && <Check size={10} />}
                </button>
              ))}
            </div>
            <span className="form-label-text">World size</span>
            <div className="segmented-options">
              {[2000, 4000, 8000].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={options.size === s ? 'selected' : ''}
                  onClick={() => set('size', s)}
                >
                  {s / 1000} × {s / 1000} km
                </button>
              ))}
            </div>
            {options.layout !== 'cloverleaf' ? (
              <label className="density-label">
                Street density
                <span>
                  {options.density <= 5 ? 'Sparse' : options.density >= 10 ? 'Dense' : 'Balanced'} ·
                  level {options.density}
                </span>
                <input
                  aria-label="Street density"
                  type="range"
                  min="3"
                  max="13"
                  value={options.density}
                  onChange={(e) => set('density', Number(e.target.value))}
                />
              </label>
            ) : (
              <div className="interchange-controls">
                <label className="form-label">
                  Loop radius · meters
                  <input
                    type="number"
                    aria-label="Loop radius"
                    min="40"
                    max="110"
                    step="5"
                    value={options.loopRadius}
                    onChange={(e) =>
                      set('loopRadius', Math.max(40, Math.min(110, Number(e.target.value) || 40)))
                    }
                  />
                </label>
                <label className="form-label">
                  Overpass height · meters
                  <input
                    type="number"
                    aria-label="Overpass height"
                    min="6"
                    max="20"
                    step="0.5"
                    value={options.bridgeHeight}
                    onChange={(e) =>
                      set('bridgeHeight', Math.max(6, Math.min(20, Number(e.target.value) || 6)))
                    }
                  />
                </label>
              </div>
            )}
            <label className="form-label seed-label">
              Generation seed
              <div>
                <input
                  type="number"
                  aria-label="Generation seed"
                  min="0"
                  max="999999"
                  value={options.seed}
                  onChange={(e) => set('seed', Number(e.target.value))}
                />
                <button
                  type="button"
                  title="Randomize generation seed"
                  aria-label="Randomize seed"
                  onClick={() => set('seed', Math.floor(Math.random() * 999999))}
                >
                  <Shuffle size={14} />
                </button>
              </div>
            </label>
            <span className="form-label-text">Include in your network</span>
            <div className="generate-features">
              {(options.layout === 'cloverleaf'
                ? [['railway', 'Surface railway']]
                : [
                    ['railway', 'Surface railway'],
                    ['cycle', 'Cycle lanes'],
                    ['bus', 'Bus lanes'],
                    ['parking', 'Parking bays'],
                    ['bridge', 'Elevated bridge'],
                    ['subway', 'Subway corridor'],
                  ]
              ).map(([id, name]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={options[id]}
                    onChange={(e) => set(id, e.target.checked)}
                  />
                  <span className="checkbox-visual">{options[id] && <Check size={10} />}</span>
                  {name}
                </label>
              ))}
            </div>
          </div>
          <div className="generator-preview-panel">
            <div className="preview-caption">
              <span className="live-dot" />
              LIVE NETWORK PREVIEW
              <Globe2 size={12} />
            </div>
            <NetworkPreview network={preview} />
            <div className="preview-stat-grid">
              <div>
                <strong>{stats.segments}</strong>
                <span>Road segments</span>
              </div>
              <div>
                <strong>{stats.junctions}</strong>
                <span>Junctions</span>
              </div>
              <div>
                <strong>
                  {(stats.length / 1000).toFixed(1)}
                  <small> km</small>
                </strong>
                <span>Network length</span>
              </div>
              <div>
                <strong>
                  {options.size / 1000}
                  <small> km</small>
                </strong>
                <span>World extent</span>
              </div>
            </div>
            <div className="generator-note">
              <Layers3 size={16} />
              <p>
                {options.layout === 'cloverleaf'
                  ? 'Four loop ramps, four exterior connectors and split, one-way mainlines. North–south passes over east–west.'
                  : 'Roads, stitched junctions, curbs, paving, and clipped lane markings. Add surface rail for automatic level crossings.'}
              </p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <span>
            <Info size={13} />
            Replaces this network. You can undo.
          </span>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={14} />}
            {busy ? 'Building your world…' : 'Generate network'}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ExportDialog({ network, onClose, onExport }) {
  const [format, setFormat] = useState('glb');
  const [coordinates, setCoordinates] = useState('standard');
  const [fixtures, setFixtures] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stats = networkStats(network);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onExport(format, coordinates, { fixtures });
      onClose();
    } catch (e) {
      setError(e.message || 'Unable to export this project.');
      setBusy(false);
    }
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} className="export-modal" label="Export road network">
      <div className="modal-header">
        <div className="modal-symbol">
          <Download size={21} />
        </div>
        <div>
          <span className="eyebrow">TAKE YOUR WORLD WITH YOU</span>
          <h2>Export road network</h2>
          <p>From first spline to your next game world.</p>
        </div>
        <button
          className="icon-button modal-close"
          aria-label="Close export"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="export-body">
        <div className="export-project">
          <div className="world-icon">
            <Globe2 size={22} />
          </div>
          <div>
            <strong>{network.name}</strong>
            <span>
              {stats.segments} segments · {stats.junctions} junctions ·{' '}
              {(stats.length / 1000).toFixed(1)} km
            </span>
          </div>
          <span className="tag">ALL ROADS</span>
        </div>
        <span className="form-label-text">File format</span>
        <div className="export-formats">
          {[
            {
              id: 'glb',
              name: 'glTF binary',
              ext: '.glb',
              desc: 'Meshes, materials & textures',
              icon: Box,
            },
            {
              id: 'obj',
              name: 'Wavefront',
              ext: '.obj',
              desc: 'Geometry & UV coordinates',
              icon: Layers3,
            },
            {
              id: 'json',
              name: 'Road project',
              ext: '.json',
              desc: 'Editable network & settings',
              icon: FileJson,
            },
          ].map((f) => (
            <button
              key={f.id}
              className={format === f.id ? 'selected' : ''}
              onClick={() => setFormat(f.id)}
              disabled={busy}
            >
              <f.icon size={20} />
              <div>
                <strong>
                  {f.name}
                  <span>{f.ext}</span>
                </strong>
                <small>{f.desc}</small>
              </div>
              <span className="radio-option">{format === f.id && <i />}</span>
            </button>
          ))}
        </div>
        {format !== 'json' && (
          <label className="form-label">
            Coordinate system
            <select
              aria-label="Export coordinate system"
              disabled={busy}
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
            >
              <option value="unreal">Unreal mesh pipeline · Z-up · centimeters</option>
              <option value="standard">Standard glTF · Y-up · meters</option>
            </select>
          </label>
        )}
        {format !== 'json' && (
          <div className="export-fixtures">
            <label>Include procedural street lights</label>
            <Toggle
              label="Include procedural street lights"
              checked={fixtures}
              onChange={setFixtures}
              disabled={busy}
            />
          </div>
        )}
        <div className="export-info">
          <Check size={15} />
          <p>
            {format === 'json'
              ? 'Complete, re-importable project. Includes every spline, road profile, regional marking preset, and placed detail.'
              : 'Includes paved roads, intersection surfaces, lane markings, street furniture, bridges, and underground tracks. Terrain and decorative trees are not included.'}
          </p>
        </div>
        {format === 'obj' && (
          <p className="format-note">
            OBJ contains geometry only; choose GLB to preserve materials and textures.
          </p>
        )}
        {error && (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <span>Local export · no upload required</span>
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" disabled={busy} onClick={submit}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={14} />}
          {busy ? 'Preparing export…' : 'Export network'}
        </button>
      </div>
    </Modal>
  );
}

export function HelpDialog({ onClose }) {
  return (
    <Modal onClose={onClose} className="help-modal" label="Road Studio shortcuts">
      <div className="modal-header">
        <div className="modal-symbol">
          <Keyboard size={23} />
        </div>
        <div>
          <span className="eyebrow">A LITTLE LESS FRICTION</span>
          <h2>Make yourself at home.</h2>
          <p>Your road-building toolkit, at a glance.</p>
        </div>
        <button className="icon-button modal-close" aria-label="Close help" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="help-body">
        <div>
          <h3>
            <Navigation size={15} />
            Navigate
          </h3>
          {[
            ['RMB + WASD', 'Unreal-style fly camera'],
            ['Q / E', 'Move down / up'],
            ['Shift', 'Boost fly speed'],
            ['Alt + drag', 'Orbit the world'],
            ['Middle drag', 'Pan the camera'],
            ['Scroll', 'Zoom in and out'],
            ['F', 'Focus the selected road'],
            ['Home', 'Frame the whole network'],
          ].map(([key, desc]) => (
            <div className="shortcut-row" key={key}>
              <span>{desc}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
        <div>
          <h3>
            <Spline size={15} />
            Create & edit
          </h3>
          {[
            ['V', 'Select a road'],
            ['R', 'Draw a new road'],
            ['Shift + finish', 'Draw a curved road'],
            ['G', 'Drag spline control points'],
            ['Esc', 'Cancel tool / stop preview'],
            ['Delete', 'Delete selected road'],
            ['Ctrl / ⌘ Z', 'Undo a change'],
            ['Ctrl / ⌘ Shift Z', 'Redo a change'],
            ['Ctrl / ⌘ S', 'Save this project'],
          ].map(([key, desc]) => (
            <div className="shortcut-row" key={key}>
              <span>{desc}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </div>
      <div className="help-note">
        <Info size={17} />
        <p>
          <strong>Experimental browser editor.</strong> Inspired by Frontier’s Project-Zero editor.
          Exports are engine-neutral assets, not a live native-engine connection. Regional markings
          are visual design profiles, not certified civil-engineering standards.
        </p>
      </div>
      <div className="modal-footer">
        <a
          href="https://github.com/SultanAladin/Frontier-/tree/main/Experimental/FrontierEditor"
          target="_blank"
          rel="noreferrer"
        >
          Frontier reference
          <ArrowUpRight size={12} />
        </a>
        <button className="primary-button" onClick={onClose}>
          Let’s build
          <ArrowRight size={14} />
        </button>
      </div>
    </Modal>
  );
}

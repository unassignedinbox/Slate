import { DRAINAGE_TYPES, isCurbAccess } from '../lib/streetscape.js';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Minus,
  MoveHorizontal,
  Route,
  Layers3,
  Check,
  ArrowUp,
  Bike,
  Footprints,
  Car,
  Bus,
  RotateCw,
  Crosshair,
  Copy,
  Trash2,
  CornerDownRight,
  SlidersHorizontal,
  Paintbrush,
} from 'lucide-react';
import {
  getRoadPreset,
  isBridge,
  BRIDGE_STYLES,
  DETAILS,
  STANDARDS,
  laneLayout,
  laneDirection,
  roadWidth,
  roadLength,
  getJunctions,
} from '../lib/network.js';
import { bridgeReport, planInfrastructure } from '../lib/infrastructure.js';
import { isRoadAttachedDetail, resolveAttachedDetail } from '../lib/placement.js';
import { RoadThumbnail, DetailThumbnail } from './Thumbnails.jsx';

export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function NumberField({
  value,
  onChange,
  unit = 'm',
  min = 0,
  max = 100,
  step = 0.1,
  label,
  disabled = false,
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelCommit = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (cancelCommit.current) {
      cancelCommit.current = false;
      setDraft(String(value));
      return;
    }
    const number = Number(draft);
    if (!Number.isFinite(number) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const result = Math.min(max, Math.max(min, Math.round(number / step) * step));
    // A parent can reject or project a requested transform. Reset to the
    // authoritative value; the next prop update supplies the accepted result.
    setDraft(String(value));
    if (Math.abs(result - value) > 0.00001) onChange(Number(result.toFixed(3)));
  };
  return (
    <div className="number-field">
      <input
        aria-label={label}
        disabled={disabled}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelCommit.current = true;
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
      />
      <span>{unit}</span>
    </div>
  );
}

function Section({ title, children, count, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section">
      <button
        className="inspector-section-title"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
        {count && <small>{count}</small>}
      </button>
      {open && <div className="inspector-section-body">{children}</div>}
    </section>
  );
}

export function LaneDiagram({ road, standard = 'us' }) {
  const bands = laneLayout(road);
  const width = roadWidth(road);
  const colors = {
    sidewalk: '#858979',
    cycle: '#668779',
    lane: '#494e4c',
    median: '#8c956e',
    parking: '#637078',
    bus: '#9b7569',
    path: '#85977e',
    rail: '#9c8aaf',
    shoulder: '#5a5f56',
  };
  return (
    <div className="lane-diagram">
      <div className="lane-width">
        <span />
        <small>{width.toFixed(1)} m total width</small>
        <span />
      </div>
      <div className="lane-bands">
        {bands.map((band, i) => (
          <div
            key={i}
            className={`lane-band ${band.kind}`}
            style={{ flex: band.width, background: colors[band.kind] }}
            title={`${band.kind} · ${band.width} m`}
          >
            {band.kind === 'lane' ? (
              <ArrowUp
                size={13}
                style={{
                  transform:
                    laneDirection(road, band.side, standard) === -1 ? 'rotate(180deg)' : undefined,
                }}
              />
            ) : band.kind === 'cycle' ? (
              <Bike size={10} />
            ) : band.kind === 'sidewalk' ? (
              <Footprints size={10} />
            ) : band.kind === 'bus' ? (
              <Bus size={11} />
            ) : band.kind === 'parking' ? (
              <span>P</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="lane-legend">
        <span>
          <i style={{ background: '#858979' }} />
          Walkway
        </span>
        <span>
          <i style={{ background: '#494e4c' }} />
          Travel
        </span>
        <span>
          <i style={{ background: '#668779' }} />
          Cycle
        </span>
      </div>
    </div>
  );
}

export default function Inspector({
  road,
  network,
  onUpdate,
  onStandardChange,
  onFocus,
  onDuplicate,
  onDelete,
  onRebuild,
  onMovePoint,
  onAddControlPoint,
}) {
  const [tab, setTab] = useState('Properties');
  const [menu, setMenu] = useState(false);
  const structure = road && (isBridge(road) || road.type === 'ramp');
  const metrics = useMemo(
    () => (structure ? bridgeReport(road, network) : null),
    [road, network, structure],
  );
  const railCrossings = useMemo(
    () =>
      road?.type === 'railway'
        ? planInfrastructure(network).crossings.filter((c) => c.rail.id === road.id).length
        : 0,
    [road, network],
  );
  if (!road)
    return (
      <aside className="inspector-panel">
        <div className="panel-heading">
          Inspector
          <SlidersHorizontal size={14} />
        </div>
        <div className="inspector-empty">
          <Crosshair size={32} />
          <h3>Nothing selected</h3>
          <p>Select a road in the viewport, or draw a new one from the library.</p>
        </div>
      </aside>
    );
  const preset = getRoadPreset(road);
  const junctions = getJunctions(network.roads).filter((j) => j.roads.includes(road.id));
  const special = ['path', 'subway', 'railway'].includes(road.type);
  const standard = STANDARDS.find((s) => s.id === network.standard) || STANDARDS[0];
  const materials = [
    {
      id: 'asphalt',
      label: 'Fine asphalt',
      color: '#585e58',
      desc: 'Dense aggregate · dry surface',
    },
    {
      id: 'concrete',
      label: 'Cast concrete',
      color: '#aaa89a',
      desc: 'Light surface · expansion joints',
    },
    {
      id: 'paving',
      label: 'Stone paving',
      color: '#8f9382',
      desc: 'Staggered blocks · shared spaces',
    },
    { id: 'gravel', label: 'Compacted gravel', color: '#978975', desc: 'Unsealed · country roads' },
    {
      id: 'timber',
      label: 'Timber decking',
      color: '#a58c65',
      desc: 'Board joints · procedural grain',
    },
  ];
  const row = (label, element, icon) => (
    <div className="property-row">
      <label>
        {icon && React.createElement(icon, { size: 13 })}
        {label}
      </label>
      {element}
    </div>
  );
  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <span>Inspector</span>
        <SlidersHorizontal size={14} />
      </div>
      <div className="inspector-object">
        <div className="inspector-object-title">
          <span className="eyebrow">
            ROAD SEGMENT <span>{String(network.roads.indexOf(road) + 1).padStart(2, '0')}</span>
          </span>
          <div className="relative">
            <button
              className="icon-button"
              aria-label="Segment actions"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menu && (
              <div className="dropdown-menu segment-menu">
                <button
                  onClick={() => {
                    onFocus();
                    setMenu(false);
                  }}
                >
                  <Crosshair size={13} />
                  Focus segment <kbd>F</kbd>
                </button>
                <button
                  onClick={() => {
                    onDuplicate();
                    setMenu(false);
                  }}
                >
                  <Copy size={13} />
                  Duplicate
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    onDelete();
                    setMenu(false);
                  }}
                >
                  <Trash2 size={13} />
                  Delete <kbd>Del</kbd>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="inspector-road-title">
          <div className="road-object-icon">
            <RoadThumbnail type={road.presetId || road.type} />
          </div>
          <div>
            <h2>{preset?.name || road.name}</h2>
            <span>{road.name}</span>
          </div>
        </div>
        <div className="object-tags">
          <span>
            <i />
            Procedural
          </span>
          <span>
            {road.lanes === 0
              ? 'Shared use'
              : `${road.lanes} ${road.type === 'railway' || road.type === 'subway' ? 'tracks' : 'travel lanes'}`}
          </span>
          <button title="Focus selected road" aria-label="Focus selected road" onClick={onFocus}>
            <Crosshair size={12} />
          </button>
        </div>
      </div>
      <div className="inspector-tabs">
        {['Properties', 'Materials'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'Properties' ? <SlidersHorizontal size={13} /> : <Paintbrush size={13} />}
            {t}
          </button>
        ))}
      </div>
      <div className="inspector-scroll" key={road.id}>
        {tab === 'Properties' ? (
          <>
            <Section title="Geometry">
              <div className="geometry-summary">
                <div>
                  <MoveHorizontal size={14} />
                  <strong>
                    {roadWidth(road).toFixed(1)}
                    <small>m</small>
                  </strong>
                  <span>Total width</span>
                </div>
                <div>
                  <Route size={14} />
                  <strong>
                    {roadLength(road).toFixed(1)}
                    <small>m</small>
                  </strong>
                  <span>Segment length</span>
                </div>
              </div>
              {row(
                road.type === 'railway' ? 'Tracks' : 'Travel lanes',
                <div className="stepper">
                  <button
                    aria-label={road.type === 'railway' ? 'Remove track' : 'Remove travel lane'}
                    disabled={(special && road.type !== 'railway') || road.lanes <= 1}
                    onClick={() => onUpdate({ lanes: road.lanes - 1 })}
                  >
                    <Minus size={12} />
                  </button>
                  <span>{road.lanes}</span>
                  <button
                    aria-label={road.type === 'railway' ? 'Add track' : 'Add travel lane'}
                    disabled={
                      road.lanes >= (road.type === 'railway' ? 4 : 12) ||
                      road.type === 'path' ||
                      road.type === 'subway'
                    }
                    onClick={() => onUpdate({ lanes: road.lanes + 1 })}
                  >
                    <Plus size={12} />
                  </button>
                </div>,
              )}
              {row(
                road.type === 'railway'
                  ? 'Track spacing'
                  : road.type === 'path'
                    ? 'Path width'
                    : 'Lane width',
                <NumberField
                  label={
                    road.type === 'railway'
                      ? 'Track spacing'
                      : road.type === 'path'
                        ? 'Path width'
                        : 'Lane width'
                  }
                  value={road.laneWidth}
                  onChange={(v) => onUpdate({ laneWidth: v })}
                  min={road.type === 'path' ? 1.2 : 2.4}
                  max={road.type === 'path' ? 6 : 5}
                  step={0.05}
                />,
              )}
              {!special &&
                row(
                  'Median width',
                  <NumberField
                    label="Median width"
                    value={road.median}
                    onChange={(v) => onUpdate({ median: v })}
                    max={8}
                  />,
                )}
              {row(
                road.interchangeId ? 'Interchange height' : 'Elevation',
                <NumberField
                  label="Road elevation"
                  value={road.interchangeId ? road.interchangeHeight : road.elevation || 0}
                  onChange={(v) => onUpdate({ elevation: v })}
                  min={road.interchangeId ? 6 : -20}
                  max={road.interchangeId ? 20 : 40}
                  step={0.5}
                />,
              )}
            </Section>
            {road.type === 'railway' && (
              <Section title="Railway infrastructure">
                {row(
                  'Track gauge',
                  <NumberField
                    label="Track gauge"
                    value={road.gauge || 1.435}
                    min={1}
                    max={1.7}
                    step={0.001}
                    onChange={(gauge) => onUpdate({ gauge })}
                  />,
                )}
                {row(
                  'Automatic crossings',
                  <Toggle
                    label="Automatic level crossings"
                    checked={road.crossings !== false}
                    onChange={(crossings) => onUpdate({ crossings })}
                  />,
                )}
                {row(
                  'Crossing signals',
                  <Toggle
                    label="Crossing signals and barriers"
                    checked={road.barriers !== false}
                    onChange={(barriers) => onUpdate({ barriers })}
                  />,
                )}
                <p className="section-description">
                  {railCrossings} at-grade road crossing{railCrossings === 1 ? '' : 's'} · rails
                  stay continuous. Overpasses do not connect to the tracks.
                </p>
              </Section>
            )}
            {structure && (
              <Section title="Bridge structure">
                {isBridge(road) && !road.interchangeId && (
                  <>
                    <label className="select-label">
                      Structure family
                      <select
                        aria-label="Bridge structure family"
                        value={road.bridgeStyle || 'beam'}
                        onChange={(e) => {
                          const bridgeStyle = e.target.value,
                            minimum = ['truss', 'covered'].includes(bridgeStyle)
                              ? 6.5
                              : bridgeStyle === 'footbridge'
                                ? 2.8
                                : 2;
                          onUpdate({
                            bridgeStyle,
                            bridgeRise: Math.max(
                              minimum,
                              road.bridgeRise ||
                                (bridgeStyle === 'arch'
                                  ? 12
                                  : bridgeStyle === 'footbridge'
                                    ? 3.5
                                    : 7.5),
                            ),
                            bridgeTowerHeight: road.bridgeTowerHeight || 18,
                          });
                        }}
                      >
                        {BRIDGE_STYLES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {row(
                      'Pier spacing',
                      <NumberField
                        label="Bridge pier spacing"
                        value={road.bridgeSupportSpacing || 32}
                        min={16}
                        max={120}
                        step={4}
                        onChange={(bridgeSupportSpacing) => onUpdate({ bridgeSupportSpacing })}
                      />,
                    )}
                    {BRIDGE_STYLES.find((s) => s.id === road.bridgeStyle)?.rise &&
                      row(
                        'Structural rise',
                        <NumberField
                          label="Bridge structural rise"
                          value={road.bridgeRise || 7.5}
                          min={
                            ['truss', 'covered'].includes(road.bridgeStyle)
                              ? 6.5
                              : road.bridgeStyle === 'footbridge'
                                ? 2.8
                                : 2
                          }
                          max={30}
                          step={0.5}
                          onChange={(bridgeRise) => onUpdate({ bridgeRise })}
                        />,
                      )}
                    {BRIDGE_STYLES.find((s) => s.id === road.bridgeStyle)?.towers &&
                      row(
                        'Tower height',
                        <NumberField
                          label="Bridge tower height"
                          value={road.bridgeTowerHeight || 18}
                          min={8}
                          max={40}
                          step={0.5}
                          onChange={(bridgeTowerHeight) => onUpdate({ bridgeTowerHeight })}
                        />,
                      )}
                  </>
                )}
                {row(
                  'Deck thickness',
                  <NumberField
                    label="Deck thickness"
                    value={road.deckThickness || 0.8}
                    min={0.25}
                    max={2}
                    step={0.05}
                    onChange={(deckThickness) => onUpdate({ deckThickness })}
                  />,
                )}
                <div className="structure-stats">
                  <span>
                    Crossing clearance
                    <strong>
                      {metrics.clearance === null
                        ? 'No lower crossing'
                        : `${metrics.clearance.toFixed(1)} m`}
                    </strong>
                  </span>
                  <span>
                    Peak road grade<strong>{metrics.maxGrade.toFixed(1)}%</strong>
                  </span>
                </div>
                {((metrics.clearance !== null && metrics.clearance < 5.5) ||
                  metrics.maxGrade > 8) && (
                  <p className="structure-warning">
                    Check approach length and elevation. Target ≥ 5.5 m clearance and gentle grades;
                    this is not an engineering certification.
                  </p>
                )}
                <p className="section-description">
                  Piers avoid lower road and railway corridors. Structure families build real ribs,
                  girders, trusses, cables or roof meshes; not only a different name.
                  {road.interchangeId ? ' Height updates the entire connected interchange.' : ''}
                </p>
              </Section>
            )}
            {road.type !== 'railway' && (
              <Section title="Lane configuration">
                <LaneDiagram road={road} standard={network.standard} />
                {row(
                  'One-way traffic',
                  <Toggle
                    label="One-way traffic"
                    disabled={special || road.type === 'roundabout'}
                    checked={road.oneWay || road.type === 'roundabout'}
                    onChange={(oneWay) => onUpdate({ oneWay })}
                  />,
                )}
                {row(
                  'Dedicated bus lanes',
                  <Toggle
                    label="Dedicated bus lanes"
                    disabled={special}
                    checked={road.bus}
                    onChange={(v) => onUpdate({ bus: v })}
                  />,
                  Bus,
                )}
                {row(
                  'Protected cycle lanes',
                  <Toggle
                    label="Protected cycle lanes"
                    disabled={special}
                    checked={road.cycle}
                    onChange={(v) => onUpdate({ cycle: v })}
                  />,
                  Bike,
                )}
                {row(
                  'On-street parking',
                  <Toggle
                    label="On-street parking"
                    disabled={special}
                    checked={road.parking}
                    onChange={(v) => onUpdate({ parking: v })}
                  />,
                  Car,
                )}
              </Section>
            )}
            {road.type !== 'railway' && (
              <Section title="Roadside details">
                {row(
                  'Paved sidewalks',
                  <Toggle
                    label="Paved sidewalks"
                    checked={road.sidewalk > 0}
                    onChange={(v) => onUpdate({ sidewalk: v ? 2.4 : 0 })}
                  />,
                )}
                {road.sidewalk > 0 &&
                  row(
                    'Sidewalk width',
                    <NumberField
                      label="Sidewalk width"
                      value={road.sidewalk}
                      onChange={(v) => onUpdate({ sidewalk: v })}
                      min={0.5}
                      max={6}
                    />,
                  )}
                {row(
                  'Raised curbs',
                  <Toggle
                    label="Raised curbs"
                    checked={road.curbs}
                    onChange={(v) => onUpdate({ curbs: v })}
                  />,
                )}
                {road.sidewalk > 0 && (
                  <>
                    <label className="select-label">
                      Curb drainage
                      <select
                        aria-label="Curb drainage"
                        disabled={!road.curbs}
                        value={road.drainage || 'none'}
                        onChange={(e) => onUpdate({ drainage: e.target.value })}
                      >
                        {DRAINAGE_TYPES.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {['grate', 'inlet', 'combined'].includes(road.drainage) &&
                      row(
                        'Drain spacing',
                        <NumberField
                          label="Drain spacing"
                          value={road.drainSpacing || 30}
                          min={8}
                          max={100}
                          step={1}
                          onChange={(drainSpacing) => onUpdate({ drainSpacing })}
                        />,
                      )}
                    {row(
                      'Crosswalk curb ramps',
                      <Toggle
                        label="Crosswalk curb ramps"
                        checked={road.crosswalkRamps !== false}
                        onChange={(crosswalkRamps) => onUpdate({ crosswalkRamps })}
                      />,
                    )}
                    <p className="section-description">
                      {road.curbs
                        ? 'Drain hardware avoids junctions, rail decks and curb ramps.'
                        : 'Enable raised curbs to add drainage.'}{' '}
                      Crosswalk drops line up with generated and placed zebras. Place custom ramps
                      in Street details.
                    </p>
                  </>
                )}
                {row(
                  'Street lighting',
                  <Toggle
                    label="Street lighting"
                    checked={road.lights}
                    onChange={(v) => onUpdate({ lights: v })}
                  />,
                )}
              </Section>
            )}
            <Section title="Markings & traffic">
              {row(
                'Road markings',
                <Toggle
                  label="Road markings"
                  disabled={road.type === 'railway'}
                  checked={road.markings}
                  onChange={(v) => onUpdate({ markings: v })}
                />,
              )}
              <label className="select-label">
                Regional profile
                <select
                  aria-label="Regional marking profile"
                  value={network.standard}
                  onChange={(e) => onStandardChange(e.target.value)}
                >
                  {STANDARDS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="profile-caption">
                <span>{standard.code}</span>
                <span>
                  {standard.drivingSide === 'right' ? 'RHT' : 'LHT'}
                  <CornerDownRight size={11} />
                </span>
              </div>
              {row(
                'Design speed',
                <NumberField
                  label="Design speed"
                  unit="km/h"
                  value={road.speed}
                  onChange={(v) => onUpdate({ speed: v })}
                  min={10}
                  max={160}
                  step={5}
                />,
              )}
            </Section>
            <Section title="Spline control points" count={road.points.length} defaultOpen={false}>
              <p className="section-description">
                Shared endpoints move their connected roads together.
              </p>
              {road.points.map((p, i) => (
                <div className="control-point" key={i}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <NumberField
                    label={`Point ${i + 1} X`}
                    value={Number(p.x.toFixed(1))}
                    min={-10000}
                    max={10000}
                    unit="X"
                    onChange={(x) => onMovePoint(road.id, i, { x })}
                  />
                  <NumberField
                    label={`Point ${i + 1} Y`}
                    value={Number(p.z.toFixed(1))}
                    min={-10000}
                    max={10000}
                    unit="Y"
                    onChange={(z) => onMovePoint(road.id, i, { z })}
                  />
                </div>
              ))}
              <button className="text-button" onClick={onAddControlPoint}>
                <Plus size={12} />
                Add midpoint handle
              </button>
            </Section>
          </>
        ) : (
          <>
            <Section title="Road surface">
              <p className="section-description">
                Procedural surface materials are embedded in GLB exports.
              </p>
              <div className="material-options">
                {materials.map((m) => (
                  <button
                    key={m.id}
                    className={road.material === m.id ? 'selected' : ''}
                    onClick={() => onUpdate({ material: m.id })}
                  >
                    <i className={`material-swatch ${m.id}`} style={{ backgroundColor: m.color }} />
                    <div>
                      <strong>{m.label}</strong>
                      <span>{m.desc}</span>
                    </div>
                    {road.material === m.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            </Section>
            <Section title="Paving & paint">
              <div className="material-channel">
                <i style={{ background: '#aaa99a' }} />
                <div>
                  <strong>Concrete paving</strong>
                  <span>Sidewalks and curb returns</span>
                </div>
                <span className="channel-tag">PBR</span>
              </div>
              <div className="material-channel">
                <i style={{ background: '#e2dfc4' }} />
                <div>
                  <strong>Thermoplastic paint</strong>
                  <span>Regional lane markings</span>
                </div>
                <span className="channel-tag">PBR</span>
              </div>
            </Section>
            <div className="material-note">
              <Layers3 size={17} />
              <p>
                Indexed ribbons, UV coordinates, and material groups are generated at real-world
                scale.
              </p>
            </div>
          </>
        )}
      </div>
      <div className="inspector-footer">
        <div>
          <span className="live-dot" />
          <span>
            {junctions.length
              ? `${junctions.length} connected junction${junctions.length > 1 ? 's' : ''}`
              : 'Standalone segment'}
          </span>
          <span className="muted">Live mesh</span>
        </div>
        <button className="rebuild-button" onClick={onRebuild}>
          <RotateCw size={13} />
          Rebuild segment
          <ChevronRight size={13} />
        </button>
      </div>
    </aside>
  );
}

export function DetailInspector({ prop, network, onUpdate, onFocus, onDuplicate, onDelete }) {
  const [menu, setMenu] = useState(false);
  const detail = DETAILS.find((d) => d.id === prop.type);
  const attached = isRoadAttachedDetail(prop) && !!prop.roadId;
  const curbAccess = isCurbAccess(prop);
  const resolved = useMemo(
    () => (attached ? resolveAttachedDetail(network, prop) : null),
    [attached, network, prop],
  );
  const attachedRoad = network.roads.find((r) => r.id === prop.roadId);
  const row = (label, field) => (
    <div className="property-row">
      <label>{label}</label>
      {field}
    </div>
  );
  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <span>Inspector</span>
        <SlidersHorizontal size={14} />
      </div>
      <div className="inspector-object">
        <div className="inspector-object-title">
          <span className="eyebrow">
            STREET DETAIL <span>{String(network.props.indexOf(prop) + 1).padStart(2, '0')}</span>
          </span>
          <div className="relative">
            <button
              className="icon-button"
              aria-label="Detail actions"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menu && (
              <div className="dropdown-menu segment-menu">
                <button
                  onClick={() => {
                    onFocus();
                    setMenu(false);
                  }}
                >
                  <Crosshair size={13} />
                  Focus detail<kbd>F</kbd>
                </button>
                <button
                  onClick={() => {
                    onDuplicate();
                    setMenu(false);
                  }}
                >
                  <Copy size={13} />
                  Duplicate
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    onDelete();
                    setMenu(false);
                  }}
                >
                  <Trash2 size={13} />
                  Delete<kbd>Del</kbd>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="inspector-road-title">
          <div className="road-object-icon detail-object-icon">
            <DetailThumbnail type={prop.type} />
          </div>
          <div>
            <h2>{detail?.name}</h2>
            <span>{detail?.category} · placed asset</span>
          </div>
        </div>
        <div className="object-tags">
          <span>
            <i />
            {attached ? 'Surface attached' : 'World-space asset'}
          </span>
          <span>Editable</span>
          <button aria-label="Focus selected detail" onClick={onFocus}>
            <Crosshair size={12} />
          </button>
        </div>
      </div>
      <div className="inspector-tabs">
        <button className="active">
          <SlidersHorizontal size={13} />
          Properties
        </button>
      </div>
      <div className="inspector-scroll">
        <Section title="Transform">
          <div className="detail-inspector-preview">
            <DetailThumbnail type={prop.type} />
          </div>
          <p className="section-description">
            Place in the viewport, then fine-tune at real-world scale. Press G to drag the asset.
          </p>
          {attached && (
            <div className={`detail-attachment-status ${resolved ? '' : 'warning'}`} role="status">
              <Route size={13} />
              <div>
                <strong>
                  {resolved
                    ? attachedRoad.name
                    : attachedRoad?.hidden
                      ? 'Attached road is hidden'
                      : attachedRoad
                        ? curbAccess
                          ? 'No clear sidewalk span'
                          : 'No clear marking span'
                        : 'Attached road was deleted'}
                </strong>
                <span>
                  {resolved
                    ? 'Follows road shape and elevation. Drag onto another road to reattach.'
                    : 'Attached detail is not rendered. Undo the road change, or drag onto a clear road.'}
                </span>
              </div>
            </div>
          )}
          {row(
            'Position X',
            <NumberField
              label="Detail position X"
              value={Number(prop.x.toFixed(2))}
              min={-10000}
              max={10000}
              step={0.1}
              onChange={(x) => onUpdate({ x })}
            />,
          )}
          {row(
            'Position Y',
            <NumberField
              label="Detail position Y"
              value={Number(prop.z.toFixed(2))}
              min={-10000}
              max={10000}
              step={0.1}
              onChange={(z) => onUpdate({ z })}
            />,
          )}
          {row(
            'Elevation',
            <NumberField
              label="Detail elevation"
              value={Number((resolved?.prop.y ?? prop.y ?? 0).toFixed(3))}
              min={-20}
              max={80}
              step={0.1}
              disabled={attached}
              onChange={(y) => onUpdate({ y })}
            />,
          )}
          {attached &&
            !curbAccess &&
            row(
              'Surface lift',
              <NumberField
                label="Detail surface lift"
                value={prop.roadAnchor?.lift || 0}
                min={0}
                max={0.03}
                step={0.001}
                onChange={(surfaceLift) => onUpdate({ surfaceLift })}
              />,
            )}
          {row(
            'Rotation',
            <NumberField
              label="Detail rotation"
              disabled={curbAccess || (prop.type === 'crosswalk' && attached)}
              unit="°"
              value={Number((((prop.rotation || 0) * 180) / Math.PI).toFixed(1))}
              min={-360}
              max={360}
              step={1}
              onChange={(v) => onUpdate({ rotation: (v * Math.PI) / 180 })}
            />,
          )}
          {['crosswalk', 'bump', 'rail', 'driveway', 'curbRamp'].includes(prop.type) &&
            row(
              'Asset width',
              <NumberField
                label="Detail width"
                value={prop.width || 7}
                min={curbAccess || (prop.type === 'crosswalk' && attached) ? 1.2 : 2}
                max={
                  curbAccess
                    ? 12
                    : prop.type === 'crosswalk' && resolved
                      ? resolved.width + 0.01
                      : 80
                }
                onChange={(width) => onUpdate({ width })}
              />,
            )}
        </Section>
        {curbAccess && (
          <Section title="Curb access">
            <label className="select-label">
              Curb side
              <select
                aria-label="Curb side"
                value={prop.curbAnchor?.side || 1}
                onChange={(e) => onUpdate({ curbSide: Number(e.target.value) })}
              >
                <option value="-1">Left of road direction</option>
                <option value="1">Right of road direction</option>
              </select>
            </label>
            {row(
              'Ramp run',
              <NumberField
                label="Ramp run"
                value={prop.rampDepth || 2.4}
                min={0.5}
                max={attachedRoad?.sidewalk || 6}
                step={0.1}
                onChange={(rampDepth) => onUpdate({ rampDepth })}
              />,
            )}
            <p className="section-description">
              Width follows the road; run extends across the sidewalk. The paving and curb are
              lowered together, not covered by a block.{' '}
              {prop.type === 'driveway'
                ? 'Includes a 5 m vehicle access apron.'
                : 'Includes a tactile warning pad.'}
            </p>
          </Section>
        )}
        <Section title="About this asset">
          <p className="section-description">
            {curbAccess
              ? 'Road-attached dropped curb. Position, side, width and ramp run are editable; moving or splitting the road carries the ramp with it. Included in JSON, GLB and OBJ exports.'
              : prop.type === 'crosswalk' && attached
                ? 'Surface-projected zebra paint. Width is limited to the carriageway; rotation stays transverse to the road so stripes never spill onto the paving.'
                : prop.type === 'arrow' && attached
                  ? 'Surface-projected lane arrow. Position and heading follow the road; full symbols stay outside junction and rail-crossing buffers.'
                  : prop.type === 'rail'
                    ? 'Twin rail track, sleepers, and red-white safety barriers. Position across the road at a safe angle.'
                    : prop.type === 'bump'
                      ? 'Raised rubber speed hump with high-visibility yellow stripes. Width follows the selected road when placed.'
                      : prop.type === 'subway'
                        ? 'A surface metro entrance with recessed stairs, guardrails, and a station sign. Underground tracks are a separate road layer.'
                        : prop.type === 'busStop'
                          ? 'A roadside shelter with a glazed windscreen, bench, and covered roof. Place alongside a dedicated bus lane.'
                          : 'Procedural geometry with assigned materials. Included in mesh and editable-project exports.'}
          </p>
        </Section>
      </div>
      <div className="inspector-footer">
        <div>
          <span className="live-dot" />
          <span>Placed detail</span>
          <span className="muted">{detail?.category}</span>
        </div>
        <button className="rebuild-button" onClick={onFocus}>
          <Crosshair size={13} />
          Focus asset
          <ChevronRight size={13} />
        </button>
      </div>
    </aside>
  );
}

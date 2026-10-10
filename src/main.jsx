import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Atom,
  BadgeInfo,
  BatteryCharging,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Cpu,
  Download,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Grid3X3,
  Info,
  Layers3,
  LockKeyhole,
  Maximize2,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Power,
  Radio,
  RefreshCcw,
  Rotate3D,
  Scan,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Thermometer,
  TriangleAlert,
  Undo2,
  Waves,
  X,
  Zap
} from "lucide-react";
import ReactorViewport from "./ReactorViewport";
import {
  DEFAULT_INPUTS,
  MATERIAL_LIBRARY,
  MODEL_NOTES,
  MODEL_VERSION,
  NOMINAL_THERMAL_KW,
  createReactorSimulation,
  formatMetric,
  materialSet
} from "./simulation";
import "./styles.css";

const SEED = 4317;

const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const secs = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function IconButton({ label, children, active = false, danger = false, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${danger ? "danger" : ""} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusDot({ tone = "ok" }) {
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}

function SectionLabel({ children, action }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {action}
    </div>
  );
}

function MetricTile({ label, value, unit, tone = "neutral", detail }) {
  return (
    <div className={`metric-tile ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      {detail && <div className="metric-detail">{detail}</div>}
    </div>
  );
}

function ProgressBar({ value, tone = "blue" }) {
  return (
    <div className={`progress-track ${tone}`}>
      <span style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
    </div>
  );
}

function RangeControl({ label, value, min, max, step, unit, onChange, warning = false, caption }) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className={`range-control ${warning ? "warning" : ""}`}>
      <div className="range-heading">
        <label>{label}</label>
        <span className="range-value">{formatMetric(value, step < 0.1 ? 2 : 0)} <em>{unit}</em></span>
      </div>
      <div className="range-line">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ "--range-fill": `${percent}%` }}
          aria-label={label}
        />
      </div>
      {caption && <div className="range-caption">{caption}</div>}
    </div>
  );
}

function TelemetryChart({ history, metric, setMetric }) {
  const chartMetrics = {
    power: { label: "Electric", unit: "kW", color: "#6b75ff", get: (item) => item.powerElectric },
    temp: { label: "Core temp", unit: "°C", color: "#f4ad56", get: (item) => item.temperatureObserved },
    dose: { label: "Dose", unit: "µSv/h", color: "#72d8ae", get: (item) => item.doseObserved }
  };
  const current = chartMetrics[metric];
  const values = history.map(current.get);
  const finite = values.filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const spread = Math.max(0.05, max - min);
  const low = min - spread * 0.12;
  const high = max + spread * 0.12;
  const points = values
    .map((value, index) => {
      const x = history.length <= 1 ? 0 : (index / (history.length - 1)) * 300;
      const y = 80 - ((value - low) / Math.max(0.001, high - low)) * 64;
      return `${x.toFixed(2)},${clamp(y, 4, 84).toFixed(2)}`;
    })
    .join(" ");
  const area = `${points} 300,86 0,86`;

  return (
    <div className="telemetry-block">
      <div className="telemetry-tabs">
        {Object.entries(chartMetrics).map(([id, item]) => (
          <button key={id} type="button" className={metric === id ? "selected" : ""} onClick={() => setMetric(id)}>
            <span className="telemetry-key" style={{ background: item.color }} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="chart-wrap">
        <svg viewBox="0 0 300 92" preserveAspectRatio="none" role="img" aria-label={`${current.label} over simulation time`}>
          <defs>
            <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={current.color} stopOpacity=".24" />
              <stop offset="1" stopColor={current.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[18, 42, 66].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} className="chart-grid" />)}
          <polygon points={area} fill="url(#chart-fill)" />
          <polyline points={points} fill="none" stroke={current.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div className="chart-range">
          <span>{formatMetric(low, current.unit === "°C" ? 0 : 2)} {current.unit}</span>
          <span>{formatMetric(high, current.unit === "°C" ? 0 : 2)} {current.unit}</span>
        </div>
      </div>
    </div>
  );
}

function TreeRow({ icon, label, meta, active, onClick, indent = 0, badge }) {
  return (
    <button type="button" className={`tree-row ${active ? "selected" : ""}`} style={{ paddingLeft: `${12 + indent * 18}px` }} onClick={onClick}>
      <ChevronRight size={12} className="tree-chevron" />
      <span className="tree-icon">{icon}</span>
      <span className="tree-copy"><strong>{label}</strong>{meta && <small>{meta}</small>}</span>
      {badge && <span className="tree-badge">{badge}</span>}
    </button>
  );
}

function Outliner({ selectedNode, setSelectedNode, snapshot, onFocus }) {
  return (
    <div className="outliner-block">
      <SectionLabel action={<IconButton label="Outliner options"><MoreHorizontal size={15} /></IconButton>}>SCENE COLLECTION</SectionLabel>
      <div className="scene-root">
        <div className="root-line"><span className="root-mark">⌄</span><span>CAN-SCALE / TEST CELL</span><span className="root-count">5</span></div>
        <TreeRow icon={<Atom size={15} />} label="CAN-01 Reactor" meta="Assembly · active" active={selectedNode === "reactor"} onClick={() => { setSelectedNode("reactor"); onFocus(); }} badge="LIVE" />
        <TreeRow icon={<Flame size={14} />} label="Core module" meta="17 fuel elements" active={selectedNode === "core"} onClick={() => setSelectedNode("core")} indent={1} />
        <TreeRow icon={<Waves size={14} />} label="Coolant loop" meta={`${snapshot.material.coolant.short} · recirculating`} active={selectedNode === "coolant"} onClick={() => setSelectedNode("coolant")} indent={1} />
        <TreeRow icon={<Layers3 size={14} />} label="Shield stack" meta={`${snapshot.material.shield.short} · 3.6 cm`} active={selectedNode === "shield"} onClick={() => setSelectedNode("shield")} indent={1} />
        <TreeRow icon={<ShieldCheck size={14} />} label="Safety interlocks" meta="5 / 5 armed" active={selectedNode === "safety"} onClick={() => setSelectedNode("safety")} indent={1} />
      </div>
    </div>
  );
}

function EventList({ events }) {
  return (
    <div className="event-list">
      {events.slice(0, 4).map((event) => (
        <div className="event-row" key={event.id}>
          <span className={`event-marker ${event.tone}`} />
          <div><strong>{event.message}</strong><small>{event.time}</small></div>
        </div>
      ))}
    </div>
  );
}

function LeftDock({ snapshot, history, metric, setMetric, selectedNode, setSelectedNode, events, onFocus }) {
  return (
    <aside className="dock left-dock">
      <div className="dock-titlebar">
        <div className="dock-heading"><span className="dock-icon purple"><Menu size={15} /></span><div><strong>Outliner</strong><small>Reactor hierarchy</small></div></div>
        <IconButton label="Collapse outliner"><ChevronRight size={15} /></IconButton>
      </div>
      <div className="dock-scroll">
        <Outliner selectedNode={selectedNode} setSelectedNode={setSelectedNode} snapshot={snapshot} onFocus={onFocus} />
        <div className="dock-divider" />
        <div className="telemetry-panel">
          <SectionLabel action={<span className="live-label"><StatusDot />LIVE</span>}>TELEMETRY</SectionLabel>
          <div className="telemetry-head"><strong>{formatMetric(snapshot[metric === "power" ? "powerElectric" : metric === "temp" ? "temperatureObserved" : "doseObserved"], metric === "temp" ? 0 : 2)}</strong><span>{metric === "power" ? "kW electric" : metric === "temp" ? "°C core" : "µSv/h outside"}</span></div>
          <TelemetryChart history={history} metric={metric} setMetric={setMetric} />
        </div>
        <div className="dock-divider" />
        <div className="events-panel">
          <SectionLabel action={<button type="button" className="text-button">View log</button>}>EVENT STREAM</SectionLabel>
          <EventList events={events} />
        </div>
      </div>
      <div className="dock-footer"><span className="footer-status"><StatusDot />Engine connected</span><span className="footer-shortcut">⌘ K</span></div>
    </aside>
  );
}

function MaterialSelect({ group, selected, onChange }) {
  const items = MATERIAL_LIBRARY[group];
  return (
    <label className="material-row">
      <span className="material-swatch" style={{ background: selected.color, boxShadow: `0 0 0 3px ${selected.color}18` }} />
      <span className="material-copy"><small>{group.toUpperCase()}</small><strong>{selected.label}</strong><em>{selected.short} · {selected.note}</em></span>
      <span className="material-select-wrap"><select value={selected.id} onChange={(event) => onChange(event.target.value)} aria-label={`Select ${group} material`}>
        {Object.values(items).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select><ChevronDown size={13} /></span>
    </label>
  );
}

function InspectorPanel({ snapshot, inputs, setInputs, materials, setMaterials, setActivePanel, onScram, onInert, onReset }) {
  const hotLimit = Math.min(snapshot.material.fuel.maxTemp, snapshot.material.cladding.maxTemp);
  const headroom = clamp((hotLimit - snapshot.temperatureObserved) / Math.max(1, hotLimit - 400), 0, 1);
  return (
    <div className="inspector-content">
      <div className="inspector-identity">
        <div className="identity-icon"><Atom size={19} /></div>
        <div><div className="eyebrow">INSPECTOR / CORE MODULE</div><h2>Core assembly</h2><p>CAN-01 · can-scale test cell</p></div>
        <IconButton label="Inspector menu"><MoreHorizontal size={16} /></IconButton>
      </div>
      <div className="state-banner">
        <div className="state-left"><StatusDot tone={snapshot.state === "RUNNING" ? "ok" : snapshot.state === "CAUTION" ? "warn" : "danger"} /><div><strong>{snapshot.state}</strong><small>{snapshot.tripReason || "Closed-loop power state"}</small></div></div>
        <span className="state-code">{snapshot.state === "RUNNING" ? "K-01" : "SAFE"}</span>
      </div>
      <div className="inspector-scroll">
        <SectionLabel>LIVE READBACK</SectionLabel>
        <div className="inspector-metrics">
          <MetricTile label="ELECTRIC OUT" value={formatMetric(snapshot.powerElectric, 2)} unit="kW" tone="blue" detail={`${formatMetric(snapshot.powerThermal, 2)} kW thermal`} />
          <MetricTile label="CORE TEMP" value={formatMetric(snapshot.temperatureObserved, 0)} unit="°C" tone={snapshot.temperatureObserved > hotLimit - 50 ? "orange" : "orange"} detail={`limit ${hotLimit}°C`} />
          <MetricTile label="INTEGRITY" value={formatMetric(snapshot.integrity * 100, 1)} unit="%" tone={snapshot.integrity < 0.7 ? "red" : "green"} detail="containment margin" />
          <MetricTile label="OUTSIDE DOSE" value={formatMetric(snapshot.doseObserved, 2)} unit="µSv/h" tone={snapshot.doseObserved > 1 ? "red" : "green"} detail="shielded readback" />
        </div>
        <div className="property-card control-card">
          <div className="card-heading"><div><strong>Operating controls</strong><small>Browser-local test parameters</small></div><SlidersHorizontal size={15} /></div>
          <RangeControl label="Control position" value={inputs.control} min={0} max={1} step={0.01} unit="%" onChange={(value) => setInputs((current) => ({ ...current, control: value }))} caption="Higher position raises model reactivity; no plant setpoint." />
          <RangeControl label="Coolant flow" value={inputs.flow} min={0} max={1} step={0.01} unit="×" onChange={(value) => setInputs((current) => ({ ...current, flow: value }))} warning={inputs.flow < 0.35} caption={`${formatMetric(snapshot.flowObserved * 100, 0)}% observed · ±${formatMetric(inputs.sensorNoise * 100, 1)}% sensor noise`} />
          <RangeControl label="Vibration environment" value={inputs.vibration} min={0} max={1} step={0.01} unit="g" onChange={(value) => setInputs((current) => ({ ...current, vibration: value }))} warning={inputs.vibration > snapshot.material.cladding.vibrationLimit * 0.78} caption={`${formatMetric(snapshot.vibrationObserved, 2)} g observed · mount limit ${formatMetric(snapshot.material.cladding.vibrationLimit, 2)} g`} />
        </div>
        <div className="property-card headroom-card">
          <div className="card-heading"><div><strong>Thermal headroom</strong><small>Hot-side material envelope</small></div><Thermometer size={15} /></div>
          <div className="headroom-value"><strong>{formatMetric(Math.max(0, hotLimit - snapshot.temperatureObserved), 0)}°</strong><span>remaining</span></div>
          <ProgressBar value={headroom} tone={headroom < 0.25 ? "red" : headroom < 0.5 ? "orange" : "blue"} />
          <div className="headroom-foot"><span>0°C</span><span>{hotLimit}°C limit</span></div>
        </div>
        <div className="property-card selected-material-card">
          <div className="card-heading"><div><strong>Module materials</strong><small>Four swappable interfaces</small></div><button type="button" className="text-button" onClick={() => setActivePanel("materials")}>Edit all <ChevronRight size={12} /></button></div>
          <div className="mini-material-list">
            {Object.entries(materials).map(([group, material]) => <div className="mini-material" key={group}><span className="mini-dot" style={{ background: material.color }} /><span>{material.short}</span><small>{group}</small></div>)}
          </div>
        </div>
      </div>
      <div className="inspector-actions"><button type="button" className="button danger-outline" onClick={onScram}><ShieldAlert size={14} /> Initiate SCRAM</button><button type="button" className="button ghost" onClick={onReset}><RefreshCcw size={14} /> Reset run</button><button type="button" className="kill-button" onClick={onInert} title="Render the simulated core inert and isolate it"><Power size={14} /> Inert core</button></div>
    </div>
  );
}

function MaterialsPanel({ materials, setMaterials, snapshot }) {
  const setMaterial = (group, id) => setMaterials((current) => ({ ...current, [group]: MATERIAL_LIBRARY[group][id] }));
  return (
    <div className="inspector-content">
      <div className="inspector-identity">
        <div className="identity-icon cyan"><Layers3 size={19} /></div>
        <div><div className="eyebrow">INSPECTOR / MATERIALS</div><h2>Material stack</h2><p>Swap one module at a time</p></div>
        <IconButton label="Material menu"><MoreHorizontal size={16} /></IconButton>
      </div>
      <div className="material-callout"><Sparkles size={16} /><p>Compare thermal margin, flow response, vibration sensitivity, and shield dose without changing the geometry.</p></div>
      <div className="inspector-scroll materials-scroll">
        <SectionLabel>ACTIVE MODULES <span className="section-meta">{Object.keys(materials).length} / 4 configured</span></SectionLabel>
        <div className="material-stack">
          {Object.entries(materials).map(([group, material]) => <MaterialSelect key={group} group={group} selected={material} onChange={(id) => setMaterial(group, id)} />)}
        </div>
        <div className="property-card comparison-card">
          <div className="card-heading"><div><strong>Current stack</strong><small>Material response summary</small></div><Activity size={15} /></div>
          <div className="comparison-row"><span>Power factor</span><strong>{formatMetric(snapshot.material.fuel.powerFactor * 100, 0)}%</strong><ProgressBar value={snapshot.material.fuel.powerFactor / 1.1} tone="purple" /></div>
          <div className="comparison-row"><span>Heat transfer</span><strong>{formatMetric(snapshot.material.coolant.heatTransfer * 1000, 1)}</strong><ProgressBar value={snapshot.material.coolant.heatTransfer / 0.022} tone="cyan" /></div>
          <div className="comparison-row"><span>Shield attenuation</span><strong>{formatMetric(snapshot.shieldMargin, 3)}</strong><ProgressBar value={snapshot.shieldMargin / 0.2} tone="green" /></div>
          <div className="comparison-row"><span>Stack mass</span><strong>{formatMetric(snapshot.material.shield.mass, 1)} kg</strong><ProgressBar value={snapshot.material.shield.mass / 8.4} tone="orange" /></div>
        </div>
        <div className="property-card dimension-card">
          <div className="card-heading"><div><strong>Envelope</strong><small>Fixed geometry constraint</small></div><Box size={15} /></div>
          <div className="dimension-grid"><div><span>Height</span><strong>3.2 in</strong></div><div><span>Ø diameter</span><strong>2.4 in</strong></div><div><span>Volume</span><strong>14.5 fl oz</strong></div><div><span>Scale</span><strong>1 : 1</strong></div></div>
        </div>
        <div className="property-card model-notes-card">
          <div className="card-heading"><div><strong>Model notes</strong><small>Reduced-order teaching model · v{MODEL_VERSION}</small></div><BadgeInfo size={15} /></div>
          <div className="equation-chip">P<sub>thermal</sub> ≤ {NOMINAL_THERMAL_KW.toFixed(1)} kW nominal</div>
          <ul>{MODEL_NOTES.slice(0, 4).map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      </div>
      <div className="inspector-actions"><button type="button" className="button primary" onClick={() => setMaterials(materialSet())}><Undo2 size={14} /> Restore baseline</button><span className="action-note"><Info size={13} /> Changes are hot-swapped</span></div>
    </div>
  );
}

function SafetyPanel({ snapshot, inputs, setInputs, onScram, onInert, onReset, events }) {
  const interlocks = [
    { label: "Radiation monitor", detail: "outside dose below trip", ok: snapshot.doseObserved < 2.5 },
    { label: "Thermal envelope", detail: "hot-side margin present", ok: snapshot.temperatureObserved < Math.min(snapshot.material.fuel.maxTemp, snapshot.material.cladding.maxTemp) },
    { label: "Vibration monitor", detail: "mount response in range", ok: inputs.vibration < snapshot.material.cladding.vibrationLimit },
    { label: "Containment shell", detail: "integrity > 18%", ok: snapshot.integrity > 0.18 },
    { label: "SCRAM chain", detail: "operator command available", ok: true }
  ];
  return (
    <div className="inspector-content">
      <div className="inspector-identity">
        <div className="identity-icon green"><ShieldCheck size={19} /></div>
        <div><div className="eyebrow">INSPECTOR / SAFETY</div><h2>Safety systems</h2><p>Fail-safe test harness</p></div>
        <IconButton label="Safety menu"><MoreHorizontal size={16} /></IconButton>
      </div>
      <div className={`safety-hero ${snapshot.state === "RUNNING" ? "armed" : "tripped"}`}><div className="safety-hero-icon"><ShieldCheck size={24} /></div><div><span>PROTOCOL STATUS</span><strong>{snapshot.state === "RUNNING" ? "ARMED / MONITORING" : "TRIP LATCHED"}</strong><small>{snapshot.tripReason || "Automatic protections enabled"}</small></div><span className="safety-count">{interlocks.filter((item) => item.ok).length}/5</span></div>
      <div className="inspector-scroll safety-scroll">
        <SectionLabel>INTERLOCK MATRIX <span className="section-meta">AUTO-SCRAM {inputs.automaticScram ? "ON" : "OFF"}</span></SectionLabel>
        <div className="interlock-list">
          {interlocks.map((item) => <div className="interlock-row" key={item.label}><span className={`interlock-icon ${item.ok ? "ok" : "bad"}`}>{item.ok ? <Check size={13} /> : <TriangleAlert size={13} />}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><span className={`interlock-state ${item.ok ? "ok" : "bad"}`}>{item.ok ? "READY" : "TRIP"}</span></div>)}
        </div>
        <div className="property-card scenario-card">
          <div className="card-heading"><div><strong>Inject a test condition</strong><small>Events are bounded and reversible by reset</small></div><AlertTriangle size={15} /></div>
          <div className="scenario-grid"><button type="button" onClick={() => setInputs((current) => ({ ...current, accident: current.accident === "coolant-loss" ? null : "coolant-loss" }))} className={inputs.accident === "coolant-loss" ? "chosen" : ""}><Droplets size={15} /><span>Coolant loss</span><small>reduce loop to 22%</small></button><button type="button" onClick={() => setInputs((current) => ({ ...current, accident: current.accident === "sensor-fault" ? null : "sensor-fault" }))} className={inputs.accident === "sensor-fault" ? "chosen" : ""}><Radio size={15} /><span>Sensor fault</span><small>increase readback noise</small></button><button type="button" onClick={() => setInputs((current) => ({ ...current, accident: current.accident === "shield-breach" ? null : "shield-breach" }))} className={inputs.accident === "shield-breach" ? "chosen" : ""}><ShieldAlert size={15} /><span>Shield breach</span><small>dose multiplier</small></button></div>
        </div>
        <div className="property-card command-card"><div className="card-heading"><div><strong>Emergency actions</strong><small>Commands are intentionally one-way until reset</small></div><LockKeyhole size={15} /></div><button type="button" className="emergency-button" onClick={onScram}><ShieldAlert size={15} /><span><strong>Initiate SCRAM</strong><small>drop reactivity and isolate loop</small></span><ChevronRight size={15} /></button><button type="button" className="emergency-button kill" onClick={onInert}><Power size={15} /><span><strong>Render core inert</strong><small>kill simulated chain reaction</small></span><ChevronRight size={15} /></button></div>
        <div className="property-card safety-events"><div className="card-heading"><div><strong>Last actions</strong><small>Audit trail</small></div><Clock3 size={15} /></div><EventList events={events.slice(0, 3)} /></div>
      </div>
      <div className="inspector-actions"><button type="button" className="button ghost" onClick={onReset}><RefreshCcw size={14} /> Reset test cell</button><span className="action-note"><BadgeInfo size={13} /> not an operating procedure</span></div>
    </div>
  );
}

function ViewportToolbar({ viewMode, setViewMode, onResetView }) {
  return (
    <div className="viewport-toolbar">
      <div className="viewport-path"><span className="path-dot" /><strong>Viewport</strong><ChevronRight size={13} /><span>CAN-01 Reactor</span><span className="viewport-chip">PERSPECTIVE</span></div>
      <div className="viewport-tools">
        <div className="tool-segment"><button type="button" className={viewMode.cutaway ? "selected" : ""} onClick={() => setViewMode((current) => ({ ...current, cutaway: !current.cutaway }))}><Scan size={14} /> Cutaway</button><button type="button" className={viewMode.exploded ? "selected" : ""} onClick={() => setViewMode((current) => ({ ...current, exploded: !current.exploded }))}><Layers3 size={14} /> Explode</button><button type="button" className={viewMode.radiation ? "selected" : ""} onClick={() => setViewMode((current) => ({ ...current, radiation: !current.radiation }))}><Sparkles size={14} /> Field</button></div>
        <IconButton label="Show labels" active={viewMode.labels} onClick={() => setViewMode((current) => ({ ...current, labels: !current.labels }))}>{viewMode.labels ? <Eye size={15} /> : <EyeOff size={15} />}</IconButton>
        <IconButton label="Reset camera" onClick={onResetView}><Rotate3D size={15} /></IconButton>
        <IconButton label="Maximize viewport"><Maximize2 size={15} /></IconButton>
      </div>
    </div>
  );
}

function ViewportStage({ snapshot, materials, viewMode, setViewMode, running, setRunning, onResetView, onScram, onInert }) {
  const [cameraKey, setCameraKey] = useState(0);
  const resetView = () => { setCameraKey((current) => current + 1); onResetView(); };
  return (
    <main className="viewport-stage">
      <ViewportToolbar viewMode={viewMode} setViewMode={setViewMode} onResetView={resetView} />
      <div className="viewport-body">
        <ReactorViewport key={cameraKey} materials={materials} snapshot={snapshot} viewMode={viewMode} labelsVisible={viewMode.labels} />
        <div className="viewport-grid-lines" aria-hidden="true" />
        {viewMode.labels && <>
          <div className="model-label label-core"><span className="leader-dot" /><div><strong>CORE MODULE</strong><small>{snapshot.material.fuel.short} · {formatMetric(snapshot.temperatureObserved, 0)}°C</small></div></div>
          <div className="model-label label-shield"><span className="leader-dot" /><div><strong>SHIELD STACK</strong><small>{snapshot.material.shield.short} · {formatMetric(snapshot.shieldMargin, 3)} margin</small></div></div>
          <div className="model-label label-loop"><span className="leader-dot" /><div><strong>COOLANT LOOP</strong><small>{snapshot.material.coolant.short} · {formatMetric(snapshot.flowObserved * 100, 0)}% flow</small></div></div>
        </>}
        <div className="viewport-top-note"><span className="live-pulse" /> SIMULATION LIVE <span>·</span> DETERMINISTIC NOISE</div>
        <div className="viewport-measure"><span>0</span><i /><span>1 in</span><small>CAN-SCALE ENVELOPE</small></div>
        <div className="viewport-readouts">
          <div className="readout power"><span className="readout-icon"><Zap size={14} /></span><div><small>ELECTRIC OUTPUT</small><strong>{formatMetric(snapshot.powerElectric, 2)} <em>kW</em></strong></div><span className="readout-trend">{snapshot.state === "RUNNING" ? "LIVE" : "SAFE"}</span></div>
          <div className="readout temp"><span className="readout-icon"><Thermometer size={14} /></span><div><small>CORE TEMPERATURE</small><strong>{formatMetric(snapshot.temperatureObserved, 0)} <em>°C</em></strong></div><span className="readout-trend">{formatMetric(Math.max(0, Math.min(100, (snapshot.temperatureObserved - 400) / 3.6)), 0)}%</span></div>
          <div className="readout dose"><span className="readout-icon"><ShieldCheck size={14} /></span><div><small>OUTSIDE DOSE</small><strong>{formatMetric(snapshot.doseObserved, 2)} <em>µSv/h</em></strong></div><span className="readout-trend">SHIELDED</span></div>
        </div>
        <div className="viewport-footer-controls"><div className="axis-widget"><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span><i /></div><div className="transport"><IconButton label={running ? "Pause simulation" : "Run simulation"} active={running} onClick={() => setRunning((current) => !current)}>{running ? <Pause size={14} /> : <Play size={14} />}</IconButton><span>SIM TIME <strong>{formatTime(snapshot.time)}</strong></span><span className="transport-divider" /><button type="button" onClick={onScram} className="transport-scram"><Square size={11} fill="currentColor" /> SCRAM</button><button type="button" onClick={onInert} className="transport-inert"><Power size={11} /> INERT</button></div><div className="view-hint"><Rotate3D size={13} /> orbit <span>·</span> scroll zoom</div></div>
      </div>
    </main>
  );
}

function TopBar({ running, setRunning, snapshot, onReset, onExport }) {
  return (
    <header className="topbar">
      <div className="brand-mark">S</div>
      <div className="brand-copy"><strong>SLATE</strong><span>/ REACTOR LAB</span></div>
      <div className="topbar-divider" />
      <div className="file-crumb"><span>CAN-01 Reactor</span><small>unsaved experiment</small></div>
      <div className="topbar-center"><div className="transport-pill"><IconButton label={running ? "Pause simulation" : "Run simulation"} active={running} onClick={() => setRunning((current) => !current)}>{running ? <Pause size={13} /> : <Play size={13} />}</IconButton><span className="top-sim-time">{formatTime(snapshot.time)}</span><span className="top-live"><StatusDot />{running ? "LIVE" : "PAUSED"}</span></div></div>
      <div className="topbar-right"><span className="seed-label">SEED <strong>#{snapshot.seed}</strong></span><IconButton label="Export run" onClick={onExport}><Download size={15} /></IconButton><IconButton label="Reset experiment" onClick={onReset}><RefreshCcw size={15} /></IconButton><button type="button" className="avatar-button" title="Local session">AL</button></div>
    </header>
  );
}

function NoticeBanner({ snapshot, inputs, onClear }) {
  if (!inputs.accident && snapshot.state === "RUNNING") return null;
  const message = inputs.accident === "coolant-loss" ? "Test condition active · coolant loop restricted to 22%" : inputs.accident === "sensor-fault" ? "Test condition active · readback noise increased" : inputs.accident === "shield-breach" ? "Test condition active · outside dose multiplier enabled" : snapshot.tripReason || snapshot.lastEvent;
  return <div className={`notice-banner ${snapshot.state === "RUNNING" ? "warn" : "danger"}`}><AlertTriangle size={15} /><span>{message}</span><button type="button" onClick={onClear} aria-label="Clear test condition"><X size={14} /></button></div>;
}

function App() {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createReactorSimulation(SEED);
  const engine = engineRef.current;
  const [snapshot, setSnapshot] = useState(() => engine.getState());
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [materials, setMaterials] = useState(() => materialSet());
  const [running, setRunning] = useState(true);
  const [history, setHistory] = useState(() => [engine.getState()]);
  const [metric, setMetric] = useState("power");
  const [selectedNode, setSelectedNode] = useState("core");
  const [activePanel, setActivePanel] = useState("inspector");
  const [viewMode, setViewMode] = useState({ cutaway: true, exploded: false, radiation: true, labels: true });
  const [events, setEvents] = useState([{ id: 1, message: "Baseline stable", time: "00:00:00", tone: "ok" }]);
  const lastEventRef = useRef(snapshot.lastEvent);
  const [toast, setToast] = useState("");

  const pushToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 2600);
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => {
      setSnapshot(() => {
        const next = engine.step(inputs, 0.24, materials);
        setHistory((current) => [...current, next].slice(-140));
        if (next.lastEvent !== lastEventRef.current) {
          lastEventRef.current = next.lastEvent;
          setEvents((current) => [{ id: `${next.time}-${next.lastEvent}`, message: next.lastEvent, time: formatTime(next.time), tone: next.state === "RUNNING" ? "ok" : "warn" }, ...current].slice(0, 8));
        }
        return next;
      });
    }, 90);
    return () => window.clearInterval(interval);
  }, [engine, inputs, materials, running]);

  const resetRun = useCallback(() => {
    const fresh = engine.reset(SEED);
    setSnapshot(fresh);
    setHistory([fresh]);
    setInputs(DEFAULT_INPUTS);
    setMaterials(materialSet());
    setRunning(true);
    lastEventRef.current = fresh.lastEvent;
    setEvents([{ id: `${Date.now()}-baseline`, message: "Baseline stable", time: "00:00:00", tone: "ok" }]);
    pushToast("Test cell reset to baseline");
  }, [engine, pushToast]);

  const initiateScram = useCallback(() => {
    setInputs((current) => ({ ...current, scram: true }));
    setRunning(true);
    pushToast("SCRAM command queued · negative reactivity inserted");
  }, [pushToast]);

  const inertCore = useCallback(() => {
    setInputs((current) => ({ ...current, scram: true, inertCore: true }));
    setRunning(true);
    pushToast("Core inerting sequence queued · chain reaction will terminate");
  }, [pushToast]);

  const clearAccident = useCallback(() => {
    setInputs((current) => ({ ...current, accident: null }));
    pushToast("Test condition cleared · reset required to re-arm after SCRAM");
  }, [pushToast]);

  const exportRun = useCallback(() => {
    const payload = { model: MODEL_VERSION, seed: SEED, materials: Object.fromEntries(Object.entries(materials).map(([key, value]) => [key, value.id])), inputs, final: snapshot, samples: history.slice(-40) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "can-scale-reactor-run.json";
    link.click();
    URL.revokeObjectURL(url);
    pushToast("Run snapshot exported");
  }, [history, inputs, materials, pushToast, snapshot]);

  const activeContent = useMemo(() => {
    if (activePanel === "materials") return <MaterialsPanel materials={materials} setMaterials={setMaterials} snapshot={snapshot} />;
    if (activePanel === "safety") return <SafetyPanel snapshot={snapshot} inputs={inputs} setInputs={setInputs} onScram={initiateScram} onInert={inertCore} onReset={resetRun} events={events} />;
    return <InspectorPanel snapshot={snapshot} inputs={inputs} setInputs={setInputs} materials={materials} setMaterials={setMaterials} setActivePanel={setActivePanel} onScram={initiateScram} onInert={inertCore} onReset={resetRun} />;
  }, [activePanel, events, inertCore, initiateScram, inputs, materials, resetRun, snapshot]);

  return (
    <div className="app-shell">
      <TopBar running={running} setRunning={setRunning} snapshot={snapshot} onReset={resetRun} onExport={exportRun} />
      <NoticeBanner snapshot={snapshot} inputs={inputs} onClear={clearAccident} />
      <div className="editor-workspace">
        <LeftDock snapshot={snapshot} history={history} metric={metric} setMetric={setMetric} selectedNode={selectedNode} setSelectedNode={setSelectedNode} events={events} onFocus={() => setViewMode((current) => ({ ...current, exploded: false }))} />
        <ViewportStage snapshot={snapshot} materials={materials} viewMode={viewMode} setViewMode={setViewMode} running={running} setRunning={setRunning} onResetView={() => pushToast("Camera reset")} onScram={initiateScram} onInert={inertCore} />
        <aside className="dock right-dock">
          <div className="inspector-tabs"><button type="button" className={activePanel === "inspector" ? "active" : ""} onClick={() => setActivePanel("inspector")}><Settings2 size={14} /> Inspector</button><button type="button" className={activePanel === "materials" ? "active" : ""} onClick={() => setActivePanel("materials")}><Layers3 size={14} /> Materials</button><button type="button" className={activePanel === "safety" ? "active" : ""} onClick={() => setActivePanel("safety")}><ShieldCheck size={14} /> Safety</button></div>
          {activeContent}
        </aside>
      </div>
      <footer className="app-statusbar"><span><StatusDot /> CAN-SCALE TEST CELL</span><span className="status-separator" /><span>MODEL {MODEL_VERSION}</span><span className="status-separator" /><span><LockKeyhole size={12} /> LOCAL ONLY</span><span className="status-spacer" /><span className="status-warning"><BadgeInfo size={13} /> EDUCATIONAL REDUCED-ORDER MODEL — NOT FOR ENGINEERING USE</span></footer>
      {toast && <div className="toast-message"><Check size={14} />{toast}</div>}
    </div>
  );
}

export default App;

createRoot(document.getElementById("root")).render(<App />);

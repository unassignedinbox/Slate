// Slate reactor simulator: editor shell (Frontier outliner / inspector layout) around a live,
// to-scale reactor model. All physics runs in the browser from src/physics.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Atom,
  Box,
  Check,
  ChevronRight,
  Cpu,
  Droplets,
  Gauge,
  Layers,
  Pause,
  Play,
  Power,
  RotateCcw,
  Shield,
  Thermometer,
  Trash2,
  Waves,
  Zap,
  Radio,
  Crosshair,
  Settings,
} from 'lucide-react';
import { ReactorSimulation, outcomeOf } from './physics/reactor.js';
import { defaultDesign, checkDesign } from './physics/design.js';
import { FUELS, COOLANTS, CONVERTERS, SHIELDS, STRUCTURAL, VESSELS } from './physics/materials.js';
import { SCENARIOS, summarise } from './physics/scenarios.js';
import { createRng } from './physics/rng.js';
import { BETA_TOTAL, PUBLIC_LIMIT_SV_PER_HOUR, OCCUPATIONAL_LIMIT_SV_PER_YEAR, CAN_RADIUS_M, CAN_HEIGHT_M } from './physics/constants.js';
import Reactor3D from './ui/Reactor3D.jsx';

const K2C = (K) => (K - 273.15).toFixed(1);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');
const sci = (x, d = 2) => (Number.isFinite(x) ? (x === 0 ? '0' : x.toExponential(d)) : '—');

const SECTIONS = [
  { group: 'Core', items: [
    { id: 'design', label: 'Design & materials', icon: Box },
    { id: 'power', label: 'Power & conversion', icon: Zap },
  ] },
  { group: 'Protection', items: [
    { id: 'operation', label: 'Operation & rods', icon: Crosshair },
    { id: 'sensors', label: 'Sensors & voting', icon: Radio },
    { id: 'radiation', label: 'Radiation & shielding', icon: Shield },
  ] },
  { group: 'Environment', items: [
    { id: 'environment', label: 'Vibration, ambient, sink', icon: Waves },
    { id: 'structure', label: 'Vibration & structure', icon: Layers },
  ] },
  { group: 'Analysis', items: [
    { id: 'scenario', label: 'Scenario runner', icon: Play },
    { id: 'reliability', label: 'Monte Carlo reliability', icon: Activity },
    { id: 'materials', label: 'Material comparison', icon: Atom },
  ] },
];

const DEFAULT_OPS = { setpoint: 1.0, vibration: 1, ambientC: 20, sinkFactor: 1, noise: true, protection: true, seed: 1 };

export default function App() {
  const [design, setDesign] = useState(() => defaultDesign());
  const [applied, setApplied] = useState(() => defaultDesign());
  const [ops, setOps] = useState(DEFAULT_OPS);
  const [section, setSection] = useState('design');
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(10);
  const [snap, setSnap] = useState(null);
  const [geo, setGeo] = useState(null);
  const [history, setHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [scenarioKey, setScenarioKey] = useState('pumpTrip');
  const [scenarioResult, setScenarioResult] = useState(null);
  const [mc, setMc] = useState(null);
  const [build, setBuild] = useState(0); // increments on each (re)start
  const simRef = useRef(null);
  const pendingRef = useRef([]);
  const holdRef = useRef(0);
  const scenarioRef = useRef(null); // { key, timeline, done } while a scenario is running

  const check = useMemo(() => checkDesign(design), [design]);
  const appliedCheck = useMemo(() => checkDesign(applied), [applied]);

  // ---- (re)build the simulation from the applied design
  useEffect(() => {
    if (!appliedCheck.ok) return;
    try {
      const sim = new ReactorSimulation(applied, {
        seed: ops.seed,
        noise: ops.noise,
        protection: ops.protection,
        warmUpS: 3000,
      });
      simRef.current = sim;
      pendingRef.current = [];
      scenarioRef.current = null;
      setGeo(sim.g);
      setEvents([]);
      setHistory([]);
      setSnap(sim.snapshot());
      setError(null);
      // apply live operating settings
      sim.setSetpoint(ops.setpoint);
      sim.setVibrationMultiplier(ops.vibration);
      sim.setAmbient(ops.ambientC + 273.15);
      sim.setSinkFactor(ops.sinkFactor);
    } catch (e) {
      setError(String(e.message || e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, build]);

  // ---- live operating settings (no restart)
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setSetpoint(ops.setpoint);
    sim.setVibrationMultiplier(ops.vibration);
    sim.setAmbient(ops.ambientC + 273.15);
    sim.setSinkFactor(ops.sinkFactor);
  }, [ops.setpoint, ops.vibration, ops.ambientC, ops.sinkFactor]);

  // ---- simulation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPublish = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dtReal = Math.min(0.1, (now - last) / 1000);
      last = now;
      const sim = simRef.current;
      if (!sim) return;
      if (running) {
        let budget = dtReal * speed;
        while (budget > 1e-9) {
          const chunk = Math.min(0.05, budget);
          // scripted scenario events (times are relative to the hand-over)
          while (pendingRef.current.length && pendingRef.current[0].t <= sim.t + chunk + 1e-9) {
            const ev = pendingRef.current.shift();
            sim.applyAction(ev.action, ev.params ?? {});
            setEvents((list) => [...list.slice(-199), { t: sim.t, message: `Scenario event: ${ev.action}` }]);
          }
          sim.run(chunk);
          budget -= chunk;
        }
        // hold-to-withdraw / insert
        if (holdRef.current !== 0) sim.setOperatorInsertRate(holdRef.current * 0.1);
        else sim.setOperatorInsertRate(0);
        // scenario finished: summarise the live run
        const sc = scenarioRef.current;
        if (sc && !sc.done && sim.t >= SCENARIOS[sc.key].duration - 1e-9) {
          sc.done = true;
          setScenarioResult(summarise(sim, SCENARIOS[sc.key], sc.timeline));
        }
      }
      if (now - lastPublish > 100) {
        lastPublish = now;
        const s = sim.snapshot();
        setSnap(s);
        setEvents(sim.events.slice(-200));
        setHistory(sim.history.slice(-300));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, build]);

  // ---- Monte Carlo summary (precomputed by scripts/monte-carlo.mjs)
  useEffect(() => {
    fetch('./data/monte-carlo.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMc(j))
      .catch(() => setMc(null));
  }, []);

  const restart = () => {
    scenarioRef.current = null;
    setScenarioResult(null);
    setBuild((b) => b + 1);
  };
  const applyDesign = () => {
    if (!check.ok) return;
    setApplied(JSON.parse(JSON.stringify(design)));
  };

  const act = (fn) => {
    const sim = simRef.current;
    if (!sim) return;
    fn(sim);
    setSnap(sim.snapshot());
  };

  const outcome = snap ? snapOutcome(snap) : null;

  const runSelectedScenario = () => {
    if (!appliedCheck.ok) return;
    const sc = SCENARIOS[scenarioKey];
    // same seeded event draw as the Monte Carlo batch for this seed
    const timeline = timelineFor(scenarioKey, ops.seed);
    const sim = new ReactorSimulation(applied, { seed: ops.seed, noise: ops.noise, protection: sc.protection, warmUpS: 3000 });
    sim.setSetpoint(ops.setpoint);
    sim.setVibrationMultiplier(ops.vibration);
    sim.setAmbient(ops.ambientC + 273.15);
    sim.setSinkFactor(ops.sinkFactor);
    simRef.current = sim;
    pendingRef.current = timeline.map((e) => ({ ...e }));
    scenarioRef.current = { key: scenarioKey, timeline, done: false };
    setScenarioResult(null);
    setGeo(sim.g);
    setEvents([{ t: 0, message: `Scenario started: ${sc.label}. ${sc.description}` }]);
    setHistory([]);
    setSnap(sim.snapshot());
    setRunning(true);
  };

  // ---- derive values for the panels
  const s = snap;
  const g = geo;

  return (
    <div className="shell">
      <aside className="outliner">
        <div className="brand">
          <span className="brand-symbol"><Atom size={22} strokeWidth={1.6} /></span>
          Slate<span className="brand-dot">.</span>
          <span className="version">v1.0</span>
        </div>
        <div className="scene-label"><span>REACTOR</span><span>355 ML</span></div>
        <div className="scene-title">Coke-can reactor<span className="scene-extension">.sim</span></div>
        <nav className="tree" aria-label="Sections">
          {SECTIONS.map((grp) => (
            <div key={grp.group}>
              <div className="group-label">{grp.group.toUpperCase()}</div>
              {grp.items.map((it) => {
                const Icon = it.icon;
                return (
                  <div key={it.id} className={`tree-row ${section === it.id ? 'selected' : ''}`}>
                    <button className="object-button" onClick={() => setSection(it.id)}>
                      <Icon size={15} />
                      <span>{it.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="outliner-bottom">
          <span className="status-dot" />
          <div>
            <strong>{s ? outcomeLabel(outcome) : 'Starting'}</strong>
            <div>t = {s ? fmt(s.t, 1) : 0} s from hand-over</div>
          </div>
        </div>
      </aside>

      <main className="reactor-main">
        <header className="inspector-top">
          <div>
            <span>Reactor</span>
            <ChevronRight size={13} />
            <span>{SECTIONS.flatMap((x) => x.items).find((x) => x.id === section)?.label}</span>
          </div>
          <div className="transport">
            <button onClick={() => setRunning((r) => !r)} aria-label={running ? 'Pause' : 'Play'}>
              {running ? <Pause size={14} /> : <Play size={14} />}
              {running ? 'Pause' : 'Run'}
            </button>
            <select className="select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: 92 }} aria-label="Simulation speed">
              {[1, 10, 60, 300].map((v) => <option key={v} value={v}>{v}× real time</option>)}
            </select>
            <button onClick={restart} aria-label="Reset"><RotateCcw size={14} />Reset</button>
            <span className={`status-pill ${outcome ? outcome.toLowerCase() : ''}`}>{outcome ? outcomeLabel(outcome) : '—'}</span>
          </div>
        </header>

        <div className="inspector-content" style={{ paddingTop: 22 }}>
          {error && <div className="note bad" style={{ marginBottom: 14 }}>Simulation error: {error}</div>}
          {!check.ok && (
            <div className="note bad" style={{ marginBottom: 14 }}>
              The current design is not buildable: {check.violations.join(' ')}
            </div>
          )}

          <div className="viewport">
            <Reactor3D geo={g} snap={s} />
            <div className="viewport-status">
              {s && s.destroyed && <span className="status-pill destroyed">Core destroyed: {s.destroyCause}</span>}
            </div>
            <div className="viewport-legend">
              <span><i />{'293 K → fuel damage limit'}</span>
              <span>Rods: amber = stuck</span>
              <span>Shake exaggerated for display</span>
            </div>
          </div>

          <div className="metric-grid">
            <Kpi label="Electric output" value={s ? sci(s.Pe, 2) : '—'} unit="W" sub={s ? `efficiency ${(s.efficiency * 100).toFixed(2)} %` : ''} />
            <Kpi label="Thermal power" value={s ? fmt(s.Pth, 2) : '—'} unit="W" sub={s ? `fission ${fmt(s.Pfis, 2)} W · decay ${sci(s.Pdecay, 2)} W` : ''} />
            <Kpi label="Fuel temperature" value={s ? K2C(s.Tf) : '—'} unit="°C" sub={s && g ? `damage ${K2C(g.tFuelDamage)} °C` : ''} cls={s && g && s.Tf > g.tFuelDamage ? 'bad' : ''} />
            <Kpi label="Reactivity" value={s ? fmt(s.rhoDollar, 3) : '—'} unit="$" sub={s ? `rod position ${fmt(s.rods[0].z, 3)}` : ''} />
            <Kpi label="Coolant flow (true)" value={s ? fmt(s.flowTrue * 1000 * 3600, 2) : '—'} unit="g/h" sub={s && g ? `nominal ${fmt(g.flowNom * 1000 * 3600, 2)} g/h` : ''} />
            <Kpi label="Vibration" value={s ? fmt(s.grms, 1) : '—'} unit="g rms" sub={s ? `stack ${fmt(s.fn, 0)} Hz · trip 30 g` : ''} cls={s && s.grms > 30 ? 'warn' : ''} />
            <Kpi label="Can wall" value={s ? K2C(s.Tw) : '—'} unit="°C" sub={s && g ? `limit ${K2C(g.tWallLimit)} °C` : ''} cls={s && s.breach ? 'bad' : ''} />
            <Kpi label="Dose at 1 m" value={s ? sci(s.radiation.at1m.totalSvPerH, 2) : '—'} unit="Sv/h" sub={`public limit ${sci(PUBLIC_LIMIT_SV_PER_HOUR, 0)} Sv/h`} cls={s && s.radiation.at1m.totalSvPerH > PUBLIC_LIMIT_SV_PER_HOUR ? 'bad' : ''} />
          </div>

          {section === 'design' && <DesignPanel design={design} setDesign={setDesign} check={check} applied={applied} applyDesign={applyDesign} appliedOk={appliedCheck.ok} />}
          {section === 'power' && <PowerPanel s={s} g={g} history={history} applied={applied} />}
          {section === 'operation' && <OperationPanel s={s} act={act} holdRef={holdRef} ops={ops} setOps={setOps} />}
          {section === 'sensors' && <SensorPanel s={s} g={g} />}
          {section === 'radiation' && <RadiationPanel s={s} applied={applied} />}
          {section === 'environment' && <EnvironmentPanel ops={ops} setOps={setOps} applied={applied} />}
          {section === 'structure' && <StructurePanel s={s} g={g} applied={applied} />}
          {section === 'scenario' && (
            <ScenarioPanel scenarioKey={scenarioKey} setScenarioKey={setScenarioKey} run={runSelectedScenario} result={scenarioResult} ok={appliedCheck.ok} events={events} />
          )}
          {section === 'reliability' && <ReliabilityPanel mc={mc} />}
          {section === 'materials' && <MaterialPanel mc={mc} />}

          {(section === 'operation' || section === 'power' || section === 'sensors' || section === 'structure' || section === 'radiation') && (
            <section className="card full" style={{ marginTop: 14 }}>
              <div className="card-heading"><span><Settings size={15} />Event log</span></div>
              <EventLog events={events} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function snapOutcome(s) {
  if (s.destroyed) return 'DESTROYED';
  if (s.breach) return 'BREACH';
  if (s.maxima.Tf > s.limits.tFuelDamage) return 'FUEL_DAMAGE';
  if (s.killed || s.scramRequested) return 'SHUTDOWN';
  return 'OPERATING';
}

function outcomeLabel(o) {
  return {
    OPERATING: 'Operating',
    SHUTDOWN: 'Shut down',
    FUEL_DAMAGE: 'Fuel damage',
    BREACH: 'Containment breach',
    DESTROYED: 'Core destroyed',
  }[o] || o;
}

/** The same timeline as the batch runner draws for this seed (with parameters). */
function timelineFor(key, seed) {
  const draw = createRng(seed * 7919 + 17);
  return SCENARIOS[key].events(draw).map((e) => ({ t: e.t, action: e.action, params: e.params }));
}

function Kpi({ label, value, unit, sub, cls = '' }) {
  return (
    <div className={`kpi ${cls}`}>
      <div className="label">{label}</div>
      <div className="value">{value}<small>{unit}</small></div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children, full = false, accent }) {
  return (
    <section className={`card ${full ? 'full' : ''}`} style={{ '--accent': accent || '#a8bbeb' }}>
      <div className="card-heading"><span>{Icon && <Icon size={15} />}{title}</span></div>
      {children}
    </section>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '', digits = 2 }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="field">
      <span>{label}<small>{fmt(value, digits)} {unit}</small></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--progress': `${pct}%` }} />
    </label>
  );
}

function Select({ label, value, options, onChange, hint }) {
  return (
    <label className="field">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, unit = '', step = 'any', hint }) {
  return (
    <label className="field">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {unit && <small style={{ color: '#7a7a7a' }}>{unit}</small>}
    </label>
  );
}

function EventLog({ events }) {
  const list = events.slice(-60).reverse();
  return (
    <div className="log">
      {list.length === 0 && <div>No events yet.</div>}
      {list.map((e, i) => (
        <div key={i}><time>t={fmt(e.t, 1)} s</time>{e.message}</div>
      ))}
    </div>
  );
}

function Spark({ data, keys, colors, label }) {
  if (!data || data.length < 2) return <div className="note">Waiting for data…</div>;
  const w = 600;
  const h = 96;
  const series = keys.map((k) => data.map((d) => d[k]));
  const all = series.flat().filter(Number.isFinite);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i) => (i / (data.length - 1)) * w;
  const y = (v) => h - 6 - ((v - lo) / span) * (h - 12);
  return (
    <div>
      <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {series.map((ys, si) => (
          <polyline key={keys[si]} fill="none" stroke={colors[si]} strokeWidth="1.6" points={ys.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
      </svg>
      <div className="range-labels">
        <span>{label}</span>
        <span>{keys.map((k, i) => <span key={k} style={{ color: colors[i], marginLeft: 12 }}>{k}</span>)}</span>
      </div>
      <div className="range-labels"><span>min {fmt(lo, 3)}</span><span>max {fmt(hi, 3)}</span></div>
    </div>
  );
}

// ---------------------------------------------------------------- panels

export function DesignPanel({ design, setDesign, check, applied, applyDesign, appliedOk }) {
  const set = (k, v) => setDesign((d) => ({ ...d, [k]: v }));
  const g = check.derived;
  const usedPct = g ? (g.usedVolume / g.envelopeVolume) * 100 : 0;
  const dirty = JSON.stringify(design) !== JSON.stringify(applied);
  return (
    <div className="two-col">
      <Card title="Fuel, coolant and can" icon={Box}>
        <Select label="Fuel" value={design.fuel} options={Object.entries(FUELS).map(([k, f]) => [k, f.name + (f.estimate ? ' (estimate)' : '')])} onChange={(v) => set('fuel', v)} />
        <Select label="Coolant / moderator" value={design.coolant} options={Object.entries(COOLANTS).map(([k, c]) => [k, c.name])} onChange={(v) => { set('coolant', v); set('coolantPressureMPa', COOLANTS[v].defaultPressureMPa); }} />
        <NumberField label="Coolant pressure" unit="MPa" value={design.coolantPressureMPa} onChange={(v) => set('coolantPressureMPa', v)} hint="can allows ~0.29 MPa" />
        <Select label="Can material" value={design.vessel} options={Object.entries(VESSELS).map(([k, v]) => [k, v.name])} onChange={(v) => set('vessel', v)} />
        <NumberField label="Can wall thickness" unit="m" value={design.vesselThicknessM} onChange={(v) => set('vesselThicknessM', v)} step="0.00001" />
        <Select label="Fuel-support structure" value={design.structure} options={Object.entries(STRUCTURAL).map(([k, v]) => [k, v.name + (v.estimate ? ' (estimate)' : '')])} onChange={(v) => set('structure', v)} />
      </Card>
      <Card title="Geometry and power" icon={Layers}>
        <NumberField label="Fuel radius" unit="m" value={design.fuelRadiusM} onChange={(v) => set('fuelRadiusM', v)} step="0.001" />
        <NumberField label="Fuel height" unit="m" value={design.fuelHeightM} onChange={(v) => set('fuelHeightM', v)} step="0.001" />
        <NumberField label="Coolant gap" unit="m" value={design.coolantGapM} onChange={(v) => set('coolantGapM', v)} step="0.0005" />
        <Slider label="Specific power" value={design.specificPowerWPerCm3} min={0.02} max={1} step={0.01} unit="W/cm³" onChange={(v) => set('specificPowerWPerCm3', v)} />
        <Select label="Power conversion" value={design.converter} options={Object.entries(CONVERTERS).map(([k, c]) => [k, c.name + (c.estimate ? ' (estimate)' : '')])} onChange={(v) => set('converter', v)} />
        <div className="note">Envelope use: {fmt(usedPct, 1)} % of the 355 ml can ({fmt((g?.usedVolume ?? 0) * 1e6, 0)} of {fmt((g?.envelopeVolume ?? 0) * 1e6, 0)} cm³). Rated thermal power {fmt(g?.ratedPowerW ?? 0, 2)} W.</div>
      </Card>
      <Card title="Shielding and control" icon={Shield}>
        <Select label="Gamma shield" value={design.gammaShield.id} options={Object.entries(SHIELDS).filter(([, s]) => s.role === 'gamma').map(([k, s]) => [k, s.name])} onChange={(v) => set('gammaShield', { ...design.gammaShield, id: v })} />
        <NumberField label="Gamma shield thickness" unit="m" value={design.gammaShield.thicknessM} onChange={(v) => set('gammaShield', { ...design.gammaShield, thicknessM: v })} step="0.001" />
        <Select label="Neutron shield" value={design.neutronShield.id} options={Object.entries(SHIELDS).filter(([, s]) => s.role === 'neutron').map(([k, s]) => [k, s.name])} onChange={(v) => set('neutronShield', { ...design.neutronShield, id: v })} />
        <NumberField label="Neutron shield thickness" unit="m" value={design.neutronShield.thicknessM} onChange={(v) => set('neutronShield', { ...design.neutronShield, thicknessM: v })} step="0.001" />
        <NumberField label="Rod worth (total)" unit="Δk/k" value={design.rods.worthTotal} onChange={(v) => set('rods', { ...design.rods, worthTotal: v })} step="0.001" hint={`shutdown margin ${fmt((design.rods.worthTotal - design.excessReactivity) / BETA_TOTAL, 1)} $`} />
        <NumberField label="Excess reactivity" unit="Δk/k" value={design.excessReactivity} onChange={(v) => set('excessReactivity', v)} step="0.001" />
        <NumberField label="Rod stuck probability (per rod, SCRAM)" value={design.rods.pStuck} onChange={(v) => set('rods', { ...design.rods, pStuck: v })} step="0.001" />
      </Card>
      <Card title="Heat sink and sensors" icon={Thermometer}>
        <NumberField label="External heat-sink conductance" unit="W/K" value={design.sinkUAWPerK} onChange={(v) => set('sinkUAWPerK', v)} step="0.01" />
        <Slider label="Flow sensor error (1σ)" value={design.sensors.flowSigma * 100} min={0} max={10} step={0.1} unit="%" digits={1} onChange={(v) => set('sensors', { ...design.sensors, flowSigma: v / 100 })} />
        <Slider label="Temperature sensor error (1σ)" value={design.sensors.tempSigmaK} min={0} max={10} step={0.1} unit="K" digits={1} onChange={(v) => set('sensors', { ...design.sensors, tempSigmaK: v })} />
        <Slider label="Flux sensor error (1σ)" value={design.sensors.fluxSigma * 100} min={0} max={5} step={0.05} unit="%" digits={2} onChange={(v) => set('sensors', { ...design.sensors, fluxSigma: v / 100 })} />
        <Slider label="Pump tolerance (±)" value={design.pump.toleranceFrac * 100} min={0} max={10} step={0.1} unit="%" digits={1} onChange={(v) => set('pump', { ...design.pump, toleranceFrac: v / 100 })} />
      </Card>
      <Card title="Validation" icon={AlertTriangle} full>
        {check.violations.length === 0 && check.warnings.length === 0 && <div className="note">No violations. Geometry, hoop stress and saturation pass the design checks.</div>}
        {check.violations.map((v) => <div key={v} className="note bad">✕ {v}</div>)}
        {check.warnings.map((w) => <div key={w} className="note warn">▲ {w}</div>)}
        <div className="toggle-row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={applyDesign} disabled={!check.ok || !dirty}><Check size={14} />Apply design and restart</button>
          {dirty && <span className="note warn">Unapplied changes</span>}
          {!appliedOk && <span className="note bad">The applied design is invalid.</span>}
        </div>
      </Card>
    </div>
  );
}

export function PowerPanel({ s, g, history, applied }) {
  if (!s) return null;
  const e = s.energy;
  const residual = e.thermal - e.electric - e.environment - e.stored;
  return (
    <div className="two-col">
      <Card title="Electric output" icon={Zap}>
        <div className="metric" style={{ fontSize: 40 }}>{sci(s.Pe, 3)}<span style={{ fontSize: 14, color: '#8a8a8a' }}>W</span></div>
        <p className="muted">{CONVERTERS[applied.converter].name}</p>
        <div className="note">Efficiency {fmt(s.efficiency * 100, 3)} % of thermal. Hot side {K2C(s.Tc)} °C, cold side {K2C(s.Tw)} °C.</div>
      </Card>
      <Card title="Thermal power" icon={Activity}>
        <div className="metric" style={{ fontSize: 40 }}>{fmt(s.Pth, 3)}<span style={{ fontSize: 14, color: '#8a8a8a' }}>W</span></div>
        <table className="table" style={{ marginTop: 14 }}>
          <tbody>
            <tr><td>Fission</td><td className="num">{sci(s.Pfis, 3)} W</td></tr>
            <tr><td>Decay heat (Way–Wigner)</td><td className="num">{sci(s.Pdecay, 3)} W</td></tr>
            <tr><td>Rated</td><td className="num">{fmt(g?.ratedPowerW, 3)} W</td></tr>
          </tbody>
        </table>
      </Card>
      <Card title="Power history" icon={Gauge} full>
        <Spark data={history} keys={['Pe']} colors={['#9fe0b2']} label="electric, W (scaled to data range)" />
        <Spark data={history} keys={['Pth']} colors={['#a8bbeb']} label="thermal, W" />
      </Card>
      <Card title="Energy ledger" icon={Layers} full>
        <table className="table">
          <thead><tr><th>Term</th><th className="num">Energy (J)</th></tr></thead>
          <tbody>
            <tr><td>Thermal in (fission + decay)</td><td className="num">{sci(e.thermal, 4)}</td></tr>
            <tr><td>Electric out</td><td className="num">{sci(e.electric, 4)}</td></tr>
            <tr><td>Environment (wall + sink)</td><td className="num">{sci(e.environment, 4)}</td></tr>
            <tr><td>Stored in fuel, coolant, wall</td><td className="num">{sci(e.stored, 4)}</td></tr>
            <tr><td>Residual (should be ~0)</td><td className="num">{sci(residual, 2)}</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function OperationPanel({ s, act, holdRef, ops, setOps }) {
  const holdButton = (label, rate, cls = '') => (
    <button
      className={`btn ${cls}`}
      onPointerDown={() => { holdRef.current = rate; }}
      onPointerUp={() => { holdRef.current = 0; }}
      onPointerLeave={() => { holdRef.current = 0; }}
    >{label}</button>
  );
  return (
    <div className="two-col">
      <Card title="Protection actions" icon={Power}>
        <div className="toggle-row">
          <button className="btn warn" onClick={() => act((sim) => sim.scramRods('operator SCRAM'))}><Power size={14} />SCRAM</button>
          <button className="btn warn" onClick={() => act((sim) => sim.tripPump('operator'))}><Droplets size={14} />Trip pump</button>
          <button className="btn warn" onClick={() => act((sim) => sim.forceStuckRods())}><AlertTriangle size={14} />Stick rods (fault)</button>
        </div>
        <div className="toggle-row" style={{ marginTop: 14 }}>
          <button className="btn danger" onClick={() => act((sim) => sim.killCore('operator kill'))}><Trash2 size={14} />Core kill (poison)</button>
          <button className="btn danger" onClick={() => act((sim) => sim.destroyCoreNow('operator destruct'))}><Trash2 size={14} />Destroy core</button>
        </div>
        <p className="muted">Kill injects permanent poison and SCRAMs. Destroy stops fission at once and releases fuel inventory. Both are irreversible.</p>
        <div className="note">Protection trips: {s?.tripCauses?.length ? s.tripCauses.join(', ') : 'none'}. Rods stuck: {s ? s.rods.filter((r) => r.stuck).length : 0} of {s ? s.rods.length : 0}.</div>
      </Card>
      <Card title="Rods and setpoint" icon={Crosshair}>
        <div className="toggle-row" style={{ marginBottom: 14 }}>
          {holdButton('Hold: withdraw rods', -1)}
          {holdButton('Hold: insert rods', 1)}
        </div>
        <Slider label="Power setpoint" value={ops.setpoint * 100} min={20} max={120} step={1} unit="%" digits={0} onChange={(v) => setOps((o) => ({ ...o, setpoint: v / 100 }))} />
        <div className="note">Rod position {s ? fmt(s.rods[0].z, 3) : '—'} (0 = withdrawn, 1 = inserted). Controller uses the median of three flux channels.</div>
      </Card>
      <Card title="Protection settings" icon={Settings} full>
        <div className="toggle-row">
          <button className={`chip ${ops.protection ? 'on' : ''}`} onClick={() => setOps((o) => ({ ...o, protection: !o.protection }))}>Automatic protection {ops.protection ? 'ON' : 'OFF'}</button>
          <button className={`chip ${ops.noise ? 'on' : ''}`} onClick={() => setOps((o) => ({ ...o, noise: !o.noise }))}>Sensor noise {ops.noise ? 'ON' : 'OFF'}</button>
        </div>
        <p className="muted">Changing protection or noise takes effect on Reset or on the next scenario run.</p>
        <div className="note">Trip set points: power 115 %, fuel temperature 90 % of damage limit, flow 70 %, vibration 30 g, coolant 10 K below saturation, can wall 95 % of its limit. Two-out-of-three voting on each.</div>
      </Card>
    </div>
  );
}

export function SensorPanel({ s, g }) {
  if (!s || !s.readings) return null;
  const r = s.readings;
  const f = (arr, k = 1) => arr.map((x) => fmt(x * k, 3)).join('  ·  ');
  return (
    <div className="two-col">
      <Card title="Flow measurement" icon={Droplets}>
        <table className="table">
          <tbody>
            <tr><td>True flow (incl. pump tolerance and vibration)</td><td className="num">{fmt(s.flowTrue / g.flowNom, 4)} × nominal</td></tr>
            <tr><td>Measured channels (3)</td><td className="num">{f(r.flow)}</td></tr>
          </tbody>
        </table>
        <div className="note">Each flow channel carries an independent 2 % (1σ) error by default (design: sensors.flowSigma). The trip votes two of three channels below 70 % of nominal.</div>
      </Card>
      <Card title="Temperature and flux channels" icon={Thermometer}>
        <table className="table">
          <tbody>
            <tr><td>Fuel (K)</td><td className="num">{f(r.fuelT)}</td></tr>
            <tr><td>Coolant (K)</td><td className="num">{f(r.coolT)}</td></tr>
            <tr><td>Flux (× rated)</td><td className="num">{f(r.flux)}</td></tr>
            <tr><td>Vibration (g rms)</td><td className="num">{f(r.grms)}</td></tr>
          </tbody>
        </table>
      </Card>
      <Card title="Trip voting" icon={AlertTriangle} full>
        <div className="note">Causes latched: {s.tripCauses.length ? s.tripCauses.join(', ') : 'none'}. SCRAM {s.scramRequested ? 'requested' : 'not requested'}.</div>
      </Card>
    </div>
  );
}

export function RadiationPanel({ s, applied }) {
  if (!s) return null;
  const r = s.radiation;
  const exclusion1 = Math.sqrt(r.at1m.totalSvPerH / PUBLIC_LIMIT_SV_PER_HOUR); // metres, 1/d² law
  const occ = OCCUPATIONAL_LIMIT_SV_PER_YEAR;
  return (
    <div className="two-col">
      <Card title="Dose rates" icon={Shield}>
        <table className="table">
          <thead><tr><th>Position</th><th className="num">Neutron</th><th className="num">Gamma</th><th className="num">Total</th></tr></thead>
          <tbody>
            <tr><td>1 m from core</td><td className="num">{sci(r.at1m.neutronSvPerH, 2)}</td><td className="num">{sci(r.at1m.gammaSvPerH, 2)}</td><td className="num">{sci(r.at1m.totalSvPerH, 2)} Sv/h</td></tr>
            <tr><td>Can surface</td><td className="num">{sci(r.atCanSurface.neutronSvPerH, 2)}</td><td className="num">{sci(r.atCanSurface.gammaSvPerH, 2)}</td><td className="num">{sci(r.atCanSurface.totalSvPerH, 2)} Sv/h</td></tr>
            <tr><td>Released inventory, 1 m</td><td className="num">—</td><td className="num">—</td><td className="num">{sci(r.releasedAt1m, 2)} Sv/h</td></tr>
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 12 }}>
          Public limit {sci(PUBLIC_LIMIT_SV_PER_HOUR, 1)} Sv/h (20 µSv/h). Distance at which the operating dose falls to that limit: <b>{fmt(exclusion1, 0)} m</b>. Occupational annual limit {fmt(occ * 1000, 0)} mSv.
        </div>
      </Card>
      <Card title="Shielding in the can" icon={Layers}>
        <table className="table">
          <tbody>
            <tr><td>Gamma shield</td><td className="num">{SHIELDS[applied.gammaShield.id].name} · {fmt(applied.gammaShield.thicknessM * 1000, 1)} mm</td></tr>
            <tr><td>Neutron shield</td><td className="num">{SHIELDS[applied.neutronShield.id].name} · {fmt(applied.neutronShield.thicknessM * 1000, 1)} mm</td></tr>
            <tr><td>Can radius / height</td><td className="num">{fmt(CAN_RADIUS_M * 1000, 1)} / {fmt(CAN_HEIGHT_M * 1000, 1)} mm</td></tr>
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 12 }}>
          Fast-neutron removal in borated polyethylene is Σ<sub>R</sub> ≈ 0.107 cm⁻¹, so a few millimetres remove only a few per cent of neutrons. The neutron dose from a 5 W source is therefore not reducible to the public limit inside this can. The distance figure above is the practical result.
        </div>
      </Card>
      <Card title="Protection thresholds" icon={AlertTriangle} full>
        <div className="note">Gamma source: prompt gamma (7 MeV per fission of 200 MeV) plus 0.6 of decay power. Neutron source: 2.43 neutrons per fission. Dose coefficients: 290 pSv·cm² per n/cm² at 1 MeV (AP, PDG). Gamma buildup is an approximate linear form.</div>
      </Card>
    </div>
  );
}

export function EnvironmentPanel({ ops, setOps, applied }) {
  return (
    <div className="two-col">
      <Card title="Vibration" icon={Waves}>
        <Slider label="Vibration environment (× design PSD)" value={ops.vibration} min={0} max={100} step={0.1} unit="×" digits={1} onChange={(v) => setOps((o) => ({ ...o, vibration: v }))} />
        <div className="note">Design PSD {applied.vibration.psd} g²/Hz, 20–2000 Hz. 1× gives ~21.6 g rms; the protection trip is at 30 g. Above 40 g the Bi₂Te₃ converter fails; the Stirling option fails at 6 g.</div>
      </Card>
      <Card title="Ambient and sink" icon={Thermometer}>
        <Slider label="Ambient temperature" value={ops.ambientC} min={-20} max={80} step={1} unit="°C" digits={0} onChange={(v) => setOps((o) => ({ ...o, ambientC: v }))} />
        <Slider label="External heat-sink conductance" value={ops.sinkFactor * 100} min={0} max={100} step={1} unit="%" digits={0} onChange={(v) => setOps((o) => ({ ...o, sinkFactor: v / 100 }))} />
      </Card>
      <Card title="Random run conditions" icon={Cpu} full>
        <div className="toggle-row">
          <button className={`chip ${ops.noise ? 'on' : ''}`} onClick={() => setOps((o) => ({ ...o, noise: !o.noise }))}>Sensor noise & flow fluctuation {ops.noise ? 'ON' : 'OFF'}</button>
        </div>
        <NumberField label="Random seed" value={ops.seed} step={1} onChange={(v) => setOps((o) => ({ ...o, seed: Math.max(1, Math.round(v)) }))} hint="same seed reproduces the run exactly" />
        <div className="note">Pump tolerance is drawn per run within its design band. The seed is applied on Reset.</div>
      </Card>
    </div>
  );
}

export function StructurePanel({ s, g, applied }) {
  if (!s) return null;
  const sup = s.supportStress / 1e6;
  const stk = s.stackStress / 1e6;
  const fat = s.fatigueDamage;
  const conv = CONVERTERS[applied.converter];
  return (
    <div className="two-col">
      <Card title="Vibration response" icon={Waves}>
        <div className="metric" style={{ fontSize: 40 }}>{fmt(s.grms, 1)}<span style={{ fontSize: 14, color: '#8a8a8a' }}>g rms</span></div>
        <table className="table" style={{ marginTop: 14 }}>
          <tbody>
            <tr><td>Stack natural frequency</td><td className="num">{fmt(s.fn, 0)} Hz</td></tr>
            <tr><td>Stack displacement rms</td><td className="num">{fmt(s.xMm * 1000, 2)} µm</td></tr>
            <tr><td>Fuel-section stress rms</td><td className="num">{fmt(stk, 3)} MPa</td></tr>
            <tr><td>Support stress rms</td><td className="num">{fmt(sup, 2)} MPa</td></tr>
          </tbody>
        </table>
      </Card>
      <Card title="Fatigue and converter limit" icon={Layers}>
        <div className="metric" style={{ fontSize: 40 }}>{sci(fat, 2)}</div>
        <p className="muted">Miner damage in the fuel supports (failure at 1)</p>
        <div className={`bar ${fat > 0.5 ? 'bad' : fat > 0.1 ? 'warn' : ''}`}><i style={{ width: `${Math.min(100, fat * 100)}%` }} /></div>
        <div className="note" style={{ marginTop: 12 }}>
          Converter {conv.name}: limit {conv.vibLimitG} g. Current {fmt(s.grms, 1)} g{s.converterFailed ? ' — FAILED' : ''}. Supports: {STRUCTURAL[applied.structure].name} (Basquin coefficients are estimates for this design).
        </div>
      </Card>
      <Card title="Brittle fracture" icon={AlertTriangle} full>
        <div className="note">
          {FUELS[applied.fuel].brittle ? 'The fuel is a brittle ceramic. Peak fracture rate uses the Gaussian exceedance formula with the fuel tensile strength (' + fmt(FUELS[applied.fuel].sigmaUlt / 1e6, 0) + ' MPa).' : 'The fuel is ductile in this model, so brittle fracture is not evaluated.'}
          {' '}Fuel-section stress: {fmt(stk, 4)} MPa rms.
        </div>
      </Card>
    </div>
  );
}

export function ScenarioPanel({ scenarioKey, setScenarioKey, run, result, ok, events }) {
  const sc = SCENARIOS[scenarioKey];
  return (
    <div className="two-col">
      <Card title="Scenario" icon={Play}>
        <Select label="Scenario" value={scenarioKey} options={Object.entries(SCENARIOS).map(([k, v]) => [k, v.label])} onChange={setScenarioKey} />
        <div className="note" style={{ marginBottom: 14 }}>{sc.description} Duration {sc.duration} s. Protection {sc.protection ? 'automatic' : 'disabled'}.</div>
        <button className="btn" onClick={run} disabled={!ok}><Play size={14} />Run scenario from hand-over</button>
        <p className="muted">Runs the scenario live with the same seeded random draws as the Monte Carlo batch.</p>
      </Card>
      <Card title="Result" icon={Check}>
        {!result && <div className="note">Run a scenario to see its outcome.</div>}
        {result && (
          <table className="table">
            <tbody>
              <tr><td>Outcome</td><td className="num">{outcomeLabel(result.outcome)}</td></tr>
              <tr><td>Destroy cause</td><td className="num">{result.destroyCause || '—'}</td></tr>
              <tr><td>Trip causes</td><td className="num">{result.tripCauses?.join(', ') || '—'}</td></tr>
              <tr><td>Peak fuel</td><td className="num">{K2C(result.maxTf)} °C</td></tr>
              <tr><td>Mean electric output</td><td className="num">{sci(result.meanElectricW, 3)} W</td></tr>
              <tr><td>Peak vibration</td><td className="num">{fmt(result.peakGrms, 1)} g rms</td></tr>
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Scenario event log" icon={Settings} full>
        <EventLog events={events} />
      </Card>
    </div>
  );
}

export function ReliabilityPanel({ mc }) {
  if (!mc) return <div className="note">Monte Carlo results not found. Run <code>npm run mc</code> to generate them.</div>;
  const pct = (w) => `${fmt(w.p * 100, 1)} % (95 % CI ${fmt(w.lo * 100, 1)}–${fmt(w.hi * 100, 1)})`;
  return (
    <div>
      <div className="note" style={{ marginBottom: 14 }}>
        Generated {mc.generatedAt?.slice(0, 16).replace('T', ' ')} UTC · {mc.N} seeded runs per scenario (seeds from {mc.seeds.scenarios}). Each run draws sensor noise, pump tolerance, event timing and severity. Intervals are Wilson 95 %.
      </div>
      <div className="two-col">
        {Object.entries(mc.scenarios).map(([key, r]) => (
          <Card key={key} title={r.scenario} icon={Activity}>
            <table className="table">
              <tbody>
                <tr><td>Outcomes</td><td className="num">{Object.entries(r.outcomes).map(([k, v]) => `${outcomeLabel(k)} ${v}`).join(' · ')}</td></tr>
                <tr><td>P(core destroyed)</td><td className="num">{pct(r.pDestroyed)}</td></tr>
                <tr><td>P(converter failed)</td><td className="num">{pct(r.pConverterFailed)}</td></tr>
                <tr><td>Mean electric output</td><td className="num">{sci(r.meanElectricW, 3)} ± {sci(r.sdElectricW, 2)} W</td></tr>
                <tr><td>Mean peak fuel</td><td className="num">{K2C(r.meanPeakTfK)} °C</td></tr>
                {Object.keys(r.destroyCauses).length > 0 && <tr><td>Destroy causes</td><td className="num">{Object.entries(r.destroyCauses).map(([k, v]) => `${k} ${v}`).join(' · ')}</td></tr>}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function MaterialPanel({ mc }) {
  if (!mc) return <div className="note">Material comparison not found. Run <code>npm run mc</code>.</div>;
  const cols = ['vibration', 'severeVibration', 'pumpTrip'];
  const names = { vibration: 'Vibration 3–10×', severeVibration: 'Severe vibration 30–100×', pumpTrip: 'Pump trip' };
  return (
    <div>
      <div className="note" style={{ marginBottom: 14 }}>
        Each material is run against the same random events ({mc.compareN} seeded runs per cell). Designs that break the can's pressure or envelope limits are shown as invalid rather than simulated.
      </div>
      <Card title="Failure probability by material" icon={Atom} full>
        <table className="table">
          <thead>
            <tr>
              <th>Variant</th>
              {cols.map((c) => <th key={c}>{names[c]}</th>)}
              <th className="num">Mean electric (nominal)</th>
            </tr>
          </thead>
          <tbody>
            {mc.compare.map((v) => (
              <tr key={v.label}>
                <td>{v.label}{!v.valid && <div className="note bad">Invalid: {v.violations[0]}</div>}</td>
                {v.valid
                  ? cols.map((c) => (
                    <td key={c}>
                      <div>P(destroyed) {fmt(v.byScenario[c].pDestroyed.p * 100, 0)} %</div>
                      <div className="note">P(conv. fail) {fmt(v.byScenario[c].pConverterFailed.p * 100, 0)} % · {sci(v.byScenario[c].meanElectricW, 2)} W</div>
                    </td>
                  ))
                  : cols.map((c) => <td key={c} className="note">—</td>)}
                <td className="num">{v.valid ? sci(v.byScenario.vibration.meanElectricW, 2) + ' W' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

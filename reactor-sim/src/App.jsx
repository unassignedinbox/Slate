// Coke-can reactor simulator: editor layout based on the Frontier editor (workspace grid, outliner,
// viewport, inspector, console). The physics runs in src/physics; this file wires it to the UI.
import { useMemo, useState, useCallback } from 'react';
import { mergeConfig, DEFAULT_CONFIG } from './physics/reactor.js';
import { LIBRARY } from './physics/materials.js';
import { SCENARIOS, scenarioById } from './physics/scenarios.js';
import { CAN } from './physics/geometry.js';
import { useSimulation } from './sim/useSimulation.js';
import Viewport3D from './ui/Viewport3D.jsx';
import { Field, Select, Switch, Readout, Card, Graph, fmt } from './ui/Controls.jsx';

const ROLE_LIB = {
  fuel: 'FUEL', cladding: 'CLADDING', moderator: 'MODERATOR', reflector: 'REFLECTOR', shield: 'SHIELD',
  coolant: 'COOLANT', structure: 'STRUCTURE', absorber: 'ABSORBER', te: 'THERMOELECTRIC',
};
const ROLE_LABEL = {
  fuel: 'Fuel', cladding: 'Cladding', moderator: 'Moderator', reflector: 'Reflector', shield: 'Radiation shield',
  coolant: 'Coolant', structure: 'Support mount / vessel', absorber: 'Control absorber', te: 'Thermoelectric legs',
};
const optionsFor = (role) => Object.values(LIBRARY[ROLE_LIB[role]]).map((m) => ({ value: m.id, label: m.label || m.id }));

function setPath(obj, path, value) {
  const [h, ...rest] = path;
  if (rest.length === 0) return { ...obj, [h]: value };
  return { ...obj, [h]: setPath(obj[h] ?? {}, rest, value) };
}

const EVENTS = [
  { id: 'pump_trip', label: 'Pump trip', ev: { type: 'pump_trip' } },
  { id: 'blk50', label: 'Blockage 50 %', ev: { type: 'blockage', value: 0.5 } },
  { id: 'blk90', label: 'Blockage 90 %', ev: { type: 'blockage', value: 0.9 } },
  { id: 'surge', label: 'Source surge x100, 30 s', ev: { type: 'source_surge', value: 100, duration: 30 } },
  { id: 'breach', label: 'Shield breach to 20 %', ev: { type: 'shield_breach', value: 0.2 } },
  { id: 'scram', label: 'Manual SCRAM', ev: { type: 'manual_scram' } },
  { id: 'kill', label: 'Core kill (manual)', ev: { type: 'manual_kill' } },
];

const SECTIONS = [
  { id: 'refl', label: 'Reflector' }, { id: 'shield', label: 'Radiation shield' },
  { id: 'coolant', label: 'Coolant plenum' }, { id: 'te', label: 'TE generator' },
  { id: 'can', label: 'Can envelope' },
];

export default function App() {
  const [draft, setDraft] = useState(() => mergeConfig({}));
  const [scenarioId, setScenarioId] = useState('nominal');
  const [resetKey, setResetKey] = useState(0);
  const [focus, setFocus] = useState('materials');
  const [showDose, setShowDose] = useState(true);
  const [exaggerate, setExaggerate] = useState(200);
  const [sectionsOn, setSectionsOn] = useState({ refl: true, shield: true, coolant: true, te: true, can: true });
  const [bottomTab, setBottomTab] = useState('graphs');

  const sim = useSimulation(draft, resetKey);
  const snap = sim.snapshot;
  const st = sim.reactor ? sim.reactor.state : null;
  const base = sim.reactor ? sim.reactor.base : null;

  const update = useCallback((path, value) => setDraft((d) => setPath(d, path, value)), []);
  const sectionsMemo = useMemo(() => sectionsOn, [sectionsOn]);

  const applyScenario = (id) => {
    const s = scenarioById(id);
    setScenarioId(id);
    setDraft(mergeConfig({ ...s.config }));
    setResetKey((k) => k + 1);
  };
  const reset = () => { setResetKey((k) => k + 1); sim.setRunning(false); };

  const state = !st ? 'INVALID' : st.destroyed ? 'DESTROYED' : st.scrammed ? 'SCRAMMED' : 'RUNNING';
  const stateClass = state.toLowerCase();
  const h = sim.history;
  const lastEvents = sim.reactor ? sim.reactor.cfg.events : [];
  const dims = `${CAN.D_mm.toFixed(1)} × ${CAN.H_mm.toFixed(1)} mm`;
  const scenario = scenarioById(scenarioId);

  const trips = st ? st.trips : [];
  const accidents = st ? st.accidents : [];

  return (
    <div className="workspace" style={{ '--left': '248px', '--right': '336px' }}>
      {/* ------------------------------------------------------------ outliner */}
      <aside className="dock left">
        <div className="outliner-heading">
          <h1>Reactor</h1>
          <small>{dims} · 355 mL can</small>
        </div>
        <div className="stats">
          <span className={'status-disc ' + stateClass}>{state}</span>
          <span className="muted-disc">{sim.simTime.toFixed(1)} s</span>
        </div>
        <div className="outliner-rows" role="tree" aria-label="Assembly outliner">
          {[
            ['materials', 'Fuel', draft.materials.fuel],
            ['materials', 'Cladding', draft.materials.cladding],
            ['materials', 'Moderator', draft.materials.moderator],
            ['materials', 'Reflector', draft.materials.reflector],
            ['materials', 'Radiation shield', draft.materials.shield],
            ['materials', 'Coolant', draft.materials.coolant],
            ['materials', 'Support / vessel', draft.materials.structure],
            ['materials', 'Control absorber', draft.materials.absorber],
            ['materials', 'Thermoelectric', draft.materials.te],
            ['geometry', 'Geometry', `${draft.geometry.shieldT} / ${draft.geometry.reflT} mm`],
            ['coolant', 'Coolant loop', `${draft.coolant.pMPa} MPa, ${draft.coolant.flowNominalGps} g/s`],
            ['noise', 'Instrument noise', `±${draft.noise.flowSensorNoisePct} % flow`],
            ['vibration', 'Vibration / mount', `${draft.vibration.profile}, d ${draft.support.dMm} mm`],
            ['source', 'Source & control', draft.source.kind === 'cf252' ? `${draft.source.ug} µg Cf-252` : `${draft.source.nps.toExponential(1)} n/s`],
            ['safety', 'Safety protocols', draft.safety.autoCoreKill ? 'auto core kill on' : 'auto core kill off'],
            ['events', 'Events & log', `${lastEvents.length} events · ${accidents.length} accidents`],
          ].map(([id, name, val]) => (
            <button key={name} className={'outliner-row' + (focus === id ? ' selected' : '')} role="treeitem"
              onClick={() => setFocus(id)} style={{ '--depth': 0, textAlign: 'left', background: 'none', border: 0, color: 'inherit', width: '100%' }}>
              <div className="row-identity"><span className="row-name">{name}</span></div>
              <small>{val}</small>
            </button>
          ))}
        </div>
        <footer className="outliner-footer">
          <span><b>Scenario</b> {scenario.name}</span>
        </footer>
      </aside>

      {/* ------------------------------------------------------------ centre */}
      <main className="centre">
        <div className="viewport-toolbar">
          <div className="viewport-heading-row">
            <div className="viewport-identity">
              <span className="viewport-preview-badge">3D</span>
              <b>Coke-can reactor</b>
            </div>
            <div className="viewport-modes" role="group" aria-label="Run controls">
              <button className={sim.running ? 'on' : ''} onClick={() => sim.setRunning(!sim.running)}>
                {sim.running ? 'Pause' : 'Run'}
              </button>
              <button onClick={() => sim.stepOnce()} disabled={sim.running}>Step</button>
              <button onClick={reset}>Reset</button>
              <select aria-label="Simulation speed" value={sim.speed} onChange={(e) => sim.setSpeed(+e.target.value)}>
                {[1, 10, 60, 300, 1800].map((s) => <option key={s} value={s}>{s}× real time</option>)}
              </select>
            </div>
          </div>
          <div className="viewport-action-row">
            <select aria-label="Scenario" value={scenarioId} onChange={(e) => applyScenario(e.target.value)}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="viewport-tool-divider" />
            <label className="viewport-setting-toggle"><input type="checkbox" checked={showDose} onChange={(e) => setShowDose(e.target.checked)} /> Dose field</label>
            <label className="viewport-setting-toggle">Vibration exaggeration
              <input type="range" min="0" max="2000" value={exaggerate} onChange={(e) => setExaggerate(+e.target.value)} /></label>
          </div>
        </div>

        <div className="viewport-stage">
          {sim.error ? (
            <div className="config-error" role="alert">
              <b>Configuration outside the validated model range</b>
              <p>{sim.error}</p>
              <p>The simulation is stopped. Choose a valid option in the Materials card (or change the stated parameter) to run again.</p>
            </div>
          ) : null}
          <Viewport3D base={base} snapshot={snap} showDose={showDose}
            exaggerate={exaggerate} sections={sectionsMemo} />
          <div className="viewport-overlay">
            {SECTIONS.map((s) => (
              <label key={s.id} className="viewport-setting-toggle">
                <input type="checkbox" checked={sectionsOn[s.id] !== false}
                  onChange={(e) => setSectionsOn((o) => ({ ...o, [s.id]: e.target.checked }))} /> {s.label}
              </label>
            ))}
          </div>
        </div>

        <div className="viewport-footer">
          <span>Power output <b>{snap ? fmt(snap.Pth) : '-'} W</b> (fission {snap ? fmt(snap.Pfis) : '-'} W)</span>
          <span>Electrical (TE) <b>{snap ? fmt(snap.Pe) : '-'} W</b></span>
          <span>Energy {snap ? fmt(snap.energyThJ) : '-'} J thermal</span>
          <span>Mass {snap ? snap.mass.toFixed(2) : '-'} kg</span>
          <span>Vibration exaggerated ×{exaggerate} for display</span>
        </div>

        <div className="bottom-tabs">
          {['graphs', 'readouts', 'log'].map((t) => (
            <button key={t} className={bottomTab === t ? 'on' : ''} onClick={() => setBottomTab(t)}>{t === 'graphs' ? 'Graphs' : t === 'readouts' ? 'Readouts' : 'Log'}</button>
          ))}
        </div>

        {bottomTab === 'graphs' && h.t.length > 1 ? (
          <div className="graph-grid">
            <Graph title="Fission and thermal power (log)" t={h.t} log series={[
              { name: 'fission', values: h.P, color: '#ffb36b' }, { name: 'thermal', values: h.Pth, color: '#ff6a3d', dash: '3 2' },
            ]} unit="W" />
            <Graph title="Coolant flow: true vs measured" t={h.t} series={[
              { name: 'true', values: h.flowTrue, color: '#9ec7ff' }, { name: 'meas (mean of 3)', values: h.flowMeas, color: '#ffffff', dash: '4 3' },
            ]} unit="g/s" />
            <Graph title="Temperatures" t={h.t} series={[
              { name: 'fuel max', values: h.Tf, color: '#ff8a5b' }, { name: 'cladding', values: h.Tcl, color: '#c5ced6' }, { name: 'coolant', values: h.Tb, color: '#5ea8ff' },
            ]} unit="°C" />
            <Graph title="Dose at can surface (log)" t={h.t} log series={[{ name: 'surface', values: h.dose, color: '#ffb020' }]} unit="µSv/h" />
          </div>
        ) : null}

        {bottomTab === 'readouts' && snap ? (
          <div className="readout-grid">
            <Readout label="Power output (thermal)" value={fmt(snap.Pth)} unit="W" />
            <Readout label="Electrical output (TE)" value={fmt(snap.Pe)} unit="W" />
            <Readout label="Energy produced (thermal)" value={fmt(snap.energyThJ)} unit="J" />
            <Readout label="Energy produced (electrical)" value={fmt(snap.energyEJ)} unit="J" />
            <Readout label="k_eff (rods as set)" value={snap.kEff.toFixed(4)} />
            <Readout label="Reactivity" value={fmt(snap.rho)} />
            <Readout label="Decay heat" value={fmt(snap.Pdec)} unit="W" />
            <Readout label="Fuel max" value={snap.TfMaxC.toFixed(2)} unit="°C" />
            <Readout label="Cladding max" value={snap.TcladMaxC.toFixed(2)} unit="°C" />
            <Readout label="Coolant bulk" value={snap.TbC.toFixed(3)} unit="°C" />
            <Readout label="Flow true" value={snap.flowTrueGps.toFixed(3)} unit="g/s" />
            <Readout label="Flow measured (sensor 1)" value={snap.flowMeasGps[0].toFixed(3)} unit="g/s" />
            <Readout label="Dose surface" value={fmt(snap.dose.surface)} unit="µSv/h" />
            <Readout label="Dose at 1 m" value={fmt(snap.dose.at1m)} unit="µSv/h" />
            <Readout label="Mount f_n" value={snap.vib.fn.toFixed(1)} unit="Hz" />
            <Readout label="Mount σ_rms" value={snap.vib.sigmaRmsMPa.toFixed(1)} unit="MPa" />
            <Readout label="Miner damage" value={fmt(snap.vib.damage)} />
            <Readout label="Mass total" value={snap.mass.toFixed(2)} unit="kg" />
          </div>
        ) : null}

        {bottomTab === 'log' ? (
          <div className="console">
            {trips.length === 0 && accidents.length === 0 ? <p>No trips or accidents.</p> : null}
            {trips.map((t, i) => <p key={'t' + i} className="log-trip">SCRAM {t.reason} at {t.t.toFixed(2)} s</p>)}
            {accidents.map((a, i) => <p key={'a' + i} className="log-acc">ACCIDENT {a.reason} at {a.t.toFixed(2)} s</p>)}
            {sim.reactor && sim.reactor.state.destroyed ? <p className="log-acc">Core destroyed and poisoned at {sim.reactor.state.tKill.toFixed(2)} s ({sim.reactor.state.killReason})</p> : null}
          </div>
        ) : null}
      </main>

      {/* ------------------------------------------------------------ inspector */}
      <aside className="dock right">
        <div className="inspector-scroll">
          <Card id="scenario" title="Scenario" focus={focus}>
            <p className="note">{scenario.name}</p>
            <div className="btn-row">
              <button onClick={() => applyScenario(scenarioId)}>Reload scenario</button>
              <button onClick={() => applyScenario('nominal')}>Nominal</button>
            </div>
          </Card>

          <Card id="materials" title="Materials (swappable)" focus={focus}>
            {Object.keys(ROLE_LABEL).map((role) => (
              <Select key={role} label={ROLE_LABEL[role]} value={draft.materials[role]}
                options={optionsFor(role)} onChange={(v) => update(['materials', role], v)} />
            ))}
            <p className="note">Options that the thermal model cannot represent (no moderation, or a supercritical rods-out state) are rejected with the reason shown above the viewport.</p>
          </Card>

          <Card id="geometry" title="Geometry and fuel" focus={focus}>
            <Field label="Radiation shield thickness" value={draft.geometry.shieldT} min={2} max={10} step={0.1} unit="mm" onChange={(v) => update(['geometry', 'shieldT'], v)} />
            <Field label="Reflector thickness" value={draft.geometry.reflT} min={2} max={8} step={0.1} unit="mm" onChange={(v) => update(['geometry', 'reflT'], v)} />
            <Field label="TE generator thickness" value={draft.geometry.teT} min={3} max={10} step={0.1} unit="mm" onChange={(v) => update(['geometry', 'teT'], v)} />
            <Field label="Vessel wall" value={draft.geometry.vesselT} min={0.5} max={2} step={0.05} unit="mm" onChange={(v) => update(['geometry', 'vesselT'], v)} />
            <Field label="U-235 enrichment" value={draft.enrichPct} min={0.7} max={19.75} step={0.05} unit="wt%" onChange={(v) => update(['enrichPct'], v)} />
          </Card>

          <Card id="coolant" title="Coolant loop" focus={focus}>
            <Field label="System pressure" value={draft.coolant.pMPa} min={0.1} max={16} step={0.1} unit="MPa" onChange={(v) => update(['coolant', 'pMPa'], v)} />
            <Field label="Nominal flow" value={draft.coolant.flowNominalGps} min={1} max={20} step={0.1} unit="g/s" onChange={(v) => update(['coolant', 'flowNominalGps'], v)} />
            <Field label="Ambient temperature" value={draft.coolant.ambientC} min={-20} max={50} step={0.5} unit="°C" onChange={(v) => update(['coolant', 'ambientC'], v)} />
            <Field label="Natural convection h (air)" value={draft.coolant.hAirNatural} min={2} max={50} step={0.5} unit="W/m²K" onChange={(v) => update(['coolant', 'hAirNatural'], v)} />
            <Switch label="Forced-air fan (×3 h)" value={draft.coolant.fan} onChange={(v) => update(['coolant', 'fan'], v)} />
          </Card>

          <Card id="noise" title="Instrument noise (real measurement error)" focus={focus}>
            <Field label="Pump pulsation (1σ)" value={draft.noise.pulsationPct} min={0} max={5} step={0.05} unit="%" onChange={(v) => update(['noise', 'pulsationPct'], v)} />
            <Field label="Pulsation clamp" value={draft.noise.clampPct} min={0} max={10} step={0.1} unit="%" onChange={(v) => update(['noise', 'clampPct'], v)} />
            <Field label="Flow sensor bias range" value={draft.noise.sensorBiasPct} min={0} max={3} step={0.05} unit="%" onChange={(v) => update(['noise', 'sensorBiasPct'], v)} />
            <Field label="Flow sensor noise (1σ)" value={draft.noise.flowSensorNoisePct} min={0} max={3} step={0.05} unit="%" onChange={(v) => update(['noise', 'flowSensorNoisePct'], v)} />
            <Field label="Power channel noise (1σ)" value={draft.noise.powerNoisePct} min={0} max={10} step={0.1} unit="%" onChange={(v) => update(['noise', 'powerNoisePct'], v)} />
            <Field label="Dosimeter noise (1σ)" value={draft.noise.dosimeterNoisePct} min={0} max={30} step={0.5} unit="%" onChange={(v) => update(['noise', 'dosimeterNoisePct'], v)} />
          </Card>

          <Card id="vibration" title="Vibration and mount" focus={focus}>
            <Select label="Vibration profile" value={draft.vibration.profile}
              options={[{ value: 'none', label: 'None' }, { value: 'seismic', label: 'Seismic' }, { value: 'truck', label: 'Truck (road)' }, { value: 'aircraft', label: 'Aircraft' }]}
              onChange={(v) => update(['vibration', 'profile'], v)} />
            <Field label="Vibration scale" value={draft.vibration.scale} min={0} max={5} step={0.05} unit="×" onChange={(v) => update(['vibration', 'scale'], v)} />
            <Field label="Mount diameter" value={draft.support.dMm} min={2} max={20} step={0.5} unit="mm" onChange={(v) => update(['support', 'dMm'], v)} />
            <Field label="Mount length" value={draft.support.LMm} min={5} max={40} step={0.5} unit="mm" onChange={(v) => update(['support', 'LMm'], v)} />
            <Switch label="Use material damping" value={draft.support.zeta === null} onChange={(v) => update(['support', 'zeta'], v ? null : 0.01)} />
            {draft.support.zeta !== null ? <Field label="Damping ratio ζ" value={draft.support.zeta} min={0.001} max={0.1} step={0.001} decimals={3} onChange={(v) => update(['support', 'zeta'], v)} /> : null}
          </Card>

          <Card id="source" title="Source and control" focus={focus}>
            <Select label="Neutron source" value={draft.source.kind}
              options={[{ value: 'cf252', label: 'Cf-252 start-up source' }, { value: 'nps', label: 'Neutron generator (n/s)' }]}
              onChange={(v) => update(['source', 'kind'], v)} />
            {draft.source.kind === 'cf252'
              ? <Field label="Cf-252 mass" value={draft.source.ug} min={1e-7} max={1e-2} log step={1e-7} decimals={7} unit="µg" onChange={(v) => update(['source', 'ug'], v)} />
              : <Field label="Generator output" value={draft.source.nps || 1} min={1} max={1e13} log step={1} decimals={1} unit="n/s" onChange={(v) => update(['source', 'nps'], v)} />}
            <Field label="Rods withdrawn" value={draft.control.rodsWithdrawn} min={0} max={1} step={0.01} unit="" onChange={(v) => update(['control', 'rodsWithdrawn'], v)} />
          </Card>

          <Card id="safety" title="Safety protocols" focus={focus}>
            <Switch label="Auto destroy and poison core on any accident" value={draft.safety.autoCoreKill} onChange={(v) => update(['safety', 'autoCoreKill'], v)} />
            <Switch label="SCRAM switches off generator (not Cf-252)" value={draft.safety.scramCutsGenerator} onChange={(v) => update(['safety', 'scramCutsGenerator'], v)} />
            <Select label="Trip voting" value={draft.safety.voting} options={[{ value: '2oo3', label: '2-out-of-3' }, { value: '1oo1', label: '1-out-of-1' }]} onChange={(v) => update(['safety', 'voting'], v)} />
            <Field label="Overpower trip (design power)" value={draft.safety.designPowerW} min={1e-9} max={1e3} log step={1e-9} decimals={9} unit="W" onChange={(v) => update(['safety', 'designPowerW'], v)} />
            <Field label="Surface dose limit" value={draft.safety.doseLimitSurfaceUSvh} min={0.1} max={1e4} log step={0.1} decimals={1} unit="µSv/h" onChange={(v) => update(['safety', 'doseLimitSurfaceUSvh'], v)} />
            <Field label="Low-flow trip" value={draft.safety.flowLowFrac} min={0.1} max={0.9} step={0.01} unit="× nom" onChange={(v) => update(['safety', 'flowLowFrac'], v)} />
            <Field label="Temperature trip margin" value={draft.safety.tripMarginK} min={0} max={50} step={0.5} unit="K" onChange={(v) => update(['safety', 'tripMarginK'], v)} />
            <Field label="Mount damage alarm" value={draft.safety.fatigueAlarm} min={0.05} max={1} step={0.01} unit="" onChange={(v) => update(['safety', 'fatigueAlarm'], v)} />
          </Card>

          <Card id="events" title="Events and operator actions" focus={focus}>
            <div className="btn-grid">
              {EVENTS.map((e) => (
                <button key={e.id} disabled={!sim.reactor} onClick={() => sim.inject(e.ev)}>{e.label}</button>
              ))}
            </div>
            <p className="note">Events apply at the current simulated time.</p>
            <h4>Trips</h4>
            {trips.length === 0 ? <p className="note">None</p> : trips.map((t, i) => <p key={i} className="log-trip">{t.reason} at {t.t.toFixed(1)} s</p>)}
            <h4>Accidents</h4>
            {accidents.length === 0 ? <p className="note">None</p> : accidents.map((a, i) => <p key={i} className="log-acc">{a.reason} at {a.t.toFixed(1)} s</p>)}
          </Card>
        </div>
        <footer className="inspector-footer">
          <small>Physics: four-factor k∞ with one-group grid diffusion for k_eff, six-group point kinetics, Way-Wigner decay heat, thermal network, Miles vibration with Basquin fatigue. Details in docs/.</small>
        </footer>
      </aside>
    </div>
  );
}

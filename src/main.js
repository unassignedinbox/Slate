import './style.css';

const app = document.querySelector('#app');

const APP_LIST = [
  { id: 'home', label: 'Home', short: 'OVERVIEW', icon: 'home' },
  { id: 'weather', label: 'Weather', short: 'CONDITIONS', icon: 'weather' },
  { id: 'setup', label: 'Suspension', short: 'CHASSIS', icon: 'setup' },
  { id: 'aero', label: 'Aerodynamics', short: 'AERO', icon: 'aero' },
  { id: 'tyres', label: 'Tyres', short: 'TYRES', icon: 'tyres' },
  { id: 'crew', label: 'Crew', short: 'MULTIPLAYER', icon: 'crew' },
  { id: 'wallet', label: 'Wallet', short: 'CREDITS', icon: 'wallet' },
  { id: 'store', label: 'Store', short: 'MARKETPLACE', icon: 'store' },
  { id: 'garage', label: 'Vehicle', short: 'GARAGE', icon: 'car' },
];

const ICONS = {
  home: '<path d="m3.5 10 8.5-7 8.5 7v9.2a1.3 1.3 0 0 1-1.3 1.3h-5.1v-6.1h-4.2v6.1H4.8a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M8.2 20.5h7.6"/>',
  weather: '<path d="M7.1 18.1h10.1a4.2 4.2 0 0 0 .1-8.4 6.2 6.2 0 0 0-11.6 1.8 3.4 3.4 0 0 0 1.4 6.6Z"/><path d="m8.2 21 1-1.8m3.3 1.8 1-1.8m3.3 1.8 1-1.8"/>',
  setup: '<path d="M12 3.2v3.1m0 11.4v3.1m8.8-8.8h-3.1M6.3 12H3.2m15-6.2-2.2 2.2M8 16l-2.2 2.2m12.4 0L16 16M8 8 5.8 5.8"/><circle cx="12" cy="12" r="4.1"/><circle cx="12" cy="12" r="1.1"/>',
  aero: '<path d="M3 8.1h12.7a2.9 2.9 0 1 0-2.8-3.6M3 12h17a2.7 2.7 0 1 1-2.6 3.5M3 16h9.1a2.5 2.5 0 1 1-2.4 3.2"/>',
  tyres: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.7"/><path d="m12 3.6 1.5 3.8m5-1.3-3 2.7m5 3.2-4 .5m1 5-3.6-1.7m-3.4 4.4.5-4m-5.6 1.3 2.8-3m-5.1-3 4-.7m-1.1-4.8 3.5 1.6"/>',
  crew: '<circle cx="9" cy="8" r="3.1"/><path d="M3.2 20a5.8 5.8 0 0 1 11.6 0m1.1-14a3 3 0 0 1 0 5.8m2.4 2.4a5.8 5.8 0 0 1 2.5 4.8"/>',
  wallet: '<rect x="3.2" y="5.2" width="17.6" height="14.5" rx="2.4"/><path d="M3.7 8.8h14.7a2.2 2.2 0 0 1 2.2 2.2v2.2h-4.2a2 2 0 0 1 0-4h4.2M16 11.9h.1"/>',
  store: '<path d="M4 10.2v9.3h16v-9.3M3 6.3l1.4-3h15.2l1.4 3v1.1a2.4 2.4 0 0 1-4.7.6 2.4 2.4 0 0 1-4.7 0 2.4 2.4 0 0 1-4.7 0A2.4 2.4 0 0 1 3 7.4z"/><path d="M8 19.4v-5.7h4.5v5.7"/>',
  car: '<path d="m4.2 14.8 1.5-5.1A2.7 2.7 0 0 1 8.3 7.8h7.4a2.7 2.7 0 0 1 2.6 1.9l1.5 5.1v3.4h-2.2v-1.7H6.4v1.7H4.2z"/><path d="M5.1 13.1h13.8M7.2 10.8h.1m9.4 0h.1"/><circle cx="7.8" cy="14.9" r=".9"/><circle cx="16.2" cy="14.9" r=".9"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  pin: '<path d="M19 10.2c0 5.1-7 10.2-7 10.2S5 15.3 5 10.2a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/>',
  signal: '<path d="M3 9.8a13.7 13.7 0 0 1 18 0M6.2 13a8.8 8.8 0 0 1 11.6 0M9.5 16.3a3.8 3.8 0 0 1 5 0M12 20h.01"/>',
  bolt: '<path d="m13.4 2.7-9 11h6l-.8 7.6 9-11h-6z"/>',
  droplets: '<path d="M12 3.2S6.6 9.5 6.6 13.8a5.4 5.4 0 0 0 10.8 0C17.4 9.5 12 3.2 12 3.2Z"/><path d="M9.3 14.2a2.8 2.8 0 0 0 2.7 2.7"/>',
  pressure: '<circle cx="12" cy="12" r="8.6"/><path d="m12 12 4-4m-4-1v1m-5 4h1m9 0h1M8.5 17a5 5 0 0 1 7 0"/>',
  trophy: '<path d="M8 4h8v5.3a4 4 0 0 1-8 0zM8 6H4.2v2a3.8 3.8 0 0 0 3.9 3.8m7.9-5.8h3.8v2a3.8 3.8 0 0 1-3.9 3.8M12 13.5v4.2m-4 2.1h8m-6-2.1h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.7v2m0 14.6v2m9.3-9.3h-2M4.7 12h-2m15.9-6.6-1.4 1.4M6.8 17.2l-1.4 1.4m13.2 0-1.4-1.4M6.8 6.8 5.4 5.4"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.6 2.2"/>',
  crown: '<path d="m3 8 4.2 3 4.8-6 4.8 6L21 8l-1.7 11H4.7zM6 16h12"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sound: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M17 9a4.2 4.2 0 0 1 0 6m2.8-8.8a8 8 0 0 1 0 11.6"/>',
  edit: '<path d="m14.5 6.5 3 3m-12 8.3 3.8-.8L19 7.3a2.1 2.1 0 0 0-3-3l-9.7 9.7zM5.5 20h13"/>',
};

function icon(name, size = 20, extra = '') {
  return `<svg class="icon ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`;
}

const defaultState = {
  activeApp: 'home',
  mode: 'console',
  credits: 42850,
  setup: { frontRide: 62, rearRide: 68, springRate: 7.2, rebound: 56, preset: 'ATTACK' },
  aero: { balance: 54, drs: true, preset: 'BALANCED' },
  tyres: { compound: 'SOFT', pressure: 24.2 },
  weather: { hour: 'NOW', preset: 'MIST' },
  owned: ['factory'],
  equipped: 'factory',
  joined: false,
  invited: [],
  pitRequested: false,
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('apex-hmi-prototype') || '{}');
    return {
      ...defaultState,
      ...saved,
      setup: { ...defaultState.setup, ...saved.setup },
      aero: { ...defaultState.aero, ...saved.aero },
      tyres: { ...defaultState.tyres, ...saved.tyres },
      weather: { ...defaultState.weather, ...saved.weather },
      owned: Array.isArray(saved.owned) ? saved.owned : defaultState.owned,
      invited: Array.isArray(saved.invited) ? saved.invited : [],
    };
  } catch {
    return structuredClone(defaultState);
  }
}

const state = loadState();
let sceneController = null;
let sceneRevision = 0;
let currentToastTimer = null;

const money = (amount) => new Intl.NumberFormat('en-US').format(amount);
const appMeta = (id) => APP_LIST.find((item) => item.id === id) || APP_LIST[0];
const persist = () => localStorage.setItem('apex-hmi-prototype', JSON.stringify(state));

function notify(message, kind = 'success') {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.innerHTML = `${icon(kind === 'error' ? 'close' : 'check', 17)}<span>${message}</span>`;
  app.appendChild(toast);
  window.clearTimeout(currentToastTimer);
  currentToastTimer = window.setTimeout(() => toast.remove(), 2500);
}

function renderHeader() {
  return `
    <header class="topbar">
      <button class="brand-lockup" data-action="app" data-app="home" aria-label="APEX home">
        <span class="brand-emblem"><svg viewBox="0 0 34 34" aria-hidden="true"><path d="M17 3 31 29H3L17 3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m17 11 8.5 15h-17z" fill="currentColor"/><path d="M13.2 22.5h7.6" stroke="#121719" stroke-width="1.5"/></svg></span>
        <span class="brand-wordmark"><b>APEX</b><small>MOTORSPORT OS</small></span>
      </button>
      <div class="topbar-center">
        <span class="season-mark">S07</span>
        <span class="topbar-separator"></span>
        <span class="top-track">${icon('pin', 15)} <span>KYOTO RING</span></span>
        <span class="topbar-separator"></span>
        <span class="top-condition">${icon('sun', 15)} <span>22°</span><i>DRY</i></span>
      </div>
      <div class="topbar-right">
        <button class="online-indicator" data-action="app" data-app="crew" aria-label="View online crew"><span class="online-pulse"></span><span>04 <small>ONLINE</small></span></button>
        <span class="topbar-separator"></span>
        <button class="currency-pill" data-action="app" data-app="wallet" aria-label="Open wallet"><span class="currency-symbol">C</span><span><small>APEX CREDITS</small><b>${money(state.credits)}</b></span></button>
        <span class="topbar-separator mode-divider"></span>
        <div class="mode-switch" role="group" aria-label="Display mode">
          <button class="mode-button ${state.mode === 'console' ? 'is-active' : ''}" data-action="mode" data-mode="console">${icon('grid', 14)}<span>CONSOLE</span></button>
          <button class="mode-button ${state.mode === 'hud' ? 'is-active' : ''}" data-action="mode" data-mode="hud">${icon('signal', 14)}<span>RACE HUD</span></button>
        </div>
        <button class="driver-avatar" data-action="app" data-app="crew" aria-label="Driver profile">LX</button>
      </div>
    </header>`;
}

function renderRail() {
  return `
    <aside class="app-rail" aria-label="Vehicle apps">
      <div class="rail-label">APPS</div>
      ${APP_LIST.map((item) => `
        <button class="rail-item ${state.activeApp === item.id && state.mode === 'console' ? 'is-active' : ''}" data-action="app" data-app="${item.id}" title="${item.label}" aria-label="Open ${item.label}">
          <span class="rail-icon">${icon(item.icon, 20)}</span><span class="rail-text">${item.label}</span>
          ${state.activeApp === item.id && state.mode === 'console' ? '<span class="rail-active-mark"></span>' : ''}
        </button>`).join('')}
      <div class="rail-bottom"><span class="rail-online"><i></i> LIVE</span><span class="rail-version">OS 07.4</span></div>
    </aside>`;
}

function renderShell() {
  const active = appMeta(state.activeApp);
  return `
    <div class="shell ${state.mode === 'hud' ? 'hud-mode' : 'console-mode'}">
      ${renderHeader()}
      ${state.mode === 'console' ? renderRail() : ''}
      <main class="main-screen" aria-label="${state.mode === 'hud' ? 'Race HUD preview' : active.label + ' application'}">
        ${state.mode === 'hud' ? renderHud() : renderActiveApp()}
      </main>
      ${state.mode === 'console' ? '<div class="screen-footnote"><span>APEX VEHICLE INTERFACE</span><span>BUILD 07.4.19 <i>●</i> ALL SYSTEMS NOMINAL</span></div>' : ''}
    </div>`;
}

function renderActiveApp() {
  switch (state.activeApp) {
    case 'weather': return renderWeather();
    case 'setup': return renderSuspension();
    case 'aero': return renderAero();
    case 'tyres': return renderTyres();
    case 'crew': return renderCrew();
    case 'wallet': return renderWallet();
    case 'store': return renderStore();
    case 'garage': return renderGarage();
    default: return renderHome();
  }
}

function renderHome() {
  const appTiles = ['weather', 'setup', 'aero', 'tyres', 'crew', 'wallet', 'store', 'garage'];
  return `
    <div class="home-view">
      <section class="home-left-column">
        <article class="hero-card">
          <div class="hero-grain"></div><div class="hero-radial"></div>
          <div class="hero-topline"><span class="eyebrow"><i class="eyebrow-dot"></i> PRIVATE PADDOCK <b>/ 01</b></span><span class="hero-edition">DRIVER PROFILE <b>02 — LEX</b></span></div>
          <div class="hero-copy">
            <span class="hero-kicker">YOUR MACHINE. YOUR RULES.</span>
            <h1>FIND YOUR<br><em>FAST.</em></h1>
            <p>Dial in every detail. Then take it<br class="desktop-break"> to the edge.</p>
            <div class="hero-car-name"><span>01</span><div><b>VANTA R-01</b><small>HYPER GT // 2025</small></div></div>
            <div class="hero-actions"><button class="button button-primary" data-action="app" data-app="garage">ENTER GARAGE ${icon('arrow', 16)}</button><button class="button button-quiet" data-action="app" data-app="setup">TUNE SETUP</button></div>
          </div>
          <div class="hero-model" data-scene="car" data-variant="hero" aria-label="Interactive three dimensional Vanta R-01 vehicle model"><div class="model-canvas"></div>
            <div class="hero-model-tag"><span class="tag-line"></span><span><b>VANTA / R-01</b><small>ALL-WHEEL DRIVE <i>·</i> HYBRID V8</small></span></div>
            <div class="hero-speed-tag"><span>MAX OUTPUT</span><b>1,080 <small>HP</small></b><i>↗</i></div>
            <div class="model-interaction-hint">${icon('edit', 13)} DRAG TO ROTATE</div>
          </div>
          <div class="hero-bottom-line"><span>APEX WORKS <b>—</b> MOTORI LAB</span><span>CHASSIS <b>01 / 08</b></span><span class="hero-live"><i></i> LIVE CONFIGURATION</span></div>
        </article>
        <div class="home-metrics">
          <div class="home-metric"><span class="metric-label">POWERTRAIN</span><b>HYBRID V8</b><small>1,080 <i>HP</i> / AWD</small></div>
          <div class="home-metric"><span class="metric-label">0—100 KM/H</span><b>2.4 <small>SEC</small></b><small>LAUNCH CONTROL <i>READY</i></small></div>
          <div class="home-metric"><span class="metric-label">DRIVER RATING</span><b>PLATINUM <span class="rating-star">✦</span></b><small>TOP 2.1% <i>GLOBAL</i></small></div>
          <button class="track-mini-card" data-action="app" data-app="weather"><span class="track-mini-art"><i></i><i></i><i></i></span><span class="track-mini-copy"><small>NEXT SESSION</small><b>KYOTO RING</b><em>08 MIN <span>•</span> DRY ASPHALT</em></span>${icon('chevron', 17)}</button>
        </div>
      </section>
      <aside class="launcher-panel">
        <div class="launcher-heading"><div><span class="eyebrow">VEHICLE SYSTEMS</span><h2>YOUR APPS<span class="launcher-count">08</span></h2></div><button class="launcher-menu" aria-label="App menu">${icon('grid', 17)}</button></div>
        <p class="launcher-subtitle">Everything you need, one touch away.</p>
        <div class="app-launcher-grid">${appTiles.map((id, index) => {
          const item = appMeta(id);
          return `<button class="launcher-tile tile-${id}" data-action="app" data-app="${id}"><span class="app-glyph glyph-${id}">${icon(item.icon, 21)}</span><span class="launcher-tile-copy"><b>${item.label}</b><small>${tileSubline(id)}</small></span><span class="tile-index">0${index + 1}</span></button>`;
        }).join('')}</div>
        <div class="launcher-divider"></div>
        <div class="paddock-card">
          <div class="paddock-top"><span class="live-pip"></span><span>APEX NETWORK</span><b>CONNECTED</b></div>
          <div class="paddock-players"><div class="avatar-stack"><span>MK</span><span>NV</span><span>+2</span></div><div><b>3 friends on track</b><small>Join a lobby or send a challenge.</small></div><button data-action="app" data-app="crew" aria-label="Open crew">${icon('arrow', 16)}</button></div>
        </div>
        <div class="launcher-foot"><span>${icon('signal', 13)} SYNCED ACROSS DEVICES</span><span>››</span></div>
      </aside>
    </div>`;
}

function tileSubline(id) {
  const lines = {
    weather: 'Track & forecast', setup: 'Ride • dampers', aero: 'Downforce • DRS', tyres: 'Compound • temps',
    crew: 'Friends • lobbies', wallet: 'Credits • rewards', store: 'Looks • upgrades', garage: 'Vehicle • specs',
  };
  return lines[id] || 'Open app';
}

function appIntro({ kicker, title, subtitle, badge = 'SYSTEM READY', badgeIcon = 'signal', number = '01' }) {
  return `
    <div class="app-intro">
      <div class="app-intro-left"><div class="breadcrumb"><span>APEX OS</span>${icon('chevron', 13)}<span>${kicker}</span></div><div class="title-row"><span class="title-number">${number}</span><h1>${title}</h1></div><p>${subtitle}</p></div>
      <div class="app-intro-badge"><span class="badge-check">${icon(badgeIcon, 14)}</span><span><b>${badge}</b><small>VANTA R-01 <i>·</i> SESSION 04</small></span></div>
    </div>`;
}

function viewer(scene, label, sublabel, className = '') {
  return `<div class="model-panel ${className}" data-scene="${scene}" aria-label="Interactive three dimensional ${label}"><div class="model-canvas"></div><div class="model-panel-meta"><span><i class="model-live-dot"></i> ${label}</span><span>${sublabel}</span></div><div class="model-axes"><span>X</span><span>Y</span><span>Z</span></div><div class="model-orbit-hint">DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM</div></div>`;
}

function smallMetric(label, value, note, iconName = 'bolt') {
  return `<div class="small-metric"><span class="small-metric-icon">${icon(iconName, 15)}</span><span class="small-metric-copy"><small>${label}</small><b>${value}</b><em>${note}</em></span></div>`;
}

function rangeControl({ key, label, value, min, max, step = 1, unit = '', note = '', accent = '' }) {
  const output = `${value}${unit}`;
  const progress = ((Number(value) - Number(min)) / (Number(max) - Number(min))) * 100;
  return `<label class="range-control ${accent}"><span class="range-label-row"><span>${label}<small>${note}</small></span><output id="out-${key}">${output}</output></span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="--range-progress:${progress}%" data-range="${key}" aria-label="${label}"><span class="range-scale"><small>${min}${unit}</small><small>${max}${unit}</small></span></label>`;
}

function renderSuspension() {
  const s = state.setup;
  return `<section class="app-view suspension-view">
    ${appIntro({ kicker: 'CHASSIS / SUSPENSION', title: 'SUSPENSION', number: '02', subtitle: 'Make the platform work for you. Set your ride height, spring rate and damping live.', badge: 'SETUP SAVED', badgeIcon: 'check' })}
    <div class="workbench-grid">
      <div class="workbench-main">
        ${viewer('suspension', 'FRONT LEFT CORNER', 'DOUBLE WISHBONE / 3D ASSEMBLY', 'suspension-model')}
        <div class="metric-strip">
          ${smallMetric('FRONT RIDE HEIGHT', `${s.frontRide} <small>MM</small>`, 'TARGET / LOW', 'setup')}
          ${smallMetric('SPRING RATE', `${s.springRate.toFixed(1)} <small>KG/MM</small>`, 'STIFFNESS / +0.4', 'bolt')}
          ${smallMetric('LATERAL LOAD', '1.62 <small>G</small>', 'LIVE SIMULATION', 'pressure')}
        </div>
      </div>
      <aside class="control-card setup-controls">
        <div class="control-card-head"><div><span class="eyebrow">GARAGE TUNING</span><h2>CHASSIS SETUP</h2></div><span class="saved-indicator">${icon('check', 13)} AUTO-SAVED</span></div>
        <div class="preset-block"><div class="section-caption"><span>PRESET</span><small>QUICK START</small></div><div class="preset-buttons">${['ATTACK', 'BALANCED', 'WET'].map((preset) => `<button class="preset-button ${s.preset === preset ? 'is-selected' : ''}" data-action="setup-preset" data-value="${preset}">${preset}</button>`).join('')}</div></div>
        <div class="control-section-title"><span>FRONT AXLE</span><span class="control-section-line"></span>${icon('car', 16)}</div>
        ${rangeControl({ key: 'frontRide', label: 'RIDE HEIGHT', note: 'GROUND CLEARANCE', value: s.frontRide, min: 45, max: 90, unit: ' mm' })}
        ${rangeControl({ key: 'springRate', label: 'SPRING RATE', note: 'STIFFNESS', value: s.springRate, min: 4, max: 12, step: 0.1, unit: ' kg/mm' })}
        <div class="control-section-title rear-title"><span>REAR AXLE</span><span class="control-section-line"></span>${icon('car', 16)}</div>
        ${rangeControl({ key: 'rearRide', label: 'RIDE HEIGHT', note: `RAKE +${s.rearRide - s.frontRide} MM`, value: s.rearRide, min: 48, max: 96, unit: ' mm' })}
        ${rangeControl({ key: 'rebound', label: 'REBOUND DAMPING', note: 'FRONT / REAR LINKED', value: s.rebound, min: 20, max: 90, unit: '%' })}
        <div class="setup-footnote"><span>${icon('bolt', 14)} <b>SIMULATION ACTIVE</b></span><span>CHANGES APPLY IN GARAGE</span></div>
      </aside>
    </div>
  </section>`;
}

function renderAero() {
  const a = state.aero;
  const downforce = Math.round(515 + (a.balance - 40) * 7 + (a.drs ? -38 : 0));
  return `<section class="app-view aero-view">
    ${appIntro({ kicker: 'VEHICLE DYNAMICS / AERO', title: 'AERODYNAMICS', number: '03', subtitle: 'Shape the air. Balance high-speed stability with straight-line efficiency.', badge: 'CFD LIVE', badgeIcon: 'signal' })}
    <div class="workbench-grid aero-workbench">
      <div class="workbench-main">
        <div class="model-panel aero-model" data-scene="aero" aria-label="Interactive aerodynamic vehicle model with airflow visualization"><div class="model-canvas"></div><div class="model-panel-meta"><span><i class="model-live-dot"></i> VANTA R-01 / CFD VIEW</span><span>DRAG COEFFICIENT <b>0.28</b></span></div><div class="airflow-legend"><i></i> FLOW VECTORS <span>LOW</span><span>HIGH</span></div><div class="model-orbit-hint">DRAG TO ORBIT <span>·</span> AIRFLOW SIMULATION</div></div>
        <div class="metric-strip aero-metrics">
          ${smallMetric('REAR DOWNFORCE', `${downforce} <small>KG</small>`, a.drs ? 'DRS OPEN / LOW DRAG' : 'DRS CLOSED / MAX GRIP', 'aero')}
          ${smallMetric('AERO BALANCE', `${a.balance} <small>%</small>`, 'FRONT / REAR DISTRIBUTION', 'pressure')}
          ${smallMetric('TOP SPEED', a.drs ? '342 <small>KM/H</small>' : '326 <small>KM/H</small>', 'SIMULATED / DRS ASSIST', 'bolt')}
        </div>
      </div>
      <aside class="control-card aero-controls">
        <div class="control-card-head"><div><span class="eyebrow">ACTIVE AERO</span><h2>DOWNFORCE</h2></div><span class="aero-live-pill"><i></i> LIVE</span></div>
        <div class="drs-card"><div class="drs-copy"><span class="drs-icon">${icon('aero', 20)}</span><div><b>DRAG REDUCTION</b><small>REAR WING FLAP / DRS</small></div></div><button class="toggle-switch ${a.drs ? 'is-on' : ''}" data-action="drs-toggle" role="switch" aria-checked="${a.drs}" aria-label="Toggle drag reduction system"><span></span></button><span class="drs-state">${a.drs ? 'OPEN' : 'CLOSED'}</span></div>
        <div class="aero-graph-card"><div class="graph-heading"><span>DOWNFORCE CURVE</span><small>KG <i>·</i> SPEED</small></div><div class="graph-main"><div class="graph-y-labels"><span>800</span><span>400</span><span>0</span></div><svg viewBox="0 0 330 120" preserveAspectRatio="none" class="downforce-graph" role="img" aria-label="Downforce increases with speed"><defs><linearGradient id="graphFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4ff34" stop-opacity=".2"/><stop offset="1" stop-color="#d4ff34" stop-opacity="0"/></linearGradient></defs><path class="graph-grid-line" d="M0 27H330M0 62H330M0 97H330"/><path class="graph-area" d="M0 101 C48 97 51 85 92 81 S149 66 183 57 S234 41 264 32 S307 19 330 11 V120H0Z"/><path class="graph-line" d="M0 101 C48 97 51 85 92 81 S149 66 183 57 S234 41 264 32 S307 19 330 11"/><circle cx="264" cy="32" r="4" class="graph-point"/></svg></div><div class="graph-x-labels"><span>0</span><span>100</span><span>200</span><span>300 KM/H</span></div></div>
        <div class="section-caption aero-preset-caption"><span>AERO MAP</span><small>SELECT PROFILE</small></div><div class="aero-maps">${['BALANCED', 'HIGH DOWNFORCE', 'LOW DRAG'].map((preset, i) => `<button class="aero-map-chip ${a.preset === preset ? 'is-selected' : ''}" data-action="aero-preset" data-value="${preset}"><i class="map-mini map-mini-${i}"></i><span>${preset}</span></button>`).join('')}</div>
        ${rangeControl({ key: 'aeroBalance', label: 'AERO BALANCE', note: 'FRONT AXLE BIAS', value: a.balance, min: 40, max: 70, unit: '%' })}
        <div class="aero-warning">${icon('bolt', 14)} <span>DRS DISENGAGES AUTOMATICALLY UNDER BRAKING.</span></div>
      </aside>
    </div>
  </section>`;
}

function renderTyres() {
  const t = state.tyres;
  const compounds = [
    { id: 'SOFT', name: 'SOFT', code: 'C5', desc: 'MAXIMUM GRIP', tone: 'soft' },
    { id: 'MEDIUM', name: 'MEDIUM', code: 'C3', desc: 'BALANCED', tone: 'medium' },
    { id: 'HARD', name: 'HARD', code: 'C1', desc: 'LONG STINT', tone: 'hard' },
    { id: 'WET', name: 'INTERMEDIATE', code: 'INT', desc: 'DAMP TRACK', tone: 'wet' },
  ];
  const temperatures = [
    { corner: 'FRONT LEFT', short: 'FL', temp: 91, pressure: t.pressure },
    { corner: 'FRONT RIGHT', short: 'FR', temp: 88, pressure: t.pressure + 0.2 },
    { corner: 'REAR LEFT', short: 'RL', temp: 94, pressure: t.pressure + 0.3 },
    { corner: 'REAR RIGHT', short: 'RR', temp: 92, pressure: t.pressure + 0.1 },
  ];
  return `<section class="app-view tyres-view">
    ${appIntro({ kicker: 'VEHICLE DYNAMICS / TYRES', title: 'TYRE MANAGEMENT', number: '04', subtitle: 'Read the contact patch. Choose your compound and bring every corner into its window.', badge: 'PRESSURES OPTIMAL', badgeIcon: 'check' })}
    <div class="tyres-layout">
      <div class="tyre-left-column">
        <div class="tyre-stage-card"><div class="tyre-stage-copy"><span class="eyebrow">LIVE TELEMETRY / ${t.compound} COMPOUND</span><h2>THE ONLY<br>THING THAT<br><em>TOUCHES.</em></h2><p>Keep your temperature and pressure balanced to unlock consistent grip.</p><span class="tyre-temp-chip"><i class="temp-dot"></i> OPERATING WINDOW <b>80 — 105° C</b></span></div>${viewer('tyre', 'RACE SPEC / 305-680R18', `${t.compound} COMPOUND / 3D`, 'tyre-model')}</div>
        <div class="corner-grid">${temperatures.map((wheel, i) => `<div class="corner-card"><div class="corner-head"><span class="corner-wheel corner-${i}">${wheel.short}</span><span>${wheel.corner}</span><i class="corner-status"></i></div><div class="corner-data"><b>${wheel.temp}<small>°C</small></b><span>${(wheel.pressure).toFixed(1)} <small>PSI</small></span></div><div class="temp-track"><i style="--temp:${Math.min(100, Math.max(2, (wheel.temp - 40) * 1.4))}%"></i></div></div>`).join('')}</div>
      </div>
      <aside class="control-card tyre-controls">
        <div class="control-card-head"><div><span class="eyebrow">COMPOUND SELECTION</span><h2>RACE COMPOUND</h2></div><span class="sets-count">SET 01 <i>/ 04</i></span></div>
        <div class="compound-list">${compounds.map((compound) => `<button class="compound-option ${compound.tone} ${t.compound === compound.id ? 'is-selected' : ''}" data-action="compound" data-value="${compound.id}"><span class="compound-mark"></span><span class="compound-copy"><b>${compound.name}</b><small>${compound.desc}</small></span><span class="compound-code">${compound.code}</span><span class="compound-check">${t.compound === compound.id ? icon('check', 14) : ''}</span></button>`).join('')}</div>
        <div class="control-section-title pressure-title"><span>PRESSURE TARGET</span><span class="control-section-line"></span>${icon('pressure', 16)}</div>
        ${rangeControl({ key: 'tyrePressure', label: 'COLD PRESSURE', note: 'ALL FOUR CORNERS', value: t.pressure, min: 20, max: 30, step: 0.1, unit: ' PSI' })}
        <div class="tyre-advice"><span class="advice-icon">${icon('bolt', 15)}</span><div><b>ENGINEER NOTE</b><p>${t.compound === 'WET' ? 'Intermediates selected. Watch standing water as the track dries.' : `${t.compound.toLowerCase()}s will reach peak grip in approximately 2 laps.`}</p></div></div>
        <button class="button button-secondary full-width" data-action="app" data-app="weather">CHECK TRACK CONDITIONS ${icon('arrow', 15)}</button>
      </aside>
    </div>
  </section>`;
}

function renderWeather() {
  const forecasts = [
    { id: 'NOW', time: 'NOW', value: '22°', condition: 'MIST', iconName: 'sun', rain: '06%' },
    { id: '18:00', time: '18:00', value: '20°', condition: 'LIGHT RAIN', iconName: 'weather', rain: '38%' },
    { id: '19:00', time: '19:00', value: '18°', condition: 'RAIN', iconName: 'weather', rain: '72%' },
    { id: '20:00', time: '20:00', value: '19°', condition: 'CLEARING', iconName: 'sun', rain: '12%' },
  ];
  const selected = forecasts.find((forecast) => forecast.id === state.weather.hour) || forecasts[0];
  const grip = selected.id === '19:00' ? 69 : selected.id === '18:00' ? 82 : selected.id === '20:00' ? 91 : 96;
  return `<section class="app-view weather-view">
    ${appIntro({ kicker: 'TRACK INTELLIGENCE / WEATHER', title: 'TRACK CONDITIONS', number: '01', subtitle: 'Live circuit telemetry and a four-hour forecast. Plan the stint before the clouds arrive.', badge: 'TRACK FEED LIVE', badgeIcon: 'signal' })}
    <div class="weather-layout">
      <div class="weather-main-column">
        <div class="track-map-card"><div class="track-map-top"><div><span class="eyebrow">CIRCUIT PROFILE / 4.8 KM</span><h2>KYOTO RING <span>JAPAN</span></h2></div><button class="map-layer-button">${icon('grid', 15)} TRACK MAP</button></div>
          <div class="track-map-visual"><div class="map-coordinate map-coordinate-a">35°01' N</div><div class="map-coordinate map-coordinate-b">135°45' E</div><svg class="circuit-map" viewBox="0 0 800 380" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Kyoto Ring circuit map"><defs><filter id="mapGlow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="circuitLine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d3ff35"/><stop offset="1" stop-color="#a7d938"/></linearGradient></defs><path class="circuit-shadow" d="M122 256 95 206 101 148 148 116 202 124 232 89 302 77 357 111 431 95 482 120 533 84 603 104 661 145 666 204 619 239 603 293 547 318 476 291 419 315 351 297 307 325 239 298 196 327 150 298Z"/><path class="circuit-underlay" d="M122 256 95 206 101 148 148 116 202 124 232 89 302 77 357 111 431 95 482 120 533 84 603 104 661 145 666 204 619 239 603 293 547 318 476 291 419 315 351 297 307 325 239 298 196 327 150 298Z"/><path class="circuit-line" d="M122 256 95 206 101 148 148 116 202 124 232 89 302 77 357 111 431 95 482 120 533 84 603 104 661 145 666 204 619 239 603 293 547 318 476 291 419 315 351 297 307 325 239 298 196 327 150 298Z"/><path class="sector-line" d="M201 124 196 327m236-232-16 220m202-211 24 189"/><circle class="track-start" cx="122" cy="256" r="7"/><circle class="track-pulse" cx="122" cy="256" r="15"/><path class="car-marker" d="m136 238 8 14-15 1z"/><text x="118" y="278" class="map-label">START / FINISH</text><text x="253" y="177" class="map-sector-label">SECTOR 01</text><text x="440" y="205" class="map-sector-label">SECTOR 02</text><text x="567" y="264" class="map-sector-label">SECTOR 03</text></svg><div class="map-weather-pill">${icon(state.weather.hour === '19:00' || state.weather.hour === '18:00' ? 'weather' : 'sun', 15)}<span>${selected.condition}</span><b>${selected.rain} RAIN</b></div><div class="map-scale"><span>0</span><i></i><span>500 M</span></div></div>
          <div class="track-map-footer"><span><i class="map-legend-dot"></i> LIVE TELEMETRY</span><span>LAST UPDATE <b>12 SEC AGO</b></span><span>WIND <b>NE / 8 KM/H</b></span></div>
        </div>
        <div class="weather-conditions-row"><div class="condition-card main-condition-card"><span class="condition-symbol">${icon(selected.id === '18:00' || selected.id === '19:00' ? 'weather' : 'sun', 25)}</span><span><small>TRACK NOW</small><b>${selected.value} <em>${selected.condition}</em></b></span><span class="condition-divider"></span><span class="condition-detail"><small>ASPHALT</small><b>${selected.id === '19:00' ? 'WET' : selected.id === '18:00' ? 'DAMP' : 'DRY'} <i>28°</i></b></span></div><div class="condition-card"><span class="condition-symbol wind-symbol">${icon('aero', 22)}</span><span><small>WIND</small><b>NE <em>8 KM/H</em></b></span></div><div class="condition-card"><span class="condition-symbol">${icon('droplets', 22)}</span><span><small>TRACK GRIP</small><b>${grip}<em>%</em></b></span></div></div>
      </div>
      <aside class="control-card forecast-card"><div class="control-card-head"><div><span class="eyebrow">WEATHER CENTRE</span><h2>STINT FORECAST</h2></div><span class="weather-location">${icon('pin', 14)} KYOTO, JP</span></div><p class="forecast-intro">Select a time window to preview evolving circuit conditions.</p><div class="forecast-list">${forecasts.map((forecast) => `<button class="forecast-row ${state.weather.hour === forecast.id ? 'is-selected' : ''}" data-action="forecast" data-value="${forecast.id}"><span class="forecast-time">${forecast.time}</span><span class="forecast-icon">${icon(forecast.iconName, 18)}</span><span class="forecast-info"><b>${forecast.condition}</b><small>RAIN ${forecast.rain}</small></span><b class="forecast-temp">${forecast.value}</b><span class="forecast-arrow">${state.weather.hour === forecast.id ? icon('check', 15) : icon('chevron', 15)}</span></button>`).join('')}</div><div class="forecast-recommendation"><span class="recommend-icon">${icon('bolt', 15)}</span><div><small>ENGINEER RECOMMENDATION</small><b>${selected.id === '19:00' ? 'SWITCH TO INTERMEDIATES' : selected.id === '18:00' ? 'PREPARE A WET SETUP' : 'STAY ON SOFT COMPOUND'}</b><span>${selected.id === '19:00' ? 'Rain expected within 30 minutes.' : 'Optimal grip window through the next stint.'}</span></div></div><button class="button button-secondary full-width" data-action="app" data-app="tyres">OPEN TYRE MANAGEMENT ${icon('arrow', 15)}</button></aside>
    </div>
  </section>`;
}

function renderCrew() {
  const friends = [
    { id: 'mika', initials: 'MK', name: 'MIKA KOBAYASHI', status: 'IN LOBBY', car: 'VANTA R-01 / LEVEL 48', color: 'coral', action: 'INVITE' },
    { id: 'navi', initials: 'NV', name: 'NAVI REYES', status: 'ON TRACK', car: 'KYOTO RING / LAP 06', color: 'blue', action: 'SPECTATE' },
    { id: 'sofia', initials: 'SL', name: 'SOFIA LIND', status: 'IN GARAGE', car: 'AERO SETUP / EDITING', color: 'violet', action: 'INVITE' },
    { id: 'tom', initials: 'TK', name: 'TOM KATO', status: 'ONLINE', car: 'LAST SEEN 2 MIN AGO', color: 'amber', action: 'INVITE' },
  ];
  return `<section class="app-view crew-view">
    ${appIntro({ kicker: 'APEX NETWORK / CREW', title: 'YOUR GRID', number: '05', subtitle: 'The paddock is better with a rival. Invite your crew, jump into a lobby, or spectate live.', badge: 'NETWORK CONNECTED', badgeIcon: 'signal' })}
    <div class="crew-layout">
      <div class="crew-main"><div class="crew-feature-card"><div class="crew-feature-bg"></div><div class="crew-feature-top"><span class="live-label"><i></i> LIVE EVENT / 04 DRIVERS</span><span class="event-tag">RANKED SPRINT</span></div><div class="crew-event-copy"><span class="eyebrow">APEX RACE SERIES / ROUND 07</span><h2>KYOTO AFTER<br><em>DARK.</em></h2><p>Five laps. No assists. One shot at the leaderboard.</p><div class="event-meta"><span>${icon('clock', 14)} STARTS IN <b>08:42</b></span><span>${icon('trophy', 14)} PRIZE POOL <b>25,000 CR</b></span></div></div><button class="button button-primary" data-action="join-event">${state.joined ? 'LOBBY JOINED' : 'JOIN THE LOBBY'} ${icon(state.joined ? 'check' : 'arrow', 16)}</button><div class="event-count"><b>03</b><small>/ 08</small><span>DRIVERS READY</span></div></div><div class="crew-section-heading"><div><span class="eyebrow">YOUR PEOPLE</span><h2>FRIENDS <span>04</span></h2></div><button class="invite-button" data-action="invite-all">${icon('plus', 15)} INVITE ALL</button></div><div class="friend-list">${friends.map((friend) => `<div class="friend-row"><div class="friend-avatar ${friend.color}">${friend.initials}<i></i></div><div class="friend-info"><b>${friend.name}</b><small>${friend.car}</small></div><span class="friend-status ${friend.status === 'ON TRACK' ? 'status-track' : ''}"><i></i>${friend.status}</span><button class="friend-action ${friend.action === 'SPECTATE' ? 'spectate-action' : ''}" data-action="friend" data-friend="${friend.id}">${state.invited.includes(friend.id) && friend.action === 'INVITE' ? 'SENT' : friend.action}</button></div>`).join('')}</div></div>
      <aside class="crew-side"><div class="crew-stat-card"><div class="crew-stat-top"><span>SEASON 07</span>${icon('trophy', 16)}</div><span class="crew-rank">#<b>024</b><small>GLOBAL</small></span><div class="rank-progress"><span><i></i></span><small>NEXT RANK <b>TOP 20</b></small></div><div class="crew-stat-footer"><span>1,842 <small>RATING</small></span><span class="rank-change">↗ 12 THIS WEEK</span></div></div><div class="online-roster-card"><div class="online-roster-heading"><div><span class="eyebrow">APEX NETWORK</span><h3>PADDOCK LIVE</h3></div><span class="roster-live"><i></i> 128</span></div><div class="roster-world"><div class="world-lines"></div><span class="world-orbit orbit-one"></span><span class="world-orbit orbit-two"></span><span class="roster-dot dot-one"></span><span class="roster-dot dot-two"></span><span class="roster-dot dot-three"></span><span class="roster-dot dot-four"></span><div class="world-core">${icon('signal', 18)}</div><span class="world-label label-one">TOKYO</span><span class="world-label label-two">MONZA</span></div><div class="roster-footer"><div class="roster-faces"><i>MK</i><i>NV</i><i>SL</i><i>+5</i></div><span>FRIENDS ONLINE</span></div></div><div class="crew-privacy">${icon('lock', 14)} <span>YOUR PROFILE IS PUBLIC</span><button data-action="privacy">EDIT</button></div></aside>
    </div>
  </section>`;
}

function renderWallet() {
  const transactions = [
    { symbol: '+', label: 'DAILY DRIVER REWARD', detail: 'SEASON 07 / DAY 14', value: '+ 750 CR', tone: 'credit' },
    { symbol: '↗', label: 'KYOTO SPRINT — 2ND PLACE', detail: 'RANKED EVENT / 18:02', value: '+ 2,400 CR', tone: 'credit' },
    { symbol: '−', label: 'CARBON FIBRE WING', detail: 'APEX PERFORMANCE / TODAY', value: '− 8,500 CR', tone: 'debit' },
    { symbol: '+', label: 'CLEAN RACE BONUS', detail: 'NO CONTACT / 18:02', value: '+ 350 CR', tone: 'credit' },
  ];
  return `<section class="app-view wallet-view">
    ${appIntro({ kicker: 'APEX NETWORK / WALLET', title: 'DRIVER WALLET', number: '06', subtitle: 'One balance across your garage, upgrades, liveries and the APEX race series.', badge: 'SECURE ACCOUNT', badgeIcon: 'lock' })}
    <div class="wallet-layout"><div class="wallet-main"><div class="balance-card"><div class="balance-orbit orbit-left"></div><div class="balance-orbit orbit-right"></div><div class="balance-top"><span class="balance-mark">${icon('wallet', 18)} APEX CREDIT WALLET</span><span class="wallet-chip">${icon('lock', 12)} ENCRYPTED</span></div><div class="balance-label">AVAILABLE BALANCE <i>·</i> UNIVERSAL CURRENCY</div><div class="balance-amount"><span>CR</span> ${money(state.credits)}<small>.00</small></div><div class="balance-bottom"><span>DRIVER ID <b>APX-0084-02</b></span><span>SEASON 07 <b>· 68 DAYS LEFT</b></span></div><div class="balance-watermark">A</div></div><div class="wallet-action-row"><button class="button button-primary" data-action="daily-reward">${icon('plus', 15)} CLAIM DAILY REWARD <span>+ 750 CR</span></button><button class="button button-secondary" data-action="app" data-app="store">BROWSE THE STORE ${icon('arrow', 15)}</button></div><div class="wallet-transactions"><div class="wallet-section-heading"><div><span class="eyebrow">ACCOUNT ACTIVITY</span><h2>RECENT TRANSACTIONS</h2></div><button class="text-button" data-action="transaction-filter">VIEW ALL ${icon('arrow', 14)}</button></div><div class="transaction-list">${transactions.map((item) => `<div class="transaction-row"><span class="transaction-symbol ${item.tone}">${item.symbol}</span><span class="transaction-description"><b>${item.label}</b><small>${item.detail}</small></span><span class="transaction-value ${item.tone}">${item.value}</span><span class="transaction-time">${item.detail.endsWith('TODAY') ? '16:24' : '18:02'}</span></div>`).join('')}</div></div></div><aside class="wallet-side"><div class="account-card"><div class="account-card-head"><span class="eyebrow">DRIVER ACCOUNT</span><span class="account-edition">FOUNDERS</span></div><div class="wallet-driver"><span class="wallet-avatar">LX</span><span><b>LEX MORI</b><small>PLATINUM / LEVEL 42</small></span><span class="level-medal">42</span></div><div class="account-divider"></div><div class="account-stat"><span>SEASON RANK</span><b># 024 <small>GLOBAL</small></b></div><div class="account-stat"><span>RACES COMPLETED</span><b>186</b></div><div class="account-stat"><span>CLEAN RACE RATE</span><b>94 <small>%</small></b></div><button class="account-detail-button" data-action="app" data-app="crew">VIEW DRIVER PROFILE ${icon('chevron', 14)}</button></div><div class="wallet-value-card"><span class="value-icon">${icon('crown', 18)}</span><div><small>SEASON REWARD TRACK</small><b>72% <i>COMPLETE</i></b><span class="value-progress"><i></i></span></div><button data-action="app" data-app="crew" aria-label="View season rewards">${icon('chevron', 15)}</button></div><div class="wallet-secure-note">${icon('lock', 13)} YOUR ACCOUNT IS PROTECTED BY APEX ID.</div></aside></div>
  </section>`;
}

const SHOP_ITEMS = [
  { id: 'volt-livery', name: 'VOLT / CIRCUIT LIVERY', type: 'RARE VEHICLE SKIN', price: 18500, chip: 'RARE', color: 'volt', detail: 'High-voltage lines. Zero compromises.' },
  { id: 'ghost-livery', name: 'GHOST / CARBON', type: 'ELITE VEHICLE SKIN', price: 24000, chip: 'ELITE', color: 'ghost', detail: 'Stealth carbon, electric edge.' },
  { id: 'neon-kit', name: 'PHOTON / UNDERGLOW', type: 'LIGHTING KIT', price: 9500, chip: 'EPIC', color: 'photon', detail: 'Own the night, corner by corner.' },
  { id: 'race-pack', name: 'APEX / TRACK PACK', type: 'ENGINEERING SET', price: 12500, chip: 'RARE', color: 'track', detail: 'Three precision-engineered track maps.' },
];

function renderStore() {
  return `<section class="app-view store-view">
    ${appIntro({ kicker: 'APEX NETWORK / STORE', title: 'THE PADDOCK STORE', number: '08', subtitle: 'Make it unmistakably yours. Every purchase is shared across your online garage.', badge: 'SEASON 07 / LIVE', badgeIcon: 'signal' })}
    <div class="store-toolbar"><div class="store-categories"><button class="store-category is-selected">FEATURED <span>04</span></button><button class="store-category" data-action="store-filter">VEHICLE SKINS</button><button class="store-category" data-action="store-filter">UPGRADES</button><button class="store-category" data-action="store-filter">DRIVER GEAR</button></div><div class="store-sort"><span>WALLET</span><b>CR ${money(state.credits)}</b>${icon('chevron', 14)}</div></div>
    <div class="store-feature-banner"><div class="banner-glow"></div><div class="banner-content"><span class="eyebrow"><i class="live-pip"></i> DROP 07 / LIMITED RUN</span><h2>CONTROL<br>THE <em>NIGHT.</em></h2><p>Four new looks. One statement.<br>Only while the season lasts.</p><button class="button button-primary" data-action="store-scroll">EXPLORE THE DROP ${icon('arrow', 15)}</button></div><div class="banner-art"><div class="banner-grid"></div><div class="banner-rim"></div><div class="banner-light"></div><span class="banner-stamp">07<span>—</span>24</span><span class="banner-edition">NIGHT / SERIES</span></div><div class="banner-number">07</div></div>
    <div class="store-section-title"><div><span class="eyebrow">CURATED FOR YOUR GARAGE</span><h2>THE LATEST DROP <span>04 ITEMS</span></h2></div><button class="text-button" data-action="app" data-app="garage">VIEW YOUR GARAGE ${icon('arrow', 14)}</button></div>
    <div class="product-grid">${SHOP_ITEMS.map((item, index) => {
      const owned = state.owned.includes(item.id);
      const equipped = state.equipped === item.id;
      return `<article class="product-card"><div class="product-art product-art-${item.color}"><span class="product-rarity">${item.chip}</span><span class="product-art-index">0${index + 1} <i>/ APEX</i></span><div class="product-art-wheel"></div><div class="product-art-slash"></div><span class="product-art-name">${item.color === 'track' ? 'MAP / 07' : 'R–01'}</span></div><div class="product-copy"><span class="product-type">${item.type}</span><h3>${item.name}</h3><p>${item.detail}</p><div class="product-buy-row"><b class="product-price">CR ${money(item.price)}</b><button class="product-action ${owned ? 'is-owned' : ''}" data-action="buy" data-item="${item.id}">${equipped ? `${icon('check', 13)} EQUIPPED` : owned ? 'EQUIP' : 'ACQUIRE'}</button></div></div></article>`;
    }).join('')}</div>
    <div class="store-bottom-note">${icon('signal', 14)} ITEMS UNLOCKED HERE ARE AVAILABLE IN EVERY ONLINE SESSION <span>VIEW PURCHASE HISTORY ${icon('arrow', 13)}</span></div>
  </section>`;
}

function renderGarage() {
  return `<section class="app-view garage-view">
    ${appIntro({ kicker: 'FACTORY GARAGE / VEHICLE', title: 'VANTA R-01', number: '09', subtitle: 'A purebred hyper GT, developed for the edge between control and chaos.', badge: 'READY TO DRIVE', badgeIcon: 'check' })}
    <div class="garage-layout"><div class="garage-stage-card"><div class="garage-stage-heading"><span class="eyebrow">CHASSIS 01 / 08</span><span class="garage-condition">${icon('check', 13)} TECHNICAL INSPECTION PASSED</span></div>${viewer('car', 'VANTA R-01 / HYPER GT', 'DRAG TO INSPECT', 'garage-model')}<div class="garage-stage-footer"><span>PAINT <b>${equippedName()}</b></span><span>DRIVER <b>LEX MORI</b></span><span>CLASS <b>S+ / HYPER</b></span></div></div><div class="garage-spec-column"><div class="garage-spec-card"><span class="eyebrow">POWERTRAIN / HYBRID V8</span><div class="garage-power">1,080<span>HP</span></div><div class="power-progress"><i></i></div><div class="garage-specs"><div><small>0—100 KM/H</small><b>2.4 <i>SEC</i></b></div><div><small>TOP SPEED</small><b>342 <i>KM/H</i></b></div><div><small>WEIGHT</small><b>1,380 <i>KG</i></b></div><div><small>DRIVE</small><b>AWD <i>HYBRID</i></b></div></div></div><div class="garage-systems-card"><div class="garage-systems-heading"><span class="eyebrow">SYSTEMS HEALTH</span><span>08 / 08 <i>OPTIMAL</i></span></div>${[['POWERTRAIN', '98%'], ['SUSPENSION', '100%'], ['AERODYNAMICS', '96%'], ['TYRE LIFE', '88%']].map(([label, percent], i) => `<div class="system-health-row"><span>${label}</span><span class="health-line"><i style="--health:${parseInt(percent, 10)}%;--delay:${i * 80}ms"></i></span><b>${percent}</b></div>`).join('')}</div><div class="garage-action-grid"><button data-action="app" data-app="setup">${icon('setup', 17)} TUNE SETUP ${icon('chevron', 14)}</button><button data-action="app" data-app="store">${icon('store', 17)} PERSONALISE ${icon('chevron', 14)}</button></div></div></div>
  </section>`;
}

function equippedName() {
  const item = SHOP_ITEMS.find((entry) => entry.id === state.equipped);
  return item ? item.name.split(' / ')[0] : 'FACTORY TITANIUM';
}

function renderHud() {
  const trackPoints = 'M30 180 89 151 126 85 201 70 241 102 310 55 365 74 405 126 478 117 525 76 588 92 635 146 610 211 536 230 476 260 402 235 340 265 269 234 209 266 145 235 102 212Z';
  return `<section class="race-hud-screen">
    <div class="race-environment"><div class="race-grid-horizon"></div><div class="race-track-glow"></div><div class="race-road"></div><div class="race-road-edge"></div><div class="race-light-streak streak-a"></div><div class="race-light-streak streak-b"></div><div class="race-light-streak streak-c"></div><div class="race-scene-vignette"></div><div class="race-scene-label">KYOTO RING <span>—</span> NIGHT PRACTICE</div></div>
    <div class="hud-top-row"><div class="hud-race-session"><span class="hud-live-pill"><i></i> LIVE</span><span>KYOTO RING <b>·</b> PRACTICE 04</span></div><div class="hud-lap"><small>LAP</small><b>08</b><span>/ 12</span><i></i><small>BEST</small><strong>1:42.084</strong></div><div class="hud-position"><span>POSITION</span><b>03<span>/18</span></b><small>GAP <i>+00.472</i></small></div></div>
    <div class="hud-left-stack"><div class="hud-panel hud-tyre-panel"><div class="hud-panel-heading"><span>TYRE STATUS</span><small>${state.tyres.compound}</small></div><div class="hud-tyre-car"><svg viewBox="0 0 94 148" aria-hidden="true"><path d="M28 9Q47 0 66 9l8 31 4 35-7 60H23l-7-60 4-35z" fill="#252d2e" stroke="#687676" stroke-width="2"/><path d="M31 22h32l5 31H26zM25 92h44l-3 29H28z" fill="#baff37" opacity=".65"/><path d="M24 65h46M21 76h52" stroke="#101516" stroke-width="7"/><path d="M31 12v20m9-21v20m10-20v20m9-19v19M29 120v17m12-17v17m12-17v17m10-17v17" stroke="#111718" stroke-width="3"/></svg><div class="tyre-pulse pulse-one"></div><div class="tyre-pulse pulse-two"></div><span class="tyre-hotspot hotspot-fl">94°</span><span class="tyre-hotspot hotspot-rr">91°</span></div><div class="hud-tyre-legend"><span><i></i> OPTIMAL</span><span>${state.tyres.pressure.toFixed(1)} PSI</span></div></div><div class="hud-panel hud-energy-panel"><div class="hud-panel-heading"><span>ENERGY DEPLOY</span><small>HYBRID / ERS</small></div><div class="energy-gauge"><div class="energy-ring"><span>78<small>%</small></span></div><div class="energy-bars"><span style="--bar:72%"></span><span style="--bar:82%"></span><span style="--bar:91%"></span><span style="--bar:75%"></span><span style="--bar:54%"></span><span style="--bar:43%"></span><span style="--bar:34%"></span><span style="--bar:27%"></span></div></div><div class="energy-foot"><span>DEPLOYMENT</span><b>ATTACK <i>›</i></b></div></div></div>
    <div class="hud-right-stack"><div class="hud-panel hud-map-panel"><div class="hud-panel-heading"><span>SECTOR MAP</span><span class="map-sector">SECTOR 02</span></div><svg class="hud-track-map" viewBox="0 0 700 310" preserveAspectRatio="xMidYMid meet" aria-label="Circuit minimap"><path d="${trackPoints}" class="hud-map-track-bg"/><path d="${trackPoints}" class="hud-map-track-line"/><circle cx="478" cy="117" r="7" class="hud-map-player"/><circle cx="310" cy="55" r="5" class="hud-map-opponent opponent-a"/><circle cx="145" cy="235" r="5" class="hud-map-opponent opponent-b"/><text x="444" y="101">YOU</text></svg><div class="map-gap-row"><span>LEADER</span><b>+02.401</b></div></div><div class="hud-panel hud-race-control"><div><span>DRS</span><small>ZONE 02 / ACTIVE</small></div><button class="hud-drs-button ${state.aero.drs ? 'is-active' : ''}" data-action="hud-drs">${state.aero.drs ? 'OPEN' : 'CLOSED'} <i></i></button></div><div class="hud-track-status"><span class="weather-glyph">${icon('sun', 19)}</span><span><small>TRACK TEMP</small><b>28° <i>DRY</i></b></span><span class="status-separator"></span><span class="wind-hud">↘</span><span><small>WIND</small><b>8 KM/H</b></span></div></div>
    <div class="hud-center-readout"><div class="hud-throttle"><span>THROTTLE <b>86%</b></span><i><em style="--meter:86%"></em></i><span>BRAKE <b>00%</b></span></div><div class="speed-cluster"><span class="speed-top-label">HYBRID <i>V8</i> <span>·</span> RPM <b>8,420</b></span><div class="rpm-lights">${Array.from({ length: 15 }, (_, i) => `<i class="${i > 12 ? 'rpm-red' : i > 9 ? 'rpm-amber' : ''} ${i < 12 ? 'is-lit' : ''}"></i>`).join('')}</div><div class="speed-digits"><b>218</b><span>KM/H</span></div><div class="gear-row"><span>GEAR</span><b>4</b><span>ERS <i>78%</i></span></div></div><div class="hud-engine-stats"><div><span>OIL TEMP</span><b>92°</b></div><div><span>WATER</span><b>84°</b></div><div><span>FUEL</span><b>32 <small>L</small></b></div></div></div>
    <div class="hud-bottom-row"><button class="hud-apps-button" data-action="mode" data-mode="console">${icon('grid', 16)} OPEN VEHICLE APPS <span>WEATHER / SETUP / GARAGE</span>${icon('arrow', 15)}</button><div class="hud-bottom-center"><span><i></i> ASSISTS OFF</span><span>TC <b>0</b></span><span>ABS <b>0</b></span><span>MAP <b>ATTACK</b></span></div><button class="hud-pit-button ${state.pitRequested ? 'is-requested' : ''}" data-action="pit-request">${icon('bolt', 15)} ${state.pitRequested ? 'PIT CONFIRMED' : 'REQUEST PIT'} <span>↗</span></button></div>
    <div class="hud-fps">HUD PREVIEW <span>·</span> 120 HZ <span>·</span> SIMULATED DATA</div>
  </section>`;
}

function render() {
  const revision = ++sceneRevision;
  sceneController?.destroy();
  sceneController = null;
  app.innerHTML = renderShell();
  const sceneElement = document.querySelector('[data-scene]');
  if (sceneElement) {
    import('./scene.js').then(({ mountScene }) => {
      if (revision !== sceneRevision || !sceneElement.isConnected) return;
      sceneController = mountScene(sceneElement, sceneElement.dataset.scene, {
        setup: state.setup,
        aero: state.aero,
        tyres: state.tyres,
        equipped: state.equipped,
      });
    }).catch((error) => {
      if (revision !== sceneRevision || !sceneElement.isConnected) return;
      console.warn('3D preview could not be initialized:', error);
      sceneElement.classList.add('scene-fallback');
      const canvasHolder = sceneElement.querySelector('.model-canvas');
      if (canvasHolder) canvasHolder.innerHTML = '<div class="scene-fallback-copy">3D VIEWER<br><small>WEBGL UNAVAILABLE</small></div>';
    });
  }
}

function setApp(id) {
  state.activeApp = APP_LIST.some((item) => item.id === id) ? id : 'home';
  state.mode = 'console';
  persist();
  render();
}

function applySetupPreset(name) {
  state.setup.preset = name;
  const setups = {
    ATTACK: { frontRide: 56, rearRide: 62, springRate: 8.4, rebound: 68 },
    BALANCED: { frontRide: 66, rearRide: 71, springRate: 6.8, rebound: 54 },
    WET: { frontRide: 76, rearRide: 84, springRate: 5.8, rebound: 42 },
  };
  Object.assign(state.setup, setups[name]);
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, app: appId, mode, value, item, friend } = button.dataset;

  switch (action) {
    case 'app': setApp(appId); break;
    case 'mode':
      state.mode = mode;
      persist();
      render();
      break;
    case 'setup-preset':
      applySetupPreset(value);
      persist();
      render();
      notify(`${value} chassis map applied.`);
      break;
    case 'drs-toggle':
      state.aero.drs = !state.aero.drs;
      persist();
      render();
      break;
    case 'aero-preset':
      state.aero.preset = value;
      state.aero.balance = value === 'HIGH DOWNFORCE' ? 64 : value === 'LOW DRAG' ? 44 : 54;
      persist();
      render();
      notify(`${value} aero map selected.`);
      break;
    case 'compound':
      state.tyres.compound = value;
      persist();
      render();
      notify(`${value} compound loaded.`);
      break;
    case 'forecast':
      state.weather.hour = value;
      persist();
      render();
      break;
    case 'buy': {
      const product = SHOP_ITEMS.find((entry) => entry.id === item);
      if (!product) break;
      if (state.owned.includes(product.id)) {
        state.equipped = product.id;
        persist();
        render();
        notify(`${product.name.split(' / ')[0]} equipped.`);
      } else if (state.credits >= product.price) {
        state.credits -= product.price;
        state.owned.push(product.id);
        state.equipped = product.id;
        persist();
        render();
        notify(`${product.name.split(' / ')[0]} added to your garage.`);
      } else {
        notify('Not enough credits for this item.', 'error');
      }
      break;
    }
    case 'daily-reward':
      state.credits += 750;
      persist();
      render();
      notify('Daily driver reward claimed · +750 CR.');
      break;
    case 'join-event':
      state.joined = !state.joined;
      persist();
      render();
      notify(state.joined ? 'You are in the Kyoto After Dark lobby.' : 'You left the event lobby.');
      break;
    case 'friend':
      if (friend === 'navi') {
        notify('Spectator link established · Navi Reyes.');
      } else if (!state.invited.includes(friend)) {
        state.invited.push(friend);
        persist();
        render();
        notify('Invite sent to your crew.');
      } else {
        notify('Invite already sent.');
      }
      break;
    case 'invite-all':
      state.invited = ['mika', 'sofia', 'tom'];
      persist();
      render();
      notify('Your crew has been invited to the lobby.');
      break;
    case 'privacy': notify('Driver profile settings opened.'); break;
    case 'hud-drs':
      state.aero.drs = !state.aero.drs;
      persist();
      render();
      break;
    case 'pit-request':
      state.pitRequested = !state.pitRequested;
      persist();
      render();
      notify(state.pitRequested ? 'Pit crew notified · box this lap.' : 'Pit request cancelled.');
      break;
    case 'store-filter': notify('Showing all featured items in this prototype.'); break;
    case 'store-scroll': document.querySelector('.product-grid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
    case 'transaction-filter': notify('All recent account activity is shown.'); break;
  }
});

app.addEventListener('input', (event) => {
  const input = event.target.closest('[data-range]');
  if (!input) return;
  const key = input.dataset.range;
  const numericValue = Number(input.value);
  const output = document.querySelector(`#out-${key}`);
  const formatted = key === 'springRate' ? numericValue.toFixed(1) : key === 'tyrePressure' ? numericValue.toFixed(1) : `${numericValue}`;
  const unit = key === 'frontRide' || key === 'rearRide' ? ' mm' : key === 'springRate' ? ' kg/mm' : key === 'tyrePressure' ? ' PSI' : key === 'aeroBalance' ? '%' : '%';
  if (output) output.textContent = `${formatted}${unit}`;
  input.style.setProperty('--range-progress', `${((numericValue - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`);

  if (key === 'frontRide') {
    state.setup.frontRide = numericValue;
    sceneController?.setSuspension?.(numericValue);
    const frontMetric = document.querySelector('.small-metric:first-child .small-metric-copy b');
    if (frontMetric) frontMetric.innerHTML = `${numericValue} <small>MM</small>`;
    const note = document.querySelector('.setup-controls .rear-title + .range-control .range-label-row > span > small');
    if (note) note.textContent = `RAKE +${state.setup.rearRide - numericValue} MM`;
  }
  if (key === 'rearRide') {
    state.setup.rearRide = numericValue;
    const note = document.querySelector('.setup-controls .rear-title + .range-control .range-label-row > span > small');
    if (note) note.textContent = `RAKE +${numericValue - state.setup.frontRide} MM`;
  }
  if (key === 'springRate') {
    state.setup.springRate = numericValue;
    const metric = document.querySelector('.small-metric:nth-child(2) .small-metric-copy b');
    if (metric) metric.innerHTML = `${numericValue.toFixed(1)} <small>KG/MM</small>`;
  }
  if (key === 'rebound') state.setup.rebound = numericValue;
  if (key === 'aeroBalance') {
    state.aero.balance = numericValue;
    const metric = document.querySelector('.aero-metrics .small-metric:nth-child(2) .small-metric-copy b');
    if (metric) metric.innerHTML = `${numericValue} <small>%</small>`;
  }
  if (key === 'tyrePressure') {
    state.tyres.pressure = numericValue;
    document.querySelectorAll('.corner-data > span').forEach((pressure, index) => {
      pressure.innerHTML = `${(numericValue + [0, 0.2, 0.3, 0.1][index]).toFixed(1)} <small>PSI</small>`;
    });
    const hudPressure = document.querySelector('.hud-tyre-legend span:nth-child(2)');
    if (hudPressure) hudPressure.textContent = `${numericValue.toFixed(1)} PSI`;
  }
});

app.addEventListener('change', (event) => {
  if (event.target.matches('[data-range]')) persist();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.mode === 'hud') {
    state.mode = 'console';
    persist();
    render();
  }
});

window.addEventListener('beforeunload', () => sceneController?.destroy());
render();

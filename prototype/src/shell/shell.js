// The Android-style shell: status bar, instrument rails, app launcher,
// app windows, recents, and the navigation bar.
import { h, setText, arcGauge, meter } from '../ui/widgets.js';
import { heatHex } from '../ui/heat.js';
import { state, subscribe, set } from '../core/store.js';
import { CORNERS } from '../render3d/car.js';
import apps from '../apps/index.js';
import { svgIcon, ICONS } from '../ui/icons.js';

const iconBox = (cls, markup) => { const el = h('div', { class: cls }); el.innerHTML = markup; return el; };

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/></svg>',
  recents: '<svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>',
};
const FAVS = ['telemetry', 'tyres', 'weather', 'wallet', 'store'];
const SEGMENTS = 14;

function appTile(app, onClick) {
  return h('button', { class: 'app-tile', title: app.name, onclick: onClick, style: { '--app': app.color }, 'data-app': app.id },
    iconBox('app-icon', app.icon),
    h('div', { class: 'app-label' }, app.name));
}

function animateIn(el) {
  el.classList.remove('enter');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('enter');
}

export function mountShell(stage) {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const instances = new Map();
  let activeId = null;
  let recentIds = [];
  let recentsOpen = false;

  // ---------- Status bar -------------------------------------------------
  const clockEl = h('span', { class: 'clock' }, '--:--');
  const netChip = h('button', { class: 'chip', title: 'Toggle online', onclick: () => set('session.online', !state.session.online) }, 'ONLINE');
  const posEl = h('span', { class: 'sb-pos' }, 'P-');
  const lapEl = h('span', {}, 'LAP -/-');
  const drsChip = h('span', { class: 'chip' }, 'DRS OFF');
  const trackEl = h('span', {}, '--°C');
  const fpsEl = h('span', { class: 'mono', hidden: true }, '-- FPS');
  const statusbar = h('header', { class: 'statusbar' },
    h('div', { class: 'sb-left' }, clockEl, netChip),
    h('div', { class: 'sb-mid' }, posEl, lapEl),
    h('div', { class: 'sb-right' }, drsChip, h('span', {}, 'TRACK ', trackEl), fpsEl));

  // ---------- Left rail: speed, gear, rpm, pedals ------------------------
  const speedGauge = arcGauge({ size: 230, max: 360 });
  const speedNum = h('div', { class: 'speed-num' }, '0');
  const gearEl = h('div', { class: 'gear' }, '1');
  const segs = Array.from({ length: SEGMENTS }, (_, i) => h('i', { class: i >= 11 ? 'seg red' : i >= 9 ? 'seg amber' : 'seg' }));
  const throttle = meter('Throttle', { color: 'var(--ok)' });
  const brake = meter('Brake', { color: 'var(--crit)' });
  const leftRail = h('aside', { class: 'rail rail-left' },
    h('div', { class: 'speed-wrap' }, speedGauge.el, speedNum, h('div', { class: 'speed-unit' }, 'KM/H')),
    h('div', { class: 'gear-wrap' }, h('div', { class: 'k' }, 'GEAR'), gearEl),
    h('div', { class: 'rpm' }, segs),
    throttle.el, brake.el);

  // ---------- Right rail: tyres, suspension, weather ---------------------
  const tiles = Object.fromEntries(CORNERS.map((c) => {
    const t = h('div', { class: 'v' }, '--');
    const p = h('div', { class: 's' }, '-- bar');
    const el = h('div', { class: 'tyre-tile' }, h('div', { class: 'k', text: c }), t, p);
    return [c, { el, t, p }];
  }));
  const susp = Object.fromEntries(CORNERS.map((c) => [c, meter(c)]));
  const wx = { air: h('span', { class: 'v' }, '--'), track: h('span', { class: 'v' }, '--'), rain: meter('Rain', { color: '#4da3ff' }) };
  const rightRail = h('aside', { class: 'rail rail-right' },
    h('div', { class: 'card-title', text: 'Tyres' }),
    h('div', { class: 'tyre-grid' }, CORNERS.map((c) => tiles[c].el)),
    h('div', { class: 'card-title', text: 'Suspension travel' }),
    h('div', { class: 'susp-grid' }, CORNERS.map((c) => susp[c].el)),
    h('div', { class: 'card-title', text: 'Weather' }),
    h('div', { class: 'wx-row' },
      h('div', { class: 'wx' }, h('span', { class: 'k', text: 'AIR' }), wx.air),
      h('div', { class: 'wx' }, h('span', { class: 'k', text: 'TRACK' }), wx.track)),
    wx.rain.el);

  // ---------- Window: launcher / app host / recents ----------------------
  const launcher = h('div', { class: 'launcher enter' }, apps.map((a) => appTile(a, () => openApp(a.id))));
  const apphost = h('div', { class: 'apphost' });
  const recents = h('div', { class: 'recents', hidden: true });
  const windowEl = h('section', { class: 'window' }, launcher, apphost, recents);

  // ---------- Navigation bar --------------------------------------------
  const navBtn = (label, icon, onclick) => {
    const b = h('button', { class: 'nav-btn', title: label, 'aria-label': label, onclick });
    b.innerHTML = icon;
    return b;
  };
  const dock = h('div', { class: 'dock' }, FAVS.map((id) => appTile(byId.get(id), () => openApp(id))));
  const navbar = h('nav', { class: 'navbar' },
    h('div', { class: 'nav-btns' },
      navBtn('Back', ICON.back, back),
      navBtn('Home', ICON.home, home),
      navBtn('Recents', ICON.recents, toggleRecents)),
    dock,
    h('div', { class: 'nav-hint', text: '1-9 OPEN · H HOME · R RECENTS · ESC BACK' }));

  stage.replaceChildren(statusbar, h('main', { class: 'cockpit' }, leftRail, windowEl, rightRail), navbar);

  // ---------- Navigation logic ------------------------------------------
  function openApp(id) {
    const app = byId.get(id);
    if (!app || activeId === id) return;
    if (activeId) hideActive();
    closeRecents();
    let inst = instances.get(id);
    if (!inst) {
      inst = app.create();
      inst.el.classList.add('app-page');
      apphost.append(inst.el);
      instances.set(id, inst);
    }
    inst.el.hidden = false;
    animateIn(inst.el);
    launcher.hidden = true;
    activeId = id;
    recentIds = recentIds.filter((x) => x !== id);
    recentIds.push(id);
    inst.mount?.();
    inst.update?.(state, '*');
    updateNav();
  }

  function hideActive() {
    const inst = instances.get(activeId);
    if (inst) {
      inst.unmount?.();
      inst.el.hidden = true;
    }
  }

  function home() {
    if (activeId) {
      hideActive();
      activeId = null;
    }
    launcher.hidden = false;
    animateIn(launcher);
    closeRecents();
    updateNav();
  }

  function back() {
    if (recentsOpen) return closeRecents();
    if (activeId) home();
  }

  function openRecents() { renderRecents(); recents.hidden = false; recentsOpen = true; }
  function closeRecents() { recents.hidden = true; recentsOpen = false; }
  function toggleRecents() { if (recentsOpen) closeRecents(); else openRecents(); }

  function killApp(id) {
    const inst = instances.get(id);
    if (!inst) return;
    if (activeId === id) { inst.unmount?.(); activeId = null; launcher.hidden = false; }
    inst.unmount?.();
    inst.el.remove();
    instances.delete(id);
    recentIds = recentIds.filter((x) => x !== id);
    renderRecents();
    updateNav();
  }

  function renderRecents() {
    const cards = recentIds.slice().reverse().map((id) => {
      const a = byId.get(id);
      return h('div', { class: 'recent-card', style: { '--app': a.color }, onclick: () => { closeRecents(); openApp(id); } },
        h('div', { class: 'rc-top' },
          iconBox('app-icon sm', a.icon),
          h('span', { class: 'rc-name', text: a.name }),
          h('button', { class: 'rc-close', 'aria-label': 'Close app', onclick: (e) => { e.stopPropagation(); killApp(id); } }, iconBox('x-ico', svgIcon('close')))),
        h('div', { class: 'rc-body' }, iconBox('rc-big', a.icon)));
    });
    recents.replaceChildren(
      h('div', { class: 'recents-head' },
        h('span', { class: 'card-title', text: 'Recent apps' }),
        h('button', { class: 'btn', onclick: closeRecents }, 'Close')),
      cards.length ? h('div', { class: 'recents-row' }, cards) : h('div', { class: 'empty', text: 'No recent apps' }));
  }

  function updateNav() {
    navbar.querySelectorAll('.app-tile').forEach((t) => t.classList.toggle('on', t.dataset.app === activeId));
  }

  // ---------- Live updates -----------------------------------------------
  let lastAccent = '';
  function applyTheme(s) {
    if (s.settings.accent !== lastAccent) {
      lastAccent = s.settings.accent;
      document.documentElement.style.setProperty('--accent', lastAccent);
    }
    stage.classList.toggle('hud', s.settings.hud);
  }

  function updateRails(s) {
    const v = s.vehicle;
    speedGauge.set(v.speedKmh);
    setText(speedNum, Math.round(v.speedKmh));
    setText(gearEl, v.gear);
    const lit = Math.round(((v.rpm - 3800) / (12800 - 3800)) * SEGMENTS);
    for (let i = 0; i < SEGMENTS; i++) segs[i].classList.toggle('on', i < lit);
    throttle.set(v.throttle);
    brake.set(v.brake);

    for (const c of CORNERS) {
      const t = v.tyres[c], tile = tiles[c];
      setText(tile.t, `${Math.round(t.tempC)}°C`);
      setText(tile.p, `${t.pressureBar.toFixed(2)} bar`);
      tile.el.style.setProperty('--heat', heatHex(t.tempC));
      const travel = v.suspension.travelMm[c];
      susp[c].set((travel - 10) / 80, `${travel.toFixed(0)} mm`);
    }

    const w = s.weather;
    setText(wx.air, `${w.airTempC.toFixed(0)}°`);
    setText(wx.track, `${w.trackTempC.toFixed(0)}°`);
    wx.rain.set(w.rainIntensity);
  }

  function updateStatus(s) {
    const v = s.vehicle;
    setText(posEl, `P${v.position}`);
    setText(lapEl, `LAP ${v.lap}/${v.lapsTotal}`);
    drsChip.className = 'chip ' + (v.drs === 'open' ? 'drs-open' : v.drs === 'ready' ? 'drs-ready' : '');
    setText(drsChip, `DRS ${v.drs.toUpperCase()}`);
    setText(trackEl, `${Math.round(s.weather.trackTempC)}°C`);
    netChip.className = 'chip ' + (s.session.online ? 'on' : 'off');
    setText(netChip, s.session.online ? 'ONLINE' : 'OFFLINE');
    fpsEl.hidden = !s.settings.showDebug;
  }

  subscribe((s, path) => {
    applyTheme(s);
    updateRails(s);
    updateStatus(s);
    if (activeId) instances.get(activeId)?.update?.(s, path);
  });

  // Clock
  const tickClock = () => setText(clockEl, new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }));
  tickClock();
  setInterval(tickClock, 1000);

  // FPS counter
  let frames = 0, lastFps = performance.now();
  (function fpsLoop(now) {
    frames++;
    if (now - lastFps >= 1000) {
      setText(fpsEl, `${frames} FPS`);
      frames = 0;
      lastFps = now;
    }
    requestAnimationFrame(fpsLoop);
  })(performance.now());

  // Keyboard: 1–9 open apps, H home, R recents, Esc back
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') back();
    else if (e.key === 'h' || e.key === 'H') home();
    else if (e.key === 'r' || e.key === 'R') toggleRecents();
    else if (/^[1-9]$/.test(e.key)) { const a = apps[Number(e.key) - 1]; if (a) openApp(a.id); }
  });

  // First paint
  applyTheme(state);
  updateRails(state);
  updateStatus(state);
  updateNav();
}

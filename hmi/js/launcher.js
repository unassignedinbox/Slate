// Android-style shell: status bar, home screen with widgets, app drawer, recents, nav bar.
// Lifecycle contract for apps: open(body, ctx) -> { update?(frame), destroy?() }.
// The shell only forwards telemetry frames to the foreground app.
import { el } from './ui.js';
import { icon } from './icons.js';
import { getWeather } from './apps/weather.js';

const iconNode = (name) => {
  const s = el('span', { class: 'ico' });
  s.innerHTML = icon(name);
  return s;
};

export function createLauncher(apps, ctx) {
  const $ = (id) => document.getElementById(id);
  const home = $('home'), windows = $('windows'), drawer = $('drawer'), recents = $('recents');
  const toasts = $('toasts');
  const running = new Map(); // id -> { app, root, inst }
  let order = [];            // recents order (most recent first)
  let fg = null;             // foreground app id
  const lastToastAt = {};
  let lastClock = '', lastWidget = 0;

  // ---- toasts (alerts and purchase results)
  function toast(text, level = 'info', ms = 3200) {
    const t = el('div', { class: `toast ${level}` }, text);
    toasts.append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---- home screen
  const tile = (app, extra = '') =>
    el('button', { class: `tile ${extra}`, style: { '--c': app.color }, onclick: () => launch(app.id) },
      el('span', { class: 'tile-ico' }, iconNode(app.icon)),
      el('span', { class: 'tile-label' }, app.name));

  $('app-grid').replaceChildren(...apps.map((a) => tile(a)));
  $('dock').replaceChildren(
    ...['cockpit', 'wallet', 'online'].map((id) => tile(apps.find((a) => a.id === id), 'dock-tile')),
    el('button', { class: 'tile dock-tile', style: { '--c': '#94a3b8' }, onclick: openDrawer, 'aria-label': 'All apps' },
      el('span', { class: 'tile-ico' }, iconNode('apps')), el('span', { class: 'tile-label' }, 'Apps')),
  );

  // ---- app drawer
  const drawerGrid = $('drawer-grid');
  function renderDrawer(q = '') {
    const match = apps.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()));
    drawerGrid.replaceChildren(...match.map((a) => tile(a)));
  }
  $('drawer-search').addEventListener('input', (e) => renderDrawer(e.target.value));
  function openDrawer() {
    $('drawer-search').value = '';
    renderDrawer();
    closeRecents();
    drawer.classList.remove('hidden');
  }

  // ---- recents
  function openRecents() {
    const cards = order.filter((id) => running.has(id)).map((id) => {
      const { app } = running.get(id);
      return el('div', { class: 'rcard', style: { '--c': app.color }, onclick: () => launch(id) },
        el('header', {}, iconNode(app.icon), el('span', {}, app.name),
          el('button', {
            class: 'icon-btn', 'aria-label': `Close ${app.name}`,
            onclick: (e) => { e.stopPropagation(); closeApp(id); openRecents(); },
          }, iconNode('close'))),
        el('div', { class: 'rcard-body' }, el('span', { class: 'rcard-ico' }, iconNode(app.icon))));
    });
    $('rcards').replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty' }, 'No recent apps')]));
    closeDrawer();
    recents.classList.remove('hidden');
  }
  const closeRecents = () => recents.classList.add('hidden');
  const closeDrawer = () => drawer.classList.add('hidden');

  // ---- app windows
  function launch(id) {
    const app = apps.find((a) => a.id === id);
    if (!app) return;
    let r = running.get(id);
    if (!r) {
      const body = el('div', { class: 'app-body' });
      const root = el('section', { class: 'app-window', 'aria-label': app.name },
        el('header', { class: 'app-bar', style: { '--c': app.color } },
          el('span', { class: 'app-ico' }, iconNode(app.icon)),
          el('span', { class: 'app-title' }, app.name),
          el('span', { class: 'spacer' }),
          el('button', { class: 'icon-btn', 'aria-label': 'Close app', onclick: () => closeApp(id) }, iconNode('close'))),
        body);
      windows.append(root);
      let inst;
      try {
        inst = app.open(body, ctx) || {};
      } catch (err) {
        body.append(el('div', { class: 'app-error' }, `${app.name} failed to start: ${err.message}`));
        inst = {};
      }
      r = { app, root, inst };
      running.set(id, r);
    }
    show(id);
  }

  function show(id) {
    fg = id;
    for (const [k, r] of running) r.root.classList.toggle('visible', k === id);
    home.classList.add('hidden');
    order = [id, ...order.filter((x) => x !== id)];
    closeDrawer(); closeRecents();
  }

  function goHome() {
    fg = null;
    for (const r of running.values()) r.root.classList.remove('visible');
    home.classList.remove('hidden');
    closeDrawer(); closeRecents();
  }

  function closeApp(id) {
    const r = running.get(id);
    if (!r) return;
    try { r.inst.destroy?.(); } catch (_) { /* best effort */ }
    r.root.remove();
    running.delete(id);
    order = order.filter((x) => x !== id);
    if (fg === id) goHome();
  }

  function back() {
    if (!drawer.classList.contains('hidden') || !recents.classList.contains('hidden')) {
      closeDrawer(); closeRecents();
    } else if (fg) {
      goHome();
    }
  }

  // ---- static icons and widget taps
  document.querySelectorAll('[data-ico]').forEach((n) => { n.innerHTML = icon(n.dataset.ico); });
  $('widget-speed').onclick = () => launch('cockpit');
  $('widget-weather').onclick = () => launch('weather');

  // ---- nav bar
  $('nav-back').onclick = back;
  $('nav-home').onclick = () => goHome();
  $('nav-recents').onclick = () => (recents.classList.contains('hidden') ? openRecents() : closeRecents());
  recents.addEventListener('click', (e) => { if (e.target === recents) closeRecents(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') back();
    if (e.key === 'Home') goHome();
  });

  // Swipe up on the home screen opens the app drawer (Android gesture).
  let swipeY = null;
  home.addEventListener('pointerdown', (e) => { swipeY = e.clientY; });
  home.addEventListener('pointerup', (e) => {
    if (swipeY != null && swipeY - e.clientY > 90) openDrawer();
    swipeY = null;
  });

  // ---- live widgets and status
  const alertFor = {};
  function tick(frame, now) {
    const d = new Date();
    const clock = d.toTimeString().slice(0, 5);
    if (clock !== lastClock) { lastClock = clock; $('clock').textContent = clock; }

    if (frame && now - lastWidget > 150) {
      lastWidget = now;
      $('w-speed').textContent = Math.round(frame.speedKph);
      $('w-gear').textContent = frame.gear;
      $('w-rpm').style.width = `${Math.min(100, (frame.rpm / 12000) * 100)}%`;
      $('w-lap').textContent = `Lap ${frame.lap}`;
      const w = getWeather(Date.now());
      $('w-temp').textContent = `${Math.round(w.airC)}°`;
      $('w-cond').textContent = w.label;
      $('w-ico').innerHTML = icon(w.icon, 30);
    }

    if (frame) {
      const warn = frame.alerts.find((a) => a.level === 'warn');
      $('sb-alert').textContent = warn ? `⚠ ${warn.text}` : '';
      for (const a of frame.alerts) {
        if (a.level === 'warn' && now - (alertFor[a.key] || 0) > 15000) {
          alertFor[a.key] = now;
          toast(`Warning · ${a.text}`, 'warn');
        }
      }
      running.get(fg)?.inst.update?.(frame);
    }
  }

  function getForeground() { return fg; }
  renderDrawer();
  goHome();
  ctx.toast = toast;
  ctx.launch = launch;
  ctx.goHome = goHome;
  return { tick, toast, launch, goHome, back, getForeground, close: closeApp };
}

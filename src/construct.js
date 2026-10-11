// Construct menu — the ProjectZeroEditor-style creation modal:
// category nav, searchable tile grid, and the city generator form.
import { el } from './util.js';
import { svgIcon } from './icons.js';
import { PROFILES, PROFILE_CATEGORIES, profileWidth } from './profiles.js';
import { PROP_KINDS } from './props.js';

const RAIL_TILES = {
  'rail-line': {
    name: 'Rail mainline',
    icon: 'RailSymbol',
    desc: 'Draw ballast, sleepers & twin rails',
    action: 'draw-rail',
  },
  'subway-line': {
    name: 'Subway line',
    icon: 'TrainFront',
    desc: 'Twin tunnels with station boxes',
    action: 'draw-subway',
  },
  'crossing-gate': { name: 'Level crossing', icon: 'Split', desc: 'Gates, beacons, RR pavement', action: 'prop', kind: 'crossing-gate' },
  'crossing-signal': { name: 'Crossing signal', icon: 'Siren', desc: 'Crossbuck + twin red lamps', action: 'prop', kind: 'crossing-signal' },
  'subway-entrance': { name: 'Subway entrance', icon: 'TrainFront', desc: 'Glazed street kiosk', action: 'prop', kind: 'subway-entrance' },
  'platform-sign': { name: 'Platform sign', icon: 'Signpost', desc: 'Transit wayfinding blade', action: 'prop', kind: 'platform-sign' },
};

export function openConstruct(controller) {
  closeConstruct();
  const state = {
    tab: controller.lastConstructTab || 'roads',
    search: '',
    gen: controller.getGenParams(),
  };

  const backdrop = el('div', { class: 'construct-backdrop' });
  const panel = el('div', { class: 'construct-panel' });
  backdrop.append(panel);

  const close = () => {
    backdrop.remove();
    controller.onConstructClose?.();
  };
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });

  // ---------- header ----------
  panel.append(
    el('header', {},
      el('div', { class: 'construct-emblem', html: svgIcon('Construction', 19) }),
      el('div', {},
        el('h2', { text: 'Construct' }),
        el('p', { text: 'Roads · lanes · furniture · rail · subways · city generation' })
      ),
      el('div', { class: 'construct-engine', text: 'PROJECT ZERO UI' }),
      el('button', { class: 'construct-close', html: svgIcon('X', 17), onclick: close, 'aria-label': 'Close' })
    ),
    el('div', { class: 'construct-context' },
      el('span', {}, el('i', { class: 'construct-dot' }), `Scene · ${controller.getSceneName()}`),
      el('span', {}, `Snap ${controller.getSnap()} m`, el('kbd', { text: 'Esc' }), 'to close')
    )
  );

  // ---------- nav ----------
  const nav = el('nav', {});
  const tabs = [
    { id: 'roads', label: 'Roads', icon: 'Route', count: Object.keys(PROFILES).length },
    { id: 'furniture', label: 'Furniture', icon: 'TrafficCone', count: Object.keys(PROP_KINDS).length },
    { id: 'rail', label: 'Rail & Transit', icon: 'TrainFront', count: Object.keys(RAIL_TILES).length },
    { id: 'generate', label: 'Generate city', icon: 'Sparkles', count: null },
  ];
  const content = el('div', { class: 'construct-content' });
  const layout = el('div', { class: 'construct-layout' }, nav, content);

  function renderNav() {
    nav.innerHTML = '';
    nav.append(el('div', { class: 'construct-nav-caption', text: 'LIBRARY' }));
    for (const t of tabs) {
      nav.append(
        el('button', {
          class: state.tab === t.id ? 'active' : '',
          onclick: () => {
            state.tab = t.id;
            controller.lastConstructTab = t.id;
            render();
          },
        },
          el('span', { html: svgIcon(t.icon, 15) }),
          t.label,
          t.count != null ? el('small', { text: String(t.count) }) : el('small', { text: 'NEW' })
        )
      );
    }
    nav.append(
      el('div', { class: 'construct-nav-note' },
        el('div', { text: 'Draw with R · place with P' }),
        el('div', { text: 'WASD flies the camera' })
      )
    );
  }

  // ---------- tiles ----------
  function tile({ icon, name, desc, tag, onClick, selected }) {
    return el('button', {
      class: `construct-tile${selected ? ' selected' : ''}`,
      onclick: onClick,
    },
      el('span', { html: svgIcon(icon, 40) }),
      el('strong', { text: name }),
      el('span', { text: desc }),
      tag ? el('i', { class: 'tile-tag', text: tag }) : null
    );
  }

  function renderRoads() {
    content.append(renderSearch());
    for (const cat of PROFILE_CATEGORIES) {
      const items = Object.entries(PROFILES).filter(([, p]) => p.category === cat);
      if (!items.length) continue;
      if (!matches(items.map(([k, p]) => k + p.name + p.desc))) continue;
      content.append(
        el('div', { class: 'construct-section-title' },
          el('span', { text: cat }),
          el('span', { text: `${items.length} types` })
        )
      );
      const grid = el('div', { class: 'construct-grid' });
      for (const [key, p] of items) {
        if (!matches([key, p.name, p.desc])) continue;
        grid.append(tile({
          icon: p.icon,
          name: p.name,
          desc: p.desc,
          tag: `${p.speedLimit}`,
          selected: controller.getDrawProfile?.() === key,
          onClick: () => {
            controller.startDrawRoad(key);
            close();
          },
        }));
      }
      content.append(grid);
    }
  }

  function renderFurniture() {
    content.append(renderSearch());
    content.append(
      el('div', { class: 'construct-section-title' },
        el('span', { text: 'Street furniture' }),
        el('span', { text: 'click to place' })
      )
    );
    const grid = el('div', { class: 'construct-grid' });
    for (const [kind, meta] of Object.entries(PROP_KINDS)) {
      if (!matches([kind, meta.name, meta.desc])) continue;
      grid.append(tile({
        icon: meta.icon,
        name: meta.name,
        desc: meta.desc,
        tag: meta.group,
        onClick: () => {
          controller.startPlaceProp(kind);
          close();
        },
      }));
    }
    content.append(grid);
  }

  function renderRail() {
    content.append(renderSearch());
    content.append(
      el('div', { class: 'construct-section-title' },
        el('span', { text: 'Rail & transit' }),
        el('span', { text: 'draw or place' })
      )
    );
    const grid = el('div', { class: 'construct-grid' });
    for (const [key, t] of Object.entries(RAIL_TILES)) {
      if (!matches([key, t.name, t.desc])) continue;
      grid.append(tile({
        icon: t.icon === 'RailSymbol' ? 'RailSymbol' : t.icon,
        name: t.name,
        desc: t.desc,
        onClick: () => {
          if (t.action === 'draw-rail') controller.startDrawRail?.('rail');
          else if (t.action === 'draw-subway') controller.startDrawRail?.('subway');
          else if (t.action === 'prop') controller.startPlaceProp(t.kind);
          close();
        },
      }));
    }
    content.append(grid);
  }

  function renderGenerate() {
    const g = state.gen;
    content.append(
      el('div', { class: 'construct-section-title' },
        el('span', { text: 'Procedural city' }),
        el('span', { text: 'roads · rail · subway · river' })
      ),
      el('p', {
        class: 'construct-feedback-muted',
        text: 'Generates a hierarchical street grid with bus lanes, cycling lanes and parking lanes, a river with bridges, a mainline with a level crossing, an underground metro line and street furniture.',
        style: { lineHeight: '1.8', marginTop: '0' },
      }),
      el('div', { class: 'gen-rows' },
        genNum('Seed', 'Any integer', 'seed', g.seed),
        genNum('Blocks per axis', '4 – 8 works well', 'blocks', g.blocks),
        genToggle('Railway + level crossing', 'Mainline, sleepers, gates', 'rail', g.rail),
        genToggle('Subway line', 'Twin tunnels, stations, entrances', 'subway', g.subway),
        genToggle('River + bridges', 'Quayside promenades', 'river', g.river),
        genToggle('Bus network', 'Red bus lanes on main roads', 'busNetwork', g.busNetwork),
        genToggle('Cycle network', 'Protected green cycle tracks', 'bikeNetwork', g.bikeNetwork),
        genToggle('Parking lanes', 'Marked parallel parking bays', 'parking', g.parking),
        genToggle('Street furniture', 'Lights, bollards, trees, signs', 'furniture', g.furniture),
        genToggle('Speed bumps', 'Traffic calming on local streets', 'speedBumps', g.speedBumps),
      )
    );
  }

  function genNum(title, sub, key, value) {
    const input = el('input', {
      type: 'number',
      value: String(value),
      onchange: (e) => {
        state.gen[key] = Number(e.target.value) || 0;
      },
    });
    return el('div', { class: 'gen-row' },
      el('span', {}, title, el('small', { text: sub })),
      input
    );
  }

  function genToggle(title, sub, key, on) {
    return el('button', {
      class: 'gen-row',
      onclick: (e) => {
        state.gen[key] = !state.gen[key];
        e.currentTarget.querySelector('.switch').classList.toggle('on', state.gen[key]);
      },
    },
      el('span', {}, title, el('small', { text: sub })),
      el('i', { class: `switch${on ? ' on' : ''}` })
    );
  }

  function matches(parts) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return parts.some((p) => String(p).toLowerCase().includes(q));
  }

  function renderSearch() {
    const input = el('input', {
      placeholder: 'Search library…',
      value: state.search,
      oninput: (e) => {
        state.search = e.target.value;
        renderContent();
      },
    });
    const wrap = el('div', { class: 'construct-search' },
      el('span', { html: svgIcon('Search', 14) }),
      input,
      el('kbd', { text: '/' })
    );
    setTimeout(() => input.focus(), 30);
    return wrap;
  }

  function renderContent() {
    content.innerHTML = '';
    if (state.tab === 'roads') renderRoads();
    else if (state.tab === 'furniture') renderFurniture();
    else if (state.tab === 'rail') renderRail();
    else renderGenerate();
  }

  function render() {
    renderNav();
    renderContent();
    // footer
    panel.querySelector('.construct-panel footer')?.remove();
    panel.append(
      el('footer', {},
        el('label', {},
          el('input', {
            type: 'checkbox',
            checked: controller.getSnap() > 0,
            onchange: (e) => controller.setSnap(e.target.checked ? 5 : 0),
          }),
          'Snap to 5 m grid'
        ),
        el('span', { class: 'construct-feedback-muted', text: 'Enter confirms · Esc cancels · RMB camera' }),
        el('button', {
          class: 'construct-submit',
          onclick: () => {
            if (state.tab === 'generate') {
              controller.setGenParams(state.gen);
              controller.generateCity(state.gen);
            } else {
              controller.startDrawRoad(controller.getDrawProfile());
            }
            close();
          },
        },
          el('span', { html: svgIcon(state.tab === 'generate' ? 'Sparkles' : 'Route', 14) }),
          state.tab === 'generate' ? 'Generate City' : 'Draw Road'
        )
      )
    );
  }

  render();
  panel.append(layout);
  document.body.append(backdrop);

  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      window.removeEventListener('keydown', onKey, true);
    }
  };
  window.addEventListener('keydown', onKey, true);
  return close;
}

export function closeConstruct() {
  document.querySelectorAll('.construct-backdrop').forEach((n) => n.remove());
}

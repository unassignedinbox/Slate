import { svgIcon } from '../ui/icons.js';
import { h, toggle, button, toast } from '../ui/widgets.js';
import { state, set } from '../core/store.js';
import { resetDemo } from '../core/economy.js';

const ACCENTS = [
  { name: 'Ferrari red', hex: '#E10600' },
  { name: 'Cyan', hex: '#00D2FF' },
  { name: 'Amber', hex: '#FFC400' },
  { name: 'Mint', hex: '#2EE59D' },
  { name: 'Violet', hex: '#A66CFF' },
];

export default {
  id: 'settings',
  name: 'Settings',
  icon: svgIcon('settings'),
  color: '#6B7280',
  group: 'system',
  create() {
    const hud = toggle({ label: 'HUD mode (transparent panels)', value: state.settings.hud, onChange: (v) => set('settings.hud', v) });
    const online = toggle({ label: 'Online session', value: state.session.online, onChange: (v) => set('session.online', v) });
    const debug = toggle({ label: 'Show FPS counter', value: state.settings.showDebug, onChange: (v) => set('settings.showDebug', v) });

    const swatches = ACCENTS.map((a) => {
      const b = h('button', { class: 'swatch-btn', title: a.name, style: { background: a.hex }, onclick: () => { set('settings.accent', a.hex); toast(`Accent: ${a.name}`); } });
      b.dataset.hex = a.hex;
      return b;
    });

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left col' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Display' }),
          hud.el, debug.el),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Connectivity' }),
          online.el)),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Accent colour' }),
          h('div', { class: 'swatches' }, swatches)),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Keyboard' }),
          h('div', { class: 'keys' },
            h('span', { text: '1–9' }), h('span', { text: 'Open app by position' }),
            h('span', { text: 'H' }), h('span', { text: 'Home' }),
            h('span', { text: 'R' }), h('span', { text: 'Recents' }),
            h('span', { text: 'Esc' }), h('span', { text: 'Back' }),
            h('span', { text: 'Drag / wheel' }), h('span', { text: 'Orbit / zoom 3D' }))),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Demo data' }),
          button('Reset wallet and purchases', () => { resetDemo(); location.reload(); }, 'btn'))));

    return {
      el,
      update(s, path) {
        if (path !== '*' && !path.startsWith('settings') && !path.startsWith('session')) return;
        hud.set(s.settings.hud);
        online.set(s.session.online);
        debug.set(s.settings.showDebug);
        swatches.forEach((b) => b.classList.toggle('on', b.dataset.hex === s.settings.accent));
      },
    };
  },
};

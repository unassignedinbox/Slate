import { svgIcon } from '../ui/icons.js';
import { h, button, toast } from '../ui/widgets.js';
import { state, set } from '../core/store.js';
import { catalog, owns } from '../core/economy.js';
import { CarViewport } from '../render3d/scenes.js';

const LIVERIES = catalog.filter((i) => i.kind === 'livery');

export default {
  id: 'garage',
  name: 'Garage',
  icon: svgIcon('garage'),
  color: '#A66CFF',
  group: 'vehicle',
  create() {
    let vp = null;
    const host = h('div', { class: 'vp-host' }, h('div', { class: 'vp-label', text: 'GARAGE · LIVERY PREVIEW' }));
    const list = h('div', { class: 'card-list' });

    function renderList() {
      list.replaceChildren(...LIVERIES.map((l) => {
        const equipped = state.settings.liveryId === l.sku;
        const owned = owns(l.sku);
        const action = equipped ? h('span', { class: 'tag', text: 'Equipped' })
          : owned ? button('Equip', () => { set('settings.liveryId', l.sku); toast(`${l.name} equipped`); }, 'btn primary')
          : button(`Buy · ${l.price.toLocaleString('en-US')} CR`, () => toast('Buy this livery in the Store'), 'btn');
        return h('div', { class: 'lobby-row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'swatch', style: { background: l.color } }),
            h('div', {},
              h('div', { class: 'lobby-name', text: l.name }),
              h('div', { class: 'dim', text: l.desc }))),
          action);
      }));
    }

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left' }, host),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' }, h('div', { class: 'card-title', text: 'Liveries' }), list)));

    return {
      el,
      mount() { vp ??= new CarViewport(host, { autoRotate: 0.3 }); renderList(); },
      unmount() { vp?.dispose(); vp = null; },
      update(_s, path) {
        if (path === '*' || path === 'wallet' || path === 'settings.liveryId') renderList();
      },
    };
  },
};

import { svgIcon } from '../ui/icons.js';
import { h, button, toast } from '../ui/widgets.js';
import { catalog, owns, buy } from '../core/economy.js';

export default {
  id: 'store',
  name: 'Store',
  icon: svgIcon('store'),
  color: '#FF5C8A',
  group: 'online',
  create() {
    const grid = h('div', { class: 'card-grid' });
    let balance = 0;

    function render() {
      grid.replaceChildren(...catalog.map((item) => {
        const owned = owns(item.sku);
        const canAfford = balance >= item.price;
        const action = owned
          ? h('span', { class: 'tag', text: item.price ? 'Owned' : 'Included' })
          : button(canAfford ? `Buy · ${item.price.toLocaleString('en-US')} CR` : 'Not enough CR', () => {
            const r = buy(item.sku);
            toast(r.ok ? `Purchased ${item.name}` : r.reason);
          }, canAfford ? 'btn primary' : 'btn');
        return h('div', { class: 'item-card' },
          h('div', { class: 'item-kind', text: item.kind.toUpperCase() }),
          h('div', { class: 'item-name', text: item.name }),
          h('div', { class: 'dim', text: item.desc }),
          h('div', { class: 'item-foot' }, action));
      }));
    }

    const el = h('div', { class: 'store' },
      h('div', { class: 'card-title', text: 'Store · spend CR on upgrades that unlock across apps' }),
      grid);

    return {
      el,
      update(s, path) {
        balance = s.wallet.balance;
        if (path === '*' || path === 'wallet') render();
      },
    };
  },
};

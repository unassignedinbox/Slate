import { svgIcon } from '../ui/icons.js';
import { h, setText, button, toast } from '../ui/widgets.js';
import { catalog, owns, grantCredits } from '../core/economy.js';

export default {
  id: 'wallet',
  name: 'Wallet',
  icon: svgIcon('wallet'),
  color: '#FFC400',
  group: 'online',
  create() {
    const bal = h('div', { class: 'balance' }, '—');
    const txns = h('div', { class: 'txn-list' });
    const items = h('div', { class: 'chips' });

    function render(s) {
      setText(bal, `${s.wallet.balance.toLocaleString('en-US')} CR`);
      txns.replaceChildren(...(s.wallet.txns.length
        ? s.wallet.txns.slice(0, 12).map((t) => h('div', { class: 'txn' },
          h('span', { text: t.label }),
          h('span', { class: t.amount < 0 ? 'neg' : 'pos', text: `${t.amount > 0 ? '+' : ''}${t.amount.toLocaleString('en-US')}` })))
        : [h('div', { class: 'dim', text: 'No transactions yet' })]));
      items.replaceChildren(...catalog.filter((i) => owns(i.sku)).map((i) => h('span', { class: 'chip on', text: i.name })));
    }

    const el = h('div', { class: 'split' },
      h('div', { class: 'card hero' },
        h('div', { class: 'card-title', text: 'Balance' }),
        bal,
        h('div', { class: 'btn-row' },
          button('Top up 1,000 CR (demo)', () => { grantCredits(1000, 'Demo top-up'); toast('+1,000 CR'); }, 'btn primary'))),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' }, h('div', { class: 'card-title', text: 'Owned' }), items),
        h('div', { class: 'card grow' }, h('div', { class: 'card-title', text: 'Recent transactions' }), txns)));

    return {
      el,
      update(s, path) { if (path === '*' || path === 'wallet') render(s); },
    };
  },
};

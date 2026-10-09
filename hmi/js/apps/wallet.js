// Wallet & Store: balance, transfers, transaction history, and a store for liveries and setup
// packs. Every money-changing action is async and validated by the (mock) account service.
import { el, fmt } from '../ui.js';
import { CATALOG } from '../backend.js';

const money = (n) => `${n.toLocaleString('en-US')} CR`;

export default {
  id: 'wallet', name: 'Wallet', icon: 'wallet', color: '#eab308',
  open(body, ctx) {
    const backend = ctx.backend;
    const tabs = ['Wallet', 'Store'];
    let tab = 'Wallet';
    const tabBar = el('div', { class: 'seg-row tabs' });
    const content = el('div', { class: 'wallet-content' });
    body.append(el('div', { class: 'wallet' }, tabBar, content));

    const drawTabs = () => {
      tabBar.replaceChildren(...tabs.map((t) => el('button', {
        class: `seg ${t === tab ? 'on' : ''}`,
        onclick: () => { tab = t; render(); },
      }, t)));
    };

    function walletView() {
      const acc = backend.account;
      const handle = el('input', { type: 'text', placeholder: 'Driver handle', maxlength: 24, class: 'input' });
      const amount = el('input', { type: 'number', placeholder: 'Amount', min: 1, class: 'input', style: { width: '140px' } });
      const send = el('button', { class: 'btn primary', onclick: async () => {
        send.disabled = true;
        try {
          const amt = Math.floor(Number(amount.value));
          if (!handle.value.trim()) throw new Error('Enter a driver handle');
          await backend.transfer(handle.value.trim(), amt);
          ctx.toast(`Sent ${money(amt)} to ${handle.value.trim()}`, 'info');
          amount.value = '';
        } catch (err) {
          ctx.toast(err.message, 'warn');
        } finally { send.disabled = false; }
      } }, 'Send');
      return [
        el('section', { class: 'balance card' },
          el('div', {}, el('span', { class: 'muted' }, 'Available balance'), el('div', { class: 'big', id: 'bal' }, money(acc.balance))),
          el('div', { class: 'muted' }, `${acc.handle} · ${acc.id}`)),
        el('div', { class: 'wallet-split' },
          el('section', { class: 'card' },
            el('h3', {}, 'Send credits'),
            el('div', { class: 'row' }, handle, amount, send),
            el('p', { class: 'footnote' }, 'Transfers are validated by the account service.')),
          el('section', { class: 'card tx' },
            el('h3', {}, 'Activity'),
            el('div', { class: 'tx-list' }, acc.tx.slice(0, 12).map((t) => el('div', { class: 'tx-row' },
              el('span', {}, t.label), el('b', { class: t.amount < 0 ? 'neg' : 'pos' }, `${t.amount < 0 ? '−' : '+'}${Math.abs(t.amount).toLocaleString('en-US')}`)))))),
      ];
    }

    function storeView() {
      const acc = backend.account;
      const liveryCards = CATALOG.liveries.map((l) => {
        const owned = acc.owned.includes(l.id);
        const equipped = acc.equippedLivery === l.id;
        const btn = el('button', { class: 'btn', onclick: async () => {
          btn.disabled = true;
          try {
            if (!owned) {
              await backend.purchase(l.id);
              ctx.toast(`Purchased ${l.name}`, 'info');
            }
            await backend.equipLivery(l.id);
            ctx.bus.emit('livery', l.color);
            ctx.toast(`${l.name} equipped`, 'info');
          } catch (err) { ctx.toast(err.message, 'warn'); }
          finally { btn.disabled = false; }
        } }, equipped ? 'Equipped' : owned ? 'Equip' : `Buy · ${l.price.toLocaleString('en-US')}`);
        if (equipped) btn.disabled = true;
        return el('div', { class: 'item card', style: { '--c': l.color } },
          el('div', { class: 'swatch' }), el('strong', {}, l.name), el('small', { class: 'muted' }, l.blurb), btn);
      });
      const setupCards = CATALOG.setups.map((s) => {
        const owned = acc.owned.includes(s.id);
        const btn = el('button', { class: 'btn', onclick: async () => {
          btn.disabled = true;
          try {
            if (!owned) {
              await backend.purchase(s.id);
              ctx.toast(`Purchased ${s.name}`, 'info');
            }
            ctx.sim.set(s.settings);
            ctx.toast(`${s.name} applied to the car`, 'info');
            render();
          } catch (err) { ctx.toast(err.message, 'warn'); }
          finally { btn.disabled = false; }
        } }, owned ? 'Apply' : `Buy · ${s.price.toLocaleString('en-US')}`);
        return el('div', { class: 'item card' }, el('strong', {}, s.name), el('small', { class: 'muted' }, s.blurb), btn);
      });
      return [
        el('h3', {}, 'Liveries · cosmetic'),
        el('div', { class: 'grid-items' }, liveryCards),
        el('h3', {}, 'Setup packs · applied to the car'),
        el('div', { class: 'grid-items' }, setupCards),
        el('p', { class: 'footnote' }, `Balance ${money(acc.balance)}`),
      ];
    }

    function render() {
      drawTabs();
      content.replaceChildren(...(tab === 'Wallet' ? walletView() : storeView()));
    }

    const unsub = backend.subscribe(() => render());
    render();
    return { destroy() { unsub(); } };
  },
};

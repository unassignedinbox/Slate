// Wallet & Store: credits, liveries and setup packs, transfers and transaction history.
// Every money-changing call goes through the backend (async, server-validated in production).
import { el } from '../ui.js';
import { tabs, openSheet } from '../kit.js';

const money = (n) => `${Math.round(n).toLocaleString('en-ZA')} cr`;

export default {
  id: 'wallet', name: 'Store', icon: 'wallet', color: '#eab308',
  open(body, ctx) {
    const backend = ctx.backend;
    let view = 'store';
    let category = 'all';
    let busy = false;

    // ---- header: balance always visible
    const balanceEl = el('b', { class: 'st-balance' }, money(backend.account.balance));
    const handleEl = el('span', { class: 'muted' }, `${backend.account.handle} · ${backend.account.id}`);
    const header = el('section', { class: 'k-card st-head' },
      el('div', {}, el('span', { class: 'k-cap' }, 'BALANCE'), balanceEl, handleEl),
      el('div', { class: 'st-head-r' }, tabs([['store', 'Store'], ['wallet', 'Wallet']], view, (k) => { view = k; render(); }).root));

    const content = el('div', { class: 'st-content' });
    body.append(header, content);

    const unsub = backend.subscribe(() => { balanceEl.textContent = money(backend.account.balance); render(); });

    const owned = (id) => backend.account.owned.includes(id);
    const equippedLivery = () => backend.account.equippedLivery;

    function itemCard(item, kind) {
      const isLivery = kind === 'livery';
      const isOwned = owned(item.id);
      const isEquipped = isLivery && equippedLivery() === item.id;
      const visual = isLivery
        ? el('div', { class: 'st-swatch', style: { background: `linear-gradient(135deg, ${item.color}, #0b1116 85%)` } })
        : el('div', { class: 'st-setup-ico' }, el('span', {}, item.name.split(' ')[0].slice(0, 2).toUpperCase()));
      const price = item.price === 0 ? 'Included' : money(item.price);
      const badge = isEquipped ? el('span', { class: 'k-badge ok' }, 'Equipped') : isOwned ? el('span', { class: 'k-badge' }, 'Owned') : null;
      return el('button', { class: `k-card st-item ${isEquipped ? 'equipped' : ''}`, onclick: () => openItem(item, kind) },
        visual,
        el('div', { class: 'st-item-body' },
          el('div', { class: 'st-item-h' }, el('strong', {}, item.name), badge),
          el('small', { class: 'muted' }, item.blurb)),
        el('span', { class: `st-price ${isOwned ? 'owned' : ''}` }, isOwned ? (isLivery ? (isEquipped ? 'In use' : 'Owned') : 'Owned') : price));
    }

    function openItem(item, kind) {
      const isLivery = kind === 'livery';
      const isOwned = owned(item.id);
      const after = backend.account.balance - (isOwned ? 0 : item.price);
      const details = el('div', { class: 'st-detail' },
        isLivery
          ? el('div', { class: 'st-detail-swatch', style: { background: `linear-gradient(135deg, ${item.color}, #0b1116 85%)` } })
          : el('div', { class: 'st-detail-setup' }, settingsList(item.settings)),
        el('p', { class: 'st-detail-blurb' }, item.blurb),
        el('div', { class: 'st-detail-price' },
          el('span', {}, isOwned ? 'You own this' : 'Price'),
          el('b', {}, isOwned ? '—' : money(item.price))),
        !isOwned ? el('div', { class: 'st-after' }, el('span', {}, 'Balance after purchase'), el('b', {}, money(after))) : null);

      const actions = [];
      const close = () => sheet.close();
      const run = async (fn, okMsg) => {
        if (busy) return;
        busy = true;
        try {
          await fn();
          ctx.toast(okMsg, 'info');
          close();
        } catch (err) {
          ctx.toast(err.message, 'warn');
        } finally {
          busy = false;
          render();
        }
      };
      actions.push(el('button', { class: 'k-btn ghost', onclick: close }, 'Close'));
      if (isLivery) {
        if (!isOwned) {
          const label = item.price > 0 ? `Buy & equip · ${money(item.price)}` : 'Get & equip';
          actions.push(el('button', {
            class: 'k-btn primary', disabled: backend.account.balance < item.price,
            onclick: () => run(async () => { await backend.purchase(item.id); await backend.equipLivery(item.id); ctx.bus.emit('livery', item.color); }, `${item.name} equipped`),
          }, label));
        } else if (equippedLivery() !== item.id) {
          actions.push(el('button', { class: 'k-btn primary', onclick: () => run(async () => { await backend.equipLivery(item.id); ctx.bus.emit('livery', item.color); }, `${item.name} equipped`) }, 'Equip'));
        }
      } else {
        if (!isOwned) actions.push(el('button', { class: 'k-btn primary', disabled: backend.account.balance < item.price, onclick: () => run(async () => { await backend.purchase(item.id); ctx.sim.set(item.settings); }, `${item.name} bought and applied`) }, `Buy & apply · ${money(item.price)}`));
        else actions.push(el('button', { class: 'k-btn primary', onclick: () => run(async () => { ctx.sim.set(item.settings); }, `${item.name} applied to the car`) }, 'Apply to car'));
      }
      const sheet = openSheet(body, { title: item.name, content: details, actions });
    }

    function settingsList(s) {
      const rows = [
        ['Ride height', `${s.rideHeight > 0 ? '+' : ''}${s.rideHeight} mm`],
        ['Spring rate', `${Math.round(s.springRate * 100)}%`],
        ['Damping', `${Math.round(s.damping * 100)}%`],
        ['Front / rear wing', `${Math.round(s.wingFront * 100)}% / ${Math.round(s.wingRear * 100)}%`],
        ['Compound', s.compound],
      ];
      return el('dl', { class: 'st-dl' }, rows.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v))));
    }

    function storeView() {
      const cats = [['all', 'All'], ['setups', 'Setup packs'], ['liveries', 'Liveries']];
      const chips = el('div', { class: 'st-cats' }, cats.map(([k, label]) => el('button', {
        class: `k-chip ${category === k ? 'on' : ''}`, onclick: () => { category = k; render(); },
      }, label)));
      const items = [];
      if (category !== 'liveries') items.push(...backend.catalog.setups.map((s) => itemCard(s, 'setup')));
      if (category !== 'setups') items.push(...backend.catalog.liveries.map((l) => itemCard(l, 'livery')));
      return [chips, el('div', { class: 'st-grid' }, items), el('p', { class: 'footnote' }, 'Purchases are validated by the store service. Setup packs apply to the car immediately.')];
    }

    function walletView() {
      const amount = el('input', { class: 'input', type: 'number', min: 1, placeholder: 'Amount', style: { width: '120px' } });
      const to = el('input', { class: 'input', placeholder: 'Driver handle', style: { flex: 1 } });
      const send = el('button', {
        class: 'k-btn primary',
        onclick: async () => {
          if (busy) return;
          busy = true;
          try {
            await backend.transfer(to.value.trim(), Number(amount.value));
            ctx.toast(`Sent ${money(Number(amount.value))} to ${to.value.trim()}`, 'info');
            to.value = ''; amount.value = '';
          } catch (err) { ctx.toast(err.message, 'warn'); }
          finally { busy = false; render(); }
        },
      }, 'Send');
      const txList = el('div', { class: 'st-tx' }, backend.account.tx.slice(0, 12).map((t) => el('div', { class: 'st-tx-row' },
        el('div', {}, el('strong', {}, t.label), el('small', { class: 'muted' }, new Date(t.at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }))),
        el('b', { class: t.amount < 0 ? 'neg' : 'pos' }, `${t.amount < 0 ? '−' : '+'}${Math.abs(t.amount).toLocaleString('en-ZA')}`))));
      return el('div', { class: 'st-wallet' },
        el('section', { class: 'k-card st-send' }, el('div', { class: 'k-cap' }, 'SEND CREDITS'), el('div', { class: 'row' }, to, amount, send)),
        el('section', { class: 'k-card st-history' }, el('div', { class: 'k-cap' }, 'HISTORY'), txList));
    }

    function render() {
      content.replaceChildren(...(view === 'store' ? storeView() : [walletView()]));
    }
    render();

    return {
      update() {},
      destroy() { unsub(); },
    };
  },
};

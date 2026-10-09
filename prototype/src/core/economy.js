// Wallet + Store. Local mock of the server described in docs/HMI_DESIGN.md §9.
import { state, notify } from './store.js';

const KEY = 'slate.economy.v1';

export const catalog = [
  { sku: 'TYRE_SOFT',       kind: 'tyre',   name: 'Soft compound',   price: 0,    desc: 'Maximum grip, short life. Included.' },
  { sku: 'TYRE_MEDIUM',     kind: 'tyre',   name: 'Medium compound', price: 0,    desc: 'Balanced grip and life. Included.' },
  { sku: 'TYRE_HARD',       kind: 'tyre',   name: 'Hard compound',   price: 1500, desc: 'Long life, lower grip. Unlocks in Tyres.' },
  { sku: 'LIVERY_RACING',   kind: 'livery', name: 'Racing Green',    price: 0,    color: '#1B5E3A', desc: 'Team base livery. Included.' },
  { sku: 'LIVERY_CARBON',   kind: 'livery', name: 'Carbon Red',      price: 2000, color: '#B3131B', desc: 'Gloss carbon with red accents.' },
  { sku: 'LIVERY_MIDNIGHT', kind: 'livery', name: 'Midnight Blue',   price: 2000, color: '#14284B', desc: 'Deep blue with a silver pinstripe.' },
  { sku: 'AERO_LOWDRAG',    kind: 'aero',   name: 'Low-drag kit',    price: 2500, desc: 'Unlocks the Low-drag preset in Aero.' },
  { sku: 'SOUND_V12',       kind: 'sound',  name: 'V12 engine pack', price: 800,  desc: 'Cosmetic engine audio cue set.' },
];

const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } })();
const owned = new Set(saved?.owned ?? []);
catalog.filter((i) => i.price === 0).forEach((i) => owned.add(i.sku));
if (saved?.balance != null) state.wallet.balance = saved.balance;
state.wallet.txns = saved?.txns ?? [];
state.wallet.owned = owned;

function persist() {
  localStorage.setItem(KEY, JSON.stringify({
    balance: state.wallet.balance,
    txns: state.wallet.txns.slice(0, 50),
    owned: [...owned],
  }));
}

export const owns = (sku) => owned.has(sku);

export function liveryColor(id) {
  return catalog.find((i) => i.sku === id)?.color ?? '#1B5E3A';
}

export function buy(sku) {
  const item = catalog.find((i) => i.sku === sku);
  if (!item) return { ok: false, reason: 'Unknown item' };
  if (owned.has(sku)) return { ok: false, reason: 'Already owned' };
  if (state.wallet.balance < item.price) return { ok: false, reason: 'Not enough CR' };
  state.wallet.balance -= item.price;
  owned.add(sku);
  state.wallet.txns.unshift({ t: Date.now(), label: `Bought ${item.name}`, amount: -item.price });
  persist();
  notify('wallet');
  return { ok: true };
}

export function grantCredits(amount, label) {
  state.wallet.balance += amount;
  state.wallet.txns.unshift({ t: Date.now(), label, amount });
  persist();
  notify('wallet');
}

export function resetDemo() {
  localStorage.removeItem(KEY);
}

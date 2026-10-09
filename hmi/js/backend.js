// Mock online services. The real build replaces this module with a client for the
// authoritative match / account server (WebSocket or HTTPS). The API shape is what matters:
// every money-changing call is async and server-validated, the HMI never trusts its own balance.
const KEY = 'slate.account.v1';

export const CATALOG = {
  liveries: [
    { id: 'liv_teal', name: 'Slate Teal', price: 0, color: '#2ee6c5', blurb: 'Default livery' },
    { id: 'liv_ember', name: 'Ember Race', price: 1800, color: '#ff7a3d', blurb: 'Hot orange race scheme' },
    { id: 'liv_ghost', name: 'Ghost Chrome', price: 2400, color: '#cfd8e3', blurb: 'Brushed chrome finish' },
    { id: 'liv_volt', name: 'Volt Yellow', price: 1500, color: '#ffd60a', blurb: 'High-visibility yellow' },
  ],
  setups: [
    {
      id: 'setup_wet', name: 'Wet Weather Pack', price: 900,
      blurb: 'Higher ride, softer springs, hard tyres, more front wing',
      settings: { rideHeight: 12, springRate: 0.35, damping: 0.7, antiRoll: 0.4, wingRear: 0.8, wingFront: 0.7, compound: 'hard' },
    },
    {
      id: 'setup_street', name: 'Technical Track Pack', price: 1100,
      blurb: 'Stiff setup and soft tyres for slow corners',
      settings: { rideHeight: -8, springRate: 0.7, damping: 0.6, antiRoll: 0.7, wingRear: 0.9, wingFront: 0.8, compound: 'soft' },
    },
    {
      id: 'setup_speed', name: 'Top Speed Pack', price: 1200,
      blurb: 'Low drag for long straights',
      settings: { rideHeight: -4, springRate: 0.5, damping: 0.4, antiRoll: 0.5, wingRear: 0.1, wingFront: 0.2, compound: 'medium' },
    },
  ],
};

export const liveryColor = (id) => CATALOG.liveries.find((l) => l.id === id)?.color ?? '#2ee6c5';

const findItem = (id) =>
  [...CATALOG.liveries, ...CATALOG.setups].find((i) => i.id === id);

const latency = () => new Promise((r) => setTimeout(r, 350 + Math.random() * 350));

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.balance != null) return saved;
  } catch (_) { /* fall through to a fresh account */ }
  return {
    handle: 'Driver_Slate', id: 'SLT-2291', balance: 12450,
    owned: ['liv_teal'], equippedLivery: 'liv_teal',
    tx: [
      { id: 'tx1', label: 'Welcome bonus', amount: 10000, at: Date.now() - 86400e3 },
      { id: 'tx2', label: 'Race reward · Monza Sprint', amount: 2450, at: Date.now() - 3600e3 },
    ],
  };
}

export function createBackend() {
  const acc = load();
  const listeners = new Set();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(acc)); } catch (_) { /* private mode */ }
    listeners.forEach((fn) => fn(acc));
  };

  return {
    account: acc,
    catalog: CATALOG,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async purchase(id) {
      await latency();
      const item = findItem(id);
      if (!item) throw new Error('Unknown item');
      if (acc.owned.includes(id)) throw new Error('Already owned');
      if (acc.balance < item.price) throw new Error('Insufficient credits');
      acc.balance -= item.price;
      acc.owned.push(id);
      acc.tx.unshift({ id: `tx${Date.now()}`, label: `Purchase · ${item.name}`, amount: -item.price, at: Date.now() });
      save();
      return item;
    },

    async equipLivery(id) {
      await latency();
      if (!acc.owned.includes(id)) throw new Error('Not owned');
      acc.equippedLivery = id;
      save();
      return findItem(id);
    },

    async transfer(toHandle, amount) {
      await latency();
      if (!(amount > 0)) throw new Error('Enter an amount');
      if (amount > acc.balance) throw new Error('Insufficient credits');
      acc.balance -= amount;
      acc.tx.unshift({ id: `tx${Date.now()}`, label: `Sent to ${toHandle}`, amount: -amount, at: Date.now() });
      save();
      return amount;
    },
  };
}

// Online lobby (simulated presence). Offsets are metres behind the local car on track.
export const LOBBY = [
  { handle: 'Vortex_K', offset: 320, ping: 24, car: '#ff7a3d', ready: true },
  { handle: 'NightLine', offset: -180, ping: 41, car: '#ffd60a', ready: true },
  { handle: 'Mira.R', offset: 610, ping: 33, car: '#cfd8e3', ready: false },
  { handle: 'ApexFox', offset: -760, ping: 58, car: '#8b5cf6', ready: true },
  { handle: 'TorqueQueen', offset: 1250, ping: 19, car: '#22c55e', ready: false },
  { handle: 'Gridlock', offset: -1480, ping: 71, car: '#ef4444', ready: true },
  { handle: 'Slipstream_9', offset: 2100, ping: 46, car: '#38bdf8', ready: true },
];

export const ROOMS = [
  { id: 'r1', name: 'Monza Sprint · Ranked', players: '6/8', tier: 'Gold', ping: 32 },
  { id: 'r2', name: 'Night Street · Casual', players: '3/12', tier: 'Open', ping: 27 },
  { id: 'r3', name: 'Endurance 6h · Team', players: '11/20', tier: 'Pro', ping: 49 },
];

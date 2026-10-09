// Tiny observable store. Views subscribe; core services write.
// Mirrors the "state in, intents out" rule from docs/HMI_DESIGN.md §4.
const listeners = new Set();

export const state = {
  vehicle: {
    speedKmh: 0, gear: 1, rpm: 4000, throttle: 0, brake: 0, steerDeg: 0,
    drs: 'off', position: 3, lap: 1, lapsTotal: 50, lapProgress: 0,
    suspension: {
      travelMm: { FL: 45, FR: 45, RL: 45, RR: 45 },
      springRate: { front: 180, rear: 210 },
      damper: { bump: 6, rebound: 8 },
      antiRollBar: { front: 3, rear: 5 },
    },
    tyres: {
      FL: { tempC: 80, pressureBar: 2.1, wearPct: 0, compound: 'soft' },
      FR: { tempC: 80, pressureBar: 2.1, wearPct: 0, compound: 'soft' },
      RL: { tempC: 80, pressureBar: 2.1, wearPct: 0, compound: 'soft' },
      RR: { tempC: 80, pressureBar: 2.1, wearPct: 0, compound: 'soft' },
    },
    aero: { frontWingDeg: 12, rearWingDeg: 18, downforceN: 0, dragN: 0 },
  },
  weather: { airTempC: 24, trackTempC: 39, humidityPct: 48, rainIntensity: 0, windKmh: 11, windDeg: 240 },
  session: { online: true, lobbyId: null, players: 8 },
  settings: {
    accent: '#E10600', hud: false, weatherOverride: 'auto',
    showDebug: false, liveryId: 'LIVERY_RACING',
  },
  wallet: { currency: 'CR', balance: 12500, txns: [], owned: new Set() },
  time: 0,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Write a value at a dotted path (e.g. 'settings.hud') and notify listeners.
export function set(path, value) {
  const keys = path.split('.');
  let node = state;
  for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]];
  node[keys[keys.length - 1]] = value;
  notify(path);
}

export function notify(path = '*') {
  listeners.forEach((fn) => fn(state, path));
}

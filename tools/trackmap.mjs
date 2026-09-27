/**
 * Renders the circuit layout to docs/track-map.svg straight from the spline
 * used by the game, so the design doc can never drift from the code.
 *
 *   node tools/trackmap.mjs
 */
import fs from 'node:fs';

function ctx2d() {
  const noop = () => {};
  return new Proxy(
    {
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createLinearGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 10 }),
    },
    { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) }
  );
}
globalThis.document = { createElement: () => ({ getContext: () => ctx2d(), style: {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {} };

const { Track } = await import('../src/track.js');
const { LANDMARKS } = await import('../src/trackData.js');

const track = new Track();
const W = 1100;
const H = 680;
const pad = 70;

let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (let i = 0; i < track.N; i++) {
  const c = track.centers[i];
  const hw = track.widths[i] + 6;
  minX = Math.min(minX, c.x - hw);
  maxX = Math.max(maxX, c.x + hw);
  minZ = Math.min(minZ, c.z - hw);
  maxZ = Math.max(maxZ, c.z + hw);
}
const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
const ox = pad + (W - pad * 2 - (maxX - minX) * s) / 2 - minX * s;
const oz = pad + (H - pad * 2 - (maxZ - minZ) * s) / 2 - minZ * s;
const P = (x, z) => [(x * s + ox).toFixed(1), (z * s + oz).toFixed(1)];

const maxY = Math.max(...track.centers.map((c) => c.y));
const quads = [];
for (let i = 0; i < track.N; i++) {
  const j = (i + 1) % track.N;
  const a = track.pointAt(i, -track.widths[i]);
  const b = track.pointAt(i, track.widths[i]);
  const c = track.pointAt(j, track.widths[j]);
  const d = track.pointAt(j, -track.widths[j]);
  const y = (track.centers[i].y + track.centers[j].y) / 2;
  const t = y / maxY;
  const col = `rgb(${Math.round(36 + t * 30)},${Math.round(44 + t * 90)},${Math.round(60 + t * 120)})`;
  const bank = Math.abs(track.banks[i]);
  quads.push({
    y,
    d: `M${P(a.x, a.z)} L${P(b.x, b.z)} L${P(c.x, c.z)} L${P(d.x, d.z)} Z`,
    col,
    bank,
  });
}
quads.sort((p, q) => p.y - q.y);

const body = quads
  .map((q) => `<path d="${q.d}" fill="${q.col}" stroke="${q.col}" stroke-width="0.6"/>`)
  .join('\n');

// centre line + banking hatch on the heavily banked sections
let banked = '';
for (let i = 0; i < track.N; i += 4) {
  if (Math.abs(track.banks[i]) < 0.25) continue;
  const a = track.pointAt(i, -track.widths[i]);
  const b = track.pointAt(i, track.widths[i]);
  banked += `<line x1="${P(a.x, a.z)[0]}" y1="${P(a.x, a.z)[1]}" x2="${P(b.x, b.z)[0]}" y2="${P(b.x, b.z)[1]}" stroke="#ff9f1c" stroke-width="0.7" opacity="0.5"/>\n`;
}

// racing line
let line = '';
for (let i = 0; i < track.N; i += 3) {
  const c = track.centers[i];
  line += `${i === 0 ? 'M' : 'L'}${P(c.x, c.z)} `;
}
line += 'Z';

// start/finish
const si = track.startIndex;
const sa = track.pointAt(si, -track.widths[si]);
const sb = track.pointAt(si, track.widths[si]);

const labels = LANDMARKS.map((l) => {
  const [x, y] = P(l.x, l.z);
  return `<g><circle cx="${x}" cy="${y}" r="3.5" fill="#ff3fa8"/><text x="${Number(x) + 8}" y="${Number(y) + 4}" fill="#cfe3f2" font-size="13" font-family="Helvetica,Arial" letter-spacing="1.5">${l.name}</text></g>`;
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0a0f1a"/><stop offset="1" stop-color="#05070c"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g opacity="0.12" stroke="#2fe6ff">
${Array.from({ length: 22 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${H}" stroke-width="0.5"/>`).join('')}
${Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="${W}" y2="${i * 50}" stroke-width="0.5"/>`).join('')}
</g>
<ellipse cx="${P(0, 0)[0]}" cy="${P(0, 0)[1]}" rx="${430 * s}" ry="${235 * s}" fill="none" stroke="#2a3446" stroke-width="2" stroke-dasharray="6 6"/>
${body}
${banked}
<path d="${line}" fill="none" stroke="#2fe6ff" stroke-width="1.1" stroke-dasharray="7 9" opacity="0.65"/>
<line x1="${P(sa.x, sa.z)[0]}" y1="${P(sa.x, sa.z)[1]}" x2="${P(sb.x, sb.z)[0]}" y2="${P(sb.x, sb.z)[1]}" stroke="#ffb01e" stroke-width="4"/>
${labels}
<g font-family="Helvetica,Arial" fill="#ffb01e">
  <text x="30" y="46" font-size="30" font-weight="bold" letter-spacing="8">MOTORBALL · IRON CITY CIRCUIT</text>
  <text x="30" y="68" font-size="13" fill="#7fa7c4" letter-spacing="3">${(track.length / 1000).toFixed(2)} KM · ${(
  (Math.max(...track.banks.map(Math.abs)) * 180) /
  Math.PI
).toFixed(0)}° MAX BANKING · ${maxY.toFixed(0)} M CROSSOVER · ${(track.widths.reduce((a, b) => a + b, 0) / track.N * 2).toFixed(0)} M AVG WIDTH</text>
</g>
<g font-family="Helvetica,Arial" font-size="12" fill="#7fa7c4">
  <rect x="30" y="${H - 86}" width="14" height="10" fill="rgb(36,44,60)"/><text x="52" y="${H - 77}">ground level (tunnel / undercross)</text>
  <rect x="30" y="${H - 66}" width="14" height="10" fill="rgb(66,134,180)"/><text x="52" y="${H - 57}">elevated deck (up to ${maxY.toFixed(0)} m — the bridge)</text>
  <line x1="30" y1="${H - 41}" x2="44" y2="${H - 41}" stroke="#ff9f1c" stroke-width="3"/><text x="52" y="${H - 37}">heavily banked trough (&gt;14°)</text>
  <line x1="30" y1="${H - 21}" x2="44" y2="${H - 21}" stroke="#ffb01e" stroke-width="4"/><text x="52" y="${H - 17}">start / finish gantry</text>
</g>
</svg>
`;

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/track-map.svg', svg);
console.log(`docs/track-map.svg written — ${(track.length / 1000).toFixed(2)} km, ${track.N} samples`);

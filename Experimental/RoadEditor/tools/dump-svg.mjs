// Renders the network to an SVG so the layout can be eyeballed without a browser.
import { generateCity, PRESETS } from '../src/citygen.js';
import { writeFileSync } from 'node:fs';

const preset = process.argv[2] || 'city';
const seed = Number(process.argv[3] || 20261012);
const out = process.argv[4] || '/tmp/network.svg';
const P = { ...PRESETS[preset], preset, seed };
const { net, terrain } = generateCity(P);
const S = net.extent;
const sc = 1100 / S;
const X = (x) => (x + S / 2) * sc;
const Y = (y) => 1100 - (y + S / 2) * sc;
const colour = { motorway:'#ff5252', trunk:'#ffb142', arterial:'#ffe066', collector:'#c8f56b', local:'#8fd3ff', alley:'#7d8bff', service:'#b39ddb', rural:'#a5d6a7', canyon:'#26c6da', footway:'#f48fb1', cycleway:'#69f0ae', tram:'#ffab91', roundabout:'#ffd54f', ramp:'#ff7043', bridge:'#4dd0e1', transit:'#f06292', living:'#b0bec5', track:'#bcaaa4' };
const w = { motorway:5, trunk:4.2, arterial:3.4, collector:2.4, local:1.6, alley:1.1, service:1.4, rural:1.6, canyon:1.8, footway:0.8, cycleway:1.0, ramp:2.0, transit:2.6 };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1100" viewBox="0 0 1100 1100"><rect width="1100" height="1100" fill="#14161a"/>`;
// blocks
for (const b of net.blocks) {
  svg += `<polygon points="${b.poly.map(p=>`${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="${b.open?'#1d2a20':'#20252c'}" stroke="#2b323b" stroke-width="0.4"/>`;
}
if (terrain.river) {
  const pts = terrain.river.path.map(p=>`${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="#1b3a5c" stroke-width="${(terrain.river.width*sc).toFixed(1)}" stroke-linecap="round" opacity="0.85"/>`;
}
for (const r of net.roads) {
  const pts = r.path.map(p=>`${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="${colour[r.cls]||'#888'}" stroke-width="${(Math.max(0.5,(w[r.cls]||1.4))).toFixed(2)}" stroke-linecap="round" opacity="0.92"/>`;
}
for (const rail of net.railways) {
  const pts = rail.path.map(p=>`${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="#e0e0e0" stroke-width="1.2" stroke-dasharray="6 3"/>`;
}
for (const sub of net.subways) {
  const pts = sub.path.map(p=>`${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="${sub.colour}" stroke-width="2" opacity="0.55"/>`;
  for (const s of sub.stations) svg += `<circle cx="${X(s.x).toFixed(1)}" cy="${Y(s.y).toFixed(1)}" r="3" fill="${sub.colour}"/>`;
}
svg += `</svg>`;
writeFileSync(out, svg);
console.log('wrote', out, 'roads', net.roads.length);

// Exports level-design drawings for Section 1 straight from the level data:
//   docs/section1-plan.svg     plan view: every fragment's footprint, the racing line by surface,
//                              beats, 100 m ticks, respawns, jumps and the exit portal
//   docs/section1-profile.svg  height profile along the line with beats and jumps
//   node tools/export-map.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { buildLevel01 } from '../src/level/level01.js';
import { F } from '../src/core/world.js';

const level = buildLevel01();
const S1 = level.sections[0];
const R = S1.route;
const SURF = { road: '#55595e', kicker: '#c4553a', roof: '#3f6f9a', pitched: '#2f58a8', floor: '#9a6a32', bridge: '#4f7f4a', plaza: '#7a5a9a', nave: '#a07a30', air: '#e07a50' };

function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

// ---------------------------------------------------------------- plan view
let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
for (const s of R.samples) { x0 = Math.min(x0, s.p.x); x1 = Math.max(x1, s.p.x); z0 = Math.min(z0, s.p.z); z1 = Math.max(z1, s.p.z); }
x0 -= 90; x1 += 90; z0 -= 70; z1 += 50;
const SC = 1.6, W = Math.round((x1 - x0) * SC), H = Math.round((z1 - z0) * SC);
const X = (x) => ((x - x0) * SC).toFixed(1), Z = (z) => ((z - z0) * SC).toFixed(1);
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 70}" viewBox="0 0 ${W} ${H + 70}" font-family="Helvetica, Arial, sans-serif">`);
out.push(`<rect width="100%" height="100%" fill="#eceae5"/>`);
for (let gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) out.push(`<line x1="${X(gx)}" y1="0" x2="${X(gx)}" y2="${H}" stroke="#dedbd4" stroke-width="1"/>`);
for (let gz = Math.ceil(z0 / 50) * 50; gz < z1; gz += 50) out.push(`<line x1="0" y1="${Z(gz)}" x2="${W}" y2="${Z(gz)}" stroke="#dedbd4" stroke-width="1"/>`);
const v = new THREE.Vector3();
const layers = { below: [], scenery: [], route: [], props: [] };
for (const b of level.world.bodies) {
  if (!b.geometry) continue;
  const c = b.basePos;
  if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
  if (b.flags & F.PROP) { layers.props.push(`<circle cx="${X(c.x)}" cy="${Z(c.z)}" r="1.4" fill="#b59a62"/>`); continue; }
  const pos = b.geometry.attributes.position.array;
  const pts = [];
  for (let i = 0; i < pos.length; i += 3 * Math.max(1, Math.floor(pos.length / 3 / 60))) {
    v.set(pos[i], pos[i + 1], pos[i + 2]).applyQuaternion(b.baseQuat).add(b.basePos);
    pts.push([v.x, v.z]);
  }
  if (pts.length < 3) continue;
  const hp = hull(pts).map((p) => `${X(p[0])},${Z(p[1])}`).join(' ');
  if (b.flags & F.ROUTE) layers.route.push(`<polygon points="${hp}" fill="#b9bab8" stroke="#8d8f8f" stroke-width="0.6"/>`);
  else {
    const low = c.y < 10;
    (low ? layers.below : layers.scenery).push(`<polygon points="${hp}" fill="${low ? '#e2dfd8' : '#d3d0c9'}" stroke="${low ? '#d6d2ca' : '#bdb9b1'}" stroke-width="0.5"/>`);
  }
}
out.push(...layers.below, ...layers.scenery, ...layers.route, ...layers.props);
// racing line by surface
let seg = [], cur = null;
const flush = () => { if (seg.length > 1) out.push(`<polyline points="${seg.join(' ')}" fill="none" stroke="${SURF[cur] || '#000'}" stroke-width="${cur === 'air' ? 2.2 : 3.2}" ${cur === 'air' ? 'stroke-dasharray="5 4"' : ''} stroke-linecap="round"/>`); };
for (let s = 0; s <= R.length; s += 1) {
  const f = R.at(s);
  if (f.surface !== cur) { if (seg.length) seg.push(`${X(f.p.x)},${Z(f.p.z)}`); flush(); seg = []; cur = f.surface; }
  seg.push(`${X(f.p.x)},${Z(f.p.z)}`);
}
flush();
for (let s = 100; s < R.length; s += 100) { const f = R.at(s); out.push(`<circle cx="${X(f.p.x)}" cy="${Z(f.p.z)}" r="2.6" fill="#fff" stroke="#333" stroke-width="1"/><text x="${(+X(f.p.x) + 5).toFixed(1)}" y="${(+Z(f.p.z) + 12).toFixed(1)}" font-size="9" fill="#555">${s} m</text>`); }
for (const r of S1.ctx.respawns) out.push(`<rect x="${(+X(r.pos.x) - 2.5).toFixed(1)}" y="${(+Z(r.pos.z) - 2.5).toFixed(1)}" width="5" height="5" transform="rotate(45 ${X(r.pos.x)} ${Z(r.pos.z)})" fill="#4f9a62"/>`);
for (const b of R.beats) {
  const f = R.at(b.s0);
  const px = +X(f.p.x), pz = +Z(f.p.z);
  out.push(`<circle cx="${px}" cy="${pz}" r="5" fill="#e8774f" stroke="#222" stroke-width="1.2"/>`);
  out.push(`<text x="${px + 9}" y="${pz - 6}" font-size="13" font-weight="700" fill="#222">${b.id} ${b.name}</text><text x="${px + 9}" y="${pz + 8}" font-size="10" fill="#555">s ${b.s0.toFixed(0)}  y ${f.p.y.toFixed(1)} m</text>`);
}
const g = level.portals[0].from;
{
  const yaw = Math.atan2(2 * (g.quat.w * g.quat.y + g.quat.x * g.quat.z), 1 - 2 * (g.quat.y * g.quat.y + g.quat.x * g.quat.x));
  const dx = Math.cos(yaw) * g.w / 2, dz = -Math.sin(yaw) * g.w / 2;
  out.push(`<line x1="${X(g.centre.x - dx)}" y1="${Z(g.centre.z - dz)}" x2="${X(g.centre.x + dx)}" y2="${Z(g.centre.z + dz)}" stroke="#1d3d55" stroke-width="5"/>`);
  out.push(`<text x="${(+X(g.centre.x) + 14).toFixed(1)}" y="${(+Z(g.centre.z) - 10).toFixed(1)}" font-size="13" font-weight="700" fill="#1d3d55">PORTAL > SECTION 2</text>`);
}
const lx = 16;
out.push(`<g transform="translate(0 ${H})"><rect width="${W}" height="70" fill="#f6f5f1"/>`);
let k = 0;
for (const [name, col] of Object.entries(SURF)) { out.push(`<rect x="${lx + k * 98}" y="14" width="22" height="6" fill="${col}"/><text x="${lx + k * 98 + 28}" y="21" font-size="11" fill="#333">${name === 'air' ? 'jump / gap' : name}</text>`); k++; }
out.push(`<text x="${lx}" y="44" font-size="11" fill="#555">Section 1 - Fractured Town. Plan view, north up, 50 m grid. ${R.length.toFixed(0)} m point-to-point, ${R.beats.length} beats, ${S1.ctx.respawns.length} respawns (green). Light shapes: fragments below 10 m. Dots: loose props.</text>`);
out.push(`<text x="${lx}" y="60" font-size="11" fill="#555">Generated by tools/export-map.mjs from the level data (${level.stats.bodies} bodies, ${level.stats.colliders} colliders).</text></g>`);
out.push('</svg>');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/section1-plan.svg', out.join('\n'));

// ---------------------------------------------------------------- profile
const PW = 1400, PH = 360, ml = 50, mr = 20, mt = 30, mb = 60;
let y0 = 1e9, y1 = -1e9;
for (const s of R.samples) { y0 = Math.min(y0, s.p.y); y1 = Math.max(y1, s.p.y); }
y0 = Math.floor(y0 / 5) * 5 - 5; y1 = Math.ceil(y1 / 5) * 5 + 5;
const PX = (s) => (ml + (s / R.length) * (PW - ml - mr)).toFixed(1), PY = (y) => (mt + (1 - (y - y0) / (y1 - y0)) * (PH - mt - mb)).toFixed(1);
const p = [`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#f6f5f1"/>`];
R.beats.forEach((b, i) => { p.push(`<rect x="${PX(b.s0)}" y="${mt}" width="${(+PX(b.s1) - +PX(b.s0)).toFixed(1)}" height="${PH - mt - mb}" fill="${i % 2 ? '#ecebe6' : '#f2f1ec'}"/><text x="${(+PX(b.s0) + 3).toFixed(1)}" y="${mt + 13}" font-size="11" font-weight="700" fill="#444">${b.id}</text>`); });
for (let y = y0; y <= y1; y += 5) p.push(`<line x1="${ml}" x2="${PW - mr}" y1="${PY(y)}" y2="${PY(y)}" stroke="#dcdad3"/><text x="${ml - 6}" y="${(+PY(y) + 4).toFixed(1)}" font-size="10" text-anchor="end" fill="#666">${y}</text>`);
for (let s = 0; s <= R.length; s += 100) p.push(`<text x="${PX(s)}" y="${PH - mb + 16}" font-size="10" text-anchor="middle" fill="#666">${s}</text>`);
cur = null; seg = [];
const flushP = () => { if (seg.length > 1) p.push(`<polyline points="${seg.join(' ')}" fill="none" stroke="${SURF[cur]}" stroke-width="${cur === 'air' ? 2 : 3}" ${cur === 'air' ? 'stroke-dasharray="4 3"' : ''}/>`); };
for (let s = 0; s <= R.length; s += 1) {
  const f = R.at(s);
  if (f.surface !== cur) { if (seg.length) seg.push(`${PX(s)},${PY(f.p.y)}`); flushP(); seg = []; cur = f.surface; }
  seg.push(`${PX(s)},${PY(f.p.y)}`);
}
flushP();
p.push(`<text x="${ml}" y="${PH - 18}" font-size="11" fill="#555">Height profile along the racing line (m). Distance (m) on the x axis. Dashed: authored gaps and jumps. Start ${R.samples[0].p.y.toFixed(0)} m, lowest point ${(y0 + 5).toFixed(0)} m (market square), finish leap into the portal.</text></svg>`);
fs.writeFileSync('docs/section1-profile.svg', p.join('\n'));
console.log('wrote docs/section1-plan.svg', `${(out.join('\n').length / 1024).toFixed(0)} KB`, 'and docs/section1-profile.svg');

/* ============================================================================
 * TyreForge — main.js
 * Scene bootstrap + UI orchestration.
 * ========================================================================== */

'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PRESETS, TYPES, randomTyreName } from './treads.js';
import { TyreView, tyreMetrics, buildProfile } from './tyre.js';
import { TreadEditor } from './editor.js';

const $ = s => document.querySelector(s);

/* ============================ app state ================================== */
const state = { preset: null, spec: null, pattern: null, wall: null };

/* ============================ three setup ================================ */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(34, 1, 10, 20000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;

/* lights */
const key = new THREE.DirectionalLight(0xfff1dd, 2.0); key.position.set(900, 1400, 700);
const rim1 = new THREE.DirectionalLight(0x5a7fd6, 1.1); rim1.position.set(-1100, 400, -800);
scene.add(key, rim1, new THREE.AmbientLight(0x404850, 0.5));

/* pit floor */
const ground = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(512, 512, 60, 512, 512, 512);
  gr.addColorStop(0, '#23262b'); gr.addColorStop(0.55, '#14171b'); gr.addColorStop(1, '#0b0d10');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
  /* painted ring */
  g.strokeStyle = 'rgba(255,180,60,0.16)'; g.lineWidth = 7;
  g.beginPath(); g.arc(512, 512, 300, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(512, 512, 380, 0, 7); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ map: t, roughness: 0.94, metalness: 0 })
  );
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
})();

/* tyre */
const tyre = new TyreView();
tyre.spinning = true;
scene.add(tyre.group);

/* ============================ helpers ==================================== */
const clampNum = (v, a, b) => Math.max(a, Math.min(b, v));
function seedOf(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0) % 100000; }
function loadIdxFor(p) { return p.type === 'offroad' || p.type === 'rally' ? '116Q' : p.type === 'slick' ? '' : '94Y'; }

function loadPreset(p) {
  state.preset = p;
  state.spec = {
    sw: p.size.sw, ar: p.size.ar, rim: p.size.rim, rimW: p.size.rimW,
    treadWidthFrac: p.treadWidthFrac, crown: p.crown, shoulderArc: p.shoulderArc,
    treadDepth: p.treadDepth,
    compound: { ...p.compound },
    sidewall: { ...p.sidewall },
  };
  state.pattern = {
    tiles: p.tiles, depth: p.treadDepth,
    prims: JSON.parse(JSON.stringify(p.prims)),
    wear: p.wear ?? 0, camber: p.camber ?? 0, seed: seedOf(p.id),
  };
  state.wall = { brand: 'SLATEWERKS', model: p.name, loadIdx: loadIdxFor(p) };
  fullRebuild();
  syncUI();
}

function fullRebuild() {
  tyre.rebuild(state.spec, state.pattern, state.wall);
  updateHUD(); drawProfile();
}
function fastRebake() {
  tyre.rebakeTread();
  updateHUD();
}

/* debounced rebake entry for editors */
let _t = null, _fast = true;
function requestRebake(fast) {
  _fast = _fast && fast;
  clearTimeout(_t);
  _t = setTimeout(() => {
    if (_fast) fastRebake(); else fullRebuild();
    _fast = true;
  }, fast ? 70 : 160);
}

/* ============================ HUD / stats ================================ */
function updateHUD() {
  const p = state.preset, s = state.spec, m = tyreMetrics({ ...s, treadDepth: tyre.depthNow() });
  const type = TYPES.find(t => t.id === p.type);
  $('#hud-tyre-name').textContent = state.wall.model.toUpperCase();
  $('#hud-tyre-type').textContent = `${type?.label ?? p.type} · ${s.compound.name}`;

  const wear = state.pattern.wear, td = tyre.depthNow();
  const remaining = td * (1 - wear);
  let fit, fitCol = '#9fb2c1';
  if (m.stretch > 46) { fit = 'PINCHED fitment'; fitCol = '#e0b040'; }
  else if (m.stretch > 8) { fit = 'STRETCHED fitment'; fitCol = '#e0b040'; }
  else if (m.stretch < -46) { fit = 'RIM TOO NARROW'; fitCol = '#e23b2e'; }
  else fit = 'fitment OK';

  $('#hud-stats').innerHTML =
    `<b>${m.sizeText}</b> · ⌀ <b>${m.diameter.toFixed(0)}</b> mm · ${m.circumference.toFixed(0)} mm/rev<br>` +
    `sidewall <b>${m.sidewall.toFixed(0)}</b> mm · tread <b>${m.treadW.toFixed(0)}</b> mm wide<br>` +
    `revs/km <b>${m.revsPerKm.toFixed(0)}</b> · <span style="color:${fitCol}">${fit}</span><br>` +
    `groove depth <b>${remaining.toFixed(1)}</b>/${td.toFixed(1)} mm` +
    (wear > 0.88 ? ' · <span style="color:#e23b2e">CORDS SHOWING</span>'
     : wear > 0.6 ? ' · <span style="color:#e0b040">HEAVILY WORN</span>' : '');
}

/* cross-section drawing -------------------------------------------------- */
function drawProfile() {
  const c = $('#profile-view'); if (!c) return;
  const g = c.getContext('2d'), W = c.width, H = c.height;
  const m = tyreMetrics({ ...state.spec, treadDepth: tyre.depthNow() });
  const P = tyre.profilePts; if (!P) return;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0f1114'; g.fillRect(0, 0, W, H);

  const axleY = H - 24;
  const k = (H - 44) / m.outerR;
  const cx = W / 2;
  const X = z => cx + z * k, Y = r => axleY - r * k;

  /* rim barrel */
  g.strokeStyle = '#59616b'; g.lineWidth = 1.2;
  g.strokeRect(X(-m.rimW / 2), Y(m.rimR), m.rimW * k, 14 * k);

  /* ground */
  g.strokeStyle = '#30363e';
  g.beginPath(); g.moveTo(0, axleY + 0.5); g.lineTo(W, axleY + 0.5); g.stroke();

  /* profile */
  const path = pts => { g.beginPath(); g.moveTo(X(pts[0].z), Y(pts[0].r)); for (const q of pts) g.lineTo(X(q.z), Y(q.r)); g.stroke(); };
  g.strokeStyle = '#ffb43c'; g.lineWidth = 1.8;
  path(P.left); path(P.right);
  g.strokeStyle = '#7a8692'; g.lineWidth = 1.1;
  const capTop = P.left[P.left.length - 1].z;
  g.beginPath(); g.moveTo(X(-capTop), Y(m.capR)); g.lineTo(X(capTop), Y(m.capR)); g.stroke();

  /* tread band outline */
  g.strokeStyle = '#e8e8ea';
  g.beginPath();
  g.moveTo(X(-m.treadW / 2), Y(m.outerR - m.treadDepth));
  g.lineTo(X(-m.treadW / 2), Y(m.outerR));
  g.lineTo(X(m.treadW / 2), Y(m.outerR));
  g.lineTo(X(m.treadW / 2), Y(m.outerR - m.treadDepth));
  g.stroke();

  /* dims */
  g.fillStyle = '#8a94a0'; g.font = '10px monospace'; g.textAlign = 'center';
  g.fillText(`⌀ ${m.diameter.toFixed(0)}`, cx, 12);
  g.fillText(`SW ${state.spec.sw} mm`, cx, axleY + 14);
  g.fillText(`sidewall ${m.sidewall.toFixed(0)} mm`, 8 + 60, Y(m.rimR + m.sidewall / 2));
  g.textAlign = 'left';
  g.fillText(`${state.spec.rim}"`, 6, Y(m.rimR) + 12);

  $('#size-read').innerHTML =
    `overall ⌀ <b>${m.diameter.toFixed(0)} mm</b> · width <b>${state.spec.sw} mm</b><br>` +
    `sidewall <b>${m.sidewall.toFixed(0)} mm</b> · tread cap ⌀ <b>${(m.capR * 2).toFixed(0)} mm</b><br>` +
    `stretch <b>${m.stretch.toFixed(0)} mm</b> · contact ⌀ <b>${m.treadW.toFixed(0)} mm</b>`;
}

/* sidewall preview -------------------------------------------------------- */
function drawWallPreview() {
  const c = $('#wall-view'); if (!c) return;
  const src = tyre.sidewallCanvases?.[1];
  if (!src) return;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 0, 0, c.width, c.height);
}

/* ============================ UI sync =================================== */
const bind = (sel, get, set, fmtStr = v => v) => {
  const el = $(sel), out = $(sel.replace('#s-', '#v-').replace('#o-', '#v-'));
  el.oninput = () => {
    set(parseFloat(el.value));
    if (out) out.textContent = typeof fmtStr === 'function' ? fmtStr(parseFloat(el.value)) : fmtStr;
  };
  return { el, out, get, set, fmtStr };
};

const ctl = {};
function initSliders() {
  ctl.sw = bind('#s-sw', () => state.spec.sw, v => { state.spec.sw = v; requestRebake(false); }, v => `${v} mm`);
  ctl.ar = bind('#s-ar', () => state.spec.ar, v => { state.spec.ar = v; requestRebake(false); }, v => `/${v}`);
  ctl.rim = bind('#s-rim', () => state.spec.rim, v => { state.spec.rim = v; requestRebake(false); }, v => `R${v}`);
  ctl.rimw = bind('#s-rimw', () => state.spec.rimW, v => { state.spec.rimW = v; requestRebake(false); }, v => `${v}J`);
  ctl.twf = bind('#s-twf', () => state.spec.treadWidthFrac, v => { state.spec.treadWidthFrac = v; requestRebake(false); }, v => `${(v * 100).toFixed(0)}% of SW`);
  ctl.sh = bind('#s-sh', () => state.spec.shoulderArc, v => { state.spec.shoulderArc = v; requestRebake(false); }, v => `${v} mm`);
  ctl.crown = bind('#s-crown', () => state.spec.crown, v => { state.spec.crown = v; requestRebake(false); }, v => `${v} mm`);

  ctl.wear = bind('#s-wear', () => state.pattern.wear, v => { state.pattern.wear = v; requestRebake(true); },
    v => `${(v * 100).toFixed(0)}% worn · ${(tyre.depthNow() * (1 - v)).toFixed(1)}mm left`);
  ctl.camber = bind('#s-camber', () => state.pattern.camber, v => { state.pattern.camber = v; requestRebake(true); },
    v => `${(v * 100).toFixed(0)}%`);

  ctl.rough = bind('#o-rough', () => state.spec.compound.rough, v => { state.spec.compound.rough = v; requestRebake(true); },
    v => v.toFixed(2));

  $('#o-col').oninput = e => { state.spec.compound.color = e.target.value; requestRebake(true); };
  $('#o-flip').onchange = e => { flipWidth(state.pattern); editor.sync(); requestRebake(true); e.target.checked = false; };

  /* sidewall text */
  $('#w-brand').oninput = e => { state.wall.brand = e.target.value.toUpperCase(); requestRebakeWall(); };
  $('#w-model').oninput = e => { state.wall.model = e.target.value.toUpperCase(); requestRebakeWall(); };
  $('#w-load').oninput = e => { state.wall.loadIdx = e.target.value.toUpperCase(); requestRebakeWall(); };
  $('#w-ring').oninput = e => { state.spec.sidewall.ring = e.target.value; requestRebakeWall(); };
}

let _wt = null;
function requestRebakeWall() {
  clearTimeout(_wt);
  _wt = setTimeout(() => {
    tyre._bakeSidewalls(tyreMetrics({ ...state.spec, treadDepth: tyre.depthNow() }));
    updateHUD(); drawWallPreview();
  }, 120);
}

function syncUI() {
  const s = state.spec, p = state.pattern;
  ctl.sw.el.value = s.sw; ctl.sw.out.textContent = `${s.sw} mm`;
  ctl.ar.el.value = s.ar; ctl.ar.out.textContent = `/${s.ar}`;
  ctl.rim.el.value = s.rim; ctl.rim.out.textContent = `R${s.rim}`;
  ctl.rimw.el.value = s.rimW; ctl.rimw.out.textContent = `${s.rimW}J`;
  ctl.twf.el.value = s.treadWidthFrac; ctl.twf.out.textContent = `${(s.treadWidthFrac * 100).toFixed(0)}% of SW`;
  ctl.sh.el.value = s.shoulderArc; ctl.sh.out.textContent = `${s.shoulderArc} mm`;
  ctl.crown.el.value = s.crown; ctl.crown.out.textContent = `${s.crown} mm`;
  ctl.wear.el.value = p.wear; ctl.wear.out.textContent = `${(p.wear * 100).toFixed(0)}% worn`;
  ctl.camber.el.value = p.camber; ctl.camber.out.textContent = `${(p.camber * 100).toFixed(0)}%`;
  ctl.rough.el.value = s.compound.rough; ctl.rough.out.textContent = s.compound.rough.toFixed(2);
  $('#o-col').value = '#' + new THREE.Color(s.compound.color).getHexString();
  $('#w-brand').value = state.wall.brand;
  $('#w-model').value = state.wall.model;
  $('#w-load').value = state.wall.loadIdx;
  $('#w-ring').value = s.sidewall.ring;
  editor.sync();
  drawWallPreview();
}

/* ============================ garage ==================================== */
let typeFilter = 'all';
function buildGarage() {
  const tf = $('#type-filter');
  const mk = (id, label) => {
    const b = document.createElement('button');
    b.textContent = label; b.dataset.id = id;
    b.className = id === typeFilter ? 'on' : '';
    b.onclick = () => { typeFilter = id; buildGarage(); };
    tf.appendChild(b);
  };
  tf.innerHTML = '';
  mk('all', 'ALL ' + PRESETS.length);
  for (const t of TYPES) {
    const n = PRESETS.filter(p => p.type === t.id).length;
    if (n) mk(t.id, t.label.toUpperCase());
  }
  const list = $('#preset-list');
  list.innerHTML = '';
  for (const p of PRESETS) {
    if (typeFilter !== 'all' && p.type !== typeFilter) continue;
    const b = document.createElement('button');
    b.className = 'preset' + (state.preset === p ? ' on' : '');
    const t = TYPES.find(x => x.id === p.type);
    b.innerHTML = `<div class="pt">${t?.label ?? p.type}</div>
      <div class="pn">${p.name}</div>
      <div class="pd">${p.size.sw}/${p.size.ar} R${p.size.rim} · ${p.desc}</div>`;
    b.onclick = () => { loadPreset(p); buildGarage(); };
    list.appendChild(b);
  }
  $('#garage-count').textContent = `${PRESETS.length} TYRES`;
}

$('#btn-random').onclick = () => {
  state.wall.model = randomTyreName();
  $('#w-model').value = state.wall.model;
  tyre._bakeSidewalls(tyreMetrics({ ...state.spec, treadDepth: tyre.depthNow() }));
  updateHUD();
};

/* ============================ flip (mirror pattern) ===================== */
function flipWidth(patr) {
  for (const p of patr.prims) {
    if ('y' in p) p.y = 1 - p.y;
    if ('y0' in p && 'y1' in p) { const a = p.y0; p.y0 = 1 - p.y1; p.y1 = 1 - a; }
    if ('angle' in p) p.angle = -p.angle;
    if ('apexY' in p) p.apexY = 1 - p.apexY;
  }
}

/* ============================ export ==================================== */
function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function slug() { return (state.wall.model || 'tyre').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

$('#x-glb').onclick = () => {
  updateHUD();
  tyre.exportGLB(buf => download(URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' })), `${slug()}.glb`));
};
$('#x-height').onclick = () => download(tyre.maps.disp.toDataURL(), `${slug()}-height.png`);
$('#x-normal').onclick = () => download(tyre.maps.normal.toDataURL(), `${slug()}-normal.png`);
$('#x-albedo').onclick = () => download(tyre.maps.albedo.toDataURL(), `${slug()}-albedo.png`);
$('#x-rough').onclick = () => download(tyre.maps.rough.toDataURL(), `${slug()}-roughness.png`);
$('#x-wall').onclick = () => download((tyre.sidewallCanvases?.[1] ?? tyre.sidewallCanvases?.[0]).toDataURL(), `${slug()}-sidewall.png`);
$('#x-json').onclick = async () => {
  const data = {
    name: state.wall.model, brand: state.wall.brand, type: state.preset.type,
    size: { ...state.spec, compound: { ...state.spec.compound } },
    pattern: state.pattern, metrics: (() => { const m = tyreMetrics({ ...state.spec, treadDepth: tyre.depthNow() }); return { diameter: m.diameter, circumference: m.circumference, revsPerKm: m.revsPerKm, treadWidth: m.treadW }; })(),
  };
  try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); $('#x-json').textContent = '✓ copied'; setTimeout(() => $('#x-json').textContent = '⧉ Copy spec JSON', 1200); }
  catch { download('data:application/json,' + encodeURIComponent(JSON.stringify(data, null, 2)), `${slug()}.json`); }
};

/* ============================ tabs & toggles ============================ */
document.querySelectorAll('#tabs button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab-page').forEach(x => x.classList.toggle('on', x.dataset.page === b.dataset.tab));
    if (b.dataset.tab === 'size') drawProfile();
    if (b.dataset.tab === 'wall') drawWallPreview();
    if (b.dataset.tab === 'tread') editor.drawPreview();
  };
});
$('#btn-spin').onclick = e => { tyre.spinning = !tyre.spinning; e.target.classList.toggle('on', tyre.spinning); };
$('#btn-spin').classList.add('on');
$('#btn-rim').onclick = e => { tyre.setRimVisible(!tyre.showRim); e.target.classList.toggle('on', tyre.showRim); };

/* ============================ editor ==================================== */
const editor = new TreadEditor($('#tread-editor'), {
  getPattern: () => state.pattern,
  tyreView: tyre,
  requestRebake,
});

/* ============================ resize / loop ============================= */
function resize() {
  const r = $('#viewport').getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tyre.update(dt);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ============================ boot ====================================== */
initSliders();
loadPreset(PRESETS[0]);
buildGarage();

/* frame camera after first build */
{
  const m = tyreMetrics(state.spec);
  ground.position.y = -m.outerR - 0.4;
  const R = m.outerR;
  camera.position.set(R * 1.9, R * 0.85, R * 2.6);
  controls.target.set(0, 0, 0);
  controls.minDistance = R * 1.05; controls.maxDistance = R * 10;
  /* keep floor glued on rebuilds */
  const _rebuild = tyre.rebuild.bind(tyre);
  tyre.rebuild = (s2, p2, w2) => {
    _rebuild(s2, p2, w2);
    ground.position.y = -tyreMetrics({ ...s2, treadDepth: tyre.depthNow() }).outerR - 0.4;
  };
}

resize();
requestAnimationFrame(frame);

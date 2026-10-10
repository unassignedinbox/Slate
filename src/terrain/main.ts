/// <reference types="@webgpu/types" />
import { TerrainEngine } from './engine';
import {
  PRESETS, defaultErosion, defaultRender, defaultWorld, encodeGen, encodeMat,
  type GenLayer, type MatLayer,
} from './layers';
import { EditorUI } from './ui';

/* ----------------------------- small math ----------------------------- */
const mul = (a: Float32Array, b: Float32Array) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
};
const perspective = (fovy: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = far / (near - far); o[11] = -1; o[14] = (far * near) / (near - far);
  return o;
};
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lookAt = (eye: number[], center: number[], up: number[]) => {
  const f = norm3(sub3(center, eye));
  const s = norm3(cross3(f, up));
  const u = cross3(s, f);
  const o = new Float32Array(16);
  o[0] = s[0]; o[4] = s[1]; o[8] = s[2];
  o[1] = u[0]; o[5] = u[1]; o[9] = u[2];
  o[2] = -f[0]; o[6] = -f[1]; o[10] = -f[2];
  o[12] = -dot3(s, eye); o[13] = -dot3(u, eye); o[14] = dot3(f, eye); o[15] = 1;
  return { m: o, f, s, u };
};

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const overlay = $('#overlay');
const showOverlay = (title: string, msg: string) => {
  overlay.style.display = 'grid';
  overlay.innerHTML = `<div class="box"><h2>${title}</h2><p>${msg}</p></div>`;
};
window.addEventListener('error', e => showOverlay('Runtime error', `${e.message}<br><small>${e.filename}:${e.lineno}</small>`));
window.addEventListener('unhandledrejection', e => showOverlay('Runtime error', String(e.reason)));

/* ------------------------------- state -------------------------------- */
const engine = new TerrainEngine();
const canvas = $<HTMLCanvasElement>('#gpu');

let gen: GenLayer[] = PRESETS[0].gen.map(l => ({ ...l }));
let mats: MatLayer[] = PRESETS[0].mats.map(l => ({ ...l }));
const world = defaultWorld();
const erosion = defaultErosion();
const render = defaultRender();

let running = true;              // erosion stepping
let needsAnalyze = true;
let dirtyGenerate = true;
let lastFullAnalyze = 0;

const cam = { az: 0.95, el: 0.42, dist: 1.35, panY: 0.18 };

/* ------------------------------ bootstrap ------------------------------ */
(async () => {
  try {
    showOverlay('Initialising WebGPU', 'Requesting adapter…');
    engine.onError = (title, msg) => showOverlay(title, msg);
    await engine.init(canvas);
  } catch (err) {
    showOverlay('WebGPU unavailable', String((err as Error).message ?? err) +
      '<br><br>Chrome/Edge 113+ on Windows/macOS/ChromeOS, Chrome 121+ on Linux (may need <code>--enable-unsafe-webgpu</code>), or Safari 18.');
    return;
  }
  overlay.style.display = 'none';
  $('#gpuName').textContent = engine.adapterInfo.slice(0, 48);

  const ui = new EditorUI(gen, mats, world, erosion, render, {
    rebuild: () => { dirtyGenerate = true; },
    restartErosion: () => { dirtyGenerate = true; },
    repaint: () => { needsAnalyze = true; },
    erosionParams: () => { /* applied every step from the live object */ },
  });
  ui.refresh();

  /* preset menu */
  const presetSel = $<HTMLSelectElement>('#preset');
  PRESETS.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = p.name;
    presetSel.appendChild(o);
  });
  presetSel.addEventListener('change', () => {
    const p = PRESETS[+presetSel.value];
    gen = p.gen.map(l => ({ ...l }));
    mats = p.mats.map(l => ({ ...l }));
    Object.assign(world, defaultWorld(), p.world ?? {});
    Object.assign(erosion, defaultErosion(), p.erosion ?? {});
    Object.assign(render, defaultRender(), p.render ?? {});
    world.seed = Number($<HTMLInputElement>('#seed').value) || 1337;
    ui.gen = gen; ui.mats = mats; ui.selGen = 0; ui.selMat = 0;
    ui.refresh();
    dirtyGenerate = true;
  });

  /* top bar */
  $('#build').addEventListener('click', () => { dirtyGenerate = true; });
  $('#reset').addEventListener('click', () => { dirtyGenerate = true; });
  const erodeBtn = $<HTMLButtonElement>('#erodeToggle');
  const syncErodeBtn = () => { erodeBtn.textContent = running ? '⏸ Erosion' : '▶ Erosion'; erodeBtn.classList.toggle('on', running); };
  erodeBtn.addEventListener('click', () => { running = !running; syncErodeBtn(); });
  syncErodeBtn();

  const seedInput = $<HTMLInputElement>('#seed');
  seedInput.addEventListener('change', () => { world.seed = Number(seedInput.value) || 1; dirtyGenerate = true; });
  $('#dice').addEventListener('click', () => {
    world.seed = Math.floor(Math.random() * 100000);
    seedInput.value = String(world.seed);
    dirtyGenerate = true;
  });
  $<HTMLSelectElement>('#res').addEventListener('change', e => {
    const r = Number((e.target as HTMLSelectElement).value);
    engine.gridN = r >= 2048 ? 1024 : r >= 1024 ? 768 : 512;
    engine.allocate(r);
    dirtyGenerate = true;
  });

  /* left rail */
  document.querySelectorAll<HTMLElement>('.ric[data-mode]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.ric[data-mode]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      render.shadingMode = Number(b.dataset.mode);
    });
  });
  const toggle = (id: string, fn: (on: boolean) => void, initial: boolean) => {
    const b = $<HTMLButtonElement>(id);
    let on = initial;
    b.classList.toggle('on', on);
    b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); fn(on); });
  };
  toggle('#tWater', v => (render.showWater = v), true);
  toggle('#tWire', v => (render.wireframe = v), false);
  let sunDrag = false;
  toggle('#tSun', v => (sunDrag = v), false);
  $('#tTop').addEventListener('click', () => { cam.el = 1.45; cam.az = 0.0; cam.dist = 1.05; });

  /* camera + sun interaction */
  let drag: { x: number; y: number; btn: number } | null = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, btn: e.button }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', e => { drag = null; canvas.releasePointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (sunDrag && drag.btn === 0) {
      render.sunAzimuth = (render.sunAzimuth + dx * 0.35 + 360) % 360;
      render.sunElevation = Math.max(-4, Math.min(88, render.sunElevation - dy * 0.2));
    } else if (drag.btn === 2 || e.shiftKey) {
      cam.panY = Math.max(-0.4, Math.min(1.2, cam.panY + dy * 0.0016));
    } else {
      cam.az -= dx * 0.005;
      cam.el = Math.max(0.03, Math.min(1.52, cam.el + dy * 0.004));
    }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.max(0.12, Math.min(4, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
  }, { passive: false });

  /* exports */
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $('#exportR16').addEventListener('click', async () => {
    const h = await engine.readBuffer('height');
    const out = new Uint16Array(h.length);
    for (let i = 0; i < h.length; i++) out[i] = Math.max(0, Math.min(1, h[i])) * 65535;
    download(new Blob([out.buffer], { type: 'application/octet-stream' }),
      `terrain_${engine.res}x${engine.res}_16bit.r16`);
  });
  $('#exportPng').addEventListener('click', async () => {
    const h = await engine.readBuffer('height');
    const c = document.createElement('canvas');
    c.width = c.height = engine.res;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(engine.res, engine.res);
    for (let i = 0; i < h.length; i++) {
      const v = Math.max(0, Math.min(1, h[i])) * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    c.toBlob(b => b && download(b, `terrain_${engine.res}.png`));
  });
  let wantShot = false;
  $('#shot').addEventListener('click', () => { wantShot = true; });

  /* ------------------------------- loop ------------------------------- */
  const progress = $<HTMLElement>('#progress i');
  let fps = 0, frames = 0, fpsT = performance.now();
  let stepsPerFrame = 4;

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    const t0 = now;

    const w = Math.max(1, Math.floor(canvas.clientWidth * Math.min(devicePixelRatio, 2)));
    const h = Math.max(1, Math.floor(canvas.clientHeight * Math.min(devicePixelRatio, 2)));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    engine.resize(w, h);

    if (dirtyGenerate) {
      const g = encodeGen(gen);
      engine.generate(world, g.data, g.count);
      dirtyGenerate = false;
      needsAnalyze = true;
    }

    if (running && engine.erosionDone < erosion.iterations) {
      const steps = Math.min(stepsPerFrame, erosion.iterations - engine.erosionDone);
      engine.erode(erosion, world, steps);
      // cheap analysis while simulating, full-quality bake when it settles
      engine.analyze({ ...world, aoDirs: 4, aoSteps: 6 });
      needsAnalyze = true;
    } else if (needsAnalyze && now - lastFullAnalyze > 120) {
      engine.analyze(world);
      needsAnalyze = false;
      lastFullAnalyze = now;
    }

    /* camera */
    const ws = world.worldSize;
    const dist = ws * cam.dist;
    const eye = [
      Math.cos(cam.az) * Math.cos(cam.el) * dist,
      Math.sin(cam.el) * dist + world.heightScale * 0.15,
      Math.sin(cam.az) * Math.cos(cam.el) * dist,
    ];
    const target = [0, world.heightScale * cam.panY, 0];
    const aspect = w / h;
    const fovy = 48 * Math.PI / 180;
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(fovy, aspect, ws * 0.002, ws * 6);
    const viewProj = mul(proj, view.m);
    const tanHalf = Math.tan(fovy / 2);
    const basis = [
      view.f[0], view.f[1], view.f[2], 0,
      view.s[0], view.s[1], view.s[2], 0,
      view.u[0], view.u[1], view.u[2], 0,
      tanHalf, aspect, 0, 0,
    ];

    const m = encodeMat(mats);
    engine.render(viewProj, eye as [number, number, number], basis, world, render, m.data, m.count, now * 0.001);

    if (wantShot) {
      wantShot = false;
      canvas.toBlob(b => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = 'projectzero_terrain.png'; a.click();
      });
    }

    /* adaptive erosion batch: keep the frame interactive */
    const cost = performance.now() - t0;
    if (cost > 14 && stepsPerFrame > 1) stepsPerFrame--;
    else if (cost < 7 && stepsPerFrame < 24) stepsPerFrame++;

    frames++;
    if (now - fpsT > 500) {
      fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now;
      const pct = Math.min(1, engine.erosionDone / Math.max(1, erosion.iterations));
      progress.style.width = `${pct * 100}%`;
      $('#st1').innerHTML = `<b>${engine.res}²</b> sim · <b>${engine.gridN}²</b> mesh · ${(engine.gridN * engine.gridN * 2 / 1e6).toFixed(1)} M tris`;
      $('#st2').innerHTML = `erosion <b>${engine.erosionDone}</b>/${erosion.iterations} (${(pct * 100).toFixed(0)}%)`;
      $('#st3').innerHTML = `<b>${fps.toFixed(0)}</b> fps · ${stepsPerFrame} steps/frame`;
      $('#st4').innerHTML = `${(world.worldSize / 1000).toFixed(1)} km × ${(world.heightScale).toFixed(0)} m relief · cell ${(world.worldSize / engine.res).toFixed(1)} m`;
      $('#vbadge').innerHTML = `<b>${PRESETS[+presetSel.value]?.name ?? 'Custom'}</b> · seed ${world.seed}`;
      $('#dot').style.background = running && engine.erosionDone < erosion.iterations ? 'var(--warn)' : 'var(--ok)';
    }
  };
  requestAnimationFrame(frame);
})();

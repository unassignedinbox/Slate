// Slate — viewport: Three.js 3D terrain/water/scatter/voxel + 2D map canvas +
// mask painting + export builders. (Only UI module that touches three/DOM.)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, normalAt } from '../engine/util.js';
import { voxelizeColumns } from '../engine/voxel.js';

const WORLD = 100; // world units across the tile

export class Viewport {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks; // { onPaintStroke(), status(msg) }
    this.view = '3d';
    this.view2d = 'height';
    this.shade3d = 'textured';
    this.showWater = true;
    this.showScatter = true;
    this.wireframe = false;
    this.heightEx = 18;
    this.voxCols = 56;
    this.cutX = 1; // voxel cutaway 0..1
    this.ctx = null;
    this.paint = null; // { store, res, value, size, strength }
    this.buildDOM();
    this.buildScene();
    this.loop();
    new ResizeObserver(() => this.resize()).observe(this.root);
  }

  buildDOM() {
    this.root.innerHTML = `
      <div class="vp">
        <canvas class="vp-3d"></canvas>
        <canvas class="vp-2d"></canvas>
        <div class="vp-paintbar hidden">
          <span class="vp-paint-title">Painting mask</span>
          <label>Brush <input type="range" class="vp-brush" min="2" max="80" step="1" value="18"></label>
          <label>Flow <input type="range" class="vp-flow" min="0.05" max="1" step="0.05" value="0.7"></label>
          <div class="vp-seg">
            <button data-pv="1" class="on">White</button><button data-pv="0">Black</button>
          </div>
          <button class="vp-clear">Clear</button>
          <button class="vp-fill">Fill</button>
          <button class="vp-done">Done</button>
        </div>
      </div>`;
    this.c3d = this.root.querySelector('.vp-3d');
    this.c2d = this.root.querySelector('.vp-2d');
    this.g2d = this.c2d.getContext('2d');
    this.paintbar = this.root.querySelector('.vp-paintbar');
    this.c2d.style.display = 'none';
    // paint events
    this.c2d.addEventListener('pointerdown', (e) => this.paintAt(e, true));
    this.c2d.addEventListener('pointermove', (e) => { if (e.buttons) this.paintAt(e, false); });
    this.c2d.addEventListener('pointerup', () => this.endStroke());
    this.paintbar.querySelector('.vp-brush').addEventListener('input', (e) => { if (this.paint) this.paint.size = +e.target.value; });
    this.paintbar.querySelector('.vp-flow').addEventListener('input', (e) => { if (this.paint) this.paint.strength = +e.target.value; });
    this.paintbar.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => {
      if (!this.paint) return;
      this.paint.value = +b.dataset.pv;
      this.paintbar.querySelectorAll('[data-pv]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    this.paintbar.querySelector('.vp-clear').addEventListener('click', () => {
      if (this.paint) { this.paint.store.fill(this.paint.value ? 0 : 0); this.paint.store.fill(0); this.draw2D(); this.endStroke(); }
    });
    this.paintbar.querySelector('.vp-fill').addEventListener('click', () => {
      if (this.paint) { this.paint.store.fill(1); this.draw2D(); this.endStroke(); }
    });
    this.paintbar.querySelector('.vp-done').addEventListener('click', () => this.hooks.onPaintDone());
  }

  buildScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.c3d, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0e13');
    this.scene.fog = new THREE.Fog('#0b0e13', 220, 520);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 2000);
    this.camera.position.set(78, 62, 78);
    this.controls = new OrbitControls(this.camera, this.c3d);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 6, 0);
    const hemi = new THREE.HemisphereLight('#bcd3ff', '#1a1410', 0.85);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff2df', 2.1);
    this.sun.position.set(-60, 90, -35);
    this.scene.add(this.sun);
    const grid = new THREE.GridHelper(100, 20, '#1e2836', '#141a24');
    grid.position.y = -0.5;
    this.scene.add(grid);
    this.terrain = null;
    this.waterMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshStandardMaterial({ color: '#1f7fa8', transparent: true, opacity: 0.62, roughness: 0.12, metalness: 0.05 })
    );
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.visible = false;
    this.scene.add(this.waterMesh);
    this.scatterGroup = new THREE.Group();
    this.scene.add(this.scatterGroup);
    this.voxGroup = new THREE.Group();
    this.voxGroup.visible = false;
    this.scene.add(this.voxGroup);
    this.resize();
  }

  resize() {
    const w = this.root.clientWidth || 800, h = this.root.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    this.controls.update();
    if (this.view === '3d' || this.view === 'voxel') this.renderer.render(this.scene, this.camera);
  }

  setView(v) {
    this.view = v;
    const is2d = v !== '3d' && v !== 'voxel';
    this.c2d.style.display = is2d ? 'block' : 'none';
    this.c3d.style.display = is2d ? 'none' : 'block';
    this.voxGroup.visible = v === 'voxel';
    if (this.terrain) this.terrain.visible = v === '3d';
    this.scatterGroup.visible = v === '3d' && this.showScatter;
    if (this.ctx) {
      if (is2d) this.draw2D();
      if (v === 'voxel') this.buildVoxels();
      this.resize();
    }
  }

  setData(ctx, opts = {}) {
    this.ctx = ctx;
    if (opts.shade3d) this.shade3d = opts.shade3d;
    if (this.view === '3d') this.buildTerrain();
    else if (this.view === 'voxel') this.buildVoxels();
    else this.draw2D();
    if (this.view === '3d') {
      this.buildWater();
      this.buildScatter();
    }
  }

  refresh3D() { // cheap refresh for toggles/exaggeration (no rebuild of data)
    if (!this.ctx) return;
    this.buildTerrain();
    this.buildWater();
    this.buildScatter();
    if (this.view === 'voxel') this.buildVoxels();
  }

  heightColor(i, n, out) {
    const c = this.ctx, t = clamp(c.h[i]);
    if (this.shade3d === 'height') { out[0] = t; out[1] = t; out[2] = t; }
    else if (this.shade3d === 'clay') { const v = 0.45 + t * 0.4; out[0] = v; out[1] = v * 0.98; out[2] = v * 0.94; }
    else { out[0] = c.alb[i * 3]; out[1] = c.alb[i * 3 + 1]; out[2] = c.alb[i * 3 + 2]; }
    return out;
  }

  buildTerrain() {
    const c = this.ctx, n = c.n;
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
      this.terrain.material.dispose();
    }
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const tmp = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      // PlaneGeometry vertex order: row-major from top-left after rotation; map to field
      const ix = i % n, iy = (i / n) | 0;
      const h = c.h[iy * n + ix];
      pos.setY(i, h * this.heightEx);
      this.heightColor(iy * n + ix, n, tmp);
      col[i * 3] = tmp[0]; col[i * 3 + 1] = tmp[1]; col[i * 3 + 2] = tmp[2];
    }
    // NOTE: plane X/Z already span the tile; flip V so texture-up matches data-up
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.93, metalness: 0,
      wireframe: this.wireframe || this.shade3d === 'wireframe',
      flatShading: false,
    });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.visible = this.view === '3d';
    this.scene.add(this.terrain);
  }

  buildWater() {
    const c = this.ctx;
    this.waterMesh.visible = this.showWater && this.view === '3d';
    this.waterMesh.position.y = c.waterLevel * this.heightEx + 0.06;
  }

  buildScatter() {
    while (this.scatterGroup.children.length) {
      const m = this.scatterGroup.children.pop();
      m.geometry.dispose(); m.material.dispose();
    }
    this.scatterGroup.visible = this.showScatter && this.view === '3d';
    const c = this.ctx;
    if (!c.scatter.length || !this.showScatter) return;
    const groups = [[], [], []];
    for (const p of c.scatter) groups[p.t].push(p);
    const geos = [
      new THREE.ConeGeometry(0.55, 1.7, 6),      // trees
      new THREE.DodecahedronGeometry(0.5, 0),    // rocks
      new THREE.ConeGeometry(0.28, 0.8, 5),      // grass tufts
    ];
    const cols = ['#2f6b2a', '#7a756c', '#7fae4c'];
    groups.forEach((pts, gi) => {
      if (!pts.length) return;
      const mat = new THREE.MeshStandardMaterial({ color: cols[gi], roughness: 0.9 });
      const mesh = new THREE.InstancedMesh(geos[gi], mat, pts.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), SC = new THREE.Vector3();
      const CC = new THREE.Color();
      pts.forEach((p, k) => {
        V.set((p.x - 0.5) * WORLD, p.z * this.heightEx, (p.y - 0.5) * WORLD);
        E.set(0, p.r, 0); Q.setFromEuler(E);
        const s = p.s * (gi === 2 ? 0.8 : 1.4);
        SC.set(s, s * p.v, s);
        if (gi === 1) V.y += 0.1;
        else V.y += (gi === 0 ? 0.85 : 0.4) * s;
        M.compose(V, Q, SC);
        mesh.setMatrixAt(k, M);
        CC.set(cols[gi]).multiplyScalar(p.v);
        mesh.setColorAt(k, CC);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scatterGroup.add(mesh);
    });
  }

  buildVoxels() {
    while (this.voxGroup.children.length) {
      const m = this.voxGroup.children.pop();
      m.geometry.dispose(); m.material.dispose();
    }
    const c = this.ctx;
    const cols = clamp(Math.round(this.voxCols), 16, 96);
    const { heights, water, tint } = voxelizeColumns(c, cols);
    const cell = WORLD / cols;
    const maxKeep = Math.floor(cols * this.cutX);
    const box = new THREE.BoxGeometry(cell * 0.92, 1, cell * 0.92);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(box, mat, cols * maxKeep);
    const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
    const CC = new THREE.Color();
    let k = 0;
    for (let y = 0; y < cols; y++) for (let x = 0; x < maxKeep; x++) {
      const o = y * cols + x;
      const h = Math.max(0.004, heights[o]) * this.heightEx;
      V.set((x / (cols - 1) - 0.5) * WORLD, h / 2, (y / (cols - 1) - 0.5) * WORLD);
      SC.set(1, h, 1);
      M.compose(V, Q, SC);
      mesh.setMatrixAt(k, M);
      CC.setRGB(tint[o * 3], tint[o * 3 + 1], tint[o * 3 + 2]);
      mesh.setColorAt(k, CC);
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.voxGroup.add(mesh);
    // translucent water columns where basins hold water
    const wet = [];
    for (let y = 0; y < cols; y++) for (let x = 0; x < maxKeep; x++) {
      const o = y * cols + x;
      if (water[o] > 0.002) wet.push(o);
    }
    if (wet.length) {
      const wmat = new THREE.MeshStandardMaterial({ color: '#2a7a9a', transparent: true, opacity: 0.55, roughness: 0.2 });
      const wmesh = new THREE.InstancedMesh(new THREE.BoxGeometry(cell * 0.92, 1, cell * 0.92), wmat, wet.length);
      wet.forEach((o, k2) => {
        const x = o % cols, y = (o / cols) | 0;
        const top = heights[o] * this.heightEx, wh = Math.max(0.05, water[o] * this.heightEx);
        V.set((x / (cols - 1) - 0.5) * WORLD, top + wh / 2, (y / (cols - 1) - 0.5) * WORLD);
        SC.set(1, wh, 1);
        M.compose(V, Q, SC);
        wmesh.setMatrixAt(k2, M);
      });
      wmesh.instanceMatrix.needsUpdate = true;
      this.voxGroup.add(wmesh);
    }
  }

  // ---------- 2D map rendering ----------
  draw2D() {
    const c = this.ctx;
    if (!c) return;
    const n = c.n;
    if (this.c2d.width !== n || this.c2d.height !== n) { this.c2d.width = n; this.c2d.height = n; }
    const img = this.g2d.createImageData(n, n);
    const d = img.data;
    const mode = this.paint ? this.view2d : (this.view === 'compare' ? 'compare' : this.view2d);
    if (mode === 'compare') {
      this.renderCompare(d, n);
    } else {
      const field = this.buffer2D(mode);
      const isRGB = field.rgb != null;
      for (let i = 0; i < n * n; i++) {
        let r, g, b;
        if (isRGB) { r = field.rgb[i * 3]; g = field.rgb[i * 3 + 1]; b = field.rgb[i * 3 + 2]; }
        else {
          const t = clamp(field.gray[i]);
          r = t; g = t; b = t;
          if (field.water && c.h[i] < c.waterLevel) {
            const depth = clamp((c.waterLevel - c.h[i]) * 6);
            r = r * (1 - depth) + 0.12 * depth; g = g * (1 - depth) + 0.45 * depth; b = b * (1 - depth) + 0.7 * depth;
          }
        }
        d[i * 4] = clamp(r) * 255; d[i * 4 + 1] = clamp(g) * 255; d[i * 4 + 2] = clamp(b) * 255; d[i * 4 + 3] = 255;
      }
    }
    // paint overlay: red tint where the brushed mask is strong
    if (this.paint) {
      const s = this.paint.store;
      for (let i = 0; i < n * n; i++) {
        const m = clamp(s[i]);
        d[i * 4] = d[i * 4] * (1 - m * 0.45) + 255 * m * 0.45;
        d[i * 4 + 1] *= (1 - m * 0.35);
        d[i * 4 + 2] *= (1 - m * 0.35);
      }
    }
    this.g2d.putImageData(img, 0, 0);
    // scale canvas via CSS (crisp pixels)
    const box = this.root.getBoundingClientRect();
    const side = Math.min(box.width, box.height);
    this.c2d.style.width = `${side}px`;
    this.c2d.style.height = `${side}px`;
  }

  buffer2D(mode) {
    const c = this.ctx, n = c.n;
    if (mode === 'color') return { rgb: c.alb };
    if (mode === 'flow') return { gray: c.field('flow') };
    if (mode === 'slope') return { gray: c.field('slopeN') };
    if (mode === 'ao') return { gray: c.field('ao') };
    if (mode === 'moist') {
      const g = new Float32Array(n * n);
      for (let i = 0; i < g.length; i++) g[i] = clamp(c.moist[i]);
      return { gray: g };
    }
    if (mode === 'normal') {
      const rgb = new Float32Array(n * n * 3);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const [nx, ny, nz] = normalAt(c.h, n, x, y, 2);
        const i = y * n + x;
        rgb[i * 3] = nx * 0.5 + 0.5; rgb[i * 3 + 1] = ny * 0.5 + 0.5; rgb[i * 3 + 2] = nz * 0.5 + 0.5;
      }
      return { rgb };
    }
    return { gray: c.field('height01'), water: true }; // height
  }

  renderCompare(d, n) {
    const c = this.ctx;
    const cmp = c.compare || { against: 4, split: 0.5 };
    let left = null;
    if (cmp.against <= 3 && c.cache[cmp.against]) left = c.cache[cmp.against].h;
    else if (c.history.length) left = c.history[0].h;
    const split = clamp(cmp.split ?? 0.5, 0.05, 0.95) * n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const t = x < split ? (left ? clamp(left[i]) : 0.25) : clamp(c.h[i]);
      let r = t, g = t, b = t;
      if (Math.abs(x - split) < 1) { r = 1; g = 0.3; b = 0.3; }
      else if (x >= split && c.h[i] < c.waterLevel) {
        const depth = clamp((c.waterLevel - c.h[i]) * 6);
        r = r * (1 - depth) + 0.12 * depth; g = g * (1 - depth) + 0.45 * depth; b = b * (1 - depth) + 0.7 * depth;
      }
      d[i * 4] = r * 255; d[i * 4 + 1] = g * 255; d[i * 4 + 2] = b * 255; d[i * 4 + 3] = 255;
    }
  }

  // ---------- painting ----------
  setPaint(store, res) {
    this.paint = store ? { store, res, value: 1, size: 18, strength: 0.7 } : null;
    this.paintbar.classList.toggle('hidden', !store);
    this.c2d.classList.toggle('painting', !!store);
    if (store) this.showMaps('height');
    else this.draw2D();
  }
  setView2DMode(m) {
    this.view2d = m;
    if (this.view !== '3d' && this.view !== 'voxel') this.draw2D();
  }
  showMaps(mode) {
    this.view2d = mode;
    this.setView('maps');
  }
  paintAt(e, start) {
    if (!this.paint || !this.ctx) return;
    e.preventDefault();
    const rect = this.c2d.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * this.paint.res;
    const py = ((e.clientY - rect.top) / rect.height) * this.paint.res;
    const { store, res, value, size, strength } = this.paint;
    const r = size * (res / Math.max(1, rect.width)) * 1.2;
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(res - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(res - 1, Math.ceil(py + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dd = Math.hypot(x - px, y - py) / Math.max(1, r);
      if (dd > 1) continue;
      const fall = (1 - dd * dd) * strength;
      const i = y * res + x;
      store[i] = clamp(store[i] + (value - store[i]) * fall);
    }
    void start;
    this.draw2D();
    this._strokeDirty = true;
  }
  endStroke() {
    if (this._strokeDirty) {
      this._strokeDirty = false;
      this.hooks.onPaintStroke();
    }
  }
}

// ---------- export builders (pure, need only ctx) ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function exportPNG(ctx, kind, project) {
  const n = ctx.n;
  const cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const g = cv.getContext('2d');
  const img = g.createImageData(n, n);
  const d = img.data;
  if (kind === 'albedo') {
    for (let i = 0; i < n * n; i++) {
      d[i * 4] = clamp(ctx.alb[i * 3]) * 255; d[i * 4 + 1] = clamp(ctx.alb[i * 3 + 1]) * 255;
      d[i * 4 + 2] = clamp(ctx.alb[i * 3 + 2]) * 255; d[i * 4 + 3] = 255;
    }
  } else if (kind === 'normal') {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [nx, ny, nz] = normalAt(ctx.h, n, x, y, 2);
      const i = y * n + x;
      d[i * 4] = (nx * 0.5 + 0.5) * 255; d[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      d[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; d[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < n * n; i++) {
      const t = clamp(ctx.h[i]);
      const v = t * 255;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  cv.toBlob((b) => download(b, `${project}-${kind}-${n}.png`));
}
export function exportOBJ(ctx, project, heightEx = 18) {
  const n = ctx.n;
  const lines = [`# Slate terrain ${n}x${n}`, `o terrain`];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    lines.push(`v ${((x / (n - 1) - 0.5) * WORLD).toFixed(4)} ${(ctx.h[i] * heightEx).toFixed(4)} ${((y / (n - 1) - 0.5) * WORLD).toFixed(4)}`);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    lines.push(`vt ${(x / (n - 1)).toFixed(5)} ${(1 - y / (n - 1)).toFixed(5)}`);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const [nx, ny, nz] = normalAt(ctx.h, n, x, y, 2);
    lines.push(`vn ${nx.toFixed(5)} ${nz.toFixed(5)} ${ny.toFixed(5)}`);
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = y * n + x + 1, b = a + 1, c2 = a + n, d2 = c2 + 1;
    lines.push(`f ${a}/${a}/${a} ${c2}/${c2}/${c2} ${b}/${b}/${b}`);
    lines.push(`f ${b}/${b}/${b} ${c2}/${c2}/${c2} ${d2}/${d2}/${d2}`);
  }
  download(new Blob([lines.join('\n')], { type: 'text/plain' }), `${project}-${n}.obj`);
}
export function exportRAW(ctx, project) {
  const buf = new Float32Array(ctx.h.length);
  buf.set(ctx.h);
  download(new Blob([buf.buffer], { type: 'application/octet-stream' }), `${project}-height-${ctx.n}x${ctx.n}-f32.raw`);
}

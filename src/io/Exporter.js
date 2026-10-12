/* ============================================================================
   Exporter — hand the road network off to a game engine or a DCC tool.

     .slate.json   the editable graph (nodes, edges, bands, features)
     .glb / .gltf  baked road meshes, UV'd in metres, Y-up, metre scale
     .obj          same, for tools that don't speak glTF
     .csv          a quantity / scheduling schedule of every segment
   ========================================================================== */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { SURFACES, KINDS } from '../model/Presets.js';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function saveJSON(net, name = 'network.slate.json') {
  const json = JSON.stringify(net.toJSON(), null, 1);
  download(new Blob([json], { type: 'application/json' }), name);
}

export function loadJSON(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try { resolve(JSON.parse(fr.result)); } catch (e) { reject(e); }
    };
    fr.onerror = reject;
    fr.readAsText(file);
  });
}

/** Collect everything under the world group into a clean export scene. */
function exportScene(world) {
  const root = new THREE.Group();
  root.name = 'SlateRoadNetwork';
  for (const tile of world.tiles.values()) {
    if (!tile.group) continue;
    for (const child of tile.group.children) {
      const clone = new THREE.Mesh(
        child.isInstancedMesh ? child.geometry.clone() : child.geometry,
        child.material,
      );
      if (child.isInstancedMesh) {
        // bake instances into a merged mesh so DCC tools see real geometry
        const g = bakeInstances(child);
        if (g) { clone.geometry = g; }
        else continue;
      }
      clone.name = child.name || 'road';
      root.add(clone);
    }
  }
  return root;
}

function bakeInstances(im) {
  const src = im.geometry;
  const count = im.count;
  if (!src.attributes.position) return null;
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const idx = src.index;
  const vCount = pos.count;
  const iCount = idx ? idx.count : vCount;
  const total = vCount * count;
  if (total > 4_000_000) return null;

  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    im.getMatrixAt(i, m);
    nm.getNormalMatrix(m);
    const off = i * vCount;
    for (let k = 0; k < vCount; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      P[(off + k) * 3] = v.x; P[(off + k) * 3 + 1] = v.y; P[(off + k) * 3 + 2] = v.z;
      if (nor) {
        n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
        N[(off + k) * 3] = n.x; N[(off + k) * 3 + 1] = n.y; N[(off + k) * 3 + 2] = n.z;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (idx) {
    const I = new Uint32Array(iCount * count);
    for (let i = 0; i < count; i++) {
      const off = i * vCount;
      for (let k = 0; k < iCount; k++) I[i * iCount + k] = idx.getX(k) + off;
    }
    g.setIndex(new THREE.BufferAttribute(I, 1));
  }
  return g;
}

export function exportGLTF(world, name = 'slate-roads.glb', binary = true) {
  const scene = exportScene(world);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(scene, (result) => {
      if (binary) download(new Blob([result], { type: 'model/gltf-binary' }), name);
      else download(new Blob([JSON.stringify(result)], { type: 'model/gltf+json' }), name.replace('.glb', '.gltf'));
      resolve(result);
    }, (err) => reject(err), { binary, onlyVisible: true });
  });
}

export function exportOBJ(world, name = 'slate-roads.obj') {
  const scene = exportScene(world);
  const text = new OBJExporter().parse(scene);
  download(new Blob([text], { type: 'text/plain' }), name);
  return text;
}

/** A construction schedule: one row per segment, with quantities. */
export function exportCSV(net, name = 'slate-schedule.csv') {
  const rows = [['id', 'name', 'preset', 'length_m', 'width_m', 'area_m2', 'lanes', 'carriageway_m', 'surface', 'mark_style', 'bridge', 'tunnel', 'rail']];
  for (const e of net.edges.values()) {
    const bands = e.bandsOf();
    const width = bands.reduce((s, b) => s + (b.w || 0), 0);
    const lanes = bands.filter((b) => KINDS[b.k]?.traffic);
    const cw = lanes.reduce((s, b) => s + (b.w || 0), 0);
    const len = e.length(net);
    rows.push([
      e.id, e.name || '', e.preset, len.toFixed(2), width.toFixed(2), (len * cw).toFixed(1),
      lanes.length, cw.toFixed(2),
      lanes[0]?.s || bands[0]?.s || '', e.markStyle,
      e.bridge ? 'yes' : 'no', e.tunnel ? 'yes' : 'no', e.isRail() ? 'yes' : 'no',
    ]);
  }
  const csv = rows.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), name);
  return csv;
}

/** Quantities summary shown in the reference dialog. */
export function quantities(net) {
  const bySurface = new Map();
  let area = 0, len = 0;
  for (const e of net.edges.values()) {
    const L = e.length(net);
    len += L;
    for (const b of e.bandsOf()) {
      const w = b.w || 0;
      const a = L * w;
      area += a;
      bySurface.set(b.s, (bySurface.get(b.s) || 0) + a);
    }
  }
  return {
    length: len,
    area,
    bySurface: [...bySurface.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ surface: SURFACES[k]?.label || k, area: v })),
  };
}

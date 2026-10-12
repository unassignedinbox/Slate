// City renderer: turns the generated road network (NetworkBuilder output) into three.js meshes.
// Roads and markings are merged into 512 m chunks; street furniture is instanced per 400 m chunk and
// distance-culled. Adapted from the Frontier Road Editor's World renderer (without editing tools).
import * as THREE from 'three';
import { buildTextureSet } from '../../map/render/textures.js';
import { buildMaterials, buildPropMaterials } from '../../map/render/materials.js';
import { propLibrary, SHADOW_PROPS } from '../../map/render/propsLib.js';

const CHUNK = 512;
const PCHUNK = 400;
const MARK_MATS = new Set(['markWhite', 'markYellow', 'decal']);
const DISTRICT_COLORS = { downtown: [0.30, 0.30, 0.29], midtown: [0.31, 0.32, 0.29], oldtown: [0.36, 0.33, 0.28], residential: [0.27, 0.34, 0.20], industrial: [0.34, 0.33, 0.29], park: [0.22, 0.36, 0.16], suburb: [0.28, 0.37, 0.20], rural: [0.33, 0.38, 0.19] };
const PROP_DIST = 640;

export class CityRender {
  constructor(renderer, scene, net) {
    this.renderer = renderer;
    this.scene = scene;
    this.net = net;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.T = buildTextureSet();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const k in this.T) {
      const t = this.T[k];
      const set = x => { if (x && x.isTexture) x.anisotropy = aniso; };
      if (t?.map) { set(t.map); set(t.normal); } else set(t);
    }
    this.M = buildMaterials(this.T);
    this.PM = buildPropMaterials(this.T);
    this.props = propLibrary();
    this.roadChunks = [];
    this.propChunks = [];
  }

  // Build every element from the NetworkBuilder output.
  build(builder) {
    const byChunk = new Map(), byProp = new Map();
    for (const [, out] of builder.outs) {
      if (out.min[0] === Infinity) continue;
      const cx = (out.min[0] + out.max[0]) / 2, cz = (out.min[2] + out.max[2]) / 2;
      const key = Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
      if (!byChunk.has(key)) byChunk.set(key, []);
      byChunk.get(key).push(out);
      for (const t in out.props) {
        const l = out.props[t];
        for (let i = 0; i < l.length; i += 8) {
          const pk = Math.floor(l[i] / PCHUNK) + ',' + Math.floor(l[i + 2] / PCHUNK);
          let pc = byProp.get(pk); if (!pc) byProp.set(pk, pc = new Map());
          if (!pc.has(t)) pc.set(t, []);
          pc.get(t).push(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4], l[i + 5], l[i + 6], l[i + 7]);
        }
      }
    }
    for (const [key, outs] of byChunk) this.buildRoadChunk(key, outs);
    for (const [key, types] of byProp) this.buildPropChunk(key, types);
    this.buildGround(this.net);
    this.buildWater(builder);
  }

  buildRoadChunk(key, outs) {
    const roadG = new THREE.Group(), markG = new THREE.Group();
    const byMat = new Map();
    const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
    for (const out of outs) {
      for (const mat in out.mesh) {
        const pc = out.mesh[mat]; if (!pc.i.length) continue;
        if (mat === 'water') continue;                      // river is built separately
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push(pc);
      }
      for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], out.min[k]); bmax[k] = Math.max(bmax[k], out.max[k]); }
    }
    for (const [mat, pcs] of byMat) {
      let nv = 0, ni = 0;
      for (const pc of pcs) { nv += pc.p.length / 3; ni += pc.i.length; }
      const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const pc of pcs) {
        pos.set(pc.p, vo * 3); uv.set(pc.uv, vo * 2);
        for (let k = 0; k < pc.i.length; k++) idx[io + k] = pc.i[k] + vo;
        vo += pc.p.length / 3; io += pc.i.length;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.M[mat] || this.M.__fallback);
      mesh.receiveShadow = true;
      mesh.castShadow = !MARK_MATS.has(mat);
      (MARK_MATS.has(mat) ? markG : roadG).add(mesh);
    }
    const group = new THREE.Group();
    group.add(roadG, markG);
    this.group.add(group);
    this.roadChunks.push({ group, markG, bmin, bmax });
  }

  buildPropChunk(key, types) {
    const [i, j] = key.split(',').map(Number);
    const center = { x: (i + 0.5) * PCHUNK, z: (j + 0.5) * PCHUNK };
    const group = new THREE.Group();
    const propG = new THREE.Group(), treeG = new THREE.Group();
    group.add(propG, treeG);
    const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const [type, flat] of types) {
      const parts = this.props[type] || this.props.__fallback;
      const n = flat.length / 8;
      const isTree = type === 'treeA' || type === 'treeB';
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geo, this.PM[part.mat] || this.PM.vcol, n);
        for (let k = 0; k < n; k++) {
          const b = k * 8;
          p.set(flat[b], flat[b + 1], flat[b + 2]);
          e.set(0, flat[b + 3], flat[b + 4]); q.setFromEuler(e);
          s.set(flat[b + 5], flat[b + 6], flat[b + 7]);
          im.setMatrixAt(k, tmpM.compose(p, q, s));
        }
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = SHADOW_PROPS.has(type) && part.mat !== 'glass';
        im.receiveShadow = false;
        (isTree ? treeG : propG).add(im);
      }
    }
    this.group.add(group);
    this.propChunks.push({ group, propG, treeG, center });
  }

  // Distance culling for road markings and furniture.
  cull(cam) {
    const c = cam.position;
    for (const ch of this.roadChunks) {
      const dx = Math.max(0, ch.bmin[0] - c.x, c.x - ch.bmax[0]);
      const dz = Math.max(0, ch.bmin[2] - c.z, c.z - ch.bmax[2]);
      ch.markG.visible = Math.hypot(dx, dz) < 1500;
    }
    for (const pc of this.propChunks) {
      const d = Math.hypot(Math.max(0, Math.abs(c.x - pc.center.x) - PCHUNK / 2), Math.max(0, Math.abs(c.z - pc.center.z) - PCHUNK / 2));
      pc.propG.visible = d < PROP_DIST;
      pc.treeG.visible = d < PROP_DIST * 1.4;
    }
  }

  buildGround(net) {
    const R = net.districtRaster;
    const ext = R ? R.ext : (net.meta.size || 4096) * 0.8;
    const res = R ? R.res : 64;
    const geo = new THREE.PlaneGeometry(ext * 2, ext * 2, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);
    const col = new Float32Array(res * res * 3);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const t = R ? R.types[R.data[j * res + i] - 1] : 'rural';
      const c = DISTRICT_COLORS[t] || DISTRICT_COLORS.rural;
      const n = 0.94 + 0.12 * Math.sin(i * 0.37 + j * 0.21) * Math.cos(i * 0.13 - j * 0.29);
      const k = (j * res + i) * 3; col[k] = c[0] * n; col[k + 1] = c[1] * n; col[k + 2] = c[2] * n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const detail = this.T.groundDetail.map.clone(); detail.needsUpdate = true;
    detail.repeat.set(ext * 2 / 9, ext * 2 / 9);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 1, metalness: 0 });
    if (net.river) {
      const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
      g.strokeStyle = '#000'; g.lineJoin = 'round'; g.lineCap = 'butt'; g.lineWidth = (net.river.width + 4) / (ext * 2) * S;
      g.beginPath();
      net.river.pts.forEach(([x, z], i) => { const px = (x + ext) / (ext * 2) * S, py = (z + ext) / (ext * 2) * S; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
      const t = new THREE.CanvasTexture(c);
      mat.alphaMap = t; mat.alphaTest = 0.5;
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -0.06; m.receiveShadow = true;
    this.group.add(m);
    this.ground = m;
  }

  buildWater(builder) {
    const out = builder.outs.get('river');
    if (!out || !out.mesh.water) return;
    const pc = out.mesh.water;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pc.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(pc.uv, 2));
    geo.setIndex(pc.i);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.M.water);
    m.renderOrder = 2;
    this.group.add(m);
  }
}

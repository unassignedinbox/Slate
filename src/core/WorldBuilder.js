/* ============================================================================
   WorldBuilder — turns the road network into renderable chunks.

   The world is partitioned into square tiles. Each tile owns one merged
   BufferGeometry per material plus a set of InstancedMeshes, so a whole city
   district is a handful of draw calls.

   Two LOD levels:
     detail 0  full — 3 m stations, markings, symbols, props, track
     detail 1  far  — 12 m stations, surfaces only, no props

   Tiles are built through a time-budgeted job queue so the editor never
   blocks: you can keep flying while an 8 km city streams in behind you.
   ========================================================================== */

import * as THREE from 'three';
import { MeshSink, PropSink } from '../gen/MeshSink.js';
import { buildRoadSurface, makeElevation, makeBump, Ribbon } from '../gen/RoadMeshBuilder.js';
import { buildMarkings } from '../gen/Markings.js';
import { buildJunction, junctionMouths } from '../gen/Junction.js';
import { buildTrack, findCrossings } from '../gen/Railway.js';
import { placeProps } from '../gen/Props.js';
import { compileProfile } from '../gen/CrossSection.js';
import { clamp } from './mathx.js';

export const LOD_NEAR = 0;
export const LOD_FAR = 1;

export class WorldBuilder {
  constructor({ scene, net, materials, propGeos, terrain }) {
    this.scene = scene;
    this.net = net;
    this.materials = materials;
    this.propGeos = propGeos;
    this.terrain = terrain;

    this.group = new THREE.Group();
    this.group.name = 'roadWorld';
    scene.add(this.group);

    this.tileSize = 176;
    this.lodNearDist = 560;
    this.tiles = new Map();
    this.queue = [];
    this.building = false;
    this.progress = 1;
    this.stats = { tris: 0, draws: 0, tiles: 0, props: 0, buildMs: 0 };
    this._mouthCache = new Map();
    this._sectionCache = new Map();
    this.crossings = [];
    this.dirty = true;
  }

  /* ------------------------------------------------------------ layout -- */

  _key(i, j) { return `${i},${j}`; }

  _partition() {
    this.tiles.clear();
    const S = this.tileSize;
    const ensure = (i, j) => {
      const k = this._key(i, j);
      let t = this.tiles.get(k);
      if (!t) {
        t = { i, j, key: k, edges: [], nodes: [], group: null, detail: -1, box: new THREE.Box3(), center: new THREE.Vector3() };
        this.tiles.set(k, t);
      }
      return t;
    };
    const cellOf = (x, z) => [Math.floor(x / S), Math.floor(z / S)];

    for (const e of this.net.edges.values()) {
      if (!e.visible) continue;
      const c = e.curve(this.net);
      if (!c) continue;
      const A = this.net.nodes.get(e.a), B = this.net.nodes.get(e.b);
      if (!A || !B) continue;
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      const [i, j] = cellOf(mx, mz);
      ensure(i, j).edges.push(e.id);
      // widen the tile bounds so crossing geometry survives culling
      const t = ensure(i, j);
      t.box.expandByPoint(new THREE.Vector3(A.x, A.y, A.z));
      t.box.expandByPoint(new THREE.Vector3(B.x, B.y, B.z));
      const b = c.bounds();
      t.box.expandByPoint(new THREE.Vector3(b.mnx, A.y, b.mny));
      t.box.expandByPoint(new THREE.Vector3(b.mxx, B.y, b.mxy));
    }
    for (const n of this.net.nodes.values()) {
      const [i, j] = cellOf(n.x, n.z);
      const t = ensure(i, j);
      t.nodes.push(n.id);
      t.box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    }
    for (const t of this.tiles.values()) {
      if (t.box.isEmpty()) t.box.set(new THREE.Vector3(t.i * S, 0, t.j * S), new THREE.Vector3((t.i + 1) * S, 0, (t.j + 1) * S));
      t.box.expandByScalar(60);
      t.box.getCenter(t.center);
    }
  }

  /* ------------------------------------------------------------- build -- */

  /** Full rebuild: re-partition, queue every tile at far LOD. */
  rebuild() {
    this._sectionCache.clear();
    this._mouthCache.clear();
    net_mouths_clear(this);
    for (const e of this.net.edges.values()) { e._ribbon = null; e._section = null; e.invalidate(); }
    this._partition();
    this.crossings = findCrossings(this.net);
    this.computeMouths();

    // dispose existing
    for (const t of this.tiles.values()) this._disposeTile(t);
    for (const child of [...this.group.children]) this.group.remove(child);

    this.queue = [...this.tiles.values()].sort((a, b) =>
      a.center.distanceToSquared(this._lastCam || new THREE.Vector3()) -
      b.center.distanceToSquared(this._lastCam || new THREE.Vector3()));
    this.building = true;
    this.progress = 0;
    this._done = 0;
    this._total = Math.max(1, this.queue.length);
  }

  /** Pre-compute how far every junction patch reaches along each approach. */
  computeMouths() {
    this.mouths = new Map();
    for (const n of this.net.nodes.values()) {
      const m = junctionMouths(n, this.net, this._sectionCache);
      if (!m.size) continue;
      for (const [eid, dist] of m) {
        const prev = this.mouths.get(eid) || 0;
        this.mouths.set(eid, Math.max(prev, dist));
      }
    }
  }

  /** Build jobs for a fixed time budget each frame. */
  update(dt, cameraPos, budgetMs = 10) {
    this._lastCam = cameraPos;
    if (this.queue.length) {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < budgetMs) {
        const tile = this.queue.shift();
        if (!tile) break;
        const detail = this._desiredDetail(tile, cameraPos);
        this._buildTile(tile, detail);
        this._done++;
      }
      this.progress = clamp(this._done / this._total, 0, 1);
      this._recount();
      if (!this.queue.length) this.building = false;
      return true;
    }
    this.building = false;

    // LOD churn: swap a couple of tiles per frame at most
    if (cameraPos) {
      let swaps = 0;
      for (const t of this.tiles.values()) {
        if (swaps >= 2) break;
        const want = this._desiredDetail(t, cameraPos);
        if (want !== t.detail) {
          this._disposeTile(t);
          this._buildTile(t, want);
          swaps++;
        }
      }
      if (swaps) this._recount();
    }
    return false;
  }

  _desiredDetail(tile, camPos) {
    if (!camPos) return LOD_NEAR;
    const d = tile.box.distanceToPoint(camPos);
    return d < this.lodNearDist ? LOD_NEAR : LOD_FAR;
  }

  _disposeTile(tile) {
    if (!tile.group) return;
    tile.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.group.remove(tile.group);
    tile.group = null;
    tile.detail = -1;
  }

  _buildTile(tile, detail) {
    const net = this.net;
    const sink = new MeshSink();
    const propSink = new PropSink();
    const step = detail === LOD_NEAR ? 3.5 : 12.0;
    const wantMarkings = detail === LOD_NEAR;

    /* --- road ribbons first: junctions reuse them for their markings --- */
    const ribbons = new Map();
    for (const eid of tile.edges) {
      const e = net.edges.get(eid);
      if (!e) continue;
      const trimA = this.mouths?.get(e.id) || 0;
      const trimB = this.mouths?.get(e.id) || 0;
      const ctx = {
        step, detail, terrain: this.terrain,
        mergeStart: trimA, mergeEnd: trimB,
        skirt: 0.22,
      };
      let built;
      try {
        built = buildRoadSurface(e, net, sink, ctx);
      } catch (err) {
        console.warn('road build failed', e.id, err);
        continue;
      }
      if (!built) continue;
      const { ribbon, section } = built;
      e._ribbon = ribbon;
      e._section = section;
      ribbons.set(e.id, ribbon);

      if (wantMarkings) {
        try {
          buildMarkings(e, net, sink, ribbon, section, { trimStart: trimA, trimEnd: trimB });
        } catch (err) { console.warn('markings failed', e.id, err); }
        try {
          placeProps(e, net, propSink, ribbon, section, { detail, trimStart: trimA, trimEnd: trimB });
        } catch (err) { console.warn('props failed', e.id, err); }
      }
      if (e.isRail()) {
        const myCross = this.crossings.filter((c) => c.rail.id === e.id || c.road.id === e.id);
        for (const c of myCross) {
          ensureRibbon(c.road, net, this.terrain, this._sectionCache, 3.5);
          ensureRibbon(c.rail, net, this.terrain, this._sectionCache, 3.5);
        }
        try {
          buildTrack(e, net, sink, propSink, ribbon, section, { crossings: myCross, detail, step });
        } catch (err) { console.warn('track failed', e.id, err); }
      }
    }

    /* --- junction patches (reuse the ribbons built above) --- */
    for (const nid of tile.nodes) {
      const n = net.nodes.get(nid);
      if (!n) continue;
      try {
        buildJunction(n, net, sink, {
          sections: this._sectionCache,
          markings: wantMarkings,
          detail,
          terrain: this.terrain,
          ribbons,
        });
      } catch (err) { console.warn('junction failed', nid, err); }
    }

    /* --- assemble --- */
    const g = new THREE.Group();
    g.name = `tile_${tile.key}`;
    const built = sink.build((key) => this.materials.get(key) || this.materials.get('asphalt'));
    for (const { geometry, material } of built) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.tile = tile.key;
      g.add(mesh);
    }
    for (const im of propSink.build(
      (t) => this.propGeos.get(t),
      (t) => propMaterialFor(t, this.materials),
    )) {
      im.matrixAutoUpdate = false;
      g.add(im);
    }
    sink.dispose();
    propSink.dispose();

    tile.group = g;
    tile.detail = detail;
    this.group.add(g);
  }

  _recount() {
    let tris = 0, draws = 0, props = 0;
    for (const t of this.tiles.values()) {
      if (!t.group) continue;
      for (const c of t.group.children) {
        draws++;
        if (c.isInstancedMesh) { props += c.count; tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3 * c.count; }
        else tris += c.geometry.index ? c.geometry.index.count / 3 : c.geometry.attributes.position.count / 3;
      }
    }
    this.stats.tris = Math.round(tris);
    this.stats.draws = draws;
    this.stats.props = props;
    this.stats.tiles = this.tiles.size;
  }

  dispose() {
    for (const t of this.tiles.values()) this._disposeTile(t);
    this.group.clear();
  }
}

function net_mouths_clear(self) { self.mouths = new Map(); }

/** Build (and cache) a ribbon for an edge that isn't part of this tile. */
export function ensureRibbon(edge, net, terrain, sectionCache = new Map(), step = 3.5) {
  if (edge._ribbon) return edge._ribbon;
  const curve = edge.curve(net);
  if (!curve) return null;
  edge._step = step;
  let section = sectionCache.get(edge.id);
  if (!section) {
    section = compileProfile(edge.bandsOf(), { camber: edge.camber ?? 0.025 });
    sectionCache.set(edge.id, section);
  }
  const gain = edge.bankGain ?? 0;
  const maxBank = edge.maxBank ?? 0.08;
  edge._ribbon = new Ribbon({
    section, curve, edge,
    elevation: makeElevation(edge, net),
    terrain: terrain || null,
    bump: makeBump(edge, net),
    bank: gain > 0 ? (d) => clamp(-curve.curvature(d) * gain * 40, -maxBank, maxBank) : () => 0,
  });
  edge._section = section;
  return edge._ribbon;
}

function propMaterialFor(type, mats) {
  switch (type) {
    case 'lamp': case 'lamp_wall': case 'catenaryMast': case 'bollard_heritage':
      return mats.get('prop:metalDark');
    case 'bollard': return mats.get('prop:metal');
    case 'crossbuck': case 'sign': return mats.get('prop:white');
    case 'boom': return mats.get('prop:red');
    case 'tree': return mats.get('prop:leaf');
    case 'gully': return mats.get('prop:crete');
    default: return mats.get('prop:metal');
  }
}

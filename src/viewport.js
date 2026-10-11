// Viewport: three.js scene, sun, sky, ground, building the document into
// meshes, picking, selection highlight, view modes and draw-tool ghosting.
import * as THREE from 'three';
import { getMaterials } from './materials.js';
import { buildSegment, buildJunction, ribbonGeometry, samplePolyline, polylineSampleLength } from './roadbuilder.js';
import { buildRail, buildSubway } from './rail.js';
import { buildParkingLot, buildParkingDeck } from './parking.js';
import { collectProp, finishPropBuckets, propPieces, PROP_KINDS } from './props.js';
import { PROFILES, profileWidth } from './profiles.js';

const CLASS_COLORS = {
  motorway: 0xc9785f,
  highwayRamp: 0xc98f5f,
  boulevard: 0x7fa4e8,
  avenue: 0x8fb3d9,
  street: 0xa5c7a5,
  local: 0xc9c9a5,
  alley: 0xb3a3d5,
  pedestrian: 0xd5a4c4,
  pathway: 0xd5c4a4,
  cycleway: 0x7fc98f,
  busway: 0xe2a35c,
  tramStreet: 0xc9b08a,
  service: 0x9aa0aa,
  waterfront: 0x74bdd4,
};

export class Viewport {
  constructor(container, doc) {
    this.container = container;
    this.doc = doc;
    this.viewMode = 'lit';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9db2c9, 700, 2400);

    // gradient sky background
    this.scene.background = this.makeSkyTexture();

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.35, 4200);

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.position.set(180, 240, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -320;
    sc.right = 320;
    sc.top = 320;
    sc.bottom = -320;
    sc.near = 20;
    sc.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbdd3ee, 0x4a4f45, 1.05);
    this.scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0x9db8e8, 0.5);
    this.fill.position.set(-160, 130, -180);
    this.scene.add(this.fill);

    // ---- world layers ----
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.groundGroup = new THREE.Group();
    this.contentGroup = new THREE.Group();
    this.ghostGroup = new THREE.Group();
    this.pickGroup = new THREE.Group();
    this.world.add(this.groundGroup, this.contentGroup, this.ghostGroup, this.pickGroup);

    this.buildGround();

    // selection highlight
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), 0xb8c6ec);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.highlight2 = new THREE.Box3Helper(new THREE.Box3(), 0xb8c6ec);
    this.highlight2.material.transparent = true;
    this.highlight2.material.opacity = 0.28;
    this.highlight2.visible = false;
    this.scene.add(this.highlight2);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.fps = 60;
    this._frames = 0;
    this._fpsClock = performance.now();
    this.onStats = null;
  }

  makeSkyTexture() {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#7ea6d8');
    g.addColorStop(0.45, '#a8c3de');
    g.addColorStop(0.72, '#cfd8d9');
    g.addColorStop(1, '#b9b9a8');
    x.fillStyle = g;
    x.fillRect(0, 0, 16, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildGround() {
    const M = getMaterials();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200), M.grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.groundMesh = ground;
    this.groundGroup.add(ground);

    this.grid = new THREE.GridHelper(3000, 300, 0x3a4452, 0x2a3038);
    this.grid.position.y = 0.045;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.5;
    this.groundGroup.add(this.grid);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSun(azimuthDeg, elevationDeg) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const r = 320;
    this.sun.position.set(
      Math.cos(el) * Math.sin(az) * r,
      Math.max(30, Math.sin(el) * r),
      Math.cos(el) * Math.cos(az) * r
    );
  }

  /** Rebuild all geometry from the document. */
  rebuild() {
    // clear content
    for (const g of [this.contentGroup, this.pickGroup]) {
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      g.clear();
    }
    const doc = this.doc;
    const hiddenKinds = new Set(doc.hiddenKinds || []);

    // junctions
    if (!hiddenKinds.has('junctions')) {
      for (const jn of doc.junctions || []) {
        const arms = [
          { angle: 0 },
          { angle: Math.PI / 2 },
          { angle: Math.PI },
          { angle: -Math.PI / 2 },
        ];
        const g = buildJunction(jn.x, jn.z, jn.size + 7, arms, { name: jn.name });
        g.userData.objectId = jn.id;
        this.contentGroup.add(g);
      }
    }

    // road segments
    for (const seg of doc.segments) {
      if (seg.hidden) continue;
      const g = buildSegment(seg);
      this.contentGroup.add(g);
    }

    // rails
    for (const rail of doc.rails) {
      if (rail.hidden) continue;
      this.contentGroup.add(buildRail(rail));
    }

    // subways
    for (const sw of doc.subways) {
      if (sw.hidden) continue;
      this.contentGroup.add(buildSubway(sw));
    }

    // environment: river
    if (doc.env?.river) {
      const r = doc.env.river;
      const M = getMaterials();
      const water = new THREE.Mesh(new THREE.PlaneGeometry(r.length, r.half * 2), M.water);
      water.rotation.x = -Math.PI / 2;
      water.position.set(r.x, 0.06, r.z);
      water.receiveShadow = true;
      water.name = 'river';
      this.contentGroup.add(water);
      for (const side of [-1, 1]) {
        const quay = new THREE.Mesh(new THREE.BoxGeometry(r.length, 0.75, 1.2), M.concrete);
        quay.position.set(r.x, 0.34, r.z + side * (r.half + 0.6));
        quay.receiveShadow = true;
        this.contentGroup.add(quay);
      }
    }

    // parks + roundabout islands
    for (const park of doc.env?.parks || []) {
      if (park.hidden) continue;
      const M = getMaterials();
      const isCircle = park.shape === 'circle';
      const geo = isCircle
        ? new THREE.CylinderGeometry(park.w / 2, park.w / 2, 0.12, 36)
        : new THREE.BoxGeometry(park.w, 0.06, park.h);
      const pad = new THREE.Mesh(geo, park.kind === 'roundabout' ? M.concrete : M.grass);
      pad.position.set(park.x, isCircle ? 0.06 : 0.0, park.z);
      pad.receiveShadow = true;
      pad.name = park.name;
      pad.userData.objectId = park.id;
      pad.userData.kind = 'park';
      this.contentGroup.add(pad);
      if (isCircle) {
        const island = new THREE.Mesh(new THREE.CylinderGeometry(park.w / 2 - 4.5, park.w / 2 - 4.5, 0.34, 36), M.grass);
        island.position.set(park.x, 0.17, park.z);
        island.receiveShadow = true;
        this.contentGroup.add(island);
      }
    }

    // parking lots + decks
    for (const lot of doc.parkingLots || []) {
      if (lot.hidden) continue;
      const g = (lot.kind === 'deck' ? buildParkingDeck : buildParkingLot)(lot);
      this.contentGroup.add(g);
      // pick proxy slab
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry((lot.w ?? 72) + 4, 2 + (lot.kind === 'deck' ? (lot.levels ?? 3) * 3.4 : 0), (lot.h ?? 46) + 4),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      proxy.position.set(lot.x, 1, lot.z);
      proxy.rotation.y = lot.rotY ?? 0;
      proxy.userData.objectId = lot.id;
      proxy.userData.kind = 'parking';
      this.pickGroup.add(proxy);
    }

    // props: batched meshes + per-prop pick proxies
    const buckets = new Map();
    for (const prop of doc.props) {
      if (prop.hidden || hiddenKinds.has(prop.kind)) continue;
      collectProp(prop.kind, prop.x, prop.y ?? 0, prop.z, prop.rotY ?? 0, buckets, prop.opts || {});
      this.addPickProxy(prop.id, prop.kind, prop);
    }
    const propGroup = finishPropBuckets(buckets);
    propGroup.name = 'furniture';
    this.contentGroup.add(propGroup);

    // pick proxies for large objects
    for (const seg of doc.segments) this.addSegmentProxy(seg);
    for (const rail of doc.rails) this.addPolyProxy(rail.id, 'rail', rail.points);
    for (const sw of doc.subways) this.addPolyProxy(sw.id, 'subway', sw.points);

    this.applyViewMode(this.viewMode);
  }

  addPickProxy(id, kind, prop) {
    const pieces = propPieces(kind, prop.opts || {});
    let maxY = 1;
    let maxX = 0.4;
    let maxZ = 0.4;
    for (const p of pieces) {
      p.geo.computeBoundingBox?.();
      const bb = p.geo.boundingBox;
      if (bb) {
        maxY = Math.max(maxY, bb.max.y);
        maxX = Math.max(maxX, Math.abs(bb.max.x), Math.abs(bb.min.x));
        maxZ = Math.max(maxZ, Math.abs(bb.max.z), Math.abs(bb.min.z));
      }
      p.geo.dispose?.();
    }
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(maxX * 2, maxY + 0.4, maxZ * 2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    box.position.set(prop.x, (maxY + 0.4) / 2 + (prop.y ?? 0), prop.z);
    box.rotation.y = prop.rotY ?? 0;
    box.userData.objectId = id;
    box.userData.kind = 'prop';
    this.pickGroup.add(box);
  }

  addSegmentProxy(seg) {
    // A single invisible slab along the polyline: cheap & reliable picking.
    try {
      const samples = samplePolyline(seg.points, 6);
      const profile = PROFILES[seg.profile] || PROFILES.street;
      const half = profileWidth(profile) / 2 + 1;
      const geo = ribbonGeometry(samples, -half, half, 0.6, { vScale: 0 });
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
      mesh.userData.objectId = seg.id;
      mesh.userData.kind = 'segment';
      this.pickGroup.add(mesh);
    } catch {
      /* ignore degenerate */
    }
  }

  addPolyProxy(id, kind, points) {
    try {
      const samples = samplePolyline(points, 10);
      const geo = ribbonGeometry(samples, -6, 6, 0.8, { vScale: 0 });
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
      mesh.userData.objectId = id;
      mesh.userData.kind = kind;
      this.pickGroup.add(mesh);
    } catch {
      /* ignore */
    }
  }

  /** Raycast pick at client coordinates. Returns {id, kind} or null. */
  pick(clientX, clientY, preferGround = false) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (preferGround) {
      const hits = this.raycaster.intersectObject(this.groundMesh, false);
      return hits.length ? { ground: hits[0].point } : null;
    }
    const hits = this.raycaster.intersectObjects(this.pickGroup.children, false);
    if (hits.length) {
      return { id: hits[0].object.userData.objectId, kind: hits[0].object.userData.kind };
    }
    // fall back to real geometry (segments / rails)
    const deep = this.raycaster.intersectObjects(this.contentGroup.children, true);
    for (const h of deep) {
      let o = h.object;
      while (o && !o.userData?.objectId) o = o.parent;
      if (o?.userData?.objectId) return { id: o.userData.objectId, kind: o.userData.kind };
      if (h.object.name === 'ground') break;
    }
    return null;
  }

  /** Ground intersection point for the draw tools. */
  groundPoint(clientX, clientY) {
    const res = this.pick(clientX, clientY, true);
    return res?.ground || null;
  }

  setSelection(objectId) {
    if (!objectId) {
      this.highlight.visible = false;
      this.highlight2.visible = false;
      return;
    }
    const box = new THREE.Box3();
    let found = false;
    this.pickGroup.traverse((o) => {
      if (o.userData?.objectId === objectId) {
        box.expandByObject(o);
        found = true;
      }
    });
    if (!found) {
      this.contentGroup.traverse((o) => {
        if (o.userData?.objectId === objectId) {
          box.expandByObject(o);
          found = true;
        }
      });
    }
    if (!found || box.isEmpty()) {
      this.highlight.visible = false;
      this.highlight2.visible = false;
      return;
    }
    box.expandByScalar(0.35);
    this.highlight.box.copy(box);
    this.highlight2.box.copy(box);
    this.highlight.visible = true;
    this.highlight2.visible = true;
  }

  setGhost(points, cursor, profileKey) {
    this.clearGhost();
    if (!points?.length && !cursor) return;
    const pts = [...(points || [])];
    if (cursor) pts.push(cursor);
    if (pts.length >= 2) {
      const v = pts.map((p) => new THREE.Vector3(p.x, (p.y ?? 0) + 0.5, p.z));
      const geo = new THREE.BufferGeometry().setFromPoints(v);
      const line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({ color: 0xb8c6ec, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.9 })
      );
      line.computeLineDistances();
      this.ghostGroup.add(line);
    }
    for (const p of pts) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xb8c6ec, transparent: true, opacity: 0.85 })
      );
      dot.position.set(p.x, (p.y ?? 0) + 0.6, p.z);
      this.ghostGroup.add(dot);
    }
    if (cursor && profileKey) {
      const profile = PROFILES[profileKey];
      const half = profile ? profileWidth(profile) / 2 : 4;
      const ghost = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2, 14),
        new THREE.MeshBasicMaterial({ color: 0xb8c6ec, transparent: true, opacity: 0.16, depthWrite: false })
      );
      ghost.rotation.x = -Math.PI / 2;
      ghost.position.set(cursor.x, (cursor.y ?? 0) + 0.35, cursor.z);
      this.ghostGroup.add(ghost);
    }
  }

  clearGhost() {
    this.ghostGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    this.ghostGroup.clear();
  }

  setPropGhost(kind, point, rotY = 0) {
    this.clearGhost();
    if (!point || !kind) return;
    if (kind === 'parking-lot' || kind === 'parking-deck') {
      const isDeck = kind === 'parking-deck';
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(isDeck ? 58 : 66, isDeck ? 10.5 : 0.25, isDeck ? 40 : 42),
        new THREE.MeshBasicMaterial({ color: 0xb8c6ec, transparent: true, opacity: 0.16, depthWrite: false })
      );
      pad.position.set(point.x, (isDeck ? 10.5 : 0.25) / 2 + (point.y ?? 0) - 0.1, point.z);
      pad.rotation.y = rotY;
      this.ghostGroup.add(pad);
      return;
    }
    const M = getMaterials();
    const group = new THREE.Group();
    group.position.set(point.x, point.y ?? 0, point.z);
    group.rotation.y = rotY;
    for (const piece of propPieces(kind, {})) {
      const mat = piece.material || M[piece.mat] || M.metalDark;
      const mesh = new THREE.Mesh(piece.geo, mat.clone());
      mesh.material.transparent = true;
      mesh.material.opacity = 0.65;
      if ('emissive' in mesh.material) mesh.material.emissive = new THREE.Color(0x223344);
      group.add(mesh);
    }
    this.ghostGroup.add(group);
  }

  applyViewMode(mode) {
    this.viewMode = mode;
    this.doc.settings.viewMode = mode;
    const wire = mode === 'wire';
    const classes = mode === 'classes';
    const subway = mode === 'subway';

    this.grid.visible = this.doc.settings.showGrid && !classes;
    if (this.groundMesh) {
      this.groundMesh.material.transparent = subway;
      this.groundMesh.material.opacity = subway ? 0.22 : 1;
      this.groundMesh.material.depthWrite = !subway;
    }

    this.contentGroup.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData._origMat === undefined) o.userData._origMat = o.material;
      if (wire) {
        if (!o.userData._wireMat) {
          o.userData._wireMat = new THREE.MeshBasicMaterial({ color: 0x7f93b8, wireframe: true });
        }
        o.material = o.userData._wireMat;
      } else if (classes) {
        if (!o.userData._classMat) {
          const seg = this.doc.segments.find((s) => s.id === o.parent?.userData?.objectId);
          const color = seg ? CLASS_COLORS[seg.profile] ?? 0x8fa0b8 : 0x5c6674;
          o.userData._classMat = new THREE.MeshBasicMaterial({ color });
        }
        o.material = o.userData._classMat;
      } else {
        o.material = o.userData._origMat;
      }
    });
  }

  setGridVisible(v) {
    this.doc.settings.showGrid = v;
    this.grid.visible = v && this.viewMode !== 'classes';
  }

  render(dt, cameraCtrl) {
    cameraCtrl.update(dt);
    this.setSun(this.doc.settings.sunAzimuth, this.doc.settings.sunElevation);
    this.renderer.render(this.scene, this.camera);
    this._frames++;
    const now = performance.now();
    if (now - this._fpsClock > 500) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsClock));
      this._frames = 0;
      this._fpsClock = now;
      this.onStats?.(this.fps);
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

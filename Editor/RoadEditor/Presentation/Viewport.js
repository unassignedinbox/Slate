//============================================================================================================================================
// 📦 Editor/RoadEditor/Presentation/Viewport.js — Renderer, camera, sky, and the overlay that shows what is selected
//============================================================================================================================================
// Everything visual that is not geometry lives here: the WebGL2 context, the fly camera the interaction layer drives, the sky dome and its sun, and
//    the selection/hover ribbons drawn over the baked world. The overlay is built from the same fairing the kernel uses, so what you see selected is
//    exactly the centrepeline the bake swept — no second smoothing that would put the highlight beside the road it highlights.
'use strict';

import * as THREE from 'three';
import { createRoadMaterial, setAtlas } from './RoadMaterial.js';
import { createPropMaterial, createGlowMaterial } from './PropMaterial.js';
import { propTemplates } from './PropGeometry.js';
import { SectorManager } from './SectorManager.js';
import { Lighting } from './Lighting.js';
import { markingAtlas, signAtlas } from './Atlas.js';
import { fairRoad, DEFAULTS } from '../Kernel/SkinSolver.js';
import { getProfile } from '../Kernel/ProfileSolver.js';

export class Viewport {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.setClearColor(0x0b0c0d, 1);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(58, 1, 0.35, 9000);
        this.camera.rotation.order = 'YXZ';
        this.camera.position.set(240, 90, 420);
        this.lighting = new Lighting('noon');
        this.markings = 1;

        const plates = signAtlas();
        const symbols = markingAtlas();
        this.roadMaterial = createRoadMaterial({ markings: 1 });
        setAtlas(this.roadMaterial, symbols);
        this.propMaterial = createPropMaterial();
        this.glowMaterial = createGlowMaterial();
        for (const m of [this.propMaterial, this.glowMaterial]) {
            const tex = new THREE.CanvasTexture(plates);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            tex.generateMipmaps = false;
            tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
            m.uniforms.uPlates.value = tex;
        }
        this.materials = [this.roadMaterial, this.propMaterial, this.glowMaterial];
        this.lighting.apply(this.materials);

        this.worldGroup = new THREE.Group();
        this.worldGroup.name = 'world';
        this.scene.add(this.worldGroup);
        this.templates = propTemplates();
        for (const [k, v] of Object.entries(this.templates)) v.key = k;
        this.sectors = new SectorManager({
            group: this.worldGroup, roadMaterial: this.roadMaterial, propMaterial: this.propMaterial,
            glowMaterial: this.glowMaterial, templates: this.templates,
        });

        this._buildSky();
        this._buildOverlay();
        this._clock = 0;
        this.resize();
        this.stats = { fps: 0, tris: 0, calls: 0 };
        this._fpsAcc = 0; this._fpsN = 0;
    }

    _buildSky() {
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            uniforms: {
                uTop: { value: new THREE.Color(0x9cc4e8) }, uBottom: { value: new THREE.Color(0xdfeaf0) },
                uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xffffff) },
                uNight: { value: new THREE.Vector3() },
            },
            vertexShader: `out vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader: `
precision highp float;
in vec3 vDir;
uniform vec3 uTop, uBottom, uSunDir, uSunColor, uNight;
vec3 enc(vec3 c){ c=max(c,0.0); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(vec3(0.0031308), c)); }
void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    float t = pow(max(h, 0.0), 0.62);
    vec3 col = mix(uBottom, uTop, t);
    float d = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(d, 220.0) * 1.6 + pow(d, 8.0) * 0.16);
    col *= mix(1.0, 0.42, uNight.x);
    // night sky gains a shallow star field so the horizon does not read as a flat poster
    float st = step(0.9985, fract(sin(dot(floor(vDir.xz * 420.0), vec2(12.9898, 78.233))) * 43758.5453));
    col += vec3(st) * uNight.x * step(0.05, h) * 0.6;
    gl_FragColor = vec4(enc(col), 1.0);
}`,
        });
        this.skyMat = mat;
        this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), mat);
        this.sky.frustumCulled = false;
        this.sky.renderOrder = -100;
        this.scene.add(this.sky);
    }

    _buildOverlay() {
        const mk = (color, opacity, order) => new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
            uniforms: { uC: { value: new THREE.Color(color) }, uO: { value: opacity } },
            vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader: `precision highp float; uniform vec3 uC; uniform float uO;
void main(){ gl_FragColor = vec4(uC, uO); }`,
        });
        this.selMat = mk(0x4fd8e0, 0.5, 900);
        this.hoverMat = mk(0xffffff, 0.22, 890);
        this.toolMat = mk(0x6c77ff, 0.55, 901);
        this.selMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.selMat);
        this.hoverMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.hoverMat);
        this.toolMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.toolMat);
        for (const m of [this.selMesh, this.hoverMesh, this.toolMesh]) {
            m.frustumCulled = false; m.renderOrder = 900; m.matrixAutoUpdate = false;
            this.scene.add(m);
        }
        const dotMat = (color, size) => new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.95, depthTest: false });
        this.nodePoints = new THREE.Points(new THREE.BufferGeometry(), dotMat(0x4fd8e0, 2.2));
        this.handlePoints = new THREE.Points(new THREE.BufferGeometry(), dotMat(0xf59e0b, 3.4));
        for (const p of [this.nodePoints, this.handlePoints]) { p.frustumCulled = false; p.renderOrder = 940; this.scene.add(p); }
    }

    resize() {
        const el = this.canvas.parentElement || document.body;
        const w = Math.max(2, el.clientWidth || 640), h = Math.max(2, el.clientHeight || 400);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.viewportSize = [w, h];
        return this;
    }

    setMood(name) { this.lighting.set(name); this.lighting.apply(this.materials); this._syncSky(); return this; }
    setMarkings(on) { this.markings = on ? 1 : 0; this.roadMaterial.uniforms.uMarkings.value = this.markings; return this; }
    setXray(on) { this.sectors.setXray(on); return this; }
    setPropsVisible(on) { this.sectors.setPropsVisible(on); return this; }
    setSpeedScale(v) { this.roadMaterial.uniforms.uDetail.value = v; return this; }

    _syncSky() {
        const l = this.lighting;
        this.skyMat.uniforms.uTop.value.copy(l.skyTop);
        this.skyMat.uniforms.uBottom.value.copy(l.skyBottom);
        this.skyMat.uniforms.uSunDir.value.copy(l.sunDir);
        this.skyMat.uniforms.uSunColor.value.copy(l.sunColor);
        this.skyMat.uniforms.uNight.value.copy(l.night);
        this.scene.fog = new THREE.FogExp2(l.fogColor.getHex(), l.fogDensity);
        void THREE;
    }

    applyBake(bake) {
        const stats = this.sectors.apply(bake);
        this.bakeStats = stats;
        return stats;
    }

    /** @param {{x:number,z:number,y:number}[]} ring */
    drawToolRibbon(ring, width, opts) {
        fillRibbon(this.toolMesh, ring, width, opts);
    }
    clearTool() { this.toolMesh.geometry.dispose(); this.toolMesh.geometry = new THREE.BufferGeometry(); }

    /** @param {number[]} ids selected road ids @param {number[]} nodeIds @param {object} doc @param {number} hoverId */
    setSelection(ids, nodeIds, doc, hoverId, settings = DEFAULTS) {
        const geoms = [];
        for (const id of ids || []) {
            const road = doc.roads.find((r) => r.id === id);
            if (road) geoms.push(ribbonFor(road, settings, 0.6));
        }
        mergeInto(this.selMesh, geoms, this.selMat);
        const hover = hoverId != null ? doc.roads.find((r) => r.id === hoverId) : null;
        mergeInto(this.hoverMesh, hover ? [ribbonFor(hover, settings, 0.35)] : [], this.hoverMat);
        // With no explicit node list, show the ends of what is selected: enough to grab, without carpeting a 4000-node city in dots.
        const wanted = nodeIds || (ids && ids.length ? endsOf(doc, ids) : []);
        const nodes = [];
        for (const key in doc.nodes) {
            const n = doc.nodes[key];
            if (!n || !wanted.includes(n.id)) continue;
            nodes.push(n.x, (n.y ?? 0) + 0.35, n.z);
        }
        setPoints(this.nodePoints, nodes);
        const handles = [];
        for (const id of ids || []) {
            const road = doc.roads.find((r) => r.id === id);
            if (!road) continue;
            for (const p of road.points) handles.push(p.x, (p.y ?? 0) + 0.45, p.z);
        }
        setPoints(this.handlePoints, handles);
    }

    render(dt) {
        this._clock += dt || 0.016;
        this.roadMaterial.uniforms.uTime.value = this._clock;
        this.propMaterial.uniforms.uTime.value = this._clock;
        this.glowMaterial.uniforms.uTime.value = this._clock;
        this.sky.position.copy(this.camera.position);
        this.sky.scale.setScalar(this.camera.far * 0.86);
        this.sectors.cull(this.camera, { lodScale: this.lodScale ?? 1 });
        this.renderer.render(this.scene, this.camera);
        this._fpsAcc += dt || 0.016; this._fpsN++;
        if (this._fpsAcc > 0.5) {
            this.stats.fps = Math.round(this._fpsN / this._fpsAcc);
            this._fpsAcc = 0; this._fpsN = 0;
            const info = this.renderer.info.render;
            this.stats.tris = info.triangles; this.stats.calls = info.calls;
        }
        return this.stats;
    }

    /** Ray through a client-space point, for picking and for placing geometry. */
    rayAt(clientX, clientY) {
        const r = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        const rayer = new THREE.Raycaster();
        rayer.setFromCamera(ndc, this.camera);
        return { ray: rayer.ray, ndc, rect: r };
    }
    /** Intersect a screen point with a horizontal plane, e.g. the ground at the camera's current working height. */
    groundAt(clientX, clientY, y = 0) {
        const { ray } = this.rayAt(clientX, clientY);
        if (Math.abs(ray.direction.y) < 1e-5) return null;
        const t = (y - ray.origin.y) / ray.direction.y;
        if (t < 0) return null;
        return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t, t };
    }
    dispose() {
        this.sectors.clear();
        this.renderer.dispose();
    }
}

function endsOf(doc, ids) {
    const out = [];
    for (const id of ids) { const r = doc.byId(id); if (r) out.push(r.nodeA, r.nodeB); }
    return out;
}
function ribbonFor(road, settings, pad) {
    const fair = fairRoad(road, settings) || road.points;
    const prof = getProfile(road.profile);
    const half = Math.max(prof.width * 0.5, 1.2) + pad;
    return { pts: fair, half };
}
function fillRibbon(mesh, ring, width, opts = {}) {
    const pts = (ring && ring.pts) ? ring.pts : ring;
    if (!pts || pts.length < 2) return;
    mesh.geometry.dispose();
    mesh.geometry = ribbonGeometry([{ pts, half: (ring && ring.half ? ring.half : width * 0.5) + 0.2 }], opts.y ?? 0.06);
}
function mergeInto(mesh, ribbons, mat) {
    const list = ribbons.filter(Boolean);
    if (!list.length) { mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry(); return; }
    const pos = [];
    const idx = [];
    for (const r of list) appendRibbon(pos, idx, r.pts, r.half);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = g;
    void mat;
}
function appendRibbon(pos, idx, pts, half) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; ++i) {
        const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(0, i - 1)];
        let tx = q.x - o.x, tz = q.z - o.z;
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        const w = half * (1 + 0.35 * Math.sin(i * 0.7));
        pos.push(p.x + tz * w, (p.y ?? 0) + 0.07, p.z - tx * w, p.x - tz * w, (p.y ?? 0) + 0.07, p.z + tx * w);
    }
    for (let i = 0; i + 1 < pts.length; ++i) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
}
function ribbonGeometry(ribbons, y) {
    const pos = [], idx = [];
    for (const r of ribbons) appendRibbon(pos, idx, r.pts, r.half);
    void y;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
}
function setPoints(points, arr) {
    const g = new THREE.BufferGeometry();
    if (arr.length) g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    points.geometry.dispose();
    points.geometry = g;
}

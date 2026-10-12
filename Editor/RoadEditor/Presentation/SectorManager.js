//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/../Presentation/SectorManager.js — Turns a bake result into a scene graph, and only what changed
//============================================================================================================================================
// The worker returns tiles of packed vertex data plus instanced prop records. This keeps one Mesh per tile and one InstancedBufferGeometry per
//    (prop type, macro cell), reusing whatever is byte-identical so an edit to one intersection re-uploads one tile instead of the world. Geometry is
//    never rebuilt in place: a tile is replaced or kept, which is also what makes undo cheap.
'use strict';

import * as THREE from 'three';
import { PROPS } from '../Kernel/PropSolver.js';

const LOD_RANGE = [190, 520, 1400];       // [m] per prop tier: close-only, mid, far
const XRAY_PROPS = new Set(['subwayIn', 'vent', 'lampGlow', 'tunnelLight', 'tree']);

export class SectorManager {
    /**
     * @param {object} opts {group, roadMaterial, propMaterial, glowMaterial, templates}
     */
    constructor(opts) {
        this.group = opts.group;
        this.roadMaterial = opts.roadMaterial;
        this.propMaterial = opts.propMaterial;
        this.glowMaterial = opts.glowMaterial;
        this.templates = opts.templates;
        this.sectors = new Map();          // key → {mesh, sig}
        this.propMeshes = [];
        this.stats = { tiles: 0, reused: 0, uploads: 0, propDraws: 0 };
        this.layers = { roads: true, props: true, xray: 0 };
    }

    /** @param {{sectors: Array, props: ?object}} bake */
    apply(bake) {
        const seen = new Set();
        let reused = 0, uploads = 0;
        for (const sec of bake.sectors || []) {
            const key = sec.i + ':' + sec.j;
            seen.add(key);
            const sig = `${sec.verts}|${sec.tris}|${sec.min[0].toFixed(2)},${sec.min[1].toFixed(2)}|${sec.max[0].toFixed(2)},${sec.max[1].toFixed(2)}|${sec.lo.toFixed(2)},${sec.hi.toFixed(2)}`;
            const had = this.sectors.get(key);
            if (had && had.sig === sig) { reused++; continue; }
            if (had) { this._dropSector(had); }
            const mesh = this._buildSector(sec);
            this.sectors.set(key, { mesh, sig, i: sec.i, j: sec.j });
            this.group.add(mesh);
            uploads++;
        }
        for (const [key, rec] of Array.from(this.sectors)) {
            if (seen.has(key)) continue;
            this._dropSector(rec);
            this.sectors.delete(key);
        }
        this._applyProps(bake.props);
        this.stats = { tiles: this.sectors.size, reused, uploads, propDraws: this.propMeshes.length };
        return this.stats;
    }

    _dropSector(rec) {
        this.group.remove(rec.mesh);
        rec.mesh.geometry.dispose();
    }

    _buildSector(sec) {
        const g = new THREE.BufferGeometry();
        const A = THREE.BufferAttribute;
        g.setAttribute('position', new A(sec.pos, 3));
        g.setAttribute('aST', new A(sec.st, 2));
        g.setAttribute('aDist', new A(sec.dist, 4));
        // Ids travel as raw bytes: three only normalises a byte attribute when it is flagged so, and the shader wants 0…255.
        g.setAttribute('aMisc', new A(sec.misc, 4, false));
        g.setAttribute('aMark', new A(sec.mark, 4, false));
        g.setAttribute('aBump', new A(sec.bump, 1));
        g.setIndex(new A(sec.idx, 1));
        const cx = (sec.min[0] + sec.max[0]) * 0.5, cz = (sec.min[1] + sec.max[1]) * 0.5;
        const r = Math.hypot(sec.max[0] - sec.min[0], sec.max[1] - sec.min[1]) * 0.5 + Math.max(Math.abs(sec.hi), Math.abs(sec.lo)) + 2;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (sec.hi + sec.lo) * 0.5, cz), r);
        g.boundingBox = new THREE.Box3(new THREE.Vector3(sec.min[0], sec.lo, sec.min[1]), new THREE.Vector3(sec.max[0], sec.hi, sec.max[1]));
        const mesh = new THREE.Mesh(g, this.roadMaterial);
        mesh.frustumCulled = true;
        mesh.matrixAutoUpdate = false;
        mesh.name = `sector ${sec.i},${sec.j}`;
        mesh.userData.sector = [sec.i, sec.j];
        return mesh;
    }

    _applyProps(props) {
        for (const rec of this.propMeshes) {
            this.group.remove(rec.mesh);
            rec.mesh.geometry.dispose();
        }
        this.propMeshes.length = 0;
        if (!props || !props.types) return;
        const m = props.macro || 660;
        for (const t of props.types) {
            const tpl = this.templates[t.type];
            if (!tpl) continue;
            const glow = !!(PROPS[t.type] && PROPS[t.type].glow);
            const shared = this._shared(tpl);
            for (const cell of t.cells) {
                const n = cell.count;
                if (!n) continue;
                const pf = new Float32Array(n * 4), ps = new Float32Array(n * 4);
                for (let k = 0; k < n; ++k) {
                    const o = k * 8;
                    pf[k * 4] = cell.data[o]; pf[k * 4 + 1] = cell.data[o + 1]; pf[k * 4 + 2] = cell.data[o + 2]; pf[k * 4 + 3] = cell.data[o + 3];
                    ps[k * 4] = cell.data[o + 4]; ps[k * 4 + 1] = cell.data[o + 5]; ps[k * 4 + 2] = cell.data[o + 6]; ps[k * 4 + 3] = cell.data[o + 7];
                }
                const g = new THREE.InstancedBufferGeometry();
                g.setAttribute('position', shared.position);
                g.setAttribute('normal', shared.normal);
                g.setAttribute('uv', shared.uv);
                g.setAttribute('aMode', shared.mode);
                g.setAttribute('iPF', new THREE.InstancedBufferAttribute(pf, 4));
                g.setAttribute('iPS', new THREE.InstancedBufferAttribute(ps, 4));
                g.instanceCount = n;
                const x0 = cell.mx * m, z0 = cell.mz * m;
                const cx = x0 + m * 0.5, cz = z0 + m * 0.5;
                g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 3, cz), m * 0.75 + 14);
                g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, -20, z0), new THREE.Vector3(x0 + m, 14, z0 + m));
                const mesh = new THREE.Mesh(g, glow ? this.glowMaterial : this.propMaterial);
                mesh.name = `props ${t.type} ${cell.mx},${cell.mz}`;
                mesh.matrixAutoUpdate = false;
                mesh.userData.prop = { type: t.type, tier: PROPS[t.type] ? PROPS[t.type].lod : 2, n, cx, cz, r: m * 0.7 };
                this.group.add(mesh);
                this.propMeshes.push({ mesh, type: t.type });
            }
        }
    }

    /** Template attributes are shared objects, so every tile of one prop type reuses the same GPU buffers. */
    _shared(tpl) {
        if (!this._sharedCache) this._sharedCache = new Map();
        let s = this._sharedCache.get(tpl);
        if (s) return s;
        s = {
            position: new THREE.BufferAttribute(tpl.position, 3),
            normal: new THREE.BufferAttribute(tpl.normal, 3),
            uv: new THREE.BufferAttribute(tpl.uv, 2),
            mode: new THREE.BufferAttribute(tpl.mode, 1),
        };
        for (const a of Object.values(s)) a.setUsage(THREE.StaticDrawUsage);
        this._sharedCache.set(tpl, s);
        return s;
    }

    /** Distance tier gate: a bollard is not worth a draw call at 800 m, and a tree usually is. X-ray keeps only what belongs underground. */
    cull(camera, opts = {}) {
        const lodScale = opts.lodScale ?? 1;
        const x = this.layers.xray;
        for (const { mesh } of this.propMeshes) {
            const p = mesh.userData.prop;
            const d = Math.hypot(camera.position.x - p.cx, camera.position.z - p.cz) - p.r;
            const range = p.tier === 0 ? LOD_RANGE[0] : p.tier === 1 ? LOD_RANGE[1] : LOD_RANGE[2];
            let vis = this.layers.props && d < range * lodScale;
            if (vis && x) vis = XRAY_PROPS.has(p.type);
            mesh.visible = vis;
        }
    }

    setXray(on) {
        this.layers.xray = on ? 1 : 0;
        if (this.roadMaterial) this.roadMaterial.uniforms.uXray.value = this.layers.xray;
    }
    setPropsVisible(on) { this.layers.props = !!on; }
    setTime(t) {
        if (this.roadMaterial) this.roadMaterial.uniforms.uTime.value = t;
        if (this.propMaterial) this.propMaterial.uniforms.uTime.value = t;
        if (this.glowMaterial) this.glowMaterial.uniforms.uTime.value = t;
    }
    clear() {
        for (const [, rec] of Array.from(this.sectors)) { this._dropSector(rec); }
        this.sectors.clear();
        for (const rec of this.propMeshes) { this.group.remove(rec.mesh); rec.mesh.geometry.dispose(); }
        this.propMeshes.length = 0;
    }
}

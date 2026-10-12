//============================================================================================================================================
// 📦 Editor/RoadEditor/UI/Minimap.js — The whole network in a corner
//============================================================================================================================================
// A road editor without a sense of scale is a cave. This draws the network straight from the document — no GPU round trip, so it can never disagree
//    with the bake — classes the strokes, shows the camera frustum, and turns a click into a fly-to. Redraws are throttled: it is a locator, not a
//    second viewport, and 12 fps is enough to feel attached.
'use strict';

import { getProfile } from '../Kernel/ProfileSolver.js';

const CLASS_COLOR = { highway: '#f59e0b', arterial: '#4fd8e0', collector: '#6c77ff', local: '#5d666e', service: '#3f4650', street: '#7dd3a0', path: '#4b5a52', water: '#2f6f8f', rail: '#c9a227' };

export class Minimap {
    /** @param {object} app */
    constructor(app, { w = 236, h = 168 } = {}) {
        this.app = app;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'minimap';
        this.canvas.width = w * 2; this.canvas.height = h * 2;
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.g = this.canvas.getContext('2d');
        this.size = [w, h];
        this.every = 0.08;
        this._t = 0;
        this.canvas.addEventListener('pointerdown', (e) => this._click(e));
        this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.15, Math.min(6, (this.zoom || 1) * (e.deltaY > 0 ? 1 / 1.2 : 1.2))); this.dirty = true; }, { passive: false });
    }
    element() { return this.canvas; }
    invalidate() { this.dirty = true; }
    _click(e) {
        const r = this.canvas.getBoundingClientRect();
        const p = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        if (!p) return;
        this.center = p;
        if (e.button === 0) this.app.camera.goTo(p.x, p.z, Math.max(30, this.app.camera.speed * 1.4));
        this.dirty = true;
    }
    toWorld(px, py) {
        const view = this.view;
        if (!view) return null;
        const [w, h] = this.size;
        const u = px / w, v = py / h;
        return { x: view.x0 + (view.x1 - view.x0) * u, z: view.z0 + (view.z1 - view.z0) * v };
    }
    toScreen(x, z) {
        const view = this.view;
        if (!view) return null;
        const [w, h] = this.size;
        return [((x - view.x0) / (view.x1 - view.x0)) * w, ((z - view.z0) / (view.z1 - view.z0)) * h];
    }
    update(dt) {
        this._t += dt || 0.016;
        if (!this.dirty && this._t < this.every) return;
        this._t = 0; this.dirty = false;
        this.draw();
    }
    draw() {
        const { g, size: [w, h] } = this;
        const doc = this.app.doc;
        const g2 = this.g;
        g2.setTransform(2, 0, 0, 2, 0, 0);
        g2.clearRect(0, 0, w, h);
        g2.fillStyle = '#0f1113';
        g2.fillRect(0, 0, w, h);
        const box = doc.bbox() || { x0: -1200, x1: 1200, z0: -1200, z1: 1200 };
        const cx = this.center ? this.center.x : (box.x0 + box.x1) / 2;
        const cz = this.center ? this.center.z : (box.z0 + box.z1) / 2;
        const span = Math.max(box.x1 - box.x0, box.z1 - box.z0) / (this.zoom || 1);
        const half = Math.max(span * 0.55, 120);
        this.view = { x0: cx - half, x1: cx + half, z0: cz - half * (h / w), z1: cz + half * (h / w) };
        // water first, then everything paved on top
        g2.lineCap = 'round';
        for (const pass of [0, 1]) {
            for (const road of doc.roads) {
                const prof = getProfile(road.profile);
                const isWater = prof.water || prof.cls === 'water';
                if ((pass === 0) !== !!isWater) continue;
                const cls = prof.cls || 'local';
                g2.strokeStyle = CLASS_COLOR[cls] || '#666';
                g2.globalAlpha = cls === 'highway' || cls === 'arterial' ? 0.95 : 0.62;
                g2.lineWidth = cls === 'highway' ? 2.1 : cls === 'arterial' ? 1.5 : cls === 'rail' ? 1.2 : 0.8;
                g2.beginPath();
                let started = false;
                for (const p of road.points) {
                    const s = this.toScreen(p.x, p.z);
                    if (!s) continue;
                    if (!started) { g2.moveTo(s[0], s[1]); started = true; } else g2.lineTo(s[0], s[1]);
                }
                g2.stroke();
            }
        }
        g2.globalAlpha = 1;
        // selection + camera wedge
        for (const id of doc.selection) {
            const road = doc.byId(id);
            if (!road) continue;
            g2.strokeStyle = '#eaf6ff';
            g2.lineWidth = 1.6;
            g2.beginPath();
            road.points.forEach((p, i) => { const s = this.toScreen(p.x, p.z); if (!s) return; i ? g2.lineTo(s[0], s[1]) : g2.moveTo(s[0], s[1]); });
            g2.stroke();
        }
        const cam = this.app.viewport.camera;
        const cs = this.toScreen(cam.position.x, cam.position.z);
        if (cs) {
            const yaw = this.app.camera.yaw ?? 0;
            const dir = [-Math.sin(yaw), -Math.cos(yaw)];
            const px = w * 0.13, ang = Math.atan2(dir[1], dir[0]);
            g2.fillStyle = 'rgba(79,216,224,0.22)';
            g2.beginPath();
            g2.moveTo(cs[0], cs[1]);
            g2.arc(cs[0], cs[1], px * 2.1, ang - 0.42, ang + 0.42);
            g2.closePath();
            g2.fill();
            g2.fillStyle = '#4fd8e0';
            g2.beginPath(); g2.arc(cs[0], cs[1], 2.6, 0, 6.3); g2.fill();
        }
        void g;
    }
}

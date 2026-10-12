//============================================================================================================================================
// 📦 Editor/RoadEditor/Interaction/CameraFly.js — Unreal-style navigation: right-drag to look, WASD to fly
//============================================================================================================================================
// Same feel as a game camera: the mouse turns, the keys move, acceleration is damped so a tap does not jolt, and the wheel sets cruise speed
//    instead of zooming — at 3 km scale a zoom wheel is useless while a speed wheel is the difference between inspecting a kerb and crossing the
//    city. Pointer lock (F) is the pawn mode: no cursor, no drift, and Escape hands it back.
'use strict';

const KEY_DOWN = { key: 'e', up: 'q' };

export class CameraFly {
    /** @param {THREE.PerspectiveCamera} camera @param {HTMLElement} dom */
    constructor(camera, dom, opts = {}) {
        this.camera = camera;
        this.dom = dom;
        this.enabled = true;
        this.speed = opts.speed ?? 55;            // [m/s] cruise
        this.boost = 5.5;
        this.crawl = 0.12;
        this.turn = 0.0022;                       // [rad/px]
        this.pitch = -0.55;
        this.yaw = 0.7;
        this.smoothing = 0.12;
        this.keys = new Set();
        this.vel = { x: 0, y: 0, z: 0 };
        this.pointer = null;
        this.locked = false;
        this.minY = opts.minY ?? -60;
        this.maxY = opts.maxY ?? 2200;
        this._onKey = this._onKey.bind(this);
        this._onPointer = this._onPointer.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onLock = this._onLock.bind(this);
        window.addEventListener('keydown', this._onKey, true);
        window.addEventListener('keyup', this._onKey, true);
        dom.addEventListener('pointerdown', this._onPointer, true);
        dom.addEventListener('wheel', this._onWheel, { passive: false });
        document.addEventListener('pointerlockchange', this._onLock);
        this._look = null;
    }
    dispose() {
        window.removeEventListener('keydown', this._onKey, true);
        window.removeEventListener('keyup', this._onKey, true);
        this.dom.removeEventListener('pointerdown', this._onPointer, true);
        this.dom.removeEventListener('wheel', this._onWheel);
        document.removeEventListener('pointerlockchange', this._onLock);
    }
    setFromView(pitch, yaw) { this.pitch = pitch; this.yaw = yaw; this._apply(); }
    _onLock() { this.locked = document.pointerLockElement === this.dom; }
    toggleLock() {
        if (this.locked) document.exitPointerLock();
        else this.dom.requestPointerLock?.();
        return this.locked;
    }
    _onKey(e) {
        if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey)) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const k = e.key.toLowerCase();
        if (this.keys.has(k) && e.type === 'keydown') return;
        if (e.type === 'keydown') {
            if (!' wasdqec'.includes(k) && k !== 'shift' && k !== 'control') return;
            this.keys.add(k);
            if (' wasdqec'.includes(k)) e.preventDefault();
        } else {
            this.keys.delete(k);
        }
    }
    _onPointer(e) {
        if (!this.enabled) return;
        if (e.button === 2 || (e.button === 1 && !e.shiftKey) || (this.locked && e.button === 0)) {
            this._look = { x: e.clientX, y: e.clientY, id: e.pointerId, pan: e.button === 1 || e.shiftKey };
            this.dom.setPointerCapture?.(e.pointerId);
            this.dom.addEventListener('pointermove', this._onMove = (ev) => {
                const dx = ev.clientX - this._look.x, dy = ev.clientY - this._look.y;
                this._look.x = ev.clientX; this._look.y = ev.clientY;
                if (this._look.pan) this.pan(dx, dy);
                else {
                    this.yaw -= dx * this.turn;
                    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * this.turn));
                    this._apply();
                }
            });
            this.dom.addEventListener('pointerup', this._onUp = () => {
                this._look = null;
                this.dom.removeEventListener('pointermove', this._onMove);
                this.dom.removeEventListener('pointerup', this._onUp);
            });
        }
    }
    _onWheel(e) {
        if (!this.enabled) return;
        e.preventDefault();
        const f = e.deltaY > 0 ? 1 / 1.18 : 1.18;
        this.speed = Math.max(0.6, Math.min(900, this.speed * f));
        this.onSpeed?.(this.speed);
    }
    /** Middle-drag pans on the horizontal plane, scaled by altitude, so a map edit and a 900 m flyover feel the same. */
    pan(dx, dy) {
        const h = (this.size && this.size[1]) || 700;
        const alt = Math.max(8, this.camera.position.y - (this.groundPlane ?? 0));
        const k = (2 * alt * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
        const F = this.forward(), R = this.right();
        this.camera.position.x += (dy * F.x - dx * R.x) * k;
        this.camera.position.z += (dy * F.z - dx * R.z) * k;
    }
    forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
    right() { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }
    update(dt) {
        if (!this.enabled) return this.camera;
        const k = this.keys;
        let fx = 0, fy = 0, fz = 0;
        const F = this.forward(), R = this.right();
        if (k.has('w')) { fx += F.x; fz += F.z; }
        if (k.has('s')) { fx -= F.x; fz -= F.z; }
        if (k.has('d')) { fx += R.x; fz += R.z; }
        if (k.has('a')) { fx -= R.x; fz -= R.z; }
        if (k.has(KEY_DOWN.up) || k.has(' ')) fy += 1;
        if (k.has(KEY_DOWN.down) || k.has('c')) fy -= 1;
        let mult = k.has('shift') ? this.boost : k.has('control') ? this.crawl : 1;
        if (k.has('shift') && k.has('control')) mult = this.boost * 2.4;
        const len = Math.hypot(fx, fz) || 1;
        const target = { x: (fx / len) * this.speed * mult, y: (fy / 1) * this.speed * mult, z: (fz / len) * this.speed * mult };
        const a = 1 - Math.exp(-dt / this.smoothing);
        this.vel.x += (target.x - this.vel.x) * a;
        this.vel.y += (target.y - this.vel.y) * a;
        this.vel.z += (target.z - this.vel.z) * a;
        this.camera.position.x += this.vel.x * dt;
        this.camera.position.y += this.vel.y * dt;
        this.camera.position.z += this.vel.z * dt;
        if (this.camera.position.y < this.minY) this.camera.position.y = this.minY;
        if (this.camera.position.y > this.maxY) this.camera.position.y = this.maxY;
        this._apply();
        return this.camera;
    }
    _apply() {
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }
    /** Frame a bounding box from a pleasant three-quarter height — the "find my city" move. */
    fit(box, pad = 1.3) {
        if (!box) return this;
        const span = Math.max((box.x1 - box.x0) * pad, (box.z1 - box.z0) * pad, 90);
        this.pitch = -0.62;
        this.yaw = 0;
        const fov = (this.camera.fov * Math.PI) / 180;
        const dist = Math.max(span / (2 * Math.tan(fov / 2)), span * 0.32);
        const fx = -Math.sin(this.yaw) * Math.cos(this.pitch), fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
        const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
        this.camera.position.set(cx - fx * dist, Math.max(14, -Math.sin(this.pitch) * dist + 4), cz - fz * dist);
        this.speed = Math.max(22, span / 30);
        this.vel.x = this.vel.y = this.vel.z = 0;
        this._apply();
        return this;
    }
    goTo(x, z, height = 26, pitch = -0.55) {
        this.camera.position.set(x, height, z);
        this.pitch = pitch;
        this._apply();
        this.vel.x = this.vel.y = this.vel.z = 0;
        return this;
    }
    state() { return { speed: this.speed, locked: this.locked, pos: this.camera.position.toArray().map((v) => +v.toFixed(1)) }; }
}

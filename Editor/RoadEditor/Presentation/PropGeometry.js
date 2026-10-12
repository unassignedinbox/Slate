//============================================================================================================================================
// 📦 Editor/RoadEditor/Presentation/PropGeometry.js — Templates for street furniture, authored once and instanced
//============================================================================================================================================
// Every prop is a low-poly template in metres, authored so that its silhouette survives 150 m of view distance: a lamp is a taper, an arm and a
//    head, not a sculpture. Per-vertex mode routes each face through the instanced shader — body, accent, dark, atlas plate, emissive or billboard —
//    which is what lets a bollard, a sign and a subway kiosk share one material and one draw call. Returns plain typed arrays so it stays out of
//    three's way and can be measured without a canvas.
'use strict';

export const MODE = { BODY: 0, ACCENT: 1, DARK: 2, PLATE: 3, GLOW: 4, CHAIN: 5, BILLBOARD: 6 };

class B {
    constructor() { this.p = []; this.n = []; this.u = []; this.m = []; }
    tri(a, b, c, ua, ub, uc, mode, nr) {
        const n = nr || norm(a, b, c);
        this.p.push(...a, ...b, ...c);
        this.n.push(...n, ...n, ...n);
        this.u.push(...ua, ...ub, ...uc);
        this.m.push(mode, mode, mode);
    }
    quad(a, b, c, d, uv, mode, nr, both) {
        const [ua, ub, uc, ud] = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
        this.tri(a, b, c, ua, ub, uc, mode, nr);
        this.tri(a, c, d, ua, uc, ud, mode, nr);
        if (both) this.tri(a, c, b, ua, uc, ub, mode, nr ? nr.map((v) => -v) : null);
        return this;
    }
    /** Axis-aligned box: w × h × d centred on x, z, sitting on y. */
    box(cx, cy, cz, w, h, d, mode, inset = 0) {
        const x0 = cx - w / 2 + inset, x1 = cx + w / 2 - inset, z0 = cz - d / 2 + inset, z1 = cz + d / 2 - inset, y0 = cy, y1 = cy + h;
        const V = (x, y, z) => [x, y, z];
        this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), null, mode);
        this.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), null, mode);
        this.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), null, mode);
        this.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), null, mode);
        this.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), null, mode === MODE.BODY ? MODE.ACCENT : mode);
        return this;
    }
    /** Tapered cylinder around Y. `segs` low on purpose — a pole is a prism at any distance. */
    cyl(cx, cy, cz, r0, r1, h, segs, mode, uvTop = true) {
        for (let k = 0; k < segs; ++k) {
            const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
            const p00 = [cx + Math.cos(a0) * r0, cy, cz + Math.sin(a0) * r0];
            const p01 = [cx + Math.cos(a1) * r0, cy, cz + Math.sin(a1) * r0];
            const p11 = [cx + Math.cos(a1) * r1, cy + h, cz + Math.sin(a1) * r1];
            const p10 = [cx + Math.cos(a0) * r1, cy + h, cz + Math.sin(a0) * r1];
            this.quad(p00, p01, p11, p10, [[0, 0], [1, 0], [1, 1], [0, 1]], mode);
            if (uvTop && r1 > 0.0001) this.quad(p10, p11, [cx, cy + h, cz], [cx, cy + h, cz], null, mode, [0, 1, 0]);
        }
        return this;
    }
    /** Cone stack: the tree canopy, and anything else that is round and seen from far away. */
    /** Flat fan on XZ: covers, grilles and any other detail that lives in the pavement plane. */
    disc(cx, cy, cz, r, segs, mode, inner = 0) {
        for (let k = 0; k < segs; ++k) {
            const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
            const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
            const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
            if (inner > 0) {
                const q0 = [cx + Math.cos(a0) * inner, cy, cz + Math.sin(a0) * inner];
                const q1 = [cx + Math.cos(a1) * inner, cy, cz + Math.sin(a1) * inner];
                this.quad(q0, q1, p1, p0, null, mode, [0, 1, 0]);
            } else this.tri([cx, cy, cz], p0, p1, [0.5, 0.5], [0, 0], [1, 0], mode, [0, 1, 0]);
        }
        return this;
    }
    /** Cone stack: a canopy reads as foliage from any distance and costs 8 triangles a tier. */
    stack(cx, cy, cz, tiers, mode) {
        const segs = 8;
        for (let t = 0; t < tiers.length; ++t) {
            const { y, r, hh } = tiers[t];
            for (let k = 0; k < segs; ++k) {
                const a0 = (k / segs) * Math.PI * 2 + t * 0.4, a1 = ((k + 1) / segs) * Math.PI * 2 + t * 0.4;
                const b0 = [cx + Math.cos(a0) * r, cy + y, cz + Math.sin(a0) * r];
                const b1 = [cx + Math.cos(a1) * r, cy + y, cz + Math.sin(a1) * r];
                const ap = [cx, cy + y + hh, cz];
                this.tri(b0, b1, ap, [0, 0], [1, 0], [0.5, 1], mode);
            }
        }
        return this;
    }
    finish() {
        return {
            position: new Float32Array(this.p), normal: new Float32Array(this.n),
            uv: new Float32Array(this.u), mode: new Float32Array(this.m),
            count: this.p.length / 3,
        };
    }
}
const norm = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
};

/** @returns {Object<string,{position:Float32Array,normal:Float32Array,uv:Float32Array,mode:Float32Array,count:number}>} */
export function propTemplates() {
    const T = {};
    const put = (id, build) => { const b = new B(); build(b); T[id] = b.finish(); };

    put('bollard', (b) => {
        b.cyl(0, 0, 0, 0.095, 0.085, 0.82, 6, MODE.BODY, false);
        b.cyl(0, 0.82, 0, 0.085, 0.05, 0.1, 6, MODE.ACCENT);
        b.box(-0.1, 0.5, -0.1, 0.2, 0.12, 0.2, MODE.ACCENT, 0.02);
    });
    put('manhole', (b) => {
        b.disc(0, 0.008, 0, 0.34, 8, MODE.DARK, 0.26);
    });
    put('drain', (b) => {
        b.box(0, 0.004, 0, 0.62, 0.02, 0.42, MODE.DARK);
        b.disc(0, 0.028, 0, 0.19, 6, MODE.BODY);
    });
    put('bin', (b) => {
        b.cyl(0, 0, 0, 0.26, 0.3, 0.86, 8, MODE.BODY);
        b.cyl(0, 0.86, 0, 0.33, 0.3, 0.09, 8, MODE.ACCENT);
        b.box(0, 0.62, 0.3, 0.3, 0.06, 0.02, MODE.DARK);
    });
    put('bench', (b) => {
        for (let k = 0; k < 3; ++k) b.box(0, 0.44 + k * 0.055, -0.28 + k * 0.28, 1.7, 0.05, 0.24, MODE.BODY);
        for (let k = 0; k < 3; ++k) b.box(0, 0.72 + k * 0.16, -0.36, 1.7, 0.05, 0.05, MODE.BODY);
        b.box(-0.72, 0, -0.1, 0.08, 0.46, 0.5, MODE.DARK);
        b.box(0.72, 0, -0.1, 0.08, 0.46, 0.5, MODE.DARK);
    });
    put('hydrant', (b) => {
        b.cyl(0, 0, 0, 0.17, 0.15, 0.66, 6, MODE.BODY);
        b.cyl(0, 0.66, 0, 0.15, 0.07, 0.14, 6, MODE.ACCENT);
        b.box(-0.22, 0.4, 0, 0.44, 0.1, 0.1, MODE.ACCENT);
    });
    put('meter', (b) => {
        b.cyl(0, 0, 0, 0.04, 0.04, 1.15, 5, MODE.DARK);
        b.box(0, 1.15, 0, 0.2, 0.3, 0.14, MODE.BODY);
        b.box(0, 1.36, 0, 0.16, 0.06, 0.1, MODE.GLOW);
    });
    put('rack', (b) => {
        for (const dx of [-0.34, 0.34]) {
            b.cyl(dx, 0, 0, 0.03, 0.03, 0.85, 5, MODE.BODY, false);
            b.box(dx, 0.85, 0, 0.06, 0.05, 0.5, MODE.BODY);
        }
        b.box(0, 0.02, 0, 0.8, 0.05, 0.06, MODE.DARK);
    });
    put('planter', (b) => {
        b.box(0, 0, 0, 1.5, 0.55, 0.6, MODE.BODY);
        b.box(0, 0.5, 0, 1.34, 0.1, 0.44, MODE.DARK);
        b.stack(0, 0.5, 0, [{ y: 0.05, r: 0.5, hh: 0.35 }, { y: 0.3, r: 0.32, hh: 0.3 }], MODE.ACCENT);
    });
    put('cabinet', (b) => {
        b.box(0, 0, 0, 1.1, 1.25, 0.55, MODE.BODY);
        b.box(0, 1.25, 0, 1.14, 0.07, 0.6, MODE.ACCENT);
        b.box(0, 0.62, 0.28, 0.5, 0.9, 0.02, MODE.DARK);
    });
    put('shelter', (b) => {
        b.box(0, 0, -1.0, 4.6, 2.5, 0.12, MODE.BODY);
        b.box(-2.2, 0, 0.6, 0.12, 2.5, 2.0, MODE.BODY);
        b.box(2.2, 0, 0.6, 0.12, 2.5, 2.0, MODE.BODY);
        b.box(0, 2.5, 0.2, 5.0, 0.14, 3.0, MODE.ACCENT);
        b.box(0, 0.45, -0.7, 3.4, 0.08, 0.4, MODE.DARK);
        b.box(0, 2.35, 1.6, 2.2, 0.7, 0.04, MODE.GLOW);
    });
    put('busFlag', (b) => {
        b.cyl(0, 0, 0, 0.05, 0.05, 2.9, 5, MODE.DARK, false);
        b.box(0, 2.15, 0, 0.62, 0.62, 0.05, MODE.PLATE);
    });
    put('sign', (b) => {
        b.cyl(0, 0, 0, 0.045, 0.04, 2.3, 5, MODE.DARK, false);
        // The plate is double-sided: a sign that vanishes when you approach from the wrong angle is worse than a sign that is slightly cheap.
        b.box(0, 2.3, 0, 0.9, 0.9, 0.045, MODE.PLATE);
    });
    put('flasher', (b) => {
        b.cyl(0, 0, 0, 0.09, 0.08, 3.1, 6, MODE.BODY, false);
        b.box(0, 3.1, 0.0, 1.05, 0.62, 0.14, MODE.BODY);
        for (const dx of [-0.3, 0.3]) b.cyl(dx, 3.32, 0.09, 0.13, 0.13, 0.03, 8, MODE.GLOW);
        b.box(0, 1.1, 0.0, 0.5, 0.16, 0.1, MODE.ACCENT);
    });
    put('crossbuck', (b) => {
        b.cyl(0, 0, 0, 0.07, 0.06, 2.6, 5, MODE.BODY, false);
        b.box(0, 2.45, 0, 1.5, 0.28, 0.06, MODE.PLATE);
    });
    put('gate', (b) => {
        b.box(0, 0, 0, 0.42, 1.15, 0.42, MODE.BODY);
        const len = 3.6;
        b.box(-len / 2 + 0.2, 1.02, 0, len, 0.12, 0.12, MODE.ACCENT);
        for (let k = 0; k < 3; ++k) b.box(-len + 1 + k * 1.2, 1.02, 0.07, 0.4, 0.13, 0.02, MODE.BODY);
    });
    put('beacon', (b) => {
        b.cyl(0, 0, 0, 0.055, 0.05, 1.0, 5, MODE.ACCENT, false);
        b.cyl(0, 1.0, 0, 0.11, 0.11, 0.06, 6, MODE.GLOW);
    });
    put('lamp', (b) => {
        b.cyl(0, 0, 0, 0.17, 0.1, 7.9, 6, MODE.BODY, false);
        b.cyl(0, 7.9, 0, 0.1, 0.09, 0.3, 6, MODE.BODY, false);
        b.box(0, 8.15, -0.9, 0.16, 0.16, 2.0, MODE.BODY);
        b.box(-0.02, 7.98, -1.75, 0.44, 0.2, 0.9, MODE.BODY);
        b.box(-0.02, 7.88, -1.75, 0.36, 0.05, 0.78, MODE.GLOW);
        b.box(0, 0, 0, 0.5, 0.12, 0.5, MODE.DARK);
    });
    put('lampSmall', (b) => {
        b.cyl(0, 0, 0, 0.09, 0.07, 4.5, 6, MODE.BODY, false);
        b.cyl(0, 4.5, 0, 0.16, 0.12, 0.24, 6, MODE.ACCENT);
        b.cyl(0, 4.42, 0, 0.2, 0.2, 0.06, 6, MODE.GLOW);
        b.box(0, 0, 0, 0.34, 0.1, 0.34, MODE.DARK);
    });
    put('mast', (b) => {
        b.cyl(0, 0, 0, 0.26, 0.16, 7.6, 6, MODE.BODY, false);
        b.box(0, 7.35, -1.9, 0.2, 0.2, 4.2, MODE.BODY);
        b.box(0, 7.0, -3.9, 0.14, 0.5, 0.14, MODE.ACCENT);
        b.box(0, 0, 0, 0.8, 0.25, 0.8, MODE.DARK);
    });
    // Deck columns are one unit tall and stretched by the instance's yScale, so a 4 m culvert and a 30 m viaduct share a template.
    put('pier', (b) => {
        b.box(0, 0, 0, 1.9, 1, 1.25, MODE.BODY);
    });
    put('trafficLight', (b) => {
        b.cyl(0, 0, 0, 0.13, 0.11, 4.6, 6, MODE.BODY, false);
        b.box(0, 3.3, -0.2, 0.42, 1.25, 0.3, MODE.DARK);
        for (let k = 0; k < 3; ++k) b.cyl(0, 3.55 + k * 0.36, -0.36, 0.11, 0.11, 0.05, 8, MODE.GLOW);
        b.box(0, 0, 0, 0.6, 0.18, 0.6, MODE.DARK);
    });
    put('tree', (b) => {
        b.cyl(0, 0, 0, 0.19, 0.13, 2.4, 6, MODE.DARK, false);
        b.stack(0, 0, 0, [{ y: 2.2, r: 2.0, hh: 1.9 }, { y: 3.4, r: 1.6, hh: 1.7 }, { y: 4.5, r: 1.1, hh: 1.4 }], MODE.BODY);
    });
    put('fence', (b) => {
        b.box(-1.35, 0, 0, 0.07, 1.8, 0.07, MODE.DARK);
        b.box(1.35, 0, 0, 0.07, 1.8, 0.07, MODE.DARK);
        b.quad([-1.4, 0.15, 0], [1.4, 0.15, 0], [1.4, 1.72, 0], [-1.4, 1.72, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], MODE.CHAIN, null, true);
        b.box(0, 1.76, 0, 2.8, 0.05, 0.06, MODE.DARK);
    });
    put('subwayIn', (b) => {
        b.box(0, 0, 0, 5.2, 0.2, 3.2, MODE.DARK);
        b.box(0, 0.2, -1.5, 5.2, 2.6, 0.16, MODE.BODY);
        for (const dx of [-2.4, 2.4]) { b.box(dx, 0.2, 0.4, 0.18, 2.7, 2.4, MODE.BODY); }
        b.box(0, 2.9, 0.2, 5.8, 0.22, 3.4, MODE.ACCENT);
        b.box(0, 2.68, 0.2, 5.2, 0.06, 2.8, MODE.GLOW);
        for (let k = 0; k < 5; ++k) b.box(0, 0.1 + k * 0.42, 0.9 - k * 0.34, 2.6, 0.06, 0.34, MODE.BODY);
        b.box(0, 1.4, -1.44, 2.4, 0.7, 0.05, MODE.PLATE);
    });
    put('vent', (b) => {
        b.box(0, 0, 0, 3.2, 0.16, 1.5, MODE.DARK);
        for (let k = 0; k < 6; ++k) b.box(-1.3 + k * 0.52, 0.1, 0, 0.16, 0.1, 1.3, MODE.BODY);
    });
    put('lampGlow', (b) => {
        b.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], null, MODE.BILLBOARD, [0, 0, 1], true);
    });
    put('tunnelLight', (b) => {
        b.box(0, 0, 0, 1.6, 0.08, 0.4, MODE.GLOW);
    });
    return T;
}

/** Uniform-scale override per type, so one authored metre-size template can be tuned without touching PropSolver. */


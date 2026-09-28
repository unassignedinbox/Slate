//============================================================================================================================================
//                                                      GEOMETRYSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Skinned triangle-soup builder. Every vertex carries position [m], normal, albedo, 4 joint indices + 4 weights,
//    a feather-local (t along the rachis, v across the vane) coordinate and a surface class used by the shader:
//        0 = feathered skin · 1 = feather vane · 2 = keratin (bill, scales) · 3 = talon · 4 = eye · 5 = bare skin/cere
//    Right-side parts are emitted by negating local X (the skeleton mirrors the same way), which keeps the two halves
//    exact reflections and flips triangle winding automatically.

export const Surface = { Skin: 0, Feather: 1, Keratin: 2, Talon: 3, Eye: 4, Cere: 5 };

export class GeometryStructure
{
    constructor()
    {
        this.position = [];
        this.normal = [];
        this.albedo = [];
        this.joints = [];
        this.weights = [];
        this.featherUv = [];
        this.surface = [];
        this.index = [];
        this.mirror = 1;        // +1 emits as authored, −1 reflects across X
    }

    get vertexCount() { return this.position.length / 3; }

    SetMirror(side) { this.mirror = side; return this; }

    // Adds one vertex, returns its index. `bind` is [[jointIndex, weight], …] (≤ 4, renormalised).
    Vertex(p, n, albedo, bind, uv = [0, 0], surface = Surface.Skin)
    {
        const m = this.mirror;
        this.position.push(p[0] * m, p[1], p[2]);
        this.normal.push(n[0] * m, n[1], n[2]);
        this.albedo.push(albedo[0], albedo[1], albedo[2]);

        const J = [0, 0, 0, 0], W = [0, 0, 0, 0];
        let total = 0;
        for (let i = 0; i < Math.min(4, bind.length); ++i) { J[i] = bind[i][0]; W[i] = Math.max(0, bind[i][1]); total += W[i]; }
        if (total <= 0) { W[0] = 1; total = 1; }
        for (let i = 0; i < 4; ++i) W[i] /= total;
        this.joints.push(J[0], J[1], J[2], J[3]);
        this.weights.push(W[0], W[1], W[2], W[3]);
        this.featherUv.push(uv[0], uv[1]);
        this.surface.push(surface);
        return this.vertexCount - 1;
    }

    Triangle(a, b, c)
    {
        if (this.mirror > 0) this.index.push(a, b, c);
        else this.index.push(a, c, b);
    }

    Quad(a, b, c, d) { this.Triangle(a, b, c); this.Triangle(a, c, d); }

    // Stitches a ladder of equal-length vertex rings into a tube (open = no caps, closed = ring wraps around).
    Stitch(rings, closed = true)
    {
        for (let r = 0; r + 1 < rings.length; ++r)
        {
            const A = rings[r], B = rings[r + 1];
            const n = A.length;
            const limit = closed ? n : n - 1;
            for (let i = 0; i < limit; ++i)
            {
                const j = (i + 1) % n;
                this.Quad(A[i], A[j], B[j], B[i]);
            }
        }
    }

    // Replaces authored normals with area-weighted smooth normals (organic surfaces); call once per part range.
    SmoothNormals(fromVertex)
    {
        const start = fromVertex * 3;
        const accumulate = new Float64Array(this.normal.length - start);
        for (let i = 0; i < this.index.length; i += 3)
        {
            const a = this.index[i], b = this.index[i + 1], c = this.index[i + 2];
            if (a < fromVertex || b < fromVertex || c < fromVertex) continue;
            const P = this.position;
            const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
            const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
            const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const k of [a, b, c])
            {
                const o = k * 3 - start;
                accumulate[o] += nx; accumulate[o + 1] += ny; accumulate[o + 2] += nz;
            }
        }
        for (let o = 0; o < accumulate.length; o += 3)
        {
            const L = Math.hypot(accumulate[o], accumulate[o + 1], accumulate[o + 2]);
            if (L > 1e-12)
            {
                this.normal[start + o] = accumulate[o] / L;
                this.normal[start + o + 1] = accumulate[o + 1] / L;
                this.normal[start + o + 2] = accumulate[o + 2] / L;
            }
        }
    }

    Finish()
    {
        return {
            position: new Float32Array(this.position),
            normal: new Float32Array(this.normal),
            albedo: new Float32Array(this.albedo),
            joints: new Uint16Array(this.joints),
            weights: new Float32Array(this.weights),
            featherUv: new Float32Array(this.featherUv),
            surface: new Float32Array(this.surface),
            index: new Uint32Array(this.index),
            triangleCount: this.index.length / 3,
            vertexCount: this.vertexCount,
        };
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CURVE + FRAME HELPERS
//------------------------------------------------------------------------------------------------------------------------

// Uniform Catmull-Rom through `points` (array of vec3); t ∈ [0,1] over the whole polyline.
export function CatmullRom(points, t)
{
    const n = points.length;
    const u = Math.max(0, Math.min(0.999999, t)) * (n - 1);
    const i = Math.floor(u), f = u - i;
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[Math.min(n - 1, i + 1)], p3 = points[Math.min(n - 1, i + 2)];
    const out = [0, 0, 0];
    for (let k = 0; k < 3; ++k)
    {
        const a = p1[k], b = 0.5 * (p2[k] - p0[k]), c = p0[k] - 2.5 * p1[k] + 2 * p2[k] - 0.5 * p3[k], d = -0.5 * p0[k] + 1.5 * p1[k] - 1.5 * p2[k] + 0.5 * p3[k];
        out[k] = a + b * f + c * f * f + d * f * f * f;
    }
    return out;
}

export function CatmullRomTangent(points, t, epsilon = 1e-3)
{
    const a = CatmullRom(points, Math.max(0, t - epsilon));
    const b = CatmullRom(points, Math.min(1, t + epsilon));
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / L, d[1] / L, d[2] / L];
}

// Superellipse cross-section point: exponent 2 = ellipse, > 2 = boxier (used for the keeled breast).
export function SuperEllipse(angle, halfWidth, halfHeight, exponent = 2.0)
{
    const c = Math.cos(angle), s = Math.sin(angle);
    const p = 2.0 / exponent;
    return [Math.sign(c) * Math.pow(Math.abs(c), p) * halfWidth, Math.sign(s) * Math.pow(Math.abs(s), p) * halfHeight];
}

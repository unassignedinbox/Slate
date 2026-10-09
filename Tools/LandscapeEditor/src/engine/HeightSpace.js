//============================================================================================================================================
//                                                               HEIGHTSPACE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/HeightSpace.js — Dense heightfield storage: cell addressing, bilinear sampling, gradients,
//    Gaussian and box smoothing, distance fields, robust normalization and key ordering.

//------------------------------------------------------------------------------------------------------------------------
//                                                     SCALAR HELPERS
//------------------------------------------------------------------------------------------------------------------------
export function clampNumber(x, lo, hi)
{
    return x < lo ? lo : (x > hi ? hi : x);
}

export function mixNumber(a, b, t)
{
    return a + (b - a) * t;
}

export function smoothStep(edge0, edge1, x)
{
    if (edge1 === edge0)
    {
        return x < edge0 ? 0 : 1;
    }
    const t = clampNumber((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function clampIndex(k, n)
{
    return k < 0 ? 0 : (k >= n ? n - 1 : k);
}

//------------------------------------------------------------------------------------------------------------------------
//                                             FIELD ALLOCATION AND SAMPLING
//------------------------------------------------------------------------------------------------------------------------
export function createField(count, fill = 0)
{
    const field = new Float32Array(count);
    if (fill !== 0)
    {
        field.fill(fill);
    }
    return field;
}

// Samples a row-major n×n field at fractional cell coordinates (x: east index, y: north index).
export function sampleBilinear(field, n, x, y)
{
    const last = n - 1;
    const cx = clampNumber(x, 0, last);
    const cy = clampNumber(y, 0, last);
    const x0 = Math.min(Math.floor(cx), last - 1);
    const y0 = Math.min(Math.floor(cy), last - 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const i = y0 * n + x0;
    const low = field[i] + (field[i + 1] - field[i]) * fx;
    const high = field[i + n] + (field[i + n + 1] - field[i + n]) * fx;
    return low + (high - low) * fy;
}

export function summarizeField(field)
{
    let min = Infinity;
    let max = -Infinity;
    let total = 0;
    for (let k = 0; k < field.length; k++)
    {
        const sample = field[k];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
        total += sample;
    }
    return { min, max, mean: total / Math.max(1, field.length) };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                GRADIENTS AND CURVATURE
//------------------------------------------------------------------------------------------------------------------------
// Central differences in metres per metre; one-sided at the border. Returns {gx, gy} with dz/dx (east) and dz/dy (north).
export function gradientField(field, n, dx)
{
    const gx = createField(n * n);
    const gy = createField(n * n);
    for (let j = 0; j < n; j++)
    {
        const jLo = j > 0 ? j - 1 : j;
        const jHi = j < n - 1 ? j + 1 : j;
        const invY = 1 / ((jHi - jLo) * dx);
        for (let i = 0; i < n; i++)
        {
            const iLo = i > 0 ? i - 1 : i;
            const iHi = i < n - 1 ? i + 1 : i;
            const invX = 1 / ((iHi - iLo) * dx);
            const k = j * n + i;
            gx[k] = (field[j * n + iHi] - field[j * n + iLo]) * invX;
            gy[k] = (field[jHi * n + i] - field[jLo * n + i]) * invY;
        }
    }
    return { gx, gy };
}

// Discrete Laplacian in metres per square metre (positive in hollows, negative on crests).
export function laplacianField(field, n, dx)
{
    const out = createField(n * n);
    const inv = 1 / (dx * dx);
    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            const east = field[j * n + clampIndex(i + 1, n)];
            const west = field[j * n + clampIndex(i - 1, n)];
            const north = field[clampIndex(j + 1, n) * n + i];
            const south = field[clampIndex(j - 1, n) * n + i];
            out[k] = (east + west + north + south - 4 * field[k]) * inv;
        }
    }
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       SMOOTHING
//------------------------------------------------------------------------------------------------------------------------
export function boxBlur(field, n, radius)
{
    const out = createField(n * n);
    if (radius < 1)
    {
        out.set(field);
        return out;
    }
    const scratch = createField(n * n);
    const span = 2 * radius + 1;
    for (let j = 0; j < n; j++)
    {
        const row = j * n;
        let sum = 0;
        for (let k = -radius; k <= radius; k++)
        {
            sum += field[row + clampIndex(k, n)];
        }
        for (let i = 0; i < n; i++)
        {
            scratch[row + i] = sum / span;
            sum += field[row + clampIndex(i + radius + 1, n)] - field[row + clampIndex(i - radius, n)];
        }
    }
    for (let i = 0; i < n; i++)
    {
        let sum = 0;
        for (let k = -radius; k <= radius; k++)
        {
            sum += scratch[clampIndex(k, n) * n + i];
        }
        for (let j = 0; j < n; j++)
        {
            out[j * n + i] = sum / span;
            sum += scratch[clampIndex(j + radius + 1, n) * n + i] - scratch[clampIndex(j - radius, n) * n + i];
        }
    }
    return out;
}

// sigma is in cells. Explicit kernel for small sigma, three-pass box approximation for large sigma.
export function gaussianBlur(field, n, sigma)
{
    if (sigma < 0.5)
    {
        return Float32Array.from(field);
    }
    if (sigma > 6)
    {
        const radius = Math.max(1, Math.round((-1 + Math.sqrt(1 + 4 * sigma * sigma)) / 2));
        let out = boxBlur(field, n, radius);
        out = boxBlur(out, n, radius);
        return boxBlur(out, n, radius);
    }
    const radius = Math.ceil(3 * sigma);
    const kernel = new Float32Array(2 * radius + 1);
    let total = 0;
    for (let k = -radius; k <= radius; k++)
    {
        const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
        kernel[k + radius] = weight;
        total += weight;
    }
    for (let k = 0; k < kernel.length; k++)
    {
        kernel[k] /= total;
    }
    const scratch = createField(n * n);
    const out = createField(n * n);
    for (let j = 0; j < n; j++)
    {
        const row = j * n;
        for (let i = 0; i < n; i++)
        {
            let acc = 0;
            for (let k = -radius; k <= radius; k++)
            {
                acc += field[row + clampIndex(i + k, n)] * kernel[k + radius];
            }
            scratch[row + i] = acc;
        }
    }
    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            let acc = 0;
            for (let k = -radius; k <= radius; k++)
            {
                acc += scratch[clampIndex(j + k, n) * n + i] * kernel[k + radius];
            }
            out[j * n + i] = acc;
        }
    }
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 DISTANCE AND ORDERING
//------------------------------------------------------------------------------------------------------------------------
// Exact Euclidean distance (Felzenszwalb and Huttenlocher, separable 1D lower envelopes) from every seed cell, in metres.
// Seeds are cells where seedMask is non-zero. Isotropic, so iso-lines carry no octagonal artefacts.
export function distanceField(seedMask, n, dx)
{
    const count = n * n;
    const INF = 1e20;
    const squared = new Float64Array(count);
    for (let k = 0; k < count; k++)
    {
        squared[k] = seedMask[k] ? 0 : INF;
    }
    const line = new Float64Array(n);
    const lineOut = new Float64Array(n);
    const hull = new Int32Array(n);
    const bounds = new Float64Array(n + 1);
    for (let i = 0; i < n; i++)
    {
        for (let j = 0; j < n; j++)
        {
            line[j] = squared[j * n + i];
        }
        transformLine1d(line, n, lineOut, hull, bounds);
        for (let j = 0; j < n; j++)
        {
            squared[j * n + i] = lineOut[j];
        }
    }
    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            line[i] = squared[j * n + i];
        }
        transformLine1d(line, n, lineOut, hull, bounds);
        for (let i = 0; i < n; i++)
        {
            squared[j * n + i] = lineOut[i];
        }
    }
    const out = new Float32Array(count);
    for (let k = 0; k < count; k++)
    {
        out[k] = Math.min(Math.sqrt(squared[k]) * dx, 1e7);
    }
    return out;
}

// Lower envelope of parabolas f(p) + (q - p)^2 over one line.
function transformLine1d(samples, length, target, hull, bounds)
{
    let k = 0;
    hull[0] = 0;
    bounds[0] = -Infinity;
    bounds[1] = Infinity;
    for (let q = 1; q < length; q++)
    {
        let p = hull[k];
        let s = (samples[q] + q * q - (samples[p] + p * p)) / (2 * q - 2 * p);
        while (s <= bounds[k])
        {
            k--;
            p = hull[k];
            s = (samples[q] + q * q - (samples[p] + p * p)) / (2 * q - 2 * p);
        }
        k++;
        hull[k] = q;
        bounds[k] = s;
        bounds[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++)
    {
        while (bounds[k + 1] < q)
        {
            k++;
        }
        const p = hull[k];
        target[q] = (q - p) * (q - p) + samples[p];
    }
}

// Histogram-based robust range: returns the values at the given cumulative shares.
export function rangeOfField(field, lowShare, highShare)
{
    const summary = summarizeField(field);
    const min = summary.min;
    const max = summary.max;
    if (!(max > min))
    {
        return { low: min, high: min + 1e-9 };
    }
    const bins = 4096;
    const histogram = new Uint32Array(bins);
    const scale = (bins - 1) / (max - min);
    for (let k = 0; k < field.length; k++)
    {
        histogram[Math.floor((field[k] - min) * scale)] += 1;
    }
    const lowCount = lowShare * field.length;
    const highCount = highShare * field.length;
    let accumulated = 0;
    let low = min;
    let high = max;
    let lowFound = false;
    for (let b = 0; b < bins; b++)
    {
        accumulated += histogram[b];
        if (!lowFound && accumulated >= lowCount)
        {
            low = min + b / scale;
            lowFound = true;
        }
        if (accumulated >= highCount)
        {
            high = min + (b + 1) / scale;
            break;
        }
    }
    if (!(high > low))
    {
        high = low + 1e-9;
    }
    return { low, high };
}

export function normalizeField(field, lowShare = 0.001, highShare = 0.999)
{
    const range = rangeOfField(field, lowShare, highShare);
    const out = createField(field.length);
    const inverse = 1 / (range.high - range.low);
    for (let k = 0; k < field.length; k++)
    {
        out[k] = clampNumber((field[k] - range.low) * inverse, 0, 1);
    }
    return out;
}

// Ascending order of indices by key. Bucketed counting sort: exact to one bucket width, which is adequate for sweeps.
export function orderByKey(keys, bins = 8192)
{
    const count = keys.length;
    const summary = summarizeField(keys);
    const scale = summary.max > summary.min ? (bins - 1) / (summary.max - summary.min) : 0;
    const bucket = new Uint16Array(count);
    const starts = new Uint32Array(bins + 1);
    for (let k = 0; k < count; k++)
    {
        const b = Math.floor((keys[k] - summary.min) * scale);
        bucket[k] = b;
        starts[b + 1] += 1;
    }
    for (let b = 0; b < bins; b++)
    {
        starts[b + 1] += starts[b];
    }
    const order = new Uint32Array(count);
    for (let k = 0; k < count; k++)
    {
        order[starts[bucket[k]]++] = k;
    }
    return order;
}

// Isotropic nine-point diffusion (no grid-aligned streaks): h += c · dx² · ∇²h, with coefficient c per cell (or scalar) and c ≤ 0.35 for stability.
// Border cells are left unchanged.
export function diffuseField(field, n, coefficient)
{
    const out = Float32Array.from(field);
    const scalar = typeof coefficient === 'number';
    for (let j = 1; j < n - 1; j++)
    {
        for (let i = 1; i < n - 1; i++)
        {
            const k = j * n + i;
            const orth = field[k - 1] + field[k + 1] + field[k - n] + field[k + n];
            const diag = field[k - n - 1] + field[k - n + 1] + field[k + n - 1] + field[k + n + 1];
            const laplacian = (4 * orth + diag - 20 * field[k]) / 6;
            const c = scalar ? coefficient : coefficient[k];
            out[k] = field[k] + c * laplacian;
        }
    }
    return out;
}

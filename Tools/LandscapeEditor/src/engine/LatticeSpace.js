//============================================================================================================================================
//                                                              LATTICESPACE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/LatticeSpace.js — Seeded lattice noise: deterministic random streams, integer hashing, Perlin
//    gradient noise and cellular (Worley) distance for procedural fields.

//------------------------------------------------------------------------------------------------------------------------
//                                                  SEEDED RANDOM STREAM
//------------------------------------------------------------------------------------------------------------------------
export function createRandom(seed)
{
    let cursor = seed >>> 0;
    return function nextRandom()
    {
        cursor = (cursor + 0x6d2b79f5) >>> 0;
        let t = cursor;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                           INTEGER HASHING AND LATTICE TABLES
//------------------------------------------------------------------------------------------------------------------------
export function hashCell(ix, iy, seed)
{
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export function createLattice(seed)
{
    const random = createRandom(seed);
    const permutation = new Uint8Array(256);
    for (let i = 0; i < 256; i++)
    {
        permutation[i] = i;
    }
    for (let i = 255; i > 0; i--)
    {
        const j = Math.floor(random() * (i + 1));
        const swap = permutation[i];
        permutation[i] = permutation[j];
        permutation[j] = swap;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++)
    {
        perm[i] = permutation[i & 255];
    }
    const gradients = new Float32Array(32);
    for (let g = 0; g < 16; g++)
    {
        const angle = (g / 16) * Math.PI * 2;
        gradients[2 * g] = Math.cos(angle);
        gradients[2 * g + 1] = Math.sin(angle);
    }
    return { seed: seed | 0, perm, gradients };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     GRADIENT NOISE
//------------------------------------------------------------------------------------------------------------------------
// Perlin gradient noise in approximately [-1, 1]. Coordinates are in feature units (one lattice cell per unit).
export function gradientNoise(lattice, x, y)
{
    const perm = lattice.perm;
    const gradients = lattice.gradients;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xi = x0 & 255;
    const yi = y0 & 255;
    const fx = x - x0;
    const fy = y - y0;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const g00 = perm[perm[xi] + yi] & 15;
    const g10 = perm[perm[xi + 1] + yi] & 15;
    const g01 = perm[perm[xi] + yi + 1] & 15;
    const g11 = perm[perm[xi + 1] + yi + 1] & 15;
    const n00 = gradients[2 * g00] * fx + gradients[2 * g00 + 1] * fy;
    const n10 = gradients[2 * g10] * (fx - 1) + gradients[2 * g10 + 1] * fy;
    const n01 = gradients[2 * g01] * fx + gradients[2 * g01 + 1] * (fy - 1);
    const n11 = gradients[2 * g11] * (fx - 1) + gradients[2 * g11 + 1] * (fy - 1);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.4142;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CELLULAR NOISE
//------------------------------------------------------------------------------------------------------------------------
const cellScratch = { near: 0, second: 0, identity: 0 };

// Distance to the nearest and second-nearest jittered feature point (feature units) and a per-cell identity in [0, 1).
export function cellularSample(lattice, x, y)
{
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let near = 1e9;
    let second = 1e9;
    let identity = 0;
    for (let oy = -1; oy <= 1; oy++)
    {
        for (let ox = -1; ox <= 1; ox++)
        {
            const cx = xi + ox;
            const cy = yi + oy;
            const px = cx + hashCell(cx, cy, lattice.seed);
            const py = cy + hashCell(cx, cy, lattice.seed + 1);
            const dx = px - x;
            const dy = py - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < near)
            {
                second = near;
                near = distance;
                identity = hashCell(cx, cy, lattice.seed + 2);
            }
            else if (distance < second)
            {
                second = distance;
            }
        }
    }
    cellScratch.near = near;
    cellScratch.second = second;
    cellScratch.identity = identity;
    return cellScratch;
}

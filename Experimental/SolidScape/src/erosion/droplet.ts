// SolidScape — CPU Droplet hydraulic erosion on a heightfield (512²)
// Minimal weigert/McDonald kernel adapted for grid coords, bilinear splat, 3x3 erosion brush.

export interface DropletParams
{
    iterations: number;   // outer loops (e.g. 64)
    droplets: number;     // droplets per iteration batch (e.g. 8192)
    inertia: number;      // 0..1  (0.05)
    capacity: number;     // sediment capacity factor (0.04..0.12)
    erosionRate: number;  // 0..1  (0.35)
    depositionRate: number; // 0..1 (0.30)
    evaporation: number;  // 0..0.2 (0.012)
    minSlope: number;     // 0.01
}

const DEFAULT_MIN_SLOPE = 0.01;

function SampleBilinear(h: Float32Array, size: number, fx: number, fz: number): number
{
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = x0 + 1, z1 = z0 + 1;
    if (x0 < 0 || z0 < 0 || x1 >= size || z1 >= size) return 0;
    const tx = fx - x0, tz = fz - z0;
    const h00 = h[z0 * size + x0], h10 = h[z0 * size + x1];
    const h01 = h[z1 * size + x0], h11 = h[z1 * size + x1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
}

function Gradient(h: Float32Array, size: number, fx: number, fz: number): [number, number]
{
    const ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix <= 0 || iz <= 0 || ix >= size - 1 || iz >= size - 1) return [0, 0];
    const dx = (h[iz * size + (ix + 1)] - h[iz * size + (ix - 1)]) * 0.5;
    const dz = (h[(iz + 1) * size + ix] - h[(iz - 1) * size + ix]) * 0.5;
    return [dx, dz];
}

// Distribute deltaHeight across 3x3 with bilinear weights centred at fx,fz
function Splat(h: Float32Array, size: number, fx: number, fz: number, delta: number): void
{
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    // weights for 4 nearest, but we expand to 3x3 approx via depositing to 4 cells only
    // For erosion we use 3x3 brush with falloff: keep it simple 4-cell bilinear
    const cells: [number, number, number][] = [
        [ix,     iz,     (1 - tx) * (1 - tz)],
        [ix + 1, iz,     tx * (1 - tz)],
        [ix,     iz + 1, (1 - tx) * tz],
        [ix + 1, iz + 1, tx * tz],
    ];
    for (const [cx, cz, w] of cells)
    {
        if (cx < 0 || cz < 0 || cx >= size || cz >= size) continue;
        h[cz * size + cx] += delta * w;
    }
}

export function DropletErode(
    heights: Float32Array,
    size: number,
    // cellSize unused for grid-space sim, but kept for future world scaling
    _cellSize: number,
    params: DropletParams,
    rand: () => number = Math.random,
): { flow: Float32Array } // flow accumulation map (erosion amount per cell)
{
    const flow = new Float32Array(size * size); // accumulate |deltaH| per cell for preview
    const minSlope = params.minSlope ?? DEFAULT_MIN_SLOPE;
    const inertia = params.inertia;
    const capacityFactor = params.capacity;
    const erodeRate = params.erosionRate;
    const depositRate = params.depositionRate;
    const evap = params.evaporation;

    const maxSteps = 64; // steps per droplet life

    for (let iter = 0; iter < params.iterations; iter++)
    {
        for (let d = 0; d < params.droplets; d++)
        {
            let fx = 1 + rand() * (size - 2 - 1);
            let fz = 1 + rand() * (size - 2 - 1);

            let velX = 0, velZ = 0;
            let water = 1.0;
            let sediment = 0.0;

            for (let step = 0; step < maxSteps; step++)
            {
                if (fx < 1 || fx >= size - 1 || fz < 1 || fz >= size - 1) break;
                if (water < 0.01) break;

                const hOld = SampleBilinear(heights, size, fx, fz);
                const [gx, gz] = Gradient(heights, size, fx, fz);

                // update velocity (downhill = -gradient)
                velX = velX * inertia - gx * (1 - inertia);
                velZ = velZ * inertia - gz * (1 - inertia);

                // normalize / clamp speed to avoid explosion
                const speed = Math.hypot(velX, velZ);
                if (speed > 4) { const s = 4 / speed; velX *= s; velZ *= s; }
                if (speed < 1e-6 && Math.hypot(gx, gz) < 0.001) break; // flat

                const nfx = fx + velX;
                const nfz = fz + velZ;

                if (nfx < 1 || nfx >= size - 1 || nfz < 1 || nfz >= size - 1) break;

                const hNew = SampleBilinear(heights, size, nfx, nfz);
                const deltaH = hNew - hOld; // negative if downhill

                // sediment capacity: steeper + faster + more water = more capacity
                const cap = Math.max(-deltaH, minSlope) * Math.max(speed, 0.1) * water * capacityFactor;

                if (sediment > cap || deltaH > 0)
                {
                    // uphill or overloaded → deposit
                    const deposit = deltaH > 0
                        ? Math.min(deltaH, sediment) // can't deposit more than sediment, and fill uphill pit
                        : (sediment - cap) * depositRate;
                    const dep = Math.max(0, deposit);
                    if (dep > 1e-6)
                    {
                        Splat(heights, size, fx, fz, dep);
                        // splat also to flow? flow shows deposition as negative erosion but we want accumulation of activity
                        const ix = Math.floor(fx), iz = Math.floor(fz);
                        if (ix >= 0 && iz >= 0 && ix < size && iz < size) flow[iz * size + ix] += dep;
                        sediment -= dep;
                    }
                }
                else
                {
                    // downhill and under capacity → erode
                    let erode = Math.min((cap - sediment) * erodeRate, -deltaH);
                    // extra clamp so we don't dig below neighbour
                    erode = Math.max(0, erode);
                    if (erode > 1e-7)
                    {
                        Splat(heights, size, fx, fz, -erode);
                        const ix = Math.floor(fx), iz = Math.floor(fz);
                        if (ix >= 0 && iz >= 0 && ix < size && iz < size) flow[iz * size + ix] += erode;
                        sediment += erode;
                    }
                }

                water *= (1 - evap);
                fx = nfx; fz = nfz;
            }
        }
    }

    return { flow };
}

export async function DropletErodeAsync(
    heights: Float32Array,
    size: number,
    cellSize: number,
    params: DropletParams,
    yieldEvery = 4,
    onProgress?: (iter: number, total: number) => void,
    rand: () => number = Math.random,
): Promise<{ flow: Float32Array }>
{
    const flow = new Float32Array(size * size);
    const minSlope = params.minSlope ?? DEFAULT_MIN_SLOPE;
    const inertia = params.inertia;
    const capacityFactor = params.capacity;
    const erodeRate = params.erosionRate;
    const depositRate = params.depositionRate;
    const evap = params.evaporation;
    const maxSteps = 64;

    for (let iter = 0; iter < params.iterations; iter++)
    {
        for (let d = 0; d < params.droplets; d++)
        {
            let fx = 1 + rand() * (size - 2 - 1);
            let fz = 1 + rand() * (size - 2 - 1);
            let velX = 0, velZ = 0;
            let water = 1.0;
            let sediment = 0.0;
            for (let step = 0; step < maxSteps; step++)
            {
                if (fx < 1 || fx >= size - 1 || fz < 1 || fz >= size - 1) break;
                if (water < 0.01) break;
                const hOld = SampleBilinear(heights, size, fx, fz);
                const [gx, gz] = Gradient(heights, size, fx, fz);
                velX = velX * inertia - gx * (1 - inertia);
                velZ = velZ * inertia - gz * (1 - inertia);
                const speed = Math.hypot(velX, velZ);
                if (speed > 4) { const s = 4 / speed; velX *= s; velZ *= s; }
                if (speed < 1e-6 && Math.hypot(gx, gz) < 0.001) break;
                const nfx = fx + velX; const nfz = fz + velZ;
                if (nfx < 1 || nfx >= size - 1 || nfz < 1 || nfz >= size - 1) break;
                const hNew = SampleBilinear(heights, size, nfx, nfz);
                const deltaH = hNew - hOld;
                const cap = Math.max(-deltaH, minSlope) * Math.max(speed, 0.1) * water * capacityFactor;
                if (sediment > cap || deltaH > 0)
                {
                    const deposit = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - cap) * depositRate;
                    const dep = Math.max(0, deposit);
                    if (dep > 1e-6) { Splat(heights, size, fx, fz, dep); flow[Math.floor(fz) * size + Math.floor(fx)] += dep; sediment -= dep; }
                }
                else
                {
                    let erode = Math.min((cap - sediment) * erodeRate, -deltaH);
                    erode = Math.max(0, erode);
                    if (erode > 1e-7) { Splat(heights, size, fx, fz, -erode); flow[Math.floor(fz) * size + Math.floor(fx)] += erode; sediment += erode; }
                }
                water *= (1 - evap); fx = nfx; fz = nfz;
            }
        }
        if (onProgress) onProgress(iter + 1, params.iterations);
        if ((iter + 1) % yieldEvery === 0) await new Promise<void>(r => setTimeout(r, 0));
    }
    void cellSize;
    return { flow };
}

//============================================================================================================================================
//                                                           HYDRAULICINTEGRATOR.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/HydraulicIntegrator.js — Particle hydraulic erosion: droplets with inertia, sediment capacity
//    from speed and water, bilinear deposition and brush erosion, after Lague-style droplet models.

import { createField, sampleBilinear, diffuseField } from './HeightSpace.js';
import { createRandom } from './LatticeSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                     EROSION BRUSH
//------------------------------------------------------------------------------------------------------------------------
function buildBrush(radius)
{
    const offsets = [];
    const weights = [];
    let total = 0;
    for (let dy = -radius; dy <= radius; dy++)
    {
        for (let dx = -radius; dx <= radius; dx++)
        {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance >= radius)
            {
                continue;
            }
            const weight = radius - distance;
            offsets.push([dx, dy]);
            weights.push(weight);
            total += weight;
        }
    }
    return {
        count: offsets.length,
        ox: Int32Array.from(offsets.map((entry) => entry[0])),
        oy: Int32Array.from(offsets.map((entry) => entry[1])),
        w: Float32Array.from(weights.map((weight) => weight / total))
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DEPOSITION SPLAT
//------------------------------------------------------------------------------------------------------------------------
function splatDeposit(work, n, ix, iy, fx, fy, amount)
{
    const cell = iy * n + ix;
    work[cell] += (1 - fx) * (1 - fy) * amount;
    work[cell + 1] += fx * (1 - fy) * amount;
    work[cell + n] += (1 - fx) * fy * amount;
    work[cell + n + 1] += fx * fy * amount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  DROPLET INTEGRATION
//------------------------------------------------------------------------------------------------------------------------
// Heights are handled in cell units (metres divided by dx) so slopes are dimensionless. Returns {elevation} in metres.
export function runHydraulic(elevation, n, dx, sea, p, erodibility, seed)
{
    const count = n * n;
    const last = n - 1;
    const work = createField(count);
    for (let k = 0; k < count; k++)
    {
        work[k] = elevation[k] / dx;
    }
    const seaLevel = sea / dx;
    const random = createRandom(seed);
    const brush = buildBrush(Math.max(1, Math.round(p.radius)));
    const droplets = Math.max(1, Math.round(p.density * count));
    const minCapacity = 0.01;
    for (let drop = 0; drop < droplets; drop++)
    {
        let posX = random() * last;
        let posY = random() * last;
        let dirX = 0;
        let dirY = 0;
        let speed = 1;
        let water = 1;
        let sediment = 0;
        for (let step = 0; step < p.lifetime; step++)
        {
            const ix = Math.floor(posX);
            const iy = Math.floor(posY);
            if (ix < 0 || iy < 0 || ix >= last || iy >= last)
            {
                break;
            }
            const fx = posX - ix;
            const fy = posY - iy;
            const cell = iy * n + ix;
            const nw = work[cell];
            const ne = work[cell + 1];
            const sw = work[cell + n];
            const se = work[cell + n + 1];
            const gradX = (ne - nw) * (1 - fy) + (se - sw) * fy;
            const gradY = (sw - nw) * (1 - fx) + (se - ne) * fx;
            const heightHere = nw * (1 - fx) * (1 - fy) + ne * fx * (1 - fy) + sw * (1 - fx) * fy + se * fx * fy;
            dirX = dirX * p.inertia - gradX * (1 - p.inertia);
            dirY = dirY * p.inertia - gradY * (1 - p.inertia);
            const length = Math.sqrt(dirX * dirX + dirY * dirY);
            if (length < 1e-12)
            {
                break;
            }
            dirX /= length;
            dirY /= length;
            const nextX = posX + dirX;
            const nextY = posY + dirY;
            if (nextX < 0 || nextY < 0 || nextX >= last || nextY >= last)
            {
                break;
            }
            const heightNext = sampleBilinear(work, n, nextX, nextY);
            const delta = heightNext - heightHere;
            const capacity = Math.max(-delta * speed * water * p.capacity, minCapacity);
            if (sediment > capacity || delta > 0)
            {
                const amount = delta > 0 ? Math.min(delta, sediment) : (sediment - capacity) * p.depositRate;
                sediment -= amount;
                splatDeposit(work, n, ix, iy, fx, fy, amount);
            }
            else
            {
                const amount = Math.min((capacity - sediment) * p.erodeRate * erodibility[cell], -delta);
                for (let b = 0; b < brush.count; b++)
                {
                    const bx = ix + brush.ox[b];
                    const by = iy + brush.oy[b];
                    if (bx < 0 || by < 0 || bx >= n || by >= n)
                    {
                        continue;
                    }
                    const target = by * n + bx;
                    const take = Math.min(work[target], amount * brush.w[b]);
                    work[target] -= take;
                    sediment += take;
                }
            }
            speed = Math.sqrt(Math.max(0, speed * speed + delta * p.gravity));
            water *= 1 - p.evaporation;
            posX = nextX;
            posY = nextY;
            if (heightNext < seaLevel)
            {
                break;
            }
        }
        if (sediment > 0)
        {
            const ix = Math.min(Math.floor(posX), last - 1);
            const iy = Math.min(Math.floor(posY), last - 1);
            splatDeposit(work, n, ix, iy, posX - ix, posY - iy, sediment);
        }
    }
    const out = createField(count);
    for (let k = 0; k < count; k++)
    {
        out[k] = work[k] * dx;
    }
    // Light isotropic creep removes single-cell deposition speckle while leaving rock steps intact.
    const creep = createField(count);
    for (let k = 0; k < count; k++)
    {
        creep[k] = 0.12 * erodibility[k];
    }
    return { elevation: diffuseField(diffuseField(out, n, creep), n, creep) };
}

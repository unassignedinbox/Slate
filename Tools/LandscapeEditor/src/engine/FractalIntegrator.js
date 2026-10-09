//============================================================================================================================================
//                                                            FRACTALINTEGRATOR.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/FractalIntegrator.js — Octave integration of lattice noise: fBm, ridged multifractal, hybrid
//    multifractal and billow fractals used by terrain generators.

import { gradientNoise } from './LatticeSpace.js';
import { clampNumber } from './HeightSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                      OCTAVE SUMS
//------------------------------------------------------------------------------------------------------------------------
// Fractional Brownian motion, normalized to [-1, 1].
export function fractalBrownian(lattice, x, y, octaves, lacunarity, gain)
{
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let k = 0; k < octaves; k++)
    {
        sum += amplitude * gradientNoise(lattice, x * frequency, y * frequency);
        norm += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
}

// Musgrave ridged multifractal: sharp crests from folded noise, approximately [0, offset²].
export function ridgedMultifractal(lattice, x, y, octaves, lacunarity, gain, offset)
{
    let frequency = 1;
    let amplitude = 1;
    let signal = offset - Math.abs(gradientNoise(lattice, x, y));
    signal *= signal;
    let sum = signal;
    let norm = 1;
    for (let k = 1; k < octaves; k++)
    {
        frequency *= lacunarity;
        amplitude *= gain;
        const weight = clampNumber(signal * 2, 0, 1);
        signal = offset - Math.abs(gradientNoise(lattice, x * frequency, y * frequency));
        signal *= signal;
        signal *= weight;
        sum += signal * amplitude;
        norm += amplitude;
    }
    return sum / norm;
}

// Musgrave hybrid multifractal: rolling plains that gain rugged detail where the surface is already high.
export function hybridMultifractal(lattice, x, y, octaves, lacunarity, exponent, offset)
{
    let frequency = 1;
    let result = (gradientNoise(lattice, x, y) + offset) * Math.pow(frequency, -exponent);
    let weight = result;
    for (let k = 1; k < octaves; k++)
    {
        frequency *= lacunarity;
        weight = clampNumber(weight, 0, 1);
        const signal = (gradientNoise(lattice, x * frequency, y * frequency) + offset) * Math.pow(frequency, -exponent);
        result += weight * signal;
        weight *= signal;
    }
    return result;
}

// Billow fractal: rounded, cushion-like hills from absolute noise, approximately [-1, 1].
export function billowFractal(lattice, x, y, octaves, lacunarity, gain)
{
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let k = 0; k < octaves; k++)
    {
        sum += amplitude * (2 * Math.abs(gradientNoise(lattice, x * frequency, y * frequency)) - 1);
        norm += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      DOMAIN WARP
//------------------------------------------------------------------------------------------------------------------------
// Returns a shared scratch point offset by two fBm fields. Read x and y before the next call.
const warpScratch = { x: 0, y: 0 };

export function warpCoordinate(lattice, x, y, amount)
{
    if (amount <= 0)
    {
        warpScratch.x = x;
        warpScratch.y = y;
        return warpScratch;
    }
    const qx = fractalBrownian(lattice, x + 5.2, y + 1.3, 4, 2.0, 0.5);
    const qy = fractalBrownian(lattice, x + 1.7, y + 9.2, 4, 2.0, 0.5);
    warpScratch.x = x + amount * 0.9 * qx;
    warpScratch.y = y + amount * 0.9 * qy;
    return warpScratch;
}

//==========================================================================================
// Grid plane registry — the flat float storage buffer that carries the 2D (planar) fields:
// hydrology, climate, wind, deposition cover. Shared by WGSL (as const declarations) and JS.
//==========================================================================================

export const GRID_PLANES = {
    elevation: 0,    // [m] top solid surface height of the column
    water: 1,        // [m] standing water depth
    discharge: 2,    // [m3/s] accumulated upstream rainfall (drainage area proxy)
    sediment: 3,     // [m] suspended sediment depth equivalent
    delta: 4,        // [m] vertical surface change queued for the SDF (negative = deposition)
    velocityX: 5,    // [m/s]
    velocityZ: 6,    // [m/s]
    wetness: 7,      // [-] soil moisture 0..1
    snow: 8,         // [m] snowpack water equivalent
    cover: 9,        // [-] alluvium cover (sediment shielding bedrock)
    windSpeed: 10,   // [m/s] local wind magnitude after terrain deflection
    exposure: 11,    // [-] upwind exposure, positive = windward
    hardness: 12,    // [-] surface rock hardness cached from the volume
    rain: 13,        // [m/s] local rainfall intensity (climate mask applied)
    flux: 14,        // [m3] volume of water routed downstream this step
    deposit: 15,     // [m] freshly deposited thickness this step (material colouring)
    filled: 16,      // [m] depression-filled elevation (hydrologically correct surface)
    accumA: 17,      // [m3] flow accumulation ping-pong A
    accumB: 18,      // [m3] flow accumulation ping-pong B
    flowX: 19,       // [-] D8 descent direction x (-1..1)
    flowZ: 20,       // [-] D8 descent direction z (-1..1)
    slope: 21,       // [-] downhill slope along the descent direction
    outflow: 22,     // [m3] water volume routed out of the cell this step
    momentumX: 23,   // [m3*m/s] flux momentum for the flow velocity field
    momentumZ: 24,
    speed: 25,       // [m/s] local flow speed (published for shading and particles)
    windDirX: 26,    // [-] unit wind direction x after terrain deflection
    windDirZ: 27,
    thermal: 28,     // [m] talus relaxation height change queued for the SDF (positive = removed)
};

export const GRID_PLANE_COUNT = Object.keys(GRID_PLANES).length;

export function gridConsts()
{
    const rows = [];
    for (const [name, index] of Object.entries(GRID_PLANES))
    {
        rows.push(`const G_${name.toUpperCase()} : u32 = ${index}u;`);
    }
    rows.push(`const G_PLANES : u32 = ${GRID_PLANE_COUNT}u;`);
    return rows.join('\n');
}

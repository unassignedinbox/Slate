//==========================================================================================
// Fallback graph functions — used when verifying shaders standalone and whenever the graph
// compiler has not yet produced a module. The compiler emits the same four entry points.
//==========================================================================================

export const GRAPH_STUB = /* wgsl */ `
fn graphSdf(p : vec3f) -> f32
{
    // Default: a rounded plateau slab with a hollow interior so the stock scene already
    // demonstrates volume (caves are graph authored, not a heightmap feature).
    let ground = sdPlane(p, vec3f(0.0, 1.0, 0.0), 40.0);
    return ground;
}

fn graphHardness(p : vec3f) -> f32
{
    return 0.35;
}

fn graphStrata(p : vec3f) -> f32
{
    return 0.5 + 0.5 * sin(p.y * 0.045);
}

fn graphRainMask(p : vec3f) -> f32
{
    return 1.0;
}
`;

export const GRAPH_ENTRY_NAMES = ['graphSdf', 'graphHardness', 'graphStrata', 'graphRainMask'];

//==========================================================================================
// Node library. Every node emits WGSL against a shared evaluation point, and every numeric
// parameter is routed through the graph parameter block (gparams), so moving a slider is a
// uniform upload instead of a shader rebuild. Only structural edits recompile.
//
// Socket types:
//   sdf   — signed distance expression (f32, negative inside)
//   point — domain expression (vec3f), consumed by primitives so transforms cost nothing
//   mask  — scalar field in [0, 1] used for hardness, rainfall and blending
//==========================================================================================

const param = (def) => ({ step: 0.01, ...def });

export const NODE_LIBRARY = [
    //--------------------------------------------------------------------------------------
    // Primitives
    //--------------------------------------------------------------------------------------
    {
        id: 'plateau',
        title: 'Plateau',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'width', label: 'Width', value: 1100, min: 50, max: 3000, unit: 'm' }),
            param({ id: 'depth', label: 'Depth', value: 1100, min: 50, max: 3000, unit: 'm' }),
            param({ id: 'thickness', label: 'Thickness', value: 520, min: 20, max: 1500, unit: 'm' }),
            param({ id: 'top', label: 'Top height', value: 300, min: -200, max: 900, unit: 'm' }),
            param({ id: 'round', label: 'Round', value: 60, min: 0, max: 400, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdRoundBox(${c.point()} - vec3f(0.0, ${c.param('top')} - ${c.param('thickness')} * 0.5, 0.0), vec3f(${c.param('width')} * 0.5, ${c.param('thickness')} * 0.5, ${c.param('depth')} * 0.5), ${c.param('round')});`,
    },
    {
        id: 'sphere',
        title: 'Sphere',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Radius', value: 220, min: 5, max: 1200, unit: 'm' }),
            param({ id: 'x', label: 'X', value: 0, min: -1200, max: 1200, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 120, min: -400, max: 900, unit: 'm' }),
            param({ id: 'z', label: 'Z', value: 0, min: -1200, max: 1200, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdSphere(${c.point()} - vec3f(${c.param('x')}, ${c.param('y')}, ${c.param('z')}), ${c.param('radius')});`,
    },
    {
        id: 'box',
        title: 'Box',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'sx', label: 'Size X', value: 320, min: 5, max: 1600, unit: 'm' }),
            param({ id: 'sy', label: 'Size Y', value: 260, min: 5, max: 1200, unit: 'm' }),
            param({ id: 'sz', label: 'Size Z', value: 320, min: 5, max: 1600, unit: 'm' }),
            param({ id: 'round', label: 'Round', value: 24, min: 0, max: 300, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 130, min: -400, max: 900, unit: 'm' }),
            param({ id: 'yaw', label: 'Yaw', value: 0, min: -180, max: 180, unit: '°' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdRoundBox(opRotateY(${c.point()} - vec3f(0.0, ${c.param('y')}, 0.0), ${c.param('yaw')} * 0.0174533), vec3f(${c.param('sx')} * 0.5, ${c.param('sy')} * 0.5, ${c.param('sz')} * 0.5), ${c.param('round')});`,
    },
    {
        id: 'cylinder',
        title: 'Cylinder',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Radius', value: 260, min: 5, max: 1400, unit: 'm' }),
            param({ id: 'height', label: 'Half height', value: 260, min: 5, max: 900, unit: 'm' }),
            param({ id: 'x', label: 'X', value: 0, min: -1200, max: 1200, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 120, min: -400, max: 900, unit: 'm' }),
            param({ id: 'z', label: 'Z', value: 0, min: -1200, max: 1200, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdCylinder(${c.point()} - vec3f(${c.param('x')}, ${c.param('y')}, ${c.param('z')}), ${c.param('radius')}, ${c.param('height')});`,
    },
    {
        id: 'capsule',
        title: 'Capsule',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Radius', value: 150, min: 5, max: 800, unit: 'm' }),
            param({ id: 'height', label: 'Half height', value: 240, min: 0, max: 800, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 150, min: -400, max: 900, unit: 'm' }),
            param({ id: 'tilt', label: 'Tilt', value: 0, min: -90, max: 90, unit: '°' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdVerticalCapsule(opRotateX(${c.point()} - vec3f(0.0, ${c.param('y')}, 0.0), ${c.param('tilt')} * 0.0174533), ${c.param('height')}, ${c.param('radius')});`,
    },
    {
        id: 'torus',
        title: 'Torus',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'ring', label: 'Ring radius', value: 320, min: 10, max: 1400, unit: 'm' }),
            param({ id: 'tube', label: 'Tube radius', value: 90, min: 4, max: 500, unit: 'm' }),
            param({ id: 'x', label: 'X', value: 0, min: -1200, max: 1200, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 120, min: -400, max: 900, unit: 'm' }),
            param({ id: 'z', label: 'Z', value: 0, min: -1200, max: 1200, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdTorus(${c.point()} - vec3f(${c.param('x')}, ${c.param('y')}, ${c.param('z')}), vec2f(${c.param('ring')}, ${c.param('tube')}));`,
    },
    {
        id: 'cone',
        title: 'Cone',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Base radius', value: 320, min: 5, max: 1400, unit: 'm' }),
            param({ id: 'height', label: 'Height', value: 340, min: 5, max: 900, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 0, min: -400, max: 900, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdCone(${c.point()} - vec3f(0.0, ${c.param('height')} + ${c.param('y')}, 0.0), ${c.param('height')}, ${c.param('radius')});`,
    },
    {
        id: 'ellipsoid',
        title: 'Ellipsoid',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'rx', label: 'Radius X', value: 320, min: 5, max: 1400, unit: 'm' }),
            param({ id: 'ry', label: 'Radius Y', value: 200, min: 5, max: 900, unit: 'm' }),
            param({ id: 'rz', label: 'Radius Z', value: 320, min: 5, max: 1400, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 100, min: -400, max: 900, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdEllipsoid(${c.point()} - vec3f(0.0, ${c.param('y')}, 0.0), vec3f(${c.param('rx')}, ${c.param('ry')}, ${c.param('rz')}));`,
    },
    {
        id: 'crystal',
        title: 'Crystal',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'size', label: 'Size', value: 200, min: 5, max: 900, unit: 'm' }),
            param({ id: 'y', label: 'Y', value: 90, min: -400, max: 900, unit: 'm' }),
            param({ id: 'twist', label: 'Twist', value: 0.35, min: -2, max: 2 }),
        ],
        emit: (c) => `let ${c.out('out')} = sdOctahedron(opTwist(${c.point()} - vec3f(0.0, ${c.param('y')}, 0.0), ${c.param('twist')}), ${c.param('size')});`,
    },
    {
        id: 'mountain',
        title: 'Mountain',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Base radius', value: 520, min: 50, max: 1600, unit: 'm' }),
            param({ id: 'height', label: 'Height', value: 340, min: 20, max: 900, unit: 'm' }),
            param({ id: 'yscale', label: 'Vertical scale', value: 1.6, min: 0.2, max: 6 }),
            param({ id: 'roughness', label: 'Roughness', value: 0.42, min: 0, max: 1.4 }),
            param({ id: 'frequency', label: 'Frequency', value: 0.0032, min: 0.0002, max: 0.02 }),
            param({ id: 'x', label: 'X', value: 0, min: -1200, max: 1200, unit: 'm' }),
            param({ id: 'z', label: 'Z', value: 0, min: -1200, max: 1200, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdEllipsoid((${c.point()} - vec3f(${c.param('x')}, ${c.param('height')} * 0.25, ${c.param('z')})) * vec3f(1.0, ${c.param('yscale')}, 1.0), vec3f(${c.param('radius')}, ${c.param('height')}, ${c.param('radius')})) - (ridgedNoise((${c.point()} - vec3f(${c.param('x')}, 0.0, ${c.param('z')})) * ${c.param('frequency')}, 6, 2.03, 0.5, u32(frame.bake.x) + 11u) - 0.34) * ${c.param('height')} * ${c.param('roughness')};`,
    },
    {
        id: 'noiseBlob',
        title: 'Noise Blob',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Radius', value: 260, min: 10, max: 1200, unit: 'm' }),
            param({ id: 'amount', label: 'Displacement', value: 120, min: 0, max: 600, unit: 'm' }),
            param({ id: 'frequency', label: 'Frequency', value: 0.006, min: 0.0005, max: 0.04 }),
            param({ id: 'octaves', label: 'Octaves', value: 5, min: 1, max: 8, step: 1 }),
            param({ id: 'y', label: 'Y', value: 90, min: -400, max: 900, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = sdSphere(${c.point()} - vec3f(0.0, ${c.param('y')}, 0.0), ${c.param('radius')}) - (fbm(${c.point()} * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.02, 0.52, u32(frame.bake.x) + 23u)) * ${c.param('amount')};`,
    },
    {
        id: 'relief',
        title: 'Relief Field',
        group: 'Primitives',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'top', label: 'Base height', value: 210, min: -200, max: 700, unit: 'm' }),
            param({ id: 'amplitude', label: 'Amplitude', value: 170, min: 0, max: 600, unit: 'm' }),
            param({ id: 'frequency', label: 'Frequency', value: 0.0021, min: 0.0001, max: 0.02 }),
            param({ id: 'octaves', label: 'Octaves', value: 7, min: 1, max: 9, step: 1 }),
            param({ id: 'ridge', label: 'Ridge mix', value: 0.55, min: 0, max: 1 }),
            param({ id: 'warp', label: 'Warp', value: 0.45, min: 0, max: 2 }),
        ],
        emit: (c) => {
            const p = c.point();
            return [
                `let rw${c.n} = (fbm(${p} * 0.0009 + vec3f(3.1, 0.0, 7.7), 3, 2.0, 0.5, u32(frame.bake.x) + 91u)) * ${c.param('warp')} * 380.0;`,
                `let ra${c.n} = mix(fbm((${p} + vec3f(rw${c.n}, 0.0, rw${c.n})) * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.05, 0.5, u32(frame.bake.x) + 37u), ridgedNoise((${p} + vec3f(rw${c.n}, 0.0, rw${c.n})) * ${c.param('frequency')}, i32(${c.param('octaves')} - 1), 2.07, 0.5, u32(frame.bake.x) + 41u) * 2.0 - 1.0, ${c.param('ridge')});`,
                // A vertical slab whose boundary follows the generated height field: this is a
                // volume, so caves and overhangs can still be carved out of it later.
                `let ${c.out('out')} = max(${p}.y - (${c.param('top')} + ra${c.n} * ${c.param('amplitude')}), -(${p}.y - frame.worldLo.y));`,
            ].join('\n    ');
        },
    },
    {
        id: 'caveSheets',
        title: 'Cave Sheets',
        group: 'Caves',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'thickness', label: 'Thickness', value: 26, min: 2, max: 160, unit: 'm' }),
            param({ id: 'frequency', label: 'Frequency', value: 0.0068, min: 0.0005, max: 0.05 }),
            param({ id: 'octaves', label: 'Octaves', value: 4, min: 1, max: 7, step: 1 }),
            param({ id: 'tilt', label: 'Tilt', value: 0.22, min: 0, max: 2 }),
            param({ id: 'seed', label: 'Seed', value: 5, min: 0, max: 64, step: 1 }),
        ],
        emit: (c) => `let ${c.out('out')} = abs(fbm(${c.point()} * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.04, 0.5, u32(frame.bake.x) + u32(${c.param('seed')}) * 17u) + ${c.point()}.y * ${c.param('tilt')} * 0.001) * 900.0 - ${c.param('thickness')};`,
    },
    {
        id: 'tunnelNetwork',
        title: 'Tunnel Network',
        group: 'Caves',
        sockets: { in: [{ id: 'point', type: 'point', label: 'XY' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'radius', label: 'Bore radius', value: 34, min: 3, max: 200, unit: 'm' }),
            param({ id: 'frequency', label: 'Cell size', value: 0.0042, min: 0.0005, max: 0.03 }),
            param({ id: 'wander', label: 'Wander', value: 0.42, min: 0, max: 1.5 }),
        ],
        emit: (c) => {
            const p = c.point();
            return [
                `let tw${c.n} = ${p} + vec3f(fbm(${p} * 0.0016, 3, 2.0, 0.5, u32(frame.bake.x) + 61u)) * ${c.param('wander')} * 320.0;`,
                // F2 - F1 of a Worley field is the set of cell boundaries: a connected tunnel net.
                `let tc${c.n} = worleyF2(tw${c.n} * ${c.param('frequency')}, u32(frame.bake.x) + 7u);`,
                `let ${c.out('out')} = (tc${c.n}.y - tc${c.n}.x) * 1200.0 - ${c.param('radius')};`,
            ].join('\n    ');
        },
    },

    //--------------------------------------------------------------------------------------
    // Combines
    //--------------------------------------------------------------------------------------
    {
        id: 'union',
        title: 'Union',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'A' }, { id: 'b', type: 'sdf', label: 'B' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [],
        emit: (c) => `let ${c.out('out')} = opUnion(${c.in('a')}, ${c.in('b')});`,
    },
    {
        id: 'smoothUnion',
        title: 'Smooth Union',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'A' }, { id: 'b', type: 'sdf', label: 'B' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [param({ id: 'k', label: 'Blend', value: 60, min: 1, max: 400, unit: 'm' })],
        emit: (c) => `let ${c.out('out')} = opSmoothUnion(${c.in('a')}, ${c.in('b')}, ${c.param('k')});`,
    },
    {
        id: 'subtract',
        title: 'Subtract',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'Base' }, { id: 'b', type: 'sdf', label: 'Cut' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [],
        emit: (c) => `let ${c.out('out')} = opSubtract(${c.in('a')}, ${c.in('b')});`,
    },
    {
        id: 'smoothSubtract',
        title: 'Smooth Subtract',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'Base' }, { id: 'b', type: 'sdf', label: 'Cut' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [param({ id: 'k', label: 'Blend', value: 45, min: 1, max: 400, unit: 'm' })],
        emit: (c) => `let ${c.out('out')} = opSmoothSubtract(${c.in('a')}, ${c.in('b')}, ${c.param('k')});`,
    },
    {
        id: 'intersect',
        title: 'Intersect',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'A' }, { id: 'b', type: 'sdf', label: 'B' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [],
        emit: (c) => `let ${c.out('out')} = opIntersect(${c.in('a')}, ${c.in('b')});`,
    },
    {
        id: 'shell',
        title: 'Hollow Shell',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'A' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [param({ id: 'thickness', label: 'Wall', value: 40, min: 2, max: 300, unit: 'm' })],
        emit: (c) => `let ${c.out('out')} = opShell(${c.in('a')}, ${c.param('thickness')});`,
    },
    {
        id: 'offset',
        title: 'Offset / Dilate',
        group: 'Combine',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'A' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [param({ id: 'amount', label: 'Amount', value: -30, min: -300, max: 300, unit: 'm' })],
        emit: (c) => `let ${c.out('out')} = ${c.in('a')} - ${c.param('amount')};`,
    },

    //--------------------------------------------------------------------------------------
    // Domain + deformation
    //--------------------------------------------------------------------------------------
    {
        id: 'transform',
        title: 'Transform',
        group: 'Domain',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'point' }] },
        params: [
            param({ id: 'x', label: 'Move X', value: 0, min: -1200, max: 1200, unit: 'm' }),
            param({ id: 'y', label: 'Move Y', value: 0, min: -600, max: 900, unit: 'm' }),
            param({ id: 'z', label: 'Move Z', value: 0, min: -1200, max: 1200, unit: 'm' }),
            param({ id: 'yaw', label: 'Yaw', value: 0, min: -180, max: 180, unit: '°' }),
            param({ id: 'pitch', label: 'Pitch', value: 0, min: -90, max: 90, unit: '°' }),
            param({ id: 'roll', label: 'Roll', value: 0, min: -180, max: 180, unit: '°' }),
        ],
        emit: (c) => [
            `let t${c.n}a = opRotateZ(opRotateX(opRotateY(${c.point()} - vec3f(${c.param('x')}, ${c.param('y')}, ${c.param('z')}), ${c.param('yaw')} * 0.0174533), ${c.param('pitch')} * 0.0174533), ${c.param('roll')} * 0.0174533);`,
            `let ${c.out('out')} = t${c.n}a;`,
        ].join('\n    '),
    },
    {
        id: 'repeat',
        title: 'Repeat',
        group: 'Domain',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'point' }] },
        params: [
            param({ id: 'period', label: 'Spacing', value: 420, min: 20, max: 1600, unit: 'm' }),
            param({ id: 'count', label: 'Count', value: 1, min: 0, max: 4, step: 1 }),
            param({ id: 'jitter', label: 'Jitter', value: 0.12, min: 0, max: 1 }),
        ],
        emit: (c) => [
            `let r${c.n}j = vec3f(fbm(${c.point()} * 0.013, 2, 2.0, 0.5, u32(frame.bake.x) + 5u));`,
            `let ${c.out('out')} = opRepeat(${c.point()} + r${c.n}j * ${c.param('period')} * ${c.param('jitter')}, vec3f(${c.param('period')}, 900.0, ${c.param('period')}), vec3f(${c.param('count')}, 0.0, ${c.param('count')}));`,
        ].join('\n    '),
    },
    {
        id: 'warp',
        title: 'Domain Warp',
        group: 'Domain',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'point' }] },
        params: [
            param({ id: 'amount', label: 'Amount', value: 120, min: 0, max: 600, unit: 'm' }),
            param({ id: 'frequency', label: 'Frequency', value: 0.0026, min: 0.0002, max: 0.02 }),
            param({ id: 'octaves', label: 'Octaves', value: 3, min: 1, max: 6, step: 1 }),
            param({ id: 'swirl', label: 'Swirl', value: 0.4, min: 0, max: 2 }),
        ],
        emit: (c) => [
            `let w${c.n}v = vec3f(
        fbm(${c.point()} * ${c.param('frequency')} + vec3f(1.7, 9.2, 4.3), i32(${c.param('octaves')}), 2.0, 0.5, u32(frame.bake.x) + 13u),
        fbm(${c.point()} * ${c.param('frequency')} + vec3f(8.3, 2.8, 1.1), i32(${c.param('octaves')}), 2.0, 0.5, u32(frame.bake.x) + 29u),
        fbm(${c.point()} * ${c.param('frequency')} + vec3f(3.9, 6.4, 7.2), i32(${c.param('octaves')}), 2.0, 0.5, u32(frame.bake.x) + 53u));`,
            `let ${c.out('out')} = ${c.point()} + w${c.n}v * ${c.param('amount')} + vec3f(${c.point()}.z, 0.0, -${c.point()}.x) * ${c.param('swirl')} * 0.0006 * ${c.param('amount')};`,
        ].join('\n    '),
    },
    {
        id: 'twist',
        title: 'Twist',
        group: 'Domain',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'point' }] },
        params: [
            param({ id: 'amount', label: 'Twist', value: 0.22, min: -1.5, max: 1.5 }),
            param({ id: 'scale', label: 'Vertical scale', value: 220, min: 10, max: 900, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = opRotateY(${c.point()}, ${c.param('amount')} * ${c.point()}.y / ${c.param('scale')});`,
    },
    {
        id: 'terrace',
        title: 'Terracing',
        group: 'Deformation',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'SDF' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'steps', label: 'Step height', value: 34, min: 2, max: 200, unit: 'm' }),
            param({ id: 'strength', label: 'Strength', value: 0.55, min: 0, max: 1.2 }),
            param({ id: 'tilt', label: 'Tilt', value: 0.12, min: -0.6, max: 0.6 }),
        ],
        emit: (c) => [
            `let g${c.n} = ${c.in('a')};`,
            `let q${c.n} = fract((${c.point()}.y + ${c.point()}.x * ${c.param('tilt')}) / ${c.param('steps')});`,
            `let ${c.out('out')} = g${c.n} + (abs(q${c.n} - 0.5) - 0.25) * ${c.param('steps')} * ${c.param('strength')};`,
        ].join('\n    '),
    },
    {
        id: 'strataBands',
        title: 'Strata Bands',
        group: 'Deformation',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'SDF' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'height', label: 'Bed height', value: 60, min: 4, max: 400, unit: 'm' }),
            param({ id: 'strength', label: 'Strength', value: 22, min: 0, max: 200, unit: 'm' }),
            param({ id: 'dip', label: 'Dip', value: 0.15, min: -1, max: 1 }),
            param({ id: 'bend', label: 'Bend', value: 0.6, min: 0, max: 3 }),
        ],
        emit: (c) => [
            `let b${c.n}n = fbm(${c.point()} * 0.0016, 3, 2.0, 0.5, u32(frame.bake.x) + 77u) * ${c.param('bend')} * 200.0;`,
            `let b${c.n} = sin((${c.point()}.y + b${c.n}n + ${c.point()}.x * ${c.param('dip')}) * 6.2831853 / ${c.param('height')});`,
            `let ${c.out('out')} = ${c.in('a')} + b${c.n} * ${c.param('strength')} * 0.5;`,
        ].join('\n    '),
    },
    {
        id: 'displace',
        title: 'Noise Displace',
        group: 'Deformation',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'SDF' }], out: [{ id: 'out', type: 'sdf' }] },
        params: [
            param({ id: 'amount', label: 'Amount', value: 45, min: -300, max: 300, unit: 'm' }),
            param({ id: 'frequency', label: 'Frequency', value: 0.008, min: 0.0002, max: 0.05 }),
            param({ id: 'octaves', label: 'Octaves', value: 4, min: 1, max: 7, step: 1 }),
            param({ id: 'ridged', label: 'Ridged', value: 0, min: 0, max: 1 }),
        ],
        emit: (c) => [
            `let d${c.n} = mix(fbm(${c.point()} * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.03, 0.5, u32(frame.bake.x) + 101u), ridgedNoise(${c.point()} * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.03, 0.5, u32(frame.bake.x) + 103u) * 2.0 - 1.0, ${c.param('ridged')});`,
            `let ${c.out('out')} = ${c.in('a')} - d${c.n} * ${c.param('amount')};`,
        ].join('\n    '),
    },

    //--------------------------------------------------------------------------------------
    // Masks
    //--------------------------------------------------------------------------------------
    {
        id: 'maskConstant',
        title: 'Constant Mask',
        group: 'Masks',
        sockets: { in: [], out: [{ id: 'out', type: 'mask' }] },
        params: [param({ id: 'value', label: 'Value', value: 0.4, min: 0, max: 1 })],
        emit: (c) => `let ${c.out('out')} = ${c.param('value')};`,
    },
    {
        id: 'maskNoise',
        title: 'Noise Mask',
        group: 'Masks',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'mask' }] },
        params: [
            param({ id: 'frequency', label: 'Frequency', value: 0.004, min: 0.0001, max: 0.05 }),
            param({ id: 'octaves', label: 'Octaves', value: 4, min: 1, max: 8, step: 1 }),
            param({ id: 'offset', label: 'Bias', value: 0.5, min: -1, max: 1 }),
            param({ id: 'contrast', label: 'Contrast', value: 1.4, min: 0.1, max: 6 }),
            param({ id: 'ridged', label: 'Ridged', value: 0, min: 0, max: 1 }),
        ],
        emit: (c) => [
            `let m${c.n} = mix(fbm(${c.point()} * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.03, 0.5, u32(frame.bake.x) + 131u) * 0.5 + 0.5, ridgedNoise(${c.point()} * ${c.param('frequency')}, i32(${c.param('octaves')}), 2.03, 0.5, u32(frame.bake.x) + 137u), ${c.param('ridged')});`,
            `let ${c.out('out')} = clamp((m${c.n} + ${c.param('offset')} - 0.5) * ${c.param('contrast')} + 0.5, 0.0, 1.0);`,
        ].join('\n    '),
    },
    {
        id: 'maskHeight',
        title: 'Height Mask',
        group: 'Masks',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'mask' }] },
        params: [
            param({ id: 'low', label: 'Low [m]', value: 120, min: -200, max: 900, unit: 'm' }),
            param({ id: 'high', label: 'High [m]', value: 420, min: -200, max: 900, unit: 'm' }),
            param({ id: 'invert', label: 'Invert', value: 0, min: 0, max: 1, step: 1 }),
        ],
        emit: (c) => `let ${c.out('out')} = mix(smoothstep(${c.param('low')}, max(${c.param('high')}, ${c.param('low')} + 1.0), ${c.point()}.y), smoothstep(${c.param('high')}, ${c.param('low')}, ${c.point()}.y), ${c.param('invert')});`,
    },
    {
        id: 'maskSlope',
        title: 'Slope Mask',
        group: 'Masks',
        sockets: { in: [{ id: 'a', type: 'sdf', label: 'SDF' }], out: [{ id: 'out', type: 'mask' }] },
        params: [
            param({ id: 'low', label: 'Flat', value: 0.25, min: 0, max: 1 }),
            param({ id: 'high', label: 'Steep', value: 0.75, min: 0, max: 1 }),
            param({ id: 'invert', label: 'Invert', value: 0, min: 0, max: 1, step: 1 }),
        ],
        // Forward differences: four evaluations of the input field are enough to recover the
        // surface normal, and one of them is the point already being shaded.
        emit: (c) => [
            `let s${c.n}h = max(voxelSize() * 0.5, 1.0);`,
            `let s${c.n}0 = ${c.in('a')};`,
            `let s${c.n}g = vec3f(
        ${c.sampleAt('a', `${c.point()} + vec3f(s${c.n}h, 0.0, 0.0)`)} - s${c.n}0,
        ${c.sampleAt('a', `${c.point()} + vec3f(0.0, s${c.n}h, 0.0)`)} - s${c.n}0,
        ${c.sampleAt('a', `${c.point()} + vec3f(0.0, 0.0, s${c.n}h)`)} - s${c.n}0);`,
            `let s${c.n}n = normalize(s${c.n}g + vec3f(1e-6, 0.0, 1e-6));`,
            `let s${c.n}s = clamp(1.0 - abs(s${c.n}n.y), 0.0, 1.0);`,
            `let ${c.out('out')} = mix(smoothstep(${c.param('low')}, max(${c.param('high')}, ${c.param('low')} + 0.01), s${c.n}s), 1.0 - smoothstep(${c.param('low')}, ${c.param('high')}, s${c.n}s), ${c.param('invert')});`,
        ].join('\n    '),
    },
    {
        id: 'maskRadial',
        title: 'Radial Mask',
        group: 'Masks',
        sockets: { in: [{ id: 'point', type: 'point', label: 'P' }], out: [{ id: 'out', type: 'mask' }] },
        params: [
            param({ id: 'radius', label: 'Radius', value: 420, min: 10, max: 2000, unit: 'm' }),
            param({ id: 'feather', label: 'Feather', value: 180, min: 1, max: 900, unit: 'm' }),
            param({ id: 'x', label: 'X', value: 0, min: -1500, max: 1500, unit: 'm' }),
            param({ id: 'z', label: 'Z', value: 0, min: -1500, max: 1500, unit: 'm' }),
        ],
        emit: (c) => `let ${c.out('out')} = 1.0 - smoothstep(${c.param('radius')}, ${c.param('radius')} + ${c.param('feather')}, length(${c.point()}.xz - vec2f(${c.param('x')}, ${c.param('z')})));`,
    },
    {
        id: 'maskCombine',
        title: 'Combine Masks',
        group: 'Masks',
        sockets: { in: [{ id: 'a', type: 'mask', label: 'A' }, { id: 'b', type: 'mask', label: 'B' }], out: [{ id: 'out', type: 'mask' }] },
        params: [
            param({ id: 'operation', label: 'Operation', value: 0, min: 0, max: 4, step: 1, enum: ['Multiply', 'Add', 'Max', 'Min', 'Difference'] }),
            param({ id: 'mix', label: 'Mix', value: 1, min: 0, max: 1 }),
        ],
        emit: (c) => [
            `let c${c.n}op = ${c.param('operation')};`,
            `var c${c.n}v = ${c.in('a')} * ${c.in('b')};`,
            `if (c${c.n}op > 0.5 && c${c.n}op < 1.5) { c${c.n}v = clamp(${c.in('a')} + ${c.in('b')}, 0.0, 1.0); }`,
            `else if (c${c.n}op >= 1.5 && c${c.n}op < 2.5) { c${c.n}v = max(${c.in('a')}, ${c.in('b')}); }`,
            `else if (c${c.n}op >= 2.5 && c${c.n}op < 3.5) { c${c.n}v = min(${c.in('a')}, ${c.in('b')}); }`,
            `else if (c${c.n}op >= 3.5) { c${c.n}v = abs(${c.in('a')} - ${c.in('b')}); }`,
            `let ${c.out('out')} = mix(0.0, c${c.n}v, ${c.param('mix')});`,
        ].join('\n    '),
    },

    //--------------------------------------------------------------------------------------
    // Outputs
    //--------------------------------------------------------------------------------------
    {
        id: 'hardnessField',
        title: 'Hardness Field',
        group: 'Outputs',
        sockets: { in: [{ id: 'mask', type: 'mask', label: 'Mask' }], out: [{ id: 'out', type: 'hardness' }] },
        params: [
            param({ id: 'scale', label: 'Scale', value: 1.0, min: 0, max: 1 }),
            param({ id: 'bias', label: 'Bias', value: 0.18, min: 0, max: 1 }),
        ],
        emit: (c) => `let ${c.out('out')} = clamp(${c.param('bias')} + ${c.in('mask')} * ${c.param('scale')}, 0.0, 1.0);`,
    },
    {
        id: 'rainField',
        title: 'Rainfall Field',
        group: 'Outputs',
        sockets: { in: [{ id: 'mask', type: 'mask', label: 'Mask' }], out: [{ id: 'out', type: 'rain' }] },
        params: [
            param({ id: 'scale', label: 'Scale', value: 1.0, min: 0, max: 2 }),
            param({ id: 'bias', label: 'Bias', value: 0.25, min: 0, max: 2 }),
        ],
        emit: (c) => `let ${c.out('out')} = clamp(${c.param('bias')} + ${c.in('mask')} * ${c.param('scale')}, 0.0, 2.0);`,
    },
    {
        id: 'strataField',
        title: 'Strata Field',
        group: 'Outputs',
        sockets: { in: [{ id: 'mask', type: 'mask', label: 'Mask' }], out: [{ id: 'out', type: 'strata' }] },
        params: [
            param({ id: 'mix', label: 'Mix', value: 0.6, min: 0, max: 1 }),
        ],
        emit: (c) => `let ${c.out('out')} = clamp(0.5 + 0.5 * sin(${c.point()}.y * 0.045 + ${c.in('mask')} * 6.0), 0.0, 1.0) * ${c.param('mix')} + ${c.in('mask')} * (1.0 - ${c.param('mix')});`,
    },
    {
        id: 'terrainOutput',
        title: 'Terrain Output',
        group: 'Outputs',
        sockets: {
            in: [
                { id: 'sdf', type: 'sdf', label: 'SDF' },
                { id: 'hardness', type: 'hardness', label: 'Hardness' },
                { id: 'rain', type: 'rain', label: 'Rain' },
                { id: 'strata', type: 'strata', label: 'Strata' },
            ],
            out: [],
        },
        params: [],
        emit: () => '',
    },
];

export const NODE_BY_ID = new Map(NODE_LIBRARY.map((node) => [node.id, node]));

export const SOCKET_COLORS = {
    sdf: '#e8e8e8',
    point: '#6c77ff',
    mask: '#22c55e',
    hardness: '#f59e0b',
    rain: '#38bdf8',
    strata: '#a855f7',
};

export function defaultParams(nodeId)
{
    const def = NODE_BY_ID.get(nodeId);
    if (!def)
    {
        return {};
    }
    const values = {};
    for (const p of def.params)
    {
        values[p.id] = p.value;
    }
    return values;
}

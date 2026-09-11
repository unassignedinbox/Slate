//==========================================================================================
// Graph compiler — turns the node document into the four WGSL entry points the solver and the
// shader both call:
//
//   fn graphSdf(p)       -> f32   the terrain field (caves, overhangs and all)
//   fn graphHardness(p)  -> f32   bedrock resistance, every erosion law scales by it
//   fn graphStrata(p)    -> f32   bedding pattern, drives band wear and material colour
//   fn graphRainMask(p)  -> f32   orographic rainfall mask consumed by the climate pass
//
// Every node output becomes a WGSL *function* rather than a local binding. That is what makes
// slope masks, domain warps and displacement nodes legal: they evaluate their input at a
// different point, which an SSA binding cannot express. Because each output is emitted exactly
// once, a fan-out of ten consumers still compiles to a single function.
//
// Numeric parameters are not baked into the source. They become slots in a uniform block, so
// dragging a slider uploads sixteen bytes instead of rebuilding pipelines.
//==========================================================================================

import { NODE_BY_ID } from './nodes.js';

export const MAX_GRAPH_PARAMS = 256;
export const MAX_GRAPH_STATEMENTS = 4000;

const DEFAULT_INPUT = {
    sdf: '1e6',
    mask: '0.5',
    hardness: '0.36',
    rain: '1.0',
    strata: '0.5',
    point: 'p',
};

const RETURN_TYPE = {
    point: 'vec3f',
    sdf: 'f32',
    mask: 'f32',
    hardness: 'f32',
    rain: 'f32',
    strata: 'f32',
};

export function compileGraph(doc)
{
    const errors = [];
    const warnings = [];
    const params = [];
    const paramIndex = new Map();

    const nodes = new Map();
    for (const node of doc.nodes || [])
    {
        nodes.set(node.id, node);
    }

    const output = (doc.nodes || []).find((node) => node.type === 'terrainOutput');
    if (!output)
    {
        errors.push('No Terrain Output node in the graph.');
        return { wgsl: '', params, errors, warnings, signature: '' };
    }

    // Edge lookup: target node + socket  ->  source node + socket.
    const incoming = new Map();
    for (const edge of doc.edges || [])
    {
        incoming.set(`${edge.to}::${edge.toSocket}`, { from: edge.from, fromSocket: edge.fromSocket });
    }

    let counter = 0;
    let statementCount = 0;
    const declarations = [];
    const emitted = new Map();

    const paramRef = (node, paramId) =>
    {
        const key = `${node.id}:${paramId}`;
        let index = paramIndex.get(key);
        if (index === undefined)
        {
            if (params.length >= MAX_GRAPH_PARAMS)
            {
                errors.push(`Graph exceeds ${MAX_GRAPH_PARAMS} parameters; remove or share nodes.`);
                return '0.0';
            }
            index = params.length;
            paramIndex.set(key, index);
            const def = NODE_BY_ID.get(node.type)?.params.find((p) => p.id === paramId);
            params.push({
                key,
                node: node.id,
                param: paramId,
                slot: Math.floor(index / 4),
                component: index % 4,
                value: node.params?.[paramId] ?? def?.value ?? 0,
            });
        }
        return `gparams[${Math.floor(index / 4)}].${'xyzw'[index % 4]}`;
    };

    // Recursively ensure the function that produces (nodeId, socketId) exists, and return the
    // expression that calls it at `pointExpr`.
    const reference = (nodeId, socketId, pointExpr, stack) =>
    {
        const node = nodes.get(nodeId);
        if (!node)
        {
            errors.push(`Wire points at a missing node (${nodeId}).`);
            return DEFAULT_INPUT.sdf;
        }
        const def = NODE_BY_ID.get(node.type);
        if (!def)
        {
            errors.push(`Unknown node type "${node.type}".`);
            return DEFAULT_INPUT.sdf;
        }
        const socket = (def.sockets.out ?? []).find((s) => s.id === socketId);
        if (!socket)
        {
            errors.push(`${def.title} has no output "${socketId}".`);
            return DEFAULT_INPUT.sdf;
        }

        const key = `${nodeId}::${socketId}`;
        let entry = emitted.get(key);
        if (!entry)
        {
            if (stack.includes(nodeId))
            {
                errors.push(`Feedback loop through ${def.title}.`);
                return DEFAULT_INPUT.sdf;
            }
            entry = { name: `n${counter}`, socket, node, def };
            counter += 1;
            emitted.set(key, entry);

            const body = [];
            const localPoint = 'p';
            const local = {
                n: entry.name,
                point: () => localPoint,
                param: (id) => paramRef(node, id),
                out: () => `v${entry.name.slice(1)}_${socketId}`,
                nextName: () => `t${counter}_${body.length}`,
                in: (id) => inputRef(nodeId, id, localPoint, stack.concat(nodeId)),
                inAt: (id, atPoint) => inputRef(nodeId, id, atPoint, stack.concat(nodeId)),
            };
            local.sampleAt = local.inAt;

            const result = def.emit(local);
            const statements = (Array.isArray(result) ? result : [result])
                .filter((line) => typeof line === 'string' && line.trim().length > 0)
                .flatMap((line) => String(line).split('\n').map((row) => row.trimEnd()));
            for (const line of statements)
            {
                body.push(line);
                statementCount += 1;
            }

            const declared = extractDeclaration(statements[statements.length - 1], socket.type);
            const returnType = RETURN_TYPE[socket.type] ?? 'f32';
            declarations.push(`fn ${entry.name}(${localPoint} : vec3f) -> ${returnType}
{
    ${body.join('\n    ')}
    return ${declared};
}`);
            entry.call = (at) => `${entry.name}(${at})`;
            entry.value = declared;
        }
        return entry.call(pointExpr);
    };

    // Resolve an input socket to a call expression (or its default when nothing is wired).
    const inputRef = (nodeId, socketId, pointExpr, stack) =>
    {
        const node = nodes.get(nodeId);
        const def = NODE_BY_ID.get(node.type);
        const socket = def?.sockets.in?.find((s) => s.id === socketId);
        const found = incoming.get(`${nodeId}::${socketId}`);
        if (!found)
        {
            warnings.push(`${def?.title ?? nodeId}: input "${socket?.label ?? socketId}" is not connected.`);
            return DEFAULT_INPUT[socket?.type ?? 'sdf'];
        }
        return reference(found.from, found.fromSocket, pointExpr, stack);
    };

    const rootFor = (socketId) =>
    {
        const wire = incoming.get(`${output.id}::${socketId}`);
        if (!wire)
        {
            return null;
        }
        return reference(wire.from, wire.fromSocket, 'p', [output.id]);
    };

    const sdfRoot = rootFor('sdf');
    if (!sdfRoot)
    {
        errors.push('Terrain Output has no SDF connected.');
    }
    const hardnessRoot = rootFor('hardness');
    const rainRoot = rootFor('rain');
    const strataRoot = rootFor('strata');

    if (statementCount > MAX_GRAPH_STATEMENTS)
    {
        warnings.push(`Graph expands to ${statementCount} statements (soft limit ${MAX_GRAPH_STATEMENTS}). Masks and warps evaluate their input more than once; shorten the chain feeding them.`);
    }

    const entry = (name, call, fallback) => `fn ${name}(p : vec3f) -> f32
{
    return ${call ?? fallback};
}`;

    const wgsl = `${declarations.join('\n\n')}

${entry('graphSdf', sdfRoot, '1e6')}

${entry('graphHardness', hardnessRoot, '0.36')}

${entry('graphRainMask', rainRoot, '1.0')}

${entry('graphStrata', strataRoot, '0.5 + 0.5 * sin(p.y * 0.045)')}
`;

    const signature = JSON.stringify({
        nodes: (doc.nodes || []).map((n) => [n.id, n.type]),
        edges: (doc.edges || []).map((e) => [e.from, e.fromSocket, e.to, e.toSocket]),
        params: params.length,
    });

    return { wgsl, params, errors, warnings, signature, statements: statementCount };
}

// Node emitters declare their result with `let <name> = ...`; recover the name so the wrapper
// can return it. Single-expression emitters are wrapped into a declaration here.
function extractDeclaration(lastStatement, socketType)
{
    if (!lastStatement)
    {
        return socketType === 'point' ? 'p' : '0.0';
    }
    const match = String(lastStatement).match(/let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match)
    {
        return match[1];
    }
    return String(lastStatement).trim().replace(/;$/, '');
}

// Write the numeric parameter table into a Float32Array that is uploaded as the graph uniform.
export function packGraphParams(target, baseOffsetFloats, compiled, values)
{
    for (const entry of compiled.params)
    {
        const nodeValues = values?.[entry.node];
        const value = nodeValues && nodeValues[entry.param] !== undefined ? nodeValues[entry.param] : entry.value;
        target[baseOffsetFloats + entry.slot * 4 + entry.component] = Number(value) || 0;
    }
}

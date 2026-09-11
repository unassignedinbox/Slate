//==========================================================================================
// Graph document model — nodes, connections, undo history, serialization and starter presets.
// The document is plain JSON so a terrain recipe can be saved, diffed and reviewed like any
// other asset in the project.
//==========================================================================================

import { NODE_BY_ID, defaultParams } from './nodes.js';

let idCounter = 1;

export function newNodeId()
{
    idCounter += 1;
    return `n${idCounter}`;
}

export function resetIdCounter(value)
{
    idCounter = value;
}

export function createNode(type, x, y, params)
{
    const def = NODE_BY_ID.get(type);
    if (!def)
    {
        throw new Error(`unknown node type ${type}`);
    }
    const node = {
        id: newNodeId(),
        type,
        x: Math.round(x),
        y: Math.round(y),
        params: { ...defaultParams(type), ...(params || {}) },
    };
    return node;
}

export function createDocument()
{
    return { version: 1, nodes: [], edges: [] };
}

export function cloneDocument(doc)
{
    return JSON.parse(JSON.stringify(doc));
}

export function findNode(doc, id)
{
    return doc.nodes.find((node) => node.id === id) || null;
}

// Single incoming connection per input socket: connecting replaces any existing wire.
export function connect(doc, from, fromSocket, to, toSocket)
{
    doc.edges = doc.edges.filter((edge) => !(edge.to === to && edge.toSocket === toSocket));
    doc.edges.push({ from, fromSocket, to, toSocket });
}

export function disconnect(doc, to, toSocket)
{
    doc.edges = doc.edges.filter((edge) => !(edge.to === to && edge.toSocket === toSocket));
}

export function removeNode(doc, id)
{
    doc.nodes = doc.nodes.filter((node) => node.id !== id);
    doc.edges = doc.edges.filter((edge) => edge.from !== id && edge.to !== id);
}

export function wouldCycle(doc, from, to)
{
    // Walking upstream from `from`: reaching `to` means the new wire closes a loop.
    const stack = [from];
    const seen = new Set();
    while (stack.length)
    {
        const current = stack.pop();
        if (current === to)
        {
            return true;
        }
        if (seen.has(current))
        {
            continue;
        }
        seen.add(current);
        for (const edge of doc.edges)
        {
            if (edge.to === current)
            {
                stack.push(edge.from);
            }
        }
    }
    return false;
}

export class History
{
    constructor(doc, limit = 64)
    {
        this.stack = [JSON.stringify(doc)];
        this.index = 0;
        this.limit = limit;
    }

    push(doc)
    {
        const snapshot = JSON.stringify(doc);
        if (snapshot === this.stack[this.index])
        {
            return;
        }
        this.stack = this.stack.slice(0, this.index + 1);
        this.stack.push(snapshot);
        if (this.stack.length > this.limit)
        {
            this.stack.shift();
        }
        this.index = this.stack.length - 1;
    }

    undo()
    {
        if (this.index <= 0)
        {
            return null;
        }
        this.index -= 1;
        return JSON.parse(this.stack[this.index]);
    }

    redo()
    {
        if (this.index >= this.stack.length - 1)
        {
            return null;
        }
        this.index += 1;
        return JSON.parse(this.stack[this.index]);
    }

    get canUndo()
    {
        return this.index > 0;
    }

    get canRedo()
    {
        return this.index < this.stack.length - 1;
    }
}

//------------------------------------------------------------------------------------------
// Starter graphs
//------------------------------------------------------------------------------------------
function buildCanyon()
{
    const doc = createDocument();
    const relief = createNode('relief', -880, -60, {
        top: 205, amplitude: 165, frequency: 0.0021, octaves: 7, ridge: 0.55, warp: 0.45,
    });
    const mountain = createNode('mountain', -880, 260, {
        radius: 470, height: 330, yscale: 1.5, roughness: 0.45, frequency: 0.0032, x: -240, z: 180,
    });
    const join = createNode('smoothUnion', -520, 60, { k: 120 });
    const sheets = createNode('caveSheets', -520, 320, { thickness: 24, frequency: 0.0068, octaves: 4, tilt: 0.22, seed: 5 });
    const cutSheets = createNode('smoothSubtract', -180, 40, { k: 26 });
    const tunnels = createNode('tunnelNetwork', -520, 560, { radius: 32, frequency: 0.0042, wander: 0.42 });
    const cutTunnels = createNode('smoothSubtract', 140, 40, { k: 22 });
    const bands = createNode('strataBands', 460, 40, { height: 58, strength: 16, dip: 0.15, bend: 0.6 });
    const detail = createNode('displace', 760, 40, { amount: 22, frequency: 0.0085, octaves: 4, ridged: 0.25 });
    const output = createNode('terrainOutput', 1080, 40);

    // Hardness: steep faces are bare rock, flat ground is soft alluvium, plus noise variation.
    const slope = createNode('maskSlope', 460, 360, { low: 0.28, high: 0.8, invert: 1 });
    const noiseMask = createNode('maskNoise', -880, 560, { frequency: 0.0031, octaves: 4, offset: 0.5, contrast: 1.5, ridged: 0 });
    const hardnessMix = createNode('maskCombine', 760, 380, { operation: 0, mix: 0.85 });
    const hardness = createNode('hardnessField', 1080, 360, { scale: 0.82, bias: 0.16 });

    // Rainfall: orographic lift, thin on the peaks, generous in the lowlands.
    const heightMask = createNode('maskHeight', 460, 600, { low: 620, high: 120, invert: 1 });
    const rainNoise = createNode('maskNoise', -180, 700, { frequency: 0.0019, octaves: 3, offset: 0.45, contrast: 1.3, ridged: 0 });
    const rainMix = createNode('maskCombine', 760, 620, { operation: 0, mix: 0.9 });
    const rain = createNode('rainField', 1080, 620, { scale: 1.15, bias: 0.32 });

    const strataNoise = createNode('maskNoise', -180, 900, { frequency: 0.0026, octaves: 3, offset: 0.5, contrast: 1.8, ridged: 1 });
    const strata = createNode('strataField', 1080, 880, { mix: 0.55 });

    doc.nodes.push(relief, mountain, join, sheets, cutSheets, tunnels, cutTunnels, bands, detail, output,
        slope, noiseMask, hardnessMix, hardness, heightMask, rainNoise, rainMix, rain, strataNoise, strata);

    doc.edges.push(
        { from: relief.id, fromSocket: 'out', to: join.id, toSocket: 'a' },
        { from: mountain.id, fromSocket: 'out', to: join.id, toSocket: 'b' },
        { from: join.id, fromSocket: 'out', to: cutSheets.id, toSocket: 'a' },
        { from: sheets.id, fromSocket: 'out', to: cutSheets.id, toSocket: 'b' },
        { from: cutSheets.id, fromSocket: 'out', to: cutTunnels.id, toSocket: 'a' },
        { from: tunnels.id, fromSocket: 'out', to: cutTunnels.id, toSocket: 'b' },
        { from: cutTunnels.id, fromSocket: 'out', to: bands.id, toSocket: 'a' },
        { from: bands.id, fromSocket: 'out', to: detail.id, toSocket: 'a' },
        { from: detail.id, fromSocket: 'out', to: output.id, toSocket: 'sdf' },
        { from: detail.id, fromSocket: 'out', to: slope.id, toSocket: 'a' },
        { from: slope.id, fromSocket: 'out', to: hardnessMix.id, toSocket: 'a' },
        { from: noiseMask.id, fromSocket: 'out', to: hardnessMix.id, toSocket: 'b' },
        { from: hardnessMix.id, fromSocket: 'out', to: hardness.id, toSocket: 'mask' },
        { from: hardness.id, fromSocket: 'out', to: output.id, toSocket: 'hardness' },
        { from: heightMask.id, fromSocket: 'out', to: rainMix.id, toSocket: 'a' },
        { from: rainNoise.id, fromSocket: 'out', to: rainMix.id, toSocket: 'b' },
        { from: rainMix.id, fromSocket: 'out', to: rain.id, toSocket: 'mask' },
        { from: rain.id, fromSocket: 'out', to: output.id, toSocket: 'rain' },
        { from: strataNoise.id, fromSocket: 'out', to: strata.id, toSocket: 'mask' },
        { from: strata.id, fromSocket: 'out', to: output.id, toSocket: 'strata' },
    );
    return doc;
}

function buildAlpineKarst()
{
    const doc = buildCanyon();
    const set = (type, patch) =>
    {
        for (const node of doc.nodes)
        {
            if (node.type === type)
            {
                node.params = { ...node.params, ...patch };
            }
        }
    };
    set('relief', { top: 300, amplitude: 240, ridge: 0.75, frequency: 0.0016 });
    set('mountain', { radius: 520, height: 470, roughness: 0.6, frequency: 0.0024 });
    set('caveSheets', { thickness: 30, frequency: 0.0055 });
    set('tunnelNetwork', { radius: 44, frequency: 0.0034 });
    set('strataBands', { height: 70, strength: 20, dip: 0.4 });
    set('displace', { amount: 30, ridged: 0.6 });
    return doc;
}

function buildBadlands()
{
    const doc = buildCanyon();
    const terrace = createNode('terrace', 620, 40, { steps: 22, strength: 0.62, tilt: 0.08 });
    const detail = doc.nodes.find((node) => node.type === 'displace');
    const bands = doc.nodes.find((node) => node.type === 'strataBands');
    const output = doc.nodes.find((node) => node.type === 'terrainOutput');
    doc.nodes.push(terrace);
    doc.edges = doc.edges.filter((edge) => !(edge.to === detail.id && edge.toSocket === 'a'));
    doc.edges.push({ from: bands.id, fromSocket: 'out', to: terrace.id, toSocket: 'a' });
    doc.edges.push({ from: terrace.id, fromSocket: 'out', to: detail.id, toSocket: 'a' });
    doc.edges = doc.edges.filter((edge) => !(edge.to === output.id && edge.toSocket === 'sdf'));
    doc.edges.push({ from: detail.id, fromSocket: 'out', to: output.id, toSocket: 'sdf' });
    for (const node of doc.nodes)
    {
        if (node.type === 'relief')
        {
            node.params = { ...node.params, top: 240, amplitude: 130, ridge: 0.35, octaves: 6 };
        }
        if (node.type === 'strataBands')
        {
            node.params = { ...node.params, height: 26, strength: 10, dip: 0.05, bend: 0.35 };
        }
        if (node.type === 'displace')
        {
            node.params = { ...node.params, amount: 14, frequency: 0.012, ridged: 0.55 };
        }
    }
    return doc;
}

export const PRESETS = [
    {
        id: 'canyon',
        title: 'Red Rock Canyon',
        note: 'Layered sandstone plateau, cave sheets and tunnel networks — good for river carving.',
        build: buildCanyon,
        settings: { biome: 1, vegetation: 0.12, rain: 2.6e-6, wind: { speed: 11.0, direction: 0.65, abrasion: 0.00032, deposition: 0.85 } },
    },
    {
        id: 'karst',
        title: 'Alpine Karst',
        note: 'High relief limestone with heavy cave networks; snowmelt feeds the drainage.',
        build: buildAlpineKarst,
        settings: { biome: 0, vegetation: 0.45, rain: 3.4e-6, climate: { snowline: 430 }, thermal: { repose: 38, rate: 0.8, creep: 0.0009 } },
    },
    {
        id: 'badlands',
        title: 'Terraced Badlands',
        note: 'Rapidly incised terraces with soft bedrock — wind and rain hammer the slopes.',
        build: buildBadlands,
        settings: { biome: 2, vegetation: 0.05, rain: 4.2e-6, erodibility: 0.0042, wind: { speed: 17, abrasion: 0.0007 } },
    },
];

export function presetDocument(id)
{
    const preset = PRESETS.find((entry) => entry.id === id) || PRESETS[0];
    return preset.build();
}

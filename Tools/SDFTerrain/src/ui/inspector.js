//==========================================================================================
// Inspector — the right-hand parameter surface.
//
// One place where every physical quantity of the solver is exposed with its unit: rainfall in
// metres per second, erodibility in the stream-power sense, repose as an angle in degrees,
// settling as a velocity. Nothing is normalised away, because a landscape artist tunes these
// numbers against real terrain.
//==========================================================================================

import { group, sliderRow, toggleRow, selectRow, statRow, noteRow, vectorRow, buttonRow, sectionTitle } from './controls.js';
import { formatNumber } from './shell.js';
import { NODE_BY_ID } from '../kernel/graph/nodes.js';

export class Inspector
{
    constructor(host, options)
    {
        this.host = host;
        this.settings = options.settings;
        this.engine = options.engine;
        this.tab = 'node';
        this.selectedNode = options.selectedNode || null;
        this.doc = options.doc;
        this.onSettings = options.onSettings || (() => {});
        this.onNodeChange = options.onNodeChange || (() => {});
        this.onRebake = options.onRebake || (() => {});
        this.onQuality = options.onQuality || (() => {});
        this.stats = {};
    }

    setTab(tab)
    {
        this.tab = tab;
        this.render();
    }

    setDocument(doc)
    {
        this.doc = doc;
        this.render();
    }

    setSelection(nodeId)
    {
        this.selectedNode = nodeId;
        if (this.tab !== 'node')
        {
            this.tab = 'node';
        }
        this.render();
    }

    setStats(stats)
    {
        this.stats = stats;
    }

    //------------------------------------------------------------------ builders
    render()
    {
        const host = this.host;
        host.innerHTML = '';
        const title = document.getElementById('inspectorTitle');
        const hint = document.getElementById('inspectorHint');

        if (this.tab === 'node')
        {
            const node = this.doc?.nodes?.find((entry) => entry.id === this.selectedNode) ?? null;
            title.textContent = node ? NODE_BY_ID.get(node.type)?.title ?? node.type : 'Inspector';
            hint.textContent = node ? NODE_BY_ID.get(node.type)?.group ?? '' : 'nothing selected';
            if (node)
            {
                this.buildNode(host, node);
            }
            else
            {
                const body = group(host, 'Selection');
                noteRow(body, 'Select a node in the graph to edit its parameters, or open another tab for solver settings.', 'warn');
            }
        }
        else if (this.tab === 'sim')
        {
            title.textContent = 'Erosion';
            hint.textContent = 'solver state';
            this.buildSimulation(host);
        }
        else if (this.tab === 'water')
        {
            title.textContent = 'Water';
            hint.textContent = 'rivers and shading';
            this.buildWater(host);
        }
        else
        {
            title.textContent = 'Look';
            hint.textContent = 'light, sky, output';
            this.buildLook(host);
        }
    }

    buildNode(host, node)
    {
        const def = NODE_BY_ID.get(node.type);

        if (def.description)
        {
            const info = group(host, 'About', false);
            noteRow(info, def.description, 'warn');
        }

        const body = group(host, 'Parameters');
        for (const param of def.params ?? [])
        {
            if (param.min === undefined || param.min === param.max)
            {
                statRow(body, param.label, formatNumber(node.params[param.id]), param.unit ?? '');
                continue;
            }
            const step = param.step ?? (param.max - param.min) / 320;
            sliderRow(body, {
                label: param.label,
                unit: param.unit,
                min: param.min,
                max: param.max,
                step,
                settings: { path: `node:${node.id}:${param.id}`, value: node.params[param.id] },
                path: `node:${node.id}:${param.id}`,
                onChange: (value) => {
                    node.params[param.id] = value;
                    this.onNodeChange(node, param.id, value);
                },
            });
        }
        if (!(def.params ?? []).length)
        {
            noteRow(body, 'This node has no parameters.', 'warn');
        }

        const actions = group(host, 'Structure');
        buttonRow(actions, [
            { label: 'Duplicate', onClick: () => this.onNodeChange(node, '__duplicate', null) },
            { label: 'Remove', onClick: () => this.onNodeChange(node, '__remove', null) },
        ]);
        buttonRow(actions, [
            { label: 'Rebake terrain', onClick: () => this.onRebake() },
        ]);
    }

    buildSimulation(host)
    {
        const settings = this.settings;

        const hydrology = group(host, 'Rain and rivers');
        sliderRow(hydrology, {
            label: 'Model time step', unit: 's', min: 1, max: 240, step: 1,
            settings, path: 'dt',
            onChange: () => this.onSettings(),
        });
        sliderRow(hydrology, {
            label: 'Rainfall', unit: 'mm/h', min: 0, max: 200, step: 0.5,
            settings: { path: 'rainMm', value: settings.rainMm }, path: 'rainMm',
            onChange: () => this.onSettings(),
        });
        sliderRow(hydrology, {
            label: 'Evaporation', unit: '×', min: 0, max: 3, step: 0.02,
            settings, path: 'evapScale',
            onChange: () => this.onSettings(),
        });
        sliderRow(hydrology, {
            label: 'Fill iterations', unit: '', min: 2, max: 24, step: 1,
            settings, path: 'fillIterations',
            onChange: () => this.onSettings(),
        });
        sliderRow(hydrology, {
            label: 'Accumulation passes', unit: '', min: 4, max: 48, step: 1,
            settings, path: 'accumulateIterations',
            onChange: () => this.onSettings(),
        });
        sliderRow(hydrology, {
            label: 'Drainage exponent m', unit: '', min: 0.2, max: 1.4, step: 0.01,
            settings, path: 'areaExponent',
            onChange: () => this.onSettings(),
        });
        sliderRow(hydrology, {
            label: 'Slope exponent n', unit: '', min: 0.4, max: 2.4, step: 0.01,
            settings, path: 'slopeExponent',
            onChange: () => this.onSettings(),
        });

        const bedrock = group(host, 'Bedrock and transport');
        sliderRow(bedrock, {
            label: 'Erodibility K', unit: '', min: 0.0001, max: 0.02, step: 0.00005,
            settings, path: 'erodibility',
            onChange: () => this.onSettings(),
        });
        sliderRow(bedrock, {
            label: 'Sediment settling', unit: '', min: 0.002, max: 0.6, step: 0.002,
            settings, path: 'settling',
            onChange: () => this.onSettings(),
        });
        sliderRow(bedrock, {
            label: 'Transport capacity', unit: '', min: 0.002, max: 0.4, step: 0.002,
            settings, path: 'capacity',
            onChange: () => this.onSettings(),
        });
        sliderRow(bedrock, {
            label: 'Flow conductance', unit: '', min: 0.05, max: 1, step: 0.01,
            settings, path: 'conductance',
            onChange: () => this.onSettings(),
        });
        sliderRow(bedrock, {
            label: 'Max surface step', unit: 'vox', min: 0.06, max: 0.9, step: 0.01,
            settings, path: 'maxStepVoxels',
            onChange: () => this.onSettings(),
        });
        sliderRow(bedrock, {
            label: 'Re-distance every', unit: 'steps', min: 1, max: 24, step: 1,
            settings, path: 'refineEvery',
            onChange: () => this.onSettings(),
        });

        const thermal = group(host, 'Thermal weathering');
        toggleRow(thermal, { label: 'Enabled', settings: this.settings.thermal, path: 'enabled', onChange: () => this.onSettings() });
        sliderRow(thermal, {
            label: 'Angle of repose', unit: '°', min: 22, max: 70, step: 0.5,
            settings: this.settings.thermal, path: 'repose',
            onChange: () => this.onSettings(),
        });
        sliderRow(thermal, {
            label: 'Slump rate', unit: '', min: 0, max: 3, step: 0.01,
            settings: this.settings.thermal, path: 'rate',
            onChange: () => this.onSettings(),
        });
        sliderRow(thermal, {
            label: 'Soil creep', unit: '', min: 0, max: 0.004, step: 0.00002,
            settings: this.settings.thermal, path: 'creep',
            onChange: () => this.onSettings(),
        });

        const wind = group(host, 'Wind');
        toggleRow(wind, { label: 'Enabled', settings: this.settings.wind, path: 'enabled', onChange: () => this.onSettings() });
        sliderRow(wind, {
            label: 'Speed', unit: 'm/s', min: 0, max: 45, step: 0.2,
            settings: this.settings.wind, path: 'speed',
            onChange: () => this.onSettings(),
        });
        sliderRow(wind, {
            label: 'Direction', unit: '°', min: 0, max: 360, step: 1,
            settings: { path: 'windDeg', value: settings.windDeg }, path: 'windDeg',
            onChange: () => this.onSettings(),
        });
        sliderRow(wind, {
            label: 'Abrasion', unit: '', min: 0, max: 0.004, step: 0.00002,
            settings: this.settings.wind, path: 'abrasion',
            onChange: () => this.onSettings(),
        });
        sliderRow(wind, {
            label: 'Loess deposition', unit: '', min: 0, max: 1.5, step: 0.01,
            settings: this.settings.wind, path: 'deposition',
            onChange: () => this.onSettings(),
        });

        const particles = group(host, 'Parcels');
        toggleRow(particles, { label: 'Simulate parcels', settings: this.settings.particles, path: 'enabled', onChange: () => this.onSettings() });
        sliderRow(particles, {
            label: 'Spawn rate', unit: '×', min: 0, max: 4, step: 0.02,
            settings: this.settings.particles, path: 'rate',
            onChange: () => this.onSettings(),
        });
        sliderRow(particles, {
            label: 'Rain share', unit: '', min: 0, max: 1, step: 0.01,
            settings: { path: 'share0', value: settings.particles.share[0] }, path: 'share0',
            onChange: () => this.onSettings(),
        });
        sliderRow(particles, {
            label: 'River share', unit: '', min: 0, max: 1, step: 0.01,
            settings: { path: 'share1', value: settings.particles.share[1] }, path: 'share1',
            onChange: () => this.onSettings(),
        });
        sliderRow(particles, {
            label: 'Wind share', unit: '', min: 0, max: 1, step: 0.01,
            settings: { path: 'share2', value: settings.particles.share[2] }, path: 'share2',
            onChange: () => this.onSettings(),
        });
        sliderRow(particles, {
            label: 'Marker size', unit: '×', min: 0.6, max: 6, step: 0.05,
            settings: this.settings.particles, path: 'displayScale',
            onChange: () => this.onSettings(),
        });
        noteRow(particles, 'Parcels are drawn at a legible size but carry physical volumes; the mass audit in the outliner is what proves nothing is being invented.', 'warn');

        if (this.stats.voxel)
        {
            const grid = group(host, 'Resolution', true);
            statRow(grid, 'Volume', `${this.stats.voxel[0]}×${this.stats.voxel[1]}×${this.stats.voxel[2]}`);
            statRow(grid, 'Voxel size', `${formatNumber(this.stats.voxelSize, 2)} m`);
            statRow(grid, 'Hydrology grid', `${this.stats.hyd}²`);
            statRow(grid, 'March steps', String(this.stats.marchSteps));
        }
    }

    buildWater(host)
    {
        const water = this.settings.water;
        const body = group(host, 'Surface');
        sliderRow(body, { label: 'Wave amplitude', unit: 'm', min: 0, max: 3, step: 0.01, settings: water, path: 'waveAmplitude', onChange: () => this.onSettings() });
        sliderRow(body, { label: 'Refraction', unit: '', min: 0, max: 1, step: 0.01, settings: water, path: 'refraction', onChange: () => this.onSettings() });
        sliderRow(body, { label: 'Foam', unit: '', min: 0, max: 1.6, step: 0.01, settings: water, path: 'foam', onChange: () => this.onSettings() });
        sliderRow(body, { label: 'Flow streaks', unit: '', min: 0, max: 1.6, step: 0.01, settings: water, path: 'streaks', onChange: () => this.onSettings() });
        sliderRow(body, { label: 'Specular', unit: '', min: 0, max: 2, step: 0.01, settings: water, path: 'specular', onChange: () => this.onSettings() });
        sliderRow(body, { label: 'Absorption', unit: '1/m', min: 0, max: 0.6, step: 0.002, settings: water, path: 'absorption', onChange: () => this.onSettings() });

        const colour = group(host, 'Colour');
        vectorRow(colour, { label: 'Shallow tint', path: 'shallowTint', components: 3, step: 0.02, settings: water, onChange: () => this.onSettings() });
        vectorRow(colour, { label: 'Deep tint', path: 'deepTint', components: 3, step: 0.02, settings: water, onChange: () => this.onSettings() });
        sliderRow(colour, { label: 'Turbidity', unit: '', min: 0, max: 1, step: 0.01, settings: water, path: 'turbidity', onChange: () => this.onSettings() });
        sliderRow(colour, { label: 'Sediment tint', unit: '', min: 0, max: 1, step: 0.01, settings: water, path: 'sedimentTint', onChange: () => this.onSettings() });
    }

    buildLook(host)
    {
        const render = this.settings.render;

        const sun = group(host, 'Sun');
        sliderRow(sun, { label: 'Azimuth', unit: '°', min: 0, max: 360, step: 1, settings: render, path: 'sunAzimuthDeg', onChange: () => this.onSettings() });
        sliderRow(sun, { label: 'Elevation', unit: '°', min: 3, max: 88, step: 0.2, settings: render, path: 'sunElevationDeg', onChange: () => this.onSettings() });
        sliderRow(sun, { label: 'Intensity', unit: '', min: 0.2, max: 3, step: 0.01, settings: render, path: 'sunIntensity', onChange: () => this.onSettings() });
        sliderRow(sun, { label: 'Shadow softness', unit: '', min: 0.05, max: 0.6, step: 0.005, settings: render, path: 'shadowSoftness', onChange: () => this.onSettings() });

        const atmosphere = group(host, 'Atmosphere');
        sliderRow(atmosphere, { label: 'Ambient', unit: '', min: 0, max: 1.6, step: 0.01, settings: render, path: 'ambient', onChange: () => this.onSettings() });
        sliderRow(atmosphere, { label: 'Fog density', unit: '1/km', min: 0, max: 4, step: 0.02, settings: render, path: 'fog', onChange: () => this.onSettings() });
        sliderRow(atmosphere, { label: 'Exposure', unit: '', min: 0.2, max: 2.4, step: 0.01, settings: render, path: 'exposure', onChange: () => this.onSettings() });
        sliderRow(atmosphere, { label: 'Sky turbidity', unit: '', min: 0, max: 1, step: 0.01, settings: render, path: 'turbidity', onChange: () => this.onSettings() });

        const surface = group(host, 'Surface');
        sliderRow(surface, { label: 'Detail amplitude', unit: 'vox', min: 0, max: 1.2, step: 0.01, settings: render, path: 'detail', onChange: () => this.onSettings() });
        sliderRow(surface, { label: 'Vegetation', unit: '', min: 0, max: 1, step: 0.01, settings: render, path: 'vegetation', onChange: () => this.onSettings() });
        sliderRow(surface, { label: 'Wet darkening', unit: '', min: 0, max: 1, step: 0.01, settings: render, path: 'wetDarkening', onChange: () => this.onSettings() });
        selectRow(surface, {
            label: 'Biome',
            settings: render,
            path: 'biome',
            options: [
                { value: 0, label: 'Granite and snow' },
                { value: 1, label: 'Desert sandstone' },
                { value: 2, label: 'Badlands clay' },
                { value: 3, label: 'Basalt coast' },
            ],
            onChange: () => this.onSettings(),
        });

        const cut = group(host, 'Section and overlays');
        toggleRow(cut, { label: 'Cross section', settings: render, path: 'clipEnabled', onChange: () => this.onSettings() });
        sliderRow(cut, { label: 'Section height', unit: 'm', min: -100, max: 900, step: 1, settings: render, path: 'clipHeight', onChange: () => this.onSettings() });
        toggleRow(cut, { label: 'Contour lines', settings: render, path: 'contours', onChange: () => this.onSettings() });
        toggleRow(cut, { label: 'River flow vectors', settings: render, path: 'flowVectors', onChange: () => this.onSettings() });
        selectRow(cut, {
            label: 'Debug view',
            settings: render,
            path: 'debugView',
            options: [
                { value: 0, label: 'Shaded' },
                { value: 1, label: 'Distance field' },
                { value: 2, label: 'Normals' },
                { value: 3, label: 'Water depth' },
                { value: 4, label: 'Flow speed' },
                { value: 5, label: 'Discharge' },
                { value: 6, label: 'Deposition' },
                { value: 7, label: 'Hardness' },
                { value: 8, label: 'Parcel load' },
                { value: 9, label: 'Ambient occlusion' },
            ],
            onChange: () => this.onSettings(),
        });
    }
}

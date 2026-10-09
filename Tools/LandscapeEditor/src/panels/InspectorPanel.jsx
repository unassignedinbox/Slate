//============================================================================================================================================
//                                                             INSPECTORPANEL.JSX
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/panels/InspectorPanel.jsx — Inspector panel: card editors for terrain and bedding, the selected height
//    or satmap layer with its generator, erosion, paint, breakup and mask, plus live measurements.

import React from 'react';
import { SlidersHorizontal, Globe, Layers, Waves, Paintbrush, Shapes, Scan, Gauge, Sparkles } from 'lucide-react';
import { GENERATOR_TYPES, generatorTypeById, generatorDefaults } from '../engine/GeneratorSpecification.js';
import { EROSION_TYPES, erosionTypeById, erosionDefaults } from '../engine/ErosionSpecification.js';
import { MASK_TYPES, maskTypeById } from '../engine/MaskSpecification.js';
import { MATERIALS, DRIVERS, SATMAP_MIX_MODES, materialById, driverById } from '../engine/SatmapSpecification.js';
import { MIX_MODES } from '../engine/LayerSequence.js';
import { WORLD_SCHEMA, BEDDING_SCHEMA } from '../engine/TerrainConfiguration.js';
import { sliderParameter } from '../engine/ParameterSpecification.js';
import { buildMaskSetting, newSatmapGenerator } from '../engine/LayerConfiguration.js';
import { ParameterPanel } from './ParameterPanel.jsx';

//------------------------------------------------------------------------------------------------------------------------
//                                                         CARDS
//------------------------------------------------------------------------------------------------------------------------
function CardPanel({ icon: Icon, title, blurb, children })
{
    return (
        <section className="card">
            <header className="card-heading">
                {Icon ? <Icon size={15} /> : null}
                <h3>{title}</h3>
            </header>
            {blurb ? <p className="card-blurb">{blurb}</p> : null}
            {children}
        </section>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        TERRAIN
//------------------------------------------------------------------------------------------------------------------------
function TerrainPanel({ settings, onSettings, onBedding })
{
    const schema = WORLD_SCHEMA.filter((entry) => entry.key !== 'resolution');
    return (
        <>
            <CardPanel icon={Globe} title="Terrain" blurb="Datum, world size, seed and satmap stylisation. Resolution is set in the top bar.">
                <ParameterPanel schema={schema} current={settings} onChange={(key, value) => onSettings({ [key]: value })} />
            </CardPanel>
            <CardPanel icon={Layers} title="Bedding" blurb="Tilted hard and soft beds that set caprock ledges and stratified cliffs.">
                <ParameterPanel schema={BEDDING_SCHEMA} current={settings.bedding} onChange={(key, value) => onBedding({ [key]: value })} />
            </CardPanel>
        </>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         LAYER
//------------------------------------------------------------------------------------------------------------------------
function LayerIdentityPanel({ stack, layer, update })
{
    const satmap = stack === 'satmapLayers';
    const schema = [sliderParameter('opacity', 'Opacity', 0, 1, 0.01, 1, '', 'Blend strength of this layer.')];
    if (!satmap && layer.category === 'generator')
    {
        schema.push(
            sliderParameter('amplitudeM', 'Amplitude', -2000, 3000, 10, 300, 'm', 'Vertical scale of the shape. Negative values invert it.'),
            sliderParameter('offsetM', 'Offset', -2000, 3000, 10, 0, 'm', 'Lifts or lowers the whole shape.')
        );
    }
    schema.push(sliderParameter('seed', 'Seed', 0, 99999, 1, 1, '', 'Pattern seed for this layer.'));
    const current = {
        opacity: layer.opacity ?? 1,
        amplitudeM: layer.amplitudeM ?? 0,
        offsetM: layer.offsetM ?? 0,
        seed: layer.seed ?? 0
    };
    const modes = satmap ? SATMAP_MIX_MODES : MIX_MODES;
    return (
        <CardPanel icon={Sparkles} title="Layer" blurb={satmap ? 'A paint layer on the satmap stack.' : 'A height layer on the height stack.'}>
            <label className="text-row">
                <span>Name</span>
                <input type="text" value={layer.name} onChange={(event) => update({ name: event.target.value })} />
            </label>
            <label className="choice-row">
                <span>Mix mode</span>
                <select value={layer.mixMode} onChange={(event) => update({ mixMode: event.target.value })}>
                    {modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
            </label>
            <ParameterPanel schema={schema} current={current} onChange={(key, value) => update({ [key]: value })} />
        </CardPanel>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 GENERATORS AND EROSION
//------------------------------------------------------------------------------------------------------------------------
function GeneratorPanel({ layer, update })
{
    const type = generatorTypeById(layer.type);
    return (
        <CardPanel icon={Shapes} title="Generator" blurb={type.blurb}>
            <label className="choice-row">
                <span>Shape</span>
                <select
                    value={type.id}
                    onChange={(event) =>
                    {
                        const next = generatorTypeById(event.target.value);
                        update({ type: next.id, name: next.label, params: generatorDefaults(next.id) });
                    }}
                >
                    {GENERATOR_TYPES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
            </label>
            <ParameterPanel schema={type.params} current={layer.params} onChange={(key, value) => update({ params: { ...layer.params, [key]: value } })} />
        </CardPanel>
    );
}

function ErosionPanel({ layer, update })
{
    const type = erosionTypeById(layer.type);
    return (
        <CardPanel icon={Waves} title="Erosion" blurb={type.blurb}>
            <label className="choice-row">
                <span>Erosion type</span>
                <select
                    value={type.id}
                    onChange={(event) =>
                    {
                        const next = erosionTypeById(event.target.value);
                        update({ type: next.id, name: next.label, params: erosionDefaults(next.id) });
                    }}
                >
                    {EROSION_TYPES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
            </label>
            <ParameterPanel schema={type.params} current={layer.params} onChange={(key, value) => update({ params: { ...layer.params, [key]: value } })} />
        </CardPanel>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         PAINT
//------------------------------------------------------------------------------------------------------------------------
function MaterialPanel({ layer, update })
{
    const driver = driverById(layer.driver);
    const span = driver.max - driver.min;
    const band = layer.band || { lo: driver.lo, hi: driver.hi, soft: driver.soft };
    const breakup = layer.breakup || { amount: 0, scaleM: 400, threshold: 0.5 };
    const bandSchema = [
        sliderParameter('lo', 'Band start', driver.min, driver.max, driver.step, band.lo, driver.unit, driver.hint),
        sliderParameter('hi', 'Band end', driver.min, driver.max, driver.step, band.hi, driver.unit, 'Upper edge of the band.'),
        sliderParameter('soft', 'Edge softness', 0, span / 4, driver.step, band.soft, driver.unit, 'Feather width at both band edges.')
    ];
    const breakupSchema = [
        sliderParameter('amount', 'Amount', 0, 1, 0.01, 0, '', 'Share of the layer broken into patches.'),
        sliderParameter('scaleM', 'Patch size', 50, 2000, 10, 400, 'm', 'Characteristic size of the breakup noise.'),
        sliderParameter('threshold', 'Threshold', 0, 1, 0.01, 0.5, '', 'Higher thresholds keep fewer patches.')
    ];
    return (
        <>
            <CardPanel icon={Paintbrush} title="Paint" blurb="Where this material lands, chosen from a physical surface driver.">
                <label className="choice-row">
                    <span>Material</span>
                    <select
                        value={layer.material}
                        onChange={(event) =>
                        {
                            const material = materialById(event.target.value);
                            update({ material: material.id, name: material.label });
                        }}
                    >
                        {MATERIALS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                    </select>
                </label>
                <label className="choice-row">
                    <span>Driver</span>
                    <select
                        value={driver.id}
                        onChange={(event) =>
                        {
                            const next = driverById(event.target.value);
                            update({ driver: next.id, band: { lo: next.lo, hi: next.hi, soft: next.soft } });
                        }}
                    >
                        {DRIVERS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                    </select>
                </label>
                <ParameterPanel schema={bandSchema} current={band} onChange={(key, value) => update({ band: { ...band, [key]: value } })} />
            </CardPanel>
            <CardPanel title="Breakup" blurb="Noise that breaks the paint into natural patches.">
                <ParameterPanel schema={breakupSchema} current={breakup} onChange={(key, value) => update({ breakup: { ...breakup, [key]: value } })} />
            </CardPanel>
        </>
    );
}

function SatmapGeneratorPanel({ layer, update })
{
    const generator = layer.generator;
    const type = generator ? generatorTypeById(generator.type) : null;
    return (
        <CardPanel icon={Shapes} title="Satmap generator" blurb="Optional shape that modulates where this paint lands.">
            <label className="choice-row">
                <span>Shape</span>
                <select value={generator ? generator.type : 'none'} onChange={(event) => update({ generator: event.target.value === 'none' ? null : newSatmapGenerator(event.target.value) })}>
                    <option value="none">None</option>
                    {GENERATOR_TYPES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
            </label>
            {generator && type ? (
                <ParameterPanel schema={type.params} current={generator.params} onChange={(key, value) => update({ generator: { ...generator, params: { ...generator.params, [key]: value } } })} />
            ) : null}
        </CardPanel>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          MASK
//------------------------------------------------------------------------------------------------------------------------
function MaskPanel({ mask, onMask })
{
    const type = maskTypeById(mask.type);
    return (
        <CardPanel icon={Scan} title="Mask" blurb={type.blurb}>
            <label className="choice-row">
                <span>Mask type</span>
                <select value={type.id} onChange={(event) => onMask(buildMaskSetting(event.target.value))}>
                    {MASK_TYPES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
            </label>
            {type.id !== 'none' ? (
                <>
                    <label className="toggle-row">
                        <input type="checkbox" checked={Boolean(mask.invert)} onChange={(event) => onMask({ invert: event.target.checked })} />
                        <span>Invert mask</span>
                    </label>
                    <ParameterPanel
                        schema={[sliderParameter('featherM', 'Feather', 0, 400, 5, 0, 'm', 'Softens the mask edge over this distance.')]}
                        current={mask}
                        onChange={(key, value) => onMask({ [key]: value })}
                    />
                    <ParameterPanel schema={type.params} current={mask.params} onChange={(key, value) => onMask({ params: { ...mask.params, [key]: value } })} />
                </>
            ) : null}
        </CardPanel>
    );
}

function LayerDetailPanel({ selected, onLayer })
{
    const { stack, layer } = selected;
    const satmap = stack === 'satmapLayers';
    const update = (patch) => onLayer(stack, layer.id, patch);
    const updateMask = (patch) => update({ mask: { ...layer.mask, ...patch } });
    let body = null;
    if (satmap)
    {
        body = (
            <>
                <MaterialPanel layer={layer} update={update} />
                <SatmapGeneratorPanel layer={layer} update={update} />
            </>
        );
    }
    else if (layer.category === 'erosion')
    {
        body = <ErosionPanel layer={layer} update={update} />;
    }
    else
    {
        body = <GeneratorPanel layer={layer} update={update} />;
    }
    return (
        <>
            <LayerIdentityPanel stack={stack} layer={layer} update={update} />
            {body}
            <MaskPanel mask={layer.mask} onMask={updateMask} />
        </>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      MEASUREMENTS
//------------------------------------------------------------------------------------------------------------------------
function MeasurePanel({ result })
{
    const metrics = result.metrics;
    const timing = result.timings;
    const rows = [
        ['Relief', `${Math.round(metrics.reliefM)} m`],
        ['Elevation', `${Math.round(metrics.minM)} to ${Math.round(metrics.maxM)} m`],
        ['Land share', `${Math.round(metrics.landFraction * 100)} %`],
        ['Mean slope', `${metrics.meanSlopeDeg.toFixed(1)}°`],
        ['Slope, 95th percentile', `${metrics.p95SlopeDeg.toFixed(1)}°`],
        ['Channel length', `${(metrics.channelLengthM / 1000).toFixed(2)} km`],
        ['Eroded', `${(metrics.erodedM3 / 1e6).toFixed(2)} Mm³`],
        ['Deposited', `${(metrics.depositedM3 / 1e6).toFixed(2)} Mm³`]
    ];
    return (
        <CardPanel
            icon={Gauge}
            title="Measurements"
            blurb={`Total ${Math.round(timing.totalMs)} ms: height ${Math.round(timing.heightMs)}, surface ${Math.round(timing.surfaceMs)}, satmap ${Math.round(timing.satmapMs)}.`}
        >
            <dl className="metric-list">
                {rows.map(([label, text]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{text}</dd>
                    </div>
                ))}
            </dl>
            <h4 className="log-title">Height stack log</h4>
            <ol className="log-list">
                {result.log.map((entry) => (
                    <li key={entry.id} className={entry.skipped ? 'is-off' : ''}>
                        <span>{entry.name}</span>
                        <span>{entry.skipped ? 'off' : entry.reused ? 'reused' : `${Math.round(entry.ms)} ms`}</span>
                    </li>
                ))}
            </ol>
        </CardPanel>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         PANEL
//------------------------------------------------------------------------------------------------------------------------
export function InspectorPanel({ selected, settings, result, onSettings, onBedding, onLayer })
{
    return (
        <aside className="inspector-panel">
            <header className="panel-heading">
                <SlidersHorizontal size={16} />
                <h2>Inspector</h2>
            </header>
            <div className="card-stack">
                {selected ? <LayerDetailPanel selected={selected} onLayer={onLayer} /> : <TerrainPanel settings={settings} onSettings={onSettings} onBedding={onBedding} />}
                {result ? <MeasurePanel result={result} /> : null}
            </div>
        </aside>
    );
}

//============================================================================================================================================
//                                                             PARAMETERPANEL.JSX
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/panels/ParameterPanel.jsx — Parameter panel: renders any schema of sliders and choice dropdowns, used
//    by terrain, bedding, generator, erosion, mask and paint cards.

import React from 'react';

//------------------------------------------------------------------------------------------------------------------------
//                                                       FORMATTING
//------------------------------------------------------------------------------------------------------------------------
function decimalsForStep(step)
{
    return Math.max(0, Math.min(3, Math.ceil(-Math.log10(step))));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         FIELDS
//------------------------------------------------------------------------------------------------------------------------
function SliderPanel({ entry, current, onChange })
{
    const numeric = Number.isFinite(current) ? current : entry.initial;
    const unitText = entry.unit ? ` ${entry.unit}` : '';
    return (
        <label className="parameter-row" title={entry.hint || ''}>
            <span className="parameter-head">
                <span className="parameter-name">{entry.label}</span>
                <span className="parameter-readout">{numeric.toFixed(decimalsForStep(entry.step))}{unitText}</span>
            </span>
            <input
                type="range"
                min={entry.min}
                max={entry.max}
                step={entry.step}
                value={numeric}
                onChange={(event) => onChange(entry.key, Number(event.target.value))}
            />
        </label>
    );
}

function ChoicePanel({ entry, current, onChange })
{
    const selectedText = String(current ?? entry.initial);
    return (
        <label className="parameter-row" title={entry.hint || ''}>
            <span className="parameter-head">
                <span className="parameter-name">{entry.label}</span>
            </span>
            <select
                value={selectedText}
                onChange={(event) =>
                {
                    const chosen = entry.choices.find((choice) => String(choice.id) === event.target.value);
                    onChange(entry.key, chosen ? chosen.id : entry.initial);
                }}
            >
                {entry.choices.map((choice) => <option key={String(choice.id)} value={String(choice.id)}>{choice.label}</option>)}
            </select>
        </label>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PARAMETER LIST
//------------------------------------------------------------------------------------------------------------------------
export function ParameterPanel({ schema, current, onChange })
{
    const record = current || {};
    return (
        <div className="parameter-list">
            {schema.map((entry) => (entry.control === 'choice'
                ? <ChoicePanel key={entry.key} entry={entry} current={record[entry.key]} onChange={onChange} />
                : <SliderPanel key={entry.key} entry={entry} current={record[entry.key]} onChange={onChange} />))}
        </div>
    );
}

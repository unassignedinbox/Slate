//============================================================================================================================================
//                                                         PARAMETERSPECIFICATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/ParameterSpecification.js — Shared parameter schema helpers: slider and choice declarations,
//    initial values and clamping used by every catalogue.

import { clampNumber } from './HeightSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                  SCHEMA CONSTRUCTORS
//------------------------------------------------------------------------------------------------------------------------
export function sliderParameter(key, label, min, max, step, initial, unit = '', hint = '')
{
    return { key, label, control: 'slider', min, max, step, initial, unit, hint };
}

export function choiceParameter(key, label, choices, initial, hint = '')
{
    return { key, label, control: 'choice', choices, initial, hint };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       RESOLUTION
//------------------------------------------------------------------------------------------------------------------------
export function initialParameters(schema)
{
    const out = {};
    for (const entry of schema)
    {
        out[entry.key] = entry.initial;
    }
    return out;
}

export function clampParameters(schema, given)
{
    const out = {};
    for (const entry of schema)
    {
        const raw = given && given[entry.key] !== undefined ? given[entry.key] : entry.initial;
        if (entry.control === 'slider')
        {
            const number = Number(raw);
            out[entry.key] = Number.isFinite(number) ? clampNumber(number, entry.min, entry.max) : entry.initial;
        }
        else
        {
            out[entry.key] = entry.choices.some((choice) => choice.id === raw) ? raw : entry.initial;
        }
    }
    return out;
}

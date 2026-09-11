//==========================================================================================
// Controls — declarative inspector widgets. Each builder reads from and writes back into a
// settings object through a path, then reports the change so the engine can be re-armed.
//==========================================================================================

import { formatNumber } from './shell.js';

const activeScrubs = new Set();
const RESERVED = ['undo','redo','route','then','expand','transfer','accept','deny','goto','typeof','instanceof','on','and','or'];

function safeKey(name)
{
    return RESERVED.includes(name) ? `${name}_` : name;
}

function readPath(target, path)
{
    return path.split('.').reduce((node, key) => (node ? node[safeKey(key)] : undefined), target);
}

function writePath(target, path, value)
{
    const keys = path.split('.');
    const last = keys.pop();
    const owner = keys.reduce((node, key) => node[safeKey(key)], target);
    owner[safeKey(last)] = value;
}

function getPath(target, path)
{
    const owner = readPath(target, path);
    return owner;
}

function emit(config, value)
{
    writePath(config.settings, config.path, value);
    config.onChange?.(value, config.path);
}

function numberText(value, step)
{
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return formatNumber(value, decimals).replace(/[kMB]$/, '');
}

// Continuous slider with an attached numeric well. Drag on the well to scrub the value.
export function sliderRow(parent, config)
{
    const { label, unit, min, max, step } = config;
    const row = document.createElement('div');
    row.className = 'row';

    const name = document.createElement('div');
    name.className = 'label';
    name.innerHTML = `${label}${unit ? `<span class="unit">${unit}</span>` : ''}`;

    const range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = step;
    range.value = readPath(config.settings, config.path);

    const well = document.createElement('div');
    well.className = 'field';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = numberText(Number(range.value), step);
    well.appendChild(input);

    let dragging = false;
    let startX = 0;
    let startValue = 0;
    well.addEventListener('pointerdown', (event) => {
        if (event.target === input && document.activeElement === input)
        {
            return;
        }
        dragging = true;
        startX = event.clientX;
        startValue = Number(range.value);
        well.setPointerCapture(event.pointerId);
        activeScrubs.add(well);
    });
    well.addEventListener('pointermove', (event) => {
        if (!dragging)
        {
            return;
        }
        const span = max - min;
        const next = startValue + (event.clientX - startX) * span / 220;
        const snapped = Math.round(next / step) * step;
        range.value = String(Math.min(max, Math.max(min, snapped)));
        input.value = numberText(Number(range.value), step);
        emit(config, Number(range.value));
    });
    well.addEventListener('pointerup', (event) => {
        dragging = false;
        activeScrubs.delete(well);
        well.releasePointerCapture(event.pointerId);
    });

    input.addEventListener('change', () => {
        const parsed = Number(input.value.replace(/[^\d.\-+e]/g, ''));
        if (Number.isFinite(parsed))
        {
            const clamped = Math.min(max, Math.max(min, parsed));
            range.value = String(clamped);
            input.value = numberText(clamped, step);
            emit(config, clamped);
        }
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter')
        {
            input.blur();
        }
    });

    range.addEventListener('input', () => {
        input.value = numberText(Number(range.value), step);
        emit(config, Number(range.value));
    });

    row.append(name, range, well);
    parent.appendChild(row);
    return row;
}

export function toggleRow(parent, config)
{
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('div');
    name.className = 'label';
    name.textContent = config.label;
    const toggle = document.createElement('div');
    toggle.className = `toggle${readPath(config.settings, config.path) ? ' on' : ''}`;
    toggle.onclick = () => {
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        emit(config, next);
    };
    row.append(name, toggle);
    parent.appendChild(row);
    return row;
}

export function selectRow(parent, config)
{
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('div');
    name.className = 'label';
    name.textContent = config.label;
    const select = document.createElement('select');
    for (const option of config.options)
    {
        const item = document.createElement('option');
        item.value = String(option.value);
        item.textContent = option.label;
        select.appendChild(item);
    }
    select.value = String(readPath(config.settings, config.path));
    select.onchange = () => {
        const raw = select.value;
        const parsed = config.numeric === false ? raw : Number(raw);
        emit(config, parsed);
    };
    row.append(name, select);
    parent.appendChild(row);
    return row;
}
function vectorEdit(inputs, values, step = 1)
{
    inputs.forEach((input, index) => {
        input.value = numberText(values[index], step);
    });
}

// Read-only value tile. Two of these fill a row, which is what the Solver and Water tabs are
// mostly made of: numbers that prove the model is behaving, not controls.
export function statRow(parent, label, value, unit = '')
{
    let grid = parent.querySelector(':scope > .stat-grid');
    if (!grid)
    {
        grid = document.createElement('div');
        grid.className = 'stat-grid';
        parent.appendChild(grid);
    }
    const cell = document.createElement('div');
    cell.className = 'stat';
    const key = document.createElement('div');
    key.className = 'k';
    key.textContent = label;
    const val = document.createElement('div');
    val.className = 'v';
    val.textContent = value;
    if (unit)
    {
        const small = document.createElement('small');
        small.textContent = unit;
        val.appendChild(small);
    }
    cell.append(key, val);
    grid.appendChild(cell);
    return cell;
}

// Explanatory line. `kind` is a tone: 'info' for background, anything else for a caution, so a
// warning in the inspector always looks like a warning.
export function noteRow(parent, text, kind = 'info')
{
    const row = document.createElement('div');
    row.className = kind === 'info' ? 'note-text' : 'warn-text';
    row.style.margin = '6px 2px 2px';
    row.textContent = text;
    parent.appendChild(row);
    return row;
}

// A small group of numeric wells that all edit one array-valued parameter, e.g. a colour.
export function vectorRow(parent, config)
{
    const components = config.components ?? 3;
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('div');
    name.className = 'label';
    name.textContent = config.label;
    row.appendChild(name);

    const current = getPath(config.settings, config.path) || [];
    const wells = [];
    for (let index = 0; index < components; index += 1)
    {
        const well = document.createElement('div');
        well.className = 'field';
        well.style.minWidth = '52px';
        const input = document.createElement('input');
        input.style.width = '42px';
        input.value = numberText(Number(current[index] ?? 0), config.step ?? 1);
        well.appendChild(input);
        input.addEventListener('change', () => {
            const values = (getPath(config.settings, config.path) || []).slice();
            const parsed = Number(input.value.replace(/[^\d.\-+e]/g, ''));
            values[index] = Number.isFinite(parsed) ? parsed : 0;
            input.value = numberText(values[index], config.step ?? 1);
            emit(config, values);
        });
        wells.push(input);
        row.appendChild(well);
    }

    parent.appendChild(row);
    return { row, inputs: wells, set(values) { vectorEdit(wells, values, config.step ?? 1); } };
}

export function group(parent, title, collapsed = false)
{
    const element = document.createElement('section');
    element.className = `group${collapsed ? ' collapsed' : ''}`;
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `<span class="label">${title}</span><span class="chev">▾</span>`;
    head.onclick = () => element.classList.toggle('collapsed');
    const body = document.createElement('div');
    body.className = 'group-body';
    element.append(head, body);
    parent.appendChild(element);
    return body;
}

export function sectionTitle(parent, text)
{
    const el = document.createElement('div');
    el.className = 'section-title';
    el.textContent = text;
    parent.appendChild(el);
    return el;
}

export function buttonRow(parent, buttons)
{
    const row = document.createElement('div');
    row.className = 'row';
    for (const spec of buttons)
    {
        const button = document.createElement('button');
        button.className = `btn sm ${spec.className || 'ghost'}`;
        button.style.flex = '1';
        button.style.justifyContent = 'center';
        button.textContent = spec.label;
        button.onclick = spec.onClick;
        row.appendChild(button);
    }
    parent.appendChild(row);
    return row;
}

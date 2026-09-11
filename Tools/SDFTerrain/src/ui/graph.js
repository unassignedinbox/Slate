//==========================================================================================
// Graph editor — a canvas-drawn node surface.
//
// Drawn on a 2D canvas rather than in the WebGPU viewport: the editor has to stay crisp and
// interactive while the terrain renderer is fully occupied, and it keeps hit-testing trivial.
// The surface owns pan/zoom, dragging, wiring, box selection, an add-node palette and the
// keyboard verbs (delete, duplicate, undo, frame).
//==========================================================================================

import { NODE_BY_ID, SOCKET_COLORS } from '../kernel/graph/nodes.js';
import { connect, wouldCycle, createNode, findNode, removeNode, cloneDocument } from '../kernel/graph/doc.js';

const NODE_WIDTH = 178;
const HEADER = 26;
const ROW = 19;
const PAD = 8;
const PORT_RADIUS = 4.5;

export class GraphEditor
{
    constructor(canvas, options)
    {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.doc = options.doc;
        this.selection = new Set();
        this.selectedEdge = null;
        this.zoom = 0.9;
        this.pan = { x: 60, y: 60 };
        this.drag = null;
        this.hover = null;
        this.pendingWire = null;
        this.space = false;
        this.onChange = options.onChange || (() => {});
        this.onSelect = options.onSelect || (() => {});
        this.contextMenu = options.contextMenu || (() => {});
        this.attach();
        this.fit();
    }

    setDocument(doc)
    {
        this.doc = doc;
        this.selection.clear();
        this.selectedEdge = null;
        this.onSelect(null);
        this.draw();
    }

    //------------------------------------------------------------------ geometry
    layout(node)
    {
        const def = NODE_BY_ID.get(node.type);
        const inputs = def?.sockets?.in ?? [];
        const outputs = def?.sockets?.out ?? [];
        const rows = Math.max(inputs.length, outputs.length, 1);
        const height = HEADER + rows * ROW + PAD;
        return {
            def,
            inputs,
            outputs,
            width: NODE_WIDTH,
            height,
            // Ports sit on the node edge, one row apart, in world coordinates.
            port: (kind, index) =>
            {
                const sockets = kind === 'in' ? inputs : outputs;
                return {
                    x: kind === 'in' ? node.x : node.x + NODE_WIDTH,
                    y: node.y + HEADER + (index + 0.5) * ROW,
                    socket: sockets[index],
                };
            },
        };
    }

    screenToWorld(x, y)
    {
        return { x: (x - this.pan.x) / this.zoom, y: (y - this.pan.y) / this.zoom };
    }

    worldToScreen(x, y)
    {
        return { x: x * this.zoom + this.pan.x, y: y * this.zoom + this.pan.y };
    }

    //------------------------------------------------------------------ input
    attach()
    {
        const canvas = this.canvas;
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
        canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
        canvas.addEventListener('pointerleave', () => {
            this.hover = null;
            this.draw();
        });
        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const factor = Math.exp(-event.deltaY * 0.0012);
            const before = this.screenToWorld(event.offsetX, event.offsetY);
            this.zoom = Math.min(2.2, Math.max(0.25, this.zoom * factor));
            const after = this.screenToWorld(event.offsetX, event.offsetY);
            this.pan.x += (after.x - before.x) * this.zoom;
            this.pan.y += (after.y - before.y) * this.zoom;
            this.draw();
        }, { passive: false });
    }

    pick(world)
    {
        for (let i = this.doc.nodes.length - 1; i >= 0; i -= 1)
        {
            const node = this.doc.nodes[i];
            const layout = this.layout(node);
            if (world.x >= node.x && world.x <= node.x + layout.width &&
                world.y >= node.y && world.y <= node.y + layout.height)
            {
                // Socket first: ports win over the body they overlap.
                for (let index = 0; index < layout.inputs.length; index += 1)
                {
                    const port = layout.port('in', index);
                    if (Math.hypot(world.x - port.x, world.y - port.y) < PORT_RADIUS * 2.4)
                    {
                        return { node, layout, kind: 'in', index };
                    }
                }
                for (let index = 0; index < layout.outputs.length; index += 1)
                {
                    const port = layout.port('out', index);
                    if (Math.hypot(world.x - port.x, world.y - port.y) < PORT_RADIUS * 2.4)
                    {
                        return { node, layout, kind: 'out', index };
                    }
                }
                return { node, layout, kind: 'body' };
            }
        }
        return null;
    }

    pickEdge(world)
    {
        for (const edge of this.doc.edges)
        {
            const from = findNode(this.doc, edge.from);
            const to = findNode(this.doc, edge.to);
            if (!from || !to)
            {
                continue;
            }
            const fromLayout = this.layout(from);
            const toLayout = this.layout(to);
            const a = fromLayout.port('out', fromLayout.outputs.findIndex((s) => s.id === edge.fromSocket));
            const b = toLayout.port('in', toLayout.inputs.findIndex((s) => s.id === edge.toSocket));
            const d = distanceToCurve(world, a, b);
            if (d < 7)
            {
                return edge;
            }
        }
        return null;
    }

    onPointerDown(event)
    {
        this.canvas.setPointerCapture(event.pointerId);
        const world = this.screenToWorld(event.offsetX, event.offsetY);
        const hit = this.pick(world);

        if (event.button === 2 || event.button === 1)
        {
            if (hit && hit.kind === 'body' && event.button === 2)
            {
                this.selection.clear();
                this.selection.add(hit.node.id);
                this.onSelect(hit.node.id);
                this.draw();
                this.contextMenu(event, this.nodeMenuItems(hit.node), world);
                return;
            }
            this.drag = { kind: 'pan', start: { x: event.offsetX, y: event.offsetY }, origin: { ...this.pan } };
            return;
        }

        if (hit && hit.kind === 'out')
        {
            this.pendingWire = { node: hit.node, index: hit.index, socket: hit.layout.outputs[hit.index], cursor: world };
            this.draw();
            return;
        }

        if (hit && hit.kind === 'in')
        {
            const existing = this.doc.edges.find((edge) => edge.to === hit.node.id && edge.toSocket === hit.layout.inputs[hit.index].id);
            if (existing)
            {
                // Grab the wire and re-route it, which is how artists actually edit graphs.
                this.doc.edges = this.doc.edges.filter((edge) => edge !== existing);
                const from = findNode(this.doc, existing.from);
                if (from)
                {
                    const layout = this.layout(from);
                    const index = Math.max(0, layout.outputs.findIndex((s) => s.id === existing.fromSocket));
                    this.pendingWire = { node: from, index, socket: layout.outputs[index], cursor: world };
                }
                this.pushHistory();
            }
            return;
        }

        if (hit && hit.kind === 'body')
        {
            if (event.shiftKey)
            {
                if (this.selection.has(hit.node.id))
                {
                    this.selection.delete(hit.node.id);
                }
                else
                {
                    this.selection.add(hit.node.id);
                }
            }
            else if (!this.selection.has(hit.node.id))
            {
                this.selection.clear();
                this.selection.add(hit.node.id);
            }
            const origins = new Map();
            for (const id of this.selection)
            {
                const node = findNode(this.doc, id);
                if (node)
                {
                    origins.set(id, { x: node.x, y: node.y });
                }
            }
            this.drag = { kind: 'nodes', start: world, origins };
            this.onSelect(this.selection.size === 1 ? [...this.selection][0] : null);
            this.canvas.style.cursor = 'grabbing';
            this.draw();
            return;
        }

        const edge = this.pickEdge(world);
        if (edge)
        {
            this.selectedEdge = edge;
            this.selection.clear();
            this.onSelect(null);
            this.draw();
            return;
        }

        // Empty space: box select.
        this.selection.clear();
        this.selectedEdge = null;
        this.onSelect(null);
        this.drag = { kind: 'box', start: world, current: world };
        this.draw();
    }

    onPointerMove(event)
    {
        const world = this.screenToWorld(event.offsetX, event.offsetY);
        if (this.pendingWire)
        {
            this.pendingWire.cursor = world;
            this.draw();
            return;
        }
        if (this.drag?.kind === 'pan')
        {
            this.pan.x = this.drag.origin.x + (event.offsetX - this.drag.start.x);
            this.pan.y = this.drag.origin.y + (event.offsetY - this.drag.start.y);
            this.draw();
            return;
        }
        if (this.drag?.kind === 'nodes')
        {
            const dx = world.x - this.drag.start.x;
            const dy = world.y - this.drag.start.y;
            for (const [id, origin] of this.drag.origins)
            {
                const node = findNode(this.doc, id);
                if (node)
                {
                    node.x = Math.round(origin.x + dx);
                    node.y = Math.round(origin.y + dy);
                }
            }
            this.draw();
            return;
        }
        if (this.drag?.kind === 'box')
        {
            this.drag.current = world;
            this.draw();
            return;
        }

        const hit = this.pick(world);
        const nextHover = hit ? `${hit.node.id}:${hit.kind}` : null;
        this.canvas.style.cursor = hit ? (hit.kind === 'body' ? 'grab' : 'crosshair') : 'default';
        if (nextHover !== this.hover)
        {
            this.hover = nextHover;
            this.draw();
        }
    }

    onPointerUp(event)
    {
        const world = this.screenToWorld(event.offsetX, event.offsetY);
        if (this.pendingWire)
        {
            const hit = this.pick(world);
            if (hit && hit.kind === 'in' && hit.layout.inputs[hit.index])
            {
                const from = this.pendingWire.node.id;
                const to = hit.node.id;
                const target = hit.layout.inputs[hit.index];
                if (from === to)
                {
                    this.contextMenu(event, [{ label: 'A node cannot feed itself', onClick: () => {} }], world);
                }
                else if (target.type !== this.pendingWire.socket.type && target.type !== 'point' && this.pendingWire.socket.type !== 'point')
                {
                    this.contextMenu(event, [{ label: `Type mismatch: ${this.pendingWire.socket.type} → ${target.type}`, onClick: () => {} }], world);
                }
                else if (wouldCycle(this.doc, from, to))
                {
                    this.contextMenu(event, [{ label: 'That wire would create a loop', onClick: () => {} }], world);
                }
                else
                {
                    connect(this.doc, from, this.pendingWire.socket.id, to, target.id);
                    this.pushHistory();
                    this.onChange();
                }
            }
            this.pendingWire = null;
            this.draw();
        }

        if (this.drag?.kind === 'nodes')
        {
            this.pushHistory();
            this.onChange();
        }
        if (this.drag?.kind === 'box')
        {
            const { start, current } = this.drag;
            const box = {
                x: Math.min(start.x, current.x),
                y: Math.min(start.y, current.y),
                w: Math.abs(current.x - start.x),
                h: Math.abs(current.y - start.y),
            };
            if (box.w > 6 || box.h > 6)
            {
                for (const node of this.doc.nodes)
                {
                    const layout = this.layout(node);
                    if (node.x + layout.width > box.x && node.x < box.x + box.w &&
                        node.y + layout.height > box.y && node.y < box.y + box.h)
                    {
                        this.selection.add(node.id);
                    }
                }
                this.onSelect(this.selection.size === 1 ? [...this.selection][0] : null);
            }
        }

        this.drag = null;
        this.canvas.style.cursor = 'default';
        this.draw();
    }

    nodeMenuItems(node)
    {
        return [
            { title: NODE_BY_ID.get(node.type)?.title ?? node.type },
            {
                label: 'Duplicate',
                hint: 'Ctrl+D',
                onClick: () => this.duplicateSelection(),
            },
            {
                label: 'Disconnect inputs',
                onClick: () => {
                    this.doc.edges = this.doc.edges.filter((edge) => edge.to !== node.id);
                    this.pushHistory();
                    this.onChange();
                },
            },
            {
                label: 'Delete',
                hint: 'Del',
                onClick: () => this.deleteSelection(),
            },
        ];
    }

    //------------------------------------------------------------------ mutations
    pushHistory()
    {
        this.history?.push(this.doc);
    }

    setHistory(history)
    {
        this.history = history;
    }

    addNode(type, world, options = {})
    {
        const node = createNode(type, world.x - NODE_WIDTH * 0.5, world.y - 20, options.params);
        this.doc.nodes.push(node);
        this.selection.clear();
        this.selection.add(node.id);
        this.pushHistory();
        this.onChange();
        this.onSelect(node.id);
        this.draw();
        return node;
    }

    duplicateSelection()
    {
        const copies = [];
        for (const id of this.selection)
        {
            const node = findNode(this.doc, id);
            if (!node)
            {
                continue;
            }
            const copy = createNode(node.type, node.x + 34, node.y + 34, node.params);
            this.doc.nodes.push(copy);
            copies.push(copy);
        }
        this.selection = new Set(copies.map((node) => node.id));
        this.pushHistory();
        this.onChange();
        this.draw();
    }

    deleteSelection()
    {
        if (this.selectedEdge)
        {
            this.doc.edges = this.doc.edges.filter((edge) => edge !== this.selectedEdge);
            this.selectedEdge = null;
            this.pushHistory();
            this.onChange();
            this.draw();
            return;
        }
        for (const id of this.selection)
        {
            removeNode(this.doc, id);
        }
        this.selection.clear();
        this.onSelect(null);
        this.pushHistory();
        this.onChange();
        this.draw();
    }

    undo()
    {
        const snapshot = this.history?.undo();
        if (snapshot)
        {
            this.doc = snapshot;
            this.selection.clear();
            this.onChange();
            this.draw();
        }
        return Boolean(snapshot);
    }

    redo()
    {
        const snapshot = this.history?.redo();
        if (snapshot)
        {
            this.doc = snapshot;
            this.selection.clear();
            this.onChange();
            this.draw();
        }
        return Boolean(snapshot);
    }

    fit()
    {
        if (!this.doc?.nodes?.length)
        {
            return;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const node of this.doc.nodes)
        {
            const layout = this.layout(node);
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + layout.width);
            maxY = Math.max(maxY, node.y + layout.height);
        }
        const margin = 40;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width / (maxX - minX + margin * 2);
        const scaleY = rect.height / (maxY - minY + margin * 2);
        this.zoom = Math.min(1.15, Math.max(0.25, Math.min(scaleX, scaleY)));
        this.pan.x = (rect.width - (maxX - minX) * this.zoom) * 0.5 - minX * this.zoom;
        this.pan.y = (rect.height - (maxY - minY) * this.zoom) * 0.5 - minY * this.zoom;
        this.draw();
    }

    //------------------------------------------------------------------ painting
    draw()
    {
        const canvas = this.canvas;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr))
        {
            canvas.width = Math.max(64, Math.floor(rect.width * dpr));
            canvas.height = Math.max(64, Math.floor(rect.height * dpr));
        }
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        // Backdrop grid.
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, rect.width, rect.height);
        const step = 32 * this.zoom;
        if (step > 6)
        {
            ctx.strokeStyle = 'rgba(255,255,255,0.035)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            const ox = this.pan.x % step;
            const oy = this.pan.y % step;
            for (let x = ox; x < rect.width; x += step)
            {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, rect.height);
            }
            for (let y = oy; y < rect.height; y += step)
            {
                ctx.moveTo(0, y);
                ctx.lineTo(rect.width, y);
            }
            ctx.stroke();
        }

        ctx.save();
        ctx.translate(this.pan.x, this.pan.y);
        ctx.scale(this.zoom, this.zoom);

        // Wires first so nodes sit on top.
        for (const edge of this.doc.edges)
        {
            const from = findNode(this.doc, edge.from);
            const to = findNode(this.doc, edge.to);
            if (!from || !to)
            {
                continue;
            }
            const fromLayout = this.layout(from);
            const toLayout = this.layout(to);
            const a = fromLayout.port('out', Math.max(0, fromLayout.outputs.findIndex((s) => s.id === edge.fromSocket)));
            const b = toLayout.port('in', Math.max(0, toLayout.inputs.findIndex((s) => s.id === edge.toSocket)));
            const socket = fromLayout.outputs.find((s) => s.id === edge.fromSocket);
            const color = SOCKET_COLORS[socket?.type] || '#8a8a8a';
            const active = this.selectedEdge === edge;
            ctx.strokeStyle = active ? '#ffffff' : color;
            ctx.globalAlpha = active ? 1 : 0.72;
            ctx.lineWidth = active ? 2.4 : 1.6;
            drawWire(ctx, a, b);
        }
        ctx.globalAlpha = 1;

        if (this.pendingWire)
        {
            const cursor = this.pendingWire.cursor;
            const color = SOCKET_COLORS[this.pendingWire.socket.type] || '#8a8a8a';
            const layout = this.layout(this.pendingWire.node);
            const start = layout.port('out', this.pendingWire.index);
            ctx.strokeStyle = color;
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1.8;
            drawWire(ctx, start, { x: cursor.x, y: cursor.y });
            ctx.setLineDash([]);
        }

        for (const node of this.doc.nodes)
        {
            this.drawNode(node);
        }

        if (this.drag?.kind === 'box')
        {
            const { start, current } = this.drag;
            ctx.strokeStyle = 'rgba(108,119,255,0.85)';
            ctx.fillStyle = 'rgba(108,119,255,0.12)';
            ctx.lineWidth = 1;
            const x = Math.min(start.x, current.x);
            const y = Math.min(start.y, current.y);
            const w = Math.abs(current.x - start.x);
            const h = Math.abs(current.y - start.y);
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
        }

        ctx.restore();
    }

    drawNode(node)
    {
        const ctx = this.ctx;
        const layout = this.layout(node);
        const selected = this.selection.has(node.id);
        const group = layout.def?.group ?? 'Node';
        const tint = GROUP_TINTS[group] || '#6c77ff';

        ctx.save();
        ctx.translate(node.x, node.y);

        // Body
        roundRect(ctx, 0, 0, layout.width, layout.height, 10);
        ctx.fillStyle = selected ? '#1c1c1f' : '#141414';
        ctx.fill();
        ctx.lineWidth = selected ? 1.6 : 1;
        ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.07)';
        ctx.stroke();

        // Header
        ctx.save();
        roundRect(ctx, 0, 0, layout.width, HEADER, 10);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(0, 0, layout.width, HEADER);
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, 3, HEADER);
        ctx.restore();

        ctx.fillStyle = '#f0f0f0';
        ctx.font = '600 11px "General Sans", Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(layout.def?.title ?? node.type, 12, HEADER * 0.5);

        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '9px "General Sans", Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(group.toUpperCase(), layout.width - 10, HEADER * 0.5 + 0.5);
        ctx.textAlign = 'left';

        // Ports and labels
        layout.inputs.forEach((socket, index) => {
            const port = layout.port('in', index);
            ctx.beginPath();
            ctx.arc(0, port.y - node.y, PORT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = SOCKET_COLORS[socket.type] || '#8a8a8a';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.65)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.52)';
            ctx.font = '10px "General Sans", Inter, system-ui, sans-serif';
            ctx.fillText(socket.label ?? socket.id, 11, port.y - node.y);
        });

        layout.outputs.forEach((socket, index) => {
            const port = layout.port('out', index);
            ctx.beginPath();
            ctx.arc(layout.width, port.y - node.y, PORT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = SOCKET_COLORS[socket.type] || '#8a8a8a';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.65)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.52)';
            ctx.font = '10px "General Sans", Inter, system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(socket.label ?? socket.id, layout.width - 11, port.y - node.y);
            ctx.textAlign = 'left';
        });

        // One parameter is shown on the node so a recipe can be read without opening the inspector.
        const firstParam = layout.def?.params?.[0];
        if (firstParam)
        {
            const value = node.params?.[firstParam.id];
            ctx.fillStyle = 'rgba(255,255,255,0.34)';
            ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${firstParam.label}: ${formatParam(value)}`, layout.width * 0.5, layout.height - PAD - 1);
            ctx.textAlign = 'left';
        }

        ctx.restore();
    }
}

const GROUP_TINTS = {
    Primitives: '#6c77ff',
    Combine: '#8b5cf6',
    Domain: '#0ea5e9',
    Caves: '#f59e0b',
    Deformation: '#14b8a6',
    Masks: '#eab308',
    Outputs: '#22c55e',
};

function formatParam(value)
{
    if (typeof value !== 'number')
    {
        return String(value);
    }
    if (Math.abs(value) >= 100)
    {
        return value.toFixed(0);
    }
    if (Math.abs(value) >= 1)
    {
        return value.toFixed(2);
    }
    return value.toFixed(3);
}

function roundRect(ctx, x, y, w, h, r)
{
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawWire(ctx, a, b)
{
    const bend = Math.max(28, Math.abs(b.x - a.x) * 0.45);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + bend, a.y, b.x - bend, b.y, b.x, b.y);
    ctx.stroke();
}

function distanceToCurve(point, a, b)
{
    // Sampled distance is plenty for a 7-pixel pick radius.
    let best = Infinity;
    const bend = Math.max(28, Math.abs(b.x - a.x) * 0.45);
    for (let i = 0; i <= 16; i += 1)
    {
        const t = i / 16;
        const mt = 1 - t;
        const x = mt * mt * mt * a.x + 3 * mt * mt * t * (a.x + bend) + 3 * mt * t * t * (b.x - bend) + t * t * t * b.x;
        const y = mt * mt * mt * a.y + 3 * mt * mt * t * a.y + 3 * mt * t * t * b.y + t * t * t * b.y;
        best = Math.min(best, Math.hypot(point.x - x, point.y - y));
    }
    return best;
}

export { NODE_WIDTH, cloneDocument };

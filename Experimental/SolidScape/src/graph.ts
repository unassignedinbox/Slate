//============================================================================================================================================
// SolidScape — Node graph surface: pan, zoom, marquee, drag, wiring, selection toolbar, context menu
//============================================================================================================================================

import { CatalogueIndex, type NodeSpecification, type PortType } from './nodeCatalogue';
import { RenderGlyph, HydrateGlyphs } from './icons';

export interface GraphNode
{
    uid:       string;
    specId:    string;
    x:         number;
    y:         number;
    collapsed: boolean;
    muted:     boolean;
    params:    Record<string, number>;
    root:      HTMLElement;
}

export interface GraphWire
{
    uid:      string;
    fromNode: string;
    fromPort: string;
    toNode:   string;
    toPort:   string;
    type:     PortType;
}

interface PortAnchor { x: number; y: number }

let counter = 0;
const NextUid = (prefix: string) => `${prefix}-${(counter += 1).toString(36)}`;

//--------------------------------------------------------------------------------------------------------------------------
export class GraphSurface
{
    nodes = new Map<string, GraphNode>();
    wires = new Map<string, GraphWire>();
    selection = new Set<string>();
    selectedWire: string | null = null;

    panX = 0;
    panY = 0;
    zoom = 1;
    snapEnabled = true;
    readonly snapSize = 20;                                    // [px] graph units

    onSelectionChanged: (() => void) | null = null;
    onGraphChanged:     (() => void) | null = null;

    private readonly surface: HTMLElement;
    private readonly layer:   HTMLElement;
    private readonly wireSvg: SVGSVGElement;
    private readonly bgLayer: HTMLElement;
    private readonly marquee: HTMLElement;

    private dragMode: 'none' | 'pan' | 'nodes' | 'marquee' | 'wire' = 'none';
    private dragOrigin = { x: 0, y: 0 };
    private dragNodeStart = new Map<string, { x: number; y: number }>();
    private pendingWire: { node: string; port: string; type: PortType; side: 'in' | 'out' } | null = null;
    private tempPath: SVGPathElement | null = null;

    constructor(surface: HTMLElement, layer: HTMLElement, wireSvg: SVGSVGElement, bgLayer: HTMLElement, marquee: HTMLElement)
    {
        this.surface = surface;
        this.layer   = layer;
        this.wireSvg = wireSvg;
        this.bgLayer = bgLayer;
        this.marquee = marquee;
        this.BindSurface();
        this.ApplyTransform();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Coordinate conversion
    //----------------------------------------------------------------------------------------------------------------------
    ScreenToGraph(clientX: number, clientY: number): { x: number; y: number }
    {
        const r = this.surface.getBoundingClientRect();
        return {
            x: (clientX - r.left - this.panX) / this.zoom,
            y: (clientY - r.top  - this.panY) / this.zoom,
        };
    }

    GraphToScreen(x: number, y: number): { x: number; y: number }
    {
        return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY };
    }

    private ApplyTransform(): void
    {
        this.layer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
        const cell = this.snapSize * this.zoom;
        this.bgLayer.style.backgroundSize     = `${cell}px ${cell}px`;
        this.bgLayer.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
        this.RedrawWires();
    }

    SetZoom(next: number, anchorX?: number, anchorY?: number): void
    {
        const clamped = Math.min(Math.max(next, 0.25), 2.5);
        const r = this.surface.getBoundingClientRect();
        const ax = anchorX ?? r.width / 2;
        const ay = anchorY ?? r.height / 2;
        const gx = (ax - this.panX) / this.zoom;
        const gy = (ay - this.panY) / this.zoom;
        this.zoom = clamped;
        this.panX = ax - gx * this.zoom;
        this.panY = ay - gy * this.zoom;
        this.ApplyTransform();
    }

    FrameGraph(): void
    {
        if (this.nodes.size === 0) { this.panX = 0; this.panY = 0; this.zoom = 1; this.ApplyTransform(); return; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of this.nodes.values())
        {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.root.offsetWidth);
            maxY = Math.max(maxY, n.y + n.root.offsetHeight);
        }
        const r = this.surface.getBoundingClientRect();
        const pad = 90;
        const zx = (r.width  - pad * 2) / Math.max(maxX - minX, 1);
        const zy = (r.height - pad * 2) / Math.max(maxY - minY, 1);
        this.zoom = Math.min(Math.max(Math.min(zx, zy), 0.25), 1.4);
        this.panX = r.width  / 2 - ((minX + maxX) / 2) * this.zoom;
        this.panY = r.height / 2 - ((minY + maxY) / 2) * this.zoom;
        this.ApplyTransform();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Node construction
    //----------------------------------------------------------------------------------------------------------------------
    AddNode(specId: string, x: number, y: number): GraphNode | null
    {
        const spec = CatalogueIndex.get(specId);
        if (!spec) return null;

        const uid = NextUid('n');
        const params: Record<string, number> = {};
        for (const p of spec.params) params[p.key] = p.value;

        const root = this.BuildNodeElement(uid, spec, params);
        const node: GraphNode = { uid, specId, x: this.Snap(x), y: this.Snap(y), collapsed: false, muted: false, params, root };

        root.style.left = `${node.x}px`;
        root.style.top  = `${node.y}px`;
        this.layer.appendChild(root);
        this.nodes.set(uid, node);
        this.onGraphChanged?.();
        return node;
    }

    private Snap(v: number): number
    {
        return this.snapEnabled ? Math.round(v / this.snapSize) * this.snapSize : v;
    }

    private BuildNodeElement(uid: string, spec: NodeSpecification, params: Record<string, number>): HTMLElement
    {
        const root = document.createElement('div');
        root.className = 'node';
        root.dataset.uid = uid;

        const portRow = (p: { key: string; label: string; type: PortType }, side: 'in' | 'out') => `
            <div class="port ${side}" data-port="${p.key}" data-side="${side}">
                <span class="port-dot" data-type="${p.type}" data-port="${p.key}" data-side="${side}" data-uid="${uid}"></span>
                <span class="port-label">${p.label}</span>
            </div>`;

        const inputs  = spec.inputs.map((p) => portRow(p, 'in')).join('');
        const outputs = spec.outputs.map((p) => portRow(p, 'out')).join('');

        const paramRows = spec.params.map((p) =>
        {
            const frac = (params[p.key] - p.min) / (p.max - p.min);
            return `
            <div class="nparam" data-param="${p.key}">
                <span class="npl">${p.label}</span>
                <div class="npv" data-param="${p.key}" data-min="${p.min}" data-max="${p.max}"
                     data-step="${p.step}" data-suffix="${p.suffix}" data-default="${p.value}">
                    <i class="nfill" style="transform:scaleX(${frac})"></i>
                    <span>${FormatParam(params[p.key], p.step)}${p.suffix}</span>
                </div>
            </div>`;
        }).join('');

        root.innerHTML = `
            <div class="node-head">
                <div class="node-glyph">${RenderGlyph(spec.glyph)}</div>
                <div>
                    <div class="node-name">${spec.name}</div>
                    <div class="node-kind">${spec.kind}</div>
                </div>
                <div class="node-badge"></div>
            </div>
            <div class="node-divider"></div>
            <div class="node-ports">
                <div class="port-col in">
                    ${spec.inputs.length ? '<div class="port-col-label">IN</div>' : '<div class="port-col-label">IN</div>'}
                    ${inputs}
                </div>
                <div class="port-col out">
                    <div class="port-col-label">OUT</div>
                    ${outputs}
                </div>
            </div>
            ${paramRows ? `<div class="node-params">${paramRows}</div>` : ''}`;

        this.BindNode(root, uid);
        return root;
    }

    //----------------------------------------------------------------------------------------------------------------------
    private BindNode(root: HTMLElement, uid: string): void
    {
        root.addEventListener('pointerdown', (e) =>
        {
            const target = e.target as HTMLElement;
            if (target.closest('.port-dot')) return;                 // wiring handled separately
            if (target.closest('.npv'))      return;                 // parameter scrub
            e.stopPropagation();

            if (e.shiftKey || e.ctrlKey || e.metaKey)
            {
                if (this.selection.has(uid)) this.selection.delete(uid);
                else this.selection.add(uid);
            }
            else if (!this.selection.has(uid))
            {
                this.selection.clear();
                this.selection.add(uid);
            }
            this.selectedWire = null;
            this.RefreshSelection();

            this.dragMode = 'nodes';
            this.dragOrigin = this.ScreenToGraph(e.clientX, e.clientY);
            this.dragNodeStart.clear();
            for (const id of this.selection)
            {
                const n = this.nodes.get(id);
                if (n) this.dragNodeStart.set(id, { x: n.x, y: n.y });
            }
            root.classList.add('dragging');
            this.surface.setPointerCapture(e.pointerId);
        });

        // parameter scrubbing
        root.querySelectorAll<HTMLElement>('.npv').forEach((cell) =>
        {
            const min  = Number(cell.dataset.min);
            const max  = Number(cell.dataset.max);
            const step = Number(cell.dataset.step);
            const suffix = cell.dataset.suffix ?? '';
            const key    = cell.dataset.param!;
            const fill   = cell.querySelector<HTMLElement>('.nfill')!;
            const text   = cell.querySelector('span')!;
            let dragging = false;
            let lastX = 0;

            const paint = (v: number) =>
            {
                const node = this.nodes.get(uid);
                if (node) node.params[key] = v;
                fill.style.transform = `scaleX(${(v - min) / (max - min)})`;
                text.textContent = `${FormatParam(v, step)}${suffix}`;
            };

            cell.addEventListener('pointerdown', (e) =>
            {
                e.stopPropagation();
                dragging = true; lastX = e.clientX;
                cell.setPointerCapture(e.pointerId);
            });
            cell.addEventListener('pointermove', (e) =>
            {
                if (!dragging) return;
                const dx = e.clientX - lastX;
                lastX = e.clientX;
                const rate = (e.shiftKey ? 0.15 : 1) * (max - min) / 260;
                const node = this.nodes.get(uid);
                let v = (node?.params[key] ?? min) + dx * rate;
                v = Math.min(max, Math.max(min, Math.round(v / step) * step));
                paint(v);
            });
            const stop = (e: PointerEvent) =>
            {
                dragging = false;
                if (cell.hasPointerCapture(e.pointerId)) cell.releasePointerCapture(e.pointerId);
            };
            cell.addEventListener('pointerup', stop);
            cell.addEventListener('pointercancel', stop);
            cell.addEventListener('dblclick', (e) => { e.stopPropagation(); paint(Number(cell.dataset.default)); });
        });

        // port wiring
        root.querySelectorAll<HTMLElement>('.port-dot').forEach((dot) =>
        {
            dot.addEventListener('pointerdown', (e) =>
            {
                e.stopPropagation();
                const side = dot.dataset.side as 'in' | 'out';
                const port = dot.dataset.port!;
                const type = dot.dataset.type as PortType;

                // dragging from a connected input detaches that wire
                if (side === 'in')
                {
                    for (const [wid, w] of this.wires)
                    {
                        if (w.toNode === uid && w.toPort === port) { this.wires.delete(wid); break; }
                    }
                }

                this.pendingWire = { node: uid, port, type, side };
                this.dragMode = 'wire';
                dot.classList.add('live');
                this.EnsureTempPath();
                this.surface.setPointerCapture(e.pointerId);
                this.RedrawWires();
            });

            dot.addEventListener('pointerup', (e) =>
            {
                if (!this.pendingWire) return;
                e.stopPropagation();
                const side = dot.dataset.side as 'in' | 'out';
                const port = dot.dataset.port!;
                const type = dot.dataset.type as PortType;
                this.CompleteWire(uid, port, type, side);
            });
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    private CompleteWire(uid: string, port: string, type: PortType, side: 'in' | 'out'): void
    {
        const start = this.pendingWire;
        this.ClearPendingWire();
        if (!start) return;
        if (start.side === side)      return;                          // same direction
        if (start.node === uid)       return;                          // self link
        if (start.type !== type)      return;                          // type mismatch

        const from = start.side === 'out' ? start : { node: uid, port, type };
        const to   = start.side === 'out' ? { node: uid, port, type } : start;

        // an input accepts a single wire
        for (const [wid, w] of this.wires)
        {
            if (w.toNode === to.node && w.toPort === to.port) this.wires.delete(wid);
        }

        const wid = NextUid('w');
        this.wires.set(wid, {
            uid: wid, fromNode: from.node, fromPort: from.port,
            toNode: to.node, toPort: to.port, type,
        });
        this.RedrawWires();
        this.onGraphChanged?.();
    }

    private ClearPendingWire(): void
    {
        this.pendingWire = null;
        this.dragMode = 'none';
        this.layer.querySelectorAll('.port-dot.live').forEach((d) => d.classList.remove('live'));
        this.tempPath?.remove();
        this.tempPath = null;
    }

    private EnsureTempPath(): void
    {
        if (this.tempPath) return;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', 'wire-temp');
        this.wireSvg.appendChild(p);
        this.tempPath = p;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Wire geometry
    //----------------------------------------------------------------------------------------------------------------------
    private PortAnchorAt(uid: string, port: string, side: 'in' | 'out'): PortAnchor | null
    {
        const node = this.nodes.get(uid);
        if (!node) return null;
        const dot = node.root.querySelector<HTMLElement>(`.port-dot[data-port="${port}"][data-side="${side}"]`);
        const surfaceRect = this.surface.getBoundingClientRect();
        if (!dot || node.collapsed)
        {
            const r = node.root.getBoundingClientRect();
            const cy = r.top + r.height / 2 - surfaceRect.top;
            return { x: (side === 'out' ? r.right : r.left) - surfaceRect.left, y: cy };
        }
        const r = dot.getBoundingClientRect();
        return { x: r.left + r.width / 2 - surfaceRect.left, y: r.top + r.height / 2 - surfaceRect.top };
    }

    private static CurvePath(a: PortAnchor, b: PortAnchor): string
    {
        const dx = Math.max(Math.abs(b.x - a.x) * 0.55, 42);
        return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
    }

    RedrawWires(): void
    {
        const keep = new Set<string>();
        for (const w of this.wires.values())
        {
            const a = this.PortAnchorAt(w.fromNode, w.fromPort, 'out');
            const b = this.PortAnchorAt(w.toNode,   w.toPort,   'in');
            if (!a || !b) continue;
            const d = GraphSurface.CurvePath(a, b);

            let hit  = this.wireSvg.querySelector<SVGPathElement>(`path.wire-hit[data-uid="${w.uid}"]`);
            let path = this.wireSvg.querySelector<SVGPathElement>(`path.wire[data-uid="${w.uid}"]`);
            if (!path)
            {
                hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                hit.setAttribute('class', 'wire-hit');
                hit.dataset.uid = w.uid;
                hit.addEventListener('pointerdown', (e) =>
                {
                    e.stopPropagation();
                    this.selection.clear();
                    this.selectedWire = w.uid;
                    this.RefreshSelection();
                });
                this.wireSvg.appendChild(hit);

                path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('class', 'wire');
                path.dataset.uid = w.uid;
                this.wireSvg.appendChild(path);
            }
            hit!.setAttribute('d', d);
            path.setAttribute('d', d);
            path.classList.toggle('sel', this.selectedWire === w.uid);
            path.style.stroke = this.selectedWire === w.uid ? '' : WireTone(w.type);
            keep.add(w.uid);
        }

        this.wireSvg.querySelectorAll<SVGPathElement>('path[data-uid]').forEach((p) =>
        {
            if (!keep.has(p.dataset.uid!)) p.remove();
        });

        // connected-port fill state
        const filled = new Set<string>();
        for (const w of this.wires.values())
        {
            filled.add(`${w.fromNode}:${w.fromPort}:out`);
            filled.add(`${w.toNode}:${w.toPort}:in`);
        }
        this.layer.querySelectorAll<HTMLElement>('.port-dot').forEach((d) =>
        {
            const key = `${d.dataset.uid}:${d.dataset.port}:${d.dataset.side}`;
            d.classList.toggle('filled', filled.has(key));
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Surface interaction
    //----------------------------------------------------------------------------------------------------------------------
    private BindSurface(): void
    {
        this.surface.addEventListener('pointerdown', (e) =>
        {
            if (e.button === 1 || e.button === 2 || e.altKey)
            {
                this.dragMode = 'pan';
                this.dragOrigin = { x: e.clientX - this.panX, y: e.clientY - this.panY };
                this.surface.classList.add('panning');
                this.surface.setPointerCapture(e.pointerId);
                e.preventDefault();
                return;
            }
            if (e.button !== 0) return;

            this.selection.clear();
            this.selectedWire = null;
            this.RefreshSelection();

            this.dragMode = 'marquee';
            const r = this.surface.getBoundingClientRect();
            this.dragOrigin = { x: e.clientX - r.left, y: e.clientY - r.top };
            this.marquee.style.display = 'block';
            this.marquee.style.left = `${this.dragOrigin.x}px`;
            this.marquee.style.top  = `${this.dragOrigin.y}px`;
            this.marquee.style.width = '0px';
            this.marquee.style.height = '0px';
            this.surface.setPointerCapture(e.pointerId);
        });

        this.surface.addEventListener('pointermove', (e) =>
        {
            const r = this.surface.getBoundingClientRect();

            if (this.dragMode === 'pan')
            {
                this.panX = e.clientX - this.dragOrigin.x;
                this.panY = e.clientY - this.dragOrigin.y;
                this.ApplyTransform();
            }
            else if (this.dragMode === 'nodes')
            {
                const now = this.ScreenToGraph(e.clientX, e.clientY);
                const dx = now.x - this.dragOrigin.x;
                const dy = now.y - this.dragOrigin.y;
                for (const [id, origin] of this.dragNodeStart)
                {
                    const n = this.nodes.get(id);
                    if (!n) continue;
                    n.x = this.Snap(origin.x + dx);
                    n.y = this.Snap(origin.y + dy);
                    n.root.style.left = `${n.x}px`;
                    n.root.style.top  = `${n.y}px`;
                }
                this.RedrawWires();
                this.onSelectionChanged?.();
            }
            else if (this.dragMode === 'marquee')
            {
                const cx = e.clientX - r.left;
                const cy = e.clientY - r.top;
                const x = Math.min(cx, this.dragOrigin.x);
                const y = Math.min(cy, this.dragOrigin.y);
                const w = Math.abs(cx - this.dragOrigin.x);
                const h = Math.abs(cy - this.dragOrigin.y);
                this.marquee.style.left = `${x}px`;
                this.marquee.style.top  = `${y}px`;
                this.marquee.style.width  = `${w}px`;
                this.marquee.style.height = `${h}px`;

                this.selection.clear();
                for (const n of this.nodes.values())
                {
                    const nr = n.root.getBoundingClientRect();
                    const nx = nr.left - r.left;
                    const ny = nr.top  - r.top;
                    if (nx < x + w && nx + nr.width > x && ny < y + h && ny + nr.height > y) this.selection.add(n.uid);
                }
                this.RefreshSelection();
            }
            else if (this.dragMode === 'wire' && this.pendingWire && this.tempPath)
            {
                const anchor = this.PortAnchorAt(this.pendingWire.node, this.pendingWire.port, this.pendingWire.side);
                if (anchor)
                {
                    const cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
                    const d = this.pendingWire.side === 'out'
                        ? GraphSurface.CurvePath(anchor, cursor)
                        : GraphSurface.CurvePath(cursor, anchor);
                    this.tempPath.setAttribute('d', d);
                    this.tempPath.style.stroke = WireTone(this.pendingWire.type);
                }
            }
        });

        const finish = (e: PointerEvent) =>
        {
            if (this.dragMode === 'wire') this.ClearPendingWire();
            this.layer.querySelectorAll('.node.dragging').forEach((n) => n.classList.remove('dragging'));
            this.marquee.style.display = 'none';
            this.surface.classList.remove('panning');
            if (this.dragMode !== 'none') this.onSelectionChanged?.();
            this.dragMode = 'none';
            if (this.surface.hasPointerCapture(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
        };
        this.surface.addEventListener('pointerup', finish);
        this.surface.addEventListener('pointercancel', finish);

        this.surface.addEventListener('wheel', (e) =>
        {
            e.preventDefault();
            const r = this.surface.getBoundingClientRect();
            if (e.ctrlKey || e.metaKey || !e.shiftKey)
            {
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
                this.SetZoom(this.zoom * factor, e.clientX - r.left, e.clientY - r.top);
            }
            else
            {
                this.panX -= e.deltaX;
                this.panY -= e.deltaY;
                this.ApplyTransform();
            }
        }, { passive: false });
    }

    //----------------------------------------------------------------------------------------------------------------------
    RefreshSelection(): void
    {
        for (const n of this.nodes.values()) n.root.classList.toggle('sel', this.selection.has(n.uid));
        this.wireSvg.querySelectorAll<SVGPathElement>('path.wire').forEach((p) =>
            p.classList.toggle('sel', this.selectedWire === p.dataset.uid));
        this.onSelectionChanged?.();
    }

    SelectionBounds(): DOMRect | null
    {
        if (this.selection.size === 0) return null;
        const r = this.surface.getBoundingClientRect();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of this.selection)
        {
            const n = this.nodes.get(id);
            if (!n) continue;
            const nr = n.root.getBoundingClientRect();
            minX = Math.min(minX, nr.left - r.left);
            minY = Math.min(minY, nr.top  - r.top);
            maxX = Math.max(maxX, nr.right  - r.left);
            maxY = Math.max(maxY, nr.bottom - r.top);
        }
        return new DOMRect(minX, minY, maxX - minX, maxY - minY);
    }

    //----------------------------------------------------------------------------------------------------------------------
    DeleteSelection(): void
    {
        if (this.selectedWire)
        {
            this.wires.delete(this.selectedWire);
            this.selectedWire = null;
        }
        for (const id of this.selection)
        {
            const n = this.nodes.get(id);
            if (!n) continue;
            n.root.remove();
            this.nodes.delete(id);
            for (const [wid, w] of this.wires)
            {
                if (w.fromNode === id || w.toNode === id) this.wires.delete(wid);
            }
        }
        this.selection.clear();
        this.RedrawWires();
        this.RefreshSelection();
        this.onGraphChanged?.();
    }

    DuplicateSelection(): void
    {
        const fresh: string[] = [];
        for (const id of [...this.selection])
        {
            const n = this.nodes.get(id);
            if (!n) continue;
            const copy = this.AddNode(n.specId, n.x + 40, n.y + 40);
            if (copy) { Object.assign(copy.params, n.params); fresh.push(copy.uid); }
        }
        this.selection.clear();
        for (const id of fresh) this.selection.add(id);
        this.RefreshSelection();
    }

    ToggleCollapse(): void
    {
        for (const id of this.selection)
        {
            const n = this.nodes.get(id);
            if (!n) continue;
            n.collapsed = !n.collapsed;
            n.root.classList.toggle('collapsed', n.collapsed);
        }
        this.RedrawWires();
    }

    ToggleMute(): void
    {
        for (const id of this.selection)
        {
            const n = this.nodes.get(id);
            if (!n) continue;
            n.muted = !n.muted;
            n.root.classList.toggle('muted', n.muted);
            const badge = n.root.querySelector('.node-badge');
            badge?.classList.toggle('off', n.muted);
        }
    }

    SetBackground(mode: 'dots' | 'lines' | 'blank'): void
    {
        this.bgLayer.className = `graph-background ${mode}`;
        this.ApplyTransform();
    }

    Hydrate(): void { HydrateGlyphs(this.layer); }
}

//--------------------------------------------------------------------------------------------------------------------------
function WireTone(type: PortType): string
{
    switch (type)
    {
        case 'field':  return '#4b52a8';
        case 'vector': return '#8a6320';
        case 'colour': return '#2c7a46';
        case 'flow':   return '#5a5a5a';
        default:       return '#4a4a4a';
    }
}

export function FormatParam(v: number, step: number): string
{
    const decimals = (String(step).split('.')[1] ?? '').length;
    return v.toFixed(decimals);
}

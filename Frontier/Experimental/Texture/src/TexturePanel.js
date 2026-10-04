//============================================================================================================================================
// 🎨 TexturePanel.js — the editor shell: layer stack, material library, inspector, viewport interaction and transport
//============================================================================================================================================
// The panel owns the project record and drives four collaborators: SurfaceStructure (geometry, BVH, occlusion),
// ShadingIntegrator (every GPU pass), StrokeProjection (pointer → surface) and RevisionQueue (undo). Nothing in here
// touches WebGL directly; nothing in the integrator knows about the DOM.
//============================================================================================================================================

import { ShadingIntegrator, ProbeAcceleration, DeviceReport } from "./ShadingIntegrator.js";
import { OrbitProjection } from "./OrbitProjection.js";
import { StrokeProjection, ToolOrdering, SymmetryOrdering, MirrorVector } from "./StrokeProjection.js";
import { BuildSurface, SurfaceIndex, BakeOcclusion, ParseWavefront } from "./SurfaceStructure.js";
import { RevisionQueue } from "./RevisionQueue.js";
import { DocumentSequence } from "./DocumentSequence.js";
import { EmitTextureSet, EmitProject } from "./ExportSequence.js";
import {
    ChannelSpecification,
    ChannelByIdentifier,
    BlendOrdering,
    ResolutionOrdering,
    DisplayOrdering,
    DisplayIndex,
    ExportOrdering,
} from "./ChannelSpecification.js";
import {
    MaterialLibrary,
    MaterialCategories,
    MaterialByIdentifier,
    SurfaceControls,
    EnvironmentOrdering,
} from "./MaterialSpecification.js";
import { GeneratorOrdering, GeneratorByIdentifier, GeneratorControls, NormaliseGenerator } from "./GeneratorSpecification.js";
import {
    CreateLayer,
    CloneLayer,
    ExpandMaterial,
    DefaultProject,
    DefaultStack,
    SanitiseProject,
    SurfaceOrdering,
    LayerKindByIdentifier,
    LayerBadge,
    LayerSummary,
    LayerChannelCount,
} from "./LayerSpecification.js";
import { DecalLibrary, DecalCategories, FontArchive, RasteriseDecal, SanitiseMarkup } from "./DecalSpecification.js";

//--------------------------------------------------------------------------------------------------------------------------
// Document helpers.
//--------------------------------------------------------------------------------------------------------------------------
const Select = (Selector) => document.querySelector(Selector);
const SelectAll = (Selector) => [...document.querySelectorAll(Selector)];
const Escape = (Text) =>
    String(Text).replace(
        /[&<>"']/g,
        (Character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[Character],
    );

const GlyphPaths = {
    layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>',
    brush: '<path d="m14 3 7 7-10 10H4v-7Zm-6 7 7 7M3 21h7"/>',
    eraser: '<path d="M8 20H4l-1-5L14 4l6 6-9 9Zm3-13 6 6"/>',
    fill: '<path d="m5 12 7-7 7 7-7 7Zm14 2c2 3 2 5 0 5s-2-2 0-5Z"/>',
    decal: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 15 5-4 4 3 4-4 5 4"/><circle cx="9" cy="9" r="1.4"/>',
    noise: '<path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6"/><path d="M3 7h2m4 12h2m6-14h2" opacity="0.6"/>',
    picker: '<path d="m15 3 6 6-9 9-6 1 1-6Zm-4 4 6 6"/>',
    orbit: '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    folder: '<path d="M3 6h7l2 3h9l-2 11H3V6Zm0 3h18"/>',
    file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 13h8m-8 4h6"/>',
    link: '<path d="m10 14 4-4m-6 2-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-10 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>',
    box: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10L3 7m9 5 9-5m-9 5v10M7 4.5 17 10"/>',
    focus: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
    maximize: '<path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7M16 3h5v5m0-5-7 7M8 21H3v-5m0 5 7-7"/>',
    rotate: '<path d="M4 10a8 8 0 1 1 1 7M4 3v7h7"/>',
    warning: '<path d="m12 3 10 18H2Zm0 6v5m0 3h.01"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3m0 3h.01"/>',
    eye: '<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="m3 3 18 18M9 5c5-2 10 1 13 7l-4 5M6 6l-4 6c3 6 8 9 14 6"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 16H3V3h13v2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    mask: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none"/>',
    text: '<path d="M4 6V4h16v2M12 4v16M8 20h8"/>',
    vector: '<path d="M5 19 19 5M5 5h4v4H5Zm10 10h4v4h-4Z"/>',
    sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    cylinder: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5"/>',
    plane: '<path d="M2 17 12 7l10 10Z"/>',
    torus: '<ellipse cx="12" cy="12" rx="10" ry="6"/><ellipse cx="12" cy="12" rx="3.6" ry="2"/>',
    shaderball: '<circle cx="12" cy="9.5" r="6"/><path d="M3 19c3-3 15-3 18 0"/><path d="M4 19h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.6 0 1.6-2 .6-3s-.4-2 .9-2H17a4 4 0 0 0 4-4c0-5-4-9-9-9Z"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/>',
    wand: '<path d="m4 20 10-10m0 0 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/>',
    viewport: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>',
    mirror: '<path d="M12 3v18M7 7 3 12l4 5Zm10 0 4 5-4 5Z"/>',
    undo: '<path d="M4 10h11a5 5 0 0 1 0 10H9M4 10l5-5M4 10l5 5"/>',
    redo: '<path d="M20 10H9a5 5 0 0 0 0 10h6M20 10l-5-5m5 5-5 5"/>',
    check: '<path d="m5 13 5 5L20 6"/>',
};

const Icon = (Name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${GlyphPaths[Name] || GlyphPaths.box}</svg>`;

const FillIcons = (Root = document) =>
    [...Root.querySelectorAll("[data-icon]")].forEach((Element) =>
    {
        Element.innerHTML = Icon(Element.dataset.icon);
    });

const Clamp = (Value, Minimum, Maximum) => Math.min(Maximum, Math.max(Minimum, Value));
const Fixed = (Value, Step) => Number(Value).toFixed(Step >= 1 ? 0 : Step >= 0.1 ? 1 : Step >= 0.01 ? 2 : 3);
const ToHex = (Colour) =>
    `#${Colour.map((Component) => Math.round(Clamp(Component, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
const FromHex = (Hex) =>
{
    const Match = /^#?([0-9a-f]{6})$/i.exec(Hex.trim());
    if (!Match) return [1, 1, 1];
    const Value = Number.parseInt(Match[1], 16);
    return [((Value >> 16) & 255) / 255, ((Value >> 8) & 255) / 255, (Value & 255) / 255];
};

//--------------------------------------------------------------------------------------------------------------------------
// Inspector control builders — declarative rows bound by a dotted path into the project record.
//--------------------------------------------------------------------------------------------------------------------------
const SliderRow = ({ Label, Path, Value, Minimum, Maximum, Step, Unit, Hint }) =>
{
    const Fraction = (Clamp(Value, Minimum, Maximum) - Minimum) / Math.max(Maximum - Minimum, 1e-9);
    return `
    <div class="property-row slider-row">
        <label class="property-label" for="control-${CSS.escape(Path)}">${Escape(Label)}</label>
        <div class="slider-control">
            <input id="control-${CSS.escape(Path)}" type="range" data-bind="${Path}" min="${Minimum}" max="${Maximum}"
                   step="${Step}" value="${Value}" style="--fraction:${Fraction.toFixed(4)}" />
            <span class="value-pill">
                <input type="number" data-bind="${Path}" data-pill="1" min="${Minimum}" max="${Maximum}" step="${Step}"
                       value="${Fixed(Value, Step)}" aria-label="${Escape(Label)} value" />
                <span class="unit-cell">${Escape(Unit || "—")}</span>
            </span>
        </div>
        ${Hint ? `<p class="property-hint">${Escape(Hint)}</p>` : ""}
    </div>`;
};

const ToggleRow = ({ Label, Path, Value, Hint }) => `
    <div class="property-row toggle-row">
        <span class="property-label">${Escape(Label)}</span>
        <label class="switch"><input type="checkbox" data-bind="${Path}" ${Value ? "checked" : ""}
               aria-label="${Escape(Label)}" /><span></span></label>
        ${Hint ? `<p class="property-hint">${Escape(Hint)}</p>` : ""}
    </div>`;

const SelectRow = ({ Label, Path, Value, Options, Hint }) => `
    <div class="property-row select-row">
        <label class="property-label">${Escape(Label)}</label>
        <select data-bind="${Path}">
            ${Options.map(
                (Option) =>
                    `<option value="${Escape(Option.Value)}" ${Option.Value === Value ? "selected" : ""}>${Escape(Option.Label)}</option>`,
            ).join("")}
        </select>
        ${Hint ? `<p class="property-hint">${Escape(Hint)}</p>` : ""}
    </div>`;

const ColourRow = ({ Label, Path, Value, Hint }) => `
    <div class="property-row colour-row">
        <span class="property-label">${Escape(Label)}</span>
        <label class="colour-field">
            <input type="color" data-bind="${Path}" data-colour="1" value="${ToHex(Value)}" aria-label="${Escape(Label)}" />
            <span class="colour-code">${ToHex(Value).toUpperCase()}</span>
        </label>
        ${Hint ? `<p class="property-hint">${Escape(Hint)}</p>` : ""}
    </div>`;

const ActionRow = (Actions) => `
    <div class="property-row action-row">
        ${Actions.map(
            (Action) =>
                `<button class="button" data-action="${Action.Action}" ${Action.Argument ? `data-argument="${Escape(Action.Argument)}"` : ""}>
                    ${Action.Glyph ? Icon(Action.Glyph) : ""}${Escape(Action.Label)}
                 </button>`,
        ).join("")}
    </div>`;

const Group = ({ Title, Badge, Body, Open = true }) => `
    <details class="property-group" ${Open ? "open" : ""}>
        <summary>${Escape(Title)}${Badge ? `<span class="section-badge">${Escape(Badge)}</span>` : ""}</summary>
        <div class="group-content">${Body}</div>
    </details>`;

//--------------------------------------------------------------------------------------------------------------------------
// The panel.
//--------------------------------------------------------------------------------------------------------------------------
class TexturePanel
{
    constructor()
    {
        FillIcons();
        this.Project = DefaultProject();
        this.Project.Layers = DefaultStack();
        this.Project.Selection = this.Project.Layers[this.Project.Layers.length - 1].Identifier;
        this.Camera = new OrbitProjection();
        this.Projection = new StrokeProjection();
        this.Revisions = new RevisionQueue();
        this.Canvas = Select("#surface-canvas");
        this.Integrator = new ShadingIntegrator(this.Canvas);
        this.BrushColour = [0.86, 0.32, 0.2];
        this.Tool = "brush";
        this.InspectorTab = "layer";
        this.LayerFilter = "all";
        this.LayerQuery = "";
        this.MaterialFilter = "all";
        this.MaterialQuery = "";
        this.DecalCategory = "all";
        this.ViewMode = "surface";
        this.Display = "material";
        this.PlaneZoom = 0.82;
        this.PlanePan = [0, 0];
        this.Dirty = false;
        this.Pending = false;
        this.Cursor = null;
        this.PlaneCursor = null;
        this.Frames = 0;
        this.FramesPerSecond = 0;
        this.LastTime = performance.now();
        this.LastSample = performance.now();
        this.Maximised = false;
        this.Compact = false;
        this.Status = "Initialising";
        this.RecoveryTimer = 0;
        this.RecoveryAttempts = 0;

        this.BindRecovery();
        if (!this.Integrator.Ready)
        {
            this.ReportFailure(this.Integrator);
            return;
        }
        this.Commence();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Everything past a working device. Kept apart from the constructor so a retry after a failed context can run it.
    //----------------------------------------------------------------------------------------------------------------------
    Commence()
    {
        if (this.Commenced) return;
        this.Commenced = true;
        this.Documents = new DocumentSequence(this, Icon);
        this.BindHeader();
        this.BindStack();
        this.BindLibrary();
        this.BindViewport();
        this.BindTransport();
        this.BindInspector();
        this.BindDialogs();
        this.BindKeyboard();
        this.Integrator.Configure(this.Project.Resolution);
        this.RebuildSurface(true);
        this.RenderStack();
        this.RenderLibrary();
        this.RenderInspector();
        this.RenderChannelStrip();
        this.Advance();
        this.SetStatus("Ready", "ready");
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Selection helpers.
    //----------------------------------------------------------------------------------------------------------------------
    get Layers()
    {
        return this.Project.Layers;
    }

    get ActiveLayer()
    {
        return this.Layers.find((Layer) => Layer.Identifier === this.Project.Selection) || this.Layers[this.Layers.length - 1];
    }

    LayerIndex(Identifier)
    {
        return this.Layers.findIndex((Layer) => Layer.Identifier === Identifier);
    }

    SelectLayer(Identifier)
    {
        if (this.Project.Selection === Identifier) return;
        this.Project.Selection = Identifier;
        this.RenderStack();
        this.RenderInspector();
        this.RenderChannelStrip();
        this.UpdateCaption();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Surface construction, occlusion bake and compositing.
    //----------------------------------------------------------------------------------------------------------------------
    RebuildSurface(Initial = false)
    {
        const Descriptor = this.Project.Surface;
        this.SetStatus(`Building ${Descriptor.Kind}`, "busy");
        this.SurfaceRecord =
            Descriptor.Kind === "custom" && this.ImportedSurface
                ? this.ImportedSurface
                : BuildSurface(Descriptor.Kind, Descriptor.Subdivision);
        this.Index = new SurfaceIndex(this.SurfaceRecord);
        this.Integrator.SetSurface(this.SurfaceRecord);
        if (Initial) this.Camera.Frame(this.SurfaceRecord.Bounds.Radius, this.SurfaceRecord.Bounds.Centre);
        this.ScheduleOcclusion();
        this.InvalidateDecals();
        this.Recomposite();
        this.UpdateStatusBar();
    }

    ScheduleOcclusion()
    {
        if (this.OcclusionTimer) clearTimeout(this.OcclusionTimer);
        this.OcclusionTimer = setTimeout(() =>
        {
            const Started = performance.now();
            BakeOcclusion(this.SurfaceRecord, this.Index, 24);
            this.Integrator.UploadOcclusion();
            this.Recomposite();
            this.OcclusionMilliseconds = Math.round(performance.now() - Started);
            this.SetStatus("Ready", "ready");
            this.UpdateStatusBar();
        }, 40);
    }

    Recomposite()
    {
        if (!this.Integrator.Ready) return;
        for (const Layer of this.Layers)
        {
            if (Layer.Kind === "stroke") this.Integrator.EnsureCoverage(Layer);
            if (Layer.Mask.Kind === "stroke") this.Integrator.EnsureMask(Layer);
        }
        this.Integrator.Composite(this.Layers, this.Project.Material);
    }

    MarkDirty()
    {
        this.Dirty = true;
        Select("#dirty-indicator").classList.remove("clean");
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Header, document bar and export.
    //----------------------------------------------------------------------------------------------------------------------
    BindHeader()
    {
        Select("#document-name").addEventListener("input", (Event) =>
        {
            this.Project.Name = Event.target.value.slice(0, 64);
            this.Documents.Synchronise(this.Project.Name || "Untitled");
            this.MarkDirty();
        });
        Select("#export-button").addEventListener("click", () => this.OpenExport());
        Select("#import-button").addEventListener("click", () => Select("#import-file").click());
        Select("#import-file").addEventListener("change", (Event) => this.ImportProject(Event.target.files?.[0]));
        Select("#help-button").addEventListener("click", () => Select("#help-dialog").showModal());
        Select("#workspace-button").addEventListener("click", () => this.FocusPane("workspace"));
        Select("#library-button").addEventListener("click", () => this.FocusPane("library"));
    }

    FocusPane(Pane)
    {
        Select("#workspace-button").classList.toggle("active", Pane === "workspace");
        Select("#library-button").classList.toggle("active", Pane === "library");
        Select(".left-panel").classList.toggle("library-focus", Pane === "library");
        if (Pane === "library") Select("#material-search").focus();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Layer stack.
    //----------------------------------------------------------------------------------------------------------------------
    BindStack()
    {
        Select("#layer-search").addEventListener("input", (Event) =>
        {
            this.LayerQuery = Event.target.value.trim().toLowerCase();
            this.RenderStack();
        });
        Select("#layer-filters").addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-layer-filter]");
            if (!Button) return;
            this.LayerFilter = Button.dataset.layerFilter;
            this.RenderStack();
        });
        Select("#collection-toggle").addEventListener("click", (Event) =>
        {
            const Expanded = Event.currentTarget.getAttribute("aria-expanded") === "true";
            Event.currentTarget.setAttribute("aria-expanded", String(!Expanded));
            Select("#layer-stack").hidden = Expanded;
        });
        Select("#compact-outliner").addEventListener("click", (Event) =>
        {
            this.Compact = !this.Compact;
            Event.currentTarget.setAttribute("aria-pressed", String(this.Compact));
            Select(".left-panel").classList.toggle("compact-outliner", this.Compact);
        });
        Select("#add-button").addEventListener("click", (Event) =>
        {
            Event.stopPropagation();
            const Menu = Select("#add-menu");
            const Hidden = Menu.hidden;
            Menu.hidden = !Hidden;
            Select("#add-button").setAttribute("aria-expanded", String(Hidden));
            if (Hidden)
            {
                const Anchor = Event.currentTarget.getBoundingClientRect();
                Menu.style.left = `${Math.round(Anchor.left - 12)}px`;
                Menu.style.top = `${Math.round(Anchor.bottom + 8)}px`;
            }
        });
        Select("#add-menu").addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-add]");
            if (!Button) return;
            Select("#add-menu").hidden = true;
            Select("#add-button").setAttribute("aria-expanded", "false");
            this.AddLayer(Button.dataset.add);
        });
        document.addEventListener("click", (Event) =>
        {
            if (!Event.target.closest("#add-menu") && !Event.target.closest("#add-button"))
            {
                Select("#add-menu").hidden = true;
                Select("#add-button").setAttribute("aria-expanded", "false");
            }
        });
        Select("#layer-stack").addEventListener("click", (Event) =>
        {
            const Toggle = Event.target.closest("[data-toggle-layer]");
            if (Toggle)
            {
                const Layer = this.Layers.find((Entry) => Entry.Identifier === Toggle.dataset.toggleLayer);
                this.CaptureStack(() => (Layer.Visible = !Layer.Visible));
                return;
            }
            const Row = Event.target.closest("[data-layer]");
            if (Row) this.SelectLayer(Row.dataset.layer);
        });
        Select("#layer-stack").addEventListener("keydown", (Event) =>
        {
            const Row = Event.target.closest("[data-layer]");
            if (!Row) return;
            if (Event.key === "Enter" || Event.key === " ")
            {
                Event.preventDefault();
                this.SelectLayer(Row.dataset.layer);
            }
        });
        // Reordering by drag.
        const Stack = Select("#layer-stack");
        Stack.addEventListener("dragstart", (Event) =>
        {
            const Row = Event.target.closest("[data-layer]");
            if (!Row) return;
            this.DragIdentifier = Row.dataset.layer;
            Event.dataTransfer.effectAllowed = "move";
            Row.classList.add("dragging");
        });
        Stack.addEventListener("dragover", (Event) =>
        {
            Event.preventDefault();
            const Row = Event.target.closest("[data-layer]");
            SelectAll(".scene-row.drop-target").forEach((Element) => Element.classList.remove("drop-target"));
            if (Row && Row.dataset.layer !== this.DragIdentifier) Row.classList.add("drop-target");
        });
        Stack.addEventListener("drop", (Event) =>
        {
            Event.preventDefault();
            const Row = Event.target.closest("[data-layer]");
            SelectAll(".scene-row.drop-target").forEach((Element) => Element.classList.remove("drop-target"));
            if (!Row || !this.DragIdentifier) return;
            this.MoveLayer(this.DragIdentifier, Row.dataset.layer);
            this.DragIdentifier = "";
        });
        Stack.addEventListener("dragend", () =>
        {
            SelectAll(".scene-row.dragging").forEach((Element) => Element.classList.remove("dragging"));
            SelectAll(".scene-row.drop-target").forEach((Element) => Element.classList.remove("drop-target"));
        });
    }

    VisibleLayers()
    {
        return [...this.Layers]
            .reverse()
            .filter((Layer) =>
            {
                if (this.LayerFilter !== "all" && Layer.Kind !== this.LayerFilter) return false;
                if (!this.LayerQuery) return true;
                return `${Layer.Name} ${Layer.Kind} ${LayerBadge(Layer)}`.toLowerCase().includes(this.LayerQuery);
            });
    }

    RenderStack()
    {
        const Rows = this.VisibleLayers();
        const Visible = this.Layers.filter((Layer) => Layer.Visible).length;
        Select("#layer-count").textContent = String(this.Layers.length);
        Select("#visible-count").textContent = String(Visible);
        Select("#hidden-count").textContent = String(this.Layers.length - Visible);
        SelectAll("#layer-filters button").forEach((Button) =>
        {
            const Active = Button.dataset.layerFilter === this.LayerFilter;
            Button.classList.toggle("active", Active);
            Button.setAttribute("aria-pressed", String(Active));
        });
        Select("#layer-stack").innerHTML = Rows.length
            ? Rows.map((Layer) =>
              {
                  const Kind = LayerKindByIdentifier[Layer.Kind];
                  const Selected = Layer.Identifier === this.Project.Selection;
                  return `
                <div class="scene-row ${Selected ? "selected" : ""} ${Layer.Visible ? "" : "muted"}"
                     data-layer="${Layer.Identifier}" data-object="${Layer.Kind}" draggable="true"
                     role="treeitem" aria-selected="${Selected}" tabindex="0">
                    <span class="row-chevron"></span>
                    <span class="row-icon">${Icon(Kind.Glyph)}</span>
                    <span class="scene-label">${Escape(Layer.Name)}
                        <small>${Escape(LayerSummary(Layer))}</small>
                    </span>
                    <span class="row-badge">${LayerBadge(Layer)}</span>
                    ${Layer.Mask.Kind !== "none" ? `<span class="row-mask" title="Masked">${Icon("mask")}</span>` : ""}
                    <button class="icon-button row-toggle" data-toggle-layer="${Layer.Identifier}"
                            aria-label="${Layer.Visible ? "Hide" : "Show"} ${Escape(Layer.Name)}"
                            title="${Layer.Visible ? "Hide" : "Show"} layer">${Icon(Layer.Visible ? "eye" : "hidden")}</button>
                </div>`;
              }).join("")
            : `<div class="outliner-empty">No layers match that filter.</div>`;
        Select("#stack-subtitle").textContent = `${this.Layers.length} layer${this.Layers.length === 1 ? "" : "s"} · top of stack first`;
    }

    CaptureStack(Mutate)
    {
        const Before = structuredClone(this.StackRecord());
        Mutate();
        const After = structuredClone(this.StackRecord());
        this.Revisions.Record({ Kind: "stack", Before, After });
        this.AfterStackChange();
    }

    StackRecord()
    {
        return { Layers: this.Layers, Selection: this.Project.Selection, Material: this.Project.Material };
    }

    ApplyStackRecord(Record)
    {
        this.Project.Layers = structuredClone(Record.Layers);
        this.Project.Selection = Record.Selection;
        this.Project.Material = structuredClone(Record.Material);
        this.AfterStackChange();
    }

    AfterStackChange()
    {
        this.MarkDirty();
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
        this.RenderChannelStrip();
        this.UpdateCaption();
        this.UpdateStatusBar();
    }

    AddLayer(Kind)
    {
        const Descriptor = {
            fill: () => CreateLayer("fill", { Name: "Fill" }),
            stroke: () => CreateLayer("stroke", { Name: "Hand painted", Channels: { base_color: [...this.BrushColour] } }),
            generator: () => CreateLayer("generator", { Name: "Generator" }),
            svg: () =>
                CreateLayer("decal", {
                    Name: "SVG decal",
                    Decal: { SourceKind: "svg", Library: "hazard" },
                    Channels: { base_color: [0.92, 0.9, 0.2], specular_roughness: 0.34, height: 0.58 },
                }),
            text: () =>
                CreateLayer("decal", {
                    Name: "Text decal",
                    Decal: { SourceKind: "text" },
                    Channels: { base_color: [0.95, 0.95, 0.96], specular_roughness: 0.28, height: 0.58 },
                }),
        };
        const Factory = Descriptor[Kind] || Descriptor.fill;
        const Layer = Factory();
        const Index = this.LayerIndex(this.Project.Selection);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Layer);
            this.Project.Selection = Layer.Identifier;
        });
        if (Layer.Kind === "decal") this.RefreshDecal(Layer);
        if (Layer.Kind === "stroke") this.Integrator.EnsureCoverage(Layer);
        this.Notify(`${Layer.Name} added above ${Index >= 0 ? this.Layers[Index]?.Name || "the stack" : "the stack"}.`);
    }

    MoveLayer(Identifier, TargetIdentifier)
    {
        const From = this.LayerIndex(Identifier);
        const To = this.LayerIndex(TargetIdentifier);
        if (From < 0 || To < 0 || From === To) return;
        this.CaptureStack(() =>
        {
            const [Layer] = this.Project.Layers.splice(From, 1);
            this.Project.Layers.splice(To, 0, Layer);
            this.Project.Selection = Identifier;
        });
    }

    ShiftLayer(Delta)
    {
        const Index = this.LayerIndex(this.Project.Selection);
        const Target = Index + Delta;
        if (Index < 0 || Target < 0 || Target >= this.Layers.length) return;
        this.CaptureStack(() =>
        {
            const [Layer] = this.Project.Layers.splice(Index, 1);
            this.Project.Layers.splice(Target, 0, Layer);
        });
    }

    DuplicateLayer()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Copy = CloneLayer(Layer);
        const Index = this.LayerIndex(Layer.Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Copy);
            this.Project.Selection = Copy.Identifier;
        });
        if (Copy.Kind === "decal") this.RefreshDecal(Copy);
        this.Notify(`${Layer.Name} duplicated.`);
    }

    RemoveLayer()
    {
        if (this.Layers.length <= 1)
        {
            this.Notify("A stack keeps at least one layer.");
            return;
        }
        const Layer = this.ActiveLayer;
        const Index = this.LayerIndex(Layer.Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index, 1);
            this.Project.Selection = this.Layers[Math.max(0, Index - 1)].Identifier;
        });
        this.Integrator.ReleaseLayer(Layer.Identifier);
        this.Notify(`${Layer.Name} removed.`);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Material library.
    //----------------------------------------------------------------------------------------------------------------------
    BindLibrary()
    {
        Select("#material-filters").innerHTML = MaterialCategories.map(
            (Category) =>
                `<button data-filter="${Category.Identifier}" class="${Category.Identifier === this.MaterialFilter ? "active" : ""}">${Escape(Category.Label)}</button>`,
        ).join("");
        Select("#material-search").addEventListener("input", (Event) =>
        {
            this.MaterialQuery = Event.target.value.trim().toLowerCase();
            this.RenderLibrary();
        });
        Select("#material-filters").addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-filter]");
            if (!Button) return;
            this.MaterialFilter = Button.dataset.filter;
            this.RenderLibrary();
        });
        Select("#material-list").addEventListener("click", (Event) =>
        {
            const Card = Event.target.closest("[data-material]");
            if (!Card) return;
            this.ApplyMaterial(Card.dataset.material);
        });
        Select("#reset-search").addEventListener("click", () =>
        {
            Select("#material-search").value = "";
            this.MaterialQuery = "";
            this.RenderLibrary();
        });
    }

    RenderLibrary()
    {
        const Entries = MaterialLibrary.filter((Material) =>
        {
            if (this.MaterialFilter !== "all" && Material.Category !== this.MaterialFilter) return false;
            if (!this.MaterialQuery) return true;
            return `${Material.Label} ${Material.Note} ${Material.Category}`.toLowerCase().includes(this.MaterialQuery);
        });
        Select("#material-count").textContent = String(Entries.length);
        SelectAll("#material-filters button").forEach((Button) =>
            Button.classList.toggle("active", Button.dataset.filter === this.MaterialFilter),
        );
        Select("#material-list").innerHTML = Entries.map(
            (Material) => `
            <button class="preset-card" data-material="${Material.Identifier}" data-category="${Material.Category}">
                <span class="preset-swatch" style="--swatch:${Material.Swatch}">${Icon(Material.Modifier ? "wand" : "palette")}</span>
                <span class="preset-copy">
                    <strong>${Escape(Material.Label)}</strong>
                    <small>${Escape(Material.Note)}</small>
                </span>
                <span class="preset-arrow">${Icon("plus")}</span>
            </button>`,
        ).join("");
        Select("#empty-materials").hidden = Entries.length > 0;
    }

    ApplyMaterial(Identifier)
    {
        const Material = MaterialByIdentifier[Identifier];
        if (!Material) return;
        const Added = ExpandMaterial(Material);
        this.CaptureStack(() =>
        {
            if (!Material.Modifier)
            {
                // A full material replaces the stack below the painted layers, keeping hand work on top.
                const Painted = this.Project.Layers.filter((Layer) => Layer.Kind === "stroke" || Layer.Kind === "decal");
                this.Project.Layers = [...Added, ...Painted];
            }
            else this.Project.Layers.push(...Added);
            if (Material.Surface) Object.assign(this.Project.Material, Material.Surface);
            this.Project.Selection = Added[Added.length - 1].Identifier;
        });
        this.Notify(`${Material.Label} · ${Added.length} layer${Added.length === 1 ? "" : "s"} applied.`);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Viewport interaction.
    //----------------------------------------------------------------------------------------------------------------------
    //----------------------------------------------------------------------------------------------------------------------
    // Pointer wiring lives on the canvas element itself, so it is re-applied on its own whenever the canvas is replaced
    // after a lost or refused context. The rest of the viewport chrome is bound once and stays bound.
    //----------------------------------------------------------------------------------------------------------------------
    BindSurfacePointers()
    {
        const Canvas = this.Canvas;
        Canvas.addEventListener("contextmenu", (Event) => Event.preventDefault());
        Canvas.addEventListener("pointerdown", (Event) => this.OnPointerDown(Event));
        Canvas.addEventListener("pointermove", (Event) => this.OnPointerMove(Event));
        Canvas.addEventListener("pointerup", (Event) => this.OnPointerUp(Event));
        Canvas.addEventListener("pointercancel", (Event) => this.OnPointerUp(Event));
        Canvas.addEventListener("pointerleave", () =>
        {
            this.Cursor = null;
            this.PlaneCursor = null;
        });
        Canvas.addEventListener(
            "wheel",
            (Event) =>
            {
                Event.preventDefault();
                if (Event.altKey || Event.metaKey)
                {
                    const Step = Event.deltaY < 0 ? 1.08 : 0.926;
                    this.Projection.Configure({ Radius: Clamp(this.Projection.Brush.Radius * Step, 0.004, 1.2) });
                    this.SyncBrushControls();
                    return;
                }
                if (this.ViewMode === "plane")
                {
                    this.PlaneZoom = Clamp(this.PlaneZoom * (Event.deltaY < 0 ? 1.1 : 0.9), 0.12, 24);
                    return;
                }
                this.Camera.Zoom(Event.deltaY);
            },
            { passive: false },
        );
    }

    BindViewport()
    {
        this.BindSurfacePointers();
        SelectAll("[data-tool]").forEach((Button) =>
            Button.addEventListener("click", () => this.SetTool(Button.dataset.tool)),
        );
        Select("#view-mode").addEventListener("change", (Event) =>
        {
            this.ViewMode = Event.target.value;
            Select(".viewport").classList.toggle("plane-view", this.ViewMode === "plane");
            this.UpdateCaption();
        });
        Select("#channel-select").innerHTML = DisplayOrdering.map(
            (Display) => `<option value="${Display.Identifier}">${Display.Label}</option>`,
        ).join("");
        Select("#channel-select").addEventListener("change", (Event) =>
        {
            this.Display = Event.target.value;
            this.UpdateCaption();
        });
        Select("#focus-button").addEventListener("click", () =>
        {
            this.Camera.Frame(this.SurfaceRecord.Bounds.Radius, this.SurfaceRecord.Bounds.Centre);
            this.PlaneZoom = 0.82;
            this.PlanePan = [0, 0];
        });
        Select("#maximize-button").addEventListener("click", () =>
        {
            this.Maximised = !this.Maximised;
            Select("#app").classList.toggle("maximized", this.Maximised);
            Select("#maximize-button").classList.toggle("active", this.Maximised);
        });
        Select("#diagnostics-button").addEventListener("click", () =>
        {
            const Panel = Select("#diagnostics");
            Panel.hidden = !Panel.hidden;
            Select("#diagnostics-button").classList.toggle("active", !Panel.hidden);
        });
        Select("#close-diagnostics").addEventListener("click", () =>
        {
            Select("#diagnostics").hidden = true;
            Select("#diagnostics-button").classList.remove("active");
        });
        Select("#mask-toggle").addEventListener("click", () =>
        {
            const Target = this.Projection.Brush.Target === "mask" ? "coverage" : "mask";
            this.Projection.Configure({ Target });
            Select("#mask-toggle").classList.toggle("active", Target === "mask");
            Select("#mask-toggle").setAttribute("aria-pressed", String(Target === "mask"));
            this.UpdateCaption();
            this.Notify(Target === "mask" ? "Painting into the layer mask." : "Painting into layer coverage.");
        });
        new ResizeObserver(() => this.Resize()).observe(Select("#viewport"));
    }

    SetTool(Tool)
    {
        this.Tool = Tool;
        this.Projection.Tool = Tool;
        SelectAll("[data-tool]").forEach((Button) => Button.classList.toggle("active", Button.dataset.tool === Tool));
        this.UpdateCaption();
    }

    DeviceCoordinates(Event)
    {
        const Bounds = this.Canvas.getBoundingClientRect();
        return [
            ((Event.clientX - Bounds.left) / Bounds.width) * 2 - 1,
            1 - ((Event.clientY - Bounds.top) / Bounds.height) * 2,
        ];
    }

    PlaneCoordinates(Event)
    {
        const Bounds = this.Canvas.getBoundingClientRect();
        const Aspect = Bounds.width / Math.max(Bounds.height, 1);
        const X = (Event.clientX - Bounds.left) / Bounds.width - 0.5;
        const Y = 1 - (Event.clientY - Bounds.top) / Bounds.height - 0.5;
        return [(X * Aspect) / this.PlaneZoom + 0.5 + this.PlanePan[0], Y / this.PlaneZoom + 0.5 + this.PlanePan[1]];
    }

    PaintTargetLayer()
    {
        const Layer = this.ActiveLayer;
        if (this.Projection.Brush.Target === "mask")
        {
            if (Layer.Mask.Kind !== "stroke")
            {
                Layer.Mask.Kind = "stroke";
                this.Integrator.EnsureMask(Layer);
                this.RenderInspector();
            }
            return Layer;
        }
        if (Layer.Kind === "stroke") return Layer;
        const Painted = CreateLayer("stroke", {
            Name: "Hand painted",
            Channels: { base_color: [...this.BrushColour], specular_roughness: Layer.Channels.specular_roughness },
        });
        const Index = this.LayerIndex(Layer.Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Painted);
            this.Project.Selection = Painted.Identifier;
        });
        this.Integrator.EnsureCoverage(Painted);
        this.Notify("A hand-painted layer was added above the selection.");
        return Painted;
    }

    OnPointerDown(Event)
    {
        if (!this.Integrator.Ready) return;
        this.Canvas.setPointerCapture(Event.pointerId);
        this.PointerButton = Event.button;
        this.PointerPrevious = [Event.clientX, Event.clientY];
        const Navigating = this.Tool === "orbit" || Event.button === 1 || Event.button === 2 || this.SpaceHeld;
        this.Navigating = Navigating;
        if (Navigating) return;

        if (this.ViewMode === "plane")
        {
            if (this.Tool === "brush" || this.Tool === "eraser")
            {
                const Coordinate = this.PlaneCoordinates(Event);
                const Layer = this.PaintTargetLayer();
                this.BeginStrokeRevision(Layer);
                this.Projection.BeginPlane(Coordinate);
                this.StampPlane(Layer, Coordinate, Coordinate);
            }
            return;
        }

        const [DeviceX, DeviceY] = this.DeviceCoordinates(Event);
        const Hit = this.Projection.Resolve(this.Index, this.Camera, DeviceX, DeviceY);
        if (!Hit)
        {
            this.Navigating = true;
            return;
        }
        if (this.Tool === "picker")
        {
            const Sample = this.Integrator.PickTexel(Hit.Coordinate);
            if (Sample)
            {
                this.BrushColour = Sample.BaseColour;
                this.SyncBrushControls();
                this.Notify(
                    `Picked ${ToHex(Sample.BaseColour).toUpperCase()} · roughness ${Sample.Roughness.toFixed(2)} · metalness ${Sample.Metalness.toFixed(2)}`,
                );
            }
            return;
        }
        if (this.Tool === "decal")
        {
            this.PlaceDecal(Hit);
            return;
        }
        if (this.Tool === "fill")
        {
            this.FloodActive();
            return;
        }
        const Layer = this.PaintTargetLayer();
        this.BeginStrokeRevision(Layer);
        const Segment = this.Projection.Begin(Hit);
        this.StampSurface(Layer, Segment);
    }

    OnPointerMove(Event)
    {
        if (!this.Integrator.Ready) return;
        const Delta = this.PointerPrevious
            ? [Event.clientX - this.PointerPrevious[0], Event.clientY - this.PointerPrevious[1]]
            : [0, 0];
        if (this.PointerPrevious) this.PointerPrevious = [Event.clientX, Event.clientY];

        if (this.Navigating && this.PointerButton !== undefined)
        {
            if (this.ViewMode === "plane")
            {
                const Bounds = this.Canvas.getBoundingClientRect();
                this.PlanePan = [
                    this.PlanePan[0] - (Delta[0] / Bounds.width) * (Bounds.width / Bounds.height) / this.PlaneZoom,
                    this.PlanePan[1] + (Delta[1] / Bounds.height) / this.PlaneZoom,
                ];
                return;
            }
            if (this.PointerButton === 2 || Event.shiftKey) this.Camera.Pan(Delta[0], Delta[1]);
            else this.Camera.Orbit(Delta[0], Delta[1]);
            return;
        }

        if (this.ViewMode === "plane")
        {
            const Coordinate = this.PlaneCoordinates(Event);
            const PlaneRadius = this.PlaneRadius();
            this.PlaneCursor = [Coordinate[0], Coordinate[1], PlaneRadius];
            if (this.Projection.Active && (this.Tool === "brush" || this.Tool === "eraser"))
            {
                const Segment = this.Projection.ExtendPlane(Coordinate, PlaneRadius);
                if (Segment) this.StampPlane(this.ActiveLayer, Segment.StartPlane, Segment.EndPlane);
            }
            return;
        }

        const [DeviceX, DeviceY] = this.DeviceCoordinates(Event);
        const Hit = this.Projection.Resolve(this.Index, this.Camera, DeviceX, DeviceY);
        this.Cursor = Hit
            ? {
                  Position: Hit.Position,
                  Normal: Hit.Normal,
                  Radius: this.Projection.Brush.Radius,
                  Hardness: this.Projection.Brush.Hardness,
              }
            : null;
        if (!Hit || !this.Projection.Active) return;
        if (this.Tool !== "brush" && this.Tool !== "eraser") return;
        const Segment = this.Projection.Extend(Hit);
        if (Segment) this.StampSurface(this.ActiveLayer, Segment);
    }

    OnPointerUp(Event)
    {
        if (this.Canvas.hasPointerCapture?.(Event.pointerId)) this.Canvas.releasePointerCapture(Event.pointerId);
        if (this.Projection.Active) this.CommitStrokeRevision();
        this.Projection.End();
        this.Navigating = false;
        this.PointerButton = undefined;
        this.PointerPrevious = null;
    }

    PlaneRadius()
    {
        const Radius = this.SurfaceRecord?.Bounds.Radius || 1;
        return Clamp(this.Projection.Brush.Radius / (Radius * 3.2), 0.002, 0.6);
    }

    StampSurface(Layer, Segment)
    {
        const Brush = this.Projection.Brush;
        const Erase = this.Tool === "eraser";
        const Target = Brush.Target;
        const Colour = Target === "mask" ? [1, 1, 1] : this.BrushColour;
        const Options = {
            Target,
            Start: Segment.Start,
            End: Segment.End,
            Normal: Segment.Normal,
            Colour,
            Radius: Brush.Radius,
            Hardness: Brush.Hardness,
            Flow: Brush.Flow,
            FacingLimit: this.Projection.FacingLimit,
            Jitter: Brush.Jitter,
            Erase,
            Mode: "surface",
        };
        this.Integrator.Stamp(Layer, Options);
        const Axis = Brush.Symmetry;
        if (Axis !== "none")
        {
            const Start = MirrorVector(Segment.Start, Axis);
            const End = MirrorVector(Segment.End, Axis);
            const Normal = MirrorVector(Segment.Normal, Axis);
            if (Start) this.Integrator.Stamp(Layer, { ...Options, Start, End, Normal });
        }
        this.Recomposite();
        this.MarkDirty();
    }

    StampPlane(Layer, Start, End)
    {
        const Brush = this.Projection.Brush;
        this.Integrator.Stamp(Layer, {
            Target: Brush.Target,
            Start: [0, 0, 0],
            End: [0, 0, 0],
            Normal: [0, 1, 0],
            StartPlane: Start,
            EndPlane: End,
            Colour: Brush.Target === "mask" ? [1, 1, 1] : this.BrushColour,
            Radius: Brush.Radius,
            PlaneRadius: this.PlaneRadius(),
            Hardness: Brush.Hardness,
            Flow: Brush.Flow,
            Jitter: Brush.Jitter,
            Erase: this.Tool === "eraser",
            Mode: "plane",
        });
        this.Recomposite();
        this.MarkDirty();
    }

    FloodActive()
    {
        const Layer = this.PaintTargetLayer();
        const Target = this.Projection.Brush.Target;
        this.BeginStrokeRevision(Layer);
        this.Integrator.FloodLayer(Layer, Target, Target === "mask" ? [1, 1, 1] : this.BrushColour, 1);
        this.CommitStrokeRevision();
        this.Recomposite();
        this.MarkDirty();
        this.Notify(Target === "mask" ? "Mask flooded." : "Layer coverage flooded.");
    }

    ClearActive()
    {
        const Layer = this.ActiveLayer;
        const Target = this.Projection.Brush.Target;
        if (Layer.Kind !== "stroke" && Target !== "mask") return;
        this.BeginStrokeRevision(Layer);
        this.Integrator.FloodLayer(Layer, Target, [0, 0, 0], 0);
        this.CommitStrokeRevision();
        this.Recomposite();
        this.MarkDirty();
        this.Notify(Target === "mask" ? "Mask cleared." : "Layer coverage cleared.");
    }

    BeginStrokeRevision(Layer)
    {
        const Target = this.Projection.Brush.Target;
        this.StrokeRecord = {
            Kind: "image",
            Identifier: Layer.Identifier,
            Target,
            Before: this.Integrator.SnapshotLayer(Layer, Target),
            After: null,
        };
    }

    CommitStrokeRevision()
    {
        if (!this.StrokeRecord) return;
        const Layer = this.Layers.find((Entry) => Entry.Identifier === this.StrokeRecord.Identifier);
        if (Layer)
        {
            this.StrokeRecord.After = this.Integrator.SnapshotLayer(Layer, this.StrokeRecord.Target);
            if (this.StrokeRecord.Before && this.StrokeRecord.After) this.Revisions.Record(this.StrokeRecord);
        }
        this.StrokeRecord = null;
        this.UpdateStatusBar();
    }

    PlaceDecal(Hit)
    {
        const Layer = this.ActiveLayer;
        if (Layer.Kind !== "decal")
        {
            this.Notify("Select a decal layer, or add one from the + menu.");
            return;
        }
        const Frame = StrokeProjection.PlacementFrame(Hit);
        this.CaptureStack(() =>
        {
            Layer.Decal.Mode = "projection";
            Layer.Decal.Transform.Position = Frame.Position;
            Layer.Decal.Transform.Normal = Frame.Normal;
            Layer.Decal.Transform.Tangent = Frame.Tangent;
        });
        this.Notify(`${Layer.Name} placed on the surface.`);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Decals.
    //----------------------------------------------------------------------------------------------------------------------
    async RefreshDecal(Layer)
    {
        if (!Layer || Layer.Kind !== "decal") return;
        try
        {
            const Surface = await RasteriseDecal(Layer.Decal);
            this.Integrator.SetDecalImage(Layer, Surface);
            Layer.Decal.Aspect = Surface.width / Surface.height;
            this.Recomposite();
        }
        catch (Error)
        {
            this.Notify(`Decal could not be rasterised: ${Error.message}`);
        }
    }

    InvalidateDecals()
    {
        for (const Layer of this.Layers) if (Layer.Kind === "decal") this.RefreshDecal(Layer);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Transport: undo, redo, brush controls, symmetry.
    //----------------------------------------------------------------------------------------------------------------------
    BindTransport()
    {
        Select("#undo-button").addEventListener("click", () => this.Undo());
        Select("#redo-button").addEventListener("click", () => this.Redo());
        Select("#brush-colour").addEventListener("input", (Event) =>
        {
            this.BrushColour = FromHex(Event.target.value);
            Select("#brush-swatch").style.setProperty("--swatch", Event.target.value);
            const Layer = this.ActiveLayer;
            if (Layer?.Kind === "stroke")
            {
                Layer.Channels.base_color = [...this.BrushColour];
                this.RenderInspector();
                this.Recomposite();
            }
        });
        Select("#symmetry-select").innerHTML = SymmetryOrdering.map(
            (Entry) => `<option value="${Entry.Identifier}">${Entry.Label}</option>`,
        ).join("");
        Select("#symmetry-select").addEventListener("change", (Event) =>
            this.Projection.Configure({ Symmetry: Event.target.value }),
        );
        Select("#clear-layer").addEventListener("click", () => this.ClearActive());
        SelectAll("[data-brush]").forEach((Control) =>
            Control.addEventListener("input", (Event) =>
            {
                const Key = Control.dataset.brush;
                const Value = Number(Event.target.value);
                this.Projection.Configure({ [Key]: Value });
                const Display = Select(`[data-brush-readout="${Key}"]`);
                if (Display) Display.textContent = Key === "Radius" ? `${(Value * 100).toFixed(1)}` : Value.toFixed(2);
                Event.target.style.setProperty(
                    "--fraction",
                    String((Value - Number(Event.target.min)) / (Number(Event.target.max) - Number(Event.target.min))),
                );
            }),
        );
        this.SyncBrushControls();
    }

    SyncBrushControls()
    {
        const Brush = this.Projection.Brush;
        SelectAll("[data-brush]").forEach((Control) =>
        {
            const Key = Control.dataset.brush;
            Control.value = String(Brush[Key]);
            Control.style.setProperty(
                "--fraction",
                String((Brush[Key] - Number(Control.min)) / (Number(Control.max) - Number(Control.min))),
            );
            const Display = Select(`[data-brush-readout="${Key}"]`);
            if (Display) Display.textContent = Key === "Radius" ? `${(Brush[Key] * 100).toFixed(1)}` : Brush[Key].toFixed(2);
        });
        Select("#brush-colour").value = ToHex(this.BrushColour);
        Select("#brush-swatch").style.setProperty("--swatch", ToHex(this.BrushColour));
        Select("#brush-hud").textContent = `BRUSH ${(Brush.Radius * 100).toFixed(1)} cm`;
    }

    Undo()
    {
        const Entry = this.Revisions.Undo();
        if (!Entry)
        {
            this.Notify("Nothing to undo.");
            return;
        }
        this.ApplyRevision(Entry, "Before");
    }

    Redo()
    {
        const Entry = this.Revisions.Redo();
        if (!Entry)
        {
            this.Notify("Nothing to redo.");
            return;
        }
        this.ApplyRevision(Entry, "After");
    }

    ApplyRevision(Entry, Direction)
    {
        if (Entry.Kind === "stack")
        {
            this.ApplyStackRecord(Entry[Direction]);
            this.InvalidateDecals();
            return;
        }
        const Layer = this.Layers.find((Candidate) => Candidate.Identifier === Entry.Identifier);
        if (!Layer) return;
        this.Integrator.RestoreLayer(Layer, Entry.Target, Entry[Direction]);
        this.Recomposite();
        this.UpdateStatusBar();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Inspector.
    //----------------------------------------------------------------------------------------------------------------------
    BindInspector()
    {
        Select("#inspector-tabs").addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-tab]");
            if (!Button) return;
            this.InspectorTab = Button.dataset.tab;
            this.RenderInspector();
        });
        Select("#layer-name").addEventListener("input", (Event) =>
        {
            const Layer = this.ActiveLayer;
            if (!Layer) return;
            Layer.Name = Event.target.value.slice(0, 64);
            this.RenderStack();
            this.MarkDirty();
        });
        Select("#layer-enabled").addEventListener("change", (Event) =>
        {
            const Layer = this.ActiveLayer;
            if (!Layer) return;
            this.CaptureStack(() => (Layer.Visible = Event.target.checked));
        });
        Select("#reset-properties").addEventListener("click", () => this.ResetInspector());
        const Body = Select("#inspector-body");
        Body.addEventListener("input", (Event) => this.OnInspectorInput(Event));
        Body.addEventListener("change", (Event) => this.OnInspectorInput(Event, true));
        Body.addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-action]");
            if (!Button) return;
            this.OnInspectorAction(Button.dataset.action, Button.dataset.argument);
        });
        Select("#channel-strip").addEventListener("click", (Event) =>
        {
            const Chip = Event.target.closest("[data-channel]");
            if (!Chip) return;
            const Layer = this.ActiveLayer;
            if (!Layer) return;
            const Identifier = Chip.dataset.channel;
            this.CaptureStack(() => (Layer.Enabled[Identifier] = !Layer.Enabled[Identifier]));
        });
    }

    Context()
    {
        const Layer = this.ActiveLayer;
        return {
            Layer,
            Channels: Layer?.Channels,
            Enabled: Layer?.Enabled,
            Mask: Layer?.Mask,
            Generator: Layer?.Generator,
            Decal: Layer?.Decal,
            Project: this.Project,
            Material: this.Project.Material,
            Environment: this.Project.Environment,
            Surface: this.Project.Surface,
            Brush: this.Projection.Brush,
        };
    }

    Resolve(Path)
    {
        const Parts = Path.split(".");
        const Context = this.Context();
        let Node = Context[Parts[0]];
        for (let Index = 1; Index < Parts.length - 1; Index += 1) Node = Node?.[Parts[Index]];
        return { Node, Key: Parts[Parts.length - 1] };
    }

    OnInspectorInput(Event, Committed = false)
    {
        const Field = Event.target.closest("[data-bind]");
        if (!Field) return;
        const Path = Field.dataset.bind;
        const { Node, Key } = this.Resolve(Path);
        if (!Node) return;
        let Value;
        if (Field.type === "checkbox") Value = Field.checked;
        else if (Field.dataset.colour) Value = FromHex(Field.value);
        else if (Field.type === "range" || Field.type === "number") Value = Number(Field.value);
        else Value = Field.value;
        Node[Key] = Value;

        if (Field.type === "range")
        {
            Field.style.setProperty(
                "--fraction",
                String((Value - Number(Field.min)) / Math.max(Number(Field.max) - Number(Field.min), 1e-9)),
            );
            const Pill = Field.parentElement.querySelector('[data-pill="1"]');
            if (Pill) Pill.value = Fixed(Value, Number(Field.step) || 0.01);
        }
        if (Field.dataset.pill)
        {
            const Range = Field.closest(".slider-control")?.querySelector('input[type="range"]');
            if (Range)
            {
                Range.value = String(Value);
                Range.style.setProperty(
                    "--fraction",
                    String((Value - Number(Range.min)) / Math.max(Number(Range.max) - Number(Range.min), 1e-9)),
                );
            }
        }
        if (Field.dataset.colour)
        {
            const Code = Field.parentElement.querySelector(".colour-code");
            if (Code) Code.textContent = Field.value.toUpperCase();
        }
        this.AfterInspectorChange(Path, Committed);
    }

    AfterInspectorChange(Path, Committed)
    {
        this.MarkDirty();
        if (Path.startsWith("Surface."))
        {
            if (Committed) this.RebuildSurface();
            return;
        }
        if (Path === "Project.Resolution")
        {
            this.Integrator.Configure(Number(this.Project.Resolution));
            this.Recomposite();
            this.UpdateStatusBar();
            return;
        }
        if (Path.startsWith("Decal.Text.") || Path.startsWith("Decal.Library") || Path.startsWith("Decal.SourceKind"))
        {
            this.RefreshDecal(this.ActiveLayer);
            if (Committed) this.RenderInspector();
            return;
        }
        if (Path.startsWith("Generator.Kind") || Path.startsWith("Mask."))
        {
            if (Path === "Generator.Kind")
                this.ActiveLayer.Generator = NormaliseGenerator({ Kind: this.ActiveLayer.Generator.Kind });
            if (Path === "Mask.Generator.Kind")
                this.ActiveLayer.Mask.Generator = NormaliseGenerator({ Kind: this.ActiveLayer.Mask.Generator.Kind });
            if (Path === "Mask.Kind" && this.ActiveLayer.Mask.Kind === "stroke") this.Integrator.EnsureMask(this.ActiveLayer);
            this.Recomposite();
            this.RenderStack();
            if (Committed) this.RenderInspector();
            return;
        }
        if (Path.startsWith("Layer.") || Path.startsWith("Channels.") || Path.startsWith("Decal."))
        {
            this.Recomposite();
            if (Path === "Layer.Blend" || Path === "Layer.Opacity") this.RenderStack();
            return;
        }
        if (Path.startsWith("Brush.")) this.SyncBrushControls();
        this.Recomposite();
    }

    OnInspectorAction(Action, Argument)
    {
        const Layer = this.ActiveLayer;
        switch (Action)
        {
            case "duplicate-layer":
                this.DuplicateLayer();
                break;
            case "remove-layer":
                this.RemoveLayer();
                break;
            case "raise-layer":
                this.ShiftLayer(1);
                break;
            case "lower-layer":
                this.ShiftLayer(-1);
                break;
            case "flood-layer":
                this.FloodActive();
                break;
            case "clear-layer":
                this.ClearActive();
                break;
            case "all-channels":
                this.CaptureStack(() =>
                {
                    for (const Channel of ChannelSpecification) Layer.Enabled[Channel.Identifier] = true;
                });
                break;
            case "no-channels":
                this.CaptureStack(() =>
                {
                    for (const Channel of ChannelSpecification) Layer.Enabled[Channel.Identifier] = false;
                    Layer.Enabled.base_color = true;
                });
                break;
            case "pick-mark":
                this.CaptureStack(() =>
                {
                    Layer.Decal.Library = Argument;
                    Layer.Decal.SourceKind = "svg";
                });
                this.RefreshDecal(Layer);
                this.RenderInspector();
                break;
            case "decal-category":
                this.DecalCategory = Argument;
                this.RenderInspector();
                break;
            case "load-svg":
                Select("#svg-file").click();
                break;
            case "apply-markup":
            {
                const Markup = SanitiseMarkup(Select("#svg-markup")?.value || "");
                if (!Markup.includes("<svg"))
                {
                    this.Notify("That does not look like SVG markup.");
                    break;
                }
                Layer.Decal.Svg = Markup;
                Layer.Decal.Library = "custom";
                Layer.Decal.SourceKind = "svg";
                this.RefreshDecal(Layer);
                this.Notify("Custom SVG rasterised.");
                break;
            }
            case "bake-occlusion":
                this.ScheduleOcclusion();
                this.Notify("Re-baking per-vertex occlusion.");
                break;
            case "import-mesh":
                Select("#mesh-file").click();
                break;
            case "reset-material":
                this.CaptureStack(() => (this.Project.Material = { ...DefaultProject().Material }));
                break;
            case "reset-stack":
                this.CaptureStack(() =>
                {
                    this.Project.Layers = DefaultStack();
                    this.Project.Selection = this.Project.Layers[this.Project.Layers.length - 1].Identifier;
                });
                break;
            default:
                break;
        }
    }

    ResetInspector()
    {
        const Layer = this.ActiveLayer;
        if (this.InspectorTab === "material") this.OnInspectorAction("reset-material");
        else if (this.InspectorTab === "surface")
            this.CaptureStack(() =>
            {
                this.Project.Surface = { ...DefaultProject().Surface };
                this.Project.Environment = { ...DefaultProject().Environment };
            });
        else
        {
            const Fresh = CreateLayer(Layer.Kind, { Name: Layer.Name });
            this.CaptureStack(() =>
            {
                Object.assign(Layer, { ...Fresh, Identifier: Layer.Identifier, Name: Layer.Name });
            });
        }
        this.RenderInspector();
    }

    RenderInspector()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Kind = LayerKindByIdentifier[Layer.Kind];
        Select("#layer-symbol").innerHTML = Icon(Kind.Glyph);
        Select("#layer-symbol").style.setProperty("--row-accent", Kind.Accent);
        Select("#layer-name").value = Layer.Name;
        Select("#layer-type").textContent = `${Kind.Label.toUpperCase()} · ${LayerBadge(Layer)}`;
        Select("#layer-enabled").checked = Layer.Visible;
        SelectAll("#inspector-tabs button").forEach((Button) =>
            Button.classList.toggle("active", Button.dataset.tab === this.InspectorTab),
        );
        const Body = Select("#inspector-body");
        Body.innerHTML =
            this.InspectorTab === "material"
                ? this.MaterialInspector()
                : this.InspectorTab === "surface"
                  ? this.SurfaceInspector()
                  : this.LayerInspector(Layer);
        FillIcons(Body);
    }

    LayerInspector(Layer)
    {
        const Sections = [];
        Sections.push(
            Group({
                Title: "Layer",
                Badge: LayerBadge(Layer),
                Body: [
                    SelectRow({
                        Label: "Blend",
                        Path: "Layer.Blend",
                        Value: Layer.Blend,
                        Options: BlendOrdering.map((Blend) => ({ Value: Blend.Identifier, Label: Blend.Label })),
                    }),
                    SliderRow({
                        Label: "Opacity",
                        Path: "Layer.Opacity",
                        Value: Layer.Opacity,
                        Minimum: 0,
                        Maximum: 1,
                        Step: 0.01,
                        Unit: "—",
                    }),
                    ActionRow([
                        { Action: "raise-layer", Label: "Raise", Glyph: "up" },
                        { Action: "lower-layer", Label: "Lower", Glyph: "down" },
                        { Action: "duplicate-layer", Label: "Duplicate", Glyph: "copy" },
                        { Action: "remove-layer", Label: "Remove", Glyph: "trash" },
                    ]),
                ].join(""),
            }),
        );

        if (Layer.Kind === "generator")
            Sections.push(
                Group({
                    Title: "Generator",
                    Badge: Layer.Generator.Kind.toUpperCase(),
                    Body: this.GeneratorBody("Generator", Layer.Generator),
                }),
            );

        if (Layer.Kind === "decal") Sections.push(this.DecalSections(Layer));

        if (Layer.Kind === "stroke")
            Sections.push(
                Group({
                    Title: "Coverage",
                    Badge: "PAINTED",
                    Body: [
                        `<p class="property-hint">Painted colour is stored per texel. The remaining channels below apply
                          uniformly wherever this layer has coverage.</p>`,
                        ActionRow([
                            { Action: "flood-layer", Label: "Flood", Glyph: "fill" },
                            { Action: "clear-layer", Label: "Clear", Glyph: "eraser" },
                        ]),
                    ].join(""),
                }),
            );

        Sections.push(
            Group({
                Title: "Channels",
                Badge: `${LayerChannelCount(Layer)} / ${ChannelSpecification.length}`,
                Body: [
                    `<p class="property-hint">Only the enabled channels are written into the texture set. Toggle them on the
                      channel strip beneath the viewport or here.</p>`,
                    ActionRow([
                        { Action: "all-channels", Label: "Enable all", Glyph: "check" },
                        { Action: "no-channels", Label: "Base colour only", Glyph: "palette" },
                    ]),
                    ...ChannelSpecification.map((Channel) => this.ChannelControl(Layer, Channel)),
                ].join(""),
            }),
        );

        Sections.push(
            Group({
                Title: "Mask",
                Badge: Layer.Mask.Kind === "none" ? "OFF" : Layer.Mask.Kind.toUpperCase(),
                Open: Layer.Mask.Kind !== "none",
                Body: [
                    SelectRow({
                        Label: "Mask source",
                        Path: "Mask.Kind",
                        Value: Layer.Mask.Kind,
                        Options: [
                            { Value: "none", Label: "No mask" },
                            { Value: "stroke", Label: "Painted mask" },
                            { Value: "generator", Label: "Generator mask" },
                        ],
                        Hint: "A painted mask takes the brush while the mask toggle in the viewport tools is lit.",
                    }),
                    Layer.Mask.Kind === "none" ? "" : ToggleRow({ Label: "Invert", Path: "Mask.Invert", Value: Layer.Mask.Invert }),
                    Layer.Mask.Kind === "generator" ? this.GeneratorBody("Mask.Generator", Layer.Mask.Generator) : "",
                ].join(""),
            }),
        );
        return Sections.join("");
    }

    ChannelControl(Layer, Channel)
    {
        const Enabled = Layer.Enabled[Channel.Identifier];
        const Value = Layer.Channels[Channel.Identifier];
        const Control =
            Channel.Kind === "color"
                ? ColourRow({ Label: Channel.Label, Path: `Channels.${Channel.Identifier}`, Value })
                : SliderRow({
                      Label: Channel.Label,
                      Path: `Channels.${Channel.Identifier}`,
                      Value,
                      Minimum: 0,
                      Maximum: 1,
                      Step: 0.01,
                      Unit: "—",
                  });
        return `
        <div class="channel-control ${Enabled ? "enabled" : ""}">
            <label class="channel-head">
                <input type="checkbox" data-bind="Enabled.${Channel.Identifier}" ${Enabled ? "checked" : ""}
                       aria-label="Write ${Escape(Channel.Label)}" />
                <span class="channel-name">${Escape(Channel.Label)}</span>
                <code>${Escape(Channel.Identifier)}</code>
            </label>
            ${Enabled ? Control : ""}
        </div>`;
    }

    GeneratorBody(Prefix, Generator)
    {
        const Specification = GeneratorByIdentifier[Generator.Kind] || GeneratorByIdentifier.fbm;
        const Rows = Specification.Controls.map((Name) =>
        {
            const Control = GeneratorControls[Name];
            return SliderRow({
                Label: Control.Label,
                Path: `${Prefix}.${Name}`,
                Value: Generator[Name],
                Minimum: Control.Minimum,
                Maximum: Control.Maximum,
                Step: Control.Step,
                Unit: Control.Unit,
            });
        });
        return [
            SelectRow({
                Label: "Field",
                Path: `${Prefix}.Kind`,
                Value: Generator.Kind,
                Options: GeneratorOrdering.map((Entry) => ({ Value: Entry.Identifier, Label: Entry.Label })),
                Hint: Specification.Hint,
            }),
            ...Rows,
            ToggleRow({ Label: "Invert", Path: `${Prefix}.Invert`, Value: Generator.Invert }),
        ].join("");
    }

    DecalSections(Layer)
    {
        const Decal = Layer.Decal;
        const Marks = DecalLibrary.filter(
            (Mark) => this.DecalCategory === "all" || Mark.Category === this.DecalCategory,
        );
        const Source = Group({
            Title: "Decal source",
            Badge: Decal.SourceKind === "text" ? "TEXT" : "SVG",
            Body: [
                SelectRow({
                    Label: "Source",
                    Path: "Decal.SourceKind",
                    Value: Decal.SourceKind,
                    Options: [
                        { Value: "svg", Label: "Vector mark" },
                        { Value: "text", Label: "Text" },
                    ],
                }),
                Decal.SourceKind === "svg"
                    ? `
                    <div class="decal-filters">
                        ${DecalCategories.map(
                            (Category) =>
                                `<button data-action="decal-category" data-argument="${Category.Identifier}"
                                         class="${this.DecalCategory === Category.Identifier ? "active" : ""}">${Category.Label}</button>`,
                        ).join("")}
                    </div>
                    <div class="decal-grid">
                        ${Marks.map(
                            (Mark) => `
                            <button class="decal-tile ${Decal.Library === Mark.Identifier ? "active" : ""}"
                                    data-action="pick-mark" data-argument="${Mark.Identifier}" title="${Escape(Mark.Note || Mark.Label)}">
                                <span class="decal-preview">${Mark.Markup}</span>
                                <small>${Escape(Mark.Label)}</small>
                            </button>`,
                        ).join("")}
                    </div>
                    <details class="custom-markup">
                        <summary>Custom SVG</summary>
                        <textarea id="svg-markup" rows="4" spellcheck="false"
                                  placeholder="&lt;svg viewBox='0 0 100 100'&gt;…&lt;/svg&gt;">${Escape(Decal.Svg || "")}</textarea>
                        ${ActionRow([
                            { Action: "apply-markup", Label: "Rasterise markup", Glyph: "vector" },
                            { Action: "load-svg", Label: "Open .svg", Glyph: "folder" },
                        ])}
                    </details>`
                    : [
                          `<div class="property-row">
                              <label class="property-label" for="decal-text">Content</label>
                              <textarea id="decal-text" rows="2" data-bind="Decal.Text.Content"
                                        maxlength="120">${Escape(Decal.Text.Content)}</textarea>
                           </div>`,
                          SelectRow({
                              Label: "Typeface",
                              Path: "Decal.Text.Family",
                              Value: Decal.Text.Family,
                              Options: FontArchive.map((Entry) => ({ Value: Entry.Family, Label: `${Entry.Family} · ${Entry.Note}` })),
                          }),
                          SelectRow({
                              Label: "Weight",
                              Path: "Decal.Text.Weight",
                              Value: String(Decal.Text.Weight),
                              Options: [
                                  { Value: "300", Label: "Light" },
                                  { Value: "400", Label: "Regular" },
                                  { Value: "700", Label: "Bold" },
                              ],
                          }),
                          SliderRow({ Label: "Tracking", Path: "Decal.Text.Tracking", Value: Decal.Text.Tracking, Minimum: -20, Maximum: 80, Step: 1, Unit: "px" }),
                          SliderRow({ Label: "Line height", Path: "Decal.Text.LineHeight", Value: Decal.Text.LineHeight, Minimum: 0.7, Maximum: 2.2, Step: 0.01, Unit: "×" }),
                          SliderRow({ Label: "Outline", Path: "Decal.Text.Outline", Value: Decal.Text.Outline, Minimum: 0, Maximum: 24, Step: 0.5, Unit: "px" }),
                      ].join(""),
            ].join(""),
        });

        const Placement = Group({
            Title: "Placement",
            Badge: Decal.Mode === "plane" ? "UV" : "PROJECTED",
            Body: [
                SelectRow({
                    Label: "Projection",
                    Path: "Decal.Mode",
                    Value: Decal.Mode,
                    Options: [
                        { Value: "projection", Label: "Projected onto the surface" },
                        { Value: "plane", Label: "Placed in UV space" },
                    ],
                    Hint:
                        Decal.Mode === "projection"
                            ? "Choose the decal tool and click the model to drop the projection frame."
                            : "UV placement ignores the model and lays the mark flat in texture space.",
                }),
                ...(Decal.Mode === "projection"
                    ? [
                          SliderRow({ Label: "Size", Path: "Decal.Transform.Size", Value: Decal.Transform.Size, Minimum: 0.02, Maximum: 2.4, Step: 0.01, Unit: "m" }),
                          SliderRow({ Label: "Aspect", Path: "Decal.Transform.Aspect", Value: Decal.Transform.Aspect, Minimum: 0.2, Maximum: 5, Step: 0.01, Unit: "×" }),
                          SliderRow({ Label: "Rotation", Path: "Decal.Transform.Rotation", Value: Decal.Transform.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                          SliderRow({ Label: "Depth", Path: "Decal.Transform.Depth", Value: Decal.Transform.Depth, Minimum: 0.01, Maximum: 2, Step: 0.01, Unit: "m" }),
                          SliderRow({ Label: "Angle limit", Path: "Decal.Transform.AngleLimit", Value: Decal.Transform.AngleLimit, Minimum: 10, Maximum: 180, Step: 1, Unit: "°" }),
                      ]
                    : [
                          SliderRow({ Label: "Centre U", Path: "Decal.Plane.Centre.0", Value: Decal.Plane.Centre[0], Minimum: 0, Maximum: 1, Step: 0.005, Unit: "u" }),
                          SliderRow({ Label: "Centre V", Path: "Decal.Plane.Centre.1", Value: Decal.Plane.Centre[1], Minimum: 0, Maximum: 1, Step: 0.005, Unit: "v" }),
                          SliderRow({ Label: "Size", Path: "Decal.Plane.Size", Value: Decal.Plane.Size, Minimum: 0.02, Maximum: 1.6, Step: 0.005, Unit: "uv" }),
                          SliderRow({ Label: "Rotation", Path: "Decal.Plane.Rotation", Value: Decal.Plane.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                          SliderRow({ Label: "Aspect", Path: "Decal.Plane.Aspect", Value: Decal.Plane.Aspect, Minimum: 0.2, Maximum: 5, Step: 0.01, Unit: "×" }),
                      ]),
                SliderRow({ Label: "Edge softness", Path: "Decal.Softness", Value: Decal.Softness, Minimum: 0.002, Maximum: 0.6, Step: 0.002, Unit: "α" }),
                SliderRow({ Label: "Emboss", Path: "Decal.Emboss", Value: Decal.Emboss, Minimum: -0.5, Maximum: 0.5, Step: 0.01, Unit: "h" }),
                ToggleRow({ Label: "Tint the mark", Path: "Decal.Colorise", Value: Decal.Colorise }),
                Decal.Colorise ? ColourRow({ Label: "Tint", Path: "Decal.Tint", Value: Decal.Tint }) : "",
            ].join(""),
        });
        return Source + Placement;
    }

    MaterialInspector()
    {
        const Material = this.Project.Material;
        const Groups = new Map();
        for (const Control of SurfaceControls)
        {
            if (!Groups.has(Control.Group)) Groups.set(Control.Group, []);
            Groups.get(Control.Group).push(
                Control.Kind === "color"
                    ? ColourRow({ Label: Control.Label, Path: `Material.${Control.Identifier}`, Value: Material[Control.Identifier] })
                    : SliderRow({
                          Label: Control.Label,
                          Path: `Material.${Control.Identifier}`,
                          Value: Material[Control.Identifier],
                          Minimum: Control.Minimum,
                          Maximum: Control.Maximum,
                          Step: Control.Step,
                          Unit: Control.Unit,
                      }),
            );
        }
        const Sections = [...Groups.entries()].map(([Title, Rows], Index) =>
            Group({ Title, Badge: "OPENPBR", Body: Rows.join(""), Open: Index < 2 }),
        );
        Sections.push(
            Group({
                Title: "Thin walled",
                Badge: "GEOMETRY",
                Open: false,
                Body: [
                    ToggleRow({ Label: "Thin walled", Path: "Material.geometry_thin_walled", Value: Material.geometry_thin_walled }),
                    ActionRow([{ Action: "reset-material", Label: "Reset constants", Glyph: "rotate" }]),
                ].join(""),
            }),
        );
        return Sections.join("");
    }

    SurfaceInspector()
    {
        const Surface = this.Project.Surface;
        const Environment = this.Project.Environment;
        const Record = this.SurfaceRecord;
        return [
            Group({
                Title: "Surface",
                Badge: Record ? `${Record.Triangles.toLocaleString()} TRIS` : "",
                Body: [
                    SelectRow({
                        Label: "Mesh",
                        Path: "Surface.Kind",
                        Value: Surface.Kind,
                        Options: SurfaceOrdering.map((Entry) => ({ Value: Entry.Identifier, Label: `${Entry.Label} · ${Entry.Note}` })),
                    }),
                    SliderRow({ Label: "Subdivision", Path: "Surface.Subdivision", Value: Surface.Subdivision, Minimum: 0, Maximum: 3, Step: 1, Unit: "lvl" }),
                    SelectRow({
                        Label: "Texture resolution",
                        Path: "Project.Resolution",
                        Value: String(this.Project.Resolution),
                        Options: ResolutionOrdering.map((Entry) => ({ Value: String(Entry.Value), Label: `${Entry.Label} · ${Entry.Note}` })),
                        Hint: "Painted layers are resampled when the resolution changes.",
                    }),
                    ActionRow([
                        { Action: "import-mesh", Label: "Import OBJ", Glyph: "folder" },
                        { Action: "bake-occlusion", Label: "Re-bake AO", Glyph: "rotate" },
                    ]),
                ].join(""),
            }),
            Group({
                Title: "Environment",
                Badge: Environment.Identifier.toUpperCase(),
                Body: [
                    SelectRow({
                        Label: "Lighting",
                        Path: "Environment.Identifier",
                        Value: Environment.Identifier,
                        Options: EnvironmentOrdering.map((Entry) => ({ Value: Entry.Identifier, Label: Entry.Label })),
                    }),
                    SliderRow({ Label: "Rotation", Path: "Environment.Rotation", Value: Environment.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                    SliderRow({ Label: "Intensity", Path: "Environment.Intensity", Value: Environment.Intensity, Minimum: 0, Maximum: 4, Step: 0.01, Unit: "×" }),
                    SliderRow({ Label: "Exposure", Path: "Environment.Exposure", Value: Environment.Exposure, Minimum: -4, Maximum: 4, Step: 0.01, Unit: "EV" }),
                    ToggleRow({ Label: "Show background", Path: "Environment.Background", Value: Environment.Background }),
                ].join(""),
            }),
            Group({
                Title: "Stack",
                Badge: `${this.Layers.length} LAYERS`,
                Open: false,
                Body: ActionRow([{ Action: "reset-stack", Label: "Reset to the default stack", Glyph: "layers" }]),
            }),
        ].join("");
    }

    RenderChannelStrip()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        Select("#channel-strip").innerHTML = ChannelSpecification.map(
            (Channel) => `
            <button class="channel-chip ${Layer.Enabled[Channel.Identifier] ? "active" : ""}"
                    data-channel="${Channel.Identifier}" title="${Escape(Channel.Hint)}"
                    aria-pressed="${Layer.Enabled[Channel.Identifier]}">
                <i style="--chip:${ChannelTint(Channel.Identifier)}"></i>${Escape(Channel.Label)}
            </button>`,
        ).join("");
        Select("#channel-counter").textContent = `${LayerChannelCount(Layer)} WRITTEN`;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Dialogs, import and export.
    //----------------------------------------------------------------------------------------------------------------------
    BindDialogs()
    {
        Select("#close-help").addEventListener("click", () => Select("#help-dialog").close());
        Select("#close-export").addEventListener("click", () => Select("#export-dialog").close());
        Select("#export-preset").innerHTML = ExportOrdering.map(
            (Preset) => `<option value="${Preset.Identifier}">${Preset.Label}</option>`,
        ).join("");
        Select("#export-preset").addEventListener("change", () => this.DescribeExport());
        Select("#export-confirm").addEventListener("click", () => this.RunExport());
        Select("#export-project").addEventListener("click", () =>
        {
            EmitProject(this.Project, this.Camera.Serialise());
            this.Notify("Project written.");
        });
        Select("#svg-file").addEventListener("change", async (Event) =>
        {
            const File = Event.target.files?.[0];
            if (!File) return;
            const Markup = SanitiseMarkup(await File.text());
            const Layer = this.ActiveLayer;
            if (Layer.Kind !== "decal")
            {
                this.Notify("Select a decal layer first.");
                return;
            }
            Layer.Decal.Svg = Markup;
            Layer.Decal.Library = "custom";
            Layer.Decal.SourceKind = "svg";
            this.RefreshDecal(Layer);
            this.RenderInspector();
            this.Notify(`${File.name} rasterised into ${Layer.Name}.`);
        });
        Select("#mesh-file").addEventListener("change", async (Event) =>
        {
            const File = Event.target.files?.[0];
            if (!File) return;
            try
            {
                this.SetStatus("Importing mesh", "busy");
                this.ImportedSurface = ParseWavefront(await File.text(), File.name.replace(/\.obj$/i, ""));
                this.Project.Surface.Kind = "custom";
                this.RebuildSurface(true);
                this.RenderInspector();
                this.Notify(`${File.name} · ${this.ImportedSurface.Triangles.toLocaleString()} triangles.`);
            }
            catch (Error)
            {
                this.Notify(`Import failed: ${Error.message}`);
                this.SetStatus("Ready", "ready");
            }
        });
    }

    OpenExport()
    {
        this.DescribeExport();
        Select("#export-dialog").showModal();
    }

    DescribeExport()
    {
        const Preset = ExportOrdering.find((Entry) => Entry.Identifier === Select("#export-preset").value) || ExportOrdering[0];
        Select("#export-note").textContent = Preset.Note;
        Select("#export-list").innerHTML = Preset.Channels.map(
            (Identifier) => `<span>${Escape(ChannelByIdentifier[Identifier]?.Label || Identifier)}</span>`,
        ).join("");
        Select("#export-scale").textContent = `${this.Project.Resolution} × ${this.Project.Resolution}`;
    }

    async RunExport()
    {
        const Preset = Select("#export-preset").value;
        Select("#export-confirm").disabled = true;
        try
        {
            const Result = await EmitTextureSet(this.Integrator, this.Project, Preset, (Message) =>
            {
                Select("#export-progress").textContent = Message;
            });
            Select("#export-progress").textContent = `${Result.Count} images written as ${Result.Preset}.`;
            this.Notify(`${Result.Count} images and one descriptor written.`);
            this.Dirty = false;
            Select("#dirty-indicator").classList.add("clean");
        }
        catch (Error)
        {
            Select("#export-progress").textContent = `Export failed: ${Error.message}`;
        }
        Select("#export-confirm").disabled = false;
    }

    async ImportProject(File)
    {
        if (!File) return;
        try
        {
            const Record = SanitiseProject(JSON.parse(await File.text()));
            this.Project = Record;
            Select("#document-name").value = Record.Name;
            this.Documents.Synchronise(Record.Name);
            this.Revisions.Clear();
            this.Integrator.Configure(Record.Resolution);
            this.RebuildSurface(true);
            this.InvalidateDecals();
            this.RenderStack();
            this.RenderInspector();
            this.RenderChannelStrip();
            this.Notify(`${File.name} opened · ${Record.Layers.length} layers.`);
        }
        catch (Error)
        {
            this.Notify(`That project could not be read: ${Error.message}`);
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Documents.
    //----------------------------------------------------------------------------------------------------------------------
    CaptureDocument()
    {
        return {
            Project: structuredClone(this.Project),
            Camera: this.Camera.Serialise(),
            Tool: this.Tool,
            Display: this.Display,
            ViewMode: this.ViewMode,
        };
    }

    RestoreDocument(Record, Name)
    {
        if (!Record)
        {
            this.Project = DefaultProject();
            this.Project.Name = Name;
            this.Project.Layers = DefaultStack();
            this.Project.Selection = this.Project.Layers[this.Project.Layers.length - 1].Identifier;
            this.Camera.Restore();
        }
        else
        {
            this.Project = Record.Project;
            this.Camera.Restitute(Record.Camera);
            this.Tool = Record.Tool || "brush";
            this.Display = Record.Display || "material";
            this.ViewMode = Record.ViewMode || "surface";
        }
        Select("#document-name").value = this.Project.Name;
        Select("#channel-select").value = this.Display;
        Select("#view-mode").value = this.ViewMode;
        this.SetTool(this.Tool);
        this.Revisions.Clear();
        this.Integrator.Configure(this.Project.Resolution);
        this.RebuildSurface(true);
        this.RenderStack();
        this.RenderInspector();
        this.RenderChannelStrip();
        this.UpdateCaption();
    }

    DiscardDocument(Record)
    {
        for (const Layer of Record?.Project?.Layers || []) this.Integrator.ReleaseLayer(Layer.Identifier);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Keyboard.
    //----------------------------------------------------------------------------------------------------------------------
    BindKeyboard()
    {
        window.addEventListener("keydown", (Event) =>
        {
            // The target is the window itself when nothing holds focus, so matches() cannot be assumed.
            if (Event.target?.matches?.("input, textarea, select")) return;
            if (Event.code === "Space") this.SpaceHeld = true;
            const Key = Event.key.toLowerCase();
            if ((Event.ctrlKey || Event.metaKey) && Key === "z")
            {
                Event.preventDefault();
                if (Event.shiftKey) this.Redo();
                else this.Undo();
                return;
            }
            if ((Event.ctrlKey || Event.metaKey) && Key === "s")
            {
                Event.preventDefault();
                EmitProject(this.Project, this.Camera.Serialise());
                this.Notify("Project written.");
                return;
            }
            if ((Event.ctrlKey || Event.metaKey) && Key === "e")
            {
                Event.preventDefault();
                this.OpenExport();
                return;
            }
            if (Event.ctrlKey || Event.metaKey) return;
            const Tools = ["orbit", "brush", "eraser", "fill", "decal", "picker"];
            if (/^[1-6]$/.test(Key))
            {
                this.SetTool(Tools[Number(Key) - 1]);
                return;
            }
            if (Key === "[") this.Projection.Configure({ Radius: Clamp(this.Projection.Brush.Radius * 0.84, 0.004, 1.2) });
            if (Key === "]") this.Projection.Configure({ Radius: Clamp(this.Projection.Brush.Radius * 1.19, 0.004, 1.2) });
            if (Key === "[" || Key === "]") this.SyncBrushControls();
            if (Key === "m") Select("#mask-toggle").click();
            if (Key === "f") Select("#focus-button").click();
            if (Key === "x")
            {
                this.ViewMode = this.ViewMode === "plane" ? "surface" : "plane";
                Select("#view-mode").value = this.ViewMode;
                Select(".viewport").classList.toggle("plane-view", this.ViewMode === "plane");
                this.UpdateCaption();
            }
            if (Key === "/")
            {
                Event.preventDefault();
                Select("#material-search").focus();
            }
        });
        window.addEventListener("keyup", (Event) =>
        {
            if (Event.code === "Space") this.SpaceHeld = false;
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Presentation.
    //----------------------------------------------------------------------------------------------------------------------
    Notify(Message)
    {
        const Toast = Select("#toast");
        Toast.textContent = Message;
        Toast.hidden = false;
        clearTimeout(this.ToastTimer);
        this.ToastTimer = setTimeout(() => (Toast.hidden = true), 3200);
    }

    SetStatus(Text, Kind)
    {
        this.Status = Text;
        const Element = Select("#status-ready");
        Element.innerHTML = `<i></i>${Escape(Text)}`;
        Element.dataset.kind = Kind || "";
    }

    //----------------------------------------------------------------------------------------------------------------------
    // A missing context is worth explaining properly: say what the browser refused, what to do about it, and offer the
    // retry, because a GPU process that was down a second ago is often back by the time somebody reads the first line.
    //----------------------------------------------------------------------------------------------------------------------
    ReportFailure(Integrator)
    {
        const Advice = Integrator?.Advice || [];
        const Notes = Integrator?.Notes || [];
        const Renderer = Integrator?.Renderer || "";
        Select("#gpu-error").hidden = false;
        Select("#gpu-error-message").textContent = Integrator?.Failure || "The renderer could not start.";
        Select("#gpu-error-advice").innerHTML = Advice.map((Entry) => `<li>${Escape(Entry)}</li>`).join("");
        const Detail = Select("#gpu-error-detail");
        const Lines = [...Notes];
        if (Renderer) Lines.push(`Renderer: ${Renderer}`);
        Detail.textContent = Lines.join(" · ");
        Detail.hidden = Lines.length === 0;
        this.SetStatus("GPU unavailable", "error");
        this.RefineFailure(Integrator, Lines);
        // A GPU process that was restarting a moment ago is often back before anyone finishes reading the first line, so
        // try again quietly a couple of times. A lost context is left alone: the browser announces its own restoration.
        if (!Integrator?.Device && !this.RecoveryTimer && this.RecoveryAttempts < 2)
        {
            this.RecoveryAttempts += 1;
            this.RecoveryTimer = setTimeout(() =>
            {
                this.RecoveryTimer = 0;
                if (!this.Integrator.Ready) this.RetryDevice();
            }, 1500);
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Asking WebGPU for an adapter settles the only question the WebGL error leaves open: whether the machine has no usable
    // GPU, or has one the browser is simply refusing to lend to WebGL. The answer arrives a tick later, so it is folded in
    // once it does.
    //----------------------------------------------------------------------------------------------------------------------
    RefineFailure(Integrator, Lines)
    {
        ProbeAcceleration().then((Probe) =>
        {
            this.Acceleration = Probe;
            this.Report = DeviceReport(Integrator?.Failure, Integrator?.Notes || [], Probe);
            if (Select("#gpu-error").hidden) return;
            const Detail = Select("#gpu-error-detail");
            Detail.textContent = [...Lines, Probe.Modern ? `WebGPU adapter: ${Probe.Adapter}` : "WebGPU: no adapter"].join(" · ");
            Detail.hidden = false;
            if (!Probe.Modern) return;
            const Advice = Select("#gpu-error-advice");
            const First = document.createElement("li");
            First.textContent =
                `The GPU itself is fine — WebGPU sees ${Probe.Adapter} on this machine. WebGL alone is being refused, so this ` +
                "is browser configuration rather than hardware: chrome://flags/#ignore-gpu-blocklist and chrome://gpu are the places to look.";
            Advice.prepend(First);
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Retrying has to start from a fresh canvas: once a canvas has been refused a context the browser keeps refusing that
    // same element. Context loss is the same story with a happier ending, so both routes land here.
    //----------------------------------------------------------------------------------------------------------------------
    BindRecovery()
    {
        this.Canvas.addEventListener("webglcontextlost", (Event) =>
        {
            Event.preventDefault();
            this.Integrator.Failure = "The GPU context was lost — the driver or the browser reset it.";
            this.Integrator.Advice = ["Press Try again to rebuild the renderer. Painted coverage from this session is lost."];
            this.ReportFailure(this.Integrator);
        });
        this.Canvas.addEventListener("webglcontextrestored", () => this.RetryDevice());
        if (this.RecoveryBound) return;
        this.RecoveryBound = true;
        Select("#gpu-retry")?.addEventListener("click", () => this.RetryDevice());
        Select("#gpu-copy")?.addEventListener("click", async () =>
        {
            const Text = this.Report || DeviceReport(this.Integrator?.Failure, this.Integrator?.Notes || [], this.Acceleration);
            try
            {
                await navigator.clipboard.writeText(Text);
                this.Notify("Renderer report copied.");
            }
            catch
            {
                // Clipboard permission is not a given on a file:// or an unfocused page — show it instead.
                Select("#gpu-error-detail").textContent = Text;
                Select("#gpu-error-detail").hidden = false;
            }
        });
    }

    RetryDevice()
    {
        const Replacement = this.Canvas.cloneNode(false);
        this.Canvas.replaceWith(Replacement);
        this.Canvas = Replacement;
        this.Integrator = new ShadingIntegrator(this.Canvas);
        this.BindRecovery();
        if (!this.Integrator.Ready)
        {
            this.ReportFailure(this.Integrator);
            return;
        }
        clearTimeout(this.RecoveryTimer);
        this.RecoveryTimer = 0;
        Select("#gpu-error").hidden = true;
        if (this.Commenced)
        {
            this.BindSurfacePointers();
            this.Integrator.Configure(this.Project.Resolution);
            this.RebuildSurface(true);
            this.InvalidateDecals();
            this.Recomposite();
            this.SetStatus("Renderer rebuilt", "ready");
            this.Notify("The renderer was rebuilt. Painted coverage from before the reset is gone.");
            return;
        }
        this.Commence();
    }

    UpdateCaption()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Tool = ToolOrdering.find((Entry) => Entry.Identifier === this.Tool);
        const Target = this.Projection.Brush.Target === "mask" ? "mask" : "coverage";
        Select("#viewport-object").textContent = Layer.Name;
        Select("#viewport-subtitle").textContent =
            this.ViewMode === "plane"
                ? `Texture space · ${DisplayOrdering.find((Entry) => Entry.Identifier === this.Display)?.Label}`
                : `${Tool?.Label} → ${Target} · ${LayerSummary(Layer)}`;
        Select("#live-pill").querySelector("span").textContent =
            this.ViewMode === "plane" ? "TEXTURE SPACE" : this.Display === "material" ? "OPENPBR" : this.Display.toUpperCase();
    }

    UpdateStatusBar()
    {
        const Resolution = this.Project.Resolution;
        Select("#texel-count").textContent = `${((Resolution * Resolution) / 1e6).toFixed(2)} Mtexel · ${Resolution}²`;
        Select("#surface-status").textContent = this.SurfaceRecord
            ? `${this.SurfaceRecord.Label} · ${this.SurfaceRecord.Triangles.toLocaleString()} tris`
            : "No surface";
        Select("#revision-status").textContent = `${this.Revisions.Depth} revisions · ${this.Revisions.Megabytes.toFixed(1)} MB`;
        Select("#undo-button").disabled = !this.Revisions.CanUndo;
        Select("#redo-button").disabled = !this.Revisions.CanRedo;
    }

    UpdateDiagnostics()
    {
        if (Select("#diagnostics").hidden) return;
        const Statistics = this.Integrator.Statistics;
        const Entries = [
            ["Frames per second", this.FramesPerSecond.toFixed(0)],
            ["Composites", Statistics.Composites.toLocaleString()],
            ["Composite time", `${(Statistics.CompositeMicroseconds / 1000).toFixed(2)} ms`],
            ["Stamps", Statistics.Stamps.toLocaleString()],
            ["Layers composited", String(Statistics.Layers)],
            ["Triangles", Statistics.Triangles.toLocaleString()],
            ["Occlusion bake", this.OcclusionMilliseconds ? `${this.OcclusionMilliseconds} ms` : "—"],
            ["Revision bytes", `${this.Revisions.Megabytes.toFixed(1)} MB`],
        ];
        Select("#diagnostic-values").innerHTML = Entries.map(
            ([Term, Value]) => `<dt>${Escape(Term)}</dt><dd>${Escape(Value)}</dd>`,
        ).join("");
    }

    Resize()
    {
        const Viewport = Select("#viewport");
        const Ratio = Math.min(window.devicePixelRatio || 1, 2);
        const Bounds = Viewport.getBoundingClientRect();
        this.Integrator.Resize(Bounds.width, Bounds.height, Ratio);
        this.Camera.Aspect = Math.max(Bounds.width / Math.max(Bounds.height, 1), 0.1);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Frame loop.
    //----------------------------------------------------------------------------------------------------------------------
    Advance()
    {
        if (!this.Integrator.Ready)
        {
            // The device went away mid-session. Keep the loop alive so a rebuilt context picks straight back up.
            requestAnimationFrame(() => this.Advance());
            return;
        }
        const Now = performance.now();
        const Delta = Math.min((Now - this.LastTime) / 1000, 0.1);
        this.LastTime = Now;
        this.Frames += 1;
        if (Now - this.LastSample > 500)
        {
            this.FramesPerSecond = (this.Frames * 1000) / (Now - this.LastSample);
            this.Frames = 0;
            this.LastSample = Now;
            Select("#frames").textContent = this.FramesPerSecond.toFixed(0);
            this.UpdateDiagnostics();
        }
        this.Camera.Advance(Delta);
        const Options = {
            Environment: this.Project.Environment,
            Material: this.Project.Material,
            Display: DisplayIndex(this.Display),
            CheckerScale: 16,
            Cursor: this.Tool === "brush" || this.Tool === "eraser" ? this.Cursor : null,
        };
        if (this.ViewMode === "plane")
            this.Integrator.RenderPlane({
                ...Options,
                Pan: this.PlanePan,
                Zoom: this.PlaneZoom,
                Cursor: this.Tool === "brush" || this.Tool === "eraser" ? this.PlaneCursor : null,
            });
        else this.Integrator.RenderViewport(this.Camera, Options);
        requestAnimationFrame(() => this.Advance());
    }
}

const ChannelTint = (Identifier) =>
    ({
        base_color: "#e2e2e6",
        geometry_opacity: "#8f8f95",
        specular_roughness: "#b1bfd0",
        base_metalness: "#d7c48d",
        ambient_occlusion: "#9a9a9a",
        height: "#8fd6a0",
        specular_weight: "#9fc2e8",
        coat_weight: "#c4a7ea",
        coat_roughness: "#a98ed6",
        fuzz_weight: "#e8b0c8",
        emission_color: "#ffb454",
        transmission_weight: "#7fd8e0",
    })[Identifier] || "#9a9a9a";

window.addEventListener("DOMContentLoaded", () =>
{
    window.TextureEditor = new TexturePanel();
});

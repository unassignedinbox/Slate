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
import {
    AssembleScene,
    CreateObject,
    ObjectAtTriangle,
    CoordinateTile,
    TileNumber,
    TilePlacement,
    FirstTile,
} from "./SceneStructure.js";
import { RevisionQueue } from "./RevisionQueue.js";
import { DocumentSequence } from "./DocumentSequence.js";
import { EmitTextureSet, EmitProject, ReadDocument, DocumentExtension } from "./ExportSequence.js";
import { TimelineSequence, EventByKind, EventClock, EventKinds } from "./TimelineSequence.js";
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
    SurfaceControls,
    EnvironmentOrdering,
    MaterialLibrary,
    MaterialByIdentifier,
} from "./MaterialSpecification.js";
import {
    FinishFamilies,
    FinishShelf,
    FinishByIdentifier,
    FinishControls,
    FinishColours,
    FinishStyles,
    FinishLabel,
    CreateFinish,
} from "./FinishSpecification.js";
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
    LayerChannelCount,
    LayerSummary,
    MaskKinds,
    CreateMark,
    MarkLimit,
} from "./LayerSpecification.js";
import { DecalLibrary, DecalCategories, DecalResolution, FontArchive, RasteriseDecal, SanitiseMarkup } from "./DecalSpecification.js";

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
    material: '<circle cx="12" cy="12" r="8.5"/><path d="M7 15.6A6.2 6.2 0 0 1 15.6 7"/><circle cx="15.4" cy="8.6" r="1.1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/>',
    drag: '<path d="M5 9h14M5 15h14"/>',
};

const Icon = (Name) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${GlyphPaths[Name] || GlyphPaths.box}</svg>`;

const FillIcons = (Root = document) =>
    [...Root.querySelectorAll("[data-icon]")].forEach((Element) =>
    {
        Element.innerHTML = Icon(Element.dataset.icon);
    });

// Which channels a procedural finish produces itself, and which it merely scales.
const FinishChannelRoles = {
    base_color: "driven",
    specular_roughness: "driven",
    base_metalness: "driven",
    height: "driven",
    coat_weight: "driven",
    coat_roughness: "driven",
    fuzz_weight: "driven",
    ambient_occlusion: "scaled",
    specular_weight: "scaled",
};

const FinishChannelRole = (Identifier) => FinishChannelRoles[Identifier] || "";

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

//--------------------------------------------------------------------------------------------------------------------------
// Native dropdowns paint themselves with the platform's own menu, which ignores every colour in the theme. Rather than
// replace the element — every binding in the panel reads the select — it is hidden behind a face button and a list that
// writes the value back and re-fires change, so the record never notices the difference.
//--------------------------------------------------------------------------------------------------------------------------
const ShutDropdowns = (Root, Except) =>
{
    for (const Shell of Root.querySelectorAll(".dropdown.open"))
    {
        if (Shell === Except) continue;
        Shell.classList.remove("open");
        Shell.querySelector(".dropdown-list").hidden = true;
        Shell.querySelector(".dropdown-face").setAttribute("aria-expanded", "false");
    }
};

const DressSelect = (Field) =>
{
    if (Field.dataset.dressed) return;
    Field.dataset.dressed = "1";
    const Shell = Field.ownerDocument.createElement("div");
    Shell.className = "dropdown";
    Field.parentNode.insertBefore(Shell, Field);
    Shell.appendChild(Field);

    const Face = Field.ownerDocument.createElement("button");
    Face.type = "button";
    Face.className = "dropdown-face";
    Face.setAttribute("aria-haspopup", "listbox");
    Face.setAttribute("aria-expanded", "false");
    if (Field.getAttribute("aria-label")) Face.setAttribute("aria-label", Field.getAttribute("aria-label"));
    Shell.appendChild(Face);

    const List = Field.ownerDocument.createElement("div");
    List.className = "dropdown-list";
    List.setAttribute("role", "listbox");
    List.hidden = true;
    Shell.appendChild(List);

    const Paint = () =>
    {
        const Chosen = Field.options[Field.selectedIndex];
        Face.innerHTML =
            `<span>${Escape(Chosen ? Chosen.textContent.trim() : "")}</span>` +
            `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" /></svg>`;
        List.innerHTML = [...Field.options].map(
            (Option, Index) =>
                `<button type="button" role="option" data-index="${Index}" class="${Index === Field.selectedIndex ? "chosen" : ""}"
                         aria-selected="${Index === Field.selectedIndex}">${Escape(Option.textContent.trim())}</button>`,
        ).join("");
    };

    const Shut = () =>
    {
        List.hidden = true;
        Shell.classList.remove("open");
        Face.setAttribute("aria-expanded", "false");
    };

    Face.addEventListener("click", (Event) =>
    {
        Event.preventDefault();
        Event.stopPropagation();
        const Opening = List.hidden;
        ShutDropdowns(Field.ownerDocument, Shell);
        List.hidden = !Opening;
        Shell.classList.toggle("open", Opening);
        Face.setAttribute("aria-expanded", String(Opening));
        if (Opening)
        {
            // Drop upwards when the list would run off the bottom of the window.
            const Room = (Field.ownerDocument.defaultView?.innerHeight || 800) - Face.getBoundingClientRect().bottom;
            Shell.classList.toggle("drop-up", Room < Math.min(264, Field.options.length * 34 + 16));
            List.querySelector(".chosen")?.scrollIntoView?.({ block: "nearest" });
        }
    });
    List.addEventListener("click", (Event) =>
    {
        const Option = Event.target.closest("[data-index]");
        if (!Option) return;
        Field.selectedIndex = Number(Option.dataset.index);
        Paint();
        Shut();
        Field.dispatchEvent(new Field.ownerDocument.defaultView.Event("change", { bubbles: true }));
    });
    Face.addEventListener("keydown", (Event) =>
    {
        if (Event.key !== "ArrowDown" && Event.key !== "ArrowUp") return;
        Event.preventDefault();
        const Step = Event.key === "ArrowDown" ? 1 : -1;
        const Next = Math.min(Field.options.length - 1, Math.max(0, Field.selectedIndex + Step));
        if (Next === Field.selectedIndex) return;
        Field.selectedIndex = Next;
        Paint();
        Field.dispatchEvent(new Field.ownerDocument.defaultView.Event("change", { bubbles: true }));
    });
    Field.addEventListener("change", Paint);
    Field.addEventListener("dressrefresh", Paint);
    Paint();
};

const DressSelects = (Root) => Root.querySelectorAll("select").forEach((Field) => DressSelect(Field));

// Setting .value in code fires nothing, so the face is asked to redraw itself.
const RefreshSelect = (Field) => Field?.dispatchEvent(new Field.ownerDocument.defaultView.Event("dressrefresh"));

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
        this.Timeline = new TimelineSequence();
        this.Timeline.Listener = () => this.RenderTimeline();
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
        this.DisplayBefore = "";
        this.BrowserState = "closed";
        this.BrowserSelection = "materials/automotive";
        this.BrowserView = "grid";
        this.BrowserQuery = "";
        this.BrowserOpen = ["materials"];
        this.PickingMaskColour = false;
        this.ToolBefore = "";
        this.Isolated = false;
        this.ScopedStack = false;
        this.HoverTile = FirstTile;
        this.HoverObject = "";
        this.SecondaryPainting = false;
        this.PickCandidate = null;
        this.Placement = null;
        this.MovingMark = "";
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
        this.AdoptSoftwareLimits();
        this.Documents = new DocumentSequence(this, Icon);
        this.BindHeader();
        this.BindStack();
        this.BindObjects();
        this.BindViewport();
        this.BindBrowser();
        this.BindTransport();
        this.BindInspector();
        this.BindDialogs();
        this.BindKeyboard();
        this.Integrator.Configure(this.Project.Resolution);
        this.RebuildSurface(true);
        this.RenderStack();
        this.RenderObjects();
        this.RenderInspector();
        this.RenderChannelStrip();
        this.SyncPaintTarget();
        this.SyncMaskView();
        DressSelects(document);
        this.Advance();
        this.Timeline.Clear({
            Kind: "document",
            Title: "Canvas created",
            Detail: `${this.Project.Resolution}² · ${this.SurfaceRecord?.Label || "surface"}`,
        });
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
        const Layer = this.ActiveLayer;
        if (this.Projection.Brush.Target === "mask" && Layer && Layer.Mask.Kind === "none")
            this.Projection.Configure({ Target: "coverage" });
        this.RenderStack();
        this.RenderInspector();
        this.RenderChannelStrip();
        this.SyncPaintTarget();
        this.SyncMaskView();
        if (this.MaskView !== "off") this.Recomposite();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Surface construction, occlusion bake and compositing.
    //----------------------------------------------------------------------------------------------------------------------
    RebuildSurface(Initial = false)
    {
        const Objects = this.SceneObjects;
        this.SetStatus(Objects.length === 1 ? `Building ${Objects[0].Kind}` : `Building ${Objects.length} objects`, "busy");
        this.SurfaceRecord = AssembleScene(Objects, this.ImportedSurface);
        this.Index = new SurfaceIndex(this.SurfaceRecord);
        this.Integrator.SetSurface(this.SurfaceRecord);
        this.RenderObjects();
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
        // Generator and colour masks exist only as a recipe until something resolves them, so the preview pass runs
        // whenever the viewport is actually showing a mask.
        if (this.Display === "mask" || this.Display === "mask_overlay")
            this.Integrator.RefreshMaskPreview(this.ActiveLayer, this.Project.Material);
        else this.Integrator.MaskPreviewLayer = "";
    }

    MarkDirty()
    {
        this.Dirty = true;
        Select("#dirty-indicator").classList.remove("clean");
    }

    MarkClean()
    {
        this.Dirty = false;
        Select("#dirty-indicator").classList.add("clean");
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
        Select("#workspace-button").addEventListener("click", () => this.SetViewMode("surface"));
        Select("#shelf-button").addEventListener("click", () => this.SetViewMode("plane"));
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Objects. A scene is a list of them; the renderer only ever sees the one surface they are folded into, so a stroke
    // crosses from object to object without knowing it, and isolation is simply leaving the others out of the assembly.
    //----------------------------------------------------------------------------------------------------------------------
    get SceneObjects()
    {
        const Objects = this.Project.Objects || [];
        if (!Objects.length) this.Project.Objects = [CreateObject({ Name: "Object", Kind: this.Project.Surface.Kind })];
        if (this.Isolated)
        {
            const Only = this.Project.Objects.find((Entry) => Entry.Identifier === this.Project.Object);
            if (Only) return [{ ...Only, Visible: true }];
        }
        return this.Project.Objects;
    }

    get ActiveObject()
    {
        return (
            this.Project.Objects.find((Entry) => Entry.Identifier === this.Project.Object) ||
            this.Project.Objects[0] ||
            null
        );
    }

    SelectObject(Identifier, Announce = false)
    {
        if (!this.Project.Objects.some((Entry) => Entry.Identifier === Identifier)) return;
        this.Project.Object = Identifier;
        this.RenderObjects();
        if (this.ScopedStack) this.RenderStack();
        this.SyncScopeToggle();
        if (this.InspectorTab === "surface") this.RenderInspector();
        if (this.Isolated) this.RebuildSurface();
        if (Announce) this.Notify(`${this.ActiveObject.Name} selected.`);
    }

    AddObject(Kind = "cube")
    {
        const Taken = new Set(this.Project.Objects.map((Entry) => Entry.Tile));
        let Tile = FirstTile;
        while (Taken.has(Tile) && Tile < FirstTile + 99) Tile += 1;
        const Label = SurfaceOrdering.find((Entry) => Entry.Identifier === Kind)?.Label || "Object";
        const Count = this.Project.Objects.length;
        const Spread = 1.9;
        const Object_ = CreateObject({
            Name: `${Label} ${Count + 1}`,
            Kind,
            Subdivision: 2,
            Tile,
            Offset: [((Count % 3) - 1) * Spread, 0, Math.floor(Count / 3) * -Spread],
        });
        this.CaptureStack(() =>
        {
            this.Project.Objects.push(Object_);
            this.Project.Object = Object_.Identifier;
        });
        this.RebuildSurface();
        this.Chronicle("surface", `Added ${Object_.Name}`, `tile ${Tile} · ${this.Project.Objects.length} objects`);
        this.Notify(`${Object_.Name} added on tile ${Tile}.`);
        return Object_;
    }

    RemoveObject(Identifier)
    {
        if (this.Project.Objects.length <= 1) return;
        const Index = this.Project.Objects.findIndex((Entry) => Entry.Identifier === Identifier);
        if (Index < 0) return;
        const [Gone] = this.Project.Objects.splice(Index, 1);
        this.CaptureStack(() =>
        {
            if (this.Project.Object === Identifier) this.Project.Object = this.Project.Objects[0].Identifier;
        });
        this.RebuildSurface();
        this.Chronicle("surface", `Removed ${Gone.Name}`, `${this.Project.Objects.length} objects left`);
        this.Notify(`${Gone.Name} removed.`);
    }

    ToggleObject(Identifier)
    {
        const Object_ = this.Project.Objects.find((Entry) => Entry.Identifier === Identifier);
        if (!Object_) return;
        if (Object_.Visible && this.Project.Objects.filter((Entry) => Entry.Visible).length === 1) return;
        this.CaptureStack(() => (Object_.Visible = !Object_.Visible));
        this.RebuildSurface();
    }

    SetIsolation(State)
    {
        this.Isolated = Boolean(State);
        Select("#isolate-button").classList.toggle("active", this.Isolated);
        Select("#isolate-button").setAttribute("aria-pressed", String(this.Isolated));
        this.RebuildSurface();
        this.Chronicle("surface", this.Isolated ? `Isolated ${this.ActiveObject?.Name}` : "Showing every object", `${this.Project.Objects.length} objects`);
        this.Notify(this.Isolated ? `Isolated ${this.ActiveObject?.Name}.` : "Showing every object.");
    }

    RenderObjects()
    {
        const List = Select("#object-list");
        if (!List) return;
        const Objects = this.Project.Objects || [];
        Select("#object-count").textContent = String(Objects.length);
        List.innerHTML = Objects.map((Entry) =>
        {
            const Selected = Entry.Identifier === this.Project.Object;
            const Record = this.SurfaceRecord?.Ranges?.find((Range) => Range.Identifier === Entry.Identifier);
            const Glyph = GlyphPaths[Entry.Kind] ? Entry.Kind : "box";
            return `
            <div class="object-row ${Selected ? "selected" : ""} ${Entry.Visible ? "" : "muted"}"
                 data-object-row="${Entry.Identifier}" role="treeitem" aria-selected="${Selected}" tabindex="0">
                <span class="object-symbol">${Icon(Glyph)}</span>
                <span class="object-copy">
                    <span class="object-name">${Escape(Entry.Name)}</span>
                    <span class="object-note">${Escape(Entry.Kind)} · ${Record ? `${Record.TriangleCount.toLocaleString()} tris` : "—"}</span>
                </span>
                <span class="object-tile" title="UDIM tile">${Entry.Tile}</span>
                <button class="icon-button row-toggle" data-object-toggle="${Entry.Identifier}"
                        aria-label="${Entry.Visible ? "Hide" : "Show"} ${Escape(Entry.Name)}" title="${Entry.Visible ? "Hide" : "Show"}">
                    ${Icon(Entry.Visible ? "eye" : "hidden")}
                </button>
            </div>`;
        }).join("");
        const Tiles = this.SurfaceRecord?.Tiles?.Columns || 1;
        Select("#uv-tiles")?.replaceChildren();
        this.RenderTileGrid(Tiles);
    }

    BindObjects()
    {
        Select("#object-list").addEventListener("click", (Event) =>
        {
            const Toggle = Event.target.closest("[data-object-toggle]");
            if (Toggle)
            {
                this.ToggleObject(Toggle.dataset.objectToggle);
                return;
            }
            const Row = Event.target.closest("[data-object-row]");
            if (Row) this.SelectObject(Row.dataset.objectRow);
        });
        Select("#object-list").addEventListener("dblclick", (Event) =>
        {
            const Row = Event.target.closest("[data-object-row]");
            if (Row) this.RenameObject(Row.dataset.objectRow);
        });
        Select("#add-object").addEventListener("click", () => this.AddObject("cube"));
        Select("#scope-toggle").addEventListener("click", () => this.SetStackScope(!this.ScopedStack));
        Select("#isolate-button").addEventListener("click", () => this.SetIsolation(!this.Isolated));
        Select("#outliner-fold").addEventListener("click", () =>
        {
            const Folded = Select("#outliner").classList.toggle("folded");
            Select("#outliner-fold").setAttribute("aria-expanded", String(!Folded));
        });
    }

    // The stack can follow the outliner: scoped, it lists the selected object's layers and the scene-wide ones.
    SetStackScope(State)
    {
        this.ScopedStack = Boolean(State);
        this.SyncScopeToggle();
        this.RenderStack();
        this.Notify(this.ScopedStack ? `Stack scoped to ${this.ActiveObject?.Name}.` : "Stack showing the whole scene.");
    }

    SyncScopeToggle()
    {
        const Button = Select("#scope-toggle");
        if (!Button) return;
        Button.classList.toggle("active", this.ScopedStack);
        Button.setAttribute("aria-pressed", String(this.ScopedStack));
        Select("#scope-label").textContent = this.ScopedStack ? this.ActiveObject?.Name || "Object" : "Whole scene";
    }

    RenameObject(Identifier)
    {
        const Object_ = this.Project.Objects.find((Entry) => Entry.Identifier === Identifier);
        const Row = Select(`[data-object-row="${Identifier}"] .object-name`);
        if (!Object_ || !Row) return;
        Row.contentEditable = "true";
        Row.focus();
        const Commit = () =>
        {
            Row.contentEditable = "false";
            const Name = Row.textContent.trim().slice(0, 64) || Object_.Name;
            this.CaptureStack(() => (Object_.Name = Name));
            this.RenderObjects();
        };
        Row.addEventListener("blur", Commit, { once: true });
        Row.addEventListener("keydown", (Event) =>
        {
            Event.stopPropagation();
            if (Event.key === "Enter")
            {
                Event.preventDefault();
                Row.blur();
            }
        });
    }

    // The UV view draws its tile grid as an overlay rather than in the shader, because the tiles want numbers on them.
    RenderTileGrid(Span)
    {
        const Host = Select("#uv-tiles");
        if (!Host) return;
        Host.dataset.span = String(Span);
        Host.innerHTML = Array.from({ length: Span * Span }, (Ignored, Index) =>
        {
            const Column = Index % Span;
            const Row = Math.floor(Index / Span);
            const Tile = TileNumber(Column, Row);
            const Occupied = (this.SurfaceRecord?.Ranges || []).some((Range) => Range.Tile === Tile);
            const Owner = (this.SurfaceRecord?.Ranges || []).find((Range) => Range.Tile === Tile);
            return `<div class="uv-tile ${Occupied ? "occupied" : ""} ${Tile === this.HoverTile ? "hovered" : ""}" data-tile="${Tile}"
                         style="left:${(Column / Span) * 100}%; bottom:${(Row / Span) * 100}%; width:${100 / Span}%; height:${100 / Span}%">
                        <span>${Tile}</span>${Owner ? `<small>${Escape(Owner.Name)}</small>` : ""}
                    </div>`;
        }).join("");
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Content browser. A drawer across the foot of the viewport: a library column on the left, a shelf of tiles on the
    // right, and one click to put whatever is on the shelf into the document.
    //----------------------------------------------------------------------------------------------------------------------
    BrowserSections()
    {
        return [
            {
                Identifier: "materials",
                Label: "Materials",
                Items: [
                    ...FinishFamilies.map((Family) => ({ Identifier: Family.Identifier, Label: Family.Label })),
                    { Identifier: "presets", Label: "Surface presets" },
                ],
            },
            {
                Identifier: "decals",
                Label: "Decals",
                Items: [
                    ...DecalCategories.filter((Category) => Category.Identifier !== "all").map((Category) => ({
                        Identifier: Category.Identifier,
                        Label: Category.Label,
                    })),
                    { Identifier: "text", Label: "Type" },
                ],
            },
            {
                Identifier: "generators",
                Label: "Generators",
                Items: [
                    { Identifier: "synthetic", Label: "Procedural" },
                    { Identifier: "baked", Label: "Baked fields" },
                ],
            },
            {
                Identifier: "scene",
                Label: "Scene",
                Items: [
                    { Identifier: "surfaces", Label: "Surfaces" },
                    { Identifier: "environments", Label: "Lighting" },
                ],
            },
        ];
    }

    BrowserItems(Selection = this.BrowserSelection)
    {
        const [Section, Item] = Selection.split("/");
        const Finishes = (Family) =>
            FinishShelf.filter((Entry) => Entry.Family === Family).map((Entry) => ({
                Identifier: Entry.Identifier,
                Label: Entry.Label,
                Note: Entry.Note,
                Type: "Material",
                Measure: FinishFamilies.find((Family2) => Family2.Identifier === Entry.Family)?.Label || "",
                Swatch: Entry.Swatch,
            }));
        if (Section === "materials" && Item === "presets")
            return MaterialLibrary.map((Entry) => ({
                Identifier: Entry.Identifier,
                Label: Entry.Label,
                Note: Entry.Note,
                Type: "Preset",
                Measure: `${Entry.Layers.length} layer${Entry.Layers.length === 1 ? "" : "s"}`,
                Swatch: Entry.Swatch,
            }));
        if (Section === "materials") return Finishes(Item);
        if (Section === "decals" && Item === "text")
            return FontArchive.map((Entry) => ({
                Identifier: Entry.Family,
                Label: Entry.Family,
                Note: `Text decal set in ${Entry.Family}`,
                Type: "Type",
                Measure: Entry.Note || "Regular",
                Swatch: "#1d1d1d",
                Markup: `<span class="browser-type" style="font-family:'${Entry.Family}', 'DM Sans', sans-serif">Ag</span>`,
            }));
        if (Section === "decals")
            return DecalLibrary.filter((Mark) => Mark.Category === Item).map((Mark) => ({
                Identifier: Mark.Identifier,
                Label: Mark.Label,
                Note: Mark.Note,
                Type: "Decal",
                Measure: `${DecalResolution}²`,
                Swatch: "#17171a",
                Markup: `<svg viewBox="0 0 100 100" class="browser-mark">${Mark.Markup}</svg>`,
            }));
        if (Section === "generators")
            return GeneratorOrdering.filter((Entry) => Entry.Family === Item).map((Entry) => ({
                Identifier: Entry.Identifier,
                Label: Entry.Label,
                Note: Entry.Hint,
                Type: "Generator",
                Measure: Entry.Family === "baked" ? "From the bake" : "Procedural",
                Swatch: Entry.Family === "baked" ? "#8fd6a0" : "#5aa9ff",
            }));
        if (Section === "scene" && Item === "surfaces")
            return SurfaceOrdering.map((Entry) => ({
                Identifier: Entry.Identifier,
                Label: Entry.Label,
                Note: Entry.Note,
                Type: "Surface",
                Measure: Entry.Note,
                Swatch: "#2a2a2e",
                Markup: `<span class="browser-glyph">${Icon(GlyphPaths[Entry.Identifier] ? Entry.Identifier : "box")}</span>`,
                Active: this.Project.Surface.Kind === Entry.Identifier,
            }));
        if (Section === "scene")
            return EnvironmentOrdering.map((Entry) => ({
                Identifier: Entry.Identifier,
                Label: Entry.Label,
                Note: `Key ${Entry.Key} · fill ${Entry.Fill}`,
                Type: "Lighting",
                Measure: `Key ${Entry.Key}`,
                Swatch: ToHex(Entry.Horizon),
                Markup: `<span class="browser-sky" style="background:linear-gradient(180deg, ${ToHex(Entry.Zenith)}, ${ToHex(
                    Entry.Horizon,
                )} 62%, ${ToHex(Entry.Ground)})"></span>`,
                Active: this.Project.Environment.Identifier === Entry.Identifier,
            }));
        return [];
    }

    BindBrowser()
    {
        const Shell = Select("#content-browser");
        const Tab = Select("#browser-tab");
        this.RenderBrowserLibrary();
        this.RenderBrowserItems();

        // Drag the tab to size the drawer; let go and it settles on the nearest of the three stops, the way the reference
        // sheet behaves. A short press with no travel is read as a tap and toggles instead.
        let Dragging = false;
        let Origin = 0;
        let Started = 0;
        let Travelled = 0;
        const Sheet = Select("#browser-body");
        const Height = () => Sheet.getBoundingClientRect().height;
        Tab.addEventListener("pointerdown", (Event) =>
        {
            Dragging = true;
            Travelled = 0;
            Origin = Event.clientY;
            Started = Height();
            Tab.setPointerCapture?.(Event.pointerId);
            Shell.classList.add("dragging");
        });
        Tab.addEventListener("pointermove", (Event) =>
        {
            if (!Dragging) return;
            const Delta = Origin - Event.clientY;
            Travelled = Math.max(Travelled, Math.abs(Delta));
            const Limit = Select("#viewport").getBoundingClientRect().height || 720;
            Shell.style.setProperty("--browser-height", `${Clamp(Started + Delta, 44, Limit * 0.92)}px`);
        });
        const Settle = (Event) =>
        {
            if (!Dragging) return;
            Dragging = false;
            Shell.classList.remove("dragging");
            Tab.releasePointerCapture?.(Event.pointerId);
            if (Travelled < 6)
            {
                this.SetBrowserState(this.BrowserState === "closed" ? "half" : "closed");
                Shell.style.removeProperty("--browser-height");
                return;
            }
            const Limit = Select("#viewport").getBoundingClientRect().height || 720;
            const Fraction = Height() / Math.max(Limit, 1);
            Shell.style.removeProperty("--browser-height");
            this.SetBrowserState(Fraction < 0.22 ? "closed" : Fraction < 0.66 ? "half" : "full");
        };
        Tab.addEventListener("pointerup", Settle);
        Tab.addEventListener("pointercancel", Settle);

        Select("#browser-button").addEventListener("click", () =>
            this.SetBrowserState(this.BrowserState === "closed" ? "half" : "closed"),
        );
        Select("#browser-close").addEventListener("click", () => this.SetBrowserState("closed"));
        Select("#browser-search-toggle").addEventListener("click", () => this.ToggleBrowserSearch());
        Select("#browser-search").addEventListener("input", (Event) =>
        {
            this.BrowserQuery = Event.target.value;
            this.RenderBrowserItems();
        });
        Select("#browser-search").addEventListener("keydown", (Event) =>
        {
            Event.stopPropagation();
            if (Event.key === "Escape") this.ToggleBrowserSearch(false);
        });
        SelectAll("[data-browser-view]").forEach((Button) =>
            Button.addEventListener("click", () =>
            {
                this.BrowserView = Button.dataset.browserView;
                SelectAll("[data-browser-view]").forEach((Other) =>
                    Other.classList.toggle("active", Other.dataset.browserView === this.BrowserView),
                );
                this.RenderBrowserItems();
            }),
        );
        Select("#browser-categories").addEventListener("click", (Event) =>
        {
            const Head = Event.target.closest("[data-browser-section]");
            if (Head)
            {
                const Identifier = Head.dataset.browserSection;
                this.BrowserOpen = this.BrowserOpen.includes(Identifier)
                    ? this.BrowserOpen.filter((Entry) => Entry !== Identifier)
                    : [...this.BrowserOpen, Identifier];
                this.RenderBrowserLibrary();
                return;
            }
            const Entry = Event.target.closest("[data-browser-item]");
            if (!Entry) return;
            this.BrowserSelection = Entry.dataset.browserItem;
            this.BrowserQuery = "";
            Select("#browser-search").value = "";
            this.RenderBrowserLibrary();
            this.RenderBrowserItems();
        });
        Select("#browser-items").addEventListener("click", (Event) =>
        {
            const Tile = Event.target.closest("[data-item]");
            if (!Tile) return;
            this.ApplyBrowserItem(Tile.dataset.item);
        });
    }

    SetBrowserState(State)
    {
        this.BrowserState = ["closed", "half", "full"].includes(State) ? State : "closed";
        const Shell = Select("#content-browser");
        Shell.dataset.state = this.BrowserState;
        Shell.style.removeProperty("--browser-height");
        Select("#browser-tab").setAttribute("aria-expanded", String(this.BrowserState !== "closed"));
        Select("#browser-button")?.classList.toggle("active", this.BrowserState !== "closed");
        if (this.BrowserState !== "closed") this.RenderBrowserItems();
    }

    ToggleBrowserSearch(Force)
    {
        const Field = Select("#browser-search");
        const Wanted = Force === undefined ? Field.hidden : Force;
        Field.hidden = !Wanted;
        Select(".browser-title").hidden = Wanted;
        Select("#browser-search-toggle").classList.toggle("active", Wanted);
        if (Wanted) Field.focus();
        else
        {
            Field.value = "";
            this.BrowserQuery = "";
            this.RenderBrowserItems();
        }
    }

    RenderBrowserLibrary()
    {
        const [Section] = this.BrowserSelection.split("/");
        Select("#browser-categories").innerHTML = this.BrowserSections()
            .map((Entry) =>
            {
                const Open = this.BrowserOpen.includes(Entry.Identifier) || Entry.Identifier === Section;
                return `
                <div class="browser-category ${Open ? "open" : ""}">
                    <button class="browser-category-head" data-browser-section="${Entry.Identifier}" aria-expanded="${Open}">
                        <span>${Escape(Entry.Label)}</span>${Icon("down")}
                    </button>
                    <div class="browser-category-items" ${Open ? "" : "hidden"}>
                        ${Entry.Items.map((Item) =>
                        {
                            const Key = `${Entry.Identifier}/${Item.Identifier}`;
                            return `<button class="browser-item ${Key === this.BrowserSelection ? "active" : ""}"
                                            data-browser-item="${Key}">${Escape(Item.Label)}</button>`;
                        }).join("")}
                    </div>
                </div>`;
            })
            .join("");
    }

    RenderBrowserItems()
    {
        const Query = this.BrowserQuery.trim().toLowerCase();
        const Items = this.BrowserItems().filter(
            (Item) => !Query || `${Item.Label} ${Item.Note || ""} ${Item.Type}`.toLowerCase().includes(Query),
        );
        const [Section, Item] = this.BrowserSelection.split("/");
        const Descriptor = this.BrowserSections().find((Entry) => Entry.Identifier === Section);
        const Label = Descriptor?.Items.find((Entry) => Entry.Identifier === Item)?.Label || "Content";
        Select("#browser-heading").textContent = Label;
        Select("#browser-count").textContent = `${Items.length} item${Items.length === 1 ? "" : "s"}${
            Query ? ` matching “${Query}”` : ""
        }`;
        const Shelf = Select("#browser-items");
        Shelf.dataset.view = this.BrowserView;
        if (!Items.length)
        {
            Shelf.innerHTML = `<div class="browser-empty">${Icon("search")}<p>No content found${
                Query ? ` for “${Escape(Query)}”` : ""
            }.</p></div>`;
            return;
        }
        Shelf.innerHTML = Items.map((Entry, Index) =>
        {
            const Thumb = Entry.Markup || `<span class="browser-fill" style="background:${Entry.Swatch}"></span>`;
            const Delay = `style="--delay:${((Index % 12) * 0.022).toFixed(3)}s"`;
            return this.BrowserView === "list"
                ? `<button class="browser-row ${Entry.Active ? "active" : ""}" data-item="${Entry.Identifier}" ${Delay}
                           title="${Escape(Entry.Note || Entry.Label)}">
                       <span class="browser-swatch" style="background:${Entry.Swatch}">${Entry.Markup || ""}</span>
                       <span class="browser-row-copy"><strong>${Escape(Entry.Label)}</strong>
                           <small>${Escape(Entry.Type)} · ${Escape(Entry.Measure || "")}</small></span>
                       <span class="browser-row-add">${Icon("plus")}</span>
                   </button>`
                : `<button class="browser-tile ${Entry.Active ? "active" : ""}" data-item="${Entry.Identifier}" ${Delay}
                           title="${Escape(Entry.Note || Entry.Label)}">
                       <span class="browser-thumb">${Thumb}</span>
                       <span class="browser-name">${Escape(Entry.Label)}<small>${Escape(Entry.Type)}</small></span>
                   </button>`;
        }).join("");
        FillIcons(Shelf);
    }

    ApplyBrowserItem(Identifier)
    {
        const [Section, Item] = this.BrowserSelection.split("/");
        if (Section === "materials" && Item === "presets")
        {
            const Preset = MaterialByIdentifier[Identifier];
            if (!Preset) return;
            const Layers = ExpandMaterial(Preset);
            this.CaptureStack(() =>
            {
                const Index = this.LayerIndex(this.Project.Selection);
                this.Project.Layers.splice(Index + 1, 0, ...Layers);
                this.Project.Material = { ...this.Project.Material, ...(Preset.Surface || {}) };
                this.Project.Selection = Layers[Layers.length - 1].Identifier;
            });
            this.Chronicle("material", `Create ${Preset.Label}`, `${Layers.length} layer${Layers.length === 1 ? "" : "s"}`, Layers[0]?.Channels?.base_color);
            this.Notify(`${Preset.Label} added — ${Layers.length} layer${Layers.length === 1 ? "" : "s"}.`);
            return;
        }
        if (Section === "materials")
        {
            this.AddFinishLayer(Identifier);
            return;
        }
        if (Section === "decals" && Item === "text")
        {
            const Layer = CreateLayer("decal", {
                Name: `${Identifier} text`,
                Decal: { SourceKind: "text", Text: { Family: Identifier } },
                Channels: { base_color: [0.95, 0.95, 0.96], specular_roughness: 0.28, height: 0.58 },
            });
            this.InsertBrowserLayer(Layer);
            this.RefreshDecal(Layer);
            return;
        }
        if (Section === "decals")
        {
            const Mark = DecalLibrary.find((Entry) => Entry.Identifier === Identifier);
            const Layer = CreateLayer("decal", {
                Name: Mark?.Label || "SVG decal",
                Decal: { SourceKind: "svg", Library: Identifier },
                Channels: { base_color: [0.92, 0.9, 0.2], specular_roughness: 0.34, height: 0.58 },
            });
            this.InsertBrowserLayer(Layer);
            this.RefreshDecal(Layer);
            return;
        }
        if (Section === "generators")
        {
            const Entry = GeneratorByIdentifier[Identifier];
            this.InsertBrowserLayer(
                CreateLayer("generator", { Name: Entry?.Label || "Generator", Generator: { Kind: Identifier } }),
            );
            return;
        }
        if (Section === "scene" && Item === "surfaces")
        {
            if (Identifier === "custom" && !this.ImportedSurface)
            {
                Select("#mesh-file").click();
                return;
            }
            this.CaptureStack(() => (this.Project.Surface.Kind = Identifier));
            this.RebuildSurface();
            this.RenderBrowserItems();
            this.Notify(`${SurfaceOrdering.find((Entry) => Entry.Identifier === Identifier)?.Label} loaded.`);
            return;
        }
        if (Section === "scene")
        {
            this.CaptureStack(() => (this.Project.Environment.Identifier = Identifier));
            this.RenderBrowserItems();
            this.RenderInspector();
            this.Notify(`${EnvironmentOrdering.find((Entry) => Entry.Identifier === Identifier)?.Label} lighting.`);
        }
    }

    InsertBrowserLayer(Layer)
    {
        const Index = this.LayerIndex(this.Project.Selection);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Layer);
            this.Project.Selection = Layer.Identifier;
        });
        this.Chronicle(Layer.Kind === "decal" ? "decal" : "structure", `Added ${Layer.Name}`, `${LayerBadge(Layer)} layer`, Layer.Channels.base_color);
        this.Notify(`${Layer.Name} added.`);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The surface and its unwrapped texture are two ways of looking at the same paint, so the switch lives in the header,
    // in the viewport bar and on the X key — all three come through here.
    //----------------------------------------------------------------------------------------------------------------------
    MarkHoveredTile()
    {
        for (const Element of document.querySelectorAll("#uv-tiles .uv-tile"))
            Element.classList.toggle("hovered", Element.dataset.tile === String(this.HoverTile));
    }

    // Names the object beneath the pointer in the viewport caption without redrawing anything else.
    NoteHover(Owner)
    {
        const Identifier = Owner?.Identifier || "";
        if (Identifier === this.HoverObject) return;
        this.HoverObject = Identifier;
        if (Owner) this.HoverTile = Owner.Tile;
        const Hint = Select("#viewport-hover");
        if (Hint) Hint.textContent = Owner && this.Project.Objects.length > 1 ? `${Owner.Name} · ${Owner.Tile}` : "";
    }

    SyncPlaneOverlay()
    {
        const Overlay = Select("#uv-overlay");
        if (!Overlay) return;
        const Showing = this.ViewMode === "plane";
        Overlay.hidden = !Showing;
        if (!Showing) return;
        const Canvas = Select("#surface-canvas");
        const Aspect = (Canvas.clientWidth || 1) / Math.max(Canvas.clientHeight || 1, 1);
        const Zoom = this.PlaneZoom;
        const Left = ((-0.5 - this.PlanePan[0]) * Zoom) / Aspect + 0.5;
        const Bottom = (-0.5 - this.PlanePan[1]) * Zoom + 0.5;
        const Plane = Select("#uv-plane");
        Plane.style.left = `${Left * 100}%`;
        Plane.style.bottom = `${Bottom * 100}%`;
        Plane.style.width = `${(Zoom / Aspect) * 100}%`;
        Plane.style.height = `${Zoom * 100}%`;
    }

    // Symmetry is only useful if you can see it: the button lights, the seam is drawn on the model, and the mirrored
    // cursor shows where the twin stroke will land.
    SetSymmetry(Axis, Announce = false)
    {
        const Known = SymmetryOrdering.some((Entry) => Entry.Identifier === Axis) ? Axis : "none";
        this.Projection.Configure({ Symmetry: Known });
        const Field = Select("#symmetry-select");
        if (Field)
        {
            Field.value = Known;
            RefreshSelect(Field);
            Field.closest(".dropdown")?.classList.toggle("armed", Known !== "none");
        }
        const Button = Select("#mirror-button");
        if (Button)
        {
            Button.classList.toggle("active", Known !== "none");
            Button.setAttribute("aria-pressed", String(Known !== "none"));
            Button.title = Known === "none" ? "Symmetry · S" : `Symmetry: mirror ${Known.toUpperCase()} · S`;
        }
        this.UpdateCaption();
        if (Announce)
            this.Notify(Known === "none" ? "Symmetry off." : `Mirroring across ${Known.toUpperCase()}.`);
    }

    // The decal in hand, shown where it would land before the click that commits it.
    NotePlacement(Hit)
    {
        const Layer = this.ActiveLayer;
        if (!Hit || this.StrokeTool !== "decal" || Layer?.Kind !== "decal")
        {
            this.Placement = null;
            return;
        }
        const Frame = StrokeProjection.PlacementFrame(Hit);
        const Template = this.ActiveMark || Layer.Decal;
        const Transform = Template.Transform;
        this.Placement = {
            Layer: Layer.Identifier,
            Position: Frame.Position,
            Normal: Frame.Normal,
            Tangent: Frame.Tangent,
            Rotation: Transform.Rotation,
            Size: [Transform.Size, Transform.Size / Math.max(Transform.Aspect, 0.05)],
            Tint: Template.Tint,
            Colorise: Template.Colorise,
        };
    }

    // Off the mesh there is nothing to draw the ring on, so a dashed outline follows the pointer instead.
    SyncGhost(Event, Hit)
    {
        const Ghost = Select("#brush-ghost");
        if (!Ghost) return;
        const Painting = this.StrokeTool === "brush" || this.StrokeTool === "eraser";
        if (!Painting || Hit || this.ViewMode !== "surface")
        {
            Ghost.hidden = true;
            return;
        }
        const Bounds = this.Canvas.getBoundingClientRect();
        const Height = Bounds.height || 1;
        const Pixels = (this.Projection.Brush.Radius * Height) / (2 * Math.tan(this.Camera.FieldOfView / 2) * Math.max(this.Camera.Distance, 0.1));
        Ghost.hidden = false;
        Ghost.style.width = `${Math.max(Pixels * 2, 8)}px`;
        Ghost.style.height = `${Math.max(Pixels * 2, 8)}px`;
        Ghost.style.left = `${Event.clientX - Bounds.left}px`;
        Ghost.style.top = `${Event.clientY - Bounds.top}px`;
        Ghost.style.borderColor = ToHex(this.PreviewInk().Ink) + "88";
    }

    // What the next stroke would lay down, so the ring is a preview rather than an outline.
    PreviewInk()
    {
        const Brush = this.Projection.Brush;
        const Erasing = this.StrokeTool === "eraser";
        if (Brush.Target === "mask") return { Ink: Erasing ? [0.04, 0.04, 0.05] : [0.95, 0.95, 0.98], Preview: 0.4 };
        if (Erasing) return { Ink: [0.06, 0.06, 0.07], Preview: 0.32 };
        return { Ink: this.BrushColour, Preview: Clamp(Brush.Flow * 0.7, 0.12, 0.6) };
    }

    SetViewMode(Mode)
    {
        this.ViewMode = Mode === "plane" ? "plane" : "surface";
        Select("#view-mode").value = this.ViewMode;
        RefreshSelect(Select("#view-mode"));
        Select(".viewport").classList.toggle("plane-view", this.ViewMode === "plane");
        Select("#workspace-button").classList.toggle("active", this.ViewMode === "surface");
        Select("#shelf-button").classList.toggle("active", this.ViewMode === "plane");
        this.SyncPlaneOverlay();
        this.UpdateCaption();
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
            if (!Event.target.closest(".dropdown")) ShutDropdowns(document);
            if (!Event.target.closest("#add-menu") && !Event.target.closest("#add-button"))
            {
                Select("#add-menu").hidden = true;
                Select("#add-button").setAttribute("aria-expanded", "false");
            }
        });
        Select("#layer-stack").addEventListener("click", (Event) =>
        {
            const Chip = Event.target.closest("[data-chip]");
            if (Chip)
            {
                Event.stopPropagation();
                this.SelectLayer(Chip.dataset.chipLayer);
                this.SetPaintTarget(Chip.dataset.chip === "mask" ? "mask" : "coverage");
                return;
            }
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
            SelectAll(".layer-row.drop-target").forEach((Element) => Element.classList.remove("drop-target"));
            if (Row && Row.dataset.layer !== this.DragIdentifier) Row.classList.add("drop-target");
        });
        Stack.addEventListener("drop", (Event) =>
        {
            Event.preventDefault();
            const Row = Event.target.closest("[data-layer]");
            SelectAll(".layer-row.drop-target").forEach((Element) => Element.classList.remove("drop-target"));
            if (!Row || !this.DragIdentifier) return;
            this.MoveLayer(this.DragIdentifier, Row.dataset.layer);
            this.DragIdentifier = "";
        });
        Stack.addEventListener("dragend", () =>
        {
            SelectAll(".layer-row.dragging").forEach((Element) => Element.classList.remove("dragging"));
            SelectAll(".layer-row.drop-target").forEach((Element) => Element.classList.remove("drop-target"));
        });
    }

    VisibleLayers()
    {
        return [...this.Layers]
            .reverse()
            .filter((Layer) =>
            {
                // Scoped to the selected object, the stack shows that object's layers and the scene-wide ones under them.
                if (this.ScopedStack && Layer.Object && Layer.Object !== this.Project.Object) return false;
                if (this.LayerFilter === "masked")
                {
                    if (Layer.Mask.Kind === "none") return false;
                }
                else if (this.LayerFilter !== "all" && Layer.Kind !== this.LayerFilter) return false;
                if (!this.LayerQuery) return true;
                return `${Layer.Name} ${Layer.Kind} ${LayerBadge(Layer)}`.toLowerCase().includes(this.LayerQuery);
            });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // One card per layer. Each carries the two things a paint session keeps asking about: what the layer is, and whether
    // the brush is about to land in its content or in its mask.
    //----------------------------------------------------------------------------------------------------------------------
    RenderStack()
    {
        const Rows = this.VisibleLayers();
        const Masked = this.Layers.filter((Layer) => Layer.Mask.Kind !== "none").length;
        Select("#layer-count").textContent = String(this.Layers.length);
        SelectAll("#layer-filters button").forEach((Button) =>
        {
            const Active = Button.dataset.layerFilter === this.LayerFilter;
            Button.classList.toggle("active", Active);
            Button.setAttribute("aria-pressed", String(Active));
        });
        const Masking = this.Projection.Brush.Target === "mask";
        Select("#layer-stack").innerHTML = Rows.length
            ? Rows.map((Layer) =>
              {
                  const Kind = LayerKindByIdentifier[Layer.Kind];
                  const Selected = Layer.Identifier === this.Project.Selection;
                  const Carried = Layer.Mask.Kind !== "none";
                  // A finish never writes the flat base colour, so the plate shows the colour the recipe starts from.
                  const Swatch = ToHex(
                      (Layer.Kind === "finish" ? Layer.Finish?.ColourA : Layer.Channels.base_color) || [0.8, 0.8, 0.8],
                  );
                  const MaskNote = !Carried
                      ? "Add mask"
                      : Layer.Mask.Kind === "generator"
                        ? `${Layer.Mask.Generator.Kind}${Layer.Mask.Invert ? " · inverted" : ""}`
                        : Layer.Mask.Kind === "colour"
                          ? `Colour key${Layer.Mask.Invert ? " · inverted" : ""}`
                          : `Painted${Layer.Mask.Invert ? " · inverted" : ""}`;
                  return `
                <div class="layer-row ${Selected ? "selected" : ""} ${Layer.Visible ? "" : "muted"}"
                     data-layer="${Layer.Identifier}" data-object="${Layer.Kind}" draggable="true"
                     role="treeitem" aria-selected="${Selected}" tabindex="0">
                    <span class="layer-accent"></span>
                    <span class="layer-swatch" style="--swatch:${Swatch}">${Icon(Kind.Glyph)}</span>
                    <span class="layer-copy">
                        <span class="layer-name">${Escape(Layer.Name)}</span>
                        <span class="layer-note">${Escape(LayerBadge(Layer).toLowerCase())} · ${Escape(Layer.Blend)} · ${
                            Layer.Kind === "decal"
                                ? `${Layer.Decal.Marks.length} mark${Layer.Decal.Marks.length === 1 ? "" : "s"}`
                                : `${LayerChannelCount(Layer)} channels`
                        }</span>
                    </span>
                    <span class="layer-metric"><strong>${Math.round(Layer.Opacity * 100)}</strong><small>%</small></span>
                    <button class="icon-button row-toggle" data-toggle-layer="${Layer.Identifier}"
                            aria-label="${Layer.Visible ? "Hide" : "Show"} ${Escape(Layer.Name)}"
                            title="${Layer.Visible ? "Hide" : "Show"} layer">${Icon(Layer.Visible ? "eye" : "hidden")}</button>
                    <span class="layer-chips">
                        <button class="row-chip ${Selected && !Masking ? "targeted" : ""}" data-chip="content"
                                data-chip-layer="${Layer.Identifier}" title="Paint into the layer">
                            <span class="chip-swatch" style="--swatch:${Swatch}"></span>Content
                        </button>
                        <button class="row-chip mask-chip ${Carried ? "present" : "absent"} ${Selected && Masking ? "targeted" : ""}"
                                data-chip="mask" data-chip-layer="${Layer.Identifier}"
                                title="${Carried ? "Paint into the mask" : "Add a black mask"}">
                            ${Icon(Carried ? "mask" : "plus")}${Escape(MaskNote)}
                        </button>
                    </span>
                </div>`;
              }).join("")
            : `<div class="outliner-empty">No layers match that filter.</div>`;
        Select("#stack-subtitle").textContent =
            `${this.Layers.length} layer${this.Layers.length === 1 ? "" : "s"} · ${Masked} masked · top first`;
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
        this.SyncPaintTarget();
        this.SyncMaskView();
        this.UpdateStatusBar();
    }

    AddLayer(Kind)
    {
        // Two of the entries in the add menu are not layers of their own: one reaches for the material shelf, the other
        // opens the browser so the choice is made there.
        if (Kind === "finish")
        {
            this.AddFinishLayer("showroom-red");
            return;
        }
        if (Kind === "browse")
        {
            this.BrowserSelection = "materials/automotive";
            this.RenderBrowserLibrary();
            this.SetBrowserState("half");
            return;
        }
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
        if (this.ScopedStack || this.Isolated) Layer.Object = this.Project.Object;
        const Index = this.LayerIndex(this.Project.Selection);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Layer);
            this.Project.Selection = Layer.Identifier;
        });
        if (Layer.Kind === "decal") this.RefreshDecal(Layer);
        if (Layer.Kind === "stroke") this.Integrator.EnsureCoverage(Layer);
        this.Chronicle(Layer.Kind === "decal" ? "decal" : "structure", `Added ${Layer.Name}`, `${LayerBadge(Layer)} layer`, Layer.Channels.base_color);
        this.Notify(`${Layer.Name} added above ${Index >= 0 ? this.Layers[Index]?.Name || "the stack" : "the stack"}.`);
    }

    // A finish is added as its own layer kind. What lands in the inspector afterwards is the material's own vocabulary —
    // flake, weave, grain — not the flat channel sliders a fill would show.
    AddFinishLayer(Shelf)
    {
        const Entry = FinishByIdentifier[Shelf];
        const Finish = CreateFinish(Shelf);
        const Layer = CreateLayer("finish", { Name: Entry?.Label || FinishLabel(Finish), Finish });
        const Index = this.LayerIndex(this.Project.Selection);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Layer);
            this.Project.Selection = Layer.Identifier;
        });
        this.Chronicle("material", `Create ${Layer.Name}`, FinishLabel(Finish), Finish.ColourA);
        this.Notify(`${Layer.Name} added as a material layer.`);
        return Layer;
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
        this.Chronicle("structure", `Duplicated ${Layer.Name}`, `${this.Layers.length} layers`, Layer.Channels.base_color);
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
        this.Chronicle("structure", `Removed ${Layer.Name}`, `${this.Layers.length} layers left`);
        this.Notify(`${Layer.Name} removed.`);
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
            this.Placement = null;
            const Ghost = Select("#brush-ghost");
            if (Ghost) Ghost.hidden = true;
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
        Select("#view-mode").addEventListener("change", (Event) => this.SetViewMode(Event.target.value));
        SelectAll("[data-mask-view]").forEach((Button) =>
            Button.addEventListener("click", () => this.SetMaskView(Button.dataset.maskView)),
        );
        Select("#channel-select").innerHTML = DisplayOrdering.map(
            (Display) => `<option value="${Display.Identifier}">${Display.Label}</option>`,
        ).join("");
        Select("#channel-select").addEventListener("change", (Event) =>
        {
            this.Display = Event.target.value;
            if (this.MaskView === "off") this.DisplayBefore = "";
            this.Recomposite();
            this.SyncMaskView();
            this.RenderInspector();
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
            this.SetPaintTarget(this.Projection.Brush.Target === "mask" ? "coverage" : "mask"),
        );
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

    //----------------------------------------------------------------------------------------------------------------------
    // Masks. A mask is a greyscale image multiplied into the layer's coverage: black hides, white reveals. The brush paints
    // into either the layer's content or its mask, and which one it is landing in is stated in three places at once — the
    // row chips, the viewport toggle and the stack footer — because painting into the wrong one is the classic mistake.
    //----------------------------------------------------------------------------------------------------------------------
    SetPaintTarget(Target, Announce = true)
    {
        const Wanted = Target === "mask" ? "mask" : "coverage";
        if (Wanted === "mask")
        {
            const Layer = this.ActiveLayer;
            if (!Layer) return;
            if (Layer.Mask.Kind === "none") this.AddMask("black", false);
        }
        this.Projection.Configure({ Target: Wanted });
        this.SyncPaintTarget();
        if (Announce) this.Notify(Wanted === "mask" ? "Painting into the layer mask." : "Painting into the layer.");
    }

    SyncPaintTarget()
    {
        const Masking = this.Projection.Brush.Target === "mask";
        const Toggle = Select("#mask-toggle");
        Toggle.classList.toggle("active", Masking);
        Toggle.setAttribute("aria-pressed", String(Masking));
        const Note = Select("#paint-target-note");
        Note.textContent = Masking ? "Painting into the mask" : "Painting into layer content";
        Note.classList.toggle("masking", Masking);
        SelectAll(".row-chip").forEach((Chip) =>
            Chip.classList.toggle(
                "targeted",
                Chip.dataset.chip === (Masking ? "mask" : "content") && Chip.dataset.chipLayer === this.Project.Selection,
            ),
        );
        SelectAll(".target-switch button").forEach((Button) =>
        {
            const Active = Button.dataset.action === (Masking ? "target-mask" : "target-content");
            Button.classList.toggle("active", Active);
            Button.setAttribute("aria-pressed", String(Active));
        });
        this.UpdateCaption();
    }

    // A black mask hides the layer and is painted back in — the habit Substance teaches; a white one reveals and is painted away.
    AddMask(Mode = "black", Announce = true)
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Kind = Mode === "generator" ? "generator" : Mode === "colour" ? "colour" : "stroke";
        this.CaptureStack(() =>
        {
            Layer.Mask.Kind = Kind;
            Layer.Mask.Invert = false;
            // A colour mask keys on what is already beneath the layer, so the sensible first guess is that colour.
            if (Kind === "colour") Layer.Mask.Colour = [...this.ColourBeneath(Layer)];
        });
        if (Kind === "stroke")
        {
            this.Integrator.EnsureMask(Layer);
            this.Integrator.FloodLayer(Layer, "mask", [1, 1, 1], Mode === "white" ? 1 : 0);
        }
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
        this.SyncMaskView();
        if (Announce)
            this.Notify(
                Kind === "generator"
                    ? "Generator mask added."
                    : Kind === "colour"
                      ? "Colour mask added — pick the colour it should select."
                      : `${Mode === "white" ? "White" : "Black"} mask added.`,
            );
    }

    // The base colour of the nearest visible layer below, which is what a colour mask will be keying against.
    ColourBeneath(Layer)
    {
        const Index = this.LayerIndex(Layer.Identifier);
        for (let Probe = Index - 1; Probe >= 0; Probe -= 1)
        {
            const Lower = this.Layers[Probe];
            if (Lower.Visible && Lower.Enabled.base_color) return Lower.Channels.base_color;
        }
        return [0.5, 0.5, 0.5];
    }

    RemoveMask()
    {
        const Layer = this.ActiveLayer;
        if (!Layer || Layer.Mask.Kind === "none") return;
        this.CaptureStack(() =>
        {
            Layer.Mask.Kind = "none";
            Layer.Mask.Invert = false;
        });
        this.Integrator.ReleaseMask(Layer.Identifier);
        if (this.Projection.Brush.Target === "mask") this.Projection.Configure({ Target: "coverage" });
        if (this.MaskView !== "off") this.SetMaskView("off", false);
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
        this.SyncPaintTarget();
        this.SyncMaskView();
        this.Notify("Mask removed.");
    }

    InvertMask()
    {
        const Layer = this.ActiveLayer;
        if (!Layer || Layer.Mask.Kind === "none") return;
        this.CaptureStack(() => (Layer.Mask.Invert = !Layer.Mask.Invert));
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
        this.Notify(Layer.Mask.Invert ? "Mask inverted." : "Mask inversion cleared.");
    }

    // Three ways to look at a mask: not at all, washed over the shaded surface so you can keep painting, or on its own in
    // black and white. The previous view is remembered so the trip out and back is one click.
    get MaskView()
    {
        return this.Display === "mask" ? "isolated" : this.Display === "mask_overlay" ? "overlay" : "off";
    }

    SetMaskView(Mode, Announce = true)
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Wanted = Mode === "overlay" ? "mask_overlay" : Mode === "isolated" ? "mask" : "off";
        if (Wanted === "off")
        {
            this.Display = this.DisplayBefore || "material";
            this.DisplayBefore = "";
        }
        else
        {
            if (Layer.Mask.Kind === "none") this.AddMask("black", false);
            if (this.MaskView === "off") this.DisplayBefore = this.Display;
            this.Display = Wanted;
        }
        Select("#channel-select").value = this.Display;
        RefreshSelect(Select("#channel-select"));
        this.Recomposite();
        this.SyncMaskView();
        this.RenderInspector();
        this.UpdateCaption();
        if (!Announce) return;
        this.Notify(
            Wanted === "mask"
                ? "Showing the layer mask."
                : Wanted === "mask_overlay"
                  ? "Mask overlay on — the wash marks what the mask hides."
                  : "Back to the shaded surface.",
        );
    }

    SyncMaskView()
    {
        const View = this.MaskView;
        const Layer = this.ActiveLayer;
        const Masked = Boolean(Layer) && Layer.Mask.Kind !== "none";
        SelectAll("[data-mask-view]").forEach((Button) =>
        {
            const Active = Button.dataset.maskView === View;
            Button.classList.toggle("active", Active);
            Button.setAttribute("aria-pressed", String(Active));
        });
        const Group = Select("#mask-view");
        if (Group)
        {
            Group.classList.toggle("lit", View !== "off");
            Group.dataset.state = Masked ? "ready" : "empty";
        }
    }

    ViewMask()
    {
        this.SetMaskView(this.MaskView === "isolated" ? "off" : "isolated");
    }

    // One-shot eyedropper for a colour mask: the next pick writes the key colour rather than the brush colour.
    ArmColourPick()
    {
        const Layer = this.ActiveLayer;
        if (!Layer || Layer.Mask.Kind !== "colour") return;
        this.PickingMaskColour = true;
        this.ToolBefore = this.Tool;
        this.SetTool("picker");
        Select("#viewport")?.classList.add("picking-mask");
        this.Notify("Click the surface to key the mask to that colour.");
    }

    ResolveColourPick(Colour)
    {
        const Layer = this.ActiveLayer;
        this.PickingMaskColour = false;
        Select("#viewport")?.classList.remove("picking-mask");
        if (Layer && Layer.Mask.Kind === "colour")
        {
            this.CaptureStack(() => (Layer.Mask.Colour = [...Colour]));
            this.Notify(`Mask keyed to ${ToHex(Colour).toUpperCase()}.`);
        }
        if (this.ToolBefore) this.SetTool(this.ToolBefore);
        this.ToolBefore = "";
        this.RenderInspector();
    }

    FillMask(Value)
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        if (Layer.Mask.Kind !== "stroke") this.AddMask(Value >= 0.5 ? "white" : "black", false);
        else
        {
            this.Integrator.EnsureMask(Layer);
            this.Integrator.FloodLayer(Layer, "mask", [1, 1, 1], Value);
            this.Recomposite();
        }
        this.RenderStack();
        this.Notify(
            Value >= 0.5 ? "Mask filled white — the layer shows everywhere." : "Mask cleared to black — the layer is hidden.",
        );
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
        this.SecondaryPainting = Event.button === 2 && !this.SpaceHeld;
        const Navigating = !this.SecondaryPainting && (this.Tool === "orbit" || Event.button === 1 || this.SpaceHeld);
        this.Navigating = Navigating;
        this.PickCandidate = Navigating && this.Tool === "orbit" && Event.button === 0 ? [Event.clientX, Event.clientY] : null;
        if (Navigating) return;

        if (this.ViewMode === "plane")
        {
            if (this.StrokeTool === "brush" || this.StrokeTool === "eraser")
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
        if (this.StrokeTool === "picker")
        {
            const Sample = this.Integrator.PickTexel(Hit.Coordinate);
            if (Sample)
            {
                if (this.PickingMaskColour) this.ResolveColourPick(Sample.BaseColour);
                else
                {
                    this.BrushColour = Sample.BaseColour;
                    this.SyncBrushControls();
                    this.Notify(
                        `Picked ${ToHex(Sample.BaseColour).toUpperCase()} · roughness ${Sample.Roughness.toFixed(2)} · metalness ${Sample.Metalness.toFixed(2)}`,
                    );
                }
            }
            return;
        }
        if (this.StrokeTool === "decal")
        {
            this.PlaceDecal(Hit);
            return;
        }
        if (this.StrokeTool === "fill")
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
            const Tile = CoordinateTile(this.SurfaceRecord, Coordinate);
            if (Tile !== this.HoverTile)
            {
                this.HoverTile = Tile;
                this.MarkHoveredTile();
            }
            if (this.Projection.Active && (this.StrokeTool === "brush" || this.StrokeTool === "eraser"))
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
        this.NoteHover(Hit ? ObjectAtTriangle(this.SurfaceRecord, Hit.Triangle) : null);
        this.NotePlacement(Hit);
        this.SyncGhost(Event, Hit);
        if (this.MovingMark && this.PointerButton !== undefined)
        {
            this.MoveMark(Hit);
            return;
        }
        if (!Hit || !this.Projection.Active) return;
        if (this.StrokeTool !== "brush" && this.StrokeTool !== "eraser") return;
        const Segment = this.Projection.Extend(Hit);
        if (Segment) this.StampSurface(this.ActiveLayer, Segment);
    }

    OnPointerUp(Event)
    {
        if (this.Canvas.hasPointerCapture?.(Event.pointerId)) this.Canvas.releasePointerCapture(Event.pointerId);
        if (this.Projection.Active) this.CommitStrokeRevision();
        this.Projection.End();
        // A click that never became a drag, with the camera tool in hand, selects whatever object sits under it.
        if (this.PickCandidate && this.ViewMode === "surface")
        {
            const Travel = Math.hypot(Event.clientX - this.PickCandidate[0], Event.clientY - this.PickCandidate[1]);
            if (Travel < 4)
            {
                const [DeviceX, DeviceY] = this.DeviceCoordinates(Event);
                const Hit = this.Projection.Resolve(this.Index, this.Camera, DeviceX, DeviceY);
                const Owner = Hit ? ObjectAtTriangle(this.SurfaceRecord, Hit.Triangle) : null;
                if (Owner && Owner.Identifier !== this.Project.Object) this.SelectObject(Owner.Identifier, true);
            }
        }
        if (this.MovingMark)
        {
            this.RenderInspector();
            this.MovingMark = "";
        }
        this.PickCandidate = null;
        this.SecondaryPainting = false;
        this.Navigating = false;
        this.PointerButton = undefined;
        this.PointerPrevious = null;
    }

    // The tool the pointer is actually driving: the right button always paints, whatever is selected in the toolbar.
    get StrokeTool()
    {
        if (!this.SecondaryPainting) return this.Tool;
        return this.Tool === "eraser" ? "eraser" : "brush";
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
            if (this.StrokeRecord.Before && this.StrokeRecord.After)
            {
                this.Revisions.Record(this.StrokeRecord);
                const Points = this.Projection.Segments || 1;
                this.Chronicle(
                    "stroke",
                    `Added stroke (${Points} point${Points === 1 ? "" : "s"})`,
                    `${Layer.Name} · ${this.StrokeRecord.Target === "mask" ? "mask" : "content"}`,
                    this.Projection.Brush.Target === "mask" ? null : this.BrushColour,
                );
            }
        }
        this.StrokeRecord = null;
        this.UpdateStatusBar();
    }

    get ActiveMark()
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal") return null;
        const Marks = Layer.Decal.Marks || [];
        return Marks.find((Mark) => Mark.Identifier === Layer.Decal.Selection) || Marks[Marks.length - 1] || null;
    }

    MarkByIdentifier(Identifier)
    {
        return (this.ActiveLayer?.Decal?.Marks || []).find((Mark) => Mark.Identifier === Identifier) || null;
    }

    // Clicking the model drops another placement of the layer's artwork; dragging from that click moves it.
    PlaceDecal(Hit)
    {
        const Layer = this.ActiveLayer;
        if (Layer.Kind !== "decal")
        {
            this.Notify("Select a decal layer, or add one from the + menu.");
            return;
        }
        const Decal = Layer.Decal;
        if (Decal.Marks.length >= MarkLimit)
        {
            this.Notify(`A decal layer holds ${MarkLimit} marks. Remove one, or add another layer.`);
            return;
        }
        const Frame = StrokeProjection.PlacementFrame(Hit);
        const Template = this.ActiveMark || Decal;
        const Mark = CreateMark(Decal, {
            Name: `Mark ${Decal.Marks.length + 1}`,
            Folder: this.ActiveMark?.Folder || "",
            Mode: "projection",
            Tint: [...Template.Tint],
            Colorise: Template.Colorise !== false,
            Softness: Template.Softness,
            Emboss: Template.Emboss,
            Transform: { ...Template.Transform, Position: Frame.Position, Normal: Frame.Normal, Tangent: Frame.Tangent },
        });
        this.CaptureStack(() =>
        {
            Decal.Marks.push(Mark);
            Decal.Selection = Mark.Identifier;
        });
        this.MovingMark = Mark.Identifier;
        this.Chronicle("decal", `Placed ${Mark.Name}`, `${Layer.Name} · ${Decal.Marks.length} marks`, Mark.Tint);
        this.Recomposite();
        this.RenderStack();
        if (this.InspectorTab === "layer") this.RenderInspector();
        this.Notify(`${Mark.Name} placed — drag to move it.`);
    }

    // Dragging after the click slides the placement across the surface.
    MoveMark(Hit)
    {
        const Mark = this.MarkByIdentifier(this.MovingMark);
        if (!Mark || !Hit) return;
        const Frame = StrokeProjection.PlacementFrame(Hit);
        Mark.Transform.Position = Frame.Position;
        Mark.Transform.Normal = Frame.Normal;
        Mark.Transform.Tangent = Frame.Tangent;
        Mark.Mode = "projection";
        this.Recomposite();
        this.MarkDirty();
    }

    SelectMark(Identifier)
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal" || !this.MarkByIdentifier(Identifier)) return;
        Layer.Decal.Selection = Identifier;
        this.RenderInspector();
    }

    MarkAction(Action, Identifier)
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal") return;
        const Decal = Layer.Decal;
        const Index = Decal.Marks.findIndex((Mark) => Mark.Identifier === Identifier);
        const Mark = Decal.Marks[Index];
        if (Action === "mark-select")
        {
            this.SelectMark(Identifier);
            return;
        }
        if (!Mark && Action !== "mark-add") return;
        this.CaptureStack(() =>
        {
            if (Action === "mark-add")
            {
                if (Decal.Marks.length >= MarkLimit) return;
                const Template = this.ActiveMark || Decal;
                const Fresh = CreateMark(Decal, {
                    Name: `Mark ${Decal.Marks.length + 1}`,
                    Folder: Template.Folder || "",
                    Transform: { ...Template.Transform, Position: [...Template.Transform.Position] },
                });
                Decal.Marks.push(Fresh);
                Decal.Selection = Fresh.Identifier;
            }
            else if (Action === "mark-duplicate")
            {
                if (Decal.Marks.length >= MarkLimit) return;
                const Copy = structuredClone(Mark);
                Copy.Identifier = CreateMark(Decal).Identifier;
                Copy.Name = `${Mark.Name} copy`;
                Copy.Transform.Position = Mark.Transform.Position.map((Component, Axis) => Component + (Axis === 0 ? 0.06 : 0));
                Decal.Marks.splice(Index + 1, 0, Copy);
                Decal.Selection = Copy.Identifier;
            }
            else if (Action === "mark-remove")
            {
                if (Decal.Marks.length <= 1) return;
                Decal.Marks.splice(Index, 1);
                Decal.Selection = Decal.Marks[Math.min(Index, Decal.Marks.length - 1)].Identifier;
            }
            else if (Action === "mark-visible") Mark.Visible = !Mark.Visible;
            else if (Action === "mark-raise" && Index < Decal.Marks.length - 1)
                Decal.Marks.splice(Index + 1, 0, Decal.Marks.splice(Index, 1)[0]);
            else if (Action === "mark-lower" && Index > 0)
                Decal.Marks.splice(Index - 1, 0, Decal.Marks.splice(Index, 1)[0]);
        });
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
    }

    // A folder is renamed in place, and every mark inside it follows.
    RenameFolder(Summary)
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal") return;
        const Label = Summary.childNodes[1];
        const Before = Summary.textContent.replace(/\d+$/, "").trim();
        Summary.contentEditable = "true";
        Summary.focus();
        const Commit = () =>
        {
            Summary.contentEditable = "false";
            const After = Summary.textContent.replace(/\d+$/, "").trim().slice(0, 48);
            if (After && After !== Before)
                this.CaptureStack(() =>
                {
                    for (const Mark of Layer.Decal.Marks) if ((Mark.Folder || "") === Before) Mark.Folder = After;
                });
            this.RenderInspector();
        };
        Summary.addEventListener("blur", Commit, { once: true });
        Summary.addEventListener("keydown", (Event) =>
        {
            Event.stopPropagation();
            if (Event.key === "Enter")
            {
                Event.preventDefault();
                Summary.blur();
            }
        });
        void Label;
    }

    // Folders are just a name on each mark; the list groups by it, so a busy layer can be read at a glance.
    FoldMark(Identifier, Folder)
    {
        const Mark = this.MarkByIdentifier(Identifier);
        if (!Mark) return;
        this.CaptureStack(() => (Mark.Folder = String(Folder || "").slice(0, 48)));
        this.RenderInspector();
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
        Select("#symmetry-select").addEventListener("change", (Event) => this.SetSymmetry(Event.target.value));
        Select("#mirror-button").addEventListener("click", () =>
        {
            const Order = SymmetryOrdering.map((Entry) => Entry.Identifier);
            const Next = Order[(Order.indexOf(this.Projection.Brush.Symmetry) + 1) % Order.length];
            this.SetSymmetry(Next, true);
        });
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
        this.Timeline.StepBack();
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
        this.Timeline.StepForward();
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
        Body.addEventListener("change", (Event) =>
        {
            const Field = Event.target.closest("[data-mark-folder]");
            if (!Field || !this.ActiveMark) return;
            const Existing = new Set((this.ActiveLayer.Decal.Marks || []).map((Mark) => Mark.Folder).filter(Boolean));
            const Folder = Field.value === "__new" ? `Group ${Existing.size + 1}` : Field.value;
            this.FoldMark(this.ActiveMark.Identifier, Folder);
        });
        Body.addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-action]");
            if (!Button) return;
            this.OnInspectorAction(Button.dataset.action, Button.dataset.argument);
        });
        Body.addEventListener("dblclick", (Event) =>
        {
            const Summary = Event.target.closest(".mark-folder > summary");
            if (Summary) this.RenameFolder(Summary);
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
            Mark: this.ActiveMark,
            Finish: Layer?.Finish,
            Project: this.Project,
            Object: this.ActiveObject,
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
        if (Path === "Generator.Kind" && Committed)
            this.Chronicle("generator", `Switch to ${this.ActiveLayer?.Generator?.Kind}`, this.ActiveLayer?.Name || "");
        if (Path === "Object.Kind" && Committed)
            this.Chronicle("surface", `Mesh changed to ${this.ActiveObject?.Kind}`, this.ActiveObject?.Name || "");
        if (Path === "Object.Tile" && Committed)
            this.Chronicle("surface", `Tile ${this.ActiveObject?.Tile}`, this.ActiveObject?.Name || "");
        if (Path === "Project.Resolution" && Committed)
            this.Chronicle("surface", `Resolution ${this.Project.Resolution}²`, "every layer resampled");
        if (Path === "Project.Object")
        {
            this.SelectObject(this.Project.Object);
            this.RenderInspector();
            return;
        }
        if (Path.startsWith("Surface.") || Path.startsWith("Object."))
        {
            if (Path === "Object.Kind" && this.ActiveObject)
            {
                const Label = SurfaceOrdering.find((Entry) => Entry.Identifier === this.ActiveObject.Kind)?.Label;
                if (Label && /^(Shader ball|Sphere|Rounded cube|Cylinder|Torus|Plane|Imported mesh|Object)/.test(this.ActiveObject.Name))
                    this.ActiveObject.Name = Label;
            }
            if (Committed || Path === "Object.Kind" || Path === "Object.Tile")
            {
                this.RebuildSurface();
                this.RenderInspector();
            }
            return;
        }
        if (Path === "Project.Resolution")
        {
            this.Integrator.Configure(Number(this.Project.Resolution));
            this.Recomposite();
            this.UpdateStatusBar();
            return;
        }
        if (Path.startsWith("Mark."))
        {
            this.Recomposite();
            if (Path === "Mark.Mode" && Committed) this.RenderInspector();
            return;
        }
        if (Path.startsWith("Decal.Text.") || Path.startsWith("Decal.Library") || Path.startsWith("Decal.SourceKind"))
        {
            this.RefreshDecal(this.ActiveLayer);
            if (Committed) this.RenderInspector();
            return;
        }
        if (Path.startsWith("Finish."))
        {
            const Layer = this.ActiveLayer;
            if (Path === "Finish.Family")
            {
                Layer.Finish.Style = FinishStyles(Layer.Finish.Family)[0].Identifier;
                Layer.Finish.Shelf = "";
            }
            if (Path === "Finish.Style") Layer.Finish.Shelf = "";
            this.Recomposite();
            this.RenderStack();
            if (Committed || Path === "Finish.Family" || Path === "Finish.Style") this.RenderInspector();
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
            this.SyncMaskView();
            if (Committed || Path === "Mask.Kind") this.RenderInspector();
            return;
        }
        if (Path === "Layer.Object")
        {
            this.Recomposite();
            this.RenderStack();
            this.Chronicle("structure", `${this.ActiveLayer.Name} → ${this.ActiveLayer.Object ? this.ActiveObjectName(this.ActiveLayer.Object) : "every object"}`, "layer scope");
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
            case "branch-switch":
            case "branch-fork":
            case "timeline-back":
            case "timeline-forward":
            case "timeline-clear":
            case "timeline-visit":
            case "document-save":
            case "document-open":
                this.TimelineAction(Action, Argument);
                break;
            case "mark-select":
            case "mark-add":
            case "mark-duplicate":
            case "mark-remove":
            case "mark-visible":
            case "mark-raise":
            case "mark-lower":
                this.MarkAction(Action, Argument);
                break;
            case "add-object":
                this.AddObject("cube");
                this.RenderInspector();
                break;
            case "remove-object":
                this.RemoveObject(this.Project.Object);
                this.RenderInspector();
                break;
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
            case "mask-add-black":
                this.AddMask("black");
                this.SetPaintTarget("mask", false);
                break;
            case "mask-add-white":
                this.AddMask("white");
                this.SetPaintTarget("mask", false);
                break;
            case "mask-add-generator":
                this.AddMask("generator");
                break;
            case "mask-add-colour":
                this.AddMask("colour");
                break;
            case "mask-pick-colour":
                this.ArmColourPick();
                break;
            case "mask-view":
                this.ViewMask();
                break;
            case "mask-view-off":
                this.SetMaskView("off");
                break;
            case "mask-view-overlay":
                this.SetMaskView("overlay");
                break;
            case "mask-view-isolated":
                this.SetMaskView("isolated");
                break;
            case "apply-finish":
            {
                const Entry = FinishByIdentifier[Argument];
                if (!Entry || !Layer) break;
                this.CaptureStack(() => (Layer.Finish = CreateFinish(Argument)));
                if (Layer.Name === FinishLabel({ Shelf: Layer.Finish.Shelf }) || Layer.Kind === "finish") Layer.Name = Entry.Label;
                this.RenderInspector();
                this.RenderStack();
                this.Notify(`${Entry.Label} applied.`);
                break;
            }
            case "mask-fill":
                this.FillMask(1);
                break;
            case "mask-clear":
                this.FillMask(0);
                break;
            case "mask-remove":
                this.RemoveMask();
                break;
            case "target-content":
                this.SetPaintTarget("coverage");
                break;
            case "target-mask":
                this.SetPaintTarget("mask");
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
                  : this.InspectorTab === "timeline"
                    ? this.TimelineInspector()
                    : this.LayerInspector(Layer);
        Body.classList.toggle("timeline-body", this.InspectorTab === "timeline");
        FillIcons(Body);
        DressSelects(Body);
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
                    this.Project.Objects.length > 1
                        ? SelectRow({
                              Label: "Applies to",
                              Path: "Layer.Object",
                              Value: Layer.Object,
                              Options: [
                                  { Value: "", Label: "Every object" },
                                  ...this.Project.Objects.map((Entry) => ({ Value: Entry.Identifier, Label: `${Entry.Name} · tile ${Entry.Tile}` })),
                              ],
                              Hint: "A scoped layer only paints its object's tile of the sheet.",
                          })
                        : "",
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

        if (Layer.Kind === "finish") Sections.push(this.FinishSections(Layer));

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
                Badge: Layer.Mask.Kind === "none" ? "OFF" : Layer.Mask.Invert ? "INVERTED" : Layer.Mask.Kind.toUpperCase(),
                Open: Layer.Mask.Kind !== "none",
                Body:
                    Layer.Mask.Kind === "none"
                        ? `<p class="mask-blurb">A mask hides the layer and lets you paint it back in. Black conceals, white reveals,
                            a generator drives it from noise and a colour mask keys on what is already underneath.</p>
                           ${ActionRow([
                               { Action: "mask-add-black", Label: "Add black mask", Glyph: "mask" },
                               { Action: "mask-add-white", Label: "Add white mask", Glyph: "mask" },
                               { Action: "mask-add-generator", Label: "Generator", Glyph: "noise" },
                               { Action: "mask-add-colour", Label: "Colour mask", Glyph: "palette" },
                           ])}`
                        : `${this.MaskTargetRow()}
                           ${SelectRow({
                               Label: "Mask source",
                               Path: "Mask.Kind",
                               Value: Layer.Mask.Kind,
                               Options: MaskKinds.map((Kind) => ({ Value: Kind.Identifier, Label: Kind.Label })),
                               Hint: "A painted mask takes the brush while the mask target above is lit.",
                           })}
                           ${ToggleRow({ Label: "Invert", Path: "Mask.Invert", Value: Layer.Mask.Invert })}
                           ${Layer.Mask.Kind === "generator" ? this.GeneratorBody("Mask.Generator", Layer.Mask.Generator) : ""}
                           ${Layer.Mask.Kind === "colour" ? this.ColourMaskBody(Layer) : ""}
                           ${this.MaskViewRow()}
                           ${ActionRow([
                               { Action: "mask-fill", Label: "Fill white", Glyph: "fill" },
                               { Action: "mask-clear", Label: "Clear black", Glyph: "eraser" },
                               { Action: "mask-remove", Label: "Remove", Glyph: "trash" },
                           ])}`,
            }),
        );
        return Sections.join("");
    }

    // Material properties. The eight numbers behind every finish are the same; the labels and ranges come from the family,
    // so a car paint asks about flake and a fabric asks about thread count.
    FinishSections(Layer)
    {
        const Finish = Layer.Finish;
        const Family = FinishFamilies.find((Entry) => Entry.Identifier === Finish.Family) || FinishFamilies[0];
        const Shelf = FinishShelf.filter((Entry) => Entry.Family === Family.Identifier);
        const Properties = [
            ...FinishColours(Family.Identifier).map((Colour) =>
                ColourRow({ Label: Colour.Label, Path: `Finish.${Colour.Key}`, Value: Finish[Colour.Key] }),
            ),
            ...FinishControls(Family.Identifier).map((Control) =>
                SliderRow({
                    Label: Control.Label,
                    Path: `Finish.${Control.Key}`,
                    Value: Finish[Control.Key],
                    Minimum: Control.Minimum,
                    Maximum: Control.Maximum,
                    Step: Control.Step,
                    Unit: Control.Unit,
                    Hint: Control.Hint,
                }),
            ),
            SliderRow({ Label: "Seed", Path: "Finish.Seed", Value: Finish.Seed, Minimum: 0, Maximum: 64, Step: 1, Unit: "#" }),
        ];
        return [
            Group({
                Title: "Material",
                Badge: Family.Label.toUpperCase(),
                Body: [
                    `<p class="property-hint">${Escape(Family.Note)} Every channel this layer writes is produced by the
                      recipe below rather than by a flat value.</p>`,
                    SelectRow({
                        Label: "Family",
                        Path: "Finish.Family",
                        Value: Finish.Family,
                        Options: FinishFamilies.map((Entry) => ({ Value: Entry.Identifier, Label: Entry.Label })),
                    }),
                    SelectRow({
                        Label: "Pattern style",
                        Path: "Finish.Style",
                        Value: Finish.Style,
                        Options: FinishStyles(Family.Identifier).map((Entry) => ({ Value: Entry.Identifier, Label: Entry.Label })),
                    }),
                    `<div class="finish-shelf">
                        ${Shelf.map(
                            (Entry) => `
                            <button class="finish-chip ${Entry.Identifier === Finish.Shelf ? "active" : ""}"
                                    data-action="apply-finish" data-argument="${Entry.Identifier}" title="${Escape(Entry.Note)}">
                                <i style="background:${Entry.Swatch}"></i>${Escape(Entry.Label)}
                            </button>`,
                        ).join("")}
                    </div>`,
                ].join(""),
            }),
            Group({
                Title: "Material properties",
                Badge: (FinishStyles(Family.Identifier).find((Entry) => Entry.Identifier === Finish.Style)?.Label || "").toUpperCase(),
                Open: true,
                Body: Properties.join(""),
            }),
        ].join("");
    }

    // A colour mask selects by matching the colour already composited beneath the layer, the way a selection by hue would.
    ColourMaskBody(Layer)
    {
        const Mask = Layer.Mask;
        return [
            ColourRow({
                Label: "Key colour",
                Path: "Mask.Colour",
                Value: Mask.Colour,
                Hint: "Everything beneath the layer within tolerance of this colour is revealed.",
            }),
            SliderRow({ Label: "Tolerance", Path: "Mask.Tolerance", Value: Mask.Tolerance, Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" }),
            SliderRow({ Label: "Softness", Path: "Mask.Softness", Value: Mask.Softness, Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" }),
            ActionRow([{ Action: "mask-pick-colour", Label: "Pick from the surface", Glyph: "picker" }]),
        ].join("");
    }

    // The mask view toggle, repeated here so it is at hand while the mask is being set up.
    MaskViewRow()
    {
        const View = this.MaskView;
        return `
        <div class="property-row target-row">
            <span class="property-label">Mask view</span>
            <div class="target-switch wide" role="group" aria-label="Mask view">
                <button class="${View === "off" ? "active" : ""}" data-action="mask-view-off" aria-pressed="${View === "off"}">Off</button>
                <button class="${View === "overlay" ? "active" : ""}" data-action="mask-view-overlay" aria-pressed="${View === "overlay"}">Overlay</button>
                <button class="${View === "isolated" ? "active" : ""}" data-action="mask-view-isolated" aria-pressed="${View === "isolated"}">Mask only</button>
            </div>
        </div>
        ${ColourRow({ Label: "Overlay tint", Path: "Mask.Tint", Value: this.ActiveLayer?.Mask?.Tint || [0.95, 0.22, 0.3] })}
        <p class="property-hint">Shift M cycles the same three views while you paint.</p>`;
    }

    // The same content-or-mask question the rows ask, restated where the mask itself is being set up.
    MaskTargetRow()
    {
        const Masking = this.Projection.Brush.Target === "mask";
        return `
        <div class="property-row target-row">
            <span class="property-label">Brush target</span>
            <div class="target-switch" role="group" aria-label="Brush target">
                <button class="${Masking ? "" : "active"}" data-action="target-content" aria-pressed="${!Masking}">Content</button>
                <button class="${Masking ? "active" : ""}" data-action="target-mask" aria-pressed="${Masking}">Mask</button>
            </div>
        </div>
        <p class="property-hint">M switches between them while painting.</p>`;
    }

    ChannelControl(Layer, Channel)
    {
        const Enabled = Layer.Enabled[Channel.Identifier];
        const Value = Layer.Channels[Channel.Identifier];
        // A finish writes most of these per texel, so the flat value behind them would be a lie. The ones it only scales
        // keep their slider, and the ones it never touches behave as they do on any other layer.
        const Driven = Layer.Kind === "finish" ? FinishChannelRole(Channel.Identifier) : "";
        if (Enabled && Driven === "driven")
            return `
        <div class="channel-control enabled driven">
            <label class="channel-head">
                <input type="checkbox" data-bind="Enabled.${Channel.Identifier}" checked
                       aria-label="Write ${Escape(Channel.Label)}" />
                <span class="channel-name">${Escape(Channel.Label)}</span>
                <code>${Escape(Channel.Identifier)}</code>
            </label>
            <p class="channel-note">Written by the material recipe.</p>
        </div>`;
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
                      Hint: Driven === "scaled" ? "Scales the value the material produces." : "",
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

        const Mark = this.ActiveMark || Decal;
        const Placement = Group({
            Title: "Placement",
            Badge: Mark.Mode === "plane" ? "UV" : "PROJECTED",
            Body: [
                SelectRow({
                    Label: "Projection",
                    Path: "Mark.Mode",
                    Value: Mark.Mode,
                    Options: [
                        { Value: "projection", Label: "Projected onto the surface" },
                        { Value: "plane", Label: "Placed in UV space" },
                    ],
                    Hint:
                        Mark.Mode === "projection"
                            ? "Choose the decal tool and click the model to drop another mark; drag to slide it."
                            : "UV placement ignores the model and lays the mark flat in texture space.",
                }),
                ...(Mark.Mode === "projection"
                    ? [
                          SliderRow({ Label: "Size", Path: "Mark.Transform.Size", Value: Mark.Transform.Size, Minimum: 0.02, Maximum: 2.4, Step: 0.01, Unit: "m" }),
                          SliderRow({ Label: "Aspect", Path: "Mark.Transform.Aspect", Value: Mark.Transform.Aspect, Minimum: 0.2, Maximum: 5, Step: 0.01, Unit: "×" }),
                          SliderRow({ Label: "Rotation", Path: "Mark.Transform.Rotation", Value: Mark.Transform.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                          SliderRow({ Label: "Depth", Path: "Mark.Transform.Depth", Value: Mark.Transform.Depth, Minimum: 0.01, Maximum: 2, Step: 0.01, Unit: "m" }),
                          SliderRow({ Label: "Angle limit", Path: "Mark.Transform.AngleLimit", Value: Mark.Transform.AngleLimit, Minimum: 10, Maximum: 180, Step: 1, Unit: "°" }),
                      ]
                    : [
                          SliderRow({ Label: "Centre U", Path: "Mark.Plane.Centre.0", Value: Mark.Plane.Centre[0], Minimum: 0, Maximum: 1, Step: 0.005, Unit: "u" }),
                          SliderRow({ Label: "Centre V", Path: "Mark.Plane.Centre.1", Value: Mark.Plane.Centre[1], Minimum: 0, Maximum: 1, Step: 0.005, Unit: "v" }),
                          SliderRow({ Label: "Size", Path: "Mark.Plane.Size", Value: Mark.Plane.Size, Minimum: 0.02, Maximum: 1.6, Step: 0.005, Unit: "uv" }),
                          SliderRow({ Label: "Rotation", Path: "Mark.Plane.Rotation", Value: Mark.Plane.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                          SliderRow({ Label: "Aspect", Path: "Mark.Plane.Aspect", Value: Mark.Plane.Aspect, Minimum: 0.2, Maximum: 5, Step: 0.01, Unit: "×" }),
                      ]),
                SliderRow({ Label: "Edge softness", Path: "Mark.Softness", Value: Mark.Softness, Minimum: 0.002, Maximum: 0.6, Step: 0.002, Unit: "α" }),
                SliderRow({ Label: "Emboss", Path: "Mark.Emboss", Value: Mark.Emboss, Minimum: -0.5, Maximum: 0.5, Step: 0.01, Unit: "h" }),
                ColourRow({ Label: "Colour", Path: "Mark.Tint", Value: Mark.Tint }),
                ToggleRow({
                    Label: "Colour the artwork",
                    Path: "Mark.Colorise",
                    Value: Mark.Colorise,
                    Hint: "Off keeps the artwork's own colours; on treats it as a stencil and paints it in the colour above.",
                }),
            ].join(""),
        });
        return Source + this.MarkList(Layer) + Placement;
    }

    // Every placement of the layer's artwork, in composite order, grouped by folder. The bottom of the list is painted
    // first, so the list reads the way the stack does.
    MarkList(Layer)
    {
        const Decal = Layer.Decal;
        const Marks = Decal.Marks || [];
        const Folders = [];
        for (const Mark of Marks) if (!Folders.includes(Mark.Folder || "")) Folders.push(Mark.Folder || "");
        const Row = (Mark, Index) => `
            <div class="mark-row ${Mark.Identifier === Decal.Selection ? "selected" : ""} ${Mark.Visible ? "" : "muted"}"
                 data-action="mark-select" data-argument="${Mark.Identifier}" title="${Escape(Mark.Name)}">
                <span class="mark-chip" style="--mark-colour:${ToHex(Mark.Tint)}">${Index + 1}</span>
                <span class="mark-copy">
                    <span class="mark-name">${Escape(Mark.Name)}</span>
                    <span class="mark-note">${Mark.Mode === "plane" ? "UV" : "projected"} · ${(Mark.Mode === "plane" ? Mark.Plane.Size : Mark.Transform.Size).toFixed(2)}${Mark.Mode === "plane" ? "uv" : "m"}</span>
                </span>
                <button class="icon-button" data-action="mark-lower" data-argument="${Mark.Identifier}" title="Send down" aria-label="Send down">${Icon("down")}</button
                ><button class="icon-button" data-action="mark-raise" data-argument="${Mark.Identifier}" title="Bring up" aria-label="Bring up">${Icon("up")}</button
                ><button class="icon-button" data-action="mark-duplicate" data-argument="${Mark.Identifier}" title="Duplicate" aria-label="Duplicate">${Icon("copy")}</button
                ><button class="icon-button" data-action="mark-visible" data-argument="${Mark.Identifier}" title="${Mark.Visible ? "Hide" : "Show"}" aria-label="${Mark.Visible ? "Hide" : "Show"}">${Icon(Mark.Visible ? "eye" : "hidden")}</button
                ><button class="icon-button" data-action="mark-remove" data-argument="${Mark.Identifier}" title="Remove" aria-label="Remove">${Icon("trash")}</button>
            </div>`;
        const Body = Folders.map((Folder) =>
        {
            const Inside = Marks.map((Mark, Index) => ({ Mark, Index })).filter(({ Mark }) => (Mark.Folder || "") === Folder);
            const Rows = Inside.slice().reverse().map(({ Mark, Index }) => Row(Mark, Index)).join("");
            if (!Folder) return `<div class="mark-folder loose">${Rows}</div>`;
            return `
                <details class="mark-folder" open>
                    <summary><span data-icon="folder"></span>${Escape(Folder)}<b>${Inside.length}</b></summary>
                    ${Rows}
                </details>`;
        }).join("");
        const Named = Folders.filter((Folder) => Folder);
        return Group({
            Title: "Marks",
            Badge: `${Marks.length} / ${MarkLimit}`,
            Body: [
                `<div class="mark-list">${Body}</div>`,
                SelectRow({
                    Label: "Folder",
                    Path: "",
                    Value: this.ActiveMark?.Folder || "",
                    Options: [{ Value: "", Label: "No folder" }, ...Named.map((Folder) => ({ Value: Folder, Label: Folder })), { Value: "__new", Label: "New folder…" }],
                    Hint: "Folders are only a name on each mark, so a busy layer can still be read.",
                }).replace('data-bind=""', 'data-mark-folder="1"'),
                ActionRow([
                    { Action: "mark-add", Label: "Add mark", Glyph: "plus" },
                    { Action: "mark-duplicate", Label: "Duplicate", Glyph: "copy", Argument: Decal.Selection },
                ]),
            ].join(""),
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Timeline. The revision queue remembers pixels; this reads the session back as a story, on branches that can be
    // forked, named and revisited.
    //----------------------------------------------------------------------------------------------------------------------
    Chronicle(Kind, Title, Detail = "", Colour = null)
    {
        const Event = this.Timeline.Record({ Kind, Title, Detail, Colour });
        return Event;
    }

    RenderTimeline()
    {
        if (this.InspectorTab !== "timeline") return;
        const Body = Select("#inspector-body");
        if (!Body) return;
        Body.innerHTML = this.TimelineInspector();
        FillIcons(Body);
    }

    TimelineInspector()
    {
        const Timeline = this.Timeline;
        const Events = Timeline.Events;
        const Pills = Timeline.Branches.map(
            (Branch) => `
            <button class="branch-pill ${Branch.Identifier === Timeline.Active ? "active" : ""}"
                    data-action="branch-switch" data-argument="${Branch.Identifier}"
                    title="${Escape(Branch.Name)} · ${Branch.Events.length} events">
                ${Escape(Branch.Name)}<b>${Branch.Events.length}</b>
            </button>`,
        ).join("");
        const Rows = Events.map((Event, Index) =>
        {
            const Kind = EventByKind[Event.Kind];
            const Spent = Index >= Timeline.Head;
            return `
            <li class="timeline-event ${Spent ? "undone" : ""} ${Index === Timeline.Head - 1 ? "head" : ""}"
                data-action="timeline-visit" data-argument="${Event.Identifier}" style="--event-accent:${Kind.Accent}">
                <span class="event-node"></span>
                <span class="event-copy">
                    <span class="event-title">
                        ${Event.Colour ? `<i class="event-chip" style="--chip:${ToHex(Event.Colour)}"></i>` : ""}${Escape(Event.Title)}
                    </span>
                    <span class="event-note">${Escape(Event.Detail || Kind.Label)}</span>
                </span>
                <span class="event-meta">
                    <span class="event-badge">${Kind.Badge}</span>
                    <span class="event-hash">${Event.Hash}</span>
                    <span class="event-clock">${EventClock(Event.Stamp)}</span>
                </span>
            </li>`;
        }).reverse().join("");
        return `
            <div class="timeline">
                <div class="timeline-head">
                    <div class="branch-pills">${Pills}
                        <button class="branch-pill ghost" data-action="branch-fork" title="Fork a branch here" aria-label="Fork a branch">+</button>
                    </div>
                    <div class="timeline-actions">
                        <button class="icon-button" data-action="timeline-back" title="Step back · Ctrl Z" aria-label="Step back" ${Timeline.CanStepBack ? "" : "disabled"}>${Icon("undo")}</button
                        ><button class="icon-button" data-action="timeline-forward" title="Step forward · Ctrl ⇧ Z" aria-label="Step forward" ${Timeline.CanStepForward ? "" : "disabled"}>${Icon("redo")}</button
                        ><button class="icon-button" data-action="timeline-clear" title="Clear the timeline" aria-label="Clear the timeline">${Icon("trash")}</button>
                    </div>
                </div>
                <div class="timeline-summary">
                    <span>${Timeline.Branch.Name}</span><b>${Timeline.Head}</b> of ${Events.length} events
                    ${Timeline.Branch.Parent ? `· forked from ${Escape(this.BranchName(Timeline.Branch.Parent))} at ${Timeline.Branch.Origin}` : ""}
                </div>
                ${Events.length ? `<ol class="timeline-rail">${Rows}</ol>` : `<p class="timeline-empty">Nothing has happened yet. Paint something.</p>`}
                <div class="timeline-foot">
                    <button class="button" data-action="document-save">${Icon("download")}Save ${DocumentExtension}</button>
                    <button class="button" data-action="document-open">${Icon("folder")}Open</button>
                </div>
            </div>`;
    }

    ActiveObjectName(Identifier)
    {
        return this.Project.Objects.find((Entry) => Entry.Identifier === Identifier)?.Name || "an object";
    }

    BranchName(Identifier)
    {
        return this.Timeline.Branches.find((Branch) => Branch.Identifier === Identifier)?.Name || "a branch";
    }

    TimelineAction(Action, Argument)
    {
        const Timeline = this.Timeline;
        if (Action === "branch-switch" && Timeline.Switch(Argument)) this.Notify(`On ${Timeline.Branch.Name}.`);
        else if (Action === "branch-fork")
        {
            const Branch = Timeline.Fork();
            this.Notify(`Forked ${Branch.Name} from ${this.BranchName(Branch.Parent)}.`);
        }
        else if (Action === "timeline-back") this.Undo();
        else if (Action === "timeline-forward") this.Redo();
        else if (Action === "timeline-clear")
        {
            Timeline.Clear({ Kind: "document", Title: "Timeline cleared", Detail: this.Project.Name });
            this.Notify("Timeline cleared.");
        }
        else if (Action === "timeline-visit")
        {
            const Head = Timeline.Visit(Argument);
            if (Head >= 0) this.Notify(`Looking at event ${Head} of ${Timeline.Depth}.`);
        }
        else if (Action === "document-save") this.SaveDocument();
        else if (Action === "document-open") Select("#import-file").click();
        this.RenderTimeline();
    }

    SaveDocument()
    {
        EmitProject(this.Project, this.Camera.Serialise(), this.Timeline.Serialise());
        this.Chronicle("export", "Document written", `${this.Project.Name}${DocumentExtension}`);
        this.MarkClean();
        this.Notify(`${this.Project.Name}${DocumentExtension} written.`);
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
        const Environment = this.Project.Environment;
        const Record = this.SurfaceRecord;
        const Object_ = this.ActiveObject;
        const Range = Record?.Ranges?.find((Entry) => Entry.Identifier === Object_?.Identifier);
        const Span = Record?.Tiles?.Columns || 1;
        const Placement = Object_ ? TilePlacement(Object_.Tile) : { Column: 0, Row: 0 };
        return [
            Group({
                Title: "Object",
                Badge: Range ? `${Range.TriangleCount.toLocaleString()} TRIS` : "",
                Body: Object_
                    ? [
                          SelectRow({
                              Label: "Object",
                              Path: "Project.Object",
                              Value: Object_.Identifier,
                              Options: this.Project.Objects.map((Entry) => ({ Value: Entry.Identifier, Label: `${Entry.Name} · ${Entry.Tile}` })),
                          }),
                          SelectRow({
                              Label: "Mesh",
                              Path: "Object.Kind",
                              Value: Object_.Kind,
                              Options: SurfaceOrdering.map((Entry) => ({ Value: Entry.Identifier, Label: `${Entry.Label} · ${Entry.Note}` })),
                          }),
                          SliderRow({ Label: "Subdivision", Path: "Object.Subdivision", Value: Object_.Subdivision, Minimum: 0, Maximum: 3, Step: 1, Unit: "lvl" }),
                          SliderRow({ Label: "Scale", Path: "Object.Scale", Value: Object_.Scale, Minimum: 0.1, Maximum: 10, Step: 0.01, Unit: "×" }),
                          SliderRow({ Label: "Spin", Path: "Object.Rotation", Value: Object_.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                          SliderRow({ Label: "Offset X", Path: "Object.Offset.0", Value: Object_.Offset[0], Minimum: -12, Maximum: 12, Step: 0.01, Unit: "m" }),
                          SliderRow({ Label: "Offset Y", Path: "Object.Offset.1", Value: Object_.Offset[1], Minimum: -12, Maximum: 12, Step: 0.01, Unit: "m" }),
                          SliderRow({ Label: "Offset Z", Path: "Object.Offset.2", Value: Object_.Offset[2], Minimum: -12, Maximum: 12, Step: 0.01, Unit: "m" }),
                          ActionRow([
                              { Action: "add-object", Label: "Add object", Glyph: "plus" },
                              { Action: "remove-object", Label: "Remove", Glyph: "trash" },
                          ]),
                      ].join("")
                    : "",
            }),
            Group({
                Title: "UV tiles",
                Badge: `${Span}×${Span} UDIM`,
                Open: false,
                Body: Object_
                    ? [
                          SliderRow({ Label: "Tile", Path: "Object.Tile", Value: Object_.Tile, Minimum: 1001, Maximum: 1100, Step: 1, Unit: "" , Hint: `Column ${Placement.Column + 1}, row ${Placement.Row + 1} of the UDIM sheet.` }),
                          SelectRow({
                              Label: "Texture resolution",
                              Path: "Project.Resolution",
                              Value: String(this.Project.Resolution),
                              Options: ResolutionOrdering.map((Entry) => ({ Value: String(Entry.Value), Label: `${Entry.Label} · ${Entry.Note}` })),
                              Hint: "Shared by every tile, so a wider sheet means fewer texels per object.",
                          }),
                          ActionRow([
                              { Action: "import-mesh", Label: "Import OBJ", Glyph: "folder" },
                              { Action: "bake-occlusion", Label: "Re-bake AO", Glyph: "rotate" },
                          ]),
                      ].join("")
                    : "",
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
                Badge: `${Record ? Record.Triangles.toLocaleString() : 0} TRIS`,
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
        Select("#export-project").addEventListener("click", () => this.SaveDocument());
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
            this.Chronicle("export", `Exported ${Result.Preset}`, `${Result.Count} images`);
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
            const Document_ = ReadDocument(await File.text());
            const Record = SanitiseProject(Document_.Project);
            this.Project = Record;
            Select("#document-name").value = Record.Name;
            this.Documents.Synchronise(Record.Name);
            this.Revisions.Clear();
            this.Integrator.Configure(Record.Resolution);
            if (Document_.Camera) this.Camera.Restitute(Document_.Camera);
            this.RebuildSurface(true);
            this.InvalidateDecals();
            if (!this.Timeline.Restitute(Document_.Timeline))
                this.Timeline.Clear({ Kind: "document", Title: "Document opened", Detail: File.name });
            else this.Chronicle("document", "Document opened", File.name);
            this.RenderStack();
            this.RenderObjects();
            this.RenderInspector();
            this.RenderChannelStrip();
            this.Notify(
                `${File.name} opened · ${Record.Layers.length} layers · ${this.Timeline.Branches.length} branch${this.Timeline.Branches.length === 1 ? "" : "es"}.`,
            );
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
            Timeline: this.Timeline.Serialise(),
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
            this.Timeline.Clear({ Kind: "document", Title: "Canvas created", Detail: Name });
        }
        else
        {
            this.Project = Record.Project;
            this.Camera.Restitute(Record.Camera);
            if (!this.Timeline.Restitute(Record.Timeline))
                this.Timeline.Clear({ Kind: "document", Title: "Canvas restored", Detail: Name });
            this.Tool = Record.Tool || "brush";
            this.Display = Record.Display || "material";
            this.ViewMode = Record.ViewMode || "surface";
        }
        Select("#document-name").value = this.Project.Name;
        Select("#channel-select").value = this.Display;
        Select("#view-mode").value = this.ViewMode;
        RefreshSelect(Select("#channel-select"));
        RefreshSelect(Select("#view-mode"));
        this.SetTool(this.Tool);
        this.Revisions.Clear();
        this.Integrator.Configure(this.Project.Resolution);
        this.RebuildSurface(true);
        this.RenderStack();
        this.RenderObjects();
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
                this.SaveDocument();
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
            if (Key === "m" && Event.shiftKey)
                this.SetMaskView(this.MaskView === "off" ? "overlay" : this.MaskView === "overlay" ? "isolated" : "off");
            else if (Key === "m") Select("#mask-toggle").click();
            if (Key === "b") this.SetBrowserState(this.BrowserState === "closed" ? "half" : "closed");
            if (Key === "f") Select("#focus-button").click();
            if (Key === "s") Select("#mirror-button").click();
            if (Key === "x")
            {
                this.SetViewMode(this.ViewMode === "plane" ? "surface" : "plane");
                Select(".viewport").classList.toggle("plane-view", this.ViewMode === "plane");
                this.UpdateCaption();
            }
            if (Key === "/")
            {
                Event.preventDefault();
                Select("#layer-search").focus();
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
    // Running on a CPU rasteriser is a legitimate way to use this editor on a machine whose GPU the browser will not touch.
    // It is perhaps thirty times slower, so meet it halfway: author at 512 rather than 1024 and draw one pixel per pixel.
    //----------------------------------------------------------------------------------------------------------------------
    AdoptSoftwareLimits()
    {
        if (!this.Integrator.Software) return;
        this.Project.Resolution = Math.min(this.Project.Resolution, 512);
        this.Integrator.Resolution = this.Project.Resolution;
        setTimeout(
            () =>
                this.Notify(
                    `Software renderer in use (${this.Integrator.Renderer || "CPU"}) — authoring at ${this.Project.Resolution}² to keep it responsive.`,
                ),
            600,
        );
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
            const Advice = Select("#gpu-error-advice");
            const First = document.createElement("li");
            if (Probe.Modern)
                First.textContent =
                    `The GPU itself is fine — WebGPU sees ${Probe.Adapter} on this machine. WebGL alone is being refused, so this ` +
                    "is browser configuration rather than hardware: chrome://flags/#ignore-gpu-blocklist and chrome://gpu are the places to look.";
            else
                First.innerHTML =
                    "Neither WebGL nor WebGPU can see a GPU here, so the browser has been cut off from it entirely — a blocklisted " +
                    "or broken display driver. To run on the GPU, update the display driver and set " +
                    "chrome://flags/#ignore-gpu-blocklist to Enabled. To run <em>now</em> on the processor instead, close every " +
                    "window and start the browser with <code>--enable-unsafe-swiftshader</code> — this editor detects that and " +
                    "authors at 512² so it stays usable.";
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
        const Target = this.Projection.Brush.Target === "mask" ? "mask" : "layer";
        Select("#viewport-object").textContent = Layer.Name;
        const Axis = this.Projection.Brush.Symmetry;
        const Mirror = Axis === "none" ? "" : ` · mirror ${Axis.toUpperCase()}`;
        Select("#viewport-subtitle").textContent =
            this.ViewMode === "plane"
                ? `Texture space · ${DisplayOrdering.find((Entry) => Entry.Identifier === this.Display)?.Label}`
                : `${Tool?.Label} → ${Target} · ${LayerSummary(Layer)}${Mirror}`;
        Select("#live-pill").querySelector("span").textContent =
            this.ViewMode === "plane" ? "TEXTURE SPACE" : this.Display === "material" ? "OPENPBR" : this.Display.toUpperCase();
    }

    UpdateStatusBar()
    {
        const Resolution = this.Project.Resolution;
        Select("#texel-count").textContent = `${((Resolution * Resolution) / 1e6).toFixed(2)} Mtexel · ${Resolution}²`;
        const Span = this.SurfaceRecord?.Tiles?.Columns || 1;
        Select("#surface-status").textContent = this.SurfaceRecord
            ? `${this.SurfaceRecord.Label} · ${this.SurfaceRecord.Triangles.toLocaleString()} tris` +
              (Span > 1 ? ` · ${Span}×${Span} UDIM` : "")
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
        // A CPU rasteriser pays for every pixel in software, so stop asking it for retina ones.
        const Ratio = this.Integrator.Software ? Math.min(window.devicePixelRatio || 1, 1) : Math.min(window.devicePixelRatio || 1, 2);
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
        if (this.ViewMode === "plane") this.SyncPlaneOverlay();
        const Options = {
            Environment: this.Project.Environment,
            Material: this.Project.Material,
            Display: DisplayIndex(this.Display),
            MaskLayer: this.Project.Selection,
            MaskTint: this.ActiveLayer?.Mask?.Tint || [0.95, 0.22, 0.3],
            CheckerScale: 16,
            Symmetry: this.Projection.Brush.Symmetry,
            Placement: this.Placement,
            Cursor:
                this.StrokeTool === "brush" || this.StrokeTool === "eraser"
                    ? this.Cursor && { ...this.Cursor, ...this.PreviewInk() }
                    : null,
        };
        if (this.ViewMode === "plane")
            this.Integrator.RenderPlane({
                ...Options,
                Pan: this.PlanePan,
                Zoom: this.PlaneZoom,
                CursorInk: this.PreviewInk().Ink,
                CursorPreview: this.StrokeTool === "brush" || this.StrokeTool === "eraser" ? this.PreviewInk().Preview : 0,
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

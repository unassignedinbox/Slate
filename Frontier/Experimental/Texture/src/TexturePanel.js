//============================================================================================================================================
// 🎨 TexturePanel.js — the editor shell: layer stack, material library, inspector, viewport interaction and transport
//============================================================================================================================================
// The panel owns the project record and drives four collaborators: SurfaceStructure (geometry, BVH, occlusion),
// ShadingIntegrator (every GPU pass), StrokeProjection (pointer → surface) and RevisionQueue (undo). Nothing in here
// touches WebGL directly; nothing in the integrator knows about the DOM.
//============================================================================================================================================

import { ShadingIntegrator, ProbeAcceleration, DeviceReport } from "./ShadingIntegrator.js";
import { OrbitProjection } from "./OrbitProjection.js";
import {
    StrokeProjection,
    ToolOrdering,
    SymmetryOrdering,
    SectorLimits,
    MarkUnderPoint,
    MarkCorners,
    MarkSpindle,
    ResizeMark,
    SpinMark,
    PointerIntent,
} from "./StrokeProjection.js";
import {
    StrokeModes,
    GradientShapes,
    GradientEasings,
    GradientDefaults,
    RampFits,
    DecalFits,
    RampLimit,
    DefaultRampStops,
    SortRampStops,
    RampColourAt,
    PlaceRampStop,
    RemoveRampStop,
    MoveRampStop,
    RampEase,
    RampWhere,
    RampCss,
    LineSnaps,
    LineSamples,
    SnapLine,
    CurvePresets,
    DefaultCurve,
    DefaultCurves,
    SortCurve,
    EvaluateCurve,
    CurveTable,
    CurveIsPlain,
    PlaceCurvePoint,
    LiftCurvePoint,
    WriteSlots,
    WriteKeys,
    DefaultWrites,
} from "./StrokeSpecification.js";
import { BuildSurface, SurfaceIndex, BakeOcclusion, ParseWavefront } from "./SurfaceStructure.js";
import {
    AssembleScene,
    CreateObject,
    ObjectAtTriangle,
    CoordinateTile,
    TileNumber,
    TilePlacement,
    TileLabel,
    TileColumns,
    FirstTile,
} from "./SceneStructure.js";
import { InstrumentPanel } from "./InstrumentPanel.js";
import { MediaSummary, MediumOrdering, MediumByIndex, PlainMedia } from "./MediaSolver.js";
import {
    InstrumentByKey,
    InstrumentFamilies,
    InstrumentArtwork,
    InstrumentSchema,
    VisibleControls,
    BrushFromInstrument,
    FullView,
} from "./InstrumentSpecification.js";
// 🔴 The slider lives in ControlSpecification so the instrument card can mount the same one. See the note there.
import { SliderRow, SyncSlider } from "./ControlSpecification.js";
import { RevisionQueue } from "./RevisionQueue.js";
import { DocumentSequence } from "./DocumentSequence.js";
import { EmitTextureSet, EmitProject, ReadDocument, DocumentExtension, ExportSizes } from "./ExportSequence.js";
import { CollectSheets, ApplySheets, SheetTally, SheetAllowance } from "./SheetCodec.js";
import { TimelineSequence, EventByKind, EventClock, PreviewLimit } from "./TimelineSequence.js";
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
    EnvironmentByIdentifier,
    LightOrdering,
    DefaultLights,
    MaterialLibrary,
    MaterialByIdentifier,
    MetalByIdentifier,
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
    LayerResolutions,
    MaskKinds,
    CreateMark,
    MarkLimit,
    OrderStack,
    LayerAncestry,
    LayerSubtree,
    LayerInside,
    CanHold,
    CompositeOrdering,
    FolderLimit,
} from "./LayerSpecification.js";
import { DecalLibrary, DecalCategories, DecalResolution, FontArchive, RasteriseDecal, SanitiseMarkup } from "./DecalSpecification.js";

//--------------------------------------------------------------------------------------------------------------------------
// Document helpers.
//--------------------------------------------------------------------------------------------------------------------------
// How near a press has to land to take hold of a decal handle. A finger is about nine millimetres across and a mouse
// is not much more accurate than one, so the grip is larger than it is drawn.
const GizmoReach = 14;

// 🔴 A keystroke belongs to whatever is being TYPED into, and a slider is not typed into. The guard used to bail on
//    every `input`, so one click on a size slider or a colour well took the whole shortcut set away: S did nothing,
//    the brackets did nothing, 1-6 did nothing, and the only way to get them back was to click the canvas first.
//    Text, numbers and lists keep their keys; ranges, swatches, checkboxes and buttons hand them to the editor.
const QuietFields = new Set(["range", "color", "checkbox", "radio", "button", "submit", "reset", "file", "image"]);
const TypingInto = (Target) =>
{
    if (!Target || typeof Target.matches !== "function") return false;
    if (Target.isContentEditable) return true;
    if (Target.matches("textarea, select")) return true;
    if (!Target.matches("input")) return false;
    return !QuietFields.has(String(Target.type || "text").toLowerCase());
};

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
    // The card's rail: a mark for every property of the paint. Drawn in the same hairline language as the rest of the
    // sheet — one stroke, no fills — because they sit at 15px beside a word and have to read at a glance.
    taper: '<path d="M21 12c-6 3.2-12 5-18 5V7c6 0 12 1.8 18 5Z"/>',
    steady: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4m0 11v4M2.5 12h4m11 0h4"/>',
    dynamics: '<circle cx="12" cy="12" r="8.6"/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2 4.3 4.3 0 0 1 0-8.6 4.3 4.3 0 0 0 0-8.6Z"/>',
    height: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 13h17M3.5 16h17"/>',
    ramp: '<path d="M3 18h18M3 18 21 6"/><path d="M8 18v-4m5 4V9.5"/>',
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
// The five every instrument has, which the card already shows as sliders of their own.
const PlainControls = ["Size", "Opacity", "Flow", "Hardness", "Spacing", "Smoothing"];

const FamilyGlyph = (Type) =>
    ({ brush: "brush", pencil: "taper", pen: "vector", marker: "fill", dry: "noise", wax: "material", eraser: "eraser" })[Type?.Family] ||
    "layers";

const FamilyNote = (Family) =>
    ({
        brush: "Hairs, a ferrule and whatever the head was cut to do",
        pencil: "Lead on the peaks of the paper",
        pen: "A hard wet edge that creeps into the fibres",
        marker: "Flat colour, streaked, pooling at the rim",
        dry: "Crushed into the tooth, shedding dust",
        wax: "Skips the valleys until it is pushed hard enough",
        eraser: "Takes paint away — picking one puts the eraser in hand",
    })[Family.Key] || "";

// The one word the rail has room for.
const MaterialSummary = (Layer, Writes) =>
{
    if ((Layer.Channels?.base_metalness ?? 0) > 0.5) return "metal";
    if ((Layer.Channels?.specular_roughness ?? 0.42) < 0.3) return "gloss";
    if ((Layer.Channels?.specular_roughness ?? 0.42) > 0.8) return "matte";
    const Written = WriteKeys.filter((Key) => (Writes || {})[Key] !== false).length;
    return Written === WriteKeys.length ? "all" : `${Written}`;
};

// Where a distance sits in the ramp. One expression, three callers: the dab on the model, the dab on the flattened
// sheet, and the dab on the card's test sheet. `Fitted` is the length of the axis an aimed line was drawn down; with
// no axis the ramp is measured against its own set length instead.
const RampAt = (Along, Straight, Ramp, Fitted = 0) =>
{
    const Ends = Ramp.Fit === "ends";
    const Scale = Math.max(Ramp.Scale ?? 1, 0.01);
    const Length = Ends
        ? (Fitted > 1e-6 ? Fitted : Math.max(Ramp.Span, 0.001)) * Scale
        : Math.max(Ramp.Span, 0.001);
    return RampWhere(Ends ? Straight : Along, Length, Ramp);
};

const FromHex = (Hex) =>
{
    const Match = /^#?([0-9a-f]{6})$/i.exec(Hex.trim());
    if (!Match) return [1, 1, 1];
    const Value = Number.parseInt(Match[1], 16);
    return [((Value >> 16) & 255) / 255, ((Value >> 8) & 255) / 255, (Value & 255) / 255];
};

//--------------------------------------------------------------------------------------------------------------------------
// Colour, the way a picker thinks of it: an angle on the wheel, how much of it there is, and how much light it is under.
// Hue comes back in degrees so the bar can be read as a compass; the other two are shares.
//--------------------------------------------------------------------------------------------------------------------------
const RgbToHsv = ([Red, Green, Blue]) =>
{
    const High = Math.max(Red, Green, Blue);
    const Low = Math.min(Red, Green, Blue);
    const Span = High - Low;
    let Tone = 0;
    if (Span > 1e-6)
    {
        if (High === Red) Tone = ((Green - Blue) / Span + 6) % 6;
        else if (High === Green) Tone = (Blue - Red) / Span + 2;
        else Tone = (Red - Green) / Span + 4;
        Tone *= 60;
    }
    return [Tone, High > 1e-6 ? Span / High : 0, High];
};

const HsvToRgb = ([Tone, Strength, Level]) =>
{
    const Wheel = ((Tone % 360) + 360) % 360;
    const Sector = Wheel / 60;
    const Fall = Level * Strength;
    const Rise = Fall * (1 - Math.abs((Sector % 2) - 1));
    const Floor = Level - Fall;
    const Parts =
        Sector < 1
            ? [Fall, Rise, 0]
            : Sector < 2
              ? [Rise, Fall, 0]
              : Sector < 3
                ? [0, Fall, Rise]
                : Sector < 4
                  ? [0, Rise, Fall]
                  : Sector < 5
                    ? [Rise, 0, Fall]
                    : [Fall, 0, Rise];
    return Parts.map((Part) => Clamp(Part + Floor, 0, 1));
};

//--------------------------------------------------------------------------------------------------------------------------
// Inspector control builders — declarative rows bound by a dotted path into the project record.
//--------------------------------------------------------------------------------------------------------------------------
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
    <details class="property-group" data-group="${Escape(Title)}" ${Open ? "open" : ""}>
        <summary>${Escape(Title)}${Badge ? `<span class="section-badge">${Escape(Badge)}</span>` : ""}</summary>
        <div class="group-content">${Body}</div>
    </details>`;

//--------------------------------------------------------------------------------------------------------------------------
// The panel.
//--------------------------------------------------------------------------------------------------------------------------
// Exported so the painting path can be driven without a browser: the harness calls these methods against a stub that
// records what the renderer would have been asked to do. The page itself still constructs it at DOMContentLoaded.
export class TexturePanel
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
        this.Solo = "";
        // How the next stroke goes down, and what it answers to on the way. All three live on the panel rather than on
        // the brush: they are how the hand is being used, not what is in it, and they outlast swapping instruments.
        this.StrokeMode = "freehand";
        this.GizmoGrab = null;
        this.LineSnap = 0;
        // 🔴 The stops are rebuilt rather than spread. `GradientDefaults` is a module-level record, so a spread hands
        //    every panel ever built the SAME array — and the second one to edit a colour would edit the first one's.
        this.Gradient = { ...GradientDefaults, Stops: DefaultRampStops() };
        this.RampStop = 0;          // which colour of the ramp the card's picker is pointing at
        this.InkStop = 0;           // and the same, for the ramp a decal's ink runs through
        this.DecalImages = new Map();   // the last artwork rasterised for each decal layer, for the card's preview
        this.DecalPrints = new Map();   // and the same artwork with a flat ink laid over it, kept so a drag is cheap
        this.RampOrigin = null;     // where the stroke carrying the ramp began, and the axis it was aimed down
        this.Curves = DefaultCurves();
        // Colour dynamics: how far each dab is allowed to wander from the colour in hand. Applied per segment on the
        // way to the pass, because one draw call carries one colour — which is exactly what a dab is.
        this.Dynamics = { Hue: 0, Saturation: 0, Value: 0 };
        this.ChannelWrites = DefaultWrites();
        this.CurveEdit = "Size";
        this.LineAnchor = null;
        this.BrowserHeld = "";
        this.DragAsset = null;
        this.AssetLanding = null;
        this.PickCandidate = null;
        this.Placement = null;
        this.MovingMark = "";
        this.ChosenTool = "";
        this.ContentTool = "";      // the tool the hand had on the layer's content, handed back when the mask is let go
        this.SyncingSide = false;   // guard: the view and the painted side drive each other, and must not drive in circles
        this.SyncedLayer = "";
        this.RecentColours = ["#db5233", "#2f3338", "#c9ab6a", "#4a7bd0", "#e8e2d6"];
        this.PlaneWire = true;          // the unwrapped triangles drawn over the sheet in the plane view
        this.PlaneTiles = true;         // the numbered UDIM squares over the same sheet
        this.WireSignature = "";
        this.ChannelShelf = false;
        this.ChannelFocus = "";
        this.ConstantsOpen = false;     // whether the surface pod is showing the document's OpenPBR constants
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
        this.BindInstruments();
        this.BindKeyboard();
        this.Integrator.Configure(this.Project.Resolution);
        this.RebuildSurface(true);
        this.RenderStack();
        this.RenderObjects();
        this.RenderInspector();
        this.SyncPaintTarget();
        this.SyncMaskView();
        this.SyncToolRail();
        DressSelects(document);
        this.ShowBuild();
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

    LayerByIdentifier(Identifier)
    {
        return this.Layers.find((Layer) => Layer.Identifier === Identifier) || null;
    }

    SelectLayer(Identifier)
    {
        if (this.Project.Selection === Identifier) return;
        this.Project.Selection = Identifier;
        const Layer = this.ActiveLayer;
        // The side being painted travels with the layer. A layer left with its mask in hand is picked up the same way,
        // and one that never had a mask is picked up on its content however the layer before it was being painted.
        const Side = Layer && Layer.Mask.Kind !== "none" && Layer.Target === "mask" ? "mask" : "coverage";
        if (this.Projection.Brush.Target !== Side)
        {
            this.Projection.Configure({ Target: Side });
            if (Side === "coverage") this.ContentTool = "";
            this.FollowPaintTarget(Side);
        }
        this.AdoptChannelWrites();
        this.SyncToolToLayer();
        this.SyncToolRail();
        this.RenderStack();
        this.RenderInspector();
        this.SyncPaintTarget();
        this.SyncMaskView();
        // The card's own panes are about the layer in hand, so they change with it.
        this.Instruments?.Refresh();
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
        this.WireSignature = "";
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
        this.Integrator.Composite(CompositeOrdering(this.Layers, this.Solo), this.Project.Material);
        // Generator and colour masks exist only as a recipe until something resolves them, so the preview pass runs
        // whenever the viewport is actually showing a mask.
        if (this.Display === "mask")
            this.Integrator.RefreshMaskPreview(this.ActiveLayer, this.Project.Material);
        else this.Integrator.MaskPreviewLayer = "";
    }

    MarkDirty()
    {
        this.Dirty = true;
        Select("#dirty-indicator")?.classList.remove("clean");
    }

    MarkClean()
    {
        this.Dirty = false;
        Select("#dirty-indicator")?.classList.add("clean");
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Header, document bar and export.
    //----------------------------------------------------------------------------------------------------------------------
    BindHeader()
    {
        Select("#export-button").addEventListener("click", () => this.OpenExport());
        Select("#flatten-button").addEventListener("click", () => this.FlattenStack());
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
        this.RenderScenePod();
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

    //----------------------------------------------------------------------------------------------------------------------
    // UDIM tiles.
    //
    // 📝 A tile is where an object's unwrap lives on the sheet, so moving one is a scene edit and not a view setting:
    //    the surface is reassembled, every layer scoped to that object follows it, and the move is undoable.
    // 🔴 Two objects on one tile is allowed and sometimes wanted (a body and its trim sharing a texture), so the move
    //    does not swap occupants. It says what happened instead and lets the stack decide.
    //----------------------------------------------------------------------------------------------------------------------
    MoveObjectToTile(Tile, Identifier = this.Project.Object)
    {
        const Object_ = this.Project.Objects.find((Entry) => Entry.Identifier === Identifier);
        if (!Object_) return;
        const Wanted = Clamp(Math.round(Tile), FirstTile, FirstTile + 99);
        if (Object_.Tile === Wanted) return;
        const Sharing = this.Project.Objects.filter((Entry) => Entry !== Object_ && Entry.Tile === Wanted);
        this.CaptureStack(() => (Object_.Tile = Wanted));
        this.RebuildSurface();
        this.Chronicle("surface", `${Object_.Name} → ${Wanted}`, TileLabel(Wanted));
        this.Notify(
            Sharing.length
                ? `${Object_.Name} moved to ${Wanted}, shared with ${Sharing.map((Entry) => Entry.Name).join(", ")}.`
                : `${Object_.Name} moved to ${Wanted}.`,
        );
    }

    // Lay every object out across the sheet in stack order, one per tile, filling rows of ten the way UDIM numbers run.
    SpreadTiles()
    {
        const Objects = this.Project.Objects || [];
        if (!Objects.length) return;
        this.CaptureStack(() =>
        {
            Objects.forEach((Entry, Index) => (Entry.Tile = TileNumber(Index % TileColumns, Math.floor(Index / TileColumns))));
        });
        this.RebuildSurface();
        this.Chronicle("surface", "Spread across tiles", `${Objects.length} objects · ${FirstTile}–${Objects[Objects.length - 1].Tile}`);
        this.Notify(`${Objects.length} objects laid out from ${FirstTile}.`);
    }

    // The opposite: everything shares 1001, which is what a single-texture asset wants and what most engines import
    // without a UDIM-aware material.
    CollapseTiles()
    {
        const Objects = this.Project.Objects || [];
        if (!Objects.length) return;
        this.CaptureStack(() =>
        {
            for (const Entry of Objects) Entry.Tile = FirstTile;
        });
        this.RebuildSurface();
        this.Chronicle("surface", "Collapsed to one tile", `${Objects.length} objects on ${FirstTile}`);
        this.Notify(`Every object now shares ${FirstTile}. They overlap unless their unwraps already did not.`);
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

    // Every row shows the sheet it paints on rather than a flat swatch: the painted texture while the content is the
    // target, the mask while the mask is. The read-back is 64² per layer, blitted down on the GPU, so a deep stack
    // costs a few tens of kilobytes rather than a full-resolution copy each.
    RefreshThumbnails()
    {
        if (this.ThumbnailTimer) return;
        this.ThumbnailTimer = setTimeout(() =>
        {
            this.ThumbnailTimer = 0;
            this.DrawThumbnails();
        }, 90);
    }

    DrawThumbnails()
    {
        if (!this.Integrator.Ready) return;
        const Masking = this.Projection.Brush.Target === "mask";
        for (const Holder of SelectAll("[data-thumbnail]"))
        {
            const Layer = this.Layers.find((Entry) => Entry.Identifier === Holder.dataset.thumbnail);
            const Canvas = Holder.querySelector("canvas");
            if (!Layer || !Canvas) continue;
            // A holder can name the sheet it wants and how big it wants it; a stack row names neither and gets the
            // 64² plate that follows the brush target, which is what every row has always drawn.
            const Asked = Holder.dataset.thumbnailTarget;
            const Target = Asked || (Masking && Layer.Mask.Kind === "stroke" ? "mask" : "coverage");
            const Preview = this.Integrator.PreviewLayer(Layer, Target, Number(Holder.dataset.thumbnailSize) || 64);
            const Context = Preview ? Canvas.getContext("2d") : null;
            const Size = Preview?.Size || 0;
            if (Preview && Canvas.width !== Size) Canvas.width = Canvas.height = Size;
            const Image = Size ? Context?.createImageData(Size, Size) : null;
            // A stand-in canvas with no raster behind it simply keeps the kind's glyph.
            if (!Image?.data)
            {
                Holder.classList.remove("painted");
                continue;
            }
            // Read-back arrives bottom row first; the canvas wants the top row first.
            for (let Row = 0; Row < Size; Row += 1)
            {
                const From = (Size - 1 - Row) * Size * 4;
                Image.data.set(Preview.Pixels.subarray(From, From + Size * 4), Row * Size * 4);
            }
            Context.putImageData(Image, 0, 0);
            Holder.classList.add("painted");
            Holder.classList.toggle("masked", Target === "mask");
            // 📝 A sheet can have a raster behind it and still be empty, and an empty plate that says nothing reads
            //    as a broken one. Only a holder carrying a word for it pays for the look: one pass over the alpha
            //    channel of a plate that is 192² at its largest.
            if (Holder.dataset.empty)
            {
                let Ink = false;
                for (let Index = 3; Index < Preview.Pixels.length; Index += 4)
                    if (Preview.Pixels[Index] > 2)
                    {
                        Ink = true;
                        break;
                    }
                Holder.classList.toggle("blank", !Ink);
            }
        }
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
                    { Identifier: "conductors", Label: "Metals" },
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
        if (Section === "materials" && Item === "conductors")
            return MaterialLibrary.filter((Entry) => Entry.Category === "metal").map((Entry) => ({
                Identifier: Entry.Identifier,
                Label: Entry.Label,
                Note: Entry.Note,
                Type: "Conductor",
                Measure: MetalByIdentifier[Entry.Identifier.replace("metal-", "")]
                    ? `rough ${MetalByIdentifier[Entry.Identifier.replace("metal-", "")].Roughness.toFixed(2)}`
                    : `${Entry.Layers.length} layer${Entry.Layers.length === 1 ? "" : "s"}`,
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
        // 🔴 A click no longer spends the asset. Content is placed by dragging it onto the model or the stack, so a
        //    click only picks one out — the keyboard keeps a way in, because a drag cannot be typed.
        const Shelf = Select("#browser-items");
        Shelf.addEventListener("click", (Event) =>
        {
            const Tile = Event.target.closest("[data-item]");
            if (!Tile) return;
            this.BrowserHeld = this.BrowserHeld === Tile.dataset.item ? "" : Tile.dataset.item;
            this.RenderBrowserItems();
        });
        Shelf.addEventListener("keydown", (Event) =>
        {
            const Tile = Event.target.closest("[data-item]");
            if (!Tile || (Event.key !== "Enter" && Event.key !== " ")) return;
            Event.preventDefault();
            this.ApplyBrowserItem(Tile.dataset.item);
        });
        Shelf.addEventListener("dragstart", (Event) =>
        {
            const Tile = Event.target.closest("[data-item]");
            if (!Tile) return;
            this.BrowserHeld = Tile.dataset.item;
            this.DragAsset = { Selection: this.BrowserSelection, Identifier: Tile.dataset.item };
            Event.dataTransfer.effectAllowed = "copy";
            Event.dataTransfer.setData("text/plain", `${this.BrowserSelection}/${Tile.dataset.item}`);
            Tile.classList.add("dragging");
            Select("#texture-workspace")?.classList.add("carrying");
        });
        Shelf.addEventListener("dragend", () =>
        {
            this.DragAsset = null;
            SelectAll("#browser-items .dragging").forEach((Element) => Element.classList.remove("dragging"));
            Select("#texture-workspace")?.classList.remove("carrying");
            this.Canvas?.classList.remove("drop-here");
        });
        // The model is the obvious place to drop a material or a decal, so the viewport takes one too.
        this.Canvas.addEventListener("dragover", (Event) =>
        {
            if (!this.DragAsset) return;
            Event.preventDefault();
            Event.dataTransfer.dropEffect = "copy";
            this.Canvas.classList.add("drop-here");
        });
        this.Canvas.addEventListener("dragleave", () => this.Canvas.classList.remove("drop-here"));
        this.Canvas.addEventListener("drop", (Event) =>
        {
            if (!this.DragAsset) return;
            Event.preventDefault();
            this.Canvas.classList.remove("drop-here");
            const Carried = this.DragAsset;
            this.DragAsset = null;
            this.ApplyBrowserItem(Carried.Identifier, { Selection: Carried.Selection });
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
        } · drag onto the model or the stack`;
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
            const Held = Entry.Identifier === this.BrowserHeld ? "held" : "";
            const Hint = `${Escape(Entry.Note || Entry.Label)} — drag onto the model or the stack`;
            return this.BrowserView === "list"
                ? `<button class="browser-row ${Entry.Active ? "active" : ""} ${Held}" data-item="${Entry.Identifier}" ${Delay}
                           draggable="true" title="${Hint}">
                       <span class="browser-swatch" style="background:${Entry.Swatch}">${Entry.Markup || ""}</span>
                       <span class="browser-row-copy"><strong>${Escape(Entry.Label)}</strong>
                           <small>${Escape(Entry.Type)} · ${Escape(Entry.Measure || "")}</small></span>
                       <span class="browser-row-add">${Icon("drag")}</span>
                   </button>`
                : `<button class="browser-tile ${Entry.Active ? "active" : ""} ${Held}" data-item="${Entry.Identifier}" ${Delay}
                           draggable="true" title="${Hint}">
                       <span class="browser-thumb">${Thumb}<span class="tile-grip">${Icon("drag")}</span></span>
                       <span class="browser-name">${Escape(Entry.Label)}<small>${Escape(Entry.Type)}</small></span>
                   </button>`;
        }).join("");
        FillIcons(Shelf);
    }

    // `Landing` is where the drop happened: which shelf the asset came from, and optionally the row it was let go
    // over — `{ At: layer identifier, Inside: true }` for a drop onto a folder's own row.
    ApplyBrowserItem(Identifier, Landing = {})
    {
        const [Section, Item] = (Landing.Selection || this.BrowserSelection).split("/");
        this.AssetLanding = Landing.At ? { At: Landing.At, Inside: !!Landing.Inside } : null;
        if (Section === "materials" && (Item === "presets" || Item === "conductors"))
        {
            const Preset = MaterialByIdentifier[Identifier];
            if (!Preset) return;
            const Layers = ExpandMaterial(Preset);
            const Landing = this.AssetLanding;
            this.AssetLanding = null;
            const Anchor = Landing?.At ? this.LayerByIdentifier(Landing.At) : null;
            const Holder = Anchor
                ? Landing.Inside && Anchor.Kind === "folder"
                    ? Anchor.Identifier
                    : Anchor.Parent || ""
                : this.ActiveLayer?.Kind === "folder" && !this.ActiveLayer.Collapsed
                  ? this.ActiveLayer.Identifier
                  : this.ActiveLayer?.Parent || "";
            for (const Entry of Layers) Entry.Parent = Holder;
            this.CaptureStack(() =>
            {
                const Index = Anchor
                    ? this.LayerIndex(Anchor.Identifier) - (Landing.Inside ? 1 : 0)
                    : this.LayerIndex(this.Project.Selection);
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
        const Landing = this.AssetLanding;
        this.AssetLanding = null;
        const Anchor = Landing?.At ? this.LayerByIdentifier(Landing.At) : null;
        if (Anchor) Layer.Parent = Landing.Inside && Anchor.Kind === "folder" ? Anchor.Identifier : Anchor.Parent || "";
        else
        {
            const Chosen = this.ActiveLayer;
            if (Chosen) Layer.Parent = Chosen.Kind === "folder" && !Chosen.Collapsed ? Chosen.Identifier : Chosen.Parent || "";
        }
        const Index = Anchor ? this.LayerIndex(Anchor.Identifier) - (Landing.Inside ? 1 : 0) : this.LayerIndex(this.Project.Selection);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Layer);
            this.Project.Selection = Layer.Identifier;
        });
        this.SyncToolToLayer(Layer.Kind === "decal");
        this.Chronicle(Layer.Kind === "decal" ? "decal" : "structure", `Added ${Layer.Name}`, `${LayerBadge(Layer)} layer`, Layer.Channels.base_color);
        this.Notify(Layer.Kind === "decal" ? `${Layer.Name} added — click the model to stamp it.` : `${Layer.Name} added.`);
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
        this.SyncPlaneTiles();
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
        this.DrawPlaneWire(Plane.clientWidth || Canvas.clientWidth * (Zoom / Aspect));
        const Note = Select("#plane-note");
        const Surface = this.SurfaceRecord;
        const Span = Surface?.Tiles?.Columns || 1;
        const Text = Surface
            ? `${Surface.Triangles.toLocaleString()} tris · ${Surface.Ranges.length} object${Surface.Ranges.length === 1 ? "" : "s"} · ${Span}×${Span} tiles`
            : "";
        if (Note && Note.textContent !== Text) Note.textContent = Text;
    }

    // 🔴 Who owns a press over the sheet. The UDIM squares are real elements sitting on top of the canvas, so while
    //    they take the pointer nothing underneath them can ever be painted — which is exactly what went wrong: in
    //    texture space the brush was drawing on a grid of divs. A square is clickable only when the hand is holding
    //    the tool that arranges things rather than one that marks them.
    SyncPlaneTiles()
    {
        const Tiles = Select("#uv-tiles");
        if (!Tiles) return;
        const Arranging = this.Tool === "orbit";
        Tiles.classList.toggle("arranging", Arranging);
        const Note = Select("#tile-hint");
        if (Note) Note.textContent = Arranging ? "Click a square to move the object onto it" : "Orbit to rearrange tiles";
    }

    // The unwrap itself, drawn over the sheet: every triangle of every visible object, with the one in hand picked out.
    // It is redrawn only when the picture would actually differ — the box it sits in is positioned by CSS, so panning
    // and small zooms cost nothing at all.
    DrawPlaneWire(Width)
    {
        const Canvas = Select("#uv-wire");
        if (!Canvas) return;
        Canvas.hidden = !this.PlaneWire;
        const Surface = this.SurfaceRecord;
        if (!this.PlaneWire || !Surface) return;
        const Size = Clamp(Math.round((Width || 0) / 256) * 256, 512, 2048);
        const Owner = this.ActiveLayer?.Object || this.Project.Object || "";
        const Hidden = this.Project.Objects.filter((Entry) => !Entry.Visible).length;
        const Signature = `${Size}:${Surface.Vertices}:${Surface.Triangles}:${Owner}:${Hidden}`;
        if (Signature === this.WireSignature) return;
        const Context = Canvas.getContext("2d");
        // A stand-in canvas has no raster behind it; the overlay simply stays empty.
        if (typeof Context?.beginPath !== "function" || typeof Context.stroke !== "function") return;
        this.WireSignature = Signature;
        Canvas.width = Size;
        Canvas.height = Size;
        Context.clearRect(0, 0, Size, Size);
        const Coordinates = Surface.Coordinates;
        const Indices = Surface.Indices;
        const Trace = (Range) =>
        {
            Context.beginPath();
            const Last = (Range.FirstTriangle + Range.TriangleCount) * 3;
            for (let Corner = Range.FirstTriangle * 3; Corner < Last; Corner += 3)
            {
                const A = Indices[Corner] * 2;
                const B = Indices[Corner + 1] * 2;
                const C = Indices[Corner + 2] * 2;
                const Ax = Coordinates[A] * Size;
                const Ay = (1 - Coordinates[A + 1]) * Size;
                Context.moveTo(Ax, Ay);
                Context.lineTo(Coordinates[B] * Size, (1 - Coordinates[B + 1]) * Size);
                Context.lineTo(Coordinates[C] * Size, (1 - Coordinates[C + 1]) * Size);
                Context.lineTo(Ax, Ay);
            }
            Context.stroke();
        };
        Context.lineWidth = Math.max(Size / 1400, 0.6);
        for (const Range of Surface.Ranges)
        {
            const Entry = this.Project.Objects.find((Candidate) => Candidate.Identifier === Range.Identifier);
            if (Entry && !Entry.Visible) continue;
            const Lit = Owner ? Range.Identifier === Owner : Range.Identifier === this.ActiveObject?.Identifier;
            Context.strokeStyle = Lit ? "rgba(52, 199, 89, 0.42)" : "rgba(255, 255, 255, 0.16)";
            Trace(Range);
        }
    }

    // Symmetry is only useful if you can see it: the button lights, the seam is drawn on the model, and the mirrored
    // cursor shows where the twin stroke will land.
    SetSymmetry(Axis, Announce = false)
    {
        const Known = SymmetryOrdering.some((Entry) => Entry.Identifier === Axis) ? Axis : "none";
        this.Projection.Configure({ Symmetry: Known });
        Select("#sector-field")?.classList.toggle("shown", Known === "radial");
        this.SyncPodSummary();
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
            Button.title =
                Known === "none"
                    ? "Symmetry · Y"
                    : Known === "radial"
                      ? `Symmetry: radial ×${this.Projection.Brush.Sectors} · Y`
                      : `Symmetry: mirror ${Known.toUpperCase()} · Y`;
        }
        this.UpdateCaption();
        if (Announce)
            this.Notify(
                Known === "none"
                    ? "Symmetry off."
                    : Known === "radial"
                      ? `Repeating every ${(360 / this.Projection.Brush.Sectors).toFixed(0)}° around the up axis.`
                      : `Mirroring across ${Known.toUpperCase()}.`,
            );
    }

    // The decal in hand, shown where it would land before the click that commits it.
    NotePlacement(Hit)
    {
        const Layer = this.ActiveLayer;
        if (!Hit || this.Tool !== "decal" || Layer?.Kind !== "decal")
        {
            this.Placement = null;
            return;
        }
        const Frame = StrokeProjection.PlacementFrame(Hit, this.ViewReference());
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
        if (!Ghost || this.Sizing) return;   // while S is held the ring belongs to the size, not to the cursor
        const Painting = this.Tool === "brush" || this.Tool === "eraser";
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

    // A mask holds coverage, not colour, so a stroke into one carries the brightness of the colour in hand:
    // a pale colour reveals the layer, a dark one hides it, exactly as the swatch suggests.
    //----------------------------------------------------------------------------------------------------------------------
    // The colour one dab goes down in. With the dynamics at rest this is the colour in hand; with any of them open the
    // dab wanders off it — a fresh roll per dab, which is why two strokes over the same ground never match.
    //
    // 🔴 Rolled here rather than in the shader. One draw call carries one colour and a dab IS one draw call, so this is
    //    the only place that can vary it without a second uniform the pass would have to unpack for every texel.
    //----------------------------------------------------------------------------------------------------------------------
    DabColour(Target, Segment = null)
    {
        const Where = this.RampFraction(Segment);
        const Colour = Where === null ? this.BrushColour : RampColourAt(this.Gradient.Stops, Where);
        if (Target === "mask") return this.MaskInk(this.WanderColour(Colour, true));
        return this.WanderColour(Colour, false);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Where one dab sits in the ramp, or null when the stroke is not carrying one.
    //
    // Two measurements, because the hand means two different things by "a gradient along a stroke". ALONG is the
    // distance actually travelled — the projection has been counting it since the press — so a mark that wanders takes
    // the long way through the colours. END TO END is where the dab falls between the two ends of the mark, which fits
    // the ramp to the stroke however crooked the path between them was.
    //
    // 🔴 A freehand stroke has no far end yet: the hand has not let go. The straight distance out from where the stroke
    //    began stands in for it — still a position rather than a path length, which is the distinction that matters —
    //    and an aimed line, whose two ends ARE both known, is fitted exactly.
    //----------------------------------------------------------------------------------------------------------------------
    RampFraction(Segment)
    {
        const Ramp = this.Gradient;
        if (!Ramp.Carry || !Segment) return null;
        // A plane segment names its ends in UV; a surface segment names them in the world.
        const Flat = Segment.StartPlane !== undefined;
        // Texture space measures in UV and the ramp is set in metres, so travel is converted by what one UV unit is
        // worth on the model — the same number the stamping pass is handed as `Span`.
        const Worth = Flat ? Math.max((this.SurfaceRecord?.Bounds.Radius || 1) * 3.2, 1e-6) : 1;
        const Middle = Flat
            ? [(Segment.StartPlane[0] + Segment.EndPlane[0]) / 2, (Segment.StartPlane[1] + Segment.EndPlane[1]) / 2]
            : [0, 1, 2].map((Axis) => (Segment.Start[Axis] + Segment.End[Axis]) / 2);
        const Origin = Flat ? this.RampOrigin?.Plane : this.RampOrigin?.Position;
        if (Ramp.Fit === "ends" && Origin)
        {
            const Axis = Flat ? this.RampOrigin?.PlaneAxis : this.RampOrigin?.Axis;
            const Delta = Middle.map((Part, Index) => Part - Origin[Index]);
            const Length = Axis ? Math.hypot(...Axis) : 0;
            // An aimed line knows both its ends, so the ramp is fitted to the axis itself. Freehand does not, so the
            // straight distance out from the press is handed over and `RampAt` measures it against the set length.
            if (Axis && Length > 1e-6) return RampAt(0, Delta.reduce((Sum, Part, Index) => Sum + Part * Axis[Index], 0) / Length, Ramp, Length);
            return RampAt(0, Math.hypot(...Delta) * Worth, Ramp);
        }
        const Travel = ((Segment.Travel?.[0] ?? 0) + (Segment.Travel?.[1] ?? 0)) / 2;
        return RampAt(Travel * Worth, 0, Ramp);
    }

    // What the card's test sheet asks for: the same answer, from the two distances a scratch stroke can measure.
    // Both are in metres, and which of them counts is the fit — exactly as it is on the model.
    PadTint(Along, Straight)
    {
        if (!this.Gradient.Carry) return null;
        return RampColourAt(this.Gradient.Stops, RampAt(Along, Straight, this.Gradient));
    }

    // The ramp as the pass should receive it. A mask keeps one number per texel, so a gradient laid into one is a
    // gradient of VALUES — the same conversion a dab makes on its way into a mask, made once for the whole ramp.
    GradientFor(Target)
    {
        if (Target !== "mask") return this.Gradient;
        return {
            ...this.Gradient,
            Stops: SortRampStops(this.Gradient.Stops).map((Stop) => ({ ...Stop, Colour: this.MaskInk(Stop.Colour) })),
        };
    }

    // One way in for the size of the head, wherever it was asked for: the brackets, a wheel with Alt down, the slider
    // on the card, or the hand holding S and dragging.
    //
    // 📝 The card follows, but only once a frame. A drag fires a move every few milliseconds and a rebuilt pane
    //    redraws a CPU-rasterised ribbon with it, so one rebuild per event turns a drag into a slideshow.
    SetRadius(Value)
    {
        this.Projection.Configure({ Radius: Clamp(Value, 0.004, 1.2) });
        this.SyncBrushControls();
        if (!this.Instruments?.Open || this.SizeTurn) return;
        this.SizeTurn = requestAnimationFrame(() =>
        {
            this.SizeTurn = 0;
            if (this.Instruments?.Open) this.Instruments.RenderPane(false);
        });
    }

    NudgeRadius(Factor)
    {
        this.SetRadius(this.Projection.Brush.Radius * Factor);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Sizing the head by hand: hold `S` and drag. The ring is the head, the cursor is on its rim, and the rim follows
    // the hand — out from the centre to grow it, in towards the centre to shrink it.
    //
    // 🔴 Measured as a DISTANCE from the ring's centre, never as travel along the direction the drag set off in. The
    //    direction version could invert itself: whichever way the hand twitched in its first few pixels became "out",
    //    so a drag that meant to grow the brush shrank it to nothing and kept shrinking. Distance from a point cannot
    //    disagree with the eye — away is bigger and towards is smaller in every direction, with nothing to remember.
    //
    // 📝 Which is why the centre is NOT under the cursor. The key goes down with the cursor on the rim of the ring,
    //    one radius out from the centre, so there is room to drag inwards. Pressing with the centre under the hand
    //    would leave the brush at nothing with no way back but outwards.
    //----------------------------------------------------------------------------------------------------------------------
    BeginSizing()
    {
        if (this.Sizing || !this.Canvas) return;
        const Bounds = this.Canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
        const At = this.PointerAt ? [...this.PointerAt] : [Bounds.left + Bounds.width / 2, Bounds.top + Bounds.height / 2];
        // Room to work in: a hair of a brush still needs a few dozen pixels of travel to shrink into, and a brush the
        // size of the viewport cannot put its centre off the edge of it.
        const Pixels = this.RadiusPixels();
        const Reach = Clamp(Pixels, 28, 260);
        this.Sizing = {
            Anchor: [At[0] - Reach, At[1]],
            From: this.Projection.Brush.Radius,
            Pixels,
            Reach,
            Flat: this.ViewMode !== "surface",
        };
        this.DrawSizingRing();
        if (!this.SizingTold)
        {
            this.SizingTold = true;
            this.Notify("Drag away from the ring to grow the head, in towards it to shrink it.");
        }
    }

    DragSizing(Event)
    {
        const Sizing = this.Sizing;
        if (!Sizing) return;
        const Away = Math.hypot(Event.clientX - Sizing.Anchor[0], Event.clientY - Sizing.Anchor[1]);
        // 📝 In the viewport the head is sized in SCREEN pixels, one for one: the rim of the ring sits under the
        //    cursor and stays there, so the size being chosen is the size being looked at. Texture space has no
        //    camera to measure a pixel against, so there the drag is a plain multiple of where it started.
        if (Sizing.Flat) this.SetRadius(Sizing.From * Clamp(Away / Sizing.Reach, 0.02, 40));
        else this.SetRadius(this.RadiusFromPixels(Math.max(1, Sizing.Pixels + (Away - Sizing.Reach))));
        this.DrawSizingRing();
    }

    // The head's radius in screen pixels, which is what the ring is drawn at and what the drag is measured against,
    // and the same journey back the other way.
    RadiusPixels(Radius = this.Projection.Brush.Radius)
    {
        if (this.ViewMode !== "surface") return 60;
        return Radius / this.PixelReach();
    }

    RadiusFromPixels(Pixels)
    {
        return Pixels * this.PixelReach();
    }

    PixelReach()
    {
        const Bounds = this.Canvas?.getBoundingClientRect?.();
        const Height = Bounds?.height || 1;
        return (2 * Math.tan(this.Camera.FieldOfView / 2) * Math.max(this.Camera.Distance, 0.1)) / Height;
    }

    EndSizing()
    {
        if (!this.Sizing) return;
        this.Sizing = null;
        const Ghost = Select("#brush-ghost");
        if (!Ghost) return;
        Ghost.classList.remove("sizing");
        Ghost.hidden = true;
    }

    // The ring sits where the key went down, not under the pointer: the hand is dragging the EDGE of the head out,
    // and a ring that chased the cursor would be showing the size somewhere the paint is not going to land.
    DrawSizingRing()
    {
        const Ghost = Select("#brush-ghost");
        if (!Ghost || !this.Sizing || this.ViewMode !== "surface") return;
        const Bounds = this.Canvas.getBoundingClientRect();
        const Pixels = this.RadiusPixels();
        Ghost.hidden = false;
        Ghost.classList.add("sizing");
        Ghost.style.width = `${Math.max(Pixels * 2, 8)}px`;
        Ghost.style.height = `${Math.max(Pixels * 2, 8)}px`;
        Ghost.style.left = `${this.Sizing.Anchor[0] - Bounds.left}px`;
        Ghost.style.top = `${this.Sizing.Anchor[1] - Bounds.top}px`;
        Ghost.style.borderColor = `${ToHex(this.PreviewInk().Ink)}cc`;
    }

    // Scaling the gradient, from the keyboard as well as the card: `G` shortens it, `⇧G` lengthens it, by the same
    // step the brush is resized by. Which number it is depends on how the ramp is being measured.
    ScaleRamp(Factor)
    {
        const Ramp = this.Gradient;
        if (Ramp.Carry && Ramp.Fit === "ends")
        {
            Ramp.Scale = Clamp(Ramp.Scale * Factor, 0.05, 8);
            this.Notify(`Gradient fitted over ×${Ramp.Scale.toFixed(2)} of the stroke.`);
        }
        else
        {
            Ramp.Span = Clamp(Ramp.Span * Factor, 0.01, 8);
            this.Notify(
                Ramp.Carry
                    ? `Gradient runs ${(Ramp.Span * 100).toFixed(0)} cm along the stroke.`
                    : `Gradient length ${(Ramp.Span * 100).toFixed(0)} cm · switch it on in Colour to run through it.`,
            );
        }
        if (this.Instruments?.Open) this.Instruments.RenderPane(false);
        this.Instruments?.DrawPad();
    }

    WanderColour(Colour, Masking)
    {
        const Reach = this.Dynamics;
        if (!Reach || (!Reach.Hue && !Reach.Saturation && !Reach.Value)) return Colour;
        const Roll = () => Math.random() * 2 - 1;
        const [Tone, Strength, Level] = RgbToHsv(Colour);
        // A whole turn of the wheel per dab is confetti, not paint; a sixth of it is the most a hand-mixed palette
        // ever wanders, so that is what the slider's full travel buys.
        const Wheel = Masking ? Tone : Tone + Roll() * Reach.Hue * 60;
        const Mixed = Clamp(Strength * (1 + Roll() * Reach.Saturation * 0.8), 0, 1);
        const Lit = Clamp(Level * (1 + Roll() * Reach.Value * 0.7), 0, 1);
        return HsvToRgb([Wheel, Masking ? Strength : Mixed, Lit]);
    }

    MaskInk(Colour = this.BrushColour)
    {
        const Value = Clamp(0.2126 * Colour[0] + 0.7152 * Colour[1] + 0.0722 * Colour[2], 0, 1);
        return [Value, Value, Value];
    }

    // What the next stroke would lay down, so the ring is a preview rather than an outline.
    PreviewInk()
    {
        const Brush = this.Projection.Brush;
        const Erasing = this.Tool === "eraser";
        if (Brush.Target === "mask") return { Ink: Erasing ? [0.04, 0.04, 0.05] : this.MaskInk(), Preview: 0.4 };
        if (Erasing) return { Ink: [0.06, 0.06, 0.07], Preview: 0.32 };
        // A stroke carrying the ramp does not start in the colour in hand, so the ring must not say it does.
        const Opening = this.Gradient.Carry ? RampColourAt(this.Gradient.Stops, this.Gradient.Reverse ? 1 : 0) : this.BrushColour;
        return { Ink: Opening, Preview: Clamp(Brush.Flow * 0.7, 0.12, 0.6) };
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
                // Alt is the shortcut every stack has: hold it and the eye isolates instead of hiding.
                if (Event.altKey) this.IsolateLayer(Layer.Identifier);
                else this.CaptureStack(() => (Layer.Visible = !Layer.Visible));
                return;
            }
            const Fold = Event.target.closest("[data-collapse-layer]");
            if (Fold)
            {
                Event.stopPropagation();
                const Layer = this.LayerByIdentifier(Fold.dataset.collapseLayer);
                if (Layer) Layer.Collapsed = !Layer.Collapsed;
                this.RenderStack();
                return;
            }
            const Alone = Event.target.closest("[data-solo-layer]");
            if (Alone)
            {
                Event.stopPropagation();
                this.IsolateLayer(Alone.dataset.soloLayer);
                return;
            }
            const Loosen = Event.target.closest("[data-ungroup-layer]");
            if (Loosen)
            {
                Event.stopPropagation();
                this.UngroupFolder(Loosen.dataset.ungroupLayer);
                return;
            }
            // Deleting is a row action, not a menu entry: the layer you mean is the one your pointer is already on.
            const Discard = Event.target.closest("[data-remove-layer]");
            if (Discard)
            {
                Event.stopPropagation();
                this.SelectLayer(Discard.dataset.removeLayer);
                this.RemoveLayer();
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
        // Dropping onto the middle of a folder's row puts the layer inside it; the top and bottom thirds of any row
        // mean "beside this one", which is how a layer gets back out of a folder again.
        const Landing = (Event, Row) =>
        {
            if (!Row || this.LayerByIdentifier(Row.dataset.layer)?.Kind !== "folder") return false;
            const Bounds = Row.getBoundingClientRect();
            return Event.clientY > Bounds.top + Bounds.height * 0.3 && Event.clientY < Bounds.bottom - Bounds.height * 0.3;
        };
        Stack.addEventListener("dragover", (Event) =>
        {
            Event.preventDefault();
            if (this.DragAsset) Event.dataTransfer.dropEffect = "copy";
            const Row = Event.target.closest("[data-layer]");
            SelectAll(".layer-row.drop-target, .layer-row.drop-inside").forEach((Element) =>
                Element.classList.remove("drop-target", "drop-inside"),
            );
            Stack.classList.toggle("drop-here", !!this.DragAsset && !Row);
            if (!Row || Row.dataset.layer === this.DragIdentifier) return;
            if (this.DragIdentifier && !CanHold(this.Layers, this.DragIdentifier, Row.dataset.layer)) return;
            Row.classList.add(Landing(Event, Row) ? "drop-inside" : "drop-target");
        });
        Stack.addEventListener("drop", (Event) =>
        {
            Event.preventDefault();
            const Row = Event.target.closest("[data-layer]");
            const Inside = Landing(Event, Row);
            SelectAll(".layer-row.drop-target, .layer-row.drop-inside").forEach((Element) =>
                Element.classList.remove("drop-target", "drop-inside"),
            );
            Stack.classList.remove("drop-here");
            // Content dragged out of the browser lands exactly where it was let go, folder and all.
            if (this.DragAsset)
            {
                const Carried = this.DragAsset;
                this.DragAsset = null;
                this.ApplyBrowserItem(Carried.Identifier, {
                    Selection: Carried.Selection,
                    At: Row?.dataset.layer || "",
                    Inside,
                });
                return;
            }
            if (!Row || !this.DragIdentifier) return;
            this.MoveLayer(this.DragIdentifier, Row.dataset.layer, Inside);
            this.DragIdentifier = "";
        });
        Stack.addEventListener("dragleave", (Event) =>
        {
            if (!Stack.contains(Event.relatedTarget)) Stack.classList.remove("drop-here");
        });
        Stack.addEventListener("dragend", () =>
        {
            Stack.classList.remove("drop-here");
            SelectAll(".layer-row.dragging").forEach((Element) => Element.classList.remove("dragging"));
            SelectAll(".layer-row.drop-target, .layer-row.drop-inside").forEach((Element) =>
                Element.classList.remove("drop-target", "drop-inside"),
            );
        });
    }

    VisibleLayers()
    {
        // A filter or a search flattens the tree — what matches is what shows, wherever it lives.
        const Flattened = this.LayerFilter !== "all" || !!this.LayerQuery;
        const Folded = new Set();
        if (!Flattened)
            for (const Layer of this.Layers)
            {
                if (Layer.Kind !== "folder" || !Layer.Collapsed) continue;
                for (const Inside of LayerInside(this.Layers, Layer.Identifier)) Folded.add(Inside.Identifier);
            }
        return [...this.Layers]
            .reverse()
            .filter((Layer) =>
            {
                if (Folded.has(Layer.Identifier)) return false;
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
                  const Folder = Layer.Kind === "folder";
                  const Depth = Math.min(FolderLimit, LayerAncestry(this.Layers, Layer.Identifier).length);
                  const Held = Folder ? LayerInside(this.Layers, Layer.Identifier).length : 0;
                  const Isolated = this.Solo === Layer.Identifier;
                  const Dimmed = !!this.Solo && !Isolated && !LayerSubtree(this.Layers, this.Solo).includes(Layer);
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
                <div class="layer-row ${Selected ? "selected" : ""} ${Layer.Visible ? "" : "muted"} ${Folder ? "folder-row" : ""}
                     ${Depth ? "nested" : ""} ${Isolated ? "isolated" : ""} ${Dimmed ? "outside" : ""}"
                     style="--depth:${Depth}" data-layer="${Layer.Identifier}" data-object="${Layer.Kind}" draggable="true"
                     role="treeitem" aria-expanded="${Folder ? String(!Layer.Collapsed) : "undefined"}"
                     aria-selected="${Selected}" tabindex="0">
                    <span class="layer-accent"></span>
                    ${
                        Folder
                            ? `<button class="icon-button row-fold" data-collapse-layer="${Layer.Identifier}"
                                       aria-label="${Layer.Collapsed ? "Open" : "Close"} ${Escape(Layer.Name)}"
                                       title="${Layer.Collapsed ? "Open" : "Close"} the folder">
                                   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
                               </button>`
                            : ""
                    }
                    <span class="layer-swatch" style="--swatch:${Swatch}" ${Folder ? "" : `data-thumbnail="${Layer.Identifier}"`}>
                        ${Folder ? "" : '<canvas width="64" height="64" aria-hidden="true"></canvas>'}${Icon(Kind.Glyph)}
                    </span>
                    <span class="layer-copy">
                        <span class="layer-name">${Escape(Layer.Name)}</span>
                        <span class="layer-note">${Escape(LayerBadge(Layer).toLowerCase())} · ${Escape(Layer.Blend)} · ${
                            Folder
                                ? `${Held} inside`
                                : Layer.Kind === "decal"
                                  ? `${Layer.Decal.Marks.length} mark${Layer.Decal.Marks.length === 1 ? "" : "s"}`
                                  : `${LayerChannelCount(Layer)} channels`
                        }</span>
                    </span>
                    <span class="layer-metric"><strong>${Math.round(Layer.Opacity * 100)}</strong><small>%</small></span>
                    <button class="icon-button row-solo ${Isolated ? "active" : ""}" data-solo-layer="${Layer.Identifier}"
                            aria-pressed="${Isolated}" aria-label="Isolate ${Escape(Layer.Name)}"
                            title="${Isolated ? "Show the whole stack again · I" : "Isolate this layer · I"}">${Icon("focus")}</button>
                    <button class="icon-button row-toggle" data-toggle-layer="${Layer.Identifier}"
                            aria-label="${Layer.Visible ? "Hide" : "Show"} ${Escape(Layer.Name)}"
                            title="${Layer.Visible ? "Hide" : "Show"} layer">${Icon(Layer.Visible ? "eye" : "hidden")}</button>
                    <button class="icon-button row-remove" data-remove-layer="${Layer.Identifier}"
                            aria-label="Delete ${Escape(Layer.Name)}" title="Delete layer · Del">${Icon("trash")}</button>
                    <span class="layer-chips">
                        ${
                            Folder
                                ? `<button class="row-chip" data-ungroup-layer="${Layer.Identifier}" title="Let these layers out of the folder">
                                       ${Icon("up")}Ungroup
                                   </button>`
                                : ""
                        }
                        <button class="row-chip ${Folder ? "hidden-chip" : ""} ${Selected && !Masking ? "targeted" : ""}" data-chip="content"
                                data-chip-layer="${Layer.Identifier}" title="Paint into the layer">
                            <span class="chip-swatch" style="--swatch:${Swatch}"></span>Content
                        </button>
                        <button class="row-chip mask-chip ${Folder ? "hidden-chip" : ""} ${Carried ? "present" : "absent"} ${Selected && Masking ? "targeted" : ""}"
                                data-chip="mask" data-chip-layer="${Layer.Identifier}"
                                title="${Carried ? "Paint into the mask" : "Add a mask and paint into it"}">
                            ${Icon(Carried ? "mask" : "plus")}${Escape(MaskNote)}
                        </button>
                    </span>
                </div>`;
              }).join("")
            : `<div class="outliner-empty">No layers match that filter.</div>`;
        const Folders = this.Layers.filter((Layer) => Layer.Kind === "folder").length;
        const Isolating = this.Solo ? ` · isolating ${this.LayerByIdentifier(this.Solo)?.Name || "a layer"}` : "";
        Select("#stack-subtitle").textContent =
            `${this.Layers.length} layer${this.Layers.length === 1 ? "" : "s"} · ${Masked} masked${
                Folders ? ` · ${Folders} folder${Folders === 1 ? "" : "s"}` : ""
            }${Isolating} · top first`;
        Select("#layer-stack").classList.toggle("isolating", !!this.Solo);
        this.RefreshThumbnails();
    }

    CaptureStack(Mutate)
    {
        const Before = structuredClone(this.StackRecord());
        Mutate();
        this.Project.Layers = OrderStack(this.Project.Layers);
        const After = structuredClone(this.StackRecord());
        this.Revisions.Record({ Kind: "stack", Before, After });
        this.AfterStackChange();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // 🔴 The scene travels in the undo record alongside the stack. Adding an object, moving one to another UDIM tile or
    //    hiding it are all edits a person expects Ctrl Z to take back, and leaving them out made undo quietly skip half
    //    of what had just happened — the layers rewound and the objects did not.
    //----------------------------------------------------------------------------------------------------------------------
    StackRecord()
    {
        return {
            Layers: this.Layers,
            Selection: this.Project.Selection,
            Material: this.Project.Material,
            Objects: this.Project.Objects,
            Object: this.Project.Object,
        };
    }

    ApplyStackRecord(Record)
    {
        const Scene = JSON.stringify(this.Project.Objects || []);
        this.Project.Layers = OrderStack(structuredClone(Record.Layers));
        this.Project.Selection = Record.Selection;
        this.Project.Material = structuredClone(Record.Material);
        if (Record.Objects)
        {
            this.Project.Objects = structuredClone(Record.Objects);
            this.Project.Object = Record.Object || this.Project.Objects[0]?.Identifier || "";
        }
        // 📝 Reassembling the surface is expensive, so it only happens when the objects actually differ. An undo that
        //    only touched the stack must not pay for a re-bake.
        if (JSON.stringify(this.Project.Objects || []) !== Scene)
        {
            this.RebuildSurface();
            this.RenderObjects();
        }
        this.AfterStackChange();
    }

    AfterStackChange()
    {
        if (this.ActiveLayer && this.ActiveLayer.Identifier !== this.SyncedLayer) this.SyncToolToLayer();
        this.MarkDirty();
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
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
            this.AddFinishLayer("gt-silver");
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
            projected: () =>
                CreateLayer("decal", {
                    Name: "Placed decal",
                    Decal: { SourceKind: "svg", Library: "arrow", Placement: "project" },
                    Channels: { base_color: [0.95, 0.3, 0.22], specular_roughness: 0.3, height: 0.58 },
                }),
            folder: () => CreateLayer("folder", { Name: "Folder" }),
        };
        const Factory = Descriptor[Kind] || Descriptor.fill;
        const Layer = Factory();
        if (this.ScopedStack || this.Isolated) Layer.Object = this.Project.Object;
        // A new layer joins whatever the selection is already in — and an open folder adopts it outright.
        const Chosen = this.ActiveLayer;
        if (Chosen && Layer.Kind !== "folder")
            Layer.Parent = Chosen.Kind === "folder" && !Chosen.Collapsed ? Chosen.Identifier : Chosen.Parent || "";
        else if (Chosen && Layer.Kind === "folder" && LayerAncestry(this.Layers, Chosen.Identifier).length < FolderLimit - 1)
            Layer.Parent = Chosen.Parent || "";
        const Index = this.LayerIndex(this.Project.Selection);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, Layer);
            this.Project.Selection = Layer.Identifier;
        });
        if (Layer.Kind === "decal") this.RefreshDecal(Layer);
        if (Layer.Kind === "stroke") this.Integrator.EnsureCoverage(Layer);
        this.SyncToolToLayer(Layer.Kind === "decal");
        this.Chronicle(Layer.Kind === "decal" ? "decal" : "structure", `Added ${Layer.Name}`, `${LayerBadge(Layer)} layer`, Layer.Channels.base_color);
        this.Notify(
            Layer.Kind !== "decal"
                ? `${Layer.Name} added above ${Index >= 0 ? this.Layers[Index]?.Name || "the stack" : "the stack"}.`
                : Layer.Decal.Placement === "stamp"
                  ? `${Layer.Name} added — each click burns the artwork into it.`
                  : `${Layer.Name} added — click the model to place it, then drag to move it.`,
        );
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

    // A dragged layer brings its whole subtree with it. `Inside` is the drop that lands on a folder's own row: the run
    // is parented to that folder and slid in behind it. Anything else lands beside the target and joins its folder.
    MoveLayer(Identifier, TargetIdentifier, Inside = false)
    {
        const Moving = this.LayerByIdentifier(Identifier);
        const Target = this.LayerByIdentifier(TargetIdentifier);
        if (!Moving || !Target || Identifier === TargetIdentifier) return;
        if (!CanHold(this.Layers, Identifier, TargetIdentifier)) return;
        const Holder = Inside && Target.Kind === "folder" ? Target.Identifier : Target.Parent || "";
        if (Holder && LayerAncestry(this.Layers, Holder).length + 1 + this.NestingOf(Identifier) > FolderLimit) return;
        const Run = LayerSubtree(this.Layers, Identifier);
        this.CaptureStack(() =>
        {
            const Start = this.Project.Layers.indexOf(Run[0]);
            this.Project.Layers.splice(Start, Run.length);
            Moving.Parent = Holder;
            const Landing = this.Project.Layers.indexOf(Target);
            const At = Landing < 0 ? this.Project.Layers.length : Landing;
            this.Project.Layers.splice(At, 0, ...Run);
            this.Project.Selection = Identifier;
        });
    }

    // How many folder levels a layer carries below it, so a drop cannot push the tree past its limit.
    NestingOf(Identifier)
    {
        const Inside = LayerInside(this.Layers, Identifier);
        if (!Inside.length) return 0;
        const Root = LayerAncestry(this.Layers, Identifier).length;
        return Math.max(...Inside.map((Layer) => LayerAncestry(this.Layers, Layer.Identifier).length - Root));
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Folders and isolation. A folder holds layers the way a scene holds objects: hide it and everything inside goes with
    // it, fade it and everything inside fades. Isolating a layer is the other half of the same question — what is this
    // one actually doing? — and it leaves the rest of the stack out of the composite until it is switched off.
    //----------------------------------------------------------------------------------------------------------------------
    GroupSelection()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        if (LayerAncestry(this.Layers, Layer.Identifier).length + this.NestingOf(Layer.Identifier) + 1 >= FolderLimit)
        {
            this.Notify(`Folders only nest ${FolderLimit} deep.`);
            return;
        }
        const Folder = CreateLayer("folder", { Name: `${Layer.Name} set`, Parent: Layer.Parent || "" });
        const Run = LayerSubtree(this.Layers, Layer.Identifier);
        this.CaptureStack(() =>
        {
            const Start = this.Project.Layers.indexOf(Run[0]);
            this.Project.Layers.splice(Start + Run.length, 0, Folder);
            Layer.Parent = Folder.Identifier;
            this.Project.Selection = Folder.Identifier;
        });
        this.Chronicle("structure", `Grouped ${Layer.Name}`, Folder.Name);
        this.Notify(`${Layer.Name} is now inside ${Folder.Name}.`);
    }

    UngroupFolder(Identifier)
    {
        const Folder = this.LayerByIdentifier(Identifier);
        if (!Folder || Folder.Kind !== "folder") return;
        const Inside = LayerInside(this.Layers, Identifier);
        this.CaptureStack(() =>
        {
            for (const Layer of Inside) if (Layer.Parent === Identifier) Layer.Parent = Folder.Parent || "";
            const At = this.Project.Layers.indexOf(Folder);
            if (At >= 0) this.Project.Layers.splice(At, 1);
            this.Project.Selection = Inside[0]?.Identifier || this.Project.Layers.at(-1)?.Identifier || "";
        });
        if (this.Solo === Identifier) this.Solo = "";
        this.Chronicle("structure", `Opened ${Folder.Name}`, `${Inside.length} layers freed`);
        this.Notify(`${Folder.Name} opened — ${Inside.length} layer${Inside.length === 1 ? "" : "s"} let out.`);
    }

    IsolateLayer(Identifier = this.Project.Selection)
    {
        const Layer = this.LayerByIdentifier(Identifier);
        if (!Layer) return;
        this.Solo = this.Solo === Identifier ? "" : Identifier;
        this.Recomposite();
        this.RenderStack();
        this.UpdateStatusBar();
        this.Notify(
            this.Solo
                ? `Isolated ${Layer.Name}${Layer.Kind === "folder" ? " and everything inside it" : ""}. Press I to show the stack again.`
                : "The whole stack is composited again.",
        );
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
        // A folder is copied with everything inside it, and the copies are re-pointed at each other, not at the original.
        const Run = LayerSubtree(this.Layers, Layer.Identifier);
        const Copies = Run.map((Entry) => CloneLayer(Entry));
        const Renamed = new Map(Run.map((Entry, Index) => [Entry.Identifier, Copies[Index].Identifier]));
        for (const Copy of Copies) if (Renamed.has(Copy.Parent)) Copy.Parent = Renamed.get(Copy.Parent);
        const Copy = Copies[Copies.length - 1];
        const Index = this.LayerIndex(Layer.Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index + 1, 0, ...Copies);
            this.Project.Selection = Copy.Identifier;
        });
        for (const Entry of Copies) if (Entry.Kind === "decal") this.RefreshDecal(Entry);
        this.Chronicle("structure", `Duplicated ${Layer.Name}`, `${this.Layers.length} layers`, Layer.Channels.base_color);
        this.Notify(Copies.length > 1 ? `${Layer.Name} duplicated with ${Copies.length - 1} inside.` : `${Layer.Name} duplicated.`);
    }

    RemoveLayer()
    {
        if (this.Layers.length <= 1)
        {
            this.Notify("A stack keeps at least one layer.");
            return;
        }
        const Layer = this.ActiveLayer;
        const Run = LayerSubtree(this.Layers, Layer.Identifier);
        if (Run.length >= this.Layers.length)
        {
            this.Notify("A stack keeps at least one layer outside its folders.");
            return;
        }
        const Index = this.LayerIndex(Run[0].Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Index, Run.length);
            this.Project.Selection = this.Layers[Math.min(this.Layers.length - 1, Math.max(0, Index - 1))].Identifier;
        });
        for (const Entry of Run) this.Integrator.ReleaseLayer(Entry.Identifier);
        if (Run.some((Entry) => Entry.Identifier === this.Solo)) this.Solo = "";
        this.Chronicle("structure", `Removed ${Layer.Name}`, `${this.Layers.length} layers left`);
        this.Notify(Run.length > 1 ? `${Layer.Name} and ${Run.length - 1} inside it removed.` : `${Layer.Name} removed.`);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Flattening the stack into one painted layer.
    //
    // 🔴 Only the colour channel survives per texel, and the rest are carried as their composited AVERAGE. A layer owns
    //    one coverage image and a constant for every other channel — that is the whole storage model — so a flatten that
    //    claimed to keep per-texel roughness would be inventing a layer kind that cannot be saved, painted or undone.
    //    The honest result is: the surface looks identical in colour, every other channel becomes the single value the
    //    stack averaged to, and the toast says so while the undo entry is still one keystroke away.
    // 📝 Flattening is what an export wants, so it opens the export dialogue afterwards: the two are one action in the
    //    user's head — "give me one texture I can hand to an engine".
    //----------------------------------------------------------------------------------------------------------------------
    FlattenStack()
    {
        if (!this.Integrator?.Ready)
        {
            this.Notify("The renderer is not running, so there is nothing to flatten.");
            return;
        }
        const Count = this.Layers.length;
        const Colour = this.Integrator.ComposedImage(0);
        if (!Colour)
        {
            this.Notify("The composite could not be read back.");
            return;
        }
        // Coverage is premultiplied, and a flattened layer covers everything, so the alpha goes to one and the colour
        // bytes carry straight over.
        const Pixels = new Uint8Array(Colour.Pixels);
        for (let Index = 3; Index < Pixels.length; Index += 4) Pixels[Index] = 255;
        const Averages = this.ChannelAverages();
        const Layer = CreateLayer("stroke", {
            Name: "Flattened surface",
            Channels: { ...Averages },
            Enabled: Object.fromEntries(ChannelSpecification.map((Channel) => [Channel.Identifier, true])),
        });
        const Kept = this.Layers.map((Entry) => Entry.Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers = [Layer];
            this.Project.Selection = Layer.Identifier;
        });
        this.Integrator.EnsureCoverage(Layer);
        this.Integrator.RestoreLayer(Layer, "coverage", { Resolution: Colour.Width, Pixels });
        // 📝 The old layers' images are deliberately NOT released: undo puts those layers straight back, and a released
        //    coverage image would come back blank.
        this.Recomposite();
        this.RenderStack();
        this.RenderInspector();
        this.Chronicle("structure", "Flattened the stack", `${Count} layers → 1`, Layer.Channels.base_color);
        this.Notify(`${Count} layers flattened into one · colour per texel, every other channel averaged · Ctrl Z restores`);
        this.FlattenedFrom = Kept.length;
        this.OpenExport();
    }

    // The composited mean of every channel, read out of the four packed targets in one pass each. Sampling every fourth
    // texel is plenty for an average and keeps a 4096² flatten off the main thread for less than a frame.
    ChannelAverages()
    {
        const Targets = [0, 1, 2, 3].map((Index) => this.Integrator.ComposedImage(Index));
        const Component = { r: 0, g: 1, b: 2, a: 3 };
        const Averages = {};
        const Mean = (Pixels, Offset, Stride) =>
        {
            let Total = 0;
            let Count = 0;
            for (let Index = Offset; Index < Pixels.length; Index += Stride)
            {
                Total += Pixels[Index];
                Count += 1;
            }
            return Count ? Total / Count / 255 : 0;
        };
        for (const Channel of ChannelSpecification)
        {
            const Image = Targets[Channel.Target];
            if (!Image) continue;
            if (Channel.Swizzle === "rgb")
                Averages[Channel.Identifier] = [0, 1, 2].map((Offset) => Mean(Image.Pixels, Offset, 16));
            else Averages[Channel.Identifier] = Mean(Image.Pixels, Component[Channel.Swizzle] ?? 0, 16);
        }
        // The flattened layer paints its colour from the coverage image, so the stored constant is only a swatch.
        return Averages;
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
                    this.NudgeRadius(Event.deltaY < 0 ? 1.08 : 0.926);
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
            Button.addEventListener("click", () => this.SetTool(Button.dataset.tool, true)),
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
        Select("#wire-button")?.addEventListener("click", () =>
        {
            this.PlaneWire = !this.PlaneWire;
            Select("#wire-button").classList.toggle("active", this.PlaneWire);
            this.WireSignature = "";
            this.SyncPlaneOverlay();
            this.Notify(this.PlaneWire ? "Unwrap shown." : "Unwrap hidden.");
        });
        Select("#tiles-button")?.addEventListener("click", () =>
        {
            this.PlaneTiles = !this.PlaneTiles;
            Select("#tiles-button").classList.toggle("active", this.PlaneTiles);
            Select("#uv-tiles").hidden = !this.PlaneTiles;
            this.Notify(this.PlaneTiles ? "UDIM tiles shown." : "UDIM tiles hidden.");
        });
        // 🔴 Clicking a tile is the UDIM workflow, not a decoration: an occupied tile selects the object that lives on
        //    it, and an empty one moves the object in hand there. Both read as "this square is where that object's
        //    texture is", which is the only thing a UDIM number means.
        Select("#uv-tiles")?.addEventListener("click", (Event) =>
        {
            const Cell = Event.target.closest("[data-tile]");
            if (!Cell) return;
            const Tile = Number(Cell.dataset.tile);
            const Owner = (this.SurfaceRecord?.Ranges || []).find((Range) => Range.Tile === Tile);
            if (Owner && Owner.Identifier !== this.Project.Object) this.SelectObject(Owner.Identifier, true);
            else if (!Owner) this.MoveObjectToTile(Tile);
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

    // Which tools make sense for the layer in hand. Orbit and the picker are about the viewport, so they are always
    // offered; the rest follow the layer, and the mask takes paint from every kind of layer.
    ToolsForLayer(Layer = this.ActiveLayer)
    {
        const Masking = this.Projection.Brush.Target === "mask";
        if (!Layer) return ["orbit", "brush", "eraser", "fill", "decal", "picker"];
        if (Layer.Kind === "decal" && !Masking) return ["orbit", "decal", "eraser", "picker"];
        if (Masking) return ["orbit", "brush", "eraser", "fill", "decal", "picker"];
        return ["orbit", "brush", "eraser", "fill", "picker"];
    }

    RefreshToolButtons()
    {
        const Allowed = this.ToolsForLayer();
        const Layer = this.ActiveLayer;
        SelectAll("[data-tool]").forEach((Button) =>
        {
            const Offered = Allowed.includes(Button.dataset.tool);
            Button.hidden = !Offered;
            Button.disabled = !Offered;
        });
        const Decal = Select('[data-tool="decal"]');
        if (Decal)
        {
            const Stamping = Layer?.Kind !== "decal" || Layer.Decal.Placement === "stamp";
            Decal.title = Stamping ? "Stamp the decal into the layer · 5" : "Place a 3D decal on the surface · 5";
            Decal.setAttribute("aria-label", Decal.title.replace(" · 5", ""));
        }
        return Allowed;
    }

    SyncToolRail()
    {
        const Allowed = this.RefreshToolButtons();
        if (!Allowed.includes(this.Tool)) this.SetTool(this.ActiveLayer?.Kind === "decal" ? "decal" : "brush");
    }

    SetTool(Tool, Deliberate = false)
    {
        this.Tool = Tool;
        this.Projection.Tool = Tool;
        SelectAll("[data-tool]").forEach((Button) => Button.classList.toggle("active", Button.dataset.tool === Tool));
        // A tool the hand reached for sticks to the layer it was chosen on; one the layer asked for does not.
        if (Deliberate) this.ChosenTool = Tool;
        this.SyncedLayer = this.ActiveLayer?.Identifier || "";
        this.RefreshToolButtons();
        this.SyncPlaneTiles();
        this.UpdateCaption();
    }

    // The layer in hand decides the tool: a decal layer stamps, anything else paints. Orbit and the picker are
    // deliberate choices about the viewport rather than the layer, so they are left alone, and so is an eraser or a
    // flood that was chosen by hand on a paintable layer.
    SyncToolToLayer(Force = false)
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        this.SyncedLayer = Layer.Identifier;
        // A mask is painted, whatever the layer under it is made of: a decal layer's mask still wants a brush.
        const Masking = this.Projection.Brush.Target === "mask";
        const Wanted = Layer.Kind === "decal" && !Masking ? "decal" : "brush";
        if (this.Tool === Wanted) return;
        if (!Force)
        {
            if (this.Tool === "orbit" || this.Tool === "picker") return;
            if (Wanted === "brush" && (this.Tool === "eraser" || this.Tool === "fill") && this.ChosenTool === this.Tool) return;
        }
        this.SetTool(Wanted);
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
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Leaving = this.Projection.Brush.Target;
        let Opened = "";
        if (Wanted === "mask")
        {
            // The mask a layer gets on the way in is the one the colour in hand will show against: a pale colour
            // wants a black mask to reveal into, a dark colour wants a white mask to cut away.
            if (Layer.Mask.Kind === "none")
            {
                Opened = this.MaskInk()[0] >= 0.5 ? "black" : "white";
                this.AddMask(Opened, false);
            }
            // What was in hand for the content is kept, because coming back to the content and finding a brush where
            // a decal tool used to be is the kind of small theft that makes a tool feel untrustworthy.
            if (Leaving !== "mask") this.ContentTool = this.ChosenTool || this.Tool;
        }
        this.Projection.Configure({ Target: Wanted });
        // 🔴 The side being painted belongs to the LAYER, not to the brush. The brush carries it because the stamping
        //    pass needs one place to read it from, but it is written back here so that stepping away to another layer
        //    and returning finds the same side in hand — a mask is part of the layer it hides, not a mode of the app.
        Layer.Target = Wanted;
        this.FollowPaintTarget(Wanted);
        this.SyncPaintTarget();
        this.SyncToolRail();
        this.RefreshThumbnails();
        this.Instruments?.Refresh();
        if (Announce)
            this.Notify(
                Wanted === "coverage"
                    ? `Painting ${Layer.Name} itself.`
                    : Opened
                      ? `${Opened === "black" ? "Black" : "White"} mask added to ${Layer.Name} — painting into it.`
                      : `Painting the mask on ${Layer.Name} — light reveals, dark hides.`,
            );
    }

    //----------------------------------------------------------------------------------------------------------------------
    // What the viewport and the tool rail do when the side being painted changes. Switching to a mask that cannot be seen
    // is painting blind, so the view follows; and a tool that cannot touch a mask — the camera, the dropper, a decal on a
    // decal layer — hands over to the brush and is handed back on the way out.
    //----------------------------------------------------------------------------------------------------------------------
    FollowPaintTarget(Wanted)
    {
        const Outer = this.SyncingSide;
        this.SyncingSide = true;
        if (Wanted === "mask")
        {
            // 📝 The view is deliberately left alone. Painting a mask is watching the surface open and close under
            //    the brush, so the thing to look at while doing it is the surface.
            if (!["brush", "eraser", "fill"].includes(this.Tool)) this.SetTool("brush", true);
        }
        else
        {
            if (this.MaskView !== "off") this.SetMaskView("off", false);
            const Layer = this.ActiveLayer;
            const Restored = this.ContentTool || (Layer?.Kind === "decal" ? "decal" : "brush");
            if (this.ToolsForLayer().includes(Restored)) this.SetTool(Restored, true);
            else this.SyncToolToLayer(true);
            this.ContentTool = "";
        }
        this.SyncingSide = Outer;
    }

    SyncPaintTarget()
    {
        const Masking = this.Projection.Brush.Target === "mask";
        const Toggle = Select("#mask-toggle");
        Toggle.classList.toggle("active", Masking);
        Toggle.setAttribute("aria-pressed", String(Masking));
        const Note = Select("#paint-target-note");
        // The note names the LAYER, because the whole confusion the mask used to cause was not knowing which one's
        // mask was under the brush — the switch is global on screen and the thing it switches is not.
        const Layer = this.ActiveLayer;
        Note.textContent = Masking
            ? `Painting the mask on ${Layer?.Name || "this layer"} · white reveals, black hides`
            : `Painting ${Layer?.Name || "the layer"} itself`;
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
        this.Instruments?.Refresh();
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
        Layer.Target = "coverage";
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

    //----------------------------------------------------------------------------------------------------------------------
    // Two ways to look at a mask: at the surface it is shaping, or at the mask on its own in black and white.
    //
    // 🔴 There used to be a third — a pink wash over the surface marking what the mask hid — and it was the one view
    //    nobody could work in. Masking is hiding and revealing something you are looking at, and a tint over the top
    //    says where the mask is at the price of the one thing you are judging: what the layer looks like now. The
    //    wash is gone, and with it the tint colour nobody set. Painting a mask shows the surface, and the surface
    //    answers the brush: paint black and the layer falls away under it. The brush target and the view are no
    //    longer welded either — aiming at the mask leaves the view where it is.
    //----------------------------------------------------------------------------------------------------------------------
    get MaskView()
    {
        return this.Display === "mask" ? "isolated" : "off";
    }

    SetMaskView(Mode, Announce = true)
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        const Wanted = Mode === "isolated" ? "mask" : "off";
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
        // 🔴 Looking at a mask and painting the layer underneath it is the oldest way to lose an afternoon, so the
        //    view and the side being painted are one switch with two handles: move either and the other follows.
        if (!this.SyncingSide)
        {
            const Side = Wanted === "off" ? "coverage" : "mask";
            this.SyncingSide = true;
            if (this.Projection.Brush.Target !== Side) this.SetPaintTarget(Side, false);
            this.SyncingSide = false;
        }
        this.Recomposite();
        this.SyncMaskView();
        this.RenderInspector();
        this.UpdateCaption();
        if (!Announce) return;
        this.Notify(Wanted === "mask" ? "Showing the layer mask." : "Back to the shaded surface.");
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

    // Channels arrive as they are needed rather than all at once: a layer that has never been painted writes nothing,
    // and the stroke that lands on it brings the channel it writes along.
    EnsureChannel(Layer, Identifier)
    {
        if (!Layer || Layer.Enabled[Identifier]) return;
        Layer.Enabled[Identifier] = true;
        this.RenderStack();
        if (this.InspectorTab === "layer") this.RenderInspector();
        this.Notify(`${ChannelLabel(Identifier)} added to ${Layer.Name} by the first stroke.`);
    }

    PaintTargetLayer()
    {
        const Layer = this.ActiveLayer;
        if (this.Projection.Brush.Target === "mask" && Layer.Kind !== "folder")
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
        // A decal layer holds burned pixels of its own, so the brush and the eraser work it directly rather than
        // dropping a hand-painted layer on top of it.
        if (Layer.Kind === "decal") return Layer;
        // Anything else — a fill, a generator, a material, a folder — keeps its recipe. The brush opens a painted layer
        // of its own: above the selection, or inside it when the selection is a folder.
        const Folder = Layer.Kind === "folder";
        const Painted = CreateLayer("stroke", {
            Name: "Hand painted",
            Parent: Folder ? Layer.Identifier : Layer.Parent || "",
            Channels: { base_color: [...this.BrushColour], specular_roughness: Layer.Channels.specular_roughness },
        });
        const Index = this.LayerIndex(Layer.Identifier);
        this.CaptureStack(() =>
        {
            this.Project.Layers.splice(Folder ? Index : Index + 1, 0, Painted);
            this.Project.Selection = Painted.Identifier;
        });
        this.Integrator.EnsureCoverage(Painted);
        this.Notify(Folder ? `A hand-painted layer was added inside ${Layer.Name}.` : "A hand-painted layer was added above the selection.");
        return Painted;
    }

    OnPointerDown(Event)
    {
        if (!this.Integrator.Ready) return;
        this.PointerAt = [Event.clientX, Event.clientY];
        // 🔴 Half the world sizes a brush by holding the key and dragging with the button down. The press is
        //    swallowed — nothing is painted while the head is being sized — but it does NOT end the drag, because a
        //    hand that presses the button first and then moves would otherwise get one dab and no resizing at all.
        if (this.Sizing)
        {
            this.Canvas.setPointerCapture?.(Event.pointerId);
            return;
        }
        this.Canvas.setPointerCapture(Event.pointerId);
        this.PointerButton = Event.button;
        this.PointerPrevious = [Event.clientX, Event.clientY];
        // Only the left button ever puts paint down; every other button drives the camera, so the brush can stay in
        // hand while the model is turned. PointerIntent is the one place that rule lives.
        const Navigating = PointerIntent({ Button: Event.button, Tool: this.Tool, Space: this.SpaceHeld }).Navigate;
        this.Navigating = Navigating;
        this.PickCandidate = Navigating && this.Tool === "orbit" && Event.button === 0 ? [Event.clientX, Event.clientY] : null;
        if (Navigating)
        {
            // A camera button pressed in the middle of a stroke closes the stroke rather than dragging it round with
            // the model, so the undo step covers exactly what was painted before the hand moved to the camera.
            if (this.Projection.Active)
            {
                this.CommitStrokeRevision();
                this.Projection.End();
            }
            return;
        }

        // Texture space takes the same tools as the surface does. The sheet is the thing being painted either way;
        // only the way a point is named changes — a UV coordinate here, a ray cast at the model there.
        if (this.ViewMode === "plane")
        {
            const Coordinate = this.PlaneCoordinates(Event);
            if (this.Tool === "picker")
            {
                this.PickAt(Coordinate);
                return;
            }
            if (this.Tool === "decal")
            {
                this.PlaceDecalPlane(Coordinate);
                return;
            }
            if (this.Tool === "fill")
            {
                this.FloodActive();
                return;
            }
            if (this.Tool !== "brush" && this.Tool !== "eraser") return;
            if (this.StrokeMode !== "freehand")
            {
                this.LineAnchor = { Point: [Event.clientX, Event.clientY], Plane: Coordinate, Reading: this.PointerReading(Event) };
                this.DrawRubber([Event.clientX, Event.clientY], [Event.clientX, Event.clientY]);
                return;
            }
            const Layer = this.PaintTargetLayer();
            if (this.Projection.Brush.Target !== "mask" && this.Tool === "brush") this.EnsureChannel(Layer, "base_color");
            this.BeginStrokeRevision(Layer);
            this.RampOrigin = { Plane: [...Coordinate] };
            const Opening = this.Projection.BeginPlane(Coordinate, this.PointerReading(Event));
            this.NotePaintedCoordinate(Coordinate);
            this.StampPlane(Layer, Opening);
            return;
        }

        // A decal handle is tested before the model is, because the spindle deliberately sits off the outline — in
        // front of empty space as often as not — and a ray that misses the model must not be read as "orbit".
        const Grip = Event.button === 0 ? this.GizmoGrip(Event) : null;
        if (Grip)
        {
            this.HoldGizmo(Event, Grip);
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
            this.PickAt(Hit.Coordinate);
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
        // A line and a gradient are both two points: the press only fixes the first one, and nothing is laid down
        // until the hand lets go. Until then the rubber band is the whole of the feedback.
        if (this.StrokeMode !== "freehand" && (this.Tool === "brush" || this.Tool === "eraser"))
        {
            this.LineAnchor = { Point: [Event.clientX, Event.clientY], Hit, Reading: this.PointerReading(Event) };
            this.DrawRubber([Event.clientX, Event.clientY], [Event.clientX, Event.clientY]);
            return;
        }
        const Layer = this.PaintTargetLayer();
        if (this.Projection.Brush.Target !== "mask" && this.Tool === "brush") this.EnsureChannel(Layer, "base_color");
        this.BeginStrokeRevision(Layer);
        // Where the ramp starts from, before the first dab asks for its colour. Freehand has no far end to aim at, so
        // the axis is left out and the ramp is measured out from here.
        this.RampOrigin = { Position: [...Hit.Position] };
        const Segment = this.Projection.Begin(Hit, this.PointerReading(Event));
        this.NotePaintedCoordinate(Hit.Coordinate);
        this.StampSurface(Layer, Segment);
    }

    OnPointerMove(Event)
    {
        if (!this.Integrator.Ready) return;
        // Where the pointer is, kept whatever it is doing: it is the anchor the next S-drag starts from.
        this.PointerAt = [Event.clientX, Event.clientY];
        if (this.Sizing)
        {
            this.DragSizing(Event);
            return;
        }
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
            const Intent = PointerIntent({
                Button: this.PointerButton,
                Tool: this.Tool,
                Space: this.SpaceHeld,
                Shift: Event.shiftKey,
            });
            if (Intent.Pan) this.Camera.Pan(Delta[0], Delta[1]);
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
            if (this.LineAnchor)
            {
                this.DrawRubber(this.LineAnchor.Point, this.AimedPoint(Event));
                return;
            }
            if (this.MovingMark && this.PointerButton !== undefined)
            {
                this.MoveMarkPlane(Coordinate);
                return;
            }
            if (this.Projection.Active && (this.Tool === "brush" || this.Tool === "eraser"))
            {
                const Segment = this.Projection.ExtendPlane(Coordinate, PlaneRadius, this.PointerReading(Event));
                if (Segment)
                {
                    this.NotePaintedCoordinate(Segment.EndPlane);
                    this.StampPlane(this.ActiveLayer, Segment);
                }
            }
            return;
        }

        if (this.GizmoGrab)
        {
            this.DragGizmo(Event);
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
        if (this.LineAnchor)
        {
            this.DrawRubber(this.LineAnchor.Point, this.AimedPoint(Event));
            return;
        }
        if (this.MovingMark && this.PointerButton !== undefined)
        {
            this.MoveMark(Hit);
            return;
        }
        if (!Hit || !this.Projection.Active) return;
        if (this.Tool !== "brush" && this.Tool !== "eraser") return;
        const Segment = this.Projection.Extend(Hit, this.PointerReading(Event));
        if (Segment)
        {
            this.NotePaintedCoordinate(Hit.Coordinate);
            this.StampSurface(this.ActiveLayer, Segment);
        }
    }

    OnPointerUp(Event)
    {
        if (this.Canvas.hasPointerCapture?.(Event.pointerId)) this.Canvas.releasePointerCapture(Event.pointerId);
        // The button going up during an S-drag releases nothing but the button: the size is still in the hand that
        // is still holding the key, and there is no stroke to finish because none was ever begun.
        if (this.Sizing)
        {
            this.PointerButton = undefined;
            this.Navigating = false;
            return;
        }
        if (this.GizmoGrab)
        {
            this.ReleaseGizmo();
            this.PickCandidate = null;
            this.Navigating = false;
            this.PointerButton = undefined;
            return;
        }
        if (this.LineAnchor)
        {
            const Anchor = this.LineAnchor;
            this.LineAnchor = null;
            this.HideRubber();
            if (Event.type !== "pointercancel") this.LayStraight(Anchor, this.AimedPoint(Event));
            this.PickCandidate = null;
            this.Navigating = false;
            this.PointerButton = undefined;
            this.PointerPrevious = null;
            return;
        }
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
        this.Navigating = false;
        this.PointerButton = undefined;
        this.PointerPrevious = null;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Straight lines and gradients.
    //
    // Both are aimed rather than drawn: the press fixes one end, the release fixes the other, and what happens in
    // between is a rubber band. A line is then walked in SCREEN space and raycast at every step, so it wraps round the
    // model the way a ruler laid on the object would — a line drawn between two surface points in 3D would cut
    // straight through it. A gradient is one pass over the whole sheet, fading along the axis between the two points.
    //----------------------------------------------------------------------------------------------------------------------
    AimedPoint(Event)
    {
        const Point = [Event.clientX, Event.clientY];
        if (!this.LineAnchor) return Point;
        return SnapLine(this.LineAnchor.Point, Point, this.LineSnap);
    }

    DrawRubber(From, To)
    {
        const Band = Select("#stroke-rubber");
        if (!Band) return;
        const Box = this.Canvas.getBoundingClientRect();
        const Ends = Band.querySelectorAll("circle");
        const Line_ = Band.querySelector("line:not(.rubber-ink)");
        const Points = [
            [From[0] - Box.left, From[1] - Box.top],
            [To[0] - Box.left, To[1] - Box.top],
        ];
        Line_?.setAttribute("x1", Points[0][0]);
        Line_?.setAttribute("y1", Points[0][1]);
        Line_?.setAttribute("x2", Points[1][0]);
        Line_?.setAttribute("y2", Points[1][1]);
        Ends[0]?.setAttribute("cx", Points[0][0]);
        Ends[0]?.setAttribute("cy", Points[0][1]);
        Ends[1]?.setAttribute("cx", Points[1][0]);
        Ends[1]?.setAttribute("cy", Points[1][1]);
        Band.classList.toggle("gradient", this.StrokeMode === "gradient");
        this.DrawRubberInk(Points, From, To);
        Band.hidden = false;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The mark, while it is still being aimed.
    //
    // 🔴 A dashed hairline says where the stroke will go. It does not say what the stroke IS — and with a gradient in
    //    hand that is the whole question: which end is silver, where the gold starts, whether the ramp runs out
    //    halfway. So the band is painted in the paint: sampled along the aim, through the same `RampAt` the dabs go
    //    through, at the thickness the brush will actually lay.
    //
    // 📝 Sampled rather than handed to one SVG gradient with the ramp's own stops, because the ramp repeats, eases
    //    and reverses, and may run out long before the far end. Twenty-four samples answer all of that for free.
    //----------------------------------------------------------------------------------------------------------------------
    DrawRubberInk(Points, From, To)
    {
        const Ink = Select("#rubber-ink");
        const Ramp = Select("#rubber-ramp");
        if (!Ink || !Ramp) return;
        const Wash = this.StrokeMode === "gradient";
        if (!this.Gradient.Carry || this.Projection.Brush.Target === "mask")
        {
            Ink.setAttribute("stroke-width", "0");
            return;
        }

        // Screen pixels into metres, at the distance the camera is looking: the inverse of the ghost's own maths.
        const Box = this.Canvas.getBoundingClientRect();
        const Metres = (2 * Math.tan(this.Camera.FieldOfView / 2) * Math.max(this.Camera.Distance, 0.1)) / Math.max(Box.height, 1);
        const Length = Math.hypot(To[0] - From[0], To[1] - From[1]) * Metres;
        const Stops = SortRampStops(this.Gradient.Stops);

        const Samples = 24;
        let Markup = "";
        for (let Step = 0; Step <= Samples; Step += 1)
        {
            const Share = Step / Samples;
            const Where = Wash
                ? RampEase(this.Gradient.Reverse ? 1 - Share : Share, this.Gradient.Easing)
                : RampAt(Length * Share, Length * Share, this.Gradient, this.Gradient.Fit === "ends" ? Length : 0);
            Markup += `<stop offset="${(Share * 100).toFixed(1)}%" stop-color="${ToHex(RampColourAt(Stops, Where))}"/>`;
        }
        Ramp.innerHTML = Markup;
        Ramp.setAttribute("x1", Points[0][0]);
        Ramp.setAttribute("y1", Points[0][1]);
        Ramp.setAttribute("x2", Points[1][0]);
        Ramp.setAttribute("y2", Points[1][1]);

        // A line is laid at the brush's own thickness; a wash covers the whole sheet, so its band is only an axis.
        const Thickness = Wash
            ? 12
            : Math.max((this.Projection.Brush.Radius * Math.max(Box.height, 1)) / (Math.tan(this.Camera.FieldOfView / 2) * Math.max(this.Camera.Distance, 0.1)), 6);
        Ink.setAttribute("x1", Points[0][0]);
        Ink.setAttribute("y1", Points[0][1]);
        Ink.setAttribute("x2", Points[1][0]);
        Ink.setAttribute("y2", Points[1][1]);
        Ink.setAttribute("stroke-width", String(Math.min(Thickness, 160)));
    }

    HideRubber()
    {
        const Band = Select("#stroke-rubber");
        if (Band) Band.hidden = true;
    }

    // The furthest point along the aim that still lands on the model, walked back from the far end. A gradient needs
    // two surface points for its axis, and the hand will drag off the silhouette every time.
    FurthestHit(From, To)
    {
        const Steps = 24;
        for (let Step = Steps; Step >= 0; Step -= 1)
        {
            const Fraction = Step / Steps;
            const Point = { clientX: From[0] + (To[0] - From[0]) * Fraction, clientY: From[1] + (To[1] - From[1]) * Fraction };
            const [DeviceX, DeviceY] = this.DeviceCoordinates(Point);
            const Hit = this.Projection.Resolve(this.Index, this.Camera, DeviceX, DeviceY);
            if (Hit) return Hit;
        }
        return null;
    }

    LayStraight(Anchor, To)
    {
        if (this.ViewMode === "plane")
        {
            this.LayStraightPlane(Anchor, To);
            return;
        }
        if (this.StrokeMode === "gradient")
        {
            this.LayGradient(Anchor, To);
            return;
        }
        const Layer = this.PaintTargetLayer();
        if (this.Projection.Brush.Target !== "mask" && this.Tool === "brush") this.EnsureChannel(Layer, "base_color");
        this.BeginStrokeRevision(Layer);
        // An aimed line is the one stroke whose two ends are both known before a dab goes down, so a ramp fitted end
        // to end is fitted exactly rather than measured out from the press.
        const Landing = this.Gradient.Carry ? this.FurthestHit(Anchor.Point, To) : null;
        this.RampOrigin = Anchor.Hit
            ? {
                  Position: [...Anchor.Hit.Position],
                  Axis: Landing ? [0, 1, 2].map((Axis) => Landing.Position[Axis] - Anchor.Hit.Position[Axis]) : null,
              }
            : null;

        // Three pixels between samples is finer than any brush, so the projection's own spacing decides where the
        // dabs actually land — the same rule a freehand stroke goes down by.
        const Samples = LineSamples(Anchor.Point, To, 3);
        let Laid = 0;
        for (const Point of Samples)
        {
            const [DeviceX, DeviceY] = this.DeviceCoordinates({ clientX: Point[0], clientY: Point[1] });
            const Hit = this.Projection.Resolve(this.Index, this.Camera, DeviceX, DeviceY);
            if (!Hit) continue;
            const Reading = { ...Anchor.Reading, Time: (Anchor.Reading.Time || 0) + Laid * 16 };
            const Segment = this.Projection.Active ? this.Projection.Extend(Hit, Reading) : this.Projection.Begin(Hit, Reading);
            if (!Segment) continue;
            this.NotePaintedCoordinate(Hit.Coordinate);
            this.StampSurface(Layer, Segment);
            Laid += 1;
        }
        if (this.Projection.Active) this.CommitStrokeRevision();
        this.Projection.End();
        if (!Laid) this.Notify("The line missed the model.");
        else this.Notify(`Line laid down — ${Laid} mark${Laid === 1 ? "" : "s"}.`);
    }

    LayGradient(Anchor, To)
    {
        const Far = this.FurthestHit(Anchor.Point, To);
        if (!Far || !Anchor.Hit)
        {
            this.Notify("A gradient needs both ends on the model.");
            return;
        }
        const Span = Math.hypot(
            Far.Position[0] - Anchor.Hit.Position[0],
            Far.Position[1] - Anchor.Hit.Position[1],
            Far.Position[2] - Anchor.Hit.Position[2],
        );
        if (Span < 1e-4)
        {
            this.Notify("Drag further for a gradient.");
            return;
        }
        const Layer = this.PaintTargetLayer();
        const Target = this.Projection.Brush.Target;
        if (Target !== "mask") this.EnsureChannel(Layer, "base_color");
        this.BeginStrokeRevision(Layer);
        this.Integrator.Stamp(Layer, {
            Target,
            Mode: "gradient",
            Start: Anchor.Hit.Position,
            End: Far.Position,
            Normal: Anchor.Hit.Normal,
            Colour: Target === "mask" ? this.MaskInk() : this.BrushColour,
            Radius: this.Projection.Brush.Radius,
            Hardness: this.Projection.Brush.Hardness,
            Flow: this.Projection.Brush.Flow,
            FacingLimit: this.Projection.FacingLimit,
            Gradient: this.GradientFor(Target),
            Channels: Layer.Channels,
            Writes: this.ChannelWrites,
            Erase: this.Tool === "eraser",
        });
        this.CommitStrokeRevision();
        this.Recomposite();
        this.MarkDirty();
        const Shape = GradientShapes.find((Entry) => Entry.Identifier === this.Gradient.Shape)?.Label || "Linear";
        // The timeline's swatch is what the gradient is made of: the middle of the ramp when it is laying colours,
        // the colour in hand when it is only fading it away.
        const Swatch = this.Gradient.Carry ? RampColourAt(this.Gradient.Stops, 0.5) : this.BrushColour;
        this.Chronicle("stroke", `${Shape} gradient`, `${Span.toFixed(2)} m · ${Layer.Name}`, Swatch);
        this.Notify(`${Shape} gradient laid down over ${Span.toFixed(2)} m.`);
    }

    // The same two aimed tools, in texture space. A line is still walked in SCREEN pixels — that is what keeps the
    // dabs evenly spaced however far the sheet is zoomed — and every step is turned back into a UV coordinate.
    LayStraightPlane(Anchor, To)
    {
        const Layer = this.PaintTargetLayer();
        const Target = this.Projection.Brush.Target;
        if (Target !== "mask" && this.Tool === "brush") this.EnsureChannel(Layer, "base_color");
        const Start = Anchor.Plane || this.PlaneCoordinates({ clientX: Anchor.Point[0], clientY: Anchor.Point[1] });
        const End = this.PlaneCoordinates({ clientX: To[0], clientY: To[1] });
        if (this.StrokeMode === "gradient")
        {
            if (Math.hypot(End[0] - Start[0], End[1] - Start[1]) < 1e-4)
            {
                this.Notify("Drag further for a gradient.");
                return;
            }
            this.BeginStrokeRevision(Layer);
            this.Integrator.Stamp(Layer, {
                Target,
                Mode: "gradient",
                Space: "plane",
                Start: [0, 0, 0],
                End: [0, 0, 0],
                Normal: [0, 1, 0],
                StartPlane: Start,
                EndPlane: End,
                Colour: Target === "mask" ? this.MaskInk() : this.BrushColour,
                Radius: this.Projection.Brush.Radius,
                Hardness: this.Projection.Brush.Hardness,
                Flow: this.Projection.Brush.Flow,
                Gradient: this.GradientFor(Target),
                Channels: Layer.Channels,
                Writes: this.ChannelWrites,
                Erase: this.Tool === "eraser",
            });
            this.CommitStrokeRevision();
            this.Recomposite();
            this.MarkDirty();
            const Shape = GradientShapes.find((Entry) => Entry.Identifier === this.Gradient.Shape)?.Label || "Linear";
            const Swatch = this.Gradient.Carry ? RampColourAt(this.Gradient.Stops, 0.5) : this.BrushColour;
            this.Chronicle("stroke", `${Shape} gradient`, `texture space · ${Layer.Name}`, Swatch);
            this.Notify(`${Shape} gradient laid across the sheet.`);
            return;
        }
        this.BeginStrokeRevision(Layer);
        this.RampOrigin = { Plane: [...Start], PlaneAxis: [End[0] - Start[0], End[1] - Start[1]] };
        const Samples = LineSamples(Anchor.Point, To, 3);
        const PlaneRadius = this.PlaneRadius();
        let Laid = 0;
        for (const Point of Samples)
        {
            const Coordinate = this.PlaneCoordinates({ clientX: Point[0], clientY: Point[1] });
            const Reading = { ...Anchor.Reading, Time: (Anchor.Reading.Time || 0) + Laid * 16 };
            const Segment = this.Projection.Active
                ? this.Projection.ExtendPlane(Coordinate, PlaneRadius, Reading)
                : this.Projection.BeginPlane(Coordinate, Reading);
            if (!Segment) continue;
            this.NotePaintedCoordinate(Segment.EndPlane || Coordinate);
            this.StampPlane(Layer, Segment);
            Laid += 1;
        }
        if (this.Projection.Active) this.CommitStrokeRevision();
        this.Projection.End();
        this.Notify(`Line laid down — ${Laid} mark${Laid === 1 ? "" : "s"}.`);
    }

    PlaneRadius()
    {
        const Radius = this.SurfaceRecord?.Bounds.Radius || 1;
        return Clamp(this.Projection.Brush.Radius / (Radius * 3.2), 0.002, 0.6);
    }

    // What the pointer can say about the hand holding it. A stylus reports its own pressure and tilt; a mouse reports
    // a flat 0.5 the moment a button goes down and means nothing by it, so only a pen is believed — StrokeProjection
    // falls back to the speed of the hand for everything else.
    PointerReading(Event)
    {
        return {
            Pressure: Event?.pressure ?? 0,
            Pen: Event?.pointerType === "pen",
            Time: Event?.timeStamp ?? 0,
        };
    }

    StampSurface(Layer, Segment)
    {
        const Brush = this.Projection.Brush;
        const Erase = this.Tool === "eraser";
        const Target = Brush.Target;
        const Colour = this.DabColour(Target, Segment);
        // 🔴 What the hand reports is not what the paint should do with it. The size curve remaps the pressure handed
        //    to the pass — which is what thins the mark and what the medium deposits by — and the flow curve rides on
        //    top of the instrument's own flow. A curve that does nothing is skipped rather than evaluated.
        const Press = Segment.Press || [1, 1];
        const Shaped = CurveIsPlain(this.Curves.Size)
            ? Press
            : [EvaluateCurve(this.Curves.Size, Press[0]), EvaluateCurve(this.Curves.Size, Press[1])];
        const Flow = CurveIsPlain(this.Curves.Flow)
            ? Brush.Flow
            : Brush.Flow * EvaluateCurve(this.Curves.Flow, (Press[0] + Press[1]) / 2);
        const Options = {
            Target,
            Start: Segment.Start,
            End: Segment.End,
            Normal: Segment.Normal,
            Colour,
            // A chisel nib is as wide as the nib across its edge and as thin as its waist along it.
            Radius: Brush.Radius * (Segment.Width ?? 1),
            Hardness: Brush.Hardness,
            Flow,
            FacingLimit: this.Projection.FacingLimit,
            Jitter: Brush.Jitter,
            Writes: this.ChannelWrites,
            // 🔴 The eraser lifts with the plain medium whatever is in hand. Erasing is an undo of the surface, and an
            //    undo that leaves bristle marks of its own is not one.
            Media: Erase ? null : Brush.Media,
            Press: Shaped,
            Travel: Segment.Travel,
            Erase,
            Mode: "surface",
        };
        this.Integrator.Stamp(Layer, Options);
        // Symmetry is paint, not a view: each twin is stamped in turn, so what is mirrored or turned is in the texture.
        for (const Twin of this.Projection.Twins)
            this.Integrator.Stamp(Layer, {
                ...Options,
                Start: Twin(Segment.Start),
                End: Twin(Segment.End),
                Normal: Twin(Segment.Normal),
            });
        this.Recomposite();
        this.MarkDirty();
    }

    StampPlane(Layer, Segment)
    {
        const Brush = this.Projection.Brush;
        const Erase = this.Tool === "eraser";
        this.Integrator.Stamp(Layer, {
            Target: Brush.Target,
            Start: [0, 0, 0],
            End: [0, 0, 0],
            Normal: [0, 1, 0],
            StartPlane: Segment.StartPlane,
            EndPlane: Segment.EndPlane,
            Colour: this.DabColour(Brush.Target, Segment),
            Radius: Brush.Radius,
            PlaneRadius: this.PlaneRadius() * (Segment.Width ?? 1),
            Hardness: Brush.Hardness,
            Flow: CurveIsPlain(this.Curves.Flow)
                ? Brush.Flow
                : Brush.Flow * EvaluateCurve(this.Curves.Flow, ((Segment.Press?.[0] ?? 1) + (Segment.Press?.[1] ?? 1)) / 2),
            Jitter: Brush.Jitter,
            Writes: this.ChannelWrites,
            Media: Erase ? null : Brush.Media,
            Press: CurveIsPlain(this.Curves.Size)
                ? Segment.Press
                : [
                      EvaluateCurve(this.Curves.Size, Segment.Press?.[0] ?? 1),
                      EvaluateCurve(this.Curves.Size, Segment.Press?.[1] ?? 1),
                  ],
            Travel: Segment.Travel,
            // The flattened view measures in UV. This is what a UV unit is worth in metres, so the paper comes out the
            // same size here as it does on the surface instead of hundreds of times too fine to see.
            Span: (this.SurfaceRecord?.Bounds.Radius || 1) * 3.2,
            Erase,
            Mode: "plane",
        });
        this.Recomposite();
        this.MarkDirty();
    }

    FloodActive()
    {
        const Layer = this.PaintTargetLayer();
        const Target = this.Projection.Brush.Target;
        if (Target !== "mask") this.EnsureChannel(Layer, "base_color");
        this.BeginStrokeRevision(Layer);
        this.Integrator.FloodLayer(Layer, Target, Target === "mask" ? this.MaskInk() : this.BrushColour, 1, Layer.Channels);
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

    // The way back out of per-stroke values: hand every texel on the layer the set currently in hand. The channel
    // images go with them, so the layer costs one image again until the next disagreement.
    LevelActive()
    {
        const Layer = this.PaintTargetLayer();
        if (Layer.Kind !== "stroke") return;
        this.BeginStrokeRevision(Layer);
        const Levelled = this.Integrator.LevelLayer(Layer, Layer.Channels);
        this.CommitStrokeRevision();
        if (!Levelled)
        {
            this.Notify("Nothing has been painted on this layer yet.");
            return;
        }
        this.Recomposite();
        this.MarkDirty();
        this.RenderInspector();
        this.Notify(`${Layer.Name} levelled — every stroke now carries the values in hand.`);
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

    // The pointer walks over texels as it paints; a sampled handful of those coordinates is all the timeline needs to
    // redraw the stroke later, and it is numbers rather than pixels so a long session stays small.
    NotePaintedCoordinate(Coordinate)
    {
        if (!Coordinate) return;
        if (!this.StrokePath) this.StrokePath = [];
        const Last = this.StrokePath[this.StrokePath.length - 1];
        if (Last && Math.hypot(Last[0] - Coordinate[0], Last[1] - Coordinate[1]) < 0.012) return;
        if (this.StrokePath.length >= PreviewLimit) this.StrokePath.shift();
        this.StrokePath.push([Coordinate[0], Coordinate[1]]);
    }

    CommitStrokeRevision(Narrate = true)
    {
        this.RefreshThumbnails();
        if (!this.StrokeRecord) return;
        const Layer = this.Layers.find((Entry) => Entry.Identifier === this.StrokeRecord.Identifier);
        if (Layer)
        {
            this.StrokeRecord.After = this.Integrator.SnapshotLayer(Layer, this.StrokeRecord.Target);
            if (this.StrokeRecord.Before && this.StrokeRecord.After)
            {
                this.Revisions.Record(this.StrokeRecord);
                const Points = this.Projection.Segments || 1;
                if (!Narrate)
                {
                    this.StrokeRecord = null;
                    this.UpdateStatusBar();
                    return;
                }
                this.Chronicle(
                    "stroke",
                    `Added stroke (${Points} point${Points === 1 ? "" : "s"})`,
                    `${Layer.Name} · ${this.StrokeRecord.Target === "mask" ? "mask" : "content"}`,
                    this.Projection.Brush.Target === "mask" ? null : this.BrushColour,
                    this.StrokePath?.length
                        ? { Shape: "path", Points: this.StrokePath, Size: [this.Projection.Brush.Radius, this.Projection.Brush.Radius] }
                        : { Shape: "flood" },
                );
            }
        }
        this.StrokeRecord = null;
        this.StrokePath = null;
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
    //----------------------------------------------------------------------------------------------------------------------
    // The handles on a placement.
    //
    // A decal has been draggable since it could be placed, but size and rotation were sliders — which means looking away
    // from the model to set the two things most obviously about where it sits on the model. The gizmo puts them back on
    // the surface: an outline where the decal actually is, a grip at each corner, and a spindle off the top edge.
    //
    // 🔴 The handles are drawn in SCREEN space over the viewport, not as geometry in it. A handle is a target for a
    //    finger, so it has to stay the same size whether the camera is a metre away or twenty; anything drawn in the
    //    scene would shrink out of reach exactly when the decal got small enough to need it.
    //----------------------------------------------------------------------------------------------------------------------
    GizmoMark()
    {
        if (this.Tool !== "decal" || this.ViewMode === "plane") return null;
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal" || Layer.Decal.Placement !== "project") return null;
        const Mark = this.MarkByIdentifier(Layer.Decal.Selection);
        if (!Mark || Mark.Placed === false || Mark.Visible === false || Mark.Mode !== "projection") return null;
        return Mark;
    }

    GizmoPoints(Mark)
    {
        const Box = this.Canvas.getBoundingClientRect();
        const Screen = (World) =>
        {
            const Device = this.Camera.Place(World);
            if (!Device) return null;
            return [((Device[0] + 1) / 2) * Box.width, ((1 - Device[1]) / 2) * Box.height];
        };
        const Corners = MarkCorners(Mark).map(Screen);
        const Centre = Screen(Mark.Transform.Position);
        const Spindle = Screen(MarkSpindle(Mark));
        if (!Centre || !Spindle || Corners.some((Point) => !Point)) return null;
        return { Corners, Centre, Spindle };
    }

    SyncGizmo()
    {
        const Frame = Select("#decal-gizmo");
        if (!Frame) return;
        const Mark = this.GizmoMark();
        const Points = Mark && this.GizmoPoints(Mark);
        if (!Points)
        {
            if (!Frame.hidden) Frame.hidden = true;
            return;
        }
        const Round = (Value) => Math.round(Value * 10) / 10;
        Frame.querySelector(".gizmo-outline")?.setAttribute(
            "points",
            Points.Corners.map((Point) => `${Round(Point[0])},${Round(Point[1])}`).join(" "),
        );
        const Stem = Frame.querySelector(".gizmo-stem");
        const Top = [(Points.Corners[2][0] + Points.Corners[3][0]) / 2, (Points.Corners[2][1] + Points.Corners[3][1]) / 2];
        Stem?.setAttribute("x1", Round(Top[0]));
        Stem?.setAttribute("y1", Round(Top[1]));
        Stem?.setAttribute("x2", Round(Points.Spindle[0]));
        Stem?.setAttribute("y2", Round(Points.Spindle[1]));
        const Spindle = Frame.querySelector(".gizmo-spindle");
        Spindle?.setAttribute("cx", Round(Points.Spindle[0]));
        Spindle?.setAttribute("cy", Round(Points.Spindle[1]));
        Frame.querySelectorAll(".gizmo-grip").forEach((Grip, Index) =>
        {
            const Point = Points.Corners[Index];
            Grip.setAttribute("x", Round(Point[0] - 4.5));
            Grip.setAttribute("y", Round(Point[1] - 4.5));
        });
        Frame.hidden = false;
    }

    // Which handle a press landed on, if any. The spindle wins ties because it is the one that sits outside the
    // outline, where nothing else is competing for the pointer.
    GizmoGrip(Event)
    {
        const Mark = this.GizmoMark();
        if (!Mark) return null;
        const Points = this.GizmoPoints(Mark);
        if (!Points) return null;
        const Box = this.Canvas.getBoundingClientRect();
        const At = [Event.clientX - Box.left, Event.clientY - Box.top];
        const Reach = (Point) => Math.hypot(At[0] - Point[0], At[1] - Point[1]);
        if (Reach(Points.Spindle) <= GizmoReach) return { Kind: "spin", Mark, Points, At };
        let Taken = null;
        Points.Corners.forEach((Point, Index) =>
        {
            const Distance = Reach(Point);
            if (Distance <= GizmoReach && (!Taken || Distance < Taken.Distance))
                Taken = { Kind: "corner", Index, Distance };
        });
        return Taken ? { ...Taken, Mark, Points, At } : null;
    }

    HoldGizmo(Event, Grip)
    {
        const Mark = Grip.Mark;
        const Centre = Grip.Points.Centre;
        // Which way the frame reads on screen. A decal on the far side of the model projects mirrored, and without
        // this the spindle would turn it the opposite way to the hand.
        const Basis = this.GizmoPoints(Mark);
        const Along = [Basis.Corners[1][0] - Basis.Corners[0][0], Basis.Corners[1][1] - Basis.Corners[0][1]];
        const Across = [Basis.Corners[3][0] - Basis.Corners[0][0], Basis.Corners[3][1] - Basis.Corners[0][1]];
        this.GizmoGrab = {
            Kind: Grip.Kind,
            Mark,
            Centre,
            Size: Mark.Transform.Size,
            Aspect: Mark.Transform.Aspect,
            Rotation: Mark.Transform.Rotation,
            Grabbed: Math.max(Math.hypot(Grip.At[0] - Centre[0], Grip.At[1] - Centre[1]), 4),
            Angle: Math.atan2(Grip.At[1] - Centre[1], Grip.At[0] - Centre[0]),
            Flip: Along[0] * Across[1] - Along[1] * Across[0] < 0,
            Before: structuredClone(this.StackRecord()),
        };
        this.Canvas.setPointerCapture?.(Event.pointerId);
    }

    DragGizmo(Event)
    {
        const Grab = this.GizmoGrab;
        if (!Grab) return;
        const Box = this.Canvas.getBoundingClientRect();
        const At = [Event.clientX - Box.left, Event.clientY - Box.top];
        const Transform = Grab.Mark.Transform;
        if (Grab.Kind === "spin")
        {
            const Angle = Math.atan2(At[1] - Grab.Centre[1], At[0] - Grab.Centre[0]);
            Transform.Rotation = SpinMark(Grab.Rotation, Grab.Angle, Angle, Grab.Flip, Event.shiftKey);
        }
        else
        {
            const Reached = Math.hypot(At[0] - Grab.Centre[0], At[1] - Grab.Centre[1]);
            const Sized = ResizeMark(Grab.Size, Grab.Aspect, Grab.Grabbed, Reached, Event.shiftKey);
            Transform.Size = Sized.Size;
            Transform.Aspect = Sized.Aspect;
        }
        this.Recomposite();
        this.MarkDirty();
    }

    ReleaseGizmo()
    {
        const Grab = this.GizmoGrab;
        if (!Grab) return;
        this.GizmoGrab = null;
        const Transform = Grab.Mark.Transform;
        const Moved =
            Math.abs(Transform.Size - Grab.Size) > 1e-4 ||
            Math.abs(Transform.Aspect - Grab.Aspect) > 1e-4 ||
            Math.abs(Transform.Rotation - Grab.Rotation) > 1e-4;
        if (!Moved) return;
        // One revision for the whole drag, recorded the way CaptureStack would have if it could have held the
        // mutation open across a hundred pointer moves.
        this.Revisions.Record({ Kind: "stack", Before: Grab.Before, After: structuredClone(this.StackRecord()) });
        this.AfterStackChange();
        this.Chronicle(
            "decal",
            Grab.Kind === "spin" ? `Turned ${Grab.Mark.Name}` : `Sized ${Grab.Mark.Name}`,
            Grab.Kind === "spin"
                ? `${Math.round(Transform.Rotation)}°`
                : `${Transform.Size.toFixed(2)} m · ${Transform.Aspect.toFixed(2)}×`,
            Grab.Mark.Tint,
        );
        if (this.InspectorTab === "layer") this.RenderInspector();
    }

    PlaceDecal(Hit)
    {
        const Layer = this.ActiveLayer;
        if (Layer.Kind !== "decal")
        {
            this.Notify("Select a decal layer, or add one from the + menu.");
            return;
        }
        const Decal = Layer.Decal;
        const Frame = StrokeProjection.PlacementFrame(Hit, this.ViewReference());
        // A stamping layer paints the artwork into the texture; so does any layer whose mask is the target.
        if (Decal.Placement === "stamp" || this.Projection.Brush.Target === "mask")
        {
            this.BurnDecal(Layer, Frame);
            return;
        }
        const Waiting = Decal.Marks.find((Entry) => Entry.Placed === false);
        if (Waiting)
        {
            this.CaptureStack(() =>
            {
                Waiting.Transform.Position = Frame.Position;
                Waiting.Transform.Normal = Frame.Normal;
                Waiting.Transform.Tangent = Frame.Tangent;
                Waiting.Mode = "projection";
                Waiting.Channels = structuredClone(Layer.Channels);
                Waiting.Placed = true;
                Decal.Selection = Waiting.Identifier;
            });
            this.MovingMark = Waiting.Identifier;
            this.Chronicle(
                "decal",
                `Placed ${Waiting.Name}`,
                `${Layer.Name} · ${Decal.Marks.length} mark${Decal.Marks.length === 1 ? "" : "s"}`,
                Waiting.Tint,
                Frame.Coordinate && {
                    Shape: "stamp",
                    Coordinate: Frame.Coordinate,
                    Size: this.FootprintInTexture(Waiting.Transform),
                    Rotation: Waiting.Transform.Rotation,
                    Glyph: Decal.SourceKind === "text" ? "text" : "vector",
                },
            );
            this.Recomposite();
            this.RenderStack();
            if (this.InspectorTab === "layer") this.RenderInspector();
            this.Notify(`${Waiting.Name} placed — drag to move it, corners to size it, the knob above to turn it.`);
            return;
        }
        // A click that lands on a decal already on the model takes hold of it instead of dropping another on top.
        const Taken = MarkUnderPoint(Decal.Marks, Frame.Position);
        if (Taken)
        {
            if (Decal.Selection !== Taken.Identifier)
            {
                Decal.Selection = Taken.Identifier;
                this.RenderStack();
                if (this.InspectorTab === "layer") this.RenderInspector();
            }
            this.MovingMark = Taken.Identifier;
            this.Notify(`${Taken.Name} picked up — drag to move it, shift a corner to stretch it, or click clear surface to add another.`);
            return;
        }
        if (Decal.Marks.length >= MarkLimit)
        {
            this.Notify(`A decal layer holds ${MarkLimit} marks. Remove one, or add another layer.`);
            return;
        }
        const Template = this.ActiveMark || Decal;
        const Mark = CreateMark(Decal, {
            Name: `Mark ${Decal.Marks.length + 1}`,
            Folder: this.ActiveMark?.Folder || "",
            Mode: "projection",
            Placed: true,
            Tint: [...Template.Tint],
            Colorise: Template.Colorise !== false,
            Softness: Template.Softness,
            Emboss: Template.Emboss,
            Channels: structuredClone(Layer.Channels),
            Transform: { ...Template.Transform, Position: Frame.Position, Normal: Frame.Normal, Tangent: Frame.Tangent },
        });
        this.CaptureStack(() =>
        {
            Decal.Marks.push(Mark);
            Decal.Selection = Mark.Identifier;
        });
        this.MovingMark = Mark.Identifier;
        this.Chronicle(
            "decal",
            `Placed ${Mark.Name}`,
            `${Layer.Name} · ${Decal.Marks.length} marks`,
            Mark.Tint,
            Frame.Coordinate && {
                Shape: "stamp",
                Coordinate: Frame.Coordinate,
                Size: this.FootprintInTexture(Mark.Transform),
                Rotation: Mark.Transform.Rotation,
                Glyph: Decal.SourceKind === "text" ? "text" : "vector",
            },
        );
        this.Recomposite();
        this.RenderStack();
        if (this.InspectorTab === "layer") this.RenderInspector();
        this.Notify(`${Mark.Name} placed — drag to move it, corners to size it, the knob above to turn it.`);
    }

    // Roughly how much of the sheet a placement covers. The exact figure depends on the unwrap, but a decal of a given
    // world size against the model's radius is close enough for a thumbnail drawn forty pixels wide.
    FootprintInTexture(Transform)
    {
        const Radius = Math.max(this.SurfaceRecord?.Bounds?.Radius || 1, 0.05);
        const Span = this.SurfaceRecord?.Tiles?.Columns || 1;
        const Width = Transform.Size / (Radius * 2.6 * Span);
        return [Width, Width / Math.max(Transform.Aspect, 0.05)];
    }

    // The stamped kind: the artwork is burned into the layer's own image, so it is paint from then on — erasable,
    // paintable over, and carried by the same undo as a stroke. The mask takes it just as happily as the content.
    BurnDecal(Layer, Frame)
    {
        const Decal = Layer.Decal;
        const Template = this.ActiveMark || Decal;
        const Transform = Template.Transform;
        const Target = this.Projection.Brush.Target;
        const Record = {
            Layer: Layer.Identifier,
            Position: Frame.Position,
            Normal: Frame.Normal,
            Tangent: Frame.Tangent,
            Rotation: Transform.Rotation,
            Size: [Transform.Size, Transform.Size / Math.max(Transform.Aspect, 0.05)],
            Depth: Transform.Depth,
            Softness: Template.Softness,
            // A mask holds no colour, so the artwork is flattened to the value of the decal's own tint.
            Colorise: Target === "mask" ? true : Template.Colorise,
        };
        const Options = {
            Target,
            Mode: "decal",
            Decal: Record,
            Colour: Target === "mask" ? this.MaskInk(Template.Tint) : Template.Tint,
            Start: Frame.Position,
            End: Frame.Position,
            Normal: Frame.Normal,
            Radius: Transform.Size,
            Hardness: 1,
            Flow: 1,
            FacingLimit: Math.cos((Transform.AngleLimit * Math.PI) / 180),
            Jitter: 0,
            Erase: this.Tool === "eraser",
        };
        if (Target !== "mask") this.EnsureChannel(Layer, "base_color");
        // The image has to exist before it can be remembered, or the first stamp would have nothing to undo to.
        if (Target === "mask") this.Integrator.EnsureMask(Layer);
        else this.Integrator.EnsureCoverage(Layer);
        this.BeginStrokeRevision(Layer);
        this.Integrator.Stamp(Layer, Options);
        for (const Twin of this.Projection.Twins)
        {
            const Twinned = {
                ...Record,
                Position: Twin(Record.Position),
                Normal: Twin(Record.Normal),
                Tangent: Twin(Record.Tangent),
            };
            if (Twinned.Position) this.Integrator.Stamp(Layer, { ...Options, Decal: Twinned, Normal: Twinned.Normal });
        }
        this.CommitStrokeRevision(false);
        this.Recomposite();
        this.RefreshThumbnails();
        this.MarkDirty();
        this.Chronicle(
            "decal",
            `Stamped ${Layer.Name}`,
            `${Layer.Decal.SourceKind === "text" ? "text" : "artwork"} · ${Target === "mask" ? "mask" : "content"}`,
            Target === "mask" ? null : Template.Tint,
            Frame.Coordinate && {
                Shape: "stamp",
                Coordinate: Frame.Coordinate,
                Size: this.FootprintInTexture(Transform),
                Rotation: Transform.Rotation,
                Glyph: Layer.Decal.SourceKind === "text" ? "text" : "vector",
            },
        );
        this.Notify(`${Layer.Name} stamped into the ${Target === "mask" ? "mask" : "layer"}.`);
    }

    // The dropper. It reads the composited sheet at one texel, so it works the same whether the texel was named by a
    // ray cast at the model or by a click in texture space.
    PickAt(Coordinate)
    {
        const Sample = Coordinate ? this.Integrator.PickTexel(Coordinate) : null;
        if (!Sample) return;
        if (this.PickingMaskColour)
        {
            this.ResolveColourPick(Sample.BaseColour);
            return;
        }
        this.BrushColour = Sample.BaseColour;
        this.SyncBrushControls();
        this.Notify(
            `Picked ${ToHex(Sample.BaseColour).toUpperCase()} · roughness ${Sample.Roughness.toFixed(2)} · metalness ${Sample.Metalness.toFixed(2)}`,
        );
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Decals in texture space. A placement here is named in UV rather than in metres: the artwork lies on the sheet, it
    // crosses no seam because it never leaves the sheet, and it is read back by the compositor as a plane mark.
    //----------------------------------------------------------------------------------------------------------------------
    PlaceDecalPlane(Coordinate)
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal")
        {
            this.Notify("Select a decal layer, or add one from the + menu.");
            return;
        }
        const Decal = Layer.Decal;
        if (Decal.Placement === "stamp" || this.Projection.Brush.Target === "mask")
        {
            this.BurnDecalPlane(Layer, Coordinate);
            return;
        }
        const Waiting = Decal.Marks.find((Entry) => Entry.Placed === false);
        const Under = Waiting ? null : this.PlaneMarkUnder(Decal, Coordinate);
        let Mark = Waiting || Under;
        if (!Mark)
        {
            if (Decal.Marks.length >= MarkLimit)
            {
                this.Notify(`A decal layer holds ${MarkLimit} marks. Remove one, or add another layer.`);
                return;
            }
            const Template = this.ActiveMark || Decal;
            Mark = CreateMark(Decal, {
                Name: `Mark ${Decal.Marks.length + 1}`,
                Folder: this.ActiveMark?.Folder || "",
                Tint: [...Template.Tint],
                Colorise: Template.Colorise !== false,
                Softness: Template.Softness,
                Emboss: Template.Emboss,
                Channels: structuredClone(Layer.Channels),
            });
            this.CaptureStack(() => Decal.Marks.push(Mark));
            this.Chronicle("decal", `Placed ${Mark.Name}`, `${Layer.Name} · texture space`, Mark.Tint, {
                Shape: "stamp",
                Coordinate: [...Coordinate],
                Size: [Mark.Plane.Size, Mark.Plane.Size / Math.max(Mark.Plane.Aspect || 1, 0.05)],
                Rotation: Mark.Plane.Rotation || 0,
                Glyph: Decal.SourceKind === "text" ? "text" : "vector",
            });
        }
        else if (Under) this.Notify(`Moving ${Mark.Name}.`);
        this.CaptureStack(() =>
        {
            Mark.Mode = "plane";
            Mark.Placed = true;
            Mark.Plane = { ...Mark.Plane, Centre: [...Coordinate] };
        });
        Decal.Selection = Mark.Identifier;
        this.MovingMark = Mark.Identifier;
        this.Recomposite();
        this.RenderInspector();
        this.MarkDirty();
    }

    // The topmost placed mark whose rectangle the coordinate falls in, so clicking an existing one picks it up.
    PlaneMarkUnder(Decal, Coordinate)
    {
        for (let Index = Decal.Marks.length - 1; Index >= 0; Index -= 1)
        {
            const Mark = Decal.Marks[Index];
            if (Mark.Mode !== "plane" || Mark.Placed === false || Mark.Visible === false) continue;
            const Half = [Mark.Plane.Size / 2, Mark.Plane.Size / (2 * Math.max(Mark.Plane.Aspect || 1, 0.05))];
            const Angle = (-(Mark.Plane.Rotation || 0) * Math.PI) / 180;
            const Delta = [Coordinate[0] - Mark.Plane.Centre[0], Coordinate[1] - Mark.Plane.Centre[1]];
            const Local = [
                Delta[0] * Math.cos(Angle) - Delta[1] * Math.sin(Angle),
                Delta[0] * Math.sin(Angle) + Delta[1] * Math.cos(Angle),
            ];
            if (Math.abs(Local[0]) <= Half[0] && Math.abs(Local[1]) <= Half[1]) return Mark;
        }
        return null;
    }

    MoveMarkPlane(Coordinate)
    {
        const Mark = this.MarkByIdentifier(this.MovingMark);
        if (!Mark || !Coordinate) return;
        Mark.Plane = { ...Mark.Plane, Centre: [...Coordinate] };
        Mark.Mode = "plane";
        Mark.Placed = true;
        this.Recomposite();
        this.MarkDirty();
    }

    // Burning in texture space: the artwork goes straight into the sheet at the coordinate clicked, at the size the
    // transform asks for measured in UV rather than in metres.
    BurnDecalPlane(Layer, Coordinate)
    {
        const Decal = Layer.Decal;
        const Template = this.ActiveMark || Decal;
        const Target = this.Projection.Brush.Target;
        const Width = Clamp(Template.Plane?.Size ?? this.FootprintInTexture(Template.Transform)[0] ?? 0.3, 0.01, 2);
        const Height = Width / Math.max(Template.Plane?.Aspect ?? Template.Transform.Aspect ?? 1, 0.05);
        const Options = {
            Target,
            Mode: "decal",
            Decal: {
                Layer: Layer.Identifier,
                Plane: { Centre: [...Coordinate], Size: [Width, Height], Rotation: Template.Transform.Rotation || 0 },
                Softness: Template.Softness,
                Colorise: Target === "mask" ? true : Template.Colorise,
            },
            Colour: Target === "mask" ? this.MaskInk(Template.Tint) : Template.Tint,
            Start: [0, 0, 0],
            End: [0, 0, 0],
            Normal: [0, 1, 0],
            Radius: Width,
            Hardness: 1,
            Flow: 1,
            Jitter: 0,
            Erase: this.Tool === "eraser",
            Space: "plane",
        };
        if (Target !== "mask") this.EnsureChannel(Layer, "base_color");
        if (Target === "mask") this.Integrator.EnsureMask(Layer);
        else this.Integrator.EnsureCoverage(Layer);
        this.BeginStrokeRevision(Layer);
        this.Integrator.Stamp(Layer, Options);
        this.CommitStrokeRevision(false);
        this.Recomposite();
        this.RefreshThumbnails();
        this.MarkDirty();
        this.Chronicle("decal", `Stamped ${Layer.Name}`, `texture space · ${Target === "mask" ? "mask" : "content"}`,
            Target === "mask" ? null : Template.Tint, {
                Shape: "stamp",
                Coordinate: [...Coordinate],
                Size: [Width, Height],
                Rotation: Template.Transform.Rotation || 0,
                Glyph: Decal.SourceKind === "text" ? "text" : "vector",
            });
        this.Notify(`${Layer.Name} stamped into the sheet.`);
    }

    // What the viewer calls up and forward. Decal frames are built against it so artwork lands standing up.
    ViewReference()
    {
        return { Up: [...this.Camera.Up], Forward: [...this.Camera.Forward] };
    }

    // Dragging after the click slides the placement across the surface.
    MoveMark(Hit)
    {
        const Mark = this.MarkByIdentifier(this.MovingMark);
        if (!Mark || !Hit) return;
        const Frame = StrokeProjection.PlacementFrame(Hit, this.ViewReference());
        Mark.Transform.Position = Frame.Position;
        Mark.Transform.Normal = Frame.Normal;
        Mark.Transform.Tangent = Frame.Tangent;
        Mark.Mode = "projection";
        Mark.Placed = true;
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
                // Added from the inspector, a mark waits for the click that puts it somewhere rather than piling up
                // invisibly on top of the one it was copied from.
                const Fresh = CreateMark(Decal, {
                    Name: `Mark ${Decal.Marks.length + 1}`,
                    Folder: Template.Folder || "",
                    Placed: false,
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
            // The card shows the artwork the surface is about to show, so it is drawn from the very same image.
            this.DecalImages.set(Layer.Identifier, Surface);
            this.DecalPrints.delete(Layer.Identifier);
            this.PaintDecalPreview(Layer);
            if (Layer === this.ActiveLayer) this.Instruments?.DrawPad();
            this.Recomposite();
        }
        catch (Error)
        {
            this.Notify(`Decal could not be rasterised: ${Error.message}`);
        }
    }

    // 🔴 One rasterise at a time, and only ever the latest. Dragging a knob along the ink ramp asks for a new 1024²
    //    print every few milliseconds; firing them all would queue a second of stale work behind the hand and let an
    //    early one land after a late one. This keeps the most recent ask and drops the rest on the floor.
    async QueueDecal(Layer)
    {
        this.PendingDecal = Layer;
        if (this.PrintingDecal) return;
        this.PrintingDecal = true;
        try
        {
            while (this.PendingDecal)
            {
                const Next = this.PendingDecal;
                this.PendingDecal = null;
                await this.RefreshDecal(Next);
            }
        }
        finally
        {
            this.PrintingDecal = false;
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The decal preview. A piece of artwork is a picture, and a card that describes a picture in words — a library
    // name, a face, a tracking in pixels — is a card that has to be imagined before it can be used.
    //
    // 📝 It draws the rasterised artwork itself, inked exactly as the surface will ink it, over the chequer that
    //    means "nothing here". Not a thumbnail of the library entry: the type you typed, at the tracking you set,
    //    through the gradient you built.
    //----------------------------------------------------------------------------------------------------------------------
    DecalPreview(Layer)
    {
        const Holder = document.createElement("div");
        Holder.className = "decal-preview";
        const Sheet = document.createElement("canvas");
        Sheet.className = "preview-sheet";
        Sheet.width = 560;
        Sheet.height = 280;
        Sheet.dataset.decal = Layer.Identifier;
        Holder.append(Sheet);
        this.PaintDecalPreview(Layer);
        // Nothing is cached on the way in: a pane built before the first rasterise has landed asks for one.
        if (!this.DecalImages.has(Layer.Identifier)) this.RefreshDecal(Layer);
        return Holder;
    }

    PaintDecalPreview(Layer)
    {
        if (!Layer) return;
        const Artwork = this.DecalImages.get(Layer.Identifier);
        if (!Artwork) return;
        for (const Sheet of document.querySelectorAll(`canvas[data-decal="${Layer.Identifier}"]`))
            this.DrawDecalSheet(Sheet, Layer, Artwork);
    }

    // The artwork exactly as the surface will wear it: the rasterised image, with a flat tint laid through it when the
    // ink is one colour. A gradient needs nothing added — it is baked into the image, which is the whole point of it.
    //
    // 📝 Kept against the tint it was made with. The card's preview, the test sheet and the thumbnail all ask for this
    //    on every redraw, and a 1024² pass per ask is a slider that stutters.
    DecalPrint(Layer)
    {
        const Artwork = this.DecalImages.get(Layer?.Identifier);
        if (!Artwork) return null;
        if (!Layer.Decal.Colorise || Layer.Decal.Ramp?.Carry) return Artwork;
        const Code = ToHex(Layer.Decal.Tint);
        const Held = this.DecalPrints.get(Layer.Identifier);
        if (Held && Held.Code === Code) return Held.Image;
        const Inked = document.createElement("canvas");
        Inked.width = Artwork.width;
        Inked.height = Artwork.height;
        const Brush = Inked.getContext("2d");
        if (!Brush || typeof Brush.drawImage !== "function") return Artwork;
        Brush.drawImage(Artwork, 0, 0);
        Brush.globalCompositeOperation = "source-in";
        Brush.fillStyle = Code;
        Brush.fillRect(0, 0, Inked.width, Inked.height);
        this.DecalPrints.set(Layer.Identifier, { Code, Image: Inked });
        return Inked;
    }

    DrawDecalSheet(Sheet, Layer, Artwork)
    {
        const Pen = Sheet.getContext?.("2d");
        if (!Pen || typeof Pen.createPattern !== "function") return;   // jsdom has no raster context to draw into

        // 🔴 The pixel grid is matched to the box it is shown in. A canvas whose backing store disagrees with its
        //    CSS size stretches everything drawn into it, and a preview that lies about the proportions of a piece
        //    of artwork is worse than no preview at all.
        const Ratio = Math.min(window.devicePixelRatio || 1, 2);
        const Box = [Sheet.clientWidth, Sheet.clientHeight];
        if (Box[0] > 0 && Box[1] > 0)
        {
            const Wanted = [Math.round(Box[0] * Ratio), Math.round(Box[1] * Ratio)];
            if (Sheet.width !== Wanted[0]) Sheet.width = Wanted[0];
            if (Sheet.height !== Wanted[1]) Sheet.height = Wanted[1];
        }
        const Width = Sheet.width;
        const Height = Sheet.height;
        Pen.setTransform(1, 0, 0, 1, 0, 0);
        Pen.clearRect(0, 0, Width, Height);

        // The chequer: the editor's own two greys, so "no artwork here" reads as the card rather than as a texture.
        const Square = 14;
        Pen.fillStyle = "#121212";
        Pen.fillRect(0, 0, Width, Height);
        Pen.fillStyle = "#171717";
        for (let Y = 0; Y < Height; Y += Square)
            for (let X = 0; X < Width; X += Square)
                if (((X / Square) | 0) % 2 === ((Y / Square) | 0) % 2) Pen.fillRect(X, Y, Square, Square);

        // The ink the surface will use: the flat tint is laid here rather than in the artwork, because that is where
        // the shader lays it, and a gradient is already in the image, because that is where it is baked.
        const Picture = this.DecalPrint(Layer) || Artwork;

        const Fit = Math.min((Width * 0.86) / Artwork.width, (Height * 0.86) / Artwork.height);
        const Drawn = [Artwork.width * Fit, Artwork.height * Fit];
        Pen.drawImage(Picture, (Width - Drawn[0]) / 2, (Height - Drawn[1]) / 2, Drawn[0], Drawn[1]);

        // The footprint, so the empty space around a wide piece of type is visibly part of the decal.
        Pen.strokeStyle = "rgba(255,255,255,0.14)";
        Pen.lineWidth = 2;
        Pen.strokeRect((Width - Drawn[0]) / 2 + 1, (Height - Drawn[1]) / 2 + 1, Drawn[0] - 2, Drawn[1] - 2);
    }

    InvalidateDecals()
    {
        for (const Layer of this.Layers) if (Layer.Kind === "decal") this.RefreshDecal(Layer);
    }

    // 🔴 Which copy of the editor this is, read out of the address it was served from. A page pinned to a commit —
    //    raw.githack, jsdelivr, raw.githubusercontent all put the revision in the path — looks identical to the one
    //    pinned to the commit before it, and a fix that is already shipped is indistinguishable from a fix that is
    //    not when the only way to tell them apart is to remember which tab is which.
    ShowBuild()
    {
        const Mark = Select("#build-mark");
        if (!Mark) return;
        const Parts = String(globalThis.location?.pathname || "").split("/").filter(Boolean);
        const Revision = Parts.find((Part) => /^[0-9a-f]{7,40}$/i.test(Part));
        Mark.textContent = Revision ? `build ${Revision.slice(0, 7)}` : "build local";
        Mark.title = Revision
            ? `Served from commit ${Revision} · open a newer link if this is not the one you expect`
            : "Served from a working copy rather than a pinned commit";
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Transport: undo, redo, brush controls, symmetry.
    //----------------------------------------------------------------------------------------------------------------------
    BindTransport()
    {
        Select("#undo-button").addEventListener("click", () => this.Undo());
        Select("#redo-button").addEventListener("click", () => this.Redo());
        Select("#brush-colour").addEventListener("input", (Event) => this.SetBrushColour(FromHex(Event.target.value), false));
        Select("#brush-colour").addEventListener("change", (Event) => this.SetBrushColour(FromHex(Event.target.value)));
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
        Select("#brush-pod-button").addEventListener("click", (Event) =>
        {
            Event.stopPropagation();
            this.ShowPopover("brush", Select("#brush-pod").hidden);
        });
        Select("#environment-button")?.addEventListener("click", (Event) =>
        {
            Event.stopPropagation();
            this.ShowPopover("environment", Select("#environment-pod").hidden);
        });
        Select("#scene-button")?.addEventListener("click", (Event) =>
        {
            Event.stopPropagation();
            this.ShowPopover("scene", Select("#scene-pod").hidden);
        });
        // The rows inside both pods are the inspector's rows, so they answer to the inspector's own two listeners.
        for (const Name of ["#environment-pod", "#scene-pod"])
        {
            const Pod = Select(Name);
            if (!Pod) continue;
            Pod.addEventListener("input", (Event) => this.OnInspectorInput(Event));
            Pod.addEventListener("change", (Event) => this.OnInspectorInput(Event, true));
            Pod.addEventListener("click", (Event) =>
            {
                const Button = Event.target.closest("[data-action]");
                if (!Button) return;
                this.OnInspectorAction(Button.dataset.action, Button.dataset.argument);
            });
        }
        Select("#brush-pod").addEventListener("click", (Event) =>
        {
            const Button = Event.target.closest("[data-symmetry]");
            if (!Button) return;
            this.SetSymmetry(Button.dataset.symmetry, true);
            this.RenderSymmetryChips();
        });
        document.addEventListener("click", (Event) =>
        {
            const Inside =
                Event.target.closest("#brush-pod, #brush-pod-button, #environment-pod, #environment-button, #scene-pod, #scene-button");
            if (!Inside) this.ShowPopover("", false);
        });
        Select("#swatch-rail").addEventListener("click", (Event) =>
        {
            const Swatch = Event.target.closest("[data-swatch]");
            if (Swatch) this.SetBrushColour(FromHex(Swatch.dataset.swatch));
        });
        this.RenderSymmetryChips();
        this.RenderSwatchRail();
        SelectAll("[data-brush]").forEach((Control) =>
            Control.addEventListener("input", (Event) =>
            {
                const Key = Control.dataset.brush;
                const Value = Number(Event.target.value);
                this.Projection.Configure({ [Key]: Value });
                const Display = Select(`[data-brush-readout="${Key}"]`);
                if (Display) Display.textContent = BrushReadout(Key, Value);
                this.SyncPodSummary();
                Event.target.style.setProperty(
                    "--fraction",
                    String((Value - Number(Event.target.min)) / (Number(Event.target.max) - Number(Event.target.min))),
                );
            }),
        );
        this.SyncBrushControls();
        this.SyncStrokeChip();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The instrument card.
    //
    // 🔴 The card is handed callbacks and never the editor. It can set the brush and the colour, and it can ask whether
    //    a mask is the paint target — nothing else. A card that could read the stack would be a second path into it, and
    //    the first thing a second path does is forget to bump a revision.
    //----------------------------------------------------------------------------------------------------------------------
    BindInstruments()
    {
        // The paint the editor opens with: a sable pointed round, the library's first tile.
        this.TakeInstrument("brush-round", { Quiet: true });

        this.Instruments = new InstrumentPanel(document.body, {
            Sections: () => this.CardSections(),
            Media: () => this.Projection.Brush.Media || PlainMedia,
            // The ribbon paints with the colour the next stroke would use, flattened to its value when a mask is
            // the target — a mask holds no hue, and a preview that showed one would be lying about what lands.
            Ink: () => (this.Projection.Brush.Target === "mask" ? this.MaskInk() : this.BrushColour),
            Width: () => this.Projection.Brush.Radius * 100,
            Hardness: () => this.Projection.Brush.Hardness,
            Strength: () => this.Projection.Brush.Flow,
            Masking: () => this.Projection.Brush.Target === "mask",
            Note: (Text) => this.Notify(Text),
            // Whose properties the rail is listing: the layer in hand, and which side of it is being painted.
            Heading: () =>
            {
                const Layer = this.ActiveLayer;
                if (!Layer) return { Title: "Paint", Note: "Nothing selected", Glyph: Icon("palette") };
                const Kind = LayerKindByIdentifier[Layer.Kind];
                if (this.Projection.Brush.Target === "mask")
                    return { Title: "Mask", Note: Layer.Name, Glyph: Icon("mask"), Tone: "#b8b8b8" };
                if (Layer.Kind === "folder") return { Title: "Folder", Note: Layer.Name, Glyph: Icon("folder"), Tone: Kind?.Accent };
                return {
                    Title: Layer.Kind === "decal" ? "Decal" : "Paint",
                    Note: Layer.Name,
                    Glyph: Icon(Layer.Kind === "decal" ? Kind?.Glyph || "fill" : "palette"),
                    Tone: Kind?.Accent,
                };
            },
            // Null when the stroke goes down in one colour; otherwise the ramp, asked the same way the paint asks it.
            Tint: () =>
                this.Gradient.Carry && this.Projection.Brush.Target !== "mask"
                    ? (Along, Straight) => this.PadTint(Along, Straight)
                    : null,
            // 🔴 And what the test sheet prints on a decal layer: the artwork, inked. The brush is not offered for a
            //    layer that is printed rather than painted, so a sheet of brush strokes there previewed a mark the
            //    hand could not make. Null on every other layer, and the sheet goes back to being paper for paint.
            Artwork: () =>
            {
                const Layer = this.ActiveLayer;
                if (!Layer || Layer.Kind !== "decal" || this.Projection.Brush.Target === "mask") return null;
                const Image = this.DecalPrint(Layer);
                if (!Image) return null;
                const Ink = Layer.Decal.Ramp?.Carry ? "ramp" : Layer.Decal.Colorise ? ToHex(Layer.Decal.Tint) : "own";
                return { Image, Key: `${Layer.Identifier}·${Layer.Decal.SourceKind}·${Ink}` };
            },
        });
        Select("#instrument-button")?.addEventListener("click", (Event) =>
        {
            Event.stopPropagation();
            this.Instruments.Toggle();
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The card's own panes.
    //
    // 🔴 These are CONTEXTUAL: the rail below the instrument families carries whatever the layer in hand can actually
    //    use. A decal layer has no pressure curve worth editing and a paint layer has no font, so neither of them is
    //    offered one. The six instrument families never change — they are what is in the hand, not what it is on.
    //----------------------------------------------------------------------------------------------------------------------
    CardSections()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return [];
        const Masking = this.Projection.Brush.Target === "mask";
        // A folder holds layers rather than paint; painting on one opens a layer inside it, and that layer is what the
        // panes would be about, so there is nothing to show until it exists.
        if (Layer.Kind === "folder" && !Masking) return [];
        const Decal = Layer.Kind === "decal" && !Masking;
        const Media = this.Projection.Brush.Media || PlainMedia;
        const Ramped = !Masking && this.Gradient.Carry;

        // 🔴 Grouped, and the groups are the point. Painting one thing in 3D means saying what the pigment is, what
        //    the surface under it is made of, what the head is like and how the hand moves — a metallic marker with a
        //    silver-to-gold fade is all four at once. Eight flat rows made the hand hunt for them; three headings and
        //    six rows put the related ones within one glance of each other.
        // 🔴 A decal gets ONE colour row, and it is its ink. The pigment in the brush's hand does not touch a piece
        //    of artwork — the artwork is printed, not painted — so a card that offered both a Colour pane and an Ink
        //    pane was offering the same question twice and answering it in two different places. The ink row carries
        //    the whole picker now: mix, recents, gradient, relief.
        const Paint = [];
        if (!Decal)
            Paint.push({
                Key: "colour",
                Group: "Paint",
                Label: Masking ? "Value" : Ramped ? "Colour dynamics" : "Colour",
                Glyph: Icon(Masking ? "mask" : Ramped ? "ramp" : "palette"),
                Tone: Masking ? "#9a9a9a" : ToHex(this.BrushColour),
                Tally: Ramped ? `${SortRampStops(this.Gradient.Stops).length}` : this.DynamicsReach() ? "wander" : undefined,
                Title: Masking ? "Mask value" : "Colour",
                Note: Masking ? "Black hides · white reveals" : "The pigment, the gradient it runs through, and how far it may wander",
                Ribbon: false,
                Render: () => this.ColourPane(Layer, Masking),
            });
        if (Decal)
            Paint.push({
                Key: "ink",
                Group: "Paint",
                Label: Layer.Decal.Ramp?.Carry ? "Ink gradient" : "Ink",
                Glyph: Icon(Layer.Decal.Ramp?.Carry ? "ramp" : "fill"),
                Tone: Layer.Decal.Ramp?.Carry
                    ? ToHex(RampColourAt(Layer.Decal.Ramp.Stops, 0.5))
                    : Layer.Decal.Colorise
                      ? ToHex(Layer.Decal.Tint)
                      : "#8f6fd0",
                Tally: Layer.Decal.Ramp?.Carry
                    ? `${SortRampStops(Layer.Decal.Ramp.Stops).length}`
                    : Layer.Decal.Colorise
                      ? "flat"
                      : "as drawn",
                Title: "Ink",
                Note: "The colour the artwork is printed in, mixed here",
                Ribbon: false,
                Render: () => this.InkPane(Layer),
            });
        Paint.push({
            Key: "material",
            Group: "Paint",
            Label: "Material",
            Glyph: Icon("material"),
            Tone: "#d08a4a",
            Tally: Masking ? "mask" : MaterialSummary(Layer, this.ChannelWrites),
            Title: "Material",
            Note: Masking ? "A mask writes coverage only" : "The surface the paint lays down, and which of it the stroke writes",
            Ribbon: false,
            Render: () => this.MaterialPane(Layer, Masking),
        });

        // The library sits in the rail's own footer: it is not a property of the paint, it is where the paint comes
        // from, and a row of it in among the properties would read as one more setting to tune.
        const Held = this.Holding;
        const Shelf = {
            Key: "library",
            Foot: true,
            Label: Held ? Held.Label : "Instruments",
            Glyph: Icon(FamilyGlyph(Held)),
            Tone: Held?.Tone || "#8a8a8a",
            Tally: this.Instrument?.Altered ? "·" : undefined,
            Title: "Instruments",
            Note: Held ? `${Held.Name}${this.Instrument?.Altered ? " · altered" : ""}` : "Pick something to paint with",
            Ribbon: false,
            Render: () => this.LibraryPane(),
        };

        if (Decal)
            return [
                {
                    Key: "artwork",
                    Group: "Artwork",
                    Label: Layer.Decal.SourceKind === "text" ? "Type" : "Artwork",
                    Glyph: Icon(Layer.Decal.SourceKind === "text" ? "text" : "decal"),
                    Tone: "#c9a227",
                    Title: Layer.Decal.SourceKind === "text" ? "Type" : "Artwork",
                    Note: `${Layer.Name} · ${Layer.Decal.Placement === "stamp" ? "burned in" : "placed"}`,
                    Ribbon: false,
                    Render: () => this.ArtworkPane(Layer),
                },
                {
                    Key: "placement",
                    Group: "Artwork",
                    Label: "Placement",
                    Glyph: Icon("focus"),
                    Tone: "#4a9bd8",
                    Tally: Layer.Decal.Placement === "stamp" ? "burn" : `${Layer.Decal.Marks.length}`,
                    Title: "Placement",
                    Note: "How big it lands and which way up",
                    Ribbon: false,
                    Render: () => this.PlacementPane(Layer),
                },
                ...Paint,
                Shelf,
            ];

        // 🔴 Head and Hand before Paint. The order is the order the question is asked in: what is making the mark,
        //    how it is being moved, and only then what it is leaving behind. Colour led the rail while it was the
        //    newest thing on it, which put the two rows a hand touches least at the top of every card.
        return [
            {
                Key: "shape",
                Group: "Head",
                Label: "Shape",
                Glyph: Icon("brush"),
                Tone: "#34c759",
                Tally: `${(this.Projection.Brush.Radius * 100).toFixed(1)}`,
                Title: "Shape",
                Note: "The head, its hairs, and the mark one dab of it leaves",
                Render: () => this.ShapePane(),
            },
            {
                Key: "grain",
                Group: "Head",
                Label: "Grain",
                Glyph: Icon("noise"),
                Tone: "#c9a227",
                Tally: MediumByIndex[Media.Index]?.Label,
                Title: "Grain",
                Note: "The medium, the paper under it, and the strength of the stuff itself",
                Render: () => this.GrainPane(),
            },
            {
                Key: "stroke",
                Group: "Hand",
                Label: "Stroke",
                Glyph: Icon("vector"),
                Tone: "#4a9bd8",
                Tally: StrokeModes.find((Mode) => Mode.Identifier === this.StrokeMode)?.Label,
                Title: "Stroke",
                Note: "How the mark goes down, and how far it lags the hand",
                Render: () => this.StrokePane(),
            },
            {
                Key: "taper",
                Group: "Hand",
                Label: "Taper",
                Glyph: Icon("taper"),
                Tone: "#8f6fd0",
                Tally: Media.Pressure ? `${Math.round(Media.Taper * 100)}%` : "off",
                Title: "Taper",
                Note: "How a mark starts, and what the hand's pressure is worth",
                Render: () => this.TaperPane(),
            },
            ...Paint,
            Shelf,
        ];
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · the library. Every instrument the editor knows, drawn as itself.
    //
    // 🔴 The drawings are the library. A list of names cannot tell a chisel marker from a bullet one, and the whole
    //    reason an instrument is a thing rather than a row of numbers is that a hand recognises it on sight.
    //----------------------------------------------------------------------------------------------------------------------
    LibraryPane()
    {
        const Sheet = document.createElement("div");
        const Standing = this.Instrument?.Key;

        for (const Family of InstrumentFamilies)
        {
            const Group = this.CardGroup(Family.Label, FamilyNote(Family));
            const Shelf = document.createElement("div");
            Shelf.className = "shelf-row";
            Shelf.innerHTML = Family.Types.map(
                (Type) => `
                <button class="shelf-tile ${Type.Key === Standing ? "on" : ""}" data-instrument="${Escape(Type.Key)}" title="${Escape(Type.Name)}">
                    <span class="shelf-art">${InstrumentArtwork(Type, Family.Crop)}</span>
                    <span class="shelf-name">${Escape(Type.Label)}</span>
                </button>`,
            ).join("");
            for (const Tile of Shelf.querySelectorAll("[data-instrument]"))
                Tile.addEventListener("click", () => this.TakeInstrument(Tile.dataset.instrument));
            Group.append(Shelf);
            Sheet.append(Group);
        }

        const Note = document.createElement("p");
        Note.className = "card-note";
        const Held = this.Holding;
        Note.textContent = Held
            ? `${Held.Name}. Taking one out of the library sets the head, the medium it lays, the material that lands on the surface and the channels the stroke is allowed to write — four things that are one thing in the world. Move a slider afterwards and it stays yours; the row simply stops claiming to be exactly what the tin said.`
            : "Pick something to paint with.";
        Sheet.append(Note);
        return Sheet;
    }

    // The instrument's own controls — the ones that belong to the kind of thing it is rather than to every mark.
    // Turning one re-derives the medium from the instrument, so the choice holds instead of drifting into a custom.
    InstrumentControls()
    {
        const Type = this.Holding;
        if (!Type) return [];
        const Settings = this.Instrument.Settings;
        const Rows = [];
        for (const Control of VisibleControls(Type, Settings))
        {
            if (PlainControls.includes(Control.Key)) continue;
            if (Control.Kind === "Segmented")
                Rows.push(
                    this.CardSegmented(
                        Control.Options.map((Option) => ({ Identifier: Option, Label: Option })),
                        Settings[Control.Key] ?? Control.Options[0],
                        (Identifier) => this.TuneInstrument(Control.Key, Identifier),
                    ),
                );
            else if (Control.Kind === "Switch")
                Rows.push(
                    this.CardSwitch(Control.Label, "", Settings[Control.Key] === true, (On) => this.TuneInstrument(Control.Key, On)),
                );
            else
                Rows.push(
                    this.CardSlider(
                        {
                            Label: Control.Label,
                            Value: Number(Settings[Control.Key] ?? 0),
                            Minimum: Control.Minimum,
                            Maximum: Control.Maximum,
                            Step: Control.Step,
                            Unit: Control.Unit,
                        },
                        (Value) => this.TuneInstrument(Control.Key, Value),
                    ),
                );
        }
        return Rows;
    }


    // Whether any of the three dynamics is asking for anything at all.
    DynamicsReach()
    {
        return this.Dynamics.Hue > 0 || this.Dynamics.Saturation > 0 || this.Dynamics.Value > 0;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Editing the medium in hand. The brush carries one media profile — the physical description the stamping pass
    // unpacks into uniforms — and every one of the card's paint panes writes straight into it. There is no instrument
    // in between any more: the numbers on the card ARE the numbers the pass runs on.
    //----------------------------------------------------------------------------------------------------------------------
    //----------------------------------------------------------------------------------------------------------------------
    // The instrument in hand.
    //
    // 🔴 An instrument is not a preset of the sliders — it is what the sliders are ABOUT. Taking one out of the
    //    library sets the brush, the medium, the material it lays and the channels it is allowed to write, because
    //    those four are one object in the world: a metallic marker is metal, 26% rough, 2.8 cm wide and felt-tipped,
    //    and a library that set only the width would be a library of names.
    //
    // 📝 The settings are kept beside the key so the instrument's own controls — nib, grade, head, wetness — can be
    //    turned without rebuilding the choice. Moving a raw slider instead (size, roundness, tooth) edits the medium
    //    directly and the instrument is marked as altered rather than silently claiming to still be itself.
    //----------------------------------------------------------------------------------------------------------------------
    TakeInstrument(Key, Options = {})
    {
        const Type = InstrumentByKey[Key];
        if (!Type) return;
        this.Instrument = { Key, Settings: { ...Type.Settings }, Altered: false };
        this.Projection.Configure(BrushFromInstrument(Type, this.Instrument.Settings));

        // An eraser takes paint away, so taking one out of the library puts the eraser in hand; taking anything
        // else out hands the brush back, because nobody reaches for a pencil meaning to rub something out.
        const Erases = InstrumentFamilies.find((Family) => Family.Key === Type.Family)?.Erases === true;
        if (!Options.Quiet && (Erases ? this.Tool !== "eraser" : this.Tool === "eraser")) this.SetTool(Erases ? "eraser" : "brush");

        // What it paints: the material goes onto the layer, and the stroke is allowed to write exactly that much.
        // 📝 Not at boot: the editor opens with every channel writable, which is what an untouched project has always
        //    done, and an instrument narrowing that before the painter has chosen anything would be a setting nobody
        //    set. The narrowing is an act, and the act is reaching into the library.
        const Paint = Options.Quiet ? null : Type.Paint;
        const Layer = this.ActiveLayer;
        if (Paint && Layer && this.Projection.Brush.Target !== "mask")
        {
            for (const [Channel, Value] of Object.entries(Paint.Channels)) Layer.Channels[Channel] = Value;
            // 🔴 Set, not added. What the instrument lays is what the layer writes — both faces of the switch at
            //    once — or a marker taken after an hour of chrome would quietly keep writing the coat nobody asked
            //    it for, and the card would show eleven channels for a paint that has three.
            for (const Name of WriteKeys) this.SetChannelWrite(Name, Name === "base_color" || Paint.Exposes.includes(Name));
            this.Recomposite();
            this.MarkDirty();
            this.RenderInspector();
        }

        if (Options.Quiet) return;
        this.Instruments?.Refresh();
        this.Instruments?.ScheduleRibbon();
        this.Notify(`${Type.Name} · ${MediaSummary(this.Projection.Brush.Media)}`);
    }

    // One of the instrument's own controls moved: re-derive everything from the settings, so the choice holds.
    TuneInstrument(Key, Value)
    {
        const Type = InstrumentByKey[this.Instrument?.Key];
        if (!Type) return;
        this.Instrument.Settings = { ...this.Instrument.Settings, [Key]: Value };
        this.Projection.Configure(BrushFromInstrument(Type, this.Instrument.Settings));
        this.Instruments?.Refresh();
        this.Instruments?.ScheduleRibbon();
        this.SyncBrushControls();
    }

    // The type in hand, or null once the sliders have been moved far enough that naming it would be a lie.
    get Holding()
    {
        return InstrumentByKey[this.Instrument?.Key] || null;
    }

    SetMedia(Changes)
    {
        const Media = { ...(this.Projection.Brush.Media || PlainMedia), ...Changes };
        if (this.Instrument) this.Instrument.Altered = true;
        this.Projection.Configure({ Media });
        this.Instruments?.ScheduleRibbon();
        this.SyncBrushControls();
        return Media;
    }

    SetBrush(Changes)
    {
        this.Projection.Configure(Changes);
        this.Instruments?.ScheduleRibbon();
        this.SyncBrushControls();
    }

    MediaSlider(Label, Key, Options = {})
    {
        const Media = this.Projection.Brush.Media || PlainMedia;
        const Scale = Options.Scale || 1;
        return this.CardSlider(
            {
                Label,
                Value: Number(((Media[Key] ?? 0) * Scale).toFixed(Options.Step && Options.Step < 1 ? 2 : 0)),
                Minimum: Options.Minimum ?? 0,
                Maximum: Options.Maximum ?? 100,
                Step: Options.Step ?? 1,
                Unit: Options.Unit ?? "%",
                Hint: Options.Hint || "",
            },
            (Value) => this.SetMedia({ [Key]: Value / Scale }),
        );
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · colour.
    //
    // 🔴 A real picker, not a row of chips. The chips were the whole of the card's colour story and they could not say
    //    "that red, but a shade down" — the one thing a painter asks for most. A mask gets the value ramp instead: a
    //    mask stores coverage, not colour, so a hue picker there offers a choice that cannot be expressed.
    //----------------------------------------------------------------------------------------------------------------------
    ColourPane(Layer, Masking)
    {
        const Sheet = document.createElement("div");
        Sheet.append(Masking ? this.ValueField() : this.ColourField());

        if (!Masking)
        {
            const Recent = this.CardGroup("Recent", "The last colours mixed here");
            const Row = document.createElement("div");
            Row.className = "swatch-row";
            Row.innerHTML = this.RecentColours.map(
                (Code) => `<button class="tool-swatch" style="background:${Code}" data-recent="${Code}" title="${Code.toUpperCase()}"></button>`,
            ).join("");
            for (const Chip of Row.querySelectorAll("[data-recent]"))
                Chip.addEventListener("click", () =>
                {
                    this.SetBrushColour(FromHex(Chip.dataset.recent));
                    this.Instruments.RenderPane(false);
                });
            Recent.append(Row);
            Sheet.append(Recent);
        }

        const Wash = this.StrokeMode === "gradient";
        if (!Masking)
        {
            // 🔴 One switch, and it lives here. There were two — a "carry" in Stroke and a "fade through the colours"
            //    in the wash — and they armed the same ramp for the same reason, so the hand had to know which of the
            //    two the tool in its hand listened to. A gradient is a colour, the ramp is the colour it is, and how
            //    far it runs is the only question the stroke gets to answer.
            const Fade = this.CardGroup(
                "Gradient",
                this.Gradient.Carry
                    ? Wash
                      ? "The colours the wash lays across the sheet"
                      : "The colours the stroke runs through"
                    : "The mark goes down in the colour in hand",
            );
            Fade.append(
                this.CardSwitch(
                    "Run through a gradient",
                    Wash ? "The wash lays the ramp down the drag" : "Every dab takes its colour from the ramp",
                    this.Gradient.Carry,
                    (On) =>
                    {
                        this.Gradient.Carry = On;
                        this.Instruments.RenderRail();
                        this.Instruments.RenderPane(false);
                        this.Notify(On ? "Strokes run through the gradient." : "Strokes go down in the colour in hand.");
                    },
                ),
            );
            if (this.Gradient.Carry)
            {
                Fade.append(this.RampField());
                if (!Wash)
                {
                    Fade.append(
                        this.CardSegmented(RampFits, this.Gradient.Fit, (Identifier) =>
                        {
                            this.Gradient.Fit = Identifier;
                            this.Instruments.RenderPane(false);
                        }),
                    );
                    if (this.Gradient.Fit === "along")
                        Fade.append(
                            this.CardSlider(
                                {
                                    Label: "Length",
                                    Value: Number((this.Gradient.Span * 100).toFixed(1)),
                                    Minimum: 1,
                                    Maximum: 400,
                                    Step: 0.5,
                                    Unit: "cm",
                                    Hint: "How far the hand travels before the ramp runs out · G and ⇧G",
                                },
                                (Value) =>
                                {
                                    this.Gradient.Span = Value / 100;
                                    this.Instruments.DrawPad();
                                },
                            ),
                        );
                    else
                        Fade.append(
                            this.CardSlider(
                                {
                                    Label: "Fit",
                                    Value: this.Gradient.Scale,
                                    Minimum: 0.05,
                                    Maximum: 4,
                                    Step: 0.01,
                                    Unit: "×",
                                    Hint: "How much of the two ends the ramp covers · G and ⇧G",
                                },
                                (Value) =>
                                {
                                    this.Gradient.Scale = Value;
                                    this.Instruments.DrawPad();
                                },
                            ),
                        );
                }
                Fade.append(
                    this.CardSwitch("Repeat", "Begin again instead of holding the last colour", this.Gradient.Cycle, (On) =>
                    {
                        this.Gradient.Cycle = On;
                        this.Instruments.RenderPane(false);
                    }),
                    this.CardSwitch("Reverse", "Run the colours the other way", this.Gradient.Reverse, (On) =>
                    {
                        this.Gradient.Reverse = On;
                        this.Instruments.RenderPane(false);
                    }),
                    this.CardSegmented(GradientEasings, this.Gradient.Easing, (Identifier) =>
                    {
                        this.Gradient.Easing = Identifier;
                        this.Instruments.RenderPane(false);
                    }),
                );
            }
            Sheet.append(Fade);
        }

        // Dynamics sit under the colour they wander from, where the eye can see both at once.
        const Wander = this.CardGroup("Dynamics", "A fresh roll of the dice for every dab laid");
        if (!Masking)
            Wander.append(
                this.CardSlider(
                    { Label: "Hue", Value: Math.round(this.Dynamics.Hue * 100), Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Hint: "Up to a sixth of the wheel, either way" },
                    (Value) =>
                    {
                        this.Dynamics.Hue = Value / 100;
                        this.Instruments.RenderRail();
                        this.Instruments.DrawPad();
                    },
                ),
                this.CardSlider(
                    { Label: "Saturation", Value: Math.round(this.Dynamics.Saturation * 100), Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
                    (Value) =>
                    {
                        this.Dynamics.Saturation = Value / 100;
                        this.Instruments.RenderRail();
                        this.Instruments.DrawPad();
                    },
                ),
            );
        Wander.append(
            this.CardSlider(
                { Label: "Brightness", Value: Math.round(this.Dynamics.Value * 100), Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
                (Value) =>
                {
                    this.Dynamics.Value = Value / 100;
                    this.Instruments.RenderRail();
                    this.Instruments.DrawPad();
                },
            ),
        );
        Sheet.append(Wander);

        const Note = document.createElement("p");
        Note.className = "card-note";
        Note.textContent = Masking
            ? "A mask keeps one number per texel. Paint with white to reveal the layer, black to hide it, and anything between for a partial hold. A mask holds no hue, so only brightness has anything to wander in."
            : this.Gradient.Carry
              ? "The square mixes the colour in hand. The strip below it is the gradient: click it to add a colour, drag one along to move it, double-click one to take it away. Try it on the test sheet before you commit it to the model."
              : "The square mixes saturation against brightness; the bar beside it is the hue. The field below takes a hex code typed straight in.";
        Sheet.append(Note);
        return Sheet;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The gradient's colours: a strip of the ramp itself with a knob at every stop.
    //
    // 📝 The strip redraws itself in place rather than asking the card to rebuild the pane. A rebuilt pane is a new
    //    element, and a new element halfway through a drag is a drag that ends where the finger still is.
    //
    // 🔴 The pointer is captured by the STRIP, never by a knob. Dragging one stop past another reorders the list, so
    //    the knob under the finger is replaced mid-drag — and a capture held by an element that no longer exists is a
    //    stop that follows the hand for a pixel and then stops dead.
    //----------------------------------------------------------------------------------------------------------------------
    RampField(Ramp = null)
    {
        // The stroke's gradient is the default because it was the only one for a while; a decal hands in its own.
        const Store = Ramp || {
            Read: () => this.Gradient.Stops,
            Write: (Stops) => (this.Gradient.Stops = Stops),
            Cursor: "RampStop",
            Arm: () =>
            {
                this.Gradient.Carry = true;
                this.Instruments?.RenderRail();
                this.Instruments?.DrawPad();
            },
        };
        const Holder = document.createElement("div");
        Holder.className = "ramp-well";
        Holder.innerHTML = `
            <div class="ramp-strip" data-strip title="Click to add a colour"></div>
            <div class="property-row colour-row ramp-chosen">
                <span class="property-label" data-stop-note></span>
                <label class="colour-field"><input type="color" data-stop-colour aria-label="The colour at this stop" />
                    <span class="colour-code" data-stop-code></span></label>
            </div>
            <div class="ramp-actions">
                <button class="chip-button" data-ramp-take>Take the colour in hand</button>
                <button class="chip-button" data-ramp-drop>Remove</button>
            </div>`;

        const Strip = Holder.querySelector("[data-strip]");
        const NoteCell = Holder.querySelector("[data-stop-note]");
        const Field = Holder.querySelector("[data-stop-colour]");
        const Code = Holder.querySelector("[data-stop-code]");
        const Drop = Holder.querySelector("[data-ramp-drop]");

        const Stops = () => Store.Read();
        // 🔴 Announced, not just recorded. A picker sitting above the strip mixes whichever stop is chosen, so the
        //    moment the hand points at a different knob the square has to move to that colour — otherwise it edits
        //    the stop the eye is on using the numbers of the stop it left.
        const Chose = (Index) =>
        {
            const Moved = this[Store.Cursor] !== Index;
            this[Store.Cursor] = Index;
            if (Moved) Store.Chose?.(Index);
        };
        const Chosen = () => this[Store.Cursor] || 0;
        const Place = (ClientX) =>
        {
            const Box = Strip.getBoundingClientRect();
            return Clamp((ClientX - Box.left) / (Box.width || 1), 0, 1);
        };

        const Draw = () =>
        {
            const Ramp_ = Stops();
            Chose(Math.max(0, Math.min(Chosen(), Ramp_.length - 1)));
            const Stop = Ramp_[Chosen()];
            Strip.style.background = RampCss(Ramp_);
            Strip.innerHTML = Ramp_.map(
                (Entry, Index) => `<span class="ramp-knob${Index === Chosen() ? " active" : ""}" data-stop="${Index}"
                        style="left:${(Entry.Position * 100).toFixed(2)}%;--knob:${ToHex(Entry.Colour)}"
                        title="${ToHex(Entry.Colour).toUpperCase()} at ${Math.round(Entry.Position * 100)}%"></span>`,
            ).join("");
            NoteCell.textContent = `Stop ${Chosen() + 1} of ${Ramp_.length} · ${Math.round(Stop.Position * 100)}%`;
            Field.value = ToHex(Stop.Colour);
            Code.textContent = ToHex(Stop.Colour).toUpperCase();
            Drop.disabled = Ramp_.length <= 2;
        };

        // Any edit to the ramp arms it: a colour nobody can see is a control that looks broken.
        const Arm = () => Store.Arm();

        let Holding = false;
        Strip.addEventListener("pointerdown", (Event) =>
        {
            const Knob = Event.target.closest?.("[data-stop]");
            if (Knob) Chose(Number(Knob.dataset.stop));
            else
            {
                const Added = PlaceRampStop(Stops(), Place(Event.clientX));
                if (Added.Index < 0)
                {
                    this.Notify(`A gradient holds ${RampLimit} colours at most.`);
                    return;
                }
                Store.Write(Added.Stops);
                Chose(Added.Index);
                Arm();
            }
            Holding = true;
            Strip.setPointerCapture?.(Event.pointerId);
            Draw();
        });
        Strip.addEventListener("pointermove", (Event) =>
        {
            if (!Holding) return;
            const Moved = MoveRampStop(Stops(), Chosen(), Place(Event.clientX));
            Store.Write(Moved.Stops);
            Chose(Moved.Index);
            Arm();
            Draw();
        });
        const Release = (Event) =>
        {
            if (!Holding) return;
            Holding = false;
            if (Strip.hasPointerCapture?.(Event.pointerId)) Strip.releasePointerCapture(Event.pointerId);
        };
        Strip.addEventListener("pointerup", Release);
        Strip.addEventListener("pointercancel", Release);
        Strip.addEventListener("dblclick", (Event) =>
        {
            const Knob = Event.target.closest?.("[data-stop]");
            if (!Knob) return;
            const Left = RemoveRampStop(Stops(), Number(Knob.dataset.stop));
            Store.Write(Left.Stops);
            Chose(Left.Index);
            Arm();
            Draw();
        });

        Field.addEventListener("input", (Event) =>
        {
            Store.Write(Stops().map((Stop, Index) => (Index === Chosen() ? { ...Stop, Colour: FromHex(Event.target.value) } : Stop)));
            Arm();
            Draw();
        });
        Holder.querySelector("[data-ramp-take]").addEventListener("click", () =>
        {
            Store.Write(Stops().map((Stop, Index) => (Index === Chosen() ? { ...Stop, Colour: [...this.BrushColour] } : Stop)));
            Arm();
            Draw();
        });
        Drop.addEventListener("click", () =>
        {
            const Left = RemoveRampStop(Stops(), Chosen());
            Store.Write(Left.Stops);
            Chose(Left.Index);
            Arm();
            Draw();
        });

        Draw();
        // 🔴 Handed out, not kept private. A picker sitting above the strip edits the colour the strip is showing,
        //    and the strip has to follow it — but rebuilding the pane to do that would destroy the picker's node
        //    halfway through the drag that is editing it. One function, called in place, keeps both alive.
        Holder.Refresh = Draw;
        return Holder;
    }

    // Saturation across, value down, with a hue bar beside it and a hex field under both.
    //
    // 📝 `Store` is what the square mixes: a colour to read, somewhere to put it back, and the key the sticky hue
    //    is remembered under. With none it mixes the brush, which is what it did when the brush was all there was.
    ColourField(Store = null)
    {
        const Mix = Store || {
            Read: () => this.BrushColour,
            Write: (Colour, Settled) => this.SetBrushColour(Colour, Settled),
            Hue: "PickerHue",
        };
        const Group = this.CardGroup(Mix.Title || "Mix", Mix.Note || "Saturation across · brightness down");
        const Field = document.createElement("div");
        Field.className = "mix-field";
        Field.innerHTML = `
            <div class="mix-square" data-square>
                <div class="square-hue" data-square-hue></div>
                <div class="square-white"></div>
                <div class="square-black"></div>
                <div class="square-knob" data-square-knob></div>
            </div>
            <div class="mix-hue" data-hue><div class="hue-knob" data-hue-knob></div></div>
            <div class="mix-readout">
                <span class="mix-chip" data-chip></span>
                <input class="mix-code" data-code spellcheck="false" aria-label="Hex colour" />
            </div>`;

        const Square = Field.querySelector("[data-square]");
        const Knob = Field.querySelector("[data-square-knob]");
        const Hue = Field.querySelector("[data-hue]");
        const HueKnob = Field.querySelector("[data-hue-knob]");
        const Chip = Field.querySelector("[data-chip]");
        const Code = Field.querySelector("[data-code]");

        // 🔴 The hue is kept here, not derived from the colour on every draw. A grey has no hue to read back, so a
        //    picker that recomputed it would snap the bar to red the moment the brightness reached zero.
        let [Tone, Strength, Level] = RgbToHsv(Mix.Read());
        if (Strength > 0.001) this[Mix.Hue] = Tone;
        else Tone = this[Mix.Hue] ?? Tone;

        const Draw = () =>
        {
            const Colour = Mix.Read();
            const Hex = ToHex(Colour);
            Field.querySelector("[data-square-hue]").style.background = ToHex(HsvToRgb([Tone, 1, 1]));
            Knob.style.left = `${Strength * 100}%`;
            Knob.style.top = `${(1 - Level) * 100}%`;
            Knob.style.background = Hex;
            HueKnob.style.top = `${(Tone / 360) * 100}%`;
            Chip.style.background = Hex;
            if (document.activeElement !== Code) Code.value = Hex.toUpperCase();
        };

        const Apply = (Settled = true) =>
        {
            Mix.Write(HsvToRgb([Tone, Strength, Level]), Settled);
            Draw();
        };

        // 🔴 The colour under the finger is live and the colour let go of is the one that counts. Every move writes
        //    through unsettled so the viewport, the ribbon and the layer keep up; the release writes the same colour
        //    once more as settled, which is what lands in the recent rail and in the revision list.
        const Drag = (Node, Move) =>
        {
            const Follow = (Event, Settled) =>
            {
                const Box = Node.getBoundingClientRect();
                Move(Clamp((Event.clientX - Box.left) / (Box.width || 1), 0, 1), Clamp((Event.clientY - Box.top) / (Box.height || 1), 0, 1));
                Apply(Settled);
            };
            Node.addEventListener("pointerdown", (Event) =>
            {
                Node.setPointerCapture?.(Event.pointerId);
                Follow(Event, false);
            });
            Node.addEventListener("pointermove", (Event) =>
            {
                if (Node.hasPointerCapture?.(Event.pointerId)) Follow(Event, false);
            });
            Node.addEventListener("pointerup", (Event) =>
            {
                if (!Node.hasPointerCapture?.(Event.pointerId)) return;
                Node.releasePointerCapture(Event.pointerId);
                Apply(true);
            });
        };

        Drag(Square, (Across, Down) =>
        {
            Strength = Across;
            Level = 1 - Down;
        });
        Drag(Hue, (Across, Down) =>
        {
            Tone = Clamp(Down, 0, 0.9999) * 360;
            this[Mix.Hue] = Tone;
        });

        Code.addEventListener("change", () =>
        {
            const Parsed = /^#?[0-9a-f]{6}$/i.test(Code.value.trim()) ? FromHex(Code.value.trim().replace(/^#?/, "#")) : null;
            if (!Parsed)
            {
                Draw();
                return;
            }
            [Tone, Strength, Level] = RgbToHsv(Parsed);
            if (Strength > 0.001) this[Mix.Hue] = Tone;
            Apply();
        });

        Draw();
        Group.append(Field);
        // Read the colour again and move the knobs onto it. For when what is being mixed changes under the square —
        // another stop on the ramp, say — rather than because the square itself was dragged: a drag must keep the
        // hue it is holding, or a colour dragged down to black would snap the bar back to red on the way.
        Group.Refresh = () =>
        {
            [Tone, Strength, Level] = RgbToHsv(Mix.Read());
            if (Strength > 0.001) this[Mix.Hue] = Tone;
            else Tone = this[Mix.Hue] ?? Tone;
            Draw();
        };
        return Group;
    }

    // The mask's own picker: one number, from hidden to revealed.
    ValueField()
    {
        const Group = this.CardGroup("Value", "What the brush writes into the mask");
        const Row = document.createElement("div");
        Row.className = "control-row";
        Row.innerHTML = `
            <div class="mask-ramp" data-ramp><div class="ramp-knob" data-ramp-knob></div></div>
            <div class="swatch-row">
                <button class="tool-swatch" style="background:#000" data-level="0" title="Hide"></button>
                <button class="tool-swatch" style="background:#808080" data-level="0.5" title="Half"></button>
                <button class="tool-swatch" style="background:#fff" data-level="1" title="Reveal"></button>
            </div>`;
        const Ramp = Row.querySelector("[data-ramp]");
        const Knob = Row.querySelector("[data-ramp-knob]");
        const Draw = () =>
        {
            const Level = Clamp(this.MaskInk()[0], 0, 1);
            Knob.style.left = `${Level * 100}%`;
            for (const Chip of Row.querySelectorAll("[data-level]"))
                Chip.classList.toggle("active", Math.abs(Number(Chip.dataset.level) - Level) < 0.02);
        };
        const Set = (Across, Settled) =>
        {
            const Box = Ramp.getBoundingClientRect();
            const Level = Clamp((Across - Box.left) / (Box.width || 1), 0, 1);
            this.SetBrushColour([Level, Level, Level], Settled);
            Draw();
        };
        Ramp.addEventListener("pointerdown", (Event) =>
        {
            Ramp.setPointerCapture?.(Event.pointerId);
            Set(Event.clientX, false);
        });
        Ramp.addEventListener("pointermove", (Event) =>
        {
            if (Ramp.hasPointerCapture?.(Event.pointerId)) Set(Event.clientX, false);
        });
        Ramp.addEventListener("pointerup", (Event) =>
        {
            if (!Ramp.hasPointerCapture?.(Event.pointerId)) return;
            Ramp.releasePointerCapture(Event.pointerId);
            Set(Event.clientX, true);
        });
        for (const Chip of Row.querySelectorAll("[data-level]"))
            Chip.addEventListener("click", () =>
            {
                const Level = Number(Chip.dataset.level);
                this.SetBrushColour([Level, Level, Level]);
                Draw();
            });
        Draw();
        Group.append(Row);
        return Group;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · shape. The head and the mark one dab of it leaves.
    //----------------------------------------------------------------------------------------------------------------------
    ShapePane()
    {
        const Brush = this.Projection.Brush;
        const Media = Brush.Media || PlainMedia;
        const Sheet = document.createElement("div");

        // 🔴 What this particular instrument has that the others do not, at the top, before the five every head
        //    shares. A chisel marker's nib and a pencil's grade are not advanced settings — they are the first
        //    thing a hand reaches for, and they were unreachable while the library was gone.
        const Type = this.Holding;
        const Own = this.InstrumentControls();
        if (Type && Own.length)
        {
            const Group = this.CardGroup(Type.Label, Type.Name);
            Group.append(...Own);
            Sheet.append(Group);
        }

        const Head = this.CardGroup("Head", "Size in centimetres of surface, not of screen");
        Head.append(
            this.CardSlider(
                { Label: "Size", Value: Number((Brush.Radius * 100).toFixed(1)), Minimum: 0.4, Maximum: 60, Step: 0.1, Unit: "cm" },
                (Value) => this.SetBrush({ Radius: Clamp(Value / 100, 0.004, 0.6) }),
            ),
            this.CardSlider(
                { Label: "Hardness", Value: Math.round(Brush.Hardness * 100), Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Hint: "Where the rim starts falling away" },
                (Value) => this.SetBrush({ Hardness: Clamp(Value / 100, 0, 1) }),
            ),
            this.CardSlider(
                {
                    Label: "Roundness",
                    Value: Math.round((Media.Ratio ?? 1) * 100),
                    Minimum: 10,
                    Maximum: 100,
                    Step: 1,
                    Unit: "%",
                    Hint: "A round head draws one width; a chisel draws two",
                },
                (Value) => this.SetMedia({ Ratio: Clamp(Value / 100, 0.1, 1) }),
            ),
        );
        if ((Media.Ratio ?? 1) < 0.999)
            Head.append(
                this.CardSlider(
                    {
                        Label: "Angle",
                        Value: Math.round(((Media.Angle || 0) * 180) / Math.PI),
                        Minimum: -90,
                        Maximum: 90,
                        Step: 1,
                        Unit: "°",
                        Hint: "Which way the nib is held",
                    },
                    (Value) => this.SetMedia({ Angle: (Value * Math.PI) / 180 }),
                ),
            );
        Sheet.append(Head);

        const Hairs = this.CardGroup("Hairs", "A head is a row of them, and the gaps are the mark");
        Hairs.append(
            this.CardSlider(
                { Label: "Count", Value: Math.round(Media.Bristles || 0), Minimum: 0, Maximum: 48, Step: 1, Unit: "", Hint: "Nothing here is a solid head" },
                (Value) => this.SetMedia({ Bristles: Value }),
            ),
            this.MediaSlider("Splay", "Splay", { Scale: 100, Hint: "How far the head fans out under pressure" }),
            this.MediaSlider("Swell", "Swell", { Scale: 100, Hint: "How much of the width follows pressure" }),
        );
        Sheet.append(Hairs);

        const Edge = this.CardGroup("Edge", "What happens past the rim");
        Edge.append(
            this.MediaSlider("Scatter", "Scatter", { Scale: 100, Hint: "Dust shed outside the body of the mark" }),
            this.MediaSlider("Bleed", "Bleed", { Scale: 100, Hint: "How far a wet edge creeps" }),
            this.CardSlider(
                { Label: "Speckle", Value: Math.round(Brush.Jitter * 100), Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Hint: "Per-texel noise in the coverage" },
                (Value) => this.SetBrush({ Jitter: Clamp(Value / 100, 0, 1) }),
            ),
            this.CardSlider(
                {
                    Label: "Facing",
                    Value: Math.round(this.Projection.Brush.Facing ?? 72),
                    Minimum: 10,
                    Maximum: 180,
                    Step: 1,
                    Unit: "°",
                    Hint: "Stop painting past this angle from the normal under the cursor",
                },
                (Value) => this.SetBrush({ Facing: Value }),
            ),
        );
        Sheet.append(Edge);
        return Sheet;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · grain.
    //----------------------------------------------------------------------------------------------------------------------
    GrainPane()
    {
        const Media = this.Projection.Brush.Media || PlainMedia;
        const Sheet = document.createElement("div");

        const Kind = this.CardGroup("Medium", MediumByIndex[Media.Index]?.Note || "What the mark is made of");
        Kind.append(
            this.CardSegmented(
                MediumOrdering.map((Entry) => ({ Identifier: Entry.Identifier, Label: Entry.Label, Note: Entry.Note })),
                MediumByIndex[Media.Index]?.Identifier || "plain",
                (Identifier) =>
                {
                    const Entry = MediumOrdering.find((Option) => Option.Identifier === Identifier) || MediumOrdering[0];
                    this.SetMedia({ Medium: Entry.Identifier, Index: Entry.Index });
                    this.Instruments.RenderRail();
                    this.Instruments.RenderPane(false);
                    this.Notify(`${Entry.Label} · ${MediaSummary(this.Projection.Brush.Media)}`);
                },
            ),
        );
        Sheet.append(Kind);

        const Paper = this.CardGroup("Paper", "The tooth the mark is dragged across");
        Paper.append(
            this.MediaSlider("Grain", "Grain", { Scale: 100, Hint: "How much of the mark the tooth gets to decide" }),
            this.MediaSlider("Tooth", "Tooth", { Minimum: 20, Maximum: 900, Unit: "/m", Hint: "Cycles of paper per metre of surface" }),
            this.MediaSlider("Fibre", "Fibre", { Minimum: 20, Maximum: 900, Unit: "/m", Hint: "Streak frequency along the stroke" }),
        );
        Sheet.append(Paper);

        const Pigment = this.CardGroup("Pigment", "The strength of the stuff itself");
        Pigment.append(
            this.MediaSlider("Darkness", "Darkness", { Scale: 100, Maximum: 120, Hint: "How black the pigment is before the paper gets a say" }),
            this.MediaSlider("Wetness", "Wetness", { Scale: 100, Hint: "Water in the head: closes the comb, pools at the rim" }),
            this.MediaSlider("Melt", "Melt", { Scale: 100, Hint: "Wax pushed into the valleys by a hard stroke" }),
        );
        Sheet.append(Pigment);

        const Load = this.CardGroup("Load", "One dip of the head, and how far it carries");
        Load.append(
            this.MediaSlider("Dry", "Dry", { Scale: 100, Hint: "How much of the load is gone by the end of the reach" }),
            this.MediaSlider("Reach", "Reach", { Scale: 100, Minimum: 1, Maximum: 400, Unit: "cm", Hint: "How far one load carries" }),
        );
        Sheet.append(Load);
        return Sheet;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · taper and pressure. The curves live here: a taper IS what pressure is worth at the ends of a stroke.
    //----------------------------------------------------------------------------------------------------------------------
    TaperPane()
    {
        const Media = this.Projection.Brush.Media || PlainMedia;
        const Sheet = document.createElement("div");

        const Entry = this.CardGroup("Entry", "No hand-made mark arrives at full width");
        Entry.append(
            this.CardSwitch("Pressure", "Let the hand's weight drive the mark at all", Media.Pressure === true, (On) =>
            {
                this.SetMedia({ Pressure: On });
                this.Instruments.RenderRail();
                this.Instruments.RenderPane(false);
            }),
        );
        if (Media.Pressure)
            Entry.append(
                this.MediaSlider("Taper", "Taper", { Scale: 100, Hint: "How long the mark takes to reach full width" }),
                this.MediaSlider("Tilt", "Tilt", { Scale: 100, Hint: "Laying the stick over: wider, lighter" }),
            );
        Sheet.append(Entry);

        Sheet.append(this.CurvePane());
        return Sheet;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · stabilization.
    //----------------------------------------------------------------------------------------------------------------------
    // Pane · placement. How big a decal lands, which way up, and how far round the surface it wraps.
    //----------------------------------------------------------------------------------------------------------------------
    PlacementPane(Layer)
    {
        const Decal = Layer.Decal;
        const Template = this.ActiveMark || Decal;
        const Transform = Template.Transform;
        const Sheet = document.createElement("div");

        const Size = this.CardGroup("Size", this.ActiveMark ? `${this.ActiveMark.Name} · the mark in hand` : "What the next one lands at");
        Size.append(
            this.CardSlider(
                { Label: "Width", Value: Number(Transform.Size.toFixed(2)), Minimum: 0.02, Maximum: 2.4, Step: 0.01, Unit: "m" },
                (Value) => this.ShapeMark({ Size: Value }),
            ),
            this.CardSlider(
                { Label: "Aspect", Value: Number(Transform.Aspect.toFixed(2)), Minimum: 0.2, Maximum: 5, Step: 0.01, Unit: "×", Hint: "Width over height" },
                (Value) => this.ShapeMark({ Aspect: Value }),
            ),
            this.CardSlider(
                { Label: "Rotation", Value: Math.round(Transform.Rotation), Minimum: 0, Maximum: 360, Step: 1, Unit: "°", Hint: "Zero stands the artwork upright on screen" },
                (Value) => this.ShapeMark({ Rotation: Value }),
            ),
        );
        Sheet.append(Size);

        const Wrap = this.CardGroup("Wrap", "How far round the model the projection reaches");
        Wrap.append(
            this.CardSlider(
                { Label: "Depth", Value: Number(Transform.Depth.toFixed(2)), Minimum: 0.01, Maximum: 2, Step: 0.01, Unit: "m", Hint: "How deep into the model the artwork is projected" },
                (Value) => this.ShapeMark({ Depth: Value }),
            ),
            this.CardSlider(
                {
                    Label: "Angle limit",
                    Value: Math.round(Transform.AngleLimit),
                    Minimum: 10,
                    Maximum: 180,
                    Step: 1,
                    Unit: "°",
                    Hint: "Faces turned further than this from the decal do not take it",
                },
                (Value) => this.ShapeMark({ AngleLimit: Value }),
            ),
        );
        Sheet.append(Wrap);

        const Note = document.createElement("p");
        Note.className = "card-note";
        Note.textContent =
            "Drag a corner on the model to resize, shift-drag to stretch one axis, and drag the knob above the top edge to turn it. " +
            "Rotation zero is upright as the artwork was dropped.";
        Sheet.append(Note);
        return Sheet;
    }

    // One change to the transform of the mark in hand — or to the layer's template when there is no mark.
    ShapeMark(Changes)
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Kind !== "decal") return;
        const Target = this.ActiveMark || Layer.Decal;
        Target.Transform = { ...Target.Transform, ...Changes };
        if (!this.ActiveMark) Layer.Decal.Transform = Target.Transform;
        this.Recomposite();
        this.SyncGizmo();
        this.MarkDirty();
    }

    CardGroup(Title, Note = "")
    {
        const Group = document.createElement("div");
        Group.className = "property-group card-group";
        Group.innerHTML = `<div class="group-head"><h3>${Escape(Title)}</h3>${Note ? `<span>${Escape(Note)}</span>` : ""}</div>`;
        return Group;
    }

    CardSegmented(Options, Chosen, OnPick)
    {
        const Row = document.createElement("div");
        Row.className = "segmented card-segmented";
        Row.innerHTML = Options.map(
            (Option) => `<button class="segment ${Option.Identifier === Chosen ? "active" : ""}"
                    data-pick="${Escape(String(Option.Identifier))}"
                    title="${Escape(Option.Note || Option.Label)}">${Escape(Option.Label)}</button>`,
        ).join("");
        for (const Button of Row.querySelectorAll("[data-pick]"))
            Button.addEventListener("click", () => OnPick(Button.dataset.pick));
        return Row;
    }

    CardSlider(Options, OnChange)
    {
        const Holder = document.createElement("div");
        Holder.innerHTML = SliderRow({ ...Options, Bind: "card" });
        const Row = Holder.firstElementChild;
        const Input = Row.querySelector("input");
        Input.addEventListener("input", () =>
        {
            const Value = Number(Input.value);
            SyncSlider(Row, Value, Options.Step);
            OnChange(Value);
        });
        return Row;
    }

    CardSwitch(Label, Note, On, OnToggle)
    {
        const Row = document.createElement("div");
        Row.className = "property-row switch-row";
        Row.innerHTML = `<span class="property-label">${Escape(Label)}${
            Note ? ` · ${Escape(Note)}` : ""
        }</span><label class="switch"><input type="checkbox" ${On ? "checked" : ""} /><span></span></label>`;
        Row.querySelector("input").addEventListener("change", (Event) => OnToggle(Event.target.checked));
        return Row;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · how the mark goes down.
    //----------------------------------------------------------------------------------------------------------------------
    StrokePane()
    {
        const Sheet = document.createElement("div");
        const Group = this.CardGroup("Mode", StrokeModes.find((Mode) => Mode.Identifier === this.StrokeMode)?.Note || "");
        Group.append(
            this.CardSegmented(StrokeModes, this.StrokeMode, (Identifier) =>
            {
                this.StrokeMode = Identifier;
                this.Instruments.RenderRail();
                this.Instruments.RenderPane(false);
                this.SyncStrokeChip();
                this.Notify(`${StrokeModes.find((Mode) => Mode.Identifier === Identifier)?.Label} strokes.`);
            }),
        );
        Sheet.append(Group);

        if (this.StrokeMode === "line")
        {
            const Angles = this.CardGroup("Angle", "Hold the line to a step");
            Angles.append(
                this.CardSegmented(
                    LineSnaps.map((Degrees) => ({ Identifier: String(Degrees), Label: Degrees ? `${Degrees}°` : "Free" })),
                    String(this.LineSnap),
                    (Value) =>
                    {
                        this.LineSnap = Number(Value);
                        this.Instruments.RenderPane(false);
                    },
                ),
            );
            Sheet.append(Angles);
        }

        // The wash only owns the SHAPE of its one pass. Which colours it lays, in which order, and how they ease are
        // the gradient's business, and the gradient is a colour — it is in Colour, next to the square that mixes it.
        if (this.StrokeMode === "gradient")
        {
            const Shape = this.CardGroup("Fade", "Between the two ends of the drag");
            Shape.append(
                this.CardSegmented(GradientShapes, this.Gradient.Shape, (Identifier) =>
                {
                    this.Gradient.Shape = Identifier;
                    this.Instruments.RenderPane(false);
                }),
                this.CardSlider(
                    {
                        Label: "Softness",
                        Value: this.Gradient.Softness,
                        Minimum: 0,
                        Maximum: 1,
                        Step: 0.01,
                        Hint: "How much of the axis is doing the fading",
                    },
                    (Value) => (this.Gradient.Softness = Value),
                ),
                this.CardSwitch("All the way round", "Ignore which way the surface faces", this.Gradient.Through, (On) =>
                {
                    this.Gradient.Through = On;
                    this.Instruments.RenderPane(false);
                }),
            );
            Sheet.append(Shape);
        }

        const Hand = this.CardGroup("Hand", "The mark follows the hand at a distance");
        Hand.append(
            this.CardSlider(
                { Label: "Stabilization", Value: Math.round(this.Projection.Brush.Smoothing * 100), Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Hint: "How far behind the pointer the mark trails" },
                (Value) =>
                {
                    this.SetBrush({ Smoothing: Clamp(Value / 100, 0, 1) });
                    this.SetMedia({ Smoothing: Clamp(Value / 100, 0, 1) });
                    this.Instruments.RenderRail();
                },
            ),
            this.CardSlider(
                { Label: "Spacing", Value: Math.round(this.Projection.Brush.Spacing * 100), Minimum: 5, Maximum: 100, Step: 1, Unit: "%", Hint: "Distance between dabs, as a share of the head" },
                (Value) =>
                {
                    this.SetBrush({ Spacing: Clamp(Value / 100, 0.05, 1) });
                    this.Instruments.DrawPad();
                },
            ),
        );
        Sheet.append(Hand);

        const Note = document.createElement("p");
        Note.className = "card-note";
        Note.textContent =
            this.StrokeMode === "freehand"
                ? "The mark follows the hand, dab by dab, at the spacing the instrument asks for."
                : this.StrokeMode === "line"
                  ? "Press where it starts, aim, let go. The line is walked across the screen and raycast at every step, so it lies on the model rather than cutting through it."
                  : "Press where the gradient starts, drag to where it ends, let go. One pass over the whole sheet — every texel of it, not only the ground under the drag.";
        if (this.Gradient.Carry && this.StrokeMode !== "gradient")
            Note.textContent +=
                this.Gradient.Fit === "along"
                    ? " The gradient is measured along the mark, so a stroke that wanders takes the long way through the colours."
                    : " The gradient is fitted between the two ends of the mark — exactly, for an aimed line; measured out from the press for freehand, which has no far end until the hand lets go.";
        Note.textContent += " Stabilization pulls the mark towards the pointer rather than onto it, so the shake in a hand never reaches the surface.";
        Sheet.append(Note);
        return Sheet;
    }

    SyncStrokeChip()
    {
        const Chip = Select("#stroke-mode-chip");
        if (!Chip) return;
        const Mode = StrokeModes.find((Entry) => Entry.Identifier === this.StrokeMode) || StrokeModes[0];
        Chip.hidden = this.StrokeMode === "freehand";
        Chip.innerHTML = `${Icon(Mode.Glyph)}<span>${Escape(Mode.Label)}</span>`;
        FillIcons(Chip);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · pressure curves.
    //----------------------------------------------------------------------------------------------------------------------
    CurvePane()
    {
        const Sheet = document.createElement("div");
        const Group = this.CardGroup("Pressure", this.CurveEdit === "Size" ? "to size" : "to flow");
        Group.append(
            this.CardSegmented(
                [
                    { Identifier: "Size", Label: "Size" },
                    { Identifier: "Flow", Label: "Flow" },
                ],
                this.CurveEdit,
                (Identifier) =>
                {
                    this.CurveEdit = Identifier;
                    this.Instruments.RenderPane(false);
                },
            ),
        );
        Group.append(this.CurveWidget());
        Group.append(
            this.CardSegmented(CurvePresets, "", (Identifier) =>
            {
                this.Curves[this.CurveEdit] = DefaultCurve(Identifier);
                this.Instruments.RenderPane(false);
                this.Notify(`${this.CurveEdit} curve · ${CurvePresets.find((Entry) => Entry.Identifier === Identifier)?.Label}.`);
            }),
        );
        Sheet.append(Group);

        const Note = document.createElement("p");
        Note.className = "card-note";
        Note.textContent =
            "Across is what the hand reported — a pen's pressure, or the speed of a mouse. Up is what the paint does with it. Click the line to add a point, drag it about, double-click one to take it away.";
        Sheet.append(Note);
        return Sheet;
    }

    // 📝 The widget is a canvas rather than SVG so the grid, the curve and the live pressure read-out can be drawn in
    //    one pass; it is redrawn on every drag, and 64 strokes of SVG replaced every frame is how a card stutters.
    CurveWidget()
    {
        const Holder = document.createElement("div");
        Holder.className = "curve-well";
        const Canvas = document.createElement("canvas");
        Canvas.width = 440;
        Canvas.height = 180;
        Canvas.className = "curve-canvas";
        Holder.append(Canvas);
        const Readout = document.createElement("span");
        Readout.className = "curve-readout";
        Holder.append(Readout);

        const Points = () => SortCurve(this.Curves[this.CurveEdit]);
        const Draw = () =>
        {
            const Shape = Canvas.getContext("2d");
            if (!Shape) return;
            const Width = Canvas.width;
            const Height = Canvas.height;
            const Pad = 14;
            const X = (Value) => Pad + Value * (Width - Pad * 2);
            const Y = (Value) => Height - Pad - Value * (Height - Pad * 2);
            Shape.clearRect(0, 0, Width, Height);
            Shape.fillStyle = "#0f0f0f";
            Shape.fillRect(0, 0, Width, Height);
            Shape.strokeStyle = "rgba(255,255,255,.08)";
            Shape.lineWidth = 1;
            for (let Step = 0; Step <= 4; Step += 1)
            {
                const Fraction = Step / 4;
                Shape.beginPath();
                Shape.moveTo(X(Fraction), Y(0));
                Shape.lineTo(X(Fraction), Y(1));
                Shape.moveTo(X(0), Y(Fraction));
                Shape.lineTo(X(1), Y(Fraction));
                Shape.stroke();
            }
            Shape.strokeStyle = "rgba(255,255,255,.14)";
            Shape.beginPath();
            Shape.moveTo(X(0), Y(0));
            Shape.lineTo(X(1), Y(1));
            Shape.stroke();

            const Table = CurveTable(Points(), 64);
            Shape.strokeStyle = "#34c759";
            Shape.lineWidth = 2;
            Shape.beginPath();
            Table.forEach((Value, Index) =>
            {
                const Along = Index / (Table.length - 1);
                if (Index === 0) Shape.moveTo(X(Along), Y(Value));
                else Shape.lineTo(X(Along), Y(Value));
            });
            Shape.stroke();

            for (const [Across, Up] of Points())
            {
                Shape.fillStyle = "#0b0b0b";
                Shape.strokeStyle = "#f0f0f0";
                Shape.lineWidth = 1.5;
                Shape.beginPath();
                Shape.arc(X(Across), Y(Up), 4.5, 0, Math.PI * 2);
                Shape.fill();
                Shape.stroke();
            }
            Readout.textContent = `${Points().length} points · ${this.CurveEdit.toLowerCase()} ×${EvaluateCurve(
                Points(),
                1,
            ).toFixed(2)} at full pressure`;
        };

        const Place = (Event) =>
        {
            const Box = Canvas.getBoundingClientRect();
            const Pad = 14 / Canvas.width;
            const Across = (Event.clientX - Box.left) / Math.max(1, Box.width);
            const Up = 1 - (Event.clientY - Box.top) / Math.max(1, Box.height);
            return [
                Clamp((Across - Pad) / Math.max(1e-6, 1 - Pad * 2), 0, 1),
                Clamp((Up - (14 / Canvas.height)) / Math.max(1e-6, 1 - (28 / Canvas.height)), 0, 1),
            ];
        };
        const Nearest = (Where) =>
        {
            const Curve = Points();
            let Best = -1;
            let Distance = 0.06;
            Curve.forEach(([Across, Up], Index) =>
            {
                const Reach = Math.hypot(Across - Where[0], Up - Where[1]);
                if (Reach < Distance)
                {
                    Distance = Reach;
                    Best = Index;
                }
            });
            return Best;
        };

        let Holding = -1;
        Canvas.addEventListener("pointerdown", (Event) =>
        {
            const Where = Place(Event);
            Holding = Nearest(Where);
            if (Holding < 0)
            {
                this.Curves[this.CurveEdit] = PlaceCurvePoint(Points(), Where[0], Where[1]);
                Holding = Nearest(Where);
            }
            Canvas.setPointerCapture?.(Event.pointerId);
            Draw();
        });
        Canvas.addEventListener("pointermove", (Event) =>
        {
            if (Holding < 0) return;
            const Where = Place(Event);
            const Curve = Points();
            // The two ends keep their x: a curve that can slide its first point off zero has no answer for no pressure.
            const Pinned = Holding === 0 || Holding === Curve.length - 1;
            Curve[Holding] = [Pinned ? Curve[Holding][0] : Where[0], Where[1]];
            this.Curves[this.CurveEdit] = SortCurve(Curve);
            Holding = Nearest([Pinned ? Curve[Holding][0] : Where[0], Where[1]]);
            Draw();
        });
        const Release = () => (Holding = -1);
        Canvas.addEventListener("pointerup", Release);
        Canvas.addEventListener("pointercancel", Release);
        Canvas.addEventListener("dblclick", (Event) =>
        {
            const Index = Nearest(Place(Event));
            if (Index < 0) return;
            this.Curves[this.CurveEdit] = LiftCurvePoint(Points(), Index);
            Draw();
        });
        Draw();
        return Holder;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Channels · one switch, two faces.
    //
    // 🔴 The card said what the stroke was allowed to write; the inspector said what the layer wrote. Two sets of
    //    switches over one idea, a panel apart, and nothing kept them level: tick Metalness on the card over a layer
    //    whose metalness chip had been dropped and the paint went nowhere, with both panels insisting they were
    //    right. They are the same switch now. The layer is the truth — it is what composites — and the brush adopts
    //    it whenever the layer in hand changes.
    //----------------------------------------------------------------------------------------------------------------------
    ChannelWrote(Key)
    {
        const Layer = this.ActiveLayer;
        if (Layer?.Enabled && this.Projection.Brush.Target !== "mask" && Key in Layer.Enabled) return Boolean(Layer.Enabled[Key]);
        return this.ChannelWrites[Key] !== false;
    }

    SetChannelWrite(Key, On)
    {
        if (WriteKeys.includes(Key)) this.ChannelWrites[Key] = On;
        const Layer = this.ActiveLayer;
        if (!Layer?.Enabled || this.Projection.Brush.Target === "mask" || !(Key in Layer.Enabled)) return;
        // A channel arriving on the layer brings the value it writes with it, or the first stroke would lay a zero
        // nobody asked for.
        if (On && Layer.Channels[Key] === undefined && ChannelByIdentifier[Key])
            Layer.Channels[Key] = structuredClone(ChannelByIdentifier[Key].Default);
        Layer.Enabled[Key] = On;
    }

    // The layer in hand changed under the card: the brush writes what that layer writes.
    AdoptChannelWrites()
    {
        const Layer = this.ActiveLayer;
        if (!Layer?.Enabled || this.Projection.Brush.Target === "mask") return;
        for (const Key of WriteKeys) if (Key in Layer.Enabled) this.ChannelWrites[Key] = Boolean(Layer.Enabled[Key]);
    }

    // Both faces redrawn after a channel moved, whichever of them was pressed.
    SyncChannelFaces()
    {
        this.Instruments?.RenderRail();
        this.Instruments?.RenderPane(false);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · the material the paint lays down, and which of it the stroke is allowed to write.
    //
    // 🔴 These were two panes a rail apart: the numbers in the inspector, the write switches on the card. Painting a
    //    metallic marker needs both in one breath — gold is a colour AND a metalness AND a roughness, and three of
    //    the four live in different places the moment you split them. One pane: the tick says whether the stroke
    //    writes that channel, the slider under it says what it writes. A channel the stroke does not write has
    //    nothing to say, so it shows no slider.
    //----------------------------------------------------------------------------------------------------------------------
    MaterialPane(Layer, Masking)
    {
        const Sheet = document.createElement("div");
        if (Masking)
        {
            const Note = document.createElement("p");
            Note.className = "card-note";
            Note.textContent =
                "The brush is aimed at this layer's mask. A mask is one channel — how much of the layer shows — so there is nothing here to choose between. Aim the brush back at the content to pick channels again.";
            Sheet.append(Note);
            return Sheet;
        }

        // 🔴 No finish chips. A finish is not something you pick next to the paint — it is what the paint IS, and the
        //    instrument already said: a metallic marker lays metal, a chalk lays chalk. So the pane opens on the
        //    channels the instrument in hand actually paints, and the rest of the eleven are one press away for the
        //    cases the library has no name for.
        const Type = this.Holding;
        const Exposed = Type?.Paint?.Exposes || [];
        // 📝 The short view is shown only while the writes still agree with the instrument. Widen them by hand and
        //    the pane widens with them: a pane that said "a pencil writes two channels" over a stroke that writes
        //    eleven would be the one place in the card that lies.
        const Narrow =
            Exposed.length > 0 &&
            WriteKeys.every((Key) => Key === "base_color" || Exposed.includes(Key) || !this.ChannelWrote(Key));
        const Showing = this.EveryChannel || !Narrow;

        if (Type && Narrow)
        {
            const Own = this.CardGroup(Type.Label, `${Type.Name} · what it lays on the surface`);
            for (const Part of WriteKeys.filter((Key) => Exposed.includes(Key)))
            {
                const Slot = WriteSlots.flatMap((Entry) => Entry.Components).find((Entry) => Entry.Key === Part);
                if (Slot) Own.append(...this.ChannelValue(Layer, Slot));
            }
            Sheet.append(Own);
        }

        if (Showing)
            for (const Slot of WriteSlots)
            {
                const Group = this.CardGroup(Slot.Label, Slot.Note);
                for (const Part of Slot.Components)
                {
                    const On = Part.Locked || this.ChannelWrote(Part.Key);
                    const Row = document.createElement("button");
                    Row.className = `channel-pick ${On ? "on" : ""} ${Part.Locked ? "locked" : ""}`;
                    Row.innerHTML = `<span class="channel-tick">${On ? Icon("check") : ""}</span>
                        <span class="channel-name">${Escape(Part.Label)}</span>
                        <span class="channel-note">${Part.Locked ? "always" : Escape(Part.Key)}</span>`;
                    FillIcons(Row);
                    if (!Part.Locked)
                        Row.addEventListener("click", () =>
                        {
                            this.CaptureStack(() => this.SetChannelWrite(Part.Key, !On));
                            this.SyncChannelFaces();
                        });
                    Group.append(Row);
                    if (On) Group.append(...this.ChannelValue(Layer, Part));
                }
                Sheet.append(Group);
            }
        else
        {
            const More = document.createElement("div");
            More.className = "card-actions";
            More.innerHTML = `<button data-every>Every channel</button>`;
            More.querySelector("[data-every]").addEventListener("click", () =>
            {
                this.EveryChannel = true;
                this.Instruments.RenderPane(false);
            });
            Sheet.append(More);
        }

        const Row = document.createElement("div");
        Row.className = "card-actions";
        Row.innerHTML = Showing
            ? `<button data-all>Everything</button><button data-none>Cover only</button>`
            : `<button data-all>Everything</button>`;
        Row.querySelector("[data-all]").addEventListener("click", () =>
        {
            this.EveryChannel = true;
            this.CaptureStack(() =>
            {
                for (const Key of WriteKeys) this.SetChannelWrite(Key, true);
            });
            this.SyncChannelFaces();
        });
        Row.querySelector("[data-none]")?.addEventListener("click", () =>
        {
            this.CaptureStack(() =>
            {
                for (const Key of WriteKeys) this.SetChannelWrite(Key, false);
            });
            this.SyncChannelFaces();
        });
        Sheet.append(Row);

        const Note = document.createElement("p");
        Note.className = "card-note";
        Note.textContent = Showing
            ? "Switched off means the stroke leaves that channel exactly as it found it. The layer's own cover is always written, or a stroke that paints roughness alone would never show. " +
              "Colour is the one channel whose value is not here: it is the colour in hand, one pane up."
            : `A ${Type.Label.toLowerCase()} writes colour and ${Exposed.length === 1 ? "one channel" : `${Exposed.length} channels`} and leaves the rest of the surface exactly as it found it. ` +
              "Open every channel to paint something the library has no name for.";
        Sheet.append(Note);
        return Sheet;
    }

    // What one written channel lays down. Colour comes from the hand, cover comes from the stroke, and neither of
    // them has a number to set here — the rest are the layer's own, the same values the inspector edits.
    ChannelValue(Layer, Part)
    {
        if (Part.Key === "coverage" || Part.Key === "base_color") return [];
        const Channel = ChannelSpecification.find((Entry) => Entry.Identifier === Part.Key);
        if (!Channel) return [];
        if (Layer.Channels[Part.Key] === undefined) Layer.Channels[Part.Key] = structuredClone(Channel.Default);

        const Settle = () =>
        {
            Layer.Enabled[Part.Key] = true;
            this.Recomposite();
            this.MarkDirty();
            this.RenderInspector();
            this.Instruments.RenderRail();
        };

        if (Channel.Kind === "color")
        {
            const Holder = document.createElement("div");
            Holder.className = "property-row colour-row channel-value";
            const Code = ToHex(Layer.Channels[Part.Key]);
            Holder.innerHTML = `<span class="property-label">Colour</span>
                <label class="colour-field" style="background:${Code}">
                    <input type="color" value="${Code}" data-channel-colour>
                </label>
                <span class="colour-code">${Code.toUpperCase()}</span>`;
            const Field = Holder.querySelector("[data-channel-colour]");
            Field.addEventListener("input", () =>
            {
                Layer.Channels[Part.Key] = FromHex(Field.value);
                Holder.querySelector(".colour-field").style.background = Field.value;
                Holder.querySelector(".colour-code").textContent = Field.value.toUpperCase();
                Settle();
            });
            return [Holder];
        }

        const Slider = this.CardSlider(
            {
                Label: Channel.Label,
                Value: Number(Number(Layer.Channels[Part.Key] ?? 0).toFixed(2)),
                Minimum: 0,
                Maximum: 1,
                Step: 0.01,
                Hint: Channel.Hint,
            },
            (Value) =>
            {
                Layer.Channels[Part.Key] = Value;
                Settle();
            },
        );
        Slider.classList.add("channel-value");
        return [Slider];
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Panes · the decal in hand.
    //----------------------------------------------------------------------------------------------------------------------
    ArtworkPane(Layer)
    {
        const Sheet = document.createElement("div");
        const Ink = Layer.Decal.Ramp?.Carry ? "a gradient" : Layer.Decal.Colorise ? "one colour" : "its own colours";
        const Look = this.CardGroup(Layer.Decal.SourceKind === "text" ? "The type" : "The drawing", `As it will land · ${Ink}`);
        Look.append(this.DecalPreview(Layer));
        Sheet.append(Look);
        const Kind = this.CardGroup("Source", "What the decal is made from");
        Kind.append(
            this.CardSegmented(
                [
                    { Identifier: "svg", Label: "Vector", Note: "A drawing from the library or your own SVG" },
                    { Identifier: "text", Label: "Type", Note: "Set in one of the editor's faces" },
                ],
                Layer.Decal.SourceKind,
                (Identifier) =>
                {
                    this.CaptureStack(() => (Layer.Decal.SourceKind = Identifier));
                    this.RefreshDecal(Layer);
                    this.RenderInspector();
                    this.Instruments.RenderRail();
                    this.Instruments.RenderPane(false);
                },
            ),
        );
        Sheet.append(Kind);

        if (Layer.Decal.SourceKind === "text")
        {
            const Type = this.CardGroup("Wording", `${Layer.Decal.Text.Family} ${Layer.Decal.Text.Weight}`);
            const Field = document.createElement("textarea");
            Field.className = "card-field";
            Field.rows = 2;
            Field.value = Layer.Decal.Text.Content;
            Field.spellcheck = false;
            Field.addEventListener("input", () =>
            {
                Layer.Decal.Text.Content = Field.value;
                this.RefreshDecal(Layer);
            });
            Field.addEventListener("change", () => this.CaptureStack(() => {}));
            Type.append(Field);

            const Faces = document.createElement("div");
            Faces.className = "face-list";
            Faces.innerHTML = FontArchive.map(
                (Face) => `<button data-face="${Escape(Face.Family)}" class="${
                    Face.Family === Layer.Decal.Text.Family ? "active" : ""
                }" style="font-family:'${Escape(Face.Family)}', 'DM Sans', sans-serif">
                    <strong>${Escape(Face.Family)}</strong><small>${Escape(Face.Note || "")}</small></button>`,
            ).join("");
            for (const Button of Faces.querySelectorAll("[data-face]"))
                Button.addEventListener("click", () =>
                {
                    this.CaptureStack(() => (Layer.Decal.Text.Family = Button.dataset.face));
                    this.RefreshDecal(Layer);
                    this.RenderInspector();
                    this.Instruments.RenderPane(false);
                });
            Type.append(Faces);

            Type.append(
                this.CardSegmented(
                    [
                        { Identifier: "300", Label: "Light" },
                        { Identifier: "400", Label: "Regular" },
                        { Identifier: "700", Label: "Bold" },
                    ],
                    String(Layer.Decal.Text.Weight),
                    (Value) =>
                    {
                        this.CaptureStack(() => (Layer.Decal.Text.Weight = Number(Value)));
                        this.RefreshDecal(Layer);
                        this.Instruments.RenderPane(false);
                    },
                ),
                this.CardSlider(
                    { Label: "Size", Value: Layer.Decal.Text.Size, Minimum: 40, Maximum: 320, Step: 1, Unit: "px" },
                    (Value) =>
                    {
                        Layer.Decal.Text.Size = Value;
                        this.RefreshDecal(Layer);
                    },
                ),
                this.CardSlider(
                    { Label: "Tracking", Value: Layer.Decal.Text.Tracking, Minimum: -10, Maximum: 40, Step: 0.5 },
                    (Value) =>
                    {
                        Layer.Decal.Text.Tracking = Value;
                        this.RefreshDecal(Layer);
                    },
                ),
                this.CardSlider(
                    { Label: "Outline", Value: Layer.Decal.Text.Outline, Minimum: 0, Maximum: 12, Step: 0.5 },
                    (Value) =>
                    {
                        Layer.Decal.Text.Outline = Value;
                        this.RefreshDecal(Layer);
                    },
                ),
            );
            Sheet.append(Type);
        }
        else
        {
            const Library = this.CardGroup("Drawing", `${DecalLibrary.length} in the library`);
            const Shelf = document.createElement("div");
            Shelf.className = "mark-shelf";
            Shelf.innerHTML = DecalLibrary.map(
                (Entry) => `<button data-mark="${Escape(Entry.Identifier)}" class="${
                    Entry.Identifier === Layer.Decal.Library ? "active" : ""
                }" title="${Escape(Entry.Label)}"><span>${Entry.Markup || ""}</span><small>${Escape(Entry.Label)}</small></button>`,
            ).join("");
            for (const Button of Shelf.querySelectorAll("[data-mark]"))
                Button.addEventListener("click", () =>
                {
                    this.CaptureStack(() =>
                    {
                        Layer.Decal.Library = Button.dataset.mark;
                        Layer.Decal.Svg = "";
                    });
                    this.RefreshDecal(Layer);
                    this.RenderInspector();
                    this.Instruments.RenderPane(false);
                });
            Library.append(Shelf);
            Sheet.append(Library);
        }

        const Fit = this.CardGroup("Fit", Layer.Decal.Placement === "stamp" ? "Burned into the layer" : "Kept as a placement");
        Fit.append(
            this.CardSegmented(
                [
                    { Identifier: "stamp", Label: "Burn in", Note: "Click the model and the artwork becomes paint" },
                    { Identifier: "project", Label: "Place", Note: "Keep it movable on the surface" },
                ],
                Layer.Decal.Placement,
                (Identifier) =>
                {
                    this.CaptureStack(() => (Layer.Decal.Placement = Identifier));
                    this.RenderInspector();
                    this.Instruments.RenderRail();
                    this.Instruments.RenderPane(false);
                },
            ),
            this.CardSlider(
                { Label: "Softness", Value: Layer.Decal.Softness, Minimum: 0, Maximum: 0.5, Step: 0.005 },
                (Value) =>
                {
                    Layer.Decal.Softness = Value;
                    this.Recomposite();
                    this.MarkDirty();
                },
            ),
        );
        Sheet.append(Fit);
        return Sheet;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pane · the ink. What the artwork is made of.
    //
    // 🔴 Three ways and never two at once. A switch that said "tint it" and a separate gradient would have left the
    //    hand asking which of them wins; a decal's ink is ONE answer — the artwork's own colours, one colour, or a
    //    fade across it — so it is one control with three positions.
    //----------------------------------------------------------------------------------------------------------------------
    InkPane(Layer)
    {
        const Decal = Layer.Decal;
        const Ramped = Decal.Ramp?.Carry === true;
        const Sheet = document.createElement("div");

        const Look = this.CardGroup("Preview", Ramped ? "Inked by the gradient below" : Decal.Colorise ? "Inked flat" : "Untouched");
        Look.append(this.DecalPreview(Layer));
        Sheet.append(Look);

        const Standing = Ramped ? "gradient" : Decal.Colorise ? "flat" : "artwork";
        const Group = this.CardGroup(
            "Colour",
            Ramped ? "A fade across the artwork" : Decal.Colorise ? "One colour" : "The artwork's own colours",
        );
        Group.append(
            this.CardSegmented(
                [
                    { Identifier: "artwork", Label: "As drawn", Note: "Keep the colours the artwork came with" },
                    { Identifier: "flat", Label: "One colour", Note: "Ignore them and use the tint" },
                    { Identifier: "gradient", Label: "Gradient", Note: "Run the artwork through a ramp" },
                ],
                Standing,
                (Identifier) =>
                {
                    this.CaptureStack(() =>
                    {
                        Decal.Colorise = Identifier === "flat";
                        Decal.Ramp.Carry = Identifier === "gradient";
                        // 🔴 Every placement follows. A mark keeps its own tint, but a mark still colourising while
                        //    the artwork carries a gradient would paint that gradient out with one flat colour.
                        for (const Mark of Decal.Marks || []) Mark.Colorise = Decal.Colorise;
                    });
                    this.RefreshDecal(Layer);
                    this.RenderInspector();
                    this.Instruments.RenderRail();
                    this.Instruments.RenderPane(false);
                },
            ),
        );

        Sheet.append(Group);

        // 🔴 The ramp is baked into the artwork, so every edit re-prints it. That is also what makes the preview
        //    above exact rather than indicative: it is the image, not a drawing of what the image means.
        const Reprint = () =>
        {
            this.QueueDecal(Layer);
            this.MarkDirty();
        };

        // The strip is built before the picker that edits it, so the picker can ask it to redraw in place; the picker
        // is declared before the strip, so the strip can point it at another stop. Neither rebuilds the pane.
        let Mixer = null;
        const Well =
            Standing === "gradient"
                ? this.RampField({
                      Read: () => Decal.Ramp.Stops,
                      Write: (Stops) => (Decal.Ramp.Stops = Stops),
                      Cursor: "InkStop",
                      Chose: () => Mixer?.Refresh?.(),
                      Arm: () =>
                      {
                          Decal.Ramp.Carry = true;
                          Reprint();
                      },
                  })
                : null;

        if (Well)
        {
            const Ramp = this.CardGroup("Gradient", "The colours the artwork is printed in");
            Ramp.append(Well);
            Sheet.append(Ramp);
        }

        // 🔴 The same square the paint is mixed in, pointed at the ink. One colour mode mixes the tint; a gradient
        //    mixes whichever stop the strip below is pointing at, so there is one place to pick a colour on this
        //    card and not three — a picker here, chips there and a system colour dialog hiding behind a swatch.
        const Chosen = () => Math.max(0, Math.min(this.InkStop || 0, (Decal.Ramp?.Stops?.length || 1) - 1));
        if (Standing !== "artwork")
        {
            Mixer = this.ColourField({
                Title: Standing === "gradient" ? "Mix the stop" : "Mix",
                Note: Standing === "gradient" ? "The colour under the knob on the strip" : "Saturation across · brightness down",
                Hue: "InkHue",
                Read: () => (Standing === "gradient" ? Decal.Ramp.Stops[Chosen()]?.Colour || Decal.Tint : Decal.Tint),
                Write: (Colour, Settled = true) =>
                {
                    const Recorded = this.SettleStack(Settled, () =>
                    {
                        if (Standing === "gradient")
                            Decal.Ramp.Stops = Decal.Ramp.Stops.map((Stop, Index) =>
                                Index === Chosen() ? { ...Stop, Colour: [...Colour] } : Stop,
                            );
                        else
                        {
                            Decal.Tint = [...Colour];
                            // 🔴 A placement carries its own tint — ShadingIntegrator reads the mark before the layer
                            //    — so an ink mixed here that did not reach them would change the preview and nothing
                            //    else.
                            for (const Mark of Decal.Marks || []) Mark.Tint = [...Colour];
                        }
                    });
                    Well?.Refresh?.();
                    Reprint();
                    if (Recorded) this.NoteColour(Colour);
                },
            });
            Sheet.append(Mixer);

            // Eight inks that are always wanted, and then the colours this hand has actually used — the same list
            // the brush keeps, because a decal and a stroke are the same person's palette.
            const Quick = this.CardGroup("Inks", Standing === "gradient" ? "Straight into the stop" : "The ones always wanted");
            const Take = (Colour) =>
            {
                this.CaptureStack(() =>
                {
                    if (Standing === "gradient")
                        Decal.Ramp.Stops = Decal.Ramp.Stops.map((Stop, Index) =>
                            Index === Chosen() ? { ...Stop, Colour: [...Colour] } : Stop,
                        );
                    else
                    {
                        Decal.Tint = [...Colour];
                        for (const Mark of Decal.Marks || []) Mark.Tint = [...Colour];
                    }
                });
                this.NoteColour(Colour);
                Well?.Refresh?.();
                Mixer.Refresh?.();
                Reprint();
                this.RenderInspector();
            };
            const Palette = ["#f0f0f0", "#111111", "#d82a2a", "#e8b53a", "#34c759", "#3a7bd5", "#9b5de5", "#ff8a3d"];
            const Swatches = document.createElement("div");
            Swatches.className = "card-swatches";
            Swatches.innerHTML = Palette.map(
                (Code) => `<button data-ink="${Code}" style="background:${Code}" title="${Code}" aria-label="${Code}"></button>`,
            ).join("");
            for (const Button of Swatches.querySelectorAll("[data-ink]"))
                Button.addEventListener("click", () => Take(FromHex(Button.dataset.ink)));
            Quick.append(Swatches);
            Sheet.append(Quick);

            const Recent = this.CardGroup("Recent", "The last colours mixed here");
            const Row = document.createElement("div");
            Row.className = "swatch-row";
            Row.innerHTML = (this.RecentColours || [])
                .map(
                    (Code) =>
                        `<button class="tool-swatch" style="background:${Code}" data-recent="${Code}" title="${Code.toUpperCase()}"></button>`,
                )
                .join("");
            for (const Chip of Row.querySelectorAll("[data-recent]"))
                Chip.addEventListener("click", () => Take(FromHex(Chip.dataset.recent)));
            Recent.append(Row);
            Sheet.append(Recent);
        }

        if (Standing === "gradient")
        {
            const Fade = this.CardGroup("How it runs", "Which way the colours travel across the artwork");
            Fade.append(
                this.CardSegmented(DecalFits, Decal.Ramp.Fit, (Identifier) =>
                {
                    this.CaptureStack(() => (Decal.Ramp.Fit = Identifier));
                    Reprint();
                    this.Instruments.RenderPane(false);
                }),
                this.CardSegmented(GradientEasings, Decal.Ramp.Easing, (Identifier) =>
                {
                    this.CaptureStack(() => (Decal.Ramp.Easing = Identifier));
                    Reprint();
                    this.Instruments.RenderPane(false);
                }),
                this.CardSwitch("Turn it around", "Start at the far end", Decal.Ramp.Reverse === true, (On) =>
                {
                    this.CaptureStack(() => (Decal.Ramp.Reverse = On));
                    Reprint();
                    this.Instruments.RenderPane(false);
                }),
            );
            Sheet.append(Fade);
        }

        const Relief = this.CardGroup("Relief", "What the artwork does to the surface");
        Relief.append(
            this.CardSlider(
                { Label: "Emboss", Value: Layer.Decal.Emboss, Minimum: -1, Maximum: 1, Step: 0.01 },
                (Value) =>
                {
                    Layer.Decal.Emboss = Value;
                    this.Recomposite();
                    this.MarkDirty();
                },
            ),
            this.CardSlider(
                {
                    Label: "Roughness",
                    Value: Layer.Channels.specular_roughness ?? 0.3,
                    Minimum: 0,
                    Maximum: 1,
                    Step: 0.01,
                },
                (Value) =>
                {
                    Layer.Channels.specular_roughness = Value;
                    this.Recomposite();
                    this.MarkDirty();
                },
            ),
            this.CardSlider(
                { Label: "Metalness", Value: Layer.Channels.base_metalness ?? 0, Minimum: 0, Maximum: 1, Step: 0.01 },
                (Value) =>
                {
                    Layer.Channels.base_metalness = Value;
                    this.Recomposite();
                    this.MarkDirty();
                },
            ),
        );
        Sheet.append(Relief);

        const Note = document.createElement("p");
        Note.className = "card-note";
        Note.textContent =
            Standing === "artwork"
                ? "The artwork keeps the colours it was drawn in. Switch to one colour or a gradient to print it in ink of your own."
                : Standing === "gradient"
                  ? "Click the strip to add a colour, drag one along to move it, double-click one to take it away — and mix whichever is under the knob in the square above. The preview at the top is the image itself, re-printed on every edit."
                  : "The square mixes the ink the artwork is printed in. Everything a decal is coloured with lives on this one row of the rail — there is no separate pigment for a layer that is printed rather than painted.";
        Sheet.append(Note);
        return Sheet;
    }

    // One way in for the brush colour, whether it came from the picker, a swatch on the rail or a sampled texel: the
    // stroke layer in hand follows the brush, because a hand-painted layer is the colour it was painted with.
    //
    // 📝 `Settled` is whether the colour has been let go of. A knob still under the finger sweeps through every shade
    //    between where it started and where it is going, and none of those shades were chosen by anybody — they are a
    //    gesture, not a decision. Unsettled writes move the brush and repaint the viewport; the recent rail is only
    //    written when the drag ends, so sliding red to yellow leaves one swatch behind instead of forty.
    SetBrushColour(Colour, Settled = true)
    {
        this.BrushColour = [...Colour];
        const Code = ToHex(this.BrushColour);
        const Field = Select("#brush-colour");
        if (Field && Field.value !== Code) Field.value = Code;
        Select("#brush-swatch")?.style.setProperty("--swatch", Code);
        if (Settled) this.NoteColour(this.BrushColour);
        this.Instruments?.ScheduleRibbon();
        const Layer = this.ActiveLayer;
        if (Layer?.Kind === "stroke")
        {
            Layer.Channels.base_color = [...this.BrushColour];
            if (Settled) this.RenderInspector();
            this.Recomposite();
        }
    }

    // 📝 The same idea one floor down, for the edits that are worth undoing. The snapshot a drag will undo to is the
    //    one taken when the finger went down, not the one in front of the last intermediate colour, so a sweep across
    //    the square is a single revision however many frames it lasted. Returns whether the edit was recorded.
    SettleStack(Settled, Mutate)
    {
        if (!this.SettlingFrom) this.SettlingFrom = structuredClone(this.StackRecord());
        Mutate();
        if (!Settled) return false;
        const Before = this.SettlingFrom;
        this.SettlingFrom = null;
        this.Project.Layers = OrderStack(this.Project.Layers);
        const After = structuredClone(this.StackRecord());
        this.Revisions.Record({ Kind: "stack", Before, After });
        this.AfterStackChange();
        return true;
    }

    // The brush pod, by the name the rest of the editor has always called it.
    TogglePod(Open)
    {
        this.ShowPopover("brush", Open);
    }

    // The rig is written into the document only when something in it moves. Until then the pod is showing the sky's
    // own three lights, and a project saved without touching them follows whatever the preset says next.
    EnsureLights()
    {
        const Environment = this.Project.Environment;
        if (!Array.isArray(Environment.Lights)) Environment.Lights = DefaultLights(Environment.Identifier);
        return Environment.Lights;
    }

    RenderSymmetryChips()
    {
        const Host = Select("#pod-symmetry");
        if (!Host) return;
        const Current = this.Projection.Brush.Symmetry;
        Host.innerHTML = SymmetryOrdering.map(
            (Entry) => `
            <button class="pod-chip ${Entry.Identifier === Current ? "active" : ""}" data-symmetry="${Entry.Identifier}"
                    aria-pressed="${Entry.Identifier === Current}">${Escape(Entry.Label)}</button>`,
        ).join("");
        Select("#sector-field")?.classList.toggle("shown", Current === "radial");
    }

    // Colours the brush has actually carried, newest first. Mixing is a thing people do by eye, and reaching back for
    // the shade from two strokes ago should not mean finding it again in a colour wheel.
    NoteColour(Colour)
    {
        const Code = ToHex(Colour);
        this.RecentColours = [Code, ...(this.RecentColours || []).filter((Entry) => Entry !== Code)].slice(0, 9);
        this.RenderSwatchRail();
    }

    RenderSwatchRail()
    {
        const Rail = Select("#swatch-rail");
        if (!Rail) return;
        const Current = ToHex(this.BrushColour);
        Rail.innerHTML = (this.RecentColours || [])
            .map(
                (Code) => `
            <button class="rail-swatch ${Code === Current ? "active" : ""}" data-swatch="${Code}" title="${Code.toUpperCase()}"
                    style="--swatch:${Code}" aria-label="Use ${Code.toUpperCase()}"></button>`,
            )
            .join("");
    }

    SyncPodSummary()
    {
        const Brush = this.Projection.Brush;
        const Size = Select("#pod-size");
        if (Size) Size.textContent = `${(Brush.Radius * 100).toFixed(1)} cm`;
        const Note = Select("#pod-note");
        if (Note)
            Note.textContent =
                `flow ${Brush.Flow.toFixed(2)} · hard ${Brush.Hardness.toFixed(2)}` +
                (Brush.Media && Brush.Media.Index ? ` · ${MediaSummary(Brush.Media)}` : "") +
                (Brush.Symmetry === "none"
                    ? ""
                    : Brush.Symmetry === "radial"
                      ? ` · radial ×${Brush.Sectors}`
                      : ` · mirror ${Brush.Symmetry.toUpperCase()}`);
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
            if (Display) Display.textContent = BrushReadout(Key, Brush[Key]);
        });
        Select("#brush-colour").value = ToHex(this.BrushColour);
        Select("#brush-swatch").style.setProperty("--swatch", ToHex(this.BrushColour));
        // The HUD names the medium in hand rather than the word "brush", because that is what the next stroke will
        // be made of — the card tunes the medium, and this is the one-line readout of where it has got to.
        Select("#brush-hud").textContent =
            `${(MediumByIndex[Brush.Media?.Index ?? 0]?.Label || "Brush").toUpperCase()} ${(Brush.Radius * 100).toFixed(1)} cm`;
        this.SyncPodSummary();
        this.RenderSwatchRail();
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
            // A stamping layer keeps no placements, so the artwork record itself is what the placement rows edit.
            Mark: this.ActiveMark || (Layer?.Kind === "decal" ? Layer.Decal : null),
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
        // 🔴 The rig is shown before it exists. The pod draws the environment's own lights whether or not this
        //    project has written any of its own, so the first drag on one of those sliders is what mints the record
        //    — without this the write would resolve to nothing and the slider would spring back, silently.
        if (Path.startsWith("Environment.Lights.")) this.EnsureLights();
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
        // A layer's own sheet size is a structural change: the images it already holds are resampled into the new size
        // rather than thrown away, so paint survives the move in both directions.
        if (Path === "Layer.Resolution")
        {
            const Layer = this.ActiveLayer;
            if (!Layer) return;
            Layer.Resolution = Number(Layer.Resolution) || 0;
            const Size = this.Integrator.LayerResolution(Layer);
            this.Integrator.ResampleLayer(Layer);
            this.Recomposite();
            this.MarkDirty();
            this.RenderStack();
            if (Committed)
            {
                this.Chronicle("structure", `${Layer.Name} sheet ${Size}²`, Layer.Resolution ? "layer resolution" : "follows the document");
                this.Notify(`${Layer.Name} now paints at ${Size}².`);
            }
            return;
        }
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
        if (Path === "Decal.Placement")
        {
            const Layer = this.ActiveLayer;
            if (Layer?.Kind === "decal" && Layer.Decal.Placement === "project" && !Layer.Decal.Marks.length)
            {
                const Mark = CreateMark(Layer.Decal, { Name: "Mark 1" });
                Layer.Decal.Marks.push(Mark);
                Layer.Decal.Selection = Mark.Identifier;
            }
            this.Recomposite();
            this.RenderStack();
            this.RenderInspector();
            this.Notify(
                Layer?.Decal.Placement === "stamp"
                    ? "Clicks now stamp the artwork into the layer."
                    : "Clicks now place a 3D decal you can drag around.",
            );
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
        if (Path.startsWith("Environment."))
        {
            // A sky chosen from the dropdown behind the tiles brings its own rig, the same as one chosen by its face.
            if (Path === "Environment.Identifier") this.Project.Environment.Lights = null;
            if (Committed) this.RenderEnvironmentPod();
            this.Recomposite();
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
            case "isolate-layer":
                this.IsolateLayer();
                break;
            case "group-layer":
                this.GroupSelection();
                break;
            case "ungroup-layer":
                this.UngroupFolder(this.Project.Selection);
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
            case "level-layer":
                this.LevelActive();
                break;
            case "all-channels":
                this.CaptureStack(() =>
                {
                    for (const Channel of ChannelSpecification) this.SetChannelWrite(Channel.Identifier, true);
                    for (const Channel of ChannelSpecification) Layer.Enabled[Channel.Identifier] = true;
                });
                this.SyncChannelFaces();
                break;
            case "no-channels":
                this.CaptureStack(() =>
                {
                    for (const Channel of ChannelSpecification) this.SetChannelWrite(Channel.Identifier, false);
                    for (const Channel of ChannelSpecification) Layer.Enabled[Channel.Identifier] = false;
                    this.SetChannelWrite("base_color", true);
                });
                this.SyncChannelFaces();
                break;
            case "channel-shelf":
                this.ChannelShelf = !this.ChannelShelf;
                this.RenderInspector();
                return;
            case "channel-focus":
                this.ChannelFocus = this.ChannelFocus === Argument ? "" : Argument;
                this.RenderInspector();
                return;
            case "open-material":
                this.Instruments?.Show();
                this.Instruments?.ShowSection("material");
                return;
            case "open-artwork":
                this.Instruments?.Show();
                this.Instruments?.ShowSection("artwork");
                return;
            case "channel-add":
                if (!Layer.Enabled[Argument])
                {
                    this.CaptureStack(() => this.SetChannelWrite(Argument, true));
                    this.SyncChannelFaces();
                    this.ChannelFocus = Argument;
                    this.ChannelShelf = false;
                    this.Chronicle("structure", `${ChannelLabel(Argument)} added`, Layer.Name, Layer.Channels[Argument]);
                    this.Notify(`${ChannelLabel(Argument)} is now written by ${Layer.Name}.`);
                }
                break;
            case "channel-remove":
                if (Layer.Enabled[Argument])
                {
                    this.CaptureStack(() => this.SetChannelWrite(Argument, false));
                    this.SyncChannelFaces();
                    if (this.ChannelFocus === Argument) this.ChannelFocus = "";
                    this.Notify(`${ChannelLabel(Argument)} is back on the shelf.`);
                }
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
            case "spread-tiles":
                this.SpreadTiles();
                break;
            case "collapse-tiles":
                this.CollapseTiles();
                break;
            case "bake-occlusion":
                this.ScheduleOcclusion();
                this.Notify("Re-baking per-vertex occlusion.");
                break;
            case "import-mesh":
                Select("#mesh-file").click();
                break;
            case "reset-material":
                this.CaptureStack(() => (this.Project.Material = { ...DefaultProject().Material }));
                this.RenderScenePod();
                break;
            case "open-constants":
                this.ConstantsOpen = !this.ConstantsOpen;
                this.RenderScenePod();
                return;
            case "reset-stack":
                this.CaptureStack(() =>
                {
                    this.Project.Layers = DefaultStack();
                    this.Project.Selection = this.Project.Layers[this.Project.Layers.length - 1].Identifier;
                });
                break;
            //----------------------------------------------------------------------------------------------------------
            // The environment pod. A sky is picked whole — the rig it brought with it goes back to the sky's own, or
            // picking Sunset after an hour of tuning Studio's key light would arrive at a sunset lit like a studio.
            //----------------------------------------------------------------------------------------------------------
            case "pick-environment":
            {
                if (this.Project.Environment.Identifier === Argument) return;
                this.Project.Environment.Identifier = Argument;
                this.Project.Environment.Lights = null;
                this.MarkDirty();
                this.RenderEnvironmentPod();
                this.Chronicle("surface", `${EnvironmentByIdentifier[Argument]?.Label || Argument} lighting`, "environment");
                this.Notify(`${EnvironmentByIdentifier[Argument]?.Label || Argument} lighting.`);
                return;
            }
            case "toggle-light":
            {
                const Rig = this.EnsureLights();
                const Light = Rig[Number(Argument)];
                if (!Light) return;
                Light.On = Light.On === false;
                this.MarkDirty();
                this.RenderEnvironmentPod();
                this.Notify(`${LightOrdering[Number(Argument)]?.Label || "Light"} ${Light.On ? "on" : "off"}.`);
                return;
            }
            case "add-light":
            {
                const Rig = this.EnsureLights();
                const Index = Rig.findIndex((Light) => Light.On === false);
                if (Index < 0)
                {
                    this.Notify(`The rig holds ${LightOrdering.length} lights and all ${LightOrdering.length} are on.`);
                    return;
                }
                Rig[Index].On = true;
                if (!Rig[Index].Strength) Rig[Index].Strength = 2;
                this.MarkDirty();
                this.RenderEnvironmentPod();
                this.Notify(`${LightOrdering[Index].Label} light added.`);
                return;
            }
            case "reset-lights":
                this.Project.Environment.Lights = null;
                this.MarkDirty();
                this.RenderEnvironmentPod();
                this.Notify("The lights follow the environment again.");
                return;
            default:
                break;
        }
        // A pod is a panel too, and whichever one is open is quite possibly where the press came from.
        this.RenderEnvironmentPod();
        this.RenderScenePod();
    }

    // The reset button resets what the tab is showing, and the tab is the layer or the diary. The diary is not a
    // thing that can be reset to a default, so it is left alone.
    ResetInspector()
    {
        const Layer = this.ActiveLayer;
        if (this.InspectorTab === "timeline" || !Layer) return;
        const Fresh = CreateLayer(Layer.Kind, { Name: Layer.Name });
        this.CaptureStack(() =>
        {
            Object.assign(Layer, { ...Fresh, Identifier: Layer.Identifier, Name: Layer.Name });
        });
        this.AdoptChannelWrites();
        this.SyncChannelFaces();
        this.RenderInspector();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // 🔴 Two tabs, not four. Material was the card's own Material pane typed out a second time — same channels, same
    //    numbers, a panel apart — and Surface was the scene wearing a layer panel's clothes: a mesh and a UV sheet and
    //    the sky, none of which is the thing in hand. The environment moved to the viewport header where the view is
    //    chosen, the scene moved to the objects it belongs to, and what is left here is the layer and the timeline.
    //----------------------------------------------------------------------------------------------------------------------
    RenderInspector()
    {
        const Layer = this.ActiveLayer;
        if (!Layer) return;
        if (this.InspectorTab !== "timeline") this.InspectorTab = "layer";
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
        Body.innerHTML = this.InspectorTab === "timeline" ? this.TimelineInspector() : this.LayerInspector(Layer);
        Body.classList.toggle("timeline-body", this.InspectorTab === "timeline");
        FillIcons(Body);
        DressSelects(Body);
        this.RefreshThumbnails();
    }

    LayerInspector(Layer)
    {
        const Sections = [];
        if (Layer.Kind === "folder")
        {
            const Inside = LayerInside(this.Layers, Layer.Identifier);
            const Painted = Inside.filter((Entry) => Entry.Kind !== "folder").length;
            return Group({
                Title: "Folder",
                Badge: `${Inside.length} INSIDE`,
                Body: [
                    `<p class="property-hint">A folder passes through: every layer inside keeps its own blend against the
                      stack below, and the folder weighs the lot. Hide it and the whole set goes with it.</p>`,
                    SliderRow({
                        Label: "Opacity",
                        Path: "Layer.Opacity",
                        Value: Layer.Opacity,
                        Minimum: 0,
                        Maximum: 1,
                        Step: 0.01,
                        Unit: "—",
                        Hint: `Multiplies the ${Painted} painting layer${Painted === 1 ? "" : "s"} inside.`,
                    }),
                    ActionRow([
                        { Action: "isolate-layer", Label: this.Solo === Layer.Identifier ? "Show all" : "Isolate", Glyph: "focus" },
                        { Action: "ungroup-layer", Label: "Ungroup", Glyph: "up" },
                        { Action: "duplicate-layer", Label: "Duplicate", Glyph: "copy" },
                        { Action: "remove-layer", Label: "Remove", Glyph: "trash" },
                    ]),
                ].join(""),
            });
        }
        Sections.push(this.TexturePreview(Layer));
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
                    SelectRow({
                        Label: "Sheet",
                        Path: "Layer.Resolution",
                        Value: String(Layer.Resolution || 0),
                        Options: LayerResolutions.map((Size) => ({
                            Value: String(Size),
                            Label: Size ? `${Size} × ${Size}` : `Document · ${this.Project.Resolution} × ${this.Project.Resolution}`,
                        })),
                        Hint: "A detail layer can carry a bigger sheet than the document, or a backdrop a smaller one.",
                    }),
                    ActionRow([
                        { Action: "raise-layer", Label: "Raise", Glyph: "up" },
                        { Action: "lower-layer", Label: "Lower", Glyph: "down" },
                        { Action: "duplicate-layer", Label: "Duplicate", Glyph: "copy" },
                        { Action: "remove-layer", Label: "Remove", Glyph: "trash" },
                    ]),
                    ActionRow([
                        { Action: "isolate-layer", Label: this.Solo === Layer.Identifier ? "Show all" : "Isolate", Glyph: "focus" },
                        { Action: "group-layer", Label: Layer.Parent ? "Group again" : "Group", Glyph: "folder" },
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

        // 🔴 The drawing, where it lands and the ink it lands in are all three on the card, with a preview of the
        //    artwork as it will arrive. What is left for the panel is the list of placements — a list of things the
        //    layer holds, like the stack itself — and the one choice the card has nowhere to put: whether a mark is
        //    projected onto the model or laid flat in UV space.
        if (Layer.Kind === "decal")
        {
            const Mark = this.ActiveMark || Layer.Decal;
            const Stamping = Layer.Decal.Placement === "stamp";
            Sections.push(
                (Stamping ? "" : this.MarkList(Layer)) +
                    Group({
                        Title: "Artwork",
                        Badge: Layer.Decal.SourceKind === "text" ? "TEXT" : "SVG",
                        Body: [
                            Stamping
                                ? ""
                                : SelectRow({
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
                            `<p class="property-hint">The drawing itself, the size it lands at and the ink it is laid in are
                              on the card — three panes, opening on a preview of the artwork as it will arrive.</p>`,
                            ActionRow([{ Action: "open-artwork", Label: "Open the artwork pane", Glyph: "palette" }]),
                        ].join(""),
                    }),
            );
        }

        const Mixed = this.Integrator.PaintedLayer?.(Layer) || false;
        if (Layer.Kind === "stroke")
            Sections.push(
                Group({
                    Title: "Coverage",
                    Badge: Mixed ? "PER STROKE" : "PAINTED",
                    Body: [
                        `<p class="property-hint">Every stroke keeps the channel values that were set when it was laid
                          down. The sliders below describe the <strong>next</strong> stroke, not the ones already on the
                          layer${Mixed ? " — this layer is holding more than one set" : ""}.</p>`,
                        ActionRow([
                            { Action: "flood-layer", Label: "Flood", Glyph: "fill" },
                            { Action: "clear-layer", Label: "Clear", Glyph: "eraser" },
                        ]),
                    ].join(""),
                }),
            );

        // 🔴 A painted layer shows the list and not the numbers. What a channel lays down is the paint, and the paint
        //    is on the card — one tick and one slider, side by side, in the pane the hand is already in. The same two
        //    sliders here were a second answer to the same question, and the one further from the brush was always
        //    the one that went stale. Layers with no paint behind them — a fill, a generator, a finish — keep theirs,
        //    because for those the number IS the layer.
        const Written = ChannelSpecification.filter((Channel) => Layer.Enabled[Channel.Identifier]);
        const Painted = Layer.Kind === "stroke" || Layer.Kind === "decal";
        Sections.push(
            Group({
                Title: Layer.Kind === "stroke" ? "Channels · in hand" : "Channels",
                Badge: Mixed ? "MIXED" : `${Written.length}`,
                Body: [
                    this.ChannelChips(Layer),
                    ...(Painted ? [] : Written.map((Channel) => this.ChannelControl(Layer, Channel))),
                    Painted
                        ? `<p class="property-hint">Ticking a channel here is the same switch as the card's Material pane —
                            what each one lays down is set there, beside the paint that lays it.</p>
                           ${ActionRow([{ Action: "open-material", Label: "Open the material pane", Glyph: "palette" }])}`
                        : "",
                    Layer.Kind === "stroke"
                        ? ActionRow([{ Action: "level-layer", Label: "Apply to the whole layer", Glyph: "fill" }])
                        : "",
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
                <button class="${View === "off" ? "active" : ""}" data-action="mask-view-off" aria-pressed="${View === "off"}">Surface</button>
                <button class="${View === "isolated" ? "active" : ""}" data-action="mask-view-isolated" aria-pressed="${View === "isolated"}">Mask only</button>
            </div>
        </div>
        <p class="property-hint">Painting a mask shows the surface it is shaping — black hides the layer, white brings it
            back, and you watch it happen. Shift M looks at the mask on its own.</p>`;
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

    // Where a channel's value comes from on this layer, which is the honest answer to why editing the flat colour of a
    // decal does nothing: the artwork's tint writes that channel, not the swatch.
    ChannelOrigin(Layer, Identifier)
    {
        if (Layer.Kind === "finish")
        {
            const Role = FinishChannelRole(Identifier);
            if (Role === "driven") return { Tag: "MATERIAL", Note: "Written per texel by the material recipe." };
            if (Role === "scaled") return { Tag: "SCALES", Note: "Scales the value the material produces." };
        }
        if (Layer.Kind === "decal" && Identifier === "base_color")
            return { Tag: "DECAL TINT", Note: "The artwork is a stencil: its colour comes from the tint of each placement." };
        if (Layer.Kind === "generator" && Identifier === "base_color")
            return { Tag: "FIELD", Note: "The generator drives the coverage; this colour is what it paints with." };
        if (Layer.Kind === "stroke" && Identifier === "base_color") return { Tag: "TEXTURE", Note: "Stored per texel wherever the brush has been." };
        return { Tag: "CONSTANT", Note: "" };
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The layer's own sheet, big enough to read. The stack row carries the same read-back at 46px, which answers
    // "which layer is this"; this one answers "what is on it" — and for a decal layer it is the only place the
    // artwork can be seen where it actually lands, flattened into texture space with everything else the layer holds.
    //----------------------------------------------------------------------------------------------------------------------
    TexturePreview(Layer)
    {
        const Size = this.Integrator.LayerResolution?.(Layer) || this.Project.Resolution;
        const Kind = LayerKindByIdentifier[Layer.Kind];
        const Masked = Layer.Mask.Kind !== "none";
        // 📝 The plate is a window onto the sheet, so it is checkered like one — neutral greys, not the layer's
        //    accent, because an orange check reads as orange paint. `data-empty` is the word it says when the sheet
        //    behind it holds nothing; the thumbnail pass sets `.blank` once it has looked.
        const Empty = Layer.Kind === "fill" || Layer.Kind === "finish" ? "Painted from values" : "Nothing painted yet";
        const Plate = (Target, Caption, Note, Word) => `
            <figure class="texture-plate">
                <span class="layer-swatch plate-sheet" ${Word ? `data-empty="${Escape(Word)}"` : ""}
                      data-thumbnail="${Layer.Identifier}" data-thumbnail-size="192" data-thumbnail-target="${Target}">
                    <canvas width="192" height="192" aria-hidden="true"></canvas>${Icon(Kind.Glyph)}
                </span>
                <figcaption><b>${Escape(Caption)}</b><span>${Escape(Note)}</span></figcaption>
            </figure>`;
        return Group({
            Title: "Texture",
            Badge: `${Size}²`,
            Body: `
                <div class="texture-preview ${Masked ? "paired" : ""}">
                    ${Plate("coverage", "Sheet", "Colour and cover", Empty)}
                    ${Masked ? Plate("mask", "Mask", Layer.Mask.Invert ? "Inverted" : "White reveals") : ""}
                </div>
                <p class="property-hint">${
                    Layer.Kind === "fill" || Layer.Kind === "finish"
                        ? "This layer paints from values rather than a sheet, so there is nothing stored per texel until something is painted into it."
                        : "The layer's own sheet, read back from the card it paints on."
                }</p>`,
        });
    }

    // The chip rail from the channel panel: what the layer writes, an × that takes a channel off it, and a + that
    // opens the shelf of everything it is not writing yet.
    ChannelChips(Layer)
    {
        const Written = ChannelSpecification.filter((Channel) => Layer.Enabled[Channel.Identifier]);
        const Spare = ChannelSpecification.filter((Channel) => !Layer.Enabled[Channel.Identifier]);
        const Chip = (Channel) => `
            <span class="channel-pill ${this.ChannelFocus === Channel.Identifier ? "focused" : ""}"
                  data-action="channel-focus" data-argument="${Channel.Identifier}" title="${Escape(Channel.Hint)}">
                <i style="--chip:${ChannelTint(Channel.Identifier)}"></i>${Escape(Channel.Label)}
                <b class="pill-remove" data-action="channel-remove" data-argument="${Channel.Identifier}"
                   role="button" tabindex="0" aria-label="Stop writing ${Escape(Channel.Label)}">${Icon("close")}</b>
            </span>`;
        const Shelf = this.ChannelShelf
            ? `<div class="channel-shelf">
                   ${
                       Spare.length
                           ? Spare.map(
                                 (Channel) => `
                           <button class="channel-pill ghost" data-action="channel-add" data-argument="${Channel.Identifier}"
                                   title="${Escape(Channel.Hint)}">
                               <i style="--chip:${ChannelTint(Channel.Identifier)}"></i>${Escape(Channel.Label)}
                           </button>`,
                             ).join("")
                           : `<p class="property-hint">Every channel is already on this layer.</p>`
                   }
               </div>`
            : "";
        return `
        <div class="channel-chips">
            <div class="chip-head">
                <span>${Icon("layers")}CHANNELS<b>${Written.length}</b></span>
                <button class="chip-clear" data-action="no-channels" ${Written.length ? "" : "disabled"}>Clear all</button>
            </div>
            <div class="chip-rail">
                ${Written.map(Chip).join("")}
                <button class="channel-pill plus ${this.ChannelShelf ? "open" : ""}" data-action="channel-shelf"
                        aria-expanded="${this.ChannelShelf ? "true" : "false"}" aria-label="Add a channel"
                        title="Add a channel">${Icon("plus")}</button>
            </div>
            ${Shelf}
            ${
                Written.length
                    ? ""
                    : `<p class="property-hint">Nothing is written yet. The first stroke adds base colour on its own, or add a channel above.</p>`
            }
        </div>`;
    }

    ChannelControl(Layer, Channel)
    {
        const Value = Layer.Channels[Channel.Identifier];
        const Origin = this.ChannelOrigin(Layer, Channel.Identifier);
        const Focused = this.ChannelFocus === Channel.Identifier;
        const Control =
            Origin.Tag === "MATERIAL"
                ? `<p class="channel-note">${Escape(Origin.Note)}</p>`
                : Channel.Kind === "color"
                  ? ColourRow({ Label: Channel.Label, Path: `Channels.${Channel.Identifier}`, Value, Hint: Origin.Note })
                  : SliderRow({
                        Label: Channel.Label,
                        Path: `Channels.${Channel.Identifier}`,
                        Value,
                        Minimum: 0,
                        Maximum: 1,
                        Step: 0.01,
                        Unit: "—",
                        Hint: Origin.Note,
                    });
        return `
        <details class="channel-control enabled ${Focused ? "focused" : ""}" data-channel-control="${Channel.Identifier}" ${Focused ? "open" : ""}>
            <summary>
                <i style="--chip:${ChannelTint(Channel.Identifier)}"></i>
                <span class="channel-name">${Escape(Channel.Label)}</span>
                <code>${Escape(Channel.Identifier)}</code>
                <span class="channel-origin">${Origin.Tag}</span>
            </summary>
            <div class="channel-body">${Control}</div>
        </details>`;
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
                    <span class="mark-note">${
                        Mark.Placed === false
                            ? "waiting for a click on the model"
                            : `${Mark.Mode === "plane" ? "UV" : "projected"} · ${(Mark.Mode === "plane" ? Mark.Plane.Size : Mark.Transform.Size).toFixed(2)}${Mark.Mode === "plane" ? "uv" : "m"}`
                    }</span>
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
    Chronicle(Kind, Title, Detail = "", Colour = null, Preview = null)
    {
        const Span = this.SurfaceRecord?.Tiles?.Columns || 1;
        const Event = this.Timeline.Record({ Kind, Title, Detail, Colour, Preview: Preview && { Span, ...Preview } });
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
        const Rows = this.TimelineDays(Events);
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
                ${Events.length ? Rows : `<p class="timeline-empty">Nothing has happened yet. Paint something.</p>`}
                <div class="timeline-foot">
                    <button class="button" data-action="document-save">${Icon("download")}Save ${DocumentExtension}</button>
                    <button class="button" data-action="document-open">${Icon("folder")}Open</button>
                </div>
            </div>`;
    }

    // Events are read as a diary: a heading per day, the newest at the top, each entry carrying a thumbnail of what it
    // did in texture space. The thumbnail is drawn from the numbers on the event, so it costs no memory at all.
    TimelineDays(Events)
    {
        const Timeline = this.Timeline;
        const Today = new Date().toDateString();
        const Yesterday = new Date(Date.now() - 86400000).toDateString();
        const Days = [];
        Events.forEach((Event, Index) =>
        {
            const Day = new Date(Event.Stamp).toDateString();
            const Last = Days[Days.length - 1];
            if (Last && Last.Day === Day) Last.Entries.push({ Event, Index });
            else Days.push({ Day, Entries: [{ Event, Index }] });
        });
        return Days.reverse()
            .map((Group_) =>
            {
                const Moment = new Date(Group_.Entries[0].Event.Stamp);
                const Label =
                    Group_.Day === Today
                        ? "Today"
                        : Group_.Day === Yesterday
                          ? "Yesterday"
                          : Moment.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
                const Rows = Group_.Entries.slice()
                    .reverse()
                    .map(({ Event, Index }) =>
                    {
                        const Kind = EventByKind[Event.Kind];
                        const Spent = Index >= Timeline.Head;
                        return `
                    <li class="timeline-event ${Spent ? "undone" : ""} ${Index === Timeline.Head - 1 ? "head" : ""}"
                        data-action="timeline-visit" data-argument="${Event.Identifier}" style="--event-accent:${Kind.Accent}">
                        <span class="event-node"></span>
                        ${this.EventPreview(Event)}
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
                    })
                    .join("");
                return `
                <section class="timeline-day">
                    <header class="day-head">
                        <span>${Escape(Label)}</span>
                        <i></i>
                        <b>${Group_.Entries.length}</b>
                    </header>
                    <ol class="timeline-rail">${Rows}</ol>
                </section>`;
            })
            .join("");
    }

    // The sheet, drawn at forty pixels: the tile grid, then whatever the event did on it.
    EventPreview(Event)
    {
        const Preview = Event.Preview;
        const Tint = Event.Colour ? ToHex(Event.Colour) : EventByKind[Event.Kind].Accent;
        const Span = Preview?.Span || 1;
        const Grid = Array.from({ length: Math.max(Span - 1, 0) }, (Ignored, Index) =>
        {
            const At = ((Index + 1) / Span) * 40;
            return `<path d="M${At} 0V40M0 ${At}H40" class="preview-grid" />`;
        }).join("");
        const Mark = () =>
        {
            if (!Preview) return `<circle cx="20" cy="20" r="5.5" fill="${Tint}" opacity="0.9" />`;
            if (Preview.Shape === "flood") return `<rect x="1" y="1" width="38" height="38" rx="5" fill="${Tint}" opacity="0.55" />`;
            if (Preview.Shape === "tile" && Number.isFinite(Preview.Tile))
            {
                const Column = (Preview.Tile - 1001) % 10;
                const Row = Math.floor((Preview.Tile - 1001) / 10);
                const Size = 40 / Span;
                return `<rect x="${Column * Size}" y="${40 - (Row + 1) * Size}" width="${Size}" height="${Size}" fill="${Tint}" opacity="0.5" />`;
            }
            if (Preview.Shape === "path" && Preview.Points?.length)
            {
                const Points = Preview.Points.map((Point) => `${(Point[0] * 40).toFixed(1)},${((1 - Point[1]) * 40).toFixed(1)}`).join(" ");
                const Width = Math.max(1.4, Math.min((Preview.Size?.[0] || 0.08) * 26, 9));
                return Preview.Points.length === 1
                    ? `<circle cx="${(Preview.Points[0][0] * 40).toFixed(1)}" cy="${((1 - Preview.Points[0][1]) * 40).toFixed(1)}" r="${(Width / 2).toFixed(1)}" fill="${Tint}" />`
                    : `<polyline points="${Points}" fill="none" stroke="${Tint}" stroke-width="${Width.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />`;
            }
            if (Preview.Shape === "stamp" && Preview.Coordinate)
            {
                const X = Preview.Coordinate[0] * 40;
                const Y = (1 - Preview.Coordinate[1]) * 40;
                const Width = Math.max((Preview.Size?.[0] || 0.12) * 40, 5);
                const Height = Math.max((Preview.Size?.[1] || 0.12) * 40, 5);
                return `
                <g transform="translate(${X.toFixed(1)} ${Y.toFixed(1)}) rotate(${-(Preview.Rotation || 0)})">
                    <rect x="${(-Width / 2).toFixed(1)}" y="${(-Height / 2).toFixed(1)}" width="${Width.toFixed(1)}" height="${Height.toFixed(1)}"
                          rx="1.5" fill="${Tint}" opacity="0.45" stroke="${Tint}" stroke-width="1.1" />
                    <path d="M${(-Width / 2).toFixed(1)} 0H${(Width / 2).toFixed(1)}M0 ${(-Height / 2).toFixed(1)}V${(Height / 2).toFixed(1)}"
                          stroke="${Tint}" stroke-width="0.7" opacity="0.8" />
                </g>`;
            }
            return `<circle cx="20" cy="20" r="5.5" fill="${Tint}" opacity="0.9" />`;
        };
        return `
        <span class="event-preview" title="${Escape(Preview?.Shape || "event")} in texture space">
            <svg viewBox="0 0 40 40" aria-hidden="true">
                <rect x="0.5" y="0.5" width="39" height="39" rx="4" class="preview-sheet" />
                ${Grid}
                ${Mark()}
            </svg>
        </span>`;
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

    // A document carries its paint. Every layer image the device is holding is read back, encoded as a PNG and written
    // into the file beside the record that describes it, so reopening a project returns the strokes and not merely the
    // recipe that framed them. Blank sheets are passed over and the whole set is budgeted, because a .pigment file is
    // still something a browser has to hold in one string.
    async SaveDocument()
    {
        if (this.Saving) return;
        this.Saving = true;
        this.SetStatus("Reading the paint back", "busy");
        let Written = { Sheets: [], Bytes: 0, Skipped: 0 };
        try
        {
            Written = await CollectSheets(this.Integrator, this.Layers, { Report: (Text) => this.SetStatus(Text, "busy") });
        }
        catch (Refusal)
        {
            this.Notify(`The paint could not be read back: ${Refusal.message}. Writing the record alone.`);
        }
        const Tally = SheetTally(Written.Sheets);
        const Detail = Tally.Count
            ? `${Tally.Count} sheet${Tally.Count === 1 ? "" : "s"} · ${Tally.Megabytes.toFixed(1)} MB`
            : "no painted sheets";
        EmitProject(this.Project, this.Camera.Serialise(), this.Timeline.Serialise(), Written.Sheets);
        this.Chronicle("export", "Document written", `${this.Project.Name}${DocumentExtension} · ${Detail}`);
        this.MarkClean();
        this.SetStatus("Ready", "ready");
        this.Saving = false;
        this.Notify(
            `${this.Project.Name}${DocumentExtension} written · ${Detail}` +
                (Written.Skipped ? ` · ${Written.Skipped} left out, past the ${(SheetAllowance / 1024 / 1024) | 0} MB allowance` : ""),
        );
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Surface setup · the scene and the material under every layer.
    //
    // 🔴 This is not the layer in hand, so it is not in the panel that is about the layer in hand. The mesh, the UV
    //    sheet it unwraps onto and the OpenPBR constants the whole document sits on are set once and then left for
    //    hours, which is exactly the shape of a thing that belongs behind a button on the objects it describes
    //    rather than in a tab the painter has to walk past on the way to the mask.
    //----------------------------------------------------------------------------------------------------------------------
    MaterialSetup()
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

    SceneSetup()
    {
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
                              { Action: "spread-tiles", Label: "Spread across tiles", Glyph: "grid" },
                              { Action: "collapse-tiles", Label: "Collapse to 1001", Glyph: "focus" },
                          ]),
                          ActionRow([
                              { Action: "import-mesh", Label: "Import OBJ", Glyph: "folder" },
                              { Action: "bake-occlusion", Label: "Re-bake AO", Glyph: "rotate" },
                          ]),
                      ].join("")
                    : "",
            }),
            Group({
                Title: "Base material",
                Badge: "OPENPBR",
                Open: false,
                Body: `<p class="property-hint">The constants every layer sits on: what the surface is before a single
                        stroke is laid, and what an untouched channel exports as.</p>
                       ${ActionRow([{ Action: "open-constants", Label: this.ConstantsOpen ? "Hide the constants" : "Show the constants", Glyph: "material" }])}
                       ${this.ConstantsOpen ? `<div class="pod-nested">${this.MaterialSetup()}</div>` : ""}`,
            }),
            Group({
                Title: "Stack",
                Badge: `${Record ? Record.Triangles.toLocaleString() : 0} TRIS`,
                Open: false,
                Body: ActionRow([{ Action: "reset-stack", Label: "Reset to the default stack", Glyph: "layers" }]),
            }),
        ].join("");
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Environment · the light the surface is being read under.
    //
    // 🔴 Lighting is a property of looking, not of the layer, so it sits with the other two things that decide what
    //    the viewport shows — which channel is on screen and which way the mirror runs — rather than three tabs away
    //    in a panel about a layer. Four skies with their own faces on them, because "Sunset" as a word in a dropdown
    //    tells you nothing about what your metal is about to look like under it.
    //----------------------------------------------------------------------------------------------------------------------
    EnvironmentBody()
    {
        const Environment = this.Project.Environment;
        const Preset = EnvironmentByIdentifier[Environment.Identifier] || EnvironmentOrdering[0];
        const Rig = Environment.Lights || DefaultLights(Environment.Identifier);
        const Lit = Rig.filter((Light) => Light.On !== false).length;
        const Sky = (Entry) => `linear-gradient(${ToHex(Entry.Zenith)}, ${ToHex(Entry.Horizon)} 62%, ${ToHex(Entry.Ground)} 63%)`;
        const Tile = (Entry) => `
            <button class="sky-tile ${Entry.Identifier === Environment.Identifier ? "active" : ""}"
                    data-action="pick-environment" data-argument="${Entry.Identifier}"
                    aria-pressed="${Entry.Identifier === Environment.Identifier}" title="Key ${Entry.Key} · fill ${Entry.Fill} · rim ${Entry.Rim}">
                <span class="sky-face" style="background:${Sky(Entry)}"><i style="left:${(Environment.Rotation / 360) * 100}%"></i></span>
                <b>${Escape(Entry.Label)}</b>
            </button>`;
        const LightRow = (Light, Index) =>
        {
            const Order = LightOrdering[Index];
            const On = Light.On !== false;
            return `
            <div class="light-row ${On ? "" : "dim"}">
                <div class="light-head">
                    <span class="light-dot" style="--chip:${ToHex(Order.Tint)}"></span>
                    <b>${Escape(Order.Label)}</b><span>${Escape(Order.Note)}</span>
                    <button class="chip-button" data-action="toggle-light" data-argument="${Index}" aria-pressed="${On}"
                            title="${On ? "Switch this light off" : "Switch this light on"}">${On ? "On" : "Off"}</button>
                </div>
                ${
                    On
                        ? [
                              SliderRow({ Label: "Strength", Path: `Environment.Lights.${Index}.Strength`, Value: Light.Strength, Minimum: 0, Maximum: 16, Step: 0.1, Unit: "" }),
                              SliderRow({ Label: "Swing", Path: `Environment.Lights.${Index}.Swing`, Value: Light.Swing, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" }),
                              SliderRow({ Label: "Height", Path: `Environment.Lights.${Index}.Elevation`, Value: Light.Elevation, Minimum: -90, Maximum: 90, Step: 1, Unit: "°" }),
                          ].join("")
                        : ""
                }
            </div>`;
        };
        return [
            Group({
                Title: "Environment",
                Badge: Preset.Label.toUpperCase(),
                Body: `
                    <div class="sky-rail">${EnvironmentOrdering.map(Tile).join("")}</div>
                    ${SliderRow({ Label: "Rotation", Path: "Environment.Rotation", Value: Environment.Rotation, Minimum: 0, Maximum: 360, Step: 1, Unit: "°" })}
                    ${SliderRow({ Label: "Intensity", Path: "Environment.Intensity", Value: Environment.Intensity, Minimum: 0, Maximum: 4, Step: 0.01, Unit: "×" })}
                    ${SliderRow({ Label: "Exposure", Path: "Environment.Exposure", Value: Environment.Exposure, Minimum: -4, Maximum: 4, Step: 0.01, Unit: "EV" })}
                    ${ToggleRow({ Label: "Show background", Path: "Environment.Background", Value: Environment.Background, Hint: "Off paints the viewport flat and keeps the lighting." })}`,
            }),
            Group({
                Title: "Lights",
                Badge: `${Lit} OF ${LightOrdering.length}`,
                Body: `
                    ${Rig.map(LightRow).join("")}
                    ${ActionRow([
                        { Action: "add-light", Label: Lit < LightOrdering.length ? "Add a light" : "The rig is full", Glyph: "plus" },
                        { Action: "reset-lights", Label: "Follow the sky", Glyph: "rotate" },
                    ])}
                    <p class="property-hint">Three lights hang in front of the environment — the shading pass carries three,
                        so the rig says three. Until one is touched they are the sky's own key, fill and rim, and
                        <em>Follow the sky</em> hands them back.</p>`,
            }),
        ].join("");
    }

    // Both pods are the inspector's rows in another window, so they are filled the way the inspector body is — and a
    // pod redrawn under the hand keeps the groups that hand opened and the place it had scrolled to.
    DressPod(Pod, Markup)
    {
        if (!Pod || Pod.hidden) return;
        const Body = Pod.querySelector(".pod-body");
        if (!Body) return;
        const Folded = new Map(
            [...Body.querySelectorAll("details[data-group]")].map((Entry) => [Entry.dataset.group, Entry.open]),
        );
        const Place = Body.scrollTop;
        Body.innerHTML = Markup;
        for (const Entry of Body.querySelectorAll("details[data-group]"))
            if (Folded.has(Entry.dataset.group)) Entry.open = Folded.get(Entry.dataset.group);
        FillIcons(Body);
        DressSelects(Body);
        Body.scrollTop = Place;
    }

    RenderEnvironmentPod()
    {
        this.DressPod(Select("#environment-pod"), this.EnvironmentBody());
    }

    RenderScenePod()
    {
        this.DressPod(Select("#scene-pod"), this.SceneSetup());
    }

    // 🔴 One opener for every pod in the editor. Three buttons that each remembered to close the other two would be
    //    three chances to forget, and the one that forgot would leave a panel floating over the viewport.
    ShowPopover(Name, Open)
    {
        const Pods = { brush: "#brush-pod-button", environment: "#environment-button", scene: "#scene-button" };
        for (const [Key, Opener] of Object.entries(Pods))
        {
            const Pod = Select(`#${Key === "brush" ? "brush-pod" : `${Key}-pod`}`);
            const Button = Select(Opener);
            if (!Pod || !Button) continue;
            const Wanted = Key === Name && Open;
            Pod.hidden = !Wanted;
            Button.setAttribute("aria-expanded", String(Wanted));
            Button.classList.toggle("active", Wanted);
            if (!Wanted) continue;
            if (Key === "environment") this.RenderEnvironmentPod();
            if (Key === "scene") this.RenderScenePod();
            if (Key === "brush") this.SyncBrushControls();
            this.PlacePopover(Pod, Button, Key === "brush");
        }
    }

    // Above the button when the button is at the foot of the screen, below it when it is at the head, and never off
    // the edge in either direction.
    PlacePopover(Pod, Button, Above)
    {
        const Anchor = Button.getBoundingClientRect();
        const Height = Pod.offsetHeight || 352;
        const Width = Pod.offsetWidth || 300;
        const Room = typeof window === "undefined" ? 1280 : window.innerWidth || 1280;
        const Left = Math.max(12, Math.min(Anchor.left, Room - Width - 12));
        Pod.style.left = `${Math.round(Left)}px`;
        Pod.style.top = `${Math.round(Above ? Anchor.top - 8 - Height : Anchor.bottom + 8)}px`;
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
        Select("#export-size").innerHTML = ExportSizes.map(
            (Entry) => `<option value="${Entry.Size}">${Entry.Label}</option>`,
        ).join("");
        Select("#export-size").addEventListener("change", () => this.DescribeExport());
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
        const Size = Number(Select("#export-size").value) || 0;
        const Written = Size || this.Project.Resolution;
        Select("#export-note").textContent =
            `${Preset.Note} Writing ${Written} × ${Written}` +
            (Size && Size !== this.Project.Resolution ? ` — resampled from the ${this.Project.Resolution}² document.` : ".");
        Select("#export-list").innerHTML = Preset.Channels.map(
            (Identifier) => `<span>${Escape(ChannelByIdentifier[Identifier]?.Label || Identifier)}</span>`,
        ).join("");
        Select("#export-scale").textContent = `${this.Project.Resolution} × ${this.Project.Resolution}`;
        const Stack = Select("#export-stack");
        if (Stack)
            Stack.textContent =
                this.Layers.length === 1
                    ? this.FlattenedFrom
                        ? `Flattened from ${this.FlattenedFrom}`
                        : "1 layer"
                    : `${this.Layers.length} layers`;
    }

    async RunExport()
    {
        const Preset = Select("#export-preset").value;
        const Size = Number(Select("#export-size").value) || 0;
        Select("#export-confirm").disabled = true;
        try
        {
            const Result = await EmitTextureSet(
                this.Integrator,
                this.Project,
                Preset,
                (Message) =>
                {
                    Select("#export-progress").textContent = Message;
                },
                Size,
            );
            Select("#export-progress").textContent = `${Result.Count} images written as ${Result.Preset} at ${Result.Size}².`;
            this.Chronicle("export", `Exported ${Result.Preset}`, `${Result.Count} images`);
            this.Notify(`${Result.Count} images and one descriptor written.`);
            this.Dirty = false;
            Select("#dirty-indicator")?.classList.add("clean");
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
            this.Documents.Synchronise(Record.Name);
            this.Revisions.Clear();
            this.Integrator.Configure(Record.Resolution);
            if (Document_.Camera) this.Camera.Restitute(Document_.Camera);
            this.RebuildSurface(true);
            this.InvalidateDecals();
            // The paint the file carried goes back onto the layers it came off, at whatever resolution those layers now
            // ask for. A version 1 document has none, and says so by being silent rather than by failing.
            let Paint = { Restored: 0, Refused: 0 };
            if (Document_.Sheets?.length)
            {
                this.SetStatus("Laying the paint back down", "busy");
                Paint = await ApplySheets(this.Integrator, this.Layers, Document_.Sheets);
                this.Recomposite();
                this.SetStatus("Ready", "ready");
            }
            if (!this.Timeline.Restitute(Document_.Timeline))
                this.Timeline.Clear({ Kind: "document", Title: "Document opened", Detail: File.name });
            else this.Chronicle("document", "Document opened", File.name);
            this.RenderStack();
            this.RenderObjects();
            this.RenderInspector();
            const Unread = Paint.Refused ? `, ${Paint.Refused} unreadable` : "";
            const Paintwork = Paint.Restored
                ? ` · ${Paint.Restored} painted sheet${Paint.Restored === 1 ? "" : "s"}${Unread}`
                : "";
            this.Notify(
                `${File.name} opened · ${Record.Layers.length} layers · ${this.Timeline.Branches.length} branch${this.Timeline.Branches.length === 1 ? "" : "es"}${Paintwork}.`,
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
            // 🔴 Tab is read BEFORE the field guard, and it is the only key that is. Everything else belongs to
            //    whatever holds focus — a hex code being typed owns its own letters — but Tab's default action is
            //    to walk focus to the next focusable thing, and with the card open that is the next row of its
            //    rail. Letting the browser have it looked exactly like the card stepping through its own panes:
            //    the focus ring crawled down the rail, one press per row, and the card never went away.
            if (Event.key === "Escape")
            {
                this.EndSizing();
                this.ShowPopover("", false);
            }
            const Tabbing = Event.key === "Tab" || Event.code === "Tab";
            if (Tabbing && !Event.ctrlKey && !Event.metaKey && !Event.altKey && !document.querySelector("dialog[open]"))
            {
                Event.preventDefault();
                Event.stopPropagation();
                // A field inside the card keeps focus when the card is put away, and then swallows the next
                // keystroke that was meant for the editor. Let go of it on the way out.
                if (this.Instruments?.Root?.contains(document.activeElement)) document.activeElement.blur?.();
                this.Instruments?.Toggle();
                return;
            }
            // The target is the window itself when nothing holds focus, so matches() cannot be assumed.
            if (TypingInto(Event.target)) return;
            if (Event.code === "Space") this.SpaceHeld = true;
            const Key = Event.key.toLowerCase();
            if ((Event.ctrlKey || Event.metaKey) && Key === "z")
            {
                Event.preventDefault();
                if (Event.shiftKey) this.Redo();
                else this.Undo();
                return;
            }
            if ((Event.ctrlKey || Event.metaKey) && Key === "g")
            {
                Event.preventDefault();
                this.GroupSelection();
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
                const Wanted = Tools[Number(Key) - 1];
                if (!this.ToolsForLayer().includes(Wanted))
                {
                    this.Notify(`${Wanted} is not a tool for a ${LayerKindByIdentifier[this.ActiveLayer?.Kind]?.Label.toLowerCase() || "layer"}.`);
                    return;
                }
                this.SetTool(Wanted, true);
                return;
            }
            // Delete removes the selected layer. Backspace does the same, because half the world reaches for that key
            // first and a stack that keeps at least one layer cannot be emptied by a mistake anyway.
            if (Key === "delete" || Key === "backspace")
            {
                Event.preventDefault();
                this.RemoveLayer();
                return;
            }
            if (Key === "[") this.NudgeRadius(0.84);
            if (Key === "]") this.NudgeRadius(1.19);
            if (Key === "m" && Event.shiftKey) this.SetMaskView(this.MaskView === "off" ? "isolated" : "off");
            else if (Key === "m") Select("#mask-toggle").click();
            if (Key === "i")
            {
                this.IsolateLayer();
                return;
            }
            if (Key === "b") this.SetBrowserState(this.BrowserState === "closed" ? "half" : "closed");
            if (Key === "f") Select("#focus-button").click();
            // 🔴 `S` is size — the brush's, not the gradient's. Held down it hands the head to the mouse: drag out
            //    to grow it, back in to shrink it, with the ring on the canvas showing the answer. The ramp moved to
            //    `G`, the letter of the thing it scales, and symmetry sits on `Y` where it went when the ramp came.
            if (Key === "s")
            {
                if (!Event.repeat) this.BeginSizing();
                return;
            }
            if (Key === "g")
            {
                this.ScaleRamp(Event.shiftKey ? 1.19 : 0.84);
                return;
            }
            if (Key === "y") Select("#mirror-button").click();
            if (Key === "w" && this.ViewMode === "plane")
            {
                Select("#wire-button")?.click();
                return;
            }
            if (Key === "u" && this.ViewMode === "plane")
            {
                Select("#tiles-button")?.click();
                return;
            }
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
            if (Event.key?.toLowerCase?.() === "s") this.EndSizing();
        });
        // A key held while the window goes away never gets its keyup, and a brush left mid-size would follow the
        // pointer around the next time it crossed the canvas.
        window.addEventListener("blur", () => this.EndSizing());
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
        const Placing = this.Tool === "decal" && Layer?.Kind === "decal";
        const Artwork = Layer?.Kind === "decal" && Layer.Decal.SourceKind === "text" ? "Text" : "Decal";
        const ToolLabel = Placing ? `${Artwork} ${Layer.Decal.Placement === "stamp" ? "stamp" : "placement"}` : Tool?.Label;
        const Axis = this.Projection.Brush.Symmetry;
        const Mirror =
            Axis === "none" ? "" : Axis === "radial" ? ` · radial ×${this.Projection.Brush.Sectors}` : ` · mirror ${Axis.toUpperCase()}`;
        Select("#viewport-subtitle").textContent =
            this.ViewMode === "plane"
                ? `Texture space · ${DisplayOrdering.find((Entry) => Entry.Identifier === this.Display)?.Label}`
                : `${ToolLabel} → ${Target} · ${LayerSummary(Layer)}${Mirror}`;
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
        this.SyncGizmo();
        const Options = {
            Environment: this.Project.Environment,
            Material: this.Project.Material,
            Display: DisplayIndex(this.Display),
            MaskLayer: this.Project.Selection,
            CheckerScale: 16,
            Symmetry: this.Projection.Brush.Symmetry,
            Sectors: this.Projection.Brush.Sectors,
            Placement: this.Placement,
            Cursor:
                this.Tool === "brush" || this.Tool === "eraser"
                    ? this.Cursor && { ...this.Cursor, ...this.PreviewInk() }
                    : null,
        };
        if (this.ViewMode === "plane")
            this.Integrator.RenderPlane({
                ...Options,
                Pan: this.PlanePan,
                Zoom: this.PlaneZoom,
                CursorInk: this.PreviewInk().Ink,
                CursorPreview: this.Tool === "brush" || this.Tool === "eraser" ? this.PreviewInk().Preview : 0,
                Cursor: this.Tool === "brush" || this.Tool === "eraser" ? this.PlaneCursor : null,
            });
        else this.Integrator.RenderViewport(this.Camera, Options);
        requestAnimationFrame(() => this.Advance());
    }
}

// What a brush control says on its pill: centimetres for size, whole numbers for the counted ones, two places for the
// rest. The slider carries the value; this only decides how it reads.
const BrushReadout = (Key, Value) =>
    Key === "Radius" ? `${(Value * 100).toFixed(1)}` : Key === "Sectors" || Key === "Facing" ? String(Math.round(Value)) : Value.toFixed(2);

const ChannelLabel = (Identifier) => ChannelSpecification.find((Channel) => Channel.Identifier === Identifier)?.Label || Identifier;

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

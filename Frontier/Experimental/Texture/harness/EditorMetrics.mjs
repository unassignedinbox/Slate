//============================================================================================================================================
// 🧪 EditorMetrics.mjs — drives the editor itself: the stack, folders, masks, the tools and the decals on the surface
//============================================================================================================================================
// Run with `npm run drive`. CardMetrics.mjs reads the instrument card; this one reads everything around it. The rule is
// the same: nothing is called that the interface does not expose, and what is asserted is what a hand would see — rows
// in the stack, classes on buttons, the command stream the device was actually handed.
//============================================================================================================================================

import { CreateWindow, CreateTally, Settle } from "./DeviceHost.mjs";
import { SanitiseLayer } from "../src/LayerSpecification.js";

const { Window, Faults } = CreateWindow();
const { Check, Report } = CreateTally("the editor");

const { TexturePanel } = await import("../src/TexturePanel.js");
const Panel = new TexturePanel();
Panel.Commence();
await Settle(Window, 6);

const Find = (Selector) => Window.document.querySelector(Selector);
const All = (Selector) => [...Window.document.querySelectorAll(Selector)];
const Press = (Element_, Kind = "click") => Element_.dispatchEvent(new Window.MouseEvent(Kind, { bubbles: true }));
const Type = (Key, Extra = {}) => Window.dispatchEvent(new Window.KeyboardEvent("keydown", { key: Key, bubbles: true, ...Extra }));
const Rows = () => All("#layer-stack [data-layer]").map((Row) => Row.dataset.layer);
const Draws = () => Panel.Integrator.Device.Log.filter((Entry) => Entry.Name === "drawArrays").length;

Check("the editor boots clean", Panel.Integrator.Ready && !Faults.length, Faults.map(String).join(" · "));

//--------------------------------------------------------------------------------------------------------------------------
// The stack, as the panel draws it.
//--------------------------------------------------------------------------------------------------------------------------
Check("the opening stack is three layers", Panel.Layers.length === 3, String(Panel.Layers.length));
Check("and every one of them has a row", Rows().length === 3, String(Rows().length));
Check("the stack is drawn top first", Rows()[0] === Panel.Layers[Panel.Layers.length - 1].Identifier);
Check("the count in the heading agrees", Find("#layer-count").textContent === "3", Find("#layer-count").textContent);

Panel.AddLayer("stroke");
Check("adding a layer adds a row", Rows().length === 4, String(Rows().length));
Check("and selects it", Panel.ActiveLayer.Kind === "stroke");
const Painted = Panel.ActiveLayer.Identifier;
Panel.DuplicateLayer();
Check("duplicating gives a copy", Panel.Layers.length === 5 && Panel.ActiveLayer.Identifier !== Painted);
Check("named as one", Panel.ActiveLayer.Name.endsWith("copy"), Panel.ActiveLayer.Name);
Panel.RemoveLayer();
Check("removing takes it away again", Panel.Layers.length === 4);
Check("and leaves the selection somewhere real", !!Panel.LayerByIdentifier(Panel.Project.Selection));

// Order. Raise and lower move the row the hand is on, and the compositor's order follows the array.
const Before = Panel.Layers.map((Layer) => Layer.Identifier).join(",");
Panel.ShiftLayer(-1);
Check("lowering a layer moves it", Panel.Layers.map((Layer) => Layer.Identifier).join(",") !== Before);
Panel.ShiftLayer(1);
Check("and raising it puts it back", Panel.Layers.map((Layer) => Layer.Identifier).join(",") === Before);

// Folders. A folder holds layers; its row sits above what it holds and it weighs them.
Panel.SelectLayer(Painted);
Panel.GroupSelection();
const Folder = Panel.Layers.find((Layer) => Layer.Kind === "folder");
Check("a selection can be grouped", !!Folder);
Check("and what it holds names it", Panel.LayerByIdentifier(Painted).Parent === Folder.Identifier);
Check("the folder is drawn above its children", Rows().indexOf(Folder.Identifier) < Rows().indexOf(Painted));
Panel.UngroupFolder(Folder.Identifier);
Check("ungrouping lets them go", !Panel.LayerByIdentifier(Painted).Parent);
Check("and takes the folder with it", !Panel.Layers.some((Layer) => Layer.Identifier === Folder.Identifier));

// Filters and search read the same stack rather than a second copy of it.
Press(Find('[data-layer-filter="decal"]'));
Check("a filter narrows the stack", Rows().length === 0, String(Rows().length));
Press(Find('[data-layer-filter="all"]'));
Check("and lets it back", Rows().length === Panel.Layers.length);
Find("#layer-search").value = "nothing like this";
Find("#layer-search").dispatchEvent(new Window.Event("input", { bubbles: true }));
Check("a search that matches nothing shows nothing", Rows().length === 0);
Find("#layer-search").value = "";
Find("#layer-search").dispatchEvent(new Window.Event("input", { bubbles: true }));
Check("and clearing it shows everything", Rows().length === Panel.Layers.length);

//--------------------------------------------------------------------------------------------------------------------------
// Undo. Every edit above went through the stack recorder, so one step back has to be exactly one edit.
//--------------------------------------------------------------------------------------------------------------------------
const Standing = Panel.Layers.length;
Panel.AddLayer("fill");
Check("a fill layer lands", Panel.Layers.length === Standing + 1);
Panel.Undo();
Check("and undo takes it off", Panel.Layers.length === Standing, String(Panel.Layers.length));
Panel.Redo();
Check("redo puts it back", Panel.Layers.length === Standing + 1);
Panel.Undo();

//--------------------------------------------------------------------------------------------------------------------------
// Masks belong to the layer, and painting a mask is still painting.
//--------------------------------------------------------------------------------------------------------------------------
Panel.SelectLayer(Painted);
const Layer = Panel.LayerByIdentifier(Painted);
Check("a new paint layer has no mask", Layer.Mask.Kind === "none", Layer.Mask.Kind);
Panel.SetPaintTarget("mask");
Check("aiming at the mask adds one", Layer.Mask.Kind === "stroke", Layer.Mask.Kind);
Check("the layer says so", Layer.Target === "mask", String(Layer.Target));
Check("and the brush agrees", Panel.Projection.Brush.Target === "mask");
const ColourRow = () => Panel.Instruments.Sections().find((Entry) => Entry.Key === "colour");
Check("the card offers the value ramp, not a hue", ColourRow()?.Label === "Value", ColourRow()?.Label);
Check("and it sits after the head and the hand", Panel.Instruments.Sections()[0].Key === "shape", Panel.Instruments.Sections()[0].Key);
Panel.SetPaintTarget("coverage");
Check("and aiming back at the paint lets go of it", Panel.Projection.Brush.Target === "coverage" && Layer.Target === "coverage");
Check("the mask it made is kept", Layer.Mask.Kind === "stroke", "a mask is not thrown away when the aim moves off it");

//--------------------------------------------------------------------------------------------------------------------------
// The tools. A tool reached for by hand is respected; one the layer asked for is not.
//--------------------------------------------------------------------------------------------------------------------------
Type("3");
Check("the keyboard reaches the tools", Panel.Tool === "eraser", Panel.Tool);
Check("and the rail shows which", Find('[data-tool="eraser"]').classList.contains("active"));
// An eraser chosen by hand on a paintable layer is kept when the next paintable layer comes along.
Panel.SetTool("eraser", true);
Panel.AddLayer("fill");
Check("an eraser reached for by hand is respected", Panel.Tool === "eraser", Panel.Tool);
Panel.AddLayer("svg");
await Settle(Window, 3);
const Decal = Panel.ActiveLayer;
Check("but a decal layer stamps", Panel.Tool === "decal", Panel.Tool);
Panel.SelectLayer(Painted);
Check("and the brush comes back for paint", Panel.Tool === "brush" || Panel.Tool === "eraser", Panel.Tool);
Panel.SelectLayer(Decal.Identifier);

const Radius = Panel.Projection.Brush.Radius;
Type("]");
const Wider = Panel.Projection.Brush.Radius;
Check("brackets size the head", Wider > Radius, `${Radius} → ${Wider}`);
Type("[");
Check("both ways", Panel.Projection.Brush.Radius < Wider, String(Panel.Projection.Brush.Radius));

// 🔴 S is size, and it is held rather than tapped: the hand drags the edge of the head out to grow it and back in
//    to shrink it. It used to scale the gradient, which is the one thing a hand pressing S is never asking for.
const Surface = Window.document.querySelector("#surface-canvas");
const Point = (Kind, X, Y) =>
    Surface.dispatchEvent(new Window.MouseEvent(Kind, { bubbles: true, clientX: X, clientY: Y, pointerId: 9, pressure: 0 }));
const Held = Panel.Projection.Brush.Radius;
const Span = Panel.Gradient.Span;

Point("pointermove", 400, 300);
Type("s");
Check("holding S takes hold of the size", !!Panel.Sizing, String(!!Panel.Sizing));
// 🔴 The ring's centre is one radius to the side, so the cursor starts on its rim with room to drag inwards.
const Centre = Panel.Sizing.Anchor;
const Reach = Panel.Sizing.Reach;
Check("the cursor starts on the rim of the ring", Math.abs(Math.hypot(400 - Centre[0], 300 - Centre[1]) - Reach) < 0.001, `${Reach}`);
Check("nothing has moved yet", Panel.Projection.Brush.Radius === Held);

// 🔴 The regression the hand hit: a first twitch INWARDS used to set the direction, and from then on every pull
//    outwards shrank the brush. Distance from the centre cannot invert itself, so the twitch is just a twitch.
Point("pointermove", 400 - Reach * 0.4, 300);
Check("a twitch towards the centre shrinks it", Panel.Projection.Brush.Radius < Held, `${Held} → ${Panel.Projection.Brush.Radius}`);
const Rim = Panel.Sizing.Pixels;     // the rim as it was when the key went down, which is what the drag is measured from
Point("pointermove", 400 + Reach, 300);
const Grown = Panel.Projection.Brush.Radius;
Check("and pulling away from it grows it, whatever the twitch said", Grown > Held, `${Held} → ${Grown}`);
// The rim is under the cursor: a hundred pixels further out is a hundred pixels more radius.
Check(
    "a pixel of travel is a pixel of radius",
    Math.abs(Panel.RadiusPixels() - (Rim + Reach)) < 0.5,
    `${Panel.RadiusPixels().toFixed(2)} vs ${(Rim + Reach).toFixed(2)}`,
);
Check("and the ring shows it", Window.document.querySelector("#brush-ghost")?.classList.contains("sizing"));

// Up or down is the same question: it is a distance from the centre, not an axis.
Point("pointermove", Centre[0], 300 - Reach * 2);
Check("straight up the screen reads the same as straight out", Math.abs(Panel.Projection.Brush.Radius - Grown) < Grown * 0.001, String(Panel.Projection.Brush.Radius));

// A button held down through the drag is the other way people do this.
Point("pointerdown", Centre[0] + Reach * 3, 300);
Check("a press during the drag paints nothing", Panel.Painting !== true);
Point("pointermove", Centre[0] + Reach * 3, 300);
Check("and the drag carries on under it", Panel.Projection.Brush.Radius > Grown, String(Panel.Projection.Brush.Radius));
Check("nothing was laid down by it", Panel.Painting !== true);
Point("pointerup", Centre[0] + Reach * 3, 300);
Check("the button coming up does not end it", !!Panel.Sizing);
Point("pointermove", 400, 300);
Check("back on the rim is back where it began", Math.abs(Panel.Projection.Brush.Radius - Held) < Held * 0.02, String(Panel.Projection.Brush.Radius));
Window.dispatchEvent(new Window.KeyboardEvent("keyup", { key: "s", bubbles: true }));
Check("letting go of S lets go of the size", !Panel.Sizing);
Check("and takes the ring away", Window.document.querySelector("#brush-ghost")?.hidden === true);
Point("pointermove", 500, 300);
const Settled = Panel.Projection.Brush.Radius;
Check("the pointer no longer drags it", Settled === Panel.Projection.Brush.Radius);
Check("leaving the gradient alone", Panel.Gradient.Span === Span, `${Span} → ${Panel.Gradient.Span}`);

const Stretched = Panel.Projection.Brush.Radius;
Type("g", { shiftKey: true });
const Longer = Panel.Gradient.Span;
Check("the gradient scales on G instead", Longer > Span, `${Span} → ${Longer}`);
Type("g");
Check("and back", Panel.Gradient.Span < Longer, `${Longer} → ${Panel.Gradient.Span}`);
Check("without touching the head", Panel.Projection.Brush.Radius === Stretched);

//--------------------------------------------------------------------------------------------------------------------------
// Decals on the surface: a mark is placed, handled, and carries the artwork's ink.
//--------------------------------------------------------------------------------------------------------------------------
Panel.SetTool("decal", true);
Decal.Decal.Placement = "project";
const Canvas = Find("#surface-canvas");
const At = (Kind, X, Y) =>
    Canvas.dispatchEvent(new Window.MouseEvent(Kind, { bubbles: true, clientX: X, clientY: Y, button: 0, pointerId: 3 }));
const Marks = () => Decal.Decal.Marks.length;
const Opening = Marks();
At("pointerdown", 480, 270);
At("pointerup", 480, 270);
await Settle(Window, 3);
Check("clicking the model places the artwork", Marks() === Opening + 1, `${Opening} → ${Marks()}`);
Check("and the placement is the one in hand", !!Decal.Decal.Selection);
const Mark = Decal.Decal.Marks.find((Entry) => Entry.Identifier === Decal.Decal.Selection);
Check("a placement knows where it is", Array.isArray(Mark.Transform.Position));
Check("the gizmo is drawn for it", !Find("#decal-gizmo").hidden);

// The ink: a gradient is in the image, so what the composite is handed is the rasterised artwork.
const Uploads = () => Panel.Integrator.Device.Log.filter((Entry) => Entry.Name === "texImage2D").length;
const SentBefore = Uploads();
Decal.Decal.Ramp.Carry = true;
Decal.Decal.Colorise = false;
for (const Entry of Decal.Decal.Marks) Entry.Colorise = false;
await Panel.RefreshDecal(Decal);
await Settle(Window, 3);
Check("re-inking a decal uploads the artwork again", Uploads() > SentBefore, `${SentBefore} → ${Uploads()}`);
Check("and the card keeps a copy for its preview", Panel.DecalImages.has(Decal.Identifier));
// The fade is in the image: the rasteriser was handed the ramp and painted it through the artwork's own coverage.
const Printed = Panel.DecalImages.get(Decal.Identifier).getContext("2d").Record;
Check("the gradient was painted into the artwork", Printed.filter((Entry) => Entry[0] === "stop").length > 8, String(Printed.length));
Check("as a fade across it", Printed.some((Entry) => Entry[0] === "linear"));
Decal.Decal.Ramp.Fit = "out";
await Panel.RefreshDecal(Decal);
Check("and radially when it is asked to", Panel.DecalImages.get(Decal.Identifier).getContext("2d").Record.some((Entry) => Entry[0] === "radial"));

// The preview: the card draws that same image, so what is on the card is what the surface is about to wear.
const Sheets = [...Window.document.querySelectorAll(`canvas[data-decal="${Decal.Identifier}"]`)];
Check("the card carries a preview sheet for the artwork", Sheets.length > 0, String(Sheets.length));
const Shown = Sheets.map((Sheet) => Sheet.getContext("2d").Record);
Check("squared off against a chequer", Shown.every((Entry) => Entry.filter((Call) => Call[0] === "fillRect").length > 20));
Check("with the rasterised artwork drawn over it", Shown.every((Entry) => Entry.some((Call) => Call[0] === "drawImage" && Call[1] === 1024)));

//--------------------------------------------------------------------------------------------------------------------------
// Texture space. The same tools, the same layer, and the squares that must not eat the press.
//--------------------------------------------------------------------------------------------------------------------------
Type("x");
Check("X flattens the model to its sheet", Panel.ViewMode === "plane", Panel.ViewMode);
Check("the viewport says so", Find(".viewport").classList.contains("plane-view"));
Panel.SetTool("brush", true);
Panel.SelectLayer(Painted);
Check("the UDIM squares hand the pointer back", !Find("#uv-tiles").classList.contains("arranging"));
const BeforePaint = Draws();
At("pointerdown", 430, 250);
At("pointermove", 500, 300);
At("pointerup", 500, 300);
Check("and a stroke in texture space draws", Draws() > BeforePaint, `${BeforePaint} → ${Draws()}`);
Check("the stroke closed itself", !Panel.Projection.Active);
Type("u");
Check("U takes the tiles away entirely", Find("#uv-tiles").hidden);
Type("u");
Type("x");
Check("and X goes back to the model", Panel.ViewMode === "surface");

//--------------------------------------------------------------------------------------------------------------------------
// What leaves the editor. A document carries the stack, the paint and the ink home.
//--------------------------------------------------------------------------------------------------------------------------
const Record = Panel.CaptureDocument();
Check("a document is captured", !!Record?.Project?.Layers?.length);
const { ComposeDocument, ReadDocument } = await import("../src/ExportSequence.js");
const Written = JSON.stringify(ComposeDocument(Record.Project, Record.Camera));
const Read = ReadDocument(Written);
Check("it is written and read back", Read.Project.Layers.length === Record.Project.Layers.length);
const Kept = Read.Project.Layers.find((Entry) => Entry.Kind === "decal");
Check("with the decal's gradient still on it", Kept.Decal.Ramp.Carry === true);
Check("and the document's name", Read.Project.Name === Panel.Project.Name, Read.Project.Name);

//--------------------------------------------------------------------------------------------------------------------------
// The panels, after the move. Two tabs in the inspector, the environment in the viewport header beside the channel it
// is lighting, and the scene setup on the objects it builds.
//--------------------------------------------------------------------------------------------------------------------------
Check(
    "the inspector is the layer and the diary, and nothing else",
    All("#inspector-tabs [data-tab]").map((Button) => Button.dataset.tab).join(",") === "layer,timeline",
    All("#inspector-tabs [data-tab]").map((Button) => Button.dataset.tab).join(","),
);
Panel.AddLayer("stroke");
await Settle(Window, 3);
const Plates = () => All("#inspector-body .texture-plate [data-thumbnail]");
Check("a painted layer opens on its own sheet", Plates().length === 1, String(Plates().length));
Check("read back big, not at the stack's size", Plates()[0].dataset.thumbnailSize === "192", Plates()[0].dataset.thumbnailSize);
Check("and showing the sheet rather than the mask", Plates()[0].dataset.thumbnailTarget === "coverage");
Check(
    "the numbers the card already carries are not typed out twice",
    !Find("#inspector-body .channel-control"),
);
Check("but the channels it writes are listed", All("#inspector-body .chip-rail .channel-pill:not(.plus)").length === 2);
Panel.OnInspectorAction("mask-add-black");
await Settle(Window, 3);
Check("adding a mask puts the mask beside the sheet", Plates().length === 2, String(Plates().length));
Check("and the second plate is the mask", Plates()[1].dataset.thumbnailTarget === "mask");

// The environment pod: four skies with faces on them, and a rig of three lights behind them.
Press(Find("#environment-button"));
await Settle(Window, 2);
Check("the header button opens the environment", !Find("#environment-pod").hidden);
Check(
    "it sits beside the channel dropdown",
    Find("#channel-select").closest(".dropdown").nextElementSibling?.id === "environment-button",
    Find("#channel-select").closest(".dropdown").nextElementSibling?.id,
);
Check("four skies, each wearing its own face", All("#environment-pod .sky-tile").length === 4);
Check("the one in use is lit", All("#environment-pod .sky-tile.active").length === 1);
Press(Find('#environment-pod [data-argument="sunset"]'));
await Settle(Window, 2);
Check("picking one lights the surface with it", Panel.Project.Environment.Identifier === "sunset");
Check("and the rig goes with the sky", Panel.Project.Environment.Lights === null);
Check("three lights hang in front of it", All("#environment-pod .light-row").length === 3);
Press(Find('#environment-pod [data-action="toggle-light"]'));
await Settle(Window, 2);
Check("switching one off writes the rig out", Array.isArray(Panel.Project.Environment.Lights));
Check("with that light dark", Panel.Project.Environment.Lights[0].On === false);
Check("and the sky's own strength remembered", Panel.Project.Environment.Lights[0].Strength === 9);
Press(Find('#environment-pod [data-action="add-light"]'));
await Settle(Window, 2);
Check("adding a light lights the dark one", Panel.Project.Environment.Lights[0].On === true);
Press(Find('#environment-pod [data-action="reset-lights"]'));
await Settle(Window, 2);
Check("and the rig can be handed back to the sky", Panel.Project.Environment.Lights === null);

// The scene setup: everything the layer panel used to carry that was never about a layer.
Press(Find("#scene-button"));
await Settle(Window, 2);
Check("the objects heading opens the surface setup", !Find("#scene-pod").hidden);
Check("and the environment pod stands down", Find("#environment-pod").hidden);
Check(
    "the mesh, the sheet it unwraps onto, the constants under it and the stack",
    All("#scene-pod details[data-group]").map((Entry) => Entry.dataset.group).join(",") === "Object,UV tiles,Base material,Stack",
    All("#scene-pod details[data-group]").map((Entry) => Entry.dataset.group).join(","),
);
Press(Find('#scene-pod [data-action="open-constants"]'));
await Settle(Window, 2);
Check("the OpenPBR constants are one press in", All("#scene-pod .pod-nested details[data-group]").length > 6);
Type("Escape");
await Settle(Window, 1);
Check("Escape puts the pod away", Find("#scene-pod").hidden);

//--------------------------------------------------------------------------------------------------------------------------
// One switch, two faces: the card's channel ticks and the inspector's chips are the same choice.
//--------------------------------------------------------------------------------------------------------------------------
// The brush is aimed back at the layer's content: a mask is one channel, and the pane says so instead of listing them.
if (Panel.Projection.Brush.Target === "mask") Type("m");
await Settle(Window, 2);
const Sheet = Panel.Instruments;
Sheet.Show();
Sheet.ShowSection("material");
await Settle(Window, 2);
const Face = () => Sheet.Root.querySelector("[data-pane]");
if (Face().querySelector("[data-every]")) Press(Face().querySelector("[data-every]"));
await Settle(Window, 2);
const Tick = (Key) =>
    [...Face().querySelectorAll(".channel-pick")].find((Button) => Button.querySelector(".channel-note").textContent === Key);
Check("the card lists every channel it can write", !!Tick("base_metalness"));
Press(Tick("base_metalness"));
await Settle(Window, 2);
Check("ticking one puts it on the layer", Panel.ActiveLayer.Enabled.base_metalness === true);
Check("and a chip arrives in the inspector", All("#inspector-body .chip-rail [data-argument='base_metalness']").length > 0);
Press(All("#inspector-body .pill-remove").find((Button) => Button.dataset.argument === "base_metalness"));
await Settle(Window, 2);
Check("dropping the chip takes the tick off the card", !Tick("base_metalness").classList.contains("on"));
Check("and the stroke stops writing it", Panel.ChannelWrites.base_metalness === false);
Panel.SelectLayer(Panel.Layers[0].Identifier);
await Settle(Window, 2);
Check(
    "a different layer hands the brush its own channels",
    Panel.ChannelWrites.base_metalness === Boolean(Panel.ActiveLayer.Enabled.base_metalness),
);

//--------------------------------------------------------------------------------------------------------------------------
// The mask, looked at. There are two ways now — the surface the mask is shaping, and the mask on its own — because the
// third was a pink wash over the only thing worth looking at.
//--------------------------------------------------------------------------------------------------------------------------
Panel.SelectLayer(Panel.Layers.find((Layer) => Layer.Kind === "stroke").Identifier);
if (Panel.ActiveLayer.Mask.Kind === "none") Panel.AddMask("black", false);
await Settle(Window, 2);
const Views = All("#mask-view [data-mask-view]").map((Button) => Button.dataset.maskView);
Check("the viewport offers two mask views", Views.join(",") === "off,isolated", Views.join(","));
Check("and no wash among them", !Views.includes("overlay"));
Panel.SetMaskView("isolated");
await Settle(Window, 2);
Check("the mask on its own is the mask display", Panel.Display === "mask", Panel.Display);
Panel.SetMaskView("off");
await Settle(Window, 2);
Check("and leaving it puts the surface back", Panel.Display !== "mask", Panel.Display);
Type("M", { shiftKey: true });
await Settle(Window, 2);
Check("⇧M looks at the mask", Panel.MaskView === "isolated", Panel.MaskView);
Type("M", { shiftKey: true });
await Settle(Window, 2);
Check("and ⇧M again looks away", Panel.MaskView === "off", Panel.MaskView);

// Aiming the brush at the mask paints the mask; it does not change what is on screen, because the thing being judged
// is the surface the mask is shaping.
const Watching = Panel.Display;
if (Panel.Projection.Brush.Target !== "mask") Type("m");
await Settle(Window, 2);
Check("painting the mask leaves the view alone", Panel.Display === Watching, `${Watching} → ${Panel.Display}`);
if (Panel.Projection.Brush.Target === "mask") Type("m");
await Settle(Window, 2);

//--------------------------------------------------------------------------------------------------------------------------
// The texture plate. A window onto the sheet reads as a window: no layer accent, and a word when there is nothing on it.
//--------------------------------------------------------------------------------------------------------------------------
Panel.RenderInspector();
Panel.DrawThumbnails();
const Plate = () => Find(".texture-preview .plate-sheet");
Check("the layer's sheet is on a plate", !!Plate());
Check("the plate takes no colour from the layer", !Plate().style.getPropertyValue("--swatch"), Plate().getAttribute("style") || "");
Check("and says what is on it when nothing is", Plate().dataset.empty === "Nothing painted yet", Plate().dataset.empty);
Check("which it only says once it has looked", Plate().classList.contains("blank"));
const Reading = Panel.Integrator.PreviewLayer.bind(Panel.Integrator);
Panel.Integrator.PreviewLayer = (Layer, Target, Size) =>
{
    const Preview = Reading(Layer, Target, Size);
    if (Preview?.Pixels) Preview.Pixels[3] = 255;
    return Preview;
};
Panel.DrawThumbnails();
Check("and stops the moment one texel is inked", !Plate().classList.contains("blank"));
Panel.Integrator.PreviewLayer = Reading;

//--------------------------------------------------------------------------------------------------------------------------
// The theme, read as text: the inspector's cards stand apart, and the plate is checkered in greys rather than in the
// layer's accent. jsdom applies no stylesheet, so the sheet itself is the only honest thing to assert against.
//--------------------------------------------------------------------------------------------------------------------------
const { readFileSync } = await import("node:fs");
const Theme = readFileSync(new URL("../src/ThemeSpecification.css", import.meta.url), "utf8");
const Spacing = [...Theme.matchAll(/\.property-group \{[^}]*margin-bottom:\s*(\d+)px/g)].map((Found) => Number(Found[1]));
Check("the inspector's cards are given room to stand apart", Spacing.length > 0 && Math.max(...Spacing) >= 16, Spacing.join(" · "));
Check("the plate is checkered in greys", /\.layer-swatch\.plate-sheet \{[^}]*background-color: #131313/.test(Theme));
Check("and the read-back over it carries no checker of its own", /\.layer-swatch\.plate-sheet canvas \{[^}]*background-image: none/.test(Theme));
Check("the empty plate speaks in the word it was given", Theme.includes("content: attr(data-empty)"));

//--------------------------------------------------------------------------------------------------------------------------
// One brush, read two ways. The pod and the card are the same instrument seen twice, so taking one out of the library
// has to re-read both — and what the instrument owns, the pod shows without offering.
//--------------------------------------------------------------------------------------------------------------------------
Panel.TakeInstrument("brush-filbert");
await Settle(Window, 2);
const Slider = (Key) => Find(`[data-brush="${Key}"]`);
Check("the pod reads the instrument that was just taken", Number(Slider("Hardness").value) === 0.46, Slider("Hardness").value);
Check("including the flow, which is opacity through flow", Math.abs(Number(Slider("Flow").value) - 0.67) < 0.011, Slider("Flow").value);
Check("and the size it was shipped at", Math.abs(Number(Slider("Radius").value) - 0.12) < 1e-6, Slider("Radius").value);
Check(
    "what the instrument owns is shown and not offered",
    All('.pod-field[data-owned="instrument"]').every((Field) => Field.classList.contains("is-locked") && Field.querySelector("input").disabled),
    All('.pod-field[data-owned="instrument"]').map((Field) => Field.querySelector("input").disabled).join(","),
);
Check("the size is still the painter's", Slider("Radius").disabled === false);
Check("and the pod says whose settings they are", (Find("#brush-lock").textContent || "").toLowerCase().includes("filbert"), Find("#brush-lock").textContent);

// A size is the instrument's too: tuning any of its own controls rebuilds the brush, and a size kept only on the
// slider snapped back to the one the library shipped.
Panel.SetRadius(0.05);
Panel.TuneInstrument("Wetness", 70);
await Settle(Window, 2);
Check("the size survives the instrument being tuned", Math.abs(Panel.Projection.Brush.Radius - 0.05) < 1e-9, String(Panel.Projection.Brush.Radius));
Check("and the medium's reach is measured from the head in hand", Panel.Projection.Brush.Media.Reach < 1.3, String(Panel.Projection.Brush.Media.Reach));

// The pod's own size slider is the same door: it used to configure the brush straight, leaving the instrument and
// its medium behind.
const Head = Slider("Radius");
Head.value = "0.03";
Head.dispatchEvent(new Window.Event("input", { bubbles: true }));
await Settle(Window, 2);
Check("the pod's size reaches the instrument", Math.abs(Panel.Instrument.Settings.Size - 3) < 1e-9, String(Panel.Instrument.Settings.Size));
Check("and the brush with it", Math.abs(Panel.Projection.Brush.Radius - 0.03) < 1e-9, String(Panel.Projection.Brush.Radius));
Panel.TuneInstrument("Wetness", 40);
Check("so tuning the instrument cannot take it back", Math.abs(Panel.Projection.Brush.Radius - 0.03) < 1e-9, String(Panel.Projection.Brush.Radius));

// Altering the medium by hand is what hands the raw sliders back.
Panel.SetMedia({ Bristles: 30 });
await Settle(Window, 2);
Check(
    "an altered instrument stops owning them",
    All('.pod-field[data-owned="instrument"]').every((Field) => !Field.classList.contains("is-locked")),
);

//--------------------------------------------------------------------------------------------------------------------------
// A stroke is a path, not a pile of dabs: each segment keeps the ground between its own ends and the last one is
// sealed, or every texel is painted by the dozens of dabs that reach it and the medium is averaged away.
//--------------------------------------------------------------------------------------------------------------------------
const Headings = [];
const Stamped = Panel.Integrator.Stamp.bind(Panel.Integrator);
Panel.Integrator.Stamp = (Layer, Options) => { Headings.push(Options); return Stamped(Layer, Options); };
Panel.TakeInstrument("brush-round");
const Hit = { Position: [0, 0, 0], Normal: [0, 1, 0], Coordinate: [0.5, 0.5], Triangle: 0 };
const Walk = (X) => ({ ...Hit, Position: [X, 0, 0], Coordinate: [0.5 + X * 0.1, 0.5] });
const Target = Panel.PaintTargetLayer();
Panel.StampSurface(Target, Panel.Projection.Begin(Hit, { Time: 0 }));
for (let Step = 1; Step <= 4; Step += 1)
{
    const Segment = Panel.Projection.Extend(Walk(Step * 0.05), { Time: Step * 16 });
    if (Segment) Panel.StampSurface(Target, Segment);
}
Check("the first dab of a stroke has nothing behind it", Headings[0]?.Before?.[3] === 0, JSON.stringify(Headings[0]?.Before));
const Followed = Headings.find((Options) => Options.Before?.[3] === 1);
Check("every dab after it knows which way the one before ran", !!Followed, String(Headings.length));
Check("and knows it as a direction", !!Followed && Math.abs(Math.hypot(...Followed.Before.slice(0, 3)) - 1) < 1e-6);
Check("none of them is a cap while the hand is down", Headings.every((Options) => !Options.Cap));
Panel.SealStroke();
Check("lifting the hand seals the far end", Headings.at(-1)?.Cap === true, JSON.stringify(Headings.at(-1)?.Cap));
Check("and seals it with the same dab", Headings.at(-1)?.Start?.[0] === Headings.at(-2)?.Start?.[0]);
Check("sealing twice seals nothing", (Panel.SealStroke(), Headings.at(-1)?.Cap === true));
Panel.Integrator.Stamp = Stamped;
Panel.Projection.End();

//--------------------------------------------------------------------------------------------------------------------------
// Generators on the mask. The catalogue is drawn as a shelf of marks, the stack under it behaves like the layer list,
// and the readings that need the model measured say so rather than quietly drawing nothing.
//--------------------------------------------------------------------------------------------------------------------------
Panel.AddLayer("stroke");
const Shaped = Panel.ActiveLayer;
Panel.RenderInspector();
Check("the inspector offers a generator section", !!Find('[data-group="Mask generators"]'));
Check("and it opens with the catalogue, not a dropdown", All(".field-chip").length >= 20, String(All(".field-chip").length));
Check("grouped into families", All(".field-family").length === 4, String(All(".field-family").length));
Check("every chip wears a mark of its own", All(".field-chip svg").length === All(".field-chip").length);
Check("nothing is on the stack to begin with", !All(".field-row").length && !!Find(".field-empty"));

const Add = (Kind) => Press(Find(`.field-chip[data-argument="${Kind}"]`));
Add("fbm");
Check("picking one off the shelf puts it on the stack", Shaped.Mask.Generators.length === 1, String(Shaped.Mask.Generators.length));
Check("and gives the layer the mask it needs to do anything", Shaped.Mask.Kind === "stroke", Shaped.Mask.Kind);
Check("the first one replaces rather than multiplies into nothing", Shaped.Mask.Generators[0].Combine === "overwrite");
Check("a row is drawn for it", All(".field-row").length === 1);
Check("it is the one being edited", !!Find(".field-row.selected") && !!Find(".field-editor"));
Check("noise alone never asks for the model", !Find(".field-measure"));
Check("and the sheet it solved went up to the device", !!Panel.Integrator.LayerImages.get(Shaped.Identifier)?.Sheet);

Add("dust");
Check("a second generator stacks on top", Shaped.Mask.Generators.length === 2);
Check("and multiplies into what is under it", Shaped.Mask.Generators[1].Combine === "multiply");
Check("dust reads the model, so the model gets measured", !!Panel.Measured, String(Panel.MeasureMilliseconds));
Check("the measurement names its islands", Panel.Measured.Islands > 0, String(Panel.Measured.Islands));
Check("and the faces it was taken from", Panel.Measured.Triangles === Panel.SurfaceRecord.Indices.length / 3);
Check("the section says what it measured", (Find('[data-group="Mask generators"]').textContent || "").includes("island"));

const Solved = Panel.SolveLayerSheet(Shaped);
Check("the solved sheet is the size it says", Solved.Size === Panel.SheetResolution && Solved.Values.length === Solved.Size ** 2);
Check("and is not one flat value", new Set([...Solved.Values].map((Value) => Math.round(Value * 32))).size > 3);

Press(Find('.field-row .icon-button[data-action="field-visible"]'));
Check("an eye on a row takes it out of the solve", Shaped.Mask.Generators[0].Enabled === false);
Press(Find('.field-row .icon-button[data-action="field-visible"]'));
Check("and puts it back", Shaped.Mask.Generators[0].Enabled === true);

const Order = Shaped.Mask.Generators.map((Entry) => Entry.Kind).join(",");
Press(All('.field-row .icon-button[data-action="field-lower"]')[0]);
Check("a generator can be moved down the stack", Shaped.Mask.Generators.map((Entry) => Entry.Kind).join(",") !== Order);
Press(All('.field-row .icon-button[data-action="field-raise"]')[1]);
Check("and back up", Shaped.Mask.Generators.map((Entry) => Entry.Kind).join(",") === Order);

// Selections. A face mask is the one generator that cannot be set up from the inspector alone.
Add("faces");
Check("a face selection asks for faces rather than sliders", !!Find(".field-pick"));
Press(Find('[data-action="field-pick"]'));
Check("picking is a mode the viewport goes into", Panel.PickingFaces && Find("#viewport").classList.contains("picking-faces"));
const Middle = { button: 0, clientX: 480, clientY: 270, shiftKey: false };
Panel.PickFaceAt({ ...Middle, shiftKey: false });
const Picker = Shaped.Mask.Generators.find((Entry) => Entry.Kind === "faces");
Check("a click on the model picks the face under it", Picker.Marks.length === 1, JSON.stringify(Picker.Marks));
Panel.PickFaceAt({ ...Middle, shiftKey: true });
Check("and shift takes it away again", Picker.Marks.length === 0);
Type("Escape");
Check("Escape leaves the mode", !Panel.PickingFaces);

const Stacked = Shaped.Mask.Generators.length;
Press(Find('.field-row .icon-button[data-action="field-remove"]'));
Check("a generator can be taken off the stack", Shaped.Mask.Generators.length === Stacked - 1);
while (Shaped.Mask.Generators.length) Press(Find('.field-row .icon-button[data-action="field-remove"]'));
Check("emptying the stack drops the sheet", !Panel.Integrator.LayerImages.get(Shaped.Identifier)?.Sheet);
Check("and the empty note comes back", !!Find(".field-empty"));

// A stack has to survive the journeys a layer makes: duplicated, saved, reopened, undone.
Add("dust");
Add("wear");
Panel.DuplicateLayer();
const Copied = Panel.ActiveLayer;
Check("a duplicated layer brings its stack", Copied.Mask.Generators.length === 2 && Copied !== Shaped);
Check("and solves a sheet of its own", !!Panel.Integrator.LayerImages.get(Copied.Identifier)?.Sheet);
Copied.Mask.Generators[0].Weight = 0.25;
Check("whose entries are its own, not the original's", Shaped.Mask.Generators[0].Weight === 1);

const Filed = JSON.parse(JSON.stringify({ Layers: Panel.Layers }));
const Reopened = SanitiseLayer(Filed.Layers.find((Layer) => Layer.Identifier === Copied.Identifier));
Check("a document round trip keeps the stack", Reopened.Mask.Generators.length === 2, String(Reopened.Mask.Generators.length));
Check("and keeps what was set on it", Reopened.Mask.Generators[0].Weight === 0.25);
Check("and keeps the order it was in", Reopened.Mask.Generators.map((Entry) => Entry.Kind).join(",") === Copied.Mask.Generators.map((Entry) => Entry.Kind).join(","));
Panel.RemoveLayer();

Report();
process.exit(process.exitCode || 0);

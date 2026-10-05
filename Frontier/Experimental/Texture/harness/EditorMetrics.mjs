//============================================================================================================================================
// 🧪 EditorMetrics.mjs — drives the editor itself: the stack, folders, masks, the tools and the decals on the surface
//============================================================================================================================================
// Run with `npm run drive`. CardMetrics.mjs reads the instrument card; this one reads everything around it. The rule is
// the same: nothing is called that the interface does not expose, and what is asserted is what a hand would see — rows
// in the stack, classes on buttons, the command stream the device was actually handed.
//============================================================================================================================================

import { CreateWindow, CreateTally, Settle } from "./DeviceHost.mjs";

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
Check("anchored where the key went down", Panel.Sizing.Anchor[0] === 400 && Panel.Sizing.Anchor[1] === 300);
Point("pointermove", 480, 300);
const Grown = Panel.Projection.Brush.Radius;
Check("dragging out grows the head", Grown > Held, `${Held} → ${Grown}`);
Check("and the ring shows it", Window.document.querySelector("#brush-ghost")?.classList.contains("sizing"));
Point("pointermove", 320, 300);
Check("dragging back in shrinks it past where it started", Panel.Projection.Brush.Radius < Held, `${Held} → ${Panel.Projection.Brush.Radius}`);
Check("nothing is painted while the head is being sized", Panel.Painting !== true);
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

Report();
process.exit(process.exitCode || 0);

//============================================================================================================================================
// 🧪 CardMetrics.mjs — drives the real editor in a headless window and reads the card back the way a hand would
//============================================================================================================================================
// Run with `npm run drive`. Everything here goes through the published surface of the panel: the rail is read out of the
// DOM, the panes are opened by clicking their rows, and the controls are pressed rather than called.
//============================================================================================================================================

import { CreateWindow, CreateTally, Settle } from "./DeviceHost.mjs";

const { Window, Faults } = CreateWindow();
const { Check, Report } = CreateTally("the card");

const { TexturePanel } = await import("../src/TexturePanel.js");
const Panel = new TexturePanel();
Panel.Commence();
await Settle(Window, 6);

Check("the editor boots", !!Panel.Integrator, Faults.map((Fault) => String(Fault)).join(" · "));

//--------------------------------------------------------------------------------------------------------------------------
// The header. One name, on the tab, and no band of empty chrome under it.
//--------------------------------------------------------------------------------------------------------------------------
Check("there is no second name bar", !Window.document.querySelector(".document-bar"));
Check("and no field holding a copy of the name", !Window.document.querySelector("#document-name"));
const Tab = () => Window.document.querySelector(".document-tab.active");
Check("the tab names the document", Tab()?.querySelector(".document-label")?.textContent === Panel.Project.Name, Tab()?.textContent?.trim());
Check("the unsaved dot rides on it", !!Tab()?.querySelector("#dirty-indicator"));
Check("and starts clean", Tab().querySelector("#dirty-indicator").classList.contains("clean"));
Panel.MarkDirty();
Check("marking the document lights it", !Tab().querySelector("#dirty-indicator").classList.contains("clean"));
Panel.MarkClean();

// Renaming through the tab is the only way in, so it has to reach the record the exporter reads.
const Field = Tab().querySelector(".document-rename");
Field.hidden = false;
Field.value = "Foundry crate";
Panel.Documents.Rename(Field);
Check("renaming the tab renames the document", Panel.Project.Name === "Foundry crate", Panel.Project.Name);
Check("and the strip redraws with it", Tab().querySelector(".document-label").textContent === "Foundry crate");

//--------------------------------------------------------------------------------------------------------------------------
// Texture space. The UDIM squares are elements over the canvas: while a tool that marks is in hand they must not take
// the press, or the brush paints a grid of divs instead of the sheet.
//--------------------------------------------------------------------------------------------------------------------------
Panel.SetViewMode("plane");
const Tiles = () => Window.document.querySelector("#uv-tiles");
Panel.SetTool("brush", true);
Check("a brush in texture space leaves the tiles alone", !Tiles().classList.contains("arranging"));
Panel.SetTool("eraser", true);
Check("so does an eraser", !Tiles().classList.contains("arranging"));
Panel.SetTool("orbit", true);
Check("orbit takes them back", Tiles().classList.contains("arranging"));
Check("and the foot says which it is", Window.document.querySelector("#tile-hint")?.textContent?.includes("move the object"));

// And the stroke itself: a press on the canvas in texture space lays paint on the layer in hand.
Panel.SetTool("brush", true);
Panel.SelectLayer(Panel.Layers.find((Layer) => Layer.Kind === "stroke").Identifier);
const Canvas = Window.document.querySelector("#surface-canvas");
const Press = (Kind, X, Y, Button = 0) =>
    Canvas.dispatchEvent(
        new Window.MouseEvent(Kind, { bubbles: true, clientX: X, clientY: Y, button: Button, pointerId: 1, pressure: 0.6 }),
    );
const Before = Panel.Integrator.Device.Log.length;
Press("pointerdown", 400, 260);
Press("pointermove", 460, 280);
Press("pointerup", 460, 280);
const Drawn = Panel.Integrator.Device.Log.slice(Before).filter((Entry) => Entry.Name === "drawArrays").length;
Check("painting in texture space puts paint down", Drawn > 0, `${Drawn} draws`);
Panel.SetViewMode("surface");

//--------------------------------------------------------------------------------------------------------------------------
// The paint card: the rail, and the library in its foot.
//--------------------------------------------------------------------------------------------------------------------------
const Card = Panel.Instruments;
Card.Show();
const Rail = () => [...Card.Root.querySelectorAll(".tool-rail [data-section]")].map((Row) => Row.dataset.section);
const Pane = () => Card.Root.querySelector("[data-pane]");
Check("the paint rail is the six grouped rows", Rail().join(",") === "colour,material,shape,grain,stroke,taper", Rail().join(","));
const Shelf = Card.Root.querySelector("[data-shelf] [data-section='library']");
Check("the library is pinned in the foot", !!Shelf);
Shelf.dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
Check("and opens on every instrument", Pane().querySelectorAll("[data-instrument]").length === 27, String(Pane().querySelectorAll("[data-instrument]").length));

Pane().querySelector("[data-instrument='marker-metallic']").dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
Check("taking the metallic marker makes the paint metal", Panel.ActiveLayer.Channels.base_metalness === 1);
Card.ShowSection("material");
Check("and the material pane shows what it lays", Pane().querySelectorAll(".channel-value").length === 2, String(Pane().querySelectorAll(".channel-value").length));

//--------------------------------------------------------------------------------------------------------------------------
// The decal card: a preview of the artwork, and three ways to ink it.
//--------------------------------------------------------------------------------------------------------------------------
Panel.AddLayer("svg");
await Settle(Window, 4);
const Decal = Panel.ActiveLayer;
Check("a decal layer is in hand", Decal.Kind === "decal", Decal.Kind);
Card.Show();
const DecalRail = () => [...Card.Root.querySelectorAll(".tool-rail [data-section]")].map((Row) => Row.dataset.section);
Check("the decal rail is its own", DecalRail().join(",") === "artwork,placement,colour,ink,material", DecalRail().join(","));

Card.ShowSection("artwork");
Check("the artwork pane opens with a preview", !!Pane().querySelector(`canvas[data-decal="${Decal.Identifier}"]`));

Card.ShowSection("ink");
Check("the ink pane shows one too", !!Pane().querySelector(`canvas[data-decal="${Decal.Identifier}"]`));
const Inks = [...Pane().querySelectorAll("[data-pick]")].map((Button) => Button.dataset.pick);
Check("and three ways to ink it", ["artwork", "flat", "gradient"].every((Name) => Inks.includes(Name)), Inks.join(","));

const Ink = (Name) => Pane().querySelector(`[data-pick="${Name}"]`).dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
Ink("gradient");
Check("the gradient arms the decal's own ramp", Decal.Decal.Ramp.Carry === true);
Check("and the flat tint stands down", Decal.Decal.Colorise === false);
Check("every placement follows it", (Decal.Decal.Marks || []).every((Mark) => Mark.Colorise === false));
Check("the strip is the decal's, not the stroke's", !!Pane().querySelector(".ramp-strip .ramp-knob"));
Check("the fits are the ones a rectangle has", ["across", "down", "out"].every((Name) => !!Pane().querySelector(`[data-pick="${Name}"]`)));

// Editing the decal's ramp must not touch the brush's.
const StrokeBefore = JSON.stringify(Panel.Gradient.Stops);
const Strip = Pane().querySelector(".ramp-strip");
Strip.dispatchEvent(new Window.MouseEvent("pointerdown", { bubbles: true, clientX: 160, clientY: 8, pointerId: 2 }));
Strip.dispatchEvent(new Window.MouseEvent("pointerup", { bubbles: true, clientX: 160, clientY: 8, pointerId: 2 }));
Check("clicking the strip adds a colour to the decal", Decal.Decal.Ramp.Stops.length === 3, String(Decal.Decal.Ramp.Stops.length));
Check("and leaves the stroke's gradient alone", JSON.stringify(Panel.Gradient.Stops) === StrokeBefore);

Card.RenderRail();
const Row = Card.Sections().find((Entry) => Entry.Key === "ink");
Check("the rail row says it is a gradient", Row.Label === "Ink gradient", Row.Label);
Check("and counts the colours", Row.Tally === "3", String(Row.Tally));

Ink("flat");
Check("one colour puts the tint back", Decal.Decal.Colorise === true && Decal.Decal.Ramp.Carry === false);
Ink("artwork");
Check("as drawn takes both off", Decal.Decal.Colorise === false && Decal.Decal.Ramp.Carry === false);
Check("the ramp it built is still there", Decal.Decal.Ramp.Stops.length === 3);

//--------------------------------------------------------------------------------------------------------------------------
// Text decals are previewed the same way, and the document carries the ink home.
//--------------------------------------------------------------------------------------------------------------------------
Card.ShowSection("artwork");
Pane().querySelector("[data-pick='text']").dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
await Settle(Window, 3);
Check("type is a source too", Decal.Decal.SourceKind === "text");
Check("and it previews", !!Pane().querySelector(`canvas[data-decal="${Decal.Identifier}"]`));

Decal.Decal.Ramp.Carry = true;
const Written = JSON.parse(JSON.stringify(Panel.CaptureDocument().Project));
const { SanitiseProject } = await import("../src/LayerSpecification.js");
const Read = SanitiseProject(Written);
const Restored = Read.Layers.find((Layer) => Layer.Kind === "decal");
Check("a saved decal keeps its ramp", Restored.Decal.Ramp.Carry === true && Restored.Decal.Ramp.Stops.length === 3);
Check("and the fit it was given", Restored.Decal.Ramp.Fit === Decal.Decal.Ramp.Fit, Restored.Decal.Ramp.Fit);

Report();
// jsdom keeps timers and a decal rasterise that will never resolve alive, so the run is ended deliberately.
process.exit(process.exitCode || 0);

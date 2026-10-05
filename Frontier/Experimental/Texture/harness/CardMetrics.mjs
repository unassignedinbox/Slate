//============================================================================================================================================
// 🧪 CardMetrics.mjs — drives the real editor in a headless window and reads the card back the way a hand would
//============================================================================================================================================
// Run with `npm run drive`. Everything here goes through the published surface of the panel: the rail is read out of the
// DOM, the panes are opened by clicking their rows, and the controls are pressed rather than called.
//============================================================================================================================================

import { CreateWindow, CreateTally, Settle } from "./DeviceHost.mjs";

const { Window, Faults } = CreateWindow();
const { Check, Report } = CreateTally("the card");

// A colour as the editor writes it, so an assertion can say "#111111" rather than three floats that nearly are.
const ToCode = (Colour) =>
    `#${[0, 1, 2].map((Index) => Math.round(Math.max(0, Math.min(1, Colour[Index])) * 255).toString(16).padStart(2, "0")).join("")}`;

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
Check(
    "the paint rail is the six grouped rows, the head and the hand before the pigment",
    Rail().join(",") === "shape,grain,stroke,taper,colour,material",
    Rail().join(","),
);
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
Check("the decal rail is its own", DecalRail().join(",") === "artwork,placement,ink,material", DecalRail().join(","));
Check("with one colour row on it, not two", DecalRail().filter((Key) => Key === "colour" || Key === "ink").length === 1);

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

//--------------------------------------------------------------------------------------------------------------------------
// One menu for the ink: the square that mixes the paint, pointed at the artwork.
//--------------------------------------------------------------------------------------------------------------------------
Card.ShowSection("ink");
const Pigment = ToCode(Panel.BrushColour);
Ink("artwork");
Check("as drawn has nothing to mix", !Pane().querySelector(".mix-field"));

Ink("flat");
const Mix = () => Pane().querySelector(".mix-field");
Check("one colour brings the picker out", !!Mix());
Check("and the usual inks with it", Pane().querySelectorAll("[data-ink]").length === 8, String(Pane().querySelectorAll("[data-ink]").length));
Check("and the colours this hand has mixed", Pane().querySelectorAll("[data-recent]").length > 0);

const Black = Pane().querySelector('[data-ink="#111111"]');
Black.dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
await Settle(Window, 2);
Check("an ink picked here lands on the decal", ToCode(Decal.Decal.Tint) === "#111111", ToCode(Decal.Decal.Tint));
Check("and on every placement, because a mark carries its own", (Decal.Decal.Marks || []).every((Mark) => ToCode(Mark.Tint) === "#111111"));
Check("the brush in hand keeps its own colour", ToCode(Panel.BrushColour) === Pigment, ToCode(Panel.BrushColour));

const Code = Pane().querySelector("[data-code]");
Code.value = "#2f8f4e";
Code.dispatchEvent(new Window.Event("change", { bubbles: true }));
await Settle(Window, 2);
Check("typing a hex into the square inks it too", ToCode(Decal.Decal.Tint) === "#2f8f4e", ToCode(Decal.Decal.Tint));

Ink("gradient");
Check("a gradient keeps the picker, pointed at the stop", !!Mix());
Panel.InkStop = 1;
Card.RenderPane(false);
const Second = Pane().querySelector("[data-code]");
Second.value = "#c84a1e";
Second.dispatchEvent(new Window.Event("change", { bubbles: true }));
await Settle(Window, 2);
Check("mixing moves the colour under the knob", ToCode(Decal.Decal.Ramp.Stops[1].Colour) === "#c84a1e", ToCode(Decal.Decal.Ramp.Stops[1].Colour));
Check("and the strip redraws without rebuilding the pane", Pane().querySelector("[data-stop='1']")?.style.getPropertyValue("--knob") === "#c84a1e");

const Knob = Pane().querySelector("[data-stop='0']");
Knob.dispatchEvent(new Window.MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 6, pointerId: 3 }));
Pane().querySelector(".ramp-strip").dispatchEvent(new Window.MouseEvent("pointerup", { bubbles: true, clientX: 0, clientY: 6, pointerId: 3 }));
Check(
    "and pointing at another stop moves the square onto its colour",
    Pane().querySelector("[data-code]").value.toLowerCase() === ToCode(Decal.Decal.Ramp.Stops[0].Colour),
    `${Pane().querySelector("[data-code]").value} · ${ToCode(Decal.Decal.Ramp.Stops[0].Colour)}`,
);

//--------------------------------------------------------------------------------------------------------------------------
// The test sheet prints the artwork when the layer is printed, not a stroke the brush could never make.
//--------------------------------------------------------------------------------------------------------------------------
Card.TogglePad(true);
await Settle(Window, 3);
const Pad = Card.Root.querySelector("[data-pad-canvas]");
const Marks = () => Pad.getContext("2d").Record;
Card.DrawPad();
Check("the sheet draws the artwork", Marks().some((Entry) => Entry[0] === "drawImage" && Entry[1] === 1024));
Check("on paper, not through the stroke rasteriser", Marks().filter((Entry) => Entry[0] === "putImageData").length === 0);
Check("and says what it is for", Card.Root.querySelector("[data-pad-note]").textContent.includes("Press to try it"));

Pad.dispatchEvent(new Window.MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 60, pointerId: 7 }));
Pad.dispatchEvent(new Window.MouseEvent("pointermove", { bubbles: true, clientX: 70, clientY: 90, pointerId: 7 }));
Pad.dispatchEvent(new Window.MouseEvent("pointerup", { bubbles: true, clientX: 70, clientY: 90, pointerId: 7 }));
Check("a press puts an impression on it", Card.PadMarks.length === 1, String(Card.PadMarks.length));
Check("which follows the hand", Card.PadMarks[0][0] > 40);
Check("and the note counts them", Card.Root.querySelector("[data-pad-note]").textContent.includes("1 impression"));
Card.ClearPad();
Check("Clear takes them off again", Card.PadMarks.length === 0);

Panel.SelectLayer(Panel.Layers.find((Layer) => Layer.Kind === "stroke").Identifier);
await Settle(Window, 2);
Card.DrawPad();
Check("a painted layer gets its stroke sheet back", Card.Root.querySelector("[data-pad-note]").textContent.includes("Draw here"));

//--------------------------------------------------------------------------------------------------------------------------
// Tab is a toggle. It opens the card, and the next press puts it away.
//--------------------------------------------------------------------------------------------------------------------------
const Tap = () => Window.dispatchEvent(new Window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
if (Card.Open) Card.Hide();
Card.ShowSection("material");
Tap();
Check("Tab opens the card", Card.Open === true);
const Standing = Card.Standing?.Key;
Tap();
Check("and Tab closes it again", Card.Open === false);
Tap();
Check("it comes back on the pane it was left on", Card.Open === true && Card.Standing?.Key === Standing, String(Card.Standing?.Key));
Tap();
Check("and goes away once more, never walking the rail", Card.Open === false);

// 🔴 The regression that made it look like Tab still walked the rail: with focus in one of the card's own fields
//    the key never reached the editor, so the browser did what it always does with Tab — moved the focus ring to
//    the next focusable thing, which is the next row of the rail.
Tap();
Card.ShowSection("colour");
const Typed = Pane().querySelector("[data-code]");
Typed.focus();
Check("a field in the card can hold focus", Window.document.activeElement === Typed);
Typed.dispatchEvent(new Window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
Check("Tab closes the card from inside a field", Card.Open === false);
Check("and lets go of the field on the way out", Window.document.activeElement !== Typed);

// 🔴 And the same from a slider, which is where the hand leaves focus most of the time. Belt and braces: the rail's
//    own rows are taken out of the focus order, so even a Tab that somehow got past the editor cannot walk them.
Tap();
Card.ShowSection("shape");
const Slider = Pane().querySelector("input[type=range]");
Slider?.focus();
Slider?.dispatchEvent(new Window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
Check("Tab closes the card from a slider too", Card.Open === false, Card.Standing?.Key);
Tap();
Check(
    "and no row of the rail is in the focus order",
    [...Card.Root.querySelectorAll(".tool-rail [data-section]")].every((Row) => Row.getAttribute("tabindex") === "-1"),
);

// 🔴 The other half of the same bug: a single-letter shortcut must survive a slider holding focus. Clicking any
//    knob on the card used to take S, the brackets and the tool keys away until the canvas was clicked again.
const Held = Panel.Projection.Brush.Radius;
const Range = Pane().querySelector("input[type=range]");
Range.focus();
Window.dispatchEvent(new Window.KeyboardEvent("keydown", { key: "]", bubbles: true }));
Check("the brackets size the brush with a slider focused", Panel.Projection.Brush.Radius > Held, `${Held} → ${Panel.Projection.Brush.Radius}`);
const Grew = Panel.Projection.Brush.Radius;
Window.dispatchEvent(new Window.KeyboardEvent("keydown", { key: "[", bubbles: true }));
Check("and back down", Panel.Projection.Brush.Radius < Grew, `${Grew} → ${Panel.Projection.Brush.Radius}`);

// A field that is genuinely typed into keeps its letters: an s typed into the search box is an s, not a brush size.
const Search = Window.document.querySelector("#layer-search");
Search.focus();
Search.dispatchEvent(new Window.KeyboardEvent("keydown", { key: "s", bubbles: true }));
Check("but typing an s into a search box is still an s", !Panel.Sizing);
Search.blur();

// The pane head: a mark in the rail's own colour, a title, and the line under it that says what the pane is for.
Card.Show();
Card.ShowSection("shape");
const Head = Card.Root.querySelector(".pane-head");
Check("the pane head wears the pane's own mark", !!Head.querySelector("[data-pane-mark] svg"));
Check("and names the pane", Head.querySelector("[data-pane-title]").textContent.length > 0, Head.querySelector("[data-pane-title]").textContent);
Check("every group in the pane has a header of its own", [...Pane().querySelectorAll(".card-group")].every((Group_) => !!Group_.querySelector(".group-head h3")));

//--------------------------------------------------------------------------------------------------------------------------
// The pin, and the head as a handle. A card that is dismissed by the act it is tuning cannot be used while painting.
//--------------------------------------------------------------------------------------------------------------------------
const Pin = Card.Root.querySelector("[data-pin]");
Check("the head carries a pin", !!Pin);
Check("which starts out loose", Pin.getAttribute("aria-pressed") === "false");

Card.Show();
Press("pointerdown", 420, 250);
Press("pointerup", 420, 250);
Check("an unpinned card goes away when the model is touched", Card.Open === false);

Card.Show();
Pin.dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
Check("pinning lights the pin", Pin.getAttribute("aria-pressed") === "true");
Check("and marks the card", Card.Root.classList.contains("pinned"));
Press("pointerdown", 420, 250);
Press("pointerup", 420, 250);
Check("a pinned card stays while the model is painted", Card.Open === true);

const Handle = Card.Root.querySelector(".pane-head");
const Carry = (Kind, X, Y) =>
    Handle.dispatchEvent(new Window.MouseEvent(Kind, { bubbles: true, clientX: X, clientY: Y, button: 0, pointerId: 11 }));
const Stood = Card.Root.style.left;
Carry("pointerdown", 40, 20);
Check("a press on the head picks the card up", Card.Root.classList.contains("carried"));
Carry("pointermove", 240, 160);
Check("and moving the hand moves the card", Card.Root.style.left !== Stood, `${Stood} → ${Card.Root.style.left}`);
Carry("pointerup", 240, 160);
Check("letting go puts it down", !Card.Root.classList.contains("carried"));

const Left = Card.Root.style.left;
Card.Hide();
Card.Show();
Check("summoning it again leaves it where it was carried to", Card.Root.style.left === Left, `${Left} → ${Card.Root.style.left}`);

const Stayed = Card.Root.style.left;
Pin.dispatchEvent(new Window.MouseEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 20, button: 0, pointerId: 12 }));
Handle.dispatchEvent(new Window.MouseEvent("pointermove", { bubbles: true, clientX: 60, clientY: 300, pointerId: 12 }));
Check("but a press on a control in the head is not a drag", Card.Root.style.left === Stayed);
Pin.dispatchEvent(new Window.MouseEvent("click", { bubbles: true }));
Check("and the pin lets go again", Card.Pinned === false);

//--------------------------------------------------------------------------------------------------------------------------
// The colour under the finger. Dragging red to yellow passes through every shade between the two, and none of them
// were chosen: the recent rail must be given the colour that was let go of, once.
//--------------------------------------------------------------------------------------------------------------------------
Card.Show();
Panel.SelectLayer(Panel.Layers.find((Layer) => Layer.Kind === "stroke").Identifier);
Card.ShowSection("colour");
const Square = Card.Root.querySelector("[data-square]");
const Kept = () => (Panel.RecentColours || []).length;
const Sweep = (Kind, X, Y) =>
    Square.dispatchEvent(new Window.MouseEvent(Kind, { bubbles: true, clientX: X, clientY: Y, button: 0, pointerId: 21 }));
Check("the mixing square is there to drag", !!Square);
const Noted = Kept();
Sweep("pointerdown", 20, 150);
const Opening = ToCode(Panel.BrushColour);
Sweep("pointermove", 180, 40);
Check("the brush follows the finger across the square", ToCode(Panel.BrushColour) !== Opening, `${Opening} → ${ToCode(Panel.BrushColour)}`);
Sweep("pointermove", 300, 20);
Check("and nothing is remembered while it is still down", Kept() === Noted, `${Noted} → ${Kept()}`);
Check("so the rail is not led by the drag", (Panel.RecentColours || [])[0] !== ToCode(Panel.BrushColour));
Sweep("pointerup", 300, 20);
Check("letting go remembers the colour let go of", (Panel.RecentColours || [])[0] === ToCode(Panel.BrushColour), (Panel.RecentColours || [])[0]);
Check("and remembers exactly one of them", Kept() === Noted + 1, `${Noted} → ${Kept()}`);

Check("the status bar names the build on screen", Window.document.querySelector("#build-mark")?.textContent?.startsWith("build "), Window.document.querySelector("#build-mark")?.textContent);

Report();
// jsdom keeps timers and a decal rasterise that will never resolve alive, so the run is ended deliberately.
process.exit(process.exitCode || 0);

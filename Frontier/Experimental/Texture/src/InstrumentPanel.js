//============================================================================================================================================
// 🎨 InstrumentPanel.js — the summoned instrument card: a rail of media, a tile per type, sliding to the type's settings
//============================================================================================================================================
// The card is two panes on one track. The first is [ family rail | tiles of types ]; choosing a tile slides the track one
// card-width left to [ family rail | settings for that type ]. Tab steps forward through the same two stops and out the
// far side; Escape steps back. The rail is drawn into both panes rather than spanning them, because a rail outside the
// track could not scroll with the pane it belongs to.
//
// The card drives the live brush and nothing else: it is handed a callback and never reaches into the stack, the layer
// record or the renderer. That is what lets the same card serve a colour layer and a mask without knowing which it is —
// it asks the host, through `Masking`, and swaps its colour swatches for a value ramp when the answer is yes.
//============================================================================================================================================

import { SliderRow, SyncSlider } from "./ControlSpecification.js";
import { MediaFromInstrument, MediaSummary, Deposit, ToothField, ValueNoise, Hash21, MediaWidth, MediaExtent } from "./MediaSolver.js";
import {
    InstrumentFamilies,
    InstrumentArtwork,
    InstrumentRecord,
    BrushFromInstrument,
    VisibleControls,
    FamilyOf,
} from "./InstrumentSpecification.js";

//--------------------------------------------------------------------------------------------------------------------------
// Control glyphs. Sixteen hairline marks, drawn in currentColor so a row tints with its own state.
//--------------------------------------------------------------------------------------------------------------------------
const Line = (Path, Width = 1.6) =>
    `<path d="${Path}" fill="none" stroke="currentColor" stroke-width="${Width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const Dashes = (Path, Width = 1.4) =>
    `<path d="${Path}" fill="none" stroke="currentColor" stroke-width="${Width}" stroke-linecap="round" stroke-dasharray="2 3"/>`;
const Ring = (X, Y, Radius, Width = 1.6) =>
    `<circle cx="${X}" cy="${Y}" r="${Radius}" fill="none" stroke="currentColor" stroke-width="${Width}"/>`;
const Spot = (X, Y, Radius) => `<circle cx="${X}" cy="${Y}" r="${Radius}" fill="currentColor"/>`;

const ControlGlyphs = {
    Size: Ring(8, 8, 5) + Spot(8, 8, 1.8),
    Opacity: Ring(8, 8, 5.5) + Dashes("M8 3 A5 5 0 0 1 8 13"),
    Flow: Line("M3 5 Q8 1 13 5 M3 9 Q8 5 13 9 M3 13 Q8 9 13 13", 1.4),
    Hardness: Ring(8, 8, 5.5) + Ring(8, 8, 2.4),
    Spacing: Spot(3.5, 8, 1.5) + Spot(8, 8, 1.5) + Spot(12.5, 8, 1.5),
    Smooth: Line("M2 11 Q5 3 8 8 T14 5", 1.5),
    Pressure: Line("M8 2 V10 M5 7 L8 10 L11 7", 1.5) + Line("M3 13 H13", 1.5),
    Grain: Spot(4, 5, 1) + Spot(9, 4, 0.9) + Spot(12, 8, 1) + Spot(6, 10, 0.9) + Spot(11, 12, 1),
    Taper: Line("M2 8 Q8 5 14 8 Q8 11 2 8", 1.3),
    Wetness: Line("M8 2 C11 6 13 8 13 10.5 A5 5 0 0 1 3 10.5 C3 8 5 6 8 2 Z", 1.4),
    Scatter: Spot(4, 4, 1.1) + Spot(11, 5, 1.1) + Spot(7, 9, 1.1) + Spot(12, 11, 1.1),
    Tilt: Line("M4 13 L11 3 M9 3 H11 V5", 1.5),
    Mode: Ring(6, 8, 4) + Ring(10, 8, 4),
    Bleed: Ring(8, 8, 5.5) + Line("M8 2.5 A5.5 5.5 0 0 0 8 13.5", 5.5),
    Pigment: Line("M4 12 A4 4 0 1 1 12 12 Z", 1.4) + Spot(8, 9, 1.4),
    Grade: Line("M3 12 L8 4 L13 12 M5.4 9 H10.6", 1.4),
};

const Glyph = (Identifier) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ControlGlyphs[Identifier] || ""}</svg>`;

const Escape = (Text) => String(Text).replace(/[&<>"]/g, (Character) => `&#${Character.charCodeAt(0)};`);

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));

// "#rrggbb" to a 0..1 triple, with no decode: the stack is authored and read in the same space, so decoding here would
// make every swatch paint darker than the chip that was clicked.
const Triple = (Code) =>
{
    const Value = parseInt(Code.slice(1), 16);
    return [((Value >> 16) & 255) / 255, ((Value >> 8) & 255) / 255, (Value & 255) / 255];
};

const Hex = (Colour) =>
    `#${Colour.map((Part) => Math.round(Clamp(Part, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;

//--------------------------------------------------------------------------------------------------------------------------
// The card.
//--------------------------------------------------------------------------------------------------------------------------
export class InstrumentPanel
{
    // `Host` is the element the card is appended to. Everything else is a callback, because the card owns no state the
    // rest of the editor cares about beyond the instrument in hand.
    constructor(Host, Options = {})
    {
        this.OnChoose = Options.OnChoose || (() => {});
        this.OnColour = Options.OnColour || (() => {});
        this.Masking = Options.Masking || (() => false);
        this.ReadLevel = Options.ReadLevel || (() => 1);
        this.OnLevel = Options.OnLevel || (() => {});

        // 📝 The card is the only surface the hand is already on when a stroke is being set up, so the host hangs its
        //    own panes off the same rail — what they are depends on the layer in hand, and the card does not care.
        //    Each entry is { Key, Label, Tone, Tally, Title, Note, Render() }, and Render hands back an element.
        this.Sections = Options.Sections || (() => []);
        this.Section = "";

        this.Family = InstrumentFamilies[0];
        this.Active = this.Family.Types[0];
        this.OnProperties = false;

        // Per-type settings, so stepping away and back keeps the edits made to an instrument.
        this.Store = new Map();
        this.Chosen = new Map();
        for (const Family of InstrumentFamilies)
        {
            for (const Type of Family.Types)
            {
                this.Store.set(Type.Key, { ...Type.Settings });
                this.Chosen.set(Type.Key, Type.Swatches[0]);
            }
        }

        // 📝 Drawings are built once per instrument and view. Re-running the art factories on every rail click is a
        //    visible hitch on a six-row rail, and the markup never changes.
        this.Drawings = new Map();

        // Every mounted value ramp's redraw, so a change made anywhere refreshes all of them.
        this.LevelDraws = [];

        this.Root = document.createElement("div");
        this.Root.className = "tool-card";
        this.Root.setAttribute("role", "dialog");
        this.Root.setAttribute("aria-label", "Instruments");
        (Host || document.body).append(this.Root);

        this.Build();
        this.Choose(this.Active, false, false);
        this.AttachDismissal();
    }

    get Open()
    {
        return this.Root.classList.contains("open");
    }

    get Settings()
    {
        return this.Store.get(this.Active.Key);
    }

    // The host pane the rail is pointing at, or nothing when the rail is on an instrument family.
    get Standing()
    {
        return this.Sections().find((Entry) => Entry.Key === this.Section) || null;
    }

    get Swatch()
    {
        return this.Chosen.get(this.Active.Key);
    }

    // The medium the instrument in hand resolves to: what the ribbon draws with and what the stamping pass is handed.
    get Media()
    {
        return MediaFromInstrument(this.Active, this.Settings);
    }

    Drawing(Type, View)
    {
        const Key = `${Type.Key}:${View || "full"}`;
        if (!this.Drawings.has(Key)) this.Drawings.set(Key, InstrumentArtwork(Type, View || undefined));
        return this.Drawings.get(Key);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Structure.
    //----------------------------------------------------------------------------------------------------------------------
    Build()
    {
        this.Root.innerHTML = `
            <div class="tool-track">
                <div class="tool-slide">
                    <div class="tool-rail" data-rail></div>
                    <div class="tool-body">
                        <div class="pane-head">
                            <div><div class="pane-title" data-family-title></div><div class="pane-sub" data-family-sub></div></div>
                            <kbd class="pane-key">Tab</kbd>
                        </div>
                        <div class="pane-scroll"><div class="tool-tiles" data-tiles></div></div>
                    </div>
                </div>
                <div class="tool-slide">
                    <div class="tool-rail" data-rail-echo></div>
                    <div class="tool-body">
                        <div class="pane-head">
                            <button class="pane-back" data-back title="Back to the tiles" aria-label="Back">
                                <svg viewBox="0 0 16 16" aria-hidden="true">${Line("M10 3 L5 8 L10 13")}</svg>
                            </button>
                            <div><div class="pane-title" data-type-title></div><div class="pane-sub" data-type-sub></div></div>
                        </div>
                        <div class="pane-scroll" data-settings></div>
                        <div class="pane-foot">
                            <span data-foot-note></span>
                            <button class="foot-action" data-reset>Reset</button>
                        </div>
                    </div>
                </div>
            </div>`;

        this.Root.querySelector("[data-back]").addEventListener("click", () => this.ShowTiles());
        this.Root.querySelector("[data-reset]").addEventListener("click", () =>
        {
            this.Store.set(this.Active.Key, { ...this.Active.Settings });
            this.Commit();
            this.RenderSettings();
        });
        this.RenderRail();
    }

    // 📝 The rail is drawn into BOTH panes. One rail spanning the track would have to sit outside it, and then it could
    //    not scroll with the pane it belongs to.
    RenderRail()
    {
        const Markup = InstrumentFamilies.map(
            (Family) => `
            <button class="rail-item ${Family === this.Family ? "active" : ""}" data-family="${Family.Key}">
                <span class="rail-dot" style="background:${Family.Tone}"></span>
                <span>${Escape(Family.Label)}</span>
                <span class="rail-tally">${Family.Types.length}</span>
            </button>`,
        ).join("");

        const Panes = this.Sections();
        const Extra = Panes.length
            ? `<div class="rail-split">For this layer</div>${Panes.map(
                  (Entry) => `
            <button class="rail-item ${Entry.Key === this.Section ? "active" : ""}" data-section="${Entry.Key}">
                <span class="rail-dot" style="background:${Entry.Tone || "#8a8a8a"}"></span>
                <span>${Escape(Entry.Label)}</span>
                ${Entry.Tally === undefined ? "" : `<span class="rail-tally">${Escape(String(Entry.Tally))}</span>`}
            </button>`,
              ).join("")}`
            : "";

        for (const Rail of this.Root.querySelectorAll("[data-rail], [data-rail-echo]"))
        {
            Rail.innerHTML = Markup + Extra;
            for (const Button of Rail.querySelectorAll("[data-section]"))
                Button.addEventListener("click", () => this.ShowSection(Button.dataset.section));
            for (const Button of Rail.querySelectorAll("[data-family]"))
            {
                Button.addEventListener("click", () =>
                {
                    const Family = InstrumentFamilies.find((Entry) => Entry.Key === Button.dataset.family);
                    if (!Family) return;
                    this.Family = Family;
                    this.Section = "";
                    this.RenderRail();
                    this.RenderTiles(true);
                    this.ShowTiles();
                });
            }
        }
    }

    RenderTiles(Animate)
    {
        const Tiles = this.Root.querySelector("[data-tiles]");
        const Standing = this.Standing;
        if (Standing)
        {
            Tiles.innerHTML = "";
            Tiles.className = `tool-sheet ${Animate ? "rising" : ""}`;
            Tiles.append(Standing.Render());
            this.Root.querySelector("[data-family-title]").textContent = Standing.Title || Standing.Label;
            this.Root.querySelector("[data-family-sub]").textContent = Standing.Note || "";
            return;
        }
        Tiles.className = "tool-tiles";
        const Family = this.Family;
        Tiles.innerHTML = Family.Types.map(
            (Type) => `
            <button class="tool-tile ${Type === this.Active ? "active" : ""} ${Animate ? "rising" : ""}" data-type="${Type.Key}"
                    title="${Escape(Type.Name)}">
                <span class="tile-well">${this.Drawing(Type, Family.Crop)}</span>
                <span class="tile-name">${Escape(Type.Label)}</span>
            </button>`,
        ).join("");

        for (const Tile of Tiles.querySelectorAll("[data-type]"))
        {
            Tile.addEventListener("click", () =>
            {
                const Type = Family.Types.find((Entry) => Entry.Key === Tile.dataset.type);
                if (!Type) return;
                // 📝 Choosing a tile both picks the instrument and steps to its settings. The second click people would
                //    otherwise make is always "now show me what it does".
                this.Choose(Type, true, true);
                this.ShowSettings();
            });
        }

        const Level = this.Masking();
        this.Root.querySelector("[data-family-title]").textContent = Level ? "Mask value" : Family.Label;
        this.Root.querySelector("[data-family-sub]").textContent = Level
            ? "Black hides · white reveals"
            : `${Family.Types.length} instruments`;

        // 🔴 The value ramp belongs on THIS pane, the one Tab opens first. When a mask is the paint target, choosing a
        //    level is the whole reason the card was summoned, so burying it one slide deep puts the control the user
        //    asked for somewhere they did not ask for it.
        if (Level) Tiles.append(this.BuildLevel());
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The settings pane.
    //----------------------------------------------------------------------------------------------------------------------
    RenderSettings()
    {
        const Pane = this.Root.querySelector("[data-settings]");
        Pane.innerHTML = `
            <div class="ribbon-strip">
                <div class="ribbon-stand">${this.Drawing(this.Active)}</div>
                <canvas class="ribbon-canvas" width="440" height="128" aria-hidden="true"></canvas>
            </div>`;
        this.DrawRibbon(Pane.querySelector("canvas"));

        for (const Control of VisibleControls(this.Active, this.Settings)) Pane.append(this.BuildControl(Control));

        const Level = this.Masking();
        Pane.append(Level ? this.BuildLevel() : this.BuildSwatches());

        this.Root.querySelector("[data-type-title]").textContent = this.Active.Name;
        this.Root.querySelector("[data-type-sub]").textContent = Level
            ? `Masking · ${this.Settings.Size} cm`
            : `${FamilyOf(this.Active).Label} · ${this.Settings.Size} cm`;

        this.RenderFootnote();
    }

    // What the card promises about the pane it is showing. Every control reaches the stamping pass today; the count is
    // still computed rather than assumed, so the day one does not, the card says so instead of claiming otherwise.
    RenderFootnote()
    {
        const Foot = this.Root.querySelector("[data-foot-note]");
        if (!Foot) return;
        const Inert = VisibleControls(this.Active, this.Settings)
            .filter((Control) => !Control.Wired)
            .map((Control) => Control.Label);
        Foot.textContent = Inert.length
            ? `${Inert.length} setting${Inert.length === 1 ? "" : "s"} preview only`
            : `Every setting reaches the paint · ${MediaSummary(this.Media)}`;
    }

    BuildControl(Control)
    {
        if (Control.Kind === "Slider") return this.BuildSlider(Control);

        const Row = document.createElement("div");
        Row.className = `control-row ${Control.Wired ? "" : "inert"}`;

        if (Control.Kind === "Switch")
        {
            Row.innerHTML = `
                <div class="switch-row">${Glyph(Control.Glyph)}<span>${Escape(Control.Label)}</span>
                    <label class="switch"><input type="checkbox" data-switch ${this.Settings[Control.Key] ? "checked" : ""}
                            aria-label="${Escape(Control.Label)}" /><span></span></label>
                </div>`;
            Row.querySelector("[data-switch]").addEventListener("change", (Event) =>
            {
                this.Settings[Control.Key] = Event.target.checked;
                this.Commit();
                // A switch can reveal or hide dependent rows, so the whole pane re-evaluates.
                this.RenderSettings();
            });
            return Row;
        }

        Row.innerHTML = `
            <div class="control-head">${Glyph(Control.Glyph)}<span>${Escape(Control.Label)}</span>
                <span class="control-value" data-readout>${Escape(this.Settings[Control.Key])}</span>
            </div>`;
        Row.append(this.BuildSegmented(Control));
        return Row;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // A slider row — the editor's slider, not one of the card's own. SliderRow is the same builder the inspector's
    // property sheets use, so a size here reads, drags and types exactly like a roughness there.
    //
    // 🔴 Bound with `data-key`, never `data-bind`. The card is mounted on the body; a `data-bind` attribute out here
    //    would be picked up by the panel's delegated inspector listener and resolved against the project record, which
    //    has no notion of an instrument's settings.
    //----------------------------------------------------------------------------------------------------------------------
    BuildSlider(Control)
    {
        const Host = document.createElement("div");
        Host.innerHTML = SliderRow({
            Label: Control.Label,
            Path: `instrument-${this.Active.Key}-${Control.Key}`,
            Value: this.Settings[Control.Key],
            Minimum: Control.Minimum,
            Maximum: Control.Maximum,
            Step: Control.Step,
            Unit: Control.Unit,
            Glyph: Glyph(Control.Glyph),
            Bind: "key",
            Muted: !Control.Wired,
        });
        const Row = Host.firstElementChild;

        const Apply = (Text, Live) =>
        {
            // 🔴 A pill being typed into is EMPTY for a keystroke or two, and `Number("")` is zero, not NaN. Testing
            //    the string rather than the number is what stops a half-typed value snapping the setting to its floor.
            if (Text === "" || Text === null || Text === undefined) return;
            const Raw = Number(Text);
            if (!Number.isFinite(Raw)) return;
            const Value = Number(Clamp(Raw, Control.Minimum, Control.Maximum).toFixed(Control.Step < 1 ? 1 : 0));
            this.Settings[Control.Key] = Value;
            SyncSlider(Row, Value, Control.Step);
            this.Commit();
            this.ScheduleRibbon();
            if (Control.Key === "Size")
                this.Root.querySelector("[data-type-sub]").textContent =
                    `${this.Masking() ? "Masking" : FamilyOf(this.Active).Label} · ${Value} cm`;
            // A typed value is committed on change rather than on every keystroke, so "4" on the way to "42" does not
            // repaint the ribbon at a size nobody asked for.
            if (!Live) this.RenderFootnote();
        };

        for (const Field of Row.querySelectorAll("input"))
        {
            Field.addEventListener("input", (Event) => Apply(Event.target.value, true));
            Field.addEventListener("change", (Event) => Apply(Event.target.value, false));
        }
        return Row;
    }

    BuildSegmented(Control)
    {
        const Bar = document.createElement("div");
        Bar.className = "segmented";
        Bar.innerHTML = Control.Options.map(
            (Option) =>
                `<button class="segment ${Option === this.Settings[Control.Key] ? "active" : ""}" data-option="${Escape(Option)}">${Escape(Option)}</button>`,
        ).join("");
        for (const Button of Bar.querySelectorAll("[data-option]"))
        {
            Button.addEventListener("click", () =>
            {
                this.Settings[Control.Key] = Button.dataset.option;
                this.Commit();
                this.RenderSettings();
            });
        }
        return Bar;
    }

    BuildSwatches()
    {
        const Row = document.createElement("div");
        Row.className = "control-row";
        Row.innerHTML = `
            <div class="control-head">${Glyph("Pigment")}<span>Colour</span></div>
            <div class="swatch-row">${this.Active.Swatches.map(
                (Colour) =>
                    `<button class="tool-swatch ${Colour === this.Swatch ? "active" : ""}" style="background:${Colour}"
                             data-swatch="${Colour}" title="${Colour.toUpperCase()}" aria-label="Use ${Colour}"></button>`,
            ).join("")}</div>`;

        for (const Chip of Row.querySelectorAll("[data-swatch]"))
        {
            Chip.addEventListener("click", () =>
            {
                this.Chosen.set(this.Active.Key, Chip.dataset.swatch);
                this.OnColour(Chip.dataset.swatch);
                this.Commit();
                this.RenderSettings();
            });
        }
        return Row;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The mask value ramp.
    //
    // 🔴 This REPLACES the hue swatches rather than sitting beside them. A mask stores coverage, not colour, so a hue
    //    picker there offers a choice that cannot be expressed: pick crimson and the mask records 0.3 grey, which reads
    //    as the picker being broken. Showing only the values a mask can hold makes the constraint self-evident.
    //----------------------------------------------------------------------------------------------------------------------
    BuildLevel()
    {
        const Row = document.createElement("div");
        Row.className = "control-row";
        Row.innerHTML = `
            <div class="control-head">${Glyph("Pigment")}<span>Mask value</span>
                <span class="control-value" data-level-readout></span>
            </div>
            <div class="mask-ramp" data-ramp><div class="ramp-knob" data-ramp-knob></div></div>
            <div class="swatch-row">
                <button class="tool-swatch" style="background:#000" data-level="0" title="Hide"></button>
                <button class="tool-swatch" style="background:#808080" data-level="0.5" title="Half"></button>
                <button class="tool-swatch" style="background:#fff" data-level="1" title="Reveal"></button>
            </div>`;

        const Ramp = Row.querySelector("[data-ramp]");
        const Knob = Row.querySelector("[data-ramp-knob]");
        const Readout = Row.querySelector("[data-level-readout]");

        const Draw = () =>
        {
            const Level = Clamp(this.ReadLevel(), 0, 1);
            Knob.style.left = `${Level * 100}%`;
            Readout.textContent = `${Math.round(Level * 100)}% · ${Level > 0.5 ? "reveal" : "hide"}`;
            for (const Chip of Row.querySelectorAll("[data-level]"))
                Chip.classList.toggle("active", Math.abs(Number(Chip.dataset.level) - Level) < 0.02);
        };

        const Set = (Across) =>
        {
            const Box = Ramp.getBoundingClientRect();
            this.SetLevel(Clamp((Across - Box.left) / (Box.width || 1), 0, 1));
        };

        Ramp.addEventListener("pointerdown", (Event) =>
        {
            Ramp.setPointerCapture?.(Event.pointerId);
            Set(Event.clientX);
        });
        Ramp.addEventListener("pointermove", (Event) =>
        {
            if (Ramp.hasPointerCapture?.(Event.pointerId)) Set(Event.clientX);
        });
        Ramp.addEventListener("pointerup", (Event) =>
        {
            if (Ramp.hasPointerCapture?.(Event.pointerId)) Ramp.releasePointerCapture(Event.pointerId);
        });
        for (const Chip of Row.querySelectorAll("[data-level]"))
            Chip.addEventListener("click", () => this.SetLevel(Number(Chip.dataset.level)));

        Draw();
        // 🔴 Registered into a list, not kept as one field: both panes can hold a ramp at once, and a lone field would
        //    leave whichever mounted second as the only one that ever refreshed.
        this.LevelDraws.push({ Node: Row, Draw });
        return Row;
    }

    SetLevel(Level)
    {
        this.OnLevel(Clamp(Level, 0, 1));
        this.SyncLevel();
    }

    // Re-draw every mounted ramp after a change from anywhere — a chip, the ramp itself, or a colour picked outside the
    // card. Detached rows are pruned as they are found, so rebuilt panes drop out on their own.
    SyncLevel()
    {
        this.LevelDraws = this.LevelDraws.filter((Entry) => Entry.Node.isConnected);
        for (const Entry of this.LevelDraws) Entry.Draw();
    }

    // 🔴 One redraw per frame, not one per event. A drag on a slider fires input faster than a 46px brush can be
    //    re-deposited pixel by pixel, and without the gate the card falls behind the hand that is dragging it.
    ScheduleRibbon()
    {
        if (this.RibbonPending) return;
        this.RibbonPending = true;
        const Draw = () =>
        {
            this.RibbonPending = false;
            this.DrawRibbon(this.Root.querySelector(".ribbon-canvas"));
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(Draw);
        else Draw();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The ribbon.
    //
    // 🔴 This is not a drawing of a stroke, it is a stroke: every pixel runs MediaSolver's `Deposit`, the same model
    //    the stamping pass runs on the GPU, with the same tooth, the same bristle lanes and the same entry taper. A
    //    preview drawn any other way is a promise the paint then breaks.
    //
    // 📝 Written as pixels rather than as canvas dabs because the model answers per point: there is no gradient stop
    //    that can describe a bristle gap, and stacking translucent arcs to fake one gets the overlaps wrong anyway.
    //    One write per pixel, because the preview path never crosses itself.
    //----------------------------------------------------------------------------------------------------------------------
    DrawRibbon(Canvas)
    {
        if (!Canvas) return;
        const Pen = Canvas.getContext("2d");
        if (!Pen || typeof Pen.createImageData !== "function") return;
        const Width = Canvas.width;
        const Height = Canvas.height;
        const Sheet = Pen.createImageData(Width, Height);
        // jsdom hands back a proxy whose methods answer undefined; the returned object is the only honest test.
        if (!Sheet || !Sheet.data) return;

        const Settings = this.Settings;
        const Media = this.Media;
        const Hardness = Clamp((Settings.Hardness ?? 50) / 100, 0, 1);
        const Strength = Clamp((Settings.Opacity / 100) * (Settings.Flow / 100), 0.02, 1);
        const Reach = Clamp(Settings.Size * 2.4, 3.5, 46);
        const Extent = MediaExtent(Media);
        // The preview is drawn at the instrument's real size, so a metre of surface and a pixel of ribbon are related
        // by one number — and the paper's tooth comes out the size it will actually be under the brush.
        const Metres = Clamp(Settings.Size / 100, 0.004, 0.6) / Reach;
        const [Red, Green, Blue] = (this.Masking()
            ? [this.ReadLevel(), this.ReadLevel(), this.ReadLevel()]
            : Triple(this.Swatch)
        ).map((Part) => Part * 255);

        // 🔴 A white china marker on cream paper is a true preview of nothing at all. When the pigment is as pale as
        //    the sheet it would be laid on, the ribbon lays a dark ground instead — the same thing a shop does with a
        //    white pencil on a black card, and the only way those instruments can be shown at all.
        const Luminance = (0.2126 * Red + 0.7152 * Green + 0.0722 * Blue) / 255;
        const Ground = Luminance > 0.72 ? [54, 54, 58] : null;

        // The path: one stroke across the strip, with a turn in it so a chisel nib shows both its widths.
        const Steps = 24;
        const Points = [];
        const Walk = [0];
        const Widths = [1];
        for (let Step = 0; Step <= Steps; Step += 1)
        {
            const Share = Step / Steps;
            const X = 18 + Share * (Width - 36);
            const Y = Height * 0.54 + Math.sin(Share * Math.PI * 1.7) * Height * 0.23;
            Points.push([X, Y]);
            if (Step > 0)
            {
                Walk.push(Walk[Step - 1] + Math.sqrt((X - Points[Step - 1][0]) ** 2 + (Y - Points[Step - 1][1]) ** 2));
                // The same width the stroke itself would get for this direction, so a chisel shows both of its faces.
                Widths.push(MediaWidth(Media, Math.atan2(Y - Points[Step - 1][1], X - Points[Step - 1][0])));
            }
        }
        const Total = Walk[Walk.length - 1] || 1;

        // The same entry ramp StrokeProjection applies, in the same units: no instrument lands at full weight.
        const Pressure = (Along) =>
        {
            if (!Media.Pressure) return 1;
            const Length = Math.max(Reach * (0.5 + 7 * Media.Taper), 1e-5);
            const Entry = Clamp(Along / Length, 0, 1);
            const Hand = 1 - 0.18 * Math.sin((Along / Total) * Math.PI * 2.3);
            return Clamp(Hand * (1 - Media.Taper * (1 - Entry) * 0.88), 0.02, 1);
        };

        const Pixels = Sheet.data;
        if (Ground)
        {
            for (let Index = 0; Index < Width * Height; Index += 1)
            {
                Pixels[Index * 4] = Ground[0];
                Pixels[Index * 4 + 1] = Ground[1];
                Pixels[Index * 4 + 2] = Ground[2];
                Pixels[Index * 4 + 3] = 255;
            }
        }
        const Limit = Reach * Extent + 2;

        // 📝 A column index over the path. Without it every pixel of the strip would be measured against every segment
        //    of the stroke — a sixth of a second per redraw, which on a slider drag is a frozen card. With it each
        //    pixel only asks the two or three segments that could possibly be near it.
        const Reachable = [];
        for (let Column = 0; Column < Width; Column += 1) Reachable.push([]);
        const Vertical = [];
        for (let Step = 1; Step <= Steps; Step += 1)
        {
            const [AX, AY] = Points[Step - 1];
            const [BX, BY] = Points[Step];
            const Low = Math.max(0, Math.floor(Math.min(AX, BX) - Limit));
            const High = Math.min(Width - 1, Math.ceil(Math.max(AX, BX) + Limit));
            for (let Column = Low; Column <= High; Column += 1) Reachable[Column].push(Step);
            Vertical.push([Math.min(AY, BY) - Limit, Math.max(AY, BY) + Limit]);
        }

        for (let Row = 0; Row < Height; Row += 1)
        {
            for (let Column = 0; Column < Width; Column += 1)
            {
                let Closest = Infinity;
                let Side = 0;
                let Along = 0;
                let Nib = 1;
                for (const Step of Reachable[Column])
                {
                    const Range = Vertical[Step - 1];
                    if (Row < Range[0] || Row > Range[1]) continue;
                    const [AX, AY] = Points[Step - 1];
                    const [BX, BY] = Points[Step];
                    const RunX = BX - AX;
                    const RunY = BY - AY;
                    const Span = RunX * RunX + RunY * RunY;
                    const Travel = Span > 1e-9 ? Clamp(((Column - AX) * RunX + (Row - AY) * RunY) / Span, 0, 1) : 0;
                    const OffX = Column - (AX + RunX * Travel);
                    const OffY = Row - (AY + RunY * Travel);
                    const Distance = Math.sqrt(OffX * OffX + OffY * OffY);
                    if (Distance >= Closest) continue;
                    Closest = Distance;
                    Side = Distance * (OffX * RunY - OffY * RunX < 0 ? -1 : 1);
                    Along = Walk[Step - 1] + Math.sqrt(Span) * Travel;
                    Nib = Widths[Step];
                }
                if (Closest > Limit) continue;

                const Press = Pressure(Along);
                const Radius = Math.max(Reach * Nib * (1 - Media.Swell * (1 - Press)), 0.5);
                const Across = Side / Radius;
                if (Math.abs(Across) > Extent) continue;

                const Paper = Media.Tooth * Metres;
                const Mark = Deposit(Media, {
                    Across,
                    Along: Along * Metres,
                    Press,
                    Hardness,
                    Tooth: ToothField(Column * Paper, Row * Paper),
                    Fibre: ValueNoise(Along * Media.Fibre * Metres, Across * 3 + Media.Seed * 17),
                    Speck: Hash21(Column * 1.37 + Media.Seed, Row * 2.13),
                });
                const Alpha = Clamp(Mark.Alpha * Strength, 0, 1);
                if (Alpha <= 0.004) continue;

                const Offset = (Row * Width + Column) * 4;
                const Ink = [Clamp(Red * Mark.Shade, 0, 255), Clamp(Green * Mark.Shade, 0, 255), Clamp(Blue * Mark.Shade, 0, 255)];
                if (Ground)
                {
                    for (let Part = 0; Part < 3; Part += 1) Pixels[Offset + Part] = Ground[Part] * (1 - Alpha) + Ink[Part] * Alpha;
                    Pixels[Offset + 3] = 255;
                    continue;
                }
                for (let Part = 0; Part < 3; Part += 1) Pixels[Offset + Part] = Ink[Part];
                Pixels[Offset + 3] = Math.round(Alpha * 255);
            }
        }

        Pen.clearRect(0, 0, Width, Height);
        Pen.putImageData(Sheet, 0, 0);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Behaviour.
    //----------------------------------------------------------------------------------------------------------------------
    Choose(Type, Animate, Announce)
    {
        this.Active = Type;
        this.Family = FamilyOf(Type);
        this.RenderRail();
        this.RenderTiles(Animate);
        if (this.OnProperties) this.RenderSettings();
        this.Commit(Announce);
    }

    // Push the instrument onto the brush and hand the host its full record.
    Commit(Announce = false)
    {
        this.OnChoose(BrushFromInstrument(this.Active, this.Settings), this.Snapshot(), Announce);
    }

    // What the instrument is, in full, for a stroke record or a timeline entry.
    Snapshot()
    {
        return InstrumentRecord(this.Active, this.Settings);
    }

    ShowTiles()
    {
        this.Root.classList.remove("properties");
        this.OnProperties = false;
    }

    // Point the rail at one of the host's panes. An unknown key falls back to the instruments rather than blanking.
    ShowSection(Key)
    {
        this.Section = this.Sections().some((Entry) => Entry.Key === Key) ? Key : "";
        this.RenderRail();
        this.RenderTiles(true);
        this.ShowTiles();
    }

    // The layer in hand changed under the card: rebuild the rail, and leave a pane that no longer applies.
    Refresh()
    {
        if (this.Section && !this.Standing) this.Section = "";
        this.RenderRail();
        if (!this.OnProperties) this.RenderTiles(false);
    }

    ShowSettings()
    {
        this.RenderSettings();
        this.Root.classList.add("properties");
        this.OnProperties = true;
    }

    // Tab steps forward: closed → tiles → settings → closed. The same key that opened the card is the one that leaves it.
    Step()
    {
        if (!this.Open)
        {
            this.Show();
            return;
        }
        // A host pane has no second slide of its own, so Tab leaves from it.
        if (this.Section)
        {
            this.Hide();
            return;
        }
        if (!this.OnProperties)
        {
            this.ShowSettings();
            return;
        }
        this.Hide();
    }

    // Summoned at a point, clamped so the card never opens off-screen. With no point it sits beside the viewport tools,
    // which is where the hand already is.
    Show(X, Y)
    {
        this.RenderTiles(false);
        if (this.OnProperties) this.RenderSettings();
        this.Root.classList.add("open");

        const Viewport = document.querySelector("#viewport")?.getBoundingClientRect();
        const Anchor = {
            X: X ?? (Viewport ? Viewport.left + 76 : 120),
            Y: Y ?? (Viewport ? Viewport.top + Math.max(16, Viewport.height * 0.12) : 96),
        };
        // 📝 Measured, not assumed: the card is content-box sized, so its border box is wider than the authored width and
        //    clamping against the authored number would let an edge sit off-screen.
        const Box = this.Root.getBoundingClientRect();
        const Width = Box.width || 560;
        const Height = Box.height || Math.min(430, window.innerHeight * 0.78);
        const Margin = 10;
        this.Root.style.left = `${Math.round(Clamp(Anchor.X, Margin, Math.max(Margin, window.innerWidth - Width - Margin)))}px`;
        this.Root.style.top = `${Math.round(Clamp(Anchor.Y, Margin, Math.max(Margin, window.innerHeight - Height - Margin)))}px`;
    }

    Hide()
    {
        this.Root.classList.remove("open");
        this.ShowTiles();
    }

    Toggle()
    {
        if (this.Open) this.Hide();
        else this.Show();
    }

    AttachDismissal()
    {
        // Capture phase, so the canvas cannot swallow the press first.
        window.addEventListener(
            "pointerdown",
            (Event) =>
            {
                if (this.Open && !this.Root.contains(Event.target) && !Event.target.closest?.("#instrument-button")) this.Hide();
            },
            true,
        );

        // 📝 Escape steps BACK through the track before closing. Closing outright from the settings pane throws away the
        //    sense of depth the slide just established.
        window.addEventListener("keydown", (Event) =>
        {
            if (Event.key !== "Escape" || !this.Open) return;
            if (this.Section) this.ShowSection("");
            else if (this.OnProperties) this.ShowTiles();
            else this.Hide();
            Event.preventDefault();
        });
    }
}

export { Triple as InstrumentColour, Hex as InstrumentHex };

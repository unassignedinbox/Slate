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

    get Swatch()
    {
        return this.Chosen.get(this.Active.Key);
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

        for (const Rail of this.Root.querySelectorAll("[data-rail], [data-rail-echo]"))
        {
            Rail.innerHTML = Markup;
            for (const Button of Rail.querySelectorAll("[data-family]"))
            {
                Button.addEventListener("click", () =>
                {
                    const Family = InstrumentFamilies.find((Entry) => Entry.Key === Button.dataset.family);
                    if (!Family) return;
                    this.Family = Family;
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

        const Inert = VisibleControls(this.Active, this.Settings)
            .filter((Control) => !Control.Wired)
            .map((Control) => Control.Label);
        this.Root.querySelector("[data-foot-note]").textContent = Inert.length
            ? `${Inert.length} setting${Inert.length === 1 ? "" : "s"} preview only`
            : "Every setting reaches the brush";
    }

    BuildControl(Control)
    {
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

        const Value = this.Settings[Control.Key];
        const Shown = Control.Kind === "Slider" ? `${Value}${Control.Unit || ""}` : Value;
        Row.innerHTML = `
            <div class="control-head">${Glyph(Control.Glyph)}<span>${Escape(Control.Label)}</span>
                <span class="control-value" data-readout>${Escape(Shown)}</span>
            </div>`;

        Row.append(Control.Kind === "Slider" ? this.BuildSlider(Control, Row) : this.BuildSegmented(Control));
        return Row;
    }

    BuildSlider(Control, Row)
    {
        const Track = document.createElement("div");
        Track.className = "slider-track";
        Track.innerHTML = `<div class="slider-rail"></div><div class="slider-fill"></div><div class="slider-knob"></div>`;
        const Fill = Track.querySelector(".slider-fill");
        const Knob = Track.querySelector(".slider-knob");

        const Draw = () =>
        {
            const Fraction = (this.Settings[Control.Key] - Control.Minimum) / (Control.Maximum - Control.Minimum);
            Fill.style.width = `${Fraction * 100}%`;
            Knob.style.left = `${Fraction * 100}%`;
        };

        const Set = (Across) =>
        {
            const Box = Track.getBoundingClientRect();
            const Fraction = Clamp((Across - Box.left) / (Box.width || 1), 0, 1);
            const Raw = Control.Minimum + Fraction * (Control.Maximum - Control.Minimum);
            const Snapped = Math.round(Raw / Control.Step) * Control.Step;
            const Value = Number(Snapped.toFixed(Control.Step < 1 ? 1 : 0));
            this.Settings[Control.Key] = Value;
            Row.querySelector("[data-readout]").textContent = `${Value}${Control.Unit || ""}`;
            Draw();
            this.Commit();
            this.DrawRibbon(this.Root.querySelector(".ribbon-canvas"));
            if (Control.Key === "Size")
                this.Root.querySelector("[data-type-sub]").textContent =
                    `${this.Masking() ? "Masking" : FamilyOf(this.Active).Label} · ${Value} cm`;
        };

        // 🔴 Pointer capture, not a document listener. Without it a drag that leaves the 22px track stops tracking,
        //    which on a control this thin is most drags.
        Track.addEventListener("pointerdown", (Event) =>
        {
            Track.setPointerCapture?.(Event.pointerId);
            Set(Event.clientX);
        });
        Track.addEventListener("pointermove", (Event) =>
        {
            if (Track.hasPointerCapture?.(Event.pointerId)) Set(Event.clientX);
        });
        Track.addEventListener("pointerup", (Event) =>
        {
            if (Track.hasPointerCapture?.(Event.pointerId)) Track.releasePointerCapture(Event.pointerId);
        });

        Draw();
        return Track;
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

    //----------------------------------------------------------------------------------------------------------------------
    // The ribbon: a run of dabs drawn with the same falloff the stamping pass uses, so the swatch is representative.
    //----------------------------------------------------------------------------------------------------------------------
    DrawRibbon(Canvas)
    {
        if (!Canvas) return;
        const Pen = Canvas.getContext("2d");
        if (!Pen || typeof Pen.createRadialGradient !== "function") return;
        const Width = Canvas.width;
        const Height = Canvas.height;
        Pen.clearRect(0, 0, Width, Height);

        const Settings = this.Settings;
        const Reach = Clamp(Settings.Size * 2.2, 3, 46);
        const Strength = (Settings.Opacity / 100) * (Settings.Flow / 100);
        const Tooth = (Settings.Grain || 0) / 100;
        const Spread = (Settings.Scatter || 0) / 100;
        const Core = Clamp(Settings.Hardness / 100, 0, 0.95);
        const [Red, Green, Blue] = (this.Masking()
            ? [this.ReadLevel(), this.ReadLevel(), this.ReadLevel()]
            : Triple(this.Swatch)
        ).map((Part) => Math.round(Part * 255));

        const Dab = (X, Y, Scale) =>
        {
            const Radius = Math.max(1, Reach * Scale);
            const Wash = Pen.createRadialGradient(X, Y, 0, X, Y, Radius);
            if (!Wash || typeof Wash.addColorStop !== "function") return;
            Wash.addColorStop(0, `rgba(${Red},${Green},${Blue},${Strength})`);
            Wash.addColorStop(Core, `rgba(${Red},${Green},${Blue},${Strength})`);
            Wash.addColorStop(1, `rgba(${Red},${Green},${Blue},0)`);
            Pen.fillStyle = Wash;
            Pen.beginPath();
            Pen.arc(X, Y, Radius, 0, Math.PI * 2);
            Pen.fill();
        };

        // 🔴 Deterministic wobble, never Math.random: a ribbon that reshuffles on every slider tick makes it impossible
        //    to see what the slider actually changed.
        const Wobble = (Step, Salt) => Math.sin(Step * 12.9898 + Salt * 78.233) * 0.5;

        const Steps = 150;
        for (let Step = 0; Step <= Steps; Step += 1)
        {
            const Along = Step / Steps;
            const X = 24 + Along * (Width - 48);
            const Y = Height * 0.55 + Math.sin(Along * Math.PI * 1.6) * Height * 0.2;
            const Swell = Settings.Pressure ? Math.sin(Along * Math.PI) ** 0.6 : 1;
            const Thin = 1 - ((Settings.Taper || 0) / 100) * (1 - Math.sin(Along * Math.PI));
            if (Tooth > 0 && Wobble(Step, 3) + 0.5 < Tooth * 0.55) continue;
            Dab(X + Spread * Wobble(Step, 7) * Reach * 1.2, Y + Spread * Wobble(Step, 11) * Reach * 1.2, Math.max(0.12, Swell * Thin));
        }
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
            if (this.OnProperties) this.ShowTiles();
            else this.Hide();
            Event.preventDefault();
        });
    }
}

export { Triple as InstrumentColour, Hex as InstrumentHex };

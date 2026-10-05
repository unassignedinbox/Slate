//============================================================================================================================================
// 🎨 InstrumentPanel.js — the summoned card: a rail of paint properties, a pane each, and a ribbon of the mark they make
//============================================================================================================================================
// The card is about the paint in hand and nothing else — its colour, its shape, the grain it drags out of the paper, how
// it tapers, how it is laid down and how far it lags the hand. There is no library of brushes here and no row of colour
// chips: picking an instrument is a different act from tuning one, and a card that tried to be both was a card where the
// settings were always one slide away from the thing they described.
//
// Every pane is the host's. The card owns the rail, the frame, the ribbon and the key that summons them; it is handed
// a list of { Key, Label, Tone, Tally, Title, Note, Ribbon, Render } and asks for an element when a rail row is clicked.
// That is what lets the same card serve a paint layer, a decal and a mask without knowing which it has.
//
// 🔴 The ribbon is not a drawing of a stroke, it is a stroke: every pixel runs MediaSolver's `Deposit`, the same model
//    the stamping pass runs on the GPU. A preview drawn any other way is a promise the paint then breaks.
//============================================================================================================================================

import { MediaExtent, MediaWidth, MediaSummary, Deposit, ToothField, ValueNoise, Hash21 } from "./MediaSolver.js";

const Line = (Path, Width = 1.6) =>
    `<path d="${Path}" fill="none" stroke="currentColor" stroke-width="${Width}" stroke-linecap="round" stroke-linejoin="round"/>`;

const Escape = (Text) => String(Text).replace(/[&<>"]/g, (Character) => `&#${Character.charCodeAt(0)};`);

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));

// Paper. The test sheet is opaque on purpose: paint on glass tells you nothing about paint.
const PadPaper = [244, 241, 234, 255];

const FloodSheet = (Sheet, Colour) =>
{
    const Pixels = Sheet.data;
    for (let Index = 0; Index < Pixels.length; Index += 4)
    {
        Pixels[Index] = Colour[0];
        Pixels[Index + 1] = Colour[1];
        Pixels[Index + 2] = Colour[2];
        Pixels[Index + 3] = Colour[3];
    }
};

//--------------------------------------------------------------------------------------------------------------------------
// The card.
//--------------------------------------------------------------------------------------------------------------------------
export class InstrumentPanel
{
    // `Host` is the element the card is appended to. Everything else is a callback: the card holds no state the rest of
    // the editor cares about beyond which rail row is open.
    constructor(Host, Options = {})
    {
        this.Sections = Options.Sections || (() => []);
        // What the ribbon draws with. All four are read fresh on every redraw, so a change made anywhere shows up here.
        this.ReadMedia = Options.Media || (() => null);
        this.ReadInk = Options.Ink || (() => [0.8, 0.8, 0.82]);
        this.ReadWidth = Options.Width || (() => 9);
        this.ReadHardness = Options.Hardness || (() => 0.45);
        this.ReadStrength = Options.Strength || (() => 0.85);
        this.Masking = Options.Masking || (() => false);
        // 🔴 A function that answers a colour for a point along a mark, or null for "one flat colour". The card never
        //    learns what a gradient is — it asks the host what this pixel is painted in, which is the only question
        //    a preview has ever needed to ask.
        this.ReadTint = Options.Tint || (() => null);
        // 🔴 And what the sheet prints when the layer in hand is not painted at all. A decal layer cannot take a
        //    stroke — the brush is not even offered for it — so a test sheet showing one was a preview of something
        //    that could never happen. The host answers with the artwork, inked, or null for "this one is painted".
        this.ReadArtwork = Options.Artwork || (() => null);
        // 🔴 What the rail is a list OF. The card follows the layer in hand, so the column of properties needs a
        //    header saying whose properties they are — otherwise the only thing on the card with a name is the one
        //    pane that happens to be open. The host answers { Title, Note, Glyph, Tone }.
        this.ReadHeading = Options.Heading || (() => null);
        // Somewhere to say what just happened, so the pin can speak in the editor's voice rather than inventing one.
        this.Note = Options.Note || (() => {});

        this.Section = "";
        this.Padded = false;
        // The pin and where the hand left the card. A pinned card survives a press on the model, which is the whole
        // point of pinning one: the paint is being judged on the model, and the knob being turned is on the card.
        this.Pinned = false;
        this.Placed = null;
        this.PadPaths = [];
        this.PadStroke = null;
        this.PadSheet = null;
        this.PadBase = null;
        this.PadMarks = [];         // where the artwork has been pressed onto the sheet
        this.PadDrag = -1;          // which of them the hand is moving
        this.PadKey = "";           // the artwork those impressions were made with

        this.Root = document.createElement("div");
        this.Root.className = "tool-card";
        this.Root.setAttribute("role", "dialog");
        this.Root.setAttribute("aria-label", "Paint");
        (Host || document.body).append(this.Root);

        this.Build();
        this.AttachDismissal();
    }

    get Open()
    {
        return this.Root.classList.contains("open");
    }

    // The pane the rail is pointing at. With nothing chosen — or a key that no longer applies — it is the first one.
    //
    // 🔴 Everything compares panes by KEY, never by identity. The host builds its list fresh on every call — it has to,
    //    because the rail's tallies are read off the live brush — so two calls hand back two sets of objects that
    //    describe the same panes. An identity test would find no match on any of them.
    get Standing()
    {
        const Panes = this.Sections();
        return Panes.find((Entry) => Entry.Key === this.Section) || Panes[0] || null;
    }

    get Media()
    {
        return this.ReadMedia();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Structure. One slide: the rail, and the pane it points at.
    //----------------------------------------------------------------------------------------------------------------------
    Build()
    {
        this.Root.innerHTML = `
            <div class="tool-track">
                <div class="tool-slide">
                    <div class="tool-column">
                        <div class="rail-head" data-rail-head>
                            <span class="pane-mark" data-rail-mark aria-hidden="true"></span>
                            <div><div class="pane-title" data-rail-title></div><div class="pane-sub" data-rail-sub></div></div>
                        </div>
                        <div class="tool-rail" data-rail></div>
                        <div class="rail-foot" data-shelf></div>
                    </div>
                    <div class="tool-body">
                        <div class="pane-head" data-head>
                            <span class="pane-mark" data-pane-mark aria-hidden="true"></span>
                            <div><div class="pane-title" data-pane-title></div><div class="pane-sub" data-pane-sub></div></div>
                            <div class="pane-tools">
                                <button class="pane-expand pane-pin" data-pin type="button" aria-pressed="false"
                                        title="Pin the card open while you paint">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        ${Line("M9.4 3.6h5.2l-.7 4.9 3.3 2.6v1.3H6.8v-1.3l3.3-2.6z")}
                                        ${Line("M12 12.4v7")}
                                    </svg>
                                </button>
                                <button class="pane-expand" data-expand type="button" aria-expanded="false" title="Open a test sheet">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        ${Line("M4 7.5h7M4 12h7M4 16.5h4")}
                                        ${Line("M15.5 4.5h4v15h-4z")}
                                        ${Line("M17.5 9.5c-1.2 1.6-1.2 3.4 0 5", 1.3)}
                                    </svg>
                                </button>
                                <kbd class="pane-key" title="Tab opens and closes the card">Tab</kbd>
                            </div>
                        </div>
                        <div class="pane-scroll"><div class="tool-sheet" data-pane></div></div>
                        <div class="pane-foot"><span data-foot-note></span></div>
                    </div>
                    <div class="tool-pad" data-pad hidden>
                        <div class="pad-head">
                            <span class="pad-title">Test sheet</span>
                            <button class="chip-button" data-pad-clear type="button">Clear</button>
                        </div>
                        <canvas class="pad-canvas" data-pad-canvas width="260" height="420"></canvas>
                        <div class="pad-note" data-pad-note>Draw here — nothing reaches the model</div>
                    </div>
                </div>
            </div>`;
        this.Root.querySelector("[data-expand]")?.addEventListener("click", () => this.TogglePad());
        this.Root.querySelector("[data-pin]")?.addEventListener("click", () => this.TogglePin());
        this.Root.querySelector("[data-pad-clear]")?.addEventListener("click", () => this.ClearPad());
        this.AttachPad();
        this.AttachDrag();
        this.RenderRail();
    }

    // 🔴 The pin is the card's answer to the oldest complaint about summoned panels: it goes away the moment you use
    //    the thing it is tuning. Pinned, a press on the model paints instead of dismissing, and the card is left
    //    where it stands — so the knob and the stroke it changes can be watched at the same time.
    TogglePin(On = !this.Pinned)
    {
        this.Pinned = !!On;
        this.Root.classList.toggle("pinned", this.Pinned);
        const Button = this.Root.querySelector("[data-pin]");
        if (Button)
        {
            Button.setAttribute("aria-pressed", String(this.Pinned));
            Button.title = this.Pinned ? "Unpin · the card closes when you paint" : "Pin the card open while you paint";
        }
        this.Note(this.Pinned ? "Card pinned — it stays open while you paint. Drag its head to move it." : "Card unpinned.");
    }

    // The head is the handle. A press anywhere on it that is not one of its own controls picks the card up, and a
    // card that has been carried somewhere is placed by hand from then on: summoning it again leaves it there.
    AttachDrag()
    {
        const Head = this.Root.querySelector("[data-head]");
        if (!Head) return;
        let From = null;
        Head.addEventListener("pointerdown", (Event) =>
        {
            if (Event.button > 0 || Event.target.closest?.("button, kbd, input, select, a")) return;
            const Box = this.Root.getBoundingClientRect();
            From = { X: Event.clientX - Box.left, Y: Event.clientY - Box.top, Id: Event.pointerId };
            Head.setPointerCapture?.(Event.pointerId);
            this.Root.classList.add("carried");
            Event.preventDefault();
        });
        Head.addEventListener("pointermove", (Event) =>
        {
            if (!From || Event.pointerId !== From.Id) return;
            // 🔴 The point is remembered, not measured back off the card later: a closed card has no box to read,
            //    and a card that was carried and then dismissed has to come back where it was left.
            this.Placed = { X: Event.clientX - From.X, Y: Event.clientY - From.Y };
            this.Settle(this.Placed.X, this.Placed.Y);
        });
        const Drop = (Event) =>
        {
            if (!From || Event.pointerId !== From.Id) return;
            if (Head.hasPointerCapture?.(From.Id)) Head.releasePointerCapture(From.Id);
            From = null;
            this.Root.classList.remove("carried");
        };
        Head.addEventListener("pointerup", Drop);
        Head.addEventListener("pointercancel", Drop);
    }

    // One row of the rail. The mark is raw markup, not the name of one: the card has no icon sheet of its own and no
    // business importing the panel's — the host draws from whichever set it uses and hands the finished svg over.
    RailRow(Entry, Standing)
    {
        return `
            <button class="rail-item ${Entry.Key === Standing?.Key ? "active" : ""}" data-section="${Escape(Entry.Key)}"
                    tabindex="-1" title="${Escape(Entry.Note || Entry.Label)}">
                ${
                    Entry.Glyph
                        ? `<span class="rail-mark" style="color:${Entry.Tone || "#8a8a8a"}">${Entry.Glyph}</span>`
                        : `<span class="rail-dot" style="background:${Entry.Tone || "#8a8a8a"}"></span>`
                }
                <span>${Escape(Entry.Label)}</span>
                ${Entry.Tally === undefined ? "" : `<span class="rail-tally">${Escape(String(Entry.Tally))}</span>`}
            </button>`;
    }

    RenderRail()
    {
        const Rail = this.Root.querySelector("[data-rail]");
        if (!Rail) return;
        const Every = this.Sections();
        this.RenderHeading();
        const Panes = Every.filter((Entry) => !Entry.Foot);
        const Standing = Every.find((Entry) => Entry.Key === this.Section) || Panes[0] || null;

        // 🔴 A pane pinned to the foot of the rail rather than listed in it. The library is not a property of the
        //    paint — it is where the paint came from — and a row of it among the properties reads as one more
        //    setting to tune. Tab walks the properties and never lands here, for the same reason.
        const Shelf = this.Root.querySelector("[data-shelf]");
        if (Shelf)
        {
            const Footed = Every.filter((Entry) => Entry.Foot);
            // 🔴 The band stays even with nothing in it. Both columns of the card end on the same line — the foot
            //    under the rail and the foot under the pane are one bar across the bottom — and a layer with no
            //    library to offer must not take half of it away with it.
            Shelf.classList.toggle("bare", !Footed.length);
            Shelf.innerHTML = Footed.map((Entry) => this.RailRow(Entry, Standing)).join("");
            for (const Button of Shelf.querySelectorAll("[data-section]"))
                Button.addEventListener("click", () => this.ShowSection(Button.dataset.section));
        }
        // 🔴 Headings, not a flat list. Colour, the gradient it runs through and the material under it are one thing
        //    said three ways — a metallic marker is all of them at once — and eight rows in a column gave the eye no
        //    reason to believe any two of them were related. The host names the family; the rail draws the rule.
        let Family = "";
        Rail.innerHTML = Panes.length
            ? Panes.map(
                  (Entry) =>
                      `${
                          Entry.Group && Entry.Group !== Family
                              ? ((Family = Entry.Group), `<div class="rail-split">${Escape(Entry.Group)}</div>`)
                              : ""
                      }${this.RailRow(Entry, Standing)}`,
              ).join("")
            : `<div class="rail-split">Nothing to paint with</div>`;
        for (const Button of Rail.querySelectorAll("[data-section]"))
            Button.addEventListener("click", () => this.ShowSection(Button.dataset.section));
    }

    // The rail's own header, drawn to the same height as the pane's so the card reads as two columns under one line
    // rather than two panels that happen to be side by side.
    RenderHeading()
    {
        const Head = this.Root.querySelector("[data-rail-head]");
        if (!Head) return;
        const Heading = this.ReadHeading() || {};
        const Mark = Head.querySelector("[data-rail-mark]");
        if (Mark)
        {
            Mark.innerHTML = Heading.Glyph || "";
            Mark.style.color = Heading.Tone || "#8a8a8a";
            Mark.hidden = !Heading.Glyph;
        }
        Head.querySelector("[data-rail-title]").textContent = Heading.Title || "Paint";
        Head.querySelector("[data-rail-sub]").textContent = Heading.Note || "";
    }

    // 📝 Named RenderPane rather than RenderTiles: there are no tiles any more, and a name that describes what the card
    //    used to be is the surest way to be misread by whoever changes it next.
    RenderPane(Animate = false)
    {
        const Body = this.Root.querySelector("[data-pane]");
        if (!Body) return;
        const Standing = this.Standing;
        Body.innerHTML = "";
        Body.className = `tool-sheet ${Animate ? "rising" : ""}`;
        const Title = this.Root.querySelector("[data-pane-title]");
        const Note = this.Root.querySelector("[data-pane-sub]");
        // The head wears the same mark the rail row does, in the same colour, so the pane announces itself rather
        // than leaving the painter to match a title against a list.
        const Mark = this.Root.querySelector("[data-pane-mark]");
        if (Mark)
        {
            Mark.innerHTML = Standing?.Glyph || "";
            Mark.style.color = Standing?.Tone || "#8a8a8a";
            Mark.hidden = !Standing?.Glyph;
        }
        if (!Standing)
        {
            Title.textContent = "No paint";
            Note.textContent = "Select a layer that can be painted";
            this.RenderFootnote();
            return;
        }
        if (Standing.Ribbon !== false && !this.Padded) Body.append(this.BuildRibbon());
        Body.append(Standing.Render());
        Title.textContent = Standing.Title || Standing.Label;
        Note.textContent = Standing.Note || "";
        this.RenderFootnote();
    }

    BuildRibbon()
    {
        const Strip = document.createElement("div");
        Strip.className = "ribbon-strip bare";
        Strip.innerHTML = `<canvas class="ribbon-canvas" width="440" height="104" aria-hidden="true"></canvas>`;
        // The canvas is drawn after it is in the document, so a zero-width measurement never reaches the model.
        this.ScheduleRibbon();
        return Strip;
    }

    RenderFootnote()
    {
        const Foot = this.Root.querySelector("[data-foot-note]");
        if (!Foot) return;
        Foot.textContent = this.Masking() ? "Masking · the value of the colour is all a mask keeps" : MediaSummary(this.Media);
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
            this.DrawPad();
            this.RenderFootnote();
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(Draw);
        else Draw();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The stroke model, as pixels.
    //
    // 📝 Written as pixels rather than as canvas dabs because the model answers per point: there is no gradient stop
    //    that can describe a bristle gap, and stacking translucent arcs to fake one gets the overlaps wrong anyway.
    //
    // 🔴 One routine lays every preview in the card: the ribbon under a pane and the hand's own stroke on the test
    //    sheet. Two of them would be two answers to "what does this brush do", and the second one to be edited would
    //    quietly become the liar.
    //----------------------------------------------------------------------------------------------------------------------
    // Everything the model needs that does not change along a path. Read fresh, every draw.
    StrokeSetting()
    {
        const Media = this.Media;
        if (!Media) return null;
        const Centimetres = Clamp(this.ReadWidth(), 0.4, 60);
        const Reach = Clamp(Centimetres * 2.4, 3.5, 40);
        return {
            Media,
            Reach,
            Extent: MediaExtent(Media),
            Hardness: Clamp(this.ReadHardness(), 0, 1),
            Strength: Clamp(this.ReadStrength(), 0.02, 1),
            // The preview is drawn at the brush's real size, so a metre of surface and a pixel of preview are related
            // by one number — and the paper's tooth comes out the size it will actually be under the brush.
            Metres: Clamp(Centimetres / 100, 0.004, 0.6) / Reach,
            Ink: this.ReadInk().map((Part) => Clamp(Part, 0, 1) * 255),
        };
    }

    // The walk along a path: its running length, and the nib's width at every step of it.
    MeasurePath(Points, Media)
    {
        const Walk = [0];
        const Widths = [1];
        for (let Step = 1; Step < Points.length; Step += 1)
        {
            const [AX, AY] = Points[Step - 1];
            const [BX, BY] = Points[Step];
            Walk.push(Walk[Step - 1] + Math.hypot(BX - AX, BY - AY));
            Widths.push(MediaWidth(Media, Math.atan2(BY - AY, BX - AX)));
        }
        return { Walk, Widths };
    }

    // Lay one path into a sheet of pixels, compositing over whatever is already there. `Box` limits the work to a
    // rectangle — the whole sheet for a redraw, one segment's reach for the next inch of a live stroke.
    LayPath(Sheet, Width, Height, Points, Setting, Options = {})
    {
        if (Points.length < 2) return;
        const { Media, Reach, Extent, Hardness, Strength, Metres } = Setting;
        const { Walk, Widths } = this.MeasurePath(Points, Media);
        const Total = Walk[Walk.length - 1] || 1;
        const Ink = Options.Ink || Setting.Ink;
        const Tint = Options.Tint || null;
        const Limit = Reach * Extent + 2;
        const Steps = Points.length - 1;

        const Box = Options.Box || { Left: 0, Top: 0, Right: Width - 1, Bottom: Height - 1 };
        const Left = Math.max(0, Math.floor(Box.Left));
        const Right = Math.min(Width - 1, Math.ceil(Box.Right));
        const Top = Math.max(0, Math.floor(Box.Top));
        const Bottom = Math.min(Height - 1, Math.ceil(Box.Bottom));
        if (Right < Left || Bottom < Top) return;

        // The same entry ramp StrokeProjection applies, in the same units: no instrument lands at full weight.
        const Pressure = (Along) =>
        {
            if (!Media.Pressure) return 1;
            const Length = Math.max(Reach * (0.5 + 7 * Media.Taper), 1e-5);
            const Entry = Clamp(Along / Length, 0, 1);
            const Hand = Options.Even ? 1 : 1 - 0.18 * Math.sin((Along / Total) * Math.PI * 2.3);
            return Clamp(Hand * (1 - Media.Taper * (1 - Entry) * 0.88), 0.02, 1);
        };

        // 📝 A column index over the path. Without it every pixel would be measured against every segment of the
        //    stroke — a sixth of a second per redraw, which on a slider drag is a frozen card.
        const Reachable = [];
        for (let Column = 0; Column <= Right - Left; Column += 1) Reachable.push([]);
        const Vertical = [];
        for (let Step = 1; Step <= Steps; Step += 1)
        {
            const [AX, AY] = Points[Step - 1];
            const [BX, BY] = Points[Step];
            const Low = Math.max(Left, Math.floor(Math.min(AX, BX) - Limit));
            const High = Math.min(Right, Math.ceil(Math.max(AX, BX) + Limit));
            for (let Column = Low; Column <= High; Column += 1) Reachable[Column - Left].push(Step);
            Vertical.push([Math.min(AY, BY) - Limit, Math.max(AY, BY) + Limit]);
        }

        const Pixels = Sheet.data;
        for (let Row = Top; Row <= Bottom; Row += 1)
        {
            for (let Column = Left; Column <= Right; Column += 1)
            {
                let Closest = Infinity;
                let Side = 0;
                let Along = 0;
                let Nib = 1;
                for (const Step of Reachable[Column - Left])
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

                // 🔴 The gradient is asked here, per pixel, with the same two distances the model asks with: how far
                //    the hand has travelled, and how far it is from where it pressed. A preview that faded a flat
                //    colour instead would agree with the paint everywhere except where it matters.
                const Pigment = Tint ? Tint(Along * Metres, Math.hypot(Column - Points[0][0], Row - Points[0][1]) * Metres) : null;
                const Source = Pigment
                    ? Pigment.map((Part) => Clamp(Part, 0, 1) * 255 * Mark.Shade)
                    : Ink.map((Part) => Part * Mark.Shade);

                // Straight "over": what is underneath may be paper, an earlier stroke, or nothing at all.
                const Offset = (Row * Width + Column) * 4;
                const Under = Pixels[Offset + 3] / 255;
                const Result = Alpha + Under * (1 - Alpha);
                for (let Part = 0; Part < 3; Part += 1)
                    Pixels[Offset + Part] = (Source[Part] * Alpha + Pixels[Offset + Part] * Under * (1 - Alpha)) / Math.max(Result, 1e-6);
                Pixels[Offset + 3] = Math.round(Clamp(Result, 0, 1) * 255);
            }
        }
    }

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

        const Setting = this.StrokeSetting();
        if (!Setting) return;

        // 🔴 A white china marker on cream paper is a true preview of nothing at all. When the pigment is as pale as
        //    the sheet it would be laid on, the ribbon lays a dark ground instead.
        const Luminance = (0.2126 * Setting.Ink[0] + 0.7152 * Setting.Ink[1] + 0.0722 * Setting.Ink[2]) / 255;
        const Ground = Luminance > 0.72 ? [54, 54, 58, 255] : null;
        if (Ground) FloodSheet(Sheet, Ground);

        this.LayPath(Sheet, Width, Height, this.RibbonPath(Width, Height), Setting, { Tint: this.ReadTint() });

        Pen.clearRect(0, 0, Width, Height);
        Pen.putImageData(Sheet, 0, 0);
    }

    // The path the ribbon draws: one stroke across the strip, with a turn in it so a chisel nib shows both widths.
    RibbonPath(Width, Height)
    {
        const Steps = 24;
        const Points = [];
        for (let Step = 0; Step <= Steps; Step += 1)
        {
            const Share = Step / Steps;
            Points.push([18 + Share * (Width - 36), Height * 0.54 + Math.sin(Share * Math.PI * 1.7) * Height * 0.23]);
        }
        return Points;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The test sheet.
    //
    // 🔴 A stroke is the only honest preview of a stroke. The ribbon says what the settings mean; it cannot say what
    //    YOUR hand does with them, and a gradient that runs along the mark is a setting whose whole behaviour is in
    //    the hand. So the card grew a sheet of paper: the same model, the same pigment, the hand's own path — and
    //    nothing it does reaches the model until the hand is happy with it.
    //
    // 📝 The sheet keeps its own pixels between frames. A live stroke restores the snapshot it began from inside one
    //    segment's reach and re-lays the whole current path there, which costs a few thousand pixels a move instead
    //    of a hundred thousand — and re-laying the WHOLE path, rather than the last segment alone, is what stops the
    //    joints from coming out twice as dark as the rest of the mark.
    //----------------------------------------------------------------------------------------------------------------------
    TogglePad(Open = !this.Padded)
    {
        this.Padded = Open;
        this.Root.classList.toggle("padded", Open);
        const Pad = this.Root.querySelector("[data-pad]");
        if (Pad) Pad.hidden = !Open;
        const Button = this.Root.querySelector("[data-expand]");
        if (Button)
        {
            Button.classList.toggle("on", Open);
            Button.setAttribute("aria-expanded", Open ? "true" : "false");
            Button.title = Open ? "Close the test sheet" : "Open a test sheet";
        }
        // The ribbon and the sheet say the same thing; with the sheet open the ribbon is only a smaller copy of it.
        this.RenderPane(false);
        if (this.Open) this.Settle();
        if (Open) this.SizePad();
    }

    ClearPad()
    {
        this.PadPaths = [];
        this.PadStroke = null;
        this.PadBase = null;
        this.PadMarks = [];
        this.PadDrag = -1;
        this.DrawPad();
    }

    // The canvas takes the size of the column it sits in, once, when the sheet is opened — a canvas sized on every
    // draw is a canvas cleared on every draw, and the sheet would lose its stroke the first time a slider moved.
    SizePad()
    {
        const Canvas = this.Root.querySelector("[data-pad-canvas]");
        if (!Canvas) return;
        const Box = Canvas.getBoundingClientRect();
        const Width = Math.max(80, Math.round(Box.width || 260));
        const Height = Math.max(80, Math.round(Box.height || 420));
        if (Canvas.width !== Width || Canvas.height !== Height)
        {
            Canvas.width = Width;
            Canvas.height = Height;
        }
        this.DrawPad();
    }

    // A full redraw: paper, then every stroke on it. Called whenever a setting the model reads has changed.
    DrawPad()
    {
        if (!this.Padded) return;
        const Canvas = this.Root.querySelector("[data-pad-canvas]");
        if (!Canvas) return;
        const Print = this.ReadArtwork();
        if (Print)
        {
            this.DrawPadPrint(Print);
            return;
        }
        const Pen = Canvas.getContext("2d");
        if (!Pen || typeof Pen.createImageData !== "function") return;
        const Width = Canvas.width;
        const Height = Canvas.height;
        const Sheet = Pen.createImageData(Width, Height);
        if (!Sheet || !Sheet.data) return;
        FloodSheet(Sheet, PadPaper);

        const Setting = this.StrokeSetting();
        if (Setting)
        {
            const Tint = this.ReadTint();
            const Paths = this.PadPaths.length ? this.PadPaths : [this.PadDefault(Width, Height)];
            for (const Path of Paths) this.LayPath(Sheet, Width, Height, Path, Setting, { Tint, Even: true });
        }

        this.PadSheet = Sheet;
        this.PadBase = null;
        Pen.putImageData(Sheet, 0, 0);
        this.RenderPadNote();
    }

    // The same sheet of paper with the artwork pressed onto it instead of a stroke drawn across it: one impression in
    // the middle to be looked at, and however many the hand has pressed down to be judged against each other.
    //
    // 📝 Drawn with the image, not with the rasteriser. The artwork is already pixels — the host hands over the very
    //    canvas the surface is about to be given — so there is nothing here that could disagree with what lands.
    DrawPadPrint(Print)
    {
        const Canvas = this.Root.querySelector("[data-pad-canvas]");
        const Pen = Canvas?.getContext("2d");
        if (!Pen || typeof Pen.drawImage !== "function") return;
        const Width = Canvas.width;
        const Height = Canvas.height;

        // A new piece of artwork is a new sheet: impressions of the last one would be a lie about this one.
        if (Print.Key && Print.Key !== this.PadKey)
        {
            this.PadKey = Print.Key;
            this.PadMarks = [];
            this.PadDrag = -1;
        }

        Pen.setTransform(1, 0, 0, 1, 0, 0);
        Pen.globalAlpha = 1;
        Pen.fillStyle = `rgb(${PadPaper[0]},${PadPaper[1]},${PadPaper[2]})`;
        Pen.fillRect(0, 0, Width, Height);

        const Image = Print.Image;
        const Lay = (X, Y, Reach) =>
        {
            const Scale = Reach / Math.max(Image.width || 1, Image.height || 1);
            const Across = (Image.width || 1) * Scale;
            const Down = (Image.height || 1) * Scale;
            Pen.drawImage(Image, X - Across / 2, Y - Down / 2, Across, Down);
            return [Across, Down];
        };

        const Short = Math.min(Width, Height);
        if (!this.PadMarks.length)
        {
            const Drawn = Lay(Width / 2, Height / 2, Short * 0.74);
            // The footprint, so the empty paper around a wide piece of type still reads as part of the decal.
            Pen.strokeStyle = "rgba(0,0,0,0.16)";
            Pen.lineWidth = 1;
            Pen.strokeRect(
                Math.round((Width - Drawn[0]) / 2) + 0.5,
                Math.round((Height - Drawn[1]) / 2) + 0.5,
                Math.round(Drawn[0]) - 1,
                Math.round(Drawn[1]) - 1,
            );
        }
        else for (const Mark of this.PadMarks) Lay(Mark[0], Mark[1], Short * 0.42);

        this.PadSheet = null;
        this.PadBase = null;
        this.RenderPadNote();
    }

    RenderPadNote()
    {
        const Note = this.Root.querySelector("[data-pad-note]");
        if (!Note) return;
        if (this.ReadArtwork())
        {
            Note.textContent = this.PadMarks.length
                ? `${this.PadMarks.length} ${this.PadMarks.length === 1 ? "impression" : "impressions"} · none of it reaches the model`
                : "Press to try it here — nothing reaches the model";
            return;
        }
        Note.textContent = this.PadPaths.length
            ? `${this.PadPaths.length} ${this.PadPaths.length === 1 ? "stroke" : "strokes"} · none of it reaches the model`
            : "Draw here — nothing reaches the model";
    }

    // Until the hand draws its own, the sheet shows the stroke the ribbon would: an S down the page, at real size.
    PadDefault(Width, Height)
    {
        const Steps = 30;
        const Points = [];
        for (let Step = 0; Step <= Steps; Step += 1)
        {
            const Share = Step / Steps;
            Points.push([Width * 0.5 + Math.sin(Share * Math.PI * 1.6) * Width * 0.26, 26 + Share * (Height - 52)]);
        }
        return Points;
    }

    AttachPad()
    {
        const Canvas = this.Root.querySelector("[data-pad-canvas]");
        if (!Canvas) return;

        const Where = (Event) =>
        {
            const Box = Canvas.getBoundingClientRect();
            const Across = Canvas.width / Math.max(Box.width, 1);
            const Down = Canvas.height / Math.max(Box.height, 1);
            return [(Event.clientX - Box.left) * Across, (Event.clientY - Box.top) * Down];
        };

        Canvas.addEventListener("pointerdown", (Event) =>
        {
            Event.preventDefault();
            Canvas.setPointerCapture?.(Event.pointerId);
            // Artwork is pressed onto the sheet, not drawn across it: one impression where the finger went down,
            // and it follows the finger until it lifts.
            const Print = this.ReadArtwork();
            if (Print)
            {
                this.PadMarks.push(Where(Event));
                this.PadDrag = this.PadMarks.length - 1;
                this.DrawPadPrint(Print);
                return;
            }
            // The hand's first stroke replaces the example one rather than painting over the top of it.
            if (!this.PadPaths.length) this.DrawPadEmpty();
            this.PadStroke = [Where(Event)];
            this.PadBase = this.PadSheet ? new Uint8ClampedArray(this.PadSheet.data) : null;
        });

        Canvas.addEventListener("pointermove", (Event) =>
        {
            if (this.PadDrag >= 0)
            {
                const Print = this.ReadArtwork();
                if (!Print) return;
                this.PadMarks[this.PadDrag] = Where(Event);
                this.DrawPadPrint(Print);
                return;
            }
            if (!this.PadStroke) return;
            const Point = Where(Event);
            const Last = this.PadStroke[this.PadStroke.length - 1];
            if (Math.hypot(Point[0] - Last[0], Point[1] - Last[1]) < 1.6) return;
            this.PadStroke.push(Point);
            this.ExtendPad(Last, Point);
        });

        const Release = () =>
        {
            if (this.PadDrag >= 0)
            {
                this.PadDrag = -1;
                this.RenderPadNote();
                return;
            }
            if (!this.PadStroke) return;
            if (this.PadStroke.length > 1) this.PadPaths.push(this.PadStroke);
            this.PadStroke = null;
            this.PadBase = null;
            this.RenderPadNote();
        };
        Canvas.addEventListener("pointerup", Release);
        Canvas.addEventListener("pointercancel", Release);
    }

    // Paper and the strokes already committed to it: no example stroke, and no live one.
    DrawPadEmpty()
    {
        const Canvas = this.Root.querySelector("[data-pad-canvas]");
        const Pen = Canvas?.getContext("2d");
        if (!Pen || typeof Pen.createImageData !== "function") return;
        const Sheet = Pen.createImageData(Canvas.width, Canvas.height);
        if (!Sheet || !Sheet.data) return;
        FloodSheet(Sheet, PadPaper);
        const Setting = this.StrokeSetting();
        if (Setting)
        {
            const Tint = this.ReadTint();
            for (const Path of this.PadPaths) this.LayPath(Sheet, Canvas.width, Canvas.height, Path, Setting, { Tint, Even: true });
        }
        this.PadSheet = Sheet;
        Pen.putImageData(Sheet, 0, 0);
    }

    // One more inch of the live stroke: restore the sheet as it was when the stroke began, inside the new segment's
    // reach, and re-lay the whole stroke there.
    ExtendPad(From, To)
    {
        const Canvas = this.Root.querySelector("[data-pad-canvas]");
        const Pen = Canvas?.getContext("2d");
        if (!Pen || !this.PadSheet || !this.PadStroke) return;
        const Setting = this.StrokeSetting();
        if (!Setting) return;

        const Limit = Setting.Reach * Setting.Extent + 3;
        const Box = {
            Left: Math.min(From[0], To[0]) - Limit,
            Right: Math.max(From[0], To[0]) + Limit,
            Top: Math.min(From[1], To[1]) - Limit,
            Bottom: Math.max(From[1], To[1]) + Limit,
        };
        const Left = Math.max(0, Math.floor(Box.Left));
        const Top = Math.max(0, Math.floor(Box.Top));
        const Right = Math.min(Canvas.width - 1, Math.ceil(Box.Right));
        const Bottom = Math.min(Canvas.height - 1, Math.ceil(Box.Bottom));
        if (Right < Left || Bottom < Top) return;

        if (this.PadBase)
            for (let Row = Top; Row <= Bottom; Row += 1)
            {
                const Start = (Row * Canvas.width + Left) * 4;
                const Finish = (Row * Canvas.width + Right + 1) * 4;
                this.PadSheet.data.set(this.PadBase.subarray(Start, Finish), Start);
            }

        this.LayPath(this.PadSheet, Canvas.width, Canvas.height, this.PadStroke, Setting, {
            Tint: this.ReadTint(),
            Even: true,
            Box,
        });
        Pen.putImageData(this.PadSheet, 0, 0, Left, Top, Right - Left + 1, Bottom - Top + 1);
    }


    //----------------------------------------------------------------------------------------------------------------------
    // Behaviour.
    //----------------------------------------------------------------------------------------------------------------------
    // Point the rail at one of the host's panes. An unknown key falls back to the first rather than blanking the card.
    ShowSection(Key)
    {
        this.Section = this.Sections().some((Entry) => Entry.Key === Key) ? Key : "";
        this.RenderRail();
        this.RenderPane(true);
    }

    // The layer in hand changed under the card, or something it reads was edited elsewhere: rebuild both columns.
    Refresh()
    {
        if (this.Section && !this.Sections().some((Entry) => Entry.Key === this.Section)) this.Section = "";
        this.RenderRail();
        this.RenderPane(false);
        this.DrawPad();
    }

    // Summoned at a point, clamped so the card never opens off-screen. With no point it sits beside the viewport tools,
    // which is where the hand already is.
    Show(X, Y)
    {
        this.RenderRail();
        this.RenderPane(false);
        this.Root.classList.add("open");

        // A card that was carried somewhere is summoned back to where it was carried to, not to the anchor it was
        // first opened at — the hand moved it on purpose.
        const Viewport = document.querySelector("#viewport")?.getBoundingClientRect();
        const Carried = this.Placed && X === undefined && Y === undefined;
        const Anchor = {
            X: X ?? (Viewport ? Viewport.left + 76 : 120),
            Y: Y ?? (Viewport ? Viewport.top + Math.max(16, Viewport.height * 0.12) : 96),
        };
        if (Carried) this.Settle(this.Placed.X, this.Placed.Y);
        else this.Settle(Anchor.X, Anchor.Y);
        this.ScheduleRibbon();
        if (this.Padded) this.SizePad();
    }

    // Hold the card on screen. Called when it is summoned and again whenever it changes width, because a card that
    // grows a column while it sits against the right edge grows the column off the edge.
    Settle(X, Y)
    {
        // 📝 Measured, not assumed: the card is content-box sized, so its border box is wider than the authored width
        //    and clamping against the authored number would let an edge sit off-screen.
        const Box = this.Root.getBoundingClientRect();
        // 🔴 The authored width, not the measured one, when the two disagree: the card's width is animated, so the
        //    box measured one frame after the sheet opens is still the narrow card, and clamping against it would
        //    leave the new column to finish its slide off the edge of the screen.
        const Authored = Number.parseFloat(getComputedStyle?.(this.Root)?.getPropertyValue("--card-width")) || 0;
        const Width = Math.max(Box.width || 560, Authored);
        const Height = Box.height || Math.min(560, window.innerHeight * 0.86);
        const Margin = 10;
        const Left = X ?? Box.left;
        const Top = Y ?? Box.top;
        this.Root.style.left = `${Math.round(Clamp(Left, Margin, Math.max(Margin, window.innerWidth - Width - Margin)))}px`;
        this.Root.style.top = `${Math.round(Clamp(Top, Margin, Math.max(Margin, window.innerHeight - Height - Margin)))}px`;
    }

    Hide()
    {
        this.Root.classList.remove("open");
    }

    // 🔴 One key, two states. Tab used to WALK the rail — open, next pane, next, … and out the far end — and the
    //    hand that only wanted the card gone had to press it four more times to get there. The rail is a column of
    //    rows a finger can already reach; the keyboard's job is the card itself.
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
                if (this.Pinned || !this.Open) return;
                if (!this.Root.contains(Event.target) && !Event.target.closest?.("#instrument-button")) this.Hide();
            },
            true,
        );

        window.addEventListener("keydown", (Event) =>
        {
            if (Event.key !== "Escape" || !this.Open) return;
            this.Hide();
            Event.preventDefault();
        });
    }
}

export { Line as CardArrow };

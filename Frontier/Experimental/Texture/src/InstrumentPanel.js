//============================================================================================================================================
// 🎨 InstrumentPanel.js — the summoned card: a rail of paint properties, a pane each, and a ribbon of the mark they make
//============================================================================================================================================
// The card is about the paint in hand and nothing else — its colour, its shape, the grain it drags out of the paper, how
// it tapers, how it is laid down and how far it lags the hand. There is no library of brushes here and no row of colour
// chips: picking an instrument is a different act from tuning one, and a card that tried to be both was a card where the
// settings were always one slide away from the thing they described.
//
// Every pane is the host's. The card owns the rail, the frame, the ribbon and the way Tab walks through them; it is handed
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

        this.Section = "";

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
                    <div class="tool-rail" data-rail></div>
                    <div class="tool-body">
                        <div class="pane-head">
                            <div><div class="pane-title" data-pane-title></div><div class="pane-sub" data-pane-sub></div></div>
                            <kbd class="pane-key">Tab</kbd>
                        </div>
                        <div class="pane-scroll"><div class="tool-sheet" data-pane></div></div>
                        <div class="pane-foot"><span data-foot-note></span></div>
                    </div>
                </div>
            </div>`;
        this.RenderRail();
    }

    RenderRail()
    {
        const Rail = this.Root.querySelector("[data-rail]");
        if (!Rail) return;
        const Panes = this.Sections();
        const Standing = Panes.find((Entry) => Entry.Key === this.Section) || Panes[0] || null;
        Rail.innerHTML = Panes.length
            ? Panes.map(
                  (Entry) => `
            <button class="rail-item ${Entry.Key === Standing?.Key ? "active" : ""}" data-section="${Escape(Entry.Key)}"
                    title="${Escape(Entry.Note || Entry.Label)}">
                ${
                    // 🔴 The mark is raw markup, not the name of one. The card has no icon sheet of its own and no
                    //    business importing the panel's: the host draws from whichever set it uses and hands the
                    //    finished svg over, exactly as it does for the slider rows.
                    Entry.Glyph
                        ? `<span class="rail-mark" style="color:${Entry.Tone || "#8a8a8a"}">${Entry.Glyph}</span>`
                        : `<span class="rail-dot" style="background:${Entry.Tone || "#8a8a8a"}"></span>`
                }
                <span>${Escape(Entry.Label)}</span>
                ${Entry.Tally === undefined ? "" : `<span class="rail-tally">${Escape(String(Entry.Tally))}</span>`}
            </button>`,
              ).join("")
            : `<div class="rail-split">Nothing to paint with</div>`;
        for (const Button of Rail.querySelectorAll("[data-section]"))
            Button.addEventListener("click", () => this.ShowSection(Button.dataset.section));
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
        if (!Standing)
        {
            Title.textContent = "No paint";
            Note.textContent = "Select a layer that can be painted";
            this.RenderFootnote();
            return;
        }
        if (Standing.Ribbon !== false) Body.append(this.BuildRibbon());
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
            this.RenderFootnote();
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(Draw);
        else Draw();
    }

    //----------------------------------------------------------------------------------------------------------------------
    // The ribbon.
    //
    // 📝 Written as pixels rather than as canvas dabs because the model answers per point: there is no gradient stop
    //    that can describe a bristle gap, and stacking translucent arcs to fake one gets the overlaps wrong anyway.
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

        const Media = this.Media;
        if (!Media) return;
        const Hardness = Clamp(this.ReadHardness(), 0, 1);
        const Strength = Clamp(this.ReadStrength(), 0.02, 1);
        const Centimetres = Clamp(this.ReadWidth(), 0.4, 60);
        const Reach = Clamp(Centimetres * 2.4, 3.5, 40);
        const Extent = MediaExtent(Media);
        // The preview is drawn at the brush's real size, so a metre of surface and a pixel of ribbon are related by one
        // number — and the paper's tooth comes out the size it will actually be under the brush.
        const Metres = Clamp(Centimetres / 100, 0.004, 0.6) / Reach;
        const [Red, Green, Blue] = this.ReadInk().map((Part) => Clamp(Part, 0, 1) * 255);

        // 🔴 A white china marker on cream paper is a true preview of nothing at all. When the pigment is as pale as the
        //    sheet it would be laid on, the ribbon lays a dark ground instead.
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
        //    of the stroke — a sixth of a second per redraw, which on a slider drag is a frozen card.
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
    }

    // Tab walks the rail: closed → first pane → next → … → closed. The key that opened the card is the one that leaves it.
    Step()
    {
        if (!this.Open)
        {
            this.Show();
            return;
        }
        const Panes = this.Sections();
        const Standing = this.Standing;
        const Index = Panes.findIndex((Entry) => Entry.Key === Standing?.Key);
        if (Index < 0 || Index >= Panes.length - 1)
        {
            this.Hide();
            return;
        }
        this.ShowSection(Panes[Index + 1].Key);
    }

    // Summoned at a point, clamped so the card never opens off-screen. With no point it sits beside the viewport tools,
    // which is where the hand already is.
    Show(X, Y)
    {
        this.RenderRail();
        this.RenderPane(false);
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
        const Height = Box.height || Math.min(560, window.innerHeight * 0.86);
        const Margin = 10;
        this.Root.style.left = `${Math.round(Clamp(Anchor.X, Margin, Math.max(Margin, window.innerWidth - Width - Margin)))}px`;
        this.Root.style.top = `${Math.round(Clamp(Anchor.Y, Margin, Math.max(Margin, window.innerHeight - Height - Margin)))}px`;
        this.ScheduleRibbon();
    }

    Hide()
    {
        this.Root.classList.remove("open");
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

        window.addEventListener("keydown", (Event) =>
        {
            if (Event.key !== "Escape" || !this.Open) return;
            this.Hide();
            Event.preventDefault();
        });
    }
}

export { Line as CardArrow };

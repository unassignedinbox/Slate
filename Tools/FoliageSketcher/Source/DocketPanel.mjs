//============================================================================================================================================
// 📦 DocketPanel — the Slate-kit inspector: tabs, rows and widgets generated from the parameter declarations.
//============================================================================================================================================
// Every widget here is the DOM twin of a ControlKit widget in Engine/DisplayPresentation/ControlKit.h — same
//    geometry, same tokens, same behaviour. The panel is deliberately data-driven: a new parameter appears in the
//    docket the moment it is declared in SpeciesCriteria, which is what keeps a dense tool from becoming cluttered.

import {
    ParameterDeclaration, ScatterDeclaration, EnvironmentDeclaration,
    ArchetypeOrder, SpeciesArchetype, Degrees, Radians
} from "./SpeciesCriteria.mjs";

const Icon =
{
    Caret: `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     WIDGET BUILDERS
//------------------------------------------------------------------------------------------------------------------------

function Element(Tag, ClassName, Contents)
{
    const Node = document.createElement(Tag);
    if (ClassName) Node.className = ClassName;
    if (Contents !== undefined) Node.innerHTML = Contents;
    return Node;
}

// .crow — 110 px dim label, control to the right.
function ControlRow(Label)
{
    const Row = Element("div", "crow");
    Row.appendChild(Element("div", "clabel", Label));
    return Row;
}

function SectionHeading(Title, Description)
{
    const Head = Element("div", "shead");
    Head.appendChild(Element("div", "st", Title));
    if (Description) Head.appendChild(Element("div", "ss", Description));
    return Head;
}

// input[type=range].slider + .vpill readout, wired as one unit.
function SliderRow(Declaration, Value, OnChange)
{
    const Row   = ControlRow(Declaration.Label);
    const Pill  = Element("div", "vpill narrow");
    const Number_ = Element("div", "num");
    const Unit  = Element("div", "unit", Declaration.Unit || "—");
    Pill.append(Number_, Unit);

    const Slider = document.createElement("input");
    Slider.type      = "range";
    Slider.className = "slider thin";
    Slider.min       = String(Declaration.Minimum);
    Slider.max       = String(Declaration.Maximum);
    Slider.step      = String(Declaration.Step);

    // Angular parameters are stored in radians and shown in degrees; Scale handles m → cm and fraction → %.
    const ToDisplay = (Stored) => Declaration.Angular ? Degrees(Stored) : Stored * (Declaration.Scale ?? 1.0);
    const ToStored  = (Shown)  => Declaration.Angular ? Radians(Shown)  : Shown / (Declaration.Scale ?? 1.0);

    const Render = (Stored) =>
    {
        const Shown = ToDisplay(Stored);
        Slider.value      = String(Shown);
        Number_.textContent = Declaration.Integral ? String(Math.round(Shown))
                          : Math.abs(Shown) >= 100 ? Shown.toFixed(0)
                          : Math.abs(Shown) >= 10  ? Shown.toFixed(1)
                          : Shown.toFixed(2);

        // The filled side of the track is painted with a gradient stop, exactly as the kit specifies.
        const Fraction = (Shown - Declaration.Minimum) / (Declaration.Maximum - Declaration.Minimum);
        Slider.style.background =
            `linear-gradient(to right,#7a7a7a ${Fraction * 100}%,var(--raised) ${Fraction * 100}%)`;
    };

    Slider.addEventListener("input", () =>
    {
        const Stored = ToStored(Number(Slider.value));
        Render(Stored);
        OnChange(Stored);
    });

    Render(Value);
    Row.append(Pill, Slider);
    Row.Render = Render;
    return Row;
}

// .switch — 46 × 26 pill.
function SwitchRow(Label, Description, Value, OnChange)
{
    const Row = Element("div", "toggle-row");
    Row.dataset.on = String(Value);

    const Text = Element("div");
    Text.style.flex = "1";
    Text.appendChild(Element("div", "tl", Label));
    if (Description) Text.appendChild(Element("div", "tsub", Description));

    const Switch = Element("div", "switch");
    Switch.dataset.on = String(Value);

    Row.append(Text, Switch);
    Row.addEventListener("click", () =>
    {
        const Next = Row.dataset.on !== "true";
        Row.dataset.on = String(Next);
        Switch.dataset.on = String(Next);
        OnChange(Next);
    });
    return Row;
}

// .dd — pill with split caret cell and a floating menu.
function DropdownRow(Label, Options, SelectedKey, OnChange)
{
    const Row  = ControlRow(Label);
    const Wrap = Element("div", "dd");

    const Button  = Element("div", "dd-btn");
    const Current = Element("div", "cur", Options.find((Option) => Option.Key === SelectedKey)?.Label ?? "—");
    const Caret   = Element("div", "caret", Icon.Caret);
    Button.append(Current, Caret);

    const Menu = Element("div", "dd-menu");
    for (const Option of Options)
    {
        const Entry = Element("div", `opt${Option.Key === SelectedKey ? " sel" : ""}`, Option.Label);
        Entry.addEventListener("click", (Event) =>
        {
            Event.stopPropagation();
            Wrap.classList.remove("open");
            Current.textContent = Option.Label;
            for (const Sibling of Menu.children) Sibling.classList.remove("sel");
            Entry.classList.add("sel");
            OnChange(Option.Key);
        });
        Menu.appendChild(Entry);
    }

    Button.addEventListener("click", (Event) =>
    {
        Event.stopPropagation();
        const WasOpen = Wrap.classList.contains("open");
        for (const Other of document.querySelectorAll(".dd.open")) Other.classList.remove("open");
        Wrap.classList.toggle("open", !WasOpen);
    });
    document.addEventListener("click", () => Wrap.classList.remove("open"));

    Wrap.append(Button, Menu);
    Row.appendChild(Wrap);
    return Row;
}

// .seg — pill group. Stacks the label above the group when the cells would otherwise be squeezed illegible.
function SegmentedRow(Label, Labels, ActiveIndex, OnChange, Stacked = false)
{
    const Row = ControlRow(Label);
    if (Stacked || Labels.length > 3) Row.classList.add("stack");
    const Group = Element("div", "seg");
    Labels.forEach((Text, Index) =>
    {
        const Button = Element("button", Index === ActiveIndex ? "active" : "", Text);
        Button.addEventListener("click", () =>
        {
            for (const Sibling of Group.children) Sibling.classList.remove("active");
            Button.classList.add("active");
            OnChange(Index);
        });
        Group.appendChild(Button);
    });
    Row.appendChild(Group);
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      DOCKET PANEL
//------------------------------------------------------------------------------------------------------------------------

const TabOrder = ["Species", "Growth", "Foliage", "Physics", "Scatter", "World"];

export class DocketPanel
{
    constructor(Host)
    {
        this.Host      = Host;
        this.ActiveTab = "Species";
        this.Strip     = document.getElementById("TabStrip");
        this.Body      = document.getElementById("DocketBody");
        this.Hint      = document.getElementById("DocketHint");
        this.Subtitle  = document.getElementById("DocketSub");

        this.#BuildStrip();
        this.Rebuild();

        document.getElementById("RegrowPlant").addEventListener("click",  () => Host.Regrow());
        document.getElementById("ShufflePlant").addEventListener("click", () => Host.Reseed());
        document.getElementById("ResetSpecies").addEventListener("click", () => Host.ResetSpecies());
    }

    #BuildStrip()
    {
        this.Strip.innerHTML = "";
        for (const Tab of TabOrder)
        {
            const Chip = Element("button", `chip${Tab === this.ActiveTab ? " active" : ""}`, Tab);
            Chip.addEventListener("click", () =>
            {
                this.ActiveTab = Tab;
                for (const Sibling of this.Strip.children) Sibling.classList.remove("active");
                Chip.classList.add("active");
                this.Rebuild();
            });
            this.Strip.appendChild(Chip);
        }
    }

    ReportHint(Text)   { this.Hint.textContent = Text; }
    ReportSubtitle(Text) { this.Subtitle.textContent = Text; }

    //--------------------------------------------------------------------------------------------------------------

    Rebuild()
    {
        const Host = this.Host;
        this.Body.innerHTML = "";

        if (this.ActiveTab === "Species")   this.#BuildSpecies();
        else if (this.ActiveTab === "Scatter") this.#BuildScatter();
        else if (this.ActiveTab === "World")   this.#BuildWorld();
        else this.#BuildParameters(this.ActiveTab);
    }

    #BuildSpecies()
    {
        const Host = this.Host;

        this.Body.appendChild(SectionHeading("Archetype",
            "Each archetype seeds the growth, foliage and physics tabs with a coherent starting point."));

        this.Body.appendChild(DropdownRow("Species",
            ArchetypeOrder.map((Key) => ({ Key, Label: SpeciesArchetype[Key].DisplayName })),
            Host.Criteria.Archetype,
            (Key) => Host.AssignArchetype(Key)));

        this.Body.appendChild(SegmentedRow("Silhouette", ["Tree", "Rosette", "Vine", "Shrub"],
            ["Tree", "Rosette", "Vine", "Shrub"].indexOf(Host.Criteria.Silhouette),
            (Index) =>
            {
                Host.Criteria.Silhouette = ["Tree", "Rosette", "Vine", "Shrub"][Index];
                Host.Regrow();
            }));

        this.Body.appendChild(Element("div", "sep"));
        this.Body.appendChild(SectionHeading("Foliage families",
            "Which cutout families this species may draw from. Families come from the baked sheet."));

        const Families = ["Broadleaf", "Fern", "VineLeaf", "Tendril", "Flower", "Grass"];
        for (const Family of Families)
        {
            const Available = (Host.Sheet.Grouped[Family] ?? []).length;
            this.Body.appendChild(SwitchRow(Family,
                Available > 0 ? `${Available} cutouts in the sheet` : "not present in the sheet",
                Host.Criteria.FoliageFamily.includes(Family),
                (On) =>
                {
                    const Set_ = new Set(Host.Criteria.FoliageFamily);
                    On ? Set_.add(Family) : Set_.delete(Family);
                    Host.Criteria.FoliageFamily = [...Set_];
                    Host.Regrow();
                }));
        }

        this.Body.appendChild(Element("div", "sep"));
        this.Body.appendChild(SectionHeading("Seed", "The plot regenerates identically from the same seed."));

        const SeedRow = ControlRow("Seed");
        const SeedPill = Element("div", "vpill");
        const SeedNumber = Element("div", "num", String(Host.Seed));
        SeedPill.append(SeedNumber, Element("div", "unit", "#"));
        const SeedButton = Element("button", "btn small", "Shuffle");
        SeedButton.style.flex = "1";
        SeedButton.addEventListener("click", () => { Host.Reseed(); SeedNumber.textContent = String(Host.Seed); });
        SeedRow.append(SeedPill, SeedButton);
        this.Body.appendChild(SeedRow);
    }

    #BuildParameters(Tab)
    {
        const Host = this.Host;
        const Blurb =
        {
            Growth:  "Branch topology and the shape of the skeleton the physics will solve.",
            Foliage: "How cards are chosen, sized and scattered across the skeleton.",
            Physics: "Per-joint solver tuning. Stiffness and damping are what separate a reed from a branch."
        };

        this.Body.appendChild(SectionHeading(Tab, Blurb[Tab]));

        for (const Declaration of ParameterDeclaration.filter((Record) => Record.Tab === Tab))
        {
            const Row = SliderRow(Declaration, Host.Criteria[Declaration.Key], (Value) =>
            {
                Host.Criteria[Declaration.Key] = Value;
                // Physics tuning is uploaded live; anything topological needs a regrow.
                Tab === "Physics" ? Host.RefreshTuning() : Host.RequestRegrow();
            });
            this.Body.appendChild(Row);
        }

        if (Tab === "Physics")
        {
            this.Body.appendChild(Element("div", "sep"));
            this.Body.appendChild(SectionHeading("Solver",
                "Iterations trade accuracy for cost. Substeps buy stability under strong wind."));

            for (const Declaration of [
                { Key: "IterationCount", Label: "Iterations", Unit: "", Minimum: 1, Maximum: 32, Step: 1, Integral: true },
                { Key: "SubstepCount",   Label: "Substeps",   Unit: "", Minimum: 1, Maximum: 6,  Step: 1, Integral: true }])
            {
                this.Body.appendChild(SliderRow(Declaration, Host.Environment[Declaration.Key],
                    (Value) => { Host.Environment[Declaration.Key] = Math.round(Value); }));
            }

            // Jacobi damping. Exposed because it is the dial that decides whether a dense plot settles or shimmers.
            this.Body.appendChild(SliderRow(
                { Key: "UnderRelaxation", Label: "Relaxation", Unit: "", Minimum: 0.15, Maximum: 1.0, Step: 0.05 },
                Host.Environment.UnderRelaxation,
                (Value) => { Host.Environment.UnderRelaxation = Value; }));

            this.Body.appendChild(SwitchRow("Collision", "Project joints out of the interaction spheres",
                Host.Environment.CollisionOn, (On) => { Host.Environment.CollisionOn = On; }));
        }
    }

    #BuildScatter()
    {
        const Host = this.Host;
        this.Body.appendChild(SectionHeading("Overgrowth",
            "Fills the plot with the active species plus companions, all solved in the same lattice."));

        for (const Declaration of ScatterDeclaration)
        {
            this.Body.appendChild(SliderRow(Declaration, Host.Scatter[Declaration.Key], (Value) =>
            {
                Host.Scatter[Declaration.Key] = Declaration.Integral ? Math.round(Value) : Value;
                Host.RequestRegrow();
            }));
        }

        this.Body.appendChild(Element("div", "sep"));
        this.Body.appendChild(SectionHeading("Companions",
            "Species mixed into the plot around the hero plant."));

        for (const Key of ArchetypeOrder)
        {
            this.Body.appendChild(SwitchRow(SpeciesArchetype[Key].DisplayName, null,
                Host.Scatter.Companions.includes(Key),
                (On) =>
                {
                    const Set_ = new Set(Host.Scatter.Companions);
                    On ? Set_.add(Key) : Set_.delete(Key);
                    Host.Scatter.Companions = [...Set_];
                    Host.RequestRegrow();
                }));
        }
    }

    #BuildWorld()
    {
        const Host = this.Host;
        this.Body.appendChild(SectionHeading("Environment",
            "Wind drives the solver; the sun drives the two-sided foliage response."));

        for (const Declaration of EnvironmentDeclaration)
        {
            this.Body.appendChild(SliderRow(Declaration, Host.Environment[Declaration.Key], (Value) =>
            {
                Host.Environment[Declaration.Key] = Value;
            }));
        }

        this.Body.appendChild(Element("div", "sep"));
        this.Body.appendChild(SectionHeading("Display", "What the viewport draws."));

        this.Body.appendChild(SegmentedRow("Debug", ["Shaded", "Albedo", "Normal", "Transl.", "AO"],
            [0, 1, 2, 3, 5].indexOf(Host.Environment.DebugCategory),
            (Index) => { Host.Environment.DebugCategory = [0, 1, 2, 3, 5][Index]; }));

        this.Body.appendChild(SwitchRow("Ground plane",  null, Host.Environment.GroundOn,     (On) => { Host.Environment.GroundOn = On; }));
        this.Body.appendChild(SwitchRow("Foliage cards", null, Host.Environment.ShowFoliage,  (On) => { Host.Environment.ShowFoliage = On; }));
        this.Body.appendChild(SwitchRow("Bark tubes",    null, Host.Environment.ShowBranches, (On) => { Host.Environment.ShowBranches = On; }));
        this.Body.appendChild(SwitchRow("Collider shell", "Drag it in the viewport to push the plants",
            Host.Environment.ShowCollider, (On) => { Host.Environment.ShowCollider = On; }));
    }
}

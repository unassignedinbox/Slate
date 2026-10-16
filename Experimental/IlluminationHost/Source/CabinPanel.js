//============================================================================================================================
//                                                          CABINPANEL.JS
//============================================================================================================================
// 🧩 The cabin's own HMI: the hexagon cluster DriveCabinLayout::DashboardCluster describes, mounted on the steering wheel,
//    and the centre tablet DashboardTablet, both drawn as facet geometry whose segments are lit and dimmed by rewriting
//    family words in the display sets' vertex records — the same emissive quads the surface projection shades, at the
//    refresh rates the C++ HMI runs at (cluster 30 Hz, tablet 15 Hz while dirty).

// 📝 Why geometry and not a texture: a display here is a plate whose lit segments are their own facets, so the emissive
//    family carries the radiance into the GI path (the screen is a light in the cabin) with no new bindings, no texture
//    upload and no new pass. Update() re-encodes only the twelve segments that changed and writes their vertex range.

import { EmitScreenQuad, CabinFixtures, CabinScreenBasis } from "./CabinStructure.js";
import { NormalizeVector, CrossVector, SubtractVector, ConstructIdentityTransform } from "./TransformProjection.js";
import { CourseMaterial } from "./MaterialSpecification.js";

const VertexStride = 32;         // [B]  matches FacetStructure
const ClusterRate  = 30.0;       // [Hz] the cluster refreshes on the device
const TabletRate   = 15.0;       // [Hz] the tablet, when something it shows has changed
const RedlineRPM   = 7000.0;     // [rpm] where the arc goes red
const MaximumRPM   = 8500.0;     // [rpm] the arc's end
const MaximumSpeed = 90.0;       // [m/s] the speed bar's end, ≈ 324 km/h

//------------------------------------------------------------------------------------------------------------------------
//                                                   SEGMENT BUILDER
//------------------------------------------------------------------------------------------------------------------------

// 📝 A display under construction: facets accumulate into one set, and each push remembers the facet range it wrote and
//    the rule that decides the family it wears — one rule per segment, evaluated against the vehicle's telemetry.
class DisplayBuilder
{
    constructor()
    {
        this.Facets   = [];
        this.Segments = [];
    }

    Push(Rule, Emit)
    {
        const Start = this.Facets.length;
        Emit(this.Facets);
        const Count = this.Facets.length - Start;
        if (Count > 0)
            this.Segments.push({ Start, Count, Rule });
        return this.Segments.length - 1;
    }

    Resolve(Telemetry)
    {
        return this.Segments.map((Segment) => Segment.Rule(Telemetry));
    }
}

// 📐 One seven-segment digit in the display's own plane: seven bars, each its own segment, lit when the gear's pattern
//    uses that bar. The bars are listed a–g, clockwise from the top.
function EmitGearDigit(Builder, Basis, Centre, Width, Height, Offset = [0.0, 0.0])
{
    const Half = [Width * 0.5, Height * 0.5], Bar = Math.max(0.004, Width * 0.17);
    const Bars = [
        [-Half[0], Half[1] - Bar, Half[0], Half[1]],
        [Half[0] - Bar, 0.0, Half[0], Half[1]],
        [Half[0] - Bar, -Half[1], Half[0], 0.0],
        [-Half[0], -Half[1], Half[0], -Half[1] + Bar],
        [-Half[0], -Half[1], -Half[0] + Bar, 0.0],
        [-Half[0], 0.0, -Half[0] + Bar, Half[1]],
        [-Half[0], -0.5 * Bar, Half[0], 0.5 * Bar]
    ];
    Bars.forEach(([U0, V0, U1, V1], Segment) =>
    {
        Builder.Push((Telemetry) =>
        {
            if (!(DigitPatterns[Telemetry.Gear] || []).includes(Segment))
                return CourseMaterial.CabinScreenDim;
            return Telemetry.EngineRPM > RedlineRPM ? CourseMaterial.CabinScreenRed : CourseMaterial.CabinScreen;
        }, (Facets) => EmitScreenQuad(Facets, Centre, Basis, U0 + Offset[0], V0 + Offset[1], U1 + Offset[0], V1 + Offset[1],
                                      CourseMaterial.CabinScreenDim));
    });
}

// 📝 The digit patterns the cluster's gear readout uses: bars a–g, indexed as above; "R" and "N" are spelled in bars.
const DigitPatterns = Object.freeze({
    "R": [4, 6, 5],
    "N": [4, 2, 5, 1],
    "1": [1, 2], "2": [0, 1, 6, 4, 3], "3": [0, 1, 6, 2, 3], "4": [5, 6, 1, 2], "5": [0, 5, 6, 2, 3], "6": [0, 5, 6, 4, 2, 3]
});

//------------------------------------------------------------------------------------------------------------------------
//                                                       PANEL
//------------------------------------------------------------------------------------------------------------------------

// 📝 Builds both displays as facet sets with their own occupants (the cluster rides the steering wheel's transform, the
//    tablet the body's), and keeps the rules that light them.
export class CabinPanel
{
    constructor(Scene, Roles)
    {
        this.ClusterBuilder = new DisplayBuilder();
        this.TabletBuilder  = new DisplayBuilder();
        this.ConstructCluster();
        this.ConstructTablet();
        // 📝 No degenerate filter here: the segments index into these facet arrays, so their order is load-bearing —
        //    the display quads are all authored with real extents, and nothing is ever dropped.
        this.Cluster = { Set: Scene.ConstructFacetSet("Cabin cluster display", this.ClusterBuilder.Facets, 0.01, 40.0),
                         Segments: this.ClusterBuilder.Segments, Occupant: -1, Accumulator: 0.0 };
        this.Tablet  = { Set: Scene.ConstructFacetSet("Cabin tablet display", this.TabletBuilder.Facets, 0.01, 40.0),
                         Segments: this.TabletBuilder.Segments, Occupant: -1, Accumulator: 0.0 };
        const Identity = ConstructIdentityTransform();
        this.Cluster.Occupant = Scene.ConstructOccupant("Cabin cluster display", this.Cluster.Set, Identity, Roles);
        this.Tablet.Occupant  = Scene.ConstructOccupant("Cabin tablet display", this.Tablet.Set, Identity, Roles);
        this.Cluster.Facets = this.ClusterBuilder.Facets;
        this.Tablet.Facets  = this.TabletBuilder.Facets;
        this.Cluster.Staging = new ArrayBuffer(0);
        this.Tablet.Staging  = new ArrayBuffer(0);
        this.Written = { Cluster: [], Tablet: [] };
    }

    // ① the hexagon cluster: plate, bezel, rpm arc, speed bar, gear digit, warning lamps — all mounted on the wheel's hub
    ConstructCluster()
    {
        const Fixture = CabinFixtures.Cluster, Builder = this.ClusterBuilder;
        const Basis = { Right: [1.0, 0.0, 0.0], Up: [0.0, 1.0, 0.0], Toward: [0.0, 0.0, 1.0] };   // the wheel's own frame
        const Centre = [0.0, 0.0, 0.040];                                                          // proud of the hub's crown
        // 📐 Every element sits its own step off the plate along the face normal: coplanar quads z-fight, and a display
        //    that flickers is worse than one a millimetre deep. The step is 0.6 mm and each layer adds one.
        const Layer = (Steps) => [Centre[0] + Basis.Toward[0] * 0.0006 * Steps, Centre[1] + Basis.Toward[1] * 0.0006 * Steps,
                                  Centre[2] + Basis.Toward[2] * 0.0006 * Steps];
        const [HalfWidth, HalfHeight] = [Fixture.Width * 0.5, Fixture.Height * 0.5];
        const Dark = CourseMaterial.CabinScreenDim, Lit = CourseMaterial.CabinScreen;

        // 📝 The plate: a flat-topped hexagon, fan-triangulated, with a bezel outline around it.
        const Hexagon = [[-HalfWidth, 0.0], [-HalfWidth * 0.5, HalfHeight], [HalfWidth * 0.5, HalfHeight],
                         [HalfWidth, 0.0], [HalfWidth * 0.5, -HalfHeight], [-HalfWidth * 0.5, -HalfHeight]];
        Builder.Push(() => Dark, (Facets) =>
        {
            for (let Corner = 1; Corner + 1 < Hexagon.length; ++Corner)
                Facets.push({ Corners: [Point(Layer(0), Basis, Hexagon[0]), Point(Layer(0), Basis, Hexagon[Corner + 1]), Point(Layer(0), Basis, Hexagon[Corner])],
                              Family: Dark });
        });
        for (let Corner = 0; Corner < Hexagon.length; ++Corner)
        {
            const [U0, V0] = Hexagon[Corner], [U1, V1] = Hexagon[(Corner + 1) % Hexagon.length];
            const Outer = [U0 * 1.02, V0 * 1.02], Outer1 = [U1 * 1.02, V1 * 1.02];
            // 📝 The bezel is the band between the plate's edge and an outline 2 % larger — exactly those two triangles,
            //    not the plate's own quad again.
            Builder.Push(() => Dark, (Facets) =>
            {
                Facets.push({ Corners: [Point(Layer(1), Basis, [U0, V0]), Point(Layer(1), Basis, Outer), Point(Layer(1), Basis, Outer1)], Family: Dark });
                Facets.push({ Corners: [Point(Layer(1), Basis, [U0, V0]), Point(Layer(1), Basis, Outer1), Point(Layer(1), Basis, [U1, V1])], Family: Dark });
            });
        }

        // 📝 The rev arc: thirty-two wedge segments over the top of the dial. The plate is wide and short, so the arc is
        //    an ellipse rather than a circle — inner and outer radii inset by the band's thickness.
        const Segments = 32, ArcCentre = [0.0, -0.008], ArcX = HalfWidth * 0.79, ArcY = HalfHeight * 0.82, Band = HalfHeight * 0.24;
        for (let Segment = 0; Segment < Segments; ++Segment)
        {
            const Fraction = Segment / Segments;
            const θ0 = Math.PI * (0.89 - 0.78 * Fraction), θ1 = Math.PI * (0.89 - 0.78 * (Fraction + 1.0 / Segments));
            Builder.Push((Telemetry) =>
            {
                const Level = Math.min(1.0, Math.max(0.0, Telemetry.EngineRPM / MaximumRPM));
                if (Fraction + 1.0 / Segments > Level)
                    return Dark;
                return Telemetry.EngineRPM > RedlineRPM ? CourseMaterial.CabinScreenRed : Lit;
            }, (Facets) =>
            {
                const A = [ArcCentre[0] + Math.cos(θ0) * (ArcX - Band), ArcCentre[1] + Math.sin(θ0) * (ArcY - Band)];
                const B = [ArcCentre[0] + Math.cos(θ1) * (ArcX - Band), ArcCentre[1] + Math.sin(θ1) * (ArcY - Band)];
                const C = [ArcCentre[0] + Math.cos(θ1) * ArcX, ArcCentre[1] + Math.sin(θ1) * ArcY];
                const D = [ArcCentre[0] + Math.cos(θ0) * ArcX, ArcCentre[1] + Math.sin(θ0) * ArcY];
                Facets.push({ Corners: [Point(Layer(2), Basis, A), Point(Layer(2), Basis, B), Point(Layer(2), Basis, C)], Family: Dark });
                Facets.push({ Corners: [Point(Layer(2), Basis, A), Point(Layer(2), Basis, C), Point(Layer(2), Basis, D)], Family: Dark });
            });
        }

        // 📝 The speed bar: sixteen segments across the foot of the hexagon.
        const Bars = 16, BarWidth = HalfWidth * 0.94 / Bars;
        for (let Bar = 0; Bar < Bars; ++Bar)
        {
            const U0 = -HalfWidth * 0.47 + Bar * BarWidth + BarWidth * 0.12, U1 = U0 + BarWidth * 0.76;
            Builder.Push((Telemetry) =>
            {
                const Level = Math.min(1.0, Math.abs(Telemetry.Speed) / MaximumSpeed);
                return (Bar + 1.0) / Bars <= Level ? (Telemetry.Speed < 0.0 ? CourseMaterial.CabinScreenAmber : Lit) : Dark;
            }, (Facets) => EmitScreenQuad(Facets, Layer(2), Basis, U0, -HalfHeight * 0.86, U1, -HalfHeight * 0.68, Dark));
        }

        // 📝 The gear: one seven-segment digit in the middle of the plate, red above the redline.
        EmitGearDigit(Builder, Basis, Layer(3), HalfWidth * 0.30, HalfHeight * 0.52, [0.0, HalfHeight * 0.06]);

        // 📝 Two tell-tales under the bar: the tyre-pressure lamp and the boost lamp, lit by the fixture's own thresholds.
        for (let Lamp = 0; Lamp < 2; ++Lamp)
        {
            const U = -HalfWidth * 0.72 + Lamp * 0.052;
            Builder.Push((Telemetry) =>
            {
                if (Lamp === 0)
                    return Telemetry.Pressures.some((Pressure) => Pressure < 150.0) ? CourseMaterial.CabinScreenAmber : Dark;
                return Telemetry.Boost > 0.85 ? CourseMaterial.CabinScreenRed : Dark;
            }, (Facets) => EmitScreenQuad(Facets, Layer(2), Basis, U, -HalfHeight * 0.50, U + 0.030, -HalfHeight * 0.50 + 0.026, Dark));
        }
    }

    // ② the centre tablet: bezel, plate and a four-by-three grid of tiles, one readout each
    ConstructTablet()
    {
        const Fixture = CabinFixtures.Tablet, Builder = this.TabletBuilder;
        const Basis = CabinScreenBasis(Fixture.Tilt), Centre = Fixture.Centre;
        const [HalfWidth, HalfHeight] = [Fixture.Width * 0.5, Fixture.Height * 0.5];
        const Dark = CourseMaterial.CabinScreenDim, Lit = CourseMaterial.CabinScreen;
        const Layer = (Steps) => [Centre[0] + Basis.Toward[0] * 0.0006 * Steps, Centre[1] + Basis.Toward[1] * 0.0006 * Steps,
                                  Centre[2] + Basis.Toward[2] * 0.0006 * Steps];
        Builder.Push(() => Dark, (Facets) => EmitScreenQuad(Facets, Layer(0), Basis, -HalfWidth, -HalfHeight, HalfWidth, HalfHeight, Dark));
        for (const [U0, V0, U1, V1] of [[-HalfWidth, HalfHeight - 0.012, HalfWidth, HalfHeight], [-HalfWidth, -HalfHeight, HalfWidth, -HalfHeight + 0.012],
                                        [-HalfWidth, -HalfHeight, -HalfWidth + 0.012, HalfHeight], [HalfWidth - 0.012, -HalfHeight, HalfWidth, HalfHeight]])
            Builder.Push(() => Dark, (Facets) => EmitScreenQuad(Facets, Layer(1), Basis, U0, V0, U1, V1, Dark));

        const Columns = Fixture.Columns, Rows = Fixture.Rows;
        const TileWidth = (Fixture.Width - 0.03) / Columns, TileHeight = (Fixture.Height - 0.035) / Rows;
        for (let Row = 0; Row < Rows; ++Row)
        {
            for (let Column = 0; Column < Columns; ++Column)
            {
                const U0 = -HalfWidth + 0.015 + Column * TileWidth, V0 = -HalfHeight + 0.018 + Row * TileHeight;
                const U1 = U0 + TileWidth * 0.86, V1 = V0 + TileHeight * 0.78;
                const Index = Row * Columns + Column;
                Builder.Push(() => Dark, (Facets) => EmitScreenQuad(Facets, Layer(1), Basis, U0, V0, U1, V1, Dark));
                // 📐 Each tile carries a bar whose length is the readout it stands for: four tyre temperatures, four tyre
                //    pressures, then wheel slip, tread, boost and throttle.
                Builder.Push((Telemetry) =>
                {
                    const Level = Readout(Index, Telemetry);
                    if (Level === null)
                        return Dark;
                    if (Level > 0.95)
                        return CourseMaterial.CabinScreenRed;
                    if (Level > 0.8)
                        return CourseMaterial.CabinScreenAmber;
                    return Level > 0.02 ? Lit : Dark;
                }, (Facets) => EmitScreenQuad(Facets, Layer(2), Basis, U0 + 0.006, V0 + 0.006, U0 + 0.006 + (U1 - U0 - 0.012) * 0.5,
                                              V1 - 0.006, Dark));
            }
        }
    }

    // 📝 Called once the scene's vertex records exist: the panel learns where its two sets live in the buffer. The
    //    written-family caches stay empty, so the first frame lights both displays whatever the vehicle is doing.
    Attach(Exchange, VertexRecords, Scene)
    {
        this.Exchange = Exchange;
        this.VertexRecords = VertexRecords;
        for (const Display of [this.Cluster, this.Tablet])
        {
            const Set = Scene.FacetSets[Display.Set];
            Display.FirstVertex = Set.FirstVertex;
            Display.VertexCount = Set.VertexCount;
            Display.Staging = new ArrayBuffer(Set.VertexCount * VertexStride);
        }
    }

    // 📝 One frame: the cluster at 30 Hz, the tablet at 15 Hz and only when a readout it shows has moved.
    Update(Telemetry, Seconds)
    {
        if (!this.Exchange)
            return;
        this.Cluster.Accumulator += Seconds;
        this.Tablet.Accumulator += Seconds;
        if (this.Cluster.Accumulator >= 1.0 / ClusterRate)
        {
            this.Cluster.Accumulator = 0.0;
            this.Refresh(this.Cluster, this.ClusterBuilder, "Cluster", Telemetry);
        }
        if (this.Tablet.Accumulator >= 1.0 / TabletRate && this.TabletDirty(Telemetry))
        {
            this.Tablet.Accumulator = 0.0;
            this.Refresh(this.Tablet, this.TabletBuilder, "Tablet", Telemetry);
        }
    }

    // 📝 The tablet only redraws when a bar it shows has moved by a tile's worth: the C++ HMI's dirty rule.
    TabletDirty(Telemetry)
    {
        const Levels = this.TabletBuilder.Segments.map((Segment) => Segment.Rule(Telemetry));
        if (!this.LastTablet)
        {
            this.LastTablet = Levels;
            return true;
        }
        const Dirty = Levels.some((Family, Index) => Family !== this.LastTablet[Index]);
        this.LastTablet = Levels;
        return Dirty;
    }

    Refresh(Display, Builder, Key, Telemetry)
    {
        const Families = Builder.Resolve(Telemetry);
        const Written = this.Written[Key];
        let Dirty = Written.length !== Families.length;
        for (let Index = 0; !Dirty && Index < Families.length; ++Index)
            Dirty = Written[Index] !== Families[Index];
        if (!Dirty)
            return;
        Families.forEach((Family, Index) =>
        {
            const Segment = Builder.Segments[Index];
            for (let Facet = Segment.Start; Facet < Segment.Start + Segment.Count; ++Facet)
                Builder.Facets[Facet].Family = Family;
        });
        this.Written[Key] = Families;
        this.Encode(Display, Builder.Facets);
        this.Exchange.Device.queue.writeBuffer(this.VertexRecords, Display.FirstVertex * VertexStride, new Uint8Array(Display.Staging));
    }

    // 📐 The set's vertices exactly as FacetStructure::EncodeVertexRecords would write them: position, family, normal.
    Encode(Display, Facets)
    {
        const Scalars = new Float32Array(Display.Staging), Integers = new Uint32Array(Display.Staging);
        let Cursor = 0;
        for (const Facet of Facets)
        {
            const Normal = NormalizeVector(CrossVector(SubtractVector(Facet.Corners[1], Facet.Corners[0]),
                                                        SubtractVector(Facet.Corners[2], Facet.Corners[0])));
            for (let Corner = 0; Corner < 3; ++Corner)
            {
                const Offset = Cursor * 8;
                Scalars[Offset + 0] = Facet.Corners[Corner][0];
                Scalars[Offset + 1] = Facet.Corners[Corner][1];
                Scalars[Offset + 2] = Facet.Corners[Corner][2];
                Integers[Offset + 3] = Facet.Family | 0;
                Scalars[Offset + 4] = Normal[0];
                Scalars[Offset + 5] = Normal[1];
                Scalars[Offset + 6] = Normal[2];
                Integers[Offset + 7] = 0;
                ++Cursor;
            }
        }
    }
}

// 📐 A point on the display plate from its own (u, v) coordinates.
function Point(Centre, Basis, [U, V])
{
    return [Centre[0] + Basis.Right[0] * U + Basis.Up[0] * V, Centre[1] + Basis.Right[1] * U + Basis.Up[1] * V,
            Centre[2] + Basis.Right[2] * U + Basis.Up[2] * V];
}

// 📐 What each tablet tile shows, 0–1: the four tyre temperatures and pressures, then slip, tread, boost and throttle.
function Readout(Index, Telemetry)
{
    const Temperatures = Telemetry.Temperatures || [80, 80, 80, 80];
    const Pressures = Telemetry.Pressures || [220, 220, 220, 220];
    if (Index < 4)
        return Math.min(1.0, Math.max(0.0, (Temperatures[Index] - 40.0) / 160.0));
    if (Index < 8)
        return Math.min(1.0, Math.max(0.0, (Pressures[Index - 4] - 80.0) / 240.0));
    if (Index === 8)
        return Math.min(1.0, Telemetry.Skid || 0.0);
    if (Index === 9)
        return Math.min(1.0, (Telemetry.LineLock ? 1.0 : 0.0));
    if (Index === 10)
        return Math.min(1.0, Telemetry.Boost || 0.0);
    return Math.min(1.0, Telemetry.Throttle || 0.0);
}

// 📝 Adds the panel to the scene and hands it back; the host attaches the vertex records and drives the transforms.
export function ConstructCabinPanel(Scene, Roles)
{
    return new CabinPanel(Scene, Roles);
}

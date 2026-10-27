//============================================================================================================================================
// 📦 SheetSequence — offline bake: photoscan plates → one packed foliage sheet + tiling bark / ground surfaces.
//============================================================================================================================================
// Deterministic ordered stages, no installed dependencies:
//    ① decode plate          → RGBA8 surface
//    ② key                   → coverage from a black backing, un-premultiplied to kill the dark fringe
//    ③ cut                   → connected-component islands, interior holes filled, runt islands rejected
//    ④ classify              → Broadleaf / Fern / VineLeaf / Tendril / Flower / Grass + petiole anchor and growth axis
//    ⑤ pack                  → shelf packing into a single square sheet with mip-safe gutters
//    ⑥ derive                → normal sheet (Sobel over a vein height field) + surface sheet (roughness / AO / translucency)
//    ⑦ dilate                → colour bleed across the gutters so no black creeps in under trilinear minification
//    ⑧ emit                  → PNG sheets + a FoliageSheet.toml descriptor (CLAUDE.md §14 — TOML, never .manifest)
//
// Run:  node Tools/FoliageSketcher/Build/SheetSequence.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DecodeSurface, EncodeSurface } from "./PortableNetworkCodec.mjs";

const HereDirectory   = dirname(fileURLToPath(import.meta.url));
const ToolDirectory   = resolve(HereDirectory, "..");
const PlateDirectory  = join(ToolDirectory, "Content", "PlateArchives");
const SheetDirectory  = join(ToolDirectory, "Content", "SheetArchives");

//------------------------------------------------------------------------------------------------------------------------
//                                                    BAKE CRITERIA
//------------------------------------------------------------------------------------------------------------------------

const SheetCriteria =
{
    SheetExtent:        2048,     // [px] packed sheet edge
    Gutter:             10,       // [px] transparent margin around every island (mip safety)
    KeyLow:             0.045,    // [-]  value below this is certainly backing
    KeyHigh:            0.150,    // [-]  value above this is certainly plant
    MinimumIslandArea:  900,      // [px²] reject dust and JPEG-ish speckle
    MinimumIslandEdge:  22,       // [px] reject slivers
    DespillCeiling:     4.0,      // [-]  maximum un-premultiply gain on soft edges
    DilationRings:      12,       // [-]  colour-bleed passes over the gutters
    SurfaceExtent:      1024      // [px] bark / ground tiling maps
};

// One entry per plate. AnchorMode picks where the stem attaches: 'thin' walks the principal axis and takes the
//    narrow end (a petiole), 'bottom' takes the lowest span (upright fronds, grass tufts, cut flowers).
const PlateCriteria =
[
    { File: "BroadleafPlate.png",  Family: "Broadleaf", AnchorMode: "thin",   Roughness: 0.42, Translucency: 0.85 },
    { File: "FernPlate.png",       Family: "Fern",      AnchorMode: "bottom", Roughness: 0.38, Translucency: 0.95 },
    { File: "VineFlowerPlate.png", Family: "Vine",      AnchorMode: "thin",   Roughness: 0.40, Translucency: 0.80 },
    { File: "GrassPlate.png",      Family: "Grass",     AnchorMode: "bottom", Roughness: 0.46, Translucency: 0.90 }
];

const TilingCriteria =
[
    { File: "BarkPlate.png",   Name: "Bark",   Roughness: 0.78, HeightScale: 3.4 },
    { File: "GroundPlate.png", Name: "Ground", Roughness: 0.88, HeightScale: 2.2 }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                  ① / ②  KEY THE PLATE
//------------------------------------------------------------------------------------------------------------------------

// Coverage from a black backing. Value (max channel) beats luma here: a saturated red petal has low luma but is
//    unambiguously foreground. The soft ramp between KeyLow and KeyHigh keeps anti-aliased hairs and pinnae alive.
function KeyCoverage(Surface)
{
    const Count    = Surface.Width * Surface.Height;
    const Coverage = new Float32Array(Count);
    for (let Index = 0; Index < Count; ++Index)
    {
        const Read  = Index * 4;
        const Value = Math.max(Surface.Texels[Read], Surface.Texels[Read + 1], Surface.Texels[Read + 2]) / 255.0;
        const Ramp  = (Value - SheetCriteria.KeyLow) / (SheetCriteria.KeyHigh - SheetCriteria.KeyLow);
        Coverage[Index] = Ramp <= 0.0 ? 0.0 : Ramp >= 1.0 ? 1.0 : Ramp * Ramp * (3.0 - 2.0 * Ramp);
    }
    return Coverage;
}

// The plate is the plant composited over black, so every soft texel arrives pre-multiplied and reads too dark.
//    Dividing the colour back out restores the true edge albedo — without this every cut-out wears a black halo.
function Despill(Surface, Coverage)
{
    const Count = Surface.Width * Surface.Height;
    const Ink   = new Uint8Array(Count * 3);
    for (let Index = 0; Index < Count; ++Index)
    {
        const Read = Index * 4;
        const Gain = Coverage[Index] > 0.004 ? Math.min(1.0 / Coverage[Index], SheetCriteria.DespillCeiling) : 1.0;
        for (let Channel = 0; Channel < 3; ++Channel)
            Ink[Index * 3 + Channel] = Math.min(255, Math.round(Surface.Texels[Read + Channel] * Gain));
    }
    return Ink;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ③  CUT THE ISLANDS
//------------------------------------------------------------------------------------------------------------------------

// Iterative flood fill (an explicit span stack — recursion would blow the call stack on a 1408 × 768 frond).
function LabelIslands(Coverage, Width, Height)
{
    const Label   = new Int32Array(Width * Height).fill(-1);
    const Islands = [];
    const Stack   = new Int32Array(Width * Height);

    for (let Seed = 0; Seed < Width * Height; ++Seed)
    {
        if (Label[Seed] >= 0 || Coverage[Seed] < 0.5) continue;

        const Identifier = Islands.length;
        let   Depth      = 0;
        Stack[Depth++]   = Seed;
        Label[Seed]      = Identifier;

        let MinimumX = Width, MinimumY = Height, MaximumX = 0, MaximumY = 0, Area = 0;

        while (Depth > 0)
        {
            const Current = Stack[--Depth];
            const X = Current % Width;
            const Y = (Current - X) / Width;

            ++Area;
            if (X < MinimumX) MinimumX = X;
            if (Y < MinimumY) MinimumY = Y;
            if (X > MaximumX) MaximumX = X;
            if (Y > MaximumY) MaximumY = Y;

            // Eight-connected: fern pinnae and tendrils touch their neighbour only diagonally.
            for (let OffsetY = -1; OffsetY <= 1; ++OffsetY)
                for (let OffsetX = -1; OffsetX <= 1; ++OffsetX)
                {
                    if (OffsetX === 0 && OffsetY === 0) continue;
                    const NeighbourX = X + OffsetX, NeighbourY = Y + OffsetY;
                    if (NeighbourX < 0 || NeighbourY < 0 || NeighbourX >= Width || NeighbourY >= Height) continue;
                    const Neighbour = NeighbourY * Width + NeighbourX;
                    if (Label[Neighbour] >= 0 || Coverage[Neighbour] < 0.5) continue;
                    Label[Neighbour] = Identifier;
                    Stack[Depth++]   = Neighbour;
                }
        }

        Islands.push({ Identifier, MinimumX, MinimumY, MaximumX, MaximumY, Area });
    }
    return { Label, Islands };
}

//------------------------------------------------------------------------------------------------------------------------
//                                          ④  ANCHOR, AXIS AND FAMILY CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

// Second-order image moments give the principal (growth) axis of the island in plate space.
function PrincipalAxis(Mask, Width, Height)
{
    let Sum = 0, SumX = 0, SumY = 0;
    for (let Y = 0; Y < Height; ++Y)
        for (let X = 0; X < Width; ++X)
            if (Mask[Y * Width + X]) { ++Sum; SumX += X; SumY += Y; }
    if (Sum === 0) return { CentreX: 0, CentreY: 0, AxisX: 1, AxisY: 0, Elongation: 1 };

    const CentreX = SumX / Sum, CentreY = SumY / Sum;
    let Mxx = 0, Myy = 0, Mxy = 0;
    for (let Y = 0; Y < Height; ++Y)
        for (let X = 0; X < Width; ++X)
            if (Mask[Y * Width + X])
            {
                const DeltaX = X - CentreX, DeltaY = Y - CentreY;
                Mxx += DeltaX * DeltaX; Myy += DeltaY * DeltaY; Mxy += DeltaX * DeltaY;
            }
    Mxx /= Sum; Myy /= Sum; Mxy /= Sum;

    const Trace       = Mxx + Myy;
    const Determinant = Mxx * Myy - Mxy * Mxy;
    const Root        = Math.sqrt(Math.max(0.0, Trace * Trace * 0.25 - Determinant));
    const Major       = Trace * 0.5 + Root;
    const Minor       = Trace * 0.5 - Root;

    let AxisX = Mxy, AxisY = Major - Mxx;
    if (Math.abs(Mxy) < 1e-6) { AxisX = Mxx >= Myy ? 1 : 0; AxisY = Mxx >= Myy ? 0 : 1; }
    const Length = Math.hypot(AxisX, AxisY) || 1.0;

    return {
        CentreX, CentreY,
        AxisX: AxisX / Length,
        AxisY: AxisY / Length,
        Elongation: Math.sqrt(Math.max(Major, 1e-6) / Math.max(Minor, 1e-6))
    };
}

// Walks the principal axis and returns the end whose perpendicular width is smallest — a leaf's petiole, a frond's
//    stipe. The tip is the opposite end, so the pair also fixes the growth direction used when the card is placed.
function ResolveAnchor(Mask, Width, Height, Axis, AnchorMode)
{
    if (AnchorMode === "bottom")
    {
        let LowestY = -1, SumX = 0, Count = 0;
        for (let Y = Height - 1; Y >= 0 && LowestY < 0; --Y)
            for (let X = 0; X < Width; ++X)
                if (Mask[Y * Width + X]) { LowestY = Y; break; }
        if (LowestY < 0) return { AnchorX: Width * 0.5, AnchorY: Height - 1, TipX: Width * 0.5, TipY: 0 };
        for (let X = 0; X < Width; ++X) if (Mask[LowestY * Width + X]) { SumX += X; ++Count; }
        const AnchorX = Count > 0 ? SumX / Count : Width * 0.5;

        let HighestY = 0, TipSumX = 0, TipCount = 0;
        for (let Y = 0; Y < Height; ++Y) { let Found = false; for (let X = 0; X < Width; ++X) if (Mask[Y * Width + X]) { Found = true; break; } if (Found) { HighestY = Y; break; } }
        for (let X = 0; X < Width; ++X) if (Mask[HighestY * Width + X]) { TipSumX += X; ++TipCount; }
        return { AnchorX, AnchorY: LowestY, TipX: TipCount > 0 ? TipSumX / TipCount : Width * 0.5, TipY: HighestY };
    }

    // Project every covered texel onto the axis, bucket it, and measure the perpendicular spread per bucket.
    const Buckets = 24;
    const Minimum = new Float32Array(Buckets).fill(Infinity);
    const Maximum = new Float32Array(Buckets).fill(-Infinity);
    const Counts  = new Int32Array(Buckets);
    let   Lowest  = Infinity, Highest = -Infinity;

    for (let Y = 0; Y < Height; ++Y)
        for (let X = 0; X < Width; ++X)
            if (Mask[Y * Width + X])
            {
                const Along = (X - Axis.CentreX) * Axis.AxisX + (Y - Axis.CentreY) * Axis.AxisY;
                if (Along < Lowest)  Lowest  = Along;
                if (Along > Highest) Highest = Along;
            }
    const Span = Math.max(Highest - Lowest, 1e-5);

    for (let Y = 0; Y < Height; ++Y)
        for (let X = 0; X < Width; ++X)
            if (Mask[Y * Width + X])
            {
                const DeltaX = X - Axis.CentreX, DeltaY = Y - Axis.CentreY;
                const Along  = DeltaX * Axis.AxisX + DeltaY * Axis.AxisY;
                const Across = -DeltaX * Axis.AxisY + DeltaY * Axis.AxisX;
                const Bucket = Math.min(Buckets - 1, Math.max(0, Math.floor((Along - Lowest) / Span * Buckets)));
                if (Across < Minimum[Bucket]) Minimum[Bucket] = Across;
                if (Across > Maximum[Bucket]) Maximum[Bucket] = Across;
                ++Counts[Bucket];
            }

    const MeanWidth = (From, To) =>
    {
        let Total = 0, Used = 0;
        for (let Bucket = From; Bucket < To; ++Bucket)
            if (Counts[Bucket] > 0) { Total += Maximum[Bucket] - Minimum[Bucket]; ++Used; }
        return Used > 0 ? Total / Used : Infinity;
    };

    const Reach       = Math.max(2, Math.round(Buckets * 0.18));
    const HeadIsThin  = MeanWidth(0, Reach) < MeanWidth(Buckets - Reach, Buckets);
    const AnchorAlong = HeadIsThin ? Lowest  : Highest;
    const TipAlong    = HeadIsThin ? Highest : Lowest;

    return {
        AnchorX: Axis.CentreX + Axis.AxisX * AnchorAlong,
        AnchorY: Axis.CentreY + Axis.AxisY * AnchorAlong,
        TipX:    Axis.CentreX + Axis.AxisX * TipAlong,
        TipY:    Axis.CentreY + Axis.AxisY * TipAlong
    };
}

// Greenness separates foliage from bloom; elongation separates a tendril from a leaf.
function ClassifyFamily(Family, MeanRed, MeanGreen, MeanBlue, Elongation, Fill)
{
    if (Family !== "Vine") return Family;

    // Shape is tested BEFORE colour. A tendril is a thin, sparse, elongated wisp; because it is mostly stem its
    //    mean colour is barely green, so a colour-first test files every tendril as a bloom and the family comes
    //    out empty (measured: 0 tendrils, with two obvious ones sitting in Flower at elongation 2.5 and 3.0).
    //    The thresholds are set from the plate's own measurements rather than guessed.
    if (Elongation > 2.2 && Fill < 0.30)      return "Tendril";

    const Greenness = MeanGreen - Math.max(MeanRed, MeanBlue);
    if (Greenness < 0.035)                    return "Flower";
    return "VineLeaf";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     ⑤  SHELF PACKING
//------------------------------------------------------------------------------------------------------------------------

function PackCutouts(Cutouts, Extent, Gutter)
{
    const Ordered = [...Cutouts].sort((A, B) => B.Height - A.Height);
    let ShelfX = Gutter, ShelfY = Gutter, ShelfHeight = 0;

    for (const Cutout of Ordered)
    {
        if (ShelfX + Cutout.Width + Gutter > Extent)
        {
            ShelfX       = Gutter;
            ShelfY      += ShelfHeight + Gutter;
            ShelfHeight  = 0;
        }
        if (ShelfY + Cutout.Height + Gutter > Extent)
            throw new Error(`SheetSequence: ${Extent}² sheet overflowed — raise SheetExtent or drop plates`);

        Cutout.SheetX = ShelfX;
        Cutout.SheetY = ShelfY;
        ShelfX       += Cutout.Width + Gutter;
        ShelfHeight   = Math.max(ShelfHeight, Cutout.Height);
    }
    return Ordered;
}

//------------------------------------------------------------------------------------------------------------------------
//                                            ⑥  DERIVED MAPS  (normal / surface)
//------------------------------------------------------------------------------------------------------------------------

// Chamfer distance transform — how deep inside the silhouette each texel sits. Drives both the contact darkening
//    at leaf edges (AO) and the transmission ramp (thin rim glows, thick midrib blocks).
function InteriorDistance(Alpha, Width, Height)
{
    const Distance = new Float32Array(Width * Height);
    const Far      = 1e9;
    for (let Index = 0; Index < Distance.length; ++Index) Distance[Index] = Alpha[Index] > 0.5 ? Far : 0.0;

    for (let Y = 0; Y < Height; ++Y)
        for (let X = 0; X < Width; ++X)
        {
            const Index = Y * Width + X;
            if (Distance[Index] === 0.0) continue;
            let Best = Distance[Index];
            if (X > 0)             Best = Math.min(Best, Distance[Index - 1]         + 1.0);
            if (Y > 0)             Best = Math.min(Best, Distance[Index - Width]     + 1.0);
            if (X > 0 && Y > 0)    Best = Math.min(Best, Distance[Index - Width - 1] + 1.41421356);
            if (X + 1 < Width && Y > 0) Best = Math.min(Best, Distance[Index - Width + 1] + 1.41421356);
            Distance[Index] = Best;
        }
    for (let Y = Height - 1; Y >= 0; --Y)
        for (let X = Width - 1; X >= 0; --X)
        {
            const Index = Y * Width + X;
            if (Distance[Index] === 0.0) continue;
            let Best = Distance[Index];
            if (X + 1 < Width)                  Best = Math.min(Best, Distance[Index + 1]         + 1.0);
            if (Y + 1 < Height)                 Best = Math.min(Best, Distance[Index + Width]     + 1.0);
            if (X + 1 < Width && Y + 1 < Height) Best = Math.min(Best, Distance[Index + Width + 1] + 1.41421356);
            if (X > 0 && Y + 1 < Height)         Best = Math.min(Best, Distance[Index + Width - 1] + 1.41421356);
            Distance[Index] = Best;
        }
    return Distance;
}

// Sobel over a height field. For a leaf the veins are the height field: they sit brighter than the lamina, so
//    luma doubles as relief. Scale is deliberately gentle — foliage normals should whisper, not shout.
function DeriveNormal(Height, Width, Height_, Scale)
{
    const Normal = new Uint8Array(Width * Height_ * 4);
    const Fetch  = (X, Y) => Height[Math.min(Height_ - 1, Math.max(0, Y)) * Width + Math.min(Width - 1, Math.max(0, X))];

    for (let Y = 0; Y < Height_; ++Y)
        for (let X = 0; X < Width; ++X)
        {
            const GradientX = (Fetch(X + 1, Y - 1) + 2 * Fetch(X + 1, Y) + Fetch(X + 1, Y + 1))
                            - (Fetch(X - 1, Y - 1) + 2 * Fetch(X - 1, Y) + Fetch(X - 1, Y + 1));
            const GradientY = (Fetch(X - 1, Y + 1) + 2 * Fetch(X, Y + 1) + Fetch(X + 1, Y + 1))
                            - (Fetch(X - 1, Y - 1) + 2 * Fetch(X, Y - 1) + Fetch(X + 1, Y - 1));

            let NormalX = -GradientX * Scale, NormalY = -GradientY * Scale, NormalZ = 1.0;
            const Length = Math.hypot(NormalX, NormalY, NormalZ) || 1.0;
            NormalX /= Length; NormalY /= Length; NormalZ /= Length;

            const Write = (Y * Width + X) * 4;
            Normal[Write]     = Math.round((NormalX * 0.5 + 0.5) * 255);
            Normal[Write + 1] = Math.round((NormalY * 0.5 + 0.5) * 255);
            Normal[Write + 2] = Math.round((NormalZ * 0.5 + 0.5) * 255);
            Normal[Write + 3] = 255;
        }
    return Normal;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ⑦  GUTTER DILATION
//------------------------------------------------------------------------------------------------------------------------

// Pushes island colour outward into the transparent gutter. Alpha is untouched; only RGB spreads, so minified mips
//    average against plant colour instead of black. Standard practice for every masked foliage sheet.
function DilateColour(Texels, Width, Height, Rings)
{
    const Filled = new Uint8Array(Width * Height);
    for (let Index = 0; Index < Width * Height; ++Index) Filled[Index] = Texels[Index * 4 + 3] > 8 ? 1 : 0;

    for (let Ring = 0; Ring < Rings; ++Ring)
    {
        const Frontier = [];
        for (let Y = 0; Y < Height; ++Y)
            for (let X = 0; X < Width; ++X)
            {
                const Index = Y * Width + X;
                if (Filled[Index]) continue;

                let Red = 0, Green = 0, Blue = 0, Count = 0;
                for (let OffsetY = -1; OffsetY <= 1; ++OffsetY)
                    for (let OffsetX = -1; OffsetX <= 1; ++OffsetX)
                    {
                        const NeighbourX = X + OffsetX, NeighbourY = Y + OffsetY;
                        if (NeighbourX < 0 || NeighbourY < 0 || NeighbourX >= Width || NeighbourY >= Height) continue;
                        const Neighbour = NeighbourY * Width + NeighbourX;
                        if (!Filled[Neighbour]) continue;
                        Red += Texels[Neighbour * 4]; Green += Texels[Neighbour * 4 + 1]; Blue += Texels[Neighbour * 4 + 2];
                        ++Count;
                    }
                if (Count > 0) Frontier.push(Index, Math.round(Red / Count), Math.round(Green / Count), Math.round(Blue / Count));
            }

        if (Frontier.length === 0) break;
        for (let Entry = 0; Entry < Frontier.length; Entry += 4)
        {
            const Index = Frontier[Entry];
            Texels[Index * 4]     = Frontier[Entry + 1];
            Texels[Index * 4 + 1] = Frontier[Entry + 2];
            Texels[Index * 4 + 2] = Frontier[Entry + 3];
            Filled[Index]         = 1;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  PLATE → CUTOUT LIST
//------------------------------------------------------------------------------------------------------------------------

function HarvestPlate(Criteria)
{
    const Surface  = DecodeSurface(readFileSync(join(PlateDirectory, Criteria.File)));
    const Coverage = KeyCoverage(Surface);
    const Ink      = Despill(Surface, Coverage);
    const { Label, Islands } = LabelIslands(Coverage, Surface.Width, Surface.Height);

    const Kept = Islands.filter((Island) =>
           Island.Area >= SheetCriteria.MinimumIslandArea
        && (Island.MaximumX - Island.MinimumX) >= SheetCriteria.MinimumIslandEdge
        && (Island.MaximumY - Island.MinimumY) >= SheetCriteria.MinimumIslandEdge);

    const Cutouts = [];
    let   Serial  = 0;

    for (const Island of Kept)
    {
        const Width  = Island.MaximumX - Island.MinimumX + 1;
        const Height = Island.MaximumY - Island.MinimumY + 1;

        const Ribbon = new Uint8Array(Width * Height * 4);
        const Mask   = new Uint8Array(Width * Height);
        let   MeanRed = 0, MeanGreen = 0, MeanBlue = 0, Covered = 0;

        for (let Y = 0; Y < Height; ++Y)
            for (let X = 0; X < Width; ++X)
            {
                const PlateIndex = (Island.MinimumY + Y) * Surface.Width + (Island.MinimumX + X);
                const Write      = (Y * Width + X) * 4;

                // Only texels belonging to THIS island survive: a neighbouring frond overlapping the bounding
                //    box must not smuggle its pixels into the card.
                const Owned = Label[PlateIndex] === Island.Identifier;
                const Soft  = Coverage[PlateIndex];
                const Alpha = Owned ? Soft : (Label[PlateIndex] < 0 ? Math.min(Soft, 0.5) : 0.0);

                Ribbon[Write]     = Ink[PlateIndex * 3];
                Ribbon[Write + 1] = Ink[PlateIndex * 3 + 1];
                Ribbon[Write + 2] = Ink[PlateIndex * 3 + 2];
                Ribbon[Write + 3] = Math.round(Math.min(1.0, Math.max(0.0, Alpha)) * 255);

                if (Alpha > 0.5)
                {
                    Mask[Y * Width + X] = 1;
                    MeanRed   += Ribbon[Write];
                    MeanGreen += Ribbon[Write + 1];
                    MeanBlue  += Ribbon[Write + 2];
                    ++Covered;
                }
            }

        if (Covered < SheetCriteria.MinimumIslandArea) continue;
        MeanRed /= Covered * 255; MeanGreen /= Covered * 255; MeanBlue /= Covered * 255;

        const Axis   = PrincipalAxis(Mask, Width, Height);
        const Anchor = ResolveAnchor(Mask, Width, Height, Axis, Criteria.AnchorMode);
        const Fill   = Covered / (Width * Height);
        const Family = ClassifyFamily(Criteria.Family, MeanRed, MeanGreen, MeanBlue, Axis.Elongation, Fill);

        Cutouts.push({
            Name:   `${Family}${String(Serial++).padStart(2, "0")}`,
            Family,
            Width, Height, Ribbon, Mask, Fill,
            AnchorU: Anchor.AnchorX / Width,
            AnchorV: Anchor.AnchorY / Height,
            TipU:    Anchor.TipX / Width,
            TipV:    Anchor.TipY / Height,
            Tint:    [MeanRed, MeanGreen, MeanBlue],
            Roughness:    Criteria.Roughness,
            Translucency: Criteria.Translucency
        });
    }

    console.log(`   ${Criteria.File.padEnd(20)} ${Islands.length} islands → ${Cutouts.length} cutouts`);
    return Cutouts;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   TILING SURFACE BAKE
//------------------------------------------------------------------------------------------------------------------------

function BakeTilingSurface(Criteria)
{
    const Plate  = DecodeSurface(readFileSync(join(PlateDirectory, Criteria.File)));
    const Extent = SheetCriteria.SurfaceExtent;

    // Box-resample to the target extent (plates already arrive square and seamless).
    const Albedo = new Uint8Array(Extent * Extent * 4);
    const Height = new Float32Array(Extent * Extent);
    const RatioX = Plate.Width / Extent, RatioY = Plate.Height / Extent;

    for (let Y = 0; Y < Extent; ++Y)
        for (let X = 0; X < Extent; ++X)
        {
            const FromX = Math.floor(X * RatioX),       FromY = Math.floor(Y * RatioY);
            const ToX   = Math.max(FromX + 1, Math.floor((X + 1) * RatioX));
            const ToY   = Math.max(FromY + 1, Math.floor((Y + 1) * RatioY));

            let Red = 0, Green = 0, Blue = 0, Count = 0;
            for (let SampleY = FromY; SampleY < ToY && SampleY < Plate.Height; ++SampleY)
                for (let SampleX = FromX; SampleX < ToX && SampleX < Plate.Width; ++SampleX)
                {
                    const Read = (SampleY * Plate.Width + SampleX) * 4;
                    Red += Plate.Texels[Read]; Green += Plate.Texels[Read + 1]; Blue += Plate.Texels[Read + 2];
                    ++Count;
                }
            const Write = (Y * Extent + X) * 4;
            Albedo[Write]     = Math.round(Red / Count);
            Albedo[Write + 1] = Math.round(Green / Count);
            Albedo[Write + 2] = Math.round(Blue / Count);
            Albedo[Write + 3] = 255;
            Height[Y * Extent + X] = (0.299 * Albedo[Write] + 0.587 * Albedo[Write + 1] + 0.114 * Albedo[Write + 2]) / 255.0;
        }

    const Normal = DeriveNormal(Height, Extent, Extent, Criteria.HeightScale * 0.25);

    // Surface: R roughness (darker crevices stay wetter / smoother), G cavity AO, B unused for opaque surfaces.
    const SurfaceMap = new Uint8Array(Extent * Extent * 4);
    for (let Index = 0; Index < Extent * Extent; ++Index)
    {
        const Relief    = Height[Index];
        const Roughness = Math.min(1.0, Math.max(0.0, Criteria.Roughness + (Relief - 0.5) * 0.18));
        const Cavity    = Math.min(1.0, Math.max(0.0, 0.45 + Relief * 0.75));
        const Write     = Index * 4;
        SurfaceMap[Write]     = Math.round(Roughness * 255);
        SurfaceMap[Write + 1] = Math.round(Cavity * 255);
        SurfaceMap[Write + 2] = 0;
        SurfaceMap[Write + 3] = 255;
    }

    writeFileSync(join(SheetDirectory, `${Criteria.Name}_Albedo.png`),  EncodeSurface(Extent, Extent, Albedo, false));
    writeFileSync(join(SheetDirectory, `${Criteria.Name}_Normal.png`),  EncodeSurface(Extent, Extent, Normal, false));
    writeFileSync(join(SheetDirectory, `${Criteria.Name}_Surface.png`), EncodeSurface(Extent, Extent, SurfaceMap, false));
    console.log(`   ${Criteria.Name.padEnd(20)} ${Extent}² albedo + normal + surface`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

function Run()
{
    mkdirSync(SheetDirectory, { recursive: true });
    const Present = new Set(readdirSync(PlateDirectory));

    console.log("── Harvest ─────────────────────────────────────────");
    let Cutouts = [];
    for (const Criteria of PlateCriteria)
    {
        if (!Present.has(Criteria.File)) { console.log(`   ${Criteria.File} absent — skipped`); continue; }
        Cutouts = Cutouts.concat(HarvestPlate(Criteria));
    }
    if (Cutouts.length === 0) throw new Error("SheetSequence: no cutouts harvested");

    console.log("── Pack ────────────────────────────────────────────");
    const Extent = SheetCriteria.SheetExtent;
    const Placed = PackCutouts(Cutouts, Extent, SheetCriteria.Gutter);
    console.log(`   ${Placed.length} cutouts → ${Extent}² sheet`);

    const AlbedoSheet  = new Uint8Array(Extent * Extent * 4);
    const HeightSheet  = new Float32Array(Extent * Extent);
    const SurfaceSheet = new Uint8Array(Extent * Extent * 4);

    for (const Cutout of Placed)
    {
        const Distance = InteriorDistance(
            Float32Array.from(Cutout.Mask, (Covered) => Covered ? 1.0 : 0.0), Cutout.Width, Cutout.Height);

        // Normalise the depth ramp against the card's own thickness so a slender frond and a broad leaf
        //    both read correctly; 14 texels is roughly where transmitted light stops mattering.
        const Reach = Math.min(14.0, Math.max(4.0, Math.min(Cutout.Width, Cutout.Height) * 0.22));

        for (let Y = 0; Y < Cutout.Height; ++Y)
            for (let X = 0; X < Cutout.Width; ++X)
            {
                const Read  = (Y * Cutout.Width + X) * 4;
                const Write = ((Cutout.SheetY + Y) * Extent + (Cutout.SheetX + X)) * 4;

                AlbedoSheet[Write]     = Cutout.Ribbon[Read];
                AlbedoSheet[Write + 1] = Cutout.Ribbon[Read + 1];
                AlbedoSheet[Write + 2] = Cutout.Ribbon[Read + 2];
                AlbedoSheet[Write + 3] = Cutout.Ribbon[Read + 3];

                const Luma = (0.299 * Cutout.Ribbon[Read] + 0.587 * Cutout.Ribbon[Read + 1] + 0.114 * Cutout.Ribbon[Read + 2]) / 255.0;
                HeightSheet[(Cutout.SheetY + Y) * Extent + (Cutout.SheetX + X)] = Luma * (Cutout.Ribbon[Read + 3] / 255.0);

                const Depth        = Math.min(1.0, Distance[Y * Cutout.Width + X] / Reach);
                const Translucency = Cutout.Translucency * (1.0 - Depth * 0.72);          // rim transmits, midrib blocks
                const Occlusion    = 0.62 + 0.38 * Depth;                                  // edges catch less bounce
                const Roughness    = Cutout.Roughness + (1.0 - Luma) * 0.16;               // shaded lamina reads drier

                SurfaceSheet[Write]     = Math.round(Math.min(1.0, Math.max(0.0, Roughness)) * 255);
                SurfaceSheet[Write + 1] = Math.round(Math.min(1.0, Math.max(0.0, Occlusion)) * 255);
                SurfaceSheet[Write + 2] = Math.round(Math.min(1.0, Math.max(0.0, Translucency)) * 255);
                SurfaceSheet[Write + 3] = 255;
            }
    }

    console.log("── Derive ──────────────────────────────────────────");
    const NormalSheet = DeriveNormal(HeightSheet, Extent, Extent, 1.15);
    console.log(`   normal sheet from vein relief`);

    console.log("── Dilate ──────────────────────────────────────────");
    DilateColour(AlbedoSheet, Extent, Extent, SheetCriteria.DilationRings);
    console.log(`   ${SheetCriteria.DilationRings} rings of colour bleed`);

    console.log("── Emit ────────────────────────────────────────────");
    writeFileSync(join(SheetDirectory, "FoliageSheet_Albedo.png"),  EncodeSurface(Extent, Extent, AlbedoSheet, true));
    writeFileSync(join(SheetDirectory, "FoliageSheet_Normal.png"),  EncodeSurface(Extent, Extent, NormalSheet, false));
    writeFileSync(join(SheetDirectory, "FoliageSheet_Surface.png"), EncodeSurface(Extent, Extent, SurfaceSheet, false));

    const Families = [...new Set(Placed.map((Cutout) => Cutout.Family))].sort();
    const Lines =
    [
        "#============================================================================================================================================",
        "# 📦 FoliageSheet.toml — emitted by Tools/FoliageSketcher/Build/SheetSequence.mjs. Do not hand-edit.",
        "#============================================================================================================================================",
        "",
        "[sheet]",
        `extent      = ${Extent}`,
        `gutter      = ${SheetCriteria.Gutter}`,
        `albedo      = "FoliageSheet_Albedo.png"`,
        `normal      = "FoliageSheet_Normal.png"`,
        `surface     = "FoliageSheet_Surface.png"`,
        `cutoutcount = ${Placed.length}`,
        `families    = [${Families.map((Family) => `"${Family}"`).join(", ")}]`,
        "",
        "# surface sheet channels: R = roughness, G = ambient occlusion, B = translucency",
        ""
    ];

    for (const Cutout of Placed)
    {
        Lines.push("[[cutout]]");
        Lines.push(`name    = "${Cutout.Name}"`);
        Lines.push(`family  = "${Cutout.Family}"`);
        Lines.push(`rect    = [${Cutout.SheetX}, ${Cutout.SheetY}, ${Cutout.Width}, ${Cutout.Height}]`);
        Lines.push(`anchor  = [${Cutout.AnchorU.toFixed(4)}, ${Cutout.AnchorV.toFixed(4)}]`);
        Lines.push(`tip     = [${Cutout.TipU.toFixed(4)}, ${Cutout.TipV.toFixed(4)}]`);
        Lines.push(`fill    = ${Cutout.Fill.toFixed(4)}`);
        Lines.push(`tint    = [${Cutout.Tint.map((Channel) => Channel.toFixed(4)).join(", ")}]`);
        Lines.push("");
    }
    writeFileSync(join(SheetDirectory, "FoliageSheet.toml"), Lines.join("\n"));

    console.log("── Tiling surfaces ─────────────────────────────────");
    for (const Criteria of TilingCriteria)
    {
        if (!Present.has(Criteria.File)) { console.log(`   ${Criteria.File} absent — skipped`); continue; }
        BakeTilingSurface(Criteria);
    }

    console.log("────────────────────────────────────────────────────");
    for (const Family of Families)
        console.log(`   ${Family.padEnd(12)} ${Placed.filter((Cutout) => Cutout.Family === Family).length}`);
    console.log(`   sheet written to Tools/FoliageSketcher/Content/SheetArchives/`);
}

Run();

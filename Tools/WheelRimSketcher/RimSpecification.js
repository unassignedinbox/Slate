//============================================================================================================================================
//                                                     RIMSPECIFICATION.JS
//============================================================================================================================================
// 🧩 Browser port of Engine/ContentInterchange/WheelRimSpecification.cpp — same algorithm, same topology contract:
//    the rim body comes out as ONE connected, closed, orientation-consistent two-manifold. Spokes are not separate
//    solids and not a boolean union; the face is a single swept sheet whose silhouette is the ϕ = 0 isoline of a
//    smooth-minimum scalar contour, windows are handles cut through that sheet, and the barrel sweep is welded to
//    the sheet's outer rings with shared vertices.
//
// Local frame: spin axis +Z, outboard face toward +Z, barrel centre plane z = 0, metres out. Automotive units in.
// No three.js in this file — it returns plain arrays, so the same code can be unit-tested headless.

const PI = Math.PI;
const TAU = 2 * Math.PI;
const INCH = 0.0254;
const MILLI = 0.001;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const saturate = (x) => clamp(x, 0, 1);
const mix = (a, b, t) => a + (b - a) * t;
const radians = (d) => (d * PI) / 180;
function smoothStep(e0, e1, x) {
    const t = e1 > e0 ? saturate((x - e0) / (e1 - e0)) : x >= e1 ? 1 : 0;
    return t * t * (3 - 2 * t);
}
// ϕ > 0 is solid, so union is a smooth maximum and subtraction a smooth minimum against the negated cutter.
function contourUnion(a, b, k) {
    if (k <= 0) return Math.max(a, b);
    const h = saturate(0.5 + (0.5 * (a - b)) / k);
    return mix(b, a, h) + k * h * (1 - h);
}
function contourIntersect(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = saturate(0.5 + (0.5 * (b - a)) / k);
    return mix(b, a, h) - k * h * (1 - h);
}
const contourSubtract = (a, cutter, k) => contourIntersect(a, -cutter, k);
function angleDelta(a, b) {
    let d = (a - b + PI) % TAU;
    if (d < 0) d += TAU;
    return d - PI;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

export const SpokeContour = { Straight: 'Straight', Split: 'Split', Twisted: 'Twisted', Turbine: 'Turbine', Weave: 'Weave', Dished: 'Dished',
    Blade: 'Blade', Fan: 'Fan', Lattice: 'Lattice', Honeycomb: 'Honeycomb' };
export const LugSeat = { Conical: 'Conical', Ball: 'Ball', Flat: 'Flat' };
export const LugNut = { Hex: 'Hex', Spline: 'Spline', Capped: 'Capped' };

export const RimSlot = { FaceFront: 0, WindowWall: 1, Lip: 2, BarrelBore: 3, Hardware: 4, CentreCap: 5, Count: 6 };
export const RimSlotName = ['Face', 'Pockets & walls', 'Lip & flange', 'Barrel interior', 'Lug nuts', 'Centre cap'];

// OpenPBR-flavoured recipes; the viewer maps them onto MeshPhysicalMaterial, the engine onto MaterialSlabDescriptor.
export const Finishes = {
    GlossPaint:     { name: 'Gloss paint',      color: '#0f1013', metalness: 0.0,  roughness: 0.28, anisotropy: 0.0,  clearcoat: 1.0,  clearcoatRoughness: 0.045 },
    SatinGraphite:  { name: 'Satin graphite',   color: '#4b4e54', metalness: 0.55, roughness: 0.42, anisotropy: 0.0,  clearcoat: 0.35, clearcoatRoughness: 0.22 },
    PolishedAlloy:  { name: 'Polished alloy',   color: '#f3f5f6', metalness: 1.0,  roughness: 0.055, anisotropy: 0.0, clearcoat: 0.0,  clearcoatRoughness: 0.03 },
    BrushedAlloy:   { name: 'Brushed alloy',    color: '#e8ebec', metalness: 1.0,  roughness: 0.26, anisotropy: 0.72, clearcoat: 0.0,  clearcoatRoughness: 0.03 },
    MachinedFace:   { name: 'Machined (diamond-cut)', color: '#eceeef', metalness: 1.0, roughness: 0.17, anisotropy: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.06 },
    Chrome:         { name: 'Chrome',           color: '#c9ccce', metalness: 1.0,  roughness: 0.025, anisotropy: 0.0, clearcoat: 0.0,  clearcoatRoughness: 0.03 },
    BronzeAnodised: { name: 'Bronze anodised',  color: '#b4763a', metalness: 1.0,  roughness: 0.22, anisotropy: 0.0,  clearcoat: 0.6,  clearcoatRoughness: 0.10 },
    MatteBlack:     { name: 'Matte black',      color: '#0a0a0b', metalness: 0.0,  roughness: 0.62, anisotropy: 0.0,  clearcoat: 0.0,  clearcoatRoughness: 0.3 },
    GoldAnodised:   { name: 'Gold anodised',    color: '#c69a36', metalness: 1.0,  roughness: 0.18, anisotropy: 0.0,  clearcoat: 0.5,  clearcoatRoughness: 0.08 },
    GunmetalPaint:  { name: 'Gunmetal paint',   color: '#3a3f45', metalness: 0.2,  roughness: 0.35, anisotropy: 0.0,  clearcoat: 1.0,  clearcoatRoughness: 0.06 },
    CandyRed:       { name: 'Candy red',        color: '#7c0a12', metalness: 0.35, roughness: 0.18, anisotropy: 0.0,  clearcoat: 1.0,  clearcoatRoughness: 0.03 },
    RaceWhite:      { name: 'Race white',       color: '#c7c8c5', metalness: 0.0,  roughness: 0.30, anisotropy: 0.0,  clearcoat: 0.8,  clearcoatRoughness: 0.08 },
    SteelHardware:  { name: 'Steel hardware',   color: '#8f9296', metalness: 1.0,  roughness: 0.30, anisotropy: 0.0,  clearcoat: 0.0,  clearcoatRoughness: 0.1 },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

export function defaultParameters() {
    return {
        // size
        DiameterInch: 20, WidthInch: 9.5, OffsetMillimetre: 35,
        FlangeHeightMillimetre: 17.3, FlangeThicknessMillimetre: 6, BarrelWallMillimetre: 5.5,
        WellDepthMillimetre: 24, WellOffsetFraction: 0.62, WellWidthFraction: 0.34, BeadSeatTaperDegrees: 5,
        // cross-section
        SectionKnots: [], SectionSamples: 160, SectionSmoothing: 0,
        // face plate
        HubRadiusFraction: 0.30, OuterBandFraction: 0.055,
        PadThicknessMillimetre: 18, SpokeThicknessMillimetre: 13, LipThicknessMillimetre: 9,
        DishMillimetre: 26, ConcavityPower: 1.85, CrownMillimetre: 2.6, BackReliefMillimetre: 4.5,
        FilletMillimetre: 11, BevelMillimetre: 2.8, BevelBands: 3,
        // spokes
        SpokeContour: SpokeContour.Straight, SpokeCount: 5,
        SpokeRootWidthMillimetre: 62, SpokeTipWidthMillimetre: 34, SpokeTaperPower: 1.4,
        SpokeSweepDegrees: 0, SpokeTwistDegrees: 0, SpokeSplitDegrees: 7, SpokePhaseDegrees: 0,
        RingRadiusFraction: 0.58, RingWidthMillimetre: 22,
        // hub / lugs / valve
        CentreBoreMillimetre: 72.6, LugCount: 5, LugCircleMillimetre: 114.3, LugHoleMillimetre: 14.2,
        LugSeat: LugSeat.Conical, LugSeatAngleDegrees: 60, LugSeatDepthMillimetre: 6, LugPhaseDegrees: 0,
        ValveHole: true, ValveHoleMillimetre: 11.5, ValveRadiusFraction: 0.72,
        // hardware
        GenerateLugNuts: true, LugNut: LugNut.Hex, LugNutFlatsMillimetre: 19, LugNutHeightMillimetre: 24,
        LugNutChamferMillimetre: 2.2, LugNutProudMillimetre: 1.5,
        GenerateLipBolts: false, LipBoltCount: 24, LipBoltDiameterMillimetre: 9, LipBoltProudMillimetre: 2.6,
        CentreLock: false, CentreLockFlatsMillimetre: 52,
        GenerateCentreCap: true, CentreCapRadiusFraction: 0.56, CentreCapDomeMillimetre: 6,
        // tessellation
        AngularSegments: 384, RadialSegments: 84, HardwareSegments: 40, CreaseDegrees: 38,
    };
}

export const Presets = {
    'Forged 5-spoke 20×9.5': (p) => p,
    'Split 10-spoke 19×8.5': (p) => Object.assign(p, {
        DiameterInch: 19, WidthInch: 8.5, OffsetMillimetre: 42, SpokeContour: SpokeContour.Split, SpokeCount: 5,
        SpokeRootWidthMillimetre: 70, SpokeTipWidthMillimetre: 46, SpokeSplitDegrees: 9,
        DishMillimetre: 20, ConcavityPower: 1.5, FilletMillimetre: 9 }),
    'Mesh weave 21×10': (p) => Object.assign(p, {
        DiameterInch: 21, WidthInch: 10, OffsetMillimetre: 30, SpokeContour: SpokeContour.Weave, SpokeCount: 10,
        SpokeRootWidthMillimetre: 46, SpokeTipWidthMillimetre: 30, SpokeSweepDegrees: 26,
        HubRadiusFraction: 0.26, DishMillimetre: 18, FilletMillimetre: 7, SpokeThicknessMillimetre: 10,
        AngularSegments: 512 }),
    'Turbine aero 18×8': (p) => Object.assign(p, {
        DiameterInch: 18, WidthInch: 8, OffsetMillimetre: 45, SpokeContour: SpokeContour.Turbine, SpokeCount: 9,
        SpokeRootWidthMillimetre: 54, SpokeTipWidthMillimetre: 58, SpokeSweepDegrees: 30,
        DishMillimetre: 12, ConcavityPower: 1.2, CrownMillimetre: 4 }),
    'Deep dish concave 20×11': (p) => Object.assign(p, {
        DiameterInch: 20, WidthInch: 11, OffsetMillimetre: 15, SpokeContour: SpokeContour.Dished, SpokeCount: 7,
        SpokeRootWidthMillimetre: 48, SpokeTipWidthMillimetre: 72, DishMillimetre: 46, ConcavityPower: 2.4,
        OuterBandFraction: 0.04, WellOffsetFraction: 0.68 }),
    'Heavy duty 6-spoke 17×8': (p) => Object.assign(p, {
        DiameterInch: 17, WidthInch: 8, OffsetMillimetre: 0, SpokeContour: SpokeContour.Straight, SpokeCount: 6,
        SpokeRootWidthMillimetre: 74, SpokeTipWidthMillimetre: 52, SpokeTaperPower: 1.1,
        LugCount: 6, LugCircleMillimetre: 139.7, LugHoleMillimetre: 16, CentreBoreMillimetre: 106.1,
        PadThicknessMillimetre: 22, SpokeThicknessMillimetre: 17, DishMillimetre: 10, ConcavityPower: 1.2,
        BarrelWallMillimetre: 7, LugNutFlatsMillimetre: 22, LugNutHeightMillimetre: 28 }),

    //  ── offroad ─────────────────────────────────────────────────────────────────────────────────────────────────
    'Offroad beadlock 17×9': (p) => Object.assign(p, {
        DiameterInch: 17, WidthInch: 9, OffsetMillimetre: -12, SpokeContour: SpokeContour.Straight, SpokeCount: 6,
        SpokeRootWidthMillimetre: 86, SpokeTipWidthMillimetre: 62, SpokeTaperPower: 1.0,
        LugCount: 6, LugCircleMillimetre: 139.7, LugHoleMillimetre: 16, CentreBoreMillimetre: 106.1,
        PadThicknessMillimetre: 24, SpokeThicknessMillimetre: 19, BarrelWallMillimetre: 8.5,
        DishMillimetre: 6, ConcavityPower: 1.1, FilletMillimetre: 14, OuterBandFraction: 0.11,
        GenerateLipBolts: true, LipBoltCount: 24, LipBoltDiameterMillimetre: 10,
        LugNutFlatsMillimetre: 22, LugNutHeightMillimetre: 28 }),
    'Offroad rock 8-spoke 17×8.5': (p) => Object.assign(p, {
        DiameterInch: 17, WidthInch: 8.5, OffsetMillimetre: 0, SpokeContour: SpokeContour.Straight, SpokeCount: 8,
        SpokeRootWidthMillimetre: 64, SpokeTipWidthMillimetre: 44, SpokeTaperPower: 1.2,
        LugCount: 6, LugCircleMillimetre: 139.7, CentreBoreMillimetre: 106.1,
        PadThicknessMillimetre: 22, SpokeThicknessMillimetre: 17, BarrelWallMillimetre: 8,
        DishMillimetre: 14, ConcavityPower: 1.3, FilletMillimetre: 12,
        GenerateLipBolts: true, LipBoltCount: 20 }),
    'Overland mesh 18×9': (p) => Object.assign(p, {
        DiameterInch: 18, WidthInch: 9, OffsetMillimetre: 10, SpokeContour: SpokeContour.Weave, SpokeCount: 8,
        SpokeRootWidthMillimetre: 52, SpokeTipWidthMillimetre: 38, SpokeSweepDegrees: 20,
        LugCount: 6, LugCircleMillimetre: 139.7, CentreBoreMillimetre: 106.1,
        SpokeThicknessMillimetre: 15, DishMillimetre: 12, FilletMillimetre: 10,
        GenerateLipBolts: true, LipBoltCount: 18, LipBoltDiameterMillimetre: 8 }),
    'Steel-look rally 16×8': (p) => Object.assign(p, {
        DiameterInch: 16, WidthInch: 8, OffsetMillimetre: -6, SpokeContour: SpokeContour.Blade, SpokeCount: 5,
        SpokeRootWidthMillimetre: 52, SpokeTipWidthMillimetre: 54,
        LugCount: 5, LugCircleMillimetre: 127, CentreBoreMillimetre: 78.1,
        PadThicknessMillimetre: 16, SpokeThicknessMillimetre: 9, LipThicknessMillimetre: 7,
        DishMillimetre: 20, ConcavityPower: 1.6, CrownMillimetre: 0, BackReliefMillimetre: 0,
        HubRadiusFraction: 0.36, FilletMillimetre: 16, BevelMillimetre: 1.2,
        GenerateCentreCap: true, CentreCapRadiusFraction: 0.72, CentreCapDomeMillimetre: 9 }),
    'Dually lattice ring 17×9': (p) => Object.assign(p, {
        DiameterInch: 17, WidthInch: 9, OffsetMillimetre: 5, SpokeContour: SpokeContour.Lattice, SpokeCount: 8,
        SpokeRootWidthMillimetre: 56, SpokeTipWidthMillimetre: 40,
        RingRadiusFraction: 0.54, RingWidthMillimetre: 26,
        LugCount: 8, LugCircleMillimetre: 165.1, CentreBoreMillimetre: 116.7,
        PadThicknessMillimetre: 24, SpokeThicknessMillimetre: 16, BarrelWallMillimetre: 8,
        DishMillimetre: 10, FilletMillimetre: 11 }),

    //  ── GT3 / endurance ─────────────────────────────────────────────────────────────────────────────────────────
    'GT3 centre-lock aero 18×12': (p) => Object.assign(p, {
        DiameterInch: 18, WidthInch: 12, OffsetMillimetre: 20, SpokeContour: SpokeContour.Blade, SpokeCount: 7,
        SpokeRootWidthMillimetre: 50, SpokeTipWidthMillimetre: 56, SpokeSweepDegrees: 12,
        LugCount: 0, CentreLock: true, CentreLockFlatsMillimetre: 56, GenerateCentreCap: false,
        CentreBoreMillimetre: 68, HubRadiusFraction: 0.30,
        DishMillimetre: 16, ConcavityPower: 1.4, SpokeThicknessMillimetre: 10,
        FilletMillimetre: 8, BevelMillimetre: 2, WellOffsetFraction: 0.66 }),
    'GT3 endurance 10-spoke 18×11': (p) => Object.assign(p, {
        DiameterInch: 18, WidthInch: 11, OffsetMillimetre: 26, SpokeContour: SpokeContour.Fan, SpokeCount: 10,
        SpokeRootWidthMillimetre: 58, SpokeTipWidthMillimetre: 44, SpokeSweepDegrees: 6,
        LugCount: 0, CentreLock: true, CentreLockFlatsMillimetre: 52, GenerateCentreCap: false,
        CentreBoreMillimetre: 68, DishMillimetre: 20, SpokeThicknessMillimetre: 11,
        FilletMillimetre: 9, WellOffsetFraction: 0.66 }),
    'GT3 turbine cover 18×10.5': (p) => Object.assign(p, {
        DiameterInch: 18, WidthInch: 10.5, OffsetMillimetre: 22, SpokeContour: SpokeContour.Turbine, SpokeCount: 11,
        SpokeRootWidthMillimetre: 58, SpokeTipWidthMillimetre: 66, SpokeSweepDegrees: 34,
        LugCount: 0, CentreLock: true, GenerateCentreCap: false, CentreBoreMillimetre: 68,
        DishMillimetre: 10, ConcavityPower: 1.15, CrownMillimetre: 3,
        SpokeThicknessMillimetre: 9, FilletMillimetre: 12, WellOffsetFraction: 0.66 }),
    'GT3 split blade 19×12': (p) => Object.assign(p, {
        DiameterInch: 19, WidthInch: 12, OffsetMillimetre: 18, SpokeContour: SpokeContour.Split, SpokeCount: 6,
        SpokeRootWidthMillimetre: 82, SpokeTipWidthMillimetre: 62, SpokeSplitDegrees: 11,
        LugCount: 0, CentreLock: true, CentreLockFlatsMillimetre: 58, GenerateCentreCap: false,
        CentreBoreMillimetre: 68, DishMillimetre: 22, ConcavityPower: 1.7,
        SpokeThicknessMillimetre: 12, FilletMillimetre: 10, WellOffsetFraction: 0.66 }),

    //  ── GT / sport ──────────────────────────────────────────────────────────────────────────────────────────────
    'GT twin 5-split 19×9.5': (p) => Object.assign(p, {
        DiameterInch: 19, WidthInch: 9.5, OffsetMillimetre: 38, SpokeContour: SpokeContour.Split, SpokeCount: 5,
        SpokeRootWidthMillimetre: 76, SpokeTipWidthMillimetre: 52, SpokeSplitDegrees: 12,
        SpokeSweepDegrees: 6, DishMillimetre: 24, ConcavityPower: 1.9,
        FilletMillimetre: 10, CrownMillimetre: 3.2 }),
    'GT directional 20×10': (p) => Object.assign(p, {
        DiameterInch: 20, WidthInch: 10, OffsetMillimetre: 30, SpokeContour: SpokeContour.Twisted, SpokeCount: 9,
        SpokeRootWidthMillimetre: 58, SpokeTipWidthMillimetre: 40,
        SpokeSweepDegrees: 26, SpokeTwistDegrees: 14,
        DishMillimetre: 28, ConcavityPower: 2.0, CrownMillimetre: 3.6, FilletMillimetre: 9 }),
    'GT mesh 19×9': (p) => Object.assign(p, {
        DiameterInch: 19, WidthInch: 9, OffsetMillimetre: 35, SpokeContour: SpokeContour.Weave, SpokeCount: 9,
        SpokeRootWidthMillimetre: 44, SpokeTipWidthMillimetre: 32, SpokeSweepDegrees: 23,
        HubRadiusFraction: 0.27, DishMillimetre: 18, SpokeThicknessMillimetre: 11, FilletMillimetre: 7 }),
    'GT honeycomb 20×10': (p) => Object.assign(p, {
        DiameterInch: 20, WidthInch: 10, OffsetMillimetre: 32, SpokeContour: SpokeContour.Honeycomb, SpokeCount: 9,
        SpokeRootWidthMillimetre: 46, SpokeTipWidthMillimetre: 42,
        RingRadiusFraction: 0.52, RingWidthMillimetre: 18,
        HubRadiusFraction: 0.26, DishMillimetre: 22, SpokeThicknessMillimetre: 11,
        FilletMillimetre: 8, BevelMillimetre: 2.2 }),

    //  ── luxury ──────────────────────────────────────────────────────────────────────────────────────────────────
    'Luxury fan 20-spoke 22×9': (p) => Object.assign(p, {
        DiameterInch: 22, WidthInch: 9, OffsetMillimetre: 40, SpokeContour: SpokeContour.Fan, SpokeCount: 20,
        SpokeRootWidthMillimetre: 42, SpokeTipWidthMillimetre: 30, SpokeSweepDegrees: 9,
        HubRadiusFraction: 0.24, DishMillimetre: 16, SpokeThicknessMillimetre: 9,
        FilletMillimetre: 6, BevelMillimetre: 1.8, AngularSegments: 640 }),
    'Luxury fine mesh 21×9': (p) => Object.assign(p, {
        DiameterInch: 21, WidthInch: 9, OffsetMillimetre: 38, SpokeContour: SpokeContour.Weave, SpokeCount: 14,
        SpokeRootWidthMillimetre: 32, SpokeTipWidthMillimetre: 24, SpokeSweepDegrees: 26,
        HubRadiusFraction: 0.23, DishMillimetre: 14, SpokeThicknessMillimetre: 9,
        FilletMillimetre: 5.5, AngularSegments: 704 }),
    'Luxury dish cruiser 22×9.5': (p) => Object.assign(p, {
        DiameterInch: 22, WidthInch: 9.5, OffsetMillimetre: 25, SpokeContour: SpokeContour.Dished, SpokeCount: 10,
        SpokeRootWidthMillimetre: 40, SpokeTipWidthMillimetre: 58,
        DishMillimetre: 38, ConcavityPower: 2.2, OuterBandFraction: 0.05,
        SpokeThicknessMillimetre: 11, FilletMillimetre: 8 }),
    'Luxury concave 10-spoke 20×8.5': (p) => Object.assign(p, {
        DiameterInch: 20, WidthInch: 8.5, OffsetMillimetre: 42, SpokeContour: SpokeContour.Straight, SpokeCount: 10,
        SpokeRootWidthMillimetre: 50, SpokeTipWidthMillimetre: 30, SpokeTaperPower: 1.7,
        DishMillimetre: 30, ConcavityPower: 2.3, CrownMillimetre: 3, FilletMillimetre: 8 }),

    //  ── show ────────────────────────────────────────────────────────────────────────────────────────────────────
    'Show deep chrome 20×12': (p) => Object.assign(p, {
        DiameterInch: 20, WidthInch: 12, OffsetMillimetre: -20, SpokeContour: SpokeContour.Dished, SpokeCount: 6,
        SpokeRootWidthMillimetre: 52, SpokeTipWidthMillimetre: 76,
        DishMillimetre: 58, ConcavityPower: 2.6, OuterBandFraction: 0.035,
        WellOffsetFraction: 0.72, FilletMillimetre: 9,
        GenerateLipBolts: true, LipBoltCount: 30, LipBoltDiameterMillimetre: 8 }),
    'Show candy weave 22×10': (p) => Object.assign(p, {
        DiameterInch: 22, WidthInch: 10, OffsetMillimetre: 28, SpokeContour: SpokeContour.Weave, SpokeCount: 11,
        SpokeRootWidthMillimetre: 40, SpokeTipWidthMillimetre: 30, SpokeSweepDegrees: 28,
        HubRadiusFraction: 0.24, DishMillimetre: 24, FilletMillimetre: 6.5, AngularSegments: 640 }),
    'Show gold pinwheel 21×10.5': (p) => Object.assign(p, {
        DiameterInch: 21, WidthInch: 10.5, OffsetMillimetre: 25, SpokeContour: SpokeContour.Turbine, SpokeCount: 13,
        SpokeRootWidthMillimetre: 48, SpokeTipWidthMillimetre: 52, SpokeSweepDegrees: 40,
        SpokeTwistDegrees: 10, DishMillimetre: 20, CrownMillimetre: 3.4, FilletMillimetre: 7,
        AngularSegments: 640 }),
};

// The paint scheme each preset ships with in the C++ module; the viewer applies it when the preset changes.
export const PresetSchemes = {
    'Forged 5-spoke 20×9.5': 'Machined face + gloss pockets',
    'Split 10-spoke 19×8.5': 'Machined face + gloss pockets',
    'Mesh weave 21×10': 'Satin graphite monotone',
    'Turbine aero 18×8': 'Gloss black + polished lip',
    'Deep dish concave 20×11': 'Gloss black + polished lip',
    'Heavy duty 6-spoke 17×8': 'Matte black utility',
    'Offroad beadlock 17×9': 'Matte black utility',
    'Offroad rock 8-spoke 17×8.5': 'Bronze anodised',
    'Overland mesh 18×9': 'Matte black utility',
    'Steel-look rally 16×8': 'Race white',
    'Dually lattice ring 17×9': 'Gunmetal',
    'GT3 centre-lock aero 18×12': 'Gold race',
    'GT3 endurance 10-spoke 18×11': 'Satin graphite monotone',
    'GT3 turbine cover 18×10.5': 'Matte black utility',
    'GT3 split blade 19×12': 'Race white',
    'GT twin 5-split 19×9.5': 'Machined face + gloss pockets',
    'GT directional 20×10': 'Gunmetal',
    'GT mesh 19×9': 'Gloss black + polished lip',
    'GT honeycomb 20×10': 'Bronze anodised',
    'Luxury fan 20-spoke 22×9': 'Full polish',
    'Luxury fine mesh 21×9': 'Full polish',
    'Luxury dish cruiser 22×9.5': 'Gloss black + polished lip',
    'Luxury concave 10-spoke 20×8.5': 'Machined face + gloss pockets',
    'Show deep chrome 20×12': 'Full polish',
    'Show candy weave 22×10': 'Candy red + chrome',
    'Show gold pinwheel 21×10.5': 'Gold race',
};

export const PaintSchemes = {
    'Machined face + gloss pockets': { 0: 'MachinedFace', 1: 'GlossPaint', 2: 'PolishedAlloy', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'SatinGraphite' },
    'Satin graphite monotone':       { 0: 'SatinGraphite', 1: 'MatteBlack', 2: 'SatinGraphite', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'SatinGraphite' },
    'Gloss black + polished lip':    { 0: 'GlossPaint', 1: 'MatteBlack', 2: 'PolishedAlloy', 3: 'MatteBlack', 4: 'Chrome', 5: 'GlossPaint' },
    'Full polish':                   { 0: 'PolishedAlloy', 1: 'BrushedAlloy', 2: 'PolishedAlloy', 3: 'BrushedAlloy', 4: 'Chrome', 5: 'PolishedAlloy' },
    'Bronze anodised':               { 0: 'BronzeAnodised', 1: 'MatteBlack', 2: 'BronzeAnodised', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'BronzeAnodised' },
    'Gold race':                     { 0: 'GoldAnodised', 1: 'MatteBlack', 2: 'GoldAnodised', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'MatteBlack' },
    'Matte black utility':           { 0: 'MatteBlack', 1: 'MatteBlack', 2: 'MatteBlack', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'SatinGraphite' },
    'Race white':                    { 0: 'RaceWhite', 1: 'MatteBlack', 2: 'RaceWhite', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'PolishedAlloy' },
    'Gunmetal':                      { 0: 'GunmetalPaint', 1: 'MatteBlack', 2: 'GunmetalPaint', 3: 'MatteBlack', 4: 'SteelHardware', 5: 'GunmetalPaint' },
    'Candy red + chrome':            { 0: 'CandyRed', 1: 'GunmetalPaint', 2: 'Chrome', 3: 'MatteBlack', 4: 'Chrome', 5: 'CandyRed' },
};

export function normalise(p) {
    const notes = [];
    const pin = (key, lo, hi) => { const before = p[key]; p[key] = clamp(p[key], lo, hi); if (p[key] !== before) notes.push(key); };
    pin('DiameterInch', 10, 34); pin('WidthInch', 4, 20); pin('OffsetMillimetre', -120, 120);
    pin('FlangeHeightMillimetre', 8, 30); pin('FlangeThicknessMillimetre', 2, 16); pin('BarrelWallMillimetre', 2, 18);
    pin('WellDepthMillimetre', 6, 60); pin('HubRadiusFraction', 0.12, 0.80); pin('OuterBandFraction', 0.01, 0.40);
    pin('PadThicknessMillimetre', 6, 60); pin('SpokeThicknessMillimetre', 4, 50); pin('LipThicknessMillimetre', 3, 40);
    pin('DishMillimetre', -40, 140); pin('ConcavityPower', 0.35, 5); pin('CrownMillimetre', 0, 30);
    pin('BackReliefMillimetre', 0, 30); pin('FilletMillimetre', 0.5, 40); pin('BevelMillimetre', 0, 12);
    pin('SpokeRootWidthMillimetre', 6, 400); pin('SpokeTipWidthMillimetre', 6, 400);
    pin('CentreBoreMillimetre', 20, 300); pin('LugCircleMillimetre', 50, 400); pin('LugHoleMillimetre', 6, 40);
    pin('LugSeatDepthMillimetre', 0, 20); pin('LugNutFlatsMillimetre', 8, 50); pin('LugNutHeightMillimetre', 6, 70);
    pin('CentreCapRadiusFraction', 0.1, 1); pin('CreaseDegrees', 5, 150);
    pin('RingRadiusFraction', 0.15, 0.92); pin('RingWidthMillimetre', 3, 80);
    pin('LipBoltDiameterMillimetre', 3, 26); pin('LipBoltProudMillimetre', 0.5, 14);
    pin('CentreLockFlatsMillimetre', 20, 110);
    p.LipBoltCount = Math.round(clamp(p.LipBoltCount, 0, 96));
    if (p.CentreLock) p.LugCount = 0;
    p.SpokeCount = Math.round(clamp(p.SpokeCount, 2, 60));
    p.LugCount = Math.round(clamp(p.LugCount, 0, 12));
    p.AngularSegments = Math.round(clamp(p.AngularSegments, 64, 2048));
    p.RadialSegments = Math.round(clamp(p.RadialSegments, 16, 512));
    p.HardwareSegments = Math.round(clamp(p.HardwareSegments, 8, 128));
    p.BevelBands = Math.round(clamp(p.BevelBands, 1, 16));
    p.SectionSamples = Math.round(clamp(p.SectionSamples, 24, 1024));

    const clearance = 0.5 * p.CentreBoreMillimetre + 0.5 * p.LugHoleMillimetre + 6;
    if (p.LugCount > 0 && p.LugCircleMillimetre < 2 * clearance) { p.LugCircleMillimetre = 2 * clearance; notes.push('LugCircleMillimetre'); }
    const pitch = (0.98 * (TAU * 0.5 * p.DiameterInch * 25.4)) / p.SpokeCount;
    if (p.SpokeTipWidthMillimetre > pitch) { p.SpokeTipWidthMillimetre = pitch; notes.push('SpokeTipWidthMillimetre'); }
    return notes;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 RESOLVED DIMENSIONS
//------------------------------------------------------------------------------------------------------------------------

function resolveDimensions(p) {
    const d = {};
    d.BeadRadius = 0.5 * p.DiameterInch * INCH;
    d.HalfWidth = 0.5 * p.WidthInch * INCH;
    d.FlangeThickness = p.FlangeThicknessMillimetre * MILLI;
    d.FlangeRadius = d.BeadRadius + p.FlangeHeightMillimetre * MILLI;
    d.InnerRadius = d.BeadRadius - Math.max(2 * MILLI, p.BarrelWallMillimetre * MILLI);
    d.WellRadius = Math.max(d.InnerRadius * 0.45, d.BeadRadius - p.WellDepthMillimetre * MILLI);
    d.WellCentre = d.HalfWidth - clamp(p.WellOffsetFraction, 0.12, 0.88) * 2 * d.HalfWidth;
    d.WellHalfWidth = clamp(p.WellWidthFraction, 0.08, 0.6) * d.HalfWidth;
    d.SeatWidth = 0.17 * 2 * d.HalfWidth;
    d.MountPlane = p.OffsetMillimetre * MILLI;
    d.HubFront = d.MountPlane + p.PadThicknessMillimetre * MILLI;
    d.LipFront = d.HubFront + p.DishMillimetre * MILLI;

    const ceiling = d.HalfWidth + d.FlangeThickness - 2 * MILLI;
    const floor = d.WellCentre + d.WellHalfWidth + 4 * MILLI + Math.max(3, p.LipThicknessMillimetre) * MILLI;
    d.LipFront = clamp(d.LipFront, Math.min(floor, ceiling), ceiling);
    d.LipBack = d.LipFront - Math.max(3 * MILLI, p.LipThicknessMillimetre * MILLI);

    d.HubRadius = clamp(p.HubRadiusFraction, 0.12, 0.8) * d.InnerRadius;
    d.BandRadius = d.InnerRadius * (1 - clamp(p.OuterBandFraction, 0.01, 0.4));
    d.BoreRadius = 0.5 * p.CentreBoreMillimetre * MILLI;
    d.LugCircleRadius = 0.5 * p.LugCircleMillimetre * MILLI;
    d.LugHoleRadius = 0.5 * p.LugHoleMillimetre * MILLI;
    d.LugSeatDepth = p.LugSeatDepthMillimetre * MILLI;
    const seatHalf = clamp(p.LugSeatAngleDegrees, 20, 160) * 0.5;
    d.LugSeatRadius = p.LugSeat === LugSeat.Flat ? d.LugHoleRadius + 3.2 * MILLI : d.LugHoleRadius + d.LugSeatDepth * Math.tan(radians(seatHalf));
    d.ValveRadius = mix(d.HubRadius, d.BandRadius, clamp(p.ValveRadiusFraction, 0.05, 0.95));
    d.ValveHoleRadius = 0.5 * p.ValveHoleMillimetre * MILLI;
    return d;
}

function resolveSpokeRecipe(p, d) {
    const r = {
        families: 1, sweep: [0, 0], ringRadius: 0, ringHalf: 0, staggered: false,
        rootHalf: 0.5 * p.SpokeRootWidthMillimetre * MILLI,
        tipHalf: 0.5 * p.SpokeTipWidthMillimetre * MILLI,
        taperPower: Math.max(0.2, p.SpokeTaperPower), splitHalf: 0, lean: 0,
    };
    const sweep = radians(p.SpokeSweepDegrees);
    switch (p.SpokeContour) {
        case SpokeContour.Split:
            r.sweep[0] = sweep; r.splitHalf = radians(Math.max(2, p.SpokeSplitDegrees)); r.tipHalf *= 0.52; break;
        case SpokeContour.Twisted:
            r.sweep[0] = Math.abs(sweep) > radians(10) ? sweep : radians(20); break;
        case SpokeContour.Turbine:
            r.sweep[0] = Math.abs(sweep) > radians(14) ? sweep : radians(28);
            r.rootHalf *= 1.22; r.tipHalf *= 1.55; r.taperPower = 0.72; r.lean = 0.38; break;
        case SpokeContour.Weave:
            r.families = 2; r.sweep[0] = Math.abs(sweep) > radians(12) ? sweep : radians(24); r.sweep[1] = -r.sweep[0];
            r.rootHalf *= 0.46; r.tipHalf *= 0.52; break;
        case SpokeContour.Dished:
            r.sweep[0] = sweep; r.rootHalf *= 0.62; r.tipHalf *= 2.1; r.taperPower = 2.4; break;
        case SpokeContour.Blade:
            // Aero disc: the bars are nearly a sector wide, so what is left reads as a slot rather than a window.
            r.sweep[0] = sweep; r.rootHalf *= 1.25;
            r.tipHalf = Math.max(r.tipHalf * 2.0, (0.60 * PI * d.BandRadius) / Math.max(2, p.SpokeCount));
            r.taperPower = 0.55; break;
        case SpokeContour.Fan:
            // Luxury multi-spoke: many thin bars of almost constant width with a gentle lean.
            r.sweep[0] = Math.abs(sweep) > radians(4) ? sweep : radians(8);
            r.rootHalf *= 0.58; r.tipHalf = r.rootHalf * 0.80; r.taperPower = 1; break;
        case SpokeContour.Lattice:
            r.sweep[0] = sweep; r.rootHalf *= 0.72; r.tipHalf *= 0.80;
            r.ringRadius = mix(d.HubRadius, d.BandRadius, clamp(p.RingRadiusFraction, 0.15, 0.92));
            r.ringHalf = 0.5 * Math.max(3, p.RingWidthMillimetre) * MILLI; break;
        case SpokeContour.Honeycomb:
            r.sweep[0] = sweep; r.rootHalf *= 0.52; r.tipHalf *= 0.58; r.taperPower = 1;
            r.ringRadius = mix(d.HubRadius, d.BandRadius, clamp(p.RingRadiusFraction, 0.15, 0.92));
            r.ringHalf = 0.5 * Math.max(3, p.RingWidthMillimetre) * MILLI;
            r.staggered = true; break;
        default:
            r.sweep[0] = sweep; break;
    }
    return r;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FACE CONTOUR
//------------------------------------------------------------------------------------------------------------------------

function makeFaceContour(p, d) {
    const s = resolveSpokeRecipe(p, d);
    const fillet = Math.max(0.5 * MILLI, p.FilletMillimetre * MILLI);
    const spokeCount = Math.max(2, p.SpokeCount);
    const phase = radians(p.SpokePhaseDegrees);
    const lugPhase = radians(p.LugPhaseDegrees);
    const lugs = p.LugCount;
    const valveAngle = lugPhase + PI / Math.max(2, p.LugCount);
    const span = Math.max(1e-4, d.BandRadius - d.HubRadius);

    return function sample(radius, angle) {
        const t = saturate((radius - d.HubRadius) / span);
        let phi = d.HubRadius + 0.5 * fillet - radius;
        phi = contourUnion(phi, radius - (d.BandRadius - 0.5 * fillet), fillet);
        if (s.ringRadius > 0) phi = contourUnion(phi, s.ringHalf - Math.abs(radius - s.ringRadius), fillet);

        const taper = Math.pow(t, s.taperPower);
        const half = mix(s.rootHalf, s.tipHalf, taper);
        const arc = Math.max(radius, 1e-3);
        const ease = t * t * (3 - 2 * t);

        // Honeycomb staggers the bars: inside the ring at the authored phase, outside it at half a pitch — the two
        //    rows plus the ring make hexagonal cells, all still one smooth-union contour.
        const rows = s.staggered ? 2 : 1;
        const feather = 0.6 * fillet;
        for (let family = 0; family < s.families; ++family)
        for (let row = 0; row < rows; ++row) {
            let rowGate = 1;
            if (s.staggered) rowGate = row === 0 ? 1 - smoothStep(s.ringRadius - feather, s.ringRadius + feather, radius)
                                                 : smoothStep(s.ringRadius - feather, s.ringRadius + feather, radius);
            if (rowGate <= 0.001) continue;
            const rowHalf = half * rowGate;
            const lean = s.sweep[family] * ease;
            for (let bar = 0; bar < spokeCount; ++bar) {
                const stagger = s.staggered && row === 1 ? PI / spokeCount : 0;
                const root = stagger + phase + (TAU * (bar + 0.5 * family * (s.families > 1 ? 1 : 0))) / spokeCount;
                const axis = root + lean + (s.lean * half) / arc;
                if (s.splitHalf > 0) {
                    const open = s.splitHalf * t * t;
                    const left = rowHalf - Math.abs(angleDelta(angle, axis - open)) * arc;
                    const right = rowHalf - Math.abs(angleDelta(angle, axis + open)) * arc;
                    phi = contourUnion(phi, contourUnion(left, right, fillet * 1.4), fillet);
                } else {
                    phi = contourUnion(phi, rowHalf - Math.abs(angleDelta(angle, axis)) * arc, fillet);
                }
            }
        }

        phi = contourSubtract(phi, d.BoreRadius - radius, 0.6 * fillet);
        const x = radius * Math.cos(angle), y = radius * Math.sin(angle);
        for (let lug = 0; lug < lugs; ++lug) {
            const a = lugPhase + (TAU * lug) / lugs;
            const dx = x - d.LugCircleRadius * Math.cos(a), dy = y - d.LugCircleRadius * Math.sin(a);
            phi = contourSubtract(phi, d.LugHoleRadius - Math.hypot(dx, dy), 0.35 * MILLI);
        }
        if (p.ValveHole) {
            const dx = x - d.ValveRadius * Math.cos(valveAngle), dy = y - d.ValveRadius * Math.sin(valveAngle);
            phi = contourSubtract(phi, d.ValveHoleRadius - Math.hypot(dx, dy), 0.35 * MILLI);
        }
        return phi;
    };
}

export function sampleFaceContour(parameters, radius, angle) {
    const p = Object.assign({}, parameters); normalise(p);
    return makeFaceContour(p, resolveDimensions(p))(radius, angle);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   HEIGHT SURFACES
//------------------------------------------------------------------------------------------------------------------------

function makeHeightSurfaces(p, d) {
    const concavity = p.ConcavityPower;
    const crown = p.CrownMillimetre * MILLI;
    const crownFalloff = Math.max(2 * MILLI, 0.3 * p.SpokeRootWidthMillimetre * MILLI);
    const pad = p.PadThicknessMillimetre * MILLI;
    const spokeThickness = p.SpokeThicknessMillimetre * MILLI;
    const lipThickness = Math.max(3 * MILLI, p.LipThicknessMillimetre * MILLI);
    const relief = p.BackReliefMillimetre * MILLI;
    const reliefFalloff = Math.max(3 * MILLI, 0.35 * p.SpokeRootWidthMillimetre * MILLI);
    const twistLift = Math.tan(radians(clamp(p.SpokeTwistDegrees, -45, 45))) * 0.5 * p.SpokeRootWidthMillimetre * MILLI;
    const bars = Math.max(2, p.SpokeCount);
    const phase = radians(p.SpokePhaseDegrees);
    const lugPhase = radians(p.LugPhaseDegrees);
    const lugs = p.LugCount;
    const seat = p.LugSeat;
    const span = Math.max(1e-4, d.InnerRadius - d.HubRadius);

    function seatDrop(x, y) {
        if (lugs === 0 || d.LugSeatDepth <= 0) return 0;
        let drop = 0;
        for (let lug = 0; lug < lugs; ++lug) {
            const a = lugPhase + (TAU * lug) / lugs;
            const dx = x - d.LugCircleRadius * Math.cos(a), dy = y - d.LugCircleRadius * Math.sin(a);
            const dist = Math.hypot(dx, dy);
            if (dist >= d.LugSeatRadius) continue;
            const u = saturate((d.LugSeatRadius - dist) / Math.max(1e-5, d.LugSeatRadius - d.LugHoleRadius));
            let shape = u;
            if (seat === LugSeat.Ball) shape = 1 - Math.sqrt(Math.max(0, 1 - u * u));
            if (seat === LugSeat.Flat) shape = smoothStep(0, 0.18, u);
            drop = Math.max(drop, d.LugSeatDepth * shape);
        }
        return drop;
    }

    function thickness(radius, phi) {
        const t = saturate((radius - d.HubRadius) / span);
        let th = t < 0.34 ? mix(pad, spokeThickness, smoothStep(0, 0.34, t)) : mix(spokeThickness, lipThickness, smoothStep(0.34, 1, t));
        const pocket = smoothStep(0, reliefFalloff, phi) * smoothStep(0.02, 0.26, t) * (1 - smoothStep(0.8, 0.98, t));
        th -= relief * pocket;
        return Math.max(2.5 * MILLI, th);
    }

    function front(radius, angle, phi) {
        const t = saturate((radius - d.HubRadius) / span);
        let z = mix(d.HubFront, d.LipFront, Math.pow(t, concavity));
        const crownShape = smoothStep(0, crownFalloff, phi) * (1 - smoothStep(0.9, 1, t));
        z += crown * crownShape;
        if (twistLift !== 0) z += twistLift * Math.sin(bars * (angle - phase)) * crownShape * smoothStep(0, 0.55, t);
        z -= seatDrop(radius * Math.cos(angle), radius * Math.sin(angle));
        return z;
    }

    function back(radius, angle, phi) {
        const t = saturate((radius - d.HubRadius) / span);
        return mix(d.HubFront, d.LipFront, Math.pow(t, concavity)) - thickness(radius, phi);
    }

    return { front, back, thickness, lugPhase };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CROSS-SECTION
//------------------------------------------------------------------------------------------------------------------------
// Open (r, z) polyline: outboard weld ⇒ visible inner lip ⇒ outboard flange ⇒ bead seat ⇒ drop well ⇒ inboard flange
//    ⇒ wheel-side wall ⇒ inboard weld. The return leg is the outer leg offset by the wall thickness, so the barrel is
//    real material, not a zero-thickness sweep. The face plate closes the two ends.

export function resolveSection(parameters) {
    const p = Object.assign({}, parameters); normalise(p);
    const d = resolveDimensions(p);
    let knots = [];

    if (parameters.SectionKnots && parameters.SectionKnots.length >= 2) {
        knots = parameters.SectionKnots.map((k) => ({ r: k.r, z: k.z, round: k.round || 0, finish: k.finish || 0 }));
    } else {
        const Rb = d.BeadRadius, Ri = d.InnerRadius, Rf = d.FlangeRadius, Rw = d.WellRadius;
        const wall = Rb - Ri;
        const Rwi = Math.max(0.35 * Ri, Rw - wall);
        const Zo = d.HalfWidth, Zi = -d.HalfWidth, Tf = d.FlangeThickness;
        const taper = d.SeatWidth * Math.tan(radians(clamp(p.BeadSeatTaperDegrees, 0, 12)));
        const wellOut = d.WellCentre + d.WellHalfWidth, wellIn = d.WellCentre - d.WellHalfWidth;
        const K = (r, z, round, finish) => knots.push({ r, z, round, finish });
        K(Ri, d.LipFront, 0, 1);
        K(Ri, Zo + Tf, 1.5 * MILLI, 1);
        K(Rf, Zo + Tf, 2.0 * MILLI, 1);
        K(Rf, Zo, 2.5 * MILLI, 1);
        K(Rb, Zo, 3.5 * MILLI, 2);
        K(Rb - taper, Zo - d.SeatWidth, 2.0 * MILLI, 2);
        K(Rw, wellOut, 6.0 * MILLI, 2);
        K(Rw, wellIn, 6.0 * MILLI, 2);
        K(Rb - taper, Zi + d.SeatWidth, 2.0 * MILLI, 2);
        K(Rb, Zi, 3.5 * MILLI, 2);
        K(Rf, Zi, 2.5 * MILLI, 1);
        K(Rf, Zi - Tf, 2.0 * MILLI, 1);
        K(Ri, Zi - Tf, 1.5 * MILLI, 0);
        K(Ri, Zi + d.SeatWidth, 3.0 * MILLI, 0);
        K(Rwi, wellIn, 5.0 * MILLI, 0);
        K(Rwi, wellOut, 5.0 * MILLI, 0);
        K(Ri, Math.min(d.LipBack - 2 * MILLI, wellOut + 3 * MILLI), 3.0 * MILLI, 0);
        K(Ri, d.LipBack, 0, 0);
    }
    if (knots.length < 2) return knots;

    if (p.SectionSmoothing > 0)
        for (let sweep = 0; sweep < 2; ++sweep) {
            const relaxed = knots.map((k) => Object.assign({}, k));
            for (let i = 1; i + 1 < knots.length; ++i) {
                const w = 0.5 * clamp(p.SectionSmoothing, 0, 1);
                relaxed[i].r = mix(knots[i].r, 0.5 * (knots[i - 1].r + knots[i + 1].r), w);
                relaxed[i].z = mix(knots[i].z, 0.5 * (knots[i - 1].z + knots[i + 1].z), w);
            }
            knots = relaxed;
        }

    // corner rounding (quadratic Bézier fillet tangent to both legs)
    const rounded = [knots[0]];
    for (let i = 1; i + 1 < knots.length; ++i) {
        const prev = knots[i - 1], corner = knots[i], next = knots[i + 1];
        let ax = prev.r - corner.r, az = prev.z - corner.z;
        let bx = next.r - corner.r, bz = next.z - corner.z;
        const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
        if (corner.round <= 0 || la < 1e-6 || lb < 1e-6) { rounded.push(corner); continue; }
        ax /= la; az /= la; bx /= lb; bz /= lb;
        const angle = Math.acos(clamp(ax * bx + az * bz, -0.9999, 0.9999));
        if (angle > PI - 0.02) { rounded.push(corner); continue; }
        const reach = Math.min(corner.round / Math.tan(0.5 * angle), 0.45 * la, 0.45 * lb);
        const arcSteps = Math.max(2, Math.floor((PI - angle) / 0.22) + 1);
        const sx = corner.r + ax * reach, sz = corner.z + az * reach;
        const ex = corner.r + bx * reach, ez = corner.z + bz * reach;
        for (let step = 0; step <= arcSteps; ++step) {
            const t = step / arcSteps, u = 1 - t;
            rounded.push({
                r: u * u * sx + 2 * u * t * corner.r + t * t * ex,
                z: u * u * sz + 2 * u * t * corner.z + t * t * ez,
                round: 0, finish: corner.finish,
            });
        }
    }
    rounded.push(knots[knots.length - 1]);

    // uniform arc-length resample
    const lengths = [0];
    for (let i = 1; i < rounded.length; ++i) lengths.push(lengths[i - 1] + Math.hypot(rounded[i].r - rounded[i - 1].r, rounded[i].z - rounded[i - 1].z));
    const total = lengths[lengths.length - 1];
    if (total <= 0) return rounded;
    const samples = Math.max(8, p.SectionSamples);
    const out = [];
    let cursor = 1;
    for (let step = 0; step <= samples; ++step) {
        const target = (total * step) / samples;
        while (cursor + 1 < rounded.length && lengths[cursor] < target) ++cursor;
        const span = Math.max(1e-9, lengths[cursor] - lengths[cursor - 1]);
        const t = saturate((target - lengths[cursor - 1]) / span);
        out.push({
            r: mix(rounded[cursor - 1].r, rounded[cursor].r, t),
            z: mix(rounded[cursor - 1].z, rounded[cursor].z, t),
            round: 0, finish: t < 0.5 ? rounded[cursor - 1].finish : rounded[cursor].finish,
        });
    }
    out[0] = Object.assign({}, rounded[0]);
    out[out.length - 1] = Object.assign({}, rounded[rounded.length - 1]);
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      SYNTHESIS
//------------------------------------------------------------------------------------------------------------------------

export function synthesise(parameters) {
    const p = Object.assign({}, parameters);
    normalise(p);
    const d = resolveDimensions(p);
    const contour = makeFaceContour(p, d);
    const height = makeHeightSurfaces(p, d);

    const positions = [];     // 3 per vertex
    const corners = [];       // 3 per triangle
    const cornerUv = [];      // 6 per triangle
    const slots = [];         // 1 per triangle
    const parts = [];

    const addVertex = (x, y, z) => { positions.push(x, y, z); return positions.length / 3 - 1; };
    const addTriangle = (a, b, c, slot, uvA, uvB, uvC) => {
        corners.push(a, b, c); slots.push(slot);
        cornerUv.push(uvA[0], uvA[1], uvB[0], uvB[1], uvC[0], uvC[1]);
    };
    const addQuad = (a, b, c, e, slot, uvA, uvB, uvC, uvD) => { addTriangle(a, b, c, slot, uvA, uvB, uvC); addTriangle(a, c, e, slot, uvA, uvC, uvD); };

    const angular = p.AngularSegments, radial = p.RadialSegments;
    const start = Math.max(0.35 * d.BoreRadius, 0.04 * d.InnerRadius);
    const finish = d.InnerRadius;
    const ringRadius = (j) => mix(start, finish, j / radial);
    const ringAngle = (i) => (TAU * (i % angular)) / angular;
    const slotOf = (i, j) => (i % angular) * (radial + 1) + j;

    // ① vertex field
    const count = angular * (radial + 1);
    const vertexPhi = new Float64Array(count), vertexRadius = new Float64Array(count), vertexAngle = new Float64Array(count);
    for (let i = 0; i < angular; ++i)
        for (let j = 0; j <= radial; ++j) {
            const s = i * (radial + 1) + j;
            vertexRadius[s] = ringRadius(j); vertexAngle[s] = ringAngle(i);
            vertexPhi[s] = contour(vertexRadius[s], vertexAngle[s]);
        }

    // ② cell mask (the two outermost rings are the weld band and always solid)
    const kept = new Uint8Array(angular * radial);
    for (let i = 0; i < angular; ++i)
        for (let j = 0; j < radial; ++j) {
            const r = 0.5 * (ringRadius(j) + ringRadius(j + 1));
            const a = ringAngle(i) + (0.5 * TAU) / angular;
            kept[i * radial + j] = j + 2 >= radial || contour(r, a) > 0 ? 1 : 0;
        }
    const cellKept = (i, j) => j < radial && j >= 0 && kept[(((i % angular) + angular) % angular) * radial + j] !== 0;

    // ③ cleanup: spurs, then pinch vertices, so every vertex star is a single fan (manifold guarantee)
    for (let sweep = 0; sweep < 8; ++sweep) {
        let removed = 0;
        for (let i = 0; i < angular; ++i)
            for (let j = 0; j + 2 < radial; ++j) {
                if (!cellKept(i, j)) continue;
                const neighbours = (cellKept(i + 1, j) ? 1 : 0) + (cellKept(i - 1, j) ? 1 : 0) + (j > 0 && cellKept(i, j - 1) ? 1 : 0) + (cellKept(i, j + 1) ? 1 : 0);
                if (neighbours <= 1) { kept[i * radial + j] = 0; ++removed; }
            }
        for (let i = 0; i < angular; ++i)
            for (let j = 1; j + 2 < radial; ++j) {
                const im = (i + angular - 1) % angular;
                const quad = [cellKept(i, j), cellKept(im, j), cellKept(im, j - 1), cellKept(i, j - 1)];
                let runs = 0;
                for (let k = 0; k < 4; ++k) if (quad[k] && !quad[(k + 3) % 4]) ++runs;
                if (runs < 2) continue;
                const cells = [[i, j], [im, j], [im, j - 1], [i, j - 1]];
                let victim = -1, weakest = 1e9;
                for (let k = 0; k < 4; ++k) {
                    if (!quad[k]) continue;
                    const [ci, cj] = cells[k];
                    if (cj + 2 >= radial) continue;
                    const phi = contour(0.5 * (ringRadius(cj) + ringRadius(cj + 1)), ringAngle(ci) + (0.5 * TAU) / angular);
                    if (phi < weakest) { weakest = phi; victim = k; }
                }
                if (victim >= 0) { kept[cells[victim][0] * radial + cells[victim][1]] = 0; ++removed; }
            }
        if (removed === 0) break;
    }

    const vertexUsed = (i, j) => {
        const im = (i + angular - 1) % angular;
        return cellKept(i, j) || cellKept(im, j) || (j > 0 && (cellKept(i, j - 1) || cellKept(im, j - 1)));
    };
    const vertexOnEdge = (i, j) => {
        const im = (i + angular - 1) % angular;
        const c = (cellKept(i, j) ? 1 : 0) + (cellKept(im, j) ? 1 : 0) + (j > 0 && cellKept(i, j - 1) ? 1 : 0) + (j > 0 && cellKept(im, j - 1) ? 1 : 0);
        return c > 0 && c < 4;
    };

    // ④ snap window-edge vertices onto ϕ = 0 along ∇ϕ (this is what keeps the hole edges smooth, not stepped)
    const cellRadial = (finish - start) / radial;
    for (let i = 0; i < angular; ++i)
        for (let j = 1; j + 2 < radial; ++j) {
            if (!vertexUsed(i, j) || !vertexOnEdge(i, j)) continue;
            const s = i * (radial + 1) + j;
            let r = vertexRadius[s], a = vertexAngle[s];
            const cellArc = (TAU * r) / angular;
            const reach = 0.9 * Math.max(cellRadial, cellArc);
            for (let step = 0; step < 5; ++step) {
                const h = 0.25 * Math.min(cellRadial, cellArc);
                const phi = contour(r, a);
                const gr = (contour(r + h, a) - contour(r - h, a)) / (2 * h);
                const ga = (contour(r, a + h / r) - contour(r, a - h / r)) / (2 * h);
                const g2 = gr * gr + ga * ga;
                if (g2 < 1e-8) break;
                let dr = (-phi * gr) / g2, da = (-phi * ga) / g2;
                const len = Math.hypot(dr, da);
                if (len > reach) { dr *= reach / len; da *= reach / len; }
                r = clamp(r + dr, ringRadius(j) - 1.45 * cellRadial, ringRadius(j) + 1.45 * cellRadial);
                a += da / Math.max(r, 1e-3);
            }
            vertexRadius[s] = r; vertexAngle[s] = a; vertexPhi[s] = contour(r, a);
        }

    // ⑤ the two height sheets
    const NONE = -1;
    const frontSlot = new Int32Array(count).fill(NONE), backSlot = new Int32Array(count).fill(NONE);
    const vertexUv = new Float64Array(count * 2);
    for (let i = 0; i < angular; ++i)
        for (let j = 0; j <= radial; ++j) {
            if (!vertexUsed(i, j)) continue;
            const s = i * (radial + 1) + j;
            const r = vertexRadius[s], a = vertexAngle[s], phi = Math.max(0, vertexPhi[s]);
            const x = r * Math.cos(a), y = r * Math.sin(a);
            const zf = height.front(r, a, phi);
            frontSlot[s] = addVertex(x, y, zf);
            backSlot[s] = addVertex(x, y, Math.min(height.back(r, a, phi), zf - 1.5 * MILLI));
            vertexUv[s * 2] = a / TAU; vertexUv[s * 2 + 1] = r / d.InnerRadius;
        }

    for (let i = 0; i < angular; ++i)
        for (let j = 0; j < radial; ++j) {
            if (!cellKept(i, j)) continue;
            const s00 = slotOf(i, j), s10 = slotOf(i + 1, j), s11 = slotOf(i + 1, j + 1), s01 = slotOf(i, j + 1);
            const uv00 = [vertexUv[s00 * 2], vertexUv[s00 * 2 + 1]];
            const uv01 = [vertexUv[s01 * 2], vertexUv[s01 * 2 + 1]];
            const uv10 = [vertexUv[s10 * 2] < uv00[0] ? vertexUv[s10 * 2] + 1 : vertexUv[s10 * 2], vertexUv[s10 * 2 + 1]];
            const uv11 = [vertexUv[s11 * 2] < uv01[0] ? vertexUv[s11 * 2] + 1 : vertexUv[s11 * 2], vertexUv[s11 * 2 + 1]];
            addQuad(frontSlot[s00], frontSlot[s10], frontSlot[s11], frontSlot[s01], RimSlot.FaceFront, uv00, uv10, uv11, uv01);
            addQuad(backSlot[s01], backSlot[s11], backSlot[s10], backSlot[s00], RimSlot.WindowWall, uv01, uv11, uv10, uv00);
        }

    // ⑥ window walls: rounded bevel band stitching front sheet to back sheet along every ϕ = 0 contour
    const bands = Math.max(1, p.BevelBands);
    const bevel = p.BevelMillimetre * MILLI;
    const wallSlot = new Int32Array(count * (bands + 1)).fill(NONE);
    function wallVertex(s, band) {
        if (band === 0) return frontSlot[s];
        if (band === bands) return backSlot[s];
        const key = s * (bands + 1) + band;
        if (wallSlot[key] !== NONE) return wallSlot[key];
        const r = vertexRadius[s], a = vertexAngle[s], phi = Math.max(0, vertexPhi[s]);
        const h = 0.15 * MILLI;
        const gr = (contour(r + h, a) - contour(r - h, a)) / (2 * h);
        const ga = (contour(r, a + h / r) - contour(r, a - h / r)) / (2 * h);
        const len = Math.hypot(gr, ga);
        const nr = len > 1e-6 ? -gr / len : 0, na = len > 1e-6 ? -ga / len : 0;
        const u = band / bands;
        const push = bevel * Math.sin(PI * u);
        const rr = r + nr * push;
        const aa = a + (na * push) / Math.max(rr, 1e-3);
        const zf = height.front(r, a, phi);
        const zb = Math.min(height.back(r, a, phi), zf - 1.5 * MILLI);
        const id = addVertex(rr * Math.cos(aa), rr * Math.sin(aa), mix(zf, zb, u));
        wallSlot[key] = id;
        return id;
    }

    for (let i = 0; i < angular; ++i)
        for (let j = 0; j < radial; ++j) {
            if (!cellKept(i, j)) continue;
            const s00 = slotOf(i, j), s10 = slotOf(i + 1, j), s11 = slotOf(i + 1, j + 1), s01 = slotOf(i, j + 1);
            const runs = [
                [s00, s10, j === 0 || !cellKept(i, j - 1)],
                [s10, s11, !cellKept(i + 1, j)],
                [s11, s01, j + 1 < radial ? !cellKept(i, j + 1) : false],
                [s01, s00, !cellKept(i - 1, j)],
            ];
            for (const [ra, rb, open] of runs) {
                if (!open) continue;
                for (let band = 0; band < bands; ++band) {
                    const a0 = wallVertex(ra, band), b0 = wallVertex(rb, band);
                    const a1 = wallVertex(ra, band + 1), b1 = wallVertex(rb, band + 1);
                    const v0 = band / bands, v1 = (band + 1) / bands;
                    addQuad(b0, a0, a1, b1, RimSlot.WindowWall,
                        [vertexUv[rb * 2], v0], [vertexUv[ra * 2], v0], [vertexUv[ra * 2], v1], [vertexUv[rb * 2], v1]);
                }
            }
        }

    // ⑦ barrel: cross-section revolved, both ends welded to the face sheet's outer rings
    const section = resolveSection(p);
    if (section.length >= 2) {
        const arc = [0];
        for (let s = 1; s < section.length; ++s) arc.push(arc[s - 1] + Math.hypot(section[s].r - section[s - 1].r, section[s].z - section[s - 1].z));
        const total = Math.max(1e-6, arc[arc.length - 1]);
        let previous = new Int32Array(angular), current = new Int32Array(angular);
        for (let i = 0; i < angular; ++i) previous[i] = frontSlot[slotOf(i, radial)];
        for (let s = 1; s < section.length; ++s) {
            const last = s + 1 === section.length;
            for (let i = 0; i < angular; ++i) {
                if (last) { current[i] = backSlot[slotOf(i, radial)]; continue; }
                const a = vertexAngle[slotOf(i, radial)];
                current[i] = addVertex(section[s].r * Math.cos(a), section[s].r * Math.sin(a), section[s].z);
            }
            const slot = section[s].finish === 0 ? RimSlot.BarrelBore : RimSlot.Lip;
            const v0 = arc[s - 1] / total, v1 = arc[s] / total;
            for (let i = 0; i < angular; ++i) {
                const inext = (i + 1) % angular;
                const u0 = i / angular, u1 = (i + 1) / angular;
                addQuad(previous[i], previous[inext], current[inext], current[i], slot, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
            }
            const swap = previous; previous = current; current = swap;
        }
    }

    const surface = { positions, corners, cornerUv, slots, parts, cornerNormals: null };
    parts.push({ name: 'RimBody', firstTriangle: 0, triangleCount: slots.length });
    enforceOutwardOrientation(surface, 0, slots.length);

    // ⑧ hardware: lug nuts and the centre cap, each its own closed shell
    function addRevolution(profile, facets, cx, cy, phase, slot, faceted) {
        const rings = profile.length / 2;
        if (rings < 2 || facets < 3) return;
        const ids = new Int32Array(rings * facets);
        for (let r = 0; r < rings; ++r)
            for (let f = 0; f < facets; ++f) {
                const a = phase + (TAU * f) / facets;
                const shape = faceted ? 1 / Math.cos(((a - phase + TAU) % (TAU / facets)) - (0.5 * TAU) / facets) : 1;
                const radius = profile[r * 2] * shape;
                ids[r * facets + f] = addVertex(cx + radius * Math.cos(a), cy + radius * Math.sin(a), profile[r * 2 + 1]);
            }
        for (let r = 0; r + 1 < rings; ++r)
            for (let f = 0; f < facets; ++f) {
                const fn = (f + 1) % facets;
                const u0 = f / facets, u1 = (f + 1) / facets, v0 = r / (rings - 1), v1 = (r + 1) / (rings - 1);
                addQuad(ids[r * facets + f], ids[r * facets + fn], ids[(r + 1) * facets + fn], ids[(r + 1) * facets + f], slot,
                    [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
            }
        const bottom = addVertex(cx, cy, profile[1]);
        const top = addVertex(cx, cy, profile[(rings - 1) * 2 + 1]);
        for (let f = 0; f < facets; ++f) {
            const fn = (f + 1) % facets;
            addTriangle(bottom, ids[fn], ids[f], slot, [0.5, 0.5], [(f + 1) / facets, 0], [f / facets, 0]);
            addTriangle(top, ids[(rings - 1) * facets + f], ids[(rings - 1) * facets + fn], slot, [0.5, 0.5], [f / facets, 1], [(f + 1) / facets, 1]);
        }
    }

    if (p.GenerateLugNuts && p.LugCount > 0) {
        const flats = p.LugNutFlatsMillimetre * MILLI;
        const nutHeight = p.LugNutHeightMillimetre * MILLI;
        const chamfer = p.LugNutChamferMillimetre * MILLI;
        const across = 0.5 * flats;
        const facets = p.LugNut === LugNut.Spline ? 12 : 6;
        for (let lug = 0; lug < p.LugCount; ++lug) {
            const a = height.lugPhase + (TAU * lug) / p.LugCount;
            const cx = d.LugCircleRadius * Math.cos(a), cy = d.LugCircleRadius * Math.sin(a);
            const surfaceZ = height.front(d.LugCircleRadius, a, 1);
            const seat = surfaceZ - d.LugSeatDepth + p.LugNutProudMillimetre * MILLI;
            const rise = Math.max(1.5 * MILLI, d.LugSeatDepth);
            const profile = [
                d.LugHoleRadius * 0.92, seat,
                d.LugSeatRadius, seat + rise,
                across * 0.98, seat + rise + 0.6 * MILLI,
                across, seat + nutHeight - chamfer,
                across - chamfer, seat + nutHeight];
            if (p.LugNut === LugNut.Capped) {
                profile[8] = across - chamfer; profile[9] = seat + nutHeight - 0.35 * across;
                profile.push(across * 0.55, seat + nutHeight);
            }
            const first = slots.length;
            addRevolution(profile, facets, cx, cy, a, RimSlot.Hardware, true);
            parts.push({ name: `LugNut.${lug}`, firstTriangle: first, triangleCount: slots.length - first });
            enforceOutwardOrientation(surface, first, slots.length - first);
        }
    }

    if (p.GenerateLipBolts && p.LipBoltCount > 0) {
        // Beadlock-style bolt heads marching around the outer band — the offroad / show-wheel tell.
        const across = 0.5 * Math.max(3, p.LipBoltDiameterMillimetre) * MILLI;
        const proud = Math.max(0.8 * MILLI, p.LipBoltProudMillimetre * MILLI);
        const circle = mix(d.BandRadius, d.InnerRadius, 0.55);
        for (let bolt = 0; bolt < p.LipBoltCount; ++bolt) {
            const a = (TAU * bolt) / p.LipBoltCount;
            const cx = circle * Math.cos(a), cy = circle * Math.sin(a);
            const seat = height.front(circle, a, 1) - 0.3 * MILLI;
            const profile = [
                across * 1.25, seat,
                across * 1.25, seat + 0.35 * proud,
                across, seat + 0.55 * proud,
                across, seat + proud - 0.35 * across,
                across * 0.70, seat + proud];
            const first = slots.length;
            addRevolution(profile, 6, cx, cy, a, RimSlot.Hardware, true);
            parts.push({ name: `LipBolt.${bolt}`, firstTriangle: first, triangleCount: slots.length - first });
            enforceOutwardOrientation(surface, first, slots.length - first);
        }
    }

    if (p.CentreLock) {
        // Single central nut (GT3 / endurance): sits on the hub pad, swallowing the bore.
        const across = 0.5 * Math.max(20, p.CentreLockFlatsMillimetre) * MILLI;
        const chamfer = 0.12 * across;
        const seat = height.front(0, 0, 1) - 1 * MILLI;
        const tall = 1.15 * across;
        const profile = [
            d.BoreRadius * 0.55, seat,
            across * 1.06, seat + 0.22 * across,
            across, seat + 0.34 * across,
            across, seat + tall - chamfer,
            across - chamfer, seat + tall];
        const first = slots.length;
        addRevolution(profile, 6, 0, 0, 0, RimSlot.Hardware, true);
        parts.push({ name: 'CentreLockNut', firstTriangle: first, triangleCount: slots.length - first });
        enforceOutwardOrientation(surface, first, slots.length - first);
    }

    if (p.GenerateCentreCap && !p.CentreLock) {
        const radius = clamp(p.CentreCapRadiusFraction, 0.1, 1) * d.HubRadius;
        const dome = p.CentreCapDomeMillimetre * MILLI;
        const base = height.front(0, 0, 1) - 2 * MILLI;
        const profile = [radius * 0.96, base, radius, base + 1.5 * MILLI];
        const rings = 10;
        for (let r = 0; r <= rings; ++r) {
            const t = r / rings;
            profile.push(radius * Math.cos(0.5 * PI * t), base + 1.5 * MILLI + dome * Math.sin(0.5 * PI * t));
        }
        const first = slots.length;
        addRevolution(profile, Math.max(8, p.HardwareSegments), 0, 0, 0, RimSlot.CentreCap, false);
        parts.push({ name: 'CentreCap', firstTriangle: first, triangleCount: slots.length - first });
        enforceOutwardOrientation(surface, first, slots.length - first);
    }

    computeCornerNormals(surface, p.CreaseDegrees);
    surface.dimensions = d;
    return surface;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   NORMALS · ORIENTATION
//------------------------------------------------------------------------------------------------------------------------

function enforceOutwardOrientation(surface, first, count) {
    const { positions, corners, cornerUv } = surface;
    let volume = 0;
    for (let f = first; f < first + count; ++f) {
        const a = corners[f * 3] * 3, b = corners[f * 3 + 1] * 3, c = corners[f * 3 + 2] * 3;
        volume += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
                 - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
                 + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
    }
    if (volume >= 0) return;
    for (let f = first; f < first + count; ++f) {
        const t = corners[f * 3 + 1]; corners[f * 3 + 1] = corners[f * 3 + 2]; corners[f * 3 + 2] = t;
        for (let k = 0; k < 2; ++k) {
            const u = cornerUv[f * 6 + 2 + k]; cornerUv[f * 6 + 2 + k] = cornerUv[f * 6 + 4 + k]; cornerUv[f * 6 + 4 + k] = u;
        }
    }
}

function computeCornerNormals(surface, creaseDegrees) {
    const { positions, corners } = surface;
    const faces = corners.length / 3;
    const vertices = positions.length / 3;
    const faceNormals = new Float32Array(faces * 3);
    const faceAreas = new Float32Array(faces);
    for (let f = 0; f < faces; ++f) {
        const a = corners[f * 3] * 3, b = corners[f * 3 + 1] * 3, c = corners[f * 3 + 2] * 3;
        const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        faceAreas[f] = 0.5 * len;
        if (len > 0) { faceNormals[f * 3] = nx / len; faceNormals[f * 3 + 1] = ny / len; faceNormals[f * 3 + 2] = nz / len; }
    }
    const offsets = new Uint32Array(vertices + 1);
    for (let i = 0; i < corners.length; ++i) ++offsets[corners[i] + 1];
    for (let v = 0; v < vertices; ++v) offsets[v + 1] += offsets[v];
    const incident = new Uint32Array(corners.length);
    const cursor = offsets.slice(0, vertices);
    for (let f = 0; f < faces; ++f) for (let k = 0; k < 3; ++k) incident[cursor[corners[f * 3 + k]]++] = f;

    const creaseCosine = Math.cos(radians(clamp(creaseDegrees, 1, 179)));
    const normals = new Float32Array(faces * 9);
    for (let f = 0; f < faces; ++f)
        for (let k = 0; k < 3; ++k) {
            const v = corners[f * 3 + k];
            const ox = faceNormals[f * 3], oy = faceNormals[f * 3 + 1], oz = faceNormals[f * 3 + 2];
            let nx = 0, ny = 0, nz = 0;
            for (let i = offsets[v]; i < offsets[v + 1]; ++i) {
                const g = incident[i];
                const gx = faceNormals[g * 3], gy = faceNormals[g * 3 + 1], gz = faceNormals[g * 3 + 2];
                if (ox * gx + oy * gy + oz * gz < creaseCosine) continue;
                nx += gx * faceAreas[g]; ny += gy * faceAreas[g]; nz += gz * faceAreas[g];
            }
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-20) { nx /= len; ny /= len; nz /= len; } else { nx = ox; ny = oy; nz = oz; }
            normals[f * 9 + k * 3] = nx; normals[f * 9 + k * 3 + 1] = ny; normals[f * 9 + k * 3 + 2] = nz;
        }
    surface.cornerNormals = normals;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        AUDIT
//------------------------------------------------------------------------------------------------------------------------
// Proves the topology contract: one shell, no boundary edges, no non-manifold edges, no flipped edges, positive volume.

export function audit(surface, firstTriangle = 0, count = Infinity) {
    const { positions, corners } = surface;
    const faces = corners.length / 3;
    const last = Math.min(faces, firstTriangle + count);
    const report = { vertexCount: 0, triangleCount: Math.max(0, last - firstTriangle), shellCount: 0, boundaryEdges: 0, nonManifoldEdges: 0, flippedEdges: 0, degenerateFaces: 0, signedVolume: 0, surfaceArea: 0 };
    if (firstTriangle >= last) return report;

    const uses = new Map();     // key ⇒ [count, direction sum]
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };

    for (let f = firstTriangle; f < last; ++f)
        for (let k = 0; k < 3; ++k) { const v = corners[f * 3 + k]; if (!parent.has(v)) parent.set(v, v); }
    report.vertexCount = parent.size;

    for (let f = firstTriangle; f < last; ++f) {
        const ia = corners[f * 3], ib = corners[f * 3 + 1], ic = corners[f * 3 + 2];
        if (ia === ib || ib === ic || ia === ic) { ++report.degenerateFaces; continue; }
        const a = ia * 3, b = ib * 3, c = ic * 3;
        const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        report.surfaceArea += 0.5 * Math.hypot(nx, ny, nz);
        report.signedVolume += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
                              - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
                              + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
        const triple = [ia, ib, ic];
        for (let k = 0; k < 3; ++k) {
            const x = triple[k], y = triple[(k + 1) % 3];
            const key = Math.min(x, y) * 4294967296 + Math.max(x, y);
            const entry = uses.get(key);
            if (entry === undefined) uses.set(key, [1, x < y ? 1 : -1]);
            else { entry[0] += 1; entry[1] += x < y ? 1 : -1; }
            const rx = find(x), ry = find(y);
            if (rx !== ry) parent.set(rx, ry);
        }
    }
    for (const [, entry] of uses) {
        if (entry[0] === 1) ++report.boundaryEdges;
        else if (entry[0] > 2) ++report.nonManifoldEdges;
        else if (entry[1] !== 0) ++report.flippedEdges;
    }
    let shells = 0;
    for (const key of parent.keys()) if (find(key) === key) ++shells;
    report.shellCount = shells;
    report.watertight = report.boundaryEdges === 0 && report.nonManifoldEdges === 0 && report.flippedEdges === 0;
    return report;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   BUFFER CONVERSION
//------------------------------------------------------------------------------------------------------------------------
// Non-indexed triangle soup sorted by slot, with one draw range per slot — exactly what a multi-material mesh wants.

export function toBuffers(surface) {
    const faces = surface.slots.length;
    const order = Array.from({ length: faces }, (_, i) => i).sort((a, b) => surface.slots[a] - surface.slots[b]);
    const position = new Float32Array(faces * 9);
    const normal = new Float32Array(faces * 9);
    const uv = new Float32Array(faces * 6);
    const groups = [];
    let current = -1;
    for (let o = 0; o < faces; ++o) {
        const f = order[o];
        const slot = surface.slots[f];
        if (slot !== current) { groups.push({ start: o * 3, count: 0, slot }); current = slot; }
        groups[groups.length - 1].count += 3;
        for (let k = 0; k < 3; ++k) {
            const v = surface.corners[f * 3 + k] * 3;
            position[o * 9 + k * 3] = surface.positions[v];
            position[o * 9 + k * 3 + 1] = surface.positions[v + 1];
            position[o * 9 + k * 3 + 2] = surface.positions[v + 2];
            normal[o * 9 + k * 3] = surface.cornerNormals[f * 9 + k * 3];
            normal[o * 9 + k * 3 + 1] = surface.cornerNormals[f * 9 + k * 3 + 1];
            normal[o * 9 + k * 3 + 2] = surface.cornerNormals[f * 9 + k * 3 + 2];
            uv[o * 6 + k * 2] = surface.cornerUv[f * 6 + k * 2];
            uv[o * 6 + k * 2 + 1] = surface.cornerUv[f * 6 + k * 2 + 1];
        }
    }
    return { position, normal, uv, groups };
}

// Wavefront OBJ text, one group per part — the same dump the C++ harness writes.
export function toWavefront(surface) {
    const lines = ['# Frontier WheelRimSketcher'];
    const { positions, corners, cornerNormals, cornerUv, slots, parts } = surface;
    for (let v = 0; v < positions.length; v += 3) lines.push(`v ${positions[v].toFixed(6)} ${positions[v + 1].toFixed(6)} ${positions[v + 2].toFixed(6)}`);
    for (let c = 0; c < cornerUv.length; c += 2) lines.push(`vt ${cornerUv[c].toFixed(6)} ${cornerUv[c + 1].toFixed(6)}`);
    for (let n = 0; n < cornerNormals.length; n += 3) lines.push(`vn ${cornerNormals[n].toFixed(5)} ${cornerNormals[n + 1].toFixed(5)} ${cornerNormals[n + 2].toFixed(5)}`);
    let cursor = 0;
    for (let f = 0; f < slots.length; ++f) {
        while (cursor < parts.length && f === parts[cursor].firstTriangle) lines.push(`g ${parts[cursor++].name}`);
        lines.push(`usemtl slot_${slots[f]}`);
        const c = [];
        for (let k = 0; k < 3; ++k) { const i = f * 3 + k + 1; c.push(`${corners[f * 3 + k] + 1}/${i}/${i}`); }
        lines.push(`f ${c.join(' ')}`);
    }
    return lines.join('\n');
}

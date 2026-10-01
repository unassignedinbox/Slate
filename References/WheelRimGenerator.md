# Procedural Wheel-Rim Generator

`Engine/ContentInterchange/WheelRimSpecification.{h,cpp}` — parameters ⇒ geometry (no engine dependencies)
`Engine/ContentInterchange/WheelRimStructure.{h,cpp}`     — engine seam: TriangleIndex soup, OpenPBR materials, glTF export
`Scratchpad/WheelRimGeneratorTest.cpp`                    — bring-up harness: synthesise every preset, audit, dump OBJ
`Scratchpad/RimPreviewRaster.py`                          — software preview rasteriser for those OBJs (diagnostics only)
`Tools/WheelRimSketcher/`                                — browser twin: live three.js viewer, material + colour panel, OBJ/glTF export

Rim and spokes only — no tyre is ever generated. Lug nuts and the centre cap are separate closed shells.

---

## 1. The topology contract

The rim body is **one connected, closed, orientation-consistent two-manifold**. Not a disc with spoke solids laid on
top, not a boolean union of overlapping primitives, not a set of separate parts sharing a pivot: a single surface.

* The face is one swept sheet. Its silhouette comes from a signed scalar contour `ϕ(r,θ)` (metres, `> 0` = solid)
  that smooth-unions the hub disc, the outer band and the spoke bars, then smooth-subtracts the bore, the lug holes
  and the valve hole. The smooth-minimum radius **is** the casting fillet — a spoke grows out of the hub as one
  continuous surface, with no crease and no intersection seam.
* Windows are *handles cut through that one sheet*: front sheet ⇒ bevel band ⇒ back sheet, all welded.
* The barrel is the cross-section curve revolved, and its two open ends are welded to the face sheet's outer rings
  (shared vertices, not coincident duplicates).

`RimSurface::Audit()` proves it per part:

```
ForgedFiveSpoke    tris  280280  verts 140132 | BODY shells 1  boundary 0  nonmanifold 0  flipped 0  vol 0.001920 m3 OK
SplitTenSpoke      tris  293852  verts 146908 | BODY shells 1  boundary 0  nonmanifold 0  flipped 0  vol 0.001923 m3 OK
TwentySpokeWeave   tris  378428  verts 189156 | BODY shells 1  boundary 0  nonmanifold 0  flipped 0  vol 0.002139 m3 OK
TurbineAero        tris  354752  verts 177358 | BODY shells 1  boundary 0  nonmanifold 0  flipped 0  vol 0.002441 m3 OK
DeepDishConcave    tris  297840  verts 148908 | BODY shells 1  boundary 0  nonmanifold 0  flipped 0  vol 0.001809 m3 OK
HeavyDutySixSpoke  tris  291596  verts 145788 | BODY shells 1  boundary 0  nonmanifold 0  flipped 0  vol 0.002207 m3 OK
```

`shells 1` = one connected piece · `boundary 0` = watertight · `flipped 0` = every edge used once in each direction ·
`vol ≈ 1.8–2.4 L` = ~5–6.5 kg of aluminium, i.e. the shell encloses a physically plausible solid (the barrel carries a
real wall thickness, it is not a zero-thickness sweep). Genus is whatever the window / bore / lug count implies —
connectivity is always exactly one.

How that is achieved without a mesh boolean: a polar lattice is kept where `ϕ > 0`, spur cells and pinch vertices are
removed so every vertex star is a single fan, boundary vertices are Newton-snapped onto `ϕ = 0` along `∇ϕ` (so the
window edges are smooth, not a staircase), and each boundary edge emits a rounded bevel band linking the two sheets.

---

## 2. Local frame and units

Rim space: spin axis `+Z`, outboard face toward `+Z`, barrel centre plane `z = 0`, metres throughout the output.
Parameters are automotive on the way in: inch diameter and width, millimetre offset / PCD / bore / thicknesses.
`WheelRimStructure` stands the wheel up for display (spin axis onto `+Y`, tread resting on `Z = 0`, CLAUDE.md §7).

---

## 3. Parameters (`WheelRimParameters`)

| Group | Fields |
|---|---|
| Size | `DiameterInch` · `WidthInch` · `OffsetMillimetre` (ET) · `FlangeHeightMillimetre` · `FlangeThicknessMillimetre` · `BarrelWallMillimetre` · `WellDepthMillimetre` · `WellOffsetFraction` · `WellWidthFraction` · `BeadSeatTaperDegrees` |
| Cross-section | `SectionKnots` (override the derived J-section with your own `(r, z, fillet, finish)` polyline) · `SectionSamples` · `SectionSmoothing` |
| Face plate | `HubRadiusFraction` · `OuterBandFraction` · `PadThicknessMillimetre` · `SpokeThicknessMillimetre` · `LipThicknessMillimetre` · `DishMillimetre` · `ConcavityPower` · `CrownMillimetre` · `BackReliefMillimetre` · `FilletMillimetre` · `BevelMillimetre` · `BevelBands` |
| Spokes | `SpokeContour` (Straight · Split · Twisted · Turbine · Weave · Dished · Blade · Fan · Lattice · Honeycomb) · `RingRadiusFraction` · `RingWidthMillimetre` (concentric ring used by Lattice / Honeycomb) · `SpokeCount` · `SpokeRootWidthMillimetre` · `SpokeTipWidthMillimetre` · `SpokeTaperPower` · `SpokeSweepDegrees` · `SpokeTwistDegrees` · `SpokeSplitDegrees` · `SpokePhaseDegrees` |
| Hub / hardware | `CentreBoreMillimetre` · `BoreChamferMillimetre` · `LugCount` · `LugCircleMillimetre` (PCD) · `LugHoleMillimetre` · `LugSeat` (Conical · Ball · Flat) · `LugSeatAngleDegrees` · `LugSeatDepthMillimetre` · `LugPhaseDegrees` · `ValveHole` · `ValveHoleMillimetre` · `ValveRadiusFraction` · `GenerateLugNuts` · `LugNut` (Hex · Spline · Capped) · `LugNutFlatsMillimetre` · `LugNutHeightMillimetre` · `LugNutChamferMillimetre` · `LugNutProudMillimetre` · `GenerateCentreCap` · `CentreCapRadiusFraction` · `CentreCapDomeMillimetre` · `GenerateLipBolts` · `LipBoltCount` · `LipBoltDiameterMillimetre` · `LipBoltProudMillimetre` (beadlock-style heads around the outer band) · `CentreLock` · `CentreLockFlatsMillimetre` (single central GT3 nut; suppresses the lugs and the cap) |
| Finishes | `FaceFinish` · `PocketFinish` · `LipFinish` · `HardwareFinish` · `CapFinish` · `FacePaint[3]` · `PocketPaint[3]` |
| Tessellation | `AngularSegments` · `RadialSegments` · `HardwareSegments` · `CreaseDegrees` |

`Normalise()` pins every field into a buildable range (and reports what it changed); it also opens the bolt circle if
the lug holes would collide with the bore and caps the spoke tip width at the sector pitch.

**Presets** (`WheelRimParameters::FromPreset`) — 26, each also reachable from the browser tool and from `--rim`:

| Group | Presets (`--rim` name) |
|---|---|
| Classic | `ForgedFiveSpoke` (forged) · `SplitTenSpoke` (split) · `TwentySpokeWeave` (weave) · `TurbineAero` (turbine) · `DeepDishConcave` (dish) · `HeavyDutySixSpoke` (truck) |
| Offroad | `OffroadBeadlock` (beadlock, 24 lip bolts) · `OffroadRockEight` (rock) · `OffroadOverland` (overland) · `OffroadSteelLook` (steel) · `OffroadDuallyRing` (dually, 8-lug lattice) |
| GT3 / endurance | `Gt3CentreLockAero` (gt3aero) · `Gt3EnduranceTen` (gt3ten) · `Gt3TurbineCover` (gt3cover) · `Gt3SplitBlade` (gt3blade) — all centre-lock |
| GT / sport | `GtTwinFiveSplit` (gtsplit) · `GtDirectional` (gtdir) · `GtMeshNineteen` (gtmesh) · `GtHoneycomb` (honeycomb) |
| Luxury | `LuxuryFanTwenty` (fan) · `LuxuryFineMesh` (finemesh) · `LuxuryDishCruiser` (cruiser) · `LuxuryConcaveTen` (concave) |
| Show | `ShowDeepChrome` (chrome, 30 lip bolts) · `ShowCandyWeave` (candy) · `ShowGoldPinwheel` (pinwheel) |

A preset only writes fields — override anything afterwards. Finishes: 13 recipes, now including `GunmetalPaint`,
`CandyRed` and `RaceWhite`.

### The blank-rim cross-section curve

`WheelRimSpecification::ResolveSection(Parameters)` returns the contour actually used: the derived J-section (or your
`SectionKnots`), corner-rounded and arc-length resampled. The derived path runs
*outboard weld ⇒ visible inner lip ⇒ outboard flange ⇒ bead seat ⇒ drop well ⇒ inboard flange ⇒ wheel-side wall ⇒
inboard weld*, so the barrel has true material thickness. A tool can draw this polyline, let an artist drag the knots,
and feed it straight back in through `SectionKnots`. `SampleFaceContour(Parameters, r, θ)` exposes the face field in the
same spirit, for previewing a spoke pattern as a 2D image before tessellating anything.

---

## 4. Materials

Six geometry slots (`RimSurfaceSlot`) map to OpenPBR `MaterialDescriptor` slabs via the finish recipes
(`QueryFinishRecipe`): `GlossPaint` (pigment + clear coat + orange-peel haze lobe), `SatinGraphite`, `PolishedAlloy`,
`BrushedAlloy` (anisotropic), `MachinedFace` (diamond-cut: anisotropic metal under lacquer), `Chrome`,
`BronzeAnodised`, `MatteBlack` (EON diffuse roughness), `GoldAnodised`, `SteelHardware`.

| Slot | Surfaces | Default finish |
|---|---|---|
| `FaceFront` | spoke / hub tops, countersinks | `FaceFinish` |
| `WindowWall` | window bevels, plate back, bore and lug tubes | `PocketFinish` |
| `Lip` | flanges, bead seats, outer barrel | `LipFinish` |
| `BarrelBore` | wheel-side barrel wall | `PocketFinish`, darkened |
| `Hardware` | lug nuts | `HardwareFinish` |
| `CentreCap` | cap | `CapFinish` |

Two-tone wheels (machined face + gloss pockets, black face + polished lip) fall out of assigning different finishes
per slot. UVs are polar on the face (`u = θ/2π`, `v = r/R`) and arc-length cylindrical on the barrel — adequate for
trim-sheet / tri-planar detail; a dedicated unwrap is still the right move for unique bakes.

---

## 5. Running it

```bash
# level: synthesises, audits and exports Content/Scenes/WheelRim.gltf, then loads it like any other level
Projects/Project-Zero/bin/ProjectZero --scene rim --rim forged   # 26 names, see the preset table above

# harness (no Vulkan needed): every preset, topology audit, OBJ dump
g++ -std=c++20 -O2 Scratchpad/WheelRimGeneratorTest.cpp Engine/ContentInterchange/WheelRimSpecification.cpp -o /tmp/rimtest
/tmp/rimtest /tmp/rims            # add any second argument for a fast low-resolution pass
python3 Scratchpad/RimPreviewRaster.py /tmp/rims/ForgedFiveSpoke.obj out.png --view=three-quarter
```

```bash
# browser tool (same generator, live materials and colour)
python3 -m http.server 8080 --bind 0.0.0.0 --directory Tools/WheelRimSketcher
```

Cost at the defaults (512 × 110 lattice): ~0.3 M triangles and ~0.6 s single-threaded per wheel. Drop
`AngularSegments` / `RadialSegments` for LODs — the topology guarantee holds at every resolution.

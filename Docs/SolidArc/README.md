# SolidArc

The standalone C++20 NURBS/B-rep modelling tool lives at
`Editor/AuthoringTools/Modelling/SolidArc`. The current bounded proof set reaches Phase 37f:
rolling-ball variable-radius corners, linear and nonlinear support-setback laws, a quadratic nonlinear-radius route,
a separate non-rolling G2 planar profile, and independent clearances on the two planar supports. Unsupported
rolling-ball G2, partial-edge, apex-fillets, freeform, and general intersection/trim cases refuse transactionally.
The latest proof is `Proofs/Phase37f_UnequalSetbackCorner.png`; run `Tools/Build/CheckSolidArc.sh` for the focused
dependency-free verification gate.

## Windows application

Download the `solidarc-application-windows-<commit>` artifact from the branch's **Windows MSVC** workflow.
Extract the complete archive and launch **SolidArc.exe**. Keep `EngineContent` and the runtime DLLs beside it.
This is the windowed editor, not the separate console/proof executable with the same basename.

- The shared outliner, viewport, inspector, Construct menu and Control Centre are live.
- The **Document commands** panel provides **Open .arc**, **Save as .arc**, **Undo**, **Redo**, and command entry.
- Select a Construct tile to add geometry, or type a command such as `sphere (0,0,1) 0.5 --name=Sphere01`.
- `Examples/Liger` contains the vehicle's native `.arc` documents. You can also pass a document path on the command line.
- The geometry viewport uses SolidArc's CPU rasterizer; the application presents it through D3D11, with WARP fallback.
  This is not a claim that the CAD viewport or the separate SDF GI renderer runs on a physical GPU.

### Build from source

In an x64 Visual Studio 2022 developer PowerShell, with Python and the Vulkan SDK installed, run from `Frontier`:

```powershell
./Tools/Build/ToolchainSequence.ps1 -Configuration Release -SetupDependencies -Parallel 2
python Tools/Build/BuildSolidArcApplication.py
```

The portable application is written to `_AgentScratch/build/SolidArc-Windows-Release` at the repository root.
The helper launches the actual GUI, captures its presented surface, exercises Construct and document save/reopen,
and resizes the window. Its logs and captures are separate from the package under
`_AgentScratch/build/solidarc-application/Presentation`.

The dependency-free `SolidArc` CMake target remains the console application. On Windows/MSVC, the separate
`SolidArcApplication` target invokes the GUI helper after the main Frontier Release build has supplied shared UI objects.

## Liger reconstruction

Open `Examples/Liger/Reconstruction/Liger_Reconstruction_Simplified.arc` after building the current sources.
Use `Liger_Main_Body_Simplified.arc` to inspect the mirrored main exterior without the interior/windshield parts.
Use `view fit` in Document commands if necessary. Use `show edges off` for shaded inspection or
`show edges on` to inspect B-rep boundaries; this changes presentation only, not geometry.
The document combines the main body with the previous **interior/windshield section**, as identified by the user.
Original source filenames are retained for traceability; the earlier cowl file is not the exterior hood.

- `Liger_Main_Body_Simplified.arc` contains the first mirrored layout simplification. Its explicit spline spans remain
  editable; reduced face count does not imply a minimal control-pole layout or Class-A continuity.
- `Liger_Reconstruction_Simplified.arc` combines it with the unchanged interior/windshield parts.
- `Liger_Main_Body_Simplified_Views.arc` is a render-command script, not a geometry document. Run it after loading the body.
- `Liger_Simplified_Four_Views.png` shows front-quarter, rear-quarter, side and top views with CAD boundaries enabled.
- `Liger_Main_Body.arc` contains the retained cubic starting skin: 1,993 sewn faces plus 24 separate junction sheets.
  Every sampled source chart is retained. The three-face source junctions are exposed as separate sheets rather
  than silently removed or welded. This is still a dense layout, not a finished Class-A surface reconstruction.
- `Liger_Reconstruction.arc` combines that body and the two previous components without repositioning them.
- `Liger_Exterior_Partial.arc` is the historical filename for the earlier interior/windshield-only assembly.

- `Liger_Front_Cowl_Consolidated.arc` contains the 30-face cubic NURBS interior component originally named cowl.
- `Liger_Roof_Glass_Frame.arc` preserves the supplied frame as 170 planar triangular CAD faces. Its source
  subdivision and solidification modifiers are disabled. This deliberately preserves faceting; it is not a smooth redesign.
- `Liger_Front_Cowl.arc` is the retained 308-face baseline for comparison and regeneration.
- The six older body files remain historical attempts, not accepted exterior reconstructions.
- Adjacent JSON files record source hashes, reference settings and geometry measurements. `.queries` maps the original
  cowl charts into the consolidated surfaces; `.triangles` retains the frame reference coordinates for verification.

The cowl retains editable control poles. Its larger surfaces use explicit knot vectors; degree-multiplicity knots
retain original chart divisions needed for conforming boundary sewing. `sew --open --knot-edges` preserves openings
and splits those boundary curves without splitting the surface faces. This is not general partial-edge Boolean sewing.
The document declares `require knot-skin`, so older applications refuse it instead of ignoring the new geometry options.
Normal `sew` behaviour is unchanged, including its historical planar-capping default.

Control-pole reduction is checked using convex-hull bounds after Bernstein subdivision. The reported reduction bound
is relative to the previous fitted cowl, not to Blender. The Blender comparison remains a sampled measurement, and
G1/G2 continuity is not certified. Frame sewing joins exact coordinate duplicates and repairs inconsistent source winding;
it does not move vertices or bridge openings. No glass infill, thickness or internal structure is generated.
Dimensions follow the supplied centimetre-to-metre extraction convention; Blender's unit setting alone does not
establish a physical scale.

### Reproduce the surfaces

Use `Liger_named.blend` and the three part NPZ files from `streamlinkinbox/Frontier`, commit
`72c69b61e70427f7351f7fc3393cd25af56591db`, under `Vehicles/Liger`. Use Python with `bpy==5.0.1`, NumPy and SciPy.
Run from the Slate repository root, replacing `/reference` with the downloaded source location:

```bash
python Frontier/Projects/Project-Drive/Tools/Liger/SubdivisionProjection.py \
  /reference/Liger_named.blend _AgentScratch/build/cowl-reference.npz
python Frontier/Projects/Project-Drive/Tools/Liger/SurfaceSolver.py \
  _AgentScratch/build/cowl-reference.npz _AgentScratch/build/Liger_Front_Cowl.arc
python Frontier/Projects/Project-Drive/Tools/Liger/PatchSequence.py \
  _AgentScratch/build/Liger_Front_Cowl.arc _AgentScratch/build/cowl-reference.npz \
  _AgentScratch/build/Liger_Front_Cowl_Consolidated.arc
python Frontier/Projects/Project-Drive/Tools/Liger/FacetProjection.py \
  /reference/Liger_named.blend /reference/mesh/Body_Roof_Glass_Frame.npz \
  _AgentScratch/build/Liger_Roof_Glass_Frame.arc \
  --cowl=_AgentScratch/build/Liger_Front_Cowl_Consolidated.arc
```

The last command also writes `Liger_Exterior_Partial.arc`. Neither extractor modifies the original Blender file.

Reconstruct the main body and combine the supplied components:

```bash
python Frontier/Projects/Project-Drive/Tools/Liger/BodyProjection.py \
  /reference/Liger_named.blend /reference/mesh/Body_Main_Shell.npz _AgentScratch/build/main-reference.npz
python Frontier/Projects/Project-Drive/Tools/Liger/BodySolver.py \
  _AgentScratch/build/main-reference.npz _AgentScratch/build/Liger_Main_Body.arc
python Frontier/Projects/Project-Drive/Tools/Liger/AssemblySequence.py \
  _AgentScratch/build/Liger_Reconstruction.arc _AgentScratch/build/Liger_Main_Body.arc \
  _AgentScratch/build/Liger_Front_Cowl_Consolidated.arc _AgentScratch/build/Liger_Roof_Glass_Frame.arc
```

The body extractor performs subdivision once from the original mirrored controls; it does not restart
semi-sharp crease propagation. Original evaluated vertices must match the supplied NPZ exactly.
Two quads have alternate triangulation diagonals in this Blender evaluation; their oriented boundaries are
checked and their plane departures recorded. The fitted reference is the sampled subdivision surface,
not an exact reproduction of triangle interiors in that NPZ.
Keep the large reference NPZ, intermediate `.fit.npz` and binary sample files in scratch, not in content.
The subdivision extractor checks agreement with the original evaluated cowl; the frame extractor requires exact
agreement with the supplied positions and oriented triangle indices. `PatchVerification.py` exercises the reduction
bounds and chart transformations independently of Blender.

### Colour-coded feature curves

Open `Examples/Liger/Reconstruction/Liger_Feature_Aligned.arc` for the body-feature and paired-arch targets.
This document requires `feature-curves`; older applications refuse it rather than silently losing the annotations.
Red cubic curves follow measured, tangent-continuous native body-edge chains, not the user's drawn coordinates.
The shorter inner rail ends at its existing junction; it does not invent a detour across other patch edges.
Orange selections are retained from the earlier review. Cyan marks inner arch targets; blue marks outer arch targets.
Each arch target has an analytic circular crown and two quintic lower transitions. The transitions match the crown's
position, tangent and curvature, then tend to zero curvature at their lower ends. These are side-elevation targets,
placed just outboard for inspection, not contours already substituted into the body surfaces.

The original body surfaces are unchanged. Curve-continuity checks are not body-surface G1/G2 certification.
Local surface fairing and integration of the arch targets remain unfinished. `Liger_Feature_Review.arc` is the earlier,
superseded guide interpretation retained for comparison; use the aligned document for subsequent work.

In the windowed **Document commands** panel, choose **Feature purpose**, then **Apply to curves**. To trace existing
geometry, select edges on one body, choose Design or Repair, and use **Copy picked edges**. These are independent editable
curve copies, not live references that follow later body edits. Show/Hide features is independent of ordinary CAD edges.

The same operations are available through native commands:

```text
feature design MyRail
feature repair selected
feature-copy Body01 design --edges=0,1,2 --name=Shoulder
arc (0,0,0) 0.45 20 140 --name=OpeningCrown
feature circular OpeningCrown
tint MyRail 1 0.16 0.22
show features on
show edges off
```

Purposes and colours participate in undo/redo and native save/reopen. A circular purpose requires an analytic arc/circle
at assignment; tagging a freeform approximation is refused. A colour is not a continuing geometry certificate after
control-point edits. Feature curves do not create automatic sketch fills, but remain available as explicit geometry inputs.

Run `FeatureVerification` for native authoring, refusal, persistence, circular-radius and rendered-colour checks.
For the Liger reference processing, use the console verifier to export native edge samples and tessellation into scratch:

```powershell
$Liger = "Frontier/Projects/Project-Drive/Content/Vehicles/Liger/Reconstruction"
FeatureVerification.exe "$Liger/Liger_Main_Body_Simplified.arc" _AgentScratch/build/Edges.json
python Frontier/Projects/Project-Drive/Tools/Liger/ContourSequence.py `
  "$Liger/Liger_Main_Body_Simplified.arc" _AgentScratch/build/Edges.json `
  "$Liger/Liger_Feature_Review.features.json" _AgentScratch/build/Liger_Feature_Aligned.arc
FeatureVerification.exe _AgentScratch/build/Liger_Feature_Aligned.arc _AgentScratch/build/AlignedEdges.json --roundtrip
python Frontier/Projects/Project-Drive/Tools/Liger/ContourVerification.py
python Frontier/Projects/Project-Drive/Tools/Liger/ContourMetrics.py `
  "$Liger/Liger_Main_Body_Simplified.arc" _AgentScratch/build/Edges.json _AgentScratch/build/AlignedEdges.json `
  _AgentScratch/build/Liger_Feature_Aligned.arc _AgentScratch/build/Liger_Feature_Aligned.native.json
SolidArc.exe --proofs _AgentScratch/build/AlignedViews `
  _AgentScratch/build/Liger_Feature_Aligned.arc "$Liger/Liger_Aligned_Views.arc"
```

The exporter also writes `.triangles.f64` and, with `--roundtrip`, `.guides.json` files. Keep these temporary files out of
Content. The Python tools require NumPy and SciPy. The curve fitter uses uniform arclength samples and checks held-out
samples; it does not provide a continuous fit-error certificate. The native verifier separately checks the eight circle
radii, sixteen crown-to-fade joins, mirrored curves and save/reopen persistence. The metric tool checks native guide
samples against the selected source chains and confirms that this reference-authoring pass did not alter the body.

### First orange-area surface repair (roof junction)

Open `Liger_Roof_Repair.arc` for the first **actual skin repair**. The accepted
`Liger_Feature_Aligned.arc` remains the unchanged reference. This is a bounded first pass,
not completion of the orange areas or integration of the arch targets.

- Replaces the fan around X≈0.10 m, Y≈±0.36 m, Z≈1.135 m, plus its supporting patch cluster.
  Four regular tensor surfaces per side replace the fan layout. Three surrounding source patches
  per side are exactly restricted; their retained portions are not refitted.
- Sewn faces decrease from **1,094 to 1,074**. All 1,060 unaffected whole body surfaces and the
  24 independent junction sheets retain their original coefficients.
- The red rails, eight circular crowns, sixteen fades and all approved orange curves are retained.
  Thirty obsolete orange copies inside the completed region are hidden, not deleted, to avoid
  drawing the old fan on top of its replacement. The rest of the orange selections remain visible.
- Sampled height change is **0.371 mm maximum / 0.049 mm area-weighted RMS**. The exact source
  perimeter is retained to numerical precision. Sampled rim-normal RMS improves from 0.894° to
  0.148°, but the locked source-rim corner mismatch remains about **1.602°**. Interior knot-normal
  jumps reach 1.517° near that rim and 0.136° excluding the outer five percent of the parameter
  domain. These are sampled diagnostics, **not G1/G2 or Class-A certificates**; rim blending still
  needs refinement. Full values and scope are in `Liger_Roof_Repair.repair.json`.
- Native topology: **732 open edges (unchanged), zero nonmanifold/misoriented edges, one hull**.
  No caps, thickness, overlapping replacement ribbons or manufactured-solid claim.

`Liger_Roof_Before_After.png` shows original/new front-quarter, rear-quarter, side and top.
`Liger_Roof_Closeup_Comparison.png` makes the fan replacement visible. Separate
`Liger_Roof_{Original,New}_Four_Views.png` boards and unlabelled individual PNGs are supplied
for drawing corrections. Feature overlays are hidden equally in these renders; real CAD edges
remain visible. The renderer copies the camera directly between documents, not a visual approximation.

The kernel now supports opt-in `sew --split-junctions`: it reconciles coincident boundary segments
with unequal endpoint layouts, without changing surface coefficients or introducing faces. Native
journals require `boundary-splits`, so an older executable refuses instead of silently opening a
cracked replacement. Ordinary `sew` behaviour is unchanged.

Reproduce using NumPy/SciPy and Pillow (keep the large native exports in scratch):

```powershell
$Liger = "Frontier/Projects/Project-Drive/Content/Vehicles/Liger/Reconstruction"
FeatureVerification.exe "$Liger/Liger_Feature_Aligned.arc" _AgentScratch/build/roof-source.json
python Frontier/Projects/Project-Drive/Tools/Liger/RoofSequence.py _AgentScratch/build/roof-source.json
python Frontier/Projects/Project-Drive/Tools/Liger/RoofVerification.py
RoofRepairVerification.exe "$Liger/Liger_Feature_Aligned.arc" "$Liger/Liger_Roof_Repair.arc" _AgentScratch/build/roof-renders
python Frontier/Projects/Project-Drive/Tools/Liger/RoofProjection.py _AgentScratch/build/roof-renders $Liger --font C:/Windows/Fonts/arial.ttf
```

Omit the render-directory argument to run the native topology, unchanged-source, mirror, guide,
loop-order and save/reopen checks only. CTest, the Linux gate and the MSVC gate include this test.

### Reproduce the mirrored layout and four views

This route uses the committed first skin and its `.queries` file; it does not need Blender. Install NumPy and SciPy.
Run from the repository root. The render command below uses the **console/proof** `SolidArc.exe`, not the GUI executable:

```powershell
$Liger = "Frontier/Projects/Project-Drive/Content/Vehicles/Liger/Reconstruction"
python Frontier/Projects/Project-Drive/Tools/Liger/MirrorSequence.py `
  "$Liger/Liger_Main_Body.arc" _AgentScratch/build/Liger_Main_Body_Simplified.arc
SolidArc.exe --proofs _AgentScratch/build/LigerViews `
  _AgentScratch/build/Liger_Main_Body_Simplified.arc "$Liger/Liger_Main_Body_Simplified_Views.arc"
python Frontier/Projects/Project-Drive/Tools/Liger/MirrorVerification.py
```

`MirrorSequence.py` restricts the prior splines back to source-chart rectangles, consolidates one half and reflects it.
`--chart-limit` and `--pole-limit` bound each combined patch; the defaults are 128 charts and 4,096 control poles.
The join check samples every polynomial span along each shared rim. The 24 source-junction sheets are kept separate.
The `.simplification.json` records paired surface indices, hashes and the coefficient-bound reflection change relative
to the previous CAD skin. This is not a new continuous bound against the Blender source.

For an independent native audit, run `BodyVerification` on both the old and simplified documents, with their respective
`.queries`, and retain the two `.f64` outputs. After checking the simplified document, retain its native `BodyMetrics.json`.
Then run:

```powershell
python Frontier/Projects/Project-Drive/Tools/Liger/MirrorMetrics.py `
  _AgentScratch/build/prior-native.f64 _AgentScratch/build/simplified-native.f64 `
  "$Liger/Liger_Main_Body_Simplified.arc" _AgentScratch/build/BodyMetrics.json `
  _AgentScratch/build/mirror-native.json
```

The audit checks every serialized mirror pair, native position changes, sampled rims and orientation, and sewn topology.
Keep binary samples and raw execution logs in scratch. The four-view script writes four independent native PNGs and an
unlabelled 2-by-2 overview; the published overview adds labels without changing the individual rendered images.

### Verify native geometry

The MSVC check, CMake/CTest targets and Linux focused gate include document, cowl, frame and main-body verification.
`CowlVerification` accepts an optional binary output and chart-transform file for independent comparison:

```powershell
CowlVerification.exe _AgentScratch/build/Liger_Front_Cowl_Consolidated.arc `
  _AgentScratch/build/cowl-native.f64 _AgentScratch/build/Liger_Front_Cowl_Consolidated.queries
python Frontier/Projects/Project-Drive/Tools/Liger/SurfaceMetrics.py `
  _AgentScratch/build/cowl-reference.npz _AgentScratch/build/cowl-native.f64 `
  _AgentScratch/build/Liger_Front_Cowl_Consolidated.arc /reference/mesh/Body_Front_Cowl.npz `
  _AgentScratch/build/cowl-native.json `
  --consolidation=_AgentScratch/build/Liger_Front_Cowl_Consolidated.consolidation.json
FacetVerification.exe _AgentScratch/build/Liger_Roof_Glass_Frame.arc `
  _AgentScratch/build/Liger_Roof_Glass_Frame.triangles _AgentScratch/build/Liger_Exterior_Partial.arc
```

For the main body, use the separate native checker and metric calculation:

```powershell
BodyVerification.exe _AgentScratch/build/Liger_Main_Body.arc `
  _AgentScratch/build/Liger_Main_Body.queries _AgentScratch/build/main-native.f64 `
  _AgentScratch/build/Liger_Reconstruction.arc
python Frontier/Projects/Project-Drive/Tools/Liger/BodyMetrics.py `
  _AgentScratch/build/main-reference.npz _AgentScratch/build/main-native.f64 `
  _AgentScratch/build/Liger_Main_Body.arc _AgentScratch/build/Liger_Main_Body.fit.npz `
  _AgentScratch/build/Liger_Main_Body.native.json
```

The body binary uses 17 by 17 samples per original chart. Its checks cover the serialized native surfaces,
consolidation, shared rims and sampled orientation, including junction sheets. They do not certify continuous
Hausdorff distance or G1/G2 continuity. Validation samples are excluded from coefficient fitting but used
for adaptive pole-count selection and acceptance; they are not a blind evaluation set. The document checker also
covers the geometry-payload budget for undo:
small documents retain up to 200 snapshots; large documents discard older snapshots above 64 MiB of retained
numerical payload, keeping at least the newest snapshot. This is not a bound on total process memory.

The cowl temporary binary contains little-endian float64 XYZ positions, ordered by original chart, then U, then V,
at 33 by 33 parameters per chart. It is measurement output, not CAD interchange content.
The application build also opens the combined reconstruction in the windowed editor and checks presentation, Construct,
save/reopen and resize. Captures are under `Presentation/Liger` in the application evidence artifact.

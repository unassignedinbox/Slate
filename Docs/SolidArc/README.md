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

Open `Examples/Liger/Reconstruction/Liger_Reconstruction.arc` after building the current sources.
Use `view fit` in Document commands if necessary. Use `show edges off` for shaded inspection or
`show edges on` to inspect B-rep boundaries; this changes presentation only, not geometry.
The document combines the main body with the previous **interior/windshield section**, as identified by the user.
Original source filenames are retained for traceability; the earlier cowl file is not the exterior hood.

- `Liger_Main_Body.arc` contains the editable cubic starting skin: 1,993 sewn faces plus 24 separate junction sheets.
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

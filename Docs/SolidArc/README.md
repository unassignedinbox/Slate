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

## Liger cowl checkpoint

Open `Examples/Liger/Reconstruction/Liger_Front_Cowl.arc` with a build that supports `sew --open`.
In the source checkout it is under `Frontier/Projects/Project-Drive/Content/Vehicles/Liger/Reconstruction`.
Use `view fit` in Document commands if the component is outside the current view.
The `.arc` retains cubic NURBS control poles and a sewn, open B-rep; it is not a triangle import.
`sew --open` preserves intentional openings. Plain `sew` retains its existing planar-capping behaviour.
The document declares `require open-sew`, so older executables refuse it rather than silently adding caps.

This is only the front cowl, with 308 patches still requiring consolidation and continuity review.
It is not the complete exterior or a manufacturing solid. The main body and roof/glass frame remain unfinished.
The six older `.arc` files remain available as historical attempts, not accepted reconstructions.
Adjacent `.metrics.json` and `.native.json` files contain the fitting and actual-kernel sampled comparisons.
Dimensions follow the supplied extraction convention of centimetres converted to metres; the Blender scene's unit
setting alone does not prove a physical scale.

### Reproduce the cowl checks

Use the original `Liger_named.blend` and `mesh/Body_Front_Cowl.npz` from
`streamlinkinbox/Frontier`, commit `72c69b61e70427f7351f7fc3393cd25af56591db`, under `Vehicles/Liger`.
Do not use the old fitted surfaces as the reference. With Python, `bpy==5.0.1`, NumPy and SciPy installed,
run from the Slate repository root (replace the two `/reference` paths):

```bash
python Frontier/Projects/Project-Drive/Tools/Liger/SubdivisionProjection.py \
  /reference/Liger_named.blend _AgentScratch/build/cowl-reference.npz
python Frontier/Projects/Project-Drive/Tools/Liger/SurfaceSolver.py \
  _AgentScratch/build/cowl-reference.npz _AgentScratch/build/Liger_Front_Cowl.arc
```

The extractor preserves the source mirror, sharp creases, corner smoothing and subdivision quality, then checks its
samples against the original evaluated geometry. The solver fixes shared rims and holds out alternate sample rows
and columns. It refuses inverted samples or a sampled positional error above 1 mm; this is not a continuous bound.
Neither script modifies the original Blender file.

The Windows MSVC check builds `CowlVerification.exe` and runs native topology, save/reopen and rendering checks.
For the independent numerical comparison, run that executable with an additional output path:

```powershell
CowlVerification.exe _AgentScratch/build/Liger_Front_Cowl.arc _AgentScratch/build/cowl-native.f64
python Frontier/Projects/Project-Drive/Tools/Liger/SurfaceMetrics.py `
  _AgentScratch/build/cowl-reference.npz _AgentScratch/build/cowl-native.f64 `
  _AgentScratch/build/Liger_Front_Cowl.arc /reference/mesh/Body_Front_Cowl.npz `
  _AgentScratch/build/cowl-native.json
```

The temporary binary contains actual kernel samples as little-endian float64 XYZ coordinates, ordered by face,
then U, then V, at 33 by 33 parameters per face. It is measurement output, not a CAD interchange format.
The application build also launches the windowed editor with the cowl, captures its presentation and checks
Construct, save/reopen and resize. Application captures are under `Presentation/Cowl` in the evidence artifact.

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

# Frontier

## SolidArc

The standalone C++20 NURBS/B-rep modelling tool lives at
`Editor/AuthoringTools/Modelling/SolidArc`. The current bounded proof set reaches Phase 37f:
rolling-ball variable-radius corners, linear and nonlinear support-setback laws, a quadratic nonlinear-radius route,
a separate non-rolling G2 planar profile, and independent clearances on the two planar supports. Unsupported
rolling-ball G2, partial-edge, apex-fillets, freeform, and general intersection/trim cases refuse transactionally.
The latest proof is `Proofs/Phase37f_UnequalSetbackCorner.png`; run `Tools/Build/CheckSolidArc.sh` for the focused
dependency-free verification gate.

## SolidArc editor shell

The tool now carries a proper windowed editor, mirroring the Frontier editor's architecture: an **Outliner** window, a
**blank Viewport**, and an **Inspector** window docked into one host, plus the console strip.

| Piece                    | Where                                                        |
|--------------------------|--------------------------------------------------------------|
| Editor panels            | `Engine/Editor/` and `Engine/DisplayPresentation/`            |
| SolidArc host + interchange | `Editor/AuthoringTools/Modelling/SolidArc/Editor/`          |
| Windowed GLFW entry      | `Editor/AuthoringTools/Modelling/SolidArc/Editor/SolidArcWindowHost.cpp` |
| Headless CPU proof       | `Editor/AuthoringTools/Modelling/SolidArc/Verification/EditorDockingVerification.cpp` |
| Proof sheets             | `VisualProof/SolidArcEditor/`                                 |

The dependencies are the engine's own vendored pair, seated by `Tools/Build/Bootstrap.py` from
`Tools/Build/Dependencies.lock.json`: imgui `3bae66c7` (1.93.0-docking) and glfw `7b6aead9`, both sha256-verified.
`Tools/Build/ApplyImGuiPatches.py` seats the five trapezoidal patches (A–E) **verbatim** from the engine.

### Building

```powershell
# seat the dependencies once (network required)
python3 Tools/Build/Bootstrap.py

# the full workbench — windowed editor, headless proof, console tool
cmake -S . -B build-solidarc
cmake --build build-solidarc --target SolidArcEditor
ctest --test-dir build-solidarc

# the console tool alone, dependency-free, unchanged
cmake -S Editor/AuthoringTools/Modelling/SolidArc -B build-solidarc-console
```

### The gate

`Tools/Build/CheckSolidArcEditor.sh` — bootstrap, patch verify, compile the tool core, compile and link the editor,
compile the windowed host against the pinned GLFW, then run the headless proof through the real patched ImGui.
27 checks, 0 failures on the last run; five sheets in `VisualProof/SolidArcEditor/` with `Provenance.json`.

Run `Tools/Build/CheckSolidArc.sh` for the focused dependency-free verification gate.

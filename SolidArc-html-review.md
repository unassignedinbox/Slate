# SolidArc HTML-side review and fix plan

Target reviewed: `SultanAladin/Frontier-` branch `arena/01a08c57-frontier`.

This Slate branch now carries a runnable mirror of the SolidArc HTML prototype at:

- `Editor/EditorTools/ParametricSketcher/Panel/index.html`
- `docs/solidarc/index.html`

Only the HTML/JavaScript prototype side was changed. No C++ kernel work was touched.

## Main mistakes found

1. **Sketch primitives lost B-rep identity.**
   Sketch extrusions rebuilt a closed line/arc sketch from sampled points. Tangent line/arc loops could collapse into one synthetic edge id, so selecting a single top/bottom edge could affect much more of the loop than intended.

2. **Only UI-created extrudes consistently used B-rep.**
   Demo/seed and command-line `extrude Sketch 12` could fall back to the legacy `extrudeMesh()` path, which has no `mesh.brep`; those bodies could not support the CAD-style face/edge edit pipeline.

3. **Edge fillet/chamfer radii were grouped by the newest edit.**
   `bandSpec()` used the last edit's radius/type for all selected cap edges of the same band. If edge A was filleted at 2 mm and edge B later at 6 mm, A got rebuilt at/with the later operation's band behavior instead of preserving its own offset.

4. **B-rep boundary keys for chamfer/fillet transitions were muddled.**
   Chamfer transition edges reused the `ftop/fbot` key shape. That made topology harder to reason about and increased the risk of hitting derived/tangent boundary edges as if they were source edges.

## Fixes committed here

- Added `sketchControlLoops(sk)` so sketch profiles keep original line/polyline/arc/circle control edges and stable source-based ids such as `top:c42.0`.
- Kept a fallback to the existing region arrangement for complex overlapping/overridden sketch regions.
- Changed all valid extrudes to build through `solidBuild()` when a B-rep profile is available, including seed/demo and command-line sketch extrudes.
- Reworked cap-edge `bandSpec()` so each source edge stores its own radius/type while sharing a watertight cap z-schedule.
- Corrected transition edge keys to `ftop/fbot` for fillets and `ctop/cbot` for chamfers.
- Extended the smoke suite with regression checks for:
  - tangent line/arc sketch primitive ids staying separate,
  - single-edge fillet not becoming `top:all`,
  - sequential different-radius edge edits not re-beveling older edges,
  - command-line sketch extrudes producing B-rep selectable primitive edges.

## Validation run

```bash
node Editor/EditorTools/ParametricSketcher/Panel/Verification/smoke.js
# smoke: 420 checks OK · 52 figures
```

## Test locally

```bash
cd Editor/EditorTools/ParametricSketcher/Panel
python3 -m http.server 8080 --bind 0.0.0.0
```

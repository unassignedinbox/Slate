# SolidArc — HTML-kernel fixes (Slate branch)

Working copy of the SolidArc CAD prototype
(`Editor/EditorTools/ParametricSketcher/Panel/index.html` on the Frontier branch)
with the bevel / B-rep / sketch-profile fixes applied. C++ kernel work is
explicitly out of scope here; this directory is the HTML-only stage.

Run the suite: `cd SolidArc && node Verification/smoke.js`
(450 checks OK · 48 figures at time of writing).
Offline renders: `node Verification/render.js [fillet|mix|push|…] [matcap|plastic|flat]`.

## Stage 1 — per-edge bevels (P0)

**Problem.** Filleting/chamfering one edge re-bevelled the whole loop, clobbered
neighbouring edges' radii, and mixed fillet+chamfer on one loop destroyed bands.

**Fix (`index.html`).**
- `bandSpec` is now `{all, per}`: every edge keeps its own `{type, r}`.
  Explicit edge edits override `:all` (whole-loop) edits; last edit per key wins.
- Bevel chain is per-sub `{W, RR, TT}` (width / radius / type per sub-segment).
- Rings: shared-z/exact-d rings with per-distinct-r starts, sine levels only when
  a fillet exists. A uniform chamfer keeps the original exact 45° slope; mixed
  type/radius loops get exact per-edge boundaries. Normals stay radial.
- Per-sub band loop / tilt / boundaries; per-sub cap-edge tangent flags.
- Selection: tangent `top:`/`bot:` edges are re-editable targets (drag starts from
  the existing radius via `solidCurrentR`); true joints (`ftop:`/`ctop:`…`~`)
  stay ignored. Clicking a fillet/chamfer band selects its base edge.
- Inspector: inline radius input + fillet/chamfer type toggle per edge edit.
- New `Verification/smoke.js` §31: two radii on one loop, mixed types, re-edit
  isolation, band-face → base-edge mapping, `:all` + explicit override (21 checks).

**Verified.** Former Test B (`top:1` r3 + `top:2` r8 → `[27,30]` + `[22,30]`) and
Test D (fillet + chamfer coexist, watertight) now pass; §28 normal audit stays
green (the twisted-blend failure mode is gone by construction).

## Stage 2 — one B-rep kernel

**Problem.** Three parallel solid paths: analytic `solidBuild` (curve-profile
extrudes only), faceted `extrudeMesh` (sketch extrudes, caps ignored holes),
faceted `boxMesh`/`cylMesh` (no topology: no fillets, no face features, no
sub-element selection on primitives).

**Fix.**
- New `solidFromLoops(loops, params, edits)` core; `box`, `cylinder` and all
  `extrude` bodies build through it (`rectLoops` / `circleLoops` synthetic
  profiles). Cylinder `segs` still controls tessellation (`arcSegs`).
- New `baseMesh(f)` (prism without face features) backs `build`,
  `bodyMeshWith` and `solidPreviewMesh`, so previews and push/inset features
  work on primitives too.
- `faceMovePlan` extends to primitives: pushing a box/cylinder cap edits `h`
  parametrically instead of spawning a feature.
- `measure` stays analytic for pristine primitives, switches to tessellated
  volume + B-rep rows once edited; all extrudes with a B-rep report B-rep rows.
- `sketchProfile` now prefers filled regions from closed loops for any mix of
  curves; the legacy sequential lines+arcs path is kept only when the opens
  chain into a closed loop (stadium-style, incl. the `?demo` seed).
- `earClip`: sanitises duplicate points, strict in-triangle test (bridged hole
  vertices sit on ear edges and must not block ears). `profileSegs` drops
  consecutive duplicate control points so wall rings match cap boundaries.
- New `Verification/smoke.js` §32: box/cylinder B-rep counts, fillets on
  primitives, cap-push edits `h`, sketch-extrude B-rep + watertight + chamfer
  (15 checks).

**Verified.** `?demo` seed: stadium-with-hole extrude went from 114 open edges
(legacy path) to 0; box is F6/E12/V8, cylinder F3/E2/V0; nested rect+hole
sketch extrudes watertight with volume within 0.03% of analytic.

## Known limitations (C++ kernel scope)

- `subtract` is still a faceted placeholder, not a real boolean; overlapping
  multi-region sketch extrudes keep internal coincident walls (no union).
- `earClipHoles` uses simple bridging: holes near deep concavities can produce
  a crossing bridge. Convex-ish profiles (all shipped cases) are exact.
- Body `loft` / `plane` / surface tools are unchanged faceted paths.
- `extrudeMesh` is superseded but kept (exported, used by nothing in `build`).

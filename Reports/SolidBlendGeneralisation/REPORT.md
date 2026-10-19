# Solid bevel, chamfer and fillet: why the current approach cannot scale, and how to make it general

## 1. TL;DR

- **The SolidArc blend kernel is a dispatch table.** `BlendSolver.cpp` is 13,762 lines with 2,085 `if` statements,
  38 `Reconstruct*` routes and 37 distinct `Classify*` names. Each new shape adds a route and a gate.
- **Chamfering all 12 edges of a box is refused.** Filleting them works, because fillet has a dedicated box route.
- **It accepts invalid solids as success.** On an L-shaped body, 24 chamfers were accepted with χ = 0 and genus 1,
  where the source is χ = 2 and genus 0. The fillets on the same body are all valid.
- **It has no time bound.** Native-only, 3 fillet and 3 chamfer trials on the sphere-corner body hit the 60-second
  watchdog. The native host has no cancellation, so the watchdog has to kill it.
- **Coverage is low.** Across 13 built bodies and 160 edges, native-only gives 48 valid fillets (30 %) and 26 valid
  chamfers (16 %). Enabling the optional OCCT worker raises this to 65 (41 %) and 44 (28 %).
- **Recommendation.** Stop adding routes. Put every blend behind one facade, backed by OCCT now (Linux only today,
  Windows build needed). Build a generic B-rep blend (profile sweep plus corner solve, validated transactionally)
  as the long-term owner, with analytic routes only as checked fast paths. Section 7 has the options table.

## 2. What is running

| Application | Source | Address | Status |
|---|---|---|---|
| Frontier Editor (Fracture) | `Frontier-` `Experimental/VehicleHmiPrototype/index.html` | port 8080 | Running. `npm test` 31/31 pass. |
| SolidArc browser editor | `Frontier-` `Experimental/SolidArc` (Vite) | port 5176 | Running. `/native/health` answers through the proxy. |
| SolidArc native geometry service | same, `GeometryHost` | port 8081 | Running. Built with `npm run build:native`. |

**Not verified visually.** No browser is installed in this sandbox, so I could not take screenshots or run the
browser test suites. Open the preview links to check the rendering. The Fracture editor needs a WebGPU-capable browser.

## 3. Method

Probe: `tools/edge_matrix.py` (with the watchdog client `tools/nh.py`). For each body it rebuilds the solid, then
fillets (r = 0.3 m) or chamfers (setback 0.3 m) **one edge at a time**. Each result is one of:

- **accepted & valid**: closed, manifold, oriented, and χ and genus equal to the source body's.
- **accepted but invalid**: the kernel said yes, but the result fails one of those checks.
- **refused**: the kernel returned a typed refusal (reason recorded).
- **timeout**: no reply within 60 s; host killed and restarted.

Closed-form checks (`tools/closed_form_checks.py`) are on a 4 × 4 × 4 m box, with independent volume formulas.

Two runs, same body set, same probe, only the environment differs:

- **Run A, native only**: `SOLIDARC_OCCT_BLEND_HOST` unset. Output `results/run_occt_off.json`.
- **Run B, OCCT enabled**: `SOLIDARC_OCCT_BLEND_HOST` set to the built worker. Output `results/run_occt_on.json`.

## 4. Results

### 4.1 Totals (13 bodies, 160 edges, each op)

| Run | Fillet valid | Fillet invalid | Fillet refused | Fillet timeout | Chamfer valid | Chamfer invalid | Chamfer refused | Chamfer timeout |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A, native only | 48 | 0 | 109 | 3 | 26 | 24 | 107 | 3 |
| B, OCCT enabled | 65 | 0 | 95 | 0 | 44 | 24 | 92 | 0 |

The 24 chamfer "invalid" results are all on `L_union_boxes` and are the same in both runs, because that body has no
sphere face, so OCCT is not used for it.

### 4.2 Per body (run A, native only; per-body OCCT detail in `results/EdgeMatrix_OcctEnabled.md`)

| Body | Edges | Fillet valid | Fillet refused | Fillet TO | Chamfer valid | Chamfer invalid | Chamfer refused | Chamfer TO | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| box | 12 | 12 | 0 | 0 | 12 | 0 | 0 | 0 | 3.8 |
| cylinder | 3 | 2 | 1 | 0 | 2 | 0 | 1 | 0 | 0.5 |
| cone_frustum | 3 | 0 | 3 | 0 | 2 | 0 | 1 | 0 | 0.3 |
| sphere | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0.6 |
| torus | 2 | 0 | 2 | 0 | 0 | 0 | 2 | 0 | 2.2 |
| box_minus_cyl_hole (genus 1) | 15 | 0 | 15 | 0 | 0 | 0 | 15 | 0 | 71.0 |
| box_plus_cyl_boss | 15 | 0 | 15 | 0 | 0 | 0 | 15 | 0 | 79.1 |
| L_union_boxes | 52 | 32 | 20 | 0 | 8 | **24** | 20 | 0 | 128.7 |
| sphere_minus_box_corner | 7 | 0 | 4 | **3** | 0 | 0 | 4 | **3** | 386.1 |
| box_minus_sphere_pocket | 14 | 0 | 14 | 0 | 0 | 0 | 14 | 0 | **1146.0** |
| cylinder_cross_bore, equal radii | – | – | – | – | – | – | – | – | Boolean refused (not built) |
| cylinder_cross_bore, r = 0.7 | 9 | 0 | 9 | 0 | 0 | 0 | 9 | 0 | 4.9 |
| box_intersect_cylinder | 24 | 0 | 24 | 0 | 0 | 0 | 24 | 0 | 71.6 |
| tilted_cylinder | 3 | 2 | 1 | 0 | 2 | 0 | 1 | 0 | 0.5 |

Where OCCT changes the picture (run B): `sphere_minus_box_corner` fillet 0 → 5 valid, chamfer 0 → 5 valid, no timeouts
(46 s total); `box_minus_sphere_pocket` fillet 0 → 12 valid, chamfer 0 → 13 valid, time 1146 s → 50 s. The plain
`sphere` body (one seam edge) does not change, and the other bodies have no sphere face, so OCCT is not used on them.

### 4.3 Refusal reasons (run B)

| Count | Message (abridged) | What it means |
|---:|---|---|
| 56 | chamfer: selected edge requires two adjacent planar faces | Chamfer needs both neighbouring faces to be planar. Other edges are refused. |
| 32 | fillet: no cutter placement reached the exact **chamfer** tolerance | Real cause: the fillet calls the chamfer routine as its first step, and the chamfer's message leaks out. See 4.4. |
| 32 | chamfer: no cutter placement reached the exact chamfer tolerance | Chamfer cannot place its cutter exactly. |
| 20 | fillet: faces tangent or folded at this edge (no corner to blend) | Expected for smooth edges. |
| 11 | fillet: edge is degenerate (zero length) | Input problem, correctly refused. |
| 11 | fillet: edge is not straight (curved-edge blend not supported) | Missing capability: general curved-edge fillets. |
| 8 | fillet: blend requires both adjacent faces to be planar | Missing capability for curved faces. |
| 8 | fillet: edge has invalid adjacent faces | Missing capability or bad input. |
| 9 | OCCT worker: 4 no suitable edges, 2 unique-import match, 2 trim endpoint error, 1 output failed validation | The OCCT route also refuses some edges. |

### 4.4 Findings

1. **Chamfer of all box edges is refused.** Single-edge chamfers on the box all pass (12/12). The all-12-edge chamfer
   is refused at every setback. The gate is `BlendSolver.cpp:5323`: a non-planar edge selection must be one closed loop.
   The 12 box edges are not, so they are refused. Fillet of the same 12 edges works.
2. **Fillet calls chamfer internally, so its refusals can carry the chamfer message.** `FilletEdge`
   (`BlendSolver.cpp:5449`) first cuts the corner back with `ChamferEdge(Body, Edge, T)` (line 5477), then rolls the
   fillet. A failure in that first step is reported with the chamfer's own message ("no cutter placement reached the
   exact chamfer tolerance", line 4949). So 32 fillet refusals name the wrong operation. This is a real architectural
   coupling, not just a typo, and it makes diagnosis misleading.
3. **Invalid results are reported as successes.** 24 chamfers on `L_union_boxes` return "accepted" with χ = 0 and
   genus 1. The source is χ = 2, genus 0. The kernel does not validate its own output before accepting it.
4. **Timeouts are unbounded.** The native host has no cancellation. On `sphere_minus_box_corner` six trials ran
   past 60 s; on `box_minus_sphere_pocket` the whole body took 1146 s. Only the external watchdog stops it.
5. **Curved faces and edges are largely unsupported.** Chamfer refuses every edge without two planar neighbours (56 in run B,
   63 in run A). Fillet refuses curved edges (11) and curved faces (8).
6. **Acceptance depends on placement and operand order.** The repository's own audit records this as GEO-009 (results
   change under translation and scale) and GEO-012 (union and intersection accept in one operand order and refuse in
   the other). A general kernel must remove that dependence.
7. **Degenerate Booleans.** Two equal-radius perpendicular bores are refused by the Boolean itself ("tangent or
   coincident faces"). Unequal radii (0.7 and 1.0) build successfully as genus 1 (correct for a through-hole), but no
   blend on that body succeeds in either run.

### 4.5 Closed-form checks (box 4 × 4 × 4 m, `results/closed_form_checks.json`)

| Case | Formula | Result |
|---|---|---|
| Single-edge chamfer, setback s = 0.1 … 3.9 (8 values, 8 accepted) | removed volume = s²/2 × L, L = 4 | Error 0.0 in all accepted cases |
| Single-edge fillet, r = 0.1 … 3.9 (8 values, 8 accepted) | removed volume = (1 − π/4) r² L | Error 1.8e-5 to 1.45e-2 (0.02 % of volume at the largest r) |
| All-12-edge fillet, r = 0.1, 0.3, 0.5, 1.0 | Steiner rounded-box volume | Accepted, valid, error 1.5e-4 to 1.2e-2 |
| All-12-edge chamfer, s = 0.1, 0.3, 0.5, 1.0 | V = a³ − 12(s²/2)(a − 2s) − 8s³/6 (62.128 at s = 0.3) | **Refused at all four** |

## 5. Why more conditions cannot fix this

The fillet dispatch in `FilletEdges` (`BlendSolver.cpp:5575`) is a chain of early returns, in this order:

```text
FilletEdges(body, seeds, r)
  1. input checks                        (valid solid, r > 0, seeds non-empty)
  2. OptionalOcctBlend                   only if SOLIDARC_OCCT_BLEND_HOST is set, Linux,
                                         and the body has a sphere face
  3. TangentChain(seed)                  group tangent-connected edges
  4. ClassifyBlindBoxPrism, ClassifySideBlindPrism, ClassifySideSteppedBlindPrism,
     ClassifySideSteppedBlindSet, ClassifySteppedBlindPrism, ClassifyDualSteppedBlindPrism,
     ClassifyPerforatedBoxPrism          prism-specific patterns
  5. ClassifyOrthogonalBoxCorner         box-corner pattern
  6. per-edge FilletEdge                 which calls ChamferEdge first to cut the corner back,
                                         then rolls the ball
```

Each classifier matches one shape, and each route has its own gate and tolerances (`BlendSolver.cpp:5323` is one example).
The 38 `Reconstruct*` routes follow the same pattern. Adding a shape adds a route. The repository's own audit says so: `BLEND_ARCHITECTURE.md` describes the catalogue as "not
general blending support" and asks for "one owning B-rep kernel for solid operations" with "general blend
construction". `GEOMETRY_GAPS.md` lists GEO-005 (general curved-edge and non-planar blends) as open.

## 6. How to bevel or chamfer any shape without per-shape conditions

**Principle.** Define each operation on an *edge set and the two surfaces next to each edge*, never on a topology name
such as "box corner" or "cone apex". The only shape-dependent inputs are numeric: surface evaluation, normals and
intersections. A new surface type then needs an evaluator, not a new route.

### 6.1 Pipeline (proposal)

| Step | Generic method | Replaces |
|---|---|---|
| 1. Classify edges | Sharp if the dihedral angle is not π. Propagate through tangent chains. Seams and periodic edges are not sharp. | Named prism and corner classifiers |
| 2. Support offsets | Offset each adjacent surface by r (fillet) or by d (chamfer). Analytic for planes, cylinders, cones and spheres; numeric for NURBS. | Per-pair formulas |
| 3. Spine | Intersect the two offset surfaces: ball-centre curve (fillet) or setback curve (chamfer). `IntersectionSolver` provides Booleans (`Combine`). Surface–surface spine solving for blends is new work. | Per-route spine construction |
| 4. Cross-section | Fillet: circular arc of radius r. Chamfer: triangle with legs d. Sweep along the spine. | Per-route cap and boss builders |
| 5. Corners | At a vertex where k ≥ 3 blended edges meet, solve for the point at distance r (or d) from all k faces, by Newton least squares. If there is no solution, refuse with a typed reason. | Corner classifiers |
| 6. Remove or rebuild | Result = body minus the swept tools, using the Boolean kernel. Corner tools are unioned first. | Per-route Boolean sequences |
| 7. Validate | One checker for every result: closed, manifold, oriented, χ and genus unchanged; sampled blend distance equals r or d within tolerance; volume matches the independent sweep integral; time budget; atomic rollback on failure. | Per-route tolerances |
| 8. Limits | Bisection on the validator to find the largest accepted radius. Report the number. | Hard-coded limits |

### 6.2 Why the validator replaces the conditions

Every shape goes through steps 1–8, including shapes nobody has written a fixture for. Failures are local and typed:
"corner solve failed at vertex V", "sweep self-intersects at edge E", "Boolean degenerate at face F". The document is
never left half-changed.

### 6.3 How to test "any shape"

Examples cannot prove generality. These oracles can:

| Oracle | Checks | Status |
|---|---|---|
| Closed forms (Steiner, prism formulas) | Volume for planar cases | Done (4.5) |
| Differential test against OCCT | Volume and topology on random solids | Not built |
| Invariance | Same result under rigid motion, uniform scale, operand order and edge order (GEO-009 and GEO-012 fail today) | Not built |
| Monotonicity | Removed volume grows with r or d; χ and genus preserved | Partly (validator) |
| Fuzzing with the validator as oracle | Random solids and radii; any accepted result must validate | Not built |

### 6.4 What stays hard

- Corners with four or more blended edges, or mixed curved supports, where no single ball touches every face.
- Boolean robustness near tangent or coincident faces (the equal-radius bore).
- Tolerances and the scale sensitivity in GEO-009.

## 7. Options

| Option | Covers general B-rep? | Exact B-rep? | Effort | Windows today | Verdict |
|---|---|---|---|---|---|
| A. Keep adding routes (status quo) | No. Each shape needs its own route. | Per route only | Grows with each case | Yes | Stop. |
| B. OCCT as the blend engine (`BRepFilletAPI_MakeFillet` and `MakeChamfer`, OCCT 7.8.1) | Largely. Industry standard. Some radii still fail. | Yes | Medium: integrate, map edges, build on Windows | **No.** The `__linux__` gate compiles it out, and the worker is set up from a Linux x86-64 `cadquery_ocp` wheel. OCCT itself is cross-platform, so this is packaging work. | Fastest route to general blends. Recommended first step. |
| C. Own generic kernel (section 6) | Yes, once complete | Yes | Very high. Boolean robustness is the main risk. | Yes (native C++) | Long-term. Start only after the oracles in 6.3 exist. |
| D. Mesh or SDF bevel (morphological opening and closing) | Any mesh | No (approximate) | Low | Yes | Good for previews and printing. The cleaner repo's `PolygonBevel` works this way already. |

**Licence.** OCCT 7.8.1 is LGPL-2.1 with the Open CASCADE exception (checked earlier this session). Linking is
permitted with the notices. `CLAUDE.md` in the cleaner repo says third-party sources go under the ignored
`ExternalPackages/` folder, pinned.

### 7.1 Recommendation

1. **Build the validator and oracles now** (6.3). The probe in `tools/` is the acceptance gate for any blend engine.
2. **Adopt option B behind one facade** (for example `SolidBlendEngine`). The UI calls only the facade. Keep an analytic
   route only where the differential test shows it agrees with the engine. Delete the rest.
3. **Make the OCCT path build on Windows** (MSVC, pinned under `ExternalPackages/`). This blocks shipping any general
   blend in the Windows-first build.
4. **Plan option C** for later, written to the naming rules in the cleaner repo (`SKILL-Naming.md` bans words such as
   `Kernel`, `Core`, `Base`, `Data`, `Info`, `Manager`, `Helper`).

## 8. Decisions needed

| Decision | Choices | Trade-off |
|---|---|---|
| Blend engine | B (OCCT) first, then C; or C directly | B: working sooner, licence notices, Windows packaging work. C: months, higher risk, no external dependency. |
| First milestone scope | All B-rep solids; or only the cases in section 4 | The first is what you asked for. The second is faster to show. |
| Home for the work | SolidArc (`Frontier-`) or the cleaner `Frontier` repo | The cleaner repo has the rules and the Windows path. SolidArc has the B-rep kernel today. |

## 9. Limits

- No screenshots and no browser test runs (no browser installed).
- One radius (0.3 m) and one setback (0.3 m) for the matrix. The radius sweep covers only the box, in closed form.
- Validity is topology plus closed-form volume for planar cases. Curved results have no independent volume oracle yet.
- OCCT was built and run on Linux only. Nothing was built or run on Windows.
- The first matrix run and the first baseline were superseded after two probe bugs were fixed: validity assumed genus 0
  (now compared with the source), and refusal reasons came from the wrong console line (now taken from the refusal
  line). All numbers in this report come from runs A and B, which use the fixed probe.
- The probe's equal-radius cross-bore row records "source not built". Its refusal reason is the Boolean message from
  section 4.4 (7), not the probe's output.

## 10. Reproduce

```sh
# Prerequisites: a Frontier- checkout with SolidArc built (npm run build:native in Experimental/SolidArc).
# Optional OCCT worker (Linux x86-64): python3 Tools/Build/BuildSolidArcOcctBlend.py
cd Reports/SolidBlendGeneralisation/tools
export SOLIDARC_ROOT=/path/to/Frontier-
python3 edge_matrix.py ../results/run_occt_off.json                                  # run A
SOLIDARC_OCCT_BLEND_HOST=$SOLIDARC_ROOT/.cache/solidarc-occt/BlendHost \
  python3 edge_matrix.py ../results/run_occt_on.json                                 # run B
python3 closed_form_checks.py ../results/closed_form_checks.json
python3 summarise.py ../results/run_occt_off.json ../results/closed_form_checks.json ../results/EdgeMatrix_NativeOnly.md
```

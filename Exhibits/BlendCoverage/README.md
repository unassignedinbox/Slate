# BlendCoverage — chamfer / fillet support and cost probe

🧩 Reproducible measurement of what SolidArc's chamfer and fillet actually support,
and what they cost. Run against `SultanAladin/Frontier-` `arena/9440f4d0-frontier`
(`33829386`), `Editor/AuthoringTools/Modelling/SolidArc`.

## Why this exists

`Kernel/BlendSolver.cpp` is 13,762 lines with 64 `Reconstruct*` and 48 `Classify*`
functions. That shape suggests broad coverage. It does not deliver it. These three
programs measure the real support matrix instead of inferring it from line counts.

## Programs

| File | Measures |
|---|---|
| `Code/Coverage.cpp` | For every 2-coedge edge of a set of canonical solids: accept / refuse, grouped by the adjacent surface pair. |
| `Code/Timing.cpp` | Wall-clock milliseconds for one chamfer, one fillet, one boolean. |
| `Code/Count.cpp` | How many candidate cutter placements the generic path evaluates per edge. Needs the instrumented copy of `BlendSolver.cpp` (see below). |

## Reproduce

```bash
Root=<path to>/Editor/AuthoringTools/Modelling/SolidArc
g++ -std=c++20 -O2 -w -I"$Root" -I"$Root/Presentation" Code/Coverage.cpp \
  "$Root/Kernel/CurveSpecification.cpp" "$Root/Kernel/SurfaceSpecification.cpp" \
  "$Root/Kernel/TopologySpecification.cpp" "$Root/Kernel/IntersectionSolver.cpp" \
  "$Root/Kernel/BlendSolver.cpp" "$Root/Kernel/CapRimBlend.cpp" "$Root/Kernel/SkinSolver.cpp" \
  "$Root/Kernel/FairPatchSolver.cpp" "$Root/Kernel/ProfileSolver.cpp" \
  "$Root/Kernel/ConstraintSolver.cpp" "$Root/Kernel/ConstraintGraph.cpp" \
  "$Root/Kernel/MirrorSolver.cpp" -o Coverage
./Coverage
```

`Count.cpp` requires an instrumented build: copy the SolidArc tree, insert
`unsigned long long SolidArcCutterTries = 0;` at file scope in `Kernel/BlendSolver.cpp`
and `++SolidArcCutterTries;` immediately above the `CornerCutter(...)` call inside
the margin ladder, then compile as above against the copy.

## Environment

- Host: Linux sandbox, `g++` (GCC), `-std=c++20 -O2`
- Blend size: 0.004 m on every probe
- `Box+Sphere(union)` and the capped `Loft` are `#if 0`'d in `Coverage.cpp`: both
  exceed a 15-minute budget because the generic path runs 161 full NURBS booleans
  per edge on those bodies. That is itself a result, recorded in `Results/`.

## Results

See `Results/coverage.log`, `Results/timing.log`, `Results/count.log`.

# Liger — topology-preserving SolidArc CAD rebuild

This is a new rebuild of the Liger exterior body. It does **not** repeat the previous
station-loft / nearest-curve approximation. It converts the vehicle's authored
Catmull–Clark subdivision cages into native SolidArc bicubic B-spline faces and
stitches those faces into oriented B-rep sheets.

## Current status

`Liger_Body_CAD.arc` is retained only as a high-fidelity NURBS/B-rep **reference conversion**. It reproduces the source shape, but its one-face-per-source-quad topology is not the intended final curve-loft CAD body.

The attempted single-envelope body skin has been withdrawn: it averaged away the Liger design and is not an acceptable deliverable.

The proper curve-driven rebuild has now started with two separate documents:

- `Liger_Body_MasterCurves.arc` — 24 selected primary styling rails, opening boundaries and transverse nose/tail sections. Incidental extracted mesh creases and silhouettes are excluded.
- `Liger_Body_PrimarySurfaces.arc` — the first 16 accepted upper-body NURBS lofts: rear deck, deck steps, rear shoulders, quarter crowns, cockpit cant rails, bonnet centre and bonnet shoulders.

Every accepted surface is lofted between named master curves. Five fitted interior rails carry compound curvature without replacing the design boundaries. This is intentionally an incomplete first surfacing increment: lower flanks, wheel-arch returns, nose closure, tail closure and continuity matching have not been claimed complete.

Proofs are `SolidArc/Liger_MasterCurves_*.png` and `SolidArc/Liger_PrimarySurface_*.png`. Both documents replay with zero refusals. The generator is `Vehicles/tools/master_surface_rebuild.py`.

## Shape-reference conversion

`Liger_Body_CAD.arc` contains the main shell, front cowl and roof/glass frame as native NURBS/B-rep geometry for deviation checks. It is not presented as the final resurfaced body.

## Why this rebuild is materially better

The earlier files described in `PRIOR_REBUILD.md` inferred large surfaces from
feature curves and nearest points. That approach lost topology, twisted the nose,
left major body areas uncovered, and produced ruled/faceted strips.

`Vehicles/tools/subd_to_solidarc.py` instead:

1. reads each original Blender control-cage quad;
2. evaluates its level-2 Catmull–Clark samples;
3. solves the tensor-product cubic interpolation system;
4. emits the resulting 4×4 control net as a native SolidArc `patch`;
5. reflects the authored half exactly about the recentered symmetry plane; and
6. sews related faces into oriented B-rep sheets.

The patch boundaries use the same four subdivision samples on both neighbouring
faces. They therefore coincide by construction, rather than merely falling within
a loose nearest-point tolerance.

Measured against held-out level-2 subdivision samples:

| Part | Native faces | RMS error | Maximum error |
|---|---:|---:|---:|
| Main shell | 4,366 | 0.054 mm | 2.142 mm |
| Front cowl | 76 | 0.362 mm | 3.988 mm |
| Roof/glass frame | 86 | 0.014 mm | 0.190 mm |

The largest residuals occur beside extraordinary/non-quad control-cage vertices.
See `Liger_Body_CAD_metrics.txt` for the generated report.

## Proof renders

The images under `SolidArc/Liger_CAD_*.png` were rendered by SolidArc from the
`.arc` document itself:

- `Liger_CAD_01_Iso.png`
- `Liger_CAD_02_RearQuarter.png`
- `Liger_CAD_03_Side.png`
- `Liger_CAD_04_Top.png`
- `Liger_CAD_05_Front.png`

The visible line network in the proofs is the actual stitched CAD face topology,
not an overlaid Blender wireframe.

## Regeneration

```bash
bash Vehicles/tools/setup_bpy.sh
LD_LIBRARY_PATH="$HOME/.bpystubs" "$HOME/.bpyenv/bin/python" \
  Vehicles/tools/subd_to_solidarc.py \
  Vehicles/Liger/Source/Liger_named.blend \
  Vehicles/Liger/Liger_Body_CAD.arc

# Replay and render with a SolidArc console build:
"$HOME/.solidarc/build/SolidArc" --proofs Vehicles/Liger/SolidArc \
  Vehicles/Liger/SolidArc/render_cad.arc
```

The source `.blend`, extracted reference surfaces, feature curves and prior panel
records are retained under `Source/` so the result remains reproducible and
measurable.

## Scope

This phase rebuilds the three exterior body parts for which extracted reference
surfaces were supplied. Wheels, tyres, lamps, aero appendages and interior parts
remain separate Blender components and are not silently approximated as body
surfaces here. They can be converted as follow-on CAD assemblies with the same
pipeline where their source topology is suitable.

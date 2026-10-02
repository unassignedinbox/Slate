# Liger — subdivision-limit to CAD exterior

This directory contains a topology-driven CAD conversion of the Liger exterior.
It does not use transverse station envelopes or reconstruct the car as a generic
single loft.

## Current exterior candidate

`Liger_Body_ExteriorPacked.arc` is the current exterior-only CAD result. The
conversion follows the standard SubD-to-NURBS strategy:

1. evaluate the authored Catmull–Clark limit surface;
2. preserve the source quad topology and openings;
3. unfold regular quad regions into rectangular parameter grids;
4. fit those grids as larger native bicubic NURBS surfaces;
5. retain small validated patches around extraordinary vertices, non-quads,
   boundaries, and regions that cannot be safely unfolded; and
6. reflect the authored half exactly about `Y=0`.

The document contains the main shell, front cowl, and roof/glass frame. It does
not include the interior, wheels, lamps, or production panel decomposition.

### Packing result

| Part | Larger packed surfaces / half | Local surfaces / half | Source faces represented by packs | Packed fit RMS | Packed max |
|---|---:|---:|---:|---:|---:|
| Main shell | 506 | 989 | 1,194 | 0.0390 mm | 0.7214 mm |
| Front cowl | 24 | 1 | 37 | 0.0001 mm | 0.0007 mm |
| Roof/glass frame | 42 | 1 | 42 | numerical zero | numerical zero |

Across both mirrored halves this reduces the exterior from 4,528 local faces in
the reference conversion to 3,126 CAD surfaces. The shell is topologically
wrapped around openings and extraordinary vertices, so it cannot become one
rectangular NURBS surface without trimming or changing the shape.

The current packed surfaces are an exterior surface set, not a claimed watertight
solid. Independently fitted pack boundaries may require edge matching before a
manufacturing B-rep can be sewn.

## High-fidelity reference

`Liger_Body_CAD.arc` is the topology-preserving unpacked reference. Each authored
quad becomes a native bicubic patch fitted to level-2 Catmull–Clark limit samples,
with local fallback patches at non-quad faces. It is retained as the shape and
deviation reference.

Reference residuals at held-out samples:

| Part | Native faces | RMS error | Maximum error |
|---|---:|---:|---:|
| Main shell | 4,366 | 0.054 mm | 2.142 mm |
| Front cowl | 76 | 0.362 mm | 3.988 mm |
| Roof/glass frame | 86 | 0.014 mm | 0.190 mm |

## Proof renders

`SolidArc/Liger_ExteriorPacked_*.png` contains five matching-view renders of the
packed exterior. `SolidArc/Liger_CAD_*.png` contains the corresponding reference
renders. Both render scripts replay with zero SolidArc refusals.

## Regeneration

```bash
bash Vehicles/tools/setup_bpy.sh
LD_LIBRARY_PATH="$HOME/.bpystubs" "$HOME/.bpyenv/bin/python" \
  Vehicles/tools/subd_to_solidarc.py \
  Vehicles/Liger/Source/Liger_named.blend \
  Vehicles/Liger/Liger_Body_CAD.arc

LD_LIBRARY_PATH="$HOME/.bpystubs" "$HOME/.bpyenv/bin/python" \
  Vehicles/tools/pack_subd_cad.py

bash Vehicles/tools/setup_env.sh
"$HOME/.solidarc/build/SolidArc" --proofs Vehicles/Liger/SolidArc \
  Vehicles/Liger/SolidArc/render_exterior_packed.arc
```

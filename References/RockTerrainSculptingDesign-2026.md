# Rock terrain sculpting — AAA authoring design

## Intent

The authoring target is an SDF terrain/rock space that can hold believable large-scale formation, structural detail and sub-centimeter surface breakup without turning the result into tiled noise. Sculpting is an edit layer on top of a geological field, not the mechanism that invents the rock's entire appearance.

### Fidelity rules

- No sampled tileable noise in the rock field.
- No hardcoded array of spheres or “boulder” blobs as the final shape.
- No universal strata, tafoni, columns or conchoidal ripples applied to every lithology.
- No high-frequency detail that is independent of water access, hardness, fabric or fracture proximity.
- Every distance modification has a finite support or a non-periodic field and is bounded for safe sphere tracing.
- Material channels describe the cause of variation: hardness, grain, bedding, fracture, salt, oxidation and debris.

## Runtime architecture

```text
RockTerrainConfiguration
        │
        ├── finite seeded geological event populations
        │      ├── fracture episodes / stress families
        │      ├── salt cavities / tafoni events
        │      └── brittle impact events
        │
        ├── RockTerrainSpace::Sample(world position)
        │      ├── parent outcrop SDF
        │      ├── lithology + deposition/cooling fabric
        │      ├── mineral cell fabric
        │      ├── joints / cooling cracks
        │      ├── water + salt + frost + wind recession
        │      └── sculpt stroke layer
        │
        ├── GPU continuous sphere tracing
        └── CPU surface extraction for collision, export and thumbnails
```

`RockTerrainSpace` is deterministic for a configuration and seed. The GPU include `Engine/Shaders/RockTerrainSdf.slang` is the live-field direction; the CPU implementation is the authoritative authoring/reference path until the render pass owns the same structured event buffers.

## Field composition

The field stores a signed distance-like scalar plus geological attributes. The scalar is negative in solid and positive in air.

```text
formation = parent outcrop
          + depositional beds OR cooling-front structure
          + mineral boundary relief
          + finite joint openings
          + lithology-specific cavity / impact events
          + coupled weathering recession
          + sculpt strokes
```

It is intentionally not a naïve `smoothUnion(spheres)`. Spheres only appear as local cross-sections of a weathering event, where the event has a face, direction, exposure, cement contrast and transport gate.

### Geological regimes

| Regime | Formation-specific detail | Excluded detail |
|---|---|---|
| Granite | coarse grain fabric, unloading sheets, joint-controlled spheroidal recession, sparse tafoni | regular bedding, basalt columns, generic conchoidal ripples |
| Sandstone | variable bedding/cross-bedding, cement contrast, porosity, water/salt cavities, friable debris | volcanic columns |
| Basalt | cooling-front jittered Voronoi columns, depth-varying joints, entablature-like irregularity, occasional brittle chips | granite onion shells as the dominant form |
| Chert | fine silica fabric, hard shell-like impact/conchoidal cuts, sharp fracture energy | tafoni by default |
| Schist | anisotropic foliation and weak platy break-up, sheared fracture families | round granite weathering as a global layer |

## Sculpt layer

Strokes are recorded as operations rather than destructively baking into a texture:

- **Add Mass:** SDF union with a finite brush field.
- **Remove Mass:** SDF subtraction; creates actual cavities and undercuts.
- **Smooth Formation:** moves the local field toward the unedited formation distance, preserving the author’s ability to reveal or erase geological detail.
- **Sharpen Fracture:** opens a narrow discontinuity and raises the local fracture attribute.

The stroke list is capped at 1024 in the current authoring implementation. A production version should compact the list into a sparse clipmap or brick edit volume only when the user commits a stroke; the continuous geological field remains the source of truth for regeneration.

## Detail bands

| Band | Spatial scale | Source | Viewport treatment |
|---|---:|---|---|
| Landform | 10–30 m | finite outcrop footprint, topography, exposure | raymarched SDF, low step count near silhouette |
| Structure | 0.5–8 m | beds, foliation, joint episodes, cooling cells | event buffers + conservative sphere tracing |
| Weathering | 0.01–2 m | water/salt/frost/abrasion, hardness and porosity | distance recession + secondary material response |
| Mineral | 0.02–0.2 m | jittered non-periodic grain cells | SDF relief at close range; roughness/albedo response |
| Microfracture | 0.001–0.05 m | crack proximity and brittle event energy | geometry only while projected above pixel threshold, otherwise shading derivative |

The detail budget is view-dependent. The field is continuous, but the renderer should not spend 192 steps on a sub-pixel grain at every camera distance.

## Sphere tracing safety

The field composes several bounded terms, so it is distance-like rather than the exact distance to a single primitive. `RockTerrainTrace` uses a conservative `0.72 × distance` step. The production pass should:

1. intersect the finite field bounds before tracing;
2. use a field Lipschitz bound per formation regime;
3. reduce the step multiplier around high fracture/brush curvature;
4. switch to a secant refinement for the final two steps;
5. derive normals from the same edited field, never from a separate texture normal;
6. run a backtrack if a step crosses from positive to negative without meeting the hit threshold.

## Authoring feedback

The panel should show more than sliders:

- lithology / formation regime;
- seed and deterministic regeneration;
- water flux, salt, freeze-thaw, insolation and wind access;
- bedding, grain, joint and column scales;
- a toggle for distance, hardness, fracture, water, salt, oxidation and debris visualisation;
- sculpt history count, undo and clear;
- a warning when a user asks for an event that does not belong to the selected lithology;
- a field-quality budget and last extraction time.

A “realism” slider is deliberately not part of the design. Changing one number cannot substitute for choosing a plausible formation history.

## Validation suite

The implementation should be judged with fixed seeds and image checkpoints at three distances:

1. **Wide:** silhouette, talus, joint-controlled massing and weathering bias read as geology, not a noise ball.
2. **Medium:** bedding, cooling columns, cavity overhangs, sheet joints and fracture intersections have unequal spacing and believable cross-cutting.
3. **Close:** grain boundaries, friable edges, mineral contrast and microfractures remain coherent as the camera moves; no UV seams or repeat period are visible.

Numerical tests:

- sample at `p` and `p + candidate tile periods`; the distance must not repeat as a designed period;
- finite-difference normal length remains within tolerance after sculpting;
- add/remove strokes change sign where expected and undo restores the prior sample;
- a basalt field has no column cracks when the cooling regime is disabled;
- a granite field has no universal bedding or conchoidal pattern;
- water/salt zero reduces tafoni recession and salt attribute;
- extraction and raymarched zero-crossing agree within the configured cell tolerance.

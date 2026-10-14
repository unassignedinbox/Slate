# Slate — WebGPU SDF GI (Lumen architecture) with the Project-Drive ControlVehicle

A WebGPU global-illumination renderer built stage-for-stage on the architecture
Epic documents for **Unreal Engine's Lumen**, with the **ControlVehicle from
Project-Drive** (Frontier repo, branch `arena/4f07c82a-frontier`, commit
`319e5532`) driving around the DriveCourse proving ground so you can watch the
Global Distance Field update live (main view + picture-in-picture GDF slice).

## Run it

```sh
python3 -m http.server 8000 --bind 0.0.0.0   # or: npm run serve
# open http://localhost:8000 in Chrome/Edge (WebGPU required)
```

No build step. Mesh distance fields bake once at load (~1–2 s, progress shown).

**Controls (same as Project-Drive):** W throttle · S brake/reverse · A/D steer ·
Space handbrake · R respawn · C chase/free camera · drag orbit · wheel zoom.
Auto-drive is on by default — any driving key takes over. "Freeze Global Distance
Field" stops clipmap composition so you can drive away from a stale field and see
exactly what the field was contributing.

## The pipeline (what runs every frame, in order)

| # | Stage here | Lumen equivalent | Implementation |
|---|-----------|--------------------------------------------------|-------------------------------------------------------------------------------|
| 1 | Mesh Distance Fields | Per-mesh distance fields | Fresh baker (`src/meshdf.js`): BVH + exact closest-triangle distance, angle-weighted pseudo-normal sign (valid for the ControlVehicle's open shell, where parity sign fails). One field per unique mesh, baked once. **Frontier's C++ `DistanceFieldBakeSolver`/`DistanceFieldSpace` is not used — it was flagged buggy; only authored geometry/material/course data is taken from that repo.** |
| 2 | Card capture | Surface Cache mesh cards | Cards clustered by dominant normal axis (≤6/mesh), projected into one 1024×512 atlas (`src/scene.js`, `WGSL_CAPTURE`): albedo/roughness, local normal/metalness, local position/coverage, emissive. Captured **once in mesh-local space** — rigid motion never recaptures. |
| 3 | GDF composition | Global Distance Field clipmaps | 3 clipmap levels (64³ each, voxels 0.16 / 0.5 / 1.5 m), centres snapped to the voxel grid and following the vehicle. Composition samples the mesh DFs through placement matrices — moving the car *re-composes*, never rebakes. L0 every frame, L1 every 2nd, L2 every 4th. Freeze toggle sets the mask to 0. |
| 4 | Cache direct lighting | Direct lighting on the Surface Cache | Every atlas texel is repositioned in world space from its card + placement matrix; sun visibility is a sphere-traced GDF soft shadow (distance/penumbra ratio), point-light visibility is GDF occlusion. |
| 5 | Cache radiosity | Surface Cache indirect / radiosity feedback | Cosine-weighted hemisphere rays sphere-traced against the **GDF only**; a hit samples the hit placement's card outgoing radiance from the *previous* frame (multi-bounce feedback), a miss samples the sky dome. **Amortised exactly as Lumen amortises**: vehicle (dynamic) cards relight every frame, static texels rotate at 1/8 per frame by default (UI-selectable), with a per-sample firefly ceiling. |
| 6 | Outgoing resolve | Surface Cache radiance | `outgoing = emissive + albedo/π · (direct + indirect)`, ping-ponged so feedback never reads what it is writing. |
| 7 | Primary visibility | GBuffer | Rasterised triangles (the only raster in the system) into albedo/normal/emissive/depth. The GI debug view can replace this entirely with a GDF-raymarched primary. |
| 8 | Screen probes | Screen Probe Gather + screen traces | Probes every 8 px trace cosine rays: **screen trace against the depth buffer first** (detail + the small-emissive leak, below), then GDF trace sampling Surface Cache radiance. Temporal filtering with position/normal history rejection; per-pixel bilateral (normal/plane/depth) probe interpolation. |
| 9 | Final gather | Final gather + reflections | Per-pixel GDF-soft-shadowed direct + probe indirect + one Fresnel-weighted, roughness-jittered GDF reflection ray sampling the Surface Cache, ACES display transfer (same curve family as Frontier's resolve). |

## Things replicated deliberately because Unreal does them

- **Small emissive meshes are culled from the Lumen Scene.** Epic documents that
  small emissive meshes can be culled from the Lumen Scene and then contribute
  inconsistently through screen traces. The six 18 cm emissive cubes are exactly
  that: with the UI toggle off (default) they get no mesh-DF/GDF presence and no
  card-fed GI, yet still appear — and leak light — through screen traces. The HUD
  lists what is currently culled. Toggle them in to see the difference.
- **Amortised, prioritised cache updates** (dynamic first, static in rotation) and
  the resulting few-frame bounce lag after a fast move — visible with the freeze
  toggle and the "Surface Cache outgoing" view.
- **Coarse-cache / detailed-primary split:** the raster primary carries the detail;
  the field and cards are deliberately coarse (that's why the checker pad reads
  perfectly in the final image but coarsely in the atlas view).

## Debug views

Final · Indirect only · Direct only · Surface-cache irradiance · Surface-cache
outgoing · **GDF slice** (blue outside / red inside / white surface, isolines,
clipmap borders in green/yellow/magenta, vehicle as yellow dot) · Clipmap levels ·
GDF-raymarched surface · Sphere-tracing step cost (magenta = budget exhausted) ·
Surface Cache atlas · Mesh cards · Screen probe grid. The footer reports composed
GDF voxels, relit cache texels and probe counts per frame, plus live probe-trace
counters read back from the GPU every 60 frames.

## The vehicle

Geometry extracted verbatim by `Tools/extract-vehicle.py` from Frontier's
`ControlVehicleStructure.inl` / `ControlWheelStructure.inl` (1,492 verts / 2,924
tris body with authored per-face material families, 786/1,568 rim; tyres are the
closed rest envelope from `WheelProjection.h` at the authored 0.50855 m radius /
0.3958 m width). Materials are the linear authored values from
`DriveSceneAuthor::AuthorMaterials` (clearcoat paint with the 0.78 flake headroom,
FrontLight 48.7, RearLight 6.5, rim-mag emissive lift…). The course is
`DriveCourse.h` re-implemented once in `src/course.js` and read by both the
physics (`courseHeight`, incl. ramp, bumps and kerb) and the geometry builders —
the same contract as the native file. Driving uses `DriverInputIntegrator`'s
keyboard ramps/self-centring and `VehicleGeometry`'s authored wheelbase, track,
CoM, tyre size and 0.52 rad lock.

## Honest boundaries (what "exactly like Unreal" can and cannot mean here)

Unreal's Lumen is closed-source and engine-scale; bit-exact replication of Epic's
proprietary implementation is not possible from documentation, and this page does
not claim it. What is implemented without simplification or substitution is the
**documented architecture and data flow above** — no alias-table sampling, no
triangle-traced GI shortcut, no analytic occluders, no baked/static GI. Within
that, WebGPU-demo-scale choices are: cards are dominant-axis clusters rather than
Unreal's offline card generation; probe placement is a uniform 8 px grid rather
than Unreal's adaptive probe volume; glass transmission reads as dark glossy
(the car's smoked glazing) rather than a transmissive lobe; cache texel size is
~5–15 cm rather than production density; and the chassis is a drivable
bicycle-model approximation on Frontier's authored geometry/input data — the
full Pacejka/drivetrain/solver stack remains native-only, as Project-Drive's own
README scopes it. Everything the GI does with that vehicle, however, is the full
field → cards → radiosity → probes path.

## Verification (all runnable)

```sh
node tests/verify.mjs     # scene/card/course/DF/vehicle audits, cheat-string audit
node Tools/validate-wgsl.mjs   # optional: full Dawn/Tint compile of all pipelines (needs `webgpu` npm pkg)
```

Verified in this environment: all CPU checks pass; every WGSL module and
pipeline compiles under Dawn (Chrome's Tint) with zero errors; the full page
initialisation and per-frame command stream validate on Dawn's null backend
(246 fps at 675×420 with the vehicle lapping the course). Mesh-DF bake of the
whole scene: ~1.4 s. **Not verified here: an actual gaming-GPU frame** — this
sandbox has no Vulkan/browser GPU, so first-frame visual confirmation and
hardware frame times are yours to take from the run above (SwiftShader will be
slow; a discrete GPU is the intended target).

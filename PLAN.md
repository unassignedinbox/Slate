# Follow-up plan — IlluminationHost (pre-C++ WebGPU prototype)

This branch so far: reconstructed `IlluminationHost/` file-by-file from the Frontier- patch
(no more patch file), restored the binaries, and added the configurator's HMI finishes
(paint / clear coat / rims, live on the car) plus the X-ray ghost/wireframe view.
Below is the work queued for the next turn(s), in the order asked.

## 0. Physics today (not Jolt)

No Jolt anywhere — the physics is hand-rolled JS in the exhibit:

| System | File | Model |
| --- | --- | --- |
| Chassis | `Source/VehicleSolver.js` | 6-DOF rigid body, socket struts, transient-slip MF6.1 tyres, GT-R powertrain, 480 Hz substeps |
| Debris & cones | `Source/RigidBodyWorld.js` | convex-hull rigid bodies at 120 Hz, sequential impulses, sleeping |
| Tyre heat/smoke/fire | `Source/TyreThermalSolver.js` | tread/carcass/gas heat exchange, ignition, emissions |
| Tyre carcass (visual) | `Source/TyreCarcassSolver.js` + `Shader/TyreCarcass.wgsl` | 96-node flexible ring per wheel, in the vertex stage |
| Scrapes & sparks | `Source/VehicleSolver.js` (`RecordScrape`) + `Source/SparkSequence.js` | CPU particles, analytic course collision only |

A Jolt port is possible (WASM build + a binding layer for the solver state the HMI/GI read
every frame), but it is a project on its own — listed last, not assumed.

## 1. Retire the tyre deformation visual ("isn't good enough")

The complaint is about the *look*, and the dynamics must not change. Two grades:

- **(a) Drop the exaggeration** (recommended first): remove the `DeformationScale`
  path (`Cabin.z`, the inspector's "Deformation ×" slider, the roll-in/out and wave
  scaling in `DisplaceTyre`) and keep the true 1× carcass. The dynamics never saw the
  exaggeration, so nothing else moves.
- **(b) Drop the carcass visual entirely**: rigid archive meshes (`DeformTyre` becomes
  identity except shredded collapse), delete `TyreCarcassSolver.js` and the `Carcasses`
  half of `VehicleRecord`. Only if (a) still reads badly.

Files: `Source/InspectorPages.js` (Tyres card), `Source/IlluminationHost.js`
(`TyreDeformation`/`DeformationScale`, `QueryCabinHeader`), `Shader/TyreCarcass.wgsl`,
`Source/TyreCarcassSolver.js`, `Tools/VehicleStability.mjs` (must keep passing).

## 2. Sparks: light, derez, collision, colour

1. **Emissive light.** Sparks are additive streaks only — they light nothing. Feed the
   brightest live sparks into a scene light: extend the tyre-fire point light
   (`FireLightPosition/Intensity/Colour` in `SceneRecords.wgsl`, resolved in
   `Shader/FireIllumination.wgsl`) with a spark term, or splat spark radiance into the
   nearest surface cards. `Source/SparkSequence.js`, `Shader/SparkRaster.wgsl`.
2. **Derez interplay.** Decide and implement: no sparks while `MaskMode != Off`
   (the car has no contact), and/or a spark burst on rez touchdown.
3. **Collision with world geometry.** Today sparks only know the analytic course
   (`ResolveCourseHeight`) and skip off the road. Collide them against the same box
   colliders the rigid bodies use (`Scene.QueryObstacleBounds`: walls, barriers,
   containers, intact props) plus the course height — bounce with restitution, kill on
   steep impact. All in `SparkSequence.Advance` (a few hundred particles, CPU is fine).
4. **Realistic colour.** Today sparks read yellow-then-orange. Drive the streak colour
   by the particle temperature on a blackbody ramp: white-hot birth (~2600 K) →
   yellow → orange → deep red → out at `VisibleKelvin`. Check the temperature →
   radiance mapping in `SparkSequence.Emit/Advance`, the `CoolingSeconds` e-folding
   (0.42 s) and the head/tail brightness profile in `SparkRaster.wgsl`; reuse the
   fire palette in `Shader/FireIllumination.wgsl` so burning rubber and sparks agree.

## 3. Shredded tyres lay rim marks, not rubber

`TyreMarkDepot.Advance` lays rubber from `SlidingEnergy` regardless of tyre state, and
a bare rim leaves a rubber strip with tread grooves — wrong. Plan:

- Pass per-wheel shred/burst flags (from `VehicleSolver`/`TyreThermalSolver`) into
  `Marks.Advance`.
- Shredded contact lays a narrow bright metallic streak instead: add a `RimMark`
  family in `Source/MaterialSpecification.js` (steel colour, high metalness), have
  `Shader/SurfaceRaster.wgsl` resolve shredded deposits to it *without* the tread
  grooves, and keep the existing rim sparks flowing.

## 4. Steering auto-correct (counter-steer / ESP assist)

Add a stability assist behind an inspector switch (default on, like line lock):

- Target yaw rate from steer angle and speed (kinematic bicycle model); correct the
  error with a steering overlay (counter-steer, rate-limited) plus differential rear
  brake and throttle cut for large errors.
- Implement input-side in `Source/DriverInputIntegrator.js` (it owns the steer ramps)
  with the enable flag threaded through `VehicleSolver.AssignAssists` (the `LineLock`
  precedent); expose in the Vehicle inspector card.
- Validate with a scripted lane-change in `Tools/VehicleStability.mjs` (no spin, no
  oscillation) and the headless harness.

## 5. Deferred polish from this turn

- **Paint ripple.** The configurator's expanding-ripple apply needs a per-pixel mix in
  `Shader/SurfaceReflectance.wgsl`, which has four includers (direct, recombination,
  reflection, forward) — each needs the new uniform. Design is sketched in
  `Source/FinishSequence.js`; implement when WGSL can be validated in-browser.
- **Authored-lime restore.** The inspector's paint select has no entry for the authored
  coat (defaults match it numerically but the mapping differs); add a preset that
  restores the exact authored record.
- **Ghost shadows.** The car still casts full shadows while ghosted (matches the
  configurator, which keeps `castShadow`). If an X-ray should not shadow, mask the
  shadow runs by the scan front too.

## Validation (every step)

```sh
cd IlluminationHost/Tools && npm install && npm run validate   # WGSL + pipelines + frames, headless
node VehicleStability.mjs                                      # solver stability, no install
```

Plus `?capture=1` PNG eyeball of the touched view (Garage, scan sweep, night sparks).

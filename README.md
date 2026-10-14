# Slate — WebGPU SDF Global Illumination (Lumen architecture, live ControlVehicle)

A clean, complete reimplementation of Unreal Engine 5 **Lumen's SDF global illumination architecture** in
plain WebGPU / WGSL / JavaScript — running the **authored ControlVehicle from Project-Drive** over the
`DriveCourse` proving ground so you can watch the **global distance field rebuild around the moving car** in
real time. Nothing is faked by blob fields, alias tables, or prebaked light maps; every visible GI term
travels the same data flow UE5 documents:

```
                                      Lumen Scene                       Lighting path
  ┌────────────┐   MeshSDF bake   ┌────────────────┐
  │  meshes    │ ───────────────► │ per-object SDF │ ─┐
  │ (car.vtx)  │  (exact per-voxel│  volumes (GPU) │  │   ┌─────────────┐   trace   ┌────────────┐
  └────────────┘   tri distance)  └────────────────┘  ├──►│  Global DF  │ ─────────►│ final      │
  ┌────────────┐   card raster    ┌────────────────┐  │   │  3 sparse   │   cones   │ gather     │
  │  meshes    │ ───────────────► │ mesh cards +   │  │   │  clipmaps   │           │ (1/px cone)│
  │ (course)   │  (6-dir ortho)   │ surface cache  │ ─┘   │  tiles 16³  │           └─────▲──────┘
  └────────────┘                  │ atlas          │  relight       └──────┬──────┘          │
                                  └───────────────┘ ◄──────────────────────┘ voxel lighting  │
                                        ▲            amortized across frames   (cone-traced   │
                                        └──────────────── multi-bounce         surface cache) ┘
```

Stages, exactly as in Lumen (Epic's documentation, not the "alias-table" demo family):

1. **Mesh distance fields** — each Lumen object owns a signed-distance volume in object space
   (`mesh_sdf_bake.wgsl`), baked per voxel with exact point-to-triangle distance and triangle-normal sign.
   The ControlVehicle body bakes at 112×48×32, the authored hub-local wheel at 24×12×24.
2. **Mesh cards** — every object is split into axis-aligned orthographic sprites over the six canonical
   directions (`js/cards.js` + `sc_capture.wgsl`), depth-selecting the nearest shell per 8×8-texel card —
   5,605 cards on this scene (positions are world-space `rgba32uint`; albedo/normal/emissive layers).
3. **Surface cache** — lighting is evaluated **on surface-cache texels**, not per hit (`sc_relight.wgsl`):
   direct sun with SDF soft-shadow cone, bounced irradiance from the voxel volume (prior frames — this is
   the multi-bounce feedback), sky visibility. **Updates are amortized across frames**: a rotating 64-row
   atlas band per frame (full refresh = 16 frames) plus the car's own card rows every frame.
4. **Global distance field** — three sparse clipmaps (voxels 0.1 / 0.4 / 1.6 m, tiles of 16³) built the
   Lumen way (`gdf_build.wgsl`): per voxel the minimum over each dynamic object's mesh-SDF sample
   (trilinear, through the live inverse transform) and the exact static triangle list of that tile.
   Only tiles within the field range of geometry are allocated from the 2048-tile pools, toroidally
   addressed around the **car**; car-adjacent tiles rebuild **every frame**, so the field visibly chases
   the vehicle. L1/L2 continue the field to 96 m / 400 m for long cone traces.
5. **Voxel lighting** — clipmap-0 voxels gather 8 short cones (6 axis + 2 jittered), reading radiance from
   surface-cache cards at the hit (`vx_light.wgsl`); misses read the shared sky cone. Amortized: car tiles
   relight every frame, everything else rotates through a per-frame budget.
6. **Final gather** — per pixel, a cosine-lobe cone marches the clipmap ladder (`final_gather.wgsl`);
   radiance comes from the voxel volume blended with the crisp surface-cache fetch when the cone ends in
   clipmap 0 (that's what keeps headlamp/taillight bleed sharp). Direct sun + GGX specular + temporal
   accumulation with world-position disocclusion, then ACES.

## Run it

```bash
node server/serve.mjs            # http://localhost:8080
```

Any static file server works (the app is fully static, no build step). Requires a WebGPU browser.

## Drive it

| key | action |
|---|---|
| **W / S** | throttle / brake (any driving key takes over from the autopilot) |
| **A / D** | steer |
| **Space** | handbrake |
| **R** | respawn |
| **F8** | eject to free-fly camera (`WASD`+`QE` move, drag to look, Shift = fast) · again to possess |
| **C** | chase → orbit → top camera |
| **1–8** | pipeline debug views (full, GI-only, direct-only, surface cache, **global DF slice**, body mesh-SDF, voxel light, mesh cards) |

The autopilot tours the whole course: launch the ramp, thread the 8-cone slalom, brush the kerb, roll the
speed bumps. The GDF view (key **4** / dropdown) shows tiles being torn down and rebuilt around the car as
the clipmaps follow it, with the L0/L1/L2 ownership tinted and the allocation-horizon rings drawn.

## The vehicle & the course (exact, from the source repo)

- `assets/car.bin` is generated by `tools/extract_vehicle.mjs` from the **authored** `ControlVehicle.blend`
  archives of [`SultanAladin/Frontier-` @ `arena/4f07c82a-frontier`](https://github.com/SultanAladin/Frontier-/tree/arena/4f07c82a-frontier):
  body 2924 tris / 1492 verts, rim 1568, tyre 3968 with the authored per-face material families
  (`MetalicCoat` lime clearcoat, glass, plastics, rubber, blue mags, 48.7-nit headlights, red taillights —
  the same `DriveCourse.h CourseMaterial` palette and linear values as `DriveSceneAuthor.cpp`).
- Chassis runs on the authored sockets (`Socket_AxleMount_*`, wheelbase 3.396 m, track 2.095 m,
  tyre radius 0.50855 m). Wheels are the hub-merged authored meshes, one Lumen object each.
- The course (`js/course.js`) is a direct port of `DriveCourse.h` — same constants, same `courseHeight`
  tyre query, same emitter (checker pad, ramp, speed bumps, kerb with real walls, slalom cones at
  `x = 18+5k, y = ±2.4`), verified by the self-test to agree with the physics query everywhere.
- The buggy C++ SDF implementation is deliberately **not** ported; this is a new, GPU-native implementation.

## Verification

```bash
node tools/selftest.mjs     # naga-validates all 8 WGSL modules, checks meshes/cards/soups/clipmap plans
node tools/check_wgsl.mjs   # WGSL only, through naga (the toolchain wgpu itself uses)
node tools/extract_vehicle.mjs /path/to/Frontier-   # regenerate assets/car.bin from the archives
```

17 checks: WGSL validity, course emitter↔physics agreement (≤ 3.5 cm), ramp exactness, archive triangle
counts, every captured triangle inside its card slab (0.0000 m overshoot), clipmap allocation under a
140-frame drive (car tiles 100 % resident), soup/cell-list integrity.

## Controls & honest caveats

- **Small emissive meshes in Lumen Scene** (sidebar): replicates Epic's documented caveat. Headlights and
  taillights are small emitters — off by default? No: ON here. Turning it OFF drops their surface-cache
  contribution so their GI vanishes while the drawn lamps stay — the exact inconsistency the docs warn about.
- The surface cache's far field fades beyond a few metres of surfaces (that's what tile allocation means);
  sky radiation arrives through cone misses, matching Lumen's own horizon handling.
- The C++ reference SDF transport images are CPU references, and this WebGPU build is the GPU pipeline;
  they are compared by structure, not pixel-parity.

# Vehicle-specific soft tyres · continuation notes

## What changed

The previous patch had a quasi-static series spring and a separate 96-node explicit radial ring running at 3,600 Hz. It also **removed the tyre mesh immediately on a pressure burst**, before the flat carcass could be seen. That mesh swap now happens only on a later shredding event.

The replacement is a **reduced pneumatic contact + implicit shell model**, not Chaos Flesh's tetrahedral FEM and not XPBD. The shader skins actual simulated radial/axial sector state; it is not a pressure-slider-driven squash effect.

### 1. Load-bearing wheel/contact dynamics

`Source/PneumaticTyreModel.js` is shared by the vehicle physics:

- A 20 kg unsprung wheel DOF, at the vehicle's existing 480 Hz step.
- Backward-Euler coupling of wheel inertia, suspension spring/damping, progressive bump/droop stops and tyre support/damping.
- A bounded monotone scalar root solve, rather than the old static strut/tyre length intersection.
- Nonlinear casing/cord stiffness, pneumatic support proportional to gauge pressure, sidewall folding hardening and a stiff flange stop after rubber is pinched against the rim.
- A smaller rolling radius and less grip as the tyre deflates; the original MF6.1 longitudinal/lateral slip model remains.
- Contact closure passed directly to the visible carcass, including the effective ground envelope under the tread. Physics and graphics no longer query different ground heights at kerbs.

The effective pressure-support area is a calibrated reduction, **not** simply full geometric footprint area × pressure (which double-counts belt edge tension). Constants are SI and live in one model file.

### 2. Air/temperature/volume

The existing three-capacity thermal model retains air mass, gas temperature, slow punctures and fast blowouts. It now uses an enclosed volume reduced by the flattened circular segment, with an approximate allowance for recovered sidewall bulge:

`gauge pressure = max(0, airMass * R_air * gasTemperature / currentVolume − atmosphericPressure)`.

A leak approaches atmospheric mass at the current volume/temperature. Inflation seals intact tyres and sets their reference-volume air mass; tyres do not lose their selected pressure simply because they were pumped while collapsed. Shredded tyres need replacement. A pressure burst retains the rubber; after 150 m of accumulated flat-tyre surface travel, the existing failure sequence sheds it and reveals the rim.

### 3. Low-resolution shell and rendering

`TyreCarcassSolver.js` has 48 circumferential sectors with radial **and axial** displacement/velocity:

- 240 Hz fixed step, at most 16 steps per frame (same 66.7 ms catch-up ceiling as vehicle physics).
- Backward-Euler quadratic solve, 16 alternating coordinate-descent sweeps; a unilateral road boundary and bead/flange bounds. These are implicit mass/spring equations, not XPBD constraints.
- Pressure-dependent support/shear stiffness, damped rebound, lateral belt flex under the computed cornering force, bounded sidewall bulge and low-pressure fold detail.
- State stored in the road-aligned frame. Wheel spin changes the sampling angle, not the location of the ground patch; it cannot wind the flat spot around the rim.
- Fixed beads, bounded interpolation and a plane guard between sectors prevent overshooting the road at the tread.
- Full deformation-Jacobian normal mapping rather than rotating normals only by the radial slope.
- The same mapping in surface and cascaded-shadow rasters. Shadow vertices use only the position mapping.
- 432 bytes per wheel / 1,728 bytes for four wheels, preserving the prior GPU record stride. The old 96 radial floats become 48 radial + 48 axial floats.

**Coupling boundary:** the nonlinear contact law and unsprung wheel determine load/closure; the shell reconstructs the deforming rubber from that solved closure and lateral load. Shell nodal reactions are not fed back as a full distributed contact solve. This is deliberate model reduction, not a claim of FEM equivalence.

### 4. Sparks

`SparkProjection.js` uses the actual contact normal and sliding tangent. Hull fragments inherit part of the moving chassis velocity, so they trail the car in its frame. Rim emitters use contact material velocity including wheel rotation, so a stationary burnout can still throw sparks in the tread-slip direction. `EmberIntegrator.js` fans scrape particles in a local tangent basis with outward-only normal jitter and small tangent-plane spawn offsets. Non-scrape embers keep their previous spawning behaviour.

Both pinched/shredded rim contacts and sliding hull contacts can emit sparks. Ground bounce remains the existing particle solver's response; wall bounce is not a new feature.

### 5. Cockpit, glass and HMI

- `CabinLayout.js` ports the estimated left-hand-drive fixture/eye placement from `DriveCabinLayout.h`; the source shell has no authored interior sockets. Simple dash, tunnel, floor and seats are added to the body mesh and participate in the existing GI/shadow path.
- `CabinProjection.js` adds a toroidal 3D steering grip, spokes and an embedded hexagonal cluster. The whole wheel/cluster turns with steering.
- The four modules in `Source/HMI/` come from Frontier's `Experimental/TabletPanel`: cluster, screen sequence, app specifications and original SVG icons. No bundled Three.js or external vehicle preview is needed.
- Cluster demonstration animation is off: speed, rpm, gear and low-pressure warning are live. The original cluster lamp fill-colour bug is fixed.
- The centre tablet keeps the launchers, Settings picker and local demo applications. Its Tyres/Telemetry pages use live vehicle readings; its tyre pressure slider pumps/seals intact tyres. Other apps are explicitly still local interface demos, not network/media/navigation integrations.
- Canvas/physical aspect ratios match; pointer rays use the same tablet transform as rendering and map to fixed logical UI coordinates, independent of DPR/render scale. Touch uses retained UI regions rather than a screen-space overlay.
- Car glazing is excluded from the opaque body/SDF/card geometry and drawn in a thin alpha/Fresnel pass. It is genuinely see-through, **not full refractive/absorptive glass**.
- Driver, passenger and centre-cabin debug cameras are chassis-rigid, including their up vector. Drag to look, C to toggle cockpit/chase, F8 for free flight. All camera changes invalidate temporal history.

## Limits / next steps

This is a practical vehicle-focused approximation, not a general soft body:

- No tetrahedra, volumetric strain, plasticity, mesh tearing, bead unseating, persistent cuts or damage propagation.
- The radial tyre contact model uses a sampled road envelope/one support plane per wheel. It does not resolve arbitrary multi-point obstacle contacts, full camber-dependent sidewall contact or a tyre swallowing a sharp rock.
- No spin-advection/centrifugal tyre growth or validated high-speed standing-wave prediction. Low-pressure wrinkle detail is visual.
- The coarse GI distance field/surface cards still approximate wheel geometry at rest. Surface silhouettes and raster shadows deform; ray-traced tyre self-occlusion is not a per-frame soft mesh rebuild.
- Steering hardware and live screen/glass overlays are depth-tested forward rendering after scene tonemapping; those moving fittings/screens do not inject live screen light or moving-wheel shadows into GI. The static interior furnishings do.
- Coefficients need reference tyre load/deflection data before handling realism can be asserted. The unsprung reduction omits full upright/strut kinematics and absolute hub acceleration coupling.

If higher fidelity is needed next, add a small **two-shoulder/crown shell** with distributed contact forces and offline-calibrated modal reduction, not a full-car tetrahedral solve. That would add camber/contact-width behaviour while keeping fine render geometry skinned from a small simulation cage.

## Verification

```sh
npm test --prefix Experimental/IlluminationHost
npm run benchmark --prefix Experimental/IlluminationHost
```

Ten deterministic tests cover contact monotonicity, pressure/volume/leak behaviour, inflated/flat/rim impacts, airborne recovery, road/rim/axial bounds, fixed-step equivalence at 24/30/60/120/144 Hz, reset, one-corner blowout/reinflation/respawn, a long burnout/driving sequence, cabin basis/pointer round-trip and outward scrape fans.

A representative sandbox Node run of 1,800 frames (30 simulated seconds), **complete CPU vehicle plus four shells**, measured about **0.7 ms/frame** after warm-up. This excludes the WebGPU renderer and is not a target-hardware FPS guarantee.

Optional browser smoke (install Playwright separately; Chromium must support WebGPU; start the static exchange first):

```sh
node Experimental/IlluminationHost/Tests/BrowserSmoke.mjs
```

`PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH`, `EXHIBIT_URL` and `EVIDENCE_DIR` are optional environment overrides. The test boots the full renderer, checks camera controls and an actual projected tablet click, and verifies that a blowout retains its tyre mesh while pressure drops and closure grows. In headless Chromium/SwiftShader: **25 frames, zero WebGPU validation errors, all checks passed**, 74 transparent glazing triangles; test blowout reached 0 kPa and about 114 mm closure. Hardware GPU performance and subjective driving feel still need user testing.

## Provenance

- Reference branch inspected: `SultanAladin/Frontier-:arena/9440f4d0-frontier`, `ebd757e69181199ff34fdef70c88a7ebaf460977`. No IlluminationHost exists there.
- Restored exhibit: user-linked `GI-Updated-Html-Version/01a141bb-e6e8-71cb-8fbf-e7a69a00b7de.patch`, Git blob `15e6439ac799a15cf5696d72588448f412215b44`.
- Archive/HMI/layout source: `arena/4f07c82a-frontier`, `319e5532d2f0f1ca59e6e5fb6997085928aadec2`.
- Reconstructed mesh blob hashes exactly match the patch: body `b4b3fa4ca19cdb2236d1045ab6f6bf775f43d69e`, rim `24a1990766b0a66bfff67167958452d55480e2af`, tyre `a763a8b8eb5fe0cc7600886d8e5bab0c650ed735`.
- All work is in `arena/8e836026-slate`; no external branch was changed.

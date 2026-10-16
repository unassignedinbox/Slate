# Vehicle prototype — next iteration plan

**Status:** planning only. These items are not implemented in the current reconstruction.

## 1. Remove the tyre deformation presentation

- Remove the soft-carcass deformation from the rendered tyre mesh and the associated inspector toggle/exaggeration controls; the current visual result is not convincing enough.
- First keep the vehicle solver's tyre deflection/contact calculations intact. They affect wheel loads and handling, and are separate from the visual carcass animation. Revisit the physics model only if the next pass shows that the physical deflection itself is the problem.
- Re-run the existing stability suite at rest, with punctures/blowouts, on slaloms, and with shredded tyres to check that the visual removal did not alter vehicle dynamics.

## 2. Improve sparks: light, colour and world collision

- Give sparks HDR emissive output and a small, short-lived local light contribution so nearby surfaces respond to them; keep their timing coherent with the existing Derez/rez effect.
- Drive spark colour and brightness from a cooling/age curve: a hot white-yellow core, then orange, then a dim red/black fade. Keep per-particle variation subtle and avoid the current abrupt yellow-to-orange change.
- Audit debris shading separately: ordinary cold fragments stay physically shaded, while any hot fragments inherit a short-lived ember tint/emission that fades with age.
- Add bounded collision for sparks against the scene distance field and world geometry. Reflect/slow particles at contact, then let them die or slide; cap collision work and test both static course surfaces and moving/breakable geometry.
- Review thrown-debris contact response in `RigidBodyWorld.js` against ground, static props and other fragments; add non-penetration/restitution/friction checks and collision-colour response rather than making fragments glow indiscriminately.
- Verify collision and light behaviour at both normal frame rates and low-quality render settings.

## 3. Use rim marks when a tyre is shredded

- Stop depositing rubber skid marks from a shredded wheel.
- Detect rim-to-ground contact and lay a separate, narrow metallic scrape track; couple contact sparks to the same scrape event.
- Keep normal rubber deposits for intact tyres and add tests that distinguish intact, punctured and shredded wheels.

## 4. Add steering self-centering

- Add speed-sensitive steering return-to-centre (self-aligning torque/damping), not lane-keeping or an automatic steering override.
- Let driver input win while the wheel is being held; taper the assist near standstill and avoid oscillation at speed.
- Validate left/right symmetry, release-to-centre behavior, slalom response and drift transitions before tuning stronger assistance.

## Physics engine note

The current exhibit **does not use Jolt Physics**. `VehicleSolver.js` and `RigidBodyWorld.js` are custom JavaScript prototype solvers; the vehicle model is a hand-ported implementation, not a Jolt-backed simulation. Defer a Jolt change for now: first assess the target native C++ integration, required vehicle/contact features, build footprint and a migration test plan. Do not replace the prototype solver as part of the HMI/material work.

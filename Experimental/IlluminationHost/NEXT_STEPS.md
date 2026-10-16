# Next-turn plan: vehicle dynamics and effects

Scope: follow-up work only. This plan records the requested changes; they are not part of the HMI/material integration in this turn.

1. **Remove the unsatisfactory visible tyre deformation.** Disable the soft-carcass vertex displacement and remove the deformation/exaggeration controls that drive it. Keep pressure, wear, puncture, blowout, and shredded-tyre behavior unless testing shows they depend on the visual deformation.
2. **Improve sparks and hot-metal lighting.**
   - Keep the current additive spark streaks, but add a restrained local emissive-light contribution so nearby surfaces respond. Recalibrate the particle temperature and lifetime color so fresh hot metal has a convincing white/yellow core and cools through orange/red toward dark.
   - Extend collision beyond the analytic ground to world geometry (barriers, containers, and breakable props); use a small collision radius, damped bounce, and a clear lifetime/termination rule.
3. **Review the derez presentation separately.** Derez cubes already render into the surface projection and contribute to the scene lighting. Preserve that working path; review the white-hot-to-cyan/lime cell/cube palette and recovery timing against the desired look, keeping its palette controls independent from spark temperature.
4. **Use rim marks after a tyre is shredded.** Stop depositing rubber once the tread is gone, and add a distinct metal-on-surface rim-scrape mark alongside the rim sparks. Verify intact-tyre skid/burnout marks remain unchanged.
5. **Add steering self-correction.** Prototype a speed-sensitive return-to-centre/self-centering assist with damping and a user toggle. Before implementing, confirm whether “auto-correct” means steering-wheel return-to-centre only or automatic heading/lane correction as well.
6. **Physics-engine decision.** The current prototype does **not** use Jolt: `VehicleSolver.js` and `RigidBodyWorld.js` are project-specific JavaScript solvers, with the vehicle model and contacts implemented directly. Compare a Jolt integration against the current solver and define scope/performance/behavior tests before migrating; do not silently replace the current vehicle model.

## Suggested validation

- Compare tyre shape and contact behavior before/after deformation removal at normal and low pressure.
- Run spark tests against ground, walls, containers, props, and the car; verify reflected/bounced trajectories do not tunnel at frame stalls and nearby surfaces receive controlled light.
- Confirm the derez sequence remains lit, legible, and palette-adjustable without being affected by spark settings.
- Confirm a shredded tyre lays no rubber mark but produces a visible rim mark and sparks.
- Measure steering response at standstill, parking speeds, and highway speeds with the assist on and off.
- If Jolt is selected, test equivalent acceleration, braking, cornering, collisions, deterministic replay, and CPU cost against the present solver.

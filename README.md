# Strata — SDF Terrain Lab

A dependency-free HTML/WebGL2 prototype for a node-based terrain landscaping workflow. It is intentionally topology-first: the viewport ray-marches a bounded 3D signed-distance field with finite cliffs, a carved river channel, a cave, and an undercut. It does not use a heightmap for the preview.

## Run

```bash
npm run dev
# open http://localhost:5173
```

The app is static HTML/CSS/JS and needs a browser with WebGL2 for the volumetric preview. The node graph, inspector, particle controls, research modal, and authoring UI remain available if WebGL2 is unavailable.

## Prototype features

- OLED-black, docked scene / viewport / inspector workspace with a live node graph.
- Ray-marched sampled 3D SDF terrain with primitive union, Boolean cave/overhang cuts, strata detail, and an erosion-driven river bed modifier.
- Typed small particle preview for rain, guided river transport, dry wind abrasion, and rockfall impact. Particle contacts sample the same 3D field, stamp localized SDF removal, carry cargo, and stamp deposits when they settle.
- Settled particle state, typed cargo, deposition counters, and a reset/audit workflow so agents do not endlessly cut one hole.
- Flow-aligned procedural water shader with animated current streaks, foam, reflection tint, wave amplitude, water level, and independent transport visibility.
- Live solver controls, terrain/water/erosion inspectors, camera orbit/pan/zoom, view modes, and draggable node cards.
- `docs/terrain-requirements.md` records the AAA-oriented SDF, particle, water, GPU, conservation, and graph requirements that should back a production implementation.

This prototype is a front-end and visual simulation slice, not a calibrated geological solver, CFD/SPH implementation, or engine-ready sparse-volume backend. The requirements document lays out the production direction: GPU ping-pong SDF/material fields, stable particle metadata, conservation-safe contact/deposition passes, sparse bricks, deterministic ticks, and resumable exports.

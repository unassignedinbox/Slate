# Slate Terrain Lab — SDF erosion workstation

A terrain landscaping tool built on a **volumetric SDF** (not a heightmap), so you get
**real caves, overhangs, cliffs and arches**, shaped by **particle erosion**:

- 🌧 **Hydraulic rain** — SDF-native Hans Theobald Beyer droplets with impact, sediment capacity,
  evaporation, and sea-level deltas
- ⛰ **Thermal talus** — true 3D slope relaxation (overhangs survive, scree cones grow)
- 🌪 **Wind** — saltating sand + windward abrasion + leeward dune deposition
- 🌊 **Rivers** — discharge-routed channels with levees, fans and deltas

Workflow is a **layer stack** (Gaea-style, deliberately *not* node-based): ordered
primitives (slab, mountain, mesa, sphere, box, torus/arch, cave worms, crater, strata)
with union / subtract / intersect / smooth-blend, then eroders run live on the volume
with particle visualization and throttled remeshing.

The last session's "push/pull" artifact is fixed architecturally: particles **only edit
the density field** via clamped volumetric splats (never mesh vertices), droplets deposit
remaining sediment on death, and a live **sediment ledger** proves mass conservation.

## Run

No build step, no npm install. Serve over HTTP (modules + worker need it):

```sh
npm start        # or: python3 -m http.server 8080
# open http://localhost:8080
```

Needs internet once for the Three.js CDN, and any WebGL2-capable GPU (GTX-friendly:
sim runs on CPU in a worker; default volume 128×64×128 ≈ 17 MB).

```sh
npm test         # numerical smoke tests (node)
```

## Layout

Outliner (stack + eroders) · Viewport (orbit/zoom/pan, clip plane for caves) · Inspector
(Layer / View / Project tabs, presets, save/load, OBJ + heightmap export).

See [docs/RESEARCH.md](docs/RESEARCH.md) for the requirements research and AAA-roadmap notes.

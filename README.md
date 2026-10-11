# Slate

**[apps/roadsmith](apps/roadsmith)** — a WebGPU procedural road-network generator: spline-drawn
roads with real anatomy (kerbs, gutters, footways, paving bonds, markings, potholes, roadworks,
parking), quad-dominant topology with welded single-mesh intersections, city blocks, bridges,
tunnels, railway + level crossings, AI traffic and trains, and a two-stack editor UI
(scene layers + texturing layers) with a gizmo that moves a whole intersection at once.

```
cd apps/roadsmith && python3 -m http.server 8080
```

Headless audits (no GPU required):

```
cd apps/roadsmith
node tools/validate.mjs --scene
npm run check
```

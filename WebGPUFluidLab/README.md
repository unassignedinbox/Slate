# Slate Fluid Volume

A standalone WebGPU fluid lab for Slate. Serve this directory over HTTP and open `index.html` in a WebGPU-capable browser:

```bash
python3 -m http.server 4173 --bind 0.0.0.0 -d WebGPUFluidLab
```

The demo uses a GPU particle solver rather than a visual-only approximation:

- 12,288 particles with a uniform-grid hash and atomic cell insertion.
- SPH density, pressure, viscosity, cohesion, gravity, domain-wall and analytic sphere/box collision passes in WGSL.
- Four material presets: water, milk, chocolate and mud. Each changes density, particle mass, pressure response, viscosity, cohesion and adhesion.
- Surface adhesion applies a normal cling force near collider surfaces, with material-specific strength.
- A ray-lit studio pass renders the floor, grid, sphere, ledge and moving paddle, followed by camera-facing liquid spheres with per-pixel normals and depth.
- Dynamic resolution uses real offscreen color/depth attachments and an upscale presentation pass, adapting between 64% and 100%.
- Drag to orbit, wheel to zoom, Space to pause, R to reset.

`app.js` contains the compute and render WGSL source near the top of the file for easy experimentation.

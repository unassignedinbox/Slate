# Slate

## WebGPU Fluid Volume Lab

`WebGPUFluidLab/` is a browser-runnable 3D fluid prototype built on WebGPU. It includes a WGSL SPH solver with uniform-grid neighbor search, material presets for water, milk, chocolate and mud, analytic sphere/box collisions, sticky surface forces and an actual dynamic-resolution render target.

Run it locally with:

```bash
python3 -m http.server 4173 --bind 0.0.0.0 -d WebGPUFluidLab
```

Then open `http://localhost:4173`. See `WebGPUFluidLab/README.md` for controls and implementation notes. The existing native Vulkan engine remains under `Engine/` and `Projects/`.

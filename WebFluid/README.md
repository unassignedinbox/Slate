# WebFluid — Realtime PBF Fluid Simulation (WebGPU)

A self-contained, dependency-free realtime 3D liquid simulator in the spirit of
Unreal Engine's Niagara fluids, running entirely in the browser on WebGPU.

## Features

- **Position-Based Fluids** (Macklin & Müller 2013) solver in WGSL compute:
  spatial hash grid (atomic linked lists), density constraint (lambda) solve,
  artificial pressure (surface cohesion), XSPH viscosity, CFL clamping.
  2 substeps × 3 Jacobi iterations per frame, up to 60k+ particles.
- **Fluid presets with real property differences**:
  - *Water* — low viscosity, transparent with Beer–Lambert absorption + refraction
  - *Milk* — opaque white, soft wrapped (SSS-ish) diffuse, low gloss
  - *Chocolate* — high viscosity + cohesion + adhesion, dark glossy, coats objects
  - *Mud* — very high viscosity, matte rough with granular normal perturbation
- **Collision & sticking**: tank SDF walls, a draggable/orbiting sphere
  (two-way push on fluid via constraint projection), a static obstacle block.
  Adhesion forces + sticky friction make viscous fluids cling to and coat
  surfaces, and drip under gravity.
- **Screen-space fluid rendering** (the standard GDC/NVIDIA technique):
  sphere impostor depth pass → depth-aware separable bilateral blur →
  normal reconstruction from blurred depth → additive thickness pass →
  composite with absorption, refraction, Fresnel sky reflection, sun specular,
  filmic tonemap.
- **Dynamic resolution** à la Unreal: all heavy GPU targets render at a scale
  factor (45%–100%) that automatically steps up/down tracking a target frame
  rate (60/30 fps), with hysteresis + a "ceiling memory" to avoid oscillation.
  Manual override available.

## Run

Any static file server works (WebGPU needs a secure context: localhost or https):

```sh
python3 serve.py          # serves on 0.0.0.0:8000
# or: python3 -m http.server 8000
```

Open in Chrome/Edge 119+ (or Safari 18+/Firefox 141+).

## Controls

- **Drag** empty space — orbit camera, **wheel** — zoom, **Shift+drag** — pan
- **Drag the orange ball** — move it through the fluid (it pushes, splashes,
  and viscous fluids stick to it)
- **Pour** — continuous emitter stream, **Stir** — ball auto-orbits
- Sliders tune viscosity / cohesion / stickiness / particle count live

## Files

```
index.html            UI + layout
js/main.js            app: WebGPU setup, sim driver, passes, dynamic res, input
shaders/sim.wgsl      PBF compute kernels (predict/grid/lambda/delta/vel/xsph)
shaders/scene.wgsl    sky, floor, meshes, tank lines
shaders/particles.wgsl impostor depth + thickness sprite passes
shaders/post.wgsl     bilateral blur + fluid composite
```

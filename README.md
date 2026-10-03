# Slate

Real-time 3D particle fluid simulation and renderer for games and VFX.

- **`index.html` – WebGPU version (current).** The PBF solver runs in WebGPU compute shaders (`src/gpu/sim.wgsl.js`), with 40k / 100k / 200k particles. Rendering is also WebGPU (`src/gpu/render.wgsl.js`): fluid shadows and self-shadowing from a light-space depth/thickness map, caustics on the floor and objects, a whitewater/foam attribute per particle, in-scattering, and a narrow-range depth filter. It needs desktop Chrome or Edge 113+.
- **`legacy.html` – the first CPU solver with a WebGL2 renderer**, described below.

```
python3 serve.py 8080         # no-cache static server, then open http://localhost:8080
```

## Simulation (`src/sim-worker.js`, runs in a Web Worker)
- **Position Based Fluids** (Macklin & Müller 2013). A density constraint keeps the fluid incompressible, and a tensile-instability term (s_corr) stops particles from clumping.
- **Viscosity:** normalized XSPH with several passes, so the fluid can range from water to honey.
- **Cohesion:** the fluid is allowed some negative pressure, which makes viscous fluids hold together, form strings and drip.
- **Yield stress:** mud and chocolate stop moving when they are slow, so they pile up into heaps.
- **Adhesion and friction against every solid:** walls, boxes, spheres, the ramp, the wave paddle and thrown balls. Fluid is pulled toward surfaces and slides along them more slowly, which lets honey or chocolate coat objects and run down them.
- **Two-way rigid bodies:** balls get pushed by the particles and receive drag from them, so floating, sinking and drag come out of the simulation without extra code.

| Fluid | Viscosity | Adhesion | Friction | Cohesion | Yield |
|---|---|---|---|---|---|
| Water | 0.015 | 0.02 | 0.01 | 0 | 0 |
| Milk | 0.05 | 0.08 | 0.05 | 0.02 | 0 |
| Chocolate | 0.35×2 | 0.35 | 0.30 | 0.08 | 0.6 |
| Honey | 0.55×3 | 0.60 | 0.55 | 0.12 | 0 |
| Mud | 0.40×2 | 0.40 | 0.50 | 0.05 | 2.5 |

## Rendering (`src/shaders.js`, `src/main.js`): screen-space fluid rendering
1. The scene (sky, floor, obstacles, balls, with ball shadows and ambient occlusion) is rendered into an HDR colour target plus a linear-depth target.
2. Particles are drawn as sphere impostors to produce the nearest fluid depth, hidden where scene geometry is in front.
3. Gaussian thickness is added up across particles. Particles with low density (spray) go into a separate foam channel.
4. A depth-aware bilateral filter is applied in separate horizontal and vertical passes, several times, to turn the spheres into a smooth surface.
5. The final pass rebuilds normals from depth, then applies refraction, Beer–Lambert absorption, a scattering body (wrap and back lighting for milk and honey), GGX specular with Schlick Fresnel, sky reflection, procedural surface detail for mud, whitewater and ACES tonemapping.

## Controls
- Drag to orbit, right-drag to pan, use the wheel to zoom.
- **Click** to throw a ball where you aim. Use the sliders to set its size and density, which decides whether it floats or sinks.
- Scenes: dam break, splash, ocean break (wave paddle with a beach ramp and a pier post), pour/coat.
- `P` switches to a particle view, `R` resets, `Space` pauses.

## GPU performance techniques (WebGPU build)
- **Neighbourhood search** (based on Fernández-Fernández et al., *Fast Octree Neighborhood Search for SPH*, SIGGRAPH Asia 2022). The octree in the paper is a CPU design, so these are the parts adapted for the GPU:
  - Particles are sorted into grid cells with a counting sort: count, then a 3-pass prefix scan, then scatter. There's no per-cell limit anymore; the old fixed-size buckets could drop neighbours.
  - Each particle gets **one neighbour list per substep**. Every solver loop reuses it: all density/λ iterations, all position-correction iterations and all viscosity passes. Before, each of those loops searched 27 grid cells again.
  - The three cells next to each other along x are contiguous in the sorted array, so they're scanned as one range. That's 9 ranges per particle instead of 27 cells.
  - **Amortised reordering:** particle data is physically re-sorted by cell once per frame, not every substep, so neighbours sit close together in memory.
- **Adaptivity** (based on the sizing-function idea in Ando, Thürey & Wojtan, *Highly Adaptive Liquid Simulations on Tetrahedral Meshes*, SIGGRAPH 2013). The tetrahedral FLIP solver itself is a different method and isn't ported. Two ideas are borrowed:
  - *Adaptive time steps:* the GPU tracks the fluid's maximum speed (read back asynchronously). Substeps per frame are set so particles move at most about 0.5 h per step, so calm fluid costs 1 step per frame.
  - *Adaptive surface resolution:* fluid depth, thickness and smoothing passes run at a lower resolution ("Fluid resolution" slider, default 75%), and the final shading pass scales them back up.
- The default quality is 10k particles. Presets go from 5k to 200k.

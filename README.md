# Slate

Real-time 3D particle fluid simulation and renderer for games and VFX.

- **`index.html` – WebGPU version (current).** The PBF solver runs in WebGPU compute shaders (`src/gpu/sim.wgsl.js`), with 40k / 100k / 200k particles. Rendering is also WebGPU (`src/gpu/render.wgsl.js`): fluid shadows and self-shadowing from a light-space depth/thickness map, caustics on the floor and objects, a whitewater/foam attribute per particle, in-scattering, and a narrow-range depth filter. It needs desktop Chrome or Edge 113+.
- **`legacy.html` – the first CPU solver with a WebGL2 renderer**, described below.

```
python3 -m http.server 8080   # then open http://localhost:8080
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

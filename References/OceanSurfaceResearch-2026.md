# Frontier Ocean Surface Research — September 2026

## Scope and hard constraints

The target is a large, interactive ocean suitable for a high-end open-world game, while retaining a practical fallback for older GTX-class GPUs. The implementation in this checkout deliberately uses an explicit finite crest-train representation, compact wave packets for local disturbances, and CPU-authored surface-particle effects. It does not use spectral transforms, texture-generated surface effects, or material-generated particle effects.

The design is intentionally not a copy of Unreal's Water plugin. Unreal's public documentation describes a spline-authored Water Body workflow for oceans, lakes, and rivers, a Water Zone that generates camera-visible surface mesh tiles, selectable wave sources including Gerstner waves, and separate buoyancy queries. That is a useful comparison point, but this implementation's primary abstraction is a deterministic ocean solver with a bounded particle pool and explicit disturbance injection.

## Findings from the research

1. **Large water needs more than one representation.** The ocean survey by Darles, Crespin, Ghazanfarpour, and Gonzato separates parametric/spectral deep-water approximations from physically based near-shore methods. The practical implication is to use a cheap open-ocean field for scale and reserve expensive work for the player's interaction zone. [Ocean simulation survey](https://arxiv.org/pdf/1109.6494)

2. **A height surface alone cannot overturn.** Thuerey, Müller-Fischer, Schirm, and Gross detect steep fronts, create connected particle sheets, advect them, and absorb them back into the surface. The solver here adopts the important architectural idea—breaking is a particle event driven by crest compression—without copying their connected-sheet implementation. [Real-time Breaking Waves for Shallow Water Simulations](https://matthias-research.github.io/pages/publications/breakingWaves.pdf)

3. **Hybrid scale separation is a proven performance strategy.** Chentanez and Müller combine shallow-water simulation with particles for phenomena a height field cannot represent, including breaking water, waterfalls, splash, and foam. They report real-time results on contemporary GPUs, with the particle representation kept local to the phenomena that require it. [Real-time Simulation of Large Bodies of Water with Small Scale Details](https://matthias-research.github.io/pages/publications/hfFluid.pdf)

4. **Explicit shallow-water solvers map well to commodity GPUs.** Brodtkorb, Sætra, and Altinakar describe a well-balanced explicit finite-volume method that supports dry states and is suitable for parallel GPU execution. This supports the choice of bounded, explicit updates and a fixed simulation quantum for the local interaction extension. [Efficient Shallow Water Simulations on GPUs](https://brodtkorb.org/files/publications/brodtkorb_kp_on_gpus.pdf)

5. **Lagrangian surface disturbances avoid a full world grid.** Yuksel, House, and Keyser's wave-particle method describes stable wave packets that can interact with floating objects and be converted to a height field. Frontier's compact impulse records follow the same broad motivation, but use a directional, damped packet with a fixed replacement policy and deterministic runtime budget. [Wave particles](https://dl.acm.org/doi/10.1145/1276377.1276501)

6. **2D particle shallow water is a viable interaction layer.** Solenthaler, Bucher, Chentanez, Müller, and Gross formulate particle-based shallow-water equations and discuss uniform spatial lookup and GPU execution. This is relevant to a future near-shore extension; the current first implementation stays smaller and predictable by keeping the open ocean analytic and reserving particles for breakage, spray, and injected disturbances. [SPH Based Shallow Water Simulation](https://matthias-research.github.io/pages/publications/SPHShallow.pdf)

7. **The reference engine separates surface, interaction, and buoyancy concerns.** Epic's Water System documentation describes spline-based body placement, camera-visible water mesh tiles, wave sources, surface queries, and buoyancy as separate concerns. Frontier mirrors the separation at the solver boundary, but keeps the simulation source-of-truth in C++ and sends only authored particle attributes to the renderer. [Unreal Water System](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-system-in-unreal-engine), [Water Body Actors](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-body-actors-in-unreal-engine), [Water Buoyancy Component](https://dev.epicgames.com/documentation/en-us/unreal-engine/water-buoyancy-component-in-unreal-engine)

## Implemented approach

### 1. Explicit Crest Field

Nine finite directional wave trains cover long swell through short detail. Each train evaluates a shaped sinusoidal crest, its spatial derivative, its horizontal orbital velocity, its vertical velocity, and a local compression measure. The field is deterministic and evaluates identically for gameplay queries and surface rendering. The wave count is fixed and small enough for a GTX-class vertex path.

The shaped crest is:

```text
s = sin(phase)
crest = s + 0.12 * s * abs(s)
```

This adds a controllable forward crest without needing a lookup texture or a transform-based spectrum. Surface normals come from the analytic gradient, not a generated normal texture.

### 2. Compact disturbance packets

A boat wake or impact inserts at most a small number of directional, damped radial packets. Packets have an origin, direction, energy, wavelength, travel speed, radius, birth time, and lifetime. The solver caps resident packets and replaces the weakest packet when the cap is reached. This prevents an accumulation attack in a busy city scene.

### 3. Breaking particles are simulation output

Particle births happen only when a crest's compression crosses the configured threshold. Foam particles are surface-adhered and advected by sampled surface velocity. Spray particles are ballistic, receive gravity and drag, and can convert back into surface foam when they meet the water. Position, lifetime, radius, tint, and alpha are authored in C++.

The renderer shaders added beside the solver are attribute-only: one evaluates the finite crest field for the water surface, while the particle draw shader expands already-simulated records into camera-facing quads. No particle is classified, spawned, aged, or patterned by a shader.

### 4. GTX budget

The default profile uses:

- 9 crest trains;
- a 60 Hz fixed simulation quantum with four-step catch-up cap;
- 32,768 maximum surface/spray particle records;
- 32 resident disturbance packets;
- a 140 m particle interest radius around the camera or gameplay focus;
- a pre-sized particle pool, so normal simulation updates do not allocate memory.

The particle count, interest radius, crest threshold, and fixed step are configuration fields, so a GTX 1060-class target can use 16,384 particles and a stronger card can use 65,536 without changing the solver contract.

## Validation notes

The C++ translation unit is self-contained and compiles with:

```bash
g++ -std=c++20 -Wall -Wextra -Wpedantic -IEngine \
    -c Engine/VolumetricDynamics/OceanSurfaceSolver.cpp
```

The existing checkout's larger Project-Zero CMake source list references several engine directories that are not present in the checkout, so the ocean solver is intentionally standalone and does not pretend that the unrelated baseline is currently a clean full-project build.

A reproducible visual capture is in `Scratchpad/OceanCapture.cpp`. It runs the real solver, injects a wake and an impact, and writes the three PNG diagnostics in `Diagnostics/`. The contact sheet is `Diagnostics/Ocean_TestContactSheet.png`.

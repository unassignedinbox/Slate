# Experimental — software-traced SurfelGI

This directory is an **experimental, opt-in port** of the surfel-GI pipeline published by [W298/SurfelGI](https://github.com/W298/SurfelGI), commit `8361942f7d799632b32d37356b8057814456a8a2` (MIT).  The original implementation is a Falcor / DirectX Raytracing render pass and explicitly requires Shader Model 6.5 plus DXR Tier 1.1.  Those requirements exclude GTX 10-series and GTX 16-series GPUs.

This port preserves the original system and reference defaults:

- a camera-relative `250³` cell lattice (`0.05 m` cells),
- up to `150,000` persistent surfels,
- 125-cell surfel binning, recycling / sleeping / last-seen policy,
- projected-area surfel radii and coverage-based spawning/removal,
- per-surfel adaptive 4–64 ray allocation with a `9,600,000` ray-result budget,
- surfel-radiance path termination, depth moments, irradiance sharing, and
- the Multi-Scale Mean Estimator (MSME) used to stabilize indirect radiance.

The one deliberate backend replacement is ray dispatch: `Shaders/SurfelTraceCwbvh.comp.glsl` uses Slate's existing software CWBVH traversal (`Engine/Shaders/TraversalCWBVH.slang`) from an ordinary Vulkan compute shader.  It does **not** use a Vulkan ray-tracing extension, acceleration-structure object, ray-query, or a hardware RT core.  Therefore the required GPU capability is ordinary Vulkan 1.2 compute + storage buffers/images, which is available on Pascal and Turing-without-RT hardware such as GTX 1060 and GTX 1650 Super (with current vendor drivers).

## Status and scope

This is intentionally under `Experimental/`: it is a complete pass set plus a host-side frame/resource contract, not yet a replacement for Project-Zero's production ReSTIR path.  Keeping it isolated makes the initial implementation reviewable and lets the next step optimize / integrate it without silently changing the shipped renderer.

| Part | Location | Purpose |
|---|---|---|
| Reference settings, memory accounting, frame state machine | `SurfelGI.h`, `SurfelGI.cpp` | CPU-side contract, independently testable |
| ABI / shared utilities | `Shaders/SurfelTypes.glsl` | GPU structs, RNG, cells, coverage, MSME |
| Persistent surfel lifecycle | `Shaders/SurfelPrepare.comp.glsl`, `SurfelCollectCells.comp.glsl`, `SurfelPrefixCells.comp.glsl`, `SurfelScatterCells.comp.glsl` | prepare → update → bin surfels |
| GI estimate | `Shaders/SurfelTraceCwbvh.comp.glsl`, `SurfelIntegrate.comp.glsl` | software traversal, direct light, surfel reuse, MSME |
| Camera-surface gather + spawning | `Shaders/SurfelGenerateEvaluate.comp.glsl` | visibility-buffer evaluation and surfel creation |
| Vulkan sequence / descriptors / barriers | `VulkanIntegration.md` | exact host integration recipe |
| Upstream pass-by-pass correspondence | `Parity.md` | preserved stages and explicit backend substitutions |
| Standalone contract tests | `Tests/SurfelGIHostTests.cpp` | no Vulkan SDK or GPU required |

## Build the host contract test

The CPU contract has no engine or SDK dependencies:

```bash
g++ -std=c++20 -Wall -Wextra -Werror \
  Experimental/SurfelGI/SurfelGI.cpp \
  Experimental/SurfelGI/Tests/SurfelGIHostTests.cpp \
  -IExperimental/SurfelGI -o /tmp/surfel-gi-contract && /tmp/surfel-gi-contract
```

The root `CMakeLists.txt` also has an opt-in `FRONTIER_BUILD_EXPERIMENTAL_SURFEL_GI` target.  It is `OFF` by default so this first-pass experiment cannot alter the production renderer's build or runtime.

## First-pass policy: reference profile, no hidden optimisation

`Settings::Reference()` uses the published values unchanged.  In particular, this branch does **not** shrink the surfel count, ray budget, cell field, or path depth to claim Pascal support.  `EstimateMemory()` exposes the cost before allocation; reserve the reported working-set estimate plus Slate's scene / render-target memory.  The reference profile is sizeable but viable on 4 GB cards for compact scenes; a 3 GB GTX 1060 must be checked against the scene's residency and driver budget before enabling it.

The later optimisation pass can add an explicitly named Pascal profile, dynamic ray budgets, compact bins, half precision, or temporal scheduling.  None of those optimisations are baked into this implementation.

## Attribution

`NOTICE.md` and `LICENSE-W298.txt` carry the upstream attribution and MIT license.  The port is not affiliated with the upstream author.

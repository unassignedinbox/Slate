# CPU mirror — ShaderBall SurfelGI convergence

These are the requested five ShaderBall renders from `Tools/RenderShaderBallSurfelMirror.cpp`, a CPU execution mirror of the **portable Vulkan SurfelGI pass logic** in this directory.

| Capture | Cache frame | Active surfels after generation | Streamed surfel rays in that frame |
|---|---:|---:|---:|
| `ShaderBall_SurfelMirror_F001.png` | 1 | 57 | 0 |
| `ShaderBall_SurfelMirror_F004.png` | 4 | 221 | 2,593 |
| `ShaderBall_SurfelMirror_F008.png` | 8 | 468 | 7,486 |
| `ShaderBall_SurfelMirror_F012.png` | 12 | 704 | 13,746 |
| `ShaderBall_SurfelMirror_F016.png` | 16 | 912 | 20,465 |

The five main PNGs are final linear-HDR composites: ordinary direct lighting plus the surfel cache's `IndirectImage`, matching the integration point in `VulkanIntegration.md`. Consequently, the direct component remains sharp; **the GI component is surfel-based**, not a primary camera ray trace.

`Indirect/` holds that raw surfel `IndirectImage` alone, before composition.  It starts black at F001 because no surfel has yet completed a trace/integration cycle, then visibly fills in as the persistent surfel cache populates. This is the diagnostic answer to “where are the surfels?”

The implementation keeps the Vulkan structural reference settings: 150,000 surfel capacity, 9,600,000 ray budget, 250³ / 5 cm cell lattice, 125-cell binning, 4–64 adaptive ray rule, six bounces, depth moments, irradiance sharing, and MSME.  CPU ray-result records are streamed instead of reserving a 9.6M host vector, which changes storage strategy only, not the per-ray/pass math.

The captures set the **runtime** blending-delay uniform to 12 frames rather than the interactive shader default of 240 so a 16-frame preview makes cache convergence visible. This is a documented runtime diagnostic setting, not an algorithm or budget reduction.

Recreate all ten images:

```bash
g++ -std=c++20 -O3 -Wall -Wextra -Werror -pedantic \
  Experimental/SurfelGI/Tools/RenderShaderBallSurfelMirror.cpp \
  -o /tmp/render-shaderball-surfel-mirror
/tmp/render-shaderball-surfel-mirror /tmp/surfel-mirror
```

The renderer writes five composite and five raw-indirect binary PPM files. The checked-in PNGs are 800×600 Lanczos upscales of the 320×240 cache-resolution diagnostic render.

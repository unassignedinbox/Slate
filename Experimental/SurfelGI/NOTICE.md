# Third-party notice — W298/SurfelGI

This experimental implementation is a Vulkan/GLSL port of the surfel global-illumination algorithm and pass ordering in:

- **Project:** https://github.com/W298/SurfelGI
- **Revision inspected:** `8361942f7d799632b32d37356b8057814456a8a2`
- **Copyright:** Copyright (c) 2024 W298
- **License:** MIT; reproduced in `LICENSE-W298.txt`

The upstream project is implemented with Falcor and requires Shader Model 6.5 / DXR Tier 1.1.  This directory does not copy the Falcor framework or its runtime code.  It re-expresses the published surfel lifecycle in GLSL and replaces upstream `TraceRay()` calls with Slate's pre-existing CWBVH software traversal, so it can run on non-RTX Vulkan compute hardware.

Slate's own `Engine/Shaders/TraversalCWBVH.slang` is included by the experimental trace shader and remains governed by Slate's existing licensing and attribution.

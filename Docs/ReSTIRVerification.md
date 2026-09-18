# ReSTIR verification audit

**Audit date:** 2026-09-19

**Scope:** the Project-Zero ReSTIR DI path, its first-bounce NEE reuse pool, temporal accumulation, spatial reuse, and the shipped à-trous filter.

## Verdict

**Do not describe the current renderer as production-ready or performance-optimized.**

The source has the core DI reservoir machinery, bounded screen-space reuse, current-receiver visibility tests, and a useful CPU mirror. This audit also corrected two production-path correctness defects:

1. `kFeatureTemporalIdentity` existed in the shader but the supported host dispatch could not set it. The runtime now defaults identity validation on and sends `DispatchFeatureTemporalIdentity` (bit 9) to the shader.
2. A DI history reservoir that was found occluded retained a non-zero `M` with `W = 0`. Merging it added denominator mass with no contribution, biasing the next estimate dark. Direct temporal and spatial reuse now reject zero-`W`/not-visible reservoirs before they can donate `M`. The CPU mirror follows the same temporal visibility ordering and eligibility rule.

This is a **source, CPU-mirror, and shader-lowering audit**, not a native GPU performance result. No SPIR-V execution on a Vulkan device, GPU timestamps, occupancy measurement, bandwidth capture, image-comparison run of Project-Zero, or end-to-end native startup was available in this environment. No Vulkan package, driver, software ICD, or external dependency was downloaded or installed.

## Evidence classes

| Class | What was checked | What it can establish | What it cannot establish |
|---|---|---|---|
| Source/ABI audit | `ReSTIRViewport.slang`, `ReSTIRIntegrator`, visibility raster/resolve, `SwapchainExchange`, and `AtrousDenoise.slang` | Dispatch intent, formulas, eligibility gates, buffer lifetime, barriers, and shader/host record agreement | Executed GPU behavior or timing |
| Shader lowering | `glslang -V --target-env vulkan1.2` | Both modified compute shaders parse and lower to SPIR-V | Driver acceptance, pipeline creation, and device results |
| CPU mirror | `Projects/Project-Zero/Host/MaterialLevelViewport.cpp` and the material gates | Deterministic estimator/control behavior without a GPU | Bit-for-bit equivalence with the full Vulkan renderer |
| Native Vulkan execution | Not available locally | — | Hardware correctness, image quality, memory pressure, and performance |

## Verification matrix

| Area | Evidence and result | Status |
|---|---|---|
| Motion-vector production | `VisibilityRaster.vert.slang` transforms current geometry with `Instance.World` and prior geometry with `Instance.PreviousWorld`; it emits unjittered current/previous clip positions. `VisibilityRaster.frag.slang` stores `CurrentUv - PreviousUv`. `VisibilityExchange::WriteFrameConstants` supplies the previous view-projection and deliberately uses the current matrix on the first frame. | **Source-verified** |
| Temporal reprojection validity | The accumulator, DI pool, and first-bounce NEE pool back-project with `currentUv - MotionImage`, bounds-check the prior pixel, validate normal/depth, and protect against render-width changes. Object identity is now enabled by default for all three consumers. Disocclusions reset per pixel. | **Source-verified; native execution pending** |
| DI reservoir math | Initial candidates use explicit light-selection, area, sun-disc, and coin probabilities. `ResampleCandidate` tracks weighted candidates, and `W = WeightSum / (M * pHat(selected))` is explicit. Temporal/spatial transfers re-evaluate `PHatSelected` at the receiving surface and cap inherited `M` at 20 times the receiver's pre-merge `M`. | **Source-verified; statistical GPU validation pending** |
| Occlusion contribution | Direct DI re-traces the selected sample at the current receiver after temporal reuse and again after spatial reuse. First-bounce NEE reuse re-traces at the current first-bounce vertex. The direct history fix prevents an occluded result from contaminating later `M`. | **Corrected and source-verified** |
| Spatial reuse | Reuse reads a stable previous-frame pool, never a same-dispatch neighbour. Taps use a per-frame rotated, radius-jittered 4–16 px cross and are limited to `SpatialTapCount`, with a shader ceiling of four. Normal/depth, stride, non-zero proposal, and optional material/object tests gate every tap. | **Source-verified** |
| Spatial compatibility defaults | Material/roughness and object-identity spatial gates are implemented but default **off**, retaining normal/depth-only behavior. This is appropriate for controlled A/B work, but content that needs strict material or object boundaries must opt in; the present default should not be advertised as universally artifact-safe. | **Known limitation** |
| Temporal object identity | History identity is an object portion of the packed visibility identity, not a triangle ordinal. This avoids false restarts from raster/jitter changes on the same tessellated object. The host omission that left shader bit 9 unreachable has been fixed. | **Corrected; CPU/GPU regression rerun pending** |
| World-space and stochastic behavior | Reservoir samples are world-space points on emitters. At a receiving primary or first-bounce surface the target is re-evaluated against that point, and visibility is re-traced. Random tap orientation/radius is seeded by pixel and frame. This is screen-space donor selection, not world-space secondary-vertex reuse with stochastic path shifts. | **Accurately scoped** |
| GI claim | `GiPoolShade` only reuses the first-bounce vertex's **next-event-estimation light-sampling stratum**. It does not perform full ReSTIR GI path reuse, path replay, reconnection/shift mapping, or arbitrary multi-bounce path reuse. Glass, SSS, and unsuitable vertices fall back to the non-pool path. | **Must be described as first-bounce NEE reuse, not general ReSTIR GI** |
| SVGF/denoiser coupling | Raw linear mean/moments and filtered colour history are distinct. Reprojection validates normal/depth/identity, variance is variance of the temporal mean, and the à-trous chain uses normal/depth/luminance edge stops plus a derived convergence early-out. The first wavelet result is the filtered temporal colour feedback. | **Source-verified** |
| Denoiser limitations | There is no diffuse-albedo demodulation/re-modulation split and no dedicated specular history/filter path. Therefore it is SVGF-style rather than a complete material-aware SVGF implementation; glossy/specular stability remains a native-image-quality question. | **Known limitation** |
| Reservoir lifetime/barriers | Direct and GI reservoirs are double-buffered. Descriptor sets bind `CurrentSlot ^ 1` as prior and `CurrentSlot` as current. The command stream zero-initializes buffers once and inserts shader-write → shader-read/write barriers before later-frame reuse. Temporal history uses distinct prior/current image bindings. | **Source-verified; validation-layer run pending** |
| Performance evidence | The tier ladder exposes candidate, extra-candidate, spatial-tap, and denoise-level budgets. The filter uses 8×8 groups, a five-level maximum, and a per-pixel early-out. These are implementation choices, not performance evidence. The four 64-B/pixel reservoir buffers (two DI plus two GI) alone consume about 506 MiB at 1920×1080 before images and scene buffers; GI buffers are allocated even when the GI-reuse feature is off. | **Not measured; not optimized claim** |

## CPU and lowering evidence

The following checks were completed without downloading or installing dependencies:

- The pre-correction CPU soak gate completed: `bash Exhibits/Workbench/Materials/CheckRestirSoak.sh fast` ran 250 frames at 128×72, 4 candidates, and 2 spatial taps. It reported zero non-finite/out-of-range samples; mean `M` remained about 60 (maximum 84); and its independent-stream error moved from 7651.29 at frame 62 to 7334.12 at frame 250. This is a **CPU-mirror stability result**, not GPU timing or native-image evidence.
- The modified `ReSTIRViewport.slang` lowered successfully with `glslang` to a 394652-byte Vulkan 1.2 SPIR-V module.
- `AtrousDenoise.slang` lowered successfully with `glslang` to a 13892-byte Vulkan 1.2 SPIR-V module.
- Shell syntax and whitespace checks passed for the modified ReSTIR gates.

The CPU mirror's full rerun after the correction is currently blocked because its Make target requires Vulkan-Headers through `SwapchainExchange.h`, and no allowed local header source is seated. The new gate pins the visibility eligibility rule structurally, but that does **not** replace a rerun. No header/package was acquired to bypass this limitation.

## Correctness notes

### Temporal identity and motion

The prior renderer produced motion from both previous camera matrices and `Instance.PreviousWorld`, so it covers camera and object transform movement at the raster stage. The reservoir and accumulation consumers reconstruct the previous pixel as `currentUv - motion`, reject off-screen coordinates, then apply normal/depth checks. The additional object identity is necessary for coplanar or similarly oriented/deep objects that exchange screen locations; normal/depth alone cannot distinguish them.

The identity feature is deliberately still a feature bit, so an A/B can disable it, but it is no longer unreachable in the normal host configuration. Changing the identity policy resets accumulation because it changes which history can contribute.

### Reservoir estimator and visibility

The implementation uses the usual RIS form for its selected direct-light sample: a sum of candidate weights, selected candidate target, sample count, and `W`. Merging transfers a donor sample only after evaluating its target at the receiver. The reservoir `M` cap bounds temporal and spatial influence, while the spatial history split ensures post-spatial `M` does not compound into the next temporal frame.

A zero-weight occluded direct reservoir is different from a valid, visible proposal: it has no estimator contribution at the next receiver. Retaining its `M` for a debug display is harmless only if it is excluded from future merge denominators. The source and CPU mirror now enforce that rule.

### GI scope

The indirect pool reuses a sampled emitter point at the first diffuse/opaque bounce and then tests visibility at the current vertex. That can reduce noise for that NEE stratum, but it is not a general solution to multi-bounce ReSTIR GI. In particular, it has no path-space shift mapping/replay and should not be presented as one.

## What is required before a production or optimization claim

1. Build and run the native Project-Zero Vulkan path with validation layers and the current sources.
2. Repeat temporal-identity, occlusion-history, spatial-material/object, dynamic-light, camera-motion, and dynamic-geometry A/Bs against a high-sample reference using captured GPU output.
3. Obtain GPU timestamp spans for visibility, ReSTIR kernel, each denoise level, blit/present, and total frame time; capture frame-time percentiles over representative game content.
4. Capture GPU memory/bandwidth/occupancy information and compare DI-only, GI-pool-off, and GI-pool-on configurations at target resolutions.
5. Test the denoiser on diffuse, glossy, metallic, transmission, SSS, high-contrast emissive, and disocclusion cases. Decide whether albedo demodulation and a dedicated specular path are needed for the content bar.
6. Establish content policy for the spatial material/object gates, then choose safe defaults rather than relying on normal/depth compatibility alone.

Until those items are complete, the accurate statement is: **the implementation has source-audited ReSTIR DI and first-bounce NEE reuse with bounded screen-space reuse, but lacks native correctness and performance evidence required for production readiness.**

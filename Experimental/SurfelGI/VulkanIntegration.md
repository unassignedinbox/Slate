# Software SurfelGI — Vulkan integration contract

This document is the host-side contract for the shaders in `Shaders/`.  It is deliberately explicit so the experiment can be wired into `SwapchainExchange` later without a hidden DXR path.

## Required device features

Require only the following core capabilities:

- Vulkan **1.2** (Vulkan 1.1 is sufficient if the host supplies the same descriptor / storage-image functionality),
- a graphics+compute queue, `shaderStorageImageReadWithoutFormat`, `shaderStorageImageWriteWithoutFormat`,
- `VK_BUFFER_USAGE_STORAGE_BUFFER_BIT` and `VK_IMAGE_USAGE_STORAGE_BIT`, and
- 32-bit integer atomics in storage buffers (core compute functionality).

Do **not** enable or test for `VK_KHR_acceleration_structure`, `VK_KHR_ray_query`, `VK_KHR_ray_tracing_pipeline`, buffer device address, shader float atomics, mesh shaders, subgroup operations, or descriptor indexing.  The CWBVH node and leaf buffers are conventional `std430` SSBOs.  This is what keeps the implementation usable on GTX 1060 / GTX 1650 Super class hardware.

## Persistent resources

Allocate all persistent resources device-local, with storage-buffer usage.  The reference profile's entry count and ABI are defined by `Settings::Reference()` and `SurfelTypes.glsl`.

| Resource | GLSL ABI | Reference count |
|---|---:|---:|
| `SurfelBuffer` | `Surfel`, 128 B | 150,000 |
| `GeometryBuffer` | `uint` | 150,000 |
| `ValidIndices`, `DirtyIndices`, `FreeIndices` | `uint` | 150,000 each |
| `CellInfos` | `CellInfo`, 8 B | 15,625,000 |
| `CellToSurfel` | `uint` | 18,750,000 |
| `RayResults` | `RayResult`, 48 B | 9,600,000 |
| `RefCounts` | `uint` | 150,000 |
| `CellReservations` | `uint` | 15,625,000 |
| `Counters` | `uint[6]` | 1 |
| `SurfelDepthMoments` | `VK_FORMAT_R32G32_SFLOAT`, 3840 × 2160 | 1 |
| `IndirectImage` | `VK_FORMAT_R32G32B32A32_SFLOAT` while prototyping | render extent |

Initialize `FreeIndices[i] = i`, `Counters = { 0, 0, 150000, 0, 0, 0 }`, and clear the two storage images.  `Runtime::EstimateMemory()` reports **about 809 MiB** for these resources alone.  Add the scene CWBVH, vertex/index/material buffers, G-buffer, swapchain, and an allowance for Vulkan driver allocations before deciding that a 3 GB device has enough free memory.

`GeometryBuffer` stores Slate's packed visibility identifier for a spawned surfel.  It is reserved now so later dynamic-geometry work can re-resolve a surfel exactly as the upstream pass does.

## Per-frame sequence

The pass order is not optional.  Put a compute-to-compute barrier after every stage that writes data read by the next stage:

```text
Visibility front end (Slate cull → raster → HiZ → SurfaceResolve)
  → Prepare
  → copy ValidIndices to DirtyIndices
  → CollectCells
  → PrefixCells
  → ScatterCells
  → TraceSoftwareCwbvh
  → Integrate
  → GenerateAndEvaluate
  → composite IndirectImage with the direct-light result / tone map
```

A suitable barrier between stages uses:

```cpp
VkMemoryBarrier barrier{ VK_STRUCTURE_TYPE_MEMORY_BARRIER };
barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
vkCmdPipelineBarrier(command,
    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
    0, 1, &barrier, 0, nullptr, 0, nullptr);
```

The copy from `ValidIndices` to `DirtyIndices` is `vkCmdCopyBuffer`, followed by a transfer-write → compute-read barrier.  It must occur after `Prepare` and before `CollectCells`.

Dispatch counts:

| Shader | Dispatch |
|---|---|
| `SurfelPrepare.comp.glsl` | `1, 1, 1` |
| `SurfelCollectCells.comp.glsl` | `ceil(150000 / 64), 1, 1` |
| `SurfelPrefixCells.comp.glsl` | `ceil(15625000 / 128), 1, 1` |
| `SurfelScatterCells.comp.glsl` | `ceil(validSurfelCount / 64), 1, 1` (may dispatch full reference limit safely) |
| `SurfelTraceCwbvh.comp.glsl` | `ceil(9600000 / 64), 1, 1` (the counter bounds actual work) |
| `SurfelIntegrate.comp.glsl` | `ceil(150000 / 64), 1, 1` |
| `SurfelGenerateEvaluate.comp.glsl` | `ceil(renderWidth / 16), ceil(renderHeight / 16), 1` |

The deliberately full ray dispatch matches the upstream fixed ray-result budget.  Do not replace it with a reduced budget in this first-pass reference implementation.

## Descriptor sets

Every pass uses `set = 0`; create one descriptor-set layout per shader because the bindings intentionally differ.  The shader declaration is the source of truth.  The common Slate scene inputs for `SurfelTraceCwbvh` are:

| Binding | Resource |
|---:|---|
| 7 / 8 | Slate CWBVH node / leaf SSBOs from `TraversalIndex` |
| 9 | Slate flat `TriangleIndex` SSBO |
| 10 | material header SSBO (base colour + emissive are read) |
| 11 | luminaire SSBO |

`SurfelGenerateEvaluate` consumes the existing `SurfaceResolve` outputs:

| Binding | Resource |
|---:|---|
| 9 | `SurfaceImage` (`rgba32f`, xyz world position, w packed visibility) |
| 10 | `NormalImage` (`rgba16f`) |
| 13 | resolved depth image sampled as `sampler2D` |

Push constants are declared in each pass.  Their sizes are below Vulkan's 128-byte minimum guarantee.

## Shader lowering

These are GLSL 460 files, not Slang despite Slate's legacy `.slang` extension.  Compile them directly from the source directory so the CWBVH include resolves:

```bash
glslc --target-env=vulkan1.2 -fshader-stage=compute \
  -I. -IEngine -IExperimental/SurfelGI/Shaders \
  Experimental/SurfelGI/Shaders/SurfelTraceCwbvh.comp.glsl \
  -o Experimental/SurfelGI/Shaders/SurfelTraceCwbvh.spv
```

The trace shader includes `Engine/Shaders/TraversalCWBVH.slang` directly.  Do not stage/copy the source to a temporary folder before preprocessing unless the host rewrites that relative include.

## Camera motion and resets

The surfel cache is camera-relative.  A position/orientation change does **not** require a hard reset: the collect pass updates the cache life and screen-driven spawning/recycling converges the field.  Reset only when the scene topology/material residency changes, when `Settings` changes, or when a hard render-size / camera-space policy change invalidates all moment history.  Clear the surfel, counters, moments, and guiding state together.

## Presentation

`IndirectImage` is linear HDR indirect illumination.  The first integration should add it to the renderer's direct-light HDR result before its existing tone mapper; do not tone-map the pass independently.  The reference shader intentionally emits indirect-only radiance so it can be inspected before replacing Project-Zero's current one-bounce GI path.

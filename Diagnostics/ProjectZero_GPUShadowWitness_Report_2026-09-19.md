# GPU Shadow Witness — 2026-09-19 (session arena/01a0bbb8-slate)

**One-line:** the app now interrogates its own GPU at startup: known rays whose occlusion the CPU has already
decided are re-answered by the device's own `TraceShadow`, the traversal blobs and push constants are echoed
back byte-for-byte, and the lighting path tallies per-type shadow-ray counters — so the next Windows run's log
*locates* the no-shadow bug instead of describing it a fourth time.

Baseline this session started from: `e603a9a` (= `d425de2` tree) of `SultanAladin/Frontier-` branch
`arena/01a0b62f-frontier`, imported byte-identical into this branch's first commit.

---

## 1. Why the evidence so far could never catch this bug

Every shadow proof in the tree runs in the **CPU mirror** (`MaterialLevelViewport`) or C++ harnesses — which are
re-implementations, not the SPIR-V the GPU executes. In the live app, primary visibility comes from the **R2
raster** ("no primary rays"), so a broken compute-side traversal produces exactly the reported symptom set:
the scene renders and shades, and *no light casts a shadow* (sun, panels, emissive rows, spots, moon) while GI
degenerates to flat ambient fill. The Cornell-box era worked because it walked the single-blob path
(`TlasInstanceCount == 0`); the Showcase era walks the D6/D7 two-level arm (499 instances) — the arm the mirror
never executes on a device.

## 2. Real bug found and fixed in review (UB)

`SwapchainExchange::UploadTraversal` destroyed the four TLAS buffers and freed their memory, **nulled only the
single-blob pair**, then called `WriteDescriptorSet()` — which (comment-instructed) wrote bindings 27–30 because
the handles were still non-null → **descriptor writes of destroyed buffers**, and `UploadInstanceTraversal`'s
re-upload began with `vkDestroyBuffer(dangling)` → **double destroy / double free**. Both undefined behaviour,
either capable of a driver recycling the handle into an unrelated live object. Fixed: the four TLAS handles and
memories are nulled in place. (`SwapchainExchange.cpp`, the `UploadTraversal` block.)

## 3. The Shadow Probe (binding 31) — `Engine/DeviceExchange/ShadowProbeRecord.h`

One host-visible page (1 KiB), mirrored layout host ↔ kernel:

| Section | Words | What the GPU answers |
|---|---|---|
| Input rays | 8–71 | host-composed world rays (scene-centre down, escape-up, lateral-out, ground→highest-triangle, truncated-before-surface, diagonal) with CPU verdicts |
| Ray answers | 72–103 | per-ray `{blocked, closestT, closestPrim, valid}` through the **same `TraceShadow`** the lighting uses (opaque + two-level arms) |
| Push echo | 104–119 | the push constants *as the kernel reads them* — offset drift shows as one wrong number |
| Blob echo | 120–187 | CWBVH node/leaf heads, TLAS root, instance row 0 — byte-compared against the host's uploads |
| Counters | 188–219 | candidates / selections / shadow rays / blocked, split sun↔mesh, plus R11 spatial-late rejects |

Feature bits 10/11 (`DispatchFeatureShadowProbe` / `…ShadowCounters`) ride the integrator's new
`AssignDebugFeatureFlags`. The kernel probe self-disarms via the magic word; GameExecution reads back two
presented frames later (that frame's fence is then waited) and logs every comparison plus one **VERDICT** line:

- `GPU traversal VERIFIED` + "N shadow rays, 0 blocked" → the walker is fine; suspicion moves to light
  selection/energy — a *different* fix.
- `TRAVERSAL DATA CORRUPT ON DEVICE` → descriptor/stride/lifetime class (§2 class).
- `GPU TRAVERSAL DIVERGES with byte-identical blobs` → driver-level walker divergence (NaN/layout).
- 240 frames unanswered → the probe block never ran (stale pipeline) — also logged.

Texture table moved 31 → 32 (variable-count binding must stay the set's last); `kComputeBindingCount` 32 → 33;
pool sizes, layout and the static-assert census updated in the same table they have always been derived from.

## 4. Overhead

Disarmed (steady state): one magic-word comparison at invocation (0,0) + one uniform read per counter site.
The counters are disarmed by GameExecution the moment the page completes (or after 240 frames at the latest).

## 5. Verification this sandbox can do

| Check | Result |
|---|---|
| `SwapchainExchange.cpp` syntax (Vulkan + GLFW + imgui-patched + thorvg headers) | ✅ clean |
| `GameExecution.cpp` syntax (full include chain) | ✅ clean |
| Probe layout/verdict harness (C++ unit) | ✅ all green |
| Probe shader code through the Slang 2026.12 compiler (dialect-faithful TU) | ✅ compiles |
| CheckBuildSourceList / CheckShaderTableParity | ✅ GREEN |
| CheckShowcaseLevel / CheckTelemetryProbe / CheckPerformanceTelemetry / CheckCelestialContent / CheckCelestialShadow | ✅ GREEN |
| CheckShaders | ⏭ skipped here (no slangc/glslc) — runs on your machine |

## 6. What to send back

Run once (Standard tier is fine, any hour), close normally, and upload `ProjectZero_TelemetryReport.md` /
stdout log: the `[ShadowProbe]` lines (armed / per-ray / echoes / push echo / counters / VERDICT) + the
`[SwapchainExchange] Instances:` line. That single log now decides which of the three fixes to write next —
blob lifetime, walker numerics, or reservoir/exposure downstream of a healthy walker.

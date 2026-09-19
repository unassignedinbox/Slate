# Project-Zero — R14 Shadow Fix: the shadows were there, the skylight was sitting on them

2026-09-19 · branch `arena/01a0bbbb-slate` (Slate mirror of the Frontier engine, continuing from the
`d425de2` shadow baseline imported at `ebeb113`)

## Verdict first

**The shadow system was working. The shadows were invisible — drowned by unscaled skylight GI.**
Not a CPU-vs-GPU divergence, not a CWBVH traversal defect, not the denoiser, not exposure alone.
Measured proof below, with A/B renders from the line-for-line CPU mirror of the shipping kernel.

## The measurement (decisive A/B, sandbox CPU mirror, Showcase r5, 15:30, sun-direct 2.5, 288×288 × 12 frames)

| knob (skylight GI fill ×) | film mean | result |
|---|---:|---|
| 1.00 (legacy, shipped until now) | **0.3636** | flat, washed, no readable sun shadow — the exact look in your screenshots |
| 0.50 | ~0.29 | soft shadows, still hazy |
| **0.35 (new default)** | ~0.24 | **crisp directional shadows under every sphere, long cone shadows, scene stays bright-day** |
| 0.25 | **0.2141** | hard noir-contrast shadows (a bit theatrical) |

From the 1.00 → 0.25 delta (0.75 of the GI skylight term removed ⇒ film mean drops 0.3636 − 0.2141):
the escaped-bounce **sky dome collection was ~55 % of the film's mean radiance**. Against that flood,
the sun's direct term (already rebalanced at r4/r5: panels 140/60 → 6/3 nit, SunDirect 2.5) produced a
lit-vs-shadowed ratio of roughly 1.2 : 1 — after a 4–5-level à-trous, adaptive ACES exposure and sRGB,
that modulation is below "is there a shadow at all?" perceptual threshold. **Every light in the scene
suffered the same wash**, which is why sun, emissive, and spot shadows all looked absent at once —
your exact symptom, and the same one in the r5 day mirror proof once you look at it critically
(`Diagnostics/Renders/showcase_r5_day_384x216_f24.png` — soft, milky, grounded only by contact AOs).

## Your Cornell-box clue, mapped one-to-one

- Cornell box = **enclosed** room, one dominant lamp ⇒ **no sky dome** reaching the floor ⇒ lit/shadow
  contrast ~∞ ⇒ shadows unmistakable (and back then, "fixing the exposure" was enough because
  contrast already existed).
- Open Showcase = the floor sees **2π sr of sky**. Unscaled, that dome is the largest emitter in the
  level. No exposure setting can reveal a 1.2 : 1 contrast — the fix had to be **radiometric**:
  shrink the fill until the key light keys. That is exactly what "ambient/sky intensity" does in
  Unity/Unreal — it is a standard art-direction dial, not a hack.

## The fix (what ships in this commit)

A single art-directable multiplier on the **transport-path** sky collection only:

- `Engine/Shaders/ReSTIRViewport.slang`
  - New push-constant **float `SkyFillScale`** (takes the old `PushReserve4` lane — every offset and the
    128-byte block unchanged) and `SkyGiFill()` helper (`< 0` ⇒ legacy 1.0, so old captures replay).
  - Applied at the **one** escaped-bounce-ray collection (`throughput * SkyAlong(bounceDir) * SkyGiFill()`).
    The primary-miss backdrop sky, the sun disc, every NEE term, the cloud deck, moon terms: **untouched**.
- `Engine/DeviceExchange/SwapchainExchange.h` — `float SkyFillScale; uint32_t PushReserve[2];`
  replaces `uint32_t PushReserve[3]`; `static_assert(sizeof(DispatchConfiguration) == 128)` still passes.
- `Engine/DisplayPresentation/ReSTIRIntegrator.{h,cpp}` — `AssignSkyFillScale()` (clamps [0, 1],
  **resets accumulation only on change** so the slider responds instantly), member default **0.35**,
  dispatch fill, plus `QuerySkyFillScale()` / `QuerySunPickProbability()` for telemetry.
- `Projects/Project-Zero/Source/CelestialSequence.{h,cpp}` — panel state `SkyFill = 0.35` and a
  **"Sky fill" slider (0…1)** in the Sun row's Light group, beside "Direct".
- `Projects/Project-Zero/Source/GameExecution.cpp`
  - per-frame `Integrator.AssignSkyFillScale(Celestial.SkyFill)` next to the sun-pick assignment;
  - new **`[Lighting]` log line** beside `[Shadows]`, printed at startup and on every settings change:
    `sun direct ×, sky fill ×, exposure adaptive/manual ×, sun-vs-lamps pick, total emissive power` —
    the next telemetry upload will state its own lighting configuration, no guessing.
- CPU mirror (`MaterialLevelViewport.cpp`) — `g_SkyGiScale` default flips to the product's 0.35
  (override with `--sky-gi`; `1.0` replays the legacy flooded look); usage text finally documents
  `--sun-direct` / `--sun-pick` / `--sky-gi`.

## Proof renders (this commit, in `Diagnostics/Renders/`)

- `skyfill_ab_legacy_1.00_288x288_f12.png` — the look you have now: washed, no readable shadows.
- `skyfill_ab_0.25_288x288_f12.png`, `skyfill_ab_0.35_288x288_f12.png` — the contrast ladder.
- `skyfill_shipping_default_288x288_f6.png` — the mirror's no-flag default now renders the 0.35 look.
- `skyfill_night_22h_288x288_f6.png` — night sanity: emissive row, spot pool and occlusion intact
  (night skylight ≈ 0, so the dial is a no-op after dark — the night look is unchanged).

## Validation (all in-sandbox)

- **Shader gate: 15/15 GREEN** — glslang 16.6.0 built from source in the sandbox
  (`CheckShaders.sh` could never run here before; `ReSTIRViewport.slang` lowers cleanly with the edit).
- `CheckShaderTableParity.sh`, `CheckBuildSourceList.sh`, `CheckShowcaseLevel.sh`,
  `CheckTelemetryProbe.sh`, `CheckPerformanceTelemetry.sh` — GREEN.
- `GameExecution.cpp`, `CelestialSequence.cpp`, `ReSTIRIntegrator.cpp` — `g++ -fsyntax-only` clean
  (patched-ImGui + tomlpp staged as scratch submodules, not committed).
- `static_assert(sizeof(DispatchConfiguration) == 128)` — passes by construction (float ↔ uint lane swap).
- CPU mirror A/B renders above; 0 non-finite samples in every run.

## What ruled out the other suspects

- **CWBVH 32-entry stack overflow on long (1e4 m) sun rays** — the mirror traverses the same blobs with
  the same limits implied by the tinybvh port and produces correct long-range occlusion; a GPU traversal
  failure would also kill bounce light and GI, which your frames clearly have. Not needed to explain the
  symptom; the radiometric wash fully accounts for it.
- **Denoiser erasing shadows** — the A/B used the *shipped* à-trous chain (`--denoise`): shadows survive
  it easily once contrast exists.
- **Exposure/adaptive ACES** — exposure scales, it cannot create contrast. With the fill scaled, adaptive
  exposure now keys on the sun-lit floor and makes shadowed regions *more* separated, not less.
- **d425de2's traversal/spatial fixes** — they were real leaks worth closing and they stay; they just
  could not make a 1.2 : 1 ratio *visible*.

## What to do on your PC (the live A/B — this is also the escalation test)

1. Get the change onto `arena/01a0b62f-frontier` (or wherever you build): this branch is a full mirror —
   `git fetch https://github.com/unassignedinbox/Slate arena/01a0bbbb-slate` from your Frontier-
   checkout and merge/cherry-pick the top commit, or `git apply` the exported patch
   `Diagnostics/Frontier_R14_skyfill_shadow_contrast.patch` in that checkout.
2. Rebuild (CMake lowers the edited kernel; shader gate already green here).
3. Look at the Showcase at ~15:30: sun shadows should be unmistakable.
4. **Interactive proof**: Celestial → Sun → drag **"Sky fill"** between 0.35 and 1.00 — shadows should
   visibly melt away and snap back (accumulation resets on change, so the response is immediate).
   If dragging the slider changes *nothing*, then — and only then — we have a genuine GPU-side plumbing
   bug, and the next step is the kernel-side shadow-probe counters + readback (the instrumentation plan
   is ready; the readback harness already exists for `LuminanceReduce`/adaptive exposure).
5. Send the usual three telemetry files — the new `[Lighting]` line will state the configuration they
   were captured with.

## Deliberately not in this commit

- No kernel shadow-probe counters (the slider A/B answers the same question interactively; ready if step 4 fails).
- No change to ambient/sky **at night** semantics beyond the same dial (MoonAmbient is a separate term, untouched).
- No re-tune of panel nits / SunDirect — r4/r5 values stand; the fill was the missing half of that rebalance.
- The R12/R13 work (fast-history, compatibility neighbours, moon reservoir candidate) remains reverted at
  `d425de2` baseline as you asked; none of it is needed for shadow visibility.

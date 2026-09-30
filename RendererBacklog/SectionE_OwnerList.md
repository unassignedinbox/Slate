# Renderer deferred work — Section E (owner's pre-games list, 2026-09-28)

This is the owner's hand-off list of what is left on the renderer before building actual games,
written up as proper `Docs/Roadmap.md` rows (continuing the existing numbering from #28).

**Where it lives:** the canonical home is `Docs/Roadmap.md` in `SultanAladin/Frontier-` (the repo's single
deferred-work index). This session can only persist to Slate, so the change ships as
`patches/Roadmap_SectionE_OwnerList.patch` — apply it in a Frontier checkout with:

```bash
git apply patches/Roadmap_SectionE_OwnerList.patch   # from the Frontier repo root
```

Verified `git apply --check` clean against `main`. The section text below is the same content, for reading here.

---

## E. Render finishing pass — native Frontier validation required

The former standalone CPU mirrors, evidence images, and patches were retired because they were not renders from the
shared Frontier host. They are not acceptance evidence for engine features. The remaining work is intentionally
anchored to the engine-owned paths and to native capture.

| # | Item | | % | Next verified step |
|---|---|---|:--:|---|
| 29 | **Layered material slabs** | ⚠️ | 60 % | Validate the existing material-descriptor/slab route on Project-Zero's 20 × 20 authored material scene in the native Frontier host. Capture multiple host camera angles with sibling provenance. |
| 30 | **Finite clearcoat flakes** | ⚠️ | 50 % | Validate dense, legible flakes and distinct clearcoat in native visibility-raster, Surfel-GI, and ReSTIR views. Do not use a substitute renderer or a flattened body material. |
| 31 | **Hardware RT traversal** | ⚠️ | 55 % | Build the engine-owned `VK_KHR_ray_query` variant on RT-capable hardware and compare it with the software traversal through the same Frontier scene and mode. |
| 32 | **Sky + cloud bake** | ❌ | 25 % | Bake the cloud layer, choose invalidation on weather edits, and verify through the shared celestial environment. |
| 33 | **Sun bake** | ❌ | 20 % | Bake direct solar contribution without smearing the sun disc; validate against the shared sky model. |
| 34 | **Clamp maximum star size** | ❌ | 30 % | Add a matching upper radius bound in `PostRecords.slang` and `VisibilityRaster.cpp`, then capture the native host output. |
| 35 | **Fog** | ❌ | 10 % | Reproduce, diagnose, and repair the cloud/fog viewport in `WeatherMedia.slang` and `FogModel`. |
| 36 | **Scale / quality tiers** | ❌ | 40 % | Verify every tier's render scale and mode controls end-to-end in Frontier and record timing per tier. |
| 37 | **Wind** | ❌ | 10 % | Correct the wind-to-cloud-noise domain coupling and validate with a native time-lapse. |
| 38 | **Cross-target verification** | ❌ | 5 % | Run the host on both software traversal and RT-core paths, including a second GPU class. |
| 39 | **Full Nanite-style cluster LOD** | ❌ | 15 % | Frontier currently has cluster culling, not a virtual-geometry simplification hierarchy. Design an offline cluster-group build and a runtime projected-error selector usable by raster and ray paths. |

### Native proof boundary

Surfel GI is required on both its shared GPU compute path and deterministic CPU reference path. Neither a CPU reference
nor a telemetry chart is represented as a Vulkan, Slang, or ImGui capture. Required Project-Zero and Project-Drive
visual proof comes only from the shared `Frontier.exe` host with the corresponding `.frontier` project specification.

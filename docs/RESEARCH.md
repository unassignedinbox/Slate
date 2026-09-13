# Slate Terrain Lab — Requirements Research

Target: a **AAA-aspiring, SDF-based terrain landscaping tool** (think Gaea, but volumetric:
real caves, overhangs, cliffs, arches — impossible on heightmaps), with **particle erosion**
(rain/hydraulic, rivers + sedimentation, thermal/talus, wind/aeolian), **real-time preview**,
starting from **basic primitives**, tuned to run on **GTX-class GPUs**.

> Explicit scope decision: **NOT node-based.** The workflow is a Gaea-style **layer stack**
> (ordered primitives + modifiers + eroders, each toggleable/reorderable/re-parameterized).
> A node graph can be layered on top later; the stack maps 1:1 to graph nodes.

## 1. Why SDF / voxels instead of heightmaps

Heightmaps (Gaea, World Machine, UE Landscape) can only represent `y = h(x,z)`: no caves,
no overhangs, no arches, no vertical cliff detail. An SDF volume `f(p) : R³ → R` with the
surface as the 0-set represents all of these naturally, gives free surface normals
(`n = −∇f/|∇f|`), and supports CSG (union/subtract/intersect/smooth-blend) for art-directable
base shapes. Meshing via marching tetrahedra / surface nets turns the field into game mesh.

References:
- Faraj et al., *Flexible Terrain Erosion* (The Visual Computer, 2024) — particle erosion
  formulated generically for heightfields, voxel grids, material layers and **SDF implicit
  terrains**. Erosion from a particle at `c` applies to all points `p` in a sphere,
  `q ≈ Q·(1 − d/r)`, i.e. a **volumetric splat**, with independent particles (no
  particle-particle collision) so it parallelizes trivially. Overhangs/beaches/cliffs
  emerge only on the 3D representations.
- Weiss, *Fast voxel-based hydraulic erosion* (TUM bachelor's thesis, 2016) — level-set
  terrain + SPH water particles, per-particle sediment exchanged **with the terrain and
  between particles**; 100k particles on 1024×1024×512 on GPU. Proves the particle↔SDF
  coupling model.
- Sebastian Lague / Hans Theobald Beyer droplet model — sediment-capacity transport:
  `C = slope · speed · water · k`; erode when `sed < C`, deposit when `sed > C` or
  uphill; evaporate; parameters (inertia, gravity, capacity, erosion/deposition
  coefficients, evaporation, min slope, TTL, radius) are the industry-standard control set
  we expose per eroder.

## 2. The "pushing/pulling" bug from the last session — root cause & fix

**Symptom:** terrain looked weird/lumpy after erosion.
**Cause:** applying particle influence as a **displacement of mesh vertices** (Lagrangian
push/pull along normals) instead of editing the underlying field. Vertex pushing is not
mass-conserving, fights with mesh resolution, and creates spikes/pits because neighboring
particles disagree about where the surface should go.

**Fix (implemented here):**
1. Particles **never touch the mesh**. They only add/remove *mass* in the Eulerian density
   field via smooth normalized kernels (trilinear 3³ splats / spherical falloff).
2. Per-splat deltas are **clamped** (no single particle can dig a pit or grow a spike).
3. Droplets **deposit remaining sediment on death** (sea, evaporation, TTL) — the standard
   Hans Theobald Beyer conservation rule.
4. The field is a **truncated SDF** (|f| ≤ ~6 voxels), keeping gradients meaningful and
   edits local.
5. A live **sediment ledger** (eroded vs deposited vs airborne) proves conservation; the
   audit readout shows drift %.

## 3. Erosion models implemented (all SDF-native, 3D)

| Eroder | Model | SDF adaptation |
|---|---|---|
| Hydraulic (rain) | Hans Theobald Beyer droplets + impact | fall → surface project (Newton steps on SDF) → flow along gravity projected on tangent plane → spherical splat carve/deposit |
| Thermal (talus) | slope relaxation to angle of repose | 3D donor→recipient transfer between voxels (NOT heightfield blur, so overhangs survive); builds scree cones under cliffs |
| Wind (aeolian) | saltation + abrasion | ballistic sand grains advected by wind+gust field; windward abrasion on `dot(n,wind)<0`, leeward deposition (dunes); field abrasion pass for yardang/polish |
| Rivers (fluvial) | discharge-routed channels | sources at high surface points, momentum + meander descent, `width ∝ √Q`, carved channels + levees + alluvial fans/deltas at sea level; sediment budget tracked |

Common rules: hardness field resists all erosion; deposited sediment is soft; wetness darkens
albedo and feeds river entrainment; sea level acts as base level (deposition below it).

## 4. Performance budget (GTX-first)

- Sim is **CPU in a Web Worker** (typed arrays, no GC churn) so any GTX that can run WebGL2
  works; GPU only renders. Volume is `N × N/2 × N` (terrain is wider than tall).
- Default **128×64×128 ≈ 1M voxels × 4 fields ≈ 16 MB**. Tiers: 64 (iGPU) → 256 (RTX).
- Erosion runs **chunked** (N particles/frame slice) with live remesh throttling (~2 Hz),
  progress bars, and particle-point visualization — real-time feedback without blocking UI.
- Meshing: marching tetrahedra with edge-welded vertices + analytic SDF normals; vertex
  attributes (slope/sediment/wetness/hardness/height) cached so color-mode switches are
  instant (no remesh).

## 5. AAA-readiness notes (honest scope)

What this tool is: a **directional art/prototype tool** producing eroded SDF volumes and
exportable meshes (OBJ), heightmaps (PNG), and project files (JSON) — the same artifact
contract as Gaea (height + masks), plus true 3D. What full AAA production additionally
needs (roadmap): tiled/streamed volumes (brickmaps/VDB), GPU compute port of the eroders,
material-layer fields (strata/albedo/roughness volumes), deterministic farm builds, and
engine import (UE `Landscape` / Nanite mesh, Unity Digger-style SDF collision). The
architecture (field ↔ eroders ↔ mesher ↔ ledger) is deliberately shaped so each of those
can be swapped in without changing the workflow.

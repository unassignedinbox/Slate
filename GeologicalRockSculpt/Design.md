# AAA SDF Geological Rock & Terrain Sculptor — Design Specification
## Formation-Aware Signed Distance Fields, Not Tilable Noise

### 0. Design Thesis

> **Do not displace a sphere with noise and call it a rock.**  
> Simulate how the rock *formed*, then let erosion act on that fabric.

A AAA photoreal rock must simultaneously show:
* **Formation fabric** (crystals / bedding / foliation / columns) at 1 mm–1 m
* **Fracture system** (joints, stylolites, exfoliation sheets) at 0.1–5 m
* **Weathering response** (differential erosion, spheroidal rounding, karst) that respects hardness/porosity/exposure

All three are expressed as **SDF domain operations on an infinite, non-repeating hash field**, never a tilable texture. The same field drives geometry (distance), material (albedo/roughness derived from lithology), and future physics.

---

### 1. System Architecture

```
[ Hash Lattice + Non-Repeating Value Noise ] ─┐
                                              ├─> Domain Warp Field W(p) ─> Strata / Folds
                                              │         └─> Gradient for bedding normals
[Fractal Warp (fbm of gradient)] ─────────────┘

                    ┌─> Lithology Preset (hardcoded) ─> grain size, hardness, porosity, palette
                    │
p ─> FormationSDF(p, lithology, W(p), Voronoi) ─> base distance d₀
                    │           ├─ Voronoi fracture (joints/colums) as SDF planes
                    │           ├─ Warped layered SDF (bedding/cross-sets/foliation)
                    │           ├─ Sparse voids (vesicles, fossil molds, karst seeds)
                    │           └─ Fold warps (large sinusoids sheared by W)
                    │
                    ├─> WeatheringOperator(d₀, curvature, exposure, hardness)
                    │           ├─ curvature-driven spheroidal rounding (edges round faster)
                    │           ├─ exfoliation sheet subtraction (surface-parallel)
                    │           ├─ differential erosion (hardness-gated recession)
                    │           ├─ karst tunnel subtraction (meandering worm SDF)
                    │           └─ tafoni / honeycomb pits along soft bands
                    │
                    └─> Final SDF d(p) + MaterialRecord {albedo, roughness, hardness, AoMask}

TerrainSDF(p) = p.z - HeightField(p.xy) with fluvial ridge erosion
RockSDF(p)    = FormationSDF(p - rockCentre, lithology) ± brushOps
SceneSDF(p)   = smin(TerrainSDF, RockSDF, 0.35) ∪ ScreeInstances ∪ BrushStrokes
```

**Evaluation requirement:** Lipschitz-safe (distance underestimated conservatively after warps; clamp warp gradient magnitude).

---

### 2. Non-Repeating Field Foundation (No Tilable Noise)

**Why not `texture(noise)`:** any finite tile repeats; at 4K with a 1 m rock seen at 10 cm distance, tiling is visible in one frame.

**Instead:**

* **Hash21 / Hash33** (GLSL integer lattice hash, e.g., `fract(sin(dot(...))*43758...)` or better `hash = (n*... ) >>`) — infinite period, no texture.
* **ValueNoise3(p)** — trilinear interpolation of hash at 8 corners, with quintic smoothstep (`f*f*f*(f*(6f-15)+10)`). No tile.
* **FBM** — 5 octaves, lacunarity 1.95–2.03 (non-integer to kill harmonic repetition), gain 0.47.
* **Domain Warp:** `W(p) = 0.5 * gradNoise(p*0.6) + 0.25 * gradNoise(p*1.3 + W0)`. Gradient estimated via analytic noise derivative or offsets. Magnitude clamped to <0.35 to preserve Lipschitz bound (warp Jacobian eigenvalues <0.4). This produces folded strata that look like real tectonic folds — non-periodic, history-carrying.
* **Voronoi** — `voronoi(p, jitter 0.85–1.0)` returning `(cellDist, borderDist, cellId, cellCentre)`. Jitter <1 avoids regular grid. Hash-seeded, infinite, not tilable. Border distance = distance to Voronoi face, directly usable as SDF joint plane distance.

All SDF warps read `W(p)` once and warp bedding / columns / tunnels coherently — a fold affects both strata and joints, as in nature.

---

### 3. Formation-Aware SDF Primitives (Per Lithology)

#### 3.1 Granite (Intrusive, Interlocking Crystals)

* **Base shape:** rounded polyhedron via `sdRoundBox` + convex intersection of 7–11 Voronoi-derived planes (simulating pluton boundary), `r=0.14 m`.
* **Crystal fabric:** Voronoi `freq 10–16 /m` (crystal size 4–12 mm scaled to hero rock 1.2 m → domain scale 9). Each cell assigned a mineral via `hash(cellId)`: 32% quartz (pale grey, hardness 7), 45% K-feldspar (pink/beige), 18% plagioclase (white), 5% biotite (black). Crystal boundary relief: `(hardness - 0.5)*0.015 * exp(-borderDist*28)`. Quartz resists pitting → stays proud; feldspar hydrolyses → pits.
* **Porphyry variant:** second Voronoi at `freq 3.2` with larger cells → expanded `sdBox` phenocrysts inset.
* **Exfoliation sheets:** surface-parallel curved SDF subtraction. Sheet normal `N_e = normalize(vec3(0.15,0.08,1) + 0.35*W(p*0.45))`. Sheet phase `φ = dot(q, N_e)*6.0 + 0.5*FBM(q*1.2)`. Sheets are `smoothstep(0.87,0.92, sin(φ)*0.5+0.5)` → subtraction `d -= 0.018 * sheetMask * clamp(1 - d*0.6)` (only near surface).
* **Spheroidal rounding:** after base, `d = opRound(d, 0.022 + 0.018 * curvatureFactor)` where `curvatureFactor = 1 - smoothstep(0.0,0.08, borderDist)` — convex edges (near Voronoi borders + base edges) round faster, matching corner>edge>face exposure.

No vesicles, no bedding, low porosity.

#### 3.2 Basalt — Columnar Jointing

* **Base shape:** vertical prismatic cluster, `hexVoronoi` on XZ at `freq 3.6` (column diameter 0.5–1.8 m real → scaled to rock: 0.18 m), column radius jitter 0.04 via hash. Column walls are Voronoi faces → distance to face `h = hexBorder(p.xz*3.6)`. `dColumn = max( length(xz - centre) - radius,  slabY )`.
* **Horizontal chisel marks:** sinusoidal subtraction `sin(p.y*7.2 + W(p).x*2.3)` with `smoothstep` crack: subtract `0.007` at 60–65% phase.
* **Vesicles:** 3D sparse sphere voids: `hash(p*22)` threshold >0.985 → `sphereSDF(p - cellCentre, r = 0.008+0.018*hash)`; density falloff toward interior `exp(-distToSurface*1.2)` concentrated at flow top.
* **Cooling cracks:** secondary Voronoi at `freq 18` for micro jointing.

#### 3.3 Sandstone — Bedding + Cross-Bedding + Tafoni

* **Base shape:** slab `sdRoundBox` with long horizontal extent (terrain-like) `r=0.09`.
* **Bedding:** warped horizontal layers. Reference plane `y` (up). Warped coordinate `q = p + 0.32*W(p*0.55)`. Bedding function: `bedPhase = q.y * bedFreq + 0.6*FBM(q*0.9)` where `bedFreq = 9` (= 8–14 layers per metre → 7–12 cm beds, field-accurate). Each layer `layerId = floor(bedPhase)`, thickness jitter `0.85–1.15` via `hash(layerId)`. Hardness per layer `hL = 0.75 + 0.25*hash(layerId+17)` (cementation variation) — drives differential recession.
* **Cross-sets (tabular/trough):** inside each bed, add inclined laminae: `crossPhase = dot(q, normalize(vec3(0.68, 0.28, -0.12)))*14 + 2.1*FBM(q*2.2)`. Truncated at bed top (`smoothstep` cut) and tangential at base (`exp(-t*... )`). Dip 18–26° (avalanching slope). Only visible within each set → multiply by `smoothstep` to zero at boundaries. Gives textbook foreset truncations, not undulating noise.
* **Liesegang rings:** concentric Fe staining around nucleation sites: distance to Liesegang centres `Hash(centre)`, colour lerp `mix(buff, rustRed, exp(-d*4.5)*0.9)`.
* **Tafoni / honeycomb:** along softest bands (`hL < 0.82`), subtract spherical pits `radius 0.02–0.065` seeded by `hash(p*11)` with density `0.6 * (1-hL)`.

#### 3.4 Limestone — Stylolites + Karst

* **Base:** massive `sdRoundBox` with moderate rounding `r=0.12`.
* **Bedding:** same as sandstone but thicker (0.15–0.4 m) and with *stylolite* sutured seams: at each bed boundary, subtract fractal zigzag `zig = abs( fract( q.x*3.2 + W.x*0.5 ) -0.5 )` modulated by `FBM`. Amplitude 2–15 mm, seam colour dark brown/black (insoluble residue).
* **Karren:** surface grooves along flow direction: subtraction `sin( dot(p.xz, flowDir)*12 + W.x*5 ) * 0.012`.
* **Karst tunnels:** meandering worm SDF subtraction. Path `curve(t) = vec3( sin(t*0.8), 0, cos(t*1.1))*2 + Warp*0.5`. Distance to curve is min over `t` (approximated with 3-segment analytic trace per cell). Tunnel radius `0.04–0.18` modulated by `FBM`, wall roughness via `FBM`. Only where exposure high (near surface).
* **Fossil voids:** sparse bivalve/brachiopod shapes: `sdEllipsoid + sdTorus` for shell moulds, count ~ 6 per m³.

#### 3.5 Shale / Slate — Fissility & Slaty Cleavage

* **Lamination:** ultra-thin `freq 45` (≈ 2–8 mm layers) with perfect planar continuity. `lamPhase = (q.y + 0.15*sin(q.x*1.8 + W.y*0.7))*45`. Subtract fissile gaps `smoothstep(0.965,0.975, fract(lamPhase))` → thin dark partings.
* **Folding:** tight isoclinal fold warp `fold = 0.18*sin(q.x*1.2 + W.x*0.8)*exp(-q.y*0.3)`, shear `q.x += fold`.
* **Colour:** dark grey–black, organic laminae darker, pyrite flecks (metallic specks).

#### 3.6 Gneiss — Banded Foliation + Augen

* **Banding:** alternating felsic (quartz/feldspar, light pink-grey, 60% width) and mafic (biotite/amphibole, dark, 40% width) bands. `bandPhase = (q.y + 0.5*W.y + 0.25*sin(q.x*0.6))*6`; segregation via `hash(bandId)`. Band thickness varies 5–50 mm → lithology thickness jitter `0.55–1.55`.
* **Foliation warp:** large domain warp `W*0.65` folds bands coherently.
* **Augen:** eye-shaped K-feldspar porphyroblasts 15–40 mm within bands: `sdEllipsoid(p - augenCentre, (0.022,0.014,0.016))` with foliation wrapping `q += 0.015 * normalize(distanceGradient) * exp(-dist*12)`.
* **Boudinage:** pinch-and-swell on mafic bands via `sin(q.x*2.3)*0.012` amplitude modulation.

---

### 4. Weathering Operators (Applied After Formation)

Operators are *multiplicative with hardness/porosity/exposure*, not uniform. Exposure `E(p) = saturate( -d * cavityEstimate + dot(normal, up)*0.18 + 0.55 )` approximated from SDF via cheap AO cone.

#### 4.1 Spheroidal Rounding (curvature-driven)

```
k_round = baseRound + hardnessFactor * (1 - hard) * E * 0.032
d = opRound(d, k_round)   // or: d -= k_round * curvatureMask
```
where `curvatureMask = smoothstep(0.0, 0.06, edgeDist)` and `edgeDist` is distance to nearest joint/Voronoi border + estimate of mean curvature via Hessian diagonal sum `H = d(p+εx)+d(p-εx)+...-6d`. Hard rocks (hardness 7, porosity 0.3%) round 3× slower than porous limestone.

#### 4.2 Exfoliation Sheets

Already in formation for granite, but as post-operator for any massive rock:

```
sheetMask = smoothstep(0.88, 0.96, sin(dot(p, N_sheet)*freq + WarpPhase))
d = smin(d, d - sheetMask*sheetDepth, 0.006)   // sharp sheet subtraction with rounding
```

#### 4.3 Differential Erosion

Recession along soft bands: `recess = (1 - hardnessLocal) * E * erosionRate * (1 + 0.6*saturate(dot(gradHeight, flowDir)))`. Implemented as subtraction along bedding normal: `d -= recess * smoothstep(0.0, 0.02, bandMask)`.

#### 4.4 Karst & Tafoni Pits

*Karst:* precomputed worm tunnels (Section 3.4) subtracted with `smax` blending `k=0.02` to soften edges but preserve connectivity.
*Tafoni:* `for each cell where hardness<0.82 and E>0.6: d = smin(d, sdSphere(p-centre, r), 0.018)` where `r = lerp(0.02,0.065, hash)` and centres are Poisson-disc via hash rejection, only on exposed faces (`dot(cellNormal, view) ...`).

#### 4.5 Cavity Darkening & Desert Varnish

Not geometry but material: AO term `ao = clamp(1 - cavity*1.8, 0.25, 1)`. Limestone/desert rocks get varnish: `albedo *= lerp(1, 0.62, saturate(E*0.5 + ao*0.4))` with reddish tint.

---

### 5. Hardcoded Lithology Table (Source of Truth)

Single authoring point: `RockFormationSpecification.h` → consumed by CPU SDF, GPU SDF (generated .slang include), and UI presets. No artist-tweakable "roughness" without lithology coupling.

| ID | Name | Density | Mohs | Porosity | Grain [mm] | Strength | ErosionRate | ExfoliationSpacing | BeddingFreq | ColumnDia | VesicleDensity | Palette |
|----|------|---------|------|----------|------------|----------|-------------|--------------------|-------------|-----------|----------------|---------|
| 0 | `GraniteCore` | 2.65 | 6.5 | 0.8% | 6 | 180 | 0.22 | 0.14 | — | — | 0 | quartz #D8D5CE, K-spar #E6C2A8 pink, biotite #1A1A1E |
| 1 | `GranitePorphyry` | 2.67 | 6.5 | 0.9% | 18 pheno | 160 | 0.25 | 0.16 | — | — | 0 | same + 28 mm phenocrysts |
| 2 | `BasaltColumnar` | 2.91 | 6.0 | 0.5% | 0.2 | 220 | 0.32 | — | — | 0.18 | 0.85 | basalt #1E2226, vesicle highlight #8A8D93 |
| 3 | `SandstoneBuff` | 2.32 | 6.5 | 14% | 0.4 | 65 | 0.92 | — | 9.0 | — | 0 | buff #D8C4A6, rust Liesegang #9E4A2E |
| 4 | `SandstoneRed` | 2.45 | 6.5 | 9% | 0.6 | 85 | 0.74 | — | 8.2 | — | 0 | red #A85D3D, foreset tan #C9A88A |
| 5 | `LimestoneKarst` | 2.42 | 3.5 | 11% | 0.15 | 75 | 1.35 | — | 3.2 | — | 0 (karst tunnels 1.2/m³) | creamy #E8E0D2, stylolite #3B2E26, fossil void |
| 6 | `ShaleSlate` | 2.68 | 5.5 | 0.4% | 0.006 | 140 | 0.48 | 0.02 lam | 45 | — | 0 | slate #3A3E45 / #2B2E33, pyrite speck |
| 7 | `GneissBanded` | 2.82 | 6.5 | 0.7% | 4 | 170 | 0.41 | — | 6.0 (bands) | — | 0 | felsic #E3D9D1, mafic #1F2328, augen pink |
| 8 | `Quartzite` | 2.65 | 7.5 | 0.3% | 0.8 | 240 | 0.15 | 0.10 | — | — | 0 | glassy #EDE9E6, conchoidal sheen |

Derived constants (not exposed):
* `erosionRate` ∝ `hardness⁻¹ × porosity^0.48 × c`, normalised to limestone = 1.35.
* `cavityDarken = 1.0 - saturate(porosity*3.2)*0.45`
* `specularRoughness = remap(hardness, 3→0.72, 7.5→0.32)` + `grain*0.04`

---

### 6. Terrain Sculpting SDF

Terrain is not a heightmap texture but an SDF: `terrain(p) = p.z - H(p.xy)`, where `H` is formation-aware heightfield.

**Height synthesis (no tilable noise):**

```
q = p.xy * 0.16
q += 0.55 * Warp2(q)                 // fold/fault warp
h = 2.0 * FBM(q)                     // base relief
h += 0.62 * Ridge(FBM(q*2.1))        // ridged multifractal for fluvial ridges (ridge = 1 - abs(noise))
h += 0.14 * sin(dot(q, vec2(0.71,1.03))*3.1 + FBM(q*1.45)*1.6)  // stratified terrace ghosts
// fluvial incision: flow follows gradient of h → carve V-gullies where convergence high
flow = length(gradH) * (1 - dot(normalize(gradH), normalize(q - warpOrigin))*0.25)
h -= 0.38 * saturate(flow)*smoothstep(0.2,0.85, FBM(q*3.2 + h*0.6)) // non-uniform gully depth
```

* Fluvial gullies are *domain-warped* and follow descent direction, not straight noise trenches.
* Resulting terrain carries bedding ghosts (terrace sin) so cliffs show strata continuity with rocks.

**Contact:** `scene(p) = smin(terrain(p), rock(p), 0.35)` with rocky scree instancing: Poisson-disc instances of small `sdRoundBox` scree (0.06–0.22 m) scattered where `slope > 0.55` and `terrain near rock junction`, via hash.

---

### 7. Sculpting Brushes as SDF Compositions

Sculpting is accumulation of brush SDFs evaluated per ray. Brushes are *geology-meaningful*, not generic smooth blobs. 64 slots, circular buffer, sent as uniform array `BrushRecord { vec3 centre; float radius; int operation; float hardness; float warp; }`.

| Brush | SDF Operation | Geology analogue | Falloff | Lithology-aware? |
|-------|---------------|------------------|---------|-------------------|
| **Add** | `scene = smin(scene, sdSphere(p-c, r), k=0.08)` | plutonic intrusion / deposition lobe | smoothstep cubic | hardness modulates smoothness |
| **Remove (Hammer)** | `scene = smax(scene, -sdSphere(p-c, r), k=0.02)` | quarrying / block removal | sharp | — |
| **Strata Cut** | subtract horizontal or bedding-parallel slab `sdSlab(p, n, thickness)` with warped cap `cap += Warp(p)*0.12` | bedding-plane quarrying / fault gouge | hard | aligns to local bedding normal (sample `W`) |
| **Fracture / Joint** | subtract thin plane `sdPlane(p, n, thickness=0.004)` extended with Voronoi border distance `dist = voronoiBorder(p*8)` → feathered | tectonic joint, columnar parting | linear | fracture follows `voronoiBorder`, not straight |
| **Exfoliate** | subtract surface-parallel sheet `sdSheet` oriented to surface normal `N = gradSDF(p)` | exfoliation / spalling | tangential | only where `dot(N, N_sheet) > 0.6` |
| **Weather** | locally increase `k_round` → `d = opRound(d, k+brushStrength)` in sphere of influence `w = smoothstep(r, r*0.4, dist)` | spheroidal / chemical rounding | radial gradient | scaled by `(1 - hardness)` |
| **Karst Drill** | subtract worm tunnel: distance to meandering polyline `curve = c + Warp*0.6` with radius `r` | karst conduit dissolution | tube falloff `r * (1 - 0.3*FBM(p*4))` | only effective on soluble lithologies (Mohs<4.5) else 10% strength |
| **Polish** | reduce micro-relief by lerp toward smooth base: `d = mix(d, d_baseSmooth, w*0.65)` | ventifact sandblast / water polish | radial | high hardness → less |

**Sculpt interaction:** on mouse down, raymarch to find `hitPos` + `hitNormal`. Push brush record with `centre = hitPos + normal*0.01`, `radius = uiRadius`, `operation = uiBrush`. Evaluate in shader loop over active brushes `for i in 0..brushCount: scene = applyBrush(scene, p, brushes[i])`. After 64, oldest discarded.

Future: bake brush deltas into sparse voxel SDF (OpenVDB) for persistence; for WebGL demo, uniform accumulation is sufficient for AAA inspection at 60 fps (64 spheres per ray step is ~10k evaluations worst-case; mitigate with early-out and bounding sphere culling per brush).

---

### 8. Rendering Pipeline (AAA Look)

* **Ray march:** sphere trace `t += d*0.85` (over-relaxation with Lipschitz safety min), max 160 steps, early-out `d<0.0007` or `t>60`. Primary rays from perspective camera, jittered TAA (Halton 2,3).
* **Normals:** tetrahedron gradient `normal = normalize( d(p+tet)-d(p-tet) )` with `ε=0.0006`.
* **Curvature:** `curv = laplacian = d(x+ε)+d(x-ε)+... -6d / ε²` mapped to cavity `cavity = saturate(curv*1.2)`.
* **Material:** `getRockMaterial(p, lithology, n, curvature)` returning albedo (lithology palette indexed by Voronoi cell + band + FBM), roughness (hardness-derived + porosity bump), metallic 0, and `layerMask` for intra-rock variation.
* **Lighting:** single sun `L = normalize(vec3(-0.58,0.42,0.78))`, shadows via secondary sphere trace (32 steps, soft via `shadow = min(shadow, k*d/t)`), sky light via `sky = 0.6+0.4*n.z`, hemispherical gradient, AO via cone marching `ao = Σ w * max(0, d_at_step)`.
* **PBR:** Cook-Torrance GGX + Smith, diffuse EON (spec-compliant to MaterialEvaluation.slang), exposed via same `roughness`. Cavity darkening `diffuse *= ao*0.6+0.4`. Edge highlight for weathered rims: `FresnelSchlick + ao`.
* **Tonemap:** ACES approximated (`x*(2.51x+0.03)/(x*(2.43x+0.59)+0.14)`), gamma 2.2, vignette.
* **Performance:** 1920×1080 @ 55–70 fps on integrated GPU with 128 steps avg; mobile fallback halves steps + quarter res.

---

### 9. Frontier Engine Integration

* `Engine/LithicFormation/RockFormationSpace.h` — CPU SDF with same functions (scalar, SIMD), used for collision/physics, mesh extraction (Surface Nets), and baking `GlobalSDF` textures.
* `Engine/Shaders/RockFormation.slang` — GPU twin, `#include`'d by `ReSTIRViewport.slang`; shares `RockFormationSpecification.h` via codegen.
* `RockFormationSpace::Evaluate(p, lithology)` returns `RockSample{ float distance; vec3 albedo; float roughness; float hardness; float borderDist; }`.
* Marching/voxelisation and sculpting runs on compute queue (`RockSculptSequence`), writes to 3D texture `RockFormationSpace::kVoxelResolution = 256³` sparsely via bricked `ClusterCull`-like cull.
* Material system: each lithology maps to a `MaterialDescriptor` slab with `base_color`, `specular_roughness`, `slate_haziness_*` wired to rock hardness; authoring UI exposes only lithology picker + weathering age slider, not raw noise octaves.
* Persistence: brush strokes serialised as `RockBrushRecord` (position, radius, operation, warp) → replayed on load, baked to `ByteSpace` monotonic extent (resets at Phase ⑭).

No tilable textures are shipped; `EngineContent/MaterialArchives/Rocks/` contains only `RockFormation.toml` presets + procedural LUTs (EnergyLut, SheenLut) — no albedo maps.

---

### 10. Anti-Goals (What We Refuse To Ship)

* No `tilable_sandstone_albedo.jpg` — all albedo is procedural hash + Voronoi mineral assignment.
* No Perlin-graph spaghetti that looks identical at every scale — every displacement has a geological name and a measured hardness/porosity coefficient.
* No "hardcoded rock values" that are actually random sliders — every preset's `density / Mohs / porosity / grain / strength` is a table lookup from the Research doc, and `erosionRate` is derived, not tweaked by eye until it looks nice.
* No sculpting that merely dents a mesh — every brush is an SDF composition with correct CSG semantics (union/subtraction/smooth-min) so overhangs, tunnels, and caves remain watertight.

---

### 11. Validation Checklist (AAA Gate)

* [ ] At 10 cm viewing distance, can you identify formation type without UI (crystals vs foresets vs columns vs karren)?
* [ ] At grazing light, do hard bands stay proud while soft bands recess (differential erosion)?
* [ ] Do corners round faster than faces on granite boulder (spheroidal test)?
* [ ] Do columnar joints form closed hexagonal prisms, not wandering cracks?
* [ ] Do cross-beds truncate at bed tops and feather at bases (stratigraphic up correct)?
* [ ] Are there zero repeating patterns over 20 m traverse (non-tiling proof: screenshot 4 widely spaced crops, no correlation >0.12)?
* [ ] Does limestone dissolve into connected conduits you can walk through, not isolated blobs?
* [ ] Is every colour explainable as a mineral or cement, not a palette ramp?

Passing these is the definition of "realistic as possible to real life" for this sculptor.

---

### 12. Roadmap (post-MVP)

* Sparse voxel SDF (OpenVDB) baking + physics collision via `ByteSpace` for scene-scale terrain (16 km²)
* Hydraulic erosion simulation on SDF heightfield (shallow-water + sediment transport) to generate fluvial networks that match gradient, not noise
* Petrographic thin-section view (polarised light) as debug visualisation: mineral assignment as `DebugViewCategory`
* Export to glTF with baked PBR textures sampled from SDF for offline renderers
* XR sculpting with pressure-sensitive exfoliation brush


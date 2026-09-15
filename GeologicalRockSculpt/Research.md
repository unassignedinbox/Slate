# Geological Rock Sculpting — Research Compilation
## AAA SDF Realism: How Real Rocks Actually Form

> Purpose: compile the geological first-principles that drive visual detail at every scale, so that SDF synthesis reproduces *formation processes* rather than covering a blob with tilable noise. All hardness / density / porosity numbers are anchored to measured lithologies, not invented.

---

### 1. The Rock Cycle as Specification

Rocks are never arbitrary colour + noise. Every surface is the terminus of a formation path:

```
Magma → Crystallization (intrusive vs extrusive cooling rate) → Igneous
      → Weathering → Transport → Deposition → Compaction + Cementation (Lithification) → Sedimentary
      → Burial → Heat + Pressure + Fluids (Metamorphism, no melting) → Metamorphic
      → Melting → … cycle repeats
```

The three families are distinguished in hand specimen by three unambiguous field clues (USGS field guide):

| Clue | Points to | Why |
|------|-----------|-----|
| Interlocking crystals visible | Igneous | crystals grew from melt |
| Bedding / layers / pebbles / fossils | Sedimentary | episodic deposition + cementation |
| Foliation / banding / stretched minerals | Metamorphic | pressure + heat recrystallized fabric |

For SDF realism this matters because each clue implies a different *distance-field generator*, not a different colour tint.

---

### 2. Igneous: Cooling Rate Controls Everything

**Origin:** molten rock crystallises. Intrusive (plutonic) cools kilometres underground over 10⁴–10⁶ years → large crystals (phaneritic). Extrusive (volcanic) cools in hours–days → fine or glassy (aphanitic).

| Lithology | Cooling | Texture | Grain size | Silica | Colour | Density [g/cm³] | Mohs | Porosity | Comp. strength [MPa] |
|-----------|---------|---------|------------|--------|--------|-----------------|------|----------|----------------------|
| **Granite** (felsic intrusive) | very slow | phaneritic, massive, interlocking | 2–15 mm visible | 65–75% SiO₂ | light grey / pink (quartz + K-feldspar) | 2.60–2.75 | 6–7 | 0.4–1.5% | 100–250 |
| **Diorite** | slow | phaneritic | 1–5 mm | intermediate | grey | 2.7–3.05 | 6 | 0.1–0.5% | 150–300 |
| **Gabbro** | slow | phaneritic | 1–8 mm | mafic | dark grey-green | 2.8–3.1 | 6 | 0.1–0.2% | 150–300 |
| **Basalt** (mafic extrusive) | rapid | aphanitic, vesicular | <0.5 mm invisible | 45–55% SiO₂ | black–dark grey | 2.8–2.9 | 6 | 0.1–1.0% | 100–300 |
| **Obsidian** | instant | glassy | none | felsic | jet black | 2.6 | 5–5.5 | ~0% | — |

**Visual consequences for SDF:**

* **Granite** — interlocking random Voronoi crystals, no bedding, no vesicles. Low porosity → sharp conchoidal edges, but long exposure produces *exfoliation* (onion-skin sheets parallel to surface from pressure release) and *spheroidal weathering* (corners weather 3× faster than faces because exposed on 3 sides vs 1, rounding blocks into corestones). Classic dome forms: Half Dome, Stone Mountain.
* **Basalt** — no visible crystals, but *columnar jointing*: thermal contraction on cooling produces hexagonal prisms (Giant's Causeway) with horizontal chisel marks. Vesicles where gas escaped → isolated spherical voids. Dense → retains sharp fracture.
* **Porphyritic variants** — large feldspar phenocrysts (10–30 mm) in fine matrix require two-scale Voronoi.

Key reference values: granite heat resistance high, water absorption <0.5%, flexural strength 10–25 MPa, thermal genesis 650–800 °C; basalt 1000–1200 °C.

---

### 3. Sedimentary: Deposition + Lithification Creates Strata

Covers ~75% of land surface. Formed by **weathering → erosion → transport → deposition → compaction + cementation (lithification)** over thousands of years. Always shows *bedding* (strata) at scales mm–metre, the single strongest visual cue.

#### 3.1 Clastic (detrital)

Fragments of pre-existing rock.

* **Sandstone** — quartz grains 0.06–2 mm, cemented by silica / calcite / iron oxide. Density 2.0–2.6, porosity 5–25%, strength 20–170 MPa, Mohs 6–7 (quartz). Bedding 10 mm–2 m thick, *cross-bedding / cross-lamination* from migrating dunes/ripples: inclined laminae at 15–30° to main bedding, truncated at top, tangential at base. Trough vs tabular types record 3D vs 2D bedforms. Honeycomb (tafoni) weathering where salt crystallisation excavates pits. Liesegang rings: concentric Fe-oxide bands from diffusion.
* **Shale** — clay <0.004 mm, fissile lamination 0.1–10 mm, density 2.0–2.4, porosity 10–30%, strength 5–100 MPa. Splits into paper-thin sheets. Parent of slate.

#### 3.2 Chemical / Biochemical

Precipitated from solution or biological accumulation.

* **Limestone** — calcite, density 2.2–2.6, porosity 5–20%, strength 30–250 MPa, Mohs 3–4. Bedding + *stylolites* (sutured dark seams where pressure dissolved calcite), *karst* dissolution: water + CO₂ → carbonic acid dissolves calcite → karren grooves, sinkholes (dolines), caves, uvalas, poljes, swallow holes, disappearing streams. Fossil inclusions pervasive.
* **Dolomite** — similar, porosity 1–5%.

#### Formation-aware SDF requirement:

Sedimentary detail is **not random noise**. It is:
* Planar bedding with thickness variation controlled by depositional energy, not uniform.
* Inclined cross-sets truncated by erosional surfaces.
* Differential cementation: harder bands resist erosion → stepped cliffs (differential weathering).
* Stylolites as fractal zigzag SDF subtractions.
* Karst tunnels as meandering worm SDFs, not spherical noise.

---

### 4. Metamorphic: Pressure + Heat Rewrite Fabric

No melting — solid-state recrystallisation under directed pressure + heat ± fluids, typically kilometres deep, exposed only after uplift + erosion.

| Protolith | Grade → Rock | New fabric |
|-----------|--------------|------------|
| Shale → slate → phyllite → schist → gneiss | increasing temperature/pressure | slaty cleavage → schistosity (mica sheen) → gneissic banding (light felsic / dark mafic segregation) |
| Limestone → marble | non-foliated, crystalline | interlocking calcite, no bedding, but retains ghosts |
| Sandstone → quartzite | non-foliated | quartz fused, conchoidal fracture, Mohs 7–8, strength 150–300 MPa, porosity 0.1–0.5% |

**Diagnostic SDF structures:**

* **Foliation** — parallel alignment of platy minerals (mica) → SDF anisotropy: thin, continuous laminae that can be tightly folded (isoclinal folds, axial planes).
* **Gneissic banding** — 5–50 mm alternating light/dark bands, often folded / boudinaged (pinch-and-swell).
* **Augen** — eye-shaped porphyroblasts (feldspar) wrapped by foliation → ellipsoid SDF with deflected flow lines.
* **Slate / Phyllite cleavage** — perfectly planar fissility, can be split, with lineations.

Because metamorphic rocks inherit protolith layering then shear it, detail is *non-stationary*: bands vary in thickness, continuity, and are cut by later veins.

---

### 5. Weathering & Erosion — The Detail Generators

Weathering is the breakdown that *creates* rock detail after formation. Distinguishing its types is essential for realistic SDF displacement.

#### 5.1 Physical (Mechanical) — no chemical change

| Process | Mechanism | Scale | Rock preference | SDF expression |
|---------|-----------|-------|-----------------|----------------|
| **Pressure-release exfoliation** | Overburden removed → rock expands → sheet joints parallel to surface, 0.05–3 m thick | massive plutonic terrains | granite, gneiss | *Subtract curved SDF sheets* concentric to surface, large dome forms, not noise |
| **Thermal spalling** | Daily 0–50 °C surface cycles → outer 1–5 cm expansion/contraction | arid deserts | dark igneous | thin flake subtraction, granular disintegration |
| **Frost wedging (freeze-thaw)** | Water in cracks → 9% expansion on freezing | periglacial | well-jointed | crack widening along SDF Voronoi borders |
| **Salt crystallisation** | Saline water evaporates → crystals exert pressure | coastal / arid | sandstone, limestone | *Tafoni*: interconnected spherical voids along bedding |
| **Root wedging / bioturbation** | biological growth pressure | — | — | sparse tensile cracks (minor) |

#### 5.2 Chemical — mineral alteration, occurs in solution

| Reaction | What it does | Product | Controls detail |
|----------|--------------|---------|-----------------|
| **Hydrolysis** | Feldspar + water → clay (kaolinite) + ions | clays | Granite feldspars pit preferentially vs quartz → differential relief at grain scale |
| **Oxidation** | Fe-minerals + O₂ → iron oxides (rust) | hematite / limonite staining | Red/brown Liesegang rings, desert varnish |
| **Carbonation / Dissolution** | Calcite + H₂CO₃ → Ca²⁺ + HCO₃⁻ (soluble) | karst | Entire landforms dissolved → karren, caves |
| **Hydration** | Anhydrite → gypsum (+60% volume) | expansion → spheroidal shells | Outer rind expansion → concentric shells that spall |

**Spheroidal vs Exfoliation (frequently confused):**

* *Spheroidal weathering* is **chemical**, operates block-by-block: joints subdivide bedrock into rough cubes; water attacks corners (3 faces) > edges (2) > faces (1) → concentric altered rinds (saprolite) that peel like onion, leaving rounded corestones / woolsacks. Warm humid climate, thousands–millions of years, granite/gabbro/basalt. Result: freestanding rounded boulders NOT from river transport.
* *Exfoliation* is **mechanical**, massive body peeling large curved sheets due to unloading / thermal cycles; forms domes and sheet joints that can extend 250 ft deep (far deeper than thermal penetration). Yosemite domes are exfoliation, not spheroidal.

SDF must handle both: spheroidal = rounding that is *curvature-dependent* (convex corners round faster); exfoliation = *parallel sheet subtraction* oriented to free surface.

#### 5.3 Differential Weathering & Erosion

Where hardness contrasts exist (e.g., cemented sandstone bands vs softer interbeds, foliation in gneiss), softer material erodes faster → stepped topography, overhangs, pedestals, flutes. In SDF terms: erosion rate = `f(hardness, porosity, exposure, chemistry)`, not uniform displacement. Curves: softer bands recess 2–10× faster.

Fluvial erosion carves V-shaped gullies; glacial plucks and striates; aeolian sandblasts produce ventifacts (one-sided polish + pits) and honeycomb.

#### 5.4 Karst as System

Named after Kras plateau (Slovenia). Operates only on soluble rocks (limestone, dolomite, gypsum). Full system: surface karren (mm–cm grooves) → sinkholes (dolines, coalesce to uvalas, then poljes km-scale) → swallow holes (ponors) where streams disappear → underground conduits / caves with speleothems → springs. Timescale >10⁴ years, controlled by water chemistry, flow rate, joint spacing.

---

### 6. Grain-Scale to Landscape-Scale Detail Budget

Real rocks show detail across 5 orders of magnitude; tilable noise with single frequency cannot reproduce this because geological processes operate at different spatial frequencies *for different reasons*.

| Scale | Process | Typical size | Example | SDF technique (not noise) |
|-------|---------|--------------|---------|----------------------------|
| 0.1–5 mm | Crystal faces / cement | grain | quartz interlock in granite; quartz sand grains | Voronoi cells with facet planes + hardness-differential pitting |
| 5–50 mm | Vesicles / pits / Liesegang | inclusion | basalt vesicles; sandstone Liesegang bands | Sparse spherical voids / concentric SDF shells at band boundaries |
| 10–200 mm | Bedding laminae / foliation | layer | shale fissility; gneiss banding; sandstone foresets | Warped layered SDF with varying thickness, truncated by erosion surfaces |
| 0.2–3 m | Joints / columns / exfoliation sheets | fracture | columnar joints; sheet joints; cross-bed sets | Voronoi fracture planes + hex grid; parallel SDF sheets |
| 1–50 m | Folds / karst conduits / talus | landform | anticline; cave; exfoliation dome | Domain-warped sinusoids (fold), meandering tunnel SDF, talus via instanced scree SDF |

---

### 7. Hardcoded Lithology Presets — Engineering Numbers

These are not artistic sliders; they are collapsed geology. Every preset encodes a measured point in lithology space.

| Preset | Protogenesis | Texture | Density | Hardness (Mohs) | Porosity | Grain [mm] | Strength [MPa] | Weathering style | Key visual |
|--------|--------------|---------|---------|-----------------|----------|------------|----------------|------------------|------------|
| **Granite-Core** | intrusive, 650–800 °C | phaneritic | 2.65 | 6.5 | 0.8% | 4–12 | 180 | exfoliation + spheroidal | pink K-feldspar + black biotite, low vesicles |
| **Granite-Porphyry** | intrusive, 2-stage cooling | porphyritic | 2.67 | 6.5 | 0.9% | 12–30 phenocrysts | 160 | same + phenocryst relief | large feldspar eyes |
| **Basalt-Columnar** | extrusive, 1100 °C | aphanitic, columnar | 2.91 | 6.0 | 0.5% | <0.3 | 220 | columnar joints + vesicles | hexagonal pillars, chisel marks |
| **Sandstone-Buff** | clastic, aeolian | clastic grains | 2.32 | 6.5 (quartz) | 14% | 0.2–0.6 | 65 | honeycomb + cross-bedding | tabular cross-sets, tan/buff, Liesegang |
| **Sandstone-Red** | clastic, fluvial, Fe cement | clastic | 2.45 | 6.5 | 9% | 0.3–1.0 | 85 | differential cement → steps | deep red foresets |
| **Limestone-Karst** | chemical, marine | massive + stylolitic | 2.42 | 3.5 | 11% | 0.05–0.5 | 75 | karst dissolution | creamy grey, stylolites, karren, fossil voids |
| **Shale-Slate** | mudstone → low metamorphism | fissile, slaty cleavage | 2.68 | 5.5 | 0.4% | <0.01 | 140 | fissile splitting | dark grey, paper laminae, tight folds |
| **Gneiss-Banded** | high-grade metamorphic | foliated, banded | 2.82 | 6.5 | 0.7% | 1–8 (banded) | 170 | differential band erosion | pink/white felsic vs black mafic bands, augen, boudins |
| **Quartzite** | meta-sandstone | non-foliated crystalline | 2.65 | 7.5 | 0.3% | 0.4–1.2 | 240 | conchoidal, vitreous | glassy quartz mosaic |

Derived SDF parameters (not shown to artist): erosionRate = hardness⁻¹ × porosity^0.5 × exposure; exfoliationSpacing = 0.08–0.25 m (granite) vs 0.5–2 m (columnar diameter); stylolite amplitude 2–15 mm; cross-set dip 15–32°; vesicle density 0–80 /m³ concentrated at flow tops.

---

### 8. Why Tilable Noise Fails Photorealism

1. **Repetition artefact** — real bedding thickness varies 5× within one outcrop controlled by depositional energy; tilable noise repeats every N metres, eye detects it instantly.
2. **Wrong topology** — noise creates isotropic bumps; real joints are *planar truncations* (Voronoi faces), exfoliation sheets are *surface-parallel*, cross-beds are *inclined and truncated*, karst is *connected tunnels*, not blobby displacement.
3. **No causality** — real detail follows exposure: corners round first, south-facing weathers faster, softer bands recess, water follows gradient. Noise has no exposure input.
4. **Missing hierarchy** — geology simultaneously carries 0.5 mm grain pitting + 2 m columnar joints + 20 m folds. Single octave noise cannot host all without looking procedurally synthetic.
5. **Material contradiction** — granite with limestone-like porosity or sandstone without bedding instantly reads as fake to geologists; hardcoded lithology constraints prevent this.

**Correct approach:** SDF domain operations that *simulate formation* — warped strata (fold), Voronoi fractures (cooling / tectonic joints), curvature-driven rounding (spheroidal weathering), surface-parallel sheet subtraction (exfoliation), meandering tunnel subtraction (karst), sparse void injection (vesicles) — all seeded by non-repeating hash, not periodic noise lookup.

---

### 9. References

* USGS FAQs: What are igneous / sedimentary / metamorphic rocks?
* Geological Science: Physical & Mechanical Properties of Granite; Basalt vs Granite differences
* Sternberg Museum, CK-12, Flexbooks rock cycle; Sci. Notes classification
* GeoLearning FU Berlin: Physical weathering zones of weakness, exfoliation vs spheroidal
* Geologyin.com: spheroidal vs exfoliation mechanisms, cross-bedding formation
* Carleton SERC: cross-bed formation & stratigraphic up indicators; Geological Digressions tabular/trough facies
* LibreTexts Geosciences: sedimentary structures, flow regimes, weathering & karst
* U. Regina Geog 323: weathering functions; EarthSci.org joint & spheroidal rind formation
* Wikipedia: Spheroidal weathering, Exfoliating granite, Cross-bedding, Rock (geology)
* Attewell & Farmer 1976 strength/porosity table (via oocities)
* Citadel Stone Mohs & durability; Build-Construct stone property ranges

*SDF precedent:* Inigo Quilez distance functions & domain warping; Mercury hg_sdf; Keeter potential for SDF optimisation; Frontier Engine SDF & traversal precedent (References/RestirPhaseR2...).

All tables above collapse to `Engine/LithicFormation/RockFormationSpecification.h` presets — the source of truth for both CPU and GPU SDF.


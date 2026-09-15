# Rock terrain formation research → SDF design

**Research date:** 2026-09-15
**Implementation:** `Projects/Project-Zero/Source/RockTerrainSpace.cpp` and `Engine/Shaders/RockTerrainSdf.slang`

This is the geological basis for the rock field. The implementation intentionally does **not** use a seamless noise image, UV tiling, or a library of repeated boulder primitives. The field is a finite, seeded history evaluated in world coordinates. The seed only chooses finite event populations and mineral/grain positions; it does not create a repeat period.

## What the references say

| Observation | Geological implication | SDF consequence |
|---|---|---|
| Sedimentary rock forms through weathering, transport, deposition, burial/compaction and cementation. The resulting beds are not just sinusoidal stripes; bed thickness, cement and cross-cutting events vary. | A sedimentary outcrop needs a depositional coordinate, variable bed thickness, cement contrast and later erosion. | `BedCoordinate` is warped by a finite stress/deposition field. `Bedding`, hardness, water access and bed relief are carried as field attributes. |
| A joint is an extension fracture. Joints let water and air into granite and strongly influence the shape and distribution of pinnacles. | Crack placement must be a mechanically meaningful finite event network, and weathering must be stronger beside cracks. | The field creates three non-identical stress families, finite fracture lengths, aperture variation and water-gated opening. It is not three infinite stripe masks. |
| Columnar jointing forms as lava cools and contracts. Fractures propagate inward from cooling surfaces; columns are commonly six-sided but can have three to seven sides, and entablature can be irregular. | Columns belong to a basalt cooling regime only. Spacing and fracture density should change with distance from the cooling surface. | Basalt uses a jittered Voronoi stress field, a depth-dependent cooling factor and a crack aperture. It does not force a regular hexagonal wallpaper on granite or sandstone. |
| Tafoni are cavernous weathering: often smooth, rounded cavities in granular rock, commonly on sheltered vertical/inclined faces. Salt crystallisation, evaporation, porosity, cement contrast and microclimate feedback are important; cavities can enlarge and nest. | A believable cavity population is sparse and event-driven, biased by exposure and transport, with different radii and cement resistance. | Pocket events are finite, seeded on exposed faces, individually oriented and scaled. Their activation is multiplied by water, salt and cement contrast. The result is a population of unequal cavities, not a honeycomb texture. |
| Granite exfoliation / onion-skin weathering is associated with unloading and expansion. NPS describes pressure release, cracks, water ingress and frost/chemical weathering. | Rounded sheets should be coupled to the formation boundary, stress joints and weathering access—not applied as concentric spheres. | The granite regime adds a shallow sheet field only in the surface band, while the actual recession is controlled by joint, water and hardness attributes. |
| Conchoidal fracture is a smooth shell-like break characteristic of brittle, fine-grained or glassy material such as chert and obsidian; it is not a generic rock surface pattern. | Conchoidal chips need an impact/fracture event and should be restricted to an appropriate lithology. | Chert and basalt can receive finite impact-cap events with curved bowl and ripple terms. The default granite regime does not get fake shell ripples. |
| Weathering is differential: physical disintegration, chemical alteration, salt/frost action and abrasion do not act at the same rate everywhere. Erosion transports the products; weathering changes the rock in place. | Detail needs linked causality: permeability → water/salt access → hardness loss → cavity/crack growth → debris. | `WaterFlux`, `Salt`, `Hardness`, `Debris`, `Oxidation` and `Fracture` are sampled alongside distance and participate in the distance field. |

## Sources

1. National Park Service, **Geological Features — City of Rocks National Reserve**. Describes joint sets controlling spires, tafoni as cavernous weathering, sheltered-face occurrence and salt crystallisation.
   https://www.nps.gov/ciro/learn/nature/geological-features.htm
2. National Park Service, **Tafoni**. Describes calcite cement dissolution, moisture wicking, evaporation, hardened bands, nested cavities and positive feedback.
   https://www.nps.gov/articles/tafoni.htm
3. National Park Service, **Columnar Jointing — Volcanoes, Craters & Lava Flows**. Describes cooling/contraction, fracture propagation from top and bottom, and predominantly polygonal columns.
   https://home.nps.gov/subjects/volcanoes/columnar-jointing.htm
4. National Park Service, **Station 4: Joints — City of Rocks**. Describes joints as extension fractures and their role as channels for water and air.
   https://www.nps.gov/places/geological-trail-station-4.htm
5. National Park Service, **Virtual Roots of Pikes Peak — Onion-Skin Weathering**. Describes pressure release, expansion, cracks, water, frost/chemical weathering and sheet removal in granite.
   https://www.nps.gov/flfo/learn/nature/virtual-roots-of-pikes-peak.htm
6. USGS, **Dikes, joints, and faults in the upper mantle**. Distinguishes tensile joints, magma-filled dikes and shear faults, and discusses repeated fracture episodes and fluid pressure.
   https://www.usgs.gov/publications/dikes-joints-and-faults-upper-mantle
7. Thomas R. Paradise, **Tafoni and Other Rock Basins**. Review of differential weathering, lithology, porosity/permeability, salt mobility, microclimate and cavity-scale evolution.
   https://www.researchgate.net/publication/269102259_Tafoni_and_Rock_Basins
8. OpenGeology, **Weathering, Erosion, and Sedimentary Rocks**. Describes salt expansion and precipitation in cracks as one cause of tafoni.
   https://opengeology.org/textbook/5-weathering-erosion-and-sedimentary-rocks/
9. Cambridge University Press, **Conchoidal Fracture of Flint**; Mindat, **Definition of conchoidal fracture**. Used for the distinction between curved shell-like fracture and planar cleavage.
   https://www.cambridge.org/core/journals/geological-magazine/article/abs/conchoidal-fracture-of-flint/2F55256A76E7DD69FF2CEFDB1BA161A6
   https://www.mindat.org/glossary/conchoidal_fracture

## Translation to the field

The sign convention is `distance < 0` for solid rock and `distance > 0` for air. A sample contains both a distance and process attributes. Those attributes are not decorative masks: they gate where the physical event is allowed to modify the distance.

1. **Finite formation mass:** a warped outcrop footprint, top surface and buried base provide the parent body. The parent is an outcrop/terrain volume, not a stack of balls.
2. **Lithology:** the selected regime activates only the structures that make sense for that material. Granite, sandstone, basalt, chert and schist do not share the same detail recipe.
3. **Fabric:** grain cells use a non-periodic integer hash in the finite volume. Mineral boundaries affect hardness and surface relief in the narrow surface band.
4. **Structural weakness:** fracture events have origin, normal, tangent, finite length, aperture, weakness and optional displacement. Water access increases their damage.
5. **Weathering feedback:** water flux, porosity, salt, exposure, insolation, freeze-thaw and wind abrasion change recession and debris. Tafoni events are sparse, face-biased and cement-aware.
6. **Sculpting:** user strokes run after formation. Add, remove, smooth-to-formation and sharpen-fracture are edits to the SDF; they do not overwrite the geological field or paint a normal map.
7. **Live rendering:** sphere tracing samples the continuous field and derives the normal from central differences. CPU extraction exists for proxy/collision/export only, so its triangle resolution does not cap the detail seen in the SDF viewport.

## What is intentionally not claimed

This is a physically informed procedural field, not a geological simulator capable of predicting a particular outcrop. Real rock requires measured mineralogy, thermal history, stress history, porosity, climate and time integration. The implementation therefore exposes these as inspectable controls and keeps the process fields separate, rather than claiming that one generic noise function is “real rock.”

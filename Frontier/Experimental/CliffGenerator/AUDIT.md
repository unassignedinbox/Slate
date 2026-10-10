# Terrain generator: erosion fix and code audit (for review)

## Fixed in this pass: "digital" erosion

**Cause (measured):** the rill pass (`rillErosion`, `src/fluvial.js`) cut *every* slope cell toward its
D8 receiver, starting from a drainage area of one cell. Routing noise was only 0.8 m over 45 m, so the
cuts ran as ruled, parallel, grid-aligned lines.

**Change:**
- rills start only where drainage has collected (`initCells`, default 10 cells) and ramp up smoothly,
  so they branch and taper;
- routing wander is 2 m over a 30 m wavelength, so the routes bend;
- the cut band gets a light blur, so the cut is a smooth V rather than a cell-sized stair.

**Test (Alpine granite, 256²):** grid bias (how strongly slope directions snap to the 8 D8 directions;
0 = isotropic, 1 = fully snapped) dropped from 0.021 to 0.007. Roughness is not reduced, and the
visual change at 4 m cells is small. Droplet trails still give the gully streaks.

**Still open (not fixed):**
- The stream-power pass (`fluvialErosion`) routes on the raw surface with no wander.
- The droplet pass (`hydraulicErosion`) leaves trail-like grooves. Its brush and deposition are untested
  for this look.
- `thermalErosion` slumps over 8 neighbours, which can leave diagonal bias.

## Code audit (found by reading; not all reproduced)

1. **Stale saved settings override new defaults** (`src/main.js`). Any `SCHEMA` bump resets user settings
   silently, and saved values beat preset edits. This caused the "no visual change" reports. Consider a
   visible "settings changed" notice, or per-key migration.
2. **Channels are carved on the simulation grid** (`src/hydrology.js`, carve loop). One height per cell
   gives cell-sized bank terraces. The blur in this pass only reduces it. The root fix is a continuous
   channel profile, or carving at mesh resolution.
3. **Water edge is a binary per-cell mask** (`simulateRivers`, `waterLevel`). The shore is stair-stepped in
   top-down views. `continuousWaterLevel` only helps the shader's paint, not the mask.
4. **Overloaded attribute channels.** `aux2.z` carries lake water, lake beds, and silt masks. `aux2.y`
   carries river mask and bed. Changes are easy to get wrong because the channels mean different things
   in different places. A separate attribute for sediment would be cleaner.
5. **No directional flow.** Wetness and streaks use a scalar drainage area, not a flow vector field. Gaea
   orients streaks and gravel with flow maps; the current texture cannot follow a flow direction.
6. **Silt needs thick sediment near water.** The silt mask in `src/pipeline.js` now uses slope and distance
   to water. Lake and alluvium thresholds are hand-tuned constants and were only checked on 4 presets.
7. **Wet-cell loss from smoothing.** The bank blur reduced wet cells by 15–20% versus the pre-smoothing
   carve. The channel core is now excluded, but the balance is not tuned.
8. **Thermal erosion** (`src/erosion.js`) uses an 8-neighbour slump, which can leave diagonal bias.
   Mass is conserved, but the look has not been checked.
9. **Performance.** `normalisePercentile` copies and sorts a full field on every call, and `fillDepressions`
   runs several times per pass. Fine at 512², but it will matter at higher resolutions.

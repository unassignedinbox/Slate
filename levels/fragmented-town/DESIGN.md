# Section 1 — Tallow Hill (greybox)

*The town that forgot the ground.*

A car race through a town that has broken loose from the earth. Three shelves of ground, each with its own streets and roofs, hang in a grey void. The road is the only thing still holding them together. You drive one-way through them, and portals carry you from one shelf to the next. There are no laps.

This document is the level design for Section 1. The layout itself lives in `layout.js`, so the numbers here can always be checked against the code.

---

## 1. Intent

| Pillar | What it means on the page |
|---|---|
| **Broken, not destroyed** | Buildings are cracked into slices with dark gaps. Furniture and debris drift. Nothing is on fire. |
| **The path always makes sense** | Streets, roofs and spans form one continuous line. You can always see where to go. |
| **Wrong physics, honest car** | The world floats and the road breathes, but the car behaves predictably. Falling off means losing time, not your mind. |
| **Worlds, not levels** | Portals move you between shelves inside one section. It is one place, not a loading screen. |
| **Tone** | Quiet, weathered, big sky, lived-in. Not neon, not cyberpunk, not Gen-Z, not nerdy. The palette is grey, stone and muted brass. |

---

## 2. Structure

Three shelves. Two portals. One finish.

```
 Market Shelf            Chapel Shelf               Mill Shelf
 ┌──────────┐            ┌──────────┐               ┌──────────┐
 │  START   │            │ ARRIVAL  │               │ ARRIVAL  │
 │ ───Leg 1──► CP1 ==portal==► ───Leg 2──► CP2 ==portal==► ───Leg 3──► FINISH
 └──────────┘            └──────────┘               └──────────┘
```

| Leg | Shard | Length | Gap jumps | Par (autopilot) | What you do |
|---|---|---|---|---|---|
| **1 · Market Shelf** | `market` | 1097.5 m | none | **47.0 s** | Streets, then a climb onto the warehouse roof, a roof run, and a drop back to the street. |
| **2 · Chapel Shelf** | `chapel` | 829.5 m | one 12.5 m gap | **34.6 s** | A raised span over a hole, a ramp run-up and a jump, then the chapel hall roof. |
| **3 · Mill Shelf** | `mill` | 821 m | none | **34.7 s** | Bridges over holes around the mill. Finish at the gate. |

- **Par** is what the headless autopilot takes using the same car physics the player uses. It is a fast but not perfect driver, so a human will be slower. Par is a floor for the design rule, not a target for the player.
- **Total race time** (autopilot): **116.4 s**.
- Every leg is at least **30 s**. That is a hard rule in `layout.js` (`minLegSeconds`) and the checker fails the build if it is broken.
- There are **no laps**. The validator flags any leg that comes back within 9 m of its own earlier road.

---

## 3. Beats

**Market Shelf (Leg 1): the warm-up.**
Narrow streets with the town crowding in, and debris turning overhead. The first thing the player should learn is "the road is solid, stay on it". The leg then climbs a ramp onto a warehouse roof. That roof is the first moment the world feels wrong on purpose: the road rides above the buildings, and the buildings are not under it. The roof drops back to the street at the end, and the portal sits at the top of the hill.

**Chapel Shelf (Leg 2): the commitment.**
Arrival. A span crosses a hole, so the road itself is the bridge. Then a ramp run-up to a **12.5 m fracture gap** where the road is simply gone. The player has to choose a speed and jump. Minimum speed for the jump is around 19 m/s, and the autopilot cleared it with no respawns. After the gap the chapel hall roof, then down to the second portal.

**Mill Shelf (Leg 3): the finish.**
Arrival in the last shelf. Streets bend around the mill, with two bridges over holes, and the road ends at the finish gate.

---

## 4. Rules the road and the town obey

These are enforced in `town.js` and `check.mjs`, not by eye.

1. **Road is continuous** except for explicit `gap` segments. A gap must be 16 m or less.
2. **No road through a building.** Road inside a footprint must be above its roof (`roofHeadroom`, 0.2 m above the top).
3. **Streets keep 7 m from walls** (`clearance`). Generated buildings are placed only where this holds.
4. **Hand-placed roof blocks** must pass the same rules. The road sits on top, and the validator warns if it floats more than 6 m above a roof.
5. **Ground-level road may not sit over a hole.** Holes can only be crossed as `bridge` (or `roof`, `ramp` leading onto a roof).
6. **Road stays inside its shard.** A shard must be large enough for its legs. (The chapel shard was enlarged to 720 m for this reason.)
7. **No accidental loops.** Legs may not pass within 9 m of their own earlier road.
8. **Every leg is at least 30 s** at autopilot pace, with zero respawns.

---

## 5. How the floating road moves

The road is never still, and the car rides the same motion you see.

- Each road sample is shifted up and down by three travelling sine waves, wavelengths about 92 m, 47 m and 23 m, with periods of about 9, 13 and 5.5 seconds. This reads as a wave rolling through the road, not random jitter.
- A smaller sideways sway (visual only) makes the road look like it is breathing.
- The **wave is weighted by road type**: full on streets, half on roofs and ramps, 0.85 on bridges, and fading to zero within 10 m of a gap, so landings stay stable.
- Road tiles are 8 m long, and the 0.35 m gaps between them are the visible fracture seams.
- Each shard bobs as a whole, on its own period (41 to 53 s), and everything on it bobs with it.

Buildings are cracked into 2–3 slices per building. Slices bob by 3–12 cm on periods of 6 to 14 s. Some slices are tilted a few degrees. Dark interiors show through the gaps. Props float with a slow tumble, and debris drifts.

---

## 6. Physics (the wrong-gravity part)

- **Gravity is 6.5 m/s²**, deliberately low. Airborne cars float and land softly, and the air is less punishing.
- **On road**, the car is carried by the surface and takes its slope, so the launch arc on a ramp is correct.
- **Off road** the car has no grip and falls. After **3 s airborne** (or falling 60 m below the shard), it respawns **10 m back** along the road from the last place it was on the road.
- Props are solid. They bump the car and cost speed, but they never stop it dead.

Tuning lives in `greybox/src/sim/tuning.js`. Change numbers there and run the checker to see par times move.

---

## 7. Greybox legend

| Element | Look |
|---|---|
| Ground plates | Flat grey slabs, with broken rock hanging beneath |
| Holes | Missing plates. The road must bridge them |
| Street / ramp road | Mid grey, with a white centre line |
| Roof road | Lighter grey |
| Bridge road | Darker grey |
| Seams | Gaps between road tiles. These are the fracture |
| Buildings | Cracked grey boxes with window grids and dark gaps |
| Landmarks | Warehouse (flat roof), chapel tower with a spire, mill with turning sails |
| Furniture | Tables, chairs, beds, wardrobes, crates, barrels, lamps, benches, carts, stools |
| Debris | Small irregular rocks, drifting |
| Portals | Warm stone arch with a pale translucent pane. Finish pane is cooler |
| Route (map only) | Muted brass line |

---

## 8. Running it

```bash
cd greybox
npm install
npm run dev        # live preview on port 5173
npm run check      # validates the layout and prints par times; exit 1 on any failure
```

Controls: `W` throttle, `S` brake / reverse, `A` `D` steer, `Space` handbrake, `R` back to the road, `Shift+R` restart, `O` map (orbit), `P` pause.

---

## 9. Known gaps (greybox, on purpose)

- Road edges are not walls. Driving off the side drops you, and a respawn fixes it.
- Prop collisions are simple spheres. Buildings are box collisions. Neither is tuned for feel yet.
- The visual sideways sway of the road does not move the car laterally. Within the 9 m road it does not matter, but it can look slightly off at the edges.
- No audio, no lighting pass, no shadows.
- Performance has not been profiled. The scene is roughly 1,500–2,000 draw calls in total, which is fine for a greybox but will need merging before production.

---

## 10. Questions for you (next session)

1. **Human pace.** Is 35–47 s per leg about right, or do you want the legs longer or shorter after playtesting?
2. **The gap.** Is a 12.5 m jump at about 19+ m/s the right level of challenge for Chapel Shelf, or should there be a second, easier route around it?
3. **Portal feel.** Should checkpoints look more like windows into the other shelf (you can see through), or stay as arches?
4. **Shelves.** Three shelves feels right for Section 1. Do you want a fourth shelf, or should some of the town be pushed off the edges of the map?
5. **Tone check.** The greybox is deliberately bare. Is the grey-stone-brass direction right before we add material or colour?

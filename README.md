# Slate — Realistic 3D Bald Eagle

A fully **3D** (no 2D sprites/planes) procedurally-modelled bald eagle
(*Haliaeetus leucocephalus*) with six accurate animation cycles, built with
[Three.js](https://threejs.org/). Runs in the browser — no build step.

## Run

```bash
npm start          # python3 -m http.server 8000 --bind 0.0.0.0
# open http://localhost:8000
```

(Three.js is loaded from a CDN via an import map, so no bundling is required.)

## Controls

- **Drag** orbit · **Scroll** zoom · **Right-drag** pan
- Animation buttons: **Idle · Wing Flap · Glide · Walk · Screech · Head Turn**
- Playback **speed** slider, **orbit camera**, **ground** and **wireframe** toggles

## Model (anatomy)

All geometry is real 3D (ellipsoids, capsules, and extruded feather blades with
shafts and camber — every feather has thickness, nothing is a flat plane).
Proportions and feather counts follow real references:

- **10 primaries** (p1–p10) with emarginated finger-tips, **14 secondaries**,
  **3 tertials**, and a layer of greater/lesser **coverts** per wing
- **12 tail rectrices** in a fan
- White head & tail, dark brown/grey body and wings, yellow hooked beak & cere,
  amber eyes, pronounced brow ridge, and unfeathered scaly yellow tarsi with
  heavy dark talons (3 forward toes + hallux)
- Measured wingspan ≈ **2.15 m** (real bald eagle 2.0–2.3 m)

Sources: Birds of the World (Cornell) plumage/structure account and the USFWS
Feather Atlas identification guides.

## Animations

A single smoothed-pose rig (`src/animations.js`) drives nested joint groups, so
motion propagates naturally and transitions crossfade automatically. Each cycle
includes secondary motion:

| Cycle | Primary motion | Secondary motion |
|-------|----------------|------------------|
| **Idle** | breathing, weight shift | alert head glances, feather settle |
| **Wing Flap** | fold on upstroke, thrust on downstroke | body lift, feather flex, open wingtip slots, gaze stabilisation, tail work |
| **Glide** | shallow-dihedral soar | slotted fingertip primaries, fanned tail, slow bank, turbulence flex |
| **Walk** | alternating stride, knee lift | body sway + double-bob, avian head-bob, raised counter-balancing tail |
| **Screech** | head thrown back, gaping beak | call vibrato, flared wings, bristled hackles, chest recoil |
| **Head Turn** | sharp raptor snaps & held scans | double-take tick, look-up, neck follow-through, head bank |

## Structure

```
index.html          # canvas, UI, import map
src/style.css       # UI styling
src/eagle.js        # procedural model + rig (feathers, beak, legs, talons)
src/animations.js   # pose-based animator + the six animation cycles
src/main.js         # scene, lights, shadows, camera, UI wiring, render loop
```

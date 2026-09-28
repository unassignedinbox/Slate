# Tyrannosaurus rex — procedural skeleton & locomotion rig

A real-time 3-D *Tyrannosaurus rex* **skeleton** (no flesh) built entirely from
procedural geometry, rigged as an actual joint hierarchy, and animated with
physically-reasoned locomotion and secondary motion.

Run it:

```bash
npm install
npm run dev        # http://localhost:5173
```

## The bones

Nothing here is a cylinder standing in for a bone. `src/boneKit.js` provides a
sweep engine that runs an **elliptical (optionally super-elliptical) cross
section along a curved 3-D path**, with the width and depth varying
independently, so every element has a narrow shaft, expanded epiphyses,
blade-like processes and real volume. On top of that:

* `plate()` — thin bevelled bone plates (ilium, coracoid, pubic apron)
* `blob()` — condyles, trochanters, bosses, horn cores
* `roughen()` — size-aware micro-relief along vertex normals (rugosities)
* `weather()` — baked vertex-colour staining and grain

`src/skeleton.js` builds the animal element by element, at **FMNH PR 2081
("Sue") proportions**: skull 1.53 m, femur 1.32 m, tibia 1.15 m, arctometatarsalian
metatarsus 0.72 m, ~3.05 m hip height, ~10.5 m in a standing pose.

* **Skull** — a fenestrated strut architecture, exactly like a mount: premaxilla,
  maxilla with dental and ascending rami, fused rugose nasals, lacrimal with
  horn, jugal, quadratojugal, postorbital boss, squamosal, quadrate, skull roof
  with sagittal crest, braincase with occipital condyle and paroccipital
  processes, palatal strut. Naris, antorbital fenestra, orbit and lateral
  temporal fenestra are genuine openings. 4 premaxillary + 12 maxillary +
  13 dentary teeth; separate mandible (dentary, surangular, angular, coronoid
  eminence, articular).
* **Column** — 10 cervical, 13 dorsal, 5 sacral, 40 caudal vertebrae. Each is
  built from a real centrum (hourglass, ball-ended), neural arch, neural spine
  blade, transverse processes, zygapophyses, plus cervical ribs and haemal
  arches (chevrons) where they belong. **Every vertebra is its own joint.**
* **Ribcage** — 13 pairs of curved, laterally-flattened ribs forming a basket,
  plus a gastralial belly basket.
* **Girdles and limbs** — strap scapula + coracoid, humerus, radius/ulna,
  two-fingered hand with recurved unguals; ilium/pubis (with boot) /ischium,
  femur with head, trochanters and condyles, tibia + fibula + astragalus with
  ascending process, pinched third metatarsal, three functional digits with
  phalanges and claws, plus the reversed hallux.

## The motion (`src/anim.js`)

* **Non-slip gait.** The hind limb is solved with analytic three-segment IK
  against a *world-anchored* foot trajectory: the body travels over a planted
  foot instead of the foot being swept under the body. The gait table enforces
  `speed = stride × freq / duty`, so measured per-frame foot slip is
  **< 1 mm walking**. Heel-strike, flat, and toe-off roll are separate phases.
* **Walk** 1.6 m/s, 2.20 m stride, 62 % duty. **Fast walk** 4.6 m/s, 2.61 m
  stride, 54 % duty — still no aerial phase, because an adult *T. rex* could not
  actually run; it just took faster, longer steps.
* **Tail and neck secondary motion.** A delay line records what the pelvis did,
  and each of the 40 caudals samples it with its own lag and gain through a
  critically damped spring. The result is a travelling wave with overshoot and
  settle — the tail leads, lags, and recoils instead of following a rigid sine.
  Total lateral excursion stays anatomically sane (≈ 0.45 m walking, 1.0 m at
  speed) and gravity sag straightens out as speed rises.
* **Head stabilisation.** The cervicals counter-rotate against pelvic yaw and
  bob so the skull stays comparatively still — the gaze-fixation behaviour you
  see in walking birds.
* **Idle** — breathing through the dorsal column, micro head drift, slow jaw
  slack; no static drift anywhere.
* **Roar** — inhale and coil, lunge, ~65° gape with a vocal tremor through the
  jaw and head, body recoil, then settle.
* **Sniff** — head swings down and sweeps, rapid nasal pulses (jaw flutter),
  scent-tracking yaw/roll, then lifts.

Controls: `1` `2` `3` gait · `R` roar · `S` sniff · `F` follow camera · drag to
orbit.

`docs/` holds stills produced by `.shots/render.mjs`, a dependency-free CPU
rasteriser used to verify the rig headlessly (no GPU in CI).

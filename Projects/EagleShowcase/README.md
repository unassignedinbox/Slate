# Eagle Showcase

A real-time WebGL2 bald eagle (*Haliaeetus leucocephalus*) — 3D model, 3D rig, 3D animation. No sprites, no
pre-baked vertex caches: the bird is generated procedurally at load, skinned on the GPU, and driven by six
hand-authored motion clips plus a spring-dynamics pass for secondary motion.

## Running it

```
node serve.mjs          # static server, http://<host>:8080
```

Open the page and use:

| Key | Action |
| --- | --- |
| `1` | Wing flap cycle (2.4 Hz, 0.4167 s) |
| `2` | Glide / soar (9 s of thermal drift) |
| `3` | Walk cycle on the ground (1.15 s stride) |
| `4` | Idle — perched, breathing, rousing, foot shifts (12 s) |
| `5` | Screech (4.2 s) |
| `6` | Head turn (6.4 s, ~170°) |
| `Space` | Pause |
| `O` | Toggle orbit camera |

Clips crossfade over 0.55 s, so switching mid-cycle is continuous.

## Anatomy

Proportions come from measured skeletal material rather than eyeballing: Royal BC Museum avian osteology tables
and Trail's bald-vs-golden eagle bone key give humerus 201 mm, ulna 233 mm, radius 221 mm, carpometacarpus
109 mm, coracoid 80 mm, femur ~155 mm; Wikipedia/BirdLife give body length 0.94 m, wingspan 2.10 m, mass 4.8 kg,
tail 0.30 m, tarsus 0.10 m.

- **349 joints.** Axial chain (pelvis → spine → chest → 5 cervicals → skull → jaw), two wings, two legs with an
  anisodactyl foot, and *one joint per feather*: 10 primaries, 17 secondaries and 3 alula quills per wing,
  12 rectrices, plus 7 covert rows per wing (greater, median, lesser, marginal, primary, under, under-primary),
  9 scapulars per side and 24 tail coverts.
- **~50 k vertices / ~98 k triangles**, built in ~0.2 s from lofted super-ellipse sections (torso, neck, skull,
  bill, legs) and a parametric feather generator (rachis taper, bell-curve vane profile, emarginated primary tips
  producing real wing slots, camber, droop).
- Frame convention: `+X` = bird's left, `+Y` = up, `+Z` = forward (bill). Metres, right-handed. The right side is
  an exact mirror across `X = 0`.

## Rig

- Bind pose is a mid-glide spread wing, so flight clips are small offsets from bind.
- **Feather aim constraint** (`MotionSequence.AimFeathers`): a folded wing cannot be authored as local Euler
  offsets — the forearm folds back through ~168° and every remex and covert has to be re-aimed. The constraint
  runs a throw-away FK pass, builds a full target frame per feather (shaft direction *and* dorsal reference, so
  vane roll is pinned and feathers shingle instead of turning into blades), and writes the local rotation that
  achieves it. Right-side feather geometry is reflected, so the target frame is reflected to match.
- `FoldedWing` + `ApplyFoldedWing(pose, side, extra, ruffle)` produce the perched wing; an `open` parameter
  part-deploys it for the rouse and the screech.
- Analytic 2-link leg IK with the intertarsal apex pointing aft (the "backwards knee"), toe curl and spread.

## Animation

Kinematics follow the published literature rather than guesswork:

- PLOS ONE 0063982 (3D skeletal kinematics of the avian wing): elbow flexion/extension range 91°, peak extension
  at ~46% of downstroke, peak flexion at ~45% of upstroke; the wrist stays extended until ~40% into the upstroke,
  then flexes rapidly; elbow and wrist lead the tip by 2–4%.
- Biomimetics 9090555 (joint decoupling): 3-DOF shoulder, 1-DOF elbow, 2-DOF wrist; shoulder sweep is small;
  shoulder/elbow/wrist yaw are strongly coupled with a ~0.1 T phase delay along the span.
- Biomimetics 11030212: the upstroke is shorter than the downstroke and the wing area is reduced on the upstroke.
- RoboFalcon (*Sci. Adv.* 2025) scaling gives ≈2.4 Hz and ≈85° amplitude at eagle size.

Body motion is part of every clip: trunk heave and surge, pitch counter-rotation through the spine, head
stabilisation through the cervical column, tail pitch opposing the body bob, banked turns in glide, and
locomotion (speed, turn rate, altitude, bank, pitch) integrated in `main.js`.

**Secondary motion** is a spring pass (`DynamicsSolver`): each feather joint carries bend and twist springs
driven by the velocity of its own tip, semi-implicit Euler, 2 substeps. Primaries 6.6 → 5.0 Hz, secondaries
8.2 Hz, coverts 9.5 → 21 Hz, rectrices 7 Hz, cervicals and tail base 3.4 → 5.2 Hz. This is what produces quill
flutter on the downstroke, the ripple across the covert rows, and the head/tail lag.

## Files

| File | Contents |
| --- | --- |
| `src/MathSpecification.js` | vectors, quaternions, 4×4s, noise, easing |
| `src/SkeletonStructure.js` | all 349 joints, bind pose, inverse binds, feather plan |
| `src/GeometryStructure.js` | vertex accumulation, lofting, super-ellipse sections |
| `src/FeatherStructure.js` | parametric feather mesh (vane profiles, slots, camber) |
| `src/EagleStructure.js` | the bird: torso, head, bill, eyes, legs, talons, all plumage |
| `src/MotionSequence.js` | pose space, aim constraint, the six clips |
| `src/DynamicsSolver.js` | feather / neck / tail spring dynamics |
| `src/RenderExchange.js` | WebGL2 programs: sky, GPU-skinned eagle, shadow depth, ground |
| `src/CameraProjection.js` | orbit / chase camera |
| `src/main.js` | clip selection, crossfade, locomotion integration, frame loop |

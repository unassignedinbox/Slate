# Level 01 · Fragmented Town (section 1, greybox)

In-world name: **Driftwick**. The town has been lifted off its foundations and
broke into pieces on the way up. It hangs in an empty sky with no clear down.
Houses still lean on each other, roads still run through the wreckage, and
furniture drifts past at roof height.

This is the first section of the level. It is a point-to-point time trial: from
the start arch to the finish arch, linked by portals that jump the car between
three far-apart zones of the same map. It is not a lap course.

## Creative rules (from the brief)

- No neon, no cyberpunk, no Gen-Z or "nerdy" references.
- Broken, fractured and floating, but grounded: things look like they used to
  be ordinary buildings and furniture.
- Roads must be a real, continuous path through the wreckage. Roofs and
  bridges are fine, but the route never has a gap a car cannot cross.
- The road moves: it should undulate gently and naturally, not in a forced
  pattern.

## Structure

| Zone | Name | Road | What's there |
| --- | --- | --- | --- |
| A | Chimney Row | 937 m (incl. 30 m runway) | A high street of fractured houses, both sides, with floating furniture. Start arch at the top of the runway. |
| B | Bell Stair | 856 m | A chapel with its tower pulled sideways, and a stair road spiralling 1¼ turns round it. Satellite houses float outside the spiral. |
| C | Mill Shelf | 1143 m | A rubble bridge with gentle rises and dips, over nothing. A mill wheel turns beside the deck. The finish arch is at the end. |

### Portals (checkpoints)

| Portal | Entry (end of zone) | Exit (start of zone) |
| --- | --- | --- |
| 1 | A · (820, 39, 2) | B · (-1055, 118, 440) |
| 2 | B · (-760, 164, 108) | C · (640, 60, -460) |

The gates are checkpoints in order: start → portal 1 → portal 2 → finish. You
cannot skip one. Falling out of the world puts you back at the last checkpoint
you passed, with no speed.

## How the greybox is built

- **Road.** Every zone's centreline is a centripetal Catmull-Rom spline through
  designer control points. It is resampled to 1 m, and cut into plates of 5.5–7.5
  m with a 14 cm crack between each. Each plate bobs on a travelling wave
  (46 m wavelength), so the road ripples as you drive over it.
- **Fractured houses.** Each house is walls, floors, roof planks and a chimney,
  split into 2–4 pieces per wall with gaps. Some pieces are missing, some are
  fallen or sagging, and tops are ragged. The house sways as one body, and each
  fragment drifts a little on its own. Thin dark cracks are painted on the walls.
- **Floating props.** Chairs, tables, wardrobes, beds, barrels, carts, lamps,
  wagon wheels and rubble. Each one bobs and slowly turns. Only the bulky pieces
  block the car; legs, spokes and pipes do not.
- **Placement rules.** Houses and props are rejected if they come within the
  road's clearance (road half-width + 1.2 m). `npm test` checks this against
  every solid's real oriented box, at car height.
- **Far islands.** Slabs in the distance, for scale only.

## Car

Arcade physics. The car sticks to whatever road is under its four wheels, so it
follows tilted and bobbing surfaces. Gravity only applies when it is airborne or
sliding down a slope. Solid pieces push back with a sphere-vs-box test.
Tuning lives in `src/engine/car.js`, in the `CAR` object.

## Controls

| Key | Action |
| --- | --- |
| W / S (↑ ↓) | Throttle / brake (reverse at standstill) |
| A / D (← →) | Steer |
| Space | Handbrake |
| R | Back to the last checkpoint (after finishing: restart) |
| C | Chase / cockpit camera |
| M | Route map overlay |
| G | Debug: route centrelines and wheel probes |
| O | Overview of the whole town |

Gamepad: left stick steers, RT throttle, LT brake, A handbrake, Y respawn, B camera.

## Verification

- `npm test`: determinism, road continuity, smooth routes, portal pairing,
  corridor clearance, respawn, fractured houses, and a full headless drive.
  The drive asserts that the car finishes, never falls, never hits scenery, and
  that every leg takes **at least 30 s** at autopilot pace.
- `npm run report`: prints zones, portals, counts and leg times.

Current autopilot run (cruise 26 m/s, through real physics):

| Leg | Time |
| --- | --- |
| Start → portal 1 | 36.5 s |
| Portal 1 exit → portal 2 | 38.3 s |
| Portal 2 exit → finish | 46.7 s |
| **Total** | **2:01.5** |

A human at full throttle (34 m/s top speed) will finish faster, but every leg
still needs more than 30 s of driving.

## Tuning the level

Edit `src/levels/fragmented-town/layout.js` only:

- `controlPoints` move the roads. Keep neighbouring points 60–110 m apart.
- `buildings` / `props` set density, sizes and clearance.
- `landmark` and `satellites` place the chapel, the mill and the floating houses.
- `portals` set which zone links to which.
- `seed` changes every house and prop; the road stays the same.

## Known limits (greybox)

- The autopilot finishes the course, but it is not a human driver. Tune the
  feel on the real controls.
- Scenery is boxes and primitives on purpose. There is no art pass yet.
- Shadows and about 2,300 items run without instancing. Fine for this, but
  batching is the first optimisation if frame rate drops.

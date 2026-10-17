// SECTION 1 — TALLOW HILL (fragmented town)
// ---------------------------------------------------------------------------
// This file is the level DESIGN. Change numbers here, then run `npm run check`
// in /greybox (or `node levels/fragmented-town/check.mjs`) to validate the layout
// and see par times. See DESIGN.md for the intent behind each choice.
//
// Units: metres. Axes: x = east, y = up, z = north. Each shard has its own local frame.
// Shards float in a void. Their world origin is `origin`, and they bob by `drift`.
//
// Race structure (one-way, no laps):
//   Start (Market Shelf) -> Leg 1 -> Checkpoint 1 (portal) ->
//   Chapel Shelf (portal exit) -> Leg 2 -> Checkpoint 2 (portal) ->
//   Mill Shelf (portal exit) -> Leg 3 -> FINISH
// Each leg is at least 30 s of driving. The checker enforces this.

export const LEVEL = {
  id: 'section-1-tallow-hill',
  title: 'Section 1 - Tallow Hill',
  subtitle: 'The town that forgot the ground',
  minLegSeconds: 30,       // design rule: every leg must take at least this long to drive
  maxLegSeconds: 120,      // sanity cap for an intended-to-be-driveable leg

  // ---- Shards (floating islands of the broken town) -----------------------
  shards: [
    {
      id: 'market',
      name: 'Market Shelf',
      seed: 1101,
      origin: [0, 0, 0],
      size: [520, 520],
      drift: { amp: 0.7, period: 41, phase: 0.0 },
      // Holes = missing ground. Road may cross a hole only as 'bridge' type.
      holes: [
        [-170, 60, -110, 150],
        [60, 60, 150, 120],
        [120, -190, 200, -140],
      ],
      // Hand-placed solids (the town's landmarks). Auto-buildings avoid these.
      landmarks: [
        { kind: 'hall', x: -70, z: 120, w: 44, d: 30, h: 17 },
      ],
      // Roof blocks: the road runs ON top of these. Road y must be at least h + 0.2.
      roofBlocks: [
        { kind: 'warehouse', x: 144, z: 20, w: 104, d: 48, h: 12.6 },
      ],
    },
    {
      id: 'chapel',
      name: 'Chapel Shelf',
      seed: 2202,
      origin: [930, 34, -600],
      size: [720, 720],          // wider than the others: the chapel road swings out to x = +345
      drift: { amp: 0.5, period: 53, phase: 1.3 },
      holes: [
        [-40, 40, 40, 140],
        [150, -200, 230, -150],
      ],
      landmarks: [
        { kind: 'tower', x: -120, z: -60, w: 14, d: 14, h: 34 },
      ],
      roofBlocks: [
        { kind: 'warehouse', x: 271, z: 200, w: 70, d: 28, h: 10.6 },
      ],
    },
    {
      id: 'mill',
      name: 'Mill Shelf',
      seed: 3303,
      origin: [-830, -26, 720],
      size: [520, 520],
      drift: { amp: 0.9, period: 47, phase: 2.2 },
      holes: [
        [-120, -20, -40, 40],
        [-95, -175, -45, -135],
      ],
      landmarks: [
        { kind: 'mill', x: 60, z: -60, w: 18, d: 18, h: 24 },
      ],
      roofBlocks: [],
    },
  ],

  // ---- Legs (the road) ------------------------------------------------------
  // points: [x, z, y, type]. The type applies to the segment that STARTS at that point.
  //   street | ramp | roof | bridge | gap   (see src/sim/centerline.js)
  // end: where the leg terminates. A checkpoint is a portal (it teleports you to the
  //      start of the next leg, which lives in another shard). A finish ends the run.
  legs: [
    {
      id: 'leg1',
      name: 'Market Shelf',
      shard: 'market',
      end: { kind: 'checkpoint', name: 'Checkpoint 1' },
      points: [
        [-220, -240, 0, 'street'],   // start, facing north
        [-222, -170, 0, 'street'],
        [-214, -100, 0, 'street'],
        [-172, -56, 0, 'street'],    // bend through the old lanes
        [-112, -40, 0, 'street'],
        [-52, -60, 0, 'street'],
        [-6, -40, 0, 'ramp'],        // climb onto the warehouse roof
        [40, -20, 6, 'ramp'],
        [82, 8, 13, 'roof'],         // roof run
        [150, 22, 13, 'roof'],
        [205, 40, 13, 'ramp'],       // roof drops back to the street
        [232, 80, 0, 'street'],
        [220, 150, 0, 'street'],
        [150, 190, 0, 'street'],
        [80, 178, 0, 'street'],
        [20, 210, 0, 'street'],
        [-50, 214, 0, 'street'],
        [-120, 200, 0, 'street'],    // CHECKPOINT 1 gate
      ],
    },
    {
      id: 'leg2',
      name: 'Chapel Shelf',
      shard: 'chapel',
      end: { kind: 'checkpoint', name: 'Checkpoint 2' },
      points: [
        [-200, 200, 0, 'street'],    // arrival (exit of Checkpoint 1)
        [-196, 130, 0, 'street'],
        [-150, 84, 0, 'street'],
        [-90, 70, 0, 'bridge'],      // raised span over a hole
        [-30, 90, 0, 'bridge'],
        [40, 96, 0, 'street'],
        [70, 110, 0, 'ramp'],        // run-up to the jump
        [104, 122, 4, 'gap'],        // 12 m fracture: the road is missing, you must fly it
        [113, 130, 4, 'street'],
        [150, 160, 4, 'street'],
        [180, 170, 4, 'ramp'],
        [226, 196, 11, 'roof'],      // roof of the chapel hall
        [290, 205, 11, 'roof'],
        [320, 190, 11, 'ramp'],
        [340, 170, 4, 'street'],
        [345, 120, 4, 'street'],
        [330, 70, 4, 'street'],
        [290, 40, 4, 'street'],      // CHECKPOINT 2 gate
      ],
    },
    {
      id: 'leg3',
      name: 'Mill Shelf',
      shard: 'mill',
      end: { kind: 'finish' },
      points: [
        [-230, -220, 0, 'street'],   // arrival (exit of Checkpoint 2)
        [-232, -150, 0, 'street'],
        [-200, -100, 0, 'street'],
        [-140, -80, 0, 'street'],
        [-100, -120, 0, 'bridge'],   // span over a hole
        [-60, -170, 0, 'bridge'],
        [-20, -200, 0, 'street'],
        [20, -210, 0, 'street'],
        [70, -190, 0, 'street'],
        [100, -140, 0, 'street'],
        [120, -90, 0, 'street'],
        [150, -40, 0, 'street'],
        [120, 10, 0, 'street'],
        [60, 40, 0, 'street'],
        [30, 90, 0, 'street'],       // FINISH gate
      ],
    },
  ],

  // Portal exits are implied: Checkpoint N's exit is the start of leg N+1.
};

export const SHARD_BY_ID = Object.fromEntries(LEVEL.shards.map((s) => [s.id, s]));

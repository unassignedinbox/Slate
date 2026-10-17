// ─────────────────────────────────────────────────────────────────────────────
//  FRAGMENTED TOWN — section 1 layout (designer-editable)
//
//  This file is the only place you need to touch to re-shape the level. The
//  roads, buildings, props and portals are generated from it, deterministically,
//  from `seed`. Units are metres. +Y is up.
//
//  The town (in-world name: Driftwick) has been lifted off its foundations. It
//  is split into zones that are far apart in the sky. A portal is a gate that
//  teleports the car to a gate in another zone. Zones are not separate levels:
//  they are all part of this one map, linked only by the portals.
//
//  Route rules:
//    • controlPoints are the spine of the road. Keep neighbouring points roughly
//      60–110 m apart so the road curves naturally instead of zig-zagging.
//    • The first zone (A) gets a `runway`: a straight lead-in before the start
//      arch, so the car is not spawned under the arch.
//    • Each zone's last point is where its portal (or the finish arch) sits.
//      Each zone's first point is where its exit portal drops the car.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: points along a rising spiral (used for the bell stair in zone B).
export function spiralPoints({ cx, cz, r, y0, rise, turns, a0 = Math.PI, steps = 16 }) {
  const out = [];
  const n = Math.round(steps * turns);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = a0 + turns * 2 * Math.PI * k;
    out.push([cx + r * Math.cos(a), y0 + rise * k, cz + r * Math.sin(a)]);
  }
  return out;
}

const SPIRAL_B = spiralPoints({ cx: -1000, cz: 300, r: 55, y0: 118, rise: 42, turns: 1.25, steps: 14 });

export const LAYOUT = {
  id: 'fragmented-town',
  name: 'Fragmented Town',
  inWorldName: 'Driftwick',
  section: 1,
  seed: 1908,

  // Road geometry (metres).
  roadWidth: 8,
  // Vertical drop below which a car is considered lost and is respawned.
  killY: -90,

  // Each zone's road and dressing. Three zones, three moods:
  //   A  Chimney Row — the high street, still hanging on by its chimneys.
  //   B  Bell Stair  — a broken chapel with a stair road spiralling round it.
  //   C  Mill Shelf  — a rubble bridge over nothing, ending at the mill yard.
  zones: [
    {
      id: 'A',
      name: 'Chimney Row',
      subtitle: 'The high street. It still remembers being a street.',
      style: 'street',
      runway: 30,
      controlPoints: [
        [0, 40, 0],
        [90, 41, 6],
        [170, 43, 48],
        [250, 46, 62],
        [320, 42, 26],
        [390, 35, -30],
        [460, 31, -72],
        [540, 33, -78],
        [610, 39, -36],
        [680, 43, 4],
        [750, 41, 26],
        [820, 39, 2],
      ],
      // Buildings (fractured houses) along both sides of the road.
      buildings: { spacing: [22, 30], chance: 0.5, width: [10, 14], depth: [8, 10], floors: [1, 3], startAt: 40 },
      // Floating furniture and debris, scattered around the road.
      props: { count: 46, roadside: [2.2, 22], height: [-8, 12] },
      kerbs: false,
      far: 16,
    },
    {
      id: 'B',
      name: 'Bell Stair',
      subtitle: 'A chapel with its tower pulled sideways. The road climbs round it.',
      style: 'stair',
      runway: 0,
      controlPoints: [
        [-1055, 118, 440],
        [-1055, 118, 380],
        ...SPIRAL_B,
        [-960, 163, 232],
        [-900, 166, 212],
        [-846, 168, 186],
        [-796, 166, 150],
        [-760, 164, 108],
      ],
      buildings: { spacing: [30, 40], chance: 0.35, width: [10, 13], depth: [8, 10], floors: [1, 2], startAt: 0 },
      // The chapel sits at the spiral's centre.
      landmark: {
        kind: 'chapel',
        at: [-1000, 112, 300],
        width: 18,
        depth: 16,
        floors: 3,
        floorH: 3.2,
      },
      // Satellite houses floating outside the spiral.
      satellites: { count: 9, ring: [78, 150], height: [96, 170] },
      props: { count: 50, roadside: [2.2, 18], height: [-6, 10], disc: { center: [-1000, 300], radius: [0, 44], height: [110, 150], count: 14 } },
      kerbs: true,
      far: 8,
    },
    {
      id: 'C',
      name: 'Mill Shelf',
      subtitle: 'A rubble bridge over nothing, with a mill wheel still turning.',
      style: 'bridge',
      runway: 0,
      controlPoints: [
        [640, 60, -460],
        [715, 64, -434],
        [790, 56, -402],
        [858, 50, -350],
        [898, 64, -276],
        [872, 80, -196],
        [800, 74, -140],
        [742, 58, -96],
        [700, 46, -24],
        [650, 56, 36],
        [566, 72, 64],
        [522, 86, 126],
        [534, 80, 196],
        [592, 72, 246],
        [660, 74, 262],
      ],
      buildings: { spacing: [40, 60], chance: 0.3, width: [10, 13], depth: [8, 10], floors: [1, 3], startAt: 60 },
      landmark: {
        kind: 'mill',
        atS: 0.78, // fraction along the zone's road
        side: -1,
        width: 12,
        depth: 10,
        floors: 3,
        floorH: 3.2,
        wheelRadius: 11,
      },
      props: { count: 40, roadside: [2.2, 20], height: [-10, 14] },
      kerbs: true,
      far: 12,
    },
  ],

  // Portal pairs. "end" of one zone links to "start" of another. Each entry is
  // a portal (a checkpoint); the finish arch closes the race after the last zone.
  portals: [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
  ],
};

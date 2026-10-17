// Section 2 - THE TILTED CITY: map frame, plates and the racing line.
//
// The city is built on three enormous plates of ground that tipped when the
// earth broke apart. P1 (THE HEIGHTS) is the long downhill avenue. P2 (MIDTOWN)
// is a 7°-tilted downtown where the route winds through the grid: boulevard,
// sharp turn into a side street, through a shattered office building, through an
// alley, through a parking garage, across a broken elevated road, and into the
// fallen tower. P3 (THE LOW END) is the terminus.
//
// The route is NOT a single straight road. It turns multiple times through the
// city grid, passes through building interiors, and has visible side streets,
// alleys, and intersections.
import * as THREE from 'three';
import { RouteBuilder } from '../../core/route.js';
import { MapFrame, Plate, PlaneSurf, DEG } from './plates.js';
import { V3 } from '../ctx.js';

export const S2 = {
  origin: V3(1218, 0, -1461),
  heading: 46,
  H0: 120,
  kicker: [0.55, 1.66, 3.33],
};

export function planSection2(ctx) {
  const map = new MapFrame(S2.origin, S2.heading);
  const motion = (p, f, a = 0.0028, b = 0.4) => ({
    rot: { x: a, y: a * 0.15, z: a * 0.8, f, p },
    bob: { a: b, f: f * 0.62, p: p + 1 },
  });

  // ---- P1: THE HEIGHTS
  const P1a = new Plate(ctx, map, { name: 'P1a', ref: [0, 0, S2.H0], pitch: 6, roll: 0, u0: -70, u1: 482, v0: -142, v1: 142, pivot: [205, 0], thick: 16, motion: motion(0.4, 0.2) });
  const f0 = P1a.localAtMap(255, 0);
  const k = 0.36, fn = V3(1, 0, -k).normalize();
  const fd = fn.x * f0.x + fn.z * f0.z;
  P1a.cuts.push([fn, fd]);
  const P1b = new Plate(ctx, map, { name: 'P1b', ref: [0, 0, S2.H0], pitch: 6, roll: 0, u0: -70, u1: 482, v0: -142, v1: 142, pivot: [205, 0], thick: 16, drop: 1.8, shareParent: P1a });
  P1b.cuts.push([fn.clone().negate(), -fd]);
  P1a.fault = { n: fn, d: fd, k };

  // ---- P2: MIDTOWN (tilted 5° forward, 7° to the left)
  // Extended to v1=620 to cover the garage, bridge and tower approach areas.
  const P2 = new Plate(ctx, map, { name: 'P2', ref: [525, 0, 69.1], pitch: 5, roll: 7, u0: 496, u1: 920, v0: -130, v1: 620, thick: 18, motion: motion(2.2, 0.17, 0.0024) });
  // The fallen tower facade is positioned where the route arrives at it
  // (u~848, v~517 from the layout), parallel to P2.
  const towerBase = map.at(848, 0, 517);
  const TW = new PlaneSurf(V3(towerBase.x, P2.heightAt(towerBase.x, towerBase.z) - 0.3, towerBase.z), P2.n);

  // ---- P3: THE LOW END
  // Crown (tower exit -> P3) is at (u~1053, v~592). P3 extends south-east from there.
  const crown = map.at(1053, 0, 592);
  const h3 = TW.heightAt(crown.x, crown.z) - 4.0;
  const P3 = new Plate(ctx, map, { name: 'P3', ref: [1053, 592, h3], pitch: 0, roll: -7, u0: 890, u1: 1420, v0: 390, v1: 740, pivot: [1100, 565], thick: 16, motion: motion(4.1, 0.23, 0.0026) });

  // ================================================================ THE ROUTE
  const o = map.at(0, S2.H0, 0);
  const R = new RouteBuilder({ start: [o.x, o.y, o.z], heading: S2.heading, width: 26, speed: 70 });

  // ---- P1: THE AVENUE (straight-ish downhill, the fault crosses it)
  R.beat('2A', 'ARRIVAL').seg(90, { on: P1a });
  R.beat('2B', 'THE AVENUE');
  R.seg(36, { on: P1a });
  R.seg(48, { on: P1a, turn: 4 });
  R.seg(48, { on: P1a, turn: -4 });
  R.seg(30, { on: P1a });     // ~252 m total on P1a
  R.mark('fault');
  R.beat('2C', 'THE ARCH');
  { const e = R.ahead(7); R.gap(7, { y: P1b.heightAt(e.x, e.z) }); }
  R.seg(148, { on: P1b });
  R.beat('2D', 'THE RIDGE');
  R.seg(23, { on: P1b });     // ~446 m
  R.mark('kicker');
  for (const h of S2.kicker) {
    const e = R.ahead(9);
    R.seg(9, { y: P1b.heightAt(e.x, e.z) + h, surface: 'ramp' });
  }
  R.mark('lip');
  { const e = R.ahead(50); R.gap(50, { y: P2.heightAt(e.x, e.z) }); }

  // ---- P2: THE CITY (winding through the grid)
  R.beat('2E', 'THE BOULEVARD');
  R.seg(80, { on: P2, width: 26 });

  R.beat('2F', 'THE JUNCTION');
  R.seg(30, { on: P2, turn: 85, width: 22 });     // sharp left through intersection
  R.seg(52, { on: P2, width: 18 });                // cross street heading left
  R.mark('junction');
  R.seg(20, { on: P2, width: 18 });
  R.mark('cross1');

  R.beat('2G', 'THE ALLEY');
  R.seg(50, { on: P2, width: 14, turn: -10 });     // narrow alley, slight curve
  R.mark('alley');

  R.beat('2H', 'THE BUILDING');
  R.mark('buildingEntry');
  R.seg(55, { on: P2, surface: 'facade', width: 18, turn: -5 });  // through the building interior
  R.mark('buildingExit');
  R.seg(14, { on: P2, surface: 'ramp', turn: 15 });  // ramp out through far wall, curving right

  R.beat('2I', 'THE GRID');
  R.seg(38, { on: P2, width: 18, turn: -40 });     // curve onto a new avenue heading right
  R.mark('grid2');
  R.seg(62, { on: P2, width: 20 });                 // wide avenue
  R.mark('grid2S');

  R.beat('2J', 'THE COLLAPSE');
  R.mark('collapse');
  R.seg(16, { on: P2, width: 18 });
  R.seg(28, { on: P2, turn: 65, width: 16 });      // sharp left to avoid collapse
  R.seg(38, { on: P2, width: 16 });
  R.seg(28, { on: P2, turn: -65, width: 16 });     // turn back
  R.mark('detour');

  R.beat('2K', 'THE GARAGE');
  R.mark('garageEntry');
  R.seg(18, { on: P2, dy: -3.5, surface: 'ramp' });    // drive down into garage
  R.seg(60, { on: P2, dy: -7, surface: 'floor' });     // through garage levels
  R.seg(18, { on: P2, dy: -3.5, surface: 'ramp' });    // exit ramp
  R.mark('garageExit');

  R.beat('2L', 'THE BRIDGE');
  R.mark('bridgeStart');
  R.seg(12, { on: P2 });
  { const e = R.ahead(5); R.gap(5, { y: P2.heightAt(e.x, e.z) + 1.5 }); }
  R.seg(60, { on: P2, surface: 'bridge' });
  R.mark('bridgeEnd');
  R.seg(18, { on: P2, dy: -2.5, surface: 'ramp', turn: -25 });  // ramp off bridge, curving to the tower

  // THE FALLEN TOWER: drive along its curtain-wall facade
  R.beat('2M', 'THE TOWER');
  R.mark('towerBase');
  R.seg(16, { on: P2 });
  { const e = R.ahead(2); R.gap(2, { y: TW.heightAt(e.x, e.z) }); }
  R.seg(200, { on: TW, surface: 'facade' });
  R.mark('crown');

  // exit the tower onto P3
  { const e = R.ahead(22); R.gap(22, { y: P3.heightAt(e.x, e.z) }); }

  // ---- P3: THE LOW END
  R.beat('2N', 'THE CRESCENT');
  R.seg(14, { on: P3 });
  R.mark('lowStreet');
  R.seg(56, { on: P3, turn: -90 });                  // big off-camber crescent
  R.seg(50, { on: P3 });
  R.seg(34, { on: P3, turn: 7 });
  R.seg(34, { on: P3, turn: -7 });
  R.seg(12, { on: P3 });

  R.beat('2O', 'THE CLIMB');
  R.mark('climbTurn');
  R.seg(56, { on: P3, turn: 90 });                   // left turn uphill
  R.seg(150, { on: P3 });

  R.beat('2P', 'THE EDGE');
  R.seg(54, { on: P3 });
  R.mark('edge');
  { const y = R.p.y; R.gap(40, { y }); }

  const route = R.build();
  return { map, plates: { P1a, P1b, P2, P3 }, TW, route };
}

export const markS = (route, name) => route.marks.find((m) => m.name === name).s;
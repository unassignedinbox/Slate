// SECTION 1 - FRACTURED TOWN: the authored racing line.
//
// Read this like a beat sheet. Each beat says what the player drives on and why.
// Heights are absolute metres; the town floats ~20-50 m above a cloud floor.
// Heading 90 = north (-Z), 0 = east (+X), -90 = south (+Z), 180 = west.
//
// The line is a clockwise inward spiral around the town: you see the church
// spire (the finish) from the very first metre, circle the town on its outskirts
// and rooftops, and finish by climbing into its heart.
import { RouteBuilder } from '../../core/route.js';

export function buildRoute1() {
  const R = new RouteBuilder({ start: [-236, 52, 196], heading: 90, width: 14, speed: 60 });

  // 1A - APPROACH ROAD. Intact country road that starts to crack: a calm launch,
  // the whole town laid out ahead and to the right (the reveal).
  R.beat('1A', 'APPROACH ROAD');
  R.straight(60, { y: 51.4, surface: 'road' }).mark('start-grid');
  R.straight(100, { y: 48.6, surface: 'road' });

  // 1B - BROKEN HIGH STREET. The road shatters into slabs; small cracks first,
  // then real gaps and step-downs. Houses on their torn-up plots drift either side.
  R.beat('1B', 'BROKEN HIGH STREET');
  R.arc(70, -14, { y: 47.2, surface: 'road' });
  // a collapsed house blocks the straight line: the street bends left around it.
  // This bend (R~88 m) is also the speed governor for the kicker below.
  R.arc(46, 30, { y: 45.6, surface: 'road', speed: 36 });
  R.straight(34, { y: 44.4, surface: 'road', speed: 37 });

  // 1C - THE KICKER. A slab snapped upward over a broken water main: two-stage
  // ramp (5 then 9 deg), then a leap down onto the supermarket roof. At the
  // speeds the bend allows (25-37 m/s) you land 30-52 m out - all on the roof.
  R.beat('1C', 'THE KICKER');
  R.straight(7, { dy: 0.61, surface: 'kicker', speed: 37 });
  R.straight(9, { dy: 1.43, surface: 'kicker', speed: 37 }).mark('kicker-lip');
  R.gap(24, { y: 42.0, speed: 37 });

  // 1D - ROOFTOPS. Supermarket roof (turn right ON the roof), three shop roofs
  // with short hops down, then a long run along the slope of a pitched terrace
  // roof (banked 15 deg), then drop into the lane.
  R.beat('1D', 'ROOFTOPS');
  R.straight(46, { y: 41.8, surface: 'roof', speed: 40 }).mark('market-roof');
  R.arc(64, -88, { y: 41.4, surface: 'roof', speed: 25 });
  R.straight(12, { y: 41.2, surface: 'roof' });
  R.gap(3, { dy: -1.0, speed: 32 });
  R.straight(17, { dy: -0.2, surface: 'roof', speed: 32 });
  R.gap(2.5, { dy: -0.9 });
  R.straight(17, { dy: -0.2, surface: 'roof' });
  R.gap(2.5, { dy: -0.9 });
  R.straight(17, { dy: -0.2, surface: 'roof' });
  R.gap(3, { dy: -0.9 });
  R.straight(66, { dy: -2.6, surface: 'pitched', bank0: 15, bank: 15, speed: 38 }).mark('terrace');
  R.gap(6, { dy: -2.6, bank: 0, speed: 36 });

  // 1E - MILL LANE. Back on a street: broken slabs eastbound, under the tilted
  // water tower, past the old mill and its turning wheel.
  R.beat('1E', 'MILL LANE');
  R.straight(30, { dy: -0.8, surface: 'road', speed: 44 });
  R.arc(40, 12, { dy: -0.5, surface: 'road' });
  R.arc(40, -12, { dy: -0.5, surface: 'road' });
  R.straight(18, { dy: -0.3, surface: 'road' });

  // 1F - THE HOUSE. A crossroads slab where you turn south, then straight
  // through the upper floor of a split townhouse (furniture drifting in the
  // rooms, a plaster wall to burst), out the back and down to the river road.
  R.beat('1F', 'THE HOUSE');
  R.arc(55, -88, { dy: -0.6, surface: 'road', speed: 26 });
  R.straight(10, { dy: -0.1, surface: 'road', speed: 30 });
  R.gap(2, { dy: -0.5 });
  R.straight(30, { dy: -0.2, surface: 'floor', speed: 30 }).mark('house');
  R.gap(10, { dy: -5.0, speed: 30 });

  // 1G - RIVER ROAD & BRIDGE. Riverside slabs, then the old stone bridge broken
  // into three spans at different heights: up the first, drop to the second,
  // drop to the third. The river hangs below in pieces.
  R.beat('1G', 'RIVER BRIDGE');
  R.straight(36, { dy: -0.8, surface: 'road', speed: 42 });
  R.straight(30, { dy: 2.6, surface: 'bridge', speed: 40 }).mark('bridge');
  R.gap(6, { dy: -2.4 });
  R.straight(40, { dy: -0.8, surface: 'bridge' });
  R.gap(4, { dy: -1.5 });
  R.straight(28, { dy: -2.0, surface: 'bridge' });
  R.straight(14, { dy: -0.4, surface: 'road' });

  // 1H - SOUTH STREET. Turn west; shops and houses both sides, a bus hanging
  // across the pavement, a gentle S through the slabs.
  R.beat('1H', 'SOUTH STREET');
  R.arc(58, -88, { dy: -0.8, surface: 'road', speed: 26 });
  R.straight(40, { dy: -0.4, surface: 'road', speed: 44 });
  R.arc(36, 10, { dy: -0.3, surface: 'road' });
  R.arc(36, -10, { dy: -0.3, surface: 'road' });

  // 1I - MARKET SQUARE. The square is cracked into big raft-like paving tiles
  // that tilt slowly; the line curves north across it past the broken fountain.
  R.beat('1I', 'MARKET SQUARE');
  R.arc(66, -86, { dy: -0.4, surface: 'plaza', speed: 27 }).mark('square');
  R.straight(24, { dy: 0, surface: 'plaza', speed: 36 });

  // 1J - CHURCH HILL. The steep street up to the church, cracked into slabs
  // that still form one continuous climb (~8 deg) bending right so the church
  // door swings into view square-on. No hops here on purpose: you can't steer
  // in the air, and this is a climbing turn.
  R.beat('1J', 'CHURCH HILL');
  R.gap(1.6, { dy: -0.5, speed: 34 });
  R.arc(24, -10, { dy: 3.3, surface: 'road', speed: 34 });
  R.arc(26, -22, { dy: 3.6, surface: 'road' });
  R.arc(26, -22, { dy: 3.6, surface: 'road' });
  R.arc(26, -16, { dy: 3.3, surface: 'road' });
  R.straight(8, { dy: 0.6, surface: 'road' });

  // 1K - THE CHURCH. In through the tower door (west), down the nave between
  // drifting pews, up the chancel steps and out through the shattered east end:
  // the leap into the portal.
  R.beat('1K', 'THE CHURCH');
  R.gap(2.0, { dy: -0.4, speed: 34 });
  R.straight(48, { dy: -0.2, surface: 'nave', speed: 40 }).mark('nave');
  R.straight(10, { dy: 1.6, surface: 'kicker', speed: 40 });
  R.straight(6, { dy: 1.4, surface: 'kicker', speed: 40 }).mark('apse-lip');
  R.gap(34, { dy: 1.5, speed: 40 }).mark('portal');

  return R.build();
}

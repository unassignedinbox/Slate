// asciimap.mjs — textual overview of the battlefield layout for verification
import * as THREE from '../js/vendor/three.module.min.js';
import { CFG } from '../js/state.js';
import * as world from '../js/world.js';
import { H, ROADS, WIRES, HEDGEHOGS, roadDist, moundF, CRATERS } from '../js/world.js';
import { buildProps } from '../js/props.js';
import { S } from '../js/state.js';

S.scene = new THREE.Scene();
buildProps();

const COLS = 124, ROWS = 132;
const X0 = -196, X1 = 196, Z0 = -452, Z1 = 188;
const WATER = -3.2;

const SENTRY_XS = [-140, -75, -30, 30, 90, 145];
const TANKS = [[-30, -382], [44, -390], [-84, -366], [12, -206], [-58, -186], [-95, -16], [128, -12], [-142, 64], [74, 76]];
const FWD_BUNKERS = [[-80, 44], [146, 120]];
const CRAFT = [-10, -424];

const grid = [];
for (let r = 0; r < ROWS; r++) {
  const z = Z0 + ((Z1 - Z0) * r) / (ROWS - 1);
  let row = '';
  for (let c = 0; c < COLS; c++) {
    const x = X0 + ((X1 - X0) * c) / (COLS - 1);
    let ch;
    // props first
    const near = (px, pz, rad) => Math.hypot(x - px, z - pz) < rad;
    if (z > 167 && z < 177 && Math.abs(x) < 178 && !(Math.abs(x) < 5 && z < 171)) ch = '#';      // wall
    else if (z > 160 && z < 167 && SENTRY_XS.some((sx) => near(sx, 166, 4))) ch = 'S';           // wall bunkers
    else if (FWD_BUNKERS.some(([bx, bz]) => near(bx, bz, 4))) ch = 'S';
    else if (S.sentries.some((sn) => near(sn.x, sn.z, 3))) ch = 'S';
    else if (near(CFG.carSpawn.x, CFG.carSpawn.z, 2.5)) ch = 'C';
    else if (near(CFG.spawn.x, CFG.spawn.z, 2.5)) ch = 'P';
    else if (near(CRAFT[0], CRAFT[1], 5)) ch = 'U';
    else if (TANKS.some(([tx, tz]) => near(tx, tz, 3))) ch = 'X';
    else if (S.tankMines.some((m) => near(m.x, m.z, 2.2))) ch = 'o';
    else if (S.apMines.some((m) => near(m.x, m.z, 2.2))) ch = '!';
    else if (S.obstacles.some((ob) => ob.type === 'teeth' && near(ob.x, ob.z, 2.2))) ch = 'A';
    else if (S.obstacles.some((ob) => ob.type === 'barrier' && near(ob.x, ob.z, 2.6))) ch = '|';
    else if (HEDGEHOGS.some(([hx, hz]) => near(hx, hz, 2.4))) ch = '+';
    else if (WIRES.some((w) => worldDistToPoly(w.pts, x, z) < 1.6)) ch = 'w';
    else if (ROADS.some((rd) => worldDistToPoly(rd.pts, x, z) < rd.halfW)) ch = '=';
    else {
      const h = H(x, z);
      const tf = world.trenchF(x, z);
      const mf = moundF(x, z);
      let cf = 0;
      for (const cr of CRATERS) if (Math.hypot(x - cr[0], z - cr[1]) < cr[2]) cf = 1;
      if (h < WATER - 2.5) ch = ' ';
      else if (h < WATER) ch = '~';
      else if (tf.carve > 0.9) ch = 'T';
      else if (tf.carve > 0.05 || tf.par > 0.2) ch = 't';
      else if (cf) ch = '0';
      else if (mf > 0.45) ch = h > 8 ? 'M' : 'm';
      else if (h < 0.6) ch = '.';
      else if (z < -210) ch = ':';
      else ch = '"';
    }
    row += ch;
  }
  grid.push(row);
}
// z scale label
console.log('     ' + '-180'.padStart(6) + ''.padEnd(48) + '0'.padStart(8) + ''.padEnd(48) + '+180');
for (let r = 0; r < ROWS; r++) {
  const z = Z0 + ((Z1 - Z0) * r) / (ROWS - 1);
  console.log(`${z.toFixed(0).padStart(4)} ${grid[r]}`);
}
console.log('\nlegend: ~ water | . wet sand | : dry sand/dune | " plain | m/M earth mounds | T trench floor | t trench lip |');
console.log('        = road | w wire | + hedgehog | o tank mine | ! AP mine | X tank | S sentry bunker | # WALL | U landing craft | C car | P you');

function worldDistToPoly(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

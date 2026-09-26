// combat.js — sentry fire control, mines, wire, the rising tide, explosions
import * as THREE from './vendor/three.module.min.js';
import { clamp, clamp01, distSeg, hideInst } from './utils.js';
import { S, CFG } from './state.js';
import { H, waterlineZ } from './world.js';
import { destroyWireChunk } from './props.js';

const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _tgt = new THREE.Vector3();

// ------------------------------------------------------------------
// EXPLOSIONS
// ------------------------------------------------------------------
export function explode(pos, opts = {}) {
  const radius = opts.radius !== undefined ? opts.radius : 6;
  const playerDmg = opts.playerDmg !== undefined ? opts.playerDmg : 70;
  const carDmg = opts.carDmg !== undefined ? opts.carDmg : 90;
  const big = !!opts.big;
  S.effects.burst(pos.x, pos.y, pos.z, big ? 1.5 : 0.9);
  S.audio.explosion(pos, big, 0);

  const p = S.player;
  if (p && p.alive) {
    const d = Math.hypot(p.pos.x - pos.x, (p.pos.y + 0.9 - pos.y) * 0.7, p.pos.z - pos.z);
    if (d < radius) {
      const f = 1 - d / radius;
      p.damage(playerDmg * f, big ? 'blown apart by an explosion' : 'killed by a mine');
      if (p.alive) {
        const nx = (p.pos.x - pos.x) / (d || 1), nz = (p.pos.z - pos.z) / (d || 1);
        p.knock.x += nx * 11 * f;
        p.knock.z += nz * 11 * f;
        p.vy += 4.5 * f;
      }
    }
  }
  const car = S.car;
  if (car && car.alive && carDmg > 0) {
    const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
    if (d < radius + 2.2) car.damage(carDmg * (1 - d / (radius + 2.2)), 'mine');
  }
  // chain-detonate nearby tank mines
  for (const m of S.tankMines) {
    if (!m.alive) continue;
    if (Math.hypot(m.x - pos.x, m.z - pos.z) < radius - 1.2) {
      S.pendingBooms.push({ t: 0.1 + Math.random() * 0.15, mine: m });
    }
  }
}

function triggerTankMine(m) {
  if (!m.alive) return;
  m.alive = false;
  hideInst(S.tankMineMesh, m.i);
  S.stats.minesTripped++;
  explode(new THREE.Vector3(m.x, H(m.x, m.z) + 0.3, m.z), { radius: 6.5, playerDmg: 55, carDmg: 135, big: true });
}

function triggerAPMine(m) {
  if (!m.alive) return;
  m.alive = false;
  hideInst(S.apMineMesh, m.i);
  hideInst(S.apBlinkMesh, m.i);
  S.stats.minesTripped++;
  explode(new THREE.Vector3(m.x, H(m.x, m.z) + 0.25, m.z), { radius: 3.6, playerDmg: 56, carDmg: 15 });
}

// ------------------------------------------------------------------
// MINES
// ------------------------------------------------------------------
function updateMines(dt) {
  const car = S.car, p = S.player;

  for (let i = S.pendingBooms.length - 1; i >= 0; i--) {
    const b = S.pendingBooms[i];
    b.t -= dt;
    if (b.t <= 0) {
      S.pendingBooms.splice(i, 1);
      if (b.mine.alive) triggerTankMine(b.mine);
    }
  }

  if (car && car.alive) {
    const wheels = car.wheelPositions;
    for (const m of S.tankMines) {
      if (!m.alive) continue;
      if (Math.abs(m.x - car.pos.x) > 3.2 || Math.abs(m.z - car.pos.z) > 3.2) continue;
      for (const w of wheels) {
        if (Math.hypot(w[0] - m.x, w[1] - m.z) < 1.5) { triggerTankMine(m); break; }
      }
    }
    // AP mines pop under wheels — minor damage
    for (const m of S.apMines) {
      if (!m.alive) continue;
      if (Math.hypot(m.x - car.pos.x, m.z - car.pos.z) < 1.1) triggerAPMine(m);
    }
  }

  if (p && p.alive && !p.inCar) {
    for (const m of S.apMines) {
      if (!m.alive) continue;
      if (Math.abs(m.x - p.pos.x) > 1.3 || Math.abs(m.z - p.pos.z) > 1.3) continue;
      if (Math.hypot(m.x - p.pos.x, m.z - p.pos.z) < 1.05) { triggerAPMine(m); break; }
    }
  }
}

// ------------------------------------------------------------------
// BARBED WIRE
// ------------------------------------------------------------------
function updateWire(dt) {
  S.wireSlow = 0;
  const p = S.player, car = S.car;

  if (p && p.alive && !p.inCar) {
    for (const sg of S.wireSegs) {
      const r = distSeg(p.pos.x, p.pos.z, sg.ax, sg.az, sg.bx, sg.bz);
      if (r.d < 0.8) {
        S.wireSlow = 1;
        p.damage(9 * dt, 'cut down on the wire');
        if (!S._wireSndT || S.t - S._wireSndT > 0.7) {
          S._wireSndT = S.t;
          S.audio.wireSnag(p.pos);
        }
        break;
      }
    }
  }
  if (car && car.alive && Math.abs(car.speed) > 3.2) {
    for (const sg of S.wireSegs) {
      const r = distSeg(car.pos.x, car.pos.z, sg.ax, sg.az, sg.bx, sg.bz);
      if (r.d < 2.4) {
        destroyWireChunk(sg.chunk);
        car.damage(2.5, 'wire');
        car.speed *= 0.86;
        S.audio.wireSnag(car.pos);
      }
    }
  }
}

// ------------------------------------------------------------------
// THE RISING TIDE
// ------------------------------------------------------------------
export function updateTide(dt) {
  S.waterLevel = Math.min(CFG.tideMax, S.waterLevel + CFG.tideRate * dt);
  S.waterlineZ = waterlineZ(S.waterLevel);
  const f = (S.waterLevel - CFG.tideStart) / (CFG.tideMax - CFG.tideStart);
  if (f > 0.22 && !S.flags.warnedTide1) {
    S.flags.warnedTide1 = true;
    S.banners.push({ text: 'THE TIDE IS RISING — GET OFF THE BEACH', ttl: 5, color: '#4fc3f7' });
  }
  if (f > 0.62 && !S.flags.warnedTide2) {
    S.flags.warnedTide2 = true;
    S.banners.push({ text: 'THE TIDE KEEPS CLIMBING — MOVE INLAND', ttl: 5, color: '#4fc3f7' });
  }
}

// ------------------------------------------------------------------
// SENTRIES — they watch for vehicles and shred them
// ------------------------------------------------------------------
function sentryMuzzleWorld(s, out) {
  s.group.updateMatrixWorld(true);
  return out.set(0, -0.03, 2.55).applyMatrix4(s.pitchNode.matrixWorld);
}

function losClear(from, to) {
  const steps = 30;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (H(x, z) > y + 0.35) return false;
  }
  return true;
}

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function updateSentries(dt) {
  const p = S.player, car = S.car;

  for (const s of S.sentries) {
    s.losT -= dt;
    s.cd -= dt;

    if (s.losT <= 0) {
      s.losT = 0.22;
      s.target = null;
      sentryMuzzleWorld(s, _muzzle);
      if (car && car.alive) {
        _tgt.set(car.pos.x, car.pos.y + 0.75, car.pos.z);
        const d = Math.hypot(car.pos.x - s.x, car.pos.z - s.z);
        if (d < s.range && losClear(_muzzle, _tgt)) s.target = 'car';
      }
      if (!s.target && p && p.alive && !p.inCar) {
        _tgt.set(p.pos.x, p.eyeY(), p.pos.z);
        const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
        if (d < 175 && losClear(_muzzle, _tgt)) s.target = 'player';
      }
    }

    let firing = false;
    if (s.target === 'car' && car && car.alive) {
      const d = Math.hypot(car.pos.x - s.x, car.pos.z - s.z);
      const lead = (d / 165) * 0.85;
      _aim.set(
        car.pos.x + Math.sin(car.yaw) * car.speed * lead,
        car.pos.y + 0.75,
        car.pos.z + Math.cos(car.yaw) * car.speed * lead
      );
      firing = aimSentry(s, _aim, dt);
      if (firing && s.cd <= 0 && s.burstLeft <= 0) {
        s.burstLeft = 4 + Math.floor(Math.random() * 3);
        s.cd = 3; // locked while bursting; reset when the burst ends
      }
    } else if (s.target === 'player' && p && p.alive) {
      _aim.set(p.pos.x, p.eyeY() - 0.15, p.pos.z);
      firing = aimSentry(s, _aim, dt);
      if (firing && s.cd <= 0 && s.burstLeft <= 0) {
        s.burstLeft = 4;
        s.cd = 3;
      }
    } else {
      // idle sweep
      s.yawNode.rotation.y = Math.sin(S.t * 0.32 + s.phase) * 0.55;
      s.pitchNode.rotation.x = -0.05 + Math.sin(S.t * 0.5 + s.phase) * 0.06;
      s.yaw = s.yawNode.rotation.y;
      s.pitch = s.pitchNode.rotation.x;
    }

    if (s.burstLeft > 0) {
      if (!s.target) s.burstLeft = 0;
      s.fireT -= dt;
      if (s.fireT <= 0) {
        s.fireT = 0.085;
        s.burstLeft--;
        fireSentryRound(s);
        if (s.burstLeft === 0) {
          s.cd = s.target === 'car' ? 0.7 + Math.random() * 0.8 : 1.3 + Math.random() * 1.2;
        }
      }
    }
    if (s.flashT > 0) {
      s.flashT -= dt;
      if (s.flashT <= 0) s.flash.visible = false;
    }
  }
}

function aimSentry(s, aim, dt) {
  const dx = aim.x - s.x, dy = aim.y - (s.y + 0.9), dz = aim.z - s.z;
  const distXZ = Math.hypot(dx, dz);
  const desiredYaw = Math.atan2(dx, dz) - s.baseYaw;
  const desiredPitch = -Math.atan2(dy, distXZ);
  const errY = normAngle(desiredYaw - s.yaw);
  const errP = desiredPitch - s.pitch;
  const rate = 2.2;
  s.yaw += clamp(errY, -rate * dt, rate * dt);
  s.pitch += clamp(errP, -rate * dt, rate * dt);
  s.yawNode.rotation.y = s.yaw;
  s.pitchNode.rotation.x = s.pitch;
  return Math.abs(errY) < 0.07 && Math.abs(errP) < 0.06;
}

function fireSentryRound(s) {
  sentryMuzzleWorld(s, _muzzle);
  const p = S.player, car = S.car;
  s.flash.visible = true;
  s.flashT = 0.05;
  s.flash.rotation.z = Math.random() * Math.PI;
  S.audio.shot(_muzzle, s.target === 'car');

  if (s.target === 'car' && car && car.alive) {
    const d = Math.hypot(car.pos.x - s.x, car.pos.z - s.z);
    const spread = 1.2 + d * 0.012;
    _aim.set(
      car.pos.x + (Math.random() - 0.5) * spread,
      car.pos.y + 0.75 + (Math.random() - 0.5) * spread * 0.5,
      car.pos.z + (Math.random() - 0.5) * spread
    );
    const pHit = clamp(0.34 - d / 680 - Math.abs(car.speed) * 0.005, 0.05, 0.34);
    const hit = Math.random() < pHit;
    S.effects.tracer(_muzzle.clone(), _aim.clone(), () => {
      if (hit && S.car && S.car.alive) {
        S.car.damage(6 + Math.random() * 5, 'sentry fire');
        if (S.car.alive) S.effects.spark(S.car.pos.x, S.car.pos.y + 0.9, S.car.pos.z, 6);
      }
    });
  } else if (p && p.alive) {
    const d = Math.hypot(p.pos.x - s.x, p.pos.z - s.z);
    const spread = 1.6 + d * 0.02;
    _aim.set(
      p.pos.x + (Math.random() - 0.5) * spread,
      p.eyeY() - 0.2 + (Math.random() - 0.5) * spread * 0.4,
      p.pos.z + (Math.random() - 0.5) * spread
    );
    const hit = Math.random() < 0.055;
    S.effects.tracer(_muzzle.clone(), _aim.clone(), () => {
      if (hit && S.player && S.player.alive) S.player.damage(5, 'cut down by sentry fire');
    });
  }
}

// ------------------------------------------------------------------
// DISTANT ARTILLERY AMBIENCE
// ------------------------------------------------------------------
let artyT = 7;
function updateArtillery(dt) {
  artyT -= dt;
  if (artyT > 0) return;
  artyT = 13 + Math.random() * 20;
  const p = S.player;
  if (!p) return;
  const a = Math.random() * Math.PI * 2;
  const d = 140 + Math.random() * 160;
  const x = clamp(p.pos.x + Math.cos(a) * d, -170, 170);
  const z = clamp(p.pos.z + Math.sin(a) * d, -170, 150);
  const y = H(x, z) + 0.3;
  S.effects.burst(x, y, z, 0.65);
  const dist = Math.hypot(x - p.pos.x, z - p.pos.z);
  S.audio.explosion(new THREE.Vector3(x, y, z), false, dist / 340);
}

// ------------------------------------------------------------------
function updateBeacons() {
  const t = S.t;
  if (S.beaconMat && S.beaconMat.color) {
    const f = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3.2));
    S.beaconMat.color.setRGB(f, 0.14 * f, 0.1 * f);
  }
  if (S.apBlinkMat) {
    const f = Math.sin(t * 7) > 0.2 ? 1 : 0.08;
    S.apBlinkMat.color.setRGB(f, 0.16 * f, 0.12 * f);
  }
}

export function updateCombat(dt) {
  updateTide(dt);
  updateSentries(dt);
  updateMines(dt);
  updateWire(dt);
  updateArtillery(dt);
  updateBeacons();
}

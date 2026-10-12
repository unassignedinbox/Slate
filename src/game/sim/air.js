// Air units (pure logic): police helicopter, recon drones, interceptor drones and the drone wall.
//  - Helicopter: orbits the hottest racer, spotlights it, marks it, drops tire nets ahead and calls
//                signal jammers. Loses its link inside a jammer field and widens its orbit.
//  - Recon drone: flies ahead of the target and marks it (adds heat while it has eyes on it).
//  - Interceptor: dives at the target and fires a shock pulse that stuns and slows it; then it's gone.
//  - Drone wall: a line of hovering drones across the lanes. Hitting one destroys it and jolts the car.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let NEXT = 1;

export class Air {
  constructor(sim) {
    this.sim = sim;
    this.units = [];
    this.cdRecon = 0; this.cdIntercept = 0;
  }

  get heli() { return this.units.find(u => u.kind === 'heli' && u.alive) || null; }
  count(kind) { return this.units.filter(u => u.kind === kind && u.alive).length; }

  spawnHeli(target) {
    const u = this.make('heli', target, { x: target.x + 200, y: 70, z: target.z + 200 });
    u.orbit = Math.random() * 6.28; u.speed = 40; u.rotor = 0; u.cd = { net: 4, jam: 10 };
    this.sim.event('Police helicopter airborne', 'police');
    return u;
  }
  spawnRecon(target) {
    const ahead = this.sim.graph.aheadOf(target, 60);
    const p = ahead ? this.sim.graph.pointAt(ahead.e, ahead.s, 0) : { x: target.x, z: target.z };
    const u = this.make('recon', target, { x: p.x, y: 30, z: p.z });
    u.speed = 36; u.life = 40;
    this.sim.event('Recon drone launched — target tagged', 'police');
    return u;
  }
  spawnIntercept(target) {
    const u = this.make('intercept', target, { x: target.x + target.hz * 120, y: 26, z: target.z - target.hx * 120 });
    u.speed = 33; u.life = 25;
    this.sim.event('Interceptor drone inbound', 'police');
    return u;
  }
  // Drone wall across a lane span at a given edge position.
  spawnWall(e, s, o0, o1, life = 42) {
    const g = this.sim.graph;
    const n = 5, units = [];
    for (let i = 0; i < n; i++) {
      const o = o0 + 0.9 + ((o1 - o0 - 1.8) * i) / (n - 1);
      const p = g.pointAt(e, s, o);
      const u = this.make('wall', null, { x: p.x, y: 2.6, z: p.z });
      u.life = life; u.homeX = p.x; u.homeZ = p.z; u.bob = i * 0.9;
      units.push(u);
    }
    this.sim.event('Drone wall activated — 5 interceptors holding the lanes', 'police');
    return units;
  }

  make(kind, target, p) {
    const u = { id: NEXT++, kind, alive: true, target, x: p.x, y: p.y, z: p.z, hx: 1, hz: 0, speed: 30, life: 999, linkLost: 0, age: 0, spin: 0 };
    this.units.push(u);
    return u;
  }

  destroy(u, reason) {
    if (!u.alive) return;
    u.alive = false; u.reason = reason;
    if (u.kind !== 'heli') this.sim.event(`${u.kind === 'wall' ? 'Wall drone' : 'Drone'} down (${reason})`, 'gadget');
  }

  // Decides when to bring air support in, based on the hottest racer and heat level.
  supervise(target, level, dt) {
    this.cdRecon -= dt; this.cdIntercept -= dt;
    if (!target || level < 2) return;
    if (level >= 3 && !this.heli) this.spawnHeli(target);
    if (this.count('recon') < 2 && this.cdRecon <= 0) { this.spawnRecon(target); this.cdRecon = 22; }
    if (level >= 4 && this.count('intercept') < 2 && this.cdIntercept <= 0) { this.spawnIntercept(target); this.cdIntercept = 26; }
  }

  update(dt) {
    for (const u of this.units) {
      if (!u.alive) continue;
      u.age += dt;
      u.linkLost = Math.max(0, (u.linkLost || 0) - dt);
      if (u.kind === 'wall') { u.life -= dt; this.updateWall(u, dt); continue; }
      const t = u.target;
      // Units leave when their target is gone or has escaped; short-lived drones also time out.
      if (!t || !t.alive || t.wanted <= 0) { u.life -= dt * 3; if (u.kind === 'heli' || u.life <= 0) { u.alive = false; continue; } }
      else if (u.kind !== 'heli') u.life -= dt;
      if (u.kind !== 'heli' && u.life <= 0) { u.alive = false; continue; }
      if (!u.alive) continue;
      switch (u.kind) {
        case 'heli': this.updateHeli(u, dt); break;
        case 'recon': this.updateRecon(u, dt); break;
        case 'intercept': this.updateIntercept(u, dt); break;
      }
    }
    this.units = this.units.filter(u => u.alive);
  }

  // Simple steering towards a point with smoothed velocity (no collision avoidance).
  steer(u, tx, ty, tz, maxSpeed, dt) {
    const dx = tx - u.x, dy = ty - u.y, dz = tz - u.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const sp = Math.min(maxSpeed, dist * 1.8);
    u.vx = u.vx || 0; u.vy = u.vy || 0; u.vz = u.vz || 0;
    const nx = dx / dist * sp, ny = dy / dist * sp, nz = dz / dist * sp;
    const k = Math.min(1, dt * 4);
    u.vx += (nx - u.vx) * k; u.vy += (ny - u.vy) * k; u.vz += (nz - u.vz) * k;
    u.x += u.vx * dt; u.y += u.vy * dt; u.z += u.vz * dt;
    const hl = Math.hypot(u.vx, u.vz);
    if (hl > 1) { u.hx = u.vx / hl; u.hz = u.vz / hl; }
  }

  updateHeli(u, dt) {
    const t = u.target;
    u.rotor += dt * 38;
    const lost = u.linkLost > 0;
    u.orbit += dt * (lost ? 0.15 : 0.42);
    const R = lost ? 240 : 150;
    const lead = 1.2 * t.v;
    const cx = t.x + t.hx * lead, cz = t.z + t.hz * lead;
    this.steer(u, cx + Math.cos(u.orbit) * R, 70 + (lost ? 25 : 0), cz + Math.sin(u.orbit) * R, u.speed + 14, dt);
    if (!lost) t.marked = Math.max(t.marked, 2.2);
    u.cd.net -= dt; u.cd.jam -= dt;
    if (!lost && u.cd.net <= 0 && t.v > 6 && this.sim.heat.level >= 2) {
      const ah = this.sim.graph.aheadOf(t, 42);
      if (ah) {
        const b = this.sim.graph.edges[ah.e];
        this.sim.gadgets.addNet(ah.e, ah.s, b.span[0], b.span[1], u);
        u.cd.net = 14;
      }
    }
    if (!lost && u.cd.jam <= 0 && this.sim.heat.level >= 3) {
      this.sim.gadgets.addJammer(t.x, t.z, u);
      u.cd.jam = 38;
    }
  }

  updateRecon(u, dt) {
    const t = u.target;
    const lost = u.linkLost > 0;
    if (lost) { u.y -= 5 * dt; u.life -= dt * 2; if (u.y < 2) { this.destroy(u, 'fell'); } return; }
    t.marked = Math.max(t.marked, 2.5);
    this.steer(u, t.x + t.hx * 55, 24, t.z + t.hz * 55, u.speed, dt);
  }

  updateIntercept(u, dt) {
    const t = u.target;
    if (u.linkLost > 0) { u.y -= 6 * dt; if (u.y < 1) this.destroy(u, 'fell'); return; }
    const dist = Math.hypot(t.x - u.x, t.z - u.z);
    this.steer(u, t.x + t.hx * 4, 2.4, t.z + t.hz * 4, u.speed, dt);
    if (dist < 8 && t.alive) {
      t.stunned = Math.max(t.stunned, 1.6); t.v *= 0.35; t.wanted = Math.min(100, t.wanted + 5); t.spun = Math.max(t.spun, 1.0);
      this.sim.event(`Interceptor shock-pulse on ${t.name || 'vehicle'}`, 'hit');
      this.destroy(u, 'strike');
    }
  }

  updateWall(u, dt) {
    u.bob += dt * 2.2;
    u.x = u.homeX; u.z = u.homeZ;
    if (u.life <= 0) { u.y += 4 * dt; if (u.y > 40) u.alive = false; return; }
    u.y = 2.6 + Math.sin(u.bob) * 0.12;
    // Traffic collision with the wall
    for (const v of this.sim.traffic.vehicles) {
      if (!v.alive || v.kind === 'police' || v.parked) continue;
      if (Math.hypot(v.x - u.x, v.z - u.z) > 3.2) continue;
      v.v *= 0.2; v.stunned = Math.max(v.stunned, 1.2); v.wanted = Math.min(100, v.wanted + 5);
      this.sim.event(`${v.name || 'Vehicle'} crashed into a wall drone`, 'hit');
      this.destroy(u, 'hit');
      break;
    }
  }
}

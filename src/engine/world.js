// The simulation: car + race + portals, stepped at a fixed rate.
//
// The renderer never calls into here. It reads world.car and world.race
// after each frame, so the same code runs headless in the tests.

import { Car, CAR } from './car.js';
import { Race } from './race.js';
import { len } from './math.js';

export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

const NO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export class World {
  constructor(level) {
    this.level = level;
    this.t = 0;
    this.car = new Car(level.spawn);
    this.race = new Race(level);
    this.env = { t: 0, ground: level.ground, solids: level.solids };
    this.stats = { falls: 0, portals: 0 };
    this.events = [];
    this.partId = level.spawn.partId;
  }

  reset() {
    this.t = 0;
    this.env.t = 0;
    this.car.reset(this.level.spawn);
    this.race.reset();
    this.stats = { falls: 0, portals: 0 };
    this.partId = this.level.spawn.partId;
    this.events = [];
  }

  // Put the car at the last checkpoint with no speed.
  respawn() {
    const pose = this.race.respawnPose();
    this.car.reset({ pos: pose.pos, yaw: pose.yaw, speed: 0 });
    this.partId = pose.partId;
    this.race.partId = pose.partId;
    this.stats.falls++;
    this.events.push({ type: 'respawn' });
  }

  // Advance one physics step.
  step(dt, input) {
    this.events = [];
    if (this.race.phase === 'finished') return this.events;

    this.t += dt;
    this.env.t = this.t;
    const prev = this.car.pos.slice();
    this.car.step(dt, input, this.env);

    const raceEvents = this.race.update(prev, this.car.pos, this.t);
    for (const ev of raceEvents) {
      if (ev.type === 'portal') {
        const speed = Math.max(12, len(this.car.vel));
        this.car.teleport(ev.pose, speed);
        this.partId = ev.partId;
        this.stats.portals++;
      }
      this.events.push(ev);
    }

    if (this.car.pos[1] < this.level.killY || this.car.airTime > 3) {
      this.respawn();
    }
    return this.events;
  }

  get speedKmh() {
    return Math.abs(this.car.speed) * 3.6;
  }

  get finished() {
    return this.race.phase === 'finished';
  }
}

export { NO_INPUT, CAR };

// Race rules: gates, portal pairs, checkpoints, timing and respawns.
//
// Gate roles, in the order they must be crossed:
//   start   — arms the timer; the car spawns behind it
//   entry   — a portal. Crossing it teleports the car to the paired exit
//             gate, which may be in a completely different part of the town
//   finish  — stops the timer
//
// Exit gates are not part of the order. They are the destination of a portal.
// Each gate can only be crossed from behind to in front, and only the *next*
// gate in order counts, so you cannot skip a checkpoint.

import { sub, dot, lerpV } from './math.js';

// Returns true if the segment prev→cur crosses the gate plane front-ward
// within the gate's opening.
export function crossedGate(gate, prev, cur) {
  const dPrev = dot(sub(prev, gate.pos), gate.fwd);
  const dCur = dot(sub(cur, gate.pos), gate.fwd);
  if (!(dPrev < 0 && dCur >= 0)) return false;
  const u = dPrev / (dPrev - dCur);
  const pc = lerpV(prev, cur, u);
  const rel = sub(pc, gate.pos);
  const lat = dot(rel, gate.right);
  const vert = dot(rel, gate.up);
  return Math.abs(lat) <= gate.halfW && vert >= -1 && vert <= gate.halfH;
}

export class Race {
  constructor(level) {
    this.level = level;
    this.order = level.gateOrder; // [startGate, entry1, entry2, finishGate]
    this.reset();
  }

  reset() {
    this.phase = 'ready'; // ready → racing → finished
    this.next = 0;
    this.startedAt = null;
    this.finishedAt = null;
    this.splits = []; // { id, label, t } at each checkpoint
    this.respawn = this.level.spawn;
    this.partId = this.level.spawn.partId;
    this.resets = 0;
    this.now = 0;
  }

  get elapsed() {
    if (this.startedAt === null) return 0;
    const end = this.finishedAt ?? this.now;
    return end - this.startedAt;
  }

  // Check the car's movement this step. Returns a list of events the world
  // should act on: { type:'teleport', pose, partId } or { type:'checkpoint' } etc.
  update(prev, cur, t) {
    this.now = t;
    const events = [];
    if (this.phase === 'finished') return events;
    const gate = this.order[this.next];
    if (!gate) return events;
    if (!crossedGate(gate, prev, cur)) return events;

    if (gate.role === 'start') {
      this.phase = 'racing';
      this.startedAt = t;
      this.splits.push({ id: gate.id, label: gate.label, t: 0 });
      this.respawn = gate.respawn;
      this.next++;
      events.push({ type: 'start' });
    } else if (gate.role === 'entry') {
      const exit = gate.pair;
      this.splits.push({ id: gate.id, label: gate.label, t: t - this.startedAt });
      this.respawn = exit.respawn;
      this.partId = exit.partId;
      this.next++;
      events.push({ type: 'portal', from: gate.id, to: exit.id, pose: exit.exitPose, partId: exit.partId });
      events.push({ type: 'checkpoint', id: gate.id, label: gate.label });
    } else if (gate.role === 'finish') {
      this.phase = 'finished';
      this.finishedAt = t;
      this.splits.push({ id: gate.id, label: gate.label, t: t - this.startedAt });
      this.next++;
      events.push({ type: 'finish', time: t - this.startedAt });
    }
    return events;
  }

  // Where to put the car after a fall or a manual reset.
  respawnPose() {
    return this.respawn;
  }
}

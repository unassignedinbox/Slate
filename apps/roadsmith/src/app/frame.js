// Per-frame glue between the simulation and the renderer: instance poses + signal lamp states.

import { angleDelta } from '../core/math.js';

const buckets = new Map();

function bucket(key) {
  let b = buckets.get(key);
  if (!b) { b = []; buckets.set(key, b); }
  return b;
}

/** Push every dynamic pose (vehicles, wheels, parked cars, trains, booms) into the renderer. */
export function updateInstances(renderer, scene, hidden = new Set()) {
  for (const list of buckets.values()) list.length = 0;

  for (const v of scene.traffic.vehicles) {
    bucket(`car:${v.type}`).push({
      x: v.pos.x, y: v.pos.y, z: v.pos.z, yaw: v.yaw,
      colour: v.colour, spin: v.roll || 0, lift: v.pitch || 0,
      emissive: (v.brake || 0) > 0.1 ? 1.4 : 0.15, scale: 1,
    });
    const wheels = scene.vehicleMeshes[v.type]?.wheels || [];
    const wb = bucket('wheel');
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    for (const w of wheels) {
      wb.push({
        x: v.pos.x + w.x * c - w.z * s,
        y: v.pos.y + w.y,
        z: v.pos.z + w.x * s + w.z * c,
        yaw: v.yaw + (w.steer ? (v.steer || 0) * 0.6 : 0),
        colour: [1, 1, 1], lift: -(v.wheelSpin || 0), scale: (v.spec?.wheelR || 0.33) / 0.33,
      });
    }
  }

  if (!hidden.has('parked')) {
    for (const p of scene.parked) {
      bucket(`parked:${p.type}`).push({
        x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, colour: p.colour, scale: 1, emissive: 0,
      });
      const wheels = scene.vehicleMeshes[p.type]?.wheels || [];
      const wb = bucket('parkedwheel');
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      for (const w of wheels) {
        wb.push({
          x: p.pos.x + w.x * c - w.z * s, y: p.pos.y + w.y, z: p.pos.z + w.x * s + w.z * c,
          yaw: p.yaw, colour: [1, 1, 1], scale: 1,
        });
      }
    }
  }

  if (scene.trains && scene.trainMesh) {
    const tb = bucket('train');
    for (const t of scene.trains.poses()) {
      tb.push({
        x: t.pos.x, y: t.pos.y, z: t.pos.z, yaw: t.yaw,
        colour: [0.52, 0.55, 0.6], emissive: t.lead ? 1.6 : 0, scale: 1,
      });
    }
  }

  if (scene.boomMesh && scene.crossing.barriers.length) {
    const bb = bucket('boom');
    const lowered = scene.trains ? scene.trains.barrierState : 0;
    for (const b of scene.crossing.barriers) {
      bb.push({
        x: b.pivot.x, y: b.pivot.y, z: b.pivot.z, yaw: b.axis,
        colour: [0.86, 0.3, 0.26], scale: (b.length || 4.8) / 4.8,
        lift: (1 - lowered) * (Math.PI / 2),
      });
    }
  }

  for (const [key, list] of buckets) renderer.setInstances(key, list);
  return buckets;
}

/** Map the controller state onto the signal-lens groups baked into the prop geometry. */
export function updateSignals(renderer, scene, time = 0) {
  const states = [];
  const nodes = scene.laneGraph.nodes;
  for (const s of scene.props.signals) {
    const n = nodes.get(s.junction);
    let st;
    if (n && n.signalised) {
      const d = Math.abs(angleDelta(n.axis, s.heading));
      const group = (d < Math.PI / 4 || d > (3 * Math.PI) / 4) ? 0 : 1;
      const live = n.phase === group ? n.state : 'red';
      st = {
        red: live === 'red' ? 1 : 0,
        amber: live === 'amber' ? 1 : 0,
        green: live === 'green' ? 1 : 0,
        ped: live === 'red' ? 0.85 : 0,
      };
    } else {
      st = { red: 0, amber: 0.35 + 0.35 * Math.sin(time * 6), green: 0, ped: 0 };
    }
    states[s.group] = st;
  }
  for (let i = 0; i < states.length; i++) if (!states[i]) states[i] = { red: 0, amber: 0, green: 0, ped: 0 };
  renderer.setSignalStates(states);
  return states;
}

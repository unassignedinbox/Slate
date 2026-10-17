// LEVEL 01 - one continuous world holding several sections ("worlds") far apart.
// Portals link them: you never load a new level, you are carried to another part
// of the same map, keeping your speed and direction.
//
//   S1 FRACTURED TOWN  - a broken town floating in zero gravity
//   S2 THE TILTED CITY - a downtown broken into huge tipped plates, gravity on
//   S3 (placeholder)   - a runway, so the S2 portal has somewhere to go
import * as THREE from 'three';
import { World } from '../core/world.js';
import { buildSection1 } from './section1/index.js';
import { buildSection2 } from './section2/index.js';
import { buildPlaceholder } from './placeholder.js';

export const LEVEL01 = {
  id: 'L01',
  name: 'LEVEL 01',
  sun: { azimuth: 218, elevation: 34 },
};

export function buildLevel01(opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const world = new World();
  const s1 = buildSection1(world, opts);
  // Section 2 lies ~1.7 km beyond the Section 1 portal, in the direction it faces:
  // its leaning skyline is on the horizon behind the gate.
  const s2 = buildSection2(world, opts);
  // Section 3 (placeholder) another 1.5 km on, past the Section 2 portal.
  const e2 = s2.route.at(s2.route.length);
  const d3 = new THREE.Vector3(Math.cos(e2.psi), 0, -Math.sin(e2.psi));
  const o3 = e2.p.clone().addScaledVector(d3, 1500).setY(64);
  const s3 = buildPlaceholder(world, o3, e2.psi * 180 / Math.PI, { n: 3 });
  world.finalize();
  const portals = [{
    id: 'S1>S2',
    label: 'SECTION 2',
    from: { parent: s1.gate.parent, centre: s1.gate.centre, quat: s1.gate.quat, w: s1.gate.w, h: s1.gate.h },
    to: { parent: s2.arrival.parent, centre: s2.arrival.centre, quat: s2.arrival.quat },
    fromSection: 0, toSection: 1,
  }, {
    id: 'S2>S3',
    label: 'SECTION 3',
    from: { parent: s2.gate.parent, centre: s2.gate.centre, quat: s2.gate.quat, w: s2.gate.w, h: s2.gate.h },
    to: { parent: s3.arrival.parent, centre: s3.arrival.centre, quat: s3.arrival.quat },
    fromSection: 1, toSection: 2,
  }];
  const sections = [
    { id: 'S1', name: 'FRACTURED TOWN', ctx: s1.ctx, route: s1.route },
    { id: 'S2', name: 'THE TILTED CITY', ctx: s2.ctx, route: s2.route, plan: s2.plan },
    { id: 'S3', name: 'SECTION 3 (PLACEHOLDER)', ctx: s3.ctx, route: s3.route, finishS: s3.finishS },
  ];
  const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  const all = sections.map((s) => s.ctx);
  return {
    world, sections, portals, buildMs: ms,
    start: s1.ctx.respawns[0],
    labels: all.flatMap((c) => c.labels),
    stats: {
      bodies: world.bodies.length,
      colliders: world.bodies.reduce((a, b) => a + b.colliders.length, 0),
      props: all.reduce((a, c) => a + c.stats.props, 0),
      tris: world.bodies.reduce((a, b) => a + (b.geometry ? b.geometry.index.count / 3 : 0), 0),
    },
  };
}

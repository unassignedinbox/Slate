import * as THREE from 'three';
import { frameAt } from '../lib/curves.js';
import { samplesBetween, SURFACE_Y, PAVING_Y } from '../lib/topology.js';
import { subtractIntervals } from '../lib/infrastructure.js';
import { streetscapeDistances } from '../lib/streetscape.js';
import { gridRibbonGeometry, volumeRibbonGeometry } from './geometry.js';

function add(parent, geometry, material, name, data) {
  if (!geometry.index?.count) {
    geometry.dispose();
    return;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData = { ...data, streetscapeFeature: name };
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function frameBox(parent, frame, offset, along, lift, size, material, name, data) {
  const p = frame.point
    .clone()
    .addScaledVector(frame.normal, offset)
    .addScaledVector(frame.tangent, along);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(p.x, p.y + lift, p.z);
  mesh.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
  mesh.userData = { ...data, streetscapeFeature: name };
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function renderSidewalk(parent, plan, band, infrastructure, street, materials) {
  const { road, carriage, width } = plan,
    side = band.side;
  const spans = infrastructure.roadCrossings.get(road.id) || [],
    from = plan.startTrim,
    to = plan.length - plan.endTrim;
  const data = { roadId: road.id };
  const fall = (d) =>
    spans.reduce((f, [a, b]) => {
      const t = Math.min(1, Math.max(0, (d - a + 3) / 3), Math.max(0, (b + 3 - d) / 3));
      return Math.max(f, t * t * (3 - 2 * t));
    }, 0);
  const ramps = street.ramps.filter((r) => r.side === side),
    inner = (side * carriage) / 2,
    outer = (side * width) / 2;
  for (const [a, b] of subtractIntervals(from, to, spans)) {
    const base = samplesBetween(plan, a, b),
      ds = streetscapeDistances(
        a,
        b,
        ramps,
        base.map((s) => s.distance),
      );
    const ss = ds.map((d) => frameAt(plan.curve, d, plan.length));
    // Preserve the shared mitered portal frames at either end.
    if (Math.abs(a - plan.startTrim) < 1e-5) ss[0] = base[0];
    if (Math.abs(b - (plan.length - plan.endTrim)) < 1e-5) ss[ss.length - 1] = base.at(-1);
    const depths = [...new Set([0, ...ramps.map((r) => r.depth), band.width])]
      .filter((u) => u >= 0 && u <= band.width)
      .sort((x, y) => x - y);
    const offsets = depths.map((u) => inner + side * u).sort((x, y) => x - y);
    const height = (s, offset) => {
      const lift = street.pavingLift(s.distance, offset, side);
      return lift - (lift - SURFACE_Y) * fall(s.distance);
    };
    add(
      parent,
      gridRibbonGeometry(ss, offsets, height),
      materials.paving,
      'Sidewalk_with_integrated_curb_drops',
      data,
    );
    const drains = street.drains.filter(
      (d) => d.side === side && ['inlet', 'combined'].includes(d.type),
    );
    for (const [c, d] of subtractIntervals(
      a,
      b,
      drains.map((drain) => [drain.distance - 0.6, drain.distance + 0.6]),
    )) {
      const curbs = streetscapeDistances(c, d, ramps, ds).map((x) =>
        frameAt(plan.curve, x, plan.length),
      );
      if (Math.abs(c - a) < 1e-5) curbs[0] = ss[0];
      if (Math.abs(d - b) < 1e-5) curbs[curbs.length - 1] = ss.at(-1);
      const curbTop = (s) => {
        const top = road.curbs
          ? 0.32 - (0.32 - SURFACE_Y) * street.rampWeight(s.distance, side)
          : height(s, inner);
        return top - (top - SURFACE_Y) * fall(s.distance);
      };
      add(
        parent,
        volumeRibbonGeometry(
          curbs,
          road.curbs ? 0.2 : 0.025,
          inner + side * (road.curbs ? 0.1 : 0.0125),
          SURFACE_Y,
          curbTop,
        ),
        road.curbs ? materials.curb : materials.paving,
        road.curbs ? 'Raised_curb_with_ramp_drops' : 'Pavement_riser',
        data,
      );
    }
    add(
      parent,
      volumeRibbonGeometry(
        ss,
        0.04,
        outer,
        0.02,
        (s) => PAVING_Y - (PAVING_Y - SURFACE_Y) * fall(s.distance),
      ),
      materials.paving,
      'Sidewalk_edge',
      data,
    );
  }
  for (const ramp of ramps) {
    const data = { roadId: road.id, ...(ramp.propId ? { propId: ramp.propId } : {}) };
    if (ramp.type === 'curbRamp') {
      const ss = samplesBetween(
        plan,
        Math.max(from, ramp.distance - ramp.width / 2 + 0.15),
        Math.min(to, ramp.distance + ramp.width / 2 - 0.15),
        0.35,
      );
      const offsets = [inner + side * 0.15, inner + side * Math.min(0.65, ramp.depth)].sort(
        (a, b) => a - b,
      );
      add(
        parent,
        gridRibbonGeometry(
          ss,
          offsets,
          (s, offset) => street.pavingLift(s.distance, offset, side) + 0.006,
        ),
        materials.tactile,
        'Tactile_crosswalk_warning_pad',
        data,
      );
    } else {
      // Vehicle apron continues beyond the paving at the same finished level.
      const ss = samplesBetween(
        plan,
        ramp.distance - ramp.width / 2,
        ramp.distance + ramp.width / 2,
        0.5,
      );
      add(
        parent,
        volumeRibbonGeometry(ss, 5, outer + side * 2.5, -0.24, PAVING_Y),
        materials.rampConcrete,
        'Vehicle_access_apron',
        data,
      );
    }
  }
}

export function renderDrainage(parent, plan, street, materials) {
  const data = { roadId: plan.road.id },
    edge = plan.carriage / 2;
  for (const drain of street.drains) {
    const { side, distance, type } = drain,
      s = frameAt(plan.curve, distance, plan.length);
    if (['grate', 'combined'].includes(type)) {
      const offset = side * (edge - 0.37);
      frameBox(
        parent,
        s,
        offset,
        0,
        SURFACE_Y + 0.002,
        [0.66, 0.008, 1.12],
        materials.drainShadow,
        'Gutter_grate_recess',
        data,
      );
      for (const lateral of [-0.31, 0.31])
        frameBox(
          parent,
          s,
          offset + lateral,
          0,
          SURFACE_Y + 0.012,
          [0.035, 0.022, 1.14],
          materials.drainIron,
          'Grate_frame',
          data,
        );
      for (const along of [-0.54, 0.54])
        frameBox(
          parent,
          s,
          offset,
          along,
          SURFACE_Y + 0.012,
          [0.64, 0.022, 0.035],
          materials.drainIron,
          'Grate_frame',
          data,
        );
      for (let d = -0.44; d <= 0.44; d += 0.11)
        frameBox(
          parent,
          s,
          offset,
          d,
          SURFACE_Y + 0.009,
          [0.6, 0.016, 0.025],
          materials.drainIron,
          'Gutter_grate_bar',
          data,
        );
    }
    if (['inlet', 'combined'].includes(type)) {
      // The curb beam has a real gap here, with a recessed throat and lintel.
      frameBox(
        parent,
        s,
        side * (edge + 0.22),
        0,
        0.185,
        [0.12, 0.16, 1.1],
        materials.drainShadow,
        'Kerb_inlet_throat',
        data,
      );
      frameBox(
        parent,
        s,
        side * (edge + 0.1),
        0,
        0.295,
        [0.23, 0.05, 1.2],
        materials.curb,
        'Kerb_inlet_lintel',
        data,
      );
      for (const d of [-0.55, 0.55])
        frameBox(
          parent,
          s,
          side * (edge + 0.1),
          d,
          0.19,
          [0.2, 0.18, 0.06],
          materials.curb,
          'Kerb_inlet_jamb',
          data,
        );
      for (const d of [-0.36, 0, 0.36])
        frameBox(
          parent,
          s,
          side * (edge + 0.025),
          d,
          0.185,
          [0.025, 0.15, 0.035],
          materials.drainIron,
          'Kerb_inlet_safety_bar',
          data,
        );
    }
  }
  for (const [side, spans] of street.slotSpans)
    for (const [a, b] of spans) {
      const ss = samplesBetween(plan, a, b, 1.5),
        offset = side * (edge - 0.14);
      add(
        parent,
        gridRibbonGeometry(ss, [offset - 0.055, offset + 0.055], () => SURFACE_Y + 0.002),
        materials.drainShadow,
        'Continuous_slot_drain',
        data,
      );
      for (const sign of [-1, 1])
        add(
          parent,
          volumeRibbonGeometry(ss, 0.018, offset + sign * 0.056, SURFACE_Y, SURFACE_Y + 0.008),
          materials.drainIron,
          'Slot_drain_steel_edge',
          data,
        );
    }
}

import { sampleCurve, frameAt } from './curves.js';
import { roadWidth } from './profiles.js';
import { bridgeSupports, distanceToPath } from './infrastructure.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Structural decorations are authored in the same arc/normal frame as the
 * deck. No world-axis assumptions: rotated and curved bridges use this plan. */
export function planBridgeStructure(road, infrastructure, plan) {
  const prepared = infrastructure.prepared.get(road.id) || sampleCurve(road, 2),
    length = prepared.length,
    width = roadWidth(road),
    style = road.bridgeStyle || 'beam';
  const start = Math.max(plan?.startTrim || 0, (road.bridgeSpan?.start ?? 0.33) * length),
    end = Math.min(length - (plan?.endTrim || 0), (road.bridgeSpan?.end ?? 0.67) * length);
  const members = [],
    ribbons = [],
    sheets = [],
    supports = bridgeSupports(road, infrastructure, plan);
  const frame = (d) => frameAt(prepared.curve, clamp(d, 0, length), length);
  const at = (d, offset = 0, lift = 0) => {
    const s = frame(d),
      p = s.point.clone().addScaledVector(s.normal, offset);
    p.y += lift;
    return p;
  };
  const safeBelow = (a, b, margin = 0.4) => {
    for (let i = 0; i <= 8; i++) {
      const p = a.clone().lerp(b, i / 8);
      for (const [id, other] of infrastructure.prepared) {
        if (id === road.id || !other.road) continue;
        const near = distanceToPath(p, other);
        if (
          near.y < road.elevation - 1.2 &&
          near.distance < roadWidth(other.road) / 2 + margin &&
          p.y - margin < near.y + 5.5
        )
          return false;
      }
    }
    return true;
  };
  const member = (
    name,
    a,
    b,
    size = [0.18, 0.18],
    material = 'bridgeSteel',
    cable = false,
    below = false,
  ) => {
    if (a.distanceTo(b) < 0.01 || (below && !safeBelow(a, b, Math.max(...size)))) return;
    members.push({ name, a, b, size, material, cable });
  };
  const frames = (a = start, b = end, count = Math.min(160, Math.max(2, Math.ceil((b - a) / 2)))) =>
    Array.from({ length: count + 1 }, (_, i) => frame(a + ((b - a) * i) / count));
  const ribbon = (name, offset, w, bottom, top, material = 'bridgeSteel', a = start, b = end) => {
    if (b > a + 0.05)
      ribbons.push({ name, samples: frames(a, b), offset, width: w, bottom, top, material });
  };
  if (end - start < 2) return { style, start, end, members, ribbons, sheets, supports };
  const edge = Math.max(1.3, width / 2 - 0.28),
    span = end - start,
    n = Math.max(4, Math.min(48, Math.ceil(span / 12))),
    stations = Array.from({ length: n + 1 }, (_, i) => start + (span * i) / n);
  const thickness = road.deckThickness || 0.8;

  if (style === 'girder') {
    const count = Math.max(2, Math.min(8, Math.ceil(width / 3.8)));
    for (let i = 0; i < count; i++) {
      const offset = width * (-0.38 + (0.76 * i) / (count - 1));
      ribbon('Steel_I_girder_web', offset, 0.14, 0.075 - thickness, 0.005);
      ribbon('Steel_I_girder_top_flange', offset, 0.6, -0.09, 0.025);
      ribbon('Steel_I_girder_bottom_flange', offset, 0.6, 0.075 - thickness, 0.17 - thickness);
    }
  } else if (style === 'box') {
    for (const side of [-1, 1]) {
      const center = side * width * 0.24,
        w = width * 0.4;
      ribbon(
        'Box_girder_soffit',
        center,
        w,
        0.075 - thickness,
        0.25 - thickness,
        'structuralConcrete',
      );
      for (const sign of [-1, 1])
        ribbon(
          'Box_girder_web',
          center + sign * (w / 2 - 0.12),
          0.24,
          0.075 - thickness,
          0.025,
          'structuralConcrete',
        );
    }
  } else if (style === 'arch') {
    const rise = road.bridgeRise || 12,
      segments = Math.max(20, Math.min(96, Math.ceil(span / 3)));
    for (const side of [-1, 1]) {
      const curve = Array.from({ length: segments + 1 }, (_, i) =>
        at(
          start + (span * i) / segments,
          side * edge,
          0.45 + rise * Math.sin((Math.PI * i) / segments),
        ),
      );
      for (let i = 1; i < curve.length; i++)
        member('Through_arch_rib', curve[i - 1], curve[i], [0.5, 0.55]);
      for (const d of stations.slice(1, -1)) {
        const lift = 0.45 + rise * Math.sin((Math.PI * (d - start)) / span);
        member(
          'Arch_vertical_hanger',
          at(d, side * edge, 0.28),
          at(d, side * edge, lift),
          [0.055, 0.055],
          'bridgeCable',
          true,
        );
      }
    }
    for (const d of stations) {
      const lift = 0.45 + rise * Math.sin((Math.PI * (d - start)) / span);
      // Never put a transverse arch tie in the vehicle-clearance envelope.
      if (lift >= 6.5)
        member('Arch_overhead_tie', at(d, -edge, lift), at(d, edge, lift), [0.2, 0.22]);
    }
  } else if (['truss', 'covered', 'footbridge'].includes(style)) {
    const timber = style === 'covered',
      material = timber ? 'bridgeTimber' : 'bridgeSteel';
    const height = Math.max(
      style === 'footbridge' ? 2.8 : 6.5,
      road.bridgeRise || (timber ? 7.5 : 7),
    );
    for (const side of [-1, 1]) {
      ribbon(
        timber ? 'Timber_truss_lower_chord' : 'Truss_lower_chord',
        side * edge,
        0.22,
        0.22,
        0.48,
        material,
      );
      ribbon(
        timber ? 'Timber_truss_upper_chord' : 'Truss_upper_chord',
        side * edge,
        0.24,
        height - 0.22,
        height,
        material,
      );
      for (let i = 0; i < n; i++) {
        member(
          'Truss_diagonal',
          at(stations[i], side * edge, i % 2 ? height : 0.4),
          at(stations[i + 1], side * edge, i % 2 ? 0.4 : height),
          [0.22, 0.25],
          material,
        );
        member(
          'Truss_vertical',
          at(stations[i], side * edge, 0.4),
          at(stations[i], side * edge, height),
          [0.18, 0.2],
          material,
        );
      }
      member(
        'Truss_end_post',
        at(end, side * edge, 0.4),
        at(end, side * edge, height),
        [0.2, 0.22],
        material,
      );
    }
    for (let i = 0; i < stations.length; i++) {
      const d = stations[i];
      member(
        'Truss_overhead_crossbeam',
        at(d, -edge, height - 0.05),
        at(d, edge, height - 0.05),
        [0.18, 0.18],
        material,
      );
      if (i < n && i % 2 === 0)
        member(
          'Truss_roof_diagonal',
          at(d, -edge, height),
          at(stations[i + 1], edge, height),
          [0.12, 0.12],
          material,
        );
    }
    if (timber) {
      const ss = frames(),
        roofHeight = (offset) => height + 0.12 + 1.6 * (1 - Math.abs(offset) / (edge + 0.45));
      sheets.push({
        name: 'Covered_bridge_pitched_roof',
        samples: ss,
        offsets: [-edge - 0.45, 0, edge + 0.45],
        heightAt: roofHeight,
        material: 'bridgeRoof',
      });
      for (const side of [-1, 1])
        for (const lift of [0.7, 1.1, 1.5])
          ribbon(
            'Covered_bridge_side_planking',
            side * edge,
            0.12,
            lift,
            lift + 0.28,
            'bridgeTimber',
          );
    }
  } else if (['cableStayed', 'suspension'].includes(style)) {
    const height = road.bridgeTowerHeight || 18,
      towers = style === 'suspension' ? [start, end] : [start + span * 0.27, start + span * 0.73];
    for (const d of towers) {
      for (const side of [-1, 1])
        member(
          'Bridge_tower_leg',
          at(d, side * (edge + 0.15), 0.1),
          at(d, side * (edge + 0.15), height),
          [0.65, 0.7],
          'structuralConcrete',
        );
      for (const lift of [Math.max(6.5, height * 0.62), height - 0.5])
        member(
          'Bridge_tower_crossbeam',
          at(d, -edge - 0.15, lift),
          at(d, edge + 0.15, lift),
          [0.65, 0.7],
          'structuralConcrete',
        );
    }
    if (style === 'cableStayed') {
      for (const d of stations)
        for (const side of [-1, 1]) {
          const tower = d < start + span / 2 ? towers[0] : towers[1];
          if (Math.abs(tower - d) > 2)
            member(
              'Cable_stayed_fan',
              at(tower, side * edge, height - 0.6),
              at(d, side * edge, 0.3),
              [0.065, 0.065],
              'bridgeCable',
              true,
            );
        }
    } else {
      const cableHeight = (t) => 5.8 + (height - 5.8) * (2 * t - 1) ** 2;
      for (const side of [-1, 1]) {
        const points = Array.from({ length: 65 }, (_, i) =>
          at(start + (span * i) / 64, side * edge, cableHeight(i / 64)),
        );
        for (let i = 1; i < points.length; i++)
          member(
            'Suspension_main_cable',
            points[i - 1],
            points[i],
            [0.16, 0.16],
            'bridgeCable',
            true,
          );
        for (const d of stations.slice(1, -1))
          member(
            'Suspension_vertical_suspender',
            at(d, side * edge, 0.35),
            at(d, side * edge, cableHeight((d - start) / span)),
            [0.055, 0.055],
            'bridgeCable',
            true,
          );
        for (const [d, beyond] of [
          [start, Math.max(0, start - span * 0.6)],
          [end, Math.min(length, end + span * 0.6)],
        ])
          member(
            'Suspension_anchor_cable',
            at(d, side * edge, height),
            at(beyond, side * edge, 0.4),
            [0.14, 0.14],
            'bridgeCable',
            true,
          );
      }
      for (const side of [-1, 1])
        ribbon('Suspension_stiffening_girder', side * edge, 0.22, 0.28, 1.15);
    }
  } else if (style === 'stoneArch') {
    const central = supports.filter((s) => s.distance >= start - 1 && s.distance <= end + 1);
    for (let i = 1; i < central.length; i++) {
      const a = central[i - 1].distance,
        b = central[i].distance,
        rise = Math.max(
          0.5,
          Math.min(5, Math.min(frame(a).point.y, frame(b).point.y) - thickness - 1.3),
        );
      for (const side of [-1, 1]) {
        const count = 24,
          ps = Array.from({ length: count + 1 }, (_, j) =>
            at(
              a + ((b - a) * j) / count,
              side * width * 0.34,
              -thickness - 0.6 - rise * (1 - Math.sin((Math.PI * j) / count)),
            ),
          );
        for (let j = 1; j < ps.length; j++) {
          if (!safeBelow(ps[j - 1], ps[j], 0.85)) continue;
          member('Masonry_arch_voussoir', ps[j - 1], ps[j], [0.65, 0.85], 'bridgeStone');
          const from = a + ((b - a) * (j - 1)) / count,
            to = a + ((b - a) * j) / count;
          ribbon(
            'Masonry_arch_spandrel',
            side * width * 0.34,
            0.66,
            (s) =>
              -thickness - 0.28 - rise * (1 - Math.sin((Math.PI * (s.distance - a)) / (b - a))),
            0.075 - thickness,
            'bridgeStone',
            from,
            to,
          );
        }
      }
    }
  } else if (style === 'viaduct') {
    for (const side of [-1, 1])
      ribbon(
        'Viaduct_edge_haunch',
        side * edge,
        0.45,
        0.075 - thickness,
        0.035,
        'structuralConcrete',
      );
    for (const s of supports)
      for (const side of [-1, 1])
        member(
          'Viaduct_pier_bracket',
          at(s.distance, side * width * 0.34, -thickness - 0.7),
          at(s.distance, side * edge, -thickness + 0.15),
          [0.5, 0.5],
          'structuralConcrete',
          false,
          true,
        );
  } else if (style === 'timber') {
    const count = Math.max(3, Math.min(8, Math.ceil(width / 1.8)));
    for (let i = 0; i < count; i++)
      ribbon(
        'Timber_longitudinal_stringer',
        width * (-0.36 + (0.72 * i) / (count - 1)),
        0.24,
        0.075 - thickness,
        0.025,
        'bridgeTimber',
      );
    for (const s of supports)
      for (const foot of s.feet) {
        const a = foot.clone().addScaledVector(s.normal, -0.38);
        a.y = 0.4;
        const b = foot.clone().addScaledVector(s.normal, 0.38);
        b.y = s.height - 0.25;
        member('Timber_bent_diagonal_brace', a, b, [0.2, 0.2], 'bridgeTimber', false, true);
      }
  }
  return { style, start, end, members, ribbons, sheets, supports };
}

import { renderBridgeStructure } from './bridges.js';
import { renderSidewalk, renderDrainage } from './streetscape.js';
import { planStreetscape } from '../lib/streetscape.js';
import * as THREE from 'three';
import { laneLayout, laneDirection, isMotorway, isBridge, roadWidth } from '../lib/profiles.js';
import { frameAt } from '../lib/curves.js';
import { SURFACE_Y, PAVING_Y, PAINT_Y, samplesBetween } from '../lib/topology.js';
import { markingPlan } from '../lib/markings.js';
import {
  subtractIntervals,
  mergeIntervals,
  bridgeSupports,
  PIER_FOOTING,
} from '../lib/infrastructure.js';
import {
  surfaceRibbonGeometry,
  profileRibbonGeometry,
  volumeRibbonGeometry,
  pathSamples,
  polygonGeometry,
  polygonVolumeGeometry,
  pavementReturnGeometry,
} from './geometry.js';

export function addMesh(parent, geometry, material, name, data = {}) {
  if (!geometry.index?.count) {
    geometry.dispose();
    return null;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData = data;
  mesh.receiveShadow = !data.decal;
  mesh.castShadow = !!data.structure;
  if (data.decal) mesh.renderOrder = 3;
  parent.add(mesh);
  return mesh;
}

export function paintGeometry(plan, distance, offset, width, length, direction = 1) {
  const positions = [],
    uv = [],
    indices = [],
    rows = Math.max(1, Math.ceil(length));
  for (let i = 0; i <= rows; i++) {
    const s = frameAt(plan.curve, distance + direction * (i / rows - 0.5) * length, plan.length);
    for (const side of [-1, 1]) {
      const p = s.point.clone().addScaledVector(s.normal, offset + (direction * side * width) / 2);
      positions.push(p.x, p.y + PAINT_Y, p.z);
      uv.push((side + 1) / 2, i / rows);
    }
  }
  for (let i = 0; i < rows; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function arrowGeometry(plan, distance, offset, direction, angle = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 2.1);
  shape.lineTo(0.8, 0.5);
  shape.lineTo(0.18, 0.5);
  shape.lineTo(0.18, -1.8);
  shape.lineTo(-0.18, -1.8);
  shape.lineTo(-0.18, 0.5);
  shape.lineTo(-0.8, 0.5);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape),
    positions = g.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const ox = positions.getX(i),
      oy = positions.getY(i);
    const x = ox * Math.cos(angle) - oy * Math.sin(angle),
      y = ox * Math.sin(angle) + oy * Math.cos(angle);
    const s = frameAt(plan.curve, distance + direction * y, plan.length);
    const lateral = Math.max(
      -plan.carriage / 2 + 0.05,
      Math.min(plan.carriage / 2 - 0.05, offset + direction * x),
    );
    const p = s.point.clone().addScaledVector(s.normal, lateral);
    positions.setXYZ(i, p.x, p.y + PAINT_Y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

const stencils = new Map();
function stencil(kind) {
  if (stencils.has(kind)) return stencils.get(kind);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ctx.strokeStyle = '#f3f0e6';
  if (kind === 'CYCLE') {
    ctx.lineWidth = 10;
    for (const x of [62, 194]) {
      ctx.beginPath();
      ctx.arc(x, 302, 37, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(62, 302);
    ctx.lineTo(105, 212);
    ctx.lineTo(149, 302);
    ctx.lineTo(62, 302);
    ctx.lineTo(151, 229);
    ctx.lineTo(194, 302);
    ctx.lineTo(170, 200);
    ctx.lineTo(196, 200);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(88, 212);
    ctx.lineTo(116, 212);
    ctx.stroke();
  } else {
    ctx.font = `bold ${kind === 'RAIL' ? 80 : 108}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(kind, 128, 265);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.5,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  material.name = `Paint_stencil_${kind}`;
  stencils.set(kind, material);
  return material;
}

export function renderMarkings(group, plan, infrastructure, materials, ribbonGeometry, standard) {
  const road = plan.road;
  if (!road.markings || road.type === 'path') return;
  const bands = laneLayout(road),
    spans = infrastructure.roadCrossings.get(road.id) || [],
    paint = markingPlan(plan, spans);
  const data = { roadId: road.id, decal: true };
  const line = (offset, width, material, dash, intervals = paint.allowed) => {
    for (const [a, b] of intervals) {
      const samples = samplesBetween(plan, a, b, 1.5).map((s) => ({
        ...s,
        distance: s.distance + (road.markingPhase || 0),
      }));
      if (samples.length > 1)
        addMesh(
          group,
          ribbonGeometry(samples, width, offset, PAINT_Y, dash),
          material,
          'Lane_paint',
          data,
        );
    }
  };
  const stamp = (d, band, kind, direction) => {
    const length = kind === 'BUS' ? 4.5 : kind === 'RAIL' ? 4 : 2.5;
    if (!paint.fits(d, length / 2 + 0.5)) return;
    addMesh(
      group,
      paintGeometry(
        plan,
        d,
        band.center,
        Math.min(band.width - 0.5, kind === 'CYCLE' ? 1.2 : 2.5),
        length,
        direction,
      ),
      stencil(kind),
      `Stencil_${kind}`,
      data,
    );
  };
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i],
      next = bands[i + 1],
      direction = laneDirection(road, band.side, standard);
    if (band.kind === 'lane') {
      if (
        next?.kind === 'lane' &&
        (next.side === band.side || road.oneWay || road.type === 'roundabout')
      )
        line(
          band.center + band.width / 2,
          0.12,
          materials.white,
          road.type === 'ramp' ? [3, 3] : [3, 6],
        );
      const candidates =
        road.type === 'roundabout'
          ? [(paint.from + paint.to) / 2]
          : direction === 1
            ? [paint.to - 14]
            : [paint.from + 14];
      for (const d of candidates)
        if (paint.fits(d, 3) && paint.to - paint.from > (road.type === 'roundabout' ? 10 : 30))
          addMesh(
            group,
            arrowGeometry(plan, d, band.center, direction),
            materials.white,
            'Lane_direction_arrow',
            data,
          );
    }
    if (band.kind === 'bus' || band.kind === 'cycle') {
      line(
        band.center - (band.side * band.width) / 2,
        0.13,
        materials.white,
        band.kind === 'bus' ? [6, 3] : null,
      );
      for (let d = paint.from + 22; d < paint.to - 15; d += 65)
        stamp(d, band, band.kind === 'bus' ? 'BUS' : 'CYCLE', direction);
    }
    if (band.kind === 'median')
      for (const side of [-1, 1])
        line(
          band.center + side * (band.width / 2 + 0.17),
          0.12,
          road.oneWay ? materials.white : materials.yellow,
        );
    if (band.kind === 'parking') {
      line(band.center - (band.side * band.width) / 2, 0.1, materials.white);
      for (let d = paint.from + 11; d < paint.to - 10; d += 5.5)
        if (paint.fits(d, 1)) {
          const a = frameAt(plan.curve, d - 1),
            b = frameAt(plan.curve, d + 1);
          if (a.tangent.dot(b.tangent) < 0.99) continue;
          addMesh(
            group,
            paintGeometry(plan, d, band.center, band.width - 0.18, 0.1),
            materials.white,
            'Parking_bay',
            data,
          );
        }
    }
  }
  if (!road.median && road.lanes > 1 && !road.oneWay && road.type !== 'roundabout') {
    const last = bands.filter((b) => b.kind === 'lane' && b.side === -1).at(-1);
    const divider = last ? last.center + last.width / 2 : 0;
    for (const side of [-1, 1])
      line(divider + side * 0.14, 0.1, materials.yellow, road.type === 'rural' ? [4, 5] : null);
  }
  for (const side of [-1, 1]) {
    const shoulder = bands.find((b) => b.kind === 'shoulder' && b.side === side)?.width || 0;
    const offset = side * (plan.carriage / 2 - shoulder - 0.18);
    const medianSide = ['uk', 'jp', 'au'].includes(standard) ? 1 : -1;
    line(offset, 0.12, road.mainline && side === medianSide ? materials.yellow : materials.white);
  }
  for (const zebra of paint.zebras) {
    for (let offset = -plan.carriage / 2 + 0.55; offset < plan.carriage / 2 - 0.2; offset += 1.05)
      addMesh(
        group,
        paintGeometry(plan, zebra.distance, offset, 0.45, 3),
        materials.white,
        'Zebra_crossing',
        data,
      );
    for (const b of bands.filter((b) => ['lane', 'bus'].includes(b.kind))) {
      const incoming = laneDirection(road, b.side, standard) === (zebra.end === 'start' ? -1 : 1);
      if (incoming)
        addMesh(
          group,
          paintGeometry(plan, zebra.stop, b.center, b.width - 0.12, 0.35),
          materials.white,
          'Stop_line',
          data,
        );
    }
  }
  for (const [a, b] of spans)
    for (const band of bands.filter((b) => b.kind === 'lane')) {
      const direction = laneDirection(road, band.side, standard),
        d = direction === 1 ? a - 12 : b + 12;
      stamp(d, band, 'RAIL', direction);
      const stop = direction === 1 ? a - 4.2 : b + 4.2;
      if (paint.fits(stop, 0.3))
        addMesh(
          group,
          paintGeometry(plan, stop, band.center, band.width - 0.12, 0.35),
          materials.white,
          'Rail_stop_line',
          data,
        );
    }
}

export function renderRoad(
  group,
  surfaces,
  plan,
  infrastructure,
  materials,
  instances,
  options,
  ribbonGeometry,
  standard,
) {
  const road = plan.road,
    samples = plan.samples,
    width = plan.width,
    carriage = plan.carriage;
  const spans = infrastructure.roadCrossings.get(road.id) || [],
    from = plan.startTrim,
    to = plan.length - plan.endTrim;
  const data = { roadId: road.id };
  const street = plan.streetscape || planStreetscape({ props: [] }, plan, infrastructure);
  const surfaceMat = materials[road.material] || materials.asphalt;
  for (const [a, b] of subtractIntervals(from, to, spans))
    addMesh(
      surfaces,
      surfaceRibbonGeometry(samplesBetween(plan, a, b), carriage),
      surfaceMat,
      `Carriageway_${road.id}`,
      { ...data, surface: true },
    );
  const deck = mergeIntervals(spans, from, to);
  for (const [a, b] of deck) {
    const offsets = [...new Set([-width / 2, -carriage / 2, carriage / 2, width / 2])].sort(
      (x, y) => x - y,
    );
    addMesh(
      surfaces,
      profileRibbonGeometry(samplesBetween(plan, a, b), offsets),
      materials.crossingDeck,
      `Level_crossing_deck_${road.id}`,
      { ...data, surface: true },
    );
  }
  const bands = laneLayout(road),
    paint = markingPlan(plan, spans);
  for (const band of bands) {
    if (band.kind === 'sidewalk') {
      renderSidewalk(group, plan, band, infrastructure, street, materials);
      continue;
    }
    if (band.kind === 'cycle' || band.kind === 'bus')
      for (const [a, b] of paint.allowed)
        addMesh(
          group,
          surfaceRibbonGeometry(
            samplesBetween(plan, a, b),
            band.width - 0.16,
            band.center,
            SURFACE_Y + 0.001,
          ),
          band.kind === 'cycle' ? materials.cycle : materials.bus,
          `${band.kind}_lane_surface`,
          { ...data, decal: true },
        );
    if (band.kind === 'median') {
      const intervals = subtractIntervals(
        from + (plan.startNode && !plan.startNode.continuous ? 4 : 0),
        to - (plan.endNode && !plan.endNode.continuous ? 4 : 0),
        spans.map(([a, b]) => [a - 3, b + 3]),
      );
      for (const [a, b] of intervals) {
        const ss = samplesBetween(plan, a, b);
        addMesh(
          group,
          volumeRibbonGeometry(ss, band.width, band.center, SURFACE_Y, 0.24),
          materials.curb,
          'Median_island',
          data,
        );
        if (band.width >= 2) {
          addMesh(
            group,
            surfaceRibbonGeometry(ss, band.width - 0.35, band.center, 0.25),
            materials.median,
            'Median_planting',
            data,
          );
          for (let d = a + 12; options.vegetation !== false && d < b - 8; d += 30) {
            const s = frameAt(plan.curve, d),
              p = s.point.clone().addScaledVector(s.normal, band.center);
            if (infrastructure.below(p)) continue;
            instances.trees.push({ x: p.x, y: p.y + 2.8, z: p.z, scale: 0.7 });
            instances.trunks.push({ x: p.x, y: p.y + 1.2, z: p.z });
          }
        }
      }
    }
  }
  renderDrainage(group, plan, street, materials);
  renderMarkings(group, plan, infrastructure, materials, ribbonGeometry, standard);
  if (road.lights && options.fixtures !== false)
    for (let d = from + 15; d < to - 12; d += 45) {
      const s = frameAt(plan.curve, d);
      for (const side of [-1, 1]) {
        const p = s.point.clone().addScaledVector(s.normal, side * (width / 2 - 0.6));
        if (infrastructure.below(p) || infrastructure.railInfluence(p) > 0.1) continue;
        instances.poles.push({ x: p.x, y: p.y + 3.8, z: p.z });
        instances.lamps.push({
          x: p.x,
          y: p.y + 7.65,
          z: p.z,
          rotation: Math.atan2(s.tangent.x, s.tangent.z),
        });
        if (options.vegetation !== false && Math.floor(d / 45) % 2 === 0 && road.sidewalk > 1.5) {
          const t = s.point.clone().addScaledVector(s.normal, side * (width / 2 + 3));
          if (!infrastructure.below(t) && infrastructure.railInfluence(t) < 0.1) {
            instances.trees.push({ x: t.x, y: t.y + 3.7, z: t.z, scale: 1 });
            instances.trunks.push({ x: t.x, y: t.y + 1.5, z: t.z });
          }
        }
      }
    }
  if (isMotorway(road) || isBridge(road)) {
    for (const side of [-1, 1]) {
      const offset = side * (width / 2 - 0.2);
      for (const [a, b] of subtractIntervals(
        from,
        to,
        spans.map(([a, b]) => [a - 2, b + 2]),
      ))
        addMesh(
          group,
          volumeRibbonGeometry(samplesBetween(plan, a, b), 0.14, offset, 0.98, 1.17),
          materials.steel,
          'Guardrail_beam',
          { ...data, structure: true },
        );
      for (let d = from + 2; d < to - 1; d += 5) {
        if (spans.some(([a, b]) => d >= a - 2 && d <= b + 2)) continue;
        const s = frameAt(plan.curve, d),
          p = s.point.clone().addScaledVector(s.normal, offset);
        instances.bollards.push({ x: p.x, y: p.y + 0.65, z: p.z, scale: 0.7 });
      }
    }
  }
  if (isBridge(road) || road.type === 'ramp') {
    const thickness = road.deckThickness || 0.8;
    // A girder/box/trestle is not hidden inside an equally deep solid slab.
    // Keep full-depth approach slabs; its central span has a thin roof slab
    // over visible webs/stringers that still reach the planned pier caps.
    const exposed = ['girder', 'box', 'timber'].includes(road.bridgeStyle);
    const spanStart = (road.bridgeSpan?.start ?? 0.33) * plan.length,
      spanEnd = (road.bridgeSpan?.end ?? 0.67) * plan.length;
    const slabBottom = exposed
      ? (s) => {
          const blend = Math.max(
            0,
            Math.min(1, (s.distance - spanStart) / 2, (spanEnd - s.distance) / 2),
          );
          return 0.075 - (thickness + (Math.min(0.26, thickness) - thickness) * blend);
        }
      : 0.075 - thickness;
    addMesh(
      group,
      volumeRibbonGeometry(samples, width, 0, slabBottom, 0.075),
      materials.structuralConcrete,
      'Bridge_deck_slab',
      {
        ...data,
        structure: true,
        ...(road.bridgeStyle
          ? { bridgeStyle: road.bridgeStyle, bridgeFeature: 'Bridge_deck_slab' }
          : {}),
      },
    );
    const pierMaterial =
      road.bridgeStyle === 'timber' || road.bridgeStyle === 'covered'
        ? materials.bridgeTimber
        : road.bridgeStyle === 'stoneArch'
          ? materials.bridgeStone
          : materials.structuralConcrete;
    for (const s of bridgeSupports(road, infrastructure, plan)) {
      const h = s.height;
      for (const p of s.feet) {
        const footing = new THREE.Mesh(
          new THREE.BoxGeometry(PIER_FOOTING.width, PIER_FOOTING.height, PIER_FOOTING.length),
          materials.structuralConcrete,
        );
        footing.name = 'Bridge_pier_footing';
        footing.position.set(p.x, PIER_FOOTING.bottom + PIER_FOOTING.height / 2, p.z);
        footing.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
        footing.castShadow = footing.receiveShadow = true;
        footing.userData = {
          ...data,
          structure: true,
          ...(road.bridgeStyle
            ? { bridgeStyle: road.bridgeStyle, bridgeFeature: 'Bridge_pier_footing' }
            : {}),
        };
        group.add(footing);
        const pier = new THREE.Mesh(new THREE.BoxGeometry(0.9, h - 0.25, 1.6), pierMaterial);
        pier.position.set(p.x, (h - 0.25) / 2, p.z);
        pier.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
        pier.name = 'Bridge_pier';
        pier.userData = {
          ...data,
          structure: true,
          ...(road.bridgeStyle
            ? { bridgeStyle: road.bridgeStyle, bridgeFeature: 'Bridge_pier' }
            : {}),
        };
        pier.castShadow = pier.receiveShadow = true;
        group.add(pier);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.45, 1.9), pierMaterial);
      cap.position.set(s.point.x, h - 0.225, s.point.z);
      cap.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
      cap.name = 'Bridge_pier_cap';
      cap.userData = {
        ...data,
        structure: true,
        ...(road.bridgeStyle
          ? { bridgeStyle: road.bridgeStyle, bridgeFeature: 'Bridge_pier_cap' }
          : {}),
      };
      cap.castShadow = cap.receiveShadow = true;
      group.add(cap);
    }
    if (road.bridgeStyle) renderBridgeStructure(group, road, plan, infrastructure, materials);
  }
}

export function renderJunction(group, surfaces, node, infrastructure, materials, ribbonGeometry) {
  const data = { junctionId: node.id, roadId: node.arms[0].road.id };
  const sameMaterial = node.arms.every((a) => a.road.material === node.arms[0].road.material);
  const surfaceMaterial = sameMaterial
    ? materials[node.arms[0].road.material] || materials.asphalt
    : materials.asphalt;
  addMesh(
    surfaces,
    polygonGeometry(node.boundary, SURFACE_Y, node),
    surfaceMaterial,
    `Junction_surface_${node.id}`,
    { ...data, surface: true },
  );
  if (node.arms.some((a) => isBridge(a.road) || a.road.type === 'ramp')) {
    const thickness = Math.max(...node.arms.map((a) => a.road.deckThickness || 0.8));
    addMesh(
      group,
      polygonVolumeGeometry(node.boundary, 0.075 - thickness, 0.075, node),
      materials.structuralConcrete,
      'Junction_deck_slab',
      { ...data, structure: true },
    );
  }
  const portalFall = (arm) => {
    const d = arm.start ? arm.plan.startTrim : arm.plan.length - arm.plan.endTrim;
    return (infrastructure.roadCrossings.get(arm.road.id) || []).reduce((f, [a, b]) => {
      const t = Math.min(1, Math.max(0, (d - a + 3) / 3), Math.max(0, (b + 3 - d) / 3));
      return Math.max(f, t * t * (3 - 2 * t));
    }, 0);
  };
  for (const ret of node.returns) {
    const hasWalk = ret.a.road.sidewalk || ret.b.road.sidewalk;
    const fa = portalFall(ret.a),
      fb = portalFall(ret.b);
    const influence = (p, i) => {
      const t = i / 8,
        base = fa + (fb - fa) * t;
      return base + (1 - base) * infrastructure.railInfluence(p) * 4 * t * (1 - t);
    };
    const heightAt = (p, lift, i) => lift - (lift - SURFACE_Y) * influence(p, i);
    if (hasWalk) {
      addMesh(
        group,
        pavementReturnGeometry(ret.inner, ret.outer, heightAt),
        materials.paving,
        'Pavement_return',
        data,
      );
      // Split rather than connecting a curb through an active railway corridor.
      let part = [];
      for (const [i, s] of pathSamples(ret.inner, true).entries()) {
        if (influence(s.point, i) > 0.1 || (!ret.a.road.curbs && !ret.b.road.curbs)) {
          if (part.length > 1)
            addMesh(
              group,
              volumeRibbonGeometry(part, 0.2, 0.1, SURFACE_Y, 0.32),
              materials.curb,
              'Curb_return',
              data,
            );
          part = [];
        } else part.push(s);
      }
      if (part.length > 1)
        addMesh(
          group,
          volumeRibbonGeometry(part, 0.2, 0.1, SURFACE_Y, 0.32),
          materials.curb,
          'Curb_return',
          data,
        );
    }
    if (node.arms.every((a) => isMotorway(a.road))) {
      const s = pathSamples(ret.inner, true);
      addMesh(
        group,
        volumeRibbonGeometry(s, 0.14, -0.2, 0.98, 1.17),
        materials.steel,
        'Merge_guardrail_return',
        { ...data, structure: true },
      );
      addMesh(
        group,
        surfaceRibbonGeometry(s, 0.12, -0.45, PAINT_Y),
        materials.white,
        'Gore_edge_line',
        { ...data, decal: true },
      );
    }
  }
}

export function renderRailway(group, rail, infrastructure, materials) {
  const prepared = infrastructure.prepared.get(rail.id),
    plan = { ...prepared, startTrim: 0, endTrim: 0 };
  const samples = samplesBetween(plan, 0, prepared.length, 1.5),
    spans = infrastructure.railCrossings.get(rail.id) || [];
  const data = { roadId: rail.id },
    trackCount = Math.max(1, rail.lanes),
    gauge = rail.gauge || 1.435;
  const bedMaterial =
    rail.material === 'gravel' ? materials.ballast : materials[rail.material] || materials.ballast;
  for (const [a, b] of subtractIntervals(0, prepared.length, spans)) {
    const ss = samplesBetween(plan, a, b, 2);
    addMesh(
      group,
      volumeRibbonGeometry(ss, roadWidth(rail), 0, -0.2, -0.055),
      bedMaterial,
      'Rail_ballast_bed',
      data,
    );
  }
  const tieGeometry = new THREE.BoxGeometry(2.65, 0.1, 0.22);
  for (let track = 0; track < trackCount; track++) {
    const center = (track - (trackCount - 1) / 2) * rail.laneWidth;
    for (let d = 0.8; d < prepared.length - 0.2; d += 0.75) {
      if (spans.some(([a, b]) => d >= a && d <= b)) continue;
      const s = frameAt(prepared.curve, d, prepared.length),
        p = s.point.clone().addScaledVector(s.normal, center);
      const tie = new THREE.Mesh(tieGeometry, materials.sleepers);
      tie.position.set(p.x, p.y - 0.005, p.z);
      tie.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
      group.add(tie);
    }
    for (const side of [-1, 1]) {
      const offset = center + side * (gauge / 2 + 0.036);
      addMesh(
        group,
        volumeRibbonGeometry(samples, 0.15, offset, 0.04, 0.053),
        materials.railSteel,
        'Rail_foot',
        data,
      );
      addMesh(
        group,
        volumeRibbonGeometry(samples, 0.034, offset, 0.053, 0.089),
        materials.railSteel,
        'Rail_web',
        data,
      );
      addMesh(
        group,
        volumeRibbonGeometry(samples, 0.072, offset, 0.089, 0.108),
        materials.railSteel,
        'Rail_head',
        data,
      );
      for (const [a, b] of spans)
        addMesh(
          group,
          surfaceRibbonGeometry(samplesBetween(plan, a, b, 1), 0.14, offset, PAINT_Y + 0.001),
          materials.flange,
          'Crossing_flange_recess',
          data,
        );
    }
  }
  for (const hit of infrastructure.crossings.filter((c) => c.rail.id === rail.id)) {
    if (!rail.barriers) continue;
    const rp = infrastructure.prepared.get(hit.road.id),
      half = roadWidth(hit.road) / 2;
    for (const direction of [-1, 1]) {
      const d = direction === 1 ? hit.roadSpan[0] - 3 : hit.roadSpan[1] + 3;
      if (d < 2 || d > rp.length - 2) continue;
      const s = frameAt(rp.curve, d, rp.length);
      const p = s.point.clone().addScaledVector(s.normal, direction * (half + 0.8));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.4, 0.32), materials.iron);
      post.position.set(p.x, p.y + 1.2, p.z);
      post.castShadow = true;
      group.add(post);
      const pivot = new THREE.Group();
      pivot.position.set(p.x, p.y + 1.4, p.z);
      pivot.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
      group.add(pivot);
      // Raised (open) arms leave the roadway clear in the static editor.
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.8, 0.12), materials.whiteHardware);
      arm.position.y = 1.9;
      pivot.add(arm);
      for (let y = 0.5; y < 3.8; y += 0.7) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.13), materials.safetyRed);
        stripe.position.y = y;
        pivot.add(stripe);
      }
      for (const x of [-0.26, 0.26]) {
        const signal = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), materials.signalRed);
        signal.position.set(x, 0.65, 0);
        pivot.add(signal);
      }
      const crossbuck = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.11, 0.1),
        materials.whiteHardware,
      );
      crossbuck.position.y = 1.35;
      crossbuck.rotation.z = Math.PI / 4;
      pivot.add(crossbuck);
      const second = crossbuck.clone();
      second.rotation.z = -Math.PI / 4;
      pivot.add(second);
    }
  }
}

import * as THREE from 'three';
import { planBridgeStructure } from '../lib/bridges.js';
import { volumeRibbonGeometry, gridRibbonGeometry } from './geometry.js';

/** Structure families produce exportable solids, not line-only ornaments. */
export function renderBridgeStructure(parent, road, plan, infrastructure, materials) {
  const parts = planBridgeStructure(road, infrastructure, plan);
  const data = (name) => ({
    roadId: road.id,
    structure: true,
    bridgeFeature: name,
    bridgeStyle: parts.style,
  });
  const attach = (geometry, material, name, position, quaternion) => {
    const mesh = new THREE.Mesh(geometry, materials[material] || materials.structuralConcrete);
    mesh.name = name;
    mesh.userData = data(name);
    mesh.castShadow = mesh.receiveShadow = true;
    if (position) mesh.position.copy(position);
    if (quaternion) mesh.quaternion.copy(quaternion);
    parent.add(mesh);
    return mesh;
  };
  for (const part of parts.ribbons)
    attach(
      volumeRibbonGeometry(part.samples, part.width, part.offset, part.bottom, part.top),
      part.material,
      part.name,
    );
  for (const part of parts.members) {
    const direction = part.b.clone().sub(part.a),
      length = direction.length();
    const geometry = part.cable
      ? new THREE.CylinderGeometry(part.size[0], part.size[0], length, 6)
      : new THREE.BoxGeometry(part.size[0], length, part.size[1]);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    attach(
      geometry,
      part.material,
      part.name,
      part.a.clone().add(part.b).multiplyScalar(0.5),
      rotation,
    );
  }
  for (const part of parts.sheets) {
    attach(
      gridRibbonGeometry(part.samples, part.offsets, (_, offset) => part.heightAt(offset)),
      part.material,
      part.name,
    );
    attach(
      gridRibbonGeometry(part.samples, part.offsets, (_, offset) => part.heightAt(offset) - 0.08),
      part.material,
      `${part.name}_underside`,
    );
  }
  return parts;
}

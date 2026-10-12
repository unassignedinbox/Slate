// Owns the Three.js objects for the built network. Rebuilt wholesale on change.
import * as THREE from 'three';
import type { NetworkMesh } from './network-mesh';
import { material } from './materials';

export class NetworkView {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  tunnelVisible = true;

  constructor(readonly parent: THREE.Object3D) {
    parent.add(this.group);
  }

  set(mesh: NetworkMesh): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes = [];
    for (const [name, b] of mesh.builder.buckets) {
      if (b.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(new THREE.Uint32BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material(name));
      m.name = name;
      m.frustumCulled = true;
      if (name === 'tunnel') m.visible = this.tunnelVisible;
      m.renderOrder = name === 'tunnel' ? 2 : 0;
      this.group.add(m);
      this.meshes.push(m);
    }
  }

  setTunnelVisible(v: boolean): void {
    this.tunnelVisible = v;
    for (const m of this.meshes) if (m.name === 'tunnel') m.visible = v;
  }
}

import * as THREE from 'three';

function softDotTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function buildDust(count = 260, bounds = 2.2) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * bounds * 2;
    positions[i * 3 + 1] = (Math.random() - 0.5) * bounds * 1.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * bounds * 2;
    speeds[i] = 0.02 + Math.random() * 0.05;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.02,
    map: softDotTexture(),
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    color: 0xcbb98f,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(dt, t) {
      const pos = geo.attributes.position;
      for (let i = 0; i < count; i++) {
        let y = pos.getY(i) + speeds[i] * dt;
        let x = pos.getX(i) + Math.sin(t * 0.3 + i) * 0.0015;
        if (y > bounds * 0.6) y = -bounds * 0.6;
        pos.setY(i, y);
        pos.setX(i, x);
      }
      pos.needsUpdate = true;
    },
  };
}

import * as THREE from 'three';

/**
 * Two GPU point systems: hot swarf thrown off the boring head, and the
 * fine fuel mist that escapes around the seal once the wall is breached.
 * Both are driven by the agent's real state, not on a timer.
 */
export class Effects {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.size = new Float32Array(max);
    this.head = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `
        attribute float aLife; attribute float aKind; attribute float aSize;
        varying float vLife; varying float vKind;
        uniform float uScale;
        void main(){
          vLife = aLife; vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale * (300.0 / max(0.001, -mv.z)) * (0.35 + 0.65 * aLife);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vLife; varying float vKind;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d,d);
          if (r > 0.25) discard;
          float a = smoothstep(0.25, 0.0, r) * vLife;
          // kind 0 = spark (white -> orange -> red), kind 1 = fuel mist
          vec3 spark = mix(vec3(1.0,0.35,0.06), vec3(1.0,0.95,0.8), pow(vLife,2.0));
          vec3 mist  = vec3(0.85,0.70,0.34);
          vec3 c = mix(spark, mist, vKind);
          gl_FragColor = vec4(c, a * mix(1.0, 0.35, vKind));
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geom = g;
  }

  spawn(p, v, ttl, kind, size) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = 1; this.ttl[i] = ttl; this.kind[i] = kind; this.size[i] = size;
  }

  burstSparks(origin, normal, n, speed) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.4 + Math.random()))
        .addScaledVector(normal, speed * 0.8 * Math.random());
      this.spawn(origin, v, 0.22 + Math.random() * 0.35, 0, 1.8 + Math.random() * 2.2);
    }
  }

  mist(origin, normal, n) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(0.25).addScaledVector(normal, 0.35 + Math.random() * 0.4);
      this.spawn(origin, v, 0.6 + Math.random() * 0.7, 1, 3.0 + Math.random() * 4.0);
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / this.ttl[i];
      if (this.life[i] <= 0) { this.life[i] = 0; this.size[i] = 0; continue; }
      const drag = this.kind[i] > 0.5 ? 1.8 : 0.9;
      const g = this.kind[i] > 0.5 ? -0.6 : -6.5;
      this.vel[i * 3] *= Math.exp(-drag * dt);
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * Math.exp(-drag * dt) + g * dt;
      this.vel[i * 3 + 2] *= Math.exp(-drag * dt);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.aLife.needsUpdate = true;
    this.geom.attributes.aKind.needsUpdate = true;
    this.geom.attributes.aSize.needsUpdate = true;
  }
}

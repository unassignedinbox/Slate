// ---------------------------------------------------------------------------
// Pooled particle system for dust, glass glitter, wood fibers, concrete
// powder — one THREE.Points draw call for everything.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const MAX = 6000;

export class ParticleSystem {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private sizeAttr: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.sizeAttr = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1000;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.sizeAttr, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float psize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * 320.0 / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.1, d) * 0.85;
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    count: number,
    color: THREE.Color,
    opts: { speed?: number; spread?: number; size?: number; life?: number; drag?: number; gravityBias?: number } = {}
  ): void {
    const speed = opts.speed ?? 3;
    const spread = opts.spread ?? 1;
    const size = opts.size ?? 0.02;
    const life = opts.life ?? 1.2;
    const drag = opts.drag ?? 1.2;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.pos[i * 3] = origin.x;
      this.pos[i * 3 + 1] = origin.y;
      this.pos[i * 3 + 2] = origin.z;
      const rx = (Math.random() - 0.5) * 2 * spread;
      const ry = (Math.random() - 0.5) * 2 * spread;
      const rz = (Math.random() - 0.5) * 2 * spread;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.vel[i * 3] = (dir.x + rx) * s;
      this.vel[i * 3 + 1] = (dir.y + ry + (opts.gravityBias ?? 0.25)) * s;
      this.vel[i * 3 + 2] = (dir.z + rz) * s;
      const shade = 0.7 + Math.random() * 0.5;
      this.col[i * 3] = Math.min(1, color.r * shade);
      this.col[i * 3 + 1] = Math.min(1, color.g * shade);
      this.col[i * 3 + 2] = Math.min(1, color.b * shade);
      this.sizeAttr[i] = size * (0.5 + Math.random());
      this.life[i] = life * (0.5 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i];
      this.drag[i] = drag;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1000;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - 5.5 * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.005) {
        this.pos[i * 3 + 1] = 0.005;
        this.vel[i * 3 + 1] *= -0.2;
        this.vel[i * 3] *= 0.7;
        this.vel[i * 3 + 2] *= 0.7;
      }
      // fade via size
      const t = this.life[i] / this.maxLife[i];
      if (t < 0.3) this.sizeAttr[i] *= 0.985;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
}

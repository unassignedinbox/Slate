import * as THREE from 'three';

/**
 * 3D Aerodynamic Flow & Vortex Particle System.
 * Visualizes air streamline flow over the cambered wings, downwash, and wingtip slot vortex reduction.
 */
export class AerodynamicFlowVisualizer {
  public group: THREE.Group;
  private particles!: THREE.Points;
  private particleCount = 750;
  private positions: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private colors: Float32Array;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'aerodynamic_flow_system';
    this.group.visible = false; // Enabled via UI toggle

    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.lifetimes = new Float32Array(this.particleCount);
    this.colors = new Float32Array(this.particleCount * 3);

    this.initParticles();
  }

  private initParticles(): void {
    const geometry = new THREE.BufferGeometry();

    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i, true);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    // Glow dot texture for aerodynamic streamlines
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.3, 'rgba(56, 189, 248, 0.85)');
    grad.addColorStop(0.8, 'rgba(14, 165, 233, 0.2)');
    grad.addColorStop(1, 'rgba(14, 165, 233, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      size: 0.05,
      map: texture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.group.add(this.particles);
  }

  private resetParticle(i: number, randomStart = false): void {
    const i3 = i * 3;
    // Emit in front of the eagle's leading edge
    const span = (Math.random() - 0.5) * 2.2; // spanwise distribution
    const yStart = 0.2 + (Math.random() - 0.5) * 0.4;
    const xStart = randomStart ? 0.8 - Math.random() * 2.0 : 0.8;

    this.positions[i3] = xStart;
    this.positions[i3 + 1] = yStart;
    this.positions[i3 + 2] = span;

    // Streamline velocity (backward flow -X, downwash -Y)
    this.velocities[i3] = -(1.8 + Math.random() * 0.6);
    this.velocities[i3 + 1] = -0.15;
    this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.05;

    this.lifetimes[i] = Math.random() * 1.5;

    // Color by pressure/velocity: Cyan/blue for high-speed suction, amber/yellow for wingtip vortex
    const isTip = Math.abs(span) > 0.85;
    if (isTip) {
      // Golden vortex
      this.colors[i3] = 0.95;
      this.colors[i3 + 1] = 0.75;
      this.colors[i3 + 2] = 0.15;
    } else {
      // Aerodynamic laminar blue
      this.colors[i3] = 0.2;
      this.colors[i3 + 1] = 0.75;
      this.colors[i3 + 2] = 1.0;
    }
  }

  public update(delta: number, isFlapping: boolean): void {
    if (!this.group.visible) return;

    const pos = this.positions;
    const vel = this.velocities;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Update position
      pos[i3] += vel[i3] * delta;
      pos[i3 + 1] += vel[i3 + 1] * delta;
      pos[i3 + 2] += vel[i3 + 2] * delta;

      // Wingtip vortex swirl if near tip (Z > 0.8)
      if (Math.abs(pos[i3 + 2]) > 0.8 && pos[i3] < 0.2) {
        const sign = Math.sign(pos[i3 + 2]);
        pos[i3 + 1] += Math.sin(pos[i3] * 15) * 0.008;
        pos[i3 + 2] += sign * Math.cos(pos[i3] * 15) * 0.006;
      }

      this.lifetimes[i] -= delta;

      if (pos[i3] < -1.4 || this.lifetimes[i] <= 0) {
        this.resetParticle(i);
      }
    }

    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }
}

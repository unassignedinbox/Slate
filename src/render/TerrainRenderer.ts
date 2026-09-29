import type { GPU } from '../core/gl/GPU';
import { t2, t3 } from '../core/gl/GPU';
import { RAYMARCH_FRAG } from './raymarch';
import type { BuildResult } from '../core/graph/Evaluator';

export interface ShadingSettings {
  sunAzimuth: number;
  sunElevation: number;
  sunIntensity: number;
  ambient: number;
  shadows: boolean;
  ao: boolean;
  fog: number;
  grid: boolean;
  water: boolean;
  contours: boolean;
  shadeMode: 'shaded' | 'albedo' | 'normals' | 'height';
  quality: number;
}

export const DEFAULT_SHADING: ShadingSettings = {
  sunAzimuth: 132,
  sunElevation: 34,
  sunIntensity: 2.6,
  ambient: 0.55,
  shadows: true,
  ao: true,
  fog: 0.45,
  grid: true,
  water: true,
  contours: false,
  shadeMode: 'shaded',
  quality: 1,
};

export class OrbitCamera {
  yaw = -0.85;
  pitch = 0.42;
  distance = 1.7;
  target: [number, number, number] = [0, 0, 0];
  fov = 0.62;

  position(worldSize: number): [number, number, number] {
    const d = this.distance * worldSize;
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + d * cp * Math.cos(this.yaw),
      this.target[1] + d * Math.sin(this.pitch),
      this.target[2] + d * cp * Math.sin(this.yaw),
    ];
  }

  orbit(dx: number, dy: number) {
    this.yaw += dx * 0.006;
    this.pitch = Math.max(-0.35, Math.min(1.5, this.pitch + dy * 0.006));
  }

  pan(dx: number, dy: number, worldSize: number) {
    const s = this.distance * worldSize * 0.0013;
    const right: [number, number, number] = [-Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const fwd: [number, number, number] = [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    this.target[0] += (-right[0] * dx + fwd[0] * dy) * s;
    this.target[2] += (-right[2] * dx + fwd[2] * dy) * s;
  }

  zoom(delta: number) {
    this.distance = Math.max(0.06, Math.min(6, this.distance * Math.exp(delta * 0.0014)));
  }

  frame(_worldSize: number, heightScale: number) {
    this.target = [0, heightScale * 0.28, 0];
    this.distance = 1.25;
    this.yaw = -0.85;
    this.pitch = 0.4;
  }
}

export class TerrainRenderer {
  camera = new OrbitCamera();
  shading: ShadingSettings = { ...DEFAULT_SHADING };
  private build: BuildResult | null = null;
  private raf = 0;
  private startTime = performance.now();
  /** dynamic resolution while interacting */
  private scale = 1;
  private movingUntil = 0;
  private dirty = true;
  onStats?: (fps: number, res: string) => void;
  private frames = 0;
  private lastStat = performance.now();

  constructor(
    private gpu: GPU,
    private canvas: HTMLCanvasElement,
  ) {}

  setBuild(b: BuildResult | null) {
    this.build = b;
    this.dirty = true;
  }

  markMoving() {
    this.movingUntil = performance.now() + 180;
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  start() {
    if (this.raf) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame() {
    const now = performance.now();
    const moving = now < this.movingUntil;
    const wantScale = moving ? 0.5 : 1;
    if (wantScale !== this.scale) { this.scale = wantScale; this.dirty = true; }
    // water ripples animate, so keep drawing when water is on
    const animated = this.shading.water && !!(this.build?.water || (this.build?.seaLevel ?? 0) > 0);
    if (!this.dirty && !moving && !animated) return;
    this.dirty = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const cssW = this.canvas.clientWidth || 1;
    const cssH = this.canvas.clientHeight || 1;
    const w = Math.max(2, Math.round(cssW * dpr * this.scale));
    const h = Math.max(2, Math.round(cssH * dpr * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const b = this.build;
    const s = this.shading;
    const worldSize = b?.settings.worldSize ?? 4096;
    const heightScale = b?.settings.heightScale ?? 900;
    const exag = b?.exaggeration ?? 1;

    const az = (s.sunAzimuth * Math.PI) / 180;
    const el = (s.sunElevation * Math.PI) / 180;
    const sun = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];

    const camPos = this.camera.position(worldSize);
    const modeIdx = { shaded: 0, albedo: 1, normals: 2, height: 3 }[s.shadeMode];

    this.gpu.present({
      name: 'view.raymarch',
      frag: RAYMARCH_FRAG,
      width: w,
      height: h,
      uniforms: {
        uHeight: t2(b?.height ?? null),
        uColor: t2(b?.color ?? null),
        uWater: t2(b?.water ?? null),
        uVolume: t3(b?.volume ?? null),
        uHasHeight: b?.height ? 1 : 0,
        uHasColor: b?.color ? 1 : 0,
        uHasWater: b?.water ? 1 : 0,
        uHasVolume: b?.volume ? 1 : 0,
        uCamPos: camPos,
        uCamTarget: this.camera.target,
        uFov: this.camera.fov,
        uWorldSize: worldSize,
        uHeightScale: heightScale,
        uExag: exag,
        uSeaLevel: b?.seaLevel ?? 0,
        uCaveBlend: b?.caveBlend ?? 12,
        uSunDir: sun,
        uSunIntensity: s.sunIntensity,
        uAmbient: s.ambient,
        uSkyTop: [0.42, 0.52, 0.68],
        uSkyBottom: [0.72, 0.74, 0.76],
        uGroundCol: [0.36, 0.33, 0.29],
        uShowGrid: s.grid ? 1 : 0,
        uShowWater: s.water ? 1 : 0,
        uShadows: s.shadows ? 1 : 0,
        uAO: s.ao ? 1 : 0,
        uFog: s.fog,
        uQuality: moving ? 0.35 : s.quality,
        uWireframe: s.contours ? 1 : 0,
        uTime: (now - this.startTime) * 0.001,
      },
      ints: { uShadeMode: modeIdx },
    });

    this.frames++;
    if (now - this.lastStat > 500) {
      const fps = (this.frames * 1000) / (now - this.lastStat);
      this.onStats?.(fps, `${w}×${h}`);
      this.frames = 0;
      this.lastStat = now;
    }
  }
}

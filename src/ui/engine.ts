import { GPU } from '../core/gl/GPU';
import { Evaluator, type BuildHandle, type BuildResult } from '../core/graph/Evaluator';
import { TerrainRenderer } from '../render/TerrainRenderer';
import type { GraphDoc } from '../core/graph/types';

export interface BuildCallbacks {
  onProgress?(fraction: number, label: string): void;
  onDone?(result: BuildResult): void;
  onThumbnail?(nodeId: string, data: ImageData): void;
  onFatal?(message: string): void;
}

/**
 * Owns the single WebGL2 context. The node graph renders into FBOs, the
 * viewport presents to the same canvas — one context, no texture copying.
 */
export class Engine {
  gpu: GPU;
  evaluator: Evaluator;
  renderer: TerrainRenderer;
  lastResult: BuildResult | null = null;
  fatal: string | null = null;

  private current: BuildHandle | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.gpu = new GPU(canvas);
    this.evaluator = new Evaluator(this.gpu);
    this.renderer = new TerrainRenderer(this.gpu, canvas);
  }

  get busy() {
    return !!this.current && !this.current.aborted;
  }

  cancel() {
    if (this.current) this.current.aborted = true;
  }

  /** A failed build should not brick the session — let the next edit retry. */
  clearFatal() {
    this.fatal = null;
  }

  async build(doc: GraphDoc, pinned: string | null, cb: BuildCallbacks) {
    if (this.fatal) return;
    // supersede whatever is running
    if (this.current) this.current.aborted = true;
    const handle: BuildHandle = { aborted: false };
    this.current = handle;

    try {
      const result = await this.evaluator.build(doc, {
        handle,
        pinnedId: pinned,
        thumbnails: true,
        onProgress: cb.onProgress,
        onThumbnail: cb.onThumbnail,
      });
      if (handle.aborted) return;
      this.lastResult = result;
      this.renderer.setBuild(result);
      this.renderer.invalidate();
      cb.onDone?.(result);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(err);
      const msg = String(err?.message ?? err);
      this.fatal = msg;
      cb.onFatal?.(msg);
    } finally {
      if (this.current === handle) this.current = null;
    }
  }

  /** Full-resolution heightfield as a Float32Array (row-major, bottom-up). */
  readHeight(): { data: Float32Array; size: number } | null {
    const h = this.lastResult?.height;
    if (!h) return null;
    return { data: this.gpu.read(h), size: h.w };
  }

  readColorPNG(): string | null {
    const c = this.lastResult?.color;
    if (!c) return null;
    const bytes = this.gpu.readBytes(c);
    const cv = document.createElement('canvas');
    cv.width = c.w;
    cv.height = c.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(c.w, c.h);
    // flip vertically
    for (let y = 0; y < c.h; y++) {
      const src = (c.h - 1 - y) * c.w * 4;
      img.data.set(bytes.subarray(src, src + c.w * 4), y * c.w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  dispose() {
    this.cancel();
    this.renderer.stop();
    this.gpu.dispose();
  }
}

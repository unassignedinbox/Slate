/**
 * A GPU stand-in for headless tests.
 *
 * It implements the surface the nodes and the Evaluator use, records every
 * fragment source that gets submitted, and — importantly — tracks allocations
 * so tests can assert that a build does not leak render targets.
 */
import type { Tex2D, Vol3D, TexFormat } from '../src/core/gl/GPU';

export interface MockPass { name: string; frag: string; supplied: Set<string>; }

export class MockGPU {
  passes: MockPass[] = [];
  liveTex = new Set<Tex2D>();
  liveVol = new Set<Vol3D>();
  peakTex = 0;
  doubleFrees = 0;
  private uid = 0;

  private capture(o: any, injected: string[]) {
    this.passes.push({
      name: o.name,
      frag: o.frag,
      supplied: new Set([...Object.keys(o.uniforms ?? {}), ...Object.keys(o.ints ?? {}), ...injected]),
    });
  }

  pass = (o: any) => this.capture(o, ['uTexel', 'uRes']);
  pass3D = (o: any) => this.capture(o, ['uTexel', 'uRes', 'uVolRes', 'uLayer']);
  present = (o: any) => this.capture(o, ['uTexel', 'uRes']);

  alloc(w: number, h: number, fmt: TexFormat = 'R32F'): Tex2D {
    const t = { tex: {} as any, w, h, fmt, key: `${w}x${h}:${fmt}`, uid: ++this.uid } as unknown as Tex2D;
    this.liveTex.add(t);
    this.peakTex = Math.max(this.peakTex, this.liveTex.size);
    return t;
  }

  allocVolume(size: number): Vol3D {
    const v = { tex: {} as any, size, uid: ++this.uid } as unknown as Vol3D;
    this.liveVol.add(v);
    return v;
  }

  free(t: Tex2D | null) {
    if (!t) return;
    if (!this.liveTex.delete(t)) this.doubleFrees++;
  }

  freeVolume(v: Vol3D | null) {
    if (!v) return;
    if (!this.liveVol.delete(v)) this.doubleFrees++;
  }

  minMax(): [number, number] { return [0, 1]; }
  read(): Float32Array { return new Float32Array(4); }
  readBytes(_t: Tex2D, out?: Uint8Array): Uint8Array { return out ?? new Uint8Array(4); }
  lut() { return {} as any; }
  purge() {}
  dispose() {}
}

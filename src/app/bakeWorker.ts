/**
 * Off-thread deformation bake.
 *
 * The plastic shell solve is ~0.3-1.5 s per impact site, which is exactly why
 * it is baked rather than run per frame. Doing it in a worker means the demo
 * behaves like a shipped game would: the bake is an asset-build step, the main
 * thread never stalls, and sites stream in while you play. In production this
 * same code runs at cook time and the result ships as a texture.
 */

import { bakeDent, fitCage, DentSite, ShellTopo, Cage } from '../frac/dent';
import { v3 } from '../core/math';

interface InitMsg {
  type: 'init';
  x0: Float32Array; tris: Uint32Array;
  edge: Uint32Array; edgeRest: Float32Array;
  bend: Uint32Array; bendRest: Float32Array;
  frames: number;
  cage: { nx: number; ny: number; nz: number; min: [number, number, number]; size: [number, number, number]; nodes: number };
}
interface BakeMsg { type: 'bake'; i: number; site: DentSite; }
type Msg = InitMsg | BakeMsg;

let topo: ShellTopo | null = null;
let cage: Cage | null = null;
let frames = 14;
let x0: Float32Array | null = null;

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'init') {
    x0 = m.x0;
    topo = {
      n: m.x0.length / 3, x0: m.x0, tris: m.tris,
      edge: m.edge, edgeRest: m.edgeRest, bend: m.bend, bendRest: m.bendRest,
    };
    cage = {
      nx: m.cage.nx, ny: m.cage.ny, nz: m.cage.nz, nodes: m.cage.nodes,
      min: v3(...m.cage.min), size: v3(...m.cage.size),
    };
    frames = m.frames;
    return;
  }
  if (m.type === 'bake' && topo && cage && x0) {
    const site: DentSite = { ...m.site, p: v3(m.site.p.x, m.site.p.y, m.site.p.z), d: v3(m.site.d.x, m.site.d.y, m.site.d.z) };
    const b = bakeDent(topo, site, { frames });
    const cageData = new Float32Array(frames * cage.nodes * 4);
    for (let f = 0; f < frames; f++) {
      const slice = b.pos.subarray(f * b.count * 4, (f + 1) * b.count * 4);
      cageData.set(fitCage(cage, x0, slice, b.verts), f * cage.nodes * 4);
    }
    (self as unknown as Worker).postMessage(
      { type: 'done', i: m.i, verts: b.verts, pos: b.pos, nrm: b.nrm, cage: cageData, count: b.count, ms: b.ms },
      [b.verts.buffer, b.pos.buffer, b.nrm.buffer, cageData.buffer],
    );
  }
};

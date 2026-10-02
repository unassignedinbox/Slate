#!/usr/bin/env node
/* ------------------------------------------------------------------------------------------------------------------
   QuadTreadAudit — headless proof for References/QuadTreadModelling.html.

   The HTML is the single source of truth: this script slices the geometry core straight out of it (between the
   BEGIN/END GEOMETRY CORE markers), runs it with no browser and no three.js, builds every design at every step of
   the pipeline, and checks the mesh that comes out.

   What is checked, per design and per step:
     · every face is a quad with four distinct corners, and no quad has zero area
     · every edge is shared by exactly two faces, or by one if it lies on a tread edge
     · neighbouring quads traverse their shared edge in opposite directions (consistent winding)
     · at step 5 — the bridged, arrayed band — there are NO open edges anywhere except the two tread edges
     · how far the worst quad is from planar, and how small the smallest quad is

   Usage:  node Exhibits/Workbench/Tyre/QuadTreadAudit.mjs [design] [step]
           node Exhibits/Workbench/Tyre/QuadTreadAudit.mjs            # every design, steps 2 and 5
           node Exhibits/Workbench/Tyre/QuadTreadAudit.mjs --json     # machine-readable, writes QuadTreadAudit.result.json
   Exit code is 1 if anything fails, so it can gate a commit.
------------------------------------------------------------------------------------------------------------------ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(here, '../../../References/QuadTreadModelling.html');

const src = fs.readFileSync(HTML, 'utf8');
const a = src.indexOf('/* ===== BEGIN GEOMETRY CORE');
const b = src.indexOf('/* ===== END GEOMETRY CORE');
if (a < 0 || b < 0) {
  console.error('QuadTreadAudit: could not find the geometry core markers in', HTML);
  process.exit(2);
}
const core = src.slice(src.indexOf('*/', a) + 2, b);

/* The core is plain top-level declarations — no imports, no DOM, no three.js — so it runs as-is. */
const API = new Function(`${core}
  return { DESIGNS, buildTread, tessellate, weldAll, auditTread, derive };`)();

const BASE = {
  width: 225, aspect: 45, rim: 17, treadFrac: 0.88,
  depth: 8.5, crown: 3, shoulderLen: 14, shoulderDrop: 4,
  pitches: 56, pitchVar: 0, gap: 0.14,
  dens: 3.2, draft: 4, chamfer: 0.7, sipeDepthF: 0.62,
  sym: 'mirror', shift: 0, flipAlt: false,
};

function run(key, step) {
  const design = API.DESIGNS[key];
  const T = { ...BASE, ...(design.set || {}) };
  T.sym = design.sym ?? T.sym;
  T.shift = design.shift ?? T.shift;
  T.flipAlt = design.flip ?? T.flipAlt;

  const t0 = Date.now();
  const build = API.buildTread(T, design, step);
  const tess = API.tessellate(build, T);                       // proves the render path runs too
  const tBuild = Date.now() - t0;

  const t1 = Date.now();
  const r = API.auditTread(build, T, step);
  r.design = key; r.step = step; r.buildMs = tBuild; r.auditMs = Date.now() - t1;
  r.triangles = (tess.tile.pos.length + tess.bridge.pos.length) / 9;
  r.bridgeQuads = tess.bridgeQuads;
  r.pitch = build.D.pitchLens[0];
  return r;
}

const args = process.argv.slice(2).filter(s => !s.startsWith('--'));
const asJson = process.argv.includes('--json');
const designs = args[0] ? [args[0]] : Object.keys(API.DESIGNS);
const steps = args[1] ? [+args[1]] : [2, 5];

const rows = [];
let bad = 0;
for (const key of designs) {
  for (const step of steps) {
    const r = run(key, step);
    rows.push(r);
    if (!r.ok) bad++;
  }
}

if (asJson) {
  const out = { generated: new Date().toISOString(), source: path.relative(path.resolve(here, '../../..'), HTML), base: BASE, rows };
  fs.writeFileSync(path.join(here, 'QuadTreadAudit.result.json'), JSON.stringify(out, null, 2) + '\n');
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log(`QuadTreadAudit — ${path.relative(process.cwd(), HTML)}`);
console.log('');
console.log(`${pad('design', 10)}${num('step', 5)}${num('quads', 10)}${num('verts', 10)}${num('tiles', 6)}` +
            `${num('degen', 7)}${num('nonman', 7)}${num('wind', 6)}${num('rim bnd', 9)}${num('other bnd', 11)}` +
            `${num('warp mm', 9)}${num('ms', 7)}  ok`);
for (const r of rows) {
  console.log(`${pad(r.design, 10)}${num(r.step, 5)}${num(r.quads, 10)}${num(r.verts, 10)}${num(r.tiles, 6)}` +
              `${num(r.degenerate, 7)}${num(r.nonManifold, 7)}${num(r.inconsistent, 6)}${num(r.rimBoundary, 9)}` +
              `${num(r.otherBoundary, 11)}${num(r.maxWarp.toFixed(3), 9)}${num(r.buildMs + r.auditMs, 7)}  ${r.ok ? 'yes' : 'NO'}`);
}
console.log('');
console.log('step 2 = one whole pattern tile, flat: its open edges are the two tread edges plus the two pitch seams.');
console.log('step 5 = the bridged band: "other bnd" must be 0 — every seam welded, nothing open but the tread edges.');
console.log(bad ? `\nFAILED: ${bad} of ${rows.length} cases` : `\nPASSED: ${rows.length} cases`);
process.exit(bad ? 1 : 0);

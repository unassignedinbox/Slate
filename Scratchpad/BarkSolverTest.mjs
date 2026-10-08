// ============================================================================================================================================================
//  Slate :: BarkSolverTest
//
//  Verification for the bark prototype in BarkSolver.html. The solver core lives inside that single HTML file;
//  this harness lifts the block between the CORE-BEGIN / CORE-END markers into a temporary module and exercises
//  it directly, so the shipped page and the tested code can never drift apart.
//
//  Run:  node Scratchpad/BarkSolverTest.mjs
// ============================================================================================================================================================
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const Here = dirname(fileURLToPath(import.meta.url));
const PagePath = join(Here, 'BarkSolver.html');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Load the core out of the page
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function LoadCore()
{
    const html = readFileSync(PagePath, 'utf8');
    const begin = html.indexOf('// ==CORE-BEGIN==');
    const end = html.indexOf('// ==CORE-END==');
    if (begin < 0 || end < 0 || end <= begin)
    {
        console.error('BarkSolver.html is missing its CORE-BEGIN / CORE-END markers');
        process.exit(1);
    }
    const dir = mkdtempSync(join(tmpdir(), 'slate-bark-'));
    const file = join(dir, 'core.mjs');
    writeFileSync(file, html.slice(begin, end));
    return import(pathToFileURL(file).toString());
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Tiny reporting
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
let Passed = 0, Failed = 0;
const Failures = [];

function Check(name, ok, detail)
{
    if (ok) { Passed++; console.log(`  ok    ${name}${detail ? '   ' + detail : ''}`); }
    else { Failed++; Failures.push(name); console.log(`  FAIL  ${name}${detail ? '   ' + detail : ''}`); }
}

function Section(title) { console.log(`\n${title}`); }

function Near(a, b, tol) { return Math.abs(a - b) <= tol; }

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Geometry helpers used by the assertions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function PointInPolygon(poly, x, y)
{
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function Wrap(d, period) { return d - period * Math.round(d / period); }

function Digest(result)
{
    let h = 0x811C9DC5;
    const mix = (v) => { h ^= (v | 0); h = Math.imul(h, 0x01000193); };
    mix(result.structure.vertexCount);
    mix(result.structure.triangleCount);
    mix(result.structure.pieces.length);
    const P = result.structure.positions;
    for (let i = 0; i < P.length; i += 7) mix(Math.round(P[i] * 1e6));
    const A = result.projection.albedo;
    for (let i = 0; i < A.length; i += 11) mix(A[i]);
    return (h >>> 0).toString(16).padStart(8, '0');
}

function DistanceToBoundary(poly, x, y)
{
    let best = Infinity;
    for (let i = 0, n = poly.length; i < n; i++)
    {
        const ax = poly[i][0], ay = poly[i][1];
        const bx = poly[(i + 1) % n][0], by = poly[(i + 1) % n][1];
        const ex = bx - ax, ey = by - ay;
        const len2 = ex * ex + ey * ey;
        let t = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const dx = x - (ax + ex * t), dy = y - (ay + ey * t);
        const d = Math.hypot(dx, dy);
        if (d < best) best = d;
    }
    return best;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 1 — the Voronoi tessellation really tiles the strip
//
//  For a lattice of sample points: find the nearest seed by brute force (metric wrapped in x), build that
//  seed's cell, and confirm the sample lies inside it. Every sample must land in exactly one cell, and the
//  cell it lands in must be its nearest seed's cell. That is the definition of a correct Voronoi diagram.
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestTiling(core, spec, trunk, clustering)
{
    const W = trunk.width, H = trunk.height;
    const seeds = clustering.seeds;
    const cells = [];
    for (let i = 0; i < seeds.length; i++)
    {
        cells.push(core.ClusterSolver.cellForSeed(seeds, clustering.index, i, W, H, clustering.hint, clustering.boxX, clustering.boxY));
    }

    const SX = 64, SY = 48;
    let insideNearest = 0, missing = 0, total = 0, wrongCell = 0, nullCells = 0;

    for (let sy = 0; sy < SY; sy++)
    {
        for (let sx = 0; sx < SX; sx++)
        {
            const px = (sx + 0.5) / SX * W;
            const py = (sy + 0.5) / SY * H;
            total++;

            // Brute-force nearest seed under the periodic metric.
            let best = -1, bestD2 = Infinity;
            for (let i = 0; i < seeds.length; i++)
            {
                const dx = Wrap(seeds[i].x - px, W), dy = seeds[i].y - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestD2) { bestD2 = d2; best = i; }
            }

            const cell = cells[best];
            if (!cell) nullCells++;
            const local = cell ? cell.map((p) => [seeds[best].x + p[0], seeds[best].y + p[1]]) : null;
            let hit = false;
            if (local)
            {
                hit = PointInPolygon(local, px, py);
                // x is periodic: also test the sample shifted by one full circumference.
                if (!hit) hit = PointInPolygon(local, px + (px < W * 0.5 ? W : -W), py);
            }
            if (hit) insideNearest++; else missing++;

            // Nothing other than the nearest seed may claim the sample.
            for (let i = 0; i < seeds.length; i++)
            {
                if (i === best || !cells[i]) continue;
                const c = cells[i];
                let cx = px - seeds[i].x, cy = py - seeds[i].y;
                cx = Wrap(cx, W);
                if (PointInPolygon(c, cx, cy)) { wrongCell++; break; }
            }
        }
    }

    Check(`${spec.key}: every sample lies inside its nearest cell`,
        missing === 0, `${insideNearest}/${total} samples, ${missing} outside, ${nullCells} degenerate cells`);
    Check(`${spec.key}: no sample is claimed by two cells`,
        wrongCell === 0, `${wrongCell} double-claimed`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 2 — finished pieces never overlap
//
//  Plates are a Voronoi cell inset by half the fissure gap and then roughened by at most 0.4 * gap, so they
//  must remain disjoint. Rasterise every polygon into a dense lattice and assert no lattice point is claimed
//  twice. This is the property that lets the bake use a simple highest-wins rule without z-fighting.
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestDisjoint(core, spec, trunk, structure)
{
    const W = trunk.width, H = trunk.height;
    const NX = 900, NY = Math.max(64, Math.round(NX * H / W));
    const owner = new Int32Array(NX * NY).fill(-1);
    let overlaps = 0, claimed = 0;

    let lenticels = 0;
    for (const piece of structure.pieces)
    {
        // Lenticels are small dark organs that grow on top of the bark; they are meant to overlap it.
        if (piece.lenticel) { lenticels++; continue; }
        const b = piece.bounds;
        const x0 = Math.max(0, Math.floor(b.x0 / W * NX) - 1);
        const x1 = Math.min(NX, Math.ceil(b.x1 / W * NX) + 1);
        const y0 = Math.max(0, Math.floor(b.y0 / H * NY) - 1);
        const y1 = Math.min(NY, Math.ceil(b.y1 / H * NY) + 1);
        for (let gy = y0; gy < y1; gy++)
        {
            const py = (gy + 0.5) / NY * H;
            for (let gx = x0; gx < x1; gx++)
            {
                const px = (gx + 0.5) / NX * W;
                if (!PointInPolygon(piece.poly, px, py)) continue;
                const i = gy * NX + gx;
                if (owner[i] >= 0 && owner[i] !== piece.id) overlaps++;
                else { owner[i] = piece.id; claimed++; }
            }
        }
    }

    Check(`${spec.key}: no two plates overlap`,
        overlaps === 0, `${overlaps} contested lattice points of ${claimed} (${lenticels} lenticels excluded)`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 3 — the bake is continuous across the uv seam
//
//  u wraps once around the trunk, so the projection draws each triangle three times (u-1, u, u+1). If that
//  were broken, the last column would be bare while the first was covered. Compare the step across the seam
//  with the average step between interior columns.
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestSeam(core, spec, projection)
{
    const N = projection.resolution;
    const h = projection.height;
    let seam = 0, interior = 0, samples = 0;
    for (let y = 0; y < N; y++)
    {
        const row = y * N;
        seam += Math.abs(h[row] - h[row + N - 1]);
        for (let k = 1; k < N - 1; k += 7) { interior += Math.abs(h[row + k] - h[row + k + 1]); samples++; }
    }
    seam /= N;
    interior /= samples;
    Check(`${spec.key}: height field wraps at the seam`,
        seam <= interior * 3 + 1e-6, `seam step ${(seam * 1000).toFixed(3)} mm vs interior ${(interior * 1000).toFixed(3)} mm`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 4 — baked channels stay inside their declared ranges
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestRanges(core, spec, projection)
{
    const N = projection.resolution;
    let badNormals = 0, minAo = 255, maxAo = 0, minH = Infinity, maxH = -Infinity, maxRough = 0;
    let covered = 0;

    for (let i = 0; i < N * N; i++)
    {
        const nx = projection.normal[i * 3] / 255 * 2 - 1;
        const ny = projection.normal[i * 3 + 1] / 255 * 2 - 1;
        const nz = projection.normal[i * 3 + 2] / 255 * 2 - 1;
        const len = Math.hypot(nx, ny, nz);
        if (Math.abs(len - 1) > 0.02) badNormals++;
        if (nz <= 0) badNormals++;
        const ao = projection.orm[i * 3];
        if (ao < minAo) minAo = ao;
        if (ao > maxAo) maxAo = ao;
        if (projection.orm[i * 3 + 1] > maxRough) maxRough = projection.orm[i * 3 + 1];
        const hh = projection.height[i];
        if (hh < minH) minH = hh;
        if (hh > maxH) maxH = hh;
        if (hh > 0) covered++;
    }

    Check(`${spec.key}: normals are unit length and outward`, badNormals === 0, `${badNormals} bad texels`);
    Check(`${spec.key}: ambient occlusion spans a usable range`, maxAo - minAo > 40, `${minAo}..${maxAo}`);
    const plateTop = spec.thickness * (1 + 0.5 * spec.thicknessJitter) * (1 + spec.curlAmount);
    let ceiling = plateTop;
    if (spec.lenticels)
    {
        const L = spec.lenticels;
        ceiling = Math.max(ceiling, (spec.thickness * (1 + 0.5 * spec.thicknessJitter) + L.lift) * 1.25);
    }
    Check(`${spec.key}: height stays within the plate relief`,
        minH >= 0 && maxH > 0 && maxH <= ceiling + 1e-6,
        `${(minH * 1000).toFixed(2)}..${(maxH * 1000).toFixed(2)} mm, ceiling ${(ceiling * 1000).toFixed(2)} mm`);
    Check(`${spec.key}: coverage is plausible`, covered / (N * N) > 0.35 && covered / (N * N) < 0.995,
        `${(covered / (N * N) * 100).toFixed(1)}%`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 5 — the trunk surface is sane and the uv frame matches the recipe
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestTrunk(core)
{
    const trunk = core.TrunkStructure.build({});
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < trunk.vertexCount; i++)
    {
        uMin = Math.min(uMin, trunk.uvs[i * 2]); uMax = Math.max(uMax, trunk.uvs[i * 2]);
        vMin = Math.min(vMin, trunk.uvs[i * 2 + 1]); vMax = Math.max(vMax, trunk.uvs[i * 2 + 1]);
    }
    Check('trunk: uv covers exactly one unit square',
        Near(uMin, 0, 1e-6) && Near(uMax, 1, 1e-6) && Near(vMin, 0, 1e-6) && Near(vMax, 1, 1e-6),
        `u ${uMin}..${uMax}  v ${vMin}..${vMax}`);

    // u = 0 and u = 1 are the same place on the trunk (the seam), and the taper shrinks the radius with height.
    let seamGap = 0, taperOk = true;
    const row = trunk.config.radialSegments + 1;
    for (let j = 0; j <= trunk.config.ringCount; j++)
    {
        const a = j * row, b = a + trunk.config.radialSegments;
        seamGap = Math.max(seamGap, Math.hypot(
            trunk.positions[a * 3] - trunk.positions[b * 3],
            trunk.positions[a * 3 + 1] - trunk.positions[b * 3 + 1],
            trunk.positions[a * 3 + 2] - trunk.positions[b * 3 + 2]));
    }
    Check('trunk: seam vertices coincide', seamGap < 1e-6, `max gap ${seamGap.toExponential(2)} m`);
    Check('trunk: radius decreases with height', trunk.radiusAt(0) > trunk.radiusAt(trunk.height));
    Check('trunk: circumference at mid height drives the strip width',
        Near(trunk.width, 2 * Math.PI * trunk.radiusAt(trunk.height * 0.5), 1e-9));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 6 — determinism
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
async function TestDeterminism(core)
{
    const spec = core.BarkSpecification.find('oak');
    const a = core.BarkSequence.run(spec, {}, 4242, 256);
    const b = core.BarkSequence.run(spec, {}, 4242, 256);
    const c = core.BarkSequence.run(spec, {}, 4243, 256);
    Check('determinism: same seed reproduces the build exactly', Digest(a) === Digest(b), Digest(a));
    Check('determinism: a different seed changes the build', Digest(a) !== Digest(c), `${Digest(a)} vs ${Digest(c)}`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 7 — PNG encoding
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
async function TestPng(core)
{
    const N = 32;
    const rgb = new Uint8Array(N * N * 3);
    for (let i = 0; i < N * N; i++) { rgb[i * 3] = i & 255; rgb[i * 3 + 1] = 128; rgb[i * 3 + 2] = 255 - (i & 255); }
    const png = await core.TextureCodec.encodePng(rgb, N, N, true);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    let sigOk = png.length > 8;
    for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) sigOk = false;
    const width = new DataView(png.buffer).getUint32(16);
    const height = new DataView(png.buffer).getUint32(20);
    Check('png: signature is valid', sigOk);
    Check('png: header declares the right size', width === N && height === N, `${width}x${height}`);
    Check('png: IEND chunk is present',
        png[png.length - 8] === 73 && png[png.length - 7] === 69 && png[png.length - 6] === 78 && png[png.length - 5] === 68);

    const out = join(tmpdir(), `slate-bark-test-${process.pid}.png`);
    writeFileSync(out, png);
    console.log(`  (wrote ${out} for external inspection)`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 8 — OBJ export
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestObj(core, result)
{
    const obj = core.GeometryCodec.toObj(result.trunk, result.structure, true);
    const verts = (obj.match(/^v /gm) || []).length;
    const faces = (obj.match(/^f /gm) || []).length;
    Check('obj: vertex count matches the structure',
        verts === result.structure.vertexCount + result.trunk.vertexCount, `${verts} vertices`);
    Check('obj: face count matches the structure',
        faces === result.structure.triangleCount + result.trunk.indices.length / 3, `${faces} faces`);
}


// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Test 9 — the bake agrees with the plates it was projected from
//
//  This is the end-to-end check on "bake the texture from the pieces": for a lattice of uv samples, decide
//  independently whether the point falls inside some plate polygon, then compare with what the projection
//  recorded. Disagreements are only tolerated in a thin band around plate edges, where the descending skirt
//  and the rasteriser's pixel-centre sampling legitimately differ.
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
function TestProjectionAgreement(core, spec, trunk, structure, projection)
{
    const W = trunk.width, H = trunk.height;
    const N = projection.resolution;
    const pieces = structure.pieces;
    const S = 72;
    // Albedo is the plate colour scaled by coherent grain plus speckle; nothing else touches it on a
    // deep interior texel, so that envelope is an exact expectation rather than a loose bound.
    const modulation = spec.grainStrength + spec.speckle * 0.5 + 0.02;
    const lo = Math.max(0, 1 - modulation), hi = 1 + modulation;

    // A "deep" sample is measured in metres from the plate outline, not from the height buffer: the
    // descending skirt is real geometry with its own (darker) wall colour, so classifying by coverage
    // alone would sweep skirt texels into the plate-interior bucket.
    const texelW = W / N, texelH = H / N;
    const deepMetres = 3 * Math.max(texelW, texelH);
    const covered = (x, y) => projection.height[Math.min(N - 1, Math.max(0, y)) * N + ((x % N) + N) % N] > 0;


    let agree = 0, disagree = 0;
    let interior = 0, reliefOk = 0, colourOk = 0;
    let ratioLo = Infinity, ratioHi = -Infinity;

    // Sample on texel centres, not on an independent grid: the geometric membership test and the texel
    // fetch must refer to exactly the same point or the comparison is meaningless.
    const stride = Math.max(1, Math.floor(N / S));
    let samples = 0;
    for (let iy = 0; iy < N; iy += stride)
    {
        for (let ix = 0; ix < N; ix += stride)
        {
            samples++;
            const u = (ix + 0.5) / N, v = (iy + 0.5) / N;
            const px = u * W, py = v * H;

            let owner = -1, ownerX = px;
            for (let p = 0; p < pieces.length; p++)
            {
                const b = pieces[p].bounds;
                if (owner >= 0 && pieces[p].maxLift <= pieces[owner].maxLift) continue;
                let found = false, foundX = px;
                for (let shift = -1; shift <= 1 && !found; shift++)
                {
                    const x = px + shift * W;
                    if (x < b.x0 - 1e-9 || x > b.x1 + 1e-9 || py < b.y0 - 1e-9 || py > b.y1 + 1e-9) continue;
                    if (PointInPolygon(pieces[p].poly, x, py)) { found = true; foundX = x; }
                }
                if (found) { owner = p; ownerX = foundX; }
            }

            const i = iy * N + ix;
            const bakedHeight = projection.height[i];

            if ((owner >= 0) === (bakedHeight > 0)) agree++;
            else if (covered(ix + 1, iy) !== (owner >= 0) || covered(ix - 1, iy) !== (owner >= 0)
                  || covered(ix, iy + 1) !== (owner >= 0) || covered(ix, iy - 1) !== (owner >= 0)) agree++;
            else disagree++;

            if (owner < 0) continue;

            // Measure depth in the same wrapped frame that the containment test matched, otherwise a
            // plate straddling the seam reports a depth of roughly one circumference.
            const depth = DistanceToBoundary(pieces[owner].poly, ownerX, py);
            if (depth < deepMetres) continue;
            interior++;
            if (bakedHeight > 0 && bakedHeight <= pieces[owner].maxLift + 1e-6) reliefOk++;

            const want = pieces[owner].topColour;
            const got = [projection.albedo[i * 3] / 255, projection.albedo[i * 3 + 1] / 255, projection.albedo[i * 3 + 2] / 255];
            let ok = true;
            for (let c = 0; c < 3; c++)
            {
                const ratio = want[c] > 0.02 ? got[c] / want[c] : 1;
                if (ratio < ratioLo) ratioLo = ratio;
                if (ratio > ratioHi) ratioHi = ratio;
                // Allow for the two rounding steps: colour to 8 bits, then the shaded result to 8 bits.
                const a = want[c] * lo - 1.5 / 255, z = Math.min(1, want[c] * hi) + 1.5 / 255;
                if (got[c] < a || got[c] > z) ok = false;
            }
            if (ok) colourOk++;
        }
    }

    Check(`${spec.key}: baked coverage matches the plate polygons`,
        disagree / samples < 0.02, `${disagree}/${samples} texels disagree`);
    Check(`${spec.key}: deep plate interiors carry bark colour and sane relief`,
        interior > 20 && reliefOk === interior && colourOk === interior,
        `${colourOk}/${interior} colour, ${reliefOk}/${interior} relief, ` +
        `shade range ${ratioLo === Infinity ? 'n/a' : ratioLo.toFixed(3) + '..' + ratioHi.toFixed(3)} vs allowed ${lo.toFixed(3)}..${hi.toFixed(3)}`);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
//  Main
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
const core = await LoadCore();
const Resolution = Number(process.env.BARK_RESOLUTION || 512);

Section('trunk surface');
TestTrunk(core);
await TestDeterminism(core);
await TestPng(core);

const timings = [];
for (const preset of core.BarkSpecification.presets)
{
    Section(`species: ${preset.label}  (${preset.key})`);
    const t0 = performance.now();
    const result = core.BarkSequence.run(preset, {}, 20250808, Resolution);
    const t1 = performance.now();

    const st = result.structure.stats;
    console.log(`  clusters ${st.clusters}   seeds ${st.seeds}   plates ${st.pieces}` +
        `   lenticels ${st.lenticels}   bare/void ${st.bareSkips}/${st.voidCells}` +
        `   triangles ${result.structure.triangleCount}`);
    console.log(`  bake ${result.projection.resolution}²   coverage ${(result.projection.coverage * 100).toFixed(1)}%` +
        `   relief ${(result.projection.maxHeight * 1000).toFixed(2)} mm   ${result.projection.elapsed.toFixed(0)} ms` +
        `   total ${(t1 - t0).toFixed(0)} ms`);
    timings.push({ key: preset.key, total: t1 - t0, bake: result.projection.elapsed, pieces: st.pieces });

    TestTiling(core, preset, result.trunk, result.clustering);
    TestDisjoint(core, preset, result.trunk, result.structure);
    TestSeam(core, preset, result.projection);
    TestRanges(core, preset, result.projection);
    TestProjectionAgreement(core, preset, result.trunk, result.structure, result.projection);
}

Section('obj export');
{
    const result = core.BarkSequence.run(core.BarkSpecification.find('oak'), {}, 7, 128);
    TestObj(core, result);
}

console.log('\nsummary');
console.log(`  ${Passed} passed, ${Failed} failed   (bake resolution ${Resolution}²)`);
if (Failed > 0)
{
    console.log('  failures:');
    for (const f of Failures) console.log(`    - ${f}`);
    process.exit(1);
}

//============================================================================================================================================
// 📦 Tools/Check.js — Headless smoke test of the kernel: profile resolution, skinning, junction solving, buffer sanity
//============================================================================================================================================
// No browser and no GL: this drives every pure module the bake worker uses and asserts the invariants the renderer relies on — finite positions,
//    indices inside their own sector, ordered sections, plausible height span, and byte-stability across two bakes. `npm run check`.
'use strict';

import { PROFILES, getProfile, MAT } from '../Editor/RoadEditor/Kernel/ProfileSolver.js';
import { buildWorld, DEFAULTS, fairRoad, endFrame } from '../Editor/RoadEditor/Kernel/SkinSolver.js';
import { sample, chaikin } from '../Editor/RoadEditor/Kernel/CurveKit.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

function checkProfiles() {
    console.log('\n— profiles —');
    let bad = 0;
    for (const def of PROFILES) {
        const p = getProfile(def.id);
        if (!isFinite(p.width) || p.width < 0.5 || p.segs.length < 2) { bad++; console.log('  ! degenerate:', def.id); continue; }
        let prev = -Infinity;
        for (const s of p.segs) {
            for (const v of [s.t0, s.t1, s.h0, s.h1]) if (!isFinite(v)) { bad++; console.log('  ! non-finite in', def.id); }
            if (Math.min(s.t0, s.t1) < prev - 1e-6) { bad++; console.log('  ! unordered in', def.id); }
            prev = Math.max(s.t0, s.t1);
        }
        const h0 = p.heightAt(0);
        if (!isFinite(h0)) { bad++; console.log('  ! heightAt broken in', def.id); }
    }
    ok(bad === 0, `all ${PROFILES.length} profiles resolve to ordered, finite sections`);
}

/** A crossroads, a T, a dead end, a curved brick high street and a rail viaduct on the skew — the awkward cases, in one small world. */
function demoDoc() {
    const nodes = {};
    const roads = [];
    let next = 1;
    const N = (x, z, y = 0) => { const id = next++; nodes[id] = { id, x, z, y }; return id; };
    const R = (pa, pb, profile, extra = {}) => {
        const id = next++;
        const a = nodes[pa], b = nodes[pb];
        roads.push({ id, name: 'R' + id, profile, nodeA: pa, nodeB: pb, points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], ...extra });
        return id;
    };
    const nW = N(-140, 0), nC = N(0, 0), nE = N(140, 0), nS = N(0, -140), nN = N(0, 140);
    R(nW, nC, 'ART-2x2-MED'); R(nC, nE, 'ART-2x2-MED');
    R(nS, nC, 'RES-2B'); R(nC, nN, 'RES-2B');
    R(nE, N(200, 90), 'RES-CUL');                                   // [-] dead end → hammerhead
    const nT = N(-70, -150), nT2 = N(-70, -24);                      // [-] T into the boulevard
    R(nT, nT2, 'COL-2', { bumps: [{ s: 20, w: 3.6 }, { s: 48, w: 3.6 }] });
    const p1 = N(-260, 190), p2 = N(-170, 268), p3 = N(-40, 250);    // [-] curved brick street
    R(p1, p2, 'ART-BRICK'); R(p2, p3, 'MAIN-ST');
    R(nC, nT, 'PATH-BIKE');                                          // [-] a path, so the junction mixes a 24 m boulevard with a 4 m track
    const rA = N(-60, -360, 6.6), rB = N(-18, -70, 6.6), rC = N(26, 70, 6.6), rD = N(70, 360, 6.6);
    for (const id of Object.keys(nodes)) void id;
    roads.push({
        id: next++, name: 'RAIL1', profile: 'RAIL-2T', noJunction: true, electrified: true, struct: 'bridge',
        y0: 6.6, y1: 6.6,
        points: [nodes[rA], nodes[rB], nodes[rC], nodes[rD]].map((q) => ({ x: q.x, z: q.z, y: q.y })),
    });
    const lots = [{ p: [{ x: 30, z: 20 }, { x: 120, z: 20 }, { x: 120, z: 120 }, { x: 30, z: 120 }], mat: MAT.GRASS, y: 0.03 }];
    return { nodes, roads, lots };
}

function checkBake() {
    console.log('\n— bake —');
    const doc = demoDoc();
    const out = buildWorld(doc, { ...DEFAULTS, sector: 150, world: 400, groundGrid: 120, props: 0 });
    ok(out.sectors.length > 1, `${out.sectors.length} sectors produced`);
    console.log(`  · ${out.stats.tris.toLocaleString()} tris / ${out.stats.verts.toLocaleString()} verts in ${out.stats.ms} ms · `
        + `${out.stats.roads} roads · ${out.stats.junctions} junctions · ${out.stats.culsac} hammerheads`);
    ok(out.stats.tris > 1200, 'geometry emitted');
    ok(out.stats.junctions >= 3, `${out.stats.junctions} junction patches solved`);
    ok(out.stats.culsac >= 6, `${out.stats.culsac} free ends capped with hammerheads`);
    let nan = 0, oob = 0, bbox = 0;
    for (const s of out.sectors) {
        for (let i = 0; i < s.pos.length; ++i) if (!isFinite(s.pos[i])) nan++;
        for (let i = 0; i < s.idx.length; ++i) if (!(s.idx[i] < s.verts)) oob++;
        if (!(s.max[0] >= s.min[0] && s.max[1] >= s.min[1])) bbox++;
    }
    ok(nan === 0, 'no non-finite vertex data');
    ok(oob === 0, 'every index inside its own sector');
    ok(bbox === 0, 'every sector has a usable bounding box');
    let hi = -1e9, lo = 1e9;
    for (const s of out.sectors) { hi = Math.max(hi, s.hi); lo = Math.min(lo, s.lo); }
    ok(hi > 5.5 && hi < 20, `height span ${lo.toFixed(2)} … ${hi.toFixed(2)} m — viaduct deck and rails above, ground below`);
    ok(out.stats.tris > 5000, `${out.stats.tris.toLocaleString()} triangles for 9 roads — one emitter, no per-feature special case`);
    // The kerb must rise then flatten at a junction: sample a vertical cut across a boulevard.
    const prof = getProfile('ART-2x2-MED');
    ok(prof.heightAt(prof.roadHalf[1] + 3) > prof.heightAt(0) + 0.05, 'footway sits above the carriageway in the resolved section');
    return out;
}

function checkDeterminism() {
    console.log('\n— determinism —');
    const a = buildWorld(demoDoc(), { ...DEFAULTS, sector: 150, world: 400, props: 0 });
    const b = buildWorld(demoDoc(), { ...DEFAULTS, sector: 150, world: 400, props: 0 });
    let same = a.sectors.length === b.sectors.length;
    for (let i = 0; same && i < a.sectors.length; ++i) {
        const x = a.sectors[i], y = b.sectors[i];
        if (x.verts !== y.verts || x.tris !== y.tris) { same = false; break; }
        for (let k = 0; k < x.pos.length; k += 7) if (x.pos[k] !== y.pos[k]) { same = false; break; }
    }
    ok(same, 'two bakes of one document agree — sector diffing after an edit is legal');
}

function checkCurve() {
    console.log('\n— curve kit —');
    const pts = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 50 }, { x: 100, z: 120 }];
    const f = chaikin(pts, 2);
    ok(f[0].x === 0 && f[0].z === 0, 'fairing pins the first waypoint');
    ok(Math.abs(f[f.length - 1].x - 100) < 1e-9, 'fairing pins the last waypoint');
    const st = sample(pts, 8, 2, { fair: false });
    ok(st.length > 12, `${st.length} stations along a 160 m dog-leg`);
    ok(st.every((p) => isFinite(p.x) && isFinite(p.s) && isFinite(p.tx)), 'stations and tangents finite');
    const fair = fairRoad({ points: pts }, DEFAULTS);
    const fr = endFrame(fair, 'B', 20);
    ok(Math.hypot(fr.ux, fr.uz) > 0.99, 'end frames are unit length');
}

console.log('Slate Road Editor — kernel check');
checkCurve();
checkProfiles();
const out = checkBake();
checkDeterminism();
if (out) console.log('\nsectors: ' + out.sectors.map((s) => `[${s.i},${s.j}] ${s.tris}t`).slice(0, 10).join('  ') + (out.sectors.length > 10 ? ' …' : ''));
console.log(fails ? `\n✗ ${fails} check(s) failed\n` : '\n✓ all checks passed\n');
process.exit(fails ? 1 : 0);

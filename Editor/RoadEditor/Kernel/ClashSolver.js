//============================================================================================================================================
// 📦 Editor/RoadEditor/Kernel/ClashSolver.js — Where an independent alignment meets the street grid: level crossings, gaps, bridges
//============================================================================================================================================
// A railway drawn across the city must change the streets it meets, and it must do it for hand-drawn alignments exactly as it does for
//    generated ones. So this runs as the first step of every bake: it finds each crossing, opens a gap in the track bed wide enough for the
//    carriageway at that skew angle, lays the riding rails and the painted legend into the road, and records the crossing so the prop pass can
//    hang gates, flashers and crossbucks off it. Grade-separated obstacles are left to the generator, which lifts whole nodes instead of patching
//    surfaces.
'use strict';

import { getProfile, MAT, MARK, SYM } from './ProfileSolver.js';
import { segIntersect, clamp } from './CurveKit.js';

/** @returns {Array} crossings appended to doc.crossings (also consumed by PropSolver). */
export function resolveClashes(doc, S = {}) {
    const roads = doc.roads;
    if (!roads || !roads.length) return [];
    const crossings = doc.crossings = doc.crossings || [];
    const known = new Set(crossings.map((c) => c.key));
    const rails = [], streets = [];
    for (const r of roads) {
        const p = getProfile(r.profile);
        if (p.water) { r._kind = 'water'; continue; }
        if (p.rail && !p.def.inRoad) { (r.grade === 'separated' ? rails : r.grade === 'none' ? [] : rails).push(r); r._kind = 'rail'; continue; }
        if (p.metro || p.cls === 'path') continue;
        streets.push(r);
    }
    for (const rail of rails) {
        if (!rail._clashReady) { rail.gaps = (rail.gaps || []).filter((g) => g.owner === rail.id); rail._clashReady = true; }
    }
    for (const rail of rails) {
        const rp = getProfile(rail.profile);
        const halfRail = Math.max(rp.roadHalf[0], rp.roadHalf[1], 4);
        for (const road of streets) {
            const pp = getProfile(road.profile);
            if (pp.water || pp.rail) continue;
            const A = road.points, B = rail.points;
            if (!A || !B) continue;
            if (!bbox(A).overlap(bbox(B))) continue;
            const roadHalf = Math.max(pp.roadHalf[0], pp.roadHalf[1]) + 0.8;
            for (let i = 1; i < A.length; ++i) {
                for (let j = 1; j < B.length; ++j) {
                    const hit = segIntersect(A[i - 1], A[i], B[j - 1], B[j]);
                    if (!hit) continue;
                    const segLen = Math.hypot(A[i].x - A[i - 1].x, A[i].z - A[i - 1].z) || 1;
                    const sRoad = (i - 1) / Math.max(1, A.length - 1) * polyApprox(A) + hit.t * segLen;
                    const sRail = railApprox(B, j, hit.u);
                    let dx1 = A[i].x - A[i - 1].x, dz1 = A[i].z - A[i - 1].z;
                    let dx2 = B[j].x - B[j - 1].x, dz2 = B[j].z - B[j - 1].z;
                    const l1 = Math.hypot(dx1, dz1) || 1, l2 = Math.hypot(dx2, dz2) || 1;
                    dx1 /= l1; dz1 /= l1; dx2 /= l2; dz2 /= l2;
                    const sinA = Math.abs(dx1 * dz2 - dz1 * dx2);
                    if (sinA < 0.25) continue;                              // [-] nearly parallel: not a crossing
                    const key = `${road.id}|${rail.id}|${Math.round(hit.x)}|${Math.round(hit.z)}`;
                    if (known.has(key)) continue;
                    known.add(key);
                    const skew = 1 / Math.max(0.3, sinA);
                    const halfStreet = (roadHalf + 1.2) * skew;
                    const halfRailSpan = (halfRail + 1.0) * skew;
                    // Open the track bed so the road surface runs through unbroken, and give the road the riding rails.
                    (road.crossings = road.crossings || []).push({ s: sRoad, t: lateral(road, hit, sRoad), half: halfRailSpan, angle: Math.atan2(dx2, -dz2), key, rail: rail.id, flash: rail.flash !== 0, gate: rail.gate !== 0 });
                    (rail.gaps = rail.gaps || []).push({ a: sRail - halfStreet, b: sRail + halfStreet, owner: rail.id });
                    const rec = { key, x: hit.x, z: hit.z, rail: rail.id, road: road.id, angle: Math.atan2(dx2, dz2), roadAngle: Math.atan2(dx1, dz1), halfStreet, halfRail: halfRailSpan, sinA, y: rail.y0 ?? 0 };
                    crossings.push(rec);
                    rec.id = crossings.length;
                }
            }
        }
    }
    return crossings;
}

function lateral(road, hit, sRoad) {
    // Signed lateral offset of the hit from the road axis at that station: derived from the two waypoints it lies between.
    const A = road.points;
    let i = 1;
    while (i < A.length - 1 && sRoad > lengthUpTo(A, i + 1)) ++i;
    const a = A[i - 1], b = A[i];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = dz / l, nz = -dx / l;
    return (hit.x - a.x) * nx + (hit.z - a.z) * nz;
}
function lengthUpTo(A, i) {
    let s = 0;
    for (let k = 1; k <= i && k < A.length; ++k) s += Math.hypot(A[k].x - A[k - 1].x, A[k].z - A[k - 1].z);
    return s;
}
function polyApprox(A) {
    let s = 0;
    for (let k = 1; k < A.length; ++k) s += Math.hypot(A[k].x - A[k - 1].x, A[k].z - A[k - 1].z);
    return s;
}
function railApprox(B, j, u) {
    let s = 0;
    for (let k = 1; k < j; ++k) s += Math.hypot(B[k].x - B[k - 1].x, B[k].z - B[k - 1].z);
    return s + u * Math.hypot(B[j].x - B[j - 1].x, B[j].z - B[j - 1].z);
}
function bbox(A) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of A) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    return { x0, x1, z0, z1, overlap(o) { return !(o.x1 < x0 - 30 || o.x0 > x1 + 30 || o.z1 < z0 - 30 || o.z0 > z1 + 30); } };
}

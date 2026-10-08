/* ════════════════════════════════════════════════════════════════════
   validate.js — design checks for the road network (pure, no DOM).
   Thresholds mirror the help text: radius <15 warn / <7 error,
   grade >8% warn / >12% error, plus crossings and data hygiene.
   ════════════════════════════════════════════════════════════════════ */
import {sampleRoad, segmentsTouch} from './spline.js';

export const LIMITS = {
  radiusWarn: 15, radiusErr: 7,
  gradeWarn: 0.08, gradeErr: 0.12,
  minPointGap: 0.5, dupGap: 0.05,
  endTouchGuard: 0.6,   // touches this close to both roads' control endpoints don't warn
  maxPairTests: 400000, // per road-pair segment-test budget
  maxIssues: 240
};

function samplesBBox(S) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of S) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  return {minX, maxX, minZ, maxZ};
}

const bboxesOverlap = (a, b) => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;

function nearControlEnd(pts, closed, x, z) {
  if (!pts.length || closed) return false;
  const a = pts[0], b = pts[pts.length - 1];
  return Math.hypot(a.x - x, a.z - z) <= LIMITS.endTouchGuard ||
    Math.hypot(b.x - x, b.z - z) <= LIMITS.endTouchGuard;
}

let issueSeq = 1;
const mk = (severity, code, roadId, roadName, s, x, z, y, message) => ({
  id: `i${issueSeq++}`, severity, code, roadId, roadName, s, x, z, y, message
});

function junctionPoints(project) {
  const pts = [];
  for (const j of project.junctions || []) {
    pts.push({x: j.x, z: j.z, roads: (j.links || []).map((l) => l.road)});
  }
  return pts;
}

const nearJunction = (jpts, roadA, roadB, x, z, tol = 2.0) => jpts.some(
  (j) => j.roads.includes(roadA) && j.roads.includes(roadB) &&
    Math.hypot(j.x - x, j.z - z) <= tol
);

function checkRoad(project, road, issues) {
  const name = road.name || road.id;
  const pts = road.points || [];
  if (pts.length < 2) {
    issues.push(mk('error', 'too-few-points', road.id, name, 0,
      pts[0]?.x ?? 0, pts[0]?.z ?? 0, pts[0]?.y ?? 0,
      `<b>${name}</b> needs at least 2 control points.`));
    return null;
  }
  // Duplicate / stacked control points.
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (d < LIMITS.dupGap) {
      issues.push(mk('error', 'duplicate-point', road.id, name, 0, pts[i].x, pts[i].z, pts[i].y,
        `<b>${name}</b> has stacked points (#${i}–#${i + 1}); the curve is pinched there.`));
    } else if (d < LIMITS.minPointGap) {
      issues.push(mk('warn', 'tight-spacing', road.id, name, 0, pts[i].x, pts[i].z, pts[i].y,
        `<b>${name}</b> points #${i}–#${i + 1} are ${d.toFixed(2)} m apart — under ${LIMITS.minPointGap} m.`));
    }
  }
  if ((road.lanes * road.laneWidth) <= 0) {
    issues.push(mk('error', 'no-width', road.id, name, 0, pts[0].x, pts[0].z, pts[0].y,
      `<b>${name}</b> has no carriageway width (lanes × width ≤ 0).`));
  }
  const smp = sampleRoad(pts, {closed: road.closed, step: 1.0});
  if (!smp.count) return null;

  // Tight curves — report the worst few local minima, spaced apart.
  const spots = [];
  const S = smp.samples;
  for (let i = 1; i < S.length - 1; i++) {
    const r = S[i].radius;
    if (!Number.isFinite(r) || r >= LIMITS.radiusWarn) continue;
    if (S[i - 1].radius <= r || S[i + 1].radius < r) continue; // not a local minimum
    spots.push(S[i]);
  }
  spots.sort((a, b) => a.radius - b.radius);
  const kept = [];
  for (const sp of spots) {
    if (kept.length >= 3) break;
    if (kept.every((k) => Math.abs(k.s - sp.s) > 12)) kept.push(sp);
  }
  for (const sp of kept) {
    const sev = sp.radius < LIMITS.radiusErr ? 'error' : 'warn';
    issues.push(mk(sev, 'tight-curve', road.id, name, sp.s, sp.x, sp.z, sp.y,
      `<b>${name}</b> curve radius <b>${sp.radius.toFixed(1)} m</b> at s=${sp.s.toFixed(0)} m${sev === 'error' ? ' — under the 7 m minimum' : ''}.`));
  }

  // Steep grades — worst few local maxima, spaced apart.
  const gspots = [];
  for (let i = 1; i < S.length - 1; i++) {
    const g = Math.abs(S[i].grade);
    if (g < LIMITS.gradeWarn) continue;
    if (Math.abs(S[i - 1].grade) >= g || Math.abs(S[i + 1].grade) > g) continue;
    gspots.push(S[i]);
  }
  gspots.sort((a, b) => Math.abs(b.grade) - Math.abs(a.grade));
  const gkept = [];
  for (const sp of gspots) {
    if (gkept.length >= 3) break;
    if (gkept.every((k) => Math.abs(k.s - sp.s) > 15)) gkept.push(sp);
  }
  for (const sp of gkept) {
    const g = Math.abs(sp.grade);
    const sev = g > LIMITS.gradeErr ? 'error' : 'warn';
    issues.push(mk(sev, 'steep-grade', road.id, name, sp.s, sp.x, sp.z, sp.y,
      `<b>${name}</b> grade <b>${(g * 100).toFixed(1)}%</b> at s=${sp.s.toFixed(0)} m${sev === 'error' ? ' — over the 12% maximum' : ''}.`));
  }

  // Self-intersection (non-adjacent spans, tolerant of node touches).
  const n = S.length, closed = !!road.closed;
  const spanEnd = closed ? n : n - 1;
  const stride = Math.max(1, Math.ceil((spanEnd * spanEnd) / 2 / LIMITS.maxPairTests));
  let selfFound = 0, tests = 0;
  for (let i = 0; i < spanEnd && selfFound < 2 && tests < LIMITS.maxPairTests; i += stride) {
    const a = S[i % n], b = S[(i + 1) % n];
    for (let k = i + 2; k < spanEnd && tests < LIMITS.maxPairTests; k += stride) {
      if (closed && i === 0 && k >= spanEnd - stride) continue;
      tests++;
      const hit = segmentsTouch(a, b, S[k % n], S[(k + 1) % n]);
      if (hit) {
        selfFound++;
        issues.push(mk('error', 'self-crossing', road.id, name, a.s, hit.x, hit.z, a.y,
          `<b>${name}</b> crosses itself near (${hit.x.toFixed(1)}, ${hit.z.toFixed(1)}).`));
        break;
      }
    }
  }
  return smp;
}

/** Full project validation. Returns issues sorted error → warn → info. */
export function validateProject(project) {
  const issues = [];
  const samples = new Map();
  for (const road of project.roads || []) {
    const smp = checkRoad(project, road, issues);
    if (smp) samples.set(road.id, smp);
    if (issues.length > LIMITS.maxIssues) break;
  }

  // Road↔road crossings not covered by a junction.
  const jpts = junctionPoints(project);
  const roads = project.roads || [];
  const boxes = new Map();
  for (const [id, smp] of samples) boxes.set(id, samplesBBox(smp.samples));
  for (let a = 0; a < roads.length; a++) {
    for (let b = a + 1; b < roads.length; b++) {
      const A = samples.get(roads[a].id), B = samples.get(roads[b].id);
      if (!A || !B) continue;
      if (!bboxesOverlap(boxes.get(roads[a].id), boxes.get(roads[b].id))) continue;
      const SA = A.samples, SB = B.samples;
      const endA = (A.closed ? SA.length : SA.length - 1);
      const endB = (B.closed ? SB.length : SB.length - 1);
      const stride = Math.max(1, Math.ceil(Math.sqrt((endA * endB) / LIMITS.maxPairTests)));
      let found = null, tests = 0;
      for (let i = 0; i < endA && !found && tests < LIMITS.maxPairTests; i += stride) {
        const p = SA[i % SA.length], q = SA[(i + 1) % SA.length];
        for (let k = 0; k < endB && !found && tests < LIMITS.maxPairTests; k += stride) {
          tests++;
          const hit = segmentsTouch(p, q, SB[k % SB.length], SB[(k + 1) % SB.length]);
          if (!hit) continue;
          // Touches at both roads' control endpoints are joints, not crossings.
          if (nearControlEnd(roads[a].points, A.closed, hit.x, hit.z) &&
              nearControlEnd(roads[b].points, B.closed, hit.x, hit.z)) continue;
          found = {hit, y: (p.y + q.y) / 2};
        }
      }
      if (found && !nearJunction(jpts, roads[a].id, roads[b].id, found.hit.x, found.hit.z)) {
        issues.push(mk('warn', 'unresolved-crossing', roads[a].id, roads[a].name || roads[a].id, 0,
          found.hit.x, found.hit.z, found.y,
          `<b>${roads[a].name}</b> crosses <b>${roads[b].name}</b> with no junction — weld the endpoints or add a bridge note.`));
      }
      if (issues.length > LIMITS.maxIssues) break;
    }
  }

  // Junction hygiene.
  for (const j of project.junctions || []) {
    const links = j.links || [];
    if (links.length < 2) {
      issues.push(mk('warn', 'dangling-junction', links[0]?.road || null, '—', 0, j.x, j.z, j.y,
        `Junction <b>${j.name || j.id}</b> links fewer than 2 road ends.`));
    }
    for (const l of links) {
      const road = (project.roads || []).find((r) => r.id === l.road);
      if (!road) {
        issues.push(mk('error', 'broken-link', null, '—', 0, j.x, j.z, j.y,
          `Junction <b>${j.name || j.id}</b> links a deleted road.`));
      }
    }
  }

  const rank = {error: 0, warn: 1, info: 2};
  issues.sort((p, q) => rank[p.severity] - rank[q.severity]);
  return issues.slice(0, LIMITS.maxIssues);
}

/** Small aggregate for the metrics strip. */
export function summarize(project, samples) {
  let length = 0, minRadius = Infinity, maxGrade = 0, points = 0;
  for (const road of project.roads || []) {
    const smp = samples.get(road.id);
    points += (road.points || []).length;
    if (!smp) continue;
    length += smp.length;
    if (Number.isFinite(smp.minRadius)) minRadius = Math.min(minRadius, smp.minRadius);
    maxGrade = Math.max(maxGrade, smp.maxGrade || 0);
  }
  return {length, minRadius, maxGrade, points, roads: (project.roads || []).length};
}

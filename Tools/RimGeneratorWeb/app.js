'use strict';

/*
 * Slate Rim Forge is intentionally dependency-free. The preview is a small
 * painter-style 3D renderer so the tool remains portable inside the project
 * checkout and can be opened from a simple static server.
 */

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const viewContext = viewport.getContext('2d');
const profileCanvas = $('profile-canvas');
const profileContext = profileCanvas.getContext('2d');
const stage = document.querySelector('.hero-stage');

const DEFAULTS = {
  style: 'Y_SINGLE',
  finish: 'BRUSHED_SILVER',
  diameter: 18,
  width: 9.5,
  dish: 30,
  bevel: 1.8,
  spokes: 5,
  spokeWidth: 30,
  spokeDepth: 40,
  lugs: 5,
  lugCircle: 66,
  nutRadius: 18,
  contrast: false,
};

const state = {
  ...DEFAULTS,
  wireframe: false,
  yaw: 0,
  pitch: 0.11,
  zoom: 1,
  profile: null,
  mesh: null,
  dirty: true,
};

const MATERIALS = {
  BRUSHED_SILVER: { color: [151, 166, 179], metallic: .94, roughness: .22, label: 'Brushed silver' },
  GUNMETAL: { color: [53, 64, 77], metallic: .95, roughness: .23, label: 'Gunmetal' },
  SATIN_BLACK: { color: [22, 27, 34], metallic: .88, roughness: .27, label: 'Satin black' },
  FORGED_BRONZE: { color: [141, 74, 38], metallic: .91, roughness: .24, label: 'Forged bronze' },
  CERAMIC_WHITE: { color: [208, 217, 221], metallic: .33, roughness: .19, label: 'Ceramic white' },
};

const Vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => Vec(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => Vec(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, s) => Vec(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => Vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => { const l = length(a) || 1; return mul(a, 1 / l); };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (degrees) => degrees * Math.PI / 180;

function defaultProfile() {
  return [
    { x: -.48, r: .78 },
    { x: .43, r: .78 },
    { x: .45, r: .81 },
    { x: .47, r: .93 },
    { x: .51, r: 1.07 },
    { x: .55, r: 1.03 },
    { x: .55, r: .92 },
    { x: .50, r: .84 },
    { x: -.08, r: .84 },
    { x: -.46, r: .87 },
  ];
}

function profileMeters() {
  const width = state.width * .0254;
  const radius = state.diameter * .0254 * .5;
  return state.profile.map((point) => ({ x: point.x * width, y: point.r * radius }));
}

function createBuilder() {
  return { vertices: [], triangles: [], faces: 0 };
}

function addVertex(builder, point) {
  builder.vertices.push(point);
  return builder.vertices.length - 1;
}

function addTriangle(builder, a, b, c, material) {
  builder.triangles.push({ a, b, c, material });
  builder.faces += 1;
}

function addFace(builder, indices, material) {
  for (let i = 1; i < indices.length - 1; i += 1) {
    addTriangle(builder, indices[0], indices[i], indices[i + 1], material);
  }
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function rectangle2D(start, end, width) {
  const direction = normalize(Vec(end.x - start.x, end.y - start.y));
  const normal = Vec(-direction.y, direction.x);
  const half = width * .5;
  return [
    Vec(start.x - normal.x * half, start.y - normal.y * half),
    Vec(end.x - normal.x * half, end.y - normal.y * half),
    Vec(end.x + normal.x * half, end.y + normal.y * half),
    Vec(start.x + normal.x * half, start.y + normal.y * half),
  ];
}

function discPolygon(center, radius, sides = 12) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = Math.PI * 2 * index / sides;
    return Vec(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
  });
}

function pointInside2D(polygon, point) {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index];
    const second = polygon[(index + 1) % polygon.length];
    if ((first.y > point.y) !== (second.y > point.y)) {
      const xAtY = (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x;
      if (point.x < xAtY) inside = !inside;
    }
  }
  return inside;
}

function segmentParameter(first, second, otherFirst, otherSecond) {
  const direction = Vec(second.x - first.x, second.y - first.y);
  const otherDirection = Vec(otherSecond.x - otherFirst.x, otherSecond.y - otherFirst.y);
  const denominator = cross2(direction, otherDirection);
  if (Math.abs(denominator) < 1e-9) return null;
  const offset = Vec(otherFirst.x - first.x, otherFirst.y - first.y);
  const t = cross2(offset, otherDirection) / denominator;
  const u = cross2(offset, direction) / denominator;
  if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) return clamp(t, 0, 1);
  return null;
}

function pointKey(point) {
  const x = Math.abs(point.x) < 1e-10 ? 0 : point.x;
  const y = Math.abs(point.y) < 1e-10 ? 0 : point.y;
  return `${x.toFixed(8)},${y.toFixed(8)}`;
}

function unionPolygons(polygons) {
  const candidates = [];
  polygons.forEach((polygon, polygonIndex) => {
    polygon.forEach((first, edgeIndex) => {
      const second = polygon[(edgeIndex + 1) % polygon.length];
      const splits = [0, 1];
      polygons.forEach((other) => {
        other.forEach((otherFirst, otherIndex) => {
          const otherSecond = other[(otherIndex + 1) % other.length];
          const parameter = segmentParameter(first, second, otherFirst, otherSecond);
          if (parameter !== null) splits.push(parameter);
        });
      });
      const sorted = [...new Set(splits.map((value) => Number(value.toFixed(12))))].sort((a, b) => a - b);
      for (let splitIndex = 0; splitIndex < sorted.length - 1; splitIndex += 1) {
        const startT = sorted[splitIndex];
        const endT = sorted[splitIndex + 1];
        const start = Vec(lerp(first.x, second.x, startT), lerp(first.y, second.y, startT));
        const end = Vec(lerp(first.x, second.x, endT), lerp(first.y, second.y, endT));
        const midpoint = Vec((start.x + end.x) * .5, (start.y + end.y) * .5);
        const hidden = polygons.some((other, otherIndex) => otherIndex !== polygonIndex && pointInside2D(other, midpoint));
        if (!hidden && length(Vec(end.x - start.x, end.y - start.y)) > 1e-7) candidates.push([start, end]);
      }
    });
  });

  const edges = [];
  const seen = new Set();
  candidates.forEach(([first, second]) => {
    const key = `${pointKey(first)}>${pointKey(second)}`;
    if (!seen.has(key)) { seen.add(key); edges.push([first, second]); }
  });

  const outgoing = new Map();
  edges.forEach((edge, index) => {
    const key = pointKey(edge[0]);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(index);
  });

  const loops = [];
  const used = new Set();
  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (used.has(startIndex)) continue;
    let edgeIndex = startIndex;
    const loop = [];
    const startKey = pointKey(edges[edgeIndex][0]);
    for (let guard = 0; guard <= edges.length; guard += 1) {
      if (used.has(edgeIndex)) break;
      used.add(edgeIndex);
      const [first, second] = edges[edgeIndex];
      if (!loop.length) loop.push(first);
      loop.push(second);
      if (pointKey(second) === startKey) break;
      const choices = (outgoing.get(pointKey(second)) || []).filter((candidate) => !used.has(candidate));
      if (!choices.length) break;
      if (choices.length === 1) {
        edgeIndex = choices[0];
      } else {
        const incoming = Vec(second.x - first.x, second.y - first.y);
        edgeIndex = choices.reduce((best, candidate) => {
          const bestDirection = Vec(edges[best][1].x - edges[best][0].x, edges[best][1].y - edges[best][0].y);
          const candidateDirection = Vec(edges[candidate][1].x - edges[candidate][0].x, edges[candidate][1].y - edges[candidate][0].y);
          const bestTurn = Math.abs(Math.atan2(cross2(incoming, bestDirection), incoming.x * bestDirection.x + incoming.y * bestDirection.y));
          const candidateTurn = Math.abs(Math.atan2(cross2(incoming, candidateDirection), incoming.x * candidateDirection.x + incoming.y * candidateDirection.y));
          return candidateTurn < bestTurn ? candidate : best;
        }, choices[0]);
      }
    }
    if (loop.length >= 4 && pointKey(loop[0]) === pointKey(loop[loop.length - 1])) {
      loop.pop();
      loops.push(loop);
    }
  }
  if (!loops.length) throw new Error('Unable to close Y-spoke silhouette');
  return loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
}

function polygonArea(polygon) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) * .5;
}

function triangulatePolygon(polygon) {
  const points = polygon.map((point) => Vec(point.x, point.y));
  const indexList = points.map((_, index) => index);
  if (polygonArea(points) < 0) indexList.reverse();
  const triangles = [];
  let guard = 0;
  while (indexList.length > 3 && guard < 1000) {
    guard += 1;
    let earFound = false;
    for (let index = 0; index < indexList.length; index += 1) {
      const previous = indexList[(index - 1 + indexList.length) % indexList.length];
      const current = indexList[index];
      const next = indexList[(index + 1) % indexList.length];
      const a = points[previous];
      const b = points[current];
      const c = points[next];
      if (cross2(Vec(b.x - a.x, b.y - a.y), Vec(c.x - b.x, c.y - b.y)) <= 1e-9) continue;
      const containsPoint = indexList.some((candidate) => {
        if (candidate === previous || candidate === current || candidate === next) return false;
        return pointInTriangle(points[candidate], a, b, c);
      });
      if (containsPoint) continue;
      triangles.push([previous, current, next]);
      indexList.splice(index, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
  }
  if (indexList.length === 3) triangles.push([indexList[0], indexList[1], indexList[2]]);
  return triangles;
}

function pointInTriangle(point, a, b, c) {
  const ab = cross2(Vec(b.x - a.x, b.y - a.y), Vec(point.x - a.x, point.y - a.y));
  const bc = cross2(Vec(c.x - b.x, c.y - b.y), Vec(point.x - b.x, point.y - b.y));
  const ca = cross2(Vec(a.x - c.x, a.y - c.y), Vec(point.x - c.x, point.y - c.y));
  return ab >= -1e-8 && bc >= -1e-8 && ca >= -1e-8;
}

function appendLathe(builder, profile, segments, material) {
  const rows = profile.map((point) => Array.from({ length: segments }, (_, segment) => {
    const angle = Math.PI * 2 * segment / segments;
    return addVertex(builder, Vec(point.x, point.y * Math.cos(angle), point.y * Math.sin(angle)));
  }));
  for (let row = 0; row < rows.length; row += 1) {
    const nextRow = (row + 1) % rows.length;
    for (let segment = 0; segment < segments; segment += 1) {
      const nextSegment = (segment + 1) % segments;
      addFace(builder, [rows[row][segment], rows[nextRow][segment], rows[nextRow][nextSegment], rows[row][nextSegment]], material);
    }
  }
}

function appendAnnulus(builder, backX, frontX, innerRadius, outerRadius, segments, material) {
  const backInner = [], backOuter = [], frontInner = [], frontOuter = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = Math.PI * 2 * segment / segments;
    const y = Math.cos(angle), z = Math.sin(angle);
    backInner.push(addVertex(builder, Vec(backX, innerRadius * y, innerRadius * z)));
    backOuter.push(addVertex(builder, Vec(backX, outerRadius * y, outerRadius * z)));
    frontInner.push(addVertex(builder, Vec(frontX, innerRadius * y, innerRadius * z)));
    frontOuter.push(addVertex(builder, Vec(frontX, outerRadius * y, outerRadius * z)));
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    addFace(builder, [backOuter[segment], frontOuter[segment], frontOuter[next], backOuter[next]], material);
    addFace(builder, [backInner[next], frontInner[next], frontInner[segment], backInner[segment]], material);
    addFace(builder, [frontOuter[segment], frontInner[segment], frontInner[next], frontOuter[next]], material);
    addFace(builder, [backOuter[next], backInner[next], backInner[segment], backOuter[segment]], material);
  }
}

function appendCylinderX(builder, backX, frontX, center, radius, segments, material) {
  const back = [], front = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = Math.PI * 2 * segment / segments;
    const y = center.y + radius * Math.cos(angle);
    const z = center.z + radius * Math.sin(angle);
    back.push(addVertex(builder, Vec(backX, y, z)));
    front.push(addVertex(builder, Vec(frontX, y, z)));
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    addFace(builder, [back[segment], back[next], front[next], front[segment]], material);
  }
  addFace(builder, [...back].reverse(), material);
  addFace(builder, front, material);
}

function appendRingStack(builder, rings, center, segments, material) {
  const rows = rings.map(([x, radius]) => Array.from({ length: segments }, (_, segment) => {
    const angle = Math.PI * 2 * segment / segments;
    return addVertex(builder, Vec(x, center.y + radius * Math.cos(angle), center.z + radius * Math.sin(angle)));
  }));
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      addFace(builder, [rows[row][segment], rows[row + 1][segment], rows[row + 1][next], rows[row][next]], material);
    }
  }
  addFace(builder, [...rows[0]].reverse(), material);
  addFace(builder, rows[rows.length - 1], material);
}

function yPolygon(style, outerRadius, hubRadius, spokeWidth, lipClearance) {
  const spreadDegrees = { Y_SINGLE: 31, Y_COMPACT: 24, Y_AGGRESSIVE: 38 }[style];
  const startRatio = { Y_SINGLE: .43, Y_COMPACT: .50, Y_AGGRESSIVE: .37 }[style];
  const widthRatio = { Y_SINGLE: 1, Y_COMPACT: .84, Y_AGGRESSIVE: 1.10 }[style];
  const spread = rad(spreadDegrees);
  const branchStart = hubRadius + (outerRadius - hubRadius) * startRatio;
  const tipRadius = outerRadius - lipClearance;
  const branchLength = Math.max(.03, (tipRadius - branchStart) / Math.max(.25, Math.cos(spread)));
  const rootWidth = spokeWidth * widthRatio;
  const branchWidth = rootWidth * (style === 'Y_AGGRESSIVE' ? .82 : .90);
  const p0 = Vec(hubRadius - .012, 0);
  const junction = Vec(branchStart, 0);
  const leftDirection = Vec(Math.cos(spread), Math.sin(spread));
  const rightDirection = Vec(Math.cos(spread), -Math.sin(spread));
  const leftTip = Vec(junction.x + leftDirection.x * branchLength, junction.y + leftDirection.y * branchLength);
  const rightTip = Vec(junction.x + rightDirection.x * branchLength, junction.y + rightDirection.y * branchLength);
  return unionPolygons([
    rectangle2D(p0, junction, rootWidth),
    rectangle2D(Vec(junction.x - leftDirection.x * .012, junction.y - leftDirection.y * .012), leftTip, branchWidth),
    rectangle2D(Vec(junction.x - rightDirection.x * .012, junction.y - rightDirection.y * .012), rightTip, branchWidth),
    discPolygon(junction, Math.max(rootWidth, branchWidth) * .78),
  ]);
}

function appendYPrism(builder, polygon, angle, backX, frontX, material) {
  const radial = Vec(Math.cos(angle), Math.sin(angle));
  const tangent = Vec(-Math.sin(angle), Math.cos(angle));
  const to3D = (x, point) => addVertex(builder, Vec(x, radial.x * point.x + tangent.x * point.y, radial.y * point.x + tangent.y * point.y));
  const front = polygon.map((point) => to3D(frontX, point));
  const back = polygon.map((point) => to3D(backX, point));
  triangulatePolygon(polygon).forEach(([a, b, c]) => {
    addTriangle(builder, front[a], front[b], front[c], material);
    addTriangle(builder, back[c], back[b], back[a], material);
  });
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    addFace(builder, [front[index], back[index], back[next], front[next]], material);
  }
}

function buildMesh() {
  const builder = createBuilder();
  const outerRadius = state.diameter * .0254 * .5;
  const width = state.width * .0254;
  const halfWidth = width * .5;
  const hubRadius = Math.min(.084, outerRadius * .58);
  const boreRadius = Math.min(.036, hubRadius * .76);
  const capRadius = Math.min(.052, hubRadius * .92);
  const frontX = halfWidth + state.dish / 1000;
  const profile = profileMeters();
  const seg = Number(state.diameter < 15 ? 72 : 112);

  // Material channels: 0 finish, 1 barrel, 2 machined, 3 titanium.
  appendLathe(builder, profile, seg, 0);
  appendAnnulus(builder, -halfWidth * .35, frontX + .015, boreRadius, hubRadius, 56, 0);

  const silhouette = yPolygon(state.style, outerRadius - .010, hubRadius, state.spokeWidth / 1000, .022);
  for (let index = 0; index < state.spokes; index += 1) {
    appendYPrism(builder, silhouette, Math.PI * 2 * index / state.spokes, frontX - state.spokeDepth / 1000, frontX, state.contrast ? 2 : 0);
  }

  const barrelInner = Math.max(.010, outerRadius - .050 - .004);
  const barrelOuter = Math.max(barrelInner + .004, outerRadius - .050 + .010);
  appendAnnulus(builder, -halfWidth + .015, -halfWidth + .035, barrelInner, barrelOuter, 72, 1);

  const lugFront = frontX + .020;
  for (let index = 0; index < state.lugs; index += 1) {
    const angle = Math.PI * 2 * index / state.lugs;
    const center = Vec(0, (state.lugCircle / 1000) * Math.cos(angle), (state.lugCircle / 1000) * Math.sin(angle));
    appendCylinderX(builder, lugFront - .115, lugFront + .018, center, .009, 12, 3);
    appendCylinderX(builder, lugFront + .010, lugFront + .026, center, (state.nutRadius / 1000) * 1.2, 16, 3);
    appendRingStack(builder, [
      [lugFront + .022, state.nutRadius / 1000 * .78],
      [lugFront + .029, state.nutRadius / 1000],
      [lugFront + .064, state.nutRadius / 1000],
      [lugFront + .071, state.nutRadius / 1000 * .78],
    ], center, 6, 3);
  }
  appendCylinderX(builder, lugFront - .006, lugFront + .032, Vec(0, 0, 0), capRadius, 40, 0);
  state.mesh = { ...builder, outerRadius, hubRadius, profile };
  state.dirty = true;
  updateReadout();
}

function colorString(rgb, alpha = 1) {
  return `rgba(${Math.round(clamp(rgb[0], 0, 255))},${Math.round(clamp(rgb[1], 0, 255))},${Math.round(clamp(rgb[2], 0, 255))},${alpha})`;
}

function materialFor(index) {
  if (index === 1) return { color: [18, 23, 30], metallic: .74, roughness: .31 };
  if (index === 2) return { color: [205, 218, 224], metallic: .98, roughness: .15 };
  if (index === 3) return { color: [121, 139, 157], metallic: .96, roughness: .18 };
  return MATERIALS[state.finish];
}

function cameraBasis() {
  const radius = state.mesh.outerRadius * (3.25 / state.zoom);
  const position = Vec(
    Math.cos(state.pitch) * Math.cos(state.yaw) * radius,
    Math.cos(state.pitch) * Math.sin(state.yaw) * radius,
    Math.sin(state.pitch) * radius,
  );
  const forward = normalize(mul(position, -1));
  const right = normalize(cross(forward, Vec(0, 0, 1)));
  const up = normalize(cross(right, forward));
  return { position, forward, right, up };
}

function project(point, basis, width, height) {
  const relative = point;
  const depth = dot(relative, basis.forward);
  const focal = Math.min(width, height) * .90;
  if (depth <= .01) return null;
  return {
    x: width * .5 + dot(relative, basis.right) * focal / depth,
    y: height * .5 - dot(relative, basis.up) * focal / depth,
    depth,
  };
}

function renderViewport() {
  if (!state.mesh) return;
  const rect = viewport.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (viewport.width !== width || viewport.height !== height) { viewport.width = width; viewport.height = height; }
  viewContext.setTransform(1, 0, 0, 1, 0, 0);
  viewContext.clearRect(0, 0, width, height);

  const background = viewContext.createRadialGradient(width * .52, height * .44, 5, width * .52, height * .48, Math.max(width, height) * .72);
  background.addColorStop(0, '#202b3a');
  background.addColorStop(.35, '#151e2b');
  background.addColorStop(1, '#0b1017');
  viewContext.fillStyle = background;
  viewContext.fillRect(0, 0, width, height);

  const basis = cameraBasis();
  const projected = state.mesh.vertices.map((vertex) => project(vertex, basis, width, height));
  const drawList = [];
  state.mesh.triangles.forEach((triangle) => {
    const a = projected[triangle.a], b = projected[triangle.b], c = projected[triangle.c];
    if (!a || !b || !c) return;
    drawList.push({ triangle, a, b, c, depth: (a.depth + b.depth + c.depth) / 3 });
  });
  drawList.sort((a, b) => a.depth - b.depth);

  const light = normalize(Vec(.42, -.60, 1.05));
  const viewDirection = normalize(basis.position);
  drawList.forEach(({ triangle, a, b, c }) => {
    const worldA = state.mesh.vertices[triangle.a];
    const worldB = state.mesh.vertices[triangle.b];
    const worldC = state.mesh.vertices[triangle.c];
    let normal = normalize(cross(sub(worldB, worldA), sub(worldC, worldA)));
    if (dot(normal, viewDirection) < 0) normal = mul(normal, -1);
    const diffuse = Math.max(0, dot(normal, light));
    const material = materialFor(triangle.material);
    const halfVector = normalize(add(light, viewDirection));
    const specular = Math.pow(Math.max(0, dot(normal, halfVector)), 27) * (.12 + material.metallic * .40);
    const brightness = .25 + diffuse * .70;
    const color = material.color.map((channel) => channel * brightness + 255 * specular);
    viewContext.beginPath();
    viewContext.moveTo(a.x, a.y); viewContext.lineTo(b.x, b.y); viewContext.lineTo(c.x, c.y); viewContext.closePath();
    viewContext.fillStyle = colorString(color);
    viewContext.fill();
    if (state.wireframe) { viewContext.strokeStyle = 'rgba(214,255,88,.22)'; viewContext.lineWidth = .55 * dpr; viewContext.stroke(); }
  });

  // A subtle studio reflection bar helps the metallic surface read without textures.
  viewContext.save();
  viewContext.globalCompositeOperation = 'screen';
  const reflection = viewContext.createLinearGradient(width * .17, height * .20, width * .78, height * .76);
  reflection.addColorStop(0, 'rgba(255,255,255,0)');
  reflection.addColorStop(.46, 'rgba(255,255,255,.035)');
  reflection.addColorStop(.52, 'rgba(214,255,88,.025)');
  reflection.addColorStop(.60, 'rgba(255,255,255,0)');
  viewContext.fillStyle = reflection;
  viewContext.fillRect(0, 0, width, height);
  viewContext.restore();
}

function profileCanvasSize() {
  const rect = profileCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (profileCanvas.width !== width || profileCanvas.height !== height) { profileCanvas.width = width; profileCanvas.height = height; }
  return { width, height };
}

function profilePointToCanvas(point, width, height) {
  const left = 14, right = width - 12, top = 11, bottom = height - 18;
  return { x: left + (point.x + .55) / 1.14 * (right - left), y: bottom - (point.r - .70) / .43 * (bottom - top) };
}

function canvasToProfilePoint(x, y, width, height) {
  const left = 14, right = width - 12, top = 11, bottom = height - 18;
  return { x: clamp((x - left) / (right - left) * 1.14 - .55, -.55, .59), r: clamp((bottom - y) / (bottom - top) * .43 + .70, .70, 1.13) };
}

function renderProfile() {
  const { width, height } = profileCanvasSize();
  profileContext.setTransform(1, 0, 0, 1, 0, 0);
  profileContext.clearRect(0, 0, width, height);
  profileContext.fillStyle = '#111923'; profileContext.fillRect(0, 0, width, height);
  profileContext.strokeStyle = 'rgba(255,255,255,.05)'; profileContext.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) { const x = 14 + i * (width - 26) / 5; profileContext.beginPath(); profileContext.moveTo(x, 8); profileContext.lineTo(x, height - 17); profileContext.stroke(); }
  for (let i = 1; i < 3; i += 1) { const y = 8 + i * (height - 25) / 3; profileContext.beginPath(); profileContext.moveTo(9, y); profileContext.lineTo(width - 9, y); profileContext.stroke(); }

  const points = state.profile.map((point) => profilePointToCanvas(point, width, height));
  profileContext.beginPath();
  points.forEach((point, index) => index ? profileContext.lineTo(point.x, point.y) : profileContext.moveTo(point.x, point.y));
  profileContext.closePath();
  profileContext.fillStyle = 'rgba(214,255,88,.08)'; profileContext.fill();
  profileContext.strokeStyle = 'rgba(214,255,88,.78)'; profileContext.lineWidth = 1.4; profileContext.stroke();
  points.forEach((point, index) => {
    profileContext.beginPath(); profileContext.arc(point.x, point.y, index === 0 ? 4 : 3.2, 0, Math.PI * 2);
    profileContext.fillStyle = index === 0 ? '#fff' : '#d6ff58'; profileContext.fill();
    profileContext.strokeStyle = '#111923'; profileContext.lineWidth = 1; profileContext.stroke();
  });
}

function formatCount(number) { return number >= 1000 ? `${(number / 1000).toFixed(1)}k` : String(number); }
function updateReadout() {
  if (!state.mesh) return;
  $('poly-stat').textContent = formatCount(state.mesh.faces);
  $('hardware-readout').textContent = `${state.lugs} × hex nut + bolt`;
}

function outputFor(id, value) { $(id).textContent = value; }
function syncControls() {
  $('rim-style').value = state.style; $('finish').value = state.finish;
  $('diameter').value = state.diameter; outputFor('diameter-out', `${Number(state.diameter).toFixed(1)} in`);
  $('width').value = state.width; outputFor('width-out', `${Number(state.width).toFixed(2)} in`);
  $('dish').value = state.dish; outputFor('dish-out', `${state.dish} mm`);
  $('bevel').value = state.bevel; outputFor('bevel-out', `${Number(state.bevel).toFixed(1)} mm`);
  $('spokes').value = state.spokes; outputFor('spokes-out', state.spokes);
  $('spoke-width').value = state.spokeWidth; outputFor('spoke-width-out', `${state.spokeWidth} mm`);
  $('spoke-depth').value = state.spokeDepth; outputFor('spoke-depth-out', `${state.spokeDepth} mm`);
  $('lugs').value = state.lugs; outputFor('lugs-out', state.lugs);
  $('lug-circle').value = state.lugCircle; outputFor('lug-circle-out', `${state.lugCircle} mm`);
  $('nut-radius').value = state.nutRadius; outputFor('nut-radius-out', `${state.nutRadius} mm`);
  $('contrast').checked = state.contrast;
}

function syncFromControls() {
  state.style = $('rim-style').value; state.finish = $('finish').value;
  state.diameter = Number($('diameter').value); outputFor('diameter-out', `${state.diameter.toFixed(1)} in`);
  state.width = Number($('width').value); outputFor('width-out', `${state.width.toFixed(2)} in`);
  state.dish = Number($('dish').value); outputFor('dish-out', `${state.dish} mm`);
  state.bevel = Number($('bevel').value); outputFor('bevel-out', `${state.bevel.toFixed(1)} mm`);
  state.spokes = Number($('spokes').value); outputFor('spokes-out', state.spokes);
  state.spokeWidth = Number($('spoke-width').value); outputFor('spoke-width-out', `${state.spokeWidth} mm`);
  state.spokeDepth = Number($('spoke-depth').value); outputFor('spoke-depth-out', `${state.spokeDepth} mm`);
  state.lugs = Number($('lugs').value); outputFor('lugs-out', state.lugs);
  state.lugCircle = Number($('lug-circle').value); outputFor('lug-circle-out', `${state.lugCircle} mm`);
  state.nutRadius = Number($('nut-radius').value); outputFor('nut-radius-out', `${state.nutRadius} mm`);
  state.contrast = $('contrast').checked;
  buildMesh();
}

function resetBuild() {
  Object.assign(state, DEFAULTS);
  state.profile = defaultProfile(); state.yaw = 0; state.pitch = .11; state.zoom = 1;
  syncControls(); buildMesh(); renderProfile();
}

function downloadSpec() {
  const payload = {
    generator: 'Slate Rim Forge', version: '1.0', asset: 'Rim_OnePiece_Y_Assembly',
    noTyre: true, units: 'meters', axis: '+X wheel axle',
    parameters: { style: state.style, finish: state.finish, diameterIn: state.diameter, widthIn: state.width, dishMm: state.dish, bevelMm: state.bevel, continuousYSpokes: state.spokes, spokeWidthMm: state.spokeWidth, spokeDepthMm: state.spokeDepth, lugs: state.lugs, boltCircleMm: state.lugCircle, nutRadiusMm: state.nutRadius, machinedSpokeContrast: state.contrast },
    blankCrossSection: state.profile,
    topology: 'One closed Y silhouette per spoke; no V + bar construction.',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'rim_one_piece_y_spec.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

let draggedPoint = -1;
function profilePointerPosition(event) {
  const rect = profileCanvas.getBoundingClientRect();
  const scaleX = profileCanvas.width / rect.width, scaleY = profileCanvas.height / rect.height;
  return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
}
profileCanvas.addEventListener('pointerdown', (event) => {
  const { x, y } = profilePointerPosition(event); let nearest = -1; let nearestDistance = 16;
  state.profile.forEach((point, index) => { const screen = profilePointToCanvas(point, profileCanvas.width, profileCanvas.height); const distance = Math.hypot(screen.x - x, screen.y - y); if (distance < nearestDistance) { nearest = index; nearestDistance = distance; } });
  if (nearest >= 0) { draggedPoint = nearest; profileCanvas.setPointerCapture(event.pointerId); }
});
profileCanvas.addEventListener('pointermove', (event) => {
  if (draggedPoint < 0) return;
  const { x, y } = profilePointerPosition(event); const point = canvasToProfilePoint(x, y, profileCanvas.width, profileCanvas.height);
  state.profile[draggedPoint] = point; renderProfile(); buildMesh();
});
profileCanvas.addEventListener('pointerup', () => { draggedPoint = -1; });
profileCanvas.addEventListener('pointercancel', () => { draggedPoint = -1; });

let orbiting = false; let lastPointer = { x: 0, y: 0 };
viewport.addEventListener('pointerdown', (event) => { orbiting = true; lastPointer = { x: event.clientX, y: event.clientY }; viewport.setPointerCapture(event.pointerId); stage.classList.add('dragging'); });
viewport.addEventListener('pointermove', (event) => { if (!orbiting) return; state.yaw += (event.clientX - lastPointer.x) * .008; state.pitch = clamp(state.pitch + (event.clientY - lastPointer.y) * .006, -.75, .75); lastPointer = { x: event.clientX, y: event.clientY }; state.dirty = true; });
viewport.addEventListener('pointerup', () => { orbiting = false; stage.classList.remove('dragging'); });
viewport.addEventListener('pointercancel', () => { orbiting = false; stage.classList.remove('dragging'); });
viewport.addEventListener('wheel', (event) => { event.preventDefault(); state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * .001), .65, 1.65); state.dirty = true; }, { passive: false });

['diameter', 'width', 'dish', 'bevel', 'spokes', 'spoke-width', 'spoke-depth', 'lugs', 'lug-circle', 'nut-radius', 'contrast'].forEach((id) => $(id).addEventListener('input', syncFromControls));
$('rim-style').addEventListener('change', syncFromControls); $('finish').addEventListener('change', syncFromControls);
$('reset').addEventListener('click', resetBuild); $('profile-reset').addEventListener('click', () => { state.profile = defaultProfile(); renderProfile(); buildMesh(); });
$('download').addEventListener('click', downloadSpec);
$('reset-camera').addEventListener('click', () => { state.yaw = 0; state.pitch = .11; state.zoom = 1; state.dirty = true; });
$('wireframe').addEventListener('click', (event) => { state.wireframe = !state.wireframe; event.currentTarget.classList.toggle('active', state.wireframe); state.dirty = true; });
const modal = $('help-modal'); const openHelp = () => { modal.hidden = false; }; const closeHelp = () => { modal.hidden = true; };
$('help').addEventListener('click', openHelp); $('close-help').addEventListener('click', closeHelp); $('close-help-2').addEventListener('click', closeHelp); modal.addEventListener('click', (event) => { if (event.target === modal) closeHelp(); });

window.addEventListener('resize', () => { state.dirty = true; renderProfile(); });

function frame() {
  if (state.dirty) { renderViewport(); state.dirty = false; }
  requestAnimationFrame(frame);
}

state.profile = defaultProfile();
syncControls();
buildMesh();
renderProfile();
frame();

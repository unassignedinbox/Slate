// Headless smoke test for the geometry pipeline (no WebGL needed).
// Stubs just enough DOM for canvas-based texture generation.

function makeCtxStub() {
  const gradient = { addColorStop() {} };
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText() {},
    strokeText() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    drawImage() {},
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
    },
    putImageData() {},
    measureText() { return { width: 10 }; },
  };
}

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected createElement ' + tag);
    return {
      width: 0,
      height: 0,
      getContext() { return makeCtxStub(); },
      toDataURL() { return 'data:,'; },
      style: {},
    };
  },
  createElementNS() { return this.createElement('canvas'); },
};

const { RoadDocument } = await import('../src/model.js');
const { generateCity } = await import('../src/citygen.js');
const { buildSegment, buildJunction, samplePolyline, polylineSampleLength } = await import('../src/roadbuilder.js');
const { buildRail, buildSubway } = await import('../src/rail.js');
const { collectProp, finishPropBuckets, propPieces, PROP_KINDS } = await import('../src/props.js');
const { PROFILES, layoutBands, profileWidth } = await import('../src/profiles.js');

const doc = new RoadDocument();
generateCity(doc, { seed: 7, blocks: 6 });

let meshes = 0;
let triangles = 0;
function countGroup(g, label) {
  let m = 0;
  let tris = 0;
  g.traverse((o) => {
    if (o.isMesh) {
      m++;
      const idx = o.geometry.index;
      tris += idx ? idx.count / 3 : o.geometry.attributes.position.count / 3;
    }
  });
  if (m === 0) throw new Error(`no meshes produced for ${label}`);
  meshes += m;
  triangles += tris;
  return { m, tris };
}

// every profile builds
for (const [key, p] of Object.entries(PROFILES)) {
  const seg = {
    id: 'test-' + key,
    name: key,
    profile: key,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 40, y: 1.5, z: 8 },
      { x: 90, y: 2.5, z: 4 },
    ],
    junctions: { start: true, end: true },
    bridge: key === 'motorway',
    overrides: {},
  };
  const g = buildSegment(seg);
  const { m, tris } = countGroup(g, 'segment ' + key);
  console.log(`segment ${key.padEnd(12)} meshes=${String(m).padStart(2)} tris=${Math.round(tris)}`);
}

// city segments (subset + all bridges)
const cityGroups = doc.segments.map((s) => buildSegment(s));
countGroup({ traverse: (fn) => cityGroups.forEach((g) => g.traverse(fn)) }, 'city segments');

// junctions
for (const jn of doc.junctions.slice(0, 8)) {
  countGroup(
    buildJunction(jn.x, jn.z, jn.size + 7, [{ angle: 0 }, { angle: Math.PI / 2 }, { angle: Math.PI }, { angle: -Math.PI / 2 }]),
    'junction'
  );
}

// rail + subway
countGroup(buildRail(doc.rails[0]), 'rail');
countGroup(buildSubway(doc.subways[0]), 'subway');

// every prop kind, batched
const buckets = new Map();
for (const kind of Object.keys(PROP_KINDS)) {
  collectProp(kind, 10, 0, 10, 0.7, buckets, kind === 'sign-speed' ? { label: 30 } : {});
}
const propGroup = finishPropBuckets(buckets);
const pc = countGroup(propGroup, 'props');
console.log(`props batch       meshes=${pc.m} tris=${Math.round(pc.tris)}`);

// place every city prop (this is the heavy path)
const cityBuckets = new Map();
for (const prop of doc.props) {
  collectProp(prop.kind, prop.x, prop.y ?? 0, prop.z, prop.rotY ?? 0, cityBuckets, prop.opts || {});
}
const cityProps = finishPropBuckets(cityBuckets);
countGroup(cityProps, 'city props');

// polyline sampler
const samples = samplePolyline(doc.segments[0].points, 2.2);
if (samples.length < 2) throw new Error('samplePolyline failed');
const len = polylineSampleLength(samples);
if (!(len > 0)) throw new Error('bad sample length');

console.log(`\nTOTAL meshes=${meshes} triangles=${Math.round(triangles)}`);
console.log('GEOMETRY SMOKE TEST PASSED');

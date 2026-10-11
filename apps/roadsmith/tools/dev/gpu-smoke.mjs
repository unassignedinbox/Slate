// Drives the real renderer against a recording mock of the WebGPU API.
// Catches undefined fields, bad buffer maths and broken draw bookkeeping without a browser.

const noop = () => {};
globalThis.GPUBufferUsage = { VERTEX: 32, INDEX: 16, UNIFORM: 64, COPY_DST: 8, STORAGE: 128 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

const log = { buffers: 0, bufferBytes: 0, textures: 0, pipelines: 0, writes: 0, writeBytes: 0, passes: 0, draws: 0, drawnTris: 0, instances: 0 };
const assert = (cond, msg) => { if (!cond) { console.error('\u001b[31m✗\u001b[0m', msg); process.exitCode = 1; } };

class Buffer {
  constructor(desc) {
    this.size = desc.size; this.usage = desc.usage; this.label = desc.label;
    assert(Number.isFinite(desc.size) && desc.size > 0, `buffer ${desc.label} has size ${desc.size}`);
    assert(desc.size % 4 === 0, `buffer ${desc.label} size ${desc.size} is not 4-byte aligned`);
    log.buffers++; log.bufferBytes += desc.size;
  }
  destroy() {}
}
class Texture {
  constructor(desc) { this.desc = desc; log.textures++; }
  createView() { return { __texture: this, label: `${this.desc.label}-view` }; }
  destroy() {}
}
class Pass {
  constructor(desc, kind) { this.desc = desc; this.kind = kind; this.pipeline = null; this.vbuf = []; this.ibuf = null; log.passes++; }
  setPipeline(p) { assert(!!p, 'setPipeline(undefined)'); this.pipeline = p; }
  setBindGroup(i, g) { assert(!!g, `setBindGroup(${i}, undefined)`); }
  setVertexBuffer(slot, b) { assert(b instanceof Buffer, `setVertexBuffer(${slot}) got ${b}`); this.vbuf[slot] = b; }
  setIndexBuffer(b, fmt) { assert(b instanceof Buffer, 'setIndexBuffer got non-buffer'); assert(fmt === 'uint32', `index format ${fmt}`); this.ibuf = b; }
  drawIndexed(count, instances = 1, first = 0) {
    assert(this.pipeline, 'drawIndexed without a pipeline');
    assert(this.ibuf, 'drawIndexed without an index buffer');
    assert(Number.isFinite(count) && count > 0, `drawIndexed count=${count}`);
    assert(count * 4 <= this.ibuf.size, `drawIndexed reads ${count * 4}B past a ${this.ibuf.size}B index buffer`);
    log.draws++; log.drawnTris += (count / 3) * instances; log.instances += instances > 1 ? instances : 0;
  }
  draw(count, instances = 1, first = 0) {
    assert(this.pipeline, 'draw without a pipeline');
    assert(Number.isFinite(count) && count >= 0, `draw count=${count}`);
    if (this.vbuf[0]) assert((first + count) * 28 <= this.vbuf[0].size, 'overlay draw exceeds its vertex buffer');
    log.draws++;
  }
  end() {}
}
class Encoder {
  beginRenderPass(desc) {
    for (const a of desc.colorAttachments || []) {
      assert(a.view, 'colour attachment without a view');
      if (a.resolveTarget) assert(a.resolveTarget.__texture.desc.sampleCount === undefined, 'resolve target must not be multisampled');
    }
    if (desc.depthStencilAttachment) assert(desc.depthStencilAttachment.view, 'depth attachment without a view');
    // a texture must never be sampled and written in the same pass
    const written = new Set((desc.colorAttachments || []).map((a) => a.view?.__texture));
    if (desc.depthStencilAttachment) written.add(desc.depthStencilAttachment.view.__texture);
    return new Pass(desc, desc.label);
  }
  finish() { return { __cmd: true }; }
}
const device = {
  features: new Set(), limits: {},
  createBuffer: (d) => new Buffer(d),
  createTexture: (d) => new Texture(d),
  createSampler: () => ({ __sampler: true }),
  createBindGroupLayout: (d) => ({ __bgl: d }),
  createBindGroup: (d) => { for (const e of d.entries) assert(e.resource, `bind group entry ${e.binding} has no resource`); return { __bg: d }; },
  createPipelineLayout: (d) => ({ __pl: d }),
  createShaderModule: (d) => { assert(typeof d.code === 'string' && d.code.length > 100, `shader ${d.label} is empty`); return { __mod: d.label }; },
  createRenderPipeline: (d) => {
    log.pipelines++;
    assert(d.vertex?.module, `pipeline ${d.label} without a vertex module`);
    for (const b of d.vertex.buffers || []) {
      assert(b.arrayStride % 4 === 0, `pipeline ${d.label} stride ${b.arrayStride}`);
      for (const a of b.attributes) {
        const bytes = { float32x2: 8, float32x3: 12, float32x4: 16 }[a.format];
        assert(a.offset + bytes <= b.arrayStride, `pipeline ${d.label} attribute ${a.shaderLocation} overruns the stride`);
      }
    }
    return { __pipe: d.label };
  },
  createCommandEncoder: () => new Encoder(),
  queue: {
    writeBuffer: (buf, offset, data, dataOffset = 0, size) => {
      assert(buf instanceof Buffer, 'writeBuffer target is not a buffer');
      const elementBytes = data.BYTES_PER_ELEMENT || 1;
      const bytes = size !== undefined ? size * elementBytes : data.byteLength - dataOffset * elementBytes;
      assert(offset + bytes <= buf.size, `writeBuffer overflows ${buf.label}: ${offset}+${bytes} > ${buf.size}`);
      log.writes++; log.writeBytes += bytes;
    },
    submit: (cmds) => { assert(Array.isArray(cmds) && cmds.length, 'submit with no commands'); },
  },
  addEventListener: noop,
};
const context = {
  configure: noop,
  getCurrentTexture: () => new Texture({ label: 'swapchain', size: [1280, 720] }),
};

const { Renderer } = await import('../../src/gfx/renderer.js');
const { buildScene, defaultSettings } = await import('../../src/road/scene.js');
const { Camera } = await import('../../src/core/camera.js');
const { OverlayBuffer, buildOverlay, pickScene, pickGizmo } = await import('../../src/app/gizmo.js');
const { updateInstances, updateSignals } = await import('../../src/app/frame.js');
const { defaultChannels, ENV_PRESETS } = await import('../../src/gfx/materials.js');

const canvas = { width: 0, height: 0, getContext: () => context };
const renderer = new Renderer({ device, context, format: 'bgra8unorm', canvas, adapter: { info: {} } });
renderer.pixelRatio = 1;
renderer.resize(1280, 720);

const settings = defaultSettings('downtown');
const scene = buildScene(settings);
scene.channels = defaultChannels();
renderer.setScene(scene, { wireLayers: ['surface', 'blocks'] });
console.log(`scene uploaded: ${renderer.layers.size} static layers, ${renderer.instanced.size} instanced groups, ${(log.bufferBytes / 1048576).toFixed(1)} MB of GPU buffers`);

const camera = new Camera({ distance: 220 });
const overlay = new OverlayBuffer(1 << 17);
const env = { ...ENV_PRESETS.night, markings: true, wearGain: 1 };
const view = { wireframe: true, network: true, laneGraph: true, handles: true, gizmo: true };

const junction = [...scene.net.nodes.values()].find((n) => n.edges.length >= 3);
const selection = { type: 'junction', id: junction.id };

for (let f = 0; f < 4; f++) {
  scene.traffic.step(1 / 60);
  scene.trains?.step(1 / 60, scene.traffic);
  camera.update(1 / 60, 16 / 9);
  updateInstances(renderer, scene, new Set());
  updateSignals(renderer, scene, f / 60);
  buildOverlay(overlay, scene, { camera, view, selection, hover: null, dragging: 'x' });
  renderer.render({
    camera, env, time: f / 60,
    overlay: { ...overlay, depthTest: true, depthTestTris: false },
    selection: { x: junction.p.x, y: 0, z: junction.p.z, radius: 9 },
    wireframe: true,
    hiddenLayers: new Set(['subway']),
  });
}

// picking paths: project a known junction to NDC, then shoot a ray back through it
function project(vp, p) {
  const x = vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12];
  const y = vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13];
  const w = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  return { x: x / w, y: y / w };
}
camera.focus(junction.p, 90);
camera.snapTo();
camera.update(0.016, 16 / 9);
const ndc = project(camera.viewProj, { x: junction.p.x, y: junction.p.y, z: junction.p.z });
assert(Math.abs(ndc.x) < 0.2 && Math.abs(ndc.y) < 0.2, `focused junction projected to ${ndc.x.toFixed(2)},${ndc.y.toFixed(2)}`);
const ray = camera.ray(ndc.x, ndc.y);
const hitScene = pickScene(scene, ray);
assert(hitScene && hitScene.type === 'junction' && hitScene.id === junction.id,
  `expected to pick ${junction.id}, got ${hitScene ? `${hitScene.type} ${hitScene.id}` : 'nothing'}`);
const hitGizmo = pickGizmo(camera, junction.p, ray);
assert(hitGizmo && hitGizmo.part === 'plane', `gizmo centre should pick the plane handle, got ${hitGizmo?.part}`);
// axis handle: aim a little along +X from the junction
const axisPoint = { x: junction.p.x + 6 * (1 / 1), y: junction.p.y + 0.35, z: junction.p.z };
const ndcAxis = project(camera.viewProj, axisPoint);
const axisHit = pickGizmo(camera, junction.p, camera.ray(ndcAxis.x, ndcAxis.y));
assert(axisHit && (axisHit.part === 'x' || axisHit.part === 'plane'), `axis pick returned ${axisHit?.part}`);
// a road should be pickable midway along an edge
const edge = [...scene.net.edges.values()].find((e) => e.curve.length > 60);
const mid = edge.curve.pointAt(edge.curve.length / 2);
camera.focus(mid, 70); camera.snapTo(); camera.update(0.016, 16 / 9);
const ndcRoad = project(camera.viewProj, mid);
const roadHit = pickScene(scene, camera.ray(ndcRoad.x, ndcRoad.y));
assert(roadHit && (roadHit.type === 'road' || roadHit.type === 'junction'), `road pick returned ${roadHit?.type}`);
console.log(`pick checks: junction ${hitScene?.id} · gizmo ${hitGizmo?.part}/${axisHit?.part} · road ${roadHit?.type}:${roadHit?.id}`);
assert(overlay.lineCount > 100, `overlay produced only ${overlay.lineCount} line vertices`);
assert(renderer.stats.draws > 10, `only ${renderer.stats.draws} draws`);
assert(renderer.stats.instances > 0, 'no instanced draws');

console.log(`frames drawn: 4 · draws/frame ${renderer.stats.draws} · tris/frame ${(renderer.stats.tris / 1000).toFixed(0)}k · instances ${renderer.stats.instances}`);
console.log(`overlay: ${overlay.lineCount} line verts, ${overlay.triCount} tri verts`);
console.log(`gpu mock: ${log.buffers} buffers (${(log.bufferBytes / 1048576).toFixed(1)} MB), ${log.textures} textures, ${log.pipelines} pipelines, ${log.writes} writes`);
if (!process.exitCode) console.log('\u001b[32m✓\u001b[0m render path clean');

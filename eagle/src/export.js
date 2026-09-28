import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Bake the procedural animation states into keyframed AnimationClips and
// export the whole eagle (meshes + node hierarchy + clips) as a .glb.
export async function exportGLB(eagle, anim, opts = {}) {
  const fps = 30;
  const clips = [];

  // nodes we record: all bones + all animated feathers
  const tracked = [];
  const seen = new Set();
  function track(o, name) {
    if (seen.has(o)) return;
    seen.add(o);
    if (!o.name) o.name = name;
    tracked.push(o);
  }
  Object.entries(eagle.bones).forEach(([n, b]) => track(b, n));
  eagle.feathers.wing.forEach((f, i) => track(f.mesh, f.mesh.name || `wf_${i}`));
  eagle.feathers.tail.forEach((f, i) => track(f.mesh, f.mesh.name || `tf_${i}`));

  // give every node a unique name (GLTF requirement for targeting)
  const used = new Set();
  eagle.root.traverse(o => {
    if (!o.name || used.has(o.name)) o.name = (o.name || 'n') + '_' + o.id;
    used.add(o.name);
  });

  const saveState = {
    state: anim.state, weights: { ...anim.weights }, time: anim.time,
    oneshot: anim.oneshot, grounded: anim.grounded, flap: anim.flapPhase,
  };

  function bake(name, setup, duration) {
    const nF = Math.round(duration * fps);
    const times = new Float32Array(nF + 1);
    const posBuf = tracked.map(() => new Float32Array((nF + 1) * 3));
    const quatBuf = tracked.map(() => new Float32Array((nF + 1) * 4));
    for (let f = 0; f <= nF; f++) {
      const t = f / fps;
      times[f] = t;
      setup(t, f / nF);
      anim.update(0); // evaluate at current forced time
      tracked.forEach((o, i) => {
        posBuf[i].set([o.position.x, o.position.y, o.position.z], f * 3);
        quatBuf[i].set([o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w], f * 4);
      });
    }
    const tracks = [];
    tracked.forEach((o, i) => {
      tracks.push(new THREE.VectorKeyframeTrack(o.name + '.position', times, posBuf[i]));
      tracks.push(new THREE.QuaternionKeyframeTrack(o.name + '.quaternion', times, quatBuf[i]));
    });
    // root height lives on 'root' which IS tracked (bones.root), fine.
    clips.push(new THREE.AnimationClip(name, duration, tracks));
  }

  function force(state, grounded) {
    anim.oneshot = null;
    anim.state = state;
    anim.grounded = grounded;
    for (const k of Object.keys(anim.weights)) anim.weights[k] = k === state ? 1 : 0;
  }

  // loop states — durations chosen to loop cleanly-ish
  force('idle', true);
  bake('Idle', (t) => { anim.time = t; }, 5.2);
  force('walk', true);
  bake('Walk', (t) => { anim.time = t; anim.flapPhase = 0; }, 1 / 1.15 * 2);
  force('flight', false);
  bake('Flight', (t) => { anim.time = t; anim.flapPhase = t * 2 * Math.PI * anim.flapFreq; }, 2 / anim.flapFreq);
  force('glide', false);
  bake('Glide', (t) => { anim.time = t; anim.flapPhase = 0; }, 6);
  // one-shots
  bake('TakeOff', (t, u) => {
    anim.time = t;
    anim.state = 'takeoff'; anim.grounded = true;
    anim.oneshot = { name: 'takeoff', t: Math.min(u * 2.5, 2.499), dur: 2.5 };
    for (const k of Object.keys(anim.weights)) anim.weights[k] = k === 'takeoff' ? 1 : 0;
  }, 2.5);
  bake('Landing', (t, u) => {
    anim.time = t;
    anim.state = 'landing'; anim.grounded = false;
    anim.oneshot = { name: 'landing', t: Math.min(u * 3.0, 2.999), dur: 3.0 };
    for (const k of Object.keys(anim.weights)) anim.weights[k] = k === 'landing' ? 1 : 0;
  }, 3.0);

  // restore
  anim.state = saveState.state;
  anim.weights = saveState.weights;
  anim.time = saveState.time;
  anim.oneshot = saveState.oneshot;
  anim.grounded = saveState.grounded;
  anim.flapPhase = saveState.flap;

  const exporter = new GLTFExporter();
  const buf = await exporter.parseAsync(eagle.root, { binary: true, animations: clips });
  const blob = new Blob([buf], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bald_eagle_animated.glb';
  if (!opts.noDownload) {
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const out = { bytes: blob.size, clips: clips.map(c => c.name + ' ' + c.duration.toFixed(2) + 's') };
  if (opts.returnData) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    out.base64 = btoa(bin);
  }
  return out;
}

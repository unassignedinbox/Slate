// Portal surface: you see the destination section through the gateway.
// A virtual camera is placed at the destination exactly where the player's camera
// sits relative to the source gate; its off-axis frustum is fitted to the
// destination opening with the near plane ON the portal plane, so the picture
// lines up perfectly with the stone frame and nothing behind the far gate leaks in.
import * as THREE from 'three';
import { evalMotion } from '../core/motion.js';

const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
const _vr = new THREE.Vector3(), _vu = new THREE.Vector3(), _vn = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3();

function frameCornersNear(cam, pa, pb, pc) {
  _vr.subVectors(pb, pa).normalize();
  _vu.subVectors(pc, pa).normalize();
  _vn.crossVectors(_vr, _vu).normalize();
  _va.subVectors(pa, cam.position);
  _vb.subVectors(pb, cam.position);
  _vc.subVectors(pc, cam.position);
  const d = -_va.dot(_vn);
  if (d <= 0.05) return false;
  const n = Math.max(0.05, d - 0.02), f = cam.far;
  cam.near = n;
  const l = _vr.dot(_va) * n / d, r = _vr.dot(_vb) * n / d, b = _vu.dot(_va) * n / d, t = _vu.dot(_vc) * n / d;
  _q.setFromUnitVectors(_t.set(0, 1, 0), _vu);
  cam.quaternion.setFromUnitVectors(_t.set(0, 0, 1).applyQuaternion(_q), _vn).multiply(_q);
  cam.updateMatrixWorld(true);
  cam.projectionMatrix.set(
    2 * n / (r - l), 0, (r + l) / (r - l), 0,
    0, 2 * n / (t - b), (t + b) / (t - b), 0,
    0, 0, (f + n) / (n - f), 2 * f * n / (n - f),
    0, 0, -1, 0);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return true;
}

export class PortalView {
  constructor(renderer, scene, portal, world, quality = 'high') {
    this.renderer = renderer;
    this.scene = scene;
    this.portal = portal;
    this.world = world;
    const res = quality === 'high' ? [1280, 780] : [768, 468];
    this.rt = new THREE.WebGLRenderTarget(res[0], res[1], { samples: quality === 'high' ? 4 : 0, type: THREE.HalfFloatType });
    this.cam = new THREE.PerspectiveCamera(60, res[0] / res[1], 0.1, 7000);
    const { w, h } = portal.from;
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(Math.PI); // face the approach side (-Z of the gate); u=0 on the viewer's left
    this.uniforms = { map: { value: this.rt.texture }, uTime: { value: 0 }, uReady: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float uTime; uniform float uReady; varying vec2 vUv;
        void main(){
          vec2 e = min(vUv, 1.0 - vUv);
          float edge = min(e.x * 1.64, e.y);
          // faint heat-haze at the rim so it reads as an opening, not a picture
          float k = (1.0 - smoothstep(0.0, 0.06, edge)) * 0.006;
          vec2 uv = vUv + k * vec2(sin(vUv.y * 60.0 + uTime * 2.1), cos(vUv.x * 50.0 - uTime * 1.7));
          vec4 c = texture2D(map, clamp(uv, 0.001, 0.999));
          vec3 haze = vec3(0.80, 0.83, 0.85);
          c.rgb = mix(haze, c.rgb, uReady);
          c.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.05, edge));
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 1;
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x8d9297, roughness: 1, transparent: true, opacity: 0.35 }));
    this.mesh.add(this.back);
    scene.add(this.mesh);
    this.sp = new THREE.Vector3(); this.sq = new THREE.Quaternion();
    this.dp = new THREE.Vector3(); this.dq = new THREE.Quaternion();
    this.enabled = true;
  }

  update(mainCam, time) {
    const P = this.portal, W = this.world;
    evalMotion(P.from.parent, W.motionTime, this.sp, this.sq);
    evalMotion(P.to.parent, W.motionTime, this.dp, this.dq);
    this.mesh.position.copy(this.sp);
    this.mesh.quaternion.copy(this.sq);
    this.uniforms.uTime.value = time;
    const rel = _t.copy(mainCam.position).sub(this.sp).applyQuaternion(this.sq.clone().invert());
    const dist = rel.length();
    const front = rel.z < 0;
    if (!this.enabled || !front || dist > 1600) return;
    // the gate is visible from much of the town: refresh it less often when it is small on screen
    this._f = (this._f || 0) + 1;
    if (this.uniforms.uReady.value >= 1 && (dist > 700 || (dist > 250 && this._f % 3 !== 0))) return;
    // is the gate on screen at all?
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(mainCam.projectionMatrix, mainCam.matrixWorldInverse));
    if (!frustum.intersectsSphere(new THREE.Sphere(this.sp, Math.max(P.from.w, P.from.h)))) return;
    const cam = this.cam;
    const dqRel = this.dq.clone().multiply(this.sq.clone().invert());
    cam.position.copy(rel).applyQuaternion(this.dq).add(this.dp);
    const { w, h } = P.from;
    const pa = new THREE.Vector3(w / 2, -h / 2, 0).applyQuaternion(this.dq).add(this.dp);
    const pb = new THREE.Vector3(-w / 2, -h / 2, 0).applyQuaternion(this.dq).add(this.dp);
    const pc = new THREE.Vector3(w / 2, h / 2, 0).applyQuaternion(this.dq).add(this.dp);
    if (!frameCornersNear(cam, pa, pb, pc)) return;
    void dqRel;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.mesh.visible = false;
    r.setRenderTarget(this.rt);
    r.render(this.scene, cam);
    r.setRenderTarget(prev);
    this.mesh.visible = true;
    this.uniforms.uReady.value = Math.min(1, this.uniforms.uReady.value + 0.2);
  }
}

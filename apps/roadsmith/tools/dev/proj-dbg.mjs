import { Camera } from '../../src/core/camera.js';
const c = new Camera({ distance: 100, yaw: 0, pitch: 0.3, target: {x:0,y:0,z:0} });
c.snapTo(); c.update(1, 16/9);
const proj = (p) => {
  const m = c.viewProj;
  const w = m[3]*p.x + m[7]*p.y + m[11]*p.z + m[15];
  return { x: (m[0]*p.x+m[4]*p.y+m[8]*p.z+m[12])/w, y: (m[1]*p.x+m[5]*p.y+m[9]*p.z+m[13])/w, z: (m[2]*p.x+m[6]*p.y+m[10]*p.z+m[14])/w };
};
const fwd = { x: c.position.x - c._t.x, y: c.position.y - c._t.y, z: c.position.z - c._t.z };
const len = Math.hypot(fwd.x, fwd.y, fwd.z);
const toward = (d) => ({ x: c.position.x - fwd.x/len*d, y: c.position.y - fwd.y/len*d, z: c.position.z - fwd.z/len*d });
console.log('at near (0.26 m):', proj(toward(0.26)).z.toFixed(4), '(expect ~0)');
console.log('at 100 m       :', proj(toward(100)).z.toFixed(4));
console.log('at far  (800 m):', proj(toward(799)).z.toFixed(4), '(expect ~1)');
console.log('centre screen  :', proj(toward(100)).x.toFixed(3), proj(toward(100)).y.toFixed(3));

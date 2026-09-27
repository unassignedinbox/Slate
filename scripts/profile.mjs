import { Game } from '../src/game.js';
const g = new Game(null, null, null, { headless: true });
await g.load();
g.start();
const car = g.car;
// teleport to the busiest sector (the killing ground) and profile subsystems
car.pos.set(g.roads.main.at(0.85).x, 0, g.roads.main.at(0.85).z);
car.pos.y = g.field.height(car.pos.x, car.pos.z);
car.speed = 30;
const dt = 1/60;
for (let i=0;i<120;i++) g.step(dt);   // warm up

const time = (label, fn, n=300) => {
  const t=process.hrtime.bigint();
  for(let i=0;i<n;i++) fn();
  const ms=Number(process.hrtime.bigint()-t)/1e6/n;
  console.log(label.padEnd(22), ms.toFixed(3)+' ms/frame');
  return ms;
};
time('ocean.update', ()=>g.ocean.update(dt));
time('effects.update', ()=>g.effects.update(dt));
time('sentries', ()=>{ for(const s of g.sentries) s.update(dt, car, g.bullets, null, g.camera); });
time('bullets.update', ()=>g.bullets.update(dt, g.field, {pos:car.pos,radius:1.5}, ()=>{}));
time('car.update', ()=>car.update(dt, g.input, g.ocean));
time('planes.update', ()=>g.planes.update(dt, car, 0.85, 200));
time('field.height x1000', ()=>{ for(let i=0;i<1000;i++) g.field.height(car.pos.x+i*0.1, car.pos.z); }, 50);
time('full step', ()=>g.step(dt));
console.log('scene children', g.scene.children.length);
let tris=0, draws=0;
g.scene.traverse(o=>{ if(o.isMesh && o.geometry?.index) {tris+=o.geometry.index.count/3; draws++;} else if(o.isMesh){ tris+=(o.geometry.attributes.position.count/3)*(o.isInstancedMesh?o.count:1); draws++; } });
console.log('meshes', draws, 'approx tris', Math.round(tris).toLocaleString());

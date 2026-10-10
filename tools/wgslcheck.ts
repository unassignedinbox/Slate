import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js';
import { GEN, HYDRO_FLUX, HYDRO_ERODE, HYDRO_TRANSPORT, HYDRO_COMMIT, THERMAL_CALC, THERMAL_APPLY, ANALYSIS } from '../src/terrain/shaders/compute.wgsl';
import { TERRAIN_SHADER, WATER_SHADER, SKY_SHADER } from '../src/terrain/shaders/render.wgsl';
const all: [string, string][] = [
  ['GEN', GEN], ['HYDRO_FLUX', HYDRO_FLUX], ['HYDRO_ERODE', HYDRO_ERODE],
  ['HYDRO_TRANSPORT', HYDRO_TRANSPORT], ['HYDRO_COMMIT', HYDRO_COMMIT],
  ['THERMAL_CALC', THERMAL_CALC], ['THERMAL_APPLY', THERMAL_APPLY], ['ANALYSIS', ANALYSIS],
  ['TERRAIN', TERRAIN_SHADER], ['WATER', WATER_SHADER], ['SKY', SKY_SHADER],
];
let bad = 0;
for (const [name, src] of all) {
  try {
    const r = new WgslReflect(src);
    const ent = [...r.entry.vertex.map(e => 'vs:' + e.name), ...r.entry.fragment.map(e => 'fs:' + e.name), ...r.entry.compute.map(e => 'cs:' + e.name)];
    console.log(`OK  ${name.padEnd(16)} ${String(src.split('\n').length).padStart(4)} lines  [${ent.join(' ')}]`);
  } catch (e: any) {
    bad++;
    console.log(`ERR ${name}: ${e.message ?? e}`);
  }
}
process.exit(bad ? 1 : 0);

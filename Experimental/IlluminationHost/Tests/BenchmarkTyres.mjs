import { performance } from 'node:perf_hooks';
import { TyreCarcassSolver } from '../Source/TyreCarcassSolver.js';
import { VehicleSolver } from '../Source/VehicleSolver.js';
import { VehicleGeometry as G } from '../Source/VehicleSpecification.js';
const V=new VehicleSolver();
const S=new TyreCarcassSolver(G.TyreRadius,G.TyreRimRadius,G.TyreWidth/2);
const Command={Throttle:1,Brake:0,Steer:.1,Handbrake:false,LineLock:true};
for(let I=0;I<120;I++) {V.Advance(Command,1/60);S.Advance(V.QueryCarcassContacts(),1/60);}
const Count=1800,Start=performance.now();
for(let I=0;I<Count;I++) {V.Advance(Command,1/60);S.Advance(V.QueryCarcassContacts(),1/60);}
const Elapsed=performance.now()-Start;
console.log(JSON.stringify({frames:Count,simulatedSeconds:Count/60,cpuMilliseconds:Elapsed,
    millisecondsPerFrame:Elapsed/Count,scope:'complete CPU vehicle + four radial/axial shells; no GPU rendering',
    note:'Node sandbox measurement, not a target-hardware FPS guarantee'},null,2));

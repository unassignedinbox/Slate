// Particle-based erosion with real transport & settlement.
// Fixes prior “infinite drill” bug: particles carry limited sediment, deposit when slow, settle and die.

import { SIZE, MIN, MAX, CELL, sampleSDF, estimateNormal, sculptAt } from "./volume.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class ParticleSystem {
  constructor(volume){
    this.volume = volume; // Float32Array ref (mutated)
    this.particles = [];
    this.tick = 0;
    this.stats = { totalEroded:0, totalDeposited:0, active:0, sedimentCarried:0 };
    this.params = {
      dt: 0.045,
      rain: 0.72,
      erosion: 0.58,
      hardness: 0.56,
      deposition: 0.42,
      particleCount: 900,
      grainSize: 0.14,
      capacity: 0.65,
      restitution: 0.08,
      footprint: 0.85,
      windSpeed: 6.2,
      windDir: 0, // degrees
      thermal: 0.32,
      riverEnabled: true,
      riverSpeed: 2.8,
      riverWidth: 3.2,
      waterLevel: 1.1,
    };
    this.riverPath = null; // polyline [{x,y,z}] valley
    this.onUpdate = null;
  }

  setVolume(vol){ this.volume = vol; }

  reset(){
    this.particles.length=0;
    this.tick=0;
    this.stats = {totalEroded:0,totalDeposited:0,active:0,sedimentCarried:0};
    this.spawnInitial();
  }

  spawnInitial(){
    // spawn dispersed raindrops on upper surface
    const N = this.params.particleCount;
    for(let i=0;i<N;i++) this.spawnParticle(false);
  }

  spawnParticle(burst=false){
    // random XZ, Y above terrain
    const x = (Math.random()-0.5)*34;
    const z = (Math.random()-0.5)*30;
    // find surface Y by sampling top-down
    let y = MAX[1]-0.5;
    // quick drop until near surface
    for(let k=0;k<80;k++){
      const d = sampleSDF(this.volume, [x,y,z]);
      if(d<0.4) { y+=0.7; break; }
      y-=0.4;
      if(y<MIN[1]) y=MAX[1]-Math.random()*4;
    }
    // random velocity bias downhill + wind
    const angle = this.params.windDir * Math.PI/180;
    const wind = [Math.cos(angle)*this.params.windSpeed*0.04, 0, Math.sin(angle)*this.params.windSpeed*0.04];
    this.particles.push({
      pos:[x+ (Math.random()-0.5)*0.6, y+2.5+Math.random()*1.2, z+(Math.random()-0.5)*0.6],
      vel:[wind[0]+(Math.random()-0.5)*0.6, -1.2 -Math.random()*0.8, wind[2]+(Math.random()-0.5)*0.6],
      sediment:0,
      water: 1.0,
      life: 0,
      maxLife: 280 + Math.random()*120,
      settled:false,
      radius: this.params.grainSize * (0.7 + Math.random()*0.6),
      kind: Math.random()<0.72? 0:1, // 0=hydraulic 1=wind-affected
      speed:0,
    });
  }

  updateRiverPath(path){ this.riverPath = path; }

  // Thermal erosion pass (separate from particles) — slope collapse
  thermalPass(){
    const [nx,ny,nz]=SIZE;
    const talus = this.params.thermal * 0.045; // per tick
    // Simple thermal: if slope > threshold, transfer material downhill
    // We iterate surface voxels sparsely
    const thresh = 0.75; // tan
    let deposited=0;
    for(let z=1; z<nz-1; z+=2){
      for(let x=1; x<nx-1; x+=2){
        for(let y=1; y<ny-1; y++){
          const idx=(z*ny+y)*nx+x;
          const d=this.volume[idx];
          if(Math.abs(d)>1.0) continue; // only near surface
          // estimate gradient y vs neighbor below
          const below=this.volume[(z*ny+(y-1))*nx+x];
          const above=this.volume[(z*ny+(y+1))*nx+x];
          const dBelow=below - d, dAbove=above - d;
          // if overhang unstable: average vs below
          if(dBelow < -0.4 && y>4){
            // high thermal slope -> erode upper, deposit lower
            const diff = (d - below) * talus * 0.6;
            if(diff>0){
              this.volume[idx] += diff;
              this.volume[(z*ny+(y-1))*nx+x] -= diff*0.92; // mass conserve ~92% (8% fines lost)
              deposited+=diff;
            }
          }
        }
      }
    }
    return deposited;
  }

  windAbrasionPass(){
    const [nx,ny,nz]=SIZE;
    const angle=this.params.windDir*Math.PI/180;
    const wdir=[Math.cos(angle),0,Math.sin(angle)]; // horizontal wind
    const strength=this.params.wind *0.0045;
    // wind erosion: erode windward faces, deposit leeward
    // Sample exposure by checking occlusion along wind
    let eroded=0;
    for(let iter=0; iter<280; iter++){
      const x=1+Math.floor(Math.random()*(nx-2));
      const y=2+Math.floor(Math.random()*(ny-3));
      const z=1+Math.floor(Math.random()*(nz-2));
      const idx=(z*ny+y)*nx+x;
      const d=this.volume[idx];
      if(Math.abs(d)>0.9) continue;
      const pos=[MIN[0]+(x+0.5)*CELL[0], MIN[1]+(y+0.5)*CELL[1], MIN[2]+(z+0.5)*CELL[2]];
      const n=estimateNormal(this.volume,pos,0.28);
      const facing = n[0]*wdir[0] + n[2]*wdir[2]; // >0 windward
      if(facing<0.12) continue; // not windward enough
      // occlusion test: march upwind a bit, if solid in front, shadowed
      let shadow=0;
      for(let s=1; s<=4; s++){
        const sp=[pos[0]-wdir[0]*s*0.7, pos[1], pos[2]-wdir[2]*s*0.7];
        if(sampleSDF(this.volume,sp)< -0.15){ shadow=1; break; }
      }
      if(shadow) continue;
      // erode slightly
      const amt=strength * facing * (1 - this.params.hardness*0.6) * (0.6+Math.random()*0.8);
      this.volume[idx] += amt; // make SDF more positive = remove material
      eroded+=amt;
      // deposit leeward: find lee position downwind a few voxels where cavity exists
      if(Math.random()<0.35){
        const lee=[pos[0]+wdir[0]* (2+Math.random()*3), pos[1]-0.4, pos[2]+wdir[2]* (2+Math.random()*3)];
        sculptAt(this.volume, lee, this.params.grainSize*3.2, 'deposit', 0.32);
      }
    }
    return eroded;
  }

  // Single tick: advance N active particles
  step(dtScale=1){
    if(!this.volume) return;
    const dt = this.params.dt * dtScale;
    const gravity=[0,-9.8,0];
    const windAngle=this.params.windDir*Math.PI/180;
    const windVec=[Math.cos(windAngle)*this.params.windSpeed, 0, Math.sin(windAngle)*this.params.windSpeed];
    const activeLimit=this.params.particleCount;
    // ensure pool size
    while(this.particles.length < activeLimit) this.spawnParticle();

    let erodedThisTick=0, depositedThisTick=0, sedimentCarried=0, activeCount=0;

    const toRespawn=[];

    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];
      if(p.settled) continue;
      activeCount++;
      p.life++;
      // river current influence
      let riverCurrent=[0,0,0];
      if(this.params.riverEnabled && this.riverPath){
        // find closest segment
        const closest=this.closestRiverPoint(p.pos);
        if(closest && closest.dist < this.params.riverWidth*1.8){
          // tangent
          const t=closest.tangent;
          const speed=this.params.riverSpeed * (1 - clamp(closest.dist/this.params.riverWidth,0,1))*0.85;
          riverCurrent=[t[0]*speed, -0.12, t[2]*speed];
          // lateral pull toward center
          const toCenter=[closest.point[0]-p.pos[0], 0, closest.point[2]-p.pos[2]];
          const len=Math.hypot(toCenter[0],toCenter[2])||1;
          riverCurrent[0]+= toCenter[0]/len*0.35;
          riverCurrent[2]+= toCenter[2]/len*0.35;
        }
      }

      // acceleration
      // terrain gradient
      const n=estimateNormal(this.volume,p.pos,0.22);
      const slope = Math.sqrt(Math.max(0,1 - n[1]*n[1]));
      // downhill direction = -project gravity onto tangent plane + negative normal Y
      // simplified: acceleration = slope * downhill + gravity + wind*0.02 + riverCurrent
      const downhill=[ -n[0]*slope*5.0, -0.6, -n[2]*slope*5.0 ];
      const acc=[
        downhill[0] + gravity[0]*0.12 + windVec[0]*0.018 + riverCurrent[0]*0.9,
        downhill[1] + gravity[1]*0.18 + riverCurrent[1]*0.9,
        downhill[2] + gravity[2]*0.12 + windVec[2]*0.018 + riverCurrent[2]*0.9,
      ];
      // update velocity with drag
      const drag = 0.965;
      p.vel[0]=p.vel[0]*drag + acc[0]*dt;
      p.vel[1]=p.vel[1]*drag + acc[1]*dt;
      p.vel[2]=p.vel[2]*drag + acc[2]*dt;
      // clamp speed
      const speed=Math.hypot(p.vel[0],p.vel[1],p.vel[2]);
      p.speed=speed;
      if(speed>7){
        const s=7/speed; p.vel[0]*=s; p.vel[1]*=s; p.vel[2]*=s;
      }
      // move
      const next=[p.pos[0]+p.vel[0]*dt, p.pos[1]+p.vel[1]*dt, p.pos[2]+p.vel[2]*dt];
      // collision with terrain
      const dNext=sampleSDF(this.volume,next);
      const dCur=sampleSDF(this.volume,p.pos);
      const isInsideNext = dNext < 0;
      const isInsideCur = dCur < 0;

      // If going inside solid, handle erosion/deposition and bounce
      if(isInsideNext){
        // contact point approx = current pos offset toward surface
        const nor=estimateNormal(this.volume,next,0.22);
        // reflect velocity with restitution
        const dot = p.vel[0]*nor[0]+p.vel[1]*nor[1]+p.vel[2]*nor[2];
        if(dot<0){
          const rest=this.params.restitution;
          p.vel[0]-= (1+rest)*dot*nor[0];
          p.vel[1]-= (1+rest)*dot*nor[1];
          p.vel[2]-= (1+rest)*dot*nor[2];
          // friction
          p.vel[0]*=0.78; p.vel[2]*=0.78; p.vel[1]*=0.55;
        }
        // push out slightly
        const push = 0.12 - dNext;
        next[0]+= nor[0]*push;
        next[1]+= nor[1]*push;
        next[2]+= nor[2]*push;

        // Erosion / deposition logic
        const hardness = clamp(this.params.hardness + Math.sin(next[1]*3.5)*0.08, 0.05, 0.96);
        const kinetic = clamp(speed*0.18,0,1.8);
        // capacity decreases as already loaded
        const capacity = this.params.capacity * (0.8 + p.radius*2);
        const loadRatio = p.sediment / Math.max(0.001, capacity);
        // Erosion amount proportional to kinetic * (1-hardness) * (1-loadRatio) — if full, no more erode
        const erodeAmt = this.params.erosion * kinetic * (1 - hardness) * Math.max(0, 1 - loadRatio) * dt* 22 * this.params.footprint;
        // Deposition trigger: when overloaded or slow or flat
        const flatness = clamp(n[1],0,1); // up-facing flat
        const shouldDeposit = loadRatio > 0.85 || (speed < 1.0 && flatness>0.55) || (slope<0.15 && p.sediment>0.01);
        if(shouldDeposit && p.sediment>0.001){
          // deposit fraction
          const depositRatio = clamp(this.params.deposition * (0.35 + flatness*0.6) + (loadRatio-0.8)*0.5, 0, 0.85);
          const dep = p.sediment * depositRatio * 0.55;
          if(dep>0.0005){
            // deposit down-slope a little (gravity)
            const depPos=[next[0]+ (Math.random()-0.5)*0.4, next[1]-0.22, next[2]+(Math.random()-0.5)*0.4];
            sculptAt(this.volume, depPos, p.radius*2.2 + 0.12, 'deposit', 0.9);
            p.sediment = Math.max(0,p.sediment - dep);
            depositedThisTick += dep;
            // particles that deposit a lot start to settle
            if(depositRatio>0.5 && speed<0.8) p.vel[0]*=0.7, p.vel[2]*=0.7;
          }
        } else if(erodeAmt>0.0003){
          // erode
          sculptAt(this.volume, next, p.radius*1.6, 'carve', 1.0);
          const picked = erodeAmt*0.42; // sediment picked
          p.sediment = Math.min(capacity, p.sediment + picked);
          erodedThisTick += picked;
          // attrition: big grains break down
          // slight random walk to avoid boring straight drill
          p.vel[0]+=(Math.random()-0.5)*0.4;
          p.vel[2]+=(Math.random()-0.5)*0.4;
        }

        // settling: if very slow and not moving downhill, settle and retire
        if(speed<0.25 && slope<0.18 && p.life>30){
          // final deposit
          if(p.sediment>0.002){
            sculptAt(this.volume, [next[0],next[1]-0.18,next[2]], p.radius*2.0, 'deposit', 0.8);
            depositedThisTick += p.sediment*0.7;
            p.sediment*=0.3;
          }
          p.settled=true;
          toRespawn.push(i);
        }
        // if inside for too long but still fast, nudge upward to prevent stuck
        if(isInsideCur && speed<0.4){
          next[1]+=0.35;
        }
      } else {
        // free flight, slight evaporation
        p.water *= 0.997;
        // sediment slowly settles in air? slight
        if(p.sediment>0) p.sediment*=0.9992;
      }

      // bounds & life retirement
      let outOfBounds = next[0]<MIN[0]+0.2 || next[0]>MAX[0]-0.2 || next[2]<MIN[2]+0.2 || next[2]>MAX[2]-0.2 || next[1]<MIN[1]-1.5 || next[1]>MAX[1]+3;
      if(p.life>p.maxLife || outOfBounds || p.water<0.06){
        // deposit remaining sediment near ground before respawn
        if(p.sediment>0.005){
          let dropY=next[1];
          // find ground
          for(let k=0;k<8;k++){
            const d=sampleSDF(this.volume,[next[0],dropY, next[2]]);
            if(d<0.12){ dropY-=0.28; break;}
            dropY-=0.38;
          }
          const depPos=[next[0],dropY,next[2]];
          sculptAt(this.volume, depPos, p.radius*2.4, 'deposit', 0.7);
          depositedThisTick+=p.sediment*0.6;
        }
        p.settled=true;
        toRespawn.push(i);
      }

      p.pos[0]=next[0]; p.pos[1]=next[1]; p.pos[2]=next[2];
      sedimentCarried+=p.sediment;
    }

    // respawn settled particles as new raindrops at top - maintains constant active count and stops drilling by fresh drops
    for(let idx of toRespawn){
      const p=this.particles[idx];
      // respawn in place as new drop
      const x=(Math.random()-0.5)*32;
      const z=(Math.random()-0.5)*28;
      let y=MAX[1]-0.5;
      for(let k=0;k<40;k++){
        const d=sampleSDF(this.volume,[x,y,z]);
        if(d<0.5) break;
        y-=0.4;
      }
      p.pos=[x+(Math.random()-0.5)*0.5, y+3+Math.random()*0.8, z+(Math.random()-0.5)*0.5];
      p.vel=[(Math.random()-0.5)*0.5, -0.8-Math.random()*0.6, (Math.random()-0.5)*0.5];
      p.sediment=0; p.water=1; p.life=0; p.settled=false; p.maxLife=260+Math.random()*140; p.radius=this.params.grainSize*(0.7+Math.random()*0.6);
    }

    // occasional thermal + wind passes interleaved (every few ticks)
    if(this.tick % 12 === 0) this.thermalPass();
    if(this.tick % 18 === 0) this.windAbrasionPass();

    this.tick++;
    this.stats.totalEroded+=erodedThisTick;
    this.stats.totalDeposited+=depositedThisTick;
    this.stats.active=activeCount;
    this.stats.sedimentCarried=sedimentCarried;
    return {eroded:erodedThisTick, deposited:depositedThisTick, active:activeCount, sediment:sedimentCarried};
  }

  closestRiverPoint(pos){
    if(!this.riverPath || this.riverPath.length<2) return null;
    let best=null, bestDist=Infinity;
    for(let i=0;i<this.riverPath.length-1;i++){
      const a=this.riverPath[i], b=this.riverPath[i+1];
      // project pos onto segment a-b (XZ plane)
      const ax=a[0], az=a[2], bx=b[0], bz=b[2];
      const apx=pos[0]-ax, apz=pos[2]-az;
      const abx=bx-ax, abz=bz-az;
      const abLen=Math.hypot(abx,abz)||1;
      let t=(apx*abx + apz*abz)/(abLen*abLen);
      t=clamp(t,0,1);
      const proj=[ax+abx*t, (a[1]+b[1])/2, az+abz*t];
      const d=Math.hypot(pos[0]-proj[0], pos[2]-proj[2]);
      if(d<bestDist){
        bestDist=d;
        const tangent=[abx/abLen,0,abz/abLen];
        best={point:proj, tangent, dist:d, t:t, index:i};
      }
    }
    return best;
  }

  updateParams(p){
    Object.assign(this.params, p);
    // adjust particle pool size if count changed
    const diff=this.params.particleCount - this.particles.length;
    if(diff>0) for(let i=0;i<diff;i++) this.spawnParticle();
    else if(diff<0) this.particles.splice(diff);
  }

  getPositionsForRender(){
    // return Float32Array of xyz + sediment load + speed for GPU points
    const N=this.particles.length;
    const arr=new Float32Array(N*4);
    for(let i=0;i<N;i++){
      const p=this.particles[i];
      arr[i*4]=p.pos[0];
      arr[i*4+1]=p.pos[1];
      arr[i*4+2]=p.pos[2];
      arr[i*4+3]= p.settled? -1 : (p.sediment*8 + p.speed*0.12);
    }
    return arr;
  }
}

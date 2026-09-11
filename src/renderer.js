// Three.js renderer — marching tetra mesh (watertight caves) + flow-aligned water + small-particle points
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SIZE, MIN, MAX, CELL } from "./volume.js";

// Tetrahedra decomposition of cube — 6 tets, watertight
// cube vertices: 0:000 1:100 2:101 3:001 4:010 5:110 6:111 7:011
const cubeVerts = [[0,0,0],[1,0,0],[1,0,1],[0,0,1],[0,1,0],[1,1,0],[1,1,1],[0,1,1]];
const tetraIndices = [
  [0,5,1,6],
  [0,1,2,6],
  [0,2,3,6],
  [0,3,7,6],
  [0,7,4,6],
  [0,4,5,6],
];
const tetraEdges = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]; // local tetra edges

function interp(p1,p2,v1,v2){
  const mu = (0 - v1)/(v2 - v1);
  const t = Math.max(0, Math.min(1, mu));
  return [p1[0]+(p2[0]-p1[0])*t, p1[1]+(p2[1]-p1[1])*t, p1[2]+(p2[2]-p1[2])*t];
}

export function marchingCubes(volume, iso=0){
  const [nx,ny,nz]=SIZE;
  const positions=[], normals=[], indices=[];
  let indexOffset=0;
  for(let z=0;z<nz-1;z++){
    for(let y=0;y<ny-1;y++){
      for(let x=0;x<nx-1;x++){
        const base=(z*ny+y)*nx+x;
        const cubeVals=[
          volume[base],
          volume[base+1],
          volume[base+nx+1],
          volume[base+nx],
          volume[base+nx*ny],
          volume[base+nx*ny+1],
          volume[base+nx*ny+nx+1],
          volume[base+nx*ny+nx],
        ];
        // early cube skip: all inside or all outside -> no surface
        let minV=cubeVals[0], maxV=cubeVals[0];
        for(let k=1;k<8;k++){ if(cubeVals[k]<minV) minV=cubeVals[k]; if(cubeVals[k]>maxV) maxV=cubeVals[k]; }
        if(maxV<iso || minV>iso) continue;
        const cubePos=[
          [MIN[0]+x*CELL[0], MIN[1]+y*CELL[1], MIN[2]+z*CELL[2]],
          [MIN[0]+(x+1)*CELL[0], MIN[1]+y*CELL[1], MIN[2]+z*CELL[2]],
          [MIN[0]+(x+1)*CELL[0], MIN[1]+y*CELL[1], MIN[2]+(z+1)*CELL[2]],
          [MIN[0]+x*CELL[0], MIN[1]+y*CELL[1], MIN[2]+(z+1)*CELL[2]],
          [MIN[0]+x*CELL[0], MIN[1]+(y+1)*CELL[1], MIN[2]+z*CELL[2]],
          [MIN[0]+(x+1)*CELL[0], MIN[1]+(y+1)*CELL[1], MIN[2]+z*CELL[2]],
          [MIN[0]+(x+1)*CELL[0], MIN[1]+(y+1)*CELL[1], MIN[2]+(z+1)*CELL[2]],
          [MIN[0]+x*CELL[0], MIN[1]+(y+1)*CELL[1], MIN[2]+(z+1)*CELL[2]],
        ];
        for(const tet of tetraIndices){
          const tetVals=tet.map(i=>cubeVals[i]);
          const tetPos=tet.map(i=>cubePos[i]);
          // tetra case: bit set if inside (val<iso)
          let mask=0;
          for(let i=0;i<4;i++) if(tetVals[i] < iso) mask |= 1<<i;
          if(mask===0 || mask===15) continue;
          // find intersections
          const pts=[];
          for(let e=0;e<6;e++){
            const a=tetraEdges[e][0], b=tetraEdges[e][1];
            const va=tetVals[a], vb=tetVals[b];
            const insideA=va<iso, insideB=vb<iso;
            if(insideA !== insideB){
              pts.push(interp(tetPos[a], tetPos[b], va, vb));
            }
          }
          if(pts.length<3) continue;
          // order points around polygon (3 or 4)
          // compute center
          let cx=0, cy=0, cz=0;
          for(const p of pts){ cx+=p[0]; cy+=p[1]; cz+=p[2]; }
          cx/=pts.length; cy/=pts.length; cz/=pts.length;
          // estimate normal as average of tetra face normal? Compute via first triangle
          let nx0=0,ny0=0,nz0=0;
          if(pts.length>=3){
            const a=pts[0], b=pts[1], c=pts[2];
            const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
            const ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
            nx0=ab[1]*ac[2]-ab[2]*ac[1];
            ny0=ab[2]*ac[0]-ab[0]*ac[2];
            nz0=ab[0]*ac[1]-ab[1]*ac[0];
            const l=Math.hypot(nx0,ny0,nz0)||1; nx0/=l; ny0/=l; nz0/=l;
            // ensure normal points outward (from inside to outside). For consistent winding, we can flip if center+normal is more inside than center-normal
            // Sample SDF at center +/- normal*eps; flip if needed (heuristic)
          }
          if(pts.length===3){
            // single triangle — ensure winding outward: compute dot with (a - inside centroid)
            // inside centroid approx average of inside vertices
            let ix=0,iy=0,iz=0, ic=0;
            for(let i=0;i<4;i++) if(tetVals[i]<iso){ ix+=tetPos[i][0]; iy+=tetPos[i][1]; iz+=tetPos[i][2]; ic++; }
            if(ic>0){ ix/=ic; iy/=ic; iz/=ic;
              const toTri=[pts[0][0]-ix, pts[0][1]-iy, pts[0][2]-iz];
              const dot=toTri[0]*nx0+toTri[1]*ny0+toTri[2]*nz0;
              if(dot<0){ pts.reverse(); nx0*=-1; ny0*=-1; nz0*=-1; }
            }
            positions.push(...pts[0],...pts[1],...pts[2]);
            normals.push(nx0,ny0,nz0, nx0,ny0,nz0, nx0,ny0,nz0);
            indices.push(indexOffset,indexOffset+1,indexOffset+2);
            indexOffset+=3;
          }else if(pts.length===4){
            // order 4 points cyclically around normal
            // build basis: find two orthogonal axes in plane
            // pick vector from center to first point
            // create tangent/binormal
            let ux,uy,uz, vx,vy,vz;
            // create arbitrary basis perpendicular to normal
            if(Math.abs(nx0)<0.9){ ux=1; uy=0; uz=0; } else { ux=0; uy=0; uz=1; }
            // ux = ux - dot(ux,n)*n
            let d=ux*nx0+uy*ny0+uz*nz0;
            ux-=d*nx0; uy-=d*ny0; uz-=d*nz0;
            let ul=Math.hypot(ux,uy,uz)||1; ux/=ul; uy/=ul; uz/=ul;
            // v = n x u
            vx=ny0*uz - nz0*uy; vy=nz0*ux - nx0*uz; vz=nx0*uy - ny0*ux;
            // angle sort
            const angs=pts.map(p=>{
              const dx=p[0]-cx, dy=p[1]-cy, dz=p[2]-cz;
              const x=dx*ux+dy*uy+dz*uz;
              const y=dx*vx+dy*vy+dz*vz;
              return Math.atan2(y,x);
            });
            const order=[0,1,2,3].sort((a,b)=>angs[a]-angs[b]);
            const ordered=order.map(i=>pts[i]);
            // fan triangulation: (0,1,2) and (0,2,3)
            // decide flip already done via pts reverse before sort? Need to handle consistent winding per tetra
            // recompute winding check using ordered first triangle
            const a=ordered[0], b=ordered[1], c=ordered[2];
            const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
            const ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
            let nn=[ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
            const l=Math.hypot(nn[0],nn[1],nn[2])||1; nn=[nn[0]/l,nn[1]/l,nn[2]/l];
            let insideX=0,insideY=0,insideZ=0,ic=0;
            for(let i=0;i<4;i++) if(tetVals[i]<iso){ insideX+=tetPos[i][0]; insideY+=tetPos[i][1]; insideZ+=tetPos[i][2]; ic++; }
            if(ic>0){
              insideX/=ic; insideY/=ic; insideZ/=ic;
              const dot=(ordered[0][0]-insideX)*nn[0]+(ordered[0][1]-insideY)*nn[1]+(ordered[0][2]-insideZ)*nn[2];
              if(dot<0){ ordered.reverse(); nn=[-nn[0],-nn[1],-nn[2]]; }
            }
            // first tri
            positions.push(...ordered[0],...ordered[1],...ordered[2]);
            normals.push(...nn,...nn,...nn);
            indices.push(indexOffset,indexOffset+1,indexOffset+2); indexOffset+=3;
            // second tri
            positions.push(...ordered[0],...ordered[2],...ordered[3]);
            normals.push(...nn,...nn,...nn);
            indices.push(indexOffset,indexOffset+1,indexOffset+2); indexOffset+=3;
          }
        }
      }
    }
  }
  return {positions:new Float32Array(positions), normals:new Float32Array(normals), indices: indices.length? new Uint32Array(indices):new Uint32Array(0)};
}

export class TerraRenderer {
  constructor(canvas, volume){
    this.canvas=canvas;
    this.volume=volume;
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x0a0c0e);
    this.scene.fog=new THREE.Fog(0x0a0c0e, 32, 78);
    this.renderer=new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.9));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.08;
    this.camera=new THREE.PerspectiveCamera(56, 1, 0.1, 220);
    this.camera.position.set(19,13,19);
    this.controls=new OrbitControls(this.camera, canvas);
    this.controls.target.set(0,2.2,0);
    this.controls.enableDamping=true;
    this.controls.dampingFactor=0.07;
    this.controls.minDistance=3.2;
    this.controls.maxDistance=68;
    this.controls.maxPolarAngle=Math.PI*0.485;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xddeaf5, 0x0a0c0e, 0.58));
    const sun=new THREE.DirectionalLight(0xfff2e0, 1.7);
    sun.position.set(13,23,10);
    sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.near=1; sun.shadow.camera.far=86;
    sun.shadow.camera.left=-27; sun.shadow.camera.right=27; sun.shadow.camera.top=27; sun.shadow.camera.bottom=-27;
    sun.shadow.bias=-0.0006;
    this.sun=sun;
    this.scene.add(sun);
    const fill=new THREE.DirectionalLight(0x8ec8ff, 0.38);
    fill.position.set(-12,13,-15);
    this.scene.add(fill);

    const floor=new THREE.Mesh(new THREE.PlaneGeometry(84,84), new THREE.MeshStandardMaterial({color:0x151e24, roughness:0.93}));
    floor.rotation.x=-Math.PI/2; floor.position.y=-2.92; floor.receiveShadow=true;
    this.scene.add(floor);
    const grid=new THREE.GridHelper(84,42,0x1e2e3a,0x16202a);
    grid.position.y=-2.90; this.scene.add(grid);

    this.terrainMat=new THREE.MeshStandardMaterial({
      color:0xffffff, roughness:0.88, metalness:0.02, vertexColors:true, side:THREE.DoubleSide
    });
    this.terrainMesh=new THREE.Mesh(new THREE.BufferGeometry(), this.terrainMat);
    this.terrainMesh.castShadow=true; this.terrainMesh.receiveShadow=true;
    this.scene.add(this.terrainMesh);

    this.wireMesh=new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:0x00E5CC, transparent:true, opacity:0}));
    this.scene.add(this.wireMesh);

    const pGeo=new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0),3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0),3));
    const pMat=new THREE.PointsMaterial({size:0.20, vertexColors:true, transparent:true, opacity:0.96, sizeAttenuation:true, depthWrite:false});
    pMat.alphaTest=0.01;
    this.particlePoints=new THREE.Points(pGeo,pMat);
    this.scene.add(this.particlePoints);
    this.particleVisible=true;

    this.waterGroup=new THREE.Group(); this.scene.add(this.waterGroup);
    this.waterMesh=null; this.waterMat=null;
    this.showWater=true;
    this.viewMode='solid';

    window.addEventListener('resize',()=>this.resize());
    this.resize();
    this.frame=0; this.lastT=performance.now(); this.fps=0; this.grainSize=0.14;
  }

  resize(){
    const r=this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(r.width,r.height,false);
    this.camera.aspect=r.width/r.height;
    this.camera.updateProjectionMatrix();
  }

  updateVolume(v){ this.volume=v; this.rebuildMesh(); }

  rebuildMesh(){
    if(!this.volume) return;
    const t0=performance.now();
    const {positions,normals,indices}=marchingCubes(this.volume,0);
    const geo=new THREE.BufferGeometry();
    if(positions.length===0){ this.terrainMesh.geometry=geo; return {vertexCount:0,time:0}; }
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals,3));
    geo.setIndex(new THREE.BufferAttribute(indices,1));
    const colors=new Float32Array(positions.length);
    for(let i=0;i<positions.length;i+=3){
      const y=positions[i+1], ny=Math.abs(normals[i+1]);
      const band=0.5+0.5*Math.sin(y*3.6);
      let r=0.46,g=0.24,b=0.12;
      r+=band*0.15; g+=band*0.06;
      const top=smoothStep(0.55,0.97,ny);
      r=mix(r,0.64, top*0.38); g=mix(g,0.37, top*0.38); b=mix(b,0.19, top*0.38);
      const ao=0.90+Math.random()*0.10;
      colors[i]=r*ao; colors[i+1]=g*ao; colors[i+2]=b*ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    this.terrainMesh.geometry.dispose();
    this.terrainMesh.geometry=geo;
    const wireGeo=new THREE.WireframeGeometry(geo);
    this.wireMesh.geometry.dispose();
    this.wireMesh.geometry=wireGeo;
    return {vertexCount:positions.length/3,time:performance.now()-t0};
  }

  updateParticles(arr){
    if(!this.particleVisible){ this.particlePoints.visible=false; return; }
    this.particlePoints.visible=true;
    const N=arr.length/4;
    const pos=new Float32Array(N*3), col=new Float32Array(N*3);
    let j=0;
    for(let i=0;i<N;i++){
      const x=arr[i*4], y=arr[i*4+1], z=arr[i*4+2], v=arr[i*4+3];
      if(v<-0.5) continue;
      pos[j*3]=x; pos[j*3+1]=y; pos[j*3+2]=z;
      const load=clamp(v*0.11,0,1);
      if(load<0.025){ col[j*3]=0.32; col[j*3+1]=0.74; col[j*3+2]=1.0; }
      else if(load<0.50){ col[j*3]=0.88-load*0.32; col[j*3+1]=0.67-load*0.22; col[j*3+2]=0.30; }
      else { col[j*3]=0.60+load*0.12; col[j*3+1]=0.53; col[j*3+2]=0.40; }
      j++;
    }
    const geo=this.particlePoints.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0,j*3),3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.slice(0,j*3),3));
    geo.attributes.position.needsUpdate=true;
    geo.attributes.color.needsUpdate=true;
    geo.setDrawRange(0,j);
    this.particlePoints.material.size=clamp(0.13+(this.grainSize||0.14)*1.3,0.11,0.34);
  }

  updateWater(path, params={}){
    if(!path || path.length<2 || !this.showWater){
      if(this.waterMesh) this.waterMesh.visible=false;
      return;
    }
    if(this.waterMesh) this.waterMesh.visible=true;
    const width=params.width||3.2;
    const half=width*0.5;
    const verts=[], uvs=[], indices=[];
    const nseg=path.length;
    for(let i=0;i<nseg;i++){
      const p=path[i];
      const prev=path[Math.max(0,i-1)], next=path[Math.min(nseg-1,i+1)];
      const tx=next[0]-prev[0], tz=next[2]-prev[2];
      const len=Math.hypot(tx,tz)||1;
      const nx=-tz/len, nz=tx/len;
      const y=params.waterLevel || 1.05;
      verts.push(p[0]+nx*half, y, p[2]+nz*half);
      verts.push(p[0]-nx*half, y, p[2]-nz*half);
      const along=i/(nseg-1);
      uvs.push(0, along*6);
      uvs.push(1, along*6);
    }
    for(let i=0;i<nseg-1;i++){
      const a=i*2, b=a+1, c=a+2, d=a+3;
      indices.push(a,c,b, b,c,d);
    }
    if(!this.waterMesh){
      const geo=new THREE.BufferGeometry();
      this.waterMat=new THREE.ShaderMaterial({
        uniforms:{
          time:{value:0},
          flowSpeed:{value: params.speed||2.8},
          baseColor:{value:new THREE.Color(0x0f5b6b)},
          foamColor:{value:new THREE.Color(0xe6f2f7)},
          waveAmp:{value:0.13},
        },
        vertexShader:`
          uniform float time; uniform float flowSpeed; uniform float waveAmp;
          varying vec2 vUv; varying vec3 vWorld; varying float vFoam;
          void main(){
            vUv=uv;
            vec3 pos=position;
            float along = uv.y*6.0 - time*flowSpeed*0.36;
            float across = uv.x*12.0;
            float w1 = sin(along*1.18 + across*0.28)*waveAmp;
            float w2 = sin(along*2.65 - across*0.68 + time*1.08)*waveAmp*0.46;
            float w3 = sin(across*4.2 + time*0.72)*waveAmp*0.18;
            pos.y += w1 + w2 + w3;
            float bank = abs(uv.x-0.5)*2.0;
            vFoam = smoothstep(0.66,0.96,bank)*(0.58+0.42*sin(along*3.0));
            vec4 world = modelMatrix * vec4(pos,1.0);
            vWorld=world.xyz;
            gl_Position=projectionMatrix*viewMatrix*world;
          }
        `,
        fragmentShader:`
          uniform vec3 baseColor; uniform vec3 foamColor; uniform float time;
          varying vec2 vUv; varying vec3 vWorld; varying float vFoam;
          void main(){
            vec3 c=baseColor;
            float flow = fract(vUv.y*0.92 - time*0.24);
            float streak = smoothstep(0.0,0.035,flow)*smoothstep(0.075,0.035,flow);
            c += vec3(0.04,0.11,0.09)*streak*0.72;
            float fres = pow(1.0 - max(dot(normalize(vec3(0,1,0)), normalize(cameraPosition - vWorld)),0.0), 3.4);
            c = mix(c, vec3(0.66,0.86,0.93), fres*0.44);
            vec3 lightDir = normalize(vec3(0.58,0.84,0.42));
            vec3 viewDir = normalize(cameraPosition - vWorld);
            vec3 h = normalize(lightDir + viewDir);
            float spec = pow(max(dot(h, vec3(0,1,0)),0.0), 180.0);
            c += vec3(1.0,0.94,0.77)*spec*0.58;
            float crest = smoothstep(0.03,0.11, abs(sin(vUv.y*18.0 + time*2.2))*0.5);
            float foam = max(vFoam*0.92, crest*0.24);
            c = mix(c, foamColor, clamp(foam,0.0,1.0));
            float bankDark = smoothstep(0.5,1.0, abs(vUv.x-0.5)*2.0)*0.13;
            c -= bankDark;
            gl_FragColor=vec4(c, 0.93);
          }
        `,
        transparent:true, side:THREE.DoubleSide
      });
      this.waterMesh=new THREE.Mesh(geo, this.waterMat);
      this.waterGroup.add(this.waterMesh);
    } else {
      const geo=this.waterMesh.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts),3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs),2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
    }
  }

  setWaterVisible(v){ this.showWater=v; if(this.waterMesh) this.waterMesh.visible=v; }
  setParticleVisible(v){ this.particleVisible=v; this.particlePoints.visible=v; }
  setViewMode(m){
    this.viewMode=m;
    if(m==='xray'){ this.terrainMat.transparent=true; this.terrainMat.opacity=0.44; this.wireMesh.material.opacity=0.32; }
    else { this.terrainMat.transparent=false; this.terrainMat.opacity=1; this.wireMesh.material.opacity=0; }
  }
  setWireVisible(v){ this.wireMesh.material.opacity=v?0.34:0; }

  animate(){
    requestAnimationFrame(()=>this.animate());
    const now=performance.now();
    const dt=(now-this.lastT)/1000; this.lastT=now;
    this.frame++;
    if(this.frame%12===0) this.fps=Math.round(1/dt);
    this.controls.update();
    if(this.waterMat) this.waterMat.uniforms.time.value=now*0.001;
    const az=((Math.atan2(this.camera.position.x, this.camera.position.z)*180/Math.PI)+360)%360;
    const el=90 - (Math.acos(clamp(this.camera.position.y/this.camera.position.length(),-1,1))*180/Math.PI);
    const ci=document.getElementById('cam-info'); if(ci) ci.textContent=`Az ${az|0}° · El ${el|0}°`;
    const f=document.getElementById('stat-fps'); if(f) f.textContent=this.fps;
    this.renderer.render(this.scene,this.camera);
  }
}
function mix(a,b,t){return a+(b-a)*t}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function smoothStep(a,b,x){ x=clamp((x-a)/(b-a),0,1); return x*x*(3-2*x); }

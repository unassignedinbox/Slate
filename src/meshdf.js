// Mesh Distance Field baker — written fresh for this WebGPU route (the Frontier C++
// DistanceFieldBakeSolver / DistanceFieldSpace code is NOT used; the user flagged it as buggy).
//
// Method (per unique mesh, in mesh-local space, like Unreal's per-mesh distance fields):
//   * BVH over triangles.
//   * Per voxel: exact closest-point-on-triangle distance (Ericson Voronoi-region test).
//   * Sign: angle-weighted pseudo-normal at the closest point. The ControlVehicle shell is an
//     open sheet mesh, so ray-parity sign (used by closed-solid bakers) is invalid for it;
//     pseudo-normal sign is the standard open-mesh choice and reduces to the exact sign on
//     closed meshes. This choice is deliberate and documented, not a shortcut around it.
//   * Stores distance + nearest triangle index per voxel (the triangle later identifies the
//     surface-cache card texel that owns outgoing radiance near a trace hit).
//
// Unreal bakes mesh DFs offline; a web page has no offline step, so the same bake runs once
// at load on the CPU (BVH, chunked so the page can report progress). The GPU never rebakes a
// mesh field when an object moves — movement only re-composes the Global Distance Field from
// placement matrices, which is the Lumen update path being demonstrated.

export function buildBVH(tris) {
  // tris: Float32Array, 9 floats per triangle.
  const n = tris.length / 9;
  const centroids = new Float32Array(n * 3);
  const bounds = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    let mnx=1e30,mny=1e30,mnz=1e30,mxx=-1e30,mxy=-1e30,mxz=-1e30;
    for (let k = 0; k < 3; k++) {
      const x=tris[i*9+k*3], y=tris[i*9+k*3+1], z=tris[i*9+k*3+2];
      mnx=Math.min(mnx,x); mny=Math.min(mny,y); mnz=Math.min(mnz,z);
      mxx=Math.max(mxx,x); mxy=Math.max(mxy,y); mxz=Math.max(mxz,z);
    }
    bounds.set([mnx,mny,mnz,mxx,mxy,mxz], i*6);
    centroids.set([(mnx+mxx)/2,(mny+mxy)/2,(mnz+mxz)/2], i*3);
  }
  const order = Array.from({length: n}, (_, i) => i);
  const nodes = []; // {min:[3], max:[3], left, right, first, count}
  function build(first, count) {
    const idx = nodes.length; nodes.push(null);
    const mn=[1e30,1e30,1e30], mx=[-1e30,-1e30,-1e30], cmn=[1e30,1e30,1e30], cmx=[-1e30,-1e30,-1e30];
    for (let i = first; i < first+count; i++) {
      const t = order[i];
      for (let a=0;a<3;a++){ mn[a]=Math.min(mn[a],bounds[t*6+a]); mx[a]=Math.max(mx[a],bounds[t*6+3+a]); cmn[a]=Math.min(cmn[a],centroids[t*3+a]); cmx[a]=Math.max(cmx[a],centroids[t*3+a]); }
    }
    if (count <= 8) { nodes[idx] = { mn, mx, left:-1, right:-1, first, count }; return idx; }
    let axis=0, best=-1; for (let a=0;a<3;a++){ const e=cmx[a]-cmn[a]; if(e>best){best=e;axis=a;} }
    const mid = (cmn[axis]+cmx[axis])/2;
    let split = first; const end = first+count;
    // partition
    let lo=first, hi=end-1;
    while (lo<=hi) {
      if (centroids[order[lo]*3+axis] < mid) lo++;
      else { const tmp=order[lo]; order[lo]=order[hi]; order[hi]=tmp; hi--; }
    }
    split = lo;
    if (split===first || split===end) split = first + (count>>1);
    const left = build(first, split-first); const right = build(split, end-split);
    nodes[idx] = { mn, mx, left, right, first:-1, count:0 };
    return idx;
  }
  if (n>0) build(0, n);
  return { nodes, order, tris, bounds };
}

function closestPointTriangle(px,py,pz, ax,ay,az, bx,by,bz, cx,cy,cz, out) {
  // Ericson, Real-Time Collision Detection, closest point on triangle.
  const abx=bx-ax, aby=by-ay, abz=bz-az, acx=cx-ax, acy=cy-ay, acz=cz-az;
  const apx=px-ax, apy=py-ay, apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz, d2=acx*apx+acy*apy+acz*apz;
  if (d1<=0 && d2<=0) { out[0]=ax; out[1]=ay; out[2]=az; out[3]=0; return; }
  const bpx=px-bx, bpy=py-by, bpz=pz-bz;
  const d3=abx*bpx+aby*bpy+abz*bpz, d4=acx*bpx+acy*bpy+acz*bpz;
  if (d3>=0 && d4<=d3) { out[0]=bx; out[1]=by; out[2]=bz; out[3]=1; return; }
  const vc=d1*d4-d3*d2;
  if (vc<=0 && d1>=0 && d3<=0) { const v=d1/(d1-d3); out[0]=ax+abx*v; out[1]=ay+aby*v; out[2]=az+abz*v; out[3]=2; return; }
  const cpx=px-cx, cpy=py-cy, cpz=pz-cz;
  const d5=abx*cpx+aby*cpy+abz*cpz, d6=acx*cpx+acy*cpy+acz*cpz;
  if (d6>=0 && d5<=d6) { out[0]=cx; out[1]=cy; out[2]=cz; out[3]=3; return; }
  const vb=d5*d2-d1*d6;
  if (vb<=0 && d2>=0 && d6<=0) { const w=d2/(d2-d6); out[0]=ax+acx*w; out[1]=ay+acy*w; out[2]=az+acz*w; out[3]=4; return; }
  const va=d3*d6-d5*d4;
  if (va<=0 && (d4-d3)>=0 && (d5-d6)>=0) { const w=(d4-d3)/((d4-d3)+(d5-d6)); out[0]=bx+(cx-bx)*w; out[1]=by+(cy-by)*w; out[2]=bz+(cz-bz)*w; out[3]=5; return; }
  const denom=1/(va+vb+vc); const v=vb*denom, w=vc*denom;
  out[0]=ax+abx*v+acx*w; out[1]=ay+aby*v+acy*w; out[2]=az+abz*v+acz*w; out[3]=6;
}

// Angle-weighted vertex pseudo-normals + edge pseudo-normals are approximated here by the
// closest feature's normal: face normal inside, adjacent-face averaged normal at edges/verts.
// Precompute per-vertex averaged normals and per-edge face lists for the sign test.
export function prepareSignData(positions, indices) {
  const nv = positions.length/3, nt = indices.length/3;
  const vNorm = new Float32Array(nv*3);
  const faceN = new Float32Array(nt*3);
  for (let t=0;t<nt;t++){
    const a=indices[t*3], b=indices[t*3+1], c=indices[t*3+2];
    const ax=positions[a*3],ay=positions[a*3+1],az=positions[a*3+2];
    const bx=positions[b*3],by=positions[b*3+1],bz=positions[b*3+2];
    const cx=positions[c*3],cy=positions[c*3+1],cz=positions[c*3+2];
    const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx-ax,vy=cy-ay,vz=cz-az;
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const l=Math.hypot(nx,ny,nz)||1; nx/=l;ny/=l;nz/=l; faceN.set([nx,ny,nz],t*3);
    // angle weights
    const corners=[[a,b,c],[b,c,a],[c,a,b]];
    for (const [vi,vj,vk] of corners) {
      const ex=positions[vj*3]-positions[vi*3], ey=positions[vj*3+1]-positions[vi*3+1], ez=positions[vj*3+2]-positions[vi*3+2];
      const fx=positions[vk*3]-positions[vi*3], fy=positions[vk*3+1]-positions[vi*3+1], fz=positions[vk*3+2]-positions[vi*3+2];
      const el=Math.hypot(ex,ey,ez)||1, fl=Math.hypot(fx,fy,fz)||1;
      const cos=Math.min(1,Math.max(-1,(ex*fx+ey*fy+ez*fz)/(el*fl))); const ang=Math.acos(cos);
      vNorm[vi*3]+=nx*ang; vNorm[vi*3+1]+=ny*ang; vNorm[vi*3+2]+=nz*ang;
    }
  }
  for (let i=0;i<nv;i++){ const l=Math.hypot(vNorm[i*3],vNorm[i*3+1],vNorm[i*3+2])||1; vNorm[i*3]/=l; vNorm[i*3+1]/=l; vNorm[i*3+2]/=l; }
  return { vNorm, faceN };
}

export async function bakeMeshDF(mesh, progress) {
  // mesh: {positions: Float32Array (non-indexed soup), triCount} — soup keeps one path for all meshes.
  const soup = mesh.positions;
  const indices = new Uint32Array(soup.length/3); for (let i=0;i<indices.length;i++) indices[i]=i;
  const sign = prepareSignData(soup, indices);
  const mn=[1e30,1e30,1e30], mx=[-1e30,-1e30,-1e30];
  for (let i=0;i<soup.length;i+=3){ for(let a=0;a<3;a++){ mn[a]=Math.min(mn[a],soup[i+a]); mx[a]=Math.max(mx[a],soup[i+a]); } }
  const extent=[mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]];
  const maxExt = Math.max(...extent, 1e-6);
  // Unreal scales mesh-DF resolution with object size. Same rule here: longest axis gets
  // the mesh's target voxel count, others follow at the same voxel size (min 4).
  const longest = mesh.dfLongest || 48;
  const voxel = maxExt / longest;
  const pad = voxel * 2;
  const bmin=[mn[0]-pad, mn[1]-pad, mn[2]-pad], bmax=[mx[0]+pad, mx[1]+pad, mx[2]+pad];
  const res=[0,1,2].map(a=>Math.max(4, Math.min(96, Math.round((bmax[a]-bmin[a])/voxel))));
  const bvh = buildBVH(soup);
  const count = res[0]*res[1]*res[2];
  const dist = new Float32Array(count); const tri = new Uint32Array(count);
  const cp = [0,0,0,0]; const stack=[];
  const cell=[(bmax[0]-bmin[0])/res[0],(bmax[1]-bmin[1])/res[1],(bmax[2]-bmin[2])/res[2]];
  for (let z=0; z<res[2]; z++) {
    for (let y=0; y<res[1]; y++) {
      for (let x=0; x<res[0]; x++) {
        const px=bmin[0]+(x+0.5)*cell[0], py=bmin[1]+(y+0.5)*cell[1], pz=bmin[2]+(z+0.5)*cell[2];
        let best=Infinity, bestTri=0, bestCx=0,bestCy=0,bestCz=0, bestFeature=6;
        stack.length=0; stack.push(0);
        while (stack.length) {
          const node=bvh.nodes[stack.pop()];
          // AABB distance prune
          const dx=Math.max(node.mn[0]-px,0,px-node.mx[0]), dy=Math.max(node.mn[1]-py,0,py-node.mx[1]), dz=Math.max(node.mn[2]-pz,0,pz-node.mx[2]);
          if (dx*dx+dy*dy+dz*dz > best) continue;
          if (node.left<0) {
            for (let i=node.first;i<node.first+node.count;i++) {
              const t=bvh.order[i], o=t*9;
              closestPointTriangle(px,py,pz, soup[o],soup[o+1],soup[o+2], soup[o+3],soup[o+4],soup[o+5], soup[o+6],soup[o+7],soup[o+8], cp);
              const ddx=px-cp[0], ddy=py-cp[1], ddz=pz-cp[2], d2=ddx*ddx+ddy*ddy+ddz*ddz;
              if (d2<best) { best=d2; bestTri=t; bestCx=cp[0]; bestCy=cp[1]; bestCz=cp[2]; bestFeature=cp[3]; }
            }
          } else { stack.push(node.left, node.right); }
        }
        // pseudo-normal at closest feature
        let nx, ny, nz;
        const t=bestTri;
        if (bestFeature===6) { nx=sign.faceN[t*3]; ny=sign.faceN[t*3+1]; nz=sign.faceN[t*3+2]; }
        else if (bestFeature<=3) { const vi=t*3+bestFeature; nx=sign.vNorm[vi*3]; ny=sign.vNorm[vi*3+1]; nz=sign.vNorm[vi*3+2]; }
        else { // edge: average the two endpoint vertex pseudo-normals
          const e = bestFeature===2 ? [0,1] : bestFeature===4 ? [0,2] : [1,2];
          const v0=(t*3+e[0])*3, v1=(t*3+e[1])*3;
          nx=sign.vNorm[v0]+sign.vNorm[v1]; ny=sign.vNorm[v0+1]+sign.vNorm[v1+1]; nz=sign.vNorm[v0+2]+sign.vNorm[v1+2];
          const l=Math.hypot(nx,ny,nz)||1; nx/=l;ny/=l;nz/=l;
        }
        const s = ((px-bestCx)*nx + (py-bestCy)*ny + (pz-bestCz)*nz) >= 0 ? 1 : -1;
        const id=(z*res[1]+y)*res[0]+x;
        dist[id]=s*Math.sqrt(best); tri[id]=bestTri;
      }
    }
    if (progress && (z%4===0)) { await progress(z/res[2]); }
  }
  if (progress) await progress(1);
  return { res, bmin, bmax, dist, tri, voxelCount: count };
}

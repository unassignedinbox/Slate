// DriveCourse replica — one definition read by physics (CourseHeight) and geometry
// (EmitCourseTriangles), exactly the contract in Frontier Projects/Project-Drive/Source/DriveCourse.h.
// Metres, +X fwd / +Y left / +Z up. Constants are verbatim from CourseConstants / KerbConstants.
export const CourseConstants = {
  PadHalfExtent: 60, CheckerCell: 4, RampNearX: 9, RampRunX: 6, RampRise: 1.35, RampHalfWidth: 3.2,
  BumpCount: 3, BumpFirstX: -7, BumpSpacingX: -4.5, BumpHeight: 0.11, BumpHalfWidthY: 4, BumpHalfLenX: 0.55,
  ConeCount: 8, ConeRadius: 0.22, ConeHeight: 0.55,
};
export const KerbConstants = { CentreY: 3.20, Height: 0.120, Depth: 0.300, NearX: -14, FarX: 26 };

export const Mat = {
  CheckerLight: 0, CheckerDark: 1, Surround: 2, Ramp: 3, Bump: 4, Cone: 5,
  BodyPaint: 6, VehicleGlass: 7, VehiclePlastic: 8, Tyre: 9, Hub: 10, Brake: 11, VehicleTrim: 12,
  Headlight: 13, Taillight: 14, VehicleDefault: 15, CabinTablet: 16, CabinCluster: 17, CabinLamp: 18, CabinBezel: 19,
  WallRed: 20, WallBlue: 21, WallTeal: 22, Pillar: 23, EmissivePanel: 24, EmissiveStripCyan: 25,
  EmissiveStripWarm: 26, SmallEmissive: 27, DarkFloor: 28,
};

// Materials transcribed from DriveSceneAuthor::AuthorMaterials (linear Rec.709 authored values)
// plus the GI-architecture families of this demo. emissive = colour * luminance.
export const MATERIALS = [];
function defMat(albedo, roughness, metalness, emissive = [0,0,0]) { MATERIALS.push({ albedo, roughness, metalness, emissive }); }
defMat([0.82,0.82,0.84], 0.35, 0);            // 0 Checker light
defMat([0.05,0.05,0.06], 0.35, 0);            // 1 Checker dark
defMat([0.35,0.36,0.38], 0.55, 0);            // 2 Surround
defMat([0.42,0.43,0.45], 0.40, 0);            // 3 Ramp
defMat([0.90,0.72,0.08], 0.45, 0);            // 4 Speed bump
defMat([0.95,0.35,0.05], 0.40, 0);            // 5 Cone
defMat([0.68*0.78,0.80*0.78,0.0], 0.03, 0);   // 6 MetalicCoat * flake headroom 0.78 (clearcoat paint)
defMat([0.04,0.045,0.05], 0.02, 0);           // 7 Glass (smoked; transmission approximated as dark glossy in this route)
defMat([0.012,0.014,0.018], 0.50, 0);         // 8 Plastic
defMat([0.03741,0.03741,0.03741], 0.76087, 0);// 9 Rubber
defMat([0.06,0.22,0.62], 0.22, 1, [0,0.277313*0.12,1.0*0.12]); // 10 rim mag accent + authored emissive lift
defMat([0.30,0.075,0.025], 0.29, 0.82);       // 11 Brake
defMat([0.8,0.8,0.8], 0.50, 0);               // 12 Plastic2 trim
defMat([0.8,0.8,0.8], 0.10, 0, [48.7,48.7,48.7]);        // 13 FrontLight (authored 48.7)
defMat([0.8,0.8,0.8], 0.10, 0, [6.5,0,6.5*0.016442]);   // 14 RearLight (authored 6.5)
defMat([0.8,0.8,0.8], 0.50, 0);               // 15 Material.016 / unassigned
defMat([0.01,0.01,0.012], 0.08, 0, [3,3,3]);  // 16 Cabin tablet
defMat([0.01,0.01,0.012], 0.08, 0, [3.5,3.5,3.5]); // 17 Driver cluster
defMat([0.9,0.9,0.88], 0.30, 0, [2.0,1.86,1.64]);  // 18 Cabin lamp
defMat([0.02,0.02,0.022], 0.70, 0);           // 19 Cabin bezel
defMat([0.55,0.08,0.05], 0.60, 0);            // 20 wall red
defMat([0.05,0.12,0.55], 0.60, 0);            // 21 wall blue
defMat([0.05,0.40,0.32], 0.60, 0);            // 22 wall teal
defMat([0.85,0.65,0.08], 0.50, 0);            // 23 pillar yellow
defMat([0.9,0.9,0.88], 0.40, 0, [5.0,4.8,4.2]);        // 24 overhead emissive panel
defMat([0.1,0.1,0.1], 0.40, 0, [0.4,3.2,3.6]);         // 25 emissive strip cyan
defMat([0.1,0.1,0.1], 0.40, 0, [3.6,2.2,0.7]);         // 26 emissive strip warm
defMat([0.1,0.05,0.1], 0.40, 0, [4.0,0.6,3.4]);        // 27 SMALL emissive (Lumen-Scene culling demo)
defMat([0.16,0.16,0.17], 0.80, 0);            // 28 dark floor

export function withinKerb(x, y) {
  const K = KerbConstants;
  return x >= K.NearX && x <= K.FarX && y >= K.CentreY && y <= K.CentreY + K.Depth;
}
// Verbatim heightfield logic from DriveCourse.h CourseHeight().
export function courseHeight(x, y) {
  const C = CourseConstants;
  if (withinKerb(x, y)) return KerbConstants.Height;
  if (x >= C.RampNearX && x <= C.RampNearX + C.RampRunX && Math.abs(y) <= C.RampHalfWidth)
    return C.RampRise * (x - C.RampNearX) / C.RampRunX;
  if (Math.abs(y) <= C.BumpHalfWidthY) {
    let z = 0;
    for (let i = 0; i < C.BumpCount; i++) {
      const cx = C.BumpFirstX + i * C.BumpSpacingX; const d = x - cx;
      if (Math.abs(d) < C.BumpHalfLenX) z += C.BumpHeight * 0.5 * (1 + Math.cos(Math.PI * d / C.BumpHalfLenX));
    }
    return z;
  }
  return 0;
}
export function coneOrigin(k) {
  return [18 + k * 5, (k & 1) ? -2.4 : 2.4];
}

// ---- triangle emission (same shapes as EmitCourseTriangles, split per feature so each
// feature is its own Lumen Scene placement with its own mesh distance field) ----
export function buildCourseMeshes() {
  const meshes = { checker: { positions: [], materials: [] }, ramp: { positions: [], materials: [] },
                   bumps: { positions: [], materials: [] }, cones: { positions: [], materials: [] } };
  const quad = (m, a,b,c,d, mat) => { m.positions.push(...a,...b,...c, ...a,...c,...d); m.materials.push(mat, mat); };
  const tri = (m, a,b,c, mat) => { m.positions.push(...a,...b,...c); m.materials.push(mat); };
  const C = CourseConstants;
  { // checker pad
    const m = meshes.checker, H = C.PadHalfExtent, cell = C.CheckerCell, N = Math.round((2*H)/cell);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x0=-H+i*cell, x1=x0+cell, y0=-H+j*cell, y1=y0+cell;
      quad(m, [x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0], ((i+j)&1) ? Mat.CheckerDark : Mat.CheckerLight);
    }
  }
  { // ramp wedge: sloped top, far face, two side walls
    const m = meshes.ramp, n = C.RampNearX, f = C.RampNearX + C.RampRunX, r = C.RampRise, w = C.RampHalfWidth;
    quad(m, [n,-w,0],[n,w,0],[f,w,r],[f,-w,r], Mat.Ramp);
    quad(m, [f,-w,r],[f,w,r],[f,w,0],[f,-w,0], Mat.Ramp);
    tri(m, [n,-w,0],[f,-w,r],[f,-w,0], Mat.Ramp);
    tri(m, [n,w,0],[f,w,0],[f,w,r], Mat.Ramp);
    quad(m, [n,-w,0],[f,-w,0],[f,w,0],[n,w,0], Mat.Ramp); // underside closes the solid for the field
  }
  { // speed bumps
    const m = meshes.bumps;
    for (let b = 0; b < C.BumpCount; b++) {
      const cx = C.BumpFirstX + b * C.BumpSpacingX, arc = 10;
      for (let s = 0; s < arc; s++) {
        const t0=-C.BumpHalfLenX+(2*C.BumpHalfLenX)*(s/arc), t1=-C.BumpHalfLenX+(2*C.BumpHalfLenX)*((s+1)/arc);
        const z0=C.BumpHeight*0.5*(1+Math.cos(Math.PI*t0/C.BumpHalfLenX)), z1=C.BumpHeight*0.5*(1+Math.cos(Math.PI*t1/C.BumpHalfLenX));
        quad(m, [cx+t0,-C.BumpHalfWidthY,z0],[cx+t1,-C.BumpHalfWidthY,z1],[cx+t1,C.BumpHalfWidthY,z1],[cx+t0,C.BumpHalfWidthY,z0], Mat.Bump);
      }
    }
  }
  { // one cone (shared mesh, 8 placements)
    const m = meshes.cones, seg = 14;
    for (let s = 0; s < seg; s++) {
      const a0=(2*Math.PI*s)/seg, a1=(2*Math.PI*(s+1))/seg;
      const x0=C.ConeRadius*Math.cos(a0), y0=C.ConeRadius*Math.sin(a0), x1=C.ConeRadius*Math.cos(a1), y1=C.ConeRadius*Math.sin(a1);
      tri(m, [x0,y0,0],[x1,y1,0],[0,0,C.ConeHeight], Mat.Cone);
      tri(m, [x1,y1,0],[x0,y0,0],[0,0,0], Mat.Cone);
    }
  }
  return meshes;
}

// Closed unit-box triangle soup centred at origin (shared shape for walls/pillars/kerb/cubes).
export function buildBoxMesh(material) {
  const h = 0.5, positions = [], materials = [];
  const faces = [
    [[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h]], [[h,-h,-h],[-h,-h,-h],[-h,h,-h],[h,h,-h]],
    [[h,-h,h],[h,-h,-h],[h,h,-h],[h,h,h]], [[-h,-h,-h],[-h,-h,h],[-h,h,h],[-h,h,-h]],
    [[-h,h,h],[h,h,h],[h,h,-h],[-h,h,-h]], [[-h,-h,-h],[h,-h,-h],[h,-h,h],[-h,-h,h]],
  ];
  for (const f of faces) { positions.push(...f[0],...f[1],...f[2], ...f[0],...f[2],...f[3]); materials.push(material, material); }
  return { positions, materials };
}

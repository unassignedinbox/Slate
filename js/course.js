//============================================================================================================================================
//                                                               COURSE.JS
//============================================================================================================================================
// 📦 Faithful JavaScript port of Projects/Project-Drive/Source/DriveCourse.h (Frontier- @ arena/4f07c82a-frontier).
//    It keeps the host's ONE-definition rule: the SAME functions answer the tyre ground query (courseHeight /
//    courseNormal) and emit the triangles the renderer draws (emitCourseTriangles), so wheels rest exactly on
//    the surface the SDF GI pipeline lights.
//
//    Layout (metres, +X fwd / +Y left / +Z up), identical to DriveCourse.h CourseConstants:
//      flat CHECKER pad · RAMP 9 m ahead (6 m run, 1.35 m crest) · three rounded SPEED BUMPS behind ·
//      8-cone slalom (x = 18 + 5k, y = ±2.4 alternating) · a real-walled KERB along the slalom side.

export const Course = {
  PadHalfExtent: 60.0,
  CheckerCell: 4.0,
  RampNearX: 9.0,
  RampRunX: 6.0,
  RampRise: 1.35,
  RampHalfWidth: 3.2,
  BumpCount: 3,
  BumpFirstX: -7.0,
  BumpSpacingX: -4.5,
  BumpHeight: 0.11,
  BumpHalfWidthY: 4.0,
  BumpHalfLenX: 0.55,
  ConeCount: 8,
  ConeRadius: 0.22,
  ConeHeight: 0.55,
  Kerb: { CentreY: 3.20, Height: 0.120, Depth: 0.300, NearX: -14.0, FarX: 26.0 },
};

// Material family ids — same numeric space as DriveCourse.h CourseMaterial.
export const Mat = {
  CheckerLight: 0, CheckerDark: 1, Surround: 2, Ramp: 3, Bump: 4, Cone: 5,
  BodyPaint: 6, Glass: 7, Plastic: 8, Tyre: 9, Hub: 10, Brake: 11, Trim: 12,
  Headlight: 13, Taillight: 14, Default: 15,
};

export function withinKerb(x, y) {
  const K = Course.Kerb;
  return x >= K.NearX && x <= K.FarX && y >= K.CentreY && y <= K.CentreY + K.Depth;
}

export function bumpHeightAt(x) {
  const C = Course;
  let z = 0;
  for (let i = 0; i < C.BumpCount; i++) {
    const cx = C.BumpFirstX + i * C.BumpSpacingX;
    const d = x - cx;
    if (Math.abs(d) < C.BumpHalfLenX)
      z += C.BumpHeight * 0.5 * (1.0 + Math.cos(Math.PI * d / C.BumpHalfLenX));
  }
  return z;
}

// Tyre ground query — verbatim semantics of DriveCourse.h CourseHeight(). Chassis + tyre code calls only this.
export function courseHeight(x, y) {
  const C = Course;
  if (withinKerb(x, y)) return C.Kerb.Height;
  if (x >= C.RampNearX && x <= C.RampNearX + C.RampRunX && Math.abs(y) <= C.RampHalfWidth)
    return C.RampRise * (x - C.RampNearX) / C.RampRunX;
  if (Math.abs(y) <= C.BumpHalfWidthY) return bumpHeightAt(x);
  return 0.0;
}

// Unit surface normal by central differences — DriveCourse.h CourseNormal().
export function courseNormal(x, y, e = 0.15) {
  const hx = (courseHeight(x + e, y) - courseHeight(x - e, y)) / (2 * e);
  const hy = (courseHeight(x, y + e) - courseHeight(x, y - e)) / (2 * e);
  const l = Math.hypot(hx, hy, 1) || 1;
  return [-hx / l, -hy / l, 1 / l];
}

export function coneOrigin(k) {
  return [18.0 + k * 5.0, (k & 1) ? -2.4 : 2.4];
}

//--------------------------------------------------------------------------------------------------------------------------------------------
// emitCourseTriangles() — render-side twin of the physics query. Pushes
// (ax,ay,az, bx,by,bz, cx,cy,cz, family) into `add`, exactly as the reference emitter does: surround plane,
// kerb box, checker pad (bump cells displaced to the live height function so drawn mesh and tyre query match
// per-vertex, not just per formula), ramp wedge, slalom cones.
//--------------------------------------------------------------------------------------------------------------------------------------------
export function emitCourseTriangles(add) {
  const C = Course;

  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, m) => {
    add(ax, ay, az, bx, by, bz, cx, cy, cz, m);
    add(ax, ay, az, cx, cy, cz, dx, dy, dz, m);
  };

  // ── surround plane under everything (slight depression so the pad rim is visible) ──
  const G = C.PadHalfExtent * 4.0;
  quad(-G, -G, -0.02, G, -G, -0.02, G, G, -0.02, -G, G, -0.02, Mat.Surround);

  // ── kerb — a drawn box with a genuine VERTICAL inner face (lateral contact test surface) ──
  {
    const K = C.Kerb, Y0 = K.CentreY, Y1 = K.CentreY + K.Depth, H = K.Height;
    quad(K.NearX, Y0, H, K.FarX, Y0, H, K.FarX, Y1, H, K.NearX, Y1, H, Mat.Surround | 0x8000);  // top
    quad(K.NearX, Y0, 0, K.FarX, Y0, 0, K.FarX, Y0, H, K.NearX, Y0, H, Mat.Surround | 0x8000);  // inner face
    quad(K.FarX, Y1, 0, K.NearX, Y1, 0, K.NearX, Y1, H, K.FarX, Y1, H, Mat.Surround | 0x8000);  // outer face
    quad(K.NearX, Y1, 0, K.NearX, Y0, 0, K.NearX, Y0, H, K.NearX, Y1, H, Mat.Surround | 0x8000);  // near cap
    quad(K.FarX, Y0, 0, K.FarX, Y1, 0, K.FarX, Y1, H, K.FarX, Y0, H, Mat.Surround | 0x8000);  // far cap
  }

  // ── checker pad (cells aligned on 4 m grid; bump cells tessellated to the height function) ──
  const H = C.PadHalfExtent, cell = C.CheckerCell;
  const n = Math.round((2 * H) / cell);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = -H + i * cell, y0 = -H + j * cell;
      const m = ((i + j) & 1) ? Mat.CheckerDark : Mat.CheckerLight;
      // Does this cell cross a rounded speed bump crest region?
      let bump = false;
      if (Math.abs((y0 + y0 + cell) / 2) <= C.BumpHalfWidthY && Math.abs(y0) < C.BumpHalfWidthY + cell) {
        for (let k = 0; k < C.BumpCount; k++) {
          const cx = C.BumpFirstX + k * C.BumpSpacingX;
          if (x0 < cx + C.BumpHalfLenX + cell && x0 + cell > cx - C.BumpHalfLenX - cell) { bump = true; break; }
        }
      }
      if (!bump) {
        quad(x0, y0, 0, x0 + cell, y0, 0, x0 + cell, y0 + cell, 0, x0, y0 + cell, 0, m);
      } else {
        // 4×4 sub-quads snapped to courseHeight so the bump silhouette reads in the distance field.
        const s = 4, ds = cell / s;
        for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) {
          const sx0 = x0 + a * ds, sy0 = y0 + b * ds, sx1 = sx0 + ds, sy1 = sy0 + ds;
          quad(sx0, sy0, courseHeight(sx0, sy0), sx1, sy0, courseHeight(sx1, sy0),
            sx1, sy1, courseHeight(sx1, sy1), sx0, sy1, courseHeight(sx0, sy1), Mat.Bump);
        }
      }
    }
  }

  // ── ramp wedge (a launch, not a heightfield discontinuity, from the GI side too) ──
  {
    const x0 = C.RampNearX, x1 = C.RampNearX + C.RampRunX, y0 = -C.RampHalfWidth, y1 = C.RampHalfWidth, h = C.RampRise;
    quad(x0, y0, 0, x1, y0, h, x1, y1, h, x0, y1, 0, Mat.Ramp);   // deck
    add(x1, y0, 0, x1, y0, h, x1, y1, h, Mat.Ramp);               // back... left+right gables
    add(x1, y0, 0, x1, y1, h, x1, y1, 0, Mat.Ramp);
    add(x0, y0, 0, x1, y0, 0, x1, y0, h, Mat.Ramp);               // left gable
    add(x0, y1, 0, x1, y1, h, x1, y1, 0, Mat.Ramp);               // right gable
  }

  // ── slalom cones (14-segment pyramids with closed bases, ConeOrigin order preserved) ──
  for (let k = 0; k < C.ConeCount; k++) {
    const [bx, by] = coneOrigin(k);
    const seg = 14;
    for (let s = 0; s < seg; s++) {
      const a0 = (2 * Math.PI * s) / seg, a1 = (2 * Math.PI * (s + 1)) / seg;
      const x0 = bx + C.ConeRadius * Math.cos(a0), y0 = by + C.ConeRadius * Math.sin(a0);
      const x1 = bx + C.ConeRadius * Math.cos(a1), y1 = by + C.ConeRadius * Math.sin(a1);
      add(x0, y0, 0.0, x1, y1, 0.0, bx, by, C.ConeHeight, Mat.Cone);   // side
      add(x1, y1, 0.0, x0, y0, 0.0, bx, by, 0.0, Mat.Cone);            // base
    }
  }
}

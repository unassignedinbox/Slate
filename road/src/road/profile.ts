/**
 * Road cross sections.
 *
 * A profile is an ordered list of points across the road, left verge to right
 * verge, given as (lateral offset u in metres, height h above the carriageway
 * datum). Extruding it along a centreline gives quad strips by construction -
 * there is no triangulation step anywhere in the carriageway, which is how the
 * topology stays clean.
 *
 * Geometry follows normal urban design practice: 3.0-3.65 m lanes, 125-150 mm
 * kerb upstand, 2.5 % carriageway crossfall to the channel, 2 % back-fall on
 * the footway, and a 300 mm kerb-and-channel gutter.
 */

export const MAT = {
  ASPHALT: 0,
  GUTTER: 1,
  KERB_FACE: 2,
  FOOTWAY: 3,
  VERGE: 4,
  SHOULDER: 5,
  MEDIAN: 6,
  KERB_TOP: 7,
} as const;

export interface ProfilePoint {
  /** lateral offset from the centreline, metres, +ve to the right */
  u: number;
  /** height above the carriageway datum, metres */
  h: number;
  /** material of the span running from this point to the next */
  mat: number;
  /** extra subdivisions inside that span (0 = a single quad across) */
  div: number;
  /** hard crease: do not average normals across this point */
  crease: boolean;
}

export interface Profile {
  id: string;
  label: string;
  pts: ProfilePoint[];
  /** half width of the trafficked surface, kerb to kerb */
  carriageHalf: number;
  /** total half width including footways */
  totalHalf: number;
  /** lane centres as signed offsets, negative = left-hand side of centreline */
  laneOffsets: number[];
  /** kerb upstand */
  kerbH: number;
  /** design kerb radius at junctions */
  kerbRadius: number;
  /** lanes each way */
  lanes: number;
  laneWidth: number;
  footway: number;
}

const P = (u: number, h: number, mat: number, div = 0, crease = false): ProfilePoint =>
  ({ u, h, mat, div, crease });

export interface ProfileOpts {
  lanes?: number;        // per direction
  laneWidth?: number;
  footway?: number;      // 0 = no footway (rural / motorway)
  kerb?: number;         // upstand, 0 = flush shoulder
  median?: number;       // central reservation width, 0 = none
  shoulder?: number;     // hard shoulder width
  crossfall?: number;    // fraction
  kerbRadius?: number;
}

/**
 * Build a symmetric profile. Everything downstream (meshing, junctions, lane
 * graph for traffic) reads the numbers off this, so a new road type is a few
 * parameters rather than new code.
 */
export function makeProfile(id: string, label: string, o: ProfileOpts = {}): Profile {
  const lanes = o.lanes ?? 1;
  const lw = o.laneWidth ?? 3.5;
  const fw = o.footway ?? 2.4;
  const kerbH = o.kerb ?? 0.14;
  const median = o.median ?? 0;
  const shoulder = o.shoulder ?? 0;
  const cf = o.crossfall ?? 0.025;
  const gutter = 0.3;

  const half = lanes * lw + median / 2 + shoulder;
  // crossfall is measured across the trafficked width, channel to crown
  const carrW = Math.max(0.5, half - gutter - median / 2);
  const crown = carrW * cf;
  // NB: `div` subdivides the span that STARTS at the point carrying it, so it
  // has to sit on the point at the near end of each span, not the far end.
  const carrDiv = Math.max(1, Math.round(carrW / 1.3));
  const fwDiv = Math.max(1, Math.round(fw / 1.2));
  const medDiv = Math.max(1, Math.round(median / 1.5));

  const pts: ProfilePoint[] = [];

  // ---- left verge / footway down to the channel
  if (fw > 0) {
    pts.push(P(-(half + fw), kerbH + fw * 0.02, MAT.FOOTWAY, fwDiv, true));
    pts.push(P(-half, kerbH, MAT.KERB_FACE, 0, true));
    pts.push(P(-half, 0.0, MAT.GUTTER, 0, true));
  } else if (shoulder > 0) {
    pts.push(P(-(half + 1.6), -0.35, MAT.VERGE, 2, true));
    pts.push(P(-half, 0.0, MAT.SHOULDER, 0, true));
  } else {
    pts.push(P(-(half + 0.9), -0.08, MAT.VERGE, 1, true));
    pts.push(P(-half, 0.0, MAT.ASPHALT, 0, true));
  }
  pts.push(P(-half + gutter, -0.012, MAT.ASPHALT, carrDiv, true));   // channel invert

  if (median > 0) {
    pts.push(P(-median / 2, crown, MAT.KERB_FACE, 0, false));        // median kerb, vertical
    pts.push(P(-median / 2, crown + kerbH, MAT.MEDIAN, medDiv, true));
    pts.push(P(median / 2, crown + kerbH, MAT.KERB_FACE, 0, true));
    pts.push(P(median / 2, crown, MAT.ASPHALT, carrDiv, true));
  } else {
    pts.push(P(0, crown, MAT.ASPHALT, carrDiv, false));              // crown
  }

  // ---- right half, mirrored
  pts.push(P(half - gutter, -0.012, MAT.GUTTER, 0, true));
  if (fw > 0) {
    pts.push(P(half, 0.0, MAT.KERB_FACE, 0, true));
    pts.push(P(half, kerbH, MAT.FOOTWAY, fwDiv, true));
    pts.push(P(half + fw, kerbH + fw * 0.02, MAT.FOOTWAY, 0, true));
  } else if (shoulder > 0) {
    pts.push(P(half, 0.0, MAT.SHOULDER, 2, true));
    pts.push(P(half + 1.6, -0.35, MAT.VERGE, 0, true));
  } else {
    pts.push(P(half, 0.0, MAT.VERGE, 1, true));
    pts.push(P(half + 0.9, -0.08, MAT.VERGE, 0, true));
  }

  const laneOffsets: number[] = [];
  for (let i = 0; i < lanes; i++) {
    const c = median / 2 + shoulder + (i + 0.5) * lw;
    laneOffsets.push(-c, c);
  }

  return {
    id, label, pts,
    carriageHalf: half,
    totalHalf: half + (fw > 0 ? fw : shoulder > 0 ? 1.6 : 0.9),
    laneOffsets, kerbH, lanes, laneWidth: lw, footway: fw,
    kerbRadius: o.kerbRadius ?? (lanes > 1 ? 9 : 6),
  };
}

export const PROFILES: Record<string, Profile> = {
  lane: makeProfile('lane', 'Service lane', { lanes: 1, laneWidth: 2.9, footway: 1.5, kerb: 0.11, kerbRadius: 4 }),
  street: makeProfile('street', 'Local street', { lanes: 1, laneWidth: 3.2, footway: 2.4, kerbRadius: 6 }),
  avenue: makeProfile('avenue', 'Avenue, 2+2', { lanes: 2, laneWidth: 3.4, footway: 3.0, kerbRadius: 9 }),
  boulevard: makeProfile('boulevard', 'Boulevard, 2+2 median', {
    lanes: 2, laneWidth: 3.4, footway: 3.2, median: 4.0, kerbRadius: 10,
  }),
  motorway: makeProfile('motorway', 'Motorway, 3+3', {
    lanes: 3, laneWidth: 3.65, footway: 0, median: 3.0, shoulder: 3.0, kerb: 0, kerbRadius: 14,
  }),
};

export const PROFILE_IDS = Object.keys(PROFILES);

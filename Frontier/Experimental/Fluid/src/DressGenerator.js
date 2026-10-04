/**
 * Parametric Couture Dress Pattern & 3D Tailored Cloth Mesh Generator
 * Integrates Zhang et al. 2025 (ACM SIGGRAPH 2025) "Physics-inspired Estimation of Optimal Cloth Mesh Resolution" (PIE):
 *  - Cerda & Mahadevan [2003] characteristic wrinkle wavelength λ & optimal orthotropic resolution (r_weft, r_warp)
 *  - Vandeparre et al. [2011] wrinklon wavelength transition L_w & power law Δr = x^m
 *  - Stationary garment boundary condition sources (Shirring, Folding, Long-Short Stitching, Down-Filling, High-Collision)
 *  - Harmonic pleat-locked high-density subdivision (up to 320×224 = 71,680 vertices) with twist-free intrinsic rest lengths
 */

import { PieSizingEstimator } from "./PieSizingEstimator.js";

export const DRESS_STYLES = [
  { id: 0, label: "Bias-cut evening gown" },
  { id: 1, label: "Sunburst pleated midi" },
  { id: 2, label: "Princess couture ballgown" },
  { id: 3, label: "Satin cocktail slip" },
  { id: 4, label: "Mermaid trumpet gown" },
  { id: 5, label: "Grecian chiffon column" },
  { id: 6, label: "Asymmetric wrap dress" },
  { id: 7, label: "Velvet opera gown" },
  { id: 8, label: "Noir tuxedo pleated coat gown" },
  { id: 9, label: "Embroidered ivory wrap coat gown" },
];

export const WEAVE_TYPES = [
  { id: 0, label: "Silk charmeuse" },
  { id: 1, label: "Satin twill" },
  { id: 2, label: "Pleated crepe" },
  { id: 3, label: "Velvet pile" },
  { id: 4, label: "Sheer organza" },
  { id: 5, label: "Sequined brocade" },
  { id: 6, label: "Cotton plain weave" },
  { id: 7, label: "Heavy canvas basket weave" },
  { id: 8, label: "Denim diagonal twill" },
  { id: 9, label: "Wool suiting nap" },
  { id: 10, label: "Leather grain" },
];

function evalSleeveProfile(t, knots) {
  if (t <= knots[0][0]) return knots[0][1];
  const last = knots.length - 1;
  if (t >= knots[last][0]) return knots[last][1];
  let k = 0;
  while (k < last - 1 && t > knots[k + 1][0]) k++;
  const [t0, v0] = knots[k];
  const [t1, v1] = knots[k + 1];
  const h = Math.max(1e-6, t1 - t0);
  const u = (t - t0) / h;
  const m0 = k > 0
    ? 0.5 * ((v1 - v0) / h + (v0 - knots[k - 1][1]) / Math.max(1e-6, t0 - knots[k - 1][0]))
    : (v1 - v0) / h;
  const m1 = k + 2 <= last
    ? 0.5 * ((knots[k + 2][1] - v1) / Math.max(1e-6, knots[k + 2][0] - t1) + (v1 - v0) / h)
    : (v1 - v0) / h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m0
    + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m1;
}

function buildLongSleeves(isMale) {
  const positions = [], normals = [], uvPanel = [], weights = [], boneIds = [], indices = [];
  const shX = isMale ? 0.184 : 0.160;
  const elX = isMale ? 0.258 : 0.236;
  const wrX = isMale ? 0.308 : 0.288;
  const steps = 30, segments = 24;

  for (const side of [-1, 1]) {
    const knots = [
      [0.00, side * (shX - 0.035), 1.378, -0.006, 0.008, 0.008],
      [0.06, side * shX, 1.372, -0.008, isMale ? 0.063 : 0.054, isMale ? 0.060 : 0.052],
      [0.24, side * (shX + (elX - shX) * 0.48), 1.245, -0.016, isMale ? 0.054 : 0.045, isMale ? 0.055 : 0.046],
      [0.44, side * elX, 1.120, -0.022, isMale ? 0.047 : 0.040, isMale ? 0.045 : 0.039],
      [0.56, side * (elX + (wrX - elX) * 0.32), 1.045, -0.010, isMale ? 0.049 : 0.041, isMale ? 0.046 : 0.040],
      [0.80, side * wrX, 0.885, 0.016, isMale ? 0.037 : 0.032, isMale ? 0.029 : 0.025],
      [0.88, side * (wrX + 0.010), 0.838, 0.024, 0.030, 0.024],
    ];
    const profiles = Array.from({ length: 5 }, (_, p) => knots.map((k) => [k[0], k[p + 1]]));
    const baseVertex = positions.length / 3;
    const firstT = 0.025, lastT = 0.86;

    for (let r = 0; r <= steps; r++) {
      const t = firstT + (lastT - firstT) * r / steps;
      const cx = evalSleeveProfile(t, profiles[0]);
      const cy = evalSleeveProfile(t, profiles[1]);
      const cz = evalSleeveProfile(t, profiles[2]);
      const rMajor = evalSleeveProfile(t, profiles[3]) + 0.005;
      const rMinor = evalSleeveProfile(t, profiles[4]) + 0.005;
      const dt = 0.003;
      let tx = evalSleeveProfile(Math.min(lastT, t + dt), profiles[0]) - evalSleeveProfile(Math.max(firstT, t - dt), profiles[0]);
      let ty = evalSleeveProfile(Math.min(lastT, t + dt), profiles[1]) - evalSleeveProfile(Math.max(firstT, t - dt), profiles[1]);
      let tz = evalSleeveProfile(Math.min(lastT, t + dt), profiles[2]) - evalSleeveProfile(Math.max(firstT, t - dt), profiles[2]);
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let bx = ty, by = -tx, bz = 0;
      let bl = Math.hypot(bx, by, bz);
      if (bl < 1e-5) { bx = 0; by = 1; bz = 0; bl = 1; }
      bx /= bl; by /= bl; bz /= bl;
      let nx = by * tz - bz * ty;
      let ny = bz * tx - bx * tz;
      let nz = bx * ty - by * tx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      for (let s = 0; s < segments; s++) {
        const angle = (s / segments) * Math.PI * 2;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        positions.push(cx + bx * ca * rMajor + nx * sa * rMinor,
          cy + by * ca * rMajor + ny * sa * rMinor,
          cz + bz * ca * rMajor + nz * sa * rMinor);
        const nnx = bx * ca / rMajor + nx * sa / rMinor;
        const nny = by * ca / rMajor + ny * sa / rMinor;
        const nnz = bz * ca / rMajor + nz * sa / rMinor;
        const nLen = Math.hypot(nnx, nny, nnz) || 1;
        normals.push(nnx / nLen, nny / nLen, nnz / nLen);
        uvPanel.push(s / segments, r / steps, 6.50, 0);
        weights.push(t);
        boneIds.push(side < 0 ? 3 : 4);
      }
    }

    for (let r = 0; r < steps; r++) {
      for (let s = 0; s < segments; s++) {
        const next = (s + 1) % segments;
        const a = baseVertex + r * segments + s;
        const b = baseVertex + r * segments + next;
        const c = baseVertex + (r + 1) * segments + s;
        const d = baseVertex + (r + 1) * segments + next;
        indices.push(a, c, d, a, d, b);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvPanel: new Float32Array(uvPanel),
    weights: new Float32Array(weights),
    boneIds: new Uint8Array(boneIds),
    indices: new Uint32Array(indices),
    vertexCount: weights.length,
  };
}

export class DressGenerator {
  static buildDress(params = {}) {
    // Evaluate Zhang et al. 2025 (PIE) optimal orthotropic resolutions & continuous 2D Sizing Map S(u, v)
    const pieReport = PieSizingEstimator.evaluateGarmentSizing(params);
    const pieActive = params.pieAutoResolution !== false;
    const anisoRatio = Math.max(0.6, Math.min(2.5, params.pieAnisotropy ?? 1.45));

    const pleatCount = Math.round(params.pleatCount ?? 16);
    const rawCols = Math.max(32, Math.min(320, Math.round(params.gridResolution || 192)));

    // §4.2.3 Folding / Pleating Harmonic Alignment:
    // Lock numCols to an integer multiple of pleatCount (with >= 6 columns per pleat when possible)
    // so every pleat crest and valley lands symmetrically on mesh vertices with zero Moiré / sawtooth aliasing.
    let numCols = rawCols;
    if (pleatCount >= 4 && rawCols >= 64) {
      const colsPerPleat = Math.max(4, Math.round(rawCols / pleatCount));
      // Prefer even colsPerPleat so both crests (+1) and troughs (-1) hit exact vertices
      const evenColsPerPleat = colsPerPleat % 2 === 0 ? colsPerPleat : colsPerPleat + 1;
      numCols = Math.max(32, Math.min(320, pleatCount * evenColsPerPleat));
    }

    // §4.1.2 Orthotropic Anisotropy: warp row resolution scaled by anisotropy ratio
    const warpAspect = pieActive
      ? Math.max(0.62, Math.min(0.88, 0.78 / Math.pow(anisoRatio, 0.22)))
      : 0.72;
    const numRows = Math.max(24, Math.min(224, Math.round(numCols * warpAspect)));
    const vertexCount = numCols * numRows;

    const dressStyle = params.dressStyle ?? 0;
    const isMale = (params.avatarBodyType ?? 0) === 1;
    const skirtLength = params.skirtLength ?? 0.92; // [m] from waist (1.03m) downward
    const skirtFlare = params.skirtFlare ?? 0.58;   // radial flare expansion
    const waistCinch = params.waistCinch ?? 0.82;   // 0..1 waist tailoring tightness
    const necklineDepth = params.necklineDepth ?? 0.14;
    const strapWidth = params.strapWidth ?? 0.065;
    const pleatDepth = params.pleatDepth ?? 0.018;
    const asymmetry = params.asymmetry ?? 0.0;
    const sleeveDrape = params.sleeveDrape ?? 0.12;
    const shirringRatio = Math.max(0.35, Math.min(1.0, params.pieShirringRatio ?? 0.64));

    const initialPositions = new Float32Array(vertexCount * 4);
    const unpleatedPositions = new Float32Array(vertexCount * 3);
    const anchorTargets = new Float32Array(vertexCount * 4);
    const uvsAndPanel = new Float32Array(vertexCount * 4);
    const restLengths = new Float32Array(vertexCount * 4);
    const sizingMapMm = new Float32Array(vertexCount);

    const waistRowFrac = 0.28; // Row fraction where bodice meets skirt at natural waist (y ~ 1.04m)
    const hemFloorGap = dressStyle >= 8 ? 0.014 : 0.035;
    const hemBaseY = Math.max(hemFloorGap, 1.04 - skirtLength);

    // §4.3 Smooth Non-Uniform Warp Sizing Grading (vMapped):
    // Gently concentrates vertical rows near the shirred waistband (v = 0.28) and hip contour
    // while maintaining C∞ smoothness across the entire skirt.
    const vMapped = new Float32Array(numRows);
    if (pieActive) {
      const N_SAMPLES = 256;
      const vCdf = new Float32Array(N_SAMPLES + 1);
      for (let i = 1; i <= N_SAMPLES; i++) {
        const vs = (i - 0.5) / N_SAMPLES;
        const sMeters = (pieReport.sampleSizingMeters(0.25, vs) + pieReport.sampleSizingMeters(0.0, vs)) * 0.5;
        const invWeight = 0.72 + 0.28 * Math.pow(0.006 / Math.max(0.0025, sMeters), 0.35);
        vCdf[i] = vCdf[i - 1] + invWeight;
      }
      const vTotal = vCdf[N_SAMPLES];
      for (let r = 0; r < numRows; r++) {
        const target = (r / (numRows - 1)) * vTotal;
        let lo = 0, hi = N_SAMPLES;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (vCdf[mid] < target) lo = mid + 1;
          else hi = mid;
        }
        const idx = Math.max(1, lo);
        const prevCdf = vCdf[idx - 1];
        const span = Math.max(1e-6, vCdf[idx] - prevCdf);
        vMapped[r] = Math.max(0.0, Math.min(1.0, (idx - 1 + (target - prevCdf) / span) / N_SAMPLES));
      }
    } else {
      for (let r = 0; r < numRows; r++) vMapped[r] = r / (numRows - 1);
    }

    // Compute 3D tailored initial positions on the human avatar
    for (let r = 0; r < numRows; r++) {
      const v = vMapped[r]; // 0 = top neckline/straps, 1 = bottom hemline

      for (let c = 0; c < numCols; c++) {
        const u = c / numCols;
        const angle = u * Math.PI * 2;
        const cosA = Math.cos(angle); // +X right shoulder/hip, -X left shoulder/hip
        const sinA = Math.sin(angle); // +Z front chest/skirt, -Z back spine

        // Determine neckline dip at top of bodice (front & back scoop/V-neck vs shoulder straps)
        const shoulderProximity = Math.pow(Math.abs(cosA), 1.6); // 1 at shoulders (angle=0, pi), 0 at front/back center
        const frontBackCenter = 1.0 - shoulderProximity;

        // Style-specific neckline shaping
        let neckDrop = necklineDepth * frontBackCenter;
        if (dressStyle === 2 || dressStyle === 3) {
          // Sweetheart / slip neckline: deeper dip in front
          neckDrop = necklineDepth * (sinA > 0 ? Math.pow(sinA, 1.4) * 1.15 : Math.pow(-sinA, 1.6) * 0.95);
        } else if (dressStyle === 6) {
          // Asymmetric wrap neckline
          neckDrop = necklineDepth * (0.65 + 0.35 * Math.sin(angle + 0.6));
        } else if (dressStyle === 8 || dressStyle === 9) {
          // Tailored coat gowns have a deep, clean front V rather than a strap/scoop edge.
          neckDrop = (dressStyle === 8 ? 0.225 : 0.235) * Math.pow(Math.max(0, sinA), 1.25);
        }

        const topY = 1.385 - neckDrop + 0.012 * shoulderProximity;
        const waistY = 1.035;

        // Asymmetric hemline modulation
        const asymOffset = asymmetry * 0.22 * Math.sin(angle + 0.35);
        const effHemY = Math.max(hemFloorGap, hemBaseY + asymOffset);

        let y;
        if (v <= waistRowFrac) {
          const tv = v / waistRowFrac;
          y = topY * (1 - tv) + waistY * tv;
        } else {
          const sv = (v - waistRowFrac) / (1 - waistRowFrac);
          y = waistY * (1 - sv) + effHemY * sv;
        }

        // Base anatomical cross-section radii (rx, rz) at height y with cloth clearance
        let rx = 0.145;
        let rz = 0.108;
        let centerZ = 0.0;

        if (v <= waistRowFrac) {
          // Bodice region (from shoulders/bust/pectorals down to natural waist)
          const tv = v / waistRowFrac;
          const bustBell = Math.exp(-Math.pow((tv - 0.52) / 0.32, 2));
          const shoulderFlare = Math.pow(1 - tv, 1.5) * ((isMale ? 0.048 : 0.035) + sleeveDrape * 0.08);
          const waistTaper = Math.pow(tv, 1.3) * ((isMale ? 0.014 : 0.022) * waistCinch);

          rx = (isMale ? 0.184 : 0.156) + shoulderFlare + (isMale ? 0.008 : 0.012) * bustBell - waistTaper;
          rz = (isMale ? 0.118 : 0.106) + (isMale ? 0.012 : 0.018) * bustBell - waistTaper * 0.75;

          // Extra anterior contour over female bust spheres or male pectorals
          if (sinA > 0) {
            const bustFront = Math.exp(-Math.pow((tv - 0.50) / 0.28, 2)) * Math.pow(sinA, 1.2);
            rz += (isMale ? 0.022 : 0.038) * bustFront;
          }
        } else {
          // Skirt region (from waist at v=waistRowFrac down to hem at v=1.0)
          const sv = (v - waistRowFrac) / (1 - waistRowFrac); // 0 at waist, 1 at hem

          // Hip contour swell between waist (sv=0) and hips (sv ~ 0.24)
          const hipSwell = Math.sin(Math.min(1, sv / 0.26) * Math.PI * 0.5);
          const baseHipRx = (isMale ? 0.156 : 0.134) + (isMale ? 0.028 : 0.056) * hipSwell;
          const baseHipRz = (isMale ? 0.110 : 0.098) + (isMale ? 0.026 : 0.044) * hipSwell;

          // Style-specific skirt flare profile
          let flareCurve = Math.pow(sv, 1.25) * skirtFlare * 0.48;
          if (dressStyle === 2) {
            // Couture Ballgown: immediate voluminous bell dome from waist
            flareCurve = (0.35 * Math.sin(sv * Math.PI * 0.5) + 0.65 * Math.pow(sv, 1.15)) * skirtFlare * 0.68;
          } else if (dressStyle === 4) {
            // Mermaid Trumpet Gown: hugs hips and thighs until sv > 0.52, then flares dramatically
            const hug = sv < 0.52 ? -0.016 * Math.sin((sv / 0.52) * Math.PI) : 0;
            const trumpet = sv > 0.48 ? Math.pow((sv - 0.48) / 0.52, 1.45) * skirtFlare * 0.72 : 0;
            flareCurve = hug + trumpet;
          } else if (dressStyle === 5) {
            // Grecian column: narrow vertical column drape
            flareCurve = Math.pow(sv, 1.5) * skirtFlare * 0.26;
          }

          rx = baseHipRx + flareCurve;
          rz = baseHipRz + flareCurve * 0.92;

          // Posterior gluteal clearance
          if (sinA < 0 && sv < 0.45) {
            const gluteClear = Math.sin((sv / 0.45) * Math.PI) * (-sinA);
            rz += 0.026 * gluteClear;
          }
        }

        // Smooth C1 radial accordion pleat envelope (0 in bodice, smoothly grows below waist)
        const pleatRaw = v > waistRowFrac
          ? (v - waistRowFrac) / (1 - waistRowFrac)
          : 0.0;
        const pleatEnv = pleatRaw * pleatRaw * (3 - 2 * pleatRaw);
        const sideInsetStart = 0.74;
        const sideInsetSpan = 0.68;
        const sideInsetT = Math.max(0, Math.min(1, (angle - sideInsetStart) / sideInsetSpan));
        const inSideInset = dressStyle === 8 && sinA > 0 && v >= waistRowFrac
          && angle >= sideInsetStart && angle <= sideInsetStart + sideInsetSpan;
        let pleatWave = 0.0;
        if (dressStyle === 8) {
          // Confine knife-pleat relief to the narrow ivory side insert, leaving the noir skirt clean.
          if (inSideInset) pleatWave = Math.sin(sideInsetT * Math.PI * 2 * 6) * pleatDepth * pleatEnv;
        } else if (dressStyle < 8 && pleatCount > 0) {
          pleatWave = Math.sin(angle * pleatCount) * pleatDepth * pleatEnv;
        }

        // Smooth organic couture drape fold harmonic (well below Nyquist limit)
        const drapeHarmonic = dressStyle < 8
          ? Math.cos(angle * 6 + 0.4) * 0.004 * Math.pow(pleatRaw, 1.3)
          : 0.0;

        const effRx = rx + pleatWave + drapeHarmonic;
        const effRz = rz + pleatWave + drapeHarmonic;

        const x = cosA * effRx;
        const z = centerZ + sinA * effRz;

        // Store unpleated base shell position for intrinsic vertical warp rest-length calculation
        const idx = r * numCols + c;
        const idx3 = idx * 3;
        unpleatedPositions[idx3 + 0] = cosA * rx;
        unpleatedPositions[idx3 + 1] = y;
        unpleatedPositions[idx3 + 2] = centerZ + sinA * rz;

        // Pin / Tailoring Weight calculation:
        let pinStrength = 0.0;
        if (r === 0) {
          const strapMask = Math.exp(-Math.pow((Math.abs(cosA) - 0.82) / Math.max(0.08, strapWidth * 2.2), 2));
          pinStrength = 0.76 + 0.22 * strapMask;
        } else if (r === 1) {
          pinStrength = 0.48;
        } else if (r === 2) {
          pinStrength = 0.24;
        } else if (Math.abs(v - waistRowFrac) < 0.028) {
          pinStrength = 0.20 * waistCinch;
        }

        const idx4 = idx * 4;
        initialPositions[idx4 + 0] = x;
        initialPositions[idx4 + 1] = y;
        initialPositions[idx4 + 2] = z;
        initialPositions[idx4 + 3] = pinStrength;

        anchorTargets[idx4 + 0] = x;
        anchorTargets[idx4 + 1] = y;
        anchorTargets[idx4 + 2] = z;
        anchorTargets[idx4 + 3] = pinStrength;

        // Evaluate local PIE Sizing Map S(u, v) in millimeters
        const localSizingMm = pieReport.sampleSizingMeters(u, v) * 1000.0;
        sizingMapMm[idx] = localSizingMm;

        // Panel IDs: 0..3 base bodice/skirt panels, 4 contrast side inset, 5 tailored lapels.
        // The fractional part still encodes the PIE sizing value for the render diagnostic.
        const isFront = sinA >= 0;
        const isBodice = v <= waistRowFrac;
        let panelId = isBodice ? (isFront ? 0 : 1) : (isFront ? 2 : 3);
        const bodiceT = Math.max(0, Math.min(1, v / waistRowFrac));
        const lapelAxis = 0.78 - 0.68 * bodiceT;
        const lapelWidth = 0.12 + 0.025 * bodiceT;
        const isLapel = (dressStyle === 8 || dressStyle === 9) && isFront
          && sinA > 0.18 && v < waistRowFrac * 0.78
          && Math.abs(Math.abs(cosA) - lapelAxis) < lapelWidth;
        if (isLapel) panelId = 5;
        else if (inSideInset) panelId = 4;
        const encodedSizingFrac = Math.max(0.01, Math.min(0.98, localSizingMm / 20.0));
        let pleatPhase = pleatCount > 0 ? Math.sin(angle * pleatCount) : 0;
        if (dressStyle === 8) pleatPhase = inSideInset ? Math.sin(sideInsetT * Math.PI * 2 * 6) : 0;
        if (dressStyle === 9) pleatPhase = 0;

        uvsAndPanel[idx4 + 0] = u;
        uvsAndPanel[idx4 + 1] = v;
        uvsAndPanel[idx4 + 2] = panelId + encodedSizingFrac;
        uvsAndPanel[idx4 + 3] = pleatPhase;
      }
    }

    // Precompute exact rest lengths for every vertex (c, r):
    // [weftRight, warpDown (intrinsic unpleated generator length), shearDiag (symmetric hypot), bendRight2]
    const distBetween3D = (c0, r0, c1, r1) => {
      const i0 = (r0 * numCols + ((c0 + numCols) % numCols)) * 4;
      const i1 = (r1 * numCols + ((c1 + numCols) % numCols)) * 4;
      const dx = initialPositions[i1] - initialPositions[i0];
      const dy = initialPositions[i1 + 1] - initialPositions[i0 + 1];
      const dz = initialPositions[i1 + 2] - initialPositions[i0 + 2];
      return Math.max(0.001, Math.hypot(dx, dy, dz));
    };

    const distBetweenBase = (c0, r0, c1, r1) => {
      const i0 = (r0 * numCols + ((c0 + numCols) % numCols)) * 3;
      const i1 = (r1 * numCols + ((c1 + numCols) % numCols)) * 3;
      const dx = unpleatedPositions[i1] - unpleatedPositions[i0];
      const dy = unpleatedPositions[i1 + 1] - unpleatedPositions[i0 + 1];
      const dz = unpleatedPositions[i1 + 2] - unpleatedPositions[i0 + 2];
      return Math.max(0.001, Math.hypot(dx, dy, dz));
    };

    for (let r = 0; r < numRows; r++) {
      const v = vMapped[r];
      // §4.2.2 Shirring shrinkage factor at waistband (v ≈ waistRowFrac)
      const waistGather = Math.exp(-Math.pow((v - waistRowFrac) / 0.042, 2));
      const localShirringScale = 1.0 - (1.0 - shirringRatio) * 0.16 * waistGather;

      for (let c = 0; c < numCols; c++) {
        const idx4 = (r * numCols + c) * 4;
        // 0: Weft right neighbor (c+1, r)
        const weftL = distBetween3D(c, r, c + 1, r) * localShirringScale;
        // 1: Warp down neighbor (c, r+1) — uses intrinsic unpleated generator distance so pleat ridges & valleys hang at identical height
        const warpL = r < numRows - 1 ? distBetweenBase(c, r, c, r + 1) : 0.0;
        // 2: Symmetric orthogonal shear diagonal rest length sqrt(weft^2 + warp^2)
        const shearL = r < numRows - 1 ? Math.hypot(weftL, warpL) : 0.0;
        // 3: 2-hop circumferential bending/pleat spring (c+2, r)
        const bendL = distBetween3D(c, r, c + 2, r);

        restLengths[idx4 + 0] = weftL;
        restLengths[idx4 + 1] = warpL;
        restLengths[idx4 + 2] = shearL;
        restLengths[idx4 + 3] = bendL;
      }
    }

    // Triangle index buffer (periodic cylinder topology)
    let indices = new Uint32Array(numCols * (numRows - 1) * 6);
    let ptr = 0;
    for (let r = 0; r < numRows - 1; r++) {
      for (let c = 0; c < numCols; c++) {
        const nextC = (c + 1) % numCols;
        const i00 = r * numCols + c;
        const i10 = r * numCols + nextC;
        const i01 = (r + 1) * numCols + c;
        const i11 = (r + 1) * numCols + nextC;

        indices[ptr++] = i00;
        indices[ptr++] = i01;
        indices[ptr++] = i11;
        indices[ptr++] = i00;
        indices[ptr++] = i11;
        indices[ptr++] = i10;
      }
    }

    // Tailored coat-gowns receive articulated, low-poly sleeve shells. They are skinned to
    // the mannequin arm bones and drawn with the cloth shader; the torso/skirt remain XPBD.
    const attachments = dressStyle >= 8 ? buildLongSleeves(isMale) : {
      positions: new Float32Array(0), normals: new Float32Array(0), uvPanel: new Float32Array(0),
      weights: new Float32Array(0), boneIds: new Uint8Array(0), indices: new Uint32Array(0), vertexCount: 0,
    };
    const attachmentOffset = vertexCount;
    const renderVertexCount = vertexCount + attachments.vertexCount;
    const renderInitialPositions = new Float32Array(renderVertexCount * 4);
    const renderNormals = new Float32Array(renderVertexCount * 4);
    const renderUvsAndPanel = new Float32Array(renderVertexCount * 4);
    const renderVelocities = new Float32Array(renderVertexCount * 4);
    renderInitialPositions.set(initialPositions);
    renderUvsAndPanel.set(uvsAndPanel);
    for (let i = 0; i < vertexCount; i++) renderNormals[i * 4 + 2] = 1;
    for (let i = 0; i < attachments.vertexCount; i++) {
      const dst4 = (attachmentOffset + i) * 4;
      const src3 = i * 3;
      renderInitialPositions[dst4] = attachments.positions[src3];
      renderInitialPositions[dst4 + 1] = attachments.positions[src3 + 1];
      renderInitialPositions[dst4 + 2] = attachments.positions[src3 + 2];
      renderNormals[dst4] = attachments.normals[src3];
      renderNormals[dst4 + 1] = attachments.normals[src3 + 1];
      renderNormals[dst4 + 2] = attachments.normals[src3 + 2];
      renderUvsAndPanel.set(attachments.uvPanel.subarray(i * 4, i * 4 + 4), dst4);
      renderVelocities[dst4 + 3] = 1;
    }
    if (attachments.vertexCount) {
      const combined = new Uint32Array(indices.length + attachments.indices.length);
      combined.set(indices);
      for (let i = 0; i < attachments.indices.length; i++) {
        combined[indices.length + i] = attachmentOffset + attachments.indices[i];
      }
      indices = combined;
    }

    // Total active spring constraints in the solver (weft + warp + 2*shear + 2*bending)
    const constraintCount =
      numCols * numRows +               // Weft structural
      numCols * (numRows - 1) +         // Warp structural
      2 * numCols * (numRows - 1) +     // Diagonal shear
      numCols * numRows +               // Circumferential bending / pleat
      numCols * Math.max(0, numRows - 2); // Vertical bending

    // Build 2D pattern panel shapes for the Substance / Pattern Editor on the left
    const pattern2D = DressGenerator.build2DPatternPanels(params);

    return {
      numCols,
      numRows,
      vertexCount,
      renderVertexCount,
      constraintCount,
      indexCount: indices.length,
      initialPositions,
      anchorTargets,
      uvsAndPanel,
      restLengths,
      renderInitialPositions,
      renderNormals,
      renderUvsAndPanel,
      renderVelocities,
      attachmentOffset,
      attachmentPositions: attachments.positions,
      attachmentNormals: attachments.normals,
      attachmentBoneIds: attachments.boneIds,
      attachmentWeights: attachments.weights,
      sizingMapMm,
      pieReport,
      indices,
      pattern2D,
    };
  }

  /** Kinematically skins tailored sleeve shells to the current animated arm pose. */
  static updateAttachments(dress, avatar) {
    if (!dress?.attachmentWeights?.length) return;
    const pointTransform = avatar?.transformPoint;
    const normalTransform = avatar?.transformNormal;
    const offset = dress.attachmentOffset;
    for (let i = 0; i < dress.attachmentWeights.length; i++) {
      const i3 = i * 3;
      const i4 = (offset + i) * 4;
      const boneId = dress.attachmentBoneIds[i];
      const weight = dress.attachmentWeights[i];
      const x = dress.attachmentPositions[i3];
      const y = dress.attachmentPositions[i3 + 1];
      const z = dress.attachmentPositions[i3 + 2];
      const p = pointTransform ? pointTransform(x, y, z, boneId, weight) : [x, y, z];
      const n = normalTransform
        ? normalTransform(dress.attachmentNormals[i3], dress.attachmentNormals[i3 + 1], dress.attachmentNormals[i3 + 2], boneId, weight)
        : [dress.attachmentNormals[i3], dress.attachmentNormals[i3 + 1], dress.attachmentNormals[i3 + 2]];
      dress.renderInitialPositions[i4] = p[0];
      dress.renderInitialPositions[i4 + 1] = p[1];
      dress.renderInitialPositions[i4 + 2] = p[2];
      dress.renderNormals[i4] = n[0];
      dress.renderNormals[i4 + 1] = n[1];
      dress.renderNormals[i4 + 2] = n[2];
    }
  }

  /**
   * Computes normalized 2D CAD pattern outlines & interactive handles for the left-side Pattern Editor.
   */
  static build2DPatternPanels(params = {}) {
    const skirtLength = params.skirtLength ?? 0.92;
    const skirtFlare = params.skirtFlare ?? 0.58;
    const waistCinch = params.waistCinch ?? 0.82;
    const necklineDepth = params.necklineDepth ?? 0.14;
    const strapWidth = params.strapWidth ?? 0.065;
    const asymmetry = params.asymmetry ?? 0.0;

    const waistHalfW = 0.135 - 0.035 * waistCinch;
    const bustHalfW = 0.165;
    const hipHalfW = 0.175 + skirtFlare * 0.08;
    const hemHalfW = 0.165 + skirtFlare * 0.24;
    const skirtH = 0.18 + skirtLength * 0.34;

    return {
      waistHalfW,
      bustHalfW,
      hipHalfW,
      hemHalfW,
      skirtH,
      necklineDepth,
      strapWidth,
      asymmetry,
    };
  }
}

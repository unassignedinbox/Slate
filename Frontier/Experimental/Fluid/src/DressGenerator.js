/**
 * Parametric Couture Dress Pattern & 3D Tailored Cloth Mesh Generator
 * Integrates Zhang et al. 2025 (ACM SIGGRAPH 2025) "Physics-inspired Estimation of Optimal Cloth Mesh Resolution" (PIE):
 *  - Cerda & Mahadevan [2003] characteristic wrinkle wavelength λ & optimal orthotropic resolution (r_weft, r_warp)
 *  - Vandeparre et al. [2011] wrinklon wavelength transition L_w & power law Δr = x^m
 *  - Stationary garment boundary condition sources (Shirring, Folding, Long-Short Stitching, Down-Filling, High-Collision)
 *  - Non-uniform Sizing Map S(u, v) adaptive vertex grading & shirring contraction rest-lengths
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
];

export const WEAVE_TYPES = [
  { id: 0, label: "Silk charmeuse" },
  { id: 1, label: "Satin twill" },
  { id: 2, label: "Pleated crepe" },
  { id: 3, label: "Velvet pile" },
  { id: 4, label: "Sheer organza" },
  { id: 5, label: "Sequined brocade" },
];

export class DressGenerator {
  static buildDress(params = {}) {
    // Evaluate Zhang et al. 2025 (PIE) optimal orthotropic resolutions & continuous 2D Sizing Map S(u, v)
    const pieReport = PieSizingEstimator.evaluateGarmentSizing(params);
    const pieActive = params.pieAutoResolution !== false;
    const anisoRatio = Math.max(0.6, Math.min(2.5, params.pieAnisotropy ?? 1.45));

    const baseCols = Math.max(24, Math.min(96, Math.round(params.gridResolution || 56)));
    const numCols = baseCols;
    // §4.1.2 Orthotropic Anisotropy: coarser warp resolution along vertical hang when pieAnisotropy > 1
    const warpAspect = pieActive
      ? Math.max(0.56, Math.min(0.92, 0.84 / Math.pow(anisoRatio, 0.28)))
      : 0.78;
    const numRows = Math.max(20, Math.min(72, Math.round(numCols * warpAspect)));
    const vertexCount = numCols * numRows;

    const dressStyle = params.dressStyle ?? 0;
    const skirtLength = params.skirtLength ?? 0.92; // [m] from waist (1.03m) downward
    const skirtFlare = params.skirtFlare ?? 0.58;   // radial flare expansion
    const waistCinch = params.waistCinch ?? 0.82;   // 0..1 waist tailoring tightness
    const necklineDepth = params.necklineDepth ?? 0.14;
    const strapWidth = params.strapWidth ?? 0.065;
    const pleatCount = Math.round(params.pleatCount ?? 16);
    const pleatDepth = params.pleatDepth ?? 0.018;
    const asymmetry = params.asymmetry ?? 0.0;
    const sleeveDrape = params.sleeveDrape ?? 0.12;
    const shirringRatio = Math.max(0.35, Math.min(1.0, params.pieShirringRatio ?? 0.64));

    const initialPositions = new Float32Array(vertexCount * 4);
    const anchorTargets = new Float32Array(vertexCount * 4);
    const uvsAndPanel = new Float32Array(vertexCount * 4);
    const restLengths = new Float32Array(vertexCount * 4);
    const sizingMapMm = new Float32Array(vertexCount);

    const waistRowFrac = 0.28; // Row fraction where bodice meets skirt at natural waist (y ~ 1.04m)
    const hemBaseY = Math.max(0.05, 1.04 - skirtLength);

    // §4.3 Non-Uniform Sizing Map Vertex Distribution:
    // Build warp (v) and weft (u) cumulative inverse-sizing distribution CDFs so mesh vertices
    // concentrate in fine-wrinkle regions (shirred waistband v=0.28, neckline v=0, side seams, pleat folds, hip/knee collision zones)
    const vMapped = new Float32Array(numRows);
    const uMapped = new Float32Array(numCols);

    if (pieActive) {
      const N_SAMPLES = 256;
      const vCdf = new Float32Array(N_SAMPLES + 1);
      for (let i = 1; i <= N_SAMPLES; i++) {
        const vs = (i - 0.5) / N_SAMPLES;
        const sMeters = (pieReport.sampleSizingMeters(0.25, vs) + pieReport.sampleSizingMeters(0.0, vs)) * 0.5;
        // Weight inversely proportional to local sizing r(u,v) (blended with uniform for smooth grading)
        const invWeight = 0.42 + 0.58 * Math.pow(0.006 / Math.max(0.0025, sMeters), 0.55);
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

      const uCdf = new Float32Array(N_SAMPLES + 1);
      for (let i = 1; i <= N_SAMPLES; i++) {
        const us = (i - 0.5) / N_SAMPLES;
        const sMeters = pieReport.sampleSizingMeters(us, waistRowFrac + 0.12);
        const invWeight = 0.62 + 0.38 * Math.pow(0.006 / Math.max(0.0025, sMeters), 0.45);
        uCdf[i] = uCdf[i - 1] + invWeight;
      }
      const uTotal = uCdf[N_SAMPLES];
      for (let c = 0; c < numCols; c++) {
        const target = (c / numCols) * uTotal;
        let lo = 0, hi = N_SAMPLES;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (uCdf[mid] < target) lo = mid + 1;
          else hi = mid;
        }
        const idx = Math.max(1, lo);
        const prevCdf = uCdf[idx - 1];
        const span = Math.max(1e-6, uCdf[idx] - prevCdf);
        uMapped[c] = Math.max(0.0, Math.min(0.9999, (idx - 1 + (target - prevCdf) / span) / N_SAMPLES));
      }
    } else {
      for (let r = 0; r < numRows; r++) vMapped[r] = r / (numRows - 1);
      for (let c = 0; c < numCols; c++) uMapped[c] = c / numCols;
    }

    // Compute 3D tailored initial positions on the human avatar
    for (let r = 0; r < numRows; r++) {
      const v = vMapped[r]; // 0 = top neckline/straps, 1 = bottom hemline

      for (let c = 0; c < numCols; c++) {
        const u = uMapped[c];
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
        }

        const topY = 1.385 - neckDrop + 0.012 * shoulderProximity;
        const waistY = 1.035;

        // Asymmetric hemline modulation
        const asymOffset = asymmetry * 0.22 * Math.sin(angle + 0.35);
        const effHemY = Math.max(0.035, hemBaseY + asymOffset);

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
          // Bodice region (from shoulders/bust down to natural waist)
          const tv = v / waistRowFrac;
          const bustBell = Math.exp(-Math.pow((tv - 0.52) / 0.32, 2));
          const shoulderFlare = Math.pow(1 - tv, 1.5) * (0.035 + sleeveDrape * 0.08);
          const waistTaper = Math.pow(tv, 1.3) * (0.022 * waistCinch);

          rx = 0.156 + shoulderFlare + 0.012 * bustBell - waistTaper;
          rz = 0.106 + 0.018 * bustBell - waistTaper * 0.75;

          // Extra anterior contour over bust spheres
          if (sinA > 0) {
            const bustFront = Math.exp(-Math.pow((tv - 0.50) / 0.28, 2)) * Math.pow(sinA, 1.2);
            rz += 0.038 * bustFront;
          }
        } else {
          // Skirt region (from waist at v=waistRowFrac down to hem at v=1.0)
          const sv = (v - waistRowFrac) / (1 - waistRowFrac); // 0 at waist, 1 at hem

          // Hip contour swell between waist (sv=0) and hips (sv ~ 0.24)
          const hipSwell = Math.sin(Math.min(1, sv / 0.26) * Math.PI * 0.5);
          const baseHipRx = 0.134 + 0.056 * hipSwell;
          const baseHipRz = 0.098 + 0.044 * hipSwell;

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

        // Radial accordion pleats + Cerda & Mahadevan [2003] characteristic wrinklon harmonic
        const pleatEnv = v > waistRowFrac * 0.6
          ? Math.min(1.0, (v - waistRowFrac * 0.6) / (1 - waistRowFrac * 0.6))
          : 0.0;
        const pleatWave = pleatCount > 0
          ? Math.sin(angle * pleatCount) * pleatDepth * (0.35 + 0.65 * pleatEnv)
          : 0.0;

        // Shirring micro-wrinkles near waistband (v ≈ waistRowFrac) per §4.2.2
        const waistShirringEnv = Math.exp(-Math.pow((v - waistRowFrac) / 0.085, 2)) * (1.0 - shirringRatio);
        const shirringWave = Math.sin(angle * Math.max(18, Math.round(numCols * 0.42))) * 0.009 * waistShirringEnv;

        // Secondary organic couture drape fold harmonic
        const drapeHarmonic = Math.cos(angle * 7 + 0.4) * 0.006 * Math.pow(v, 1.4);

        const effRx = rx + pleatWave + shirringWave + drapeHarmonic;
        const effRz = rz + pleatWave + shirringWave + drapeHarmonic;

        const x = cosA * effRx;
        const z = centerZ + sinA * effRz;

        // Pin / Tailoring Weight calculation:
        let pinStrength = 0.0;
        if (r === 0) {
          const strapMask = Math.exp(-Math.pow((Math.abs(cosA) - 0.82) / Math.max(0.08, strapWidth * 2.2), 2));
          pinStrength = 0.72 + 0.26 * strapMask;
        } else if (r === 1) {
          pinStrength = 0.42;
        } else if (r === 2) {
          pinStrength = 0.18;
        } else if (Math.abs(v - waistRowFrac) < 0.032) {
          pinStrength = 0.16 * waistCinch;
        }

        const idx = r * numCols + c;
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

        // Panel ID: 0 = Front Bodice, 1 = Back Bodice, 2 = Front Skirt, 3 = Back Skirt
        // Fractional part of uvsAndPanel.z encodes normalized PIE sizing (localSizingMm / 20.0) in (0.01..0.98)
        const isFront = sinA >= 0;
        const isBodice = v <= waistRowFrac;
        const panelId = isBodice ? (isFront ? 0 : 1) : (isFront ? 2 : 3);
        const encodedSizingFrac = Math.max(0.01, Math.min(0.98, localSizingMm / 20.0));
        const pleatPhase = pleatCount > 0 ? Math.sin(angle * pleatCount) : 0;

        uvsAndPanel[idx4 + 0] = u;
        uvsAndPanel[idx4 + 1] = v;
        uvsAndPanel[idx4 + 2] = panelId + encodedSizingFrac;
        uvsAndPanel[idx4 + 3] = pleatPhase;
      }
    }

    // Precompute exact rest lengths for every vertex (c, r):
    // [weftRight (with §4.2.2 shirring contraction), warpDown, shearDiagRightDown, bendRight2]
    const distBetween = (c0, r0, c1, r1) => {
      const i0 = (r0 * numCols + ((c0 + numCols) % numCols)) * 4;
      const i1 = (r1 * numCols + ((c1 + numCols) % numCols)) * 4;
      const dx = initialPositions[i1] - initialPositions[i0];
      const dy = initialPositions[i1 + 1] - initialPositions[i0 + 1];
      const dz = initialPositions[i1 + 2] - initialPositions[i0 + 2];
      return Math.max(0.002, Math.hypot(dx, dy, dz));
    };

    for (let r = 0; r < numRows; r++) {
      const v = vMapped[r];
      // §4.2.2 Shirring shrinkage factor at waistband (v ≈ waistRowFrac) and gathered neckline
      const waistGather = Math.exp(-Math.pow((v - waistRowFrac) / 0.045, 2));
      const localShirringScale = 1.0 - (1.0 - shirringRatio) * 0.28 * waistGather;

      for (let c = 0; c < numCols; c++) {
        const idx4 = (r * numCols + c) * 4;
        // 0: Weft right neighbor (c+1, r) with shirring gather contraction
        restLengths[idx4 + 0] = distBetween(c, r, c + 1, r) * localShirringScale;
        // 1: Warp down neighbor (c, r+1)
        restLengths[idx4 + 1] = r < numRows - 1 ? distBetween(c, r, c, r + 1) : 0.0;
        // 2: Shear diagonal right-down (c+1, r+1)
        restLengths[idx4 + 2] = r < numRows - 1 ? distBetween(c, r, c + 1, r + 1) : 0.0;
        // 3: 2-hop circumferential bending/pleat spring (c+2, r)
        restLengths[idx4 + 3] = distBetween(c, r, c + 2, r);
      }
    }

    // Triangle index buffer (periodic cylinder topology)
    const indices = new Uint32Array(numCols * (numRows - 1) * 6);
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
      constraintCount,
      indexCount: indices.length,
      initialPositions,
      anchorTargets,
      uvsAndPanel,
      restLengths,
      sizingMapMm,
      pieReport,
      indices,
      pattern2D,
    };
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

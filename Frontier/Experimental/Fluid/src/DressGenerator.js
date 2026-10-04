/**
 * Parametric Couture Dress Pattern & 3D Tailored Cloth Mesh Generator
 * Generates both:
 *  - 2D Flat Garment Pattern Panels (Front/Back Bodice, Front/Back Skirt, Seams, Control Handles)
 *  - 3D Draped Periodic Cloth Grid + Exact Warp/Weft/Shear/Bend Rest-Length Buffers for WebGPU XPBD
 */

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
    const numCols = Math.max(24, Math.min(96, Math.round(params.gridResolution || 56)));
    const numRows = Math.max(20, Math.min(72, Math.round(numCols * 0.78)));
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

    const initialPositions = new Float32Array(vertexCount * 4);
    const anchorTargets = new Float32Array(vertexCount * 4);
    const uvsAndPanel = new Float32Array(vertexCount * 4);
    const restLengths = new Float32Array(vertexCount * 4);

    const waistRowFrac = 0.28; // Row fraction where bodice meets skirt at natural waist (y ~ 1.04m)
    const hipRowFrac = 0.44;   // Row fraction passing over hip crest (y ~ 0.89m)
    const hemBaseY = Math.max(0.05, 1.04 - skirtLength);

    // Compute 3D tailored initial positions on the human avatar
    for (let r = 0; r < numRows; r++) {
      const v = r / (numRows - 1); // 0 = top neckline/straps, 1 = bottom hemline

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

        // Radial accordion pleats / natural fabric wave modulation
        const pleatEnv = v > waistRowFrac * 0.6
          ? Math.min(1.0, (v - waistRowFrac * 0.6) / (1 - waistRowFrac * 0.6))
          : 0.0;
        const pleatWave = pleatCount > 0
          ? Math.sin(angle * pleatCount) * pleatDepth * (0.35 + 0.65 * pleatEnv)
          : 0.0;
        // Secondary organic couture drape fold harmonic
        const drapeHarmonic = Math.cos(angle * 7 + 0.4) * 0.006 * Math.pow(v, 1.4);

        const effRx = rx + pleatWave + drapeHarmonic;
        const effRz = rz + pleatWave + drapeHarmonic;

        const x = cosA * effRx;
        const z = centerZ + sinA * effRz;

        // Pin / Tailoring Weight calculation:
        // - Top row (r == 0) at shoulder straps is strongly pinned to avatar shoulders (0.95)
        // - Top neckline row (r == 0..1) is softly tailored so the bodice stays up (0.65..0.85)
        // - Waistband (v near waistRowFrac) has gentle elastic tailoring (0.18 * waistCinch)
        // - Skirt (v > waistRowFrac + 0.04) is 100% free-simulating (0.0)
        let pinStrength = 0.0;
        if (r === 0) {
          const strapMask = Math.exp(-Math.pow((Math.abs(cosA) - 0.82) / Math.max(0.08, strapWidth * 2.2), 2));
          pinStrength = 0.72 + 0.26 * strapMask;
        } else if (r === 1) {
          pinStrength = 0.42;
        } else if (r === 2) {
          pinStrength = 0.18;
        } else if (Math.abs(v - waistRowFrac) < 0.035) {
          pinStrength = 0.14 * waistCinch;
        }

        const idx4 = (r * numCols + c) * 4;
        initialPositions[idx4 + 0] = x;
        initialPositions[idx4 + 1] = y;
        initialPositions[idx4 + 2] = z;
        initialPositions[idx4 + 3] = pinStrength;

        anchorTargets[idx4 + 0] = x;
        anchorTargets[idx4 + 1] = y;
        anchorTargets[idx4 + 2] = z;
        anchorTargets[idx4 + 3] = pinStrength;

        // Panel ID: 0 = Front Bodice, 1 = Back Bodice, 2 = Front Skirt, 3 = Back Skirt
        const isFront = sinA >= 0;
        const isBodice = v <= waistRowFrac;
        const panelId = isBodice ? (isFront ? 0 : 1) : (isFront ? 2 : 3);
        const pleatPhase = pleatCount > 0 ? Math.sin(angle * pleatCount) : 0;

        uvsAndPanel[idx4 + 0] = u;
        uvsAndPanel[idx4 + 1] = v;
        uvsAndPanel[idx4 + 2] = panelId;
        uvsAndPanel[idx4 + 3] = pleatPhase;
      }
    }

    // Precompute exact rest lengths for every vertex (c, r):
    // [weftRight, warpDown, shearDiagRightDown, bendRight2]
    const distBetween = (c0, r0, c1, r1) => {
      const i0 = (r0 * numCols + ((c0 + numCols) % numCols)) * 4;
      const i1 = (r1 * numCols + ((c1 + numCols) % numCols)) * 4;
      const dx = initialPositions[i1] - initialPositions[i0];
      const dy = initialPositions[i1 + 1] - initialPositions[i0 + 1];
      const dz = initialPositions[i1 + 2] - initialPositions[i0 + 2];
      return Math.max(0.002, Math.hypot(dx, dy, dz));
    };

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const idx4 = (r * numCols + c) * 4;
        // 0: Weft right neighbor (c+1, r)
        restLengths[idx4 + 0] = distBetween(c, r, c + 1, r);
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

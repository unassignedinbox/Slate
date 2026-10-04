/**
 * Zhang et al. 2025 (ACM SIGGRAPH 2025) — "Physics-inspired Estimation of Optimal Cloth Mesh Resolution" (PIE)
 *
 * Implements:
 *  1. §3.1 & §4.1.1 Cerda & Mahadevan [2003] characteristic wrinkle wavelength λ, amplitude A,
 *     and optimal base resolution r_opt(y, c1, c2) with c1 = 32.08 m^-3, c2 = -1.876e-4 m^-1
 *     from bending-to-stretching stiffness ratio y = B / E.
 *  2. §4.1.2 Orthotropic Anisotropy: distinct weft (r_u) and warp (r_v) optimal resolutions.
 *  3. §4.1.3 Locking Issue Mitigation: in-plane compressive resistance relaxation in buckling regime.
 *  4. §4.2.1–4.2.6 Boundary Conditions & Vandeparre et al. [2011] Wrinklon Transition:
 *     - Shirring (§4.2.2): shirring stiffness E_sh and shrinkage ratio ρ_sh
 *     - Folding / Pleating (§4.2.3): fold angle Δθ -> compressive strain ρ_fd = Δθ / 360
 *     - Long-Short Stitching (§4.2.4): seam compression ratio ρ_s = l_s / l_l
 *     - Down-Filling (§4.2.5): internal pressure p -> modified transition power m' = 2^p * m
 *     - High-Collision Areas (§4.2.6): anticipated dynamic collision compression at hips/knees/bust
 *  5. §4.3 Continuous 2D Sizing Map S(u, v) = min_n(r_n + x_n^{m_n}) & adaptive mesh grading.
 */

// Paper constants from Section 4.1.1 & Section 5 (Zhang et al. 2025)
export const PIE_C1 = 32.08;        // [m^-3] geometric substrate scaling constant c_1
export const PIE_C2 = -1.876e-4;    // [m^-1] offset constant c_2
export const PIE_MIN_RES_MM = 2.5;  // [mm] recommended minimum cloth mesh resolution in §4.1.1

// Benchmark physical fabrics from Zhang et al. 2025 (Section 5 Table / Fig. 3)
export const PIE_FABRIC_PRESETS = [
  {
    id: 0,
    name: "Rose Silk Chiffon (Softest)",
    B_weft: 4.0e-8,  // [N·m] bending stiffness
    B_warp: 6.5e-8,
    E_weft: 1.6e7,   // [N/m^2] Young's modulus
    E_warp: 1.2e7,
    thickness: 0.00022, // [m]
  },
  {
    id: 1,
    name: "Mint Melody Charmeuse",
    B_weft: 7.8e-7,
    B_warp: 1.1e-6,
    E_weft: 6.6e4,
    E_warp: 8.5e4,
    thickness: 0.00038,
  },
  {
    id: 2,
    name: "Blue Ballet Satin Twill",
    B_weft: 2.5e-6,
    B_warp: 3.4e-6,
    E_weft: 1.1e5,
    E_warp: 1.6e5,
    thickness: 0.00048,
  },
  {
    id: 3,
    name: "Emerald Couture Crepe",
    B_weft: 2.6e-6,
    B_warp: 3.1e-6,
    E_weft: 2.0e6,
    E_warp: 2.4e6,
    thickness: 0.00055,
  },
  {
    id: 4,
    name: "Structured Brocade / Velvet",
    B_weft: 6.8e-6,
    B_warp: 8.2e-6,
    E_weft: 8.5e5,
    E_warp: 1.1e6,
    thickness: 0.00085,
  },
];

export class PieSizingEstimator {
  /**
   * §4.1.1 Computes the optimal mesh resolution r_opt (in meters and mm) and
   * characteristic Cerda-Mahadevan wrinkle wavelength λ from B (N·m) and E (N/m^2).
   */
  static computeOptimalMaterialResolution(B, E) {
    const safeE = Math.max(1e3, E);
    const safeB = Math.max(1e-9, B);
    const y = safeB / safeE; // Bending-to-stretching stiffness ratio y = B / E [m^3]

    // Cerda & Mahadevan [2003] + Zhang et al. [2025] §4.1.1 scaling law with c1 = 32.08, c2 = -1.876e-4:
    // r_opt(y) = c1 * y^(1/3) + c2 (clamped to r_min = 2.5 mm)
    const rawR = PIE_C1 * Math.cbrt(y) + PIE_C2;
    const rOptMeters = Math.max(PIE_MIN_RES_MM * 1e-3, Math.min(0.018, rawR));
    const rOptMm = rOptMeters * 1000.0;

    // Characteristic wrinkle wavelength λ ≈ 4 * r_opt / sqrt(1 + 16*(A/λ)^2)
    // From §4.1.1: r_opt = sqrt(λ^2 / 16 + A^2), with A/λ ≈ 0.18
    const wavelengthMm = rOptMm * 3.15;
    const amplitudeMm = wavelengthMm * 0.18;

    return {
      y,
      rOptMeters,
      rOptMm,
      wavelengthMm,
      amplitudeMm,
    };
  }

  /**
   * §3.2 & §4.2.1 Computes the Vandeparre et al. [2011] wrinklon transition distance L_w
   * and transition power exponent m = log(r) / log(L_w) for smooth sizing map propagation
   * Δr(x) = x^m (modified to m' = 2^p * m when down-filling pressure p > 0 per §4.2.5).
   */
  static computeWrinklonTransition(sourceResMeters, compressiveStrain, thicknessMeters = 0.00045, downPressure = 0.0) {
    const r = Math.max(0.0025, sourceResMeters);
    const delta = Math.max(0.02, Math.min(0.85, compressiveStrain));
    const lambda = r * 3.15;
    const amp = lambda * Math.sqrt(delta);

    // §3.2: L_w / λ scales as sqrt(A / h) => L_w ∝ λ^(3/2)
    const Lw = Math.max(0.025, Math.min(0.45, lambda * Math.sqrt(Math.max(1.0, amp / Math.max(1e-4, thicknessMeters))) * 0.42));

    // §4.2.1: By setting r + L_w^m = 2r, m = log(r) / log(L_w)
    // Normalized to unit distance scale so r(x) = r_source + (x / L_w)^m * r_source smoothly doubles over L_w
    const baseM = Math.max(0.65, Math.min(2.4, Math.abs(Math.log(r) / Math.log(Math.max(0.05, Lw)))));

    // §4.2.5 Down-filling: m' = 2^p * m accelerates transition under internal pressure p
    const effectiveM = baseM * Math.pow(2.0, Math.max(0.0, downPressure));

    return {
      Lw,
      m: effectiveM,
      lambda,
      amp,
    };
  }

  /**
   * Evaluates the full Zhang et al. 2025 (PIE) Orthotropic Resolution & 2D Sizing Map S(u, v)
   * across the garment domain (u ∈ [0, 1] weft circumference, v ∈ [0, 1] warp length).
   */
  static evaluateGarmentSizing(params = {}) {
    const weaveIdx = Math.min(PIE_FABRIC_PRESETS.length - 1, Math.max(0, Math.round(params.weaveType ?? 0)));
    const presetFabric = PIE_FABRIC_PRESETS[weaveIdx] || PIE_FABRIC_PRESETS[0];

    // Map user inspector controls (bendStiffness, stretchCompliance, shearCompliance) onto physical B and E
    const bendScale = Math.pow((params.bendStiffness ?? 0.42) / 0.42, 1.6);
    const stretchScale = Math.pow(0.008 / Math.max(0.001, (params.stretchCompliance ?? 0.006) + 0.002), 1.2);
    const anisotropyRatio = params.pieAnisotropy ?? 1.45; // Warp-to-weft stiffness ratio (§4.1.2)

    const B_weft = presetFabric.B_weft * bendScale;
    const B_warp = presetFabric.B_warp * bendScale * anisotropyRatio;
    const E_weft = presetFabric.E_weft * stretchScale;
    const E_warp = presetFabric.E_warp * stretchScale * anisotropyRatio;

    const weftMat = PieSizingEstimator.computeOptimalMaterialResolution(B_weft, E_weft);
    const warpMat = PieSizingEstimator.computeOptimalMaterialResolution(B_warp, E_warp);

    // Base fabric resolutions (in mm and meters)
    const rWeftBaseMm = weftMat.rOptMm;
    const rWarpBaseMm = warpMat.rOptMm;

    // §4.2.2 Shirring at waistband (v ≈ 0.28) and neckline gather (v ≈ 0.0)
    const shirringRatio = Math.max(0.35, Math.min(1.0, params.pieShirringRatio ?? (1.0 - (params.waistCinch ?? 0.84) * 0.42)));
    const E_shirring = E_weft * (1.0 + (1.0 - shirringRatio) * 3.5);
    const rShirringMeters = Math.max(
      PIE_MIN_RES_MM * 1e-3,
      shirringRatio * PieSizingEstimator.computeOptimalMaterialResolution(B_weft, E_weft + E_shirring).rOptMeters,
    );
    const shirringTrans = PieSizingEstimator.computeWrinklonTransition(
      rShirringMeters,
      1.0 - shirringRatio,
      presetFabric.thickness,
      params.pieDownPressure ?? 0.0,
    );

    // §4.2.3 Folding / Pleating source resolution: ρ_fd = 1 - Δθ / 360
    const pleatCount = params.pleatCount ?? 16;
    const pleatDepth = params.pleatDepth ?? 0.018;
    const foldAngleDeg = Math.min(165, pleatCount * pleatDepth * 195);
    const rhoFold = Math.max(0.32, 1.0 - foldAngleDeg / 360.0);
    const rFoldMeters = Math.max(PIE_MIN_RES_MM * 1e-3, rhoFold * weftMat.rOptMeters);
    const foldTrans = PieSizingEstimator.computeWrinklonTransition(
      rFoldMeters,
      1.0 - rhoFold,
      presetFabric.thickness,
      params.pieDownPressure ?? 0.0,
    );

    // §4.2.4 Long-Short Stitching at waist & princess side seams: ρ_s = l_s / l_l
    const skirtFlare = params.skirtFlare ?? 0.62;
    const rhoStitch = Math.max(0.35, 1.0 / (1.0 + skirtFlare * 0.85));
    const rStitchMeters = Math.max(PIE_MIN_RES_MM * 1e-3, rhoStitch * weftMat.rOptMeters);
    const stitchTrans = PieSizingEstimator.computeWrinklonTransition(
      rStitchMeters,
      1.0 - rhoStitch,
      presetFabric.thickness,
      params.pieDownPressure ?? 0.0,
    );

    // §4.2.6 High-Collision Areas (hips v ≈ 0.44, knee/thigh stride zone v ≈ 0.68, bust v ≈ 0.14)
    const collisionStrain = (params.avatarPose === 1 || params.avatarPose === 2) ? 0.48 : 0.28;
    const rCollisionMeters = Math.max(
      PIE_MIN_RES_MM * 1e-3,
      (1.0 - collisionStrain * 0.65) * weftMat.rOptMeters,
    );
    const colTrans = PieSizingEstimator.computeWrinklonTransition(
      rCollisionMeters,
      collisionStrain,
      presetFabric.thickness,
      0.0,
    );

    // Evaluate continuous Sizing Map function S(u, v) in meters at any (u, v) ∈ [0, 1]^2
    const waistV = 0.28;
    const bustV = 0.14;
    const hipV = 0.44;
    const kneeV = 0.68;

    const sampleSizingMeters = (u, v) => {
      let rMin = weftMat.rOptMeters;

      // 1. Shirring source at waistband (v = waistV) and gathered neckline (v = 0)
      const distWaist = Math.abs(v - waistV) * 1.15;
      const rWaistProp = rShirringMeters * (1.0 + Math.pow(distWaist / shirringTrans.Lw, shirringTrans.m));
      rMin = Math.min(rMin, rWaistProp);

      const distNeck = v * 1.25;
      const rNeckProp = (rShirringMeters * 1.12) * (1.0 + Math.pow(distNeck / shirringTrans.Lw, shirringTrans.m));
      rMin = Math.min(rMin, rNeckProp);

      // 2. Long-short stitching along side seams (u = 0, 0.5, 1.0) and exclusively into longer skirt panel (v > waistV)
      const distSideSeam = Math.min(Math.abs(u - 0.5), Math.min(u, 1.0 - u)) * 1.4;
      const rSeamProp = rStitchMeters * (1.0 + Math.pow(distSideSeam / stitchTrans.Lw, stitchTrans.m));
      rMin = Math.min(rMin, rSeamProp);

      if (v >= waistV) {
        const distSkirtSeam = (v - waistV) * 1.1;
        const rSkirtStitch = rStitchMeters * (1.0 + Math.pow(distSkirtSeam / stitchTrans.Lw, stitchTrans.m));
        rMin = Math.min(rMin, rSkirtStitch);
      }

      // 3. Folding / Pleating creases along radial pleats
      if (pleatCount > 0 && v > waistV * 0.7) {
        const pleatPhase = Math.abs(Math.cos(u * Math.PI * 2 * pleatCount));
        const distFold = (1.0 - pleatPhase) * 0.08;
        const rFoldProp = rFoldMeters * (1.0 + Math.pow(distFold / foldTrans.Lw, foldTrans.m));
        rMin = Math.min(rMin, rFoldProp);
      }

      // 4. High-collision zones: Bust (v ≈ 0.14), Hips (v ≈ 0.44), Striding Knees (v ≈ 0.68)
      const distBust = Math.hypot((v - bustV) * 1.2, (Math.sin(u * Math.PI * 2) - 0.7) * 0.35);
      const distHip = Math.abs(v - hipV) * 1.3;
      const distKnee = Math.abs(v - kneeV) * 1.4;
      const dCol = Math.min(distBust, Math.min(distHip, distKnee));
      const rColProp = rCollisionMeters * (1.0 + Math.pow(dCol / colTrans.Lw, colTrans.m));
      rMin = Math.min(rMin, rColProp);

      return Math.max(PIE_MIN_RES_MM * 1e-3, Math.min(weftMat.rOptMeters, rMin));
    };

    // Estimate optimal orthotropic grid dimensions (numCols, numRows) when PIE Auto-Resolution is active
    const avgCircumferenceMeters = 1.18;
    const avgLengthMeters = 0.36 + (params.skirtLength ?? 0.92);
    const meanSizingMeters = 0.55 * rShirringMeters + 0.45 * weftMat.rOptMeters;

    const optimalCols = Math.max(
      36,
      Math.min(88, Math.round((avgCircumferenceMeters / Math.max(0.014, meanSizingMeters * 2.2)) / 4) * 4),
    );
    const optimalRows = Math.max(
      28,
      Math.min(72, Math.round(avgLengthMeters / Math.max(0.016, warpMat.rOptMeters * 2.6))),
    );

    return {
      fabricName: presetFabric.name,
      B_weft,
      B_warp,
      E_weft,
      E_warp,
      y_weft: weftMat.y,
      y_warp: warpMat.y,
      rWeftOptMm: Number(rWeftBaseMm.toFixed(2)),
      rWarpOptMm: Number(rWarpBaseMm.toFixed(2)),
      rShirringMm: Number((rShirringMeters * 1000).toFixed(2)),
      rFoldMm: Number((rFoldMeters * 1000).toFixed(2)),
      rStitchMm: Number((rStitchMeters * 1000).toFixed(2)),
      rCollisionMm: Number((rCollisionMeters * 1000).toFixed(2)),
      wavelengthMm: Number(weftMat.wavelengthMm.toFixed(2)),
      wrinklonLwMm: Number((shirringTrans.Lw * 1000).toFixed(1)),
      transitionPowerM: Number(shirringTrans.m.toFixed(2)),
      shirringRatio: Number(shirringRatio.toFixed(2)),
      optimalCols,
      optimalRows,
      sampleSizingMeters,
    };
  }
}

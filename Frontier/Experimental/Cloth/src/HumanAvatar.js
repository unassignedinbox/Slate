/**
 * Fabric-covered 3D Female & Male Tailoring Mannequin Avatars
 * - Supports a fitted female dress form and broad-shouldered male tailoring form
 * - Smooth faceless head, cloth-sheathed torso contours, soft bust shaping, and visible pattern seams
 * - Articulated, simplified arms and legs sized for garment fitting and simulation
 * - Rolling tailor's stand and 16-capsule SDF collisions + Custom Wavefront .OBJ Import
 */

export const POSE_MODES = [
  { id: 0, label: "Studio contrapposto" },
  { id: 1, label: "Runway catwalk" },
  { id: 2, label: "Couture twirl" },
  { id: 3, label: "Breeze sway" },
];

export const BODY_TYPES = [
  { id: 0, label: "Female fitting form" },
  { id: 1, label: "Male tailoring form" },
];

/**
 * Evaluates a smooth C¹/C² piecewise cubic Hermite spline through sorted (y, val) knots.
 */
function evalHermiteProfile(y, knots) {
  if (y <= knots[0][0]) return knots[0][1];
  const last = knots.length - 1;
  if (y >= knots[last][0]) return knots[last][1];

  let k = 0;
  while (k < last - 1 && y > knots[k + 1][0]) k++;

  const [y0, v0] = knots[k];
  const [y1, v1] = knots[k + 1];
  const h = Math.max(1e-6, y1 - y0);
  const t = (y - y0) / h;

  // Catmull-Rom / finite-difference tangents
  const m0 =
    k > 0
      ? 0.5 * ((v1 - v0) / h + (v0 - knots[k - 1][1]) / Math.max(1e-6, y0 - knots[k - 1][0]))
      : (v1 - v0) / h;
  const m1 =
    k + 2 <= last
      ? 0.5 * ((knots[k + 2][1] - v1) / Math.max(1e-6, knots[k + 2][0] - y1) + (v1 - v0) / h)
      : (v1 - v0) / h;

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * v0 + h10 * h * m0 + h01 * v1 + h11 * h * m1;
}

export class HumanAvatar {
  constructor(bodyType = 0) {
    this.bodyType = bodyType; // 0 = Female fitting form, 1 = Male tailoring form
    this.isCustomObj = false;
    this.capsuleCount = 16;
    // 16 capsules * 12 floats (vec4 pA_rA, vec4 pB_rB, vec4 vel_pad)
    this.capsuleData = new Float32Array(this.capsuleCount * 12);
    this.prevCapsuleCenters = new Float32Array(this.capsuleCount * 3);
    this.hasPrevCapsules = false;

    // Avatar root motion state for upper-bodice / strap attachment in WGSL
    this.motionState = {
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      yaw: 0,
      yawVelocity: 0,
      hipSwingX: 0,
      shoulderTilt: 0,
    };

    this.twirlImpulse = 0;
    this.buildProceduralBody(this.bodyType);
  }

  triggerTwirl() {
    this.twirlImpulse = 2.6;
  }

  setBodyType(bodyType) {
    const nextType = bodyType ? 1 : 0;
    if (this.bodyType === nextType && !this.isCustomObj) return false;
    this.bodyType = nextType;
    this.isCustomObj = false;
    this.hasPrevCapsules = false;
    this.buildProceduralBody(this.bodyType);
    return true;
  }

  /**
   * Constructs a high-resolution fabric-covered tailoring form with a smooth, featureless head,
   * tailored torso contours, articulated limbs, and a wheeled display stand.
   */
  buildProceduralBody(bodyType = this.bodyType) {
    this.bodyType = bodyType ? 1 : 0;
    const isMale = this.bodyType === 1;

    const positions = [];
    const normals = [];
    const boneIds = []; // 0=mannequin / mounted stand, 1=leftLeg, 2=rightLeg, 3=leftArm, 4=rightArm, 5=static accessory
    const boneWeights = [];
    const indices = [];

    const addRingLoft = (rings, boneId) => {
      const baseVertex = positions.length / 3;
      const numRings = rings.length;
      const segs = rings[0].points.length;

      for (let r = 0; r < numRings; r++) {
        const ring = rings[r];
        for (let s = 0; s < segs; s++) {
          const p = ring.points[s];
          positions.push(p[0], p[1], p[2]);
          normals.push(0, 1, 0);
          boneIds.push(boneId);
          boneWeights.push(ring.weight ?? 0);
        }
      }

      for (let r = 0; r < numRings - 1; r++) {
        for (let s = 0; s < segs; s++) {
          const nextS = (s + 1) % segs;
          const i00 = baseVertex + r * segs + s;
          const i10 = baseVertex + r * segs + nextS;
          const i01 = baseVertex + (r + 1) * segs + s;
          const i11 = baseVertex + (r + 1) * segs + nextS;
          indices.push(i00, i01, i11);
          indices.push(i00, i11, i10);
        }
      }
    };

    const addRodBetween = (start, end, radius, boneId, segs = 14) => {
      const direction = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
      const length = Math.hypot(...direction) || 1;
      const axis = direction.map((value) => value / length);
      const reference = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let u = [
        axis[1] * reference[2] - axis[2] * reference[1],
        axis[2] * reference[0] - axis[0] * reference[2],
        axis[0] * reference[1] - axis[1] * reference[0],
      ];
      const uLength = Math.hypot(...u) || 1;
      u = u.map((value) => value / uLength);
      const v = [
        u[1] * axis[2] - u[2] * axis[1],
        u[2] * axis[0] - u[0] * axis[2],
        u[0] * axis[1] - u[1] * axis[0],
      ];
      const rings = [0, 0.055, 0.945, 1].map((t, ring) => {
        const center = start.map((value, i) => value + direction[i] * t);
        const r = radius * (ring === 0 || ring === 3 ? 0.82 : 1);
        const points = Array.from({ length: segs }, (_, s) => {
          const angle = (s / segs) * Math.PI * 2;
          const ca = Math.cos(angle) * r, sa = Math.sin(angle) * r;
          return [
            center[0] + u[0] * ca + v[0] * sa,
            center[1] + u[1] * ca + v[1] * sa,
            center[2] + u[2] * ca + v[2] * sa,
          ];
        });
        return { points, weight: 0 };
      });
      addRingLoft(rings, boneId);
    };

    const addVerticalWheel = (cx, cz, radius = 0.026, segs = 18, boneId = 0) => {
      const wheelRings = [-0.036, -0.028, 0.012, 0.022].map((y, i) => {
        const r = radius * (i === 0 || i === 3 ? 0.74 : 1);
        const points = Array.from({ length: segs }, (_, s) => {
          const a = (s / segs) * Math.PI * 2;
          return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
        });
        return { points, weight: 0 };
      });
      addRingLoft(wheelRings, boneId);
    };

    // =========================================================================
    // 1. TORSO + PELVIS + TRAPEZIUS + NECK + FEATURELESS DRESS-FORM HEAD LOFT
    // =========================================================================
    // Keyframe knots: [y_meters, rx_halfWidth, rz_halfDepth, centerZ_offset]
    const femaleTorsoKnots = [
      [0.775, 0.012, 0.012, -0.008], // Perineum / lower pelvic floor cap
      [0.805, 0.126, 0.095, -0.010], // Lower pelvis / sub-gluteal
      [0.865, 0.168, 0.114, -0.012], // Gluteal maximum & hip trochanter
      [0.915, 0.174, 0.112, -0.008], // Iliac hip crest
      [0.985, 0.142, 0.098, -0.002], // High hip / lower abdomen
      [1.050, 0.120, 0.089,  0.002], // Sculpted hourglass natural waist
      [1.135, 0.132, 0.096,  0.004], // Lower ribcage
      [1.235, 0.146, 0.104,  0.005], // Bust / mid-thorax level
      [1.315, 0.156, 0.098,  0.002], // Upper chest / sub-clavicle
      [1.372, 0.176, 0.094, -0.004], // Lateral clavicle / acromion shoulder peak
      [1.405, 0.118, 0.074, -0.005], // Sloping trapezius mid-ridge
      [1.438, 0.056, 0.055, -0.002], // Base of neck (cervical C7)
      [1.480, 0.049, 0.051,  0.002], // Mid-neck column
      [1.515, 0.051, 0.054,  0.006], // Upper neck / submental jaw transition
      [1.555, 0.063, 0.078,  0.012], // Mandibular jaw & chin level
      [1.605, 0.072, 0.089,  0.010], // Zygomatic cheekbones & mid-face
      [1.655, 0.075, 0.092,  0.002], // Forehead & parietal cranium
      [1.702, 0.056, 0.070, -0.004], // Upper cranial dome
      [1.730, 0.002, 0.002, -0.006], // Crown apex
    ];

    const maleTorsoKnots = [
      [0.775, 0.014, 0.014, -0.008], // Lower pelvic cap
      [0.805, 0.128, 0.096, -0.010], // Lower pelvis
      [0.870, 0.156, 0.110, -0.012], // Male glutes & hip trochanter
      [0.925, 0.158, 0.108, -0.006], // Iliac crest
      [0.990, 0.148, 0.104,  0.000], // External oblique flank
      [1.045, 0.142, 0.102,  0.002], // Athletic male waist
      [1.140, 0.158, 0.110,  0.004], // Lower ribcage & serratus anterior
      [1.245, 0.178, 0.118,  0.006], // Broad latissimus dorsi & pectorals
      [1.320, 0.190, 0.112,  0.002], // Upper pectorals & deltoid junction
      [1.380, 0.204, 0.104, -0.005], // Broad male acromion shoulder peak
      [1.418, 0.136, 0.082, -0.006], // Muscular trapezius slope
      [1.450, 0.064, 0.063, -0.002], // Thick cervical neck base
      [1.490, 0.058, 0.060,  0.002], // Mid-neck column
      [1.522, 0.060, 0.063,  0.006], // Upper neck / jaw base
      [1.562, 0.070, 0.084,  0.013], // Square male mandible & chin
      [1.612, 0.076, 0.093,  0.010], // Cheekbones & nasal bridge
      [1.665, 0.079, 0.096,  0.002], // Brow ridge & cranium
      [1.712, 0.058, 0.072, -0.004], // Upper cranial vault
      [1.740, 0.002, 0.002, -0.006], // Crown apex
    ];

    const knots = isMale ? maleTorsoKnots : femaleTorsoKnots;
    const rxKnots = knots.map((k) => [k[0], k[1]]);
    const rzKnots = knots.map((k) => [k[0], k[2]]);
    const czKnots = knots.map((k) => [k[0], k[3]]);

    const minY = knots[0][0];
    const maxY = knots[knots.length - 1][0];
    const torsoSegs = 72;
    const torsoSteps = 112;
    const torsoRings = [];

    for (let i = 0; i <= torsoSteps; i++) {
      const t = i / torsoSteps;
      const y = minY + t * (maxY - minY);

      const baseRx = evalHermiteProfile(y, rxKnots);
      const baseRz = evalHermiteProfile(y, rzKnots);
      const baseCz = evalHermiteProfile(y, czKnots);

      const points = [];
      for (let s = 0; s < torsoSegs; s++) {
        const angle = (s / torsoSegs) * Math.PI * 2;
        const cosA = Math.cos(angle); // +X right, -X left
        const sinA = Math.sin(angle); // +Z front, -Z back

        // Squircle superellipse factor: human ribcage/waist is slightly flatter on front/back than a pure ellipse
        const squircle = 1.0 - 0.045 * Math.pow(Math.sin(2 * angle), 2) * (y < 1.42 ? 1.0 : 0.2);
        let x = cosA * baseRx * squircle;
        let z = baseCz + sinA * baseRz * squircle;

        // 1A. Anterior Chest: Female Sculpted Bust vs. Male Sculpted Pectorals
        if (!isMale) {
          // Female anatomical bust (y ∈ [1.13, 1.33], anterior z > 0)
          if (y > 1.12 && y < 1.34 && sinA > -0.1) {
            const dy = (y - 1.232) / 0.062;
            // Teardrop vertical asymmetry: fuller lower pole, gentler upper slope
            const bustVert = Math.exp(-dy * dy * (dy < 0 ? 1.35 : 0.85));
            const leftBreast = Math.exp(-Math.pow((x + 0.072) / 0.055, 2));
            const rightBreast = Math.exp(-Math.pow((x - 0.072) / 0.055, 2));
            const sternumValley = 0.16 * Math.exp(-Math.pow(x / 0.038, 2));
            const frontMask = Math.pow(Math.max(0, sinA), 1.15);
            const bustProj = 0.030 * bustVert * frontMask * (leftBreast + rightBreast + sternumValley);
            z += bustProj;
            x *= 1 + 0.05 * bustVert * (leftBreast + rightBreast);
          }
        } else {
          // Male sculpted pectoralis major plates (y ∈ [1.17, 1.35], anterior z > 0)
          if (y > 1.16 && y < 1.36 && sinA > 0) {
            const pecY = Math.exp(-Math.pow((y - 1.258) / 0.055, 2));
            // Broad flat-topped pectoral plates with sharp sternal cleavage groove
            const leftPec = Math.exp(-Math.pow((x + 0.082) / 0.068, 4));
            const rightPec = Math.exp(-Math.pow((x - 0.082) / 0.068, 4));
            const frontMask = Math.pow(sinA, 1.25);
            z += 0.010 * pecY * frontMask * (leftPec + rightPec);

            // Male rectus abdominis (subtle 6-pack & linea alba between y = 0.96 and 1.16)
          }
          if (y > 0.95 && y < 1.17 && sinA > 0.4) {
            const abEnv = Math.sin(((y - 0.95) / 0.22) * Math.PI);
            const abPair = Math.exp(-Math.pow((Math.abs(x) - 0.036) / 0.026, 2));
            const rows = 0.65 + 0.35 * Math.cos(((y - 0.98) / 0.055) * Math.PI * 2);
            z += 0.0015 * abEnv * abPair * rows * (sinA - 0.4);
          }
        }

        // 1B. Clavicle Ridge & Jugular Notch (y ≈ 1.365..1.385, front)
        if (y > 1.34 && y < 1.40 && sinA > 0.2) {
          const clavY = Math.exp(-Math.pow((y - 1.368) / 0.014, 2));
          const clavLateral = Math.exp(-Math.pow((Math.abs(x) - 0.075) / 0.055, 2));
          const jugularNotch = Math.exp(-Math.pow(x / 0.022, 2));
          z += (0.0025 * clavLateral - 0.0015 * jugularNotch) * clavY * sinA;
        }

        // 1C. Posterior Gluteal Lobe & Cleft Sculpting (y ∈ [0.79, 0.97], back z < 0)
        if (y > 0.79 && y < 0.98 && sinA < 0) {
          const gluteY = Math.exp(-Math.pow((y - 0.875) / 0.055, 2));
          const glutePeakX = isMale ? 0.062 : 0.068;
          const gluteAmp = isMale ? 0.006 : 0.008;
          const gluteLobes =
            Math.exp(-Math.pow((x + glutePeakX) / 0.055, 2)) +
            Math.exp(-Math.pow((x - glutePeakX) / 0.055, 2));
          const gluteCleft = Math.exp(-Math.pow(x / 0.018, 2));
          z -= gluteAmp * gluteY * Math.pow(-sinA, 1.3) * (gluteLobes - 0.38 * gluteCleft);
        }

        // 1D. Posterior Spinal Groove & Scapula (Shoulder Blades) (y ∈ [0.95, 1.36], back z < 0)
        if (y > 0.95 && y < 1.36 && sinA < -0.5) {
          const spineGroove = Math.exp(-Math.pow(x / 0.022, 2));
          const spineEnv = Math.sin(((y - 0.95) / 0.41) * Math.PI);
          z += 0.0015 * spineGroove * spineEnv * (-sinA - 0.5);
        }

        // 1E. Smooth featureless tailoring-form head: no sculpted face, ears, or expression.

        points.push([x, y, z]);
      }
      torsoRings.push({ points, weight: t });
    }
    addRingLoft(torsoRings, 0);

    // =========================================================================
    // 2. LEFT & RIGHT SCULPTED ANATOMICAL LEGS, KNEES, CALVES & FEET
    // =========================================================================
    // Starts at y = 0.885m inside the pelvis/glutes so there is a seamless hip-to-thigh transition
    const legRadiusKnotsF = [
      [0.010, 0.010, 0.012,  0.042], // Toe tip cap
      [0.022, 0.040, 0.088,  0.036], // Sculpted forefoot & sole
      [0.052, 0.034, 0.064,  0.014], // Instep arch & heel
      [0.088, 0.033, 0.038, -0.004], // Slender ankle / malleoli
      [0.180, 0.040, 0.043, -0.005], // Lower Achilles taper
      [0.335, 0.056, 0.060, -0.010], // Gastrocnemius calf peak
      [0.440, 0.049, 0.052, -0.003], // Sub-knee taper
      [0.490, 0.053, 0.056,  0.003], // Patella (kneecap) joint
      [0.640, 0.068, 0.072,  0.001], // Mid-thigh quadriceps
      [0.790, 0.083, 0.088, -0.003], // Upper thigh
      [0.865, 0.086, 0.092, -0.006], // Hip-thigh junction
      [0.895, 0.045, 0.050, -0.008], // Internal hip socket cap
    ];

    const legRadiusKnotsM = [
      [0.010, 0.012, 0.014,  0.046],
      [0.024, 0.044, 0.096,  0.038],
      [0.055, 0.038, 0.070,  0.014],
      [0.090, 0.038, 0.043, -0.004],
      [0.185, 0.046, 0.049, -0.006],
      [0.340, 0.064, 0.068, -0.012], // Muscular male calf
      [0.445, 0.055, 0.058, -0.003],
      [0.495, 0.059, 0.062,  0.004], // Male knee
      [0.645, 0.076, 0.080,  0.002], // Muscular quadriceps
      [0.790, 0.086, 0.091, -0.003],
      [0.865, 0.085, 0.090, -0.006],
      [0.895, 0.045, 0.050, -0.008],
    ];

    const legKnots = isMale ? legRadiusKnotsM : legRadiusKnotsF;
    const legRxK = legKnots.map((k) => [k[0], k[1]]);
    const legRzK = legKnots.map((k) => [k[0], k[2]]);
    const legCzK = legKnots.map((k) => [k[0], k[3]]);

    const buildLeg = (side, boneId) => {
      const legRings = [];
      const segs = 36;
      const steps = 54;
      const topY = 0.895;
      const botY = 0.010;

      const hipX = side * (isMale ? 0.088 : 0.090);
      const kneeX = side * (isMale ? 0.084 : 0.078);
      const ankleX = side * (isMale ? 0.080 : 0.072);

      const xKnots = [
        [0.010, ankleX],
        [0.090, ankleX],
        [0.490, kneeX],
        [0.895, hipX],
      ];

      for (let i = 0; i <= steps; i++) {
        const t = i / steps; // 0 = hip socket (0.895m), 1 = sole (0.010m)
        const y = topY * (1 - t) + botY * t;

        const cx = evalHermiteProfile(y, xKnots);
        const rx = evalHermiteProfile(y, legRxK);
        const rz = evalHermiteProfile(y, legRzK);
        const cz = evalHermiteProfile(y, legCzK);

        const points = [];
        for (let s = 0; s < segs; s++) {
          const angle = (s / segs) * Math.PI * 2;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);

          let lx = cx + cosA * rx;
          let ly = y;
          let lz = cz + sinA * rz;

          // Subtle patella (kneecap) anterior relief at y ≈ 0.49m
          if (y > 0.45 && y < 0.53 && sinA > 0.3) {
            const kneeEnv = Math.exp(-Math.pow((y - 0.49) / 0.024, 2));
            lz += 0.005 * kneeEnv * Math.pow(sinA, 2.0);
          }

          // Flat plantar sole clamping at bottom of foot
          if (ly < 0.012) ly = 0.012;

          points.push([lx, ly, lz]);
        }
        legRings.push({ points, weight: t });
      }
      addRingLoft(legRings, boneId);
    };
    buildLeg(-1, 1); // Left leg
    buildLeg(1, 2);  // Right leg

    // =========================================================================
    // 3. LEFT & RIGHT SCULPTED ARMS, DELTOIDS, FOREARMS & HANDS (BISHOP FRAME)
    // =========================================================================
    // Uses an exact orthonormal frame perpendicular to the arm tangent curve so
    // deltoid caps, elbows, wrists, and sculpted hands never shear or pinch.
    const buildArm = (side, boneId) => {
      const armRings = [];
      const segs = 32;
      const steps = 48;

      const shX = isMale ? 0.184 : 0.160;
      const elX = isMale ? 0.258 : 0.236;
      const wrX = isMale ? 0.308 : 0.288;
      const fnX = isMale ? 0.322 : 0.302;

      // Smooth 3D arm centerline knots [t, x, y, z, rMajor_mediolateral, rMinor_anteroposterior]
      const armKnots = [
        [0.00, side * (shX - 0.035), 1.378, -0.006, 0.004, 0.004], // Internal shoulder socket cap
        [0.06, side * shX,           1.372, -0.008, isMale ? 0.056 : 0.047, isMale ? 0.054 : 0.046], // Rounded deltoid cap
        [0.24, side * (shX + (elX - shX) * 0.48), 1.245, -0.016, isMale ? 0.048 : 0.039, isMale ? 0.049 : 0.040], // Biceps / triceps belly
        [0.44, side * elX,           1.120, -0.022, isMale ? 0.041 : 0.034, isMale ? 0.039 : 0.033], // Elbow joint
        [0.56, side * (elX + (wrX - elX) * 0.32), 1.045, -0.010, isMale ? 0.043 : 0.035, isMale ? 0.040 : 0.033], // Forearm brachioradialis swell
        [0.80, side * wrX,           0.885,  0.016, isMale ? 0.030 : 0.025, isMale ? 0.022 : 0.018], // Smooth wrist cuff
        [0.90, side * (wrX + (fnX - wrX) * 0.55), 0.825,  0.026, isMale ? 0.032 : 0.028, isMale ? 0.023 : 0.020], // Seamless palm
        [0.97, side * fnX,           0.786,  0.032, isMale ? 0.023 : 0.020, isMale ? 0.016 : 0.014], // Soft mitten-shaped hand
        [1.00, side * (fnX + 0.003), 0.778,  0.034, 0.006, 0.006], // Rounded hand cap
      ];

      const axK = armKnots.map((k) => [k[0], k[1]]);
      const ayK = armKnots.map((k) => [k[0], k[2]]);
      const azK = armKnots.map((k) => [k[0], k[3]]);
      const rMajK = armKnots.map((k) => [k[0], k[4]]);
      const rMinK = armKnots.map((k) => [k[0], k[5]]);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = evalHermiteProfile(t, axK);
        const cy = evalHermiteProfile(t, ayK);
        const cz = evalHermiteProfile(t, azK);
        const rMaj = evalHermiteProfile(t, rMajK);
        const rMin = evalHermiteProfile(t, rMinK);

        // Compute tangent T along arm centerline
        const dt = 0.005;
        const tNext = Math.min(1.0, t + dt);
        const tPrev = Math.max(0.0, t - dt);
        let tx = evalHermiteProfile(tNext, axK) - evalHermiteProfile(tPrev, axK);
        let ty = evalHermiteProfile(tNext, ayK) - evalHermiteProfile(tPrev, ayK);
        let tz = evalHermiteProfile(tNext, azK) - evalHermiteProfile(tPrev, azK);
        const tLen = Math.hypot(tx, ty, tz) || 1;
        tx /= tLen;
        ty /= tLen;
        tz /= tLen;

        // Orthonormal frame: B = normalize(T × [0, 0, 1]), N = B × T
        let bx = ty * 1.0 - tz * 0.0;
        let by = tz * 0.0 - tx * 1.0;
        let bz = tx * 0.0 - ty * 0.0;
        const bLen = Math.hypot(bx, by, bz) || 1;
        bx /= bLen;
        by /= bLen;
        bz /= bLen;

        const nx = by * tz - bz * ty;
        const ny = bz * tx - bx * tz;
        const nz = bx * ty - by * tx;

        const points = [];
        for (let s = 0; s < segs; s++) {
          const angle = (s / segs) * Math.PI * 2;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);

          // Smooth hand shell keeps the dress-form silhouette neutral and unexpressive.
          const uComp = cosA * rMaj;
          const vComp = sinA * rMin;

          points.push([
            cx + bx * uComp + nx * vComp,
            cy + by * uComp + ny * vComp,
            cz + bz * uComp + nz * vComp,
          ]);
        }
        armRings.push({ points, weight: t });
      }
      addRingLoft(armRings, boneId);
    };
    buildArm(-1, 3); // Left arm
    buildArm(1, 4);  // Right arm

    // =========================================================================
    // 4. TAILOR'S FORM STAND: rear post, four steel spokes, and caster wheels
    // =========================================================================
    // The post follows the mannequin's gentle yaw; the cross base remains planted on the stage.
    addRodBetween([0, 0.024, -0.155], [0, 0.805, -0.155], 0.011, 0);
    const standCenter = [0, 0.026, -0.155];
    const wheelPoints = [
      [0.32, -0.155], [-0.32, -0.155], [0, 0.17], [0, -0.48],
    ];
    for (const [x, z] of wheelPoints) {
      addRodBetween(standCenter, [x, 0.026, z], 0.014, 0, 12);
      addVerticalWheel(x, z);
    }
    addVerticalWheel(standCenter[0], standCenter[2], 0.032);

    this.vertexCount = positions.length / 3;
    this.indexCount = indices.length;
    this.basePositions = new Float32Array(positions);
    this.positions = new Float32Array(positions);
    this.normals = new Float32Array(normals);
    this.boneIds = new Uint8Array(boneIds);
    this.boneWeights = new Float32Array(boneWeights);
    this.indices = new Uint32Array(indices);
    // Interleaved [px, py, pz, nx, ny, nz] for GPU vertex upload
    this.interleaved = new Float32Array(this.vertexCount * 6);

    this.computeBaseNormals();
    this.baseNormals = new Float32Array(this.normals);
    this.evaluatePose(0, 0.016, { avatarBodyType: this.bodyType });
  }

  computeBaseNormals() {
    this.normals.fill(0);
    const pos = this.basePositions;
    const ind = this.indices;
    for (let i = 0; i < ind.length; i += 3) {
      const i0 = ind[i] * 3;
      const i1 = ind[i + 1] * 3;
      const i2 = ind[i + 2] * 3;
      const ax = pos[i1] - pos[i0];
      const ay = pos[i1 + 1] - pos[i0 + 1];
      const az = pos[i1 + 2] - pos[i0 + 2];
      const bx = pos[i2] - pos[i0];
      const by = pos[i2 + 1] - pos[i0 + 1];
      const bz = pos[i2 + 2] - pos[i0 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      this.normals[i0] += nx;
      this.normals[i0 + 1] += ny;
      this.normals[i0 + 2] += nz;
      this.normals[i1] += nx;
      this.normals[i1 + 1] += ny;
      this.normals[i1 + 2] += nz;
      this.normals[i2] += nx;
      this.normals[i2 + 1] += ny;
      this.normals[i2 + 2] += nz;
    }
    for (let v = 0; v < this.vertexCount; v++) {
      const j = v * 3;
      const len = Math.hypot(this.normals[j], this.normals[j + 1], this.normals[j + 2]) || 1;
      this.normals[j] /= len;
      this.normals[j + 1] /= len;
      this.normals[j + 2] /= len;
    }
  }

  /**
   * Evaluates the articulated pose at `time` (seconds) and updates:
   * 1. `this.interleaved` (vertex positions + normals for GPU rendering)
   * 2. `this.capsuleData` (16 world-space anatomical capsules + velocities for WebGPU cloth collision)
   * 3. `this.motionState` (upper-body transform for dress shoulder/bodice pins)
   */
  evaluatePose(time, dt = 0.016, params = {}) {
    const requestedBodyType = params.avatarBodyType ?? this.bodyType;
    if (!this.isCustomObj && requestedBodyType !== this.bodyType) {
      this.setBodyType(requestedBodyType);
    }

    const isMale = this.bodyType === 1;
    const poseMode = params.avatarPose ?? 0;
    const motionSpeed = params.avatarMotionSpeed ?? 1.0;
    const t = time * motionSpeed;

    if (this.twirlImpulse > 0) {
      this.twirlImpulse = Math.max(0, this.twirlImpulse - dt);
    }

    let yaw = 0;
    let hipSwingX = 0;
    let hipBobY = 0;
    let legSwing = 0;
    let armSwing = 0;
    let torsoSwayX = 0;

    // Impulse twirl spin smoothly adds 1 full revolution
    const twirlProgress = this.twirlImpulse > 0 ? 1 - this.twirlImpulse / 2.6 : 0;
    const impulseYaw =
      this.twirlImpulse > 0
        ? Math.PI * 2 * (0.5 - 0.5 * Math.cos(twirlProgress * Math.PI))
        : 0;

    if (poseMode === 0) {
      // Studio contrapposto: gentle breathing & natural weight shift
      hipSwingX = Math.sin(t * 1.3) * (isMale ? 0.010 : 0.014);
      hipBobY = Math.sin(t * 2.6) * 0.003;
      torsoSwayX = -Math.sin(t * 1.3) * 0.008;
      armSwing = Math.sin(t * 1.3) * 0.04;
      yaw = impulseYaw;
    } else if (poseMode === 1) {
      // Runway catwalk stride
      const walkFreq = 3.2;
      legSwing = Math.sin(t * walkFreq) * 0.34;
      hipSwingX = Math.cos(t * walkFreq) * (isMale ? 0.022 : 0.034);
      hipBobY = Math.abs(Math.sin(t * walkFreq)) * 0.014 - 0.007;
      torsoSwayX = -Math.cos(t * walkFreq) * 0.018;
      armSwing = -Math.sin(t * walkFreq) * 0.22;
      yaw = impulseYaw + Math.sin(t * walkFreq) * 0.07;
    } else if (poseMode === 2) {
      // Couture twirl
      yaw = t * 1.85 + impulseYaw;
      hipSwingX = Math.sin(t * 2.0) * 0.018;
      hipBobY = Math.sin(t * 3.7) * 0.006;
      armSwing = 0.14;
    } else if (poseMode === 3) {
      // Breeze sway
      hipSwingX = Math.sin(t * 1.8) * 0.042;
      torsoSwayX = Math.sin(t * 1.8 - 0.6) * 0.028;
      legSwing = Math.sin(t * 0.9) * 0.08;
      armSwing = Math.cos(t * 1.8) * 0.12;
      yaw = impulseYaw + Math.sin(t * 0.9) * 0.18;
    }

    const prevYaw = this.motionState.yaw;
    this.motionState.yaw = yaw;
    this.motionState.yawVelocity = dt > 1e-4 ? (yaw - prevYaw) / dt : 0;
    this.motionState.hipSwingX = hipSwingX;
    this.motionState.offsetY = hipBobY;
    this.motionState.shoulderTilt = torsoSwayX;
    this.motionState.armSwing = armSwing;
    this.motionState.torsoSwayX = torsoSwayX;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    // Helper to transform a base point according to boneId and weight
    const transformPoint = (x, y, z, boneId, w) => {
      if (boneId === 5) {
        // Plinth stays stationary on studio floor
        return [x, y, z];
      }

      let lx = x;
      let ly = y + hipBobY;
      let lz = z;

      if (boneId === 0) {
        // Torso & head: hip sway near pelvis, counter-sway near shoulders
        const hipInfluence = Math.max(0, 1 - Math.abs(y - 0.90) / 0.32);
        const upperInfluence = Math.max(0, Math.min(1, (y - 1.02) / 0.45));
        lx += hipSwingX * hipInfluence + torsoSwayX * upperInfluence;
      } else if (boneId === 1 || boneId === 2) {
        // Left (1) or Right (2) Leg swing around hip joint (y = 0.85m)
        const sign = boneId === 1 ? 1 : -1;
        const swingAngle = sign * legSwing;
        const kneeBend = Math.max(0, -swingAngle) * 0.55 * Math.max(0, (w - 0.42) / 0.58);
        const effAngle = swingAngle * Math.min(1, w * 1.35) - kneeBend;

        const dy = ly - 0.85;
        const dz = lz;
        const c = Math.cos(effAngle);
        const s = Math.sin(effAngle);
        ly = 0.85 + dy * c - dz * s;
        lz = dy * s + dz * c;
        lx += hipSwingX * (1 - w * 0.75);
      } else if (boneId === 3 || boneId === 4) {
        // Left (3) or Right (4) Arm swing around shoulder joint (y = 1.375m)
        const sign = boneId === 3 ? 1 : -1;
        const aAngle = sign * armSwing * w;
        const dy = ly - 1.375;
        const dz = lz + 0.008;
        const c = Math.cos(aAngle);
        const s = Math.sin(aAngle);
        ly = 1.375 + dy * c - dz * s;
        lz = -0.008 + dy * s + dz * c;
        lx += torsoSwayX;
      }

      // Apply global avatar yaw rotation around Y axis
      const wx = lx * cosY + lz * sinY;
      const wz = -lx * sinY + lz * cosY;
      return [wx, ly, wz];
    };
    this.transformPoint = transformPoint;
    this.transformNormal = (nx, ny, nz, boneId, w = 0) => {
      let ly = ny;
      let lz = nz;
      if (boneId === 3 || boneId === 4) {
        const sign = boneId === 3 ? 1 : -1;
        const aAngle = sign * armSwing * w;
        const c = Math.cos(aAngle);
        const s = Math.sin(aAngle);
        ly = ny * c - nz * s;
        lz = ny * s + nz * c;
      }
      return [nx * cosY + lz * sinY, ly, -nx * sinY + lz * cosY];
    };

    // Update all mesh vertices and normals
    const baseP = this.basePositions;
    const baseN = this.baseNormals;
    const out = this.interleaved;
    for (let v = 0; v < this.vertexCount; v++) {
      const i3 = v * 3;
      const i6 = v * 6;
      const bId = this.boneIds[v];
      const w = this.boneWeights[v];

      const [wx, wy, wz] = transformPoint(baseP[i3], baseP[i3 + 1], baseP[i3 + 2], bId, w);
      out[i6] = wx;
      out[i6 + 1] = wy;
      out[i6 + 2] = wz;

      if (bId === 5) {
        out[i6 + 3] = baseN[i3];
        out[i6 + 4] = baseN[i3 + 1];
        out[i6 + 5] = baseN[i3 + 2];
      } else {
        out[i6 + 3] = baseN[i3] * cosY + baseN[i3 + 2] * sinY;
        out[i6 + 4] = baseN[i3 + 1];
        out[i6 + 5] = -baseN[i3] * sinY + baseN[i3 + 2] * cosY;
      }
    }

    // Update the 16 anatomical collision capsules in world space (adapted for Female vs. Male anatomy)
    // Each capsule: [ax, ay, az, rA, bx, by, bz, rB, boneId, wA, wB]
    const shX = isMale ? 0.180 : 0.155;
    const chestR = isMale ? 0.132 : 0.118;
    const waistR = isMale ? 0.122 : 0.104;
    const hipX = isMale ? 0.056 : 0.062;
    const hipR = isMale ? 0.110 : 0.116;

    const localCapsules = [
      // 0: Head & Neck
      [0.0, 1.44, 0.0, isMale ? 0.062 : 0.054, 0.0, 1.63, 0.008, 0.082, 0, 0.7, 0.95],
      // 1: Shoulder / Clavicle Bridge (Left to Right shoulder)
      [-shX, 1.368, -0.006, 0.054, shX, 1.368, -0.006, 0.054, 0, 0.62, 0.62],
      // 2: Upper Chest / Ribcage
      [0.0, 1.28, -0.004, chestR, 0.0, 1.13, -0.002, waistR + 0.006, 0, 0.52, 0.36],
      // 3: Left Bust / Pectoral Sphere
      [-0.074, 1.238, isMale ? 0.032 : 0.042, isMale ? 0.072 : 0.076, -0.070, 1.232, isMale ? 0.036 : 0.050, 0.072, 0, 0.48, 0.48],
      // 4: Right Bust / Pectoral Sphere
      [0.074, 1.238, isMale ? 0.032 : 0.042, isMale ? 0.072 : 0.076, 0.070, 1.232, isMale ? 0.036 : 0.050, 0.072, 0, 0.48, 0.48],
      // 5: Natural Waist Column
      [0.0, 1.07, 0.0, waistR, 0.0, 0.98, -0.004, waistR + 0.004, 0, 0.30, 0.20],
      // 6: Upper Pelvis / Hip Crest Bridge
      [-hipX, 0.90, -0.008, hipR, hipX, 0.90, -0.008, hipR, 0, 0.12, 0.12],
      // 7: Lower Pelvis / Gluteal Bridge
      [-0.056, 0.85, -0.018, hipR - 0.002, 0.056, 0.85, -0.018, hipR - 0.002, 0, 0.06, 0.06],
      // 8: Left Thigh Capsule
      [-0.090, 0.83, 0.0, isMale ? 0.090 : 0.086, -0.080, 0.48, 0.0, 0.058, 1, 0.05, 0.45],
      // 9: Right Thigh Capsule
      [0.090, 0.83, 0.0, isMale ? 0.090 : 0.086, 0.080, 0.48, 0.0, 0.058, 2, 0.05, 0.45],
      // 10: Left Calf Capsule
      [-0.080, 0.47, 0.0, 0.056, -0.074, 0.08, 0.0, 0.040, 1, 0.46, 0.92],
      // 11: Right Calf Capsule
      [0.080, 0.47, 0.0, 0.056, 0.074, 0.08, 0.0, 0.040, 2, 0.46, 0.92],
      // 12: Left Upper Arm Capsule
      [-(shX + 0.012), 1.372, -0.008, 0.049, -(shX + 0.082), 1.120, -0.022, 0.039, 3, 0.0, 0.45],
      // 13: Right Upper Arm Capsule
      [shX + 0.012, 1.372, -0.008, 0.049, shX + 0.082, 1.120, -0.022, 0.039, 4, 0.0, 0.45],
      // 14: Left Forearm Capsule
      [-(shX + 0.082), 1.120, -0.022, 0.038, -(shX + 0.135), 0.83, 0.022, 0.030, 3, 0.45, 0.90],
      // 15: Right Forearm Capsule
      [shX + 0.082, 1.120, -0.022, 0.038, shX + 0.135, 0.83, 0.022, 0.030, 4, 0.45, 0.90],
    ];

    const invDt = dt > 1e-4 ? 1.0 / dt : 0.0;
    for (let c = 0; c < this.capsuleCount; c++) {
      const def = localCapsules[c];
      const pA = transformPoint(def[0], def[1], def[2], def[8], def[9]);
      const pB = transformPoint(def[4], def[5], def[6], def[8], def[10]);

      const midX = 0.5 * (pA[0] + pB[0]);
      const midY = 0.5 * (pA[1] + pB[1]);
      const midZ = 0.5 * (pA[2] + pB[2]);

      const c3 = c * 3;
      let vx = 0, vy = 0, vz = 0;
      if (this.hasPrevCapsules) {
        vx = Math.max(-4.5, Math.min(4.5, (midX - this.prevCapsuleCenters[c3]) * invDt));
        vy = Math.max(-4.5, Math.min(4.5, (midY - this.prevCapsuleCenters[c3 + 1]) * invDt));
        vz = Math.max(-4.5, Math.min(4.5, (midZ - this.prevCapsuleCenters[c3 + 2]) * invDt));
      }
      this.prevCapsuleCenters[c3] = midX;
      this.prevCapsuleCenters[c3 + 1] = midY;
      this.prevCapsuleCenters[c3 + 2] = midZ;

      const base = c * 12;
      this.capsuleData[base + 0] = pA[0];
      this.capsuleData[base + 1] = pA[1];
      this.capsuleData[base + 2] = pA[2];
      this.capsuleData[base + 3] = def[3];
      this.capsuleData[base + 4] = pB[0];
      this.capsuleData[base + 5] = pB[1];
      this.capsuleData[base + 6] = pB[2];
      this.capsuleData[base + 7] = def[7];
      this.capsuleData[base + 8] = vx;
      this.capsuleData[base + 9] = vy;
      this.capsuleData[base + 10] = vz;
      this.capsuleData[base + 11] = 0.0;
    }
    this.hasPrevCapsules = true;
  }

  /**
   * Parses a user-supplied Wavefront .OBJ file to replace the avatar mesh,
   * automatically normalizing its height to [0.005m .. 1.72m] and assigning skeletal weights.
   */
  loadWavefrontObj(objText) {
    const rawV = [];
    const faces = [];
    const lines = objText.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("v ")) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          rawV.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
        }
      } else if (line.startsWith("f ")) {
        const parts = line.split(/\s+/).slice(1);
        const idx = parts.map((tok) => {
          const vIdx = parseInt(tok.split("/")[0], 10);
          return vIdx > 0 ? vIdx - 1 : rawV.length + vIdx;
        });
        for (let k = 1; k < idx.length - 1; k++) {
          faces.push(idx[0], idx[k], idx[k + 1]);
        }
      }
    }
    if (rawV.length < 12 || faces.length < 12) {
      throw new Error("The .obj file does not contain a valid triangle mesh.");
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of rawV) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const spanY = Math.max(1e-4, maxY - minY);
    const scale = 1.715 / spanY;
    const cx = 0.5 * (minX + maxX);
    const cz = 0.5 * (minZ + maxZ);

    const pos = new Float32Array(rawV.length * 3);
    const bIds = new Uint8Array(rawV.length);
    const bWeights = new Float32Array(rawV.length);

    for (let i = 0; i < rawV.length; i++) {
      const x = (rawV[i][0] - cx) * scale;
      const y = (rawV[i][1] - minY) * scale + 0.005;
      const z = (rawV[i][2] - cz) * scale;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      if (y < 0.85) {
        bIds[i] = x < 0 ? 1 : 2;
        bWeights[i] = Math.max(0, Math.min(1, (0.85 - y) / 0.84));
      } else if (Math.abs(x) > 0.16 && y < 1.42) {
        bIds[i] = x < 0 ? 3 : 4;
        bWeights[i] = Math.max(0, Math.min(1, (1.38 - y) / 0.55));
      } else {
        bIds[i] = 0;
        bWeights[i] = Math.max(0, Math.min(1, (y - 0.79) / 0.93));
      }
    }

    this.isCustomObj = true;
    this.vertexCount = rawV.length;
    this.indexCount = faces.length;
    this.basePositions = pos;
    this.positions = new Float32Array(pos);
    this.normals = new Float32Array(pos.length);
    this.boneIds = bIds;
    this.boneWeights = bWeights;
    this.indices = new Uint32Array(faces);
    this.interleaved = new Float32Array(this.vertexCount * 6);

    this.computeBaseNormals();
    this.baseNormals = new Float32Array(this.normals);
    this.hasPrevCapsules = false;
    this.evaluatePose(0, 0.016, {});
  }
}

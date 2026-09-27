/**
 * Single source of truth for every tunable.
 *
 * Only two kinds of values live here:
 *   SHAPE     - change the geometry (require a rebuild of the mesh)
 *   MECHANICS - change how the creature moves (live, no rebuild)
 *
 * Nothing cosmetic, nothing UI-only.
 *
 * Baseline numbers are taken from real morphometrics of a female
 * Anopheles gambiae and expressed as RATIOS of body length so the whole
 * animal can be scaled to game size without losing proportion.
 *
 * Sources for the biology are collected in docs/RESEARCH.md
 */

export const SHAPE = {
  // ---- global -----------------------------------------------------------
  // Head+thorax+abdomen length (proboscis excluded), in metres.
  // A real An. gambiae female is ~0.0055 m. Game "giant" default is 1.6 m.
  bodyLength: 1.15,

  // ---- head -------------------------------------------------------------
  headLength: 0.135, // x bodyLength
  headWidth: 0.175,
  eyeRadius: 0.072, // compound eye, wraps most of the head
  eyeSeparation: 0.085,
  eyeFacetDensity: 26, // facets across the eye; drives the hex lattice

  // ---- proboscis --------------------------------------------------------
  // In Anopheles the proboscis is ~ as long as the abdomen.
  proboscisLength: 0.52, // x bodyLength
  proboscisBaseRadius: 0.019,
  proboscisTipRadius: 0.0042,
  labiumWallThickness: 0.32, // fraction of the bore radius
  labiumSegments: 7,         // chain links, so the sheath can buckle
  labellaLength: 0.045,
  fascicleRadius: 0.4, // fraction of labium bore
  // Maxillary palps: in FEMALE Anopheles these are as long as the
  // proboscis and held alongside it. This is the single clearest way to
  // read "Anopheles" rather than "Culex/Aedes" at a glance.
  palpLength: 0.49,
  palpRadius: 0.012,
  palpSegments: 5,

  // ---- antennae ---------------------------------------------------------
  antennaLength: 0.42,
  antennaFlagellomeres: 13, // real count for Culicidae
  antennaBaseRadius: 0.011,
  antennaWhorlLength: 0.028, // female = sparse short whorls (male = plumose)
  antennaWhorlCount: 7,
  antennaSpread: 0.52, // radians between the two antennae

  // ---- thorax -----------------------------------------------------------
  thoraxLength: 0.245,
  thoraxHeight: 0.215,
  thoraxWidth: 0.2,
  scutumHump: 0.34, // Anopheles has a strongly arched mesonotum

  // ---- abdomen ----------------------------------------------------------
  abdomenLength: 0.62,
  abdomenRadius: 0.088,
  abdomenSegments: 8, // real count of visible terga
  abdomenTaper: 0.55, // tip radius / base radius
  // How much the abdomen can swell on a full tank (volumetric, x linear)
  abdomenMaxDistension: 2.35,

  // ---- wings ------------------------------------------------------------
  // Mosquito wings are extreme: very high aspect ratio, very narrow.
  wingLength: 0.66, // x bodyLength
  wingChord: 0.165, // x wingLength  -> AR ~ 6 per wing
  wingCamber: 0.045,
  wingTwistDeg: 14, // built-in washout, root -> tip
  wingVeinCount: 6, // 6 longitudinal veins + costa
  wingScaleBlocks: 4, // Anopheles = blocks of dark/pale scales on the veins
  // Root/tip placement on the thorax
  wingRootHeight: 0.62, // fraction of thorax height
  wingRootOffset: -0.06, // along body axis, fraction of bodyLength

  // ---- halteres ---------------------------------------------------------
  // Modified hindwings, beat antiphase to the wings. Easy to forget,
  // instantly wrong if missing.
  haltereLength: 0.115,
  haltereKnobRadius: 0.019,

  // ---- legs -------------------------------------------------------------
  // Real ratios: hind legs are much the longest, fore legs shortest.
  // Segment order coxa -> trochanter -> femur -> tibia -> 5 tarsomeres.
  legCoxa: 0.055,
  legTrochanter: 0.028,
  legFemur: 0.40,
  legTibia: 0.44,
  legTarsus: 0.46, // total of 5 tarsomeres
  legTarsomeres: 5,
  legRadius: 0.0135,
  legScalePair1: 0.80, // fore
  legScalePair2: 0.93, // mid
  legScalePair3: 1.18, // hind - the long ones
  legTaper: 0.45,
  clawLength: 0.022,

  // ---- robotic dressing (police-drone read) -----------------------------
  panelInset: 0.012, // depth of the panel line cuts
  ribCount: 9, // structural ribs on the abdomen
  sensorPodRadius: 0.028,
  beaconRadius: 0.02,
  drillFluteCount: 3, // helical flutes on the boring head
  drillFlutePitch: 0.09,
};

export const MECHANICS = {
  // ---- time -------------------------------------------------------------
  timeScale: 1.0, // global slow motion (1 = real time)

  // ---- wing kinematics --------------------------------------------------
  // Real An. gambiae female: 450-650 Hz. Bomphrey 2017 reports >800 Hz for
  // mosquitoes generally. At giant game scale that frequency is not
  // physical and not renderable, so the default is scaled down; set to
  // 600+ and drop timeScale to inspect the true waveform.
  wingbeatHz: 26.0,
  // Peak-to-peak sweep of the wing in the stroke plane.
  // Mosquitoes: 34-54 deg. Lower than ANY other insect. This is the
  // number that makes a mosquito look like a mosquito and not a fly.
  strokeAmplitudeDeg: 44.0,
  strokeMeanDeg: 4.0, // offset of the sweep about the stroke plane
  strokePlaneDeg: 62.0, // stroke plane tilt from the body axis
  // Out-of-plane deviation. Small, dominated by the 2nd harmonic ->
  // gives the shallow figure-of-eight tip path.
  deviationDeg: 7.0,
  deviationH2: 0.72, // weight of the 2f term vs the 1f term
  deviationPhaseDeg: 24.0,
  // Feathering. Mosquitoes hold a near-constant angle of attack through
  // the half stroke then flip very fast at reversal ("smart rotation").
  pitchMidDeg: 46.0, // angle of attack mid-stroke
  pitchAmplitudeDeg: 52.0,
  rotationSharpness: 4.6, // higher = more trapezoidal, faster flip
  rotationAdvanceDeg: 34.0, // rotation leads stroke reversal (advanced rotation)
  // Spanwise torsion: the tip rotates before the root.
  spanwiseTwistLagDeg: 26.0,
  wingFlexure: 0.34, // aeroelastic bend, 0 = rigid plank
  strokeAsymmetry: 0.06, // down/up stroke duration asymmetry

  // ---- haltere ----------------------------------------------------------
  haltereAmplitudeDeg: 78.0,
  haltereAntiphase: true,

  // ---- body dynamics ----------------------------------------------------
  bodyPitchHoverDeg: 38.0, // nose-up attitude while hovering
  bodyPitchRestDeg: 45.0, // Anopheles rests at ~45 deg to the substrate
  heaveAmplitude: 0.006, // per-wingbeat body bob, x bodyLength
  yawJitterDeg: 3.5, // 1-6 deg wander on a ~30 ms timescale (Cornell)
  yawJitterHz: 4.5,
  maxBankDeg: 42.0, // turns are roll/sideslip driven, not yaw driven
  cruiseSpeed: 2.4, // m/s at giant scale
  approachSpeed: 0.85,
  accel: 3.2,
  turnRate: 2.6, // rad/s

  // ---- legs -------------------------------------------------------------
  legTuckDeg: 54.0, // fore/mid legs fold up in cruise
  hindLegTrailDeg: 38.0, // hind legs stream backwards in flight
  landingReachDeg: 42.0, // hind legs swing forward + down to reach
  touchdownOrder: [4, 5, 2, 3, 0, 1], // hind pair, then mid, then fore
  touchdownStagger: 0.085, // s between pairs
  tarsalCompliance: 0.42, // how much the tarsus flattens on contact
  gripSettleTime: 0.35,
  stanceSpread: 1.0,
  // It lands short of the spot it wants and walks in on an alternating
  // tripod. That is what a mosquito does, and it is what sells the weight.
  walkStride: 0.46,     // x bodyLength, how far short it touches down
  walkDuration: 2.1,    // s for the two tripod steps
  stepLift: 0.055,      // x bodyLength, foot clearance during swing // lateral spread of planted feet

  // ---- probing / drilling ----------------------------------------------
  probeSweepDeg: 16.0, // labella hunting for a seam before committing
  probeSweepHz: 1.6,
  probeDuration: 1.8,
  // The labium does NOT enter the target. It buckles backwards into a
  // bow and the labella stay in contact while the fascicle slides out.
  labiumBowDeg: 118.0,   // how far the sheath buckles back
  fascicleExtend: 0.78, // fraction of proboscis length driven in
  // Maxillae act as alternating microsaws; mandibles + labrum advance
  // between strokes. Measured actuation is ~15 Hz.
  sawHz: 15.0,
  sawStroke: 0.035, // fraction of fascicle length per saw stroke
  maxillaAlternation: 1.0, // 1 = strict left/right alternation
  // Robotic addition: the fascicle carries a rotary boring head, because
  // a fuel tank is steel, not skin.
  drillRPM: 2400.0,
  drillPlungeRate: 0.022, // m/s through the tank wall
  drillWobbleDeg: 1.1,
  sparkRate: 90.0,

  // ---- feeding ----------------------------------------------------------
  // Cibarial + pharyngeal pumps run alternately at ~3-4 Hz.
  pumpHz: 3.4,
  pumpPhaseOffset: 0.5, // cibarial vs pharyngeal
  pumpStroke: 0.18, // visible peristalsis depth
  drainRate: 3.2, // litres/s out of the tank
  tankCapacity: 60.0, // litres
  crawCapacity: 26.0, // litres the mosquito can hold
  distensionLag: 0.55, // s, abdomen lags the intake
  detachThreshold: 0.96, // fraction of craw before it lets go

  // ---- weight coupling --------------------------------------------------
  loadedWingbeatGain: 0.26, // wingbeat rises as it gets heavy
  loadedClimbPenalty: 0.55,
  takeoffImpulse: 1.5,
  // Mosquitoes take off almost entirely on the wings and push with the
  // legs as little as possible, so the host never feels them go. The
  // wings spool up with all six feet still planted, and only then do the
  // legs extend and release.
  takeoffSpool: 0.85,      // s of wing spin-up before the first foot lifts
  takeoffLegPush: 0.10,    // x bodyLength the legs extend - deliberately small
};

// Which keys force a geometry rebuild
export const SHAPE_KEYS = new Set(Object.keys(SHAPE));

export const params = { shape: { ...SHAPE }, mech: { ...MECHANICS } };

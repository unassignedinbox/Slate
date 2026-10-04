import { DEFAULT_PARAMS, CONTROL_GROUPS, PRESETS } from "./presets.js";

export const SourceRevision = "6e43918e4477eaddcf5bd74aff4e18bdd27e03c5";
export const InitialParameters = {
  ...DEFAULT_PARAMS,
};

export const ControlSpecification = Object.fromEntries(
  CONTROL_GROUPS.flatMap((Group) => Group.controls).map((Control) => [
    Control.key,
    Control,
  ]),
);

export const ControlLabels = Object.fromEntries(
  CONTROL_GROUPS.flatMap((Group) => Group.controls).map((Control) => [
    Control.key,
    Control.label,
  ]),
);

export const PresetPresentation = {
  emerald_evening_gown: [
    "Emerald evening gown",
    "gown",
    "Bias-cut silk charmeuse · floor length",
    "dress",
  ],
  sunburst_pleated_midi: [
    "Sunburst pleated midi",
    "pleated",
    "32 knife pleats · 360° couture twirl",
    "pleat",
  ],
  couture_ballgown: [
    "Princess ballgown",
    "gown",
    "Structured corset · sapphire bell skirt",
    "dress",
  ],
  satin_cocktail_slip: [
    "Satin cocktail slip",
    "cocktail",
    "Rose quartz bias cut · catwalk stride",
    "scissors",
  ],
  mermaid_trumpet_gown: [
    "Mermaid trumpet gown",
    "gown",
    "Crimson velvet · sculpted knee flare",
    "dress",
  ],
  grecian_chiffon_column: [
    "Grecian chiffon column",
    "silk",
    "Sheer wisteria organza · breeze drape",
    "wind",
  ],
  asymmetric_wrap_dress: [
    "Asymmetric wrap dress",
    "cocktail",
    "Diagonal high-low hem · obsidian twill",
    "scissors",
  ],
  ivory_bridal_brocade: [
    "Ivory bridal brocade",
    "silk",
    "Sequined relief · regal train flare",
    "weave",
  ],
};

// Keys that require rebuilding the dress topology/rest-lengths when changed
export const PATTERN_REBUILD_KEYS = new Set([
  "dressStyle",
  "gridResolution",
  "skirtLength",
  "skirtFlare",
  "waistCinch",
  "necklineDepth",
  "strapWidth",
  "sleeveDrape",
  "pleatCount",
  "pleatDepth",
  "asymmetry",
  "pieAutoResolution",
  "pieAnisotropy",
  "pieShirringRatio",
  "pieDownPressure",
  "weaveType",
  "bendStiffness",
  "stretchCompliance",
]);

export function ValidateParameter(Key, Value) {
  if (!Object.hasOwn(DEFAULT_PARAMS, Key))
    throw new Error(`Unknown setting: ${Key}`);
  if (typeof Value !== typeof DEFAULT_PARAMS[Key])
    throw new Error(`Invalid type for ${Key}`);
  if (typeof Value === "boolean") return Value;
  if (Key === "interactionMode") {
    if (!["orbit", "drape", "gust"].includes(Value))
      throw new Error("Invalid interaction tool");
    return Value;
  }
  const Control = ControlSpecification[Key];
  if (!Number.isFinite(Value)) throw new Error(`Non-finite setting: ${Key}`);
  if (
    Control?.type === "select" &&
    !Control.options.some((Option) => (Option.id ?? Option.value) === Value)
  )
    throw new Error(`Invalid choice for ${Key}`);
  if (Control?.type === "range" && (Value < Control.min || Value > Control.max))
    throw new Error(`Setting outside limits: ${Key}`);
  return Value;
}

export function ValidateScene(Input) {
  if (
    !Input ||
    (Input.format !== "frontier-cloth-scene" && Input.format !== "frontier-fluid-scene") ||
    Input.version !== 1 ||
    !Input.params ||
    Array.isArray(Input.params) ||
    typeof Input.params !== "object"
  )
    throw new Error("Not a supported Cloth scene (version 1).");
  const Parameters = { ...InitialParameters };
  for (const [Key, Value] of Object.entries(Input.params)) {
    if (Object.hasOwn(DEFAULT_PARAMS, Key)) {
      Parameters[Key] = ValidateParameter(Key, Value);
    }
  }
  const Names = {
    garment: "Silk evening gown",
    avatar: "Human mannequin",
    wind: "Aerodynamic wind",
    sun: "Studio key light",
  };
  for (const Key of Object.keys(Names)) {
    if (Input.names?.[Key] !== undefined) {
      if (
        typeof Input.names[Key] !== "string" ||
        !Input.names[Key].trim() ||
        Input.names[Key].length > 64
      )
        throw new Error("Object names must be 1–64 characters.");
      Names[Key] = Input.names[Key].trim();
    }
  }
  if (
    typeof Input.name !== "string" ||
    !Input.name.trim() ||
    Input.name.length > 64
  )
    throw new Error("Scene name must be 1–64 characters.");
  let Camera = null;
  if (Input.camera !== undefined) {
    Camera = Input.camera;
    if (
      !Camera ||
      !["theta", "phi", "distance"].every((Key) =>
        Number.isFinite(Camera[Key]),
      ) ||
      Camera.phi < 0.01 ||
      Camera.phi > 3.13 ||
      Camera.distance < 0.65 ||
      Camera.distance > 9.5 ||
      Math.abs(Camera.theta) > 1e6 ||
      !Array.isArray(Camera.center) ||
      Camera.center.length !== 3 ||
      !Camera.center.every(
        (Value) => Number.isFinite(Value) && Math.abs(Value) <= 100,
      )
    )
      throw new Error("Invalid camera position.");
    Camera = {
      theta: Camera.theta,
      phi: Camera.phi,
      distance: Camera.distance,
      center: [...Camera.center],
    };
  }
  return { Parameters, Names, Camera, Name: Input.name.trim() };
}

export function ConstructPresetParameters(Key) {
  if (!Object.hasOwn(PRESETS, Key)) throw new Error("Unknown preset");
  return { ...InitialParameters, ...PRESETS[Key].params };
}

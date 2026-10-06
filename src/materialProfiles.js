// Pure recipe definitions: these are also included in standalone shader exports.
// A normalized art-direction control drives one or more bounded physical values.
const target = (key, min, max, integer = false) => ({ key, min, max, integer });
const macro = (id, label, targets, group = "finish", hint = "") => ({
  id,
  label,
  targets,
  group,
  hint,
});
const direct = (
  key,
  label,
  min,
  max,
  group = "detail",
  unit = "",
  log = false,
  extend = false,
  step = 0.01,
) => ({
  id: key,
  label,
  key,
  min,
  max,
  group,
  unit,
  log,
  extend,
  step,
  direct: true,
});
const scale = (key, label, group = "detail", unit = "×") =>
  direct(key, label, 0.01, 1000, group, unit, true, true);
const rough = (label, min, max, ...extra) =>
  macro("roughness", label, [target("roughness", min, max), ...extra]);
const baseColor = { key: "color", label: "Surface color" };
const yarnColors = [
  { key: "warpColor", label: "Warp yarn · lengthwise" },
  { key: "weftColor", label: "Weft yarn · crosswise" },
];
const recipes = {
  paint: {
    title: "Automotive paint",
    caption:
      "A layered finish. Paint, flakes and clearcoat are tuned separately.",
    fixed: { ior: 1.5, coatIor: 1.5, sheen: 0, anisotropy: 0 },
    colors: [{ ...baseColor, label: "Paint color" }],
    controls: [
      rough("Paint roughness", 0.12, 0.42),
      macro("paintDepth", "Paint depth", [target("depth", 0.15, 1.8)]),
      macro("coatGloss", "Clearcoat gloss", [
        target("coatRoughness", 0.19, 0.035),
        target("coat", 0.65, 1),
      ]),
      direct("flakes", "Flake coverage", 0, 1, "flakes"),
      direct(
        "flakeSize",
        "Flake size",
        0.001,
        1000,
        "flakes",
        "µm",
        true,
        true,
      ),
      macro(
        "flakeSparkle",
        "Flake sparkle",
        [
          target("flakeRoughnessMin", 0.32, 0.055),
          target("flakeRoughnessMax", 0.5, 0.18),
          target("flakeTilt", 0.08, 0.4),
        ],
        "flakes",
      ),
      macro(
        "flakeReflectivity",
        "Flake reflectivity",
        [
          target("flakeMetalnessMin", 0.72, 0.97),
          target("flakeMetalnessMax", 0.88, 1),
        ],
        "flakes",
      ),
      scale("flakeScale", "Flake repetition"),
      direct(
        "flakeLayers",
        "Flake layers",
        1,
        4,
        "flakes",
        "",
        false,
        false,
        1,
      ),
      macro(
        "flakeDepth",
        "Buried flake tint",
        [target("flakeLayerDepth", 0.1, 0.85)],
        "flakes",
      ),
      macro(
        "paintTexture",
        "Orange-peel texture",
        [target("orangePeel", 0, 0.9)],
        "detail",
      ),
      scale("orangePeelScale", "Texture scale"),
    ],
  },
  velvet: {
    title: "Velvet",
    caption:
      "Soft pile, diffuse body color and a grazing sheen. No metal or coat controls.",
    fixed: {
      metalness: 0,
      coat: 0,
      ior: 1.5,
      anisotropy: 0,
      weaveRelief: 0.2,
      detailScale: 36,
    },
    colors: [{ ...baseColor, label: "Velvet dye" }],
    controls: [
      rough(
        "Velvet Roughness",
        0.78,
        0.97,
        target("sheenRoughness", 0.3, 0.85),
      ),
      macro("softness", "Pile softness", [
        target("fuzz", 0.3, 1),
        target("sheen", 0.55, 1),
      ]),
      macro("pile", "Pile length", [target("fuzzLength", 0.3, 1.5)]),
    ],
  },
  suede: {
    title: "Suede / microfiber",
    caption:
      "A brushed nap, with softly constrained reflection and fiber length.",
    fixed: {
      metalness: 0,
      coat: 0,
      ior: 1.5,
      anisotropy: 0,
      weaveRelief: 0.25,
    },
    colors: [{ ...baseColor, label: "Suede dye" }],
    controls: [
      rough("Suede Roughness", 0.82, 0.98, target("sheenRoughness", 0.45, 0.9)),
      macro("softness", "Nap softness", [
        target("fuzz", 0.35, 1),
        target("sheen", 0.55, 1),
      ]),
      macro("pile", "Nap length", [target("fuzzLength", 0.1, 0.9)]),
      scale("detailScale", "Nap scale"),
    ],
  },
  cotton: {
    title: "Cotton",
    caption: "Matte, soft yarns. Warp and weft colors remain independent.",
    woven: true,
    fixed: { metalness: 0, coat: 0, ior: 1.5, specular: 0.6 },
    colors: yarnColors,
    controls: [
      rough(
        "Cotton Roughness",
        0.72,
        0.97,
        target("sheenRoughness", 0.55, 0.9),
      ),
      macro("softness", "Yarn softness", [
        target("fuzz", 0.15, 0.85),
        target("fuzzLength", 0.12, 0.7),
        target("sheen", 0.2, 0.55),
      ]),
    ],
  },
  linen: {
    title: "Linen",
    caption: "Dry, irregular yarns with restrained sheen and a crisp weave.",
    woven: true,
    fixed: { metalness: 0, coat: 0, ior: 1.5, specular: 0.6 },
    colors: yarnColors,
    controls: [
      rough("Linen Roughness", 0.78, 0.98, target("sheenRoughness", 0.6, 0.95)),
      macro("softness", "Yarn softness", [
        target("fuzz", 0.05, 0.45),
        target("fuzzLength", 0.08, 0.4),
        target("sheen", 0.12, 0.4),
      ]),
    ],
  },
  wool: {
    title: "Wool",
    caption:
      "Full-bodied yarns, a soft surface and naturally broad reflections.",
    woven: true,
    fixed: { metalness: 0, coat: 0, ior: 1.5, specular: 0.55 },
    colors: yarnColors,
    controls: [
      rough("Wool Roughness", 0.75, 0.98, target("sheenRoughness", 0.5, 0.9)),
      macro("softness", "Wool softness", [
        target("fuzz", 0.35, 1),
        target("fuzzLength", 0.25, 1.4),
        target("sheen", 0.25, 0.7),
      ]),
    ],
  },
  denim: {
    title: "Denim",
    caption:
      "Warp-faced dyed cotton. Lighter weft yarns show through the twill.",
    woven: true,
    fixed: { metalness: 0, coat: 0, ior: 1.5, specular: 0.65 },
    colors: yarnColors,
    controls: [
      rough(
        "Denim Roughness",
        0.68,
        0.95,
        target("sheenRoughness", 0.45, 0.85),
      ),
      macro("softness", "Yarn softness", [
        target("fuzz", 0.15, 0.7),
        target("fuzzLength", 0.12, 0.65),
        target("sheen", 0.25, 0.6),
      ]),
    ],
  },
  silk: {
    title: "Silk / satin",
    caption:
      "Long floating yarns, directional lustre and a fine, smooth finish.",
    woven: true,
    fixed: { metalness: 0, coat: 0, ior: 1.55, fuzz: 0.025, fuzzLength: 0.065 },
    colors: yarnColors,
    controls: [
      rough("Silk Roughness", 0.12, 0.38, target("sheenRoughness", 0.18, 0.5)),
      macro("lustre", "Silk lustre", [
        target("anisotropy", 0.45, 0.92),
        target("specular", 0.65, 1),
        target("sheen", 0.4, 0.9),
      ]),
    ],
  },
  woven: {
    title: "Woven textile",
    caption: "Yarn structure and color, without unrelated PBR parameters.",
    woven: true,
    fixed: { metalness: 0, coat: 0, ior: 1.5, specular: 0.65 },
    colors: yarnColors,
    controls: [
      rough(
        "Textile Roughness",
        0.65,
        0.96,
        target("sheenRoughness", 0.45, 0.9),
      ),
      macro("softness", "Yarn softness", [
        target("fuzz", 0.1, 0.8),
        target("fuzzLength", 0.1, 0.9),
        target("sheen", 0.2, 0.65),
      ]),
    ],
  },
  carbon: {
    title: "Carbon composite",
    caption:
      "Reflective bundles beneath a resin finish. The weave stays carbon-like.",
    fixed: { ior: 1.5, coatIor: 1.5, metalness: 0.8, coat: 0.9 },
    colors: [{ ...baseColor, label: "Composite tint" }],
    controls: [
      rough("Carbon finish", 0.2, 0.5, target("coatRoughness", 0.045, 0.19)),
      macro("relief", "Bundle definition", [
        target("weaveRelief", 0.1, 0.8),
        target("fiberDetail", 8, 24, true),
      ]),
      macro("directionality", "Directional contrast", [
        target("anisotropy", 0.4, 0.92),
      ]),
      scale("detailScale", "Bundle scale"),
      direct(
        "weaveAngle",
        "Weave direction",
        -180,
        180,
        "detail",
        "°",
        false,
        false,
        1,
      ),
    ],
  },
  polishedMetal: {
    title: "Polished metal",
    caption:
      "A conductor with a controlled polish, rather than arbitrary dielectric settings.",
    fixed: { metalness: 1, anisotropy: 0.05, sheen: 0 },
    colors: [{ ...baseColor, label: "Metal tint" }],
    controls: [
      macro("polish", "Metal polish", [target("roughness", 0.36, 0.045)]),
      macro("coatGloss", "Protective finish", [
        target("coat", 0, 0.45),
        target("coatRoughness", 0.18, 0.05),
      ]),
      scale("detailScale", "Machining scale"),
    ],
  },
  brushedMetal: {
    title: "Brushed alloy",
    caption: "Directional microbrushing and a restrained metallic response.",
    fixed: { metalness: 1, coat: 0.15, sheen: 0 },
    colors: [{ ...baseColor, label: "Alloy tint" }],
    controls: [
      rough("Brushed Roughness", 0.22, 0.62),
      macro("directionality", "Directional sheen", [
        target("anisotropy", 0.3, 0.95),
      ]),
      scale("detailScale", "Brush spacing"),
    ],
  },
  brake: {
    title: "Machined brake iron",
    caption: "Concentric tool marks with a bounded metallic finish.",
    fixed: { metalness: 0.96, coat: 0.06, sheen: 0, anisotropy: 0 },
    colors: [{ ...baseColor, label: "Iron tint" }],
    controls: [
      rough("Disc Roughness", 0.28, 0.7),
      macro("relief", "Machining depth", [target("depth", 0.05, 0.75)]),
      scale("detailScale", "Machining scale"),
    ],
  },
  ceramic: {
    title: "Carbon ceramic",
    caption: "A porous, sintered surface with broad, subdued reflections.",
    fixed: { metalness: 0.25, coat: 0.08, sheen: 0 },
    colors: [{ ...baseColor, label: "Ceramic color" }],
    controls: [
      rough("Ceramic Roughness", 0.45, 0.94),
      macro("porosity", "Porosity", [target("depth", 0.1, 1.4)]),
      scale("detailScale", "Grain scale"),
    ],
  },
  rubber: {
    title: "Rubber",
    caption:
      "A non-metallic elastomer with a bounded matte finish and micrograin.",
    fixed: { metalness: 0, coat: 0, ior: 1.5, sheen: 0 },
    colors: [{ ...baseColor, label: "Rubber color" }],
    controls: [
      rough("Rubber Roughness", 0.6, 0.98),
      macro("grain", "Micrograin", [target("depth", 0.1, 0.8)]),
      scale("detailScale", "Grain scale"),
    ],
  },
  glass: {
    title: "Optical glass",
    caption: "Tint, clarity and refraction within an automotive-glass range.",
    fixed: { metalness: 0, coat: 0, specular: 1, sheen: 0 },
    colors: [{ ...baseColor, label: "Glass tint" }],
    controls: [
      macro("clarity", "Glass clarity", [target("roughness", 0.2, 0.005)]),
      macro("thickness", "Glass thickness", [target("depth", 0.05, 3)]),
      macro("refraction", "Edge refraction", [target("ior", 1.45, 1.62)]),
    ],
  },
  glossPlastic: {
    title: "Gloss polymer",
    caption:
      "A glossy dielectric finish. Metalness and optical constants are handled for you.",
    fixed: { metalness: 0, ior: 1.55, coatIor: 1.5, sheen: 0 },
    colors: [{ ...baseColor, label: "Polymer color" }],
    controls: [
      macro("gloss", "Plastic gloss", [
        target("roughness", 0.32, 0.065),
        target("coat", 0.35, 1),
        target("coatRoughness", 0.18, 0.04),
      ]),
      macro("grain", "Surface texture", [target("grain", 0, 0.25)]),
      scale("detailScale", "Texture scale"),
    ],
  },
  grainPlastic: {
    title: "Grained polymer",
    caption: "Molded grain with softer, non-metallic highlights.",
    fixed: { metalness: 0, ior: 1.55, coat: 0.08, sheen: 0 },
    colors: [{ ...baseColor, label: "Polymer color" }],
    controls: [
      rough("Polymer Roughness", 0.42, 0.82),
      macro("grain", "Molded grain", [target("grain", 0.15, 1.2)]),
      scale("detailScale", "Grain scale"),
    ],
  },
  wornPlastic: {
    title: "Worn polymer",
    caption: "Raised grain is polished down; the valleys keep their texture.",
    fixed: { metalness: 0, ior: 1.55, coat: 0, sheen: 0 },
    colors: [{ ...baseColor, label: "Polymer color" }],
    controls: [
      rough("Polymer Roughness", 0.42, 0.82),
      macro("wear", "Polymer wear", [target("wear", 0, 1)]),
      macro("wearBlend", "Wear softness", [target("wearSoftness", 0.25, 1)]),
      macro("wornGloss", "Worn polish", [target("wornRoughness", 0.4, 0.1)]),
      macro("grain", "Molded grain", [target("grain", 0.15, 1)], "detail"),
      scale("detailScale", "Grain scale"),
    ],
  },
  leather: {
    title: "Automotive leather",
    caption: "Supple hide, raised grain and a restrained protective finish.",
    fixed: { metalness: 0, ior: 1.48, coatIor: 1.5 },
    colors: [{ ...baseColor, label: "Leather dye" }],
    controls: [
      rough("Leather Roughness", 0.3, 0.72, target("coatRoughness", 0.18, 0.4)),
      macro("grain", "Grain character", [target("grain", 0.15, 1)]),
      macro("patina", "Patina", [
        target("wear", 0, 0.8),
        target("wearSoftness", 0.45, 0.9),
        target("wornRoughness", 0.34, 0.15),
      ]),
      macro("leatherSheen", "Finish sheen", [
        target("coat", 0.05, 0.45),
        target("sheen", 0.1, 0.35),
      ]),
      scale("detailScale", "Grain scale"),
    ],
  },
};

export function materialFamily(p) {
  if (p.recipeId && recipes[p.recipeId]) return p.recipeId;
  if (p.type === 0) return "paint";
  if (p.type === 4) {
    if (p.fabricMode === 2) return "velvet";
    if (p.fabricMode === 1) return "suede";
    return (
      p.textileClass ||
      (p.id === "indigo-denim"
        ? "denim"
        : p.fabricMode === 4
          ? "silk"
          : p.fabricMode === 3
            ? "cotton"
            : "woven")
    );
  }
  return (
    {
      1: p.id?.includes("brushed") ? "brushedMetal" : "polishedMetal",
      2: "ceramic",
      3: "rubber",
      5: "glass",
      6: "brake",
      7: "carbon",
      8: "glossPlastic",
      9: "grainPlastic",
      10: "wornPlastic",
      11: "leather",
    }[p.type] || "paint"
  );
}

export function getRecipe(p) {
  const id = materialFamily(p),
    base = recipes[id] || recipes.woven;
  const controls = [...base.controls];
  if (base.woven)
    controls.push(
      scale("detailScale", "Thread scale", "construction"),
      macro(
        "definition",
        "Weave definition",
        [target("weaveRelief", 0.08, 1), target("fiberDetail", 8, 28, true)],
        "construction",
      ),
      direct(
        "weaveAngle",
        "Thread direction",
        -180,
        180,
        "construction",
        "°",
        false,
        false,
        1,
      ),
    );
  const iridescent = p.type === 0 && p.paintEffect === "iridescent";
  if (iridescent)
    controls.push(
      macro(
        "iridescence",
        "Color-shift strength",
        [target("iridescence", 0, 1)],
        "iridescence",
      ),
      macro(
        "filmPhase",
        "Color phase",
        [target("filmThickness", 160, 850)],
        "iridescence",
      ),
      macro(
        "colorTravel",
        "Angle response",
        [
          target("iridescenceIOR", 1.15, 1.85),
          target("filmVariation", 10, 100),
        ],
        "iridescence",
      ),
    );
  return {
    ...base,
    id,
    iridescent,
    title: iridescent ? "Iridescent automotive paint" : base.title,
    controls,
  };
}

export function boundMaterial(p) {
  const recipe = getRecipe(p),
    result = { ...p, ...recipe.fixed, recipeId: recipe.id };
  const limits = {};
  for (const c of recipe.controls) {
    if (c.direct) {
      limits[c.key] = {
        min: c.extend ? 0.000001 : c.min,
        max: c.extend ? 1000000 : c.max,
        integer: c.step === 1,
      };
      continue;
    }
    for (const t of c.targets) {
      const lo = Math.min(t.min, t.max),
        hi = Math.max(t.min, t.max);
      const previous = limits[t.key];
      limits[t.key] = {
        min: previous ? Math.min(previous.min, lo) : lo,
        max: previous ? Math.max(previous.max, hi) : hi,
        integer: t.integer,
      };
    }
  }
  for (const [key, range] of Object.entries(limits))
    if (Number.isFinite(result[key])) {
      result[key] = Math.max(range.min, Math.min(range.max, result[key]));
      if (range.integer) result[key] = Math.round(result[key]);
    }
  return result;
}

export function recipeControlValue(p, c) {
  if (c.direct) return p[c.key] ?? c.min;
  if (Number.isFinite(p.tuning?.[c.id]))
    return Math.max(0, Math.min(1, p.tuning[c.id]));
  const t = c.targets[0];
  return Math.max(
    0,
    Math.min(1, ((p[t.key] ?? t.min) - t.min) / (t.max - t.min)),
  );
}

export function applyRecipeControl(p, c, input) {
  const v = Number(input);
  if (!Number.isFinite(v)) return p;
  const next = { ...p, tuning: { ...p.tuning } };
  if (c.direct) next[c.key] = c.step === 1 ? Math.round(v) : v;
  else {
    const amount = Math.max(0, Math.min(1, v));
    next.tuning[c.id] = amount;
    for (const t of c.targets) {
      const mapped = t.min + (t.max - t.min) * amount;
      next[t.key] = t.integer ? Math.round(mapped) : mapped;
    }
  }
  return boundMaterial(next);
}

export function applyRecipeColor(p, key, value) {
  const next = { ...p, [key]: value };
  if (p.type === 4) {
    if (key === "warpColor") next.color = value;
    if (key === "color" || key === "warpColor") {
      // Dye automatically informs the pile highlight: no unrelated sheen-color knob.
      const rgb = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
      if (rgb.every(Number.isFinite))
        next.sheenColor =
          "#" +
          rgb
            .map((v) =>
              Math.round(v * 0.55 + 255 * 0.45)
                .toString(16)
                .padStart(2, "0"),
            )
            .join("");
    }
  }
  return next;
}

export function basicWeaves() {
  return [
    {
      id: "plain",
      name: "Plain · 1 over / 1 under",
      description: "The fundamental balanced weave.",
    },
    {
      id: "twill",
      name: "Twill · 2 over / 2 under",
      description: "Continuous diagonal ribs.",
    },
    {
      id: "satin",
      name: "Satin · 5-harness float",
      description: "Long floats for a smooth, lustrous face.",
    },
    {
      id: "basket",
      name: "Basket · 2 × 2",
      description: "Pairs of yarns woven as groups.",
    },
    {
      id: "rib",
      name: "Rib · warp rib",
      description: "Paired floats emphasize crosswise ribs.",
    },
    {
      id: "herringbone",
      name: "Herringbone · broken twill",
      description: "Reversed diagonals form a chevron.",
    },
    {
      id: "oxford",
      name: "Oxford · 2 × 1 basket",
      description: "Paired warp yarns crossing single weft yarns.",
    },
    {
      id: "houndstooth",
      name: "Houndstooth · color twill",
      description: "Alternating dark/light yarns in a 2 × 2 twill.",
    },
    {
      id: "denim",
      name: "Denim · 3 over / 1 under",
      description: "A warp-faced twill with contrasting weft.",
    },
  ];
}

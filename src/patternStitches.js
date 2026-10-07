// Editable vector stitch overlays. Relief is shading, not pierced mesh geometry.
export const stitchTypes = [
  "Running stitch",
  "Backstitch",
  "Chain stitch",
  "Cross stitch",
  "Zigzag stitch",
  "Blanket stitch",
  "Herringbone stitch",
  "Feather stitch",
  "Couching stitch",
  "Satin bars",
];
const stitchBound = (v, d, a, b) =>
  Number.isFinite(Number(v)) ? Math.max(a, Math.min(b, Number(v))) : d;
export function normalizeStitches(value = {}) {
  const s = value && typeof value === "object" ? value : {};
  return {
    enabled: s.enabled !== false,
    type: stitchTypes.includes(s.type) ? s.type : stitchTypes[0],
    layout: ["rows", "columns", "border", "diagonal"].includes(s.layout)
      ? s.layout
      : "rows",
    spacing: stitchBound(s.spacing, 32, 16, 64),
    width: stitchBound(s.width, 3, 1, 8),
    inset: stitchBound(s.inset, 24, 12, 96),
    relief: stitchBound(s.relief, 0.55, 0, 1),
    color: /^#[a-f\d]{6}$/i.test(s.color || "") ? s.color : "#e8d9b5",
  };
}
export function stitchTint(hex, amount) {
  return (
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.max(
          0,
          Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * amount)),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function stitchLayers(value) {
  const s = normalizeStitches(value);
  if (!s.enabled) return [];
  const paths = { thread: "", holes: "", highlight: "" };
  function unit(cx, cy, size, angle = 0) {
    const co = Math.cos(angle),
      si = Math.sin(angle);
    const point = (x, y, offset = 0) =>
      [
        ((cx + (x * co - y * si) * size + offset) / 5.12).toFixed(2),
        ((cy + (x * si + y * co) * size + offset) / 5.12).toFixed(2),
      ].join(" ");
    const commands = [];
    const m = (x, y) => commands.push(["M", x, y]),
      l = (x, y) => commands.push(["L", x, y]);
    const c = (...args) => commands.push(["C", ...args]);
    const a = 0.34,
      b = 0.2;
    switch (s.type) {
      case "Backstitch":
        m(-0.5, 0);
        l(0.5, 0);
        m(-0.42, 0.04);
        l(0.05, 0.04);
        break;
      case "Chain stitch":
        m(-0.44, 0);
        c(-0.18, -0.35, 0.42, -0.28, 0.44, 0);
        c(0.35, 0.28, -0.18, 0.35, -0.44, 0);
        break;
      case "Cross stitch":
        m(-a, -b);
        l(a, b);
        m(-a, b);
        l(a, -b);
        break;
      case "Zigzag stitch":
        m(-0.5, b);
        l(0, -b);
        l(0.5, b);
        break;
      case "Blanket stitch":
        m(-0.5, b);
        l(0.5, b);
        m(0, b);
        l(0, -b);
        break;
      case "Herringbone stitch":
        m(-0.5, -b);
        l(0.35, b);
        l(0.15, b);
        m(-0.5, b);
        l(0.35, -b);
        l(0.15, -b);
        break;
      case "Feather stitch":
        m(-0.5, 0);
        l(0, 0);
        l(0.5, 0);
        m(-a, -b);
        l(0, 0);
        l(a, b);
        break;
      case "Couching stitch":
        m(-0.5, -0.045);
        l(0.5, -0.045);
        m(-0.5, 0.045);
        l(0.5, 0.045);
        m(0, -0.15);
        l(0.05, 0.15);
        break;
      case "Satin bars":
        for (let k = -2; k <= 2; k++) {
          m(k * 0.12, -b);
          l(k * 0.12, b);
        }
        break;
      default:
        m(-a, 0);
        l(a, 0);
    }
    for (const [key, offset] of [
      ["thread", 0],
      ["highlight", -s.width * 0.22],
    ])
      paths[key] += commands
        .map(
          ([cmd, ...v]) =>
            cmd +
            Array.from({ length: v.length / 2 }, (_, i) =>
              point(v[i * 2], v[i * 2 + 1], offset),
            ).join(" "),
        )
        .join("");
    // Recesses follow the actual needle endpoints / turns, not a generic row.
    // Tiny round-capped segments encode compact dots even for dense satin bars.
    const ends = new Map();
    for (const [cmd, ...v] of commands) {
      const x = v.at(-2),
        y = v.at(-1);
      ends.set(`${x},${y}`, [x, y]);
    }
    for (const [x, y] of ends.values())
      paths.holes += "M" + point(x, y) + "h0.001";
  }
  const count = Math.round(512 / s.spacing),
    step = 512 / count,
    rows = Math.max(2, Math.round(count / 2));
  if (s.layout === "border") {
    const span = 512 - 2 * s.inset,
      n = Math.max(2, Math.round(span / s.spacing)),
      size = span / n;
    for (let i = 0; i < n; i++) {
      const t = s.inset + (i + 0.5) * size;
      unit(t, s.inset, size);
      unit(512 - s.inset, t, size, Math.PI / 2);
      unit(512 - t, 512 - s.inset, size, Math.PI);
      unit(s.inset, 512 - t, size, -Math.PI / 2);
    }
  } else
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < count; i++) {
        const x = (i + 0.5) * step,
          y = ((j + 0.5) * 512) / rows;
        if (s.layout === "columns") unit(y, x, step, Math.PI / 2);
        else if (s.layout === "diagonal")
          unit(x, (y + i * step) % 512, step, Math.PI / 4);
        else unit(x, y, step);
      }
  return ["holes", "thread", "highlight"].map((role) => ({
    kind: "path",
    name: "Stitch " + role,
    stitchRole: role,
    path: paths[role],
    x: 256,
    y: 256,
    width: 512,
    height: 512,
    color:
      role === "holes"
        ? "#242321"
        : role === "highlight"
          ? stitchTint(s.color, 1.18)
          : s.color,
    finish: role === "holes" ? "ink" : "cotton",
    relief:
      role === "holes"
        ? -0.18
        : Math.min(1, s.relief + (role === "highlight" ? 0.04 : 0)),
    roughness: 0.84,
    metalness: 0,
    opacity: 1,
    strokeWidth:
      role === "holes"
        ? (s.width * 1.22) / 5.12
        : (s.width * (role === "highlight" ? 0.24 : 1)) / 5.12,
  }));
}
export function applyStitches(doc, patch = {}) {
  const stitch = normalizeStitches({ ...doc.stitch, ...patch }),
    layers = [
      ...doc.layers.filter((l) => !l.stitchRole),
      ...stitchLayers(stitch),
    ];
  if (layers.length > 64)
    throw new Error(
      "Stitching needs 3 free layers. Remove some motifs before adding stitches.",
    );
  return { ...doc, stitch, layers };
}

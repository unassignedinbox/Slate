// Small, explicit geometric constructions. No rug borders or cultural labels.
export const geometricCatalog = [
  {
    name: "Truchet circuits",
    id: "truchet-circuits",
    description:
      "Quarter-circle pairs meet at cell-edge midpoints, forming connected circuits.",
  },
  {
    name: "Octagon-square tiling",
    id: "octagon-square-tiling",
    description:
      "Regular octagons and square infills: the 4.8.8 vertex arrangement.",
  },
  {
    name: "Hexagon-triangle tiling",
    id: "hexagon-triangle-tiling",
    description:
      "Corner-touching regular hexagons and equilateral triangular gaps: 3.6.3.6.",
  },
  {
    name: "Dodecagon-triangle tiling",
    id: "dodecagon-triangle-tiling",
    description:
      "Edge-sharing regular dodecagons with triangular infills: 3.12.12.",
  },
  {
    name: "Herringbone parquet",
    id: "herringbone-parquet",
    description:
      "A complete plane tiling of 2:1 rectangles, meeting end-to-side in staggered courses.",
  },
  {
    name: "Hilbert meander",
    id: "hilbert-meander",
    description:
      "A third-order continuous square-grid curve with nested turns and no self-crossings.",
  },
].map((p) => ({ ...p, group: "Geometric constructions" }));
export function geometricPattern(name) {
  const spec = geometricCatalog.find((p) => p.name === name || p.id === name);
  if (!spec) return null;
  const d = {
    schema: "alloy.pattern.v1",
    name: spec.name,
    construction: spec.id,
    collection: spec.group,
    background: "#d6b879",
    repeats: 1,
    repeat: "straight",
    mapping: "uv",
    layers: [],
  };
  const n = (v) => Number((v / 5.12).toFixed(4));
  const poly = (p) =>
    p.map(([x, y], i) => (i ? "L" : "M") + n(x) + " " + n(y)).join("") + "Z";
  const add = (path, color, label, strokeWidth = 0) =>
    d.layers.push({
      kind: "path",
      name: label,
      path,
      color,
      x: 256,
      y: 256,
      width: 512,
      height: 512,
      finish: "cotton",
      relief: 0.03,
      strokeWidth: strokeWidth / 5.12,
    });
  if (spec.id === "truchet-circuits") {
    d.background = "#233b44";
    let path = "";
    const orientations = [
      0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1,
      1, 0, 1, 0, 0, 1, 0,
    ];
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const X = x * 64,
          Y = y * 64;
        if (orientations[(y * 8 + x) % orientations.length])
          path += `M${n(X + 32)} ${n(Y)}a${n(32)} ${n(32)} 0 0 0 ${n(32)} ${n(32)}M${n(X)} ${n(Y + 32)}a${n(32)} ${n(32)} 0 0 1 ${n(32)} ${n(32)}`;
        else
          path += `M${n(X)} ${n(Y + 32)}a${n(32)} ${n(32)} 0 0 0 ${n(32)} ${n(-32)}M${n(X + 32)} ${n(Y + 64)}a${n(32)} ${n(32)} 0 0 1 ${n(32)} ${n(-32)}`;
      }
    add(path, "#d6b879", "Circuit ribbons", 12);
    add(path, "#eddfc3", "Ribbon centerline", 3);
  } else if (spec.id === "octagon-square-tiling") {
    const s = 128,
      t = s / (2 + Math.SQRT2),
      paths = ["", ""];
    let outline = "";
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const points = [
          [t, 0],
          [s - t, 0],
          [s, t],
          [s, s - t],
          [s - t, s],
          [t, s],
          [0, s - t],
          [0, t],
        ].map(([a, b]) => [a + x * s, b + y * s]);
        paths[(x + y) % 2] += poly(points);
        outline += poly(
          points.map(([a, b]) => [
            (x + 0.5) * s + (a - (x + 0.5) * s) * 0.91,
            (y + 0.5) * s + (b - (y + 0.5) * s) * 0.91,
          ]),
        );
      }
    add(paths[0], "#244957", "Octagons A");
    add(paths[1], "#8d483d", "Octagons B");
    add(outline, "#dec89e", "Inset octagon line", 1.5);
  } else if (
    ["hexagon-triangle-tiling", "dodecagon-triangle-tiling"].includes(spec.id)
  ) {
    // A rectangular repeat of a triangular lattice. The physical aspect ratio
    // restores regular polygons, rather than stretching them to fit a square.
    d.designAspect = 2 / Math.sqrt(3);
    d.background = "#d7bc87";
    const twelve = spec.id.startsWith("dodecagon"),
      sides = twelve ? 12 : 6,
      r = twelve ? 64 / Math.cos(Math.PI / 12) : 64,
      paths = ["", ""];
    let outline = "";
    for (let row = -1; row <= 4; row++)
      for (let col = -1; col <= 4; col++) {
        const cx = col * 128 + (((row % 2) + 2) % 2) * 64,
          cy = row * 128;
        const points = Array.from({ length: sides }, (_, i) => {
          const a = (i * Math.PI * 2) / sides + (twelve ? Math.PI / 12 : 0);
          return [
            cx + r * Math.cos(a),
            cy + (r * Math.sin(a) * 2) / Math.sqrt(3),
          ];
        });
        paths[(((col + row) % 2) + 2) % 2] += poly(points);
        outline += poly(
          points.map(([x, y]) => [cx + (x - cx) * 0.88, cy + (y - cy) * 0.88]),
        );
      }
    add(paths[0], "#253e4a", "Polygon field A");
    add(paths[1], "#457e82", "Polygon field B");
    add(outline, "#dcc89e", "Inset polygon lines", 1.4);
  } else if (spec.id === "herringbone-parquet") {
    d.background = "#1d3039";
    const paths = ["", ""];
    for (let y = -2; y < 8; y++)
      for (let x = -2; x < 8; x++) {
        const m = (((x + y) % 4) + 4) % 4;
        if (m !== 0 && m !== 2) continue;
        const w = m === 0 ? 128 : 64,
          h = m === 0 ? 64 : 128,
          a = x * 64 + 3,
          b = y * 64 + 3;
        paths[m === 0 ? 0 : 1] += poly([
          [a, b],
          [a + w - 6, b],
          [a + w - 6, b + h - 6],
          [a, b + h - 6],
        ]);
      }
    add(paths[0], "#b9664d", "Horizontal blocks");
    add(paths[1], "#d6bc83", "Vertical blocks");
  } else {
    d.background = "#263e4a";
    const xy = (d) => {
      let x = 0,
        y = 0,
        t = d;
      for (let s = 1; s < 8; s *= 2) {
        const rx = 1 & (t >> 1),
          ry = 1 & (t ^ rx);
        if (!ry) {
          if (rx) {
            x = s - 1 - x;
            y = s - 1 - y;
          }
          [x, y] = [y, x];
        }
        x += s * rx;
        y += s * ry;
        t >>= 2;
      }
      return [x, y];
    };
    const path = Array.from({ length: 64 }, (_, i) => {
      const [x, y] = xy(i);
      return (i ? "L" : "M") + n(32 + x * 64) + " " + n(32 + y * 64);
    }).join("");
    add(path, "#d0aa67", "Continuous meander", 24);
    add(path, "#e6d6b5", "Meander inset", 6);
  }
  return d;
}

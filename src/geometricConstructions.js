// Set 02 consists of independent constructions, not palette/rotation variants.
export const geometricSetTwo = [
  [
    "Linked racetrack loops",
    "linked-racetrack-loops",
    "Two closed stadium paths interlace at four alternating over/under crossings.",
  ],
  [
    "Hexagon-square junctions",
    "hexagon-square-junctions",
    "Regular hexagons, squares and triangular gaps meet in a 3.4.6.4 tessellation.",
  ],
  [
    "Pinwheel square tessellation",
    "pinwheel-square-tessellation",
    "Large and small squares fill a Pythagorean lattice with a 3:1 edge ratio.",
  ],
  [
    "Tangram mosaic",
    "tangram-mosaic",
    "A complete seven-piece square dissection: five triangles, a square and a parallelogram.",
  ],
  [
    "Sierpinski lace",
    "sierpinski-lace",
    "Three recursive subdivisions leave triangular cutouts inside an equilateral-triangle field.",
  ],
  [
    "Vesica net",
    "vesica-net",
    "Intersecting equal-radius circles define joined horizontal and vertical lens regions.",
  ],
  [
    "Stepped corner inlay",
    "stepped-corner-inlay",
    "Eight alternating L-shaped courses grow around a square core, covering each block without overlap.",
  ],
  [
    "Ruled saddle lattice",
    "ruled-saddle-lattice",
    "Four opposed fans of straight lines form curved envelopes around open centers.",
  ],
].map(([name, id, description]) => ({
  name,
  id,
  description: "Set 02 — " + description,
  set: 2,
}));

// Set 03 adds eight constructions with independent geometric rules.
export const geometricSetThree = [
  [
    "Elongated triangle lattice",
    "elongated-triangle-lattice",
    "Alternating square courses and exact equilateral-triangle bands tile the plane.",
  ],
  [
    "Descartes circle packing",
    "descartes-circle-packing",
    "A triangular lattice of tangent circles with three recursive Descartes insertion levels.",
  ],
  [
    "Pythagorean branch lattice",
    "pythagorean-branch-lattice",
    "Right-isosceles joints spawn paired squares whose areas obey the Pythagorean relation.",
  ],
  [
    "Fibonacci square spiral",
    "fibonacci-square-spiral",
    "Six consecutive Fibonacci squares exactly pack a 13-by-8 rectangle; four copies form the tile.",
  ],
  [
    "Rhodonea rose lattice",
    "rhodonea-rose-lattice",
    "Eight-petal harmonic roses repeat on a square lattice with concentric construction rings.",
  ],
  [
    "Epicycloid gear lattice",
    "epicycloid-gear-lattice",
    "Five-cusp rolling-circle curves nest within a periodic field of analytic gear profiles.",
  ],
  [
    "Decagram chord lattice",
    "decagram-chord-lattice",
    "Ten-vertex star polygons, decagon chords and a measured inner ring form each orbit cell.",
  ],
  [
    "Harmonic wave lattice",
    "harmonic-wave-lattice",
    "Orthogonal sinusoidal families meet with periodic phase and continuous repeat edges.",
  ],
].map(([name, id, description]) => ({
  name,
  id,
  description: "Set 03 — " + description,
  set: 3,
}));

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
  ...geometricSetTwo,
  ...geometricSetThree,
].map((p) => ({ ...p, group: "Geometric constructions" }));
export function geometricPattern(name) {
  const spec = geometricCatalog.find((p) => p.name === name || p.id === name);
  if (!spec) return null;
  if (spec.set === 2) return geometricSetTwoPattern(spec);
  if (spec.set === 3) return geometricSetThreePattern(spec);
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

// Coordinates in a four-unit square; areas are 4,4,2,1,2,1,2.
export const tangramDissection = [
  [
    [0, 0],
    [4, 0],
    [2, 2],
  ],
  [
    [0, 0],
    [2, 2],
    [0, 4],
  ],
  [
    [4, 4],
    [2, 4],
    [4, 2],
  ],
  [
    [4, 0],
    [4, 2],
    [3, 1],
  ],
  [
    [2, 2],
    [3, 1],
    [4, 2],
    [3, 3],
  ],
  [
    [2, 2],
    [3, 3],
    [1, 3],
  ],
  [
    [0, 4],
    [1, 3],
    [3, 3],
    [2, 4],
  ],
];

function geometricSetTwoPattern(spec) {
  const d = {
    schema: "alloy.pattern.v1",
    name: spec.name,
    construction: spec.id,
    collection: "Geometric constructions",
    background: "#233b44",
    repeat: "straight",
    repeats: 1,
    mapping: "uv",
    layers: [],
  };
  const n = (v) => Number((v / 5.12).toFixed(4));
  const poly = (pts) =>
    pts.map(([x, y], i) => (i ? "L" : "M") + n(x) + " " + n(y)).join("") + "Z";
  const line = (pts) =>
    pts.map(([x, y], i) => (i ? "L" : "M") + n(x) + " " + n(y)).join("");
  const square = (x, y, w) => [
    [x, y],
    [x + w, y],
    [x + w, y + w],
    [x, y + w],
  ];
  const inset = (pts, t) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
      cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return pts.map(([x, y]) => [cx + (x - cx) * t, cy + (y - cy) * t]);
  };
  const add = (path, color, name, width = 0) => {
    if (path)
      d.layers.push({
        kind: "path",
        path,
        color,
        name,
        x: 256,
        y: 256,
        width: 512,
        height: 512,
        finish: "cotton",
        roughness: 0.83,
        metalness: 0,
        relief: 0.03,
        strokeWidth: width / 5.12,
      });
  };
  const cream = "#eddfc3",
    gold = "#d6b879",
    teal = "#457e82",
    coral = "#b9664d",
    dark = "#233b44";
  if (spec.id === "linked-racetrack-loops") {
    let horizontal = "",
      vertical = "",
      bridges = "",
      bridgeCuts = "",
      bridgeInlays = "";
    const a = 65,
      b = 30;
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        const x = 128 + col * 256,
          y = 128 + row * 256;
        horizontal += `M${n(x - a)} ${n(y - b)}H${n(x + a)}a${n(b)} ${n(b)} 0 0 1 0 ${n(2 * b)}H${n(x - a)}a${n(b)} ${n(b)} 0 0 1 0 ${n(-2 * b)}Z`;
        vertical += `M${n(x - b)} ${n(y - a)}a${n(b)} ${n(b)} 0 0 1 ${n(2 * b)} 0V${n(y + a)}a${n(b)} ${n(b)} 0 0 1 ${n(-2 * b)} 0Z`;
        for (const s of [-1, 1]) {
          bridgeInlays += line([
            [x + s * b - 27, y + s * b],
            [x + s * b + 27, y + s * b],
          ]);
          bridgeCuts += poly([
            [x + s * b - 15, y + s * b - 13.5],
            [x + s * b + 15, y + s * b - 13.5],
            [x + s * b + 15, y + s * b + 13.5],
            [x + s * b - 15, y + s * b + 13.5],
          ]);
          bridges += line([
            [x + s * b - 15, y + s * b],
            [x + s * b + 15, y + s * b],
          ]);
        }
      }
    // Dark sleeves separate the crossing, followed by the upper colored path.
    // B is on top at two crossings; the explicit A bridges reverse the other two.
    add(horizontal, gold, "Horizontal closed loops", 19);
    add(horizontal, cream, "Horizontal inlaid centerline", 3);
    add(vertical, dark, "Vertical crossing clearance", 27);
    add(vertical, teal, "Vertical closed loops", 19);
    add(vertical, cream, "Vertical inlaid centerline", 3);
    add(bridgeCuts, dark, "Alternating bridge clearance");
    add(bridges, gold, "Horizontal upper bridges", 19);
    add(bridgeInlays, cream, "Bridge centerline", 3);
  } else if (spec.id === "hexagon-square-junctions") {
    d.designAspect = 2 / Math.sqrt(3);
    d.background = cream;
    const D = 128,
      s = D / (1 + Math.sqrt(3)),
      q = 2 / Math.sqrt(3),
      hex = ["", ""],
      squares = [];
    let outlines = "";
    for (let row = -2; row <= 5; row++)
      for (let col = -2; col <= 5; col++) {
        const cx = col * D + ((((row % 2) + 2) % 2) * D) / 2,
          cy = (row * Math.sqrt(3) * D) / 2;
        const p = Array.from({ length: 6 }, (_, i) => {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          return [cx + s * Math.cos(a), (cy + s * Math.sin(a)) * q];
        });
        hex[(((row + col) % 2) + 2) % 2] += poly(p);
        outlines += poly(inset(p, 0.84));
        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI) / 3,
            nx = Math.cos(a),
            ny = Math.sin(a),
            mx = cx + (nx * D) / 2,
            my = cy + (ny * D) / 2;
          const p = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([u, v]) => [
            mx + (s / 2) * (u * nx - v * ny),
            (my + (s / 2) * (u * ny + v * nx)) * q,
          ]);
          squares.push(poly(p));
          outlines += poly(inset(p, 0.77));
        }
      }
    add(hex[0], dark, "Hexagonal cells A");
    add(hex[1], teal, "Hexagonal cells B");
    add(squares.join(""), coral, "Square connectors");
    add(outlines, gold, "Polygon inlay lines", 1.3);
  } else if (spec.id === "pinwheel-square-tessellation") {
    d.background = gold;
    const paths = ["", ""];
    let small = "",
      borders = "";
    const u = 51.2;
    for (let y = -3; y <= 10; y++)
      for (let x = -3; x <= 10; x++) {
        if ((((3 * x + y) % 10) + 10) % 10 !== 0) continue;
        const parity = ((3 * x + y) / 10 + (-x + 3 * y) / 10) % 2;
        const big = square(x * u, y * u, 3 * u),
          little = square((x + 2) * u, (y + 3) * u, u);
        paths[(parity + 2) % 2] += poly(inset(big, 0.967));
        small += poly(inset(little, 0.9));
        borders += poly(inset(big, 0.84));
      }
    add(paths[0], dark, "Large squares A");
    add(paths[1], teal, "Large squares B");
    add(small, coral, "Small square infills");
    add(borders, cream, "Large-square inset lines", 1.3);
  } else if (spec.id === "tangram-mosaic") {
    d.background = dark;
    const paths = Array(7).fill("");
    let outlines = "";
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++)
        for (let k = 0; k < 7; k++) {
          const p = tangramDissection[k].map(([x, y]) => {
            if ((row + col) % 2) [x, y] = [4 - x, 4 - y];
            return [col * 256 + x * 64, row * 256 + y * 64];
          });
          paths[k] += poly(inset(p, 0.972));
          outlines += poly(inset(p, 0.85));
        }
    paths.forEach((p, i) =>
      add(
        p,
        [teal, coral, gold, cream, dark, gold, teal][i],
        "Tangram piece " + (i + 1),
      ),
    );
    add(outlines, cream, "Piece inset lines", 1.15);
  } else if (spec.id === "sierpinski-lace") {
    d.designAspect = 2 / Math.sqrt(3);
    const paths = ["", ""];
    let outlines = "";
    const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const gasket = (p, depth, k) => {
      if (!depth) {
        paths[k] += poly(p);
        return;
      }
      const [a, b, c] = p,
        ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      gasket([a, ab, ca], depth - 1, k);
      gasket([ab, b, bc], depth - 1, k);
      gasket([ca, bc, c], depth - 1, k);
    };
    for (let row = 0; row < 2; row++)
      for (let col = -1; col <= 2; col++) {
        const x = col * 256 + (row % 2) * 128,
          y = row * 256;
        const a = [
            [x, y],
            [x + 256, y],
            [x + 128, y + 256],
          ],
          b = [
            [x + 128, y + 256],
            [x + 256, y],
            [x + 384, y + 256],
          ];
        gasket(a, 3, 0);
        gasket(b, 3, 1);
        outlines += poly(a) + poly(b);
      }
    add(paths[0], cream, "Recursive triangles A");
    add(paths[1], teal, "Recursive triangles B");
    add(outlines, gold, "Triangular field edges", 1.25);
  } else if (spec.id === "vesica-net") {
    const s = 128,
      r = s / Math.sqrt(2);
    let h = "",
      v = "",
      circles = "";
    for (let row = -1; row <= 4; row++)
      for (let col = -1; col <= 4; col++) {
        const x = col * s,
          y = row * s;
        h += `M${n(x + 64)} ${n(y - 64)}a${n(r)} ${n(r)} 0 0 1 0 ${n(128)}a${n(r)} ${n(r)} 0 0 1 0 ${n(-128)}Z`;
        v += `M${n(x + 64)} ${n(y + 64)}a${n(r)} ${n(r)} 0 0 1 ${n(-128)} 0a${n(r)} ${n(r)} 0 0 1 ${n(128)} 0Z`;
        circles += `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
      }
    add(h, teal, "Horizontal lens regions");
    add(v, coral, "Vertical lens regions");
    add(circles, gold, "Shared circular boundaries", 2);
  } else if (spec.id === "stepped-corner-inlay") {
    const paths = Array(9).fill("");
    let seams = "";
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        let x0 = 112,
          y0 = 112,
          x1 = 144,
          y1 = 144;
        const place = (p) =>
          p.map(([x, y]) => {
            if ((row + col) % 2) [x, y] = [256 - x, 256 - y];
            return [x + col * 256, y + row * 256];
          });
        const core = place(square(x0, y0, 32));
        paths[0] += poly(core);
        seams += poly(core);
        for (let k = 0; k < 8; k++) {
          const t = 28;
          let p;
          if (k % 2 === 0) {
            p = [
              [x0, y0 - t],
              [x1 + t, y0 - t],
              [x1 + t, y1],
              [x1, y1],
              [x1, y0],
              [x0, y0],
            ];
            y0 -= t;
            x1 += t;
          } else {
            p = [
              [x0 - t, y0],
              [x0, y0],
              [x0, y1],
              [x1, y1],
              [x1, y1 + t],
              [x0 - t, y1 + t],
            ];
            x0 -= t;
            y1 += t;
          }
          p = place(p);
          paths[k + 1] += poly(p);
          seams += poly(p);
        }
      }
    paths.forEach((p, i) =>
      add(
        p,
        [gold, teal, coral, cream, dark, gold, teal, coral, cream][i],
        i ? "Elbow course " + i : "Square cores",
      ),
    );
    add(seams, dark, "Course joints", 2.5);
  } else if (spec.id === "ruled-saddle-lattice") {
    const paths = ["", ""];
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++) {
        const cx = 128 + col * 256,
          cy = 128 + row * 256;
        for (const sx of [-1, 1])
          for (const sy of [-1, 1])
            for (let i = 0; i <= 24; i++) {
              const t = i / 24;
              paths[sx === sy ? 0 : 1] += line([
                [cx + sx * t * 128, cy],
                [cx, cy + sy * (1 - t) * 128],
              ]);
            }
      }
    add(paths[0], gold, "Opposed gold line fans", 1.35);
    add(paths[1], cream, "Opposed ivory line fans", 1.35);
  }
  return d;
}

// The positive Descartes root inserts the circle inside a bounded gap between
// three pairwise externally tangent circles. Coordinates share their units.
export function descartesGapCircle(triple) {
  if (
    !Array.isArray(triple) ||
    triple.length !== 3 ||
    triple.some(
      (c) =>
        !Number.isFinite(c?.x) ||
        !Number.isFinite(c?.y) ||
        !Number.isFinite(c?.r) ||
        c.r <= 0,
    )
  )
    throw new Error("A Descartes gap needs three finite positive circles.");
  const [a, b, c] = triple,
    ka = 1 / a.r,
    kb = 1 / b.r,
    kc = 1 / c.r,
    k = ka + kb + kc + 2 * Math.sqrt(ka * kb + kb * kc + kc * ka),
    r = 1 / k;
  const dx1 = b.x - a.x,
    dy1 = b.y - a.y,
    dx2 = c.x - a.x,
    dy2 = c.y - a.y,
    rhs1 =
      b.x * b.x +
      b.y * b.y -
      a.x * a.x -
      a.y * a.y -
      (b.r * b.r - a.r * a.r) -
      2 * r * (b.r - a.r),
    rhs2 =
      c.x * c.x +
      c.y * c.y -
      a.x * a.x -
      a.y * a.y -
      (c.r * c.r - a.r * a.r) -
      2 * r * (c.r - a.r),
    det = 4 * (dx1 * dy2 - dy1 * dx2);
  if (Math.abs(det) < 1e-12)
    throw new Error("The three Descartes circles must not be collinear.");
  const x = (2 * dy2 * rhs1 - 2 * dy1 * rhs2) / det,
    y = (2 * dx1 * rhs2 - 2 * dx2 * rhs1) / det;
  return { x, y, r };
}

function geometricSetThreePattern(spec) {
  const d = {
    schema: "alloy.pattern.v1",
    name: spec.name,
    construction: spec.id,
    collection: "Geometric constructions",
    background: "#233b44",
    repeat: "straight",
    repeats: 1,
    mapping: "uv",
    layers: [],
  };
  const n = (v) => Number((v / 5.12).toFixed(4));
  const xy = (x, y) => [n(x), n(y)];
  const poly = (pts, project = xy) =>
    pts
      .map(([x, y], i) => {
        const [X, Y] = project(x, y);
        return (i ? "L" : "M") + X + " " + Y;
      })
      .join("") + "Z";
  const line = (pts, project = xy) =>
    pts
      .map(([x, y], i) => {
        const [X, Y] = project(x, y);
        return (i ? "L" : "M") + X + " " + Y;
      })
      .join("");
  const add = (path, color, name, width = 0, fillRule) => {
    if (path)
      d.layers.push({
        kind: "path",
        path,
        color,
        name,
        x: 256,
        y: 256,
        width: 512,
        height: 512,
        finish: "cotton",
        roughness: 0.83,
        metalness: 0,
        relief: 0.03,
        strokeWidth: width / 5.12,
        ...(fillRule ? { fillRule } : {}),
      });
  };
  const dark = "#233b44",
    cream = "#eddfc3",
    gold = "#d6b879",
    teal = "#457e82",
    coral = "#b9664d";
  if (spec.id === "elongated-triangle-lattice") {
    const a = 112,
      h = (a * Math.sqrt(3)) / 2,
      W = 2 * a,
      H = 2 * (a + h),
      project = (x, y) => [n((x * 512) / W), n((y * 512) / H)];
    d.designAspect = W / H;
    d.background = dark;
    const blocks = ["", ""];
    let up = "",
      down = "",
      joints = "";
    const insetPath = (p, t = 0.91) => {
      const cx = p.reduce((s, v) => s + v[0], 0) / p.length,
        cy = p.reduce((s, v) => s + v[1], 0) / p.length;
      return poly(p.map(([x, y]) => [cx + (x - cx) * t, cy + (y - cy) * t]));
    };
    const inTile = (cx, cy) => cx >= 0 && cx < W && cy >= 0 && cy < H;
    for (let row = 0; row < 2; row++) {
      const phase = row * (a / 2),
        y = row * (a + h);
      for (let col = -2; col <= 3; col++) {
        const x = phase + col * a,
          square = [
            [x, y],
            [x + a, y],
            [x + a, y + a],
            [x, y + a],
          ],
          lo = y + a,
          hi = lo + h,
          upTri = [
            [x, lo],
            [x + a, lo],
            [x + a / 2, hi],
          ],
          downTri = [
            [x + a / 2, hi],
            [x + 1.5 * a, hi],
            [x + a, lo],
          ];
        if (inTile(x + a / 2, y + a / 2)) {
          blocks[((row + col) % 2 + 2) % 2] += poly(square, project);
          joints += insetPath(square, 0.91);
        }
        if (inTile(x + a / 2, lo + h / 3)) {
          up += poly(upTri, project);
          joints += insetPath(upTri, 0.91);
        }
        if (inTile(x + a, lo + (2 * h) / 3)) {
          down += poly(downTri, project);
          joints += insetPath(downTri, 0.91);
        }
      }
    }
    add(blocks[0], teal, "Square course A");
    add(blocks[1], coral, "Square course B");
    add(up, gold, "Upward equilateral triangles");
    add(down, cream, "Downward equilateral triangles");
    add(joints, dark, "Individual tile joints", 1.35);
  } else if (spec.id === "descartes-circle-packing") {
    const R = 1,
      W = 2 * R,
      H = 2 * Math.sqrt(3) * R,
      project = (x, y) => [n((x * 512) / W), n((y * 512) / H)];
    d.designAspect = W / H;
    d.background = "#f0e7d4";
    const layers = ["", "", "", ""],
      inTile = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
    const circlePath = ({ x, y, r }) => {
      const [X, Y] = project(x, y),
        rx = n((r * 512) / W),
        ry = n((r * 512) / H);
      return `M${(X + rx).toFixed(4)} ${Y}a${rx} ${ry} 0 1 0 ${(-2 * rx).toFixed(4)} 0a${rx} ${ry} 0 1 0 ${(2 * rx).toFixed(4)} 0Z`;
    };
    const fill = (triple, depth) => {
      const circle = descartesGapCircle(triple);
      layers[depth] += circlePath(circle);
      if (depth < 3)
        for (let i = 0; i < 3; i++)
          fill([triple[i], triple[(i + 1) % 3], circle], depth + 1);
    };
    const center = (i, j) => ({
      x: 2 * i + j,
      y: Math.sqrt(3) * j,
      r: R,
    });
    // A 2-by-2√3 rectangle is a fundamental domain of the triangular circle
    // lattice; include each circle/gap once and let SVG repetition close it.
    for (let row = -1; row <= 2; row++)
      for (let col = -2; col <= 2; col++) {
        const c = center(col, row);
        if (inTile(c.x, c.y)) layers[0] += circlePath(c);
      }
    for (let row = -2; row <= 3; row++)
      for (let col = -3; col <= 3; col++) {
        const a = center(col, row),
          b = center(col + 1, row),
          c = center(col, row + 1),
          e = center(col + 1, row + 1);
        for (const triple of [
          [a, b, c],
          [b, e, c],
        ]) {
          const x = triple.reduce((s, p) => s + p.x, 0) / 3,
            y = triple.reduce((s, p) => s + p.y, 0) / 3;
          if (inTile(x, y)) fill(triple, 1);
        }
      }
    add(layers[0], "#31545c", "Triangular lattice circle faces");
    add(layers[0], dark, "Tangent circle boundaries", 1.05);
    add(layers[1], teal, "First Descartes fills");
    add(layers[1], dark, "First circle inlays", 0.85);
    add(layers[2], gold, "Second Descartes fills");
    add(layers[2], dark, "Second circle inlays", 0.7);
    add(layers[3], coral, "Third Descartes fills");
    add(layers[3], dark, "Third circle inlays", 0.55);
  } else if (spec.id === "pythagorean-branch-lattice") {
    d.background = dark;
    const squares = Array.from({ length: 5 }, () => ""),
      triangles = Array.from({ length: 4 }, () => "");
    let joints = "";
    const length = (v) => Math.hypot(v[0], v[1]),
      scale = (v, t) => [v[0] * t, v[1] * t],
      addv = (a, b) => [a[0] + b[0], a[1] + b[1]],
      sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
      away = (a, b, reference) => {
        const v = sub(b, a),
          l = length(v),
          m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let normal = [-v[1] / l, v[0] / l];
        if (
          normal[0] * (reference[0] - m[0]) +
            normal[1] * (reference[1] - m[1]) >
          0
        )
          normal = scale(normal, -1);
        return normal;
      };
    const grow = (a, b, interior, depth, root = false) => {
      const v = sub(b, a),
        side = length(v),
        squareA = addv(a, scale(interior, side)),
        squareB = addv(b, scale(interior, side)),
        square = [a, b, squareB, squareA];
      squares[depth] += poly(square);
      const cx = square.reduce((s, p) => s + p[0], 0) / 4,
        cy = square.reduce((s, p) => s + p[1], 0) / 4;
      joints += poly(
        square.map(([x, y]) => [cx + (x - cx) * 0.94, cy + (y - cy) * 0.94]),
      );
      if (!depth) return;
      // The root's triangle attaches directly to the square's upper edge.
      // Descendant squares attach on a triangle leg, so their next triangle
      // grows from the far edge, continuing away from the preceding joint.
      const triA = root ? a : squareA,
        triB = root ? b : squareB,
        out = scale(interior, root ? -1 : 1),
        unit = scale(sub(triB, triA), 1 / side),
        apex = addv(triA, addv(scale(unit, side / 2), scale(out, side / 2))),
        tri = [triA, triB, apex],
        centroid = [
          tri.reduce((s, p) => s + p[0], 0) / 3,
          tri.reduce((s, p) => s + p[1], 0) / 3,
        ];
      triangles[depth - 1] += poly(tri);
      grow(triA, apex, away(triA, apex, centroid), depth - 1);
      grow(apex, triB, away(apex, triB, centroid), depth - 1);
    };
    grow([214, 402], [298, 402], [0, 1], 4, true);
    squares.forEach((path, i) =>
      add(path, [gold, teal, coral, cream, gold][i], `Branch squares · level ${i + 1}`),
    );
    triangles.forEach((path, i) =>
      add(path, [coral, gold, teal, cream][i], `Right-angle joints · level ${i + 1}`),
    );
    add(joints, dark, "Square inset joints", 1.2);
  } else if (spec.id === "fibonacci-square-spiral") {
    d.background = "#1e343e";
    const squares = ["", "", "", ""];
    let joints = "",
      progressions = "";
    const tiles = [
      [0, 0, 1],
      [1, 0, 1],
      [0, -2, 2],
      [-3, -2, 3],
      [-3, 1, 5],
      [2, -2, 8],
    ];
    const scale = 18.5;
    for (const cy of [128, 384])
      for (const cx of [128, 384]) {
        const project = (x, y) => [
          n(cx - (13 * scale) / 2 + (x + 3) * scale),
          n(cy - (8 * scale) / 2 + (y + 2) * scale),
        ];
        const centers = [];
        tiles.forEach(([x, y, side], i) => {
          const p = [
            [x, y],
            [x + side, y],
            [x + side, y + side],
            [x, y + side],
          ];
          squares[i % 4] += poly(p, project);
          const mx = x + side / 2,
            my = y + side / 2;
          centers.push([mx, my]);
          joints += poly(
            p.map(([px, py]) => [mx + (px - mx) * 0.91, my + (py - my) * 0.91]),
            project,
          );
        });
        progressions += line(centers, project);
      }
    squares.forEach((path, i) =>
      add(path, [teal, coral, gold, "#39545d"][i], `Fibonacci square class ${i + 1}`),
    );
    add(joints, cream, "Twenty-four inset square outlines", 1.2);
    add(progressions, gold, "Square-center construction line", 1.35);
  } else if (spec.id === "rhodonea-rose-lattice") {
    d.background = "#243c45";
    let outer = "",
      inner = "",
      rays = "",
      rings = "";
    for (const cy of [128, 384])
      for (const cx of [128, 384]) {
        const rose = (radius, phase = 0) => {
          const pts = Array.from({ length: 513 }, (_, i) => {
            const t = (i * Math.PI * 2) / 512,
              r = radius * Math.cos(4 * t + phase);
            return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
          });
          return line(pts) + "Z";
        };
        outer += rose(70);
        inner += rose(44, Math.PI / 8);
        for (let k = 0; k < 8; k++) {
          const t = (k * Math.PI) / 4,
            r = 70 * Math.cos(4 * t);
          rays += line([
            [cx, cy],
            [cx + r * Math.cos(t), cy + r * Math.sin(t)],
          ]);
        }
        rings += `M${n(cx + 13)} ${n(cy)}a${n(13)} ${n(13)} 0 1 0 ${n(-26)} 0a${n(13)} ${n(13)} 0 1 0 ${n(26)} 0Z`;
      }
    add(outer, teal, "Eight-lobed rhodonea curves", 2.25);
    add(inner, gold, "Offset inner harmonic", 1.5);
    add(rays, cream, "Petal construction radii", 1.05);
    add(rings, coral, "Central orbit rings", 1.2);
  } else if (spec.id === "epicycloid-gear-lattice") {
    d.background = "#203741";
    let faces = "",
      teeth = "",
      hubs = "",
      spokes = "";
    const q = 5,
      count = q * 160;
    for (const cy of [128, 384])
      for (const cx of [128, 384]) {
        const gear = (radius) => {
          const pts = Array.from({ length: count + 1 }, (_, i) => {
            const t = (i * Math.PI * 2) / count,
              s = radius / q,
              x = s * ((q + 1) * Math.cos(t) - Math.cos((q + 1) * t)),
              y = s * ((q + 1) * Math.sin(t) - Math.sin((q + 1) * t));
            return [cx + x, cy + y];
          });
          return line(pts) + "Z";
        };
        faces += gear(71);
        teeth += gear(71);
        hubs += `M${n(cx + 15)} ${n(cy)}a${n(15)} ${n(15)} 0 1 0 ${n(-30)} 0a${n(15)} ${n(15)} 0 1 0 ${n(30)} 0Z`;
        for (let k = 0; k < q; k++) {
          const t = (2 * Math.PI * k) / q,
            radius = 70;
          spokes += line([
            [cx, cy],
            [cx + radius * Math.cos(t), cy + radius * Math.sin(t)],
          ]);
        }
      }
    add(faces, teal, "Five-cusp rolling-circle profiles");
    add(teeth, gold, "Profile edge", 1.6);
    add(spokes, cream, "Five radial tooth axes", 1.1);
    add(hubs, coral, "Gear hubs", 1.35);
  } else if (spec.id === "decagram-chord-lattice") {
    d.background = dark;
    let faces = "",
      decagons = "",
      star = "",
      pentagrams = "",
      rings = "";
    for (const cy of [128, 384])
      for (const cx of [128, 384]) {
        const v = Array.from({ length: 10 }, (_, i) => {
          const a = -Math.PI / 2 + (2 * Math.PI * i) / 10;
          return [cx + 70 * Math.cos(a), cy + 70 * Math.sin(a)];
        });
        faces += poly(v);
        decagons += poly(v);
        const cycle = [];
        let index = 0;
        do {
          cycle.push(v[index]);
          index = (index + 3) % 10;
        } while (index !== 0);
        star += line(cycle) + "Z";
        for (let start = 0; start < 2; start++) {
          const p = [];
          for (let j = 0; j < 5; j++) p.push(v[(start + j * 2) % 10]);
          pentagrams += line(p) + "Z";
        }
        rings += `M${n(cx + 21)} ${n(cy)}a${n(21)} ${n(21)} 0 1 0 ${n(-42)} 0a${n(21)} ${n(21)} 0 1 0 ${n(42)} 0Z`;
      }
    add(faces, "#36545b", "Decagon fields");
    add(decagons, gold, "Ten equal chord intervals", 1.25);
    add(star, cream, "Regular decagram chords", 1.7);
    add(pentagrams, coral, "Crossed pentagram chords", 1.15);
    add(rings, teal, "Inner tenfold rings", 1.25);
  } else if (spec.id === "harmonic-wave-lattice") {
    d.background = "#203741";
    let horizontal = "",
      vertical = "";
    const period = 128,
      amplitude = 18,
      step = 4;
    for (let row = -1; row <= 5; row++) {
      const phase = (row * Math.PI) / 2,
        pts = [];
      for (let x = 0; x <= 512; x += step)
        pts.push([
          x,
          row * period + amplitude * Math.sin((2 * Math.PI * x) / period + phase),
        ]);
      horizontal += line(pts);
    }
    for (let col = -1; col <= 5; col++) {
      const phase = (col * Math.PI) / 2,
        pts = [];
      for (let y = 0; y <= 512; y += step)
        pts.push([
          col * period + amplitude * Math.sin((2 * Math.PI * y) / period + phase),
          y,
        ]);
      vertical += line(pts);
    }
    add(horizontal, teal, "Horizontal harmonic rows", 1.35);
    add(vertical, gold, "Vertical harmonic columns", 1.35);
  }
  return d;
}

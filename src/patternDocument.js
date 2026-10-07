import {
  collectionPatterns,
  collectionPattern,
  normalizeCollectionFade,
} from "./patternCollections.js";
import { sanitizePatternSVG } from "./patternImport.js";
// Portable vector pattern documents. No DOM dependency; shared by editor/export.
export const patternFinishes = {
  ink: {
    name: "Printed dye",
    roughness: 0.62,
    metalness: 0,
    height: 0,
    code: 0,
  },
  cotton: {
    name: "Woven cotton",
    roughness: 0.83,
    metalness: 0,
    height: 0.08,
    code: 1,
  },
  wool: {
    name: "Cut-pile wool",
    roughness: 0.94,
    metalness: 0,
    height: 0.65,
    code: 2,
  },
  ceramic: {
    name: "Glazed ceramic",
    roughness: 0.2,
    metalness: 0,
    height: 0.18,
    code: 3,
  },
  foil: {
    name: "Metal inlay",
    roughness: 0.28,
    metalness: 1,
    height: 0.04,
    code: 4,
  },
};
const patternNumber = (v, d, lo, hi) =>
  Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d;
const patternColor = (v, d = "#dd765d") =>
  /^#[a-f\d]{6}$/i.test(v || "") ? v : d;
export function validatePattern(input) {
  if (
    !input ||
    input.schema !== "alloy.pattern.v1" ||
    !Array.isArray(input.layers)
  )
    throw new Error("Not an Alloy pattern document.");
  if (JSON.stringify(input).length > 12000000)
    throw new Error("Pattern document exceeds 12 MB.");
  if (input.layers.length > 64)
    throw new Error("A pattern supports up to 64 layers.");
  const tileAxes = ["x", "y"].includes(input.tileAxes) ? input.tileAxes : "xy";
  return {
    schema: "alloy.pattern.v1",
    name: String(input.name || "Untitled pattern").slice(0, 80),
    ...(input.collection
      ? { collection: String(input.collection).slice(0, 60) }
      : {}),
    ...(input.presentation === "rug" ? { presentation: "rug" } : {}),
    ...(input.fade ? { fade: normalizeCollectionFade(input.fade) } : {}),
    tileAxes,
    background: patternColor(input.background, "#eee8dc"),
    backgroundOpacity: patternNumber(input.backgroundOpacity, 1, 0, 1),
    repeat:
      tileAxes !== "xy"
        ? "straight"
        : ["straight", "half-drop", "mirror"].includes(input.repeat)
          ? input.repeat
          : "straight",
    repeats: patternNumber(input.repeats, 2, 0.25, 24),
    rotation: patternNumber(input.rotation, 0, -180, 180),
    mapping: ["object", "cylinder"].includes(input.mapping)
      ? input.mapping
      : "uv",
    layers: input.layers.map((l, i) => {
      const finish = Object.hasOwn(patternFinishes, l.finish)
        ? l.finish
        : "ink";
      const defaults = patternFinishes[finish];
      const kind = [
        "rect",
        "ellipse",
        "diamond",
        "triangle",
        "flower",
        "path",
        "image",
        "svg",
      ].includes(l.kind)
        ? l.kind
        : "rect";
      const path = String(l.path || "").slice(0, 100000);
      if (kind === "path" && !/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]*$/.test(path))
        throw new Error("Invalid SVG path.");
      const src = String(l.src || "");
      if (
        kind === "image" &&
        (!/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=\s]+$/i.test(src) ||
          src.length > 6000000)
      )
        throw new Error(
          "Images must be embedded PNG, JPEG or WebP, at most 4 MB.",
        );
      return {
        id: "layer-" + i,
        name: String(l.name || kind).slice(0, 60),
        kind,
        x: patternNumber(l.x, 256, -512, 1024),
        y: patternNumber(l.y, 256, -512, 1024),
        width: patternNumber(l.width, 100, 1, 1024),
        height: patternNumber(l.height, 100, 1, 1024),
        rotation: patternNumber(l.rotation, 0, -360, 360),
        flipX: l.flipX === true,
        flipY: l.flipY === true,
        opacity: patternNumber(l.opacity, 1, 0, 1),
        color: patternColor(l.color),
        stroke: patternColor(l.stroke, "#222222"),
        strokeWidth: patternNumber(l.strokeWidth, 0, 0, 25),
        finish,
        roughness: patternNumber(l.roughness, defaults.roughness, 0.05, 1),
        metalness: patternNumber(l.metalness, defaults.metalness, 0, 1),
        relief: patternNumber(l.relief, defaults.height, -1, 1),
        visible: l.visible !== false,
        path,
        ...(kind === "image" ? { src } : {}),
        ...(kind === "svg"
          ? { svg: sanitizePatternSVG(String(l.svg || "")) }
          : {}),
      };
    }),
  };
}
export function patternLayer(kind = "diamond", extra = {}) {
  return {
    kind,
    name: kind,
    x: 256,
    y: 256,
    width: 160,
    height: 160,
    rotation: 0,
    opacity: 1,
    color: "#dd765d",
    finish: "cotton",
    ...extra,
  };
}
export const patternStarterNames = [
  "Diamond weave",
  "Painted blossoms",
  "Cube lattice",
  "Inlaid tile",
  "Banded geometry",
  "Medallion rug",
  "Graduated lattice",
  ...collectionPatterns.map((p) => p.name),
  "Blank",
];
export function patternStarter(name = "Diamond weave") {
  const collection = collectionPattern(name);
  if (collection) return validatePattern(collection);
  const d = {
    schema: "alloy.pattern.v1",
    name,
    background: "#263c48",
    repeat: "straight",
    repeats: 2,
    layers: [],
  };
  if (name === "Diamond weave") {
    d.layers.push(
      patternLayer("rect", {
        width: 512,
        height: 512,
        color: "#263c48",
        finish: "wool",
        relief: 0.3,
      }),
    );
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++)
        for (let j = 0; j < 4; j++)
          d.layers.push(
            patternLayer("diamond", {
              x: 128 + x * 256,
              y: 128 + y * 256,
              width: 242 - j * 53,
              height: 242 - j * 53,
              color: j % 2 ? "#263c48" : ["#cc705b", "#d8b16b"][x],
              finish: "wool",
            }),
          );
  } else if (name === "Painted blossoms") {
    d.background = "#fff5e4";
    d.repeat = "half-drop";
    for (let i = 0; i < 7; i++) {
      const x = (i * 197 + 37) % 512,
        y = (i * 113 + 64) % 512;
      d.layers.push(
        patternLayer("flower", {
          x,
          y,
          width: 100 + (i % 3) * 27,
          height: 100 + (i % 3) * 27,
          color: i % 2 ? "#fa9288" : "#e6505b",
          rotation: i * 21,
          finish: "cotton",
        }),
      );
      d.layers.push(
        patternLayer("ellipse", {
          x: x + 54,
          y: y + 56,
          width: 19,
          height: 45,
          rotation: 35,
          color: "#8c8545",
          finish: "cotton",
        }),
      );
      d.layers.push(
        patternLayer("ellipse", {
          x,
          y,
          width: 23,
          height: 23,
          color: "#9b633c",
          finish: "cotton",
        }),
      );
    }
  } else if (name === "Cube lattice") {
    d.background = "#207585";
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        d.layers.push(
          patternLayer("path", {
            x: x * 128 + (y % 2) * 64,
            y: y * 128,
            width: 128,
            height: 128,
            color: "#ecf0e3",
            path: "M 50 0 L 94 25 L 94 75 L 50 100 L 6 75 L 6 25 Z M 50 0 L 50 50 L 94 75 M 50 50 L 6 75",
            strokeWidth: 4,
            stroke: "#ecf0e3",
            finish: "ceramic",
          }),
        );
  } else if (name === "Inlaid tile") {
    d.background = "#e4ded1";
    d.layers.push(
      patternLayer("rect", {
        width: 490,
        height: 490,
        color: "#194e60",
        finish: "ceramic",
      }),
    );
    for (let i = 0; i < 5; i++)
      d.layers.push(
        patternLayer("diamond", {
          width: 450 - i * 85,
          height: 450 - i * 85,
          color: i % 2 ? "#194e60" : "#d3ae62",
          finish: i % 2 ? "ceramic" : "foil",
        }),
      );
  } else if (name === "Banded geometry") {
    d.background = "#253940";
    d.repeats = 1;
    d.layers.push(
      patternLayer("rect", {
        width: 512,
        height: 512,
        color: d.background,
        finish: "wool",
        relief: 0.25,
      }),
    );
    const colors = ["#d6b77a", "#df7658", "#e7dfc9", "#87aaa0"];
    for (let band = 0; band < 4; band++) {
      const y = 64 + band * 128;
      d.layers.push(
        patternLayer("rect", {
          x: 256,
          y: y - 54,
          width: 512,
          height: 7,
          color: colors[band],
          finish: "cotton",
          relief: 0.1,
        }),
      );
      d.layers.push(
        patternLayer("rect", {
          x: 256,
          y: y + 54,
          width: 512,
          height: 7,
          color: colors[band],
          finish: "cotton",
          relief: 0.1,
        }),
      );
      for (let x = 0; x < 6; x++) {
        d.layers.push(
          patternLayer(band % 2 ? "path" : "triangle", {
            x: 42.667 + x * 85.333,
            y,
            width: 74,
            height: 78,
            rotation: band % 2 ? 0 : (x % 2) * 180,
            color: colors[band],
            finish: "wool",
            relief: 0.7,
            path:
              band === 1
                ? "M50 0 L100 50 L50 100 L0 50 Z M50 23 L77 50 L50 77 L23 50 Z"
                : "M0 20 L25 0 L50 20 L75 0 L100 20 M0 60 L25 40 L50 60 L75 40 L100 60 M0 100 L25 80 L50 100 L75 80 L100 100",
            strokeWidth: band % 2 ? 4 : 0,
          }),
        );
      }
    }
  } else if (name === "Medallion rug") {
    d.background = "#253b40";
    d.repeats = 1;
    for (let i = 0; i < 5; i++)
      d.layers.push(
        patternLayer("rect", {
          width: 512 - i * 22,
          height: 512 - i * 22,
          color: ["#d8be8c", "#784b43", "#d8be8c", "#784b43", "#253b40"][i],
          finish: "wool",
          relief: i % 2 ? 0.4 : 0.65,
        }),
      );
    const star =
      "M50 0L63 24L86 14L76 38L100 50L76 63L86 86L63 76L50 100L37 76L14 86L24 63L0 50L24 38L14 14L37 24Z";
    for (let i = 0; i < 4; i++)
      d.layers.push(
        patternLayer("path", {
          path: star,
          width: 310 - i * 53,
          height: 310 - i * 53,
          color: ["#d8be8c", "#b7664e", "#253b40", "#87aaa0"][i],
          finish: "wool",
          relief: 0.8 - i * 0.1,
        }),
      );
    for (const x of [106, 406])
      for (const y of [106, 406])
        for (let i = 0; i < 2; i++)
          d.layers.push(
            patternLayer("diamond", {
              x,
              y,
              width: 64 - i * 26,
              height: 64 - i * 26,
              color: i ? "#b7664e" : "#d8be8c",
              finish: "wool",
            }),
          );
  } else if (name === "Graduated lattice") {
    d.background = "#236777";
    d.repeats = 1;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const size = 22 + 38 * Math.pow(Math.sin((Math.PI * (y + 0.5)) / 8), 2);
        d.layers.push(
          patternLayer("path", {
            x: 32 + x * 64,
            y: 32 + y * 64,
            width: size,
            height: size,
            color: "#f0efdf",
            finish: "ceramic",
            relief: 0.1,
            path: "M50 0L94 25L94 75L50 100L6 75L6 25Z M50 0L50 50L94 75 M50 50L6 75",
            strokeWidth: 4,
          }),
        );
      }
  } else {
    d.name = "Custom pattern";
    d.background = "#ece5d6";
  }
  return validatePattern(d);
}
export function patternDimensions(doc) {
  return [
    doc.repeat === "straight" ? 512 : 1024,
    doc.repeat === "mirror" ? 1024 : 512,
  ];
}
export function patternShape(l, fill) {
  const style = `fill="${fill}" stroke="${l.strokeWidth ? fill : "none"}" stroke-width="${l.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  if (l.kind === "svg")
    return l.svg
      .replace(/id="([^"]+)"/g, `id="${l.id}-$1"`)
      .replace(/url\(#([^)]*)\)/g, `url(#${l.id}-$1)`);
  if (l.kind === "image")
    return `<image href="${l.src}" x="0" y="0" width="100" height="100" preserveAspectRatio="none"/>`;
  if (l.kind === "rect") return `<rect width="100" height="100" ${style}/>`;
  if (l.kind === "ellipse")
    return `<ellipse cx="50" cy="50" rx="50" ry="50" ${style}/>`;
  if (l.kind === "diamond")
    return `<path d="M50 0L100 50L50 100L0 50Z" ${style}/>`;
  if (l.kind === "triangle") return `<path d="M50 0L100 100L0 100Z" ${style}/>`;
  if (l.kind === "flower")
    return [0, 72, 144, 216, 288]
      .map(
        (a) =>
          `<ellipse cx="50" cy="27" rx="18" ry="27" transform="rotate(${a} 50 50)" ${style}/>`,
      )
      .join("");
  return `<path d="${l.path}" ${l.strokeWidth ? `fill="none" stroke="${fill}" stroke-width="${l.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"` : style}/>`;
}
export function patternSVG(input, mode = "color") {
  const d = validatePattern(input),
    [w, h] = patternDimensions(d);
  let body = `<rect width="${w}" height="${h}" fill="${mode === "color" ? d.background : mode === "finish" ? "rgb(255,0,0)" : "rgb(158,0,128)"}" opacity="${mode === "color" ? d.backgroundOpacity : 0}"/>`;
  for (const l of d.layers.filter((l) => l.visible)) {
    const f = patternFinishes[l.finish];
    const fill =
      mode === "color"
        ? l.color
        : `rgb(${Math.round(l.roughness * 255)},${Math.round(l.metalness * 255)},${Math.round(128 + l.relief * 100)})`;
    // Each motif is wrapped, including motifs straddling the repeat boundary.
    for (let col = -4; col <= 4; col++)
      for (let row = -4; row <= 4; row++) {
        if (
          (d.tileAxes === "x" && row !== 0) ||
          (d.tileAxes === "y" && col !== 0)
        )
          continue;
        const mirror = d.repeat === "mirror",
          sx = mirror && Math.abs(col % 2) ? -1 : 1,
          sy = mirror && Math.abs(row % 2) ? -1 : 1;
        const x = col * 512 + (sx < 0 ? 512 - l.x : l.x),
          y =
            row * 512 +
            (sy < 0 ? 512 - l.y : l.y) +
            (d.repeat === "half-drop" && Math.abs(col % 2) ? 256 : 0);
        if (
          x + (l.width + l.height) / 2 < 0 ||
          x - (l.width + l.height) / 2 > w ||
          y + (l.width + l.height) / 2 < 0 ||
          y - (l.width + l.height) / 2 > h
        )
          continue;
        const tint =
          mode === "finish"
            ? `rgb(${f.code === 3 ? 255 : 0},${f.code === 2 ? 255 : 0},${f.code === 1 ? 255 : 0})`
            : fill;
        const id = `tint-${l.id}-${col + 2}-${row + 2}`;
        const shape =
          ["image", "svg"].includes(l.kind) && mode !== "color"
            ? `<defs><filter id="${id}" color-interpolation-filters="sRGB"><feFlood flood-color="${tint}"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs><g filter="url(#${id})">${patternShape(l, tint)}</g>`
            : patternShape(l, tint);
        body += `<g opacity="${l.opacity}" transform="translate(${x} ${y}) rotate(${l.rotation * sx * sy}) scale(${(sx * l.width * (l.flipX ? -1 : 1)) / 100} ${(sy * l.height * (l.flipY ? -1 : 1)) / 100}) translate(-50 -50)">${shape}</g>`;
      }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

// Seeded layout generation is separate from sampling: exported SVG remains a
// stable seamless supertile and is editable like any hand-built document.
export function generatePatternLayout({
  seed = 17,
  style = "geometric",
  count = 12,
} = {}) {
  let state = (Number(seed) || 17) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const n = Math.max(2, Math.min(24, Math.round(Number(count) || 12))),
    side = Math.ceil(Math.sqrt(n));
  const doc = patternStarter("Blank");
  doc.name = (style === "floral" ? "Garden" : "Geometric") + " study " + seed;
  doc.background = style === "floral" ? "#fff4df" : "#253441";
  doc.layers = [];
  const palette =
    style === "floral"
      ? ["#ef5a64", "#f39384", "#dc454f", "#e6ad86"]
      : ["#d5b163", "#da735d", "#7fa4a0", "#ece2c7"];
  for (let i = 0; i < n; i++) {
    const x = (((i % side) + 0.5) * 512) / side + (random() - 0.5) * 38,
      y = ((Math.floor(i / side) + 0.5) * 512) / side + (random() - 0.5) * 38,
      w = ((0.55 + random() * 0.6) * 512) / side;
    const color = palette[Math.floor(random() * palette.length)];
    doc.layers.push(
      patternLayer(
        style === "floral"
          ? "flower"
          : ["diamond", "triangle", "rect"][Math.floor(random() * 3)],
        {
          x,
          y,
          width: w,
          height: w * (0.7 + random() * 0.5),
          rotation:
            style === "floral" ? random() * 360 : Math.floor(random() * 4) * 90,
          color,
          finish: style === "floral" ? "cotton" : "wool",
        },
      ),
    );
    if (style === "floral")
      doc.layers.push(
        patternLayer("ellipse", {
          x,
          y,
          width: w * 0.14,
          height: w * 0.14,
          color: "#93754c",
          finish: "cotton",
        }),
      );
  }
  return validatePattern(doc);
}

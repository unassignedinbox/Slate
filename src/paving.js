import { PAVING_PATTERNS } from "./street-settings.js";
// Pattern tile: 1.2 m square, 100 mm modules. Rectangles intentionally extend
// through tile edges; their periodic coordinates keep mortar joints seamless.
export function pavingLayout(pattern) {
  if (!PAVING_PATTERNS.includes(pattern)) throw Error("Unknown paving pattern");
  const bricks = [];
  const put = (x, y, w, h) => bricks.push({ x, y, w, h });
  if (pattern === "Large format") {
    for (let y = 0; y < 12; y += 6)
      for (let x = 0; x < 12; x += 6) put(x, y, 6, 6);
  } else if (pattern === "Basketweave") {
    for (let y = 0; y < 12; y += 2)
      for (let x = 0; x < 12; x += 2) {
        if ((x / 2 + y / 2) % 2) {
          put(x, y, 1, 2);
          put(x + 1, y, 1, 2);
        } else {
          put(x, y, 2, 1);
          put(x, y + 1, 2, 1);
        }
      }
  } else if (pattern === "Herringbone") {
    for (let y = -2; y < 14; y++)
      for (let x = -2; x < 14; x++) {
        const r = (((x - y) % 4) + 4) % 4;
        if (r === 0) put(x, y, 2, 1);
        if (r === 3) put(x, y, 1, 2);
      }
  } else
    for (let y = 0; y < 12; y++)
      for (let x = -(y % 2); x < 12; x += 2) put(x, y, 2, 1);
  return bricks;
}
export function pavingCanvases(pattern) {
  const color = document.createElement("canvas"),
    height = document.createElement("canvas");
  color.width = color.height = height.width = height.height = 768;
  const c = color.getContext("2d"),
    h = height.getContext("2d"),
    unit = 64,
    joint = pattern === "Permeable blocks" ? 7 : 2.4;
  c.fillStyle = pattern === "Permeable blocks" ? "#70766a" : "#83827e";
  c.fillRect(0, 0, 768, 768);
  h.fillStyle = "#333";
  h.fillRect(0, 0, 768, 768);
  for (const b of pavingLayout(pattern)) {
    const seed = (((b.x + 24) % 12) * 47 + ((b.y + 24) % 12) * 83) % 29,
      v = 215 + seed / 2;
    c.fillStyle = `rgb(${v},${v},${v})`;
    const x = b.x * unit + joint / 2,
      y = b.y * unit + joint / 2,
      w = b.w * unit - joint,
      hh = b.h * unit - joint;
    c.fillRect(x, y, w, hh);
    c.strokeStyle = "#ffffff32";
    c.lineWidth = 1;
    c.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    h.fillStyle = "#b8b8b8";
    h.fillRect(x, y, w, hh);
    h.fillStyle = "#ededed";
    h.fillRect(x + 1.5, y + 1.5, w - 3, hh - 3);
  }
  // Deterministic fine aggregate, not remotely fetched textures.
  let seed = 871;
  for (let i = 0; i < 22000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % 768;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = seed % 768;
    c.fillStyle = i % 2 ? "#00000008" : "#ffffff12";
    c.fillRect(x, y, 1, 1);
  }
  return { color, height };
}

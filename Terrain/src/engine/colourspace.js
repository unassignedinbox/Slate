// RGB <-> HSV conversions for the colour utility layers. All channels are in [0, 1].

export function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = mx > 1e-9 ? d / mx : 0;
  return [h, s, mx];
}

export function hsvToRgb(h, s, v) {
  const hh = (((h % 1) + 1) % 1) * 6;
  const c = v * Math.min(1, Math.max(0, s));
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

// '#rrggbb' -> [r, g, b] in [0, 1].
export function hexColour(h) {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

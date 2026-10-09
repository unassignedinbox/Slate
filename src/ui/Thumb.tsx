// Layer thumbnails. Height deltas are drawn as a relief-shaded diverging map
// (cut = cool, fill = warm); satmap rows show their composited colour.

import { useEffect, useRef } from 'react';

const TERRAIN = [
  [0, 24, 30, 38],
  [0.25, 52, 58, 60],
  [0.5, 104, 104, 96],
  [0.75, 168, 160, 140],
  [1, 232, 226, 210],
];

function terrainRamp(t: number): [number, number, number] {
  for (let i = 0; i < TERRAIN.length - 1; i++) {
    const a = TERRAIN[i];
    const b = TERRAIN[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
      ];
    }
  }
  return [232, 226, 210];
}

export interface ThumbProps {
  size: number;
  data: Float32Array | Uint8ClampedArray;
  range?: [number, number];
  mask?: Float32Array | null;
  className?: string;
  /** Draw the mask as a white overlay instead of the field. */
  showMask?: boolean;
}

export default function Thumb({ size, data, range, mask, className, showMask }: ThumbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(size, size);
    const px = image.data;

    if (data instanceof Uint8ClampedArray) {
      for (let i = 0; i < size * size; i++) {
        px[i * 4] = data[i * 4];
        px[i * 4 + 1] = data[i * 4 + 1];
        px[i * 4 + 2] = data[i * 4 + 2];
        px[i * 4 + 3] = 255;
      }
    } else {
      const lo = range ? range[0] : 0;
      const hi = range ? range[1] : 1;
      const span = Math.max(1e-6, hi - lo);
      const diverging = lo < -1e-6 && hi > 1e-6;
      const zero = diverging ? (0 - lo) / span : 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const v = data[i];
          const t = Math.max(0, Math.min(1, (v - lo) / span));
          // Hillshade from the thumbnail's own gradient.
          const xl = data[y * size + Math.max(0, x - 1)];
          const xr = data[y * size + Math.min(size - 1, x + 1)];
          const yu = data[Math.max(0, y - 1) * size + x];
          const yd = data[Math.min(size - 1, y + 1) * size + x];
          const dx = (xr - xl) / span;
          const dy = (yd - yu) / span;
          const shade = 1 + Math.max(-0.55, Math.min(0.55, (dx + dy) * 0.9));
          let r: number;
          let g: number;
          let b: number;
          if (diverging) {
            const d = t - zero;
            if (d >= 0) {
              const k = Math.min(1, d / Math.max(1e-6, 1 - zero));
              r = 70 + 150 * k;
              g = 82 + 110 * k;
              b = 92 - 30 * k;
            } else {
              const k = Math.min(1, -d / Math.max(1e-6, zero));
              r = 70 - 26 * k;
              g = 82 - 6 * k;
              b = 92 + 86 * k;
            }
          } else {
            const c = terrainRamp(t);
            r = c[0];
            g = c[1];
            b = c[2];
          }
          px[i * 4] = Math.max(0, Math.min(255, r * shade));
          px[i * 4 + 1] = Math.max(0, Math.min(255, g * shade));
          px[i * 4 + 2] = Math.max(0, Math.min(255, b * shade));
          px[i * 4 + 3] = 255;
        }
      }
    }

    if (mask && showMask) {
      for (let i = 0; i < size * size; i++) {
        const m = mask[i];
        px[i * 4] = px[i * 4] * (1 - m) + 235 * m;
        px[i * 4 + 1] = px[i * 4 + 1] * (1 - m) + 235 * m;
        px[i * 4 + 2] = px[i * 4 + 2] * (1 - m) + 255 * m;
      }
    }

    ctx.putImageData(image, 0, 0);
  }, [size, data, range, mask, showMask]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={`thumb ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}

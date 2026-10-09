// 2D view: hillshaded heightmap, satmap, or any terrain channel.

import { useEffect, useRef, useState } from 'react';
import type { ChannelId, Project } from '../engine/types';
import type { ComputeResponse } from '../engine/worker';
import { CHANNELS } from '../engine/registry';

const TERRAIN: [number, number, number][] = [
  [18, 34, 44],
  [46, 66, 62],
  [104, 104, 84],
  [148, 132, 100],
  [186, 172, 140],
  [226, 222, 210],
  [255, 255, 255],
];

const MAGMA: [number, number, number][] = [
  [8, 8, 20],
  [46, 20, 74],
  [104, 30, 106],
  [160, 52, 100],
  [214, 92, 76],
  [246, 158, 66],
  [252, 232, 150],
];

function sample(stops: [number, number, number][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export type ViewMode = 'height' | 'satmap' | 'shaded' | 'channel';

export interface HeightmapViewProps {
  project: Project;
  result: ComputeResponse | null;
  mode: ViewMode;
  channel: ChannelId;
  contours: boolean;
  onChannel: (channel: ChannelId) => void;
}

export default function HeightmapView({
  project,
  result,
  mode,
  channel,
  contours,
  onChannel,
}: HeightmapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: host.clientWidth, h: host.clientHeight });
    });
    observer.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result || size.w < 2 || size.h < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const px = Math.max(1, Math.round(size.w * dpr));
    const py = Math.max(1, Math.round(size.h * dpr));
    const image = ctx.createImageData(px, py);
    const out = image.data;

    const N = result.size;
    const height = result.height;
    const rgba = result.rgba;
    const sea = project.seaLevel;
    const sunX = Math.cos((project.render.sunAzimuth * Math.PI) / 180);
    const sunY = Math.sin((project.render.sunAzimuth * Math.PI) / 180);
    const sunZ = Math.tan((Math.max(4, project.render.sunElevation) * Math.PI) / 180);

    let field: Float32Array | null = null;
    let fsize = N;
    let lo = 0;
    let hi = 1;
    if (mode === 'channel' && result.preview && result.preview.channel === channel) {
      field = result.preview.data;
      fsize = result.preview.size;
    } else if (mode === 'channel' && channel === 'height') {
      field = height;
      fsize = N;
    }
    if (field) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < field.length; i += 7) {
        const v = field[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      lo = min;
      hi = max > min + 1e-9 ? max : min + 1;
    }

    const stepX = N / px;
    const stepY = N / py;
    for (let y = 0; y < py; y++) {
      const sy = Math.min(N - 1, Math.floor(y * stepY));
      for (let x = 0; x < px; x++) {
        const sx = Math.min(N - 1, Math.floor(x * stepX));
        const i = sy * N + sx;
        const h = height[i];
        const k = (y * px + x) * 4;

        // Hillshade from the height field.
        const hx1 = height[sy * N + Math.max(0, sx - 1)];
        const hx2 = height[sy * N + Math.min(N - 1, sx + 1)];
        const hy1 = height[Math.max(0, sy - 1) * N + sx];
        const hy2 = height[Math.min(N - 1, sy + 1) * N + sx];
        const gx = (hx2 - hx1) * 0.5 * ((project.heightScale / project.extent) * N);
        const gy = (hy2 - hy1) * 0.5 * ((project.heightScale / project.extent) * N);
        const len = Math.sqrt(gx * gx + gy * gy + 1);
        const lambert = Math.max(0, (-gx * sunX - gy * sunY + sunZ) / len / Math.sqrt(sunX * sunX + sunY * sunY + sunZ * sunZ));
        const shade = 0.35 + 1.5 * lambert * (0.4 + project.render.shading * 0.6);

        let r: number;
        let g: number;
        let b: number;
        if (mode === 'satmap') {
          r = rgba[i * 4];
          g = rgba[i * 4 + 1];
          b = rgba[i * 4 + 2];
        } else if (mode === 'channel' && field) {
          const fx = Math.min(fsize - 1, Math.floor((x / px) * fsize));
          const fy = Math.min(fsize - 1, Math.floor((y / py) * fsize));
          const t = (field[fy * fsize + fx] - lo) / (hi - lo);
          const c = sample(MAGMA, t);
          r = c[0];
          g = c[1];
          b = c[2];
        } else if (mode === 'shaded') {
          r = g = b = 200;
        } else {
          const c = sample(TERRAIN, Math.max(0, Math.min(1, h)));
          r = c[0];
          g = c[1];
          b = c[2];
        }

        if (mode !== 'channel') {
          r *= shade;
          g *= shade;
          b *= shade;
        } else {
          const s = 0.55 + shade * 0.55;
          r *= s;
          g *= s;
          b *= s;
        }

        if (h < sea && mode !== 'channel') {
          const depth = Math.min(1, (sea - h) / Math.max(0.02, sea * 0.9 + 0.05));
          r = r * (1 - depth) + 22 * depth;
          g = g * (1 - depth) + 52 * depth;
          b = b * (1 - depth) + 78 * depth;
        }

        // Contour lines every 2.5% of the height range.
        if (contours && mode !== 'channel' && mode !== 'satmap') {
          const band = (h / 0.025) % 1;
          const edge = Math.min(band, 1 - band);
          if (edge * 0.025 * project.heightScale < 1.6) {
            const k2 = 0.5;
            r = r * (1 - k2) + 10 * k2;
            g = g * (1 - k2) + 10 * k2;
            b = b * (1 - k2) + 10 * k2;
          }
        }

        out[k] = Math.max(0, Math.min(255, r));
        out[k + 1] = Math.max(0, Math.min(255, g));
        out[k + 2] = Math.max(0, Math.min(255, b));
        out[k + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [result, size, mode, channel, project.seaLevel, project.heightScale, project.extent, project.render, contours]);

  const meta =
    mode === 'channel' ? CHANNELS.find((c) => c.id === channel)?.blurb ?? '' : mode === 'satmap' ? 'Satmap composite' : 'Hillshaded height';

  return (
    <div className="stage-canvas" ref={hostRef}>
      <canvas ref={canvasRef} />
      {!result ? <p className="stage-status">building terrain…</p> : null}
      <div className="stage-hint">{meta}</div>
      {mode === 'channel' ? (
        <div className="channel-picker">
          <select
            className="select"
            value={channel}
            onChange={(e) => onChannel(e.target.value as ChannelId)}
            aria-label="Channel"
          >
            {[...new Set(CHANNELS.map((c) => c.group))].map((group) => (
              <optgroup key={group} label={group}>
                {CHANNELS.filter((c) => c.group === group).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

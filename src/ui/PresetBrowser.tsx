// Preset browser. Each tile renders a live 64² preview of the preset, computed
// one per frame so the modal never blocks.

import { useEffect, useRef } from 'react';
import { Mountain, Snowflake, Waves, Flame, Layers, Sun } from 'lucide-react';
import { PRESETS, buildPreset } from '../engine/presets';
import { computeProject } from '../engine/pipeline';
import { CloseButton } from './controls';
import type { PresetDef } from '../engine/presets';

const ICONS: Record<string, React.ReactNode> = {
  'Sandstone country': <Layers size={16} />,
  Coasts: <Waves size={16} />,
  'High mountains': <Mountain size={16} />,
  Volcanic: <Flame size={16} />,
  Lowland: <Sun size={16} />,
  Deserts: <Snowflake size={16} />,
};

function drawShade(canvas: HTMLCanvasElement, height: Float32Array, size: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(size, size);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of height) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1e-6, hi - lo);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = (height[i] - lo) / span;
      const dx = (height[Math.min(size - 1, y * size + x + 1)] - height[y * size + Math.max(0, x - 1)]) / span;
      const dy =
        (height[Math.min(size - 1, y + 1) * size + x] - height[Math.max(0, y - 1) * size + x]) / span;
      const shade = 0.55 + Math.max(-0.8, Math.min(0.8, (dx - dy) * 1.1));
      const base = 46 + t * 186;
      const k = i * 4;
      image.data[k] = base * shade * (0.92 + t * 0.16);
      image.data[k + 1] = base * shade;
      image.data[k + 2] = base * shade * (0.82 + t * 0.1);
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export default function PresetBrowser({
  onPick,
  onClose,
}: {
  onPick: (preset: PresetDef) => void;
  onClose: () => void;
}) {
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    let index = 0;
    const tick = () => {
      if (cancelled || index >= PRESETS.length) return;
      const preset = PRESETS[index++];
      const canvas = refs.current[preset.id];
      if (canvas) {
        try {
          const result = computeProject({ ...buildPreset(preset.id), resolution: 64 }, { thumbSize: 0 });
          drawShade(canvas, result.height, 64);
        } catch {
          /* a bad preset definition must not break the browser */
        }
      }
      requestAnimationFrame(tick);
    };
    const handle = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, []);

  const groups = ["Sandstone country", "Coasts", "High mountains", "Volcanic", "Lowland", "Deserts"];

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-label="Presets">
        <div className="panel-head">
          <span className="emblem">Presets</span>
          <CloseButton onClick={onClose} label="Close" />
        </div>
        <div className="panel-body">
          {groups.map((group) => {
            const items = PRESETS.filter((p) => p.group === group);
            if (!items.length) return null;
            return (
              <section key={group} style={{ marginBottom: 26 }}>
                <div
                  className="eyebrow"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}
                >
                  {ICONS[group]}
                  {group}
                </div>
                <div className="tile-grid">
                  {items.map((preset) => (
                    <button key={preset.id} className="tile" onClick={() => onPick(preset)}>
                      <canvas
                        ref={(el) => {
                          refs.current[preset.id] = el;
                        }}
                        width={64}
                        height={64}
                        className="tile-emblem"
                      />
                      <strong>{preset.name}</strong>
                      <span className="tile-tags">{preset.tags.join(' · ')}</span>
                      <span className="muted">{preset.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

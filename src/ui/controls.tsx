// Generic inspector controls. Everything is driven by the parameter schemas in
// engine/params.ts, so a new generator or erosion type needs no UI work.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import type { ParamDef, Params } from '../engine/params';
import { num as numParam, str as strParam } from '../engine/params';
import { MASKS } from '../engine/registry';
import { normalizeParams } from '../engine/params';
import type { ColorStop, MaskConfig } from '../engine/types';
import Thumb from './Thumb';

export function digitsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  if (step >= 0.001) return 3;
  return 4;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  accent,
  onChange,
  labels,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  accent?: string;
  onChange: (value: number) => void;
  labels?: [string, string];
}) {
  const digits = digitsFor(step);
  const progress = ((value - min) / Math.max(1e-6, max - min)) * 100;
  return (
    <div className="field">
      <div className="field-head">
        <span>{label}</span>
        <span className="value">
          {value.toFixed(digits)}
          {unit ? <small>{unit}</small> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--progress': `${progress}%`, '--accent': accent ?? '#b9b9b9' } as React.CSSProperties}
      />
      {labels ? (
        <div className="range-labels">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: string; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      {label ? (
        <div className="field-head">
          <span>{label}</span>
        </div>
      ) : null}
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button
        className={`toggle ${value ? 'on' : ''}`}
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    </div>
  );
}

/** Renders a whole parameter schema. */
export function ParamList({
  defs,
  values,
  onChange,
  accent,
}: {
  defs: ParamDef[];
  values: Params;
  onChange: (key: string, value: number | string | boolean) => void;
  accent?: string;
}) {
  return (
    <>
      {defs.map((def) => {
        if (def.kind === 'slider') {
          return (
            <Slider
              key={def.key}
              label={def.label}
              value={numParam(values, def.key, def.def)}
              min={def.min}
              max={def.max}
              step={def.step}
              unit={def.unit}
              accent={accent}
              onChange={(v) => onChange(def.key, v)}
            />
          );
        }
        if (def.kind === 'dropdown') {
          return (
            <Dropdown
              key={def.key}
              label={def.label}
              value={strParam(values, def.key, def.def)}
              options={def.options}
              onChange={(v) => onChange(def.key, v)}
            />
          );
        }
        return (
          <ToggleRow
            key={def.key}
            label={def.label}
            value={Boolean(values[def.key] ?? def.def)}
            onChange={(v) => onChange(def.key, v)}
          />
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------- card */

export function Card({
  title,
  icon,
  note,
  accent,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  note?: string;
  accent?: string;
  enabled?: boolean;
  onToggle?: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`card ${enabled === false ? 'card-off' : ''}`}
      style={{ '--card-icon': accent ?? '#b9b9b9' } as React.CSSProperties}
    >
      <div className="card-heading">
        <span>
          {icon}
          {title}
        </span>
        {onToggle ? (
          <button
            className={`toggle ${enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={enabled}
            aria-label={`${title} enabled`}
            onClick={() => onToggle(!enabled)}
          >
            <span />
          </button>
        ) : null}
      </div>
      {note ? <p className="card-note">{note}</p> : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------- mask */

export function MaskCard({
  mask,
  onChange,
  accent,
  preview,
}: {
  mask: MaskConfig;
  onChange: (mask: MaskConfig) => void;
  accent?: string;
  preview?: Float32Array | null;
}) {
  const def = MASKS.find((m) => m.id === mask.type) ?? MASKS[0];
  const set = (patch: Partial<MaskConfig>) => onChange({ ...mask, ...patch });
  const setParam = (key: string, value: number | string | boolean) =>
    set({ params: { ...mask.params, [key]: value } });

  return (
    <Card
      title="Mask"
      accent={accent ?? '#8fb3ad'}
      note={def.blurb}
      enabled={mask.type !== 'none' || mask.invert}
      onToggle={(on) => set({ type: on ? (mask.type === 'none' ? 'height' : mask.type) : 'none' })}
    >
      <Dropdown
        label="Mask by"
        value={mask.type}
        options={MASKS.map((m) => ({ value: m.id, label: m.label }))}
        onChange={(type) =>
          onChange({
            ...mask,
            type,
            params: normalizeParams((MASKS.find((m) => m.id === type) ?? MASKS[0]).params, undefined),
          })
        }
      />
      {def.params.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <ParamList defs={def.params} values={mask.params} onChange={setParam} accent={accent ?? '#8fb3ad'} />
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Slider
          label="Coverage"
          value={mask.strength}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => set({ strength: v })}
          labels={['Off', 'Full']}
          accent={accent ?? '#8fb3ad'}
        />
        <Slider
          label="Edge falloff"
          value={mask.falloff}
          min={0.02}
          max={1}
          step={0.01}
          onChange={(v) => set({ falloff: v })}
          labels={['Hard', 'Soft']}
          accent={accent ?? '#8fb3ad'}
        />
        <ToggleRow label="Invert mask" value={mask.invert} onChange={(v) => set({ invert: v })} />
      </div>
      {preview && mask.type !== 'none' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <Thumb size={128} data={preview} range={[0, 1]} showMask className="mask-thumb" />
          <p className="muted" style={{ margin: 0 }}>
            White is where this layer is allowed to act.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------- ramp */

function rampColor(stops: ColorStop[], t: number): string {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (!sorted.length) return '#808080';
  if (t <= sorted[0].at) return sorted[0].color;
  if (t >= sorted[sorted.length - 1].at) return sorted[sorted.length - 1].color;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].at && t <= sorted[i + 1].at) {
      const f = (t - sorted[i].at) / Math.max(1e-6, sorted[i + 1].at - sorted[i].at);
      return mixHex(sorted[i].color, sorted[i + 1].color, f);
    }
  }
  return sorted[sorted.length - 1].color;
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const r = Math.round((((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t));
  const g = Math.round((((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t));
  const bl = Math.round(((pa & 255) * (1 - t) + (pb & 255) * t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function RampEditor({
  ramp,
  onChange,
}: {
  ramp: ColorStop[];
  onChange: (ramp: ColorStop[]) => void;
}) {
  const [selected, setSelected] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<number | null>(null);
  const sorted = [...ramp].sort((a, b) => a.at - b.at);

  const commit = useCallback(
    (next: ColorStop[]) => onChange([...next].sort((a, b) => a.at - b.at)),
    [onChange],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current === null || !barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const next = sorted.map((s, i) => (i === dragging.current ? { ...s, at: Math.round(t * 100) / 100 } : s));
      commit(next);
    };
    const up = () => {
      dragging.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [sorted, commit]);

  const gradient = `linear-gradient(90deg, ${sorted
    .map((s) => `${s.color} ${(s.at * 100).toFixed(1)}%`)
    .join(', ')})`;

  const addStop = () => {
    const at = 0.5;
    commit([...sorted, { at, color: rampColor(sorted, at) }]);
    setSelected(sorted.length);
  };

  const removeStop = () => {
    if (sorted.length <= 2) return;
    commit(sorted.filter((_, i) => i !== selected));
    setSelected(Math.max(0, selected - 1));
  };

  const active = sorted[Math.min(selected, sorted.length - 1)];

  return (
    <div className="ramp">
      <div
        ref={barRef}
        className="ramp-bar"
        style={{ background: gradient }}
        title="Click to add a colour stop"
        onPointerDown={(e) => {
          const rect = (e.target as HTMLDivElement).getBoundingClientRect();
          const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          commit([...sorted, { at: Math.round(t * 100) / 100, color: rampColor(sorted, t) }]);
          setSelected(sorted.length);
        }}
      />
      <div className="ramp-stops">
        {sorted.map((stop, i) => (
          <button
            key={i}
            className={`ramp-stop ${i === selected ? 'selected' : ''}`}
            style={{ left: `${stop.at * 100}%`, background: stop.color }}
            aria-label={`Colour stop ${i + 1} at ${Math.round(stop.at * 100)}%`}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragging.current = i;
              setSelected(i);
            }}
          />
        ))}
      </div>
      <div className="ramp-actions">
        <input
          type="color"
          value={active?.color ?? '#808080'}
          aria-label="Stop colour"
          onChange={(e) => commit(sorted.map((s, i) => (i === selected ? { ...s, color: e.target.value } : s)))}
        />
        <button className="tool-button" onClick={addStop}>
          <Plus size={12} /> Stop
        </button>
        <button className="tool-button" onClick={removeStop} disabled={sorted.length <= 2}>
          <Minus size={12} /> Stop
        </button>
        <span className="spacer" />
        <span className="small-pill">{Math.round((active?.at ?? 0) * 100)}%</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- little bits */

export function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="card-note">{children}</p>;
}

export function IconSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#7c7c7c' }}
      />
    </div>
  );
}

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="panel-close" onClick={onClick} aria-label={label}>
      <X size={18} />
    </button>
  );
}

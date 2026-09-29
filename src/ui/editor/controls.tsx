import React, { useRef, useState } from 'react';

function fmt(v: number, step = 0.01, unit?: string) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return `${v.toFixed(dec)}${unit ? ` ${unit}` : ''}`;
}

export function NumberSlider({
  value, min, max, step = 0.01, curve = 1, onChange, onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  curve?: number;
  onChange(v: number): void;
  onCommit?(v: number): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ startX: number; startV: number; moved: boolean } | null>(null);

  const toPos = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - min) / (max - min || 1)));
    return curve === 1 ? t : Math.pow(t, 1 / curve);
  };
  const fromPos = (p: number) => {
    const t = curve === 1 ? p : Math.pow(Math.min(1, Math.max(0, p)), curve);
    const raw = min + t * (max - min);
    return Math.round(raw / step) * step;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startV: value, moved: false };
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    const w = ref.current.clientWidth || 1;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 2) d.moved = true;
    const fine = e.shiftKey ? 0.2 : 1;
    const p = toPos(d.startV) + (dx / w) * fine;
    const v = Math.min(max, Math.max(min, fromPos(p)));
    onChange(Number(v.toFixed(6)));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && ref.current) {
      // click without drag -> jump to position
      const r = ref.current.getBoundingClientRect();
      const p = (e.clientX - r.left) / r.width;
      const v = Math.min(max, Math.max(min, fromPos(p)));
      onChange(Number(v.toFixed(6)));
    }
    onCommit?.(value);
  };

  const pct = toPos(value) * 100;

  return (
    <div
      className="slider"
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => { setText(String(Number(value.toFixed(4)))); setEditing(true); }}
    >
      <div className="slider-fill" style={{ width: `${pct}%` }} />
      <div className="slider-knob" style={{ left: `calc(${pct}% - 1px)` }} />
      {editing ? (
        <input
          className="slider-num"
          style={{ color: 'var(--txt)' }}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = parseFloat(text);
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
            setEditing(false);
            onCommit?.(value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : null}
    </div>
  );
}

export function Field({
  label, value, info, children,
}: {
  label: string;
  value?: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {value !== undefined && <span className="field-value">{value}</span>}
      </div>
      {children}
      {info && <div className="field-info">{info}</div>}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return <button className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Select({
  value, options, onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange(v: string): void;
}) {
  return (
    <select className="select-box" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export { fmt };

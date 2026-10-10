// Inspector controls, ported from the Frontier editor's Inspectors.jsx patterns
// (Control / Card / Metric / Readout markup and classes). Written for this model.
import { useRef, useEffect } from 'react';

export function Field({ label, value, min, max, step = 0.01, unit = '', decimals = 2, onChange, disabled, log = false }) {
  const toSlider = (v) => (log ? Math.log10(v) : v);
  const fromSlider = (v) => (log ? Math.pow(10, v) : v);
  const lo = log ? Math.log10(min) : min, hi = log ? Math.log10(max) : max;
  const safe = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const sliderVal = toSlider(safe);
  const write = (raw) => {
    const n = +raw;
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  };
  return (
    <label className="field" data-native-property={label}>
      <span>{label}</span>
      <div className="slider-pill">
        <div className="split-value">
          <input
            aria-label={`${label} value`} type="number" min={min} max={max} step={step}
            disabled={disabled} value={Number(safe.toPrecision(decimals + 1))}
            onChange={(e) => write(e.target.value)}
          />
          <small>{unit}</small>
        </div>
        <input
          aria-label={label} type="range" min={lo} max={hi} step={log ? 0.01 : step}
          disabled={disabled} value={sliderVal}
          style={{ '--fill': `${(100 * (sliderVal - lo)) / (hi - lo)}%` }}
          onChange={(e) => write(fromSlider(+e.target.value))}
        />
      </div>
    </label>
  );
}

export function Select({ label, value, options, onChange, disabled }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option value={o.value} key={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Switch({ label, value, onChange, disabled }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button
        className={'toggle ' + (value ? 'on' : '')} role="switch" aria-checked={!!value}
        aria-label={label} disabled={disabled} onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </label>
  );
}

export function Readout({ label, value, unit }) {
  return (
    <div className="readout">
      <span>{label}</span>
      <output>{value}{unit ? <small> {unit}</small> : null}</output>
    </div>
  );
}

export function Card({ id, title, children, focus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focus === id && ref.current) ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus, id]);
  return (
    <section ref={ref} className={'generic-card ' + (focus === id ? 'focused' : '')} data-card={id}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

// Compact SVG line chart. Series: [{ name, values, color, dash }]. Optional log scale.
export function Graph({ title, t, series, log = false, unit = '', height = 96 }) {
  const W = 360, H = height, pad = 6;
  const tr = (v) => (log ? Math.log10(Math.max(v, 1e-30)) : v);
  const all = series.flatMap((s) => s.values.map(tr)).filter((v) => Number.isFinite(v));
  let lo = Math.min(...all, 0), hi = Math.max(...all, 1e-9);
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi) || hi === lo) hi = lo + 1;
  const n = t.length;
  const tMax = n ? t[n - 1] : 1, tMin = n ? t[0] : 0;
  const X = (ti) => pad + ((ti - tMin) / Math.max(1e-9, tMax - tMin)) * (W - 2 * pad);
  const Y = (v) => H - pad - ((tr(v) - lo) / (hi - lo)) * (H - 2 * pad);
  const last = (s) => (s.values.length ? s.values[s.values.length - 1] : NaN);
  return (
    <div className="graph-card">
      <div className="graph-head">
        <b>{title}</b>
        <small>{series.map((s) => (
          <span key={s.name} style={{ color: s.color }}>{s.name} {fmt(last(s))}{unit ? ' ' + unit : ''} </span>
        ))}</small>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title}>
        <rect x="0" y="0" width={W} height={H} fill="#161616" />
        {series.map((s) => (
          <polyline
            key={s.name} fill="none" stroke={s.color} strokeWidth="1.4"
            strokeDasharray={s.dash || undefined}
            points={s.values.map((v, i) => `${X(t[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="graph-axis"><span>{log ? '10^' + lo.toFixed(0) : lo.toPrecision(3)}</span><span>t = {tMax.toFixed(0)} s</span><span>{log ? '10^' + hi.toFixed(0) : hi.toPrecision(3)}</span></div>
    </div>
  );
}

export function fmt(v) {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return v.toFixed(a < 10 ? 3 : 1);
}

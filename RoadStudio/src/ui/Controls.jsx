// Small form primitives shared by the inspector and layerstack.
export function Card({ title, actions, children, dense }) {
  return (
    <section className={`card${dense ? ' dense' : ''}`}>
      <header className="card-heading">
        <span>{title}</span>
        {actions ? <span className="card-actions">{actions}</span> : null}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      className={`toggle${checked ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
      <span className="toggle-label">{label}</span>
    </button>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function NumberInput({ value, onChange, step = 0.1, min, max, width }) {
  return (
    <input
      className="num"
      type="number"
      style={width ? { width } : undefined}
      value={Number.isFinite(value) ? round(value, step) : ''}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(clampTo(v, min, max));
      }}
    />
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format }) {
  const shown = format ? format(value) : round(value, step);
  return (
    <div className="slider">
      <div className="slider-head">
        <span className="field-label">{label}</span>
        <span className="slider-value">{shown}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export function Select({ value, options, onChange }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

export function Button({ children, onClick, variant, disabled, title }) {
  return (
    <button type="button" className={`btn${variant ? ' ' + variant : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function round(v, step) {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return Number(v.toFixed(d));
}

function clampTo(v, min, max) {
  if (min != null && v < min) return min;
  if (max != null && v > max) return max;
  return v;
}

export const hexOf = (rgb) => '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
export const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

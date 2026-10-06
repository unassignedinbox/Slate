import React, { useId } from "react";

export default function HeightFogVisual({ V }) {
  const Id = useId().replaceAll(":", ""),
    Enabled = !!V("Enabled"),
    Density = Math.max(0, Number(V("Density")) || 0),
    Falloff = Math.max(10, Number(V("Falloff Height")) || 400),
    Scatter = Math.max(0, Number(V("Sun Scatter")) || 0),
    Colour = V("Colour") || "#ffffff",
    At = (Altitude) => Density * Math.exp(-Altitude / Falloff),
    Strength = Math.min(1, Density / 0.2),
    Preview = Enabled ? 1 : 0.68,
    FalloffY = 169 - Math.min(1, Falloff / 3000) * 124;

  return (
    <div className="height-density-visual" data-enabled={Enabled}>
      <div className="height-density-status">
        <span>
          <i /> {Enabled ? "Live medium" : "Authored preview"}
        </span>
        <strong>{Falloff.toLocaleString("en-US")} m falloff</strong>
      </div>
      <svg
        viewBox="0 0 300 220"
        role="img"
        aria-label="Height fog density volume"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={Id + "air"} x2="0" y2="1">
            <stop stopColor="#11151a" />
            <stop offset=".64" stopColor="#0b0d10" />
            <stop offset="1" stopColor="#060708" />
          </linearGradient>
          <linearGradient id={Id + "volume"} x2="0" y2="1">
            <stop stopColor={Colour} stopOpacity={0.025 * Preview} />
            <stop offset=".48" stopColor={Colour} stopOpacity={(0.09 + Strength * 0.1) * Preview} />
            <stop offset="1" stopColor={Colour} stopOpacity={(0.22 + Strength * 0.35) * Preview} />
          </linearGradient>
          <linearGradient id={Id + "beam"} x1="0" x2="1">
            <stop stopColor="#fff6d6" stopOpacity={0.9 * Preview} />
            <stop offset=".38" stopColor={Colour} stopOpacity={(0.26 + Scatter * 0.12) * Preview} />
            <stop offset="1" stopColor={Colour} stopOpacity="0" />
          </linearGradient>
          <filter id={Id + "soft"} x="-25%" y="-35%" width="150%" height="170%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <clipPath id={Id + "clip"}>
            <path d="M58 31H229L249 47V178H78L58 162Z" />
          </clipPath>
        </defs>

        <rect width="300" height="220" rx="12" fill={`url(#${Id}air)`} />
        <path d="M25 184L224 184L283 207H66Z" fill="#ffffff05" stroke="#ffffff12" />
        <path d="M58 31H229L249 47V178H78L58 162Z" fill={`url(#${Id}volume)`} />

        <g clipPath={`url(#${Id}clip)`} filter={`url(#${Id}soft)`}>
          <ellipse cx="148" cy="165" rx="122" ry="28" fill={Colour} opacity={(0.16 + Strength * 0.42) * Preview} />
          <ellipse cx="175" cy="142" rx="100" ry="23" fill={Colour} opacity={(0.11 + Strength * 0.3) * Preview} />
          <ellipse cx="128" cy="116" rx="78" ry="18" fill={Colour} opacity={(0.07 + Strength * 0.2) * Preview} />
          <ellipse cx="187" cy="88" rx="58" ry="15" fill={Colour} opacity={(0.035 + Strength * 0.11) * Preview} />
          <ellipse cx="132" cy="58" rx="42" ry="12" fill={Colour} opacity={(0.018 + Strength * 0.055) * Preview} />
        </g>

        <g fill={Colour} opacity={0.2 * Preview}>
          {Array.from({ length: 24 }, (_, Index) => (
            <circle
              key={Index}
              cx={76 + ((Index * 43) % 158)}
              cy={48 + ((Index * 29) % 116)}
              r={0.8 + (Index % 3) * 0.45}
              opacity={0.25 + ((Index * 7) % 10) / 14}
            />
          ))}
        </g>

        <path d="M58 31H229L249 47V178H78L58 162ZM229 31V162L249 178M58 162H229L249 178" fill="none" stroke="#cbd2d526" />
        <path d={`M61 ${FalloffY}L232 ${FalloffY}L247 ${FalloffY + 10}L76 ${FalloffY + 10}Z`} fill={Colour} opacity=".08" stroke="#ffffff70" strokeDasharray="4 4" />
        <path d="M18 151H252" stroke={`url(#${Id}beam)`} strokeWidth={3 + Scatter * 1.8} />
        <circle cx="18" cy="151" r="4" fill="#fff4d2" opacity={Preview} />

        <path d="M267 171V46M261 54L267 43L273 54" fill="none" stroke="#ffffff58" />
        <text x="274" y="108" transform="rotate(-90 274 108)" textAnchor="middle">ALTITUDE</text>
        <text x="69" y="203">DATUM · {Density.toFixed(4)} m⁻¹</text>
        <text x="238" y={Math.max(19, FalloffY - 6)} textAnchor="end">37% DENSITY · {Falloff.toFixed(0)} m</text>
      </svg>
      <div className="height-density-readings">
        <span>
          <small>At falloff height</small>
          <b>{At(Falloff).toFixed(4)} m⁻¹</b>
        </span>
        <span>
          <small>At 2× falloff</small>
          <b>{At(Falloff * 2).toFixed(4)} m⁻¹</b>
        </span>
      </div>
      <p>
        Layered volume preview · the same Medium density, falloff, scatter, colour
        and enabled values drive this chamber.
      </p>
    </div>
  );
}

import React, { useId } from "react";

export default function HeightFogVisual({ V }) {
  const Id = useId().replaceAll(":", ""),
    Enabled = !!V("Enabled"),
    Density = Math.max(0, Number(V("Density")) || 0),
    Falloff = Math.max(10, Number(V("Falloff Height")) || 400),
    Scatter = Math.max(0, Number(V("Sun Scatter")) || 0),
    Colour = V("Colour") || "#ffffff",
    At = (Altitude) => Density * Math.exp(-Altitude / Falloff),
    DatumOpacity = Math.min(0.82, 0.1 + Density * 3.5),
    FalloffY = 178 - Math.min(1, Falloff / 3000) * 146;

  return (
    <div className="height-density-visual" data-enabled={Enabled}>
      <div className="height-density-status">
        <span>
          <i /> {Enabled ? "Live medium" : "Authored preview"}
        </span>
        <strong>{Falloff.toLocaleString("en-US")} m falloff</strong>
      </div>
      <svg
        viewBox="0 0 300 210"
        role="img"
        aria-label="Height fog density volume"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={Id + "air"} x2="0" y2="1">
            <stop stopColor="#111417" />
            <stop offset="1" stopColor="#070809" />
          </linearGradient>
          <linearGradient id={Id + "beam"} x1="0" x2="1">
            <stop stopColor="#fff8df" stopOpacity={0.68 * Enabled} />
            <stop offset=".42" stopColor={Colour} stopOpacity={0.22 * Scatter * Enabled} />
            <stop offset="1" stopColor={Colour} stopOpacity="0" />
          </linearGradient>
          <filter id={Id + "soft"} x="-20%" y="-30%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <rect width="300" height="210" rx="12" fill={`url(#${Id}air)`} />
        {Array.from({ length: 18 }, (_, Index) => {
          const Fraction = Index / 17,
            Altitude = (1 - Fraction) * 3000,
            Relative = Density > 0 ? At(Altitude) / Density : 0;
          return (
            <rect
              key={Index}
              x="0"
              y={Index * 10.5}
              width="300"
              height="11.5"
              fill={Colour}
              opacity={(0.015 + Relative * DatumOpacity) * (Enabled ? 1 : 0.55)}
            />
          );
        })}
        <g opacity=".16" stroke="#ffffff">
          <path d="M24 22V180M150 22V180M276 22V180" strokeDasharray="2 5" />
          <path d="M24 180H276" />
        </g>
        <path
          d="M25 146C84 116 128 160 186 129S250 103 292 121"
          fill="none"
          stroke={Colour}
          strokeWidth={8 + Scatter * 5}
          opacity={(0.12 + Density * 1.8) * (Enabled ? 1 : 0.45)}
          filter={`url(#${Id}soft)`}
        />
        <path d="M20 150H284" stroke={`url(#${Id}beam)`} strokeWidth="4" />
        <circle cx="20" cy="150" r="4" fill="#fff6d8" opacity={Enabled ? 0.95 : 0.35} />
        <path
          d={`M38 ${FalloffY}H274`}
          stroke="#ffffff70"
          strokeDasharray="4 4"
        />
        <circle cx="274" cy={FalloffY} r="3" fill="#e5e4dd" />
        <text x="28" y="202">DATUM · {Density.toFixed(4)} m⁻¹</text>
        <text x="272" y={Math.max(15, FalloffY - 7)} textAnchor="end">
          37% DENSITY · {Falloff.toFixed(0)} m
        </text>
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
        Layered medium preview · density, falloff, scatter, colour and enabled state
        share the Medium card values.
      </p>
    </div>
  );
}

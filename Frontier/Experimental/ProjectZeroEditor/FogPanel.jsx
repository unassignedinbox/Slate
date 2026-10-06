import React, { useId } from "react";
import { FogGraph, FogDensity } from "./LiveGraph.jsx";
import { ResolveFogShape } from "./FogShape.js";
import "./FogPanel.css";

// Shared HTML authoring instruments. These are not native scene raymarches.
export default function FogPanel({ Kind, V, Values, Change, QuickControls }) {
  const Height = Kind === "height-fog",
    Aerial = Kind === "aerial-fog",
    Local = Kind === "local-fog",
    Enabled = !!V("Enabled"),
    Id = useId().replaceAll(":", "");
  const Density = Math.max(0, Number(V("Density")) || 0),
    Extinction = FogDensity(Kind, V, V("Probe altitude") ?? 2),
    Start = Aerial ? Math.max(0, Number(V("Start")) || 0) : 0,
    Transmission = (Distance) =>
      Math.exp(-Extinction * Math.max(0, Distance - Start)),
    Sight = Extinction > 0 ? Start - Math.log(0.02) / Extinction : Infinity,
    Shape = ResolveFogShape(Values),
    Percent = (Value) => (Value * 100).toFixed(0) + "%",
    MaximumDistance = Aerial ? 4000 : 400,
    Markers = Aerial
      ? [0, 500, 1000, 2000, 3000, 4000]
      : [0, 50, 100, 200, 300, 400];
  const Model = Height
      ? "Height falloff"
      : Aerial
        ? "Start-distance haze"
        : Shape.Type + " volume",
    Scatter = Height
      ? Number(V("Sun Scatter")) || 0
      : Aerial
        ? Number(V("Mie Blend")) || 0
        : Number(V("Anisotropy")) || 0;
  const Tiles = Height
    ? [
        [Density.toFixed(4), "Density"],
        [V("Falloff Height") + " m", "Falloff height"],
        [
          Number.isFinite(Sight) ? Math.round(Sight) + " m" : "Clear",
          "2% contrast",
        ],
        [Number(V("Sun Scatter")).toFixed(2), "Sun scatter"],
      ]
    : Aerial
      ? [
          [Density.toFixed(2) + "×", "Density"],
          [Start + " m", "Start distance"],
          [Percent(V("Mie Blend")), "Mie blend"],
          [
            Number.isFinite(Sight)
              ? (Sight / 1000).toFixed(2) + " km"
              : "Clear",
            "2% contrast",
          ],
        ]
      : [
          [Density.toFixed(2), "Density"],
          [Percent(V("Coverage")), "Coverage"],
          [V("Feature Scale") + " m", "Feature scale"],
          [Number(V("Anisotropy")).toFixed(2), "Anisotropy"],
        ];
  return (
    <div className="fog-instruments" data-fog-kind={Kind}>
      <section className="fog-instrument fog-sight fog-height-style">
        <svg
          viewBox="0 0 300 166"
          preserveAspectRatio="none"
          role="img"
          data-fog-visual="shared-abstract-fog-field"
          aria-label={Model + " fog field"}
        >
          <defs>
            <linearGradient id={Id + "air"} x2="0" y2="1">
              <stop stopColor="#090b0e" />
              <stop offset=".42" stopColor="#181d22" />
              <stop offset="1" stopColor="#08090a" />
            </linearGradient>
            <linearGradient id={Id + "beam"} x1="0" x2="1">
              <stop stopColor="#e7e3d2" stopOpacity=".7" />
              <stop offset=".38" stopColor="#afbdc4" stopOpacity=".22" />
              <stop offset="1" stopColor="#8999a2" stopOpacity="0" />
            </linearGradient>
            <filter
              id={Id + "soft"}
              x="-20%"
              y="-40%"
              width="140%"
              height="180%"
            >
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          <rect width="300" height="166" fill={`url(#${Id}air)`} />
          <g
            fill="none"
            stroke="#aebbc1"
            filter={`url(#${Id}soft)`}
            opacity={Enabled ? 0.2 + Math.min(0.48, Extinction * 70) : 0.08}
          >
            <path
              d="M-20 48C28 18 67 68 116 40S210 20 326 50"
              strokeWidth="18"
            />
            <path
              d="M-28 86C30 55 80 110 139 78S238 58 330 92"
              strokeWidth="23"
            />
            <path
              d="M-18 126C40 94 92 142 156 115S250 98 325 130"
              strokeWidth="30"
            />
          </g>
          <g fill="none" stroke="#d4dcdf" opacity={Enabled ? 0.2 : 0.07}>
            <path d="M0 55C46 31 81 71 128 49S223 36 300 60" />
            <path d="M0 93C52 70 88 108 148 85S246 75 300 101" />
            <path d="M0 130C57 109 106 141 166 121S252 112 300 137" />
          </g>
          <path d="M18 82H286" stroke={`url(#${Id}beam)`} strokeWidth="4" />
          <circle cx="18" cy="82" r="4" fill="#eee8d3" opacity=".9" />
          {Local && (
            <rect
              x="42"
              y="27"
              width="216"
              height="108"
              rx="8"
              fill="none"
              stroke="#cbd5d833"
              strokeDasharray="4 4"
            />
          )}
          {Height && (
            <path d="M270 28V132M264 38l6-10 6 10" stroke="#cbd5d855" />
          )}
          {Aerial && Start > 0 && (
            <path
              d={`M${20 + Math.min(260, (Start / MaximumDistance) * 260)} 25v112`}
              stroke="#d6c89c66"
              strokeDasharray="3 3"
            />
          )}
          {Array.from({ length: 20 }, (_, Index) => (
            <circle
              key={Index}
              cx={35 + ((Index * 47) % 245)}
              cy={25 + ((Index * 31) % 112)}
              r={1 + (Index % 3) * 0.45}
              fill="#d9e0e2"
              opacity={Enabled ? 0.08 + (Index % 5) * 0.035 : 0.035}
            />
          ))}
          {Markers.map((Distance, Index) => {
            const X = 20 + (Index / (Markers.length - 1)) * 260;
            return (
              <g key={Distance} opacity={0.22 + Transmission(Distance) * 0.66}>
                <path d={`M${X} 145v5`} stroke="#c5ccca" />
                <text x={X} y="161" textAnchor="middle">
                  {Distance >= 1000 ? Distance / 1000 + "k" : Distance} m
                </text>
              </g>
            );
          })}
          <path d="M20 145H280" stroke="#ffffff24" />
          {Number.isFinite(Sight) && (
            <path
              d={`M${Math.max(12, Math.min(280, 20 + (Sight / MaximumDistance) * 260))} 18v119`}
              stroke="#ced3d6"
              strokeDasharray="3 3"
              opacity=".55"
            />
          )}
        </svg>
        <div className="fog-caption">
          <strong>{!Enabled ? "Clear air" : Model}</strong>
          <small>
            {Height
              ? `Probe ${V("Probe altitude") ?? 2} m · falloff ${V("Falloff Height")} m`
              : Aerial
                ? `Extinction starts at ${Start} m`
                : `${Shape.Type} · bounded interior`}
            <span>
              {Number.isFinite(Sight)
                ? Sight >= 1000
                  ? (Sight / 1000).toFixed(1) + " km sight"
                  : Math.round(Sight) + " m sight"
                : "DISABLED"}
            </span>
          </small>
        </div>
      </section>
      <div className="fog-readings">
        {Tiles.map(([Value, Label]) => (
          <div className="fog-reading" key={Label}>
            <b>{Value}</b>
            <small>{Label}</small>
          </div>
        ))}
      </div>
      <div className="fog-readings">
        <div className="fog-reading">
          <b>{Percent(Transmission(200))}</b>
          <small>
            {Local ? "200 m interior transmission" : "Transmission at 200 m"}
          </small>
        </div>
        <div className="fog-reading">
          <b>{Enabled ? "Active" : "Disabled"}</b>
          <small>{Model}</small>
        </div>
      </div>
      {QuickControls}
      <section
        className="property-card fog-instrument fog-visibility-card"
        data-card="Visibility through fog"
      >
        <h2>Visibility</h2>
        <FogGraph Kind={Kind} V={V} Change={Change} />
        <div className="fog-beam">
          <div>
            <strong>Light transport</strong>
            <small>
              {Height
                ? "Beam chamber · sun scatter"
                : Aerial
                  ? "Beam chamber · Mie blend"
                  : "Beam chamber · local anisotropy"}
            </small>
          </div>
          <svg viewBox="0 0 300 84" role="img" aria-label="Fog beam chamber">
            <rect width="300" height="84" fill="none" />
            {Array.from({ length: 70 }, (_, Index) => {
              const Fraction = Index / 69,
                Distance = Fraction * 400,
                Width = 2 + Fraction * Fraction * (5 + Scatter * 15);
              return (
                <rect
                  key={Index}
                  x={12 + Fraction * 272}
                  y={40 - Width}
                  width="4"
                  height={Width * 2}
                  fill="#b8cddd"
                  opacity={
                    Enabled && Distance >= Start
                      ? (0.025 + 0.18 * Scatter) * Transmission(Distance)
                      : 0
                  }
                />
              );
            })}
            <path d="M12 40H288" stroke="#ffffff15" />
            <circle cx="12" cy="40" r="3" fill="#ece4ca" />
            <text x="10" y="14">
              SCHEMATIC
            </text>
            <text x="290" y="75" textAnchor="end">
              {Percent(Transmission(400))} AT 400 m
            </text>
          </svg>
        </div>
      </section>
    </div>
  );
}

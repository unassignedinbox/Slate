import React from "react";
import { FogGraph, FogDensity } from "./LiveGraph.jsx";
import { ResolveFogShape } from "./FogShape.js";
import "./FogPanel.css";

// One shared Fog card composition. Models supply data; they do not own separate cards.
export default function FogPanel({ Kind, V, Values, Change, QuickControls }) {
  const Height = Kind === "height-fog",
    Aerial = Kind === "aerial-fog",
    Local = Kind === "local-fog",
    Enabled = !!V("Enabled"),
    Density = Math.max(0, Number(V("Density")) || 0),
    Extinction = FogDensity(Kind, V, V("Probe altitude") ?? 2),
    Start = Aerial ? Math.max(0, Number(V("Start")) || 0) : 0,
    Transmission = (Distance) =>
      Math.exp(-Extinction * Math.max(0, Distance - Start)),
    Sight = Extinction > 0 ? Start - Math.log(0.02) / Extinction : Infinity,
    Shape = ResolveFogShape(Values),
    Percent = (Value) => (Value * 100).toFixed(0) + "%",
    MaximumDistance = Aerial ? 4000 : 400,
    Accent = Height ? "#f0c16b" : Aerial ? "#55d7ae" : "#a99af0",
    Model = Height
      ? "Height falloff"
      : Aerial
        ? "Start-distance haze"
        : Shape.Type + " volume",
    Scatter = Height
      ? Number(V("Sun Scatter")) || 0
      : Aerial
        ? Number(V("Mie Blend")) || 0
        : Number(V("Anisotropy")) || 0;

  const Metrics = Height
    ? [
        [Density.toFixed(4), "Density"],
        [V("Falloff Height") + " m", "Falloff"],
        [Number(V("Sun Scatter")).toFixed(2), "Scatter"],
        [V("Probe altitude") ?? 2, "Altitude · m"],
      ]
    : Aerial
      ? [
          [Density.toFixed(2) + "×", "Density"],
          [Start + " m", "Start"],
          [Percent(V("Mie Blend")), "Mie blend"],
          [V("Probe distance") ?? 200, "Probe · m"],
        ]
      : [
          [Density.toFixed(2), "Density"],
          [Percent(V("Coverage")), "Coverage"],
          [V("Feature Scale") + " m", "Scale"],
          [Number(V("Anisotropy")).toFixed(2), "Anisotropy"],
        ];

  const DashboardMetrics = [
    ...Metrics,
    [Percent(Transmission(200)), "Transmission · 200 m"],
    [Enabled ? "Active" : "Disabled", Model],
  ];

  return (
    <div
      className="fog-instruments"
      data-fog-kind={Kind}
      style={{ "--fog-accent": Accent }}
    >
      {QuickControls}
      <section
        className="property-card fog-instrument fog-visibility-card"
        data-card="Visibility through fog"
      >
        <div className="fog-card-heading">
          <h2>
            <i /> Visibility
          </h2>
          <span>0–{MaximumDistance.toLocaleString("en-US")} m</span>
        </div>

        <div className="fog-dashboard-stats" aria-label="Fog statistics">
          {DashboardMetrics.map(([Value, Label], Index) => (
            <div className="fog-dashboard-stat" key={Label}>
              <small>
                <i className={Index === 5 && !Enabled ? "alert" : ""} />
                {Label}
              </small>
              <strong>{Value}</strong>
            </div>
          ))}
        </div>

        <FogGraph Kind={Kind} V={V} Change={Change} />

        <div className="fog-beam fog-beam-card">
          <div>
            <strong>Beam chamber</strong>
            <small>
              {Height
                ? "Sun scatter"
                : Aerial
                  ? "Mie blend"
                  : "Local anisotropy"}
            </small>
          </div>
          <svg viewBox="0 0 300 96" role="img" aria-label="Fog beam chamber">
            <defs>
              <linearGradient id={`fog-beam-${Kind}`} x1="0" x2="1">
                <stop stopColor="#e8e4d4" stopOpacity=".7" />
                <stop offset="1" stopColor={Accent} stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect width="300" height="96" fill="none" />
            <path d="M12 48H288" stroke="#ffffff12" strokeDasharray="3 4" />
            <path d="M12 23H288M12 73H288" stroke="#ffffff08" />
            {Array.from({ length: 70 }, (_, Index) => {
              const Fraction = Index / 69,
                Distance = Fraction * 400,
                Width = 2 + Fraction * Fraction * (5 + Scatter * 15);
              return (
                <rect
                  key={Index}
                  x={12 + Fraction * 272}
                  y={48 - Width}
                  width="4"
                  height={Width * 2}
                  fill={Accent}
                  opacity={
                    Enabled && Distance >= Start
                      ? (0.025 + 0.18 * Scatter) * Transmission(Distance)
                      : 0
                  }
                />
              );
            })}
            <path
              d="M12 48H288"
              stroke={`url(#fog-beam-${Kind})`}
              strokeWidth="2"
            />
            <circle cx="12" cy="48" r="4" fill="#eee8d3" />
            <circle
              cx={Math.max(
                12,
                Math.min(288, 12 + ((V("Probe distance") ?? 200) / 400) * 276),
              )}
              cy="48"
              r="4"
              fill={Accent}
              stroke="#171717"
              strokeWidth="2"
            />
            <text x="12" y="14">
              LIGHT TRANSPORT
            </text>
            <text x="288" y="91" textAnchor="end">
              {Percent(Transmission(400))} AT 400 m
            </text>
          </svg>
        </div>
      </section>
    </div>
  );
}

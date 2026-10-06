import React, { useId } from "react";
import { FogGraph, FogDensity } from "./LiveGraph.jsx";
import { ResolveFogShape } from "./FogShape.js";
import "./FogPanel.css";

// These probes share the existing HTML fog model; they are not native scene raymarches.
export default function FogPanel({ Kind, V, Values, Change, QuickControls }) {
  const Local = Kind === "local-fog",
    Enabled = !!V("Enabled"),
    Id = useId().replaceAll(":", "");
  const Density = Math.max(0, Number(V("Density")) || 0);
  const Extinction = FogDensity(Kind, V, V("Probe altitude") ?? 2);
  const Start = Local ? 0 : Math.max(0, V("Start"));
  const Transmission = (Distance) =>
    Math.exp(-Extinction * Math.max(0, Distance - Start));
  const Sight = Extinction > 0 ? Start - Math.log(0.02) / Extinction : Infinity;
  const Shape = ResolveFogShape(Values);
  const Percent = (Value) => (Value * 100).toFixed(0) + "%";
  const Tiles = Local
    ? [
        [Density.toFixed(2), "Density"],
        [Percent(V("Coverage")), "Coverage"],
        [V("Feature Scale") + " m", "Feature scale"],
        [Number(V("Anisotropy")).toFixed(2), "Anisotropy"],
      ]
    : [
        [Density.toFixed(2) + "×", "Haze density"],
        [Start + " m", "Start distance"],
        [Percent(V("Mie Blend")), "Mie blend"],
        [
          Number.isFinite(Sight) ? (Sight / 1000).toFixed(2) + " km" : "Clear",
          "2% contrast",
        ],
      ];
  return (
    <div className="fog-instruments" data-fog-kind={Kind}>
      <section className="fog-instrument fog-sight fog-height-style">
        <svg
          viewBox="0 0 300 166"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            Local ? "Local fog sight line" : "Atmospheric haze sight line"
          }
        >
          <defs>
            <linearGradient id={Id + "air"} x2="0" y2="1">
              <stop stopColor="#090b0e" />
              <stop offset=".42" stopColor="#181d22" />
              <stop offset="1" stopColor="#08090a" />
            </linearGradient>
          </defs>
          <rect width="300" height="166" fill={`url(#${Id}air)`} />
          {Local ? (
            <>
              {Array.from({ length: 15 }, (_, Index) => (
                <path
                  key={"ray" + Index}
                  d={`M150 70L${150 + (Index - 7) * 39} 166`}
                  stroke="#ffffff12"
                />
              ))}
              {Array.from({ length: 12 }, (_, Index) => (
                <path
                  key={"grid" + Index}
                  d={`M0 ${70 + Math.pow((Index + 1) / 12, 1.75) * 96}H300`}
                  stroke="#ffffff12"
                />
              ))}
            </>
          ) : (
            <>
              <circle cx="244" cy="34" r="14" fill="#d6d3bf" opacity=".18" />
              <path
                d="M0 83L38 58 70 75 112 44 157 76 201 54 245 73 300 49V112H0Z"
                fill="#2c3438"
                opacity={0.12 + Transmission(2000) * 0.25}
              />
              <path
                d="M0 102L34 81 66 93 103 70 137 97 177 75 220 95 264 72 300 89V128H0Z"
                fill="#30383a"
                opacity={0.18 + Transmission(1000) * 0.34}
              />
              <path
                d="M0 128L41 105 78 117 118 96 153 121 195 102 237 119 275 98 300 109V166H0Z"
                fill="#23292a"
                opacity={0.34 + Transmission(500) * 0.42}
              />
              <path d="M128 166L146 111H154L172 166Z" fill="#101314" />
              <path d="M148 111V166" stroke="#7f898b" opacity=".55" />
              {[210, 235, 260].map((X, Index) => (
                <g
                  key={X}
                  opacity={0.25 + Transmission(250 + Index * 350) * 0.52}
                >
                  <path d={`M${X} 126v40`} stroke="#161a1b" strokeWidth="3" />
                  <path
                    d={`M${X - 13} 133l13-32 13 32M${X - 10} 121l10-28 10 28`}
                    stroke="#202627"
                    strokeWidth="5"
                    strokeLinejoin="round"
                  />
                </g>
              ))}
              {[50, 200, 500, 1000, 2000, 4000].map((Distance, Index) => {
                const X = 22 + Index * 50;
                return (
                  <g
                    key={Distance}
                    opacity={0.25 + Transmission(Distance) * 0.65}
                  >
                    <path d={`M${X} 148v5`} stroke="#c5ccca" />
                    <text x={X} y="162" textAnchor="middle">
                      {Distance >= 1000 ? Distance / 1000 + "k" : Distance} m
                    </text>
                  </g>
                );
              })}
              <path d="M20 148H280" stroke="#ffffff2b" />
            </>
          )}
          {Array.from({ length: 32 }, (_, Index) => (
            <rect
              key={Index}
              x="0"
              y={Index * 5}
              width="300"
              height="5"
              fill="#9babb6"
              opacity={
                Enabled ? Math.min(0.19, Extinction * 18) * (Index / 32) : 0
              }
            />
          ))}
          {Number.isFinite(Sight) && (
            <g>
              <path
                d={`M${Math.max(12, Math.min(270, (Sight / (Local ? 400 : 4000)) * 280))} 9v129`}
                stroke="#ced3d6"
                strokeDasharray="3 3"
                opacity=".6"
              />
              <text x="288" y="16" textAnchor="end">
                2% CONTRAST
              </text>
            </g>
          )}
        </svg>
        <div className="fog-caption">
          <strong>
            {!Enabled ? "Clear air" : Local ? "Local fog" : "Atmospheric haze"}
          </strong>
          <small>
            {Local
              ? Shape.Type + " · interior probe"
              : "Distance haze · start " + Start + " m"}
            <span>
              {Number.isFinite(Sight)
                ? Sight >= 1000
                  ? (Sight / 1000).toFixed(1) + " km sight"
                  : Math.round(Sight) + " m sight"
                : Enabled
                  ? "CLEAR"
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
          <b>{Local ? Shape.Type : Enabled ? "Active" : "Disabled"}</b>
          <small>{Local ? "Volume shape" : "Medium"}</small>
        </div>
      </div>
      {QuickControls}
      <section
        className="property-card fog-instrument"
        data-card="Visibility through fog"
      >
        <h2>Visibility</h2>
        <FogGraph Kind={Kind} V={V} Change={Change} />
      </section>
      <section className="fog-instrument fog-beam">
        <h2>Light transport</h2>
        <small>
          {Local ? "Interior beam study" : "Beam chamber · distance haze"}
        </small>
        <svg viewBox="0 0 300 84" role="img" aria-label="Fog beam chamber">
          <rect width="300" height="84" fill="none" />
          {Array.from({ length: 70 }, (_, Index) => {
            const Fraction = Index / 69,
              Distance = Fraction * 400;
            const Strength = Local
              ? 0.4 + Math.max(0, V("Anisotropy"))
              : V("Mie Blend");
            const Width = 2 + Fraction * Fraction * (5 + Strength * 15);
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
                    ? (0.025 + 0.18 * Strength) * Transmission(Distance)
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
      </section>
    </div>
  );
}

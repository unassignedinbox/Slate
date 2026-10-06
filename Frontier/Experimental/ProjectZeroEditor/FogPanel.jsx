import React, { useId } from "react";
import { FogGraph, FogDensity } from "./LiveGraph.jsx";
import { ResolveFogShape, FogGeometry } from "./FogShape.js";
import "./FogPanel.css";

// These probes share the existing HTML fog model; they are not native scene raymarches.
export default function FogPanel({ Kind, V, Values, Change }) {
  const Local = Kind === "local-fog",
    Enabled = !!V("Enabled"),
    Id = useId().replaceAll(":", "");
  const Density = Math.max(0, Number(V("Density")) || 0);
  const Extinction = FogDensity(Kind, V, V("Probe altitude") ?? 2);
  const Start = Local ? 0 : Math.max(0, V("Start"));
  const Transmission = (Distance) =>
    Math.exp(-Extinction * Math.max(0, Distance - Start));
  const Sight = Extinction > 0 ? Start - Math.log(0.02) / Extinction : Infinity;
  const Shape = ResolveFogShape(Values),
    Mesh = FogGeometry(Shape);
  const Extent = Math.max(1, ...Mesh.Vertices.flat().map(Math.abs));
  const Project = ([X, Y, Z]) => [
    150 + ((X * 0.7 + Y * 0.3) / Extent) * 68,
    95 + ((Y * 0.2 - Z * 0.6) / Extent) * 68,
  ];
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
      <section className="fog-instrument fog-sight">
        <svg
          viewBox="0 0 300 175"
          role="img"
          aria-label={
            Local ? "Local fog volume schematic" : "Atmospheric haze sight line"
          }
        >
          <defs>
            <linearGradient id={Id + "air"} x2="0" y2="1">
              <stop stopColor="#0c1116" />
              <stop offset="1" stopColor="#252d32" />
            </linearGradient>
          </defs>
          <rect width="300" height="175" fill={`url(#${Id}air)`} />
          {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((Index) => (
            <path
              key={Index}
              d={`M150 65 L${150 + Index * 50} 175`}
              stroke="#ffffff0c"
            />
          ))}
          {[80, 100, 125, 155].map((Y) => (
            <path key={Y} d={`M0 ${Y}H300`} stroke="#ffffff0c" />
          ))}
          {Local
            ? Mesh.Edges.map(([A, B], Index) => (
                <path
                  key={Index}
                  d={`M${Project(Mesh.Vertices[A]).join(" ")}L${Project(Mesh.Vertices[B]).join(" ")}`}
                  stroke="#bdcfda"
                  strokeOpacity={Enabled ? 0.75 : 0.2}
                  fill="none"
                />
              ))
            : [2000, 1000, 500, 200, 50].map((Distance, Index) => (
                <g key={Distance} opacity={0.07 + 0.8 * Transmission(Distance)}>
                  <rect
                    x={150 - (Index + 2) * 10}
                    y={85 - (Index + 2) * 6}
                    width={(Index + 2) * 20}
                    height={(Index + 2) * 16}
                    fill="none"
                    stroke="#d3e0e8"
                  />
                  <text x="150" y={96 - (Index + 2) * 6} textAnchor="middle">
                    {Distance} m
                  </text>
                </g>
              ))}
          <text x="12" y="17">
            {Local
              ? "BOUNDED VOLUME · " + Shape.Type.toUpperCase()
              : "DISTANCE HAZE · AUTHORING PROBE"}
          </text>
        </svg>
        <div className="fog-caption">
          <strong>{Local ? "Local medium" : "Atmospheric haze"}</strong>
          <small>
            {Enabled
              ? Local
                ? "Uniform interior probe · not a scene ray"
                : "Distance attenuation after the start plane"
              : "Disabled · no attenuation"}
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
          <rect width="300" height="84" fill="#0b0c0d" />
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

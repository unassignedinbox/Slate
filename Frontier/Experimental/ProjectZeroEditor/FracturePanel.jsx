//============================================================================================================================================
//                                                             FRACTUREPANEL.JSX
//============================================================================================================================================
// 📦 Selected-object fracture enablement, execution choice and expansion.

import React from "react";
import {
  Normalize,
  Describe,
  Signature,
} from "../FractureEditor/FractureSpecification.js";

export default function FracturePanel({ Subject, Values, Change, Expand }) {
  const Settings = Normalize(Values.Fracture),
    Owner = Describe(Subject, Values),
    Supported = ["cube", "sphere", "cylinder", "cone"].includes(
      Owner.Primitive,
    ),
    Ready = Settings.Baked?.Signature === Signature(Owner, Settings);
  const Assign = (Key, Value) =>
    Change("Fracture", { ...Settings, [Key]: Value });
  return (
    <section className="generic-card fracture-card" data-card="Fracture">
      <header>
        <div>
          <h3>Fracture</h3>
          <small>PER-OBJECT GEOMETRY</small>
        </div>
        <button
          className="fracture-expand"
          aria-label="Expand fracture editor"
          title="Open fracture editor for this object"
          disabled={!Settings.Enabled || !Expand}
          onClick={Expand}
        >
          ↗
        </button>
      </header>
      <label className="switch-row">
        <span>Enable fracture</span>
        <button
          className={"toggle " + (Settings.Enabled ? "on" : "")}
          role="switch"
          aria-label="Enable fracture"
          aria-checked={Settings.Enabled}
          onClick={() => Assign("Enabled", !Settings.Enabled)}
        >
          <i />
        </button>
      </label>
      {Settings.Enabled && (
        <>
          <div className="fracture-diagram" aria-hidden="true">
            <svg viewBox="0 0 280 68">
              <path d="M32 15 65 5 95 23 92 52 61 64 30 44Z M65 5 58 30 30 44M58 30 92 52M58 30 95 23" />
              <path d="M121 34h37m-6-5 6 5-6 5" />
              <path d="m188 13 24-8-6 24-26 11Zm32-5 26 16-30 7Zm-42 40 27-12 27 20-22 10Zm41-8 29-13-3 26Z" />
            </svg>
            <span>Source geometry → closed fragments</span>
          </div>
          <h4>BAKE</h4>
          <div
            className="fracture-mode"
            role="group"
            aria-label="Fracture execution"
          >
            {["dynamic", "baked"].map((Mode) => (
              <button
                key={Mode}
                aria-pressed={Settings.Mode === Mode}
                onClick={() => Assign("Mode", Mode)}
              >
                {Mode === "dynamic" ? "Dynamic" : "Baked"}
              </button>
            ))}
          </div>
          <p>
            {Settings.Mode === "dynamic"
              ? "Generate fragments on demand."
              : "Reuse stored geometry for this object."}{" "}
            {Settings.Mode === "baked"
              ? Ready
                ? "Browser bake ready."
                : "Open the editor to bake or refresh geometry."
              : ""}
          </p>
          <button className="fracture-open" disabled={!Expand} onClick={Expand}>
            Edit {Subject.Name} fracture <span>↗</span>
          </button>
          <p>
            {Supported
              ? "Analytical primitive preview; object scale is applied."
              : "Concave / unrecognised geometry requires decomposition; fracture execution is refused, not replaced by a box."}{" "}
            HTML authoring only; native execution pending.
          </p>
        </>
      )}
    </section>
  );
}

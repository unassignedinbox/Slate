import React from "react";
import {
  normalizeStitches,
  stitchTypes,
  applyStitches,
} from "./patternStitches.js";
import { replacePatternColor } from "./patternLibrary.js";

export default function PatternTextileTools({ doc, commit, onError }) {
  const stitch = normalizeStitches(doc.stitch || { enabled: false });
  const colors = [
    ...new Set([
      doc.background,
      ...doc.layers
        .filter((l) => !["image", "svg"].includes(l.kind))
        .map((l) => l.color),
    ]),
  ];
  const update = (patch) => {
    try {
      commit(applyStitches(doc, patch));
    } catch (e) {
      onError(e.message);
    }
  };
  return (
    <>
      <details className="pe-section pe-textile-tools">
        <summary>
          Design palette <span>{colors.length} colors</span>
        </summary>
        <p className="pe-hint">
          Recolor matching vector layers together. Geometry, relief and finish
          assignments stay intact.
        </p>
        <div className="pe-palette-swatches">
          {colors.map((color, i) => (
            <label key={i} title={color}>
              <input
                type="color"
                aria-label={"Palette color " + (i + 1)}
                value={color}
                onChange={(e) =>
                  commit(replacePatternColor(doc, color, e.target.value))
                }
              />
              <span>{i + 1}</span>
            </label>
          ))}
        </div>
        <p className="pe-hint">
          Imported image and grouped-SVG internal colors are not replaced.
        </p>
      </details>
      <details className="pe-section pe-textile-tools" open={stitch.enabled}>
        <summary>
          Stitch overlay <span>{stitch.enabled ? "On" : "Add stitching"}</span>
        </summary>
        <label className="pe-check">
          <input
            type="checkbox"
            aria-label="Enable stitch overlay"
            checked={stitch.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />{" "}
          Stitch this design
        </label>
        <label>
          Stitch construction
          <select
            aria-label="Stitch construction"
            value={stitch.type}
            onChange={(e) => update({ type: e.target.value, enabled: true })}
          >
            {stitchTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          Placement
          <select
            aria-label="Stitch placement"
            value={stitch.layout}
            onChange={(e) => update({ layout: e.target.value, enabled: true })}
          >
            <option value="rows">Repeating rows</option>
            <option value="columns">Repeating columns</option>
            <option value="diagonal">Diagonal field</option>
            <option value="border">Inset border</option>
          </select>
        </label>
        <label className="pe-color">
          Thread color
          <input
            type="color"
            aria-label="Stitch thread color"
            value={stitch.color}
            onChange={(e) => update({ color: e.target.value, enabled: true })}
          />
        </label>
        {[
          ["spacing", "Stitch spacing", 16, 64, 1],
          ["width", "Thread width", 1, 8, 0.25],
          ["relief", "Stitch relief (mm)", 0, 1, 0.05],
          ...(stitch.layout === "border"
            ? [["inset", "Border inset", 12, 96, 1]]
            : []),
        ].map(([key, label, min, max, step]) => (
          <label key={key}>
            {label}
            <div className="pe-fade-range">
              <input
                type="range"
                aria-label={label}
                value={stitch[key]}
                min={min}
                max={max}
                step={step}
                onChange={(e) =>
                  update({ [key]: +e.target.value, enabled: true })
                }
              />
              <output>{stitch[key]}</output>
            </div>
          </label>
        ))}
        <p className="pe-hint">
          Raised cotton thread + recessed entry marks. Spacing snaps to whole
          repeats; spacing, width and inset use tile units. Edits rebuild only
          the 3 stitch layers, replacing manual edits to their paths. This is
          surface relief, not holes cut into the mesh.
        </p>
        {stitch.enabled && (
          <button className="pe-wide" onClick={() => update({})}>
            Rebuild stitch layers
          </button>
        )}
      </details>
    </>
  );
}

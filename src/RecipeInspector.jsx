import React, { useState } from "react";
import {
  ChevronDown,
  Layers3,
  Sparkles,
  SlidersHorizontal,
  ShieldCheck,
} from "lucide-react";
import { Slider, ColorField, ColorRamp } from "./MaterialControls";
import {
  getRecipe,
  recipeControlValue,
  applyRecipeControl,
  applyRecipeColor,
  basicWeaves,
} from "./materialProfiles";

export default function RecipeInspector({ params: p, update, setParams }) {
  const recipe = getRecipe(p);
  const [closed, setClosed] = useState({
    construction: false,
    detail: true,
    colors: true,
  });
  const section = (id, title, children, tag) => (
    <section className="inspector-section recipe-section" key={id}>
      <button
        className="section-title"
        aria-expanded={!closed[id]}
        onClick={() => setClosed((v) => ({ ...v, [id]: !v[id] }))}
      >
        <span>
          {id === "iridescence" || id === "flakes" ? (
            <Sparkles size={13} />
          ) : (
            <Layers3 size={13} />
          )}{" "}
          {title}
        </span>
        <span>
          {tag && <small>{tag}</small>}
          <ChevronDown size={13} className={closed[id] ? "collapsed" : ""} />
        </span>
      </button>
      {!closed[id] && <div className="section-content">{children}</div>}
    </section>
  );
  const control = (c) => (
    <div className="recipe-control" key={c.id}>
      <Slider
        label={c.label}
        value={recipeControlValue(p, c)}
        onChange={(v) => setParams((q) => applyRecipeControl(q, c, v))}
        min={c.direct ? c.min : 0}
        max={c.direct ? c.max : 1}
        step={c.direct ? c.step : 0.01}
        log={!!c.log}
        extend={!!c.extend}
        unit={c.unit || ""}
        percentage={!c.direct || c.id === "flakes"}
      />
      {c.hint && <p className="help-text">{c.hint}</p>}
    </div>
  );
  const group = (id) =>
    recipe.controls.filter((c) => c.group === id).map(control);
  const weaves = basicWeaves(),
    weave = weaves.find((w) => w.id === p.weavePattern) || weaves[1];
  return (
    <>
      <div className="recipe-intro">
        <div>
          <span className="recipe-eyebrow">
            <ShieldCheck size={11} /> MATERIAL-AWARE CONTROLS
          </span>
          <span className="recipe-chip">TUNED</span>
        </div>
        <h4>{recipe.title}</h4>
        <p>{recipe.caption}</p>
      </div>
      {section(
        "finish",
        recipe.woven ? "Yarn color & feel" : "Color & finish",
        <>
          {recipe.colors.map((c) => (
            <ColorField
              key={c.key}
              label={c.label}
              value={p[c.key]}
              onChange={(v) => setParams((q) => applyRecipeColor(q, c.key, v))}
            />
          ))}
          {group("finish")}
          <div className="recipe-range-note">
            <ShieldCheck size={12} />
            <span>
              Material-specific ranges. Physical values stay in balance.
            </span>
          </div>
        </>,
      )}
      {recipe.iridescent &&
        section(
          "iridescence",
          "Iridescent finish",
          <>
            {group("iridescence")}
            <div className="film-spectrum" />
            <p className="help-text">
              Orbit the surface to see the shift. Thin-film interference changes
              the reflection color with viewing angle—not just a painted-on
              gradient.
            </p>
          </>,
          "THIN FILM",
        )}
      {recipe.woven &&
        section(
          "construction",
          "Weave construction",
          <>
            <label className="weave-select">
              <span>Construction</span>
              <select
                aria-label="Weave construction"
                value={p.weavePattern}
                onChange={(e) => update("weavePattern", e.target.value)}
              >
                {weaves.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <p className="weave-description">{weave.description}</p>
            {group("construction")}
            <p className="help-text">
              Yarn colors follow the over/under pattern. On the frozen cloth,
              the weave follows every fold.
            </p>
          </>,
          "9 WEAVES",
        )}
      {p.type === 0 &&
        section(
          "flakes",
          "Flake character",
          <>
            {group("flakes")}
            <p className="help-text">
              Sparkle tunes micro-roughness and orientation; reflectivity
              independently bounds the metallic response. Cellular particles
              remain layered beneath the coat.
            </p>
          </>,
          "CELLULAR",
        )}
      {p.type === 0 &&
        section(
          "colors",
          "Flake colors",
          <ColorRamp params={p} update={update} setParams={setParams} />,
        )}
      {group("detail").length > 0 &&
        section(
          "detail",
          recipe.woven ? "Thread detail" : "Surface detail",
          <>
            {group("detail")}
            {recipe.id === "wornPlastic" && (
              <p className="help-text">
                Abrasion flattens the raised grain. The recessed surface keeps
                its texture.
              </p>
            )}
          </>,
        )}
      <div className="recipe-footer">
        <SlidersHorizontal size={16} />
        <div>
          <strong>Fewer knobs. Better materials.</strong>
          <p>
            Only controls that affect this material are shown. No exposed
            metalness, generic roughness or unrelated coating settings.
          </p>
        </div>
      </div>
    </>
  );
}

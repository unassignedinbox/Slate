import React, { useState, useRef, useEffect } from "react";
import { Layers3, ArrowDownToLine, LoaderCircle } from "lucide-react";
import { bakeMaterial } from "./bakeMaterial.js";

export default function BakePanel({ params, onNotify }) {
  const [resolution, setResolution] = useState(1024),
    [width, setWidth] = useState(100);
  const [progress, setProgress] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function bake() {
    setError("");
    setBusy(true);
    controller.current = new AbortController();
    try {
      const { bytes } = await bakeMaterial(params, {
        resolution,
        widthMM: width,
        signal: controller.current.signal,
        onProgress: (p) => {
          if (mounted.current) setProgress(p);
        },
      });
      if (!mounted.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/zip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = params.id + "-maps.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      onNotify("Six procedural maps and the material recipe exported.");
    } catch (e) {
      if (mounted.current)
        setError(e.name === "AbortError" ? "Bake cancelled." : e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="modal-icon">
        <Layers3 size={24} />
      </div>
      <span className="eyebrow">FROM MATH TO MAPS</span>
      <h2 id="modal-title">Bake a surface patch</h2>
      <p>{params.name} · unlit channels from the same procedural shader.</p>
      <div className="bake-settings">
        <label>
          Resolution
          <select
            aria-label="Bake resolution"
            value={resolution}
            disabled={busy}
            onChange={(e) => setResolution(Number(e.target.value))}
          >
            {[256, 512, 1024, 2048].map((n) => (
              <option key={n} value={n}>
                {n} × {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Patch width · mm
          <input
            aria-label="Bake patch width"
            type="number"
            min="1"
            max="1000"
            value={width}
            disabled={busy}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="bake-channels">
        {[
          "Base color",
          "Roughness",
          "Metalness",
          "Normal +Y",
          "Height",
          "Emission",
        ].map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <p className="bake-disclaimer">
        Flat XY patch, not a mesh UV bake. Seamless tiling is not guaranteed.
        Optical effects remain in the recipe; maps alone cannot capture
        scattering or angle-dependent color shifts. PNG channels are 8-bit.
      </p>
      {progress && (
        <div className="bake-progress" role="status">
          <span>
            {progress.label} · {progress.done}/6
          </span>
          <progress aria-label="Bake progress" value={progress.done} max={6} />
        </div>
      )}
      {error && (
        <p className="bake-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button"
        disabled={busy || !Number.isFinite(width) || width < 1 || width > 1000}
        onClick={bake}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <ArrowDownToLine size={16} />
        )}{" "}
        {busy ? "Baking procedural maps…" : "Bake & download ZIP"}
      </button>
      {busy && (
        <button
          className="bake-cancel"
          onClick={() => controller.current?.abort()}
        >
          Cancel after current GPU pass
        </button>
      )}
      <p className="modal-footnote">
        Six PNG maps + scale/channel metadata + original procedural recipe. No
        input textures are used.
      </p>
    </>
  );
}

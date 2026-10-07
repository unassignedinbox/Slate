import RugCompositionControls from "./RugCompositionControls.jsx";
import PatternTextileTools from "./PatternTextileTools.jsx";
import { textilePalettes } from "./patternLibrary.js";
import { rebuildCollectionFade } from "./patternCollections.js";
import PatternMaterialPreview from "./PatternMaterialPreview.jsx";
import { resolvePatternBase } from "./patternSurface.js";
import {
  movePatternLayer,
  resizePatternLayer,
  rotatePatternLayer,
  reflectPatternLayer,
  radialPatternLayers,
} from "./patternTransforms.js";
import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  X,
  Plus,
  Undo2,
  Redo2,
  Upload,
  Download,
  Move,
  PenLine,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers3,
} from "lucide-react";
import {
  patternStarter,
  patternStarterNames,
  patternStarterCatalog,
  generatePatternLayout,
  patternLayer,
  patternSVG,
  patternShape,
  validatePattern,
  patternFinishes,
} from "./patternDocument.js";
import { sanitizePatternSVG } from "./patternImport.js";
import { rasterPatternSVG, patternImage } from "./patternRuntime.js";
import { leatherSourceSVG } from "./leatherSource.js";
import "./patternEditor.css";

// Only mounted page cards generate SVG. Hundreds of presets must not block
// startup, pointer moves or background material-thumbnail updates.
const StarterThumb = React.memo(function StarterThumb({ name }) {
  const src = useMemo(
    () =>
      `data:image/svg+xml,${encodeURIComponent(patternSVG(patternStarter(name)))}`,
    [name],
  );
  return <img src={src} alt="" loading="lazy" decoding="async" />;
});
const libraryGroups = [
  "All patterns",
  "Detailed compositions",
  ...new Set(patternStarterCatalog.map((p) => p.group)),
];

function patternDownload(text, name, type) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function PatternEditor({
  initial,
  currentMaterial,
  currentShape,
  onClose,
  onApply,
}) {
  const [doc, setDoc] = useState(() =>
    initial
      ? validatePattern(initial)
      : patternStarter(
          patternStarterNames.find(
            (name) =>
              name.toLowerCase().replaceAll(" ", "-") ===
              new URLSearchParams(window.location.search).get("pattern"),
          ),
        ),
  );
  const docRef = useRef(doc);
  docRef.current = doc;
  const [mode, setMode] = useState(() =>
      new URLSearchParams(window.location.search).get("view") === "3d"
        ? "material"
        : "design",
    ),
    [grid, setGrid] = useState(0),
    [aspect, setAspect] = useState(false),
    [ring, setRing] = useState({ count: 6, radius: 160 });
  const [collectionFilter, setCollectionFilter] = useState(() =>
    doc.ornament ? "Detailed compositions" : "All patterns",
  );
  const [librarySearch, setLibrarySearch] = useState(""),
    [libraryPalette, setLibraryPalette] = useState("All colorways"),
    [libraryPage, setLibraryPage] = useState(0);
  const libraryMatches = useMemo(
    () =>
      patternStarterCatalog.filter(
        (p) =>
          (collectionFilter === "All patterns" ||
            (collectionFilter === "Detailed compositions" && p.detailed) ||
            p.group === collectionFilter) &&
          (libraryPalette === "All colorways" ||
            p.palette === libraryPalette) &&
          `${p.name} ${p.group} ${p.description || ""} ${p.study || ""}`
            .toLowerCase()
            .includes(librarySearch.trim().toLowerCase()),
      ),
    [collectionFilter, libraryPalette, librarySearch],
  );
  const libraryPages = Math.max(1, Math.ceil(libraryMatches.length / 24));
  const pageIndex = Math.min(libraryPage, libraryPages - 1);
  useEffect(
    () => setLibraryPage(0),
    [collectionFilter, libraryPalette, librarySearch],
  );
  const [generator, setGenerator] = useState({
    seed: 17,
    style: "geometric",
    count: 12,
  });
  useEffect(() => {
    const root = document.querySelector(".pe-overlay"),
      previous = document.activeElement;
    root.querySelector("button:not(:disabled)")?.focus();
    const trap = (e) => {
      if (e.key !== "Tab") return;
      const nodes = [
        ...root.querySelectorAll("button,input,select,textarea"),
      ].filter((n) => !n.disabled && n.offsetParent !== null);
      const first = nodes[0],
        last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", trap);
    return () => {
      root.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  const [selection, setSelection] = useState(0),
    [tool, setTool] = useState("move"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [base, setBase] = useState(() =>
      !initial && (doc.presentation === "rug" || doc.library)
        ? "natural-cotton"
        : "current",
    );
  const previewTarget = useMemo(
    () => resolvePatternBase(currentMaterial, base),
    [currentMaterial, base],
  );
  const [past, setPast] = useState([]),
    [future, setFuture] = useState([]);
  const drag = useRef(null),
    input = useRef(null),
    svgInput = useRef(null),
    jsonInput = useRef(null);
  const l = doc.layers[selection];
  function commit(next) {
    try {
      const valid = validatePattern(next);
      const previous = docRef.current;
      docRef.current = valid;
      setPast((p) => [...p.slice(-31), previous]);
      setFuture([]);
      setDoc(valid);
      setError("");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  const update = (v) => commit({ ...doc, ...v });
  const layer = (v) =>
    commit({
      ...doc,
      layers: doc.layers.map((p, i) => (i === selection ? { ...p, ...v } : p)),
    });
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [doc, ...f]);
    setDoc(past.at(-1));
    setPast((p) => p.slice(0, -1));
    setSelection(0);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture((p) => p.slice(1));
    setSelection(0);
  };
  function add(kind, extra = {}) {
    const current = docRef.current;
    if (
      commit({
        ...current,
        layers: [...current.layers, patternLayer(kind, extra)],
      })
    )
      setSelection(current.layers.length);
  }
  const preview = useMemo(
    () =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patternSVG(doc))}`,
    [doc],
  );
  async function importFile(file, kind) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Import limit: 4 MB per file.");
      if (kind === "json") {
        const parsed = validatePattern(JSON.parse(await file.text()));
        commit(parsed);
        setSelection(0);
        return;
      }
      if (kind === "svg") {
        const clean = sanitizePatternSVG(await file.text());
        // Keep simple path-only imports directly editable; preserve grouped SVG sources.
        const xml = new DOMParser().parseFromString(clean, "image/svg+xml");
        const paths = xml.querySelectorAll("path");
        if (
          paths.length === 1 &&
          xml.documentElement.children.length === 1 &&
          !paths[0].hasAttribute("transform") &&
          (xml.documentElement.getAttribute("viewBox") || "") === "0 0 100 100"
        ) {
          add("path", {
            name: file.name,
            path: paths[0].getAttribute("d"),
            color:
              paths[0].getAttribute("stroke") ||
              paths[0].getAttribute("fill") ||
              "#dd765d",
            strokeWidth:
              paths[0].getAttribute("fill") === "none"
                ? Number(paths[0].getAttribute("stroke-width") || 1)
                : 0,
          });
        } else {
          add("svg", { name: file.name, svg: clean, width: 256, height: 256 });
        }
      } else {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error("Use PNG, JPEG, WebP or the SVG import button.");
        const url = URL.createObjectURL(file);
        try {
          const image = await patternImage(url),
            c = document.createElement("canvas");
          const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
          c.width = Math.round(image.width * scale);
          c.height = Math.round(image.height * scale);
          c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
          add("image", {
            name: file.name,
            src: c.toDataURL("image/png"),
            width: 200,
            height: (200 * image.height) / image.width,
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function pointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) * 512) / rect.width,
      ((e.clientY - rect.top) * 512) / rect.height,
    ];
  }
  function down(e) {
    const p = pointer(e);
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const handle = e.target.getAttribute("data-handle");
    if (handle && l) {
      drag.current = { doc, index: selection, start: p, handle };
      return;
    }
    if (tool === "pen") {
      if (doc.layers.length >= 64) {
        setError("A pattern supports up to 64 layers.");
        return;
      }
      drag.current = { doc, index: doc.layers.length, start: p, points: [p] };
      setDoc({
        ...doc,
        layers: [
          ...doc.layers,
          patternLayer("path", {
            name: "Drawn path",
            x: 256,
            y: 256,
            width: 512,
            height: 512,
            path: `M${p[0] / 5.12} ${p[1] / 5.12}`,
            strokeWidth: 1.4,
          }),
        ],
      });
      setSelection(doc.layers.length);
    } else {
      const hit = Number(
        e.target.closest("[data-layer]")?.getAttribute("data-layer"),
      );
      if (!Number.isFinite(hit) || !doc.layers[hit]) return;
      setSelection(hit);
      drag.current = { doc, index: hit, start: p };
    }
  }
  function motion(e) {
    const d = drag.current;
    if (!d) return;
    const p = pointer(e);
    if (d.handle) {
      const original = d.doc.layers[d.index],
        next =
          d.handle === "size"
            ? resizePatternLayer(original, p, {
                grid,
                aspect: aspect || e.shiftKey,
              })
            : rotatePatternLayer(original, d.start, p, e.shiftKey || !!grid);
      setDoc({
        ...d.doc,
        layers: d.doc.layers.map((l, i) => (i === d.index ? next : l)),
      });
      return;
    }
    if (tool === "pen") {
      if (d.points.length > 400) return;
      d.points.push(p);
      setDoc((current) => ({
        ...current,
        layers: current.layers.map((l, i) =>
          i === d.index
            ? {
                ...l,
                path: d.points
                  .map(
                    (p, j) =>
                      (j ? "L" : "M") +
                      (p[0] / 5.12).toFixed(2) +
                      " " +
                      (p[1] / 5.12).toFixed(2),
                  )
                  .join(" "),
              }
            : l,
        ),
      }));
    } else {
      setDoc({
        ...d.doc,
        layers: d.doc.layers.map((l, i) =>
          i === d.index
            ? movePatternLayer(l, [p[0] - d.start[0], p[1] - d.start[1]], grid)
            : l,
        ),
      });
    }
  }
  function up() {
    const completed = drag.current;
    if (!completed) return;
    setPast((p) => [...p.slice(-31), completed.doc]);
    setFuture([]);
    drag.current = null;
  }
  function shift(direction) {
    const target = selection + direction;
    if (target < 0 || target >= doc.layers.length) return;
    const arr = [...doc.layers];
    [arr[target], arr[selection]] = [arr[selection], arr[target]];
    commit({ ...doc, layers: arr });
    setSelection(target);
  }
  const field = (label, key, min, max, step = 1) => (
    <label className="pe-field" key={key}>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={l?.[key] ?? 0}
        onChange={(e) => layer({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div
      className="pe-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Pattern studio"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          e.stopPropagation();
          patternDownload(
            JSON.stringify(doc, null, 2),
            "pattern.json",
            "application/json",
          );
        }
        if (e.target.matches(".pe-canvas") && l) {
          const step = (grid || 1) * (e.shiftKey ? 10 : 1),
            delta = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            }[e.key];
          if (delta) {
            e.preventDefault();
            layer(movePatternLayer(l, delta, grid));
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            commit({
              ...doc,
              layers: doc.layers.filter((_, i) => i !== selection),
            });
            setSelection(Math.max(0, selection - 1));
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "z") {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
      }}
    >
      <header className="pe-header">
        <div>
          <span className="pe-kicker">ALLOY / SURFACE DESIGN</span>
          <h1>
            Pattern studio <span>01 — Compose</span>
          </h1>
        </div>
        <div className="pe-header-actions">
          <button onClick={undo} disabled={!past.length} title="Undo">
            <Undo2 size={16} />
          </button>
          <button onClick={redo} disabled={!future.length} title="Redo">
            <Redo2 size={16} />
          </button>
          <button
            onClick={() =>
              patternDownload(
                JSON.stringify(doc, null, 2),
                "pattern.json",
                "application/json",
              )
            }
          >
            Save document
          </button>
          <button
            className="pe-primary"
            disabled={busy}
            onClick={() => onApply(validatePattern(doc), base)}
          >
            Apply to material ↗
          </button>
          <button aria-label="Close pattern studio" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </header>
      <div className="pe-body">
        <aside className="pe-library">
          <span className="pe-kicker">START WITH A STRUCTURE</span>
          <button
            className="pe-wide pe-rich-library"
            onClick={() => {
              setCollectionFilter("Detailed compositions");
              setLibraryPalette("All colorways");
              setLibrarySearch("");
            }}
          >
            108 detailed compositions ↗
          </button>
          <select
            className="pe-collection-filter"
            aria-label="Pattern collection"
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
          >
            {libraryGroups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <input
            className="pe-library-search"
            type="search"
            aria-label="Search patterns"
            placeholder="Search weaves, stitches, checks…"
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
          />
          <select
            aria-label="Pattern colorway"
            value={libraryPalette}
            onChange={(e) => setLibraryPalette(e.target.value)}
          >
            {[
              "All colorways",
              "Original",
              "Designed composition",
              ...Object.keys(textilePalettes),
            ].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <p className="pe-library-count" aria-live="polite">
            {libraryMatches.length} results · {patternStarterCatalog.length - 1}{" "}
            presets + Blank
          </p>
          <div
            className="pe-starters"
            key={`${collectionFilter}-${libraryPalette}-${librarySearch}-${pageIndex}`}
          >
            {libraryMatches
              .slice(pageIndex * 24, pageIndex * 24 + 24)
              .map(({ name }) => (
                <button
                  key={name}
                  onClick={() => {
                    const next = patternStarter(name);
                    commit(next);
                    if (next.presentation === "rug" || !!next.library)
                      setBase("natural-cotton");
                    setSelection(0);
                  }}
                >
                  <StarterThumb name={name} />
                  <span>{name}</span>
                </button>
              ))}
          </div>
          {!libraryMatches.length && (
            <p className="pe-hint">
              No matches. Try another collection or colorway.
            </p>
          )}
          <div className="pe-library-paging">
            <button
              aria-label="Previous pattern page"
              disabled={pageIndex === 0}
              onClick={() => setLibraryPage(pageIndex - 1)}
            >
              ←
            </button>
            <span>
              Page {pageIndex + 1} / {libraryPages}
            </span>
            <button
              aria-label="Next pattern page"
              disabled={pageIndex + 1 >= libraryPages}
              onClick={() => setLibraryPage(pageIndex + 1)}
            >
              →
            </button>
          </div>
          <p className="pe-hint">
            108 detailed compositions, not recolors. Plus 54 textile families in
            4 colorways and the earlier starters. The original African Diamond
            Carpet is now rebuilt in detail.
          </p>
          <div className="pe-section">
            <h3>Generate a layout</h3>
            <select
              aria-label="Generator style"
              value={generator.style}
              onChange={(e) =>
                setGenerator({ ...generator, style: e.target.value })
              }
            >
              <option value="geometric">Geometric motifs</option>
              <option value="floral">Scattered flowers</option>
            </select>
            <div className="pe-grid">
              <label>
                Seed
                <input
                  aria-label="Layout seed"
                  type="number"
                  value={generator.seed}
                  onChange={(e) =>
                    setGenerator({ ...generator, seed: +e.target.value })
                  }
                />
              </label>
              <label>
                Motifs
                <input
                  aria-label="Layout count"
                  type="number"
                  min="2"
                  max="24"
                  value={generator.count}
                  onChange={(e) =>
                    setGenerator({ ...generator, count: +e.target.value })
                  }
                />
              </label>
            </div>
            <button
              className="pe-wide"
              onClick={() => {
                commit(generatePatternLayout(generator));
                setSelection(0);
              }}
            >
              Generate pattern
            </button>
            <h3 style={{ marginTop: 24 }}>Draw & import</h3>
            <div className="pe-shapes">
              {["rect", "ellipse", "diamond", "triangle", "flower", "path"].map(
                (kind) => (
                  <button
                    key={kind}
                    onClick={() =>
                      add(
                        kind,
                        kind === "path"
                          ? { path: "M10 80 Q50 0 90 80", strokeWidth: 3 }
                          : {},
                      )
                    }
                  >
                    <Plus size={12} />
                    {kind}
                  </button>
                ),
              )}
            </div>
            <button
              className="pe-wide"
              onClick={() => input.current.click()}
              disabled={busy}
            >
              <Upload size={14} /> Import image
            </button>
            <button
              className="pe-wide"
              onClick={() => svgInput.current.click()}
              disabled={busy}
            >
              <Upload size={14} /> Import SVG
            </button>
            <button
              className="pe-wide"
              onClick={() => jsonInput.current.click()}
              disabled={busy}
            >
              Open document
            </button>
            <input
              hidden
              type="file"
              ref={input}
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                importFile(e.target.files[0], "image");
                e.target.value = "";
              }}
            />
            <input
              hidden
              type="file"
              ref={svgInput}
              accept=".svg"
              onChange={(e) => {
                importFile(e.target.files[0], "svg");
                e.target.value = "";
              }}
            />
            <input
              hidden
              type="file"
              ref={jsonInput}
              accept=".json"
              onChange={(e) => {
                importFile(e.target.files[0], "json");
                e.target.value = "";
              }}
            />
            <p className="pe-hint">
              Simple 100 × 100 SVG paths stay editable. Other supported SVG
              groups retain their vector source. No scripts, fonts or linked
              files.
            </p>
          </div>
          <div className="pe-section">
            <h3>
              <Layers3 size={14} /> Layers <small>{doc.layers.length}/64</small>
            </h3>
            <div className="pe-layers">
              {doc.layers
                .map((p, i) => (
                  <button
                    key={i}
                    className={selection === i ? "selected" : ""}
                    onClick={() => setSelection(i)}
                  >
                    <span style={{ background: p.color }} />
                    {p.name}
                    <small>{p.finish}</small>
                  </button>
                ))
                .reverse()}
            </div>
          </div>
        </aside>
        <main className="pe-workspace">
          <div className="pe-mode-switch" role="group" aria-label="Editor view">
            <button
              aria-pressed={mode === "design"}
              onClick={() => setMode("design")}
            >
              Design tile
            </button>
            <button
              aria-pressed={mode === "material"}
              onClick={() => setMode("material")}
            >
              3D material
            </button>
            <span>
              Same shader as the workspace · updates after editing pauses
            </span>
          </div>
          <div className="pe-canvas-heading">
            <div>
              <span className="pe-kicker">
                {doc.tileAxes === "none"
                  ? "FINITE RUG / 512 UNITS"
                  : doc.tileAxes === "xy"
                    ? "REPEAT TILE / 512 UNITS"
                    : "ONE-WAY BORDER / 512 UNITS"}
              </span>
              <input
                aria-label="Pattern name"
                value={doc.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>
            <div
              className="pe-tools"
              style={{ visibility: mode === "design" ? "visible" : "hidden" }}
            >
              <button
                className={tool === "move" ? "selected" : ""}
                onClick={() => setTool("move")}
                title="Move shapes"
              >
                <Move size={17} />
              </button>
              <button
                className={tool === "pen" ? "selected" : ""}
                onClick={() => setTool("pen")}
                title="Draw path"
              >
                <PenLine size={17} />
              </button>
            </div>
          </div>
          {mode === "material" ? (
            <PatternMaterialPreview
              doc={doc}
              target={previewTarget}
              initialShape={base === "current" ? currentShape : undefined}
            />
          ) : (
            <>
              <div className="pe-layout-tools">
                <label>
                  Snap
                  <select
                    aria-label="Grid snapping"
                    value={grid}
                    onChange={(e) => setGrid(+e.target.value)}
                  >
                    <option value="0">Off</option>
                    <option value="8">8 units</option>
                    <option value="16">16 units</option>
                    <option value="32">32 units</option>
                  </select>
                </label>
                <label className="pe-check">
                  <input
                    type="checkbox"
                    checked={aspect}
                    onChange={(e) => setAspect(e.target.checked)}
                  />{" "}
                  Keep aspect ratio
                </label>
                <small>
                  Drag corner to resize · circle to rotate · Shift constrains
                </small>
              </div>
              <div className="pe-canvas-wrap">
                <svg
                  className="pe-canvas"
                  tabIndex={0}
                  role="group"
                  viewBox="0 0 512 512"
                  aria-label="Pattern design canvas"
                  onPointerDown={down}
                  onPointerMove={motion}
                  onPointerUp={up}
                  onPointerCancel={up}
                >
                  <rect
                    width="512"
                    height="512"
                    fill={doc.background}
                    opacity={doc.backgroundOpacity}
                  />
                  {grid > 0 && (
                    <>
                      <defs>
                        <pattern
                          id="editor-grid"
                          width={grid}
                          height={grid}
                          patternUnits="userSpaceOnUse"
                        >
                          <path
                            d={`M${grid} 0H0V${grid}`}
                            fill="none"
                            stroke="#667c73"
                            strokeWidth=".5"
                            opacity=".4"
                          />
                        </pattern>
                      </defs>
                      <rect
                        width="512"
                        height="512"
                        fill="url(#editor-grid)"
                        pointerEvents="none"
                      />
                    </>
                  )}
                  {doc.layers.map(
                    (p, i) =>
                      p.visible && (
                        <g
                          key={i}
                          data-layer={i}
                          opacity={p.opacity}
                          transform={`translate(${p.x} ${p.y}) rotate(${p.rotation}) scale(${(p.width / 100) * (p.flipX ? -1 : 1)} ${(p.height / 100) * (p.flipY ? -1 : 1)}) translate(-50 -50)`}
                          dangerouslySetInnerHTML={{
                            __html: patternShape(p, p.color),
                          }}
                        />
                      ),
                  )}
                  {l && (
                    <g transform={`rotate(${l.rotation} ${l.x} ${l.y})`}>
                      <rect
                        pointerEvents="none"
                        x={l.x - l.width / 2}
                        y={l.y - l.height / 2}
                        width={l.width}
                        height={l.height}
                        fill="none"
                        stroke="#aee3a5"
                        strokeWidth="1.5"
                        strokeDasharray="5 4"
                      />
                      <path
                        pointerEvents="none"
                        d={`M${l.x} ${l.y - l.height / 2}v-20`}
                        stroke="#aee3a5"
                      />
                      <circle
                        data-handle="rotate"
                        aria-label="Rotate selected motif"
                        cx={l.x}
                        cy={l.y - l.height / 2 - 24}
                        r="6"
                        fill="#c4e2b5"
                        stroke="#23372a"
                        style={{ cursor: "grab" }}
                      />
                      <rect
                        data-handle="size"
                        aria-label="Resize selected motif"
                        x={l.x + l.width / 2 - 6}
                        y={l.y + l.height / 2 - 6}
                        width="12"
                        height="12"
                        fill="#c4e2b5"
                        stroke="#23372a"
                        style={{ cursor: "nwse-resize" }}
                      />
                    </g>
                  )}
                </svg>
              </div>
            </>
          )}
          <div className="pe-repeat-heading">
            <span>02 — Repeat inspection</span>
            <small>
              {doc.tileAxes === "xy"
                ? "Edges wrap automatically • drag motifs across boundaries"
                : doc.tileAxes === "none"
                  ? "Finite rug composition • edges do not wrap"
                  : "One-way border • repeat across the fade only"}
            </small>
          </div>
          <div
            className="pe-repeat"
            aria-label="Repeated pattern preview"
            style={{
              backgroundImage: `url("${preview}")`,
              backgroundPosition: "center",
              backgroundRepeat:
                doc.tileAxes === "none"
                  ? "no-repeat"
                  : doc.tileAxes === "x"
                    ? "repeat-x"
                    : doc.tileAxes === "y"
                      ? "repeat-y"
                      : "repeat",
              backgroundSize:
                doc.tileAxes === "none"
                  ? "contain"
                  : doc.tileAxes !== "xy"
                    ? "160px 160px"
                    : doc.repeat === "mirror"
                      ? "240px 240px"
                      : doc.repeat === "half-drop"
                        ? "240px 120px"
                        : "120px 120px",
            }}
          />
          {error && (
            <p className="pe-error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">Preparing embedded source…</p>}
        </main>
        <aside className="pe-inspector">
          <RugCompositionControls
            doc={doc}
            commit={commit}
            onError={setError}
          />
          <PatternTextileTools doc={doc} commit={commit} onError={setError} />

          {doc.fade && (
            <div className="pe-section pe-fade-controls">
              <span className="pe-kicker">GEOMETRIC FADING</span>
              <p className="pe-hint">
                Motifs grow from separated marks into a connected lattice. Color
                stays opaque.
              </p>
              <label>
                Fade direction
                <select
                  aria-label="Fade direction"
                  value={doc.fade.direction}
                  onChange={(e) =>
                    commit(
                      rebuildCollectionFade(doc, { direction: e.target.value }),
                    )
                  }
                >
                  <option value="down">Small → large, downward</option>
                  <option value="up">Small → large, upward</option>
                  <option value="right">Small → large, rightward</option>
                  <option value="left">Small → large, leftward</option>
                </select>
              </label>
              {[
                ["columns", "Motif density", 4, 22, 1],
                ["strength", "Fade strength", 0.3, 3, 0.1],
                ["minimum", "Smallest motif", 0, 0.6, 0.01],
                ["gap", "Lattice gap", 0.01, 0.35, 0.01],
                ["start", "Fade start", 0, 0.9, 0.01],
                ["end", "Fade end", 0.1, 1, 0.01],
              ].map(([key, label, min, max, step]) => (
                <label key={key}>
                  {label}
                  <div className="pe-fade-range">
                    <input
                      aria-label={label}
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={doc.fade[key]}
                      onChange={(e) =>
                        commit(
                          rebuildCollectionFade(doc, {
                            [key]: +e.target.value,
                          }),
                        )
                      }
                    />
                    <output>{doc.fade[key]}</output>
                  </div>
                </label>
              ))}
              <label className="pe-check">
                <input
                  type="checkbox"
                  aria-label="Loop fade seamlessly"
                  checked={doc.fade.loop}
                  onChange={(e) =>
                    commit(
                      rebuildCollectionFade(doc, { loop: e.target.checked }),
                    )
                  }
                />{" "}
                Loop fade seamlessly
              </label>
              <p className="pe-hint">
                {doc.fade.loop
                  ? "Mirrored density envelope: repeats on both axes."
                  : "One-way border: repeats across the fade, not along it. The terminal edges are clamped in 3D."}{" "}
                Geometry controls regenerate the facet layers; existing colors
                and finishes are retained.
              </p>
            </div>
          )}

          <div className="pe-section">
            <span className="pe-kicker">03 — SURFACE & REPEAT</span>
            <label>
              Apply on
              <select
                aria-label="Pattern base material"
                value={base}
                onChange={(e) => setBase(e.target.value)}
              >
                <option value="current">Current material</option>
                <option value="pottery">Glazed pottery / teapot</option>
                <option value="natural-cotton">Cotton / rug backing</option>
                <option value="plain-linen">Linen</option>
                <option value="porcelain-grid-tiles">Porcelain tiles</option>
              </select>
            </label>
            <label>
              Repeat layout
              <select
                aria-label="Repeat layout"
                disabled={doc.tileAxes !== "xy"}
                value={doc.repeat}
                onChange={(e) => update({ repeat: e.target.value })}
              >
                <option value="straight">Straight</option>
                <option value="half-drop">Half drop</option>
                <option value="mirror">Mirrored</option>
              </select>
            </label>
            <label>
              Mapping
              <select
                value={doc.mapping}
                onChange={(e) => update({ mapping: e.target.value })}
              >
                <option value="uv">Mesh UV — fabrics / decoration</option>
                <option value="object">Object projection</option>
                <option value="cylinder">Cylindrical — pottery</option>
              </select>
            </label>
            <div className="pe-grid">
              <label>
                Repeats
                <input
                  aria-label="Pattern repeats"
                  type="number"
                  min=".25"
                  max="24"
                  step=".25"
                  value={doc.repeats}
                  onChange={(e) => update({ repeats: +e.target.value })}
                />
              </label>
              <label>
                Rotation
                <input
                  aria-label="Pattern rotation"
                  type="number"
                  min="-180"
                  max="180"
                  value={doc.rotation}
                  onChange={(e) => update({ rotation: +e.target.value })}
                />
              </label>
            </div>
            <label className="pe-color">
              Ground color
              <input
                aria-label="Pattern ground color"
                type="color"
                value={doc.background}
                onChange={(e) => update({ background: e.target.value })}
              />
            </label>
            <label className="pe-check">
              <input
                type="checkbox"
                checked={!doc.backgroundOpacity}
                onChange={(e) =>
                  update({ backgroundOpacity: e.target.checked ? 0 : 1 })
                }
              />{" "}
              Transparent ground / decal
            </label>
          </div>
          {l && (
            <div className="pe-section">
              <h3>Selected motif</h3>
              <input
                aria-label="Layer name"
                value={l.name}
                onChange={(e) => layer({ name: e.target.value })}
              />
              <div className="pe-grid">
                {field("X", "x", -512, 1024)}
                {field("Y", "y", -512, 1024)}
                {field("Width", "width", 1, 1024)}
                {field("Height", "height", 1, 1024)}
                {field("Angle", "rotation", -360, 360)}
                {field("Opacity", "opacity", 0, 1, 0.05)}
              </div>
              {!["image", "svg"].includes(l.kind) ? (
                <>
                  {" "}
                  <label className="pe-color">
                    Dye color
                    <input
                      aria-label="Motif color"
                      type="color"
                      value={l.color}
                      onChange={(e) => layer({ color: e.target.value })}
                    />
                  </label>
                </>
              ) : (
                <p className="pe-hint">
                  Original image/SVG colors retained. Edit SVG source to change
                  its palette.
                </p>
              )}

              <label>
                Material assignment
                <select
                  aria-label="Motif material"
                  value={l.finish}
                  onChange={(e) => {
                    const f = patternFinishes[e.target.value];
                    layer({
                      finish: e.target.value,
                      roughness: f.roughness,
                      metalness: f.metalness,
                      relief: f.height,
                    });
                  }}
                >
                  {Object.entries(patternFinishes).map(([k, f]) => (
                    <option key={k} value={k}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="pe-wide"
                onClick={() =>
                  commit({
                    ...doc,
                    layers: doc.layers.map((p) => ({
                      ...p,
                      finish: l.finish,
                      roughness: l.roughness,
                      metalness: l.metalness,
                      relief: l.relief,
                    })),
                  })
                }
              >
                Assign this finish to all motifs
              </button>
              <div className="pe-grid">
                {field("Roughness", "roughness", 0.05, 1, 0.01)}
                {field("Metalness", "metalness", 0, 1, 0.05)}
                {field("Relief (mm)", "relief", -1, 1, 0.01)}
                {!["image", "svg"].includes(l.kind) &&
                  field("Stroke width", "strokeWidth", 0, 25, 0.1)}
              </div>
              {l.kind === "svg" && (
                <label>
                  SVG source
                  <textarea
                    key={selection}
                    aria-label="SVG source"
                    defaultValue={l.svg}
                    onBlur={(e) => layer({ svg: e.target.value })}
                  />
                </label>
              )}
              {l.kind === "path" && (
                <label>
                  SVG path · local 0–100
                  <textarea
                    aria-label="SVG path"
                    value={l.path}
                    onChange={(e) => layer({ path: e.target.value })}
                  />
                </label>
              )}
              <div className="pe-section">
                <h3>Arrange & reflect</h3>
                <div className="pe-shapes">
                  <button onClick={() => layer({ x: 256 })}>Center X</button>
                  <button onClick={() => layer({ y: 256 })}>Center Y</button>
                  <button
                    aria-pressed={l.flipX}
                    onClick={() => layer({ flipX: !l.flipX })}
                  >
                    Flip X
                  </button>
                  <button
                    aria-pressed={l.flipY}
                    onClick={() => layer({ flipY: !l.flipY })}
                  >
                    Flip Y
                  </button>
                  <button
                    onClick={() => add(l.kind, reflectPatternLayer(l, "x"))}
                  >
                    Reflect copy X
                  </button>
                  <button
                    onClick={() => add(l.kind, reflectPatternLayer(l, "y"))}
                  >
                    Reflect copy Y
                  </button>
                </div>
                <div className="pe-grid">
                  <label>
                    Copies
                    <input
                      aria-label="Radial copies"
                      type="number"
                      min="2"
                      max="12"
                      value={ring.count}
                      onChange={(e) =>
                        setRing({ ...ring, count: +e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Radius
                    <input
                      aria-label="Radial radius"
                      type="number"
                      min="0"
                      max="256"
                      value={ring.radius}
                      onChange={(e) =>
                        setRing({ ...ring, radius: +e.target.value })
                      }
                    />
                  </label>
                </div>
                <button
                  className="pe-wide"
                  onClick={() =>
                    commit({
                      ...doc,
                      layers: doc.layers.flatMap((p, i) =>
                        i === selection
                          ? radialPatternLayers(p, ring.count, ring.radius)
                          : [p],
                      ),
                    })
                  }
                >
                  Arrange in a ring
                </button>
              </div>
              <label className="pe-check">
                <input
                  type="checkbox"
                  checked={l.visible}
                  onChange={(e) => layer({ visible: e.target.checked })}
                />{" "}
                Visible
              </label>
              <div className="pe-tools">
                <button
                  title="Duplicate motif"
                  onClick={() =>
                    add(l.kind, { ...l, x: l.x + 18, y: l.y + 18 })
                  }
                >
                  <Copy size={15} />
                </button>
                <button title="Bring forward" onClick={() => shift(1)}>
                  <ArrowUp size={15} />
                </button>
                <button title="Send backward" onClick={() => shift(-1)}>
                  <ArrowDown size={15} />
                </button>
                <button
                  title="Delete motif"
                  onClick={() => {
                    commit({
                      ...doc,
                      layers: doc.layers.filter((_, i) => i !== selection),
                    });
                    setSelection(Math.max(0, selection - 1));
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )}
          <div className="pe-section">
            <button
              className="pe-wide"
              onClick={() =>
                patternDownload(patternSVG(doc), "pattern.svg", "image/svg+xml")
              }
            >
              <Download size={14} />{" "}
              {doc.tileAxes === "none"
                ? "Export rug SVG"
                : doc.tileAxes === "xy"
                  ? "Export seamless SVG"
                  : "Export border SVG"}
            </button>
            <button
              className="pe-wide"
              onClick={() =>
                patternDownload(
                  leatherSourceSVG(),
                  "leather-source.svg",
                  "image/svg+xml",
                )
              }
            >
              Export leather source SVG
            </button>
            <p className="pe-hint">
              Vector shapes stay sharp in SVG. Live rendering samples 1024–2048
              px maps. Material slots affect color, relief, roughness, metalness
              and finish. Bake six channels from Export material.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

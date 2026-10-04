import {
  Tools,
  Examples,
  Escape,
  NativeName,
  ConstructCommand,
} from "./CommandSpecification.js";
const Select = (Selector) => document.querySelector(Selector);
const All = (Selector) => [...document.querySelectorAll(Selector)];
const Paths = {
  body: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10L3 7m9 5 9-5m-9 5v10M7 4.5l10 5.5"/>',
  surface: '<path d="m3 8 12-5 6 13-12 5Z"/>',
  cylinder:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5"/>',
  sphere:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  curve:
    '<path d="M3 18C3-4 21 28 21 6"/><circle cx="3" cy="18" r="2"/><circle cx="21" cy="6" r="2"/>',
  ring: '<ellipse cx="12" cy="12" rx="10" ry="7"/><ellipse cx="12" cy="12" rx="5" ry="3"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  edge: '<path d="m4 20 16-16"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/>',
  points:
    '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 13h8m-8 4h6"/>',
  folder: '<path d="M3 6h7l2 3h9l-2 11H3V6Zm0 3h18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3m0 3h.01"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  rows: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  link: '<path d="m10 14 4-4m-6 2-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-10 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>',
  shield: '<path d="m12 2 8 4v7c0 6-8 9-8 9S4 19 4 13V6Zm-4 10 3 3 5-6"/>',
  viewport: '<rect x="3" y="4" width="18" height="16" rx="2"/>',
  focus:
    '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
  maximize: '<path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7"/>',
  undo: '<path d="M4 9h10a7 7 0 0 1 0 14M4 3v6h6"/>',
  redo: '<path d="M20 9H10a7 7 0 0 0 0 14m10-20v6h-6"/>',
  terminal: '<path d="m4 6 6 6-6 6m9 0h7"/>',
  inspect:
    '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6m-3-3h6"/>',
  construct: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="8"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>',
  eye: '<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M9 5c5-2 10 1 13 7l-4 5M6 6l-4 6c3 6 8 9 14 6"/>',
  extrude: '<path d="m3 14 9 5 9-5-9-5Zm0 0V8l9-5 9 5v6m-9-5V3m0 16v-6"/>',
  rotate: '<path d="M4 10a8 8 0 1 1 1 7M4 3v7h7"/>',
  fillet: '<path d="M4 21v-8a9 9 0 0 1 9-9h8M4 4v3m0-3h3"/>',
  chamfer: '<path d="M4 21V12l8-8h9M4 4v3m0-3h3"/>',
  move: '<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
  union: '<path d="M3 5h11v5h7v11H10v-5H3Z"/>',
  subtract:
    '<path d="M3 3h13v7H10v6H3Z"/><path d="M14 10h7v11H10v-3" stroke-dasharray="2 2"/>',
  intersect:
    '<rect x="3" y="3" width="13" height="13"/><rect x="10" y="10" width="11" height="11"/>',
  cage: '<path d="m3 3 18 4-3 14L3 17Zm0 0 15 18M3 17 21 7M3 10l17 4M10 5l-1 14"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
const Icon = (Name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${Paths[Name] || Paths.body}</svg>`;
const FigureIcon = (Figure) =>
  ["curve", "surface", "body", "points"][Figure.classification];
const Classification = (Figure) =>
  ["Sketch curve", "NURBS surface", "Solid body", "Reference"][
    Figure.classification
  ];
const Decimal = (NumberValue) => Number(NumberValue.toFixed(3)).toString();
const Download = (Text, Name, Type = "text/plain") => {
  const Url = URL.createObjectURL(new Blob([Text], { type: Type }));
  const Link = document.createElement("a");
  Link.href = Url;
  Link.download = Name;
  Link.click();
  setTimeout(() => URL.revokeObjectURL(Url), 2000);
};

class WorkspacePanel {
  constructor() {
    this.Documents = [];
    this.Active = 0;
    this.Description = { figures: [], dimensions: [], history: [] };
    this.Filter = "all";
    this.Token = 0;
    this.Pending = new Map();
    this.Busy = false;
    this.Ready = false;
    this.Log = [];
    All("[data-icon]").forEach(
      (Element) => (Element.innerHTML = Icon(Element.dataset.icon)),
    );
    this.Worker = new Worker(
      new URL("./GeometrySequence.js", import.meta.url),
      { type: "module" },
    );
    this.Worker.onmessage = (Event) => this.Receive(Event.data);
    this.Worker.onerror = (Event) =>
      this.Fail(
        Event.message ||
          "The browser could not load the native module. Reload to retry.",
      );
    this.ConnectInterface();
    this.ConstructLibrary();
    new ResizeObserver(() => {
      clearTimeout(this.ResizeTimer);
      this.ResizeTimer = setTimeout(() => {
        if (this.Ready) {
          this.ResolveDetail = true;
          this.FlushNavigation?.();
        }
      }, 180);
    }).observe(Select("#viewport"));
    window.addEventListener("beforeunload", (Event) => {
      if (this.Documents.some((Document) => Document.dirty)) {
        Event.preventDefault();
        Event.returnValue = "";
      }
    });
  }
  Receive(Response) {
    if (Response.fatal) {
      this.Fail(Response.fatal);
      return;
    }
    if (Response.ready) {
      this.Ready = true;
      this.CreateDocument("mount");
      return;
    }
    const Pending = this.Pending.get(Response.token);
    if (!Pending) return;
    this.Pending.delete(Response.token);
    this.Busy = false;
    Select("#app").classList.remove("busy");
    if (Response.lines?.length) this.AppendLog(Response.lines);
    if (Response.error) {
      Pending.reject(new Error(Response.error));
      this.Fail(Response.error);
      return;
    }
    this.Description = Response.description;
    const Canvas = Select("#cad-canvas");
    Canvas.width = Response.width;
    Canvas.height = Response.height;
    Canvas.getContext("2d").putImageData(
      new ImageData(
        new Uint8ClampedArray(Response.pixels),
        Response.width,
        Response.height,
      ),
      0,
      0,
    );
    Select("#render-duration").textContent =
      `${Math.round(Response.duration)} ms · CPU raster`;
    Select("#kernel-status").innerHTML = "<i></i>Native kernel ready";
    this.Refresh();
    if (this.RenameTarget) {
      if (this.Picked[0]?.id === this.RenameTarget) {
        Select("#figure-name")?.focus();
        Select("#figure-name")?.select();
      }
      this.RenameTarget = null;
    }
    Pending.resolve(Response);
    queueMicrotask(() => this.FlushNavigation?.());
  }
  Fail(Message) {
    this.Busy = false;
    this.Ready = false;
    Select("#app").classList.remove("busy");
    Select("#loading-overlay").hidden = false;
    Select("#loading-overlay").innerHTML =
      `${Icon("help")}<h3>Kernel unavailable</h3><p>${Escape(Message)}</p><button class="button" id="retry-load">Reload browser kernel</button>`;
    Select("#retry-load").onclick = () => location.reload();
    Select("#kernel-status").textContent = "Kernel unavailable";
    for (const Pending of this.Pending.values())
      Pending.reject(new Error(Message));
    this.Pending.clear();
  }
  Request(Action, Payload = {}) {
    if (this.Busy || !this.Ready)
      return Promise.reject(
        new Error("Wait for the current native operation to finish."),
      );
    const Rectangle = Select("#viewport").getBoundingClientRect();
    const Scale =
      Math.min(1, 1000 / Rectangle.width, 900 / Rectangle.height) *
      (["orbit", "pan", "zoom"].includes(Action) ? 0.6 : 1);
    const Token = ++this.Token;
    this.Busy = true;
    Select("#app").classList.add("busy");
    Select("#kernel-status").textContent = "Computing geometry…";
    return new Promise((resolve, reject) => {
      this.Pending.set(Token, { resolve, reject });
      this.Worker.postMessage({
        token: Token,
        action: Action,
        identity: this.Active,
        width: Math.max(64, Math.round(Rectangle.width * Scale)),
        height: Math.max(64, Math.round(Rectangle.height * Scale)),
        ...Payload,
      });
    });
  }
  async Command(Text, Dirty = true) {
    if (this.Busy || !this.Ready) return;
    const Commands = Array.isArray(Text) ? Text : [Text];
    this.AppendLog(Commands.map((Command) => `› ${Command}`));
    const Response = await this.Request("command", { commands: Commands });
    if (Dirty && this.Document) this.Document.dirty = true;
    this.RefreshTabs();
    if (!Response.success) {
      Select("#console-panel").hidden = false;
      this.Notify(
        "The native kernel refused this operation. See the command log.",
      );
    }
    return Response;
  }
  get Document() {
    return this.Documents.find((Document) => Document.id === this.Active);
  }
  get Picked() {
    return this.Description.figures.filter(
      (Figure) =>
        Figure.selected ||
        Figure.pickedFaces.length ||
        Figure.pickedEdges.length,
    );
  }
  get SelectedRegions() {
    return (this.Description.areas || []).filter((Region) => Region.selected);
  }
  get ToolSelection() {
    if (["extrude", "loft"].includes(this.Tool) && this.SelectedRegions.length)
      return [
        ...this.Picked,
        ...this.SelectedRegions.map((Region) => ({
          id: `a${Region.id}`,
          classification: 0,
          pickedFaces: [],
          pickedEdges: [],
        })),
      ];
    return this.Picked;
  }
  async CreateDocument(Example = null) {
    if (this.Busy || !this.Ready) return;
    if (this.Documents.length >= 4) {
      this.Notify(
        "Save and close a tab before opening another. Four live documents maximum.",
      );
      return;
    }
    const Response = await this.Request("create");
    this.Active = Response.description.identity;
    this.Documents.push({
      id: this.Active,
      name: Examples[Example]?.name || "Untitled",
      dirty: false,
      edges: true,
      cages: false,
      dimensions: false,
    });
    this.Filter = "all";
    Select("#scene-search").value = "";
    Select("#loading-overlay").hidden = true;
    if (Example)
      await this.Command(
        ["gizmo off", "show shading matcap", ...Examples[Example].commands],
        false,
      );
    else
      await this.Command(
        [
          "gizmo off",
          "show shading matcap",
          "show cages off",
          "dim off",
          "view iso",
        ],
        false,
      );
    this.Refresh();
  }
  async ActivateDocument(Identity) {
    if (Identity === this.Active || this.Busy) return;
    this.Active = Identity;
    this.Filter = "all";
    Select("#scene-search").value = "";
    await this.Request("render");
  }
  async CloseDocument(Identity) {
    if (this.Busy || this.Documents.length === 1) return;
    const Document = this.Documents.find(
      (Document) => Document.id === Identity,
    );
    if (
      Document.dirty &&
      !confirm(`Close “${Document.name}” and discard unsaved changes?`)
    )
      return;
    if (this.Active === Identity)
      this.Active = this.Documents.find(
        (Document) => Document.id !== Identity,
      ).id;
    await this.Request("close", { closeIdentity: Identity });
    this.Documents = this.Documents.filter(
      (Document) => Document.id !== Identity,
    );
    this.Refresh();
  }
  RefreshTabs() {
    const Signature = this.Documents.map((Document) => Document.id).join(",");
    if (Signature !== this.TabSignature) {
      this.TabSignature = Signature;
      Select("#document-tabs").innerHTML = this.Documents.map(
        (Document) =>
          `<div class="document-tab" role="tab" tabindex="0" data-document="${Document.id}">${Icon("body")}<span class="document-label"></span><input class="document-rename" aria-label="Rename document" maxlength="64" hidden/><i class="tab-dirty"></i><button class="tab-close" data-close="${Document.id}" aria-label="Close document">${Icon("close")}</button></div>`,
      ).join("");
    }
    for (const Document of this.Documents) {
      const Tab = Select(`[data-document="${Document.id}"]`);
      Tab.classList.toggle("active", Document.id === this.Active);
      Tab.setAttribute("aria-selected", String(Document.id === this.Active));
      Tab.querySelector(".document-label").textContent = `${Document.name}.arc`;
      Tab.querySelector(".tab-dirty").hidden = !Document.dirty;
      Tab.querySelector(".tab-close").disabled = this.Documents.length === 1;
    }
    Select("#document-title").textContent = this.Document?.name || "SolidArc";
    Select("#dirty-indicator").hidden = !this.Document?.dirty;
  }
  Refresh() {
    this.RefreshTabs();
    this.RefreshRows();
    this.RefreshInspector();
    const Figures = this.Description.figures;
    Select("#scene-count").textContent = `Scene · ${Figures.length} figures`;
    Select("#body-count").textContent = Figures.filter(
      (Figure) => Figure.classification === 2,
    ).length;
    Select("#sketch-count").textContent = Figures.filter(
      (Figure) => Figure.classification === 0,
    ).length;
    Select("#geometry-stats").textContent =
      `${Figures.reduce((Sum, Figure) => Sum + Figure.faces, 0)} faces · ${Figures.reduce((Sum, Figure) => Sum + Figure.edges, 0)} edges`;
    Select("#undo-button").disabled = !this.Description.undo;
    Select("#redo-button").disabled = !this.Description.redo;
    Select("#selection-caption").textContent = this.Picked.length
      ? `${this.Picked.length} selected · ${this.Picked[0].name}`
      : this.SelectedRegions.length
        ? `${this.SelectedRegions.length} sketch region selected`
        : "Nothing selected";
    Select("#history-count").textContent =
      `${this.Description.history.length} steps`;
    Select("#history-strip").innerHTML =
      this.Description.history
        .slice(-16)
        .map(
          (Text, Index) =>
            `<div class="history-step" title="${Escape(Text)}"><span>${String(Math.max(1, this.Description.history.length - 15) + Index).padStart(2, "0")}</span>${Icon(Paths[Text.split(" ")[0]] ? Text.split(" ")[0] : "body")}<small>${Escape(Text.split(" ")[0])}</small></div>`,
        )
        .join("") ||
      '<p class="empty-note">Construction steps appear here as you create geometry.</p>';
    const Modes = { 1: "control", 2: "edge", 3: "face", 4: "whole" };
    All("[data-mode]").forEach((Button) =>
      Button.classList.toggle(
        "active",
        Button.dataset.mode === Modes[this.Description.mode],
      ),
    );
    const Camera = this.Description.camera;
    if (Camera) {
      const Views = {
        iso: [-Math.PI / 4, Math.atan(1 / Math.sqrt(2))],
        front: [0, 0],
        back: [Math.PI, 0],
        right: [Math.PI / 2, 0],
        top: [0, Math.PI / 2 - 0.0001],
      };
      Select("#camera-view").value =
        Object.keys(Views).find(
          (Key) =>
            Math.abs(Camera.yaw - Views[Key][0]) < 0.00001 &&
            Math.abs(Camera.pitch - Views[Key][1]) < 0.00001,
        ) || "orbit";
    }
    Select("#projection-button").textContent = this.Description.camera
      ?.orthographic
      ? "Orthographic"
      : "Perspective";
    for (const Key of ["edges", "cages"]) {
      Select(`#${Key}-button`).classList.toggle(
        "active",
        !!this.Document?.[Key],
      );
      Select(`#${Key}-button`).setAttribute(
        "aria-pressed",
        String(!!this.Document?.[Key]),
      );
    }
  }
  RefreshRows() {
    const Query = Select("#scene-search").value.toLowerCase();
    const Figures = this.Description.figures.filter(
      (Figure) =>
        (this.Filter === "all" ||
          String(Figure.classification) === this.Filter) &&
        Figure.name.toLowerCase().includes(Query),
    );
    const Signature = JSON.stringify(
      Figures.map((Figure) => [
        Figure.id,
        Figure.name,
        Figure.hidden,
        Figure.classification,
      ]),
    );
    if (Signature !== this.RowSignature) {
      this.RowSignature = Signature;
      Select("#scene-rows").innerHTML =
        Figures.map(
          (Figure) =>
            `<div class="scene-row" role="treeitem" tabindex="0" data-figure="${Figure.id}"><span class="figure-icon colour-${Figure.classification}">${Icon(FigureIcon(Figure))}</span><span class="figure-name">${Escape(Figure.name)}</span><small>${["CURVE", "SURFACE", "BODY", "REF"][Figure.classification]}</small><button data-visibility="${Figure.id}" class="visibility-button" title="${Figure.hidden ? "Show" : "Hide"} ${Escape(Figure.name)}" aria-label="${Figure.hidden ? "Show" : "Hide"} ${Escape(Figure.name)}">${Icon(Figure.hidden ? "hidden" : "eye")}</button></div>`,
        ).join("") ||
        '<p class="empty-note">No matching geometry.<br/>Construct a shape or open a document.</p>';
    }
    for (const Figure of Figures) {
      const Row = Select(`[data-figure="${Figure.id}"]`);
      Row.classList.toggle(
        "selected",
        !!Figure.selected ||
          !!Figure.pickedFaces.length ||
          !!Figure.pickedEdges.length,
      );
      Row.classList.toggle("hidden-figure", !!Figure.hidden);
      Row.setAttribute(
        "aria-selected",
        String(
          !!Figure.selected ||
            !!Figure.pickedFaces.length ||
            !!Figure.pickedEdges.length,
        ),
      );
    }
    All("[data-filter]").forEach((Button) =>
      Button.classList.toggle("active", Button.dataset.filter === this.Filter),
    );
  }
  RefreshInspector() {
    const Figure = this.Picked[0];
    if (!Figure && this.SelectedRegions.length) {
      const Region = this.SelectedRegions[0];
      Select("#inspector-body").innerHTML =
        `<section class="inspector-card intro-card">${Icon("surface")}<h2>Sketch region a${Region.id}</h2><p>${Decimal(Region.area)} m² · ${Region.holes} inner loops</p><p>A native planar region. Extrusion preserves its inner holes. Select a boundary in the outliner to edit its dimensions.</p><div class="operation-grid">${this.ToolButton("extrude")}</div></section>`;
      return;
    }
    if (!Figure) {
      Select("#inspector-body").innerHTML =
        `<section class="inspector-card intro-card">${Icon("body")}<h2>Select geometry</h2><p>Pick a body, sketch or surface in the viewport or outliner to inspect its native geometry.</p></section><section class="inspector-card"><h3>Start constructing</h3><p>Create a profile, then extrude it into a solid.</p><div class="operation-grid">${["box", "circle", "rect", "extrude"].map((Key) => this.ToolButton(Key)).join("")}</div></section>`;
      return;
    }
    const Dimensions = this.Description.dimensions.filter(
      (Dimension) => Dimension.anchor === Figure.id,
    );
    const Extent = Figure.high.map((Value, Index) => Value - Figure.low[Index]);
    Select("#inspector-body").innerHTML =
      `<section class="inspector-card selection-card"><div class="selection-heading"><span class="large-icon colour-${Figure.classification}">${Icon(FigureIcon(Figure))}</span><div><input id="figure-name" aria-label="Geometry name" value="${Escape(Figure.name)}" maxlength="64"/><small>${Classification(Figure).toUpperCase()}${this.Picked.length > 1 ? ` · +${this.Picked.length - 1} SELECTED` : ""}</small></div><button id="selected-visibility" class="icon-button" title="Toggle visibility" aria-label="Toggle selected visibility">${Icon(Figure.hidden ? "hidden" : "eye")}</button></div><div class="geometry-counts"><div><span>Faces</span><strong>${Figure.faces}</strong></div><div><span>Edges</span><strong>${Figure.edges}</strong></div><div><span>${Figure.classification === 0 ? "Poles" : "Vertices"}</span><strong>${Figure.classification === 0 ? Figure.poles : Figure.vertices}</strong></div></div></section>
<div class="inspector-tabs"><span class="active">Geometry</span><button data-tool="move">Transform</button><button id="topology-button">Topology</button></div>
<section class="inspector-card"><div class="section-heading"><h3>Dimensions</h3><small>NATIVE · m</small></div><p>Construction dimensions rebuild the native geometry. Drag values or type; apply on release.</p>${
        Dimensions.length
          ? Dimensions.slice(0, 12)
              .map((Dimension) => this.DimensionControl(Dimension))
              .join("")
          : "<p>No live dimensions on this derived figure.</p>"
      }<label class="switch-row">Viewport dimensions<input id="dimensions-toggle" type="checkbox" class="switch" ${this.Document?.dimensions ? "checked" : ""}/></label></section>
<section class="inspector-card"><div class="section-heading"><h3>Bounds</h3><small>WORLD · m</small></div><div class="bounds-values">${["X", "Y", "Z"].map((Axis, Index) => `<div><span class="axis-${Axis}">${Axis}</span><strong>${Decimal(Extent[Index])}</strong><small>m</small></div>`).join("")}</div></section>
<section class="inspector-card"><div class="section-heading"><h3>Operations</h3><small>NATIVE SOLVERS</small></div><div class="operation-grid">${["extrude", "revolve", "loft", "fillet", "chamfer", "shell", "union", "subtract", "intersect"].map((Key) => this.ToolButton(Key)).join("")}</div><p class="picked-note">${Figure.pickedFaces.length} faces · ${Figure.pickedEdges.length} edges selected</p></section>
<section class="inspector-card"><h3>Presentation</h3><select id="material-select" aria-label="Surface appearance"><option value="">Change finish…</option><option>steel</option> <option>chrome</option><option>copper</option><option>clay</option><option>plastic-blue</option><option>glass</option></select><div class="inspector-actions"><button id="export-obj" class="button">Export OBJ</button><button id="delete-selection" class="icon-button" title="Delete selected" aria-label="Delete selected">${Icon("trash")}</button></div><p>OBJ exports all native solid bodies as a tessellated geometry-only file. Save .arc to retain editable construction.</p></section>`;
  }
  DimensionControl(Dimension) {
    const Editable = Dimension.slot >= 0;
    const Min = [1, 2, 3, 4, 5].includes(Dimension.form) ? 0.001 : -100;
    const Max = Math.max(10, Math.ceil(Math.abs(Dimension.number) * 2));
    return `<div class="property-row"><label for="dimension-${Dimension.id}">${Escape(Dimension.label || `Dimension ${Dimension.id}`)}</label><div class="slider-control"><div class="value-pill"><input id="dimension-${Dimension.id}" data-dimension="${Dimension.id}" type="number" value="${Decimal(Dimension.number)}" min="${Min}" max="${Max}" step="0.001" ${Editable ? "" : "disabled"}/><span>${Dimension.form === 1 || / (angle|twist)$/.test(Dimension.label) ? "°" : / (degree|stations|scale)$/.test(Dimension.label) ? "—" : "m"}</span></div><input type="range" data-dimension-range="${Dimension.id}" style="--fill:${Math.max(0, Math.min(100, ((Dimension.number - Min) / (Max - Min)) * 100))}%" min="${Min}" max="${Max}" step="0.001" value="${Dimension.number}" aria-label="${Escape(Dimension.label || "Dimension")} slider" ${Editable ? "" : "disabled"}/></div></div>`;
  }
  ToolButton(Key) {
    return `<button data-tool="${Key}" class="operation-button">${Icon(Tools[Key].icon)}<span>${Tools[Key].title}</span></button>`;
  }
  ConstructLibrary() {
    Select("#construct-tiles").innerHTML = [
      "box",
      "cylinder",
      "sphere",
      "torus",
      "rect",
      "circle",
      "plane",
      "spline",
    ]
      .map(
        (Key) =>
          `<button data-tool="${Key}" class="construct-tile">${Icon(Tools[Key].icon)}<span>${Tools[Key].title}<small>${Tools[Key].group}</small></span><span class="tile-arrow">↗</span></button>`,
      )
      .join("");
    Select("#example-cards").innerHTML = Object.entries(Examples)
      .map(
        ([Key, Example]) =>
          `<button data-example="${Key}" class="example-card">${Icon(Example.icon)}<span><strong>${Example.name}</strong><small>${Example.description}</small></span><span>↗</span></button>`,
      )
      .join("");
  }
  OpenTool(Key) {
    if (this.Busy || !this.Ready) return;
    this.Tool = Key;
    const Definition = Tools[Key];
    Select("#tool-title").textContent = Definition.title;
    Select("#tool-description").textContent = Definition.description;
    Select("#tool-fields").innerHTML = Definition.fields
      .map(
        (Field) =>
          `<label>${Field.label}<div class="tool-input"><input name="${Field.key}" aria-label="${Field.label}" type="${Field.text ? "text" : "number"}" value="${Field.initial}" ${Field.text ? 'maxlength="64"' : `min="${Field.min}" max="${Field.max}" step="any" required`}/>${Field.text ? "" : `<span>${Field.unit}</span>`}</div></label>`,
      )
      .join("");
    Select("#apply-tool").textContent =
      Definition.group === "Operations"
        ? "Apply operation"
        : "Construct geometry";
    Select("#tool-error").textContent = "";
    this.RefreshCommandPreview();
    Select("#tool-dialog").showModal();
  }
  ToolSettings() {
    return Object.fromEntries(
      Tools[this.Tool].fields.map((Field) => [
        Field.key,
        Field.text
          ? Select(`[name="${Field.key}"]`).value
          : Number(Select(`[name="${Field.key}"]`).value),
      ]),
    );
  }
  RefreshCommandPreview() {
    try {
      Select("#command-preview").textContent = ConstructCommand(
        this.Tool,
        this.ToolSettings(),
        this.ToolSelection,
      );
    } catch (ErrorValue) {
      Select("#command-preview").textContent = ErrorValue.message;
    }
  }
  AppendLog(Lines) {
    this.Log.push(...Lines);
    this.Log = this.Log.slice(-500);
    Select("#command-log").textContent = this.Log.join("\n");
    Select("#command-log").scrollTop = Select("#command-log").scrollHeight;
  }
  Notify(Text) {
    Select("#toast").textContent = Text;
    Select("#toast").hidden = false;
    clearTimeout(this.ToastTimer);
    this.ToastTimer = setTimeout(() => (Select("#toast").hidden = true), 4200);
  }
  async Save() {
    if (this.Busy) return;
    const Response = await this.Request("save");
    if (Response.success) {
      Download(
        Response.file,
        `${this.Document.name.replace(/[^\w .-]/g, "_")}.arc`,
      );
      this.Document.dirty = false;
      this.RefreshTabs();
      this.Notify("Saved native .arc construction.");
    }
  }
  ConnectInterface() {
    const Safe = (Action) => async (Event) => {
      try {
        await Action(Event);
      } catch (ErrorValue) {
        this.Notify(ErrorValue.message);
      }
    };
    Select("#new-document").onclick = Safe(() => this.CreateDocument());
    Select("#save-button").onclick = Safe(() => this.Save());
    Select("#open-button").onclick = () => Select("#open-file").click();
    Select("#open-file").onchange = Safe(async (Event) => {
      const File = Event.target.files[0];
      Event.target.value = "";
      if (!File) return;
      if (File.size > 8 * 1024 * 1024)
        throw new Error("Browser documents are limited to 8 MB.");
      const Identity = this.Active;
      const Text = await File.text();
      if (Identity !== this.Active || this.Busy)
        throw new Error(
          "The active document changed. Open the file again in the intended tab.",
        );
      if (
        this.Document.dirty &&
        !confirm("Replace this document and discard unsaved changes?")
      )
        return;
      const Response = await this.Request("open", { text: Text });
      if (Response.success) {
        this.Document.name = File.name.replace(/\.arc$/i, "");
        this.Document.dirty = false;
        this.Document.dimensions = false;
        this.Document.edges = true;
        this.Document.cages = false;
        await this.Command(
          [
            "gizmo off",
            "show shading matcap",
            "show edges on",
            "show cages off",
            "dim off",
            "view fit",
          ],
          false,
        );
        this.RefreshTabs();
      } else {
        this.Notify("Document refused. The previous document is preserved.");
        Select("#console-panel").hidden = false;
      }
    });
    Select("#document-tabs").onclick = Safe((Event) => {
      const Close = Event.target.closest("[data-close]");
      if (Close) return this.CloseDocument(Number(Close.dataset.close));
      if (Event.target.matches("input")) return;
      const Tab = Event.target.closest("[data-document]");
      if (Tab) return this.ActivateDocument(Number(Tab.dataset.document));
    });
    Select("#document-tabs").ondblclick = (Event) => {
      if (Event.target.closest("button")) return;
      const Tab = Event.target.closest("[data-document]");
      if (!Tab) return;
      const Document = this.Documents.find(
        (Document) => Document.id === Number(Tab.dataset.document),
      );
      const Input = Tab.querySelector("input");
      Input.value = Document.name;
      Input.hidden = false;
      Tab.querySelector(".document-label").hidden = true;
      Input.focus();
      Input.select();
    };
    const RenameTab = (Input) => {
      if (Input.hidden) return;
      const Document = this.Documents.find(
        (Document) =>
          Document.id ===
          Number(Input.closest("[data-document]").dataset.document),
      );
      Document.name = Input.value.trim().slice(0, 64) || "Untitled";
      Input.hidden = true;
      Input.parentElement.querySelector(".document-label").hidden = false;
      this.RefreshTabs();
    };
    Select("#document-tabs").addEventListener("focusout", (Event) => {
      if (Event.target.matches("input")) RenameTab(Event.target);
    });
    Select("#document-tabs").onkeydown = Safe((Event) => {
      if (Event.target.matches("input")) {
        if (Event.key === "Enter") {
          RenameTab(Event.target);
          Event.target.blur();
        }
        if (Event.key === "Escape") {
          Event.target.hidden = true;
          Event.target.parentElement.querySelector(".document-label").hidden =
            false;
        }
        Event.stopPropagation();
        return;
      }
      if (Event.key === "Enter" || Event.key === " ") {
        Event.preventDefault();
        return this.ActivateDocument(
          Number(Event.target.closest("[data-document]").dataset.document),
        );
      }
    });
    Select("#scene-search").oninput = () => this.RefreshRows();
    Select("#filters").onclick = (Event) => {
      const Button = Event.target.closest("[data-filter]");
      if (Button) {
        this.Filter = Button.dataset.filter;
        this.RefreshRows();
      }
    };
    Select("#compact-button").onclick = () =>
      Select("#scene-rows").classList.toggle("compact");
    Select("#fold-button").onclick = () => {
      const Hidden = !Select("#scene-rows").hidden;
      Select("#scene-rows").hidden = Hidden;
      Select("#fold-button").setAttribute("aria-expanded", String(!Hidden));
    };
    Select("#scene-rows").onclick = Safe((Event) => {
      const Visibility = Event.target.closest("[data-visibility]");
      if (Visibility) {
        const Figure = this.Description.figures.find(
          (Figure) => Figure.id === Number(Visibility.dataset.visibility),
        );
        return this.Command(
          `${Figure.hidden ? "unhide" : "hide"} ${Figure.id}`,
        );
      }
      const Row = Event.target.closest("[data-figure]");
      if (Row) {
        if (
          !Event.shiftKey &&
          this.Picked.length === 1 &&
          this.Picked[0].id === Number(Row.dataset.figure) &&
          this.Picked[0].selected
        )
          return;
        return this.Command(
          `select ${Row.dataset.figure}${Event.shiftKey ? " --add" : ""}`,
          false,
        );
      }
    });
    Select("#scene-rows").ondblclick = (Event) => {
      const Row = Event.target.closest("[data-figure]");
      if (!Row) return;
      if (this.Busy) {
        this.RenameTarget = Number(Row.dataset.figure);
        return;
      }
      Select("#figure-name")?.focus();
      Select("#figure-name")?.select();
    };
    Select("#scene-rows").onkeydown = Safe((Event) => {
      if (Event.key === "Enter") {
        const Row = Event.target.closest("[data-figure]");
        if (Row) return this.Command(`select ${Row.dataset.figure}`, false);
      }
    });
    document.addEventListener(
      "click",
      Safe(async (Event) => {
        const Button = Event.target.closest("[data-tool]");
        if (Button) this.OpenTool(Button.dataset.tool);
        if (Event.target.closest("[data-close-dialog]"))
          Event.target.closest("dialog").close();
        const Example = Event.target.closest("[data-example]");
        if (Example) {
          Select("#examples-dialog").close();
          await this.CreateDocument(Example.dataset.example);
        }
      }),
    );
    Select("#tool-dialog").addEventListener("cancel", (Event) => {
      if (this.Busy) Event.preventDefault();
    });
    Select("#tool-form").oninput = () => this.RefreshCommandPreview();
    Select("#tool-form").onsubmit = Safe(async (Event) => {
      Event.preventDefault();
      try {
        const Command = ConstructCommand(
          this.Tool,
          this.ToolSettings(),
          this.ToolSelection,
        );
        Select("#apply-tool").disabled = true;
        All("#tool-dialog [data-close-dialog]").forEach(
          (Button) => (Button.disabled = true),
        );
        const Response = await this.Command(Command);
        if (Response?.success) {
          Select("#tool-dialog").close();
          await this.Command("view fit", false);
        } else
          Select("#tool-error").textContent = this.Log.slice(-4).join("\n");
      } catch (ErrorValue) {
        Select("#tool-error").textContent = ErrorValue.message;
      } finally {
        Select("#apply-tool").disabled = false;
        All("#tool-dialog [data-close-dialog]").forEach(
          (Button) => (Button.disabled = false),
        );
      }
    });
    Select("#add-button").onclick = () => this.OpenTool("box");
    Select("#examples-button").onclick = () =>
      Select("#examples-dialog").showModal();
    Select("#workspace-button").onclick = () =>
      All("dialog[open]").forEach((Dialog) => Dialog.close());
    Select("#help-button").onclick = () => Select("#help-dialog").showModal();
    Select("#restart-button").onclick = () => {
      if (
        confirm(
          "Restart the browser kernel? All unsaved documents will be lost.",
        )
      )
        location.reload();
    };
    Select("#undo-button").onclick = Safe(() => this.Command("undo"));
    Select("#redo-button").onclick = Safe(() => this.Command("redo"));
    Select("#camera-view").onchange = Safe((Event) =>
      this.Command(`view ${Event.target.value}`, false),
    );
    All("[data-view]").forEach(
      (Button) =>
        (Button.onclick = Safe(() => {
          Select("#camera-view").value = Button.dataset.view;
          return this.Command(`view ${Button.dataset.view}`, false);
        })),
    );
    Select("#projection-button").onclick = Safe(() =>
      this.Command(
        `view ${this.Description.camera.orthographic ? "persp" : "ortho"}`,
        false,
      ),
    );
    Select("#fit-button").onclick = Safe(() => this.Command("view fit", false));
    Select("#maximize-button").onclick = () =>
      Select("#workspace").classList.toggle("maximized");
    Select("#history-button").onclick = () => {
      Select("#history-strip").hidden = !Select("#history-strip").hidden;
    };
    Select("#diagnostics-button").onclick = () => {
      Select("#console-panel").hidden = !Select("#console-panel").hidden;
    };
    Select("#clear-log").onclick = () => {
      this.Log = [];
      Select("#command-log").textContent = "";
    };
    Select("#command-form").onsubmit = Safe(async (Event) => {
      Event.preventDefault();
      const Input = Select("#command-input");
      if (!Input.value.trim()) return;
      await this.Command(Input.value);
      Input.value = "";
    });
    All("[data-mode]").forEach(
      (Button) =>
        (Button.onclick = Safe(() =>
          this.Command(`selectmode ${Button.dataset.mode}`, false),
        )),
    );
    for (const Key of ["edges", "cages"])
      Select(`#${Key}-button`).onclick = Safe(() => {
        this.Document[Key] = !this.Document[Key];
        return this.Command(
          `show ${Key} ${this.Document[Key] ? "on" : "off"}`,
          false,
        );
      });
    Select("#inspect-button").onclick = Safe(() => this.Inspect());
    Select("#inspector-body").addEventListener(
      "click",
      Safe(async (Event) => {
        if (Event.target.closest("#delete-selection"))
          await this.Command(
            `delete ${this.Picked.map((Figure) => Figure.id).join(" ")}`,
          );
        if (Event.target.closest("#selected-visibility"))
          await this.Command(
            `${this.Picked[0].hidden ? "unhide" : "hide"} ${this.Picked[0].id}`,
          );
        if (Event.target.closest("#topology-button")) await this.Inspect();
        if (Event.target.closest("#export-obj")) {
          const Response = await this.Request("export");
          if (Response.success)
            Download(Response.file, `${this.Document.name}.obj`);
        }
      }),
    );
    Select("#inspector-body").addEventListener(
      "change",
      Safe((Event) => {
        if (Event.target.id === "figure-name")
          return this.Command(
            `rename ${this.Picked[0].id} ${NativeName(Event.target.value)}`,
          );
        if (
          Event.target.dataset.dimension ||
          Event.target.dataset.dimensionRange
        ) {
          const Identity =
            Event.target.dataset.dimension ||
            Event.target.dataset.dimensionRange;
          const NumberValue = Number(Event.target.value);
          if (!Number.isFinite(NumberValue) || Math.abs(NumberValue) > 1000)
            throw new Error("Use a finite dimension within ±1000.");
          return this.Command(`dim edit ${Identity} ${NumberValue}`);
        }
        if (Event.target.id === "dimensions-toggle") {
          this.Document.dimensions = Event.target.checked;
          return this.Command(
            `dim ${Event.target.checked ? "on" : "off"}`,
            false,
          );
        }
        if (Event.target.id === "material-select" && Event.target.value)
          return this.Command(
            `matcap ${this.Picked.map((Figure) => Figure.id).join(" ")} ${Event.target.value}`,
          );
      }),
    );
    Select("#inspector-body").addEventListener("input", (Event) => {
      if (Event.target.dataset.dimensionRange) {
        Select(`#dimension-${Event.target.dataset.dimensionRange}`).value =
          Event.target.value;
        Event.target.style.setProperty(
          "--fill",
          `${((Number(Event.target.value) - Number(Event.target.min)) / (Number(Event.target.max) - Number(Event.target.min))) * 100}%`,
        );
      }
    });
    let Scrub;
    Select("#inspector-body").addEventListener("pointerdown", (Event) => {
      if (
        Event.button !== 0 ||
        !Event.target.matches("[data-dimension]:not(:disabled)")
      )
        return;
      Scrub = {
        input: Event.target,
        start: Event.clientX,
        number: Number(Event.target.value),
        moved: false,
      };
      Event.target.setPointerCapture(Event.pointerId);
    });
    Select("#inspector-body").addEventListener("pointermove", (Event) => {
      if (!Scrub) return;
      const Distance = Event.clientX - Scrub.start;
      if (Math.abs(Distance) < 3 && !Scrub.moved) return;
      Scrub.moved = true;
      Scrub.input.value = Decimal(
        Math.max(
          Number(Scrub.input.min),
          Math.min(
            Number(Scrub.input.max),
            Scrub.number + Distance * (Event.shiftKey ? 0.001 : 0.01),
          ),
        ),
      );
      Event.preventDefault();
    });
    Select("#inspector-body").addEventListener("pointerup", () => {
      if (Scrub?.moved)
        Scrub.input.dispatchEvent(new Event("change", { bubbles: true }));
      Scrub = null;
    });
    Select("#inspector-body").addEventListener("pointercancel", () => {
      if (Scrub) Scrub.input.value = Scrub.number;
      Scrub = null;
    });
    document.addEventListener(
      "keydown",
      Safe((Event) => {
        if (Select("dialog[open]")) return;
        if (
          (Event.ctrlKey || Event.metaKey) &&
          Event.key.toLowerCase() === "s"
        ) {
          Event.preventDefault();
          return this.Save();
        }
        if (
          (Event.ctrlKey || Event.metaKey) &&
          Event.key.toLowerCase() === "f"
        ) {
          Event.preventDefault();
          Select("#scene-search").focus();
          return;
        }
        if (Event.target.closest("input,select,textarea")) return;
        if (
          (Event.ctrlKey || Event.metaKey) &&
          Event.key.toLowerCase() === "z"
        ) {
          Event.preventDefault();
          return this.Command(Event.shiftKey ? "redo" : "undo");
        }
        if (this.Busy) return;
        if (Event.key.toLowerCase() === "f")
          return this.Command("view fit", false);
        if (Event.key === "Delete")
          return this.Command(
            `delete ${this.Picked.map((Figure) => Figure.id).join(" ")}`,
          );
        if (["1", "2", "3", "4"].includes(Event.key))
          return this.Command(
            `selectmode ${{ 1: "control", 2: "edge", 3: "face", 4: "whole" }[Event.key]}`,
            false,
          );
      }),
    );
    this.ConnectViewport(Safe);
  }
  async Inspect() {
    if (!this.Picked.length) {
      this.Notify("Select a solid body to inspect its topology.");
      return;
    }
    Select("#console-panel").hidden = false;
    await this.Command(`topology ${this.Picked[0].id}`, false);
  }
  ConnectViewport(Safe) {
    const Canvas = Select("#cad-canvas");
    let Drag = null;
    this.FlushNavigation = Safe(async () => {
      if (this.Busy || !this.Ready) return;
      if (this.Motion) {
        const Motion = this.Motion;
        this.Motion = null;
        await this.Request(Motion.action, Motion);
      } else if (this.ResolveDetail) {
        this.ResolveDetail = false;
        await this.Request("render");
      }
    });
    Canvas.oncontextmenu = (Event) => Event.preventDefault();
    Canvas.onpointerdown = (Event) => {
      if (this.Busy || this.Motion || !this.Ready) return;
      Canvas.setPointerCapture(Event.pointerId);
      Drag = {
        x: Event.clientX,
        y: Event.clientY,
        originX: Event.clientX,
        originY: Event.clientY,
        moved: false,
        pan: Event.button === 2 || Event.button === 1,
        extend: Event.shiftKey,
      };
    };
    Canvas.onpointermove = (Event) => {
      if (!Drag) return;
      if (
        Math.hypot(Event.clientX - Drag.originX, Event.clientY - Drag.originY) >
        4
      )
        Drag.moved = true;
      if (!Drag.moved) return;
      const X = Event.clientX - Drag.x,
        Y = Event.clientY - Drag.y;
      Drag.x = Event.clientX;
      Drag.y = Event.clientY;
      this.Motion ||= {
        action: Drag.pan ? "pan" : "orbit",
        x: 0,
        y: 0,
        height: Canvas.clientHeight,
      };
      this.Motion.x += Drag.pan ? X : -X * 0.008;
      this.Motion.y += Drag.pan ? -Y : Y * 0.008;
      this.FlushNavigation();
    };
    Canvas.onpointerup = Safe(async (Event) => {
      const Previous = Drag;
      Drag = null;
      if (!Previous) return;
      if (Previous.moved) {
        this.ResolveDetail = true;
        this.FlushNavigation();
        return;
      }
      if (this.Busy) return;
      const Rectangle = Canvas.getBoundingClientRect();
      await this.Request("pick", {
        x: ((Event.clientX - Rectangle.left) * Canvas.width) / Rectangle.width,
        y: ((Event.clientY - Rectangle.top) * Canvas.height) / Rectangle.height,
        extend: Previous.extend,
      });
    });
    Canvas.onpointercancel = () => {
      Drag = null;
      this.ResolveDetail = true;
      this.FlushNavigation();
    };
    Canvas.addEventListener(
      "wheel",
      (Event) => {
        Event.preventDefault();
        if (this.Motion?.action !== "zoom")
          this.Motion = { action: "zoom", steps: 0 };
        this.Motion.steps += Math.sign(Event.deltaY) * 0.5;
        this.ResolveDetail = true;
        clearTimeout(this.WheelTimer);
        this.WheelTimer = setTimeout(() => this.FlushNavigation(), 80);
      },
      { passive: false },
    );
  }
}
window.solidArc = new WorkspacePanel();

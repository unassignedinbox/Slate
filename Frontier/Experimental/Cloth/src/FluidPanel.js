import { OrbitCamera } from "./camera.js";
import { WebGL2ClothEngine } from "./engine-webgl2.js";
import { WebGPUClothEngine } from "./engine-webgpu.js";
import { HumanAvatar, POSE_MODES } from "./HumanAvatar.js";
import { SubstanceClothGraphEditor } from "./GraphEditor.js";
import {
  PRESETS,
  DEBUG_CHANNELS,
  FABRIC_PRESETS,
  getFabricPresetParameters,
} from "./presets.js";
import {
  InitialParameters,
  ControlSpecification,
  ControlLabels,
  PresetPresentation,
  SourceRevision,
  PATTERN_REBUILD_KEYS,
  ValidateParameter,
  ValidateScene,
  ConstructPresetParameters,
} from "./SceneSpecification.js";

const Select = (Selector) => document.querySelector(Selector);
const SelectAll = (Selector) => [...document.querySelectorAll(Selector)];
const Escape = (Text) =>
  String(Text).replace(
    /[&<>"']/g,
    (Character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        Character
      ],
  );

const GlyphPaths = {
  dress:
    '<path d="M8 3 12 6l4-3 3 4-2.5 3.5L20 21H4l3.5-10.5L5 7Z"/><path d="M9.5 10.5h5"/>',
  pleat:
    '<path d="M6 4h12l3 16H3L6 4Zm3 0L7 20m5-16v16m3-16 2 16"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  weave:
    '<path d="M4 7h16M4 12h16M4 17h16M7 4v16M12 4v16M17 4v16"/>',
  avatar:
    '<circle cx="12" cy="5" r="3"/><path d="M7 10h10l-1.5 6v6h-7v-6L7 10Z"/>',
  wind:
    '<path d="M4 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h14.5a2.5 2.5 0 1 1-2.5 2.5M5 17h7.5a2 2 0 1 1-2 2"/>',
  flame:
    '<path d="M13 2c2 6-5 6-2 11-3-1-3-4-3-4C0 18 10 25 17 20c5-4 2-11-4-18Z"/>',
  smoke:
    '<path d="M6 20h12M5 15c-4-5 2-7 4-5-3-8 8-9 7-3 7-1 7 8 2 8H5Zm4 1v4m6-4v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3m0 3h.01"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 13h8m-8 4h6"/>',
  folder: '<path d="M3 6h7l2 3h9l-2 11H3V6Zm0 3h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5M3 17l9 5 9-5"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10L3 7m9 5 9-5m-9 5v10M7 4.5 17 10"/>',
  link: '<path d="m10 14 4-4m-6 2-2 2a3.5 3.5 0 0 0 5 5l2-2m-2-10 2-2a3.5 3.5 0 0 1 5 5l-2 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  viewport:
    '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  focus:
    '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
  maximize:
    '<path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7M16 3h5v5m0-5-7 7M8 21H3v-5m0 5 7-7"/>',
  orbit:
    '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/>',
  brush: '<path d="m14 3 7 7-10 10H4v-7Zm-6 7 7 7M3 21h7"/>',
  burst: '<path d="m12 2 2 6 6-4-3 7 5 3-7 1-1 7-4-6-7 4 4-7-5-4 7 1Z"/>',
  rotate: '<path d="M4 10a8 8 0 1 1 1 7M4 3v7h7"/>',
  warning: '<path d="m12 3 10 18H2Zm0 6v5m0 3h.01"/>',
  rewind: '<path d="M4 5v14m14-14L7 12l11 7Z"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  step: '<path d="m4 5 11 7-11 7Zm15 0v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sphere:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  eye: '<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="3"/>',
  hidden: '<path d="m3 3 18 18M9 5c5-2 10 1 13 7l-4 5M6 6l-4 6c3 6 8 9 14 6"/>',
};

const Icon = (Name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${GlyphPaths[Name] || GlyphPaths.dress}</svg>`;
const FillIcons = () =>
  SelectAll("[data-icon]").forEach((Element) => {
    Element.innerHTML = Icon(Element.dataset.icon);
  });
const FormatNumber = (Value, Step = 0.01) =>
  Number(Value).toFixed(Number.isInteger(Step) ? 0 : Step < 0.01 ? 3 : 2);

class ClothPanel {
  constructor() {
    this.Parameters = { ...InitialParameters };
    if (new URLSearchParams(location.search).get("quality") === "low") {
      Object.assign(this.Parameters, {
        gridResolution: 36,
        substeps: 6,
        renderScale: 0.65,
      });
    }

    this.Camera = new OrbitCamera();
    this.Avatar = new HumanAvatar();
    this.Engine = null;
    this.Canvas = Select("#pyro-canvas");

    this.Names = {
      garment: "Emerald evening gown",
      avatar: "Human mannequin",
      wind: "Aerodynamic wind",
      sun: "Studio key light",
    };

    this.Selection = "garment";
    this.Tab = "source";
    this.Preset = "emerald_evening_gown";
    this.Filter = "all";
    this.SceneFilter = "all";
    this.Dirty = false;
    this.LastTime = performance.now();
    this.Frames = 0;
    this.Elapsed = 0;
    this.FramesPerSecond = 0;
    this.SingleStep = false;
    this.Switching = false;
    this.Bursts = [];
    this.SavedSun = this.Parameters.sunIntensity;
    this.VisibleKeys = [];

    FillIcons();

    // Initialize Substance Designer Procedural Node Graph & 2D Pattern Editor on the Left Pane
    this.GraphEditor = new SubstanceClothGraphEditor({
      graphCanvas: Select("#substance-graph-canvas"),
      patternCanvas: Select("#pattern-2d-canvas"),
      getParams: () => this.Parameters,
      onChangeParam: (Key, Value) => this.ApplyParameter(Key, Value),
      onSelectNode: (Node) => this.HandleGraphNodeSelected(Node),
    });

    this.ConnectInterface();
    this.ConstructPresetCards();
    this.ConstructSceneRows();
    this.ConstructInspector();
    this.RefreshControls();

    const ViewportResize = new ResizeObserver(() => {
      this.ResizeViewport();
      this.GraphEditor.render(this.Engine?.time || 0);
    });
    ViewportResize.observe(Select("#viewport"));
    ViewportResize.observe(Select("#simulation-pane"));
    ViewportResize.observe(Select("#editor-pane"));

    // Default to WebGPU with automatic fallback to WebGL2
    this.InitializeRenderer("webgpu");
    setTimeout(() => this.GraphEditor.frameAll(), 60);
    requestAnimationFrame((Time) => this.Frame(Time));
  }

  async InitializeRenderer(Backend) {
    if (this.Switching) return;
    this.Switching = true;
    Select("#backend-select").disabled = true;
    Select("#gpu-error").hidden = true;
    Select("#status-ready").textContent = "Initializing GPU";
    this.Engine?.destroy();
    this.Engine = null;

    const PreviousCanvas = this.Canvas;
    this.Canvas = PreviousCanvas.cloneNode(false);
    PreviousCanvas.replaceWith(this.Canvas);
    this.ConnectViewport();

    try {
      if (Backend === "webgpu") {
        try {
          this.Engine = await WebGPUClothEngine.create(
            this.Canvas,
            this.Parameters,
            this.Avatar,
          );
        } catch (ErrorValue) {
          const FailedCanvas = this.Canvas;
          this.Canvas = FailedCanvas.cloneNode(false);
          FailedCanvas.replaceWith(this.Canvas);
          this.ConnectViewport();
          Backend = "webgl2";
        }
      }
      if (Backend === "webgl2") {
        this.Engine = new WebGL2ClothEngine(
          this.Canvas,
          this.Parameters,
          this.Avatar,
        );
      }
      this.Backend = Backend;
      Select("#backend-select").value = Backend;
      Select("#viewport-subtitle").textContent =
        Backend === "webgpu"
          ? "WebGPU WGSL Compute XPBD · 16-capsule human body collider"
          : "WebGL2 XPBD solver · 16-capsule human body collider";
      this.ResizeViewport();
      Select("#status-ready").innerHTML =
        Backend === "webgpu" ? "<i></i>WebGPU ready" : "<i></i>GPU ready";
      if (Backend === "webgpu" && this.Engine.device) {
        const CurrentEngine = this.Engine;
        CurrentEngine.device.lost.then((Information) => {
          if (this.Engine === CurrentEngine)
            this.ShowGpuError(Information.message || "WebGPU device lost.");
        });
      }
    } catch (ErrorValue) {
      this.Engine?.destroy();
      this.Engine = null;
      this.ShowGpuError(ErrorValue.message);
    } finally {
      this.Switching = false;
      Select("#backend-select").disabled = false;
      this.RefreshControls();
    }
  }

  ShowGpuError(Message) {
    Select("#gpu-error-message").textContent = Message;
    Select("#gpu-error").hidden = false;
    Select("#status-ready").textContent = "GPU unavailable";
    this.Parameters.paused = true;
    this.RefreshControls();
  }

  ResizeViewport() {
    const SimPane = Select("#simulation-pane");
    const Rectangle = SimPane.getBoundingClientRect();
    if (Rectangle.width < 2 || Rectangle.height < 2) return;
    const Scale =
      Math.min(devicePixelRatio || 1, 1.5) * this.Parameters.renderScale;
    const Width = Math.max(2, Math.floor(Rectangle.width * Scale));
    const Height = Math.max(2, Math.floor(Rectangle.height * Scale));
    if (this.Canvas.width !== Width || this.Canvas.height !== Height) {
      this.Canvas.width = Width;
      this.Canvas.height = Height;
    }
    this.Camera.aspect = Width / Height;
  }

  MarkDirty() {
    this.Dirty = true;
    Select("#dirty-indicator").classList.remove("clean");
  }

  Notify(Message) {
    clearTimeout(this.ToastTimeout);
    Select("#toast").textContent = Message;
    Select("#toast").hidden = false;
    this.ToastTimeout = setTimeout(() => {
      Select("#toast").hidden = true;
    }, 4500);
  }

  HandleGraphNodeSelected(Node) {
    Select("#active-node-badge").textContent = Node.title.toUpperCase();
    Select("#active-node-badge").style.color = Node.color;

    if (["bodice", "skirt", "pleats"].includes(Node.id)) {
      this.Selection = "garment";
      this.Tab = "source";
    } else if (["pie", "seams", "output"].includes(Node.id)) {
      this.Selection = "garment";
      this.Tab = "simulation";
    } else if (["weave", "dye"].includes(Node.id)) {
      this.Selection = "garment";
      this.Tab = "rendering";
    }
    this.ConstructSceneRows();
    this.ConstructInspector();
    this.RefreshControls();
  }

  ApplyParameter(Key, Value) {
    try {
      Value = ValidateParameter(Key, Value);
    } catch (ErrorValue) {
      this.Notify(ErrorValue.message);
      this.RefreshControls();
      return;
    }
    if (this.Parameters[Key] === Value) return;
    const PreviousParameters = { ...this.Parameters };
    this.Parameters[Key] = Value;
    if (Key === "fabricPreset") {
      Object.assign(this.Parameters, getFabricPresetParameters(Value));
    }
    try {
      if (Key === "avatarBodyType") {
        this.Avatar.setBodyType(Value);
        this.Engine?.initAvatarBuffers();
        this.Names.avatar = Value === 1 ? "Male mannequin" : "Female mannequin";
        this.ConstructSceneRows();
      }
      if (PATTERN_REBUILD_KEYS.has(Key)) {
        this.Engine?.rebuildDress(this.Parameters);
      }
      if (Key === "renderScale") this.ResizeViewport();
      if (Key === "interactionMode") this.Engine?.setBrush(null, null, false);
    } catch (ErrorValue) {
      Object.assign(this.Parameters, PreviousParameters);
      this.ShowGpuError(ErrorValue.message);
    }
    this.MarkDirty();
    if (
      ["garmentEnabled", "avatarVisible", "windEnabled", "sunIntensity"].includes(
        Key,
      )
    ) {
      this.ConstructSceneRows();
    }
    this.RefreshControls();
    this.GraphEditor.render(this.Engine?.time || 0);
  }

  RefreshControls() {
    SelectAll("[data-param]").forEach((Element) => {
      const Value = this.Parameters[Element.dataset.param];
      if (Element.type === "checkbox") Element.checked = Value;
      else if (Element.type === "number")
        Element.value = FormatNumber(
          Value,
          ControlSpecification[Element.dataset.param]?.step,
        );
      else Element.value = Value;
      if (Element.type === "range") {
        const Fraction = Math.max(
          0,
          Math.min(
            1,
            (Value - Number(Element.min)) /
              (Number(Element.max) - Number(Element.min)),
          ),
        );
        Element.style.setProperty("--fraction", Fraction);
      }
    });

    // Quick bar sliders in left Substance Editor
    if (Select("#quick-grid-res"))
      Select("#quick-grid-res").value = this.Parameters.gridResolution;
    if (Select("#quick-skirt-length"))
      Select("#quick-skirt-length").value = this.Parameters.skirtLength;
    if (Select("#quick-skirt-flare"))
      Select("#quick-skirt-flare").value = this.Parameters.skirtFlare;
    if (Select("#quick-pleats"))
      Select("#quick-pleats").value = this.Parameters.pleatCount;

    const MeshResSelect = Select("#mesh-res-select");
    if (MeshResSelect) {
      MeshResSelect.querySelector("[data-custom]")?.remove();
      if (![96, 144, 192, 256, 320].includes(this.Parameters.gridResolution)) {
        const c = this.Engine?.numCols || this.Parameters.gridResolution;
        const r = this.Engine?.numRows || Math.round(c * 0.72);
        MeshResSelect.insertAdjacentHTML(
          "beforeend",
          `<option data-custom value="${this.Parameters.gridResolution}">${c}×${r} · Custom</option>`,
        );
      }
      MeshResSelect.value = this.Parameters.gridResolution;
    }

    if (Select("#body-type-select"))
      Select("#body-type-select").value = this.Parameters.avatarBodyType ?? 0;
    if (Select("#fabric-preset-select"))
      Select("#fabric-preset-select").value = this.Parameters.fabricPreset ?? 0;

    Select("#render-channel").value = this.Parameters.renderChannel;
    Select("#diagnostic-channel").value = this.Parameters.renderChannel;
    Select("#atlas-toggle").checked = this.Parameters.showAtlasMinimap;
    Select("#overlays-button").classList.toggle(
      "active",
      this.Parameters.showSeamLines,
    );
    Select("#turntable-button").classList.toggle(
      "active",
      this.Parameters.autoTurntable,
    );
    SelectAll("[data-tool]").forEach((Button) => {
      Button.classList.toggle(
        "active",
        Button.dataset.tool === this.Parameters.interactionMode,
      );
      Button.setAttribute(
        "aria-pressed",
        String(Button.dataset.tool === this.Parameters.interactionMode),
      );
    });
    Select("#play-button").innerHTML = Icon(
      this.Parameters.paused ? "play" : "pause",
    );
    Select("#play-button").setAttribute(
      "aria-label",
      this.Parameters.paused ? "Play simulation" : "Pause simulation",
    );
    Select("#live-pill span").textContent = this.Engine
      ? this.Parameters.paused
        ? "PAUSED"
        : this.Backend === "webgpu"
          ? "LIVE · WEBGPU"
          : "LIVE"
      : "OFFLINE";
    Select("#live-pill").classList.toggle("paused", this.Parameters.paused);

    const SpeedSelect = Select("#speed-select");
    SpeedSelect.querySelector("[data-custom]")?.remove();
    if (![0.25, 0.5, 1, 2].includes(this.Parameters.timeScale))
      SpeedSelect.insertAdjacentHTML(
        "beforeend",
        `<option data-custom value="${this.Parameters.timeScale}">${this.Parameters.timeScale.toFixed(2)}×</option>`,
      );
    SpeedSelect.value = this.Parameters.timeScale;

    const Cols = this.Engine?.numCols || this.Parameters.gridResolution;
    const Rows = this.Engine?.numRows || Math.round(Cols * 0.78);
    const Verts = this.Engine?.vertexCount || Cols * Rows;
    const Springs = this.Engine?.constraintCount || Verts * 5;
    Select("#grid-hud").textContent = `${Cols}×${Rows} MESH`;
    Select("#voxel-count").textContent =
      `${Verts.toLocaleString()} vertices · ${Springs.toLocaleString()} springs`;
    Select("#bounds-status").textContent =
      `1.72 m avatar · ${this.Parameters.skirtLength.toFixed(2)} m skirt`;

    const PoseName =
      POSE_MODES.find((p) => p.id === this.Parameters.avatarPose)?.label ||
      "Studio pose";
    Select("#source-track-label").textContent =
      `${PoseName} · ${this.Parameters.substeps} XPBD substeps`;

    const Enabled = Select("#object-enabled");
    Enabled.disabled = false;
    Enabled.checked =
      this.Selection === "garment"
        ? this.Parameters.garmentEnabled
        : this.Selection === "avatar"
          ? this.Parameters.avatarVisible
          : this.Selection === "wind"
            ? this.Parameters.windEnabled
            : this.Parameters.sunIntensity > 0;
    Select("#dirty-indicator").classList.toggle("clean", !this.Dirty);
  }

  ConstructSceneRows() {
    const Objects = [
      ["garment", "dress", "CLOTH", this.Parameters.garmentEnabled],
      ["avatar", "avatar", "BODY", this.Parameters.avatarVisible],
      ["wind", "wind", "", this.Parameters.windEnabled],
      ["sun", "sun", "", this.Parameters.sunIntensity > 0],
    ];
    Select("#scene-count").textContent = Objects.length;
    Select("#enabled-count").textContent = Objects.filter(
      (ObjectSlot) => ObjectSlot[3],
    ).length;
    Select("#disabled-count").textContent = Objects.filter(
      (ObjectSlot) => !ObjectSlot[3],
    ).length;
    const Categories = {
      garment: "garment",
      avatar: "avatar",
      wind: "garment",
      sun: "light",
    };
    const Search = Select("#scene-search").value.toLowerCase().trim();
    const Matches = Objects.filter(
      ([Key]) =>
        (this.SceneFilter === "all" || Categories[Key] === this.SceneFilter) &&
        this.Names[Key].toLowerCase().includes(Search),
    );
    Select("#scene-tree").hidden = Search
      ? false
      : Select("#collection-toggle").getAttribute("aria-expanded") === "false";
    const RowMarkup =
      Matches.map(
        ([Key, Glyph, Badge, Enabled]) =>
          `<div class="scene-row ${this.Selection === Key ? "selected" : ""} ${!Enabled ? "muted" : ""}" data-object="${Key}" data-category="${Categories[Key]}" role="treeitem" aria-selected="${this.Selection === Key}" aria-level="1" tabindex="0"><span class="row-chevron"></span><span class="row-icon">${Icon(Glyph)}</span><span class="scene-label">${Escape(this.Names[Key])}</span>${Badge ? `<span class="row-badge">${Badge}</span>` : ""}<button class="icon-button row-toggle" data-toggle-object="${Key}" title="${Enabled ? "Disable" : "Enable"} ${Escape(this.Names[Key])}" aria-label="${Enabled ? "Disable" : "Enable"} ${Escape(this.Names[Key])}">${Icon(Enabled ? "eye" : "hidden")}</button></div>`,
      ).join("") ||
      '<div class="outliner-empty" role="status">No matching objects.</div>';
    const RowSignature = JSON.stringify(
      Matches.map((ObjectSlot) => [...ObjectSlot, this.Names[ObjectSlot[0]]]),
    );
    if (this.SceneRowSignature !== RowSignature) {
      Select("#scene-tree").innerHTML = RowMarkup;
      this.SceneRowSignature = RowSignature;
    } else {
      SelectAll("#scene-tree [data-object]").forEach((Row) => {
        const Selected = Row.dataset.object === this.Selection;
        Row.classList.toggle("selected", Selected);
        Row.setAttribute("aria-selected", String(Selected));
      });
    }
    SelectAll("[data-scene-filter]").forEach((Button) => {
      const Selected = Button.dataset.sceneFilter === this.SceneFilter;
      Button.classList.toggle("active", Selected);
      Button.setAttribute("aria-pressed", String(Selected));
    });
  }

  SelectObject(Key) {
    this.Selection = Key;
    this.Tab =
      Key === "wind"
        ? "simulation"
        : Key === "sun"
          ? "rendering"
          : Key === "avatar"
            ? "simulation"
            : "source";
    this.ConstructSceneRows();
    this.ConstructInspector();
    this.RefreshControls();
  }

  ToggleObject(Key) {
    if (Key === "garment")
      this.ApplyParameter("garmentEnabled", !this.Parameters.garmentEnabled);
    if (Key === "avatar")
      this.ApplyParameter("avatarVisible", !this.Parameters.avatarVisible);
    if (Key === "wind")
      this.ApplyParameter("windEnabled", !this.Parameters.windEnabled);
    if (Key === "sun") {
      if (this.Parameters.sunIntensity) {
        this.SavedSun = this.Parameters.sunIntensity;
        this.ApplyParameter("sunIntensity", 0);
      } else this.ApplyParameter("sunIntensity", this.SavedSun || 2.6);
    }
  }

  ConstructPresetCards() {
    const Search = Select("#preset-search").value.toLowerCase().trim();
    const Keys = Object.keys(PresetPresentation).filter((Key) => {
      const Presentation = PresetPresentation[Key];
      return (
        (this.Filter === "all" || Presentation[1] === this.Filter) &&
        `${Presentation.join(" ")} ${PRESETS[Key].description}`
          .toLowerCase()
          .includes(Search)
      );
    });
    Select("#preset-count").textContent = Object.keys(PRESETS).length;
    Select("#presets-list").innerHTML = Keys.map((Key) => {
      const [Name, Category, Description, Glyph] = PresetPresentation[Key];
      return `<button class="preset-card ${this.Preset === Key ? "active" : ""}" data-preset="${Key}" data-category="${Category}" title="${Escape(PRESETS[Key].description)}" aria-label="Load ${Name}"><span class="preset-swatch">${Icon(Glyph)}</span><span class="preset-copy"><strong>${Name}</strong><small>${Description}</small></span><span class="preset-arrow">↗</span></button>`;
    }).join("");
    Select("#empty-presets").hidden = Keys.length > 0;
    SelectAll("[data-filter]").forEach((Button) =>
      Button.classList.toggle("active", Button.dataset.filter === this.Filter),
    );
  }

  LoadPreset(Key) {
    this.ApplySceneParameters(ConstructPresetParameters(Key));
    this.Preset = Key;
    this.Names.garment = PresetPresentation[Key][0];
    Select("#document-name").value = PresetPresentation[Key][0];
    this.Selection = "garment";
    this.Tab = "source";
    this.Camera.reset();
    if (PRESETS[Key].triggerTwirlOnLoad) this.Engine?.triggerImpulse("twirl");
    this.ConstructPresetCards();
    this.ConstructSceneRows();
    this.ConstructInspector();
    this.RefreshControls();
    this.GraphEditor.render(this.Engine?.time || 0);
    this.Notify(
      `${PresetPresentation[Key][0]} draped on human avatar · ${this.Engine?.vertexCount || 2464} vertices`,
    );
  }

  ApplySceneParameters(Parameters) {
    Object.assign(this.Parameters, Parameters);
    try {
      if (this.Avatar.setBodyType(this.Parameters.avatarBodyType ?? 0)) {
        this.Engine?.initAvatarBuffers();
      }
      this.Engine?.rebuildDress(this.Parameters);
      this.ResizeViewport();
    } catch (ErrorValue) {
      this.ShowGpuError(ErrorValue.message);
    }
    this.MarkDirty();
  }

  RenderControl(Key) {
    const Control = ControlSpecification[Key];
    const Label = Escape(ControlLabels[Key] || Control.label);
    const Value = this.Parameters[Key];
    this.VisibleKeys.push(Key);
    if (Control.type === "toggle")
      return `<div class="property-row toggle-row"><label class="property-label" for="property-${Key}">${Label}</label><label class="switch"><input id="property-${Key}" type="checkbox" data-param="${Key}" ${Value ? "checked" : ""}/><span></span></label></div>`;
    if (Control.type === "select")
      return `<div class="property-row select-row"><label class="property-label" for="property-${Key}">${Label}</label><select id="property-${Key}" data-param="${Key}">${Control.options.map((Option) => `<option value="${Option.id ?? Option.value}" ${(Option.id ?? Option.value) === Value ? "selected" : ""}>${Escape(Option.label)}</option>`).join("")}</select></div>`;
    const Unit =
      {
        skirtLength: "m",
        necklineDepth: "m",
        strapWidth: "m",
        sleeveDrape: "m",
        pleatDepth: "m",
        clothThickness: "m",
        windSpeed: "m/s",
        gravity: "m/s²",
        sunElevation: "°",
        sunAzimuth: "°",
        windDirection: "°",
        timeScale: "×",
        renderScale: "×",
        avatarMotionSpeed: "×",
        weaveScale: "×",
        arealDensity: "g/m²",
        windResponse: "×",
      }[Key] || "—";
    return `<div class="property-row slider-row"><label class="property-label" for="property-${Key}">${Label}</label><div class="slider-control"><div class="value-pill"><input id="property-${Key}" data-param="${Key}" type="number" value="${FormatNumber(Value, Control.step)}" min="${Control.min}" max="${Control.max}" step="${Control.step}"/><span class="unit-cell" aria-hidden="true">${Unit}</span></div><input type="range" aria-label="${Label} slider" data-param="${Key}" min="${Control.min}" max="${Control.max}" step="${Control.step}" value="${Value}"/></div></div>`;
  }

  ConstructInspector() {
    this.VisibleKeys = [];
    const Key = this.Selection;
    Select("#object-name").value = this.Names[Key];
    Select("#object-type").textContent = {
      garment: "TAILORED GARMENT MESH",
      avatar: "16-CAPSULE HUMAN BODY",
      wind: "AERODYNAMIC TURBULENCE",
      sun: "STUDIO KEY LIGHT",
    }[Key];
    Select("#object-symbol").innerHTML = Icon(
      { garment: "dress", avatar: "avatar", wind: "wind", sun: "sun" }[Key],
    );
    Select("#viewport-object").textContent = this.Names[Key];
    SelectAll("[data-tab]").forEach((Button) =>
      Button.classList.toggle("active", this.Tab === Button.dataset.tab),
    );

    const Groups = [];
    const AddGroup = (Title, Keys, Badge = "", Open = true, Hint = "") =>
      Groups.push(
        `<details class="property-group" ${Open ? "open" : ""}><summary>${Title}<span class="section-badge">${Badge}</span></summary><div class="group-content">${Hint ? `<p class="property-hint">${Hint}</p>` : ""}${Keys.map((Property) => this.RenderControl(Property)).join("")}</div></details>`,
      );

    if (this.Tab === "source") {
      AddGroup(
        "Silhouette & mesh resolution",
        [
          "garmentEnabled",
          "avatarBodyType",
          "gridResolution",
          "pieAutoResolution",
          "dressStyle",
          "skirtLength",
          "skirtFlare",
          "waistCinch",
          "asymmetry",
        ],
        "PATTERN",
        true,
        "Switch between Female & Male sculpted mannequins and adjust Garment mesh resolution (32–320).",
      );
      AddGroup(
        "Bodice & neckline",
        ["necklineDepth", "strapWidth", "sleeveDrape"],
        "BODICE",
        true,
      );
      AddGroup(
        "Radial pleats & folds",
        ["pleatCount", "pleatDepth", "bendStiffness"],
        "PLEATS",
        true,
      );
    }

    if (this.Tab === "simulation") {
      AddGroup(
        "PIE optimal mesh (SIGGRAPH '25)",
        [
          "pieAutoResolution",
          "pieAnisotropy",
          "pieLockingRelief",
          "pieShirringRatio",
          "pieDownPressure",
        ],
        "PIE",
        true,
        "Zhang et al. 2025: Cerda-Mahadevan wrinkle wavelength λ(B/E), Vandeparre wrinklon transition L_w, orthotropic anisotropy, and in-plane compressive locking relief.",
      );
      AddGroup(
        "Human avatar & pose",
        [
          "avatarVisible",
          "avatarBodyType",
          "avatarPose",
          "avatarMotionSpeed",
          "avatarFinish",
          "clothThickness",
          "bodyFriction",
        ],
        "AVATAR",
        true,
        "16 articulated anatomical capsules collide with every cloth vertex in the WebGPU compute pass.",
      );
      AddGroup(
        "WebGPU XPBD solver",
        [
          "gridResolution",
          "substeps",
          "stretchCompliance",
          "shearCompliance",
          "gravity",
          "damping",
          "timeScale",
        ],
        "XPBD",
        true,
      );
      AddGroup(
        "Aerodynamic wind",
        ["windEnabled", "windSpeed", "windDirection", "windTurbulence"],
        "FLOW",
        Key === "wind",
      );
    }

    if (this.Tab === "rendering") {
      AddGroup(
        "Fabric preset & physical response",
        [
          "fabricPreset",
          "arealDensity",
          "windResponse",
          "stretchCompliance",
          "shearCompliance",
          "bendStiffness",
          "damping",
          "clothThickness",
        ],
        "MATERIAL",
        true,
        "Preset profiles set textile weight, wind response, XPBD stretch/shear and bend stiffness, damping, thickness, roughness, sheen and procedural weave together. Heavier fabric receives more gravitational loading and less wind acceleration in both GPU backends.",
      );
      AddGroup(
        "Substance weave & dye",
        [
          "colorPalette",
          "weaveType",
          "weaveScale",
          "weaveBump",
          "sheenIntensity",
          "fabricRoughness",
          "hemTrim",
          "subsurfaceScatter",
        ],
        "FABRIC",
        true,
        "Fabric-specific cotton, denim, wool, leather, velvet, silk and brocade grain with material-matched roughness and sheen.",
      );
      AddGroup(
        "Studio lighting",
        [
          "sunIntensity",
          "sunElevation",
          "sunAzimuth",
          "ambientIntensity",
          "exposure",
        ],
        "LIGHT",
        Key === "sun",
      );
      AddGroup(
        "Viewport & overlays",
        [
          "renderChannel",
          "renderScale",
          "showSeamLines",
          "showFloorGrid",
          "showBoundingBox",
          "showAtlasMinimap",
        ],
        "DEBUG",
        false,
      );
    }

    Select("#inspector-body").innerHTML = Groups.join("");
    Select("#inspector-body").scrollTop = 0;
    this.RefreshControls();
  }

  AddObject(Kind) {
    Select("#add-menu").hidden = true;
    Select("#add-button").setAttribute("aria-expanded", "false");
    if (Kind === "gown") {
      this.LoadPreset("emerald_evening_gown");
    } else if (Kind === "pleated") {
      this.LoadPreset("sunburst_pleated_midi");
    } else if (Kind === "ballgown") {
      this.LoadPreset("couture_ballgown");
    } else if (Kind === "noir-coat") {
      this.LoadPreset("noir_tuxedo_coat_gown");
    } else if (Kind === "ivory-wrap") {
      this.LoadPreset("ivory_embroidered_wrap_gown");
    } else if (Kind === "female-body") {
      this.ApplyParameter("avatarBodyType", 0);
      this.Notify("Switched to sculpted Female couture mannequin.");
    } else if (Kind === "male-body") {
      this.ApplyParameter("avatarBodyType", 1);
      this.Notify("Switched to sculpted Male tailoring mannequin.");
    } else if (Kind === "catwalk") {
      this.ApplyParameter("avatarPose", 1);
      this.SelectObject("avatar");
      this.Notify("Human avatar switched to Runway Catwalk stride.");
    } else if (Kind === "twirl") {
      this.ApplyParameter("avatarPose", 2);
      this.TriggerBurst("twirl");
      this.Notify("360° Couture twirl activated.");
    } else if (Kind === "studio") {
      this.ApplyParameter("avatarPose", 0);
      this.SelectObject("avatar");
      this.Notify("Human avatar switched to Studio Contrapposto pose.");
    }
  }

  Restart() {
    this.Bursts = [];
    if (this.Engine) {
      this.Engine.clearGrid();
      this.Engine.time = 0;
      this.Engine.stepCount = 0;
      this.Engine.setBrush(null, null, false);
    }
    this.SingleStep = false;
  }

  TriggerBurst(Kind = Select("#burst-kind").value) {
    if (!this.Engine)
      return this.Notify("The GPU solver must be available to trigger motion.");
    this.Engine.triggerImpulse(Kind);
    const Labels = {
      twirl: "360° Couture twirl triggered — centrifugal skirt flare active.",
      catwalk: "Runway catwalk stride toggled on human avatar.",
      updraft: "Updraft wind gust billowing dress hemline.",
      crosswind: "Turbulent lateral crosswind sweeping across fabric.",
      redrape: "Dress lifted and re-draped onto human mannequin.",
    };
    this.Notify(Labels[Kind] || "Motion impulse triggered.");
    this.RefreshControls();
  }

  SaveScene() {
    const Scene = {
      format: "frontier-cloth-scene",
      version: 1,
      sourceRevision: SourceRevision,
      name: Select("#document-name").value.trim() || "Untitled garment",
      params: { ...this.Parameters },
      names: { ...this.Names },
      camera: {
        theta: this.Camera.targetTheta,
        phi: this.Camera.targetPhi,
        distance: this.Camera.targetDistance,
        center: [...this.Camera.targetCenter],
      },
    };
    const Url = URL.createObjectURL(
      new Blob([JSON.stringify(Scene, null, 2)], { type: "application/json" }),
    );
    const Link = document.createElement("a");
    Link.href = Url;
    Link.download = `${Scene.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "garment"}.cloth.json`;
    Link.click();
    setTimeout(() => URL.revokeObjectURL(Url), 1000);
    this.Dirty = false;
    this.RefreshControls();
    this.Notify("Garment pattern and material settings saved.");
  }

  async OpenScene(File) {
    if (!File) return;
    try {
      if (File.size > 256 * 1024)
        throw new Error("Scene settings must be smaller than 256 KB.");
      const Scene = ValidateScene(JSON.parse(await File.text()));
      this.ApplySceneParameters(Scene.Parameters);
      this.Names = Scene.Names;
      Select("#document-name").value = Scene.Name;
      if (Scene.Camera) {
        this.Camera.targetTheta = Scene.Camera.theta;
        this.Camera.targetPhi = Scene.Camera.phi;
        this.Camera.targetDistance = Scene.Camera.distance;
        this.Camera.targetCenter = Scene.Camera.center;
      }
      this.Preset = "";
      this.Selection = "garment";
      this.Tab = "source";
      this.Dirty = false;
      this.ConstructPresetCards();
      this.ConstructSceneRows();
      this.ConstructInspector();
      this.RefreshControls();
      this.GraphEditor.render(this.Engine?.time || 0);
      this.Notify("Garment settings opened and re-draped on avatar.");
    } catch (ErrorValue) {
      this.Notify(`Garment not opened: ${ErrorValue.message}`);
    } finally {
      Select("#import-file").value = "";
    }
  }

  async ImportAvatarObj(File) {
    if (!File) return;
    try {
      const Text = await File.text();
      this.Avatar.loadWavefrontObj(Text);
      this.Engine?.initAvatarBuffers();
      this.Engine?.rebuildDress(this.Parameters);
      this.Names.avatar = File.name.replace(/\.obj$/i, "") || "Custom body";
      this.ConstructSceneRows();
      this.Notify(
        `Imported custom body mesh (${this.Avatar.vertexCount.toLocaleString()} vertices) and fitted dress.`,
      );
    } catch (ErrorValue) {
      this.Notify(`Body import failed: ${ErrorValue.message}`);
    } finally {
      Select("#import-avatar-file").value = "";
    }
  }

  ConnectInterface() {
    const FabricSelect = Select("#fabric-preset-select");
    if (FabricSelect) {
      FabricSelect.innerHTML = FABRIC_PRESETS.map(
        (Material) => `<option value="${Material.id}">${Escape(Material.label)}</option>`,
      ).join("");
      FabricSelect.addEventListener("change", (Event) => {
        const Material = FABRIC_PRESETS.find((Item) => Item.id === Number(Event.target.value));
        this.ApplyParameter("fabricPreset", Number(Event.target.value));
        if (Material) this.Notify(`${Material.label} applied · physics, texture, and wind response updated.`);
      });
    }

    ["#render-channel", "#diagnostic-channel"].forEach((Selector) => {
      Select(Selector).innerHTML = DEBUG_CHANNELS.map(
        (Channel) => `<option value="${Channel.id}">${Channel.label}</option>`,
      ).join("");
      Select(Selector).addEventListener("change", (Event) =>
        this.ApplyParameter("renderChannel", Number(Event.target.value)),
      );
    });

    // Split workspace view mode buttons (Editor | 3D Sim, Editor Only, 3D Sim Only)
    Select("#split-mode-group").addEventListener("click", (Event) => {
      const Btn = Event.target.closest("[data-split-mode]");
      if (!Btn) return;
      const Mode = Btn.dataset.splitMode;
      SelectAll("#split-mode-group button").forEach((b) =>
        b.classList.toggle("active", b === Btn),
      );
      const Vp = Select("#viewport");
      Vp.classList.toggle("mode-editor-only", Mode === "editor");
      Vp.classList.toggle("mode-sim-only", Mode === "sim");
      this.ResizeViewport();
      setTimeout(() => this.GraphEditor.frameAll(), 30);
    });

    // Substance Editor submode buttons (Graph + 2D, Node Graph, 2D Pattern)
    Select("#editor-submode").addEventListener("click", (Event) => {
      const Btn = Event.target.closest("[data-submode]");
      if (!Btn) return;
      const Sub = Btn.dataset.submode;
      SelectAll("#editor-submode button").forEach((b) =>
        b.classList.toggle("active", b === Btn),
      );
      const Stack = Select("#editor-canvas-stack");
      Stack.classList.toggle("submode-graph", Sub === "graph");
      Stack.classList.toggle("submode-pattern", Sub === "pattern");
      setTimeout(() => this.GraphEditor.frameAll(), 30);
    });

    Select("#graph-autolayout").addEventListener("click", () =>
      this.GraphEditor.autoLayout(),
    );
    Select("#graph-frame").addEventListener("click", () =>
      this.GraphEditor.frameAll(),
    );

    // Quick sliders in the Substance Node Graph bottom bar
    Select("#quick-grid-res")?.addEventListener("input", (e) =>
      this.ApplyParameter("gridResolution", Number(e.target.value)),
    );
    Select("#quick-skirt-length").addEventListener("input", (e) =>
      this.ApplyParameter("skirtLength", Number(e.target.value)),
    );
    Select("#quick-skirt-flare").addEventListener("input", (e) =>
      this.ApplyParameter("skirtFlare", Number(e.target.value)),
    );
    Select("#quick-pleats").addEventListener("input", (e) =>
      this.ApplyParameter("pleatCount", Number(e.target.value)),
    );

    // Top viewport bar mannequin body form selector (Female / Male)
    Select("#body-type-select")?.addEventListener("change", (e) => {
      const bodyType = Number(e.target.value);
      this.ApplyParameter("avatarBodyType", bodyType);
      this.Notify(
        bodyType === 1
          ? "Switched to sculpted Male tailoring mannequin and re-fitted garment."
          : "Switched to sculpted Female couture mannequin and re-fitted garment.",
      );
    });

    // Top viewport bar garment resolution dropdown & clickable HUD badge
    Select("#mesh-res-select")?.addEventListener("change", (e) => {
      this.ApplyParameter("gridResolution", Number(e.target.value));
      this.Notify(
        `Garment mesh resolution set to ${this.Engine?.numCols || e.target.value}×${this.Engine?.numRows || ""} (${(this.Engine?.vertexCount || 0).toLocaleString()} vertices).`,
      );
    });
    Select("#grid-hud")?.addEventListener("click", () => {
      const cycle = [144, 192, 256, 320, 96];
      const cur = this.Parameters.gridResolution;
      const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
      this.ApplyParameter("gridResolution", next);
      this.Notify(
        `Garment mesh resolution cycled to ${this.Engine?.numCols || next}×${this.Engine?.numRows || ""} (${(this.Engine?.vertexCount || 0).toLocaleString()} vertices).`,
      );
    });

    // Draggable vertical splitter between Left Editor and Right 3D Simulation
    const Splitter = Select("#pane-splitter");
    let SplitDrag = false;
    Splitter.addEventListener("pointerdown", (e) => {
      Splitter.setPointerCapture(e.pointerId);
      SplitDrag = true;
      Splitter.classList.add("dragging");
    });
    Splitter.addEventListener("pointermove", (e) => {
      if (!SplitDrag) return;
      const VpRect = Select("#viewport").getBoundingClientRect();
      const Pct = Math.max(
        26,
        Math.min(70, ((e.clientX - VpRect.left) / VpRect.width) * 100),
      );
      Select("#viewport").style.setProperty("--editor-split", `${Pct.toFixed(1)}%`);
      this.ResizeViewport();
      this.GraphEditor.render(this.Engine?.time || 0);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((Name) =>
      Splitter.addEventListener(Name, () => {
        SplitDrag = false;
        Splitter.classList.remove("dragging");
      }),
    );

    Select("#scene-tree").addEventListener("click", (Event) => {
      const Toggle = Event.target.closest("[data-toggle-object]");
      if (Toggle) return this.ToggleObject(Toggle.dataset.toggleObject);
      const Row = Event.target.closest("[data-object]");
      if (Row) this.SelectObject(Row.dataset.object);
    });
    Select("#scene-search").addEventListener("input", () =>
      this.ConstructSceneRows(),
    );
    Select("#scene-filters").addEventListener("click", (Event) => {
      const Filter = Event.target.closest("[data-scene-filter]");
      if (Filter) {
        this.SceneFilter = Filter.dataset.sceneFilter;
        this.ConstructSceneRows();
      }
    });
    Select("#compact-outliner").addEventListener("click", () => {
      const Compact =
        Select(".left-panel").classList.toggle("compact-outliner");
      Select("#compact-outliner").setAttribute("aria-pressed", String(Compact));
    });
    Select("#collection-toggle").addEventListener("click", () => {
      const Expanded =
        Select("#collection-toggle").getAttribute("aria-expanded") === "true";
      Select("#collection-toggle").setAttribute(
        "aria-expanded",
        String(!Expanded),
      );
      Select("#scene-tree").hidden = Expanded;
    });
    Select("#scene-tree").addEventListener("keydown", (Event) => {
      if (!Event.target.matches("[data-object]")) return;
      if (Event.key === "Enter") this.SelectObject(Event.target.dataset.object);
      const Rows = SelectAll("#scene-tree [data-object]");
      const Index = Rows.indexOf(Event.target);
      if (Event.key === "ArrowDown" || Event.key === "ArrowUp") {
        Event.preventDefault();
        Rows[
          Math.max(
            0,
            Math.min(
              Rows.length - 1,
              Index + (Event.key === "ArrowDown" ? 1 : -1),
            ),
          )
        ].focus();
      }
    });
    Select("#scene-tree").addEventListener("dblclick", (Event) => {
      if (Event.target.closest("[data-object]")) {
        Select("#object-name").focus();
        Select("#object-name").select();
      }
    });
    Select("#object-name").addEventListener("change", (Event) => {
      this.Names[this.Selection] =
        Event.target.value.trim() || this.Names[this.Selection];
      Event.target.value = this.Names[this.Selection];
      this.ConstructSceneRows();
      Select("#viewport-object").textContent = this.Names[this.Selection];
      this.MarkDirty();
    });
    Select("#document-name").addEventListener("input", () => this.MarkDirty());
    Select("#object-enabled").addEventListener("change", () =>
      this.ToggleObject(this.Selection),
    );
    Select("#presets-list").addEventListener("click", (Event) => {
      const Button = Event.target.closest("[data-preset]");
      if (Button) this.LoadPreset(Button.dataset.preset);
    });
    Select("#preset-search").addEventListener("input", () =>
      this.ConstructPresetCards(),
    );
    Select("#reset-search").addEventListener("click", () => {
      Select("#preset-search").value = "";
      this.Filter = "all";
      this.ConstructPresetCards();
    });
    Select("#preset-filters").addEventListener("click", (Event) => {
      if (Event.target.dataset.filter) {
        this.Filter = Event.target.dataset.filter;
        this.ConstructPresetCards();
      }
    });
    Select("#inspector-tabs").addEventListener("click", (Event) => {
      if (Event.target.dataset.tab) {
        this.Tab = Event.target.dataset.tab;
        this.ConstructInspector();
      }
    });
    Select("#inspector-body").addEventListener("input", (Event) => {
      if (Event.target.type === "range")
        this.ApplyParameter(
          Event.target.dataset.param,
          Number(Event.target.value),
        );
    });
    Select("#inspector-body").addEventListener("change", (Event) => {
      const Element = Event.target;
      if (Element.dataset.param)
        this.ApplyParameter(
          Element.dataset.param,
          Element.type === "checkbox" ? Element.checked : Number(Element.value),
        );
    });
    Select("#reset-properties").addEventListener("click", () => {
      this.VisibleKeys.forEach((Key) =>
        this.ApplyParameter(Key, InitialParameters[Key]),
      );
      this.Notify("Visible inspector properties restored to atelier defaults.");
    });
    Select("#add-button").addEventListener("click", () => {
      const Menu = Select("#add-menu");
      const Rectangle = Select("#add-button").getBoundingClientRect();
      Menu.hidden = !Menu.hidden;
      Menu.style.top = `${Rectangle.bottom + 5}px`;
      Menu.style.left = `${Rectangle.left - 12}px`;
      Select("#add-button").setAttribute("aria-expanded", String(!Menu.hidden));
    });
    Select("#add-menu").addEventListener("click", (Event) => {
      const Button = Event.target.closest("[data-add]");
      if (Button) this.AddObject(Button.dataset.add);
    });
    document.addEventListener("pointerdown", (Event) => {
      if (!Event.target.closest("#add-menu, #add-button")) {
        Select("#add-menu").hidden = true;
        Select("#add-button").setAttribute("aria-expanded", "false");
      }
    });
    SelectAll("[data-tool]").forEach((Button) =>
      Button.addEventListener("click", () =>
        this.ApplyParameter("interactionMode", Button.dataset.tool),
      ),
    );
    Select("#play-button").addEventListener("click", () =>
      this.ApplyParameter("paused", !this.Parameters.paused),
    );
    Select("#step-button").addEventListener("click", () => {
      this.ApplyParameter("paused", true);
      this.SingleStep = true;
    });
    Select("#reset-button").addEventListener("click", () => {
      this.Restart();
      this.Notify("Dress re-draped onto human character.");
    });
    Select("#burst-button").addEventListener("click", () =>
      this.TriggerBurst(),
    );
    Select("#speed-select").addEventListener("change", (Event) =>
      this.ApplyParameter("timeScale", Number(Event.target.value)),
    );
    Select("#overlays-button").addEventListener("click", () =>
      this.ApplyParameter("showSeamLines", !this.Parameters.showSeamLines),
    );
    Select("#turntable-button").addEventListener("click", () =>
      this.ApplyParameter("autoTurntable", !this.Parameters.autoTurntable),
    );
    Select("#focus-button").addEventListener("click", () => this.FocusVolume());
    Select("#maximize-button").addEventListener("click", () => {
      Select("#app").classList.toggle("maximized");
      this.ResizeViewport();
      setTimeout(() => this.GraphEditor.frameAll(), 30);
    });
    Select("#camera-view").addEventListener("change", (Event) => {
      const View = Event.target.value;
      if (View === "perspective") this.FocusVolume();
      else {
        this.Camera.targetTheta = View === "side" ? Math.PI / 2 : 0;
        this.Camera.targetPhi = View === "top" ? 0.08 : Math.PI / 2;
        this.MarkDirty();
      }
    });
    Select("#atlas-toggle").addEventListener("change", (Event) =>
      this.ApplyParameter("showAtlasMinimap", Event.target.checked),
    );
    Select("#backend-select").addEventListener("change", (Event) => {
      this.InitializeRenderer(Event.target.value);
      this.Notify("GPU backend switched.");
    });
    Select("#retry-gpu").addEventListener("click", () =>
      this.InitializeRenderer("webgpu"),
    );
    Select("#export-button").addEventListener("click", () => this.SaveScene());
    Select("#import-button").addEventListener("click", () =>
      Select("#import-file").click(),
    );
    Select("#import-file").addEventListener("change", (Event) =>
      this.OpenScene(Event.target.files[0]),
    );
    Select("#import-avatar-button").addEventListener("click", () =>
      Select("#import-avatar-file").click(),
    );
    Select("#import-avatar-file").addEventListener("change", (Event) =>
      this.ImportAvatarObj(Event.target.files[0]),
    );
    Select("#help-button").addEventListener("click", () =>
      Select("#help-dialog").showModal(),
    );
    Select("#close-help").addEventListener("click", () =>
      Select("#help-dialog").close(),
    );
    Select("#diagnostics-button").addEventListener("click", () => {
      Select("#diagnostics").hidden = !Select("#diagnostics").hidden;
    });
    Select("#close-diagnostics").addEventListener("click", () => {
      Select("#diagnostics").hidden = true;
    });
    Select("#library-button").addEventListener("click", () => {
      Select("#app").classList.toggle("mobile-library");
      Select("#preset-search").focus();
    });
    Select("#workspace-button").addEventListener("click", () => {
      Select("#app").classList.remove("mobile-library", "maximized");
      Select("#diagnostics").hidden = true;
      this.ResizeViewport();
    });
    document.addEventListener("keydown", (Event) => this.KeyPress(Event));
    document.addEventListener("visibilitychange", () => {
      this.LastTime = performance.now();
      if (document.hidden) this.Engine?.setBrush(null, null, false);
    });
    window.addEventListener("blur", () =>
      this.Engine?.setBrush(null, null, false),
    );
  }

  FocusVolume() {
    this.Camera.reset();
    Select("#camera-view").value = "perspective";
    this.MarkDirty();
  }

  KeyPress(Event) {
    if (
      (Event.ctrlKey || Event.metaKey) &&
      Event.shiftKey &&
      Event.key.toLowerCase() === "f"
    ) {
      Event.preventDefault();
      Select("#scene-search").focus();
      return;
    }
    if ((Event.ctrlKey || Event.metaKey) && Event.key.toLowerCase() === "s") {
      Event.preventDefault();
      document.activeElement?.blur();
      this.SaveScene();
      return;
    }
    if (
      Select("#help-dialog").open ||
      Event.target.closest("input,select,textarea,[contenteditable]")
    )
      return;
    if (Event.ctrlKey || Event.metaKey || Event.altKey || Event.repeat) return;
    const Key = Event.key.toLowerCase();
    const Actions = {
      " ": () => this.ApplyParameter("paused", !this.Parameters.paused),
      s: () => {
        this.ApplyParameter("paused", true);
        this.SingleStep = true;
      },
      r: () => {
        this.Restart();
        this.Notify("Dress re-draped onto human character.");
      },
      d: () => this.TriggerBurst(),
      f: () => {
        this.FocusVolume();
        this.GraphEditor.frameAll();
      },
      b: () =>
        this.ApplyParameter("showSeamLines", !this.Parameters.showSeamLines),
      t: () =>
        this.ApplyParameter("autoTurntable", !this.Parameters.autoTurntable),
      1: () => this.ApplyParameter("interactionMode", "orbit"),
      2: () => this.ApplyParameter("interactionMode", "drape"),
      3: () => this.ApplyParameter("interactionMode", "gust"),
      "/": () => {
        Select("#app").classList.add("mobile-library");
        Select("#preset-search").focus();
      },
      escape: () => {
        Select("#app").classList.remove("maximized", "mobile-library");
        Select("#add-menu").hidden = true;
        Select("#diagnostics").hidden = true;
      },
    };
    if (Actions[Key]) {
      Event.preventDefault();
      Actions[Key]();
    }
  }

  ConnectViewport() {
    let Drag = null;
    const Hit = (Event) => {
      if (!this.Engine) return null;
      const Rectangle = this.Canvas.getBoundingClientRect();
      const Bounds = this.Engine.getBoundsBox();
      return this.Camera.raycastVolumeUVW(
        ((Event.clientX - Rectangle.left) / Rectangle.width) * 2 - 1,
        1 - ((Event.clientY - Rectangle.top) / Rectangle.height) * 2,
        Bounds.boxMin,
        Bounds.boxMax,
      );
    };
    this.Canvas.addEventListener("contextmenu", (Event) =>
      Event.preventDefault(),
    );
    this.Canvas.addEventListener("pointerdown", (Event) => {
      if (Event.button > 2) return;
      this.Canvas.setPointerCapture(Event.pointerId);
      const Mode =
        Event.button === 2 || Event.button === 1
          ? "pan"
          : Event.shiftKey
            ? "drape"
            : this.Parameters.interactionMode;
      Drag = { X: Event.clientX, Y: Event.clientY, Mode, Hit: Hit(Event) };
      if (Mode === "gust") {
        this.TriggerBurst("twirl");
      }
      if (Mode === "drape" && Drag.Hit) {
        this.Engine?.setBrush(Drag.Hit, [0, 1.5, 0], true);
      }
    });
    this.Canvas.addEventListener("pointermove", (Event) => {
      if (!Drag) return;
      const DeltaX = Event.clientX - Drag.X;
      const DeltaY = Event.clientY - Drag.Y;
      if (Drag.Mode === "orbit") {
        this.Camera.orbit(DeltaX, DeltaY);
        this.MarkDirty();
      }
      if (Drag.Mode === "pan") {
        this.Camera.pan(DeltaX, DeltaY);
        this.MarkDirty();
      }
      if (Drag.Mode === "drape") {
        const Position = Hit(Event);
        const Velocity = Position?.map(
          (Value, Index) =>
            (Value - (Drag.Hit?.[Index] ?? Value)) * 42 + (Index === 1 ? 1.2 : 0),
        );
        this.Engine?.setBrush(Position, Velocity, !!Position);
        Drag.Hit = Position;
      }
      Drag.X = Event.clientX;
      Drag.Y = Event.clientY;
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((Name) =>
      this.Canvas.addEventListener(Name, () => {
        Drag = null;
        this.Engine?.setBrush(null, null, false);
      }),
    );
    this.Canvas.addEventListener(
      "wheel",
      (Event) => {
        Event.preventDefault();
        this.Camera.zoom(Math.max(-100, Math.min(100, Event.deltaY)));
        this.MarkDirty();
      },
      { passive: false },
    );
  }

  Frame(Time) {
    requestAnimationFrame((NextTime) => this.Frame(NextTime));
    const Delta = Math.max(0.001, (Time - this.LastTime) / 1000);
    this.LastTime = Time;
    if (document.hidden || this.Switching || !Select("#gpu-error").hidden)
      return;
    this.Elapsed += Delta;
    this.Frames++;
    if (this.Parameters.autoTurntable)
      this.Camera.targetTheta += Math.min(Delta, 0.05) * 0.35;
    this.Camera.update(Math.min(Delta, 0.1));

    if (this.Engine) {
      try {
        if (!this.Parameters.paused || this.SingleStep) {
          this.Engine.stepSimulation(this.SingleStep ? 1 / 60 : Delta);
          this.SingleStep = false;
        }
        this.Engine.render(this.Camera);
      } catch (ErrorValue) {
        this.ShowGpuError(ErrorValue.message);
      }
    }

    // Animate Substance Graph signal pulses & 2D pattern view
    this.GraphEditor.render(this.Engine?.time || Time * 0.001);

    if (this.Elapsed >= 0.5) {
      this.FramesPerSecond = Math.round(this.Frames / this.Elapsed);
      this.Frames = 0;
      this.Elapsed = 0;
      Select("#fps").textContent = this.Parameters.paused
        ? "—"
        : this.FramesPerSecond;
      const Seconds = this.Engine?.time || 0;
      Select("#timecode").textContent =
        `${String(Math.floor(Seconds / 60)).padStart(2, "0")}:${(Seconds % 60).toFixed(3).padStart(6, "0")}`;
      Select("#frame-counter").textContent =
        `FRAME ${String(this.Engine?.stepCount || 0).padStart(4, "0")}`;
      Select("#playhead").style.left = `${((Seconds % 30) / 30) * 100}%`;
      const Origin = Math.floor(Seconds / 30) * 30;
      SelectAll(".ruler-numbers span").forEach((Element, Index) => {
        Element.textContent = `${Origin + Index * 5}s`;
      });

      const Cols = this.Engine?.numCols || this.Parameters.gridResolution;
      const Rows = this.Engine?.numRows || Math.round(Cols * 0.78);
      const Verts = this.Engine?.vertexCount || Cols * Rows;
      const Springs = this.Engine?.constraintCount || Verts * 5;
      const Pie = this.Engine?.pieReport;
      Select("#diagnostic-values").innerHTML =
        `<dt>Backend</dt><dd>${this.Backend === "webgpu" ? "WebGPU (WGSL)" : "WebGL2"}</dd><dt>Cloth mesh</dt><dd>${Cols} × ${Rows} (${Verts.toLocaleString()} vtx)</dd><dt>PIE r_weft / r_warp</dt><dd>${Pie ? `${Pie.rWeftOptMm} mm / ${Pie.rWarpOptMm} mm` : "5.4 mm / 7.2 mm"}</dd><dt>PIE λ / L_w</dt><dd>${Pie ? `λ ${Pie.wavelengthMm} mm · L_w ${Pie.wrinklonLwMm} mm` : "—"}</dd><dt>XPBD springs</dt><dd>${Springs.toLocaleString()} (${this.Parameters.substeps} substeps)</dd><dt>Avatar collider</dt><dd>16 capsules (${this.Avatar.vertexCount.toLocaleString()} vtx)</dd><dt>Solver pass</dt><dd>${(this.Engine?.simDurationMs || 0).toFixed(2)} ms</dd>`;
    }
  }
}

window.fluidEditor = new ClothPanel();
window.clothEditor = window.fluidEditor;

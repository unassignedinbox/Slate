import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Inspector, Icon, Glyph, Panels } from "./Inspectors.jsx";
import Notch from "./Notch.jsx";
import "./Editor.css";
const InitialRows = [
  ["showcase", "Showcase", "group", "folder-scene", null, "Scene collection"],
  ["cube", "Cube", "geometry", "editor-cube", "showcase", "Geometry"],
  ["sphere", "Sphere", "geometry", "editor-sphere", "showcase", "Geometry"],
  [
    "cylinder",
    "Cylinder",
    "geometry",
    "editor-cylinder",
    "showcase",
    "Geometry",
  ],
  ["torus", "Torus", "geometry", "editor-torus", "showcase", "Geometry"],
  ["cone", "Cone", "geometry", "editor-cone", "showcase", "Geometry"],
  ["cameras", "Cameras", "group", "camera", null, "Camera collection"],
  [
    "camera",
    "Main Camera",
    "camera",
    "camera",
    "cameras",
    "Live projection · aperture and focus are diagnostics only",
  ],
  [
    "cine",
    "Cine Camera",
    "camera",
    "camera",
    "cameras",
    "Inactive optical study",
  ],
  [
    "post",
    "Post Process",
    "post",
    "environment-exposure",
    "cameras",
    "Post processing",
  ],
  ["world", "World", "group", "folder-world", null, "Environment"],
  [
    "atmosphere",
    "Atmosphere",
    "atmosphere",
    "sky-scattering",
    "world",
    "Procedural sky",
  ],
  ["sun", "Sun", "sun", "sun", "world", "Directional light"],
  ["flare", "Lens Flare", "flare", "lens-flare", "sun", "Sun optical effect"],
  ["sky", "Sky", "atmosphere", "sky-scattering", "world", "Atmosphere / Sky"],
  ["moon", "Moons", "moon", "moon", "world", "Lunar bodies · four slots"],
  [
    "stars",
    "Stars",
    "stars",
    "outliner-stars",
    "world",
    "Catalogue field · scintillation · celestial pole",
  ],
  [
    "wind",
    "Wind",
    "wind",
    "wind",
    "world",
    "Wind / Air · shared advection field",
  ],
  [
    "height-fog",
    "Height Fog",
    "height-fog",
    "fog",
    "world",
    "Height fog · exponential vertical density",
  ],
  [
    "aerial-fog",
    "Atmospheric Fog",
    "aerial-fog",
    "fog",
    "world",
    "Aerial perspective · surface-distance fog",
  ],
  [
    "local-fog",
    "Local Fog",
    "local-fog",
    "local-fog",
    "world",
    "Local volumetric fog · bounded medium",
  ],
  ["clouds", "Clouds", "clouds", "clouds", "world", "Global cloud layer"],
  [
    "precipitation",
    "Precipitation",
    "precipitation",
    "outliner-precipitation",
    "clouds",
    "Clouds / Precipitation · world-space simulation",
  ],
  [
    "local-cloud",
    "Local Cloud",
    "local-cloud",
    "local-cloud",
    "world",
    "Bounded volumetric clouds",
  ],
  [
    "rainbow",
    "Rainbow",
    "rainbow",
    "rainbow",
    "atmosphere",
    "Rainbow · liquid-water optics",
  ],
  ["lighting", "Lighting", "group", "folder-generic", null, "Light collection"],
  ["light", "Area Light", "light", "editor-area-light", "lighting", "Light"],
].map(([Id, Name, Panel, Icon, Parent, Description]) => ({
  Id,
  Name,
  Panel,
  Icon,
  Parent,
  Description,
}));
const DefaultSettings = {
  GI: 2,
  Reflection: 2,
  AA: true,
  FPS: false,
  Notifications: true,
  Quality: 2,
  Patches: false,
  Raytracing: true,
  Scale: 100,
};
const DebugViews = [
  "Off",
  "Depth",
  "Visibility ID",
  "Motion Vectors",
  "Cluster ID",
  "HiZ (level 3)",
  "Albedo",
  "Normal",
  "Roughness",
  "Metalness",
  "Shading Normal",
  "Reservoir M",
  "Reservoir W",
  "Reservoir Age",
  "Patch Tiles",
  "Tiles + Wireframe",
];
const StorageKey = "Frontier.ProjectZeroHtml.v1";
function Restore() {
  try {
    return JSON.parse(localStorage.getItem(StorageKey)) || {};
  } catch {
    return {};
  }
}
const Saved = Restore();
function App() {
  const [Debug, SetDebug] = useState(0),
    [HiZ, ToggleHiZ] = useState(true),
    [Alias, ToggleAlias] = useState(true),
    [PatchError, SetPatchError] = useState(1);
  const [Rows, AssignRows] = useState(Saved.Rows || InitialRows),
    [Selected, Select] = useState(Saved.Selected || "sun"),
    [Values, AssignValues] = useState(Saved.Values || {}),
    [Hidden, AssignHidden] = useState(Saved.Hidden || {}),
    [Collapsed, Collapse] = useState(Saved.Collapsed || {}),
    [Query, Search] = useState(""),
    [Filters, Filter] = useState([]),
    [Menu, ShowMenu] = useState(null),
    [Shade, OpenShade] = useState(false),
    [Settings, ChangeSettings] = useState({
      ...DefaultSettings,
      ...Saved.Settings,
    }),
    [Wide, Expand] = useState(false),
    [Name, RenameProject] = useState(Saved.Name || "Project-Zero"),
    [Rename, RenameRow] = useState(null),
    [Construct, OpenConstruct] = useState(false),
    [ConstructQuery, SearchConstruct] = useState(""),
    [Projection, SetProjection] = useState("PERSP"),
    [RunMode, SetRunMode] = useState("EDIT"),
    [Message, Notify] = useState(""),
    [Console, ShowConsole] = useState(false),
    [PaneTabs, AssignTabs] = useState({
      Left: ["Outliner"],
      Centre: ["Viewport"],
      Right: ["Inspector"],
    }),
    [Active, Activate] = useState({
      Left: "Outliner",
      Centre: "Viewport",
      Right: "Inspector",
    }),
    [LeftWidth, ResizeLeft] = useState(316),
    [RightWidth, ResizeRight] = useState(340);
  const FileInput = useRef(null),
    SearchInput = useRef(null),
    Divider = useRef(null);
  const Subject = Rows.find((Row) => Row.Id === Selected) || Rows[0];
  const Assign = (Key, Value) => {
    const Aliases = {
      "Global Illumination": "GI",
      Reflections: "Reflection",
      "FPS Overlay": "FPS",
    };
    ChangeSettings((Previous) => ({
      ...Previous,
      [Key]: Value,
      ...(Aliases[Key] ? { [Aliases[Key]]: Value } : {}),
    }));
  };
  const Change = (Key, Value) =>
    AssignValues((Previous) => ({
      ...Previous,
      [Selected]: { ...Previous[Selected], [Key]: Value },
    }));
  const ToggleHidden = (Id) =>
    AssignHidden((Previous) => ({ ...Previous, [Id]: !Previous[Id] }));
  const Toast = (Text) => {
    Notify(Text);
    setTimeout(() => Notify(""), 3200);
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        StorageKey,
        JSON.stringify({
          Rows,
          Selected,
          Values,
          Hidden,
          Collapsed,
          Settings,
          Name,
        }),
      );
    } catch {}
  }, [Rows, Selected, Values, Hidden, Collapsed, Settings, Name]);
  useEffect(() => {
    const Key = (Event) => {
      if (/INPUT|TEXTAREA|SELECT/.test(Event.target.tagName)) return;
      if (Event.key === "F3") {
        Event.preventDefault();
        SetDebug((Previous) => (Previous + (Event.shiftKey ? 15 : 1)) % 16);
      }
      if (Event.key === "F4") {
        Event.preventDefault();
        ToggleHiZ((Previous) => !Previous);
      }
      if (Event.key === "F5") {
        Event.preventDefault();
        ToggleAlias((Previous) => !Previous);
      }
      if (Event.key === "F6") {
        Event.preventDefault();
        SetPatchError((Previous) => (Previous >= 4 ? 0.5 : Previous * 2));
      }
      if (Event.key === "Escape") {
        SetDebug(0);
        ShowMenu(null);
        OpenConstruct(false);
        RenameRow(null);
      }
      if (Event.shiftKey && Event.code === "KeyA") {
        Event.preventDefault();
        OpenConstruct(true);
      }
      if ((Event.ctrlKey || Event.metaKey) && Event.key.toLowerCase() === "f") {
        Event.preventDefault();
        SearchInput.current?.focus();
      }
      if (Event.key === "F2") RenameRow(Selected);
      if (Event.key === "`") ShowConsole((Previous) => !Previous);
    };
    window.addEventListener("keydown", Key);
    return () => window.removeEventListener("keydown", Key);
  }, [Selected]);
  useEffect(() => {
    const Move = (Event) => {
      if (!Divider.current) return;
      const { Side, Width, X } = Divider.current;
      if (Side === "Left")
        ResizeLeft(
          Math.max(240, Math.min(innerWidth * 0.4, Width + Event.clientX - X)),
        );
      else
        ResizeRight(
          Math.max(
            300,
            Math.min(innerWidth - LeftWidth - 150, Width + X - Event.clientX),
          ),
        );
    };
    const Up = () => {
      Divider.current = null;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", Move);
    window.addEventListener("pointerup", Up);
    return () => {
      window.removeEventListener("pointermove", Move);
      window.removeEventListener("pointerup", Up);
    };
  }, [LeftWidth]);
  const SelectRow = (Id) => {
    Select(Id);
    ShowMenu(null);
  };
  const HasChildren = (Id) => Rows.some((Row) => Row.Parent === Id);
  const DisplayRows = () => {
    const Result = [];
    function Walk(Parent, Depth) {
      for (const Row of Rows.filter((Row) => Row.Parent === Parent)) {
        const Match =
          (!Query || Row.Name.toLowerCase().includes(Query.toLowerCase())) &&
          (!Filters.length ||
            Filters.some((Filter) =>
              Filter === "Camera"
                ? Row.Panel === "camera"
                : Filter === "Lights"
                  ? ["sun", "light", "flare"].includes(Row.Panel)
                  : Filter === "Geometry"
                    ? Row.Panel === "geometry"
                    : Filter === "Bodies"
                      ? Row.Panel === "moon"
                      : [
                          "atmosphere",
                          "clouds",
                          "local-cloud",
                          "stars",
                          "height-fog",
                          "aerial-fog",
                          "local-fog",
                          "wind",
                          "rainbow",
                          "precipitation",
                        ].includes(Row.Panel),
            ));
        if (Match) Result.push({ ...Row, Depth });
        if (!Collapsed[Row.Id] || Query || Filters.length)
          Walk(Row.Id, Depth + 1);
      }
    }
    Walk(null, 0);
    return Result;
  };
  const SaveFile = () => {
    const BlobContent = new Blob(
      [
        JSON.stringify(
          {
            Format: "Frontier HTML UI study",
            Rows,
            Values,
            Hidden,
            Settings,
            Name,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const Url = URL.createObjectURL(BlobContent),
      Link = document.createElement("a");
    Link.href = Url;
    Link.download = "ProjectZero-UI.json";
    Link.click();
    setTimeout(() => URL.revokeObjectURL(Url), 1000);
    ShowMenu(null);
  };
  const RestoreFile = async (Event) => {
    try {
      const Loaded = JSON.parse(await Event.target.files[0].text());
      if (
        Loaded.Format !== "Frontier HTML UI study" ||
        !Array.isArray(Loaded.Rows) ||
        !Loaded.Rows.length ||
        Loaded.Rows.length > 4096
      )
        throw Error();
      if (
        Loaded.Rows.some(
          (Row) =>
            typeof Row.Id !== "string" ||
            typeof Row.Name !== "string" ||
            !Panels[Row.Panel],
        )
      )
        throw Error();
      AssignRows(Loaded.Rows);
      AssignValues(Loaded.Values || {});
      AssignHidden(Loaded.Hidden || {});
      ChangeSettings({ ...DefaultSettings, ...Loaded.Settings });
      RenameProject(Loaded.Name || "Project-Zero");
      Select(Loaded.Rows[0].Id);
      Toast("HTML UI state imported");
    } catch {
      Toast("Not a valid HTML UI study file");
    }
    Event.target.value = "";
  };
  const AddRow = (Template) => {
    const Id = Template.Panel + "-" + Date.now();
    AssignRows((Previous) => [
      ...Previous,
      {
        ...Template,
        Id,
        Name: Template.Name,
        Parent:
          Template.Panel === "camera"
            ? "cameras"
            : Template.Panel === "geometry"
              ? "showcase"
              : "world",
      },
    ]);
    Select(Id);
    OpenConstruct(false);
    Search("");
    Filter([]);
    Collapse({});
    Toast("Added to the HTML scene outline · no native object created");
  };
  const TabStrip = (Side) => (
    <div
      className="tab-strip"
      onDragOver={(Event) => Event.preventDefault()}
      onDrop={(Event) => {
        Event.preventDefault();
        try {
          const Transfer = JSON.parse(
            Event.dataTransfer.getData("application/frontier-tab"),
          );
          AssignTabs((Previous) => {
            const Next = {};
            Object.keys(Previous).forEach(
              (Key) =>
                (Next[Key] = Previous[Key].filter(
                  (Tab) => Tab !== Transfer.Tab,
                )),
            );
            Next[Side].push(Transfer.Tab);
            return Next;
          });
          Activate((Previous) => ({
            ...Previous,
            [Transfer.Side]:
              PaneTabs[Transfer.Side].find((Tab) => Tab !== Transfer.Tab) || "",
            [Side]: Transfer.Tab,
          }));
        } catch {}
      }}
    >
      {PaneTabs[Side].map((Tab) => (
        <div
          className={"document-tab " + (Active[Side] === Tab ? "active" : "")}
          key={Tab}
          draggable
          onDragStart={(Event) =>
            Event.dataTransfer.setData(
              "application/frontier-tab",
              JSON.stringify({ Tab, Side }),
            )
          }
          onClick={() => Activate((Previous) => ({ ...Previous, [Side]: Tab }))}
          onDoubleClick={() => {
            if (Tab === "Inspector") Expand((Previous) => !Previous);
          }}
        >
          <span>{Tab}</span>
          <button
            aria-label={"Close " + Tab + " tab"}
            onClick={(Event) => {
              Event.stopPropagation();
              AssignTabs((Previous) => ({
                ...Previous,
                [Side]: Previous[Side].filter((Item) => Item !== Tab),
              }));
              Activate((Previous) => ({
                ...Previous,
                [Side]: PaneTabs[Side].find((Item) => Item !== Tab) || "",
              }));
            }}
          >
            <Glyph Name="close" Size={13} />
          </button>
        </div>
      ))}
      {Side === "Left" && (
        <button
          className="tab-add"
          aria-label="Add editor tab or construct"
          onClick={(Event) => {
            const Rect = Event.currentTarget.getBoundingClientRect();
            ShowMenu({ Type: "Tabs", X: Rect.left, Y: Rect.bottom + 4 });
          }}
        >
          <Glyph Name="plus" Size={14} />
        </button>
      )}
    </div>
  );
  const RestoreTab = (Tab) => {
    const Side =
      Tab === "Outliner" ? "Left" : Tab === "Inspector" ? "Right" : "Centre";
    AssignTabs((Previous) =>
      Object.fromEntries(
        Object.entries(Previous).map(([Key, Tabs]) => [
          Key,
          Key === Side
            ? [...new Set([...Tabs, Tab])]
            : Tabs.filter((Item) => Item !== Tab),
        ]),
      ),
    );
    Activate((Previous) =>
      Object.fromEntries(
        Object.entries(Previous).map(([Key, Label]) => [
          Key,
          Key === Side
            ? Tab
            : Label === Tab
              ? PaneTabs[Key].find((Item) => Item !== Tab) || ""
              : Label,
        ]),
      ),
    );
    Expand(false);
    ShowMenu(null);
  };
  const RowMenu = (Event, Row) => {
    Event.preventDefault();
    Select(Row.Id);
    ShowMenu({
      Type: "Row",
      X: Math.min(innerWidth - 230, Event.clientX),
      Y: Math.min(innerHeight - 240, Event.clientY),
    });
  };
  const Outliner = () => (
    <>
      <div className="outliner-heading">
        <h1>Outliner</h1>
        <small>Showcase · {Rows.length} nodes</small>
        <button
          aria-label="Outliner menu"
          onClick={(Event) => {
            const Rect = Event.currentTarget.getBoundingClientRect();
            ShowMenu({ Type: "File", X: Rect.left, Y: Rect.bottom });
          }}
        >
          <Glyph Name="filter" Size={15} />
        </button>
      </div>
      <div className="stats">
        <button onClick={() => AssignHidden({})}>
          <span className="status-disc">
            <Glyph Name="check" Size={15} />
          </span>
          <small>Visible</small>
          <strong>{Rows.filter((Row) => !Hidden[Row.Id]).length}</strong>
        </button>
        <button
          onClick={() => {
            AssignHidden(Object.fromEntries(Rows.map((Row) => [Row.Id, true])));
          }}
        >
          <span className="muted-disc">△</span>
          <small>Hidden</small>
          <strong>{Rows.filter((Row) => Hidden[Row.Id]).length}</strong>
        </button>
      </div>
      <div className="outliner-search">
        <label>
          <Glyph Name="search" Size={15} />
          <input
            ref={SearchInput}
            aria-label="Search outliner"
            placeholder="Search   Ctrl+F"
            value={Query}
            onChange={(Event) => Search(Event.target.value)}
          />
        </label>
        <button
          aria-label="Filter outliner"
          onClick={(Event) => {
            const Rect = Event.currentTarget.getBoundingClientRect();
            ShowMenu({ Type: "Filter", X: Rect.left, Y: Rect.bottom + 4 });
          }}
        >
          <Glyph Name="filter" Size={13} />
          Filter
          <Glyph Name="chevron" Size={12} />
        </button>
      </div>
      {!!Filters.length && (
        <div className="filter-chips">
          {Filters.map((Label) => (
            <button
              key={Label}
              onClick={() =>
                Filter((Previous) => Previous.filter((Item) => Item !== Label))
              }
            >
              {Label} ×
            </button>
          ))}
        </div>
      )}
      <div className="outliner-rows" role="tree" aria-label="Scene outliner">
        {DisplayRows().map((Row) => (
          <div
            key={Row.Id}
            role="treeitem"
            aria-selected={Selected === Row.Id}
            aria-expanded={HasChildren(Row.Id) ? !Collapsed[Row.Id] : undefined}
            tabIndex={0}
            className={
              "outliner-row " +
              (Selected === Row.Id ? "selected " : "") +
              (Hidden[Row.Id] ? "hidden-row" : "")
            }
            style={{ "--depth": Math.min(3, Row.Depth) }}
            onClick={() => SelectRow(Row.Id)}
            onContextMenu={(Event) => RowMenu(Event, Row)}
            onDoubleClick={() => {
              if (HasChildren(Row.Id))
                Collapse((Previous) => ({
                  ...Previous,
                  [Row.Id]: !Previous[Row.Id],
                }));
              else {
                SelectRow(Row.Id);
                Expand(true);
              }
            }}
            onKeyDown={(Event) => {
              if (Event.key === "Enter") SelectRow(Row.Id);
              if (Event.key === "F2") RenameRow(Row.Id);
              if (Event.key === "ArrowRight")
                Collapse((Previous) => ({ ...Previous, [Row.Id]: false }));
              if (Event.key === "ArrowLeft")
                Collapse((Previous) => ({ ...Previous, [Row.Id]: true }));
            }}
          >
            <button
              className={
                "row-disclosure " + (!HasChildren(Row.Id) ? "empty" : "")
              }
              aria-label={"Expand " + Row.Name}
              onClick={(Event) => {
                Event.stopPropagation();
                Collapse((Previous) => ({
                  ...Previous,
                  [Row.Id]: !Previous[Row.Id],
                }));
              }}
              style={{
                transform: Collapsed[Row.Id] ? "rotate(-90deg)" : undefined,
              }}
            >
              <Glyph Name="chevron" Size={12} />
            </button>
            <Icon Name={Row.Icon} Size={24} />
            {Rename === Row.Id ? (
              <input
                autoFocus
                aria-label="Rename object"
                value={Row.Name}
                onClick={(Event) => Event.stopPropagation()}
                onChange={(Event) =>
                  AssignRows((Previous) =>
                    Previous.map((Item) =>
                      Item.Id === Row.Id
                        ? { ...Item, Name: Event.target.value }
                        : Item,
                    ),
                  )
                }
                onKeyDown={(Event) => {
                  Event.stopPropagation();
                  if (Event.key === "Enter" || Event.key === "Escape")
                    RenameRow(null);
                }}
                onBlur={() => RenameRow(null)}
              />
            ) : (
              <span className="row-name">{Row.Name}</span>
            )}
            <small>
              {Row.Panel === "camera"
                ? "55°"
                : Row.Panel === "geometry"
                  ? "24 tris"
                  : Row.Panel === "sun"
                    ? "5.2°"
                    : Row.Panel === "wind"
                      ? "4.2 m/s"
                      : ""}
            </small>
            {Row.Panel !== "group" && (
              <span className="row-status">
                <Glyph Name="check" Size={11} />
              </span>
            )}
            <button
              className="visibility"
              aria-label={"Toggle " + Row.Name + " visibility"}
              onClick={(Event) => {
                Event.stopPropagation();
                ToggleHidden(Row.Id);
              }}
            >
              <Glyph Name="eye" Size={13} />
            </button>
          </div>
        ))}
        {DisplayRows().length === 0 && (
          <p className="empty-results">No matching objects</p>
        )}
      </div>
      <footer className="outliner-footer">
        <span>
          <small>REALTIME</small>
          <b>
            — <em>fps</em>
          </b>
        </span>
        <span>
          <small>QUALITY</small>
          <b>
            {
              ["Minimal", "Economy", "Standard", "Ultra", "Reference"][
                Settings.Quality
              ]
            }
          </b>
        </span>
        <span>
          <small>SUN</small>
          <b>5.2°</b>
        </span>
        <span>
          <small>MOONS</small>
          <b>1/4</b>
        </span>
        <span>
          <small>CAM</small>
          <b>0, 2, 0</b>
        </span>
      </footer>
    </>
  );
  const Viewport = () => (
    <>
      <div className="viewport-toolbar">
        <button
          title="Frame selected"
          onClick={() =>
            Toast("Reference viewport · native camera is not connected")
          }
        >
          F
        </button>
        <button title="Single view" onClick={() => SetProjection("PERSP")}>
          ▣
        </button>
        <button title="Split view" onClick={() => SetProjection("SPLIT")}>
          ◧
        </button>
        <button
          title="Open construct menu"
          aria-label="Construct"
          onClick={() => OpenConstruct(true)}
        >
          <Glyph Name="plus" Size={15} />
        </button>
        <div className="toolbar-space" />
        <div className="mode-buttons">
          {["EDIT", "SIM", "PLAY"].map((Mode, Index) => (
            <button
              title={Mode}
              key={Mode}
              className={RunMode === Mode ? "active" : ""}
              onClick={() => {
                SetRunMode(Mode);
                if (Mode !== "EDIT")
                  Toast(
                    Mode +
                      " controls selected · no simulation runs in this HTML copy",
                  );
              }}
            >
              {Index === 0 ? (
                "EDIT"
              ) : (
                <Glyph Name={Index === 1 ? "sun" : "play"} Size={12} />
              )}
            </button>
          ))}
        </div>
        <select
          aria-label="Viewport projection"
          value={Projection}
          onChange={(Event) => SetProjection(Event.target.value)}
        >
          {["PERSP", "ORTHO", "TOP", "FRONT", "RIGHT", "SPLIT"].map((Value) => (
            <option key={Value}>{Value}</option>
          ))}
        </select>
        <button title="Focus viewport" onClick={() => Expand(false)}>
          ◎
        </button>
        <button
          className="live"
          title="Reference image only. No engine connection."
          onClick={() =>
            Toast("Native CPU reference frame · no live renderer connected")
          }
        >
          <i />
          REF <small>CPU</small>
        </button>
        <button
          aria-label="Open control center"
          onClick={() => OpenShade(!Shade)}
        >
          <Glyph Name="gear" Size={18} />
        </button>
      </div>
      <div
        className={
          "scene-image " + (Projection === "SPLIT" ? "split-view" : "")
        }
        title="Authentic native CPU reference frame. This HTML copy does not run the renderer."
      >
        <img
          src={window.NativeAssets.Viewport}
          alt="Project Zero native reference viewport"
        />
        {Projection === "SPLIT" && (
          <img src={window.NativeAssets.Viewport} alt="Second reference view" />
        )}
        {Debug > 0 && (
          <div className="diagnostic-overlay">
            <strong>Debug View · {DebugViews[Debug]}</strong>
            <pre>{`clusters   — → frustum — → cone — → visible —
drawn      phase 1 — + phase 2 — (— triangles)
indirect   — | HiZ occlusion ${HiZ ? "on" : "OFF"} | patch error ${PatchError} px
gpu        cull — · raster — · HiZ — · resolve — ms
shading    shadow — · restir — · sky — · volume —
restir     temporal — · spatial — · alias pick ${Alias ? "on" : "OFF"}
scene      — mats → — slabs · — tex
HTML preview · no GPU telemetry or debug rendering
F3 next · Shift+F3 previous · F4 HiZ · F5 alias · F6 error · Esc close`}</pre>
          </div>
        )}
        {Settings.FPS && (
          <div className="fps-overlay">FPS — · CPU reference</div>
        )}
        {Console && (
          <div className="console">
            <input
              aria-label="Command line"
              placeholder="find"
              onKeyDown={(Event) => {
                if (Event.key === "Enter") {
                  Search(Event.currentTarget.value.replace(/^find\s*/, ""));
                  Event.currentTarget.value = "";
                  Toast("Outliner search updated");
                }
              }}
            />
            <button onClick={() => ShowConsole(false)}>×</button>
          </div>
        )}
      </div>
      <footer
        className="viewport-footer"
        title="Reference scene statistics; no live GPU telemetry"
      >
        FPS <b>—</b> · — ms | TRIS 5994 | INSTANCES {Rows.length} ·{" "}
        {Rows.filter((Row) => !Hidden[Row.Id]).length} visible | CAMERA{" "}
        <b>+0° +0° 4.5m</b>
      </footer>
    </>
  );
  const PanelBody = (Tab) =>
    Tab === "Outliner" ? (
      Outliner()
    ) : Tab === "Viewport" ? (
      Viewport()
    ) : Tab === "Inspector" ? (
      <>
        <div className="inspector-scroll" key={Subject.Id}>
          <Inspector
            Subject={Subject}
            Values={Values[Selected] || {}}
            Change={Change}
            Hidden={Hidden[Selected]}
            ToggleHidden={() => ToggleHidden(Selected)}
          />
        </div>
        <footer className="inspector-footer">
          <span>{Subject.Description}</span>
          <span>FPS — · TRIS 5994</span>
        </footer>
      </>
    ) : (
      <div className="empty-dock">Choose a panel from the + tab menu</div>
    );
  return (
    <>
      <main
        className={"workspace " + (Wide ? "inspector-workspace" : "")}
        style={{ "--left": LeftWidth + "px", "--right": RightWidth + "px" }}
      >
        {["Left", "Centre", "Right"].map((Side) => (
          <section
            className={"dock " + Side.toLowerCase()}
            key={Side}
            aria-label={Side + " editor dock"}
          >
            {TabStrip(Side)}
            {PanelBody(
              PaneTabs[Side].includes(Active[Side])
                ? Active[Side]
                : PaneTabs[Side][0],
            )}
            {Side !== "Centre" && (
              <div
                className={"divider " + Side.toLowerCase()}
                role="separator"
                aria-orientation="vertical"
                aria-label={"Resize " + Side + " panel"}
                onPointerDown={(Event) => {
                  Divider.current = {
                    Side,
                    Width: Side === "Left" ? LeftWidth : RightWidth,
                    X: Event.clientX,
                  };
                  document.body.classList.add("resizing");
                }}
              />
            )}
          </section>
        ))}
      </main>
      <Notch
        Open={Shade}
        Toggle={OpenShade}
        Settings={Settings}
        Assign={Assign}
        Name={Name}
      />
      {Wide && (
        <button
          className="return-viewport"
          onClick={() => Expand(false)}
          title="Return to three-column layout"
        >
          ← Viewport
        </button>
      )}
      {Menu && (
        <>
          <div className="menu-dismiss" onPointerDown={() => ShowMenu(null)} />
          <div
            className="popup-menu"
            style={{
              left: Math.max(4, Math.min(innerWidth - 235, Menu.X)),
              top: Menu.Y,
            }}
            role="menu"
          >
            {Menu.Type === "Tabs" ? (
              <>
                <label>WORKSPACE</label>
                {["Outliner", "Viewport", "Inspector"].map((Tab) => (
                  <button key={Tab} onClick={() => RestoreTab(Tab)}>
                    {Tab}
                  </button>
                ))}
                <hr />
                <button
                  onClick={() => {
                    ShowMenu(null);
                    OpenConstruct(true);
                  }}
                >
                  Construct… <small>Shift+A</small>
                </button>
                <button
                  onClick={() => {
                    Expand(!Wide);
                    ShowMenu(null);
                  }}
                >
                  {Wide ? "Three-column editor" : "Inspector workspace"}
                </button>
              </>
            ) : Menu.Type === "Filter" ? (
              <>
                <label>FILTER BY</label>
                {["Lights", "Sky", "Bodies", "Geometry", "Camera"].map(
                  (Label) => (
                    <button
                      key={Label}
                      onClick={() =>
                        Filter((Previous) =>
                          Previous.includes(Label)
                            ? Previous.filter((Value) => Value !== Label)
                            : [...Previous, Label],
                        )
                      }
                    >
                      <i className={Filters.includes(Label) ? "green" : ""} />
                      {Label}
                      {Filters.includes(Label) && (
                        <Glyph Name="check" Size={14} />
                      )}
                    </button>
                  ),
                )}
                <hr />
                <button
                  onClick={() => {
                    Filter([]);
                    ShowMenu(null);
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : Menu.Type === "File" ? (
              <>
                <button onClick={SaveFile}>Export HTML UI state…</button>
                <button
                  onClick={() => {
                    FileInput.current.click();
                    ShowMenu(null);
                  }}
                >
                  Import HTML UI state…
                </button>
                <hr />
                <button
                  onClick={() => {
                    AssignRows(InitialRows);
                    AssignValues({});
                    AssignHidden({});
                    Collapse({});
                    Filter([]);
                    Search("");
                    Select("sun");
                    ResizeLeft(316);
                    ResizeRight(340);
                    ChangeSettings(DefaultSettings);
                    ShowMenu(null);
                  }}
                >
                  Restore native baseline
                </button>
                <button
                  onClick={() => {
                    ShowMenu(null);
                    ShowConsole(!Console);
                  }}
                >
                  Command line <small>`</small>
                </button>
              </>
            ) : (
              <>
                <label>{Subject.Name}</label>
                <button
                  onClick={() => {
                    RenameRow(Selected);
                    ShowMenu(null);
                  }}
                >
                  Rename <small>F2</small>
                </button>
                <button
                  onClick={() => {
                    ToggleHidden(Selected);
                    ShowMenu(null);
                  }}
                >
                  {Hidden[Selected] ? "Show" : "Hide"}
                </button>
                <button
                  onClick={() => {
                    Expand(true);
                    ShowMenu(null);
                  }}
                >
                  Inspect in workspace
                </button>
                <button onClick={() => AddRow(Subject)}>Duplicate</button>
                {Subject.Panel !== "group" && (
                  <button
                    onClick={() => {
                      AssignRows((Previous) => {
                        const Removed = new Set([Selected]);
                        let Changed = true;
                        while (Changed) {
                          Changed = false;
                          for (const Row of Previous)
                            if (
                              Removed.has(Row.Parent) &&
                              !Removed.has(Row.Id)
                            ) {
                              Removed.add(Row.Id);
                              Changed = true;
                            }
                        }
                        return Previous.filter((Row) => !Removed.has(Row.Id));
                      });
                      Select("showcase");
                      ShowMenu(null);
                    }}
                  >
                    Remove from HTML scene
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {Construct && (
        <div
          className="modal-scrim"
          onClick={(Event) => {
            if (Event.target === Event.currentTarget) OpenConstruct(false);
          }}
        >
          <section
            className="construct-dialog"
            role="dialog"
            aria-label="Construct"
          >
            <header>
              <h2>Construct</h2>
              <button
                aria-label="Close construct"
                onClick={() => OpenConstruct(false)}
              >
                <Glyph Name="close" />
              </button>
            </header>
            <label className="construct-search">
              <Glyph Name="search" />
              <input
                autoFocus
                placeholder="Search scene objects…"
                aria-label="Search construct"
                value={ConstructQuery}
                onChange={(Event) => SearchConstruct(Event.target.value)}
              />
              <kbd>Shift+A</kbd>
            </label>
            <div className="construct-grid">
              {InitialRows.filter(
                (Row) =>
                  Row.Panel !== "group" &&
                  Row.Id !== "sky" &&
                  Row.Name.toLowerCase().includes(ConstructQuery.toLowerCase()),
              ).map((Row) => (
                <button key={Row.Id} onClick={() => AddRow(Row)}>
                  <Icon Name={Row.Icon} Size={32} />
                  <span>
                    {Row.Name}
                    <small>{Row.Description}</small>
                  </span>
                  <Glyph Name="plus" Size={15} />
                </button>
              ))}
            </div>
            <footer>
              HTML scene authoring only · no native engine connection
            </footer>
          </section>
        </div>
      )}
      <input
        type="file"
        accept="application/json"
        hidden
        ref={FileInput}
        onChange={RestoreFile}
      />
      {Message && (
        <div className="toast" role="status">
          {Message}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("Editor")).render(<App />);
window.ProjectZeroHtml = {
  Panels: Object.keys(Panels),
  NativeSource: "9864969",
  EngineConnected: false,
};

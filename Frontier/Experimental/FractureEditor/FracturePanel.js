import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CrackNetwork } from "./SourceDepot/Propagation/src/frac/crack2d.ts";
import { RegionExtractor } from "./SourceDepot/Propagation/src/frac/regions.ts";
import { MATERIALS as ShellMaterials } from "./SourceDepot/Propagation/src/sim/materials.ts";
import { fracture } from "./SourceDepot/Fragmentation/src/fracture/fracture.ts";
import { buildGeometry } from "./SourceDepot/Fragmentation/src/core/convex.ts";
import { makeTarget } from "./SourceDepot/Fragmentation/src/scene/targets.ts";
import { bakeDentAtlas } from "./SourceDepot/Propagation/src/frac/dentmap.ts";
import Provenance from "./SourceDepot/Provenance.json";

const Element = (Id) => document.getElementById(Id);
window.addEventListener("error", (Event) => {
  Element("message").textContent = "Preview error: " + Event.message;
});
const Assets = [
  {
    Id: "glass",
    Name: "Window glass",
    Detail: "Annealed · shell cracks",
    Shell: "annealed-glass",
  },
  {
    Id: "tempered",
    Name: "Safety glass",
    Detail: "Tempered · stored energy",
    Shell: "tempered-glass",
  },
  {
    Id: "concrete",
    Name: "Concrete panel",
    Detail: "Solid · energy-limited splits",
  },
  { Id: "wood", Name: "Timber beam", Detail: "Solid · fibre anisotropy" },
  { Id: "rock", Name: "Granite", Detail: "Solid · bedding planes" },
  {
    Id: "plastic",
    Name: "ABS specimen",
    Detail: "Solid · high fracture energy",
  },
  {
    Id: "steel",
    Name: "Sheet metal",
    Detail: "Baked · plastic crumpling",
    Metal: true,
  },
];
let Selected = Assets[2],
  Mode = "runtime",
  Library = [],
  Current = null,
  Meshes = [],
  Network = null;
let SolveTime = 0,
  StartTime = 0,
  Root,
  Pieces,
  Lines,
  Busy = false;
const Viewport = Element("viewport");
const Renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
Renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
Renderer.setClearColor(0x191d1a);
Renderer.outputColorSpace = THREE.SRGBColorSpace;
Viewport.appendChild(Renderer.domElement);
const Scene = new THREE.Scene(),
  Camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
const Controls = new OrbitControls(Camera, Renderer.domElement);
Controls.enableDamping = true;
Controls.minDistance = 1.1;
Controls.maxDistance = 12;
Controls.maxPolarAngle = Math.PI * 0.85;
const Key = new THREE.DirectionalLight(0xfff3dc, 3.4);
Key.position.set(2, 5, 5);
Scene.add(Key);
const Rim = new THREE.DirectionalLight(0xa3c9af, 2.1);
Rim.position.set(-3, 2, -3);
Scene.add(Rim);
Scene.add(new THREE.HemisphereLight(0xd3e4da, 0x292c27, 2));
const Ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x171b17, roughness: 1 }),
);
Ground.rotation.x = -Math.PI / 2;
Ground.position.y = -0.92;
Scene.add(Ground);
const Grid = new THREE.GridHelper(12, 48, 0x38483a, 0x273329);
Grid.position.y = -0.918;
Scene.add(Grid);
const Impact = new THREE.Mesh(
  new THREE.SphereGeometry(0.014, 16, 8),
  new THREE.MeshBasicMaterial({ color: 0xe6c281 }),
);
Scene.add(Impact);
const Exterior = new THREE.MeshStandardMaterial({
  color: 0x899d8c,
  roughness: 0.74,
  side: THREE.DoubleSide,
});
const Interior = new THREE.MeshStandardMaterial({
  color: 0xb4c3ac,
  roughness: 1,
  side: THREE.DoubleSide,
});
const SupportMaterial = new THREE.MeshStandardMaterial({
  color: 0x353e35,
  roughness: 0.8,
});
const ZeroNoise = { amp: 0, freq: 1, octaves: 1, subdiv: 0, noise: () => 0 };
function Message(Text) {
  Element("message").textContent = Text;
}
function Numeric(Id, Minimum, Maximum) {
  let Value = Number(Element(Id).value);
  if (!Number.isFinite(Value)) Value = Minimum;
  Value = Math.min(Maximum, Math.max(Minimum, Value));
  Element(Id).value = String(Value);
  return Value;
}
function Recipe(Seed) {
  return {
    asset: Selected.Id,
    seed: Seed ?? Math.round(Numeric("seed", 1, 999999)),
    energy: Numeric("energy-number", 1, 50000),
    radius: Numeric("radius", 1, 200) / 1000,
    x: Numeric("impact-x", -0.6, 0.6),
    y: Numeric("impact-y", -0.4, 0.4),
    budget: Math.round(Numeric("budget", 16, 300)),
  };
}
function FrameAsset() {
  Camera.position
    .set(2.65, 1.55, 4.3)
    .multiplyScalar(Selected?.Metal ? 0.46 : 1);
  Controls.target.set(0, 0, 0);
  Controls.update();
}
function Dispose(Group) {
  if (!Group) return;
  Group.traverse((Value) => {
    Value.geometry?.dispose();
  });
  Scene.remove(Group);
}
function MeshRecord(Geometry, Center) {
  return { geometry: Geometry, center: Center };
}
function PatternShell(Net, Elapsed, Settings) {
  const Extractor = new RegionExtractor(Net),
    Fragments = Extractor.harvest(true, 4, Net.nx * Net.ny);
  const Records = Fragments.map((Fragment) => {
    const Geometry = new THREE.BufferGeometry();
    Geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(Fragment.mesh.pos, 3),
    );
    Geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(Fragment.mesh.nrm, 3),
    );
    if (Fragment.mesh.idx) Geometry.setIndex(Array.from(Fragment.mesh.idx));
    return MeshRecord(Geometry, new THREE.Vector3(Fragment.cx, Fragment.cy, 0));
  });
  return {
    records: Records,
    settings: Settings,
    time: Elapsed,
    metric:
      (
        (Fragments.reduce((Sum, Fragment) => Sum + Fragment.area, 0) /
          (Net.W * Net.H)) *
        100
      ).toFixed(1) + "%",
    metricLabel: "REGION COVERAGE",
    shell: true,
    stats: Net.stats(),
  };
}
function BeginShell(Settings) {
  const Net = new CrackNetwork({
    width: 1.7,
    height: 1.15,
    thickness: 0.014,
    material: ShellMaterials[Selected.Shell],
    res: 192,
    seed: Settings.seed,
  });
  Net.impact({
    x: Settings.x,
    y: Settings.y,
    energy: Settings.energy,
    radius: Settings.radius,
    penetration: 0.35,
  });
  return Net;
}
function Solve(Settings) {
  const Start = performance.now();
  if (Selected.Shell) {
    const Net = BeginShell(Settings);
    let Iterations = 0;
    while (!Net.done && Iterations++ < 12000) Net.step(0.000015);
    if (!Net.done)
      throw new Error(
        "Crack propagation did not finish within the preview iteration limit",
      );
    return PatternShell(Net, performance.now() - Start, Settings);
  }
  const Target = makeTarget(Selected.Id);
  const Hit = {
    point: new THREE.Vector3(
      Settings.x,
      Settings.y,
      Selected.Id === "rock"
        ? 0.5
        : Selected.Id === "concrete"
          ? 0.11
          : Selected.Id === "wood"
            ? 0.025
            : 0.36,
    ),
    dir: new THREE.Vector3(0, 0, -1),
    energy: Settings.energy,
    radius: Settings.radius,
  };
  const Result = fracture(
    Target.piece,
    Target.mat,
    Hit,
    Settings.budget,
    Settings.seed,
  );
  const Volume = Result.fragments.reduce((Sum, Part) => Sum + Part.volume, 0),
    Original = Target.piece.volume();
  const Records = Result.fragments.map((Part) =>
    MeshRecord(
      buildGeometry(Part.piece, ZeroNoise).translate(
        -Part.centroid.x,
        -Part.centroid.y,
        -Part.centroid.z,
      ),
      Part.centroid,
    ),
  );
  return {
    records: Records,
    settings: Settings,
    time: performance.now() - Start,
    metric: ((Math.abs(Volume - Original) / Original) * 100).toFixed(4) + "%",
    metricLabel: "VOLUME ERROR",
    shell: false,
    area: Result.crackArea,
  };
}
function SolveMetal() {
  const Atlas = bakeDentAtlas(32, 12);
  return Atlas.types.map((Tool, Type) => {
    const Frames = [];
    for (let Frame = 0; Frame < Atlas.frames; Frame++) {
      const Geometry = new THREE.BufferGeometry(),
        Positions = [],
        Normals = [],
        Indices = [];
      for (let Row = 0; Row < Atlas.res; Row++)
        for (let Column = 0; Column < Atlas.res; Column++) {
          const Offset =
            ((Type * Atlas.frames + Frame) * Atlas.res * Atlas.res +
              Row * Atlas.res +
              Column) *
            4;
          Positions.push(
            (Column / (Atlas.res - 1) - 0.5) * 2 * Tool.half +
              Atlas.pos[Offset],
            (Row / (Atlas.res - 1) - 0.5) * 2 * Tool.half +
              Atlas.pos[Offset + 1],
            Atlas.pos[Offset + 2],
          );
          Normals.push(
            Atlas.nrm[Offset],
            Atlas.nrm[Offset + 1],
            Atlas.nrm[Offset + 2],
          );
          if (Row + 1 < Atlas.res && Column + 1 < Atlas.res) {
            const First = Row * Atlas.res + Column,
              Last = First + Atlas.res;
            Indices.push(First, First + 1, Last + 1, First, Last + 1, Last);
          }
        }
      Geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(Positions, 3),
      );
      Geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(Normals, 3),
      );
      Geometry.setIndex(Indices);
      Frames.push(Geometry);
    }
    return {
      metal: true,
      label: Tool.label.split(" (")[0],
      frames: Frames,
      records: [MeshRecord(Frames.at(-1).clone(), new THREE.Vector3())],
      settings: {
        asset: "steel",
        tool: Tool.label,
        depth: Tool.depth,
        drawIn: Tool.drawIn,
        resolution: 32,
        frames: 12,
      },
      time: Atlas.ms,
      metric: (Tool.depth * 1000).toFixed(0) + " mm",
      metricLabel: "PRESCRIBED DEPTH",
    };
  });
}
function ShowPattern(Pattern) {
  Network = null;
  Dispose(Pieces);
  Dispose(Lines);
  Lines = null;
  Pieces = new THREE.Group();
  Scene.add(Pieces);
  Meshes = [];
  Root.visible = false;
  Current = Pattern;
  for (const Record of Pattern.records) {
    const Geometry = Record.geometry.clone();
    // Solid source geometry is centered by buildGeometry; shell extraction is already local.
    const Mesh = new THREE.Mesh(Geometry, [Exterior, Interior]);
    Mesh.userData.center = Record.center.clone();
    if (Pattern.shell || Pattern.metal) {
      Mesh.material = Exterior;
    }
    Pieces.add(Mesh);
    Meshes.push(Mesh);
  }
  Separate();
  Element("count").textContent = Pattern.records.length;
  Element("cost").textContent = Pattern.time.toFixed(1) + " ms";
  Element("metric-label").textContent = Pattern.metricLabel;
  Element("conservation").textContent = Pattern.metric;
  Element("viewport-status").textContent = Pattern.shell
    ? "Crack network → extracted plate regions"
    : "Energy-limited fragmentation · finite cut surfaces";
  Element("bottom-note").textContent = Pattern.shell
    ? "Grid-based shell extraction omits crack cells and tiny specks; coverage is shown above. Not mass-conserving collision geometry."
    : "Exterior and interior faces are actual geometry. No displacement/noise surface-detail substitute is enabled.";
  if (Pattern.metal) {
    Element("viewport-status").textContent =
      "Plastic " + Pattern.label + " · one continuous sheet";
    Element("bottom-note").textContent =
      "Scrub the actual solved XYZ positions and normals. No brittle shattering is applied to steel.";
  }
  Message(
    `${Mode === "baked" ? "Cached pattern selected" : "Runtime solve complete"} · ${Pattern.records.length} fragments · browser geometry only`,
  );
}
function Separate() {
  const Amount = Number(Element("separation").value);
  if (Current?.metal) {
    const Frame = Math.round(Amount);
    if (Meshes[0]) {
      Meshes[0].geometry.dispose();
      Meshes[0].geometry = Current.frames[Frame].clone();
    }
    Element("separation-output").textContent = Frame + " / 11";
    return;
  }
  Element("separation-output").textContent = Amount.toFixed(3) + " m";
  for (const Mesh of Meshes) {
    const Center = Mesh.userData.center;
    Mesh.position
      .copy(Center)
      .addScaledVector(Center.clone().normalize(), Amount);
  }
}
function ClearLibrary() {
  for (const Pattern of Library) {
    for (const Record of Pattern.records) Record.geometry.dispose();
    Pattern.frames?.forEach((Geometry) => Geometry.dispose());
  }
  Library = [];
  Element("patterns").replaceChildren();
}
function Reset() {
  Network = null;
  Dispose(Pieces);
  Dispose(Lines);
  Pieces = Lines = null;
  Meshes = [];
  if (Current && !Library.includes(Current))
    for (const Record of Current.records) Record.geometry.dispose();
  Current = null;
  if (Root) Root.visible = true;
  Element("count").textContent = "1";
  Element("cost").textContent = "—";
  Element("conservation").textContent = "—";
  Element("viewport-status").textContent =
    "Original geometry · ready for impact";
  Message("Original geometry restored");
}
function ImpactPosition() {
  const Settings = Recipe();
  Impact.position.set(
    Settings.x,
    Settings.y,
    Selected.Id === "rock"
      ? 0.55
      : Selected.Shell
        ? 0.025
        : Selected.Id === "concrete"
          ? 0.125
          : Selected.Id === "wood"
            ? 0.04
            : 0.375,
  );
}
function Invalidate() {
  Reset();
  ClearLibrary();
  ImpactPosition();
  Element("energy").value = Element("energy-number").value;
  Message("Settings changed · baked patterns invalidated");
}
function SelectAsset(Id) {
  Reset();
  ClearLibrary();
  Selected = Assets.find((Value) => Value.Id === Id);
  Dispose(Root);
  Root = new THREE.Group();
  Scene.add(Root);
  const Target = makeTarget(Selected.Metal ? "concrete" : Id);
  Root.add(
    new THREE.Mesh(
      Selected.Metal
        ? new THREE.PlaneGeometry(0.88, 0.88, 31, 31)
        : buildGeometry(Target.piece, ZeroNoise),
      [Exterior, Interior],
    ),
  );
  if (Selected.Shell) {
    for (const Support of Target.supports) {
      const Mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...Support.size),
        SupportMaterial,
      );
      Mesh.position.set(...Support.pos);
      Root.add(Mesh);
    }
  }
  const Colours = {
    glass: 0x9eb9ad,
    tempered: 0x9eb9ad,
    concrete: 0x96978d,
    wood: 0x9f8055,
    rock: 0x7d8179,
    plastic: 0x81969b,
    steel: 0xa7b4ac,
  };
  Exterior.color.setHex(Colours[Id]);
  for (const Key of ["asset-title", "inspector-title"])
    Element(Key).textContent = Selected.Name;
  Element("solver-label").textContent = Selected.Shell
    ? "Shell crack propagation"
    : "Energy-limited solid fracture";
  Element("response").textContent = Selected.Shell
    ? "Dynamic crack tips → plate regions"
    : "Anisotropic, energy-limited splitting";
  Element("material-note").textContent = Selected.Detail;
  const Material = Selected.Shell ? ShellMaterials[Selected.Shell] : Target.mat;
  Element("toughness").textContent = (Material.Gc ?? Material.gc) + " J/m²";
  Element("density").textContent =
    (Material.rho ?? Material.density) + " kg/m³";
  for (const Button of Element("asset-list").children)
    Button.classList.toggle("active", Button.dataset.asset === Id);
  Element("impact-card").hidden = !!Selected.Metal;
  Element("plastic-controls").hidden = !Selected.Metal;
  Element("separation").max = Selected.Metal ? "11" : ".7";
  Element("separation").step = Selected.Metal ? "1" : ".005";
  Element("separation").value = Selected.Metal ? "11" : ".065";
  document.querySelector(".separation label").textContent = Selected.Metal
    ? "Damage sample"
    : "Fragment separation";
  Element("separation-output").textContent = Selected.Metal
    ? "11 / 11"
    : ".065 m";
  if (Selected.Metal) {
    Workflow("baked");
    Element("solver-label").textContent =
      "Elasto-plastic sheet · baked geometry";
    Element("response").textContent = "Plastic hinges and in-plane draw-in";
    Element("toughness").textContent = "Plastic yielding";
    Element("density").textContent = "XYZ + normals";
  }
  Element("toughness-label").textContent = Selected.Metal
    ? "Response"
    : "Toughness";
  Element("density-label").textContent = Selected.Metal
    ? "Representation"
    : "Density";
  Element("runtime").disabled = !!Selected.Metal;
  Element("runtime").title = Selected.Metal
    ? "Metal uses baked plasticity in this HTML review"
    : "";
  for (const Id of ["seed", "budget", "pattern-count"])
    Element(Id).closest("label").hidden = !!Selected.Metal;
  Element("budget").closest("label").hidden =
    !!Selected.Metal || !!Selected.Shell;
  Element("bake-controls").hidden = Mode !== "baked" || !!Selected.Metal;
  Impact.visible = !Selected.Metal;
  ImpactPosition();
  FrameAsset();
}
function LockControls(Locked) {
  document
    .querySelectorAll(
      ".card input,.card select,.asset,#runtime,#baked,#reset,#export",
    )
    .forEach((Control) => (Control.disabled = Locked));
  Element("runtime").disabled = Locked || !!Selected.Metal;
}
async function Apply() {
  if (Busy) return;
  Busy = true;
  LockControls(true);
  Element("apply").disabled = true;
  try {
    Reset();
    const Settings = Recipe();
    if (Mode === "runtime" && Selected.Shell) {
      Network = BeginShell(Settings);
      Network.recipe = Settings;
      SolveTime = 0;
      StartTime = performance.now();
      Element("viewport-status").textContent =
        "Crack tips propagating · slowed 1000×";
      return;
    }
    if (Mode === "baked") {
      ClearLibrary();
      const Count = Selected.Metal ? 0 : Number(Element("pattern-count").value);
      if (Selected.Metal) {
        Message("Solving prescribed sheet tools…");
        await new Promise((Resolve) => setTimeout(Resolve, 25));
        Library = SolveMetal();
      }
      for (let Index = 0; Index < Count; Index++) {
        Message(`Baking geometry pattern ${Index + 1} / ${Count}…`);
        await new Promise((Resolve) => setTimeout(Resolve, 20));
        // Changes remain blocked during this short browser-side library operation.
        Library.push(Solve({ ...Settings, seed: Settings.seed + Index }));
      }
      Element("patterns").replaceChildren(
        ...Library.map((Pattern, Index) => {
          const Button = document.createElement("button");
          Button.className = "pattern";
          Button.innerHTML = `${Pattern.label || "Pattern " + String(Index + 1).padStart(2, "0")}<small>${Pattern.metal ? "12 damage samples" : "seed " + Pattern.settings.seed + " · " + Pattern.records.length + " pieces"}</small>`;
          Button.onclick = () => {
            Element("patterns")
              .querySelectorAll("button")
              .forEach((Value) => Value.classList.remove("selected"));
            Button.classList.add("selected");
            ShowPattern(Pattern);
          };
          return Button;
        }),
      );
      Element("patterns").firstElementChild.click();
    } else ShowPattern(Solve(Settings));
  } catch (Error) {
    Message(Error.message);
    Element("viewport-status").textContent = "Solve refused · see status";
    console.error(Error);
  } finally {
    Busy = false;
    LockControls(false);
    Element("apply").disabled = false;
  }
}
function Workflow(Value) {
  if (Busy || (Selected.Metal && Value === "runtime")) return;
  Reset();
  ClearLibrary();
  Mode = Value;
  for (const Id of ["runtime", "baked"])
    Element(Id).setAttribute("aria-selected", Id === Value);
  Element("bake-controls").hidden = Value !== "baked" || !!Selected.Metal;
  Element("generation-title").textContent =
    Value === "baked" ? "Pattern library" : "Runtime generation";
  Element("apply").textContent =
    Value === "baked" ? "Bake pattern library" : "Apply impact";
  Element("execution").textContent =
    Value === "baked" ? "Cached geometry" : "On impact";
  Element("workflow-description").textContent =
    Value === "baked"
      ? "Compute once · inspect and reuse exact geometry"
      : "Generate geometry at the impact site";
  Element("lower-title").textContent =
    Value === "baked" ? "Baked pattern library" : "Impact inspection";
}
const Icon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M4 3h16v18H4zM12 3l-3 6 5 4-5 8M9 9l-5 3m10 1 6-4"/></svg>';
Element("asset-list").innerHTML = Assets.map(
  (Asset) =>
    `<button class="asset" data-asset="${Asset.Id}"><span class="asset-icon">${Icon}</span><span><b>${Asset.Name}</b><small>${Asset.Detail}</small></span></button>`,
).join("");
Element("asset-list").onclick = (Event) => {
  const Id = Event.target.closest("[data-asset]")?.dataset.asset;
  if (Id && !Busy) SelectAsset(Id);
};
Element("search").oninput = (Event) => {
  for (const Button of Element("asset-list").children)
    Button.hidden = !Button.textContent
      .toLowerCase()
      .includes(Event.target.value.toLowerCase());
};
for (const Id of [
  "seed",
  "radius",
  "impact-x",
  "impact-y",
  "budget",
  "pattern-count",
  "energy-number",
])
  Element(Id).onchange = () => {
    if (!Busy) Invalidate();
  };
Element("energy").oninput = () => {
  if (Busy) return;
  Element("energy-number").value = Element("energy").value;
  Invalidate();
};
Element("runtime").onclick = () => Workflow("runtime");
Element("baked").onclick = () => Workflow("baked");
Element("apply").onclick = Apply;
Element("reset").onclick = () => {
  if (!Busy) Reset();
};
Element("camera").onclick = FrameAsset;
Element("separation").oninput = Separate;
Element("wireframe").onclick = () => {
  Exterior.wireframe = Interior.wireframe = !Exterior.wireframe;
  Element("wireframe").setAttribute("aria-pressed", Exterior.wireframe);
};
Renderer.domElement.addEventListener("dblclick", (Event) => {
  if (Busy) return;
  const Box = Renderer.domElement.getBoundingClientRect();
  const Cursor = new THREE.Vector2(
    ((Event.clientX - Box.left) / Box.width) * 2 - 1,
    (-(Event.clientY - Box.top) / Box.height) * 2 + 1,
  );
  const Ray = new THREE.Raycaster();
  Ray.setFromCamera(Cursor, Camera);
  const Point = new THREE.Vector3();
  if (
    Ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      Point,
    )
  ) {
    Element("impact-x").value = Math.max(-0.6, Math.min(0.6, Point.x)).toFixed(
      2,
    );
    Element("impact-y").value = Math.max(-0.4, Math.min(0.4, Point.y)).toFixed(
      2,
    );
    Invalidate();
  }
});
Element("export").onclick = () => {
  const Payload = {
    format: "frontier-fracture-ui-review-v1",
    workflow: Mode,
    recipe: Recipe(),
    sources: Provenance,
    nativeAsset: false,
    collisionPhysics: false,
    patterns: Library.map((Pattern) => ({
      recipe: Pattern.settings,
      deformationFrames: Pattern.frames?.map((Geometry) => ({
        vertices: Array.from(Geometry.getAttribute("position").array),
        normals: Array.from(Geometry.getAttribute("normal").array),
      })),
      fragments: Pattern.records.map((Record) => ({
        position: Record.center.toArray(),
        vertices: Array.from(Record.geometry.getAttribute("position").array),
        normals: Array.from(Record.geometry.getAttribute("normal").array),
        indices: Record.geometry.index
          ? Array.from(Record.geometry.index.array)
          : null,
        groups: Record.geometry.groups,
      })),
    })),
  };
  const Url = URL.createObjectURL(
    new Blob([JSON.stringify(Payload)], { type: "application/json" }),
  );
  const Link = document.createElement("a");
  Link.href = Url;
  Link.download = "FractureRecipe.json";
  Link.click();
  setTimeout(() => URL.revokeObjectURL(Url), 1000);
  Message("Exported browser recipe; not a native fracture asset");
};
new ResizeObserver(() => {
  const Width = Viewport.clientWidth,
    Height = Viewport.clientHeight;
  Renderer.setSize(Width, Height, false);
  Camera.aspect = Width / Height;
  Camera.updateProjectionMatrix();
}).observe(Viewport);
let Previous = performance.now();
function Animate(Now) {
  requestAnimationFrame(Animate);
  const Elapsed = Math.min(0.04, (Now - Previous) / 1000);
  Previous = Now;
  Controls.update();
  if (Network) {
    const Start = performance.now();
    Network.step(Elapsed * 0.001);
    SolveTime += performance.now() - Start;
    Dispose(Lines);
    const Vertices = [];
    for (const Path of Network.paths)
      for (let Index = 2; Index < Path.pts.length; Index += 2)
        Vertices.push(
          Path.pts[Index - 2],
          Path.pts[Index - 1],
          0.016,
          Path.pts[Index],
          Path.pts[Index + 1],
          0.016,
        );
    const Geometry = new THREE.BufferGeometry();
    Geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(Vertices, 3),
    );
    Lines = new THREE.LineSegments(Geometry, CrackMaterial);
    Scene.add(Lines);
    Element("count").textContent = Network.activeTips + " tips";
    Element("cost").textContent = SolveTime.toFixed(1) + " ms";
    if (Network.done) {
      const Finished = Network;
      Network = null;
      const Started = performance.now();
      const Pattern = PatternShell(Finished, SolveTime, Finished.recipe);
      Pattern.time += performance.now() - Started;
      ShowPattern(Pattern);
    } else if (Now - StartTime > 12000) {
      Network = null;
      Message(
        "Propagation paused at the 12-second preview limit; reset to continue.",
      );
    }
  }
  Renderer.render(Scene, Camera);
  Renderer.domElement.dataset.frame = String(Now);
}
const CrackMaterial = new THREE.LineBasicMaterial({ color: 0xd0eee0 });
SelectAsset("concrete");
requestAnimationFrame(Animate);
setTimeout(Apply, 80);
window.addEventListener("error", (Event) =>
  Message("Preview error: " + Event.message),
);

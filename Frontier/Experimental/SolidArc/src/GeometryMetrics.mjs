import Verify from "node:test";
import Assert from "node:assert/strict";
import CreateGeometry from "../Runtime/GeometryModule.js";
import {
  Tools,
  Examples,
  ConstructCommand,
  NativeName,
  Escape,
} from "./CommandSpecification.js";
const Lines = [];
const Geometry = await CreateGeometry({
  print: (Text) => Lines.push(Text),
  printErr: (Text) => Lines.push(Text),
});
const Invoke = (Name, Result, Types = [], Arguments = []) =>
  Geometry.ccall(Name, Result, Types, Arguments);
const Command = (Text) =>
  !!Invoke("ExecuteCommand", "number", ["string"], [Text]);
const Describe = () => JSON.parse(Invoke("DescribeDocument", "string"));
const Fresh = (Action) => () => {
  const Identity = Invoke("CreateDocument", "number");
  try {
    Action();
  } finally {
    Invoke("ReleaseDocument", null, ["number"], [Identity]);
  }
};
Verify(
  "Every supplied study executes against the actual C++ WebAssembly module",
  Fresh(() => {
    for (const Example of Object.values(Examples)) {
      Assert.ok(Command("reset"));
      for (const Text of Example.commands) Assert.ok(Command(Text), Text);
      Assert.ok(Describe().figures.length > 0);
    }
  }),
);
Verify(
  "Native primitive topology and exact extents are exposed, not mock counts",
  Fresh(() => {
    Assert.ok(Command("box (0,0,0) 2 3 4 --name=Block"));
    const Figure = Describe().figures[0];
    Assert.equal(Figure.faces, 6);
    Assert.equal(Figure.edges, 12);
    Assert.equal(Figure.vertices, 8);
    Assert.deepEqual(Figure.high, [2, 3, 4]);
  }),
);
Verify(
  "A live dimension rebuilds geometry; native undo and redo restore it",
  Fresh(() => {
    Command("box (0,0,0) 2 3 4 --name=Block");
    Command("dim auto");
    const Dimension = Describe().dimensions.find(
      (Dimension) => Dimension.slot === 5,
    );
    Assert.ok(Command(`dim edit ${Dimension.id} 6`));
    Assert.equal(Describe().figures[0].high[2], 6);
    Assert.ok(Command("undo"));
    Assert.equal(Describe().figures[0].high[2], 4);
    Assert.ok(Command("redo"));
    Assert.equal(Describe().figures[0].high[2], 6);
  }),
);
Verify(
  "Native circle extrusion produces a solid with the requested height",
  Fresh(() => {
    Command("circle (0,0) 1 --name=Profile");
    Assert.ok(Command("extrude Profile 2"));
    const Body = Describe().figures.find(
      (Figure) => Figure.classification === 2,
    );
    Assert.ok(Body.faces > 0);
    Assert.equal(Body.high[2] - Body.low[2], 2);
  }),
);
Verify(
  "Cylinder subtraction produces the native through-hole topology",
  Fresh(() => {
    Command("cylinder (0,0,0) 1 2 --name=Stock");
    Command("cylinder (0,0,-1) 0.4 4 --name=Tool");
    Assert.ok(Command("boolean subtract Stock -- Tool"));
    Assert.equal(Describe().figures.length, 1);
    Assert.equal(Describe().figures[0].faces, 4);
  }),
);
Verify(
  "Unsupported shell is refused without replacing the sphere",
  Fresh(() => {
    Command("sphere (0,0,0) 1 --name=Ball");
    const Before = Describe().figures;
    Assert.equal(Command("shell Ball 0.1 --face=0"), false);
    Assert.deepEqual(Describe().figures, Before);
  }),
);
Verify(
  "Native save/reopen preserves edits and rejects malformed input atomically",
  Fresh(() => {
    Command("box (0,0,0) 2 3 4 --name=Block");
    Command("dim auto");
    const Dimension = Describe().dimensions.find(
      (Dimension) => Dimension.slot === 5,
    );
    Command(`dim edit ${Dimension.id} 5`);
    const Before = Describe().figures;
    Assert.ok(Command("save /roundtrip.arc"));
    Assert.match(
      Geometry.FS.readFile("/roundtrip.arc", { encoding: "utf8" }),
      /^# SolidArc native document v1/,
    );
    Command("reset");
    Assert.ok(Command("open /roundtrip.arc"));
    Assert.deepEqual(Describe().figures, Before);
    Geometry.FS.writeFile("/invalid.arc", "not a native document");
    Assert.equal(Command("open /invalid.arc"), false);
    Assert.deepEqual(Describe().figures, Before);
  }),
);
Verify(
  "Independent native documents retain their own geometry",
  Fresh(() => {
    Command("box (0,0,0) 2 3 4");
    const First = Describe().identity;
    const Second = Invoke("CreateDocument", "number");
    Command("sphere (0,0,0) 1");
    Assert.equal(Describe().figures[0].faces, 1);
    Invoke("ActivateDocument", "number", ["number"], [First]);
    Assert.equal(Describe().figures[0].faces, 6);
    Invoke("ReleaseDocument", null, ["number"], [Second]);
  }),
);
Verify(
  "Original software raster returns nonempty RGBA pixels and camera orbit changes them",
  Fresh(() => {
    Command("box (0,0,0) 2 3 4");
    Command("view fit");
    const Pointer = Invoke(
      "RenderDocument",
      "number",
      ["number", "number"],
      [320, 240],
    );
    const Before = Geometry.HEAPU8.slice(Pointer, Pointer + 320 * 240 * 4);
    Assert.ok(Before.some((Channel, Index) => Index % 4 !== 3 && Channel > 20));
    Invoke("OrbitDocument", null, ["number", "number"], [0.3, 0.1]);
    const Next = Invoke(
      "RenderDocument",
      "number",
      ["number", "number"],
      [320, 240],
    );
    Assert.notDeepEqual(
      Geometry.HEAPU8.slice(Next, Next + 320 * 240 * 4),
      Before,
    );
  }),
);
Verify(
  "Native OBJ export contains tessellated geometry",
  Fresh(() => {
    Command("box (0,0,0) 1 2 3");
    Assert.ok(Command("export /geometry.obj"));
    const Text = Geometry.FS.readFile("/geometry.obj", { encoding: "utf8" });
    Assert.match(Text, /^v /m);
    Assert.match(Text, /^f /m);
  }),
);
Verify(
  "All primitive UI defaults dispatch valid native commands",
  Fresh(() => {
    for (const [Key, Tool] of Object.entries(Tools)) {
      if (Tool.group === "Operations") continue;
      const Settings = Object.fromEntries(
        Tool.fields.map((Field) => [Field.key, Field.initial]),
      );
      Assert.ok(Command(ConstructCommand(Key, Settings, [])), Key);
    }
  }),
);
Verify(
  "Command forms reject nonfinite values, invalid torus radii and missing selections",
  () => {
    Assert.throws(() =>
      ConstructCommand("sphere", { radius: NaN, x: 0, y: 0, z: 0 }, []),
    );
    Assert.throws(() =>
      ConstructCommand("torus", { major: 1, minor: 2, x: 0, y: 0, z: 0 }, []),
    );
    Assert.throws(() => ConstructCommand("extrude", { distance: 1 }, []));
    Assert.throws(() =>
      ConstructCommand("fillet", { radius: 0.1 }, [{ id: 1, pickedEdges: [] }]),
    );
    Assert.throws(() =>
      ConstructCommand("subtract", {}, [{ id: 1, classification: 2 }]),
    );
  },
);
Verify("Names cannot inject commands or HTML into generated forms", () => {
  Assert.throws(() => NativeName("Box; reset"));
  Assert.throws(() => NativeName('Box"'));
  Assert.equal(NativeName("Bracket 01"), '"Bracket 01"');
  Assert.equal(
    Escape('<img onerror="1">'),
    "&lt;img onerror=&quot;1&quot;&gt;",
  );
});

Verify(
  "Native material finishes change the rendered pixels",
  Fresh(() => {
    Command("sphere (0,0,0) 1");
    Command("view fit");
    Command("show shading matcap");
    Command("matcap all steel");
    const First = Invoke(
      "RenderDocument",
      "number",
      ["number", "number"],
      [160, 120],
    );
    const Steel = Geometry.HEAPU8.slice(First, First + 160 * 120 * 4);
    Command("matcap all copper");
    const Next = Invoke(
      "RenderDocument",
      "number",
      ["number", "number"],
      [160, 120],
    );
    Assert.notDeepEqual(
      Geometry.HEAPU8.slice(Next, Next + 160 * 120 * 4),
      Steel,
    );
  }),
);
Verify(
  "Native box union, intersection and supported shell execute successfully",
  Fresh(() => {
    for (const Operation of ["union", "intersect"]) {
      Command("reset");
      Command("box (0,0,0) (2,2,2) --name=Stock");
      Command("box (1,1,1) (3,3,3) --name=Tool");
      Assert.ok(Command(`boolean ${Operation} Stock -- Tool`));
      Assert.equal(Describe().figures.length, 1);
      Assert.ok(Describe().figures[0].faces >= 6);
    }
    Command("reset");
    Command("box (0,0,0) (2,2,2) --name=Stock");
    Assert.ok(Command("shell Stock 0.1 --face=5"));
    Assert.ok(Describe().figures.some((Figure) => Figure.faces > 6));
  }),
);

Verify(
  "Native sketch-region extrusion retains inner holes and exposes control-point picks",
  Fresh(() => {
    Command("circle (0,0) 1 --name=Outer");
    Command("circle (0,0) 0.4 --name=Inner");
    const Region = Describe().areas.find((Region) => Region.holes === 1);
    Assert.ok(Region);
    Assert.ok(Command(`extrude a${Region.id} 1`));
    Assert.equal(
      Describe().figures.find((Figure) => Figure.classification === 2).faces,
      4,
    );
    Command("selectmode control");
    Command("select poles Outer 0");
    Assert.deepEqual(
      Describe().figures.find((Figure) => Figure.name === "Outer").pickedPoles,
      [0],
    );
  }),
);

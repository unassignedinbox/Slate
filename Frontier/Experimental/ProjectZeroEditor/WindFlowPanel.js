import { windPanel, beaufort } from "./InspectorDepot/panels/wind.js";
import { el } from "./InspectorDepot/kit.js";
import { AttachWindFlow } from "./FlowProjection.js";
import {
  ResolveWind,
  ResolveInspectorWind,
  EvaluateWind,
} from "./WindSpecification.js";

export function WindFlowPanel(Node, Context) {
  // Keep the approved reference markup; retire its illustrative, unrelated curl/history simulation.
  const Host = windPanel(Node, { ...Context, register: () => {} });
  Host._dispose();
  const Trace = Host.querySelector(".wf-trace");
  while (Trace.nextElementSibling) Trace.nextElementSibling.remove();
  const OldCanvas = Host.querySelector(".wf-hero canvas"),
    Canvas = OldCanvas.cloneNode(false);
  OldCanvas.replaceWith(Canvas);
  Canvas.style.height = "168px";
  Canvas.title =
    "Drag the arrow for strength and heading. Drag the tornado centre or spline handles. Alt-click moves the anemometer probe. Arrow keys adjust strength and heading.";
  const Hero = Host.querySelector(".wf-hero");
  const Surface = el("div", "flow-surface");
  Canvas.replaceWith(Surface);
  Surface.append(Canvas, Hero.querySelector(".mp-cap"));
  const Controls = el("div", "flow-controls");
  Controls.innerHTML = `<div class="flow-modes"><button data-mode="Directional">Arrow</button><button data-mode="Tornado">Tornado</button><button data-mode="Spline">Spline</button><button class="flow-pause" title="Pause flow preview" aria-label="Pause flow preview">Ⅱ</button></div>
    <label class="flow-component">Component<select aria-label="Wind component"></select></label>
    <div class="flow-inputs"><label>Strength <span><input aria-label="Wind strength" type="number" min="0" max="100" step="0.1"> m/s</span></label><label class="flow-heading">Towards <span><input aria-label="Wind heading" type="number" min="0" max="360" step="1"> °</span></label><label class="flow-rotation" hidden>Rotation<select aria-label="Tornado rotation"><option value="1">Clockwise</option><option value="-1">Counterclockwise</option></select></label></div>
    <label class="flow-follow">Spline following <input aria-label="Spline following" type="range" min="0" max="1" step="0.01"><output></output></label>
    <span class="flow-help"></span>`;
  Hero.append(Controls);
  const Select = Controls.querySelector("select"),
    Strength = Controls.querySelector('[aria-label="Wind strength"]'),
    Bearing = Controls.querySelector('[aria-label="Wind heading"]'),
    Following = Controls.querySelector('[aria-label="Spline following"]');
  let Selected = 0,
    Paused = false,
    Signature = "",
    History = [],
    Accumulator = 0,
    Time = 0;
  const Field = () => Node.props.field || ResolveInspectorWind({}, Node.props);
  const EffectiveField = () =>
    Node.vis === false ? { ...Field(), Components: [] } : Field();
  const Probe = () =>
    Array.isArray(Node.props.probe) &&
    Node.props.probe.length === 2 &&
    Node.props.probe.every(Number.isFinite)
      ? Node.props.probe
      : [Field().Width * 0.15, 0];
  function Edit(Changes) {
    const Current = Field(),
      Components = Current.Components.map((Part, I) =>
        I === Selected ? { ...Part, ...Changes } : Part,
      );
    const Next = ResolveWind({ WindField: { ...Current, Components } });
    Context.setProp(Node, "field", Next);
    Sync();
  }
  function Sync() {
    const Current = Field();
    Selected = Math.max(0, Math.min(Selected, Current.Components.length - 1));
    const Part = Current.Components[Selected];
    const Stamp = JSON.stringify(Probe());
    if (Stamp !== Signature) {
      History = [];
      Accumulator = 0;
      Signature = Stamp;
    }
    Select.replaceChildren(
      ...Current.Components.map((P, I) => {
        const O = document.createElement("option");
        O.value = I;
        O.textContent = P.Name + (P.Enabled ? "" : " (disabled)");
        return O;
      }),
    );
    Select.value = Selected;
    Controls.querySelector(".flow-component").hidden =
      Current.Components.length <= 1;
    Controls.querySelectorAll("[data-mode]").forEach((Button) =>
      Button.classList.toggle("on", Button.dataset.mode === Part?.Type),
    );
    Strength.disabled = Bearing.disabled = Following.disabled = !Part;
    if (document.activeElement !== Strength)
      Strength.value = Part?.Strength ?? 0;
    if (document.activeElement !== Bearing) Bearing.value = Part?.Bearing ?? 0;
    Controls.querySelector(".flow-heading").hidden = Part?.Type === "Tornado";
    Controls.querySelector(".flow-rotation").hidden = Part?.Type !== "Tornado";
    Controls.querySelector('[aria-label="Tornado rotation"]').value =
      Part?.Spin ?? 1;
    Following.value = Part?.Follow ?? 0.8;
    Controls.querySelector(".flow-follow").hidden = Part?.Type !== "Spline";
    Controls.querySelector("output").textContent =
      Math.round((Part?.Follow ?? 0.8) * 100) + "%";
    Controls.querySelector(".flow-help").textContent =
      Part?.Type === "Spline"
        ? "Drag the four curve handles · 0% heading / 100% path guidance"
        : Part?.Type === "Tornado"
          ? "Drag centre to place · drag arrow to set strength"
          : "Drag arrow · length = strength · angle = heading";
  }
  Controls.querySelectorAll("[data-mode]").forEach(
    (Button) =>
      (Button.onclick = () => {
        if (!Field().Components.length) {
          Context.setProp(Node, "field", ResolveInspectorWind());
          Sync();
        }
        Edit({ Type: Button.dataset.mode, Enabled: true });
      }),
  );
  Select.onchange = () => {
    Selected = Number(Select.value);
    Sync();
  };
  Strength.onchange = () => {
    if (Number.isFinite(Strength.valueAsNumber))
      Edit({ Strength: Strength.valueAsNumber });
    else Sync();
  };
  Bearing.onchange = () => {
    if (Number.isFinite(Bearing.valueAsNumber))
      Edit({ Bearing: ((Bearing.valueAsNumber % 360) + 360) % 360 });
    else Sync();
  };
  Controls.querySelector('[aria-label="Tornado rotation"]').onchange = (
    Event,
  ) => Edit({ Spin: Number(Event.target.value) });
  Following.oninput = () => Edit({ Follow: Number(Following.value) });
  Controls.querySelector(".flow-pause").onclick = (Event) => {
    Paused = !Paused;
    Event.currentTarget.textContent = Paused ? "▶" : "Ⅱ";
    Event.currentTarget.setAttribute(
      "aria-label",
      Paused ? "Resume flow preview" : "Pause flow preview",
    );
  };
  Trace.querySelector(".mp-x").onclick = () => {
    Trace.classList.toggle("tall");
    PaintTrace();
  };
  Trace.querySelector(".mp-chead .s").textContent = "PROBE · LAST 60 SECONDS";
  const Chart = Trace.querySelector("canvas");
  function PaintTrace() {
    const W = Chart.parentElement.clientWidth || 280,
      H = Trace.classList.contains("tall") ? 170 : 112,
      D = Math.min(devicePixelRatio || 1, 2);
    Chart.width = W * D;
    Chart.height = H * D;
    Chart.style.height = H + "px";
    const G = Chart.getContext("2d");
    G.setTransform(D, 0, 0, D, 0, 0);
    const Max = Math.max(2, ...History.map((P) => P.Speed)) * 1.18,
      X = (T) => 2 + (1 - (Time - T) / 60) * (W - 32),
      Y = (V) => 8 + (1 - V / Max) * (H - 23);
    G.font = "9px ui-sans-serif,system-ui";
    G.lineWidth = 1;
    G.textAlign = "left";
    for (const F of [0.25, 0.5, 0.75, 1]) {
      G.strokeStyle = "rgba(255,255,255,.06)";
      G.setLineDash([2, 5]);
      G.beginPath();
      G.moveTo(2, Y(Max * F));
      G.lineTo(W - 30, Y(Max * F));
      G.stroke();
      G.fillStyle = "rgba(255,255,255,.26)";
      G.fillText((Max * F).toFixed(1), W - 26, Y(Max * F) + 3);
    }
    G.setLineDash([]);
    G.strokeStyle = "rgba(137,224,196,.9)";
    G.lineWidth = 1.4;
    G.beginPath();
    History.forEach((P, I) =>
      I ? G.lineTo(X(P.Time), Y(P.Speed)) : G.moveTo(X(P.Time), Y(P.Speed)),
    );
    G.stroke();
    const Last = History.at(-1);
    if (Last) {
      G.fillStyle = "#fff";
      G.beginPath();
      G.arc(X(Last.Time), Y(Last.Speed), 2.5, 0, Math.PI * 2);
      G.fill();
    }
    G.fillStyle = "rgba(255,255,255,.26)";
    G.textAlign = "left";
    G.fillText("−60 s", 2, H - 3);
    G.textAlign = "center";
    G.fillText("−30 s", W / 2, H - 3);
    G.textAlign = "right";
    G.fillText("now", W - 30, H - 3);
  }
  const Compass = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  function Reading(Now, DT) {
    Time = Now;
    Accumulator += Paused ? 0 : DT;
    const Velocity = EvaluateWind(EffectiveField(), ...Probe(), Time),
      Speed = Math.hypot(...Velocity);
    if (!History.length || Accumulator >= 0.25) {
      Accumulator = 0;
      History.push({ Time, Speed });
      History = History.filter((P) => P.Time >= Time - 60).slice(-241);
    }
    const Mean = History.reduce((A, P) => A + P.Speed, 0) / History.length,
      Hi = Math.max(...History.map((P) => P.Speed)),
      Lo = Math.min(...History.map((P) => P.Speed));
    const From =
        ((Math.atan2(-Velocity[0], Velocity[1]) * 180) / Math.PI + 360) % 360,
      B = beaufort(Mean),
      Direction = Speed > 0.01 ? Compass[Math.round(From / 22.5) % 16] : "—";
    Host.querySelector(".wf-name").textContent = B.name;
    Host.querySelector(".wf-sub").textContent =
      `${Speed.toFixed(1)} m/s at probe · flow preview 8×`;
    Host.querySelector(".wf-r").textContent = "FORCE " + B.n;
    const Values = [
      `${Mean.toFixed(1)}<em>m/s</em>`,
      `${Hi.toFixed(1)}<em>m/s</em>`,
      `${Direction}<em>${Speed > 0.01 ? Math.round(From) + "°" : ""}</em>`,
      `${B.n}<em>bf</em>`,
    ];
    Host.querySelectorAll(".mp-rail .v").forEach(
      (N, I) => (N.innerHTML = Values[I]),
    );
    Host.querySelectorAll(".mp-duo .n").forEach(
      (N, I) => (N.innerHTML = `${(I ? Lo : Hi).toFixed(1)}<em>m/s</em>`),
    );
    const Fixed = Speed.toFixed(1).split(".");
    Trace.querySelector(".mp-num .i").textContent = Fixed[0];
    Trace.querySelector(".mp-num .d").textContent = "." + Fixed[1];
    Trace.querySelector(".mp-target .v").textContent =
      `${Mean.toFixed(1)} m/s · ${B.name.toLowerCase()}, force ${B.n}`;
    Trace.querySelector(".wf-specs").innerHTML = [
      ["gust factor", (Hi / Math.max(Mean, 0.1)).toFixed(2) + "×"],
      ["spread", (Hi - Lo).toFixed(1) + " m/s"],
      ["pressure", (0.5 * 1.225 * Speed * Speed).toFixed(0) + " Pa"],
      [
        "probe",
        Probe()
          .map((V) => Math.round(V))
          .join(", ") + " m",
      ],
    ]
      .map(([K, V]) => `<div><span class="k">${K}</span><b>${V}</b></div>`)
      .join("");
    PaintTrace();
  }
  Context.register?.(Sync);
  Sync();
  Host._dispose = AttachWindFlow(
    Canvas,
    () => ({
      Field: EffectiveField(),
      Selected,
      Probe: Probe(),
      Paused,
      OnFrame: Reading,
    }),
    Edit,
    (Point) => {
      Context.setProp(Node, "probe", Point);
      Sync();
    },
  );
  return Host;
}

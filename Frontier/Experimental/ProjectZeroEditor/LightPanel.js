//============================================================================================================================================
//                                                              LIGHTPANEL.JS
//============================================================================================================================================
// 📦 Type-specific browser light instruments with live emission and aperture illustrations.

import { MountLightTransform } from "./EmitterPanel.jsx";
import { el } from "./InspectorDepot/kit.js";
const Labels = {
  pointlight: "Point light",
  spotlight: "Spot light",
  ieslight: "IES / automotive",
  arealight: "Area light",
  tubelight: "Tube light",
};
const Clamp = (NumberValue, Minimum, Maximum) =>
  Math.max(Minimum, Math.min(Maximum, NumberValue));
function Temperature(Kelvin) {
  const Heat = Kelvin / 100;
  return [
    Heat <= 66 ? 255 : 329.6987 * (Heat - 60) ** -0.1332,
    Heat <= 66
      ? 99.4708 * Math.log(Heat) - 161.1196
      : 288.1222 * (Heat - 60) ** -0.0755,
    Heat >= 66
      ? 255
      : Heat <= 19
        ? 0
        : 138.5177 * Math.log(Heat - 10) - 305.0448,
  ].map((Channel) => Clamp(Channel, 0, 255));
}
export function LightPanel(Subject, Context) {
  const Properties = Subject.props,
    Style = Subject.type,
    Spot = Style === "spotlight",
    Point = Style === "pointlight",
    Automotive = Style === "ieslight",
    Area = Style === "arealight";
  const Host = el("div", "mpanel lighting-panel"),
    Bindings = [],
    Charts = [];
  const Read = (Key, Fallback = 0) =>
    Number.isFinite(Number(Properties[Key]))
      ? Number(Properties[Key])
      : Fallback;
  const Write = (Key, Next) => {
    if (Subject.locked) return;
    Context.setProp(Subject, Key, Next);
    Refresh();
  };
  const Card = (Name, Caption, ClassName) => {
    const Section = el("section", "pcard lp-card " + ClassName);
    const Header = el("header");
    Header.append(el("h3", "", Name), el("span", "", Caption));
    Section.append(Header);
    Host.append(Section);
    return Section;
  };
  const Field = (Section, Key, Name, Minimum, Maximum, Step, Unit) => {
    const Label = el("label", "field");
    Label.append(el("span", "", Name));
    const Pill = el("div", "slider-pill"),
      Split = el("div", "split-value"),
      NumberInput = el("input"),
      Slider = el("input");
    NumberInput.type = "number";
    Slider.type = "range";
    for (const Input of [NumberInput, Slider]) {
      Input.min = Minimum;
      Input.max = Maximum;
      Input.step = Step;
      Input.dataset.lightProperty = Key;
      Input.setAttribute(
        "aria-label",
        Name + (Input === NumberInput ? " value" : ""),
      );
      Input.onblur = Refresh;
      Input.oninput = () => {
        if (Input.value === "") return;
        const Numeric = Number(Input.value);
        if (Number.isFinite(Numeric))
          Write(Key, Clamp(Numeric, Minimum, Maximum));
      };
    }
    Split.append(NumberInput, el("small", "", Unit));
    Pill.append(Split, Slider);
    Label.append(Pill);
    Section.append(Label);
    Bindings.push(() => {
      for (const Input of [NumberInput, Slider]) {
        Input.value = Read(Key);
        Input.disabled = Subject.locked;
      }
      Slider.style.setProperty(
        "--fill",
        (100 * (Read(Key) - Minimum)) / (Maximum - Minimum) + "%",
      );
    });
  };
  const Toggle = (Section, Key, Name) => {
    const Row = el("div", "lp-toggle-row"),
      Button = el("button", "lp-switch");
    Row.append(el("span", "", Name), Button);
    Button.setAttribute("role", "switch");
    Button.setAttribute("aria-label", Name);
    Button.append(el("i"));
    Button.onclick = () => Write(Key, !Properties[Key]);
    Section.append(Row);
    Bindings.push(() => {
      Button.setAttribute("aria-checked", !!Properties[Key]);
      Button.disabled = Subject.locked;
    });
  };
  const Canvas = (Section, Painter, Height = 158) => {
    const CanvasElement = el("canvas", "lp-canvas");
    CanvasElement.setAttribute("role", "img");
    CanvasElement.setAttribute(
      "aria-label",
      Section.querySelector("h3").textContent + " illustration",
    );
    Section.append(CanvasElement);
    Charts.push(() => {
      const Width = CanvasElement.clientWidth || 280,
        Ratio = Math.min(devicePixelRatio || 1, 2);
      CanvasElement.width = Width * Ratio;
      CanvasElement.height = Height * Ratio;
      CanvasElement.style.height = Height + "px";
      const Brush = CanvasElement.getContext("2d");
      Brush.setTransform(Ratio, 0, 0, Ratio, 0, 0);
      Painter(Brush, Width, Height);
    });
    return CanvasElement;
  };
  function Colour() {
    const Hex = /^#[0-9a-f]{6}$/i.test(Properties.color)
        ? Properties.color
        : "#ffffff",
      Channels = [1, 3, 5].map((Index) =>
        parseInt(Hex.slice(Index, Index + 2), 16),
      ),
      Warm = Properties.temperature
        ? Temperature(Read("temperature", 5600))
        : [255, 255, 255];
    return Channels.map((Channel, Index) =>
      Math.round((Channel * Warm[Index]) / 255),
    );
  }
  const Tint = (Opacity = 1) => `rgba(${Colour().join(",")},${Opacity})`;
  const Flux = () => Math.max(0, Read(Point || Spot ? "intensity" : "lumens"));
  const Brightness = () =>
    Clamp(Flux() / (Point ? 30 : Spot ? 100 : 3000), 0, 1);
  const Preview = Card(
    Automotive
      ? "Beam distribution"
      : Point
        ? "Radial emission"
        : Spot
          ? "Spot projection"
          : Area
            ? "Luminous aperture"
            : "Linear emission",
    Labels[Style],
    "lp-preview",
  );
  Canvas(Preview, (Brush, Width, Height) => {
    const Center = Width * 0.5;
    Brush.fillStyle = "#111313";
    Brush.fillRect(0, 0, Width, Height);
    Brush.strokeStyle = "#ffffff09";
    Brush.lineWidth = 1;
    for (let Row = 0; Row < 5; Row++) {
      Brush.beginPath();
      Brush.moveTo(12, 93 + Row * 14);
      Brush.lineTo(Width - 12, 93 + Row * 14);
      Brush.stroke();
    }
    for (let Column = -4; Column <= 4; Column++) {
      Brush.beginPath();
      Brush.moveTo(Center + Column * 11, 82);
      Brush.lineTo(Center + Column * 43, Height);
      Brush.stroke();
    }
    if (Point) {
      const Radius = 50 + Read("distance", 26) * 0.12,
        Glow = Brush.createRadialGradient(Center, 68, 1, Center, 68, Radius);
      Glow.addColorStop(0, Tint(0.8 * Brightness()));
      Glow.addColorStop(0.25, Tint(0.16 * Brightness()));
      Glow.addColorStop(1, Tint(0));
      Brush.fillStyle = Glow;
      Brush.fillRect(0, 0, Width, Height);
      for (const Scale of [0.4, 0.7, 1]) {
        Brush.beginPath();
        Brush.ellipse(
          Center,
          77,
          Radius * Scale,
          Radius * Scale * 0.42,
          0,
          0,
          Math.PI * 2,
        );
        Brush.strokeStyle = Tint(0.25);
        Brush.stroke();
      }
      Brush.fillStyle = Tint();
      Brush.beginPath();
      Brush.arc(Center, 65, 4, 0, Math.PI * 2);
      Brush.fill();
    } else if (Automotive) {
      if (Properties.profile === "Custom .IES") {
        Brush.fillStyle = "#8a938d";
        Brush.font = "11px sans-serif";
        Brush.fillText("IES file import pending", 20, 85);
        return;
      }
      const Field = Read("cone", 58),
        Pitch = Read("cutoff", -1),
        Profile = Properties.profile || "ECE Low Beam";
      const Spread = Width * Clamp(Field / 110, 0.08, 0.85),
        Y = 73 + Pitch * 4,
        Low = Profile.includes("Low Beam"),
        Fog = Profile === "Fog Lamp";
      const Gradient = Brush.createRadialGradient(
        Center,
        Y + 14,
        0,
        Center,
        Y + 14,
        Spread * (Profile === "High Beam" ? 0.3 : Fog ? 0.8 : 0.6),
      );
      Gradient.addColorStop(
        0,
        Tint(
          (Profile === "Parking Lamp" ? 0.18 : 0.85) *
            Brightness() *
            Math.min(1, Read("multiplier", 1)),
        ),
      );
      Gradient.addColorStop(1, Tint(0));
      Brush.save();
      Brush.beginPath();
      Brush.moveTo(Center - Spread / 2, Y + (Fog ? 14 : 0));
      Brush.lineTo(Center, Y);
      Brush.lineTo(Center + Spread / 2, Y - (Low ? 11 : 0));
      Brush.lineTo(Center + Spread / 2, Y + 65);
      Brush.lineTo(Center - Spread / 2, Y + 65);
      Brush.closePath();
      Brush.clip();
      Brush.fillStyle = Gradient;
      Brush.fillRect(0, 0, Width, Height);
      Brush.restore();
      Brush.strokeStyle = Tint(0.6);
      Brush.beginPath();
      Brush.moveTo(Center - Spread / 2, Y);
      Brush.lineTo(Center, Y);
      Brush.lineTo(Center + Spread / 2, Y - (Low ? 11 : 0));
      Brush.stroke();
      Brush.setLineDash([3, 6]);
      Brush.strokeStyle = "#ffffff30";
      Brush.beginPath();
      Brush.moveTo(Center, 16);
      Brush.lineTo(Center, Height - 12);
      Brush.stroke();
      Brush.setLineDash([]);
    } else if (Spot) {
      const Spread = Math.tan((Read("angle", 26) * Math.PI) / 360) * 110,
        Soft = Read("penumbra", 0.42);
      const Beam = Brush.createLinearGradient(0, 27, 0, 135);
      Beam.addColorStop(0, Tint(0.55 * Brightness()));
      Beam.addColorStop(1, Tint(0.04 * Brightness()));
      Brush.fillStyle = Beam;
      Brush.beginPath();
      Brush.moveTo(Center, 27);
      Brush.lineTo(Center - Spread, 126);
      Brush.ellipse(Center, 126, Spread, Spread * 0.23, 0, Math.PI, 0, true);
      Brush.closePath();
      Brush.fill();
      const Pool = Brush.createRadialGradient(
        Center,
        126,
        0,
        Center,
        126,
        Math.max(Spread, 1),
      );
      Pool.addColorStop(Math.max(0, 1 - Soft) * 0.5, Tint(0.6 * Brightness()));
      Pool.addColorStop(1, Tint(0));
      Brush.save();
      Brush.translate(Center, 126);
      Brush.scale(1, 0.25);
      Brush.fillStyle = Pool;
      Brush.translate(-Center, -126);
      Brush.fillRect(Center - Spread, 126 - Spread, Spread * 2, Spread * 2);
      Brush.restore();
      Brush.fillStyle = "#c8ceca";
      Brush.fillRect(Center - 9, 18, 18, 11);
    } else {
      const Span = Area
          ? Clamp(Read("width", 2) / Math.max(0.1, Read("height", 1)), 0.2, 4)
          : Clamp(Read("length", 1.5) * 1.5, 0.2, 4),
        Across = Math.min(Width * 0.7, 55 * Math.sqrt(Span)),
        Depth = Area
          ? Math.min(55, 55 / Math.sqrt(Span))
          : Clamp(Read("radius", 0.04) * 90, 3, 20);
      Brush.shadowColor = Tint(0.8);
      Brush.shadowBlur = 20 * Brightness();
      Brush.fillStyle = Tint(0.25 + 0.7 * Brightness());
      Brush.beginPath();
      Brush.moveTo(Center - Across / 2, 50);
      Brush.lineTo(Center + Across / 2, 35);
      Brush.lineTo(Center + Across / 2, 35 + Depth);
      Brush.lineTo(Center - Across / 2, 50 + Depth);
      Brush.closePath();
      Brush.fill();
      Brush.shadowBlur = 0;
      Brush.strokeStyle = "#ffffffb0";
      Brush.stroke();
      const Pool = Brush.createRadialGradient(
        Center,
        115,
        0,
        Center,
        115,
        Across * (Area ? 0.3 + Read("spread", 120) / 120 : 1),
      );
      Pool.addColorStop(0, Tint(0.22 * Brightness()));
      Pool.addColorStop(1, Tint(0));
      Brush.save();
      Brush.translate(Center, 115);
      Brush.scale(1, 0.3);
      Brush.translate(-Center, -115);
      Brush.fillStyle = Pool;
      Brush.fillRect(0, 0, Width, Height * 2);
      Brush.restore();
    }
    Brush.font = "8px sans-serif";
    Brush.fillStyle = "#7a807d";
    Brush.fillText("SCHEMATIC", 12, 17);
  });
  const Rail = el("div", "mp-rail lp-readings");
  Host.append(Rail);
  const Metric = (Name, Readout) => {
    const Cell = el("div", "mp-pill"),
      Reading = el("b", "v");
    Cell.append(Reading, el("span", "k", Name));
    Rail.append(Cell);
    Bindings.push(() => (Reading.textContent = Readout()));
  };
  const Format = (Numeric, Digits = 0) =>
    Numeric.toLocaleString("en-US", { maximumFractionDigits: Digits });
  if (Point || Spot) {
    Metric("Intensity", () => Format(Flux(), 1) + " cd");
    Metric(
      "5 m · estimate",
      () => Format(Flux() / 5 ** (Point ? Read("decay", 2) : 2), 2) + " lx",
    );
    Metric(Spot ? "Cone" : "Reach", () =>
      Spot ? Format(Read("angle"), 1) + "°" : Format(Read("distance")) + " m",
    );
    Metric(Spot ? "Penumbra" : "Decay", () =>
      Spot ? Format(Read("penumbra") * 100) + "%" : Format(Read("decay"), 2),
    );
  } else {
    Metric("Flux", () => Format(Flux()) + " lm");
    Metric(Automotive ? "Field angle" : Area ? "Aperture" : "Length", () =>
      Automotive
        ? Format(Read("cone"), 1) + "°"
        : Area
          ? Format(Read("width") * Read("height"), 2) + " m²"
          : Format(Read("length"), 2) + " m",
    );
    Metric(Automotive ? "Multiplier" : Area ? "Spread" : "Radius", () =>
      Automotive
        ? Format(Read("multiplier"), 2) + "×"
        : Area
          ? Format(Read("spread")) + "°"
          : Format(Read("radius") * 1000) + " mm",
    );
    Metric(Area ? "Emission" : "Reach", () =>
      Area
        ? Properties.twoSided
          ? "Two-sided"
          : "One-sided"
        : Format(Read(Automotive ? "range" : "distance")) + " m",
    );
  }
  const Output = Card("Output & colour", "01", "lp-output");
  Field(
    Output,
    Point || Spot ? "intensity" : "lumens",
    Point || Spot ? "Intensity" : "Luminous flux",
    0,
    Point ? 60 : Spot ? 200 : Automotive ? 8000 : Area ? 20000 : 12000,
    Point ? 0.1 : Spot ? 1 : 50,
    Point || Spot ? "cd" : "lm",
  );
  if (Automotive || Style === "tubelight")
    Field(Output, "temperature", "Colour temperature", 1800, 12000, 100, "K");
  const ColourRow = el("label", "lp-colour"),
    ColourInput = el("input"),
    ColourCode = el("output");
  ColourInput.type = "color";
  ColourInput.setAttribute("aria-label", "Emission colour");
  ColourInput.oninput = () => Write("color", ColourInput.value);
  ColourRow.append(el("span", "", "Emission tint"), ColourInput, ColourCode);
  Output.append(ColourRow);
  Bindings.push(() => {
    ColourInput.value = Properties.color || "#ffffff";
    ColourInput.disabled = Subject.locked;
    ColourCode.textContent = ColourInput.value.toUpperCase();
  });
  const Shape = Card(
    Automotive
      ? "Distribution profile"
      : Point
        ? "Attenuation"
        : Spot
          ? "Beam shaping"
          : "Emitter dimensions",
    "02",
    "lp-shape",
  );
  if (Automotive) {
    const Profiles = el("div", "lp-profiles");
    for (const Profile of [
      "ECE Low Beam",
      "SAE Low Beam",
      "High Beam",
      "Fog Lamp",
      "Parking Lamp",
    ]) {
      const Button = el("button", "", Profile);
      Button.onclick = () => Write("profile", Profile);
      Profiles.append(Button);
      Bindings.push(() => {
        Button.setAttribute("aria-pressed", Properties.profile === Profile);
        Button.disabled = Subject.locked;
      });
    }
    Shape.append(Profiles);
    Shape.append(
      el("p", "lp-note", "Preset illustration · IES file import pending."),
    );
    Field(Shape, "multiplier", "Profile multiplier", 0, 4, 0.05, "×");
    Field(Shape, "cone", "Field angle", 5, 100, 0.5, "°");
    Field(Shape, "cutoff", "Cut-off pitch", -5, 5, 0.1, "°");
    Field(Shape, "range", "Photometric range", 1, 250, 1, "m");
  } else if (Point) {
    Field(Shape, "distance", "Reach", 1, 120, 1, "m");
    Field(Shape, "decay", "Decay exponent", 0, 4, 0.05, "");
  } else if (Spot) {
    Field(Shape, "angle", "Full cone angle", 2, 80, 0.5, "°");
    Field(Shape, "penumbra", "Penumbra", 0, 1, 0.01, "");
  } else if (Area) {
    Field(Shape, "width", "Width", 0.1, 20, 0.1, "m");
    Field(Shape, "height", "Height", 0.1, 20, 0.1, "m");
    Field(Shape, "spread", "Beam spread", 1, 180, 1, "°");
    Toggle(Shape, "twoSided", "Two-sided emission");
  } else {
    Field(Shape, "length", "Length", 0.1, 20, 0.1, "m");
    Field(Shape, "radius", "Tube radius", 0.01, 1, 0.01, "m");
    Field(Shape, "distance", "Reach", 1, 120, 1, "m");
  }
  if (Point || Spot)
    Canvas(
      Shape,
      (Brush, Width, Height) => {
        Brush.clearRect(0, 0, Width, Height);
        Brush.strokeStyle = "#ffffff14";
        Brush.beginPath();
        Brush.moveTo(10, 8);
        Brush.lineTo(10, Height - 20);
        Brush.lineTo(Width - 10, Height - 20);
        Brush.stroke();
        const Extent = Point ? Read("distance", 26) : 30,
          Exponent = Point ? Read("decay", 2) : 2;
        Brush.beginPath();
        for (let Sample = 0; Sample <= 80; Sample++) {
          const Distance = 1 + ((Extent - 1) * Sample) / 80,
            Illuminance = Flux() / Distance ** Exponent,
            Normalized = Math.log1p(Illuminance) / Math.log1p(200),
            Horizontal = 10 + (Sample / 80) * (Width - 20),
            Vertical = Height - 20 - Normalized * (Height - 28);
          Sample
            ? Brush.lineTo(Horizontal, Vertical)
            : Brush.moveTo(Horizontal, Vertical);
        }
        Brush.strokeStyle = Tint(0.9);
        Brush.stroke();
        Brush.fillStyle = "#777";
        Brush.font = "8px sans-serif";
        Brush.fillText("1 m", 10, Height - 5);
        Brush.textAlign = "right";
        Brush.fillText(Extent + " m", Width - 10, Height - 5);
        Brush.textAlign = "left";
      },
      98,
    );
  const Placement = el("div", "lp-card lp-transform");
  Host.append(Placement);
  const Transform = MountLightTransform(Placement, Subject, Context);
  Bindings.push(Transform.Refresh);
  const Visibility = Card("Light participation", "04", "lp-participation");
  Toggle(Visibility, "shadows", "Cast shadows");
  Toggle(
    Visibility,
    Automotive
      ? "showDistribution"
      : Spot
        ? "showCone"
        : Point
          ? "gizmoGlow"
          : "showShape",
    Automotive
      ? "Draw distribution"
      : Spot
        ? "Draw cone"
        : Point
          ? "Show glow"
          : "Draw emitter",
  );
  function Refresh() {
    Bindings.forEach((Sync) => Sync());
    Charts.forEach((Render) => Render());
  }
  Context.register(Refresh);
  const Observer = new ResizeObserver(Refresh);
  Observer.observe(Host);
  Host._dispose = () => {
    Observer.disconnect();
    Transform.Dispose();
  };
  Refresh();
  return Host;
}

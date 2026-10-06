//============================================================================================================================================
//                                                            LIGHTPROJECTION.JS
//============================================================================================================================================
// 📦 Source-specific analytical light diagrams for browser authoring; not measured photometry.

export function ProjectLight(
  Brush,
  Width,
  Height,
  { Style, Read, Properties, Tint, Flux },
) {
  const Left = 20,
    Right = Width - 18,
    Top = 18,
    Bottom = Height - 28,
    Center = Width / 2;
  Brush.clearRect(0, 0, Width, Height);
  Brush.lineWidth = 1;
  Brush.font = "9px sans-serif";
  const Text = (
    Label,
    Horizontal,
    Vertical,
    Align = "left",
    Colour = "#666b69",
  ) => {
    Brush.fillStyle = Colour;
    Brush.textAlign = Align;
    Brush.fillText(Label, Horizontal, Vertical);
  };
  const Line = (Points, Colour = "#ffffff16", Dashed = false) => {
    Brush.strokeStyle = Colour;
    Brush.setLineDash(Dashed ? [3, 5] : []);
    Brush.beginPath();
    Points.forEach(([Horizontal, Vertical], Index) =>
      Index
        ? Brush.lineTo(Horizontal, Vertical)
        : Brush.moveTo(Horizontal, Vertical),
    );
    Brush.stroke();
    Brush.setLineDash([]);
  };
  const Dot = (Horizontal, Vertical, Radius = 2, Colour = Tint(0.9)) => {
    Brush.fillStyle = Colour;
    Brush.beginPath();
    Brush.arc(Horizontal, Vertical, Radius, 0, Math.PI * 2);
    Brush.fill();
  };
  const Guides = () => {
    for (let Index = 0; Index < 4; Index++)
      Line(
        [
          [Left, Top + (Index * (Bottom - Top)) / 3],
          [Right, Top + (Index * (Bottom - Top)) / 3],
        ],
        "#ffffff0e",
        true,
      );
  };
  if (Style === "pointlight") {
    Guides();
    const Range = Read("distance", 30),
      Decay = Read("decay", 2),
      Strength = Math.min(1, Flux() / 60);
    const Points = Array.from({ length: 90 }, (_, Index) => {
      const Distance = Math.max(1.01, Range) ** (Index / 89);
      return [
        Left + (Index / 89) * (Right - Left),
        Bottom -
          (Bottom - Top) * Math.pow(Distance, -Decay) * (Flux() > 0 ? 1 : 0),
      ];
    });
    const Fill = Brush.createLinearGradient(0, Top, 0, Bottom);
    Fill.addColorStop(0, Tint(0.05 + 0.12 * Strength));
    Fill.addColorStop(1, Tint(0));
    Brush.fillStyle = Fill;
    Brush.beginPath();
    Brush.moveTo(Left, Bottom);
    Points.forEach((Coordinate) => Brush.lineTo(...Coordinate));
    Brush.lineTo(Right, Bottom);
    Brush.closePath();
    Brush.fill();
    Line(Points, Tint(0.85));
    [...new Set([5, 10, Range])]
      .filter((Distance) => Distance <= Range)
      .forEach((Distance) => {
        const Horizontal =
            Left +
            (Math.log(Distance) / Math.log(Math.max(1.01, Range))) *
              (Right - Left),
          Vertical =
            Bottom -
            (Bottom - Top) * Math.pow(Distance, -Decay) * (Flux() > 0 ? 1 : 0);
        if (Horizontal <= Right) {
          Dot(Horizontal, Vertical);
          Text(
            (Flux() / Distance ** Decay).toFixed(2),
            Horizontal,
            Vertical - 10,
            "center",
            "#afb5ad",
          );
        }
      });
    Text("1 m", Left, Height - 8);
    Text(Range + " m", Right, Height - 8, "right");
    Text("EST. lx · LOG DISTANCE", Right, 13, "right");
  } else if (Style === "spotlight") {
    const Half = Math.min(
        Width * 0.4,
        Math.tan((Read("angle", 26) * Math.PI) / 360) * 150,
      ),
      Soft = Read("penumbra", 0.42),
      Vertical = Bottom - 8;
    Guides();
    const Gradient = Brush.createLinearGradient(0, 25, 0, Vertical);
    Gradient.addColorStop(0, Tint(0.04));
    Gradient.addColorStop(1, Tint(0.28 * Math.min(1, Flux() / 120)));
    Brush.fillStyle = Gradient;
    Brush.beginPath();
    Brush.moveTo(Center, 26);
    Brush.lineTo(Center - Half, Vertical);
    Brush.ellipse(Center, Vertical, Half, 12, 0, Math.PI, 0, true);
    Brush.closePath();
    Brush.fill();
    Line(
      [
        [Center - Half, Vertical],
        [Center, 26],
        [Center + Half, Vertical],
      ],
      Tint(0.42),
    );
    Line(
      [
        [Center - Half * (1 - Soft), Vertical],
        [Center, 26],
        [Center + Half * (1 - Soft), Vertical],
      ],
      Tint(0.6),
      true,
    );
    Brush.strokeStyle = Tint(0.75);
    Brush.beginPath();
    Brush.ellipse(Center, Vertical, Half, 12, 0, 0, Math.PI * 2);
    Brush.stroke();
    Brush.fillStyle = "#c4c9bf";
    Brush.fillRect(Center - 10, 15, 20, 10);
    Text("SOFT EDGE", Left, Height - 7);
    Text(Math.round(Soft * 100) + "%", Right, Height - 7, "right");
  } else if (Style === "ieslight") {
    if (Properties.profile === "Custom .IES") {
      Text("No IES samples loaded", Center, Height / 2, "center");
      return;
    }
    const Radius = Math.min(Width * 0.39, Height * 0.43),
      CenterY = Height * 0.43;
    [1 / 3, 2 / 3, 1].forEach((Scale) => {
      Brush.strokeStyle = "#ffffff15";
      Brush.beginPath();
      Brush.arc(Center, CenterY, Radius * Scale, 0, Math.PI * 2);
      Brush.stroke();
    });
    Line(
      [
        [Center, 8],
        [Center, Height - 15],
      ],
      "#ffffff20",
      true,
    );
    Line(
      [
        [Center - Radius - 12, CenterY],
        [Center + Radius + 12, CenterY],
      ],
      "#ffffff20",
      true,
    );
    const Profile = Properties.profile || "Downlight",
      Points = [];
    for (let Index = 0; Index <= 180; Index++) {
      const Angle = (Index / 180) * Math.PI * 2,
        Pitch = (Read("cutoff", 0) * Math.PI) / 180,
        Axis = Math.max(0, Math.cos(Angle)),
        Lobe =
          Profile === "Batwing"
            ? Math.pow(Math.abs(Math.sin(Angle * 2)), 1.5) * Axis
            : Profile === "Wall wash"
              ? Math.max(0, Math.cos(Angle - 0.65)) ** 4
              : Math.pow(
                  Axis,
                  Profile === "Fog Lamp"
                    ? 0.65
                    : Profile === "Parking Lamp"
                      ? 0.45
                      : Math.max(
                          0.4,
                          (Profile === "High Beam" ? 240 : 130) /
                            Read("cone", 60),
                        ),
                );
      const Shape = Profile.includes("Low Beam")
        ? Lobe * (Math.sin(Angle) > 0 ? 0.62 : 1)
        : Lobe;
      Points.push([
        Center + Math.sin(Angle + Pitch) * Radius * Shape,
        CenterY + Math.cos(Angle + Pitch) * Radius * Shape,
      ]);
    }
    Brush.fillStyle = Tint(
      Math.min(0.18, (Flux() * Read("multiplier", 1)) / 16000),
    );
    Brush.beginPath();
    Points.forEach((Coordinate, Column) =>
      Column ? Brush.lineTo(...Coordinate) : Brush.moveTo(...Coordinate),
    );
    Brush.closePath();
    Brush.fill();
    Line(Points, Tint(0.85));
    Text("90°", Left, CenterY + 3);
    Text("90°", Right, CenterY + 3, "right");
    Text("PRESET · NORMALIZED", Center, Height - 7, "center");
  } else if (Style === "ledstrip") {
    const Count = Math.round(Read("length", 2.4) * Read("ledsPerMetre", 60)),
      Shown = Math.min(72, Math.max(2, Count));
    const Route = Properties.routing || "Cove",
      Points = Array.from({ length: Shown }, (_, Index) => {
        const Fraction = Index / (Shown - 1);
        if (Route === "Ring")
          return [
            Center + Math.cos(Fraction * Math.PI * 2) * Width * 0.33,
            Height * 0.48 + Math.sin(Fraction * Math.PI * 2) * Height * 0.27,
          ];
        if (Route === "Cove")
          return Fraction < 0.5
            ? [Left + Fraction * 2 * (Right - Left) * 0.78, Top + 14]
            : [
                Left + (Right - Left) * 0.78,
                Top + 14 + (Fraction - 0.5) * 2 * (Bottom - Top - 25),
              ];
        return [Left + Fraction * (Right - Left), Height * 0.5];
      });
    Brush.lineWidth = Properties.diffuser ? 12 : 9;
    Line(Points, "#ffffff0b");
    Brush.lineWidth = Properties.diffuser ? 7 : 1;
    Line(Points, Tint(Properties.diffuser ? 0.18 : 0.2));
    Brush.lineWidth = 1;
    Points.forEach(([Horizontal, Vertical], Index) => {
      Brush.shadowColor = Tint(0.6);
      Brush.shadowBlur = Properties.diffuser ? 12 : 4;
      Dot(
        Horizontal,
        Vertical,
        Properties.diffuser ? 1.7 : 2,
        Tint(0.2 + 0.75 * Read("dimmer", 1)),
      );
      Brush.shadowBlur = 0;
    });
    Text("+", Points[0][0] - 9, Points[0][1] + 4);
    Text(Count + " LEDS · SCHEMATIC", Left, Height - 7);
    Text(Read("length", 2.4).toFixed(1) + " m", Right, Height - 7, "right");
  } else if (Style === "ledlight") {
    const CenterY = Height * 0.48,
      Size = 30 + Read("diameter", 40) * 0.13;
    Brush.strokeStyle = "#ffffff24";
    Brush.strokeRect(
      Center - Size / 2 - 12,
      CenterY - Size / 2 - 12,
      Size + 24,
      Size + 24,
    );
    for (let Column = 0; Column < 4; Column++) {
      Line(
        [
          [Center - Size / 2 - 20, CenterY - Size / 2 + (Column * Size) / 3],
          [Center - Size / 2 - 12, CenterY - Size / 2 + (Column * Size) / 3],
        ],
        "#a692614d",
      );
      Line(
        [
          [Center + Size / 2 + 12, CenterY - Size / 2 + (Column * Size) / 3],
          [Center + Size / 2 + 20, CenterY - Size / 2 + (Column * Size) / 3],
        ],
        "#a692614d",
      );
    }
    Brush.shadowColor = Tint(0.5);
    Brush.shadowBlur = 22 * Read("dimmer", 1);
    Brush.fillStyle = Tint(0.15 + 0.6 * Read("dimmer", 1));
    Brush.fillRect(Center - Size / 2, CenterY - Size / 2, Size, Size);
    Brush.shadowBlur = 0;
    for (let Column = 0; Column < 3; Column++)
      for (let Row = 0; Row < 3; Row++) {
        Brush.strokeStyle = "#171b1680";
        Brush.strokeRect(
          Center - Size / 2 + 4 + (Column * Size) / 3,
          CenterY - Size / 2 + 4 + (Row * Size) / 3,
          Size / 3 - 8,
          Size / 3 - 8,
        );
      }
    Brush.strokeStyle = Tint(0.3);
    Brush.beginPath();
    Brush.arc(
      Center,
      CenterY,
      Size * 1.2,
      -Math.PI / 2 - (Read("angle", 120) * Math.PI) / 360,
      -Math.PI / 2 + (Read("angle", 120) * Math.PI) / 360,
    );
    Brush.stroke();
    Text(Read("diameter", 40) + " mm PACKAGE", Left, Height - 7);
    Text(Read("angle", 120) + "°", Right, Height - 7, "right");
  } else if (Style === "arealight") {
    const ApertureWidth = Read("width", 2),
      ApertureHeight = Read("height", 1),
      Across = Math.min(
        Width * 0.67,
        110 * Math.sqrt(ApertureWidth / Math.max(0.1, ApertureHeight)),
      ),
      Depth = Math.min(
        80,
        65 * Math.sqrt(ApertureHeight / Math.max(0.1, ApertureWidth)),
      ),
      Vertical = Height * 0.45;
    Brush.shadowColor = Tint(0.4);
    Brush.shadowBlur = 18;
    Brush.fillStyle = Tint(0.12 + 0.45 * Math.min(1, Flux() / 5000));
    Brush.strokeStyle = Tint(0.7);
    Brush.beginPath();
    if (Properties.aperture === "Disk")
      Brush.ellipse(Center, Vertical, Across / 2, Depth / 2, 0, 0, Math.PI * 2);
    else {
      Brush.moveTo(Center - Across / 2, Vertical - Depth / 2 + 8);
      Brush.lineTo(Center + Across / 2, Vertical - Depth / 2 - 8);
      Brush.lineTo(Center + Across / 2, Vertical + Depth / 2 - 8);
      Brush.lineTo(Center - Across / 2, Vertical + Depth / 2 + 8);
      Brush.closePath();
    }
    Brush.fill();
    Brush.stroke();
    Brush.shadowBlur = 0;
    const Splay = Math.sin((Read("spread", 120) * Math.PI) / 360) * 22;
    for (const Sign of [-1, 1])
      Line(
        [
          [Center + Sign * Across * 0.3, Vertical + Depth / 2 + 4],
          [Center + Sign * (Across * 0.3 + Splay), Vertical + Depth / 2 + 18],
        ],
        Tint(0.24),
      );
    Line(
      [
        [Center - Across / 2, Vertical + Depth / 2 + 23],
        [Center + Across / 2, Vertical + Depth / 2 + 23],
      ],
      "#ffffff36",
    );
    Dot(Center - Across / 2, Vertical + Depth / 2 + 23, 1);
    Dot(Center + Across / 2, Vertical + Depth / 2 + 23, 1);
    Text(
      ApertureWidth.toFixed(1) + " × " + ApertureHeight.toFixed(1) + " m",
      Center,
      Vertical + Depth / 2 + 38,
      "center",
    );
    Text(
      Properties.twoSided ? "TWO-SIDED" : "FRONT EMISSION",
      Left,
      Height - 7,
    );
    Text(Read("spread", 120) + "° SPREAD", Right, Height - 7, "right");
  } else {
    const Length = Math.min(Width * 0.78, 65 + Read("length", 1.5) * 27),
      Radius = Math.min(13, 3 + Read("radius", 0.04) * 50),
      Vertical = Height * 0.4;
    Brush.fillStyle = Tint(0.08 + 0.45 * Math.min(1, Flux() / 3000));
    Brush.shadowColor = Tint(0.55);
    Brush.shadowBlur = 20;
    Brush.beginPath();
    Brush.roundRect(
      Center - Length / 2,
      Vertical - Radius,
      Length,
      Radius * 2,
      Radius,
    );
    Brush.fill();
    Brush.shadowBlur = 0;
    Brush.strokeStyle = Tint(0.8);
    Brush.stroke();
    for (let Column = 0; Column < 6; Column++) {
      const Horizontal = Center - Length / 2 + (Column * Length) / 5;
      Line(
        [
          [Horizontal, Vertical + Radius + 10],
          [Horizontal, Vertical + Radius + 26],
        ],
        Tint(0.2),
      );
    }
    Text(
      Read("length", 1.5).toFixed(1) + " m",
      Center,
      Vertical + Radius + 45,
      "center",
    );
    Text(Read("distance", 30) + " m REACH", Left, Height - 7);
    Text(
      (Read("radius", 0.04) * 1000).toFixed(0) + " mm RADIUS",
      Right,
      Height - 7,
      "right",
    );
  }
  Brush.textAlign = "left";
}

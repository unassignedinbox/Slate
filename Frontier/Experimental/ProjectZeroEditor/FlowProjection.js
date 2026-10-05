import { EvaluateWind, SampleWindPath } from "./WindSpecification.js";

// One XZ velocity field drives both the strokes and the authoring handles.
export function AttachWindFlow(Canvas, Read, Edit, ProbeChange) {
  const Context = Canvas.getContext("2d");
  const Particles = Array.from({ length: 190 }, (_, I) => ({
    X: ((I * 977) % 1000) / 1000 - 0.5,
    Z: ((I * 613) % 1000) / 1000 - 0.5,
    Life: 0.5 + (I % 19) / 19,
  }));
  let Previous = performance.now(),
    Time = 0,
    Frame = 0,
    Alive = true,
    Drag = null;
  function Position(Event) {
    const R = Canvas.getBoundingClientRect(),
      { Field } = Read();
    return [
      ((Event.clientX - R.left) / R.width) * Field.Width - Field.Width / 2,
      ((Event.clientY - R.top) / R.height) * Field.Depth - Field.Depth / 2,
    ];
  }
  function Move(Event) {
    if (!Drag || !Edit) return;
    const { Field, Selected = 0 } = Read(),
      Part = Field.Components[Selected];
    if (!Part) return;
    const [X, Z] = Position(Event),
      R = Canvas.getBoundingClientRect();
    if (Drag.Kind === "probe") {
      ProbeChange?.([X, Z]);
      return;
    }
    if (Drag.Kind === "path") {
      const Path = Part.Path.map((Point) => [...Point]);
      Path[Drag.Index] = [
        Math.max(-Field.Width / 2, Math.min(Field.Width / 2, X)),
        Math.max(-Field.Depth / 2, Math.min(Field.Depth / 2, Z)),
      ];
      Edit({ Path });
      return;
    }
    if (Drag.Kind === "centre") {
      Edit({ X, Z });
      return;
    }
    const DX = ((X - Part.X) / Field.Width) * R.width,
      DZ = ((Z - Part.Z) / Field.Depth) * R.height;
    const Bearing = ((Math.atan2(DX, -DZ) * 180) / Math.PI + 360) % 360;
    Edit({
      Bearing: +Bearing.toFixed(1),
      Strength: +Math.min(
        100,
        (Math.hypot(DX, DZ) / (Math.min(R.width, R.height) * 0.34)) * 30,
      ).toFixed(1),
    });
  }
  const Down = (Event) => {
    if (!Edit || Event.button !== 0) return;
    Event.preventDefault();
    const { Field, Selected = 0 } = Read(),
      Part = Field.Components[Selected];
    if (!Part) return;
    Canvas.focus();
    Canvas.setPointerCapture(Event.pointerId);
    const [X, Z] = Position(Event),
      R = Canvas.getBoundingClientRect();
    const Distance = (P) =>
      Math.hypot(
        ((X - P[0]) / Field.Width) * R.width,
        ((Z - P[1]) / Field.Depth) * R.height,
      );
    Drag = { Kind: Event.altKey ? "probe" : "vector" };
    if (!Event.altKey && Part.Type === "Spline") {
      const Index = Part.Path.findIndex((Point) => Distance(Point) < 13);
      if (Index >= 0) Drag = { Kind: "path", Index };
    } else if (
      !Event.altKey &&
      Part.Type === "Tornado" &&
      Distance([Part.X, Part.Z]) < 12
    )
      Drag = { Kind: "centre" };
    Move(Event);
  };
  const Up = (Event) => {
    Drag = null;
    if (Canvas.hasPointerCapture?.(Event.pointerId))
      Canvas.releasePointerCapture(Event.pointerId);
  };
  const Key = (Event) => {
    if (!Edit) return;
    const Part = Read().Field.Components[Read().Selected || 0];
    if (!Part) return;
    const Changes = {
      ArrowUp: { Strength: Math.min(100, Part.Strength + 1) },
      ArrowDown: { Strength: Math.max(0, Part.Strength - 1) },
      ArrowLeft: { Bearing: (Part.Bearing + 355) % 360 },
      ArrowRight: { Bearing: (Part.Bearing + 5) % 360 },
    }[Event.key];
    if (Changes) {
      Event.preventDefault();
      Edit(Changes);
    }
  };
  if (Edit) {
    Canvas.tabIndex = 0;
    Canvas.setAttribute("role", "application");
    Canvas.setAttribute("aria-label", "Wind flow canvas");
    Canvas.style.touchAction = "none";
  }
  Canvas.addEventListener("pointerdown", Down);
  Canvas.addEventListener("pointermove", Move);
  Canvas.addEventListener("pointerup", Up);
  Canvas.addEventListener("pointercancel", Up);
  Canvas.addEventListener("keydown", Key);
  function Paint(Now) {
    if (!Alive) return;
    const State = Read(),
      { Field, Selected = 0 } = State,
      Part = Field.Components[Selected];
    const DT = Math.min(0.05, (Now - Previous) / 1000);
    Previous = Now;
    if (!State.Paused) Time += DT;
    const W = Canvas.clientWidth || 300,
      H = Canvas.clientHeight || 168,
      D = Math.min(devicePixelRatio || 1, 2);
    if (
      Canvas.width !== Math.round(W * D) ||
      Canvas.height !== Math.round(H * D)
    ) {
      Canvas.width = Math.round(W * D);
      Canvas.height = Math.round(H * D);
    }
    const G = Context;
    G.setTransform(D, 0, 0, D, 0, 0);
    const Background = G.createLinearGradient(0, 0, 0, H);
    Background.addColorStop(0, "#0a1014");
    Background.addColorStop(1, "#0d1a1b");
    G.fillStyle = Background;
    G.fillRect(0, 0, W, H);
    const Pixel = (P) => [
      (P[0] / Field.Width + 0.5) * W,
      (P[1] / Field.Depth + 0.5) * H,
    ];
    G.strokeStyle = "rgba(255,255,255,.035)";
    G.lineWidth = 1;
    G.beginPath();
    for (let X = 0; X < W; X += 26) {
      G.moveTo(X, 0);
      G.lineTo(X, H);
    }
    for (let Y = 0; Y < H; Y += 26) {
      G.moveTo(0, Y);
      G.lineTo(W, Y);
    }
    G.stroke();
    for (const P of Particles) {
      const X = P.X * Field.Width,
        Z = P.Z * Field.Depth,
        V = EvaluateWind(Field, X, Z, Time),
        Speed = Math.hypot(...V);
      if (!State.Paused) {
        P.X += (V[0] * DT * 8) / Field.Width;
        P.Z += (V[1] * DT * 8) / Field.Depth;
        P.Life -= DT * 0.15;
      }
      if (Math.abs(P.X) > 0.52 || Math.abs(P.Z) > 0.52 || P.Life < 0) {
        P.X = ((((P.X + 0.5) % 1) + 1) % 1) - 0.5;
        P.Z = ((((P.Z + 0.5) % 1) + 1) % 1) - 0.5;
        P.Life = 1.4;
      }
      const Head = Pixel([P.X * Field.Width, P.Z * Field.Depth]);
      if (Speed < 0.02) continue;
      // Trace backward through the SAME velocity field; this gives legible curved strokes
      // at low speed without inventing curl or replacing the authored field.
      const Tail = [Head];
      let TX = P.X * Field.Width,
        TZ = P.Z * Field.Depth;
      const Length = 7 + Math.min(1, Speed / 30) * 30;
      for (let I = 0; I < 5; I++) {
        const V = EvaluateWind(Field, TX, TZ, Time),
          Pixels = Math.hypot(
            (V[0] * W) / Field.Width,
            (V[1] * H) / Field.Depth,
          );
        if (Pixels < 0.001) break;
        TX -= (V[0] * Length) / (5 * Pixels);
        TZ -= (V[1] * Length) / (5 * Pixels);
        Tail.push(Pixel([TX, TZ]));
      }
      const Start = Tail.at(-1),
        Gradient = G.createLinearGradient(
          Start[0],
          Start[1],
          Head[0] + 0.01,
          Head[1] + 0.01,
        );
      Gradient.addColorStop(0, "rgba(137,224,196,0)");
      Gradient.addColorStop(
        1,
        `rgba(137,224,196,${Math.min(0.85, 0.3 + Speed / 65)})`,
      );
      G.strokeStyle = Gradient;
      G.lineWidth = 0.9 + Math.min(1.3, Speed / 25);
      G.beginPath();
      Tail.forEach((Q, I) => (I ? G.lineTo(...Q) : G.moveTo(...Q)));
      G.stroke();
    }
    if (Edit && Part) {
      if (Part.Type === "Spline") {
        G.strokeStyle = "rgba(255,255,255,.2)";
        G.lineWidth = 1;
        G.setLineDash([3, 5]);
        G.beginPath();
        Part.Path.forEach((P, I) =>
          I ? G.lineTo(...Pixel(P)) : G.moveTo(...Pixel(P)),
        );
        G.stroke();
        G.setLineDash([]);
        G.strokeStyle = "#89e0c4";
        G.lineWidth = 1.5;
        G.beginPath();
        SampleWindPath(Part.Path).forEach((P, I) =>
          I ? G.lineTo(...Pixel(P)) : G.moveTo(...Pixel(P)),
        );
        G.stroke();
        Part.Path.forEach((P) => {
          const Q = Pixel(P);
          G.fillStyle = "#101d1e";
          G.beginPath();
          G.arc(...Q, 4, 0, Math.PI * 2);
          G.fill();
          G.stroke();
        });
      }
      const [CX, CY] = Pixel([Part.X, Part.Z]),
        R = Math.min(W, H) * 0.34,
        A = (Part.Bearing * Math.PI) / 180;
      const UX = Math.sin(A),
        UY = -Math.cos(A),
        L = R * Math.min(1, Part.Strength / 30),
        HX = CX + UX * L,
        HY = CY + UY * L;
      G.strokeStyle = "rgba(255,255,255,.12)";
      G.lineWidth = 1;
      G.setLineDash([2, 4]);
      G.beginPath();
      G.arc(CX, CY, R, 0, Math.PI * 2);
      G.stroke();
      G.setLineDash([]);
      G.strokeStyle = "#fff";
      G.lineWidth = 2;
      G.beginPath();
      G.moveTo(CX, CY);
      G.lineTo(HX, HY);
      G.stroke();
      G.fillStyle = "#fff";
      G.beginPath();
      G.moveTo(HX + UX * 6, HY + UY * 6);
      G.lineTo(HX - UY * 4 - UX * 2, HY + UX * 4 - UY * 2);
      G.lineTo(HX + UY * 4 - UX * 2, HY - UX * 4 - UY * 2);
      G.closePath();
      G.fill();
      G.beginPath();
      G.arc(CX, CY, 3, 0, Math.PI * 2);
      G.fill();
      const Probe = Pixel(State.Probe || [Field.Width * 0.15, 0]);
      G.strokeStyle = "#89e0c4";
      G.lineWidth = 1;
      G.beginPath();
      G.moveTo(Probe[0] - 4, Probe[1]);
      G.lineTo(Probe[0] + 4, Probe[1]);
      G.moveTo(Probe[0], Probe[1] - 4);
      G.lineTo(Probe[0], Probe[1] + 4);
      G.stroke();
    }
    Canvas.dataset.time = Time.toFixed(3);
    Canvas.dataset.frame = String((Number(Canvas.dataset.frame) || 0) + 1);
    State.OnFrame?.(Time, DT);
    Frame = requestAnimationFrame(Paint);
  }
  Frame = requestAnimationFrame(Paint);
  return () => {
    Alive = false;
    cancelAnimationFrame(Frame);
    Canvas.removeEventListener("pointerdown", Down);
    Canvas.removeEventListener("pointermove", Move);
    Canvas.removeEventListener("pointerup", Up);
    Canvas.removeEventListener("pointercancel", Up);
    Canvas.removeEventListener("keydown", Key);
  };
}

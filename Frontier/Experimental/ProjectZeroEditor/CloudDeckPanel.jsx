import React, { useRef, useEffect } from "react";
// Adapts the ported InspectorDepot cloud-deck band to the native base/thickness range.
export default function CloudDeckPanel({ V, Change }) {
  const Canvas = useRef(null),
    Domain = useRef(400),
    DragDomain = useRef(null);
  const Base = V("Base"),
    Thickness = V("Thickness"),
    Density = Math.max(0, Math.min(1, V("Density") / 4));
  useEffect(() => {
    const Node = Canvas.current;
    const Paint = () => {
      const Width = Node.clientWidth || 260,
        Height = 176,
        Ratio = Math.min(devicePixelRatio || 1, 2);
      Node.width = Width * Ratio;
      Node.height = Height * Ratio;
      const Brush = Node.getContext("2d");
      Brush.setTransform(Ratio, 0, 0, Ratio, 0, 0);
      Domain.current =
        DragDomain.current ||
        Math.max(400, Math.ceil(((Base + Thickness) * 1.25) / 500) * 500);
      const Y = (Altitude) =>
          Height - 18 - (Altitude / Domain.current) * (Height - 48),
        Datum = Y(Base),
        Depth = (Thickness / Domain.current) * (Height - 48);
      Brush.fillStyle = "#060708";
      Brush.fillRect(0, 0, Width, Height);
      for (let X = 0; X < Width; X += 4) {
        const Top =
          Datum -
          Depth * (0.65 + 0.3 * Math.sin(X * 0.08) + 0.12 * Math.sin(X * 0.31));
        const Shade = Brush.createLinearGradient(0, Top, 0, Datum + 4);
        Shade.addColorStop(0, "rgba(238,243,248,.05)");
        Shade.addColorStop(0.35, `rgba(238,243,248,${0.75 * Density})`);
        Shade.addColorStop(1, `rgba(92,108,128,${0.72 * Density})`);
        Brush.fillStyle = Shade;
        Brush.fillRect(X, Top, 4.3, Datum - Top + 4);
      }
      Brush.font = "8px sans-serif";
      for (let Index = 0; Index <= 4; Index++) {
        const Altitude = (Domain.current * Index) / 4,
          Vertical = Y(Altitude);
        Brush.strokeStyle = "#ffffff12";
        Brush.beginPath();
        Brush.moveTo(0, Vertical);
        Brush.lineTo(Width, Vertical);
        Brush.stroke();
        Brush.fillStyle = "#8b9299";
        Brush.fillText(
          Index ? Math.round(Altitude) + " m" : "DATUM",
          6,
          Vertical - 3,
        );
      }
      Brush.setLineDash([3, 3]);
      Brush.strokeStyle = "#ffffffaa";
      Brush.beginPath();
      Brush.moveTo(0, Datum);
      Brush.lineTo(Width, Datum);
      Brush.stroke();
      Brush.setLineDash([]);
      Brush.fillStyle = "#929a9f";
      Brush.fillText("CLOUD DECK · VERTICAL SECTION", 6, 11);
    };
    const Observer = new ResizeObserver(Paint);
    Observer.observe(Node);
    Paint();
    return () => Observer.disconnect();
  }, [Base, Thickness, Density]);
  const Move = (Event) => {
    if (!Canvas.current.hasPointerCapture(Event.pointerId)) return;
    const Bounds = Canvas.current.getBoundingClientRect();
    const Altitude =
      ((Bounds.height - 18 - (Event.clientY - Bounds.top)) /
        (Bounds.height - 48)) *
      Domain.current;
    Change("Base", Math.round(Math.max(100, Math.min(12000, Altitude))));
  };
  return (
    <canvas
      ref={Canvas}
      className="cloud-deck-visual"
      role="slider"
      aria-label="Cloud deck base altitude"
      aria-valuemin={100}
      aria-valuemax={12000}
      aria-valuenow={Base}
      tabIndex={0}
      style={{
        width: "100%",
        height: 176,
        display: "block",
        borderRadius: 8,
        touchAction: "none",
        cursor: "ns-resize",
      }}
      onPointerDown={(Event) => {
        DragDomain.current = Domain.current;
        Event.currentTarget.setPointerCapture(Event.pointerId);
        Move(Event);
      }}
      onPointerMove={Move}
      onPointerUp={(Event) => {
        Event.currentTarget.releasePointerCapture(Event.pointerId);
        DragDomain.current = null;
      }}
      onPointerCancel={() => {
        DragDomain.current = null;
      }}
      onKeyDown={(Event) => {
        if (["ArrowUp", "ArrowDown"].includes(Event.key)) {
          Event.preventDefault();
          Change(
            "Base",
            Math.max(
              100,
              Math.min(12000, Base + (Event.key === "ArrowUp" ? 10 : -10)),
            ),
          );
        }
      }}
    />
  );
}

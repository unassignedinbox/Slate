// HTML authoring model: a bounded XZ slice, not a native atmospheric solver.
export const WindTypes = ["Directional", "Gust", "Tornado", "Radial", "Spline"];
const Clamp = (Value, Min, Max, Default) =>
  Number.isFinite(Number(Value))
    ? Math.max(Min, Math.min(Max, Number(Value)))
    : Default;
export function NewWindComponent(Type = "Directional") {
  return {
    Id: crypto.randomUUID(),
    Name: Type,
    Type,
    Enabled: true,
    X: 0,
    Z: 0,
    Radius: 260,
    Strength: Type === "Tornado" ? 22 : 7,
    Bearing: 90,
    Frequency: 0.3,
    Follow: 0.8,
    Spin: 1,
    Path: [
      [-300, 150],
      [-150, -280],
      [150, 280],
      [300, -150],
    ],
  };
}
export function ResolveWind(Values = {}) {
  const Saved = Values.WindField;
  const Width = Clamp(Saved?.Width, 100, 10000, 1000),
    Depth = Clamp(Saved?.Depth, 100, 10000, 1000);
  const Components = Array.isArray(Saved?.Components)
    ? Saved.Components
    : [
        {
          Id: "base",
          Name: "Prevailing wind",
          Type: "Directional",
          Enabled: true,
          Strength: Values.Speed ?? 7,
          Bearing: Values.Bearing ?? 250,
        },
        {
          Id: "gust",
          Name: "Passing gust",
          Type: "Gust",
          Enabled: true,
          Strength: (Values.Speed ?? 7) * (Values.Gust ?? 0.25),
          Radius: 450,
          Bearing: Values.Bearing ?? 250,
          Frequency: 0.3,
        },
      ];
  const Ids = new Set();
  return {
    Width,
    Depth,
    Components: Components.filter((Item) => Item && typeof Item === "object")
      .slice(0, 64)
      .map((Item, Index) => {
        let Id =
          typeof Item.Id === "string" && Item.Id
            ? Item.Id
            : `component-${Index}`;
        while (Ids.has(Id)) Id += "-copy";
        Ids.add(Id);
        return {
          Id,
          Name: String(Item.Name || Item.Type || "Wind").slice(0, 80),
          Type: WindTypes.includes(Item.Type) ? Item.Type : "Directional",
          Enabled: Item.Enabled !== false,
          X: Clamp(Item.X, -Width / 2, Width / 2, 0),
          Z: Clamp(Item.Z, -Depth / 2, Depth / 2, 0),
          Radius: Clamp(Item.Radius, 10, 10000, 260),
          Strength: Clamp(Item.Strength, 0, 100, 7),
          Bearing: Clamp(Item.Bearing, 0, 360, 90),
          Frequency: Clamp(Item.Frequency, 0, 5, 0.3),
          Follow: Clamp(Item.Follow, 0, 1, 0.8),
          Spin: Item.Spin === -1 ? -1 : 1,
          Path: Array.from({ length: 4 }, (_, I) => {
            const Default = [
              [-0.3, 0.15],
              [-0.15, -0.28],
              [0.15, 0.28],
              [0.3, -0.15],
            ][I];
            return [
              Clamp(
                Item.Path?.[I]?.[0],
                -Width / 2,
                Width / 2,
                Default[0] * Width,
              ),
              Clamp(
                Item.Path?.[I]?.[1],
                -Depth / 2,
                Depth / 2,
                Default[1] * Depth,
              ),
            ];
          }),
        };
      }),
  };
}
// Linear superposition of every enabled component, in metres/second.
export function EvaluateWind(Field, X, Z, Time = 0) {
  let VX = 0,
    VZ = 0;
  for (const Part of Field.Components) {
    if (!Part.Enabled || !Part.Strength) continue;
    const DX = X - Part.X,
      DZ = Z - Part.Z,
      Distance = Math.hypot(DX, DZ),
      Radius = Distance / Part.Radius;
    const Falloff = Math.max(0, 1 - Radius * Radius) ** 2;
    const Angle = (Part.Bearing * Math.PI) / 180;
    if (Part.Type === "Spline") {
      const Samples = SampleWindPath(Part.Path);
      let Closest = Infinity,
        TX = 0,
        TZ = -1,
        NX = 0,
        NZ = 0;
      for (let I = 1; I < Samples.length; I++) {
        const A = Samples[I - 1],
          B = Samples[I],
          DX = B[0] - A[0],
          DZ = B[1] - A[1];
        const Length = Math.hypot(DX, DZ);
        if (Length < 1e-8) continue;
        const T = Math.max(
          0,
          Math.min(1, ((X - A[0]) * DX + (Z - A[1]) * DZ) / (Length * Length)),
        );
        const PX = A[0] + T * DX - X,
          PZ = A[1] + T * DZ - Z,
          D = Math.hypot(PX, PZ);
        if (D < Closest) {
          Closest = D;
          TX = DX / Length;
          TZ = DZ / Length;
          NX = PX;
          NZ = PZ;
        }
      }
      if (!Number.isFinite(Closest)) continue;
      // Cross-track correction only: do not pull flow backwards at a path endpoint.
      const Along = NX * TX + NZ * TZ;
      NX -= Along * TX;
      NZ -= Along * TZ;
      const Follow = Part.Follow,
        Radius = Math.max(10, Part.Radius);
      const GX = TX + (2 * NX) / Radius,
        GZ = TZ + (2 * NZ) / Radius,
        GL = Math.hypot(GX, GZ) || 1;
      const XDirection = (1 - Follow) * Math.sin(Angle) + (Follow * GX) / GL;
      const ZDirection = -(1 - Follow) * Math.cos(Angle) + (Follow * GZ) / GL;
      const Amount =
        Part.Strength * Math.max(0, 1 - (Closest / Radius) ** 2) ** 2;
      VX += XDirection * Amount;
      VZ += ZDirection * Amount;
    } else if (Part.Type === "Directional" || Part.Type === "Gust") {
      const Amount =
        Part.Strength *
        (Part.Type === "Gust"
          ? Falloff *
            (0.65 + 0.35 * Math.sin(Time * 2 * Math.PI * Part.Frequency))
          : 1);
      VX += Math.sin(Angle) * Amount;
      VZ -= Math.cos(Angle) * Amount;
    } else if (Distance > 1e-6) {
      const Amount = Part.Strength * Falloff * Math.min(1, Radius * 3);
      if (Part.Type === "Tornado") {
        VX += ((-DZ * (Part.Spin ?? 1) - 0.18 * DX) / Distance) * Amount;
        VZ += ((DX * (Part.Spin ?? 1) - 0.18 * DZ) / Distance) * Amount;
      } else {
        VX += (DX / Distance) * Amount;
        VZ += (DZ / Distance) * Amount;
      }
    }
  }
  return [VX, VZ];
}

// Cubic Bezier samples shared by drawing and the closest-segment velocity query.
// Authoring updates replace Path arrays; cached coordinates are immutable.
const PathSamples = new WeakMap();
export function SampleWindPath(Path) {
  if (!Array.isArray(Path) || Path.length !== 4) return [];
  if (PathSamples.has(Path)) return PathSamples.get(Path);
  const Samples = Array.from({ length: 49 }, (_, I) => {
    const T = I / 48,
      U = 1 - T;
    return [0, 1].map(
      (A) =>
        U ** 3 * Path[0][A] +
        3 * U * U * T * Path[1][A] +
        3 * U * T * T * Path[2][A] +
        T ** 3 * Path[3][A],
    );
  });
  PathSamples.set(Path, Samples);
  return Samples;
}
// Migrate only fields that have never had the old composite editor authored.
export function ResolveInspectorWind(Values = {}, Properties = {}) {
  if (Values.WindField) return ResolveWind(Values);
  if (Properties.field) return ResolveWind({ WindField: Properties.field });
  return ResolveWind({
    WindField: {
      Width: 1000,
      Depth: 1000,
      Components: [
        {
          Id: "flow",
          Name: "Wind flow",
          Type: "Directional",
          Enabled: true,
          Strength: Values.Speed ?? Properties.speed ?? 4.2,
          Bearing:
            Values.Bearing ?? ((Properties.direction ?? 214) + 180) % 360,
        },
      ],
    },
  });
}

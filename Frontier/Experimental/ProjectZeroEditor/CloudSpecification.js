import Native from "./NativePanels.json";
export const CloudProperties = {
  Coverage: "coverage",
  Base: "altitude",
  Density: "density",
};
export function CloudValue(Values, Name) {
  if (Values[Name] !== undefined) return Values[Name];
  const Imported =
    Values.ReferenceInspector?.Properties?.[CloudProperties[Name]];
  if (Imported !== undefined)
    return Name === "Density" ? Imported * 4 : Imported;
  return Native.Panels.clouds.find((Field) => Field.Label === Name)?.Default;
}
export function CloudReference(Values) {
  return Object.fromEntries(
    Object.entries(CloudProperties).map(([Name, Key]) => [
      Key,
      CloudValue(Values, Name) / (Name === "Density" ? 4 : 1),
    ]),
  );
}

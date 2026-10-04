export const EditorCamera = {
  Id: "camera",
  Name: "Editor Camera",
  Panel: "camera",
  Icon: "camera",
  Parent: "cameras",
  Description: "Permanent editor navigation camera · not a scene render camera",
};
export const IsEditorCamera = (Row) => Row?.Id === EditorCamera.Id;
// Normalize every scene load and structural edit, not just the remove menu.
// The original reserved camera ID keeps existing optics/property drafts.
export function EnsureEditorCamera(Rows = []) {
  const Source = (Array.isArray(Rows) ? Rows : []).filter(
    (Row) => Row && typeof Row === "object",
  );
  const Group = Source.find((Row) => Row.Id === "cameras");
  const Result = Source.filter(
    (Row) => Row.Id !== "camera" && Row.Id !== "cameras",
  );
  const First = Result.findIndex((Row) => Row.Panel === "camera"),
    Previous = Source.findIndex((Row) => Row.Id === "cameras");
  const Index = Math.min(
    First < 0 ? Result.length : First,
    Previous < 0 ? 0 : Previous,
  );
  Result.splice(
    Index,
    0,
    {
      ...Group,
      Id: "cameras",
      Name: Group?.Name || "Cameras",
      Panel: "group",
      Icon: "camera",
      Parent: null,
      Description: "Editor and scene cameras",
    },
    { ...EditorCamera },
  );
  return Result;
}

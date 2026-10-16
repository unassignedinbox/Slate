//============================================================================================================================================
//                                                        VEHICLECONFIGURATOR.JS
//============================================================================================================================================
// 🧩 Material options shared by the TabletPanel Garage and the live ControlVehicle renderer.

import { CourseMaterial } from "../MaterialSpecification.js";

export const ExteriorPaints = Object.freeze([
    { Id: "silver", Name: "Nebula Silver", Hex: "#c2c8d0", Metallic: true },
    { Id: "black",  Name: "Obsidian Black", Hex: "#17191d", Metallic: true },
    { Id: "red",    Name: "Command Red", Hex: "#8a1a1d", Metallic: true },
    { Id: "blue",   Name: "Tactical Blue", Hex: "#1c3f73", Metallic: true },
    { Id: "sand",   Name: "Moab Sand", Hex: "#b2946a", Metallic: false },
    { Id: "green",  Name: "Recon Green", Hex: "#33442f", Metallic: false },
    { Id: "white",  Name: "Arctic White", Hex: "#e7ebef", Metallic: true },
    { Id: "copper", Name: "Copper Bronze", Hex: "#8c5a2e", Metallic: true }
]);

export const WheelFinishes = Object.freeze([
    { Id: "trail",    Name: "Trail Beadlock", Size: '22"', Spokes: 6, Rim: "#2b2e33", Metalness: 0.70, Roughness: 0.45 },
    { Id: "sport",    Name: "Machined Sport", Size: '24"', Spokes: 5, Rim: "#c9ced4", Metalness: 0.95, Roughness: 0.18 },
    { Id: "blackout", Name: "Blackout Mesh", Size: '22"', Spokes: 10, Rim: "#0e0f11", Metalness: 0.70, Roughness: 0.38 },
    { Id: "bronze",   Name: "Bronze Forged", Size: '24"', Spokes: 7, Rim: "#9a6a2f", Metalness: 0.88, Roughness: 0.28 }
]);

export const VehicleAppearanceDefaults = Object.freeze({
    PaintId: "silver",
    Finish: "gloss",
    WheelId: "trail",
    ViewMode: "solid",       // "solid" | "ghost" | "wireframe" — the Garage preview only
    Transparency: 0.0          // [0, 0.8], used by the see-through / hologram preview
});

export function NormalizeVehicleAppearance(Appearance = {})
{
    const Candidate = { ...VehicleAppearanceDefaults, ...Appearance };
    if (!ExteriorPaints.some((Paint) => Paint.Id === Candidate.PaintId))
        Candidate.PaintId = VehicleAppearanceDefaults.PaintId;
    if (!WheelFinishes.some((Wheel) => Wheel.Id === Candidate.WheelId))
        Candidate.WheelId = VehicleAppearanceDefaults.WheelId;
    if (Candidate.Finish !== "matte")
        Candidate.Finish = "gloss";
    if (!["solid", "ghost", "wireframe"].includes(Candidate.ViewMode))
        Candidate.ViewMode = "solid";
    Candidate.Transparency = Math.max(0.0, Math.min(0.8, Number(Candidate.Transparency) || 0.0));
    return Candidate;
}

export function ResolvePaint(Id)
{
    return ExteriorPaints.find((Paint) => Paint.Id === Id) || ExteriorPaints[0];
}

export function ResolveWheelFinish(Id)
{
    return WheelFinishes.find((Wheel) => Wheel.Id === Id) || WheelFinishes[0];
}

export function ResolveLinearRgb(Hex)
{
    const Match = /^#?([0-9a-f]{6})$/i.exec(Hex);
    if (!Match)
        return [0.75, 0.75, 0.75];
    const Components = [0, 2, 4].map((Offset) => parseInt(Match[1].slice(Offset, Offset + 2), 16) / 255.0);
    return Components.map((Channel) => Channel <= 0.04045 ? Channel / 12.92 : Math.pow((Channel + 0.055) / 1.055, 2.4));
}

// 📝 Mutates the two material records that the real vehicle's facets reference. The caller uploads those records and
//    recaptures the car's surface cards, so the body colour changes in the driving view, the Garage preview and GI.
export function ApplyVehicleAppearanceMaterials(Materials, Appearance)
{
    const Selection = NormalizeVehicleAppearance(Appearance);
    const Paint = ResolvePaint(Selection.PaintId);
    const Body = Materials[CourseMaterial.BodyCoat];
    Body.Albedo = ResolveLinearRgb(Paint.Hex);
    Body.Metalness = Paint.Metallic ? 0.90 : 0.35;
    Body.Roughness = Selection.Finish === "matte" ? 0.72 : (Paint.Metallic ? 0.26 : 0.45);
    Body.CoatWeight = Selection.Finish === "matte" ? 0.10 : 1.0;
    Body.CoatRoughness = Selection.Finish === "matte" ? 0.65 : 0.12;
    Body.Emission = [0.0, 0.0, 0.0];
    Body.Transmission = 0.0;

    const Wheel = ResolveWheelFinish(Selection.WheelId);
    const Rim = Materials[CourseMaterial.Hub];
    Rim.Albedo = ResolveLinearRgb(Wheel.Rim);
    Rim.Metalness = Wheel.Metalness;
    Rim.Roughness = Wheel.Roughness;
    Rim.Emission = [0.0, 0.0, 0.0];
    Rim.CoatWeight = 0.0;
    Rim.CoatRoughness = 0.0;

    return Selection;
}

//============================================================================================================================================
//                                                        CABINDISPLAYSEQUENCE.JS
//============================================================================================================================================
// 🧩 The cabin HMI rasterised on 2D canvases: the driver's cluster and the centre-stack tablet, from the TabletPanel prototype.
//
// 📝 The accepted HTML prototype (Experimental/TabletPanel on the Project-Drive branches) is the source of truth: its
//    twelve launcher applications with their names and colours, and its four cluster outlines — hexagon, 70 % circle,
//    trapezoid, pill — each rastered at its own physical aspect so the gauges are never squashed. The C++ port drives
//    its sheets by touch; a tap from the chase camera was unusable (one pixel of mouse jitter was several sheet
//    pixels), so the exhibit drives its screens from the workspace instead: the Cabin inspector page and the number
//    keys switch the tablet tab, and the canvases re-raster live from the vehicle telemetry.
//
// 📝 Canvases upload by queue.writeTexture, whose bytesPerRow wants a multiple of 256 — every extent below keeps
//    width × 4 there (640 · 4 = 2560, 512 · 4 = 2048, 704 · 4 = 2816).

import { ResolveClusterOutline } from "./CabinStructure.js";

// 📝 AppSpecification.js, names and colours verbatim.
export const TabletApplications = Object.freeze([
    { Identifier: "vehicle",    Name: "Vehicle",    Caption: "Make it your own",        Colour: "#a4e5be" },
    { Identifier: "drive-room", Name: "Drive Room", Caption: "Your people. Your race.", Colour: "#ffcf87" },
    { Identifier: "messages",   Name: "Messages",   Caption: "Keep the conversation going", Colour: "#94caff" },
    { Identifier: "contacts",   Name: "Contacts",   Caption: "People worth driving with", Colour: "#f4b19b" },
    { Identifier: "navigation", Name: "Navigation", Caption: "Find your next road",      Colour: "#8fe0d0" },
    { Identifier: "media",      Name: "Media",      Caption: "Set the pace",             Colour: "#efa5d7" },
    { Identifier: "tyres",      Name: "Tyres",      Caption: "Every corner counts",      Colour: "#aad9e9" },
    { Identifier: "telemetry",  Name: "Telemetry",  Caption: "Know your machine",        Colour: "#cbb2ef" },
    { Identifier: "climate",    Name: "Climate",    Caption: "Your comfort zone",        Colour: "#a2dbe7" },
    { Identifier: "garage",     Name: "Garage",     Caption: "A place for your car",     Colour: "#e5bf95" },
    { Identifier: "account",    Name: "Account",    Caption: "Always your space",        Colour: "#b9b4f6" },
    { Identifier: "settings",   Name: "Settings",   Caption: "The little things",        Colour: "#c5cfd2" }
]);

export const TabletCanvasExtent = Object.freeze([640, 424]);

// 📝 ClusterSequence.js: the raster shares the housing's proportions — a square 70 % circle gets a square raster.
export function ResolveClusterCanvasExtent(Identifier)
{
    switch (Identifier)
    {
        case "arc":       return [512, 512];
        case "trapezoid": return [640, 320];
        case "pill":      return [704, 256];
        default:          return [640, 368];
    }
}

const Theme = Object.freeze({
    Screen: "#0b0e12", Bezel: "#14181d", BezelEdge: "#232a31", Text: "#e8eef4", Dim: "#8a94a0", Faint: "#4a525b",
    Cyan: "#59d6ff", Amber: "#ffb454", Red: "#ff5348", Green: "#51e08c", Violet: "#cbb2ef", Track: "#1c2229"
});

function TraceRoundRect(Context, X, Y, Width, Height, Radius)
{
    Context.beginPath();
    Context.moveTo(X + Radius, Y);
    Context.arcTo(X + Width, Y, X + Width, Y + Height, Radius);
    Context.arcTo(X + Width, Y + Height, X, Y + Height, Radius);
    Context.arcTo(X, Y + Height, X, Y, Radius);
    Context.arcTo(X, Y, X + Width, Y, Radius);
    Context.closePath();
}

export class CabinDisplaySequence
{
    constructor()
    {
        this.ClusterCanvas = document.createElement("canvas");
        this.TabletCanvas = document.createElement("canvas");
        this.TabletCanvas.width = TabletCanvasExtent[0];
        this.TabletCanvas.height = TabletCanvasExtent[1];
        this.ClusterOutline = "hexagon";
        this.TabletTab = "telemetry";
        this.ClimateSetpoint = 21.5;
        this.MediaTrack = 1;
        this.ClusterRevision = 0;
        this.TabletRevision = 0;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  CLUSTER
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Speed, revs, gear and the tyre corners against the chosen outline; warnings across the top. Telemetry is
    //    VehicleSolver.QueryTelemetry() with SteerAngle [rad] and Brake [-] appended.
    RasterCluster(Telemetry, OutlineIdentifier)
    {
        if (OutlineIdentifier !== this.ClusterOutline)
            this.ClusterOutline = OutlineIdentifier;
        const [Width, Height] = ResolveClusterCanvasExtent(this.ClusterOutline);
        const Canvas = this.ClusterCanvas;
        if (Canvas.width !== Width || Canvas.height !== Height)
        {
            Canvas.width = Width;
            Canvas.height = Height;
        }
        const Context = Canvas.getContext("2d");
        const Outline = ResolveClusterOutline(this.ClusterOutline);
        const Margin = Math.round(Math.min(Width, Height) * 0.035);
        const Project = ([PX, PY]) => [Width / 2 + PX * (Width / 2 - Margin), Height / 2 - PY * (Height / 2 - Margin)];

        Context.clearRect(0, 0, Width, Height);
        Context.save();
        Context.beginPath();
        Outline.Points.forEach(([PX, PY], Index) =>
        {
            const [X, Y] = Project([PX, PY]);
            if (Index === 0) Context.moveTo(X, Y); else Context.lineTo(X, Y);
        });
        Context.closePath();
        Context.fillStyle = Theme.Bezel;
        Context.fill();
        Context.clip();

        const Screen = 1.0 - 2.2 * Margin / Math.min(Width, Height);
        const Centre = [Width / 2, Height / 2];
        const SpanX = (Width / 2 - Margin) * Screen, SpanY = (Height / 2 - Margin) * Screen;
        Context.fillStyle = Theme.Screen;
        Context.fillRect(Centre[0] - SpanX, Centre[1] - SpanY, SpanX * 2, SpanY * 2);

        const Speed = Math.abs(Telemetry.Speed) * 3.6;
        const Redline = 6800.0;
        const Revs = Math.min(Telemetry.EngineRPM, Redline + 800.0);
        const Hot = Revs > Redline;

        // ① rev arc across the top of the glass
        const ArcY = Centre[1] - SpanY * 0.62, ArcW = SpanX * 1.5, ArcH = Math.max(10, Height * 0.035);
        Context.fillStyle = Theme.Track;
        TraceRoundRect(Context, Centre[0] - ArcW / 2, ArcY, ArcW, ArcH, ArcH / 2);
        Context.fill();
        const Share = Math.max(0.0, Math.min(1.0, Revs / (Redline + 800.0)));
        const RedShare = Math.max(0.0, Math.min(1.0, (Revs - Redline) / 800.0));
        Context.fillStyle = Hot ? Theme.Red : Theme.Cyan;
        if (Share > 0.01)
        {
            TraceRoundRect(Context, Centre[0] - ArcW / 2, ArcY, ArcW * Share, ArcH, ArcH / 2);
            Context.fill();
        }
        Context.fillStyle = Theme.Red;
        Context.fillRect(Centre[0] + ArcW * (Redline / (Redline + 800.0)) - ArcW / 2, ArcY, 2, ArcH);
        Context.fillStyle = RedShare > 0 ? Theme.Red : Theme.Dim;
        Context.font = `600 ${Math.round(Height * 0.055)}px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "center";
        Context.fillText(`${(Telemetry.EngineRPM).toFixed(0)} rpm`, Centre[0], ArcY - Height * 0.03);

        // ② speed and gear, the centre of the glass
        Context.fillStyle = Theme.Text;
        Context.font = `600 ${Math.round(Height * 0.30)}px "DM Sans", system-ui, sans-serif`;
        Context.fillText(Speed.toFixed(0), Centre[0] - SpanX * 0.18, Centre[1] + SpanY * 0.28);
        Context.fillStyle = Theme.Dim;
        Context.font = `500 ${Math.round(Height * 0.07)}px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText("km/h", Centre[0] + SpanX * 0.42, Centre[1] + SpanY * 0.28);
        Context.fillStyle = Theme.Violet;
        Context.font = `600 ${Math.round(Height * 0.20)}px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "center";
        Context.fillText(Telemetry.Gear, Centre[0] + SpanX * 0.62, Centre[1] + SpanY * 0.22);

        // ③ pedals and boost under the speed
        const PedalY = Centre[1] + SpanY * 0.52, PedalW = SpanX * 0.9, PedalH = Math.max(6, Height * 0.022);
        this.TracePedal(Context, Centre[0] - SpanX * 0.62, PedalY, PedalW, PedalH, Telemetry.Throttle, Theme.Green, "THR");
        this.TracePedal(Context, Centre[0] - SpanX * 0.62, PedalY + PedalH * 1.9, PedalW, PedalH, Telemetry.Brake, Theme.Red, "BRK");

        // ④ tyre corners along the bottom: pressure, heat, state
        const Corners = ["FL", "FR", "RL", "RR"];
        const CornerW = SpanX * 1.72 / 4;
        Corners.forEach((Corner, Index) =>
        {
            const X = Centre[0] - SpanX * 0.86 + CornerW * (Index + 0.5);
            const Y = Centre[1] + SpanY * 0.86;
            const State = Telemetry.Shredded[Index] ? "SHRED" : Telemetry.Bursts[Index] ? "BURST"
                        : Telemetry.Ignited[Index] ? "FIRE" : Telemetry.Leaking[Index] ? "LEAK" : "OK";
            Context.fillStyle = State === "OK" ? Theme.Green : State === "LEAK" ? Theme.Amber : Theme.Red;
            Context.font = `600 ${Math.round(Height * 0.052)}px "DM Sans", system-ui, sans-serif`;
            Context.fillText(`${Corner} ${(Telemetry.Pressures[Index]).toFixed(0)}`, X, Y);
            Context.fillStyle = Theme.Dim;
            Context.font = `500 ${Math.round(Height * 0.045)}px "DM Sans", system-ui, sans-serif`;
            Context.fillText(`${Telemetry.TyreTemperatures[Index].toFixed(0)}° ${State}`, X, Y + Height * 0.065);
        });

        // ⑤ warnings strip
        const Warnings = [];
        if (Telemetry.Bursts.some((Burst) => Burst)) Warnings.push(["TYRE BURST", Theme.Red]);
        else if (Telemetry.Shredded.some((Shred) => Shred)) Warnings.push(["RIM RUNNING", Theme.Red]);
        else if (Telemetry.Leaking.some((Leak) => Leak)) Warnings.push(["PRESSURE LOSS", Theme.Amber]);
        if (Telemetry.TyresBurning > 0) Warnings.push(["TYRE FIRE", Theme.Red]);
        if (Telemetry.LineLock) Warnings.push(["LINE LOCK", Theme.Cyan]);
        Context.font = `600 ${Math.round(Height * 0.055)}px "DM Sans", system-ui, sans-serif`;
        Warnings.forEach(([Text, Colour], Index) =>
        {
            Context.fillStyle = Colour;
            Context.fillText(Text, Centre[0], Centre[1] - SpanY * 0.88 + Index * Height * 0.075);
        });

        Context.restore();
        this.ClusterRevision++;
        return Canvas;
    }

    TracePedal(Context, X, Y, Width, Height, Share, Colour, Label)
    {
        Context.fillStyle = Theme.Track;
        TraceRoundRect(Context, X, Y, Width, Height, Height / 2);
        Context.fill();
        Context.fillStyle = Colour;
        if (Share > 0.02)
        {
            TraceRoundRect(Context, X, Y, Width * Math.min(1.0, Share), Height, Height / 2);
            Context.fill();
        }
        Context.fillStyle = Theme.Dim;
        Context.font = `600 ${Math.round(Height * 1.4)}px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText(Label, X + Width + 6, Y + Height);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  TABLET
    //--------------------------------------------------------------------------------------------------------------------

    RasterTablet(Telemetry)
    {
        const [Width, Height] = TabletCanvasExtent;
        const Canvas = this.TabletCanvas;
        const Context = Canvas.getContext("2d");
        Context.fillStyle = Theme.Bezel;
        Context.fillRect(0, 0, Width, Height);
        Context.fillStyle = Theme.Screen;
        Context.fillRect(4, 4, Width - 8, Height - 8);

        // status bar: speed, gear, warnings
        Context.fillStyle = Theme.Text;
        Context.font = `600 20px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText(`${(Math.abs(Telemetry.Speed) * 3.6).toFixed(0)} km/h · ${Telemetry.Gear}`, 18, 30);
        Context.textAlign = "right";
        const Alarm = Telemetry.Bursts.some((Burst) => Burst) || Telemetry.Shredded.some((Shred) => Shred) ? ["CHECK TYRES", Theme.Red]
                    : Telemetry.Leaking.some((Leak) => Leak) ? ["LOW PRESSURE", Theme.Amber]
                    : Telemetry.TyresBurning > 0 ? ["TYRE FIRE", Theme.Red] : ["READY", Theme.Green];
        Context.fillStyle = Alarm[1];
        Context.fillText(Alarm[0], Width - 18, 30);
        Context.fillStyle = Theme.Faint;
        Context.fillRect(18, 42, Width - 36, 1);

        // launcher rail: the twelve applications, the open one lit
        const RailY = 58, CellW = (Width - 36) / 6, CellH = 44;
        TabletApplications.forEach((Application, Index) =>
        {
            const Column = Index % 6, Row = Math.floor(Index / 6);
            const X = 18 + Column * CellW, Y = RailY + Row * CellH;
            const Open = Application.Identifier === this.TabletTab;
            Context.fillStyle = Open ? "#222b33" : "transparent";
            TraceRoundRect(Context, X + 1, Y + 1, CellW - 2, CellH - 4, 8);
            if (Open) Context.fill();
            Context.fillStyle = Application.Colour;
            Context.beginPath();
            Context.arc(X + 16, Y + CellH / 2 - 1, 7, 0, Math.PI * 2);
            Context.fill();
            Context.fillStyle = Open ? Theme.Text : Theme.Dim;
            Context.font = `${Open ? 600 : 500} 12px "DM Sans", system-ui, sans-serif`;
            Context.textAlign = "left";
            Context.fillText(Application.Name, X + 28, Y + CellH / 2 + 3);
        });

        const PageY = RailY + 2 * CellH + 10;
        Context.save();
        Context.beginPath();
        Context.rect(18, PageY, Width - 36, Height - PageY - 14);
        Context.clip();
        this.RasterTabletPage(Context, 18, PageY, Width - 36, Height - PageY - 14, Telemetry);
        Context.restore();
        this.TabletRevision++;
        return Canvas;
    }

    RasterTabletPage(Context, X, Y, Width, Height, Telemetry)
    {
        const Application = TabletApplications.find((Candidate) => Candidate.Identifier === this.TabletTab)
                         || TabletApplications[7];
        Context.fillStyle = Theme.Text;
        Context.font = `600 19px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText(Application.Name, X, Y + 20);
        Context.fillStyle = Theme.Dim;
        Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
        Context.fillText(Application.Caption, X, Y + 38);
        const BodyY = Y + 52;
        switch (Application.Identifier)
        {
            case "tyres":      return this.RasterTyrePage(Context, X, BodyY, Width, Telemetry);
            case "telemetry":  return this.RasterTelemetryPage(Context, X, BodyY, Width, Telemetry);
            case "vehicle":    return this.RasterVehiclePage(Context, X, BodyY, Width, Telemetry);
            case "climate":    return this.RasterClimatePage(Context, X, BodyY, Width);
            case "media":      return this.RasterMediaPage(Context, X, BodyY, Width);
            case "garage":     return this.RasterGaragePage(Context, X, BodyY, Width, Telemetry);
            case "settings":   return this.RasterSettingsPage(Context, X, BodyY, Width);
            default:           return this.RasterPlaceholderPage(Context, X, BodyY, Width, Application);
        }
    }

    RasterTyrePage(Context, X, Y, Width, Telemetry)
    {
        const Corners = ["Front left", "Front right", "Rear left", "Rear right"];
        const CellW = Width / 4;
        Corners.forEach((Corner, Index) =>
        {
            const CX = X + CellW * Index + 6;
            const State = Telemetry.Shredded[Index] ? "SHREDDED" : Telemetry.Bursts[Index] ? "BURST"
                        : Telemetry.Ignited[Index] ? "BURNING" : Telemetry.Leaking[Index] ? "LEAKING" : "SEALED";
            Context.fillStyle = Theme.Dim;
            Context.font = `500 11px "DM Sans", system-ui, sans-serif`;
            Context.textAlign = "left";
            Context.fillText(Corner.toUpperCase(), CX, Y + 12);
            Context.fillStyle = State === "SEALED" ? Theme.Text : Theme.Red;
            Context.font = `600 26px "DM Sans", system-ui, sans-serif`;
            Context.fillText(`${Telemetry.Pressures[Index].toFixed(0)}`, CX, Y + 42);
            Context.fillStyle = Theme.Dim;
            Context.font = `500 11px "DM Sans", system-ui, sans-serif`;
            Context.fillText("kPa gauge", CX + 62, Y + 42);
            this.TraceBar(Context, CX, Y + 50, CellW - 24, 8, Telemetry.Pressures[Index] / 300.0, Theme.Cyan);
            Context.fillStyle = Theme.Text;
            Context.font = `500 13px "DM Sans", system-ui, sans-serif`;
            Context.fillText(`${Telemetry.TyreTemperatures[Index].toFixed(0)}°C · ${(Telemetry.TreadFractions[Index] * 100).toFixed(0)}% tread`,
                             CX, Y + 78);
            Context.fillStyle = State === "SEALED" ? Theme.Green : State === "LEAKING" ? Theme.Amber : Theme.Red;
            Context.font = `600 12px "DM Sans", system-ui, sans-serif`;
            Context.fillText(State, CX, Y + 96);
        });
        Context.fillStyle = Theme.Faint;
        Context.font = `500 11px "DM Sans", system-ui, sans-serif`;
        Context.fillText("Cold pressures and fresh rubber live on the Cabin inspector page.", X, Y + 122);
    }

    RasterTelemetryPage(Context, X, Y, Width, Telemetry)
    {
        const Rows = [
            ["Speed", `${(Math.abs(Telemetry.Speed) * 3.6).toFixed(0)} km/h`],
            ["Engine", `${Telemetry.EngineRPM.toFixed(0)} rpm · gear ${Telemetry.Gear}`],
            ["Boost", `${(Telemetry.Boost * 1000.0).toFixed(0)} mbar`],
            ["Throttle · brake · steer", `${(Telemetry.Throttle * 100).toFixed(0)}% · ${(Telemetry.Brake * 100).toFixed(0)}% · ${(Telemetry.SteerAngle * 57.3).toFixed(1)}°`],
            ["Sliding power", Telemetry.SlidingPower.map((Watts) => (Watts / 1000).toFixed(1)).join(" · ") + " kW"],
            ["Contacts", `${Telemetry.Contacts} / 4 wheels on the road`]
        ];
        Rows.forEach(([Label, Value], Index) =>
        {
            const RY = Y + Index * 26;
            Context.fillStyle = Theme.Dim;
            Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
            Context.textAlign = "left";
            Context.fillText(Label, X, RY + 12);
            Context.fillStyle = Theme.Text;
            Context.textAlign = "right";
            Context.fillText(Value, X + Width, RY + 12);
        });
    }

    RasterVehiclePage(Context, X, Y, Width, Telemetry)
    {
        Context.fillStyle = Theme.Text;
        Context.font = `600 15px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText("ControlVehicle · GT coupé", X, Y + 14);
        const Rows = [["Mass", "1300 kg with driver and fuel"], ["Powertrain", "twin-turbo V6 · 6-speed AMT"],
                      ["Tyres", "MF6.1 · flexible-ring carcass"], ["Driven", `${(Math.abs(Telemetry.Speed) * 3.6).toFixed(0)} km/h · ${Telemetry.Gear}`]];
        Rows.forEach(([Label, Value], Index) =>
        {
            const RY = Y + 34 + Index * 24;
            Context.fillStyle = Theme.Dim;
            Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
            Context.fillText(Label, X, RY + 12);
            Context.fillStyle = Theme.Text;
            Context.textAlign = "right";
            Context.fillText(Value, X + Width, RY + 12);
            Context.textAlign = "left";
        });
    }

    RasterClimatePage(Context, X, Y, Width)
    {
        Context.fillStyle = Theme.Text;
        Context.font = `600 44px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText(`${this.ClimateSetpoint.toFixed(1)}°`, X, Y + 48);
        Context.fillStyle = Theme.Dim;
        Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
        Context.fillText("Setpoint · SYNC · − / + on the Cabin inspector page", X, Y + 70);
        for (let Bar = 0; Bar < 8; ++Bar)
        {
            Context.fillStyle = Bar < 5 ? Theme.Cyan : Theme.Track;
            Context.fillRect(X + Bar * 26, Y + 84, 20, 8);
        }
    }

    RasterMediaPage(Context, X, Y, Width)
    {
        const Tracks = ["Night Drive — Vector Hold", "Limiter — Redline Club", "Apex Theory — Mono Youth", "Idle Air — Cassette Coast"];
        Tracks.forEach((Track, Index) =>
        {
            const RY = Y + Index * 26;
            const Playing = Index === this.MediaTrack % Tracks.length;
            Context.fillStyle = Playing ? Theme.Violet : Theme.Dim;
            Context.font = `${Playing ? 600 : 500} 13px "DM Sans", system-ui, sans-serif`;
            Context.textAlign = "left";
            Context.fillText(`${Playing ? "▶ " : "·  "}${Track}`, X, RY + 14);
        });
        Context.fillStyle = Theme.Faint;
        Context.font = `500 11px "DM Sans", system-ui, sans-serif`;
        Context.fillText("Next track on the Cabin inspector page.", X, Y + 118);
    }

    RasterGaragePage(Context, X, Y, Width, Telemetry)
    {
        Context.fillStyle = Theme.Text;
        Context.font = `600 15px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText("Tyre bay", X, Y + 14);
        const Rows = [["Front cold pressure", `${Telemetry.Pressures[0].toFixed(0)} / ${Telemetry.Pressures[1].toFixed(0)} kPa`],
                      ["Rear cold pressure", `${Telemetry.Pressures[2].toFixed(0)} / ${Telemetry.Pressures[3].toFixed(0)} kPa`],
                      ["Tread remaining", Telemetry.TreadFractions.map((Fraction) => `${(Fraction * 100).toFixed(0)}%`).join(" · ")]];
        Rows.forEach(([Label, Value], Index) =>
        {
            const RY = Y + 34 + Index * 24;
            Context.fillStyle = Theme.Dim;
            Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
            Context.fillText(Label, X, RY + 12);
            Context.fillStyle = Theme.Text;
            Context.textAlign = "right";
            Context.fillText(Value, X + Width, RY + 12);
            Context.textAlign = "left";
        });
        Context.fillStyle = Theme.Faint;
        Context.font = `500 11px "DM Sans", system-ui, sans-serif`;
        Context.fillText("Inflate and fresh tyres on the Cabin inspector page.", X, Y + 112);
    }

    RasterSettingsPage(Context, X, Y, Width)
    {
        Context.fillStyle = Theme.Dim;
        Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        const Rows = ["Screens and brightness", "Cabin camera", "Cluster outline", "Tyre deformation",
                      "Sparks", "Smoke & fire", "Line lock latch"];
        Rows.forEach((Row, Index) => Context.fillText(`·  ${Row}`, X, Y + 16 + Index * 22));
        Context.fillStyle = Theme.Faint;
        Context.font = `500 11px "DM Sans", system-ui, sans-serif`;
        Context.fillText("Every setting lives on the Cabin inspector page — the glass only reports.", X, Y + 16 + Rows.length * 22);
    }

    RasterPlaceholderPage(Context, X, Y, Width, Application)
    {
        Context.fillStyle = Application.Colour;
        Context.beginPath();
        Context.arc(X + 16, Y + 14, 9, 0, Math.PI * 2);
        Context.fill();
        Context.fillStyle = Theme.Text;
        Context.font = `600 15px "DM Sans", system-ui, sans-serif`;
        Context.textAlign = "left";
        Context.fillText(Application.Name, X + 32, Y + 19);
        Context.fillStyle = Theme.Dim;
        Context.font = `500 12px "DM Sans", system-ui, sans-serif`;
        Context.fillText("Not fitted in this build — the launcher keeps its place.", X, Y + 42);
    }

    TraceBar(Context, X, Y, Width, Height, Share, Colour)
    {
        Context.fillStyle = Theme.Track;
        TraceRoundRect(Context, X, Y, Width, Height, Height / 2);
        Context.fill();
        Context.fillStyle = Colour;
        if (Share > 0.02)
        {
            TraceRoundRect(Context, X, Y, Width * Math.min(1.0, Math.max(0.0, Share)), Height, Height / 2);
            Context.fill();
        }
    }
}

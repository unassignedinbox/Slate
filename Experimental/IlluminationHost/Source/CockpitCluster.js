//============================================================================================================================================
//                                                         COCKPITCLUSTER.JS
//============================================================================================================================================
// 🧩 The instrument cluster behind the steering wheel: a DOM overlay placed on the projected hub each frame while a cockpit
//    view is active. It reads the vehicle's telemetry, so it shows what the solver computed, not a separate model.

import { EngineSheet } from "./VehicleSpecification.js";

const SpeedScaleKph = 200.0;                       // [km/h] full sweep of the speed ring
const ShiftLights = 12;                            // [-] LEDs along the top of the cluster
const ShiftStart = 0.55 * EngineSheet.RedlineRPM;  // [rpm] first LED lights here
const TyreLabels = ["FL", "FR", "RL", "RR"];
const RingLength = 2.0 * Math.PI * 46.0;           // [-] circumference of the SVG ring (r = 46)
const SweepLength = 0.75 * RingLength;             // [-] the dial is a 270° sweep, the gap at the bottom

export class CockpitCluster
{
    constructor()
    {
        this.Root = document.createElement("section");
        this.Root.id = "cockpit-cluster";
        this.Root.className = "cockpit-cluster hidden";
        this.Root.setAttribute("aria-label", "Instrument cluster");
        this.Root.innerHTML = `
            <div class="cc-dial">
                <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle class="cc-track" cx="50" cy="50" r="46"></circle>
                    <circle class="cc-speed" cx="50" cy="50" r="46" stroke-dasharray="${SweepLength} ${RingLength}" stroke-dashoffset="${SweepLength}"></circle>
                </svg>
                <div class="cc-centre">
                    <b class="cc-speed-text">0</b>
                    <span class="cc-unit">km/h</span>
                    <span class="cc-gear">N</span>
                </div>
            </div>
            <div class="cc-leds"></div>
            <div class="cc-row">
                <div class="cc-throttle"><i></i></div>
                <div class="cc-tyres"></div>
            </div>
            <div class="cc-rpm-text">0 rpm</div>`;
        this.Speed = this.Root.querySelector(".cc-speed");
        this.SpeedText = this.Root.querySelector(".cc-speed-text");
        this.Gear = this.Root.querySelector(".cc-gear");
        this.RpmText = this.Root.querySelector(".cc-rpm-text");
        this.Throttle = this.Root.querySelector(".cc-throttle i");
        this.Leds = Array.from({ length: ShiftLights }, () => this.Root.querySelector(".cc-leds").appendChild(document.createElement("i")));
        const Tyres = this.Root.querySelector(".cc-tyres");
        this.TyreCells = TyreLabels.map((Label) =>
        {
            const Cell = document.createElement("div");
            Cell.className = "cc-tyre";
            Cell.innerHTML = `<span>${Label}</span><b>--</b>`;
            Tyres.appendChild(Cell);
            return Cell;
        });
        document.body.appendChild(this.Root);
        this.Last = {};
    }

    // 📝 Writes only what changed, so a frame of unchanged telemetry touches no DOM node.
    Update(Telemetry)
    {
        const Kph = Math.max(0.0, Telemetry.Speed * 3.6);
        const Rounded = Math.round(Kph);
        if (this.Last.Kph !== Rounded)
        {
            this.Last.Kph = Rounded;
            this.SpeedText.textContent = String(Rounded);
            this.Speed.style.strokeDashoffset = String(SweepLength * (1.0 - Math.min(1.0, Kph / SpeedScaleKph)));
        }
        if (this.Last.Gear !== Telemetry.Gear)
        {
            this.Last.Gear = Telemetry.Gear;
            this.Gear.textContent = Telemetry.Gear;
        }
        const Rpm = Math.round(Telemetry.EngineRPM);
        if (this.Last.Rpm !== Rpm)
        {
            this.Last.Rpm = Rpm;
            this.RpmText.textContent = `${Rpm} rpm`;
            const Lit = Math.max(0, Math.min(ShiftLights, Math.round((Rpm - ShiftStart) / (EngineSheet.RedlineRPM - ShiftStart) * ShiftLights)));
            this.Leds.forEach((Led, Index) => Led.className = Index < Lit ? (Index < ShiftLights * 0.6 ? "on" : Index < ShiftLights * 0.85 ? "amber" : "red") : "");
        }
        const Throttle = Math.round(100.0 * Math.max(0.0, Math.min(1.0, Telemetry.Throttle)));
        if (this.Last.Throttle !== Throttle)
        {
            this.Last.Throttle = Throttle;
            this.Throttle.style.height = `${Throttle}%`;
        }
        this.TyreCells.forEach((Cell, Index) =>
        {
            const Temperature = Telemetry.TyreTemperatures[Index];
            const Burning = Telemetry.Ignited ? Telemetry.Ignited[Index] : false;
            const Burst = Telemetry.Bursts ? Telemetry.Bursts[Index] : false;
            const Key = `${Math.round(Temperature)}|${Burning}|${Burst}`;
            if (this.Last[`T${Index}`] === Key)
                return;
            this.Last[`T${Index}`] = Key;
            const Band = Burning ? "fire" : Burst ? "burst" : Temperature < 70 ? "cold" : Temperature < 110 ? "ok" : Temperature < 140 ? "hot" : "over";
            Cell.className = `cc-tyre ${Band}`;
            Cell.querySelector("b").textContent = Burst ? "BURST" : Burning ? "FIRE" : `${Math.round(Temperature)}°`;
        });
    }

    // 📝 Places the cluster so its centre sits on the screen point (CSS pixels), and shows it only while asked.
    Place(X, Y, Visible)
    {
        this.Root.classList.toggle("hidden", !Visible);
        if (!Visible)
            return;
        this.Root.style.transform = `translate(${X.toFixed(1)}px, ${Y.toFixed(1)}px) translate(-50%, -50%)`;
    }
}

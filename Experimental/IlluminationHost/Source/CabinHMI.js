//============================================================================================================================================
//                                                               CABINHMI.JS
//============================================================================================================================================
// 🧩 HMI — 2D canvas textures for the cabin tablet and cluster, driven by VehicleSolver state.
//    Port of Frontier's TabletPanel's story sequences but trimmed to a living cockpit: tablet shows time, media, apps;
//    cluster shows speed, tyre pressure, popped warnings.

export class CabinHMI
{
    constructor(Device)
    {
        this.Device = Device;
        // Tablet 1024×640 (aspect 1.6 of 0.30/0.19 ≈ 1.578)
        this.TabletCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1024, 640) : Object.assign(document.createElement("canvas"), { width:1024, height:640 });
        this.TabletContext = this.TabletCanvas.getContext("2d");
        // Cluster 1024×512 (0.34/0.19 ≈ 1.78, but hex bezel crops)
        this.ClusterCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1024, 512) : Object.assign(document.createElement("canvas"), { width:1024, height:512 });
        this.ClusterContext = this.ClusterCanvas.getContext("2d");

        this.TabletTexture = Device.createTexture({ label:"Cabin tablet HMI", size:[1024,640,1], format:"rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
        this.ClusterTexture = Device.createTexture({ label:"Cabin cluster HMI", size:[1024,512,1], format:"rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });

        this.TabletSampler = Device.createSampler({ label:"Cabin tablet sampler", magFilter:"linear", minFilter:"linear", addressModeU:"clamp-to-edge", addressModeV:"clamp-to-edge" });
        this.ClusterSampler = Device.createSampler({ label:"Cabin cluster sampler", magFilter:"linear", minFilter:"linear", addressModeU:"clamp-to-edge", addressModeV:"clamp-to-edge" });

        // state for animations
        this.Clock = 0;
        this.BlinkPhase = 0;
        this.SelectedApp = 0;
        this.Apps = [
            { icon:"🧭", label:"Navigate" }, { icon:"🎵", label:"Media" }, { icon:"❄", label:"Climate" },
            { icon:"⚙",  label:"Vehicle" }, { icon:"📞", label:"Phone" }, { icon:"🔋", label:"Energy" }
        ];
    }

    Update(DeltaTime, Vehicle)
    {
        this.Clock += DeltaTime;
        this.BlinkPhase += DeltaTime * 2.2;
        // Normalise Vehicle into a display telemetry: prefer QueryTelemetry() when available (IlluminationHost's VehicleSolver)
        let Telemetry = null;
        try { Telemetry = Vehicle && Vehicle.QueryTelemetry ? Vehicle.QueryTelemetry() : null; } catch {}
        // Fallback raw object (used by unit tests).
        const Source = Telemetry || Vehicle;
        this.DrawTablet(Source, Vehicle);
        this.DrawCluster(Source, Vehicle);
        this.Upload();
    }

    Upload()
    {
        // GPU copy from canvas bitmap to texture via copyExternalImageToTexture where available, fallback via ImageBitmap.
        // We use device.queue.copyExternalImageToTexture if canvas is visible; but OffscreenCanvas needs ImageBitmap.
        const queue = this.Device.queue;
        // Try copyExternalImageToTexture first (works for HTMLCanvas and OffscreenCanvas in most browsers)
        try
        {
            queue.copyExternalImageToTexture({ source: this.TabletCanvas }, { texture: this.TabletTexture }, [1024,640,1]);
            queue.copyExternalImageToTexture({ source: this.ClusterCanvas }, { texture: this.ClusterTexture }, [1024,512,1]);
        }
        catch
        {
            // Fallback: get ImageData and writeTexture
            const tabletData = this.TabletContext.getImageData(0,0,1024,640).data;
            const clusterData = this.ClusterContext.getImageData(0,0,1024,512).data;
            queue.writeTexture({ texture: this.TabletTexture }, tabletData, { bytesPerRow: 1024*4 }, [1024,640,1]);
            queue.writeTexture({ texture: this.ClusterTexture }, clusterData, { bytesPerRow: 1024*4 }, [1024,512,1]);
        }
    }

    // ── Tablet ───────────────────────────────────────────────────────────────────────────────────────────────
    DrawTablet(Source, Vehicle)
    {
        const g = this.TabletContext, W=1024, H=640;
        g.clearRect(0,0,W,H);
        // Background: dark graphite with subtle vignette
        const bg = g.createLinearGradient(0,0,0,H);
        bg.addColorStop(0,"#0e1319"); bg.addColorStop(1,"#121a23");
        g.fillStyle=bg; g.fillRect(0,0,W,H);
        // Top bar: time, connectivity, profile
        g.fillStyle="#1a252f";
        g.fillRect(0,0,W,54);
        const now=new Date(); // use wall clock
        const time = now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
        g.fillStyle="#e6edf2"; g.font="600 22px Inter, system-ui, sans-serif"; g.textBaseline="middle";
        g.fillText(time, 22, 27);
        // Speed pill in top bar — supports both Telemetry.Speed (signed m/s) and LinearVelocity.
        const speedMps = Source ? (Source.Speed !==undefined ? Math.abs(Source.Speed) : (Source.LinearVelocity ? Math.hypot(...Source.LinearVelocity) : 0)) : 0;
        const speedKmh = Math.round(speedMps*3.6);
        g.fillStyle="#0b9e62"; g.beginPath(); g.roundRect(W-180, 10, 108, 34, 17); g.fill();
        g.fillStyle="#fff"; g.font="700 18px Inter, system-ui, sans-serif"; g.textAlign="center"; g.fillText(`${speedKmh} km/h`, W-126, 27); g.textAlign="left";
        // Signal dots
        g.fillStyle="#6b7d8f"; g.font="12px Inter, system-ui, sans-serif"; g.fillText("LTE  •  ♫  •  72%", W-360, 27);

        // Two-column layout: left map card, right stacks
        // Map card
        g.fillStyle="#0f1e2e"; g.beginPath(); g.roundRect(18, 72, 620, 548, 18); g.fill();
        // faux map: grid + route
        g.save(); g.beginPath(); g.roundRect(18,72,620,548,18); g.clip();
        g.fillStyle="#0b1726"; g.fillRect(18,72,620,548);
        g.strokeStyle="rgba(255,255,255,0.07)"; g.lineWidth=1;
        for(let x=18; x<640; x+=56){ g.beginPath(); g.moveTo(x,72); g.lineTo(x,620); g.stroke(); }
        for(let y=72; y<640; y+=56){ g.beginPath(); g.moveTo(18,y); g.lineTo(638,y); g.stroke(); }
        // route line
        g.strokeStyle="#3fa0ff"; g.lineWidth=5; g.lineCap="round"; g.lineJoin="round";
        g.beginPath(); g.moveTo(60,540); g.bezierCurveTo(180,480, 260,380, 320,340); g.bezierCurveTo(400,280, 460,160, 580,120); g.stroke();
        // car dot
        const pulse = 0.5+0.5*Math.sin(this.Clock*2.0);
        g.fillStyle=`rgba(63,160,255,${0.6+0.3*pulse})`; g.beginPath(); g.arc(320,340, 9+3*pulse,0,Math.PI*2); g.fill();
        g.fillStyle="#fff"; g.beginPath(); g.arc(320,340,4,0,Math.PI*2); g.fill();
        // map labels
        g.fillStyle="rgba(230,237,242,0.92)"; g.font="600 13px Inter, system-ui, sans-serif"; g.fillText("Kyalami  •  2.1 km", 28, 112);
        g.fillStyle="rgba(230,237,242,0.55)"; g.font="12px Inter, system-ui, sans-serif"; g.fillText("Estimated 14:26  •  Southbound", 28, 130);
        g.restore();
        // Map bottom bar: Navigate button
        g.fillStyle="#1a2f47"; g.beginPath(); g.roundRect(32, 560, 592, 44, 12); g.fill();
        g.fillStyle="#9ec8ff"; g.font="600 14px Inter, system-ui, sans-serif"; g.textAlign="center"; g.fillText("▸  Navigate  •  R512  •  Start guidance", 328, 587); g.textAlign="left";

        // Right stack: media card, climate card, apps grid
        // Media
        g.fillStyle="#13202e"; g.beginPath(); g.roundRect(658,72,348,150,16); g.fill();
        g.fillStyle="#e6edf2"; g.font="700 14px Inter, system-ui, sans-serif"; g.fillText("Now playing", 678, 96);
        g.fillStyle="#8aa0b6"; g.font="12px Inter, system-ui, sans-serif"; g.fillText("K. — Odyssey  •  Frontier mix", 678, 116);
        // progress bar
        const prog = (this.Clock*0.07)%1;
        g.fillStyle="#1e344d"; g.beginPath(); g.roundRect(678,132,308,6,3); g.fill();
        g.fillStyle="#3fa0ff"; g.beginPath(); g.roundRect(678,132,308*prog,6,3); g.fill();
        g.fillStyle="#5a6e82"; g.font="11px Inter, system-ui, sans-serif"; g.fillText("1:42", 678, 152); g.fillText("-2:08", 940, 152);
        // play controls
        g.fillStyle="#e6edf2"; g.font="16px system-ui"; g.fillText("⏮   ⏸   ⏭   ♡", 678, 178);

        // Climate
        g.fillStyle="#13202e"; g.beginPath(); g.roundRect(658,238,348,116,16); g.fill();
        g.fillStyle="#e6edf2"; g.font="700 14px Inter, system-ui, sans-serif"; g.fillText("Climate", 678, 262);
        const tempL=22, tempR=22;
        g.fillStyle="#0b1726"; g.beginPath(); g.roundRect(678,278,156,58,12); g.fill();
        g.beginPath(); g.roundRect(850,278,156,58,12); g.fill();
        g.fillStyle="#7fb3ff"; g.font="700 22px Inter, system-ui, sans-serif"; g.textAlign="center";
        g.fillText(`${tempL}°`, 756, 314); g.fillText(`${tempR}°`, 928, 314); g.textAlign="left";
        g.fillStyle="#6b7d8f"; g.font="11px Inter, system-ui, sans-serif"; g.textAlign="center"; g.fillText("DRIVER",756,330); g.fillText("PASSENGER",928,330); g.textAlign="left";

        // Apps grid 3×2
        g.fillStyle="#13202e"; g.beginPath(); g.roundRect(658,370,348,250,16); g.fill();
        g.fillStyle="#e6edf2"; g.font="700 14px Inter, system-ui, sans-serif"; g.fillText("Apps", 678, 394);
        for(let i=0;i<6;++i){
            const col=i%3, row=Math.floor(i/3);
            const x=678+col*110, y=408+row*92;
            const selected = i===this.SelectedApp;
            const blink = selected ? 0.55+0.45*Math.sin(this.BlinkPhase*2.0) : 1;
            if(selected){ g.fillStyle=`rgba(63,160,255,${0.18*blink})`; g.beginPath(); g.roundRect(x-6,y-6,98,80,14); g.fill(); }
            g.fillStyle= selected ? "rgba(232,240,248,0.98)" : "rgba(232,240,248,0.92)";
            g.beginPath(); g.roundRect(x, y, 86, 56, 12); g.fill();
            g.fillStyle="#0b1726"; g.font="22px system-ui"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(this.Apps[i].icon, x+43, y+24);
            g.fillStyle="#8aa0b6"; g.font="11px Inter, system-ui, sans-serif"; g.fillText(this.Apps[i].label, x+43, y+50);
            g.textAlign="left"; g.textBaseline="alphabetic";
        }
        // tyre pressure hint at bottom — works with telemetry Pressures[kPa] and Bursts, and with legacy Tyres objects.
        let pressuresPsi = [32,32,32,32], popped = [false,false,false,false];
        if (Source && Source.Pressures) { pressuresPsi = Source.Pressures.map(kPa=> Math.round(kPa/6.89476)); popped = Source.Bursts || popped; }
        else if (Vehicle?.Tyres) { try { pressuresPsi = Vehicle.Tyres.map(t=>Math.round(t.Pressure)); popped = Vehicle.Tyres.map(t=>t.Popped); } catch {} }
        g.fillStyle="#1a2b3d"; g.beginPath(); g.roundRect(678, 530, 308, 24, 8); g.fill();
        g.font="11px Inter, system-ui, sans-serif";
        for(let w=0;w<4;++w){
            const x=688+w*76;
            const psi = pressuresPsi[w];
            const col = popped[w] ? "#ff4d4d" : (psi<22 ? "#ffae00" : "#8aa0b6");
            g.fillStyle=col; g.fillText(`${["FL","FR","RL","RR"][w]} ${psi} psi${popped[w]?" ✕":""}`, x, 546);
        }
    }

    DrawCluster(Source, Vehicle)
    {
        const g=this.ClusterContext, W=1024, H=512;
        g.clearRect(0,0,W,H);
        // Background hexagon-ish: dark with beveled edge
        g.fillStyle="#0a1018"; g.fillRect(0,0,W,H);
        // subtle vignette
        const grad=g.createRadialGradient(W/2,H/2, 120, W/2,H/2, 420);
        grad.addColorStop(0,"rgba(22,34,50,0.0)"); grad.addColorStop(1,"rgba(0,0,0,0.55)");
        g.fillStyle=grad; g.fillRect(0,0,W,H);
        // Outer bezel hexagon outline
        g.strokeStyle="#1e2f45"; g.lineWidth=3;
        g.beginPath(); this.RoundHexagon(g, W/2, H/2, 470, 190, 16); g.stroke();
        g.strokeStyle="rgba(100,150,200,0.15)"; g.lineWidth=1;
        g.beginPath(); this.RoundHexagon(g, W/2, H/2, 458, 178, 12); g.stroke();

        const speedMps = Source ? (Source.Speed!==undefined ? Math.abs(Source.Speed) : (Vehicle && Vehicle.LinearVelocity? Math.hypot(...Vehicle.LinearVelocity):0)) : 0;
        const speedKmh = speedMps*3.6;
        const kmhInt = Math.round(speedKmh);
        // Tacho: prefer EngineRPM from telemetry, else wheel spin.
        let rpm = 0;
        if (Source && Source.EngineRPM !== undefined) rpm = Math.round(Source.EngineRPM);
        else if (Vehicle?.WheelSpin) rpm = Math.round(Math.min(7200, Math.max(...Vehicle.WheelSpin.map(Math.abs))*60/(2*Math.PI)*3.1));
        else rpm = Math.round(Math.min(7200, speedMps*180));
        // Speed numeric large centre
        g.fillStyle="#e6eef6"; g.font="700 96px Inter, system-ui, sans-serif"; g.textAlign="center"; g.textBaseline="middle";
        g.fillText(`${kmhInt}`, W/2, H/2 - 6);
        g.fillStyle="#7d90a6"; g.font="600 18px Inter, system-ui, sans-serif"; g.fillText("km/h", W/2, H/2 + 52);
        // Gear / drive mode pill
        const gear = Source && Source.Gear ? Source.Gear : (Math.abs(speedKmh) < 1 ? "P" : (speedKmh < 40 ? "D1" : speedKmh < 85 ? "D2" : speedKmh < 130 ? "D3" : "D4"));
        g.fillStyle="#0b9e62"; g.beginPath(); g.roundRect(W/2 - 28, H/2 + 76, 56, 28, 14); g.fill();
        g.fillStyle="#fff"; g.font="700 16px Inter, system-ui, sans-serif"; g.textAlign="center"; g.fillText(gear, W/2, H/2 + 94);

        // Left gauge: tachometer arc
        this.DrawGauge(g, 212, H/2, 112, rpm, 7200, "rpm ×1000", (v)=> (v/1000).toFixed(1), "#3fa0ff", rpm>6200);
        // Right gauge: pressure average as "charge"
        let avgPsi = 32;
        if (Source && Source.Pressures) avgPsi = Source.Pressures.reduce((s,kPa)=>s+kPa/6.89476,0)/4;
        else if (Vehicle?.Tyres) avgPsi = Vehicle.Tyres.reduce((s,t)=>s+t.Pressure,0)/4;
        const batt = Math.round(Math.max(0, Math.min(100, avgPsi/32*100)));
        this.DrawGauge(g, W-212, H/2, 112, batt, 100, "charge %", (v)=> `${v}%`, "#4ade80", batt<20);

        // Bottom strip: telltales — support telemetry Pressures/Bursts
        let popped = false, lowPressure = false;
        if (Source && Source.Bursts) { popped = Source.Bursts.some(Boolean); lowPressure = (Source.Pressures||[]).some(kPa=> kPa/6.89476 < 18); }
        else if (Vehicle?.Tyres) { popped = Vehicle.Tyres.some(t=>t.Popped); lowPressure = Vehicle.Tyres.some(t=>t.Pressure<18); }
        const telltales=[
            { on:true, label:"≡D", color:"#8aa0b6" },
            { on:popped, label:"⚠ TYRE", color:"#ff3b30" },
            { on:lowPressure && !popped, label:"(!) LOW", color:"#ffae00" },
            { on: Math.abs(speedKmh)>8, label:"ABS", color:"#7fb3ff" },
            { on: true, label:"P", color: gear==="P" ? "#0b9e62" : "#3a4a5c" }
        ];
        let tx= W/2 - (telltales.length*88)/2;
        for(const t of telltales){
            g.fillStyle = t.on ? t.color : "rgba(70,85,102,0.35)";
            g.font=`${t.on?"700":"500"} 11px Inter, system-ui, sans-serif`; g.textAlign="center";
            g.fillText(t.label, tx+44, H-28);
            if(t.on){ g.fillStyle=t.color; g.beginPath(); g.arc(tx+44, H-42, 3,0,Math.PI*2); g.fill(); }
            tx+=88;
        }
        g.textAlign="left";
    }

    RoundHexagon(g, cx, cy, rx, ry, r)
    {
        // Approximation: hexagon with rounded corners, width 2*rx, height 2*ry, chamfer 0.32
        const chamfer=0.32;
        const hx=rx*chamfer, hy=ry*chamfer;
        // points clockwise from top
        const pts=[
            [cx - rx + r, cy - ry],
            [cx + rx - r, cy - ry],
            [cx + rx, cy - ry + hy],
            [cx + rx, cy + ry - hy],
            [cx + rx - r, cy + ry],
            [cx - rx + r, cy + ry],
            [cx - rx, cy + ry - hy],
            [cx - rx, cy - ry + hy]
        ];
        g.moveTo(pts[0][0], pts[0][1]);
        for(let i=1;i<pts.length;++i) g.lineTo(pts[i][0], pts[i][1]);
        g.closePath();
    }

    DrawGauge(g, cx, cy, radius, value, maximum, label, formatter, accent, warn)
    {
        const start = -Math.PI*0.82, end = Math.PI*0.82;
        const frac = Math.max(0, Math.min(1, value/maximum));
        const angle = start + (end-start)*frac;
        // track
        g.strokeStyle="rgba(255,255,255,0.09)"; g.lineWidth=8; g.lineCap="round";
        g.beginPath(); g.arc(cx, cy, radius, start, end); g.stroke();
        // value arc
        g.strokeStyle= warn ? "#ff3b30" : accent; g.lineWidth=8;
        g.beginPath(); g.arc(cx, cy, radius, start, angle); g.stroke();
        // ticks
        g.strokeStyle="rgba(255,255,255,0.14)"; g.lineWidth=1;
        for(let i=0;i<=10;++i){
            const a=start+(end-start)*i/10;
            const r0=radius-4, r1=radius+6;
            g.beginPath(); g.moveTo(cx+Math.cos(a)*r0, cy+Math.sin(a)*r0); g.lineTo(cx+Math.cos(a)*r1, cy+Math.sin(a)*r1); g.stroke();
        }
        // needle
        g.strokeStyle="#e6eef6"; g.lineWidth=2;
        g.beginPath(); g.moveTo(cx,cy); g.lineTo(cx+Math.cos(angle)*(radius-10), cy+Math.sin(angle)*(radius-10)); g.stroke();
        g.fillStyle="#e6eef6"; g.beginPath(); g.arc(cx,cy,6,0,Math.PI*2); g.fill();
        // labels
        g.fillStyle="#7d90a6"; g.font="600 11px Inter, system-ui, sans-serif"; g.textAlign="center";
        g.fillText(label, cx, cy + radius + 26);
        g.fillStyle= warn ? "#ff3b30" : "#e6eef6"; g.font="700 18px Inter, system-ui, sans-serif";
        g.fillText(formatter(value), cx, cy + radius + 44);
    }
}

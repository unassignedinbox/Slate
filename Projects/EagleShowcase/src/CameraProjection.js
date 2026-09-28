//============================================================================================================================================
//                                                       CAMERAPROJECTION.JS
//============================================================================================================================================
// 🧩 Orbit camera with a smoothed follow target, pointer/touch drag, wheel dolly and a slow cinematic auto-orbit.

import { M4, V3, clamp, lerp } from "./MathSpecification.js";

export class CameraProjection
{
    constructor(canvas)
    {
        this.canvas = canvas;
        this.yaw = 2.30;             // [rad]
        this.pitch = 0.16;           // [rad]
        this.distance = 2.4;         // [m]
        this.target = [0, 0.4, 0];
        this.smoothTarget = [0, 0.4, 0];
        this.fieldOfView = 42 * Math.PI / 180.0;
        this.autoOrbit = true;
        this.autoRate = 0.085;       // [rad/s]
        this.position = [0, 0, 0];
        this.Attach();
    }

    Attach()
    {
        const canvas = this.canvas;
        let dragging = false, lastX = 0, lastY = 0, pinch = 0;

        const Down = (x, y) => { dragging = true; lastX = x; lastY = y; this.autoOrbit = false; };
        const Move = (x, y) =>
        {
            if (!dragging) return;
            this.yaw -= (x - lastX) * 0.0075;
            this.pitch = clamp(this.pitch + (y - lastY) * 0.0055, -1.25, 1.35);
            lastX = x; lastY = y;
        };
        const Up = () => { dragging = false; };

        canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); Down(e.clientX, e.clientY); });
        canvas.addEventListener("pointermove", (e) => Move(e.clientX, e.clientY));
        canvas.addEventListener("pointerup", Up);
        canvas.addEventListener("pointercancel", Up);
        canvas.addEventListener("wheel", (e) =>
        {
            e.preventDefault();
            this.distance = clamp(this.distance * Math.exp(e.deltaY * 0.0012), 0.45, 26.0);
        }, { passive: false });

        canvas.addEventListener("touchstart", (e) =>
        {
            if (e.touches.length === 2)
                pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        });
        canvas.addEventListener("touchmove", (e) =>
        {
            if (e.touches.length === 2)
            {
                const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                if (pinch > 0) this.distance = clamp(this.distance * (pinch / d), 0.45, 26.0);
                pinch = d;
                e.preventDefault();
            }
        }, { passive: false });
    }

    Frame(distance, yaw, pitch)
    {
        this.distance = distance;
        if (yaw !== undefined) this.yaw = yaw;
        if (pitch !== undefined) this.pitch = pitch;
    }

    Update(dt, target)
    {
        if (this.autoOrbit) this.yaw += this.autoRate * dt;
        const k = 1.0 - Math.exp(-dt * 6.0);
        this.smoothTarget = V3.lerp(this.smoothTarget, target, k);
        const c = Math.cos(this.pitch);
        this.position = V3.add(this.smoothTarget, [
            Math.sin(this.yaw) * c * this.distance,
            Math.sin(this.pitch) * this.distance,
            Math.cos(this.yaw) * c * this.distance,
        ]);
    }

    Matrices(aspect)
    {
        const view = M4.lookAt(this.position, this.smoothTarget, [0, 1, 0]);
        const projection = M4.perspective(this.fieldOfView, aspect, 0.03, 600.0);
        const viewProjection = M4.multiply(projection, view);
        return { view, projection, viewProjection, inverseViewProjection: M4.invert(viewProjection) };
    }
}

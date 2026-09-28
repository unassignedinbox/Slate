//============================================================================================================================================
//                                                        DYNAMICSSOLVER.JS
//============================================================================================================================================
// 🧩 Secondary animation. Nothing here is keyframed: every feather, the cervical column and the tail base carry a
//    critically-tuned angular spring driven by the *measured* motion of their own bone, so the plumage lags the
//    wing at stroke reversal, overshoots, flutters and settles, and the head/tail trail the trunk.
//
//    Per dynamic joint and per axis:   θ̈ = −gain·v∥ − ω₀²·θ − 2ζω₀·θ̇
//    where v∥ is the joint tip's velocity projected on a chosen local axis (dorsal velocity bends a feather, lateral
//    velocity twists it), ω₀ = 2πf₀ is the quill's natural frequency and ζ its damping ratio. Long primaries are soft
//    and slow (f₀ ≈ 5.5 Hz), short coverts and alula quills are stiff and fast, the neck is slower still.

import { Quat, clamp, Hash1 } from "./MathSpecification.js";

class SpringAxis
{
    constructor(axis, driveAxis, gain, frequency, damping, limit)
    {
        this.axis = axis;                 // 0 = X (twist), 1 = Y (sweep), 2 = Z (bend) in the joint's local frame
        this.driveAxis = driveAxis;       // local axis whose tip velocity drives this spring
        this.gain = gain;                 // [rad/s² per m/s]
        this.ω0 = 2.0 * Math.PI * frequency;
        this.ζ = damping;
        this.limit = limit;               // [rad]
        this.θ = 0.0;
        this.ω = 0.0;
    }

    Integrate(drive, dt, impulse)
    {
        const k = this.ω0 * this.ω0, c = 2.0 * this.ζ * this.ω0;
        const a = -this.gain * drive - k * this.θ - c * this.ω + impulse;
        this.ω += a * dt;
        this.θ += this.ω * dt;
        if (this.θ > this.limit) { this.θ = this.limit; this.ω *= -0.25; }
        if (this.θ < -this.limit) { this.θ = -this.limit; this.ω *= -0.25; }
    }
}

export class DynamicsSolver
{
    constructor(skeleton)
    {
        this.skeleton = skeleton;
        this.joints = [];
        this.offset = new Array(skeleton.count).fill(null);
        this.enabled = true;
        this.strength = 1.0;

        const Add = (name, tipLength, axes, seed) =>
        {
            const index = skeleton.Query(name);
            if (index === undefined) return;
            this.joints.push({ index, tipLength, axes, seed, previousTip: null });
        };

        for (const T of ["L", "R"])
        {
            for (let i = 0; i < 10; ++i)
            {
                const t = i / 9;
                const f = 6.6 - 1.6 * t;                                  // long outer quills are the softest
                Add(`primary${T}${i}`, 0.30 + 0.17 * t, [
                    new SpringAxis(2, 1, 62.0, f, 0.26, 0.55),            // bend: dorsal velocity → trailing flex
                    new SpringAxis(0, 2, 26.0, f * 1.35, 0.30, 0.42),     // twist: lateral velocity → feathering
                ], i * 13 + (T === "L" ? 0 : 97));
            }
            for (let i = 0; i < 17; ++i)
            {
                Add(`secondary${T}${i}`, 0.28, [
                    new SpringAxis(2, 1, 46.0, 8.2, 0.32, 0.40),
                    new SpringAxis(0, 2, 16.0, 10.5, 0.36, 0.28),
                ], 200 + i * 7 + (T === "L" ? 0 : 61));
            }
            for (let i = 0; i < 3; ++i)
                Add(`alulaQuill${T}${i}`, 0.08, [new SpringAxis(2, 1, 22.0, 15.0, 0.40, 0.25)], 400 + i);
        }
        for (let i = 0; i < 12; ++i)
            Add(`rectrix${i}`, 0.29, [
                new SpringAxis(2, 1, 48.0, 7.0, 0.30, 0.45),
                new SpringAxis(0, 2, 14.0, 9.0, 0.34, 0.25),
            ], 500 + i * 11);

        // Cervical column and tail base: heavier, slower overlap so the head and tail trail the trunk.
        for (let i = 1; i <= 5; ++i)
            Add(`neck0${i}`, 0.09, [
                new SpringAxis(0, 1, 5.5, 3.4 + i * 0.35, 0.52, 0.18),
                new SpringAxis(1, 0, -5.0, 3.6 + i * 0.35, 0.52, 0.18),
            ], 600 + i);
        Add("skull", 0.08, [
            new SpringAxis(0, 1, 3.0, 5.0, 0.55, 0.10),
            new SpringAxis(1, 0, -3.0, 5.2, 0.55, 0.10),
        ], 700);
        Add("tailBase", 0.26, [
            new SpringAxis(0, 1, 7.0, 4.2, 0.45, 0.20),
            new SpringAxis(1, 0, -4.0, 4.6, 0.45, 0.14),
        ], 800);
    }

    Reset()
    {
        for (const J of this.joints) { J.previousTip = null; for (const A of J.axes) { A.θ = 0; A.ω = 0; } }
    }

    // `world` holds the animated (pre-dynamics) joint matrices. `excitation` is a 0…1 ruffle impulse from the clip.
    // Returns an array of local quaternion offsets to compose after the animated local rotation.
    Solve(world, dt, excitation = 0.0, time = 0.0)
    {
        const step = clamp(dt, 1.0 / 240.0, 1.0 / 30.0);
        const substeps = 2;
        const h = step / substeps;

        for (const J of this.joints)
        {
            const m = world[J.index];
            const axisX = [m[0], m[1], m[2]], axisY = [m[4], m[5], m[6]], axisZ = [m[8], m[9], m[10]];
            const tip = [m[12] + axisX[0] * J.tipLength, m[13] + axisX[1] * J.tipLength, m[14] + axisX[2] * J.tipLength];

            let vx = 0, vy = 0, vz = 0;
            if (J.previousTip)
            {
                const dx = (tip[0] - J.previousTip[0]) / step;
                const dy = (tip[1] - J.previousTip[1]) / step;
                const dz = (tip[2] - J.previousTip[2]) / step;
                vx = dx * axisX[0] + dy * axisX[1] + dz * axisX[2];
                vy = dx * axisY[0] + dy * axisY[1] + dz * axisY[2];
                vz = dx * axisZ[0] + dy * axisZ[1] + dz * axisZ[2];
            }
            J.previousTip = tip;
            const drive = [vx, vy, vz];

            const impulseBase = excitation > 0.001
                ? excitation * 120.0 * (Hash1(J.seed * 1.7 + Math.floor(time * 60.0) * 0.013) - 0.5)
                : 0.0;

            if (!this.enabled)
            {
                for (const A of J.axes) { A.θ = 0; A.ω = 0; }
            }
            else
            {
                for (const A of J.axes)
                    for (let s = 0; s < substeps; ++s)
                        A.Integrate(drive[A.driveAxis], h, impulseBase);
            }

            let q = Quat.identity();
            for (const A of J.axes)
            {
                const θ = A.θ * this.strength;
                const axis = A.axis === 0 ? [1, 0, 0] : A.axis === 1 ? [0, 1, 0] : [0, 0, 1];
                q = Quat.multiply(q, Quat.fromAxisAngle(axis, θ));
            }
            this.offset[J.index] = q;
        }
        return this.offset;
    }
}

//============================================================================================================================================
//                                                        MOTIONSEQUENCE.JS
//============================================================================================================================================
// 🧩 The six eagle clips, authored against measured avian kinematics rather than by eye.
//
//    Wingbeat — X-ray Reconstruction of Moving Morphology (XROMM) of flapping flight (Baier et al., PLOS ONE 2013)
//    gives the joint-by-joint pattern this module reproduces:
//      · the elbow reaches peak extension near 45 % of downstroke and peak flexion near 45 % of upstroke (range ≈ 91°),
//      · the wrist stays extended into early upstroke, then flexes rapidly, adducting up to ≈ 70°,
//      · elbow and wrist reverse ahead of the wingtip at the downstroke→upstroke transition (≈ −4 % and −2 % of cycle),
//      · the shoulder sweeps forward (protraction) through downstroke and back through upstroke.
//    Stroke asymmetry (upstroke shorter than downstroke) follows video studies of large soaring birds; a 4.8 kg bald
//    eagle beats at ≈ 2.4 Hz in cruising flapping flight, so the cycle is 0.417 s with a 0.54 downstroke fraction.
//
//    Walking uses a 1.15 s stride at a 0.70 duty factor with the lateral-sway waddle a plantigrade-ish raptor shows on
//    the ground, driven by analytic leg IK (femur held near-horizontal, intertarsal joint bending backward).
//
//    Every clip writes only local joint rotations/translations plus a locomotion request; the secondary motion
//    (feather lag and flutter, neck/tail overlap) is added afterwards by DynamicsSolver.

import { Quat, V3, DEG, clamp, lerp, smoothstep, Fractal1, Noise1 } from "./MathSpecification.js";
import { MirrorQuaternion, EagleSpecification } from "./SkeletonStructure.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                          POSE SPACE
//------------------------------------------------------------------------------------------------------------------------

export class PoseSpace
{
    constructor(skeleton)
    {
        this.skeleton = skeleton;
        this.rotation = new Array(skeleton.count);
        this.translation = new Array(skeleton.count);
        this.locomotion = { speed: 0, turnRate: 0, altitude: 0, bank: 0, pitch: 0, grounded: true };
        this.Reset();
    }

    Reset()
    {
        for (let i = 0; i < this.rotation.length; ++i) { this.rotation[i] = null; this.translation[i] = null; }
        this.locomotion.speed = 0; this.locomotion.turnRate = 0; this.locomotion.altitude = 0;
        this.locomotion.bank = 0; this.locomotion.pitch = 0; this.locomotion.grounded = true;
    }

    Index(name) { return this.skeleton.Query(name); }

    SetQuaternion(name, q)
    {
        const i = this.skeleton.Query(name);
        if (i === undefined) return;
        this.rotation[i] = q;
    }

    // Degrees, applied in the joint's own frame (X = long axis, Y = sweep, Z = elevation).
    Set(name, x = 0, y = 0, z = 0) { this.SetQuaternion(name, Quat.fromEuler(x * DEG, y * DEG, z * DEG)); }

    SetSide(name, side, x = 0, y = 0, z = 0)
    {
        this.SetQuaternion(name + (side > 0 ? "L" : "R"), MirrorQuaternion(Quat.fromEuler(x * DEG, y * DEG, z * DEG), side));
    }

    Translate(name, v)
    {
        const i = this.skeleton.Query(name);
        if (i === undefined) return;
        this.translation[i] = v;
    }
}

export function BlendPose(a, b, t, out)
{
    for (let i = 0; i < out.rotation.length; ++i)
    {
        const qa = a.rotation[i], qb = b.rotation[i];
        if (!qa && !qb) out.rotation[i] = null;
        else if (!qa) out.rotation[i] = Quat.slerp(Quat.identity(), qb, t);
        else if (!qb) out.rotation[i] = Quat.slerp(qa, Quat.identity(), t);
        else out.rotation[i] = Quat.slerp(qa, qb, t);

        const ta = a.translation[i], tb = b.translation[i];
        if (!ta && !tb) out.translation[i] = null;
        else out.translation[i] = V3.lerp(ta || [0, 0, 0], tb || [0, 0, 0], t);
    }
    for (const k of ["speed", "turnRate", "altitude", "bank", "pitch"])
        out.locomotion[k] = lerp(a.locomotion[k], b.locomotion[k], t);
    out.locomotion.grounded = t < 0.5 ? a.locomotion.grounded : b.locomotion.grounded;
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHARED POSE FRAGMENTS
//------------------------------------------------------------------------------------------------------------------------

const S = EagleSpecification;

// One wing, described the way a bird anatomist would: elevation/sweep/long-axis at the shoulder, flexion at the
//    elbow and wrist (0° = fully spread bind pose, positive = folded aft).
function ApplyWing(pose, side, w)
{
    pose.SetSide("shoulder", side, w.twist || 0, w.sweep || 0, w.elevation || 0);
    pose.SetSide("elbow", side, w.elbowTwist || 0, w.elbow || 0, w.elbowDihedral || 0);
    pose.SetSide("wrist", side, w.wristTwist || 0, w.wrist || 0, w.wristDihedral || 0);
    pose.SetSide("hand", side, 0, w.hand || 0, w.handDihedral || 0);
    pose.SetSide("digit", side, 0, w.digit || 0, 0);
    pose.SetSide("alula", side, 0, w.alula || 0, w.alulaLift || 0);
}

// Remiges. `primary(t)` / `secondary(t)` return {twist, spread, bend} in degrees for the normalised feather station t.
function ApplyRemiges(pose, side, primary, secondary, alula)
{
    for (let i = 0; i < S.primaries; ++i)
    {
        const t = i / (S.primaries - 1);
        const f = primary(t, i);
        pose.SetQuaternion(`primary${side > 0 ? "L" : "R"}${i}`,
            MirrorQuaternion(Quat.fromEuler((f.twist || 0) * DEG, (f.spread || 0) * DEG, (f.bend || 0) * DEG), side));
    }
    for (let i = 0; i < S.secondaries; ++i)
    {
        const t = i / (S.secondaries - 1);
        const f = secondary(t, i);
        pose.SetQuaternion(`secondary${side > 0 ? "L" : "R"}${i}`,
            MirrorQuaternion(Quat.fromEuler((f.twist || 0) * DEG, (f.spread || 0) * DEG, (f.bend || 0) * DEG), side));
    }
    for (let i = 0; i < S.alulaQuills; ++i)
    {
        const f = alula ? alula(i / (S.alulaQuills - 1), i) : { twist: 0, spread: 0, bend: 0 };
        pose.SetQuaternion(`alulaQuill${side > 0 ? "L" : "R"}${i}`,
            MirrorQuaternion(Quat.fromEuler((f.twist || 0) * DEG, (f.spread || 0) * DEG, (f.bend || 0) * DEG), side));
    }
}

// Rectrices: `fan` spreads the tail (0 = closed, 1 = fully fanned ≈ ±26°), `curl` lifts the outer feathers.
function ApplyTail(pose, fan, curl = 0, twist = 0)
{
    for (let i = 0; i < S.rectrices; ++i)
    {
        const pairIndex = Math.floor(i / 2);
        const side = i % 2 === 0 ? 1 : -1;
        // The bind pose already fans each pair 7° outboard; `fan` is the *total* opening (1 = fully spread),
        //    so the animated offset has to cancel the bind before adding its own.
        const spread = -side * pairIndex * (fan * 7.0 - 7.0);
        const lift = curl * pairIndex * 1.1;
        pose.Set(`rectrix${i}`, twist * side * pairIndex * 0.25, spread, lift);
    }
}

// Cervical column: the requested yaw/pitch/roll is distributed over the five neck joints with the weighting a real
//    S-curved neck shows (most yaw in the middle, most pitch at the base and skull).
function ApplyNeck(pose, yaw, pitch, roll, extend = 0, headYaw = 0, headPitch = 0, headRoll = 0)
{
    const yawShare = [0.10, 0.22, 0.28, 0.24, 0.16];
    const pitchShare = [0.30, 0.22, 0.16, 0.16, 0.16];
    const rollShare = [0.14, 0.20, 0.24, 0.22, 0.20];
    const extendShare = [0.34, 0.26, 0.18, 0.12, 0.10];
    for (let i = 0; i < 5; ++i)
    {
        pose.Set(`neck0${i + 1}`,
            pitch * pitchShare[i] + extend * extendShare[i] * -1.0,
            yaw * yawShare[i],
            roll * rollShare[i]);
    }
    pose.Set("skull", headPitch, headYaw, headRoll);
}

// Analytic leg IK. `target` is the toe-pad contact point in root space [m]; femurSwing rotates the femur about X.
//    Returns nothing — it writes hip/knee/ankle/foot rotations into the pose.
function SolveLeg(pose, skeleton, side, target, femurSwing, footPitch)
{
    const T = side > 0 ? "L" : "R";
    const hip = skeleton.BindPosition("hip" + T);
    const knee = skeleton.BindPosition("knee" + T);
    const ankle = skeleton.BindPosition("ankle" + T);
    const foot = skeleton.BindPosition("foot" + T);

    const Polar = (from, to) => Math.atan2(to[1] - from[1], to[2] - from[2]);
    const Length = (from, to) => Math.hypot(to[1] - from[1], to[2] - from[2]);

    const β1Bind = Polar(hip, knee), L1 = Length(hip, knee);
    const β2Bind = Polar(knee, ankle), L2 = Length(knee, ankle);
    const β3Bind = Polar(ankle, foot), L3 = Length(ankle, foot);

    const β1 = β1Bind + femurSwing;
    const kneeNow = [knee[0], hip[1] + Math.sin(β1) * L1, hip[2] + Math.cos(β1) * L1];

    // Two-link reach from the knee to the ankle-below-target, with the intertarsal joint apex pointing aft.
    const goal = [target[0], target[1] + 0.012, target[2]];
    let dy = goal[1] - kneeNow[1], dz = goal[2] - kneeNow[2];
    let d = Math.hypot(dy, dz);
    const dMin = Math.abs(L2 - L3) + 0.004, dMax = L2 + L3 - 0.004;
    if (d < dMin) { const k = dMin / (d || 1e-6); dy *= k; dz *= k; d = dMin; }
    if (d > dMax) { const k = dMax / d; dy *= k; dz *= k; d = dMax; }

    const base = Math.atan2(dy, dz);
    const cosA = clamp((L2 * L2 + d * d - L3 * L3) / (2 * L2 * d), -1, 1);
    const cosB = clamp((L2 * L2 + L3 * L3 - d * d) / (2 * L2 * L3), -1, 1);
    const A = Math.acos(cosA), B = Math.acos(cosB);

    const β2 = base - A;                       // tibiotarsus: knee ahead, ankle behind ⇒ negative offset
    const β3 = β2 + (Math.PI - B);             // tarsometatarsus swings forward again

    pose.SetSide("hip", side, (β1 - β1Bind) / DEG, 0, 0);
    pose.SetSide("knee", side, (β2 - β2Bind - (β1 - β1Bind)) / DEG, 0, 0);
    pose.SetSide("ankle", side, (β3 - β3Bind - (β2 - β2Bind)) / DEG, 0, 0);
    pose.SetSide("foot", side, (footPitch - (β3 - β3Bind)) / DEG, 0, 0);
}

function ApplyToes(pose, side, curl, spread = 0)
{
    const names = ["hallux", "toe2", "toe3", "toe4"];
    for (let i = 0; i < names.length; ++i)
    {
        const isHallux = i === 0;
        pose.SetSide(names[i], side, (isHallux ? -curl * 1.2 : curl), spread * (i - 1.5) * 0.6, 0);
    }
}


//------------------------------------------------------------------------------------------------------------------------
//                                                   FEATHER AIM CONSTRAINT
//------------------------------------------------------------------------------------------------------------------------

// A folded wing cannot be described by small offsets from the spread bind pose: the humerus retracts, the forearm
//    folds back on it through ~168° and the wrist closes again, so every remex has to be re-aimed at its resting
//    direction along the body. This is the rigging answer — an aim constraint. It runs a throw-away FK of the current
//    pose, then writes, for each feather joint, the minimal local rotation that points its rachis along `direction`
//    (given in body space for the LEFT side and mirrored for the right).

let aimWorld = null, aimSkin = null;

function EnsureAimSpace(skeleton)
{
    if (aimWorld && aimWorld.length === skeleton.count) return;
    aimWorld = []; aimSkin = [];
    for (let i = 0; i < skeleton.count; ++i) { aimWorld.push(new Float32Array(16)); aimSkin.push(new Float32Array(16)); }
}

function AimFeathers(pose, side, prefix, count, direction, dorsal)
{
    const skeleton = pose.skeleton;
    EnsureAimSpace(skeleton);
    skeleton.Pose(pose.rotation, pose.translation, aimWorld, aimSkin);

    for (let i = 0; i < count; ++i)
    {
        const name = `${prefix}${side > 0 ? "L" : "R"}${i}`;
        const index = skeleton.Query(name);
        if (index === undefined) continue;
        const m = aimWorld[index];
        const t = i / Math.max(1, count - 1);

        // Right-side feather geometry is the left mesh reflected through X = 0, so in a right joint's own frame the
        //    rachis runs along local −X while the dorsal face is still local +Y. Reflect the target frame to match,
        //    otherwise the whole right wing aims backwards through the bird.
        let shaft = direction(t, i);
        let up = dorsal ? dorsal(t, i) : [0, 1, 0];
        if (side < 0)
        {
            shaft = [shaft[0], -shaft[1], -shaft[2]];
            up = [-up[0], up[1], up[2]];
        }

        // Full target frame — aiming the shaft alone leaves the vane's roll undefined, which turns feathers into
        //    blades; the dorsal reference pins it so the vanes shingle flat.
        const X = V3.normalize(shaft);
        let Y = V3.sub(up, V3.scale(X, V3.dot(X, up)));
        if (V3.length(Y) < 1e-5) Y = V3.sub([0, 1, 0], V3.scale(X, X[1]));
        Y = V3.normalize(Y);
        const Z = V3.cross(X, Y);

        // Local offset = (current world rotation)ᵀ · (target world rotation).
        const cx = [m[0], m[1], m[2]], cy = [m[4], m[5], m[6]], cz = [m[8], m[9], m[10]];
        const r = [
            V3.dot(cx, X), V3.dot(cy, X), V3.dot(cz, X),
            V3.dot(cx, Y), V3.dot(cy, Y), V3.dot(cz, Y),
            V3.dot(cx, Z), V3.dot(cy, Z), V3.dot(cz, Z),
        ];   // column-major 3×3 of the local rotation
        const offset = QuaternionFromBasis(r);

        const current = pose.rotation[index];
        pose.rotation[index] = current ? Quat.multiply(current, offset) : offset;
    }
}

// Column-major 3×3 (as [c0.x,c0.y,c0.z, c1.x,…]) → quaternion.
function QuaternionFromBasis(r)
{
    const trace = r[0] + r[4] + r[8];
    if (trace > 0)
    {
        const k = Math.sqrt(trace + 1.0) * 2.0;
        return Quat.normalize([(r[5] - r[7]) / k, (r[6] - r[2]) / k, (r[1] - r[3]) / k, 0.25 * k]);
    }
    if (r[0] > r[4] && r[0] > r[8])
    {
        const k = Math.sqrt(1.0 + r[0] - r[4] - r[8]) * 2.0;
        return Quat.normalize([0.25 * k, (r[3] + r[1]) / k, (r[6] + r[2]) / k, (r[5] - r[7]) / k]);
    }
    if (r[4] > r[8])
    {
        const k = Math.sqrt(1.0 + r[4] - r[0] - r[8]) * 2.0;
        return Quat.normalize([(r[3] + r[1]) / k, 0.25 * k, (r[7] + r[5]) / k, (r[6] - r[2]) / k]);
    }
    const k = Math.sqrt(1.0 + r[8] - r[0] - r[4]) * 2.0;
    return Quat.normalize([(r[6] + r[2]) / k, (r[7] + r[5]) / k, 0.25 * k, (r[1] - r[3]) / k]);
}

// Direction in body space from a yaw (degrees back from the span axis, +X → −Z) and a pitch.
function ShaftDirection(yaw, pitch)
{
    const y = yaw * DEG, p = pitch * DEG;
    return [Math.cos(y) * Math.cos(p), Math.sin(p), -Math.sin(y) * Math.cos(p)];
}

// The closed wing: humerus retracted and depressed, forearm folded back on it, hand closed, every remex aimed aft
//    along the flank so the primaries stack over the tail and the secondaries tile the back — the resting posture a
//    perched eagle holds.
export const FoldedWing = {
    elevation: -25, sweep: 68, twist: 38,
    elbow: 168, elbowDihedral: 8,
    wrist: 147, wristTwist: 14, wristDihedral: -8,
    hand: 10, digit: 6, alula: 4,
};

function ApplyFoldedWing(pose, side, extra = {}, ruffle = 0)
{
    ApplyWing(pose, side, Object.assign({}, FoldedWing, extra));
    const open = extra.open || 0;                       // 0 = closed, 1 = part-opened (rouse, screech)
    // Dorsal reference for the closed wing: the plumage lies over the back, tilted a little outboard.
    const dorsal = (tilt) => () => V3.normalize([tilt, 1.0, 0.05]);

    AimFeathers(pose, side, "primary", S.primaries,
        (t, i) => ShaftDirection(93 + 8 * t - 26 * open, -9 - 10 * t + 14 * open + ruffle * 5 * Math.sin(i * 2.7)),
        dorsal(0.55));
    AimFeathers(pose, side, "secondary", S.secondaries,
        (t) => ShaftDirection(89 + 5 * t - 16 * open, -12 - 8 * t + 10 * open), dorsal(0.46));
    AimFeathers(pose, side, "alulaQuill", S.alulaQuills, (t) => ShaftDirection(76 + 16 * t, 2 + 4 * t), dorsal(0.5));

    // Covert rows follow the closed wing: each tiles backwards over the row it overlaps, a little steeper each time,
    //    so the folded wing reads as shingled plumage rather than loose quills.
    const covertRows = [
        ["greaterCovert", 17, 88, 4, -14, -6, 0.42],
        ["medianCovert", 16, 86, 4, -16, -6, 0.40],
        ["lesserCovert", 14, 84, 4, -18, -6, 0.38],
        ["marginalCovert", 16, 80, 6, -20, -6, 0.36],
        ["primaryCovert", 10, 91, 6, -12, -8, 0.48],
        ["underCovert", 15, 90, 4, -5, -4, 0.55],
        ["underPrimaryCovert", 9, 93, 5, -3, -4, 0.55],
    ];
    for (const [prefix, count, yaw0, yawSpan, pitch0, pitchSpan, tilt] of covertRows)
        AimFeathers(pose, side, prefix, count,
            (t) => ShaftDirection(yaw0 + yawSpan * t - 18 * open, pitch0 + pitchSpan * t + 8 * open), dorsal(tilt));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CLIP: WING FLAP
//------------------------------------------------------------------------------------------------------------------------

const FlapCycle = {
    name: "Wing flap",
    duration: 1.0 / 2.4,                        // [s] 2.4 Hz cruise wingbeat for a ~4.8 kg eagle
    detail: "2.4 Hz · 54 % downstroke · XROMM joint phasing · head stabilised · primaries feather on the upstroke",

    Apply(pose, time, ctx)
    {
        const p = (time / this.duration) % 1.0;
        const D = 0.54;                          // downstroke fraction of the cycle
        const down = p < D;
        const s = down ? p / D : (p - D) / (1 - D);        // 0…1 within the current half-stroke
        const ease = smoothstep(s);

        // Shoulder: elevation +44° at the top of the upstroke to −40° at the bottom of the downstroke.
        const elevation = down ? lerp(44, -40, ease) : lerp(-40, 44, smoothstep(Math.pow(s, 0.88)));
        // Protraction leads the stroke: the humerus sweeps forward through the downstroke, back on the upstroke.
        const sweep = down ? lerp(6, -16, Math.sin(Math.PI * s)) : lerp(-4, 10, Math.sin(Math.PI * s));
        // Long-axis rotation: pronation mid-downstroke, strong supination through the upstroke.
        const twist = down ? 12 * Math.sin(Math.PI * s) - 2 : -20 * Math.sin(Math.PI * Math.pow(s, 0.8)) - 2;

        // Elbow and wrist reverse ≈ 4 % and 2 % of the cycle before the wingtip does (Baier et al. 2013), so their
        //    phase is advanced; flexion peaks near 45 % of the upstroke.
        const eShift = (x, lead) => { const q = (p + lead) % 1.0; return q < D ? q / D : (q - D) / (1 - D); };
        const eDown = ((p + 0.04) % 1.0) < D;
        const se = eShift(p, 0.04);
        const elbow = eDown
            ? lerp(26, 4, Math.sin(Math.PI * Math.min(1, se / 0.9)))        // extends through the downstroke
            : lerp(10, 58, Math.sin(Math.PI * Math.pow(se, 0.72)));         // flexes hard mid-upstroke
        const wDown = ((p + 0.02) % 1.0) < D;
        const sw = eShift(p, 0.02);
        const wrist = wDown
            ? lerp(18, 2, Math.sin(Math.PI * Math.min(1, sw / 0.85)))
            : lerp(4, 64, smoothstep(clamp((sw - 0.18) / 0.55, 0, 1)));     // retains extension into early upstroke

        const handFold = wDown ? lerp(6, 0, sw) : lerp(0, 22, smoothstep(clamp((sw - 0.25) / 0.5, 0, 1)));

        for (const side of [1, -1])
        {
            ApplyWing(pose, side, {
                elevation, sweep, twist,
                elbow, elbowDihedral: down ? -3 : 4,
                wrist, wristTwist: down ? -6 : 10, wristDihedral: down ? 2 : -6,
                hand: handFold, digit: handFold * 0.35,
                alula: down ? 4 : 16, alulaLift: down ? 0 : 6,
            });

            // Remiges: on the downstroke the vanes are pressed closed and the tip slots fan; on the upstroke every
            //    primary twists open (feathering) so air spills between them, then closes again at the top.
            const openness = down ? -0.18 * Math.sin(Math.PI * s) : Math.sin(Math.PI * Math.pow(s, 0.85));
            ApplyRemiges(pose, side,
                (t) => ({
                    twist: openness * lerp(14, 34, t),
                    spread: down ? -lerp(1, 7, t) * Math.sin(Math.PI * s) : lerp(2, 12, t) * Math.sin(Math.PI * s),
                    bend: (down ? lerp(2, 14, t) * Math.sin(Math.PI * s) : -lerp(1, 8, t) * Math.sin(Math.PI * s)),
                }),
                (t) => ({
                    twist: openness * lerp(10, 4, t),
                    spread: down ? -2 * Math.sin(Math.PI * s) : 4 * Math.sin(Math.PI * s),
                    bend: down ? 8 * Math.sin(Math.PI * s) * (1 - 0.5 * t) : -4 * Math.sin(Math.PI * s),
                }),
                (t) => ({ twist: 0, spread: down ? 2 : 10, bend: down ? 0 : 6 }));

            // Legs tucked up under the tail, toes balled.
            pose.SetSide("hip", side, -26, 0, 20);
            pose.SetSide("knee", side, 140, 0, 0);
            pose.SetSide("ankle", side, -53, 0, 0);
            pose.SetSide("foot", side, 58, 0, 0);
            ApplyToes(pose, side, 74, -6);
        }

        // Body: the trunk rises on the second half of the downstroke (lift peak) and sinks through the upstroke; it
        //    also pitches nose-up slightly as the wings sweep forward.
        const heave = down ? 0.030 * Math.sin(Math.PI * (s - 0.15)) : -0.026 * Math.sin(Math.PI * s);
        const surge = 0.010 * Math.cos(2 * Math.PI * p);
        const bodyPitch = down ? lerp(-2, 4, ease) : lerp(4, -2, ease);
        pose.Translate("root", [0, heave, surge]);
        pose.Set("root", bodyPitch, 0, 0);
        pose.Set("pelvis", -bodyPitch * 0.45, 0, 0);
        pose.Set("spine01", -bodyPitch * 0.20, 0, 0);
        pose.Set("spine02", -bodyPitch * 0.15, 0, 0);
        pose.Set("chest", bodyPitch * 0.25, 0, 0);

        // Head stabilisation: the neck cancels most of the trunk's pitch and heave so the eyes hold a fixed line.
        ApplyNeck(pose, 2.0 * Math.sin(2 * Math.PI * p + 1.1), -bodyPitch * 1.25 + 42, 0, -24,
            0, -bodyPitch * 0.35 - 54, 0);
        pose.Set("jaw", 1.5, 0, 0);

        // Tail: counter-phase pitch damps the trunk's bob, with a light fan for stability.
        ApplyTail(pose, 0.72, 0.1);
        pose.Set("tailBase", -bodyPitch * 0.8 + 2, 0, 0);

        pose.locomotion.speed = 11.0; pose.locomotion.altitude = 6.5; pose.locomotion.turnRate = 0.16;
        pose.locomotion.bank = -11; pose.locomotion.pitch = 3; pose.locomotion.grounded = false;
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      CLIP: GLIDE
//------------------------------------------------------------------------------------------------------------------------

const GlideCycle = {
    name: "Glide",
    duration: 9.0,
    detail: "wings held flat with a slight bow · slotted, upswept tips · thermal micro-corrections · tail fanned",

    Apply(pose, time, ctx)
    {
        const t = time;
        // Thermal turbulence: slow fractal gusts drive small, uncorrelated corrections at each wing.
        const gust = Fractal1(t * 0.38, 3);
        const gustL = Fractal1(t * 0.41 + 7.2, 3), gustR = Fractal1(t * 0.39 + 21.7, 3);
        const breathe = Math.sin(t * 1.35);

        for (const side of [1, -1])
        {
            const own = side > 0 ? gustL : gustR;
            ApplyWing(pose, side, {
                elevation: 5.5 + 3.2 * own + 0.8 * breathe,     // near-flat dihedral (bald eagles glide flat)
                sweep: -3 + 2.0 * gust,
                twist: -3 + 2.4 * own,                          // washout: tip runs at a lower incidence than the root
                elbow: 3 + 1.6 * own,
                wrist: 2 + 1.8 * own,
                wristDihedral: -2,
                hand: 0, digit: 0,
                alula: 3, alulaLift: 1,
            });

            // Loaded, upswept, widely slotted primaries — the signature of a soaring eagle's wingtip.
            ApplyRemiges(pose, side,
                (t2) => ({
                    twist: -lerp(2, 16, t2) + 2.5 * own,
                    spread: lerp(3, 15, t2),
                    bend: -lerp(3, 26, Math.pow(t2, 1.35)) - 2.0 * own * t2,
                }),
                (t2) => ({ twist: -2, spread: 2, bend: -lerp(3, 8, t2) + 0.8 * own }),
                () => ({ twist: 0, spread: 4, bend: 2 }));

            pose.SetSide("hip", side, -25, 0, 19);
            pose.SetSide("knee", side, 138, 0, 0);
            pose.SetSide("ankle", side, -52, 0, 0);
            pose.SetSide("foot", side, 56, 0, 0);
            ApplyToes(pose, side, 72, -6);
        }

        // Slow scan of the ground below: the head yaws and pitches independently of the body.
        const scan = Fractal1(t * 0.22 + 3.3, 2);
        ApplyNeck(pose, 16 * scan, 40 + 4 * Math.sin(t * 0.27), 3 * scan, -26, 12 * scan, -52 + 4 * scan, -4 * scan);

        pose.Set("root", 1.5 + 1.2 * gust, 0, 0);
        pose.Translate("root", [0, 0.012 * gust, 0]);
        ApplyTail(pose, 0.86, 0.15, 2 * gust);
        pose.Set("tailBase", -3 + 2.4 * gust, 1.5 * gust, 2 * gust);

        pose.locomotion.speed = 14.0; pose.locomotion.altitude = 9.0 + 0.9 * gust;
        pose.locomotion.turnRate = 0.10 + 0.05 * gust; pose.locomotion.bank = -13 - 4 * gust;
        pose.locomotion.pitch = -1.5; pose.locomotion.grounded = false;
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       CLIP: WALK
//------------------------------------------------------------------------------------------------------------------------

const WalkCycle = {
    name: "Ground walk",
    duration: 1.15,                              // [s] stride period
    detail: "0.30 m stride · 0.70 duty factor · lateral waddle · toe roll-off · wings folded, tail clear of the ground",

    Apply(pose, time, ctx)
    {
        const sk = pose.skeleton;
        const T = this.duration;
        const p = (time / T) % 1.0;
        const duty = 0.70;                       // fraction of the stride each foot is on the ground
        const stride = 0.30;                     // [m]
        const lift = 0.055;                      // [m] swing clearance

        for (const side of [1, -1])
        {
            const phase = (p + (side > 0 ? 0.0 : 0.5)) % 1.0;
            const stance = phase < duty;
            const u = stance ? phase / duty : (phase - duty) / (1 - duty);

            // Foot path in root space: pushed aft at constant speed while planted, then a fast lofted swing forward.
            const hip = sk.BindPosition("hip" + (side > 0 ? "L" : "R"));
            let z, y, curl, pitch;
            if (stance)
            {
                z = lerp(stride * 0.5, -stride * 0.5, u);
                y = 0.0;
                curl = 6 + 10 * smoothstep((u - 0.55) / 0.45);          // toes grip, then roll off
                pitch = lerp(-6, 16, smoothstep((u - 0.45) / 0.55)) * DEG;   // heel down → toe-off
            }
            else
            {
                const e = smoothstep(u);
                z = lerp(-stride * 0.5, stride * 0.5, e);
                y = lift * Math.sin(Math.PI * u) * (1.0 + 0.25 * Math.sin(Math.PI * u * 2.0));
                curl = 26 * Math.sin(Math.PI * u) + 4;                  // talons flex clear of the ground
                pitch = lerp(16, -8, smoothstep(clamp(u / 0.7, 0, 1))) * DEG;
            }

            const target = [hip[0], ctx.standHeight * -1.0 + y, hip[2] + z + 0.045];
            const femurSwing = (stance ? lerp(-8, 10, u) : lerp(10, -8, smoothstep(u))) * DEG;
            SolveLeg(pose, sk, side, target, femurSwing, pitch);
            ApplyToes(pose, side, curl, stance ? 4 : 1);
        }

        // Trunk: two vertical oscillations per stride (one per footfall), a lateral waddle toward the stance foot,
        //    matching roll, and a little yaw as the pelvis rotates over each leg.
        const bob = -0.016 * Math.cos(4 * Math.PI * p) - 0.004;
        const sway = 0.021 * Math.sin(2 * Math.PI * p);
        const roll = 6.5 * Math.sin(2 * Math.PI * p);
        const yaw = 3.0 * Math.sin(2 * Math.PI * p + 0.6);
        const pitchTrunk = 3.0 + 1.8 * Math.sin(4 * Math.PI * p + 1.2);
        pose.Translate("root", [sway, bob, 0]);
        pose.Set("root", pitchTrunk, yaw, roll);
        pose.Set("pelvis", -pitchTrunk * 0.3, -yaw * 0.4, -roll * 0.25);
        pose.Set("spine01", 0, -yaw * 0.2, -roll * 0.15);
        pose.Set("spine02", -1.5, 0, -roll * 0.1);

        // Head: eagles hold the skull remarkably still while the body rocks — the neck absorbs bob, sway and roll,
        //    with a small forward-back head bob at stride frequency.
        const bobHead = 5.0 * Math.sin(2 * Math.PI * p + Math.PI * 0.35);
        ApplyNeck(pose, -yaw * 1.15 + 3 * Math.sin(2 * Math.PI * p + 2.1), -pitchTrunk * 1.1 - 4 + bobHead * 0.5,
            -roll * 1.05, -6, -yaw * 0.3, 4 - bobHead * 0.35, -roll * 0.25);

        // Folded wings: humerus down and back, elbow and wrist fully flexed, primaries stacked over the tail.
        for (const side of [1, -1])
        {
            // The folded wing rides the trunk's roll: the carried wing settles a beat behind the body.
            const settle = 1.6 * Math.sin(2 * Math.PI * p + 1.9);
            ApplyFoldedWing(pose, side, {
                elevation: FoldedWing.elevation + settle - 1.0 * roll * side,
                sweep: FoldedWing.sweep - 0.6 * settle,
            });
        }

        ApplyTail(pose, 0.34, 0.0, 0);
        pose.Set("tailBase", -14 - pitchTrunk * 0.4, -yaw * 0.6, roll * 0.4);
        pose.Set("jaw", 0.5, 0, 0);

        pose.locomotion.speed = stride / T * 1.0; pose.locomotion.altitude = 0;
        pose.locomotion.turnRate = 0.08; pose.locomotion.bank = 0; pose.locomotion.pitch = 0;
        pose.locomotion.grounded = true;
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 PERCHED BASE (IDLE FAMILY)
//------------------------------------------------------------------------------------------------------------------------

// Shared standing posture used by idle, screech and head-turn: both feet planted, wings folded, tail down.
function ApplyPerched(pose, ctx, options = {})
{
    const sk = pose.skeleton;
    const shift = options.shift || 0;            // −1 … +1 weight shift between the feet
    const crouch = options.crouch || 0;          // [m] additional knee flexion

    for (const side of [1, -1])
    {
        const hip = sk.BindPosition("hip" + (side > 0 ? "L" : "R"));
        const loaded = 0.5 + 0.5 * shift * side;
        const target = [hip[0], -ctx.standHeight + crouch * 0.0, hip[2] + 0.045 + (options.stanceZ || 0)];
        SolveLeg(pose, sk, side, target, (-2 + 4 * (1 - loaded)) * DEG, (2 + 3 * loaded) * DEG);
        ApplyToes(pose, side, 16 + 8 * loaded, 5);
    }

    for (const side of [1, -1])
        ApplyFoldedWing(pose, side, options.wing || {}, options.ruffle || 0);

    ApplyTail(pose, options.tailFan !== undefined ? options.tailFan : 0.30, 0, 0);
    pose.Set("tailBase", -16, 0, 0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       CLIP: IDLE
//------------------------------------------------------------------------------------------------------------------------

const IdleCycle = {
    name: "Idle (perched)",
    duration: 12.0,
    detail: "breathing at 0.6 Hz · weight shifts · ocular saccades · periodic feather rouse · tail flick",

    Apply(pose, time, ctx)
    {
        const t = time;
        const breath = Math.sin(t * 2.0 * Math.PI * 0.6);                 // ≈ 36 breaths/min at rest
        const shift = 0.55 * Fractal1(t * 0.14, 2);
        ApplyPerched(pose, ctx, { shift });

        // Breathing moves the keel, not the whole bird: small translations along the trunk.
        pose.Translate("spine02", [0, 0.0032 * breath, 0.0016 * breath]);
        pose.Translate("spine01", [0, 0.0022 * breath, 0]);
        pose.Translate("root", [0.006 * shift, 0.004 * breath - 0.002, 0]);
        pose.Set("root", 1.2 + 0.5 * breath, 2.5 * shift, -3.0 * shift);
        pose.Set("pelvis", -0.6, -1.0 * shift, 1.2 * shift);

        // Head: slow drift plus quick saccades — eagles hold a pose, snap to a new one, hold again.
        const saccade = Math.round(t / 2.35);
        const holdPhase = clamp((t - saccade * 2.35) * 7.0, -1, 1);
        const targetYaw = 26 * Noise1(saccade * 3.1);
        const previousYaw = 26 * Noise1((saccade - 1) * 3.1);
        const yaw = lerp(previousYaw, targetYaw, smoothstep(holdPhase * 0.5 + 0.5));
        const targetPitch = 8 * Noise1(saccade * 7.7 + 2.0);
        const pitch = lerp(8 * Noise1((saccade - 1) * 7.7 + 2.0), targetPitch, smoothstep(holdPhase * 0.5 + 0.5));

        ApplyNeck(pose, yaw, -6 + pitch + 1.2 * breath, -0.25 * yaw, -2 + 1.0 * breath,
            yaw * 0.35, pitch * 0.5 + 2, -0.15 * yaw);
        pose.Set("jaw", 1.0 + 0.8 * Math.max(0, breath), 0, 0);

        // Rouse: every ~7 s the bird ruffles — feathers lift and shake, strongest over the mantle and tail.
        const rousePhase = (t % 7.4) / 7.4;
        const rouse = Math.exp(-Math.pow((rousePhase - 0.55) * 18.0, 2.0));
        ctx.ruffle = rouse;                        // consumed by DynamicsSolver as a feather excitation impulse
        if (rouse > 0.01)
        {
            const shake = Math.sin(t * 46.0) * rouse;
            pose.Set("root", 1.2 + 0.5 * breath + 1.6 * shake, 2.5 * shift + 3.0 * shake, -3.0 * shift + 2.2 * shake);
            for (const side of [1, -1])
                ApplyFoldedWing(pose, side, {
                    elevation: FoldedWing.elevation + 9 * rouse + 1.5 * shake,
                    sweep: FoldedWing.sweep - 7 * rouse,
                    elbow: FoldedWing.elbow - 10 * rouse,
                    alula: 4 + 12 * rouse, open: 0.45 * rouse,
                }, rouse);
            ApplyTail(pose, 0.30 + 0.45 * rouse, 0.2 * rouse, 3 * shake);
        }

        pose.locomotion.speed = 0; pose.locomotion.altitude = 0; pose.locomotion.turnRate = 0;
        pose.locomotion.bank = 0; pose.locomotion.pitch = 0; pose.locomotion.grounded = true;
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      CLIP: SCREECH
//------------------------------------------------------------------------------------------------------------------------

const ScreechCycle = {
    name: "Screech",
    duration: 4.2,
    detail: "wind-up · head thrown back · 5.5 Hz stuttered call with the gape open ~34° · throat pulse · wing flick",

    Apply(pose, time, ctx)
    {
        const t = time % this.duration;
        const windUp = smoothstep((t - 0.25) / 0.55);            // head draws back and down
        const call = clamp((t - 0.80) / 1.95, 0, 1);             // the vocal bout itself
        const calling = t > 0.80 && t < 2.75;
        const release = smoothstep((t - 2.85) / 0.75);
        const syllable = calling ? 0.5 + 0.5 * Math.sin(2 * Math.PI * 5.5 * (t - 0.80) - Math.PI * 0.5) : 0.0;
        const envelope = calling ? Math.sin(Math.PI * clamp(call, 0, 1)) : 0.0;

        ApplyPerched(pose, ctx, {
            shift: 0.1,
            tailFan: 0.10 + 0.45 * envelope,
            wing: {
                elevation: FoldedWing.elevation + 30 * envelope * (0.45 + 0.55 * syllable),
                sweep: FoldedWing.sweep - 18 * envelope,
                elbow: FoldedWing.elbow - 46 * envelope,
                wrist: FoldedWing.wrist - 30 * envelope,
                alula: 4 + 14 * envelope,
                open: 0.6 * envelope,
            },
        });

        // Body drives the call: the whole bird rocks forward and up with each syllable, the keel pumps air.
        const lean = 8 * windUp * (1 - release) + 7 * envelope * syllable;
        pose.Set("root", -lean * 0.35 + 2, 0, 0);
        pose.Translate("root", [0, 0.012 * envelope * syllable, 0.018 * windUp * (1 - release) + 0.010 * envelope * syllable]);
        pose.Translate("spine02", [0, 0.004 * envelope * syllable, 0.004 * envelope * syllable]);
        pose.Set("chest", 4 * envelope * syllable, 0, 0);

        // Neck: retracted on the wind-up, then extended and thrown up-and-back — the classic bald eagle posture.
        const throw_ = envelope * (0.55 + 0.45 * syllable);
        const neckPitch = lerp(-4, 16, windUp * (1 - release)) - 34 * throw_;
        const neckExtend = lerp(0, -14, windUp * (1 - release)) + 30 * throw_;
        ApplyNeck(pose, 2.0 * Math.sin(t * 3.1), neckPitch, 0, neckExtend, 0, -20 * throw_ + 6 * windUp, 0);

        // Gape: bald eagles call with the bill wide and the tongue raised; the jaw stutters with each syllable.
        const gape = 34 * envelope * (0.35 + 0.65 * syllable);
        pose.Set("jaw", -gape, 0, 0);

        ctx.ruffle = 0.35 * envelope * syllable;
        pose.locomotion.speed = 0; pose.locomotion.altitude = 0; pose.locomotion.turnRate = 0;
        pose.locomotion.bank = 0; pose.locomotion.pitch = 0; pose.locomotion.grounded = true;
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     CLIP: HEAD TURN
//------------------------------------------------------------------------------------------------------------------------

const HeadTurnCycle = {
    name: "Head turn",
    duration: 6.4,
    detail: "≈ 170° over 14 cervical vertebrae · counter-roll keeps the eyes level · hold, fixate, unwind",

    Apply(pose, time, ctx)
    {
        const t = time % this.duration;
        // Out → hold → back → settle. Birds move the head in fast steps with long fixations between them.
        const outward = smoothstep((t - 0.55) / 0.85);
        const back = smoothstep((t - 3.55) / 0.95);
        const amount = outward - back;                              // 0 … 1 … 0
        const overshoot = 1.0 + 0.06 * Math.sin(Math.PI * clamp((t - 0.55) / 0.85, 0, 1)) ;
        const turn = 170 * amount * overshoot;                      // [°] total yaw of the skull
        const fixate = amount > 0.9 ? 3.0 * Math.sin((t - 1.4) * 5.2) * Math.exp(-(t - 1.4) * 1.4) : 0.0;

        ApplyPerched(pose, ctx, { shift: 0.12 * amount });

        // The body barely moves; the cervical column does the work and the skull counter-rolls to hold the horizon.
        pose.Set("root", 1.2, -3.0 * amount, 1.5 * amount);
        pose.Set("pelvis", -0.5, 1.2 * amount, -0.8 * amount);

        const neckYaw = turn * 0.82;
        const headYaw = turn * 0.18 + fixate;
        ApplyNeck(pose, neckYaw, -5 - 6 * Math.sin(Math.PI * amount), -10 * amount, -3 + 6 * Math.sin(Math.PI * amount),
            headYaw, 2 + 4 * Math.sin(Math.PI * amount), 12 * amount);
        pose.Set("jaw", 1.0, 0, 0);

        ctx.ruffle = 0.10 * Math.max(0, Math.sin(Math.PI * amount) - 0.6);
        pose.locomotion.speed = 0; pose.locomotion.altitude = 0; pose.locomotion.turnRate = 0;
        pose.locomotion.bank = 0; pose.locomotion.pitch = 0; pose.locomotion.grounded = true;
    },
};

export const MotionLibrary = {
    flap: FlapCycle,
    glide: GlideCycle,
    walk: WalkCycle,
    idle: IdleCycle,
    screech: ScreechCycle,
    headTurn: HeadTurnCycle,
};

export const MotionOrder = ["flap", "glide", "walk", "idle", "screech", "headTurn"];

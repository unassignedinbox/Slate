//============================================================================================================================================
//                                                        EAGLESTRUCTURE.JS
//============================================================================================================================================
// 🧩 Procedural bald eagle body: every part is a closed, lofted 3-D solid skinned to SkeletonStructure — torso and
//    cervical column, skull with supraorbital ridge, hooked bill (upper mandible on the skull, lower on the jaw),
//    eyes, feathered tibiotarsi, scaled tarsi, anisodactyl feet with talons, the wing's arm flesh and propatagium,
//    and 260-odd individually modelled feathers: 10 primaries + 17 secondaries + 3 alula quills per wing, primary /
//    greater / median / lesser / marginal / underwing covert rows, scapulars, 12 rectrices and their coverts.
//
//    Side handling: geometry is authored once on the bird's LEFT using left-hand bind matrices; the right side is
//    emitted with mesh.SetMirror(-1) and right-side joint indices, which is an exact reflection across X = 0.

import { GeometryStructure, Surface, CatmullRom, CatmullRomTangent, SuperEllipse } from "./GeometryStructure.js";
import { AppendFeather, FeatherKind, Plumage, RemexColour, WhiteFeatherColour } from "./FeatherStructure.js";
import { SkeletonStructure, EagleSpecification } from "./SkeletonStructure.js";
import { V3, M4, Quat, DEG, clamp, lerp, smoothstep, Hash1, Noise1 } from "./MathSpecification.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                        LOFT UTILITIES
//------------------------------------------------------------------------------------------------------------------------

function Frame(tangent, reference = [0, 1, 0])
{
    const t = V3.normalize(tangent);
    let right = V3.cross(reference, t);
    if (V3.length(right) < 1e-5) right = V3.cross([0, 0, 1], t);
    right = V3.normalize(right);
    const up = V3.normalize(V3.cross(t, right));
    return { t, right, up };
}

// Lofts a closed tube through `sections`; each section supplies a frame, a profile(angle) → [across, up] and the
//    skinning bind + colour to use for its ring.
function LoftSections(mesh, sections, radial, surface, capStart, capEnd, uv = null)
{
    const first = mesh.vertexCount;
    const rings = [];
    for (const S of sections)
    {
        const ring = [];
        for (let i = 0; i < radial; ++i)
        {
            const angle = (i / radial) * Math.PI * 2.0;
            const [a, b] = S.profile(angle, i / radial);
            const p = V3.add(V3.add(S.centre, V3.scale(S.right, a)), V3.scale(S.up, b));
            const c = typeof S.colour === "function" ? S.colour(angle, i / radial) : S.colour;
            ring.push(mesh.Vertex(p, [0, 1, 0], c, S.bind, uv ? uv(S, angle) : [0, 0], S.surface !== undefined ? S.surface : surface));
        }
        rings.push(ring);
    }
    mesh.Stitch(rings, true);
    if (capStart) { const r = rings[0]; for (let i = 1; i + 1 < r.length; ++i) mesh.Triangle(r[0], r[i + 1], r[i]); }
    if (capEnd) { const r = rings[rings.length - 1]; for (let i = 1; i + 1 < r.length; ++i) mesh.Triangle(r[0], r[i], r[i + 1]); }
    mesh.SmoothNormals(first);
    return first;
}

// Tapered tube along a polyline, used for limb bones, toes and the tongue.
function LoftTube(mesh, points, radius, bind, colour, surface, radial = 10, capStart = true, capEnd = true, squash = 1.0)
{
    const sections = [];
    for (let i = 0; i < points.length; ++i)
    {
        const t = i / (points.length - 1);
        const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
        const frame = Frame(V3.sub(next, prev));
        const r = typeof radius === "function" ? radius(t) : radius;
        sections.push({
            centre: points[i], right: frame.right, up: frame.up,
            profile: (angle) => [Math.cos(angle) * r, Math.sin(angle) * r * squash],
            bind: typeof bind === "function" ? bind(t) : bind,
            colour: typeof colour === "function" ? ((a, u) => colour(t, a, u)) : colour,
        });
    }
    return LoftSections(mesh, sections, radial, surface, capStart, capEnd);
}

function ComposeFrame(position, euler)
{
    return M4.compose(position, Quat.fromEuler(euler[0], euler[1], euler[2]));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       EAGLE STRUCTURE
//------------------------------------------------------------------------------------------------------------------------

export class EagleStructure
{
    constructor()
    {
        this.skeleton = new SkeletonStructure();
        this.mesh = new GeometryStructure();
        const sk = this.skeleton;

        this.BuildTorso(sk);
        this.BuildHead(sk);
        this.BuildBill(sk);
        this.BuildEyes(sk);
        this.BuildTail(sk);
        for (const side of [1, -1])
        {
            this.mesh.SetMirror(side);
            this.BuildLeg(sk, side);
            this.BuildWingArm(sk, side);
            this.BuildWingFeathers(sk, side);
        }
        this.mesh.SetMirror(1);
        this.geometry = this.mesh.Finish();
    }

    // Joint index for a side-suffixed name; geometry always uses the LEFT bind matrices (see header).
    Side(sk, name, side) { return sk.Query(name + (side > 0 ? "L" : "R")); }
    LeftBind(sk, name) { return sk.BindMatrix(name + "L"); }
    LeftPosition(sk, name) { return sk.BindPosition(name + "L"); }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 TORSO + CERVICAL COLUMN
    //--------------------------------------------------------------------------------------------------------------------

    BuildTorso(sk)
    {
        const chain = ["tailBase", "pelvis", "spine01", "spine02", "chest", "neck01", "neck02", "neck03", "neck04", "neck05", "skull"];
        const points = chain.map((n) => sk.BindPosition(n));
        const joints = chain.map((n) => sk.Query(n));

        // t along the chain · dy body-axis drop · half width · half height · superellipse exponent · surface ruffle
        const stations = [
            [0.000, 0.006, 0.046, 0.042, 2.0, 0.6],
            [0.045, -0.002, 0.068, 0.068, 2.1, 0.8],
            [0.100, -0.012, 0.086, 0.094, 2.2, 1.0],
            [0.160, -0.019, 0.094, 0.112, 2.3, 1.0],
            [0.215, -0.024, 0.097, 0.124, 2.4, 1.0],
            [0.300, -0.030, 0.095, 0.134, 2.5, 1.0],
            [0.360, -0.028, 0.088, 0.128, 2.4, 1.0],
            [0.405, -0.020, 0.075, 0.108, 2.2, 0.9],
            [0.450, -0.010, 0.060, 0.078, 2.1, 1.1],
            [0.500, -0.004, 0.053, 0.060, 2.0, 1.2],
            [0.600, 0.000, 0.048, 0.051, 2.0, 1.1],
            [0.700, 0.000, 0.045, 0.047, 2.0, 1.0],
            [0.800, 0.000, 0.044, 0.047, 2.0, 1.0],
            [0.880, 0.000, 0.046, 0.050, 2.0, 0.9],
            [0.940, 0.000, 0.043, 0.047, 2.0, 0.6],
        ];

        const sections = stations.map(([t, dy, w, h, e, ruffle]) =>
        {
            const centre = V3.add(CatmullRom(points, t), [0, dy, 0]);
            const frame = Frame(CatmullRomTangent(points, t));
            const u = t * (chain.length - 1);
            const i0 = clamp(Math.floor(u), 0, chain.length - 2);
            const f = clamp(u - i0, 0, 1);
            const whiteness = smoothstep((u - 4.30) / 0.55);
            return {
                centre, right: frame.right, up: frame.up,
                bind: [[joints[i0], 1 - f], [joints[i0 + 1], f]],
                profile: (angle) =>
                {
                    const [a, b] = SuperEllipse(angle, w, h, e);
                    // Contour-feather relief: low-amplitude ripple so the silhouette is plumage, not a balloon.
                    const relief = 1.0 + 0.030 * ruffle * Noise1(angle * 2.7 + t * 31.0) + 0.018 * ruffle * Noise1(angle * 6.1 + t * 17.0);
                    return [a * relief, b * relief];
                },
                colour: (angle) =>
                {
                    const ragged = whiteness + 0.10 * Noise1(angle * 3.3 + 11.0) * (whiteness > 0.02 && whiteness < 0.98 ? 1 : 0);
                    const w1 = clamp(ragged, 0, 1);
                    const belly = clamp((-Math.sin(angle) - 0.25) / 0.75, 0, 1) * (1.0 - w1);
                    const base = V3.lerp(Plumage.darkBrown, Plumage.midBrown, belly * 0.55);
                    const tone = 0.88 + 0.22 * Hash1(angle * 17.0 + t * 53.0);
                    return V3.scale(V3.lerp(base, Plumage.white, w1), tone);
                },
            };
        });

        LoftSections(this.mesh, sections, 26, Surface.Skin, true, false);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                          SKULL
    //--------------------------------------------------------------------------------------------------------------------

    BuildHead(sk)
    {
        const skull = sk.Query("skull");
        const neck05 = sk.Query("neck05");
        const B = sk.BindMatrix("skull");

        // Skull-local z · centre y · half width · half height · exponent · skull weight
        const stations = [
            [-0.060, -0.004, 0.028, 0.032, 2.0, 0.25],
            [-0.042, -0.001, 0.040, 0.046, 2.2, 0.55],
            [-0.024, 0.001, 0.046, 0.051, 2.4, 0.85],
            [-0.008, 0.002, 0.048, 0.053, 2.6, 1.00],
            [0.006, 0.001, 0.047, 0.051, 2.8, 1.00],   // supraorbital ridge — the eagle's "scowl"
            [0.020, -0.003, 0.040, 0.045, 2.5, 1.00],
            [0.032, -0.007, 0.031, 0.037, 2.2, 1.00],
            [0.042, -0.010, 0.022, 0.028, 2.0, 1.00],
        ];

        const sections = stations.map(([z, cy, w, h, e, weight]) => ({
            centre: M4.transformPoint(B, [0, cy, z]),
            right: [1, 0, 0], up: [0, 1, 0],
            bind: [[skull, weight], [neck05, 1 - weight]],
            profile: (angle) =>
            {
                const [a, b] = SuperEllipse(angle, w, h, e);
                const relief = 1.0 + 0.026 * Noise1(angle * 3.1 + z * 90.0);
                return [a * relief, b * relief];
            },
            colour: (angle) =>
            {
                // White head; bare yellow lores in the wedge between eye and bill.
                const lore = clamp((z - 0.024) / 0.018, 0, 1) * clamp(1.0 - Math.abs(Math.sin(angle) + 0.15) * 1.8, 0, 1);
                const tone = 0.90 + 0.18 * Hash1(angle * 23.0 + z * 311.0);
                return V3.scale(V3.lerp(Plumage.white, Plumage.cereYellow, lore * 0.85), tone);
            },
        }));

        LoftSections(this.mesh, sections, 24, Surface.Skin, true, true);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                     BILL AND MOUTH
    //--------------------------------------------------------------------------------------------------------------------

    BuildBill(sk)
    {
        const skull = sk.Query("skull"), jaw = sk.Query("jaw");
        const B = sk.BindMatrix("skull");
        const mesh = this.mesh;

        // ── Upper mandible: deep base, culmen curving over to a strongly hooked, overhanging tip ──────────────────────
        const upper = [
            { z: 0.038, y: 0.014, w: 0.021, h: 0.033, cere: 1.0 },
            { z: 0.056, y: 0.013, w: 0.019, h: 0.032, cere: 0.6 },
            { z: 0.074, y: 0.008, w: 0.016, h: 0.030, cere: 0.0 },
            { z: 0.090, y: -0.001, w: 0.012, h: 0.027, cere: 0.0 },
            { z: 0.101, y: -0.014, w: 0.008, h: 0.022, cere: 0.0 },
            { z: 0.104, y: -0.028, w: 0.005, h: 0.015, cere: 0.0 },
            { z: 0.101, y: -0.037, w: 0.002, h: 0.006, cere: 0.0 },   // the hook curls back under
        ];
        LoftSections(mesh, upper.map((S) => ({
            centre: M4.transformPoint(B, [0, S.y - S.h * 0.42, S.z]),
            right: [1, 0, 0], up: [0, 1, 0],
            bind: [[skull, 1]],
            profile: (angle) =>
            {
                const [a, b] = SuperEllipse(angle, S.w, S.h * 0.5, 2.6);
                // Culmen ridge: sharpen the dorsal crest, flatten the tomial edge.
                const ridge = 1.0 + 0.12 * Math.max(0, Math.sin(angle));
                return [a, b * ridge];
            },
            colour: () => V3.lerp(Plumage.billYellow, Plumage.cereYellow, S.cere),
            surface: Surface.Keratin,
        })), 18, Surface.Keratin, true, true);

        // ── Lower mandible (bound to the jaw so it opens on the screech) ──────────────────────────────────────────────
        const lower = [
            { z: 0.038, y: -0.014, w: 0.019, h: 0.024 },
            { z: 0.058, y: -0.017, w: 0.017, h: 0.021 },
            { z: 0.076, y: -0.019, w: 0.013, h: 0.017 },
            { z: 0.090, y: -0.021, w: 0.009, h: 0.012 },
            { z: 0.098, y: -0.024, w: 0.004, h: 0.006 },
        ];
        LoftSections(mesh, lower.map((S) => ({
            centre: M4.transformPoint(B, [0, S.y, S.z]),
            right: [1, 0, 0], up: [0, 1, 0],
            bind: [[jaw, 1]],
            profile: (angle) => SuperEllipse(angle, S.w, S.h * 0.5, 2.4),
            colour: Plumage.billYellow,
            surface: Surface.Keratin,
        })), 16, Surface.Keratin, true, true);

        // ── Mouth lining: a flattened cavity spanning the gape so an open bill shows throat, not void ─────────────────
        const mouth = [
            { z: 0.030, w: 0.016, h: 0.012 },
            { z: 0.055, w: 0.014, h: 0.010 },
            { z: 0.080, w: 0.010, h: 0.007 },
            { z: 0.094, w: 0.004, h: 0.003 },
        ];
        LoftSections(mesh, mouth.map((S) => ({
            centre: M4.transformPoint(B, [0, -0.012, S.z]),
            right: [1, 0, 0], up: [0, 1, 0],
            bind: [[skull, 0.5], [jaw, 0.5]],
            profile: (angle) => SuperEllipse(angle, S.w, S.h, 2.0),
            colour: Plumage.tongue,
            surface: Surface.Cere,
        })), 12, Surface.Cere, true, true);

        // ── Tongue ────────────────────────────────────────────────────────────────────────────────────────────────────
        LoftTube(mesh,
            [0.040, 0.056, 0.070, 0.082].map((z) => M4.transformPoint(B, [0, -0.015 - (z - 0.04) * 0.05, z])),
            (t) => 0.0055 * (1.0 - 0.75 * t * t), [[jaw, 1]], Plumage.tongue, Surface.Cere, 8, true, true, 0.45);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                          EYES
    //--------------------------------------------------------------------------------------------------------------------

    BuildEyes(sk)
    {
        const skull = sk.Query("skull");
        const B = sk.BindMatrix("skull");
        const radius = 0.0104;                                        // [m] eagle eye ≈ 24 mm across
        for (const side of [1, -1])
        {
            const centre = M4.transformPoint(B, [side * 0.0335, 0.008, 0.015]);
            const gaze = V3.normalize([side * 0.60, 0.05, 0.80]);      // forward-lateral, ~40° binocular overlap
            const first = this.mesh.vertexCount;
            const rings = [];
            const R = 14, S = 10;
            for (let s = 0; s <= S; ++s)
            {
                const φ = (s / S) * Math.PI;
                const ring = [];
                for (let r = 0; r < R; ++r)
                {
                    const θ = (r / R) * Math.PI * 2.0;
                    const n = [Math.sin(φ) * Math.cos(θ), Math.cos(φ), Math.sin(φ) * Math.sin(θ)];
                    const p = V3.add(centre, V3.scale(n, radius));
                    const facing = V3.dot(n, gaze);
                    const pupil = smoothstep((facing - 0.80) / 0.12);
                    const iris = smoothstep((facing - 0.10) / 0.45);
                    const colour = V3.lerp(V3.lerp([0.35, 0.33, 0.30], Plumage.iris, iris), Plumage.pupil, pupil);
                    ring.push(this.mesh.Vertex(p, n, colour, [[skull, 1]], [0, 0], Surface.Eye));
                }
                rings.push(ring);
            }
            this.mesh.Stitch(rings, true);
            this.mesh.SmoothNormals(first);

            // Eyelid rim / orbital skin: a slightly larger dark ring flattened against the skull.
            const rim = [];
            const lidFrame = Frame(gaze);
            for (let i = 0; i < 2; ++i)
            {
                const push = -0.001 - i * 0.0035;
                rim.push({
                    centre: V3.add(centre, V3.scale(gaze, push)),
                    right: lidFrame.right, up: lidFrame.up,
                    bind: [[skull, 1]],
                    profile: (angle) =>
                    {
                        const r = radius * (1.03 + i * 0.30);
                        return [Math.cos(angle) * r * 1.05, Math.sin(angle) * r * (0.80 - 0.08 * i)];
                    },
                    colour: i === 0 ? [0.05, 0.045, 0.04] : V3.lerp([0.09, 0.07, 0.05], Plumage.white, i * 0.42),
                    surface: i === 0 ? Surface.Cere : Surface.Skin,
                });
            }
            LoftSections(this.mesh, rim, 16, Surface.Skin, false, false);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                     LEG AND FOOT
    //--------------------------------------------------------------------------------------------------------------------

    BuildLeg(sk, side)
    {
        const mesh = this.mesh;
        const hip = this.Side(sk, "hip", side), knee = this.Side(sk, "knee", side);
        const ankle = this.Side(sk, "ankle", side), foot = this.Side(sk, "foot", side);
        const pHip = this.LeftPosition(sk, "hip"), pKnee = this.LeftPosition(sk, "knee");
        const pAnkle = this.LeftPosition(sk, "ankle"), pFoot = this.LeftPosition(sk, "foot");

        // ── Feathered "trousers" over femur + tibiotarsus ─────────────────────────────────────────────────────────────
        LoftTube(mesh, [
            V3.lerp(pHip, pKnee, -0.15), pHip, V3.lerp(pHip, pKnee, 0.6), pKnee,
            V3.lerp(pKnee, pAnkle, 0.35), V3.lerp(pKnee, pAnkle, 0.7), V3.lerp(pKnee, pAnkle, 0.94),
        ],
            (t) => 0.060 - 0.038 * smoothstep((t - 0.22) / 0.78),
            (t) => (t < 0.35 ? [[hip, 1 - t / 0.35], [knee, t / 0.35]] : [[knee, 1 - (t - 0.35) / 0.65], [ankle, (t - 0.35) / 0.65]]),
            (t, angle) => V3.scale(V3.lerp(Plumage.midBrown, Plumage.darkBrown, clamp(t * 1.4, 0, 1)), 0.9 + 0.2 * Hash1(angle * 13.0 + t * 71.0)),
            Surface.Skin, 14, true, false);

        // ── Tarsometatarsus: bare, reticulate-scaled, chrome yellow ───────────────────────────────────────────────────
        LoftTube(mesh, [V3.lerp(pAnkle, pFoot, -0.02), V3.lerp(pAnkle, pFoot, 0.35), V3.lerp(pAnkle, pFoot, 0.72), pFoot],
            (t) => 0.019 - 0.005 * t, (t) => [[ankle, 1 - t], [foot, t]],
            Plumage.tarsusYellow, Surface.Keratin, 12, true, false);

        // ── Anisodactyl foot: hallux back, digits II–IV forward, each three phalanges plus a talon ────────────────────
        const toes = [
            { name: "hallux", yaw: 180 * DEG, length: 0.058, talon: 0.040, lift: 0.004 },
            { name: "toe2", yaw: -26 * DEG, length: 0.072, talon: 0.030, lift: 0.0 },
            { name: "toe3", yaw: 0 * DEG, length: 0.086, talon: 0.032, lift: 0.0 },
            { name: "toe4", yaw: 30 * DEG, length: 0.070, talon: 0.028, lift: 0.0 },
        ];
        for (const toe of toes)
        {
            const joint = this.Side(sk, toe.name, side);
            const dir = [Math.sin(toe.yaw), 0, Math.cos(toe.yaw)];
            const base = V3.add(pFoot, [0, -0.010, 0.004]);
            const points = [];
            const segments = 6;
            for (let i = 0; i <= segments; ++i)
            {
                const t = i / segments;
                // Toes arch over the perch: rise slightly, then settle to ground level at the tip.
                const y = -0.010 + 0.012 * Math.sin(Math.PI * t) - 0.012 * t + toe.lift;
                points.push(V3.add(base, [dir[0] * toe.length * t, y + 0.010, dir[2] * toe.length * t]));
            }
            LoftTube(mesh, points, (t) => 0.0135 - 0.0055 * t, [[joint, 1]],
                (t, angle) => V3.scale(Plumage.tarsusYellow, 0.86 + 0.20 * Hash1(Math.floor(t * 9.0) * 3.1 + angle * 5.0)),
                Surface.Keratin, 10, true, false);

            // Talon: a strongly curved, laterally compressed black claw.
            const tip = points[points.length - 1];
            const claw = [];
            const curl = 8;
            for (let i = 0; i <= curl; ++i)
            {
                const t = i / curl;
                const θ = t * 1.75;
                claw.push(V3.add(tip, [dir[0] * toe.talon * Math.sin(θ) * 0.9, -toe.talon * (1.0 - Math.cos(θ)) * 0.95, dir[2] * toe.talon * Math.sin(θ) * 0.9]));
            }
            LoftTube(mesh, claw, (t) => 0.0075 * (1.0 - t) + 0.0006, [[joint, 1]], Plumage.talonBlack, Surface.Talon, 9, true, true, 0.7);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              WING ARM FLESH + PROPATAGIUM
    //--------------------------------------------------------------------------------------------------------------------

    BuildWingArm(sk, side)
    {
        const mesh = this.mesh;
        const shoulder = this.Side(sk, "shoulder", side), elbow = this.Side(sk, "elbow", side);
        const wrist = this.Side(sk, "wrist", side), hand = this.Side(sk, "hand", side), digit = this.Side(sk, "digit", side);
        const pShoulder = this.LeftPosition(sk, "shoulder"), pElbow = this.LeftPosition(sk, "elbow");
        const pWrist = this.LeftPosition(sk, "wrist"), pHand = this.LeftPosition(sk, "hand"), pDigit = this.LeftPosition(sk, "digit");

        const spine = [V3.lerp(pShoulder, pElbow, -0.28), pShoulder, pElbow, pWrist, pHand, pDigit, V3.lerp(pHand, pDigit, 1.25)];
        const spanOf = (p) => p[0];
        const spanShoulder = spanOf(pShoulder), spanWrist = spanOf(pWrist), spanTip = spanOf(pDigit);

        const sections = [];
        const steps = 22;
        for (let i = 0; i <= steps; ++i)
        {
            const t = i / steps;
            const centre = CatmullRom(spine, t);
            const span = centre[0];
            const frame = { right: [1, 0, 0], up: [0, 1, 0] };

            // Propatagium: the elastic leading-edge fold from shoulder to wrist, deepest just outboard of the elbow.
            const patagiumT = clamp((span - spanShoulder) / (spanWrist - spanShoulder), 0, 1);
            const patagium = 0.082 * Math.pow(Math.sin(Math.PI * clamp(patagiumT, 0, 1)), 0.75);
            const armChord = lerp(0.062, 0.020, clamp((span - spanShoulder) / (spanTip - spanShoulder), 0, 1));
            const front = armChord * 0.45 + patagium;
            const back = armChord * 0.75;
            const thick = lerp(0.048, 0.010, clamp((span - spanShoulder) / (spanTip - spanShoulder), 0, 1)) * (span < spanShoulder ? 1.15 : 1.0);

            let bind;
            if (span <= spanShoulder) bind = [[shoulder, 0.75], [sk.Query("chest"), 0.25]];
            else if (span <= pElbow[0]) { const f = (span - spanShoulder) / (pElbow[0] - spanShoulder); bind = [[shoulder, 1 - f], [elbow, f]]; }
            else if (span <= spanWrist) { const f = (span - pElbow[0]) / (spanWrist - pElbow[0]); bind = [[elbow, 1 - f], [wrist, f]]; }
            else { const f = clamp((span - spanWrist) / (spanTip - spanWrist), 0, 1); bind = [[wrist, 1 - f], [hand, f * 0.7], [digit, f * 0.3]]; }

            sections.push({
                centre: V3.add(centre, [0, 0, (front - back) * 0.0]),
                right: frame.right, up: frame.up,
                bind,
                profile: (angle) =>
                {
                    // Aerofoil-ish: blunt leading edge (+Z), tapered trailing edge (−Z), flatter underside.
                    const c = Math.cos(angle), s = Math.sin(angle);
                    const chordHalf = c >= 0 ? front : back;
                    const z = Math.sign(c) * Math.pow(Math.abs(c), 0.85) * chordHalf;
                    const taper = 1.0 - 0.50 * clamp(-z / Math.max(back, 1e-4), 0, 1);
                    const y = Math.sign(s) * Math.pow(Math.abs(s), 1.25) * thick * (s >= 0 ? 0.55 : 0.42) * taper;
                    return [z, y];
                },
                colour: (angle) =>
                {
                    const under = Math.sin(angle) < -0.2;
                    const base = under ? Plumage.midBrown : Plumage.darkBrown;
                    return V3.scale(base, 0.9 + 0.2 * Hash1(angle * 9.0 + t * 43.0));
                },
            });
        }

        // The loft runs along +X, so swap the section basis: `right` carries chord (Z) and `up` carries thickness (Y).
        for (const S of sections) { S.right = [0, 0, 1]; S.up = [0, 1, 0]; }
        LoftSections(mesh, sections, 18, Surface.Skin, true, true);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                     WING PLUMAGE
    //--------------------------------------------------------------------------------------------------------------------

    BuildWingFeathers(sk, side)
    {
        const mesh = this.mesh;
        const S = EagleSpecification;

        // ── Primaries: longest at P8–P9 (0.46 m), P10 slightly shorter, P1 barely longer than the inner secondaries ──
        for (let i = 0; i < S.primaries; ++i)
        {
            const t = i / (S.primaries - 1);
            const length = lerp(0.285, 0.470, Math.sin(Math.PI * (0.18 + 0.72 * t))) * (i === S.primaries - 1 ? 0.93 : 1.0);
            AppendFeather(mesh, {
                joint: sk.Query(`primary${side > 0 ? "L" : "R"}${i}`),
                transform: sk.BindMatrix(`primaryL${i}`),
                length, kind: FeatherKind.Primary, droop: 0.085, sweep: 0.03, camber: 0.30,
                colour: RemexColour(Plumage.blackish), seed: 10 + i, stations: 17, across: 5,
            });
        }

        // ── Secondaries + tertials ────────────────────────────────────────────────────────────────────────────────────
        for (let i = 0; i < S.secondaries; ++i)
        {
            const t = i / (S.secondaries - 1);
            const length = lerp(0.320, 0.235, Math.pow(t, 0.8)) * (t > 0.82 ? lerp(1.0, 1.18, (t - 0.82) / 0.18) : 1.0);
            AppendFeather(mesh, {
                joint: sk.Query(`secondary${side > 0 ? "L" : "R"}${i}`),
                transform: sk.BindMatrix(`secondaryL${i}`),
                length, kind: FeatherKind.Secondary, droop: 0.10, sweep: 0.02, camber: 0.34,
                colour: RemexColour(Plumage.darkBrown), seed: 40 + i, stations: 13, across: 5,
            });
        }

        // ── Alula ─────────────────────────────────────────────────────────────────────────────────────────────────────
        for (let i = 0; i < S.alulaQuills; ++i)
        {
            AppendFeather(mesh, {
                joint: sk.Query(`alulaQuill${side > 0 ? "L" : "R"}${i}`),
                transform: sk.BindMatrix(`alulaQuillL${i}`),
                length: lerp(0.055, 0.092, i / (S.alulaQuills - 1)), kind: FeatherKind.Alula,
                droop: 0.10, sweep: 0.04, camber: 0.30, colour: RemexColour(Plumage.darkBrown),
                seed: 70 + i, stations: 9, across: 4,
            });
        }

        this.BuildCoverts(sk, side);
    }

    // Covert rows and scapulars: laid out by SkeletonStructure (one joint per feather, see BuildCovertRows) so the
    //    geometry here only has to grow the right feather on each joint. Every covert can therefore be re-aimed when
    //    the wing folds, and carries its own secondary motion.
    BuildCoverts(sk, side)
    {
        const mesh = this.mesh;
        const tones = [RemexColour(Plumage.darkBrown), RemexColour(Plumage.midBrown), RemexColour(Plumage.blackish),
                       WhiteFeatherColour(Plumage.white)];
        for (const plan of sk.featherPlan)
        {
            if (plan.row.startsWith("tailCovert")) continue;          // centre-line rows are emitted with the tail
            if (plan.side < 0) continue;                              // author the LEFT row, mirror it for the right
            const leftName = plan.name;
            const jointName = side > 0 ? leftName : leftName.replace(/L(\d+)$/, "R$1");
            AppendFeather(mesh, {
                joint: sk.Query(jointName),
                transform: sk.BindMatrix(leftName),
                length: plan.length, kind: FeatherKind.Covert,
                droop: plan.row === "scapular" ? 0.16 : 0.12, sweep: 0.05, camber: 0.40,
                colour: tones[plan.tone], seed: plan.seed, stations: 7, across: 4,
            });
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                       RECTRICES
    //--------------------------------------------------------------------------------------------------------------------

    BuildTail(sk)
    {
        const mesh = this.mesh;
        const tailBase = sk.Query("tailBase"), pelvis = sk.Query("pelvis");
        const pTail = sk.BindPosition("tailBase");

        for (let i = 0; i < EagleSpecification.rectrices; ++i)
        {
            const pairIndex = Math.floor(i / 2);
            AppendFeather(mesh, {
                joint: sk.Query(`rectrix${i}`),
                transform: sk.BindMatrix(`rectrix${i}`),
                length: lerp(0.300, 0.255, pairIndex / 5),       // central pair longest; tail 0.23–0.37 m in the wild
                kind: FeatherKind.Rectrix, droop: 0.055, sweep: 0.0, camber: 0.22,
                colour: WhiteFeatherColour(Plumage.white), seed: 1000 + i, stations: 13, across: 5,
            });
        }

        // Upper and lower tail coverts (white), hiding the rectrix calami — joints from SkeletonStructure.
        for (const plan of sk.featherPlan)
        {
            if (!plan.row.startsWith("tailCovert")) continue;
            AppendFeather(mesh, {
                joint: sk.Query(plan.name),
                transform: sk.BindMatrix(plan.name),
                length: plan.length, kind: FeatherKind.Covert, droop: 0.10, sweep: 0.03, camber: 0.32,
                colour: WhiteFeatherColour(plan.row === "tailCovertUpper" ? Plumage.white : Plumage.shadedWhite),
                seed: plan.seed, stations: 7, across: 4,
            });
        }
    }
}

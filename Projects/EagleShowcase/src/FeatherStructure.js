//============================================================================================================================================
//                                                       FEATHERSTRUCTURE.JS
//============================================================================================================================================
// 🧩 One pennaceous feather as a closed 3-D solid (never a card): tapered rachis ridge, asymmetric inner/outer vanes,
//    spanwise camber, a drooping and back-swept shaft, and — for primaries — the emargination (the notch on the outer
//    vane) that opens an eagle's slotted wingtip. Authored in the feather joint's local frame:
//        +X = rachis, from calamus (t = 0) to tip (t = 1)
//        +Z = outer/leading vane (narrow)   −Z = inner/trailing vane (wide)
//        +Y = dorsal (upper) surface
//    Vertices are bound rigidly to the feather's own joint, so all feather motion — spread, twist, flutter, lag — is
//    driven by that joint in MotionSequence/DynamicsSolver.

import { Surface } from "./GeometryStructure.js";
import { clamp, lerp, Hash1, M4 } from "./MathSpecification.js";

export const FeatherKind = {
    Primary: "primary",
    Secondary: "secondary",
    Rectrix: "rectrix",
    Covert: "covert",
    Alula: "alula",
    Contour: "contour",
};

// Half-widths [m] of the outer (leading) and inner (trailing) vane at station t, per feather class.
function VaneProfile(kind, t, length)
{
    const bell = Math.sin(Math.PI * Math.pow(clamp(t, 0, 1), 0.72));   // 0 at calamus, 0 at tip, fat in the middle
    switch (kind)
    {
        case FeatherKind.Primary:
        {
            // Outer vane narrow; emarginated (steps in) beyond ~62 % — this is what creates the wingtip slots.
            const notch = t > 0.62 ? lerp(1.0, 0.34, clamp((t - 0.62) / 0.16, 0, 1)) : 1.0;
            const outer = 0.030 * length * bell * notch;
            const inner = 0.098 * length * bell * (t > 0.80 ? lerp(1.0, 0.55, (t - 0.80) / 0.20) : 1.0);
            return [outer, inner];
        }
        case FeatherKind.Secondary:
            return [0.075 * length * bell, 0.115 * length * bell];
        case FeatherKind.Rectrix:
        {
            const square = t > 0.9 ? lerp(1.0, 0.85, (t - 0.9) / 0.1) : 1.0;  // rectrices end square, not pointed
            return [0.105 * length * bell * square, 0.125 * length * bell * square];
        }
        case FeatherKind.Alula:
            return [0.055 * length * bell, 0.130 * length * bell];
        case FeatherKind.Covert:
            return [0.150 * length * bell, 0.185 * length * bell];
        default:
            return [0.120 * length * bell, 0.150 * length * bell];
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        FEATHER MESH
//------------------------------------------------------------------------------------------------------------------------

// Appends a feather to `mesh`. Options:
//   joint      – skinning joint index (rigid bind)
//   length [m] – calamus → tip
//   kind       – FeatherKind
//   droop      – tip drop as a fraction of length (gravity + aerodynamic pre-curve)
//   sweep      – tip back-sweep as a fraction of length (toward −Z)
//   camber     – vane cup depth as a fraction of the vane half-width
//   colour(t, v, rng) → [r,g,b] linear albedo
//   seed       – decorrelates the procedural barb pattern between feathers
export function AppendFeather(mesh, options)
{
    const {
        joint, length, kind = FeatherKind.Secondary, droop = 0.10, sweep = 0.05,
        camber = 0.35, colour, seed = 0, stations = 15, across = 5, origin = [0, 0, 0],
        transform = null, bind = null,
    } = options;
    // Vertices must land in bind-world space (skinning is World·InverseBind·v), so the feather's local frame is
    //    carried in by `transform` — the bind matrix of its own joint, or a hand-placed frame for covert rows.
    const Place = transform ? (p) => M4.transformPoint(transform, p) : (p) => p;
    const Bind = bind || [[joint, 1]];

    const first = mesh.vertexCount;
    const rachisThickness = (kind === FeatherKind.Covert || kind === FeatherKind.Contour ? 0.0035 : 0.0055) * (0.4 + 0.6 * clamp(length / 0.42, 0, 1));
    const vaneThickness = 0.00035;
    const rings = [];

    for (let s = 0; s < stations; ++s)
    {
        const t = s / (stations - 1);
        const [outer, inner] = VaneProfile(kind, t, length);
        const maxHalf = Math.max(outer, inner, 1e-5);

        // Shaft centreline: runs out along +X, drooping and sweeping aft with a quadratic-in-t bend.
        const shaftX = t * length;
        const shaftY = -droop * length * t * t;
        const shaftZ = -sweep * length * t * t;
        const thickness = rachisThickness * Math.pow(1.0 - t, 0.65) + 0.0004;

        const ringTop = [], ringBottom = [];
        // Cross-section sampled from the outer edge, across the rachis, to the inner edge.
        const samples = [];
        for (let i = 0; i < across; ++i) samples.push(lerp(1.0, 0.0, i / (across - 1)));      // outer vane 1 → 0
        for (let i = 1; i <= across; ++i) samples.push(-lerp(0.0, 1.0, i / across));          // inner vane 0 → −1

        for (let i = 0; i < samples.length; ++i)
        {
            const u = samples[i];                                    // +1 outer edge … −1 inner edge
            const half = u >= 0 ? outer : inner;
            const z = shaftZ + u * half;
            const edgeFall = Math.pow(Math.abs(u), 2.0);
            const cup = -camber * maxHalf * edgeFall;                // vane cups downward toward both edges
            const rachis = Math.exp(-Math.pow(u * maxHalf / (rachisThickness * 1.4), 2.0));
            const halfThickness = vaneThickness + thickness * 0.5 * rachis;
            const y = shaftY + cup;
            const v = u;
            const c = colour ? colour(t, v, seed) : [0.06, 0.045, 0.035];
            ringTop.push(mesh.Vertex(Place([origin[0] + shaftX, origin[1] + y + halfThickness, origin[2] + z]), [0, 1, 0], c, Bind, [t, v], Surface.Feather));
            ringBottom.push(mesh.Vertex(Place([origin[0] + shaftX, origin[1] + y - halfThickness * (u === 0 ? 1 : 0.8), origin[2] + z]), [0, -1, 0], c, Bind, [t, v], Surface.Feather));
        }
        // Closed loop: outer→inner along the top, then back inner→outer along the underside.
        const loop = ringTop.concat(ringBottom.slice().reverse());
        rings.push(loop);
    }

    mesh.Stitch(rings, true);

    // Calamus cap (the quill root disappears into the skin, but the solid must be watertight).
    const base = rings[0];
    for (let i = 1; i + 1 < base.length; ++i) mesh.Triangle(base[0], base[i + 1], base[i]);
    const tip = rings[rings.length - 1];
    for (let i = 1; i + 1 < tip.length; ++i) mesh.Triangle(tip[0], tip[i], tip[i + 1]);

    mesh.SmoothNormals(first);
    return first;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PLUMAGE COLOURING
//------------------------------------------------------------------------------------------------------------------------

// Adult Haliaeetus leucocephalus: chocolate-brown body and wings, snow-white head/neck and tail, chrome-yellow bill,
//    cere and tarsi, black talons, pale straw iris. Values are linear Rec.709 reflectances.
export const Plumage = {
    darkBrown: [0.052, 0.038, 0.028],
    midBrown: [0.085, 0.062, 0.043],
    warmBrown: [0.110, 0.078, 0.050],
    blackish: [0.022, 0.019, 0.018],
    white: [0.780, 0.775, 0.755],
    shadedWhite: [0.520, 0.515, 0.500],
    billYellow: [0.640, 0.380, 0.035],
    cereYellow: [0.700, 0.430, 0.050],
    tarsusYellow: [0.600, 0.360, 0.040],
    talonBlack: [0.030, 0.029, 0.028],
    iris: [0.620, 0.540, 0.260],
    pupil: [0.010, 0.010, 0.010],
    tongue: [0.220, 0.090, 0.075],
};

// Brown remex: slightly paler along the rachis, darker toward the tip, with per-feather tonal jitter.
export function RemexColour(base = Plumage.darkBrown)
{
    return (t, v, seed) =>
    {
        const jitter = 0.86 + 0.28 * Hash1(seed * 3.77 + 1.3);
        const shaft = 1.0 + 0.55 * Math.exp(-Math.pow(v / 0.10, 2.0));
        const tipDark = lerp(1.06, 0.72, clamp((t - 0.45) / 0.55, 0, 1));
        const k = jitter * shaft * tipDark;
        return [base[0] * k, base[1] * k, base[2] * k];
    };
}

// White rectrix / head feather: near-white with a faint warm shaft and a hint of grey in the vane roots.
export function WhiteFeatherColour(base = Plumage.white)
{
    return (t, v, seed) =>
    {
        const jitter = 0.94 + 0.10 * Hash1(seed * 7.13 + 4.1);
        const root = lerp(0.72, 1.0, clamp(t / 0.30, 0, 1));
        const shaft = 1.0 + 0.05 * Math.exp(-Math.pow(v / 0.12, 2.0));
        const k = jitter * root * shaft;
        return [base[0] * k, base[1] * k, base[2] * k];
    };
}

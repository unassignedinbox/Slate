//============================================================================================================================================
// 📦 Editor/RoadEditor/Presentation/RoadMaterial.js — One shader for every paved surface in the world
//============================================================================================================================================
// The whole road network — asphalt, setts, kerbs, brick, ballast, water, painted markings, hatched areas, junction legends — is a single
//    ShaderMaterial reading the packed streams MeshSink writes. Nothing is baked into a texture: material identity comes from a 24-entry uniform
//    table, pattern detail from value noise on the (s,t) station frame, and markings from the band-edge distances, so a 130 mm line is crisp at any
//    zoom because it is an analytic distance test with an fwidth-derived feather, not a texel. Symbols and words are the one atlas lookup.
'use strict';

import * as THREE from 'three';
import { MAT, MAT_COLOR, MARK, SYM, TINT } from '../Kernel/ProfileSolver.js';
import { FLAG } from '../Kernel/MeshSink.js';
import { ATLAS_GRID } from './Atlas.js';

const NMAT = 24, NTINT = 7;

/** roughness, specular strength, grain, wear, joint/relief frequency, relief bias */
const MAT_PARAM = (() => {
    const t = new Array(NMAT).fill(null).map(() => [0.86, 0.05, 0.5, 0.25, 1.0, 0.0]);
    const set = (id, v) => { t[MAT[id]] = v; };
    set('ASPHALT', [0.82, 0.08, 0.55, 0.5, 1, 0]);
    set('ASPHALT_OLD', [0.9, 0.04, 0.9, 0.9, 1, -0.03]);
    set('CONCRETE', [0.72, 0.12, 0.28, 0.2, 0.5, 0.01]);
    set('CONCRETE_SLAB', [0.68, 0.16, 0.3, 0.25, 1, 0.02]);
    set('BRICK', [0.78, 0.1, 0.55, 0.4, 1, 0]);
    set('BRICK_RUNNING', [0.78, 0.1, 0.5, 0.4, 1, -0.01]);
    set('COBBLE', [0.62, 0.24, 0.95, 0.35, 1, 0.03]);
    set('CURB', [0.66, 0.14, 0.35, 0.2, 0.6, 0.01]);
    set('GRAVEL', [0.95, 0.02, 1.0, 0.15, 2.2, -0.02]);
    set('GRASS', [0.96, 0.02, 0.8, 0.1, 1.6, 0]);
    set('PAVER', [0.7, 0.12, 0.45, 0.3, 1, 0.01]);
    set('TILE', [0.55, 0.2, 0.3, 0.2, 1, 0.02]);
    set('STEEL', [0.16, 0.85, 0.2, 0.1, 1, 0.05]);
    set('GRATE', [0.5, 0.2, 0.4, 0.2, 1, -0.05]);
    set('DIRT', [0.94, 0.02, 0.85, 0.2, 1.4, -0.01]);
    set('WATER', [0.1, 0.6, 0.4, 0.05, 1, 0]);
    set('RUBBER', [0.9, 0.03, 0.35, 0.15, 2, -0.01]);
    set('OXIDE', [0.8, 0.07, 0.4, 0.3, 1.4, 0]);
    set('PATCH', [0.88, 0.05, 0.7, 0.6, 1, -0.02]);
    set('TIMBER', [0.7, 0.06, 0.4, 0.25, 1, 0.01]);
    set('BALLAST', [0.97, 0.02, 1.0, 0.2, 2.6, -0.02]);
    set('TARMAC', [0.8, 0.08, 0.45, 0.3, 1.2, 0]);
    set('BRICK_RED', [0.76, 0.1, 0.55, 0.4, 1, 0]);
    set('STONE_SETT', [0.66, 0.18, 0.9, 0.35, 1, 0.02]);
    return t;
})();

const hex = (c) => new THREE.Color(c);

export function matPalette() {
    const col = new Float32Array(NMAT * 3), par = new Float32Array(NMAT * 4);
    for (let i = 0; i < NMAT; ++i) {
        const c = hex(MAT_COLOR[i] || '#888888');
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        const p = MAT_PARAM[i];
        par[i * 4] = p[0]; par[i * 4 + 1] = p[1]; par[i * 4 + 2] = p[2]; par[i * 4 + 3] = p[3];
    }
    return { col, par };
}

export function tintPalette() {
    const t = new Float32Array(NTINT * 4);
    const list = [
        [0, 0, 0, 0],
        [0.13, 0.34, 0.22, 0.85],       // cycle green
        [0.44, 0.1, 0.08, 0.85],         // cycle red
        [0.42, 0.12, 0.09, 0.9],         // bus red / oxide
        [0.3, 0.31, 0.33, 0.6],          // parking grey
        [0.55, 0.5, 0.42, 0.55],         // warm concrete
        [0.1, 0.16, 0.3, 0.7],           // blue asphalt
    ];
    for (let i = 0; i < NTINT; ++i) t.set(list[i], i * 4);
    return t;
}

// modelMatrix/viewMatrix/projectionMatrix/cameraPosition and `position` come from three's own prefix — redeclaring them is a compile error.
const VERT = /* glsl */`
in vec2 aST;
in vec4 aDist;
in vec4 aMisc;
in vec4 aMark;
in float aBump;
out vec3 vWorld;
out vec2 vST;
out vec4 vDist;
flat out vec4 vMisc;
flat out vec4 vMark;
out float vBump;
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vST = aST; vDist = aDist; vMisc = aMisc; vMark = aMark; vBump = aBump;
    gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
#define NMAT ${NMAT}
#define GRID ${ATLAS_GRID}.0
#define LEG_LEN 5.4
precision highp float;
in vec3 vWorld;
in vec2 vST;
in vec4 vDist;
flat in vec4 vMisc;
flat in vec4 vMark;
in float vBump;

uniform vec3 uMatColor[NMAT];
uniform vec4 uMatParam[NMAT];
uniform vec4 uTint[7];
uniform sampler2D uSymbols;
uniform vec3 uSunDir, uSunColor, uAmbTop, uAmbBottom, uFogColor, uNight;
uniform vec4 uFog;              // density, 0, 0, camera near hint
uniform float uMarkings, uWet, uTime, uDetail, uXray;

float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45);
    return fract(p.x * p.y);
}
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 3; ++k) { v += a * vnoise(p); p *= 2.13; a *= 0.5; } return v; }
float band(float x, float a, float b, float aa) { return clamp(smoothstep(a - aa, a + aa, x) - smoothstep(b - aa, b + aa, x), 0.0, 1.0); }
bool sbit(float v, float bit) { return mod(floor(v / bit), 2.0) > 0.5; }

vec3 pattern(int m, vec2 st, float tc, float halfW, out float relief, out float micro) {
    relief = 0.0; micro = 0.0;
    vec2 p = st;
    if (m == ${MAT.ASPHALT} || m == ${MAT.ASPHALT_OLD}) {
        float g = fbm(p * 0.9) * 0.6 + vnoise(p * 9.0) * 0.4;
        micro = g;
        float agg = step(0.86, vnoise(p * 34.0)) * 0.5;
        relief = -agg * 0.4;
        vec3 c = uMatColor[m] * (0.86 + g * 0.3);
        // wheel tracks polish and bleed bitumen; the outer metre stays rough and dark
        float track = smoothstep(1.05, 1.75, abs(tc)) * (1.0 - smoothstep(2.0, 2.9, abs(tc)));
        c *= mix(1.0, 0.82, track * 0.85);
        c = mix(c, c * 1.25, agg * 0.4);
        return c;
    }
    if (m == ${MAT.CONCRETE} || m == ${MAT.CONCRETE_SLAB} || m == ${MAT.CURB}) {
        float slab = (m == ${MAT.CONCRETE}) ? 0.0 : 1.0;
        vec2 q = vec2(p.x, tc);
        float joint = slab > 0.5 ? max(band(abs(fract(q.x / 4.5) - 0.5) * 4.5, 0.0, 0.035, 0.02),
                                      band(abs(fract(q.y / 4.0) - 0.5) * 4.0, 0.0, 0.03, 0.02)) : 0.0;
        float g = fbm(p * 2.2) * 0.35 + vnoise(p * 16.0) * 0.2;
        micro = g; relief = -joint * 0.5;
        return uMatColor[m] * (0.92 + g * 0.22) * (1.0 - joint * 0.45);
    }
    if (m == ${MAT.BRICK} || m == ${MAT.BRICK_RUNNING} || m == ${MAT.BRICK_RED} || m == ${MAT.PAVER} || m == ${MAT.TILE}) {
        float bw = (m == ${MAT.TILE}) ? 0.42 : 0.21, bh = (m == ${MAT.TILE}) ? 0.42 : 0.105;
        float rot = (m == ${MAT.TILE}) ? 0.7854 : 0.0;
        float cs = cos(rot), sn = sin(rot);
        vec2 r = vec2(p.x * cs - tc * sn, p.x * sn + tc * cs);
        float row = floor(r.y / bh);
        float off = (m == ${MAT.BRICK_RUNNING}) ? 0.5 * bw : mod(row, 2.0) * 0.5 * bw;
        vec2 cell = vec2(floor((r.x - off) / bw), row);
        float jx = abs(fract((r.x - off) / bw) - 0.5) * bw;
        float jy = abs(fract(r.y / bh) - 0.5) * bh;
        float mortar = 1.0 - band(max(jx, jy) * 2.0, 0.0, bw * 0.42, 0.012);
        float jitter = hash21(cell * 7.13);
        micro = jitter;
        relief = mortar * 0.55 + (jitter - 0.5) * 0.25;
        vec3 base = uMatColor[m];
        vec3 c = base * (0.8 + jitter * 0.45);
        return mix(c * 0.62, c, clamp(mortar + 0.35, 0.0, 1.0));
    }
    if (m == ${MAT.COBBLE} || m == ${MAT.STONE_SETT}) {
        float w = (m == ${MAT.COBBLE}) ? 0.17 : 0.24;
        vec2 q = vec2(p.x, tc);
        float row = floor(q.y / w);
        vec2 c2 = vec2(floor((q.x + mod(row, 2.0) * 0.5 * w) / w), row);
        vec2 f = fract(vec2(q.x / w + mod(row, 2.0) * 0.5, q.y / w)) - 0.5;
        float d = length(f * vec2(1.0, 1.15));
        float dome = smoothstep(0.34, 0.16, d);
        float jit = hash21(c2 * 3.71);
        micro = jit;
        relief = (dome - 0.5) * 1.6 + jit * 0.2;
        vec3 base = uMatColor[m] * (0.62 + jit * 0.6);
        return base * (0.7 + dome * 0.6);
    }
    if (m == ${MAT.GRASS}) {
        float g = fbm(p * 1.7) * 0.7 + vnoise(p * 22.0) * 0.3;
        float clump = smoothstep(0.45, 0.85, vnoise(p * 0.35));
        micro = g; relief = -clump * 0.2;
        return uMatColor[m] * (0.72 + g * 0.5) * mix(1.0, 1.18, clump);
    }
    if (m == ${MAT.GRAVEL} || m == ${MAT.BALLAST}) {
        float g = fbm(p * (m == ${MAT.BALLAST} ? 7.0 : 12.0));
        float stone = step(0.55, vnoise(p * 26.0));
        micro = g; relief = (stone - 0.5) * 0.9;
        return uMatColor[m] * (0.72 + g * 0.6);
    }
    if (m == ${MAT.DIRT} || m == ${MAT.PATCH}) {
        float g = fbm(p * 3.0);
        micro = g;
        return uMatColor[m] * (0.8 + g * 0.45);
    }
    if (m == ${MAT.STEEL}) {
        micro = 0.0;
        relief = 0.0;
        return uMatColor[m] * (1.0 + 0.25 * sin(tc * 90.0));
    }
    if (m == ${MAT.GRATE}) {
        vec2 q = fract(vec2(p.x, tc) * 6.0);
        float hole = step(0.22, q.x) * step(0.22, q.y) * (1.0 - step(0.78, q.x)) * (1.0 - step(0.78, q.y));
        micro = hole; relief = -hole;
        return mix(uMatColor[m] * 0.35, uMatColor[m], hole * 0.4 + 0.4);
    }
    if (m == ${MAT.WATER}) {
        float w1 = sin(p.x * 0.7 + uTime * 0.8 + sin(tc * 1.3) * 1.2) * 0.5 + 0.5;
        float w2 = vnoise(vec2(p.x * 0.55 - uTime * 0.22, tc * 1.7 + uTime * 0.11));
        micro = w1 * 0.4 + w2 * 0.6;
        relief = (w1 - 0.5) * 0.5 + (w2 - 0.5) * 0.7;
        return uMatColor[m] * (0.72 + w1 * 0.3 + w2 * 0.35);
    }
    if (m == ${MAT.RUBBER} || m == ${MAT.OXIDE} || m == ${MAT.TARMAC}) {
        float g = fbm(p * 6.0) * 0.5 + vnoise(p * 24.0) * 0.5;
        micro = g;
        return uMatColor[m] * (0.85 + g * 0.3);
    }
    if (m == ${MAT.TIMBER}) {
        float g = vnoise(vec2(p.x * 0.6, tc * 26.0));
        float plank = band(abs(fract(p.x / 0.16) - 0.5) * 0.16, 0.0, 0.01, 0.005);
        micro = g; relief = -plank * 0.4;
        return uMatColor[m] * (0.8 + g * 0.4) * (1.0 - plank * 0.4);
    }
    return uMatColor[m];
}

// Marking code → coverage. Lines ride the band edge (d), legends use the symbol atlas (legend).
float edgeMark(int code, float d, float s, float tc, float dEnd, float halfW, float period, out vec3 col) {
    col = vec3(0.92, 0.92, 0.88);
    float aa = max(fwidth(d) * 0.9, 0.0015);
    if (code == ${MARK.NONE}) return 0.0;
    if (code == ${MARK.SOLID_W} || code == ${MARK.LANE_W}) {
        float w = code == ${MARK.LANE_W} ? 0.12 : 0.065;
        return band(d, 0.0, w, aa);
    }
    if (code == ${MARK.FOG_W}) return band(d, 0.0, 0.075, aa) * 0.85;
    if (code == ${MARK.SOLID_Y}) { col = vec3(0.92, 0.75, 0.13); return band(d, 0.0, 0.065, aa); }
    if (code == ${MARK.GUTTER_Y}) { col = vec3(0.92, 0.75, 0.13); return band(d, 0.0, 0.09, aa) * 0.8; }
    if (code == ${MARK.EDGE_Y}) { col = vec3(0.92, 0.75, 0.13); return band(d, 0.0, 0.1, aa); }
    if (code == ${MARK.DOUBLEDASH_Y} || code == ${MARK.DOUBLE_Y}) {
        col = code == ${MARK.DOUBLEDASH_Y} ? vec3(0.92, 0.75, 0.13) : col;
        float dash = code == ${MARK.DOUBLEDASH_Y} ? step(0.55, fract(s / max(period, 2.0))) : 1.0;
        float l1 = band(d, 0.02, 0.08, aa), l2 = band(d, 0.16, 0.22, aa);
        if (code == ${MARK.DOUBLE_Y}) { col = vec3(0.92, 0.75, 0.13); }
        return max(l1, l2 * dash);
    }
    if (code == ${MARK.DASH_W} || code == ${MARK.DASH_Y}) {
        if (code == ${MARK.DASH_Y}) col = vec3(0.92, 0.75, 0.13);
        return band(d, 0.0, 0.065, aa) * step(fract(s / max(period, 2.0)), 0.34);
    }
    if (code == ${MARK.RUMBLE}) {
        float n = band(fract(s / 0.32), 0.0, 0.55, aa * 2.0);
        col = vec3(0.9, 0.9, 0.86);
        return band(d, 0.0, min(halfW, 0.5), aa) * n;
    }
    if (code == ${MARK.CHEVRON} || code == ${MARK.CHEVRON_DOWN}) {
        float k = code == ${MARK.CHEVRON_DOWN} ? -1.0 : 1.0;
        float h = fract((s * 0.5 + tc * k * 0.9) / 1.6);
        float stripe = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.42, 0.54, h));
        return clamp(stripe, 0.0, 1.0) * 0.9;
    }
    if (code == ${MARK.HATCH}) {
        float h = fract((s * 0.6 + tc * 1.0) / 1.1);
        float stripe = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.5, 0.6, h));
        float border = max(band(d, 0.0, 0.11, aa), band(abs(halfW * 2.0 - d), 0.0, 0.11, aa));
        return clamp(stripe * 0.75 + border, 0.0, 1.0);
    }
    if (code == ${MARK.PARKBAY}) {
        float bay = band(fract(s / 6.1), 0.0, 0.022, aa);
        float edge = band(d, 0.0, 0.055, aa);
        float nose = step(0.86, fract(s / 6.1)) * band(d, 0.0, 0.42, aa);
        return max(max(bay, edge) * 0.9, nose * 0.5);
    }
    if (code == ${MARK.CROSSWALK}) {
        float near = 1.0 - smoothstep(2.2, 5.0, dEnd);
        float bar = band(abs(fract(tc / 0.55) - 0.5) * 0.55, 0.0, 0.16, aa * 1.4);
        return bar * near * step(0.3, halfW);
    }
    if (code == ${MARK.STOP}) {
        float near = band(dEnd, 4.2, 4.62, 0.06);
        return near;
    }
    if (code == ${MARK.DOOR}) {
        float h = fract(s / 4.4);
        float stripe = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.34, 0.42, h));
        return stripe * band(d, 0.0, min(halfW, 0.55), aa) * 0.7;
    }
    if (code == ${MARK.REV}) {
        float h = fract((s + tc) / 2.2);
        return smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.45, 0.55, h)) * 0.8;
    }
    return 0.0;
}

float legendCell(int code) {
    if (code == ${MARK.BIKE}) return ${SYM.BIKE}.0;
    if (code == ${MARK.BUS}) return ${SYM.BUS}.0;
    if (code == ${MARK.TAXI}) return ${SYM.TAXI}.0;
    if (code == ${MARK.TRAM}) return ${SYM.TRAM}.0;
    if (code == ${MARK.SLOW}) return ${SYM.SLOW}.0;
    if (code == ${MARK.SCHOOLSLOW}) return ${SYM.SLOW}.0;
    if (code == ${MARK.STOPWORD}) return ${SYM.STOPWORD}.0;
    if (code == ${MARK.RXR}) return ${SYM.RXR}.0;
    return -1.0;
}

void main() {
    int m = int(vMisc.x + 0.5);
    int tintId = int(vMisc.y + 0.5);
    int symId = int(vMisc.z + 0.5);
    int flags = int(vMisc.w + 0.5);
    int c0 = int(vMark.x + 0.5), c1 = int(vMark.y + 0.5);
    float period = max(vMark.z, 2.0);
    float sf = vMark.w;
    vec3 P = vWorld;
    vec3 N = cross(dFdx(P), dFdy(P));
    float nl = max(length(N), 1e-6);
    N /= nl;
    if (!gl_FrontFacing) N = -N;

    float halfW = (vDist.x + vDist.y) * 0.5;
    float tc = (vDist.x - vDist.y) * 0.5;
    float s = vST.x;
    vec4 mp = uMatParam[m];
    float relief, micro;
    vec3 base = pattern(m, vec2(s, vST.y), tc, max(halfW, 0.001), relief, micro);

    // A two-way carriageway carries traffic in both directions, so "approach" means the end the traffic is heading for:
    //    right-hand bands flow to B, left-hand bands to A, and a one-way carriageway always flows to B (FLAG.ONEWAY).
    bool leftBand = sbit(sf, 4.0);
    bool oneWay = sbit(float(flags), 128.0);
    float approach = (leftBand && !oneWay) ? vDist.z : vDist.w;
    float dApp = approach;

    float paint = 0.0;
    vec3 paintCol = vec3(0.92);
    if (uMarkings > 0.5) {
        vec3 cc;
        float cov0 = edgeMark(c0, vDist.x, s, tc, dApp, halfW, period, paintCol);
        float cov1 = edgeMark(c1, vDist.y, s, -tc, dApp, halfW, period, cc);
        paint = max(paint, cov0);
        if (cov1 > paint) { paint = cov1; paintCol = cc; }
        // centre legend: an atlas cell painted at the band middle, once per period, on the approach when flagged
        int legend = symId > 0 ? symId : int(legendCell(max(c0, c1)));
        if (legend > 0) {
            float nearOk = sbit(sf, 1.0) ? 1.0 - smoothstep(23.0, 29.0, approach) : 1.0;
            float k = fract(s / period) * period / LEG_LEN;
            if (k < 1.0) {
                vec2 cellXY = vec2(mod(float(legend), GRID), floor(float(legend) / GRID));
                vec2 uv = vec2(0.5 + tc / 3.1, k);
                vec4 a = texture(uSymbols, vec2((cellXY.x + uv.x) / GRID, 1.0 - (cellXY.y + 1.0 - uv.y) / GRID));
                paint = max(paint, a.a * nearOk * smoothstep(0.0, 0.05, halfW));
            }
        }
    }
    if (tintId > 0) {
        vec4 t = uTint[tintId];
        base = mix(base, t.rgb, t.a * 0.92);
    }
    base = mix(base, paintCol * (0.86 + micro * 0.25), paint * (0.82 - uWet * 0.12));

    // humps: painted crest chevrons come from geometry height, not from a flag, so a hand-placed bump paints itself
    float bumpPaint = smoothstep(0.02, 0.06, vBump);
    if (uMarkings > 0.5) {
        float h = fract((s * 0.5 + abs(tc) * 0.6) / 0.75);
        paint = max(paint, smoothstep(0.0, 0.14, h) * (1.0 - smoothstep(0.4, 0.54, h)) * bumpPaint);
    }

    float aaLight = max(dot(N, uSunDir), 0.0);
    float sky = 0.5 + 0.5 * N.y;
    vec3 amb = mix(uAmbBottom, uAmbTop, sky);
    vec3 col = base * (amb + uSunColor * aaLight * (0.85 - mp.x * 0.25));
    vec3 V = normalize(cameraPosition - P);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), mix(18.0, 140.0, 1.0 - mp.x)) * mp.y * (1.0 + uWet * 2.2);
    col += uSunColor * spec;
    col += base * smoothstep(0.5, 1.0, -N.y) * 0.06;                       // underside of a kerb face picks up bounce, not black
    float crevice = 1.0 - smoothstep(0.0, 0.35, min(vDist.x, vDist.y)) * 0.22;
    col *= mix(1.0, crevice, step(0.5, float(m != ${MAT.STEEL})));
    col *= 1.0 - relief * 0.14 * uDetail;
    col = mix(col, col * 0.72, uWet * 0.35);
    if (mod(float(flags), 16.0) >= 8.0) col += vec3(1.0, 0.86, 0.6) * uNight.x * 0.55;   // FLAG.LIT: tunnel and deck strips
    // X-ray: buried work is invisible in normal view (it is only ever z-fighting with the ground it is under) and the surface ghosts when on.
    bool under = (int(flags) & ${FLAG.UNDER}) != 0;
    if (uXray < 0.5) { if (under) discard; }
    else if (!under) col = mix(col, uFogColor, 0.74);
    float dist = length(cameraPosition - P);
    col = mix(col, uFogColor, clamp(1.0 - exp(-pow(dist * uFog.x, 2.0)), 0.0, 1.0));
    col = max(col, 0.0);
    col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), col));
    gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * @param {{symbols?: HTMLCanvasElement, markings?: number, lighting: object}} opts
 * @returns {THREE.ShaderMaterial}
 */
export function createRoadMaterial(opts = {}) {
    const { col, par } = matPalette();
    const pal = new Float32Array(NMAT * 4);
    for (let i = 0; i < NMAT; ++i) pal.set(MAT_PARAM[i], i * 4);
    const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.FrontSide,
        uniforms: {
            uMatColor: { value: col },
            uMatParam: { value: pal },
            uTint: { value: tintPalette() },
            uSymbols: { value: null },
            uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
            uSunColor: { value: new THREE.Color(0xfff2dc) },
            uAmbTop: { value: new THREE.Color(0x6b7d94) },
            uAmbBottom: { value: new THREE.Color(0x2b2f36) },
            uFogColor: { value: new THREE.Color(0x9fb0bd) },
            uFog: { value: new THREE.Vector4(0.0016, 0, 0, 0) },
            uNight: { value: new THREE.Vector3(0, 0, 0) },
            uMarkings: { value: opts.markings ?? 1 },
            uWet: { value: 0 },
            uTime: { value: 0 },
            uDetail: { value: 1 },
            uXray: { value: 0 },
        },
    });
    // three's GLSL3 prefix does not declare modelMatrix/cameraPosition for us in every build, so add the two we need.
    mat.defines = {};
    setAtlas(mat, opts.symbols);
    return mat;
}
export function setAtlas(material, canvas) {
    if (!canvas) return;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    material.uniforms.uSymbols.value = tex;
}
export { FLAG, MARK, SYM, TINT };

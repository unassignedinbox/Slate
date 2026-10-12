//============================================================================================================================================
// 📦 Editor/RoadEditor/Presentation/PropMaterial.js — One instanced shader for every piece of street furniture
//============================================================================================================================================
// A lamp, a bollard and a subway kiosk share this material and differ only in their instance record: position+yaw, scale+cell+palette+stretch, and
//    a per-vertex mode that routes a face to the body colour, the accent, the dark underside, the sign atlas or an emissive lens. The glow variant
//    is a second material with additive blending and camera-facing billboards, so lamp bloom costs one draw call per tile and never writes depth.
'use strict';

import * as THREE from 'three';
import { ATLAS_GRID } from './Atlas.js';
import { MODE } from './PropGeometry.js';

export const PALETTE = ['#8c9095', '#b9bec4', '#2f4a3a', '#c8102e', '#f2c200', '#1b3f7a', '#8a6a48', '#ffd9a0'];

const COMMON_UNIFORMS = () => ({
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(0xfff2dc) },
    uAmbTop: { value: new THREE.Color(0x6b7d94) },
    uAmbBottom: { value: new THREE.Color(0x2b2f36) },
    uFogColor: { value: new THREE.Color(0x9fb0bd) },
    uFog: { value: new THREE.Vector4(0.0016, 0, 0, 0) },
    uNight: { value: new THREE.Vector3(0, 0, 0) },
    uPal: { value: new Float32Array(PALETTE.map((h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }).flat()) },
    uPlates: { value: null },
    uTime: { value: 0 },
});

const VS_BODY = /* glsl */`
in float aMode;
in vec4 iPF;
in vec4 iPS;
out vec3 vN;
out vec3 vWorld;
out vec2 vUv;
flat out float vMode;
flat out float vCell;
flat out float vCol;
void main() {
    float c = cos(iPF.w), sn = sin(iPF.w);
    float ys = iPS.w > 0.5 ? iPS.w : 1.0;
    vec3 p = vec3(position.x, position.y * ys, position.z) * iPS.x;
    vec3 q = vec3(p.x * c + p.z * sn, p.y, -p.x * sn + p.z * c) + iPF.xyz;
    vN = normalize(vec3(normal.x * c + normal.z * sn, normal.y, -normal.x * sn + normal.z * c));
    vUv = uv; vMode = aMode; vCell = iPS.y; vCol = iPS.z; vWorld = q;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
}
`;

const FS_BODY = /* glsl */`
#define GRID ${ATLAS_GRID}.0
precision highp float;
uniform vec3 uSunDir, uSunColor, uAmbTop, uAmbBottom, uFogColor, uPal[8];
uniform vec4 uFog;
uniform vec3 uNight;
uniform sampler2D uPlates;
uniform float uTime;
in vec3 vN; in vec3 vWorld; in vec2 vUv;
flat in float vMode; flat in float vCell; flat in float vCol;
out vec4 fragColor;

void main() {
    int mode = int(vMode + 0.5);
    vec3 body = uPal[int(vCol + 0.5)];
    vec3 col = body;
    float rough = 0.7;
    if (mode == ${MODE.ACCENT}) { col = mix(body, vec3(0.9), 0.42); rough = 0.55; }
    else if (mode == ${MODE.DARK}) { col = body * 0.26; rough = 0.85; }
    else if (mode == ${MODE.CHAIN}) {
        float lace = abs(fract(vUv.x * 26.0) - 0.5) + abs(fract(vUv.y * 14.0 + 0.5) - 0.5);
        if (lace < 0.34) discard;
        col = body * 0.5; rough = 0.35;
    } else if (mode == ${MODE.GLOW}) {
        col = vec3(1.0, 0.86, 0.6) * (0.25 + uNight.x * 2.6);
        fragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
        float d2 = length(cameraPosition - vWorld);
        fragColor.rgb = mix(fragColor.rgb, pow(uFogColor, vec3(1.0 / 2.2)), clamp(1.0 - exp(-pow(d2 * uFog.x, 2.0)), 0.0, 1.0));
        return;
    } else if (mode == ${MODE.PLATE}) {
        if (abs(vN.y) > 0.5) { col = vec3(0.86); }
        else {
            vec2 cellXY = vec2(mod(vCell, GRID), floor(vCell / GRID));
            vec4 t = texture(uPlates, vec2((cellXY.x + vUv.x) / GRID, (GRID - cellXY.y - vUv.y) / GRID));
            if (t.a < 0.04) { col = vec3(0.86); } else col = t.rgb;
        }
        rough = 0.45;
    }
    vec3 N = normalize(vN);
    float sky = 0.5 + 0.5 * N.y;
    vec3 amb = mix(uAmbBottom, uAmbTop, sky);
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), mix(20.0, 120.0, 1.0 - rough)) * (0.12 + (1.0 - rough) * 0.5);
    vec3 outc = col * (amb + uSunColor * ndl * 0.9) + uSunColor * spec;
    if (mode == ${MODE.PLATE}) outc += col * uNight.x * 0.35;      // [-] retroreflective sheeting catches the lamps
    float d = length(cameraPosition - vWorld);
    outc = mix(outc, uFogColor, clamp(1.0 - exp(-pow(d * uFog.x, 2.0)), 0.0, 1.0));
    outc = max(outc, 0.0);
    outc = mix(outc * 12.92, 1.055 * pow(outc, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), outc));
    fragColor = vec4(outc, 1.0);
}
`;

const VS_GLOW = /* glsl */`
in vec4 iPF;
in vec4 iPS;
out vec2 vUv;
flat out float vCol;
void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float r = iPS.x * 2.3;
    float ys = iPS.w > 0.5 ? iPS.w : 1.0;
    vec3 q = iPF.xyz + right * (position.x * r) + up * (position.y * r * ys);
    vUv = uv; vCol = iPS.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
}
`;
const FS_GLOW = /* glsl */`
precision highp float;
uniform vec3 uFogColor, uNight, uPal[8];
uniform vec4 uFog;
uniform float uTime;
in vec2 vUv;
flat in float vCol;
out vec4 fragColor;
void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = exp(-d * d * 3.4) * (1.0 - smoothstep(0.75, 1.0, d));
    vec3 tint = mix(vec3(1.0, 0.82, 0.55), uPal[int(vCol + 0.5)], 0.2);
    float flick = 0.94 + 0.06 * sin(uTime * 7.0 + vCol * 13.0);
    vec3 c = tint * a * uNight.x * 1.5 * flick;
    fragColor = vec4(c, a * uNight.x);
}
`;

export function createPropMaterial() {
    const m = new THREE.ShaderMaterial({ vertexShader: VS_BODY, fragmentShader: FS_BODY, uniforms: COMMON_UNIFORMS(), glslVersion: THREE.GLSL3 });
    return m;
}
export function createGlowMaterial() {
    return new THREE.ShaderMaterial({
        vertexShader: VS_GLOW, fragmentShader: FS_GLOW, uniforms: COMMON_UNIFORMS(),
        glslVersion: THREE.GLSL3, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
}

/** Push the shared lighting state into both prop materials, so day/dusk/night is one call. */
export function syncPropLighting(materials, light) {
    for (const m of materials) {
        if (!m) continue;
        const u = m.uniforms;
        u.uSunDir.value.copy(light.sunDir);
        u.uSunColor.value.copy(light.sunColor);
        u.uAmbTop.value.copy(light.ambTop);
        u.uAmbBottom.value.copy(light.ambBottom);
        u.uFogColor.value.copy(light.fogColor);
        u.uFog.value.set(light.fogDensity, 0, 0, 0);
        u.uNight.value.copy(light.night);
    }
}
export { MODE };

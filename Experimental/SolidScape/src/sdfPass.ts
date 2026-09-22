//============================================================================================================================================
// SolidScape — GPU field pass: full-screen raymarcher that renders the compiled edit tape inside the three.js scene
//
// Phase-1 brute-force analytic raymarcher (docs/SDF-Research.md §18, Phase 1). The whole tape is interpreted per step,
// per pixel — deliberately simple, expected to fall over around a few hundred edits, at which point the brick cache
// (Phase 2+) replaces it. gl_FragDepth is written so the field composites correctly with the grid and ground plane.
//============================================================================================================================================

import * as THREE from 'three';
import { MaxInstructions, TexelsPerInstruction, FloatsPerInstruction } from './sdf';

const VERT = /* glsl */`
out vec2 vNdc;
void main()
{
    // full-screen triangle from vertex id
    vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
    vNdc = p;
    gl_Position = vec4(p, 0.9999, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
precision highp sampler2D;

in vec2 vNdc;
layout(location = 0) out vec4 outColour;

uniform sampler2D uTape;
uniform int   uCount;
uniform vec3  uCamPos;
uniform mat4  uInvProj;
uniform mat4  uInvView;
uniform mat4  uProjView;
uniform vec3  uSunDir;
uniform vec3  uSunColour;
uniform float uSunIntensity;
uniform vec3  uFogColour;
uniform float uFogDensity;
uniform vec3  uBrushPos;
uniform float uBrushRadius;
uniform float uBrushMode;          // <0 hidden · 0 add · 1 carve · 2 smooth-mode tint
uniform float uTime;
uniform int   uMaxSteps;

//------------------------------------------------------------------ tape fetch
vec4 Texel(int instr, int part)
{
    return texelFetch(uTape, ivec2(instr * ${TexelsPerInstruction} + part, 0), 0);
}

//------------------------------------------------------------------ primitives
float ShapeDist(float shape, vec3 p, vec3 c, float p0, float p1)
{
    vec3 d = p - c;
    if (shape < 0.5)                                   // sphere
    {
        return length(d) - p0;
    }
    else if (shape < 1.5)                              // rounded box
    {
        vec3 q = abs(d) - vec3(p0 - p1);
        return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - p1;
    }
    else if (shape < 2.5)                              // capped cylinder
    {
        vec2 w = vec2(length(d.xz) - p0, abs(d.y) - p1 * 0.5);
        return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
    }
    return p.y - c.y;                                  // ground plane
}

//------------------------------------------------------------------ smooth operators
float OpUnion(float a, float b, float k)
{
    if (k <= 0.0) return min(a, b);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
float OpSubtract(float a, float b, float k)
{
    if (k <= 0.0) return max(a, -b);
    float h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0);
    return mix(a, -b, h) + k * h * (1.0 - h);
}
float OpIntersect(float a, float b, float k)
{
    if (k <= 0.0) return max(a, b);
    float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
}

//------------------------------------------------------------------ tape interpreter
float Field(vec3 p)
{
    float stack[8];
    int sp = 0;

    for (int i = 0; i < ${MaxInstructions}; i++)
    {
        if (i >= uCount) break;
        vec4 a = Texel(i, 0);
        float op = a.x;

        if (op < 0.5)                                  // PUSH
        {
            vec4 b = Texel(i, 1);
            vec4 c = Texel(i, 2);
            if (sp < 8) { stack[sp] = ShapeDist(a.y, p, b.xyz, b.w, c.x); sp++; }
        }
        else if (op < 1.5)                             // COMBINE
        {
            if (sp >= 2)
            {
                float vb = stack[sp - 1];
                float va = stack[sp - 2];
                sp--;
                stack[sp - 1] = a.y < 0.5 ? OpUnion(va, vb, a.z)
                              : a.y < 1.5 ? OpSubtract(va, vb, a.z)
                              :             OpIntersect(va, vb, a.z);
            }
        }
        else                                           // DAB
        {
            if (sp >= 1)
            {
                vec4 b = Texel(i, 1);
                vec4 c = Texel(i, 2);
                float d = ShapeDist(a.y, p, b.xyz, b.w, c.x);
                float va = stack[sp - 1];
                stack[sp - 1] = a.w < 0.5 ? OpUnion(va, d, a.z)
                              : a.w < 1.5 ? OpSubtract(va, d, a.z)
                              :             OpIntersect(va, d, a.z);
            }
        }
    }

    if (sp == 0) return 1e9;
    float r = stack[0];
    for (int i = 1; i < 8; i++) { if (i >= sp) break; r = min(r, stack[i]); }
    return r;
}

vec3 FieldNormal(vec3 p, float t)
{
    float e = max(0.0015 * t, 0.004);
    vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * Field(p + k.xyy * e) +
                     k.yyx * Field(p + k.yyx * e) +
                     k.yxy * Field(p + k.yxy * e) +
                     k.xxx * Field(p + k.xxx * e));
}

//------------------------------------------------------------------ soft shadow along sun ray
float SunVisibility(vec3 p, vec3 n)
{
    float t = 0.35;
    float vis = 1.0;
    vec3 ro = p + n * 0.08;
    for (int i = 0; i < 28; i++)
    {
        vec3 q = ro + uSunDir * t;
        float d = Field(q);
        vis = min(vis, clamp(2.6 * d / t, 0.0, 1.0));
        t += clamp(d * 0.8, 0.12, 6.0);
        if (vis < 0.02 || t > 120.0) break;
    }
    return clamp(vis, 0.0, 1.0);
}

float Occlusion(vec3 p, vec3 n)
{
    float occ = 0.0, w = 1.0;
    for (int i = 1; i <= 4; i++)
    {
        float h = 0.12 * float(i * i);
        occ += w * (h - Field(p + n * h));
        w *= 0.62;
    }
    return clamp(1.0 - 1.15 * occ, 0.0, 1.0);
}

void main()
{
    if (uCount == 0) discard;

    // reconstruct ray
    vec4 clip = vec4(vNdc, -1.0, 1.0);
    vec4 eye  = uInvProj * clip;
    eye = vec4(eye.xy, -1.0, 0.0);
    vec3 rd = normalize((uInvView * eye).xyz);
    vec3 ro = uCamPos;

    // conservative march (edit tape is not a true SDF once smooth ops chain — see research §8)
    float t = 0.05;
    float d = Field(ro + rd * t);
    if (d < 0.0) discard;
    float tPrev = t;
    bool hit = false;

    for (int i = 0; i < 384; i++)
    {
        if (i >= uMaxSteps) break;
        float stepLen = clamp(d * 0.7, 0.02, 30.0);
        tPrev = t;
        t += stepLen;
        if (t > 2500.0) break;
        d = Field(ro + rd * t);
        if (d < 0.0015 * t + 0.002)
        {
            hit = true;
            break;
        }
    }
    if (!hit) discard;

    // bisection refinement
    float lo = tPrev, hi = t;
    for (int i = 0; i < 8; i++)
    {
        float mid = 0.5 * (lo + hi);
        if (Field(ro + rd * mid) > 0.0) lo = mid; else hi = mid;
    }
    t = 0.5 * (lo + hi);
    vec3 p = ro + rd * t;
    vec3 n = FieldNormal(p, t);

    // clay-like shading
    vec3 albedo = vec3(0.62, 0.60, 0.57);
    float upBlend = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    albedo = mix(albedo * vec3(0.82, 0.84, 0.9), albedo, upBlend);

    float sunVis  = SunVisibility(p, n);
    float ndl     = max(dot(n, uSunDir), 0.0);
    float ao      = Occlusion(p, n);
    vec3 h        = normalize(uSunDir - rd);
    float spec    = pow(max(dot(n, h), 0.0), 42.0) * 0.35 * sunVis;

    vec3 skyAmb   = mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.28, 0.36), upBlend) * ao;
    vec3 colour   = albedo * (uSunColour * uSunIntensity * 0.55 * ndl * sunVis + skyAmb * 1.6) + spec * uSunColour;

    // brush cursor ring projected on the surface
    if (uBrushMode >= 0.0)
    {
        float ringDist = abs(length(p - uBrushPos) - uBrushRadius);
        float ring = 1.0 - smoothstep(0.0, uBrushRadius * 0.06 + 0.02, ringDist);
        float fill = 1.0 - smoothstep(uBrushRadius * 0.85, uBrushRadius, length(p - uBrushPos));
        vec3 tone = uBrushMode < 0.5 ? vec3(0.42, 0.47, 1.0)
                  : uBrushMode < 1.5 ? vec3(1.0, 0.35, 0.3)
                  :                    vec3(0.35, 0.9, 0.6);
        float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
        colour = mix(colour, tone, ring * 0.85 * pulse + fill * 0.10);
    }

    // exponential-squared fog to match the scene
    float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * t * t);
    colour = mix(colour, uFogColour, clamp(fogAmount, 0.0, 1.0));

    outColour = vec4(colour, 1.0);

    // correct depth so grid/ground composite
    vec4 clipPos = uProjView * vec4(p, 1.0);
    float ndcDepth = clipPos.z / clipPos.w;
    gl_FragDepth = clamp(ndcDepth * 0.5 + 0.5, 0.0, 1.0);
}`;

//--------------------------------------------------------------------------------------------------------------------------
export class FieldPass
{
    readonly mesh: THREE.Mesh;
    private readonly material: THREE.RawShaderMaterial;
    private readonly tape: THREE.DataTexture;

    constructor()
    {
        this.tape = new THREE.DataTexture(
            new Float32Array(MaxInstructions * FloatsPerInstruction),
            MaxInstructions * TexelsPerInstruction, 1,
            THREE.RGBAFormat, THREE.FloatType,
        );
        this.tape.magFilter = THREE.NearestFilter;
        this.tape.minFilter = THREE.NearestFilter;
        this.tape.needsUpdate = true;

        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uTape:         { value: this.tape },
                uCount:        { value: 0 },
                uCamPos:       { value: new THREE.Vector3() },
                uInvProj:      { value: new THREE.Matrix4() },
                uInvView:      { value: new THREE.Matrix4() },
                uProjView:     { value: new THREE.Matrix4() },
                uSunDir:       { value: new THREE.Vector3(0, 1, 0) },
                uSunColour:    { value: new THREE.Color(1, 0.95, 0.85) },
                uSunIntensity: { value: 3.0 },
                uFogColour:    { value: new THREE.Color(0x9aa7b8) },
                uFogDensity:   { value: 0.0035 },
                uBrushPos:     { value: new THREE.Vector3() },
                uBrushRadius:  { value: 1.5 },
                uBrushMode:    { value: -1 },
                uTime:         { value: 0 },
                uMaxSteps:     { value: 200 },
            },
            depthTest:  true,
            depthWrite: true,
            transparent: false,
        });

        // geometry is a dummy — vertices come from gl_VertexID
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
        geometry.setDrawRange(0, 3);

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
    }

    //----------------------------------------------------------------------------------------------------------------------
    UploadTape(data: Float32Array, count: number): void
    {
        (this.tape.image.data as Float32Array).set(data);
        this.tape.needsUpdate = true;
        this.material.uniforms['uCount'].value = count;
        this.mesh.visible = count > 0;
    }

    SetQuality(maxSteps: number): void
    {
        this.material.uniforms['uMaxSteps'].value = Math.round(maxSteps);
    }

    SetBrushCursor(pos: THREE.Vector3 | null, radius: number, mode: number): void
    {
        const u = this.material.uniforms;
        if (!pos) { u['uBrushMode'].value = -1; return; }
        u['uBrushMode'].value = mode;
        u['uBrushPos'].value.copy(pos);
        u['uBrushRadius'].value = radius;
    }

    UpdateFrame(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, sunColour: THREE.Color,
                sunIntensity: number, fogColour: THREE.Color, fogDensity: number, time: number): void
    {
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();       // renderer refreshes this too late for us
        const u = this.material.uniforms;
        u['uCamPos'].value.copy(camera.position);
        u['uInvProj'].value.copy(camera.projectionMatrixInverse);
        u['uInvView'].value.copy(camera.matrixWorld);
        u['uProjView'].value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        u['uSunDir'].value.copy(sunDir).normalize();
        u['uSunColour'].value.copy(sunColour);
        u['uSunIntensity'].value = sunIntensity;
        u['uFogColour'].value.copy(fogColour);
        u['uFogDensity'].value = fogDensity;
        u['uTime'].value = time;
    }
}

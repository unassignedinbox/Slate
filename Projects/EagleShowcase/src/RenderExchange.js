//============================================================================================================================================
//                                                         RENDEREXCHANGE.JS
//============================================================================================================================================
// 🧩 WebGL2 forward renderer for the showcase: GPU skinning from an RGBA32F matrix texture, a Cook-Torrance GGX
//    surface with per-class material constants (vane / contour / keratin / talon / cornea), procedural barb
//    micro-normals for every feather, a 2048² sun shadow map with 3×3 PCF, a procedural sky with a cloud deck, a
//    ground plane with aerial perspective, and an optional skeleton overlay.

const SkyVertex = `#version 300 es
precision highp float;
out vec2 vNdc;
void main()
{
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vNdc = p * 2.0 - 1.0;
    gl_Position = vec4(vNdc, 1.0, 1.0);
}`;

const SkyFragment = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInverseViewProjection;
uniform vec3 uCameraPosition;
uniform vec3 uSunDirection;
uniform float uTime;
out vec4 oColour;

float Hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float Value(vec2 p)
{
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(Hash(i), Hash(i + vec2(1,0)), u.x), mix(Hash(i + vec2(0,1)), Hash(i + vec2(1,1)), u.x), u.y);
}
float Clouds(vec2 p)
{
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; ++i) { s += a * Value(p); p *= 2.07; a *= 0.5; }
    return s;
}

void main()
{
    vec4 far = uInverseViewProjection * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCameraPosition);

    float up = clamp(dir.y, -1.0, 1.0);
    vec3 zenith = vec3(0.075, 0.175, 0.400);
    vec3 horizon = vec3(0.520, 0.620, 0.760);
    vec3 sky = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.62));
    sky = mix(sky, vec3(0.240, 0.250, 0.235), smoothstep(0.0, -0.22, up));   // haze into distant terrain

    float sun = max(dot(dir, uSunDirection), 0.0);
    sky += vec3(1.0, 0.86, 0.66) * (pow(sun, 900.0) * 14.0 + pow(sun, 18.0) * 0.30);

    if (up > 0.02)
    {
        vec2 plane = uCameraPosition.xz + dir.xz * (900.0 / max(up, 0.02));
        float deck = Clouds(plane * 0.0016 + vec2(uTime * 0.0035, 0.0));
        float cover = smoothstep(0.52, 0.86, deck) * smoothstep(0.02, 0.22, up);
        vec3 cloud = mix(vec3(0.62, 0.64, 0.68), vec3(1.05, 1.02, 0.98), smoothstep(0.5, 0.95, deck));
        sky = mix(sky, cloud, cover * 0.85);
    }

    vec3 mapped = sky / (sky + vec3(0.72));
    oColour = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}`;

const SkinningPreamble = `
uniform highp sampler2D uSkinning;
mat4 JointMatrix(uint j)
{
    int b = int(j) * 4;
    return mat4(texelFetch(uSkinning, ivec2(b, 0), 0), texelFetch(uSkinning, ivec2(b + 1, 0), 0),
                texelFetch(uSkinning, ivec2(b + 2, 0), 0), texelFetch(uSkinning, ivec2(b + 3, 0), 0));
}
mat4 SkinMatrix(uvec4 joints, vec4 weights)
{
    mat4 m = JointMatrix(joints.x) * weights.x;
    m += JointMatrix(joints.y) * weights.y;
    m += JointMatrix(joints.z) * weights.z;
    m += JointMatrix(joints.w) * weights.w;
    return m;
}`;

const EagleVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aAlbedo;
layout(location = 3) in uvec4 aJoints;
layout(location = 4) in vec4 aWeights;
layout(location = 5) in vec2 aFeather;
layout(location = 6) in float aSurface;
${SkinningPreamble}
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat4 uLightViewProjection;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vAlbedo;
out vec2 vFeather;
flat out int vSurface;
out vec4 vShadow;
void main()
{
    mat4 skin = SkinMatrix(aJoints, aWeights);
    vec4 local = skin * vec4(aPosition, 1.0);
    vec3 normal = mat3(skin) * aNormal;
    vec4 world = uModel * local;
    vWorld = world.xyz;
    vNormal = normalize(mat3(uModel) * normal);
    vAlbedo = aAlbedo;
    vFeather = aFeather;
    vSurface = int(aSurface + 0.5);
    vShadow = uLightViewProjection * world;
    gl_Position = uViewProjection * world;
}`;

const ShadingLibrary = `
float DistributionGGX(float NdotH, float roughness)
{
    float a = roughness * roughness;
    float a2 = a * a;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(3.14159265 * d * d, 1e-7);
}
float GeometrySmith(float NdotV, float NdotL, float roughness)
{
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float gv = NdotV / (NdotV * (1.0 - k) + k);
    float gl = NdotL / (NdotL * (1.0 - k) + k);
    return gv * gl;
}
vec3 Fresnel(float cosTheta, vec3 f0)
{
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
vec3 AcesTonemap(vec3 x)
{
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}`;

const EagleFragment = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vAlbedo;
in vec2 vFeather;
flat in int vSurface;
in vec4 vShadow;
uniform vec3 uCameraPosition;
uniform vec3 uSunDirection;
uniform vec3 uSunRadiance;
uniform vec3 uSkyRadiance;
uniform vec3 uGroundRadiance;
uniform float uExposure;
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
uniform int uDebugView;
out vec4 oColour;
${ShadingLibrary}

float SampleShadow(vec3 normal, vec3 lightDirection)
{
    vec3 p = vShadow.xyz / vShadow.w;
    p = p * 0.5 + 0.5;
    if (p.z > 1.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
    float bias = max(0.0016 * (1.0 - dot(normal, lightDirection)), 0.0006);
    float sum = 0.0;
    for (int y = -1; y <= 1; ++y)
        for (int x = -1; x <= 1; ++x)
            sum += texture(uShadowMap, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel, p.z - bias));
    return sum / 9.0;
}

void main()
{
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPosition - vWorld);
    vec3 albedo = vAlbedo;
    float roughness = 0.62;
    float specular = 0.04;
    float sheen = 0.0;

    if (vSurface == 1)
    {
        // ── Feather vane: barbs run obliquely from the rachis toward the tip; barbules give a soft sheen and the
        //    rachis itself is a hard, glossy ridge. Frequency-faded so it never aliases at distance.
        float phase = vFeather.y * 26.0 + vFeather.x * 9.0;
        float w = fwidth(phase);
        float fade = clamp(1.0 - w * 1.6, 0.0, 1.0);
        float barbs = sin(phase * 6.2831853) * fade;
        float rachis = exp(-pow(vFeather.y / 0.055, 2.0));
        float tipWear = smoothstep(0.86, 1.0, vFeather.x);

        float height = barbs * 0.5 + rachis * 1.6;
        vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
        float dhx = dFdx(height), dhy = dFdy(height);
        vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
        float det = dot(dpx, r1);
        vec3 gradient = (dhx * r1 + dhy * r2) / max(abs(det), 1e-9);
        N = normalize(N - 0.010 * gradient);

        albedo *= 1.0 + 0.10 * barbs;
        albedo = mix(albedo, albedo * 1.45 + 0.012, rachis * 0.8);
        albedo = mix(albedo, albedo * 0.82, tipWear);
        roughness = mix(0.30, 0.16, rachis);
        specular = 0.055;
        sheen = 0.35;
    }
    else if (vSurface == 0)
    {
        // Contour plumage on the body: fine directional fluff, matte.
        float fluff = sin(vWorld.y * 220.0 + vWorld.z * 190.0) * 0.5 + sin(vWorld.x * 310.0) * 0.5;
        albedo *= 1.0 + 0.045 * fluff;
        roughness = 0.70;
        specular = 0.035;
        sheen = 0.45;
    }
    else if (vSurface == 2)
    {
        // Keratin: bill and the reticulate scales of the tarsus.
        float scale = sin(vWorld.y * 520.0) * sin(vWorld.z * 470.0) * sin(vWorld.x * 500.0);
        albedo *= 1.0 + 0.10 * scale;
        roughness = 0.24 + 0.06 * scale;
        specular = 0.055;
    }
    else if (vSurface == 3) { roughness = 0.11; specular = 0.075; }
    else if (vSurface == 4) { roughness = 0.045; specular = 0.09; }
    else { roughness = 0.42; specular = 0.05; }

    vec3 L = uSunDirection;
    vec3 H = normalize(L + V);
    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 1e-4);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);

    float shadow = SampleShadow(N, L);
    vec3 f0 = vec3(specular);
    vec3 F = Fresnel(VdotH, f0);
    float D = DistributionGGX(NdotH, roughness);
    float G = GeometrySmith(NdotV, NdotL, roughness);
    vec3 spec = (D * G * F) / max(4.0 * NdotV * NdotL, 1e-4) * NdotL;
    vec3 diffuse = albedo * (1.0 - F) * NdotL / 3.14159265;

    vec3 direct = (diffuse + spec) * uSunRadiance * shadow;

    // Hemispheric ambient: sky above, bounced ground below, plus plumage sheen at grazing angles.
    float hemisphere = N.y * 0.5 + 0.5;
    vec3 ambient = albedo * mix(uGroundRadiance, uSkyRadiance, hemisphere);
    float rim = pow(1.0 - NdotV, 3.5);
    ambient += sheen * rim * mix(uGroundRadiance, uSkyRadiance, 0.7) * (0.35 + 0.65 * albedo);

    vec3 colour = direct + ambient;

    // Aerial perspective so a soaring bird sits in the air rather than on the glass.
    float distance = length(uCameraPosition - vWorld);
    float haze = 1.0 - exp(-distance * 0.0075);
    colour = mix(colour, vec3(0.52, 0.62, 0.76) * 0.9, haze * 0.65);

    if (uDebugView == 1) colour = N * 0.5 + 0.5;
    else if (uDebugView == 2) colour = vec3(shadow);
    else if (uDebugView == 3) colour = albedo;

    oColour = vec4(pow(AcesTonemap(colour * uExposure), vec3(1.0 / 2.2)), 1.0);
}`;

const DepthVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 3) in uvec4 aJoints;
layout(location = 4) in vec4 aWeights;
${SkinningPreamble}
uniform mat4 uModel;
uniform mat4 uLightViewProjection;
void main()
{
    mat4 skin = SkinMatrix(aJoints, aWeights);
    gl_Position = uLightViewProjection * uModel * (skin * vec4(aPosition, 1.0));
}`;

const DepthFragment = `#version 300 es
precision highp float;
void main() { }`;

const GroundVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform mat4 uViewProjection;
uniform mat4 uLightViewProjection;
uniform vec2 uCentre;
uniform float uExtent;
out vec3 vWorld;
out vec4 vShadow;
void main()
{
    vec3 world = vec3(uCentre.x + aCorner.x * uExtent, 0.0, uCentre.y + aCorner.y * uExtent);
    vWorld = world;
    vShadow = uLightViewProjection * vec4(world, 1.0);
    gl_Position = uViewProjection * vec4(world, 1.0);
}`;

const GroundFragment = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in vec4 vShadow;
uniform vec3 uCameraPosition;
uniform vec3 uSunDirection;
uniform vec3 uSunRadiance;
uniform vec3 uSkyRadiance;
uniform float uExposure;
uniform sampler2DShadow uShadowMap;
uniform float uShadowTexel;
out vec4 oColour;
${ShadingLibrary}

float Hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float Value(vec2 p)
{
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(Hash(i), Hash(i + vec2(1,0)), u.x), mix(Hash(i + vec2(0,1)), Hash(i + vec2(1,1)), u.x), u.y);
}
float Fractal(vec2 p)
{
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; ++i) { s += a * Value(p); p *= 2.13; a *= 0.5; }
    return s;
}

void main()
{
    vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
    float shadow = 1.0;
    if (p.z <= 1.0 && p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0)
    {
        float sum = 0.0;
        for (int y = -1; y <= 1; ++y)
            for (int x = -1; x <= 1; ++x)
                sum += texture(uShadowMap, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel, p.z - 0.0018));
        shadow = sum / 9.0;
    }

    float coarse = Fractal(vWorld.xz * 0.35);
    float fine = Fractal(vWorld.xz * 3.7);
    vec3 grass = mix(vec3(0.045, 0.062, 0.028), vec3(0.105, 0.125, 0.052), coarse);
    vec3 dirt = vec3(0.085, 0.066, 0.045);
    vec3 albedo = mix(grass, dirt, smoothstep(0.55, 0.85, fine) * 0.55);

    vec3 N = normalize(vec3((Fractal(vWorld.xz * 3.7 + vec2(0.1, 0.0)) - fine) * 2.0, 1.0,
                            (Fractal(vWorld.xz * 3.7 + vec2(0.0, 0.1)) - fine) * 2.0));
    float NdotL = max(dot(N, uSunDirection), 0.0);
    vec3 colour = albedo * (uSunRadiance * NdotL * shadow / 3.14159265 + uSkyRadiance * 0.85);

    float distance = length(uCameraPosition - vWorld);
    float haze = 1.0 - exp(-distance * 0.012);
    colour = mix(colour, vec3(0.52, 0.62, 0.76) * 0.95, haze);

    oColour = vec4(pow(AcesTonemap(colour * uExposure), vec3(1.0 / 2.2)), 1.0);
}`;

const LineVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColour;
uniform mat4 uViewProjection;
out vec3 vColour;
void main() { vColour = aColour; gl_Position = uViewProjection * vec4(aPosition, 1.0); }`;

const LineFragment = `#version 300 es
precision highp float;
in vec3 vColour;
out vec4 oColour;
void main() { oColour = vec4(vColour, 1.0); }`;

//------------------------------------------------------------------------------------------------------------------------
//                                                        RENDER EXCHANGE
//------------------------------------------------------------------------------------------------------------------------

export class RenderExchange
{
    constructor(canvas)
    {
        const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
        if (!gl) throw new Error("WebGL2 is required for this showcase.");
        this.gl = gl;
        this.canvas = canvas;
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);

        this.skyProgram = this.Program(SkyVertex, SkyFragment);
        this.eagleProgram = this.Program(EagleVertex, EagleFragment);
        this.depthProgram = this.Program(DepthVertex, DepthFragment);
        this.groundProgram = this.Program(GroundVertex, GroundFragment);
        this.lineProgram = this.Program(LineVertex, LineFragment);

        this.emptyVertexArray = gl.createVertexArray();
        this.BuildShadowTarget(2048);
        this.BuildGround();
        this.BuildLines();
        this.shadowExtent = 1.6;
    }

    Program(vertexSource, fragmentSource)
    {
        const gl = this.gl;
        const Compile = (type, source) =>
        {
            const s = gl.createShader(type);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(s) + "\n" + source.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n"));
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, Compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(p, Compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const uniforms = {};
        const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; ++i)
        {
            const info = gl.getActiveUniform(p, i);
            uniforms[info.name.replace("[0]", "")] = gl.getUniformLocation(p, info.name);
        }
        return { program: p, uniforms };
    }

    BuildShadowTarget(size)
    {
        const gl = this.gl;
        this.shadowSize = size;
        this.shadowTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
        this.shadowTarget = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowTarget);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    BuildGround()
    {
        const gl = this.gl;
        this.groundArray = gl.createVertexArray();
        gl.bindVertexArray(this.groundArray);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    BuildLines()
    {
        const gl = this.gl;
        this.lineArray = gl.createVertexArray();
        gl.bindVertexArray(this.lineArray);
        this.linePositions = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.linePositions);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.bindVertexArray(null);
        this.lineCount = 0;
    }

    UploadGeometry(geometry, jointCount)
    {
        const gl = this.gl;
        this.geometry = geometry;
        this.vertexArray = gl.createVertexArray();
        gl.bindVertexArray(this.vertexArray);

        const Attribute = (location, source, size, type, integer = false) =>
        {
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, source, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(location);
            if (integer) gl.vertexAttribIPointer(location, size, type, 0, 0);
            else gl.vertexAttribPointer(location, size, type, false, 0, 0);
        };
        Attribute(0, geometry.position, 3, gl.FLOAT);
        Attribute(1, geometry.normal, 3, gl.FLOAT);
        Attribute(2, geometry.albedo, 3, gl.FLOAT);
        Attribute(3, geometry.joints, 4, gl.UNSIGNED_SHORT, true);
        Attribute(4, geometry.weights, 4, gl.FLOAT);
        Attribute(5, geometry.featherUv, 2, gl.FLOAT);
        Attribute(6, geometry.surface, 1, gl.FLOAT);

        const indices = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.index, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        this.jointCount = jointCount;
        this.skinningData = new Float32Array(jointCount * 16);
        this.skinningTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.skinningTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, jointCount * 4, 1, 0, gl.RGBA, gl.FLOAT, null);
    }

    UploadSkinning(matrices)
    {
        const gl = this.gl;
        for (let i = 0; i < matrices.length; ++i) this.skinningData.set(matrices[i], i * 16);
        gl.bindTexture(gl.TEXTURE_2D, this.skinningTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.jointCount * 4, 1, gl.RGBA, gl.FLOAT, this.skinningData);
    }

    UploadLines(vertices)
    {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.linePositions);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
        this.lineCount = vertices.length / 6;
    }

    Resize()
    {
        const gl = this.gl, canvas = this.canvas;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, canvas.width, canvas.height);
        return canvas.width / canvas.height;
    }

    Render(view)
    {
        const gl = this.gl;
        const { model, viewProjection, inverseViewProjection, lightViewProjection, cameraPosition, sunDirection,
            sunRadiance, skyRadiance, groundRadiance, exposure, time, showGround, showSkeleton, wireframe, debugView } = view;

        // ── Shadow pass ───────────────────────────────────────────────────────────────────────────────────────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowTarget);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.depthProgram.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.skinningTexture);
        gl.uniform1i(this.depthProgram.uniforms.uSkinning, 0);
        gl.uniformMatrix4fv(this.depthProgram.uniforms.uModel, false, model);
        gl.uniformMatrix4fv(this.depthProgram.uniforms.uLightViewProjection, false, lightViewProjection);
        gl.bindVertexArray(this.vertexArray);
        gl.drawElements(gl.TRIANGLES, this.geometry.index.length, gl.UNSIGNED_INT, 0);

        // ── Main pass ─────────────────────────────────────────────────────────────────────────────────────────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const aspect = this.Resize();
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.skyProgram.program);
        gl.uniformMatrix4fv(this.skyProgram.uniforms.uInverseViewProjection, false, inverseViewProjection);
        gl.uniform3fv(this.skyProgram.uniforms.uCameraPosition, cameraPosition);
        gl.uniform3fv(this.skyProgram.uniforms.uSunDirection, sunDirection);
        gl.uniform1f(this.skyProgram.uniforms.uTime, time);
        gl.bindVertexArray(this.emptyVertexArray);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);

        if (showGround)
        {
            gl.useProgram(this.groundProgram.program);
            const u = this.groundProgram.uniforms;
            gl.uniformMatrix4fv(u.uViewProjection, false, viewProjection);
            gl.uniformMatrix4fv(u.uLightViewProjection, false, lightViewProjection);
            gl.uniform2f(u.uCentre, cameraPosition[0], cameraPosition[2]);
            gl.uniform1f(u.uExtent, 220.0);
            gl.uniform3fv(u.uCameraPosition, cameraPosition);
            gl.uniform3fv(u.uSunDirection, sunDirection);
            gl.uniform3fv(u.uSunRadiance, sunRadiance);
            gl.uniform3fv(u.uSkyRadiance, skyRadiance);
            gl.uniform1f(u.uExposure, exposure);
            gl.uniform1f(u.uShadowTexel, 1.0 / this.shadowSize);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
            gl.uniform1i(u.uShadowMap, 1);
            gl.bindVertexArray(this.groundArray);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        gl.useProgram(this.eagleProgram.program);
        const u = this.eagleProgram.uniforms;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.skinningTexture);
        gl.uniform1i(u.uSkinning, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.uniform1i(u.uShadowMap, 1);
        gl.uniformMatrix4fv(u.uModel, false, model);
        gl.uniformMatrix4fv(u.uViewProjection, false, viewProjection);
        gl.uniformMatrix4fv(u.uLightViewProjection, false, lightViewProjection);
        gl.uniform3fv(u.uCameraPosition, cameraPosition);
        gl.uniform3fv(u.uSunDirection, sunDirection);
        gl.uniform3fv(u.uSunRadiance, sunRadiance);
        gl.uniform3fv(u.uSkyRadiance, skyRadiance);
        gl.uniform3fv(u.uGroundRadiance, groundRadiance);
        gl.uniform1f(u.uExposure, exposure);
        gl.uniform1f(u.uShadowTexel, 1.0 / this.shadowSize);
        gl.uniform1i(u.uDebugView, debugView | 0);
        gl.bindVertexArray(this.vertexArray);
        if (wireframe)
        {
            gl.disable(gl.CULL_FACE);
            gl.drawElements(gl.TRIANGLES, this.geometry.index.length, gl.UNSIGNED_INT, 0);
            gl.enable(gl.CULL_FACE);
        }
        else gl.drawElements(gl.TRIANGLES, this.geometry.index.length, gl.UNSIGNED_INT, 0);

        if (showSkeleton && this.lineCount > 0)
        {
            gl.useProgram(this.lineProgram.program);
            gl.uniformMatrix4fv(this.lineProgram.uniforms.uViewProjection, false, viewProjection);
            gl.bindVertexArray(this.lineArray);
            gl.disable(gl.DEPTH_TEST);
            gl.drawArrays(gl.LINES, 0, this.lineCount);
            gl.enable(gl.DEPTH_TEST);
        }
        gl.bindVertexArray(null);
    }
}

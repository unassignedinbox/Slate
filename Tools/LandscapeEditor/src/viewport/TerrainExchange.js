//============================================================================================================================================
//                                                             TERRAINEXCHANGE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/viewport/TerrainExchange.js — WebGL2 terrain exchange: uploads the heightfield as a lit grid textured
//    with the satmap, draws a translucent sea plane at datum, and presents frames for the orbit camera.

import { orbitViewProjection } from './OrbitSolver.js';
import { sunDirection } from '../engine/SatmapSequence.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTANTS
//------------------------------------------------------------------------------------------------------------------------
const VERTICAL_EXAGGERATION = 1.6;
const SKY_CLEAR = [0.075, 0.09, 0.105, 1];
const SEA_RGBA = [0.1, 0.31, 0.46, 0.9];

//------------------------------------------------------------------------------------------------------------------------
//                                                        SHADERS
//------------------------------------------------------------------------------------------------------------------------
const TERRAIN_VERTEX_CODE = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec2 vUv;
void main()
{
    vNormal = aNormal;
    vUv = aUv;
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const TERRAIN_FRAGMENT_CODE = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D uSatmap;
uniform vec3 uSun;
out vec4 outColor;
void main()
{
    vec3 base = texture(uSatmap, vUv).rgb;
    vec3 normal = normalize(vNormal);
    float lambert = max(dot(normal, uSun), 0.0);
    vec3 lit = base * (0.42 + 0.72 * lambert);
    outColor = vec4(lit, 1.0);
}`;

const SEA_VERTEX_CODE = `#version 300 es
in vec2 aPlane;
uniform mat4 uViewProjection;
void main()
{
    gl_Position = uViewProjection * vec4(aPlane * 1.01, 0.0, 1.0);
}`;

const SEA_FRAGMENT_CODE = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main()
{
    outColor = uColor;
}`;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHADER PROGRAMS
//------------------------------------------------------------------------------------------------------------------------
function compileShader(gl, shaderType, code)
{
    const shader = gl.createShader(shaderType);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile failed: ${log}`);
    }
    return shader;
}

function linkProgram(gl, vertexCode, fragmentCode)
{
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexCode));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentCode));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          MESH
//------------------------------------------------------------------------------------------------------------------------
// World units: the map spans [-1, 1] horizontally. Vertical metres are scaled by the same factor, then exaggerated for readability.
function buildTerrainSurface(n, sizeM, elevation, seaLevelM)
{
    const count = n * n;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const heights = new Float32Array(count);
    const verticalScale = (2 / sizeM) * VERTICAL_EXAGGERATION;
    const step = 2 / (n - 1);

    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            heights[k] = (elevation[k] - seaLevelM) * verticalScale;
            positions[k * 3] = -1 + i * step;
            positions[k * 3 + 1] = -1 + j * step;
            positions[k * 3 + 2] = heights[k];
            uvs[k * 2] = i / (n - 1);
            uvs[k * 2 + 1] = j / (n - 1);
        }
    }

    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            const il = Math.max(i - 1, 0);
            const ir = Math.min(i + 1, n - 1);
            const jd = Math.max(j - 1, 0);
            const ju = Math.min(j + 1, n - 1);
            const slopeX = (heights[j * n + ir] - heights[j * n + il]) / ((ir - il) * step);
            const slopeY = (heights[ju * n + i] - heights[jd * n + i]) / ((ju - jd) * step);
            const length = Math.sqrt(slopeX * slopeX + slopeY * slopeY + 1);
            normals[k * 3] = -slopeX / length;
            normals[k * 3 + 1] = -slopeY / length;
            normals[k * 3 + 2] = 1 / length;
        }
    }

    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let cursor = 0;
    for (let j = 0; j < n - 1; j++)
    {
        for (let i = 0; i < n - 1; i++)
        {
            const a = j * n + i;
            const b = a + 1;
            const c = a + n;
            const d = c + 1;
            indices[cursor++] = a;
            indices[cursor++] = c;
            indices[cursor++] = b;
            indices[cursor++] = b;
            indices[cursor++] = c;
            indices[cursor++] = d;
        }
    }
    return { positions, normals, uvs, indices };
}

function bindFloatAttribute(gl, slot, location, size)
{
    gl.bindBuffer(gl.ARRAY_BUFFER, slot);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        EXCHANGE
//------------------------------------------------------------------------------------------------------------------------
export function createTerrainExchange(canvas)
{
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl)
    {
        throw new Error('WebGL2 is not available in this browser, so the 3D view is disabled. The 2D view still works.');
    }

    const terrainProgram = linkProgram(gl, TERRAIN_VERTEX_CODE, TERRAIN_FRAGMENT_CODE);
    const seaProgram = linkProgram(gl, SEA_VERTEX_CODE, SEA_FRAGMENT_CODE);
    const terrainUniform = {
        viewProjection: gl.getUniformLocation(terrainProgram, 'uViewProjection'),
        sun: gl.getUniformLocation(terrainProgram, 'uSun'),
        satmap: gl.getUniformLocation(terrainProgram, 'uSatmap')
    };
    const seaUniform = {
        viewProjection: gl.getUniformLocation(seaProgram, 'uViewProjection'),
        color: gl.getUniformLocation(seaProgram, 'uColor')
    };

    const terrainAttributes = {
        position: gl.createBuffer(),
        normal: gl.createBuffer(),
        uv: gl.createBuffer(),
        index: gl.createBuffer()
    };
    const terrainVao = gl.createVertexArray();
    gl.bindVertexArray(terrainVao);
    bindFloatAttribute(gl, terrainAttributes.position, gl.getAttribLocation(terrainProgram, 'aPosition'), 3);
    bindFloatAttribute(gl, terrainAttributes.normal, gl.getAttribLocation(terrainProgram, 'aNormal'), 3);
    bindFloatAttribute(gl, terrainAttributes.uv, gl.getAttribLocation(terrainProgram, 'aUv'), 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainAttributes.index);
    gl.bindVertexArray(null);

    const seaVertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, seaVertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const seaVao = gl.createVertexArray();
    gl.bindVertexArray(seaVao);
    bindFloatAttribute(gl, seaVertices, gl.getAttribLocation(seaProgram, 'aPlane'), 2);
    gl.bindVertexArray(null);

    const satmapTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, satmapTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let terrain = null;
    let indexCount = 0;
    let sunVector = [0, 0, 1];

    function setTerrain(result)
    {
        const surface = buildTerrainSurface(result.n, result.sizeM, result.elevation, result.settings.seaLevelM);
        gl.bindBuffer(gl.ARRAY_BUFFER, terrainAttributes.position);
        gl.bufferData(gl.ARRAY_BUFFER, surface.positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, terrainAttributes.normal);
        gl.bufferData(gl.ARRAY_BUFFER, surface.normals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, terrainAttributes.uv);
        gl.bufferData(gl.ARRAY_BUFFER, surface.uvs, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainAttributes.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.indices, gl.STATIC_DRAW);
        indexCount = surface.indices.length;

        gl.bindTexture(gl.TEXTURE_2D, satmapTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, result.n, result.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, result.satmapRgba);

        // The engine returns {east, north, up}; world axes are x = east, y = north, z = up.
        const sun = sunDirection(result.settings.sunAzimuthDeg, result.settings.sunElevationDeg);
        sunVector = [sun.east, sun.north, sun.up];
        terrain = result;
    }

    function draw(pose)
    {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
        const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
        if (canvas.width !== width || canvas.height !== height)
        {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.clearColor(SKY_CLEAR[0], SKY_CLEAR[1], SKY_CLEAR[2], SKY_CLEAR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        const viewProjection = orbitViewProjection(pose, width / height);
        if (terrain)
        {
            gl.useProgram(terrainProgram);
            gl.uniformMatrix4fv(terrainUniform.viewProjection, false, viewProjection);
            gl.uniform3fv(terrainUniform.sun, new Float32Array(sunVector));
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, satmapTexture);
            gl.uniform1i(terrainUniform.satmap, 0);
            gl.bindVertexArray(terrainVao);
            gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(seaProgram);
        gl.uniformMatrix4fv(seaUniform.viewProjection, false, viewProjection);
        gl.uniform4fv(seaUniform.color, new Float32Array(SEA_RGBA));
        gl.bindVertexArray(seaVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }

    function dispose()
    {
        gl.deleteBuffer(terrainAttributes.position);
        gl.deleteBuffer(terrainAttributes.normal);
        gl.deleteBuffer(terrainAttributes.uv);
        gl.deleteBuffer(terrainAttributes.index);
        gl.deleteBuffer(seaVertices);
        gl.deleteTexture(satmapTexture);
        gl.deleteVertexArray(terrainVao);
        gl.deleteVertexArray(seaVao);
        gl.deleteProgram(terrainProgram);
        gl.deleteProgram(seaProgram);
        const loss = gl.getExtension('WEBGL_lose_context');
        if (loss)
        {
            loss.loseContext();
        }
    }

    return { setTerrain, draw, dispose };
}

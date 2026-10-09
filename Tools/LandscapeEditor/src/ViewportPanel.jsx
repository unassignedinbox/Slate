import { useEffect, useRef, useState } from "react";
import { BuildTerrainGeometry } from "./TerrainExchange.js";
import { CreateOrbit, DragOrbit, OrbitMatrices, ZoomOrbit } from "./OrbitProjection.js";

const VertexSource = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec2 vUv;
out float vHeight;
void main() {
    vNormal = aNormal;
    vUv = aPosition.xz * 0.5 + 0.5;
    vHeight = aPosition.y;
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const FragmentSource = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in float vHeight;
uniform sampler2D uSatmap;
uniform int uWater;
uniform int uUseSatmap;
out vec4 outColour;
void main() {
    vec3 n = normalize(vNormal);
    vec3 light = normalize(vec3(-0.5, 0.8, 0.35));
    float diffuse = max(dot(n, light), 0.0);
    if (uWater == 1) {
        float fresnel = 0.35 + 0.4 * (1.0 - diffuse);
        outColour = vec4(vec3(0.07, 0.2, 0.3) * (0.6 + diffuse), fresnel);
        return;
    }
    vec3 base;
    if (uUseSatmap == 1) {
        base = texture(uSatmap, vUv).rgb;
    } else {
        float t = clamp((vHeight + 1.0) * 0.5, 0.0, 1.0);
        base = mix(vec3(0.16, 0.2, 0.13), vec3(0.78, 0.76, 0.72), t);
    }
    float shade = 0.38 + 0.72 * diffuse;
    outColour = vec4(base * shade, 1.0);
}`;

function Compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

function CreateProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, Compile(gl, gl.VERTEX_SHADER, VertexSource));
    gl.attachShader(program, Compile(gl, gl.FRAGMENT_SHADER, FragmentSource));
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.bindAttribLocation(program, 1, "aNormal");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
}

// Greyscale RGBA from a preview field, used for the mask preview.
function PreviewBytes(preview, n) {
    const out = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
        const v = Math.round(Math.min(1, Math.max(0, preview[i])) * 255);
        out[i * 4] = v;
        out[i * 4 + 1] = v;
        out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
    }
    return out;
}

export default function ViewportPanel({ result, view, onView, showPreview, previewAvailable, onShowPreview, satmap, satmapModes, onSatmap, sea, extent, busy, rendererNote }) {
    const canvasRef = useRef(null);
    const stateRef = useRef({ gl: null, program: null, buffers: null, texture: null, geometry: null, orbit: CreateOrbit(), drag: null, size: 0, uploaded: null });
    const [error, setError] = useState(null);

    // Set up WebGL once.
    useEffect(() => {
        const canvas = canvasRef.current;
        const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
        if (!gl) {
            setError("WebGL2 is not available in this browser.");
            return undefined;
        }
        let program;
        try {
            program = CreateProgram(gl);
        } catch (failure) {
            setError(`Shader error: ${failure.message}`);
            return undefined;
        }
        const state = stateRef.current;
        state.gl = gl;
        state.program = program;
        state.buffers = {
            position: gl.createBuffer(),
            normal: gl.createBuffer(),
            index: gl.createBuffer(),
            waterPosition: gl.createBuffer(),
            waterNormal: gl.createBuffer(),
            waterIndex: gl.createBuffer(),
        };
        state.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        let frame = 0;
        const draw = () => {
            frame = requestAnimationFrame(draw);
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (canvas.width !== width * devicePixelRatio || canvas.height !== height * devicePixelRatio) {
                canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
                canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
            }
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0.035, 0.035, 0.035, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            if (!state.geometry) return;
            gl.enable(gl.DEPTH_TEST);
            gl.useProgram(state.program);
            const matrices = OrbitMatrices(state.orbit, canvas.width / Math.max(1, canvas.height));
            gl.uniformMatrix4fv(gl.getUniformLocation(state.program, "uViewProjection"), false, matrices.viewProjection);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, state.texture);
            gl.uniform1i(gl.getUniformLocation(state.program, "uSatmap"), 0);
            gl.uniform1i(gl.getUniformLocation(state.program, "uUseSatmap"), state.useSatmap ? 1 : 0);

            gl.uniform1i(gl.getUniformLocation(state.program, "uWater"), 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.position);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.normal);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffers.index);
            gl.drawElements(gl.TRIANGLES, state.geometry.indexCount, gl.UNSIGNED_INT, 0);

            if (state.geometry.waterCount > 0) {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.depthMask(false);
                gl.uniform1i(gl.getUniformLocation(state.program, "uWater"), 1);
                gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.waterPosition);
                gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.waterNormal);
                gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffers.waterIndex);
                gl.drawElements(gl.TRIANGLES, state.geometry.waterCount, gl.UNSIGNED_INT, 0);
                gl.depthMask(true);
                gl.disable(gl.BLEND);
            }
        };
        frame = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(frame);
            gl.deleteProgram(program);
        };
    }, []);

    // Upload geometry whenever a new height field arrives.
    useEffect(() => {
        const state = stateRef.current;
        const gl = state.gl;
        if (!gl || !result) return;
        const n = result.resolution;
        const geometry = BuildTerrainGeometry(result.height, n, extent, { exaggeration: 0.9 });
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.normal);
        gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

        // Sea surface: a flat quad at sea level, drawn translucent.
        const seaY = (sea - geometry.centre) * geometry.scale;
        const waterPositions = new Float32Array([-1, seaY, -1, 1, seaY, -1, 1, seaY, 1, -1, seaY, 1]);
        const waterNormals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
        const waterIndices = new Uint32Array([0, 2, 1, 0, 3, 2]);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.waterPosition);
        gl.bufferData(gl.ARRAY_BUFFER, waterPositions, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.waterNormal);
        gl.bufferData(gl.ARRAY_BUFFER, waterNormals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffers.waterIndex);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, waterIndices, gl.STATIC_DRAW);

        state.geometry = {
            indexCount: geometry.indices.length,
            waterCount: sea > geometry.low ? waterIndices.length : 0,
        };
    }, [result, sea, extent]);

    // Upload the colour texture: the satmap, or a greyscale mask preview when requested.
    useEffect(() => {
        const state = stateRef.current;
        const gl = state.gl;
        if (!gl || !result) return;
        const n = result.resolution;
        let bytes = result.rgba;
        state.useSatmap = view === "satmap";
        if (showPreview && result.preview) {
            bytes = PreviewBytes(result.preview, n);
            state.useSatmap = true;
        }
        gl.bindTexture(gl.TEXTURE_2D, state.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    }, [result, view, showPreview]);

    const onPointerDown = (event) => {
        stateRef.current.drag = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event) => {
        const drag = stateRef.current.drag;
        if (!drag) return;
        DragOrbit(stateRef.current.orbit, event.clientX - drag.x, event.clientY - drag.y);
        stateRef.current.drag = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = () => {
        stateRef.current.drag = null;
    };
    const onWheel = (event) => {
        ZoomOrbit(stateRef.current.orbit, event.deltaY);
    };

    const stats = result ? result.stats : null;

    return (
        <section className="viewport" aria-label="Terrain viewport">
            <header className="viewport-header">
                <div className="segmented" role="group" aria-label="View">
                    <button type="button" className={view === "satmap" ? "on" : ""} onClick={() => onView("satmap")}>Satmap</button>
                    <button type="button" className={view === "shaded" ? "on" : ""} onClick={() => onView("shaded")}>Shaded</button>
                </div>
                {view === "satmap" && (
                    <label className="field-inline">
                        <span>Satmap</span>
                        <select value={satmap} onChange={(event) => onSatmap(event.target.value)}>
                            {satmapModes.map((mode) => (
                                <option key={mode.id} value={mode.id}>{mode.label}</option>
                            ))}
                        </select>
                    </label>
                )}
                <label className="check-inline">
                    <input type="checkbox" checked={showPreview} disabled={!previewAvailable} onChange={(event) => onShowPreview(event.target.checked)} />
                    <span>Show mask preview</span>
                </label>
                <div className="viewport-status">{busy ? "Computing" : stats ? `${result.resolution}\u00d7${result.resolution} \u00b7 ${Math.round(result.elapsedMs)} ms` : ""}</div>
            </header>
            <div className="viewport-stage">
                <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel} />
                {error && <div className="viewport-message">{error}</div>}
                {!error && !result && <div className="viewport-message">Building terrain…</div>}
                {rendererNote && <div className="viewport-note">{rendererNote}</div>}
                {stats && (
                    <dl className="viewport-metrics">
                        <div><dt>Min</dt><dd>{stats.min.toFixed(0)} m</dd></div>
                        <div><dt>Max</dt><dd>{stats.max.toFixed(0)} m</dd></div>
                        <div><dt>Relief</dt><dd>{stats.relief.toFixed(0)} m</dd></div>
                        <div><dt>Eroded</dt><dd>{formatVolume(stats.erodedVolume)}</dd></div>
                        <div><dt>Deposited</dt><dd>{formatVolume(stats.depositedVolume)}</dd></div>
                        <div><dt>Reused</dt><dd>{result.reusedEntries} layers</dd></div>
                    </dl>
                )}
            </div>
        </section>
    );
}

function formatVolume(cubicMetres) {
    if (!Number.isFinite(cubicMetres)) return "–";
    if (Math.abs(cubicMetres) >= 1e9) return `${(cubicMetres / 1e9).toFixed(2)} km³`;
    return `${(cubicMetres / 1e6).toFixed(1)} Mm³`;
}

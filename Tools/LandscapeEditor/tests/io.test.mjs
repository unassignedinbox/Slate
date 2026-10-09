// I/O checks: the PNG heightmap encoder (verified by decoding with zlib), project round trips, and undo history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import { EncodeHeightPng, Crc32 } from "../src/PngCodec.js";
import { SerializeProject, ParseProject } from "../src/StorageCodec.js";
import { CreateRevisionSequence } from "../src/RevisionSequence.js";
import { CreateLayer } from "../src/LayerSpecification.js";

function ReadChunks(png) {
    const chunks = {};
    let at = 8;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    while (at < png.length) {
        const length = view.getUint32(at);
        const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
        const data = png.subarray(at + 8, at + 8 + length);
        const crc = view.getUint32(at + 8 + length);
        assert.equal(crc, Crc32(png.subarray(at + 4, at + 8 + length)), `CRC for ${type}`);
        chunks[type] = data;
        at += 12 + length;
    }
    return chunks;
}

test("PNG heightmap has a valid signature, header and CRCs, and decodes back to the heights", () => {
    const n = 5;
    const height = new Float32Array(n * n);
    for (let i = 0; i < height.length; i++) height[i] = i * 10 - 100;
    const png = EncodeHeightPng(height, n, -100, 140);
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = ReadChunks(png);
    const header = new DataView(chunks.IHDR.buffer, chunks.IHDR.byteOffset, 13);
    assert.equal(header.getUint32(0), n);
    assert.equal(header.getUint32(4), n);
    assert.equal(chunks.IHDR[8], 16, "bit depth");
    assert.equal(chunks.IHDR[9], 0, "greyscale colour type");

    const raw = inflateSync(Buffer.from(chunks.IDAT));
    assert.equal(raw.length, n * (1 + 2 * n));
    const decoded = [];
    for (let y = 0; y < n; y++) {
        assert.equal(raw[y * (1 + 2 * n)], 0, "filter byte");
        for (let x = 0; x < n; x++) {
            const at = y * (1 + 2 * n) + 1 + 2 * x;
            decoded.push(raw.readUInt16BE(at) / 65535 * 240 - 100);
        }
    }
    for (let i = 0; i < height.length; i++) {
        assert.ok(Math.abs(decoded[i] - height[i]) < 0.01, `cell ${i}: ${decoded[i]} vs ${height[i]}`);
    }
});

test("PNG encoder handles rows larger than one stored block", () => {
    const n = 200;
    const height = new Float32Array(n * n).map((_, i) => Math.sin(i) * 50);
    const png = EncodeHeightPng(height, n, -50, 50);
    const raw = inflateSync(Buffer.from(ReadChunks(png).IDAT));
    assert.equal(raw.length, n * (1 + 2 * n));
});

test("project files round trip and reject foreign or empty files", () => {
    const project = {
        configuration: { resolution: 128, extent: 4096, sea: -20 },
        satmap: "strata",
        layers: [CreateLayer("shape", "ridge", { id: "x", seed: 4, params: { amplitude: 900 } })],
    };
    const parsed = ParseProject(SerializeProject(project));
    assert.equal(parsed.configuration.resolution, 128);
    assert.equal(parsed.satmap, "strata");
    assert.equal(parsed.layers[0].params.amplitude, 900);
    assert.throws(() => ParseProject("{not json"), /valid JSON/);
    assert.throws(() => ParseProject(JSON.stringify({ format: "other" })), /not a landscape project/);
    assert.throws(() => ParseProject(JSON.stringify({ format: "slate-landscape", version: 1, layers: [] })), /no usable layers/);
});

test("loaded configurations are clamped to supported ranges", () => {
    const text = JSON.stringify({
        format: "slate-landscape",
        version: 1,
        configuration: { resolution: 99999, extent: -5, sea: 1e9 },
        layers: [{ family: "shape", kind: "perlin" }],
    });
    const parsed = ParseProject(text);
    assert.equal(parsed.configuration.resolution, 512);
    assert.equal(parsed.configuration.extent, 256);
    assert.equal(parsed.configuration.sea, 2000);
});

test("undo and redo restore snapshots, and drags on one key collapse into one revision", () => {
    const history = CreateRevisionSequence();
    let state = 0;
    history.record(state, "slider", 1000);
    state = 1;
    history.record(state, "slider", 1100);
    state = 2;
    history.record(state, "slider", 1200);
    state = 3;
    assert.equal(history.canUndo, true);
    state = history.undo(state);
    assert.equal(state, 0, "a single undo reverts the whole drag");
    state = history.redo(state);
    assert.equal(state, 3);
    history.record(1, "other", 5000);
    assert.equal(history.canRedo, false, "a new edit clears the redo stack");
});

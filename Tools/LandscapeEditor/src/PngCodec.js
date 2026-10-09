// PngCodec: writes a 16-bit greyscale PNG heightmap. The zlib stream uses stored (uncompressed) deflate blocks, so the
// encoder needs no compression library and runs unchanged in the browser. Files are larger than compressed PNG but
// every standard image tool reads them.

const Signature = [137, 80, 78, 71, 13, 10, 26, 10];
const CrcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function Crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CrcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function Adler32(bytes) {
    let a = 1;
    let b = 0;
    const modulus = 65521;
    for (let i = 0; i < bytes.length; i++) {
        a = (a + bytes[i]) % modulus;
        b = (b + a) % modulus;
    }
    return ((b << 16) | a) >>> 0;
}

function ZlibStored(raw) {
    const blockLimit = 65535;
    const blocks = Math.max(1, Math.ceil(raw.length / blockLimit));
    const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    let o = 0;
    out[o++] = 0x78;
    out[o++] = 0x01;
    for (let b = 0; b < blocks; b++) {
        const start = b * blockLimit;
        const length = Math.min(blockLimit, raw.length - start);
        const last = b === blocks - 1 ? 1 : 0;
        out[o++] = last;
        out[o++] = length & 0xff;
        out[o++] = (length >>> 8) & 0xff;
        out[o++] = ~length & 0xff;
        out[o++] = (~length >>> 8) & 0xff;
        out.set(raw.subarray(start, start + length), o);
        o += length;
    }
    const checksum = Adler32(raw);
    out[o++] = (checksum >>> 24) & 0xff;
    out[o++] = (checksum >>> 16) & 0xff;
    out[o++] = (checksum >>> 8) & 0xff;
    out[o++] = checksum & 0xff;
    return out;
}

function Chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, Crc32(out.subarray(4, 8 + data.length)));
    return out;
}

// Encodes a height field as a 16-bit greyscale PNG. Heights are mapped linearly from [low, high] to [0, 65535].
export function EncodeHeightPng(height, n, low, high) {
    const span = high - low || 1;
    const raw = new Uint8Array(n * (1 + 2 * n));
    let o = 0;
    for (let y = 0; y < n; y++) {
        raw[o++] = 0;
        for (let x = 0; x < n; x++) {
            const v = Math.round(Math.min(1, Math.max(0, (height[y * n + x] - low) / span)) * 65535);
            raw[o++] = v >>> 8;
            raw[o++] = v & 0xff;
        }
    }
    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, n);
    headerView.setUint32(4, n);
    header[8] = 16;
    header[9] = 0;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;
    const parts = [Uint8Array.from(Signature), Chunk("IHDR", header), Chunk("IDAT", ZlibStored(raw)), Chunk("IEND", new Uint8Array(0))];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const png = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        png.set(part, at);
        at += part.length;
    }
    return png;
}

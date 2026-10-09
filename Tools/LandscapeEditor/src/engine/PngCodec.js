//============================================================================================================================================
//                                                                PNGCODEC.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/PngCodec.js — Minimal PNG encoder for RGBA8 rasters: scanline filtering, chunk framing and
//    CRC-32, with the deflate step supplied by the caller.

//------------------------------------------------------------------------------------------------------------------------
//                                                         CRC-32
//------------------------------------------------------------------------------------------------------------------------
const CRC_LOOKUP = (() =>
{
    const crcLookup = new Uint32Array(256);
    for (let n = 0; n < 256; n++)
    {
        let c = n;
        for (let k = 0; k < 8; k++)
        {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcLookup[n] = c >>> 0;
    }
    return crcLookup;
})();

export function crc32(bytes)
{
    let c = 0xffffffff;
    for (let k = 0; k < bytes.length; k++)
    {
        c = CRC_LOOKUP[(c ^ bytes[k]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         CHUNKS
//------------------------------------------------------------------------------------------------------------------------
function pngChunk(type, payload)
{
    const out = new Uint8Array(12 + payload.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, payload.length);
    for (let k = 0; k < 4; k++)
    {
        out[4 + k] = type.charCodeAt(k);
    }
    out.set(payload, 8);
    view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
    return out;
}

// Returns PNG bytes. deflate(Uint8Array) must return a zlib stream.
export function encodePng(width, height, rgba, deflate)
{
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++)
    {
        raw[y * (stride + 1)] = 0;
        raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, width);
    headerView.setUint32(4, height);
    header[8] = 8;
    header[9] = 6;
    const parts = [
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflate(raw)),
        pngChunk('IEND', new Uint8Array(0))
    ];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts)
    {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

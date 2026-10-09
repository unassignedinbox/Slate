// Export / import helpers. Pure functions so they can be tested in node.


const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Encode rows of 8- or 16-bit grayscale (channels=1) or RGB (channels=3).
// `pixels` is a Float32Array in 0..1 with width*height*channels entries.
export async function encodePNG(width, height, channels, bitDepth, pixels) {
  const bytesPer = bitDepth / 8, rowLen = width * channels * bytesPer + 1;
  const raw = new Uint8Array(rowLen * height);
  const max = (1 << bitDepth) - 1;
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0;
    let o = y * rowLen + 1;
    for (let x = 0; x < width * channels; x++) {
      const v = Math.round(Math.max(0, Math.min(1, pixels[y * width * channels + x])) * max);
      if (bitDepth === 16) { raw[o++] = v >> 8; raw[o++] = v & 255; } else raw[o++] = v;
    }
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = bitDepth; ihdr[9] = channels === 3 ? 2 : 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = await deflate(raw);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(total);
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// zlib stream: CompressionStream when available, otherwise uncompressed ("stored") deflate blocks.
async function deflate(data) {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return zlibStored(data);
}
export function zlibStored(data) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  let o = 0; out[o++] = 0x78; out[o++] = 0x01;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535, len = Math.min(65535, data.length - start), last = b === blocks - 1 ? 1 : 0;
    out[o++] = last; out[o++] = len & 255; out[o++] = len >> 8; out[o++] = (~len) & 255; out[o++] = ((~len) >> 8) & 255;
    out.set(data.subarray(start, start + len), o); o += len;
  }
  let a = 1, bsum = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; bsum = (bsum + a) % 65521; }
  const adler = ((bsum << 16) | a) >>> 0;
  new DataView(out.buffer).setUint32(o, adler);
  return out;
}

// 16-bit little-endian RAW heightmap.
export function encodeRaw16(h) {
  const out = new Uint8Array(h.length * 2), dv = new DataView(out.buffer);
  for (let i = 0; i < h.length; i++) dv.setUint16(i * 2, Math.round(Math.max(0, Math.min(1, h[i])) * 65535), true);
  return out;
}
export function decodeRaw16(buf) {
  const n = Math.floor(buf.byteLength / 2), N = Math.round(Math.sqrt(n));
  if (N * N !== n) throw new Error(`RAW16 size ${buf.byteLength} bytes is not a square 16-bit heightmap`);
  const dv = new DataView(buf), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, true) / 65535;
  return { N, data: out };
}
// Turn an 8-bit RGBA canvas buffer into a square grayscale heightmap (luma).
export function lumaFromRGBA(rgba, w, h) {
  const N = Math.min(w, h), out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * w + x) * 4;
    out[y * N + x] = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
  }
  return { N, data: out };
}

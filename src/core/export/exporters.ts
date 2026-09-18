// Slate Terrain Export Tools: 16-bit/8-bit Heightmaps, Wavefront OBJ Mesh, SatMap Albedo & Data Maps

import type { TerrainSimulationResult } from '../../types/terrain';

// Helper to trigger browser file download
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports 8-bit grayscale PNG Heightmap
 */
export function exportHeightmapPNG(sim: TerrainSimulationResult, filename: string = 'slate_heightmap.png') {
  const size = sim.resolution;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let i = 0; i < size * size; i++) {
    const val = Math.max(0, Math.min(255, Math.round(sim.heightmap[i] * 255)));
    const pIdx = i * 4;
    data[pIdx] = val;
    data[pIdx + 1] = val;
    data[pIdx + 2] = val;
    data[pIdx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, 'image/png');
}

/**
 * Exports 16-bit Heightmap as high-precision RAW/r16 file or high-precision 16-bit PNG format
 */
export function exportRaw16Heightmap(sim: TerrainSimulationResult, filename: string = 'slate_heightmap_16bit.raw') {
  const size = sim.resolution;
  const buffer = new ArrayBuffer(size * size * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < size * size; i++) {
    const val = Math.max(0, Math.min(65535, Math.round(sim.heightmap[i] * 65535)));
    view.setUint16(i * 2, val, true); // Little endian
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  triggerDownload(blob, filename);
}

/**
 * Exports Wavefront OBJ 3D Mesh with UVs and Normals
 */
export function exportObjMesh(sim: TerrainSimulationResult, heightScale: number = 35.0, filename: string = 'slate_terrain.obj') {
  const size = sim.resolution;
  // Subsample high-resolution meshes if resolution > 256 to keep OBJ file size manageable
  const step = size > 256 ? 2 : 1;
  const gridW = Math.floor((size - 1) / step) + 1;
  const gridH = Math.floor((size - 1) / step) + 1;

  const lines: string[] = [
    '# Slate Terrain Studio - Wavefront OBJ Export',
    `# Dimensions: ${gridW}x${gridH} vertices`,
    'o SlateTerrain',
  ];

  // Vertices
  for (let gz = 0; gz < gridH; gz++) {
    const z = Math.min(size - 1, gz * step);
    const posZ = (z / (size - 1) - 0.5) * 100.0;
    for (let gx = 0; gx < gridW; gx++) {
      const x = Math.min(size - 1, gx * step);
      const posX = (x / (size - 1) - 0.5) * 100.0;
      const posY = sim.heightmap[z * size + x] * heightScale;
      lines.push(`v ${posX.toFixed(3)} ${posY.toFixed(3)} ${posZ.toFixed(3)}`);
    }
  }

  // Texture Coordinates (UVs)
  for (let gz = 0; gz < gridH; gz++) {
    const v = 1.0 - (gz / (gridH - 1));
    for (let gx = 0; gx < gridW; gx++) {
      const u = gx / (gridW - 1);
      lines.push(`vt ${u.toFixed(4)} ${v.toFixed(4)}`);
    }
  }

  // Normals
  for (let gz = 0; gz < gridH; gz++) {
    const z = Math.min(size - 1, gz * step);
    for (let gx = 0; gx < gridW; gx++) {
      const x = Math.min(size - 1, gx * step);
      const nIdx = (z * size + x) * 3;
      lines.push(
        `vn ${sim.normals[nIdx].toFixed(4)} ${sim.normals[nIdx + 1].toFixed(4)} ${sim.normals[nIdx + 2].toFixed(4)}`
      );
    }
  }

  // Faces
  for (let gz = 0; gz < gridH - 1; gz++) {
    for (let gx = 0; gx < gridW - 1; gx++) {
      const v00 = gz * gridW + gx + 1;
      const v10 = gz * gridW + (gx + 1) + 1;
      const v01 = (gz + 1) * gridW + gx + 1;
      const v11 = (gz + 1) * gridW + (gx + 1) + 1;

      // Two triangles per quad: v/vt/vn
      lines.push(`f ${v00}/${v00}/${v00} ${v01}/${v01}/${v01} ${v10}/${v10}/${v10}`);
      lines.push(`f ${v10}/${v10}/${v10} ${v01}/${v01}/${v01} ${v11}/${v11}/${v11}`);
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  triggerDownload(blob, filename);
}

/**
 * Exports SatMap RGBA Albedo Texture as PNG
 */
export function exportSatMapAlbedoPNG(sim: TerrainSimulationResult, filename: string = 'slate_satmap_albedo.png') {
  const size = sim.resolution;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const clamped = new Uint8ClampedArray(sim.albedoTexture);
  const imgData = new ImageData(clamped, size, size);
  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, 'image/png');
}

/**
 * Exports Flow Drainage Map as PNG
 */
export function exportFlowMapPNG(sim: TerrainSimulationResult, filename: string = 'slate_flowmap.png') {
  const size = sim.resolution;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let i = 0; i < size * size; i++) {
    const val = Math.max(0, Math.min(255, Math.round(sim.flowMap[i] * 255)));
    const pIdx = i * 4;
    // Blue tint for rivers
    data[pIdx] = Math.round(val * 0.4);
    data[pIdx + 1] = Math.round(val * 0.7);
    data[pIdx + 2] = val;
    data[pIdx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, 'image/png');
}

/**
 * Exports Deposit Map as PNG
 */
export function exportDepositMapPNG(sim: TerrainSimulationResult, filename: string = 'slate_depositmap.png') {
  const size = sim.resolution;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let i = 0; i < size * size; i++) {
    const val = Math.max(0, Math.min(255, Math.round(sim.depositMap[i] * 255 * 3.0)));
    const pIdx = i * 4;
    // Golden ochre for talus/sediment
    data[pIdx] = val;
    data[pIdx + 1] = Math.round(val * 0.75);
    data[pIdx + 2] = Math.round(val * 0.45);
    data[pIdx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, 'image/png');
}

/**
 * Exports Normal Map as PNG
 */
export function exportNormalMapPNG(sim: TerrainSimulationResult, filename: string = 'slate_normalmap.png') {
  const size = sim.resolution;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  for (let i = 0; i < size * size; i++) {
    const nIdx = i * 3;
    const nx = sim.normals[nIdx];
    const ny = sim.normals[nIdx + 1];
    const nz = sim.normals[nIdx + 2];

    const pIdx = i * 4;
    data[pIdx] = Math.round((nx * 0.5 + 0.5) * 255);
    data[pIdx + 1] = Math.round((nz * 0.5 + 0.5) * 255); // Tangent normal convention
    data[pIdx + 2] = Math.round((ny * 0.5 + 0.5) * 255);
    data[pIdx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, 'image/png');
}

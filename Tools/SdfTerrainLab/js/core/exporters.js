// Exporters: mesh (OBJ/PLY), heightmap + flowmap PNG. Renderer-agnostic.
export function meshToOBJ(mesh) {
  const { positions, normals, indices } = mesh;
  const n = positions.length / 3;
  const lines = ['# SLATE SDF Terrain Lab export', `o terrain`];
  for (let i = 0; i < n; i++)
    lines.push(`v ${positions[i * 3].toFixed(4)} ${positions[i * 3 + 1].toFixed(4)} ${positions[i * 3 + 2].toFixed(4)}`);
  for (let i = 0; i < n; i++)
    lines.push(`vn ${normals[i * 3].toFixed(4)} ${normals[i * 3 + 1].toFixed(4)} ${normals[i * 3 + 2].toFixed(4)}`);
  if (mesh.colors) {
    // OBJ has no vertex colors; stash as comment-free second UV-ish channel is lossy — skip.
  }
  for (let i = 0; i < indices.length; i += 3)
    lines.push(`f ${indices[i] + 1}//${indices[i] + 1} ${indices[i + 1] + 1}//${indices[i + 1] + 1} ${indices[i + 2] + 1}//${indices[i + 2] + 1}`);
  return lines.join('\n');
}

export function meshToPLY(mesh) {
  const { positions, normals, colors, indices } = mesh;
  const n = positions.length / 3, f = indices.length / 3;
  const head = [`ply`, `format ascii 1.0`, `comment SLATE SDF Terrain Lab`,
    `element vertex ${n}`, `property float x`, `property float y`, `property float z`,
    `property float nx`, `property float ny`, `property float nz`,
    `property uchar red`, `property uchar green`, `property uchar blue`,
    `element face ${f}`, `property list uchar int vertex_index`, `end_header`];
  const lines = [...head];
  for (let i = 0; i < n; i++) {
    const r = Math.max(0, Math.min(255, Math.round((colors ? colors[i * 3] : 0.7) * 255)));
    const g = Math.max(0, Math.min(255, Math.round((colors ? colors[i * 3 + 1] : 0.7) * 255)));
    const b = Math.max(0, Math.min(255, Math.round((colors ? colors[i * 3 + 2] : 0.7) * 255)));
    lines.push(`${positions[i * 3].toFixed(4)} ${positions[i * 3 + 1].toFixed(4)} ${positions[i * 3 + 2].toFixed(4)} ` +
      `${normals[i * 3].toFixed(4)} ${normals[i * 3 + 1].toFixed(4)} ${normals[i * 3 + 2].toFixed(4)} ${r} ${g} ${b}`);
  }
  for (let i = 0; i < indices.length; i += 3)
    lines.push(`3 ${indices[i]} ${indices[i + 1]} ${indices[i + 2]}`);
  return lines.join('\n');
}

// Top-down heightmap → ImageData (caller paints to canvas / downloads).
export function heightmapData(vol) {
  const { nx, nz } = vol;
  const img = new Uint8ClampedArray(nx * nz * 4);
  const d = vol.dom;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = d.x0 + (ix + 0.5) * vol.vx, z = d.z0 + (iz + 0.5) * vol.vz;
    const y = vol.topSurfaceY(x, z);
    const t = y < 0 ? 0 : Math.max(0, Math.min(1, (y - d.y0) / d.sy));
    const o = (iz * nx + ix) * 4, v = Math.round(t * 255);
    img[o] = v; img[o + 1] = v; img[o + 2] = v; img[o + 3] = 255;
  }
  return { data: img, w: nx, h: nz };
}

// Flowmap: RG = normalized flow dir * strength, B = flux, A = 255.
export function flowmapData(vol) {
  const { nx, nz } = vol;
  const img = new Uint8ClampedArray(nx * nz * 4);
  let fmax = 1e-9;
  for (let i = 0; i < vol.flux.length; i++) if (vol.flux[i] > fmax) fmax = vol.flux[i];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    let fx = 0, fz = 0, fl = 0;
    for (let iy = vol.ny - 1; iy >= 0; iy--) {
      const id = (iy * nz + iz) * nx + ix;
      if (vol.flux[id] > 1e-9) { fx = vol.flowX[id]; fz = vol.flowZ[id]; fl = vol.flux[id]; break; }
    }
    const L = Math.hypot(fx, fz);
    const f = Math.pow(Math.min(fl / fmax, 1), 0.4);
    const o = (iz * nx + ix) * 4;
    img[o] = Math.round(((L > 1e-9 ? fx / L : 0) * 0.5 + 0.5) * 255);
    img[o + 1] = Math.round(((L > 1e-9 ? fz / L : 0) * 0.5 + 0.5) * 255);
    img[o + 2] = Math.round(f * 255);
    img[o + 3] = 255;
  }
  return { data: img, w: nx, h: nz };
}

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function downloadImageData(filename, { data, w, h }) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.putImageData(new ImageData(data, w, h), 0, 0);
  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => a.remove(), 500);
}

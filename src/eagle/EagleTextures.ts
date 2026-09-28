import * as THREE from 'three';

/**
 * Procedural PBR Texture Generator for High-Fidelity Eagle Rendering.
 * Creates sharp, detailed textures for feathers, keratin beak, raptor eyes, and scaled tarsi.
 */
export class EagleTextures {
  private static cache: Map<string, THREE.Texture> = new Map();

  /**
   * Generates a high-resolution primary/secondary flight feather texture.
   * Includes central rachis shaft, asymmetric vane with interlocking barbs, and subtle translucency.
   */
  public static createFeatherTexture(
    type: 'primary_dark' | 'secondary_dark' | 'tail_white' | 'head_white' | 'golden_mantle' | 'covert_brown',
    width = 512,
    height = 1024
  ): THREE.CanvasTexture {
    const key = `feather_${type}_${width}x${height}`;
    if (this.cache.has(key)) return this.cache.get(key) as THREE.CanvasTexture;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, width, height);

    // Color palettes
    let baseColor = '#211c19';
    let tipColor = '#151210';
    let rachisColor = '#3a332d';
    let barbHighlight = '#423b34';
    let isWhite = false;

    if (type === 'tail_white' || type === 'head_white') {
      isWhite = true;
      baseColor = '#fdfefe';
      tipColor = '#f0f3f6';
      rachisColor = '#dbe2e8';
      barbHighlight = '#ffffff';
    } else if (type === 'golden_mantle') {
      baseColor = '#6b4923';
      tipColor = '#3d2511';
      rachisColor = '#8c6031';
      barbHighlight = '#a37542';
    } else if (type === 'covert_brown') {
      baseColor = '#2b231d';
      tipColor = '#1e1814';
      rachisColor = '#42372f';
      barbHighlight = '#4f433a';
    }

    // Base feather gradient
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, tipColor);
    grad.addColorStop(0.7, baseColor);
    grad.addColorStop(1, tipColor);
    ctx.fillStyle = grad;

    // Draw feather shape
    ctx.beginPath();
    const cx = width * 0.45; // slight asymmetry (narrow outer vane, broad inner vane)
    ctx.moveTo(cx, 20); // tip
    ctx.bezierCurveTo(width * 0.9, height * 0.25, width * 0.95, height * 0.75, cx + 8, height - 30);
    ctx.lineTo(cx - 8, height - 30);
    ctx.bezierCurveTo(width * 0.05, height * 0.75, width * 0.1, height * 0.25, cx, 20);
    ctx.closePath();
    ctx.fill();

    // Draw fine barbs branching from rachis
    const barbCount = 350;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < barbCount; i++) {
      const y = 30 + (i / barbCount) * (height - 80);
      const t = i / barbCount;
      const angle = 0.35 + (1 - t) * 0.25; // barbs angle upward toward tip

      // Left vane barbs
      const leftLength = (width * 0.38) * Math.sin(t * Math.PI) * (1 - Math.random() * 0.1);
      ctx.strokeStyle = Math.random() > 0.4 ? barbHighlight : baseColor;
      ctx.globalAlpha = 0.6 + Math.random() * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx - leftLength, y - leftLength * Math.sin(angle));
      ctx.stroke();

      // Right vane barbs
      const rightLength = (width * 0.48) * Math.sin(t * Math.PI) * (1 - Math.random() * 0.1);
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + rightLength, y - rightLength * Math.sin(angle));
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // Draw central Rachis (shaft)
    ctx.strokeStyle = rachisColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, 25);
    ctx.quadraticCurveTo(cx - 2, height * 0.5, cx, height - 10);
    ctx.stroke();

    // Rachis 3D specular highlight
    ctx.strokeStyle = isWhite ? '#ffffff' : '#6b5e52';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + 1, 25);
    ctx.quadraticCurveTo(cx - 1, height * 0.5, cx + 1, height - 10);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    this.cache.set(key, texture);
    return texture;
  }

  /**
   * Generates a Normal Map for realistic feather barbs and rachis depth.
   */
  public static createFeatherNormalMap(width = 512, height = 512): THREE.CanvasTexture {
    const key = `feather_norm_${width}x${height}`;
    if (this.cache.has(key)) return this.cache.get(key) as THREE.CanvasTexture;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Normal map base flat blue (128, 128, 255)
    ctx.fillStyle = 'rgb(128, 128, 255)';
    ctx.fillRect(0, 0, width, height);

    // Add fine diagonal ridges for barbs
    const barbCount = 180;
    const cx = width * 0.5;
    for (let i = 0; i < barbCount; i++) {
      const y = (i / barbCount) * height;
      const t = i / barbCount;
      const barbLen = width * 0.45 * Math.sin(t * Math.PI);

      // Left barbs (slope up-left: red < 128, green > 128)
      ctx.strokeStyle = 'rgb(100, 160, 240)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx - barbLen, y - barbLen * 0.4);
      ctx.stroke();

      // Right barbs (slope up-right: red > 128, green > 128)
      ctx.strokeStyle = 'rgb(155, 160, 240)';
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + barbLen, y - barbLen * 0.4);
      ctx.stroke();
    }

    // Rachis normal bulge in center
    ctx.strokeStyle = 'rgb(128, 128, 255)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    this.cache.set(key, texture);
    return texture;
  }

  /**
   * Generates the piercing, striated yellow/amber Eagle Eye texture.
   */
  public static createEyeTexture(size = 512): THREE.CanvasTexture {
    const key = `eagle_eye_${size}`;
    if (this.cache.has(key)) return this.cache.get(key) as THREE.CanvasTexture;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const center = size / 2;
    const irisRadius = size * 0.45;
    const pupilRadius = size * 0.18;

    // Dark limbal ring
    ctx.fillStyle = '#1e180a';
    ctx.beginPath();
    ctx.arc(center, center, irisRadius + 4, 0, Math.PI * 2);
    ctx.fill();

    // Iris base gradient (intense raptor golden yellow / pale amber)
    const irisGrad = ctx.createRadialGradient(center, center, pupilRadius, center, center, irisRadius);
    irisGrad.addColorStop(0, '#f59e0b'); // amber near pupil
    irisGrad.addColorStop(0.35, '#fbbf24'); // golden mid
    irisGrad.addColorStop(0.75, '#fef08a'); // bright pale yellow
    irisGrad.addColorStop(0.95, '#d97706'); // darker amber edge
    irisGrad.addColorStop(1, '#292524'); // limbal ring
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.arc(center, center, irisRadius, 0, Math.PI * 2);
    ctx.fill();

    // Radial striated fibers in iris
    const fiberCount = 200;
    for (let i = 0; i < fiberCount; i++) {
      const angle = (i / fiberCount) * Math.PI * 2;
      const r1 = pupilRadius + Math.random() * 5;
      const r2 = irisRadius - Math.random() * 6;
      ctx.strokeStyle = Math.random() > 0.5 ? '#fffbeb' : '#b45309';
      ctx.lineWidth = 0.8 + Math.random() * 1.2;
      ctx.globalAlpha = 0.4 + Math.random() * 0.5;
      ctx.beginPath();
      ctx.moveTo(center + Math.cos(angle) * r1, center + Math.sin(angle) * r1);
      ctx.lineTo(center + Math.cos(angle) * r2, center + Math.sin(angle) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // Pupil (jet black, sharp edge)
    ctx.fillStyle = '#080604';
    ctx.beginPath();
    ctx.arc(center, center, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    // Fine inner pupil ring
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    this.cache.set(key, texture);
    return texture;
  }

  /**
   * Generates keratin horn texture for Beak, Cere, and Talons.
   */
  public static createBeakTexture(type: 'beak_yellow' | 'cere_yellow' | 'talon_black', size = 512): THREE.CanvasTexture {
    const key = `keratin_${type}_${size}`;
    if (this.cache.has(key)) return this.cache.get(key) as THREE.CanvasTexture;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    if (type === 'beak_yellow') {
      // Golden yellow beak with longitudinal keratin grain
      const grad = ctx.createLinearGradient(0, 0, size, 0);
      grad.addColorStop(0, '#f59e0b');
      grad.addColorStop(0.5, '#fbbf24');
      grad.addColorStop(1, '#eab308');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      // Micro keratin striations
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      for (let i = 0; i < 150; i++) {
        const x = Math.random() * size;
        ctx.globalAlpha = 0.15 + Math.random() * 0.2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 20, size);
        ctx.stroke();
      }
    } else if (type === 'cere_yellow') {
      // Porous, slightly textured fleshy yellow cere
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(0, 0, size, size);

      // Porous noise
      for (let i = 0; i < 4000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = Math.random() > 0.5 ? '#d97706' : '#fef08a';
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, 2, 2);
      }
    } else if (type === 'talon_black') {
      // Razor black keratin with subtle wear grooves
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, size, size);

      // Longitudinal wear lines
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * size;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() - 0.5) * 15, size);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1.0;

    const texture = new THREE.CanvasTexture(canvas);
    this.cache.set(key, texture);
    return texture;
  }

  /**
   * Generates raptor scaled tarsus (tarsometatarsus) texture.
   */
  public static createTarsusTexture(size = 512): THREE.CanvasTexture {
    const key = `tarsus_scales_${size}`;
    if (this.cache.has(key)) return this.cache.get(key) as THREE.CanvasTexture;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Yellow base
    ctx.fillStyle = '#eab308';
    ctx.fillRect(0, 0, size, size);

    // Draw hexagonal reptilian scutes/scales
    const scaleRows = 32;
    const scaleCols = 16;
    const r = size / scaleCols / 1.7;

    for (let row = 0; row < scaleRows; row++) {
      for (let col = 0; col < scaleCols; col++) {
        const cx = (col + (row % 2) * 0.5) * (r * 1.732);
        const cy = row * (r * 1.5);

        // Scale fill with gradient
        const scaleGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
        scaleGrad.addColorStop(0, '#fef08a');
        scaleGrad.addColorStop(0.7, '#f59e0b');
        scaleGrad.addColorStop(1, '#b45309');
        ctx.fillStyle = scaleGrad;

        ctx.beginPath();
        for (let a = 0; a < 6; a++) {
          const angle = (a * Math.PI) / 3;
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();

        // Scale border / groove
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 4);
    this.cache.set(key, texture);
    return texture;
  }
}

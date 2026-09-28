import * as THREE from 'three';

/**
 * Procedural PBR Texture Generator for AAA Realistic Eagle Model
 * Produces high-resolution Diffuse, Normal, Roughness, and Specular maps
 */
export class EagleTextures {
  constructor() {
    this.cache = {};
  }

  /**
   * Helper to create a canvas texture
   */
  createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  /**
   * Convert height/bump canvas to normal map
   */
  generateNormalMapFromCanvas(heightCanvas, strength = 1.5) {
    const width = heightCanvas.width;
    const height = heightCanvas.height;
    const { canvas, ctx } = this.createCanvas(width, height);
    
    const hCtx = heightCanvas.getContext('2d');
    const hData = hCtx.getImageData(0, 0, width, height).data;
    const nImg = ctx.createImageData(width, height);
    const nData = nImg.data;

    const getHeight = (x, y) => {
      x = (x + width) % width;
      y = (y + height) % height;
      const idx = (y * width + x) * 4;
      return hData[idx] / 255.0;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const left = getHeight(x - 1, y);
        const right = getHeight(x + 1, y);
        const up = getHeight(x, y - 1);
        const down = getHeight(x, y + 1);

        const dx = (right - left) * strength;
        const dy = (down - up) * strength;
        const dz = 1.0;

        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nx = (dx / len) * 0.5 + 0.5;
        const ny = (-dy / len) * 0.5 + 0.5;
        const nz = (dz / len) * 0.5 + 0.5;

        const idx = (y * width + x) * 4;
        nData[idx] = Math.floor(nx * 255);
        nData[idx + 1] = Math.floor(ny * 255);
        nData[idx + 2] = Math.floor(nz * 255);
        nData[idx + 3] = 255;
      }
    }

    ctx.putImageData(nImg, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /**
   * Generate Feather Flight Vane Textures (Primaries, Secondaries, Tail)
   */
  getFeatherTexture(type = 'flight', colorType = 'dark') {
    const key = `feather_${type}_${colorType}`;
    if (this.cache[key]) return this.cache[key];

    const size = 1024;
    const { canvas: diffCanvas, ctx: diffCtx } = this.createCanvas(size, size);
    const { canvas: bumpCanvas, ctx: bumpCtx } = this.createCanvas(size, size);
    const { canvas: roughCanvas, ctx: roughCtx } = this.createCanvas(size, size);

    // Color palettes
    let baseColor, tipColor, shaftColor, barbColor, barbHighlight;
    if (colorType === 'white') {
      // Bald eagle head/tail
      baseColor = '#f5f7fa';
      tipColor = '#ffffff';
      shaftColor = '#e2e8f0';
      barbColor = '#e6edf4';
      barbHighlight = '#ffffff';
    } else if (colorType === 'golden') {
      // Golden eagle nape
      baseColor = '#6b4423';
      tipColor = '#c48b3b';
      shaftColor = '#4a2c11';
      barbColor = '#8a5828';
      barbHighlight = '#d99b43';
    } else {
      // Dark chocolate brown body/primaries
      baseColor = '#1f1610';
      tipColor = '#2b1f16';
      shaftColor = '#0f0b08';
      barbColor = '#2d1e15';
      barbHighlight = '#3d2b1f';
    }

    // Base background fill
    diffCtx.fillStyle = baseColor;
    diffCtx.fillRect(0, 0, size, size);

    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    roughCtx.fillStyle = '#b0b0b0';
    roughCtx.fillRect(0, 0, size, size);

    // Draw central shaft (rachis) down the center
    const midX = size / 2;
    
    // Draw micro barbs angled off the rachis
    const barbCount = 350;
    for (let i = 0; i < barbCount; i++) {
      const y = (i / barbCount) * size;
      const angle = (Math.PI / 4) * (0.8 + 0.4 * (y / size));
      
      // Left vane barbs
      diffCtx.strokeStyle = (i % 2 === 0) ? barbColor : barbHighlight;
      diffCtx.lineWidth = 2.0;
      diffCtx.beginPath();
      diffCtx.moveTo(midX, y);
      const leftLen = (midX - 30) * (0.7 + 0.3 * Math.sin((y / size) * Math.PI));
      diffCtx.lineTo(midX - leftLen, y + Math.tan(angle) * (leftLen * 0.4));
      diffCtx.stroke();

      // Right vane barbs
      diffCtx.beginPath();
      diffCtx.moveTo(midX, y);
      const rightLen = (midX - 30) * (0.7 + 0.3 * Math.sin((y / size) * Math.PI));
      diffCtx.lineTo(midX + rightLen, y + Math.tan(angle) * (rightLen * 0.4));
      diffCtx.stroke();

      // Bump map for barbs
      bumpCtx.strokeStyle = (i % 2 === 0) ? '#ffffff' : '#404040';
      bumpCtx.lineWidth = 1.5;
      bumpCtx.beginPath();
      bumpCtx.moveTo(midX, y);
      bumpCtx.lineTo(midX - leftLen, y + Math.tan(angle) * (leftLen * 0.4));
      bumpCtx.moveTo(midX, y);
      bumpCtx.lineTo(midX + rightLen, y + Math.tan(angle) * (rightLen * 0.4));
      bumpCtx.stroke();
    }

    // Subtle gradient from base to tip
    const grad = diffCtx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, 'rgba(0,0,0,0.25)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.0)');
    grad.addColorStop(1, tipColor === '#ffffff' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)');
    diffCtx.fillStyle = grad;
    diffCtx.fillRect(0, 0, size, size);

    // Draw central Rachis (feather spine)
    const shaftGrad = diffCtx.createLinearGradient(midX - 8, 0, midX + 8, 0);
    shaftGrad.addColorStop(0, 'rgba(0,0,0,0.4)');
    shaftGrad.addColorStop(0.5, shaftColor);
    shaftGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
    diffCtx.fillStyle = shaftGrad;
    diffCtx.fillRect(midX - 6, 0, 12, size);

    // Rachis in bump map
    bumpCtx.fillStyle = '#ffffff';
    bumpCtx.fillRect(midX - 6, 0, 12, size);

    // Roughness variation
    roughCtx.fillStyle = '#555555'; // Shaft is smoother/shinier
    roughCtx.fillRect(midX - 6, 0, 12, size);

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    diffTexture.wrapS = THREE.ClampToEdgeWrapping;
    diffTexture.wrapT = THREE.ClampToEdgeWrapping;

    const normalTexture = this.generateNormalMapFromCanvas(bumpCanvas, 2.0);
    const roughTexture = new THREE.CanvasTexture(roughCanvas);

    const res = { diffTexture, normalTexture, roughTexture };
    this.cache[key] = res;
    return res;
  }

  /**
   * Generate Body & Head Contour Plumage Textures
   */
  getBodyFeatherTexture(colorType = 'dark') {
    const key = `body_${colorType}`;
    if (this.cache[key]) return this.cache[key];

    const size = 1024;
    const { canvas: diffCanvas, ctx: diffCtx } = this.createCanvas(size, size);
    const { canvas: bumpCanvas, ctx: bumpCtx } = this.createCanvas(size, size);
    const { canvas: roughCanvas, ctx: roughCtx } = this.createCanvas(size, size);

    let baseBg, featherDark, featherMid, featherLight;
    if (colorType === 'white') {
      baseBg = '#e8edf3';
      featherDark = '#dbe2ec';
      featherMid = '#f0f4f8';
      featherLight = '#ffffff';
    } else if (colorType === 'golden') {
      baseBg = '#40240d';
      featherDark = '#5c3514';
      featherMid = '#8a5323';
      featherLight = '#c98a3e';
    } else {
      // Classic Bald Eagle chocolate brown
      baseBg = '#1c130d';
      featherDark = '#140d09';
      featherMid = '#271b12';
      featherLight = '#3b2b1e';
    }

    diffCtx.fillStyle = baseBg;
    diffCtx.fillRect(0, 0, size, size);

    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    roughCtx.fillStyle = colorType === 'white' ? '#a0a0a0' : '#888888';
    roughCtx.fillRect(0, 0, size, size);

    // Draw overlapping scalloped contour feathers (shingle pattern)
    const rows = 32;
    const cols = 24;
    const cellW = size / cols;
    const cellH = size / rows;

    for (let r = 0; r < rows; r++) {
      const y = r * cellH;
      const offset = (r % 2) * (cellW * 0.5);
      for (let c = -1; c <= cols + 1; c++) {
        const x = c * cellW + offset;
        const w = cellW * 1.3;
        const h = cellH * 2.2;

        // Draw curved feather tip
        diffCtx.save();
        diffCtx.beginPath();
        diffCtx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, Math.PI);
        diffCtx.fillStyle = featherDark;
        diffCtx.fill();

        // Inner highlight
        diffCtx.beginPath();
        diffCtx.ellipse(x, y - 2, w * 0.45, h * 0.45, 0, 0, Math.PI);
        diffCtx.fillStyle = featherMid;
        diffCtx.fill();

        // Outer fringe rim highlight
        diffCtx.beginPath();
        diffCtx.lineWidth = 1.5;
        diffCtx.strokeStyle = featherLight;
        diffCtx.arc(x, y, w * 0.48, 0, Math.PI);
        diffCtx.stroke();
        diffCtx.restore();

        // Bump map scalloping
        bumpCtx.save();
        const grad = bumpCtx.createRadialGradient(x, y, 2, x, y, w * 0.6);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.8, '#a0a0a0');
        grad.addColorStop(1, '#303030');
        bumpCtx.fillStyle = grad;
        bumpCtx.beginPath();
        bumpCtx.ellipse(x, y, w * 0.5, h * 0.5, 0, 0, Math.PI);
        bumpCtx.fill();
        bumpCtx.restore();
      }
    }

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    diffTexture.wrapS = THREE.RepeatWrapping;
    diffTexture.wrapT = THREE.RepeatWrapping;
    diffTexture.repeat.set(4, 4);

    const normalTexture = this.generateNormalMapFromCanvas(bumpCanvas, 1.8);
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;
    normalTexture.repeat.set(4, 4);

    const roughTexture = new THREE.CanvasTexture(roughCanvas);
    roughTexture.wrapS = THREE.RepeatWrapping;
    roughTexture.wrapT = THREE.RepeatWrapping;
    roughTexture.repeat.set(4, 4);

    const res = { diffTexture, normalTexture, roughTexture };
    this.cache[key] = res;
    return res;
  }

  /**
   * Generate Hooked Beak & Waxy Cere Texture
   */
  getBeakTexture(preset = 'bald') {
    const key = `beak_${preset}`;
    if (this.cache[key]) return this.cache[key];

    const size = 1024;
    const { canvas: diffCanvas, ctx: diffCtx } = this.createCanvas(size, size);
    const { canvas: bumpCanvas, ctx: bumpCtx } = this.createCanvas(size, size);
    const { canvas: roughCanvas, ctx: roughCtx } = this.createCanvas(size, size);

    // Beak color gradient
    let billBase = '#ffc820'; // Bright raptor yellow
    let billTip = '#e6a100';  // Deep golden amber
    let billHighlight = '#ffdf6d';
    let cereColor = '#f5b800'; // Waxy fleshy cere

    if (preset === 'golden') {
      billBase = '#c8a030';
      billTip = '#2a2218'; // Golden eagle has dark/slate tipped beak!
    }

    // Base gradient from cere (top) to tip (bottom)
    const billGrad = diffCtx.createLinearGradient(0, 0, 0, size);
    billGrad.addColorStop(0, cereColor);
    billGrad.addColorStop(0.25, billBase);
    billGrad.addColorStop(0.85, billTip);
    billGrad.addColorStop(1, preset === 'golden' ? '#181410' : '#d48800');
    diffCtx.fillStyle = billGrad;
    diffCtx.fillRect(0, 0, size, size);

    // Draw longitudinal keratin growth striations and micro-ridges
    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 180; i++) {
      const x = (i / 180) * size;
      const alpha = 0.04 + Math.random() * 0.08;
      
      diffCtx.strokeStyle = Math.random() > 0.5 ? billHighlight : '#a06000';
      diffCtx.globalAlpha = alpha;
      diffCtx.lineWidth = 1 + Math.random() * 2;
      diffCtx.beginPath();
      diffCtx.moveTo(x, 0);
      diffCtx.quadraticCurveTo(x + (Math.random() - 0.5) * 20, size * 0.5, x, size);
      diffCtx.stroke();

      bumpCtx.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#303030';
      bumpCtx.globalAlpha = 0.2;
      bumpCtx.lineWidth = 1.5;
      bumpCtx.beginPath();
      bumpCtx.moveTo(x, 0);
      bumpCtx.quadraticCurveTo(x + (Math.random() - 0.5) * 20, size * 0.5, x, size);
      bumpCtx.stroke();
    }
    diffCtx.globalAlpha = 1.0;
    bumpCtx.globalAlpha = 1.0;

    // Roughness: Cere is slightly matte (0.6), beak culmen is smooth polished keratin (0.2 - 0.3)
    const roughGrad = roughCtx.createLinearGradient(0, 0, 0, size);
    roughGrad.addColorStop(0, '#999999'); // Cere matte
    roughGrad.addColorStop(0.2, '#505050'); // Smooth keratin
    roughGrad.addColorStop(0.9, '#404040'); // Tip polished
    roughGrad.addColorStop(1, '#333333');
    roughCtx.fillStyle = roughGrad;
    roughCtx.fillRect(0, 0, size, size);

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    const normalTexture = this.generateNormalMapFromCanvas(bumpCanvas, 1.5);
    const roughTexture = new THREE.CanvasTexture(roughCanvas);

    const res = { diffTexture, normalTexture, roughTexture };
    this.cache[key] = res;
    return res;
  }

  /**
   * Generate Raptor Eye Textures (Amber Iris, Limbal Ring, Cornea Specular)
   */
  getEyeTexture() {
    const key = 'raptor_eye';
    if (this.cache[key]) return this.cache[key];

    const size = 512;
    const { canvas: diffCanvas, ctx: diffCtx } = this.createCanvas(size, size);
    const { canvas: bumpCanvas, ctx: bumpCtx } = this.createCanvas(size, size);
    const { canvas: roughCanvas, ctx: roughCtx } = this.createCanvas(size, size);

    const cx = size / 2;
    const cy = size / 2;
    const irisR = size * 0.44;
    const pupilR = size * 0.18;

    // Outer Sclera / Limbal Ring (Dark deep ring)
    diffCtx.fillStyle = '#110b06';
    diffCtx.fillRect(0, 0, size, size);

    // Iris base radial gradient (Vivid Pale Amber Yellow - classic Bald Eagle eye)
    const irisGrad = diffCtx.createRadialGradient(cx, cy, pupilR * 0.8, cx, cy, irisR);
    irisGrad.addColorStop(0, '#f2d438'); // Inner bright yellow
    irisGrad.addColorStop(0.5, '#e5b61a'); // Amber mid
    irisGrad.addColorStop(0.85, '#a6700c'); // Deep amber
    irisGrad.addColorStop(1.0, '#1a1208'); // Dark limbal edge

    diffCtx.beginPath();
    diffCtx.arc(cx, cy, irisR, 0, Math.PI * 2);
    diffCtx.fillStyle = irisGrad;
    diffCtx.fill();

    // Radial iris micro-fibers (ciliary fibers)
    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    const fiberCount = 200;
    for (let i = 0; i < fiberCount; i++) {
      const angle = (i / fiberCount) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      const r1 = pupilR + (Math.random() * 10);
      const r2 = irisR - (Math.random() * 8);

      diffCtx.strokeStyle = Math.random() > 0.4 ? '#fff089' : '#7c4c04';
      diffCtx.globalAlpha = 0.4 + Math.random() * 0.4;
      diffCtx.lineWidth = 1.2;
      diffCtx.beginPath();
      diffCtx.moveTo(cx + cos * r1, cy + sin * r1);
      diffCtx.lineTo(cx + cos * r2, cy + sin * r2);
      diffCtx.stroke();

      bumpCtx.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#404040';
      bumpCtx.globalAlpha = 0.3;
      bumpCtx.lineWidth = 1.0;
      bumpCtx.beginPath();
      bumpCtx.moveTo(cx + cos * r1, cy + sin * r1);
      bumpCtx.lineTo(cx + cos * r2, cy + sin * r2);
      bumpCtx.stroke();
    }
    diffCtx.globalAlpha = 1.0;
    bumpCtx.globalAlpha = 1.0;

    // Pupil (Piercing Deep Black)
    diffCtx.beginPath();
    diffCtx.arc(cx, cy, pupilR, 0, Math.PI * 2);
    diffCtx.fillStyle = '#050403';
    diffCtx.fill();

    // Pupil boundary smooth blend
    diffCtx.lineWidth = 2;
    diffCtx.strokeStyle = 'rgba(10, 6, 2, 0.8)';
    diffCtx.stroke();

    // Cornea Roughness: Super glossy glass (roughness 0.05)
    roughCtx.fillStyle = '#101010';
    roughCtx.fillRect(0, 0, size, size);

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    const normalTexture = this.generateNormalMapFromCanvas(bumpCanvas, 1.2);
    const roughTexture = new THREE.CanvasTexture(roughCanvas);

    const res = { diffTexture, normalTexture, roughTexture };
    this.cache[key] = res;
    return res;
  }

  /**
   * Generate Scaled Leg & Talon Textures (Reticulate & Scute Scales + Black Keratin Claws)
   */
  getLegAndTalonTexture() {
    const key = 'leg_talon';
    if (this.cache[key]) return this.cache[key];

    const size = 1024;
    const { canvas: diffCanvas, ctx: diffCtx } = this.createCanvas(size, size);
    const { canvas: bumpCanvas, ctx: bumpCtx } = this.createCanvas(size, size);
    const { canvas: roughCanvas, ctx: roughCtx } = this.createCanvas(size, size);

    // Top half: Raptor Scaled Skin (Deep vibrant yellow with scale borders)
    // Bottom half: Talon Black Keratin (Glossy sharp hooked claws)

    // Fill Leg portion (Top)
    diffCtx.fillStyle = '#fab800';
    diffCtx.fillRect(0, 0, size, size * 0.65);

    // Fill Talon portion (Bottom)
    diffCtx.fillStyle = '#151311';
    diffCtx.fillRect(0, size * 0.65, size, size * 0.35);

    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    roughCtx.fillStyle = '#707070'; // Leg scale roughness (0.45)
    roughCtx.fillRect(0, 0, size, size * 0.65);
    roughCtx.fillStyle = '#282828'; // Talon polished roughness (0.15)
    roughCtx.fillRect(0, size * 0.65, size, size * 0.35);

    // Draw reticulated hexagonal scales & scute plates on leg portion
    const scaleSize = 24;
    for (let y = 0; y < size * 0.65; y += scaleSize) {
      const row = Math.floor(y / scaleSize);
      const xOffset = (row % 2) * (scaleSize * 0.5);
      for (let x = -scaleSize; x < size + scaleSize; x += scaleSize) {
        const px = x + xOffset;
        const py = y;

        // Draw scale tile
        diffCtx.strokeStyle = '#c28500'; // Darker groove
        diffCtx.lineWidth = 2.0;
        diffCtx.beginPath();
        diffCtx.arc(px, py, scaleSize * 0.45, 0, Math.PI * 2);
        diffCtx.stroke();

        // Scale center highlight
        diffCtx.fillStyle = '#ffd13b';
        diffCtx.beginPath();
        diffCtx.arc(px, py, scaleSize * 0.32, 0, Math.PI * 2);
        diffCtx.fill();

        // Bump for scales (Pebbled raised pads)
        const sGrad = bumpCtx.createRadialGradient(px, py, 1, px, py, scaleSize * 0.5);
        sGrad.addColorStop(0, '#ffffff');
        sGrad.addColorStop(0.7, '#a0a0a0');
        sGrad.addColorStop(1, '#404040');
        bumpCtx.fillStyle = sGrad;
        bumpCtx.beginPath();
        bumpCtx.arc(px, py, scaleSize * 0.45, 0, Math.PI * 2);
        bumpCtx.fill();
      }
    }

    // Talon striations & highlights (Bottom section)
    for (let i = 0; i < 120; i++) {
      const x = (i / 120) * size;
      diffCtx.strokeStyle = Math.random() > 0.6 ? '#2c2926' : '#0c0a09';
      diffCtx.lineWidth = 1.5;
      diffCtx.beginPath();
      diffCtx.moveTo(x, size * 0.65);
      diffCtx.lineTo(x + (Math.random() - 0.5) * 15, size);
      diffCtx.stroke();

      bumpCtx.strokeStyle = Math.random() > 0.5 ? '#b0b0b0' : '#404040';
      bumpCtx.lineWidth = 1.0;
      bumpCtx.beginPath();
      bumpCtx.moveTo(x, size * 0.65);
      bumpCtx.lineTo(x, size);
      bumpCtx.stroke();
    }

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    diffTexture.wrapS = THREE.RepeatWrapping;
    diffTexture.wrapT = THREE.RepeatWrapping;

    const normalTexture = this.generateNormalMapFromCanvas(bumpCanvas, 2.0);
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;

    const roughTexture = new THREE.CanvasTexture(roughCanvas);

    const res = { diffTexture, normalTexture, roughTexture };
    this.cache[key] = res;
    return res;
  }

  /**
   * Generate Oral Cavity & Tongue Textures for Screech Animation
   */
  getMouthTexture() {
    const key = 'mouth_interior';
    if (this.cache[key]) return this.cache[key];

    const size = 512;
    const { canvas: diffCanvas, ctx: diffCtx } = this.createCanvas(size, size);
    const { canvas: bumpCanvas, ctx: bumpCtx } = this.createCanvas(size, size);
    const { canvas: roughCanvas, ctx: roughCtx } = this.createCanvas(size, size);

    // Deep pink / fleshy oral mucosa
    const mouthGrad = diffCtx.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size * 0.5);
    mouthGrad.addColorStop(0, '#d94b59');
    mouthGrad.addColorStop(0.7, '#a82c38');
    mouthGrad.addColorStop(1, '#66141c');
    diffCtx.fillStyle = mouthGrad;
    diffCtx.fillRect(0, 0, size, size);

    // Papillae bumps
    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 300; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 2 + Math.random() * 4;

      diffCtx.fillStyle = 'rgba(255, 180, 190, 0.4)';
      diffCtx.beginPath();
      diffCtx.arc(x, y, r, 0, Math.PI * 2);
      diffCtx.fill();

      bumpCtx.fillStyle = '#d0d0d0';
      bumpCtx.beginPath();
      bumpCtx.arc(x, y, r, 0, Math.PI * 2);
      bumpCtx.fill();
    }

    // Wet shiny mucosa
    roughCtx.fillStyle = '#202020';
    roughCtx.fillRect(0, 0, size, size);

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    const normalTexture = this.generateNormalMapFromCanvas(bumpCanvas, 1.5);
    const roughTexture = new THREE.CanvasTexture(roughCanvas);

    const res = { diffTexture, normalTexture, roughTexture };
    this.cache[key] = res;
    return res;
  }
}

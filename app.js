const canvas = document.querySelector('#rockCanvas');
const canvasWrap = document.querySelector('#canvasWrap');
const ctx = canvas.getContext('2d');

const defaults = {
  seed: '482193',
  facets: 28,
  roughness: 52,
  mass: 115,
  palette: 'slate',
  yaw: -26,
  pitch: -10,
  zoom: 1,
  lightX: -0.55,
  lightY: 0.75,
};

const palettes = {
  slate: { name: 'Slate', dark: '#2f3938', mid: '#697971', light: '#adbeae', edge: '#25302f', swatch: '#77877d' },
  granite: { name: 'Granite', dark: '#2b3032', mid: '#656a6a', light: '#a7aaa5', edge: '#22282a', swatch: '#777a78' },
  sand: { name: 'Sand', dark: '#624b39', mid: '#997955', light: '#d0b47f', edge: '#523c2f', swatch: '#ae895f' },
  moss: { name: 'Moss', dark: '#344136', mid: '#6d7959', light: '#aab27e', edge: '#29352c', swatch: '#7d8c5e' },
};

let state = { ...defaults };
let mesh = null;
let canvasWidth = 0;
let canvasHeight = 0;
let dragState = null;
let lightDrag = false;
let toastTimeout;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hashSeed(input) {
  let h = 2166136261;
  const value = String(input || '0');
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomGenerator(seed) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  const value = Math.floor(100000 + Math.random() * 899999);
  return String(value);
}

function generateMesh() {
  const rng = randomGenerator(state.seed);
  // A small segment range keeps the silhouette intentional while the control still changes density.
  const segments = Math.round(7 + (state.facets / 56) * 9);
  const rough = state.roughness / 100;
  const height = state.mass / 100;
  const points = [];
  const rings = [
    { y: 0.61, r: 0.45 },
    { y: 0.20, r: 0.82 },
    { y: -0.29, r: 0.79 },
  ];

  points.push({ x: 0, y: 0.94 * height, z: 0 });
  rings.forEach((ring, ringIndex) => {
    const ringWobble = 1 + (rng() - 0.5) * rough * 0.22;
    const offsetX = (rng() - 0.5) * rough * 0.12;
    const offsetZ = (rng() - 0.5) * rough * 0.12;
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2 + (ringIndex % 2 ? (rng() - 0.5) * 0.045 : 0);
      const localVariation = 1 + (rng() - 0.5) * rough * 0.48;
      const xScale = 1 + (rng() - 0.5) * rough * 0.14;
      const zScale = 1 + (rng() - 0.5) * rough * 0.14;
      const radius = ring.r * ringWobble * localVariation;
      points.push({
        x: Math.cos(angle) * radius * xScale + offsetX,
        y: ring.y * height + (rng() - 0.5) * rough * 0.13,
        z: Math.sin(angle) * radius * zScale + offsetZ,
      });
    }
  });
  const bottomIndex = points.length;
  points.push({ x: 0, y: -0.78 * height, z: 0 });

  const faces = [];
  const topIndex = 0;
  const firstRing = 1;
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    faces.push({ indices: [topIndex, firstRing + index, firstRing + next], variation: rng() });
  }
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const currentStart = 1 + ringIndex * segments;
    const nextStart = currentStart + segments;
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const a = currentStart + index;
      const b = currentStart + next;
      const c = nextStart + next;
      const d = nextStart + index;
      if ((index + ringIndex) % 2 === 0) {
        faces.push({ indices: [a, b, c], variation: rng() });
        faces.push({ indices: [a, c, d], variation: rng() });
      } else {
        faces.push({ indices: [a, b, d], variation: rng() });
        faces.push({ indices: [b, c, d], variation: rng() });
      }
    }
  }
  const lastRing = 1 + (rings.length - 1) * segments;
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    faces.push({ indices: [lastRing + index, bottomIndex, lastRing + next], variation: rng() });
  }

  return {
    points,
    faces,
    segments,
    polygonCount: segments * 4,
    triangleCount: faces.length,
  };
}

function rotatePoint(point) {
  const yaw = (state.yaw * Math.PI) / 180;
  const pitch = (state.pitch * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x = point.x * cosYaw + point.z * sinYaw;
  const zAfterYaw = -point.x * sinYaw + point.z * cosYaw;
  const y = point.y * Math.cos(pitch) - zAfterYaw * Math.sin(pitch);
  const z = point.y * Math.sin(pitch) + zAfterYaw * Math.cos(pitch);
  return { x, y, z };
}

function normalFor(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  let normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  normal = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  if (normal.z < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  return normal;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function mixHex(a, b, amount) {
  const colorA = hexToRgb(a);
  const colorB = hexToRgb(b);
  const t = clamp(amount, 0, 1);
  const r = Math.round(colorA.r + (colorB.r - colorA.r) * t);
  const g = Math.round(colorA.g + (colorB.g - colorA.g) * t);
  const bValue = Math.round(colorA.b + (colorB.b - colorA.b) * t);
  return `rgb(${r}, ${g}, ${bValue})`;
}

function getFaceColor(palette, light, variation) {
  const lit = clamp(light + (variation - 0.5) * 0.045, 0, 1);
  if (lit < 0.48) return mixHex(palette.dark, palette.mid, lit / 0.48);
  return mixHex(palette.mid, palette.light, (lit - 0.48) / 0.52);
}

function resizeCanvas() {
  const rect = canvasWrap.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvasWidth = Math.max(1, rect.width);
  canvasHeight = Math.max(1, rect.height);
  canvas.width = Math.round(canvasWidth * ratio);
  canvas.height = Math.round(canvasHeight * ratio);
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  render();
}

function drawBackground() {
  const gradient = ctx.createRadialGradient(canvasWidth * 0.5, canvasHeight * 0.36, 8, canvasWidth * 0.5, canvasHeight * 0.48, canvasHeight * 0.82);
  gradient.addColorStop(0, '#27312f');
  gradient.addColorStop(0.42, '#1c2523');
  gradient.addColorStop(1, '#141a1a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

function render() {
  if (!canvasWidth || !canvasHeight) return;
  if (!mesh) mesh = generateMesh();
  drawBackground();

  const scale = Math.min(canvasWidth, canvasHeight) * 0.355 * state.zoom;
  const centerX = canvasWidth * 0.5;
  const centerY = canvasHeight * 0.49;
  const projected = mesh.points.map((point) => {
    const rotated = rotatePoint(point);
    const perspective = 1 / (1 - rotated.z * 0.16);
    return {
      x: centerX + rotated.x * scale * perspective,
      y: centerY - rotated.y * scale * perspective,
      z: rotated.z,
    };
  });

  // A soft grounding shadow makes the silhouette sit on the viewport without adding a texture.
  ctx.save();
  ctx.translate(centerX + state.yaw * 0.02, centerY + scale * 0.83);
  ctx.scale(1.15 * state.zoom, 0.19 * state.zoom);
  ctx.filter = 'blur(15px)';
  ctx.fillStyle = 'rgba(0, 0, 0, .53)';
  ctx.beginPath();
  ctx.arc(0, 0, scale * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const light = { x: state.lightX * 0.72, y: state.lightY * 0.72, z: 1 };
  const lightLength = Math.hypot(light.x, light.y, light.z);
  light.x /= lightLength;
  light.y /= lightLength;
  light.z /= lightLength;
  const palette = palettes[state.palette];
  const sortedFaces = mesh.faces
    .map((face) => {
      const [a, b, c] = face.indices.map((index) => mesh.points[index]);
      const normal = normalFor(a, b, c);
      const averageZ = face.indices.reduce((sum, index) => sum + projected[index].z, 0) / 3;
      const brightness = 0.19 + Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z) * 0.81;
      return { face, normal, averageZ, brightness };
    })
    .sort((a, b) => a.averageZ - b.averageZ);

  ctx.lineJoin = 'round';
  sortedFaces.forEach(({ face, brightness }) => {
    const [a, b, c] = face.indices.map((index) => projected[index]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fillStyle = getFaceColor(palette, brightness, face.variation);
    ctx.fill();
    ctx.strokeStyle = `${palette.edge}b8`;
    ctx.lineWidth = 0.65;
    ctx.stroke();
  });

  updateStats();
}

function updateStats() {
  $('#faceCount').textContent = mesh.polygonCount;
  $('#vertexCount').textContent = mesh.points.length;
  $('#triCount').textContent = mesh.triangleCount;
  $('#seedReadout').textContent = formatSeed(state.seed);
  $('#paletteName').textContent = palettes[state.palette].name;
  $('#selectionSwatch').style.background = palettes[state.palette].swatch;
  updateLightUI();
}

function formatSeed(seed) {
  const clean = String(seed).replace(/\D/g, '') || '0';
  return clean.padStart(6, '0').slice(-6).replace(/(\d{3})(?=\d)/g, '$1 ');
}

function updateRange(range, output, formatter) {
  const min = Number(range.min);
  const max = Number(range.max);
  const value = Number(range.value);
  range.style.setProperty('--progress', `${((value - min) / (max - min)) * 100}%`);
  output.textContent = formatter(value);
}

function syncRanges() {
  const facets = $('#facets');
  const roughness = $('#roughness');
  const mass = $('#mass');
  facets.value = state.facets;
  roughness.value = state.roughness;
  mass.value = state.mass;
  updateRange(facets, $('#facetsOutput'), (value) => value);
  updateRange(roughness, $('#roughnessOutput'), (value) => `${value}%`);
  updateRange(mass, $('#massOutput'), (value) => `${(value / 100).toFixed(2)}×`);
}

function rebuild() {
  mesh = generateMesh();
  render();
}

function showToast(message) {
  $('#toastMessage').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 2200);
}

function updateLightUI() {
  const handle = $('#lightHandle');
  if (!handle) return;
  handle.style.left = `${50 + state.lightX * 27}%`;
  handle.style.top = `${50 - state.lightY * 27}%`;
  const directionX = state.lightX < -0.22 ? 'W' : state.lightX > 0.22 ? 'E' : '';
  const directionY = state.lightY > 0.22 ? 'N' : state.lightY < -0.22 ? 'S' : '';
  const direction = `${directionY}${directionX}` || 'C';
  const angle = Math.round(Math.abs(Math.atan2(state.lightX, state.lightY)) * 180 / Math.PI);
  $('#lightPosition').textContent = `${direction} / ${angle}°`;
}

function setPalette(name) {
  state.palette = name;
  $$('.palette-choice').forEach((choice) => choice.classList.toggle('active', choice.dataset.palette === name));
  render();
}

function resetParameters() {
  state = { ...defaults };
  $('#seedInput').value = state.seed;
  syncRanges();
  setPalette(state.palette);
  rebuild();
  showToast('Parameters reset');
}

function randomize() {
  state.seed = randomSeed();
  $('#seedInput').value = state.seed;
  rebuild();
  showToast('New rock generated');
}

function exportPng() {
  const link = document.createElement('a');
  link.download = `rock-${state.seed}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('PNG exported');
}

async function copyConfig() {
  const config = JSON.stringify({ seed: state.seed, facets: state.facets, irregularity: state.roughness, mass: state.mass / 100, palette: state.palette }, null, 2);
  try {
    await navigator.clipboard.writeText(config);
    showToast('Configuration copied');
  } catch (error) {
    showToast('Copy unavailable in this browser');
  }
}

function applyPreset(preset) {
  const presets = {
    river: { seed: '482193', facets: 28, roughness: 52, mass: 115, palette: 'slate' },
    basalt: { seed: '731608', facets: 40, roughness: 71, mass: 124, palette: 'granite' },
    sandstone: { seed: '209467', facets: 22, roughness: 38, mass: 106, palette: 'sand' },
  };
  Object.assign(state, presets[preset]);
  $('#seedInput').value = state.seed;
  syncRanges();
  setPalette(state.palette);
  rebuild();
  $$('.preset-item').forEach((item) => item.classList.toggle('selected', item.dataset.preset === preset));
  showToast(`${presets[preset].palette[0].toUpperCase() + presets[preset].palette.slice(1)} preset loaded`);
}

['facets', 'roughness', 'mass'].forEach((id) => {
  const input = $(`#${id}`);
  input.addEventListener('input', () => {
    state[id] = Number(input.value);
    const formatter = id === 'roughness' ? (value) => `${value}%` : id === 'mass' ? (value) => `${(value / 100).toFixed(2)}×` : (value) => value;
    updateRange(input, $(`#${id}Output`), formatter);
    rebuild();
  });
});

$('#seedInput').addEventListener('input', (event) => {
  const clean = event.target.value.replace(/\D/g, '').slice(0, 12);
  event.target.value = clean;
  state.seed = clean || '0';
  rebuild();
});
$('#seedInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
    showToast('Seed applied');
  }
});
$('#randomSeed').addEventListener('click', randomize);
$('#generateButton').addEventListener('click', () => {
  const button = $('#generateButton');
  button.classList.add('is-generating');
  rebuild();
  setTimeout(() => button.classList.remove('is-generating'), 420);
  showToast('Rock generated');
});
$('#resetParams').addEventListener('click', resetParameters);
$('#exportTop').addEventListener('click', exportPng);
$('#copyConfig').addEventListener('click', copyConfig);
$('#resetView').addEventListener('click', () => {
  state.yaw = -26;
  state.pitch = -10;
  state.zoom = 1;
  render();
  showToast('View reset');
});
$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else canvasWrap.requestFullscreen?.();
});
$$('.palette-choice').forEach((choice) => choice.addEventListener('click', () => setPalette(choice.dataset.palette)));
$$('.preset-item').forEach((item) => item.addEventListener('click', () => applyPreset(item.dataset.preset)));
$$('.nav-item').forEach((item) => item.addEventListener('click', () => {
  $$('.nav-item').forEach((nav) => nav.classList.remove('active'));
  item.classList.add('active');
  if (item.textContent.includes('Generator')) showToast('Generator workspace');
  else showToast(`${item.textContent.trim()} is coming next`);
}));

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  dragState = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragState) return;
  state.yaw = dragState.yaw + (event.clientX - dragState.x) * 0.42;
  state.pitch = clamp(dragState.pitch + (event.clientY - dragState.y) * 0.32, -50, 50);
  render();
});
canvas.addEventListener('pointerup', () => { dragState = null; });
canvas.addEventListener('pointercancel', () => { dragState = null; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom = clamp(state.zoom - event.deltaY * 0.0008, 0.72, 1.35);
  render();
}, { passive: false });

function setLightFromPointer(event) {
  const orb = $('.light-orb');
  const rect = orb.getBoundingClientRect();
  const x = clamp((event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
  const y = clamp(-((event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)), -1, 1);
  const length = Math.hypot(x, y) || 1;
  const scale = Math.min(1, 0.92 / length);
  state.lightX = x * scale;
  state.lightY = y * scale;
  render();
}
$('.light-orb').addEventListener('pointerdown', (event) => {
  lightDrag = true;
  $('.light-orb').setPointerCapture(event.pointerId);
  setLightFromPointer(event);
});
$('.light-orb').addEventListener('pointermove', (event) => {
  if (lightDrag) setLightFromPointer(event);
});
$('.light-orb').addEventListener('pointerup', () => { lightDrag = false; });
$('.light-orb').addEventListener('pointercancel', () => { lightDrag = false; });

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (typing) return;
  if (event.key.toLowerCase() === 'r' || (event.ctrlKey && event.key === 'Enter')) {
    event.preventDefault();
    randomize();
  }
  if (event.key.toLowerCase() === 'e') {
    event.preventDefault();
    exportPng();
  }
});
window.addEventListener('resize', resizeCanvas);

syncRanges();
updateLightUI();
resizeCanvas();

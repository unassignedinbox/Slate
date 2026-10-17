// Greybox palette. Everything is a neutral grey so that scale, cover and
// route are readable before any art exists. Keys match item.mat in the level.

import * as THREE from 'three';

export const PALETTE = {
  sky: '#c7ccd3',
  fog: '#c7ccd3',
  street: '#9a9ea4',
  roof: '#7b8087',
  deck: '#b5b9bf',
  kerb: '#d0d3d8',
  wall: '#8e939a',
  floor: '#a6aab0',
  chimney: '#6d7278',
  crack: '#2c3034',
  wood: '#8f9197',
  metal: '#5f646b',
  trim: '#6b7077',
  fabric: '#b8bbc0',
  rubble: '#80858c',
  gate: '#585d64',
  island: '#6f747b',
  portal: '#e4e9ef',
  portalExit: '#cdd4dd',
  carBody: '#d9dbdf',
  carCabin: '#9aa0a8',
  carWheel: '#2a2d31',
};

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d');
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#f1f2f4' : '#2d3136';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function makeMaterials() {
  const std = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.0, ...extra });
  const mats = {};
  for (const key of ['street', 'roof', 'deck', 'kerb', 'wall', 'floor', 'chimney', 'crack', 'wood', 'metal', 'trim', 'fabric', 'rubble', 'gate', 'island', 'carBody', 'carCabin', 'carWheel']) {
    mats[key] = std(PALETTE[key]);
  }
  mats.crack.polygonOffset = true;
  mats.crack.polygonOffsetFactor = -2;
  mats.portal = new THREE.MeshStandardMaterial({
    color: PALETTE.portal,
    emissive: '#8f98a3',
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 1,
  });
  mats.portalExit = mats.portal.clone();
  mats.portalExit.color = new THREE.Color(PALETTE.portalExit);
  mats.portalExit.opacity = 0.3;
  mats.banner = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.9, side: THREE.DoubleSide });
  mats.debugRoute = new THREE.LineBasicMaterial({ color: '#2b2f35' });
  mats.debugProbe = new THREE.MeshBasicMaterial({ color: '#111315' });
  return mats;
}

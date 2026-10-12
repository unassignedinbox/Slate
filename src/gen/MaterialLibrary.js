/* ============================================================================
   MaterialLibrary — one MeshStandardMaterial per surface key.

   All road geometry is UV'd in metres, so each texture's repeat is simply
   1 / tileSize. That means texel density is identical on a 2 m footpath and a
   40 m motorway, and never needs per-mesh tuning.
   ========================================================================== */

import * as THREE from 'three';
import { SURFACES } from '../model/Presets.js';
import { bakeSurface, buildSymbolAtlas } from './Textures.js';

export function buildMaterials(env) {
  const mats = new Map();

  for (const [key, def] of Object.entries(SURFACES)) {
    const { map, normalMap } = bakeSurface(key);
    const tile = def.tile || 2;
    map.repeat.set(1 / tile, 1 / tile);
    normalMap.repeat.set(1 / tile, 1 / tile);

    const isPaint = def.kind === 'paint' || def.kind === 'chequer';
    const m = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(def.bump ?? 1, def.bump ?? 1).multiplyScalar(0.9),
      roughness: def.rough,
      metalness: def.metal ?? 0,
      envMap: env || null,
      envMapIntensity: def.metal ? 1.1 : 0.55,
      name: `surf:${key}`,
      side: THREE.FrontSide,
    });
    if (isPaint) {
      // Markings live a few mm above the carriageway; bias the depth test so
      // they never z-fight with the surface they are painted on.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -4;
      m.polygonOffsetUnits = -8;
      m.envMapIntensity = 0.25;
    }
    mats.set(key, m);
  }

  /* --- road symbol atlas: transparent decal sheet --- */
  const atlas = buildSymbolAtlas();
  const sym = new THREE.MeshStandardMaterial({
    map: atlas,
    transparent: true,
    alphaTest: 0.42,
    roughness: 0.55,
    metalness: 0,
    envMap: env || null,
    envMapIntensity: 0.2,
    name: 'surf:symbol',
    depthWrite: true,
  });
  sym.polygonOffset = true;
  sym.polygonOffsetFactor = -6;
  sym.polygonOffsetUnits = -10;
  mats.set('symbol', sym);

  /* --- ground / terrain --- */
  const ground = bakeSurface('grass');
  ground.map.repeat.set(1 / 6, 1 / 6);
  ground.normalMap.repeat.set(1 / 6, 1 / 6);
  const gm = new THREE.MeshStandardMaterial({
    map: ground.map,
    normalMap: ground.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.97,
    metalness: 0,
    envMap: env || null,
    envMapIntensity: 0.35,
    color: new THREE.Color('#5d6b4a'),
    name: 'surf:ground',
  });
  mats.set('ground', gm);

  /* --- prop materials --- */
  mats.set('prop:metal', new THREE.MeshStandardMaterial({
    color: '#5c626a', roughness: 0.44, metalness: 0.85,
    envMap: env || null, envMapIntensity: 1.0, name: 'prop:metal',
  }));
  mats.set('prop:metalDark', new THREE.MeshStandardMaterial({
    color: '#2c3034', roughness: 0.55, metalness: 0.7,
    envMap: env || null, envMapIntensity: 0.8, name: 'prop:metalDark',
  }));
  mats.set('prop:white', new THREE.MeshStandardMaterial({
    color: '#e9e9e4', roughness: 0.5, metalness: 0.05,
    envMap: env || null, name: 'prop:white',
  }));
  mats.set('prop:red', new THREE.MeshStandardMaterial({
    color: '#c8382c', roughness: 0.5, metalness: 0.05,
    envMap: env || null, name: 'prop:red',
  }));
  mats.set('prop:yellow', new THREE.MeshStandardMaterial({
    color: '#e0b531', roughness: 0.5, metalness: 0.05,
    envMap: env || null, name: 'prop:yellow',
  }));
  mats.set('prop:trunk', new THREE.MeshStandardMaterial({
    color: '#4a3b2c', roughness: 0.92, metalness: 0,
    envMap: env || null, name: 'prop:trunk',
  }));
  mats.set('prop:leaf', new THREE.MeshStandardMaterial({
    color: '#4e7a3d', roughness: 0.9, metalness: 0,
    envMap: env || null, name: 'prop:leaf', flatShading: true,
  }));
  mats.set('prop:crete', new THREE.MeshStandardMaterial({
    color: '#9a9c98', roughness: 0.8, metalness: 0,
    envMap: env || null, name: 'prop:crete',
  }));

  /* --- editor helpers --- */
  mats.set('helper:select', new THREE.LineBasicMaterial({ color: 0x35c8ff, transparent: true, opacity: 0.95, depthTest: false }));
  mats.set('helper:hover', new THREE.LineBasicMaterial({ color: 0xffb340, transparent: true, opacity: 0.8, depthTest: false }));
  mats.set('helper:node', new THREE.MeshBasicMaterial({ color: 0x35c8ff, transparent: true, opacity: 0.9, depthTest: false }));
  mats.set('helper:nodeSel', new THREE.MeshBasicMaterial({ color: 0xffb340, depthTest: false }));

  return mats;
}

/** Material used by each instanced prop type. */
export function propMaterial(type, mats) {
  switch (type) {
    case 'lamp':
    case 'lamp_wall':
    case 'catenaryMast':
      return mats.get('prop:metalDark');
    case 'bollard_heritage':
      return mats.get('prop:metalDark');
    case 'bollard':
      return mats.get('prop:metal');
    case 'crossbuck':
      return mats.get('prop:white');
    case 'boom':
      return mats.get('prop:red');
    case 'tree':
      return mats.get('prop:leaf');
    case 'sign':
      return mats.get('prop:white');
    case 'gully':
      return mats.get('prop:crete');
    default:
      return mats.get('prop:metal');
  }
}

export function disposeMaterials(mats) {
  for (const m of mats.values()) m.dispose?.();
}

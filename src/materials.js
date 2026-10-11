// Shared material palette. One material per surface type; geometry
// builders merge into these so the city stays a handful of draw calls.
import * as THREE from 'three';
import { getTextures } from './textures.js';

let cache = null;

export function getMaterials() {
  if (cache) return cache;
  const T = getTextures();

  const std = (opts) =>
    new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02, ...opts });

  cache = {
    asphalt: std({ map: T.asphalt, color: 0xffffff, roughness: 0.95 }),
    asphaltTint: std({ map: T.asphalt, vertexColors: true, roughness: 0.95 }),
    asphaltBus: std({ map: T.asphaltBus, roughness: 0.95 }),
    asphaltCycle: std({ map: T.asphaltCycle, roughness: 0.95 }),
    paving: std({ map: T.paving, roughness: 0.88 }),
    concrete: std({ map: T.concrete, color: 0xb9b9b9, roughness: 0.85 }),
    concreteDark: std({ map: T.concrete, color: 0x8f8f8f, roughness: 0.85 }),
    curbStone: std({ map: T.concrete, color: 0x8d8478, roughness: 0.8 }),
    grass: std({ map: T.grass, roughness: 1 }),
    ballast: std({ map: T.ballast, roughness: 1 }),
    paintWhite: std({ color: 0xe9e9e9, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    paintYellow: std({ color: 0xd9b84a, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    paintRed: std({ color: 0xb23b3b, roughness: 0.7 }),
    symbolArrow: std({ map: T.arrowStraight, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    symbolArrowL: std({ map: T.arrowLeft, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    symbolArrowR: std({ map: T.arrowRight, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    symbolBike: std({ map: T.bikeSymbol, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    symbolBus: std({ map: T.busText, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    symbolRail: std({ map: T.railCrossingPaint, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    railSteel: std({ color: 0x8d8f94, roughness: 0.38, metalness: 0.85 }),
    sleeper: std({ color: 0x4c3f34, roughness: 0.9 }),
    metalDark: std({ color: 0x2c2e33, roughness: 0.55, metalness: 0.55 }),
    metalLight: std({ color: 0x9aa0aa, roughness: 0.45, metalness: 0.6 }),
    gateStripes: std({ map: T.gate, roughness: 0.75 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8fb0c9,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.38,
    }),
    water: new THREE.MeshStandardMaterial({
      map: T.water,
      color: 0x8fb6cf,
      roughness: 0.22,
      metalness: 0.32,
      transparent: true,
      opacity: 0.9,
    }),
    lampGlass: new THREE.MeshStandardMaterial({
      color: 0xfff3d6,
      emissive: 0xffe9b8,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    }),
    signalRed: new THREE.MeshStandardMaterial({
      color: 0x571515,
      emissive: 0xff2a2a,
      emissiveIntensity: 1.1,
      roughness: 0.4,
    }),
    signalAmber: new THREE.MeshStandardMaterial({
      color: 0x574215,
      emissive: 0xffb02a,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    }),
    signalGreen: new THREE.MeshStandardMaterial({
      color: 0x154722,
      emissive: 0x27d962,
      emissiveIntensity: 0.4,
      roughness: 0.4,
    }),
    bark: std({ color: 0x6a5240, roughness: 0.95 }),
    leaf: std({ color: 0x4c6b3c, roughness: 0.95 }),
    leafLight: std({ color: 0x5f7f47, roughness: 0.95 }),
    rubber: std({ color: 0x1c1c1e, roughness: 0.98 }),
    yellowBlack: std({ color: 0xc9a227, roughness: 0.8 }),
    pillar: std({ map: T.concrete, color: 0xa5a5a5, roughness: 0.85 }),
  };
  return cache;
}

// Greybox palette and shared materials. Everything is neutral grey, with warm stone for portals
// and a muted brass for the route line. No neon, no glow, nothing that reads as cyberpunk.
import * as THREE from 'three';

export const COLORS = {
  sky: 0xc3c7cc,
  fog: 0xc3c7cc,
  plateTop: 0x7b8087,
  plateRock: 0x5a5f66,
  roadStreet: 0x8e9399,
  roadRoof: 0x9ea3a9,
  roadBridge: 0x858a91,
  roadRamp: 0x8a8f96,
  roadSeam: 0x2c2f33,
  laneLine: 0xcfd2d6,
  wallHouse: 0xa9adb3,
  wallShop: 0x9ea3aa,
  wallTenement: 0xb3b7bc,
  wallWarehouse: 0x959ba2,
  wallLandmark: 0xbcc0c5,
  interior: 0x2f3338,
  window: 0x575c63,
  propWood: 0x9a9079,
  propMetal: 0x6f747b,
  propFabric: 0xb7b9bc,
  debris: 0x80858b,
  car: 0x3b3f45,
  carCabin: 0x9aa0a8,
  wheel: 0x23262a,
  gateStone: 0xd6cfbf,
  gatePane: 0xe8dcb4,
  finishPane: 0xcfd7dc,
  route: 0xc9a25a,
};

export function makeMaterials() {
  const std = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0, flatShading: true, ...extra });
  return {
    plateTop: std(COLORS.plateTop),
    plateRock: std(COLORS.plateRock),
    roadStreet: std(COLORS.roadStreet),
    roadRoof: std(COLORS.roadRoof),
    roadBridge: std(COLORS.roadBridge),
    roadRamp: std(COLORS.roadRamp),
    roadSeam: std(COLORS.roadSeam),
    laneLine: std(COLORS.laneLine, { emissive: 0x2a2c2e, emissiveIntensity: 0.25 }),
    house: std(COLORS.wallHouse),
    shop: std(COLORS.wallShop),
    tenement: std(COLORS.wallTenement),
    warehouse: std(COLORS.wallWarehouse),
    landmark: std(COLORS.wallLandmark),
    interior: std(COLORS.interior),
    window: std(COLORS.window),
    propWood: std(COLORS.propWood),
    propMetal: std(COLORS.propMetal),
    propFabric: std(COLORS.propFabric),
    debris: std(COLORS.debris),
    car: std(COLORS.car),
    carCabin: std(COLORS.carCabin),
    wheel: std(COLORS.wheel, { roughness: 0.8 }),
    gateStone: std(COLORS.gateStone),
    gatePane: new THREE.MeshStandardMaterial({
      color: COLORS.gatePane, roughness: 0.6, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
    }),
    finishPane: new THREE.MeshStandardMaterial({
      color: COLORS.finishPane, roughness: 0.6, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
    }),
    route: new THREE.LineBasicMaterial({ color: COLORS.route, transparent: true, opacity: 0.9 }),
  };
}

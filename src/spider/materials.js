import * as THREE from 'three';
import { buildChitinTextureSet } from '../utils/proceduralTexture.js';
import { PALETTE } from './proportions.js';

export function buildSpiderMaterials() {
  const exoTex = buildChitinTextureSet(11, 256, PALETTE.exoDark, PALETTE.exoDarkBrown);

  const exoskeleton = new THREE.MeshPhysicalMaterial({
    map: exoTex.map,
    normalMap: exoTex.normalMap,
    roughnessMap: exoTex.roughnessMap,
    roughness: 0.55,
    metalness: 0.05,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
    color: new THREE.Color(0xffffff),
  });

  const jointTex = buildChitinTextureSet(23, 256, PALETTE.jointOrange, PALETTE.jointOrangeBright);
  const jointGloss = new THREE.MeshPhysicalMaterial({
    map: jointTex.map,
    normalMap: jointTex.normalMap,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
  });

  const tarsusGlossy = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.exoDarkBrown),
    roughness: 0.32,
    metalness: 0.05,
    clearcoat: 0.85,
    clearcoatRoughness: 0.15,
  });

  const fang = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.fang),
    roughness: 0.18,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });

  const claw = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.claw),
    roughness: 0.35,
    metalness: 0.15,
  });

  const eye = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.eye),
    roughness: 0.05,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.4,
  });

  const spinneret = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PALETTE.exoDarkBrown),
    roughness: 0.5,
    clearcoat: 0.4,
  });

  const furBrown = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.furBrown),
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const furBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.furBlack),
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const furCarapace = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.carapaceHair),
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const furUrticating = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.urticatingPatch),
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const silk = new THREE.MeshPhysicalMaterial({
    color: 0xe8ddc8,
    roughness: 0.35,
    transparent: true,
    opacity: 0.35,
    transmission: 0.2,
    side: THREE.DoubleSide,
  });

  return {
    exoskeleton, jointGloss, tarsusGlossy, fang, claw, eye, spinneret,
    furBrown, furBlack, furCarapace, furUrticating, silk,
  };
}

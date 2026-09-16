// Shared uniform objects (single source of truth, referenced by all materials).
import * as THREE from 'three';
import { dominantWave } from './spectra.js';

export function createShared() {
  const v4array = () => Array.from({ length: 8 }, () => new THREE.Vector4());
  return {
    uTime: { value: 0 },
    // --- sea state ---
    uWindSpeed: { value: 9 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uFetch: { value: 120000 },
    uGamma: { value: 3.3 },
    uSpecMode: { value: 0 },
    uSwellHs: { value: 1.6 },
    uSwellTp: { value: 11 },
    uSwellDir: { value: new THREE.Vector2(1, 0) },
    uSwellBeta: { value: 9 },
    uSwellOn: { value: 1 },
    uEnergy: { value: 1 },
    uRefDepth: { value: 250 },
    uChop: { value: 1.0 },
    uChopLen: { value: 1.2 },
    // --- cascade displacement sampling ---
    uDisp0: { value: null },
    uDisp1: { value: null },
    uDisp2: { value: null },
    uTiles: { value: new THREE.Vector3(1024, 256, 64) },
    uDispPrev0: { value: null },
    uPeakK: { value: 0.033 },
    // --- analytic sources ---
    uSrcCount: { value: 0 },
    uSrcA: { value: v4array() },
    uSrcB: { value: v4array() },
    uSrcC: { value: v4array() },
    // --- bathymetry ---
    uBathy0: { value: new THREE.Vector4(1, 40, 0.02, 0) },
    uBathy1: { value: new THREE.Vector4(190, 2.4, 38, -160) },
    uBathy2: { value: new THREE.Vector4(1.6, 30, 0.49, 0) },
    // --- sky / sun ---
    uSunDir: { value: new THREE.Vector3(0.5, 0.5, 0.3).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.95, 0.88) },
    uZenith: { value: new THREE.Color(0.10, 0.28, 0.55) },
    uHorizon: { value: new THREE.Color(0.62, 0.74, 0.80) },
    uCloudiness: { value: 0.45 },
    uSkyTime: { value: 0 },
    // --- water shading ---
    uDeep: { value: new THREE.Color(0.012, 0.10, 0.16) },
    uMid: { value: new THREE.Color(0.03, 0.27, 0.33) },
    uShallow: { value: new THREE.Color(0.16, 0.55, 0.52) },
    uSSSColor: { value: new THREE.Color(0.1, 0.55, 0.45) },
    uHsRef: { value: 2.0 },
    uFoamStrength: { value: 1.0 },
    uDetailAmp: { value: 1.0 },
    uWindVec: { value: new THREE.Vector2(9, 0) },
    uLip: { value: 1.6 },
    uFogColor: { value: new THREE.Color(0.62, 0.74, 0.80) },
    uFogDensity: { value: 0.00040 },
  };
}

export function applySeaParams(shared, P) {
  const w = (P.windDirDeg * Math.PI) / 180;
  const s = (P.swellDirDeg * Math.PI) / 180;
  shared.uWindSpeed.value = P.windSpeed;
  shared.uWindDir.value.set(Math.cos(w), Math.sin(w));
  shared.uFetch.value = P.fetch;
  shared.uGamma.value = P.gamma;
  shared.uSpecMode.value = P.specMode;
  shared.uSwellHs.value = P.swellHs;
  shared.uSwellTp.value = P.swellTp;
  shared.uSwellDir.value.set(Math.cos(s), Math.sin(s));
  shared.uSwellBeta.value = P.swellBeta;
  shared.uSwellOn.value = P.swellEnabled ? 1 : 0;
  shared.uEnergy.value = P.energyScale;
  shared.uRefDepth.value = P.refDepth;
  shared.uChop.value = P.chop;
  shared.uChopLen.value = P.chopLength;
  shared.uWindVec.value.set(Math.cos(w) * P.windSpeed, Math.sin(w) * P.windSpeed);
  const dom = dominantWave(P);
  shared.uPeakK.value = dom.k;
  shared.uHsRef.value = Math.max(dom.HsEst, 0.3);
  return dom;
}

export function applyBathyParams(shared, P) {
  shared.uBathy0.value.set(P.mode, P.shoreX, P.slope, P.tide);
  shared.uBathy1.value.set(P.barX, P.barH, P.barW, P.reefEdge);
  shared.uBathy2.value.set(P.reefDepth, P.reefDeep, (P.angleDeg * Math.PI) / 180, 0);
}

export function applySky(shared, S) {
  shared.uSunDir.value.set(...S.sunDir).normalize();
  shared.uSunColor.value.set(S.sunColor);
  shared.uZenith.value.set(S.zenith);
  shared.uHorizon.value.set(S.horizon);
  shared.uFogColor.value.set(S.fog ?? S.horizon);
  shared.uCloudiness.value = S.cloudiness;
  shared.uFogDensity.value = S.fogDensity;
}

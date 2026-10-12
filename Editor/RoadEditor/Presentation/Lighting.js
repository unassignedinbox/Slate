//============================================================================================================================================
// 📦 Editor/RoadEditor/Presentation/Lighting.js — The day, and every material's view of it
//============================================================================================================================================
// The road shader and the prop shader are hand written, so there is no scene graph light to inherit: the sun vector, the hemisphere, the fog and the
//    night factor live here as one object, and `apply` pushes it into whichever materials are registered. Moods are authored as data — sun angle,
//    colour, haze, wetness — so the same table drives the viewport, the sky dome and the minimap wash.
'use strict';

import * as THREE from 'three';

export const MOODS = {
    noon: { label: 'Midday', sun: [0.55, 0.78, 0.30], sunColor: 0xfff4e2, ambTop: 0x9fbcd8, ambBottom: 0x3b4148, fog: 0xaebccb, fogDensity: 0.0011, night: 0, wet: 0.02, sky: [0x9cc4e8, 0xdfeaf0] },
    golden: { label: 'Golden hour', sun: [0.94, 0.24, 0.24], sunColor: 0xffc98a, ambTop: 0x8d90a8, ambBottom: 0x3a3330, fog: 0xc4a68d, fogDensity: 0.0019, night: 0.25, wet: 0.04, sky: [0x6d8fb8, 0xf0b679] },
    dusk: { label: 'Dusk', sun: [0.86, 0.10, -0.5], sunColor: 0xff9a63, ambTop: 0x59607f, ambBottom: 0x24293a, fog: 0x4d5570, fogDensity: 0.0026, night: 0.7, wet: 0.1, sky: [0x2d3a5c, 0xc4756a] },
    night: { label: 'Night', sun: [0.3, 0.55, -0.7], sunColor: 0x6f86b8, ambTop: 0x2a3350, ambBottom: 0x0d1016, fog: 0x131823, fogDensity: 0.0033, night: 1, wet: 0.35, sky: [0x0e1424, 0x2a3550] },
    overcast: { label: 'Overcast', sun: [0.2, 0.9, 0.1], sunColor: 0xb9c2cc, ambTop: 0xa9b3bd, ambBottom: 0x545a61, fog: 0x9aa4ae, fogDensity: 0.0032, night: 0.12, wet: 0.65, sky: [0x9aa6b2, 0xb6bec7] },
};

export class Lighting {
    constructor(mood = 'noon') {
        this.mood = mood;
        this.sunDir = new THREE.Vector3();
        this.sunColor = new THREE.Color();
        this.ambTop = new THREE.Color();
        this.ambBottom = new THREE.Color();
        this.fogColor = new THREE.Color();
        this.skyTop = new THREE.Color();
        this.skyBottom = new THREE.Color();
        this.night = new THREE.Vector3();
        this.set(mood);
    }
    set(mood, blend = 0) {
        const m = MOODS[mood] || MOODS.noon;
        this.mood = mood;
        this.p = m;
        this.sunDir.set(...m.sun).normalize();
        this.sunColor.setHex(m.sunColor);
        this.ambTop.setHex(m.ambTop);
        this.ambBottom.setHex(m.ambBottom);
        this.fogColor.setHex(m.fog);
        this.skyTop.setHex(m.sky[0]);
        this.skyBottom.setHex(m.sky[1]);
        this.fogDensity = m.fogDensity;
        this.night.set(m.night, m.wet, 0);
        this.wet = m.wet;
        void blend;
        return this;
    }
    /** @param {THREE.Material[]} materials */
    apply(materials) {
        for (const mat of materials) {
            if (!mat || !mat.uniforms) continue;
            const u = mat.uniforms;
            if (u.uSunDir) u.uSunDir.value.copy(this.sunDir);
            if (u.uSunColor) u.uSunColor.value.copy(this.sunColor);
            if (u.uAmbTop) u.uAmbTop.value.copy(this.ambTop);
            if (u.uAmbBottom) u.uAmbBottom.value.copy(this.ambBottom);
            if (u.uFogColor) u.uFogColor.value.copy(this.fogColor);
            if (u.uFog) u.uFog.value.set(this.fogDensity, 0, 0, 0);
            if (u.uNight) u.uNight.value.copy(this.night);
            if (u.uWet) u.uWet.value = this.wet;
        }
        return this;
    }
    backgroundColor() { return this.fogColor; }
}

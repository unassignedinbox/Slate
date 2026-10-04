import Test from "node:test";
import Assert from "node:assert/strict";
import { PRESETS, DEFAULT_PARAMS, DEBUG_CHANNELS, COLOR_PALETTES } from "./presets.js";
import {
  InitialParameters,
  ControlSpecification,
  PresetPresentation,
  ValidateParameter,
  ValidateScene,
  ConstructPresetParameters,
} from "./SceneSpecification.js";
import { HumanAvatar } from "./HumanAvatar.js";
import { DressGenerator } from "./DressGenerator.js";
import { WGSL_CLOTH_COMPUTE_SHADER, WGSL_CLOTH_RENDER_SHADER } from "./shaders-wgsl.js";
import { GLSL_CLOTH_VS, GLSL_CLOTH_FS, GLSL_AVATAR_VS, GLSL_AVATAR_FS } from "./shaders-glsl.js";

Test("Couture dress presets validate and construct tailored parameters", () => {
  const keys = Object.keys(PRESETS);
  Assert.ok(keys.length >= 8);
  for (const key of keys) {
    Assert.ok(PresetPresentation[key], `Missing presentation for ${key}`);
    const params = ConstructPresetParameters(key);
    for (const [k, v] of Object.entries(params)) {
      Assert.equal(ValidateParameter(k, v), v);
    }
  }
  Assert.equal(DEBUG_CHANNELS.length, 6);
  Assert.equal(COLOR_PALETTES.length, 8);
});

Test("HumanAvatar constructs sculpted 3D body mesh and 16 articulated SDF capsules", () => {
  const avatar = new HumanAvatar();
  Assert.ok(avatar.vertexCount > 2000);
  Assert.ok(avatar.indexCount > 6000);
  Assert.equal(avatar.capsuleData.length, 16 * 12);

  for (let pose = 0; pose < 4; pose++) {
    avatar.evaluatePose(1.25, 0.016, { avatarPose: pose, avatarMotionSpeed: 1.0 });
    Assert.ok(avatar.interleaved.every(Number.isFinite));
    Assert.ok(avatar.capsuleData.every(Number.isFinite));
    for (let c = 0; c < 16; c++) {
      const rA = avatar.capsuleData[c * 12 + 3];
      const rB = avatar.capsuleData[c * 12 + 7];
      Assert.ok(rA > 0.02 && rA < 0.25);
      Assert.ok(rB > 0.02 && rB < 0.25);
    }
  }

  // Test custom Wavefront .OBJ body import
  const sampleObj = `
    v -0.2 0.0 -0.1
    v  0.2 0.0 -0.1
    v  0.2 0.0  0.1
    v -0.2 0.0  0.1
    v -0.2 1.7 -0.1
    v  0.2 1.7 -0.1
    v  0.2 1.7  0.1
    v -0.2 1.7  0.1
    v  0.0 0.85 0.15
    v  0.0 0.85 -0.15
    v -0.25 1.3 0.0
    v  0.25 1.3 0.0
    f 1 2 3 4
    f 5 6 7 8
    f 1 2 6 5
    f 2 3 7 6
    f 3 4 8 7
    f 4 1 5 8
    f 1 9 5
    f 2 10 6
  `;
  avatar.loadWavefrontObj(sampleObj);
  Assert.equal(avatar.vertexCount, 12);
  Assert.ok(avatar.interleaved.every(Number.isFinite));
});

Test("DressGenerator builds periodic 3D dress mesh, rest lengths, and 2D pattern panels", () => {
  for (const key of Object.keys(PRESETS)) {
    const params = ConstructPresetParameters(key);
    const dress = DressGenerator.buildDress(params);
    Assert.equal(dress.vertexCount, dress.numCols * dress.numRows);
    Assert.equal(dress.initialPositions.length, dress.vertexCount * 4);
    Assert.equal(dress.restLengths.length, dress.vertexCount * 4);
    Assert.ok(dress.initialPositions.every(Number.isFinite));
    Assert.ok(dress.restLengths.every((v) => Number.isFinite(v) && v >= 0));
    Assert.ok(dress.pattern2D.hemHalfW > 0.1);
  }
});

Test("Scene validation accepts valid garment documents and rejects malformed input", () => {
  const valid = ValidateScene({
    format: "frontier-cloth-scene",
    version: 1,
    name: "Couture study",
    params: { ...InitialParameters, skirtLength: 0.85, pleatCount: 24 },
    names: {
      garment: "Emerald gown",
      avatar: "Atelier form",
      wind: "Breeze",
      sun: "Key light",
    },
    camera: { theta: 0.4, phi: 1.3, distance: 2.5, center: [0, 0.9, 0] },
  });
  Assert.equal(valid.Name, "Couture study");
  Assert.equal(valid.Parameters.skirtLength, 0.85);
  Assert.equal(valid.Parameters.pleatCount, 24);
  Assert.throws(() => ValidateParameter("skirtLength", 99));
});

Test("WebGPU WGSL and WebGL2 GLSL cloth & avatar shaders contain all required entry points", () => {
  for (const entry of [
    "fn csPredict",
    "fn csSolveConstraints",
    "fn csCollideAndUpdate",
    "fn csComputeNormals",
  ]) {
    Assert.match(WGSL_CLOTH_COMPUTE_SHADER, new RegExp(entry));
  }
  for (const entry of [
    "fn vsFloor",
    "fn fsFloor",
    "fn vsAvatar",
    "fn fsAvatar",
    "fn vsCloth",
    "fn fsCloth",
  ]) {
    Assert.match(WGSL_CLOTH_RENDER_SHADER, new RegExp(entry));
  }
  Assert.match(GLSL_CLOTH_VS, /#version 300 es/);
  Assert.match(GLSL_CLOTH_FS, /evalWeavePattern/);
  Assert.match(GLSL_AVATAR_VS, /#version 300 es/);
  Assert.match(GLSL_AVATAR_FS, /fragColor/);
});

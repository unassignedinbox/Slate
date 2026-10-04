import Test from "node:test";
import Assert from "node:assert/strict";
import {
  PRESETS,
  DEFAULT_PARAMS,
  DEBUG_CHANNELS,
  COLOR_PALETTES,
  FABRIC_PRESETS,
  AVATAR_FINISHES,
  getFabricPresetParameters,
  getFabricLoadScale,
} from "./presets.js";
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
import { PieSizingEstimator, PIE_C1, PIE_C2, PIE_MIN_RES_MM } from "./PieSizingEstimator.js";
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
  Assert.equal(DEBUG_CHANNELS.length, 7);
  Assert.equal(COLOR_PALETTES.length, 10);
  Assert.ok(FABRIC_PRESETS.length >= 10);
  Assert.equal(DEFAULT_PARAMS.avatarFinish, 0);
  Assert.equal(AVATAR_FINISHES.length, 5);
  Assert.match(AVATAR_FINISHES[0].label, /toile|fitting form/i);
  Assert.equal(ValidateParameter("avatarFinish", 4), 4);
  const silk = getFabricPresetParameters(0);
  const canvas = getFabricPresetParameters(3);
  const leather = getFabricPresetParameters(6);
  Assert.ok(silk.windResponse > canvas.windResponse && canvas.windResponse > leather.windResponse);
  Assert.ok(silk.bendStiffness < canvas.bendStiffness && canvas.bendStiffness < leather.bendStiffness);
  Assert.ok(getFabricLoadScale(850) > getFabricLoadScale(85));
  const tuxedo = ConstructPresetParameters("noir_tuxedo_coat_gown");
  const ivoryWrap = ConstructPresetParameters("ivory_embroidered_wrap_gown");
  Assert.equal(tuxedo.dressStyle, 8);
  Assert.equal(ivoryWrap.dressStyle, 9);
  Assert.equal(tuxedo.fabricPreset, 5);
  Assert.equal(tuxedo.weaveType, 9);
  Assert.ok(tuxedo.bendStiffness > silk.bendStiffness);
});

Test("Zhang et al. 2025 (SIGGRAPH '25) PieSizingEstimator evaluates optimal resolution & wrinklon sizing map", () => {
  Assert.equal(PIE_C1, 32.08);
  Assert.equal(PIE_C2, -1.876e-4);
  Assert.equal(PIE_MIN_RES_MM, 2.5);

  // Soft silk vs stiffer brocade: stiffer bending-to-stretching ratio y = B/E produces larger optimal resolution r_opt
  const softSilk = PieSizingEstimator.computeOptimalMaterialResolution(4.0e-8, 1.6e7);
  const stiffSatin = PieSizingEstimator.computeOptimalMaterialResolution(2.5e-6, 1.1e5);
  Assert.ok(softSilk.rOptMm >= PIE_MIN_RES_MM);
  Assert.ok(stiffSatin.rOptMm > softSilk.rOptMm);
  Assert.ok(stiffSatin.wavelengthMm > softSilk.wavelengthMm);

  // Evaluate garment sizing map S(u, v) with shirring, folding, stitching, and down-filling
  const report = PieSizingEstimator.evaluateGarmentSizing({
    ...DEFAULT_PARAMS,
    pieShirringRatio: 0.55,
    pieDownPressure: 0.25,
  });
  Assert.ok(report.rShirringMm <= report.rWeftOptMm);
  Assert.ok(report.rStitchMm <= report.rWeftOptMm);
  Assert.ok(report.wrinklonLwMm > 0);
  // Waistband shirring source (v = 0.28) must have finer mesh sizing than mid-skirt smooth region
  const sWaist = report.sampleSizingMeters(0.25, 0.28);
  const sMidSkirt = report.sampleSizingMeters(0.25, 0.85);
  Assert.ok(sWaist <= sMidSkirt);
});

Test("HumanAvatar builds faceless fabric fitting forms, a rolling stand, and 16 articulated SDF capsules", () => {
  const avatar = new HumanAvatar(0);
  Assert.equal(avatar.bodyType, 0);
  Assert.ok(avatar.vertexCount > 12000);
  Assert.ok(avatar.indexCount > 70000);
  Assert.equal(avatar.capsuleData.length, 16 * 12);
  let hasRearStandPost = false;
  for (let i = 0; i < avatar.basePositions.length; i += 3) {
    const x = avatar.basePositions[i];
    const y = avatar.basePositions[i + 1];
    const z = avatar.basePositions[i + 2];
    if (y > 0.50 && y < 0.78 && Math.abs(x) < 0.014 && Math.abs(z + 0.155) < 0.014) {
      hasRearStandPost = true;
      break;
    }
  }
  Assert.ok(hasRearStandPost, "the mannequin's steel stand should reach the lower back");

  for (const bodyType of [0, 1]) {
    avatar.setBodyType(bodyType);
    Assert.equal(avatar.bodyType, bodyType);
    for (let pose = 0; pose < 4; pose++) {
      avatar.evaluatePose(1.25, 0.016, { avatarBodyType: bodyType, avatarPose: pose, avatarMotionSpeed: 1.0 });
      Assert.ok(avatar.interleaved.every(Number.isFinite));
      Assert.ok(avatar.capsuleData.every(Number.isFinite));
      for (let c = 0; c < 16; c++) {
        const rA = avatar.capsuleData[c * 12 + 3];
        const rB = avatar.capsuleData[c * 12 + 7];
        Assert.ok(rA > 0.02 && rA < 0.25);
        Assert.ok(rB > 0.02 && rB < 0.25);
      }
    }
    const dress = DressGenerator.buildDress({ ...DEFAULT_PARAMS, avatarBodyType: bodyType });
    Assert.ok(dress.vertexCount > 10000);
    Assert.ok(dress.initialPositions.every(Number.isFinite));
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

Test("DressGenerator builds periodic 3D dress mesh, PIE sizing map, rest lengths, and 2D pattern panels", () => {
  for (const key of Object.keys(PRESETS)) {
    const params = ConstructPresetParameters(key);
    const dress = DressGenerator.buildDress(params);
    Assert.equal(dress.vertexCount, dress.numCols * dress.numRows);
    Assert.equal(dress.initialPositions.length, dress.vertexCount * 4);
    Assert.equal(dress.restLengths.length, dress.vertexCount * 4);
    Assert.equal(dress.sizingMapMm.length, dress.vertexCount);
    Assert.ok(dress.pieReport.wavelengthMm > 0);
    Assert.ok(dress.initialPositions.every(Number.isFinite));
    Assert.ok(dress.restLengths.every((v) => Number.isFinite(v) && v >= 0));
    Assert.ok(dress.pattern2D.hemHalfW > 0.1);
    if (params.dressStyle >= 8) {
      Assert.equal(dress.renderVertexCount, dress.vertexCount + 2 * 31 * 24);
      Assert.ok(dress.indexCount > dress.numCols * (dress.numRows - 1) * 6);
      const panelIds = new Set();
      for (let i = 0; i < dress.vertexCount; i++) panelIds.add(Math.floor(dress.uvsAndPanel[i * 4 + 2]));
      if (params.dressStyle === 8) Assert.ok(panelIds.has(4) && panelIds.has(5));
      Assert.ok(dress.renderInitialPositions.every(Number.isFinite));
      Assert.ok(dress.renderNormals.every(Number.isFinite));
    }
  }

  const tailored = DressGenerator.buildDress(ConstructPresetParameters("noir_tuxedo_coat_gown"));
  const avatar = new HumanAvatar(0);
  avatar.evaluatePose(0.7, 0.016, { avatarBodyType: 0, avatarPose: 1, avatarMotionSpeed: 1.0 });
  DressGenerator.updateAttachments(tailored, avatar);
  Assert.ok(tailored.renderNormals.every(Number.isFinite));
  let articulatedSleeveMoved = false;
  for (let i = 0; i < tailored.attachmentWeights.length; i++) {
    const dst = (tailored.attachmentOffset + i) * 4;
    const src = i * 3;
    if (Math.abs(tailored.renderInitialPositions[dst] - tailored.attachmentPositions[src]) > 1e-4) {
      articulatedSleeveMoved = true;
      break;
    }
  }
  Assert.ok(articulatedSleeveMoved, "long sleeve shells should follow animated arm bones");
});

Test("Scene validation accepts valid garment documents and rejects malformed input", () => {
  const valid = ValidateScene({
    format: "frontier-cloth-scene",
    version: 1,
    name: "Couture study",
    params: { ...InitialParameters, skirtLength: 0.85, pleatCount: 24, pieLockingRelief: 0.75 },
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
  Assert.equal(valid.Parameters.pieLockingRelief, 0.75);
  Assert.throws(() => ValidateParameter("skirtLength", 99));
});

Test("WebGPU WGSL and WebGL2 GLSL cloth & avatar shaders contain all required entry points & PIE routines", () => {
  for (const entry of [
    "fn csPredict",
    "fn csSolveConstraints",
    "fn csCollideAndUpdate",
    "fn csComputeNormals",
    "fn solveSpringPairPIE",
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
    "fn pieSizingColor",
  ]) {
    Assert.match(WGSL_CLOTH_RENDER_SHADER, new RegExp(entry));
  }
  Assert.match(GLSL_CLOTH_VS, /#version 300 es/);
  Assert.match(GLSL_CLOTH_FS, /pieSizingColor/);
  Assert.match(GLSL_AVATAR_VS, /#version 300 es/);
  Assert.match(GLSL_AVATAR_FS, /fragColor/);
  Assert.match(GLSL_AVATAR_FS, /Ivory cotton toile/);
  Assert.match(GLSL_AVATAR_FS, /seamStroke/);
  Assert.match(WGSL_CLOTH_RENDER_SHADER, /seamStroke/);
  Assert.match(WGSL_CLOTH_RENDER_SHADER, /styleInfo\.w/);
});

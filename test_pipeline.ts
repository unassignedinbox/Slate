// Automated Verification Test for Slate Terrain Studio Pipeline & Algorithms
import { TERRAIN_PRESETS } from './src/presets/terrainPresets';
import { executeTerrainPipeline } from './src/core/pipeline/terrainPipeline';
import { SATMAP_PRESETS } from './src/core/satmaps/library';
import { applySculptStrokes } from './src/core/simulation/sculpt';

console.log('--- SLATE TERRAIN STUDIO PIPELINE TEST ---');

// 1. Test SatMap Presets
console.log(`Checking SatMap presets: Found ${SATMAP_PRESETS.length} presets.`);
SATMAP_PRESETS.forEach(p => {
  if (!p.id || !p.stops || p.stops.length < 2) {
    throw new Error(`Invalid SatMap preset: ${p.id}`);
  }
});
console.log('✓ All SatMap presets validated.');

// 2. Test Presets Execution
for (const preset of TERRAIN_PRESETS) {
  console.log(`\nTesting Preset: "${preset.name}" (${preset.id})...`);
  const res = 128; // Fast test resolution
  const start = performance.now();
  const result = executeTerrainPipeline(preset.layers, res);
  const dur = (performance.now() - start).toFixed(1);

  console.log(`  ✓ Resolution: ${result.resolution}x${result.resolution}`);
  console.log(`  ✓ Elevation Range: [${result.minHeight.toFixed(3)}, ${result.maxHeight.toFixed(3)}]`);
  console.log(`  ✓ Duration: ${dur}ms (pipeline reported: ${result.executionTimeMs}ms)`);
  console.log(`  ✓ Heightmap cells: ${result.heightmap.length}`);
  console.log(`  ✓ Normals buffer: ${result.normals.length}`);
  console.log(`  ✓ Albedo bytes: ${result.albedoTexture.length}`);

  // Check NaN or Infinite values
  for (let i = 0; i < result.heightmap.length; i++) {
    if (isNaN(result.heightmap[i]) || !isFinite(result.heightmap[i])) {
      throw new Error(`NaN/Inf found in heightmap at index ${i}`);
    }
  }

  // Check Wear Map, Deposit Map, Flow Map
  let wearCount = 0;
  let depositCount = 0;
  let flowCount = 0;
  for (let i = 0; i < result.heightmap.length; i++) {
    if (result.wearMap[i] > 0) wearCount++;
    if (result.depositMap[i] > 0) depositCount++;
    if (result.flowMap[i] > 0) flowCount++;
  }
  console.log(`  ✓ Active erosion wear cells: ${wearCount}`);
  console.log(`  ✓ Active deposit cells: ${depositCount}`);
  console.log(`  ✓ Active flow river cells: ${flowCount}`);
}

// 3. Test SDF Sculpting
console.log('\nTesting SDF Sculpting...');
const baseHeights = new Float32Array(128 * 128).fill(0.5);
const sculptRes = applySculptStrokes(baseHeights, 128, [
  { tool: 'carve_gully', x: 0.5, y: 0.5, radius: 0.1, strength: 0.5 },
  { tool: 'deposit_talus', x: 0.3, y: 0.3, radius: 0.1, strength: 0.5 },
  { tool: 'alluvial_wash', x: 0.7, y: 0.7, radius: 0.1, strength: 0.5 },
  { tool: 'rock_chisel', x: 0.2, y: 0.8, radius: 0.1, strength: 0.5 },
  { tool: 'rain_painter', x: 0.8, y: 0.2, radius: 0.1, strength: 0.8 },
]);
console.log('✓ SDF Sculpting executed successfully with 5 distinct brush tools.');

console.log('\n🎉 ALL PIPELINE TESTS PASSED WITH 100% SUCCESS!\n');

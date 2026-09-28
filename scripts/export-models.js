import fs from 'fs';
import path from 'path';

// Minimal canvas mock for node environment
class MockContext {
  createImageData(w, h) { return { data: new Uint8ClampedArray((w || 256) * (h || 256) * 4), width: w || 256, height: h || 256 }; }
  putImageData() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray((w || 256) * (h || 256) * 4) }; }
  drawImage() {}
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  arc() {}
  ellipse() {}
  stroke() {}
  fill() {}
  save() {}
  restore() {}
  translate() {}
  scale() {}
  rotate() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
}

class HTMLCanvasElement {
  constructor() {
    this.width = 256;
    this.height = 256;
  }
  getContext() {
    return new MockContext();
  }
  toDataURL() {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
}

class FileReader {
  readAsArrayBuffer(blob) {
    setTimeout(() => {
      if (this.onload) this.onload({ target: { result: new ArrayBuffer(blob.size || 128) } });
    }, 1);
  }
  readAsDataURL(blob) {
    setTimeout(() => {
      if (this.onload) this.onload({ target: { result: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } });
    }, 1);
  }
}

globalThis.HTMLCanvasElement = HTMLCanvasElement;
globalThis.HTMLImageElement = class HTMLImageElement {};
globalThis.FileReader = FileReader;
globalThis.window = globalThis;
global.FileReader = FileReader;
global.HTMLCanvasElement = HTMLCanvasElement;
global.window = globalThis;

globalThis.document = {
  createElement: (type) => {
    if (type === 'canvas') {
      return new HTMLCanvasElement();
    }
    return {};
  }
};

const THREE = await import('three');
const { EagleModel } = await import('../src/eagle/EagleModel.js');
const { EagleAnimations } = await import('../src/eagle/EagleAnimations.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');

async function generateOfflineAssets() {
  console.log('Generating Eagle 3D Model Assets...');
  const eagle = new EagleModel({ plumage: 'bald' });
  const animations = new EagleAnimations(eagle);
  const clips = animations.getAllAnimationClips();

  const outDir = path.resolve('public/models');
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Export OBJ
  const objExporter = new OBJExporter();
  const objString = objExporter.parse(eagle.group);
  fs.writeFileSync(path.join(outDir, 'AAA_Eagle_Model.obj'), objString, 'utf8');
  console.log('✓ Exported AAA_Eagle_Model.obj');

  // 2. Export GLTF
  const gltfExporter = new GLTFExporter();
  await new Promise((resolve, reject) => {
    gltfExporter.parse(
      eagle.group,
      (gltf) => {
        if (typeof gltf === 'object' && !(gltf instanceof ArrayBuffer)) {
          fs.writeFileSync(path.join(outDir, 'AAA_Eagle_Model.gltf'), JSON.stringify(gltf, null, 2), 'utf8');
          console.log('✓ Exported AAA_Eagle_Model.gltf with rig and animations');
        } else if (gltf instanceof ArrayBuffer) {
          fs.writeFileSync(path.join(outDir, 'AAA_Eagle_Model.glb'), Buffer.from(gltf));
          console.log('✓ Exported AAA_Eagle_Model.glb');
        }
        resolve();
      },
      (error) => {
        console.error('Error exporting GLTF:', error);
        reject(error);
      },
      {
        binary: false,
        animations: clips
      }
    );
  });
}

generateOfflineAssets().catch(console.error);

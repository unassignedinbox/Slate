import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

/**
 * 3D Asset Exporter for Unreal Engine 5, Unity, Blender, Maya
 * Exports standard GLTF/GLB with full skeleton and all 6 animation clips, plus OBJ format.
 */
export class ModelExporter {
  constructor(eagleModel, eagleAnimations) {
    this.model = eagleModel;
    this.animations = eagleAnimations;
    this.gltfExporter = new GLTFExporter();
    this.objExporter = new OBJExporter();
  }

  /**
   * Export to Binary GLB file (Includes Geometries, Textures, Rig, and Animation Clips)
   */
  exportGLB(filename = 'AAA_Eagle_Model_Animated.glb') {
    return new Promise((resolve, reject) => {
      const clips = this.animations.getAllAnimationClips();
      const options = {
        binary: true,
        animations: clips,
        includeCustomExtensions: true,
        embedImages: true
      };

      this.gltfExporter.parse(
        this.model.group,
        (result) => {
          if (result instanceof ArrayBuffer) {
            this.triggerDownload(result, filename, 'model/gltf-binary');
            resolve(result);
          } else {
            const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
            this.triggerDownload(blob, filename.replace('.glb', '.gltf'), 'model/gltf+json');
            resolve(blob);
          }
        },
        (error) => {
          console.error('Error exporting GLTF:', error);
          reject(error);
        },
        options
      );
    });
  }

  /**
   * Export to OBJ file
   */
  exportOBJ(filename = 'AAA_Eagle_Model.obj') {
    const result = this.objExporter.parse(this.model.group);
    const blob = new Blob([result], { type: 'text/plain' });
    this.triggerDownload(blob, filename, 'text/plain');
    return blob;
  }

  /**
   * Trigger browser file download
   */
  triggerDownload(data, filename, mimeType) {
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else {
      blob = new Blob([data], { type: mimeType });
    }

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }
}

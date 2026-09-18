// Slate 3D Interactive Viewport with Three.js
// Features: Real-time terrain rendering, multiple shading modes, dynamic lighting,
// Raycasted 3D SDF sculpting brush cursor, and 2D/3D camera presets.

import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type {
  TerrainSimulationResult,
  ViewportSettings,
  BrushSettings,
  SculptStroke,
} from '../../types/terrain';

interface TerrainViewportProps {
  simulationResult: TerrainSimulationResult | null;
  viewportSettings: ViewportSettings;
  brushSettings: BrushSettings;
  isSculptingActive: boolean;
  onApplyStroke: (stroke: SculptStroke) => void;
}

export const TerrainViewport: React.FC<TerrainViewportProps> = ({
  simulationResult,
  viewportSettings,
  brushSettings,
  isSculptingActive,
  onApplyStroke,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);

  // Mesh and scene objects
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const terrainGeoRef = useRef<THREE.PlaneGeometry | null>(null);
  const waterMeshRef = useRef<THREE.Mesh | null>(null);
  const brushRingRef = useRef<THREE.LineLoop | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);

  // Textures cache
  const textureCacheRef = useRef<{ [key: string]: THREE.DataTexture }>({});

  // Orbit controls state
  const isOrbitingRef = useRef(false);
  const isPanningRef = useRef(false);
  const previousMousePositionRef = useRef({ x: 0, y: 0 });
  const cameraTargetRef = useRef(new THREE.Vector3(0, 5, 0));
  const sphericalRef = useRef({ radius: 120, theta: Math.PI / 4, phi: Math.PI / 3 });

  // Sculpting interaction state
  const isPaintingRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseNdcRef = useRef(new THREE.Vector2());

  // Update Camera Position based on Spherical Coordinates
  const updateCameraPosition = useCallback(() => {
    if (!cameraRef.current) return;
    const { radius, theta, phi } = sphericalRef.current;
    const x = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.cos(theta);

    cameraRef.current.position.set(
      cameraTargetRef.current.x + x,
      cameraTargetRef.current.y + y,
      cameraTargetRef.current.z + z
    );
    cameraRef.current.lookAt(cameraTargetRef.current);
  }, []);

  // Initialize Three.js Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1117);
    scene.fog = new THREE.FogExp2(0x0e1117, 0.0035);
    sceneRef.current = scene;

    // Perspective Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    cameraRef.current = camera;
    updateCameraPosition();

    // Orthographic Camera for 2D map view
    const orthoCam = new THREE.OrthographicCamera(
      -60 * (width / height),
      60 * (width / height),
      60,
      -60,
      0.1,
      1000
    );
    orthoCam.position.set(0, 150, 0);
    orthoCam.lookAt(0, 0, 0);
    orthoCameraRef.current = orthoCam;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404556, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 2.4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 300;
    dirLight.shadow.camera.left = -70;
    dirLight.shadow.camera.right = 70;
    dirLight.shadow.camera.top = 70;
    dirLight.shadow.camera.bottom = -70;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    // Grid Floor below terrain
    const gridHelper = new THREE.GridHelper(140, 28, 0x242a38, 0x181c25);
    gridHelper.position.y = -0.1;
    scene.add(gridHelper);

    // Brush Indicator Ring
    const ringGeo = new THREE.BufferGeometry();
    const ringPoints: THREE.Vector3[] = [];
    const segments = 48;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)));
    }
    ringGeo.setFromPoints(ringPoints);
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 2,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const brushRing = new THREE.LineLoop(ringGeo, ringMat);
    brushRing.visible = false;
    brushRing.renderOrder = 999;
    scene.add(brushRing);
    brushRingRef.current = brushRing;

    // Water Surface Plane
    const waterGeo = new THREE.PlaneGeometry(100, 100);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1b3e59,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = 2.0;
    waterMesh.visible = false;
    scene.add(waterMesh);
    waterMeshRef.current = waterMesh;

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const activeCam = viewportSettings.is2DView ? orthoCam : camera;
      renderer.render(scene, activeCam);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !renderer || !camera || !orthoCam) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      orthoCam.left = -60 * (w / h);
      orthoCam.right = 60 * (w / h);
      orthoCam.top = 60;
      orthoCam.bottom = -60;
      orthoCam.updateProjectionMatrix();

      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [updateCameraPosition, viewportSettings.is2DView]);

  // Update Sunlight Position
  useEffect(() => {
    if (!dirLightRef.current) return;
    const radAzimuth = (viewportSettings.sunAzimuth * Math.PI) / 180.0;
    const radElevation = (viewportSettings.sunElevation * Math.PI) / 180.0;

    const dist = 100;
    const lx = dist * Math.cos(radElevation) * Math.sin(radAzimuth);
    const ly = dist * Math.sin(radElevation);
    const lz = dist * Math.cos(radElevation) * Math.cos(radAzimuth);

    dirLightRef.current.position.set(lx, ly, lz);
    dirLightRef.current.intensity = viewportSettings.sunIntensity;
  }, [viewportSettings.sunAzimuth, viewportSettings.sunElevation, viewportSettings.sunIntensity]);

  // Update Water Mesh
  useEffect(() => {
    if (!waterMeshRef.current) return;
    waterMeshRef.current.visible = viewportSettings.showWater;
    waterMeshRef.current.position.y = viewportSettings.waterLevel * viewportSettings.heightScale;
  }, [viewportSettings.showWater, viewportSettings.waterLevel, viewportSettings.heightScale]);

  // Update Terrain Geometry and Material Textures
  useEffect(() => {
    if (!sceneRef.current || !simulationResult) return;

    const res = simulationResult.resolution;
    const heights = simulationResult.heightmap;
    const heightScale = viewportSettings.heightScale;

    // Recreate or update PlaneGeometry
    let geo = terrainGeoRef.current;
    if (!geo || geo.parameters.widthSegments !== res - 1) {
      if (geo) geo.dispose();
      geo = new THREE.PlaneGeometry(100, 100, res - 1, res - 1);
      geo.rotateX(-Math.PI / 2); // Lay flat on XZ plane
      terrainGeoRef.current = geo;
    }

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    // PlaneGeometry vertices order: row by row along Z, then X
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const gridIdx = z * res + x;
        const vertIdx = (z * res + x) * 3;
        posArray[vertIdx + 1] = heights[gridIdx] * heightScale;
      }
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    // Generate Texture based on Shading Mode
    const mode = viewportSettings.shadingMode;
    let dataTexture: THREE.DataTexture;

    if (mode === 'satmap') {
      // Use pre-computed RGBA SatMap Albedo
      dataTexture = new THREE.DataTexture(
        simulationResult.albedoTexture,
        res,
        res,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
    } else {
      // Generate specialized visualization texture
      const pixels = new Uint8Array(res * res * 4);
      for (let i = 0; i < res * res; i++) {
        const pIdx = i * 4;
        let r = 0, g = 0, b = 0;

        switch (mode) {
          case 'height': {
            const h = Math.round(simulationResult.heightmap[i] * 255);
            r = h; g = h; b = h;
            break;
          }
          case 'wear': {
            const w = Math.min(255, Math.round(simulationResult.wearMap[i] * 255 * 3.5));
            r = w; g = Math.round(w * 0.2); b = Math.round(w * 0.1);
            break;
          }
          case 'deposit': {
            const d = Math.min(255, Math.round(simulationResult.depositMap[i] * 255 * 3.5));
            r = d; g = Math.round(d * 0.8); b = Math.round(d * 0.3);
            break;
          }
          case 'flow': {
            const f = Math.min(255, Math.round(simulationResult.flowMap[i] * 255));
            r = Math.round(f * 0.2); g = Math.round(f * 0.6); b = f;
            break;
          }
          case 'slope': {
            const nIdx = i * 3;
            const ny = simulationResult.normals[nIdx + 1];
            const slope = Math.round((1.0 - ny) * 255);
            r = slope; g = slope; b = 80;
            break;
          }
          case 'normal': {
            const nIdx = i * 3;
            r = Math.round((simulationResult.normals[nIdx] * 0.5 + 0.5) * 255);
            g = Math.round((simulationResult.normals[nIdx + 1] * 0.5 + 0.5) * 255);
            b = Math.round((simulationResult.normals[nIdx + 2] * 0.5 + 0.5) * 255);
            break;
          }
          case 'ambient_occlusion': {
            const h = simulationResult.heightmap[i];
            const wear = simulationResult.wearMap[i];
            const ao = Math.max(0, Math.min(255, Math.round((h * 0.8 + 0.2 - wear * 0.4) * 255)));
            r = ao; g = ao; b = ao;
            break;
          }
        }

        pixels[pIdx] = r;
        pixels[pIdx + 1] = g;
        pixels[pIdx + 2] = b;
        pixels[pIdx + 3] = 255;
      }
      dataTexture = new THREE.DataTexture(pixels, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    }

    dataTexture.wrapS = THREE.ClampToEdgeWrapping;
    dataTexture.wrapT = THREE.ClampToEdgeWrapping;
    dataTexture.minFilter = THREE.LinearFilter;
    dataTexture.magFilter = THREE.LinearFilter;
    dataTexture.needsUpdate = true;

    // Terrain Material
    let mesh = terrainMeshRef.current;
    if (!mesh) {
      const mat = new THREE.MeshStandardMaterial({
        map: dataTexture,
        roughness: 0.85,
        metalness: 0.05,
        wireframe: viewportSettings.wireframe,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRef.current.add(mesh);
      terrainMeshRef.current = mesh;
    } else {
      mesh.geometry = geo;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.map) mat.map.dispose();
      mat.map = dataTexture;
      mat.wireframe = viewportSettings.wireframe;
      mat.needsUpdate = true;
    }
  }, [simulationResult, viewportSettings.heightScale, viewportSettings.shadingMode, viewportSettings.wireframe]);

  // Raycast terrain helper
  const raycastTerrain = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): { point: THREE.Vector3; u: number; v: number } | null => {
      const container = containerRef.current;
      const camera = viewportSettings.is2DView ? orthoCameraRef.current : cameraRef.current;
      const mesh = terrainMeshRef.current;
      if (!container || !camera || !mesh) return null;

      const rect = container.getBoundingClientRect();
      mouseNdcRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNdcRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseNdcRef.current, camera);
      const intersects = raycasterRef.current.intersectObject(mesh);

      if (intersects.length > 0) {
        const hit = intersects[0];
        // Convert hit point to UV coordinates [0, 1] on 100x100 plane
        const u = (hit.point.x / 100.0) + 0.5;
        const v = (hit.point.z / 100.0) + 0.5;
        return { point: hit.point, u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)) };
      }
      return null;
    },
    [viewportSettings.is2DView]
  );

  // Mouse Interaction: Orbit, Pan, Zoom, and 3D Sculpting
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // If sculpting active and left click -> paint stroke
    if (isSculptingActive && e.button === 0) {
      isPaintingRef.current = true;
      const hit = raycastTerrain(e);
      if (hit) {
        onApplyStroke({
          tool: brushSettings.tool,
          x: hit.u,
          y: hit.v,
          radius: brushSettings.radius,
          strength: brushSettings.strength,
          targetHeight: brushSettings.targetHeight,
        });
      }
      return;
    }

    if (e.button === 0) {
      isOrbitingRef.current = true;
    } else if (e.button === 2) {
      isPanningRef.current = true;
    }
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Update 3D Brush ring position
    if (isSculptingActive && brushRingRef.current) {
      const hit = raycastTerrain(e);
      if (hit) {
        brushRingRef.current.visible = true;
        brushRingRef.current.position.copy(hit.point);
        brushRingRef.current.position.y += 0.2; // Float slightly above surface
        const worldRadius = brushSettings.radius * 100.0;
        brushRingRef.current.scale.set(worldRadius, worldRadius, worldRadius);

        // If mouse is held down during sculpting, apply continuous brush stroke
        if (isPaintingRef.current) {
          onApplyStroke({
            tool: brushSettings.tool,
            x: hit.u,
            y: hit.v,
            radius: brushSettings.radius,
            strength: brushSettings.strength * 0.4, // continuous stroke rate
            targetHeight: brushSettings.targetHeight,
          });
        }
      } else {
        brushRingRef.current.visible = false;
      }
    } else if (brushRingRef.current) {
      brushRingRef.current.visible = false;
    }

    // Camera Navigation
    const deltaX = e.clientX - previousMousePositionRef.current.x;
    const deltaY = e.clientY - previousMousePositionRef.current.y;
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };

    if (isOrbitingRef.current && !viewportSettings.is2DView) {
      sphericalRef.current.theta -= deltaX * 0.008;
      sphericalRef.current.phi = Math.max(
        0.05,
        Math.min(Math.PI * 0.48, sphericalRef.current.phi - deltaY * 0.008)
      );
      updateCameraPosition();
    } else if (isPanningRef.current) {
      const panSpeed = 0.12;
      cameraTargetRef.current.x -= deltaX * panSpeed;
      cameraTargetRef.current.z -= deltaY * panSpeed;
      updateCameraPosition();
    }
  };

  const handleMouseUp = () => {
    isOrbitingRef.current = false;
    isPanningRef.current = false;
    isPaintingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (viewportSettings.is2DView && orthoCameraRef.current) {
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      orthoCameraRef.current.zoom = Math.max(0.2, Math.min(5.0, orthoCameraRef.current.zoom / zoomFactor));
      orthoCameraRef.current.updateProjectionMatrix();
    } else {
      const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
      sphericalRef.current.radius = Math.max(
        15,
        Math.min(300, sphericalRef.current.radius * zoomFactor)
      );
      updateCameraPosition();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};

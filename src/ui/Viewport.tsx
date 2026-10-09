// 3D viewport: a displaced plane mesh with vertex colours from the satmap.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Project } from '../engine/types';
import type { ComputeResponse } from '../engine/worker';

const WORLD = 40;

export interface ViewportProps {
  project: Project;
  result: ComputeResponse | null;
  colour: 'satmap' | 'height';
}

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  sun: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
}

export default function Viewport({ project, result, colour }: ViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<Rig | null>(null);
  const [orbit, setOrbit] = useState({ azimuth: 42, polar: 34, zoom: 1 });
  const orbitRef = useRef(orbit);
  orbitRef.current = orbit;
  const projectRef = useRef(project);
  projectRef.current = project;
  const [error, setError] = useState<string | null>(null);

  // Build the renderer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError('WebGL is unavailable here — use the 2D view.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x0b0b0b, 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    const sun = new THREE.DirectionalLight(0xfff3e0, 2);
    const fill = new THREE.HemisphereLight(0x9fb4c8, 0x2a2620, 0.7);
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(sun, fill, ambient);

    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
    );
    scene.add(mesh);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 3, WORLD * 3),
      new THREE.MeshStandardMaterial({
        color: 0x18414f,
        transparent: true,
        opacity: 0.78,
        roughness: 0.1,
        metalness: 0.3,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    scene.add(water);

    rigRef.current = { renderer, scene, camera, mesh, water, sun, fill, ambient };

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const rig = rigRef.current;
      if (!rig) return;
      const { azimuth, polar, zoom } = orbitRef.current;
      const radius = WORLD * 2.4;
      const az = (azimuth * Math.PI) / 180;
      const po = (Math.max(4, Math.min(89, polar)) * Math.PI) / 180;
      rig.camera.position.set(
        Math.sin(az) * Math.sin(po) * radius,
        Math.cos(po) * radius,
        Math.cos(az) * Math.sin(po) * radius,
      );
      rig.camera.lookAt(0, 0, 0);

      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      const half = (WORLD * 0.6) / zoom;
      const aspect = width / height;
      rig.camera.left = -half * aspect;
      rig.camera.right = half * aspect;
      rig.camera.top = half;
      rig.camera.bottom = -half;
      rig.camera.updateProjectionMatrix();

      const p = projectRef.current;
      const el = (Math.max(4, p.render.sunElevation) * Math.PI) / 180;
      const sa = (p.render.sunAzimuth * Math.PI) / 180;
      rig.sun.position.set(
        Math.cos(sa) * Math.cos(el) * WORLD,
        Math.sin(el) * WORLD,
        Math.sin(sa) * Math.cos(el) * WORLD,
      );
      rig.sun.intensity = 1.1 + p.render.shading * 1.7;
      rig.ambient.intensity = 0.3 - p.render.shading * 0.18;
      rig.fill.intensity = 0.3 + (1 - p.render.shading) * 0.7;
      rig.water.position.y = (p.seaLevel - 0.5) * WORLD * (p.heightScale / Math.max(1, p.extent));

      rig.renderer.render(rig.scene, rig.camera);
    };
    animate();

    const observer = new ResizeObserver(() => {
      const rig = rigRef.current;
      if (!rig) return;
      rig.renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
    });
    observer.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      const rig = rigRef.current;
      if (rig) {
        rig.mesh.geometry.dispose();
        (rig.mesh.material as THREE.Material).dispose();
        rig.water.geometry.dispose();
        (rig.water.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      rigRef.current = null;
    };
  }, []);

  // Rebuild the mesh whenever the terrain or colour mode changes.
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !result) return;
    const size = result.size;
    const vertical = WORLD * (project.heightScale / Math.max(1, project.extent));
    const positions = new Float32Array(size * size * 3);
    const colors = new Float32Array(size * size * 3);
    const { height, rgba } = result;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const h = height[i];
        const k = i * 3;
        positions[k] = (x / (size - 1) - 0.5) * WORLD;
        positions[k + 1] = (h - 0.5) * vertical;
        positions[k + 2] = (y / (size - 1) - 0.5) * WORLD;
        if (colour === 'satmap') {
          colors[k] = (rgba[i * 4] / 255) ** 2.2;
          colors[k + 1] = (rgba[i * 4 + 1] / 255) ** 2.2;
          colors[k + 2] = (rgba[i * 4 + 2] / 255) ** 2.2;
        } else {
          const t = Math.max(0, Math.min(1, (h - 0.05) / 0.9));
          colors[k] = 0.1 + t * 0.82;
          colors[k + 1] = 0.11 + t * 0.8;
          colors[k + 2] = 0.13 + t * 0.74;
        }
      }
    }

    const indices = new Uint32Array((size - 1) * (size - 1) * 6);
    let n = 0;
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const a = y * size + x;
        const b = a + 1;
        const c = a + size;
        const d = c + 1;
        indices[n++] = a;
        indices[n++] = c;
        indices[n++] = b;
        indices[n++] = b;
        indices[n++] = c;
        indices[n++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    rig.mesh.geometry.dispose();
    rig.mesh.geometry = geometry;
  }, [result, project.heightScale, project.extent, colour]);

  return (
    <div
      className="stage-canvas"
      ref={hostRef}
      onPointerDown={(e) => {
        const start = { x: e.clientX, y: e.clientY, ...orbit };
        const move = (ev: PointerEvent) => {
          setOrbit({
            azimuth: start.azimuth + (ev.clientX - start.x) * 0.4,
            polar: Math.max(6, Math.min(88, start.polar - (ev.clientY - start.y) * 0.3)),
            zoom: start.zoom,
          });
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onWheel={(e) => {
        setOrbit((o) => ({ ...o, zoom: Math.max(0.4, Math.min(6, o.zoom * (1 - e.deltaY * 0.0012))) }));
      }}
    >
      {error ? <p className="stage-error">{error}</p> : null}
      {!result && !error ? <p className="stage-status">building terrain…</p> : null}
      <div className="stage-hint">drag to orbit · scroll to zoom</div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createDrapedClothGeometry, clothSupport } from "./clothGeometry";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createMaterial, createBallGeometry, materials } from "./materials";

function makeEnvironment(renderer, mode = "Studio softbox") {
  // The studio is geometry and light only: no downloaded HDRIs or texture maps.
  const room = new THREE.Scene();
  const warm = mode === "Warm atelier";
  room.background = new THREE.Color(
    mode === "Daylight" ? "#919599" : "#65676a",
  );
  const softbox = (position, width, height, power, color = "#ffffff") => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(power),
        side: THREE.DoubleSide,
      }),
    );
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    room.add(panel);
  };
  softbox([-3, 2, 3], 2.2, 4.5, 3.6, warm ? "#ffe4bf" : "#f4f6ff");
  softbox([4, 1, 1], 0.9, 4.7, 2.8, warm ? "#ffc684" : "#e2eafa");
  softbox([0, 5, -1], 3.5, 2.3, 2.1);
  softbox([-2, 1, -4], 1.2, 3.5, 1.7);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(room, 0.025);
  room.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  generator.dispose();
  return target;
}

export async function renderThumbnails(
  callback,
  onProgress = () => {},
  signal,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(240, 186);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const scene = new THREE.Scene();
  const env = makeEnvironment(renderer);
  scene.environment = env.texture;
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-3, 5, 4);
  scene.add(light);
  const camera = new THREE.PerspectiveCamera(34, 240 / 186, 0.1, 20);
  camera.position.set(0, 1.1, 5.7);
  camera.lookAt(0, 0, 0);
  const geometry = createBallGeometry();
  const mesh = new THREE.Mesh(geometry);
  mesh.rotation.z = -0.3;
  scene.add(mesh);
  let shaderFailure = null;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderFailure = new Error(gl.getShaderInfoLog(fragment));
  };
  const results = {};
  // Yield before each GPU job, and publish real completed-job counts. Browsers
  // with KHR_parallel_shader_compile can keep their UI responsive during linking.
  mesh.material.dispose();
  // Keep owners alive for this batch so Three can reuse linked programs across
  // presets. Disposing each immediately would force recompilation 100 times.
  const retainedMaterials = [];
  try {
    for (const [i, p] of materials.entries()) {
      if (signal?.aborted) break;
      onProgress({
        done: i,
        total: materials.length,
        name: p.name,
        phase: "compiling",
      });
      await new Promise((resolve) => setTimeout(resolve, 24));
      if (signal?.aborted) break;
      mesh.material = createMaterial(p);
      retainedMaterials.push(mesh.material);
      {
        await renderer.compileAsync(scene, camera);
        if (signal?.aborted) break;
        renderer.render(scene, camera);
        if (shaderFailure) throw shaderFailure;
        results[p.id] = renderer.domElement.toDataURL("image/png");
        callback({ ...results });
        onProgress({
          done: i + 1,
          total: materials.length,
          name: p.name,
          phase: i + 1 === materials.length ? "ready" : "rendered",
        });
      }
    }
  } finally {
    retainedMaterials.forEach((material) => material.dispose());
    geometry.dispose();
    env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export default function Viewport({
  params,
  shape,
  environment,
  rotate,
  wireframe,
  resetToken,
  zoom,
  onReady,
  onZoomChange,
  onCompile,
}) {
  const host = useRef(null),
    engine = useRef(null),
    latest = useRef(params);
  const [error, setError] = useState(false);
  latest.current = params;
  const wireframeRef = useRef(wireframe);
  wireframeRef.current = wireframe;
  const zoomCallback = useRef(onZoomChange);
  zoomCallback.current = onZoomChange;
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
    } catch {
      setError(true);
      return;
    }
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      console.error("Viewport shader: " + gl.getShaderInfoLog(fragment));
      setError(true);
      onCompile?.({ phase: "error", name: latest.current.name });
    };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    host.current.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#191a1c", 0.075);
    const env = makeEnvironment(renderer);
    scene.environment = env.texture;
    const camera = new THREE.PerspectiveCamera(37, 1, 0.001, 200);
    camera.position.set(4.1, 3.25, 6.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.65, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.01;
    controls.maxDistance = 100;
    controls.enableZoom = false; // Use optical macro zoom: never push the camera through the surface.
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.51;
    controls.minPolarAngle = 0.2;
    controls.autoRotateSpeed = 0.7;
    controls.enablePan = true;
    controls.panSpeed = 0.8;
    const ambient = new THREE.AmbientLight("#e0e4ec", 0.5);
    scene.add(ambient);
    const key = new THREE.SpotLight("#f1f6f2", 30, 25, 0.65, 0.8, 1.5);
    key.position.set(-3, 7, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 5;
    key.target.position.set(0, 1, 0);
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight("#dbe3f3", 1.2);
    rim.position.set(3, 4, -3);
    scene.add(rim);
    const fill = new THREE.DirectionalLight("#e4edf2", 0.45);
    fill.position.set(-4, 2, 1);
    scene.add(fill);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: "#242528",
      roughness: 0.85,
      metalness: 0.05,
      envMapIntensity: 0.2,
      transparent: true,
      depthWrite: false,
    });
    floorMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 vGroundPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGroundPosition=position;",
      );
      shader.fragmentShader =
        "varying vec3 vGroundPosition;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a *= 1. - smoothstep(3.,9.,length(vGroundPosition.xy));",
      );
    };
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -0.015;
    scene.add(floor);
    const grid = new THREE.GridHelper(14, 28, "#35363a", "#2b2c30");
    grid.material.transparent = true;
    grid.material.opacity = 0.085;
    grid.position.y = -0.007;
    scene.add(grid);
    const group = new THREE.Group();
    scene.add(group);
    const material = createMaterial(latest.current);
    const specimen = new THREE.Mesh(createBallGeometry(), material);
    specimen.position.y = 1.65;
    specimen.rotation.z = -0.27;
    specimen.rotation.y = -0.4;
    specimen.castShadow = true;
    specimen.receiveShadow = true;
    group.add(specimen);
    const standMaterial = new THREE.MeshPhysicalMaterial({
      color: "#212226",
      metalness: 0.5,
      roughness: 0.5,
      clearcoat: 0.1,
      envMapIntensity: 0.5,
    });
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.26, 0.18, 128),
      standMaterial,
    );
    stand.position.y = 0.115;
    stand.castShadow = true;
    stand.receiveShadow = true;
    group.add(stand);
    const standBottom = new THREE.Mesh(
      new THREE.CylinderGeometry(1.26, 1.22, 0.055, 128),
      new THREE.MeshStandardMaterial({
        color: "#131417",
        metalness: 0.6,
        roughness: 0.35,
      }),
    );
    standBottom.position.y = 0.032;
    group.add(standBottom);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.215, 0.012, 12, 128),
      new THREE.MeshStandardMaterial({
        color: "#676a71",
        metalness: 0.85,
        roughness: 0.32,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    group.add(ring);
    const supportBall = new THREE.Mesh(
      new THREE.SphereGeometry(clothSupport.radius, 96, 64),
      new THREE.MeshPhysicalMaterial({
        color: "#16191f",
        roughness: 0.4,
        metalness: 0.4,
        clearcoat: 0.25,
      }),
    );
    supportBall.position.fromArray(clothSupport.center);
    supportBall.visible = false;
    supportBall.castShadow = true;
    supportBall.receiveShadow = true;
    scene.add(supportBall);
    const state = {
      supportBall,
      renderer,
      scene,
      camera,
      controls,
      specimen,
      env,
      key,
      rim,
      ambient,
      frame: 0,
      dirty: true,
      environment: "Studio softbox",
      magnification: 1,
      fitZoom: 0.86,
    };
    state.compiling = true;
    state.compileTicket = 0;
    engine.current = state;
    state.setZoom = (factor) => {
      state.magnification = THREE.MathUtils.clamp(factor, 0.1, 100);
      camera.zoom = state.fitZoom * state.magnification;
      camera.updateProjectionMatrix();
      controls.panSpeed = 0.8 / state.magnification;
      state.dirty = true;
      const fibers = state.specimen.getObjectByName("microfibers");
      if (fibers) fibers.visible = state.magnification >= 2;
      const percent = Math.round(state.magnification * 100);
      renderer.domElement.dataset.zoom = String(percent);
      zoomCallback.current?.(percent);
    };
    const wheel = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      state.setZoom(
        state.magnification *
          Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.006),
      );
    };
    renderer.domElement.addEventListener("wheel", wheel, {
      passive: false,
      capture: true,
    });
    const raycaster = new THREE.Raycaster();
    const inspect = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObject(specimen, false)[0];
      if (hit) {
        const shift = hit.point.clone().sub(controls.target);
        camera.position.add(shift);
        controls.target.copy(hit.point);
        state.setZoom(Math.max(8, state.magnification));
        controls.update();
      }
    };
    renderer.domElement.addEventListener("dblclick", inspect);
    let pinch = 0;
    const touchstart = (e) => {
      if (e.touches.length === 2)
        pinch = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
    };
    const touchmove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (pinch > 0) state.setZoom((state.magnification * d) / pinch);
        pinch = d;
      }
    };
    renderer.domElement.addEventListener("touchstart", touchstart, {
      passive: true,
    });
    renderer.domElement.addEventListener("touchmove", touchmove, {
      passive: false,
    });
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      state.fitZoom = Math.min(0.86, width / height / 0.9);
      camera.zoom = state.fitZoom * state.magnification;
      camera.updateProjectionMatrix();
      state.dirty = true;
    });
    observer.observe(host.current);
    controls.addEventListener("change", () => {
      state.dirty = true;
    });
    const tick = () => {
      state.frame = requestAnimationFrame(tick);
      controls.update();
      if (state.dirty && !state.compiling) {
        renderer.render(scene, camera);
        state.dirty = false;
        renderer.domElement.dataset.materialReady = "true";
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(state.frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("wheel", wheel, true);
      renderer.domElement.removeEventListener("dblclick", inspect);
      renderer.domElement.removeEventListener("touchstart", touchstart);
      renderer.domElement.removeEventListener("touchmove", touchmove);
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      state.env.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const ticket = ++e.compileTicket;
    const previous = e.compileTask || Promise.resolve();
    e.compiling = true;
    e.renderer.domElement.dataset.materialReady = "false";
    onCompile?.({ phase: "compiling", name: params.name });
    e.compileTask = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 32));
      await previous;
      if (engine.current !== e || ticket !== e.compileTicket) return;
      const old = e.specimen.material;
      e.specimen.material = createMaterial({
        ...params,
        clothMapping: shape === "Draped cloth",
      });
      e.specimen.material.wireframe = wireframeRef.current;
      e.scene.background =
        params.type === 5 ? new THREE.Color("#25272b") : null;
      try {
        await e.renderer.compileAsync(e.scene, e.camera);
        if (engine.current !== e || ticket !== e.compileTicket) return;
        e.renderer.shadowMap.needsUpdate = true;
        e.dirty = true;
        e.compiling = false;
        onReady?.();
        onCompile?.({ phase: "ready", name: params.name });
      } catch (error) {
        if (engine.current === e && ticket === e.compileTicket) {
          e.compiling = false;
          onCompile?.({ phase: "error", name: params.name });
          setError(true);
        }
        console.error("Material preparation failed:", error);
      } finally {
        old.dispose();
      }
    })();
  }, [params, shape]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.controls.autoRotate = rotate;
  }, [rotate]);
  useEffect(() => {
    if (engine.current) {
      engine.current.specimen.material.wireframe = wireframe;
      engine.current.dirty = true;
    }
  }, [wireframe]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.dirty = true;
    e.renderer.shadowMap.needsUpdate = true;
    e.specimen.geometry.dispose();
    e.specimen.rotation.set(0, 0, 0);
    e.specimen.position.y = 1.65;
    e.supportBall.visible = shape === "Draped cloth";
    e.renderer.domElement.dataset.previewShape = shape;
    if (shape === "Draped cloth") {
      e.specimen.geometry = createDrapedClothGeometry();
      e.specimen.position.set(0, 0, 0);
    }
    if (shape === "Sphere") {
      e.specimen.geometry = new THREE.SphereGeometry(1.4, 128, 96);
    }
    if (shape === "Panel") {
      e.specimen.geometry = new RoundedBoxGeometry(2.8, 2.1, 0.12, 4, 0.04);
      e.specimen.rotation.y = -0.15;
      e.specimen.position.y = 1.35;
    }
    if (shape === "Shader ball") {
      e.specimen.geometry = createBallGeometry();
      e.specimen.rotation.set(0, -0.4, -0.27);
    }
    if (shape === "Rounded cube") {
      e.specimen.geometry = new RoundedBoxGeometry(2.35, 2.35, 2.35, 8, 0.28);
      e.specimen.rotation.y = 0.25;
      e.specimen.position.y = 1.46;
    }
    if (shape === "Torus knot") {
      e.specimen.geometry = new THREE.TorusKnotGeometry(0.92, 0.35, 220, 40);
      e.specimen.position.y = 1.73;
    }
    if (shape === "Brake rotor") {
      const profile = new THREE.Shape();
      profile.absarc(0, 0, 1.45, 0, Math.PI * 2, false);
      const center = new THREE.Path();
      center.absarc(0, 0, 0.36, 0, Math.PI * 2, true);
      profile.holes.push(center);
      for (let ring = 0; ring < 2; ring++)
        for (let i = 0; i < 18; i++) {
          let a = ((i + ring * 0.5) / 18) * Math.PI * 2;
          const hole = new THREE.Path();
          hole.absarc(
            Math.cos(a) * (1.05 + ring * 0.2),
            Math.sin(a) * (1.05 + ring * 0.2),
            0.043,
            0,
            Math.PI * 2,
            true,
          );
          profile.holes.push(hole);
        }
      e.specimen.geometry = new THREE.ExtrudeGeometry(profile, {
        depth: 0.19,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.012,
        bevelThickness: 0.012,
        curveSegments: 80,
      });
      e.specimen.geometry.translate(0, 0, -0.095);
      e.specimen.rotation.y = -0.12;
      e.specimen.rotation.x = 0.06;
      e.specimen.position.y = 1.68;
    }
  }, [shape]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const old = e.specimen.getObjectByName("microfibers");
    if (old) {
      e.specimen.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
    if (params.type === 4 && params.fuzz > 0) {
      let seed = 417;
      const random = () => {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const sampler = new MeshSurfaceSampler(e.specimen)
        .setRandomGenerator(random)
        .build();
      const count = Math.floor(36000 * params.fuzz),
        positions = new Float32Array(count * 18);
      const point = new THREE.Vector3(),
        normal = new THREE.Vector3(),
        tangent = new THREE.Vector3();
      const length = params.fuzzLength / 100;
      let offset = 0;
      for (let i = 0; i < count; i++) {
        sampler.sample(point, normal);
        tangent.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
        tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
        const len = length * (0.35 + random() * 0.85);
        for (let segment = 0; segment < 3; segment++) {
          for (let endpoint = 0; endpoint < 2; endpoint++) {
            const t = (segment + endpoint) / 3;
            const v = point
              .clone()
              .addScaledVector(normal, len * t)
              .addScaledVector(tangent, len * 0.35 * t * t);
            positions.set([v.x, v.y, v.z], offset);
            offset += 3;
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(params.sheenColor).multiplyScalar(0.48),
        transparent: true,
        opacity: 0.25 + params.fuzz * 0.4,
        depthWrite: false,
      });
      const fur = new THREE.LineSegments(geometry, material);
      fur.name = "microfibers";
      fur.visible = e.magnification >= 2;
      e.specimen.add(fur);
    }
    e.dirty = true;
    return () => {
      const fur = e.specimen.getObjectByName("microfibers");
      if (fur) {
        e.specimen.remove(fur);
        fur.geometry.dispose();
        fur.material.dispose();
      }
    };
  }, [params.type, params.fuzz, params.fuzzLength, params.sheenColor, shape]);
  useEffect(() => {
    const e = engine.current;
    if (!e || e.environment === environment) return;
    e.environment = environment;
    e.dirty = true;
    e.env.dispose();
    e.env = makeEnvironment(e.renderer, environment);
    e.scene.environment = e.env.texture;
    const warm = environment === "Warm atelier",
      bright = environment === "Daylight";
    e.key.color.set(warm ? "#ffd5a5" : "#f1f6f2");
    e.rim.color.set(warm ? "#f6ba7c" : "#dbe3f3");
    e.renderer.toneMappingExposure = bright
      ? 1.65
      : environment === "Low-key studio"
        ? 0.8
        : 1.22;
  }, [environment]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.camera.position.set(4.1, 3.25, 6.8);
    e.controls.target.set(0, 1.65, 0);
    e.setZoom(1);
    e.controls.update();
  }, [resetToken]);
  useEffect(() => {
    const e = engine.current;
    if (!e || !zoom) return;
    if (zoom.macro) {
      // Center the macro view on a visible surface point instead of the empty object center.
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), e.camera);
      const hit = ray.intersectObject(e.specimen, false)[0];
      if (hit) {
        const shift = hit.point.clone().sub(e.controls.target);
        e.camera.position.add(shift);
        e.controls.target.copy(hit.point);
      }
      e.setZoom(8);
    } else if (zoom.percent) e.setZoom(zoom.percent / 100);
    else e.setZoom(e.magnification * (zoom.direction > 0 ? 1.5 : 1 / 1.5));
    e.controls.update();
  }, [zoom]);
  return (
    <div className="canvas-host" ref={host}>
      {error && (
        <div className="webgl-error">
          WebGL is unavailable. Please enable hardware acceleration to preview
          materials.
        </div>
      )}
    </div>
  );
}

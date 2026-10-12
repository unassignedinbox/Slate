import { renderBridgeStructure } from '../engine/bridges.js';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ChevronDown,
  Layers3,
  Sun,
  Grid2X2,
  Check,
  Maximize,
  Focus,
  Camera,
  Navigation,
  Map,
  Eye,
  Route,
  MousePointer2,
  Move,
  Spline,
  Scissors,
  Undo2,
  Redo2,
  X,
  Play,
  Square,
} from 'lucide-react';
import {
  buildNetworkScene,
  buildSelection,
  buildPropSelection,
  buildTerrain,
  disposeGroup,
  roadCurve,
  sampleRoad,
  ribbonGeometry,
} from '../engine/roads.js';
import {
  createRoad,
  downloadFile,
  roadWidth,
  DETAILS,
  laneDirection,
  canEnterRoad,
  createCurve,
  laneLayout,
  createBridge,
  isBridgePreset,
  ROAD_PRESETS,
  cloverleafFromGesture,
  diamondFromGesture,
  junctionFromGesture,
} from '../lib/network.js';

import { isRoadAttachedDetail, updatePlacedDetail } from '../lib/placement.js';
import { buildTopology } from '../lib/topology.js';
import { planInfrastructure } from '../lib/infrastructure.js';

function boundsFor(network) {
  const surfacePoints = network.roads.filter((r) => r.type !== 'subway').flatMap((r) => r.points);
  const points = surfacePoints.length ? surfacePoints : network.roads.flatMap((r) => r.points);
  if (!points.length)
    return { center: new THREE.Vector3(0, 0, 0), extent: Math.min(network.size * 0.5, 1000) };
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minZ = Math.min(...points.map((p) => p.z)),
    maxZ = Math.max(...points.map((p) => p.z));
  return {
    center: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
    extent: Math.max(maxX - minX, maxZ - minZ, 160),
  };
}

export function MiniMap({ network, selectedId, position, onNavigate }) {
  const bounds = boundsFor(network);
  const span = bounds.extent * 1.18;
  const x = (p) => 74 + ((p.x - bounds.center.x) / span) * 148;
  const y = (p) => 49 + ((p.z - bounds.center.z) / span) * 98;
  return (
    <div className="minimap">
      <div className="minimap-label">
        <span>WORLD OVERVIEW</span>
        <Map size={11} />
      </div>
      <svg
        viewBox="0 0 148 98"
        role="button"
        aria-label="Click minimap to move camera"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onNavigate(bounds.center.x, bounds.center.z);
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onNavigate(
            bounds.center.x + ((e.clientX - rect.left) / rect.width - 0.5) * span,
            bounds.center.z + ((e.clientY - rect.top) / rect.height - 0.5) * span,
          );
        }}
      >
        <defs>
          <pattern id="mini-grid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M12 0H0V12" fill="none" stroke="#5d6c59" strokeWidth="0.25" />
          </pattern>
        </defs>
        <rect width="148" height="98" fill="#2d382f" />
        <rect width="148" height="98" fill="url(#mini-grid)" />
        {network.roads
          .filter((r) => r.type !== 'subway')
          .map((r) => (
            <path
              key={r.id}
              d={createCurve(r)
                .getSpacedPoints(r.points.length > 2 ? 32 : 1)
                .map((p, i) => `${i ? 'L' : 'M'}${x(p)} ${y(p)}`)
                .join(' ')}
              fill="none"
              stroke={
                r.id === selectedId
                  ? '#d9bd83'
                  : r.type === 'path'
                    ? '#73997b'
                    : r.type === 'railway'
                      ? '#b0a4bf'
                      : r.type === 'bridge'
                        ? '#c1ad86'
                        : '#7d887d'
              }
              strokeWidth={r.id === selectedId ? 2 : r.type === 'highway' ? 2 : 1.1}
            />
          ))}
        <rect
          x="49"
          y="26"
          width="51"
          height="47"
          rx="2"
          fill="#d8c593"
          fillOpacity="0.025"
          stroke="#c4c9b0"
          strokeWidth="0.6"
          strokeDasharray="2 2"
        />
        <path
          d={`M${x(position || bounds.center)} ${y(position || bounds.center) - 4}l-3 7 3-1 3 1z`}
          fill="#ecddaf"
        />
      </svg>
      <div className="minimap-size">
        {(network.size / 1000).toFixed(1)} × {(network.size / 1000).toFixed(1)} km <span>●</span>
      </div>
    </div>
  );
}

const Viewport = forwardRef(function Viewport(props, ref) {
  const {
    network,
    selectedId,
    tool,
    activePreset,
    activeDetail,
    onSelect,
    onCreateRoad,
    onMovePoint,
    onPlaceDetail,
    onNotify,
    snap,
    driving,
    onDrivingChange,
    onToolChange,
    onSplit,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    resetSignal,
  } = props;
  const host = useRef(null),
    engine = useRef(null),
    live = useRef(props),
    selectedLabel = useRef(null);
  live.current = props;
  const [error, setError] = useState(false);
  const [view, setView] = useState('Perspective');
  const [style, setStyle] = useState('Shaded');
  const [menu, setMenu] = useState(null);
  const [layers, setLayers] = useState({
    roads: true,
    railways: true,
    details: true,
    terrain: true,
    grid: false,
    underground: false,
  });
  const [cameraInfo, setCameraInfo] = useState({ x: 0, y: 380, z: 0, fps: 60 });
  const [drawStarted, setDrawStarted] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const selectedProp = network.props.find((p) => p.id === props.selectedPropId);
  const selected = network.roads.find((r) => r.id === selectedId);

  const fit = () => {
    const e = engine.current;
    if (!e) return;
    const { center, extent } = boundsFor(live.current.network);
    e.controls.target.copy(center);
    e.camera.position
      .copy(center)
      .add(new THREE.Vector3(extent * 0.43, extent * 0.54, extent * 0.61));
    e.camera.lookAt(center);
    e.controls.update();
    setView('Perspective');
  };

  const focus = () => {
    const e = engine.current;
    const prop = live.current.network.props.find((p) => p.id === live.current.selectedPropId);
    const road = live.current.network.roads.find((r) => r.id === live.current.selectedId);
    if (!e || (!road && !prop)) return;
    const curve = road ? roadCurve(road) : null;
    const center = prop
      ? new THREE.Vector3(prop.x, (prop.y || 0) + 1, prop.z)
      : curve.getPointAt(0.5);
    const distance = prop
      ? Math.max(30, (prop.width || 7) * 2.5)
      : Math.max(curve.getLength() * 1.4, 90);
    e.controls.target.copy(center);
    e.camera.position
      .copy(center)
      .add(new THREE.Vector3(distance * 0.5, distance * 0.8, distance * 0.7));
    e.camera.lookAt(center);
    e.controls.update();
    setView('Perspective');
  };

  const changeView = (value) => {
    const e = engine.current;
    if (!e) return;
    if (value === 'Perspective') fit();
    if (value === 'Top view') {
      const { center, extent } = boundsFor(live.current.network);
      e.controls.target.copy(center);
      e.camera.position.copy(center).add(new THREE.Vector3(0, extent * 1.16, 0.01));
      e.camera.lookAt(center);
      e.controls.update();
    }
    setView(value);
    setMenu(null);
  };

  useImperativeHandle(ref, () => ({
    fit,
    focus,
    screenshot() {
      const e = engine.current;
      if (!e) throw new Error('A 3D renderer is required for screenshots.');
      e.renderer.render(e.scene, e.camera);
      e.renderer.domElement.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = `${live.current.network.name.toLowerCase()}-viewport.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    },
    async exportMesh(format, coordinates, options = {}) {
      const e = engine.current;
      if (e) e.exporting = true;
      let scene;
      try {
        // Let the progress state paint; keep the GPU idle while building an interchange asset.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        scene = buildNetworkScene(live.current.network, {
          underground: true,
          exporting: true,
          vegetation: false,
          fixtures: options.fixtures !== false,
        });
        if (coordinates === 'unreal') {
          scene.rotation.x = Math.PI / 2;
          scene.scale.setScalar(100);
        }
        scene.updateMatrixWorld(true);
        // Expand instanced lights so importers don't need the GPU-instancing glTF extension.
        const instanced = [];
        scene.traverse((o) => {
          if (o.isInstancedMesh) instanced.push(o);
        });
        instanced.forEach((o) => {
          const parent = o.parent,
            matrix = new THREE.Matrix4();
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, matrix);
            const mesh = new THREE.Mesh(o.geometry, o.material);
            mesh.name = `${o.name}_${i}`;
            matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
            parent.add(mesh);
          }
          o.removeFromParent();
        });
        scene.updateMatrixWorld(true);
        const name = live.current.network.name.toLowerCase().replace(/\W+/g, '-');
        if (format === 'obj') {
          const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
          downloadFile(`${name}-roads.obj`, new OBJExporter().parse(scene), 'text/plain');
        } else {
          const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
          const buffer = await new GLTFExporter().parseAsync(scene, {
            binary: true,
            onlyVisible: false,
          });
          downloadFile(`${name}-roads.glb`, buffer, 'model/gltf-binary');
        }
      } finally {
        disposeGroup(scene);
        if (e) e.exporting = false;
      }
    },
  }));

  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        logarithmicDepthBuffer: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor('#858d7e');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#8a9484', 0.000095);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.2, 24000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 8;
    controls.maxDistance = 14000;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    const sky = new THREE.HemisphereLight('#e2e7dc', '#535d4c', 2.1);
    scene.add(sky);
    const sun = new THREE.DirectionalLight('#fff0d4', 2.65);
    sun.position.set(-400, 650, -200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -800;
    sun.shadow.camera.right = sun.shadow.camera.top = 800;
    sun.shadow.camera.far = 1700;
    sun.shadow.normalBias = 0.8;
    sun.shadow.bias = -0.00015;
    scene.add(sun);
    const grid = new THREE.GridHelper(20000, 1000, '#929c85', '#929c85');
    grid.position.y = 0.04;
    grid.material.transparent = true;
    grid.material.opacity = 0.14;
    grid.visible = false;
    scene.add(grid);
    host.current.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      '3D road editor. Right mouse and WASD to fly. Alt and drag to orbit.',
    );
    const e = {
      renderer,
      scene,
      camera,
      controls,
      grid,
      keys: new Set(),
      flying: false,
      drawStart: null,
      ghost: null,
      dragging: null,
      pointer: null,
      model: null,
      terrain: null,
      selection: null,
      drive: null,
      dirty: true,
      lastPosition: new THREE.Vector3(),
      lastRotation: new THREE.Quaternion(),
    };
    engine.current = e;
    fit();
    const observer = new ResizeObserver(() => {
      const width = host.current?.clientWidth,
        height = host.current?.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      e.dirty = true;
    });
    observer.observe(host.current);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane(UP(), 0);
    function UP() {
      return new THREE.Vector3(0, 1, 0);
    }
    const worldAt = (event, height = 0) => {
      plane.constant = -height;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const position = new THREE.Vector3();
      const data = live.current;
      if (
        (data.tool === 'prop' ||
          (data.tool === 'draw' &&
            !e.drawStart &&
            ['tjunction', 'ymerge', 'crossroad'].includes(data.activePreset)) ||
          (e.dragging?.propId && e.dragging.original.roadId)) &&
        e.model
      ) {
        const hit = raycaster
          .intersectObject(e.model, true)
          .find((h) => h.object.userData.surface && h.object.visible && h.object.parent?.visible);
        if (hit) return { x: hit.point.x, z: hit.point.z, y: hit.point.y - 0.1 };
      }
      if (!raycaster.ray.intersectPlane(plane, position)) return null;
      let closest = null,
        distance = 10;
      if (data.tool === 'draw') {
        data.network.roads
          .filter((r) =>
            ['cloverleaf', 'diamond', 'tjunction', 'ymerge', 'crossroad'].includes(
              data.activePreset,
            )
              ? false
              : (ROAD_PRESETS.find((p) => p.id === data.activePreset)?.type ||
                    data.activePreset) === 'path'
                ? r.type === 'path'
                : data.activePreset === 'railway'
                  ? r.type === 'railway'
                  : !['subway', 'railway', 'path'].includes(r.type),
          )
          .forEach((r) =>
            [r.points[0], r.points.at(-1)].forEach((p) => {
              const d = Math.hypot(p.x - position.x, p.z - position.z);
              if (d < distance) {
                distance = d;
                closest = p;
              }
            }),
          );
      }
      if (closest) return { ...closest };
      return {
        x: data.snap || event.shiftKey ? Math.round(position.x / 5) * 5 : position.x,
        z: data.snap || event.shiftKey ? Math.round(position.z / 5) * 5 : position.z,
        y: 0,
      };
    };
    const pickedObject = (event) => {
      worldAt(event);
      if (!e.model) return null;
      const hits = raycaster.intersectObject(e.model, true);
      for (const hit of hits) {
        let ancestor = hit.object,
          visible = true;
        while (ancestor) {
          if (!ancestor.visible) visible = false;
          ancestor = ancestor.parent;
        }
        if (!visible) continue;
        let parent = hit.object;
        while (parent) {
          if (parent.userData.propId) return { propId: parent.userData.propId };
          parent = parent.parent;
        }
        const ranges = hit.object.userData.faceRanges;
        if (ranges) {
          let low = 0,
            high = ranges.length - 1,
            range;
          while (low <= high) {
            const mid = (low + high) >> 1,
              item = ranges[mid];
            if (hit.faceIndex < item.start) high = mid - 1;
            else if (hit.faceIndex >= item.end) low = mid + 1;
            else {
              range = item;
              break;
            }
          }
          if (range?.propId) return { propId: range.propId };
          if (range?.roadId) return { roadId: range.roadId };
          if (range?.junctionId) {
            const road = live.current.network.roads.find((r) =>
              [r.points[0], r.points.at(-1)].some((p) => p.nodeId === range.junctionId),
            );
            if (road) return { roadId: road.id };
          }
        }
        let object = hit.object;
        while (object) {
          if (object.userData.roadId) {
            const road = live.current.network.roads.find((r) => r.id === object.userData.roadId);
            if (!road?.hidden) return { roadId: object.userData.roadId };
            break;
          }
          object = object.parent;
        }
        if (hit.object.userData.junctionId) {
          const road = live.current.network.roads.find((r) =>
            [r.points[0], r.points.at(-1)].some((p) => p.nodeId === hit.object.userData.junctionId),
          );
          if (road) return { roadId: road.id };
        }
      }
      return null;
    };
    const pointNear = (event) => {
      const road = live.current.network.roads.find((r) => r.id === live.current.selectedId);
      if (!road) return -1;
      const rect = renderer.domElement.getBoundingClientRect();
      let index = -1,
        min = 18;
      road.points.forEach((p, i) => {
        const v = new THREE.Vector3(p.x, (p.y || 0) + 0.75, p.z).project(camera);
        const distance = Math.hypot(
          ((v.x + 1) / 2) * rect.width + rect.left - event.clientX,
          ((-v.y + 1) / 2) * rect.height + rect.top - event.clientY,
        );
        if (distance < min) {
          min = distance;
          index = i;
        }
      });
      return index;
    };
    const clearGhost = () => {
      e.dirty = true;
      if (e.ghost) {
        disposeGroup(e.ghost);
        e.ghost = null;
      }
    };
    const showGhost = (position) => {
      clearGhost();
      if (!e.drawStart || !position) return;
      let road = createRoad(live.current.activePreset, [e.drawStart, position], 'ghost');
      if (live.current.activePreset === 'roundabout') {
        const radius = Math.max(
          18,
          Math.min(400, Math.hypot(position.x - e.drawStart.x, position.z - e.drawStart.z)),
        );
        const points = Array.from({ length: 33 }, (_, i) => ({
          x: e.drawStart.x + Math.cos((i / 32) * Math.PI * 2) * radius,
          z: e.drawStart.z + Math.sin((i / 32) * Math.PI * 2) * radius,
        }));
        road = createRoad('roundabout', points, 'ghost', { closed: true });
      }
      let roads;
      const preset = live.current.activePreset;
      if (['tjunction', 'ymerge', 'crossroad'].includes(preset)) {
        try {
          roads = junctionFromGesture(
            live.current.network,
            preset,
            [e.drawStart, position],
            'ghost-junction',
          ).roads;
        } catch {
          return;
        }
      } else if (['cloverleaf', 'diamond'].includes(preset)) {
        roads = (preset === 'diamond' ? diamondFromGesture : cloverleafFromGesture)(
          [e.drawStart, position],
          live.current.network.standard,
          'ghost-interchange',
        );
      } else
        roads = [
          isBridgePreset(preset)
            ? createBridge([e.drawStart, position], preset, undefined, 'ghost')
            : road,
        ];
      e.ghost = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({
        color: '#e5ca8e',
        transparent: true,
        opacity: 0.42,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      for (const preview of roads) {
        const mesh = new THREE.Mesh(
          ribbonGeometry(sampleRoad(preview), roadWidth(preview), 0, 0.5),
          material,
        );
        mesh.renderOrder = 25;
        e.ghost.add(mesh);
        if (preview.bridgeStyle) {
          const ghostNetwork = { roads: [preview], props: [] },
            ghostTopology = buildTopology(ghostNetwork),
            ghostInfrastructure = planInfrastructure(ghostNetwork);
          renderBridgeStructure(
            e.ghost,
            preview,
            ghostTopology.plans.get(preview.id),
            ghostInfrastructure,
            {
              bridgeSteel: material,
              bridgeCable: material,
              bridgeTimber: material,
              bridgeStone: material,
              bridgeRoof: material,
              structuralConcrete: material,
            },
          );
        }
      }
      scene.add(e.ghost);
    };
    const down = (event) => {
      renderer.domElement.focus({ preventScroll: true });
      e.pointer = { x: event.clientX, y: event.clientY, button: event.button };
      if (event.button === 2) {
        e.flying = true;
        controls.enabled = false;
        e.lastMouse = { x: event.clientX, y: event.clientY };
        renderer.domElement.setPointerCapture(event.pointerId);
      } else if (event.button === 0 && event.altKey) {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        controls.enabled = true;
      } else if (event.button === 0 && live.current.tool === 'move') {
        const prop = live.current.network.props.find((p) => p.id === live.current.selectedPropId);
        const hit = pickedObject(event);
        const attached = prop?.roadId && isRoadAttachedDetail(prop);
        // The selection envelope also permits grabbing gaps between zebra
        // stripes and orphaned markings, which intentionally have no mesh.
        const envelopeHit =
          attached &&
          e.selection &&
          raycaster.ray.intersectsBox(
            new THREE.Box3().setFromObject(e.selection).expandByScalar(0.8),
          );
        if (prop && (hit?.propId === prop.id || envelopeHit)) {
          e.dragging = {
            propId: prop.id,
            original: prop,
            position: worldAt(event),
            context: attached
              ? {
                  topology: buildTopology(live.current.network),
                  infrastructure: planInfrastructure(live.current.network),
                }
              : null,
          };
          controls.enabled = false;
          renderer.domElement.setPointerCapture(event.pointerId);
          return;
        }
        const index = pointNear(event);
        if (index >= 0) {
          const road = live.current.network.roads.find((r) => r.id === live.current.selectedId);
          const height = road.points[index].y || 0;
          e.dragging = { index, height, position: worldAt(event, height) };
          controls.enabled = false;
          renderer.domElement.setPointerCapture(event.pointerId);
        }
      }
    };
    const move = (event) => {
      if (e.flying) {
        const dx = event.clientX - e.lastMouse.x,
          dy = event.clientY - e.lastMouse.y;
        const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        rotation.y -= dx * 0.003;
        rotation.x = Math.max(-1.5, Math.min(1.5, rotation.x - dy * 0.003));
        camera.quaternion.setFromEuler(rotation);
        e.lastMouse = { x: event.clientX, y: event.clientY };
        return;
      }
      if (e.dragging) {
        e.dirty = true;
        e.dragging.position = worldAt(event, e.dragging.height || e.dragging.original?.y || 0);
        if (e.dragging.propId && e.dragging.position && e.selection) {
          const preview = e.dragging.context
            ? updatePlacedDetail(
                live.current.network,
                e.dragging.original,
                e.dragging.position,
                e.dragging.context,
              )
            : e.dragging.position;
          if (preview) {
            e.selection.position.x = preview.x - e.dragging.original.x;
            e.selection.position.y = (preview.y || 0) - (e.dragging.original.y || 0);
            e.selection.position.z = preview.z - e.dragging.original.z;
          }
          return;
        }
        const marker = e.selection?.children.find(
          (c) => c.userData.pointIndex === e.dragging.index,
        );
        if (marker && e.dragging.position) {
          marker.position.x = e.dragging.position.x;
          marker.position.z = e.dragging.position.z;
        }
        return;
      }
      if (e.drawStart) showGhost(worldAt(event));
      if (live.current.tool === 'move')
        renderer.domElement.style.cursor = pointNear(event) >= 0 ? 'grab' : 'default';
      else
        renderer.domElement.style.cursor = ['draw', 'prop'].includes(live.current.tool)
          ? 'crosshair'
          : 'default';
    };
    const up = (event) => {
      if (e.flying) {
        e.flying = false;
        const direction = camera.getWorldDirection(new THREE.Vector3());
        controls.target
          .copy(camera.position)
          .addScaledVector(direction, Math.max(50, camera.position.y * 1.2));
        controls.enabled = true;
        e.pointer = null;
        return;
      }
      if (e.dragging) {
        if (e.dragging.position) {
          const position = { x: e.dragging.position.x, z: e.dragging.position.z };
          if (e.dragging.context) position.y = e.dragging.position.y;
          if (e.dragging.propId) live.current.onMoveProp(e.dragging.propId, position);
          else live.current.onMovePoint(live.current.selectedId, e.dragging.index, position);
        }
        // Clear temporary previews even when the parent rejects the drop.
        if (e.dragging.propId && e.selection) e.selection.position.set(0, 0, 0);
        if (!e.dragging.propId && e.selection) {
          const point = live.current.network.roads.find((r) => r.id === live.current.selectedId)
            ?.points[e.dragging.index];
          const marker = e.selection.children.find(
            (c) => c.userData.pointIndex === e.dragging.index,
          );
          if (point && marker) marker.position.set(point.x, (point.y || 0) + 0.75, point.z);
        }
        e.dragging = null;
        controls.enabled = true;
        e.pointer = null;
        return;
      }
      if (
        !e.pointer ||
        event.button !== 0 ||
        event.altKey ||
        Math.hypot(event.clientX - e.pointer.x, event.clientY - e.pointer.y) > 5
      ) {
        controls.mouseButtons.LEFT = null;
        e.pointer = null;
        return;
      }
      const data = live.current;
      if (data.tool === 'draw') {
        const position = worldAt(event);
        if (!position) return;
        if (!e.drawStart) {
          e.drawStart = position;
          setDrawStarted(true);
        } else if (Math.hypot(position.x - e.drawStart.x, position.z - e.drawStart.z) > 3) {
          const points = [e.drawStart, position].map((p) => ({
            ...p,
            nodeId: p.nodeId || `node-${crypto.randomUUID()}`,
          }));
          if (event.shiftKey)
            points.splice(1, 0, {
              x: (points[0].x + points[1].x) / 2 + (points[1].z - points[0].z) * 0.2,
              z: (points[0].z + points[1].z) / 2 - (points[1].x - points[0].x) * 0.2,
            });
          data.onCreateRoad(data.activePreset, points);
          e.drawStart = null;
          setDrawStarted(false);
          clearGhost();
        }
      } else if (data.tool === 'prop') {
        const position = worldAt(event);
        if (position) data.onPlaceDetail(data.activeDetail, position);
      } else {
        const hit = pickedObject(event);
        if (hit?.propId) data.onSelectProp(hit.propId);
        else if (hit?.roadId) data.onSelect(hit.roadId);
      }
      e.pointer = null;
    };
    const keydown = (event) => {
      if (live.current.blocked) return;
      if (!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && !event.target.isContentEditable)
        e.keys.add(event.code);
      if (event.key === 'Escape') {
        e.drawStart = null;
        setDrawStarted(false);
        clearGhost();
        e.keys.clear();
      }
    };
    const keyup = (event) => e.keys.delete(event.code);
    const blur = () => {
      e.keys.clear();
      e.flying = false;
      controls.enabled = true;
    };
    const context = (event) => event.preventDefault();
    const doubleclick = (event) => {
      const hit = pickedObject(event);
      if (hit?.propId) live.current.onSelectProp(hit.propId);
      else if (hit?.roadId) live.current.onSelect(hit.roadId);
      if (hit) setTimeout(focus, 0);
    };
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('contextmenu', context);
    renderer.domElement.addEventListener('dblclick', doubleclick);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    let frame,
      previous = performance.now(),
      lastStatus = 0;
    const animate = (time) => {
      frame = requestAnimationFrame(animate);
      const elapsed = (time - previous) / 1000;
      const dt = Math.min(elapsed, 0.05);
      previous = time;
      const data = live.current;
      if (data.blocked) e.keys.clear();
      if (data.driving && e.drive) {
        const route = e.drive;
        const length = route.curve.getLength();
        route.progress += (dt * (route.road.speed / 3.6)) / length;
        if (route.progress >= 1) {
          const endPoint = route.reverse ? route.road.points[0] : route.road.points.at(-1);
          const possible = data.network.roads.filter(
            (r) =>
              r.id !== route.road.id &&
              r.lanes > 0 &&
              !['subway', 'railway'].includes(r.type) &&
              canEnterRoad(r, endPoint, data.network.standard) &&
              [r.points[0], r.points.at(-1)].some(
                (p) =>
                  Math.hypot(p.x - endPoint.x, p.z - endPoint.z, (p.y || 0) - (endPoint.y || 0)) <
                  0.1,
              ),
          );
          if (!possible.length && (route.road.oneWay || route.road.type === 'roundabout')) {
            data.onNotify('Reached the end of this one-way route.');
            data.onDrivingChange(false);
          }
          const next =
            possible[Math.floor(time / 1000) % Math.max(possible.length, 1)] || route.road;
          const reversed =
            Math.hypot(next.points[0].x - endPoint.x, next.points[0].z - endPoint.z) > 0.1;
          e.drive = { road: next, curve: roadCurve(next), reverse: reversed, progress: 0 };
        } else {
          const t = route.reverse ? 1 - route.progress : route.progress;
          const p = route.curve.getPointAt(t),
            tangent = route.curve.getTangentAt(t).multiplyScalar(route.reverse ? -1 : 1);
          const raw = route.curve.getTangentAt(t);
          const normal = new THREE.Vector3(-raw.z, 0, raw.x).normalize();
          const band = laneLayout(route.road)
            .filter(
              (b) =>
                b.kind === 'lane' &&
                laneDirection(route.road, b.side, data.network.standard) ===
                  (route.reverse ? -1 : 1),
            )
            .sort((a, b) => Math.abs(a.center) - Math.abs(b.center))[0];
          p.addScaledVector(normal, band?.center || 0);
          camera.position
            .copy(p)
            .addScaledVector(tangent, -7)
            .add(new THREE.Vector3(0, 3.1, 0));
          camera.lookAt(
            p
              .clone()
              .addScaledVector(tangent, 28)
              .add(new THREE.Vector3(0, 1.7, 0)),
          );
        }
      } else {
        if (e.keys.size) {
          const speed =
            Math.max(20, camera.position.y * 0.6) *
            dt *
            (e.keys.has('ShiftLeft') || e.keys.has('ShiftRight') ? 3 : 1);
          const direction = camera.getWorldDirection(new THREE.Vector3());
          direction.y = 0;
          direction.normalize();
          const right = new THREE.Vector3().crossVectors(direction, UP()).normalize();
          const delta = new THREE.Vector3();
          if (e.keys.has('KeyW')) delta.add(direction);
          if (e.keys.has('KeyS')) delta.sub(direction);
          if (e.keys.has('KeyD')) delta.add(right);
          if (e.keys.has('KeyA')) delta.sub(right);
          if (e.keys.has('KeyE')) delta.y += 1;
          if (e.keys.has('KeyQ')) delta.y -= 1;
          delta.multiplyScalar(speed);
          if (camera.position.y + delta.y < 1) delta.y = 1 - camera.position.y;
          camera.position.add(delta);
          controls.target.add(delta);
        }
        if (!e.flying) controls.update();
      }
      // Adapt the near plane to altitude: centimeter-thin markings remain stable across kilometer-scale maps.
      const near = Math.max(0.25, Math.min(80, camera.position.y * 0.035));
      if (Math.abs(camera.near - near) > 0.02) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      if (e.selection) {
        e.selection.children
          .filter((o) => o.userData.handle)
          .forEach((o) => {
            const distance = camera.position.distanceTo(o.position);
            const worldPerPixel =
              (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
              Math.max(1, host.current.clientHeight);
            o.scale.setScalar(
              (worldPerPixel * (o.userData.baseSize === 1.7 ? 4 : 6)) / o.userData.baseSize,
            );
          });
        if (selectedLabel.current && !e.selection.userData.center)
          selectedLabel.current.style.display = 'none';
        if (selectedLabel.current && e.selection.userData.center) {
          const point = e.selection.userData.center.clone().project(camera);
          const x = ((point.x + 1) / 2) * host.current.clientWidth,
            y = ((-point.y + 1) / 2) * host.current.clientHeight;
          selectedLabel.current.style.left = `${x}px`;
          selectedLabel.current.style.top = `${y - 18}px`;
          selectedLabel.current.style.display =
            point.z < 1 &&
            x > 40 &&
            x < host.current.clientWidth - 40 &&
            y > 70 &&
            y < host.current.clientHeight - 65 &&
            !data.driving
              ? 'flex'
              : 'none';
        }
      }
      const cameraChanged =
        camera.position.distanceToSquared(e.lastPosition) > 1e-8 ||
        1 - Math.abs(camera.quaternion.dot(e.lastRotation)) > 1e-8;
      if (!e.exporting && !document.hidden && (e.dirty || cameraChanged || data.driving)) {
        renderer.render(scene, camera);
        e.lastPosition.copy(camera.position);
        e.lastRotation.copy(camera.quaternion);
        e.dirty = false;
      }
      if (time - lastStatus > 500) {
        setCameraInfo({
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
          rendering: cameraChanged || data.driving || e.flying,
          fps: Math.min(60, Math.round(1 / Math.max(elapsed, 0.001))),
          speed: e.drive?.road.speed,
          driveName: e.drive?.road.name,
        });
        lastStatus = time;
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down, true);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('contextmenu', context);
      renderer.domElement.removeEventListener('dblclick', doubleclick);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      disposeGroup(e.model);
      disposeGroup(e.terrain);
      disposeGroup(e.selection);
      clearGhost();
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    disposeGroup(e.model);
    e.model = buildNetworkScene(network, { ...layers, wireframe: style === 'Wireframe' });
    e.scene.add(e.model);
    disposeGroup(e.terrain);
    e.terrain = buildTerrain(network);
    e.terrain.visible = layers.terrain;
    e.scene.add(e.terrain);
    e.grid.visible = layers.grid;
    e.renderer.shadowMap.needsUpdate = true;
    e.dirty = true;
  }, [network, layers, style]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    disposeGroup(e.selection);
    e.selection = selectedProp
      ? buildPropSelection(selectedProp, network)
      : selected?.hidden
        ? new THREE.Group()
        : buildSelection(selected);
    e.scene.add(e.selection);
    e.dirty = true;
  }, [selected, selectedProp]);

  useEffect(() => {
    if (selected?.type === 'subway')
      setLayers((l) => (l.underground ? l : { ...l, underground: true }));
  }, [selectedId]);

  useEffect(() => {
    if (resetSignal) fit();
  }, [resetSignal]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (tool !== 'draw') {
      e.drawStart = null;
      setDrawStarted(false);
      disposeGroup(e.ghost);
      e.ghost = null;
      e.dirty = true;
    }
  }, [tool, activePreset]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (driving) {
      const road =
        network.roads.find(
          (r) => r.id === selectedId && r.lanes > 0 && !['subway', 'railway'].includes(r.type),
        ) || network.roads.find((r) => r.lanes > 0 && !['subway', 'railway'].includes(r.type));
      if (!road) {
        onNotify('Add a drivable road before starting preview.');
        onDrivingChange(false);
        return;
      }
      e.restore = { position: e.camera.position.clone(), target: e.controls.target.clone() };
      e.drive = {
        road,
        curve: roadCurve(road),
        progress: 0.08,
        reverse: road.type === 'roundabout' && laneDirection(road, -1, network.standard) === -1,
      };
      e.controls.enabled = false;
    } else if (e.restore) {
      e.camera.position.copy(e.restore.position);
      e.controls.target.copy(e.restore.target);
      e.controls.enabled = true;
      e.controls.update();
      e.drive = null;
      e.restore = null;
    }
  }, [driving]);

  const navigate = (x, z) => {
    const e = engine.current;
    if (!e) return;
    const delta = new THREE.Vector3(x - e.controls.target.x, 0, z - e.controls.target.z);
    e.controls.target.add(delta);
    e.camera.position.add(delta);
    e.controls.update();
  };
  const toolButtons = [
    { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
    { id: 'move', icon: Move, label: 'Move spline points', key: 'G' },
    { id: 'draw', icon: Spline, label: 'Draw road', key: 'R' },
  ];

  return (
    <section
      className={`viewport ${maximized ? 'viewport-maximized' : ''}`}
      aria-label="Road network viewport"
    >
      <div className="canvas-host" ref={host} />
      {error && (
        <div className="webgl-fallback">
          <Map size={28} />
          <h3>Map view</h3>
          <p>3D needs WebGL. Your road network is still editable.</p>
          <svg viewBox="-400 -400 800 800">
            {network.roads.map((r) => (
              <path
                key={r.id}
                d={r.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.z}`).join(' ')}
                onClick={() => onSelect(r.id)}
                stroke={r.id === selectedId ? '#dfc48e' : '#adb6a2'}
                strokeWidth={roadWidth(r)}
                fill="none"
              />
            ))}
          </svg>
        </div>
      )}
      <div className="viewport-top">
        <div className="viewport-selectors">
          <div className="relative">
            <button
              className="glass-button"
              onClick={() => setMenu(menu === 'view' ? null : 'view')}
            >
              <span className="view-dot" />
              {view}
              <ChevronDown size={11} />
            </button>
            {menu === 'view' && (
              <div className="viewport-menu">
                {['Perspective', 'Top view', 'Unreal fly'].map((v) => (
                  <button key={v} onClick={() => changeView(v)}>
                    {v === 'Top view' ? <Map size={13} /> : <Navigation size={13} />}
                    {v}
                    {view === v && <Check size={12} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              className="glass-button"
              onClick={() => setMenu(menu === 'style' ? null : 'style')}
            >
              <Sun size={13} />
              {style}
              <ChevronDown size={11} />
            </button>
            {menu === 'style' && (
              <div className="viewport-menu">
                {['Shaded', 'Wireframe'].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setStyle(s);
                      setMenu(null);
                    }}
                  >
                    <Eye size={13} />
                    {s}
                    {style === s && <Check size={12} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="viewport-actions">
          <div className="relative">
            <button
              title="Viewport layers"
              aria-label="Viewport layers"
              className={`glass-icon ${menu === 'layers' ? 'active' : ''}`}
              onClick={() => setMenu(menu === 'layers' ? null : 'layers')}
            >
              <Layers3 size={15} />
            </button>
            {menu === 'layers' && (
              <div className="viewport-menu layer-menu">
                <span className="menu-caption">VISIBLE LAYERS</span>
                {Object.entries({
                  roads: 'Road surfaces',
                  railways: 'Surface railway',
                  details: 'Street details',
                  terrain: 'Terrain & river',
                  grid: 'World grid',
                  underground: 'Subway overlay',
                }).map(([id, name]) => (
                  <button key={id} onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}>
                    <span className={`layer-check ${layers[id] ? 'checked' : ''}`}>
                      {layers[id] && <Check size={11} />}
                    </span>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            title="Frame entire network (Home)"
            aria-label="Frame entire network"
            className="glass-icon"
            onClick={fit}
          >
            <Focus size={15} />
          </button>
          <button
            title="Capture viewport"
            aria-label="Capture viewport"
            className="glass-icon"
            onClick={() => {
              try {
                ref.current.screenshot();
                onNotify('Viewport snapshot downloaded.');
              } catch (error) {
                onNotify(error.message, 'error');
              }
            }}
          >
            <Camera size={15} />
          </button>
          <button
            title={maximized ? 'Restore viewport' : 'Maximize viewport'}
            aria-label="Maximize viewport"
            className="glass-icon"
            onClick={() => setMaximized(!maximized)}
          >
            {maximized ? <X size={15} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>
      <div className="viewport-project">
        <span className="eyebrow">
          {driving
            ? 'LIVE DRIVE PREVIEW'
            : 'WESTHAVEN DISTRICT'.replace('WESTHAVEN', network.name.toUpperCase())}
        </span>
        <span>{driving ? 'Follow camera · automatic route' : 'Road network · no buildings'}</span>
      </div>
      {(selected || selectedProp) && (
        <div className="selection-label" ref={selectedLabel}>
          <Route size={11} />
          <span>
            {selectedProp ? DETAILS.find((d) => d.id === selectedProp.type)?.name : selected.name}
          </span>
          <small>
            {selectedProp ? 'DETAIL' : `${Math.round(roadCurve(selected).getLength())} m`}
          </small>
        </div>
      )}
      <button
        className="orientation-gizmo"
        title="Switch to top view"
        aria-label="Switch to top view"
        onClick={() => changeView('Top view')}
      >
        <svg viewBox="0 0 68 72">
          <path d="M34 38V10M34 38L58 51M34 38L10 52" stroke="#ccd0bd" strokeWidth="1.5" />
          <circle cx="34" cy="38" r="7" fill="#d1d1bd" />
          <circle cx="34" cy="10" r="8" fill="#7e91a1" />
          <circle cx="58" cy="51" r="8" fill="#ae7870" />
          <circle cx="10" cy="52" r="8" fill="#91a17b" />
          <text x="34" y="13">
            Z
          </text>
          <text x="58" y="54">
            X
          </text>
          <text x="10" y="55">
            Y
          </text>
        </svg>
      </button>
      {tool === 'draw' && (
        <div className="viewport-instruction">
          <Spline size={14} />
          <span>
            {['cloverleaf', 'diamond'].includes(activePreset)
              ? drawStarted
                ? 'Click to set interchange size & orientation'
                : 'Click to place the interchange center'
              : activePreset === 'railway'
                ? drawStarted
                  ? 'Click to finish the rail line'
                  : 'Click to start continuous train tracks'
                : activePreset === 'roundabout'
                  ? drawStarted
                    ? 'Click to set the roundabout radius'
                    : 'Click to place the roundabout center'
                  : drawStarted
                    ? 'Click to finish your road'
                    : ['tjunction', 'ymerge', 'crossroad'].includes(activePreset)
                      ? 'Click an existing road to attach'
                      : 'Click to place the start point'}
          </span>
          {!['cloverleaf', 'diamond', 'tjunction', 'ymerge', 'crossroad'].includes(
            activePreset,
          ) && (
            <>
              <kbd>Shift</kbd>
              <small>Curve</small>
            </>
          )}
          <kbd>Esc</kbd>
          <small>Cancel</small>
        </div>
      )}
      {tool === 'move' && (
        <div className="viewport-instruction">
          <Move size={14} />
          <span>Drag a spline handle to reshape connected roads</span>
        </div>
      )}
      {tool === 'prop' && (
        <div className="viewport-instruction">
          <MousePointer2 size={14} />
          <span>Click to place {activeDetail?.name.toLowerCase()}</span>
          <kbd>Esc</kbd>
          <small>Cancel</small>
        </div>
      )}
      {driving && (
        <div className="drive-hud">
          <div>
            <span>DRIVE PREVIEW</span>
            <strong>
              {cameraInfo.speed || selected?.speed || 50}
              <small>km/h</small>
            </strong>
          </div>
          <button onClick={() => onDrivingChange(false)}>
            <Square size={12} />
            Stop preview <kbd>Esc</kbd>
          </button>
        </div>
      )}
      <div className="viewport-bottom">
        <div className="viewport-coordinates">
          <div className="scale-marker">
            <span>50 m</span>
            <i />
          </div>
          <span>
            <b>X</b> {Math.round(cameraInfo.x).toLocaleString()} <b>Y</b>{' '}
            {Math.round(cameraInfo.z).toLocaleString()} <b>Z</b>{' '}
            {Math.round(cameraInfo.y).toLocaleString()}
          </span>
        </div>
        <div className="floating-tools">
          {toolButtons.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? 'active' : ''}
              aria-label={t.label}
              title={`${t.label} (${t.key})`}
              onClick={() => onToolChange(t.id)}
            >
              <t.icon size={17} />
            </button>
          ))}
          <span className="tool-divider" />
          <button
            title="Split selected segment"
            aria-label="Split selected segment"
            onClick={onSplit}
          >
            <Scissors size={17} />
          </button>
          <button
            title="Snap to 5 meter grid"
            aria-label="Snap to 5 meter grid"
            aria-pressed={snap}
            className={snap ? 'active subtle' : ''}
            onClick={() => props.onSnapChange(!snap)}
          >
            <Grid2X2 size={17} />
          </button>
          <span className="tool-divider" />
          <button title="Undo (Ctrl+Z)" aria-label="Undo" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={17} />
          </button>
          <button
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            onClick={onRedo}
            disabled={!canRedo}
          >
            <Redo2 size={17} />
          </button>
        </div>
        <MiniMap
          network={network}
          selectedId={selectedId}
          position={cameraInfo}
          onNavigate={navigate}
        />
      </div>
      <div className="viewport-hints">
        <span>
          <kbd>RMB</kbd> + <kbd>WASD</kbd> Fly
        </span>
        <i />
        <span>
          <kbd>Alt</kbd> + drag Orbit
        </span>
        <i />
        <span>
          <kbd>F</kbd> Focus
        </span>
        <span className="fps">
          <span className="live-dot" />{' '}
          {cameraInfo.rendering ? `${cameraInfo.fps} FPS` : 'ON-DEMAND'}
        </span>
      </div>
    </section>
  );
});
export default Viewport;

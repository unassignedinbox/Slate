// 3D cockpit: the HMI panels are placed as real 3D objects on a curved layout
// inside a 3D tablet bezel that sits on a 3D floor. Panels are DOM elements
// (CSS3D) so the existing widgets and 3D car viewports keep working.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { state } from '../core/store.js';

// Landscape tablet design target (~16:10). Units are CSS px at the design distance.
export const LAYOUT = { railW: 300, centerW: 820, gap: 16, barH: 44, navH: 64, rowH: 640, pad: 12 };
const TOTAL_W = LAYOUT.railW * 2 + LAYOUT.centerW + LAYOUT.gap * 2;          // 1452
const TOTAL_H = LAYOUT.barH + LAYOUT.pad + LAYOUT.rowH + LAYOUT.pad + LAYOUT.navH; // 772
const RAIL_X = LAYOUT.centerW / 2 + LAYOUT.gap + LAYOUT.railW / 2 + 60;      // 636 (rails pushed out so the window never covers them)
const FOV = 40;
const WIN_Z = { rest: 40, open: 110 };   // centre window moves toward the driver when an app opens

function roundRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function mountCockpit3D(root, parts) {
  root.replaceChildren();
  const glHost = document.createElement('div');
  glHost.className = 'gl-host';
  const cssHost = document.createElement('div');
  cssHost.className = 'css-host';
  root.append(glHost, cssHost);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  glHost.append(renderer.domElement);
  const css = new CSS3DRenderer();
  cssHost.append(css.domElement);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 8000);
  const glScene = new THREE.Scene();
  const cssScene = new THREE.Scene();
  glScene.fog = new THREE.Fog(0x07080a, 1400, 3400);
  const glRig = new THREE.Group();   // WebGL objects that move with the parallax
  const cssRig = new THREE.Group();  // CSS3D panels, same transform
  glScene.add(glRig);
  cssScene.add(cssRig);

  // Lights
  glScene.add(new THREE.HemisphereLight(0xdfe7ff, 0x0b0c10, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(300, 700, 900);
  glScene.add(key);
  const accentLight = new THREE.PointLight(state.settings.accent, 2.4, 1600);
  accentLight.position.set(0, -260, 420);
  glScene.add(accentLight);

  // Tablet bezel (3D extruded rounded slab behind the panels)
  const bezelW = 2 * RAIL_X + LAYOUT.railW + 56, bezelH = TOTAL_H + 40;
  const bezelGeo = new THREE.ExtrudeGeometry(roundRect(bezelW, bezelH, 44), {
    depth: 20, bevelEnabled: true, bevelThickness: 8, bevelSize: 8, bevelSegments: 4, curveSegments: 18,
  });
  const bezel = new THREE.Mesh(bezelGeo, new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.6, roughness: 0.35 }));
  bezel.position.z = -120;
  glRig.add(bezel);
  const edgeMat = new THREE.LineBasicMaterial({ color: state.settings.accent, transparent: true, opacity: 0.7 });
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(bezelGeo, 30), edgeMat);
  edge.position.copy(bezel.position);
  glRig.add(edge);

  // Floor under the tablet
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -440;
  glScene.add(floor);
  const grid = new THREE.GridHelper(6000, 120, 0x1c2029, 0x14171e);
  grid.position.y = -439;
  glScene.add(grid);

  // CSS3D panels, placed on a curved cockpit layout
  const place = (el, w, h, x, y, z, ry = 0) => {
    el.classList.add('cs-panel');
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    const o = new CSS3DObject(el);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    cssRig.add(o);
    return o;
  };
  const barY = TOTAL_H / 2 - LAYOUT.barH / 2;
  const rowY = barY - LAYOUT.barH / 2 - LAYOUT.pad - LAYOUT.rowH / 2;
  const navY = rowY - LAYOUT.rowH / 2 - LAYOUT.pad - LAYOUT.navH / 2;
  place(parts.statusbar, TOTAL_W, LAYOUT.barH, 0, barY, 60);
  place(parts.leftRail, LAYOUT.railW, LAYOUT.rowH, -RAIL_X, rowY, -40, 0.3);
  const win = place(parts.windowEl, LAYOUT.centerW, LAYOUT.rowH, 0, rowY, WIN_Z.rest);
  place(parts.rightRail, LAYOUT.railW, LAYOUT.rowH, RAIL_X, rowY, -40, -0.3);
  place(parts.navbar, TOTAL_W, LAYOUT.navH, 0, navY, 60);

  // Fit the cockpit to the viewport (keeps 1:1 CSS px at the design distance).
  let dist = 1000;
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    renderer.setSize(vw, vh);
    css.setSize(vw, vh);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    const s = Math.min(vw / (bezelW + 220), vh / (bezelH + 60));
    dist = (vh / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / s;
  }
  window.addEventListener('resize', fit);
  fit();

  // Pointer / touch parallax: the whole cockpit leans toward the touch point.
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
    ptr.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  let winZ = WIN_Z.rest, winTarget = WIN_Z.rest;
  function frame() {
    ptr.sx += (ptr.x - ptr.sx) * 0.05;
    ptr.sy += (ptr.y - ptr.sy) * 0.05;
    const ry = ptr.sx * 0.12, rx = ptr.sy * 0.05;
    glRig.rotation.set(rx, ry, 0);
    cssRig.rotation.set(rx, ry, 0);
    winZ += (winTarget - winZ) * 0.12;
    win.position.z = winZ;
    edgeMat.color.set(state.settings.accent);
    accentLight.color.set(state.settings.accent);
    camera.position.set(0, dist * 0.16, dist);
    camera.lookAt(0, 0, 0);
    renderer.render(glScene, camera);
    css.render(cssScene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setWindowDepth(open) { winTarget = open ? WIN_Z.open : WIN_Z.rest; },
  };
}

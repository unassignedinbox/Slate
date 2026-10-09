// Flat tablet: every HMI panel sits on one flat screen plane, framed by a 3D
// tablet bezel. The device (bezel + screen) can lean slightly with the pointer
// so it reads as a real 3D object, but the UI itself stays flat and aligned.
// Panels are DOM elements placed with CSS3D so the existing widgets and the
// 3D car viewports keep working.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { state } from '../core/store.js';

// Landscape tablet screen layout. Units are CSS px on the screen plane.
export const LAYOUT = { railW: 300, centerW: 820, gap: 16, barH: 44, navH: 64, rowH: 640, pad: 12 };
const TOTAL_W = LAYOUT.railW * 2 + LAYOUT.centerW + LAYOUT.gap * 2;                 // 1452
const TOTAL_H = LAYOUT.barH + LAYOUT.pad + LAYOUT.rowH + LAYOUT.pad + LAYOUT.navH;  // 772
const RAIL_X = LAYOUT.centerW / 2 + LAYOUT.gap + LAYOUT.railW / 2;                  // 576
const BEZEL = 34;                 // device frame width around the screen
const FOV = 35;

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
  const glRig = new THREE.Group();   // device (bezel, edge glow)
  const cssRig = new THREE.Group();  // flat UI screen
  glScene.add(glRig);
  cssScene.add(cssRig);

  // Lights: soft key from the top-left, accent rim from below
  glScene.add(new THREE.HemisphereLight(0xdfe7ff, 0x0b0c10, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-400, 700, 900);
  glScene.add(key);

  // Device body: a flat rounded slab behind the screen, with a bevelled front edge
  const devW = TOTAL_W + BEZEL * 2, devH = TOTAL_H + BEZEL * 2;
  const devGeo = new THREE.ExtrudeGeometry(roundRect(devW, devH, 40), {
    depth: 14, bevelEnabled: true, bevelThickness: 6, bevelSize: 6, bevelSegments: 4, curveSegments: 18,
  });
  const device = new THREE.Mesh(devGeo, new THREE.MeshStandardMaterial({ color: 0x0f1115, metalness: 0.55, roughness: 0.4 }));
  device.position.z = -40;
  glRig.add(device);
  const edgeMat = new THREE.LineBasicMaterial({ color: state.settings.accent, transparent: true, opacity: 0.55 });
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(devGeo, 30), edgeMat);
  edge.position.copy(device.position);
  glRig.add(edge);

  // Flat screen: a dark glass plate just behind the panels
  const screen = new THREE.Mesh(
    new THREE.ShapeGeometry(roundRect(TOTAL_W + 8, TOTAL_H + 8, 24), 8),
    new THREE.MeshBasicMaterial({ color: 0x050608 }),
  );
  screen.position.z = -20;
  glRig.add(screen);

  // Flat panels: every panel is on the same plane (z = 0), no tilt
  const place = (el, w, h, x, y) => {
    el.classList.add('cs-panel');
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    const o = new CSS3DObject(el);
    o.position.set(x, y, 0);
    cssRig.add(o);
    return o;
  };
  const barY = TOTAL_H / 2 - LAYOUT.barH / 2;
  const rowY = barY - LAYOUT.barH / 2 - LAYOUT.pad - LAYOUT.rowH / 2;
  const navY = rowY - LAYOUT.rowH / 2 - LAYOUT.pad - LAYOUT.navH / 2;
  place(parts.statusbar, TOTAL_W, LAYOUT.barH, 0, barY);
  place(parts.leftRail, LAYOUT.railW, LAYOUT.rowH, -RAIL_X, rowY);
  place(parts.windowEl, LAYOUT.centerW, LAYOUT.rowH, 0, rowY);
  place(parts.rightRail, LAYOUT.railW, LAYOUT.rowH, RAIL_X, rowY);
  place(parts.navbar, TOTAL_W, LAYOUT.navH, 0, navY);

  // Fit the tablet to the viewport (1 CSS px = 1 screen px at the design distance)
  let dist = 1000;
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    renderer.setSize(vw, vh);
    css.setSize(vw, vh);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    const s = Math.min(vw / (devW + 60), vh / (devH + 60));
    dist = (vh / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / s;
  }
  window.addEventListener('resize', fit);
  fit();

  // The device leans a few degrees toward the pointer/touch. The UI stays flat.
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
    ptr.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  function frame() {
    ptr.sx += (ptr.x - ptr.sx) * 0.05;
    ptr.sy += (ptr.y - ptr.sy) * 0.05;
    const ry = ptr.sx * 0.07, rx = ptr.sy * 0.04;
    glRig.rotation.set(rx, ry, 0);
    cssRig.rotation.set(rx, ry, 0);
    edgeMat.color.set(state.settings.accent);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    renderer.render(glScene, camera);
    css.render(cssScene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Kept for the shell's API. The UI no longer moves in depth, so this does nothing.
  return { setWindowDepth() {} };
}

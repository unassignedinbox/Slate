// three.js viewport: terrain mesh, current-following water, particle sprites,
// spline/box helpers, sky+sun, custom SolidArc-style orbit rig. No graph knowledge.
import * as THREE from 'three';

const SKY_TOP = new THREE.Color(0x2e4a6b), SKY_HOR = new THREE.Color(0x9db8cc);
const SUN_COLOR = new THREE.Color(0xfff1d6);

export class Viewport {
  constructor(container) {
    this.el = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9db8cc, 380, 1100);
    this.cameraP = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
    this.cameraO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 4000);
    this.ortho = false;
    this.camera = this.cameraP;

    // — lights —
    this.sun = new THREE.DirectionalLight(SUN_COLOR, 2.6);
    this.sun.position.set(120, 160, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbcd3e8, 0x4a4238, 0.85));

    // — sky dome —
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1800, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: SKY_TOP }, hor: { value: SKY_HOR }, sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.28).normalize() } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir; uniform vec3 top,hor,sunDir;
          void main(){ float h = clamp(vDir.y,0.0,1.0);
            vec3 c = mix(hor, top, pow(h,0.62));
            float s = pow(max(dot(normalize(vDir),sunDir),0.0),600.0);
            c += vec3(1.0,0.9,0.75)*s*1.4 + vec3(1.0,0.85,0.6)*pow(max(dot(normalize(vDir),sunDir),0.0),8.0)*0.12;
            gl_FragColor = vec4(c,1.0); }`,
      })
    ));

    // — terrain —
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.terrainMat);
    this.terrain.castShadow = true; this.terrain.receiveShadow = true;
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);

    // — water —
    this.waterGroup = new THREE.Group();
    this.scene.add(this.waterGroup);
    this.waterUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.62, 0.28).normalize() },
      uDeep: { value: new THREE.Color(0x0b3b4a) },
      uShallow: { value: new THREE.Color(0x3f9aa5) },
      uSky: { value: new THREE.Color(0x9fc3d8) },
      uSunCol: { value: new THREE.Color(0xfff1d6) },
    };

    // — particles (round soft sprites, small by default) —
    this.MAXP = 14000;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.MAXP * 3);
    this.pCol = new Float32Array(this.MAXP * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uSize: { value: 3.0 }, uOpacity: { value: 0.95 }, uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: `attribute vec3 color; varying vec3 vC; uniform float uSize,uPR;
        void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = uSize*uPR; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; uniform float uOpacity;
        void main(){ vec2 q = gl_PointCoord-0.5; float d = length(q)*2.0;
          if(d>1.0) discard; float a = smoothstep(1.0,0.35,d)*uOpacity;
          gl_FragColor = vec4(vC,a); }`,
    });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // — helpers —
    this.helperGroup = new THREE.Group();
    this.scene.add(this.helperGroup);
    const grid = new THREE.GridHelper(192, 24, 0x2a3442, 0x1a222c);
    grid.position.y = -0.05;
    this.helperGroup.add(grid);
    const bounds = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-96, 0, -96), new THREE.Vector3(96, 72, 192 - 96)), 0x2e3744);
    this.helperGroup.add(bounds);
    this.dynHelpers = new THREE.Group();
    this.helperGroup.add(this.dynHelpers);

    // — orbit rig —
    this.orbit = { tx: 0, ty: 14, tz: 0, az: 0.7, el: 0.62, dist: 230 };
    this.goal = { ...this.orbit };
    this.enabled = true;
    this._bindOrbit();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this.raycaster = new THREE.Raycaster();
    this.time = 0;
  }

  get canvas() { return this.renderer.domElement; }
  setTerrain(mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.terrain.geometry.dispose();
    this.terrain.geometry = g;
  }
  updateTerrainColors(mesh) {
    const attr = this.terrain.geometry.getAttribute('color');
    if (attr && attr.array.length === mesh.colors.length) {
      attr.array.set(mesh.colors);
      attr.needsUpdate = true;
    }
  }
  setWireframe(on) { this.terrainMat.wireframe = on; }

  // ── water ──
  waterMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: this.waterUniforms,
      vertexShader: `
        attribute float aDepth; attribute vec2 aFlow; attribute float aFoam;
        varying vec3 vW; varying float vD; varying vec2 vF; varying float vFo;
        uniform float uTime;
        void main(){
          vec3 p = position;
          float bob = sin(uTime*1.4 + position.x*0.35 + position.z*0.27)*0.05
                    + sin(uTime*2.3 - position.x*0.21 + position.z*0.43)*0.03;
          p.y += bob * (0.4 + 0.6*smoothstep(0.0,1.5,aDepth));
          vW = (modelMatrix*vec4(p,1.0)).xyz; vD = aDepth; vF = aFlow; vFo = aFoam;
          gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.0);
        }`,
      fragmentShader: `
        varying vec3 vW; varying float vD; varying vec2 vF; varying float vFo;
        uniform float uTime; uniform vec3 uSunDir,uDeep,uShallow,uSky,uSunCol;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
        float wnoise(vec2 p){ return vnoise(p)*0.65+vnoise(p*2.13+5.7)*0.35; }
        void main(){
          if (vD < 0.0) discard;
          vec2 wuv = vW.xz*0.55;
          vec2 flow = vF*0.14;                       // current-advected —
          float n1 = wnoise(wuv - flow*uTime);
          float n2 = wnoise(wuv*2.3 + flow*uTime*0.55 + vec2(uTime*0.05,0.0));
          float e = 0.06;
          float nx = (wnoise(wuv+vec2(e,0.0)-flow*uTime)-n1)/e;
          float nz = (wnoise(wuv+vec2(0.0,e)-flow*uTime)-n1)/e;
          float amp = 0.22 + min(length(vF)*0.05,0.5);
          vec3 N = normalize(vec3(-nx*amp, 1.0, -nz*amp));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0-max(dot(V,N),0.0), 3.0);
          float absorb = 1.0-exp(-vD*0.55);
          vec3 base = mix(uShallow, uDeep, absorb);
          base = mix(base, uSky, fres*0.55);
          vec3 R = reflect(-uSunDir, N);
          float spec = pow(max(dot(R,V),0.0),240.0)*1.6 + pow(max(dot(R,V),0.0),24.0)*0.25;
          // foam: shoreline + rapids, stretched along the current
          vec2 fdir = length(vF)>1e-3 ? normalize(vF) : vec2(1.0,0.0);
          vec2 fuv = vec2(dot(vW.xz,fdir)*0.6 - uTime*length(vF)*0.5, dot(vW.xz,vec2(-fdir.y,fdir.x))*1.6);
          float fn = wnoise(fuv*0.8);
          float shore = smoothstep(0.9,0.05,vD);
          float rapids = clamp(vFo*(0.55+0.45*fn),0.0,1.0);
          float foam = clamp(shore*(0.45+0.55*fn)+rapids, 0.0, 1.0);
          foam = smoothstep(0.35,0.75,foam);
          vec3 c = base + uSunCol*spec + vec3(0.92,0.95,0.96)*foam*0.85;
          float a = mix(0.78, 0.96, max(absorb,fres));
          a = mix(a, 1.0, foam);
          a *= smoothstep(0.0,0.12,vD);
          gl_FragColor = vec4(c,a);
        }`,
    });
  }
  clearWater() {
    while (this.waterGroup.children.length) {
      const m = this.waterGroup.children.pop();
      m.geometry?.dispose?.(); m.material?.dispose?.();
    }
  }
  addLakeMesh(cx, level, cz, rx, rz, driftDir, driftSpeed, vol) {
    const SEG = 56, RINGS = 10;
    const posA = [], depA = [], floA = [], foA = [], idxA = [];
    for (let r = 0; r <= RINGS; r++) {
      for (let s = 0; s <= SEG; s++) {
        const a = (s / SEG) * Math.PI * 2, rr = r / RINGS;
        const x = cx + Math.cos(a) * rx * rr, z = cz + Math.sin(a) * rz * rr;
        posA.push(x, level, z);
        const bed = vol.topSurfaceY(x, z);
        depA.push(bed < 0 ? 3 : level - bed);
        // flow: drift + recorded runoff flux direction
        let fx = driftDir[0] * driftSpeed, fz = driftDir[1] * driftSpeed;
        const g = [0, 0, 0]; vol.worldToGrid(x, Math.max(bed, 0.5), z, g);
        const ix = Math.round(g[0]), iy = Math.round(g[1]), iz = Math.round(g[2]);
        if (vol.inGrid(ix, iy, iz)) {
          const id = vol.idx(ix, iy, iz);
          if (vol.flux[id] > 1e-7) { fx += vol.flowX[id] / vol.flux[id] * 0.4; fz += vol.flowZ[id] / vol.flux[id] * 0.4; }
        }
        floA.push(fx, fz); foA.push(0);
      }
    }
    for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
      const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, d = c + 1;
      idxA.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depA, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(floA, 2));
    g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foA, 1));
    g.setIndex(idxA);
    const mesh = new THREE.Mesh(g, this.waterMaterial());
    mesh.renderOrder = 10; mesh.frustumCulled = false;
    this.waterGroup.add(mesh);
  }
  addRiverMesh(pathPts, width, speed, vol) {
    // pathPts: resampled [{x,z,tx,tz}] — ribbon draped over the carved bed
    if (!pathPts || pathPts.length < 2) return;
    const posA = [], depA = [], floA = [], foA = [], idxA = [];
    const N = 5; // verts across
    let row = 0, prevBed = null;
    for (let i = 0; i < pathPts.length; i++) {
      const s = pathPts[i];
      const nx = -s.tz, nz = s.tx;
      const bedC = vol.topSurfaceY(s.x, s.z);
      if (bedC < 0) { prevBed = null; continue; }
      const y = bedC + 0.42;
      const drop = prevBed === null ? 0 : Math.max(0, prevBed - bedC);
      prevBed = bedC;
      const rapids = Math.min(drop * 0.9, 1) * Math.min(speed / 4, 1.6);
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1) - 0.5;
        const x = s.x + nx * t * width, z = s.z + nz * t * width;
        const bed = vol.topSurfaceY(x, z);
        const depth = bed < 0 ? 1.2 : Math.max(0.12, y - bed);
        // crown the surface slightly at the banks so it reads as a channel
        posA.push(x, y + Math.abs(t) * 0.12, z);
        depA.push(depth);
        floA.push(s.tx * speed, s.tz * speed);
        foA.push(rapids * (1 - Math.abs(t) * 0.7));
      }
      if (row > 0) {
        const a0 = (row - 1) * N, b0 = row * N;
        for (let k = 0; k < N - 1; k++) idxA.push(a0 + k, b0 + k, a0 + k + 1, a0 + k + 1, b0 + k, b0 + k + 1);
      }
      row++;
    }
    if (row < 2) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depA, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(floA, 2));
    g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foA, 1));
    g.setIndex(idxA);
    const mesh = new THREE.Mesh(g, this.waterMaterial());
    mesh.renderOrder = 11; mesh.frustumCulled = false;
    this.waterGroup.add(mesh);
  }

  // ── helpers (river paths, emitter boxes, lake rings) ──
  setDynHelpers(build) {
    while (this.dynHelpers.children.length) {
      const o = this.dynHelpers.children.pop();
      o.geometry?.dispose?.(); o.material?.dispose?.();
    }
    build?.(this.dynHelpers, THREE);
  }

  // ── particles ──
  setParticleCount(n) {
    this.pGeo.setDrawRange(0, n);
    this.pGeo.getAttribute('position').needsUpdate = true;
    this.pGeo.getAttribute('color').needsUpdate = true;
  }

  // ── picking ──
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    return hit ? hit.point : null;
  }

  // ── orbit ──
  _bindOrbit() {
    const cv = this.renderer.domElement;
    let drag = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      if (!this.enabled) return;
      cv.setPointerCapture?.(e.pointerId);
      drag = { b: e.button, shift: e.shiftKey, x: e.clientX, y: e.clientY, g: { ...this.goal } };
    });
    window.addEventListener('pointermove', e => {
      if (!drag || !this.enabled) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.b === 2 || drag.shift || drag.b === 1) {
        // grab-style pan: content follows the cursor
        const s = this.goal.dist / 800;
        const az = this.goal.az;
        const rx = Math.sin(az), rz = -Math.cos(az); // camera-right on XZ
        this.goal.tx = drag.g.tx - rx * dx * s;
        this.goal.tz = drag.g.tz - rz * dx * s;
        this.goal.ty = drag.g.ty + dy * s;
      } else if (drag.b === 0) {
        this.goal.az = drag.g.az - dx * 0.0052;
        this.goal.el = Math.min(1.5, Math.max(0.03, drag.g.el + dy * 0.0042));
      }
    });
    window.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      this.goal.dist = Math.min(900, Math.max(12, this.goal.dist * Math.exp(e.deltaY * 0.0011)));
    }, { passive: false });
  }
  frameHome() {
    this.goal = { tx: 0, ty: 13, tz: 0, az: 0.7, el: 0.62, dist: 235 };
  }
  setTop() { this.goal.el = 1.5; this.goal.az = 0.0; }
  setFront() { this.goal.el = 0.18; this.goal.az = Math.PI; }
  setOrtho(on) {
    this.ortho = on;
    this.camera = on ? this.cameraO : this.cameraP;
    this._resize();
  }

  _resize() {
    const w = this.el.clientWidth || 2, h = this.el.clientHeight || 2;
    this.renderer.setSize(w, h, false);
    this.cameraP.aspect = w / h;
    this.cameraP.updateProjectionMatrix();
    const s = this.goal.dist * 0.75;
    this.cameraO.left = -s * (w / h); this.cameraO.right = s * (w / h);
    this.cameraO.top = s; this.cameraO.bottom = -s;
    this.cameraO.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    this.waterUniforms.uTime.value = this.time;
    // critically-damped-ish orbit smoothing
    const k = 1 - Math.exp(-10 * dt);
    for (const key of ['tx', 'ty', 'tz', 'az', 'el', 'dist']) {
      this.orbit[key] += (this.goal[key] - this.orbit[key]) * k;
    }
    const o = this.orbit;
    const cx = o.tx + o.dist * Math.cos(o.el) * Math.cos(o.az);
    const cy = o.ty + o.dist * Math.sin(o.el);
    const cz = o.tz + o.dist * Math.cos(o.el) * Math.sin(o.az);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(o.tx, o.ty, o.tz);
    if (this.ortho) {
      const w = this.el.clientWidth || 2, h = this.el.clientHeight || 2;
      const s = o.dist * 0.75;
      this.cameraO.left = -s * (w / h); this.cameraO.right = s * (w / h);
      this.cameraO.top = s; this.cameraO.bottom = -s;
      this.cameraO.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  diagnostics() {
    const gl = this.renderer.getContext();
    const ext = ['EXT_color_buffer_float', 'OES_texture_float_linear', 'WEBGL_debug_renderer_info']
      .map(n => `${n}: ${gl.getExtension(n) ? 'yes' : 'no'}`).join('\n');
    return `renderer: ${this.renderer.info.render.calls} calls, ${this.renderer.info.render.triangles} tris\n` +
      `programs: ${this.renderer.info.programs.length}, geometries: ${this.renderer.info.memory.geometries}, textures: ${this.renderer.info.memory.textures}\n` +
      `webgl: ${gl.getParameter(gl.VERSION)}\n${ext}`;
  }
}

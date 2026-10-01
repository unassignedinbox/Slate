//============================================================================================================================================
//                                                      RIMWORKSPACE.JS
//============================================================================================================================================
// 🧩 Viewer + parameter panel for the browser rim generator. Geometry comes from RimSpecification.js (the port of the
//    engine module); this file only owns presentation: IBL studio lighting, one MeshPhysicalMaterial per RimSurfaceSlot
//    with live finish / colour / metalness / roughness / clearcoat / anisotropy control, the topology report, and OBJ
//    and glTF export.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import GUI from 'lil-gui';
import {
    defaultParameters, normalise, synthesise, audit, toBuffers, toWavefront, resolveSection,
    Finishes, Presets, PresetSchemes, PaintSchemes, RimSlot, RimSlotName, SpokeContour, LugSeat, LugNut,
} from './RimSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        STAGE
//------------------------------------------------------------------------------------------------------------------------

const viewport = document.getElementById('viewport');
const reportPanel = document.getElementById('report');
const busyPanel = document.getElementById('busy');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0c0d10');

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.02, 60);
camera.position.set(0.62, 0.34, 0.78);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.28;
controls.maxDistance = 4.0;
controls.target.set(0, 0, 0);

// Image-based lighting: a neutral room gives metals something to reflect, which is most of what sells a rim.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const key = new THREE.DirectionalLight(0xfff2e6, 2.6);
key.position.set(1.1, 1.8, 1.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.4; key.shadow.camera.far = 6;
key.shadow.camera.left = -0.8; key.shadow.camera.right = 0.8;
key.shadow.camera.top = 0.8; key.shadow.camera.bottom = -0.8;
key.shadow.bias = -0.0008;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
rim.position.set(-1.5, 0.5, -1.2);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.42 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const wheel = new THREE.Group();
scene.add(wheel);

//------------------------------------------------------------------------------------------------------------------------
//                                                      MATERIALS
//------------------------------------------------------------------------------------------------------------------------

const appearance = [];     // one record per RimSurfaceSlot
const materials = [];

function makeAppearance(finishKey) {
    const recipe = Finishes[finishKey];
    return {
        finish: finishKey, color: recipe.color, metalness: recipe.metalness, roughness: recipe.roughness,
        clearcoat: recipe.clearcoat, clearcoatRoughness: recipe.clearcoatRoughness, anisotropy: recipe.anisotropy,
    };
}
function applyFinish(slot, finishKey) {
    const recipe = Finishes[finishKey];
    Object.assign(appearance[slot], {
        finish: finishKey, color: recipe.color, metalness: recipe.metalness, roughness: recipe.roughness,
        clearcoat: recipe.clearcoat, clearcoatRoughness: recipe.clearcoatRoughness, anisotropy: recipe.anisotropy,
    });
}
const defaultScheme = PaintSchemes['Machined face + gloss pockets'];
for (let slot = 0; slot < RimSlot.Count; ++slot) {
    appearance.push(makeAppearance(defaultScheme[slot]));
    const material = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide, envMapIntensity: 1.15 });
    materials.push(material);
}
function syncMaterials() {
    for (let slot = 0; slot < RimSlot.Count; ++slot) {
        const a = appearance[slot], m = materials[slot];
        m.color.set(a.color);
        m.metalness = a.metalness;
        m.roughness = a.roughness;
        m.clearcoat = a.clearcoat;
        m.clearcoatRoughness = a.clearcoatRoughness;
        m.anisotropy = a.anisotropy;
        m.anisotropyRotation = Math.PI / 2;     // lathe / brush direction follows the face sweep
        m.needsUpdate = true;
    }
}
syncMaterials();

//------------------------------------------------------------------------------------------------------------------------
//                                                     PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

const parameters = defaultParameters();
const options = {
    preset: 'Forged 5-spoke 20×9.5',
    scheme: 'Machined face + gloss pockets',
    liveUpdate: true,
    autoSpin: false,
    wireframe: false,
    showSection: false,
    rebuild: () => rebuild(true),
    exportObj: () => downloadText('WheelRim.obj', toWavefront(currentSurface)),
    exportGltf: () => exportGltf(),
};

let currentSurface = null;
let currentMesh = null;
let sectionOverlay = null;
let pending = null;

function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    URL.revokeObjectURL(url);
}
function exportGltf() {
    new GLTFExporter().parse(wheel, (result) => {
        downloadText('WheelRim.gltf', JSON.stringify(result, null, 1));
    }, (error) => console.error(error), { onlyVisible: true });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SECTION OVERLAY
//------------------------------------------------------------------------------------------------------------------------
// Draws the resolved blank-rim cross-section as a line in the +X half-plane, so the curve driving the barrel is
//    visible while it is being edited.

function buildSectionOverlay() {
    if (sectionOverlay) { wheel.remove(sectionOverlay); sectionOverlay.geometry.dispose(); sectionOverlay = null; }
    if (!options.showSection) return;
    const knots = resolveSection(parameters);
    const points = knots.map((k) => new THREE.Vector3(k.r, 0, k.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    sectionOverlay = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x6fa8ff }));
    sectionOverlay.renderOrder = 10;
    wheel.add(sectionOverlay);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       REBUILD
//------------------------------------------------------------------------------------------------------------------------

function rebuild(force = false) {
    if (!force && !options.liveUpdate) return;
    if (pending) return;
    busyPanel.style.display = 'grid';
    pending = requestAnimationFrame(() => requestAnimationFrame(() => {
        pending = null;
        const started = performance.now();
        normalise(parameters);
        const surface = synthesise(parameters);
        const buffers = toBuffers(surface);
        const elapsed = performance.now() - started;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uv, 2));
        for (const group of buffers.groups) geometry.addGroup(group.start, group.count, group.slot);
        geometry.computeBoundingSphere();

        if (currentMesh) { wheel.remove(currentMesh); currentMesh.geometry.dispose(); }
        currentMesh = new THREE.Mesh(geometry, materials);
        currentMesh.castShadow = true;
        currentMesh.receiveShadow = true;
        // Rim space is spin-axis +Z and three.js is Y-up, so the wheel already stands upright facing +Z; it only
        //    has to be lifted until the tread circle touches the ground plane.
        wheel.add(currentMesh);
        const tread = 0.5 * parameters.DiameterInch * 0.0254 + parameters.FlangeHeightMillimetre * 0.001;
        wheel.position.y = tread;
        controls.target.set(0, tread, 0);

        currentSurface = surface;
        buildSectionOverlay();

        const body = audit(surface, surface.parts[0].firstTriangle, surface.parts[0].triangleCount);
        const whole = audit(surface);
        reportPanel.innerHTML = `
            <div class="row"><span>triangles</span><b>${whole.triangleCount.toLocaleString()}</b></div>
            <div class="row"><span>vertices</span><b>${whole.vertexCount.toLocaleString()}</b></div>
            <div class="row"><span>parts</span><b>${surface.parts.length} &nbsp;(body + ${surface.parts.length - 1} hardware)</b></div>
            <div class="row"><span>body shells</span><b class="${body.shellCount === 1 ? 'ok' : 'bad'}">${body.shellCount}</b></div>
            <div class="row"><span>boundary / non-manifold / flipped</span>
                <b class="${body.watertight ? 'ok' : 'bad'}">${body.boundaryEdges} / ${body.nonManifoldEdges} / ${body.flippedEdges}</b></div>
            <div class="row"><span>enclosed volume</span><b>${(body.signedVolume * 1000).toFixed(2)} L &nbsp;≈ ${(body.signedVolume * 2700).toFixed(1)} kg Al</b></div>
            <div class="row"><span>synthesis</span><b>${elapsed.toFixed(0)} ms</b></div>`;
        busyPanel.style.display = 'none';
    }));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       PANEL
//------------------------------------------------------------------------------------------------------------------------

const gui = new GUI({ title: 'Rim parameters' });
const touch = () => rebuild();

gui.add(options, 'preset', Object.keys(Presets)).name('preset').onChange((name) => {
    Object.assign(parameters, defaultParameters());
    Presets[name](parameters);
    normalise(parameters);
    const schemeName = PresetSchemes[name];
    if (schemeName && PaintSchemes[schemeName]) {
        options.scheme = schemeName;
        const scheme = PaintSchemes[schemeName];
        for (let slot = 0; slot < RimSlot.Count; ++slot) applyFinish(slot, scheme[slot]);
        syncMaterials();
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    rebuild(true);
});
gui.add(options, 'scheme', Object.keys(PaintSchemes)).name('paint scheme').onChange((name) => {
    const scheme = PaintSchemes[name];
    for (let slot = 0; slot < RimSlot.Count; ++slot) applyFinish(slot, scheme[slot]);
    syncMaterials();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
});

const sizeFolder = gui.addFolder('Size & barrel');
sizeFolder.add(parameters, 'DiameterInch', 13, 26, 0.5).name('diameter [in]').onChange(touch);
sizeFolder.add(parameters, 'WidthInch', 5, 14, 0.25).name('width [in]').onChange(touch);
sizeFolder.add(parameters, 'OffsetMillimetre', -40, 80, 1).name('offset ET [mm]').onChange(touch);
sizeFolder.add(parameters, 'FlangeHeightMillimetre', 10, 26, 0.1).name('flange height [mm]').onChange(touch);
sizeFolder.add(parameters, 'FlangeThicknessMillimetre', 3, 12, 0.1).name('flange thickness [mm]').onChange(touch);
sizeFolder.add(parameters, 'BarrelWallMillimetre', 3, 14, 0.1).name('barrel wall [mm]').onChange(touch);
sizeFolder.add(parameters, 'WellDepthMillimetre', 8, 45, 0.5).name('well depth [mm]').onChange(touch);
sizeFolder.add(parameters, 'WellOffsetFraction', 0.15, 0.85, 0.01).name('well position').onChange(touch);
sizeFolder.add(parameters, 'WellWidthFraction', 0.1, 0.55, 0.01).name('well width').onChange(touch);
sizeFolder.add(parameters, 'BeadSeatTaperDegrees', 0, 10, 0.5).name('bead taper [°]').onChange(touch);
sizeFolder.add(parameters, 'SectionSmoothing', 0, 1, 0.01).name('section smoothing').onChange(touch);
sizeFolder.add(options, 'showSection').name('show section curve').onChange(() => buildSectionOverlay());

const spokeFolder = gui.addFolder('Spokes');
spokeFolder.add(parameters, 'SpokeContour', Object.values(SpokeContour)).name('family').onChange(touch);
spokeFolder.add(parameters, 'SpokeCount', 2, 24, 1).name('count').onChange(touch);
spokeFolder.add(parameters, 'SpokeRootWidthMillimetre', 10, 140, 1).name('root width [mm]').onChange(touch);
spokeFolder.add(parameters, 'SpokeTipWidthMillimetre', 8, 160, 1).name('tip width [mm]').onChange(touch);
spokeFolder.add(parameters, 'SpokeTaperPower', 0.4, 3.5, 0.05).name('taper power').onChange(touch);
spokeFolder.add(parameters, 'SpokeSweepDegrees', -45, 45, 0.5).name('sweep [°]').onChange(touch);
spokeFolder.add(parameters, 'SpokeTwistDegrees', -30, 30, 0.5).name('twist [°]').onChange(touch);
spokeFolder.add(parameters, 'SpokeSplitDegrees', 0, 20, 0.5).name('split angle [°]').onChange(touch);
spokeFolder.add(parameters, 'SpokePhaseDegrees', 0, 72, 1).name('phase [°]').onChange(touch);
spokeFolder.add(parameters, 'RingRadiusFraction', 0.15, 0.92, 0.01).name('ring radius (lattice/honeycomb)').onChange(touch);
spokeFolder.add(parameters, 'RingWidthMillimetre', 3, 60, 0.5).name('ring width [mm]').onChange(touch);

const faceFolder = gui.addFolder('Face plate');
faceFolder.add(parameters, 'HubRadiusFraction', 0.14, 0.6, 0.005).name('hub radius').onChange(touch);
faceFolder.add(parameters, 'OuterBandFraction', 0.015, 0.2, 0.005).name('outer band').onChange(touch);
faceFolder.add(parameters, 'DishMillimetre', -10, 90, 0.5).name('dish [mm]').onChange(touch);
faceFolder.add(parameters, 'ConcavityPower', 0.5, 4, 0.05).name('concavity').onChange(touch);
faceFolder.add(parameters, 'PadThicknessMillimetre', 8, 40, 0.5).name('hub pad [mm]').onChange(touch);
faceFolder.add(parameters, 'SpokeThicknessMillimetre', 5, 34, 0.5).name('spoke thickness [mm]').onChange(touch);
faceFolder.add(parameters, 'LipThicknessMillimetre', 4, 24, 0.5).name('lip thickness [mm]').onChange(touch);
faceFolder.add(parameters, 'CrownMillimetre', 0, 12, 0.1).name('crown [mm]').onChange(touch);
faceFolder.add(parameters, 'BackReliefMillimetre', 0, 14, 0.1).name('back relief [mm]').onChange(touch);
faceFolder.add(parameters, 'FilletMillimetre', 1, 28, 0.5).name('junction fillet [mm]').onChange(touch);
faceFolder.add(parameters, 'BevelMillimetre', 0, 8, 0.1).name('edge bevel [mm]').onChange(touch);
faceFolder.add(parameters, 'BevelBands', 1, 8, 1).name('bevel bands').onChange(touch);

const hubFolder = gui.addFolder('Hub, lugs & hardware');
hubFolder.add(parameters, 'CentreBoreMillimetre', 50, 130, 0.1).name('centre bore [mm]').onChange(touch);
hubFolder.add(parameters, 'LugCount', 0, 10, 1).name('lug count').onChange(touch);
hubFolder.add(parameters, 'LugCircleMillimetre', 90, 180, 0.1).name('PCD [mm]').onChange(touch);
hubFolder.add(parameters, 'LugHoleMillimetre', 8, 24, 0.1).name('lug hole [mm]').onChange(touch);
hubFolder.add(parameters, 'LugSeat', Object.values(LugSeat)).name('seat').onChange(touch);
hubFolder.add(parameters, 'LugSeatDepthMillimetre', 0, 14, 0.1).name('seat depth [mm]').onChange(touch);
hubFolder.add(parameters, 'LugPhaseDegrees', 0, 72, 1).name('bolt-circle phase [°]').onChange(touch);
hubFolder.add(parameters, 'GenerateLugNuts').name('lug nuts').onChange(touch);
hubFolder.add(parameters, 'LugNut', Object.values(LugNut)).name('nut style').onChange(touch);
hubFolder.add(parameters, 'LugNutFlatsMillimetre', 12, 34, 0.5).name('nut across flats [mm]').onChange(touch);
hubFolder.add(parameters, 'LugNutHeightMillimetre', 10, 46, 0.5).name('nut height [mm]').onChange(touch);
hubFolder.add(parameters, 'CentreLock').name('centre lock (GT3)').onChange(touch);
hubFolder.add(parameters, 'CentreLockFlatsMillimetre', 20, 110, 1).name('centre-lock flats [mm]').onChange(touch);
hubFolder.add(parameters, 'GenerateLipBolts').name('beadlock lip bolts').onChange(touch);
hubFolder.add(parameters, 'LipBoltCount', 0, 48, 1).name('lip bolt count').onChange(touch);
hubFolder.add(parameters, 'LipBoltDiameterMillimetre', 3, 20, 0.5).name('lip bolt Ø [mm]').onChange(touch);
hubFolder.add(parameters, 'LipBoltProudMillimetre', 0.5, 10, 0.1).name('lip bolt proud [mm]').onChange(touch);
hubFolder.add(parameters, 'GenerateCentreCap').name('centre cap').onChange(touch);
hubFolder.add(parameters, 'CentreCapRadiusFraction', 0.2, 1.0, 0.01).name('cap radius').onChange(touch);
hubFolder.add(parameters, 'CentreCapDomeMillimetre', 0, 20, 0.5).name('cap dome [mm]').onChange(touch);
hubFolder.add(parameters, 'ValveHole').name('valve hole').onChange(touch);
hubFolder.add(parameters, 'ValveRadiusFraction', 0.2, 0.95, 0.01).name('valve radius').onChange(touch);

const materialFolder = gui.addFolder('Materials & colour');
for (let slot = 0; slot < RimSlot.Count; ++slot) {
    const folder = materialFolder.addFolder(RimSlotName[slot]);
    const record = appearance[slot];
    folder.add(record, 'finish', Object.keys(Finishes)).name('finish').onChange((finishKey) => {
        applyFinish(slot, finishKey); syncMaterials();
        folder.controllersRecursive().forEach((c) => c.updateDisplay());
    });
    folder.addColor(record, 'color').name('colour').onChange(syncMaterials);
    folder.add(record, 'metalness', 0, 1, 0.01).onChange(syncMaterials);
    folder.add(record, 'roughness', 0.01, 1, 0.01).onChange(syncMaterials);
    folder.add(record, 'clearcoat', 0, 1, 0.01).name('clear coat').onChange(syncMaterials);
    folder.add(record, 'clearcoatRoughness', 0, 0.6, 0.005).name('coat roughness').onChange(syncMaterials);
    folder.add(record, 'anisotropy', 0, 1, 0.01).name('anisotropy').onChange(syncMaterials);
    if (slot > 0) folder.close();
}

const qualityFolder = gui.addFolder('Quality & output');
qualityFolder.add(parameters, 'AngularSegments', 128, 1024, 32).name('angular segments').onChange(touch);
qualityFolder.add(parameters, 'RadialSegments', 32, 200, 4).name('radial segments').onChange(touch);
qualityFolder.add(parameters, 'CreaseDegrees', 10, 90, 1).name('crease [°]').onChange(touch);
qualityFolder.add(options, 'liveUpdate').name('live update');
qualityFolder.add(options, 'rebuild').name('rebuild now');
qualityFolder.add(options, 'autoSpin').name('auto spin');
qualityFolder.add(options, 'wireframe').name('wireframe').onChange((on) => materials.forEach((m) => { m.wireframe = on; }));
qualityFolder.add(renderer, 'toneMappingExposure', 0.3, 2.2, 0.01).name('exposure');
qualityFolder.add(options, 'exportObj').name('export OBJ');
qualityFolder.add(options, 'exportGltf').name('export glTF');
qualityFolder.close();

//------------------------------------------------------------------------------------------------------------------------
//                                                       LOOP
//------------------------------------------------------------------------------------------------------------------------

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
    if (options.autoSpin && currentMesh) wheel.rotation.y += 0.0035;
    controls.update();
    renderer.render(scene, camera);
});

rebuild(true);

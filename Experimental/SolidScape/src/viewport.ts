//============================================================================================================================================
// SolidScape — Viewport: sun/sky atmosphere, ground reference plane, dual camera control schemes
//============================================================================================================================================

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type CameraScheme = 'fly' | 'orbit';

export interface SkySpecification
{
    elevation:    number;     // solar altitude above horizon        [deg]
    azimuth:      number;     // solar bearing, 0 = north            [deg]
    turbidity:    number;     // atmospheric haze                    [-]
    rayleigh:     number;     // molecular scattering strength       [-]
    mieCoeff:     number;     // aerosol scattering coefficient      [-]
    mieDirection: number;     // aerosol forward scattering anisotropy [-]
    exposure:     number;     // tone-map exposure                   [-]
    sunIntensity: number;     // directional irradiance              [-]
    fogDensity:   number;     // exponential-squared fog density     [1/m]
    groundTone:   string;     // reference plane albedo              [hex]
    showGrid:     boolean;
    showGizmo:    boolean;
}

export const DefaultSky: SkySpecification =
{
    elevation:    32,
    azimuth:      165,
    turbidity:    6.2,
    rayleigh:     2.4,
    mieCoeff:     0.005,
    mieDirection: 0.8,
    exposure:     0.42,
    sunIntensity: 3.0,
    fogDensity:   0.0035,
    groundTone:   '#2c2c2c',
    showGrid:     true,
    showGizmo:    true,
};

interface MotionRecord
{
    forward: boolean; back: boolean; left: boolean; right: boolean;
    up: boolean; down: boolean; fast: boolean; slow: boolean;
}

//--------------------------------------------------------------------------------------------------------------------------
// Viewport presentation
//--------------------------------------------------------------------------------------------------------------------------
export class ViewportPresentation
{
    readonly renderer:  THREE.WebGLRenderer;
    readonly scene:     THREE.Scene;
    readonly camera:    THREE.PerspectiveCamera;

    sky:        SkySpecification = { ...DefaultSky };
    scheme:     CameraScheme = 'fly';
    flySpeed    = 6.0;                                   // [m/s]
    orbitTarget = new THREE.Vector3(0, 0, 0);
    primaryFree = true;                                  // false while a sculpt tool owns LMB

    onTelemetry: ((pos: THREE.Vector3, speed: number, fps: number) => void) | null = null;
    onFrame:     ((time: number, dt: number) => void) | null = null;

    private readonly host:     HTMLElement;
    private readonly canvas:   HTMLCanvasElement;
    private readonly skyDome:  Sky;
    private readonly sunLight: THREE.DirectionalLight;
    private readonly skyLight: THREE.HemisphereLight;
    private readonly gridPlate:  THREE.GridHelper;
    private readonly fineGrid:   THREE.GridHelper;
    private readonly axisGizmo:  THREE.Group;
    private readonly ground:     THREE.Mesh;
    private readonly sunVector = new THREE.Vector3();

    private readonly motion: MotionRecord =
    {
        forward: false, back: false, left: false, right: false,
        up: false, down: false, fast: false, slow: false,
    };

    private yaw   = -0.6;                                // [rad]
    private pitch = -0.22;                               // [rad]
    private orbitRadius = 26;                            // [m]

    private renderScale = 1;
    private pointerActive: 'none' | 'fly-look' | 'orbit-turn' | 'orbit-pan' = 'none';
    private readonly clock = new THREE.Clock();
    private frameAccum = 0;
    private frameCount = 0;
    private fpsRead = 60;
    private running = true;

    constructor(host: HTMLElement, canvas: HTMLCanvasElement)
    {
        this.host   = host;
        this.canvas = canvas;

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.sky.exposure;

        this.scene  = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 20000);
        this.camera.position.set(16, 9, 20);

        //---------------------------------------------------------------- atmosphere
        this.skyDome = new Sky();
        this.skyDome.scale.setScalar(12000);
        this.scene.add(this.skyDome);

        this.sunLight = new THREE.DirectionalLight(0xffeedd, this.sky.sunIntensity);
        this.sunLight.position.set(60, 90, 40);
        this.scene.add(this.sunLight);

        this.skyLight = new THREE.HemisphereLight(0x9fb8ff, 0x2a2622, 0.55);
        this.scene.add(this.skyLight);

        //---------------------------------------------------------------- ground reference
        this.ground = new THREE.Mesh(
            new THREE.PlaneGeometry(4000, 4000),
            new THREE.MeshStandardMaterial({
                color: new THREE.Color(this.sky.groundTone),
                roughness: 0.96, metalness: 0.0,
            }),
        );
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.02;
        this.scene.add(this.ground);

        this.gridPlate = new THREE.GridHelper(400, 40, 0x6a6a6a, 0x3a3a3a);
        this.fineGrid  = new THREE.GridHelper(400, 400, 0x2f2f2f, 0x2f2f2f);
        for (const g of [this.gridPlate, this.fineGrid])
        {
            const m = g.material as THREE.Material;
            m.transparent = true;
            m.depthWrite  = false;
        }
        (this.gridPlate.material as THREE.Material).opacity = 0.55;
        (this.fineGrid.material  as THREE.Material).opacity = 0.22;
        this.scene.add(this.gridPlate, this.fineGrid);

        //---------------------------------------------------------------- world axis lines
        this.axisGizmo = new THREE.Group();
        this.axisGizmo.add(this.MakeAxisLine(new THREE.Vector3(1, 0, 0), 0xc0392b));
        this.axisGizmo.add(this.MakeAxisLine(new THREE.Vector3(0, 0, 1), 0x2f6fd0));
        this.scene.add(this.axisGizmo);

        this.scene.fog = new THREE.FogExp2(0x9aa7b8, this.sky.fogDensity);

        this.ApplySky();
        this.BindInput();
        this.Resize();

        const observer = new ResizeObserver(() => this.Resize());
        observer.observe(this.host);

        this.Tick();
    }

    //----------------------------------------------------------------------------------------------------------------------
    private MakeAxisLine(direction: THREE.Vector3, tone: number): THREE.Line
    {
        const span = 200;                                                                       // [m]
        const geometry = new THREE.BufferGeometry().setFromPoints([
            direction.clone().multiplyScalar(-span),
            direction.clone().multiplyScalar(span),
        ]);
        const material = new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.55 });
        return new THREE.Line(geometry, material);
    }

    //----------------------------------------------------------------------------------------------------------------------
    ApplySky(): void
    {
        const u = this.skyDome.material.uniforms;
        u['turbidity'].value       = this.sky.turbidity;
        u['rayleigh'].value        = this.sky.rayleigh;
        u['mieCoefficient'].value  = this.sky.mieCoeff;
        u['mieDirectionalG'].value = this.sky.mieDirection;

        const phi   = THREE.MathUtils.degToRad(90 - this.sky.elevation);
        const theta = THREE.MathUtils.degToRad(this.sky.azimuth);
        this.sunVector.setFromSphericalCoords(1, phi, theta);
        u['sunPosition'].value.copy(this.sunVector);

        this.sunLight.position.copy(this.sunVector).multiplyScalar(500);
        this.sunLight.intensity = this.sky.sunIntensity;

        // warm the sun toward the horizon, cool it at zenith
        const horizonBlend = THREE.MathUtils.clamp(1 - this.sky.elevation / 40, 0, 1);
        this.sunLight.color.setHSL(0.09 - 0.03 * (1 - horizonBlend), 0.35 * horizonBlend + 0.05, 0.62);
        this.skyLight.intensity = 0.25 + 0.5 * THREE.MathUtils.clamp(this.sky.elevation / 60, 0, 1);

        this.renderer.toneMappingExposure = this.sky.exposure;
        (this.ground.material as THREE.MeshStandardMaterial).color.set(this.sky.groundTone);

        const fog = this.scene.fog as THREE.FogExp2;
        fog.density = this.sky.fogDensity;
        fog.color.setHSL(0.58, 0.16, 0.30 + 0.35 * THREE.MathUtils.clamp(this.sky.elevation / 60, 0, 1));

        this.gridPlate.visible = this.sky.showGrid;
        this.fineGrid.visible  = this.sky.showGrid;
        this.axisGizmo.visible = this.sky.showGizmo;
    }

    //----------------------------------------------------------------------------------------------------------------------
    SetScheme(scheme: CameraScheme): void
    {
        this.scheme = scheme;
        if (scheme === 'orbit')
        {
            const offset = this.camera.position.clone().sub(this.orbitTarget);
            this.orbitRadius = Math.max(offset.length(), 1.5);
        }
        else
        {
            const look = new THREE.Vector3();
            this.camera.getWorldDirection(look);
            this.yaw   = Math.atan2(-look.x, -look.z);
            this.pitch = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1));
        }
    }

    SunDirection(): THREE.Vector3
    {
        return this.sunVector.clone();
    }

    SunColour(): THREE.Color
    {
        return this.sunLight.color;
    }

    FogColour(): THREE.Color
    {
        return (this.scene.fog as THREE.FogExp2).color;
    }

    FrameScene(): void
    {
        this.orbitTarget.set(0, 0, 0);
        this.orbitRadius = 30;
        this.camera.position.set(18, 11, 22);
        this.camera.lookAt(this.orbitTarget);
        this.SetScheme(this.scheme);
    }

    SetRenderScale(scale: number): void
    {
        this.renderScale = Math.min(Math.max(scale, 0.25), 2);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
        this.Resize();
    }

    Dispose(): void
    {
        this.running = false;
        this.renderer.dispose();
    }

    //----------------------------------------------------------------------------------------------------------------------
    private Resize(): void
    {
        const w = Math.max(this.host.clientWidth, 1);
        const h = Math.max(this.host.clientHeight, 1);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    //----------------------------------------------------------------------------------------------------------------------
    private BindInput(): void
    {
        const c = this.canvas;
        c.tabIndex = 0;
        c.style.outline = 'none';

        c.addEventListener('contextmenu', (e) => e.preventDefault());

        c.addEventListener('pointerdown', (e) =>
        {
            c.focus();
            if (this.scheme === 'fly')
            {
                if (e.button === 1 || e.button === 2 || (e.button === 0 && this.primaryFree))
                {
                    this.pointerActive = 'fly-look';
                    c.setPointerCapture(e.pointerId);
                    e.preventDefault();
                }
            }
            else
            {
                // Blender scheme: MMB orbits, Shift+MMB pans (LMB/RMB mirrored for trackpad parity)
                if (e.button === 1 || (e.button === 0 && this.primaryFree))
                {
                    this.pointerActive = e.shiftKey ? 'orbit-pan' : 'orbit-turn';
                }
                else if (e.button === 2)
                {
                    this.pointerActive = 'orbit-pan';
                }
                else
                {
                    return;
                }
                c.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
        });

        c.addEventListener('pointermove', (e) =>
        {
            if (this.pointerActive === 'none') return;
            const dx = e.movementX ?? 0;
            const dy = e.movementY ?? 0;

            if (this.pointerActive === 'fly-look')
            {
                const sensitivity = 0.0026;                                                     // [rad/px]
                this.yaw   -= dx * sensitivity;
                this.pitch -= dy * sensitivity;
                this.pitch  = THREE.MathUtils.clamp(this.pitch, -1.5533, 1.5533);
            }
            else if (this.pointerActive === 'orbit-turn')
            {
                const sensitivity = 0.0055;
                const offset = this.camera.position.clone().sub(this.orbitTarget);
                const spherical = new THREE.Spherical().setFromVector3(offset);
                spherical.theta -= dx * sensitivity;
                spherical.phi    = THREE.MathUtils.clamp(spherical.phi - dy * sensitivity, 0.02, Math.PI - 0.02);
                spherical.radius = this.orbitRadius;
                this.camera.position.copy(this.orbitTarget).add(new THREE.Vector3().setFromSpherical(spherical));
                this.camera.lookAt(this.orbitTarget);
            }
            else if (this.pointerActive === 'orbit-pan')
            {
                const scale = this.orbitRadius * 0.0016;
                const right = new THREE.Vector3();
                const up    = new THREE.Vector3();
                this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
                const shift = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale));
                this.orbitTarget.add(shift);
                this.camera.position.add(shift);
            }
        });

        const release = (e: PointerEvent) =>
        {
            this.pointerActive = 'none';
            if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
        };
        c.addEventListener('pointerup', release);
        c.addEventListener('pointercancel', release);

        c.addEventListener('wheel', (e) =>
        {
            // a sculpt tool owns Ctrl+Wheel (brush radius) while active
            if (!this.primaryFree && (e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            if (this.scheme === 'fly')
            {
                // Unreal: wheel trims flight speed while looking, otherwise dollies forward
                if (this.pointerActive === 'fly-look')
                {
                    this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * (e.deltaY < 0 ? 1.15 : 0.87), 0.2, 400);
                }
                else
                {
                    const look = new THREE.Vector3();
                    this.camera.getWorldDirection(look);
                    this.camera.position.addScaledVector(look, -Math.sign(e.deltaY) * this.flySpeed * 0.35);
                }
            }
            else
            {
                this.orbitRadius = THREE.MathUtils.clamp(this.orbitRadius * (e.deltaY < 0 ? 0.9 : 1.111), 0.6, 4000);
                const dir = this.camera.position.clone().sub(this.orbitTarget).normalize();
                this.camera.position.copy(this.orbitTarget).addScaledVector(dir, this.orbitRadius);
            }
        }, { passive: false });

        const keyEdge = (e: KeyboardEvent, down: boolean) =>
        {
            const m = this.motion;
            switch (e.code)
            {
                case 'KeyW': case 'ArrowUp':    m.forward = down; break;
                case 'KeyS': case 'ArrowDown':  m.back    = down; break;
                case 'KeyA': case 'ArrowLeft':  m.left    = down; break;
                case 'KeyD': case 'ArrowRight': m.right   = down; break;
                case 'KeyE': case 'Space':      m.up      = down; break;
                case 'KeyQ':                    m.down    = down; break;
                case 'ShiftLeft': case 'ShiftRight':   m.fast = down; break;
                case 'ControlLeft': case 'ControlRight': m.slow = down; break;
                default: return;
            }
            e.preventDefault();
        };
        c.addEventListener('keydown', (e) => keyEdge(e, true));
        c.addEventListener('keyup',   (e) => keyEdge(e, false));
        c.addEventListener('blur', () =>
        {
            const m = this.motion;
            m.forward = m.back = m.left = m.right = m.up = m.down = m.fast = m.slow = false;
        });

        // Blender numpad framing
        c.addEventListener('keydown', (e) =>
        {
            if (this.scheme !== 'orbit') return;
            if (e.code === 'Numpad0' || e.code === 'Period' || e.code === 'NumpadDecimal') this.FrameScene();
        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    private Advance(dt: number): void
    {
        if (this.scheme !== 'fly') return;

        const m = this.motion;
        this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

        let speed = this.flySpeed;                                                              // [m/s]
        if (m.fast) speed *= 4.0;
        if (m.slow) speed *= 0.25;

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const right   = new THREE.Vector3(1, 0,  0).applyQuaternion(this.camera.quaternion);
        const travel  = new THREE.Vector3();

        if (m.forward) travel.add(forward);
        if (m.back)    travel.sub(forward);
        if (m.right)   travel.add(right);
        if (m.left)    travel.sub(right);
        if (m.up)      travel.y += 1;
        if (m.down)    travel.y -= 1;

        if (travel.lengthSq() > 0) this.camera.position.addScaledVector(travel.normalize(), speed * dt);
    }

    //----------------------------------------------------------------------------------------------------------------------
    private Tick = (): void =>
    {
        if (!this.running) return;
        requestAnimationFrame(this.Tick);

        const dt = Math.min(this.clock.getDelta(), 0.1);                                        // [s]
        this.Advance(dt);
        this.onFrame?.(this.clock.elapsedTime, dt);

        this.frameAccum += dt;
        this.frameCount += 1;
        if (this.frameAccum >= 0.5)
        {
            this.fpsRead    = this.frameCount / this.frameAccum;
            this.frameAccum = 0;
            this.frameCount = 0;
        }

        this.renderer.render(this.scene, this.camera);
        this.onTelemetry?.(this.camera.position, this.flySpeed, this.fpsRead);
    };
}

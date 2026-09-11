//==========================================================================================
// Viewport — WebGPU swap-chain owner plus the camera rig.
//
// The camera is the one piece of the renderer that has to feel right in the hand: orbit with
// the left button, look with the right, fly with WASDQE, dolly with the wheel. Every frame the
// tiny jitter that drives progressive accumulation is recomputed, so a still camera converges
// on an anti-aliased image while a moving one stays immediate.
//==========================================================================================

const HALTON = [
    [0.5000, 0.3333], [0.2500, 0.6667], [0.7500, 0.1111], [0.1250, 0.4444],
    [0.6250, 0.7778], [0.3750, 0.2222], [0.8750, 0.5556], [0.0625, 0.8889],
    [0.5625, 0.0370], [0.3125, 0.3704], [0.8125, 0.7037], [0.1875, 0.2593],
    [0.6875, 0.5926], [0.4375, 0.9259], [0.9375, 0.0741], [0.0313, 0.4074],
];

export class Viewport
{
    constructor(canvas)
    {
        this.canvas = canvas;
        this.dpr = 1;
        this.renderScale = 0.8;
        this.width = 1;
        this.height = 1;

        this.position = [620, 300, 640];
        this.yaw = -2.34;
        this.pitch = -0.28;
        this.fov = 46;
        this.orbitTarget = [0, 120, 0];
        this.orbitDistance = 900;

        this.jitterIndex = 0;
        this.jitter = [0, 0];
        this.dirty = true;
        this.keys = new Set();
        this.pointer = { x: 0, y: 0, left: false, right: false, middle: false, moved: false };
        this.velocity = [0, 0, 0];
        this.flySpeed = 260;
        this.enabled = true;

        this.attach();
        this.resize();
    }

    attach()
    {
        const canvas = this.canvas;

        canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        canvas.addEventListener('pointerdown', (event) => {
            canvas.setPointerCapture(event.pointerId);
            this.pointer.x = event.clientX;
            this.pointer.y = event.clientY;
            if (event.button === 0) this.pointer.left = true;
            if (event.button === 1) this.pointer.middle = true;
            if (event.button === 2) this.pointer.right = true;
        });
        canvas.addEventListener('pointerup', (event) => {
            if (event.button === 0) this.pointer.left = false;
            if (event.button === 1) this.pointer.middle = false;
            if (event.button === 2) this.pointer.right = false;
            canvas.releasePointerCapture?.(event.pointerId);
        });
        canvas.addEventListener('pointermove', (event) => {
            const dx = event.clientX - this.pointer.x;
            const dy = event.clientY - this.pointer.y;
            this.pointer.x = event.clientX;
            this.pointer.y = event.clientY;
            if (!this.enabled)
            {
                return;
            }
            if (this.pointer.left && !event.shiftKey)
            {
                this.orbit(dx, dy);
            }
            if (this.pointer.right || (this.pointer.left && event.shiftKey))
            {
                this.look(dx, dy);
            }
            if (this.pointer.middle)
            {
                this.pan(dx, dy);
            }
        });
        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            if (!this.enabled)
            {
                return;
            }
            const factor = Math.exp(event.deltaY * 0.0012);
            this.orbitDistance = Math.min(6000, Math.max(30, this.orbitDistance * factor));
            const forward = this.forward();
            this.position = [
                this.orbitTarget[0] - forward[0] * this.orbitDistance,
                this.orbitTarget[1] - forward[1] * this.orbitDistance,
                this.orbitTarget[2] - forward[2] * this.orbitDistance,
            ];
            this.dirty = true;
        }, { passive: false });
    }

    orbit(dx, dy)
    {
        this.yaw -= dx * 0.006;
        this.pitch = Math.max(-1.51, Math.min(1.51, this.pitch - dy * 0.006));
        const forward = this.forward();
        this.position = [
            this.orbitTarget[0] - forward[0] * this.orbitDistance,
            this.orbitTarget[1] - forward[1] * this.orbitDistance,
            this.orbitTarget[2] - forward[2] * this.orbitDistance,
        ];
        this.dirty = true;
    }

    look(dx, dy)
    {
        this.yaw -= dx * 0.004;
        this.pitch = Math.max(-1.51, Math.min(1.51, this.pitch - dy * 0.004));
        this.dirty = true;
    }

    pan(dx, dy)
    {
        const right = this.right();
        const up = this.up();
        const scale = this.orbitDistance * 0.0016;
        for (let i = 0; i < 3; i += 1)
        {
            const delta = -right[i] * dx * scale + up[i] * dy * scale;
            this.orbitTarget[i] += delta;
            this.position[i] += delta;
        }
        this.dirty = true;
    }

    frame(bounds)
    {
        this.orbitTarget = [bounds.center[0], bounds.center[1], bounds.center[2]];
        this.orbitDistance = bounds.radius * 2.4;
        this.yaw = -2.34;
        this.pitch = -0.28;
        const forward = this.forward();
        this.position = [
            this.orbitTarget[0] - forward[0] * this.orbitDistance,
            this.orbitTarget[1] - forward[1] * this.orbitDistance,
            this.orbitTarget[2] - forward[2] * this.orbitDistance,
        ];
        this.dirty = true;
    }

    forward()
    {
        const cp = Math.cos(this.pitch);
        return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
    }

    right()
    {
        const f = this.forward();
        const r = [f[2], 0, -f[0]];
        const length = Math.hypot(r[0], r[2]) || 1;
        return [r[0] / length, 0, r[2] / length];
    }

    up()
    {
        const f = this.forward();
        const r = this.right();
        return [
            r[1] * f[2] - r[2] * f[1],
            r[2] * f[0] - r[0] * f[2],
            r[0] * f[1] - r[1] * f[0],
        ];
    }

    // Free flight: WASDQE plus shift/space for vertical movement.
    update(dt, keys)
    {
        if (!this.enabled || keys.size === 0)
        {
            return false;
        }
        const forward = this.forward();
        const right = this.right();
        const speed = this.flySpeed * dt * (keys.has('shift') ? 4 : 1);
        const delta = [0, 0, 0];
        const add = (axis, amount) => {
            for (let i = 0; i < 3; i += 1)
            {
                delta[i] += axis[i] * amount;
            }
        };
        if (keys.has('w')) add(forward, speed);
        if (keys.has('s')) add(forward, -speed);
        if (keys.has('a')) add(right, -speed);
        if (keys.has('d')) add(right, speed);
        if (keys.has('e') || keys.has('space')) add([0, 1, 0], speed);
        if (keys.has('q')) add([0, 1, 0], -speed);

        if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0)
        {
            return false;
        }
        for (let i = 0; i < 3; i += 1)
        {
            this.position[i] += delta[i];
            this.orbitTarget[i] += delta[i];
        }
        this.dirty = true;
        return true;
    }

    // Subpixel offsets for progressive accumulation; reset when the camera moves.
    nextJitter(sample)
    {
        const entry = HALTON[sample % HALTON.length];
        this.jitter = [
            (entry[0] - 0.5) / Math.max(1, this.width),
            (entry[1] - 0.5) / Math.max(1, this.height),
        ];
        return this.jitter;
    }

    resize(scale = this.renderScale)
    {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(64, Math.floor(rect.width * dpr * scale));
        const height = Math.max(64, Math.floor(rect.height * dpr * scale));
        this.renderScale = scale;
        if (this.width === width && this.height === height && this.dpr === dpr)
        {
            return false;
        }
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.canvas.width = width;
        this.canvas.height = height;
        return true;
    }

    // Compact description consumed by TerrainEngine.prepareFrame.
    describe()
    {
        return {
            position: this.position,
            forward: this.forward(),
            right: this.right(),
            up: this.up(),
            tanHalfFov: Math.tan((this.fov * Math.PI / 180) * 0.5),
            jitter: this.jitter,
        };
    }
}

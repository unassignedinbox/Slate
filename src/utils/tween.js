// Minimal, dependency-free easing + timeline helpers used to drive the
// procedural attack / threat-display animations.

export const Easing = {
  linear: (t) => t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadIn: (t) => t * t,
  cubicOut: (t) => 1 - Math.pow(1 - t, 3),
  cubicIn: (t) => t * t * t,
  quartOut: (t) => 1 - Math.pow(1 - t, 4),
  expoOut: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  expoIn: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  backOut: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elasticOut: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export function clamp01(x) { return Math.max(0, Math.min(1, x)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// A Timeline lets us stack named keyframe "tracks" (0..1 local time windows)
// and sample them every frame without allocating. Used for attack/threat.
export class Timeline {
  constructor() {
    this.t = 0;
    this.duration = 1;
    this.playing = false;
    this.onComplete = null;
    this.tracks = [];
  }

  add(start, end, fn, easing = Easing.linear) {
    this.tracks.push({ start, end, fn, easing });
    this.duration = Math.max(this.duration, end);
    return this;
  }

  play() { this.t = 0; this.playing = true; return this; }
  stop() { this.playing = false; return this; }

  update(dt) {
    if (!this.playing) return;
    this.t += dt;
    for (const tr of this.tracks) {
      const span = tr.end - tr.start;
      if (span <= 0) continue;
      let local = (this.t - tr.start) / span;
      if (local < 0) continue;
      const clamped = clamp01(local);
      tr.fn(tr.easing(clamped), clamped, this.t);
    }
    if (this.t >= this.duration) {
      this.playing = false;
      if (this.onComplete) this.onComplete();
    }
  }
}

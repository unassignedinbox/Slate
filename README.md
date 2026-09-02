# SLATE — Engine Acoustics Lab

A procedural engine-audio simulator. Everything you hear is **synthesised from
physics** — no samples, no recordings, no downloads. The firing order, torque
curve, rotating inertia and exhaust resonances of each car drive a Web Audio
graph that is rebuilt from those numbers at runtime.

Four machines:

| | Engine | Firing order | Peak | Redline |
|---|---|---|---|---|
| **Nissan GT-R NISMO** (R35) | VR38DETT 3.8 L 60° twin-turbo V6 | 1-2-3-4-5-6 | 600 hp @ 6 800 | 7 400 rpm |
| **Porsche 918 Spyder** | 4.6 L 90° flat-plane V8 + 208 kW e-machines | 1-8-4-3-6-5-7-2 | 608 hp @ 8 700 | 9 150 rpm |
| **Ferrari LaFerrari** | F140 FE 6.3 L 65° V12 + HY-KERS | 1-12-5-8-3-10-6-7-2-11-4-9 | 800 hp @ 9 000 | 9 250 rpm |
| **Porsche 718 Spyder 4.0** | 4.0 L boxer six | 1-6-2-4-3-5 | 414 hp @ 7 600 | 8 000 rpm |

> **On "Porsche Spyder 360":** the request was ambiguous, so both candidates are
> included — the **918 Spyder** (the hybrid hypercar, grouped naturally with the
> LaFerrari) as the primary preset, and the **718 Spyder 4.0** as a fourth.

## Run it

```bash
npm start        # serves on http://localhost:8000 — open it and press "Start engine"
npm test         # 32 unit tests on the physics and acoustics maths
npm run verify   # renders the real graph offline and measures the output spectrum
npm run export   # writes auditionable WAV renders of each car into renders/
npm run check    # static wiring check of the browser side
```

Browsers block audio until a user gesture, so nothing is instantiated until you
click **Start engine**.

**Controls** — hold `W`/`↑`/`space` for throttle, `S`/`↓` for brake, `E`/`Q` to
shift, `R` to start/stop, `B` to blip, `1`–`4` to change car. **Dyno** mode free-revs
the engine; **Road** mode launches the car, shifts the gearbox and adds wind
noise. Listening positions: cockpit, under the hood, trackside, and a **flyby**
that applies a real Doppler shift from the car's speed.

## How the sound is made

**1. The firing pattern sets the pitch.** A four-stroke cylinder fires once per
720° of crank rotation. If cylinder *i* fires at crank angle φᵢ, the summed
exhaust pressure is Σᵢ wᵢ·pulse(θ − φᵢ). Expanding that in a Fourier series over
the 720° cycle gives, for harmonic *k*,

```
|P_k| = |Σᵢ wᵢ·e^(−j·2π·k·φᵢ/720)| / N        arg = −atan2(Σᵢ wᵢ sin(2πkφᵢ/720), Σᵢ wᵢ cos(2πkφᵢ/720))
```

computed in `src/model/firing.js`. This is *why* an engine sounds the way it
does: for an even-firing V8 every harmonic cancels except the multiples of 8, so
the note is the 4th order of crank speed; a V6 gives the 3rd order, a V12 the
6th. The per-cylinder weights `wᵢ` are the unequal exhaust runner lengths — make
them unequal and the lower orders leak back in, which is exactly the "lope".

**2. Phase is preserved.** 48 oscillators are built, one per harmonic, each given
a `PeriodicWave` encoding that harmonic's phase (`real = mag·sin φ`,
`imag = mag·cos φ`), so the bank sums to a real pulse train rather than a mush of
sines. Only the gains move at runtime.

**3. The exhaust shapes it.** Each harmonic is multiplied by the pressure-pulse
spectrum `1/(1 + (f/f_c)^α)` — `f_c` rises with load, which is why the note gains
edge as you open the throttle — and by that car's fixed-Hz resonances
(`src/cars.js` → `tone.resonances`). Chamber and quarter-wave resonances do not
track rpm; they are what makes one car recognisable from another.

**4. Everything else.** Saturation (load-dependent `tanh` waveshaper), induction
noise, valve-train hiss, firing-rate-modulated noise for the top-end shimmer,
turbo whine with lag and a blow-off valve on lift, e-machine whine for the two
hybrids, overrun crackles, a starter whir, and a synthetic impulse response for
the space.

**5. The engine is simulated, not scripted.** `src/model/engine.js` integrates
`I·dω/dt = T_engine(rpm, throttle, boost) − T_clutch`, with a turbo lag filter,
an idle governor, a fuel-cut limiter with hysteresis, a two-mass slipping clutch,
a gearbox with finite shift times, longitudinal vehicle dynamics and an ERS
state-of-charge model. The stiff clutch spring is integrated exactly
(`ω = ω∞ + (ω₀ − ω∞)e^(−Kτ/I)`) because explicit Euler diverges there; `update()`
sub-steps to 1/400 s so results never depend on the caller's frame rate.

## Verification

`npm run verify` renders the **same graph the browser runs** inside a
`web-audio-engine` `OfflineAudioContext` and measures the result — 26 checks, all
passing:

- the partials form a harmonic series rooted at `rpm/60 × cylinders/2`; 85–100 %
  of strong peaks land on that series, and measured fundamentals come out at
  99.9 Hz for a 2 000 rpm V6, 400.0 Hz for a 6 000 rpm V8, 899.9 Hz for a
  9 000 rpm V12 — sub-0.2 % error;
- level and high-frequency content both rise with throttle;
- the V12 carries ~6× the energy above 3 kHz of the turbo V6 at equal rpm;
- the turbo whistle is a **non-harmonic** partial that appears with boost and
  spins up (1 333 Hz at 0.45 bar → 2 150 Hz at 1.05 bar);
- the flyby position shifts pitch with speed;
- a stopped engine measures exactly 0.00e+0 rms.

`npm run export` renders full runs to WAV and re-measures them: across
quasi-steady windows the loudest partial sits within ~1 % of the firing
frequency the physics predicted.

These checks have caught four real defects during development: an audio leak that
kept amplitude-modulated noise audible with the engine off (the AM signal is
summed *into* the gain `AudioParam`, so zeroing it is not enough — gate nodes are
required), a stall-detection race that killed the engine during cranking, a rigid
drivetrain coupling that made a stationary car impossible to idle, and a clutch
spring stiff enough to diverge under explicit Euler.

## Sources

Power, torque, redline, displacement, firing order, gearbox type and hybrid
output are published manufacturer or manufacturer-derived figures. Gear ratios,
final drives, rotating inertia, Cd·A, and the whole acoustic `tone` block are
**engineering estimates** chosen to reproduce each car's measured behaviour and
recorded note — they are labelled as such in `src/cars.js`. This is a synthesiser
inspired by these engines, not a recording of them.

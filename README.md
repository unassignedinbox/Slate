# Slate — robotic *Anopheles* (fuel-siphon vermin)

A procedurally built, fully articulated **female *Anopheles* mosquito**
styled as a police drone, and a simulation of the complete mechanic:

**cruise → approach → hover → land → settle → probe → drill → feed →
withdraw → take off.**

Nothing in it is a baked animation clip. Every frame is solved: the wing
stroke comes from measured insect-flight kinematics, the feet are IK'd
onto the real curved surface of the fuel drum, the proboscis runs the
actual insertion sequence a mosquito uses, and the fuel is a real
quantity that moves out of the vehicle's tank and into the animal.

```bash
npm install
npm run dev
```

Mouse orbits. `F` toggles follow-cam. `R` refills the tank.

---

## What the panel controls

Two folders, nothing else. No HUD, no labels, no overlays.

**Shape** — rebuilds the mesh. Every length is a ratio of `bodyLength`,
so the whole animal scales without losing proportion. Defaults are the
real morphometrics of a female *An. gambiae*.

**Mechanics** — live, no rebuild. Grouped as wing kinematics, body and
flight, legs and landing, probe/pierce/drill, and feeding.

`timeScale` is the one to reach for first: drop it to 0.05 and push
`wingbeatHz` to 600 to watch the true stroke — the flip at reversal is
the whole trick and it is invisible at real speed.

---

## The parts that matter

### Wing stroke (`kinematics.js: wingAngles`)

Three Euler angles in the stroke-plane frame — `phi` (sweep), `theta`
(deviation), `alpha` (feathering).

A mosquito is the odd one out among flying insects and the model has to
reflect that:

- **Amplitude is tiny.** ~40 deg, against 91 deg for a honeybee and >120
  deg for a fruit fly. Lower than any other insect group.
- **Because the sweep is so short, translation cannot carry the weight.**
  Lift comes from rotation at the ends of the half-strokes. So `alpha` is
  near-**trapezoidal**: the wing holds a constant angle of attack through
  the stroke then flips extremely fast at reversal.
- **The rotation leads the reversal** (advanced rotation). That phase
  lead is what generates the trailing-edge vortex and the rotational
  drag. `rotationAdvanceDeg`.
- **Spanwise torsion**: the tip rotates ahead of the root. Done in a
  vertex shader so it stays smooth at 800 Hz instead of chunking into
  rigid panels.
- **Halteres** beat antiphase at the same frequency.

### Flight (`agent.js: steerTo`)

Mosquitoes turn by **rolling and sideslipping**, not by yawing. `steerTo`
banks into the turn and lets the lift vector do the work. Acceleration is
capped, so it cannot snap direction. Body yaw carries the 1-6 deg wander
real mosquitoes never stop doing.

### Landing (`agent.js: planLanding`)

Before the descent starts, the final resting transform and all six foot
positions are solved:

- resting attitude is **~45 deg to the substrate** with the abdomen
  raised — the *Anopheles* posture
- hind legs reach first, then mid, then fore (`touchdownOrder`)
- foot targets are **snapped onto the real cylinder** of the drum, then
  relaxed against each limb's reach envelope until both constraints hold

### Leg IK (`kinematics.js: solveLeg`)

Aim the limb, solve femur/tibia analytically, lay the tarsus down.

The part that is easy to get wrong: everything below the coxa hinges on
one axis, so the limb lives in a single plane. A real insect **rolls the
whole leg at the coxa** until that plane contains the surface normal.
Without that roll the tarsus cannot lie flat on a panel that is not
square to the body, and the feet spear through the metal. The roll is
about the aim axis, so it does not disturb the reach solution.

The tibio-tarsal joint then takes almost the entire remaining angle — that
is the real anatomy — and the five tarsomeres add `l/R` of curvature each
so the foot **wraps** the drum instead of bridging it.

### Proboscis (`kinematics.js: applyProboscis`)

The labium **never enters the target**. It buckles backward into a bow
while the labella stay pressed on the surface, and the six stylets slide
out through it: labrum, hypopharynx, two mandibles, two serrated maxillae.
The maxillae alternate as microsaws at ~15 Hz while the mandibles and
labrum creep forward between strokes.

The one liberty taken: a fuel tank is steel, not skin, so the fascicle
carries a **rotary boring head**. Everything around it is the real
mechanism.

### Feeding

Cibarial and pharyngeal pumps at ~3-4 Hz, visible as a peristaltic wave
running aft. The abdomen distends, the terga separate, the windows light
up. Fuel is conserved: it leaves `vehicle.fuel` and enters `agent.load`,
the tank level drops, and the loaded animal leaves badly — higher
wingbeat, worse climb, capped departure speed.

---

## Verifying it

```bash
node tools/simcheck.mjs     # headless: asserts the motion is sane
node tools/snapshot.mjs out # bakes real poses to OBJ for rendering
```

`simcheck` runs the whole behaviour cycle with no GPU and checks the
things that actually matter — that the stroke amplitude is inside the
measured mosquito range, that the rotation leads the reversal, that the
labium never enters the target, that all six feet reach their planted
world positions and lie on the surface rather than through it, that no
frame teleports, and that the fuel balances.

---

## Porting to Frontier (C++)

The motion math is deliberately engine-agnostic and dependency-free:

| file | what to port | depends on three.js? |
|---|---|---|
| `src/mosquito/kinematics.js` — `wingAngles`, `trapezoid`, `asymmetricPhase` | pure scalar math, drop straight in | no |
| `src/mosquito/kinematics.js` — `solveLeg` | analytic 2-link IK + coxal roll; swap `Vector3`/`Quaternion` for your types | types only |
| `src/mosquito/kinematics.js` — `applyProboscis`, `applyAbdomen` | joint-angle drivers | types only |
| `src/mosquito/agent.js` — the state machine and `steerTo` | behaviour + flight dynamics | types only |
| `src/core/params.js` | the tuned constants | no |

The rig is a plain transform hierarchy, so it maps onto a skeleton
one-to-one. Joint names and the order of the chains are in
`mosquito.js`.

---

## `assets/skito/`

The original `Skito1.blend` from the Frontier repo, converted to OBJ with
modifiers baked (`Skito1_Collection.obj`, `Skito1_Collection_001.obj`).
See `docs/SKITO1_REPORT.md` for what is in it and why it was not used as
the base.

`docs/RESEARCH.md` has every source and which number came from where.

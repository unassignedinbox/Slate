# Eagle 3D Biomechanics & Animation Studio

A high-fidelity, biologically accurate 3D eagle modeling and biomechanical simulation system built with **Three.js**, **WebGL**, **TypeScript**, and **React**.

---

## 🦅 Anatomical & Structural Fidelity

Modeled rigorously against biological reference data for *Haliaeetus leucocephalus* (Bald Eagle) and *Aquila chrysaetos* (Golden Eagle):

1. **Cranial & Beak Anatomy**:
   - **Hooked Maxilla**: Heavy recurved upper bill with razor-sharp tip and tomial cutting notch.
   - **Cere & Nares**: Porous yellow keratin cere with sculpted bilateral nostrils.
   - **Articulated Mandible & Gape**: Hinged lower jaw opening up to 45° with oral mucosal lining and tongue.
   - **Raptor Vision**: Supraorbital brow overhang, yellow/amber striated iris, black pupil, reflective cornea, and functional sweeping **nictitating membrane**.

2. **Torso & Sternal Keel**:
   - Deep aerodynamic breast with prominent **Carina / Sternal Keel** anchoring the massive *Pectoralis major* and *Supracoracoideus* muscles (>25% total body mass).

3. **Multi-Segmented Wing & Remiges System**:
   - Full avian bone chain: *Shoulder joint → Humerus → Elbow → Forearm (Radius/Ulna) → Carpus (Wrist) → Manus (Carpometacarpus) → Digits*.
   - **Primary Remiges (P1 to P10)**: 10 outer cambered feathers. Outer primaries (P6–P10) feature deep **emarginations** that splay vertically to reduce tip vortices and induced drag.
   - **Secondary Remiges (S1 to S14)**: 14 lifting airfoil feathers anchored along the ulna.
   - **Alula (Bastard Wing)**: 3-4 stiff feathers on Digit 1 acting as leading-edge stall delay slats.
   - **Propatagium & Postpatagium**: Aerodynamic leading and trailing edge skin membranes.

4. **Retrices & Tail Assembly**:
   - 12 fan-patterned tail flight feathers (R1–R12) anchored to the pygostyle for aerodynamic pitch, roll, and yaw rudder control.

5. **Raptorial Hindlimbs & Talons**:
   - Feathered thighs ("plumage trousers").
   - Reticulate scaled yellow tarsi (*tarsometatarsus*).
   - 4 grasping digits: **Hallux (Digit 1 - massive killing talon)**, Inner (D2), Middle (D3), Outer (D4).
   - Curved razor-sharp black keratin claws with digital flexor locking mechanism (>400 psi grip).

---

## 🎬 Biomechanical 3D Animations

All animations feature full body dynamics, secondary motion, and biological kinematics:

- **Wing Flap Cycle**:
  - *Downstroke*: Powerful forward-down sweep with full span, maximum camber, outer primary feather tip deflection, and body climb (+Y) & forward pitch.
  - *Upstroke*: Drag-reducing recovery stroke with wrist and elbow flexion, primary feather pronation (slicing through air), body sink (-Y), tail pitch compensation, and vestibulo-ocular head stabilization.
  - *Synchronized Audio*: Aerodynamic downstroke whoosh sound effect.

- **Glide / Thermal Soaring Cycle**:
  - Dihedral flat wing posture with splayed, slotted outer primaries capturing rising thermal currents.
  - Micro-turbulence responsive flutter, dynamic alula trim, tail rudder micro-adjustments, and body buoyancy heaving.

- **Walk Cycle (Ground Locomotion)**:
  - 2-beat alternating digitigrade stride.
  - **Talon Curling**: Claws curl during swing phase to avoid snagging on ground/rocks.
  - Lateral pelvic waddle, vertical bobbing, and counter-tempo folded wing bouncing.
  - **Avian Saccadic Head-Bobbing**: Head locks position in space (hold phase), then snaps forward (thrust phase).

- **Idle / Perched Animation**:
  - Rhythmic thoracic respiration expanding chest and keel.
  - Subtle postural weight shifts between legs.
  - Nictitating membrane sweeping across the cornea every 4.5 seconds.
  - Alert ambient head micro-glances and tail balance checks.

- **Screech & Display Animation**:
  - Aggressive territorial posture: body lowers, neck cranes forward and curves up.
  - Wide 45° beak gape revealing tongue and oral cavity.
  - Rapid pulsing and swelling of the throat/crop sac.
  - Half-flared **mantling wings** and fanned braced tail.
  - Visceral body tremor during vocal climax.
  - *Synchronized Audio*: Web Audio API synthesized raptor screech / chirp harmonics.

- **Head Turn / Raptor Saccades**:
  - 20–50 ms rapid head saccadic snaps (55° left, 70° right, skyward scan, ground hunt).
  - 45° head cocking / tilting for stereoscopic depth triangulation with binocular foveae.
  - **Interactive Cursor Mode**: Eagle head dynamically tracks user mouse cursor with raptor saccadic limits.

---

## 🔬 Interactive Tools & Visualizers

- **Skeletal X-Ray Mode (`X` key)**: Visualizes internal fused bird skeleton (Keel, Furcula, Humerus, Ulna, Carpometacarpus, Synsacrum, Pygostyle, Sclerotic rings).
- **Aerodynamic Streamlines (`A` key)**: 3D particle vortex and streamline simulator showing high-speed dorsal suction and wingtip vortex dissipation.
- **Feathers Only Isolation**: Isolates the remiges and retrices plumage layers.
- **Plumage Switcher**: Switch between Bald Eagle (*H. leucocephalus*) and Golden Eagle (*A. chrysaetos*).
- **Environments**: Alpine Mountain Sky, Rocky Canyon Ground, Golden Hour Sunset, Studio Stage.
- **Camera Presets**: Free Orbit, Cinematic Flyby, Dorsal Aero View, Raptor Head Close-up, Wingtip Slots, Low Talon Cam.
- **Timeline & Speed Control**: Real-time slider from 0.1x (Slow-Motion) to 2.0x, with pause and step controls.
- **Interactive Anatomical Hotspots**: Clickable 3D hotspots providing scientific breakdowns of avian aerodynamics.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Pause / Resume animation |
| `1` | Wing Flap Cycle |
| `2` | Glide / Soaring Cycle |
| `3` | Walk Cycle |
| `4` | Idle / Perched |
| `5` / `S` | Screech & Display Vocalization |
| `6` | Head Turn Saccades |
| `X` | Toggle Skeletal X-Ray Mode |
| `A` | Toggle Aerodynamic Streamlines |
| `M` | Mute / Unmute Audio |

---

## 🚀 Running the Studio

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to interact with the studio in real-time.

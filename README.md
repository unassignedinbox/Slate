# 🦅 AAA Eagle 3D Model & Biomechanical Animation Asset

Production-ready, anatomically accurate **3D Eagle Asset** designed for AAA game engines (Unreal Engine 5, Unity, Blender, Maya). Features authentic raptor morphology, multi-tier aerodynamic plumage, hooked predatory beak, anisodactyl talons, full skeletal rig, and 6 biomechanically accurate 3D animations with secondary dynamics.

---

## 📐 Anatomical Specifications & Reference Alignment

Modeled after adult *Haliaeetus leucocephalus* (Bald Eagle) and *Aquila chrysaetos* (Golden Eagle) biological data:

| Parameter | Measurement / Specification | Biological Function / Notes |
| :--- | :--- | :--- |
| **Wingspan** | 2.15 m (~7.1 ft) | Broad soaring aspect ratio with slotted wingtips |
| **Body Length** | 0.88 m (~35 in) | Aerodynamic teardrop profile with deep sternal keel |
| **Grip Pressure** | 400+ PSI | Locking tendon ratchet mechanism in talons |
| **Beak (Maxilla)** | High arched culmen, razor tomia, curved hook | Tearing prey, territorial defense |
| **Cere & Nares** | Waxy yellow saddle with angled oval nostrils | High-speed airflow dynamics during dives |
| **Supraorbital Ridge**| Bony forward brow shelf (35° overhang) | Creates raptor glare, blocks overhead sun glare |
| **Raptor Eyes** | Dual fovea, amber iris, glossy cornea | 340° visual field, 5x human visual acuity |
| **Foot Structure** | Anisodactyl (3 forward digits, 1 rear hallux) | 4-point crushing grip |
| **Scales (Tarsus)** | Reticulate hexagonal & anterior scute plates | Armored keratin protection |
| **Talons** | Razor-curved black keratin hooks (2-in hallux) | Lethal piercing and locking grasp |

---

## 🪶 Aerodynamic Feather Architecture

1. **Primary Flight Feathers (P1 - P10)**:
   - Outer primaries (P7 - P10) feature **emarginations** (notched leading and trailing edges) forming slotted "fingers" that flex independently in turbulent thermals to dampen wingtip vortices and maximize soaring lift.
   - Cambered 3D aerofoil cross-sections with central rachis (shaft) and micro-barbule normal mapping.
2. **Secondary Flight Feathers (S1 - S12)**:
   - Broad lifting surface anchored along the forearm (ulna).
3. **Alula ("Bastard Wing")**:
   - 3 quill feathers mounted on the pollex (Digit I thumb) that deflect at steep angles of attack to prevent low-speed aerodynamic stalls.
4. **Wing Coverts**:
   - Layered Greater, Median, and Lesser coverts shielding the quill bases on upper and lower wing surfaces.
5. **Tail Rectrices (Fan)**:
   - 12 broad radiating flight feathers providing pitch elevator control, yaw rudder steering, and air-brake flaring.
6. **Feather Trousers**:
   - Dense tibiotarsus plumage covering the upper legs down to the knee joint.

---

## 🎬 Biomechanical 3D Animation Cycles

All animations include realistic bone kinematics, center-of-mass heave/pitch oscillations, and secondary aerodynamic dynamics:

### 1. Wing Flap Cycle (`flap` - 1.0s Loop)
- **Downstroke (Power Stroke 0.0s - 0.45s)**:
  - Pectoralis major contraction: Humerus depresses 45° with active **pronation** (forward leading-edge tilt).
  - Wings fully extended to maximize aerodynamic surface area.
  - Outer primaries flex upward under aerodynamic dynamic pressure (+18° wingtip deflection).
  - Torso pitches upward (+4°) and rises on the heave cycle (+0.08m). Tail depresses to counteract pitch moment.
- **Upstroke (Recovery Stroke 0.45s - 1.0s)**:
  - Elbow and wrist flex inward (wing folding) to minimize frontal area and aerodynamic drag.
  - Active **supination** (leading edge tilts upward).
  - Body settles (-0.06m).
  - Head maintains horizon lock via **vestibulo-ocular reflex**.

### 2. Soaring Glide Cycle (`glide` - 3.0s Loop)
- Dihedral shallow V-wing attitude (8° - 12° upward angle).
- Slotted primary finger feathers exhibit organic micro-fluttering in thermal turbulence.
- Subtle differential banking and rolling trim adjustments.
- Tail acts as rudder and pitch elevator.
- Respiration chest expansion.

### 3. Ground Walk Cycle (`walk` - 1.2s Loop)
- Authentic heavy raptor swagger/waddle gait.
- Stride cycle: Foot liftoff -> Toe curl during swing phase -> Wide toe spread on impact -> Weight shift over supporting leg.
- Lateral body sway (±6°) and forward body pitch (12°).
- Avian **saccadic head bobbing** (thrusting forward and holding space).
- Folded wings adjust subtly for balance.

### 4. Idle Perch Cycle (`idle` - 4.0s Loop)
- Perched stance with curved talons grasping the perch.
- Folded wings resting neatly over mantle and flanks.
- Deep, rhythmic respiration breathing cycle (chest and plumage expansion).
- Alert raptor micro-saccadic head glances and scanning.
- Tail settling and toe grip readjustment.

### 5. Screech Cry (`screech` - 2.4s Climax)
- **Phase 1 (Anticipation)**: Head retracts, chest expands deeply.
- **Phase 2 (Vocalization)**: Neck thrusts forward & up, **mandible drops wide open (45° gape)** revealing pink oral cavity and vibrating tongue.
- Throat contracts with high-frequency tremor.
- Wings flare outward in dominance display, tail fans out wide.
- Synchronized Web Audio synthesized raptor screech cry!
- **Phase 3 (Recovery)**: Beak closes, neck returns to alert posture.

### 6. Head Turn / Saccadic Scan (`head_turn` - 4.0s Sequence)
- 85° sharp snap to left -> 0.8s stationary focus with 15° vertical tilt (examining ground).
- 170° crisp swing across to right side.
- Downward ground scan angle.
- Smooth return to central forward horizon.
- Natural multi-vertebra cervical chain deformation across 3 neck bones.

---

## 🎨 Plumage Presets

1. **Adult Bald Eagle (*Haliaeetus leucocephalus*)**: Pure white head & tail, dark chocolate brown body, bright yellow bill & talons.
2. **Golden Eagle (*Aquila chrysaetos*)**: Amber-brown plumage, golden-buff nape/crown, dark-tipped bill, feathered tarsi.
3. **Harpy Eagle (*Harpia harpyja*)**: Double crown crest, slate-grey mantle, barred wings, massive talons.
4. **Arctic White Falcon (Morph)**: Frost-white flight feathers, silvery mantle, striking golden eyes.
5. **Shadow Tactical Raptor**: Stealth obsidian plumage, crimson-amber eyes, polished jet-black talons.

---

## 📦 Export Formats & Engine Integration

- **`.GLB` (Binary GLTF 2.0)**: Contains 3D meshes, PBR texture channels (diffuse, normal, roughness, metalness), skeletal bone hierarchy, and all 6 embedded animation clips.
- **`.OBJ` (Wavefront OBJ)**: High-resolution static 3D mesh.

### Importing into Unreal Engine 5:
1. Drag the `.glb` into your Content Browser.
2. In the FBX/GLTF Import Options, enable **Import Skeletal Mesh** and **Import Animations**.
3. Use the created Animation Blueprint to blend between `flap`, `glide`, `walk`, `idle`, `screech`, and `head_turn`.

### Importing into Unity:
1. Drag the `.glb` into `Assets/Models`.
2. Set Rig Animation Type to **Generic** or **Humanoid/Custom**.
3. In the Animation tab, all 6 clips (`flap`, `glide`, `walk`, `idle`, `screech`, `head_turn`) are ready to assign in your Animator Controller.

---

## 🚀 Running the Interactive Studio

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser to inspect the 3D model, switch animations, customize lighting, test audio screech, inspect anatomical hotspots, and export files.

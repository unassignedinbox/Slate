# Source material

Everything the rig does is driven by measured numbers, not by eyeballing.
This is the list, with the specific value that ended up in the code.

## Wing kinematics

**Bomphrey, Nakata, Phillips & Walker (2017), "Smart wing rotation and
trailing-edge vortices enable high frequency mosquito flight", *Nature*
544:92-95.** <https://www.nature.com/articles/nature21727>
Filmed with 8 IR cameras at 10,000 fps.

| finding | where it lands |
|---|---|
| wingbeat frequency > 800 Hz | `wingbeatHz` (range goes to 900) |
| stroke amplitude only ~40 deg — **lower than any other insect group** (honeybee 91 deg, fruit fly >120 deg) | `strokeAmplitudeDeg = 44` |
| long, slender, high-aspect-ratio wings | `wingChord = 0.165 x wingLength`, AR ~6 |
| weight support comes from **rotational** mechanisms at stroke reversal, not from translation | trapezoidal `alpha` with `rotationSharpness` |
| three lift mechanisms: leading-edge vortices, **trailing-edge vortices** from wake capture, **rotational drag** | the rotation must *lead* the reversal -> `rotationAdvanceDeg = 34` |

The practical consequence: on a mosquito the visually defining motion is
the **rapid spanwise pitch flip at each stroke reversal**, not the sweep.
Sweep one of these wings like a housefly and it stops reading as a
mosquito immediately.

**Cornell dissertation, *Aedes aegypti* motion capture at 13,029 fps.**
<https://ecommons.cornell.edu/bitstream/1813/36032/1/smi6.pdf>

- stroke amplitude 34-54 deg, mean wingbeat 800 Hz
- **body roll, not yaw, is the primary steering axis** — turns are
  sideslip-driven by tilting the lift vector -> `maxBankDeg`, and
  `steerTo()` banks rather than yawing
- mid-stroke the wing sits ~45 deg from horizontal, dipping toward 0 deg
  just after the flip -> `pitchMidDeg = 46`
- body yaw shows small 1-6 deg oscillations on a ~30 ms timescale ->
  `yawJitterDeg = 3.5`, `yawJitterHz = 4.5`

**eLife, acoustic surveillance of mosquito wingbeats.**
<https://elifesciences.org/articles/27854>
**Female** wingbeat frequencies are typically 200-700 Hz (median 264 Hz
for a *Culex tarsalis* female), fundamental plus overtones, ~2% natural
variation in free flight. Lower than the 800 Hz free-flight figure —
species, sex and tethering all matter. A female *Anopheles* sits in the
low part of that band.

**PMC: *Anopheles coluzzii* swarm behaviour.**
<https://pmc.ncbi.nlm.nih.gov/articles/PMC11071295/>
Unlike other insects, *Anopheles* does **not** steer by differential
left/right wingbeat amplitude — it modulates **total** amplitude and
frequency. Amplitude and frequency **decrease as an object approaches the
frontal field of view** and increase as it recedes. Escape from a looming
threat = increased wingbeat kinematics plus simultaneous pitch and roll.

## Landing and take-off

**"Aerodynamic imaging by mosquitoes informs risk of encountering
surfaces".**
<https://www.researchgate.net/publication/341098897>

- mosquitoes **extend the hind legs toward a surface when landing** and
  **hold them backward when flying** — this is the single clearest tell
  for a believable touchdown, and it drives `applyLegsFlight()` and the
  hind-pair-first `touchdownOrder`
- after a blood meal they take off carrying roughly **their own body
  weight**, and do it while **minimising tactile force on the host to
  avoid detection** -> `loadedClimbPenalty`, `loadedWingbeatGain`

## Proboscis and piercing

Kong & Wu 2010, *Phys. Rev. E* 82:011910; Choo et al. 2015,
*Front. Physiol.* 6:306; and the review literature on mosquito-inspired
microneedles.

The proboscis is **not a needle**. It is:

- the **labium** — an outer gutter-shaped sheath ending in two sensory
  **labella**
- enclosing the **fascicle**: **six stylets** —
  1 **labrum** (hollow food canal, nanosharp tip, compliant at the tip and
  stiffer at the root so it can bend to seek a vessel),
  2 **mandibles** (sharp, hold the tissue apart),
  2 **maxillae** (serrated microsaws that anchor and cut),
  1 **hypopharynx** (salivary canal — anaesthetic, then anticoagulant)

**The labium never enters the skin.** It buckles backward into a U/C loop
while staying in surface contact and guiding the stylets down. That
guidance is what raises the buckling load of the fascicle (an Euler
critical-load effect).

Insertion sequence, implemented literally in `applyProboscis()`:

1. labella touch and taste the surface
2. labium retracts and bows
3. left maxilla advances
4. left maxilla retracts while mandibles + labrum advance
5. repeat for the right maxilla
6. labrum penetrates the vessel
7. on withdrawal the fascicle re-sheathes

Numbers: vibratory actuation at **~15 Hz** during insertion (reduces skin
deformation) -> `sawHz = 15`. Total insertion force **~16.5 uN**, three
orders of magnitude below an artificial microneedle. Fascicle buckling
limit ~50 mN.

## Anatomy specific to female *Anopheles*

- **Maxillary palps are as long as the proboscis.** This is *the*
  diagnostic against *Culex*/*Aedes*, whose females have short palps.
  4 segments each -> `palpLength ~= proboscisLength`.
- **Rests at ~45 deg to the surface**, abdomen up, not parallel like other
  genera -> `bodyPitchRestDeg = 45`.
- Wings carry **blocks of dark and pale scales** on the veins ->
  `wingScaleBlocks`.
- Female antennae are **sparsely haired**; the male's are plumose ->
  `antennaWhorlCount = 7`, short whorls.
- 13 flagellomeres per antenna, 8 visible abdominal terga.
- Leg segments: coxa -> trochanter -> femur -> tibia -> tarsus
  (5 tarsomeres) -> pretarsus with claws and pulvilli. Hind legs longest,
  fore legs shortest. Tarsal setae and contact chemosensilla sense the
  surface first on landing.
- **Halteres** — modified hindwings that beat antiphase to the wings and
  act as the gyros. Small, easy to forget, instantly wrong if missing.

## Feeding

Cibarial and pharyngeal pumps run **alternately at ~3-4 Hz** and are
visible as peristalsis -> `pumpHz = 3.4`, `pumpPhaseOffset`. The abdomen
distends several-fold over the meal -> `abdomenMaxDistension`.

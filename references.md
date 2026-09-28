# Scorpion reference sheet

The asset was built against publicly available anatomy and locomotion references rather than a generic insect silhouette. The downloaded search previews were used only as visual prompts; this file preserves the source links so the model's choices can be audited.

## Anatomy

1. **American Museum of Natural History / Lorenzo Prendini — Scorpiones (Scorpions)**  
   https://research.amnh.org/users/lorenzo/PDF/Prendini.2012.pdf  
   Establishes the main anatomical vocabulary and counts used in the asset: prosoma and carapace, seven-segment preabdomen/mesosoma, five-segment postabdomen/metasoma, telson, aculeus, chelate pedipalps, chelicerae, pectines, four pairs of walking legs, and trichobothria.
2. **Lander University — Vaejovis carolinianus**  
   https://lanwebs.lander.edu/faculty/rsfox/invertebrates/vaejovis.html  
   Used for the appendage article order. Each walking leg is represented as coxa, trochanter, femur, patella, tibia, basitarsus, tarsus, and apotele; each pedipalp as coxa, trochanter, femur, patella, tibia/chela manus, and tarsus/movable finger.
3. **Encyclopaedia Britannica — Scorpion internal features**  
   https://www.britannica.com/animal/scorpion/Internal-features  
   Used for the dorsal/ventral visual check, eyes, pectines, spiracles, pedipalps, telson, and the raised dorsal tail posture.
4. **Encyclopaedia Britannica — Scorpion external features**  
   https://www.britannica.com/animal/arachnid/External-features  
   Reference image page for the external anatomy silhouette and segmented appendages.

## Locomotion and action

5. **Wolfram Demonstrations — Simplified Models of Terrestrial Arthropod Gaits**  
   https://www.wolframcloud.com/obj/17c92a11-544d-4f0c-855f-ecb787f4a0cc  
   The walk clip uses the described alternate tetrapod pattern: one set is left legs 1 and 3 plus right legs 2 and 4; the other set is the complement. Swing/lift/plant offsets are phase-shifted by half a cycle.
6. **Escape Studios — Scorpion Animation Tutorial**  
   https://escapestudiosanimation.blogspot.com/2020/06/scorpion-animation-tutorial-at-vimeo.html  
   Used as an animation reference for treating each leg as a simple repeatable articulated cycle, with phase offsets across the animal.

## Image-search visual references

- Britannica dorsal and ventral labeled illustration: https://www.britannica.com/animal/scorpion/Internal-features
- Emperor scorpion side view: https://www.lifeonwhite.com/-/galleries/invertebrates/arachnids/scorpions/emperor-scorpion
- Search result for a raised-tail / stinger silhouette: https://www.dreamstime.com/scorpion-stinger-raised-high-to-deliver-fatal-blow-attack-stinger-scorpion-stinger-raised-high-to-deliver-fatal-blow-attack-image359502423

## What is modeled

- **Prosoma:** one carapace shield, anterior rim, median keel, 2 median ocelli, 3 lateral ocelli per side, and tucked chelicerae.
- **Mesosoma:** 7 named tergites, dorsal keels, lateral pleural membrane, spiracles, ventral sternites, and paired pectines with teeth.
- **Appendages:** 8 hierarchical walking-leg chains with terminal paired claws; 2 six-article pedipalps with separate fixed and movable fingers and sensory trichobothria.
- **Tail:** 5 hierarchical metasoma segments, articulating rings, telson/venom bulb, and a separate aculeus/stinger with groove.
- **Motion:** `Walk_Alternate_Tetrapod` and `Attack_Chelae_And_Aculeus` are embedded glTF animation clips.

This is a general adult emperor-type scorpion study, not a claim to represent every species. Scorpion proportions, color, pectine tooth counts, eye counts, setal patterns, and chela shape vary across taxa; a species-specific production asset should be calibrated to a specimen or a cited monograph.

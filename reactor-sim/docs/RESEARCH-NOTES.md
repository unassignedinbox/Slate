# Research notes

Sources consulted during development (accessed 2026-10). Values marked **open** are known to be unresolved.

## Neutron dose
- PDG Review 33, *Radioactivity and radiation* (https://pdg.lbl.gov/2012/reviews/rpp2012-rev-radioactivity.pdf):
  a 1 MeV neutron fluence of 1 n/cm² gives about 290 pSv effective dose (anterior-posterior geometry, ICRP-74).
  **Used in code** as `NEUTRON_FLUENCE_TO_DOSE_PSV_CM2 = 290` (`src/physics/constants.js`).
- Fluence-to-effective-dose paper (https://escholarship.org/content/qt5pd0x47s/): quotes about 6.44 pSv·cm² for the
  ISO geometry, roughly constant above high energies, with about ±3 % accuracy below 20 MeV.
  **Open:** this conflicts with the 290 pSv·cm² value above by about 45×. The two are for different energies and
  geometries, so the coefficient has to be chosen per energy and geometry before the neutron dose figure can be trusted.
- Sandia SAND2009-1144 (https://www.osti.gov/servlets/purl/983697): H*(10) flux-to-dose conversions in
  mrem/h per n/cm²·s. Not yet used for a cross-check.

**Known limitation:** the code applies the 1 MeV coefficient to the whole fission spectrum (mean energy about 2 MeV)
with no spectral weighting. Dose at 1 m is therefore indicative only.

## Shielding
- Borated polyethylene gives essentially no fast-neutron attenuation over a 4 mm layer. A coke-can-sized shield cannot
  reach public dose limits at the rated ~5.4 W. The 10 cm polyethylene case gives about 10× attenuation.
- Public limit used for exclusion distance: 20 µSv/h. Unshielded exclusion distance is about 420 m.

## Materials
- Fuel-form and structural-material property values are listed in `src/physics/materials.js`.
  Their source references should be added there; they have not all been verified against handbook tables.
- Helium coolant at 4 MPa fails the can hoop-stress check (1320 MPa against 97 MPa allowable for a 0.10 mm wall);
  the comparison marks it invalid.

## Monte Carlo
- Wilson 95 % intervals (`wilson()` in `src/physics/scenarios.js`) were checked by hand against
  k=5, n=50 → [0.0435, 0.2136] and k=25, n=50 → [0.3664, 0.6336]. Both match the code.
- Scenario runs: N=50 per scenario (seed base 1000). Material comparison: N=20 per variant (seed base 5000).
  Output: `public/data/monte-carlo.json`.

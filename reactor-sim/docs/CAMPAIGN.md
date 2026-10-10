# Campaign results

Generated 2026-10-10T15:13:52.689Z (runtime 5111 ms). Produced by `npm run campaign`.

## Material sweep (one factor at a time, default design otherwise)

Surface-dose columns hold the source fixed (no multiplication), so they compare shielding transmission only.

| Factor | Level | Valid | k_eff | k_inf | p (resonance escape) | P_NL | Lambda (s) | rho rods in | rho rods out | Mass (kg) | Surface dose per 1e6 n/s (uSv/h) | Surface dose per 1e6 photons/s (uSv/h) | Reason if rejected |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fuel | UO2 | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| fuel | UN | yes | 0.821 | 0.984 | 0.713 | 0.834 | 0.000100 | -0.690 | -0.218 | 4.02 | 6.66e+3 | 83.4 |  |
| fuel | UCO_KERNEL | yes | 0.860 | 1.19 | 0.786 | 0.725 | 0.000100 | -0.820 | -0.162 | 3.85 | 6.79e+3 | 88.6 |  |
| fuel | TRISO | yes | 0.543 | 1.56 | 0.930 | 0.349 | 0.000100 | -4.10 | -0.840 | 3.53 | 7.04e+3 | 98.6 |  |
| cladding | ZRY4 | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| cladding | SS316L | yes | 0.805 | 1.06 | 0.785 | 0.760 | 0.000100 | -0.869 | -0.242 | 3.88 | 6.76e+3 | 87.6 |  |
| cladding | IN718 | yes | 0.797 | 1.04 | 0.785 | 0.767 | 0.000100 | -0.876 | -0.254 | 3.89 | 6.76e+3 | 87.5 |  |
| cladding | SIC_SIC | yes | 0.861 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.818 | -0.161 | 3.78 | 6.85e+3 | 90.4 |  |
| moderator | NONE | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| moderator | GRAPHITE | yes | 0.705 | 0.945 | 0.620 | 0.746 | 0.000100 | -1.23 | -0.418 | 3.87 | 6.83e+3 | 88.2 |  |
| moderator | ZRH | yes | 0.747 | 1.01 | 0.672 | 0.737 | 0.000100 | -1.09 | -0.339 | 3.95 | 6.64e+3 | 86.2 |  |
| moderator | BEO | yes | 0.711 | 0.950 | 0.623 | 0.749 | 0.000100 | -1.21 | -0.406 | 3.89 | 6.77e+3 | 87.6 |  |
| reflector | BE | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| reflector | GRAPHITE | yes | 0.837 | 1.19 | 0.785 | 0.706 | 0.000100 | -0.869 | -0.194 | 3.84 | 6.77e+3 | 88.4 |  |
| reflector | BEO | yes | 0.856 | 1.19 | 0.785 | 0.722 | 0.000100 | -0.829 | -0.169 | 3.95 | 6.65e+3 | 86.8 |  |
| reflector | SS316L | yes | 0.862 | 1.19 | 0.785 | 0.727 | 0.000100 | -0.815 | -0.160 | 4.44 | 6.37e+3 | 79.4 |  |
| shield | W | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| shield | PB | yes | 0.875 | 1.19 | 0.785 | 0.738 | 0.000100 | -0.790 | -0.144 | 2.80 | 7.85e+3 | 103 |  |
| shield | BPE | yes | 0.867 | 1.19 | 0.785 | 0.731 | 0.000100 | -0.806 | -0.154 | 1.42 | 8.03e+3 | 125 |  |
| shield | SS316L | yes | 0.886 | 1.19 | 0.785 | 0.747 | 0.000100 | -0.767 | -0.129 | 2.36 | 7.59e+3 | 113 |  |
| shield | B4C | no | 1.01 | 1.19 | 0.785 | 0.850 | 0.000100 | -0.554 | 0.00700 | 1.63 | 8.19e+3 | 123 | rods-withdrawn reactivity 0.0070 is not subcritical: a source-driven steady state is undefined. |
| coolant | H2O | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| coolant | D2O | no | 0.00106 | 0.00106 | 0.000690 | 0.999 | 0.000100 | -1.48e+3 | -941 | 3.86 | 6.90e+3 | 88.6 | resonance escape p = 0.001 < 0.5: the core is not moderated enough for the thermal four-factor model (fast spectrum). |
| coolant | HE | no | 1.03 | 0.00 | 0.00 | Infinity | 0.000100 | -0.526 | 0.0319 | 3.80 | 7.04e+3 | 89.8 | rods-withdrawn reactivity 0.0319 is not subcritical: a source-driven steady state is undefined. |
| coolant | NA | no | 3.66e-86 | 3.66e-86 | 2.41e-86 | 1.00 | 0.000100 | -4.29e+85 | -2.73e+85 | 3.85 | 6.98e+3 | 88.8 | resonance escape p = 0.000 < 0.5: the core is not moderated enough for the thermal four-factor model (fast spectrum). |
| coolant | LBE | no | 4.72e-186 | 4.72e-186 | 3.08e-186 | 1.00 | 0.000100 | -3.33e+185 | -2.12e+185 | 4.38 | 6.70e+3 | 76.3 | resonance escape p = 0.000 < 0.5: the core is not moderated enough for the thermal four-factor model (fast spectrum). |
| coolant | FLIBE | no | 6.29e-15 | 6.29e-15 | 4.09e-15 | 1.00 | 0.000100 | -2.51e+14 | -1.59e+14 | 3.90 | 6.87e+3 | 87.7 | resonance escape p = 0.000 < 0.5: the core is not moderated enough for the thermal four-factor model (fast spectrum). |
| structure | SS316L | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| structure | IN718 | yes | 0.860 | 1.18 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.163 | 3.86 | 6.78e+3 | 88.5 |  |
| structure | TI64 | yes | 0.859 | 1.18 | 0.785 | 0.725 | 0.000100 | -0.821 | -0.164 | 3.71 | 6.85e+3 | 89.7 |  |
| te | BI2TE3 | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| te | PBTE | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| te | SIGE | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.82 | 6.79e+3 | 88.5 |  |
| absorber | B4C | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.819 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| absorber | HF | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.199 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| absorber | AGINCD | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -0.250 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |
| absorber | GD2O3 | yes | 0.860 | 1.19 | 0.785 | 0.726 | 0.000100 | -9.54 | -0.162 | 3.85 | 6.79e+3 | 88.5 |  |

## Scenario matrix (default design, seed 1)

| Scenario | Outcome | Trips | Accidents | P end (W) | T_fuel max (C) | Dose at surface (uSv/h) | Energy Th (J) | Energy E (J) |
|---|---|---|---|---|---|---|---|---|
| Nominal operation (10 pg Cf-252 start-up source) | RUNNING | - | - | 1.88e-9 | 25.00 | 0.367 | 0.00000345 | 2.08e-18 |
| Pump trip at 60 s | SCRAMMED | low_flow@64.25s | - | 3.72e-10 | 25.00 | 0.111 | 3.24e-7 | 2.18e-20 |
| Pump trip with 95 % channel blockage (loss of cooling) | DESTROYED | low_flow@2.750s | loss_of_cooling@91.75s | 1.94e-18 | 25.00 | 0.0512 | 3.98e-8 | 9.72e-22 |
| Source surge x1e4 for 60 s (overpower / dose) | DESTROYED | overpower@100.0s | dose_exceeded@100.0s | 1.81e-15 | 25.00 | 5.94 | 0.0000252 | 8.97e-17 |
| Shield breach to 20 % thickness (10 pg Cf-252 start-up source) | RUNNING | - | - | 1.88e-9 | 25.00 | 0.443 | 2.28e-7 | 1.87e-21 |
| Coolant over-temperature with SCRAM protection (2e11 n/s generator, thermal test) | SCRAMMED | temperature@4254s | - | 1.83e-12 | 57.92 | 1.36e+7 | 6.81e+4 | 762 |
| Coolant over-temperature with temperature trips disabled (2e11 n/s generator) | DESTROYED | - | coolant_overtemp@6593s | 3.18e-77 | 26.86 | 3.14e+6 | 1.05e+5 | 1.42e+3 |
| Operator manual SCRAM at 50 s | SCRAMMED | manual@50.00s | - | 3.72e-10 | 25.00 | 0.112 | 1.52e-7 | 2.35e-21 |
| Operator core kill at 50 s | DESTROYED | - | - | 5.06e-16 | 25.00 | 0.0519 | 9.57e-8 | 1.50e-21 |
| Truck vibration, SS316L mount, 6 mm x 20 mm | DESTROYED | fatigue@0.000s | structural_fatigue@0.000s | 1.34e-18 | 25.00 | 0.0512 | 5.28e-10 | 0.00 |
| Truck vibration, Ti-6Al-4V mount, 12 mm x 20 mm | RUNNING | - | - | 1.86e-9 | 25.00 | 0.366 | 0.00000114 | 1.68e-19 |
| Aircraft vibration, IN718 mount, 8 mm x 20 mm | DESTROYED | fatigue@0.000s | structural_fatigue@0.000s | 1.34e-18 | 25.00 | 0.0511 | 5.27e-10 | 0.00 |

## Vibration: mount diameter sweep (truck profile, L = 20 mm, 60 s)

| Structure | d (mm) | f_n (Hz) | z_rms (mm) | sigma_rms (MPa) | Yield (MPa) | Peak 3-sigma (MPa) | Predicted life (s) | Failed | First failure (s) |
|---|---|---|---|---|---|---|---|---|---|
| SS316L | 6 | 181.4 | 0.127 | 553.3 | 205.0 | 1660 | 0.0000854 | yes | 0.000 |
| SS316L | 8 | 322.5 | 0.0427 | 247.5 | 205.0 | 742.5 | 0.619 | yes | 0.000 |
| SS316L | 10 | 503.9 | 0.00869 | 62.91 | 205.0 | 188.7 | 3.95e+6 | no | - |
| SS316L | 12 | 725.7 | 0.00468 | 40.67 | 205.0 | 122.0 | 4.64e+8 | no | - |
| SS316L | 16 | 1290 | 0.00154 | 17.84 | 205.0 | 53.53 | 4.23e+12 | no | - |
| IN718 | 6 | 184.7 | 0.139 | 624.1 | 1035 | 1872 | 0.000508 | yes | 0.000 |
| IN718 | 8 | 328.3 | 0.0459 | 275.3 | 1035 | 826.0 | 69.4 | no | - |
| IN718 | 10 | 513.0 | 0.00944 | 70.77 | 1035 | 212.3 | 3.86e+10 | no | - |
| IN718 | 12 | 738.7 | 0.00507 | 45.67 | 1035 | 137.0 | 2.04e+13 | no | - |
| IN718 | 16 | 1313 | 0.00166 | 19.86 | 1035 | 59.58 | 3.47e+18 | no | - |
| TI64 | 6 | 139.4 | 0.211 | 542.3 | 880.0 | 1627 | 0.000319 | yes | 0.000 |
| TI64 | 8 | 247.9 | 0.0825 | 282.3 | 880.0 | 846.9 | 2.02 | yes | 2.000 |
| TI64 | 10 | 387.3 | 0.0302 | 129.2 | 880.0 | 387.7 | 9.10e+4 | no | - |
| TI64 | 12 | 557.7 | 0.00821 | 42.12 | 880.0 | 126.4 | 5.69e+11 | no | - |
| TI64 | 16 | 991.5 | 0.00296 | 20.25 | 880.0 | 60.75 | 1.12e+16 | no | - |

## Reliability: nominal case over 5 seeds

- Runs: 5
- Trips total: 0; accidents total: 0
- Thermal energy: mean 0.00000345 J, sd 4.74e-22 J
- Fuel max temperature: mean 25.000 C, sd 0.00 C

## Pump trip at 60 s by coolant

| Coolant | Outcome | Trips | Accidents |
|---|---|---|---|
| H2O | SCRAMMED | low_flow@64.25s | - |
| D2O | rejected: Configuration outside the validated model range: resonance escape p = 0.001 < 0.5: the core is not moderated enough for  | | |
| HE | rejected: Configuration outside the validated model range: rods-withdrawn reactivity 0.0319 is not subcritical: a source-driven st | | |
| NA | rejected: Configuration outside the validated model range: resonance escape p = 0.000 < 0.5: the core is not moderated enough for  | | |
| LBE | rejected: Configuration outside the validated model range: resonance escape p = 0.000 < 0.5: the core is not moderated enough for  | | |
| FLIBE | rejected: Configuration outside the validated model range: resonance escape p = 0.000 < 0.5: the core is not moderated enough for  | | |

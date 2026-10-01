# Surfel Integrator research modes

The browser exhibit in `Exhibits/Workbench/SurfelIntegrator/` exposes both the original estimator and a set of research-backed alternatives. At 100% density it uses the original 1,328-record count; the density control can vary this from approximately half to twice that count. The adaptive temporal experiment adds one `vec4` of statistics to each allocated record, but every mode uses the same preallocated maximum storage. The **Original preset** and **Recommended preset** buttons switch the algorithmic comparison in one click; density and support size stay fixed so the comparison remains fair.

## Why the original image is soft and uneven

The original resolver uses a normalized, fixed-radius weighted average. That estimator is stable, but it is a low-pass filter: every valid record inside a broad circular support contributes only a constant irradiance value. Irregular sample spacing then changes which records overlap each pixel, producing low-frequency spatial variation. Independent random hemisphere directions add another source of low-frequency error when only one ray is traced per record per update.

This diagnosis is consistent with surface-splatting reconstruction, irradiance-cache interpolation, and recent surfel GI systems: placement quality, well-distributed temporal samples, visibility-aware weights, and reconstruction order all matter in addition to ray count.

## Implemented comparisons

### Placement

- **Area stratified** is the original mode. One candidate per output record is selected through the triangle-area CDF.
- **Blue-noise best candidate** creates eight area-proportional candidates per output record, then selects a fixed-size maximin subset. Position and normal separation are both part of the selection metric. Its support radius is adapted from local nearest-neighbour spacing.

The two modes contain exactly the same number of records at a given density and use identically sized GPU buffers, making the comparison budget-neutral. At 100%, the explicitly covered ground is a 19 by 16 jittered lattice in both modes.

### Density and support size

**Surfel density** changes the actual number of records. Ball and ground counts scale together from about 50% to 200%. Base support radii and the spatial-hash cell size scale inversely with the square root of density, so increasing density adds spatial detail instead of merely adding more overlapping blur.

**Support size** multiplies each record's reconstruction radius without changing the count. The spatial hash is rebuilt at the matching scale, avoiding missing-neighbour artifacts. Smaller support preserves detail but can reveal holes and noise; larger support hides holes and flicker but blurs irradiance gradients and increases the chance of cross-surface leakage.

### Ray sequence

- With **Progressive rays** disabled, each update uses the original independent hash samples.
- With it enabled, every record receives its own hash rotation of a progressive two-dimensional R2 sequence, which is mapped to a cosine-weighted hemisphere. Successive one-ray updates therefore fill directional gaps instead of repeatedly clustering by chance.

This is a lightweight WebGPU adaptation of the well-distributed-prefix principle demonstrated by progressive multi-jittered and spatiotemporal blue-noise work. It is an R2 sequence, not a claim to implement the full PMJ or STBN algorithms.

### Reconstruction

- **Original soft** preserves the broad normalized weighted average.
- **Compact bilateral** uses a compact Wendland kernel with stronger normal agreement and tangent-plane checks. It reduces the long blur tail while retaining a nearest compatible fallback for small coverage gaps.
- **Gradient MLS** uses the same compact neighbourhood and fits a first-order irradiance model in the receiver's tangent plane. The value at the query point is obtained from a regularized 3 by 3 moving-least-squares system and clamped to the neighbourhood range to prevent ringing.

The MLS mode is the practical analogue of first-order irradiance-cache reconstruction: locally linear irradiance variation can survive interpolation instead of being collapsed to a constant average. In this particular one-ray, low-density field, the original soft mode is the recommended default: its bias suppresses residual record variance and coverage error better than the higher-order fit. MLS becomes more compelling after density and per-record sample quality are high enough that interpolation error dominates sampling error.

### Leak rejection

**Leak guard** adds the receiver tangent-plane test to the source tangent-plane test. It rejects records that are spatially near but belong to a displaced surface, both during bounce reuse and final resolve. This is intentionally a cheap comparison mode. It cannot replace the radial depth moments or explicit visibility used by GIBS, DDGI, and newer surfel systems, especially for thin geometry.

### Temporal integration

The stable path uses a running mean whose history now grows to 96 updates instead of stopping at 32, reducing the permanent one-ray update weight from about 3.1% to about 1%. **Adaptive temporal** additionally stores a short-term colour mean and luminance variance per record. Disagreement between the short and long means raises the update weight only when that disagreement is large relative to measured noise. This follows the dual-timescale, variance-aware idea behind the multi-scale mean estimator without presenting this compact implementation as the complete published MSME algorithm.

Progressive directions improve the distribution of the accumulated samples; they do not make each individual one-ray measurement temporally continuous. For this static exhibit, the recommended preset therefore keeps progressive rays but disables adaptive temporal integration. Pausing after convergence removes update flicker entirely.

## Primary references

- EA SEED, [Global Illumination Based on Surfels](https://www.ea.com/seed/news/siggraph21-global-illumination-surfels) and the [SIGGRAPH 2021 slide deck](https://media.contentapi.ea.com/content/dam/ea/seed/presentations/seed-siggraph21-surfel-gi.pdf): persistent surface records, spatial filtering, guided updates, and visibility data.
- Christensen, Kensler, and Kilpatrick, [Progressive Multi-Jittered Sample Sequences](https://graphics.pixar.com/library/ProgressiveMultiJitteredSampling/paper.pdf): sample sequences with well-distributed prefixes for progressive integration.
- Wolfe et al., [Spatiotemporal Blue Noise Masks](https://arxiv.org/pdf/2112.09629): moving sampling error away from objectionable low spatial and temporal frequencies.
- Ward and Heckbert's irradiance-gradient work, summarized in Jarosz, [Efficient Monte Carlo Methods for Light Transport in Scattering Media, Chapter 3](https://cs.dartmouth.edu/~wjarosz/publications/dissertation/chapter3.pdf): first-order rather than piecewise-constant irradiance interpolation.
- Majercik et al., [Dynamic Diffuse Global Illumination with Ray-Traced Irradiance Fields](https://www.jcgt.org/published/0008/02/01/paper-lowres.pdf): visibility-weighted interpolation and depth moments for leak suppression.
- Wang et al., [SurfelPlus](http://wangruipeng.com/SurfelPlus/): adaptive radius and allocation, shared local radiance, variance-aware integration, and coverage evaluation.
- Triglav, [Surfel-based global illumination on the web](https://juretriglav.si/surfel-based-global-illumination-on-the-web/): a current WebGPU implementation using dynamic coverage, spatial hashes, temporal estimation, and radial depth moments.

## Recommended configuration for this exhibit

At one ray per update, use **blue-noise placement**, **original soft reconstruction**, **progressive rays**, **leak guard on**, and **adaptive temporal off**. A useful quality-oriented starting point is 150% density with support near 0.9 to 1.1. Increase support only if holes or uneven patches remain; increase density when performance allows and sharper spatial detail is the goal.

## Remaining high-value work

For stronger leak suppression, add a small directional depth-moment atlas per surfel and apply its visibility estimate both to surfel-to-surfel reuse and pixel resolve. For dynamic scenes, combine the static world-space field with screen-visible surfel injection, lifecycle management, and coverage-driven allocation. Those are larger representation changes and are intentionally not hidden inside this fixed-budget A/B experiment.

# REPORT — Bevel / chamfer / fillet on any shape, without enumerating cases

🧩 How to replace SolidArc's configuration-enumerating blend solver with one
definition that covers every surface pair.

## TL;DR

SolidArc enumerates *configurations* (36 specification structs, 64 reconstructors,
48 vertex classifiers, 2,419 `if`s) instead of evaluating a *definition*, and its
general fallback is a brute-force search of 161 full NURBS booleans per edge.
Measured coverage is **Plane+Plane only** — every curved/curved pair refuses.
The fix is the standard rolling-ball formulation: offset both adjacent faces,
intersect the offsets to get a spine, sweep a section curve along it, graft.
One code path; cylinder, cone, torus and all the apex/partial/half-turn/reflex/G2
variants become *outputs*, not branches.

---

## 1. What the code does today

Measured against `SultanAladin/Frontier-` `arena/9440f4d0-frontier` (`33829386`),
`Editor/AuthoringTools/Modelling/SolidArc`.

| Metric | Value |
|---|---|
| `Kernel/BlendSolver.cpp` | 13,762 lines |
| `Kernel/BlendSolver.h` | 1,052 lines, 36 `*Specification` structs |
| `Reconstruct*` functions | 64 |
| `Classify*` functions | 48 |
| `if` statements in `BlendSolver.cpp` | 2,419 |
| Analytic dispatch branches at the top of `ChamferEdge` / `FilletEdge` | 10 / 8 |

### 1.1 Failure A — the dispatch ladder enumerates surface-pair × modifier

```cpp
Deliver<BrepBody> BlendSolver::ChamferEdge(const BrepBody& Body, int Edge, double SetBack) noexcept
{
    if (auto Cap  = NativeCylinderCap(Body, Edge))            return ChamferCylinderCap(*Cap, SetBack);
    if (auto Cap  = NativeConeCapEdge(Body, Edge))            return ChamferConeCap(*Cap, SetBack);
    if (auto Root = PlaneCylinderBossRoot(Body, Edge))        return ChamferPlaneCylinderBossRoot(*Root, SetBack);
    if (auto Root = PlaneConeBossRoot(Body, Edge))            return ChamferPlaneConeBossRoot(*Root, SetBack);
    if (auto Root = PlaneConeApexBossRoot(Body, Edge))        return ChamferPlaneConeApexBossRoot(*Root, SetBack);
    if (auto Root = PlaneConeApexPartialBossRoot(Body, Edge)) return ChamferPlaneConeApexPartialBossRoot(*Root, SetBack);
    if (auto Root = PlaneConePartialBossRoot(Body, Edge))     return ChamferPlaneConePartialBossRoot(*Root, SetBack);
    if (auto Root = ConeCylinderPartialBossRoot(Body, Edge))  return ChamferConeCylinderPartialBossRoot(*Root, SetBack);
    if (auto Root = ConeConePartialBossRoot(Body, Edge))      return ChamferConeConePartialBossRoot(*Root, SetBack);
    if (auto Root = CylinderConeBossRoot(Body, Edge))         return ChamferCylinderConeBossRoot(*Root, SetBack);
    // ...generic fallback
}
```

Each branch is a closed-form rebuild valid for exactly one
(surface A × surface B × modifier) triple. With 6 surface kinds the pair space is
21; with modifiers `{full, partial, half-turn, reflex, apex, unequal-radius,
unequal-setback, oblique, quadratic, G2, variable}` it is in the hundreds.
**The 36 spec structs are that cross-product written out by hand.** Adding a
surface kind multiplies the work; it does not extend a rule. That is the
"infinite conditions" the previous agent could not close.

### 1.2 Failure B — the general fallback is a parameter search, not a construction

When no analytic branch matches, `ChamferEdge` requires both faces planar and the
edge straight (`CornerFrameRefusal`), then runs:

```cpp
static const double Margins[]    = { -1e-8, -1e-7, ... 12.0 };   // 23 entries
static const double HalfWidths[] = { 0.55, 0.8, 1.2, 2.0, 3.0, 5.0, 8.0 };  // 7 entries
for (double Width : HalfWidths)
    for (double Margin : Margins) {
        Cutter = CornerCutter(...);
        Cut    = IntersectionSolver::Combine(Body, Cutter, Subtract);   // full NURBS boolean
        Error  = |Cut.Volume − Target|;                                  // score vs closed form
        keep the best;
    }
if (Best && BestError <= 3e-6) return Best;
```

It builds the answer **161 times** and keeps whichever volume lands nearest the
analytic target. Instrumented count (`Exhibits/BlendCoverage/Results/count.log`):

| Case | Cutter candidates evaluated | Wall clock | Result |
|---|---|---|---|
| Box edge, chamfer | **161** | 218 ms | accept |
| Box edge, fillet | **161** | 222 ms | accept |
| Box edge, chamfer, s=0.020 | **161** | 553 ms | accept |
| Box edge, chamfer, s=0.029 | **161** | 172 ms | accept |

161 on *every* edge, *every* time — the loop has no early exit.

### 1.3 Cost

| Operation | Time | Route |
|---|---|---|
| One boolean subtract (box − cylinder) | 8.1 ms | `IntersectionSolver` |
| Box edge, chamfer | 197–265 ms | generic 161-candidate ladder |
| Box edge, fillet | 202–256 ms | generic 161-candidate ladder |
| Cylinder cap, chamfer | **1.7–1.8 ms** | analytic `ChamferCylinderCap` |
| Box-with-through-bore, 15 edges | **99.1 s** (≈6.6 s/edge) | generic ladder on a complex body |

The analytic path is ~**120× faster** than the general one, and the general one's
cost scales with body complexity × 161. `Box+Sphere(union)` and a capped `Loft`
exceed a 15-minute budget entirely.

### 1.4 Coverage — the decisive number

Every 2-coedge edge of Box, Cylinder, Cone, Sphere, Torus and Box−Cylinder,
chamfer and fillet at 4 mm (`Exhibits/BlendCoverage/Results/coverage.log`):

| Adjacent surface pair | Chamfer ✔️ / ✖ | Fillet ✔️ / ✖ | Dominant refusal |
|---|---|---|---|
| Plane+Plane | 21 / 3 | 21 / 3 | `no cutter placement reached the exact chamfer tolerance` |
| Plane+Cylinder | 2 / 2 | 2 / 2 | `edge is degenerate (zero length)` |
| Plane+Cone | 2 / 0 | 0 / 2 | `edge is degenerate (zero length)` |
| Cylinder+Cylinder | 0 / 2 | 0 / 2 | `edge has invalid adjacent faces` |
| Cone+Cone | 0 / 1 | 0 / 1 | `edge has invalid adjacent faces` |
| Sphere+Sphere | 0 / 1 | 0 / 1 | `edge is not straight (blend of a curved edge is not supported)` |
| Torus+Torus | 0 / 2 | 0 / 2 | `edge is degenerate (zero length)` |
| **Total** | **25 / 36 (69.4 %)** | **23 / 36 (63.9 %)** | |

Reading it correctly: the 69 % is almost entirely Plane+Plane box edges.
**Every pair involving a curved surface is effectively unsupported** except where
one of the 10 hand-written analytic branches happens to match — and those only
match native cylinder/cone *caps* and *boss roots*, not general geometry.
The 3 Plane+Plane refusals are the concave bore floor: the ladder's 161 magic
constants simply did not contain a winner, so the operation is refused.

📝 `Kernel/CornerFrameRefusal` states the limit outright: *"blend requires both
adjacent faces to be planar"*, *"edge is not straight (blend of a curved edge is
not supported)"*. The general path cannot round any curved edge at all.

### 1.5 Bonus finding — the build gate is stale

`Tools/Build/CheckSolidArc.sh` fails at link: its `Core=(...)` list omits 11
translation units (`Kernel/CapRimBlend.cpp`, `FaceEditSolver.cpp`, `TweakSolver.cpp`,
`SurfaceOffsetSolver.cpp`, `Presentation/GpuPickingRaster.cpp`,
`Console/ConsoleBevel.cpp`, plus the ImGui `Editor/*` set). Adding the seven
non-ImGui ones links cleanly. The "dependency-free repository gate" does not
currently gate anything.

---

## 2. The definition that has no cases

A blend is one sentence:

> The fillet of edge set `E` with radius `r` is the boundary of the region swept by
> a ball of radius `r` rolling in contact with the body along `E`.

Written as a construction, for edge `e` between faces `S₁` and `S₂`:

```
Offset    O₁ = OffsetSurface(S₁, −r)      // inward, material side
          O₂ = OffsetSurface(S₂, −r)
Spine     σ  = O₁ ∩ O₂                    // SSI — the rolling ball's centre path
Link      L₁(t) = σ(t) − r·n₁(t)          // ball↔S₁ contact curve
          L₂(t) = σ(t) − r·n₂(t)          // ball↔S₂ contact curve
Roll      R  = Sweep(σ, section)          // section = circular arc → fillet
                                          //          straight line → chamfer
                                          //          G2 arc        → G2 fillet
                                          //          conic         → conic fillet
Graft     split S₁ at L₁, split S₂ at L₂, drop the strip between e and the links,
          stitch R into the gap
```

**Zero cases.** The geometry changes with the input; the code does not.

💡 The cylinder and torus "special cases" *fall out of the formula*: a straight
spine with a constant-radius circular section is exactly a cylinder, a circular
spine is exactly a torus. They are results, not branches.

### 2.1 Chamfer is the same algorithm with a different section curve

Both operations share the spine and the link curves; only the swept section differs:

| Operation | Section curve swept along σ | Metric view |
|---|---|---|
| Fillet | circular arc, radius r | ball in **L2** |
| Chamfer | straight line between L₁ and L₂ | ball in **L∞** |
| Conic fillet | conic arc, ρ parameter | ball in a weighted norm |
| G2 fillet | curvature-continuous arc | L2 with a fairness term |

This is why the file's own `QuadraticRadiusLaw`, `G2RollingBallProfile` and
`VariableRadiusSurface` types should survive — they are *section curves and radius
laws*, i.e. parameters to one sweep, not separate operations.

📝 Fully general statement, worth keeping as the correctness oracle:
`Fillet(E, r) = (Body ⊖ Ball_r) ⊕ Ball_r` (morphological closing).
Definitional and case-free, but general Minkowski on B-reps is hard — so implement
the rolling-ball construction above and *check* it against this identity.

### 2.2 Vertices: one closure rule replaces 48 classifiers

The 48 `Classify*Vertex` functions and 36 spec structs exist to answer "what
happens where 3+ blended edges meet?". The general answer:

> At vertex `V` with incident faces `F₁…Fₙ`, the corner ball centre `C` is the point
> at distance `r` from every offset surface `Oᵢ`:
> `dist(C, Oᵢ) = r,  i = 1…n`. Solve with Newton. Trim each incident roll at its
> intersection with its neighbours and stitch the corner patch.

Three planes → the classic tangent sphere. Three cones → the same Newton system
with different surfaces in it. **The entire `ConeApex / BiconeApex / HalfTurn /
Reflex / UnequalSetback / Partial` zoo is this one system with different inputs.**

### 2.3 What genuinely varies — and it is topology, not surface type

Only adjacency branches, and it is a small closed set:

| Varies | Values | Handling |
|---|---|---|
| Chain shape | open / closed loop | `TangentChain` already exists |
| Vertex degree in the selected-edge graph | 1 end / 2 pass-through / ≥3 corner | end cap / mitre / corner patch |
| Roll runs off the face | yes / no | propagate along the tangent chain, or trim at the boundary |
| Spine curvature radius < r | yes / no | **honest refusal** — the roll self-intersects |

That is ~6 rules, against 2,419 `if`s.

---

## 3. Options considered

| Option | Coverage | Exactness | Cost/edge | Code change | Verdict |
|---|---|---|---|---|---|
| Keep adding analytic branches | ❌ grows forever | ✔️ exact | ~2 ms | unbounded | 🔴 rejected |
| Keep the 161-candidate ladder | ❌ planar, straight only | 🚩 volume-scored | 200 ms–6.6 s | — | 🔴 rejected |
| Embed OCCT as the blend worker | ✔️ full | ✔️ exact | low | dependency + ABI bridge | 🚩 viable but see below |
| **Rolling-ball spine + sweep graft** | ✔️ any transversal pair | ✔️ exact by construction | ~10–20 ms | ~1.5–2 kLOC net | ⭐ **recommended** |
| Rolling-ball + keep analytics as fast paths | ✔️ full | ✔️ exact | ~2 ms on quadrics | ⭐ + small | ⭐ **recommended end state** |

💡 The repo already ships `Kernel/OptionalOcctBlend.h` — an out-of-process OCCT
worker, gated on `SOLIDARC_OCCT_BLEND_HOST`, and only invoked when a face is a
`Sphere`. It is a proof that the case-enumeration approach had already run out of
road. Recommend **not** adopting OCCT as the primary route: it adds a heavy
dependency, an external process and a JSON NURBS bridge, and it would leave the
engine unable to blend its own geometry. Keep it as a *differential test oracle*
against the new native path instead — that is high value and near free.

---

## 4. Proposed build order

| Phase | Step | Produces | Gate |
|---|---|---|---|
| **A** | Fix `CheckSolidArc.sh` `Core=(...)` list | a gate that links | gate exits 0 |
| **A** | Land `Exhibits/BlendCoverage` as the regression baseline | accept/refuse + ms per surface pair | committed log |
| **A** | Freeze the `*Specification` structs — no new corner types | stops the bleeding | review rule |
| **B1** | `OffsetSurface(NurbsSurface, d)` — exact for Plane/Cylinder/Cone/Sphere/Torus, bounded-tolerance NURBS otherwise | generalise existing `SurfaceOffsetSolver` | offset volume + distance checks |
| **B2** | `BlendSpine(Body, Edge, size)` = `O₁ ∩ O₂` | reuses `IntersectionSolver` SSI | spine lies on both offsets to 1e-12 |
| **B3** | `RollingSurface(Spine, RadiusLaw, Section)` | canal / ruled / conic / G2 sweep | exact cylinder+torus for those spines |
| **B4** | `LinkCurves(...)` — project σ onto S₁,S₂ along their normals | contact curves | `|Lᵢ − σ| = r` and `Lᵢ` on `Sᵢ` |
| **B5** | `GraftBlend(...)` — split faces at links, drop the strip, stitch | reuse `IntersectionSolver`'s arrangement machinery, not hand-built loops | `Validate().Solid()` |
| **C1** | `CornerBall(Body, Vertex, r)` — Newton on `dist(C,Oᵢ)=r` | replaces 48 classifiers | residual < 1e-12 on 3-plane and 3-cone vertices |
| **C2** | `CornerPatch(...)` — n-sided Coons/Gregory, `FairPatchSolver` as a base | closes ≥3-way junctions | closed + manifold + oriented |
| **C3** | Retire the spec structs and classifiers once parity is proven | ~12 kLOC deleted | full `Verification/` corpus green |
| **D** | Keep the analytic routes **as fast paths only**, behind an equivalence test vs the general path | 1.7 ms on native cylinder/cone caps | equivalence on every verification fixture |
| **D** | Delete the 161-candidate ladder | — | no regression in the coverage matrix |

---

## 5. Expected payoff

| | Today | Target |
|---|---|---|
| Blend code size | 13,762 + 1,052 lines | ~1,500–2,000 lines |
| Surface pairs covered | Plane+Plane (plus 10 hand-matched quadric caps) | any transversal pair |
| Fillet on a curved edge | refused | supported |
| Cost per edge | 200 ms – 6.6 s | ~2 ms (quadric fast path) / ~10–20 ms (general) |
| Correctness argument | volume scored against a closed form | G1 by construction |
| Failure mode | silent refusal on unenumerated geometry | honest geometric refusal (radius too large) |

---

## 6. Risks to name honestly

| Risk | Why it bites | Mitigation |
|---|---|---|
| Spine SSI must be transversal | `IntersectionSolver` already refuses non-transversal | inherit the refusal; it is a real limit, not a gap |
| Offset surfaces self-intersect when r > local feature size | classic; breaks the spine | compute offset self-intersection first; refuse above the limit |
| Link curves leave the face | the roll runs onto a third face | propagate along the tangent chain, or trim at the boundary — the one place adjacency genuinely matters |
| Free-form offsets are approximations | NURBS offset is not exact | state the tolerance; it is a *modelling* tolerance, not a solver fudge |
| Graft must not break manifoldness | hand-built loops are what broke the old `BrepBody::ChamferEdge` | reuse the boolean's arrangement/split path; assert `Validate().Solid()` |

---

## 7. Naming note for the port

📝 Per `EngineDocs/AgenticInstuctions/SKILL-Naming.md`: `Kernel`, `Graph`, `Frame`,
`Node`, `Handler`, `Module` are banned; `DraughtingWorkspace` is the approved
alternative to `Cad`/`CAD` for a workspace name. The SolidArc tree to be ported
uses `Kernel/`, `BlendSolver`, `EdgeCornerFrame`, `ConstraintGraph` throughout.
Plan the rename into the port rather than importing the violations and auditing later.

---

## 8. Evidence

| Item | Path |
|---|---|
| Coverage matrix, timing, cutter-count logs | `Exhibits/BlendCoverage/Results/` |
| Generating programs + reproduce commands | `Exhibits/BlendCoverage/Code/`, `Exhibits/BlendCoverage/README.md` |
| Subject under measurement | `SultanAladin/Frontier-` `arena/9440f4d0-frontier` (`33829386`), `Editor/AuthoringTools/Modelling/SolidArc` |

**Not verified:** Windows/MSVC behaviour, GPU/Vulkan rendering, and any claim
about the interactive editor's appearance. All numbers above are Linux `g++ -O2`,
CPU only.

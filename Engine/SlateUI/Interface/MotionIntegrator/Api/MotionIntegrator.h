//============================================================================================================================================
//                                                           MOTIONINTEGRATOR.H
//============================================================================================================================================
// 🧩 Time-sampled interpolants that retire themselves — and report, once per tick, whether anything still moves.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE INTERPOLANTS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 A damped spring toward a declared target — the drawer snap and the tongue release.
/// note  📐 Integrated semi-implicitly rather than by the analytic solution, because the target moves while
///       a drag is live and the analytic form would have to be re-derived on every tick it moved.
/// tag   contract, nonallocating, nonthrowing
struct SpringInterpolant
{
    double  Standing   = 0.0;     // [px] - where it is now
    double  Target     = 0.0;     // [px] - where it is heading
    double  Rate       = 0.0;     // [px/ms] - how fast, signed
    double  Stiffness  = 350.0;   // [-]
    double  Damping    = 35.0;    // [-]
    bool    Settled    = true;    // [-]  - both criteria met; the caller may stop advancing it

    /// 🧩 Advances one host interval and reports whether it still moves.
    /// in    Elapsed  [ms]  measured between this tick and the last
    /// out   Moving   [-]   false once displacement and rate are both below their criteria
    /// note  📐 Settling is two-sided. Displacement alone retires a spring at the apex of its overshoot, and
    ///       the artist sees the drawer stop a few pixels past where it belongs and stay there.
    /// cost  ✔️
    bool Advance(double Elapsed);

    /// 🧩 Places it at an ordinate immediately, discarding any motion.
    /// cost  ✔️
    void Seat(double Ordinate);
};

/// 🧩 A cubic-eased traverse from one ordinate to another over a declared duration.
/// note  The source's default easing is the cubic Bézier (0.4, 0, 0.2, 1) — Material's standard curve — and
///       every `transition-colors` and accordion height uses it at 150 ms.
/// tag   contract, nonallocating, nonthrowing
// 🧩 Which cubic the traverse is shaped by. Two, because the source declares two and no more.
/// tag   contract
enum class EaseCurve : std::uint32_t
{
    Standard   = 0u,   // [-] - cubic-bezier(0.4, 0, 0.2, 1); colour and accordion transitions
    Departing  = 1u,   // [-] - cubic-bezier(0, 0, 0.58, 1); card arrival
    Carousel   = 2u,   // [-] - cubic-bezier(0.5, 0.05, 0.2, 1); inspector page travel
    CssEase    = 3u,   // [-] - cubic-bezier(0.25, 0.1, 0.25, 1); an unspecified CSS transition
    CurveCount = 4u
};

struct EasedInterpolant
{
    double  Departed  = 0.0;     // [-]  - where the traverse began
    double  Arriving  = 0.0;     // [-]  - where it ends
    double  Elapsed   = 0.0;     // [ms] - how far through it is
    double  Duration  = 150.0;   // [ms] - the whole traverse
    double  Deferral  = 0.0;     // [ms] - held before it begins; the card arrival stagger
    EaseCurve Shape   = EaseCurve::Standard;   // [-]
    bool    Settled   = true;    // [-]

    bool   Advance(double Interval);
    double Standing() const;
    void   Depart(double From, double To, double Over, double Held = 0.0,
                  EaseCurve Declared = EaseCurve::Standard);
    void   Seat(double Ordinate);
};

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE SWEEP
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Whether anything in the interface is still moving — the one question the wake rule asks.
/// note  🔴 ⏱️ The genuine idle mechanism is not skipping layout, it is not waking at all. Under FIFO pacing
///       `DisplayScheduler` will otherwise present sixty identical images a second forever, and a UI that
///       re-presents an unchanged image is not idle no matter how little it recomputed.
/// tag   owning
class MotionIntegrator
{
public:

    static constexpr std::uint32_t InterpolantCapacity = 512u;   // [-] - live interpolants, never allocated

    MotionIntegrator()                                   = default;
    MotionIntegrator(const MotionIntegrator&)            = delete;
    MotionIntegrator& operator=(const MotionIntegrator&) = delete;
    ~MotionIntegrator()                                  = default;

    /// 🧩 Enrols a spring and delivers the ordinal the caller advances it by.
    /// out   Deliver  [-]  refuses with ExtentExhausted when the capacity is full
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<std::uint32_t> EnrolSpring(const MotionScale& Motion, double Seated);

    /// 🧩 Enrols an eased traverse and delivers its ordinal.
    /// out   Deliver  [-]  refuses with ExtentExhausted when the capacity is full
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    Deliver<std::uint32_t> EnrolEased(double Seated);

    /// 🧩 The enrolled spring at one ordinal, for the caller to read and re-target.
    /// pre   the ordinal was delivered by EnrolSpring
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    SpringInterpolant& Spring(std::uint32_t Ordinal);

    /// 🧩 The enrolled spring at one ordinal, for a caller that only reads it.
    /// note  🔴 Exists so that `DrawerSpace::StandingOrdinate` and `Moving` — both const, both read-only —
    ///       need no const_cast. A cast that removes constness to reach a read is a cast that will one day
    ///       be copied to reach a write.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const SpringInterpolant& Spring(std::uint32_t Ordinal) const;

    /// 🧩 The enrolled eased traverse at one ordinal.
    /// pre   the ordinal was delivered by EnrolEased
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    EasedInterpolant& Eased(std::uint32_t Ordinal);
    const EasedInterpolant& Eased(std::uint32_t Ordinal) const;

    /// 🧩 Advances every enrolled interpolant by one host interval.
    /// in    Elapsed  [ms]  what `TickSequence::Span` measured between this tick and the last
    /// out   Moving   [-]   false when every interpolant has settled — the caller may then block
    /// note  ⏱️ Sampled against elapsed host time and never against a rotation count. A rotation-counted
    ///       animation runs at a different speed on a 144 Hz display, which is the defect `04` §3's arrival
    ///       stamping exists to prevent, one layer up.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Advance(double Elapsed);

    /// 🧩 Whether anything moved on the last Advance, without advancing again.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Moving() const;

private:

    SpringInterpolant  Springs[InterpolantCapacity] = {};   // [-]
    EasedInterpolant   Eases[InterpolantCapacity]   = {};   // [-]
    std::uint32_t      SpringCount                  = 0u;   // [-]
    std::uint32_t      EaseCount                    = 0u;   // [-]
    bool               AnythingMoving               = false;// [-]
};

}   // namespace Slate

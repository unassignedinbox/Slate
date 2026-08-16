//============================================================================================================================================
//                                                            HOSTLIFECYCLE.H
//============================================================================================================================================
// 🧩 The five nested lifetimes every host owns — constructed in one order, recovered once, unwound in reverse.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateMath/Platform/TickSequence/Api/TickSequence.h"
#include "SlateMath/Platform/WindowInterchange/Api/WindowInterchange.h"
#include "SlateVulkan/Device/CommandSequence/Api/CommandSequence.h"
#include "SlateVulkan/Device/CycleScheduler/Api/CycleScheduler.h"
#include "SlateVulkan/Device/DiagnosticExtension/Api/DiagnosticExtension.h"
#include "SlateVulkan/Device/DisplayScheduler/Api/DisplayScheduler.h"
#include "SlateVulkan/Device/VulkanExchange/Api/VulkanExchange.h"

#include <cstdint>

namespace Slate
{

// 📝 ⚠️ `Lifecycle` is not one of the nineteen closed role suffixes in `SKILL-Naming.md`. The spelling is
//    declared here deliberately rather than by oversight: it is the name the project asked for, and the
//    mechanism it states — a span with a construction and a matching destruction — is the one thing the
//    closed list has no entry for. Recorded so that a reader finds a decision here rather than a drift.

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE FIVE LIFETIMES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 How long one owned resource stands before something must reclaim it.
/// note  🔴 The ordinals are the construction order, and the reverse is the reclamation order. A device is
///        reclaimed only after every display resource inside it, and a display only after every recording
///        that may still be reading one of its images. Reversing that is a use-after-free the validation
///        layer reports as a destroyed-object access, several frames after the call that caused it.
/// note  A recovery reclaims a suffix of this enumeration and never a subset from the middle. Device loss
///        retires Device and everything after it; a resize retires Display and everything after it.
/// tag   contract
enum class ResourceLifetime : std::uint32_t
{
    Host          = 0u,   // [-] - the window, the instance, the timeline; retired only at exit
    Device        = 1u,   // [-] - the logical device and the diagnostic attachment
    Display       = 2u,   // [-] - the presentation chain and its images
    Recording     = 3u,   // [-] - the cyclic slots and the command recordings
    InterfaceTick = 4u,   // [-] - one tick of interface content; retired every tick
    LifetimeCount = 5u    // [-] - the closed count, never a lifetime
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT A HOST DECLARES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Everything a host states once, before anything is constructed.
/// tag   contract, nonallocating, nonthrowing
struct HostDeclaration
{
    const char*    Naming        = "Host";     // [-]  - static text; names this host in every report
    const char*    WindowCaption = "Slate";    // [-]  - static text
    std::uint32_t  InitialWidth  = 1280u;      // [px]
    std::uint32_t  InitialHeight =  720u;      // [px]
    bool           DiagnosticRequested = false;// [-]  - the vendor's validation layers
    LatencyIntent  Pacing        = LatencyIntent::SteadyPacing;   // [-]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  WHAT THE DEVICE OFFERS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every device handle a layer above this one needs in order to attach to what was constructed.
/// note  🔴 Declared here rather than reached for from `SlateUI`. `InterfaceAttachment` is the same set of
///        handles, but it lives one layer up, and a component in `SlateVulkan` that included it would
///        invert the dependency partition — the compiler refused exactly that, which is the partition
///        working. A host copies the eight members across; the copy is the seam.
/// note  ⚠️ The image counts are restated on every display recovery, so a reader that took a copy before a
///        resize holds two figures the chain no longer has.
/// tag   contract, nonallocating, nonthrowing
struct DeviceOffering
{
    VkInstance        Instance                 = VK_NULL_HANDLE;         // [-]
    VkPhysicalDevice  ScoredDevice             = VK_NULL_HANDLE;         // [-]
    VkDevice          ActiveDevice             = VK_NULL_HANDLE;         // [-]
    VkQueue           GraphicsQueue            = VK_NULL_HANDLE;         // [-]
    std::uint32_t     GraphicsFamilyOrdinal    = 0u;                     // [-]
    VkFormat          ColourTargetFormat       = VK_FORMAT_UNDEFINED;    // [-]
    std::uint32_t     MinimumDisplayImageCount = 0u;                     // [-]
    std::uint32_t     DisplayImageCount        = 0u;                     // [-]
    void*             NativeWindowSlot         = nullptr;                // [-]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    WHAT ONE TICK CARRIES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What `Await` decided about this tick before any content was built.
/// note  🔴 A host reads `Standing` and nothing else to decide whether to record. `Withdrawn` is not an
///        error — it is the ordinary answer on a minimised window, a resized chain, or a tick the vendor
///        declined — and a host that treats it as one exits on the first resize.
/// tag   contract
enum class TickStanding : std::uint32_t
{
    Recording     = 0u,   // [-] - an image is acquired and a recording is open; the host must record
    Withdrawn     = 1u,   // [-] - nothing was acquired; the host records nothing and asks again
    Closed        = 2u,   // [-] - the window was closed, or the device was lost beyond recovery
    StandingCount = 3u    // [-] - the closed count, never a standing
};

/// 🧩 One tick's arrangement, valid only until `Surrender` or the next `Await`.
/// note  ⚠️ `Recording` is a vendor handle and is deliberately the only one that crosses. A host records
///        into it through the interface seam; nothing here hands out the device, the chain or the slots.
/// tag   contract, nonallocating, nonthrowing
struct TickPass
{
    TickStanding     Standing        = TickStanding::Withdrawn;   // [-]
    VkCommandBuffer  Recording       = VK_NULL_HANDLE;            // [-]  - inside a dynamic rendering scope
    double           ElapsedMilliseconds = 0.0;                   // [ms] - since the previous tick
    std::uint32_t    ExtentAlong     = 0u;                        // [px] - the drawable extent this tick
    std::uint32_t    ExtentAcross    = 0u;                        // [px]
    bool             DisplayAltered  = false;                     // [-]  - the chain was re-established
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Constructs the five lifetimes in `32` §1's order, recovers them, and unwinds them in the exact reverse.
/// note  🔴 This component exists because three hosts had written the same bring-up, the same recovery and
///        the same teardown, and the three copies had drifted. `PaintHost` never tested `ExtentAltered`, so
///        resizing did nothing until the vendor refused; it left the tick loop on a refused present rather
///        than re-establishing the chain; and it opened its command recording **before** building the
///        interface tick, so five of its escape paths returned to the top of the loop with a command buffer
///        still recording and a display image still acquired. `EditorHost` had none of those, and the only
///        thing separating them was which copy a reader happened to edit.
/// note  🔴 ⏱️ The ordering that prevents the whole class of defect is stated once, here: **every refusal
///        that can occur is resolved before the display image is acquired**. After `Await` reports
///        `Recording`, there is no path in this component that returns without submitting — so a host
///        cannot leave a recording open, because it never holds one across a decision.
/// note  ⚠️ A host owns its own content and this component owns none of it. What crosses is a command
///        recording already inside a rendering scope; what does not cross is the device, the chain, the
///        cyclic slots, or any means of reaching them.
/// tag   owning
class HostLifecycle
{
public:

    HostLifecycle()                                = default;
    HostLifecycle(const HostLifecycle&)            = delete;
    HostLifecycle& operator=(const HostLifecycle&) = delete;
    ~HostLifecycle();

    /// 🧩 Constructs Host, Device, Display and Recording in `32` §1's declared order.
    /// in    Declared  [-]  what the host states once; the naming is retained for every report
    /// out   Deliver   [-]  refuses at the first stage that declines, naming it, having reclaimed whatever
    ///                      earlier stages had already constructed
    /// note  🔴 A partial construction is never delivered. Every refusal path unwinds what it built, so a
    ///        host that checks the delivery and returns leaks nothing.
    /// post  on delivery, `Interface` carries every handle the interface seam needs
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<bool> Construct(const HostDeclaration& Declared);

    /// 🧩 Opens one tick — drains input, recovers the display if it moved, acquires an image, and opens a
    ///    recording inside a rendering scope over it.
    /// in    ClearInk  [-]  what the colour target is cleared to, as four unit ordinates
    /// out   Pass      [-]  `Recording` when the host must record, `Withdrawn` when it must not, `Closed`
    ///                      when the loop must end
    /// note  🔴 Every refusal is resolved **before** the image is acquired. That ordering is the whole of
    ///        the resize defect: nothing after the acquire can decline, so nothing after it can return.
    /// note  ⚠️ A `Withdrawn` tick has acquired nothing and opened nothing. Calling `Surrender` after one
    ///        is refused rather than submitting an empty recording.
    /// cost  🚩
    /// tag   api, nonthrowing
    TickPass Await(const float ClearInk[4]);

    /// 🧩 Closes the rendering scope, submits the recording, presents, and advances the cycle.
    /// out   Deliver  [-]  refuses when no tick stands recording; a refused present is recovered here and
    ///                     is not reported as a refusal
    /// note  🔴 A refused present re-establishes the chain rather than ending the loop. It is the ordinary
    ///        answer to a resize that arrived between the acquire and the present.
    /// post  no recording is open; the next Await may proceed
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Surrender();

    /// 🧩 Whether the host should keep ticking.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Standing() const;

    /// 🧩 Every device handle a layer above needs, filled from what was constructed.
    /// note  The image counts are restated on every display recovery, so a host that reads this after a
    ///       resize sees the counts the chain actually holds.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    DeviceOffering Offering() const;

    /// 🧩 The window, for a host that needs the native handle or the closure condition.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    WindowInterchange&       Window();
    const WindowInterchange& Window() const;

    /// 🧩 The timeline every duration in this process is measured against.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const TickSequence& Timeline() const;

    /// 🧩 Whether a display recovery happened since the host last asked, and clears the record of it.
    /// use   A host calls this to renegotiate its own display-sized content exactly once per recovery.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool DisplayRecovered();

    /// 🧩 Reclaims every lifetime at or beyond the declared one, in reverse construction order.
    /// in    From     [-]  the earliest lifetime to retire; everything after it is retired first
    /// note  🔴 Waits for the device to go idle before retiring anything device-side. A chain reclaimed
    ///        while a recording still reads one of its images is a use-after-free the validation layer
    ///        reports several frames later, against a call that has already returned.
    /// cost  🔴
    /// tag   api, nonthrowing
    void Reclaim(ResourceLifetime From = ResourceLifetime::Host);

private:

    Deliver<bool> EstablishDisplay(std::uint32_t Width, std::uint32_t Height);
    bool          RecoverDisplay();

    HostDeclaration      Declared          = {};               // [-] - as stated, never re-read
    TickSequence         Clock             = {};               // [-] - Host lifetime
    WindowInterchange    Surface           = {};               // [-] - Host lifetime
    VulkanExchange       DeviceEdge        = {};               // [-] - Host, then Device
    ReportSequence       DiagnosticRegister= {};               // [-] - Device lifetime
    DiagnosticExtension  DiagnosticEdge    = {};               // [-] - Device lifetime
    DisplayScheduler     DisplayChain      = {};               // [-] - Display lifetime
    CycleScheduler       Cycle             = {};               // [-] - Recording lifetime
    CommandSequence      Commands          = {};               // [-] - Recording lifetime

    VkSurfaceKHR         PresentationSurface = VK_NULL_HANDLE; // [-] - Host lifetime, after the instance
    TickPoint            PreviousTick      = {};               // [-]
    ArrivedImage         AcquiredImage     = {};               // [-] - valid only while a tick records
    std::uint32_t        SlotOrdinal       = 0u;               // [-] - the cycle slot this tick took
    VkCommandBuffer      OpenRecording     = VK_NULL_HANDLE;   // [-] - non-null only between Await and Surrender
    bool                 TickRecording     = false;            // [-] - a tick stands at TickStanding::Recording
    bool                 DisplayAltered    = false;            // [-] - a recovery the host has not adopted
    bool                 LoopStanding      = false;            // [-] - false once the window closed
    ResourceLifetime     Constructed       = ResourceLifetime::Host;   // [-] - how far bring-up reached
};

}   // namespace Slate

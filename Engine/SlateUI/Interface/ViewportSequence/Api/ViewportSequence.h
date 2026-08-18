//============================================================================================================================================
//                                                          VIEWPORTSEQUENCE.H
//============================================================================================================================================
// 🧩 One tick of the interface — springs, drawers, and the assembled recording, shared by every host.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/DrawerSpace/Api/DrawerSpace.h"
#include "SlateUI/Interface/InterfaceExchange/Api/InterfaceExchange.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"
#include "SlateUI/Interface/RedrawScheduler/Api/RedrawScheduler.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 One tick of the interface — the springs, the two drawers, and the assembled recording that a host
///    submits into its own command buffer.
/// note  🔴 The host owns the Vulkan bring-up and the command buffer submission. This component owns the
///       interface context, the spring physics, the drawer arrangement, and the redraw marks. The split
///       is what keeps hosts free of ImGui spelling and keeps this component free of Vulkan submission.
/// note  ⚠️ Panels record their content between the drawer bodies and the seal. The host calls
///       `DrawerPanels` to enter that window, then records panel content through `Surface`, then calls
///       `SealPanels` to close it. The sequence records the drawer chrome itself; the panels record
///       inside.
/// tag   owning
class ViewportSequence
{
public:

    ViewportSequence()                                  = default;
    ViewportSequence(const ViewportSequence&)            = delete;
    ViewportSequence& operator=(const ViewportSequence&) = delete;
    ~ViewportSequence()                                 = default;

    /// 🧩 Constructs the interface context and both drawers over the supplied device handles.
    /// in    Arriving [-]  the device handles and the window the interface reads from
    /// in    North    [-]  what the upper drawer's tongue carries
    /// in    South    [-]  what the lower drawer's tongue carries
    /// out   Deliver  [-]  refuses with CapabilityAbsent when no interface context is current, and with
    ///                     ExtentExhausted when the integrator declines a drawer spring
    /// post  both drawers stand Closed and settled; nothing moves until a pointer arrives
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<bool> Construct(const InterfaceAttachment& Arriving,
                            const DrawerDeclaration&   North,
                            const DrawerDeclaration&   South);

    /// 🧩 Opens one interface tick, resolves the appearance, and drives the spring physics.
    /// in    ElapsedMilliseconds  [-]  what `TickSequence::Span` measured between this tick and the last
    /// out   Deliver              [-]  refuses when no context is constructed, or when a tick is already open
    /// post  the drawers have advanced; the surface is ready to record into
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<bool> Advance(double ElapsedMilliseconds);

    /// 🧩 Records the drawer chrome — bodies, edges, grips and tongues.
    /// note  Panels must not record before this call. The drawer bodies define the clipping extents
    ///       the panels record inside.
    /// cost  🚩
    /// tag   api, nonthrowing
    void RecordDrawers();

    /// 🧩 Opens the window for panels to record their content inside the drawer interiors.
    /// note  🔴 Called after RecordDrawers and before Seal. Panels call Surface() to draw into.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void DrawerPanels();

    /// 🧩 Closes the panel recording window and seals the interface tick.
    /// out   Deliver  [-]  refuses when no tick is open
    /// post  the assembled content is ready for Record
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> SealPanels();

    /// 🧩 Closes an open tick without assembling it — the escape from any refusal after Advance.
    /// out   Deliver  [-]  delivers true when no tick was open
    /// note  🔴 A host that returns to the top of its loop after Advance declined must call this. A tick
    ///       left open refuses every subsequent Advance for the life of the process.
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<bool> Abandon();

    /// 🧩 Restates the minimum and actual image counts after a presentation chain was re-established.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Renegotiate(std::uint32_t MinimumImageCount, std::uint32_t ImageCount);

    /// 🧩 Records the assembled content into a command recording of the current cycle slot.
    /// in    CommandRecording [-]  a recording already inside a dynamic rendering scope
    /// out   Deliver          [-]  refuses when nothing has been sealed since the last Advance
    /// pre   SealPanels delivered
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Record(VkCommandBuffer CommandRecording);

    /// 🧩 The two drawers, for the host to query pose and extent.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    DrawerSpace&             Drawers();
    const DrawerSpace&       Drawers() const;

    /// 🧩 The recording surface, for panels to draw into between DrawerPanels and SealPanels.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    RecordingSurface&        Surface();
    const RecordingSurface&  Surface() const;

    /// 🧩 The resolved appearance, for panels to read inks and metrics.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const AppearanceSpecification& Appearance() const;

    /// 🧩 The shared motion integrator, for panels whose interaction contributes to viewport wakefulness.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    MotionIntegrator& MotionSource();

    /// 🧩 The interface seam, for a host seating vendor style or recording a vendor tab bar.
    /// note  🔴 Handed out as the SEAM and never as ImGui. `00` §2.2 keeps every ImGui spelling inside
    ///        `SlateUI`, and this returns the component that owns them — a host still names none.
    /// note  📝 Named `Seam` and not for the member it returns: `Interface` is already the member's own
    ///        spelling, and an accessor sharing it cannot be declared.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    InterfaceExchange& Seam();

    /// 🧩 The redraw marks, for the host to decide whether to present.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    RedrawScheduler&         Marks();
    const RedrawScheduler&   Marks() const;

    /// 🧩 Whether the interface has taken the pointer, so the host must not treat it as a canvas stroke.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool PointerCaptured() const;

    /// 🧩 Whether the interface has taken text entry, so no shortcut consumes the same key.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool KeyboardCaptured() const;

    /// 🧩 Whether either drawer is being dragged or is still travelling under its spring.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool Moving() const;

    /// 🧩 Destroys every owned component and forgets the device handles.
    /// cost  🚩
    /// tag   api, nonthrowing
    void Reclaim();

private:

    InterfaceExchange        Interface         = {};   // [-] - the interface context and ImGui
    MotionIntegrator         Motion            = {};   // [-] - spring physics
    AppearanceSpecification  Resolved          = {};   // [-] - inks and metrics at the display scale
    DrawerSpace              DrawersOwned      = {};   // [-] - the two drawers
    RedrawScheduler          MarksOwned        = {};   // [-] - per-panel redraw marks
    RecordingSurface         SurfaceOwned      = {};   // [-] - the drawing surface
    DrawerDeclaration        NorthDeclared     = {};   // [-] - remembered until the first tick
    DrawerDeclaration        SouthDeclared     = {};   // [-] - remembered until the first tick
    bool                     DrawersConstructed = false;// [-] - deferred to the first Advance
    bool                     PanelsOpen        = false;// [-] - between DrawerPanels and SealPanels
};

}   // namespace Slate

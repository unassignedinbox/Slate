//============================================================================================================================================
//                                                           HOSTLIFECYCLE.CPP
//============================================================================================================================================
// 🧩 One bring-up, one recovery, one teardown — so three hosts cannot hold three opinions about any of them.

#include "SlateVulkan/Device/HostLifecycle/Api/HostLifecycle.h"
#include "SlateVulkan/Device/WindowExchange/Api/WindowExchange.h"

#include <cstdio>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                          REPORTING
//------------------------------------------------------------------------------------------------------------------------

namespace
{

/// 🧩 States which stage declined, in the one format every host reports with.
/// note  The naming travels from the declaration so that two hosts failing at the same stage are told
///       apart by their own name rather than by the reader inferring it from the console order.
void Report(const char* Naming, const char* Stage)
{
    std::printf("%s \u2014 %s\n", (Naming != nullptr) ? Naming : "Host", Stage);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> HostLifecycle::Construct(const HostDeclaration& Arriving)
{
    Declared = Arriving;

    // ① The timeline — Host lifetime, one per process.
    PreviousTick = Clock.Advance();

    // ② The window — Host lifetime.
    if (!Surface.Open({ Declared.InitialWidth, Declared.InitialHeight }, Declared.WindowCaption).ContentPresent)
    {
        Report(Declared.Naming, "the window system declined");
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::HostDenied, "the window system declined" });
    }

    // ③ The instance — Host lifetime; it outlives every device this process constructs.
    if (!DeviceEdge.ConstructInstance(Declared.DiagnosticRequested).ContentPresent)
    {
        Report(Declared.Naming, "no Vulkan instance could be constructed");
        Reclaim();
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent, "no Vulkan instance" });
    }

    // ④ The presentation surface — Host lifetime; it is a property of the window, not of the device.
    const Deliver<VkSurfaceKHR> Converted = Convert(DeviceEdge.Instance(), Surface.NativeHandle());

    if (!Converted.ContentPresent)
    {
        Report(Declared.Naming, "the presentation surface was refused");
        Reclaim();
        return Deliver<bool>::Refuse(Converted.Declined);
    }

    PresentationSurface = Converted.Resolve();

    // ⑤ The diagnostic extension — after the instance, before the device. Not fatal when absent: a machine
    //    without the validation layers installed still runs, it simply reports less.
    if (!DiagnosticEdge.Construct(DeviceEdge, DiagnosticRegister, Clock).ContentPresent)
        Report(Declared.Naming, "the diagnostic extension was not negotiated");

    // ⑥ The device — Device lifetime begins here.
    if (!DeviceEdge.ConstructDevice(PresentationSurface).ContentPresent)
    {
        Report(Declared.Naming, "no Vulkan device could be constructed");
        Reclaim();
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent, "no Vulkan device" });
    }

    Constructed = ResourceLifetime::Device;

    // ⑦ The presentation chain — Display lifetime begins here.
    const Deliver<bool> DisplayBuilt = EstablishDisplay(Declared.InitialWidth, Declared.InitialHeight);

    if (!DisplayBuilt.ContentPresent)
    {
        Report(Declared.Naming, "the presentation chain was refused");
        Reclaim();
        return DisplayBuilt;
    }

    Constructed = ResourceLifetime::Display;

    // ⑧ The cyclic slots and the recordings — Recording lifetime begins here.
    if (!Cycle.Construct(DeviceEdge, DiagnosticEdge).ContentPresent ||
        !Commands.Construct(DeviceEdge, DiagnosticEdge).ContentPresent)
    {
        Report(Declared.Naming, "the recording rotation was refused");
        Reclaim();
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent, "the recording rotation" });
    }

    Constructed  = ResourceLifetime::Recording;
    LoopStanding = true;

    Report(Declared.Naming, "running");

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> HostLifecycle::EstablishDisplay(std::uint32_t Width, std::uint32_t Height)
{
    return DisplayChain.Construct(DeviceEdge, DiagnosticEdge, PresentationSurface,
                                  Width, Height, Declared.Pacing);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE RECOVERY
//------------------------------------------------------------------------------------------------------------------------

bool HostLifecycle::RecoverDisplay()
{
    const DisplayExtent Extent = Surface.CurrentExtent();

    // 🔴 A zero extent is a minimised window and NOT a failure. The extent is deliberately left unadopted so
    //    that `ExtentAltered` stays raised and the restore re-establishes — but the loop must keep standing,
    //    which is why nothing here clears `LoopStanding`.
    if (Extent.Width == 0u || Extent.Height == 0u)
        return false;

    // 🔴 The device is idled before the chain is retired. A chain reclaimed while a recording still reads
    //    one of its images is a use-after-free the validation layer reports several frames later, against
    //    a call that has already returned — which is why every host had written this line and why exactly
    //    one copy of it should exist.
    vkDeviceWaitIdle(DeviceEdge.ActiveDevice());

    // 🔴 The re-establishment is READ. A refused Reclaim leaves no chain to acquire from, and reporting a
    //    recovery that did not happen has the tick loop carry on against a chain that is gone — every
    //    subsequent acquire refuses and the host presents nothing, with no diagnostic naming the cause.
    //    Found by [[nodiscard]]: this delivery was discarded.
    const Deliver<bool> Reestablished = DisplayChain.Reclaim(Extent.Width, Extent.Height);

    Surface.AdoptExtent();

    if (!Reestablished.ContentPresent)
    {
        Report(Declared.Naming, "the presentation chain could not be re-established");
        LoopStanding = false;
        return false;
    }

    DisplayAltered = true;

    return true;
}

void HostLifecycle::SettleAcquisition()
{
    // 🔴 The one way to retire a signalled `ImageArrived` that no submission will consume. A binary
    //    semaphore has no host-side reset: it is unsignalled by a wait, and the only wait that was ever
    //    going to happen was the submission that is not now going to be made. Re-establishing the chain
    //    destroys the semaphore's pending acquire along with the chain it was taken against.
    // ⚠️ Ordered idle-first. Destroying a chain with an acquire outstanding against it is
    //    VUID-vkDestroySwapchainKHR-swapchain-01282, which drivers report as VK_ERROR_DEVICE_LOST on the
    //    NEXT submission — several ticks after the resize that caused it, naming nothing that led there.
    if (DeviceEdge.ActiveDevice() == VK_NULL_HANDLE)
        return;

    vkDeviceWaitIdle(DeviceEdge.ActiveDevice());

    const DisplayExtent Extent = Surface.CurrentExtent();

    if (Extent.Width == 0u || Extent.Height == 0u)
        return;

    // 📝 The delivery is read for `RecoverDisplay`'s reason: a refused re-establishment leaves no chain to
    //    acquire from, and carrying on against one that is gone refuses every subsequent tick silently.
    if (!DisplayChain.Reclaim(Extent.Width, Extent.Height).ContentPresent)
    {
        Report(Declared.Naming, "the chain could not be re-established settling an acquisition");
        LoopStanding = false;
        return;
    }

    Surface.AdoptExtent();
    DisplayAltered = true;
}

bool HostLifecycle::DisplayRecovered()
{
    const bool Recovered = DisplayAltered;
    DisplayAltered = false;
    return Recovered;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DEVICE RECOVERY
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> HostLifecycle::RecoverDevice()
{
    // 🔴 Bounded. A device that is lost twice is a driver that is not coming back, and rebuilding forever
    //    presents the artist with a window that never draws instead of one that reports and exits.
    if (DeviceRecoveries >= DeviceRecoveryCeiling)
    {
        Report(Declared.Naming, "the device was lost more times than the ceiling admits");
        LoopStanding = false;
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::DeviceLost, "the device is not recoverable" });
    }

    ++DeviceRecoveries;

    return RebuildDevice();
}

Deliver<bool> HostLifecycle::RebuildDevice()
{
    // 🔴 An open recording is abandoned rather than surrendered. The device it was recorded into is gone,
    //    so there is nothing to submit it to and nothing that would ever signal its completion.
    TickRecording = false;
    OpenRecording = VK_NULL_HANDLE;

    // ⚠️ Not idled first. `vkDeviceWaitIdle` against a lost device refuses, and `Reclaim` performs the idle
    //    itself for the case where the device is merely being retired rather than already gone.
    Reclaim(ResourceLifetime::Device);

    // 📝 The instance and the surface stand. `Reclaim(Device)` retires Device and everything after it and
    //    leaves the Host tier alone, which is what makes a rebuild possible without a second window.
    if (!DeviceEdge.ConstructDevice(PresentationSurface).ContentPresent)
    {
        Report(Declared.Naming, "no Vulkan device could be reconstructed");
        LoopStanding = false;
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent, "no Vulkan device" });
    }

    Constructed = ResourceLifetime::Device;

    const DisplayExtent Extent = Surface.CurrentExtent();

    if (!EstablishDisplay(Extent.Width, Extent.Height).ContentPresent)
    {
        Report(Declared.Naming, "the presentation chain could not be re-established on a rebuilt device");
        LoopStanding = false;
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent, "no presentation chain" });
    }

    Constructed = ResourceLifetime::Display;
    Surface.AdoptExtent();

    if (!Cycle.Construct(DeviceEdge, DiagnosticEdge).ContentPresent ||
        !Commands.Construct(DeviceEdge, DiagnosticEdge).ContentPresent)
    {
        Report(Declared.Naming, "the recording rotation was refused on a rebuilt device");
        LoopStanding = false;
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::CapabilityAbsent, "the recording rotation" });
    }

    Constructed = ResourceLifetime::Recording;

    // 🔴 Both are raised. A device rebuild invalidates everything a display rebuild does and more, and a
    //    host that reads only `DisplayRecovered` must still be told its display-sized content is gone.
    DeviceAltered  = true;
    DisplayAltered = true;

    Report(Declared.Naming, "the device was rebuilt");

    return Deliver<bool>::Deliver(true);
}

void HostLifecycle::AskDeviceRebuild()
{
    DeviceRebuildAsked = true;
}

bool HostLifecycle::DeviceRecovered()
{
    const bool Recovered = DeviceAltered;
    DeviceAltered = false;
    return Recovered;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          THE TICK
//------------------------------------------------------------------------------------------------------------------------

TickPass HostLifecycle::Await(const float ClearInk[4])
{
    TickPass Pass;

    if (!LoopStanding || Constructed != ResourceLifetime::Recording)
    {
        Pass.Standing = TickStanding::Closed;
        return Pass;
    }

    // ① Drain the window system.
    Surface.Drain();

    if (Surface.ClosureRequested())
    {
        LoopStanding  = false;
        Pass.Standing = TickStanding::Closed;
        return Pass;
    }

    const DisplayExtent Extent = Surface.CurrentExtent();

    Pass.ExtentAlong  = Extent.Width;
    Pass.ExtentAcross = Extent.Height;

    // ①·ii 🔴 A rebuild that was asked for, serviced in TWO phases. Phase one hands the host a
    //      withdrawn tick with `DeviceRetiring` raised, so it retires its own device resources while the
    //      device STILL STANDS. Phase two, next tick, rebuilds. Doing both at once destroyed the device
    //      before the host had been told, and the host's reclamation then idled a dead handle —
    //      reported by the loader as VUID-vkDeviceWaitIdle-device-parameter.
    if (DeviceRebuildAsked)
    {
        DeviceRebuildAsked = false;
        DeviceRetiring     = true;

        Report(Declared.Naming, "F8 — retiring device resources before the rebuild");

        Pass.DeviceRetiring = true;
        Pass.Standing       = TickStanding::Withdrawn;
        return Pass;
    }

    if (DeviceRetiring)
    {
        DeviceRetiring = false;

        Report(Declared.Naming, "F8 — rebuilding the device tier");

        // 📝 The UNCOUNTED path. The key is a scenario and not a loss, so it must not spend the loss budget.
        if (!RebuildDevice().ContentPresent)
        {
            Pass.Standing = TickStanding::Closed;
            return Pass;
        }

        Pass.DisplayAltered = true;
        Pass.Standing       = TickStanding::Withdrawn;
        return Pass;
    }

    // ② A minimised window has no drawable extent. Block on the window system rather than spinning through
    //    a loop that can acquire nothing.
    if (Extent.Width == 0u || Extent.Height == 0u)
    {
        Surface.Await();
        Pass.Standing = TickStanding::Withdrawn;
        return Pass;
    }

    // ③ 🔴 Re-establish the chain the moment the extent moved, before anything reads it. `PaintHost` never
    //    performed this test at all, so a resize did nothing until the vendor refused an acquire — which it
    //    reports as an out-of-date chain one or more ticks after the window actually moved.
    if (Surface.ExtentAltered())
    {
        RecoverDisplay();
        Pass.DisplayAltered = true;
    }

    // ③·i The scenarios `32` §9 is validated against, driven from the keyboard so that each is exercised
    //     deliberately rather than waited for. Every one of them runs the ordinary path and none has a
    //     route of its own — a scenario that tested its own private path would test nothing.
    if (Surface.KeyDescended(WindowInterchange::DiagnosticKey::ResizeStorm))
    {
        ResizeStorming = !ResizeStorming;
        Report(Declared.Naming, ResizeStorming ? "F7 — resize storm engaged, re-establishing every tick"
                                               : "F7 — resize storm released");
    }

    if (Surface.KeyDescended(WindowInterchange::DiagnosticKey::RecoverDisplay))
    {
        // 🔴 Stated before it acts. A scenario that runs silently is one the reader cannot tell from a key
        //    the process never received — which is exactly how the first cut of these keys failed.
        Report(Declared.Naming, "F6 — re-establishing the presentation chain");
        RecoverDisplay();
        Pass.DisplayAltered = true;
    }
    else if (ResizeStorming)
    {
        RecoverDisplay();
        Pass.DisplayAltered = true;
    }

    if (Surface.KeyDescended(WindowInterchange::DiagnosticKey::RecoverDevice))
        AskDeviceRebuild();

    // 📝 The count is stated by the call itself and discarded here deliberately: this key exists to print
    //    the verdict mid-run, and nothing at this point acts on how many serious entries there were.
    if (Surface.KeyDescended(WindowInterchange::DiagnosticKey::StateReports))
        static_cast<void>(StateDiagnostics());

    // ④ Await the cycle slot. The fence guards the recording this slot is about to reuse.
    const Deliver<bool> SlotAwaited = Cycle.Await();

    if (!SlotAwaited.ContentPresent)
    {
        // 🔴 A lost device is rebuilt rather than reported and abandoned. Every other refusal here is a
        //    device that did not answer within the ceiling, which a rebuild would not mend.
        if (SlotAwaited.Declined.DeclaredReason == RefusalReason::DeviceLost)
        {
            Report(Declared.Naming, "the device was lost awaiting the cycle slot");

            if (RecoverDevice().ContentPresent)
            {
                Pass.DisplayAltered = true;
                Pass.Standing       = TickStanding::Withdrawn;
                return Pass;
            }
        }

        Report(Declared.Naming, "the cycle slot was lost");
        LoopStanding  = false;
        Pass.Standing = TickStanding::Closed;
        return Pass;
    }

    SlotOrdinal = Cycle.StandingOrdinal();

    const Deliver<CycleSlot> Standing = Cycle.Standing();

    if (!Standing.ContentPresent)
    {
        LoopStanding  = false;
        Pass.Standing = TickStanding::Closed;
        return Pass;
    }

    // ⑤ The elapsed interval, measured before any content is built so that everything in this tick is
    //    advanced by the same figure.
    const TickPoint TickNow = Clock.Advance();
    Pass.ElapsedMilliseconds = TickSequence::Span(PreviousTick, TickNow);
    PreviousTick = TickNow;

    // ⑥ Acquire the display image. 🔴 Everything that could decline has now declined: from here to the
    //    surrender there is no path that returns, which is why a host cannot leave a recording open.
    const Deliver<ArrivedImage> Arrived = DisplayChain.Await(Standing.Resolve(), Clock);

    if (!Arrived.ContentPresent)
    {
        if (Arrived.Declined.DeclaredReason == RefusalReason::DeviceLost)
        {
            Report(Declared.Naming, "the device was lost awaiting a display image");

            // 🔴 Rebuilt rather than closed. Device loss was terminal here, so a driver reset — which is
            //    an ordinary event on a machine whose display driver updates while Slate is running —
            //    closed the application under the artist.
            if (RecoverDevice().ContentPresent)
            {
                Pass.DisplayAltered = true;
                Pass.Standing       = TickStanding::Withdrawn;
                return Pass;
            }

            LoopStanding  = false;
            Pass.Standing = TickStanding::Closed;
            return Pass;
        }

        Pass.Standing = TickStanding::Withdrawn;
        return Pass;
    }

    if (Arrived.Resolve().Reclaimed)
    {
        // 🔴 `VK_ERROR_OUT_OF_DATE_KHR` took no image and signalled nothing, so there is no acquisition to
        //    settle — but the ROTATION must still turn. `Cycle.Advance` lives in `Surrender` alone, and a
        //    withdrawn tick that skipped it left the rotation on one slot forever: every subsequent tick
        //    withdrew against the same slot, nothing was ever presented, and the artist saw the last good
        //    image frozen on screen for as long as the chain kept reporting itself outgrown.
        Cycle.Advance();

        RecoverDisplay();
        Pass.DisplayAltered = true;
        Pass.Standing       = TickStanding::Withdrawn;
        return Pass;
    }

    AcquiredImage = Arrived.Resolve();

    // ⑦ Open the recording and the rendering scope.
    const Deliver<VkCommandBuffer> Opened = Commands.Open(SlotOrdinal);

    if (!Opened.ContentPresent)
    {
        Report(Declared.Naming, "the command recording was refused");
        LoopStanding  = false;
        Pass.Standing = TickStanding::Closed;
        return Pass;
    }

    OpenRecording = Opened.Resolve();

    const VkRenderingAttachmentInfo ColourAttachment = {
        .sType       = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO,
        .pNext       = nullptr,
        .imageView   = AcquiredImage.WholeView,
        .imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
        .resolveMode = VK_RESOLVE_MODE_NONE,
        .resolveImageView   = VK_NULL_HANDLE,
        .resolveImageLayout = VK_IMAGE_LAYOUT_UNDEFINED,
        .loadOp      = VK_ATTACHMENT_LOAD_OP_CLEAR,
        .storeOp     = VK_ATTACHMENT_STORE_OP_STORE,
        .clearValue  = { .color = { { ClearInk[0], ClearInk[1], ClearInk[2], ClearInk[3] } } }
    };

    const VkRenderingInfo RenderScope = {
        .sType                = VK_STRUCTURE_TYPE_RENDERING_INFO,
        .pNext                = nullptr,
        .flags                = 0u,
        .renderArea           = { { 0, 0 }, { DisplayChain.StandingWidth(), DisplayChain.StandingHeight() } },
        .layerCount           = 1u,
        .viewMask             = 0u,
        .colorAttachmentCount = 1u,
        .pColorAttachments    = &ColourAttachment,
        .pDepthAttachment     = nullptr,
        .pStencilAttachment   = nullptr
    };

    vkCmdBeginRendering(OpenRecording, &RenderScope);

    TickRecording   = true;
    Pass.Standing   = TickStanding::Recording;
    Pass.Recording  = OpenRecording;

    return Pass;
}

Deliver<bool> HostLifecycle::Surrender()
{
    if (!TickRecording)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::ContentUnsupported,
                                              "no tick stands recording" });
    }

    vkCmdEndRendering(OpenRecording);

    const Deliver<CycleSlot> Standing = Cycle.Standing();

    if (!Standing.ContentPresent)
    {
        // 🔴 An image stands acquired and its `ImageArrived` stands signalled. Nothing below will submit, so
        //    nothing will ever wait it down — and a binary semaphore left signalled is one the next acquire
        //    on this slot signals a second time. `SettleAcquisition` idles the device and re-establishes the
        //    chain, which is the only way to retire a signalled semaphore no submission will consume.
        SettleAcquisition();

        TickRecording = false;
        OpenRecording = VK_NULL_HANDLE;
        LoopStanding  = false;
        return Deliver<bool>::Refuse(Standing.Declined);
    }

    // 🔴 The rotation is armed immediately before the surrender. Armed any earlier, a refusal between the
    //    two leaves the fence unsignalled and the next Await never returns.
    if (!Cycle.Arm().ContentPresent)
    {
        // 🔴 As above — acquired, signalled, and about to return without submitting.
        SettleAcquisition();

        TickRecording = false;
        OpenRecording = VK_NULL_HANDLE;
        LoopStanding  = false;
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::DeviceLost, "the rotation could not be armed" });
    }

    const Deliver<bool> Surrendered = Commands.Surrender(SlotOrdinal, SurrenderOrdering{
        .Awaited      = Standing.Resolve().ImageArrived,
        .AwaitedStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
        .Signalled    = Standing.Resolve().RecordingDone,
        .Completion   = Standing.Resolve().Completion
    });

    TickRecording = false;
    OpenRecording = VK_NULL_HANDLE;

    if (!Surrendered.ContentPresent)
    {
        // 🔴 The submission did not reach the device, so `ImageArrived` stands signalled AND `Arm` has already
        //    cleared the completion fence that nothing will now signal. Both are settled together: the next
        //    `Cycle.Await` on this slot would otherwise wait the whole two-second ceiling for a fence no
        //    submission is going to raise, once per rotation, which the artist reads as the program hanging.
        // ⚠️ A lost device is rebuilt instead, which settles both by reconstructing the rotation outright.
        if (Surrendered.Declined.DeclaredReason == RefusalReason::DeviceLost)
        {
            Report(Declared.Naming, "the device was lost surrendering a recording");

            if (RecoverDevice().ContentPresent)
                return Deliver<bool>::Deliver(true);

            return Surrendered;
        }

        SettleAcquisition();

        LoopStanding = false;
        return Surrendered;
    }

    // 🔴 A refused present re-establishes the chain rather than ending the loop. `PaintHost` broke out of
    //    its tick loop here, so a resize arriving between the acquire and the present closed the
    //    application — reported to the artist as the program vanishing.
    // 🔴 The delivered VALUE is read as well as the delivery. `Present` reports a presentation against a
    //    chain the display has outgrown as a delivered `false`, and reading only `ContentPresent` — which
    //    this did — made this branch unreachable on a resize: the chain was then rebuilt a tick later by
    //    the extent test, or never, when the display outgrew a chain the window extent had not moved.
    const Deliver<bool> Presented = DisplayChain.Present(Standing.Resolve(), AcquiredImage.ImageOrdinal);

    if (!Presented.ContentPresent || !Presented.Resolve())
    {
        RecoverDisplay();
    }

    Cycle.Advance();

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE READINGS
//------------------------------------------------------------------------------------------------------------------------

bool HostLifecycle::Standing() const
{
    return LoopStanding;
}

DeviceOffering HostLifecycle::Offering() const
{
    DeviceOffering Arriving = {};

    Arriving.Instance                 = DeviceEdge.Instance();
    Arriving.ScoredDevice             = DeviceEdge.ScoredDevice();
    Arriving.ActiveDevice             = DeviceEdge.ActiveDevice();
    Arriving.GraphicsQueue            = DeviceEdge.GraphicsQueue();
    Arriving.GraphicsFamilyOrdinal    = DeviceEdge.Capability().GraphicsFamilyOrdinal;
    Arriving.ColourTargetFormat       = DisplayChain.Carries();
    Arriving.MinimumDisplayImageCount = DisplayChain.MinimumChainImageCount();
    Arriving.DisplayImageCount        = DisplayChain.ChainImageCount();
    Arriving.NativeWindowSlot         = Surface.NativeHandle();

    return Arriving;
}

WindowInterchange&       HostLifecycle::Window()             { return Surface; }
const WindowInterchange& HostLifecycle::Window() const       { return Surface; }
const TickSequence&      HostLifecycle::Timeline() const     { return Clock; }

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DIAGNOSTIC VERDICT
//------------------------------------------------------------------------------------------------------------------------

namespace
{

/// 🧩 Whether one retained report is a problem, per `86` §5's table.
/// note  🔴 `Refused` and `Failed` alone. `Terminated` is the ambiguous row §5 requires to be presented as
///        ambiguous, and the remaining four describe normal operation — counting any of them here would
///        make a clean run report as dirty, which teaches a reader to ignore the figure.
/// cost  ✔️
constexpr bool Serious(ReportDisposition Disposition)
{
    return Disposition == ReportDisposition::Refused
        || Disposition == ReportDisposition::Failed;
}

/// 🧩 The disposition's own spelling, so a stated entry names its class rather than an ordinal.
/// cost  ✔️
constexpr const char* Spelling(ReportDisposition Disposition)
{
    switch (Disposition)
    {
        case ReportDisposition::Measured:   return "measured";
        case ReportDisposition::Assumed:    return "assumed";
        case ReportDisposition::Amended:    return "amended";
        case ReportDisposition::Truncated:  return "truncated";
        case ReportDisposition::Refused:    return "refused";
        case ReportDisposition::Terminated: return "terminated";
        case ReportDisposition::Failed:     return "failed";
        default:                            return "undeclared";
    }
}

}   // namespace

DiagnosticVerdict HostLifecycle::Diagnostics() const
{
    DiagnosticVerdict Reported;

    Reported.Negotiated = DiagnosticEdge.Negotiated();
    Reported.Arrived    = DiagnosticEdge.ArrivalCount();
    Reported.Retained   = DiagnosticRegister.RetainedCount();
    Reported.Appended   = DiagnosticRegister.AppendedCount();
    Reported.Discarded  = DiagnosticRegister.DiscardedCount();

    // 📝 🚩 A copy under the register's own guard, because an append arrives from any thread — `86` §3.1.
    const std::vector<ReportSpecification> Standing = DiagnosticRegister.Retained();

    for (const ReportSpecification& Entry : Standing)
    {
        if (Serious(Entry.Disposition))
            ++Reported.Serious;
    }

    return Reported;
}

std::uint32_t HostLifecycle::StateDiagnostics() const
{
    const DiagnosticVerdict Reported = Diagnostics();

    // 🔴 A run that negotiated nothing is not a clean run and is not stated as one. Every figure below
    //    would be zero, and a reader who could not tell the two apart would read an unwatched run as clean.
    if (!Reported.Negotiated)
    {
        Report(Declared.Naming, "no diagnostic layer was negotiated \u2014 this run was not watched");
        return 0u;
    }

    // 🔴 Named individually before the summary. A count alone states that a run was dirty without stating
    //    what it tripped, and the identifier below is what the vendor's own documentation is indexed by.
    const std::vector<ReportSpecification> Standing = DiagnosticRegister.Retained();

    for (const ReportSpecification& Entry : Standing)
    {
        if (!Serious(Entry.Disposition))
            continue;

        std::printf("%s \u2014 %s %s [%llu] \u00d7%u \u2014 %s\n",
                    (Declared.Naming != nullptr) ? Declared.Naming : "Host",
                    Spelling(Entry.Disposition),
                    Entry.Subject,
                    static_cast<unsigned long long>(Entry.SubjectOrdinal),
                    Entry.OccurrenceCount,
                    Entry.Detail);
    }

    // ⚠️ The discard count is stated even at zero. A register that dropped its first error four thousand
    //    arrivals ago otherwise presents as one that never received it.
    std::printf("%s \u2014 diagnostics: %u serious, %u retained, %llu appended, %llu arrived, %llu discarded\n",
                (Declared.Naming != nullptr) ? Declared.Naming : "Host",
                Reported.Serious,
                Reported.Retained,
                static_cast<unsigned long long>(Reported.Appended),
                static_cast<unsigned long long>(Reported.Arrived),
                static_cast<unsigned long long>(Reported.Discarded));

    return Reported.Serious;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void HostLifecycle::Reclaim(ResourceLifetime From)
{
    // 🔴 Idle first. Every retirement below releases something a recording in flight may still be reading,
    //    and the vendor reports that as a destroyed-object access several frames after the call.
    if (DeviceEdge.ActiveDevice() != VK_NULL_HANDLE)
        vkDeviceWaitIdle(DeviceEdge.ActiveDevice());

    const std::uint32_t Earliest = static_cast<std::uint32_t>(From);

    // 📝 Retired in reverse construction order, which is what the enumeration's ordinals state.
    if (Earliest <= static_cast<std::uint32_t>(ResourceLifetime::Recording))
    {
        Commands.Reclaim();
        Cycle.Reclaim();
    }

    if (Earliest <= static_cast<std::uint32_t>(ResourceLifetime::Display))
    {
        DisplayChain.Surrender();
    }

    if (Earliest <= static_cast<std::uint32_t>(ResourceLifetime::Device))
    {
        DiagnosticEdge.Reclaim();
        DeviceEdge.ReclaimDevice();
    }

    if (Earliest == static_cast<std::uint32_t>(ResourceLifetime::Host))
    {
        if (PresentationSurface != VK_NULL_HANDLE)
        {
            Slate::Reclaim(DeviceEdge.Instance(), PresentationSurface);
            PresentationSurface = VK_NULL_HANDLE;
        }

        LoopStanding = false;
    }

    if (Earliest < static_cast<std::uint32_t>(Constructed))
        Constructed = From;

    TickRecording = false;
    OpenRecording = VK_NULL_HANDLE;
}

HostLifecycle::~HostLifecycle()
{
    // 📝 A host that returned early, or threw past its own teardown, still releases everything. Reclaim is
    //    written to be safe on a partial construction, which is what makes this destructor sufficient.
    Reclaim();
}

}   // namespace Slate

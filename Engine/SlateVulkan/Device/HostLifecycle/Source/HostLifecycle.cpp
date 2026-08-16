//============================================================================================================================================
//                                                           HOSTLIFECYCLE.CPP
//============================================================================================================================================
// 🧩 One bring-up, one recovery, one teardown — so three hosts cannot hold three opinions about any of them.

#include "SlateVulkan/Device/HostLifecycle/Api/HostLifecycle.h"
#include "SlateVulkan/Device/WindowExchange/Api/WindowExchange.h"

#include <cstdio>

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

    if (Extent.Width == 0u || Extent.Height == 0u)
        return false;

    // 🔴 The device is idled before the chain is retired. A chain reclaimed while a recording still reads
    //    one of its images is a use-after-free the validation layer reports several frames later, against
    //    a call that has already returned — which is why every host had written this line and why exactly
    //    one copy of it should exist.
    vkDeviceWaitIdle(DeviceEdge.ActiveDevice());

    DisplayChain.Reclaim(Extent.Width, Extent.Height);
    Surface.AdoptExtent();

    DisplayAltered = true;

    return true;
}

bool HostLifecycle::DisplayRecovered()
{
    const bool Recovered = DisplayAltered;
    DisplayAltered = false;
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

    // ④ Await the cycle slot. The fence guards the recording this slot is about to reuse.
    if (!Cycle.Await().ContentPresent)
    {
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
            Report(Declared.Naming, "the device was lost");
            LoopStanding  = false;
            Pass.Standing = TickStanding::Closed;
            return Pass;
        }

        Pass.Standing = TickStanding::Withdrawn;
        return Pass;
    }

    if (Arrived.Resolve().Reclaimed)
    {
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
        TickRecording = false;
        OpenRecording = VK_NULL_HANDLE;
        LoopStanding  = false;
        return Deliver<bool>::Refuse(Standing.Declined);
    }

    // 🔴 The rotation is armed immediately before the surrender. Armed any earlier, a refusal between the
    //    two leaves the fence unsignalled and the next Await never returns.
    if (!Cycle.Arm().ContentPresent)
    {
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
        LoopStanding = false;
        return Surrendered;
    }

    // 🔴 A refused present re-establishes the chain rather than ending the loop. `PaintHost` broke out of
    //    its tick loop here, so a resize arriving between the acquire and the present closed the
    //    application — reported to the artist as the program vanishing.
    if (!DisplayChain.Present(Standing.Resolve(), AcquiredImage.ImageOrdinal).ContentPresent)
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

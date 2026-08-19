//============================================================================================================================================
//                                                       PANELVALIDATIONHOST.CPP
//============================================================================================================================================
// Standalone native validation host for Scene Director and Texture Paint; no viewport is constructed.

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/InterfaceExchange/Api/InterfaceExchange.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/SceneDirectorPanel/Api/SceneDirectorPanel.h"
#include "SlateVulkan/Device/HostLifecycle/Api/HostLifecycle.h"

#include <cstdio>

namespace
{
using namespace Slate;
constexpr std::uint32_t InitialWidth = 1180u;
constexpr std::uint32_t InitialHeight = 760u;
constexpr const char* WindowTitle = "Slate - Panel Validation";
constexpr const char* HostName = "PanelValidationHost";
constexpr float PageGround[4] = { 0.0392f, 0.0392f, 0.0431f, 1.0f };

InterfaceAttachment Attach(const DeviceOffering& Offered)
{
    InterfaceAttachment Arriving = {};
    Arriving.Instance = Offered.Instance;
    Arriving.ScoredDevice = Offered.ScoredDevice;
    Arriving.ActiveDevice = Offered.ActiveDevice;
    Arriving.GraphicsQueue = Offered.GraphicsQueue;
    Arriving.GraphicsFamilyOrdinal = Offered.GraphicsFamilyOrdinal;
    Arriving.ColourTargetFormat = Offered.ColourTargetFormat;
    Arriving.MinimumDisplayImageCount = Offered.MinimumDisplayImageCount;
    Arriving.DisplayImageCount = Offered.DisplayImageCount;
    Arriving.NativeWindowSlot = Offered.NativeWindowSlot;
    return Arriving;
}
} // namespace

int main()
{
    using namespace Slate;
    HostDeclaration Declared;
    Declared.Naming = HostName;
    Declared.WindowCaption = WindowTitle;
    Declared.InitialWidth = InitialWidth;
    Declared.InitialHeight = InitialHeight;
    Declared.Pacing = LatencyIntent::SteadyPacing;
    Declared.DiagnosticRequested = true;

    HostLifecycle Lifetime;
    if (!Lifetime.Construct(Declared).ContentPresent)
        return 1;

    InterfaceExchange Interface;
    if (!Interface.Construct(Attach(Lifetime.Offering())).ContentPresent)
    {
        std::printf("%s - interface construction refused\n", HostName);
        return 1;
    }

    RecordingSurface Surface;
    SceneDirectorPanel Panel;
    SceneDirectorOrdinates Ordinates;
    if (!Panel.Construct(Surface).ContentPresent)
    {
        std::printf("%s - panel construction refused\n", HostName);
        return 1;
    }

    std::printf("%s - running Scene Director and Texture Paint native validation\n", HostName);
    while (Lifetime.Standing())
    {
        const TickPass Pass = Lifetime.Await(PageGround);
        if (Pass.Standing == TickStanding::Closed)
            break;

        if (Pass.DeviceRetiring)
        {
            Interface.Reclaim();
            continue;
        }

        if (Lifetime.DeviceRecovered())
        {
            if (!Interface.Construct(Attach(Lifetime.Offering())).ContentPresent)
                break;
            static_cast<void>(Lifetime.DisplayRecovered());
        }
        else if (Lifetime.DisplayRecovered())
        {
            const DeviceOffering Offered = Lifetime.Offering();
            if (!Interface.Renegotiate(Offered.MinimumDisplayImageCount, Offered.DisplayImageCount).ContentPresent)
                std::printf("%s - display-count renegotiation refused\n", HostName);
        }

        if (Pass.Standing != TickStanding::Recording)
            continue;

        bool ContentBuilt = Interface.Advance().ContentPresent;
        if (ContentBuilt && !Surface.Adopt().ContentPresent)
        {
            Disregard(Interface.Abandon());
            ContentBuilt = false;
        }

        if (ContentBuilt)
        {
            const DisplayCondition& Display = Surface.Display();
            Panel.Advance(Surface.Pointer(), Pass.ElapsedMilliseconds);
            Disregard(Panel.Record(Spanning(0.0f, 0.0f, Display.ExtentAlong, Display.ExtentAcross), Ordinates));
            Surface.Retire();
            if (Interface.Seal().ContentPresent)
            {
                if (!Interface.Record(Pass.Recording).ContentPresent)
                    std::printf("%s - interface recording refused\n", HostName);
            }
            else
            {
                Disregard(Interface.Abandon());
            }
        }

        if (!Lifetime.Surrender().ContentPresent)
            break;
    }

    const std::uint32_t Serious = Lifetime.StateDiagnostics();
    Panel.Reset();
    Surface.Reset();
    Interface.Reclaim();
    Lifetime.Reclaim();
    std::printf("%s - exited cleanly\n", HostName);
    return Serious == 0u ? 0 : 1;
}

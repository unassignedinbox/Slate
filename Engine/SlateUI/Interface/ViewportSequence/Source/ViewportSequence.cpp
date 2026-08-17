//============================================================================================================================================
//                                                        VIEWPORTSEQUENCE.CPP
//============================================================================================================================================
// 🧩 The shared tick driver — springs, drawers, and the assembled recording.

#include "SlateUI/Interface/ViewportSequence/Api/ViewportSequence.h"

#include <new>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ViewportSequence::Construct(const InterfaceAttachment& Arriving,
                                          const DrawerDeclaration&   North,
                                          const DrawerDeclaration&   South)
{
    const Deliver<bool> InterfaceBuilt = Interface.Construct(Arriving);
    if (!InterfaceBuilt.ContentPresent)
        return InterfaceBuilt;

    NorthDeclared = North;
    SouthDeclared = South;
    Resolved      = Resolve(1.0);

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE TICK
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ViewportSequence::Advance(double ElapsedMilliseconds)
{
    // ① Open the ImGui frame.
    const Deliver<bool> TickOpened = Interface.Advance();
    if (!TickOpened.ContentPresent)
        return TickOpened;

    // ② Adopt the surface — reads pointer and display from ImGui IO.
    const Deliver<bool> SurfaceAdopted = SurfaceOwned.Adopt();
    if (!SurfaceAdopted.ContentPresent)
    {
        Disregard(Interface.Abandon());
        return SurfaceAdopted;
    }

    // ③ Resolve the appearance against the arrived display scale.
    const DisplayCondition& Display = SurfaceOwned.Display();
    Resolved = Resolve(static_cast<double>(Display.DisplayScale));

    // ④ Construct the drawers on the first tick, when the display extent is known.
    if (!DrawersConstructed)
    {
        const Deliver<bool> DrawersBuilt =
            DrawersOwned.Construct(Motion, Resolved, NorthDeclared, SouthDeclared, Display);

        if (!DrawersBuilt.ContentPresent)
        {
            Disregard(Interface.Abandon());
            return DrawersBuilt;
        }

        DrawersConstructed = true;
    }
    else
    {
        // 📝 🔴 Rearrange now returns immediately unless the extent moved. Calling it every tick — which is
        //    what this line used to do — re-seated every spring onto its pose ordinate and released the live
        //    grab, so a drag was erased one tick after it began and no drawer could ever be dragged.
        DrawersOwned.Rearrange(Display);
    }

    // ⑤ Drive the drawer springs from the pointer.
    const PointerCondition& Pointer = SurfaceOwned.Pointer();
    DrawersOwned.Advance(Pointer, Display.Elapsed, !Interface.PointerCaptured());

    // ⑥ Advance the motion integrator.
    Motion.Advance(ElapsedMilliseconds > 0.0 ? ElapsedMilliseconds : Display.Elapsed);

    PanelsOpen = false;
    return Deliver<bool>::Deliver(true);
}

void ViewportSequence::RecordDrawers()
{
    if (DrawersConstructed)
        DrawersOwned.Record(SurfaceOwned);
}

void ViewportSequence::DrawerPanels()
{
    PanelsOpen = true;
}

Deliver<bool> ViewportSequence::SealPanels()
{
    PanelsOpen = false;

    // 🔴 The surface is retired at the seal, not at the next Advance. Between the two, the assembled
    //    content is finished and immutable; a panel that kept a reference and recorded into it would build
    //    commands that cost time and are then discarded, with nothing reporting that they were lost.
    SurfaceOwned.Retire();

    return Interface.Seal();
}

Deliver<bool> ViewportSequence::Abandon()
{
    PanelsOpen = false;

    // 📝 An abandoned tick retires its surface for the same reason a sealed one does: nothing may record
    //    into content that will never be assembled.
    SurfaceOwned.Retire();

    return Interface.Abandon();
}

Deliver<bool> ViewportSequence::Renegotiate(std::uint32_t MinimumImageCount, std::uint32_t ImageCount)
{
    return Interface.Renegotiate(MinimumImageCount, ImageCount);
}

Deliver<bool> ViewportSequence::Record(VkCommandBuffer CommandRecording)
{
    return Interface.Record(CommandRecording);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        ACCESSORS
//------------------------------------------------------------------------------------------------------------------------

DrawerSpace& ViewportSequence::Drawers()
{
    return DrawersOwned;
}

const DrawerSpace& ViewportSequence::Drawers() const
{
    return DrawersOwned;
}

RecordingSurface& ViewportSequence::Surface()
{
    return SurfaceOwned;
}

const RecordingSurface& ViewportSequence::Surface() const
{
    return SurfaceOwned;
}

const AppearanceSpecification& ViewportSequence::Appearance() const
{
    return Resolved;
}

RedrawScheduler& ViewportSequence::Marks()
{
    return MarksOwned;
}

const RedrawScheduler& ViewportSequence::Marks() const
{
    return MarksOwned;
}

bool ViewportSequence::PointerCaptured() const
{
    return Interface.PointerCaptured();
}

bool ViewportSequence::KeyboardCaptured() const
{
    return Interface.KeyboardCaptured();
}

bool ViewportSequence::Moving() const
{
    return DrawersOwned.Moving() || Motion.Moving();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      RECLAIM
//------------------------------------------------------------------------------------------------------------------------

void ViewportSequence::Reclaim()
{
    Disregard(Interface.Abandon());
    Interface.Reclaim();

    // 📝 🔴 The drawers are reset before the integrator, because their spring ordinals index into it. The
    //    previous reclamation placement-constructed over five live objects without destroying any of them,
    //    which left the drawers holding a pointer into storage that had just been overwritten.
    DrawersOwned.Reset();
    SurfaceOwned.Reset();

    Motion.~MotionIntegrator();
    ::new (&Motion) MotionIntegrator{};

    MarksOwned.~RedrawScheduler();
    ::new (&MarksOwned) RedrawScheduler{};

    Resolved = AppearanceSpecification{};

    DrawersConstructed = false;
    PanelsOpen         = false;
}

}   // namespace Slate

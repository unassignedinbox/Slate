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
        // 📝 Retired although the adopt refused and there is nothing to retire. `Retire` is idempotent, and
        //    a reader following this path should not have to prove it safe before moving on.
        SurfaceOwned.Retire();

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
            // 🔴 The surface is retired before the internal abandon, for the same reason `SealPanels`
            //    retires it: an adopt that SUCCEEDED against a tick this component is now abandoning must
            //    not leave the surface recordable into content nothing will assemble. The host's own
            //    `Abandon` also retires, but the invariant is this component's to hold rather than the
            //    host's to remember — `00` prevents by declaration, not by discipline.
            SurfaceOwned.Retire();

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

    // 🔴 The drawers are asked FIRST, and their answer outranks the interface's capture flag. Gating them
    //    on `!PointerCaptured()` disabled them wherever a window sat beneath — and a docked workspace
    //    fills the body, so a drawer raised over one was refused every contact. The artist could see the
    //    handle and could not press it; the click selected the workspace behind it instead.
    // 📝 `Claims` is the same arbitration `Contacted` already performed, asked before the gate rather than
    //    after it. `14` §4.2's rule is unchanged — exactly one consumer holds the pointer — but the
    //    ordering that decides which one now puts the drawers above the windows they are drawn above.
    DrawerBearing Claiming   = DrawerBearing::North;
    const bool    DrawerHeld = DrawersOwned.Claims(Pointer.PositionAlong, Pointer.PositionAcross, Claiming);

    // 🔴 Withheld BEFORE the advance as well as after. A resize grip seizes the contact on the very frame
    //    the press lands, and `Claims` answers for where the pointer is NOW — so once a drag carries the
    //    pointer off the drawer, `DrawerHeld` goes false and the withholding stopped while the vendor's
    //    grip kept the identity it had already taken. Withholding on the seizing frame is what prevents
    //    the grip from ever taking it.
    if (DrawerHeld)
        Interface.WithholdPointer();

    DrawersOwned.Advance(Pointer, Display.Elapsed, DrawerHeld || !Interface.PointerCaptured());

    // 🔴 The interface is told the drawers took it, so the window beneath does not act on the same
    //    contact. Without this both consumers answer one click: the drawer drags and the workspace
    //    selects, which is the defect wearing its other face.
    // 🔴 And again after, because `Moving` only reports a live grab once `Advance` has seized it. A drag
    //    that has carried the pointer clear of the drawer is held by `GrabbedBy` alone, and it is that
    //    state — not where the pointer happens to be — that must keep the vendor out for the whole drag.
    if (DrawerHeld || DrawersOwned.Moving())
        Interface.WithholdPointer();

    // ⑥ Advance the motion integrator.
    Motion.Advance(ElapsedMilliseconds > 0.0 ? ElapsedMilliseconds : Display.Elapsed);

    PanelsOpen = false;
    return Deliver<bool>::Deliver(true);
}

InterfaceExchange& ViewportSequence::Seam()
{
    return Interface;
}

void ViewportSequence::RecordDrawers()
{
    if (!DrawersConstructed)
        return;

    // 🔴 The drawers are laid ABOVE every window. `DockWorkspace.html` overlays the control centre and the
    //    asset browser on the whole shell, and a workspace docked full-width would otherwise bury both —
    //    every ImGui window records between the background and foreground lists.
    // 🔴 RELAYERED, never re-adopted. `Adopt` re-samples the pointer, clears the confine depth and stamps
    //    a fresh tick ordinal — doing that twice a tick merely to raise the drawers sampled the pointer
    //    mid-tick, so a drag reported one travel to the panels and another to the drawers.
    Disregard(SurfaceOwned.Relayer(RecordingSurface::ShellLayer::Above));

    DrawersOwned.Record(SurfaceOwned);

    // 📝 Returned to the ground layer, so anything recorded after the drawers this tick lands beneath the
    //    windows again rather than inheriting the overlay.
    Disregard(SurfaceOwned.Relayer(RecordingSurface::ShellLayer::Beneath));
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

MotionIntegrator& ViewportSequence::MotionSource()
{
    return Motion;
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

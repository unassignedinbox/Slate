//============================================================================================================================================
//                                                           WINDOWINTERCHANGE.H
//============================================================================================================================================
// 🧩 One window surface over three window systems — surrenders the native handle and nothing else.

#pragma once

#include "Contract/DeliveryContract.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    DISPLAY EXTENT
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The extent of a window's drawable area.
/// note  ⚠️ A drag produces a new extent many times a second. `06` §4.1 takes the extent once and discards
///       the intermediates; nothing here queues them.
/// tag   nonallocating, nonthrowing
struct DisplayExtent
{
    std::uint32_t  Width  = 0u;   // [px] - drawable width, not window-including-decoration width
    std::uint32_t  Height = 0u;   // [px] - drawable height
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE WINDOW
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 A native window over the host window system.
/// note  🔴 This component surrenders the native handle and nothing else. It does not know what a surface
///       is, includes no Vulkan header, and names no presentation chain. `06`'s `WindowExchange` converts
///       the handle; the split is what keeps `SlateMath` device-free.
/// tag   owning
class WindowInterchange
{
public:

    WindowInterchange()                                    = default;
    WindowInterchange(const WindowInterchange&)            = delete;
    WindowInterchange& operator=(const WindowInterchange&) = delete;
    ~WindowInterchange();

    /// 🧩 Opens a window of the requested extent and surrenders nothing until it succeeds.
    /// in    RequestedExtent [px]  the drawable extent asked of the window system
    /// in    WindowTitle     [-]   static text; never allocated, never retained beyond the call
    /// out   Deliver         [-]   refuses with HostDenied when the window system declines
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Open(DisplayExtent RequestedExtent, const char* WindowTitle);

    /// 🧩 Drains the window system's pending messages into this window's recorded condition.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Drain();

    /// 🧩 Blocks until the window system has something to report — what a minimised window waits on.
    /// note  🔴 A host that spins on a zero extent burns a core for as long as the window stays iconified.
    /// cost  ✔️
    /// tag   api, nonthrowing
    void Await();

    /// 🧩 Whether the drawable extent moved since it was last adopted.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool ExtentAltered() const;

    /// 🧩 Marks the standing extent as the one the presentation chain was re-established against.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void AdoptExtent();

    /// 🧩 The opaque native handle, for `06`'s `WindowExchange` and for nothing else.
    /// out   NativeHandle [-]  null while no window is open
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    void* NativeHandle() const;

    /// 🧩 The current drawable extent.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    DisplayExtent CurrentExtent() const;

    /// 🧩 Whether the artist has asked the window system to close this window.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool ClosureRequested() const;

    /// 🧩 The diagnostic keys the validation scenarios are driven by.
    /// note  🔴 Read in EVERY configuration, not only under `SLATE_DEBUG`. Gated to the debug build, these
    ///        compiled out of the Release binary that `Build\Construct.bat` produces by default — so the
    ///        keys silently did nothing, which is indistinguishable from a scenario that ran and passed.
    /// note  🔴 Not a general input mechanism. `14` §4 owns input intent and routes it through the
    ///        interface; this reads four physical keys beneath any interface that could capture them.
    /// note  ⚠️ F11 is deliberately absent. The window manager takes it for fullscreen before the process
    ///        sees it, so a scenario bound there reports nothing and looks like a defect in the scenario.
    /// tag   contract
    enum class DiagnosticKey : std::uint32_t
    {
        RecoverDisplay = 0u,   // [-] - F6 — re-establish the presentation chain once
        ResizeStorm    = 1u,   // [-] - F7 — re-establish it every tick until pressed again
        RecoverDevice  = 2u,   // [-] - F8 — retire and rebuild the device tier
        StateReports   = 3u,   // [-] - F9 — state the diagnostic verdict without exiting
        KeyCount       = 4u    // [-] - the closed count, never a key
    };

    /// 🧩 Whether one diagnostic key went down since the previous Drain — the edge, never the level.
    /// note  ⚠️ Edge-triggered by declaration. A level read fires its scenario once per tick for as long as
    ///        the key is held, which for a device rebuild is a host that never draws again.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    bool KeyDescended(DiagnosticKey Declared) const;

private:

    void*          WindowSlot   = nullptr;   // [-]  - opaque; the GLFW spelling stays in the source file
    DisplayExtent  DrawExtent   = {};        // [px] - refreshed by Drain
    DisplayExtent  AdoptedExtent = {};       // [px] - what the presentation chain was built against
    bool           ClosurePosed = false;     // [-]  - the artist asked; nothing has acted on it yet

    // 📝 Two levels per key so Drain can report the edge. Sized by the enumeration's closed count.
    bool           KeyDown[4]   = {};        // [-]  - down at this Drain
    bool           KeyWas[4]    = {};        // [-]  - down at the previous Drain
};

}   // namespace Slate

//============================================================================================================================================
//                                                          WINDOWINTERCHANGE.CPP
//============================================================================================================================================
// 🧩 Windowing over GLFW, linked dynamically through glfw3dll.lib against glfw3.dll.

#include "SlateMath/Platform/WindowInterchange/Api/WindowInterchange.h"

// 📝 🔴 Linking glfw3.lib — the static library — while glfw3.dll is present produces a build that links and
//    then misbehaves at runtime. The build script links glfw3dll.lib and GLFW_DLL is defined with it.
#include <GLFW/glfw3.h>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                WINDOW SYSTEM LIFETIME
//------------------------------------------------------------------------------------------------------------------------

// 📝 GLFW's own initialisation is process-wide and reference-counted here rather than by the caller, so
//    that a second window does not tear down the first one's window system on close.
namespace
{
    std::uint32_t OpenWindowCount = 0u;   // [-] - windows currently holding the window system open

    bool AcquireWindowSystem()
    {
        if (OpenWindowCount == 0u && glfwInit() != GLFW_TRUE)
            return false;

        ++OpenWindowCount;
        return true;
    }

    void ReleaseWindowSystem()
    {
        if (OpenWindowCount == 0u)
            return;

        --OpenWindowCount;

        if (OpenWindowCount == 0u)
            glfwTerminate();
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OPEN AND CLOSE
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> WindowInterchange::Open(DisplayExtent RequestedExtent, const char* WindowTitle)
{
    if (WindowSlot != nullptr)
        return Deliver<bool>::Deliver(true);

    if (!AcquireWindowSystem())
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the window system declined to start" });

    // 📝 No client API is created. The drawable is surrendered to `06`, which owns everything device-side.
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);

    GLFWwindow* OpenedWindow = glfwCreateWindow(static_cast<int>(RequestedExtent.Width),
                                                static_cast<int>(RequestedExtent.Height),
                                                WindowTitle,
                                                nullptr,
                                                nullptr);

    if (OpenedWindow == nullptr)
    {
        ReleaseWindowSystem();
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the window system declined the window" });
    }

    WindowSlot = OpenedWindow;
    Drain();
    AdoptExtent();

    return Deliver<bool>::Deliver(true);
}

WindowInterchange::~WindowInterchange()
{
    if (WindowSlot == nullptr)
        return;

    glfwDestroyWindow(static_cast<GLFWwindow*>(WindowSlot));
    WindowSlot = nullptr;
    ReleaseWindowSystem();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   DRAIN AND REPORT
//------------------------------------------------------------------------------------------------------------------------

void WindowInterchange::Drain()
{
    if (WindowSlot == nullptr)
        return;

    glfwPollEvents();

    GLFWwindow* OpenedWindow = static_cast<GLFWwindow*>(WindowSlot);

    int DrawWidth  = 0;
    int DrawHeight = 0;
    glfwGetFramebufferSize(OpenedWindow, &DrawWidth, &DrawHeight);

    DrawExtent.Width  = static_cast<std::uint32_t>(DrawWidth  < 0 ? 0 : DrawWidth);
    DrawExtent.Height = static_cast<std::uint32_t>(DrawHeight < 0 ? 0 : DrawHeight);
    ClosurePosed      = glfwWindowShouldClose(OpenedWindow) == GLFW_TRUE;

    // 📝 The previous level is carried before the current one is read, so `KeyDescended` reports the edge
    //    between two Drains rather than the level at one of them.
    // ⚠️ F11 is not among them: the window manager takes it for fullscreen before the process is asked.
    static constexpr int DiagnosticKeyCodes[4] = { GLFW_KEY_F6, GLFW_KEY_F7, GLFW_KEY_F8, GLFW_KEY_F9 };

    for (std::uint32_t KeyOrdinal = 0u; KeyOrdinal < 4u; ++KeyOrdinal)
    {
        KeyWas[KeyOrdinal]  = KeyDown[KeyOrdinal];
        KeyDown[KeyOrdinal] = glfwGetKey(OpenedWindow, DiagnosticKeyCodes[KeyOrdinal]) == GLFW_PRESS;
    }
}

bool WindowInterchange::KeyDescended(DiagnosticKey Declared) const
{
    const std::uint32_t KeyOrdinal = static_cast<std::uint32_t>(Declared);

    if (KeyOrdinal >= static_cast<std::uint32_t>(DiagnosticKey::KeyCount))
        return false;

    return KeyDown[KeyOrdinal] && !KeyWas[KeyOrdinal];
}

void* WindowInterchange::NativeHandle() const
{
    return WindowSlot;
}

DisplayExtent WindowInterchange::CurrentExtent() const
{
    return DrawExtent;
}

bool WindowInterchange::ClosureRequested() const
{
    return ClosurePosed;
}

void WindowInterchange::Await()
{
    if (WindowSlot == nullptr)
        return;

    glfwWaitEvents();
}

bool WindowInterchange::ExtentAltered() const
{
    return DrawExtent.Width  != AdoptedExtent.Width
        || DrawExtent.Height != AdoptedExtent.Height;
}

void WindowInterchange::AdoptExtent()
{
    AdoptedExtent = DrawExtent;
}

}   // namespace Slate

//============================================================================================================================================
//                                                          INTERFACEEXCHANGE.CPP
//============================================================================================================================================
// 🧩 The only translation unit in the engine that includes ImGui.

#include "SlateUI/Interface/InterfaceExchange/Api/InterfaceExchange.h"

#include "imgui.h"

// 📝 🔴 The internal header, for `ImGuiWindow::DockNode` alone. `DockNode` and `SelectedTabId` are the only
//    way to ask whether a DOCKED workspace is the one its node is showing, and the public header exposes
//    no equivalent. Included here and nowhere else — `00` §2.2's one-copy rule is about the library, and
//    this translation unit is already the single place ImGui is spelled.
#include "imgui_internal.h"
#include "backends/imgui_impl_glfw.h"
#include "backends/imgui_impl_vulkan.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  DESCRIPTOR EXTENT
//------------------------------------------------------------------------------------------------------------------------

// 📝 The interface's own descriptor extent, sized here rather than shared with `06`'s `DescriptorIndex`.
//    The interface allocates for its own imagery and for nothing else, so a shared extent would couple two
//    lifetimes that are reclaimed at different moments.
namespace
{
    // 📝 ImGui 19281 replaced VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER with two separate
    //    descriptor types. The pool must carry both:
    //      - SAMPLED_IMAGE  : one set per texture registered via ImGui_ImplVulkan_AddTexture().
    //      - SAMPLER        : one set per built-in sampler (linear + nearest = 2 minimum).
    //    InterfaceSamplerCapacity matches IMGUI_IMPL_VULKAN_MINIMUM_SAMPLER_POOL_SIZE (2)
    //    without pulling imgui_impl_vulkan.h into this translation unit.
    constexpr std::uint32_t InterfaceDescriptorCapacity = 64u;   // [-] sampled-image sets
    constexpr std::uint32_t InterfaceSamplerCapacity    = 2u;    // [-] sampler sets (linear + nearest)
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

InterfaceExchange::~InterfaceExchange()
{
    Reclaim();
}

Deliver<bool> InterfaceExchange::Construct(const InterfaceAttachment& Arriving)
{
    if (ContextSlot != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the interface context already exists" });

    if (Arriving.Instance         == VK_NULL_HANDLE ||
        Arriving.ScoredDevice     == VK_NULL_HANDLE ||
        Arriving.ActiveDevice     == VK_NULL_HANDLE ||
        Arriving.GraphicsQueue    == VK_NULL_HANDLE ||
        Arriving.NativeWindowSlot == nullptr)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::CapabilityAbsent, "a required device or window handle was absent" });
    }

    if (Arriving.ColourTargetFormat == VK_FORMAT_UNDEFINED)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::CapabilityAbsent, "no colour target format was declared" });
    }

    if (Arriving.MinimumDisplayImageCount < 2u ||
        Arriving.DisplayImageCount < Arriving.MinimumDisplayImageCount)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the display image counts are inconsistent" });
    }

    Attached = Arriving;

    // 📝 ImGui 19281 allocates SAMPLED_IMAGE sets for textures and SAMPLER sets for its two
    //    built-in samplers. A pool that carries only COMBINED_IMAGE_SAMPLER has neither type and
    //    the first allocation fails with VK_ERROR_OUT_OF_POOL_MEMORY at validation time.
    const VkDescriptorPoolSize DescriptorExtent[] =
    {
        { VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, InterfaceDescriptorCapacity },
        { VK_DESCRIPTOR_TYPE_SAMPLER,       InterfaceSamplerCapacity    },
    };

    VkDescriptorPoolCreateInfo DescriptorDeclaration = {};
    DescriptorDeclaration.sType         = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    DescriptorDeclaration.flags         = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    DescriptorDeclaration.maxSets       = InterfaceDescriptorCapacity + InterfaceSamplerCapacity;
    DescriptorDeclaration.poolSizeCount = 2u;
    DescriptorDeclaration.pPoolSizes    = DescriptorExtent;

    if (vkCreateDescriptorPool(Attached.ActiveDevice, &DescriptorDeclaration, nullptr, &DescriptorSlot) != VK_SUCCESS)
    {
        Attached = {};
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the interface descriptor extent was refused" });
    }

    IMGUI_CHECKVERSION();
    ImGuiContext* ConstructedContext = ImGui::CreateContext();

    if (ConstructedContext == nullptr)
    {
        vkDestroyDescriptorPool(Attached.ActiveDevice, DescriptorSlot, nullptr);
        DescriptorSlot = VK_NULL_HANDLE;
        Attached       = {};
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the interface context was not constructed" });
    }

    ContextSlot = static_cast<void*>(ConstructedContext);

    ImGui::StyleColorsDark();

    // 🔴 Docking, enabled here and nowhere else. The submodule stands on ImGui's `docking` branch and the
    //    whole feature is inert until this flag is raised — the branch carries the code, not the behaviour.
    // 📝 ⚠️ Multi-viewport is deliberately NOT raised. It hands panels to the window manager as real OS
    //    windows, each with its own swapchain, and every swapchain in this process belongs to
    //    `DisplayScheduler` against one surface. Raising it would stand a second, unowned chain outside
    //    `HostLifecycle`'s five lifetimes and outside its resize and rebuild paths both.
    ImGui::GetIO().ConfigFlags |= ImGuiConfigFlags_DockingEnable;

    // 📝 The window system attachment installs its own callbacks. `04`'s `InputExchange` keeps its arrival
    //    stamps regardless: the interface reads the accumulated window condition, and the stroke path reads
    //    the stamped arrival ordering. They observe the same device through two surfaces that never merge.
    if (!ImGui_ImplGlfw_InitForVulkan(static_cast<GLFWwindow*>(Attached.NativeWindowSlot), true))
    {
        Reclaim();
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the window system attachment declined" });
    }

    WindowAttached = true;

    VkFormat DeclaredColourFormat = Attached.ColourTargetFormat;

    VkPipelineRenderingCreateInfoKHR RecordingDeclaration = {};
    RecordingDeclaration.sType                   = VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO_KHR;
    RecordingDeclaration.colorAttachmentCount    = 1u;
    RecordingDeclaration.pColorAttachmentFormats = &DeclaredColourFormat;

    ImGui_ImplVulkan_InitInfo VendorAttachment = {};
    VendorAttachment.ApiVersion                                     = VK_API_VERSION_1_3;
    VendorAttachment.Instance                                       = Attached.Instance;
    VendorAttachment.PhysicalDevice                                 = Attached.ScoredDevice;
    VendorAttachment.Device                                         = Attached.ActiveDevice;
    VendorAttachment.QueueFamily                                    = Attached.GraphicsFamilyOrdinal;
    VendorAttachment.Queue                                          = Attached.GraphicsQueue;
    VendorAttachment.DescriptorPool                                 = DescriptorSlot;
    VendorAttachment.MinImageCount                                  = Attached.MinimumDisplayImageCount;
    VendorAttachment.ImageCount                                     = Attached.DisplayImageCount;
    VendorAttachment.UseDynamicRendering                            = true;
    VendorAttachment.PipelineInfoMain.PipelineRenderingCreateInfo   = RecordingDeclaration;

    if (!ImGui_ImplVulkan_Init(&VendorAttachment))
    {
        Reclaim();
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the vendor attachment declined" });
    }

    VendorAttached = true;

    // 🔴 The retained workspace seat, re-applied. `ImGui::CreateContext` above begins at the vendor's
    //    defaults and `StyleColorsDark` overwrites the lot — so a style seated once at bring-up was lost on
    //    every device rebuild, and the trapezoidal tabs reverted to stock rectangles.
    if (StyleSeated)
        Disregard(SeatWorkspaceStyle(SeatedMeasure, SeatedInk));

    return Deliver<bool>::Deliver(true);
}

void InterfaceExchange::Reclaim()
{
    if (ContextSlot == nullptr)
        return;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    if (Attached.ActiveDevice != VK_NULL_HANDLE)
        vkDeviceWaitIdle(Attached.ActiveDevice);

    // 📝 🔴 Each shutdown is gated on its own attachment having stood. The vendor shutdown asserts on a
    //    backend that was never initialised, so the failure path out of Construct used to abort the
    //    process instead of reporting the refusal it had already built.
    if (VendorAttached)
        ImGui_ImplVulkan_Shutdown();

    if (WindowAttached)
        ImGui_ImplGlfw_Shutdown();

    ImGui::DestroyContext(static_cast<ImGuiContext*>(ContextSlot));

    if (DescriptorSlot != VK_NULL_HANDLE)
    {
        vkDestroyDescriptorPool(Attached.ActiveDevice, DescriptorSlot, nullptr);
        DescriptorSlot = VK_NULL_HANDLE;
    }

    ContextSlot      = nullptr;
    TickOpen         = false;
    ContentAssembled = false;
    WorkspaceEntered = false;
    WindowAttached   = false;
    VendorAttached   = false;
    Attached         = {};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE TICK
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> InterfaceExchange::Advance()
{
    if (ContextSlot == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no interface context is constructed" });

    if (TickOpen)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "a tick is already open" });

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    ImGui_ImplVulkan_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();

    TickOpen         = true;
    ContentAssembled = false;
    WorkspaceEntered = false;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> InterfaceExchange::Seal()
{
    if (!TickOpen)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no tick is open" });

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));
    LeaveWorkspaceWindow();
    ImGui::Render();

    TickOpen         = false;
    ContentAssembled = true;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> InterfaceExchange::Abandon()
{
    if (!TickOpen)
        return Deliver<bool>::Deliver(true);

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));
    LeaveWorkspaceWindow();
    ImGui::EndFrame();

    TickOpen         = false;
    ContentAssembled = false;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE WORKSPACE STYLE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

/// 🧩 One Slate ink as the vendor's four unit ordinates.
/// cost  ✔️
ImVec4 Vendor(InkOrdinate Ink)
{
    return ImVec4(static_cast<float>(Ink.Red)     / 255.0f,
                  static_cast<float>(Ink.Green)   / 255.0f,
                  static_cast<float>(Ink.Blue)    / 255.0f,
                  static_cast<float>(Ink.Opacity) / 255.0f);
}

}   // namespace

Deliver<bool> InterfaceExchange::SeatWorkspaceStyle(const WorkspaceMetric& Measure, const WorkspaceInk& Tinted)
{
    // 🔴 Retained BEFORE the context is tested, so a seat asked for while no context stands is applied by
    //    the next Construct rather than silently dropped.
    SeatedMeasure = Measure;
    SeatedInk     = Tinted;
    StyleSeated   = true;

    if (ContextSlot == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no interface context stands" });

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    ImGuiStyle& Seated = ImGui::GetStyle();

    // 🔴 The four members `Patches/` adds. Each defaults to 0.0f, at which a patched build rasterises
    //    byte-identically to an unpatched one — so seating them here is what turns the sheet's trapezoid on.
    Seated.TabSlant       = Measure.TabSlant;
    Seated.TabOverlap     = Measure.TabOverlap;
    Seated.TabHeight      = Measure.TabAcross;
    Seated.TabStripPadTop = Measure.StripPadTop;

    // ⚠️ Coupled with TabOverlap: the sheet's 38 px padding exists to clear the slant plus the overlap.
    Seated.FramePadding.x = Measure.TabPadAlong;

    // 📝 The sheet rounds nothing and strokes nothing. Both configurable, both zero here, which is what
    //    `DockWorkspace.html` states — `roundCorners` is off and no tab carries a border.
    Seated.TabRounding   = Measure.TabRadius;
    Seated.TabBorderSize = Measure.TabEdgeWeight;

    Seated.Colors[ImGuiCol_Tab]               = Vendor(Tinted.TabQuiet);
    Seated.Colors[ImGuiCol_TabHovered]        = Vendor(Tinted.TabRoused);
    Seated.Colors[ImGuiCol_TabSelected]       = Vendor(Tinted.TabTaken);
    Seated.Colors[ImGuiCol_TabDimmed]         = Vendor(Tinted.TabQuiet);
    Seated.Colors[ImGuiCol_TabDimmedSelected] = Vendor(Tinted.TabTaken);
    Seated.Colors[ImGuiCol_Text]              = Vendor(Tinted.TabInkTaken);

    // 🔴 The dock node's own chrome, silenced. A docked workspace's tabs are drawn by the node, and the
    //    vendor frames them with a title bar, an overline above the selected tab and a bar border — none
    //    of which `DockWorkspace.html` has. Left seated, they read as a blue band across the strip.
    Seated.Colors[ImGuiCol_TitleBg]                   = Vendor(Tinted.StripGround);
    Seated.Colors[ImGuiCol_TitleBgActive]             = Vendor(Tinted.StripGround);
    Seated.Colors[ImGuiCol_WindowBg]                  = Vendor(Tinted.BodyGround);
    Seated.Colors[ImGuiCol_DockingEmptyBg]            = Vendor(Tinted.BodyGround);
    Seated.Colors[ImGuiCol_TabSelectedOverline]       = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    Seated.Colors[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);

    Seated.TabBarBorderSize = 0.0f;
    Seated.WindowRounding   = 0.0f;

    // 📝 The sheet's min-width and max-width. `TabMinWidthShrink` is held at the same figure so a crowded
    //    strip scrolls rather than shrinking its tabs below the width the slant was measured against.
    Seated.TabMinWidthBase   = Measure.TabAlongFloor;
    Seated.TabMinWidthShrink = Measure.TabAlongFloor;

    // 🔴 The close mark stands on EVERY tab, selected or not. The vendor hides it on unselected tabs until
    //    hovered; the sheet draws it on all of them, and a mark that appears only under the pointer is one
    //    the artist cannot see to aim at.
    Seated.TabCloseButtonMinWidthSelected   = -1.0f;
    Seated.TabCloseButtonMinWidthUnselected = -1.0f;

    // 🔴 A disc rather than a slab, for the close mark and the strip's `+` both — `Patches/`'s PatchC.
    //    Stated as a fraction of the control's own extent, so `ScaleAllSizes` must not scale it and does
    //    not. Left unseated the member defaults to 0.0f, at which PatchC's branch never runs and both
    //    controls render as the vendor's rectangles — which is exactly how they shipped.
    Seated.TabButtonRounding = 1.0f;

    // 🔴 A workspace dragged out ALONE keeps a tab bar, so it carries the sheet's trapezoid on its grey
    //    strip instead of degrading to a plain caption. Seated on the context rather than per window
    //    because it governs the docking system as a whole.
    ImGui::GetIO().ConfigDockingAlwaysTabBar = true;

    return Deliver<bool>::Deliver(true);
}

bool InterfaceExchange::RecordWorkspaceAddition(const PlaneExtent&  Extent,
                                                std::uint32_t       OpenCount,
                                                std::uint32_t&      AskingNode)
{
    (void)Extent;
    (void)OpenCount;

    AskingNode = 0u;

    if (ContextSlot == nullptr || !TickOpen)
        return false;

    ImGuiContext& Standing = *static_cast<ImGuiContext*>(ContextSlot);

    ImGui::SetCurrentContext(&Standing);

    // 🔴 EVERY node carries a `+`, floating ones included, and each reports ITSELF when pressed. A torn-out
    //    float otherwise had no way to add a workspace beside it, and a `+` that reported only "pressed"
    //    had the caller seat the new workspace into the main dock space — so pressing it on one strip
    //    added the workspace to another window.
    bool Pressed = false;

    for (int Ordinal = 0; Ordinal < Standing.DockContext.Nodes.Data.Size; ++Ordinal)
    {
        ImGuiDockNode* Node = static_cast<ImGuiDockNode*>(Standing.DockContext.Nodes.Data[Ordinal].val_p);

        // ⚠️ Only a leaf that actually laid out a tab bar this tick. A split node holds no tabs, and a
        //    node whose bar was never built has nothing to amend.
        if (Node == nullptr || Node->IsSplitNode() || Node->TabBar == nullptr)
            continue;

        if (!ImGui::DockNodeBeginAmendTabBar(Node))
            continue;

        // 🔴 NO section flag. `Trailing` right-aligns a button against the bar's far edge — yards from the
        //    last tab, with the scroll arrows between — and the sheet seats its `addBtn` immediately after
        //    the tabs. An unflagged button lands in the central section, which flows straight on from the
        //    last tab, and it scrolls with them.
        // 📝 The identity is scoped by `DockNodeBeginAmendTabBar`'s own `PushOverrideID(node->ID)`, so two
        //    strips cannot collide; an extra PushID here would only add a second seed to no purpose.
        if (ImGui::TabItemButton("+", ImGuiTabItemFlags_NoTooltip))
        {
            Pressed    = true;
            AskingNode = static_cast<std::uint32_t>(Node->ID);
        }

        ImGui::DockNodeEndAmendTabBar();
    }

    return Pressed;
}

bool InterfaceExchange::VacantPressed(const PlaneExtent& Extent)
{
    if (ContextSlot == nullptr || !TickOpen)
        return false;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    ImGui::SetNextWindowPos(ImVec2(Extent.LeastAlong, Extent.LeastAcross));
    ImGui::SetNextWindowSize(ImVec2(Extent.SpanAlong(), Extent.SpanAcross()));

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleColor(ImGuiCol_Button,        ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(1.0f, 1.0f, 1.0f, 0.03f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive,  ImVec4(1.0f, 1.0f, 1.0f, 0.06f));

    bool Pressed = false;

    if (ImGui::Begin("SlateVacantShell", nullptr, ImGuiWindowFlags_NoTitleBar
                                                | ImGuiWindowFlags_NoResize
                                                | ImGuiWindowFlags_NoMove
                                                | ImGuiWindowFlags_NoScrollbar
                                                | ImGuiWindowFlags_NoSavedSettings
                                                | ImGuiWindowFlags_NoDocking
                                                | ImGuiWindowFlags_NoBringToFrontOnFocus
                                                | ImGuiWindowFlags_NoBackground))
    {
        // 📝 An invisible full-extent control. The run itself is recorded by `WorkspacePanel` on the shell
        //    ground, so this contributes the hit area and nothing visible but the hover wash.
        Pressed = ImGui::Button("##SlateCreatePanel", ImVec2(-1.0f, -1.0f));
    }

    ImGui::End();

    ImGui::PopStyleColor(3);
    ImGui::PopStyleVar();

    return Pressed;
}

void InterfaceExchange::RecordDockSpace(const PlaneExtent& Extent)
{
    if (ContextSlot == nullptr || !TickOpen)
        return;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    ImGui::SetNextWindowPos(ImVec2(Extent.LeastAlong, Extent.LeastAcross));
    ImGui::SetNextWindowSize(ImVec2(Extent.SpanAlong(), Extent.SpanAcross()));

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);

    const ImGuiWindowFlags Bare = ImGuiWindowFlags_NoTitleBar
                                | ImGuiWindowFlags_NoResize
                                | ImGuiWindowFlags_NoMove
                                | ImGuiWindowFlags_NoScrollbar
                                | ImGuiWindowFlags_NoScrollWithMouse
                                | ImGuiWindowFlags_NoSavedSettings
                                | ImGuiWindowFlags_NoBringToFrontOnFocus
                                | ImGuiWindowFlags_NoNavFocus
                                | ImGuiWindowFlags_NoBackground;

    if (ImGui::Begin("SlateWorkspaceBody", nullptr, Bare))
    {
        // 🔴 `PassthruCentralNode` so the workspace ground shows through where nothing is docked. Without
        //    it the vendor fills the whole node with its own colour and the sheet's OLED body is lost.
        // 🔴 `PassthruCentralNode` so the workspace ground shows through where nothing is docked; the two
        //    button flags remove the node's own close widget and menu triangle, which the sheet has not.
        // 📝 The two button flags live in `ImGuiDockNodeFlagsPrivate_`, so the set is composed as the
        //    integral type the parameter takes rather than by mixing two enumerations, which C++20
        //    deprecates and `-Wdeprecated-enum-enum-conversion` reports.
        const ImGuiDockNodeFlags NodeFlags =
              static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_PassthruCentralNode)
            | static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoCloseButton)
            | static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoWindowMenuButton);

        ImGui::DockSpace(ImGui::GetID("SlateDockSpace"), ImVec2(0.0f, 0.0f), NodeFlags);
    }

    ImGui::End();

    ImGui::PopStyleVar(2);
}

void InterfaceExchange::RecordWorkspaceWindow(const char* Titled,
                                                bool Docked,
                                                std::uint32_t IntoNode,
                                                bool& Standing)
{
    static_cast<void>(EnterWorkspaceWindow(Titled, Docked, IntoNode, Standing));
    LeaveWorkspaceWindow();
}

PlaneExtent InterfaceExchange::EnterWorkspaceWindow(const char* Titled,
                                                     bool Docked,
                                                     std::uint32_t IntoNode,
                                                     bool& Standing)
{
    if (ContextSlot == nullptr || !TickOpen || Titled == nullptr || WorkspaceEntered)
        return {};

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    // 🔴 Seated into the node that ASKED for it, not always the main dock space. A workspace enrolled by
    //    a torn-out float's `+` otherwise appeared in the other window, which is not where the artist
    //    pressed. Zero means no node was named and the main space is correct.
    if (Docked)
    {
        const ImGuiID Destination = (IntoNode != 0u)
                                  ? static_cast<ImGuiID>(IntoNode)
                                  : ImGui::GetID("SlateDockSpace");

        ImGui::SetNextWindowDockID(Destination, ImGuiCond_Always);
    }

    // 🔴 ⚠️ `NoTitleBar` is deliberately NOT set. `GetWindowAlwaysWantOwnTabBar` refuses a tab bar to any
    //    window carrying it, so hiding the caption that way also denied a lone floating workspace the
    //    strip that gives it the sheet's trapezoid. Docked, the node's tab bar replaces the caption;
    //    floating, the window gets a tab bar of its own and no caption is drawn either.
    ImGuiWindowClass Declared;
    Declared.DockingAlwaysTabBar = true;

    // 📝 A lone float's own node gets the same two silences as the main dock space, so a torn-off
    //    workspace does not sprout the caret and close widget the docked one has none of.
    Declared.DockNodeFlagsOverrideSet = static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoWindowMenuButton)
                                      | static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoCloseButton);

    ImGui::SetNextWindowClass(&Declared);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));

    const bool Presented = ImGui::Begin(Titled, &Standing, ImGuiWindowFlags_NoScrollbar
                                                           | ImGuiWindowFlags_NoScrollWithMouse
                                                           | ImGuiWindowFlags_NoCollapse);
    WorkspaceEntered = true;

    if (!Presented)
        return {};

    const ImVec2 Origin    = ImGui::GetCursorScreenPos();
    const ImVec2 Available = ImGui::GetContentRegionAvail();
    return { Origin.x, Origin.y, Origin.x + Available.x, Origin.y + Available.y };
}

void InterfaceExchange::LeaveWorkspaceWindow()
{
    if (ContextSlot == nullptr || !WorkspaceEntered)
        return;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));
    ImGui::End();
    ImGui::PopStyleVar();
    WorkspaceEntered = false;
}

bool InterfaceExchange::WorkspacePresented(const char* Titled) const
{
    if (ContextSlot == nullptr || !TickOpen || Titled == nullptr)
        return false;

    ImGuiContext* Context = static_cast<ImGuiContext*>(ContextSlot);
    ImGuiWindow*  Window  = ImGui::FindWindowByName(Titled);
    if (Window == nullptr)
        return false;

    if (Window->DockNode != nullptr)
        return Window->DockNode->SelectedTabId == Window->TabId;

    return (Context->NavWindow == Window);
}

Deliver<bool> InterfaceExchange::Renegotiate(std::uint32_t MinimumImageCount, std::uint32_t ImageCount)
{
    if (ContextSlot == nullptr || !VendorAttached)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no vendor attachment stands" });

    if (MinimumImageCount < 2u || ImageCount < MinimumImageCount)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the display image counts are inconsistent" });

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    // Dear ImGui 1.92.9 exposes runtime renegotiation of the requested minimum. The actual count is supplied
    //    at construction and retained here beside the new chain count; it is never replaced by Slate's slot count.
    ImGui_ImplVulkan_SetMinImageCount(MinimumImageCount);

    Attached.MinimumDisplayImageCount = MinimumImageCount;
    Attached.DisplayImageCount        = ImageCount;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> InterfaceExchange::Record(VkCommandBuffer CommandRecording)
{
    if (!ContentAssembled)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "nothing has been sealed for recording" });

    if (CommandRecording == VK_NULL_HANDLE)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no command recording was supplied" });

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    ImDrawData* AssembledContent = ImGui::GetDrawData();

    if (AssembledContent == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the sealed content was not assembled" });

    // 📝 A display extent of zero — a minimised window — assembles content that covers nothing. Recording it
    //    is legal and costs a recorded nothing; skipping it here keeps the recording out of the rotation's
    //    measured duration entirely.
    if (AssembledContent->DisplaySize.x <= 0.0f || AssembledContent->DisplaySize.y <= 0.0f)
    {
        ContentAssembled = false;
        return Deliver<bool>::Deliver(true);
    }

    ImGui_ImplVulkan_RenderDrawData(AssembledContent, CommandRecording);
    ContentAssembled = false;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       CAPTURE
//------------------------------------------------------------------------------------------------------------------------

// 📝 The capture reads go through SetCurrentContext rather than reaching into the context directly. Only
//    `imgui_internal.h` defines ImGuiContext; `imgui.h` forward-declares it, so a member read here would not
//    compile without dragging the internal header into the seam. The accessor route reads the same two bits.
bool InterfaceExchange::PointerCaptured() const
{
    if (ContextSlot == nullptr)
        return false;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    return ImGui::GetIO().WantCaptureMouse;
}

void InterfaceExchange::WithholdPointer()
{
    if (ContextSlot == nullptr)
        return;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    // 📝 Both flags. `WantCaptureMouse` is what a host reads to decide whether the interface owns the
    //    contact; `WantCaptureMouseUnlessPopupClose` is the variant the vendor's own widgets consult, and
    //    leaving it raised let a window under the drawer still act on the click.
    ImGuiIO& Arrived = ImGui::GetIO();

    Arrived.WantCaptureMouse                  = false;
    Arrived.WantCaptureMouseUnlessPopupClose  = false;

    // 🔴 The flags alone are not enough. They say who SHOULD receive the next contact; they do nothing
    //    about a widget that has already seized this one. A tab dragged out, or a window being moved, is
    //    held by the active identity and by `MovingWindow` — so a drag begun on a drawer's tongue while a
    //    tab sat beneath it moved BOTH, the drawer by its own arbitration and the tab by the vendor's.
    // ⚠️ Released rather than suppressed. The vendor re-acquires whatever the pointer is genuinely over
    //    on the next tick, so nothing here has to be restored.
    // 🔴 The active identity is released whatever holds it, not only a window move. A RESIZE grip sets
    //    `ActiveId` and leaves `MovingWindow` null, so a drawer dragged from a display corner also
    //    stretched the window beneath it — the drawer travelled by Slate's arbitration and the window
    //    resized by the vendor's, from one contact.
    ImGuiContext& Standing = *static_cast<ImGuiContext*>(ContextSlot);

    if (Standing.ActiveId != 0)
        ImGui::ClearActiveID();

    Standing.MovingWindow = nullptr;

    // 📝 The hovered identity too. Left standing, the resize grip the pointer crossed keeps its cursor and
    //    re-seizes the contact the moment the drawer lets go of it.
    Standing.HoveredId             = 0;
    Standing.HoveredIdAllowOverlap = false;

    // 📝 The tab bar's own reorder request, which lives beside the active identity rather than in it. A
    //    tab already being shuffled along its strip keeps travelling on this alone.
    if (Standing.CurrentTabBar != nullptr)
    {
        Standing.CurrentTabBar->ReorderRequestTabId = 0;
        Standing.CurrentTabBar->ReorderRequestOffset = 0;
    }
}

bool InterfaceExchange::KeyboardCaptured() const
{
    if (ContextSlot == nullptr)
        return false;

    ImGui::SetCurrentContext(static_cast<ImGuiContext*>(ContextSlot));

    return ImGui::GetIO().WantCaptureKeyboard;
}

}   // namespace Slate

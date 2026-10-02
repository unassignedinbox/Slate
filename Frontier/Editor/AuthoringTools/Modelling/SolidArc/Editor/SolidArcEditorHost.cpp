//=============================================================================================================================================
// SolidArcEditorHost.cpp
//=============================================================================================================================================

#include "SolidArcEditorHost.h"
#include "../../../../../Engine/Editor/EditorStyleSpecification.h"
#include "../../../../../Engine/Editor/ShadeTick.h"
#include "../../../../../Engine/Editor/SunInspectorPanel.h"
#include "../../../../../Engine/DisplayPresentation/FidelityClassifier.h"
#include "../../../../../Engine/DisplayPresentation/IconPresentation.h"

#include <imgui.h>
#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <utility>

namespace Frontier {

namespace
{
// The Construct menu: every figure the console builds from numbers alone, each in the section the web catalogue files
//    it under. The order here is the order of ConstructCommand's cases.
constexpr ViewportConstructTile kConstructTiles[] =
{
    { "Reference",   "Plane",         ConstructGlyph::Plane,           ""  },
    { "Sketch Draw", "Line",          ConstructGlyph::Line,            "L" },
    { "Sketch Draw", "Polyline",      ConstructGlyph::Polyline,        ""  },
    { "Sketch Draw", "Rectangle",     ConstructGlyph::Rectangle,       "R" },
    { "Sketch Draw", "Centre Rect.",  ConstructGlyph::CentreRectangle, ""  },
    { "Sketch Draw", "Slot",          ConstructGlyph::Slot,            ""  },
    { "Sketch Draw", "Circle",        ConstructGlyph::Circle,          "C" },
    { "Sketch Draw", "Arc",           ConstructGlyph::Arc,             "A" },
    { "Sketch Draw", "Ellipse",       ConstructGlyph::Ellipse,         ""  },
    { "Sketch Draw", "Polygon",       ConstructGlyph::Polygon,         "P" },
    { "Sketch Draw", "Spline",        ConstructGlyph::Spline,          ""  },
    { "Sketch Draw", "Control Curve", ConstructGlyph::ControlCurve,    ""  },
    { "Solid",       "Box",           ConstructGlyph::Box,             ""  },
    { "Solid",       "Sphere",        ConstructGlyph::Sphere,          ""  },
    { "Solid",       "Cylinder",      ConstructGlyph::Cylinder,        ""  },
    { "Solid",       "Cone",          ConstructGlyph::Cone,            ""  },
    { "Solid",       "Torus",         ConstructGlyph::Torus,           ""  },
    { "Surface",     "Sphere Sheet",  ConstructGlyph::Sphere,          ""  },
    { "Surface",     "Cylinder Sheet", ConstructGlyph::Cylinder,       ""  },
    { "Surface",     "Cone Sheet",    ConstructGlyph::Cone,            ""  },
    { "Surface",     "Torus Sheet",   ConstructGlyph::Torus,           ""  },
    { "Surface",     "Patch",         ConstructGlyph::Patch,           ""  },
    { "Reference",   "XY Workplane",  ConstructGlyph::Plane,           ""  },
    { "Reference",   "XZ Workplane",  ConstructGlyph::Plane,           ""  },
    { "Reference",   "YZ Workplane",  ConstructGlyph::Plane,           ""  },
    { "Sketch Draw", "Aircraft Rib",  ConstructGlyph::Spline,          ""  },
    { "Solid",       "Turbofan Engine", ConstructGlyph::Cylinder,       ""  },
};
constexpr uint32_t kConstructTileCount = static_cast<uint32_t>(sizeof(kConstructTiles) / sizeof(kConstructTiles[0]));

// The console line that places tile Index with its centre at (X, Y) on the workplane: every size is a default a
//    person can see at once and move afterwards. An empty string means the tile does not exist.
std::string ConstructCommand(uint32_t Index, double X, double Y) noexcept
{
    if (Index == 26u)
    {
        // A high-detail, editable two-spool turbofan assembly. The fan blades are real extruded closed profiles rather
        // than a texture; the nacelle/core are analytic sheets, while rings, hub, spinner, shaft, struts and pylon remain
        // individually selectable solids. Its shaft follows +Y, preserving the application's global right-handed Z-up frame.
        std::ostringstream Command;
        Command.setf(std::ios::fixed);
        Command.precision(3);
        Command << "workplane xz; ";
        constexpr int BladeCount = 14;
        for (int Blade = 0; Blade < BladeCount; ++Blade)
        {
            const double Angle = 6.283185307179586 * static_cast<double>(Blade) / static_cast<double>(BladeCount);
            const auto Point = [](double Radius, double A) { return std::pair<double, double>{ Radius * std::cos(A), Radius * std::sin(A) }; };
            const auto RootLead = Point(0.92, Angle - 0.11);
            const auto TipLead = Point(3.02, Angle + 0.18);
            const auto TipTrail = Point(3.02, Angle + 0.36);
            const auto RootTrail = Point(0.92, Angle + 0.13);
            char Name[24];
            std::snprintf(Name, sizeof(Name), "%02d", Blade + 1);
            Command << "polyline (" << RootLead.first << ',' << RootLead.second << ") ("
                    << TipLead.first << ',' << TipLead.second << ") (" << TipTrail.first << ',' << TipTrail.second
                    << ") (" << RootTrail.first << ',' << RootTrail.second << ") --closed --name=FanBladeSketch" << Name << "; "
                    << "extrude FanBladeSketch" << Name << " 0.38 --name=FanBlade" << Name << "; ";
        }
        Command << "cylinder (0,-0.10,0) 3.48 5.80 --axis=(0,1,0) --sheet --name=BypassDuct; "
                << "cylinder (0,0.20,0) 1.28 4.70 --axis=(0,1,0) --sheet --name=CoreCase; "
                << "cone (0,4.90,0) 1.30 0.82 1.80 --axis=(0,1,0) --sheet --name=ExhaustCone; "
                << "torus (0,5.70,0) 0.92 0.16 --axis=(0,1,0) --name=ExhaustRing; "
                << "torus (0,3.90,0) 2.95 0.20 --axis=(0,1,0) --name=RearCaseRing; "
                << "torus (0,0.05,0) 2.05 0.12 --axis=(0,1,0) --name=FanDisk; "
                << "cylinder (0,-0.28,0) 0.78 1.15 --axis=(0,1,0) --name=FanHub; "
                << "cylinder (0,-0.05,0) 0.24 6.25 --axis=(0,1,0) --name=MainShaft; "
                << "cone (0,-0.82,0) 0.10 0.80 0.82 --axis=(0,1,0) --name=Spinner; "
                << "sphere (3.30,2.55,-0.35) 0.58 --name=AccessoryGearbox; "
                << "box (-0.34,1.20,3.20) (0.34,4.35,4.55) --name=EnginePylon; "
                << "box (-0.13,0.30,-3.25) (0.13,3.70,3.25) --name=VerticalFrame; "
                << "box (-3.25,0.30,-0.13) (3.25,3.70,0.13) --name=HorizontalFrame; "
                << "torus (0,-0.18,0) 3.52 0.48 --axis=(0,1,0) --name=TurbofanEngine";
        return Command.str();
    }

    char Line[1280];
    switch (Index)
    {
    case 0:  std::snprintf(Line, sizeof(Line), "plane (%.3f,%.3f,0) 1.4 1.4", X - 0.7, Y - 0.7); break;
    case 1:  std::snprintf(Line, sizeof(Line), "line (%.3f,%.3f) (%.3f,%.3f)", X - 0.7, Y - 0.5, X + 0.7, Y + 0.5); break;
    case 2:  std::snprintf(Line, sizeof(Line), "polyline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.5, X - 0.3, Y + 0.5, X + 0.3, Y - 0.2, X + 0.8, Y + 0.5); break;
    case 3:  std::snprintf(Line, sizeof(Line), "rect (%.3f,%.3f) (%.3f,%.3f)", X - 0.7, Y - 0.5, X + 0.7, Y + 0.5); break;
    case 4:  std::snprintf(Line, sizeof(Line), "rect (%.3f,%.3f) (%.3f,%.3f) --center", X, Y, X + 0.7, Y + 0.5); break;
    case 5:  std::snprintf(Line, sizeof(Line), "slot (%.3f,%.3f) (%.3f,%.3f) 0.25", X - 0.5, Y, X + 0.5, Y); break;
    case 6:  std::snprintf(Line, sizeof(Line), "circle (%.3f,%.3f) 0.6", X, Y); break;
    case 7:  std::snprintf(Line, sizeof(Line), "arc (%.3f,%.3f) 0.7 -60 240", X, Y); break;
    case 8:  std::snprintf(Line, sizeof(Line), "ellipse (%.3f,%.3f) 0.8 0.45", X, Y); break;
    case 9: std::snprintf(Line, sizeof(Line), "polygon (%.3f,%.3f) 0.6 6", X, Y); break;
    case 10: std::snprintf(Line, sizeof(Line), "spline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.3, X - 0.3, Y + 0.5, X + 0.3, Y - 0.5, X + 0.8, Y + 0.3); break;
    case 11: std::snprintf(Line, sizeof(Line), "cpcurve (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f)",
                           X - 0.8, Y - 0.3, X - 0.3, Y + 0.6, X + 0.3, Y - 0.6, X + 0.8, Y + 0.3); break;
    case 12: std::snprintf(Line, sizeof(Line), "box (%.3f,%.3f,0) 1 1 1", X - 0.5, Y - 0.5); break;
    case 13: std::snprintf(Line, sizeof(Line), "sphere (%.3f,%.3f,0.6) 0.6", X, Y); break;
    case 14: std::snprintf(Line, sizeof(Line), "cylinder (%.3f,%.3f,0) 0.45 1.2", X, Y); break;
    case 15: std::snprintf(Line, sizeof(Line), "cone (%.3f,%.3f,0) 0.6 0.15 1.2", X, Y); break;
    case 16: std::snprintf(Line, sizeof(Line), "torus (%.3f,%.3f,0.3) 0.6 0.25", X, Y); break;
    case 17: std::snprintf(Line, sizeof(Line), "sphere (%.3f,%.3f,0.6) 0.6 --sheet", X, Y); break;
    case 18: std::snprintf(Line, sizeof(Line), "cylinder (%.3f,%.3f,0) 0.45 1.2 --sheet", X, Y); break;
    case 19: std::snprintf(Line, sizeof(Line), "cone (%.3f,%.3f,0) 0.6 0.15 1.2 --sheet", X, Y); break;
    case 20: std::snprintf(Line, sizeof(Line), "torus (%.3f,%.3f,0.3) 0.6 0.25 --sheet", X, Y); break;
    case 21:
    {
        // A three-by-three net with a hump in the middle: row-major, degree 2.
        int Used = std::snprintf(Line, sizeof(Line), "patch 3 3 --degree=2");
        for (int Row = 0; Row < 3; ++Row)
            for (int Column = 0; Column < 3; ++Column)
                Used += std::snprintf(Line + Used, sizeof(Line) - static_cast<size_t>(Used), " (%.3f,%.3f,%.3f)",
                                      X + (Column - 1) * 0.7, Y + (Row - 1) * 0.7, (Row == 1 && Column == 1) ? 0.5 : 0.0);
        break;
    }
    case 22: std::snprintf(Line, sizeof(Line), "workplane xy"); break;
    case 23: std::snprintf(Line, sizeof(Line), "workplane xz"); break;
    case 24: std::snprintf(Line, sizeof(Line), "workplane yz"); break;
    case 25:
        // A real aircraft wing-rib sketch on the vertical XZ workplane: cambered closed skin, three lightening holes,
        // a rounded rear spar slot and a construction chord. It remains editable as six ordinary sketch figures.
        std::snprintf(Line, sizeof(Line),
            "workplane xz; "
            "line (%.3f,%.3f) (%.3f,%.3f) --construction --name=RibChord; "
            "circle (%.3f,%.3f) 0.45 --name=LighteningA; "
            "circle (%.3f,%.3f) 0.55 --name=LighteningB; "
            "circle (%.3f,%.3f) 0.40 --name=LighteningC; "
            "slot (%.3f,%.3f) (%.3f,%.3f) 0.18 --name=RearSpar; "
            "spline (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) "
            "(%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) (%.3f,%.3f) --closed --name=AircraftRib",
            X - 4.5, Y, X + 4.5, Y,
            X - 2.1, Y, X - 0.1, Y, X + 1.9, Y,
            X + 2.8, Y - 0.15, X + 3.6, Y - 0.15,
            X - 4.5, Y, X - 3.5, Y + 0.55, X - 1.5, Y + 0.85, X + 1.5, Y + 0.75,
            X + 3.5, Y + 0.35, X + 4.5, Y, X + 3.5, Y - 0.18, X + 1.5, Y - 0.32,
            X - 1.5, Y - 0.42, X - 3.5, Y - 0.30);
        break;
    default: return std::string();
    }
    return std::string(Line);
}
}

SolidArcEditorHost::SolidArcEditorHost() noexcept
{
    Outliner_.AssignControls(&Controls_);
    Viewport_.AssignControls(&Controls_);
    Inspector_.AssignControls(&Controls_);
    Outliner_.AssignTabOpen(&OutlinerTabOpen_);
    Viewport_.AssignTabOpen(&ViewportTabOpen_);
    Inspector_.AssignTabOpen(&InspectorTabOpen_);
    Outliner_.AssignWindowTitle("SolidArc Outliner");
    Viewport_.AssignWindowTitle("SolidArc Viewport");
    Inspector_.AssignWindowTitle("SolidArc Inspector");
    Inspector_.AssignGlassCards(true);
    Outliner_.AssignDocumentStyle(true);
    // SolidArc uses its CAD filter catalogue, not Project-Zero's game narrowing labels.
    // Colours match the web editor palette: curve/sketch #4fd8e0, body #ffb454,
    // surface #4da3ff, construction plane #b48cff, dimensions #e5d33a and constraints #ff6b8a.
    const OutlinerFilterEntry SolidArcFilters[] =
    {
        { "Lines",        IM_COL32(79, 216, 224, 255), SolidArcOutlinerFilter::Lines },
        { "Profiles",     IM_COL32(79, 216, 224, 255), SolidArcOutlinerFilter::Profiles },
        { "Bodies",       IM_COL32(255, 180, 84, 255), SolidArcOutlinerFilter::Bodies },
        { "Surfaces",     IM_COL32(77, 163, 255, 255), SolidArcOutlinerFilter::Surfaces },
        { "Construction", IM_COL32(180, 140, 255, 255), SolidArcOutlinerFilter::Construction },
        { "Dimensions",   IM_COL32(229, 211, 58, 255), SolidArcOutlinerFilter::Dimensions },
        { "Constraints",  IM_COL32(255, 107, 138, 255), SolidArcOutlinerFilter::Constraints },
    };
    Outliner_.AssignFilterCatalog(SolidArcFilters, static_cast<uint32_t>(sizeof(SolidArcFilters) / sizeof(SolidArcFilters[0])));
    Viewport_.AssignChrome(ViewportPanelChrome::SolidArcCad);
    Viewport_.AssignConstructTiles(kConstructTiles, kConstructTileCount);
    Outliner_.AssignReadout(&Readout_);
    Viewport_.AssignReadout(&Readout_);
    Inspector_.AssignReadout(&Readout_);
    Viewport_.AssignShadeOpen(&ShadeOpen_);
}

SolidArcEditorHost::~SolidArcEditorHost() noexcept
{
    Shade_.Terminate();
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    PrepareSunInspectorFonts();
    IconPresentation::Attach();
#ifdef FRONTIER_DEVELOPMENT
    // 📝 One style for both editors: tab figures, geometry and every colour token come from the game editor's own seating.
    SeatEditorStyle(ImGui::GetStyle());
#endif
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONTROL CENTRE NOTCH
//------------------------------------------------------------------------------------------------------------------------

bool SolidArcEditorHost::SeatShade(uint32_t Width, uint32_t Height) noexcept
{
    ShadeSeated_ = Shade_.Initialize(Width, Height);
    // 📝 The same 200 px pull the game editor seats: full width would sit on the viewport tab's close mark.
    Shade_.AssignNotchWidth(200.0f);
    Shade_.AssignProjectName("SolidArc");
    return ShadeSeated_;
}

void SolidArcEditorHost::TickShade(float CursorX, float CursorY, bool Down, float Wheel, float DeltaSeconds) noexcept
{
    if (!ShadeSeated_)
        return;
    // The host runs in logical pixels; the contact arrives in display pixels, so the exchange carries the contact
    //    scaled while the advance takes it logical.
    const float Scale = std::clamp(Shade_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f, 0.5f, 2.0f);
    const ImVec2 Display = ImGui::GetIO().DisplaySize;
    Shade_.Resize(static_cast<uint32_t>(Display.x / Scale + 0.5f), static_cast<uint32_t>(Display.y / Scale + 0.5f));
    ShadeInput_.AssignCursorPosition(CursorX * Scale, CursorY * Scale);
    ShadeInput_.AssignMouseButton(MouseButtonCategory::ButtonLeft, Down);
    ShadeInput_.ResetMouseScroll();
    if (Wheel != 0.0f)
        ShadeInput_.AssignMouseScroll(Wheel);
    Shade_.AdvanceInteraction(ShadeInput_, CursorX, CursorY);
    Shade_.AdvanceLocomotion(DeltaSeconds);
    Toasts_.Advance(DeltaSeconds);

    // Only an edge past the echo moves the shade, so the publish below never fights a tap that already seated the pose.
    if (!Shade_.IsDragging() && ShadeOpen_ != OpenEcho_)
    {
        if (ShadeOpen_)
            Shade_.OpenNotch();
        else
            Shade_.CloseNotch();
        OpenEcho_ = ShadeOpen_;
    }
    ShadeOpen_ = Shade_.IsOpen();
    OpenEcho_  = ShadeOpen_;

    const ControlCentreSettings& Current = Shade_.QuerySettings();
    if (Current.Revision != ToastRevision_)
    {
        Toasts_.AssignEnabled(Current.Notifications);
        char Body[96];
        std::snprintf(Body, sizeof(Body), "%s  |  GI %s, AA %s, scale %d%%", FidelityLabel(Current.Quality),
                      Current.GlobalIllumination ? "on" : "off", Current.AntiAliasing ? "on" : "off",
                      static_cast<int>(Current.RenderScale * 100.0f + 0.5f));
        Toasts_.Push("Render settings applied", Body);
        ToastRevision_ = Current.Revision;
    }
}

bool SolidArcEditorHost::ShadeCoversPointer() const noexcept
{
    return ShadeSeated_ && Shade_.CoversPointer();
}

bool SolidArcEditorHost::QueryShadeOpen() const noexcept
{
    return ShadeSeated_ && Shade_.IsOpen();
}

float SolidArcEditorHost::QueryNotchX() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryHandleExtent();
    return (Grip.MinimumX + Grip.MaximumX) * 0.5f;
}

float SolidArcEditorHost::QueryNotchY() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryHandleExtent();
    return (Grip.MinimumY + Grip.MaximumY) * 0.5f;
}

float SolidArcEditorHost::QueryGripX() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryGripExtent();
    return (Grip.MinimumX + Grip.MaximumX) * 0.5f;
}

float SolidArcEditorHost::QueryGripY() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryGripExtent();
    return (Grip.MinimumY + Grip.MaximumY) * 0.5f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        DOCK LAYOUT
//------------------------------------------------------------------------------------------------------------------------

void SolidArcEditorHost::ConstructLayout() noexcept
{
    const ImGuiID DockId = ImGui::GetID("SolidArcEditorDockSpace");
    if (LayoutSeated_)
        return;
    LayoutSeated_ = true;

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::DockBuilderRemoveNode(DockId);
    ImGui::DockBuilderAddNode(DockId, ImGuiDockNodeFlags_DockSpace);
    ImGui::DockBuilderSetNodeSize(DockId, Main->Size);

    ImGuiID Left = 0u, CentreAndRight = 0u, Centre = 0u, Right = 0u;
    const float LeftShare = Main->Size.x > 0.0f ? std::clamp(300.0f / Main->Size.x, 0.18f, 0.30f) : 0.18f;
    ImGui::DockBuilderSplitNode(DockId, ImGuiDir_Left, LeftShare, &Left, &CentreAndRight);
    const float RestWidth = std::max(1.0f, Main->Size.x * (1.0f - LeftShare));
    // Roomy windows seat the inspector at its designed width; a small one keeps the compact column.
    const float RightShare = std::clamp((Main->Size.x >= 1500.0f ? 380.0f : 236.0f) / RestWidth, 0.16f, 0.34f);
    ImGui::DockBuilderSplitNode(CentreAndRight, ImGuiDir_Right, RightShare, &Right, &Centre);
    ImGui::DockBuilderDockWindow("SolidArc Outliner", Left);
    ImGui::DockBuilderDockWindow("SolidArc Viewport", Centre);
    ImGui::DockBuilderDockWindow("SolidArc Inspector", Right);
    LeftColumn_ = Left;
    CentreColumn_ = Centre;
    RightColumn_ = Right;
    ImGui::DockBuilderFinish(DockId);
}

uint32_t SolidArcEditorHost::QueryConstructTileCount() noexcept
{
    return kConstructTileCount;
}

bool SolidArcEditorHost::PlaceConstruct(ConsoleHost& Host, uint32_t Tile) noexcept
{
    const uint32_t Slot   = ConstructPlaced_;
    const double   Radius = 2.6 + 0.9 * static_cast<double>(Slot / 8u);
    const double   Angle  = (static_cast<double>(Slot % 8u) + 0.5 * static_cast<double>((Slot / 8u) & 1u)) * 0.78539816339;
    const std::string Command = ConstructCommand(Tile, Radius * std::cos(Angle), Radius * std::sin(Angle));
    if (Command.empty())
        return false;
    const size_t Before = Host.AllFigures().size();
    const bool   Done   = Host.Execute(Command);
    ++ConstructPlaced_;
    if (!Done) return false;
    if (Host.AllFigures().size() > Before)
    {
        ConstructPlacedName_ = Host.AllFigures().back().Name;
        Host.Execute("select " + ConstructPlacedName_);
        if (Tile == 25u)
            Toasts_.Push("Aircraft rib sketch created", "XZ workplane · closed skin · 3 lightening holes · rear spar slot");
        else if (Tile == 26u)
            Toasts_.Push("Turbofan engine assembly created", "14 swept fan blades · nacelle · core · shaft · spinner · exhaust · pylon");
        return true;
    }
    if (Tile >= 22u && Tile <= 24u)
    {
        ConstructPlacedName_ = Tile == 22u ? "XY Workplane" : (Tile == 23u ? "XZ Workplane" : "YZ Workplane");
        Toasts_.Push("Active workplane changed", ConstructPlacedName_ + " · global coordinates remain right-handed Z-up");
        return true;
    }
    return false;
}

void SolidArcEditorHost::Record(ConsoleHost& Host) noexcept
{
    Host.Render();
    ViewImage_ = Host.Raster().Readback();
    // The roster is rebuilt from the document each frame, so a folder's fold would reset. Carry it by folder label.
    ShutFolders_.clear();
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
        if (Rows_[Index].Depth == 0u && Bindings_[Index].RowRole == SolidArcOutlinerBinding::Role::None && Rows_[Index].Shut)
            ShutFolders_.emplace_back(Rows_[Index].Label);
    RowCount_ = BuildSolidArcOutliner(Host, Rows_.data(), Bindings_.data(), kMaxEditorInstances, &Readout_);
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
        if (Rows_[Index].Depth == 0u && Bindings_[Index].RowRole == SolidArcOutlinerBinding::Role::None)
            Rows_[Index].Shut = std::find(ShutFolders_.begin(), ShutFolders_.end(), std::string(Rows_[Index].Label)) != ShutFolders_.end();
    if (!ViewImage_.Pixels.empty())
        Viewport_.AssignView(ViewImage_.Pixels.data(), ViewImage_.Width, ViewImage_.Height);
    else
        Viewport_.AssignView(nullptr, 0u, 0u);

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(ImVec2(Main->Pos.x, Main->Pos.y));
    ImGui::SetNextWindowSize(ImVec2(Main->Size.x, Main->Size.y));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    constexpr ImGuiWindowFlags HostFlags = ImGuiWindowFlags_NoTitleBar
                                         | ImGuiWindowFlags_NoResize
                                         | ImGuiWindowFlags_NoMove
                                         | ImGuiWindowFlags_NoScrollbar
                                         | ImGuiWindowFlags_NoScrollWithMouse
                                         | ImGuiWindowFlags_NoSavedSettings
                                         | ImGuiWindowFlags_NoBringToFrontOnFocus
                                         | ImGuiWindowFlags_NoNavFocus;
    if (ImGui::Begin("SolidArcDockHost", nullptr, HostFlags))
    {
        const ImGuiDockNodeFlags DockFlags =
            static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoWindowMenuButton);
        ConstructLayout();
        ImGui::DockSpace(ImGui::GetID("SolidArcEditorDockSpace"), ImVec2(0.0f, 0.0f), DockFlags);
    }
    ImGui::End();
    ImGui::PopStyleVar(2);

    Outliner_.Record(Rows_.data(), RowCount_);
    Viewport_.Record(Rows_.data(), RowCount_);

    // A Construct tile was chosen: place its figure at the next free spot on the workplane, a ring around the origin that
    //    widens as it fills, and seat the pick on it so the inspector shows what was just made.
    if (uint32_t Tile = 0u; Viewport_.QueryConstructPick(&Tile))
        PlaceConstruct(Host, Tile);

    const uint32_t Picked = Outliner_.QueryPicked();
    EditorInstance* PickedRow = (Picked < RowCount_) ? &Rows_[Picked] : nullptr;
    if (PickedRow != nullptr)
        BuildSolidArcInspectorSheet(Host, Bindings_[Picked], &PickedSheet_);
    else
        BuildSolidArcInspectorSheet(Host, SolidArcOutlinerBinding{}, &PickedSheet_);
    Inspector_.Record(PickedRow, Picked, &PickedSheet_);

    ApplySolidArcOutlinerVisibility(Host, Rows_.data(), Bindings_.data(), RowCount_);
    if (Picked < RowCount_)
        ApplySolidArcInspectorSheet(Host, Bindings_[Picked], PickedSheet_);

    // The notch records last, above the dock columns, onto the foreground list: the Project-Zero order, kept.
    if (ShadeSeated_)
    {
        const float UiScale = std::clamp(Shade_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f, 0.5f, 2.0f);
        if (ShadeSurface_.Begin(SurfaceLayer::Above, Main->Size.x, Main->Size.y, UiScale))
        {
            const float BandLine = ImGui::GetStyle().TabHeight + ImGui::GetStyle().TabStripPadTop;
            Shade_.ConstructControlLayout(ShadeSurface_);
            Toasts_.ConstructNotificationLayout(ShadeSurface_, BandLine);
        }
    }
}

bool SolidArcEditorHost::PickRow(const char* Label, SolidArcOutlinerBinding::Role Role) noexcept
{
    for (uint32_t Index = 0u; Index < RowCount_; ++Index)
    {
        if (Bindings_[Index].RowRole != Role || (Label != nullptr && std::strcmp(Rows_[Index].Label, Label) != 0))
            continue;
        Outliner_.PickInstance(Index);
        return true;
    }
    return false;
}

void SolidArcEditorHost::ClearPick() noexcept
{
    Outliner_.PickInstance(kNoEditorInstance);
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Bindings_[Picked].RowRole != SolidArcOutlinerBinding::Role::Figure)
        return 0u;
    return Bindings_[Picked].FigureIdentity;
}

} // namespace Frontier

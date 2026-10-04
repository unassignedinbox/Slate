//============================================================================================================================================
//                                                        EDITORCONVERSIONPROOF.CPP
//============================================================================================================================================
// 📦 Executed native inspector, collection, diagnostics and bounded-stack verification; no browser renderer.

#include "CelestialSequence.h"
#include "EnvironmentProjection.h"
#include "EditorFeedSequence.h"
#include "EditorHost.h"
#include "ControlPanel.h"
#include "DiagnosticInspector.h"
#include "ReSTIRIntegrator.h"
#include "TextureIndex.h"
#include "CpuDraw.h"
#include "PngWriteCounterpart.h"
#include <imgui_internal.h>
#include <filesystem>
#include <cstdio>
#include <stdexcept>
#include <vector>

using namespace Frontier;
using namespace Frontier::HostRuntime;

namespace {

struct CurveItem
{
    ImGuiID Identity;
    std::string Label;
    ImRect Rectangle;
    ImGuiWindow* Window;
};
std::vector<CurveItem> CurveItems;

CurveItem LocateCurve(const char* Label)
{
    for (const auto& Item : CurveItems) if (Item.Label == Label) return Item;
    throw std::runtime_error(std::string("Native curve not submitted: ") + Label);
}

void Require(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
    std::printf("PASS %s\n", Description);
}

void Capture(const std::filesystem::path& Output, const char* Name)
{
    const auto Extent = ImGui::GetIO().DisplaySize;
    const int Width = int(Extent.x), Height = int(Extent.y);
    std::vector<unsigned char> Pixels(size_t(Width) * Height * 3, 24);
    for (auto* Commands : ImGui::GetDrawData()->CmdLists)
        FrontierProof::Draw(Commands, Pixels.data(), Width, Height, {0, 0}, {1, 1});
    Require(stbi_write_png((Output / Name).string().c_str(), Width, Height, 3, Pixels.data(), Width * 3) != 0, "native image written");
}

} // namespace

#ifdef IMGUI_ENABLE_TEST_ENGINE
void ImGuiTestEngineHook_ItemAdd(ImGuiContext*, ImGuiID, const ImRect&, const ImGuiLastItemData*) {}
void ImGuiTestEngineHook_ItemInfo(ImGuiContext* Context, ImGuiID Identity, const char* Label, ImGuiItemStatusFlags)
{
    if (Label && std::strstr(Label, "-curve"))
        CurveItems.push_back({Identity, Label, Context->LastItemData.Rect, Context->CurrentWindow});
}
void ImGuiTestEngineHook_Log(ImGuiContext*, const char*, ...) {}
const char* ImGuiTestEngine_FindItemDebugLabel(ImGuiContext*, ImGuiID) { return "native proof"; }
#endif

int RunEditorConversion(const char* Destination)
{
    try
    {
        const std::filesystem::path Output(Destination);
        std::filesystem::create_directories(Output);
        std::vector<EditorInstance> Rows(10001);
        for (unsigned Index = 0; Index < Rows.size(); ++Index)
        {
            Rows[Index].InspectorKey = Index + 1;
            Rows[Index].Depth = Index;
            Rows[Index].Category = EditorInstanceCategory::Folder;
            std::snprintf(Rows[Index].Label, sizeof(Rows[Index].Label), "Folder %u", Index);
        }
        CollectionSequence Collection;
        Rows[500].Visible = false;
        Collection.Traverse(Rows.data(), unsigned(Rows.size()), 0);
        Require(Collection.Total == 10000 && Collection.MaximumDepth == 10000, "10000-deep iterative collection traversal");
        Require(Collection.Visible == 499 && Collection.Total - Collection.Visible == 9501, "inherited hidden visibility census");
        Collection.DirectOnly = true;
        Collection.Traverse(Rows.data(), unsigned(Rows.size()), 0);
        Require(Collection.Matches.size() == 1, "direct-content narrowing");
        Collection.DirectOnly = false;
        Collection.Page = 100000;
        Collection.Traverse(Rows.data(), unsigned(Rows.size()), 0);
        Require(Collection.Page == 399, "pagination clamps without row-sized automatic storage");
        std::snprintf(Collection.Search, sizeof(Collection.Search), "FOLDER 9999");
        Collection.Traverse(Rows.data(), unsigned(Rows.size()), 0);
        Require(Collection.Matches.size() == 1 && Collection.Page == 0, "case-insensitive search and shrinking result page");
        std::vector<SceneStructure> Levels(1);
        const Matrix4x4 Identity;
        uint32_t Enclosing = kPlacementNone;
        for (unsigned Index = 0; Index < 10000; ++Index)
            Enclosing = Levels[0].RegisterPlacement("Deep placement", Enclosing, Identity, Identity);
        EditorFeedSequence Feed;
        std::vector<EditorInstance> SceneRows(kMaxEditorInstances);
        const uint32_t SceneCount = Feed.FillRoster(SceneRows.data(), Levels[0]);
        Require(SceneCount == kMaxEditorInstances, "deep scene roster stops at native capacity");
        Require(SceneRows[SceneCount - 1].Depth > 900, "real scene feed retains depth beyond old eight-level truncation");
        bool ProtectedCamera = false;
        for (const auto& Row : SceneRows)
            if (!std::strcmp(Row.Label, "Editor Camera")) ProtectedCamera = Row.Pinned && Row.Locked;
        Require(ProtectedCamera, "permanent protected Editor Camera in native scene feed");
        Rows.resize(801);
        for (unsigned Index = 1; Index < Rows.size(); ++Index)
        {
            Rows[Index].Depth = 1;
            Rows[Index].Category = Index % 9 == 0 ? EditorInstanceCategory::Camera : EditorInstanceCategory::Geometry;
            Rows[Index].Visible = Index % 7 != 0;
            Rows[Index].Locked = Index % 5 == 0;
            std::snprintf(Rows[Index].Label, sizeof(Rows[Index].Label), "Authored fixture %04u", Index);
        }
        std::snprintf(Rows[0].Label, sizeof(Rows[0].Label), "Collection fixture / 800 records");
        ImGui::CreateContext();
        ImGui::GetCurrentContext()->TestEngineHookItems = true;
        auto& Input = ImGui::GetIO();
        Input.IniFilename = nullptr;
        Input.DeltaTime = 1.0f / 60;
        Input.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
        Input.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
        std::vector<EditorHost> EditorStorage(1);
        auto& Editor = EditorStorage.front();
        Editor.ApplyTheme();
        std::vector<ControlPanel> Controls(1);
        std::vector<InspectorPanel> Inspectors(1);
        Inspectors[0].AssignControls(&Controls[0]);
        Inspectors[0].AssignRoster(Rows.data(), unsigned(Rows.size()));
        std::vector<EditorSheet> Sheets(1);
        std::vector<CelestialSequence> Celestial(1);
        Celestial[0].Prepare();
        Celestial[0].Budget.AtmosphereSamples = 8;
        Celestial[0].Budget.AtmosphereLightSamples = 4;
        const float Eye[] = {0, 0, 2};
        Celestial[0].Tick(0, Eye, 0);
        Input.DisplaySize = {480, 1300};
        auto Tick = [&]()
        {
            CurveItems.clear();
            ImGui::NewFrame();
            ImGui::SetNextWindowPos({0, 0});
            ImGui::SetNextWindowSize(Input.DisplaySize);
            Inspectors[0].Record(&Rows[0], 0, &Sheets[0]);
            ImGui::Render();
            FrontierProof::AcknowledgeTextures();
        };
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) Tick();
        Capture(Output, "Collection.png");
        // 📝 Exercise the actual EditorHost shortcut route, including its negative cases.
        auto HostTick = [&]()
        {
            ImGui::NewFrame();
            Editor.Record(Rows.data(), unsigned(Rows.size()), &Sheets[0]);
            ImGui::Render();
            FrontierProof::AcknowledgeTextures();
        };
        Input.DisplaySize = {1280, 800};
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) HostTick();
        Input.AddKeyEvent(ImGuiMod_Shift, true);
        Input.AddKeyEvent(ImGuiKey_A, true);
        HostTick();
        Require(!Editor.QueryConstructOpen(), "Shift+A remains camera flight, not Construct");
        Input.AddKeyEvent(ImGuiKey_A, false);
        Input.AddKeyEvent(ImGuiMod_Shift, false);
        HostTick();
        Input.AddKeyEvent(ImGuiMod_Ctrl, true);
        Input.AddKeyEvent(ImGuiKey_A, true);
        HostTick();
        Require(Editor.QueryConstructOpen(), "Ctrl+A opens native Construct");
        Input.AddKeyEvent(ImGuiKey_A, false);
        Input.AddKeyEvent(ImGuiMod_Ctrl, false);
        HostTick();
        Input.AddKeyEvent(ImGuiKey_Escape, true);
        HostTick();
        Input.AddKeyEvent(ImGuiKey_Escape, false);
        HostTick();
        Require(!Editor.QueryConstructOpen(), "Escape closes native Construct");
        Rows[0].Category = EditorInstanceCategory::Light;
        struct InspectorCapture { CelestialEntity Selection; const char* Name; float Height; };
        const InspectorCapture Captures[] = {
            {CelestialEntity::Sun, "Sun.png", 5500},
            {CelestialEntity::Atmosphere, "Atmosphere.png", 3700},
            {CelestialEntity::LensFlare, "LensFlare.png", 4800},
            {CelestialEntity::Stars, "Stars.png", 2400},
            {CelestialEntity::Rainbow, "Rainbow.png", 1900}
        };
        for (const auto& Requested : Captures)
        {
            std::snprintf(Rows[0].Label,sizeof(Rows[0].Label),"%s",CelestialEntityName(Requested.Selection));
            Celestial[0].BuildSheet(Requested.Selection, Sheets[0]);
            Input.DisplaySize = {900, Requested.Height};
            for (unsigned Repeat = 0; Repeat < 3; ++Repeat) Tick();
            Capture(Output, Requested.Name);
        }
        // 📝 Inspect actual submitted ImGui items rather than guessing panel coordinates.
        auto Property = [&](const char* Label) -> EditorProperty&
        {
            for (auto& Group : Sheets[0].Groups)
                for (unsigned Index = 0; Index < Group.PropertyCount; ++Index)
                    if (!std::strcmp(Group.Properties[Index].Label,Label)) return Group.Properties[Index];
            throw std::runtime_error(std::string("Property missing: ") + Label);
        };
        auto Press = [&](ImGuiKey Key)
        {
            Input.AddMousePosEvent(-100,-100);
            Tick();
            Input.AddKeyEvent(Key,true);
            Tick();
            Input.AddKeyEvent(Key,false);
            Tick();
        };
        auto Probe = [&](const char* Label, float Fraction)
        {
            const auto Item = LocateCurve(Label);
            const ImVec2 Centre = Item.Rectangle.GetCenter();
            Input.AddMousePosEvent(Item.Rectangle.Min.x+Item.Rectangle.GetWidth()*Fraction,Centre.y);
            Tick();
            Input.AddMouseButtonEvent(0,true);
            Tick();
            Require(ImGui::GetCurrentContext()->ActiveId == Item.Identity,"actual native curve receives pointer input");
            Input.AddMouseButtonEvent(0,false);
            Tick();
        };
        using namespace EnvironmentProjection;
        CelestialObservation Calendar;
        for (int Year : {1900,2000,2024,2026,2100})
        {
            Calendar.Year = Year;
            for (int DayNumber = 1; DayNumber <= CountYearDays(Year); ++DayNumber)
            {
                ResolveDate(Calendar,DayNumber);
                if (ProjectDay(Calendar) != DayNumber) throw std::runtime_error("calendar day roundtrip");
            }
        }
        Require(true,"calendar roundtrip for every day in five leap/common/century years");
        Require(CountYearDays(1900)==365 && CountYearDays(2000)==366 && CountYearDays(2100)==365,"Gregorian leap-century boundaries");
        Require(std::abs(SampleDensity(8000,8000)-std::exp(-1.0f))<1e-6f,"density at scale height is one over e");
        Require(SampleScattering(440,1)>SampleScattering(680,1),"Rayleigh wavelength study favours blue");
        Require(SampleHazeTransmission(0,6)==1 && SampleHazeTransmission(5,0)==1,"haze study clear endpoints");
        Require(SampleHazeTransmission(5,3)<SampleHazeTransmission(5,1),"haze study follows authored strength");
        Require(std::abs(SampleOzoneTransmission(600,4)-std::exp(-4.0f))<1e-6f && SampleOzoneTransmission(380,4)>0.99f,"ozone illustrative peak and wings");
        Require(SampleSpectrum(440,10000)>SampleSpectrum(680,10000) && SampleSpectrum(440,2000)<SampleSpectrum(680,2000),"Planck study changes spectral balance with Kelvin");
        std::snprintf(Rows[0].Label,sizeof(Rows[0].Label),"Sun");
        Celestial[0].Observation.Year = 2024;
        Celestial[0].Observation.UtcOffset = -5.5f;
        Celestial[0].BuildSheet(CelestialEntity::Sun, Sheets[0]);
        Input.DisplaySize = {900, 4000};
        for (int Repeat=0;Repeat<3;++Repeat) Tick();
        Require(Property("Year").Figure==2024 && Property("UTC offset").Figure==-5.5f,"solar studies receive actual native year and UTC offset");
        const auto GainItem = LocateCurve("##sun-gain-curve");
        const float PreviousIntensity = Property("Intensity").Figure;
        Input.AddMousePosEvent(GainItem.Rectangle.Max.x-1,GainItem.Rectangle.GetCenter().y);
        Tick();
        Require(Property("Intensity").Figure==PreviousIntensity,"hover inspects without editing authored intensity");
        Probe("##sun-gain-curve",0.25f);
        Require(std::abs(Property("Intensity").Figure-15)<60/LocateCurve("##sun-gain-curve").Rectangle.GetWidth(),"gain plot writes the real native intensity property");
        Press(ImGuiKey_End);
        Require(Property("Intensity").Figure==60,"gain End clamps to native maximum");
        Press(ImGuiKey_Home);
        Require(Property("Intensity").Figure==0,"gain Home clamps to native minimum");
        Press(ImGuiKey_RightArrow);
        Require(std::abs(Property("Intensity").Figure-0.6f)<0.001f,"focused curve arrow key edits rather than navigating away");
        Probe("##sun-day-curve",0.75f);
        Require(std::abs(Property("Local Hours").Figure-18)<24/LocateCurve("##sun-day-curve").Rectangle.GetWidth(),"daylight graph writes local time");
        Celestial[0].ApplySheet(CelestialEntity::Sun,Sheets[0]);
        Celestial[0].Tick(0,Eye,0);
        const float EveningElevation = Celestial[0].Frame().Sun.Elevation;
        Probe("##sun-day-curve",0.5f);
        Celestial[0].ApplySheet(CelestialEntity::Sun,Sheets[0]);
        Celestial[0].Tick(0,Eye,0);
        Require(std::abs(Celestial[0].Frame().Sun.Elevation-EveningElevation)>10,"graph time reaches the native celestial solver");
        Probe("##sun-season-curve",0.5f);
        Press(ImGuiKey_End);
        Require(Property("Month").Figure==12 && Property("Day of Month").Figure==31,"season graph reaches December 31 in leap year");
        Press(ImGuiKey_Home);
        Require(Property("Month").Figure==1 && Property("Day of Month").Figure==1,"season Home selects January 1");
        Probe("##sun-spectrum-curve",0.5f);
        Require(Property("Temperature").Figure==Celestial[0].SunTemperatureKelvin,"spectrum probe does not overwrite colour temperature");
        Property("Month").Figure = 2;
        Property("Day of Month").Figure = 31;
        Celestial[0].ApplySheet(CelestialEntity::Sun,Sheets[0]);
        Require(Celestial[0].Observation.Day==29,"native date writeback clamps February in leap year");
        Celestial[0].Tick(0,Eye,0);
        Celestial[0].BuildSheet(CelestialEntity::Sun,Sheets[0]);
        for (int Repeat=0;Repeat<3;++Repeat) Tick();
        Capture(Output,"SunGraphs.png");
        Input.DisplaySize = {480,5500};
        for (int Repeat=0;Repeat<3;++Repeat) Tick();
        for (const char* Label : {"##sun-gain-curve","##sun-day-curve","##sun-season-curve","##sun-spectrum-curve"})
        {
            const auto Item = LocateCurve(Label);
            Require(Item.Rectangle.Min.x>=0 && Item.Rectangle.Max.x<=Input.DisplaySize.x && Item.Rectangle.GetWidth()>120,"sun graph fits narrow inspector");
        }
        Capture(Output,"SunGraphsNarrow.png");
        Celestial[0].Prepare();
        Celestial[0].Tick(0,Eye,0);
        std::snprintf(Rows[0].Label,sizeof(Rows[0].Label),"Atmosphere");
        Celestial[0].BuildSheet(CelestialEntity::Atmosphere, Sheets[0]);
        Input.DisplaySize = {900,3700};
        for (int Repeat=0;Repeat<3;++Repeat) Tick();
        const float PreviousRayleigh = Property("Rayleigh").Figure;
        Probe("##sky-scattering-curve",0.5f);
        Probe("##sky-haze-curve",0.75f);
        Probe("##sky-ozone-curve",0.25f);
        Probe("##sky-density-curve",0.2f);
        Require(Property("Rayleigh").Figure==PreviousRayleigh,"atmosphere diagnostic probes do not alter medium settings");
        Press(ImGuiKey_End);
        const auto DensityItem = LocateCurve("##sky-density-curve");
        const int RowIndex = 0;
        const ImGuiID RowSeed = ImHashData(&RowIndex,sizeof(RowIndex),DensityItem.Window->ID);
        const ImGuiID AltitudeIdentity = ImHashStr("##sky-altitude",0,RowSeed);
        const ImGuiID WavelengthIdentity = ImHashStr("##sky-wavelength",0,RowSeed);
        Require(DensityItem.Window->StateStorage.GetFloat(AltitudeIdentity)==Property("Atmosphere").Figure,"density probe keyboard reaches altitude endpoint");
        Require(std::abs(DensityItem.Window->StateStorage.GetFloat(WavelengthIdentity)-480)<400/LocateCurve("##sky-ozone-curve").Rectangle.GetWidth(),"scattering and ozone share the wavelength probe");
        Property("Rayleigh").Figure = 2.5f;
        Property("Mie").Figure = 3.0f;
        Property("Ozone").Figure = 0.5f;
        Property("Rayleigh Scale H").Figure = 12000;
        Celestial[0].ApplySheet(CelestialEntity::Atmosphere,Sheets[0]);
        Require(Celestial[0].Medium.RayleighStrength==2.5f && Celestial[0].Medium.MieStrength==3 && Celestial[0].Medium.OzoneStrength==0.5f && Celestial[0].Medium.RayleighScaleHeight==12000,"graph controls retain actual native medium writeback");
        for (int Repeat=0;Repeat<3;++Repeat) Tick();
        Capture(Output,"AtmosphereGraphs.png");
        Input.DisplaySize = {480,4200};
        for (int Repeat=0;Repeat<3;++Repeat) Tick();
        for (const char* Label : {"##sky-scattering-curve","##sky-haze-curve","##sky-ozone-curve","##sky-density-curve"})
        {
            const auto Item = LocateCurve(Label);
            Require(Item.Rectangle.Min.x>=0 && Item.Rectangle.Max.x<=Input.DisplaySize.x && Item.Rectangle.GetWidth()>120,"atmosphere graph fits narrow inspector");
        }
        Capture(Output,"AtmosphereGraphsNarrow.png");
        Celestial[0].Prepare();
        Celestial[0].Budget.AtmosphereSamples = 8;
        Celestial[0].Budget.AtmosphereLightSamples = 4;
        Celestial[0].Tick(0,Eye,0);
        std::snprintf(Rows[0].Label,sizeof(Rows[0].Label),"Atmosphere");
        Celestial[0].BuildSheet(CelestialEntity::Atmosphere, Sheets[0]);
        Input.DisplaySize = {900, 3700};
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) Tick();
        ImGuiWindow* Extras = nullptr;
        ImGuiWindow* Properties = nullptr;
        for (auto* Window : ImGui::GetCurrentContext()->Windows)
        {
            if (Window->Active && std::strstr(Window->Name, "##sky-extra")) Extras = Window;
            if (Window->Active && Window->ParentWindow && !std::strcmp(Window->ParentWindow->Name, "Inspector") && std::strstr(Window->Name, "##sky-properties")) Properties = Window;
        }
        Require(Extras && Properties, "native atmosphere properties and final settings are visible");
        const ImVec2 BakeButton(Properties->DC.CursorStartPos.x + 20 + 155 + 60, Extras->Pos.y + Extras->Size.y + 20 + 98);
        Input.AddMousePosEvent(BakeButton.x, BakeButton.y);
        Tick();
        Input.AddMouseButtonEvent(0, true);
        Tick();
        Input.AddMouseButtonEvent(0, false);
        Tick();
        Require(Sheets[0].SkyImage.RequestBake, "relocated bottom bake button queues the real native action");
        Celestial[0].ApplySheet(CelestialEntity::Atmosphere, Sheets[0]);
        Require(Celestial[0].TakeSkyDomeBakeRequest(), "renderer consumes relocated bake request");
        Require(!Celestial[0].TakeSkyDomeBakeRequest(), "bake request consumed exactly once");
        std::vector<uint16_t> Halves;
        Celestial[0].BakeSkyDome(Halves);
        std::snprintf(Rows[0].Label,sizeof(Rows[0].Label),"Atmosphere");
        Celestial[0].BuildSheet(CelestialEntity::Atmosphere, Sheets[0]);
        Require(Halves.size() == 256u * 512u * 4u, "real texture bake stays heap backed");
        Require(Sheets[0].SkyImage.Pixels == Celestial[0].SkyPreviewHalves.data(), "inspector borrows actual bake pixels");
        Require(Celestial[0].SaveSkyDome((Output / "Atmosphere.environment").string(), Halves), "real baked environment export");
        std::vector<uint16_t> Reloaded;
        Require(Celestial[0].LoadSkyDome((Output / "Atmosphere.environment").string(), Reloaded), "real baked environment reload");
        Require(Reloaded == Halves, "baked environment export/reload preserves every HDR texel");
        std::snprintf(Rows[0].Label,sizeof(Rows[0].Label),"Atmosphere");
        Celestial[0].BuildSheet(CelestialEntity::Atmosphere, Sheets[0]);
        Input.DisplaySize = {900, 3700};
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) Tick();
        Capture(Output, "AtmosphereBaked.png");
        Input.DisplaySize = {900, 1000};
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) Tick();
        ImGui::SetScrollY(Properties, Properties->ScrollMax.y);
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) Tick();
        Capture(Output, "BakingAtBottom.png");
        Require(Properties->Scroll.y > 500, "baking remains reachable at bottom of a scrollable native inspector");
        DiagnosticInspector Diagnostics;
        *Diagnostics.AccessOpen() = true;
        VisibilityTelemetry Telemetry;
        for (unsigned Repeat = 0; Repeat < 160; ++Repeat) Diagnostics.RecordDurations(0.5f, Telemetry);
        Input.DisplaySize = {900, 700};
        auto DiagnosticTick = [&]()
        {
            ImGui::NewFrame();
            PixelSpace Surface;
            Surface.Begin(SurfaceLayer::Above, 900, 700);
            ImGui::GetForegroundDrawList()->AddText(ImVec2(450, 100), IM_COL32(170, 170, 170, 255), "PROOF FIXTURE\n0.5 s intervals / no GPU device");
            Diagnostics.ConstructInspectorLayout(Surface, 30, 900, Telemetry, 0, false, ReSTIRIntegratorConfiguration{}, MaterialIndexMetrics{}, TextureIndexMetrics{}, 0);
            ImGui::Render();
            FrontierProof::AcknowledgeTextures();
        };
        for (unsigned Repeat = 0; Repeat < 3; ++Repeat) DiagnosticTick();
        Capture(Output, "Diagnostics.png");
        std::printf("SIZE EditorSheet=%zu EditorHost=%zu CelestialSequence=%zu CollectionSequence=%zu\n", sizeof(EditorSheet), sizeof(EditorHost), sizeof(CelestialSequence), sizeof(CollectionSequence));
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        std::fprintf(stderr, "FAIL %s\n", Failure.what());
        return 1;
    }
}

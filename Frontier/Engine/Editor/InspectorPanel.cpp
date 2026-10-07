//============================================================================================================================================
//                                                    INSPECTORPANEL.CPP
//============================================================================================================================================
// 🧩 Development editor inspector — the picked instance as a property sheet.

#include "InspectorPanel.h"
#include "TyreInspectorPanel.h"

#include "ControlPanel.h"
#include "SunInspectorPanel.h"
#include "LensFlareInspectorPanel.h"
#include "AtmosphereSkyInspectorPanel.h"
#include "MoonInspectorPanel.h"
#include "StarsInspectorPanel.h"
#include "CloudsInspectorPanel.h"
#include "FogInspectorPanel.h"
#include "WeatherInspectorPanel.h"
#include "CameraInspectorPanel.h"
#include "LightInspectorPanel.h"
#include "PostProcessInspectorPanel.h"
#include "SolidArcInspectorPanel.h"
#include <imgui_internal.h>   // ImGuiWindow: the SkipItems early-out

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier {

namespace {

//------------------------------------------------------------------------------------------------------------------------
//                                                          TOKENS
//------------------------------------------------------------------------------------------------------------------------

constexpr ImU32 kInset  = IM_COL32(26, 26, 26, 255);
constexpr ImU32 kText   = IM_COL32(240, 240, 240, 255);
constexpr ImU32 kDim    = IM_COL32(136, 136, 136, 255);
constexpr ImU32 kFaint  = IM_COL32(92, 92, 92, 255);
constexpr ImU32 kStroke = IM_COL32(255, 255, 255, 13);
constexpr ImU32 kStrong = IM_COL32(46, 46, 46, 255);
constexpr ImU32 kWash   = IM_COL32(255, 255, 255, 5);
constexpr ImU32 kGreen  = IM_COL32(0x34, 0xC7, 0x59, 255);
constexpr ImU32 kAmber  = IM_COL32(245, 158, 11, 255);

// The warning triangle the foot strips hang off a Poor realtime band: three strokes, the upright bar,
//    and its dot. One painter, copied to each strip's file, so the three feet warn alike.
void FootWarn(ImDrawList* Draw, const ImVec2& At, float Size, ImU32 Tint) noexcept
{
    Draw->AddTriangle(ImVec2(At.x + Size * 0.5f, At.y), ImVec2(At.x + Size, At.y + Size),
        ImVec2(At.x, At.y + Size), Tint, 1.5f);
    Draw->AddLine(ImVec2(At.x + Size * 0.5f, At.y + Size * 0.34f),
        ImVec2(At.x + Size * 0.5f, At.y + Size * 0.62f), Tint, 1.5f);
    Draw->AddCircleFilled(ImVec2(At.x + Size * 0.5f, At.y + Size * 0.78f), 1.2f, Tint);
}

float CapsAdvance(ImFont* Small, const char* Text) noexcept
{
    // RecordCaps' advance, without the paint: the right-hung figures measure before they draw.
    float Advance = 0.0f;
    for (const char* P = Text; *P != '\0'; ++P)
    {
        const char Upper[2] = { static_cast<char>(std::toupper(static_cast<unsigned char>(*P))), '\0' };
        Advance += Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Upper).x + 1.4f;
    }
    return Advance;
}

float ProwHeight(EditorPropertyCategory Category) noexcept
{
    switch (Category)
    {
    case EditorPropertyCategory::Slider:   return 30.0f;
    case EditorPropertyCategory::Switch:   return 26.0f;
    case EditorPropertyCategory::AxisVec3: return 26.0f;
    case EditorPropertyCategory::Colour:   return 26.0f;
    case EditorPropertyCategory::Select:   return 32.0f;
    case EditorPropertyCategory::Readout:  return 18.0f;
    default:                           return 26.0f;
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                           WIRING
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::AssignControls(ControlPanel* Controls) noexcept
{
    Controls_ = Controls;
    PrepareSunInspectorFonts();
}

void InspectorPanel::AssignTabOpen(bool* Open) noexcept
{
    TabOpen_ = Open;
}
#ifdef FRONTIER_DEVELOPMENT
void InspectorPanel::RecordCollectionProof(ControlPanel& Controls,EditorInstance* Rows,uint32_t Count,uint32_t Selected) noexcept
{
    Controls_=&Controls;Roster_=Rows;RosterCount_=Count;if(Rows&&Selected<Count)RecordCollection(Rows[Selected],Selected);
}
#endif

//------------------------------------------------------------------------------------------------------------------------
//                                                           RECORD
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::AssignReadout(const EditorReadout* Readout) noexcept
{
    Readout_ = Readout;
}

void InspectorPanel::Record(EditorInstance* Picked, uint32_t PickedIndex, EditorSheet* Sheet, bool Embedded) noexcept
{
    IM_ASSERT(Controls_ != nullptr);
    if (!Embedded && !ImGui::Begin(WindowTitle_, TabOpen_, ImGuiWindowFlags_NoScrollbar))
    {
        if(!Embedded)ImGui::End();
        return;
    }

    if (PickedIndex != SheetFor_)
    {
        SheetFor_ = PickedIndex;
        NameFor_  = kNoEditorInstance;
        for (uint32_t i = 0u; i < 8u; ++i)
        {
            CardShut_[i] = false;
        }
    }

    // Nothing picked, yet the sheet carries the document hero: the SolidArc inspector shows the document itself.
    static EditorInstance DocumentRow;
    if (Picked == nullptr && Sheet != nullptr && GlassCards_ && Sheet->Appearance == EditorSheetAppearance::SolidArc && Sheet->Hero.Active)
    {
        DocumentRow = EditorInstance{};
        std::snprintf(DocumentRow.Label, sizeof(DocumentRow.Label), "SolidArc document");
        DocumentRow.Symbol = EditorSymbol::None;
        DocumentRow.Tint[0] = 1.0f; DocumentRow.Tint[1] = 0.706f; DocumentRow.Tint[2] = 0.329f;
        Picked = &DocumentRow;
    }

    if (Picked == nullptr || Sheet == nullptr)
    {
        if (GlassCards_)
            RecordSolidArcEmpty(*Controls_);
        else
            RecordEmpty();
        const float Gap = Controls_->QueryFootTop() - ImGui::GetCursorScreenPos().y;
        if (Gap > 0.0f)
        {
            ImGui::Dummy(ImVec2(ImGui::GetContentRegionAvail().x, Gap));
        }
        RecordFooter(nullptr);
        if(!Embedded)ImGui::End();
        return;
    }

    if (Sheet->Appearance == EditorSheetAppearance::SolidArc)
    {
        // SolidArc's own glass-card sheet: header, tiles, transform rows. The folds persist in CardShut_.
        ImGui::BeginChild("##solidarc-properties", ImVec2(0.0f, ImMax(0.0f, Controls_->QueryFootTop() - ImGui::GetCursorScreenPos().y)), false);
        ImGui::PushID(static_cast<int>(PickedIndex));
        RecordSolidArcInspector(*Controls_, *Picked, PickedIndex, *Sheet, CardShut_);
        ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();
        RecordFooter(Picked);
        if(!Embedded)ImGui::End();
        return;
    }
    if(Sheet->Appearance==EditorSheetAppearance::Tyre||Sheet->Appearance==EditorSheetAppearance::TyreTread
       ||Sheet->Appearance==EditorSheetAppearance::TyreLattice){
        ImGui::BeginChild("##tyre-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordTyreInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if(Sheet->Appearance==EditorSheetAppearance::Light){
        ImGui::BeginChild("##light-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),ImGuiChildFlags_None,ImGuiWindowFlags_NoScrollbar);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordLightInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if(Sheet->Appearance==EditorSheetAppearance::PostProcess){
        ImGui::BeginChild("##post-process-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordPostProcessInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if(Sheet->Appearance==EditorSheetAppearance::Camera){
        ImGui::BeginChild("##camera-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordCameraInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::Wind || Sheet->Appearance == EditorSheetAppearance::Precipitation || Sheet->Appearance == EditorSheetAppearance::Rainbow) {
        ImGui::BeginChild("##weather-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordWeatherInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::HeightFog || Sheet->Appearance == EditorSheetAppearance::AerialFog || Sheet->Appearance == EditorSheetAppearance::LocalFog) {
        ImGui::BeginChild("##fog-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordFogInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::GlobalCloud || Sheet->Appearance == EditorSheetAppearance::LocalCloud) {
        ImGui::BeginChild("##cloud-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordCloudsInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::Stars) {
        ImGui::BeginChild("##stars-properties",ImVec2(0,0),ImGuiChildFlags_None,ImGuiWindowFlags_None);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordStarsInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::Moon) {
        ImGui::BeginChild("##moon-properties",ImVec2(0,ImMax(0.f,Controls_->QueryFootTop()-ImGui::GetCursorScreenPos().y)),false);
        ImGui::PushID(static_cast<int>(PickedIndex));RecordMoonInspector(*Controls_,*Picked,*Sheet);ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::AtmosphereSky)
    {
        ImGui::BeginChild("##sky-properties", ImVec2(0.0f, ImMax(0.0f, Controls_->QueryFootTop() - ImGui::GetCursorScreenPos().y)), false);
        ImGui::PushID(static_cast<int>(PickedIndex));
        RecordAtmosphereSkyInspector(*Controls_, *Picked, *Sheet);
        ImGui::PopID();RecordNotes(Picked);ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }
    if (Sheet->Appearance == EditorSheetAppearance::LensFlare)
    {
        ImGui::BeginChild("##flare-properties", ImVec2(0.0f, ImMax(0.0f, Controls_->QueryFootTop() - ImGui::GetCursorScreenPos().y)), false);
        ImGui::PushID(static_cast<int>(PickedIndex));
        RecordLensFlareInspector(*Controls_, *Picked, *Sheet);
        ImGui::PopID();RecordNotes(Picked);ImGui::EndChild();RecordFooter(Picked);if(!Embedded)ImGui::End();return;
    }

    if (Picked->Category == EditorInstanceCategory::Folder && Roster_ && PickedIndex < RosterCount_)
    {
        ImGui::BeginChild("##collection-content", ImVec2(0, 0),ImGuiChildFlags_None,ImGuiWindowFlags_NoScrollbar);
        RecordCollection(*Picked, PickedIndex);
        ImGui::EndChild();
        if (!Embedded) ImGui::End();
        return;
    }

    if (Sheet->Appearance == EditorSheetAppearance::Sun)
    {
        ImGui::BeginChild("##sun-properties", ImVec2(0.0f, ImMax(0.0f, Controls_->QueryFootTop() - ImGui::GetCursorScreenPos().y)), false);
        ImGui::PushID(static_cast<int>(PickedIndex));
        RecordSunInspector(*Controls_, *Picked, *Sheet);
        ImGui::PopID();
        RecordNotes(Picked);
        ImGui::EndChild();
        RecordFooter(Picked);
        if(!Embedded)ImGui::End();
        return;
    }

    RecordIdent(Picked, PickedIndex);

    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 2.0f));
    ImGui::BeginChild("##props", ImVec2(0.0f, ImMax(0.0f, Controls_->QueryFootTop() - ImGui::GetCursorScreenPos().y)), false);
    for (uint32_t i = 0u; i < Sheet->GroupCount && i < kMaxEditorSheetGroups; ++i)
    {
        RecordCard(Sheet->Groups[i], i);
    }
    RecordStanding(Picked, PickedIndex);
    RecordNotes(Picked);
    ImGui::EndChild();
    ImGui::PopStyleVar();
    RecordFooter(Picked);
    if(!Embedded)ImGui::End();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       LETTERSPACED CAPS
//------------------------------------------------------------------------------------------------------------------------

float InspectorPanel::RecordCaps(const char* Text, const ImVec2& At, ImU32 Tint) noexcept
{
    ImFont*     Small = Controls_->QuerySmall();
    ImDrawList* Draw  = ImGui::GetWindowDrawList();
    ImGui::PushFont(Small);
    float Advance = 0.0f;
    for (const char* P = Text; *P != '\0'; ++P)
    {
        const char Upper[2] = { static_cast<char>(std::toupper(static_cast<unsigned char>(*P))), '\0' };
        Draw->AddText(ImVec2(At.x + Advance, At.y), Tint, Upper);
        Advance += Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Upper).x + 1.4f;
    }
    ImGui::PopFont();
    return Advance;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                           EMPTY
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::RecordCollection(EditorInstance& Selected, uint32_t Index) noexcept
{
    auto& C=Collection_;C.Traverse(Roster_,RosterCount_,Index);ImGui::PushID("collection");ImGui::PushFont(Controls_->QueryUi(),14);
    ImGui::Indent(7);const float W=ImGui::GetContentRegionAvail().x-8;auto* D=ImGui::GetWindowDrawList();
    auto Card=[&](const char* Id,float H){ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding,22);ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,{23,24});ImGui::PushStyleColor(ImGuiCol_ChildBg,IM_COL32(31,31,31,255));ImGui::PushStyleColor(ImGuiCol_Border,IM_COL32(255,255,255,12));return ImGui::BeginChild(Id,{W,H},ImGuiChildFlags_Borders|ImGuiChildFlags_AlwaysUseWindowPadding,ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse);};
    auto EndCard=[&](){ImGui::EndChild();ImGui::PopStyleColor(2);ImGui::PopStyleVar(2);ImGui::Dummy({0,5});};
    ImGui::Dummy({0,1});RecordCaps("COLLECTION / SCENE INVENTORY",ImGui::GetCursorScreenPos(),kDim);ImGui::Dummy({0,27});
    const ImVec2 TitleAt=ImGui::GetCursorScreenPos();ImGui::Dummy({0,38});D->AddRectFilled({TitleAt.x+3,TitleAt.y+10},{TitleAt.x+25,TitleAt.y+29},IM_COL32(76,79,75,255),3);D->AddRectFilled({TitleAt.x+5,TitleAt.y+6},{TitleAt.x+15,TitleAt.y+12},IM_COL32(96,100,94,255),2);ImGui::SetCursorScreenPos({TitleAt.x+35,TitleAt.y});ImGui::PushFont(Controls_->QueryUi(),26);ImGui::SetNextItemWidth(W-78);ImGui::PushStyleColor(ImGuiCol_FrameBg,{0,0,0,0});ImGui::InputText("##folder-name",Selected.Label,sizeof(Selected.Label));ImGui::PopStyleColor();ImGui::PopFont();ImGui::SetCursorScreenPos({TitleAt.x,TitleAt.y+50});
    ImGui::PushStyleColor(ImGuiCol_Text,kDim);ImGui::PushTextWrapPos(ImGui::GetCursorPosX()+W);ImGui::TextWrapped("%s",!std::strcmp(Selected.Label,"Asset archive")?"Browser test fixture · 2,500 asset records · indexed from the current scene":"Environment · indexed from the current scene");ImGui::PopTextWrapPos();ImGui::PopStyleColor();if(Selected.Notes[0]&&ImGui::SmallButton("Edit Notes"))NotesFocus_=true;
    if(Selected.Notes[0]||NotesFocus_){ImGui::SetNextItemWidth(-1);ImGui::PushStyleColor(ImGuiCol_FrameBg,IM_COL32(13,13,13,255));ImGui::InputTextMultiline("##folder-notes",Selected.Notes,sizeof(Selected.Notes),{-1,58});NotesFocus_=ImGui::IsItemFocused()||NotesFocus_;ImGui::PopStyleColor();}
    ImGui::Dummy({0,12});ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding,14);ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize,1);ImGui::PushStyleColor(ImGuiCol_Border,{.28f,.28f,.25f,1});ImGui::PushStyleColor(ImGuiCol_Button,{.12f,.12f,.12f,1});ImGui::PushStyleColor(ImGuiCol_ButtonHovered,{.17f,.17f,.17f,1});
    std::vector<uint32_t> Trail;for(uint32_t I=0;I<=Index&&I<RosterCount_;++I){while(!Trail.empty()&&Roster_[Trail.back()].Depth>=Roster_[I].Depth)Trail.pop_back();if(I==Index||Roster_[I].Category==EditorInstanceCategory::Folder)Trail.push_back(I);}const size_t First=Trail.size()>4?Trail.size()-4:0;for(size_t I=First;I<Trail.size();++I){if(I>First)ImGui::SameLine(0,3);if(ImGui::SmallButton(Roster_[Trail[I]].Label))CollectionPick_=Trail[I];if(I+1<Trail.size()){ImGui::SameLine(0,3);ImGui::TextDisabled("/");}}
    ImGui::PopStyleColor(3);ImGui::PopStyleVar(2);ImGui::Dummy({0,24});

    Card("##collection-total",260);D=ImGui::GetWindowDrawList();const ImVec2 TotalOrigin=ImGui::GetWindowPos();D->AddRectFilled({TotalOrigin.x+23,TotalOrigin.y+26},{TotalOrigin.x+26,TotalOrigin.y+41},IM_COL32(95,190,151,255),2);ImGui::SetCursorPos({35,24});ImGui::TextUnformatted("Collection contents");ImGui::SetCursorPos({23,66});ImGui::PushFont(Controls_->QueryUi(),52);ImGui::Text("%u",C.Total);ImGui::SameLine();ImGui::PushFont(Controls_->QuerySmall());ImGui::TextDisabled("entries");ImGui::PopFont();ImGui::PopFont();ImGui::SetCursorPos({23,137});ImGui::TextDisabled("All descendants, including nested folders");D->AddLine({TotalOrigin.x+23,TotalOrigin.y+173},{TotalOrigin.x+W-23,TotalOrigin.y+173},IM_COL32(255,255,255,10));ImGui::SetCursorPos({23,195});
    if(ImGui::BeginTable("##facts",3,ImGuiTableFlags_SizingStretchSame)){const uint32_t V[]={C.Direct,C.Folders,C.MaximumDepth};const char* L[]={"Direct children","Nested folders","Levels below"};for(int I=0;I<3;++I){ImGui::TableNextColumn();ImGui::PushFont(Controls_->QueryUi(),21);ImGui::Text("%u",V[I]);ImGui::PopFont();ImGui::TextDisabled("%s",L[I]);}ImGui::EndTable();}EndCard();

    const float Half=(W-10)*.5f;for(int I=0;I<2;++I){if(I)ImGui::SameLine(0,10);ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding,18);ImGui::PushStyleColor(ImGuiCol_ChildBg,IM_COL32(27,27,27,255));ImGui::BeginChild(I?"##hidden-status":"##visible-status",{Half,109},ImGuiChildFlags_Borders);ImGui::SetCursorPos({17,17});D=ImGui::GetWindowDrawList();const auto P=ImGui::GetCursorScreenPos();D->AddCircleFilled({P.x+5,P.y+6},5,I?kFaint:kGreen);ImGui::Dummy({14,0});ImGui::SameLine();ImGui::TextUnformatted(I?"Hidden":"Visible");ImGui::SetCursorPos({17,56});ImGui::PushFont(Controls_->QueryUi(),32);ImGui::Text("%u",I?C.Total-C.Visible:C.Visible);ImGui::PopFont();if(ImGui::IsWindowHovered()&&ImGui::IsMouseClicked(0)){C.Visibility=C.Visibility==I+1?0:I+1;C.Page=0;}ImGui::EndChild();ImGui::PopStyleColor();ImGui::PopStyleVar();}ImGui::Dummy({0,3});

    Card("##collection-composition",302);D=ImGui::GetWindowDrawList();{const ImVec2 P=ImGui::GetWindowPos();D->AddRectFilled({P.x+23,P.y+26},{P.x+26,P.y+41},IM_COL32(201,189,102,255),2);}ImGui::SetCursorPosX(35);ImGui::TextUnformatted("Composition");ImGui::SameLine();ImGui::TextDisabled("%u types",unsigned(std::count_if(std::begin(C.Categories),std::end(C.Categories),[](uint32_t N){return N>0;})));ImGui::PushFont(Controls_->QueryUi(),36);ImGui::Text("%u",C.Total);ImGui::SameLine();ImGui::PushFont(Controls_->QuerySmall());ImGui::TextDisabled("entities");ImGui::PopFont();ImGui::PopFont();
    const ImU32 Palette[]={IM_COL32(185,199,174,255),IM_COL32(156,171,185,255),IM_COL32(209,184,152,255),IM_COL32(166,161,152,255)};float BX=ImGui::GetCursorScreenPos().x,BY=ImGui::GetCursorScreenPos().y,BW=ImGui::GetContentRegionAvail().x;for(unsigned I=0;I<unsigned(EditorInstanceCategory::Count);++I)if(C.Categories[I]){float Part=BW*C.Categories[I]/std::max(1u,C.Total);D->AddRectFilled({BX,BY},{BX+Part,BY+12},Palette[I],2);BX+=Part;}ImGui::Dummy({0,23});
    const char* Names[]={"Folders","Geometry","Lights","Cameras"};for(unsigned I=0;I<4;++I)if(C.Categories[I]){ImGui::PushID(int(I));if(ImGui::Selectable(Names[I],C.Category==int(I+1),0,{0,27})){C.Category=C.Category==int(I+1)?0:int(I+1);C.Page=0;}ImGui::SameLine(W-86);ImGui::Text("%u",C.Categories[I]);ImGui::PopID();}ImGui::TextDisabled("Visibility includes ancestor folders. Counts are scene records, not render workload or memory.");EndCard();

    Card("##collection-browser",820);D=ImGui::GetWindowDrawList();ImGui::PushStyleColor(ImGuiCol_FrameBg,IM_COL32(21,25,22,255));ImGui::PushStyleColor(ImGuiCol_FrameBgHovered,IM_COL32(27,32,28,255));ImGui::PushStyleColor(ImGuiCol_FrameBgActive,IM_COL32(31,37,32,255));ImGui::PushStyleColor(ImGuiCol_Button,IM_COL32(21,25,22,255));ImGui::PushStyleColor(ImGuiCol_ButtonHovered,IM_COL32(27,32,28,255));ImGui::PushStyleColor(ImGuiCol_ButtonActive,IM_COL32(31,37,32,255));ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding,10);ImGui::PushStyleVar(ImGuiStyleVar_FramePadding,{8,8});{const ImVec2 P=ImGui::GetWindowPos();D->AddRectFilled({P.x+23,P.y+26},{P.x+26,P.y+41},IM_COL32(176,199,207,255),2);}ImGui::SetCursorPosX(35);ImGui::TextUnformatted("Browse contents");ImGui::SameLine();ImGui::TextDisabled("%zu matches",C.Matches.size());ImGui::Dummy({0,14});ImGui::TextDisabled("Find an entry");ImGui::SetNextItemWidth(-1);bool Changed=ImGui::InputTextWithHint("##search","Name, ID or description…",C.Search,sizeof(C.Search));ImGui::Dummy({0,8});
    const float FW=(ImGui::GetContentRegionAvail().x-8)*.5f;ImGui::TextDisabled("Scope");ImGui::SameLine(FW+8);ImGui::TextDisabled("Type");ImGui::SetNextItemWidth(FW);int Scope=C.DirectOnly?1:0;Changed|=ImGui::Combo("##scope",&Scope,"All descendants\0Direct children\0");C.DirectOnly=Scope==1;ImGui::SameLine();ImGui::SetNextItemWidth(FW);Changed|=ImGui::Combo("##type",&C.Category,"All types\0Folders\0Geometry\0Lights\0Cameras\0");ImGui::Dummy({0,8});ImGui::TextDisabled("Visibility");ImGui::SameLine(FW+8);ImGui::TextDisabled("Sort");ImGui::SetNextItemWidth(FW);Changed|=ImGui::Combo("##visibility",&C.Visibility,"All entries\0Visible\0Hidden\0");ImGui::SameLine();ImGui::SetNextItemWidth(FW);Changed|=ImGui::Combo("##sort",&C.Sort,"Name A-Z\0Type\0Hierarchy depth\0");ImGui::Dummy({0,5});if(Changed)C.Page=0;C.Traverse(Roster_,RosterCount_,Index);
    const size_t Start=size_t(C.Page)*C.PageSize,Last=std::min(C.Matches.size(),Start+size_t(C.PageSize));for(size_t J=Start;J<Last&&J<Start+7;++J){const auto M=C.Matches[J];auto& R=Roster_[M.Index];ImGui::PushID(int(M.Index));const float RowW=ImGui::GetContentRegionAvail().x;ImGui::InvisibleButton("##entry",{RowW-44,67});if(ImGui::IsItemClicked())CollectionPick_=M.Index;const ImVec2 RM=ImGui::GetItemRectMin();D->AddLine({RM.x,RM.y+66},{RM.x+RowW,RM.y+66},IM_COL32(255,255,255,10));const ImU32 RC=R.Category==EditorInstanceCategory::Light?IM_COL32(209,184,152,255):R.Category==EditorInstanceCategory::Camera?IM_COL32(156,171,185,255):R.Category==EditorInstanceCategory::Folder?IM_COL32(185,199,174,255):IM_COL32(18,111,194,255);const ImVec2 CubeC={RM.x+67.5f,RM.y+33.5f};const ImVec2 Cube[]={ {CubeC.x,CubeC.y-7},{CubeC.x+6,CubeC.y-3.5f},{CubeC.x+6,CubeC.y+4},{CubeC.x,CubeC.y+7.5f},{CubeC.x-6,CubeC.y+4},{CubeC.x-6,CubeC.y-3.5f} };D->AddPolyline(Cube,6,RC,1.2f,ImDrawFlags_Closed);D->AddLine(Cube[0],CubeC,RC,1);D->AddLine(CubeC,Cube[3],RC,1);D->AddLine(CubeC,Cube[1],RC,1);D->AddLine(CubeC,Cube[5],RC,1);D->AddText(Controls_->QueryUi(),13,{RM.x+87,RM.y+11},kText,R.Label);char Meta[64];std::snprintf(Meta,sizeof(Meta),"%s · level %u",EditorInstanceLabel(R.Category),R.Depth);D->AddText(Controls_->QuerySmall(),10,{RM.x+87,RM.y+31},kDim,Meta);const char* Parent="scene";for(uint32_t K=M.Index;K>0;){--K;if(Roster_[K].Depth<R.Depth){Parent=Roster_[K].Label;break;}}char VisibilityText[96];std::snprintf(VisibilityText,sizeof(VisibilityText),"%s · %s",M.Visible?"Visible":"Hidden",Parent);D->AddText(Controls_->QuerySmall(),9,{RM.x+87,RM.y+46},kFaint,VisibilityText);ImGui::SameLine();ImGui::InvisibleButton("##entry-visibility",{38,67});if(ImGui::IsItemClicked()&&!R.Pinned)R.Visible=!R.Visible;const ImVec2 ToggleMin=ImGui::GetItemRectMin(),ToggleC={ToggleMin.x+19,ToggleMin.y+33.5f};D->AddCircleFilled(ToggleC,15,M.Visible?IM_COL32(39,54,40,255):IM_COL32(48,48,48,255),24);D->AddCircleFilled(ToggleC,4,M.Visible?IM_COL32(91,190,116,255):IM_COL32(122,122,122,255),16);ImGui::PopID();}
    if(C.Matches.empty()){ImGui::TextDisabled("No matching entries.");}ImGui::BeginDisabled(C.Page==0);if(ImGui::Button("Previous"))--C.Page;ImGui::EndDisabled();ImGui::SameLine();ImGui::BeginDisabled(Last>=C.Matches.size());if(ImGui::Button("Next"))++C.Page;ImGui::EndDisabled();ImGui::SameLine();ImGui::TextDisabled("Page %d / %d",C.Page+1,std::max(1,(int(C.Matches.size())+C.PageSize-1)/C.PageSize));ImGui::PopStyleVar(2);ImGui::PopStyleColor(6);EndCard();
    ImGui::Unindent(7);ImGui::PopFont();ImGui::PopID();
}
void InspectorPanel::RecordEmpty() noexcept
{
    const float RowWidth = ImGui::GetContentRegionAvail().x;
    ImGui::Dummy(ImVec2(RowWidth, 120.0f));
    const ImVec2 Min = ImGui::GetItemRectMin();
    const ImVec2 Max = ImGui::GetItemRectMax();

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    Draw->AddRectFilled(Min, Max, kInset, 18.0f);
    Draw->AddRect(Min, Max, kStroke, 18.0f);

    ImFont* Ui    = Controls_->QueryUi();
    ImFont* Small = Controls_->QuerySmall();
    ImGui::PushFont(Ui);
    const ImVec2 TitleGlyph = Ui->CalcTextSizeA(Ui->LegacySize, FLT_MAX, 0.0f, "Nothing selected");
    Draw->AddText(ImVec2(Min.x + (RowWidth - TitleGlyph.x) * 0.5f, Min.y + 38.0f), kDim, "Nothing selected");
    ImGui::PopFont();
    ImGui::PushFont(Small);
    const ImVec2 HintGlyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, "Pick an instance in the outliner.");
    Draw->AddText(ImVec2(Min.x + (RowWidth - HintGlyph.x) * 0.5f, Min.y + 62.0f), kFaint,
        "Pick an instance in the outliner.");
    ImGui::PopFont();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                           IDENT
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::RecordIdent(EditorInstance* Picked, uint32_t PickedIndex) noexcept
{
    const float RowWidth = ImGui::GetContentRegionAvail().x;
    ImGui::Dummy(ImVec2(RowWidth, 56.0f));
    const ImVec2 Cursor = ImGui::GetItemRectMin();

    ImDrawList* Draw  = ImGui::GetWindowDrawList();
    ImFont*     Ui    = Controls_->QueryUi();
    ImFont*     Small = Controls_->QuerySmall();

    const ImVec2 HeadPos = ImGui::GetWindowPos();
    const float  HeadX0  = HeadPos.x;
    const float  HeadX1  = HeadPos.x + ImGui::GetWindowSize().x;
    Draw->AddRectFilled(ImVec2(HeadX0, Cursor.y), ImVec2(HeadX1, Cursor.y + 56.0f), kWash);
    Draw->AddLine(ImVec2(HeadX0, Cursor.y + 56.0f), ImVec2(HeadX1, Cursor.y + 56.0f), kStroke);

    const int R = static_cast<int>(Picked->Tint[0] * 255.0f);
    const int G = static_cast<int>(Picked->Tint[1] * 255.0f);
    const int B = static_cast<int>(Picked->Tint[2] * 255.0f);
    const ImVec2 TileMin(Cursor.x, Cursor.y + 10.0f);
    const ImVec2 TileMax(Cursor.x + 36.0f, Cursor.y + 46.0f);
    Draw->AddRectFilled(TileMin, TileMax, IM_COL32(R, G, B, 36), 10.0f);
    Draw->AddRect(TileMin, TileMax, IM_COL32(R, G, B, 110), 10.0f);
    Draw->AddCircleFilled(ImVec2(Cursor.x + 18.0f, Cursor.y + 28.0f), 5.0f, IM_COL32(R, G, B, 255));

    if (NameFor_ != PickedIndex)
    {
        std::snprintf(NameText_, sizeof(NameText_), "%s", Picked->Label);
        NameFor_ = PickedIndex;
    }

    const float NameX  = Cursor.x + 46.0f;
    const float BtnX   = Cursor.x + RowWidth - 64.0f;
    const float NameW  = BtnX - 8.0f - NameX;
    ImGui::SetCursorScreenPos(ImVec2(NameX, Cursor.y + 4.0f));
    ImGui::PushItemWidth(NameW > 40.0f ? NameW : 40.0f);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(2.0f, 2.0f));
    ImGui::PushFont(Ui);
    ImGui::BeginDisabled(Picked->Pinned);
    const bool NameDone = ImGui::InputText("##pickname", NameText_, sizeof(NameText_),
        ImGuiInputTextFlags_EnterReturnsTrue | ImGuiInputTextFlags_AutoSelectAll);
    const bool NameEdited = ImGui::IsItemDeactivatedAfterEdit();
    ImGui::EndDisabled();
    const ImVec2 NameMin = ImGui::GetItemRectMin();
    const ImVec2 NameMax = ImGui::GetItemRectMax();
    const bool NameHot = ImGui::IsItemFocused();
    ImGui::PopFont();
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    ImGui::PopItemWidth();
    if (NameHot)
    {
        Draw->AddRect(NameMin, NameMax, kStrong, 6.0f);
    }
    if (!Picked->Pinned && (NameDone || NameEdited))
    {
        std::snprintf(Picked->Label, sizeof(Picked->Label), "%.*s", int(sizeof(Picked->Label) - 1u), NameText_);
    }

    char CategoryUpper[24] = {};
    const char* CategoryName = EditorInstanceLabel(Picked->Category);
    for (uint32_t i = 0u; i < sizeof(CategoryUpper) - 1u && CategoryName[i] != '\0'; ++i)
    {
        CategoryUpper[i] = static_cast<char>(std::toupper(static_cast<unsigned char>(CategoryName[i])));
    }
    char Suffix[32] = {};
    if (Picked->Locked && !Picked->Visible)
    {
        std::snprintf(Suffix, sizeof(Suffix), " \xc2\xb7 locked \xc2\xb7 hidden");
    }
    else if (Picked->Locked)
    {
        std::snprintf(Suffix, sizeof(Suffix), " \xc2\xb7 locked");
    }
    else if (!Picked->Visible)
    {
        std::snprintf(Suffix, sizeof(Suffix), " \xc2\xb7 hidden");
    }
    const float CategoryAdvance = RecordCaps(CategoryUpper, ImVec2(NameX + 2.0f, Cursor.y + 30.0f), kDim);
    ImGui::PushFont(Small);
    Draw->AddText(ImVec2(NameX + 2.0f + CategoryAdvance, Cursor.y + 30.0f), kFaint, Suffix);
    ImGui::PopFont();

    const ImVec2 LockMin(BtnX, Cursor.y + 14.0f);
    ImGui::SetCursorScreenPos(LockMin);
    ImGui::InvisibleButton("##identlock", ImVec2(28.0f, 28.0f));
    const bool LockHot = ImGui::IsItemHovered();
    if (!Picked->Pinned && LockHot && ImGui::IsMouseClicked(0))
    {
        Picked->Locked = !Picked->Locked;
    }
    const ImVec2 VisMin(BtnX + 36.0f, Cursor.y + 14.0f);
    ImGui::SetCursorScreenPos(VisMin);
    ImGui::InvisibleButton("##identvis", ImVec2(28.0f, 28.0f));
    const bool VisHot = ImGui::IsItemHovered();
    if (!Picked->Pinned && VisHot && ImGui::IsMouseClicked(0))
    {
        Picked->Visible = !Picked->Visible;
    }

    const ImVec2 LockCentre(LockMin.x + 14.0f, LockMin.y + 14.0f);
    Draw->AddCircleFilled(LockCentre, 14.0f, LockHot ? IM_COL32(255, 255, 255, 24) : IM_COL32(255, 255, 255, 12));
    const ImU32 LockTint = Picked->Locked ? kText : kFaint;
    Draw->AddCircle(ImVec2(LockCentre.x, LockCentre.y - 1.5f), 3.2f, LockTint, 0, 1.6f);
    Draw->AddRectFilled(ImVec2(LockCentre.x - 3.8f, LockCentre.y - 1.0f),
        ImVec2(LockCentre.x + 3.8f, LockCentre.y + 5.0f), IM_COL32(30, 30, 30, 255), 2.0f);
    Draw->AddRect(ImVec2(LockCentre.x - 3.8f, LockCentre.y - 1.0f),
        ImVec2(LockCentre.x + 3.8f, LockCentre.y + 5.0f), LockTint, 2.0f, 0, 1.4f);

    const ImVec2 VisCentre(VisMin.x + 14.0f, VisMin.y + 14.0f);
    Draw->AddCircleFilled(VisCentre, 14.0f, VisHot ? IM_COL32(255, 255, 255, 24) : IM_COL32(255, 255, 255, 12));
    const ImU32 VisTint = Picked->Visible ? kDim : kFaint;
    Draw->AddBezierCubic(ImVec2(VisCentre.x - 6.0f, VisCentre.y),
        ImVec2(VisCentre.x - 2.5f, VisCentre.y - 4.5f), ImVec2(VisCentre.x + 2.5f, VisCentre.y - 4.5f),
        ImVec2(VisCentre.x + 6.0f, VisCentre.y), VisTint, 1.6f);
    Draw->AddBezierCubic(ImVec2(VisCentre.x - 6.0f, VisCentre.y),
        ImVec2(VisCentre.x - 2.5f, VisCentre.y + 4.5f), ImVec2(VisCentre.x + 2.5f, VisCentre.y + 4.5f),
        ImVec2(VisCentre.x + 6.0f, VisCentre.y), VisTint, 1.6f);
    if (Picked->Visible)
    {
        Draw->AddCircleFilled(VisCentre, 1.8f, VisTint);
    }
    else
    {
        Draw->AddLine(ImVec2(VisCentre.x - 6.5f, VisCentre.y + 6.0f),
            ImVec2(VisCentre.x + 6.5f, VisCentre.y - 6.0f), kFaint, 1.6f);
    }
    ImGui::SetCursorScreenPos(ImVec2(Cursor.x, Cursor.y + 56.0f));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      SCHEMA CARDS
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::RecordCard(EditorPropertyGroup& Group, uint32_t Card) noexcept
{
    ImGui::PushID(static_cast<int>(Card));

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    ImFont* CaptionFace = Controls_->QuerySmall();
    const float Wrap = ImMax(1.0f, RowWidth - 28.0f);
    const float CaptionH = Group.Caption[0] ? CaptionFace->CalcTextSizeA(CaptionFace->LegacySize, FLT_MAX, Wrap, Group.Caption).y + 12.0f : 0.0f;
    const float ClockH = Group.Clock24 ? 126.0f : 0.0f;
    const float LabelH = Group.StackedLabels ? 18.0f : 0.0f;
    float H = 12.0f + 24.0f + 10.0f;
    if (!CardShut_[Card])
    {
        H = 12.0f + 24.0f + 8.0f;
        for (uint32_t i = 0u; i < Group.PropertyCount; ++i)
        {
            H += ProwHeight(Group.Properties[i].Category) + 8.0f + LabelH;
        }
        H += 14.0f - 8.0f + CaptionH + ClockH;
    }

    ImGui::Dummy(ImVec2(RowWidth, H));
    const ImVec2 Min = ImGui::GetItemRectMin();
    const ImVec2 Max = ImGui::GetItemRectMax();

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    Draw->AddRectFilled(Min, Max, kInset, 18.0f);
    Draw->AddRect(Min, Max, kStroke, 18.0f);

    const ImVec2 HeadMin(Min.x + 14.0f, Min.y + 12.0f);
    ImGui::SetCursorScreenPos(HeadMin);
    ImGui::InvisibleButton("##h4", ImVec2(RowWidth - 28.0f, 24.0f));
    if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
    {
        CardShut_[Card] = !CardShut_[Card];
    }

    const float ChevY = HeadMin.y + 12.0f;
    if (CardShut_[Card])
    {
        Draw->AddTriangleFilled(ImVec2(HeadMin.x + 1.0f, ChevY - 4.0f), ImVec2(HeadMin.x + 1.0f, ChevY + 4.0f),
            ImVec2(HeadMin.x + 7.0f, ChevY), kDim);
    }
    else
    {
        Draw->AddTriangleFilled(ImVec2(HeadMin.x - 1.0f, ChevY - 2.5f), ImVec2(HeadMin.x + 9.0f, ChevY - 2.5f),
            ImVec2(HeadMin.x + 4.0f, ChevY + 3.5f), kDim);
    }
    RecordCaps(Group.Title, ImVec2(HeadMin.x + 14.0f, HeadMin.y + 5.0f), kDim);

    if (!CardShut_[Card])
    {
        ImFont* Small = Controls_->QuerySmall();
        const float BodyX = Min.x + 14.0f;
        const float BodyW = RowWidth - 28.0f;
        const float ZoneX = Group.StackedLabels ? BodyX : BodyX + 78.0f;
        const float ZoneW = Group.StackedLabels ? BodyW : BodyW - 78.0f;
        float Y = Min.y + 12.0f + 24.0f + 8.0f;
        if (Group.Caption[0])
        {
            Draw->AddText(Small, Small->LegacySize, ImVec2(BodyX, Y), kDim, Group.Caption, nullptr, Wrap);
            Y += CaptionH;
        }
        if (Group.Clock24 && Group.PropertyCount)
        {
            const ImVec2 Centre(BodyX + BodyW * 0.5f, Y + 60.0f);
            Draw->AddCircle(Centre, 43.0f, kStroke, 48, 2.0f);
            for (int Hour = 0; Hour < 24; ++Hour)
            {
                const float A = Hour * 6.283185307f / 24.0f - 1.570796327f;
                const float Outer = 43.0f, Inner = Hour % 6 == 0 ? 35.0f : 39.0f;
                Draw->AddLine(ImVec2(Centre.x + std::cos(A)*Inner, Centre.y + std::sin(A)*Inner),
                    ImVec2(Centre.x + std::cos(A)*Outer, Centre.y + std::sin(A)*Outer), kDim);
            }
            const float A = Group.Properties[0].Figure * 6.283185307f / 24.0f - 1.570796327f;
            Draw->AddCircleFilled(ImVec2(Centre.x + std::cos(A)*43.0f, Centre.y + std::sin(A)*43.0f), 5.0f, IM_COL32(245, 183, 92, 255));
            Draw->AddText(Small, Small->LegacySize, ImVec2(Centre.x-5, Centre.y-60), kDim, "00");
            Draw->AddText(Small, Small->LegacySize, ImVec2(Centre.x+49, Centre.y-5), kDim, "06");
            Draw->AddText(Small, Small->LegacySize, ImVec2(Centre.x-5, Centre.y+47), kDim, "12");
            Draw->AddText(Small, Small->LegacySize, ImVec2(Centre.x-62, Centre.y-5), kDim, "18");
            Y += ClockH;
        }


        for (uint32_t i = 0u; i < Group.PropertyCount; ++i)
        {
            EditorProperty& Prop = Group.Properties[i];
            const float ProwH = ProwHeight(Prop.Category);

            ImGui::PushFont(Small);
            const ImVec2 LabelGlyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Prop.Label);
            Draw->AddText(ImVec2(BodyX, Y + (Group.StackedLabels ? 0.0f : (ProwH - LabelGlyph.y) * 0.5f)), kDim, Prop.Label);
            ImGui::PopFont();

            Y += LabelH;
            ImGui::SetCursorScreenPos(ImVec2(ZoneX, Y));
            char ProwId[12] = {};
            std::snprintf(ProwId, sizeof(ProwId), "##p%u", i);
            ImGui::BeginChild(ProwId, ImVec2(ZoneW, ProwH), false,
                ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
            switch (Prop.Category)
            {
            case EditorPropertyCategory::Slider:
                Controls_->SliderPill("##s", &Prop.Figure, Prop.Minimum, Prop.Maximum, Prop.Decimals, Prop.Unit, Prop.Hi, false, true);
                break;
            case EditorPropertyCategory::Switch:
                ImGui::SetCursorScreenPos(ImVec2(ZoneX + ZoneW - 44.0f, Y + 3.5f));
                Controls_->Switch("##w", &Prop.On);
                break;
            case EditorPropertyCategory::AxisVec3:
                Controls_->AxisVec3("##v", Prop.Axes, Prop.AxisStep, Prop.Editable);
                break;
            case EditorPropertyCategory::Colour:
                if (Prop.Swatches)
                {
                    Controls_->SwatchRow("##t", Prop.ColourTint);
                }
                else
                {
                    Controls_->ColourChip("##c", Prop.ColourTint);
                }
                break;
            case EditorPropertyCategory::Select:
                Controls_->DropDown("##d", &Prop.Picked, Prop.Options, Prop.OptionCount);
                break;
            case EditorPropertyCategory::Readout:
                Controls_->Readout(Prop.Text);
                break;
            default:
                break;
            }
            ImGui::EndChild();

            Y += ProwH + 8.0f;
        }
    }

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Max.y));
    ImGui::Dummy(ImVec2(RowWidth, 10.0f));
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      RECORD STANDING
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::RecordStanding(EditorInstance* Picked, uint32_t PickedIndex) noexcept
{
    ImGui::PushID(6);

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    constexpr float kH = 130.0f;
    ImGui::Dummy(ImVec2(RowWidth, kH));
    const ImVec2 Min = ImGui::GetItemRectMin();
    const ImVec2 Max = ImGui::GetItemRectMax();

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    Draw->AddRectFilled(Min, Max, kInset, 18.0f);
    Draw->AddRect(Min, Max, kStroke, 18.0f);

    RecordCaps("Instance", ImVec2(Min.x + 14.0f, Min.y + 14.0f), kDim);

    ImFont* Small = Controls_->QuerySmall();
    const char* Pills[4] = { "VISIBLE", "LOCKED", "DYNAMIC", "PHYSICS" };
    bool* Standing[4] = { &Picked->Visible, &Picked->Locked, &Picked->Dynamic, &Picked->Physics };
    float PX = Min.x + 14.0f;
    const float PY = Min.y + 40.0f;
    for (uint32_t i = 0u; i < 4u; ++i)
    {
        ImGui::PushFont(Small);
        const ImVec2 Glyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Pills[i]);
        ImGui::PopFont();
        ImGui::SetCursorScreenPos(ImVec2(PX, PY));
        ImGui::PushID(static_cast<int>(10 + i));
        ImGui::BeginDisabled(Picked->Pinned);
        Controls_->PillToggle(Pills[i], Standing[i]);
        ImGui::EndDisabled();
        ImGui::PopID();
        PX += Glyph.x + 20.0f + 8.0f;
    }

    const float BodyX = Min.x + 14.0f;
    const float ZoneX = BodyX + 78.0f;
    const float ZoneW = RowWidth - 28.0f - 78.0f;
    float Y = Min.y + 72.0f;

    ImGui::PushFont(Small);
    Draw->AddText(ImVec2(BodyX, Y), kDim, "TYPE");
    ImGui::PopFont();
    ImGui::SetCursorScreenPos(ImVec2(ZoneX, Y));
    ImGui::BeginChild("##spectype", ImVec2(ZoneW, 18.0f), false,
        ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    Controls_->Readout(EditorInstanceLabel(Picked->Category));
    ImGui::EndChild();
    Y += 24.0f;

    char IdText[8] = {};
    std::snprintf(IdText, sizeof(IdText), "#%03u", PickedIndex);
    ImGui::PushFont(Small);
    Draw->AddText(ImVec2(BodyX, Y), kDim, "ID");
    ImGui::PopFont();
    ImGui::SetCursorScreenPos(ImVec2(ZoneX, Y));
    ImGui::BeginChild("##specid", ImVec2(ZoneW, 18.0f), false,
        ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    Controls_->Readout(IdText);
    ImGui::EndChild();

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Max.y));
    ImGui::Dummy(ImVec2(RowWidth, 10.0f));
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          NOTES
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::RecordNotes(EditorInstance* Picked) noexcept
{
    ImGui::PushID(7);

    const float RowWidth = ImGui::GetContentRegionAvail().x;
    const float H = CardShut_[7] ? (12.0f + 24.0f + 10.0f) : (12.0f + 24.0f + 8.0f + 64.0f + 14.0f);
    ImGui::Dummy(ImVec2(RowWidth, H));
    const ImVec2 Min = ImGui::GetItemRectMin();
    const ImVec2 Max = ImGui::GetItemRectMax();

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    Draw->AddRectFilled(Min, Max, kInset, 18.0f);
    Draw->AddRect(Min, Max, kStroke, 18.0f);

    const ImVec2 HeadMin(Min.x + 14.0f, Min.y + 12.0f);
    ImGui::SetCursorScreenPos(HeadMin);
    ImGui::InvisibleButton("##h4n", ImVec2(RowWidth - 28.0f, 24.0f));
    if (ImGui::IsItemHovered() && ImGui::IsMouseClicked(0))
    {
        CardShut_[7] = !CardShut_[7];
    }
    const float ChevY = HeadMin.y + 12.0f;
    if (CardShut_[7])
    {
        Draw->AddTriangleFilled(ImVec2(HeadMin.x + 1.0f, ChevY - 4.0f), ImVec2(HeadMin.x + 1.0f, ChevY + 4.0f),
            ImVec2(HeadMin.x + 7.0f, ChevY), kDim);
    }
    else
    {
        Draw->AddTriangleFilled(ImVec2(HeadMin.x - 1.0f, ChevY - 2.5f), ImVec2(HeadMin.x + 9.0f, ChevY - 2.5f),
            ImVec2(HeadMin.x + 4.0f, ChevY + 3.5f), kDim);
    }
    RecordCaps("Notes", ImVec2(HeadMin.x + 14.0f, HeadMin.y + 5.0f), kDim);

    if (!CardShut_[7])
    {
        const float BodyX = Min.x + 14.0f;
        const float BodyW = RowWidth - 28.0f;
        ImGui::SetCursorScreenPos(ImVec2(BodyX, Min.y + 12.0f + 24.0f + 8.0f));
        ImGui::PushItemWidth(BodyW);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.0f, 0.0f, 0.0f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Border, NotesFocus_
            ? ImVec4(0.180f, 0.180f, 0.180f, 1.0f) : ImVec4(1.0f, 1.0f, 1.0f, 0.05f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(8.0f, 8.0f));
        ImGui::PushFont(Controls_->QueryUi());
        ImGui::InputTextMultiline("##notes", Picked->Notes, sizeof(Picked->Notes), ImVec2(BodyW, 64.0f));
        NotesFocus_ = ImGui::IsItemFocused();
        ImGui::PopFont();
        ImGui::PopStyleVar(3);
        ImGui::PopStyleColor(2);
        ImGui::PopItemWidth();
    }

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Max.y));
    ImGui::Dummy(ImVec2(RowWidth, 10.0f));
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                           FOOTER
//------------------------------------------------------------------------------------------------------------------------

void InspectorPanel::RecordFooter(EditorInstance* Picked) noexcept
{
    const float RowWidth = ImGui::GetContentRegionAvail().x;
    // Pinned to the sill: whatever the content above ends at, the foot opens on the shared top row.
    const float FootTop = Controls_->QueryFootTop();
    if (ImGui::GetCursorScreenPos().y < FootTop)
    {
        ImGui::SetCursorScreenPos(ImVec2(ImGui::GetCursorScreenPos().x, FootTop));
    }
    ImGui::Dummy(ImVec2(RowWidth, kEditorFooterH));
    const ImVec2 Cursor = ImGui::GetItemRectMin();

    ImDrawList* Draw = ImGui::GetWindowDrawList();
    const ImVec2 FootPos  = ImGui::GetWindowPos();
    const ImVec2 FootSize = ImGui::GetWindowSize();
    const float  FootX0   = FootPos.x;
    const float  FootX1   = FootPos.x + FootSize.x;
    const float  FootH    = kEditorFooterH;
    Draw->AddRectFilled(ImVec2(FootX0, Cursor.y), ImVec2(FootX1, Cursor.y + FootH), kWash);
    Draw->AddLine(ImVec2(FootX0, Cursor.y), ImVec2(FootX1, Cursor.y), kStroke);

    char Foot[64] = {};
    if (Picked == nullptr)
    {
        std::snprintf(Foot, sizeof(Foot), "\xe2\x80\x94");
    }
    else if (Picked->Locked)
    {
        std::snprintf(Foot, sizeof(Foot), "%s \xc2\xb7 %s \xc2\xb7 locked",
            EditorInstanceLabel(Picked->Category), Picked->Dynamic ? "dynamic" : "static");
    }
    else
    {
        std::snprintf(Foot, sizeof(Foot), "%s \xc2\xb7 %s",
            EditorInstanceLabel(Picked->Category), Picked->Dynamic ? "dynamic" : "static");
    }
    ImFont* Small = Controls_->QuerySmall();
    ImGui::PushFont(Small);
    const ImVec2 FootGlyph = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, Foot);
    Draw->AddText(ImVec2(FootX0 + 14.0f, Cursor.y + (FootH - FootGlyph.y) * 0.5f), kFaint, Foot);
    ImGui::PopFont();

    // The live figures, right-hung: the tinted realtime, the triangle total, and the warning
    //    triangle off a Poor band. Unseated they read dashes, like the outliner's resting figures.
    const char* Dash = "\xe2\x80\x94";
    char FpsFig[12] = {}, TrisFig[16] = {};
    const char*   FpsText  = Dash;
    const char*   TrisText = Dash;
    EditorFpsBand Band     = EditorFpsBand::Fair;
    if (Readout_ != nullptr)
    {
        std::snprintf(FpsFig, sizeof(FpsFig), "%.0f", static_cast<double>(Readout_->Fps));
        FpsText = FpsFig;
        Band    = EditorFpsBandFor(Readout_->Fps);
        if (Readout_->Triangles > 0u)
        {
            std::snprintf(TrisFig, sizeof(TrisFig), "%u", Readout_->Triangles);
            TrisText = TrisFig;
        }
    }
    const ImU32 FpsTint = (Readout_ == nullptr) ? kFaint
        : (Band == EditorFpsBand::Good ? kGreen : (Band == EditorFpsBand::Poor ? kAmber : kText));
    ImGui::PushFont(Small);
    const float FpsW  = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, FpsText).x;
    const float TrisW = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, TrisText).x;
    const float SepW  = Small->CalcTextSizeA(Small->LegacySize, FLT_MAX, 0.0f, " \xc2\xb7 ").x;
    ImGui::PopFont();
    const float FpsLabW  = CapsAdvance(Small, "FPS");
    const float TrisLabW = CapsAdvance(Small, "TRIS");
    const bool  Poor     = (Readout_ != nullptr) && (Band == EditorFpsBand::Poor);
    const float BlockW = FpsLabW + 6.0f + FpsW + SepW + TrisLabW + 6.0f + TrisW + (Poor ? 13.0f : 0.0f);
    float       RX     = FootX1 - 14.0f - BlockW;
    const float TextY  = Cursor.y + (FootH - FootGlyph.y) * 0.5f;
    RX += RecordCaps("FPS", ImVec2(RX, TextY), kFaint) + 6.0f;
    ImGui::PushFont(Small);
    Draw->AddText(ImVec2(RX, TextY), FpsTint, FpsText);
    RX += FpsW;
    Draw->AddText(ImVec2(RX, TextY), kFaint, " \xc2\xb7 ");
    RX += SepW;
    ImGui::PopFont();
    RX += RecordCaps("TRIS", ImVec2(RX, TextY), kFaint) + 6.0f;
    ImGui::PushFont(Small);
    Draw->AddText(ImVec2(RX, TextY), (TrisText == Dash) ? kFaint : kText, TrisText);
    ImGui::PopFont();
    RX += TrisW;
    if (Poor)
    {
        FootWarn(Draw, ImVec2(RX + 3.0f, Cursor.y + (FootH - 10.0f) * 0.5f), 10.0f, kAmber);
    }
}

} // namespace Frontier

//============================================================================================================================================
//                                                PROJECTZEROINTERCHANGE.CPP
//============================================================================================================================================
// 📦 Project-Zero's optional code image; the shared Frontier host owns every window and renderer facility.

#include "../../../Engine/ProjectInterchange/ProjectInterchange.h"

#include <cstdio>
#include <cstring>

namespace
{

constexpr uint32_t MaterialShowcaseSide = 20u;
constexpr uint32_t MaterialShowcaseCellCount = MaterialShowcaseSide * MaterialShowcaseSide;
constexpr uint32_t ProjectZeroSubjectCount = 1u + MaterialShowcaseSide + MaterialShowcaseCellCount + 2u;

void WriteRefusal(FrontierProjectRefusal* Refusal, FrontierProjectRefusalNumber Number, const char* Explanation)
{
    if (Refusal == nullptr)
        return;

    Refusal->Number = static_cast<uint32_t>(Number);
    std::snprintf(Refusal->Explanation, sizeof(Refusal->Explanation), "%s", Explanation);
}

void EmitIdentitySubject(
    const FrontierProjectHostInterchange* HostInterchange,
    const char* SubjectName)
{
    if (HostInterchange == nullptr || HostInterchange->ReceiveSceneMutation == nullptr)
        return;

    FrontierProjectSceneMutation Mutation{};
    Mutation.StructureSize = sizeof(FrontierProjectSceneMutation);
    Mutation.MutationNumber = 1u;
    Mutation.SubjectName = SubjectName;
    Mutation.Transform[0] = Mutation.Transform[5] = Mutation.Transform[10] = Mutation.Transform[15] = 1.0f;
    HostInterchange->ReceiveSceneMutation(&Mutation, HostInterchange->ProjectReception);
}

void EmitMaterialShowcaseSubjects(const FrontierProjectHostInterchange* HostInterchange)
{
    if (HostInterchange == nullptr || HostInterchange->ReceiveSceneMutation == nullptr)
        return;

    static char RowSubjects[MaterialShowcaseSide][64]{};
    static char CellSubjects[MaterialShowcaseCellCount][80]{};
    static bool SubjectsPrepared = false;
    if (!SubjectsPrepared)
    {
        for (uint32_t Row = 0u; Row < MaterialShowcaseSide; ++Row)
        {
            std::snprintf(RowSubjects[Row], sizeof(RowSubjects[Row]), "MaterialShowcase.Row%02u", Row);
            for (uint32_t Column = 0u; Column < MaterialShowcaseSide; ++Column)
            {
                const uint32_t Slot = Row * MaterialShowcaseSide + Column;
                std::snprintf(
                    CellSubjects[Slot],
                    sizeof(CellSubjects[Slot]),
                    "MaterialShowcase.Row%02u.Column%02u",
                    Row,
                    Column);
            }
        }
        SubjectsPrepared = true;
    }

    EmitIdentitySubject(HostInterchange, "MaterialShowcase");
    for (uint32_t Row = 0u; Row < MaterialShowcaseSide; ++Row)
    {
        EmitIdentitySubject(HostInterchange, RowSubjects[Row]);
        for (uint32_t Column = 0u; Column < MaterialShowcaseSide; ++Column)
        {
            const uint32_t Slot = Row * MaterialShowcaseSide + Column;
            EmitIdentitySubject(HostInterchange, CellSubjects[Slot]);
        }
    }
    EmitIdentitySubject(HostInterchange, "MaterialShowcase.InterfacePanel");
    EmitIdentitySubject(HostInterchange, "MaterialShowcase.SunSky");
}

void EmitRenderPreference(
    const FrontierProjectHostInterchange* HostInterchange,
    uint32_t RenderModeNumber,
    uint32_t IndirectIlluminationEnabled)
{
    if (HostInterchange == nullptr || HostInterchange->ReceiveRenderingPreference == nullptr)
        return;

    FrontierProjectRenderingPreference Preference{};
    Preference.StructureSize = sizeof(FrontierProjectRenderingPreference);
    Preference.RenderModeNumber = RenderModeNumber;
    Preference.IndirectIlluminationEnabled = IndirectIlluminationEnabled;
    HostInterchange->ReceiveRenderingPreference(&Preference, HostInterchange->ProjectReception);
}

uint32_t FRONTIER_CODE_IMAGE_CALL ConstructProject(
    const FrontierProjectLaunch* ActiveLaunch,
    const FrontierProjectHostInterchange* HostInterchange,
    void** ProjectRecord,
    FrontierProjectRefusal* Refusal)
{
    if (ActiveLaunch == nullptr || ActiveLaunch->StructureSize < sizeof(FrontierProjectLaunch) ||
        HostInterchange == nullptr || HostInterchange->StructureSize < sizeof(FrontierProjectHostInterchange) ||
        ProjectRecord == nullptr)
    {
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectZero received an incomplete Frontier host record");
        return 0u;
    }

    if (HostInterchange->ReceivePanel != nullptr)
    {
        static const FrontierProjectPanel Panels[] =
        {
            { sizeof(FrontierProjectPanel), "ProjectZeroOutliner",       "Project-Zero Outliner" },
            { sizeof(FrontierProjectPanel), "MaterialShowcase",         "20 x 20 Material Showcase" },
            { sizeof(FrontierProjectPanel), "MaterialInspector",        "Material Inspector" },
            { sizeof(FrontierProjectPanel), "RenderModeInspector",      "Visibility / Surfel GI / ReSTIR" },
            { sizeof(FrontierProjectPanel), "CelestialEnvironment",     "Sun and Sky" },
        };
        for (const FrontierProjectPanel& Panel : Panels)
            HostInterchange->ReceivePanel(&Panel, HostInterchange->ProjectReception);
    }

    EmitMaterialShowcaseSubjects(HostInterchange);

    if (HostInterchange->ReceiveCameraRequest != nullptr)
    {
        FrontierProjectCameraRequest Camera{};
        Camera.StructureSize = sizeof(FrontierProjectCameraRequest);
        Camera.Eye[0] = 0.0f;
        Camera.Eye[1] = -18.0f;
        Camera.Eye[2] = 8.2f;
        Camera.Forward[0] = 0.0f;
        Camera.Forward[1] = 0.92f;
        Camera.Forward[2] = -0.39f;
        Camera.VerticalFieldOfView = 0.92f;
        HostInterchange->ReceiveCameraRequest(&Camera, HostInterchange->ProjectReception);
    }

    EmitRenderPreference(HostInterchange, 0u, 0u);
    EmitRenderPreference(HostInterchange, 1u, 1u);
    EmitRenderPreference(HostInterchange, 2u, 1u);

    if (HostInterchange->ReceiveDiagnostic != nullptr)
    {
        FrontierProjectDiagnostic Diagnostic{};
        Diagnostic.StructureSize = sizeof(FrontierProjectDiagnostic);
        Diagnostic.SeverityNumber = 0u;
        Diagnostic.SubjectName = "MaterialShowcase";
        Diagnostic.Explanation = "ProjectZero opens Content/Scenes/Showcase.gltf and declares the 20 x 20 material showcase, material inspector, render modes, and sun/sky editor panels through the C ABI.";
        HostInterchange->ReceiveDiagnostic(&Diagnostic, HostInterchange->ProjectReception);
    }

    *ProjectRecord = nullptr;
    return 1u;
}

uint32_t FRONTIER_CODE_IMAGE_CALL AdvanceProject(
    void* ProjectRecord,
    const FrontierProjectCycle* ActiveCycle,
    FrontierProjectRefusal* Refusal)
{
    (void)ProjectRecord;
    if (ActiveCycle == nullptr || ActiveCycle->StructureSize < sizeof(FrontierProjectCycle))
    {
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectZero received an incomplete display-cycle record");
        return 0u;
    }

    return 1u;
}

void FRONTIER_CODE_IMAGE_CALL RetireProject(void* ProjectRecord)
{
    (void)ProjectRecord;
}

static_assert(ProjectZeroSubjectCount == 423u, "ProjectZero subject declaration count must stay explicit");

} // namespace

extern "C" FRONTIER_CODE_IMAGE_EXPORT uint32_t FRONTIER_CODE_IMAGE_CALL ConstructProjectInterchange(
    uint32_t RequestedInterchangeNumber,
    uint64_t RequestedFingerprint,
    FrontierProjectInterchange* DeliveredInterchange,
    FrontierProjectRefusal* Refusal)
{
    if (DeliveredInterchange == nullptr || RequestedInterchangeNumber != FrontierCodeInterchangeNumber ||
        RequestedFingerprint != FrontierCodeInterchangeFingerprint)
    {
        WriteRefusal(Refusal, FrontierProjectRefusalInterchange, "ProjectZero cannot deliver the requested code interchange");
        return 0u;
    }

    std::memset(DeliveredInterchange, 0, sizeof(*DeliveredInterchange));
    DeliveredInterchange->StructureSize = sizeof(FrontierProjectInterchange);
    DeliveredInterchange->CodeInterchangeNumber = FrontierCodeInterchangeNumber;
    DeliveredInterchange->InterfaceFingerprint = FrontierCodeInterchangeFingerprint;
    DeliveredInterchange->ConstructProject = &ConstructProject;
    DeliveredInterchange->AdvanceProject = &AdvanceProject;
    DeliveredInterchange->RetireProject = &RetireProject;
    return 1u;
}

//============================================================================================================================================
//                                               PROJECTDRIVEINTERCHANGE.CPP
//============================================================================================================================================
// 📦 Project-Drive's optional code image; vehicle semantics cross Frontier.exe only through C-layout records.

#include "../../../Engine/ProjectInterchange/ProjectInterchange.h"

#include <cstdio>
#include <cstring>

namespace
{

constexpr uint32_t DriveMaterialShowcaseSide = 20u;
constexpr uint32_t DriveMaterialShowcaseCellCount = DriveMaterialShowcaseSide * DriveMaterialShowcaseSide;
constexpr uint32_t DriveStaticSubjectCount = 26u;
constexpr uint32_t ProjectDriveSubjectCount = DriveStaticSubjectCount + DriveMaterialShowcaseSide + DriveMaterialShowcaseCellCount;

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

void EmitDriveMaterialShowcaseSubjects(const FrontierProjectHostInterchange* HostInterchange)
{
    if (HostInterchange == nullptr || HostInterchange->ReceiveSceneMutation == nullptr)
        return;

    static char RowSubjects[DriveMaterialShowcaseSide][96]{};
    static char CellSubjects[DriveMaterialShowcaseCellCount][112]{};
    static bool SubjectsPrepared = false;
    if (!SubjectsPrepared)
    {
        for (uint32_t Row = 0u; Row < DriveMaterialShowcaseSide; ++Row)
        {
            std::snprintf(RowSubjects[Row], sizeof(RowSubjects[Row]), "DriveCourse.MaterialShowcase.Row%02u", Row);
            for (uint32_t Column = 0u; Column < DriveMaterialShowcaseSide; ++Column)
            {
                const uint32_t Slot = Row * DriveMaterialShowcaseSide + Column;
                std::snprintf(
                    CellSubjects[Slot],
                    sizeof(CellSubjects[Slot]),
                    "DriveCourse.MaterialShowcase.Row%02u.Column%02u",
                    Row,
                    Column);
            }
        }
        SubjectsPrepared = true;
    }

    for (uint32_t Row = 0u; Row < DriveMaterialShowcaseSide; ++Row)
    {
        EmitIdentitySubject(HostInterchange, RowSubjects[Row]);
        for (uint32_t Column = 0u; Column < DriveMaterialShowcaseSide; ++Column)
        {
            const uint32_t Slot = Row * DriveMaterialShowcaseSide + Column;
            EmitIdentitySubject(HostInterchange, CellSubjects[Slot]);
        }
    }
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
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectDrive received an incomplete Frontier host record");
        return 0u;
    }

    // These declarations let the shared Frontier editor own the UI/render/input implementation while Project-Drive
    // owns the vehicle semantics. They are deliberately granular: selecting ControlVehicle reveals the inspector,
    // while each XPBD tyre, wheel hub and brake row is independently addressable in the project outliner.
    if (HostInterchange->ReceivePanel != nullptr)
    {
        static const FrontierProjectPanel Panels[] =
        {
            { sizeof(FrontierProjectPanel), "DriveOutliner",              "Project-Drive Outliner" },
            { sizeof(FrontierProjectPanel), "ControlVehicle",            "ControlVehicle Inspector" },
            { sizeof(FrontierProjectPanel), "XPBDTyres",                 "XPBD Tyres" },
            { sizeof(FrontierProjectPanel), "VehicleDynamics",           "Vehicle Dynamics" },
            { sizeof(FrontierProjectPanel), "DriveRenderModes",          "Visibility / Surfel GI / ReSTIR" },
            { sizeof(FrontierProjectPanel), "DriveMaterialShowcase",     "Drive Material Showcase" },
            { sizeof(FrontierProjectPanel), "DriveTelemetry",            "Telemetry Graphs" },
        };
        for (const FrontierProjectPanel& Panel : Panels)
            HostInterchange->ReceivePanel(&Panel, HostInterchange->ProjectReception);
    }

    if (HostInterchange->ReceiveSceneMutation != nullptr)
    {
        static const char* const Subjects[] =
        {
            "ProjectDrive",
            "ControlVehicle",
            "ControlVehicle.Body",
            "ControlVehicle.Body.Paint",
            "ControlVehicle.Body.Glass",
            "ControlVehicle.Body.Trim",
            "ControlVehicle.XPBDTyres",
            "ControlVehicle.XPBDTyre.FL",
            "ControlVehicle.XPBDTyre.FR",
            "ControlVehicle.XPBDTyre.RL",
            "ControlVehicle.XPBDTyre.RR",
            "ControlVehicle.WheelHub.FL",
            "ControlVehicle.WheelHub.FR",
            "ControlVehicle.WheelHub.RL",
            "ControlVehicle.WheelHub.RR",
            "ControlVehicle.Brake.FL",
            "ControlVehicle.Brake.FR",
            "ControlVehicle.Brake.RL",
            "ControlVehicle.Brake.RR",
            "DriveCourse",
            "DriveCourse.Ramp",
            "DriveCourse.Slalom",
            "DriveCourse.SpeedBumps",
            "DriveCourse.Cones",
            "DriveCourse.MaterialShowcase",
            "DriveCourse.SunSky",
        };
        for (const char* Subject : Subjects)
            EmitIdentitySubject(HostInterchange, Subject);
        EmitDriveMaterialShowcaseSubjects(HostInterchange);
    }

    if (HostInterchange->ReceiveCameraRequest != nullptr)
    {
        FrontierProjectCameraRequest Camera{};
        Camera.StructureSize = sizeof(FrontierProjectCameraRequest);
        Camera.Eye[0] = -7.0f;
        Camera.Eye[1] = -8.0f;
        Camera.Eye[2] = 4.0f;
        Camera.Forward[0] = 0.64f;
        Camera.Forward[1] = 0.68f;
        Camera.Forward[2] = -0.36f;
        Camera.VerticalFieldOfView = 0.82f;
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
        Diagnostic.SubjectName = "ControlVehicle";
        Diagnostic.Explanation = "Vehicle inspector declares chassis paint/glass/trim, Pacejka drivetrain, wheel hubs, brakes and XPBD tyre rows; project code stays C-ABI-only.";
        HostInterchange->ReceiveDiagnostic(&Diagnostic, HostInterchange->ProjectReception);

        FrontierProjectDiagnostic ShowcaseDiagnostic{};
        ShowcaseDiagnostic.StructureSize = sizeof(FrontierProjectDiagnostic);
        ShowcaseDiagnostic.SeverityNumber = 0u;
        ShowcaseDiagnostic.SubjectName = "DriveCourse.MaterialShowcase";
        ShowcaseDiagnostic.Explanation = "Drive course includes a project-owned 20 x 20 material showcase so visibility, Surfel GI and ReSTIR proofs render the same scene family as Project-Zero.";
        HostInterchange->ReceiveDiagnostic(&ShowcaseDiagnostic, HostInterchange->ProjectReception);
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
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectDrive received an incomplete display-cycle record");
        return 0u;
    }

    return 1u;
}

void FRONTIER_CODE_IMAGE_CALL RetireProject(void* ProjectRecord)
{
    (void)ProjectRecord;
}

static_assert(ProjectDriveSubjectCount == 446u, "ProjectDrive subject declaration count must stay explicit");

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
        WriteRefusal(Refusal, FrontierProjectRefusalInterchange, "ProjectDrive cannot deliver the requested code interchange");
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

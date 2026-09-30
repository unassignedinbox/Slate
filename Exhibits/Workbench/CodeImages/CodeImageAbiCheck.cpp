//============================================================================================================================================
//                                                   CODEIMAGEABICHECK.CPP
//============================================================================================================================================
// 📦 Exercises project code images through the revisioned Frontier C ABI and verifies editor/scene declarations.

#include "Engine/ProjectInterchange/ProjectInterchange.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <string>
#include <vector>

namespace
{

struct ExpectedImage
{
    const char* Path = nullptr;
    int ExpectedPanels = 0;
    int ExpectedMutations = 0;
    int ExpectedDiagnostics = 0;
    int ExpectedCameras = 0;
    int ExpectedPreferences = 0;
    const char* const* RequiredPanels = nullptr;
    int RequiredPanelCount = 0;
    const char* const* RequiredSubjects = nullptr;
    int RequiredSubjectCount = 0;
    const char* const* RequiredDiagnostics = nullptr;
    int RequiredDiagnosticCount = 0;
};

int PanelCount = 0;
int SceneMutationCount = 0;
int DiagnosticCount = 0;
int CameraCount = 0;
int RenderingPreferenceCount = 0;
bool HostRecordInvalid = false;
std::vector<std::string> PanelNames;
std::vector<std::string> SubjectNames;
std::vector<std::string> DiagnosticSubjects;
std::vector<uint32_t> RenderModes;

void FRONTIER_CODE_IMAGE_CALL ReceivePanel(const FrontierProjectPanel* Panel, void*)
{
    if (Panel == nullptr || Panel->StructureSize < sizeof(FrontierProjectPanel) ||
        Panel->StableName == nullptr || Panel->DisplayName == nullptr)
    {
        HostRecordInvalid = true;
        return;
    }
    ++PanelCount;
    PanelNames.emplace_back(Panel->StableName);
    std::printf("  received panel: %s (%s)\n", Panel->DisplayName, Panel->StableName);
}

void FRONTIER_CODE_IMAGE_CALL ReceiveSceneMutation(const FrontierProjectSceneMutation* Mutation, void*)
{
    if (Mutation == nullptr || Mutation->StructureSize < sizeof(FrontierProjectSceneMutation) ||
        Mutation->MutationNumber != 1u || Mutation->SubjectName == nullptr ||
        Mutation->Transform[0] != 1.0f || Mutation->Transform[5] != 1.0f ||
        Mutation->Transform[10] != 1.0f || Mutation->Transform[15] != 1.0f)
    {
        HostRecordInvalid = true;
        return;
    }
    ++SceneMutationCount;
    SubjectNames.emplace_back(Mutation->SubjectName);
    std::printf("  received scene subject: %s\n", Mutation->SubjectName);
}

void FRONTIER_CODE_IMAGE_CALL ReceiveCameraRequest(const FrontierProjectCameraRequest* Camera, void*)
{
    if (Camera == nullptr || Camera->StructureSize < sizeof(FrontierProjectCameraRequest) ||
        !(Camera->VerticalFieldOfView > 0.1f))
    {
        HostRecordInvalid = true;
        return;
    }
    ++CameraCount;
    std::printf("  received camera: eye %.2f %.2f %.2f fov %.2f\n",
                Camera->Eye[0], Camera->Eye[1], Camera->Eye[2], Camera->VerticalFieldOfView);
}

void FRONTIER_CODE_IMAGE_CALL ReceiveRenderingPreference(const FrontierProjectRenderingPreference* Preference, void*)
{
    if (Preference == nullptr || Preference->StructureSize < sizeof(FrontierProjectRenderingPreference))
    {
        HostRecordInvalid = true;
        return;
    }
    ++RenderingPreferenceCount;
    RenderModes.emplace_back(Preference->RenderModeNumber);
    std::printf("  received render preference: mode %u indirect %u\n",
                Preference->RenderModeNumber, Preference->IndirectIlluminationEnabled);
}

void FRONTIER_CODE_IMAGE_CALL ReceiveDiagnostic(const FrontierProjectDiagnostic* Diagnostic, void*)
{
    if (Diagnostic == nullptr || Diagnostic->StructureSize < sizeof(FrontierProjectDiagnostic) ||
        Diagnostic->SubjectName == nullptr || Diagnostic->Explanation == nullptr)
    {
        HostRecordInvalid = true;
        return;
    }
    ++DiagnosticCount;
    DiagnosticSubjects.emplace_back(Diagnostic->SubjectName);
    std::printf("  received diagnostic: %s\n", Diagnostic->SubjectName);
}

bool ContainsName(const std::vector<std::string>& Names, const char* RequiredName)
{
    return std::find(Names.begin(), Names.end(), RequiredName) != Names.end();
}

bool CheckRequiredNames(
    const std::vector<std::string>& Names,
    const char* const* RequiredNames,
    int RequiredNameCount,
    const char* Label,
    const char* Path)
{
    for (int Index = 0; Index < RequiredNameCount; ++Index)
    {
        if (!ContainsName(Names, RequiredNames[Index]))
        {
            std::fprintf(stderr, "[ABI] %s missing required %s '%s'\n", Path, Label, RequiredNames[Index]);
            return false;
        }
    }
    return true;
}

bool CheckImage(const ExpectedImage& Expected)
{
    PanelCount = 0;
    SceneMutationCount = 0;
    DiagnosticCount = 0;
    CameraCount = 0;
    RenderingPreferenceCount = 0;
    HostRecordInvalid = false;
    PanelNames.clear();
    SubjectNames.clear();
    DiagnosticSubjects.clear();
    RenderModes.clear();

    void* Image = dlopen(Expected.Path, RTLD_NOW | RTLD_LOCAL);
    if (Image == nullptr)
    {
        std::fprintf(stderr, "[ABI] dlopen failed for %s: %s\n", Expected.Path, dlerror());
        return false;
    }

    auto Entry = reinterpret_cast<FrontierConstructProjectInterchange>(dlsym(Image, "ConstructProjectInterchange"));
    if (Entry == nullptr)
    {
        std::fprintf(stderr, "[ABI] export missing from %s\n", Expected.Path);
        dlclose(Image);
        return false;
    }

    FrontierProjectInterchange Interchange{};
    FrontierProjectRefusal Refusal{};
    if (Entry(FrontierCodeInterchangeNumber, FrontierCodeInterchangeFingerprint, &Interchange, &Refusal) == 0u ||
        Interchange.StructureSize != sizeof(FrontierProjectInterchange) ||
        Interchange.CodeInterchangeNumber != FrontierCodeInterchangeNumber ||
        Interchange.InterfaceFingerprint != FrontierCodeInterchangeFingerprint ||
        Interchange.ConstructProject == nullptr || Interchange.AdvanceProject == nullptr || Interchange.RetireProject == nullptr)
    {
        std::fprintf(stderr, "[ABI] compatible interchange rejected or malformed for %s: %s\n", Expected.Path, Refusal.Explanation);
        dlclose(Image);
        return false;
    }

    FrontierProjectInterchange StaleInterchange{};
    FrontierProjectRefusal StaleRefusal{};
    if (Entry(FrontierCodeInterchangeNumber - 1u, FrontierCodeInterchangeFingerprint, &StaleInterchange, &StaleRefusal) != 0u ||
        StaleRefusal.Number != FrontierProjectRefusalInterchange)
    {
        std::fprintf(stderr, "[ABI] revision-1 request was not refused by %s\n", Expected.Path);
        dlclose(Image);
        return false;
    }

    FrontierProjectInputReading Input{};
    Input.StructureSize = sizeof(Input);
    FrontierProjectHostInterchange Host{};
    Host.StructureSize = sizeof(Host);
    Host.InputReading = &Input;
    Host.ReceiveSceneMutation = &ReceiveSceneMutation;
    Host.ReceiveCameraRequest = &ReceiveCameraRequest;
    Host.ReceiveRenderingPreference = &ReceiveRenderingPreference;
    Host.ReceivePanel = &ReceivePanel;
    Host.ReceiveDiagnostic = &ReceiveDiagnostic;
    FrontierProjectLaunch Launch{};
    Launch.StructureSize = sizeof(Launch);
    Launch.ProjectName = "AbiContractCheck";
    Launch.SpecificationLocation = "AbiContractCheck.frontier";
    Launch.ContentLocation = "Content";
    Launch.OpeningSceneLocation = "Content/Scenes/Opening.gltf";
    void* ProjectRecord = nullptr;
    std::memset(&Refusal, 0, sizeof(Refusal));
    if (Interchange.ConstructProject(&Launch, &Host, &ProjectRecord, &Refusal) == 0u)
    {
        std::fprintf(stderr, "[ABI] ConstructProject rejected %s: %s\n", Expected.Path, Refusal.Explanation);
        dlclose(Image);
        return false;
    }

    FrontierProjectCycle Cycle{};
    Cycle.StructureSize = sizeof(Cycle);
    Cycle.ElapsedSeconds = 1.0f;
    Cycle.CycleSeconds = 1.0f / 60.0f;
    Cycle.InputReading = &Input;
    std::memset(&Refusal, 0, sizeof(Refusal));
    if (Interchange.AdvanceProject(ProjectRecord, &Cycle, &Refusal) == 0u)
    {
        std::fprintf(stderr, "[ABI] AdvanceProject rejected %s: %s\n", Expected.Path, Refusal.Explanation);
        Interchange.RetireProject(ProjectRecord);
        dlclose(Image);
        return false;
    }
    Interchange.RetireProject(ProjectRecord);

    if (HostRecordInvalid || PanelCount != Expected.ExpectedPanels || SceneMutationCount != Expected.ExpectedMutations ||
        DiagnosticCount != Expected.ExpectedDiagnostics || CameraCount != Expected.ExpectedCameras ||
        RenderingPreferenceCount != Expected.ExpectedPreferences)
    {
        std::fprintf(stderr,
                     "[ABI] host callback expectation failed for %s (panels %d/%d, subjects %d/%d, diagnostics %d/%d, cameras %d/%d, render preferences %d/%d)\n",
                     Expected.Path,
                     PanelCount,
                     Expected.ExpectedPanels,
                     SceneMutationCount,
                     Expected.ExpectedMutations,
                     DiagnosticCount,
                     Expected.ExpectedDiagnostics,
                     CameraCount,
                     Expected.ExpectedCameras,
                     RenderingPreferenceCount,
                     Expected.ExpectedPreferences);
        dlclose(Image);
        return false;
    }

    bool RequiredPassed = CheckRequiredNames(PanelNames, Expected.RequiredPanels, Expected.RequiredPanelCount, "panel", Expected.Path);
    RequiredPassed = CheckRequiredNames(SubjectNames, Expected.RequiredSubjects, Expected.RequiredSubjectCount, "subject", Expected.Path) && RequiredPassed;
    RequiredPassed = CheckRequiredNames(DiagnosticSubjects, Expected.RequiredDiagnostics, Expected.RequiredDiagnosticCount, "diagnostic", Expected.Path) && RequiredPassed;
    if (!ContainsName(SubjectNames, Expected.ExpectedMutations == 423 ? "MaterialShowcase.Row19.Column19" : "DriveCourse.MaterialShowcase.Row19.Column19"))
    {
        std::fprintf(stderr, "[ABI] %s did not declare the final 20 x 20 material-showcase subject\n", Expected.Path);
        RequiredPassed = false;
    }
    if (std::find(RenderModes.begin(), RenderModes.end(), 0u) == RenderModes.end() ||
        std::find(RenderModes.begin(), RenderModes.end(), 1u) == RenderModes.end() ||
        std::find(RenderModes.begin(), RenderModes.end(), 2u) == RenderModes.end())
    {
        std::fprintf(stderr, "[ABI] %s did not declare visibility, Surfel GI and ReSTIR render preferences\n", Expected.Path);
        RequiredPassed = false;
    }

    if (!RequiredPassed)
    {
        dlclose(Image);
        return false;
    }

    std::printf("[ABI] accepted revision %llu fingerprint 0x%016llx: %s\n",
                static_cast<unsigned long long>(FrontierCodeInterchangeNumber),
                static_cast<unsigned long long>(FrontierCodeInterchangeFingerprint), Expected.Path);
    dlclose(Image);
    return true;
}

} // namespace

int main()
{
    static const char* const ProjectZeroPanels[] =
    {
        "ProjectZeroOutliner",
        "MaterialShowcase",
        "MaterialInspector",
        "RenderModeInspector",
        "CelestialEnvironment",
    };
    static const char* const ProjectZeroSubjects[] =
    {
        "MaterialShowcase",
        "MaterialShowcase.Row00",
        "MaterialShowcase.Row00.Column00",
        "MaterialShowcase.Row08.Column10",
        "MaterialShowcase.Row19.Column19",
        "MaterialShowcase.InterfacePanel",
        "MaterialShowcase.SunSky",
    };
    static const char* const ProjectZeroDiagnostics[] =
    {
        "MaterialShowcase",
    };

    static const char* const ProjectDrivePanels[] =
    {
        "DriveOutliner",
        "ControlVehicle",
        "XPBDTyres",
        "VehicleDynamics",
        "DriveRenderModes",
        "DriveMaterialShowcase",
        "DriveTelemetry",
    };
    static const char* const ProjectDriveSubjects[] =
    {
        "ProjectDrive",
        "ControlVehicle.Body.Paint",
        "ControlVehicle.Body.Glass",
        "ControlVehicle.XPBDTyre.FL",
        "ControlVehicle.WheelHub.RR",
        "ControlVehicle.Brake.FR",
        "DriveCourse.Ramp",
        "DriveCourse.Cones",
        "DriveCourse.MaterialShowcase",
        "DriveCourse.MaterialShowcase.Row00.Column00",
        "DriveCourse.MaterialShowcase.Row19.Column19",
        "DriveCourse.SunSky",
    };
    static const char* const ProjectDriveDiagnostics[] =
    {
        "ControlVehicle",
        "DriveCourse.MaterialShowcase",
    };

    const ExpectedImage ProjectZero{
        "./ProjectZero.so",
        5,
        423,
        1,
        1,
        3,
        ProjectZeroPanels,
        static_cast<int>(sizeof(ProjectZeroPanels) / sizeof(ProjectZeroPanels[0])),
        ProjectZeroSubjects,
        static_cast<int>(sizeof(ProjectZeroSubjects) / sizeof(ProjectZeroSubjects[0])),
        ProjectZeroDiagnostics,
        static_cast<int>(sizeof(ProjectZeroDiagnostics) / sizeof(ProjectZeroDiagnostics[0])),
    };
    const ExpectedImage ProjectDrive{
        "./ProjectDrive.so",
        7,
        446,
        2,
        1,
        3,
        ProjectDrivePanels,
        static_cast<int>(sizeof(ProjectDrivePanels) / sizeof(ProjectDrivePanels[0])),
        ProjectDriveSubjects,
        static_cast<int>(sizeof(ProjectDriveSubjects) / sizeof(ProjectDriveSubjects[0])),
        ProjectDriveDiagnostics,
        static_cast<int>(sizeof(ProjectDriveDiagnostics) / sizeof(ProjectDriveDiagnostics[0])),
    };

    bool Passed = CheckImage(ProjectZero);
    Passed = CheckImage(ProjectDrive) && Passed;
    std::printf("[ABI] %s\n", Passed ? "all code-image lifecycle checks passed" : "code-image lifecycle check failed");
    return Passed ? 0 : 1;
}

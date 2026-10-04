//============================================================================================================================================
//                                               PROJECTDRIVEINTERCHANGE.CPP
//============================================================================================================================================
// 📦 Project-Drive's optional code image; vehicle semantics cross Frontier.exe only through C-layout records.

#include "../../../Engine/ProjectInterchange/ProjectInterchange.h"

#include "VehicleInstanceSequence.h"
#include "ChaseCameraSolver.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/DriverInputIntegrator.h"

#include <algorithm>
#include <cmath>
#include <new>
#include <cstdio>
#include <cstring>

namespace
{

struct DriveSequence
{
    FrontierProjectHostInterchange Reception{};
    Frontier::Vehicle::VehicleGeometry Geometry;
    Frontier::Drive::VehicleInstanceSequence Vehicle;
    Frontier::Drive::ChaseCameraSolver Camera;
    Frontier::Vehicle::DriverInputIntegrator Input;
    std::vector<Frontier::InstanceRecord> Poses{5u};
    uint32_t PreviousTransport = 0u;
    bool PreviousReset = false;

    void Construct()
    {
        Frontier::Drive::VehicleInstanceConfiguration Placement;
        Placement.SpawnHeight = Geometry.CoMHeight + 0.02f;
        Vehicle.Construct(Geometry, Placement);
        Input = Frontier::Vehicle::DriverInputIntegrator{};
    }

    void DeliverPoses()
    {
        if (Reception.ReceiveSceneMutation == nullptr) return;
        static const char* Subjects[] = { "ControlVehicle — paint / glass / plastic", "XPBD Tyre FL", "XPBD Tyre FR", "XPBD Tyre RL", "XPBD Tyre RR" };
        for (uint32_t Slot = 0u; Slot < Poses.size(); ++Slot)
        {
            FrontierProjectSceneMutation Mutation{};
            Mutation.StructureSize = sizeof(Mutation);
            Mutation.MutationNumber = 2u;
            Mutation.SubjectName = Subjects[Slot];
            std::copy_n(Poses[Slot].World, 16u, Mutation.Transform);
            Frontier::Vehicle::Vec3 Origin{0.0f, 0.0f, Geometry.CoMHeight + 0.02f};
            if (Slot != 0u) Origin += Geometry.AxleMountLocal(Slot - 1u);
            // The opening glTF is already placed at rest. Send T(simulated) R T(-rest),
            // not an absolute pose applied a second time to that geometry.
            for (uint32_t Row = 0u; Row < 3u; ++Row)
                Mutation.Transform[12u + Row] -= Mutation.Transform[Row] * Origin.x
                                              + Mutation.Transform[4u + Row] * Origin.y
                                              + Mutation.Transform[8u + Row] * Origin.z;
            Reception.ReceiveSceneMutation(&Mutation, Reception.ProjectReception);
        }
    }

    void DeliverCamera(float Seconds, bool Snap)
    {
        const auto& Chassis = Vehicle.Chassis();
        const auto Forward = Chassis.Orientation.Rotate({1.0f, 0.0f, 0.0f});
        const Frontier::Vector3 Position{Chassis.Position.x, Chassis.Position.y, Chassis.Position.z};
        const Frontier::Vector3 Direction{Forward.x, Forward.y, Forward.z};
        if (Snap) Camera.SnapTo(Position, Direction);
        else Camera.AdvanceChase(Position, Direction, std::sqrt(Frontier::Vehicle::Dot(Chassis.LinearVelocity, Chassis.LinearVelocity)), Seconds);
        if (Reception.ReceiveCameraRequest == nullptr) return;
        FrontierProjectCameraRequest Request{};
        Request.StructureSize = sizeof(Request);
        const auto& Eye = Camera.QuerySpatialLocation();
        const auto& Sight = Camera.QueryForwardVector();
        Request.Eye[0] = Eye.x; Request.Eye[1] = Eye.y; Request.Eye[2] = Eye.z;
        Request.Forward[0] = Sight.x; Request.Forward[1] = Sight.y; Request.Forward[2] = Sight.z;
        Request.VerticalFieldOfView = Camera.QueryFieldOfViewRadians();
        Reception.ReceiveCameraRequest(&Request, Reception.ProjectReception);
    }
};

void WriteRefusal(FrontierProjectRefusal* Refusal, FrontierProjectRefusalNumber Number, const char* Explanation)
{
    if (Refusal == nullptr)
        return;

    Refusal->Number = static_cast<uint32_t>(Number);
    std::snprintf(Refusal->Explanation, sizeof(Refusal->Explanation), "%s", Explanation);
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
    // owns the vehicle semantics.  They are deliberately granular: selecting ControlVehicle reveals the inspector,
    // while each XPBD tyre is independently addressable in the project outliner instead of hiding all of the car in
    // a generic "Vehicle Dynamics" placeholder.
    if (HostInterchange->ReceivePanel != nullptr)
    {
        static const FrontierProjectPanel Panels[] =
        {
            { sizeof(FrontierProjectPanel), "DriveOutliner",       "Project-Drive Outliner" },
            { sizeof(FrontierProjectPanel), "ControlVehicle",     "ControlVehicle Inspector" },
            { sizeof(FrontierProjectPanel), "XPBDTyres",          "XPBD Tyres" },
            { sizeof(FrontierProjectPanel), "VehicleDynamics",    "Vehicle Dynamics" },
            { sizeof(FrontierProjectPanel), "DriveRenderModes",   "Surfel GI / ReSTIR" },
        };
        for (const FrontierProjectPanel& Panel : Panels)
            HostInterchange->ReceivePanel(&Panel, HostInterchange->ProjectReception);
    }

    if (HostInterchange->ReceiveDiagnostic != nullptr)
    {
        FrontierProjectDiagnostic Diagnostic{};
        Diagnostic.StructureSize = sizeof(FrontierProjectDiagnostic);
        Diagnostic.SeverityNumber = 0u;
        Diagnostic.SubjectName = "ControlVehicle";
        Diagnostic.Explanation = "Vehicle inspector declares chassis, Pacejka and XPBD tyre rows; project code stays C-ABI-only.";
        HostInterchange->ReceiveDiagnostic(&Diagnostic, HostInterchange->ProjectReception);
    }

    auto* Sequence = new (std::nothrow) DriveSequence;
    if (Sequence == nullptr)
    {
        WriteRefusal(Refusal, FrontierProjectRefusalConstruction, "ProjectDrive could not allocate its vehicle simulation");
        return 0u;
    }
    Sequence->Reception = *HostInterchange;
    Sequence->Construct();
    *ProjectRecord = Sequence;
    return 1u;
}

uint32_t FRONTIER_CODE_IMAGE_CALL AdvanceProject(
    void* ProjectRecord,
    const FrontierProjectCycle* ActiveCycle,
    FrontierProjectRefusal* Refusal)
{
    if (ProjectRecord == nullptr || ActiveCycle == nullptr || ActiveCycle->StructureSize < sizeof(FrontierProjectCycle))
    {
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectDrive received an incomplete display-cycle record");
        return 0u;
    }

    auto& Sequence = *static_cast<DriveSequence*>(ProjectRecord);
    const auto* Reading = ActiveCycle->InputReading;
    if (Reading == nullptr || Reading->StructureSize < sizeof(FrontierProjectInputReading))
    {
        WriteRefusal(Refusal, FrontierProjectRefusalStructure, "ProjectDrive requires revision-3 input readings");
        return 0u;
    }
    const uint32_t Transport = Reading->TransportNumber;
    const bool Started = Transport != 0u && Sequence.PreviousTransport == 0u;
    const bool Reset = Reading->ResetPressed != 0u && !Sequence.PreviousReset && Reading->KeyboardCaptured == 0u;
    if (Started || Reset || (Transport == 0u && Sequence.PreviousTransport != 0u)) Sequence.Construct();
    Sequence.PreviousTransport = Transport;
    Sequence.PreviousReset = Reading->ResetPressed != 0u;
    if (Transport == 0u) return 1u;

    const float Seconds = Reading->Paused ? (Reading->SimulationStep ? 1.0f / 60.0f : 0.0f)
                                         : std::clamp(ActiveCycle->CycleSeconds, 0.0f, 0.1f);
    const bool Driving = Transport == 1u && Reading->KeyboardCaptured == 0u;
    Sequence.Input.ForwardThrottleKey(Driving && Reading->MoveAxisY > 0.0f);
    Sequence.Input.ForwardBrakeKey(Driving && Reading->MoveAxisY < 0.0f);
    Sequence.Input.ForwardSteerLeftKey(Driving && Reading->MoveAxisX < 0.0f);
    Sequence.Input.ForwardSteerRightKey(Driving && Reading->MoveAxisX > 0.0f);
    Sequence.Input.ForwardHandbrakeKey(Driving && Reading->HandbrakePressed != 0u);
    const auto Command = Sequence.Input.Advance(Seconds);
    if (Seconds > 0.0f || Started || Reset)
    {
        Sequence.Vehicle.AdvanceVehicle(Command.Drive, Sequence.Poses, Seconds);
        Sequence.DeliverPoses();
    }
    if (Transport == 1u) Sequence.DeliverCamera(Seconds, Started || Reset);
    return 1u;
}

void FRONTIER_CODE_IMAGE_CALL RetireProject(void* ProjectRecord)
{
    delete static_cast<DriveSequence*>(ProjectRecord);
}

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

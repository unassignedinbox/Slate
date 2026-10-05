//============================================================================================================================================
//                                                                TYREHOST.CPP
//============================================================================================================================================
// 📦 Executed CPU reference renders of native Project Drive XPBD tyres, without raster or triangle hit fallback.

#include "../../Frontier/Projects/Project-Drive/Source/TyreSequence.h"
#include "../../Frontier/Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

using Frontier::Vector3;
using Frontier::DeformationSpace;
using Frontier::DistanceFieldSpace;

namespace
{
float Dot(Vector3 A, Vector3 B) { return A.x * B.x + A.y * B.y + A.z * B.z; }
Vector3 Cross(Vector3 A, Vector3 B)
{
    return {A.y * B.z - A.z * B.y, A.z * B.x - A.x * B.z, A.x * B.y - A.y * B.x};
}
void Require(bool Accepted, const std::string& Message)
{
    if (!Accepted) throw std::runtime_error(Message);
}
struct HitRecord { bool Hit = false; bool Exhausted = false; float Travel = 0.0f; };
HitRecord March(const DistanceFieldSpace& Field, Vector3 Origin, Vector3 Direction)
{
    const Vector3 Minimum = Field.GetBoundingMinimum(), Maximum = Field.GetBoundingMaximum();
    float Near = 0.0f, Far = 10.0f;
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        const auto Component = [Axis](Vector3 Value) { return Axis == 0u ? Value.x : Axis == 1u ? Value.y : Value.z; };
        const float Velocity = Component(Direction), Start = Component(Origin);
        if (std::abs(Velocity) < 1.0e-10f)
        {
            if (Start < Component(Minimum) || Start > Component(Maximum)) return {};
            continue;
        }
        const float A = (Component(Minimum) - Start) / Velocity, B = (Component(Maximum) - Start) / Velocity;
        Near = std::max(Near, std::min(A, B)); Far = std::min(Far, std::max(A, B));
    }
    if (Near > Far) return {};
    float Travel = Near;
    for (uint32_t Step = 0u; Step < 512u; ++Step)
    {
        if (Travel > Far) return {};
        const float Distance = std::abs(Field.SampleDistance(Origin + Direction * Travel));
        if (Distance < 0.0003f) return {true, false, Travel};
        Travel += std::max(0.00008f, Distance * 0.7f);
    }
    return {false, true, Travel};
}
float TriangleHit(const DeformationSpace& Surface, Vector3 Origin, Vector3 Direction)
{
    float Best = 100.0f;
    for (const auto& Face : Surface.QueryTriangles())
    {
        const auto& Points = Surface.QueryVertices();
        const Vector3 A = Points[Face[0]], Edge = Points[Face[1]] - A, Other = Points[Face[2]] - A;
        const Vector3 Perpendicular = Cross(Direction, Other);
        const float Determinant = Dot(Edge, Perpendicular);
        if (std::abs(Determinant) < 1.0e-10f) continue;
        const Vector3 Relative = Origin - A, Crossed = Cross(Relative, Edge);
        const float U = Dot(Relative, Perpendicular) / Determinant, V = Dot(Direction, Crossed) / Determinant;
        const float Travel = Dot(Other, Crossed) / Determinant;
        if (U >= 0.0f && V >= 0.0f && U + V <= 1.0f && Travel > 0.0f) Best = std::min(Best, Travel);
    }
    return Best;
}
void Save(const std::filesystem::path& Path, const std::vector<Vector3>& Pixels, uint32_t Width, uint32_t Height)
{
    std::ofstream Stream(Path, std::ios::binary);
    Stream << "P6\n" << Width << " " << Height << "\n255\n";
    for (Vector3 Colour : Pixels)
        for (float Component : {Colour.x, Colour.y, Colour.z})
        {
            const auto Byte = static_cast<unsigned char>(255.0f * std::pow(std::clamp(Component, 0.0f, 1.0f), 1.0f / 2.2f));
            Stream.write(reinterpret_cast<const char*>(&Byte), 1);
        }
    Require(static_cast<bool>(Stream), "render write failed");
}
void Render(const std::filesystem::path& Folder, const std::string& Name, const DistanceFieldSpace& Field,
            float HubHeight, Vector3 GroundNormal)
{
    constexpr uint32_t Width = 1000u, Height = 800u;
    std::vector<Vector3> Pixels(Width * Height), Normals(Width * Height);
    const Vector3 Eye{1.05f, -1.65f, 0.72f}, Target{0.0f, 0.0f, -0.02f};
    const Vector3 Forward = (Target - Eye).Normalized(), Right = Cross(Forward, {0, 0, 1}).Normalized();
    const Vector3 Up = Cross(Right, Forward), Light = Vector3{-0.45f, -0.65f, 1.2f}.Normalized();
    uint64_t Hits = 0u, Exhausted = 0u;
    for (uint32_t Y = 0u; Y < Height; ++Y)
        for (uint32_t X = 0u; X < Width; ++X)
        {
            const float Horizontal = (2.0f * (X + 0.5f) / Width - 1.0f) * 0.34f * Width / Height;
            const float Vertical = (1.0f - 2.0f * (Y + 0.5f) / Height) * 0.34f;
            const Vector3 Direction = (Forward + Right * Horizontal + Up * Vertical).Normalized();
            const HitRecord Hit = March(Field, Eye, Direction);
            Exhausted += Hit.Exhausted ? 1u : 0u;
            const float GroundTravel = -(Dot(Eye, GroundNormal) + HubHeight * GroundNormal.z) / Dot(Direction, GroundNormal);
            Vector3 Colour{0.019f, 0.027f, 0.042f}, Diagnostic = Colour;
            if (Hit.Hit && (GroundTravel < 0.0f || Hit.Travel < GroundTravel))
            {
                ++Hits;
                const Vector3 Position = Eye + Direction * Hit.Travel;
                const Vector3 Normal = Field.SampleNormal(Position);
                const bool Shadow = March(Field, Position + Normal * 0.003f, Light).Hit;
                float Occlusion = 0.0f;
                for (uint32_t Sample = 1u; Sample <= 5u; ++Sample)
                {
                    const float Offset = Sample * 0.017f;
                    Occlusion += std::max(0.0f, Offset - Field.SampleDistance(Position + Normal * Offset)) / Offset / 5.0f;
                }
                const float Ambient = 0.075f * (1.0f - std::clamp(Occlusion, 0.0f, 0.9f));
                const float Diffuse = std::max(0.0f, Dot(Normal, Light)) * (Shadow ? 0.0f : 0.7f);
                const Vector3 Half = (Light - Direction).Normalized();
                const float Specular = std::pow(std::max(0.0f, Dot(Normal, Half)), 36.0f) * (Shadow ? 0.0f : 0.22f);
                const float Rim = std::pow(1.0f - std::max(0.0f, Dot(Normal, Direction * -1.0f)), 3.0f) * 0.1f;
                Colour = Vector3{0.075f, 0.085f, 0.10f} * (Ambient + Diffuse) + Vector3{1, 0.9f, 0.8f} * Specular +
                         Vector3{0.19f, 0.50f, 0.75f} * Rim;
                Diagnostic = Normal * 0.5f + Vector3{0.5f, 0.5f, 0.5f};
            }
            else if (GroundTravel > 0.0f)
            {
                const Vector3 Position = Eye + Direction * GroundTravel;
                const bool Shadow = March(Field, Position + GroundNormal * 0.004f, Light).Hit;
                const float Fade = std::exp(-0.4f * (Position.x * Position.x + Position.y * Position.y));
                Colour = Vector3{0.08f, 0.11f, 0.15f} * (0.65f + Fade * 0.65f) * (Shadow ? 0.22f : 1.0f);
            }
            if (Hit.Exhausted) Colour = {1, 0, 1};
            Pixels[Y * Width + X] = Colour;
            Normals[Y * Width + X] = Diagnostic;
        }
    Save(Folder / (Name + ".ppm"), Pixels, Width, Height);
    Save(Folder / (Name + "Normals.ppm"), Normals, Width, Height);
    std::cout << Name << " field-only primary hits " << Hits << ", exhausted " << Exhausted << "\n";
    Require(Hits > 10000u, "empty field render");

    constexpr uint32_t Size = 800u;
    Pixels.resize(Size * Size);
    for (uint32_t Y = 0u; Y < Size; ++Y)
        for (uint32_t X = 0u; X < Size; ++X)
        {
            const Vector3 Point{(static_cast<float>(X) / Size - 0.5f) * 1.3f, 0.0f,
                                (0.5f - static_cast<float>(Y) / Size) * 1.3f};
            const float Distance = Field.SampleDistance(Point);
            Vector3 Colour = Distance < 0.0f ? Vector3{0.02f, 0.34f, 0.22f} : Vector3{0.025f, 0.07f, 0.15f};
            Colour *= 0.55f + 0.45f * std::pow(0.5f + 0.5f * std::cos(Distance * 628.3185f), 10.0f);
            if (std::abs(Distance) < 0.0015f) Colour = {0.6f, 0.95f, 0.84f};
            const float Plane = Dot(Point, GroundNormal) + HubHeight * GroundNormal.z;
            if (std::abs(Plane) < 0.0015f) Colour = {0.95f, 0.35f, 0.035f};
            Pixels[Y * Size + X] = Colour;
        }
    Save(Folder / (Name + "Slice.ppm"), Pixels, Size, Size);
}
}

int main(int ArgumentCount, char** Arguments)
{
    try
    {
        if (ArgumentCount == 4)
        {
            DistanceFieldSpace Field;
            std::string Refusal;
            Require(Field.LoadFromFile(Arguments[2], &Refusal), Refusal);
            Render(Arguments[1], "ProjectDrive", Field, std::stof(Arguments[3]), {0, 0, 1});
            return 0;
        }
        Require(ArgumentCount == 2, "usage: TyreHost output-folder [live-field hub-height]");
        const std::filesystem::path Folder = Arguments[1];
        std::filesystem::create_directories(Folder);
        const Frontier::Vehicle::VehicleGeometry Geometry;
        Frontier::Vehicle::SoftTyreParameters Parameters;
        Parameters.Radius = Geometry.TyreRadius; Parameters.RimRadius = Geometry.TyreRimRadius; Parameters.Width = Geometry.TyreWidth;
        std::ofstream Metrics(Folder / "Metrics.json");
        Metrics << "{\"provenance\":\"native XPBDSoftTyre, Project Drive dimensions, CPU field-only diagnostic; not Vulkan GI\",\"cases\":[";
        for (uint32_t Case = 0u; Case < 3u; ++Case)
        {
            const std::string Name = Case == 0u ? "Rest" : Case == 1u ? "Loaded" : "Banked";
            const float HubHeight = Case == 0u ? Parameters.Radius : Parameters.Radius - 0.07f;
            const Vector3 GroundNormal = Case == 2u ? Vector3{0.0f, 0.30f, 1.0f}.Normalized() : Vector3{0, 0, 1};
            const Frontier::Vehicle::Vec3 Hub{0, 0, HubHeight};
            Frontier::Vehicle::XPBDSoftTyre Tyre;
            Tyre.Build(Parameters, Hub, {});
            if (Case != 0u)
                for (uint32_t Frame = 0u; Frame < 360u; ++Frame)
                    Tyre.Step(1.0f / 240.0f, 12u, Hub, {}, {}, [&](const auto& Point, auto& Surface, auto& Normal)
                    {
                        Normal = {GroundNormal.x, GroundNormal.y, GroundNormal.z};
                        Surface = Point - Normal * Frontier::Vehicle::Dot(Point, Normal);
                        return true;
                    });
            Frontier::Drive::TyreSequence Surface;
            Surface.Capture(Tyre, Hub, {});
            std::vector<Vector3> Vertices, RestVertices;
            std::vector<DeformationSpace::Face> Faces, RestFaces;
            Surface.Envelope(RestVertices, RestFaces, true);
            Surface.Envelope(Vertices, Faces, Case == 0u);
            float ProjectionError = 0.0f, MaximumDisplacement = 0.0f;
            for (const auto& Node : Tyre.Nodes())
            {
                const Vector3 Projected = Surface.Project({Node.TreadLocal.x, Node.TreadLocal.y, Node.TreadLocal.z});
                ProjectionError = std::max(ProjectionError, (Projected - Vector3{Node.Position.x, Node.Position.y, Node.Position.z}).Length());
                MaximumDisplacement = std::max(MaximumDisplacement, (Node.Position - Hub - Node.TreadLocal).Length());
            }
            std::cout << Name << " projection " << ProjectionError << ", deformation " << MaximumDisplacement << "\n";
            Require(ProjectionError < 1.0e-5f, "visible projection does not match solved nodes");
            DeformationSpace Field;
            std::string Refusal;
            const auto InitialStarted = std::chrono::steady_clock::now();
            Require(Field.Update(RestVertices, RestFaces, 64u, 0.06f, Refusal), Refusal);
            const uint64_t RestSignature = Field.Signature();
            const auto Started = Case == 0u ? InitialStarted : std::chrono::steady_clock::now();
            Require(Field.Update(Vertices, Faces, 64u, 0.06f, Refusal), Refusal);
            const double Milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Started).count();
            const uint64_t Revision = Field.QueryRevision(), Signature = Field.Signature();
            if (Case != 0u) Require(Revision == 2u && Signature != RestSignature, "deformation did not invalidate the rest field");
            Require(Field.Update(Vertices, Faces, 64u, 0.06f, Refusal) && Field.QueryRevision() == Revision, "unchanged input rebuilt");
            Require(!Field.Update(Vertices, Faces, 7u, 0.06f, Refusal), "invalid resolution accepted");
            auto BadIndices = Faces; BadIndices[0][0] = static_cast<uint32_t>(Vertices.size());
            Require(!Field.Update(Vertices, BadIndices, 64u, 0.06f, Refusal), "out-of-range index accepted");
            auto Invalid = Vertices; Invalid[0].x = std::numeric_limits<float>::quiet_NaN();
            Require(!Field.Update(Invalid, Faces, 64u, 0.06f, Refusal) && Field.QueryRevision() == Revision, "NaN was published");
            auto Open = Faces; Open.pop_back();
            Require(!Field.Update(Vertices, Open, 64u, 0.06f, Refusal) && Field.Signature() == Signature, "open surface was published");
            Invalid = Vertices; Invalid[Faces[0][0]] = Invalid[Faces[0][1]];
            Require(!Field.Update(Invalid, Faces, 64u, 0.06f, Refusal), "degenerate triangle accepted");
            Require(Field.QueryField().SampleDistance({0, 0, 0}) > 0.0f, "central opening filled");
            Require(Field.QueryField().SaveToFile((Folder / (Name + ".sdf")).string()), "SDF1 write failed");
            DistanceFieldSpace Loaded;
            Require(Loaded.LoadFromFile((Folder / (Name + ".sdf")).string(), &Refusal), Refusal);
            Require(Loaded.GetSampleCount() == Field.QueryField().GetSampleCount() &&
                    std::memcmp(Loaded.GetSampleData(), Field.QueryField().GetSampleData(), Loaded.GetSampleCount() * sizeof(float)) == 0,
                    "SDF1 roundtrip changed samples");
            uint32_t ReferenceHits = 0u, Missed = 0u, Extra = 0u, Exhausted = 0u;
            std::vector<float> Errors;
            for (uint32_t View = 0u; View < 3u; ++View)
                for (uint32_t Y = 0u; Y < 24u; ++Y)
                    for (uint32_t X = 0u; X < 24u; ++X)
                    {
                        const float Angle = View * 2.0943951f;
                        const Vector3 Eye{1.7f * std::sin(Angle), -1.7f * std::cos(Angle), 0.65f};
                        const Vector3 Forward = (Eye * -1.0f).Normalized(), Right = Cross(Forward, {0, 0, 1}).Normalized();
                        const Vector3 Up = Cross(Right, Forward);
                        const Vector3 Direction = (Forward + Right * ((X + 0.5f) / 24u - 0.5f) * 0.8f +
                                                  Up * (0.5f - (Y + 0.5f) / 24u) * 0.8f).Normalized();
                        const float Reference = TriangleHit(Field, Eye, Direction);
                        const HitRecord Hit = March(Field.QueryField(), Eye, Direction);
                        const bool HasReference = Reference < 10.0f;
                        ReferenceHits += HasReference; Missed += HasReference && !Hit.Hit; Extra += !HasReference && Hit.Hit;
                        Exhausted += Hit.Exhausted;
                        if (HasReference && Hit.Hit) Errors.push_back(std::abs(Reference - Hit.Travel));
                    }
            std::sort(Errors.begin(), Errors.end());
            Require(!Errors.empty(), "no paired ray hits");
            Render(Folder, Name, Field.QueryField(), HubHeight, GroundNormal);
            if (Case != 0u) Metrics << ",";
            Metrics << "{\"name\":\"" << Name << "\",\"vertices\":" << Vertices.size() << ",\"triangles\":" << Faces.size()
                    << ",\"contacts\":" << Tyre.Reaction().ContactCount << ",\"maximumDisplacementMetres\":" << MaximumDisplacement
                    << ",\"projectionErrorMetres\":" << ProjectionError << ",\"bakeMilliseconds\":" << Milliseconds
                    << ",\"signature\":\"" << Signature << "\",\"rays\":1728,\"referenceHits\":" << ReferenceHits
                    << ",\"missed\":" << Missed << ",\"extra\":" << Extra << ",\"exhausted\":" << Exhausted
                    << ",\"medianErrorMetres\":" << Errors[Errors.size() / 2u]
                    << ",\"p95ErrorMetres\":" << Errors[Errors.size() * 95u / 100u] << ",\"maxErrorMetres\":" << Errors.back() << "}";
            std::cout << Name << ": contacts " << Tyre.Reaction().ContactCount << ", displacement " << MaximumDisplacement
                      << ", build " << Milliseconds << " ms, missed " << Missed << ", extra " << Extra << "\n";
        }
        Metrics << "],\"refusalChecks\":[\"nonfinite\",\"open\",\"degenerate\",\"resolution\",\"index\"],\"unchangedAndRoundtrip\":true}\n";
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << Error.what() << "\n";
        return 1;
    }
}

//============================================================================================================================================
//                                                           SURFELINTEGRATE.WGSL                                                           //
//============================================================================================================================================
// 📦 Persistent world-space surfel integration with software hierarchy traversal and deferred Jacobi publication.

struct SurfelRecord
{
    PositionRadius: vec4f,
    NormalArea: vec4f,
    AlbedoIdentity: vec4f,
    IrradianceAge: vec4f,
};

struct GeometryVertex
{
    Position: vec4f,
    Normal: vec4f,
};

struct HierarchyNode
{
    Minimum: vec3f,
    First: u32,
    Maximum: vec3f,
    Count: u32,
};

struct IntegrationUniforms
{
    SunDirectionStep: vec4f,
    SunColourRays: vec4f,
    SkyHorizonAgeCap: vec4f,
    SkyZenithFirefly: vec4f,
    Counts: vec4f,
    FieldTuning: vec4f,
    PlacementAlpha: vec4f,
    PlacementBeta: vec4f,
    PlacementGamma: vec4f,
    PlacementDelta: vec4f,
};

struct RayHit
{
    Distance: f32,
    Normal: vec3f,
    PlacementNumber: u32,
    Valid: u32,
};

struct SurfelExtent
{
    Records: array<SurfelRecord>,
};

struct IntegerExtent
{
    Entries: array<i32>,
};

struct UnsignedExtent
{
    Entries: array<u32>,
};

struct VertexExtent
{
    Entries: array<GeometryVertex>,
};

struct HierarchyExtent
{
    Entries: array<HierarchyNode>,
};

@group(0) @binding(0) var<uniform> Integration: IntegrationUniforms;
@group(0) @binding(1) var<storage, read> SourceField: SurfelExtent;
@group(0) @binding(2) var<storage, read_write> DestinationField: SurfelExtent;
@group(0) @binding(3) var<storage, read> CellLinks: IntegerExtent;
@group(0) @binding(4) var<storage, read> GeometryVertices: VertexExtent;
@group(0) @binding(5) var<storage, read> GeometryIndices: UnsignedExtent;
@group(0) @binding(6) var<storage, read> HierarchyNodes: HierarchyExtent;

const Pi: f32 = 3.141592653589793;
const InversePi: f32 = 0.3183098861837907;
const TraceEpsilon: f32 = 0.00001;

fn HashUnsigned(Seed: u32) -> u32
{
    var Result = Seed;
    Result = Result ^ (Result >> 16u);
    Result = Result * 0x7feb352du;
    Result = Result ^ (Result >> 15u);
    Result = Result * 0x846ca68bu;
    Result = Result ^ (Result >> 16u);
    return Result;
}

fn RandomUnit(Seed: ptr<function, u32>) -> f32
{
    (*Seed) = HashUnsigned(*Seed);
    return f32((*Seed) >> 8u) * (1.0 / 16777216.0);
}

fn SkyRadiance(Direction: vec3f) -> vec3f
{
    let ZenithWeight = clamp(Direction.z * 0.5 + 0.5, 0.0, 1.0);
    return mix(Integration.SkyHorizonAgeCap.xyz, Integration.SkyZenithFirefly.xyz, ZenithWeight);
}

fn MaterialAlbedo(PlacementNumber: u32) -> vec3f
{
    if (PlacementNumber == 0u) { return vec3f(0.78, 0.18, 0.075); }
    if (PlacementNumber == 1u) { return vec3f(0.08, 0.39, 0.68); }
    if (PlacementNumber == 2u) { return vec3f(0.92, 0.55, 0.12); }
    if (PlacementNumber == 3u) { return vec3f(0.16, 0.64, 0.36); }
    return vec3f(0.48, 0.50, 0.52);
}

fn PlacementPosition(PlacementNumber: u32) -> vec3f
{
    if (PlacementNumber == 0u) { return Integration.PlacementAlpha.xyz; }
    if (PlacementNumber == 1u) { return Integration.PlacementBeta.xyz; }
    if (PlacementNumber == 2u) { return Integration.PlacementGamma.xyz; }
    return Integration.PlacementDelta.xyz;
}

fn IntersectBounds(
    Origin: vec3f,
    InverseDirection: vec3f,
    Minimum: vec3f,
    Maximum: vec3f,
    MaximumDistance: f32,
) -> bool
{
    let Alpha = (Minimum - Origin) * InverseDirection;
    let Beta = (Maximum - Origin) * InverseDirection;
    let NearVector = min(Alpha, Beta);
    let FarVector = max(Alpha, Beta);
    let NearDistance = max(max(NearVector.x, NearVector.y), NearVector.z);
    let FarDistance = min(min(FarVector.x, FarVector.y), FarVector.z);
    return FarDistance >= max(NearDistance, 0.0) && NearDistance < MaximumDistance;
}

fn IntersectTriangle(
    Origin: vec3f,
    Direction: vec3f,
    Alpha: vec3f,
    Beta: vec3f,
    Gamma: vec3f,
) -> vec3f
{
    let AlphaBeta = Beta - Alpha;
    let AlphaGamma = Gamma - Alpha;
    let DeterminantVector = cross(Direction, AlphaGamma);
    let Determinant = dot(AlphaBeta, DeterminantVector);
    if (abs(Determinant) < TraceEpsilon)
    {
        return vec3f(-1.0);
    }

    let InverseDeterminant = 1.0 / Determinant;
    let AlphaOrigin = Origin - Alpha;
    let BetaWeight = dot(AlphaOrigin, DeterminantVector) * InverseDeterminant;
    if (BetaWeight < 0.0 || BetaWeight > 1.0)
    {
        return vec3f(-1.0);
    }

    let GammaVector = cross(AlphaOrigin, AlphaBeta);
    let GammaWeight = dot(Direction, GammaVector) * InverseDeterminant;
    if (GammaWeight < 0.0 || BetaWeight + GammaWeight > 1.0)
    {
        return vec3f(-1.0);
    }

    let Distance = dot(AlphaGamma, GammaVector) * InverseDeterminant;
    return vec3f(Distance, BetaWeight, GammaWeight);
}

fn TracePlacement(
    WorldOrigin: vec3f,
    Direction: vec3f,
    PlacementNumber: u32,
    MaximumDistance: f32,
) -> RayHit
{
    let LocalOrigin = WorldOrigin - PlacementPosition(PlacementNumber);
    let InverseDirection = 1.0 / Direction;
    var Result = RayHit(MaximumDistance, vec3f(0.0, 0.0, 1.0), PlacementNumber, 0u);
    var Pending: array<u32, 64>;
    var PendingCount = 0u;
    var NodeNumber = 0u;

    loop
    {
        let ActiveNode = HierarchyNodes.Entries[NodeNumber];
        if (IntersectBounds(LocalOrigin, InverseDirection, ActiveNode.Minimum, ActiveNode.Maximum, Result.Distance))
        {
            if (ActiveNode.Count == 0u)
            {
                if (PendingCount < 64u)
                {
                    Pending[PendingCount] = ActiveNode.First + 1u;
                    PendingCount = PendingCount + 1u;
                }
                NodeNumber = ActiveNode.First;
                continue;
            }

            for (var LeafOffset = 0u; LeafOffset < ActiveNode.Count; LeafOffset = LeafOffset + 1u)
            {
                let OrderAddress = u32(Integration.Counts.z) + ActiveNode.First + LeafOffset;
                let TriangleNumber = GeometryIndices.Entries[OrderAddress];
                let IndexAddress = TriangleNumber * 3u;
                let AlphaNumber = GeometryIndices.Entries[IndexAddress];
                let BetaNumber = GeometryIndices.Entries[IndexAddress + 1u];
                let GammaNumber = GeometryIndices.Entries[IndexAddress + 2u];
                let AlphaVertex = GeometryVertices.Entries[AlphaNumber];
                let BetaVertex = GeometryVertices.Entries[BetaNumber];
                let GammaVertex = GeometryVertices.Entries[GammaNumber];
                let Intersection = IntersectTriangle(
                    LocalOrigin,
                    Direction,
                    AlphaVertex.Position.xyz,
                    BetaVertex.Position.xyz,
                    GammaVertex.Position.xyz,
                );
                if (Intersection.x > TraceEpsilon && Intersection.x < Result.Distance)
                {
                    let AlphaWeight = 1.0 - Intersection.y - Intersection.z;
                    var SurfaceNormal = normalize(
                        AlphaVertex.Normal.xyz * AlphaWeight
                        + BetaVertex.Normal.xyz * Intersection.y
                        + GammaVertex.Normal.xyz * Intersection.z
                    );
                    if (dot(SurfaceNormal, Direction) > 0.0)
                    {
                        SurfaceNormal = -SurfaceNormal;
                    }
                    Result = RayHit(Intersection.x, SurfaceNormal, PlacementNumber, 1u);
                }
            }
        }

        if (PendingCount == 0u)
        {
            break;
        }
        PendingCount = PendingCount - 1u;
        NodeNumber = Pending[PendingCount];
    }
    return Result;
}

fn TraceScene(Origin: vec3f, Direction: vec3f, MaximumDistance: f32) -> RayHit
{
    var Result = RayHit(MaximumDistance, vec3f(0.0, 0.0, 1.0), 4u, 0u);
    if (Direction.z < -TraceEpsilon)
    {
        let GroundDistance = (-0.02 - Origin.z) / Direction.z;
        let GroundPoint = Origin + Direction * GroundDistance;
        if (
            GroundDistance > TraceEpsilon
            && GroundDistance < Result.Distance
            && abs(GroundPoint.x) < 3.8
            && abs(GroundPoint.y) < 3.25
        )
        {
            Result = RayHit(GroundDistance, vec3f(0.0, 0.0, 1.0), 4u, 1u);
        }
    }

    for (var PlacementNumber = 0u; PlacementNumber < 4u; PlacementNumber = PlacementNumber + 1u)
    {
        let PlacementHit = TracePlacement(Origin, Direction, PlacementNumber, Result.Distance);
        if (PlacementHit.Valid != 0u && PlacementHit.Distance < Result.Distance)
        {
            Result = PlacementHit;
        }
    }
    return Result;
}

fn CellHash(Cell: vec3i) -> u32
{
    let Shifted = vec3u(Cell + vec3i(2048));
    let Mixed = (Shifted.x * 73856093u)
              ^ (Shifted.y * 19349663u)
              ^ (Shifted.z * 83492791u);
    return Mixed % max(u32(Integration.Counts.y), 1u);
}

fn GatherIrradiance(Position: vec3f, Normal: vec3f) -> vec3f
{
    let CellSize = Integration.FieldTuning.x;
    let Cell = vec3i(floor(Position / CellSize));
    let HashCount = i32(Integration.Counts.y);
    var Irradiance = vec3f(0.0);
    var WeightSum = 0.0;

    for (var OffsetZ = -1; OffsetZ <= 1; OffsetZ = OffsetZ + 1)
    {
        for (var OffsetY = -1; OffsetY <= 1; OffsetY = OffsetY + 1)
        {
            for (var OffsetX = -1; OffsetX <= 1; OffsetX = OffsetX + 1)
            {
                let CellNumber = i32(CellHash(Cell + vec3i(OffsetX, OffsetY, OffsetZ)));
                var RecordNumber = CellLinks.Entries[CellNumber] - 1;
                var Guard = 0;
                while (RecordNumber >= 0 && Guard < 96)
                {
                    let Record = SourceField.Records[RecordNumber];
                    let Delta = Position - Record.PositionRadius.xyz;
                    let Distance = length(Delta);
                    let Radius = Record.PositionRadius.w;
                    let NormalWeight = dot(Normal, Record.NormalArea.xyz);
                    let PlanarDistance = abs(dot(Delta, Record.NormalArea.xyz));
                    if (Distance < Radius && NormalWeight > 0.15 && PlanarDistance < Radius * 0.38)
                    {
                        let LinearWeight = 1.0 - Distance / Radius;
                        let Weight = NormalWeight * LinearWeight * LinearWeight;
                        Irradiance = Irradiance + Record.IrradianceAge.xyz * Weight;
                        WeightSum = WeightSum + Weight;
                    }
                    RecordNumber = CellLinks.Entries[HashCount + RecordNumber] - 1;
                    Guard = Guard + 1;
                }
            }
        }
    }
    return select(vec3f(0.0), Irradiance / WeightSum, WeightSum > 0.00001);
}

fn CosineDirection(Normal: vec3f, Seed: ptr<function, u32>) -> vec3f
{
    let First = RandomUnit(Seed);
    let Second = RandomUnit(Seed);
    let Radius = sqrt(First);
    let Angle = 2.0 * Pi * Second;
    let Reference = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(Normal.z) < 0.9);
    let Tangent = normalize(cross(Reference, Normal));
    let Bitangent = cross(Normal, Tangent);
    return normalize(
        Tangent * (Radius * cos(Angle))
        + Bitangent * (Radius * sin(Angle))
        + Normal * sqrt(max(0.0, 1.0 - First))
    );
}

@compute @workgroup_size(64)
fn IntegrateMain(@builtin(global_invocation_id) Invocation: vec3u)
{
    let RecordNumber = Invocation.x;
    if (RecordNumber >= u32(Integration.Counts.x))
    {
        return;
    }

    let Record = SourceField.Records[RecordNumber];
    let Normal = normalize(Record.NormalArea.xyz);
    var Seed = HashUnsigned(
        RecordNumber * 2246822519u
        ^ u32(Integration.SunDirectionStep.w) * 3266489917u
    );
    let RayCount = max(1u, u32(Integration.SunColourRays.w));
    var Measurement = vec3f(0.0);

    for (var RayNumber = 0u; RayNumber < 4u; RayNumber = RayNumber + 1u)
    {
        if (RayNumber >= RayCount)
        {
            break;
        }
        let Direction = CosineDirection(Normal, &Seed);
        let Origin = Record.PositionRadius.xyz + Normal * 0.004;
        let SurfaceHit = TraceScene(Origin, Direction, 1000.0);
        if (SurfaceHit.Valid == 0u)
        {
            Measurement = Measurement + SkyRadiance(Direction);
            continue;
        }

        let HitPosition = Origin + Direction * SurfaceHit.Distance;
        let SourceNormal = SurfaceHit.Normal;
        let SunFacing = max(dot(SourceNormal, Integration.SunDirectionStep.xyz), 0.0);
        var SunVisibility = 1.0;
        if (SunFacing > 0.0)
        {
            let ShadowHit = TraceScene(
                HitPosition + SourceNormal * 0.006,
                Integration.SunDirectionStep.xyz,
                1000.0,
            );
            if (ShadowHit.Valid != 0u)
            {
                SunVisibility = 0.0;
            }
        }

        let DirectIrradiance = Integration.SunColourRays.xyz * (SunFacing * SunVisibility);
        let PreviousIrradiance = GatherIrradiance(HitPosition, SourceNormal);
        let SourceAlbedo = MaterialAlbedo(SurfaceHit.PlacementNumber);
        var Incoming = SourceAlbedo * InversePi * (DirectIrradiance + PreviousIrradiance);
        let Peak = max(Incoming.x, max(Incoming.y, Incoming.z));
        let FireflyLimit = Integration.SkyZenithFirefly.w;
        if (Peak > FireflyLimit)
        {
            Incoming = Incoming * (FireflyLimit / Peak);
        }
        Measurement = Measurement + Incoming;
    }

    Measurement = Measurement * (Pi / f32(RayCount));
    let Age = max(1.0, Integration.SunDirectionStep.w);
    let IntegrationWeight = 1.0 / min(Age, Integration.SkyHorizonAgeCap.w);
    let Published = mix(Record.IrradianceAge.xyz, Measurement, IntegrationWeight);
    DestinationField.Records[RecordNumber].PositionRadius = Record.PositionRadius;
    DestinationField.Records[RecordNumber].NormalArea = Record.NormalArea;
    DestinationField.Records[RecordNumber].AlbedoIdentity = Record.AlbedoIdentity;
    DestinationField.Records[RecordNumber].IrradianceAge = vec4f(Published, Age);
}

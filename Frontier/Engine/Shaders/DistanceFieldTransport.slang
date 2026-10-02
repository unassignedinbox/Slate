//============================================================================================================================================
//                                                     DISTANCEFIELDTRANSPORT.SLANG
//============================================================================================================================================
// 📦 Shared std430 scene/clipmap records, continuous distance sampling and exact secondary triangle traversal.

#ifndef FRONTIER_DISTANCE_TRANSPORT
#define FRONTIER_DISTANCE_TRANSPORT
struct DistanceFacet { vec4 Alpha; vec4 Beta; vec4 Gamma; vec4 Normal; vec4 Albedo; vec4 Emission; };
struct DistanceBranch { vec4 Minimum; vec4 Maximum; uvec4 Range; };
struct DistanceVoxel { vec4 PositionDistance; vec4 Normal; vec4 Albedo; vec4 Emission; };
layout(std430, binding=3) buffer FieldExtent { DistanceVoxel Field[]; };
layout(std430, binding=4) readonly buffer PreviousRadianceExtent { vec4 PreviousRadiance[]; };
layout(std430, binding=5) readonly buffer DistanceConstants { vec4 ClipOrigins[3]; uvec4 GeometryCounts; };
layout(std430, binding=6) readonly buffer DistanceBranches { DistanceBranch Branches[]; };
layout(std430, binding=7) readonly buffer DistanceFacets { DistanceFacet Facets[]; };
layout(std430, binding=10) buffer NextRadianceExtent { vec4 NextRadiance[]; };
layout(push_constant) uniform DistancePush
{
    vec4 SunDirectionRadiance;
    vec4 SunColour;
    vec4 SkyAmbient;
    vec4 Tuning;
    vec4 CameraEye;
    uvec4 Counts;
} PC;

uint VolumeCount() { return GeometryCounts.x * GeometryCounts.x * GeometryCounts.x; }
uint CellIndex(uvec3 Cell, uint Level)
{
    return Level * VolumeCount() + (Cell.z * GeometryCounts.x + Cell.y) * GeometryCounts.x + Cell.x;
}
vec3 CellPosition(uint Index)
{
    uint Level = Index / VolumeCount();
    uint Local = Index % VolumeCount();
    uvec3 Cell = uvec3(Local % GeometryCounts.x, (Local / GeometryCounts.x) % GeometryCounts.x, Local / (GeometryCounts.x * GeometryCounts.x));
    return ClipOrigins[Level].xyz + (vec3(Cell) + 0.5) * ClipOrigins[Level].w;
}
int SelectClip(vec3 Position, out vec3 Coordinate)
{
    for (int Level = 0; Level < 3; ++Level)
    {
        Coordinate = (Position - ClipOrigins[Level].xyz) / ClipOrigins[Level].w - 0.5;
        if (all(greaterThanEqual(Coordinate, vec3(0.0))) && all(lessThan(Coordinate, vec3(GeometryCounts.x - 1u)))) return Level;
    }
    return -1;
}
float SampleSceneDistance(vec3 Position, out float Cell)
{
    vec3 Coordinate;
    int Level = SelectClip(Position, Coordinate);
    if (Level < 0) { Cell = ClipOrigins[2].w; return 1e20; }
    Cell = ClipOrigins[Level].w;
    uvec3 Base = uvec3(floor(Coordinate));
    vec3 Fraction = fract(Coordinate);
    float Distance = 0.0;
    for (uint Corner = 0u; Corner < 8u; ++Corner)
    {
        uvec3 Offset = uvec3(Corner & 1u, (Corner >> 1u) & 1u, (Corner >> 2u) & 1u);
        vec3 Weight = mix(vec3(1.0) - Fraction, Fraction, vec3(Offset));
        Distance += Field[CellIndex(Base + Offset, uint(Level))].PositionDistance.w * Weight.x * Weight.y * Weight.z;
    }
    return abs(Distance);
}
vec3 SampleCachedRadiance(vec3 Position, bool Current)
{
    vec3 Coordinate;
    int Level = SelectClip(Position, Coordinate);
    if (Level < 0) return vec3(0.0);
    uint Index = CellIndex(uvec3(clamp(round(Coordinate), vec3(0.0), vec3(GeometryCounts.x-1u))), uint(Level));
    return Current ? NextRadiance[Index].xyz : PreviousRadiance[Index].xyz;
}
float BoxDistanceSquared(vec3 Position, vec3 Minimum, vec3 Maximum)
{
    vec3 Delta = max(max(Minimum - Position, Position - Maximum), vec3(0.0));
    return dot(Delta, Delta);
}
vec3 ClosestOnTriangle(vec3 Position, DistanceFacet Facet)
{
    vec3 Alpha=Facet.Alpha.xyz, Beta=Facet.Beta.xyz, Gamma=Facet.Gamma.xyz;
    vec3 EdgeAlpha=Beta-Alpha, EdgeBeta=Gamma-Alpha, Delta=Position-Alpha;
    float D1=dot(EdgeAlpha,Delta), D2=dot(EdgeBeta,Delta);
    if (D1<=0.0 && D2<=0.0) return Alpha;
    Delta=Position-Beta;
    float D3=dot(EdgeAlpha,Delta), D4=dot(EdgeBeta,Delta);
    if (D3>=0.0 && D4<=D3) return Beta;
    float AreaGamma=D1*D4-D3*D2;
    if (AreaGamma<=0.0 && D1>=0.0 && D3<=0.0) return Alpha+EdgeAlpha*(D1/(D1-D3));
    Delta=Position-Gamma;
    float D5=dot(EdgeAlpha,Delta), D6=dot(EdgeBeta,Delta);
    if (D6>=0.0 && D5<=D6) return Gamma;
    float AreaBeta=D5*D2-D1*D6;
    if (AreaBeta<=0.0 && D2>=0.0 && D6<=0.0) return Alpha+EdgeBeta*(D2/(D2-D6));
    float AreaAlpha=D3*D6-D5*D4;
    if (AreaAlpha<=0.0 && D4-D3>=0.0 && D5-D6>=0.0) return Beta+(Gamma-Beta)*((D4-D3)/((D4-D3)+(D5-D6)));
    return Alpha+(EdgeAlpha*AreaBeta+EdgeBeta*AreaGamma)/(AreaAlpha+AreaBeta+AreaGamma);
}
struct DistanceRayHit { float Travel; uint Facet; };
DistanceRayHit TraceDistanceMesh(vec3 Origin, vec3 Direction, float Maximum)
{
    DistanceRayHit Hit; Hit.Travel=Maximum; Hit.Facet=0xFFFFFFFFu;
    vec3 Reciprocal=1.0/(sign(Direction)*max(abs(Direction),vec3(1e-20))+vec3(equal(Direction,vec3(0.0)))*1e-20);
    uint Branch=0u;
    while (Branch<GeometryCounts.y)
    {
        DistanceBranch Entry=Branches[Branch];
        vec3 Near=(Entry.Minimum.xyz-Origin)*Reciprocal, Far=(Entry.Maximum.xyz-Origin)*Reciprocal;
        vec3 Lower=min(Near,Far), Upper=max(Near,Far);
        if (max(max(Lower.x,Lower.y),max(Lower.z,0.0)) > min(min(Upper.x,Upper.y),min(Upper.z,Hit.Travel)))
        { Branch=Entry.Range.x; continue; }
        for (uint Index=0u; Index<Entry.Range.z; ++Index)
        {
            uint Slot=Entry.Range.y+Index;
            DistanceFacet Triangle=Facets[Slot];
            vec3 EdgeAlpha=Triangle.Beta.xyz-Triangle.Alpha.xyz, EdgeBeta=Triangle.Gamma.xyz-Triangle.Alpha.xyz;
            vec3 Cross=cross(Direction,EdgeBeta);
            float Determinant=dot(EdgeAlpha,Cross);
            if (abs(Determinant)<1e-10) continue;
            vec3 Delta=Origin-Triangle.Alpha.xyz;
            float Beta=dot(Delta,Cross)/Determinant;
            vec3 Second=cross(Delta,EdgeAlpha);
            float Gamma=dot(Direction,Second)/Determinant, Travel=dot(EdgeBeta,Second)/Determinant;
            if (Beta>=0.0 && Gamma>=0.0 && Beta+Gamma<=1.0 && Travel>1e-4 && Travel<Hit.Travel)
            { Hit.Travel=Travel; Hit.Facet=Slot; }
        }
        ++Branch;
    }
    return Hit;
}
float DistanceShadow(vec3 Position, vec3 Normal)
{
    vec3 Direction=normalize(PC.SunDirectionRadiance.xyz);
    float Cell; SampleSceneDistance(Position,Cell);
    vec3 Origin=Position+Normal*max(Cell*1.5,0.002);
    float Visibility=1.0, Travel=Cell;
    for (uint Step=0u; Step<64u; ++Step)
    {
        float Distance=SampleSceneDistance(Origin+Direction*Travel,Cell);
        if (Distance>1e19) break;
        if (Distance<Cell*0.25) return 0.0;
        Visibility=min(Visibility,Distance/(max(PC.Tuning.x,0.01)*max(Travel,0.001)));
        Travel+=max(Distance*0.75,Cell*0.25);
    }
    return clamp(Visibility,0.0,1.0);
}
vec3 HemisphereDirection(vec3 Normal, uint Sample, uint Frame)
{
    float Height=(float(Sample)+0.5)/4.0;
    float Angle=6.28318530718*fract(float(Sample)*0.61803398875+float(Frame%16u)*0.38196601125);
    vec3 Tangent=normalize(abs(Normal.z)<0.9 ? cross(Normal,vec3(0,0,1)) : cross(Normal,vec3(0,1,0)));
    return Tangent*(cos(Angle)*sqrt(1.0-Height))+cross(Normal,Tangent)*(sin(Angle)*sqrt(1.0-Height))+Normal*sqrt(Height);
}
vec3 GatherDistanceRadiance(vec3 Position, vec3 Normal, bool Current)
{
    float Cell; SampleSceneDistance(Position,Cell);
    vec3 Origin=Position+Normal*max(Cell*1.5,0.002), Result=vec3(0.0);
    for (uint Sample=0u; Sample<4u; ++Sample)
    {
        vec3 Direction=HemisphereDirection(Normal,Sample,Current ? 0u : PC.Counts.y);
        float Travel=Cell;
        vec3 Incoming=PC.SkyAmbient.xyz;
        for (uint Step=0u; Step<48u; ++Step)
        {
            vec3 Point=Origin+Direction*Travel;
            float Distance=SampleSceneDistance(Point,Cell);
            if (Distance>1e19) break;
            if (Distance<Cell*0.7)
            {
                // 📝 Exact triangle refinement avoids shading a voxel boundary as a surface.
                DistanceRayHit Hit=TraceDistanceMesh(Origin,Direction,Travel+Cell*2.0);
                if (Hit.Facet!=0xFFFFFFFFu)
                {
                    Incoming=SampleCachedRadiance(Origin+Direction*Hit.Travel,Current);
                    break;
                }
            }
            Travel+=max(Distance*0.75,Cell*0.5);
        }
        Result+=Incoming*0.25;
    }
    return Result;
}
#endif

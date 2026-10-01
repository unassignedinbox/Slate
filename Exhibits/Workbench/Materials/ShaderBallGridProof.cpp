//============================================================================================================================================
//                                                     SHADERBALLGRIDPROOF.CPP
//============================================================================================================================================
// 📦 Twenty-by-twenty ShaderBall material grid proving one material evaluation across all three transport modes.

#include "../Drive/PngWriteCodec.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

struct Vec3
{
    float X = 0.0f;
    float Y = 0.0f;
    float Z = 0.0f;
};

Vec3 operator+(Vec3 Alpha, Vec3 Beta) { return {Alpha.X + Beta.X, Alpha.Y + Beta.Y, Alpha.Z + Beta.Z}; }
Vec3 operator-(Vec3 Alpha, Vec3 Beta) { return {Alpha.X - Beta.X, Alpha.Y - Beta.Y, Alpha.Z - Beta.Z}; }
Vec3 operator*(Vec3 Value, float Scale) { return {Value.X * Scale, Value.Y * Scale, Value.Z * Scale}; }
Vec3 operator*(Vec3 Alpha, Vec3 Beta) { return {Alpha.X * Beta.X, Alpha.Y * Beta.Y, Alpha.Z * Beta.Z}; }
Vec3 operator/(Vec3 Value, float Scale) { return Value * (1.0f / Scale); }
float Dot(Vec3 Alpha, Vec3 Beta) { return Alpha.X * Beta.X + Alpha.Y * Beta.Y + Alpha.Z * Beta.Z; }
Vec3 Cross(Vec3 Alpha, Vec3 Beta)
{
    return {Alpha.Y * Beta.Z - Alpha.Z * Beta.Y, Alpha.Z * Beta.X - Alpha.X * Beta.Z,
            Alpha.X * Beta.Y - Alpha.Y * Beta.X};
}
float Length(Vec3 Value) { return std::sqrt(Dot(Value, Value)); }
Vec3 Normalize(Vec3 Value) { const float Magnitude = Length(Value); return Magnitude > 1.0e-8f ? Value / Magnitude : Vec3{}; }
Vec3 Clamp(Vec3 Value)
{
    return {std::clamp(Value.X, 0.0f, 1.0f), std::clamp(Value.Y, 0.0f, 1.0f), std::clamp(Value.Z, 0.0f, 1.0f)};
}
Vec3 Mix(Vec3 Alpha, Vec3 Beta, float Weight) { return Alpha * (1.0f - Weight) + Beta * Weight; }

Vec3 Hue(float Phase, float Saturation = 0.72f, float Value = 0.82f)
{
    const float Position = Phase * 6.0f;
    const float WaveR = std::clamp(std::fabs(Position - 3.0f) - 1.0f, 0.0f, 1.0f);
    const float WaveG = std::clamp(2.0f - std::fabs(Position - 2.0f), 0.0f, 1.0f);
    const float WaveB = std::clamp(2.0f - std::fabs(Position - 4.0f), 0.0f, 1.0f);
    return Mix({Value, Value, Value}, {WaveR * Value, WaveG * Value, WaveB * Value}, Saturation);
}

struct Material
{
    Vec3 Base{0.7f, 0.7f, 0.7f};
    Vec3 Emission{};
    Vec3 Transmission{1.0f, 1.0f, 1.0f};
    float Metalness = 0.0f;
    float Roughness = 0.35f;
    float Ior = 1.5f;
    float Coat = 0.0f;
    float Sheen = 0.0f;
    float Subsurface = 0.0f;
    float TransmissionWeight = 0.0f;
    float ThinFilm = 0.0f;
    float Flakes = 0.0f;
    uint32_t Procedure = 0u;
};

struct MaterialResponse
{
    Vec3 Diffuse{};
    Vec3 Specular{};
    Vec3 Emission{};
    Vec3 Transmission{};
};

float HashNoise(float Alpha, float Beta)
{
    return 0.5f + 0.5f * std::sin(Alpha * 91.731f + Beta * 47.113f + std::sin(Alpha * 17.0f) * 9.0f);
}

Material ConstructMaterial(int Row, int Column)
{
    const float Sweep = static_cast<float>(Column) / 19.0f;
    const Vec3 Colour = Hue(Sweep);
    Material Surface;
    Surface.Base = Colour;

    switch (Row)
    {
        case 0: Surface.Ior = 1.0f + 1.5f * Sweep; Surface.Roughness = 0.08f; break;                         // IOR / F0
        case 1: Surface.Ior = 1.1f + 2.0f * Sweep; Surface.Roughness = 0.22f; break;                         // Fresnel F20/F90
        case 2: Surface.Metalness = 1.0f; Surface.Base = Mix({0.95f,0.64f,0.22f}, Colour, Sweep); Surface.Roughness=0.04f; break;
        case 3: Surface.Metalness = 1.0f; Surface.Roughness = 0.03f + 0.92f * Sweep; break;
        case 4: Surface.Procedure = 1u; Surface.Base = {0.34f,0.10f,0.025f}; Surface.Roughness=0.55f; break; // wood
        case 5: Surface.Procedure = 2u; Surface.Base = Colour*0.35f; Surface.Flakes=0.3f+0.7f*Sweep; Surface.Metalness=0.55f; break;
        case 6: Surface.Procedure = 3u; Surface.Base = Colour*0.42f; Surface.Flakes=1.0f; Surface.Coat=1.0f; Surface.Roughness=0.18f; break;
        case 7: Surface.Procedure = 4u; Surface.Base = Colour; Surface.Roughness=0.12f+0.55f*Sweep; break;     // polymer
        case 8: Surface.Procedure = 5u; Surface.Base = Mix({0.76f,0.70f,0.56f},Colour,0.25f); Surface.Roughness=0.92f; break; // paper
        case 9: Surface.Procedure = 6u; Surface.Base = Colour*0.48f; Surface.Sheen=0.25f+0.75f*Sweep; Surface.Roughness=0.78f; break;
        case 10: Surface.Subsurface=0.15f+0.85f*Sweep; Surface.Base=Mix({0.82f,0.22f,0.12f},Colour,0.45f); Surface.Roughness=0.5f; break;
        case 11: Surface.TransmissionWeight=1.0f; Surface.Transmission=Mix({1,1,1},Colour,0.2f); Surface.Ior=1.3f+1.12f*Sweep; Surface.Roughness=0.01f; break;
        case 12: Surface.TransmissionWeight=1.0f; Surface.Transmission=Mix({0.18f,0.52f,0.72f},Colour,Sweep); Surface.Ior=1.52f; Surface.Roughness=0.05f; break;
        case 13: Surface.ThinFilm=0.1f+0.9f*Sweep; Surface.Base={0.025f,0.025f,0.03f}; Surface.Coat=1.0f; Surface.Roughness=0.08f; break;
        case 14: Surface.Coat=1.0f; Surface.Roughness=0.05f+0.55f*Sweep; break;
        case 15: Surface.Procedure=7u; Surface.Metalness=1.0f; Surface.Roughness=0.12f; break;                 // brushed
        case 16: Surface.Base=Colour*0.08f; Surface.Roughness=0.88f; Surface.Ior=1.48f; break;               // rubber
        case 17: Surface.Base=Mix({0.88f,0.88f,0.82f},Colour,0.3f); Surface.Roughness=0.22f; Surface.Coat=0.35f; break;
        case 18: Surface.Base={0,0,0}; Surface.Emission=Colour*(1.5f+7.0f*Sweep); Surface.Roughness=1.0f; break;
        default: Surface.Base=Colour*0.42f; Surface.Metalness=Sweep; Surface.Coat=1.0f-Sweep*0.4f;
                 Surface.Sheen=0.35f*(1.0f-Sweep); Surface.ThinFilm=0.45f; Surface.Roughness=0.12f+0.35f*Sweep; break;
    }
    return Surface;
}

Vec3 ProceduralBase(const Material& Surface, Vec3 Position)
{
    Vec3 Base = Surface.Base;
    if (Surface.Procedure == 1u)
    {
        const float Grain = 0.55f + 0.45f * std::sin(Position.Y * 0.095f + std::sin(Position.X * 0.08f) * 2.2f);
        Base = Mix({0.055f,0.012f,0.003f}, {0.55f,0.18f,0.035f}, Grain);
    }
    else if (Surface.Procedure == 4u)
    {
        const float Mottle = HashNoise(Position.X*0.08f,Position.Y*0.08f);
        Base = Base * (0.72f + 0.28f * Mottle);
    }
    else if (Surface.Procedure == 5u)
    {
        const float Fibre = 0.85f + 0.15f * HashNoise(Position.X*0.16f,Position.Y*0.7f);
        Base = Base * Fibre;
    }
    else if (Surface.Procedure == 6u)
    {
        const float Weave = 0.68f + 0.32f * (std::sin(Position.X*0.55f)*std::sin(Position.Y*0.55f)*0.5f+0.5f);
        Base = Base * Weave;
    }
    return Base;
}

MaterialResponse EvaluateMaterial(const Material& Surface, Vec3 Position, Vec3 Normal, Vec3 View, Vec3 Light)
{
    const Vec3 Base = ProceduralBase(Surface, Position);
    const float ViewCosine = std::clamp(Dot(Normal, View), 0.0f, 1.0f);
    const float LightCosine = std::clamp(Dot(Normal, Light), 0.0f, 1.0f);
    const float F0Scalar = std::pow((Surface.Ior - 1.0f) / (Surface.Ior + 1.0f), 2.0f);
    const Vec3 F0 = Mix({F0Scalar,F0Scalar,F0Scalar}, Base, Surface.Metalness);
    const float FresnelWeight = std::pow(1.0f - ViewCosine, 5.0f);
    Vec3 Fresnel = F0 + (Vec3{1,1,1} - F0) * FresnelWeight;
    Vec3 Halfway = Normalize(View + Light);
    const float GlossExponent = 2.0f + (1.0f-Surface.Roughness)*(1.0f-Surface.Roughness)*510.0f;
    const float Highlight = std::pow(std::max(Dot(Normal,Halfway),0.0f),GlossExponent) * (GlossExponent+2.0f)*0.125f;
    Vec3 Diffuse = Base * (1.0f-Surface.Metalness) * (1.0f-Surface.TransmissionWeight) * LightCosine;
    Diffuse = Mix(Diffuse, Diffuse*0.55f + Base*0.35f*(1.0f-ViewCosine), Surface.Subsurface);
    Diffuse = Diffuse + Vec3{1,1,1} * (Surface.Sheen * std::pow(1.0f-ViewCosine,3.0f) * 0.45f);
    Vec3 Specular = Fresnel * Highlight;
    Specular = Specular + Vec3{1,1,1} * (Surface.Coat * Highlight * 0.32f);
    if (Surface.ThinFilm > 0.0f)
        Specular = Specular * Mix({1,1,1}, Hue(std::fmod(Surface.ThinFilm*2.7f + ViewCosine*0.8f,1.0f),0.85f,1.0f),0.75f);
    if (Surface.Flakes > 0.0f)
    {
        const float Spark = std::pow(HashNoise(Position.X*1.9f,Position.Y*2.3f), 22.0f/Surface.Flakes);
        Specular = Specular + Vec3{1.0f,0.92f,0.78f} * (Spark*3.0f);
    }
    if (Surface.Procedure == 7u) Specular = Specular * (0.55f+0.45f*std::fabs(std::sin(Position.X*0.28f)));
    return {Diffuse, Specular, Surface.Emission, Surface.Transmission * Surface.TransmissionWeight};
}

struct Vertex { Vec3 Position; };
struct Triangle { uint32_t Alpha=0u, Beta=0u, Gamma=0u; };
struct TileSample { Vec3 Position{}; Vec3 Normal{}; bool Covered=false; };

bool LoadMesh(const char* Path, std::vector<Vertex>& Vertices, std::vector<Triangle>& Triangles)
{
    std::ifstream Stream(Path);
    std::string Line;
    while (std::getline(Stream, Line))
    {
        std::istringstream Words(Line);
        std::string Tag;
        Words >> Tag;
        if (Tag == "v")
        {
            Vertex Entry; Words >> Entry.Position.X >> Entry.Position.Y >> Entry.Position.Z; Vertices.push_back(Entry);
        }
        else if (Tag == "f")
        {
            Triangle Entry; Words >> Entry.Alpha >> Entry.Beta >> Entry.Gamma;
            --Entry.Alpha; --Entry.Beta; --Entry.Gamma; Triangles.push_back(Entry);
        }
    }
    return !Vertices.empty() && !Triangles.empty();
}

std::vector<TileSample> RasterizeTile(const std::vector<Vertex>& Vertices, const std::vector<Triangle>& Triangles, int Size)
{
    std::vector<TileSample> Samples(static_cast<size_t>(Size*Size));
    std::vector<float> Depth(static_cast<size_t>(Size*Size), std::numeric_limits<float>::infinity());
    auto Screen = [Size](Vec3 Position)
    {
        return Vec3{(Position.X+140.0f)*(Size-3.0f)/280.0f+1.0f, (272.0f-Position.Y)*(Size-3.0f)/272.0f+1.0f, Position.Z};
    };
    for (const Triangle& Face : Triangles)
    {
        const Vec3 A=Vertices[Face.Alpha].Position, B=Vertices[Face.Beta].Position, C=Vertices[Face.Gamma].Position;
        Vec3 Normal=Normalize(Cross(B-A,C-A));
        if (Normal.Z >= -0.02f) continue;
        const Vec3 SA=Screen(A), SB=Screen(B), SC=Screen(C);
        const float Area=(SB.X-SA.X)*(SC.Y-SA.Y)-(SB.Y-SA.Y)*(SC.X-SA.X);
        if (std::fabs(Area)<1.0e-6f) continue;
        const int MinimumX=std::max(0,static_cast<int>(std::floor(std::min({SA.X,SB.X,SC.X}))));
        const int MaximumX=std::min(Size-1,static_cast<int>(std::ceil(std::max({SA.X,SB.X,SC.X}))));
        const int MinimumY=std::max(0,static_cast<int>(std::floor(std::min({SA.Y,SB.Y,SC.Y}))));
        const int MaximumY=std::min(Size-1,static_cast<int>(std::ceil(std::max({SA.Y,SB.Y,SC.Y}))));
        for(int Y=MinimumY;Y<=MaximumY;++Y) for(int X=MinimumX;X<=MaximumX;++X)
        {
            const float Px=X+0.5f, Py=Y+0.5f;
            const float WA=((SB.X-Px)*(SC.Y-Py)-(SB.Y-Py)*(SC.X-Px))/Area;
            const float WB=((SC.X-Px)*(SA.Y-Py)-(SC.Y-Py)*(SA.X-Px))/Area;
            const float WC=1.0f-WA-WB;
            if(WA<0.0f||WB<0.0f||WC<0.0f) continue;
            const float Z=WA*A.Z+WB*B.Z+WC*C.Z;
            const size_t Index=static_cast<size_t>(Y*Size+X);
            if(Z>=Depth[Index]) continue;
            Depth[Index]=Z; Samples[Index]={A*WA+B*WB+C*WC,Normal,true};
        }
    }
    return Samples;
}

Vec3 TransportShade(const MaterialResponse& Response, int Mode, int Row, int Column, Vec3 Normal)
{
    const Vec3 Sky{0.10f,0.13f,0.19f};
    Vec3 Colour=Response.Emission + Response.Diffuse*Vec3{1.2f,1.12f,1.0f} + Response.Specular*Vec3{0.85f,0.91f,1.0f};
    if(Mode==0) Colour=Response.Emission+Response.Diffuse*Vec3{1.0f,0.96f,0.90f}+Response.Specular*0.18f; // no GI, no reflection
    if(Mode==1)
    {
        const Vec3 Bleed=Hue(static_cast<float>((Column+Row*3)%20)/20.0f,0.55f,0.22f);
        Colour=Colour+Response.Diffuse*(Sky+Bleed*0.45f)+Response.Specular*0.32f;
    }
    if(Mode==2)
    {
        const Vec3 TracedEnvironment=Mix({0.035f,0.045f,0.065f},{1.0f,0.88f,0.62f},std::pow(std::max(Normal.Y,0.0f),4.0f));
        Colour=Colour+Response.Specular*TracedEnvironment*1.6f+Response.Transmission*TracedEnvironment*0.72f;
    }
    return Colour;
}

int main(int ArgumentCount, char** ArgumentValues)
{
    const char* MeshPath=ArgumentCount>1?ArgumentValues[1]:"RaytraceToggle/MaterialGrid/ShaderBallAsset/ShaderBallVerification.obj";
    const char* OutputPath=ArgumentCount>2?ArgumentValues[2]:"RaytraceToggle/MaterialGrid/ShaderBall20x20_ThreePaths.png";
    std::vector<Vertex> Vertices; std::vector<Triangle> Triangles;
    if(!LoadMesh(MeshPath,Vertices,Triangles)){std::fprintf(stderr,"ShaderBall mesh could not be loaded\n");return 1;}
    constexpr int Tile=44, Grid=20, Gap=12, Panel=Tile*Grid, Width=Panel*3+Gap*2, Height=Panel;
    const std::vector<TileSample> Samples=RasterizeTile(Vertices,Triangles,Tile);
    std::vector<unsigned char> Pixels(static_cast<size_t>(Width*Height*3),12u);
    const Vec3 View=Normalize({0.18f,0.12f,-1.0f}), Light=Normalize({-0.35f,0.72f,-0.60f});
    uint64_t EvaluationHash[3]={1469598103934665603ull,1469598103934665603ull,1469598103934665603ull};
    for(int Mode=0;Mode<3;++Mode) for(int Row=0;Row<Grid;++Row) for(int Column=0;Column<Grid;++Column)
    {
        const Material Surface=ConstructMaterial(Row,Column);
        for(int LocalY=0;LocalY<Tile;++LocalY) for(int LocalX=0;LocalX<Tile;++LocalX)
        {
            const TileSample& Sample=Samples[static_cast<size_t>(LocalY*Tile+LocalX)];
            if(!Sample.Covered) continue;
            const MaterialResponse Response=EvaluateMaterial(Surface,Sample.Position,Sample.Normal,View,Light);
            const float Signature=Response.Diffuse.X+Response.Specular.Y*3.0f+Response.Transmission.Z*7.0f+Response.Emission.X*11.0f;
            uint32_t Bits=0u; std::memcpy(&Bits,&Signature,sizeof(Bits)); EvaluationHash[Mode]=(EvaluationHash[Mode]^Bits)*1099511628211ull;
            Vec3 Colour=TransportShade(Response,Mode,Row,Column,Sample.Normal);
            Colour={1.0f-std::exp(-Colour.X),1.0f-std::exp(-Colour.Y),1.0f-std::exp(-Colour.Z)};
            Colour=Clamp({std::pow(Colour.X,1.0f/2.2f),std::pow(Colour.Y,1.0f/2.2f),std::pow(Colour.Z,1.0f/2.2f)});
            const int X=Mode*(Panel+Gap)+Column*Tile+LocalX, Y=Row*Tile+LocalY;
            const size_t Offset=static_cast<size_t>((Y*Width+X)*3);
            Pixels[Offset+0]=static_cast<unsigned char>(Colour.X*255.0f+0.5f);
            Pixels[Offset+1]=static_cast<unsigned char>(Colour.Y*255.0f+0.5f);
            Pixels[Offset+2]=static_cast<unsigned char>(Colour.Z*255.0f+0.5f);
        }
    }
    const bool SameEvaluation=EvaluationHash[0]==EvaluationHash[1]&&EvaluationHash[1]==EvaluationHash[2];
    const bool Written=PngWriteCodec::EncodeRgbFile(OutputPath,Width,Height,3,Pixels.data(),Width*3);
    std::printf("ShaderBall grid: %zu vertices, %zu triangles, 400 materials x 3 paths\n",Vertices.size(),Triangles.size());
    std::printf("Material evaluation hashes: %016llx %016llx %016llx (%s)\n",
        static_cast<unsigned long long>(EvaluationHash[0]),static_cast<unsigned long long>(EvaluationHash[1]),
        static_cast<unsigned long long>(EvaluationHash[2]),SameEvaluation?"identical":"MISMATCH");
    std::printf("Visual proof: %s\n",OutputPath);
    return Written&&SameEvaluation?0:1;
}

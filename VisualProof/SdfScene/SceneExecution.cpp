//============================================================================================================================================
//                                                             SCENEEXECUTION.CPP
//============================================================================================================================================
// 📦 Perspective and invariant-probe readbacks from unchanged production SDF shaders on CPU Vulkan.

#include "../DistanceFieldGI/VulkanExecutionHost.h"
#include <algorithm>
#include <limits>

namespace
{
struct SceneVector
{
    double X{}, Y{}, Z{};
    SceneVector operator+(SceneVector Other) const { return {X+Other.X,Y+Other.Y,Z+Other.Z}; }
    SceneVector operator-(SceneVector Other) const { return {X-Other.X,Y-Other.Y,Z-Other.Z}; }
    SceneVector operator*(double Factor) const { return {X*Factor,Y*Factor,Z*Factor}; }
};
double Dot(SceneVector A, SceneVector B) { return A.X*B.X+A.Y*B.Y+A.Z*B.Z; }
SceneVector Cross(SceneVector A, SceneVector B) { return {A.Y*B.Z-A.Z*B.Y,A.Z*B.X-A.X*B.Z,A.X*B.Y-A.Y*B.X}; }
SceneVector Unit(SceneVector A) { return A*(1.0/std::sqrt(Dot(A,A))); }
SceneVector Point(const float* A) { return {A[0],A[1],A[2]}; }

struct SceneGeometry
{
    std::vector<Frontier::VertexRecord> Vertices;
    std::vector<uint32_t> Indices;
    std::vector<Frontier::InstanceRecord> Instances;
    double Scale=1;
    SceneVector Offset{};
    SceneVector World(SceneVector P) const { return P*Scale+Offset; }
    void Begin(uint32_t Material)
    {
        Frontier::InstanceRecord Instance{};
        for (unsigned Axis=0;Axis<4;++Axis) Instance.World[Axis*5]=Instance.PreviousWorld[Axis*5]=1;
        Instance.FirstIndex=uint32_t(Indices.size()); Instance.FlatTriangleOffset=uint32_t(Indices.size()/3);
        Instance.MaterialIndex=Material; Instances.push_back(Instance);
    }
    void Triangle(SceneVector A, SceneVector B, SceneVector C, SceneVector NormalA={}, SceneVector NormalB={}, SceneVector NormalC={})
    {
        if (Dot(NormalA,NormalA)==0) NormalA=NormalB=NormalC=Unit(Cross(B-A,C-A));
        const SceneVector Positions[]{A,B,C}, Normals[]{NormalA,NormalB,NormalC};
        for (unsigned Corner=0;Corner<3;++Corner)
        {
            const auto P=World(Positions[Corner]); const auto N=Normals[Corner];
            const auto T=Unit(Cross(std::abs(N.Z)<.9 ? SceneVector{0,0,1} : SceneVector{0,1,0},N));
            Frontier::VertexRecord V{};
            V.SpatialLocation={float(P.X),float(P.Y),float(P.Z)};
            V.NormalDirection={float(N.X),float(N.Y),float(N.Z)};
            V.TangentDirection={float(T.X),float(T.Y),float(T.Z),1};
            V.TextureCoordinateU=float((Positions[Corner].X+6)/12);
            V.TextureCoordinateV=float((Positions[Corner].Y+5)/11);
            Indices.push_back(uint32_t(Vertices.size())); Vertices.push_back(V);
        }
        ++Instances.back().TriangleCount;
    }
    void Quad(SceneVector A, SceneVector B, SceneVector C, SceneVector D)
    {
        Triangle(A,B,C); Triangle(A,C,D);
    }
    void Box(SceneVector A, SceneVector B, unsigned Material)
    {
        Begin(Material);
        Quad({A.X,A.Y,A.Z},{A.X,B.Y,A.Z},{B.X,B.Y,A.Z},{B.X,A.Y,A.Z});
        Quad({A.X,A.Y,B.Z},{B.X,A.Y,B.Z},{B.X,B.Y,B.Z},{A.X,B.Y,B.Z});
        Quad({A.X,A.Y,A.Z},{B.X,A.Y,A.Z},{B.X,A.Y,B.Z},{A.X,A.Y,B.Z});
        Quad({B.X,B.Y,A.Z},{A.X,B.Y,A.Z},{A.X,B.Y,B.Z},{B.X,B.Y,B.Z});
        Quad({A.X,B.Y,A.Z},{A.X,A.Y,A.Z},{A.X,A.Y,B.Z},{A.X,B.Y,B.Z});
        Quad({B.X,A.Y,A.Z},{B.X,B.Y,A.Z},{B.X,B.Y,B.Z},{B.X,A.Y,B.Z});
    }
};

void WritePixels(const std::filesystem::path& File, const std::vector<uint8_t>& Pixels, unsigned Width, unsigned Height)
{
    std::ofstream Stream(File,std::ios::binary); Stream<<"P6\n"<<Width<<' '<<Height<<"\n255\n";
    for (size_t Index=0;Index<Pixels.size();Index+=4) Stream.write(reinterpret_cast<const char*>(Pixels.data()+Index),3);
}

double Difference(const std::vector<uint8_t>& A, const std::vector<uint8_t>& B)
{
    double Sum=0;
    for (size_t Index=0;Index<A.size();++Index) if (Index%4!=3) Sum+=std::pow(double(A[Index])-B[Index],2);
    return std::sqrt(Sum/(A.size()/4*3));
}
}

int main(int Count,char** Arguments)
{
    using namespace Frontier;
    std::cout<<std::unitbuf;
    try
    {
        Require(Count==4,"Usage: SceneExecution shaders destination case");
        const std::string Case=Arguments[3]; const std::filesystem::path Destination=Arguments[2];
        std::filesystem::create_directories(Destination);
        ExecutionHost Host;
        Require(Host.TextureIndexing,"Descriptor-indexed CPU Vulkan required");
        constexpr unsigned Width=384, Height=256;
        SceneGeometry Scene;
        if (Case=="Small") Scene.Scale=.01;
        if (Case=="Large") Scene.Scale=100;
        if (Case=="Offset") Scene.Offset={10000,-25000,1000};
        if (Case=="Extreme") Scene.Offset={1000000,-1000000,1000000};
        Scene.Begin(0); Scene.Quad({-6,-5,0},{6,-5,0},{6,6,0},{-6,6,0});
        Scene.Begin(1); Scene.Quad({-3,-1,0},{-3,3,0},{-3,3,3},{-3,-1,3});
        Scene.Begin(2); Scene.Quad({-3,3,0},{3,3,0},{3,3,3},{-3,3,3});
        Scene.Box({.6,.4,0},{1.4,1.2,1.8},3);
        const unsigned Movable=unsigned(Scene.Instances.size()-1);
        Scene.Box({-2.6,-.8,0},{-1.7,.5,.45},4);
        Scene.Box({-2.6,.5,0},{-1.7,1.2,.9},4);
        Scene.Box({-2.6,1.2,0},{-1.7,1.9,1.35},4);
        Scene.Box({3.7,1.3,0},{3.85,1.45,2.6},3);
        Scene.Begin(5); Scene.Quad({-1.2,1,3.1},{-1.2,2.7,3.1},{1.2,2.7,3.1},{1.2,1,3.1});
        Scene.Begin(3);
        auto SpherePoint=[](unsigned Ring,unsigned Segment)
        {
            const double Latitude=3.141592653589793*Ring/8, Longitude=6.283185307179586*Segment/16;
            return SceneVector{std::sin(Latitude)*std::cos(Longitude),std::sin(Latitude)*std::sin(Longitude),std::cos(Latitude)};
        };
        for (unsigned Ring=0;Ring<8;++Ring) for (unsigned Segment=0;Segment<16;++Segment)
        {
            auto A=SpherePoint(Ring,Segment),B=SpherePoint(Ring+1,Segment),C=SpherePoint(Ring+1,Segment+1),D=SpherePoint(Ring,Segment+1);
            SceneVector Center{-.5,.2,.7};
            if (Ring!=0) Scene.Triangle(Center+A*.7,Center+B*.7,Center+D*.7,A,B,D);
            if (Ring!=7) Scene.Triangle(Center+D*.7,Center+B*.7,Center+C*.7,D,B,C);
        }
        std::vector<MaterialRecord> Materials(6);
        std::vector<MaterialSlabRecord> Slabs(6);
        const float Colours[6][3]={{.65f,.65f,.65f},{.65f,.045f,.025f},{.025f,.3f,.52f},{.58f,.58f,.58f},{.7f,.48f,.07f},{0,0,0}};
        for (unsigned Index=0;Index<6;++Index)
        {
            auto& M=Materials[Index]; auto& S=Slabs[Index];
            M.AlbedoR=S.BaseColorR=Colours[Index][0]; M.AlbedoG=S.BaseColorG=Colours[Index][1]; M.AlbedoB=S.BaseColorB=Colours[Index][2];
            M.Roughness=1; M.BaseColourTexture=M.NormalTexture=UINT32_MAX; M.SlabOffset=Index; M.SlabCount=1;
            S.BaseWeight=1; S.SpecularWeight=0; S.SpecularRoughness=1; S.SpecularIor=1.5f;
            S.SpecularColorR=S.SpecularColorG=S.SpecularColorB=1;
            S.GeometryOpacity=S.NormalScale=S.OcclusionStrength=S.MixWeight=1;
            for (auto& Slot:S.TextureSlots) Slot=UINT32_MAX;
        }
        Slabs[5].EmissionLuminance=4; Slabs[5].EmissionColorR=1; Slabs[5].EmissionColorG=.85f; Slabs[5].EmissionColorB=.6f;
        Materials[5].EmissiveR=4; Materials[5].EmissiveG=3.4f; Materials[5].EmissiveB=2.4f;
        DistanceFieldStructure Geometry;
        Require(Geometry.Construct(Scene.Vertices,Scene.Indices,Scene.Instances,Materials),"Scene BVH construction failed");
        SceneVector Eye{7,-10,7}, Target{0,.5,1}; double FieldOfView=50;
        if (Case=="Orbit") Eye={-6,-9,7};
        if (Case=="High") Eye={2,-3,13};
        if (Case=="Far") { Eye=Target+(Eye-Target)*20; FieldOfView=2.67; }
        Eye=Scene.World(Eye); Target=Scene.World(Target);
        std::cout<<"SCENE case="<<Case<<" scale="<<Scene.Scale<<" offset="<<Scene.Offset.X<<','<<Scene.Offset.Y<<','<<Scene.Offset.Z
                 <<" facets="<<Geometry.QueryFacets().size()<<" instances="<<Scene.Instances.size()<<"\n";
        std::vector<float> Surface(Width*Height*4), Normals(Width*Height*2);
        auto Project=[&]()
        {
            const auto Forward=Unit(Target-Eye), Right=Unit(Cross(Forward,{0,0,1})), Up=Cross(Right,Forward);
            const double Aperture=std::tan(FieldOfView*3.141592653589793/360);
            const auto& Facets=Geometry.QueryFacets();
            for (unsigned Row=0;Row<Height;++Row) for (unsigned Column=0;Column<Width;++Column)
            {
                const auto Ray=Unit(Forward+Right*((2*(Column+.5)/Width-1)*Aperture*Width/Height)+Up*((1-2*(Row+.5)/Height)*Aperture));
                double Closest=std::numeric_limits<double>::max(); uint32_t Packed=UINT32_MAX;
                for (const auto& Facet:Facets)
                {
                    const auto A=Point(Facet.Alpha), EdgeA=Point(Facet.Beta)-A, EdgeB=Point(Facet.Gamma)-A;
                    const auto P=Cross(Ray,EdgeB); const double Determinant=Dot(EdgeA,P);
                    if (std::abs(Determinant)<1e-18) continue;
                    const auto Delta=Eye-A; const double U=Dot(Delta,P)/Determinant;
                    const auto Q=Cross(Delta,EdgeA); const double V=Dot(Ray,Q)/Determinant, Travel=Dot(EdgeB,Q)/Determinant;
                    if (U<0 || V<0 || U+V>1 || Travel<=0 || Travel>=Closest) continue;
                    Closest=Travel; uint32_t Instance,Primitive;
                    std::memcpy(&Instance,&Facet.Alpha[3],4); std::memcpy(&Primitive,&Facet.Beta[3],4);
                    Require(Primitive<16384,"Visibility primitive packing exceeded"); Packed=(Instance<<14)|Primitive;
                }
                const auto P=Eye+Ray*(Packed==UINT32_MAX ? 100*Scene.Scale : Closest); const size_t Pixel=(Row*Width+Column)*4;
                Surface[Pixel]=float(P.X); Surface[Pixel+1]=float(P.Y); Surface[Pixel+2]=float(P.Z); std::memcpy(&Surface[Pixel+3],&Packed,4);
            }
        };
        Project();
        auto Output=Host.AllocateImage(Width,Height,VK_FORMAT_R8G8B8A8_UNORM,nullptr,Width*Height*4);
        auto Position=Host.AllocateImage(Width,Height,VK_FORMAT_R32G32B32A32_SFLOAT,Surface.data(),Surface.size()*4);
        auto Normal=Host.AllocateImage(Width,Height,VK_FORMAT_R16G16B16A16_SFLOAT,Normals.data(),Normals.size()*4);
        const float White[4]={1,1,1,1};
        auto Table=Host.AllocateImage(1,1,VK_FORMAT_R32G32B32A32_SFLOAT,White,sizeof(White),true);
        auto VertexBuffer=Host.Allocate(Scene.Vertices.size()*sizeof(VertexRecord),Scene.Vertices.data());
        auto IndexBuffer=Host.Allocate(Scene.Indices.size()*4,Scene.Indices.data());
        auto InstanceBuffer=Host.Allocate(Scene.Instances.size()*sizeof(InstanceRecord),Scene.Instances.data());
        auto MaterialBuffer=Host.Allocate(Materials.size()*sizeof(MaterialRecord),Materials.data());
        auto SlabBuffer=Host.Allocate(Slabs.size()*sizeof(MaterialSlabRecord),Slabs.data());
        auto Triangles=Host.Allocate(Scene.Indices.size()/3*64), Readback=Host.Allocate(Width*Height*4);
        auto Upload=Host.Allocate(Surface.size()*4);
        auto UploadSurface=[&]()
        {
            Host.Replace(Upload,Surface.data(),Surface.size()*4); Host.Begin();
            Host.Transition(Position,VK_IMAGE_LAYOUT_GENERAL,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
            VkBufferImageCopy Copy{}; Copy.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1}; Copy.imageExtent={Width,Height,1};
            vkCmdCopyBufferToImage(Host.Command,Upload.Buffer,Position.Image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,1,&Copy);
            Host.Transition(Position,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,VK_IMAGE_LAYOUT_GENERAL); Host.Submit();
        };
        DistanceFieldStageInit Initialization;
        Initialization.PhysicalDevice=Host.Physical; Initialization.Device=Host.Device; Initialization.MemoryProperties=Host.Memory;
        Initialization.Geometry=&Geometry; Initialization.SpirvDirectory=Arguments[1];
        Initialization.CardResolution=4; Initialization.VolumeResolution=32; Initialization.ClipmapCellSize=.15f;
        Initialization.OutputImageView=Output.View; Initialization.SurfaceImageView=Position.View; Initialization.NormalImageView=Normal.View;
        Initialization.TriangleBuffer=Triangles.Buffer; Initialization.MaterialBuffer=MaterialBuffer.Buffer;
        Initialization.InstanceBuffer=InstanceBuffer.Buffer; Initialization.SlabBuffer=SlabBuffer.Buffer;
        Initialization.VertexBuffer=VertexBuffer.Buffer; Initialization.IndexBuffer=IndexBuffer.Buffer;
        Initialization.TableSampler=Host.Sampler; Initialization.EnergyLutView=Initialization.SheenLutView=Table.View;
        DistanceFieldGIStage Stage;
        const bool Ready=Stage.Bring(Initialization);
        Require(Ready,Stage.QueryRefusal().c_str());
        DistanceFieldFrameParams Frame;
        Frame.CameraEye[0]=float(Eye.X); Frame.CameraEye[1]=float(Eye.Y); Frame.CameraEye[2]=float(Eye.Z);
        Frame.SunDirection[0]=-.6f; Frame.SunDirection[1]=-.7f; Frame.SunDirection[2]=1;
        Frame.SunRadiance=1.8f; Frame.ShadowSoftness=.06f; Frame.ReflectionMode=0; Frame.FeatureFlags=1;
        Frame.SkyAmbient[0]=Frame.SkyAmbient[1]=Frame.SkyAmbient[2]=.005f;
        auto Execute=[&](const std::string& Name,unsigned Frames,unsigned RenderWidth=0,unsigned RenderHeight=0)
        {
            if (!RenderWidth) RenderWidth=Width;
            if (!RenderHeight) RenderHeight=Height;
            for (unsigned Index=0;Index<Frames;++Index)
            {
                Frame.RenderWidth=Index+1==Frames ? RenderWidth : 1; Frame.RenderHeight=Index+1==Frames ? RenderHeight : 1;
                Host.Begin(); Require(Stage.RecordFrame(Host.Command,Frame),"Production scene dispatch failed"); Host.Submit();
            }
            Host.Begin(); Host.Transition(Output,VK_IMAGE_LAYOUT_GENERAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
            VkBufferImageCopy Copy{}; Copy.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1}; Copy.imageExtent={Width,Height,1};
            vkCmdCopyImageToBuffer(Host.Command,Output.Image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,Readback.Buffer,1,&Copy);
            Host.Transition(Output,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,VK_IMAGE_LAYOUT_GENERAL); Host.Submit();
            auto Pixels=Host.Read(Readback);
            if (!Name.empty()) WritePixels(Destination/(Name+".ppm"),Pixels,Width,Height);
            std::cout<<"CAPTURE "<<Name<<" frames="<<Frames<<"\n";
            return Pixels;
        };
        const auto Original=Execute("Scene-GI",32);
        Frame.FeatureFlags=0; const auto Without=Execute("Scene-GI-off",1); Frame.FeatureFlags=1;
        std::cout<<"METRIC gi_on_off_rms "<<Difference(Original,Without)<<'\n';
        if (Case=="Reference")
        {
            Scene.Instances[Movable].World[12]=float(1.5*Scene.Scale);
            Host.Replace(InstanceBuffer,Scene.Instances.data(),Scene.Instances.size()*sizeof(InstanceRecord));
            Require(Geometry.RefreshInstances(Scene.Instances.data(),uint32_t(Scene.Instances.size())),"Moving instance refresh failed");
            Project(); UploadSurface(); Execute("Moved-first-frame",1); Execute("Moved-settled",32);
            Scene.Instances[Movable].World[12]=0;
            Host.Replace(InstanceBuffer,Scene.Instances.data(),Scene.Instances.size()*sizeof(InstanceRecord));
            Require(Geometry.RefreshInstances(Scene.Instances.data(),uint32_t(Scene.Instances.size())),"Restored instance refresh failed");
            Project(); UploadSurface(); const auto Restored=Execute("Restored",32);
            std::cout<<"METRIC restored_scene_rms "<<Difference(Original,Restored)<<'\n';
        }
        // 📝 Same physical floor probes for every scale, translation and camera: image projection cannot hide lighting drift.
        for (unsigned Row=0;Row<32;++Row) for (unsigned Column=0;Column<32;++Column)
        {
            const double X=-2.8+(Column+.5)/32*5.6, Y=-2+(Row+.5)/32*4.8;
            const auto P=Scene.World({X,Y,0}); const uint32_t Primitive=(Y+5)/11>(X+6)/12 ? 1 : 0;
            const auto Pixel=(Row*Width+Column)*4;
            Surface[Pixel]=float(P.X); Surface[Pixel+1]=float(P.Y); Surface[Pixel+2]=float(P.Z); std::memcpy(&Surface[Pixel+3],&Primitive,4);
        }
        UploadSurface(); const auto ProbeImage=Execute("",1,32,32);
        std::vector<uint8_t> Probes;
        for (unsigned Row=0;Row<32;++Row) Probes.insert(Probes.end(),ProbeImage.begin()+Row*Width*4,ProbeImage.begin()+Row*Width*4+32*4);
        WritePixels(Destination/"Floor-probes.ppm",Probes,32,32);
        Stage.Destroy(); Require(ValidationErrors.load()==0,"Vulkan validation errors in perspective scene");
        std::cout<<"PASS production CPU Vulkan scene execution; invariance assessed separately, not assumed\n";
        return 0;
    }
    catch (const std::exception& Error) { std::cerr<<"FAIL "<<Error.what()<<'\n'; return 1; }
}

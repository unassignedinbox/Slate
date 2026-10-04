//============================================================================================================================================
//                                                    DISTANCEFIELDARTIFACTPROOF.H
//============================================================================================================================================
// 📦 Receiver-plane maps execute the production shader stages on CPU Vulkan, separating shadows from matte diffuse transport.

int RunDistanceArtifacts(const char* Shaders, const char* Destination)
{
    using namespace Frontier;
    ExecutionHost Host;
    Require(Host.TextureIndexing, "Descriptor-indexed CPU Vulkan required");
    constexpr uint32_t Width = 160, Height = 160;
    std::filesystem::create_directories(Destination);
    std::vector<VertexRecord> Vertices(8);
    const float Positions[8][3] = {{-4,-4,0},{4,-4,0},{4,4,0},{-4,4,0},
        {-.6f,-.7f,1},{-.6f,.7f,1},{.6f,.7f,1},{.6f,-.7f,1}};
    for (unsigned Index=0; Index<8; ++Index)
    {
        Vertices[Index].SpatialLocation = {Positions[Index][0],Positions[Index][1],Positions[Index][2]};
        Vertices[Index].NormalDirection = {0,0,Index<4 ? 1.0f : -1.0f};
        Vertices[Index].TangentDirection = {1,0,0,1};
    }
    std::vector<uint32_t> Indices{0,1,2,0,2,3,4,5,6,4,6,7};
    std::vector<InstanceRecord> Instances(2);
    std::vector<MaterialRecord> Materials(2);
    std::vector<MaterialSlabRecord> Slabs(2);
    for (unsigned Index=0; Index<2; ++Index)
    {
        for (unsigned Axis=0; Axis<4; ++Axis) Instances[Index].World[Axis*5]=Instances[Index].PreviousWorld[Axis*5]=1;
        Instances[Index].FirstIndex=Index*6; Instances[Index].TriangleCount=2;
        Instances[Index].MaterialIndex=Index; Instances[Index].FlatTriangleOffset=Index*2;
        Materials[Index].AlbedoR=Materials[Index].AlbedoG=Materials[Index].AlbedoB=.7f;
        Materials[Index].Roughness=1;
        Materials[Index].BaseColourTexture=Materials[Index].NormalTexture=UINT32_MAX;
        Materials[Index].SlabOffset=Index; Materials[Index].SlabCount=1;
        Slabs[Index].BaseWeight=1; Slabs[Index].BaseColorR=Slabs[Index].BaseColorG=Slabs[Index].BaseColorB=.7f;
        Slabs[Index].SpecularColorR=Slabs[Index].SpecularColorG=Slabs[Index].SpecularColorB=1;
        Slabs[Index].SpecularWeight=0; Slabs[Index].SpecularRoughness=1; Slabs[Index].SpecularIor=1.5f;
        Slabs[Index].GeometryOpacity=Slabs[Index].NormalScale=Slabs[Index].OcclusionStrength=Slabs[Index].MixWeight=1;
        for (auto& Slot:Slabs[Index].TextureSlots) Slot=UINT32_MAX;
    }
    DistanceFieldStructure Geometry;
    Require(Geometry.Construct(Vertices,Indices,Instances,Materials),"Artifact scene construction");
    std::vector<float> Surface(Width*Height*4), Normals(Width*Height*2);
    for (unsigned Row=0; Row<Height; ++Row) for (unsigned Column=0; Column<Width; ++Column)
    {
        const unsigned Pixel=Row*Width+Column;
        Surface[Pixel*4]=(float(Column)+.5f)/Width*4-2;
        Surface[Pixel*4+1]=(float(Row)+.5f)/Height*4-2;
        const uint32_t Primitive=Row>Column ? 1 : 0;
        std::memcpy(&Surface[Pixel*4+3],&Primitive,4);
    }
    auto Output=Host.AllocateImage(Width,Height,VK_FORMAT_R8G8B8A8_UNORM,nullptr,Width*Height*4);
    auto Position=Host.AllocateImage(Width,Height,VK_FORMAT_R32G32B32A32_SFLOAT,Surface.data(),Surface.size()*4);
    auto Normal=Host.AllocateImage(Width,Height,VK_FORMAT_R16G16B16A16_SFLOAT,Normals.data(),Normals.size()*4);
    const float White[4]={1,1,1,1};
    auto Table=Host.AllocateImage(1,1,VK_FORMAT_R32G32B32A32_SFLOAT,White,sizeof(White),true);
    auto VertexBuffer=Host.Allocate(Vertices.size()*sizeof(VertexRecord),Vertices.data());
    auto IndexBuffer=Host.Allocate(Indices.size()*4,Indices.data());
    auto InstanceBuffer=Host.Allocate(Instances.size()*sizeof(InstanceRecord),Instances.data());
    auto MaterialBuffer=Host.Allocate(Materials.size()*sizeof(MaterialRecord),Materials.data());
    auto SlabBuffer=Host.Allocate(Slabs.size()*sizeof(MaterialSlabRecord),Slabs.data());
    auto Triangles=Host.Allocate(4*64);
    auto Readback=Host.Allocate(Width*Height*4);
    DistanceFieldStageInit Initialization;
    Initialization.PhysicalDevice=Host.Physical; Initialization.Device=Host.Device; Initialization.MemoryProperties=Host.Memory;
    Initialization.Geometry=&Geometry; Initialization.SpirvDirectory=Shaders;
    Initialization.CardResolution=8; Initialization.VolumeResolution=16; Initialization.ClipmapCellSize=.15f;
    Initialization.OutputImageView=Output.View; Initialization.SurfaceImageView=Position.View; Initialization.NormalImageView=Normal.View;
    Initialization.TriangleBuffer=Triangles.Buffer; Initialization.MaterialBuffer=MaterialBuffer.Buffer;
    Initialization.InstanceBuffer=InstanceBuffer.Buffer; Initialization.SlabBuffer=SlabBuffer.Buffer;
    Initialization.VertexBuffer=VertexBuffer.Buffer; Initialization.IndexBuffer=IndexBuffer.Buffer;
    Initialization.TableSampler=Host.Sampler; Initialization.EnergyLutView=Initialization.SheenLutView=Table.View;
    DistanceFieldGIStage Stage;
    Require(Stage.Bring(Initialization),"Artifact stage initialization");
    DistanceFieldFrameParams Frame;
    Frame.RenderWidth=Width; Frame.RenderHeight=Height; Frame.ReflectionMode=0; Frame.FeatureFlags=0;
    Frame.CameraEye[0]=Frame.CameraEye[1]=0; Frame.CameraEye[2]=2;
    Frame.SunDirection[0]=.6f; Frame.SunDirection[1]=.2f; Frame.SunDirection[2]=1;
    Frame.SunRadiance=2; Frame.ShadowSoftness=.06f;
    Frame.SkyAmbient[0]=Frame.SkyAmbient[1]=Frame.SkyAmbient[2]=0;
    auto Execute=[&](const char* Name, unsigned Frames=1)
    {
        for (unsigned Index=0; Index<Frames; ++Index)
        {
            Host.Begin(); Require(Stage.RecordFrame(Host.Command,Frame),"Artifact dispatch"); Host.Submit();
        }
        Host.Begin(); Host.Transition(Output,VK_IMAGE_LAYOUT_GENERAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
        VkBufferImageCopy Copy{}; Copy.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0,0,1}; Copy.imageExtent={Width,Height,1};
        vkCmdCopyImageToBuffer(Host.Command,Output.Image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,Readback.Buffer,1,&Copy);
        Host.Transition(Output,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,VK_IMAGE_LAYOUT_GENERAL); Host.Submit();
        auto Pixels=Host.Read(Readback);
        std::ofstream File(std::filesystem::path(Destination)/(std::string(Name)+".ppm"),std::ios::binary);
        File<<"P6\n"<<Width<<' '<<Height<<"\n255\n";
        for (size_t Index=0;Index<Pixels.size();Index+=4) File.write(reinterpret_cast<const char*>(Pixels.data()+Index),3);
        std::cout<<"ARTIFACT rendered "<<Name<<'\n';
        return Pixels;
    };
    const auto Shadow=Execute("shadow-base");
    double MaximumShift=0;
    for (int Step=1;Step<=4;++Step)
    {
        Frame.CameraEye[0]=Step*.151f; Frame.CameraEye[1]=Step*.073f;
        const auto Shift=Execute(("shadow-camera-"+std::to_string(Step)).c_str());
        double Error=0;
        for (size_t Index=0;Index<Shift.size();Index+=4) Error+=std::pow(double(Shift[Index])-Shadow[Index],2);
        MaximumShift=std::max(MaximumShift,std::sqrt(Error/(Width*Height)));
    }
    std::cout<<"METRIC shadow_camera_rms "<<MaximumShift<<'\n';
    Frame.CameraEye[0]=Frame.CameraEye[1]=0;
    Frame.SunRadiance=0; Frame.FeatureFlags=1;
    Materials[1].EmissiveR=4;
    Slabs[1].EmissionLuminance=4; Slabs[1].EmissionColorR=1;
    Slabs[1].EmissionColorG=Slabs[1].EmissionColorB=0;
    Host.Replace(MaterialBuffer,Materials.data(),Materials.size()*sizeof(MaterialRecord));
    Host.Replace(SlabBuffer,Slabs.data(),Slabs.size()*sizeof(MaterialSlabRecord)); ++Frame.MaterialRevision;
    Require(Geometry.Construct(Vertices,Indices,Instances,Materials),"Emitter update");
    const auto Diffuse=Execute("matte-diffuse",48);
    Frame.ReflectionMode=2;
    const auto Reflected=Execute("matte-reflections-enabled");
    unsigned ReflectionDelta=0;
    for (size_t Index=0;Index<Diffuse.size();Index+=4)
        ReflectionDelta=std::max(ReflectionDelta,unsigned(std::abs(int(Diffuse[Index])-int(Reflected[Index]))));
    std::cout<<"METRIC zero_specular_reflection_delta "<<ReflectionDelta<<'\n';
    Stage.Destroy();
    Require(ValidationErrors.load()==0,"Artifact Vulkan validation errors");
    return 0;
}

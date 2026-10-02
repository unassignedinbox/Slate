//============================================================================================================================================
//                                                     DISTANCEFIELDEXECUTION.CPP
//============================================================================================================================================
// 📦 Executes the production Vulkan SDF pipelines headlessly and checks readback, transport toggles, motion and resource lifetime.

#include "Engine/DeviceExchange/DistanceFieldGIStage.h"
#include "Engine/GeometricRaster/SceneStructure.h"
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace
{
std::atomic<uint32_t> ValidationErrors{0u};
VKAPI_ATTR VkBool32 VKAPI_CALL Diagnose(VkDebugUtilsMessageSeverityFlagBitsEXT Severity,
                                      VkDebugUtilsMessageTypeFlagsEXT,
                                      const VkDebugUtilsMessengerCallbackDataEXT* Message,
                                      void*)
{
    if (Severity & VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT) ++ValidationErrors;
    std::cerr << "[Vulkan validation] " << Message->pMessage << '\n';
    return VK_FALSE;
}
void Require(bool Accepted, const char* Explanation)
{
    if (!Accepted) throw std::runtime_error(Explanation);
}
void Accept(VkResult Result) { Require(Result == VK_SUCCESS, "Vulkan command failed"); }
struct Allocation { VkBuffer Buffer{}; VkDeviceMemory Memory{}; VkDeviceSize Size{}; };
struct ImageAllocation { VkImage Image{}; VkDeviceMemory Memory{}; VkImageView View{}; VkFormat Format{}; uint32_t Width{}, Height{}; };

class ExecutionHost
{
public:
    VkInstance Instance{};
    VkDebugUtilsMessengerEXT Messenger{};
    VkPhysicalDevice Physical{};
    VkDevice Device{};
    VkQueue Queue{};
    VkCommandPool Pool{};
    VkCommandBuffer Command{};
    VkPhysicalDeviceMemoryProperties Memory{};
    std::vector<Allocation> Buffers;
    std::vector<ImageAllocation> Images;
    VkSampler Sampler{};
    bool TextureIndexing=false, TextureUpdateAfterBind=false;
    ExecutionHost()
    {
        VkApplicationInfo Application{VK_STRUCTURE_TYPE_APPLICATION_INFO};
        Application.pApplicationName = "SDF production pipeline execution proof";
        Application.apiVersion = VK_API_VERSION_1_2;
        const char* Layer = "VK_LAYER_KHRONOS_validation";
        const char* Extension = VK_EXT_DEBUG_UTILS_EXTENSION_NAME;
        VkValidationFeatureEnableEXT Synchronization[] = {VK_VALIDATION_FEATURE_ENABLE_SYNCHRONIZATION_VALIDATION_EXT,
            VK_VALIDATION_FEATURE_ENABLE_GPU_ASSISTED_EXT, VK_VALIDATION_FEATURE_ENABLE_GPU_ASSISTED_RESERVE_BINDING_SLOT_EXT};
        VkValidationFeaturesEXT Validation{VK_STRUCTURE_TYPE_VALIDATION_FEATURES_EXT};
        Validation.enabledValidationFeatureCount=3u; Validation.pEnabledValidationFeatures=Synchronization;
        VkInstanceCreateInfo Information{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
        Information.pNext=&Validation; Information.pApplicationInfo=&Application;
        Information.enabledLayerCount=1u; Information.ppEnabledLayerNames=&Layer;
        Information.enabledExtensionCount=1u; Information.ppEnabledExtensionNames=&Extension;
        Accept(vkCreateInstance(&Information,nullptr,&Instance));
        VkDebugUtilsMessengerCreateInfoEXT Diagnostics{VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT};
        Diagnostics.messageSeverity=VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT;
        Diagnostics.messageType=VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT | VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;
        Diagnostics.pfnUserCallback=Diagnose;
        auto ConstructMessenger=reinterpret_cast<PFN_vkCreateDebugUtilsMessengerEXT>(vkGetInstanceProcAddr(Instance,"vkCreateDebugUtilsMessengerEXT"));
        Require(ConstructMessenger!=nullptr,"Vulkan validation messenger is missing");
        Accept(ConstructMessenger(Instance,&Diagnostics,nullptr,&Messenger));
        uint32_t Count=0u; Accept(vkEnumeratePhysicalDevices(Instance,&Count,nullptr));
        Require(Count>0u,"No Vulkan device: software Vulkan is acceptable but execution may not be skipped");
        std::vector<VkPhysicalDevice> PhysicalDevices(Count); Accept(vkEnumeratePhysicalDevices(Instance,&Count,PhysicalDevices.data()));
        Physical=PhysicalDevices[0];
        VkPhysicalDeviceProperties Properties{}; vkGetPhysicalDeviceProperties(Physical,&Properties);
        std::cout << "Vulkan execution device: " << Properties.deviceName << '\n';
        vkGetPhysicalDeviceMemoryProperties(Physical,&Memory);
        vkGetPhysicalDeviceQueueFamilyProperties(Physical,&Count,nullptr);
        std::vector<VkQueueFamilyProperties> Families(Count); vkGetPhysicalDeviceQueueFamilyProperties(Physical,&Count,Families.data());
        uint32_t Family=UINT32_MAX;
        for(uint32_t Index=0u;Index<Count;++Index) if(Families[Index].queueFlags & VK_QUEUE_COMPUTE_BIT) { Family=Index;break; }
        Require(Family!=UINT32_MAX,"No compute queue");
        float Priority=1.0f;
        VkDeviceQueueCreateInfo QueueInformation{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
        QueueInformation.queueFamilyIndex=Family; QueueInformation.queueCount=1u; QueueInformation.pQueuePriorities=&Priority;
        VkPhysicalDeviceVulkan12Features Supported{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES};
        VkPhysicalDeviceFeatures2 Available{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2}; Available.pNext=&Supported;
        vkGetPhysicalDeviceFeatures2(Physical,&Available);
        TextureIndexing=Supported.runtimeDescriptorArray && Supported.shaderSampledImageArrayNonUniformIndexing &&
                        Supported.descriptorBindingVariableDescriptorCount && Supported.descriptorBindingPartiallyBound;
        TextureUpdateAfterBind=TextureIndexing && Supported.descriptorBindingSampledImageUpdateAfterBind;
        VkPhysicalDeviceVulkan12Features Enabled{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES};
        Enabled.runtimeDescriptorArray=Enabled.shaderSampledImageArrayNonUniformIndexing=TextureIndexing;
        Enabled.descriptorBindingVariableDescriptorCount=Enabled.descriptorBindingPartiallyBound=TextureIndexing;
        Enabled.descriptorBindingSampledImageUpdateAfterBind=TextureUpdateAfterBind;
        VkPhysicalDeviceFeatures Features{}; Features.shaderStorageImageExtendedFormats=VK_TRUE;
        VkDeviceCreateInfo DeviceInformation{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
        DeviceInformation.pNext=&Enabled;
        DeviceInformation.queueCreateInfoCount=1u; DeviceInformation.pQueueCreateInfos=&QueueInformation; DeviceInformation.pEnabledFeatures=&Features;
        Accept(vkCreateDevice(Physical,&DeviceInformation,nullptr,&Device));
        vkGetDeviceQueue(Device,Family,0u,&Queue);
        VkCommandPoolCreateInfo PoolInformation{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        PoolInformation.queueFamilyIndex=Family; PoolInformation.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        Accept(vkCreateCommandPool(Device,&PoolInformation,nullptr,&Pool));
        VkCommandBufferAllocateInfo CommandInformation{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        CommandInformation.commandPool=Pool; CommandInformation.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY; CommandInformation.commandBufferCount=1u;
        Accept(vkAllocateCommandBuffers(Device,&CommandInformation,&Command));
        VkSamplerCreateInfo Sampling{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
        Sampling.magFilter=Sampling.minFilter=VK_FILTER_NEAREST;
        Sampling.addressModeU=Sampling.addressModeV=Sampling.addressModeW=VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        Accept(vkCreateSampler(Device,&Sampling,nullptr,&Sampler));
    }
    uint32_t ResolveMemory(uint32_t Mask, VkMemoryPropertyFlags Flags)
    {
        for(uint32_t Index=0u;Index<Memory.memoryTypeCount;++Index)
            if((Mask&(1u<<Index)) && (Memory.memoryTypes[Index].propertyFlags&Flags)==Flags) return Index;
        throw std::runtime_error("Required memory type missing");
    }
    Allocation Allocate(VkDeviceSize Size, const void* Data=nullptr)
    {
        Allocation Result{}; Result.Size=Size;
        VkBufferCreateInfo Information{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
        Information.size=Size; Information.usage=VK_BUFFER_USAGE_STORAGE_BUFFER_BIT|VK_BUFFER_USAGE_TRANSFER_SRC_BIT|VK_BUFFER_USAGE_TRANSFER_DST_BIT;
        Accept(vkCreateBuffer(Device,&Information,nullptr,&Result.Buffer));
        VkMemoryRequirements Requirements{}; vkGetBufferMemoryRequirements(Device,Result.Buffer,&Requirements);
        VkMemoryAllocateInfo Extent{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Extent.allocationSize=Requirements.size;
        Extent.memoryTypeIndex=ResolveMemory(Requirements.memoryTypeBits,VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
        Accept(vkAllocateMemory(Device,&Extent,nullptr,&Result.Memory)); Accept(vkBindBufferMemory(Device,Result.Buffer,Result.Memory,0u));
        Buffers.push_back(Result);
        void* Mapped=nullptr; Accept(vkMapMemory(Device,Result.Memory,0u,Size,0u,&Mapped));
        if(Data) std::memcpy(Mapped,Data,size_t(Size)); else std::memset(Mapped,0,size_t(Size));
        vkUnmapMemory(Device,Result.Memory);
        return Result;
    }
    void Begin()
    {
        Accept(vkResetCommandBuffer(Command,0u));
        VkCommandBufferBeginInfo Information{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        Information.flags=VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        Accept(vkBeginCommandBuffer(Command,&Information));
    }
    void Submit()
    {
        Accept(vkEndCommandBuffer(Command));
        VkSubmitInfo Submission{VK_STRUCTURE_TYPE_SUBMIT_INFO}; Submission.commandBufferCount=1u; Submission.pCommandBuffers=&Command;
        Accept(vkQueueSubmit(Queue,1u,&Submission,VK_NULL_HANDLE)); Accept(vkQueueWaitIdle(Queue));
    }
    void Transition(ImageAllocation Image, VkImageLayout Before, VkImageLayout After)
    {
        VkImageMemoryBarrier Barrier{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
        Barrier.srcAccessMask=Before==VK_IMAGE_LAYOUT_UNDEFINED ? 0u : VK_ACCESS_MEMORY_READ_BIT|VK_ACCESS_MEMORY_WRITE_BIT;
        Barrier.dstAccessMask=VK_ACCESS_MEMORY_READ_BIT|VK_ACCESS_MEMORY_WRITE_BIT;
        Barrier.oldLayout=Before; Barrier.newLayout=After; Barrier.image=Image.Image;
        Barrier.srcQueueFamilyIndex=Barrier.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;
        Barrier.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0u,1u,0u,1u};
        vkCmdPipelineBarrier(Command,VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,0u,0u,nullptr,0u,nullptr,1u,&Barrier);
    }
    ImageAllocation AllocateImage(uint32_t Width,uint32_t Height,VkFormat Format, const void* Data,size_t Bytes,bool Sampled=false)
    {
        ImageAllocation Result{}; Result.Width=Width; Result.Height=Height; Result.Format=Format;
        VkImageCreateInfo Information{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
        Information.imageType=VK_IMAGE_TYPE_2D; Information.extent={Width,Height,1u}; Information.format=Format;
        Information.mipLevels=Information.arrayLayers=1u; Information.samples=VK_SAMPLE_COUNT_1_BIT;
        Information.tiling=VK_IMAGE_TILING_OPTIMAL;
        Information.usage=VK_IMAGE_USAGE_TRANSFER_SRC_BIT|VK_IMAGE_USAGE_TRANSFER_DST_BIT|(Sampled?VK_IMAGE_USAGE_SAMPLED_BIT:VK_IMAGE_USAGE_STORAGE_BIT);
        Accept(vkCreateImage(Device,&Information,nullptr,&Result.Image));
        VkMemoryRequirements Requirements{}; vkGetImageMemoryRequirements(Device,Result.Image,&Requirements);
        VkMemoryAllocateInfo Extent{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
        Extent.allocationSize=Requirements.size; Extent.memoryTypeIndex=ResolveMemory(Requirements.memoryTypeBits,VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
        Accept(vkAllocateMemory(Device,&Extent,nullptr,&Result.Memory)); Accept(vkBindImageMemory(Device,Result.Image,Result.Memory,0u));
        VkImageViewCreateInfo View{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
        View.image=Result.Image; View.viewType=VK_IMAGE_VIEW_TYPE_2D; View.format=Format; View.subresourceRange={VK_IMAGE_ASPECT_COLOR_BIT,0u,1u,0u,1u};
        Accept(vkCreateImageView(Device,&View,nullptr,&Result.View)); Images.push_back(Result);
        Allocation Staging=Allocate(Bytes,Data);
        Begin(); Transition(Result,VK_IMAGE_LAYOUT_UNDEFINED,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
        VkBufferImageCopy Copy{}; Copy.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0u,0u,1u}; Copy.imageExtent={Width,Height,1u};
        vkCmdCopyBufferToImage(Command,Staging.Buffer,Result.Image,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,1u,&Copy);
        Transition(Result,VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,Sampled?VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL:VK_IMAGE_LAYOUT_GENERAL); Submit();
        return Result;
    }
    void Replace(Allocation Extent, const void* Content, size_t Bytes)
    {
        Require(Bytes<=Extent.Size,"Scene update exceeded allocation");
        void* Mapped=nullptr; Accept(vkMapMemory(Device,Extent.Memory,0u,Bytes,0u,&Mapped));
        std::memcpy(Mapped,Content,Bytes); vkUnmapMemory(Device,Extent.Memory);
    }
    std::vector<uint8_t> Read(Allocation Extent)
    {
        void* Mapped=nullptr; Accept(vkMapMemory(Device,Extent.Memory,0u,Extent.Size,0u,&Mapped));
        std::vector<uint8_t> Bytes(size_t(Extent.Size)); std::memcpy(Bytes.data(),Mapped,Bytes.size());
        vkUnmapMemory(Device,Extent.Memory); return Bytes;
    }
    ~ExecutionHost()
    {
        if(Device)
        {
            vkDeviceWaitIdle(Device);
            for(auto Image:Images) { vkDestroyImageView(Device,Image.View,nullptr);vkDestroyImage(Device,Image.Image,nullptr);vkFreeMemory(Device,Image.Memory,nullptr); }
            for(auto Buffer:Buffers) { vkDestroyBuffer(Device,Buffer.Buffer,nullptr);vkFreeMemory(Device,Buffer.Memory,nullptr); }
            if(Sampler) vkDestroySampler(Device,Sampler,nullptr);
            if(Pool) vkDestroyCommandPool(Device,Pool,nullptr);
            vkDestroyDevice(Device,nullptr);
        }
        if(Messenger)
        {
            auto Retire=reinterpret_cast<PFN_vkDestroyDebugUtilsMessengerEXT>(vkGetInstanceProcAddr(Instance,"vkDestroyDebugUtilsMessengerEXT"));
            Retire(Instance,Messenger,nullptr);
        }
        if(Instance) vkDestroyInstance(Instance,nullptr);
    }
};
}

int main(int Count,char** Arguments)
{
    std::cout << std::unitbuf;
    using namespace Frontier;
    try
    {
        Require(Count==3,"Usage: DistanceFieldExecution shader-directory output-directory");
        {
            ExecutionHost Host;
            constexpr uint32_t Width=32u, Height=24u;
            std::filesystem::create_directories(Arguments[2]);
            std::vector<VertexRecord> Vertices(6);
            const float Positions[6][3]={{-2,-2,0},{2,-2,0},{0,2,0},{-2,-2,1},{0,2,1},{2,-2,1}};
            for(uint32_t Index=0u;Index<6u;++Index)
            {
                Vertices[Index].SpatialLocation={Positions[Index][0],Positions[Index][1],Positions[Index][2]};
                Vertices[Index].NormalDirection={0,0,Index<3u?1.0f:-1.0f};
                Vertices[Index].TangentDirection={1,0,0,1};
            }
            std::vector<uint32_t> Indices{0,1,2,3,4,5};
            std::vector<InstanceRecord> Instances(2);
            std::vector<MaterialRecord> Materials(2);
            for(uint32_t Index=0u;Index<2u;++Index)
            {
                for(uint32_t Axis=0u;Axis<4u;++Axis) Instances[Index].World[Axis*5u]=Instances[Index].PreviousWorld[Axis*5u]=1.0f;
                Instances[Index].FirstIndex=Index*3u; Instances[Index].TriangleCount=1u;
                Instances[Index].MaterialIndex=Index; Instances[Index].FlatTriangleOffset=Index;
                Materials[Index].AlbedoR=Materials[Index].AlbedoG=Materials[Index].AlbedoB=0.7f;
                Materials[Index].Roughness=0.5f;
                Materials[Index].BaseColourTexture=Materials[Index].NormalTexture=UINT32_MAX;
            }
            Materials[1].EmissiveR=4.0f;
            DistanceFieldStructure Geometry;
            Require(Geometry.Construct(Vertices,Indices,Instances,Materials),"Scene BVH construction failed");
            const uint64_t Revision=Geometry.QueryRevision();
            Require(Geometry.RefreshInstances(Instances.data(),2u) && Geometry.QueryRevision()==Revision,"Unchanged instances must retain history");
            std::vector<float> Surface(Width*Height*4u), Normal(Width*Height*2u);
            for(uint32_t Index=0u;Index<Width*Height;++Index)
            {
                Surface[Index*4u]=(float(Index%Width)/float(Width)-0.5f)*0.4f;
                Surface[Index*4u+1u]=(float(Index/Width)/float(Height)-0.5f)*0.4f;
            }
            const uint32_t Invalid=UINT32_MAX; std::memcpy(&Surface[3],&Invalid,4u);
            auto Output=Host.AllocateImage(Width,Height,VK_FORMAT_R8G8B8A8_UNORM,nullptr,Width*Height*4u);
            auto Position=Host.AllocateImage(Width,Height,VK_FORMAT_R32G32B32A32_SFLOAT,Surface.data(),Surface.size()*4u);
            auto Normals=Host.AllocateImage(Width,Height,VK_FORMAT_R16G16B16A16_SFLOAT,Normal.data(),Normal.size()*4u);
            const float White[4]={0.6f,0.02f,0.7f,1.0f}; auto Table=Host.AllocateImage(1,1,VK_FORMAT_R32G32B32A32_SFLOAT,White,sizeof(White),true);
            auto VertexBuffer=Host.Allocate(Vertices.size()*sizeof(VertexRecord),Vertices.data());
            auto IndexBuffer=Host.Allocate(Indices.size()*4u,Indices.data());
            auto InstanceBuffer=Host.Allocate(Instances.size()*sizeof(InstanceRecord),Instances.data());
            auto MaterialBuffer=Host.Allocate(Materials.size()*sizeof(MaterialRecord),Materials.data());
            auto Triangles=Host.Allocate(2u*64u); auto Slabs=Host.Allocate(sizeof(MaterialSlabRecord));
            DistanceFieldStageInit Initialization{};
            Initialization.Device=Host.Device; Initialization.MemoryProperties=Host.Memory;
            Initialization.Geometry=&Geometry; Initialization.SpirvDirectory=Arguments[1];
            Initialization.VolumeResolution=8u; Initialization.ClipmapCellSize=0.125f;
            Initialization.OutputImageView=Output.View; Initialization.SurfaceImageView=Position.View; Initialization.NormalImageView=Normals.View;
            Initialization.TriangleBuffer=Triangles.Buffer; Initialization.MaterialBuffer=MaterialBuffer.Buffer;
            Initialization.InstanceBuffer=InstanceBuffer.Buffer; Initialization.SlabBuffer=Slabs.Buffer;
            Initialization.VertexBuffer=VertexBuffer.Buffer; Initialization.IndexBuffer=IndexBuffer.Buffer;
            Initialization.TableSampler=Host.Sampler; Initialization.EnergyLutView=Initialization.SheenLutView=Table.View;
            DistanceFieldGIStage Stage;
            auto Missing=Initialization; Missing.SpirvDirectory="/missing-sdf-shaders";
            std::cout<<"Checking missing-shader refusal\n";
            Require(!Stage.Bring(Missing) && !Stage.IsReady(),"Missing shaders must refuse readiness");
            std::cout<<"Constructing production pipelines\n";
            Require(Stage.Bring(Initialization),"SDF initialization refused");
            Require(Stage.IsReady(),"Populated stage must become ready");
            auto Pixels=Host.Allocate(Width*Height*4u);
            auto Fields=Host.Allocate(Stage.QueryVoxelCount()*64u);
            auto Cache=Host.Allocate(Stage.QueryVoxelCount()*16u);
            DistanceFieldFrameParams Frame{};
            Frame.CameraEye[0]=Frame.CameraEye[1]=0.0f; Frame.CameraEye[2]=0.5f;
            Frame.SunRadiance=0.0f; Frame.SkyAmbient[0]=Frame.SkyAmbient[1]=Frame.SkyAmbient[2]=0.0f;
            Frame.FeatureFlags=1u; Frame.ReflectionMode=0u; Frame.RenderWidth=Width; Frame.RenderHeight=Height;
            auto Execute=[&](uint32_t Frames,const char* Name)
            {
                for(uint32_t Index=0u;Index<Frames;++Index)
                {
                    Host.Begin(); Require(Stage.RecordFrame(Host.Command,Frame),"Production SDF command recording refused");
                    Host.Submit();
                }
                Host.Begin();
                Host.Transition(Output,VK_IMAGE_LAYOUT_GENERAL,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL);
                VkBufferImageCopy Copy{}; Copy.imageSubresource={VK_IMAGE_ASPECT_COLOR_BIT,0u,0u,1u}; Copy.imageExtent={Output.Width,Output.Height,1u};
                vkCmdCopyImageToBuffer(Host.Command,Output.Image,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,Pixels.Buffer,1u,&Copy);
                Host.Transition(Output,VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,VK_IMAGE_LAYOUT_GENERAL);
                VkBufferCopy FieldCopy{0u,0u,Fields.Size}, CacheCopy{0u,0u,Cache.Size};
                vkCmdCopyBuffer(Host.Command,Stage.QueryDistanceBuffer(),Fields.Buffer,1u,&FieldCopy);
                vkCmdCopyBuffer(Host.Command,Stage.QueryRadianceBuffer(),Cache.Buffer,1u,&CacheCopy);
                Host.Submit();
                auto Bytes=Host.Read(Pixels); Bytes.resize(Output.Width*Output.Height*4u);
                std::ofstream Image(std::filesystem::path(Arguments[2])/(std::string(Name)+".ppm"),std::ios::binary);
                Image<<"P6\n"<<Output.Width<<' '<<Output.Height<<"\n255\n";
                double Red=0.0, Green=0.0;
                for(size_t Index=0u;Index<Bytes.size();Index+=4u)
                { Image.write(reinterpret_cast<const char*>(Bytes.data()+Index),3u); Red+=Bytes[Index]; Green+=Bytes[Index+1u]; }
                std::cout<<Name<<": red="<<Red<<" green="<<Green<<'\n';
                return std::array<double,2>{Red,Green};
            };
            std::cout<<"Dispatching production pipelines\n";
            auto Lit=Execute(8u,"emissive-gi");
            Require(Lit[0]>1000.0 && Lit[0]>Lit[1]*2.0,"Emissive scene must produce red indirect illumination");
            auto FieldBytes=Host.Read(Fields); const float* FieldValues=reinterpret_cast<const float*>(FieldBytes.data());
            auto CacheBytes=Host.Read(Cache); const float* CacheValues=reinterpret_cast<const float*>(CacheBytes.data());
            uint32_t GroundBounces=0u;
            for(uint32_t Index=0u;Index<Stage.QueryVoxelCount();++Index)
            {
                for(uint32_t Channel=0u;Channel<16u;++Channel) Require(std::isfinite(FieldValues[Index*16u+Channel]),"Non-finite distance voxel");
                for(uint32_t Channel=0u;Channel<4u;++Channel) Require(std::isfinite(CacheValues[Index*4u+Channel]),"Non-finite radiance cache");
                if(FieldValues[Index*16u+2u]<0.01f && CacheValues[Index*4u]>0.01f) ++GroundBounces;
            }
            Require(GroundBounces>0u,"Receiving surface cache never accumulated bounced emission");
            Frame.FeatureFlags=0u; auto Disabled=Execute(1u,"gi-off");
            Require(Disabled[0]<Lit[0]*0.1,"GI toggle failed to suppress indirect illumination");
            Frame.FeatureFlags=1u;
            Instances[1].World[12]=6.0f;
            Require(Geometry.RefreshInstances(Instances.data(),2u) && Geometry.QueryRevision()!=Revision,"Moving instances must rebuild world geometry");
            auto Moved=Execute(4u,"emitter-moved");
            Require(Moved[0]<Lit[0]*0.2,"Moving the emitter left stale indirect lighting");
            Require(Host.Read(Fields)!=FieldBytes,"Moved geometry did not alter the populated distance volumes");
            Instances[1].World[12]=0.0f; Require(Geometry.RefreshInstances(Instances.data(),2u),"Restore emitter failed");
            Materials[1].EmissiveR=0.0f; Require(Geometry.Construct(Vertices,Indices,Instances,Materials),"Dark scene update failed");
            auto Dark=Execute(3u,"emission-off");
            Require(Dark[0]<Lit[0]*0.1,"Emission change did not clear cache history");
            Frame.FeatureFlags=0u; Frame.SunRadiance=1.0f;
            Frame.SunDirection[0]=Frame.SunDirection[1]=0.0f; Frame.SunDirection[2]=1.0f;
            auto Shadow=Execute(1u,"sun-occluded");
            Instances[1].World[12]=6.0f; Require(Geometry.RefreshInstances(Instances.data(),2u),"Occluder motion failed");
            auto Sun=Execute(1u,"sun-visible");
            Require(Sun[0]>1000.0 && Shadow[0]<Sun[0]*0.2,"Scene-derived distance shadows did not follow occluder motion");
            Frame.SunRadiance=0.0f; auto SunOff=Execute(1u,"sun-off");
            Require(SunOff[0]<Sun[0]*0.1,"Lighting change retained direct illumination");
            auto BeforeCamera=Host.Read(Fields); Frame.CameraEye[0]+=0.5f;
            (void)Execute(1u,"camera-shifted");
            Require(Host.Read(Fields)!=BeforeCamera,"Camera movement did not re-snap the clipmaps");
            Frame.CameraEye[0]=0.0f; Instances[1].World[12]=0.0f;
            Frame.FeatureFlags=1u;
            Materials[1].EmissiveR=4.0f; Require(Geometry.Construct(Vertices,Indices,Instances,Materials),"Emissive scene reload failed");
            Stage.Destroy(); Stage.Destroy(); Require(!Stage.IsReady(),"Retired stage still ready");
            Require(Stage.Bring(Initialization),"Stage recreation failed");
            auto Recreated=Execute(4u,"recreated"); Require(Recreated[0]>1000.0,"Scene recreation produced no lighting");
            Frame.FeatureFlags=0u; Frame.ReflectionMode=2u;
            auto Reflection=Execute(1u,"mesh-reflection"); Require(Reflection[0]>500.0,"Exact mesh reflection missed emissive geometry");
            ImageAllocation Pigment{};
            if(Host.TextureIndexing)
            {
                Stage.Destroy();
                const float Green[4]={0,1,0,1}; Pigment=Host.AllocateImage(1,1,VK_FORMAT_R32G32B32A32_SFLOAT,Green,sizeof(Green),true);
                MaterialSlabRecord Pigmented{};
                Pigmented.BaseWeight=1.0f; Pigmented.BaseColorR=Pigmented.BaseColorG=Pigmented.BaseColorB=1.0f;
                Pigmented.SpecularRoughness=0.5f; Pigmented.SpecularIor=1.5f; Pigmented.GeometryOpacity=1.0f;
                Pigmented.NormalScale=Pigmented.OcclusionStrength=Pigmented.MixWeight=1.0f;
                for(auto& Slot:Pigmented.TextureSlots) Slot=UINT32_MAX;
                Pigmented.TextureSlots[0]=0xFFFF0000u;
                Materials[0].SlabCount=1u;
                Host.Replace(MaterialBuffer,Materials.data(),Materials.size()*sizeof(MaterialRecord));
                Host.Replace(Slabs,&Pigmented,sizeof(Pigmented));
                Frame.FeatureFlags=1u; Frame.ReflectionMode=0u;
                Require(Stage.Bring(Initialization),"Constant-material scene recreation failed");
                auto Constant=Execute(4u,"constant-material");
                Stage.Destroy();
                Initialization.TextureCapacity=4u; Initialization.TextureCount=1u;
                Initialization.TextureSampler=Host.Sampler; Initialization.TextureViews=&Pigment.View;
                Initialization.TextureUpdateAfterBind=Host.TextureUpdateAfterBind;
                Require(Stage.Bring(Initialization),"Bindless production resolve creation failed");
                auto Textured=Execute(4u,"textured-material");
                Require(Constant[0]>1000.0 && Textured[0]<Constant[0]*0.1,"Texture descriptor indexing did not modulate the resolved material");
                std::cout<<"PASS descriptor-indexed production resolve and actual texture sampling\n";
            }
            else std::cout<<"SKIP descriptor-indexed variant: physical device lacks the required descriptor features\n";
            Frame.FeatureFlags=0u;

            // 📝 Thin glass must transmit the first opaque hit, not misclassify it as a glass exit.
            MaterialSlabRecord Glass{};
            Glass.BaseColorR=Glass.BaseColorG=Glass.BaseColorB=1.0f;
            Glass.SpecularWeight=1.0f; Glass.SpecularColorR=Glass.SpecularColorG=Glass.SpecularColorB=1.0f;
            Glass.SpecularRoughness=0.05f; Glass.SpecularIor=1.5f;
            Glass.TransmissionWeight=1.0f; Glass.TransmissionColorR=Glass.TransmissionColorG=Glass.TransmissionColorB=1.0f;
            Glass.TransmissionDepth=0.2f; Glass.GeometryOpacity=1.0f; Glass.SlabFlags=1u;
            Glass.NormalScale=Glass.OcclusionStrength=Glass.MixWeight=1.0f;
            for(auto& Slot:Glass.TextureSlots) Slot=UINT32_MAX;
            Materials[0].SlabCount=1u;
            Host.Replace(MaterialBuffer,Materials.data(),Materials.size()*sizeof(MaterialRecord));
            Host.Replace(Slabs,&Glass,sizeof(Glass));
            Instances[1].World[14]=-2.0f;
            Host.Replace(InstanceBuffer,Instances.data(),Instances.size()*sizeof(InstanceRecord));
            Require(Geometry.RefreshInstances(Instances.data(),2u),"Transmission scene positioning failed");
            Frame.ReflectionMode=0u;
            auto Foil=Execute(1u,"thin-glass"); Require(Foil[0]>1000.0,"Thin-walled glass did not transmit the emissive scene");
            Glass.TransmissionWeight=0.0f; Host.Replace(Slabs,&Glass,sizeof(Glass));
            auto Opaque=Execute(1u,"opaque-control"); Require(Opaque[0]<Foil[0]*0.1,"Opaque control unexpectedly transmitted light");

            // 📝 A solid slab exercises actual entry/exit refraction and Beer attenuation over geometric thickness.
            Stage.Destroy();
            Vertices.resize(9u); Indices={0,1,2,3,4,5,6,7,8};
            const float GlassPositions[9][3]={{-2,-2,0},{2,-2,0},{0,2,0},
                {-2,-2,-0.2f},{0,2,-0.2f},{2,-2,-0.2f},{-2,-2,-1},{2,-2,-1},{0,2,-1}};
            for(uint32_t Index=0u;Index<9u;++Index)
            {
                Vertices[Index].SpatialLocation={GlassPositions[Index][0],GlassPositions[Index][1],GlassPositions[Index][2]};
                Vertices[Index].NormalDirection={0,0,Index>=3u && Index<6u ? -1.0f : 1.0f};
                Vertices[Index].TangentDirection={1,0,0,1};
            }
            Instances[0].TriangleCount=2u; Instances[1].FirstIndex=6u; Instances[1].FlatTriangleOffset=2u; Instances[1].World[14]=0.0f;
            Host.Replace(InstanceBuffer,Instances.data(),Instances.size()*sizeof(InstanceRecord));
            VertexBuffer=Host.Allocate(Vertices.size()*sizeof(VertexRecord),Vertices.data());
            IndexBuffer=Host.Allocate(Indices.size()*4u,Indices.data()); Triangles=Host.Allocate(3u*64u);
            Initialization.VertexBuffer=VertexBuffer.Buffer; Initialization.IndexBuffer=IndexBuffer.Buffer; Initialization.TriangleBuffer=Triangles.Buffer;
            Require(Geometry.Construct(Vertices,Indices,Instances,Materials),"Solid glass geometry failed");
            Glass.TransmissionWeight=1.0f; Glass.SlabFlags=0u; Host.Replace(Slabs,&Glass,sizeof(Glass));
            Require(Stage.Bring(Initialization),"Solid glass scene recreation failed");
            auto Clear=Execute(1u,"solid-clear-glass"); Require(Clear[0]>1000.0,"Solid dielectric did not transmit the background");
            Glass.TransmissionColorR=0.1f; Host.Replace(Slabs,&Glass,sizeof(Glass));
            auto Tinted=Execute(1u,"solid-tinted-glass");
            Require(Tinted[0]>100.0 && Tinted[0]<Clear[0]*0.85,"Geometric Beer attenuation did not darken transmitted red light");

            Stage.Destroy();
            Output=Host.AllocateImage(16u,16u,VK_FORMAT_R8G8B8A8_UNORM,nullptr,16u*16u*4u);
            Position=Host.AllocateImage(16u,16u,VK_FORMAT_R32G32B32A32_SFLOAT,Surface.data(),16u*16u*16u);
            Normals=Host.AllocateImage(16u,16u,VK_FORMAT_R16G16B16A16_SFLOAT,Normal.data(),16u*16u*8u);
            Initialization.OutputImageView=Output.View; Initialization.SurfaceImageView=Position.View; Initialization.NormalImageView=Normals.View;
            Frame.RenderWidth=Frame.RenderHeight=16u;
            Require(Stage.Bring(Initialization),"Resize descriptor recreation failed");
            auto Resized=Execute(1u,"resized"); Require(Resized[0]>100.0,"Resized output lost transmission");
            Stage.Destroy();
            Require(ValidationErrors.load()==0u,"Vulkan validation reported errors");
            std::cout<<"PASS production SDF pipelines: populated three-level fields, emissive GI, bounce cache, GI toggle, moving instances, history reset, solar shadows, camera re-snapping, recreation, mesh reflection, thin/solid refraction, Beer attenuation and resize\n";
        }
        Require(ValidationErrors.load()==0u,"Vulkan resource destruction reported validation errors");
        std::cout<<"PASS Vulkan validation including synchronization and resource destruction: zero errors\n";
        return 0;
    }
    catch(const std::exception& Refusal)
    {
        std::cerr<<"FAIL SDF execution: "<<Refusal.what()<<'\n';
        return 1;
    }
}

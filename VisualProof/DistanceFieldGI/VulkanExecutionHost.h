//============================================================================================================================================
//                                                     VULKANEXECUTIONHOST.H
//============================================================================================================================================
// 📦 Executes the production Vulkan SDF pipelines headlessly and checks readback, transport toggles, motion and resource lifetime.

#include "Engine/DeviceExchange/DistanceFieldGIStage.h"
#include "Engine/GeometricRaster/SceneStructure.h"
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <cstdlib>
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
        Physical=VK_NULL_HANDLE;
        for (const auto Candidate : PhysicalDevices)
        {
            VkPhysicalDeviceProperties Information{};
            vkGetPhysicalDeviceProperties(Candidate, &Information);
            if (Information.deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU) { Physical = Candidate; break; }
        }
        Require(Physical != VK_NULL_HANDLE, "CPU execution required: install the lavapipe Vulkan ICD");
        VkPhysicalDeviceProperties Properties{}; vkGetPhysicalDeviceProperties(Physical,&Properties);
        std::cout << "Vulkan execution device: " << Properties.deviceName << '\n';
        std::cout << "CPU JIT flags: " << (std::getenv("GALLIVM_PERF") ? std::getenv("GALLIVM_PERF") : "default") << '\n';
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



//============================================================================================================================================
//                                               📦 Engine/GeometricRaster/TriangleIndex.h
//============================================================================================================================================
// 🧩 Flat, world-space triangle record shared by the scene codec, CPU scene builders and the device exchange.
//
// This is deliberately a data-only header. It used to live in SwapchainExchange.h, which forced every CPU-only scene
// builder and Frontier Space validation tool to include Vulkan declarations merely to name a 64-byte record. Keeping the
// record beside the other geometric records means content import/export and CPU proofs do not have a Vulkan-header,
// driver, or GPU dependency.
#pragma once

namespace Frontier
{
    // Three world-space vertices, material slot and UVs. The layout mirrors GpuTriangle in ReSTIRViewport.slang.
    struct TriangleIndex
    {
        float    VertexAlphaX,  VertexAlphaY,  VertexAlphaZ;   // [m] vertex alpha world position
        float    MaterialSlot;                                  // material index, stored as reinterpreted uint bits
        float    VertexBetaX,   VertexBetaY,   VertexBetaZ;    // [m] vertex beta world position
        float    TextureGammaU;                                 // [uv] gamma u
        float    VertexGammaX,  VertexGammaY,  VertexGammaZ;   // [m] vertex gamma world position
        float    TextureGammaV;                                 // [uv] gamma v
        float    TextureAlphaU, TextureAlphaV;                  // [uv] alpha
        float    TextureBetaU,  TextureBetaV;                   // [uv] beta
    };
    static_assert(sizeof(TriangleIndex) == 64u, "TriangleIndex must be 64 bytes (std430 mirror)");
}

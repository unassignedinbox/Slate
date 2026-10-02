//============================================================================================================================================
//                                                          DRIVECONTENTHOST.CPP
//============================================================================================================================================
// 📦 Headless export and import verification of Project-Drive's existing authored opening scene.

#include "../Source/DriveSceneAuthor.h"
#include "../../../Engine/ContentInterchange/SceneCodec.h"

#include <cstdio>
#include <filesystem>
#include <string>

/// 📦 Exports absent project content and verifies it through the native glTF importer.
/// err   returns nonzero for malformed arguments, export failure or unreadable content
int main(int ArgumentCount, char** Arguments)
{
    if (ArgumentCount != 3 || (std::string(Arguments[1]) != "--ensure" && std::string(Arguments[1]) != "--verify-only"))
    {
        std::fputs("Usage: DriveContentHost --ensure|--verify-only DriveCourse.gltf\n", stderr);
        return 64;
    }

    try
    {
        const std::filesystem::path SceneLocation = std::filesystem::absolute(Arguments[2]);
        if (!std::filesystem::exists(SceneLocation) && std::string(Arguments[1]) == "--ensure")
        {
            std::filesystem::create_directories(SceneLocation.parent_path());
            Frontier::Drive::DriveSceneAuthor Author;
            // 📝 The shared host currently imports a static opening scene, not wheel-instance simulation transforms.
            Author.Construct(true);
            std::string Refusal;
            if (!Author.Export(SceneLocation.string(), &Refusal))
            {
                std::fprintf(stderr, "Drive scene export failed: %s\n", Refusal.c_str());
                return 1;
            }
        }

        Frontier::SceneStructure Scene;
        Frontier::TextureIndex Textures;
        std::string Refusal;
        if (!Frontier::SceneCodec::Decode(SceneLocation.string(), Scene, &Textures, {}, &Refusal))
        {
            std::fprintf(stderr, "Drive scene import failed: %s\n", Refusal.c_str());
            return 1;
        }
        if (Scene.QueryTriangleCount() == 0 || Scene.QueryPlacements().size() < 6)
        {
            std::fputs("Drive scene is missing its authored vehicle, wheels or course\n", stderr);
            return 1;
        }
        std::printf("PASS DriveCourse import: %u triangles, %zu placements, %zu instances\n",
                    Scene.QueryTriangleCount(), Scene.QueryPlacements().size(), Scene.QueryInstances().size());
        return 0;
    }
    catch (const std::exception& Refusal)
    {
        std::fprintf(stderr, "Drive content refused: %s\n", Refusal.what());
        return 1;
    }
}

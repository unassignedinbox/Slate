//============================================================================================================================================
//                                                 SWATCHSHEETEXHIBIT.CPP
//============================================================================================================================================
// 🧩 The Project-Zero material grid as a 4×4 gallery sheet. Each panel is one swatch rendered through the M7b
//    preview entry (ShaderballPreview.h — the same stage rig, camera, integrator tables, and PNG encode as the
//    inspector preview), and the 16 unique materials come from MaterialSwatchStructure — the single source the
//    `--scene materialswatch` level exports from, so the sheet and the GPU scene show the same 16 by
//    construction. The layout reads like the wall as the camera sees it: the sheet's top row is the wall's top
//    row (glass row), the bottom row is the floor row (dielectrics + metals).
//
//    Deterministic per (swatch, size, spp): same inputs ⇒ byte-identical sheet (the preview entry reseeds per
//    panel tag). Panels are stitched with PngReadCounterpart (the read counterpart of the writer the preview
//    uses) — no stb_image dependency.
//
//    Build: g++ -std=c++20 -O2 -ffunction-sections -fdata-sections -Wl,--gc-sections -DFRONTIER_CPU_PORT
//               -DSHADERBALL_PREVIEW_LIB -I Exhibits/Workbench/Materials -I Engine/ContentInterchange
//               -I Engine/DeviceExchange -I Engine/DisplayPresentation -I Engine/Shaders -I Exhibits/Workbench/Editor
//               -I <Vulkan-Headers>/include -I <cgltf> -I <ufbx> -I <fast_obj> -I <stb>
//               Exhibits/Workbench/Materials/SwatchSheetExhibit.cpp Exhibits/Workbench/Materials/ShaderballExhibit.cpp
//               Engine/ContentInterchange/MaterialSwatchStructure.cpp Engine/ContentInterchange/MaterialIndex.cpp
//               Engine/DisplayPresentation/ShadingTableCodec.cpp -o /tmp/swatch-sheet
//    (gc-sections drops MaterialSwatchStructure::Export, so no SceneCodec TU is linked.)
//    Usage: swatch-sheet [--size 384] [--spp 128] [--out Exhibits/Gallery/Materials/SwatchSheet_FullWall.png]

#include "SlangCpuShim.h"
#include "ShaderballPreview.h"
#include "MaterialSwatchStructure.h"
#include "MaterialIndex.h"
#include "PngReadCounterpart.h"
#include "PngWriteCounterpart.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

int main(int Argc, char** Argv)
{
    int      Size    = 384;
    int      Spp     = 128;
    std::string OutPath = "Exhibits/Gallery/Materials/SwatchSheet_FullWall.png";
    for (int I = 1; I + 1 < Argc; ++I)
    {
        const std::string A = Argv[I];
        if (A == "--size")            Size    = std::atoi(Argv[++I]);
        else if (A == "--spp")        Spp     = std::atoi(Argv[++I]);
        else if (A == "--out")        OutPath = Argv[++I];
    }
    if (Size <= 0 || Spp <= 0) { std::fprintf(stderr, "[swatchsheet] bad size/spp\n"); return 1; }

    const std::vector<Frontier::MaterialDescriptor>& Swatches = Frontier::MaterialSwatchStructure::QuerySwatchMaterials();
    if (Swatches.size() != 16u)
    {
        std::fprintf(stderr, "[swatchsheet] expects 16 swatches, got %zu\n", Swatches.size());
        return 1;
    }

    constexpr int Gap = 4;
    const int SheetExtent = 4 * Size + 3 * Gap;
    std::vector<unsigned char> Sheet(static_cast<size_t>(SheetExtent) * static_cast<size_t>(SheetExtent) * 3u, 8u);

    long  Bad     = 0;
    bool  Broken  = false;
    for (int SheetRow = 0; SheetRow < 4; ++SheetRow)
        for (int Column = 0; Column < 4; ++Column)
        {
            const int WallRow = 3 - SheetRow;   // the sheet reads like the wall: top sheet row = top wall row
            const Frontier::MaterialDescriptor& Material = Swatches[static_cast<size_t>(WallRow * 4 + Column)];
            uint32_t Folded = 0u;
            const Frontier::MaterialSlabDescriptor Slab =
                Frontier::MaterialIndex::Flatten(Material, 1u, &Folded, nullptr).front();
            char PanelPath[160];
            std::snprintf(PanelPath, sizeof(PanelPath), "/tmp/SwatchSheet.%02d.png", WallRow * 4 + Column);
            Frontier::ShaderballPreviewRequest Req;
            Req.Material  = &Material;
            Req.Selection = Frontier::MaterialIndex::DeriveReflectance(Material, Slab);
            Req.Size      = Size;
            Req.Spp       = Spp;
            Req.OutPath   = PanelPath;
            Frontier::ShaderballPreviewResult Res;
            if (!Frontier::RenderShaderballPreview(Req, Res))
            {
                std::fprintf(stderr, "[swatchsheet] FAILED %s\n", Material.Name.c_str());
                Broken = true;
            }
            else
            {
                Bad += Res.Bad;
                std::vector<unsigned char> Pixels;
                int W = 0, H = 0;
                if (PngReadCounterpart::ReadPng(PanelPath, &W, &H, &Pixels) != 1 || W != Size || H != Size)
                {
                    std::fprintf(stderr, "[swatchsheet] READBACK FAILED %s\n", Material.Name.c_str());
                    Broken = true;
                }
                else
                    for (int Y = 0; Y < Size; ++Y)
                        std::memcpy(Sheet.data() + (static_cast<size_t>(SheetRow * (Size + Gap) + Y) * SheetExtent +
                                                   static_cast<size_t>(Column * (Size + Gap))) * 3u,
                                    Pixels.data() + static_cast<size_t>(Y) * static_cast<size_t>(Size) * 3u,
                                    static_cast<size_t>(Size) * 3u);
            }
            std::remove(PanelPath);
        }

    const int Ok = PngWriteCounterpart::WritePng(OutPath.c_str(), SheetExtent, SheetExtent, 3, Sheet.data(), SheetExtent * 3);
    if (Broken || Bad != 0 || !Ok)
    {
        std::printf("[swatchsheet] FAILED -> %s (bad=%ld)\n", OutPath.c_str(), Bad);
        return 1;
    }
    std::printf("[swatchsheet] wrote -> %s (%d×%d, bad=%ld)\n", OutPath.c_str(), SheetExtent, SheetExtent, Bad);
    return 0;
}

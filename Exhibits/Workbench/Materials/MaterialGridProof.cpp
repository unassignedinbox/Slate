//============================================================================================================================================
//                                                  MATERIALGRIDPROOF.CPP
//============================================================================================================================================
// Project-Zero material-grid gate. It verifies that the procedural exhibit has one unique material per cell and that
// the exported glTF survives the ordinary ContentCodec import path with the same selection census.

#include "MaterialGridStructure.h"
#include "ContentCodec.h"
#include "MaterialIndex.h"
#include "SceneStructure.h"

#include <cstdio>
#include <string>
#include <vector>

namespace {

int Passed = 0;
int Failed = 0;

void Check(bool Condition, const char* Label)
{
    if (Condition) { ++Passed; std::printf("ok - %s\n", Label); }
    else           { ++Failed; std::printf("FAIL - %s\n", Label); }
}

const char* const kNames[] = {
    "plastic", "bone", "clearcoat", "glass_glossy", "glass_clear",
    "metal_gold", "metal_silver", "metal_copper", "metal_iron", "metal_brushed",
    "clearcoat_rough", "velvet", "felt", "wax", "jade",
    "soap_film", "emissive", "unlit", "hazy_clear", "matte_eon"
};

} // namespace

int main()
{
    using namespace Frontier;

    MaterialGridStructure Grid;
    Grid.Construct();
    const std::vector<MaterialDescriptor>& Authored = Grid.QueryMaterials();

    Check(Authored.size() == 22u, "floor + 20 unique cell materials + luminaire");
    Check(Grid.QuerySpans().size() == 22u, "floor + 20 named balls + luminaire spans");
    Check(Grid.QueryTriangles().size() > 42000u, "grid contains the complete 5 x 4 sphere exhibit");

    bool NamesInOrder = Authored.size() >= 22u;
    for (uint32_t I = 0u; I < 20u && NamesInOrder; ++I)
        NamesInOrder = Authored[I + 1u].Name == kNames[I] && Authored[I + 1u].Slabs.size() == 1u;
    Check(NamesInOrder, "20 cells have stable names and one authored slab each");

    bool Unique = true;
    for (uint32_t A = 1u; A <= 20u && Unique; ++A)
        for (uint32_t B = A + 1u; B <= 20u; ++B)
            Unique = Authored[A].Name != Authored[B].Name;
    Check(Unique, "every grid cell has a unique material identity");

    const MaterialReflectance Expected[20] = {
        MaterialReflectance::Standard, MaterialReflectance::Subsurface, MaterialReflectance::ClearCoated,
        MaterialReflectance::Transmissive, MaterialReflectance::Transmissive, MaterialReflectance::Standard,
        MaterialReflectance::Standard, MaterialReflectance::Standard, MaterialReflectance::Standard,
        MaterialReflectance::Anisotropic, MaterialReflectance::ClearCoated, MaterialReflectance::Cloth,
        MaterialReflectance::Cloth, MaterialReflectance::Subsurface, MaterialReflectance::Subsurface,
        MaterialReflectance::Standard, MaterialReflectance::EmissiveOnly, MaterialReflectance::Unlit,
        MaterialReflectance::ClearCoated, MaterialReflectance::Standard
    };
    bool SelectionCensus = true;
    for (uint32_t I = 0u; I < 20u && SelectionCensus; ++I)
        SelectionCensus = MaterialIndex::DeriveReflectance(Authored[I + 1u], Authored[I + 1u].Slabs.front()) == Expected[I];
    Check(SelectionCensus, "grid covers the intended reflectance selections");

    const char* Path = "/tmp/ProjectZero_MaterialGridProof.gltf";
    std::string Error;
    Check(Grid.Export(Path, &Error), "material grid exports through SceneCodec");

    SceneStructure Imported;
    SceneDecodeConfiguration Decode;
    Decode.SlabLimit = 1u;
    Check(ContentCodec::Decode(Path, Imported, nullptr, Decode, &Error), "exported grid decodes through ContentCodec");
    Check(Imported.QueryMaterials().QueryCount() == 23u, "import retains 22 authored materials plus fallback");

    const std::vector<MaterialDescriptor>& Decoded = Imported.QueryMaterials().QueryDescriptors();
    bool ImportedNames = Decoded.size() >= 21u;
    for (uint32_t I = 0u; I < 20u && ImportedNames; ++I)
        ImportedNames = Decoded[I + 1u].Name == kNames[I];
    Check(ImportedNames, "imported material identities remain in grid order");

    std::remove(Path);
    std::remove("/tmp/ProjectZero_MaterialGridProof.bin");

    std::printf("MATERIAL GRID: %s (%d/%d)\n", Failed == 0 ? "PASS" : "FAIL", Passed, Passed + Failed);
    return Failed == 0 ? 0 : 1;
}

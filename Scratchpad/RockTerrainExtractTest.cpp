#include "../Projects/Project-Zero/Source/RockTerrainSpace.h"
#include <cassert>
#include <iostream>
int main()
{
    Frontier::ProjectZero::RockTerrainConfiguration c;
    c.ExtractionResolution = 12;
    Frontier::ProjectZero::RockTerrainSpace terrain(c);
    std::vector<Frontier::ProjectZero::RockTerrainVertex> vertices;
    std::vector<uint32_t> indices;
    terrain.ExtractSurface(vertices, indices);
    assert(!vertices.empty() && indices.size() % 3u == 0u);
    std::cout << vertices.size() << " " << indices.size() / 3u << "\n";
}

#include "../Projects/Project-Zero/Source/RockTerrainSpace.h"
#include <cassert>
#include <cmath>
#include <iostream>
int main()
{
    Frontier::ProjectZero::RockTerrainSpace terrain;
    auto a = terrain.Sample({2.13f, -1.77f, 2.4f});
    auto b = terrain.Sample({2.13f + 31.4159f, -1.77f, 2.4f});
    assert(std::abs(a.Distance - b.Distance) > 1e-5f);
    const auto before = terrain.Sample({0.0f, 0.0f, 2.0f});
    terrain.AddSculptStroke({{0.0f, 0.0f, 2.0f}, 0.8f, 0.4f, 0.7f, Frontier::ProjectZero::RockBrushCategory::RemoveMass});
    const auto after = terrain.Sample({0.0f, 0.0f, 2.0f});
    assert(after.Distance > before.Distance);
    assert(terrain.UndoSculptStroke());
    assert(std::abs(terrain.Sample({0.0f, 0.0f, 2.0f}).Distance - before.Distance) < 1e-5f);
    std::cout << a.Distance << " " << b.Distance << " " << after.Distance << "\n";
}

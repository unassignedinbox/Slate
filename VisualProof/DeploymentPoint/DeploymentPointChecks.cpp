//============================================================================================================================================
//                                                    DEPLOYMENTPOINTCHECKS.CPP
//============================================================================================================================================
// 📦 Executes actor lifetime and player-data transfer, including failed and reentrant construction.

#include "../../Frontier/Engine/ProjectInterchange/DeploymentCodec.h"
#include <cassert>
#include <cstdio>
#include <stdexcept>

int main()
{
    Frontier::DeploymentSequence Deployments;
    Frontier::DeploymentPoint Point;
    Point.Player.Identifier = 42;
    Point.Player.Properties["Loadout"] = "Touring";
    Point.Archetype = "Character"; // the mechanism is not coupled to vehicles
    Point.DeleteAfterSpawn = true;
    Point.Rotation = {0, 0, 0, 2};
    const auto Once = Deployments.Register(Point);
    assert(Once && Deployments.Query(Once)->Rotation[3] == 1.0f);
    assert(!Deployments.Deploy(Once, [](const auto&) { return 0u; }));
    assert(Deployments.QueryCount() == 1);
    try
    {
        Deployments.Deploy(Once, [](const auto&) -> uint64_t { throw std::runtime_error("allocation refusal"); });
        assert(false);
    }
    catch (const std::runtime_error&) {}
    auto Player = Deployments.Deploy(Once, [&](const auto& Specification)
    {
        assert(Specification.Player.Identifier == 42);
        assert(!Deployments.Retire(Once));
        assert(!Deployments.Deploy(Once, [](const auto&) { return 9u; }));
        return 17u;
    });
    assert(Player && Player->EntityIdentifier == 17 && Deployments.QueryCount() == 0);
    assert(Player->Specification.Player.Properties.at("Loadout") == "Touring");
    assert(!Deployments.Deploy(Once, [](const auto&) { return 18u; }));
    std::puts("PASS consume-on-success: actor removed; player identity/loadout transferred and still alive; respawn refused");
    Point.DeleteAfterSpawn = false;
    const auto Persistent = Deployments.Register(Point);
    assert(Persistent != Once);
    for (uint64_t Entity = 20; Entity < 84; ++Entity)
    {
        const auto Respawn = Deployments.Deploy(Persistent, [=](const auto&) { return Entity; });
        assert(Respawn && Respawn->Specification.Player.Identifier == 42 && Deployments.QueryCount() == 1);
    }
    std::puts("PASS retained actor: 64 respawns preserve player data; failed/reentrant/throwing spawns retain the actor");
    Point.Enabled = false;
    const auto Disabled = Deployments.Register(Point);
    assert(!Deployments.Deploy(Disabled, [](const auto&) { assert(false); return 1u; }));
    Point.Position[1] = std::numeric_limits<float>::quiet_NaN();
    assert(Deployments.Register(Point) == 0);
    Frontier::DeploymentPoint Decoded;
    std::string Refusal;
    std::istringstream Stream("[Project]\nName = \"Ignored\"\n[DeploymentPoint]\nPlayerName = \"Player #42\" # comment\nPlayerIdentifier = 42\nPlayer.Loadout = \"Touring\"\nPosition = [1,2,3]\nRotation = [0,0,0,1]\nDeleteAfterSpawn = true\n");
    assert(Frontier::DecodeDeploymentPoint(Stream, Decoded, Refusal));
    assert(Decoded.Player.DisplayName == "Player #42" && Decoded.Position[1] == 2 && Decoded.DeleteAfterSpawn);
    for (const char* Invalid : {"PlayerIdentifier = -1", "PlayerIdentifier = 0", "Team = 4294967296", "Rotation = [0,0,0,0]",
                               "Position = [1,2]", "DeleteAfterSpawn = maybe", "Bogus = 42", "Enabled = true\nEnabled = false"})
    {
        std::istringstream Broken(std::string("[DeploymentPoint]\n") + Invalid);
        assert(!Frontier::DecodeDeploymentPoint(Broken, Decoded, Refusal));
        assert(Decoded.Player.Identifier == 42 && Decoded.Position[1] == 2);
    }
    std::puts("PASS disabled/invalid actors refused; strict configuration decode is atomic and preserves player metadata");
}

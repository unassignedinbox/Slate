# Experimental

Browser design studies in this checkout.

| Exhibit | Open |
|---|---|
| WebGPU distance-field GI (Slate exhibit) in a Frontier editor workspace — drift yard, ControlVehicle burnouts, tyre smoke & fire, fracture, stress test | [IlluminationHost/index.html](IlluminationHost/index.html) — serve it, see [IlluminationHost/README.md](IlluminationHost/README.md) |

## Provenance

`IlluminationHost/` was imported from Frontier (`SultanAladin/Frontier-`, patch `01a141bb-e6e8-71cb-8fbf-e7a69a00b7de.patch`
on `GI-Updated-Html-Version`, itself derived from `SultanAladin/Slate@arena/c6cba543-slate:Exhibits/IlluminationHost`
plus the soft-tyre carcass work). The patch carries no bytes for the three binary facet archives, so they were
regenerated here with the checked-in codec:

```sh
python3 Experimental/IlluminationHost/Archive/FacetArchiveCodec.py <FrontierCheckoutAt-arena/4f07c82a-frontier>
```

which reads the four authored `.inl` archives and writes `Archive/*.facet` (`FCT1` streams).

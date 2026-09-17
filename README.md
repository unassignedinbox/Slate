# Frontier

## Project-Zero material coverage grid

Project-Zero can generate the material-channel exhibit on first launch and then load it through the normal glTF/content
interchange path:

```text
Project-Zero.exe --scene materialgrid
```

The 4 × 5 grid assigns a unique material descriptor and material id to every cell. It includes plastic, bone,
clearcoat, glossy and clear glass, gold/silver/copper/iron/brushed metals, rubber, ceramic, velvet, subsurface wax
and skin, thin-film, hazy plastic, emissive, unlit, and alpha-cutout. The generated `Content/Scenes/MaterialGrid.gltf`
is intentionally ignored like the shader-ball export; delete it to regenerate the deterministic exhibit.

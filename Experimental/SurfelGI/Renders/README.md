# ShaderBall preview captures

These PNGs were rendered from the 6 × 4 sphere grid, OpenPBR test-material values, 8 × 7 m floor, and 2 × 2 m / 120-nit overhead luminaire authored in `Engine/ContentInterchange/ShaderBallStructure.cpp`.

- **`ShaderBall_Direct.png`** — direct-light / soft-shadow reference.
- **`ShaderBall_OneBouncePreview.png`** — the same view with a small CPU one-diffuse-bounce preview, useful for checking where indirect light should become visible once the Vulkan surfel passes are connected to Project-Zero.

They are **not claimed to be a capture from the experimental GLSL SurfelGI path**: Project-Zero has not yet been wired to create its surfel resources or dispatch those shaders.  The dependency-free renderer is kept beside the captures at `../Tools/RenderShaderBallPreview.cpp` precisely so the scene preview is reproducible and its scope is unambiguous.

Recreate them on a C++20 host with ImageMagick installed:

```bash
g++ -std=c++20 -O3 -Wall -Wextra -Werror -pedantic \
  Experimental/SurfelGI/Tools/RenderShaderBallPreview.cpp \
  -o /tmp/render-shaderball

/tmp/render-shaderball /tmp/ShaderBall_Direct.ppm direct
/tmp/render-shaderball /tmp/ShaderBall_OneBouncePreview.ppm indirect
convert /tmp/ShaderBall_Direct.ppm Experimental/SurfelGI/Renders/ShaderBall_Direct.png
convert /tmp/ShaderBall_OneBouncePreview.ppm Experimental/SurfelGI/Renders/ShaderBall_OneBouncePreview.png
```

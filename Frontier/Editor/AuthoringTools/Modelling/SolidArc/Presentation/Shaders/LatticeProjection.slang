//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Presentation/Shaders/LatticeProjection.slang — Analytic finite Z-up ground lattice with one-pixel lines, LOD and world axes
//============================================================================================================================================
// A full-screen triangle. Each fragment reconstructs its view ray, intersects the z = 0 plane analytically, and shades
//    a one-pixel anti-aliased two-level lattice (minor / major) whose cell steps up as the camera pulls back so line density
//    stays roughly constant on screen. A square fade about the origin ends the pad instead of a hard horizon.
//    Colours: X axis red, Y axis green (Z-up world, Blender / Plasticity convention).
//
// 📝 LatticeShade() is the whole shader. Its inputs are plain values so the software raster calls the identical body:
//      Origin, Direction  : view ray for this pixel (world)
//      PixelAngle         : perspective — radians subtended by one pixel; orthographic — 0
//      PixelWorld         : orthographic — world units per pixel; perspective — 0
//    It returns straight rgb + coverage; the raster blends it over the clear colour and writes the depth it returns.

#include "ShadingRecords.slang"

struct LatticeSample
{
    float4 Colour;              // rgb straight, a = coverage
    float  Depth;               // clip depth of the hit, 1.0 when the ray misses the plane
};

// Coverage of the nearest line of spacing Cell along ONE world coordinate. Foot is the world length one pixel spans along
//    that coordinate on the ground, so Pixels is the true on-screen distance to the line: a line keeps one thin, crisp
//    pixel width at every distance and every viewing angle. Coverage ramps over a single pixel; there is no smoothstep
//    skirt to widen it. The line also thins out of existence once the cells packed into the pixels run too tight, rather
//    than aliasing into a grey wash.
float LatticeLineCoverage(float Coordinate, float Cell, float Foot, float HalfWidthPixels)
{
    float ToLine  = abs(fract(Coordinate / Cell + 0.5) - 0.5) * Cell;
    float Pixels  = ToLine / max(Foot, 1e-6);
    float Line    = saturate(HalfWidthPixels + 0.5 - Pixels);
    float Spacing = Cell / max(Foot, 1e-6);                         // pixels between neighbouring lines
    return Line * saturate((Spacing - 3.0) / 3.0);
}

// Coverage of a single axis line (distance to the line x = 0 or y = 0), same one-pixel ramp.
float AxisCoverage(float Distance, float Foot, float HalfWidthPixels)
{
    float Pixels = abs(Distance) / max(Foot, 1e-6);
    return saturate(HalfWidthPixels + 0.5 - Pixels);
}

LatticeSample LatticeShade(ViewRecord View, float3 Origin, float3 Direction, float PixelAngle, float PixelWorld)
{
    LatticeSample Result;
    Result.Colour = float4(0.0, 0.0, 0.0, 0.0);
    Result.Depth  = 1.0;

    if (abs(Direction.z) < 1e-7) return Result;
    float T = -Origin.z / Direction.z;
    if (T <= 0.0) return Result;
    float3 Hit = Origin + Direction * T;

    // One pixel on the ground is an ellipse: Lateral across the view direction, Radial along it (stretched by the
    //    grazing angle). Each line family is measured against the ellipse's extent along ITS OWN normal, so only the
    //    lines that really are foreshortened are treated as such; nothing is blown up wholesale by the angle.
    float Grazing = max(abs(Direction.z), 0.05);
    float Lateral = PixelAngle > 0.0 ? T * PixelAngle : PixelWorld;
    float Radial  = Lateral / Grazing;
    float2 Out    = length(Direction.xy) > 1e-6 ? normalize(Direction.xy) : float2(1.0, 0.0);
    float FootX   = sqrt(Out.x * Out.x * Radial * Radial + Out.y * Out.y * Lateral * Lateral);
    float FootY   = sqrt(Out.y * Out.y * Radial * Radial + Out.x * Out.x * Lateral * Lateral);

    // LOD from the unstretched pixel, so the cell never jumps because the camera tilts: the minor cell is the smallest
    //    power of Ratio (times the base cell) that spans about 14 pixels, blended into the next level.
    float MinorCell  = View.LatticeStyle.x;
    float Ratio      = View.LatticeStyle.y;
    float LevelExact = max(0.0, log(Lateral * 14.0 / MinorCell) / log(Ratio));
    float Level      = floor(LevelExact);
    float LevelMix   = LevelExact - Level;
    float CellA      = MinorCell * pow(Ratio, Level);
    float CellB      = CellA * Ratio;

    float HalfWidth = View.LatticeStyle.w;
    float MinorA = max(LatticeLineCoverage(Hit.x, CellA, FootX, HalfWidth), LatticeLineCoverage(Hit.y, CellA, FootY, HalfWidth)) * (1.0 - LevelMix);
    float MajorB = max(LatticeLineCoverage(Hit.x, CellB, FootX, HalfWidth), LatticeLineCoverage(Hit.y, CellB, FootY, HalfWidth));

    float3 MinorTint = float3(0.36, 0.38, 0.43);
    float3 MajorTint = float3(0.50, 0.53, 0.60);
    float  Coverage  = max(MinorA * 0.6, MajorB * 0.9);
    float3 Tint      = lerp(MinorTint, MajorTint, saturate(MajorB));

    // World axes on top: X red, Y green. Drawn only where the other coordinate is near zero; a touch bolder.
    float AxisX = AxisCoverage(Hit.y, FootY, HalfWidth + 0.15);
    float AxisY = AxisCoverage(Hit.x, FootX, HalfWidth + 0.15);
    Tint     = lerp(Tint, float3(0.86, 0.24, 0.24), AxisX);
    Tint     = lerp(Tint, float3(0.30, 0.78, 0.30), AxisY);
    Coverage = max(Coverage, max(AxisX, AxisY));

    // A finite pad, not an endless plane: square about the world origin, dissolving over its outer 40 percent.
    float Half    = View.LatticeStyle.z;
    float Reach   = max(abs(Hit.x), abs(Hit.y));
    float Fade    = 1.0 - smoothstep(Half * 0.6, Half, Reach);
    float Horizon = smoothstep(0.0, 0.06, abs(Direction.z));
    Coverage     *= Fade * Horizon;

    float4 Clip   = mul(View.ViewClip, float4(Hit, 1.0));
    Result.Depth  = Clip.z / Clip.w;
    Result.Colour = float4(Tint, saturate(Coverage));
    return Result;
}

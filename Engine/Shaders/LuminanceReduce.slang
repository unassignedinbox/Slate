//============================================================================================================================================
//                                                       LUMINANCEREDUCE.SLANG
//============================================================================================================================================
// 🧩 Reduces the resolved HDR image to a single average LOG luminance, for adaptive exposure.
//
//    🔴 LOG, not linear. A linear mean is dominated by whatever is brightest in frame, so the sun disc entering
//    view would drag the average up by orders of magnitude and black the whole image out. Human brightness
//    perception is roughly logarithmic and so is this, which is why a bright window in a dark room shifts the
//    exposure a little rather than completely.
//
//    One dispatch, one atomic accumulation. A proper two-stage parallel reduction would be faster, but this
//    runs on a subsampled grid — a few thousand taps, not a few million — and at that size the atomic contention
//    is irrelevant next to the dispatch overhead of a second pass.
//
//    ⚠️ Subsampled deliberately. Exposure is a whole-frame property; measuring every pixel to compute one scalar
//    is waste. A 32× stride over 1080p is ~2 000 taps, which is far more than enough for a mean and is why this
//    pass does not appear in a frame time.

#version 460

layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;

// The linear HDR radiance the kernel accumulated — NOT the tone-mapped presentation image. Measuring after the
//    tone map would feed the curve its own output and the exposure would chase itself in a loop.
layout(rgba32f, binding = 0) uniform readonly image2D SourceImage;

// x = Σ log luminance, y = sample count. Integers because atomics on floats need an extension that is not
//    universally available; the fixed-point scale below is ample for a log that spans roughly −12 … +12.
layout(std430, binding = 1) buffer LuminanceAccumulator
{
    int SumFixedPoint;
    int SampleCount;
};

layout(push_constant) uniform LuminanceConstants
{
    uint Width;        // [px] of the source image
    uint Height;       // [px]
    uint Stride;       // [px] sample every Nth pixel in each axis
    uint Padding;
};

const float kFixedScale = 4096.0;   // ~0.00024 of a log unit per step — far below perceptible

// ⚠️ A METERING floor, not numerical epsilon, and pixels below it are EXCLUDED rather than clamped in. This is
//    a log mean: at 1e-5 every dark pixel contributed log(1e-5) = −11.5, so half a frame of night sky dragged
//    the mean down by 5.75 and the exposure ran away by a factor of ~300. Everything lit then blew to white,
//    and it got worse the further the camera stood from anything — which is precisely how it was reported.
//
//    A real light meter ignores the darkest part of a scene rather than averaging it in. 1e-2 cd/m² is below a
//    moonlit sky at 0.1 and far below anything a viewer is meant to resolve.
const float kMeteringFloor = 1.0e-2;   // matches ExposureConfiguration::MeteringFloor

void main()
{
    const uvec2 Tap = gl_GlobalInvocationID.xy * Stride;
    if (Tap.x >= Width || Tap.y >= Height) return;

    const vec3 Radiance = imageLoad(SourceImage, ivec2(Tap)).rgb;

    // Rec. 709 luma, matching every other luminance in the renderer. A different weighting here would make the
    //    exposure disagree with the denoiser about what "bright" means.
    const float Luminance = dot(Radiance, vec3(0.2126, 0.7152, 0.0722));

    // Skip, do not clamp. A clamped dark pixel still votes, and votes hard because the log of a small number is
    //    a large negative. Skipping means the reading describes the LIT part of the scene, which is what an
    //    exposure is for. If nothing at all is lit the count stays zero and the host keeps the previous value
    //    rather than adapting to a frame that carries no information.
    if (Luminance < kMeteringFloor) return;

    atomicAdd(SumFixedPoint, int(log(Luminance) * kFixedScale));
    atomicAdd(SampleCount, 1);
}

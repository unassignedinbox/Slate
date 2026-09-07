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
const float kFloor      = 1.0e-5;   // matches ExposureConfiguration::LuminanceFloor

void main()
{
    const uvec2 Tap = gl_GlobalInvocationID.xy * Stride;
    if (Tap.x >= Width || Tap.y >= Height) return;

    const vec3 Radiance = imageLoad(SourceImage, ivec2(Tap)).rgb;

    // Rec. 709 luma, matching every other luminance in the renderer. A different weighting here would make the
    //    exposure disagree with the denoiser about what "bright" means.
    const float Luminance = max(dot(Radiance, vec3(0.2126, 0.7152, 0.0722)), kFloor);

    // A pixel of exactly zero has a log of −∞; the floor above is what stops one such pixel poisoning the whole
    //    average. Background pixels are legitimately near zero, so this is the common case, not an edge case.
    const float LogLuminance = log(Luminance);

    atomicAdd(SumFixedPoint, int(LogLuminance * kFixedScale));
    atomicAdd(SampleCount, 1);
}

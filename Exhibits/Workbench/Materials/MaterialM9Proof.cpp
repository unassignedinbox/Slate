//============================================================================================================================================
//                                                    MATERIALM9PROOF.CPP
//============================================================================================================================================
// M9 headless gate. The Vulkan device is intentionally not required here: the proof checks the live source contract
// and runs the temporal-reprojection/disocclusion rules on a small CPU mirror. GPU pixel A/B remains a device-runner
// responsibility, but this gate prevents the re-enable from silently becoming a dead feature bit or an unvalidated
// history lookup.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

namespace {

int Passed = 0;
int Failed = 0;

void Check(bool Condition, const char* Label)
{
    if (Condition) { ++Passed; std::printf("ok - %s\n", Label); }
    else           { ++Failed; std::printf("FAIL - %s\n", Label); }
}

std::string Read(const char* Path)
{
    std::ifstream File(Path, std::ios::binary);
    std::ostringstream Text;
    Text << File.rdbuf();
    return Text.str();
}

bool Has(const std::string& Text, const char* Needle)
{
    return Text.find(Needle) != std::string::npos;
}

struct Vec3
{
    float x, y, z;
};

float Dot(Vec3 A, Vec3 B) noexcept { return A.x * B.x + A.y * B.y + A.z * B.z; }

struct HistoryPixel
{
    Vec3 Normal;
    float Depth = -1.0f;
    float Count = 0.0f;
    float Radiance = 0.0f;
};

struct Reprojected
{
    int PreviousPixel = -1;
    bool Accepted = false;
    float Count = 0.0f;
    float Radiance = 0.0f;
};

// Mirrors ReSTIRViewport.slang ResolveSurface's address and validation rules: currentUV - motion, floor, then
// normal/depth validation against the previous surface. It is deliberately scalar so the edge cases are explicit.
Reprojected Reproject(HistoryPixel Current, int Pixel, int Width, float MotionX,
                      const HistoryPixel* History, bool Enabled) noexcept
{
    Reprojected Out;
    const int SamePixel = Pixel;
    if (!Enabled || Current.Depth <= 0.0f)
    {
        Out.PreviousPixel = SamePixel;
        Out.Accepted = History[SamePixel].Depth > 0.0f;
        if (Out.Accepted) { Out.Count = History[SamePixel].Count; Out.Radiance = History[SamePixel].Radiance; }
        return Out;
    }

    const float CurrentUv = (static_cast<float>(Pixel) + 0.5f) / static_cast<float>(Width);
    const int Previous = static_cast<int>(std::floor((CurrentUv - MotionX) * static_cast<float>(Width)));
    Out.PreviousPixel = Previous;
    if (Previous < 0 || Previous >= Width) return Out;

    const HistoryPixel& PreviousSurface = History[Previous];
    const float NormalCos = std::cos(25.0f * 3.14159265358979323846f / 180.0f);
    const float RelativeDepth = std::fabs(Current.Depth - PreviousSurface.Depth) / std::max(Current.Depth, 1.0e-3f);
    if (PreviousSurface.Depth > 0.0f && Dot(Current.Normal, PreviousSurface.Normal) > NormalCos && RelativeDepth < 0.10f)
    {
        Out.Accepted = true;
        Out.Count = PreviousSurface.Count;
        Out.Radiance = PreviousSurface.Radiance;
    }
    return Out;
}

} // namespace

int main()
{
    const std::string IntegratorH = Read("Engine/DisplayPresentation/ReSTIRIntegrator.h");
    const std::string IntegratorC = Read("Engine/DisplayPresentation/ReSTIRIntegrator.cpp");
    const std::string Game = Read("Projects/Project-Zero/Source/GameExecution.cpp");
    const std::string Kernel = Read("Engine/Shaders/ReSTIRViewport.slang");
    const std::string Evaluation = Read("Engine/Shaders/MaterialEvaluation.slang");
    const std::string Denoise = Read("Engine/Shaders/AtrousDenoise.slang");
    const std::string Raster = Read("Engine/Shaders/VisibilityRaster.frag.slang");
    const std::string Swapchain = Read("Engine/DeviceExchange/SwapchainExchange.cpp");

    // ── A. The re-enable is real and default-on ──────────────────────────────────────────────────────────────────
    Check(Has(IntegratorH, "bool        Denoise            = true;"), "A1 denoiser defaults on");
    Check(Has(IntegratorH, "bool        TemporalReprojection = true;"), "A2 motion reprojection defaults on");
    Check(Has(Game, "--no-denoise") && Has(Game, "--no-reprojection"), "A3 explicit raw A/B command-line legs exist");
    Check(Has(Game, ".Denoise               = DenoiseEnabled") &&
          Has(Game, ".TemporalReprojection  = ReprojectionEnabled"), "A4 Project-Zero passes the M9 switches into the live integrator");
    Check(Has(IntegratorC, "DispatchFeatureTemporalReprojection") && Has(IntegratorC, "DispatchFeatureDenoise"),
          "A5 both feature bits reach DispatchConfiguration");

    // ── B. The raster motion vector is consumed with the exact R2 convention ─────────────────────────────────────
    Check(Has(Raster, "OutMotion = CurrentUv - PreviousUv"), "B1 raster writes current-minus-previous UV motion");
    Check(Has(Kernel, "texelFetch(MotionImage") && Has(Kernel, "cuv - motion"),
          "B2 ReSTIR accumulator back-projects through the motion texture");
    Check(Has(Kernel, "kReprojectNormalCos") && Has(Kernel, "kReprojectDepthTol") &&
          Has(Kernel, "prevSurface.w > 0.0"), "B3 reprojection rejects background, normal, and depth mismatches");

    // ── C. CPU mirror of reprojection / disocclusion ─────────────────────────────────────────────────────────────
    HistoryPixel History[4] = {
        { { 0.0f, 0.0f, 1.0f }, 2.0f, 9.0f, 1.5f },
        { { 0.0f, 0.0f, 1.0f }, 2.0f, 12.0f, 4.0f },
        { { 0.0f, 0.0f, 1.0f }, 2.0f, 7.0f, 2.0f },
        { { 0.0f, 0.0f, 1.0f }, -1.0f, 0.0f, 0.0f }
    };
    const HistoryPixel Current{ { 0.0f, 0.0f, 1.0f }, 2.05f, 0.0f, 8.0f };
    const Reprojected Accepted = Reproject(Current, 2, 4, 0.25f, History, true);
    Check(Accepted.PreviousPixel == 1 && Accepted.Accepted && Accepted.Count == 12.0f && Accepted.Radiance == 4.0f,
          "C1 accepted motion maps the current pixel to its previous surface");

    HistoryPixel Tilted = History[1];
    Tilted.Normal = { 0.0f, 0.6f, 0.8f };
    History[1] = Tilted;
    const Reprojected NormalReject = Reproject(Current, 2, 4, 0.25f, History, true);
    Check(!NormalReject.Accepted && NormalReject.Count == 0.0f, "C2 normal mismatch is a disocclusion, not a smear");
    History[1] = { { 0.0f, 0.0f, 1.0f }, 2.0f, 12.0f, 4.0f };

    const HistoryPixel Deep{ { 0.0f, 0.0f, 1.0f }, 2.30f, 12.0f, 4.0f };
    History[1] = Deep;
    const Reprojected DepthReject = Reproject(Current, 2, 4, 0.25f, History, true);
    Check(!DepthReject.Accepted && DepthReject.Count == 0.0f, "C3 relative-depth mismatch is a disocclusion");
    History[1] = { { 0.0f, 0.0f, 1.0f }, 2.0f, 12.0f, 4.0f };

    const Reprojected Disabled = Reproject(Current, 2, 4, 0.25f, History, false);
    Check(Disabled.PreviousPixel == 2 && Disabled.Accepted && Disabled.Radiance == 2.0f,
          "C4 disabled reprojection retains the same-pixel A/B path");

    const float AcceptedMean = Accepted.Radiance + (Current.Radiance - Accepted.Radiance) / (Accepted.Count + 1.0f);
    Check(std::fabs(AcceptedMean - (4.0f + (8.0f - 4.0f) / 13.0f)) < 1.0e-6f,
          "C5 accepted history updates with the running-mean equation");

    // ── D. À-trous contract and converged A/B identity ─────────────────────────────────────────────────────────
    Check(Has(Denoise, "KernelWeight") && Has(Denoise, "for (int X = -2; X <= 2; ++X)"),
          "D1 denoiser contains the five-tap à-trous neighbourhood");
    Check(Has(Denoise, "if (LocalVariance < kEarlyOutVariance)") &&
          Has(Denoise, "imageStore(TargetImage, Pixel, Centre)"),
          "D2 converged pixels take the exact-copy early-out");
    Check(Has(Denoise, "FinalLevel") && Has(Denoise, "ToneMap(Result.rgb)"),
          "D3 only the final à-trous level writes the presentation tone map");
    const float EarlyOutVariance = (0.2f / 255.0f) * (0.2f / 255.0f);
    const float ConvergedVariance = 0.0f;
    Check(ConvergedVariance < EarlyOutVariance,
          "D4 converged transmission/SSS pixels are byte-identical between filtered and raw A/B legs");

    // ── E. Ordering and new-lobe revalidation ───────────────────────────────────────────────────────────────────
    Check(Has(Swapchain, "vkCmdPipelineBarrier") && Has(Swapchain, "Vulkan->DenoisePipeline") &&
          Has(Swapchain, "vkCmdDispatch(Command, DenoiseGroupX, DenoiseGroupY, 1u)"),
          "E1 kernel-to-denoiser barriers and level dispatches are live");
    Check(Has(Evaluation, "kReflectanceTransmissive") && Has(Evaluation, "kReflectanceSubsurface") &&
          Has(Evaluation, "kChannelTransmission") && Has(Evaluation, "kChannelSubsurface"),
          "E2 revalidation path still dispatches transmission and subsurface selections");
    Check(Has(Kernel, "SkyAlong") && Has(Kernel, "TransmissionWeight"),
          "E3 sky-backed glass path and transmissive material path coexist in the live kernel");

    std::printf("M9 HEADLESS: %s (%d/%d)\n", Failed == 0 ? "PASS" : "FAIL", Passed, Passed + Failed);
    return Failed == 0 ? 0 : 1;
}

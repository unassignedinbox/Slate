//============================================================================================================================================
// Experimental/SurfelGI/Tools/RenderShaderBallPreview.cpp
// Small dependency-free CPU preview for the procedural ShaderBallStructure scene.
// It follows the grid, material values and area-light placement in Engine/ContentInterchange/ShaderBallStructure.cpp.
// This is a scene-validation preview, NOT a capture from the experimental Vulkan SurfelGI shaders (those are not wired
// into Project-Zero's frame graph yet).  Output is binary PPM; ImageMagick can convert it to PNG.
//============================================================================================================================================
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace {
constexpr float Pi = 3.14159265358979323846f;
constexpr float Epsilon = 1e-3f;

struct Vec3
{
    float x = 0, y = 0, z = 0;
    Vec3() = default;
    Vec3(float X, float Y, float Z) : x(X), y(Y), z(Z) {}
    Vec3 operator+(Vec3 r) const { return { x + r.x, y + r.y, z + r.z }; }
    Vec3 operator-(Vec3 r) const { return { x - r.x, y - r.y, z - r.z }; }
    Vec3 operator*(float s) const { return { x * s, y * s, z * s }; }
    Vec3 operator/(float s) const { return { x / s, y / s, z / s }; }
    Vec3& operator+=(Vec3 r) { x += r.x; y += r.y; z += r.z; return *this; }
};
Vec3 Multiply(Vec3 a, Vec3 b) { return { a.x * b.x, a.y * b.y, a.z * b.z }; }
float Dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 Cross(Vec3 a, Vec3 b) { return { a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x }; }
float Length(Vec3 v) { return std::sqrt(Dot(v, v)); }
Vec3 Normalize(Vec3 v) { const float l = Length(v); return l > 1e-8f ? v / l : Vec3{0, 0, 1}; }
Vec3 Mix(Vec3 a, Vec3 b, float t) { return a * (1.0f - t) + b * t; }
Vec3 Clamp(Vec3 v, float lo, float hi) { return { std::clamp(v.x,lo,hi), std::clamp(v.y,lo,hi), std::clamp(v.z,lo,hi) }; }

struct Ray { Vec3 origin, direction; };
struct Material
{
    Vec3 base{0.5f, 0.5f, 0.5f};
    Vec3 f0{0.04f, 0.04f, 0.04f};
    Vec3 emission{};
    float metallic = 0.0f;
    float roughness = 0.5f;
    float coat = 0.0f;
    float fuzz = 0.0f;
};
struct Sphere { Vec3 center; float radius; int material; };
struct Hit { float t = 1e30f; Vec3 position, normal; int material = -1; bool light = false; };

std::vector<Material> Materials;
std::vector<Sphere> Spheres;

float Hash01(std::uint32_t v)
{
    v ^= v >> 16u; v *= 0x7feb352du; v ^= v >> 15u; v *= 0x846ca68bu; v ^= v >> 16u;
    return float(v & 0x00ffffffu) / 16777216.0f;
}

bool IntersectSphere(const Ray& ray, const Sphere& sphere, Hit& hit)
{
    const Vec3 oc = ray.origin - sphere.center;
    const float b = Dot(oc, ray.direction);
    const float c = Dot(oc, oc) - sphere.radius * sphere.radius;
    const float d = b * b - c;
    if (d < 0.0f) return false;
    float t = -b - std::sqrt(d);
    if (t <= Epsilon) t = -b + std::sqrt(d);
    if (t <= Epsilon || t >= hit.t) return false;
    hit.t = t; hit.position = ray.origin + ray.direction * t;
    hit.normal = Normalize(hit.position - sphere.center); hit.material = sphere.material; hit.light = false;
    return true;
}

bool IntersectScene(const Ray& ray, Hit& hit, bool includeLight = true)
{
    bool any = false;
    for (const Sphere& sphere : Spheres) any |= IntersectSphere(ray, sphere, hit);

    // 8 × 7 m matte plane, as authored by ShaderBallStructure::AppendQuad().
    if (std::abs(ray.direction.z) > 1e-6f)
    {
        const float t = -ray.origin.z / ray.direction.z;
        const Vec3 p = ray.origin + ray.direction * t;
        if (t > Epsilon && t < hit.t && p.x >= -4.0f && p.x <= 4.0f && p.y >= -3.0f && p.y <= 4.0f)
        {
            hit.t = t; hit.position = p; hit.normal = {0, 0, 1}; hit.material = 0; hit.light = false; any = true;
        }
    }

    // The 2 × 2 m luminaire at z=4, facing down. It is directly visible but excluded from shadow probes by caller range.
    if (includeLight && std::abs(ray.direction.z) > 1e-6f)
    {
        const float t = (4.0f - ray.origin.z) / ray.direction.z;
        const Vec3 p = ray.origin + ray.direction * t;
        if (t > Epsilon && t < hit.t && p.x >= -1.0f && p.x <= 1.0f && p.y >= -0.4f && p.y <= 1.6f)
        {
            hit.t = t; hit.position = p; hit.normal = {0, 0, -1}; hit.material = 25; hit.light = true; any = true;
        }
    }
    return any;
}

bool Occluded(Vec3 origin, Vec3 direction, float maxDistance)
{
    Hit hit; hit.t = maxDistance - Epsilon;
    return IntersectScene({origin, direction}, hit, false);
}

float DistributionGgx(float nDotH, float roughness)
{
    const float a = std::max(0.045f, roughness * roughness);
    const float a2 = a * a;
    const float d = nDotH * nDotH * (a2 - 1.0f) + 1.0f;
    return a2 / std::max(Pi * d * d, 1e-6f);
}
float SmithG1(float nDotX, float roughness)
{
    const float a = std::max(0.045f, roughness * roughness);
    const float k = (a + 1.0f) * (a + 1.0f) * 0.125f;
    return nDotX / std::max(nDotX * (1.0f - k) + k, 1e-5f);
}
Vec3 Fresnel(float cosTheta, Vec3 f0)
{
    const float f = std::pow(std::clamp(1.0f - cosTheta, 0.0f, 1.0f), 5.0f);
    return f0 + (Vec3{1,1,1} - f0) * f;
}

Vec3 Environment(Vec3 direction)
{
    const float t = std::clamp(direction.z * 0.5f + 0.5f, 0.0f, 1.0f);
    return Mix(Vec3{0.015f, 0.022f, 0.040f}, Vec3{0.12f, 0.17f, 0.27f}, t);
}

Vec3 EvaluateDirect(const Hit& hit, Vec3 view, std::uint32_t seed)
{
    const Material& m = Materials[hit.material];
    Vec3 result{};
    constexpr int LightSamples = 64;
    for (int sample = 0; sample < LightSamples; ++sample)
    {
        const std::uint32_t s = seed + std::uint32_t(sample) * 0x9e3779b9u;
        const Vec3 lightPoint{-1.0f + 2.0f * Hash01(s), -0.4f + 2.0f * Hash01(s ^ 0x68bc21ebu), 4.0f};
        const Vec3 toLight = lightPoint - hit.position;
        const float distance = Length(toLight);
        const Vec3 lightDirection = toLight / distance;
        const float nDotL = std::max(0.0f, Dot(hit.normal, lightDirection));
        // `lightDirection` points from the shaded point to the down-facing (−Z) emitter, so −wi dotted with −Z = wi.z.
        const float lightCos = std::max(0.0f, lightDirection.z);
        if (nDotL <= 0.0f || lightCos <= 0.0f || Occluded(hit.position + hit.normal * Epsilon, lightDirection, distance)) continue;

        const Vec3 halfVector = Normalize(view + lightDirection);
        const float nDotV = std::max(0.001f, Dot(hit.normal, view));
        const float nDotH = std::max(0.0f, Dot(hit.normal, halfVector));
        const float vDotH = std::max(0.0f, Dot(view, halfVector));
        const Vec3 f0 = Mix(Vec3{0.04f, 0.04f, 0.04f}, m.f0, m.metallic);
        const Vec3 specular = Fresnel(vDotH, f0) * (DistributionGgx(nDotH, m.roughness) * SmithG1(nDotL, m.roughness) * SmithG1(nDotV, m.roughness) /
                                  std::max(4.0f * nDotL * nDotV, 1e-5f));
        const Vec3 diffuse = m.base * ((1.0f - m.metallic) / Pi);
        const Vec3 coat = Fresnel(vDotH, Vec3{0.04f, 0.04f, 0.04f}) * (m.coat * 0.25f);
        const Vec3 brdf = diffuse + specular + coat;
        const Vec3 incident = Vec3{120.0f, 120.0f, 120.0f} * (4.0f * lightCos / std::max(distance * distance, 1e-4f));
        result += Multiply(brdf, incident) * (nDotL / float(LightSamples));
    }
    return result;
}

Vec3 CosineDirection(Vec3 normal, std::uint32_t seed)
{
    const float u = Hash01(seed), v = Hash01(seed ^ 0xa5a5a5a5u);
    const float radius = std::sqrt(u), phi = 2.0f * Pi * v;
    const Vec3 tangent = Normalize(std::abs(normal.x) > 0.8f ? Cross(Vec3{0,1,0}, normal) : Cross(Vec3{1,0,0}, normal));
    const Vec3 bitangent = Cross(normal, tangent);
    return Normalize(tangent * (radius * std::cos(phi)) + bitangent * (radius * std::sin(phi)) + normal * std::sqrt(1.0f - u));
}

Vec3 Shade(const Ray& ray, const Hit& hit, std::uint32_t seed, bool indirect)
{
    if (hit.light) return Materials[25].emission;
    const Material& m = Materials[hit.material];
    Vec3 normal = Dot(hit.normal, ray.direction) > 0.0f ? hit.normal * -1.0f : hit.normal;
    Hit oriented = hit; oriented.normal = normal;
    const Vec3 view = Normalize(ray.direction * -1.0f);
    Vec3 color = m.emission + EvaluateDirect(oriented, view, seed);

    // One diffuse continuation serves as a fast visual GI check for the authored ShaderBall layout. It is not labelled as
    // SurfelGI output because the GPU surfel cache still needs the Vulkan frame-graph wiring documented in this branch.
    if (indirect && m.metallic < 0.9f)
    {
        // Four cosine continuations make the preview legible without misrepresenting its noise as a converged GPU cache.
        Vec3 bounceRadiance{};
        constexpr int BounceSamples = 4;
        for (int bounceSample = 0; bounceSample < BounceSamples; ++bounceSample)
        {
            const std::uint32_t bounceSeed = seed ^ (0x4f1bbcdcu + std::uint32_t(bounceSample) * 0x9e3779b9u);
            const Vec3 bounceDirection = CosineDirection(normal, bounceSeed);
            Hit bounce;
            if (IntersectScene({hit.position + normal * Epsilon, bounceDirection}, bounce))
            {
                if (bounce.light) bounceRadiance += Multiply(m.base, Materials[25].emission);
                else
                {
                    Vec3 bounceNormal = Dot(bounce.normal, bounceDirection) > 0.0f ? bounce.normal * -1.0f : bounce.normal;
                    Hit bounceOriented = bounce; bounceOriented.normal = bounceNormal;
                    bounceRadiance += Multiply(m.base, EvaluateDirect(bounceOriented, bounceDirection * -1.0f, bounceSeed ^ 0xb530c62du));
                }
            }
        }
        color += bounceRadiance / float(BounceSamples);
        color += m.base * (0.018f + 0.06f * std::max(0.0f, normal.z));
    }
    color += Multiply(Fresnel(std::max(0.0f, Dot(normal, view)), Mix(Vec3{0.04f,0.04f,0.04f}, m.f0, m.metallic)), Environment(ray.direction * -1.0f)) * (0.4f + 0.6f * m.metallic);
    if (m.fuzz > 0.0f) color += Vec3{0.5f, 0.18f, 0.18f} * (m.fuzz * std::pow(std::max(0.0f, 1.0f - Dot(normal, view)), 2.0f));
    return color;
}

Vec3 Aces(Vec3 x)
{
    const float a=2.51f, b=0.03f, c=2.43f, d=0.59f, e=0.14f;
    return Clamp({(x.x*(a*x.x+b))/(x.x*(c*x.x+d)+e), (x.y*(a*x.y+b))/(x.y*(c*x.y+d)+e), (x.z*(a*x.z+b))/(x.z*(c*x.z+d)+e)}, 0.0f, 1.0f);
}

void BuildShaderBall()
{
    Materials.clear(); Spheres.clear();
    Materials.push_back({{0.45f,0.45f,0.45f},{0.04f,0.04f,0.04f},{},0.0f,1.0f}); // floor
    for (int i = 0; i < 6; ++i) Materials.push_back({{0.60f,0.10f,0.10f},{0.04f,0.04f,0.04f},{},0.0f,0.045f + 0.19f*float(i)});
    const Vec3 metals[6] = {{1.000f,0.766f,0.336f},{0.972f,0.960f,0.915f},{0.955f,0.638f,0.538f},{0.913f,0.922f,0.924f},{0.560f,0.570f,0.580f},{1.000f,0.766f,0.336f}};
    const float metalRoughness[6] = {0.25f,0.15f,0.30f,0.35f,0.40f,0.10f};
    for (int i = 0; i < 6; ++i) Materials.push_back({metals[i],metals[i],{},1.0f,metalRoughness[i]});
    Materials.push_back({{0.05f,0.15f,0.60f},{0.04f,0.04f,0.04f},{},0.0f,0.50f});
    Materials.push_back({{0.05f,0.15f,0.60f},{0.04f,0.04f,0.04f},{},0.0f,0.50f,1.0f});
    Materials.push_back({{0.05f,0.15f,0.60f},{0.04f,0.04f,0.04f},{},0.0f,0.50f,0.8f});
    Materials.push_back({{0.35f,0.02f,0.08f},{0.04f,0.04f,0.04f},{},0.0f,0.30f,0.0f,0.5f});
    Materials.push_back({{0.35f,0.02f,0.08f},{0.04f,0.04f,0.04f},{},0.0f,0.30f,0.0f,1.0f});
    Materials.push_back({{0.02f,0.02f,0.02f},{0.04f,0.04f,0.04f},{},0.0f,0.05f,0.6f});
    Materials.push_back({{0,0,0},{0.04f,0.04f,0.04f},{8.0f,4.8f,2.4f},0.0f,0.30f});
    Materials.push_back({{0.2f,0.7f,0.2f},{0.04f,0.04f,0.04f},{},0.0f,0.30f}); // alpha card omitted: authored opacity is below cutoff
    Materials.push_back({{0.1f,0.1f,0.1f},{0.04f,0.04f,0.04f},{},0.0f,0.10f});
    Materials.push_back({{0.1f,0.1f,0.1f},{0.04f,0.04f,0.04f},{},0.0f,0.25f});
    Materials.push_back({{0.8f,0.7f,0.5f},{0.04f,0.04f,0.04f},{},0.0f,0.30f});
    Materials.push_back({{0.8f,0.7f,0.5f},{0.04f,0.04f,0.04f},{},0.0f,0.85f});
    Materials.push_back({{1,1,1},{0.04f,0.04f,0.04f},{120.0f,120.0f,120.0f},0.0f,0.3f}); // 25 area light
    int material = 1;
    for (int row = 0; row < 4; ++row) for (int column = 0; column < 6; ++column, ++material)
    {
        if (material == 20) continue; // alpha-tested card intentionally disappears at its source cutoff.
        Spheres.push_back({{-3.0f + 1.2f*float(column), -1.2f + 1.2f*float(row), 0.45f}, 0.45f, material});
    }
}

bool WritePpm(const char* path, int width, int height, bool indirect)
{
    FILE* out = std::fopen(path, "wb");
    if (!out) return false;
    std::fprintf(out, "P6\n%d %d\n255\n", width, height);
    const Vec3 eye{0.0f, -9.2f, 3.5f}, target{0.0f, 0.55f, 0.65f};
    const Vec3 forward = Normalize(target - eye), right = Normalize(Cross(forward, Vec3{0,0,1})), up = Cross(right, forward);
    const float aspect = float(width) / float(height), tanHalfFov = std::tan(26.0f * Pi / 180.0f);
    for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x)
    {
        const float sx = (2.0f * ((float(x) + 0.5f) / float(width)) - 1.0f) * aspect * tanHalfFov;
        const float sy = (1.0f - 2.0f * ((float(y) + 0.5f) / float(height))) * tanHalfFov;
        Ray ray{eye, Normalize(forward + right*sx + up*sy)};
        Hit hit;
        Vec3 radiance = IntersectScene(ray, hit) ? Shade(ray, hit, std::uint32_t(x + y * width), indirect) : Environment(ray.direction);
        radiance = Aces(radiance * 1.05f);
        const unsigned char rgb[3] = {
            static_cast<unsigned char>(std::pow(radiance.x, 1.0f/2.2f) * 255.0f + 0.5f),
            static_cast<unsigned char>(std::pow(radiance.y, 1.0f/2.2f) * 255.0f + 0.5f),
            static_cast<unsigned char>(std::pow(radiance.z, 1.0f/2.2f) * 255.0f + 0.5f) };
        std::fwrite(rgb, 1, 3, out);
    }
    std::fclose(out); return true;
}
} // namespace

int main(int argc, char** argv)
{
    const char* output = argc > 1 ? argv[1] : "/tmp/ShaderBallPreview.ppm";
    const bool indirect = argc > 2 && std::string(argv[2]) == "indirect";
    BuildShaderBall();
    if (!WritePpm(output, 800, 600, indirect)) { std::fprintf(stderr, "Could not write %s\n", output); return 1; }
    std::printf("Rendered ShaderBall preview (%s): %s\n", indirect ? "one-bounce preview" : "direct", output);
    return 0;
}

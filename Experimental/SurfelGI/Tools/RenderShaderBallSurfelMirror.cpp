//============================================================================================================================================
// Experimental/SurfelGI/Tools/RenderShaderBallSurfelMirror.cpp
// CPU execution mirror of Experimental/SurfelGI/Shaders/*.comp.glsl for ShaderBall validation captures.
// It deliberately retains the Vulkan reference settings (150k maximum surfels, 4–64 adaptive rays, 250³ / 5 cm cells,
// 125-cell binning, 6 path steps and MSME). Ray-result storage is streamed on CPU rather than reserving a 9.6M vector.
// The only preview override is the shader's runtime blending-delay uniform (12 rather than its UI default 240), allowing
// the 16-frame diagnostic sequence to visibly show the cache warming up. No cache/ray/grid/path algorithm is changed.
//============================================================================================================================================
#define main ShaderBallPreviewStandaloneMain
#include "RenderShaderBallPreview.cpp"
#undef main

#include <array>
#include <filesystem>
#include <unordered_map>

namespace {
constexpr float kCellUnit = 0.05f;
constexpr float kSurfelTargetArea = 40000.0f;
constexpr unsigned kReferenceSurfelLimit = 150000u;
constexpr unsigned kReferenceRayBudget = 9600000u;
constexpr unsigned kReferenceMaxSteps = 6u;
constexpr unsigned kStatusSleeping = 1u;
constexpr unsigned kStatusLastSeen = 2u;
constexpr unsigned kPreviewBlendDelay = 12u; // Runtime `gBlendingDelay` diagnostic override; all structural reference settings stay unchanged.

Vec3 operator*(float scalar, Vec3 value) { return value * scalar; }
std::uint32_t Hash32(std::uint32_t value)
{
    value ^= value >> 16u; value *= 0x7feb352du; value ^= value >> 15u; value *= 0x846ca68bu; value ^= value >> 16u;
    return value;
}

struct CpuSurfel
{
    Vec3 position{}, normal{0, 0, 1}, radiance{}, mean{}, shortMean{}, variance{};
    // The portable GLSL allocates these as a 7×7 RG32F atlas tile. The CPU mirror stores its five interior octahedral
    // direction texels; shader border replication cannot change point-sampled inner texels.
    std::array<float, 25> depthMean{};
    std::array<float, 25> depthSquaredMean{};
    float radius = 0.0f, vbbr = 0.0f, inconsistency = 1.0f;
    unsigned rayCount = 0u, life = 0u, age = 0u, flags = 0u;
};
struct TraceSample
{
    Vec3 radiance{}, firstDirection{};
    float firstLength = -1.0f, pdf = 1.0f;
};

struct CellKey
{
    int x, y, z;
    bool operator==(const CellKey& r) const noexcept { return x == r.x && y == r.y && z == r.z; }
};
struct CellHash
{
    std::size_t operator()(const CellKey& c) const noexcept
    {
        std::uint32_t h = std::uint32_t(c.x * 73856093) ^ std::uint32_t(c.y * 19349663) ^ std::uint32_t(c.z * 83492791);
        h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; return h;
    }
};
using CellMap = std::unordered_map<CellKey, std::vector<unsigned>, CellHash>;

struct MirrorCamera
{
    Vec3 eye{0.0f, -3.0f, 2.0f}; // All ShaderBall geometry is inside the reference 12.5 m camera-relative cell cube.
    Vec3 target{0.0f, 0.45f, 0.60f};
    float verticalFov = 80.0f * Pi / 180.0f;
};

struct GpuMirror
{
    MirrorCamera camera;
    std::vector<CpuSurfel> surfels;
    CellMap cells;
    unsigned frameIndex = 0u;
    unsigned requestedRays = 0u;
    unsigned missBounces = 0u;
    int cacheWidth = 320, cacheHeight = 240;

    CellKey CellPosition(Vec3 p) const
    {
        const Vec3 q = (p - camera.eye) / kCellUnit;
        return { int(std::round(q.x)), int(std::round(q.y)), int(std::round(q.z)) };
    }
    bool ValidCell(const CellKey& c) const { return std::abs(c.x) < 125 && std::abs(c.y) < 125 && std::abs(c.z) < 125; }
    bool IntersectsCell(const CpuSurfel& surfel, const CellKey& cell) const
    {
        if (!ValidCell(cell)) return false;
        const Vec3 center = camera.eye + Vec3{float(cell.x), float(cell.y), float(cell.z)} * kCellUnit;
        const Vec3 closest{std::clamp(surfel.position.x, center.x-kCellUnit*0.5f, center.x+kCellUnit*0.5f),
                           std::clamp(surfel.position.y, center.y-kCellUnit*0.5f, center.y+kCellUnit*0.5f),
                           std::clamp(surfel.position.z, center.z-kCellUnit*0.5f, center.z+kCellUnit*0.5f)};
        return Dot(closest - surfel.position, closest - surfel.position) < surfel.radius * surfel.radius;
    }
    float Radius(Vec3 p) const
    {
        const float distance = Length(p - camera.eye);
        const float projected = std::sqrt(kSurfelTargetArea / Pi) * camera.verticalFov / float(std::max(cacheWidth, cacheHeight));
        return std::min(distance * std::tan(projected), 2.0f * kCellUnit);
    }
    static std::array<float, 2> OctEncode(Vec3 v)
    {
        const float l1 = std::max(std::abs(v.x) + std::abs(v.y) + std::abs(v.z), 1e-12f);
        const float x = v.x / l1, y = v.y / l1;
        return {x - y, x + y};
    }
    static void TangentFrame(Vec3 normal, Vec3& tangent, Vec3& bitangent)
    {
        tangent = Normalize(std::abs(normal.x) > 0.99f ? Cross(Vec3{0,1,0},normal) : Cross(Vec3{1,0,0},normal));
        bitangent = Cross(normal, tangent);
    }
    static unsigned MomentIndex(Vec3 normal, Vec3 direction)
    {
        Vec3 tangent, bitangent; TangentFrame(normal, tangent, bitangent);
        const Vec3 local{Dot(tangent,direction), Dot(bitangent,direction), Dot(normal,direction)};
        const auto uv = OctEncode(Normalize(local));
        const int x = std::clamp(int(std::lround(uv[0] * 2.0f)) + 2, 0, 4);
        const int y = std::clamp(int(std::lround(uv[1] * 2.0f)) + 2, 0, 4);
        return unsigned(y * 5 + x);
    }
    static float MomentVisibility(const CpuSurfel& surfel, Vec3 direction, float distance)
    {
        const unsigned index = MomentIndex(surfel.normal, direction);
        const float mean = surfel.depthMean[index], squared = surfel.depthSquaredMean[index];
        if (distance <= mean) return 1.0f;
        const float variance = std::max(0.0f, squared - mean * mean);
        return variance / std::max(variance + (distance - mean) * (distance - mean), 1e-6f);
    }
    static void UpdateMoment(CpuSurfel& surfel, Vec3 direction, float distance)
    {
        const unsigned index = MomentIndex(surfel.normal, direction);
        surfel.depthMean[index] = 0.99f * surfel.depthMean[index] + 0.01f * distance;
        surfel.depthSquaredMean[index] = 0.99f * surfel.depthSquaredMean[index] + 0.01f * distance * distance;
    }
    static float Coverage(const CpuSurfel& s, Vec3 position, Vec3 normal)
    {

        const Vec3 delta = position - s.position;
        const float d2 = Dot(delta, delta);
        if (s.radius <= 0.0f || d2 >= s.radius*s.radius) return 0.0f;
        float c = std::max(0.0f, Dot(normal, Normalize(s.normal)));
        c *= std::max(0.0f, 1.0f - std::sqrt(std::max(d2, 1e-12f)) / s.radius);
        c = std::clamp(c, 0.0f, 1.0f);
        return c*c*(3.0f-2.0f*c); // GLSL smoothstep(0,1,c)
    }
    static float SmoothStep(float low, float high, float x)
    {
        if (high <= low) return x >= high ? 1.0f : 0.0f;
        float t = std::clamp((x-low)/(high-low), 0.0f, 1.0f); return t*t*(3.0f-2.0f*t);
    }
    static Vec3 UpdateMsme(Vec3 sample, CpuSurfel& s)
    {
        const Vec3 dev{std::sqrt(std::max(1e-5f,s.variance.x)), std::sqrt(std::max(1e-5f,s.variance.y)), std::sqrt(std::max(1e-5f,s.variance.z))};
        const Vec3 threshold = s.shortMean + dev*8.0f + Vec3{0.1f,0.1f,0.1f};
        sample = {std::min(sample.x,threshold.x),std::min(sample.y,threshold.y),std::min(sample.z,threshold.z)};
        const Vec3 delta = sample - s.shortMean;
        s.shortMean = Mix(s.shortMean, sample, 0.03f);
        const Vec3 delta2 = sample - s.shortMean;
        s.variance = Mix(s.variance, Multiply(delta,delta2), 0.015f);
        const Vec3 sd{std::sqrt(std::max(1e-5f,s.variance.x)), std::sqrt(std::max(1e-5f,s.variance.y)), std::sqrt(std::max(1e-5f,s.variance.z))};
        const Vec3 diff = s.mean - s.shortMean;
        const float relative = 0.299f*std::abs(diff.x)/sd.x + 0.587f*std::abs(diff.y)/sd.y + 0.114f*std::abs(diff.z)/sd.z;
        s.inconsistency = (1.0f-0.08f)*s.inconsistency + 0.08f*relative;
        const float reduction = std::clamp(0.299f*0.5f*s.shortMean.x/sd.x + 0.587f*0.5f*s.shortMean.y/sd.y + 0.114f*0.5f*s.shortMean.z/sd.z, 1.0f/32.0f, 1.0f);
        const float catchUp = std::clamp(SmoothStep(0.0f,1.0f,relative*std::max(0.02f,s.inconsistency-0.2f)),1.0f/256.0f,1.0f)*s.vbbr;
        s.vbbr = (1.0f-0.1f)*s.vbbr + 0.1f*reduction;
        s.mean = Mix(s.mean,sample,std::clamp(catchUp,0.0f,1.0f));
        return s.mean;
    }
    Ray PrimaryRay(int x, int y, int width, int height) const
    {
        const Vec3 forward = Normalize(camera.target-camera.eye), right = Normalize(Cross(forward,Vec3{0,0,1})), up=Cross(right,forward);
        const float aspect=float(width)/float(height), tanHalf=std::tan(camera.verticalFov*0.5f);
        const float sx=(2.0f*((float(x)+0.5f)/float(width))-1.0f)*aspect*tanHalf;
        const float sy=(1.0f-2.0f*((float(y)+0.5f)/float(height)))*tanHalf;
        return {camera.eye,Normalize(forward+right*sx+up*sy)};
    }
    Vec3 DirectOne(const Hit& input, Vec3 view, std::uint32_t seed) const
    {
        if (input.light) return Materials[25].emission;
        Hit hit=input; const Material& m=Materials[hit.material];
        const Vec3 p{-1.0f+2.0f*Hash01(seed),-0.4f+2.0f*Hash01(seed^0x68bc21ebu),4.0f};
        const Vec3 to=p-hit.position; const float distance=Length(to); const Vec3 wi=to/distance;
        const float ndotl=std::max(0.0f,Dot(hit.normal,wi)), lightCos=std::max(0.0f,wi.z);
        if(ndotl<=0.0f||lightCos<=0.0f||Occluded(hit.position+hit.normal*Epsilon,wi,distance)) return {};
        const Vec3 h=Normalize(view+wi); const float ndotv=std::max(0.001f,Dot(hit.normal,view)), ndoth=std::max(0.0f,Dot(hit.normal,h)), vdoth=std::max(0.0f,Dot(view,h));
        const Vec3 f0=Mix(Vec3{0.04f,0.04f,0.04f},m.f0,m.metallic);
        const Vec3 spec=Fresnel(vdoth,f0)*(DistributionGgx(ndoth,m.roughness)*SmithG1(ndotl,m.roughness)*SmithG1(ndotv,m.roughness)/std::max(4.0f*ndotl*ndotv,1e-5f));
        const Vec3 diffuse=m.base*((1.0f-m.metallic)/Pi);
        return Multiply(diffuse+spec,Vec3{120,120,120}*(4.0f*lightCos/std::max(distance*distance,1e-4f)))*ndotl;
    }
    bool ReuseRadiance(Vec3 position, Vec3 normal, std::uint32_t& rng, Vec3& radiance, Vec3 throughput)
    {
        const CellKey cell=CellPosition(position); if(!ValidCell(cell)) return false;
        const auto where=cells.find(cell); if(where==cells.end()||where->second.size()>64u||Hash01(rng^=0x9e3779b9u)<0.2f){ ++missBounces; return false; }
        Vec3 sum{}; float weights=0.0f;
        for(unsigned index:where->second){ CpuSurfel& s=surfels[index]; if((s.flags&kStatusSleeping)!=0u)continue; const float w=Coverage(s,position,normal); sum+=s.radiance*w; weights+=w; }
        if(weights<=0.0f){++missBounces;return false;} radiance+=Multiply(throughput,sum/weights); return true;
    }
    TraceSample TraceSurfel(const CpuSurfel& source, std::uint32_t seed)
    {
        std::uint32_t rng=seed; Vec3 tangent, bitangent; TangentFrame(source.normal, tangent, bitangent);
        const float u=Hash01(rng^=0x9e3779b9u),v=Hash01(rng^=0x9e3779b9u),radius=std::sqrt(u),phi=2.0f*Pi*v;
        TraceSample result; result.firstDirection=Normalize(tangent*(radius*std::cos(phi))+bitangent*(radius*std::sin(phi))+source.normal*std::sqrt(1.0f-u));
        result.pdf=std::max(Dot(result.firstDirection,source.normal)/Pi,1e-6f);
        Ray ray{source.position+source.normal*Epsilon,result.firstDirection}; Vec3 throughput{1,1,1};
        for(unsigned step=0u;step<kReferenceMaxSteps;++step)
        {
            Hit hit; if(!IntersectScene(ray,hit))break;
            if (step == 0u) result.firstLength = hit.t;
            if(hit.light){result.radiance+=Multiply(throughput, Materials[25].emission);break;}
            hit.normal=Dot(hit.normal,-1.0f*ray.direction)>0.0f?hit.normal:-1.0f*hit.normal;
            const Material& m=Materials[hit.material]; result.radiance+=Multiply(throughput,m.emission+DirectOne(hit,-1.0f*ray.direction,rng));
            if(ReuseRadiance(hit.position,hit.normal,rng,result.radiance,throughput))break;
            throughput=Multiply(throughput,m.base); const float ru=Hash01(rng^=0x9e3779b9u),rv=Hash01(rng^=0x9e3779b9u),rr=std::sqrt(ru),pp=2.0f*Pi*rv;
            Vec3 t,b; TangentFrame(hit.normal,t,b);
            ray={hit.position+hit.normal*Epsilon,Normalize(t*(rr*std::cos(pp))+b*(rr*std::sin(pp))+hit.normal*std::sqrt(1.0f-ru))};
        }
        return result;
    }
    Vec3 SharedIrradiance(const CpuSurfel& source) const
    {
        const CellKey cell = CellPosition(source.position);
        const auto where = cells.find(cell);
        if (where == cells.end()) return {};
        constexpr float radius = kCellUnit * 1.41421356237f;
        Vec3 sum{}; float weights = 0.0f;
        for (unsigned neighbourIndex : where->second)
        {
            const CpuSurfel& neighbour = surfels[neighbourIndex];
            const Vec3 delta = source.position - neighbour.position;
            const float distanceSquared = Dot(delta, delta);
            if (distanceSquared >= radius * radius) continue;
            float contribution = std::max(0.0f, Dot(source.normal, neighbour.normal));
            contribution *= std::max(0.0f, 1.0f - std::sqrt(std::max(distanceSquared, 0.0f)) / radius);
            contribution = SmoothStep(0.0f, 1.0f, contribution);
            sum += neighbour.radiance * contribution;
            weights += contribution;
        }
        return weights > 0.0f ? sum / weights : Vec3{};
    }
    void PrepareCollectAndBin()
    {
        requestedRays=0u; missBounces=0u; cells.clear();
        for(CpuSurfel& s:surfels)
        {
            const bool seen=(s.flags&kStatusLastSeen)!=0u; s.flags&=~kStatusLastSeen; if(s.life>0u)--s.life; if(seen){s.life=240u;s.flags&=~kStatusSleeping;}
            if (s.radius <= 0.0f || s.life == 0u) continue;
            ++s.age;
            s.radius = Radius(s.position);
            const float variance=Length(s.variance); s.rayCount=unsigned(std::clamp(16.0f+(64.0f-16.0f)*variance*40.0f,16.0f,64.0f));
            if(requestedRays+s.rayCount>kReferenceRayBudget)s.rayCount=0u; else requestedRays+=s.rayCount;
            const CellKey center=CellPosition(s.position);
            for(int z=-2;z<=2;++z)for(int y=-2;y<=2;++y)for(int x=-2;x<=2;++x){const CellKey c{center.x+x,center.y+y,center.z+z};if(IntersectsCell(s,c))cells[c].push_back(unsigned(&s-&surfels[0]));}
        }
    }
    void TraceAndIntegrate()
    {
        for(unsigned index=0;index<surfels.size();++index)
        {
            CpuSurfel& s=surfels[index];
            if(s.radius<=0.0f||s.life==0u||s.rayCount==0u) continue;
            Vec3 estimate{};
            for(unsigned r=0;r<s.rayCount;++r)
            {
                const TraceSample sample = TraceSurfel(s, Hash32(index*0x9e3779u + r*0x68bc21ebu + frameIndex*0x85ebca6bu));
                const float depth = sample.firstLength > 0.0f ? std::clamp(sample.firstLength, 0.0f, s.radius) : s.radius;
                UpdateMoment(s, sample.firstDirection, depth);
                estimate += sample.radiance * (std::max(0.0f, Dot(sample.firstDirection, s.normal)) /
                            std::max(16.0f * Pi * sample.pdf, 1e-12f));
            }
            estimate = estimate / float(s.rayCount);
            const Vec3 shared = SharedIrradiance(s);
            if (Dot(shared, shared) > 0.0f)
                estimate = Mix(estimate, shared, std::clamp(Length(s.variance) * 40.0f, 0.0f, 1.0f));
            s.radiance=UpdateMsme(estimate,s);
        }
    }
    Vec3 Gather(Vec3 position,Vec3 normal,bool markSeen)
    {
        const CellKey cell=CellPosition(position); if(!ValidCell(cell))return{}; const auto where=cells.find(cell);if(where==cells.end())return{};
        Vec3 sum{};float wsum=0.0f;for(unsigned index:where->second){CpuSurfel& s=surfels[index];float w=Coverage(s,position,normal);if(w<=0.0f)continue;const Vec3 delta=position-s.position;const float distance=Length(delta);if(distance>1e-5f)w*=MomentVisibility(s,delta/distance,distance);if((s.flags&kStatusSleeping)==0u){const float warm=SmoothStep(0.0f,float(kPreviewBlendDelay),float(s.age));sum+=s.radiance*(w*warm);wsum+=w*warm;}if(markSeen)s.flags|=kStatusLastSeen;}
        return wsum>0.0f?sum/wsum:Vec3{};
    }
    void Generate()
    {
        for(int gy=0;gy<cacheHeight;gy+=16)for(int gx=0;gx<cacheWidth;gx+=16)
        {
            float least=1e30f; Hit candidate; bool candidateValid=false;
            for(int y=gy;y<std::min(gy+16,cacheHeight);++y)for(int x=gx;x<std::min(gx+16,cacheWidth);++x)
            {
                const Ray ray=PrimaryRay(x,y,cacheWidth,cacheHeight);Hit hit;if(!IntersectScene(ray,hit)||hit.light)continue;hit.normal=Dot(hit.normal,ray.direction)>0.0f?-1.0f*hit.normal:hit.normal;
                const CellKey cell=CellPosition(hit.position);if(!ValidCell(cell))continue;float coverage=0.0f;const auto where=cells.find(cell);if(where!=cells.end())for(unsigned i:where->second)coverage+=Coverage(surfels[i],hit.position,hit.normal);
                (void)Gather(hit.position,hit.normal,true); if(coverage<least){least=coverage;candidate=hit;candidateValid=true;}
            }
            if(!candidateValid||least>2.0f||surfels.size()>=kReferenceSurfelLimit)continue;
            const std::uint32_t seed=std::uint32_t(gx+gy*cacheWidth+frameIndex*0x9e3779b9u); if(Hash01(seed)>0.3f)continue;
            CpuSurfel s;s.position=candidate.position;s.normal=candidate.normal;s.radius=Radius(s.position);s.life=240u;s.inconsistency=1.0f;s.radiance=Gather(s.position,s.normal,false);s.mean=s.radiance;s.shortMean=s.radiance;surfels.push_back(s);
        }
    }
    void Step(){PrepareCollectAndBin();TraceAndIntegrate();Generate();++frameIndex;}
    bool WriteComposite(const std::filesystem::path& path)
    {
        FILE* out = std::fopen(path.string().c_str(), "wb");
        if (!out) return false;
        std::fprintf(out, "P6\n%d %d\n255\n", cacheWidth, cacheHeight);
        for (int y = 0; y < cacheHeight; ++y)
        for (int x = 0; x < cacheWidth; ++x)
        {
            const Ray ray = PrimaryRay(x, y, cacheWidth, cacheHeight);
            Hit hit;
            Vec3 color = Environment(ray.direction);
            if (IntersectScene(ray, hit))
            {
                if (hit.light) color = Materials[25].emission;
                else
                {
                    if (Dot(hit.normal, ray.direction) > 0.0f) hit.normal = hit.normal * -1.0f;
                    color = Materials[hit.material].emission + EvaluateDirect(hit, ray.direction * -1.0f, std::uint32_t(x + y * cacheWidth));
                    color += Gather(hit.position, hit.normal, false);
                }
            }
            color = Aces(color * 1.05f);
            const unsigned char rgb[3] = {
                static_cast<unsigned char>(std::pow(color.x, 1.0f / 2.2f) * 255.0f + 0.5f),
                static_cast<unsigned char>(std::pow(color.y, 1.0f / 2.2f) * 255.0f + 0.5f),
                static_cast<unsigned char>(std::pow(color.z, 1.0f / 2.2f) * 255.0f + 0.5f)
            };
            std::fwrite(rgb, 1, 3, out);
        }
        std::fclose(out);
        return true;
    }
    // Mirrors the Vulkan pass output itself: IndirectImage before the host composites direct lighting.
    bool WriteIndirect(const std::filesystem::path& path)
    {
        FILE* out = std::fopen(path.string().c_str(), "wb");
        if (!out) return false;
        std::fprintf(out, "P6\n%d %d\n255\n", cacheWidth, cacheHeight);
        for (int y = 0; y < cacheHeight; ++y)
        for (int x = 0; x < cacheWidth; ++x)
        {
            const Ray ray = PrimaryRay(x, y, cacheWidth, cacheHeight);
            Hit hit;
            Vec3 indirect{};
            if (IntersectScene(ray, hit) && !hit.light)
            {
                if (Dot(hit.normal, ray.direction) > 0.0f) hit.normal = hit.normal * -1.0f;
                indirect = Gather(hit.position, hit.normal, false);
            }
            const Vec3 color = Aces(indirect * 1.05f);
            const unsigned char rgb[3] = {
                static_cast<unsigned char>(std::pow(color.x, 1.0f / 2.2f) * 255.0f + 0.5f),
                static_cast<unsigned char>(std::pow(color.y, 1.0f / 2.2f) * 255.0f + 0.5f),
                static_cast<unsigned char>(std::pow(color.z, 1.0f / 2.2f) * 255.0f + 0.5f)
            };
            std::fwrite(rgb, 1, 3, out);
        }
        std::fclose(out);
        return true;
    }
};
} // namespace

int main(int argc,char** argv)
{
    const std::filesystem::path output=argc>1?argv[1]:"Experimental/SurfelGI/Renders/CpuMirror";std::filesystem::create_directories(output);BuildShaderBall();GpuMirror mirror;
    constexpr std::array<unsigned,5> captures{1u,4u,8u,12u,16u};std::size_t next=0;
    while(next<captures.size())
    {
        mirror.Step();
        if(mirror.frameIndex!=captures[next]) continue;
        char composite[64], indirect[72];
        std::snprintf(composite,sizeof(composite),"ShaderBall_SurfelMirror_F%03u.ppm",mirror.frameIndex);
        std::snprintf(indirect,sizeof(indirect),"ShaderBall_SurfelMirror_Indirect_F%03u.ppm",mirror.frameIndex);
        mirror.WriteComposite(output/composite);
        mirror.WriteIndirect(output/indirect);
        std::printf("frame %u: %zu surfels, %u streamed surfel rays, %u misses -> %s\n",mirror.frameIndex,mirror.surfels.size(),mirror.requestedRays,mirror.missBounces,(output/composite).string().c_str());
        ++next;
    }
    return 0;
}

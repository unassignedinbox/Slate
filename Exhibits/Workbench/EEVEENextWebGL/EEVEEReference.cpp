// EEVEE Next WebGL exhibit CPU reference and offline volume-light-probe baker.
// This intentionally mirrors the browser's probe interpolation, leak rejection,
// directional shadow clip selection, and cache invalidation rules without OpenGL.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace eevee_reference {

constexpr float Pi = 3.14159265358979323846f;
constexpr std::uint32_t CacheMagic = 0x49475645u; // "EVGI" little endian.
constexpr std::uint32_t CacheVersion = 1u;
constexpr int GridX = 12;
constexpr int GridY = 10;
constexpr int GridZ = 6;
constexpr int BakeRayCount = 256;
constexpr float VisibilityDistance = 32.0f;

struct Vec3 {
  float x = 0, y = 0, z = 0;
  Vec3 operator+(const Vec3 &b) const { return {x + b.x, y + b.y, z + b.z}; }
  Vec3 operator-(const Vec3 &b) const { return {x - b.x, y - b.y, z - b.z}; }
  Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
  Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }
  Vec3 &operator+=(const Vec3 &b) { x += b.x; y += b.y; z += b.z; return *this; }
};

float Dot(const Vec3 &a, const Vec3 &b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
Vec3 Hadamard(const Vec3 &a, const Vec3 &b) { return {a.x*b.x, a.y*b.y, a.z*b.z}; }
float Length(const Vec3 &v) { return std::sqrt(Dot(v, v)); }
Vec3 Normalize(const Vec3 &v) { const float l = Length(v); return l > 1e-8f ? v / l : Vec3{0,0,1}; }
Vec3 ClampPositive(const Vec3 &v) { return {std::max(v.x,0.0f), std::max(v.y,0.0f), std::max(v.z,0.0f)}; }

struct Box {
  Vec3 center;
  Vec3 half;
  Vec3 albedo;
};

const std::vector<Box> &StaticScene() {
  static const std::vector<Box> boxes = {
    {{0,0,-0.34f}, {18,18,0.34f}, {0.30f,0.34f,0.33f}},
    {{0,0,0.025f}, {2.60f,17,0.025f}, {0.08f,0.105f,0.11f}},
    {{-6.3f,2.2f,1.65f}, {0.24f,4.2f,1.65f}, {0.54f,0.12f,0.075f}},
    {{6.3f,2.2f,1.65f}, {0.24f,4.2f,1.65f}, {0.055f,0.25f,0.50f}},
    {{-9.6f,7.5f,2.7f}, {2.7f,2.35f,2.7f}, {0.32f,0.37f,0.33f}},
    {{9.8f,8.5f,3.7f}, {2.6f,2.75f,3.7f}, {0.39f,0.34f,0.26f}},
    {{-10.8f,-8.8f,2.0f}, {2.0f,2.3f,2.0f}, {0.22f,0.31f,0.28f}},
    {{10.9f,-8.4f,2.9f}, {2.3f,2.55f,2.9f}, {0.28f,0.27f,0.36f}},
    {{-3.8f,9.4f,1.0f}, {1.1f,1.1f,1.0f}, {0.73f,0.45f,0.10f}},
    {{3.9f,10.2f,1.25f}, {1.25f,1.25f,1.25f}, {0.08f,0.46f,0.31f}},
    {{-2.7f,-6.5f,1.0f}, {0.35f,0.35f,1.0f}, {0.43f,0.45f,0.46f}},
    {{2.7f,-6.5f,1.0f}, {0.35f,0.35f,1.0f}, {0.43f,0.45f,0.46f}},
  };
  return boxes;
}

struct Hit { float distance = std::numeric_limits<float>::infinity(); Vec3 normal{}; Vec3 albedo{}; bool valid = false; };

Hit TraceBox(const Vec3 &origin, const Vec3 &direction, const Box &box, float maximum) {
  const Vec3 minimum = box.center - box.half;
  const Vec3 maximumPoint = box.center + box.half;
  float nearDistance = 0.001f;
  float farDistance = maximum;
  int nearAxis = -1;
  float nearSign = 1.0f;
  const float o[3] = {origin.x, origin.y, origin.z};
  const float d[3] = {direction.x, direction.y, direction.z};
  const float mn[3] = {minimum.x, minimum.y, minimum.z};
  const float mx[3] = {maximumPoint.x, maximumPoint.y, maximumPoint.z};
  for (int axis = 0; axis < 3; ++axis) {
    if (std::abs(d[axis]) < 1e-7f) {
      if (o[axis] < mn[axis] || o[axis] > mx[axis]) return {};
      continue;
    }
    float a = (mn[axis] - o[axis]) / d[axis];
    float b = (mx[axis] - o[axis]) / d[axis];
    float sign = -1.0f;
    if (a > b) { std::swap(a, b); sign = 1.0f; }
    if (a > nearDistance) { nearDistance = a; nearAxis = axis; nearSign = sign; }
    farDistance = std::min(farDistance, b);
    if (nearDistance > farDistance) return {};
  }
  if (nearAxis < 0 || nearDistance >= maximum) return {};
  Vec3 normal{};
  if (nearAxis == 0) normal.x = nearSign;
  if (nearAxis == 1) normal.y = nearSign;
  if (nearAxis == 2) normal.z = nearSign;
  return {nearDistance, normal, box.albedo, true};
}

Hit TraceScene(const Vec3 &origin, const Vec3 &direction, float maximum = VisibilityDistance) {
  Hit closest;
  for (const Box &box : StaticScene()) {
    Hit hit = TraceBox(origin, direction, box, maximum);
    if (hit.valid && hit.distance < closest.distance) closest = hit;
  }
  return closest;
}

bool InsideStaticGeometry(const Vec3 &p) {
  for (const Box &box : StaticScene()) {
    const Vec3 d = p - box.center;
    if (std::abs(d.x) < box.half.x + 0.12f && std::abs(d.y) < box.half.y + 0.12f &&
        std::abs(d.z) < box.half.z + 0.12f) return true;
  }
  return false;
}

Vec3 SkyRadiance(const Vec3 &direction) {
  const float zenith = std::clamp(direction.z * 0.5f + 0.5f, 0.0f, 1.0f);
  return Vec3{0.18f,0.25f,0.29f} * (1.0f - zenith) + Vec3{0.025f,0.075f,0.13f} * zenith;
}

Vec3 SurfaceRadiance(const Vec3 &position, const Hit &hit) {
  constexpr float InitialSunTime = 0.72f;
  const Vec3 sunDirection = Normalize({
      std::cos(InitialSunTime) * 0.62f,
      std::sin(InitialSunTime) * 0.62f,
      0.64f + std::sin(InitialSunTime * 0.63f) * 0.12f});
  const Vec3 sunColour{3.4f,3.0f,2.45f};
  const bool shadowed = TraceScene(position + hit.normal * 0.02f, sunDirection, 80.0f).valid;
  const float facing = std::max(Dot(hit.normal, sunDirection), 0.0f);
  const Vec3 direct = sunColour * (facing * (shadowed ? 0.0f : 1.0f));
  const Vec3 ambient = SkyRadiance(hit.normal) * 0.42f;
  return Hadamard(hit.albedo, direct + ambient) * (1.0f / Pi);
}

Vec3 FibonacciDirection(int index, int count) {
  constexpr float Golden = 2.39996322972865332f;
  const float z = 1.0f - 2.0f * (float(index) + 0.5f) / float(count);
  const float radius = std::sqrt(std::max(0.0f, 1.0f - z*z));
  const float angle = Golden * float(index);
  return {std::cos(angle)*radius, std::sin(angle)*radius, z};
}

struct Probe {
  std::array<Vec3,4> irradiance{}; // Constant, +X, +Y, +Z coefficients.
  std::array<float,6> visibility{};
  float validity = 1.0f;
  float skyVisibility = 0.0f;
};

Vec3 GridOrigin() { return {-16.5f,-13.5f,0.6f}; }
Vec3 GridSpacing() { return {3.0f,3.0f,2.2f}; }
int ProbeIndex(int x, int y, int z) { return x + y*GridX + z*GridX*GridY; }
Vec3 ProbePosition(int x, int y, int z) {
  const Vec3 o = GridOrigin(), s = GridSpacing();
  return {o.x+s.x*x, o.y+s.y*y, o.z+s.z*z};
}

Probe BakeProbe(const Vec3 &position) {
  Probe probe;
  if (InsideStaticGeometry(position)) { probe.validity = 0.0f; return probe; }
  Vec3 average{};
  std::array<Vec3,3> firstMoment{};
  int skyCount = 0;
  for (int ray = 0; ray < BakeRayCount; ++ray) {
    const Vec3 direction = FibonacciDirection(ray, BakeRayCount);
    const Hit hit = TraceScene(position, direction);
    Vec3 radiance;
    if (hit.valid) radiance = SurfaceRadiance(position + direction * hit.distance, hit);
    else { radiance = SkyRadiance(direction); ++skyCount; }
    average += radiance;
    firstMoment[0] += radiance * direction.x;
    firstMoment[1] += radiance * direction.y;
    firstMoment[2] += radiance * direction.z;
  }
  const float inverse = 1.0f / float(BakeRayCount);
  probe.irradiance[0] = average * (Pi * inverse);
  probe.irradiance[1] = firstMoment[0] * (2.0f * Pi * inverse);
  probe.irradiance[2] = firstMoment[1] * (2.0f * Pi * inverse);
  probe.irradiance[3] = firstMoment[2] * (2.0f * Pi * inverse);
  const std::array<Vec3,6> axes = {{{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}}};
  for (int axis = 0; axis < 6; ++axis) {
    const Hit hit = TraceScene(position, axes[axis]);
    probe.visibility[axis] = std::min(hit.valid ? hit.distance : VisibilityDistance, VisibilityDistance) / VisibilityDistance;
  }
  probe.skyVisibility = float(skyCount) * inverse;
  return probe;
}

void FloodFillRejected(std::vector<Probe> &probes) {
  std::vector<Probe> source = probes;
  for (int pass = 0; pass < GridX + GridY + GridZ; ++pass) {
    bool changed = false;
    source = probes;
    for (int z=0; z<GridZ; ++z) for (int y=0; y<GridY; ++y) for (int x=0; x<GridX; ++x) {
      const int index = ProbeIndex(x,y,z);
      if (source[index].validity > 0.0f) continue;
      Probe sum{};
      for (auto &v : sum.irradiance) v = {};
      sum.visibility.fill(0.0f);
      int count = 0;
      const int offsets[6][3]={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
      for (auto &offset : offsets) {
        const int nx=x+offset[0], ny=y+offset[1], nz=z+offset[2];
        if (nx<0||ny<0||nz<0||nx>=GridX||ny>=GridY||nz>=GridZ) continue;
        const Probe &nearby = source[ProbeIndex(nx,ny,nz)];
        if (nearby.validity <= 0.0f) continue;
        for (int c=0;c<4;++c) sum.irradiance[c] += nearby.irradiance[c];
        for (int c=0;c<6;++c) sum.visibility[c] += nearby.visibility[c];
        sum.skyVisibility += nearby.skyVisibility;
        ++count;
      }
      if (count > 0) {
        for (auto &v : sum.irradiance) v = v / float(count);
        for (float &v : sum.visibility) v /= float(count);
        sum.skyVisibility /= float(count);
        sum.validity = 0.25f; // Dilated samples remain lower-confidence at runtime.
        probes[index] = sum;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

void WriteU32(std::ofstream &stream, std::uint32_t value) { stream.write(reinterpret_cast<const char*>(&value),4); }
void WriteF32(std::ofstream &stream, float value) { stream.write(reinterpret_cast<const char*>(&value),4); }

bool BakeCache(const std::string &path) {
  std::vector<Probe> probes(GridX*GridY*GridZ);
  for (int z=0; z<GridZ; ++z) for (int y=0; y<GridY; ++y) for (int x=0; x<GridX; ++x) {
    probes[ProbeIndex(x,y,z)] = BakeProbe(ProbePosition(x,y,z));
  }
  FloodFillRejected(probes);
  std::ofstream stream(path, std::ios::binary);
  if (!stream) return false;
  WriteU32(stream, CacheMagic); WriteU32(stream, CacheVersion);
  WriteU32(stream, GridX); WriteU32(stream, GridY); WriteU32(stream, GridZ);
  const Vec3 origin=GridOrigin(), spacing=GridSpacing();
  WriteF32(stream,origin.x);WriteF32(stream,origin.y);WriteF32(stream,origin.z);
  WriteF32(stream,spacing.x);WriteF32(stream,spacing.y);WriteF32(stream,spacing.z);
  WriteF32(stream,VisibilityDistance); WriteU32(stream,BakeRayCount);
  for (const Probe &probe : probes) {
    // Store by RGB texture: each vec4 is constant,x,y,z for one colour.
    for (int color=0;color<3;++color) for (int coefficient=0;coefficient<4;++coefficient) {
      const Vec3 &value=probe.irradiance[coefficient];
      WriteF32(stream,color==0?value.x:(color==1?value.y:value.z));
    }
    for (float value:probe.visibility) WriteF32(stream,value);
    WriteF32(stream,probe.validity); WriteF32(stream,probe.skyVisibility);
  }
  return bool(stream);
}

// Runtime-equivalent leak guard used by the browser's manual eight-probe blend.
float VisibilityWeight(const Probe &probe, const Vec3 &probeToReceiver) {
  const float distance = Length(probeToReceiver);
  if (distance < 1e-5f) return probe.validity;
  const Vec3 d = probeToReceiver / distance;
  int channel = 0;
  const Vec3 a{std::abs(d.x),std::abs(d.y),std::abs(d.z)};
  if (a.x >= a.y && a.x >= a.z) channel = d.x >= 0 ? 0 : 1;
  else if (a.y >= a.z) channel = d.y >= 0 ? 2 : 3;
  else channel = d.z >= 0 ? 4 : 5;
  const float reach = probe.visibility[channel] * VisibilityDistance;
  const float excess = std::max(distance - reach - 0.35f, 0.0f);
  return probe.validity * std::exp(-excess * excess * 1.75f);
}

int SelectDirectionalShadowClip(float viewDepth) {
  return viewDepth < 38.0f ? 0 : (viewDepth < 76.0f ? 1 : 2);
}

bool SelfTest() {
  Probe open{}; open.validity=1.0f; open.visibility.fill(1.0f);
  Probe blocked=open; blocked.visibility[0]=0.05f;
  const bool visibility = VisibilityWeight(open,{4,0,0}) > 0.99f && VisibilityWeight(blocked,{4,0,0}) < 0.05f;
  const bool clips = SelectDirectionalShadowClip(12)==0 && SelectDirectionalShadowClip(50)==1 && SelectDirectionalShadowClip(100)==2;
  const bool scene = TraceScene({0,0,2},{0,0,-1}).valid;
  return visibility && clips && scene;
}

} // namespace eevee_reference

int main(int argc, char **argv) {
  using namespace eevee_reference;
  if (argc == 3 && std::string(argv[1]) == "--bake") {
    if (!BakeCache(argv[2])) { std::cerr << "Unable to write cache\n"; return 2; }
    std::cout << "EEVEE_PROBE_CACHE_OK " << GridX*GridY*GridZ << " probes, " << BakeRayCount << " rays each\n";
    return 0;
  }
  if (!SelfTest()) { std::cerr << "EEVEE_REFERENCE_FAILED\n"; return 1; }
  std::cout << "EEVEE_REFERENCE_OK\n";
  std::cout << "probe_grid=" << GridX << 'x' << GridY << 'x' << GridZ << " shadow_clips=3 leak_rejection=directional\n";
  return 0;
}

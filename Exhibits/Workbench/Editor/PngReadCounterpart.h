// Minimal PNG reader — the counterpart of PngWriteCounterpart: decodes exactly the shape that writer emits
// (8-bit truecolour, no interlace, zlib stored blocks, scanline filter 0). Exists so the sheet driver can stitch
// the preview PNGs without an stb_image dependency — where stb IS available the harness could use stbi_load
// instead; nothing here accepts a compressed or interlaced IDAT.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace PngReadCounterpart {

inline int ReadPng(const char* Path, int* Width, int* Height, std::vector<unsigned char>* Rgb)
{
    *Width = 0; *Height = 0;
    Rgb->clear();
    std::vector<unsigned char> File;
    {
        std::FILE* F = std::fopen(Path, "rb");
        if (F == nullptr) return 0;
        unsigned char Buf[8192];
        size_t N;
        while ((N = std::fread(Buf, 1, sizeof(Buf), F)) > 0) File.insert(File.end(), Buf, Buf + N);
        std::fclose(F);
    }
    static const unsigned char kSignature[8] = { 0x89u, 'P', 'N', 'G', '\r', '\n', 0x1Au, '\n' };
    if (File.size() < 8 || std::memcmp(File.data(), kSignature, 8) != 0) return 0;

    const auto U32 = [&File](size_t At) noexcept
    {
        return (static_cast<uint32_t>(File[At]) << 24) | (static_cast<uint32_t>(File[At + 1]) << 16) |
               (static_cast<uint32_t>(File[At + 2]) << 8) | static_cast<uint32_t>(File[At + 3]);
    };

    std::vector<unsigned char> Idat;
    int Expected[2] = { 0, 0 };
    size_t Offset = 8;
    while (Offset + 8 <= File.size())
    {
        const uint32_t Len = U32(Offset);
        if (Offset + 12u + Len > File.size()) return 0;
        const char* Tag = reinterpret_cast<const char*>(File.data() + Offset + 4);
        const unsigned char* Data = File.data() + Offset + 8;
        if (std::memcmp(Tag, "IHDR", 4) == 0)
        {
            if (Len != 13) return 0;
            Expected[0] = static_cast<int>(U32(Offset + 8));
            Expected[1] = static_cast<int>(U32(Offset + 12));
            if (Data[8] != 8u || Data[9] != 2u || Data[10] != 0u || Data[11] != 0u || Data[12] != 0u) return 0;   // 8-bit RGB, no interlace
        }
        else if (std::memcmp(Tag, "IDAT", 4) == 0)
            Idat.insert(Idat.end(), Data, Data + Len);
        else if (std::memcmp(Tag, "IEND", 4) == 0)
            break;
        Offset += 12u + Len;
    }
    if (Expected[0] <= 0 || Expected[1] <= 0 || Idat.empty()) return 0;

    // zlib stored-block stream (0x78 0x01 header, no compression) → raw scanlines with a filter byte each.
    std::vector<unsigned char> Raw;
    if (Idat.size() < 2 || Idat[0] != 0x78u || Idat[1] != 0x01u) return 0;
    size_t At = 2;
    while (At < Idat.size())
    {
        const bool Last = (Idat[At] & 1u) != 0u;
        if (At + 5u > Idat.size()) return 0;
        const uint32_t Len = static_cast<uint32_t>(Idat[At + 1]) | (static_cast<uint32_t>(Idat[At + 2]) << 8);
        if (At + 5u + Len > Idat.size()) return 0;
        Raw.insert(Raw.end(), Idat.begin() + At + 5, Idat.begin() + At + 5 + Len);
        At += 5u + Len;
        if (Last) break;
    }
    const size_t RowBytes = static_cast<size_t>(Expected[0]) * 3u + 1u;
    if (Raw.size() != RowBytes * static_cast<size_t>(Expected[1])) return 0;

    Rgb->resize(static_cast<size_t>(Expected[0]) * static_cast<size_t>(Expected[1]) * 3u);
    for (int Y = 0; Y < Expected[1]; ++Y)
    {
        const unsigned char* Row = Raw.data() + static_cast<size_t>(Y) * RowBytes;
        if (Row[0] != 0u) return 0;   // only the writer's filter-0 scanlines are decodable here
        std::memcpy(Rgb->data() + static_cast<size_t>(Y) * static_cast<size_t>(Expected[0]) * 3u, Row + 1,
                    static_cast<size_t>(Expected[0]) * 3u);
    }
    *Width = Expected[0];
    *Height = Expected[1];
    return 1;
}

} // namespace PngReadCounterpart

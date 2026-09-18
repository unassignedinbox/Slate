//============================================================================================================================================
//                                           📦 Engine/ContentInterchange/SpaceToml.cpp
//============================================================================================================================================
// The Space TOML profile is deliberately small and explicit. A project file is authoring metadata and references, not a
// transport for megabytes of vertices/pixels; those stay in checksummed FSPC payloads. Keeping this parser dependency-free
// also lets the CPU-only project-format proof run in a fresh checkout without fetching a graphics SDK or third-party parser.
#include "SpaceToml.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <map>
#include <sstream>
#include <utility>

namespace Frontier
{
namespace
{
    enum class TomlValueKind : uint8_t { String, Number, Boolean, Array };

    struct TomlValue
    {
        TomlValueKind Kind = TomlValueKind::String;
        std::string Text;
        double Number = 0.0;
        bool Boolean = false;
        std::vector<TomlValue> Array;
    };

    struct TomlTable
    {
        std::string Name;
        bool ArrayElement = false;
        std::map<std::string, TomlValue> Values;
        size_t Line = 0u;
    };

    std::string Trim(std::string Text)
    {
        const auto NotSpace = [](unsigned char C) { return !std::isspace(C); };
        const auto First = std::find_if(Text.begin(), Text.end(), NotSpace);
        if (First == Text.end()) return {};
        const auto Last = std::find_if(Text.rbegin(), Text.rend(), NotSpace).base();
        return std::string(First, Last);
    }

    std::string WithoutComment(const std::string& Line)
    {
        bool Quoted = false;
        bool Escape = false;
        for (size_t I = 0u; I < Line.size(); ++I)
        {
            const char C = Line[I];
            if (Escape) { Escape = false; continue; }
            if (Quoted && C == '\\') { Escape = true; continue; }
            if (C == '"') { Quoted = !Quoted; continue; }
            if (!Quoted && C == '#') return Line.substr(0u, I);
        }
        return Line;
    }

    bool IsBareName(const std::string& Name)
    {
        return !Name.empty() && std::all_of(Name.begin(), Name.end(), [](unsigned char C)
        {
            return std::isalnum(C) || C == '_' || C == '-';
        });
    }

    bool ParseString(const std::string& Text, std::string& Out, std::string& Error)
    {
        if (Text.size() < 2u || Text.front() != '"' || Text.back() != '"')
        {
            Error = "expected a quoted string";
            return false;
        }
        Out.clear();
        for (size_t I = 1u; I + 1u < Text.size(); ++I)
        {
            const char C = Text[I];
            if (C != '\\') { Out.push_back(C); continue; }
            if (++I + 1u >= Text.size()) { Error = "unterminated string escape"; return false; }
            switch (Text[I])
            {
                case '"': Out.push_back('"'); break;
                case '\\': Out.push_back('\\'); break;
                case 'n': Out.push_back('\n'); break;
                case 'r': Out.push_back('\r'); break;
                case 't': Out.push_back('\t'); break;
                default: Error = "unsupported string escape"; return false;
            }
        }
        return true;
    }

    bool SplitArray(const std::string& Body, std::vector<std::string>& Out, std::string& Error)
    {
        Out.clear();
        size_t Start = 0u;
        bool Quoted = false;
        bool Escape = false;
        uint32_t Depth = 0u;
        for (size_t I = 0u; I <= Body.size(); ++I)
        {
            const char C = I < Body.size() ? Body[I] : ',';
            if (Escape) { Escape = false; continue; }
            if (Quoted && C == '\\') { Escape = true; continue; }
            if (C == '"') { Quoted = !Quoted; continue; }
            if (!Quoted && C == '[') { ++Depth; continue; }
            if (!Quoted && C == ']')
            {
                if (Depth == 0u) { Error = "unmatched ] in array"; return false; }
                --Depth;
                continue;
            }
            if (!Quoted && Depth == 0u && C == ',')
            {
                const std::string Part = Trim(Body.substr(Start, I - Start));
                if (Part.empty())
                {
                    if (I != Body.size() || !Trim(Body).empty()) { Error = "empty array element"; return false; }
                }
                else Out.push_back(Part);
                Start = I + 1u;
            }
        }
        if (Quoted || Depth != 0u) { Error = "unterminated array"; return false; }
        return true;
    }

    bool ParseValue(const std::string& Text, TomlValue& Out, std::string& Error)
    {
        const std::string Value = Trim(Text);
        if (Value.empty()) { Error = "missing value"; return false; }
        if (Value.front() == '"')
        {
            Out.Kind = TomlValueKind::String;
            return ParseString(Value, Out.Text, Error);
        }
        if (Value.front() == '[')
        {
            if (Value.back() != ']') { Error = "unterminated array"; return false; }
            Out.Kind = TomlValueKind::Array;
            std::vector<std::string> Parts;
            if (!SplitArray(Value.substr(1u, Value.size() - 2u), Parts, Error)) return false;
            Out.Array.clear();
            for (const std::string& Part : Parts)
            {
                TomlValue Item;
                if (!ParseValue(Part, Item, Error)) return false;
                Out.Array.push_back(std::move(Item));
            }
            return true;
        }
        if (Value == "true" || Value == "false")
        {
            Out.Kind = TomlValueKind::Boolean;
            Out.Boolean = Value == "true";
            return true;
        }
        char* End = nullptr;
        const double Number = std::strtod(Value.c_str(), &End);
        if (End == Value.c_str() || *End != '\0' || !std::isfinite(Number))
        {
            Error = "expected a string, finite number, boolean, or one-line array";
            return false;
        }
        Out.Kind = TomlValueKind::Number;
        Out.Number = Number;
        return true;
    }

    bool ParseFile(const std::string& Path, std::vector<TomlTable>& Out, std::string& OutError)
    {
        Out.clear();
        std::ifstream Stream(Path);
        if (!Stream) { OutError = "cannot open " + Path; return false; }
        TomlTable* Current = nullptr;
        std::string Line;
        size_t LineNumber = 0u;
        while (std::getline(Stream, Line))
        {
            ++LineNumber;
            const std::string Text = Trim(WithoutComment(Line));
            if (Text.empty()) continue;
            if (Text.front() == '[')
            {
                const bool Array = Text.size() >= 4u && Text[1] == '[';
                const size_t Close = Array ? Text.rfind("]]", Text.size() - 2u) : Text.rfind(']');
                if (Close == std::string::npos || (Array ? Close + 2u != Text.size() : Close + 1u != Text.size()))
                {
                    OutError = Path + ":" + std::to_string(LineNumber) + ": malformed table header";
                    return false;
                }
                const std::string Name = Trim(Text.substr(Array ? 2u : 1u, Close - (Array ? 2u : 1u)));
                if (!IsBareName(Name))
                {
                    OutError = Path + ":" + std::to_string(LineNumber) + ": table names must be bare Space schema names";
                    return false;
                }
                if (!Array && std::any_of(Out.begin(), Out.end(), [&](const TomlTable& T) { return !T.ArrayElement && T.Name == Name; }))
                {
                    OutError = Path + ":" + std::to_string(LineNumber) + ": duplicate table [" + Name + "]";
                    return false;
                }
                Out.push_back(TomlTable{ Name, Array, {}, LineNumber });
                Current = &Out.back();
                continue;
            }
            if (!Current)
            {
                OutError = Path + ":" + std::to_string(LineNumber) + ": values must appear in a table";
                return false;
            }
            const size_t Equals = Text.find('=');
            if (Equals == std::string::npos)
            {
                OutError = Path + ":" + std::to_string(LineNumber) + ": expected key = value";
                return false;
            }
            const std::string Key = Trim(Text.substr(0u, Equals));
            if (!IsBareName(Key))
            {
                OutError = Path + ":" + std::to_string(LineNumber) + ": keys must be bare Space schema names";
                return false;
            }
            TomlValue Value;
            std::string ValueError;
            if (!ParseValue(Text.substr(Equals + 1u), Value, ValueError))
            {
                OutError = Path + ":" + std::to_string(LineNumber) + ": " + ValueError;
                return false;
            }
            if (!Current->Values.emplace(Key, std::move(Value)).second)
            {
                OutError = Path + ":" + std::to_string(LineNumber) + ": duplicate key " + Key;
                return false;
            }
        }
        if (!Stream.eof()) { OutError = "cannot read " + Path; return false; }
        return true;
    }

    const TomlTable* Singleton(const std::vector<TomlTable>& Tables, const char* Name)
    {
        const auto Found = std::find_if(Tables.begin(), Tables.end(), [&](const TomlTable& T) { return !T.ArrayElement && T.Name == Name; });
        return Found == Tables.end() ? nullptr : &*Found;
    }

    const TomlValue* Find(const TomlTable& Table, const char* Key)
    {
        const auto Found = Table.Values.find(Key);
        return Found == Table.Values.end() ? nullptr : &Found->second;
    }

    bool RequiredString(const TomlTable& Table, const char* Key, std::string& Out, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value || Value->Kind != TomlValueKind::String)
        {
            Error = "table [" + Table.Name + "] requires string " + Key;
            return false;
        }
        Out = Value->Text;
        return true;
    }

    bool OptionalString(const TomlTable& Table, const char* Key, std::string& Out, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Kind != TomlValueKind::String)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be a string";
            return false;
        }
        Out = Value->Text;
        return true;
    }

    bool RequiredRevision(const TomlTable& Table, std::string& Error)
    {
        const TomlValue* Value = Find(Table, "version");
        if (!Value || Value->Kind != TomlValueKind::Number || Value->Number != static_cast<double>(kSpaceTomlRevision))
        {
            Error = "table [" + Table.Name + "] requires version = " + std::to_string(kSpaceTomlRevision);
            return false;
        }
        return true;
    }

    bool OptionalNumber(const TomlTable& Table, const char* Key, float& Out, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Kind != TomlValueKind::Number)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be a number";
            return false;
        }
        Out = static_cast<float>(Value->Number);
        return true;
    }

    bool OptionalBoolean(const TomlTable& Table, const char* Key, bool& Out, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Kind != TomlValueKind::Boolean)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be true or false";
            return false;
        }
        Out = Value->Boolean;
        return true;
    }

    bool OptionalFloatArray(const TomlTable& Table, const char* Key, float* Out, size_t Count, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Kind != TomlValueKind::Array || Value->Array.size() != Count)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be an array of " + std::to_string(Count) + " numbers";
            return false;
        }
        for (size_t I = 0u; I < Count; ++I)
        {
            if (Value->Array[I].Kind != TomlValueKind::Number)
            {
                Error = "table [" + Table.Name + "] field " + Key + " must be an array of numbers";
                return false;
            }
            Out[I] = static_cast<float>(Value->Array[I].Number);
        }
        return true;
    }

    bool OptionalFlags(const TomlTable& Table, const char* Key, uint32_t& Out, bool Material, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Kind != TomlValueKind::Array)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be an array of strings";
            return false;
        }
        for (const TomlValue& Item : Value->Array)
        {
            if (Item.Kind != TomlValueKind::String)
            {
                Error = "table [" + Table.Name + "] field " + Key + " must contain strings";
                return false;
            }
            const std::string& Flag = Item.Text;
            if (Material)
            {
                if (Flag == "double_sided") Out |= MaterialFlagDoubleSided;
                else if (Flag == "alpha_mask") Out |= MaterialFlagAlphaMask;
                else if (Flag == "alpha_translucent") Out |= MaterialFlagAlphaTranslucent;
                else if (Flag == "unlit") Out |= MaterialFlagUnlit;
                else if (Flag == "thin_walled") Out |= MaterialFlagThinWalled;
                else { Error = "unknown material flag '" + Flag + "'"; return false; }
            }
            else
            {
                if (Flag == "hidden") Out |= kSpaceInstanceHidden;
                else if (Flag == "locked") Out |= kSpaceInstanceLocked;
                else if (Flag == "cast_shadow") Out |= kSpaceInstanceCastShadow;
                else if (Flag == "dynamic") Out |= kSpaceInstanceDynamic;
                else { Error = "unknown instance flag '" + Flag + "'"; return false; }
            }
        }
        return true;
    }

    bool IsRelativeAssetPath(const std::string& Path)
    {
        return !Path.empty() && !std::filesystem::path(Path).is_absolute();
    }

    std::string Escape(const std::string& Value)
    {
        std::string Out;
        Out.reserve(Value.size() + 2u);
        Out.push_back('"');
        for (char C : Value)
        {
            switch (C)
            {
                case '\\': Out += "\\\\"; break;
                case '"': Out += "\\\""; break;
                case '\n': Out += "\\n"; break;
                case '\r': Out += "\\r"; break;
                case '\t': Out += "\\t"; break;
                default: Out.push_back(C); break;
            }
        }
        Out.push_back('"');
        return Out;
    }

    void WriteFloatArray(std::ostream& Out, const float* Values, size_t Count)
    {
        Out << '[';
        for (size_t I = 0u; I < Count; ++I) Out << (I ? ", " : "") << Values[I];
        Out << ']';
    }

    void WriteFlags(std::ostream& Out, uint32_t Flags, bool Material)
    {
        std::vector<const char*> Names;
        if (Material)
        {
            if (Flags & MaterialFlagDoubleSided) Names.push_back("double_sided");
            if (Flags & MaterialFlagAlphaMask) Names.push_back("alpha_mask");
            if (Flags & MaterialFlagAlphaTranslucent) Names.push_back("alpha_translucent");
            if (Flags & MaterialFlagUnlit) Names.push_back("unlit");
            if (Flags & MaterialFlagThinWalled) Names.push_back("thin_walled");
        }
        else
        {
            if (Flags & kSpaceInstanceHidden) Names.push_back("hidden");
            if (Flags & kSpaceInstanceLocked) Names.push_back("locked");
            if (Flags & kSpaceInstanceCastShadow) Names.push_back("cast_shadow");
            if (Flags & kSpaceInstanceDynamic) Names.push_back("dynamic");
        }
        Out << '[';
        for (size_t I = 0u; I < Names.size(); ++I) Out << (I ? ", " : "") << Escape(Names[I]);
        Out << ']';
    }

    bool OpenForWrite(const std::string& Path, std::ofstream& Out, std::string& Error)
    {
        std::error_code Ec;
        const std::filesystem::path Parent = std::filesystem::path(Path).parent_path();
        if (!Parent.empty()) std::filesystem::create_directories(Parent, Ec);
        if (Ec) { Error = "cannot create " + Parent.string() + ": " + Ec.message(); return false; }
        Out.open(Path, std::ios::out | std::ios::trunc);
        if (!Out) { Error = "cannot write " + Path; return false; }
        Out << std::setprecision(9);
        return true;
    }

    bool SetSlab(const TomlTable& Table, MaterialSlabDescriptor& Slab, std::string& Error)
    {
#define SPACE_TOML_SCALAR(KEY, FIELD) if (!OptionalNumber(Table, KEY, Slab.FIELD, Error)) return false
        SPACE_TOML_SCALAR("base_weight", BaseWeight);
        if (!OptionalFloatArray(Table, "base_color", Slab.BaseColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("base_metalness", BaseMetalness);
        SPACE_TOML_SCALAR("base_diffuse_roughness", BaseDiffuseRoughness);
        SPACE_TOML_SCALAR("specular_weight", SpecularWeight);
        if (!OptionalFloatArray(Table, "specular_color", Slab.SpecularColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("specular_roughness", SpecularRoughness);
        SPACE_TOML_SCALAR("specular_roughness_anisotropy", SpecularRoughnessAnisotropy);
        SPACE_TOML_SCALAR("specular_ior", SpecularIor);
        SPACE_TOML_SCALAR("transmission_weight", TransmissionWeight);
        if (!OptionalFloatArray(Table, "transmission_color", Slab.TransmissionColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("transmission_depth", TransmissionDepth);
        if (!OptionalFloatArray(Table, "transmission_scatter", Slab.TransmissionScatter, 3u, Error)) return false;
        SPACE_TOML_SCALAR("transmission_scatter_anisotropy", TransmissionScatterAnisotropy);
        SPACE_TOML_SCALAR("transmission_dispersion_scale", TransmissionDispersionScale);
        SPACE_TOML_SCALAR("transmission_dispersion_abbe_number", TransmissionDispersionAbbeNumber);
        SPACE_TOML_SCALAR("subsurface_weight", SubsurfaceWeight);
        if (!OptionalFloatArray(Table, "subsurface_color", Slab.SubsurfaceColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("subsurface_radius", SubsurfaceRadius);
        if (!OptionalFloatArray(Table, "subsurface_radius_scale", Slab.SubsurfaceRadiusScale, 3u, Error)) return false;
        SPACE_TOML_SCALAR("subsurface_scatter_anisotropy", SubsurfaceScatterAnisotropy);
        SPACE_TOML_SCALAR("coat_weight", CoatWeight);
        if (!OptionalFloatArray(Table, "coat_color", Slab.CoatColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("coat_roughness", CoatRoughness);
        SPACE_TOML_SCALAR("coat_roughness_anisotropy", CoatRoughnessAnisotropy);
        SPACE_TOML_SCALAR("coat_ior", CoatIor);
        SPACE_TOML_SCALAR("coat_darkening", CoatDarkening);
        SPACE_TOML_SCALAR("fuzz_weight", FuzzWeight);
        if (!OptionalFloatArray(Table, "fuzz_color", Slab.FuzzColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("fuzz_roughness", FuzzRoughness);
        SPACE_TOML_SCALAR("emission_luminance", EmissionLuminance);
        if (!OptionalFloatArray(Table, "emission_color", Slab.EmissionColor, 3u, Error)) return false;
        SPACE_TOML_SCALAR("thin_film_weight", ThinFilmWeight);
        SPACE_TOML_SCALAR("thin_film_thickness", ThinFilmThickness);
        SPACE_TOML_SCALAR("thin_film_ior", ThinFilmIor);
        SPACE_TOML_SCALAR("geometry_opacity", GeometryOpacity);
        SPACE_TOML_SCALAR("slate_haziness_weight", SlateHazinessWeight);
        SPACE_TOML_SCALAR("slate_haziness_roughness", SlateHazinessRoughness);
        SPACE_TOML_SCALAR("slate_glint_density", SlateGlintDensity);
        SPACE_TOML_SCALAR("slate_glint_uv_scale", SlateGlintUvScale);
        SPACE_TOML_SCALAR("slate_anisotropy_rotation", SlateAnisotropyRotation);
        SPACE_TOML_SCALAR("slate_direct_f0_weight", SlateDirectF0Weight);
#undef SPACE_TOML_SCALAR
        if (!OptionalBoolean(Table, "geometry_thin_walled", Slab.GeometryThinWalled, Error)) return false;
        return true;
    }

    void WriteSlab(std::ostream& Out, const MaterialSlabDescriptor& S)
    {
#define SPACE_TOML_WRITE_SCALAR(KEY, FIELD) Out << KEY << " = " << S.FIELD << "\n"
        SPACE_TOML_WRITE_SCALAR("base_weight", BaseWeight);
        Out << "base_color = "; WriteFloatArray(Out, S.BaseColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("base_metalness", BaseMetalness);
        SPACE_TOML_WRITE_SCALAR("base_diffuse_roughness", BaseDiffuseRoughness);
        SPACE_TOML_WRITE_SCALAR("specular_weight", SpecularWeight);
        Out << "specular_color = "; WriteFloatArray(Out, S.SpecularColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("specular_roughness", SpecularRoughness);
        SPACE_TOML_WRITE_SCALAR("specular_roughness_anisotropy", SpecularRoughnessAnisotropy);
        SPACE_TOML_WRITE_SCALAR("specular_ior", SpecularIor);
        SPACE_TOML_WRITE_SCALAR("transmission_weight", TransmissionWeight);
        Out << "transmission_color = "; WriteFloatArray(Out, S.TransmissionColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("transmission_depth", TransmissionDepth);
        Out << "transmission_scatter = "; WriteFloatArray(Out, S.TransmissionScatter, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("transmission_scatter_anisotropy", TransmissionScatterAnisotropy);
        SPACE_TOML_WRITE_SCALAR("transmission_dispersion_scale", TransmissionDispersionScale);
        SPACE_TOML_WRITE_SCALAR("transmission_dispersion_abbe_number", TransmissionDispersionAbbeNumber);
        SPACE_TOML_WRITE_SCALAR("subsurface_weight", SubsurfaceWeight);
        Out << "subsurface_color = "; WriteFloatArray(Out, S.SubsurfaceColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("subsurface_radius", SubsurfaceRadius);
        Out << "subsurface_radius_scale = "; WriteFloatArray(Out, S.SubsurfaceRadiusScale, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("subsurface_scatter_anisotropy", SubsurfaceScatterAnisotropy);
        SPACE_TOML_WRITE_SCALAR("coat_weight", CoatWeight);
        Out << "coat_color = "; WriteFloatArray(Out, S.CoatColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("coat_roughness", CoatRoughness);
        SPACE_TOML_WRITE_SCALAR("coat_roughness_anisotropy", CoatRoughnessAnisotropy);
        SPACE_TOML_WRITE_SCALAR("coat_ior", CoatIor);
        SPACE_TOML_WRITE_SCALAR("coat_darkening", CoatDarkening);
        SPACE_TOML_WRITE_SCALAR("fuzz_weight", FuzzWeight);
        Out << "fuzz_color = "; WriteFloatArray(Out, S.FuzzColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("fuzz_roughness", FuzzRoughness);
        SPACE_TOML_WRITE_SCALAR("emission_luminance", EmissionLuminance);
        Out << "emission_color = "; WriteFloatArray(Out, S.EmissionColor, 3u); Out << "\n";
        SPACE_TOML_WRITE_SCALAR("thin_film_weight", ThinFilmWeight);
        SPACE_TOML_WRITE_SCALAR("thin_film_thickness", ThinFilmThickness);
        SPACE_TOML_WRITE_SCALAR("thin_film_ior", ThinFilmIor);
        SPACE_TOML_WRITE_SCALAR("geometry_opacity", GeometryOpacity);
        SPACE_TOML_WRITE_SCALAR("slate_haziness_weight", SlateHazinessWeight);
        SPACE_TOML_WRITE_SCALAR("slate_haziness_roughness", SlateHazinessRoughness);
        SPACE_TOML_WRITE_SCALAR("slate_glint_density", SlateGlintDensity);
        SPACE_TOML_WRITE_SCALAR("slate_glint_uv_scale", SlateGlintUvScale);
        SPACE_TOML_WRITE_SCALAR("slate_anisotropy_rotation", SlateAnisotropyRotation);
        SPACE_TOML_WRITE_SCALAR("slate_direct_f0_weight", SlateDirectF0Weight);
#undef SPACE_TOML_WRITE_SCALAR
        Out << "geometry_thin_walled = " << (S.GeometryThinWalled ? "true" : "false") << "\n";
    }
}

bool SpaceTomlReadProjectFile(const std::string& Path, SpaceTomlProject& Out, std::string& OutError) noexcept
{
    Out = SpaceTomlProject{};
    OutError.clear();
    std::vector<TomlTable> Tables;
    if (!ParseFile(Path, Tables, OutError)) return false;
    const TomlTable* Project = Singleton(Tables, "project");
    if (!Project) { OutError = Path + ": missing [project] table"; return false; }

    std::string Format;
    if (!RequiredString(*Project, "format", Format, OutError) || !RequiredRevision(*Project, OutError) ||
        !RequiredString(*Project, "name", Out.Name, OutError) || !RequiredString(*Project, "default_level", Out.DefaultLevel, OutError)) return false;
    if (Format != kSpaceTomlProjectFormat)
    {
        OutError = Path + ": [project].format must be \"" + std::string(kSpaceTomlProjectFormat) + "\"";
        return false;
    }

    for (const TomlTable& Table : Tables)
    {
        if (!Table.ArrayElement || Table.Name != "level") continue;
        SpaceTomlLevel Level;
        if (!RequiredString(Table, "name", Level.Name, OutError)) return false;
        if (std::any_of(Out.Levels.begin(), Out.Levels.end(), [&](const SpaceTomlLevel& Existing) { return Existing.Name == Level.Name; }))
        {
            OutError = Path + ": duplicate level '" + Level.Name + "'";
            return false;
        }
        Out.Levels.push_back(std::move(Level));
    }
    if (Out.Levels.empty()) { OutError = Path + ": a project requires at least one [[level]]"; return false; }
    if (std::none_of(Out.Levels.begin(), Out.Levels.end(), [&](const SpaceTomlLevel& Level) { return Level.Name == Out.DefaultLevel; }))
    {
        OutError = Path + ": default_level '" + Out.DefaultLevel + "' is not declared";
        return false;
    }

    for (const TomlTable& Table : Tables)
    {
        if (!Table.ArrayElement || Table.Name != "instance") continue;
        SpaceTomlInstance Instance;
        std::string Mode = "copy_on_write";
        if (!RequiredString(Table, "name", Instance.Name, OutError) || !RequiredString(Table, "level", Instance.Level, OutError) ||
            !RequiredString(Table, "geometry", Instance.Geometry, OutError) || !RequiredString(Table, "material", Instance.Material, OutError) ||
            !OptionalString(Table, "material_mode", Mode, OutError) || !OptionalFloatArray(Table, "transform", Instance.Transform, 16u, OutError)) return false;
        if (!IsRelativeAssetPath(Instance.Geometry) || !IsRelativeAssetPath(Instance.Material))
        {
            OutError = Path + ": instance '" + Instance.Name + "' has an empty or absolute asset path";
            return false;
        }
        if (Mode == "shared") Instance.MaterialMode = kSpaceMaterialShared;
        else if (Mode == "copied") Instance.MaterialMode = kSpaceMaterialCopied;
        else if (Mode == "copy_on_write") Instance.MaterialMode = kSpaceMaterialCopyOnWrite;
        else { OutError = Path + ": instance '" + Instance.Name + "' has unknown material_mode '" + Mode + "'"; return false; }
        Instance.Flags = 0u;
        if (!OptionalFlags(Table, "flags", Instance.Flags, false, OutError)) return false;
        if (std::none_of(Out.Levels.begin(), Out.Levels.end(), [&](const SpaceTomlLevel& Level) { return Level.Name == Instance.Level; }))
        {
            OutError = Path + ": instance '" + Instance.Name + "' names undeclared level '" + Instance.Level + "'";
            return false;
        }
        Out.Instances.push_back(std::move(Instance));
    }
    return true;
}

bool SpaceTomlReadMaterialFile(const std::string& Path, MaterialDescriptor& Out, std::string& OutError) noexcept
{
    Out = MaterialDescriptor{};
    OutError.clear();
    std::vector<TomlTable> Tables;
    if (!ParseFile(Path, Tables, OutError)) return false;
    const TomlTable* Material = Singleton(Tables, "material");
    if (!Material) { OutError = Path + ": missing [material] table"; return false; }
    std::string Format;
    if (!RequiredString(*Material, "format", Format, OutError) || !RequiredRevision(*Material, OutError) ||
        !RequiredString(*Material, "name", Out.Name, OutError)) return false;
    if (Format != kSpaceTomlMaterialFormat)
    {
        OutError = Path + ": [material].format must be \"" + std::string(kSpaceTomlMaterialFormat) + "\"";
        return false;
    }
    if (!OptionalNumber(*Material, "alpha_cutoff", Out.AlphaCutoff, OutError) ||
        !OptionalNumber(*Material, "volume_thickness", Out.VolumeThickness, OutError)) return false;
    Out.Flags = 0u;
    if (!OptionalFlags(*Material, "flags", Out.Flags, true, OutError)) return false;

    for (const TomlTable& Table : Tables)
    {
        if (!Table.ArrayElement || Table.Name != "slab") continue;
        MaterialSlabDescriptor Slab;
        if (!SetSlab(Table, Slab, OutError)) return false;
        Out.Slabs.push_back(Slab);
    }
    if (Out.Slabs.empty()) { OutError = Path + ": a material requires at least one [[slab]]"; return false; }
    return true;
}

bool SpaceTomlWriteProjectFile(const std::string& Path, const SpaceTomlProject& Project, std::string& OutError) noexcept
{
    OutError.clear();
    if (Project.Name.empty() || Project.DefaultLevel.empty() || Project.Levels.empty())
    {
        OutError = "a TOML project needs a name, default level, and at least one level";
        return false;
    }
    std::ofstream Out;
    if (!OpenForWrite(Path, Out, OutError)) return false;
    Out << "# Frontier Space authoring manifest. Geometry payloads remain checksummed binary FSPC containers.\n\n";
    Out << "[project]\nformat = " << Escape(kSpaceTomlProjectFormat) << "\nversion = " << kSpaceTomlRevision << "\nname = " << Escape(Project.Name)
        << "\ndefault_level = " << Escape(Project.DefaultLevel) << "\n";
    for (const SpaceTomlLevel& Level : Project.Levels)
        Out << "\n[[level]]\nname = " << Escape(Level.Name) << "\n";
    for (const SpaceTomlInstance& Instance : Project.Instances)
    {
        const char* Mode = Instance.MaterialMode == kSpaceMaterialShared ? "shared" :
                           Instance.MaterialMode == kSpaceMaterialCopied ? "copied" : "copy_on_write";
        Out << "\n[[instance]]\nname = " << Escape(Instance.Name) << "\nlevel = " << Escape(Instance.Level)
            << "\ngeometry = " << Escape(Instance.Geometry) << "\nmaterial = " << Escape(Instance.Material)
            << "\nmaterial_mode = " << Escape(Mode) << "\nflags = ";
        WriteFlags(Out, Instance.Flags, false);
        Out << "\ntransform = ";
        WriteFloatArray(Out, Instance.Transform, 16u);
        Out << "\n";
    }
    if (!Out.good()) { OutError = "cannot finish " + Path; return false; }
    return true;
}

bool SpaceTomlWriteMaterialFile(const std::string& Path, const MaterialDescriptor& Material, std::string& OutError) noexcept
{
    OutError.clear();
    if (Material.Name.empty() || Material.Slabs.empty())
    {
        OutError = "a TOML material needs a name and at least one slab";
        return false;
    }
    std::ofstream Out;
    if (!OpenForWrite(Path, Out, OutError)) return false;
    Out << "# Frontier Space authored material. Values are OpenPBR/Slate parameters in engine units.\n\n";
    Out << "[material]\nformat = " << Escape(kSpaceTomlMaterialFormat) << "\nversion = " << kSpaceTomlRevision
        << "\nname = " << Escape(Material.Name) << "\nflags = ";
    WriteFlags(Out, Material.Flags, true);
    Out << "\nalpha_cutoff = " << Material.AlphaCutoff << "\nvolume_thickness = " << Material.VolumeThickness << "\n";
    for (const MaterialSlabDescriptor& Slab : Material.Slabs)
    {
        Out << "\n[[slab]]\n";
        WriteSlab(Out, Slab);
    }
    if (!Out.good()) { OutError = "cannot finish " + Path; return false; }
    return true;
}
} // namespace Frontier

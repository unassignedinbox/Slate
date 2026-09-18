//============================================================================================================================================
//                                           📦 Engine/ContentInterchange/SpaceToml.cpp
//============================================================================================================================================
// The Space TOML profile is deliberately small and explicit. A project file is authoring metadata and references, not a
// transport for megabytes of vertices/pixels; those stay in checksummed FSPC payloads. The product uses the
// repository's toml++ dependency; the CPU proof has a limited profile reader so it remains independent of graphics
// headers and of unmaterialised third-party source.
#include "SpaceToml.h"

#if defined(FRONTIER_USE_TOMLPP)
    #include <toml++/toml.h>
#endif

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <exception>
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
    enum class TomlValueType : uint8_t { String, Number, Boolean, Array };

    struct TomlValue
    {
        TomlValueType Type = TomlValueType::String;
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
            Out.Type = TomlValueType::String;
            return ParseString(Value, Out.Text, Error);
        }
        if (Value.front() == '[')
        {
            if (Value.back() != ']') { Error = "unterminated array"; return false; }
            Out.Type = TomlValueType::Array;
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
            Out.Type = TomlValueType::Boolean;
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
        Out.Type = TomlValueType::Number;
        Out.Number = Number;
        return true;
    }

    bool ParseProfileFile(const std::string& Path, std::vector<TomlTable>& Out, std::string& OutError)
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

#if defined(FRONTIER_USE_TOMLPP)
    bool ConvertTomlppValue(const toml::node& Node, TomlValue& Out, std::string& Error)
    {
        if (const auto Value = Node.value<std::string>())
        {
            Out.Type = TomlValueType::String;
            Out.Text = *Value;
            return true;
        }
        if (const auto Value = Node.value<bool>())
        {
            Out.Type = TomlValueType::Boolean;
            Out.Boolean = *Value;
            return true;
        }
        if (const auto Value = Node.value<int64_t>())
        {
            Out.Type = TomlValueType::Number;
            Out.Number = static_cast<double>(*Value);
            return true;
        }
        if (const auto Value = Node.value<double>())
        {
            if (!std::isfinite(*Value)) { Error = "a number must be finite"; return false; }
            Out.Type = TomlValueType::Number;
            Out.Number = *Value;
            return true;
        }
        if (const toml::array* Array = Node.as_array())
        {
            Out.Type = TomlValueType::Array;
            Out.Array.clear();
            for (const toml::node& Item : *Array)
            {
                TomlValue Converted;
                if (!ConvertTomlppValue(Item, Converted, Error)) return false;
                Out.Array.push_back(std::move(Converted));
            }
            return true;
        }
        Error = "expected a string, finite number, boolean, or array";
        return false;
    }

    bool ConvertTomlppTable(const toml::table& Source, const std::string& Name, bool ArrayElement,
                            std::vector<TomlTable>& Out, std::string& Error)
    {
        TomlTable Table;
        Table.Name = Name;
        Table.ArrayElement = ArrayElement;
        for (const auto& [Key, Node] : Source)
        {
            TomlValue Value;
            if (!ConvertTomlppValue(Node, Value, Error))
            {
                Error = "table [" + Name + "] field " + std::string(Key.str()) + ": " + Error;
                return false;
            }
            if (!Table.Values.emplace(std::string(Key.str()), std::move(Value)).second)
            {
                Error = "table [" + Name + "] has a duplicate field";
                return false;
            }
        }
        Out.push_back(std::move(Table));
        return true;
    }

    bool ParseTomlppFile(const std::string& Path, std::vector<TomlTable>& Out, std::string& OutError)
    {
        Out.clear();
        try
        {
            const toml::table Document = toml::parse_file(Path);
            for (const auto& [Key, Node] : Document)
            {
                const std::string Name = std::string(Key.str());
                if (!IsBareName(Name))
                {
                    OutError = Path + ": table names must be bare Space schema names";
                    return false;
                }
                if (const toml::table* Table = Node.as_table())
                {
                    if (!ConvertTomlppTable(*Table, Name, false, Out, OutError)) { OutError = Path + ": " + OutError; return false; }
                    continue;
                }
                if (const toml::array* Array = Node.as_array())
                {
                    for (const toml::node& Entry : *Array)
                    {
                        const toml::table* Table = Entry.as_table();
                        if (!Table)
                        {
                            OutError = Path + ": root array '" + Name + "' must contain tables";
                            return false;
                        }
                        if (!ConvertTomlppTable(*Table, Name, true, Out, OutError)) { OutError = Path + ": " + OutError; return false; }
                    }
                    continue;
                }
                OutError = Path + ": values must appear in a table";
                return false;
            }
        }
        catch (const toml::parse_error& Error)
        {
            OutError = Path + ": " + std::string(Error.description());
            return false;
        }
        catch (const std::exception& Error)
        {
            OutError = Path + ": " + Error.what();
            return false;
        }
        return true;
    }
#endif

    bool ParseFile(const std::string& Path, std::vector<TomlTable>& Out, std::string& OutError)
    {
#if defined(FRONTIER_USE_TOMLPP)
        return ParseTomlppFile(Path, Out, OutError);
#else
        return ParseProfileFile(Path, Out, OutError);
#endif
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
        if (!Value || Value->Type != TomlValueType::String)
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
        if (Value->Type != TomlValueType::String)
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
        if (!Value || Value->Type != TomlValueType::Number || Value->Number != static_cast<double>(kSpaceTomlRevision))
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
        if (Value->Type != TomlValueType::Number)
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
        if (Value->Type != TomlValueType::Boolean)
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
        if (Value->Type != TomlValueType::Array || Value->Array.size() != Count)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be an array of " + std::to_string(Count) + " numbers";
            return false;
        }
        for (size_t I = 0u; I < Count; ++I)
        {
            if (Value->Array[I].Type != TomlValueType::Number)
            {
                Error = "table [" + Table.Name + "] field " + Key + " must be an array of numbers";
                return false;
            }
            Out[I] = static_cast<float>(Value->Array[I].Number);
        }
        return true;
    }

    bool OptionalUnsigned(const TomlTable& Table, const char* Key, uint32_t& Out, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Type != TomlValueType::Number || Value->Number < 0.0 ||
            std::floor(Value->Number) != Value->Number || Value->Number > static_cast<double>(UINT32_MAX))
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be an unsigned integer";
            return false;
        }
        Out = static_cast<uint32_t>(Value->Number);
        return true;
    }

    bool OptionalStringArray(const TomlTable& Table, const char* Key, std::vector<std::string>& Out, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Type != TomlValueType::Array)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be an array of strings";
            return false;
        }
        for (const TomlValue& Item : Value->Array)
        {
            if (Item.Type != TomlValueType::String)
            {
                Error = "table [" + Table.Name + "] field " + Key + " must contain strings";
                return false;
            }
            Out.push_back(Item.Text);
        }
        return true;
    }

    bool OptionalFlags(const TomlTable& Table, const char* Key, uint32_t& Out, bool Material, std::string& Error)
    {
        const TomlValue* Value = Find(Table, Key);
        if (!Value) return true;
        if (Value->Type != TomlValueType::Array)
        {
            Error = "table [" + Table.Name + "] field " + Key + " must be an array of strings";
            return false;
        }
        for (const TomlValue& Item : Value->Array)
        {
            if (Item.Type != TomlValueType::String)
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

    bool ReadInstanceTable(const TomlTable& Table, SpaceTomlInstance& Out, std::string& Error)
    {
        Out = SpaceTomlInstance{};
        std::string Mode = "copy_on_write";
        if (!RequiredString(Table, "name", Out.Name, Error) || !RequiredString(Table, "level", Out.Level, Error) ||
            !RequiredString(Table, "geometry", Out.Geometry, Error) || !RequiredString(Table, "material", Out.Material, Error) ||
            !OptionalString(Table, "material_mode", Mode, Error) || !OptionalFloatArray(Table, "transform", Out.Transform, 16u, Error)) return false;
        if (!IsRelativeAssetPath(Out.Geometry) || !IsRelativeAssetPath(Out.Material))
        {
            Error = "instance '" + Out.Name + "' has an empty or absolute asset path";
            return false;
        }
        if (Mode == "shared") Out.MaterialMode = kSpaceMaterialShared;
        else if (Mode == "copied") Out.MaterialMode = kSpaceMaterialCopied;
        else if (Mode == "copy_on_write") Out.MaterialMode = kSpaceMaterialCopyOnWrite;
        else { Error = "instance '" + Out.Name + "' has unknown material_mode '" + Mode + "'"; return false; }
        Out.Flags = 0u;
        return OptionalFlags(Table, "flags", Out.Flags, false, Error);
    }

    const char* TextureChannelName(MaterialTextureChannel Channel)
    {
        static constexpr const char* Names[] = {
            "base_color", "metalness", "specular_roughness", "specular_color", "geometry_normal", "geometry_coat_normal",
            "emission", "geometry_opacity", "transmission", "subsurface", "coat", "fuzz", "thin_film", "anisotropy",
            "occlusion", "mask"
        };
        const uint32_t Index = static_cast<uint32_t>(Channel);
        return Index < kMaterialTextureChannelCount ? Names[Index] : "";
    }

    bool ParseTextureChannel(const std::string& Value, MaterialTextureChannel& Out)
    {
        for (uint32_t I = 0u; I < kMaterialTextureChannelCount; ++I)
        {
            const MaterialTextureChannel Channel = static_cast<MaterialTextureChannel>(I);
            if (Value == TextureChannelName(Channel)) { Out = Channel; return true; }
        }
        return false;
    }

    const char* TextureComponentName(TextureChannelSelection Component)
    {
        switch (Component)
        {
            case TextureChannelSelection::Rgb: return "rgb";
            case TextureChannelSelection::R: return "r";
            case TextureChannelSelection::G: return "g";
            case TextureChannelSelection::B: return "b";
            case TextureChannelSelection::A: return "a";
        }
        return "rgb";
    }

    bool ParseTextureComponent(const std::string& Value, TextureChannelSelection& Out)
    {
        if (Value == "rgb") { Out = TextureChannelSelection::Rgb; return true; }
        if (Value == "r") { Out = TextureChannelSelection::R; return true; }
        if (Value == "g") { Out = TextureChannelSelection::G; return true; }
        if (Value == "b") { Out = TextureChannelSelection::B; return true; }
        if (Value == "a") { Out = TextureChannelSelection::A; return true; }
        return false;
    }

    bool DefaultTextureLinear(MaterialTextureChannel Channel)
    {
        return Channel != MaterialTextureChannel::BaseColor && Channel != MaterialTextureChannel::Emission;
    }

    bool ReadTextureTable(const TomlTable& Table, SpaceTomlTexture& Out, std::string& Error)
    {
        std::string Channel;
        std::string Component = "rgb";
        uint32_t UvSet = Out.UvSet;
        if (!RequiredString(Table, "channel", Channel, Error) || !RequiredString(Table, "path", Out.Path, Error) ||
            !OptionalUnsigned(Table, "slab", Out.Slab, Error) || !OptionalString(Table, "component", Component, Error) ||
            !OptionalUnsigned(Table, "uv_set", UvSet, Error)) return false;
        if (UvSet > 255u)
        {
            Error = "texture path '" + Out.Path + "' has uv_set outside 0..255";
            return false;
        }
        Out.UvSet = static_cast<uint8_t>(UvSet);
        if (!ParseTextureChannel(Channel, Out.Channel))
        {
            Error = "texture path '" + Out.Path + "' has unknown channel '" + Channel + "'";
            return false;
        }
        if (!ParseTextureComponent(Component, Out.Component))
        {
            Error = "texture path '" + Out.Path + "' has unknown component '" + Component + "'";
            return false;
        }
        Out.Linear = DefaultTextureLinear(Out.Channel);
        if (!OptionalBoolean(Table, "linear", Out.Linear, Error) ||
            !OptionalNumber(Table, "offset_u", Out.OffsetU, Error) || !OptionalNumber(Table, "offset_v", Out.OffsetV, Error) ||
            !OptionalNumber(Table, "scale_u", Out.ScaleU, Error) || !OptionalNumber(Table, "scale_v", Out.ScaleV, Error) ||
            !OptionalNumber(Table, "rotation", Out.Rotation, Error) || !OptionalNumber(Table, "scalar", Out.Scalar, Error)) return false;
        if (Out.Path.empty() || !IsRelativeAssetPath(Out.Path))
        {
            Error = "texture path must be a non-empty relative path";
            return false;
        }
        return true;
    }

    bool ReadEnvironmentTable(const TomlTable& Table, SpaceTomlEnvironment& Out, std::string& Error)
    {
        Out = SpaceTomlEnvironment{};
        if (!RequiredString(Table, "name", Out.Name, Error) ||
            !OptionalNumber(Table, "sun_hour", Out.SunHour, Error) || !OptionalNumber(Table, "fog_density", Out.FogDensity, Error) ||
            !OptionalNumber(Table, "atmosphere_scale", Out.AtmosphereScale, Error) || !OptionalNumber(Table, "moon_phase", Out.MoonPhase, Error) ||
            !OptionalString(Table, "terrain", Out.Terrain, Error) || !OptionalString(Table, "sky_probe", Out.SkyProbe, Error) ||
            !OptionalUnsigned(Table, "sky_probe_levels", Out.SkyProbeLevels, Error)) return false;
        if ((!Out.Terrain.empty() && !IsRelativeAssetPath(Out.Terrain)) || (!Out.SkyProbe.empty() && !IsRelativeAssetPath(Out.SkyProbe)))
        {
            Error = "environment '" + Out.Name + "' has an absolute or empty asset path";
            return false;
        }
        if (!std::isfinite(Out.SunHour) || !std::isfinite(Out.FogDensity) || !std::isfinite(Out.AtmosphereScale) || !std::isfinite(Out.MoonPhase))
        {
            Error = "environment '" + Out.Name + "' has a non-finite staging value";
            return false;
        }
        return true;
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

    void WriteStringArray(std::ostream& Out, const std::vector<std::string>& Values)
    {
        Out << '[';
        for (size_t I = 0u; I < Values.size(); ++I) Out << (I ? ", " : "") << Escape(Values[I]);
        Out << ']';
    }

    const char* MaterialModeName(uint8_t Mode)
    {
        if (Mode == kSpaceMaterialShared) return "shared";
        if (Mode == kSpaceMaterialCopied) return "copied";
        return "copy_on_write";
    }

    void WriteInstanceBody(std::ostream& Out, const SpaceTomlInstance& Instance)
    {
        Out << "name = " << Escape(Instance.Name) << "\nlevel = " << Escape(Instance.Level)
            << "\ngeometry = " << Escape(Instance.Geometry) << "\nmaterial = " << Escape(Instance.Material)
            << "\nmaterial_mode = " << Escape(MaterialModeName(Instance.MaterialMode)) << "\nflags = ";
        WriteFlags(Out, Instance.Flags, false);
        Out << "\ntransform = ";
        WriteFloatArray(Out, Instance.Transform, 16u);
        Out << "\n";
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
    if (!OptionalString(*Project, "environment", Out.Environment, OutError) ||
        !OptionalStringArray(*Project, "instance_files", Out.InstanceFiles, OutError)) return false;
    if ((!Out.Environment.empty() && !IsRelativeAssetPath(Out.Environment)) ||
        std::any_of(Out.InstanceFiles.begin(), Out.InstanceFiles.end(), [](const std::string& File) { return !IsRelativeAssetPath(File); }))
    {
        OutError = Path + ": [project] contains an empty or absolute environment/instance_files reference";
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
        if (!ReadInstanceTable(Table, Instance, OutError)) { OutError = Path + ": " + OutError; return false; }
        if (std::none_of(Out.Levels.begin(), Out.Levels.end(), [&](const SpaceTomlLevel& Level) { return Level.Name == Instance.Level; }))
        {
            OutError = Path + ": instance '" + Instance.Name + "' names undeclared level '" + Instance.Level + "'";
            return false;
        }
        Out.Instances.push_back(std::move(Instance));
    }
    return true;
}

bool SpaceTomlReadInstanceFile(const std::string& Path, SpaceTomlInstance& Out, std::string& OutError) noexcept
{
    Out = SpaceTomlInstance{};
    OutError.clear();
    std::vector<TomlTable> Tables;
    if (!ParseFile(Path, Tables, OutError)) return false;
    const TomlTable* Instance = Singleton(Tables, "instance");
    if (!Instance) { OutError = Path + ": missing [instance] table"; return false; }
    std::string Format;
    if (!RequiredString(*Instance, "format", Format, OutError) || !RequiredRevision(*Instance, OutError)) return false;
    if (Format != kSpaceTomlInstanceFormat)
    {
        OutError = Path + ": [instance].format must be \"" + std::string(kSpaceTomlInstanceFormat) + "\"";
        return false;
    }
    if (!ReadInstanceTable(*Instance, Out, OutError)) { OutError = Path + ": " + OutError; return false; }
    return true;
}

bool SpaceTomlReadEnvironmentFile(const std::string& Path, SpaceTomlEnvironment& Out, std::string& OutError) noexcept
{
    Out = SpaceTomlEnvironment{};
    OutError.clear();
    std::vector<TomlTable> Tables;
    if (!ParseFile(Path, Tables, OutError)) return false;
    const TomlTable* Environment = Singleton(Tables, "environment");
    if (!Environment) { OutError = Path + ": missing [environment] table"; return false; }
    std::string Format;
    if (!RequiredString(*Environment, "format", Format, OutError) || !RequiredRevision(*Environment, OutError)) return false;
    if (Format != kSpaceTomlEnvironmentFormat)
    {
        OutError = Path + ": [environment].format must be \"" + std::string(kSpaceTomlEnvironmentFormat) + "\"";
        return false;
    }
    if (!ReadEnvironmentTable(*Environment, Out, OutError)) { OutError = Path + ": " + OutError; return false; }
    return true;
}

bool SpaceTomlReadMaterialDocumentFile(const std::string& Path, SpaceTomlMaterial& Out, std::string& OutError) noexcept
{
    Out = SpaceTomlMaterial{};
    OutError.clear();
    std::vector<TomlTable> Tables;
    if (!ParseFile(Path, Tables, OutError)) return false;
    const TomlTable* Material = Singleton(Tables, "material");
    if (!Material) { OutError = Path + ": missing [material] table"; return false; }
    std::string Format;
    if (!RequiredString(*Material, "format", Format, OutError) || !RequiredRevision(*Material, OutError) ||
        !RequiredString(*Material, "name", Out.Descriptor.Name, OutError)) return false;
    if (Format != kSpaceTomlMaterialFormat)
    {
        OutError = Path + ": [material].format must be \"" + std::string(kSpaceTomlMaterialFormat) + "\"";
        return false;
    }
    if (!OptionalNumber(*Material, "alpha_cutoff", Out.Descriptor.AlphaCutoff, OutError) ||
        !OptionalNumber(*Material, "volume_thickness", Out.Descriptor.VolumeThickness, OutError)) return false;
    Out.Descriptor.Flags = 0u;
    if (!OptionalFlags(*Material, "flags", Out.Descriptor.Flags, true, OutError)) return false;

    for (const TomlTable& Table : Tables)
    {
        if (!Table.ArrayElement || Table.Name != "slab") continue;
        MaterialSlabDescriptor Slab;
        if (!SetSlab(Table, Slab, OutError)) { OutError = Path + ": " + OutError; return false; }
        Out.Descriptor.Slabs.push_back(Slab);
    }
    if (Out.Descriptor.Slabs.empty()) { OutError = Path + ": a material requires at least one [[slab]]"; return false; }

    for (const TomlTable& Table : Tables)
    {
        if (!Table.ArrayElement || Table.Name != "texture") continue;
        SpaceTomlTexture Texture;
        if (!ReadTextureTable(Table, Texture, OutError)) { OutError = Path + ": " + OutError; return false; }
        if (Texture.Slab >= Out.Descriptor.Slabs.size())
        {
            OutError = Path + ": texture path '" + Texture.Path + "' names slab " + std::to_string(Texture.Slab) +
                       " of " + std::to_string(Out.Descriptor.Slabs.size());
            return false;
        }
        if (std::any_of(Out.Textures.begin(), Out.Textures.end(), [&](const SpaceTomlTexture& Existing)
            { return Existing.Slab == Texture.Slab && Existing.Channel == Texture.Channel; }))
        {
            OutError = Path + ": more than one texture names slab " + std::to_string(Texture.Slab) + " channel " + TextureChannelName(Texture.Channel);
            return false;
        }
        Out.Textures.push_back(std::move(Texture));
    }
    return true;
}

bool SpaceTomlReadMaterialFile(const std::string& Path, MaterialDescriptor& Out, std::string& OutError) noexcept
{
    SpaceTomlMaterial Material;
    if (!SpaceTomlReadMaterialDocumentFile(Path, Material, OutError)) { Out = MaterialDescriptor{}; return false; }
    Out = std::move(Material.Descriptor);
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
        << "\ndefault_level = " << Escape(Project.DefaultLevel);
    if (!Project.Environment.empty()) Out << "\nenvironment = " << Escape(Project.Environment);
    if (!Project.InstanceFiles.empty())
    {
        Out << "\ninstance_files = ";
        WriteStringArray(Out, Project.InstanceFiles);
    }
    Out << "\n";
    for (const SpaceTomlLevel& Level : Project.Levels)
        Out << "\n[[level]]\nname = " << Escape(Level.Name) << "\n";
    for (const SpaceTomlInstance& Instance : Project.Instances)
    {
        Out << "\n[[instance]]\n";
        WriteInstanceBody(Out, Instance);
    }
    if (!Out.good()) { OutError = "cannot finish " + Path; return false; }
    return true;
}

bool SpaceTomlWriteInstanceFile(const std::string& Path, const SpaceTomlInstance& Instance, std::string& OutError) noexcept
{
    OutError.clear();
    if (Instance.Name.empty() || Instance.Level.empty() || !IsRelativeAssetPath(Instance.Geometry) || !IsRelativeAssetPath(Instance.Material))
    {
        OutError = "a TOML instance needs a name, level, and relative geometry/material paths";
        return false;
    }
    std::ofstream Out;
    if (!OpenForWrite(Path, Out, OutError)) return false;
    Out << "# Frontier Space authored instance.\n\n[instance]\nformat = " << Escape(kSpaceTomlInstanceFormat)
        << "\nversion = " << kSpaceTomlRevision << "\n";
    WriteInstanceBody(Out, Instance);
    if (!Out.good()) { OutError = "cannot finish " + Path; return false; }
    return true;
}

bool SpaceTomlWriteEnvironmentFile(const std::string& Path, const SpaceTomlEnvironment& Environment, std::string& OutError) noexcept
{
    OutError.clear();
    if (Environment.Name.empty() || (!Environment.Terrain.empty() && !IsRelativeAssetPath(Environment.Terrain)) ||
        (!Environment.SkyProbe.empty() && !IsRelativeAssetPath(Environment.SkyProbe)))
    {
        OutError = "a TOML environment needs a name and relative terrain/sky-probe paths";
        return false;
    }
    std::ofstream Out;
    if (!OpenForWrite(Path, Out, OutError)) return false;
    Out << "# Frontier Space authored environment.\n\n[environment]\nformat = " << Escape(kSpaceTomlEnvironmentFormat)
        << "\nversion = " << kSpaceTomlRevision << "\nname = " << Escape(Environment.Name)
        << "\nsun_hour = " << Environment.SunHour << "\nfog_density = " << Environment.FogDensity
        << "\natmosphere_scale = " << Environment.AtmosphereScale << "\nmoon_phase = " << Environment.MoonPhase;
    if (!Environment.Terrain.empty()) Out << "\nterrain = " << Escape(Environment.Terrain);
    if (!Environment.SkyProbe.empty()) Out << "\nsky_probe = " << Escape(Environment.SkyProbe);
    if (Environment.SkyProbeLevels != 0u) Out << "\nsky_probe_levels = " << Environment.SkyProbeLevels;
    Out << "\n";
    if (!Out.good()) { OutError = "cannot finish " + Path; return false; }
    return true;
}

bool SpaceTomlWriteMaterialFile(const std::string& Path, const MaterialDescriptor& Material, std::string& OutError) noexcept
{
    SpaceTomlMaterial Document;
    Document.Descriptor = Material;
    return SpaceTomlWriteMaterialDocumentFile(Path, Document, OutError);
}

bool SpaceTomlWriteMaterialDocumentFile(const std::string& Path, const SpaceTomlMaterial& Material, std::string& OutError) noexcept
{
    OutError.clear();
    if (Material.Descriptor.Name.empty() || Material.Descriptor.Slabs.empty())
    {
        OutError = "a TOML material needs a name and at least one slab";
        return false;
    }
    for (const SpaceTomlTexture& Texture : Material.Textures)
    {
        if (Texture.Slab >= Material.Descriptor.Slabs.size() || Texture.Path.empty() || !IsRelativeAssetPath(Texture.Path))
        {
            OutError = "a TOML material texture needs an existing slab and a relative path";
            return false;
        }
    }
    std::ofstream Out;
    if (!OpenForWrite(Path, Out, OutError)) return false;
    Out << "# Frontier Space authored material. Values are OpenPBR/Slate parameters in engine units.\n\n";
    Out << "[material]\nformat = " << Escape(kSpaceTomlMaterialFormat) << "\nversion = " << kSpaceTomlRevision
        << "\nname = " << Escape(Material.Descriptor.Name) << "\nflags = ";
    WriteFlags(Out, Material.Descriptor.Flags, true);
    Out << "\nalpha_cutoff = " << Material.Descriptor.AlphaCutoff << "\nvolume_thickness = " << Material.Descriptor.VolumeThickness << "\n";
    for (const MaterialSlabDescriptor& Slab : Material.Descriptor.Slabs)
    {
        Out << "\n[[slab]]\n";
        WriteSlab(Out, Slab);
    }
    for (const SpaceTomlTexture& Texture : Material.Textures)
    {
        Out << "\n[[texture]]\nslab = " << Texture.Slab << "\nchannel = " << Escape(TextureChannelName(Texture.Channel))
            << "\npath = " << Escape(Texture.Path) << "\nlinear = " << (Texture.Linear ? "true" : "false")
            << "\nuv_set = " << static_cast<uint32_t>(Texture.UvSet) << "\ncomponent = " << Escape(TextureComponentName(Texture.Component))
            << "\noffset_u = " << Texture.OffsetU << "\noffset_v = " << Texture.OffsetV
            << "\nscale_u = " << Texture.ScaleU << "\nscale_v = " << Texture.ScaleV
            << "\nrotation = " << Texture.Rotation << "\nscalar = " << Texture.Scalar << "\n";
    }
    if (!Out.good()) { OutError = "cannot finish " + Path; return false; }
    return true;
}

} // namespace Frontier

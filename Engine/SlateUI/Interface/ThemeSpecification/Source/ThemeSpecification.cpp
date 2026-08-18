//============================================================================================================================================
//                                                       THEMESPECIFICATION.CPP
//============================================================================================================================================
// 🧩 Exact theme and semantic-colour constants from
// References/remix-notch-ui/src/App.tsx.

#include "SlateUI/Interface/ThemeSpecification/Api/ThemeSpecification.h"

namespace Slate
{

namespace
{

constexpr ThemeDeclaration Themes[] = {
    {"OLED", Covering(0x000000u), Partial(0x09090Bu, .95), Covering(0xF4F4F5u), Covering(0x71717Au),
     Partial(0x27272Au, .80), Covering(0x121214u), Covering(0x000000u), Covering(0x121214u),
     Covering(0x09090Bu), Covering(0x151517u), Covering(0x222223u),
     Covering(0x1E1E20u), Covering(0x2A2A2Cu)},
    {"Dark", Covering(0x0A0A0Au), Partial(0x18181Bu, .95), Covering(0xF4F4F5u), Covering(0xA1A1AAu),
     Covering(0x27272Au), Covering(0x1F1F22u), Covering(0x18181Bu), Covering(0x27272Au),
     Covering(0x18181Bu), Covering(0x2F2F32u), Covering(0x464649u),
     Covering(0x3D3D3Fu), Covering(0x525255u)},
    {"Clean White", Covering(0xF4F4F5u), Partial(0xFFFFFFu, .95), Covering(0x18181Bu), Covering(0x71717Au),
     Covering(0xE4E4E7u), Covering(0xFAFAFAu), Covering(0xE5E5EAu), Covering(0xFFFFFFu),
     Covering(0xE5E5EAu), Covering(0xCECED3u), Covering(0xB7B7BBu),
     Covering(0xE6E6E6u), Covering(0xCCCCCCu)},
    {"Desert Sand", Covering(0xE8D5B5u), Partial(0xF2E5CCu, .95), Covering(0x4A3B2Cu), Covering(0x8A7356u),
     Covering(0xCFAE7Eu), Covering(0xFAEED9u), Covering(0xDCB679u), Covering(0xF4E4C4u),
     Covering(0xE8D5B5u), Covering(0xE3C99Du), Covering(0xE1C291u),
     Covering(0xEAD2A6u), Covering(0xE6C897u)},
    {"Purplish", Covering(0x0F0A1Cu), Partial(0x17102Bu, .95), Covering(0xF3E8FFu), Covering(0xC084FCu),
     Partial(0x581C87u, .50), Covering(0x1D1438u), Covering(0x1F163Du), Covering(0x2D2054u),
     Covering(0x23174Au), Covering(0x47366Eu), Covering(0x6B5692u),
     Covering(0x4F3E76u), Covering(0x715B98u)},
    {"Bluish", Covering(0x09111Cu), Partial(0x0F1B2Du, .95), Covering(0xDBEAFEu), Covering(0x60A5FAu),
     Partial(0x1E3A8Au, .50), Covering(0x15253Du), Covering(0x1A2D4Au), Covering(0x264066u),
     Covering(0x1C3152u), Covering(0x344F74u), Covering(0x4C6C96u),
     Covering(0x3C5B84u), Covering(0x5275A2u)}};

constexpr AccentDeclaration Accents[] = {{"Blue", Covering(0x3B82F6u)},  {"Cyan", Covering(0x06B6D4u)},
                                         {"Teal", Covering(0x14B8A6u)},  {"Emerald", Covering(0x10B981u)},
                                         {"Amber", Covering(0xF59E0Bu)}, {"Orange", Covering(0xF97316u)},
                                         {"Rose", Covering(0xF43F5Eu)},  {"Violet", Covering(0x8B5CF6u)}};

} // namespace

const ThemeDeclaration &ThemeSpecification::Theme(ThemeSubject Subject)
{
    const std::uint32_t Ordinal = static_cast<std::uint32_t>(Subject);
    return Themes[(Ordinal < static_cast<std::uint32_t>(ThemeSubject::SubjectCount)) ? Ordinal : 0u];
}

const AccentDeclaration &ThemeSpecification::Accent(AccentSubject Subject)
{
    const std::uint32_t Ordinal = static_cast<std::uint32_t>(Subject);
    return Accents[(Ordinal < static_cast<std::uint32_t>(AccentSubject::SubjectCount)) ? Ordinal : 0u];
}

} // namespace Slate

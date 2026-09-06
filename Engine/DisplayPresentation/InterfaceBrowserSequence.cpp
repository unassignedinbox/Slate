//============================================================================================================================================
//                                                  INTERFACEBROWSERSEQUENCE.CPP
//============================================================================================================================================

#include "InterfaceBrowserSequence.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace Frontier {

namespace {

constexpr float kPadX        = 20.0f;
constexpr float kCardRadius  = 18.0f;
constexpr float kRowGap      = 10.0f;
constexpr float kPropRowH    = 30.0f;
constexpr float kLabelW      = 76.0f;
constexpr float kPillW       = 104.0f;
constexpr float kPillUnitW   = 36.0f;
constexpr float kSliderMinW  = 90.0f;
constexpr float kSwatch      = 22.0f;
constexpr float kDoubleClick = 0.35f;   // [s] window for the rename gesture

// Palette for the container tint picker, matching the mock.
const ColorQuad kTintPalette[] = {
    { 0.788f, 0.635f, 0.294f, 1.0f }, { 0.937f, 0.325f, 0.314f, 1.0f },
    { 0.961f, 0.620f, 0.043f, 1.0f }, { 0.133f, 0.773f, 0.369f, 1.0f },
    { 0.231f, 0.510f, 0.965f, 1.0f }, { 0.545f, 0.361f, 0.965f, 1.0f },
    { 0.925f, 0.282f, 0.600f, 1.0f }, { 0.604f, 0.627f, 0.651f, 1.0f },
};
constexpr uint32_t kTintCount = sizeof(kTintPalette) / sizeof(kTintPalette[0]);

void FormatValue(char* Out, uint32_t Capacity, float Value, uint32_t Decimals) noexcept
{
    switch (Decimals)
    {
        case 0u:  std::snprintf(Out, Capacity, "%.0f", Value); break;
        case 1u:  std::snprintf(Out, Capacity, "%.1f", Value); break;
        case 3u:  std::snprintf(Out, Capacity, "%.3f", Value); break;
        default:  std::snprintf(Out, Capacity, "%.2f", Value); break;
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        INPUT
//------------------------------------------------------------------------------------------------------------------------

bool InterfaceBrowserSequence::EditingText() const noexcept
{
    return Tree.QueryRowCount() > 0u
        && (const_cast<InterfaceOutlinerSequence&>(Tree).RenameEntry().Active
         || const_cast<InterfaceOutlinerSequence&>(Tree).SearchEntry().Active);
}

// GLFW key codes, spelled out rather than included: this header must not depend on the window backend.
namespace {
constexpr uint32_t kKeyEnter = 257u, kKeyEscape = 256u, kKeyBackspace = 259u, kKeyDelete = 261u;
constexpr uint32_t kKeyRight = 262u, kKeyLeft = 263u, kKeyEnd = 269u, kKeyHome = 268u, kKeyA = 65u;
}

bool InterfaceBrowserSequence::RecordKey(uint32_t Key, bool Shift, bool Control) noexcept
{
    TextEntryState* Entry = nullptr;
    if (Tree.RenameEntry().Active)      Entry = &Tree.RenameEntry();
    else if (Tree.SearchEntry().Active) Entry = &Tree.SearchEntry();
    if (!Entry) return false;

    switch (Key)
    {
        case kKeyEnter:     Entry->Commit();               return true;
        case kKeyEscape:    Entry->Cancel();               return true;
        case kKeyBackspace: Entry->Backspace();            return true;
        case kKeyDelete:    Entry->Delete();               return true;
        case kKeyLeft:      Entry->MoveCaret(-1, Shift);   return true;
        case kKeyRight:     Entry->MoveCaret( 1, Shift);   return true;
        case kKeyHome:      Entry->MoveHome(Shift);        return true;
        case kKeyEnd:       Entry->MoveEnd(Shift);         return true;
        case kKeyA:         if (Control) { Entry->SelectAll(); return true; } return false;
        default:            return false;
    }
}

bool InterfaceBrowserSequence::RecordCharacter(uint32_t Codepoint) noexcept
{
    TextEntryState* Entry = nullptr;
    if (Tree.RenameEntry().Active)      Entry = &Tree.RenameEntry();
    else if (Tree.SearchEntry().Active) Entry = &Tree.SearchEntry();
    if (!Entry || Codepoint < 0x20u) return false;

    // UTF-8 encode; the entry stores bytes and steps its caret by character.
    char Bytes[5] = {};
    if (Codepoint < 0x80u) { Bytes[0] = static_cast<char>(Codepoint); }
    else if (Codepoint < 0x800u)
    {
        Bytes[0] = static_cast<char>(0xC0u | (Codepoint >> 6));
        Bytes[1] = static_cast<char>(0x80u | (Codepoint & 0x3Fu));
    }
    else
    {
        Bytes[0] = static_cast<char>(0xE0u | (Codepoint >> 12));
        Bytes[1] = static_cast<char>(0x80u | ((Codepoint >> 6) & 0x3Fu));
        Bytes[2] = static_cast<char>(0x80u | (Codepoint & 0x3Fu));
    }
    Entry->Insert(Bytes);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        FRAME
//------------------------------------------------------------------------------------------------------------------------

void InterfaceBrowserSequence::Advance(float DeltaSeconds) noexcept
{
    Tree.Advance(DeltaSeconds);
    if (DoubleClickTimer > 0.0f) DoubleClickTimer -= DeltaSeconds;

    const float Target = Mode == OutlinerLayoutMode::TreeOnly       ? 1.0f
                       : Mode == OutlinerLayoutMode::PropertiesOnly ? 0.0f
                                                                    : 0.54f;
    const float Step = (kSplitSeconds > 0.0f) ? DeltaSeconds / kSplitSeconds : 1.0f;
    if (SplitNow < Target)      SplitNow = std::min(Target, SplitNow + Step);
    else if (SplitNow > Target) SplitNow = std::max(Target, SplitNow - Step);
}

void InterfaceBrowserSequence::Record(PixelSpace& Surface, const PlaneExtent& Extent,
                                      const ControlPointer& Pointer, float Opacity) noexcept
{
    Surface.FillRectangle(Extent, ControlKit::Faded(ControlKit::Palette().Panel, Opacity), 0.0f);

    const PlaneExtent Header = Spanning(Extent.MinimumX, Extent.MinimumY, Extent.Width(), kHeaderHeight);
    RecordHeader(Surface, Header, Pointer, Opacity);

    const float BodyTop    = Extent.MinimumY + kHeaderHeight;
    const float BodyBottom = Extent.MaximumY - kFooterHeight;
    const float SplitX     = Extent.MinimumX + Extent.Width() * SplitNow;

    // ── Tree side ────────────────────────────────────────────────────────────────────────────────────────────────
    if (SplitNow > 0.01f)
    {
        const float Fade = std::min(1.0f, SplitNow / 0.2f) * Opacity;   // fades out as it collapses
        const PlaneExtent Side = PlaneExtent{ Extent.MinimumX, BodyTop, SplitX, BodyBottom };

        ControlKit::TextLeading(Surface, Spanning(Side.MinimumX + kPadX, BodyTop + 10.0f, 200.0f, 18.0f), 0.0f,
                                ControlKit::Faded(ControlKit::Palette().TextFaint, Fade), "OUTLINER", 10.0f);

        const PlaneExtent SearchRow = Spanning(Side.MinimumX, BodyTop + 30.0f, Side.Width(), 34.0f);
        RecordSearchRow(Surface, SearchRow, Pointer, Fade);

        // Active filters become removable chips on their own row, so adding one never reflows the search field.
        float ChipY = SearchRow.MaximumY + 8.0f;
        float ChipX = Side.MinimumX + kPadX;
        const uint32_t Filters = Tree.FilterCount();
        if (Filters > 0u)
        {
            for (uint32_t T = 0u; T < 32u; ++T)
            {
                if (!Tree.TypeFiltered(T)) continue;
                const char* Label = Tree.QueryType(T).Label;
                const float W = ControlKit::ChipWidth(Surface, Label) + 18.0f;
                const PlaneExtent Chip = Spanning(ChipX, ChipY, W, 26.0f);
                Surface.FillRectangle(Chip, ControlKit::Faded(ControlKit::Palette().Primary, Fade), 13.0f);
                ControlKit::TextLeading(Surface, Chip, 11.0f, ControlKit::Faded(ControlKit::Palette().PrimaryInk, Fade), Label, 11.0f);
                const PlaneExtent Cross = Spanning(Chip.MaximumX - 20.0f, ChipY + 4.0f, 17.0f, 17.0f);
                ControlKit::GlyphCentred(Surface, Cross, 9.0f, ControlKit::Faded(ControlKit::Palette().PrimaryInk, Fade),
                                         ControlCentreIconCategory::CloseCross, 2.2f);
                if (ControlKit::Over(Cross, Pointer) && Pointer.Released) Tree.ToggleTypeFilter(T);
                ChipX += W + 7.0f;
            }
            ChipY += 26.0f + 8.0f;
        }

        const PlaneExtent TreeArea = PlaneExtent{ Side.MinimumX + 12.0f, ChipY, Side.MaximumX - 6.0f, BodyBottom };
        const uint32_t Touched = Tree.Record(Surface, TreeArea, Pointer, Fade);

        // Double click renames. Tracked here rather than in the outliner so the gesture policy lives with the host
        //    that owns the clock.
        if (Touched != kOutlinerNoRow && Pointer.Released)
        {
            if (DoubleClickRow == Touched && DoubleClickTimer > 0.0f)
            {
                Tree.BeginRename(Touched);
                DoubleClickTimer = 0.0f;
                DoubleClickRow   = kOutlinerNoRow;
            }
            else
            {
                DoubleClickRow   = Touched;
                DoubleClickTimer = kDoubleClick;
            }
        }
    }

    // ── Divider ──────────────────────────────────────────────────────────────────────────────────────────────────
    if (SplitNow > 0.01f && SplitNow < 0.99f)
        Surface.FillRectangle(Spanning(SplitX, BodyTop, 1.0f, BodyBottom - BodyTop),
                              ControlKit::Faded(ControlKit::Palette().Stroke, Opacity));

    // ── Properties side ──────────────────────────────────────────────────────────────────────────────────────────
    if (SplitNow < 0.99f)
    {
        const float Fade = std::min(1.0f, (1.0f - SplitNow) / 0.2f) * Opacity;
        RecordProperties(Surface, PlaneExtent{ SplitX + 1.0f, BodyTop, Extent.MaximumX, BodyBottom }, Pointer, Fade);
    }

    // ── Footer ───────────────────────────────────────────────────────────────────────────────────────────────────
    const float FooterY = Extent.MaximumY - kFooterHeight;
    Surface.FillRectangle(Spanning(Extent.MinimumX, FooterY, Extent.Width(), 1.0f),
                          ControlKit::Faded(ControlKit::Palette().Stroke, Opacity));
    char Foot[96];
    const uint32_t Selected = Tree.QuerySelection();
    std::snprintf(Foot, sizeof(Foot), "%s", Selected == kOutlinerNoRow ? "nothing selected" : "1 selected");
    ControlKit::TextLeading(Surface, Spanning(Extent.MinimumX + kPadX, FooterY, 200.0f, kFooterHeight), 0.0f,
                            ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity), Foot, 11.5f);

    if (Tree.SearchEntry().Length > 0u || Tree.FilterCount() > 0u)
    {
        char Hits[64];
        std::snprintf(Hits, sizeof(Hits), "%u matched", Tree.QueryMatchCount());
        ControlKit::TextLeading(Surface, Spanning(Extent.MinimumX + kPadX + 110.0f, FooterY, 160.0f, kFooterHeight), 0.0f,
                                ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity), Hits, 11.5f);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       HEADER
//------------------------------------------------------------------------------------------------------------------------

void InterfaceBrowserSequence::RecordHeader(PixelSpace& Surface, const PlaneExtent& Extent,
                                            const ControlPointer& Pointer, float Opacity) noexcept
{
    Surface.FillRectangle(Spanning(Extent.MinimumX, Extent.MaximumY - 1.0f, Extent.Width(), 1.0f),
                          ControlKit::Faded(ControlKit::Palette().Stroke, Opacity));

    // In properties-only mode the header names the selected object, since the tree that would otherwise say so
    //    is not on screen.
    const uint32_t Selected = Tree.QuerySelection();
    const bool     NameIt   = (Mode == OutlinerLayoutMode::PropertiesOnly) && Selected != kOutlinerNoRow;
    const char*    Title    = NameIt ? Tree.QueryRow(Selected).Name : HeaderTitle;
    const char*    Sub      = NameIt ? Tree.QueryType(Tree.QueryRow(Selected).TypeOrdinal).Label : HeaderSubtitle;

    ControlKit::TextLeading(Surface, Spanning(Extent.MinimumX + kPadX, Extent.MinimumY + 10.0f, 240.0f, 18.0f), 0.0f,
                            ControlKit::Faded(ControlKit::Palette().Text, Opacity), Title, 14.0f);
    ControlKit::TextLeading(Surface, Spanning(Extent.MinimumX + kPadX, Extent.MinimumY + 30.0f, 240.0f, 14.0f), 0.0f,
                            ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity), Sub, 11.0f);

    // Three layout buttons on the trailing edge.
    const ControlCentreIconCategory Icons[3] = {
        ControlCentreIconCategory::SlidersQuality,   // tree only
        ControlCentreIconCategory::DisplayMonitor,   // split
        ControlCentreIconCategory::SettingsGear,     // properties only
    };
    float X = Extent.MaximumX - kPadX - 16.0f;
    for (int I = 2; I >= 0; --I)
    {
        const PlaneExtent Cell = Spanning(X - 14.0f, Extent.MinimumY + 14.0f, 28.0f, 28.0f);
        const bool Active = static_cast<uint32_t>(I) == static_cast<uint32_t>(Mode);
        Surface.FillRectangle(Cell, ControlKit::Faded(Active ? ControlKit::Palette().Primary
                                                             : ControlKit::Palette().Raised, Opacity), 14.0f);
        ControlKit::GlyphCentred(Surface, Cell, 13.0f,
            ControlKit::Faded(Active ? ControlKit::Palette().PrimaryInk : ControlKit::Palette().TextDim, Opacity),
            Icons[I], 2.0f);
        if (ControlKit::Over(Cell, Pointer) && Pointer.Released) Mode = static_cast<OutlinerLayoutMode>(I);
        X -= 34.0f;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SEARCH ROW
//------------------------------------------------------------------------------------------------------------------------

void InterfaceBrowserSequence::RecordSearchRow(PixelSpace& Surface, const PlaneExtent& Extent,
                                               const ControlPointer& Pointer, float Opacity) noexcept
{
    // Search and the filter dropdown share the line; the dropdown is fixed width so the field absorbs any resize.
    const float MenuW  = 132.0f;
    const PlaneExtent Field = Spanning(Extent.MinimumX + kPadX, Extent.MinimumY,
                                       Extent.Width() - kPadX * 2.0f - MenuW - 8.0f, Extent.Height());
    const PlaneExtent Menu  = Spanning(Field.MaximumX + 8.0f, Extent.MinimumY, MenuW, Extent.Height());

    ControlKit::GlyphCentred(Surface, Spanning(Field.MinimumX + 4.0f, Field.MinimumY + 9.0f, 16.0f, 16.0f), 12.0f,
                             ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity),
                             ControlCentreIconCategory::SettingsGear, 2.0f);

    const PlaneExtent Inner = Spanning(Field.MinimumX + 24.0f, Field.MinimumY, Field.Width() - 30.0f, Field.Height());
    if (Tree.SearchEntry().Active || Tree.SearchEntry().Length > 0u)
    {
        ControlKit::TextEntry(Surface, Field, Tree.SearchEntry(), Pointer, 12.5f, Opacity);
    }
    else
    {
        Surface.FillRectangle(Field, ControlKit::Faded(ControlKit::Palette().Field, Opacity), Field.Height() * 0.5f);
        ControlKit::OutlineRounded(Surface, Field, ControlKit::Faded(ControlKit::Palette().Stroke, Opacity), Field.Height() * 0.5f);
        ControlKit::TextLeading(Surface, Inner, 0.0f, ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity),
                                "Search objects…", 12.5f);
    }
    if (ControlKit::Over(Field, Pointer) && Pointer.Released && !Tree.SearchEntry().Active)
        Tree.SearchEntry().Begin(Tree.SearchEntry().Text);

    // Filter dropdown.
    const uint32_t Filters = Tree.FilterCount();
    char Label[32];
    if (Filters == 0u)      std::snprintf(Label, sizeof(Label), "All types");
    else if (Filters == 1u) std::snprintf(Label, sizeof(Label), "1 type");
    else                    std::snprintf(Label, sizeof(Label), "%u types", Filters);

    if (ControlKit::Dropdown(Surface, Menu, Label, MenuOpen, Pointer, Opacity).Clicked) MenuOpen = !MenuOpen;

    if (MenuOpen)
    {
        // Only registered types appear, so the menu can never offer a filter that matches nothing.
        const char* Names[16]; uint32_t Ordinals[16]; uint32_t Count = 0u;
        for (uint32_t T = 0u; T < 16u && Count < 16u; ++T)
        {
            const OutlinerTypeRecord& Type = Tree.QueryType(T);
            if (!Type.Label || !Type.Label[0] || Type.Container) continue;
            Names[Count] = Type.Label; Ordinals[Count] = T; ++Count;
        }
        uint32_t Chosen = 0xFFFFFFFFu;
        ControlKit::DropdownMenu(Surface, Menu, Names, Count, 0xFFFFFFFFu, Pointer, Chosen, Opacity);
        if (Chosen != 0xFFFFFFFFu && Chosen < Count)
        {
            Tree.ToggleTypeFilter(Ordinals[Chosen]);
            MenuOpen = false;
        }
        else if (Pointer.Released && !ControlKit::Over(Menu, Pointer)
                 && !ControlKit::Over(ControlKit::DropdownMenuExtent(Menu, Count), Pointer))
        {
            MenuOpen = false;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PROPERTIES
//------------------------------------------------------------------------------------------------------------------------

void InterfaceBrowserSequence::RecordProperties(PixelSpace& Surface, const PlaneExtent& Extent,
                                                const ControlPointer& Pointer, float Opacity) noexcept
{
    const uint32_t Selected = Tree.QuerySelection();
    if (Selected == kOutlinerNoRow)
    {
        ControlKit::TextCentred(Surface, Extent, ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity),
                                "Select an object to see its properties", 12.0f);
        return;
    }

    Properties.clear();                       // capacity is retained, so no allocation after the first frame
    if (Builder_) Builder_(Selected, Properties);
    if (Properties.empty()) return;

    Surface.PushClip(Extent);

    const float CardX = Extent.MinimumX + 18.0f;
    const float CardW = std::max(Extent.Width() - 36.0f, 120.0f);
    float Y = Extent.MinimumY + 14.0f;

    // Cards are opened by a Heading row and closed by the next one, so the project describes structure by
    //    ordering alone and never computes a rectangle.
    float CardTop   = Y;
    bool  CardOpen  = false;
    const auto CloseCard = [&]()
    {
        if (!CardOpen) return;
        Surface.FillRectangle(Spanning(CardX, CardTop, CardW, Y - CardTop + 14.0f),
                              ControlKit::Faded(ControlKit::Palette().Inset, Opacity), kCardRadius);
        CardOpen = false;
    };

    // First pass paints the card backgrounds behind the rows; the row pass then draws over them.
    {
        float ScanY = Y; float ScanTop = Y; bool ScanOpen = false;
        for (const PropertyRowRecord& R : Properties)
        {
            if (R.Kind == PropertyKindCategory::Heading)
            {
                if (ScanOpen)
                    Surface.FillRectangle(Spanning(CardX, ScanTop, CardW, ScanY - ScanTop + 14.0f),
                                          ControlKit::Faded(ControlKit::Palette().Inset, Opacity), kCardRadius);
                ScanTop = ScanY; ScanOpen = true;
                ScanY += 30.0f;
                continue;
            }
            ScanY += (R.Kind == PropertyKindCategory::Notes ? 80.0f : kPropRowH) + kRowGap;
        }
        if (ScanOpen)
            Surface.FillRectangle(Spanning(CardX, ScanTop, CardW, ScanY - ScanTop + 14.0f),
                                  ControlKit::Faded(ControlKit::Palette().Inset, Opacity), kCardRadius);
    }
    (void)CloseCard;

    const float InnerX = CardX + 16.0f;
    const float InnerW = CardW - 32.0f;

    for (uint32_t Index = 0u; Index < Properties.size(); ++Index)
    {
        PropertyRowRecord& R = Properties[Index];

        if (R.Kind == PropertyKindCategory::Heading)
        {
            CardTop = Y; CardOpen = true;
            ControlKit::TextLeading(Surface, Spanning(InnerX, Y + 12.0f, InnerW, 14.0f), 0.0f,
                                    ControlKit::Faded(ControlKit::Palette().TextFaint, Opacity), R.Label, 10.5f);
            Y += 30.0f;
            continue;
        }

        const float RowH = (R.Kind == PropertyKindCategory::Notes) ? 80.0f : kPropRowH;
        const PlaneExtent Row = Spanning(InnerX, Y, InnerW, RowH);

        if (R.Kind != PropertyKindCategory::Notes)
            ControlKit::TextLeading(Surface, Spanning(InnerX, Y, kLabelW, RowH), 0.0f,
                                    ControlKit::Faded(ControlKit::Palette().TextDim, Opacity), R.Label, 12.0f);

        const float ControlX = InnerX + kLabelW + 12.0f;
        const float ControlW = std::max(Row.MaximumX - ControlX, 40.0f);

        switch (R.Kind)
        {
            case PropertyKindCategory::Slider:
            {
                // Row order is the kit's .crow: label → value pill → slider.
                char Number[32];
                FormatValue(Number, sizeof(Number), R.Value ? *R.Value : 0.0f, R.Decimals);
                ControlKit::ValuePill(Surface, ControlX, Y + (RowH - 30.0f) * 0.5f, Number, R.Unit, Opacity);

                const float TrackX = ControlX + kPillW + 12.0f;
                const float TrackW = std::max(Row.MaximumX - TrackX, kSliderMinW);
                const PlaneExtent Track = Spanning(TrackX, Y, TrackW, RowH);

                float Out = R.Value ? *R.Value : 0.0f;
                const bool Dragging = (DragRow == Index);
                const ControlHit Hit = ControlKit::Slider(Surface, Track, R.Minimum, R.Maximum, Out,
                                                          Dragging, Pointer, Out, false, false, Opacity);
                if (!R.ReadOnly && R.Value)
                {
                    if (Hit.Hovered && Pointer.Pressed) DragRow = Index;
                    if (DragRow == Index)               *R.Value = Out;
                }
                if (Pointer.Released && DragRow == Index) DragRow = kOutlinerNoRow;
                break;
            }

            case PropertyKindCategory::Switch:
            {
                const float SwitchY = Y + (RowH - ControlKit::SwitchHeight) * 0.5f;
                const ControlHit Hit = ControlKit::Switch(Surface, ControlX, SwitchY, R.Flag && *R.Flag, Pointer, Opacity);
                if (Hit.Clicked && R.Flag && !R.ReadOnly) *R.Flag = !*R.Flag;
                break;
            }

            case PropertyKindCategory::Vector:
            {
                // Three axis pills: a coloured letter cell leading the number, X / Y / Z.
                static const char* Axis[3]  = { "X", "Y", "Z" };
                static const ColorQuad Ink[3] = { { 0.937f, 0.325f, 0.314f, 1.0f },
                                                  { 0.412f, 0.816f, 0.427f, 1.0f },
                                                  { 0.357f, 0.549f, 1.0f,   1.0f } };
                const float Gap  = 6.0f;
                const float Each = (ControlW - Gap * 2.0f) / 3.0f;
                for (uint32_t A = 0u; A < 3u; ++A)
                {
                    const PlaneExtent Cell = Spanning(ControlX + static_cast<float>(A) * (Each + Gap),
                                                      Y + (RowH - 30.0f) * 0.5f, Each, 30.0f);
                    Surface.FillRectangle(Cell, ControlKit::Faded(ControlKit::Palette().Field, Opacity), 15.0f);
                    Surface.FillRectangle(Spanning(Cell.MinimumX, Cell.MinimumY, 26.0f, 30.0f),
                                          ControlKit::Faded(ControlKit::Palette().Inset, Opacity), 15.0f);
                    ControlKit::OutlineRounded(Surface, Cell, ControlKit::Faded(ControlKit::Palette().Stroke, Opacity), 15.0f);
                    ControlKit::TextCentred(Surface, Spanning(Cell.MinimumX, Cell.MinimumY, 26.0f, 30.0f),
                                            ControlKit::Faded(Ink[A], Opacity), Axis[A], 11.0f);
                    char Number[32];
                    FormatValue(Number, sizeof(Number), R.Vector3 ? R.Vector3[A] : 0.0f, 2u);
                    ControlKit::TextLeading(Surface, Spanning(Cell.MinimumX + 26.0f, Cell.MinimumY, Cell.Width() - 26.0f, 30.0f),
                                            8.0f, ControlKit::Faded(R.ReadOnly ? ControlKit::Palette().TextFaint
                                                                               : ControlKit::Palette().Text, Opacity),
                                            Number, 12.0f);
                }
                break;
            }

            case PropertyKindCategory::Readout:
                ControlKit::TextLeading(Surface, Spanning(ControlX, Y, ControlW, RowH), 0.0f,
                                        ControlKit::Faded(ControlKit::Palette().TextDim, Opacity), R.Text, 11.5f);
                break;

            case PropertyKindCategory::Tint:
            {
                float SwatchX = ControlX;
                // A "none" swatch first: a container that has been tinted must be able to go back to its type colour.
                const PlaneExtent None = Spanning(SwatchX, Y + (RowH - kSwatch) * 0.5f, kSwatch, kSwatch);
                ControlKit::OutlineCircle(Surface, None.MinimumX + kSwatch * 0.5f, None.MinimumY + kSwatch * 0.5f,
                                          kSwatch * 0.5f, ControlKit::Faded(ControlKit::Palette().StrokeStrong, Opacity), 1.0f);
                if (R.HasTint && !*R.HasTint)
                    ControlKit::OutlineCircle(Surface, None.MinimumX + kSwatch * 0.5f, None.MinimumY + kSwatch * 0.5f,
                                              kSwatch * 0.5f + 2.0f, ControlKit::Faded(ControlKit::Palette().Text, Opacity), 2.0f);
                if (ControlKit::Over(None, Pointer) && Pointer.Released && R.HasTint) *R.HasTint = false;
                SwatchX += kSwatch + 8.0f;

                for (uint32_t C = 0u; C < kTintCount; ++C)
                {
                    const PlaneExtent Cell = Spanning(SwatchX, Y + (RowH - kSwatch) * 0.5f, kSwatch, kSwatch);
                    const bool Chosen = R.HasTint && *R.HasTint && R.Tint
                                     && std::fabs(R.Tint->Red   - kTintPalette[C].Red)   < 0.01f
                                     && std::fabs(R.Tint->Green - kTintPalette[C].Green) < 0.01f
                                     && std::fabs(R.Tint->Blue  - kTintPalette[C].Blue)  < 0.01f;
                    ControlKit::Swatch(Surface, Cell.MinimumX + kSwatch * 0.5f, Cell.MinimumY + kSwatch * 0.5f,
                                       kTintPalette[C], Chosen, true, Pointer, Opacity);
                    if (ControlKit::Over(Cell, Pointer) && Pointer.Released && R.Tint && R.HasTint)
                    {
                        *R.Tint = kTintPalette[C];
                        *R.HasTint = true;
                    }
                    SwatchX += kSwatch + 8.0f;
                    if (SwatchX + kSwatch > Row.MaximumX) break;
                }
                break;
            }

            case PropertyKindCategory::Notes:
            {
                const PlaneExtent Box = Spanning(InnerX, Y, InnerW, RowH - 6.0f);
                Surface.FillRectangle(Box, ControlKit::Faded(ControlKit::Palette().Field, Opacity), 12.0f);
                ControlKit::OutlineRounded(Surface, Box, ControlKit::Faded(ControlKit::Palette().Stroke, Opacity), 12.0f);
                ControlKit::TextLeading(Surface, Spanning(Box.MinimumX, Box.MinimumY + 6.0f, Box.Width(), 18.0f), 12.0f,
                                        ControlKit::Faded(R.Text && R.Text[0] ? ControlKit::Palette().Text
                                                                              : ControlKit::Palette().TextFaint, Opacity),
                                        R.Text && R.Text[0] ? R.Text : "Notes…", 12.0f);
                break;
            }

            case PropertyKindCategory::Heading: break;   // handled above
        }

        Y += RowH + kRowGap;
    }

    Surface.PopClip();
}

} // namespace Frontier

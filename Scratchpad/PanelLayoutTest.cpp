// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  PanelLayoutTest.cpp — a property row fits inside its card, and a pane can reach all of its content
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  Three defects, all reported from the World Browser, all of them geometry rather than rendering:
//
//    · the slider ran off the card, off the window and past the edge of the screen. The row reserved 104 px for
//      a pill the kit drew at 118, then forced the slider to a 90 px minimum measured from wherever that left
//      off. What reached the screen was a track painted across the pill's unit cell and a control that could
//      not be grabbed at all;
//
//    · neither pane scrolled, so the lower half of a tall panel was unreachable. The Sky Atmosphere card alone
//      is taller than the pane on a normal window;
//
//    · dragging a slider dragged the WINDOW as well, because the panel's widgets are painted straight into the
//      window's draw list and ImGui therefore believes the whole body is empty background — and pressing empty
//      background is how a window is moved. That one is asserted in the gate rather than here, since it is a
//      property of the ImGui call sequence and not of any arithmetic.
//
//  Every assertion below is geometry the drawing code shares, not a screenshot of it.
//
//  Build: see Scratchpad/CheckPanelLayout.sh
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

#include "DisplayPresentation/ControlKit.h"
#include "DisplayPresentation/ThemeStructure.h"
#include "DisplayPresentation/InterfaceBrowserSequence.h"

#include <cmath>
#include <cstdio>
#include <initializer_list>

using namespace Frontier;

static int Failures = 0;

static void Expect(bool Condition, const char* What)
{
    std::printf("  %-70s %s\n", What, Condition ? "PASS" : "FAIL");
    if (!Condition) ++Failures;
}

int main()
{
    std::printf("PanelLayout — the World Browser's rows and panes\n");

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n1. a property row never draws outside its card, at any pane width\n");
    {
        // 🔴 The reported defect. The card is the only thing the pane clips to, so anything wider than it is
        //    painted onto the window frame and then onto the desktop. Swept rather than spot-checked: the
        //    failure appeared only below a certain width, which is exactly the case a single example misses.
        const float InnerX = 100.0f;
        bool Inside = true, Ordered = true, Disjoint = true;
        std::printf("     inner width   pill        slider          fits\n");
        for (float InnerWidth = 60.0f; InnerWidth <= 460.0f; InnerWidth += 1.0f)
        {
            const PropertyRowGeometry G = SolvePropertyRow(InnerX, InnerWidth);
            const float Right = InnerX + InnerWidth;

            if (G.PillX + G.PillWidth > Right + 0.01f) Inside = false;
            if (G.SliderVisible && G.SliderX + G.SliderWidth > Right + 0.01f) Inside = false;
            if (G.PillX < InnerX - 0.01f) Inside = false;

            // The pill leads and the slider follows, and they may not overlap — an overlap is what drew a track
            //    across the unit cell and hid the number the row exists to show.
            if (G.SliderVisible && G.SliderX < G.PillX + G.PillWidth - 0.01f) Disjoint = false;
            if (G.PillWidth < 20.0f) Ordered = false;

            if (std::fmod(InnerWidth, 100.0f) < 0.5f)
                std::printf("     %11.0f   %3.0f @ %3.0f   %3.0f @ %3.0f   %s\n",
                            static_cast<double>(InnerWidth),
                            static_cast<double>(G.PillWidth),  static_cast<double>(G.PillX - InnerX),
                            static_cast<double>(G.SliderWidth), static_cast<double>(G.SliderX - InnerX),
                            G.SliderVisible ? "slider" : "pill only");
        }
        Expect(Inside,   "every element stays inside the card across a 400 px sweep of pane widths");
        Expect(Disjoint, "the slider never overlaps the value pill");
        Expect(Ordered,  "the pill always has width to draw into");

        // And the old arithmetic, so the regression is recognisable if it comes back. 104 reserved, 118 drawn,
        //    then a 90 px slider from the end of the 104.
        const float OldInnerWidth = 237.0f;   // the properties pane at the reported window size
        const float OldPillX      = InnerX + 76.0f + 12.0f;
        const float OldSliderX    = OldPillX + 104.0f + 12.0f;
        const float OldOverhang   = (OldSliderX + 90.0f) - (InnerX + OldInnerWidth);
        std::printf("     the previous arithmetic overhung the card by %.0f px at this width\n",
                    static_cast<double>(OldOverhang));
        Expect(OldOverhang > 20.0f, "the old layout really did overflow — this is the bug being fixed");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n2. the pill is drawn at the width the row reserved for it\n");
    {
        // Two constants, one row. The kit's 118 px pill against the mock's 104 px reservation is precisely the
        //    14 px that put the slider on top of the unit cell.
        Expect(std::fabs(ControlKit::PropertyPillWidth - 104.0f) < 0.01f,
               "the property pill is the mock's 104 px");
        Expect(std::fabs(ControlKit::PropertyPillUnitWidth - 36.0f) < 0.01f,
               "with the mock's 36 px unit cell");
        Expect(ControlKit::PropertyPillWidth < ControlKit::ValuePillWidth,
               "and it is a different, narrower pill from the Notch inspectors' — hence the parameter");

        const PropertyRowGeometry G = SolvePropertyRow(0.0f, 400.0f);
        Expect(std::fabs(G.PillWidth - ControlKit::PropertyPillWidth) < 0.01f,
               "a roomy row uses the full pill width unshrunk");
        Expect(G.PillUnitWidth < G.PillWidth,
               "the unit cell always leaves a number cell to draw in");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n3. space is given up in a defined order as the pane narrows\n");
    {
        // The slider yields first because it stays usable while it shrinks; the pill only starts giving up room
        //    once the slider is at its minimum; the label never moves.
        const PropertyRowGeometry Roomy  = SolvePropertyRow(0.0f, 400.0f);
        const PropertyRowGeometry Tight  = SolvePropertyRow(0.0f, 300.0f);
        const PropertyRowGeometry Narrow = SolvePropertyRow(0.0f, 250.0f);

        std::printf("     400 px: pill %.0f slider %.0f\n", static_cast<double>(Roomy.PillWidth),  static_cast<double>(Roomy.SliderWidth));
        std::printf("     300 px: pill %.0f slider %.0f\n", static_cast<double>(Tight.PillWidth),  static_cast<double>(Tight.SliderWidth));
        std::printf("     250 px: pill %.0f slider %.0f\n", static_cast<double>(Narrow.PillWidth), static_cast<double>(Narrow.SliderWidth));

        Expect(Tight.SliderWidth < Roomy.SliderWidth, "the slider is the first to give up room");
        Expect(std::fabs(Tight.PillWidth - Roomy.PillWidth) < 0.01f,
               "and the pill keeps its full width while the slider still has room to give");
        Expect(Narrow.PillWidth < Roomy.PillWidth, "only then does the pill start to shrink");
        Expect(Narrow.PillX == Roomy.PillX,        "the label holds its width while anything else can still give");

        // It does yield eventually. Below the point where holding it would leave the pill nothing at all, a row
        //    of pure label with no value on it tells the user less than a cramped one does.
        const PropertyRowGeometry Extreme = SolvePropertyRow(0.0f, 100.0f);
        Expect(Extreme.PillX < Roomy.PillX,   "at the extreme the label yields too, rather than crowding the value out");
        Expect(Extreme.PillWidth >= 24.0f,    "and a value is still drawn");

        // Below the point where a slider could express a position at all it is dropped rather than drawn as a
        //    sliver nobody can aim at.
        const PropertyRowGeometry Cramped = SolvePropertyRow(0.0f, 150.0f);
        std::printf("     150 px: pill %.0f, slider %s\n", static_cast<double>(Cramped.PillWidth),
                    Cramped.SliderVisible ? "drawn" : "dropped");
        Expect(!Cramped.SliderVisible, "a slider narrower than its own thumb is dropped, not drawn");
        Expect(Cramped.PillWidth > 0.0f && Cramped.PillX + Cramped.PillWidth <= 150.0f + 0.01f,
               "and the number still fits and is still readable");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n4. scrolling reaches all of the content and none of the empty space\n");
    {
        // 🔴 Reported as "there is no scrolling on the outliner". There was none: the tree laid its rows out
        //    from the top of the pane and clipped, so anything past the fold could not be reached at all.
        const float View = 400.0f, Content = 1000.0f;

        // Scrolling down stops exactly at the last of the content, never past it into blank space.
        float Offset = 0.0f;
        for (int Click = 0; Click < 100; ++Click) Offset = ControlKit::AdvanceScroll(Offset, -1.0f, Content, View);
        std::printf("     after 100 clicks down, offset %.1f of a %.0f travel\n",
                    static_cast<double>(Offset), static_cast<double>(Content - View));
        Expect(std::fabs(Offset - (Content - View)) < 0.01f, "scrolling down stops at the end of the content");

        for (int Click = 0; Click < 100; ++Click) Offset = ControlKit::AdvanceScroll(Offset, 1.0f, Content, View);
        Expect(std::fabs(Offset) < 0.01f, "and scrolling up stops at the top, not above it");

        // ⚠️ A pane with nothing to scroll must not move at all. Without the clamp a short list slides up out of
        //    view and the pane looks broken rather than merely empty.
        float Short = 0.0f;
        for (int Click = 0; Click < 10; ++Click) Short = ControlKit::AdvanceScroll(Short, -1.0f, 120.0f, View);
        Expect(std::fabs(Short) < 0.01f, "a pane shorter than its view cannot be scrolled at all");

        // The offset is re-clamped every frame with a zero wheel, which is what recovers a scrolled pane when
        //    its content shrinks — collapsing a branch, or selecting an object with fewer rows.
        float Parked = 600.0f;                                   // scrolled to the bottom of the tall content
        Parked = ControlKit::AdvanceScroll(Parked, 0.0f, 300.0f, View);   // ... and the content just shrank
        std::printf("     content shrank from 1000 to 300 with the pane scrolled to 600 -> %.1f\n",
                    static_cast<double>(Parked));
        Expect(std::fabs(Parked) < 0.01f, "a shrinking pane pulls its scroll back rather than parking past the end");

        // One click is a sensible distance: too small and the wheel feels dead, too large and it jumps a page.
        const float Step = ControlKit::AdvanceScroll(0.0f, -1.0f, Content, View);
        std::printf("     one wheel click moves %.0f px, against a %.0f px row\n",
                    static_cast<double>(Step), 32.0);
        Expect(Step > 16.0f && Step < 120.0f, "one click moves about a row and a half, not a page");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n5. the slider reads as something to grab, not as a progress bar\n");
    {
        // 🔴 Reported as "see how terrible it looks". The theme assigned the accent colour to BOTH the filled
        //    side and the thumb, so every slider was a solid blue pill with a blue thumb somewhere inside it —
        //    invisible against its own fill. References/WorldBrowser-Mock.html says why that is the wrong
        //    reading: the fill is dark and close to the track "so the thumb is what carries the eye". A slider
        //    says where a value SITS. A bar says how full something is. They must not look alike.
        // The kit's palette is only populated once a theme has been applied; before that it holds the
        //    geometry-free defaults, which would test nothing about the derivation.
        ThemeStructure Theme;
        ControlKit::AssignTheme(Theme, ColorQuad{ 1.0f, 0.7f, 0.2f, 1.0f }, ColorQuad{ 0.2f, 0.8f, 0.4f, 1.0f },
                                       ColorQuad{ 0.3f, 0.6f, 1.0f, 1.0f }, ColorQuad{ 1.0f, 0.5f, 0.3f, 1.0f });
        const ControlKitPalette& P = ControlKit::Palette();

        const auto Luma = [](ColorQuad C) { return 0.2126f * C.Red + 0.7152f * C.Green + 0.0722f * C.Blue; };
        const auto Apart = [&](ColorQuad A, ColorQuad B)
        {
            return std::sqrt((A.Red - B.Red) * (A.Red - B.Red) + (A.Green - B.Green) * (A.Green - B.Green)
                           + (A.Blue - B.Blue) * (A.Blue - B.Blue));
        };

        std::printf("     track  luma %.3f\n", static_cast<double>(Luma(P.Raised)));
        std::printf("     fill   luma %.3f  (%.3f from the track)\n",
                    static_cast<double>(Luma(P.SliderFill)),  static_cast<double>(Apart(P.SliderFill, P.Raised)));
        std::printf("     thumb  luma %.3f  (%.3f from the fill)\n",
                    static_cast<double>(Luma(P.SliderThumb)), static_cast<double>(Apart(P.SliderThumb, P.SliderFill)));

        // 🔴 The defect itself: a thumb the same colour as the fill it sits on cannot be seen at all.
        Expect(Apart(P.SliderThumb, P.SliderFill) > 0.25f,
               "the thumb is clearly distinct from the fill it sits on");
        // And the fill must stay near the track, so the eye goes to the thumb rather than to the bar.
        Expect(Apart(P.SliderFill, P.Raised) < Apart(P.SliderThumb, P.SliderFill),
               "the fill sits closer to the track than the thumb does to the fill");
        Expect(std::fabs(Luma(P.SliderThumb) - Luma(P.SliderFill)) > 0.2f,
               "and the two differ in brightness, not merely in hue — hue alone fails for a colour-blind eye");

        // The accent is still reachable, for the controls that genuinely are bars.
        Expect(Apart(P.SliderFill, P.Accent) > 0.05f, "the slider fill is not simply the accent any more");
        Expect(Apart(P.Highlight, P.Accent) < 0.01f,  "while the highlight fill still is, for the ones that want it");
    }

    std::printf("\n>>> %s (%d failure%s)\n", Failures == 0 ? "ALL PASS" : "FAILURES", Failures, Failures == 1 ? "" : "s");
    return Failures == 0 ? 0 : 1;
}

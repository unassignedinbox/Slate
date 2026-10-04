//============================================================================================================================================
// 🎛 ControlSpecification.js — the editor's one slider, shared by the inspector and the instrument card
//============================================================================================================================================
// There was a second slider here once: the card drew its own 4px rail with a knob on it, while the inspector used the
// range input the theme styles. Two sliders in one editor is two sets of hit areas, two keyboard behaviours and two
// answers to "what does this number read as" — so there is one now, and this is it.
//
// The markup is the theme's SliderPill: a 26px track whose fill is driven by `--fraction`, and a 92px pill holding an
// editable number and its unit. Both callers get the type-in, the arrow keys and the drag for free, because all three
// belong to the input element rather than to the panel that mounted it.
//
// The binding attribute is a parameter. The inspector writes `data-bind` and lets one delegated listener on the panel
// resolve the dotted path; the card writes `data-key` and wires each row itself. Sharing the markup must not mean
// sharing a listener — the card is mounted on the body, outside the inspector, and a stray `data-bind` there would be
// resolved against a record that knows nothing about instruments.
//============================================================================================================================================

export const Clamp = (Value, Minimum, Maximum) => Math.min(Maximum, Math.max(Minimum, Value));

// How many decimals a value shows, taken from the step it moves in: a step of 1 never shows a fraction.
export const Fixed = (Value, Step) => Number(Value).toFixed(Step >= 1 ? 0 : Step >= 0.1 ? 1 : Step >= 0.01 ? 2 : 3);

export const Escape = (Text) => String(Text).replace(/[&<>"]/g, (Character) => `&#${Character.charCodeAt(0)};`);

// A value's share of its range, which is what the track paints itself with.
export const Fraction = (Value, Minimum, Maximum) =>
    (Clamp(Value, Minimum, Maximum) - Minimum) / Math.max(Maximum - Minimum, 1e-9);

const Identify = (Path) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(Path) : String(Path).replace(/[^\w-]/g, "-"));

//--------------------------------------------------------------------------------------------------------------------------
// One slider row: label, track, value pill.
//
// `Glyph` is raw markup rather than a name, because the two callers draw from different icon sets — the inspector from
// the panel's sheet, the card from its own sixteen hairline marks — and neither should have to know about the other's.
//--------------------------------------------------------------------------------------------------------------------------
export const SliderRow = ({ Label, Path, Value, Minimum, Maximum, Step, Unit, Hint, Glyph, Bind = "bind", Muted = false }) =>
{
    const Share = Fraction(Value, Minimum, Maximum);
    const Key = Identify(Path);
    return `
    <div class="property-row slider-row${Muted ? " inert" : ""}">
        <label class="property-label" for="control-${Key}">${Glyph || ""}<span>${Escape(Label)}</span></label>
        <div class="slider-control">
            <input id="control-${Key}" type="range" data-${Bind}="${Path}" min="${Minimum}" max="${Maximum}"
                   step="${Step}" value="${Value}" style="--fraction:${Share.toFixed(4)}" />
            <span class="value-pill">
                <input type="number" data-${Bind}="${Path}" data-pill="1" min="${Minimum}" max="${Maximum}" step="${Step}"
                       value="${Fixed(Value, Step)}" aria-label="${Escape(Label)} value" />
                <span class="unit-cell">${Escape(Unit || "—")}</span>
            </span>
        </div>
        ${Hint ? `<p class="property-hint">${Escape(Hint)}</p>` : ""}
    </div>`;
};

//--------------------------------------------------------------------------------------------------------------------------
// Keeping a mounted row honest. Both halves of the control hold the same number, so whichever one the hand moved, the
// other has to be told — and the track has to be repainted, because a range input will not paint its own fill.
//--------------------------------------------------------------------------------------------------------------------------
export const SyncSlider = (Row, Value, Step) =>
{
    if (!Row) return;
    const Range = Row.querySelector('input[type="range"]');
    const Pill = Row.querySelector('[data-pill="1"]');
    if (Range)
    {
        Range.value = String(Value);
        Range.style.setProperty("--fraction", String(Fraction(Value, Number(Range.min), Number(Range.max))));
    }
    if (Pill) Pill.value = Fixed(Value, Step ?? (Number(Range?.step) || 0.01));
};

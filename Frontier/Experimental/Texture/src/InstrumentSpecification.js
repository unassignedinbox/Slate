//============================================================================================================================================
// 🖍 InstrumentSpecification.js — the instrument library: six media families, the drawings that identify them, and their settings
//============================================================================================================================================
// Every instrument is authored once as a 300 × 60 landscape drawing with the working tip at the RIGHT, centred on y = 30.
// The tile in the chooser is the same drawing under a cropped viewBox, so one description serves both the library card and
// the full-length portrait in the properties pane — there is never a second asset to keep in step with the first.
//
// The anatomy constants come from the Frontier icon sheets (PaintBrushes, PencilDesigns, PenDesigns, Markers): handle to
// x=166, ferrule to x=196, bristle tip near x=244. Dry media and the wax sticks are drawn here in the same language.
//
// 🔴 Gradient identifiers are prefixed with the instrument key and declared INSIDE each drawing. Repeating a bare id in
//    several inline SVGs makes the browser resolve every reference to whichever copy it parsed first, and the tiles start
//    borrowing each other's colours.
//============================================================================================================================================

//--------------------------------------------------------------------------------------------------------------------------
// Drawing helpers.
//--------------------------------------------------------------------------------------------------------------------------
export const FullView = "0 0 300 60";

const Axis = 30;              // the drawing's centre line
const HandleEnd = 166;        // where a brush handle gives way to the ferrule
const FerruleEnd = 196;       // where the ferrule gives way to the head

const Stop = (Offset, Colour) => `<stop offset="${Offset}" stop-color="${Colour}"/>`;

// Across = true runs the ramp along the instrument rather than across it, which is how a tip shades from root to point.
const Ramp = (Identifier, Stops, Across = false) =>
    `<linearGradient id="${Identifier}" x1="0" y1="0" x2="${Across ? 1 : 0}" y2="${Across ? 0 : 1}">${Stops}</linearGradient>`;

const Band = (Colours) => Stop(0, Colours[0]) + Stop(0.5, Colours[1]) + Stop(1, Colours[2]);

export const Artwork = (Inner, View = FullView) =>
    `<svg viewBox="${View}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${Inner}</svg>`;

//--------------------------------------------------------------------------------------------------------------------------
// Palettes. Three stops read top → bottom, so a barrel shades like a cylinder lit from above.
//--------------------------------------------------------------------------------------------------------------------------
const BarrelColours = {
    yellow: ["#c99310", "#f7d24a", "#a8760a"],
    black: ["#17171b", "#33333b", "#050507"],
    cedar: ["#a8743e", "#d8a566", "#7a5228"],
    crimson: ["#5a0a1a", "#a8243c", "#3a0610"],
    navy: ["#16305e", "#3a5f9c", "#0c1c3a"],
    teal: ["#0f3d43", "#2b7f88", "#082227"],
    amber: ["#7a4410", "#d98c2b", "#5a300a"],
    walnut: ["#4a2f18", "#8a5a30", "#2e1e0e"],
    graphite: ["#26262a", "#52525a", "#141416"],
    ivory: ["#cfc8b8", "#faf6ec", "#a89f8c"],
    wood: ["#5a3a1c", "#a8743e", "#3a2410"],
    forest: ["#123a20", "#2f7d4a", "#0a2412"],
    slate: ["#3a3e44", "#7a838c", "#22262b"],
};

const MetalColours = {
    chrome: Stop(0, "#8a949c") + Stop(0.3, "#fdfefe") + Stop(0.55, "#c4ccd4") + Stop(1, "#6e767e"),
    silver: Stop(0, "#66707a") + Stop(0.4, "#eef2f6") + Stop(0.7, "#454b52") + Stop(1, "#22262b"),
    gold: Stop(0, "#8a6a2a") + Stop(0.4, "#f0cf7e") + Stop(0.7, "#a5822f") + Stop(1, "#4a370f"),
    copper: Stop(0, "#7a3a1a") + Stop(0.4, "#e8a878") + Stop(0.7, "#a5551f") + Stop(1, "#4a1f08"),
    graphite: Stop(0, "#17171b") + Stop(0.5, "#3a3a42") + Stop(1, "#050507"),
};

const HairColours = {
    sable: Stop(0, "#5a3c1e") + Stop(0.45, "#c49a5e") + Stop(0.8, "#8a5f32") + Stop(1, "#6a4526"),
    synthetic: Stop(0, "#0c0c10") + Stop(0.45, "#3a3a44") + Stop(0.8, "#17171b") + Stop(1, "#0a0a0e"),
    hog: Stop(0, "#ab935f") + Stop(0.45, "#f2e6c8") + Stop(0.85, "#d8c496") + Stop(1, "#b8a074"),
    squirrel: Stop(0, "#4a4038") + Stop(0.45, "#9a8e80") + Stop(0.85, "#6a5e52") + Stop(1, "#4a4038"),
};

// Exposed pencil cores and stick pigments: root shade → point shade along the drawing.
const CoreColours = {
    graphite: ["#4a4a52", "#1c1c22"],
    charcoal: ["#2a2a2e", "#0a0a0c"],
    crimson: ["#c8243c", "#5a0a1a"],
    sky: ["#4aa5d8", "#1a5a8a"],
};

const PigmentColours = {
    chalk: ["#fbfaf6", "#efece2", "#cfcabc"],
    pastel: ["#f08a3c", "#d86a22", "#a04a10"],
    charcoal: ["#3a3a3f", "#242428", "#101013"],
    conte: ["#a8503a", "#8a3a26", "#5a2214"],
    crayon: ["#e04a4a", "#c02a30", "#8a1620"],
    oil: ["#3a6ad8", "#2a4ab0", "#17307a"],
    china: ["#f2efe8", "#dcd6c8", "#aaa294"],
};

//--------------------------------------------------------------------------------------------------------------------------
// Brushes — handle, crimped ferrule, head. The head shape is the whole identity of a brush, so it carries the detail.
//--------------------------------------------------------------------------------------------------------------------------
const Hairs = (Root, Tip, Reach) =>
{
    let Markup = "";
    for (let Index = -2; Index <= 2; Index += 1)
        Markup +=
            `<line x1="${Root + 3}" y1="${Axis + Index * Reach * 0.7}" x2="${Tip - 2}" y2="${Axis}"` +
            ` stroke="#000" stroke-width="0.35" opacity="0.13"/>`;
    return Markup;
};

const FlatHairs = (Root, Tip, Reach) =>
{
    let Markup = "";
    for (let Index = -2; Index <= 2; Index += 1)
        Markup +=
            `<line x1="${Root + 3}" y1="${Axis + Index * Reach * 0.55}" x2="${Tip - 3}" y2="${Axis + Index * Reach * 0.55}"` +
            ` stroke="#000" stroke-width="0.35" opacity="0.11"/>`;
    return Markup;
};

const BrushHeads = {
    // Pointed round — the belly swells, then converges to a single hair.
    round: (Key, Tip, Reach) =>
        `<path d="M ${FerruleEnd},${Axis - Reach} C ${FerruleEnd + 10},${Axis - Reach - 2} ${Tip - 16},${Axis - Reach * 0.45} ${Tip},${Axis}` +
        ` C ${Tip - 16},${Axis + Reach * 0.45} ${FerruleEnd + 10},${Axis + Reach + 2} ${FerruleEnd},${Axis + Reach} Z" fill="url(#${Key}hair)"/>` +
        Hairs(FerruleEnd, Tip, Reach),

    // Square flat, corners barely softened.
    flat: (Key, Tip, Reach) =>
        `<path d="M ${FerruleEnd},${Axis - Reach} L ${Tip - 1.6},${Axis - Reach} Q ${Tip},${Axis - Reach} ${Tip},${Axis - Reach + 1.6}` +
        ` L ${Tip},${Axis + Reach - 1.6} Q ${Tip},${Axis + Reach} ${Tip - 1.6},${Axis + Reach} L ${FerruleEnd},${Axis + Reach} Z"` +
        ` fill="url(#${Key}hair)"/>` +
        FlatHairs(FerruleEnd, Tip, Reach),

    // Filbert — flat sides, domed end.
    filbert: (Key, Tip, Reach) =>
        `<path d="M ${FerruleEnd},${Axis - Reach} L ${Tip - 9},${Axis - Reach} C ${Tip + 2},${Axis - Reach} ${Tip + 2},${Axis + Reach} ${Tip - 9},${Axis + Reach}` +
        ` L ${FerruleEnd},${Axis + Reach} Z" fill="url(#${Key}hair)"/>` +
        FlatHairs(FerruleEnd, Tip, Reach),

    // Fan blender — a narrow root splaying into an arc of separated hairs.
    fan: (Key, Tip, Reach) =>
    {
        const Spread = Reach * 1.9;
        let Markup =
            `<path d="M ${FerruleEnd},${Axis - 2.5} L ${Tip - 2},${Axis - Spread} Q ${Tip + 3},${Axis} ${Tip - 2},${Axis + Spread}` +
            ` L ${FerruleEnd},${Axis + 2.5} Z" fill="url(#${Key}hair)"/>`;
        for (let Index = -3; Index <= 3; Index += 1)
            Markup +=
                `<line x1="${FerruleEnd + 2}" y1="${Axis}" x2="${Tip - 1}" y2="${Axis + (Index * Spread) / 3.2}"` +
                ` stroke="#000" stroke-width="0.4" opacity="0.16"/>`;
        return Markup;
    },
};

const BrushArt = (Key, Config) =>
{
    const Tip = Config.Tip;
    const Reach = Config.Reach;
    const Crimp = Math.max(6, Reach + 1.5);
    const Half = 5.5;
    const Width = FerruleEnd - HandleEnd;
    const Definitions =
        "<defs>" +
        Ramp(`${Key}bar`, Band(BarrelColours[Config.Barrel])) +
        Ramp(`${Key}metal`, MetalColours[Config.Ferrule]) +
        Ramp(`${Key}hair`, HairColours[Config.Hair], true) +
        "</defs>";

    const Handle =
        `<path d="M 20,${Axis} C 36,${Axis - Half * 0.5} ${HandleEnd - 40},${Axis - Half} ${HandleEnd},${Axis - Half}` +
        ` L ${HandleEnd},${Axis + Half} C ${HandleEnd - 40},${Axis + Half} 36,${Axis + Half * 0.5} 20,${Axis} Z" fill="url(#${Key}bar)"/>` +
        `<rect x="46" y="${Axis - Half + 1}" width="${HandleEnd - 70}" height="1.4" rx="0.7" fill="#fff" opacity="0.12"/>`;

    const Ferrule =
        `<rect x="${HandleEnd}" y="${Axis - Crimp}" width="${Width}" height="${2 * Crimp}" rx="1.8" fill="url(#${Key}metal)"/>` +
        `<rect x="${HandleEnd + 1}" y="${Axis - Crimp + 1}" width="${Width - 2}" height="1.7" rx="0.85" fill="#fff" opacity="0.3"/>` +
        `<line x1="${HandleEnd + 9}" y1="${Axis - Crimp + 1.5}" x2="${HandleEnd + 9}" y2="${Axis + Crimp - 1.5}" stroke="#000" stroke-width="0.7" opacity="0.32"/>` +
        `<line x1="${FerruleEnd - 9}" y1="${Axis - Crimp + 1.5}" x2="${FerruleEnd - 9}" y2="${Axis + Crimp - 1.5}" stroke="#000" stroke-width="0.7" opacity="0.32"/>`;

    return Definitions + Handle + Ferrule + BrushHeads[Config.Shape](Key, Tip, Reach);
};

//--------------------------------------------------------------------------------------------------------------------------
// Pencils — faceted barrel, sharpened wood cone, exposed core. The mechanical clutch has its own anatomy.
//--------------------------------------------------------------------------------------------------------------------------
const PencilBarrel = (Key, Back, Front, Half, Faceted) =>
{
    let Markup = `<rect x="${Back}" y="${Axis - Half}" width="${Front - Back}" height="${2 * Half}" fill="url(#${Key}bar)"/>`;
    if (Faceted)
        Markup +=
            `<rect x="${Back}" y="${Axis - Half}" width="${Front - Back}" height="${Half * 0.5}" fill="#fff" opacity="0.1"/>` +
            `<rect x="${Back}" y="${Axis + Half * 0.45}" width="${Front - Back}" height="${Half * 0.55}" fill="#000" opacity="0.22"/>` +
            `<line x1="${Back}" y1="${Axis - Half * 0.35}" x2="${Front}" y2="${Axis - Half * 0.35}" stroke="#000" stroke-width="0.4" opacity="0.18"/>` +
            `<line x1="${Back}" y1="${Axis + Half * 0.4}" x2="${Front}" y2="${Axis + Half * 0.4}" stroke="#000" stroke-width="0.4" opacity="0.18"/>`;
    else
        Markup +=
            `<rect x="${Back}" y="${Axis - Half + 1}" width="${Front - Back}" height="1.6" rx="0.8" fill="#fff" opacity="0.14"/>` +
            `<rect x="${Back}" y="${Axis + Half * 0.4}" width="${Front - Back}" height="${Half * 0.6}" fill="#000" opacity="0.14"/>`;
    return Markup;
};

const PencilBacks = {
    flat: (Key, Back, Half) => `<rect x="${Back - 2}" y="${Axis - Half}" width="2" height="${2 * Half}" fill="#000" opacity="0.35"/>`,
    eraser: (Key, Back, Half) =>
        `<rect x="${Back - 9}" y="${Axis - Half + 0.5}" width="6" height="${2 * Half - 1}" rx="1.5" fill="#d98a8a"/>` +
        `<rect x="${Back - 9}" y="${Axis - Half + 0.5}" width="6" height="1.4" rx="0.7" fill="#fff" opacity="0.3"/>` +
        `<rect x="${Back - 4}" y="${Axis - Half}" width="4" height="${2 * Half}" fill="url(#${Key}metal)"/>`,
    cap: (Key, Back, Half) =>
        `<path d="M ${Back},${Axis - Half} L ${Back - 6},${Axis - Half * 0.55} C ${Back - 9},${Axis} ${Back - 6},${Axis + Half * 0.55} ${Back},${Axis + Half} Z"` +
        ` fill="url(#${Key}metal)"/>`,
};

const PencilArt = (Key, Config) =>
{
    const Half = Config.Half ?? 7;
    const Back = 26;
    const Definitions =
        "<defs>" +
        Ramp(`${Key}bar`, Band(BarrelColours[Config.Barrel])) +
        Ramp(`${Key}metal`, MetalColours[Config.Metal || "silver"]) +
        Ramp(`${Key}wood`, Stop(0, "#e8cfa0") + Stop(0.5, "#d0ad72") + Stop(1, "#a8823e")) +
        Ramp(`${Key}core`, Stop(0, CoreColours[Config.Core][0]) + Stop(1, CoreColours[Config.Core][1]), true) +
        "</defs>";

    if (Config.Clutch)
    {
        // A mechanical pencil has no wood: barrel, knurled grip, metal cone, lead sleeve, then a hairline of lead.
        const Grip = 176;
        const Cone = 202;
        const Sleeve = 216;
        let Markup = Definitions;
        Markup += `<rect x="${Back - 8}" y="${Axis - Half * 0.7}" width="5" height="${Half * 1.4}" rx="1.5" fill="url(#${Key}metal)"/>`;
        Markup += `<rect x="${Back - 3}" y="${Axis - Half}" width="3" height="${2 * Half}" fill="url(#${Key}metal)"/>`;
        Markup +=
            `<path d="M ${Back + 4},${Axis - Half} L ${Back + 22},${Axis - Half - 1.5} L ${Back + 24},${Axis - Half + 0.5}` +
            ` L ${Back + 4},${Axis - Half + 2.5} Z" fill="url(#${Key}metal)"/>`;
        Markup += PencilBarrel(Key, Back, Grip, Half, false);
        Markup += `<rect x="${Grip}" y="${Axis - Half}" width="${Cone - Grip}" height="${2 * Half}" fill="url(#${Key}metal)"/>`;
        Markup += `<g opacity="0.32">`;
        for (let Index = 0; Index < 11; Index += 1)
            Markup += `<line x1="${Grip + 2 + Index * 2}" y1="${Axis - Half + 1}" x2="${Grip + 2 + Index * 2}" y2="${Axis + Half - 1}" stroke="#000" stroke-width="0.5"/>`;
        Markup += `</g>`;
        Markup +=
            `<path d="M ${Cone},${Axis - Half * 0.7} L ${Sleeve},${Axis - 1.6} L ${Sleeve},${Axis + 1.6} L ${Cone},${Axis + Half * 0.7} Z" fill="url(#${Key}metal)"/>`;
        Markup += `<rect x="${Sleeve}" y="${Axis - 1}" width="4" height="2" fill="#5a5f66"/>`;
        Markup += `<rect x="${Sleeve + 4}" y="${Axis - 0.7}" width="12" height="1.4" fill="url(#${Key}core)"/>`;
        return Markup;
    }

    const Shoulder = 196;
    const Collar = 224;
    const Tip = 240;
    return (
        Definitions +
        PencilBacks[Config.Back](Key, Back, Half) +
        PencilBarrel(Key, Back, Shoulder, Half, Config.Faceted !== false) +
        `<path d="M ${Shoulder},${Axis - Half} L ${Collar},${Axis - 2.4} L ${Collar},${Axis + 2.4} L ${Shoulder},${Axis + Half} Z" fill="url(#${Key}wood)"/>` +
        `<path d="M ${Shoulder},${Axis - Half} L ${Collar},${Axis - 2.4} L ${Collar},${Axis} L ${Shoulder},${Axis - Half * 0.2} Z" fill="#fff" opacity="0.12"/>` +
        `<path d="M ${Shoulder},${Axis + Half * 0.2} L ${Collar},${Axis} L ${Collar},${Axis + 2.4} L ${Shoulder},${Axis + Half} Z" fill="#000" opacity="0.2"/>` +
        `<line x1="${Shoulder}" y1="${Axis - Half}" x2="${Shoulder}" y2="${Axis + Half}" stroke="#000" stroke-width="0.5" opacity="0.25"/>` +
        `<path d="M ${Collar},${Axis - 2.4} L ${Tip},${Axis} L ${Collar},${Axis + 2.4} Z" fill="url(#${Key}core)"/>`
    );
};

//--------------------------------------------------------------------------------------------------------------------------
// Pens — body, section, then the nib that decides what the line looks like.
//--------------------------------------------------------------------------------------------------------------------------
const PenNibs = {
    // A folded fountain nib: shoulders, a slit down the middle, the breather hole, and the tipping ball.
    fountain: (Key) =>
        `<path d="M 198,${Axis - 6} C 214,${Axis - 6.6} 226,${Axis - 3.4} 232,${Axis} C 226,${Axis + 3.4} 214,${Axis + 6.6} 198,${Axis + 6} Z" fill="url(#${Key}metal)"/>` +
        `<line x1="206" y1="${Axis}" x2="231" y2="${Axis}" stroke="#000" stroke-width="0.7" opacity="0.5"/>` +
        `<circle cx="206" cy="${Axis}" r="1.8" fill="#000" opacity="0.45"/>` +
        `<path d="M 200,${Axis - 4.6} C 212,${Axis - 5} 222,${Axis - 2.6} 227,${Axis - 0.6}" fill="none" stroke="#fff" stroke-width="0.8" opacity="0.35"/>` +
        `<circle cx="232.4" cy="${Axis}" r="1.5" fill="#d8dce2"/>`,

    // Ballpoint: a turned metal cone and a hint of the ball itself.
    ball: (Key) =>
        `<path d="M 198,${Axis - 5.6} L 218,${Axis - 1.8} L 218,${Axis + 1.8} L 198,${Axis + 5.6} Z" fill="url(#${Key}metal)"/>` +
        `<rect x="218" y="${Axis - 1.1}" width="4" height="2.2" rx="0.6" fill="#8a9099"/>` +
        `<circle cx="223" cy="${Axis}" r="1.3" fill="#c9ced6"/>`,

    // Italic / calligraphy: a chisel cut at an angle, which is where the thick-thin line comes from.
    chisel: (Key) =>
        `<path d="M 198,${Axis - 6} L 222,${Axis - 6.6} L 228,${Axis - 2} L 228,${Axis + 2} L 222,${Axis + 6.6} L 198,${Axis + 6} Z" fill="url(#${Key}metal)"/>` +
        `<path d="M 226,${Axis - 3.4} L 231,${Axis - 5.4} L 231,${Axis + 1.6} L 226,${Axis + 3.4} Z" fill="#2a2d33"/>` +
        `<line x1="206" y1="${Axis}" x2="226" y2="${Axis}" stroke="#000" stroke-width="0.6" opacity="0.4"/>`,

    // Technical fineliner: a steel pipe and a hair of a point, which draws the same width however it is held.
    tube: (Key) =>
        `<path d="M 198,${Axis - 4.4} L 212,${Axis - 1.5} L 212,${Axis + 1.5} L 198,${Axis + 4.4} Z" fill="url(#${Key}metal)"/>` +
        `<rect x="212" y="${Axis - 0.9}" width="16" height="1.8" rx="0.4" fill="#5e636b"/>` +
        `<rect x="228" y="${Axis - 0.5}" width="6" height="1" rx="0.5" fill="#1b1d21"/>`,
};

const PenArt = (Key, Config) =>
{
    const Half = Config.Half ?? 6.5;
    const Back = 30;
    const Body = 176;
    const Definitions =
        "<defs>" +
        Ramp(`${Key}bar`, Band(BarrelColours[Config.Barrel])) +
        Ramp(`${Key}metal`, MetalColours[Config.Metal || "chrome"]) +
        "</defs>";

    return (
        Definitions +
        `<rect x="${Back}" y="${Axis - Half}" width="${Body - Back}" height="${2 * Half}" rx="${Half}" fill="url(#${Key}bar)"/>` +
        `<rect x="${Back + 12}" y="${Axis - Half + 1.4}" width="${Body - Back - 40}" height="1.6" rx="0.8" fill="#fff" opacity="0.16"/>` +
        `<rect x="${Back}" y="${Axis + Half * 0.35}" width="${Body - Back}" height="${Half * 0.65}" rx="2" fill="#000" opacity="0.16"/>` +
        // The clip, which is what makes a drawing read as a pen rather than a rod.
        `<path d="M ${Back + 10},${Axis - Half} L ${Back + 46},${Axis - Half - 2.6} L ${Back + 50},${Axis - Half + 0.4} L ${Back + 10},${Axis - Half + 2.6} Z" fill="url(#${Key}metal)"/>` +
        `<rect x="${Back + 52}" y="${Axis - Half}" width="3" height="${2 * Half}" fill="url(#${Key}metal)" opacity="0.9"/>` +
        // Section: the grip the hand actually holds, tapering into the nib.
        `<path d="M ${Body},${Axis - Half} L 198,${Axis - Half * 0.82} L 198,${Axis + Half * 0.82} L ${Body},${Axis + Half} Z" fill="url(#${Key}${Config.Section || "metal"})"/>` +
        `<rect x="${Body + 3}" y="${Axis - Half + 1}" width="14" height="1.3" rx="0.65" fill="#fff" opacity="0.22"/>` +
        PenNibs[Config.Nib](Key)
    );
};

//--------------------------------------------------------------------------------------------------------------------------
// Markers — a fat barrel, a collar, and a nib that is the entire character of the tool.
//--------------------------------------------------------------------------------------------------------------------------
const MarkerNibs = {
    bullet: (Key) =>
        `<path d="M 188,${Axis - 4.6} L 202,${Axis - 4.2} C 210,${Axis - 3.6} 210,${Axis + 3.6} 202,${Axis + 4.2} L 188,${Axis + 4.6} Z" fill="url(#${Key}nib)"/>`,

    chisel: (Key) =>
        `<path d="M 188,${Axis - 7} L 206,${Axis - 7} L 222,${Axis - 1.6} L 222,${Axis + 1.6} L 206,${Axis + 7} L 188,${Axis + 7} Z" fill="url(#${Key}nib)"/>` +
        `<path d="M 206,${Axis - 7} L 222,${Axis - 1.6} L 222,${Axis} L 206,${Axis - 2} Z" fill="#fff" opacity="0.14"/>`,

    taper: (Key) =>
        `<path d="M 188,${Axis - 6.4} C 204,${Axis - 6} 218,${Axis - 3} 230,${Axis} C 218,${Axis + 3} 204,${Axis + 6} 188,${Axis + 6.4} Z" fill="url(#${Key}nib)"/>` +
        `<path d="M 192,${Axis - 3.6} C 206,${Axis - 3.4} 216,${Axis - 1.6} 225,${Axis - 0.4}" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.2"/>`,

    broad: (Key) =>
        `<path d="M 188,${Axis - 9} L 212,${Axis - 9} L 212,${Axis + 9} L 188,${Axis + 9} Z" fill="url(#${Key}nib)"/>` +
        `<path d="M 212,${Axis - 9} L 218,${Axis - 6.4} L 218,${Axis + 6.4} L 212,${Axis + 9} Z" fill="url(#${Key}nib)" opacity="0.82"/>`,
};

const MarkerArt = (Key, Config) =>
{
    const Half = Config.Half ?? 9;
    const Back = 34;
    const Collar = 172;
    const Definitions =
        "<defs>" +
        Ramp(`${Key}bar`, Band(BarrelColours[Config.Barrel])) +
        Ramp(`${Key}metal`, MetalColours[Config.Metal || "silver"]) +
        Ramp(`${Key}nib`, Stop(0, Config.Ink[0]) + Stop(0.55, Config.Ink[1]) + Stop(1, Config.Ink[2])) +
        "</defs>";

    return (
        Definitions +
        `<rect x="${Back}" y="${Axis - Half}" width="${Collar - Back}" height="${2 * Half}" rx="4" fill="url(#${Key}bar)"/>` +
        `<rect x="${Back + 8}" y="${Axis - Half + 1.6}" width="${Collar - Back - 34}" height="2" rx="1" fill="#fff" opacity="0.13"/>` +
        `<rect x="${Back}" y="${Axis + Half * 0.42}" width="${Collar - Back}" height="${Half * 0.58}" rx="3" fill="#000" opacity="0.18"/>` +
        // The ink band: the colour of the line, printed where a real marker prints it.
        `<rect x="${Back + 16}" y="${Axis - Half}" width="26" height="${2 * Half}" fill="url(#${Key}nib)" opacity="0.92"/>` +
        `<rect x="${Back + 16}" y="${Axis - Half}" width="26" height="${Half * 0.5}" fill="#fff" opacity="0.12"/>` +
        `<rect x="${Collar}" y="${Axis - Half * 0.86}" width="16" height="${Half * 1.72}" rx="2" fill="url(#${Key}metal)"/>` +
        MarkerNibs[Config.Nib](Key)
    );
};

//--------------------------------------------------------------------------------------------------------------------------
// Dry media — chalk, pastel, charcoal, conté.
//
// 📝 Drawn here rather than taken from the sheet: a dry stick has no handle, no ferrule and no manufactured tip, so the
//    anatomy that identifies a brush says nothing about it. What reads as dry media is the SECTION (square or round), the
//    blunt worn end, the paper band that keeps the pigment off your fingers, and the dust it sheds — so those carry it.
//--------------------------------------------------------------------------------------------------------------------------
// 📝 Deterministic, not random: the same stick must draw the same every time it is rendered, or a tile would reshuffle
//    its dust on each re-render of the pane and read as a loading glitch. Two different sine seeds keep the motes off a
//    diagonal line, and the spread opens with distance so the cloud leaves the tip rather than trailing beside it.
const Dust = (From, Count, Seed, Tint = "#cfcabc") =>
{
    let Markup = `<g opacity="0.55">`;
    for (let Index = 0; Index < Count; Index += 1)
    {
        const Along = Math.sin((Index + Seed) * 12.9898) * 0.5 + 0.5;
        const Across = Math.sin((Index + Seed) * 78.233) * 0.5 + 0.5;
        const Reach = Along * 16;
        const X = From + 1 + Reach;
        const Y = Axis + (Across - 0.5) * (6 + Reach * 1.1);
        Markup +=
            `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${(0.45 + Across * 1).toFixed(2)}"` +
            ` fill="${Tint}" opacity="${(0.5 - Along * 0.3).toFixed(2)}"/>`;
    }
    return `${Markup}</g>`;
};

const DryArt = (Key, Config) =>
{
    const Half = Config.Half ?? 11;
    const Back = Config.Back ?? 112;
    const Tip = Config.Tip ?? 232;
    const Pigment = PigmentColours[Config.Pigment];
    const Definitions =
        "<defs>" +
        Ramp(`${Key}stick`, Band(Pigment)) +
        Ramp(`${Key}wrap`, Stop(0, "#fbf7ee") + Stop(0.5, "#efe9dc") + Stop(1, "#c9c1ae")) +
        Ramp(`${Key}end`, Stop(0, Pigment[1]) + Stop(1, Pigment[2]), true) +
        "</defs>";

    let Markup = Definitions;

    if (Config.Section === "round")
    {
        // Vine charcoal: an irregular twig, thinner at one end, with the bark grain still on it.
        Markup +=
            `<path d="M ${Back},${Axis - Half * 0.72} C ${Back + 40},${Axis - Half} ${Tip - 50},${Axis - Half * 0.86} ${Tip - 6},${Axis - Half * 0.6}` +
            ` L ${Tip},${Axis - Half * 0.3} L ${Tip},${Axis + Half * 0.34} L ${Tip - 6},${Axis + Half * 0.64}` +
            ` C ${Tip - 50},${Axis + Half * 0.9} ${Back + 40},${Axis + Half} ${Back},${Axis + Half * 0.76} Z" fill="url(#${Key}stick)"/>`;
        Markup += `<path d="M ${Back + 6},${Axis - Half * 0.66} C ${Back + 50},${Axis - Half * 0.92} ${Tip - 56},${Axis - Half * 0.78} ${Tip - 12},${Axis - Half * 0.5}" fill="none" stroke="#fff" stroke-width="1.6" opacity="0.16"/>`;
        Markup += `<path d="M ${Back + 16},${Axis + Half * 0.5} C ${Back + 70},${Axis + Half * 0.72} ${Tip - 54},${Axis + Half * 0.62} ${Tip - 14},${Axis + Half * 0.4}" fill="none" stroke="#000" stroke-width="1.4" opacity="0.26"/>`;
    }
    else
    {
        // Chalk, pastel and conté are extruded or pressed: a straight section with crisp arrises.
        Markup += `<rect x="${Back}" y="${Axis - Half}" width="${Tip - Back}" height="${2 * Half}" rx="${Config.Section === "square" ? 1 : 2.6}" fill="url(#${Key}stick)"/>`;
        Markup += `<rect x="${Back}" y="${Axis - Half}" width="${Tip - Back}" height="${Half * 0.46}" rx="1" fill="#fff" opacity="0.2"/>`;
        Markup += `<rect x="${Back}" y="${Axis + Half * 0.42}" width="${Tip - Back}" height="${Half * 0.58}" rx="1" fill="#000" opacity="0.2"/>`;
        if (Config.Section === "square")
        {
            Markup += `<line x1="${Back}" y1="${Axis - Half * 0.38}" x2="${Tip}" y2="${Axis - Half * 0.38}" stroke="#000" stroke-width="0.5" opacity="0.16"/>`;
            Markup += `<line x1="${Back}" y1="${Axis + Half * 0.36}" x2="${Tip}" y2="${Axis + Half * 0.36}" stroke="#000" stroke-width="0.5" opacity="0.16"/>`;
        }
        // The worn end: a stick in use is never square at the tip, it is chipped back at an angle.
        Markup +=
            `<path d="M ${Tip},${Axis - Half} L ${Tip + 5},${Axis - Half * 0.62} L ${Tip + 5},${Axis + Half * 0.5} L ${Tip},${Axis + Half} Z" fill="url(#${Key}end)"/>`;
        Markup += `<path d="M ${Tip},${Axis - Half} L ${Tip + 5},${Axis - Half * 0.62} L ${Tip + 5},${Axis - Half * 0.1} L ${Tip},${Axis - Half * 0.3} Z" fill="#fff" opacity="0.18"/>`;
    }

    if (Config.Wrap)
    {
        // A paper band, printed with the maker's two rules, sitting where the fingers go.
        const Left = Back + 14;
        const Width = 58;
        Markup += `<rect x="${Left}" y="${Axis - Half - 0.4}" width="${Width}" height="${2 * Half + 0.8}" rx="1.4" fill="url(#${Key}wrap)"/>`;
        Markup += `<rect x="${Left}" y="${Axis - Half - 0.4}" width="${Width}" height="${Half * 0.42}" fill="#fff" opacity="0.5"/>`;
        Markup += `<rect x="${Left + 7}" y="${Axis - 3.4}" width="${Width - 14}" height="1.8" rx="0.9" fill="${Pigment[2]}" opacity="0.7"/>`;
        Markup += `<rect x="${Left + 7}" y="${Axis + 1.2}" width="${Width - 26}" height="1.4" rx="0.7" fill="#9a9284" opacity="0.8"/>`;
        Markup += `<rect x="${Left + Width - 1.6}" y="${Axis - Half - 0.4}" width="1.6" height="${2 * Half + 0.8}" fill="#000" opacity="0.18"/>`;
    }

    return Markup + Dust(Tip + (Config.Section === "round" ? 2 : 7), Config.Dust ?? 9, Config.Seed ?? 3, PigmentColours[Config.Pigment][0]);
};

//--------------------------------------------------------------------------------------------------------------------------
// Wax and oil media — crayon, oil stick, china marker, oil pastel.
//
// 📝 Also drawn here. Wax is the opposite of dry media and the drawing has to say so: a hard specular streak along the
//    body, a tip that has MELTED to a cone rather than crumbled to a facet, and no dust at all.
//--------------------------------------------------------------------------------------------------------------------------
const WaxArt = (Key, Config) =>
{
    const Half = Config.Half ?? 9.5;
    const Back = Config.Back ?? 104;
    const Shoulder = Config.Shoulder ?? 212;
    const Tip = Config.Tip ?? 238;
    const Pigment = PigmentColours[Config.Pigment];
    const Definitions =
        "<defs>" +
        Ramp(`${Key}wax`, Band(Pigment)) +
        Ramp(`${Key}wrap`, Stop(0, "#f6f2e8") + Stop(0.45, "#e6dfce") + Stop(1, "#bdb4a0")) +
        Ramp(`${Key}tip`, Stop(0, Pigment[1]) + Stop(1, Pigment[2]), true) +
        "</defs>";

    let Markup = Definitions;

    // Body, then the melted cone. The cone is drawn blunt: a wax tip rounds off within a stroke or two of being sharpened.
    Markup += `<rect x="${Back}" y="${Axis - Half}" width="${Shoulder - Back}" height="${2 * Half}" rx="${Config.Faceted ? 1.6 : Half * 0.5}" fill="url(#${Key}wax)"/>`;
    Markup +=
        `<path d="M ${Shoulder},${Axis - Half} C ${Shoulder + 12},${Axis - Half * 0.8} ${Tip - 5},${Axis - 3.4} ${Tip},${Axis - 2.2}` +
        ` L ${Tip},${Axis + 2.2} C ${Tip - 5},${Axis + 3.4} ${Shoulder + 12},${Axis + Half * 0.8} ${Shoulder},${Axis + Half} Z" fill="url(#${Key}tip)"/>`;
    Markup += `<path d="M ${Tip - 1},${Axis - 2.2} C ${Tip + 3},${Axis - 1.4} ${Tip + 3},${Axis + 1.4} ${Tip - 1},${Axis + 2.2} Z" fill="${Pigment[1]}"/>`;
    // The specular streak that separates wax from chalk at a glance.
    Markup += `<rect x="${Back + 6}" y="${Axis - Half * 0.72}" width="${Shoulder - Back - 20}" height="${Half * 0.3}" rx="${Half * 0.15}" fill="#fff" opacity="0.34"/>`;
    Markup += `<rect x="${Back}" y="${Axis + Half * 0.46}" width="${Shoulder - Back}" height="${Half * 0.54}" rx="${Half * 0.3}" fill="#000" opacity="0.2"/>`;

    if (Config.Wrap === "band")
    {
        const Left = Back + 10;
        const Width = 72;
        Markup += `<rect x="${Left}" y="${Axis - Half - 0.5}" width="${Width}" height="${2 * Half + 1}" rx="1.6" fill="url(#${Key}wrap)"/>`;
        Markup += `<rect x="${Left}" y="${Axis - Half - 0.5}" width="${Width}" height="${Half * 0.4}" fill="#fff" opacity="0.5"/>`;
        Markup += `<rect x="${Left + 6}" y="${Axis - Half + 2.2}" width="${Width - 12}" height="1.6" rx="0.8" fill="${Pigment[2]}" opacity="0.75"/>`;
        Markup += `<rect x="${Left + 6}" y="${Axis + Half - 4.4}" width="${Width - 12}" height="1.6" rx="0.8" fill="${Pigment[2]}" opacity="0.75"/>`;
        Markup += `<rect x="${Left + 12}" y="${Axis - 2}" width="${Width - 34}" height="2.2" rx="1.1" fill="#8e8678" opacity="0.7"/>`;
    }

    if (Config.Wrap === "spiral")
    {
        // A china marker is wound in paper and unwrapped by pulling a string — that spiral IS the tool's silhouette.
        const Left = Back;
        const Right = Shoulder - 4;
        Markup += `<rect x="${Left}" y="${Axis - Half - 0.5}" width="${Right - Left}" height="${2 * Half + 1}" rx="2" fill="url(#${Key}wrap)"/>`;
        Markup += `<rect x="${Left}" y="${Axis - Half - 0.5}" width="${Right - Left}" height="${Half * 0.4}" fill="#fff" opacity="0.45"/>`;
        let Spiral = "";
        for (let Along = Left + 8; Along < Right - 4; Along += 11)
            Spiral += `<path d="M ${Along},${Axis - Half} L ${Along + 9},${Axis + Half}" stroke="#a89f8c" stroke-width="1" opacity="0.6" fill="none"/>`;
        Markup += Spiral;
        Markup += `<path d="M ${Left + 4},${Axis - Half - 1} C ${Left + 14},${Axis - Half - 7} ${Left + 30},${Axis - Half - 6} ${Left + 38},${Axis - Half - 1.6}" fill="none" stroke="#d8d1c0" stroke-width="1.2"/>`;
    }

    return Markup;
};

//--------------------------------------------------------------------------------------------------------------------------
// Settings schema.
//
// 🔴 `Wired` marks the controls that actually reach the stamping pass. The rest are recorded on the instrument, shown in
//    the preview and carried into a stroke's record, but the pass has nowhere to put them yet — so the card LABELS them
//    rather than pretending. `When` hides a row outright instead of grinding it out: a disabled control still reads as
//    something you failed to reach.
//--------------------------------------------------------------------------------------------------------------------------
const StrokeControls = (Extra = []) => [
    { Key: "Size", Label: "Size", Glyph: "Size", Kind: "Slider", Minimum: 0.4, Maximum: 60, Step: 0.1, Unit: " cm", Wired: true },
    { Key: "Opacity", Label: "Opacity", Glyph: "Opacity", Kind: "Slider", Minimum: 1, Maximum: 100, Step: 1, Unit: "%", Wired: true },
    { Key: "Flow", Label: "Flow", Glyph: "Flow", Kind: "Slider", Minimum: 1, Maximum: 100, Step: 1, Unit: "%", Wired: true },
    { Key: "Hardness", Label: "Hardness", Glyph: "Hardness", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Wired: true },
    { Key: "Spacing", Label: "Spacing", Glyph: "Spacing", Kind: "Slider", Minimum: 2, Maximum: 100, Step: 1, Unit: "%", Wired: true },
    ...Extra,
    { Key: "Smoothing", Label: "Smoothing", Glyph: "Smooth", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
];

export const InstrumentSchema = {
    Pen: StrokeControls([
        { Key: "Pressure", Label: "Pressure sensitive", Glyph: "Pressure", Kind: "Switch" },
        {
            Key: "Taper", Label: "Taper", Glyph: "Taper", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%",
            When: (Settings) => Settings.Pressure === true,
        },
    ]),

    Pencil: StrokeControls([
        { Key: "Grade", Label: "Grade", Glyph: "Grade", Kind: "Segmented", Options: ["2H", "HB", "2B", "6B"] },
        { Key: "Grain", Label: "Grain", Glyph: "Grain", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Wired: true },
        { Key: "Pressure", Label: "Pressure sensitive", Glyph: "Pressure", Kind: "Switch" },
        {
            Key: "Tilt", Label: "Tilt shading", Glyph: "Tilt", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%",
            When: (Settings) => Settings.Pressure === true,
        },
    ]),

    Dry: StrokeControls([
        { Key: "Grain", Label: "Tooth", Glyph: "Grain", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Wired: true },
        { Key: "Scatter", Label: "Scatter", Glyph: "Scatter", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
        { Key: "Pressure", Label: "Pressure sensitive", Glyph: "Pressure", Kind: "Switch" },
    ]),

    Marker: StrokeControls([
        { Key: "Nib", Label: "Nib", Glyph: "Mode", Kind: "Segmented", Options: ["Fine", "Chisel", "Broad"] },
        { Key: "Bleed", Label: "Bleed", Glyph: "Bleed", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
        { Key: "Pressure", Label: "Pressure sensitive", Glyph: "Pressure", Kind: "Switch" },
    ]),

    Brush: StrokeControls([
        { Key: "Head", Label: "Head", Glyph: "Mode", Kind: "Segmented", Options: ["Round", "Filbert", "Flat", "Fan"] },
        { Key: "Wetness", Label: "Wetness", Glyph: "Wetness", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
        { Key: "Pressure", Label: "Pressure sensitive", Glyph: "Pressure", Kind: "Switch" },
        {
            Key: "Taper", Label: "Taper", Glyph: "Taper", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%",
            When: (Settings) => Settings.Pressure === true,
        },
    ]),

    Wax: StrokeControls([
        { Key: "Grain", Label: "Tooth", Glyph: "Grain", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%", Wired: true },
        { Key: "Melt", Label: "Melt", Glyph: "Wetness", Kind: "Slider", Minimum: 0, Maximum: 100, Step: 1, Unit: "%" },
        { Key: "Pressure", Label: "Pressure sensitive", Glyph: "Pressure", Kind: "Switch" },
    ]),
};

// The controls whose `When` predicate passes against the settings in hand.
export const VisibleControls = (Instrument, Settings) =>
    InstrumentSchema[Instrument.Schema].filter((Control) => !Control.When || Control.When(Settings));

//--------------------------------------------------------------------------------------------------------------------------
// The library. One family per rail row, one tile per type, and every type carries its own settings and swatches.
//--------------------------------------------------------------------------------------------------------------------------
// 📝 Even a black marker's nib is drawn a shade up from the card it sits on. A true #15161a nib on a #1c1c1c tile is
//    technically right and visually absent, and a tile nobody can read is not a choice anybody can make.
const Ink = {
    Dark: ["#3a3d45", "#595e68", "#23252b"],
    Warm: ["#c0303a", "#e0a13a", "#8d1e26"],
};

export const InstrumentFamilies = [
    {
        Key: "brush",
        Label: "Paint brushes",
        Glyph: "brush",
        Tone: "#c49a5e",
        Crop: "180 6 76 48",
        Draw: BrushArt,
        Schema: "Brush",
        Types: [
            {
                Key: "brush-round",
                Label: "Round",
                Name: "Sable pointed round · no. 8",
                Tone: "#c49a5e",
                Art: { Shape: "round", Tip: 244, Reach: 5, Barrel: "wood", Ferrule: "chrome", Hair: "sable" },
                Settings: { Size: 9, Opacity: 92, Flow: 80, Hardness: 40, Spacing: 10, Smoothing: 38, Head: "Round", Wetness: 45, Pressure: true, Taper: 60 },
                Swatches: ["#c0303a", "#2352a6", "#1f7a4d", "#e0a13a", "#6b4a9e", "#15161a"],
            },
            {
                Key: "brush-flat",
                Label: "Flat",
                Name: "Hog flat shader · 12 mm",
                Tone: "#f2e6c8",
                Art: { Shape: "flat", Tip: 238, Reach: 7, Barrel: "navy", Ferrule: "chrome", Hair: "hog" },
                Settings: { Size: 14, Opacity: 96, Flow: 88, Hardness: 62, Spacing: 8, Smoothing: 22, Head: "Flat", Wetness: 30, Pressure: false, Taper: 0 },
                Swatches: ["#2352a6", "#1f7a4d", "#8a5a30", "#15161a", "#f4f1ea"],
            },
            {
                Key: "brush-filbert",
                Label: "Filbert",
                Name: "Synthetic filbert · no. 10",
                Tone: "#3a3a44",
                Art: { Shape: "filbert", Tip: 240, Reach: 7, Barrel: "black", Ferrule: "silver", Hair: "synthetic" },
                Settings: { Size: 12, Opacity: 90, Flow: 74, Hardness: 46, Spacing: 10, Smoothing: 30, Head: "Filbert", Wetness: 38, Pressure: true, Taper: 35 },
                Swatches: ["#6b4a9e", "#c0303a", "#2b7f88", "#e0a13a", "#15161a"],
            },
            {
                Key: "brush-fan",
                Label: "Fan",
                Name: "Squirrel fan blender",
                Tone: "#9a8e80",
                Art: { Shape: "fan", Tip: 236, Reach: 4, Barrel: "walnut", Ferrule: "chrome", Hair: "squirrel" },
                Settings: { Size: 16, Opacity: 54, Flow: 40, Hardness: 12, Spacing: 14, Smoothing: 60, Head: "Fan", Wetness: 70, Pressure: true, Taper: 20 },
                Swatches: ["#f4f1ea", "#d8c496", "#8a5f32", "#4a4038"],
            },
        ],
    },
    {
        Key: "pencil",
        Label: "Pencils",
        Glyph: "brush",
        Tone: "#f7d24a",
        Crop: "186 8 68 44",
        Draw: PencilArt,
        Schema: "Pencil",
        Types: [
            {
                Key: "pencil-graphite",
                Label: "Graphite",
                Name: "Classic HB · yellow barrel",
                Tone: "#f7d24a",
                Art: { Barrel: "yellow", Core: "graphite", Back: "eraser", Metal: "gold" },
                Settings: { Size: 1.6, Opacity: 78, Flow: 55, Hardness: 62, Spacing: 6, Smoothing: 25, Grade: "HB", Grain: 55, Pressure: true, Tilt: 0 },
                Swatches: ["#2b2b30", "#4a4a52", "#6d6d76", "#141417"],
            },
            {
                Key: "pencil-colour",
                Label: "Colour",
                Name: "Self-coloured pencil · crimson",
                Tone: "#a8243c",
                Art: { Barrel: "crimson", Core: "crimson", Back: "flat", Metal: "silver" },
                Settings: { Size: 1.8, Opacity: 88, Flow: 66, Hardness: 58, Spacing: 6, Smoothing: 28, Grade: "2B", Grain: 42, Pressure: true, Tilt: 0 },
                Swatches: ["#c8243c", "#e0a13a", "#2b7f88", "#3a6ad8", "#1f7a4d"],
            },
            {
                Key: "pencil-mechanical",
                Label: "Mechanical",
                Name: "Clutch pencil · 0.5 mm",
                Tone: "#7a838c",
                Art: { Barrel: "graphite", Core: "graphite", Back: "flat", Metal: "chrome", Clutch: true, Half: 6.5 },
                Settings: { Size: 0.6, Opacity: 92, Flow: 74, Hardness: 86, Spacing: 4, Smoothing: 40, Grade: "2H", Grain: 18, Pressure: false, Tilt: 0 },
                Swatches: ["#1c1c22", "#3a3a42", "#5a5f66"],
            },
            {
                Key: "pencil-charcoal",
                Label: "Charcoal",
                Name: "Compressed charcoal pencil",
                Tone: "#2a2a2e",
                Art: { Barrel: "black", Core: "charcoal", Back: "cap", Metal: "copper", Faceted: false },
                Settings: { Size: 3.2, Opacity: 96, Flow: 82, Hardness: 34, Spacing: 8, Smoothing: 18, Grade: "6B", Grain: 76, Pressure: true, Tilt: 40 },
                Swatches: ["#0a0a0c", "#2a2a2e", "#55555d", "#8a8f98"],
            },
        ],
    },
    {
        Key: "pen",
        Label: "Pens",
        Glyph: "vector",
        Tone: "#5b8cff",
        Crop: "188 10 56 40",
        Draw: PenArt,
        Schema: "Pen",
        Types: [
            {
                Key: "pen-fineliner",
                Label: "Fineliner",
                Name: "Technical fineliner · 0.3 mm",
                Tone: "#8a949c",
                Art: { Barrel: "graphite", Metal: "chrome", Nib: "tube" },
                Settings: { Size: 0.5, Opacity: 100, Flow: 100, Hardness: 94, Spacing: 4, Smoothing: 45, Pressure: false, Taper: 0 },
                Swatches: ["#15161a", "#1d3a8a", "#8d1e26", "#1f5c3a"],
            },
            {
                Key: "pen-fountain",
                Label: "Fountain",
                Name: "Fountain pen · medium nib",
                Tone: "#3a5f9c",
                Art: { Barrel: "navy", Metal: "gold", Nib: "fountain", Section: "bar" },
                Settings: { Size: 1.1, Opacity: 96, Flow: 88, Hardness: 78, Spacing: 5, Smoothing: 52, Pressure: true, Taper: 45 },
                Swatches: ["#16305e", "#15161a", "#5a0a1a", "#123a20"],
            },
            {
                Key: "pen-ballpoint",
                Label: "Ballpoint",
                Name: "Ballpoint · 1.0 mm",
                Tone: "#2b7f88",
                Art: { Barrel: "teal", Metal: "silver", Nib: "ball" },
                Settings: { Size: 0.8, Opacity: 84, Flow: 62, Hardness: 88, Spacing: 4, Smoothing: 35, Pressure: true, Taper: 20 },
                Swatches: ["#1d3a8a", "#15161a", "#8d1e26"],
            },
            {
                Key: "pen-italic",
                Label: "Italic",
                Name: "Calligraphy pen · 2 mm italic",
                Tone: "#f0cf7e",
                Art: { Barrel: "walnut", Metal: "gold", Nib: "chisel" },
                Settings: { Size: 2.4, Opacity: 100, Flow: 96, Hardness: 82, Spacing: 5, Smoothing: 48, Pressure: true, Taper: 70 },
                Swatches: ["#15161a", "#5a0a1a", "#16305e", "#4a2f18"],
            },
        ],
    },
    {
        Key: "marker",
        Label: "Markers",
        Glyph: "fill",
        Tone: "#c0303a",
        Crop: "176 6 72 48",
        Draw: MarkerArt,
        Schema: "Marker",
        Types: [
            {
                Key: "marker-bullet",
                Label: "Bullet",
                Name: "Permanent marker · bullet nib",
                Tone: "#15161a",
                Art: { Barrel: "graphite", Metal: "silver", Nib: "bullet", Ink: Ink.Dark },
                Settings: { Size: 3.4, Opacity: 100, Flow: 100, Hardness: 86, Spacing: 5, Smoothing: 30, Nib: "Fine", Bleed: 8, Pressure: false },
                Swatches: ["#15161a", "#c0303a", "#2352a6", "#1f7a4d", "#e0a13a"],
            },
            {
                Key: "marker-chisel",
                Label: "Chisel",
                Name: "Alcohol marker · chisel nib",
                Tone: "#c0303a",
                Art: { Barrel: "ivory", Metal: "chrome", Nib: "chisel", Ink: Ink.Warm },
                Settings: { Size: 6.5, Opacity: 92, Flow: 86, Hardness: 72, Spacing: 6, Smoothing: 26, Nib: "Chisel", Bleed: 38, Pressure: false },
                Swatches: ["#c0303a", "#e0a13a", "#2b7f88", "#6b4a9e", "#15161a"],
            },
            {
                Key: "marker-brush",
                Label: "Brush nib",
                Name: "Brush marker · flexible nib",
                Tone: "#2352a6",
                Art: { Barrel: "navy", Metal: "silver", Nib: "taper", Ink: ["#5b8cff", "#2352a6", "#122f66"] },
                Settings: { Size: 4.2, Opacity: 88, Flow: 78, Hardness: 44, Spacing: 7, Smoothing: 42, Nib: "Fine", Bleed: 46, Pressure: true },
                Swatches: ["#2352a6", "#5b8cff", "#15161a", "#c0303a"],
            },
            {
                Key: "marker-broad",
                Label: "Broad",
                Name: "Paint marker · broad wedge",
                Tone: "#e0a13a",
                Art: { Barrel: "amber", Metal: "gold", Nib: "broad", Ink: ["#f0cf7e", "#d98c2b", "#7a4410"], Half: 10 },
                Settings: { Size: 11, Opacity: 100, Flow: 100, Hardness: 90, Spacing: 5, Smoothing: 18, Nib: "Broad", Bleed: 4, Pressure: false },
                Swatches: ["#e0a13a", "#f4f1ea", "#c0303a", "#15161a"],
            },
        ],
    },
    {
        Key: "dry",
        Label: "Dry media",
        Glyph: "noise",
        Tone: "#efece2",
        Crop: "182 7 72 46",
        Draw: DryArt,
        Schema: "Dry",
        Types: [
            {
                Key: "dry-chalk",
                Label: "Chalk",
                Name: "Chalk stick · square section",
                Tone: "#efece2",
                Art: { Pigment: "chalk", Section: "square", Half: 11, Dust: 11, Seed: 2 },
                Settings: { Size: 8, Opacity: 88, Flow: 62, Hardness: 30, Spacing: 14, Smoothing: 12, Grain: 78, Scatter: 34, Pressure: true },
                Swatches: ["#f4f2ec", "#e6d9b8", "#bcd3e6", "#e3bcbc"],
            },
            {
                Key: "dry-pastel",
                Label: "Soft pastel",
                Name: "Soft pastel · wrapped",
                Tone: "#d86a22",
                Art: { Pigment: "pastel", Section: "round", Half: 11, Wrap: true, Dust: 8, Seed: 5 },
                Settings: { Size: 10, Opacity: 96, Flow: 85, Hardness: 22, Spacing: 12, Smoothing: 18, Grain: 52, Scatter: 20, Pressure: true },
                Swatches: ["#f08a3c", "#3f7ae0", "#c0303a", "#3f9e6a", "#6b4a9e"],
            },
            {
                Key: "dry-charcoal",
                Label: "Vine charcoal",
                Name: "Vine charcoal · medium",
                Tone: "#242428",
                Art: { Pigment: "charcoal", Section: "round", Half: 11, Back: 126, Tip: 236, Dust: 12, Seed: 7 },
                Settings: { Size: 6, Opacity: 82, Flow: 58, Hardness: 16, Spacing: 16, Smoothing: 10, Grain: 88, Scatter: 48, Pressure: true },
                Swatches: ["#101013", "#3a3a3f", "#6a6a70", "#9a9aa2"],
            },
            {
                Key: "dry-conte",
                Label: "Conté",
                Name: "Conté crayon · sanguine",
                Tone: "#8a3a26",
                Art: { Pigment: "conte", Section: "square", Half: 9, Back: 132, Dust: 6, Seed: 11 },
                Settings: { Size: 5, Opacity: 94, Flow: 76, Hardness: 44, Spacing: 10, Smoothing: 16, Grain: 60, Scatter: 14, Pressure: true },
                Swatches: ["#a8503a", "#5a2214", "#2a2a2e", "#efece2"],
            },
        ],
    },
    {
        Key: "wax",
        Label: "Wax and oil",
        Glyph: "material",
        Tone: "#c02a30",
        Crop: "188 7 70 46",
        Draw: WaxArt,
        Schema: "Wax",
        Types: [
            {
                Key: "wax-crayon",
                Label: "Crayon",
                Name: "Wax crayon · banded",
                Tone: "#c02a30",
                Art: { Pigment: "crayon", Wrap: "band", Half: 9.5 },
                Settings: { Size: 6, Opacity: 92, Flow: 72, Hardness: 52, Spacing: 9, Smoothing: 20, Grain: 46, Melt: 18, Pressure: true },
                Swatches: ["#e04a4a", "#3a6ad8", "#e0a13a", "#1f7a4d", "#15161a"],
            },
            {
                Key: "wax-oilstick",
                Label: "Oil stick",
                Name: "Oil stick · heavy body",
                Tone: "#2a4ab0",
                Art: { Pigment: "oil", Half: 12, Back: 110, Shoulder: 214, Tip: 240, Faceted: true },
                Settings: { Size: 12, Opacity: 100, Flow: 94, Hardness: 36, Spacing: 10, Smoothing: 24, Grain: 22, Melt: 64, Pressure: true },
                Swatches: ["#3a6ad8", "#c0303a", "#e0a13a", "#f4f1ea", "#15161a"],
            },
            {
                Key: "wax-china",
                Label: "China marker",
                Name: "China marker · paper wound",
                Tone: "#dcd6c8",
                Art: { Pigment: "china", Wrap: "spiral", Half: 8.5, Back: 112, Shoulder: 216, Tip: 238 },
                Settings: { Size: 3.6, Opacity: 98, Flow: 88, Hardness: 66, Spacing: 7, Smoothing: 22, Grain: 16, Melt: 30, Pressure: false },
                Swatches: ["#f2efe8", "#15161a", "#c0303a", "#1f5c3a"],
            },
        ],
    },
];

// 🔴 The family key and schema are stamped onto the type objects themselves rather than onto copies. The card compares
//    instruments by identity when it highlights the active tile, and a flattened list of clones would never match the
//    entry the rail handed it.
for (const Family of InstrumentFamilies)
{
    for (const Type of Family.Types)
    {
        Type.Family = Family.Key;
        Type.Schema = Family.Schema;
    }
}

export const InstrumentTypes = InstrumentFamilies.flatMap((Family) => Family.Types);

export const InstrumentByKey = Object.fromEntries(InstrumentTypes.map((Type) => [Type.Key, Type]));

export const FamilyByKey = Object.fromEntries(InstrumentFamilies.map((Family) => [Family.Key, Family]));

export const FamilyOf = (Type) => FamilyByKey[Type.Family];

// The drawing for one instrument, at either scale. Cached by the caller — the markup never changes for a given key.
export const InstrumentArtwork = (Type, View = FullView) =>
{
    const Family = FamilyOf(Type);
    return Artwork(Family.Draw(Type.Key.replace(/[^a-z0-9]/gi, ""), Type.Art), View);
};

//--------------------------------------------------------------------------------------------------------------------------
// Pushing an instrument onto the live brush.
//
// 🔴 Opacity and Flow both fold into the brush's single Flow, because the stamping pass has ONE deposit strength. They
//    stay separate in the card because they mean different things to a painter, and separating them for real needs the
//    per-stroke accumulation the pass does not have.
// 🔴 Grain lands on Jitter only where the schema marks it wired. A pen has no grain control and must not inherit the
//    chalk stick's jitter just because the two share a settings object shape.
//--------------------------------------------------------------------------------------------------------------------------
const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));

export const BrushFromInstrument = (Type, Settings) =>
{
    const Wired = new Set(
        InstrumentSchema[Type.Schema].filter((Control) => Control.Wired).map((Control) => Control.Key),
    );
    return {
        Radius: Clamp(Settings.Size / 100, 0.004, 0.6),
        Hardness: Clamp(Settings.Hardness / 100, 0, 1),
        Flow: Clamp((Settings.Opacity / 100) * (Settings.Flow / 100), 0.02, 1),
        Spacing: Clamp(Settings.Spacing / 100, 0.05, 1),
        Jitter: Wired.has("Grain") ? Clamp((Settings.Grain ?? 0) / 100, 0, 1) : 0,
    };
};

// What a stroke record keeps of the instrument that laid it. BrushFromInstrument above is lossy by design, and the
// settings it discards — grade, nib, head, wetness, bleed, taper, tilt, smoothing — are exactly what a reconstruction
// would need, so they are captured here at the only point that still holds them.
export const InstrumentRecord = (Type, Settings) => ({
    Key: Type.Key,
    Name: Type.Name,
    Family: Type.Family,
    Schema: Type.Schema,
    Tone: Type.Tone,
    Settings: { ...Settings },
    Wired: VisibleControls(Type, Settings)
        .filter((Control) => Control.Wired)
        .map((Control) => Control.Key),
});

//============================================================================================================================================
// 🏷 DecalSpecification.js — SVG mark library, OFL font archive and the rasterisers that turn both into decal images
//============================================================================================================================================
// A decal is an RGBA image plus a placement frame. This module owns the image half: a library of vector marks, custom SVG
// markup, and text set in the engine's own OFL faces. Everything rasterises into a square canvas with straight alpha, which
// ShadingIntegrator uploads as the decal texture. The placement half lives in LayerSpecification.js / StrokeProjection.js.
//============================================================================================================================================

import { SanitiseMarkup } from "./LayerSpecification.js";
//--------------------------------------------------------------------------------------------------------------------------
// Font addresses resolve against this module rather than through a bundler plugin, so the editor runs from a plain static
// host as happily as it does under the dev server — and the literal form is the one a bundler can still rewrite.
//--------------------------------------------------------------------------------------------------------------------------

const DmSansLight = new URL("../../../EngineContent/Fonts/SunReference/DMSans-Light.ttf", import.meta.url).href;
const DmSansRegular = new URL("../../../EngineContent/Fonts/SunReference/DMSans-Regular.ttf", import.meta.url).href;
const ArchivoRegular = new URL("../../../../EngineContent/FontArchives/Archivo/Archivo-Regular.ttf", import.meta.url).href;
const ArchivoBold = new URL("../../../../EngineContent/FontArchives/Archivo/Archivo-Bold.ttf", import.meta.url).href;
const ClashRegular = new URL("../../../../EngineContent/FontArchives/ClashDisplay/ClashDisplay-Regular.ttf", import.meta.url).href;
const ClashBold = new URL("../../../../EngineContent/FontArchives/ClashDisplay/ClashDisplay-Bold.ttf", import.meta.url).href;
const FiraRegular = new URL("../../../../EngineContent/FontArchives/FiraSans/FiraSans-Regular.ttf", import.meta.url).href;
const FiraBold = new URL("../../../../EngineContent/FontArchives/FiraSans/FiraSans-Bold.ttf", import.meta.url).href;
const InterRegular = new URL("../../../../EngineContent/FontArchives/Inter/Inter-Regular.otf", import.meta.url).href;
const InterBold = new URL("../../../../EngineContent/FontArchives/Inter/Inter-Bold.otf", import.meta.url).href;
const MonoRegular = new URL("../../../../EngineContent/FontArchives/JetBrainsMono/JetBrainsMono-Regular.ttf", import.meta.url).href;
const MonoBold = new URL("../../../../EngineContent/FontArchives/JetBrainsMono/JetBrainsMono-Bold.ttf", import.meta.url).href;
const LatoRegular = new URL("../../../../EngineContent/FontArchives/Lato/Lato-Regular.ttf", import.meta.url).href;
const LatoBold = new URL("../../../../EngineContent/FontArchives/Lato/Lato-Bold.ttf", import.meta.url).href;
const MontserratRegular = new URL("../../../../EngineContent/FontArchives/Montserrat/Montserrat-Regular.ttf", import.meta.url).href;
const MontserratBold = new URL("../../../../EngineContent/FontArchives/Montserrat/Montserrat-Bold.ttf", import.meta.url).href;
const PoppinsRegular = new URL("../../../../EngineContent/FontArchives/Poppins/Poppins-Regular.ttf", import.meta.url).href;
const PoppinsBold = new URL("../../../../EngineContent/FontArchives/Poppins/Poppins-Bold.ttf", import.meta.url).href;
const GroteskRegular = new URL("../../../../EngineContent/FontArchives/SpaceGrotesk/SpaceGrotesk-Regular.ttf", import.meta.url).href;
const GroteskBold = new URL("../../../../EngineContent/FontArchives/SpaceGrotesk/SpaceGrotesk-Bold.ttf", import.meta.url).href;

//--------------------------------------------------------------------------------------------------------------------------
// OFL faces shipped with the engine. Loaded on demand — selecting a family fetches two weights, not twenty.
//--------------------------------------------------------------------------------------------------------------------------
export const FontArchive = [
    { Family: "DM Sans", Regular: DmSansRegular, Bold: DmSansRegular, Light: DmSansLight, Note: "Editor face" },
    { Family: "Archivo", Regular: ArchivoRegular, Bold: ArchivoBold, Note: "Grotesque" },
    { Family: "Clash Display", Regular: ClashRegular, Bold: ClashBold, Note: "Display" },
    { Family: "Fira Sans", Regular: FiraRegular, Bold: FiraBold, Note: "Humanist" },
    { Family: "Inter", Regular: InterRegular, Bold: InterBold, Note: "Interface" },
    { Family: "JetBrains Mono", Regular: MonoRegular, Bold: MonoBold, Note: "Monospace" },
    { Family: "Lato", Regular: LatoRegular, Bold: LatoBold, Note: "Humanist" },
    { Family: "Montserrat", Regular: MontserratRegular, Bold: MontserratBold, Note: "Geometric" },
    { Family: "Poppins", Regular: PoppinsRegular, Bold: PoppinsBold, Note: "Geometric" },
    { Family: "Space Grotesk", Regular: GroteskRegular, Bold: GroteskBold, Note: "Technical" },
];

const LoadedFamilies = new Map();

export const LoadFamily = async (Family) =>
{
    if (LoadedFamilies.has(Family)) return LoadedFamilies.get(Family);
    const Entry = FontArchive.find((Candidate) => Candidate.Family === Family) || FontArchive[0];
    const Pending = (async () =>
    {
        const Faces = [
            new FontFace(Entry.Family, `url(${Entry.Regular})`, { weight: "400" }),
            new FontFace(Entry.Family, `url(${Entry.Bold})`, { weight: "700" }),
        ];
        if (Entry.Light) Faces.push(new FontFace(Entry.Family, `url(${Entry.Light})`, { weight: "300" }));
        const Loaded = await Promise.all(Faces.map((Face) => Face.load()));
        for (const Face of Loaded) document.fonts.add(Face);
        return Entry.Family;
    })();
    LoadedFamilies.set(Family, Pending);
    return Pending;
};

//--------------------------------------------------------------------------------------------------------------------------
// Vector mark library. Shapes are authored white-on-transparent inside a 0 0 100 100 viewBox; the compositor takes alpha as
// coverage and either keeps the RGB or replaces it with the layer tint.
//--------------------------------------------------------------------------------------------------------------------------
const Mark = (Identifier, Label, Category, Body, Note) => ({ Identifier, Label, Category, Note, Markup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${Body}</svg>` });

const BarcodeBody = (() =>
{
    let Bars = "";
    let Cursor = 6;
    let Seed = 9;
    while (Cursor < 94)
    {
        Seed = (Seed * 1103515245 + 12345) % 2147483648;
        const Width = 1.4 + ((Seed >> 7) % 4) * 1.1;
        Bars += `<rect x="${Cursor.toFixed(2)}" y="18" width="${Width.toFixed(2)}" height="54" fill="#fff"/>`;
        Cursor += Width + 1.3 + ((Seed >> 11) % 3) * 0.8;
    }
    return `${Bars}<rect x="6" y="76" width="88" height="6" fill="#fff" opacity="0.85"/>`;
})();

const CircuitBody = (() =>
{
    const Segments = [
        "M8 20h26l8 8h30", "M8 44h14l10-10", "M30 92V64l12-12h32", "M74 8v20l10 10v26",
        "M50 92h34l8-8V60", "M8 68h18l8 8h22", "M60 36h26", "M20 20v14",
    ];
    const Pads = [[34, 28], [72, 28], [74, 64], [42, 52], [26, 76], [86, 60], [20, 34], [60, 36]];
    return (
        Segments.map((Path) => `<path d="${Path}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`).join("") +
        Pads.map(([X, Y]) => `<circle cx="${X}" cy="${Y}" r="4.4" fill="#fff"/>`).join("")
    );
})();

const SplatterBody = (() =>
{
    let Seed = 2654435761;
    const Random = () =>
    {
        Seed = (Seed * 1664525 + 1013904223) >>> 0;
        return Seed / 4294967296;
    };
    let Body = "";
    for (let Index = 0; Index < 42; Index += 1)
    {
        const Angle = Random() * Math.PI * 2;
        const Radius = Math.pow(Random(), 0.65) * 44;
        const X = 50 + Math.cos(Angle) * Radius;
        const Y = 50 + Math.sin(Angle) * Radius * 0.92;
        const Size = (1 - Radius / 52) * 9 * (0.35 + Random());
        Body += `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${Math.max(0.8, Size).toFixed(2)}" fill="#fff"/>`;
    }
    return Body;
})();

export const DecalLibrary = [
    Mark("hazard", "Hazard", "sign", '<path d="M50 10 94 86H6Z" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><rect x="46" y="36" width="8" height="26" rx="4" fill="#fff"/><circle cx="50" cy="71" r="5" fill="#fff"/>', "ISO 7010 W001"),
    Mark("voltage", "High voltage", "sign", '<path d="M58 6 26 54h18l-6 40 34-52H52Z" fill="#fff"/>', "IEC 60417"),
    Mark("radiation", "Radiation", "sign", '<circle cx="50" cy="50" r="9" fill="#fff"/><path d="M50 8a42 42 0 0 1 36.4 21L63 42A15 15 0 0 0 50 34Z" fill="#fff"/><path d="M86.4 71A42 42 0 0 1 13.6 71L37 58a15 15 0 0 0 26 0Z" fill="#fff"/><path d="M13.6 29A42 42 0 0 1 50 8v26a15 15 0 0 0-13 8Z" fill="#fff"/>', "Trefoil"),
    Mark("recycle", "Recycle", "sign", '<path d="M50 12 64 36H54v18h-8V36H36Z" fill="#fff"/><path d="M14 74 28 50l5 8 15-9 4 7-15 9 5 8Z" fill="#fff"/><path d="M86 74 72 50l-5 8-15-9-4 7 15 9-5 8Z" fill="#fff"/><path d="M26 80h48v8H26Z" fill="#fff"/>', "Mobius"),
    Mark("arrow", "Arrow", "mark", '<path d="M14 44h44V26l28 24-28 24V56H14Z" fill="#fff"/>', "Direction"),
    Mark("target", "Target", "mark", '<circle cx="50" cy="50" r="38" fill="none" stroke="#fff" stroke-width="5"/><circle cx="50" cy="50" r="20" fill="none" stroke="#fff" stroke-width="5"/><circle cx="50" cy="50" r="5" fill="#fff"/><path d="M50 2v18M50 80v18M2 50h18M80 50h18" stroke="#fff" stroke-width="5" stroke-linecap="round"/>', "Crosshair"),
    Mark("gear", "Gear", "mark", '<path d="M44 6h12l2 12 10 4 10-7 8 8-7 10 4 10 12 2v12l-12 2-4 10 7 10-8 8-10-7-10 4-2 12H44l-2-12-10-4-10 7-8-8 7-10-4-10-12-2V44l12-2 4-10-7-10 8-8 10 7 10-4Z" fill="#fff"/><circle cx="50" cy="50" r="13" fill="#000"/>', "Mechanical"),
    Mark("barcode", "Barcode", "plate", BarcodeBody, "Serial plate"),
    Mark("circuit", "Circuit", "plate", CircuitBody, "Trace routing"),
    Mark("grate", "Grate", "plate", '<rect x="6" y="6" width="88" height="88" rx="6" fill="none" stroke="#fff" stroke-width="5"/><path d="M20 18v64M34 18v64M48 18v64M62 18v64M76 18v64" stroke="#fff" stroke-width="7" stroke-linecap="round"/>', "Vent"),
    Mark("numerals", "Numerals 07", "plate", '<text x="50" y="72" font-family="Archivo, DM Sans, sans-serif" font-size="68" font-weight="700" text-anchor="middle" fill="#fff">07</text>', "Stencil set"),
    Mark("splatter", "Splatter", "grunge", SplatterBody, "Grunge alpha"),
    Mark("scuff", "Scuff", "grunge", '<path d="M8 62c18-10 28 6 44-4s26 2 40-10" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity="0.8"/><path d="M14 44c14 6 24-6 38 0s24-4 36 2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.55"/>', "Wipe"),
    Mark("frontier", "Frontier mark", "mark", '<path d="M50 6c6 26-22 26-9 46-13-4-13-17-13-17C6 72 42 96 60 76c14-16 4-46-10-70Z" fill="#fff"/>', "Engine badge"),
];

export const DecalCategories = [
    { Identifier: "all", Label: "All" },
    { Identifier: "sign", Label: "Signage" },
    { Identifier: "mark", Label: "Marks" },
    { Identifier: "plate", Label: "Plates" },
    { Identifier: "grunge", Label: "Grunge" },
];

export const DecalByIdentifier = Object.fromEntries(DecalLibrary.map((Entry) => [Entry.Identifier, Entry]));

//--------------------------------------------------------------------------------------------------------------------------
// Rasterisers. Both return a canvas with straight alpha, sized DecalResolution × DecalResolution.
//--------------------------------------------------------------------------------------------------------------------------
export const DecalResolution = 1024;

const CreateSurface = (Size = DecalResolution) =>
{
    const Surface = document.createElement("canvas");
    Surface.width = Size;
    Surface.height = Size;
    return Surface;
};

export const RasteriseVector = async (Markup, Size = DecalResolution) =>
{
    const Surface = CreateSurface(Size);
    const Context = Surface.getContext("2d");
    const Source = Markup.includes("<svg") ? Markup : DecalByIdentifier.hazard.Markup;
    const Encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(Source)}`;
    const Picture = new Image();
    Picture.decoding = "sync";
    await new Promise((Resolve, Reject) =>
    {
        Picture.onload = Resolve;
        Picture.onerror = () => Reject(new Error("The SVG markup could not be decoded."));
        Picture.src = Encoded;
    });
    const Width = Picture.naturalWidth || Size;
    const Height = Picture.naturalHeight || Size;
    const Fit = Math.min(Size / Width, Size / Height);
    const DrawWidth = Width * Fit;
    const DrawHeight = Height * Fit;
    Context.drawImage(Picture, (Size - DrawWidth) / 2, (Size - DrawHeight) / 2, DrawWidth, DrawHeight);
    return Surface;
};

export const RasteriseText = async (Settings, Size = DecalResolution) =>
{
    const Family = (await LoadFamily(Settings.Family).catch(() => "sans-serif")) || "sans-serif";
    const Surface = CreateSurface(Size);
    const Context = Surface.getContext("2d");
    const Lines = String(Settings.Content || " ").split("\n").slice(0, 8);
    const PointSize = Math.max(8, Math.min(512, Settings.Size || 180));
    Context.textAlign = "center";
    Context.textBaseline = "middle";
    Context.fillStyle = "#ffffff";
    Context.strokeStyle = "#ffffff";
    Context.lineJoin = "round";
    const Weight = Settings.Weight || 400;
    Context.font = `${Weight} ${PointSize}px "${Family}", sans-serif`;
    if ("letterSpacing" in Context) Context.letterSpacing = `${Settings.Tracking || 0}px`;
    const LineAdvance = PointSize * (Settings.LineHeight || 1.1);
    const Block = LineAdvance * (Lines.length - 1);
    const Widest = Math.max(...Lines.map((Line) => Context.measureText(Line).width), 1);
    const Fit = Math.min(1, (Size * 0.88) / Widest, (Size * 0.88) / (Block + PointSize * 1.15));
    Context.translate(Size / 2, Size / 2);
    Context.scale(Fit, Fit);
    Lines.forEach((Line, Index) =>
    {
        const Offset = Index * LineAdvance - Block / 2;
        if (Settings.Outline > 0)
        {
            Context.lineWidth = Settings.Outline * 2;
            Context.strokeText(Line, 0, Offset);
        }
        else Context.fillText(Line, 0, Offset);
    });
    return Surface;
};

export const RasteriseDecal = async (Decal) =>
{
    if (Decal.SourceKind === "text") return RasteriseText(Decal.Text);
    const Markup = SanitiseMarkup(Decal.Library === "custom" ? Decal.Svg : DecalByIdentifier[Decal.Library]?.Markup);
    return RasteriseVector(Markup || DecalByIdentifier.hazard.Markup);
};

//--------------------------------------------------------------------------------------------------------------------------
// Markup hygiene lives in LayerSpecification.js so that project validation and rasterising share one implementation.
//--------------------------------------------------------------------------------------------------------------------------
export { SanitiseMarkup };

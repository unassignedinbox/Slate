//============================================================================================================================================
// 📦 SheetIndex — decodes FoliageSheet.toml and the three sheet images the bake emitted.
//============================================================================================================================================
// A deliberately small TOML reader: the descriptor is machine-written by SheetSequence.mjs, so only the subset it
//    emits needs parsing (tables, table arrays, strings, numbers, flat numeric arrays). The C++ port hands the same
//    file to tomlpp instead.

//------------------------------------------------------------------------------------------------------------------------
//                                                      TOML READING
//------------------------------------------------------------------------------------------------------------------------

function ReadValue(Text)
{
    const Trimmed = Text.trim();
    if (Trimmed.startsWith("\"")) return Trimmed.slice(1, -1);
    if (Trimmed.startsWith("["))
    {
        const Body = Trimmed.slice(1, -1).trim();
        if (Body === "") return [];
        return Body.split(",").map((Part) => ReadValue(Part));
    }
    if (Trimmed === "true")  return true;
    if (Trimmed === "false") return false;
    const Number_ = Number(Trimmed);
    return Number.isNaN(Number_) ? Trimmed : Number_;
}

export function ReadDescriptor(Text)
{
    const Root = {};
    let   Table = Root;

    for (const Line of Text.split("\n"))
    {
        const Clean = Line.trim();
        if (Clean === "" || Clean.startsWith("#")) continue;

        if (Clean.startsWith("[["))
        {
            const Name = Clean.slice(2, Clean.indexOf("]]")).trim();
            if (!Array.isArray(Root[Name])) Root[Name] = [];
            Table = {};
            Root[Name].push(Table);
            continue;
        }
        if (Clean.startsWith("["))
        {
            const Name = Clean.slice(1, Clean.indexOf("]")).trim();
            Root[Name] = Root[Name] ?? {};
            Table = Root[Name];
            continue;
        }

        const Split = Clean.indexOf("=");
        if (Split < 0) continue;
        Table[Clean.slice(0, Split).trim()] = ReadValue(Clean.slice(Split + 1));
    }
    return Root;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       SHEET INDEX
//------------------------------------------------------------------------------------------------------------------------

async function AcquireImage(Path)
{
    const Decoded = new Image();
    Decoded.src = Path;
    await Decoded.decode();
    return Decoded;
}

export class SheetIndex
{
    static async Acquire(Report = () => {})
    {
        Report("Decoding foliage sheet…");
        const Descriptor = ReadDescriptor(await (await fetch("/SheetArchives/FoliageSheet.toml")).text());

        const Extent  = Descriptor.sheet.extent;
        const Cutouts = (Descriptor.cutout ?? []).map((Record) =>
        {
            const [X, Y, Width, Height] = Record.rect;
            return {
                Name:   Record.name,
                Family: Record.family,
                Width, Height,
                // Half-texel inset stops a neighbouring cutout bleeding in under linear filtering.
                Rect: [
                    (X + 0.5) / Extent,
                    (Y + 0.5) / Extent,
                    (Width  - 1.0) / Extent,
                    (Height - 1.0) / Extent
                ],
                AnchorU: Record.anchor[0],
                AnchorV: Record.anchor[1],
                TipU:    Record.tip[0],
                TipV:    Record.tip[1],
                Fill:    Record.fill,
                Tint:    Record.tint
            };
        });

        const Grouped = {};
        for (const Cutout of Cutouts)
        {
            Grouped[Cutout.Family] = Grouped[Cutout.Family] ?? [];
            Grouped[Cutout.Family].push(Cutout);
        }

        Report("Loading sheet imagery…");
        const [FoliageAlbedo, FoliageNormal, FoliageSurface,
               BarkAlbedo, BarkNormal, BarkSurface,
               GroundAlbedo, GroundNormal, GroundSurface] = await Promise.all(
        [
            AcquireImage("/SheetArchives/FoliageSheet_Albedo.png"),
            AcquireImage("/SheetArchives/FoliageSheet_Normal.png"),
            AcquireImage("/SheetArchives/FoliageSheet_Surface.png"),
            AcquireImage("/SheetArchives/Bark_Albedo.png"),
            AcquireImage("/SheetArchives/Bark_Normal.png"),
            AcquireImage("/SheetArchives/Bark_Surface.png"),
            AcquireImage("/SheetArchives/Ground_Albedo.png"),
            AcquireImage("/SheetArchives/Ground_Normal.png"),
            AcquireImage("/SheetArchives/Ground_Surface.png")
        ]);

        const Index = new SheetIndex();
        Index.Extent   = Extent;
        Index.Cutouts  = Cutouts;
        Index.Grouped  = Grouped;
        Index.Families = Object.keys(Grouped).sort();
        Index.Imagery  = {
            FoliageAlbedo, FoliageNormal, FoliageSurface,
            BarkAlbedo, BarkNormal, BarkSurface,
            GroundAlbedo, GroundNormal, GroundSurface
        };
        return Index;
    }
}

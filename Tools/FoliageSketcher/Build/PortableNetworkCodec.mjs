//============================================================================================================================================
// 📦 PortableNetworkCodec — dependency-free PNG decode / encode for the offline foliage bake.
//============================================================================================================================================
// Node's zlib is the only import; nothing is installed to run the bake sequence. Supports non-interlaced bit-depth-8
//    colour types 0 (grey), 2 (RGB), 4 (grey+alpha) and 6 (RGBA) on decode, and emits colour type 6 or 2 on encode.
//
// Every surface handed across this seam is a flat Uint8Array of 8-bit channels in row-major order, origin top-left.

import { inflateSync, deflateSync } from "node:zlib";

const Signature = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

//------------------------------------------------------------------------------------------------------------------------
//                                                    CYCLIC REDUNDANCY
//------------------------------------------------------------------------------------------------------------------------

const CyclicTable = (() =>
{
    const Entries = new Uint32Array(256);
    for (let Index = 0; Index < 256; ++Index)
    {
        let Accumulator = Index;
        for (let Bit = 0; Bit < 8; ++Bit)
            Accumulator = (Accumulator & 1) ? (0xEDB88320 ^ (Accumulator >>> 1)) : (Accumulator >>> 1);
        Entries[Index] = Accumulator >>> 0;
    }
    return Entries;
})();

function CyclicRedundancy(Bytes)
{
    let Accumulator = 0xFFFFFFFF;
    for (let Index = 0; Index < Bytes.length; ++Index)
        Accumulator = CyclicTable[(Accumulator ^ Bytes[Index]) & 0xFF] ^ (Accumulator >>> 8);
    return (Accumulator ^ 0xFFFFFFFF) >>> 0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       PAETH PREDICTOR
//------------------------------------------------------------------------------------------------------------------------

function Paeth(Left, Above, AboveLeft)
{
    const Estimate  = Left + Above - AboveLeft;
    const DeltaA    = Math.abs(Estimate - Left);
    const DeltaB    = Math.abs(Estimate - Above);
    const DeltaC    = Math.abs(Estimate - AboveLeft);
    if (DeltaA <= DeltaB && DeltaA <= DeltaC) return Left;
    if (DeltaB <= DeltaC)                     return Above;
    return AboveLeft;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          DECODE
//------------------------------------------------------------------------------------------------------------------------

// Returns { Width, Height, Texels } where Texels is RGBA8, four channels per texel.
export function DecodeSurface(FileBytes)
{
    const Bytes = Uint8Array.from(FileBytes);
    for (let Index = 0; Index < 8; ++Index)
        if (Bytes[Index] !== Signature[Index]) throw new Error("PortableNetworkCodec: not a PNG stream");

    const View = new DataView(Bytes.buffer, Bytes.byteOffset, Bytes.byteLength);
    let   Cursor = 8;

    let Width = 0, Height = 0, BitDepth = 0, ColourCategory = 0, Interlace = 0;
    const Compressed = [];
    let   Palette = null, PaletteAlpha = null;

    while (Cursor < Bytes.length)
    {
        const Length = View.getUint32(Cursor); Cursor += 4;
        const Name   = String.fromCharCode(Bytes[Cursor], Bytes[Cursor + 1], Bytes[Cursor + 2], Bytes[Cursor + 3]); Cursor += 4;
        const Body   = Bytes.subarray(Cursor, Cursor + Length); Cursor += Length + 4;   // + 4 skips the chunk CRC

        if (Name === "IHDR")
        {
            Width          = View.getUint32(Cursor - Length - 4 + 0);
            Height         = View.getUint32(Cursor - Length - 4 + 4);
            BitDepth       = Body[8];
            ColourCategory = Body[9];
            Interlace      = Body[12];
        }
        else if (Name === "PLTE") Palette      = Body.slice();
        else if (Name === "tRNS") PaletteAlpha = Body.slice();
        else if (Name === "IDAT") Compressed.push(Body.slice());
        else if (Name === "IEND") break;
    }

    if (BitDepth !== 8)  throw new Error(`PortableNetworkCodec: bit depth ${BitDepth} unsupported (8 only)`);
    if (Interlace !== 0) throw new Error("PortableNetworkCodec: interlaced streams unsupported");

    const ChannelsFor = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    const Channels    = ChannelsFor[ColourCategory];
    if (Channels === undefined) throw new Error(`PortableNetworkCodec: colour type ${ColourCategory} unsupported`);

    const Merged   = Buffer.concat(Compressed.map((Part) => Buffer.from(Part)));
    const Raw      = new Uint8Array(inflateSync(Merged));
    const Stride   = Width * Channels;
    const Restored = new Uint8Array(Stride * Height);

    for (let Row = 0; Row < Height; ++Row)
    {
        const FilterCategory = Raw[Row * (Stride + 1)];
        const SourceStart    = Row * (Stride + 1) + 1;
        const TargetStart    = Row * Stride;
        const PriorStart     = TargetStart - Stride;

        for (let Column = 0; Column < Stride; ++Column)
        {
            const Encoded   = Raw[SourceStart + Column];
            const Left      = Column >= Channels ? Restored[TargetStart + Column - Channels] : 0;
            const Above     = Row > 0            ? Restored[PriorStart  + Column]            : 0;
            const AboveLeft = (Row > 0 && Column >= Channels) ? Restored[PriorStart + Column - Channels] : 0;

            let Decoded;
            switch (FilterCategory)
            {
                case 0:  Decoded = Encoded;                                            break;
                case 1:  Decoded = Encoded + Left;                                     break;
                case 2:  Decoded = Encoded + Above;                                    break;
                case 3:  Decoded = Encoded + ((Left + Above) >> 1);                    break;
                case 4:  Decoded = Encoded + Paeth(Left, Above, AboveLeft);            break;
                default: throw new Error(`PortableNetworkCodec: filter ${FilterCategory} unknown`);
            }
            Restored[TargetStart + Column] = Decoded & 0xFF;
        }
    }

    const Texels = new Uint8Array(Width * Height * 4);
    for (let Index = 0, Count = Width * Height; Index < Count; ++Index)
    {
        const Read  = Index * Channels;
        const Write = Index * 4;
        if (ColourCategory === 0)      { const G = Restored[Read]; Texels[Write] = G; Texels[Write + 1] = G; Texels[Write + 2] = G; Texels[Write + 3] = 255; }
        else if (ColourCategory === 2) { Texels[Write] = Restored[Read]; Texels[Write + 1] = Restored[Read + 1]; Texels[Write + 2] = Restored[Read + 2]; Texels[Write + 3] = 255; }
        else if (ColourCategory === 4) { const G = Restored[Read]; Texels[Write] = G; Texels[Write + 1] = G; Texels[Write + 2] = G; Texels[Write + 3] = Restored[Read + 1]; }
        else if (ColourCategory === 6) { Texels[Write] = Restored[Read]; Texels[Write + 1] = Restored[Read + 1]; Texels[Write + 2] = Restored[Read + 2]; Texels[Write + 3] = Restored[Read + 3]; }
        else                           // colour type 3 — palette
        {
            const Slot = Restored[Read] * 3;
            Texels[Write]     = Palette ? Palette[Slot]     : 0;
            Texels[Write + 1] = Palette ? Palette[Slot + 1] : 0;
            Texels[Write + 2] = Palette ? Palette[Slot + 2] : 0;
            Texels[Write + 3] = PaletteAlpha && Restored[Read] < PaletteAlpha.length ? PaletteAlpha[Restored[Read]] : 255;
        }
    }

    return { Width, Height, Texels };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          ENCODE
//------------------------------------------------------------------------------------------------------------------------

function Chunk(Name, Body)
{
    const Out = Buffer.alloc(Body.length + 12);
    Out.writeUInt32BE(Body.length, 0);
    Out.write(Name, 4, 4, "ascii");
    Buffer.from(Body).copy(Out, 8);
    Out.writeUInt32BE(CyclicRedundancy(Out.subarray(4, 8 + Body.length)), 8 + Body.length);
    return Out;
}

// Texels is RGBA8. WithAlpha false emits colour type 2 (RGB) — used for normal and surface sheets.
export function EncodeSurface(Width, Height, Texels, WithAlpha = true)
{
    const Channels = WithAlpha ? 4 : 3;
    const Stride   = Width * Channels;
    const Raw      = Buffer.alloc((Stride + 1) * Height);

    // Filter 1 (Sub) on every row: cheap, and consistently beats None on photographic plates.
    for (let Row = 0; Row < Height; ++Row)
    {
        const Write = Row * (Stride + 1);
        Raw[Write]  = 1;
        for (let Column = 0; Column < Width; ++Column)
        {
            const Read = (Row * Width + Column) * 4;
            for (let Channel = 0; Channel < Channels; ++Channel)
            {
                const Current = Texels[Read + Channel];
                const Left    = Column > 0 ? Texels[Read + Channel - 4] : 0;
                Raw[Write + 1 + Column * Channels + Channel] = (Current - Left) & 0xFF;
            }
        }
    }

    const Header = Buffer.alloc(13);
    Header.writeUInt32BE(Width, 0);
    Header.writeUInt32BE(Height, 4);
    Header[8]  = 8;                       // bit depth
    Header[9]  = WithAlpha ? 6 : 2;       // colour type
    Header[10] = 0;                       // deflate
    Header[11] = 0;                       // adaptive filtering
    Header[12] = 0;                       // no interlace

    return Buffer.concat([
        Buffer.from(Signature),
        Chunk("IHDR", Header),
        Chunk("IDAT", deflateSync(Raw, { level: 9 })),
        Chunk("IEND", Buffer.alloc(0))
    ]);
}

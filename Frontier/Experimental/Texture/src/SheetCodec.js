//============================================================================================================================================
// 🧬 SheetCodec.js — painted layer images ⇄ PNG text, so a saved document carries the paint and not only the recipe
//============================================================================================================================================
// A layer's sheet lives on the GPU as premultiplied RGBA8. This module is the only place that turns one into bytes a
// .pigment file can hold, and back: a complete PNG writer and reader over the platform's own deflate, with no canvas in
// the middle — a canvas round trip would premultiply what is already premultiplied and lose the faintest coverage. The
// consequence is that the same code runs under node, so the round trip is asserted by the test suite rather than hoped for.
//============================================================================================================================================

import { FlipRows } from "./ExportSequence.js";

//--------------------------------------------------------------------------------------------------------------------------
// How much encoded paint one document will carry. Past this the sheets are left out and the saver says so, rather than
// handing the browser a string it cannot allocate.
//--------------------------------------------------------------------------------------------------------------------------
export const SheetAllowance = 96 * 1024 * 1024;              // [B]   encoded text one .pigment document may hold
import { PaintedTargets } from "./ChannelSpecification.js";

// Coverage first, then the channel images a per-stroke layer grew, then the mask. A layer that never needed the
// middle three simply has nothing to collect for them.
export const SheetTargets = ["coverage", ...PaintedTargets, "mask"];

const Signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

//--------------------------------------------------------------------------------------------------------------------------
// PNG plumbing: a CRC over every chunk, and the platform's deflate for the pixels. CompressionStream("deflate") emits
// the zlib wrapper RFC 1950 asks for, which is exactly what an IDAT stream is, so no adler sum is computed here.
//--------------------------------------------------------------------------------------------------------------------------
const CrcOrdering = (() =>
{
    const Ordering = new Uint32Array(256);
    for (let Index = 0; Index < 256; Index += 1)
    {
        let Value = Index;
        for (let Bit = 0; Bit < 8; Bit += 1) Value = Value & 1 ? 0xedb88320 ^ (Value >>> 1) : Value >>> 1;
        Ordering[Index] = Value >>> 0;
    }
    return Ordering;
})();

const Checksum = (Bytes) =>
{
    let Value = 0xffffffff;
    for (let Index = 0; Index < Bytes.length; Index += 1) Value = CrcOrdering[(Value ^ Bytes[Index]) & 0xff] ^ (Value >>> 8);
    return (Value ^ 0xffffffff) >>> 0;
};

const Deflate = async (Bytes) =>
{
    const Squeeze = new CompressionStream("deflate");
    const Writer = Squeeze.writable.getWriter();
    Writer.write(Bytes);
    Writer.close();
    return new Uint8Array(await new Response(Squeeze.readable).arrayBuffer());
};

const Inflate = async (Bytes) =>
{
    const Loosen = new DecompressionStream("deflate");
    const Writer = Loosen.writable.getWriter();
    Writer.write(Bytes);
    Writer.close();
    return new Uint8Array(await new Response(Loosen.readable).arrayBuffer());
};

const Chunk = (Name, Payload) =>
{
    const Typed = new Uint8Array(4 + Payload.length);
    for (let Index = 0; Index < 4; Index += 1) Typed[Index] = Name.charCodeAt(Index);
    Typed.set(Payload, 4);
    const Written = new Uint8Array(Typed.length + 8);
    const View = new DataView(Written.buffer);
    View.setUint32(0, Payload.length);
    Written.set(Typed, 4);
    View.setUint32(Written.length - 4, Checksum(Typed));
    return Written;
};

//--------------------------------------------------------------------------------------------------------------------------
// Row filters. PNG lets every scanline choose its own predictor; the writer tries four of the five and keeps whichever
// leaves the smallest signed sum, which is the heuristic the format's own authors recommend. On painted coverage — long
// transparent runs broken by one soft mark — it is the difference between a sheet that deflates to kilobytes and one
// that does not.
//--------------------------------------------------------------------------------------------------------------------------
const PaethGuess = (Left, Above, Corner) =>
{
    const Estimate = Left + Above - Corner;
    const ToLeft = Math.abs(Estimate - Left);
    const ToAbove = Math.abs(Estimate - Above);
    const ToCorner = Math.abs(Estimate - Corner);
    if (ToLeft <= ToAbove && ToLeft <= ToCorner) return Left;
    return ToAbove <= ToCorner ? Above : Corner;
};

const Predict = (Method, Row, Previous, Stride, Scratch) =>
{
    let Score = 0;
    for (let Index = 0; Index < Stride; Index += 1)
    {
        const Left = Index >= 4 ? Row[Index - 4] : 0;
        const Above = Previous ? Previous[Index] : 0;
        const Corner = Previous && Index >= 4 ? Previous[Index - 4] : 0;
        let Difference = Row[Index];
        if (Method === 1) Difference -= Left;
        else if (Method === 2) Difference -= Above;
        else if (Method === 4) Difference -= PaethGuess(Left, Above, Corner);
        Difference &= 0xff;
        Scratch[Index] = Difference;
        Score += Difference < 128 ? Difference : 256 - Difference;
    }
    return Score;
};

const FilterRows = (Pixels, Width, Height) =>
{
    const Stride = Width * 4;
    const Raw = new Uint8Array((Stride + 1) * Height);
    const Scratch = new Uint8Array(Stride);
    const Best = new Uint8Array(Stride);
    let Previous = null;
    for (let Row = 0; Row < Height; Row += 1)
    {
        const Line = Pixels.subarray(Row * Stride, Row * Stride + Stride);
        // 🔴 Most rows of a painted sheet are untouched, and an untouched row is already the answer: filter zero over
        //    zero bytes, which the surrounding array holds anyway. Searching four predictors for it costs more than
        //    every other row put together on a sheet with one stroke on it.
        let Empty = true;
        for (let Index = 0; Index < Stride; Index += 1) if (Line[Index] !== 0)
        {
            Empty = false;
            break;
        }
        if (Empty)
        {
            Previous = Line;
            continue;
        }
        let Chosen = 0;
        let Lowest = Infinity;
        for (const Method of [0, 1, 2, 4])
        {
            const Score = Predict(Method, Line, Previous, Stride, Scratch);
            if (Score < Lowest)
            {
                Lowest = Score;
                Chosen = Method;
                Best.set(Scratch);
            }
        }
        Raw[Row * (Stride + 1)] = Chosen;
        Raw.set(Best, Row * (Stride + 1) + 1);
        Previous = Line;
    }
    return Raw;
};

const UnfilterRows = (Raw, Width, Height) =>
{
    const Stride = Width * 4;
    const Pixels = new Uint8Array(Stride * Height);
    for (let Row = 0; Row < Height; Row += 1)
    {
        const Method = Raw[Row * (Stride + 1)];
        const From = Row * (Stride + 1) + 1;
        const Into = Row * Stride;
        const Over = Into - Stride;
        for (let Index = 0; Index < Stride; Index += 1)
        {
            const Left = Index >= 4 ? Pixels[Into + Index - 4] : 0;
            const Above = Row > 0 ? Pixels[Over + Index] : 0;
            const Corner = Row > 0 && Index >= 4 ? Pixels[Over + Index - 4] : 0;
            let Value = Raw[From + Index];
            if (Method === 1) Value += Left;
            else if (Method === 2) Value += Above;
            else if (Method === 3) Value += (Left + Above) >> 1;
            else if (Method === 4) Value += PaethGuess(Left, Above, Corner);
            Pixels[Into + Index] = Value & 0xff;
        }
    }
    return Pixels;
};

//--------------------------------------------------------------------------------------------------------------------------
// One square RGBA8 sheet in and out of a PNG. Colour type 6, bit depth 8, no interlace — the only shape this editor
// writes, and the only one it will read back without complaint.
//--------------------------------------------------------------------------------------------------------------------------
export const EncodePng = async (Pixels, Width, Height) =>
{
    const Header = new Uint8Array(13);
    const View = new DataView(Header.buffer);
    View.setUint32(0, Width);
    View.setUint32(4, Height);
    Header[8] = 8;                                            // [-]   bits per channel
    Header[9] = 6;                                            // [-]   colour type: truecolour with alpha
    const Pixelled = await Deflate(FilterRows(Pixels, Width, Height));
    const Parts = [Signature, Chunk("IHDR", Header), Chunk("IDAT", Pixelled), Chunk("IEND", new Uint8Array(0))];
    const Written = new Uint8Array(Parts.reduce((Total, Part) => Total + Part.length, 0));
    let Cursor = 0;
    for (const Part of Parts)
    {
        Written.set(Part, Cursor);
        Cursor += Part.length;
    }
    return Written;
};

export const DecodePng = async (Bytes) =>
{
    for (let Index = 0; Index < Signature.length; Index += 1)
        if (Bytes[Index] !== Signature[Index]) throw new Error("not a PNG");
    const View = new DataView(Bytes.buffer, Bytes.byteOffset, Bytes.byteLength);
    let Cursor = 8;
    let Width = 0;
    let Height = 0;
    const Pieces = [];
    while (Cursor + 8 <= Bytes.length)
    {
        const Length = View.getUint32(Cursor);
        const Name = String.fromCharCode(Bytes[Cursor + 4], Bytes[Cursor + 5], Bytes[Cursor + 6], Bytes[Cursor + 7]);
        const From = Cursor + 8;
        if (Name === "IHDR")
        {
            Width = View.getUint32(From);
            Height = View.getUint32(From + 4);
            if (Bytes[From + 8] !== 8 || Bytes[From + 9] !== 6 || Bytes[From + 12] !== 0)
                throw new Error("only 8-bit RGBA PNGs without interlacing are read back");
        }
        else if (Name === "IDAT") Pieces.push(Bytes.subarray(From, From + Length));
        else if (Name === "IEND") break;
        Cursor = From + Length + 4;
    }
    if (!Width || !Height) throw new Error("the PNG carried no header");
    const Squeezed = new Uint8Array(Pieces.reduce((Total, Piece) => Total + Piece.length, 0));
    let Written = 0;
    for (const Piece of Pieces)
    {
        Squeezed.set(Piece, Written);
        Written += Piece.length;
    }
    const Raw = await Inflate(Squeezed);
    if (Raw.length < (Width * 4 + 1) * Height) throw new Error("the PNG was truncated");
    return { Pixels: UnfilterRows(Raw, Width, Height), Width, Height };
};

//--------------------------------------------------------------------------------------------------------------------------
// Bytes ⇄ text. JSON holds strings, so the PNG travels base64; the chunking is there because spreading a megabyte into
// String.fromCharCode overflows the call stack long before it overflows anything else.
//--------------------------------------------------------------------------------------------------------------------------
export const TextFromBytes = (Bytes) =>
{
    let Text = "";
    for (let Cursor = 0; Cursor < Bytes.length; Cursor += 0x8000)
        Text += String.fromCharCode.apply(null, Bytes.subarray(Cursor, Math.min(Cursor + 0x8000, Bytes.length)));
    return btoa(Text);
};

export const BytesFromText = (Text) =>
{
    const Binary = atob(String(Text).replace(/^data:[^,]*,/, ""));
    const Bytes = new Uint8Array(Binary.length);
    for (let Index = 0; Index < Binary.length; Index += 1) Bytes[Index] = Binary.charCodeAt(Index);
    return Bytes;
};

//--------------------------------------------------------------------------------------------------------------------------
// A sheet read off the GPU is bottom-up, because that is where readPixels starts. It is flipped on the way into the
// file and flipped back on the way out, so what a document holds is an image the right way up for anything that opens it.
//--------------------------------------------------------------------------------------------------------------------------
export const EncodeSheet = async (Snapshot) =>
{
    const Size = Snapshot.Resolution;
    const Upright = FlipRows(Snapshot.Pixels, Size, Size);
    return TextFromBytes(await EncodePng(new Uint8Array(Upright.buffer, Upright.byteOffset, Upright.length), Size, Size));
};

export const DecodeSheet = async (Text) =>
{
    const Read = await DecodePng(BytesFromText(Text));
    const Flipped = FlipRows(Read.Pixels, Read.Width, Read.Height);
    return { Pixels: new Uint8Array(Flipped.buffer, Flipped.byteOffset, Flipped.length), Resolution: Read.Width };
};

//--------------------------------------------------------------------------------------------------------------------------
// A sheet whose coverage is nothing at all is not worth a chunk of the file: an untouched layer, or a mask the stack
// allocated and nobody painted into.
//--------------------------------------------------------------------------------------------------------------------------
export const BlankSheet = (Pixels) =>
{
    for (let Index = 3; Index < Pixels.length; Index += 4) if (Pixels[Index] !== 0) return false;
    return true;
};

// Bilinear, and deliberately the same filter the integrator blits with, so a sheet landing on a layer that has since
// changed resolution lands the way a resolution change would have left it.
export const ResampleSheet = (Pixels, From, To) =>
{
    if (From === To) return Pixels;
    const Resampled = new Uint8Array(To * To * 4);
    const Ratio = From / To;
    for (let Row = 0; Row < To; Row += 1)
    {
        const Y = Math.min(From - 1, Math.max(0, (Row + 0.5) * Ratio - 0.5));
        const Top = Math.floor(Y);
        const Bottom = Math.min(From - 1, Top + 1);
        const Down = Y - Top;
        for (let Column = 0; Column < To; Column += 1)
        {
            const X = Math.min(From - 1, Math.max(0, (Column + 0.5) * Ratio - 0.5));
            const Left = Math.floor(X);
            const Right = Math.min(From - 1, Left + 1);
            const Across = X - Left;
            const Into = (Row * To + Column) * 4;
            for (let Channel = 0; Channel < 4; Channel += 1)
            {
                const A = Pixels[(Top * From + Left) * 4 + Channel];
                const B = Pixels[(Top * From + Right) * 4 + Channel];
                const C = Pixels[(Bottom * From + Left) * 4 + Channel];
                const D = Pixels[(Bottom * From + Right) * 4 + Channel];
                const Upper = A + (B - A) * Across;
                const Lower = C + (D - C) * Across;
                Resampled[Into + Channel] = Math.round(Upper + (Lower - Upper) * Down);
            }
        }
    }
    return Resampled;
};

//--------------------------------------------------------------------------------------------------------------------------
// The walk the saver and the opener take. Everything the device holds for a layer is offered; what comes back blank or
// was never allocated is passed over, so the file lists exactly the sheets that hold paint.
//--------------------------------------------------------------------------------------------------------------------------
export const SheetTally = (Sheets) =>
{
    const Bytes = (Sheets || []).reduce((Total, Sheet) => Total + (Sheet.Image?.length || 0), 0);
    return { Count: (Sheets || []).length, Bytes, Megabytes: Bytes / (1024 * 1024) };
};

export const CollectSheets = async (Integrator, Layers, Options = {}) =>
{
    const Allowance = Options.Allowance || SheetAllowance;
    const Encode = Options.Encode || EncodeSheet;
    const Report = Options.Report || (() => {});
    const Sheets = [];
    let Bytes = 0;
    let Skipped = 0;
    if (!Integrator || typeof Integrator.SnapshotLayer !== "function") return { Sheets, Bytes, Skipped };
    for (const Layer of Layers || [])
    {
        for (const Target of SheetTargets)
        {
            // `Gather` off: the painted channel images are collected under their own names just below, so there is no
            // point reading them twice.
            const Snapshot = Integrator.SnapshotLayer(Layer, Target, false);
            if (!Snapshot || !Snapshot.Pixels || BlankSheet(Snapshot.Pixels)) continue;
            Report(`Reading ${Layer.Name || Layer.Identifier} · ${Target}`);
            // One turn of the event loop per sheet. Encoding a 2048² sheet is half a second of arithmetic, and a saver
            // that never yields is a saver whose progress line never appears.
            await new Promise((Settle) => setTimeout(Settle, 0));
            const Image = await Encode(Snapshot);
            if (Bytes + Image.length > Allowance)
            {
                Skipped += 1;
                continue;
            }
            Bytes += Image.length;
            Sheets.push({ Layer: Layer.Identifier, Target, Resolution: Snapshot.Resolution, Image });
        }
        // A layer whose strokes all carry the same channel values keeps them as twelve numbers rather than as three
        // images. They are still part of what was painted, so they are written out beside the sheets.
        const Settled = typeof Integrator.SettledValues === "function" ? Integrator.SettledValues(Layer) : null;
        if (Settled) Sheets.push({ Layer: Layer.Identifier, Target: "settled", Values: [...Settled] });
    }
    return { Sheets, Bytes, Skipped };
};

export const ApplySheets = async (Integrator, Layers, Sheets, Options = {}) =>
{
    const Decode = Options.Decode || DecodeSheet;
    let Restored = 0;
    let Refused = 0;
    if (!Integrator || typeof Integrator.RestoreLayer !== "function") return { Restored, Refused };
    for (const Sheet of Sheets || [])
    {
        const Layer = (Layers || []).find((Candidate) => Candidate.Identifier === Sheet?.Layer);
        if (!Layer) continue;
        if (Sheet.Target === "settled")
        {
            if (Array.isArray(Sheet.Values) && Sheet.Values.length === 12 && typeof Integrator.RestoreSettled === "function")
            {
                Integrator.RestoreSettled(Layer, Sheet.Values);
                Restored += 1;
            }
            continue;
        }
        if (!Sheet.Image || !SheetTargets.includes(Sheet.Target)) continue;
        try
        {
            const Read = await Decode(Sheet.Image);
            const Size = typeof Integrator.LayerResolution === "function" ? Integrator.LayerResolution(Layer) : Read.Resolution;
            const Pixels = ResampleSheet(Read.Pixels, Read.Resolution, Size);
            Integrator.RestoreLayer(Layer, Sheet.Target, { Pixels, Resolution: Size });
            Restored += 1;
        }
        catch (Refusal)
        {
            Refused += 1;
        }
    }
    return { Restored, Refused };
};

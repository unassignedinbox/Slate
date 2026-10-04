//============================================================================================================================================
// 🕰 TimelineSequence.js — the narrated edit timeline: typed events, a moving head, and branches that fork a document
//============================================================================================================================================
// The revision queue remembers pixels; this remembers the story. Every meaningful edit becomes a typed event with a
// colour, a badge and a short hash, and the whole sequence lives on a branch. Stepping back and then editing forks a new
// branch rather than discarding the future, so a document can carry several versions of itself at once.
//============================================================================================================================================

export const EventKinds = [
    { Identifier: "document", Label: "Document", Badge: "DOC", Accent: "#8e8e93" },
    { Identifier: "stroke", Label: "Stroke", Badge: "PAINT", Accent: "#34c759" },
    { Identifier: "structure", Label: "Structure", Badge: "STRUCTURE", Accent: "#5ac8fa" },
    { Identifier: "material", Label: "Material", Badge: "EDIT", Accent: "#ff9f0a" },
    { Identifier: "decal", Label: "Decal", Badge: "DECAL", Accent: "#c98cff" },
    { Identifier: "generator", Label: "Generator", Badge: "GEN", Accent: "#ffd60a" },
    { Identifier: "surface", Label: "Surface", Badge: "UV", Accent: "#64d2ff" },
    { Identifier: "export", Label: "Export", Badge: "OUT", Accent: "#f0f0f0" },
];

export const EventByKind = Object.fromEntries(EventKinds.map((Kind) => [Kind.Identifier, Kind]));

export const EventLimit = 400;
export const BranchLimit = 8;

const Pad = (Value) => String(Value).padStart(2, "0");

export const EventClock = (Stamp) =>
{
    const Moment = new Date(Stamp);
    return `${Pad(Moment.getHours())}:${Pad(Moment.getMinutes())}:${Pad(Moment.getSeconds())}`;
};

// A short, stable-looking hash per event. It is decoration, not identity, so a cheap mix is honest enough.
export const ShortHash = (Seed) =>
{
    let Value = 0x811c9dc5;
    const Text = String(Seed);
    for (let Index = 0; Index < Text.length; Index += 1)
    {
        Value ^= Text.charCodeAt(Index);
        Value = Math.imul(Value, 0x01000193) >>> 0;
    }
    return Value.toString(16).padStart(8, "0").slice(0, 7);
};

// What an event looked like in texture space, kept as numbers rather than pixels: a few coordinates cost nothing to
// store and let the timeline draw the stamp where it landed, at whatever size the panel feels like drawing it.
export const PreviewLimit = 40;

const Pair = (Value, Fallback = 0) => (Number.isFinite(Value) ? Math.max(-4, Math.min(5, Value)) : Fallback);

export const SanitisePreview = (Candidate) =>
{
    if (!Candidate || typeof Candidate !== "object") return null;
    const Shape = ["stamp", "path", "flood", "tile", "swatch"].includes(Candidate.Shape) ? Candidate.Shape : "swatch";
    const Preview = { Shape };
    if (Array.isArray(Candidate.Coordinate)) Preview.Coordinate = [Pair(Candidate.Coordinate[0], 0.5), Pair(Candidate.Coordinate[1], 0.5)];
    if (Array.isArray(Candidate.Size)) Preview.Size = [Pair(Candidate.Size[0], 0.2), Pair(Candidate.Size[1], 0.2)];
    if (Number.isFinite(Candidate.Rotation)) Preview.Rotation = ((Candidate.Rotation % 360) + 360) % 360;
    if (Number.isFinite(Candidate.Tile)) Preview.Tile = Math.round(Candidate.Tile);
    if (Number.isFinite(Candidate.Span)) Preview.Span = Math.max(1, Math.min(10, Math.round(Candidate.Span)));
    if (typeof Candidate.Glyph === "string") Preview.Glyph = Candidate.Glyph.slice(0, 24);
    if (Array.isArray(Candidate.Points))
        Preview.Points = Candidate.Points.slice(0, PreviewLimit)
            .filter((Point) => Array.isArray(Point))
            .map((Point) => [Pair(Point[0], 0.5), Pair(Point[1], 0.5)]);
    return Preview;
};

let EventCounter = 0;

export const ResetEventCounter = () => (EventCounter = 0);

export const CreateEvent = (Record = {}) =>
{
    EventCounter += 1;
    const Kind = EventByKind[Record.Kind] ? Record.Kind : "structure";
    const Stamp = Number.isFinite(Record.Stamp) ? Record.Stamp : Date.now();
    return {
        Identifier: `event-${EventCounter.toString(36)}`,
        Kind,
        Title: String(Record.Title || EventByKind[Kind].Label).slice(0, 96),
        Detail: String(Record.Detail || "").slice(0, 120),
        Colour: Array.isArray(Record.Colour) ? Record.Colour.slice(0, 3) : null,
        Preview: SanitisePreview(Record.Preview),
        Stamp,
        Hash: Record.Hash || ShortHash(`${Kind}:${Record.Title}:${Stamp}:${EventCounter}`),
    };
};

const BranchNames = ["Main", "Branch", "Variant", "Study", "Take", "Trial", "Draft", "Spur"];

export class TimelineSequence
{
    constructor()
    {
        this.Branches = [{ Identifier: "branch-1", Name: "Main", Parent: "", Origin: 0, Events: [] }];
        this.Active = "branch-1";
        this.Head = 0;                                  // how many events of the active branch are in force
        this.NextIdentity = 2;
        this.Listener = null;
    }

    get Branch()
    {
        return this.Branches.find((Entry) => Entry.Identifier === this.Active) || this.Branches[0];
    }

    get Events()
    {
        return this.Branch.Events;
    }

    get Depth()
    {
        return this.Events.length;
    }

    get CanStepBack()
    {
        return this.Head > 0;
    }

    get CanStepForward()
    {
        return this.Head < this.Events.length;
    }

    Announce()
    {
        this.Listener?.(this);
    }

    // Recording while the head sits behind the tip forks the branch: the future is kept, not thrown away.
    Record(Record)
    {
        const Event = CreateEvent(Record);
        if (this.Head < this.Events.length && this.Branches.length < BranchLimit) this.Fork();
        else if (this.Head < this.Events.length) this.Events.length = this.Head;
        this.Events.push(Event);
        if (this.Events.length > EventLimit) this.Events.splice(0, this.Events.length - EventLimit);
        this.Head = this.Events.length;
        this.Announce();
        return Event;
    }

    // A fork copies everything up to the head onto a new branch and continues there.
    Fork(Name = "")
    {
        if (this.Branches.length >= BranchLimit) return this.Branch;
        const Parent = this.Branch;
        const Identity = this.NextIdentity;
        this.NextIdentity += 1;
        const Branch = {
            Identifier: `branch-${Identity}`,
            Name: Name || `${BranchNames[(Identity - 1) % BranchNames.length]} ${Identity}`,
            Parent: Parent.Identifier,
            Origin: this.Head,
            Events: Parent.Events.slice(0, this.Head).map((Event) => ({ ...Event })),
        };
        this.Branches.push(Branch);
        this.Active = Branch.Identifier;
        this.Head = Branch.Events.length;
        this.Announce();
        return Branch;
    }

    Switch(Identifier)
    {
        if (!this.Branches.some((Entry) => Entry.Identifier === Identifier)) return false;
        this.Active = Identifier;
        this.Head = this.Events.length;
        this.Announce();
        return true;
    }

    Rename(Identifier, Name)
    {
        const Branch = this.Branches.find((Entry) => Entry.Identifier === Identifier);
        if (!Branch) return;
        Branch.Name = String(Name || Branch.Name).slice(0, 32);
        this.Announce();
    }

    Remove(Identifier)
    {
        if (this.Branches.length <= 1) return false;
        const Index = this.Branches.findIndex((Entry) => Entry.Identifier === Identifier);
        if (Index < 0) return false;
        this.Branches.splice(Index, 1);
        if (this.Active === Identifier)
        {
            this.Active = this.Branches[Math.max(Index - 1, 0)].Identifier;
            this.Head = this.Events.length;
        }
        this.Announce();
        return true;
    }

    StepBack()
    {
        if (!this.CanStepBack) return false;
        this.Head -= 1;
        this.Announce();
        return true;
    }

    StepForward()
    {
        if (!this.CanStepForward) return false;
        this.Head += 1;
        this.Announce();
        return true;
    }

    // Jumping lands the head just after the event that was clicked.
    Visit(Identifier)
    {
        const Index = this.Events.findIndex((Event) => Event.Identifier === Identifier);
        if (Index < 0) return -1;
        this.Head = Index + 1;
        this.Announce();
        return this.Head;
    }

    Clear(Seed = null)
    {
        this.Branches = [{ Identifier: "branch-1", Name: "Main", Parent: "", Origin: 0, Events: [] }];
        this.Active = "branch-1";
        this.NextIdentity = 2;
        this.Head = 0;
        if (Seed) this.Record(Seed);
        else this.Announce();
    }

    Serialise()
    {
        return {
            Active: this.Active,
            Head: this.Head,
            NextIdentity: this.NextIdentity,
            Branches: this.Branches.map((Branch) => ({ ...Branch, Events: Branch.Events.map((Event) => ({ ...Event })) })),
        };
    }

    Restitute(Record)
    {
        if (!Record || !Array.isArray(Record.Branches) || !Record.Branches.length) return false;
        this.Branches = Record.Branches.slice(0, BranchLimit).map((Branch, Index) => ({
            Identifier: String(Branch.Identifier || `branch-${Index + 1}`),
            Name: String(Branch.Name || `Branch ${Index + 1}`).slice(0, 32),
            Parent: String(Branch.Parent || ""),
            Origin: Number(Branch.Origin) || 0,
            Events: (Array.isArray(Branch.Events) ? Branch.Events : []).slice(0, EventLimit).map((Event) => CreateEvent(Event)),
        }));
        this.Active = this.Branches.some((Branch) => Branch.Identifier === Record.Active) ? Record.Active : this.Branches[0].Identifier;
        this.NextIdentity = Math.max(Number(Record.NextIdentity) || this.Branches.length + 1, this.Branches.length + 1);
        this.Head = Math.min(Math.max(Number(Record.Head) || this.Events.length, 0), this.Events.length);
        this.Announce();
        return true;
    }
}

//============================================================================================================================================
// ↩ RevisionQueue.js — bounded undo / redo over stack edits and painted images
//============================================================================================================================================
// Two entry kinds share one queue so that Ctrl Z walks the real editing order:
//   · stack  — a structural edit, holding the project record before and after (cheap, JSON-sized).
//   · image  — a painted edit, holding two RGBA readbacks of one layer image (4 MB each at 1024²).
// Image entries are what bound the queue: the byte budget evicts the oldest entries long before the depth cap bites.
//============================================================================================================================================

const MaximumBytes = 192 * 1024 * 1024;
const MaximumDepth = 96;

export class RevisionQueue
{
    constructor()
    {
        this.Entries = [];
        this.Cursor = 0;
        this.Bytes = 0;
    }

    get CanUndo()
    {
        return this.Cursor > 0;
    }

    get CanRedo()
    {
        return this.Cursor < this.Entries.length;
    }

    get Depth()
    {
        return this.Entries.length;
    }

    get Megabytes()
    {
        return this.Bytes / (1024 * 1024);
    }

    static Measure(Entry)
    {
        if (Entry.Kind !== "image") return 512;
        return (Entry.Before?.Pixels?.byteLength || 0) + (Entry.After?.Pixels?.byteLength || 0);
    }

    Record(Entry)
    {
        if (!Entry) return;
        // A new edit discards anything ahead of the cursor.
        for (const Discarded of this.Entries.slice(this.Cursor)) this.Bytes -= RevisionQueue.Measure(Discarded);
        this.Entries.length = this.Cursor;
        this.Entries.push(Entry);
        this.Bytes += RevisionQueue.Measure(Entry);
        this.Cursor = this.Entries.length;
        this.Evict();
    }

    Evict()
    {
        while ((this.Bytes > MaximumBytes || this.Entries.length > MaximumDepth) && this.Entries.length > 1)
        {
            const Oldest = this.Entries.shift();
            this.Bytes -= RevisionQueue.Measure(Oldest);
            this.Cursor = Math.max(0, this.Cursor - 1);
        }
    }

    Undo()
    {
        if (!this.CanUndo) return null;
        this.Cursor -= 1;
        return this.Entries[this.Cursor];
    }

    Redo()
    {
        if (!this.CanRedo) return null;
        const Entry = this.Entries[this.Cursor];
        this.Cursor += 1;
        return Entry;
    }

    Clear()
    {
        this.Entries = [];
        this.Cursor = 0;
        this.Bytes = 0;
    }
}

//============================================================================================================================================
// 🗂 DocumentSequence.js — document tabs: capture, restore, rename and close, with up to four live surfaces per session
//============================================================================================================================================
// A document owns a project record and a camera pose. Painted images stay resident in the integrator, keyed by layer
// identifier, so switching tabs is a model swap and a recomposite — no texture is reuploaded and no stroke is lost.
//============================================================================================================================================

const Select = (Selector) => document.querySelector(Selector);
const Escape = (Text) =>
    String(Text).replace(
        /[&<>"']/g,
        (Character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[Character],
    );

export const MaximumDocuments = 4;

export class DocumentSequence
{
    constructor(Panel, Icon)
    {
        this.Panel = Panel;
        this.Icon = Icon;
        this.NextIdentity = 2;
        this.ActiveIdentity = 1;
        // 📝 The tab IS the document's name — there is no second field anywhere in the window holding a copy of it,
        //    so the project record is the one place it lives and the strip simply draws what the record says.
        this.Slots = [{ Identity: 1, Name: Panel.Project?.Name || "Untitled", Record: null }];
        this.Construct();

        Select("#new-document").addEventListener("click", () => this.Open());
        const Tabs = Select("#document-tabs");
        Tabs.addEventListener("click", (Event) =>
        {
            const Close = Event.target.closest("[data-close-document]");
            if (Close)
            {
                this.Close(Number(Close.dataset.closeDocument));
                return;
            }
            if (Event.target.matches("input")) return;
            const Tab = Event.target.closest("[data-document]");
            if (Tab) this.Activate(Number(Tab.dataset.document));
        });
        Tabs.addEventListener("dblclick", (Event) =>
        {
            if (Event.target.closest("[data-close-document]")) return;
            const Tab = Event.target.closest("[data-document]");
            if (!Tab || Number(Tab.dataset.document) !== this.ActiveIdentity) return;
            const Field = Tab.querySelector("input");
            Field.hidden = false;
            Tab.querySelector(".document-label").hidden = true;
            Field.value = this.Active.Name;
            Field.focus();
            Field.select();
        });
        Tabs.addEventListener("focusout", (Event) =>
        {
            if (Event.target.matches(".document-rename") && !Event.target.hidden) this.Rename(Event.target);
        });
        Tabs.addEventListener("keydown", (Event) =>
        {
            if (Event.target.matches("input"))
            {
                if (Event.key === "Enter")
                {
                    Event.preventDefault();
                    this.Rename(Event.target);
                }
                if (Event.key === "Escape")
                {
                    Event.preventDefault();
                    Event.target.hidden = true;
                    Event.target.parentElement.querySelector(".document-label").hidden = false;
                    Event.target.parentElement.focus();
                }
                Event.stopPropagation();
                return;
            }
            const Tab = Event.target.closest("[data-document]");
            if (Tab && (Event.key === "Enter" || Event.key === " "))
            {
                Event.preventDefault();
                Event.stopPropagation();
                this.Activate(Number(Tab.dataset.document));
            }
        });
    }

    get Active()
    {
        return this.Slots.find((Slot) => Slot.Identity === this.ActiveIdentity);
    }

    Capture()
    {
        const Slot = this.Active;
        if (!Slot) return null;
        Slot.Name = String(this.Panel.Project?.Name || "").trim() || "Untitled";
        Slot.Record = this.Panel.CaptureDocument();
        return Slot;
    }

    Open()
    {
        if (this.Slots.length >= MaximumDocuments)
        {
            this.Panel.Notify(`Up to ${MaximumDocuments} documents stay resident in one session.`);
            return;
        }
        this.Capture();
        const Identity = this.NextIdentity;
        this.NextIdentity += 1;
        this.Slots.push({ Identity, Name: `Surface ${Identity}`, Record: null });
        this.ActiveIdentity = Identity;
        this.Construct();
        this.Panel.RestoreDocument(null, `Surface ${Identity}`);
    }

    Activate(Identity)
    {
        if (Identity === this.ActiveIdentity) return;
        const Target = this.Slots.find((Slot) => Slot.Identity === Identity);
        if (!Target) return;
        this.Capture();
        this.ActiveIdentity = Identity;
        this.Construct();
        this.Panel.RestoreDocument(Target.Record, Target.Name);
    }

    Close(Identity)
    {
        if (this.Slots.length === 1) return;
        const Index = this.Slots.findIndex((Slot) => Slot.Identity === Identity);
        if (Index < 0) return;
        const [Removed] = this.Slots.splice(Index, 1);
        this.Panel.DiscardDocument(Removed.Record);
        if (Identity === this.ActiveIdentity)
        {
            const Next = this.Slots[Math.max(0, Index - 1)];
            this.ActiveIdentity = Next.Identity;
            this.Construct();
            this.Panel.RestoreDocument(Next.Record, Next.Name);
            return;
        }
        this.Construct();
    }

    Rename(Field)
    {
        const Name = Field.value.trim().slice(0, 48) || "Untitled";
        this.Active.Name = Name;
        if (Number(Field.closest("[data-document]").dataset.document) === this.ActiveIdentity) this.Panel.Project.Name = Name;
        this.Construct();
        this.Panel.MarkDirty();
    }

    Synchronise(Name)
    {
        if (!this.Active) return;
        this.Active.Name = Name;
        this.Construct();
    }

    Construct()
    {
        Select("#document-tabs").innerHTML = this.Slots.map(
            (Slot) => `
            <div class="document-tab ${Slot.Identity === this.ActiveIdentity ? "active" : ""}"
                 data-document="${Slot.Identity}" role="tab" tabindex="0"
                 aria-selected="${Slot.Identity === this.ActiveIdentity}">
                ${this.Icon("layers")}
                <span class="document-label">${Escape(Slot.Name)}</span>
                <input class="document-rename" hidden maxlength="48" aria-label="Rename document" />
                ${
                    Slot.Identity === this.ActiveIdentity
                        ? `<span id="dirty-indicator" class="dirty-indicator ${this.Panel.Dirty ? "" : "clean"}" title="Unsaved work"></span>`
                        : ""
                }
                ${
                    this.Slots.length > 1
                        ? `<button class="icon-button" data-close-document="${Slot.Identity}" aria-label="Close ${Escape(Slot.Name)}">${this.Icon("close")}</button>`
                        : ""
                }
            </div>`,
        ).join("");
    }
}

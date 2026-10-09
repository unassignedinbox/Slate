// RevisionSequence: undo and redo for project snapshots. Rapid edits that share a coalescing key (for example dragging one
// slider) are merged into a single revision, so one undo reverts the whole drag.

const DefaultLimit = 80;

export function CreateRevisionSequence(limit = DefaultLimit) {
    let past = [];
    let future = [];
    let lastKey = null;
    let lastTime = 0;
    const windowMs = 700;

    return {
        // Records the state as it was before a change. Call before applying the change.
        record(snapshot, key = null, now = Date.now()) {
            const coalesce = key !== null && key === lastKey && now - lastTime < windowMs;
            if (!coalesce) {
                past.push(snapshot);
                if (past.length > limit) past.shift();
            }
            future = [];
            lastKey = key;
            lastTime = now;
        },
        // Returns the snapshot to restore, pushing the current state onto the redo stack.
        undo(current) {
            if (past.length === 0) return null;
            const previous = past.pop();
            future.push(current);
            lastKey = null;
            return previous;
        },
        redo(current) {
            if (future.length === 0) return null;
            const next = future.pop();
            past.push(current);
            lastKey = null;
            return next;
        },
        get canUndo() {
            return past.length > 0;
        },
        get canRedo() {
            return future.length > 0;
        },
        clear() {
            past = [];
            future = [];
            lastKey = null;
        },
    };
}

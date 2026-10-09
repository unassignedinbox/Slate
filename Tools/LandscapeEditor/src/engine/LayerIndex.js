//============================================================================================================================================
//                                                               LAYERINDEX.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/LayerIndex.js — Content-addressed index of evaluated height prefixes so that unchanged layers
//    are reused between edits.

//------------------------------------------------------------------------------------------------------------------------
//                                                      KEY HASHING
//------------------------------------------------------------------------------------------------------------------------
export function hashText(text)
{
    let hash = 0x811c9dc5;
    for (let k = 0; k < text.length; k++)
    {
        hash ^= text.charCodeAt(k);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0') + text.length.toString(36);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         INDEX
//------------------------------------------------------------------------------------------------------------------------
// Least-recently-used index with a fixed capacity. Entries are immutable snapshots shared between evaluations.
export function createLayerIndex(capacity = 18)
{
    const keys = [];
    const entries = [];
    return {
        get(key)
        {
            const at = keys.indexOf(key);
            if (at < 0)
            {
                return null;
            }
            const entry = entries[at];
            keys.splice(at, 1);
            entries.splice(at, 1);
            keys.push(key);
            entries.push(entry);
            return entry;
        },
        set(key, entry)
        {
            const at = keys.indexOf(key);
            if (at >= 0)
            {
                keys.splice(at, 1);
                entries.splice(at, 1);
            }
            keys.push(key);
            entries.push(entry);
            while (keys.length > capacity)
            {
                keys.shift();
                entries.shift();
            }
        },
        size()
        {
            return keys.length;
        },
        clear()
        {
            keys.length = 0;
            entries.length = 0;
        }
    };
}

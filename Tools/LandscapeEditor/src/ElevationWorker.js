// ElevationWorker: runs the layer stack and the satmap classifier off the main thread. It keeps the stage cache between
// requests, so slider edits only recompute the layers above the one that changed. Only the newest request matters, so
// the host sends each request with an id and ignores stale replies.

import { ResolveStack, CreateStackCache } from "./LayerSequence.js";
import { ClassifySurface } from "./SurfaceClassifier.js";

const cache = CreateStackCache();

self.onmessage = (event) => {
    const { id, configuration, layers, satmap, previewLayerId } = event.data;
    try {
        const result = ResolveStack(configuration, layers, { previewLayerId: previewLayerId || null }, cache);
        const cell = configuration.extent / configuration.resolution;
        const rgba = ClassifySurface(result, configuration.resolution, cell, configuration.sea, satmap || "natural", 1);
        // Copy anything that might be shared with the cache before transferring its buffer.
        const height = Float32Array.from(result.height);
        const preview = result.preview ? Float32Array.from(result.preview) : null;
        const transfer = [height.buffer, rgba.buffer];
        if (preview) transfer.push(preview.buffer);
        self.postMessage(
            {
                id,
                ok: true,
                height,
                rgba,
                preview,
                previewLabel: result.previewLabel,
                stats: result.stats,
                reusedEntries: result.reusedEntries,
                elapsedMs: result.elapsedMs,
            },
            transfer,
        );
    } catch (error) {
        self.postMessage({ id, ok: false, message: error && error.message ? error.message : String(error) });
    }
};

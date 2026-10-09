// Tiny pub/sub bus. In production this boundary is the C++ <-> HMI transport
// (shared memory / IPC / WebSocket); the HMI only ever sees plain telemetry frames.
const listeners = new Map();

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  emit(evt, data) {
    listeners.get(evt)?.forEach((fn) => fn(data));
  },
};

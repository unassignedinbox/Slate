// React bridge to the terrain worker. Requests are coalesced: while a pass is
// running the newest project state is kept, and only that one is sent when the
// worker comes back — dragging a slider never queues up work.

import { useEffect, useRef, useState } from 'react';
import type { ChannelId, Project } from './types';
import type { ComputeRequest, ComputeResponse } from './worker';

export interface EngineState {
  result: ComputeResponse | null;
  busy: boolean;
  error: string | null;
}

export function useEngine(
  project: Project,
  previewChannel: ChannelId | null,
  maskPreviewId: string | null,
): EngineState {
  const [state, setState] = useState<EngineState>({ result: null, busy: true, error: null });
  const workerRef = useRef<Worker | null>(null);
  const running = useRef(false);
  const queued = useRef<ComputeRequest | null>(null);
  const idRef = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ComputeResponse & { error?: string }>) => {
      running.current = false;
      if (event.data.error) {
        setState((s) => ({ ...s, busy: false, error: event.data.error ?? 'Compute failed' }));
      } else {
        setState({ result: event.data, busy: false, error: null });
      }
      const next = queued.current;
      queued.current = null;
      if (next) send(next);
    };
    worker.onerror = (event) => {
      running.current = false;
      setState((s) => ({ ...s, busy: false, error: event.message || 'Worker crashed' }));
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (request: ComputeRequest) => {
    if (!workerRef.current) return;
    running.current = true;
    setState((s) => ({ ...s, busy: true }));
    workerRef.current.postMessage(request);
  };

  useEffect(() => {
    const request: ComputeRequest = {
      id: ++idRef.current,
      project,
      previewChannel,
      maskPreviewId,
    };
    if (timer.current !== null) window.clearTimeout(timer.current);
    // Short debounce: keyboard/slider drags collapse into one compute.
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (running.current) queued.current = request;
      else send(request);
    }, 90);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, previewChannel, maskPreviewId]);

  return state;
}

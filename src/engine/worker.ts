// Terrain worker: keeps the multi-hundred-millisecond pipeline off the UI thread.
// (Typed without the WebWorker lib so it can share one tsconfig with the DOM app.)

import { computeProject } from './pipeline';
import type { ChannelId, Project } from './types';

export interface ComputeRequest {
  id: number;
  project: Project;
  previewChannel?: ChannelId | null;
  maskPreviewId?: string | null;
}

export interface ComputeResponse {
  id: number;
  size: number;
  height: Float32Array;
  rgba: Uint8ClampedArray;
  thumbs: { id: string; role: string; size: number; data: Float32Array | Uint8ClampedArray; range: [number, number]; mask: Float32Array | null }[];
  preview: { channel: ChannelId; size: number; data: Float32Array } | null;
  maskPreview: { id: string; size: number; data: Float32Array } | null;
  stats: {
    minHeight: number;
    maxHeight: number;
    meanHeight: number;
    moved: number;
    cut: number;
    fill: number;
    seaCoverage: number;
    timeMs: number;
    cellSize: number;
    triangles: number;
  };
}

declare const self: {
  onmessage: ((event: MessageEvent<ComputeRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

self.onmessage = (event: MessageEvent<ComputeRequest>) => {
  const { id, project, previewChannel, maskPreviewId } = event.data;
  try {
    const result = computeProject(project, {
      previewChannel: previewChannel ?? null,
      maskPreviewId: maskPreviewId ?? null,
      thumbSize: 76,
    });
    const transfer: ArrayBuffer[] = [result.height.buffer as ArrayBuffer, result.rgba.buffer as ArrayBuffer];
    for (const thumb of result.thumbs) {
      transfer.push(thumb.data.buffer as ArrayBuffer);
      if (thumb.mask) transfer.push(thumb.mask.buffer as ArrayBuffer);
    }
    if (result.preview) transfer.push(result.preview.data.buffer as ArrayBuffer);
    if (result.maskPreview) transfer.push(result.maskPreview.data.buffer as ArrayBuffer);
    const response: ComputeResponse = {
      id,
      size: result.size,
      height: result.height,
      rgba: result.rgba,
      thumbs: result.thumbs,
      preview: result.preview,
      maskPreview: result.maskPreview,
      stats: result.stats,
    };
    self.postMessage(response, transfer);
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};

import type {
  MuxCustomData,
  MuxMaxResolution,
  MuxMinResolution,
  MuxVideoSource,
  NormalizedMuxVideoSource,
} from './types';

const MIN_RESOLUTION_ORDER: MuxMinResolution[] = ['480p', '540p', '720p', '1080p', '1440p', '2160p'];
const MAX_RESOLUTION_ORDER: MuxMaxResolution[] = ['720p', '1080p', '1440p', '2160p'];
const CUSTOM_DATA_KEYS = Array.from({ length: 10 }, (_, index) => `customData${index + 1}`);

export function normalizeMuxVideoSource(source: MuxVideoSource): NormalizedMuxVideoSource {
  const input = typeof source === 'string' ? { playbackId: source } : source;
  const playbackId = input.playbackId?.trim();

  if (!playbackId) {
    throw new Error('Mux video source requires a non-empty playbackId.');
  }

  if (input.drmToken && !input.playbackToken) {
    throw new Error('Mux DRM playback requires both drmToken and playbackToken.');
  }

  validateResolutionWindow(input.minResolution, input.maxResolution);
  validateClipping(input.clipping?.assetStartTime, input.clipping?.assetEndTime);

  return {
    ...input,
    playbackId,
    renditionOrder: input.renditionOrder ?? 'default',
    metadata: input.metadata
      ? {
          ...input.metadata,
          customData: normalizeCustomData(input.metadata.customData),
        }
      : undefined,
  };
}

function validateResolutionWindow(minResolution?: MuxMinResolution, maxResolution?: MuxMaxResolution) {
  if (!minResolution || !maxResolution) {
    return;
  }

  const minPixels = Number(minResolution.replace('p', ''));
  const maxPixels = Number(maxResolution.replace('p', ''));
  if (minPixels > maxPixels) {
    throw new Error(`Mux video source minResolution (${minResolution}) cannot exceed maxResolution (${maxResolution}).`);
  }
}

function validateClipping(assetStartTime?: number, assetEndTime?: number) {
  if (assetStartTime != null && (!Number.isFinite(assetStartTime) || assetStartTime < 0)) {
    throw new Error('Mux video source clipping.assetStartTime must be a non-negative finite number.');
  }

  if (assetEndTime != null && (!Number.isFinite(assetEndTime) || assetEndTime < 0)) {
    throw new Error('Mux video source clipping.assetEndTime must be a non-negative finite number.');
  }

  if (assetStartTime != null && assetEndTime != null && assetStartTime >= assetEndTime) {
    throw new Error('Mux video source clipping.assetStartTime must be less than clipping.assetEndTime.');
  }
}

function normalizeCustomData(customData?: MuxCustomData): MuxCustomData | undefined {
  if (!customData) {
    return undefined;
  }

  const out: Record<string, string> = {};
  const directKeys = Object.keys(customData).filter(key => CUSTOM_DATA_KEYS.includes(key));

  for (const key of directKeys) {
    const value = customData[key];
    if (typeof value === 'string') {
      out[key] = value;
    }
  }

  const remainingValues = Object.entries(customData)
    .filter(([key, value]) => !CUSTOM_DATA_KEYS.includes(key) && typeof value === 'string')
    .map(([, value]) => value as string);

  for (const key of CUSTOM_DATA_KEYS) {
    if (remainingValues.length === 0) {
      break;
    }
    if (out[key] == null) {
      out[key] = remainingValues.shift() as string;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export const muxResolutionSupport = {
  min: MIN_RESOLUTION_ORDER,
  max: MAX_RESOLUTION_ORDER,
} as const;

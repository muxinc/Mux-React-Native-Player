import type { NormalizedMuxVideoSource } from './types';

const DEFAULT_IMAGE_HOST = 'image.mux.com';

/**
 * Resolve the Mux image host for a source. With no custom domain this is
 * `image.mux.com`. With a custom domain (e.g. `media.example.com`) Mux serves
 * images from the `image.` subdomain of that domain (`image.media.example.com`).
 */
export function muxImageHost(customDomain?: string): string {
  if (!customDomain) {
    return DEFAULT_IMAGE_HOST;
  }
  const trimmed = customDomain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!trimmed) {
    return DEFAULT_IMAGE_HOST;
  }
  return `image.${trimmed}`;
}

export type MuxThumbnailFitMode = 'preserve' | 'stretch' | 'crop' | 'smartcrop' | 'pad';

export type MuxThumbnailOptions = {
  time?: number;
  width?: number;
  height?: number;
  fitMode?: MuxThumbnailFitMode;
  token?: string;
};

type ImageSourceFields = Pick<NormalizedMuxVideoSource, 'playbackId' | 'customDomain'>;

/**
 * Build a Mux thumbnail (poster) URL such as
 * `https://image.mux.com/{playbackId}/thumbnail.jpg?time=10`.
 */
export function buildMuxThumbnailUrl(
  source: ImageSourceFields,
  options: MuxThumbnailOptions = {}
): string {
  const params = new URLSearchParams();
  if (options.time != null && Number.isFinite(options.time)) {
    params.set('time', String(Math.max(0, options.time)));
  }
  if (options.width != null && Number.isFinite(options.width)) {
    params.set('width', String(Math.round(options.width)));
  }
  if (options.height != null && Number.isFinite(options.height)) {
    params.set('height', String(Math.round(options.height)));
  }
  if (options.fitMode) {
    params.set('fit_mode', options.fitMode);
  }
  if (options.token) {
    params.set('token', options.token);
  }
  const query = params.toString();
  return `https://${muxImageHost(source.customDomain)}/${source.playbackId}/thumbnail.jpg${
    query ? `?${query}` : ''
  }`;
}

/**
 * Build the WebVTT storyboard URL for an asset:
 * `https://image.mux.com/{playbackId}/storyboard.vtt`.
 */
export function buildMuxStoryboardVttUrl(source: ImageSourceFields, token?: string): string {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `https://${muxImageHost(source.customDomain)}/${source.playbackId}/storyboard.vtt${query}`;
}

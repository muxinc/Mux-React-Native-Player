import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { normalizeMuxVideoSource } from './normalizeSource';
import type { MuxVideoSource, NormalizedMuxVideoSource } from './types';

/**
 * Data-only media preloading.
 *
 * `preloadMuxVideo` warms a source without rendering a player surface, so a
 * feed can start buffering the likely-next video while the current one plays:
 *
 *  - Android buffers through a headless, paused `MuxPlayer` built with the
 *    same smart cache every `MuxVideoView` player reads, so preloaded bytes
 *    are consumed by the active player instead of being downloaded twice.
 *  - iOS warms a detached `AVPlayerItem` on a paused, muted `AVPlayer` held in
 *    a small pool; when a `MuxVideoView` later receives a source with the same
 *    playback parameters it adopts the warmed item (and its buffer) directly.
 *
 * Preloading is best-effort by design: every function resolves without error
 * when the native module is missing (Expo Go, web) or the source is not
 * preloadable, and playback falls back to a normal cold start.
 *
 * DRM sources are never preloaded. A FairPlay/Widevine license exchange
 * outside an active playback session could consume single-use tokens and
 * would report license errors with no surface to show them on.
 */

export type MuxPreloadOptions = {
  /**
   * Seconds of media to buffer ahead for the preloaded source.
   * Defaults to 5 seconds — enough to cover startup (manifest, init segment,
   * and the first media segments) without competing with active playback.
   */
  bufferAheadSeconds?: number;
};

const DEFAULT_PRELOAD_BUFFER_SECONDS = 5;

type MuxReactNativePlayerModule = {
  preload?: (
    source: NormalizedMuxVideoSource,
    bufferAheadSeconds: number
  ) => Promise<void>;
  cancelPreload?: (playbackId: string) => Promise<void>;
  cancelAllPreloads?: () => Promise<void>;
};

let cached: MuxReactNativePlayerModule | null | undefined;

function loadModule(): MuxReactNativePlayerModule | null {
  // TV caching/preload is intentionally deferred, including Android's smart cache.
  if (Platform.isTV) return null;
  if (cached !== undefined) {
    return cached;
  }
  try {
    cached = requireOptionalNativeModule(
      'MuxReactNativePlayer'
    ) as MuxReactNativePlayerModule | null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * True when the running binary exposes the native preload API. Feeds can use
 * this to decide whether media preloading does real work on this platform.
 */
export function isMuxVideoPreloadSupported(): boolean {
  return typeof loadModule()?.preload === 'function';
}

/**
 * Begin (or refresh) a data-only preload for the given source. Resolves once
 * the request is accepted; buffering continues in the background. Safe to call
 * repeatedly with the same source — an in-flight preload is kept, not
 * restarted. Never rejects for playback-level failures: a preload that errors
 * out is dropped and the eventual playback performs a normal cold start.
 */
export async function preloadMuxVideo(
  source: MuxVideoSource,
  options?: MuxPreloadOptions
): Promise<void> {
  const mod = loadModule();
  if (typeof mod?.preload !== 'function') {
    return;
  }

  const normalized = normalizeMuxVideoSource(source);
  if (normalized.drmToken) {
    return;
  }

  const bufferAheadSeconds = clampBufferAhead(options?.bufferAheadSeconds);
  try {
    await mod.preload(normalized, bufferAheadSeconds);
  } catch {
    // Preload is best-effort; playback falls back to a cold start.
  }
}

/** Cancel the preload (if any) for a playback ID and release its resources. */
export async function cancelMuxVideoPreload(playbackId: string): Promise<void> {
  const mod = loadModule();
  if (typeof mod?.cancelPreload !== 'function') {
    return;
  }
  try {
    await mod.cancelPreload(playbackId);
  } catch {
    // ignore
  }
}

/** Cancel every in-flight preload — for background, blur, and memory pressure. */
export async function cancelAllMuxVideoPreloads(): Promise<void> {
  const mod = loadModule();
  if (typeof mod?.cancelAllPreloads !== 'function') {
    return;
  }
  try {
    await mod.cancelAllPreloads();
  } catch {
    // ignore
  }
}

function clampBufferAhead(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_PRELOAD_BUFFER_SECONDS;
  }
  return Math.min(30, value);
}

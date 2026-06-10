import { describe, expect, it } from 'vitest';

import { normalizeMuxVideoSource } from '../src/normalizeSource';

describe('normalizeMuxVideoSource', () => {
  it('normalizes a string source to a playback ID source object', () => {
    expect(normalizeMuxVideoSource('abc123')).toMatchObject({
      playbackId: 'abc123',
      renditionOrder: 'default',
    });
  });

  it('requires a playback token for DRM playback', () => {
    expect(() =>
      normalizeMuxVideoSource({
        playbackId: 'abc123',
        drmToken: 'drm-token',
      })
    ).toThrow(/requires both drmToken and playbackToken/);
  });

  it('rejects an invalid resolution window', () => {
    expect(() =>
      normalizeMuxVideoSource({
        playbackId: 'abc123',
        minResolution: '1080p',
        maxResolution: '720p',
      })
    ).toThrow(/minResolution/);
  });

  it('normalizes arbitrary custom metadata into Mux customData slots', () => {
    expect(
      normalizeMuxVideoSource({
        playbackId: 'abc123',
        metadata: {
          customData: {
            campaign: 'spring',
            customData3: 'kept',
          },
        },
      }).metadata?.customData
    ).toEqual({
      customData1: 'spring',
      customData3: 'kept',
    });
  });

  it('preserves Mux Data metadata fields', () => {
    expect(
      normalizeMuxVideoSource({
        playbackId: 'abc123',
        metadata: {
          envKey: 'env-key',
          playerName: 'Example Player',
          playerVersion: '1.2.3',
          videoTitle: 'Example Video',
          videoId: 'video-123',
          videoSeries: 'series-123',
          viewerUserId: 'viewer-123',
        },
      }).metadata
    ).toMatchObject({
      envKey: 'env-key',
      playerName: 'Example Player',
      playerVersion: '1.2.3',
      videoTitle: 'Example Video',
      videoId: 'video-123',
      videoSeries: 'series-123',
      viewerUserId: 'viewer-123',
    });
  });
});
